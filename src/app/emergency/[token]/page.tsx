'use client';

// EmergencyLink 醫師端：限時唯讀急診戰術板。
// 醫師需先留下姓名/院所（break-glass，會記錄存取），才會載入保命資料。

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

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

export default function EmergencyBoardPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<{ patient_label: string; expires_at: string; requires_break_glass?: boolean } | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [phase, setPhase] = useState<'loading' | 'gate' | 'board' | 'error'>('loading');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/emergency/${token}/info`)
      .then(r => { if (r.status === 410) throw new Error('此連結已過期或已被撤銷'); if (!r.ok) throw new Error('連結不存在或已失效'); return r.json(); })
      .then(d => { setInfo(d); setPhase('gate'); })
      .catch(e => { setError(e.message); setPhase('error'); });
  }, [token]);

  const open = useCallback(async () => {
    if (!name.trim()) { setError('請輸入您的姓名'); return; }
    setOpening(true); setError('');
    try {
      const r = await fetch(`/api/emergency/${token}/open`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessor_name: name.trim(), accessor_org: org.trim() }),
      });
      if (r.status === 410) throw new Error('此連結已過期或已被撤銷');
      if (!r.ok) throw new Error('無法載入資料，請確認連結是否有效');
      setBoard(await r.json()); setPhase('board');
    } catch (e) { setError(e instanceof Error ? e.message : '載入失敗'); }
    finally { setOpening(false); }
  }, [name, org, token]);

  const copySummary = async () => {
    const text = board?.his_copy_text || board?.red_zone.copy.emergency_summary || board?.red_zone.copy.all_active || '';
    if (!text) return;
    try { await navigator.clipboard.writeText(text); alert('已複製急診摘要，可貼入 HIS / 病歷'); } catch { /* ignore */ }
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

  if (phase === 'loading') return <Centered>載入中…</Centered>;
  if (phase === 'error') return <Centered><div style={{ fontSize: 40 }}>⚠️</div><div style={{ marginTop: 8, fontWeight: 700 }}>{error}</div><div style={{ color: '#6b7c8c', fontSize: 13, marginTop: 6 }}>請向家屬索取新的連結。</div></Centered>;

  // ── Break-glass gate ──────────────────────────────────────────────────────
  if (phase === 'gate') {
    return (
      <Centered>
        <div style={{ width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #e3e9ee', borderRadius: 16, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 13, color: '#a03a30', fontWeight: 800 }}>HealthKeep · 急診保命資料</div>
          <h1 style={{ fontSize: 20, fontWeight: 850, margin: '6px 0 2px', color: '#22313f' }}>{info?.patient_label}</h1>
          <div style={{ fontSize: 12, color: '#6b7c8c' }}>連結有效至 {info ? new Date(info.expires_at).toLocaleString('zh-TW') : ''}</div>
          <div style={{ background: '#fdf1e0', border: '1px solid #fed7aa', color: '#b06a10', borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 1.6, margin: '14px 0' }}>
            為保護病人隱私，檢視前請留下您的身分。<strong>每次存取都會記錄</strong>並讓家屬看到。
          </div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#45596a', marginBottom: 4 }}>您的姓名 *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例：王醫師"
            style={inp} />
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#45596a', margin: '12px 0 4px' }}>院所 / 科別（選填）</label>
          <input value={org} onChange={e => setOrg(e.target.value)} placeholder="例：台大急診"
            style={inp} />
          {error && <div style={{ color: '#a03a30', fontSize: 13, marginTop: 10 }}>{error}</div>}
          <button onClick={open} disabled={opening}
            style={{ width: '100%', marginTop: 16, background: '#a03a30', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 850, fontSize: 15, cursor: 'pointer' }}>
            {opening ? '載入中…' : '檢視保命資料'}
          </button>
        </div>
      </Centered>
    );
  }

  // ── Tactical board ────────────────────────────────────────────────────────
  const b = board!;
  const t1 = b.red_zone.tiers.tier1, t2 = b.red_zone.tiers.tier2;
  return (
    <div style={{ minHeight: '100vh', background: '#eef2f5' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '14px 14px 60px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', padding: '6px 2px 12px' }}>
          <div>
            <div style={{ fontSize: 12, color: '#a03a30', fontWeight: 800 }}>急診保命戰術板</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#22313f' }}>
              {b.patient.name} <span style={{ fontSize: 14, fontWeight: 600, color: '#56687a' }}>· {b.patient.age ? `${b.patient.age}y` : '年齡未記錄'} / {b.patient.sex ?? '—'}</span>
            </div>
            <div style={{ fontSize: 11, color: '#93a3af' }}>
              產生於 {new Date(b.generated_at).toLocaleString('zh-TW')} · 檢視者 {b.accessed_by}
              {b.access.accessor_org ? ` / ${b.access.accessor_org}` : ''} · 有效至 {new Date(b.access.expires_at).toLocaleString('zh-TW')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ alignSelf: 'center', fontSize: 11, fontWeight: 850, padding: '4px 9px', borderRadius: 999, background: '#e0f2fe', color: '#0369a1' }}>唯讀</span>
            <button onClick={copySummary} style={{ background: '#22313f', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>複製 HIS 摘要</button>
            <button onClick={downloadSummary} style={{ background: '#fff', color: '#22313f', border: '1px solid #c8d4dc', borderRadius: 10, padding: '10px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>下載 TXT</button>
          </div>
        </div>

        {/* Tier 1 保命紅區 */}
        <Section title="🔴 保命紅區 · Tier 1" tone="#a03a30">
          {t1.length === 0 ? <Empty>目前無 Tier 1 紅區資料</Empty> : t1.map(it => <RZRow key={it.id} it={it} />)}
        </Section>

        {/* 現用藥 */}
        <Section title="💊 現用藥" tone="#33596a">
          {b.medications.length === 0 ? <Empty>無使用中藥物紀錄</Empty> : b.medications.map((m, i) => (
            <div key={i} style={row}>
              <div><strong style={{ color: '#22313f' }}>{m.drug_name}</strong> <span style={{ color: '#56687a', fontSize: 13 }}>{[m.dose, m.frequency].filter(Boolean).join(' · ')}</span></div>
              <VerifyBadge ok={m.is_verified} />
            </div>
          ))}
        </Section>

        {/* Tier 2 重要背景 */}
        <Section title="🟡 重要背景 · Tier 2" tone="#a97614">
          {t2.length === 0 ? <Empty>無 Tier 2 資料</Empty> : t2.map(it => <RZRow key={it.id} it={it} />)}
        </Section>

        {/* Problem 清單 */}
        <Section title="🩺 疾病 / 問題清單" tone="#7a5fc0">
          {b.problems.length === 0 ? <Empty>無已發布的 Problem</Empty> : b.problems.map((p, i) => (
            <div key={i} style={row}>
              <div><strong style={{ color: '#22313f' }}>{p.name}</strong>{p.layman ? <span style={{ color: '#6b7c8c', fontSize: 12 }}> · {p.layman}</span> : ''}</div>
              <VerifyBadge ok={p.is_verified} />
            </div>
          ))}
        </Section>

        {/* 生命徵象 */}
        <Section title="📈 最新生命徵象" tone="#3e6b7e">
          {b.vitals.length === 0 ? <Empty>無量測紀錄</Empty> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {b.vitals.map((v, i) => (
                <div key={i} style={{ background: '#f6f9fa', border: '1px solid #e3e9ee', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#6b7c8c', fontWeight: 700 }}>{VLABEL[v.type] ?? v.type}</div>
                  <div style={{ fontSize: 17, fontWeight: 850, color: '#22313f' }}>
                    {v.type === 'blood_pressure' && v.value2 ? `${v.value1}/${v.value2}` : v.value1}<span style={{ fontSize: 11, color: '#93a3af', fontWeight: 600 }}> {v.unit ?? ''}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#93a3af' }}>{fmt(v.recorded_at)}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="原始文件索引" tone="#56687a">
          {b.evidence_documents.length === 0 ? <Empty>此急診連結目前沒有可追溯的原始文件索引</Empty> : b.evidence_documents.map((d) => (
            <div key={d.id} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#6b7c8c', fontWeight: 700 }}>{d.doc_type} · {fmt(d.doc_date)}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#22313f', wordBreak: 'break-all' }}>{d.file_name}</div>
                <div style={{ fontSize: 10, color: '#93a3af' }}>{d.status} · {d.linked_to_verified_data ? '已連結整理資料' : '尚未連結整理資料'}</div>
              </div>
              <a href={documentUrl(d.download_url)} target="_blank" rel="noreferrer" style={linkBtn}>查看原檔</a>
            </div>
          ))}
        </Section>

        <Section title="DICOM 檢視連結" tone="#6d28d9">
          {b.dicom_links.length === 0 ? <Empty>此急診連結目前沒有已開放的 DICOM viewer 連結</Empty> : b.dicom_links.map((d) => (
            <div key={d.share_id} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#6b7c8c', fontWeight: 700 }}>{d.modality || '影像'} · {d.study_date || '日期未記錄'}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#22313f' }}>{d.study_description || d.series_description || 'DICOM Viewer'}</div>
                <div style={{ fontSize: 10, color: '#93a3af' }}>viewer 有效至 {d.expires_at ? new Date(d.expires_at).toLocaleString('zh-TW') : '未記錄'}</div>
              </div>
              <a href={documentUrl(d.viewer_url)} target="_blank" rel="noreferrer" style={linkBtn}>開啟 Viewer</a>
            </div>
          ))}
        </Section>

        <div style={{ fontSize: 11, color: '#93a3af', lineHeight: 1.7, marginTop: 14 }}>{b.disclaimer}</div>
      </div>
    </div>
  );
}

function RZRow({ it }: { it: RZItem }) {
  return (
    <div style={row}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#6b7c8c', fontWeight: 700 }}>{it.label}</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#22313f', lineHeight: 1.35 }}>{it.value}</div>
        <div style={{ fontSize: 10, color: '#93a3af' }}>{it.source} · {fmt(it.last_reviewed_at)}</div>
      </div>
      <VerifyBadge ok={it.is_verified} />
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: '1px solid #e3e9ee', borderLeft: `4px solid ${tone}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
      <h2 style={{ fontSize: 14, fontWeight: 850, color: tone, margin: '0 0 8px' }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#93a3af', fontSize: 13, padding: '4px 0' }}>{children}</div>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', textAlign: 'center', background: '#eef2f5', padding: 20 }}>{children}</div>;
}

const inp: React.CSSProperties = { width: '100%', border: '1px solid #c8d4dc', borderRadius: 10, padding: '10px 12px', fontSize: 15 };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #eef2f5' };
const linkBtn: React.CSSProperties = { border: '1px solid #c8d4dc', background: '#fff', color: '#22313f', borderRadius: 8, padding: '7px 10px', fontWeight: 800, fontSize: 12, textDecoration: 'none', flexShrink: 0 };
