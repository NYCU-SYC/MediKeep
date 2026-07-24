'use client';

// 病人/家屬端：產生「急診保命連結」交給現場醫師，並查看誰存取過、隨時撤銷。

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { ApiError, api } from '@/lib/api';
import { useToast } from '../toast-context';

type Link = {
  id: string; token: string; url: string; label: string | null;
  scope: string;
  expires_at: string | null; revoked_at: string | null; active: boolean;
  access_count: number; last_accessed_at: string | null; created_at: string | null;
};
type Access = { accessor: string; org: string | null; token: string | null; ip?: string | null; user_agent?: string | null; at: string | null };

function fmt(d: string | null): string {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleString('zh-TW');
}

function QrCode({ value }: { value: string }) {
  const [qrState, setQrState] = useState({ value: '', dataUrl: '', failed: false });

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 220,
      color: {
        dark: '#22313f',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) setQrState({ value, dataUrl: url, failed: false });
      })
      .catch(() => {
        if (!cancelled) setQrState({ value, dataUrl: '', failed: true });
      });
    return () => { cancelled = true; };
  }, [value]);

  if (qrState.value === value && qrState.failed) {
    return (
      <div style={qrFallback}>
        連結過長，請使用複製連結。
      </div>
    );
  }
  if (qrState.value !== value || !qrState.dataUrl) {
    return <div style={qrFallback}>QR Code 產生中...</div>;
  }
  return (
    <img
      src={qrState.dataUrl}
      width={220}
      height={220}
      role="img"
      aria-label="急診連結 QR Code"
      alt="急診連結 QR Code"
      style={{ display: 'block', background: '#fff', borderRadius: 8, maxWidth: '100%', height: 'auto' }}
    />
  );
}

function scopeLabel(scope: string): string {
  const parts = scope.split(',').map((s) => s.trim()).filter(Boolean);
  const labels: Record<string, string> = {
    red_zone: '保命紅區',
    problems: '疾病清單',
    medications: '現用藥',
    vitals: '生命徵象',
    documents: '原始文件',
    dicom: 'DICOM 影像',
  };
  return parts.map((part) => labels[part] ?? part).join('、');
}

