'use client';

// 限時唯讀急診資訊。檢視者需先留下姓名與院所，且每次存取都會記錄。

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Activity, ClipboardList, FileText, Images, Pill, ShieldAlert } from 'lucide-react';

type RZItem = {
  id: string; label: string; value: string; tier: 1 | 2 | 3;
  category: string; status: string; source: string;
  is_verified: boolean; last_reviewed_at: string | null;
};
type Board = {
  patient: { name: string; age: number | null; sex: string | null };
  generated_at: string;
  access: {
    scope: string;
    expires_at: string;
    accessed_by: string;
    accessor_org: string | null;
    read_only: boolean;
  };
  red_zone: {
    tiers: { tier1: RZItem[]; tier2: RZItem[]; tier3: RZItem[] };
    copy: { emergency_summary: string; all_active: string; disabled_reason: string | null };
  };
  medications: Array<{ drug_name: string; dose: string | null; frequency: string | null; is_verified: boolean }>;
  problems: Array<{ name: string; layman: string | null; status: string; tier: number; is_verified: boolean }>;
  vitals: Array<{ type: string; value1: string | null; value2: string | null; unit: string | null; recorded_at: string | null }>;
  evidence_documents: Array<{
    id: string;
    file_name: string;
    doc_type: string;
    doc_date: string | null;
    status: string;
    is_verified: boolean;
    linked_to_verified_data: boolean;
    download_url: string;
  }>;
  dicom_links: Array<{
    share_id: string;
    share_type: string;
    viewer_url: string;
    expires_at: string | null;
    study_description: string | null;
    study_date: string | null;
    modality: string | null;
    series_description: string | null;
  }>;
  his_copy_text: string;
  disclaimer: string;
  accessed_by: string;
};

const VLABEL: Record<string, string> = {
  blood_pressure: '血壓', heart_rate: '心率', glucose: '血糖', weight: '體重',
  spo2: '血氧', temperature: '體溫', hba1c: 'HbA1c', bmi: 'BMI', steps: '步數', sleep: '睡眠',
};

function fmt(d: string | null): string {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d.slice(0, 10) : t.toLocaleDateString('zh-TW');
}

function VerifyBadge({ ok }: { ok: boolean }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 999,
      background: ok ? '#dcefe3' : '#fdf6e3', color: ok ? '#2e8b57' : '#a97614',
    }}>{ok ? '已確認' : '未確認'}</span>
  );
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    patient_created: '本人新增',
    patient_reported: '本人回報',
    nhi_import: '健保匯入',
    imported: '匯入資料',
    cmo_created: '醫療團隊整理',
    cmo_entry: '醫療團隊整理',
    medical_record: '醫療文件整理',
    document: '文件整理',
  };
  return labels[source] || '資料來源未標示';
}

function documentTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    lab_report: '檢驗報告', discharge_summary: '出院摘要', prescription: '處方文件',
    medical_record: '病歷文件', referral: '轉診文件', other: '其他醫療文件',
  };
  return labels[value] || '醫療文件';
}

function documentStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    uploaded: '已上傳', processing: '整理中', completed: '已整理', failed: '整理失敗',
  };
  return labels[value] || '狀態未標示';
}

function emergencyStatusMessage(status: number, action: 'info' | 'open'): string {
  if (status === 404) return '找不到此急診連結，請向家屬索取新的連結。';
  if (status === 410) return '此連結已過期或已被撤銷，請向家屬索取新的連結。';
  if (status === 429) return '目前查詢次數過多，請稍後再試。';
  if (status === 503) return '急診資料服務暫時不可用，請稍後再試。';
  return action === 'info' ? '無法確認此急診連結狀態。' : '無法載入資料，請確認連結是否有效。';
}

type RecoverableHttpError = Error & { retryable?: boolean; retryAfter?: number | null };

function emergencyHttpError(response: Response, action: 'info' | 'open'): RecoverableHttpError {
  const rawRetryAfter = response.headers.get('retry-after');
  const parsedRetryAfter = rawRetryAfter ? Number.parseInt(rawRetryAfter, 10) : Number.NaN;
  const retryAfter = Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0 ? parsedRetryAfter : null;
  const suffix = response.status === 429 && retryAfter ? ` 約 ${retryAfter} 秒後可重試。` : '';
  const error = new Error(`${emergencyStatusMessage(response.status, action)}${suffix}`) as RecoverableHttpError;
  error.retryable = [429, 502, 503].includes(response.status);
  error.retryAfter = retryAfter;
  return error;
}

