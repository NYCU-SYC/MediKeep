'use client';

// ─────────────────────────────────────────────────────────────────────────────
// 病人端首頁（改版 §4.1）：status-first，5 秒回答「我好嗎／要注意什麼／CMO 有新
// 建議／下一步」。五張卡片：①今日健康狀態 ②重要提醒（僅有才現）③CMO 最新建議
// ④下一步行動 ⑤資料更新狀態。資料沿用既有 endpoint；舊版保留於 page.tsx.bak。
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useActiveMember } from './member-context';
import { isJunkProblemName } from './problem-filter';
import { vitalFlag, isAbnormal } from './vital-range';
import { api } from '@/lib/api';
import { useSync } from '@/lib/sync';
import { memberHref, memberQueryParams, memberDisplayName, normalizeMemberName } from '@/lib/members';

// ── Types (subset of API shapes used by the home) ─────────────────────────────
type RecordOut = { id: string; member_name: string; record_type: string; value1: string | null; value2: string | null; unit: string | null; note: string | null; recorded_at: string };
type CmoSummary = {
  total: number; active_count: number; resolved_count: number; last_verified_at: string | null;
  top_problems: Array<{ id: number; display_name: string; display_layman: string | null; tier: number; is_suspected: boolean; verified_by_name: string | null }>;
};
type CmoRecommendation = {
  id: string; series_id: string; version: number; status: string; title: string;
  health_summary: string; recommendation: string; next_step: string; follow_up_date?: string | null; published_at?: string | null;
  summary_condition?: string; summary_exam?: string; summary_followup?: string; summary_values?: string; summary_advice?: string;
  attention_summary?: { condition: string; exam: string; followup: string; values: string; advice: string };
};
type MedicationOut = { id: number; drug_name: string; brand_name?: string | null; generic_name_en?: string | null; dose?: string | null; frequency?: string | null; route?: string | null; is_active?: boolean; status?: string | null };
type TReminder = { id: number | string; title: string; scheduled_date?: string | null; reminder_type?: string; type?: string; is_done?: boolean; status?: string; member_name?: string | null; member?: string | null };
type DocOut = { id: string; doc_type: string; file_name: string; status?: string | null; processing_status?: string | null; processing_status_label?: string | null; doc_date?: string | null; created_at?: string | null };
type ChangeRequest = { id: string; target_label?: string | null; status: string; action_url?: string | null; updated_at?: string | null; created_at?: string | null; patient_facing_note?: string | null; patient_note?: string | null };
type MissingDataRequest = { id: string; title: string; reason: string; instructions?: string | null; due_date?: string | null; status: string; response_text?: string | null; updated_at?: string | null; created_at?: string | null };
type CmoFollowUp = { id: number; reason: string; item: string; suggested_date?: string | null; priority?: string | null; status: string; needs_more_data?: boolean };
type MemberOverview = { id: string; name: string; relation: string; age: number | null; gender: string | null; color: string; latest_vitals: { type: string; value1: string | null; value2: string | null; recorded_at: string | null }[]; active_meds: number; due_reminders: number; last_record_at: string | null };

// ── Vital types used for abnormal detection on the home ───────────────────────
const VITAL_TYPES = [
  { key: 'blood_pressure', label: '血壓', format: (r: RecordOut) => (r.value2 ? `${r.value1}/${r.value2} mmHg` : r.value1 ? `收縮壓 ${r.value1} mmHg` : '–') },
  { key: 'glucose', label: '血糖', format: (r: RecordOut) => r.value1 ?? '–' },
  { key: 'heart_rate', label: '心跳', format: (r: RecordOut) => r.value1 ?? '–' },
  { key: 'bmi', label: 'BMI', format: (r: RecordOut) => r.value1 ?? '–' },
  { key: 'weight', label: '體重', format: (r: RecordOut) => r.value1 ?? '–' },
] as const;

