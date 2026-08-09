'use client';

// Patient-facing NHI 健康存摺 viewer (Spec §8.1 / §8.2).
// Read-only. Shows the patient their imported NHI data grouped by source
// section, with a clear "organised by medical team" status so they
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
import {
  PATIENT_PROBLEM_TRACKING_LABELS,
  PATIENT_PROBLEM_TRACKING_OPTIONS,
} from '@/lib/patientStatus';

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
  patient_tracking_state?: string | null;
  patient_tracking_state_id?: string | null;
}

type DraftTrackingUndo = {
  rowId: number;
  stateId: string;
  previous: string | null;
  next: string;
  label: string;
};

const SECTION_ICON: Record<string, string> = {
  outpatient: '🩺', inpatient: '🏥', med: '💊', surgery: '🔪',
  imaging: '🩻', lab: '🧪', vaccine: '💉', covid: '🦠', tcm: '🌿', dental: '🦷',
  advance_directive: '📜',
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
  const [overviewError, setOverviewError] = useState('');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [items, setItems] = useState<NhiItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState('');
  const [itemsReloadKey, setItemsReloadKey] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState('');
  const [trackingUndo, setTrackingUndo] = useState<DraftTrackingUndo | null>(null);
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家' : '本人');
  const uploadHref = memberHref('/dashboard/upload', activeMember, { mode: 'nhi-first' });
  const timelineHref = memberHref('/dashboard/timeline', activeMember);
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setOverviewError('');
    try {
      const data = await api.get('/api/patients/me/nhi-imports', memberQueryParams(activeMember)) as NhiOverview;
      setOverview(data);
      if (data?.sections?.length && !activeSection) {
        setActiveSection(data.sections[0].key);
      }
    } catch {
      setOverviewError('健保存摺資料載入失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  }, [activeMember, activeSection]);

  useEffect(() => { loadOverview(); }, [loadOverview, nhiVersion]);

  useEffect(() => {
    if (!activeSection) return;
    let alive = true;
    setItemsLoading(true);
    setItemsError('');
    api.get(`/api/patients/me/nhi-imports/${activeSection}`, memberQueryParams(activeMember))
      .then((d) => { if (alive) setItems(((d as { items?: NhiItem[] })?.items) ?? []); })
      .catch(() => {
        if (alive) {
          setItems([]);
          setItemsError('此分區載入失敗，請重試。');
        }
      })
      .finally(() => { if (alive) setItemsLoading(false); });
    return () => { alive = false; };
  }, [activeMember, activeSection, nhiVersion, itemsReloadKey]);

  const summary = overview?.summary;
  const sections = useMemo(() => overview?.sections ?? [], [overview]);
  const activeMeta = sections.find((s) => s.key === activeSection) ?? null;
  const reportRow = async (item: NhiItem, status: 'error_reported' | 'review_requested') => {
    setActionBusy(`${status}-${item.id}`);
    try {
      await api.post('/api/patients/me/patient-reported-states', {
        target_type: 'nhi_draft',
        target_id: String(item.id),
        source_document_id: item.source_document_id,
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

  const updateDraftTracking = async (item: NhiItem, status: string) => {
    const previous = item.patient_tracking_state ?? null;
    if (previous === status) return;
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, patient_tracking_state: status } : row));
    setActionBusy(`tracking-${item.id}`);
    try {
      const response = await api.post('/api/patients/me/patient-reported-states', {
        target_type: 'nhi_draft_tracking',
        target_id: String(item.id),
        source_document_id: item.source_document_id,
        reported_status: status,
        reported_payload: {
          target_label: item.diagnosis || item.raw_label,
          nhi_draft_id: item.id,
          member_name: item.member_name || activeMember || null,
          section: item.section,
          personal_tracking_only: true,
        },
        note: `使用者將 NHI 疾病追蹤狀況標記為：${PATIENT_PROBLEM_TRACKING_LABELS[status] ?? status}`,
      }) as { id?: string };
      const stateId = response.id || item.patient_tracking_state_id;
      setItems((current) => current.map((row) => row.id === item.id ? {
        ...row,
        patient_tracking_state: status,
        patient_tracking_state_id: stateId ?? null,
      } : row));
      if (stateId) {
        setTrackingUndo({ rowId: item.id, stateId, previous, next: status, label: item.diagnosis || item.raw_label });
      }
      showToast(`你的追蹤狀況已更新為「${PATIENT_PROBLEM_TRACKING_LABELS[status] ?? status}」`, 'success');
      sync.refreshNow();
    } catch {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, patient_tracking_state: previous } : row));
      showToast('追蹤狀況更新失敗，已恢復原本狀態', 'error');
    } finally {
      setActionBusy('');
    }
  };

  const undoDraftTracking = async () => {
    const change = trackingUndo;
    if (!change) return;
    setTrackingUndo(null);
    setItems((current) => current.map((row) => row.id === change.rowId ? { ...row, patient_tracking_state: change.previous } : row));
    setActionBusy(`tracking-${change.rowId}`);
    try {
      const action = change.previous === null ? 'withdraw' : 'restore-previous';
      await api.post(`/api/patients/me/patient-reported-states/${change.stateId}/${action}`, {});
      showToast(`已復原「${change.label}」的追蹤狀況`, 'success');
      sync.refreshNow();
    } catch {
      setItems((current) => current.map((row) => row.id === change.rowId ? { ...row, patient_tracking_state: change.next } : row));
      showToast('復原失敗，已保留目前狀態', 'error');
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

  if (overviewError) {
    return (
      <div className="hk-nhi-page">
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 12px' }}>{scopeLabel}健保存摺匯入</h1>
        <div style={{ background: '#fff', border: '1px solid #f2d3cf', borderRadius: 12, padding: 24 }}>
          <div style={{ fontWeight: 800, color: '#a03a30' }}>{overviewError}</div>
          <button type="button" onClick={() => void loadOverview()} style={{ ...rowBtn, marginTop: 12 }}>重新載入</button>
        </div>
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
            匯入健保存摺 HTML／ZIP
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="hk-nhi-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 4px' }}>{scopeLabel}健保存摺匯入</h1>
          <div style={{ color: '#6b7c8c', fontSize: 13, marginBottom: 16 }}>
            這是從{scopeLabel}的健保署健康存摺匯入的就醫紀錄，由醫療團隊協助整理後呈現。最近就醫：{fmtDate(summary?.latest_visit_date ?? null)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href={timelineHref} className="hk-btn hk-btn-ghost hk-btn-sm">查看三年健康時間軸</Link>
          <Link href={uploadHref} className="hk-btn hk-btn-primary hk-btn-sm">再次匯入</Link>
        </div>
      </div>

      {trackingUndo && (
        <div role="status" aria-live="polite" style={{ background: '#e7f3f5', border: '1px solid #cfe3e8', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#315869', fontSize: 13 }}>已更新「{trackingUndo.label}」的個人追蹤狀況，不會改寫正式診斷。</span>
          <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => void undoDraftTracking()} disabled={actionBusy === `tracking-${trackingUndo.rowId}`}>
            復原上次變更
          </button>
        </div>
      )}

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
          ) : itemsError ? (
            <div style={{ color: '#a03a30', padding: 20, textAlign: 'center' }}>
              {itemsError}
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={() => setItemsReloadKey((value) => value + 1)} style={rowBtn}>重新載入</button>
              </div>
            </div>
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
                    {it.diagnosis && (
                      <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <label style={{ fontSize: 12, fontWeight: 800, color: '#56687a' }}>
                          我的追蹤狀況
                          <select
                            aria-label={`更新${it.diagnosis}的個人追蹤狀況（立即生效）`}
                            value={it.patient_tracking_state ?? ''}
                            disabled={actionBusy === `tracking-${it.id}`}
                            onChange={(event) => { if (event.target.value) void updateDraftTracking(it, event.target.value); }}
                            style={{ marginLeft: 8, minHeight: 34, border: '1px solid #cfd9e2', borderRadius: 8, padding: '5px 28px 5px 9px', background: '#fff', color: '#22313f' }}
                          >
                            <option value="" disabled>選擇目前狀況…</option>
                            {PATIENT_PROBLEM_TRACKING_OPTIONS.map((option) => (
                              <option key={option.key} value={option.key}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <span style={{ fontSize: 11, color: '#2e8b57', fontWeight: 800 }}>立即生效</span>
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
                        {expandedId === it.id ? '收合詳情' : '查看整理狀態與來源'}
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
        <LayerBox title="健保存摺來源資料" status="保留健保署匯入來源；此處只顯示使用者需要的欄位">
          <KV label="日期" value={item.date || item.visit_date || '未記錄'} />
          <KV label="院所/科別" value={[item.hospital || item.facility, item.department].filter(Boolean).join(' · ') || '未記錄'} />
          <KV label="分類" value={item.raw_label || item.section} />
          <EvidenceDocumentRow doc={item.source_document} fallbackId={item.source_document_id} />
        </LayerBox>
        <LayerBox title="醫療團隊整理狀態" status={item.official_layer.label}>
          <KV label="整理狀態" value={item.review_status_label} />
          <KV label="正式健康項目" value={item.linked_official_object?.label || '尚未整理成正式健康項目'} />
          <KV label="相關疾病" value={item.related_problem?.label || '尚未連結疾病'} />
        </LayerBox>
        <LayerBox title="你的可見內容" status={item.published_layer.label}>
          <KV label="發布狀態" value={item.publish_status_label} />
          <KV label="醫療團隊備註" value={item.patient_visible_note || '目前沒有補充備註'} />
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