export default function EmergencyBoardPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<{ patient_label: string; expires_at: string; requires_break_glass?: boolean } | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [phase, setPhase] = useState<'loading' | 'gate' | 'board' | 'error'>('loading');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');


  useEffect(() => {
    if (!token) return;
    fetch(`/api/emergency/${token}/info`)
      .then(r => { if (!r.ok) throw emergencyHttpError(r, 'info'); return r.json(); })
      .then(d => { setInfo(d); setPhase('gate'); })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '無法載入急診連結');
        setRetryable(e instanceof TypeError || Boolean((e as RecoverableHttpError)?.retryable));
        setRetryAfter((e as RecoverableHttpError)?.retryAfter ?? null);
        setPhase('error');
      });
  }, [token]);

  const open = useCallback(async () => {
    if (!name.trim()) { setError('請輸入您的姓名'); return; }
    setOpening(true); setError('');
    try {
      const r = await fetch(`/api/emergency/${token}/open`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessor_name: name.trim(), accessor_org: org.trim() }),
      });
      if (!r.ok) throw emergencyHttpError(r, 'open');
      setBoard(await r.json()); setPhase('board');
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗');
      setRetryable(e instanceof TypeError || Boolean((e as RecoverableHttpError)?.retryable));
      setRetryAfter((e as RecoverableHttpError)?.retryAfter ?? null);
    }
    finally { setOpening(false); }
  }, [name, org, token]);

  const copySummary = async () => {
    const text = board?.his_copy_text || board?.red_zone.copy.emergency_summary || board?.red_zone.copy.all_active || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const downloadSummary = () => {
    if (!board?.his_copy_text) return;
    const blob = new Blob([board.his_copy_text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `HealthKeep-emergency-${token}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const documentUrl = (url: string) => {
    const qp = new URLSearchParams();
    if (board?.accessed_by) qp.set('accessor_name', board.accessed_by);
    let base = url;
    if (typeof window !== 'undefined') {
      try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.pathname.startsWith('/emergency/')) {
          base = `${window.location.origin}${parsed.pathname}`;
        } else if (parsed.origin === window.location.origin) {
          base = `${parsed.pathname}${parsed.search}`;
        }
      } catch {
        base = url;
      }
    }
    return `${base}${qp.toString() ? `?${qp.toString()}` : ''}`;
  };

  if (phase === 'loading') return <Centered><h1 style={stateHeading}>正在載入急診資料</h1></Centered>;
  if (phase === 'error') return <Centered><ShieldAlert aria-hidden="true" size={40} color="#a03a30" /><h1 style={stateHeading}>急診連結無法開啟</h1><div role="alert" style={{ marginTop: 8, fontWeight: 700 }}>{error}</div><div style={{ color: '#6b7c8c', fontSize: 13, marginTop: 6 }}>{retryable ? (retryAfter ? `服務稍後可恢復，建議 ${retryAfter} 秒後重新檢查。` : '服務稍後可恢復，請重新檢查。') : '請向家屬索取新的連結。'}</div>{retryable && <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 14, ...linkBtn }}>重新檢查連結</button>}</Centered>;

  // ── Break-glass gate ──────────────────────────────────────────────────────
  if (phase === 'gate') {
    return (
      <Centered>
        <form onSubmit={(event) => { event.preventDefault(); void open(); }} style={{ width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #e3e9ee', borderRadius: 16, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.06)', textAlign: 'left' }}>
          <div style={{ fontSize: 13, color: '#a03a30', fontWeight: 800 }}>HealthKeep · 急診保命資料</div>
          <h1 style={{ fontSize: 20, fontWeight: 850, margin: '6px 0 2px', color: '#22313f' }}>{info?.patient_label}</h1>
          <div style={{ fontSize: 12, color: '#6b7c8c' }}>連結有效至 {info ? new Date(info.expires_at).toLocaleString('zh-TW') : ''}</div>
          <div style={{ background: '#fdf1e0', border: '1px solid #fed7aa', color: '#b06a10', borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 1.6, margin: '14px 0' }}>
            為保護病人隱私，檢視前請留下您的身分。<strong>每次存取都會記錄</strong>並讓家屬看到。收件者身分由您自行填寫，未經 HealthKeep 身分驗證。
          </div>
          <label htmlFor="emergency-accessor-name" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#45596a', marginBottom: 4 }}>您的姓名（必填）</label>
          <input id="emergency-accessor-name" value={name} onChange={e => setName(e.target.value)} placeholder="例：王醫師" required autoComplete="name" aria-describedby={error ? 'emergency-gate-error' : undefined}
            style={inp} />
          <label htmlFor="emergency-accessor-org" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#45596a', margin: '12px 0 4px' }}>院所或科別（選填）</label>
          <input id="emergency-accessor-org" value={org} onChange={e => setOrg(e.target.value)} placeholder="例：台大急診" autoComplete="organization"
            style={inp} />
          {error && <div id="emergency-gate-error" role="alert" style={{ color: '#a03a30', fontSize: 13, marginTop: 10 }}>{error}</div>}
          <button type="submit" disabled={opening}
            style={{ width: '100%', marginTop: 16, background: '#a03a30', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 850, fontSize: 15, cursor: 'pointer' }}>
            {opening ? '載入中…' : '檢視保命資料'}
          </button>
        </form>
      </Centered>
    );
  }

  const b = board!;
  const t1 = b.red_zone.tiers.tier1, t2 = b.red_zone.tiers.tier2;
  return (
    <main style={{ minHeight: '100vh', background: '#eef2f5' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '14px 14px 60px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', padding: '6px 2px 12px' }}>
          <div>
            <div style={{ fontSize: 12, color: '#a03a30', fontWeight: 800 }}>HealthKeep · 急診資訊</div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: '#22313f', margin: 0 }}>
              {b.patient.name} <span style={{ fontSize: 14, fontWeight: 600, color: '#56687a' }}>· {b.patient.age ? `${b.patient.age} 歲` : '年齡未記錄'}／{b.patient.sex ?? '性別未記錄'}</span>
            </h1>
            <div style={{ fontSize: 11, color: '#93a3af' }}>
              產生於 {new Date(b.generated_at).toLocaleString('zh-TW')} · 檢視者 {b.accessed_by}
              {b.access.accessor_org ? ` / ${b.access.accessor_org}` : ''} · 有效至 {new Date(b.access.expires_at).toLocaleString('zh-TW')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ alignSelf: 'center', fontSize: 11, fontWeight: 850, padding: '4px 9px', borderRadius: 999, background: '#e0f2fe', color: '#0369a1' }}>唯讀</span>
            <button type="button" onClick={copySummary} style={{ background: '#22313f', color: '#fff', border: 'none', borderRadius: 10, minHeight: 44, padding: '10px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>複製病歷摘要</button>
            <button type="button" onClick={downloadSummary} style={{ background: '#fff', color: '#22313f', border: '1px solid #c8d4dc', borderRadius: 10, minHeight: 44, padding: '10px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>下載文字摘要</button>
          </div>
        </div>
        {copyState !== 'idle' && <div role={copyState === 'failed' ? 'alert' : 'status'} aria-live="polite" style={{ background: copyState === 'copied' ? '#e7f4ec' : '#faecea', color: copyState === 'copied' ? '#2e8b57' : '#a03a30', border: `1px solid ${copyState === 'copied' ? '#cfe8da' : '#f2d3cf'}`, borderRadius: 10, padding: '9px 12px', marginBottom: 12, fontSize: 13, fontWeight: 800 }}>{copyState === 'copied' ? '急診摘要已複製，可貼入病歷系統。' : '無法自動複製，請下載文字摘要。'}</div>}

        <Section title="立即注意事項" tone="#a03a30" icon={<ShieldAlert size={18} aria-hidden="true" />}>
          {t1.length === 0 ? <Empty>目前沒有已整理的立即注意事項</Empty> : t1.map(it => <RZRow key={it.id} it={it} />)}
        </Section>

        <Section title="目前用藥" tone="#33596a" icon={<Pill size={18} aria-hidden="true" />}>
          {b.medications.length === 0 ? <Empty>沒有已確認為目前使用的藥物</Empty> : b.medications.map((m, i) => (
            <div key={i} style={row}>
              <div><strong style={{ color: '#22313f' }}>{m.drug_name}</strong> <span style={{ color: '#56687a', fontSize: 13 }}>{[m.dose, m.frequency].filter(Boolean).join(' · ')}</span></div>
              <VerifyBadge ok={m.is_verified} />
            </div>
          ))}
        </Section>

        <Section title="其他重要背景" tone="#a97614" icon={<ClipboardList size={18} aria-hidden="true" />}>
          {t2.length === 0 ? <Empty>目前沒有其他已整理的重要背景</Empty> : t2.map(it => <RZRow key={it.id} it={it} />)}
        </Section>

        <Section title="重要病史" tone="#3e6b7e" icon={<ClipboardList size={18} aria-hidden="true" />}>
          {b.problems.length === 0 ? <Empty>沒有醫療團隊已發布的重要病史</Empty> : b.problems.map((p, i) => (
            <div key={i} style={row}>
              <div><strong style={{ color: '#22313f' }}>{p.name}</strong>{p.layman ? <span style={{ color: '#6b7c8c', fontSize: 12 }}> · {p.layman}</span> : ''}</div>
              <VerifyBadge ok={p.is_verified} />
            </div>
          ))}
        </Section>

        <Section title="最新量測" tone="#3e6b7e" icon={<Activity size={18} aria-hidden="true" />}>
          {b.vitals.length === 0 ? <Empty>無量測紀錄</Empty> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {b.vitals.map((v, i) => (
                <div key={i} style={{ background: '#f6f9fa', border: '1px solid #e3e9ee', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#6b7c8c', fontWeight: 700 }}>{VLABEL[v.type] ?? '其他量測'}</div>
                  <div style={{ fontSize: 17, fontWeight: 850, color: '#22313f' }}>
                    {v.type === 'blood_pressure' && v.value2 ? `${v.value1}/${v.value2}` : v.value1}<span style={{ fontSize: 11, color: '#93a3af', fontWeight: 600 }}> {v.unit ?? ''}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#93a3af' }}>{fmt(v.recorded_at)}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="原始文件" tone="#56687a" icon={<FileText size={18} aria-hidden="true" />}>
          {b.evidence_documents.length === 0 ? <Empty>此急診連結目前沒有可追溯的原始文件索引</Empty> : b.evidence_documents.map((d) => (
            <div key={d.id} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#6b7c8c', fontWeight: 700 }}>{documentTypeLabel(d.doc_type)} · {fmt(d.doc_date)}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#22313f', wordBreak: 'break-all' }}>{d.file_name}</div>
                <div style={{ fontSize: 10, color: '#93a3af' }}>{documentStatusLabel(d.status)} · {d.linked_to_verified_data ? '已連結整理資料' : '尚未連結整理資料'}</div>
              </div>
              <a href={documentUrl(d.download_url)} target="_blank" rel="noreferrer" aria-label={`查看原始文件：${d.file_name}`} style={linkBtn}>查看原檔</a>
            </div>
          ))}
        </Section>

        <Section title="醫療影像" tone="#56687a" icon={<Images size={18} aria-hidden="true" />}>
          {b.dicom_links.length === 0 ? <Empty>此急診連結目前沒有已開放的醫療影像</Empty> : b.dicom_links.map((d) => (
            <div key={d.share_id} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#6b7c8c', fontWeight: 700 }}>{d.modality || '影像'} · {d.study_date || '日期未記錄'}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#22313f' }}>{d.study_description || d.series_description || '醫療影像'}</div>
                <div style={{ fontSize: 10, color: '#93a3af' }}>影像連結有效至 {d.expires_at ? new Date(d.expires_at).toLocaleString('zh-TW') : '未記錄'}</div>
              </div>
              <a href={documentUrl(d.viewer_url)} target="_blank" rel="noreferrer" aria-label={`查看醫療影像：${d.study_description || d.series_description || '未命名影像'}`} style={linkBtn}>查看影像</a>
            </div>
          ))}
        </Section>

        <div style={{ fontSize: 11, color: '#93a3af', lineHeight: 1.7, marginTop: 14 }}>{b.disclaimer}</div>
      </div>
    </main>
  );
}

function RZRow({ it }: { it: RZItem }) {
  return (
    <div style={row}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#6b7c8c', fontWeight: 700 }}>{it.label}</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#22313f', lineHeight: 1.35 }}>{it.value}</div>
        <div style={{ fontSize: 10, color: '#93a3af' }}>來源：{sourceLabel(it.source)} · 最後整理 {fmt(it.last_reviewed_at)}</div>
      </div>
      <VerifyBadge ok={it.is_verified} />
    </div>
  );
}

function Section({ title, tone, icon, children }: { title: string; tone: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: '1px solid #e3e9ee', borderLeft: `4px solid ${tone}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 850, color: tone, margin: '0 0 8px' }}>{icon}{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#93a3af', fontSize: 13, padding: '4px 0' }}>{children}</div>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', textAlign: 'center', background: '#eef2f5', padding: 20 }}>{children}</main>;
}

const inp: React.CSSProperties = { width: '100%', border: '1px solid #c8d4dc', borderRadius: 10, padding: '10px 12px', fontSize: 15 };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #eef2f5' };
const linkBtn: React.CSSProperties = { border: '1px solid #c8d4dc', background: '#fff', color: '#22313f', borderRadius: 8, padding: '7px 10px', fontWeight: 800, fontSize: 12, textDecoration: 'none', flexShrink: 0 };
const stateHeading: React.CSSProperties = { margin: '12px 0 0', fontSize: 20, color: '#22313f' };