// ── time helpers (module scope = pure-render-safe) ────────────────────────────
function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
}
function withinDays(iso?: string | null, days = 7): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < days * 864e5;
}
function todayStr(): string { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

const MAX_HOME_ALERTS = 3;

function patientSafeText(value?: string | null, fallback = '待醫療團隊整理的健康項目'): string {
  const text = (value ?? '').trim();
  if (isJunkProblemName(text)) return fallback;
  const withoutCodes = text
    .replace(/\b[A-Z]\d{2}(?:\.\d+)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = withoutCodes || fallback;
  return safe.length > 34 ? `${safe.slice(0, 32)}…` : safe;
}

function reminderTitleForPatient(title?: string | null): string {
  return patientSafeText(title, '待處理提醒');
}

function requestTitleForPatient(label?: string | null): string {
  return patientSafeText(label, '醫療團隊要求的資料');
}

function docStatus(d?: DocOut | null): string { return d?.processing_status || d?.status || 'uploaded'; }

// ── HomeContent ───────────────────────────────────────────────────────────────
function HomeContent() {
  const router = useRouter();
  const sync = useSync();
  const { activeMember, members } = useActiveMember();

  const [reminders, setReminders] = useState<TReminder[]>([]);
  const [docs, setDocs] = useState<DocOut[]>([]);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [missingRequests, setMissingRequests] = useState<MissingDataRequest[]>([]);
  const [cmoFollowUps, setCmoFollowUps] = useState<CmoFollowUp[]>([]);
  const [records, setRecords] = useState<RecordOut[]>([]);
  const [medications, setMedications] = useState<MedicationOut[]>([]);
  const [cmoSummary, setCmoSummary] = useState<CmoSummary | null>(null);
  const [cmoRecommendation, setCmoRecommendation] = useState<CmoRecommendation | null>(null);
  const [familyOverview, setFamilyOverview] = useState<MemberOverview[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const params = memberQueryParams(activeMember);
    const results = await Promise.allSettled([
      api.get('/api/patients/me/reminders', params),                      // 0
      api.get('/api/documents', params),                                  // 1
      api.get('/api/patients/me/change-requests', params),                // 2
      api.get('/api/records', { limit: '50', ...(params ?? {}) }),        // 3
      api.get('/api/patients/me/problems/summary'),                       // 4
      api.get('/api/members/overview'),                                   // 5
      api.get('/api/patients/me/recommendations/latest'),                  // 6
      api.get('/api/patients/me/missing-data-requests'),                   // 7
      api.get('/api/patients/me/follow-ups'),                              // 8
      api.get('/api/medications', params),                                  // 9
    ]);
    const at = (i: number): unknown => (results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<unknown>).value : null);
    const arr = (i: number): unknown[] => { const v = at(i); return Array.isArray(v) ? v : []; };
    setReminders(arr(0) as TReminder[]);
    setDocs(arr(1) as DocOut[]);
    setChangeRequests(arr(2) as ChangeRequest[]);
    setRecords(arr(3) as RecordOut[]);
    setCmoSummary((at(4) as CmoSummary) ?? null);
    setFamilyOverview(arr(5) as MemberOverview[]);
    setCmoRecommendation((at(6) as CmoRecommendation | null) ?? null);
    setMissingRequests(arr(7) as MissingDataRequest[]);
    setCmoFollowUps(arr(8) as CmoFollowUp[]);
    setMedications(arr(9) as MedicationOut[]);
    setLoadError(results.slice(0, 5).some((r) => r.status === 'rejected'));
    setLoaded(true);
  }, [activeMember]);

  // Fetch on mount + whenever the sync cursor advances. A data-fetch effect
  // legitimately setStates on completion (accepted pattern in this codebase).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, sync.version]);

  const today = todayStr();
  const href = (path: string, extra?: Record<string, string | null | undefined>) => memberHref(path, activeMember, extra);

  // 最新各類量測（API newest-first）
  const latestByType = useMemo(() => {
    const map: Record<string, RecordOut> = {};
    for (const r of records) if (!map[r.record_type]) map[r.record_type] = r;
    return map;
  }, [records]);

  // 異常數值（只取明確偏高/偏低/留意，避免通知疲勞）
  const abnormalVitals = useMemo(() => {
    const out: { key: string; label: string; value: string; flag: ReturnType<typeof vitalFlag> }[] = [];
    for (const vt of VITAL_TYPES) {
      const latest = latestByType[vt.key];
      if (!latest) continue;
      const flag = vitalFlag(vt.key, latest.value1, latest.value2);
      if (flag.level === 'high' || flag.level === 'low' || flag.level === 'watch') {
        out.push({ key: vt.key, label: vt.label, value: vt.format(latest), flag });
      }
    }
    return out;
  }, [latestByType]);

  const dueReminders = reminders.filter((r) => !r.is_done && r.status !== 'completed' && r.status !== 'deleted' && r.scheduled_date && r.scheduled_date <= today);
  const pendingRequests = changeRequests.filter((c) => c.status && !['resolved', 'closed', 'done', 'completed'].includes(c.status));
  const pendingMissingRequests = missingRequests.filter((request) => request.status && !['resolved', 'canceled', 'deleted'].includes(request.status));
  const activeCmoFollowUps = cmoFollowUps
    .filter((task) => task.status && !['done', 'completed', 'resolved', 'closed', 'deleted', 'canceled'].includes(task.status))
    .sort((a, b) => (a.suggested_date || '9999').localeCompare(b.suggested_date || '9999'));
  const processingDocs = docs.filter((d) => docStatus(d) !== 'confirmed').slice(0, 3);

  const hasHigh = abnormalVitals.some((v) => v.flag.level === 'high');
  const cmoRecommendationAt = cmoRecommendation?.published_at || cmoSummary?.last_verified_at;
  const cmoUpdatedRecently = withinDays(cmoRecommendationAt, 7);

  // 今日健康狀態 一句話（情緒定錨）
  const statusLine = (() => {
    if (hasHigh) return { text: '有數值明顯偏高，建議盡快追蹤', tone: 'red' as const, emoji: '⚠️' };
    if (abnormalVitals.length > 0) return { text: `有 ${abnormalVitals.length} 項數值建議追蹤`, tone: 'amber' as const, emoji: '🟡' };
    if (pendingMissingRequests.length > 0) return { text: `CMO 需要你補充 ${pendingMissingRequests.length} 份資料`, tone: 'amber' as const, emoji: '📋' };
    if (pendingRequests.length > 0) return { text: `目前穩定，有 ${pendingRequests.length} 項資料建議補充`, tone: 'amber' as const, emoji: '📋' };
    if (cmoUpdatedRecently) return { text: 'CMO 已更新本週健康建議', tone: 'green' as const, emoji: '🩺' };
    return { text: '今天一切穩定，沒有新的高風險提醒', tone: 'green' as const, emoji: '👍' };
  })();
  const heroStyle: React.CSSProperties = statusLine.tone === 'red'
    ? { background: 'linear-gradient(135deg,#fef2f2,#fff)', borderColor: '#fecaca' }
    : statusLine.tone === 'amber'
    ? { background: 'linear-gradient(135deg,#fffbeb,#fff)', borderColor: '#fde68a' }
    : { background: 'linear-gradient(135deg,#ecfeff,#f0fdf4)', borderColor: '#cffafe' };

  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家總覽' : '本人');
  const switchTo = (name: string) => { router.replace(memberHref('/dashboard', name)); };
  const homeAlerts = [
    ...abnormalVitals.map((v) => ({
      id: `v-${v.key}`,
      color: v.flag.level === 'high' ? 'var(--hk-red)' : 'var(--hk-amber)',
      title: `${v.label} ${v.value}`,
      badge: v.flag.label,
      badgeCls: v.flag.level === 'high' ? 'hk-b-red' : 'hk-b-amber',
      desc: '最近一次量測 · 來源：您的紀錄',
      onClick: () => router.push(href('/dashboard/trends')),
    })),
    ...dueReminders.map((r) => ({
      id: `r-${r.id}`,
      color: 'var(--hk-blue)',
      title: reminderTitleForPatient(r.title),
      badge: '待處理',
      badgeCls: 'hk-b-blue',
      desc: r.scheduled_date ? `預定 ${r.scheduled_date}` : '',
      onClick: () => router.push(href('/dashboard/reminders')),
    })),
    ...pendingRequests.map((c) => ({
      id: `c-${c.id}`,
      color: 'var(--hk-blue)',
      title: `建議補充：${requestTitleForPatient(c.target_label)}`,
      badge: '補資料',
      badgeCls: 'hk-b-blue',
      desc: patientSafeText(c.patient_facing_note || c.patient_note, 'CMO 整理時發現缺這份資料'),
      onClick: () => router.push(c.action_url || href('/dashboard/upload')),
    })),
    ...pendingMissingRequests.map((request) => ({
      id: `m-${request.id}`,
      color: 'var(--hk-blue)',
      title: `需要補資料：${requestTitleForPatient(request.title)}`,
      badge: request.status === 'needs_cmo_review' ? '已回覆' : '補資料',
      badgeCls: request.status === 'needs_cmo_review' ? 'hk-b-green' : 'hk-b-blue',
      desc: patientSafeText(request.instructions || request.reason, 'CMO 需要這份資料才能完成建議'),
      onClick: () => router.push(href('/dashboard/reminders')),
    })),
  ].filter((item) => !isJunkProblemName(item.title));
  const visibleHomeAlerts = homeAlerts.slice(0, MAX_HOME_ALERTS);
  const hiddenAlertCount = Math.max(0, homeAlerts.length - visibleHomeAlerts.length);
  const attention = cmoRecommendation?.attention_summary;
  const attentionRows = [
    { key: 'condition', label: '病況', value: cmoRecommendation?.summary_condition || attention?.condition || '' },
    { key: 'exam', label: '檢查', value: cmoRecommendation?.summary_exam || attention?.exam || '' },
    { key: 'followup', label: '回診', value: cmoRecommendation?.summary_followup || attention?.followup || '' },
    { key: 'values', label: '數值', value: cmoRecommendation?.summary_values || attention?.values || '' },
    { key: 'advice', label: '建議', value: cmoRecommendation?.summary_advice || attention?.advice || '' },
  ];
  const hasPublishedAttention = Boolean(cmoRecommendation && attentionRows.some((row) => row.value.trim()));
  const latestVitals = VITAL_TYPES.map((vt) => ({ key: vt.key, label: vt.label, record: latestByType[vt.key], format: vt.format })).filter((item) => item.record).slice(0, 5);
  const activeMedications = medications.filter((m) => m.status !== 'deleted' && m.is_active !== false).slice(0, 5);

  if (loadError && !loaded) {
    return (
      <div className="hk-home-wrap"><div className="hk-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32 }}>📡</div>
        <p style={{ color: 'var(--hk-ink-2)', margin: '8px 0 12px' }}>讀取健康資料時發生問題</p>
        <button className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => load()}>重新整理</button>
      </div></div>
    );
  }

  return (
    <div className="hk-home-wrap">
      {loadError && (
        <div className="hk-card hk-b-amber" style={{ marginBottom: 12, fontSize: 13 }}>
          部分資料載入失敗，顯示的可能不完整。<button className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginLeft: 8 }} onClick={() => load()}>重試</button>
        </div>
      )}

      {/* 全家總覽：成員快速切換條 */}
      {!activeMember && familyOverview.length > 1 && (
        <div className="family-overview-strip hk-home-full" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {familyOverview.map((m) => {
            const abn = m.latest_vitals.map((v) => vitalFlag(v.type, v.value1, v.value2)).some(isAbnormal);
            return (
              <button key={m.id} onClick={() => switchTo(m.name)} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1.5px solid ${abn ? '#fecaca' : 'var(--hk-line)'}`, borderRadius: 12, padding: '8px 12px', cursor: 'pointer' }}>
                <span style={{ width: 28, height: 28, borderRadius: 14, background: m.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>{m.name.slice(0, 1)}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{m.name}</span>
                <span className={`hk-badge ${abn ? 'hk-b-red' : 'hk-b-green'}`}>{abn ? '留意' : '正常'}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="hk-home-grid">
        <main className="hk-home-main">
          {/* ① 今日健康狀態 */}
          <div className="hk-card hk-home-hero" style={heroStyle}>
            <div style={{ fontSize: 22, fontWeight: 850, lineHeight: 1.38, color: 'var(--hk-ink)' }}>
              <span style={{ marginRight: 8 }}>{statusLine.emoji}</span>{statusLine.text}
            </div>
            <div style={{ fontSize: 13, color: 'var(--hk-ink-2)', marginTop: 8 }}>
              {scopeLabel}
              {cmoRecommendationAt ? ` · CMO 最近整理於 ${relativeTime(cmoRecommendationAt)}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <span className={`hk-badge ${visibleHomeAlerts.length ? 'hk-b-amber' : 'hk-b-green'}`}>{visibleHomeAlerts.length ? `${visibleHomeAlerts.length} 件重要事` : '無高風險提醒'}</span>
              <span className={`hk-badge ${processingDocs.length ? 'hk-b-amber' : 'hk-b-blue'}`}>{processingDocs.length ? `${processingDocs.length} 份資料整理中` : '資料狀態穩定'}</span>
              <span className="hk-badge hk-b-cmo">{cmoRecommendation ? 'CMO 有已發布建議' : '等待 CMO 更新'}</span>
            </div>
          </div>

          <div className="hk-card">
            <div className="hk-ctitle">需要注意
              <span className="hk-badge hk-b-cmo">{cmoRecommendation ? 'CMO 已發布' : '等待整理'}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10 }}>
              {attentionRows.map((row) => (
                <div key={row.key} style={{ border: '1px solid var(--hk-line)', borderRadius: 12, padding: 12, minHeight: 84, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: 'var(--hk-ink-3)', fontWeight: 850, marginBottom: 8 }}>{row.label}</div>
                  <div style={{ fontSize: 16, lineHeight: 1.45, color: hasPublishedAttention ? 'var(--hk-ink)' : 'var(--hk-ink-3)', fontWeight: 850, wordBreak: 'break-word' }}>{hasPublishedAttention ? patientSafeText(row.value, '—') : '待 CMO 整理'}</div>
                </div>
              ))}
            </div>
            {!hasPublishedAttention && (
              <div style={{ marginTop: 10, color: 'var(--hk-ink-2)', fontSize: 13, lineHeight: 1.6 }}>
                這五格只顯示 CMO 已發布的「需要注意」摘要；目前尚未發布新的摘要。
              </div>
            )}
            <Link href={href('/dashboard/problems')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 12 }}>查看疾病總覽</Link>
          </div>

          {(pendingMissingRequests.length > 0 || visibleHomeAlerts.length > 0) && (
            <div className="hk-card">
              <div className="hk-ctitle">補資料與提醒
                <span className="hk-badge hk-b-amber">{pendingMissingRequests.length + visibleHomeAlerts.length} 件</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {pendingMissingRequests.slice(0, 4).map((request) => (
                  <button key={request.id} className="hk-badge hk-b-amber" style={{ cursor: 'pointer', border: 'none' }} onClick={() => router.push(href('/dashboard/reminders', { highlight: `missing-${request.id}` }))}>
                    {requestTitleForPatient(request.title)}
                  </button>
                ))}
                {visibleHomeAlerts.slice(0, 4).map((item) => (
                  <button key={item.id} className={`hk-badge ${item.badgeCls}`} style={{ cursor: 'pointer', border: 'none' }} onClick={item.onClick}>
                    {item.title}
                  </button>
                ))}
              </div>
              {hiddenAlertCount > 0 && (
                <Link href={href('/dashboard/reminders')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>
                  另外 {hiddenAlertCount} 項到提醒頁查看
                </Link>
              )}
            </div>
          )}
        </main>

        <aside className="hk-home-side">
          <div className="hk-card">
            <div className="hk-ctitle">生命徵象</div>
            {latestVitals.length > 0 ? latestVitals.map((item) => (
              <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--hk-line)' }}>
                <span style={{ fontSize: 13, color: 'var(--hk-ink-2)', fontWeight: 750 }}>{item.label}</span>
                <span style={{ fontSize: 13, color: 'var(--hk-ink)', fontWeight: 850 }}>{item.format(item.record as RecordOut)}</span>
              </div>
            )) : (
              <div style={{ fontSize: 13, color: 'var(--hk-ink-3)' }}>尚無近期生命徵象</div>
            )}
            <Link href={href('/dashboard/trends')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看趨勢</Link>
          </div>

          <div className="hk-card">
            <div className="hk-ctitle">用藥</div>
            {activeMedications.length > 0 ? activeMedications.map((med) => (
              <div key={med.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--hk-line)' }}>
                <div style={{ fontSize: 13, color: 'var(--hk-ink)', fontWeight: 850 }}>{med.brand_name || med.drug_name}</div>
                <div style={{ fontSize: 12, color: 'var(--hk-ink-2)', marginTop: 2 }}>
                  {[med.generic_name_en, med.dose, med.frequency, med.route].filter(Boolean).join(' · ') || '明細待整理'}
                </div>
              </div>
            )) : (
              <div style={{ fontSize: 13, color: 'var(--hk-ink-3)' }}>尚無已發布用藥</div>
            )}
            <Link href={href('/dashboard/medications')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看用藥</Link>
          </div>

          {activeCmoFollowUps.length > 0 && (
            <div className="hk-card">
              <div className="hk-ctitle">CMO 追蹤提醒
                <span className="hk-badge hk-b-blue">{activeCmoFollowUps.length} 件</span>
              </div>
              {activeCmoFollowUps.slice(0, 2).map((task) => (
                <AlertRow
                  key={task.id}
                  color={task.priority === 'high' ? 'var(--hk-red)' : 'var(--hk-blue)'}
                  title={requestTitleForPatient(task.item || task.reason)}
                  badge={task.suggested_date ? task.suggested_date : '待追蹤'}
                  badgeCls={task.priority === 'high' ? 'hk-b-red' : 'hk-b-blue'}
                  desc={patientSafeText(task.reason, '依 CMO 建議持續追蹤')}
                  onClick={() => router.push(href('/dashboard/reminders', { highlight: `followup-${task.id}` }))}
                />
              ))}
              <Link href={href('/dashboard/reminders')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看追蹤提醒</Link>
            </div>
          )}

          <div className="hk-card" style={{ borderColor: '#fecaca', background: 'linear-gradient(135deg,#ffffff,#fef2f2)' }}>
            <div className="hk-ctitle">急診保命連結</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--hk-ink-2)', lineHeight: 1.5 }}>產生 24 小時 QR，讓現場醫師唯讀看到保命資料（過敏／用藥／腎功能等）。</div>
              <Link href={href('/dashboard/emergency')} className="hk-btn hk-btn-sm" style={{ flexShrink: 0, whiteSpace: 'nowrap', background: '#dc2626', color: '#fff' }}>產生連結</Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AlertRow({ color, title, badge, badgeCls, desc, onClick }: { color: string; title: string; badge: string; badgeCls: string; desc?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--hk-line)', padding: '10px 0', cursor: onClick ? 'pointer' : 'default', display: 'flex', gap: 10 }}>
      <span style={{ width: 9, height: 9, borderRadius: 5, background: color, marginTop: 6, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--hk-ink)' }}>{title}</span>
          <span className={`hk-badge ${badgeCls}`}>{badge}</span>
        </span>
        {desc && <span style={{ display: 'block', fontSize: 12, color: 'var(--hk-ink-2)', marginTop: 2 }}>{desc}</span>}
      </span>
    </button>
  );
}

// ── Page (default export): member scoping + empty state + slim wrapper ────────
export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setActiveMember, members, membersLoading, membersError } = useActiveMember();
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  // Load failed (network / server) — never show the onboarding empty state on
  // error, or a user who already has data sees a false "add your first member".
  if (!membersLoading && membersError && members.length === 0) {
    return (
      <div className="page-wrap" style={{ flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'linear-gradient(135deg,#fee2e2,#fecaca)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, margin: '0 auto 28px' }}>⚠️</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--hk-ink)', marginBottom: 12 }}>暫時無法載入資料</h2>
          <p style={{ fontSize: 15, color: 'var(--hk-ink-2)', lineHeight: 1.8, marginBottom: 36 }}>連線發生問題，您的資料仍安全保存。請稍後重試。</p>
          <button onClick={() => window.location.reload()} className="hk-btn hk-btn-primary" style={{ width: 'auto', padding: '14px 36px' }}>重新載入</button>
        </div>
      </div>
    );
  }

  if (!membersLoading && !membersError && members.length === 0) {
    return (
      <div className="page-wrap" style={{ flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, margin: '0 auto 28px' }}>👨‍👩‍👧‍👦</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--hk-ink)', marginBottom: 12 }}>還沒有家庭成員</h2>
          <p style={{ fontSize: 15, color: 'var(--hk-ink-2)', lineHeight: 1.8, marginBottom: 36 }}>先新增家庭成員，就可以開始記錄每個人的健康資料</p>
          <button onClick={() => router.push('/dashboard/settings')} className="hk-btn hk-btn-primary" style={{ width: 'auto', padding: '14px 36px' }}>+ 新增第一位成員</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <HomeContent />
    </div>
  );
}