function normalizeOrigin(value: string | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin.replace(/\/$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

const configuredEmergencyOrigin = normalizeOrigin(
  process.env.NEXT_PUBLIC_EMERGENCY_PUBLIC_BASE_URL
  || process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
  || process.env.NEXT_PUBLIC_FRONTEND_ORIGIN
);

function emergencyPath(token: string): string {
  return `/emergency/${encodeURIComponent(token)}`;
}

function buildEmergencyUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${emergencyPath(token)}`;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host === '0.0.0.0' || host.startsWith('127.');
}

function isLocalBrowserUrl(url: string): boolean {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
    return isLoopbackHost(new URL(url, base).hostname);
  } catch {
    return false;
  }
}

function frontendEmergencyUrl(link: Link): string {
  const backendUrl = (link.url || '').trim();
  if (configuredEmergencyOrigin && link.token) return buildEmergencyUrl(configuredEmergencyOrigin, link.token);
  if (backendUrl && !isLocalBrowserUrl(backendUrl)) return backendUrl;
  if (typeof window !== 'undefined' && link.token) return buildEmergencyUrl(window.location.origin, link.token);
  return backendUrl;
}

function qrAvailability(url: string): { canScan: boolean; title: string; body: string } {
  if (!url) {
    return {
      canScan: false,
      title: '尚未取得連結',
      body: '請重新整理或重新產生急診連結。',
    };
  }
  if (isLocalBrowserUrl(url)) {
    return {
      canScan: false,
      title: '目前 QR 指向本機網址',
      body: '手機掃描 127.0.0.1 或 localhost 會回到手機自己，因此無法開啟這台電腦上的頁面。請改用公開網址或可被手機連到的網址後再產生 QR。',
    };
  }
  return {
    canScan: true,
    title: '給現場醫師掃描',
    body: '掃描後醫師仍需留下姓名才會看到資料。若醫師要求原始文件或影像，請回到上方重新產生含文件/影像的新連結。',
  };
}

export default function EmergencyLinksPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [links, setLinks] = useState<Link[]>([]);
  const [accesses, setAccesses] = useState<Access[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [ttlHours, setTtlHours] = useState(24);
  const [incDocs, setIncDocs] = useState(false);
  const [incImaging, setIncImaging] = useState(false);
  const [newLinkId, setNewLinkId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/patients/me/emergency-links') as { links: Link[]; accesses: Access[] };
      setLinks(d.links ?? []); setAccesses(d.accesses ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const created = await api.post('/api/patients/me/emergency-links', {
        ttl_hours: ttlHours,
        label: label.trim() || null,
        include_documents: incDocs,
        include_imaging: incImaging,
      }) as Link;
      setLinks(prev => [created, ...prev.filter(l => l.id !== created.id)]);
      setNewLinkId(created.id);
      setLabel('');
      await load();
      showToast(`已產生急診連結（${ttlHours} 小時有效）`, 'success');
    } catch (err) {
      const message = err instanceof ApiError && err.message && err.message !== 'Request failed'
        ? err.message
        : '請稍後再試';
      showToast(`產生失敗：${message}`, 'error');
    }
    finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('撤銷後此連結立即失效，醫師將無法再開啟。確定撤銷？')) return;
    try { await api.delete(`/api/patients/me/emergency-links/${id}`); await load(); showToast('已撤銷', 'success'); }
    catch { showToast('撤銷失敗', 'error'); }
  };

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); showToast('已複製連結，可傳給醫師或家人', 'success'); }
    catch { showToast('複製失敗，請手動選取', 'error'); }
  };

  const toggleAdvancedScope = (kind: 'documents' | 'imaging', checked: boolean) => {
    if (!checked) {
      if (kind === 'documents') setIncDocs(false);
      else setIncImaging(false);
      return;
    }
    const ok = window.confirm(
      kind === 'documents'
        ? '開放原始文件後，持有此連結的人可在有效期限內查看檢驗、出院摘要等原始檔。請只在現場醫師需要確認 evidence 時開啟。確定開放？'
        : '開放 DICOM 後，持有此連結的人可在有效期限內查看影像 viewer。請只在現場醫師需要確認影像時開啟。確定開放？'
    );
    if (!ok) return;
    if (kind === 'documents') setIncDocs(true);
    else setIncImaging(true);
  };

  const active = links.filter(l => l.active);
  const inactive = links.filter(l => !l.active);

  return (
    <div className="page-wrap" style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>
      <button onClick={() => router.back()} style={back}>← 返回</button>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: '#22313f', margin: '8px 0 2px' }}>急診保命連結</h1>
      <p style={{ color: '#6b7c8c', fontSize: 14, lineHeight: 1.7, margin: '0 0 16px' }}>
        預設只開放保命紅區、疾病、用藥與生命徵象。醫師輸入姓名後才可檢視；
        <strong>每次存取都會記錄</strong>，你也可以隨時撤銷。只有在現場醫師明確需要時，才加開原始文件或影像。
      </p>

      <section style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#22313f', marginBottom: 8 }}>產生新連結</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="備註（選填）例：給台大急診"
            style={{ flex: 1, minWidth: 200, border: '1px solid #c8d4dc', borderRadius: 10, padding: '10px 12px', fontSize: 14 }} />
          <select value={ttlHours} onChange={e => setTtlHours(Number(e.target.value))}
            style={{ border: '1px solid #c8d4dc', borderRadius: 10, padding: '10px 12px', fontSize: 14, background: '#fff', color: '#45596a', fontWeight: 700 }}>
            <option value={1}>1 小時</option>
            <option value={6}>6 小時</option>
            <option value={24}>24 小時</option>
            <option value={72}>72 小時</option>
          </select>
          <button onClick={create} disabled={busy}
            style={{ background: '#a03a30', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 850, fontSize: 14, cursor: 'pointer' }}>
            {busy ? '產生中…' : '＋ 產生連結'}
          </button>
        </div>
        <div style={{ background: '#f6f9fa', border: '1px solid #e3e9ee', borderRadius: 12, padding: 12, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 850, color: '#45596a', marginBottom: 8 }}>進階開放範圍（預設關閉）</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#45596a' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={incDocs} onChange={e => toggleAdvancedScope('documents', e.target.checked)} />
              一併開放原始文件（檢驗 / 出院摘要等）
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={incImaging} onChange={e => toggleAdvancedScope('imaging', e.target.checked)} />
              一併開放影像（DICOM）連結
            </label>
          </div>
          <div style={{ fontSize: 12, color: '#6b7c8c', marginTop: 8, lineHeight: 1.6 }}>
            加開後，持有連結的人可在有效期限內查看更多原始資料。請只在現場醫療人員需要確認 evidence 時使用。
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#93a3af', marginTop: 10, lineHeight: 1.6 }}>
          產生後會顯示可掃描 QR Code。HealthKeep 直接在本頁產生 QR，不會把急診連結送到第三方 QR 服務。
          若目前是在 127.0.0.1 或 localhost 預覽，系統會先提醒你改用公開網址，避免產生手機無法開啟的 QR。
        </div>
      </section>

      {loading ? <div style={{ color: '#6b7c8c', padding: 16 }}>載入中…</div> : (
        <>
          <h2 style={h2}>有效連結 {active.length > 0 && <span style={{ color: '#2e8b57' }}>({active.length})</span>}</h2>
          {active.length === 0 ? <Empty>目前沒有有效連結。需要時按上方「產生連結」。</Empty> : active.map(l => {
            const url = frontendEmergencyUrl(l);
            const qr = qrAvailability(url);
            return (
            <div key={l.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#22313f' }}>{l.label || '急診保命連結'}</div>
                  <div style={{ fontSize: 12, color: '#6b7c8c' }}>有效至 {fmt(l.expires_at)} · 已被開啟 {l.access_count} 次</div>
                  <div style={{ fontSize: 11, color: '#93a3af', marginTop: 2 }}>範圍：{scopeLabel(l.scope)}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 999, background: newLinkId === l.id ? '#faecea' : '#dcefe3', color: newLinkId === l.id ? '#a03a30' : '#2e8b57' }}>
                  {newLinkId === l.id ? '剛產生' : '有效'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', background: '#f6f9fa', border: '1px solid #e3e9ee', borderRadius: 10, padding: '8px 10px' }}>
                <code style={{ flex: 1, fontSize: 12, color: '#45596a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</code>
                <button onClick={() => copy(url)} style={smallBtn}>複製</button>
                <a href={url} target="_blank" rel="noreferrer" style={{ ...smallBtn, textDecoration: 'none' }}>開啟</a>
                <button onClick={() => revoke(l.id)} style={{ ...smallBtn, color: '#a03a30', borderColor: '#f2d3cf' }}>撤銷</button>
              </div>
              <div style={qrCard}>
                {qr.canScan ? <QrCode value={url} /> : (
                  <div style={{ ...qrFallback, borderColor: '#fed7aa', background: '#fdf1e0', color: '#b06a10', fontWeight: 800 }}>
                    無法產生可用 QR
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 850, color: qr.canScan ? '#22313f' : '#b06a10' }}>{qr.title}</div>
                  <div style={{ fontSize: 12, color: qr.canScan ? '#6b7c8c' : '#b06a10', lineHeight: 1.6, marginTop: 4 }}>
                    {qr.body}
                  </div>
                  {!qr.canScan && (
                    <div style={{ fontSize: 11, color: '#6b7c8c', lineHeight: 1.6, marginTop: 6 }}>
                      開發環境可設定 <code>NEXT_PUBLIC_EMERGENCY_PUBLIC_BASE_URL</code> 為 ngrok、Cloudflare Tunnel 或正式網域後重新整理。
                    </div>
                  )}
                </div>
              </div>
            </div>
          )})}

          <h2 style={h2}>誰看過保命資料</h2>
          {accesses.length === 0 ? <Empty>尚無存取紀錄。醫師開啟連結後會出現在這裡。</Empty> : (
            <div style={card}>
              {accesses.map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: i < accesses.length - 1 ? '1px solid #eef2f5' : 'none' }}>
                  <div>
                    <strong style={{ color: '#22313f' }}>{a.accessor}</strong>{a.org ? <span style={{ color: '#6b7c8c', fontSize: 13 }}> · {a.org}</span> : ''}
                    <div style={{ fontSize: 11, color: '#93a3af', marginTop: 2 }}>
                      {a.ip ? `IP ${a.ip}` : 'IP 未記錄'}{a.user_agent ? ` · ${a.user_agent.slice(0, 80)}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#93a3af', flexShrink: 0 }}>{fmt(a.at)}</div>
                </div>
              ))}
            </div>
          )}

          {inactive.length > 0 && (
            <>
              <h2 style={h2}>已失效 / 已撤銷</h2>
              <div style={card}>
                {inactive.map((l, i) => (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: i < inactive.length - 1 ? '1px solid #eef2f5' : 'none', color: '#93a3af' }}>
                    <span style={{ fontSize: 13 }}>{l.label || '急診保命連結'}</span>
                    <span style={{ fontSize: 12 }}>{l.revoked_at ? '已撤銷' : '已過期'} · {fmt(l.revoked_at || l.expires_at)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ ...card, color: '#6b7c8c', fontSize: 13 }}>{children}</div>;
}

const back: React.CSSProperties = { border: '1px solid #e3e9ee', background: '#fff', color: '#45596a', borderRadius: 10, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e9ee', borderRadius: 14, padding: 14, marginBottom: 12 };
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 850, color: '#22313f', margin: '18px 0 8px' };
const smallBtn: React.CSSProperties = { border: '1px solid #c8d4dc', background: '#fff', color: '#45596a', borderRadius: 8, padding: '6px 10px', fontWeight: 800, fontSize: 12, cursor: 'pointer', flexShrink: 0 };
const qrCard: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, background: '#fff', border: '1px solid #e3e9ee', borderRadius: 12, padding: 12, flexWrap: 'wrap' };
const qrFallback: React.CSSProperties = { width: 180, minHeight: 180, border: '1px dashed #c8d4dc', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#6b7c8c', fontSize: 12, padding: 12 };
