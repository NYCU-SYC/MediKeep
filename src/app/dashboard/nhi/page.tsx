'use client';

// Patient-facing NHI 健康存摺 viewer (Spec §8.1 / §8.2).
// Read-only. Shows the patient their imported NHI data grouped into the 10
// official sections, with a clear "organised by medical team" status so they
// understand the Raw → CMO → Published flow. No CMO-only fields are exposed.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '../toast-context';
import { useSync } from '@/lib/sync';
import { useActiveMember } from '../member-context';
import { memberDisplayName, memberHref, memberQueryParams, normalizeMemberName } from '@/lib/members';
import type { EvidenceDocument } from '@/lib/evidence';
import { evidenceMeta, evidenceTitle, evidenceUnavailableText } from '@/lib/evidence';

interface NhiSection {
  key: string;
  label: string;
  total: number;
  organised: number;
  pending: number;
  not_used: number;
  latest_visit_date: string | null;
}

interface NhiOverview {
  has_data: boolean;
  summary: {
    total: number;
    organised: number;
    pending: number;
    not_used: number;
    latest_visit_date: string | null;
  };
  sections: NhiSection[];
}

interface NhiItem {
  id: number;
  member_name: string | null;
  section: string;
  raw_label: string;
  date: string | null;
  visit_date: string | null;
  facility: string | null;
  hospital: string | null;
  department: string | null;
  diagnosis: string | null;
  icd10: string | null;
  key_medications: string | null;
  key_procedures?: string[] | string | null;
  lab_total_items: number | null;
  review_status: 'organised' | 'pending' | 'not_used';
  review_status_label: string;
  publish_status: string;
  publish_status_label: string;
  raw_payload_preview: string;
  raw_payload: Record<string, unknown>;
  parsed_payload: Record<string, unknown>;
  official_layer: { status: string; label: string; linked_object: { type: string; id: string; label: string } | null };
  published_layer: { status: string; label: string; object: unknown | null };
  linked_official_object: { type: string; id: string; label: string } | null;
  related_problem: { id: string; label: string } | null;
  patient_visible_note: string | null;
  source_document_id: string | null;
  source_document: EvidenceDocument | null;
  evidence_links?: EvidenceDocument[];
  available_actions: string[];
  created_at: string | null;
}

const SECTION_ICON: Record<string, string> = {
  outpatient: '🩺', inpatient: '🏥', med: '💊', surgery: '🔪',
  imaging: '🩻', lab: '🧪', vaccine: '💉', covid: '🦠', tcm: '🌿', dental: '🦷',
};

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  organised: { color: '#2e8b57', bg: '#e7f4ec' },
  pending:   { color: '#a97614', bg: '#fdf6e3' },
  not_used:  { color: '#6b7c8c', bg: '#eef2f5' },
};

function fmtDate(s: string | null): string {
  if (!s) return '日期未記錄';
  return s.replace(/T.*$/, '');
}

