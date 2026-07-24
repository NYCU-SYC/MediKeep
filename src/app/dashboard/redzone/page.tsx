'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '../toast-context';
import { useSync } from '@/lib/sync';
import { useActiveMember } from '../member-context';
import { memberDisplayName, memberHref, memberQueryParams, normalizeMemberName } from '@/lib/members';
import type { EvidenceDocument } from '@/lib/evidence';
import { evidenceMeta, evidenceTitle, evidenceUnavailableText } from '@/lib/evidence';

type RedZoneItem = {
  id: string;
  target_type: string;
  target_id: string | null;
  label: string;
  value: string;
  member_name?: string | null;
  tier: 1 | 2 | 3;
  category: string;
  status: string;
  source: string;
  source_document_id?: string | null;
  evidence_document?: EvidenceDocument | null;
  is_verified: boolean;
  last_reviewed_at: string | null;
  pending_correction: boolean;
  related_problem_label?: string | null;
  available_actions: string[];
};

type RedZonePayload = {
  summary: {
    active_count: number;
    tier_counts: { tier1: number; tier2: number; tier3: number };
    last_reviewed_at: string | null;
    member_name?: string | null;
    source_badges: string[];
  };
  tiers: { tier1: RedZoneItem[]; tier2: RedZoneItem[]; tier3: RedZoneItem[] };
  copy: { tier1: string; all_active: string; emergency_summary: string; disabled_reason: string | null };
  empty_state: { title: string; why: string; next_action: string; cta: string } | null;
};

const TIER_META = {
  tier1: { title: 'Tier 1 · 保命紅區', desc: '看診、急診、檢查前最需要先看到的項目。', color: '#a03a30', bg: '#faecea' },
  tier2: { title: 'Tier 2 · 重要追蹤', desc: '會影響判斷與照護安排的重要背景。', color: '#a97614', bg: '#fdf6e3' },
  tier3: { title: 'Tier 3 · 基本資料', desc: '人口統計與生活習慣資料。', color: '#56687a', bg: '#f6f9fa' },
};

const TIER1_MINI_CELLS = [
  { label: '血型', tokens: ['blood_type', 'blood type', '血型'] },
  { label: '藥物過敏', tokens: ['drug allergy', 'medication allergy', 'allergy', '過敏', '顯影', '藥物過敏'] },
  { label: '關鍵用藥', tokens: ['medication', 'drug', 'anticoagulant', 'warfarin', 'doac', '抗凝', '用藥', '藥'] },
  { label: '緊急聯絡人', tokens: ['emergency contact', 'contact', '聯絡人', '緊急'] },
  { label: '重大診斷', tokens: ['problem', 'diagnosis', '診斷', '重大', '腫瘤', '中風', '心肌'] },
  { label: '近期趨勢', tokens: ['trend', 'vital', 'egfr', 'renal', 'kidney', 'glucose', 'blood_pressure', '趨勢', '血壓', '血糖', '腎'] },
] as const;

function tier1MiniValue(items: RedZoneItem[], tokens: readonly string[]): string {
  const matched = tokens.length
    ? items.find((item) => {
        const haystack = [item.target_type, item.category, item.label, item.value].join(' ').toLowerCase();
        return tokens.some((token) => haystack.includes(token.toLowerCase()));
      })
    : items.find((item) => !TIER1_MINI_CELLS.slice(0, 5).some((cell) => cell.tokens.some((token) => [item.target_type, item.category, item.label, item.value].join(' ').toLowerCase().includes(token.toLowerCase()))));
  return matched ? `${matched.label}: ${matched.value}` : '—';
}

