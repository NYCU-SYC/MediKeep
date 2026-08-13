'use client';

// 病人/家屬端：產生「急診保命連結」交給現場醫師，並查看誰存取過、隨時撤銷。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { ApiError, api } from '@/lib/api';
import { useToast } from '../toast-context';
import { useActiveMember } from '../member-context';
import { memberHref } from '@/lib/members';
import { ConfirmDialog } from '../_components/Shared';
import { Icon } from '../_components/Icon';
import RedZonePage from '../redzone/page';

type Link = {
  id: string; token: string; url: string; label: string | null; family_member_id?: string | null;
  scope: string;
  expires_at: string | null; revoked_at: string | null; active: boolean;
  access_count: number; last_accessed_at: string | null; created_at: string | null;
};
type Readiness = {
  member: { id: string; name: string; relation?: string | null };
  counts: { red_zone?: number; medications?: number; problems?: number; vitals?: number; documents?: number; imaging?: number; core_total?: number; available_total?: number; total?: number };
  warnings?: Array<{ code?: string; message?: string }>;
  can_write: boolean;
  creatable: boolean;
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
    <Image
      src={qrState.dataUrl}
      width={220}
      height={220}
      alt="急診連結 QR Code"
      unoptimized
      style={{ display: 'block', background: '#fff', borderRadius: 8, maxWidth: '100%', height: 'auto' }}
    />
  );
}

function scopeLabel(scope: string): string {
  const parts = scope.split(',').map((s) => s.trim()).filter(Boolean);
  const labels: Record<string, string> = {
    red_zone: '立即注意事項',
    problems: '重要病史',
    medications: '目前用藥',
    vitals: '最新量測',
    documents: '原始文件',
    dicom: 'DICOM 影像',
  };
  return parts.map((part) => labels[part] ?? '其他資料').join('、');
}

const RELATION_LABELS: Record<string, string> = {
  self: '本人',
  patient: '本人',
  owner: '家庭管理者',
  family_owner: '家庭管理者',
  family_manager: '家庭管理者',
  cmo: '醫療團隊',
  cmo_admin: '醫療團隊',
  medical_team: '醫療團隊',
  father: '父親',
  mother: '母親',
  parent: '父母',
  spouse: '配偶',
  son: '兒子',
  daughter: '女兒',
  child: '子女',
  brother: '兄弟',
  sister: '姊妹',
  sibling: '兄弟姊妹',
  grandparent: '祖父母',
};

