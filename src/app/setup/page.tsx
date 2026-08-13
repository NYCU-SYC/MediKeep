'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Home, Link2, Plus, X } from 'lucide-react';
import { api, ApiError, setPatientSessionToken } from '@/lib/api';
import { nextRouteFromSearch, routeWithNext, safeNextRoute } from '@/lib/internalRoutes';

type Tab = 'create' | 'join';

type NewMember = { name: string; relation: string; age: string; gender: string; color: string };
type JoinPreview = {
  family_name: string;
  join_code: string;
  join_code_expires_at?: string | null;
  join_code_status?: string | null;
  member_count: number;
  current_family_name?: string | null;
  has_local_data?: boolean;
  local_data_summary?: string[];
  requires_confirmation?: boolean;
  confirmation_reasons?: string[];
  will_leave_current_family?: boolean;
  will_keep_existing_health_data_separate?: boolean;
  warning?: string | null;
};

const PRESETS = [
  { name: '本人',   relation: '本人', gender: '男', color: '#2196f3' },
  { name: '爸爸',   relation: '父親', gender: '男', color: '#f44336' },
  { name: '媽媽',   relation: '母親', gender: '女', color: '#e91e63' },
  { name: '爺爺',   relation: '祖父', gender: '男', color: '#795548' },
  { name: '奶奶',   relation: '祖母', gender: '女', color: '#ff7043' },
  { name: '外公',   relation: '外祖父', gender: '男', color: '#6d4c41' },
  { name: '外婆',   relation: '外祖母', gender: '女', color: '#ec407a' },
  { name: '兒子',   relation: '兒子', gender: '男', color: '#4caf50' },
  { name: '女兒',   relation: '女兒', gender: '女', color: '#9c27b0' },
  { name: '配偶',   relation: '配偶', gender: '女', color: '#ff9800' },
  { name: '兄弟',   relation: '兄弟', gender: '男', color: '#00bcd4' },
  { name: '姊妹',   relation: '姊妹', gender: '女', color: '#8bc34a' },
];

const COLORS = [
  { value: '#607d8b', label: '藍灰色' },
  { value: '#f44336', label: '紅色' },
  { value: '#e91e63', label: '桃紅色' },
  { value: '#9c27b0', label: '紫色' },
  { value: '#2196f3', label: '藍色' },
  { value: '#4caf50', label: '綠色' },
  { value: '#ff9800', label: '橘色' },
  { value: '#00bcd4', label: '青色' },
  { value: '#795548', label: '棕色' },
];

const BLANK_MEMBER: NewMember = { name: '', relation: '', age: '', gender: '男', color: '#607d8b' };

async function readApiError(resp: Response, fallback: string) {
  const err = await resp.json().catch(() => ({}));
  return err?.error?.message ?? err?.detail ?? fallback;
}

