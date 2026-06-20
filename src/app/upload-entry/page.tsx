'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setPatientSessionToken } from '@/lib/api';

type LiffType = typeof import('@line/liff').default;
type PageState = 'initializing' | 'redirecting' | 'error';

type ErrorKey =
  | 'USER_CANCELLED'
  | 'FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'TOKEN_ERROR'
  | 'SERVER_ERROR'
  | 'CONFIG_ERROR'
  | 'UNKNOWN';

const ERROR_INFO: Record<ErrorKey, { title: string; hint: string; icon: string }> = {
  USER_CANCELLED: {
    title: '您取消了 LINE 登入',
    hint: '點擊下方按鈕重新連接',
    icon: '👋',
  },
  FORBIDDEN: {
    title: '帳號暫時無法使用',
    hint: '請聯絡系統管理員協助開通權限',
    icon: '🚫',
  },
  NETWORK_ERROR: {
    title: '網路連線不穩',
    hint: '系統將在網路恢復後自動重試',
    icon: '📡',
  },
  TOKEN_ERROR: {
    title: '身分憑證已失效',
    // TOKEN_ERROR does NOT auto-retry (reload gets the same stale token).
    // Instead we show a button that forces LIFF logout → fresh login.
    hint: '請點擊下方按鈕重新登入 LINE',
    icon: '🔄',
  },
  SERVER_ERROR: {
    title: '伺服器暫時忙線',
    hint: '系統將自動為您重新嘗試',
    icon: '⏳',
  },
  CONFIG_ERROR: {
    title: '系統設定異常',
    hint: '請聯絡系統管理員協助處理',
    icon: '⚙️',
  },
  UNKNOWN: {
    title: '連線過程發生問題',
    hint: '系統將自動為您重新嘗試',
    icon: '🔁',
  },
};

// TOKEN_ERROR is intentionally excluded — reloading gets the same stale cached
// LIFF token, so auto-retry would loop forever.  Handle it with a manual button
// that forces liff.logout() before reload so LINE issues a fresh token.
const AUTO_RETRY_ERRORS = new Set<ErrorKey>([
  'NETWORK_ERROR',
  'SERVER_ERROR',
  'UNKNOWN',
]);

// USER_CANCELLED: give a longer countdown so the user can reconsider
const MANUAL_RETRY_ERRORS = new Set<ErrorKey>([
  'USER_CANCELLED',
  'TOKEN_ERROR',
]);

// 無法恢復的錯誤 (需要管理員介入)
const UNRECOVERABLE_ERRORS = new Set<ErrorKey>(['FORBIDDEN', 'CONFIG_ERROR']);

function classifyError(err: unknown): ErrorKey {
  const msg = err instanceof Error ? err.message : String(err);
  const upper = msg.toUpperCase();
  const knownKeys: ErrorKey[] = [
    'USER_CANCELLED',
    'FORBIDDEN',
    'NETWORK_ERROR',
    'TOKEN_ERROR',
    'SERVER_ERROR',
    'CONFIG_ERROR',
  ];
  for (const k of knownKeys) {
    if (upper.includes(k)) return k;
  }
  if (/network|fetch|failed to fetch/i.test(msg)) return 'NETWORK_ERROR';
  if (/cancell?ed|cancel/i.test(msg)) return 'USER_CANCELLED';
  return 'UNKNOWN';
}

function isLocalDevHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function canonicalUploadEntryUrl() {
  return new URL('/upload-entry', window.location.origin).toString();
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

const RETRY_SECONDS_DEFAULT = 5;

export default function UploadEntryPage() {
  const router = useRouter();
  const liffRef = useRef<LiffType | null>(null);
  const [pageState, setPageState] = useState<PageState>('initializing');
  const [statusText, setStatusText] = useState('正在連接 LINE...');
  const [errorKey, setErrorKey] = useState<ErrorKey | ''>('');
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const [retryTotal] = useState<number>(RETRY_SECONDS_DEFAULT);

  // 主要流程：預檢 session → LIFF → backend session
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const run = async () => {
      try {
        // 1. 預檢：若已登入，直接跳對應頁面 (bookmark / 回訪情境)
        try {
          const meResp = await fetch('/api/auth/me', { credentials: 'include' });
          if (meResp.ok) {
            const me = await meResp.json();
            if (!cancelled && me?.authenticated) {
              const dest = me?.needs_binding ? '/setup' : '/dashboard';
              setStatusText(me?.needs_binding ? '請完成家庭設定...' : '歡迎回來');
              setPageState('redirecting');
              setTimeout(() => {
                if (!cancelled) router.replace(dest);
              }, 300);
              return;
            }
          }
        } catch {
          // 預檢失敗不影響主要流程
        }

        if (cancelled) return;

        // 1b. 開發環境：自動使用 dev-login 繞過 LINE LIFF
        if (isLocalDevHost(window.location.hostname)) {
          setStatusText('開發模式：建立本地登入...');
          let devRes: Response;
          try {
            devRes = await fetchWithTimeout('/api/auth/dev-login', { method: 'POST', credentials: 'include' });
          } catch {
            throw new Error('NETWORK_ERROR');
          }
          if (devRes.ok) {
            const data = await devRes.json();
            setPatientSessionToken(data.session_token);
            const dest = data?.needs_binding ? '/setup' : '/dashboard';
            setPageState('redirecting');
            setTimeout(() => { if (!cancelled) router.replace(dest); }, 300);
            return;
          }
          throw new Error(devRes.status >= 500 ? 'SERVER_ERROR' : 'CONFIG_ERROR');
        }

        // 2. 檢查 LIFF 設定
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
        if (!liffId || liffId.includes('填你的')) {
          throw new Error('CONFIG_ERROR');
        }

        // 3. 動態載入 LIFF SDK
        const { default: liff } = await import('@line/liff');
        liffRef.current = liff;
        await liff.init({ liffId });

        if (cancelled) return;

        // 4. 若尚未登入 LINE，導向 LINE 登入
        if (!liff.isLoggedIn()) {
          setStatusText('正在開啟 LINE 登入...');
          liff.login({ redirectUri: canonicalUploadEntryUrl() });
          return;
        }

        // 5. 取得 ID Token
        const idToken = liff.getIDToken();
        console.log('[LIFF] idToken present:', !!idToken, '| length:', idToken?.length ?? 0);
        if (!idToken) throw new Error('TOKEN_ERROR');

        setStatusText('正在為您建立個人空間...');

        // 6. 換取後端 session
        let resp: Response;
        try {
          resp = await fetch('/api/auth/line/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ id_token: idToken }),
          });
        } catch {
          throw new Error('NETWORK_ERROR');
        }

        if (!resp.ok) {
          // Log the actual backend error so it's visible in DevTools
          const detail = await resp.text().catch(() => '(no body)');
          console.error(`[Session] HTTP ${resp.status}:`, detail);
          if (resp.status === 403) throw new Error('FORBIDDEN');
          // 401 = LINE id_token rejected by backend (expired / wrong channel)
          if (resp.status === 401) throw new Error('TOKEN_ERROR');
          // 422 = request schema mismatch
          if (resp.status === 422) throw new Error('CONFIG_ERROR');
          throw new Error('SERVER_ERROR');
        }

        if (cancelled) return;

        // 7. 成功 → 依 needs_binding 決定目的地
        const loginData = await resp.json();
        setPatientSessionToken(loginData.session_token);
        const dest = loginData?.needs_binding ? '/setup' : '/dashboard';
        setStatusText(loginData?.needs_binding ? '請完成家庭設定...' : '登入成功，歡迎回家');
        setPageState('redirecting');
        setTimeout(() => {
          if (!cancelled) router.replace(dest);
        }, 600);
      } catch (e: unknown) {
        if (cancelled) return;
        console.error('[Login Error]:', e);
        const key = classifyError(e);
        setErrorKey(key);
        setPageState('error');

        if (AUTO_RETRY_ERRORS.has(key)) {
          setRetryCountdown(RETRY_SECONDS_DEFAULT);
        }
        // TOKEN_ERROR / USER_CANCELLED: no auto-retry — show manual button instead
        // UNRECOVERABLE: no retry at all
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // 自動倒數重試 (只用於 AUTO_RETRY_ERRORS)
  useEffect(() => {
    if (retryCountdown === null) return;
    if (retryCountdown <= 0) {
      window.location.reload();
      return;
    }
    const timer = setTimeout(() => {
      setRetryCountdown((c) => (c === null ? null : c - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryCountdown]);

  // 手動重新登入：強制 LIFF 登出，讓下次 init 取得全新 token
  const handleReLogin = () => {
    try {
      const l = liffRef.current;
      if (l?.isLoggedIn()) {
        l.logout(); // clears LIFF's cached session → next init will redirect to LINE login
      }
    } catch { /* ignore — page reload will clear state anyway */ }
    window.location.reload();
  };

  const isAutoRetrying = retryCountdown !== null;
  const isManualRetry = errorKey !== '' && MANUAL_RETRY_ERRORS.has(errorKey as ErrorKey);
  const isUnrecoverable = errorKey !== '' && UNRECOVERABLE_ERRORS.has(errorKey as ErrorKey);
  const info = errorKey ? ERROR_INFO[errorKey as ErrorKey] : null;

  // 倒數圓環進度 (0 ~ 1)
  const progress = isAutoRetrying && retryTotal > 0 ? (retryCountdown ?? 0) / retryTotal : 0;
  const circumference = 2 * Math.PI * 28;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)',
        padding: '24px',
      }}
    >
      {pageState !== 'error' ? (
        // ─── 載入 / 跳轉中 ───────────────────────────────
        <div style={{ textAlign: 'center', color: '#fff', width: '100%', maxWidth: '520px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '0', marginBottom: '6px' }}>
            HealthKeep
          </h1>
          <p style={{ fontSize: '14px', opacity: 0.88, marginBottom: '18px', letterSpacing: '0', lineHeight: 1.6 }}>
            把家人的病歷、用藥、過敏與影像整理成急診時能快速交給醫師的保命資料。
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 8,
            marginBottom: 28,
          }}>
            {[
              ['保命紅區', '過敏、抗凝血藥、腎功能優先呈現'],
              ['醫療團隊確認', '上傳不等於已辨識，確認狀態會分開標示'],
              ['急診限時分享', '可撤銷、會記錄誰看過資料'],
              ['隱私分層', 'LINE ID 雜湊處理，健康資料分離管理'],
            ].map(([title, body]) => (
              <div key={title} style={{
                textAlign: 'left',
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.10)',
                borderRadius: 12,
                padding: '10px 12px',
                minHeight: 76,
              }}>
                <div style={{ fontSize: 13, fontWeight: 850, marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 11, lineHeight: 1.5, opacity: 0.78 }}>{body}</div>
              </div>
            ))}
          </div>
          <div
            style={{
              width: '48px', height: '48px',
              border: '4px solid rgba(255,255,255,0.25)',
              borderTopColor: pageState === 'redirecting' ? '#06C755' : '#fff',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 20px',
              transition: 'border-top-color 0.3s',
            }}
          />
          <p style={{ fontSize: '14px', opacity: 0.9, minHeight: '20px' }}>{statusText}</p>
        </div>
      ) : (
        // ─── 錯誤畫面 ────────────────────────────────────
        <div
          style={{
            background: '#fff',
            padding: '36px 28px',
            borderRadius: '20px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            maxWidth: '360px',
            width: '100%',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '52px', marginBottom: '12px' }}>{info?.icon}</div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#333', marginBottom: '8px' }}>
            {info?.title}
          </h2>
          <p style={{ fontSize: '13px', color: '#888', marginBottom: '24px', lineHeight: 1.6 }}>
            {info?.hint}
          </p>

          {/* Auto-retry countdown ring */}
          {isAutoRetrying && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ width: '64px', height: '64px', margin: '0 auto', position: 'relative' }}>
                <svg width="64" height="64" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="32" cy="32" r="28" fill="none" stroke="#e9ecef" strokeWidth="4" />
                  <circle
                    cx="32" cy="32" r="28" fill="none" stroke="#007bff" strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - progress)}
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '20px', fontWeight: 700, color: '#007bff',
                }}>
                  {retryCountdown}
                </div>
              </div>
              <p style={{ fontSize: '12px', color: '#999', marginTop: '10px' }}>稍後將自動重試</p>
            </div>
          )}

          {/* Manual re-login button (TOKEN_ERROR / USER_CANCELLED) */}
          {isManualRetry && (
            <button
              onClick={handleReLogin}
              style={{
                width: '100%', padding: '13px',
                background: '#06C755', color: '#fff',
                border: 'none', borderRadius: '12px',
                fontSize: '15px', fontWeight: 700, cursor: 'pointer',
                marginBottom: '12px',
              }}
            >
              重新登入 LINE
            </button>
          )}

          {/* Unrecoverable error note */}
          {isUnrecoverable && (
            <div style={{
              padding: '12px', background: '#f8f9fa', borderRadius: '10px',
              fontSize: '12px', color: '#666',
            }}>
              如需協助請聯繫您的家庭管理員
            </div>
          )}

          {/* Persistent TOKEN_ERROR: suggest checking config */}
          {errorKey === 'TOKEN_ERROR' && (
            <p style={{ fontSize: '11px', color: '#bbb', marginTop: '12px', lineHeight: 1.5 }}>
              如果反覆出現此問題，請確認 LINE 登入頻道設定是否正確
            </p>
          )}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