export default function NhiImportPage() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const sync = useSync();
  // NHI review/accept/reject emits `patient_nhi_imports`; publishing an
  // NHI-derived object emits `patient_dashboard`. Watch both so the viewer
  // refetches on either, without refetching on unrelated dashboard events.
  const nhiVersion = Math.max(
    sync.viewVersions['patient_nhi_imports'] ?? 0,
    sync.viewVersions['patient_dashboard'] ?? 0,
  );
  const [overview, setOverview] = useState<NhiOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [items, setItems] = useState<NhiItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState('');
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家' : '本人');
  const uploadHref = memberHref('/dashboard/upload', activeMember);
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/patients/me/nhi-imports', memberQueryParams(activeMember)) as NhiOverview;
      setOverview(data);
      if (data?.sections?.length && !activeSection) {
        setActiveSection(data.sections[0].key);
      }
    } catch {
      setOverview({ has_data: false, summary: { total: 0, organised: 0, pending: 0, not_used: 0, latest_visit_date: null }, sections: [] });
    } finally {
      setLoading(false);
    }
  }, [activeMember, activeSection]);

  useEffect(() => { loadOverview(); }, [loadOverview, nhiVersion]);

  useEffect(() => {
    if (!activeSection) return;
    let alive = true;
    setItemsLoading(true);
    api.get(`/api/patients/me/nhi-imports/${activeSection}`, memberQueryParams(activeMember))
      .then((d) => { if (alive) setItems(((d as { items?: NhiItem[] })?.items) ?? []); })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setItemsLoading(false); });
    return () => { alive = false; };
  }, [activeMember, activeSection, nhiVersion]);

  const summary = overview?.summary;
  const sections = useMemo(() => overview?.sections ?? [], [overview]);
  const activeMeta = sections.find((s) => s.key === activeSection) ?? null;
  const reportRow = async (item: NhiItem, status: 'error_reported' | 'review_requested') => {
    setActionBusy(`${status}-${item.id}`);
    try {
      await api.post('/api/patients/me/patient-reported-states', {
        target_type: 'source_document',
        target_id: item.source_document_id,
        reported_status: status,
        reported_payload: {
          target_label: item.raw_label,
          nhi_draft_id: item.id,
          member_name: item.member_name || activeMember || null,
          section: item.section,
          review_status: item.review_status,
          publish_status: item.publish_status,
        },
        note: status === 'error_reported' ? `NHI 匯入列可能有誤：${item.raw_label}` : `請醫療團隊複核 NHI 匯入列：${item.raw_label}`,
      });
      showToast(status === 'error_reported' ? `已回報錯誤 · ${item.raw_label}` : `已送出複核請求 · ${item.raw_label}`, 'success');
    } catch {
      showToast('送出失敗，請稍後再試', 'error');
    } finally {
      setActionBusy('');
    }
  };

  if (loading) {
    return (
      <div className="hk-nhi-page">
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 12px' }}>{scopeLabel}健保存摺匯入</h1>
        <div style={{ color: '#6b7c8c' }}>正在載入{scopeLabel}的健保署健康存摺資料…</div>
      </div>
    );
  }

  if (!overview?.has_data) {
    return (
      <div className="hk-nhi-page">
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 8px' }}>{scopeLabel}健保存摺匯入</h1>
        <div style={{ background: '#fff', border: '1px solid #e3e9ee', borderRadius: 12, padding: 28, textAlign: 'center', marginTop: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📑</div>
          <div style={{ fontWeight: 700, color: '#22313f', marginBottom: 6 }}>{scopeLabel}目前還沒有健保存摺資料</div>
          <div style={{ color: '#6b7c8c', fontSize: 14, lineHeight: 1.7, maxWidth: 460, margin: '0 auto 16px' }}>
            您可以從健保快易通 App 下載「健康存摺」HTML 檔，再上傳給醫療團隊整理。
            整理完成後，您的門診、用藥、檢驗、影像等紀錄就會顯示在這裡。
          </div>
          <Link href={uploadHref} style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 8, background: '#3e6b7e', color: '#fff', fontWeight: 700, fontSize: 14 }}>
            前往上傳資料
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="hk-nhi-page">
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 4px' }}>{scopeLabel}健保存摺匯入</h1>
      <div style={{ color: '#6b7c8c', fontSize: 13, marginBottom: 16 }}>
        這是從{scopeLabel}的健保署健康存摺匯入的就醫紀錄，由醫療團隊協助整理後呈現。最近就醫：{fmtDate(summary?.latest_visit_date ?? null)}
      </div>

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        {[
          { label: '總筆數', value: summary?.total ?? 0, color: '#22313f', bg: '#f6f9fa' },
          { label: '已整理', value: summary?.organised ?? 0, color: '#2e8b57', bg: '#e7f4ec' },
          { label: '待整理', value: summary?.pending ?? 0, color: '#a97614', bg: '#fdf6e3' },
          { label: '未採用', value: summary?.not_used ?? 0, color: '#6b7c8c', bg: '#eef2f5' },
        ].map((c) => (
          <div key={c.label} style={{ flex: '1 1 120px', minWidth: 110, background: c.bg, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7c8c' }}>{c.label}</div>
            <div style={{ fontSize: 26, fontWeight: 850, color: c.color, lineHeight: 1.1 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Status legend (explains the data flow to the patient) */}
      <div style={{ background: '#e7f3f5', border: '1px solid #cfe3e8', borderRadius: 10, padding: '10px 14px', marginBottom: 18, fontSize: 12.5, color: '#1e3a8a', lineHeight: 1.7 }}>
        <strong>狀態說明：</strong>
        <span style={{ marginLeft: 6 }}>🟢 已整理＝醫療團隊已確認並收錄到您的健康檔案</span>
        ·<span> 🟡 待整理＝已匯入、等待醫療團隊確認</span>
        ·<span> ⚪ 未採用＝與既有紀錄重複或不需收錄</span>
      </div>

      <div className="hk-nhi-grid">
        {/* Section list */}
        <div className="hk-nhi-section-list">
          {sections.map((s) => {
            const active = s.key === activeSection;
            return (
              <button key={s.key} type="button" onClick={() => setActiveSection(s.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '11px 13px', border: 0, borderLeft: active ? '3px solid #3e6b7e' : '3px solid transparent',
                  background: active ? '#e7f3f5' : 'transparent', cursor: 'pointer',
                }}>
                <span style={{ fontSize: 18 }}>{SECTION_ICON[s.key] ?? '📄'}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#22313f' }}>{s.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: '#6b7c8c', marginTop: 1 }}>
                    {s.total} 筆{s.pending > 0 ? ` · ${s.pending} 待整理` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Section detail */}
        <div className="hk-nhi-detail-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>{activeSection ? SECTION_ICON[activeSection] : '📄'}</span>
            <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{activeMeta?.label ?? ''}</h2>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7c8c' }}>{activeMeta?.total ?? 0} 筆紀錄</span>
          </div>

          {itemsLoading ? (
            <div style={{ color: '#6b7c8c', padding: 20, textAlign: 'center' }}>載入中…</div>
          ) : items.length === 0 ? (
            <div style={{ color: '#6b7c8c', padding: 20, textAlign: 'center' }}>此分區目前沒有紀錄。</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((it) => {
                const st = STATUS_STYLE[it.review_status] ?? STATUS_STYLE.pending;
                return (
                  <div key={it.id} style={{ border: '1px solid #edf1f7', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#56687a', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(it.visit_date)}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#22313f' }}>{it.facility || '醫療院所未記錄'}</span>
                      {it.member_name && (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, color: '#56687a', background: '#eef2f5' }}>
                          {it.member_name}
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, color: st.color, background: st.bg }}>
                        {it.review_status_label}
                      </span>
                    </div>
                    {(it.diagnosis || it.icd10) && (
                      <div style={{ marginTop: 5, fontSize: 13.5, color: '#22313f' }}>
                        {it.diagnosis || '—'}
                        {it.icd10 && <span style={{ marginLeft: 6, fontSize: 11, color: '#93a3af', fontFamily: 'ui-monospace, monospace' }}>{it.icd10}</span>}
                      </div>
                    )}
                    {it.key_medications && (
                      <div style={{ marginTop: 3, fontSize: 12, color: '#56687a' }}>用藥：{it.key_medications}</div>
                    )}
                    {it.lab_total_items ? (
                      <div style={{ marginTop: 3, fontSize: 12, color: '#56687a' }}>共 {it.lab_total_items} 項檢驗</div>
                    ) : null}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      <button type="button" onClick={() => setExpandedId(expandedId === it.id ? null : it.id)} style={rowBtn}>
                        {expandedId === it.id ? '收合詳情' : '查看 raw / parsed / official'}
                      </button>
                      <button type="button" onClick={() => reportRow(it, 'review_requested')} disabled={actionBusy === `review_requested-${it.id}`} title="送到 CMO 工作台複核，不會改動正式病歷" style={rowBtn}>
                        請醫療團隊複核
                      </button>
                      <button type="button" onClick={() => reportRow(it, 'error_reported')} disabled={actionBusy === `error_reported-${it.id}`} title="回報此 row 可能有誤，會寫入 health records activity" style={rowBtn}>
                        回報錯誤
                      </button>
                      <Link href={uploadHref} style={{ ...rowBtn, textDecoration: 'none' }}>補充文件</Link>
                    </div>
                    {expandedId === it.id && <NhiItemDetail item={it} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: '#93a3af', lineHeight: 1.7 }}>
        本資料為健保署健康存摺之就醫紀錄匯入，僅供您與醫療團隊整理健康檔案參考，非醫師診斷。
        實際診斷、病名、治療與用藥，仍以各醫療院所之病歷記載為準。
      </div>
    </div>
  );
}

function NhiItemDetail({ item }: { item: NhiItem }) {
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #e3e9ee', paddingTop: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        <LayerBox title="原始匯入資料 Raw Layer" status={item.raw_payload_preview}>
          <KV label="日期" value={item.date || item.visit_date || '未記錄'} />
          <KV label="院所/科別" value={[item.hospital || item.facility, item.department].filter(Boolean).join(' · ') || '未記錄'} />
          <Pre data={item.raw_payload} />
        </LayerBox>
        <LayerBox title="解析結果 Parsed Payload" status={item.review_status_label}>
          <KV label="Draft ID" value={`#${item.id}`} />
          <KV label="Section" value={item.section} />
          <Pre data={item.parsed_payload} />
        </LayerBox>
        <LayerBox title="醫療團隊整理 Official Layer" status={item.official_layer.label}>
          <KV label="狀態" value={item.official_layer.status} />
          <KV label="Linked official object" value={item.linked_official_object?.label || '尚未連到正式物件'} />
          <KV label="Related Problem" value={item.related_problem?.label || '尚未連到 Problem'} />
        </LayerBox>
        <LayerBox title="Patient View / Published Layer" status={item.published_layer.label}>
          <KV label="Publish status" value={item.publish_status_label} />
          <KV label="Patient note" value={item.patient_visible_note || '沒有病人可見備註'} />
          <EvidenceDocumentRow doc={item.source_document} fallbackId={item.source_document_id} />
        </LayerBox>
      </div>
    </div>
  );
}

function EvidenceDocumentRow({ doc, fallbackId }: { doc: EvidenceDocument | null; fallbackId?: string | null }) {
  if (!doc) {
    return (
      <div style={evidenceRow}>
        <span style={evidenceLabel}>原始文件</span>
        <span style={evidenceText}>{fallbackId ? `已記錄 ID：${fallbackId}，但尚未建立可檢視連結` : '尚未連結原始文件'}</span>
      </div>
    );
  }
  if (!doc.available || !doc.download_url) {
    return (
      <div style={evidenceRow}>
        <span style={evidenceLabel}>原始文件</span>
        <span style={evidenceText}>{evidenceTitle(doc)} · {evidenceUnavailableText(doc)}</span>
      </div>
    );
  }
  return (
    <div style={evidenceRow}>
      <span style={evidenceLabel}>原始文件</span>
      <a href={doc.download_url} target="_blank" rel="noreferrer" style={evidenceLink}>
        查看 {evidenceTitle(doc)}
        {evidenceMeta(doc) && <span style={{ color: '#6b7c8c', fontWeight: 700 }}> · {evidenceMeta(doc)}</span>}
      </a>
    </div>
  );
}

function LayerBox({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#f6f9fa', border: '1px solid #e3e9ee', borderRadius: 10, padding: 12, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: '#45596a', fontWeight: 850 }}>{title}</div>
      <div style={{ fontSize: 11, color: '#6b7c8c', margin: '4px 0 8px', lineHeight: 1.45 }}>{status}</div>
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, borderTop: '1px solid #e3e9ee', paddingTop: 6, marginTop: 6 }}>
      <span style={{ color: '#6b7c8c', fontWeight: 800 }}>{label}</span>
      <span style={{ color: '#22313f', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function Pre({ data }: { data: unknown }) {
  return (
    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto', background: '#fff', border: '1px solid #e3e9ee', borderRadius: 8, padding: 8, fontSize: 11, color: '#45596a', margin: '8px 0 0' }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

const evidenceRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  fontSize: 11,
  borderTop: '1px solid #e3e9ee',
  paddingTop: 6,
  marginTop: 6,
  alignItems: 'flex-start',
};
const evidenceLabel: React.CSSProperties = { color: '#6b7c8c', fontWeight: 800, flexShrink: 0 };
const evidenceText: React.CSSProperties = { color: '#22313f', textAlign: 'right', wordBreak: 'break-word', lineHeight: 1.45 };
const evidenceLink: React.CSSProperties = { color: '#3e6b7e', textAlign: 'right', wordBreak: 'break-word', lineHeight: 1.45, fontWeight: 850, textDecoration: 'none' };
const rowBtn: React.CSSProperties = {
  border: '1px solid #c8d4dc',
  background: '#fff',
  color: '#45596a',
  borderRadius: 8,
  padding: '6px 9px',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
};