function memberRelationLabel(value?: string | null): string {
  const display = String(value ?? '').trim();
  if (!display) return '';
  const key = display.toLocaleLowerCase().replace(/[\s-]+/g, '_');
  if (RELATION_LABELS[key]) return RELATION_LABELS[key];
  return /[\u3400-\u9fff]/u.test(display) ? display : '家庭成員';
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

function EmergencyLinksView() {
  const router = useRouter();
  const { showToast } = useToast();
  const { activeMember, members, setActiveMember } = useActiveMember();
  const [links, setLinks] = useState<Link[]>([]);
  const [accesses, setAccesses] = useState<Access[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [ttlHours, setTtlHours] = useState(24);
  const [incDocs, setIncDocs] = useState(false);
  const [incImaging, setIncImaging] = useState(false);
  const [newLinkId, setNewLinkId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [hasLinkSnapshot, setHasLinkSnapshot] = useState(false);
  const linkSnapshotRef = useRef(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState('');
  const [readinessRetry, setReadinessRetry] = useState(0);
  const [pendingRevoke, setPendingRevoke] = useState<Link | null>(null);
  const [pendingAdvancedScope, setPendingAdvancedScope] = useState<'documents' | 'imaging' | null>(null);
  const readinessMemberRef = useRef<string | null>(null);

  const selectedMember = members.find((member) => member.name === activeMember)
    ?? (members.length === 1 ? members[0] : null);
  const selectedMemberRelation = memberRelationLabel(selectedMember?.relation);
  const coreDataCount = readiness?.counts.core_total
    ?? (readiness ? ['red_zone', 'medications', 'problems', 'vitals'].reduce((sum, key) => sum + (readiness.counts[key as keyof Readiness['counts']] ?? 0), 0) : 0);
  const availableDataCount = readiness?.counts.available_total ?? readiness?.counts.total ?? 0;
  const selectedDataCount = coreDataCount
    + (incDocs ? (readiness?.counts.documents ?? 0) : 0)
    + (incImaging ? (readiness?.counts.imaging ?? 0) : 0);
  const canCreate = Boolean(readiness?.can_write && selectedDataCount > 0);

  const load = useCallback(async () => {
    if (!linkSnapshotRef.current) setLoading(true);
    setLoadError(false);
    try {
      const d = await api.get('/api/patients/me/emergency-links') as { links: Link[]; accesses: Access[] };
      setLinks(d.links ?? []);
      setAccesses(d.accesses ?? []);
      linkSnapshotRef.current = true;
      setHasLinkSnapshot(true);
    } catch { setLoadError(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setIncDocs(false);
    setIncImaging(false);
  }, [selectedMember?.id]);

  useEffect(() => {
    if (!selectedMember?.id) {
      setReadiness(null);
      readinessMemberRef.current = null;
      setReadinessError('');
      return;
    }
    let alive = true;
    if (readinessMemberRef.current !== selectedMember.id) {
      setReadiness(null);
      readinessMemberRef.current = null;
    }
    setReadinessLoading(true);
    setReadinessError('');
    api.get('/api/patients/me/emergency-readiness', { member_id: selectedMember.id })
      .then((data) => {
        if (!alive) return;
        setReadiness(data as Readiness);
        readinessMemberRef.current = selectedMember.id;
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const status = error instanceof ApiError ? error.status : 0;
        if (readinessMemberRef.current !== selectedMember.id) setReadiness(null);
        const retryHint = error instanceof ApiError && error.retryAfter ? `，約 ${error.retryAfter} 秒後可重試` : '';
        setReadinessError(status === 404 ? '找不到指定成員，請重新整理家庭成員清單。'
          : status === 409 ? '此成員的資料無法安全對應，請先修正重複或不明的成員名稱。'
          : status === 429 ? `急救資料目前查詢次數過多${retryHint}。`
          : status === 503 ? '急救資料服務暫時不可用，請稍後重試。'
          : '無法取得此成員的急救資料準備狀態。');
      })
      .finally(() => { if (alive) setReadinessLoading(false); });
    return () => { alive = false; };
  }, [readinessRetry, selectedMember?.id]);

  const create = async () => {
    if (!selectedMember || !canCreate) return;
    setBusy(true);
    try {
      const created = await api.post('/api/patients/me/emergency-links', {
        ttl_hours: ttlHours,
        member_id: selectedMember.id,
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
      const retryHint = err instanceof ApiError && err.retryAfter ? `（約 ${err.retryAfter} 秒後可重試）` : '';
      if (err instanceof ApiError && err.status === 409 && err.details && typeof err.details === 'object') {
        const details = err.details as { readiness?: Readiness };
        if (details.readiness) setReadiness(details.readiness);
      }
      showToast(`產生失敗：${message}${retryHint}`, 'error');
    }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!pendingRevoke) return;
    const id = pendingRevoke.id;
    setPendingRevoke(null);
    try { await api.delete(`/api/patients/me/emergency-links/${id}`); await load(); showToast('連結已撤銷，立即停止分享', 'success'); }
    catch { showToast('撤銷失敗，原連結仍然有效', 'error'); }
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
    setPendingAdvancedScope(kind);
  };

  const confirmAdvancedScope = () => {
    if (pendingAdvancedScope === 'documents') setIncDocs(true);
    if (pendingAdvancedScope === 'imaging') setIncImaging(true);
    setPendingAdvancedScope(null);
  };

  const active = links.filter(l => l.active);
  const inactive = links.filter(l => !l.active);

  return (
    <div className="page-wrap" style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>
      <button onClick={() => router.push(memberHref('/dashboard/health', activeMember))} aria-label="返回健康" style={back}>← 返回健康</button>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: '#22313f', margin: '8px 0 2px' }}>急診資訊</h1>
      <p style={{ color: '#6b7c8c', fontSize: 14, lineHeight: 1.7, margin: '0 0 16px' }}>
        預設只開放立即注意事項、重要病史、目前用藥與最新量測。醫療人員輸入姓名後才可檢視；
        <strong>每次存取都會記錄</strong>，你也可以隨時撤銷。只有在現場醫師明確需要時，才加開原始文件或影像。
      </p>
      <button type="button" onClick={() => void load()} disabled={loading} style={{ ...smallBtn, minHeight: 44, marginBottom: 14 }}>
        {loading && !hasLinkSnapshot ? '載入中…' : '重新整理連結'}
      </button>

      <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: '#f6fbfc', borderColor: '#cfe3e8' }}>
        <div>
          <strong style={{ color: '#22313f' }}>先確認急診資料是否完整</strong>
          <div style={{ color: '#6b7c8c', fontSize: 13, marginTop: 3 }}>查看立即注意事項、目前用藥、重要病史與醫療確認狀態。</div>
        </div>
        <button type="button" onClick={() => router.push(memberHref('/dashboard/emergency?view=important', selectedMember?.name ?? activeMember))} style={{ ...smallBtn, minHeight: 44 }}>查看急診資料</button>
      </div>

      <section style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#22313f', marginBottom: 8 }}>產生新連結</div>
        <div style={{ border: '1px solid #cfe3e8', background: '#f6fbfc', borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 850, color: '#45596a', marginBottom: 8 }}>選擇要分享的成員</div>
          {members.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6b7c8c' }}>尚未載入家庭成員，請先到家庭設定新增成員。</div>
          ) : (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {members.map((member) => {
                const relation = memberRelationLabel(member.relation);
                return (
                  <button key={member.id} type="button" aria-pressed={selectedMember?.id === member.id} onClick={() => setActiveMember(member.name)} style={{ padding: '7px 12px', borderRadius: 999, border: `1px solid ${selectedMember?.id === member.id ? member.color : '#c8d4dc'}`, background: selectedMember?.id === member.id ? member.color : '#fff', color: selectedMember?.id === member.id ? '#fff' : '#45596a', fontWeight: 800, cursor: 'pointer' }}>
                    {member.name}{relation ? ` · ${relation}` : ''}
                  </button>
                );
              })}
            </div>
          )}
          {selectedMember && <div style={{ fontSize: 13, color: '#22313f', fontWeight: 800, marginTop: 10 }}>目前指定：{selectedMember.name}{selectedMemberRelation ? `（${selectedMemberRelation}）` : ''}</div>}
          {readinessLoading && <div role="status" style={{ color: '#6b7c8c', fontSize: 12, marginTop: 8 }}>正在確認此成員的急救資料…</div>}
          {readinessError && <div role="alert" style={{ color: '#a03a30', fontSize: 12, lineHeight: 1.6, marginTop: 8 }}>{readinessError}<button type="button" onClick={() => setReadinessRetry((value) => value + 1)} style={{ ...smallBtn, marginLeft: 8 }}>重試</button></div>}
          {readiness && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: 7, marginTop: 10 }}>
                {([['red_zone', '立即注意'], ['problems', '重要病史'], ['medications', '目前用藥'], ['vitals', '最新量測'], ['documents', '文件'], ['imaging', '影像']] as const).map(([key, label]) => <div key={key} style={{ border: '1px solid #e3e9ee', borderRadius: 8, padding: '7px 8px', background: '#fff' }}><div style={{ fontSize: 11, color: '#6b7c8c' }}>{label}</div><strong style={{ fontSize: 17, color: '#22313f' }}>{readiness.counts[key] ?? 0}</strong></div>)}
              </div>
              {!readiness.can_write && <div role="alert" style={{ marginTop: 10, color: '#a03a30', fontSize: 12, lineHeight: 1.6 }}>目前登入身分只能閱讀此成員資料，無法替此成員建立急救連結。</div>}
              {readiness.can_write && availableDataCount === 0 && <div role="alert" style={{ marginTop: 10, color: '#a03a30', fontSize: 12, lineHeight: 1.6 }}>此成員目前沒有可供急救分享的實質醫療資料，建立按鈕已停用。請先補充健康資料。</div>}
              {readiness.can_write && availableDataCount > 0 && selectedDataCount === 0 && <div role="alert" style={{ marginTop: 10, color: '#a97614', fontSize: 12, lineHeight: 1.6 }}>預設急救範圍目前沒有資料。若要分享現有文件或影像，請在下方明確勾選對應範圍。</div>}
              {readiness.warnings?.map((warning) => <div key={warning.code ?? warning.message} style={{ marginTop: 5, color: '#a97614', fontSize: 12 }}>{warning.message}</div>)}
              {readiness.can_write && availableDataCount === 0 && <button type="button" onClick={() => router.push(memberHref('/dashboard/health', selectedMember?.name ?? ''))} style={{ marginTop: 9, padding: '8px 12px', borderRadius: 8, border: '1px solid #cfe3e8', background: '#fff', color: '#3e6b7e', fontWeight: 800, cursor: 'pointer' }}>前往補充此成員資料</button>}
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 5, flex: '1 1 200px', color: '#45596a', fontSize: 12, fontWeight: 800 }}>連結備註（選填）
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="例如：給台大急診"
            style={{ minWidth: 0, minHeight: 44, border: '1px solid #c8d4dc', borderRadius: 10, padding: '10px 12px', fontSize: 14 }} />
          </label>
          <label style={{ display: 'grid', gap: 5, color: '#45596a', fontSize: 12, fontWeight: 800 }}>有效時間
          <select value={ttlHours} onChange={e => setTtlHours(Number(e.target.value))}
            style={{ minHeight: 44, border: '1px solid #c8d4dc', borderRadius: 10, padding: '10px 12px', fontSize: 14, background: '#fff', color: '#45596a', fontWeight: 700 }}>
            <option value={1}>1 小時</option>
            <option value={6}>6 小時</option>
            <option value={24}>24 小時</option>
            <option value={72}>72 小時</option>
          </select>
          </label>
          <button onClick={create} disabled={busy || !selectedMember || !canCreate || readinessLoading}
            title={!canCreate && readiness ? '目前選取的分享範圍沒有可分享資料，或您沒有此成員的寫入權限。' : undefined}
            style={{ background: '#a03a30', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 850, fontSize: 14, cursor: busy || !selectedMember || !canCreate || readinessLoading ? 'not-allowed' : 'pointer', opacity: busy || !selectedMember || !canCreate || readinessLoading ? 0.55 : 1 }}>
            {busy ? '產生中…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="file" size={18} />產生連結</span>}
          </button>
        </div>
        <div style={{ background: '#f6f9fa', border: '1px solid #e3e9ee', borderRadius: 12, padding: 12, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 850, color: '#45596a', marginBottom: 8 }}>進階開放範圍（預設關閉）</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#45596a' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={incDocs} disabled={!readiness?.can_write || (readiness.counts.documents ?? 0) === 0} onChange={e => toggleAdvancedScope('documents', e.target.checked)} />
              一併開放原始文件（檢驗 / 出院摘要等）
              {readiness && (readiness.counts.documents ?? 0) === 0 ? '（目前無資料）' : ''}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={incImaging} disabled={!readiness?.can_write || (readiness.counts.imaging ?? 0) === 0} onChange={e => toggleAdvancedScope('imaging', e.target.checked)} />
              一併開放影像（DICOM）連結
              {readiness && (readiness.counts.imaging ?? 0) === 0 ? '（目前無資料）' : ''}
            </label>
          </div>
          <div style={{ fontSize: 12, color: '#6b7c8c', marginTop: 8, lineHeight: 1.6 }}>
            加開後，持有連結的人可在有效期限內查看更多原始資料。請只在現場醫療人員需要核對來源時使用。
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#93a3af', marginTop: 10, lineHeight: 1.6 }}>
          產生後會顯示可掃描 QR Code。HealthKeep 直接在本頁產生 QR，不會把急診連結送到第三方 QR 服務。
          若目前是在 127.0.0.1 或 localhost 預覽，系統會先提醒你改用公開網址，避免產生手機無法開啟的 QR。
        </div>
      </section>

      {loading && !hasLinkSnapshot ? <div style={{ color: '#6b7c8c', padding: 16 }}>載入中…</div> : loadError && !hasLinkSnapshot ? (
        <div role="alert" style={{ ...card, color: '#a03a30' }}>急救連結載入失敗，請重試。 <button type="button" onClick={() => void load()} style={{ ...smallBtn, marginLeft: 8 }}>重新載入</button></div>
      ) : (
        <>
          {loadError && <div role="alert" style={{ ...card, color: '#a03a30', borderColor: '#f2d3cf' }}>急診分享目前無法更新；以下保留上次成功載入的連結與存取紀錄。 <button type="button" onClick={() => void load()} style={{ ...smallBtn, marginLeft: 8 }}>重新載入</button></div>}
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
                 <button onClick={() => setPendingRevoke(l)} style={{ ...smallBtn, minHeight: 44, color: '#a03a30', borderColor: '#f2d3cf' }}>撤銷</button>
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
                      目前網址只可在這台裝置使用，請改用手機可開啟的網址後重新產生。
                    </div>
                  )}
                </div>
              </div>
            </div>
          )})}

          <h2 style={h2}>誰看過保命資料</h2>
          <p style={{ color: '#6b7c8c', fontSize: 12, lineHeight: 1.6, margin: '-3px 0 8px' }}>姓名與院所由收件者自行填寫，HealthKeep 未驗證其醫療人員身分；請將紀錄視為存取線索，而非身分認證。</p>
          {accesses.length === 0 ? <Empty>尚無存取紀錄。收件者開啟連結後會出現在這裡。</Empty> : (
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
      <ConfirmDialog
        open={Boolean(pendingRevoke)}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => void revoke()}
        title="撤銷這個急診連結？"
        description={`撤銷後「${pendingRevoke?.label || '急診連結'}」會立即失效，已收到連結的人也無法再開啟。這個動作無法復原。`}
        confirmLabel="立即撤銷"
        danger
      />
      <ConfirmDialog
        open={Boolean(pendingAdvancedScope)}
        onCancel={() => setPendingAdvancedScope(null)}
        onConfirm={confirmAdvancedScope}
        title={pendingAdvancedScope === 'documents' ? '一併開放原始文件？' : '一併開放醫療影像？'}
        description={pendingAdvancedScope === 'documents'
          ? '持有連結的人可在有效期限內查看檢驗、出院摘要等原始檔。請只在現場醫療人員需要核對來源時開放。'
          : '持有連結的人可在有效期限內查看醫療影像。請只在現場醫療人員需要核對影像時開放。'}
        confirmLabel="確認開放"
      />
    </div>
  );
}

export default function EmergencyPage() {
  const searchParams = useSearchParams();
  if (searchParams.get('view') === 'important') return <RedZonePage />;
  return <EmergencyLinksView />;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ ...card, color: '#6b7c8c', fontSize: 13 }}>{children}</div>;
}

const back: React.CSSProperties = { border: '1px solid #e3e9ee', background: '#fff', color: '#45596a', borderRadius: 10, minHeight: 44, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e9ee', borderRadius: 14, padding: 14, marginBottom: 12 };
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 850, color: '#22313f', margin: '18px 0 8px' };
const smallBtn: React.CSSProperties = { border: '1px solid #c8d4dc', background: '#fff', color: '#45596a', borderRadius: 8, padding: '6px 10px', fontWeight: 800, fontSize: 12, cursor: 'pointer', flexShrink: 0 };
const qrCard: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, background: '#fff', border: '1px solid #e3e9ee', borderRadius: 12, padding: 12, flexWrap: 'wrap' };
const qrFallback: React.CSSProperties = { width: 180, minHeight: 180, border: '1px dashed #c8d4dc', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#6b7c8c', fontSize: 12, padding: 12 };