function fmtDate(value: string | null): string {
  if (!value) return '未記錄';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.replace(/T.*$/, '');
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function RedZonePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const sync = useSync();
  const { activeMember, setActiveMember, members } = useActiveMember();
  // Refetch when a red-zone event arrives (CMO quick add / edit / revert /
  // reconcile) so the patient never sees a stale handoff summary.
  const redZoneVersion = sync.viewVersions['patient_red_zone'] ?? 0;
  const [data, setData] = useState<RedZonePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RedZoneItem | null>(null);
  const [correctionNote, setCorrectionNote] = useState('');
  const [busy, setBusy] = useState('');
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家' : '本人');
  const uploadHref = memberHref('/dashboard/upload', activeMember);
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/api/patients/me/red-zone', memberQueryParams(activeMember))
      .then((payload) => { if (alive) setData(payload as RedZonePayload); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activeMember, redZoneVersion]);

  const copyText = async (mode: 'tier1' | 'all_active' | 'emergency_summary') => {
    if (!data) return;
    const text = data.copy[mode];
    if (!text) {
      showToast(data.copy.disabled_reason || '目前沒有可複製的紅區資料', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(mode === 'tier1' ? '已複製 Tier 1 紅區' : mode === 'all_active' ? '已複製所有 active 紅區' : '已複製急診摘要', 'success');
    } catch {
      showToast('複製失敗，請手動選取文字', 'error');
    }
  };

  const reportCorrection = async () => {
    if (!selected || !correctionNote.trim()) return;
    setBusy(`correction-${selected.id}`);
    try {
      await api.post('/api/patients/me/patient-reported-states', {
        target_type: selected.target_type === 'allergy' ? 'allergy' : 'red_zone',
        target_id: selected.target_id,
        reported_status: 'correction_requested',
        reported_payload: {
          target_label: `${selected.label}：${selected.value}`,
          item_key: selected.id,
          member_name: selected.member_name || activeMember || null,
          category: selected.category,
          tier: selected.tier,
          correction_note: correctionNote.trim(),
        },
        note: correctionNote.trim(),
      });
      showToast(`已送出更正回報 · ${selected.label}`, 'success');
      setCorrectionNote('');
      setData((prev) => {
        if (!prev) return prev;
        const mark = (items: RedZoneItem[]) => items.map((item) => item.id === selected.id ? { ...item, pending_correction: true } : item);
        return { ...prev, tiers: { tier1: mark(prev.tiers.tier1), tier2: mark(prev.tiers.tier2), tier3: mark(prev.tiers.tier3) } };
      });
      setSelected((prev) => prev ? { ...prev, pending_correction: true } : prev);
    } catch {
      showToast('送出失敗，請稍後再試', 'error');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <div className="page-wrap"><div style={{ color: '#6b7c8c' }}>正在載入保命紅區...</div></div>;
  }

  const copyState = data?.copy || {
    tier1: '',
    all_active: '',
    emergency_summary: '',
    disabled_reason: '目前無法載入紅區資料，請重新整理後再試。',
  };

  if (!data || data.empty_state) {
    return (
      <div className="page-wrap hk-redzone-page" style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>
        <button onClick={() => router.back()} style={backBtn}>← 返回</button>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <h1 style={titleStyle}>{scopeLabel}保命紅區</h1>
            <p style={{ margin: '4px 0 0', color: '#6b7c8c', fontSize: 14 }}>
              Active 0 項 · copy modes 目前停用
            </p>
          </div>
          <CopyModeButtons copy={copyState} onCopy={copyText} />
        </header>
        <section style={emptyCard}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>🛟</div>
          <h2 style={{ fontSize: 18, fontWeight: 850, color: '#22313f', margin: 0 }}>{data?.empty_state?.title || '目前尚無保命紅區資料'}</h2>
          <p style={{ color: '#6b7c8c', lineHeight: 1.7 }}>{data?.empty_state?.why || '醫療團隊尚未整理出 active Tier 1/2/3 項目。'}</p>
          <p style={{ color: '#93a3af', fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
            {copyState.disabled_reason || '沒有 active 紅區項目，因此 Tier 1 / 全部 Active / 急診摘要暫時不能複製。'}
          </p>
          <button onClick={() => router.push(data?.empty_state?.cta ? memberHref(data.empty_state.cta, activeMember) : uploadHref)} style={primaryBtn}>
            {data?.empty_state?.next_action || '上傳或補充資料'}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="page-wrap hk-redzone-page" style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>
      <button onClick={() => router.back()} style={backBtn}>← 返回</button>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={titleStyle}>{scopeLabel}保命紅區</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7c8c', fontSize: 14 }}>
            Active {data.summary.active_count} 項 · 最後整理 {fmtDate(data.summary.last_reviewed_at)}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {data.summary.source_badges.map((source) => <span key={source} style={badge}>{source}</span>)}
          </div>
        </div>
        <CopyModeButtons copy={data.copy} onCopy={copyText} />
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(142px, 1fr))', gap: 10, marginBottom: 18 }}>
        {TIER1_MINI_CELLS.map((cell) => {
          const value = tier1MiniValue(data.tiers.tier1, cell.tokens);
          return (
            <div key={cell.label} style={{ ...countCard, borderColor: value === '—' ? '#e3e9ee' : '#f2d3cf', background: value === '—' ? '#fff' : '#faecea' }}>
              <div style={{ fontSize: 12, color: '#6b7c8c', fontWeight: 850 }}>{cell.label}</div>
              <div style={{ marginTop: 8, color: value === '—' ? '#93a3af' : '#8f342b', fontWeight: 850, lineHeight: 1.35, wordBreak: 'break-word' }}>{value}</div>
            </div>
          );
        })}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 18 }}>
        <button type="button" onClick={() => router.push(memberHref('/dashboard/conditions', activeMember))} style={{ ...countCard, textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ fontSize: 12, color: '#a97614', fontWeight: 850 }}>Tier 2 重要追蹤</div>
          <div style={{ marginTop: 6, color: '#22313f', fontWeight: 850 }}>前往疾病總覽</div>
          <div style={{ marginTop: 4, color: '#6b7c8c', fontSize: 12 }}>查看已發布 Problem、slots 與 timeline。</div>
        </button>
        <button type="button" onClick={() => router.push('/dashboard/settings')} style={{ ...countCard, textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ fontSize: 12, color: '#56687a', fontWeight: 850 }}>Tier 3 家庭與權限</div>
          <div style={{ marginTop: 6, color: '#22313f', fontWeight: 850 }}>前往家庭與權限</div>
          <div style={{ marginTop: 4, color: '#6b7c8c', fontSize: 12 }}>管理家庭成員、加入碼與權限設定。</div>
        </button>
      </section>

      <div className="hk-redzone-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(['tier1', 'tier2', 'tier3'] as const).map((tierKey) => (
            <TierSection key={tierKey} tierKey={tierKey} items={data.tiers[tierKey]} onSelect={setSelected} />
          ))}
        </div>
        <aside className="hk-redzone-detail">
          {selected ? (
            <div style={detailCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#93a3af', fontWeight: 800 }}>Tier {selected.tier} · {selected.category}</div>
                  <h2 style={{ margin: '4px 0', fontSize: 18, color: '#22313f' }}>{selected.label}</h2>
                </div>
                <button onClick={() => setSelected(null)} style={linkBtn}>關閉</button>
              </div>
              <div style={{ fontSize: 20, fontWeight: 850, color: '#22313f', margin: '10px 0 12px', lineHeight: 1.35 }}>{selected.value}</div>
              <DetailLine label="狀態" value={selected.status} />
              <DetailLine label="家庭成員" value={memberDisplayName(selected.member_name || activeMember, '未指定成員')} />
              <DetailLine label="來源" value={selected.source} />
              <DetailLine label="已確認" value={selected.is_verified ? '是' : '尚未確認'} />
              <DetailLine label="最後整理" value={fmtDate(selected.last_reviewed_at)} />
              <EvidenceDetail doc={selected.evidence_document ?? null} fallbackId={selected.source_document_id ?? null} />
              {selected.related_problem_label && <DetailLine label="相關 Problem" value={selected.related_problem_label} />}
              {selected.pending_correction && <div style={{ ...notice, marginTop: 10 }}>你已送出更正回報，醫療團隊整理中。</div>}
              <div style={{ borderTop: '1px solid #e3e9ee', marginTop: 14, paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 850, color: '#22313f', marginBottom: 6 }}>回報錯誤或補充</div>
                <textarea value={correctionNote} onChange={(e) => setCorrectionNote(e.target.value)} rows={4} placeholder="例：這項過敏已被醫師說明不是過敏，或反應內容需要修正。" style={textarea} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button onClick={reportCorrection} disabled={!correctionNote.trim() || !!busy} title={!correctionNote.trim() ? '請先填寫要更正或補充的內容' : '送出到醫療團隊工作台'} style={primaryBtn}>送出更正</button>
                  <button onClick={() => router.push(uploadHref)} style={secondaryBtn}>上傳佐證文件</button>
                </div>
              </div>
            </div>
          ) : (
            <div style={detailCard}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#22313f' }}>點一筆查看詳情</h2>
              <p style={{ color: '#6b7c8c', lineHeight: 1.7, fontSize: 13 }}>
                每筆紅區都可查看來源、確認狀態與最後整理時間。若內容不對，可以送出更正回報，CMO 端會看到待整理狀態。
              </p>
            </div>
          )}
        </aside>
      </div>

      <div style={{ marginTop: 18, color: '#93a3af', fontSize: 12, lineHeight: 1.7 }}>
        此頁只整理事實與來源狀態，不提供醫療建議。急症或不適請立即就醫。
      </div>
    </div>
  );
}