export default function SetupPage() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState('/dashboard');
  const [authState, setAuthState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [authAttempt, setAuthAttempt] = useState(0);
  const [step, setStep] = useState<1 | 2>(1);
  const [tab, setTab] = useState<Tab>('create');

  // Step 1 — family name / join
  const [familyName, setFamilyName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [step1Submitting, setStep1Submitting] = useState(false);
  const [step1Error, setStep1Error] = useState('');
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const [joinPreview, setJoinPreview] = useState<JoinPreview | null>(null);
  const [joinConfirmed, setJoinConfirmed] = useState(false);

  // Step 2 — add members
  const [members, setMembers] = useState<NewMember[]>([]);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customMember, setCustomMember] = useState<NewMember>(BLANK_MEMBER);
  const [saving, setSaving] = useState(false);
  const [cancelingCreate, setCancelingCreate] = useState(false);
  const [finishError, setFinishError] = useState('');

  useEffect(() => {
    let alive = true;
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const next = nextRouteFromSearch(search, '/dashboard');
    setReturnTo(next);
    const linkedCode = (params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const currentSetupRoute = safeNextRoute(`/setup${search}`, '/setup');
    setAuthState('checking');
    setStep1Error('');

    const prepare = async () => {
      try {
        const me = await api.get('/api/auth/me') as { authenticated?: boolean };
        if (!alive) return;
        if (!me?.authenticated) {
          window.location.replace(routeWithNext('/upload-entry', currentSetupRoute));
          return;
        }
        setAuthState('ready');
        if (params.get('mode') !== 'join' || linkedCode.length !== 8) return;

        setTab('join');
        setJoinCode(linkedCode);
        setJoinPreview(null);
        setJoinConfirmed(false);
        setStep1Submitting(true);
        const resp = await fetch(`/api/auth/join/preview?join_code=${encodeURIComponent(linkedCode)}`, { credentials: 'include' });
        if (!resp.ok) throw new Error(await readApiError(resp, '找不到此家庭代碼，請確認後重試'));
        const preview = await resp.json() as JoinPreview;
        if (alive) setJoinPreview(preview);
      } catch (error) {
        if (!alive || (error instanceof ApiError && error.status === 401)) return;
        if (error instanceof ApiError) {
          setAuthState('error');
          setStep1Error(error.retryAfter
            ? `暫時無法確認登入狀態，約 ${error.retryAfter} 秒後可重試。`
            : '暫時無法確認登入狀態，請重試。');
        } else {
          setStep1Error(error instanceof Error ? error.message : '無法預覽家庭加入資訊');
        }
      } finally {
        if (alive) setStep1Submitting(false);
      }
    };
    void prepare();
    return () => { alive = false; };
  }, [authAttempt]);

  // ── Step 1: create family ──────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep1Error('');
    if (!createConfirmed) {
      setStep1Error('請先確認這是新的獨立家庭；如果已有加入代碼，請改用「加入已有家庭」。');
      return;
    }
    setStep1Submitting(true);
    try {
      const resp = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ family_name: familyName.trim() || '我的家庭' }),
      });
      if (!resp.ok) {
        setStep1Error(await readApiError(resp, '建立失敗，請稍後再試'));
        return;
      }
      setPatientSessionToken(null);
      setFinishError('');
      setStep(2);
    } catch {
      setStep1Error('網路錯誤，請稍後再試');
    } finally {
      setStep1Submitting(false);
    }
  };

  // ── Step 1: join family ────────────────────────────────────────────────────
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep1Error('');
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 8) { setStep1Error('請輸入 8 碼的加入代碼'); return; }
    setStep1Submitting(true);
    try {
      if (joinPreview?.join_code !== code) {
        const previewResp = await fetch(`/api/auth/join/preview?join_code=${encodeURIComponent(code)}`, {
          method: 'GET',
          credentials: 'include',
        });
        if (!previewResp.ok) {
          setJoinPreview(null);
          setStep1Error(await readApiError(previewResp, '找不到此家庭代碼，請確認後重試'));
          return;
        }
        const preview = await previewResp.json() as JoinPreview;
        setJoinPreview(preview);
        setJoinConfirmed(false);
        return;
      }
      if (joinPreview?.requires_confirmation && !joinConfirmed) {
        setStep1Error('請先勾選確認，確認這是正確家庭，且了解原本資料不會自動搬移。');
        return;
      }
      const resp = await fetch('/api/auth/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          join_code: code,
          confirmed_family_name: joinPreview?.family_name,
          confirm_local_data_transfer: joinConfirmed || !joinPreview?.requires_confirmation,
        }),
      });
      if (!resp.ok) {
        if (resp.status !== 409) setJoinPreview(null);
        setStep1Error(await readApiError(resp, '加入失敗，請確認代碼後再試'));
        return;
      }
      setPatientSessionToken(null);
      // Joined an existing family — skip member setup, go to dashboard
      router.replace(returnTo);
    } catch {
      setStep1Error('網路錯誤，請稍後再試');
    } finally {
      setStep1Submitting(false);
    }
  };

  // ── Step 2: toggle preset member ──────────────────────────────────────────
  const togglePreset = (preset: typeof PRESETS[0]) => {
    setMembers(prev => {
      const exists = prev.some(m => m.name === preset.name);
      if (exists) return prev.filter(m => m.name !== preset.name);
      return [...prev, { name: preset.name, relation: preset.relation, age: '', gender: preset.gender, color: preset.color }];
    });
  };

  const addCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customMember.name.trim()) return;
    setMembers(prev => [...prev, { ...customMember }]);
    setCustomMember(BLANK_MEMBER);
    setShowCustomForm(false);
  };

  // ── Step 2: save members and enter dashboard ───────────────────────────────
  const handleFinish = async () => {
    setSaving(true);
    setFinishError('');
    try {
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const resp = await fetch('/api/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: m.name,
            relation: m.relation,
            age: m.age ? parseInt(m.age) : null,
            gender: m.gender,
            color: m.color,
            sort_order: i,
          }),
        });
        if (!resp.ok) {
          throw new Error(await readApiError(resp, `無法新增 ${m.name || '家庭成員'}，請稍後再試`));
        }
      }
      router.replace(returnTo);
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : '新增家庭成員失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const cancelCreatedFamily = async () => {
    setFinishError('');
    setCancelingCreate(true);
    try {
      const resp = await fetch('/api/auth/family/leave', {
        method: 'POST',
        credentials: 'include',
      });
      if (!resp.ok) {
        setFinishError(await readApiError(resp, '無法撤銷此家庭。若已有健康資料或其他成員登入，請到設定中處理權限。'));
        return;
      }
      const result = await resp.json().catch(() => ({}));
      if (result?.session_token) setPatientSessionToken(result.session_token);
      setMembers([]);
      setFamilyName('');
      setCreateConfirmed(false);
      setShowCustomForm(false);
      setCustomMember(BLANK_MEMBER);
      setTab('join');
      setStep(1);
    } catch {
      setFinishError('網路錯誤，無法撤銷新家庭。請稍後再試。');
    } finally {
      setCancelingCreate(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff', borderRadius: '24px', padding: '40px 32px',
    maxWidth: '480px', width: '100%',
    boxShadow: '0 24px 48px rgba(0,0,0,0.20)',
  };

  const btnPrimary: React.CSSProperties = {
    width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
    background: '#3e6b7e', color: '#fff', fontSize: '15px', fontWeight: '700',
    cursor: 'pointer',
  };

  const errorBox: React.CSSProperties = {
    background: '#fff0f0', border: '1px solid #ffcdd2', borderRadius: '8px',
    padding: '10px 14px', fontSize: '13px', color: '#c62828', marginBottom: '16px',
  };
  const joinCodeForSubmit = joinCode.trim().toUpperCase();
  const joinCodeInvalid = joinCodeForSubmit.length !== 8;
  const createSubmitDisabled = step1Submitting || !createConfirmed;
  const joinSubmitDisabled = step1Submitting || joinCodeInvalid || (joinPreview?.requires_confirmation === true && !joinConfirmed);

  if (authState !== 'ready') {
    return (
      <main style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #3e6b7e 0%, #33596a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, width: '100%', maxWidth: 420, textAlign: 'center', boxShadow: '0 24px 48px rgba(0,0,0,0.20)' }}>
          <h1 style={{ color: '#22313f', fontSize: 22, marginBottom: 10 }}>家庭設定</h1>
          {authState === 'checking' ? (
            <p role="status" style={{ color: '#6b7c8c' }}>正在確認登入狀態…</p>
          ) : (
            <div role="alert">
              <p style={{ color: '#a03a30', lineHeight: 1.6 }}>{step1Error}</p>
              <button type="button" onClick={() => setAuthAttempt((value) => value + 1)} style={{ marginTop: 12, minHeight: 44, border: 0, borderRadius: 10, padding: '10px 16px', background: '#3e6b7e', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
                重新確認
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #3e6b7e 0%, #33596a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>

      {/* ── Step 1: name / join ── */}
      {step === 1 && (
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <Home aria-hidden="true" size={48} strokeWidth={1.8} style={{ color: '#3e6b7e', margin: '0 auto 12px' }} />
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#111', marginBottom: '8px' }}>
              設定您的家庭
            </h1>
            <p style={{ fontSize: '14px', color: '#56687a', lineHeight: 1.6 }}>
              建立新家庭空間，或加入已有的家庭
            </p>
          </div>

          <div style={{
            background: '#fdf1e0',
            border: '1px solid #fed7aa',
            color: '#b06a10',
            borderRadius: '12px',
            padding: '12px 14px',
            fontSize: '12px',
            lineHeight: 1.65,
            marginBottom: '20px',
          }}>
            這一步只建立家庭空間與成員切換，不等於正式醫療委託、法定代理或紙本病歷授權。涉及病歷調閱、醫師分享或資料更正時，仍需依後續授權與確認流程處理。
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', background: '#f0f4f8', borderRadius: '12px', padding: '4px', marginBottom: '28px' }}>
            {([
              { key: 'create' as Tab, label: '建立新家庭', icon: Home },
              { key: 'join'   as Tab, label: '加入已有家庭', icon: Link2 },
            ]).map(t => {
              const TabIcon = t.icon;
              return <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => { setTab(t.key); setStep1Error(''); setCreateConfirmed(false); setJoinPreview(null); setJoinConfirmed(false); }} style={{
                flex: 1, padding: '10px 8px', borderRadius: '10px', border: 'none',
                background: tab === t.key ? '#fff' : 'transparent',
                color: tab === t.key ? '#3e6b7e' : '#56687a',
                fontWeight: tab === t.key ? '700' : '500', fontSize: '13px', cursor: 'pointer',
                boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}><TabIcon aria-hidden="true" size={16} />{t.label}</button>;
            })}
          </div>

          {tab === 'create' && (
            <form onSubmit={handleCreate}>
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px', lineHeight: 1.6 }}>
                為您的家庭取個名字。下一步可以新增家庭成員；成員名稱只用於介面辨識，不會自動代表醫療授權。
              </p>
              <label htmlFor="family-name" style={{ fontSize: '13px', fontWeight: '600', color: '#555', display: 'block', marginBottom: '6px' }}>
                家庭名稱（選填）
              </label>
              <input
                id="family-name"
                type="text" placeholder="例：林家、王家健康"
                value={familyName} onChange={e => setFamilyName(e.target.value)}
                maxLength={40}
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: '10px',
                  border: '1.5px solid #e0e0e0', fontSize: '15px',
                  fontFamily: 'inherit', outline: 'none', marginBottom: '20px', boxSizing: 'border-box',
                }}
              />
              <div style={{
                border: '1px solid #bae6fd',
                background: '#f0f9ff',
                borderRadius: '12px',
                padding: '12px',
                marginBottom: '16px',
                color: '#0c4a6e',
                fontSize: '13px',
                lineHeight: 1.65,
              }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={createConfirmed}
                    onChange={event => setCreateConfirmed(event.target.checked)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>
                    我確認要建立一個新的獨立家庭。若我已有家人提供的加入代碼，應改用「加入已有家庭」，避免健康資料綁到錯誤家庭。
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => { setTab('join'); setStep1Error(''); setCreateConfirmed(false); }}
                  style={{ marginTop: '10px', minHeight: 44, border: 'none', background: 'transparent', color: '#0369a1', fontWeight: 800, cursor: 'pointer', padding: '8px 0' }}
                >
                  我有加入代碼，改為加入已有家庭
                </button>
              </div>
              {step1Error && <div role="alert" style={errorBox}>{step1Error}</div>}
              <button
                type="submit"
                disabled={createSubmitDisabled}
                style={{ ...btnPrimary, opacity: createSubmitDisabled ? 0.55 : 1, cursor: createSubmitDisabled ? 'not-allowed' : 'pointer' }}
              >
                {step1Submitting ? '建立中...' : '下一步：新增成員 →'}
              </button>
            </form>
          )}

          {tab === 'join' && (
            <form onSubmit={handleJoin}>
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px', lineHeight: 1.6 }}>
                輸入家庭管理員提供的加入代碼，加入共用家庭健康紀錄。加入後可看到的資料仍依帳號角色與後續授權設定為準。
              </p>
              <label htmlFor="family-join-code" style={{ fontSize: '13px', fontWeight: '600', color: '#555', display: 'block', marginBottom: '6px' }}>
                加入代碼
              </label>
              <input
                id="family-join-code"
                type="text" placeholder="例：AB12CD34"
                value={joinCode}
                onChange={e => {
                  setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
                  setJoinPreview(null);
                  setJoinConfirmed(false);
                }}
                maxLength={8}
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: '10px',
                  border: '1.5px solid #e0e0e0', fontSize: '22px',
                  fontFamily: 'monospace', outline: 'none', marginBottom: '20px',
                  letterSpacing: joinCode.length > 8 ? '2px' : '6px', textAlign: 'center', boxSizing: 'border-box',
                }}
              />
              {joinPreview && (
                <div style={{
                  border: '1px solid #bae6fd',
                  background: '#f0f9ff',
                  borderRadius: '12px',
                  padding: '14px',
                  marginBottom: '16px',
                  color: '#0c4a6e',
                  fontSize: '13px',
                  lineHeight: 1.65,
                }}>
                  <div style={{ fontWeight: 800, color: '#075985', marginBottom: '6px' }}>請確認要加入的家庭</div>
                  <div>家庭名稱：<strong>{joinPreview.family_name}</strong></div>
                  <div>目前成員數：{joinPreview.member_count} 位</div>
                  <div>
                    加入碼有效期限：
                    {joinPreview.join_code_expires_at ? new Date(joinPreview.join_code_expires_at).toLocaleString('zh-TW') : '永不自動過期'}
                  </div>
                  {joinPreview.current_family_name && <div>你目前綁定：{joinPreview.current_family_name}</div>}
                  {joinPreview.warning && (
                    <div style={{ marginTop: '8px', color: '#92400e', background: '#fdf6e3', border: '1px solid #efdfae', borderRadius: '8px', padding: '8px 10px' }}>
                      {joinPreview.warning}
                    </div>
                  )}
                  {(joinPreview.confirmation_reasons?.length || joinPreview.local_data_summary?.length) ? (
                    <div style={{ marginTop: '10px', border: '1px solid #bae6fd', background: '#fff', borderRadius: '10px', padding: '10px' }}>
                      {joinPreview.confirmation_reasons?.map((reason, idx) => (
                        <div key={`reason-${idx}`} style={{ color: '#22313f', marginBottom: '4px' }}>{reason}</div>
                      ))}
                      {joinPreview.local_data_summary?.length ? (
                        <div style={{ color: '#56687a' }}>目前帳號已有：{joinPreview.local_data_summary.join('、')}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {joinPreview.requires_confirmation && (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '10px', color: '#22313f', fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={joinConfirmed}
                        onChange={event => setJoinConfirmed(event.target.checked)}
                        style={{ marginTop: '3px' }}
                      />
                      <span>
                        我確認這是正確家庭；加入後目前登入身分會切到此家庭，原本本地資料不會自動搬移或顯示給新家庭。
                      </span>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => { setJoinPreview(null); setJoinConfirmed(false); setJoinCode(''); }}
                    style={{ marginTop: '10px', minHeight: 44, border: 'none', background: 'transparent', color: '#0369a1', fontWeight: 800, cursor: 'pointer', padding: '8px 0' }}
                  >
                    取消，重新輸入代碼
                  </button>
                </div>
              )}
              {step1Error && <div role="alert" style={errorBox}>{step1Error}</div>}
              <button type="submit" disabled={joinSubmitDisabled}
                style={{ ...btnPrimary, opacity: joinSubmitDisabled ? 0.5 : 1 }}>
                {step1Submitting ? (joinPreview ? '加入中...' : '確認中...') : (joinPreview ? '確認加入此家庭 →' : '檢查加入代碼 →')}
              </button>
            </form>
          )}

          <p style={{ fontSize: '11px', color: '#e2e8ec', textAlign: 'center', marginTop: '20px' }}>
            您的 LINE 帳號識別資訊已加密處理 · 健康紀錄與身分資料分離儲存
          </p>
        </div>
      )}

      {/* ── Step 2: add members ── */}
      {step === 2 && (
        <div style={{ ...cardStyle, maxWidth: '540px' }}>
          {/* Progress */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '28px' }}>
            <div aria-hidden="true" style={{ width: '24px', height: '24px', borderRadius: '12px', background: '#4caf50', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><Check size={15} strokeWidth={3} /></div>
            <div style={{ flex: 1, height: '3px', background: '#4caf50', borderRadius: '2px' }} />
            <div aria-hidden="true" style={{ width: '24px', height: '24px', borderRadius: '12px', background: '#3e6b7e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#fff', fontWeight: '700' }}>2</div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#111', marginBottom: '6px' }}>新增家庭成員</h1>
            <p style={{ fontSize: '13px', color: '#56687a', lineHeight: 1.6 }}>
              選擇常見成員類型，或自訂成員資料。這些資料用於家庭切換與顯示，正式授權與撤銷仍需另外確認。
            </p>
          </div>

          {/* Preset chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {PRESETS.map(p => {
              const selected = members.some(m => m.name === p.name);
              return (
                <button key={p.name} type="button" aria-pressed={selected} onClick={() => togglePreset(p)} style={{
                  padding: '8px 16px', borderRadius: '20px', border: `2px solid ${selected ? p.color : '#e0e0e0'}`,
                  background: selected ? '#edf5f8' : '#fff',
                  color: '#22313f', fontSize: '14px', fontWeight: selected ? '700' : '500',
                  cursor: 'pointer', transition: 'all 0.15s', minHeight: 44,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  {selected ? <Check aria-hidden="true" size={16} strokeWidth={3} /> : null}{p.name}
                </button>
              );
            })}
            <button type="button" onClick={() => setShowCustomForm(v => !v)} style={{
              padding: '8px 16px', borderRadius: '20px', border: '2px dashed #bbb',
              background: '#fafafa', color: '#56687a', fontSize: '14px', cursor: 'pointer', minHeight: 44,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <Plus aria-hidden="true" size={16} />自訂
            </button>
          </div>

          {/* Custom member form */}
          {showCustomForm && (
            <form onSubmit={addCustom} style={{ background: '#f8f9fa', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <label htmlFor="custom-member-name" style={{ fontSize: '12px', fontWeight: '600', color: '#555', display: 'block', marginBottom: '4px' }}>稱謂</label>
                  <input id="custom-member-name" type="text" placeholder="例：阿嬤" value={customMember.name}
                    onChange={e => setCustomMember(m => ({ ...m, name: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} required />
                </div>
                <div>
                  <label htmlFor="custom-member-relation" style={{ fontSize: '12px', fontWeight: '600', color: '#555', display: 'block', marginBottom: '4px' }}>關係</label>
                  <input id="custom-member-relation" type="text" placeholder="例：祖母" value={customMember.relation}
                    onChange={e => setCustomMember(m => ({ ...m, relation: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} required />
                </div>
                <div>
                  <label htmlFor="custom-member-age" style={{ fontSize: '12px', fontWeight: '600', color: '#555', display: 'block', marginBottom: '4px' }}>年齡</label>
                  <input id="custom-member-age" type="number" placeholder="65" min="0" max="120" value={customMember.age}
                    onChange={e => setCustomMember(m => ({ ...m, age: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label htmlFor="custom-member-gender" style={{ fontSize: '12px', fontWeight: '600', color: '#555', display: 'block', marginBottom: '4px' }}>性別</label>
                  <select id="custom-member-gender" value={customMember.gender} onChange={e => setCustomMember(m => ({ ...m, gender: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', background: '#fff', boxSizing: 'border-box' }}>
                    <option value="男">男</option>
                    <option value="女">女</option>
                  </select>
                </div>
              </div>
              <fieldset style={{ margin: '0 0 10px', padding: 0, border: 0 }}>
                <legend style={{ fontSize: '12px', fontWeight: '600', color: '#555', marginBottom: '6px' }}>成員識別顏色</legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {COLORS.map(({ value, label }) => {
                    const selected = customMember.color === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-label={`選擇${label}`}
                        aria-pressed={selected}
                        onClick={() => setCustomMember(m => ({ ...m, color: value }))}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 22,
                          background: value,
                          cursor: 'pointer',
                          border: selected ? '3px solid #22313f' : '3px solid transparent',
                          boxShadow: selected ? '0 0 0 2px #fff, 0 0 0 4px #22313f' : '0 0 0 1px rgba(34,49,63,0.3)',
                          color: '#111',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                        }}
                      >
                        {selected ? <Check aria-hidden="true" size={20} strokeWidth={3} /> : null}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" style={{ minHeight: 44, padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#3e6b7e', color: '#fff', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>新增</button>
                <button type="button" onClick={() => setShowCustomForm(false)} style={{ minHeight: 44, padding: '8px 16px', borderRadius: '8px', border: '1px solid #ddd', background: '#fff', color: '#666', cursor: 'pointer', fontSize: '13px' }}>取消</button>
              </div>
            </form>
          )}

          {/* Selected members preview */}
          {members.length > 0 && (
            <div style={{ background: '#f0f7ff', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: '#666', fontWeight: '600', marginBottom: '8px' }}>已選擇 {members.length} 位成員：</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {members.map((m, i) => (
                  <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '4px 10px', borderRadius: '16px',
                    background: '#edf5f8', border: `2px solid ${m.color}`, color: '#22313f', fontSize: '13px', fontWeight: '600',
                  }}>
                    {m.name}
                    <button
                      type="button"
                      aria-label={`移除${m.name}`}
                      onClick={() => setMembers(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ width: 44, height: 44, margin: '-10px -10px -10px 0', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {finishError && (
            <div role="alert" style={{
              background: '#faecea',
              border: '1px solid #fecdd3',
              borderRadius: '10px',
              color: '#a03a30',
              fontSize: '13px',
              fontWeight: 700,
              lineHeight: 1.5,
              marginBottom: '14px',
              padding: '10px 12px',
            }}>
              {finishError}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
            <button
              onClick={handleFinish} disabled={saving || cancelingCreate}
              style={{ ...btnPrimary, opacity: saving || cancelingCreate ? 0.7 : 1, cursor: saving || cancelingCreate ? 'not-allowed' : 'pointer' }}
            >
              {saving ? '儲存中...' : members.length > 0 ? `完成並進入 →` : '跳過，直接進入 →'}
            </button>
            <button
              type="button"
              onClick={() => void cancelCreatedFamily()}
              disabled={saving || cancelingCreate}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid #c8d4dc',
                background: '#fff',
                color: '#45596a',
                fontSize: '14px',
                fontWeight: 800,
                cursor: saving || cancelingCreate ? 'not-allowed' : 'pointer',
                opacity: saving || cancelingCreate ? 0.65 : 1,
              }}
            >
              {cancelingCreate ? '撤銷中...' : '取消新家庭，重新輸入加入代碼'}
            </button>
          </div>

          <p style={{ fontSize: '12px', color: '#64727d', textAlign: 'center', marginTop: '16px' }}>
            成員資料可隨時在「設定」頁面修改
          </p>
        </div>
      )}
    </main>
  );
}