function CopyModeButtons({ copy, onCopy }: {
  copy: RedZonePayload['copy'];
  onCopy: (mode: 'tier1' | 'all_active' | 'emergency_summary') => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <button
        onClick={() => onCopy('tier1')}
        disabled={!copy.tier1}
        title={!copy.tier1 ? copy.disabled_reason || '沒有 Tier 1 active 項目' : '複製 Tier 1'}
        style={copyBtn(!copy.tier1)}
      >
        複製 Tier 1
      </button>
      <button
        onClick={() => onCopy('all_active')}
        disabled={!copy.all_active}
        title={!copy.all_active ? copy.disabled_reason || '沒有 active 項目' : '複製所有 active'}
        style={copyBtn(!copy.all_active)}
      >
        複製所有 Active
      </button>
      <button
        onClick={() => onCopy('emergency_summary')}
        disabled={!copy.emergency_summary}
        title={!copy.emergency_summary ? copy.disabled_reason || '沒有急診摘要內容' : '複製急診摘要'}
        style={copyBtn(!copy.emergency_summary)}
      >
        複製急診摘要
      </button>
    </div>
  );
}

function TierSection({ tierKey, items, onSelect }: { tierKey: 'tier1' | 'tier2' | 'tier3'; items: RedZoneItem[]; onSelect: (item: RedZoneItem) => void }) {
  const meta = TIER_META[tierKey];
  return (
    <section style={{ background: '#fff', border: '1px solid #e3e9ee', borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: meta.color }}>{meta.title}</h2>
          <div style={{ color: '#6b7c8c', fontSize: 12, marginTop: 3 }}>{meta.desc}</div>
        </div>
        <span style={{ ...badge, background: meta.bg, color: meta.color }}>{items.length} 項</span>
      </div>
      {items.length === 0 ? (
        <div style={{ border: '1px dashed #c8d4dc', borderRadius: 10, padding: 12, color: '#6b7c8c', fontSize: 13 }}>
          目前沒有此 Tier 的 active 資料。若你知道有相關資料，可以上傳文件或等待醫療團隊整理。
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {items.map((item) => (
            <button key={item.id} onClick={() => onSelect(item)} style={{
              textAlign: 'left', border: '1px solid #edf1f7', borderRadius: 8, padding: 9,
              background: item.pending_correction ? '#fdf1e0' : '#fff', cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ ...badge, background: meta.bg, color: meta.color }}>Tier {item.tier}</span>
                <span style={{ ...badge, background: item.is_verified ? '#e7f4ec' : '#fdf6e3', color: item.is_verified ? '#2e8b57' : '#a97614' }}>{item.is_verified ? '已確認' : '待確認'}</span>
                {item.member_name && <span style={badge}>{item.member_name}</span>}
                {item.evidence_document?.available && <span style={{ ...badge, background: '#e7f3f5', color: '#33596a' }}>有原始文件</span>}
                {item.pending_correction && <span style={{ ...badge, background: '#fdf1e0', color: '#b06a10' }}>待更正</span>}
              </div>
              <div style={{ fontSize: 14, color: '#22313f', fontWeight: 850, lineHeight: 1.4 }}>{item.label}</div>
              <div style={{ fontSize: 13, color: '#56687a', marginTop: 4, lineHeight: 1.45 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: '#93a3af', marginTop: 8 }}>{item.source} · {fmtDate(item.last_reviewed_at)}</div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #eef2f5' }}>
      <span style={{ color: '#6b7c8c', fontSize: 12, fontWeight: 800 }}>{label}</span>
      <span style={{ color: '#22313f', fontSize: 13, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function EvidenceDetail({ doc, fallbackId }: { doc: EvidenceDocument | null; fallbackId: string | null }) {
  if (!doc) {
    return <DetailLine label="原始文件" value={fallbackId ? `已記錄 ID：${fallbackId}，但尚未建立可檢視連結` : '尚未連結原始文件'} />;
  }
  if (!doc.available || !doc.download_url) {
    return <DetailLine label="原始文件" value={`${evidenceTitle(doc)} · ${evidenceUnavailableText(doc)}`} />;
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #eef2f5', alignItems: 'flex-start' }}>
      <span style={{ color: '#6b7c8c', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>原始文件</span>
      <a href={doc.download_url} target="_blank" rel="noreferrer" style={{ color: '#3e6b7e', fontSize: 13, textAlign: 'right', fontWeight: 850, textDecoration: 'none', wordBreak: 'break-word' }}>
        查看 {evidenceTitle(doc)}
        {evidenceMeta(doc) && <span style={{ color: '#6b7c8c', fontWeight: 700 }}> · {evidenceMeta(doc)}</span>}
      </a>
    </div>
  );
}

const titleStyle: React.CSSProperties = { fontSize: 28, fontWeight: 900, color: '#22313f', margin: '8px 0 0' };
const countCard: React.CSSProperties = { background: '#fff', border: '1px solid #e3e9ee', borderRadius: 12, padding: 12, minHeight: 92 };
const badge: React.CSSProperties = { display: 'inline-flex', borderRadius: 999, padding: '3px 8px', background: '#eef2f5', color: '#56687a', fontSize: 11, fontWeight: 850 };
const backBtn: React.CSSProperties = { border: '1px solid #e3e9ee', background: '#fff', color: '#45596a', borderRadius: 10, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { border: 'none', background: '#3e6b7e', color: '#fff', borderRadius: 10, padding: '10px 14px', fontWeight: 850, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { border: '1px solid #c8d4dc', background: '#fff', color: '#45596a', borderRadius: 10, padding: '10px 14px', fontWeight: 850, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: '#3e6b7e', fontWeight: 850, cursor: 'pointer' };
const detailCard: React.CSSProperties = { background: '#fff', border: '1px solid #e3e9ee', borderRadius: 14, padding: 16, boxShadow: 'var(--shadow-sm)' };
const emptyCard: React.CSSProperties = { background: '#fff', border: '1px solid #e3e9ee', borderRadius: 14, padding: 28, textAlign: 'center' };
const notice: React.CSSProperties = { background: '#fdf1e0', border: '1px solid #fed7aa', color: '#b06a10', borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 1.5 };
const textarea: React.CSSProperties = { width: '100%', border: '1px solid #c8d4dc', borderRadius: 10, padding: 10, fontSize: 13, resize: 'vertical' };
const copyBtn = (disabled: boolean): React.CSSProperties => ({
  border: '1px solid #c8d4dc',
  background: disabled ? '#f6f9fa' : '#fff',
  color: disabled ? '#93a3af' : '#22313f',
  borderRadius: 10,
  padding: '10px 12px',
  fontWeight: 850,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
