'use client';

// ─────────────────────────────────────────────────────────────────────────────
// 病人端首頁（改版 §4.1）：status-first，5 秒回答「我好嗎／要注意什麼／CMO 有新
// 建議／下一步」。五張卡片：①今日健康狀態 ②重要提醒（僅有才現）③CMO 最新建議
// ④下一步行動 ⑤資料更新狀態。資料沿用既有 endpoint；舊版保留於 page.tsx.bak。
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useActiveMember } from './member-context';
import { isJunkProblemName } from './problem-filter';
import { vitalFlag, isAbnormal } from './vital-range';
import { api } from '@/lib/api';
import { useSync } from '@/lib/sync';
import { memberHref, memberQueryParams, memberDisplayName, normalizeMemberName } from '@/lib/members';
import NhiReminderCard from '@/components/NhiReminderCard';
import { safeInternalActionUrl } from '@/lib/internalRoutes';
import { HomeDataState, PageHeader, ReadOnlyNotice, SourceBadge, userMemberHref } from './_components/Shared';
import { Icon } from './_components/Icon';

// ── Types (subset of API shapes used by the home) ─────────────────────────────
type RecordOut = { id: string; member_name: string; record_type: string; value1: string | null; value2: string | null; unit: string | null; note: string | null; recorded_at: string };
type CmoSummary = {
  total: number; active_count: number; resolved_count: number; last_verified_at: string | null;
  top_problems: Array<{ id: number; display_name: string; display_layman: string | null; tier: number; is_suspected: boolean; verified_by_name: string | null }>;
};
type CmoRecommendation = {
  id: string; series_id: string; version: number; status: string; title: string;
  health_summary: string; recommendation: string; next_step: string; follow_up_date?: string | null; published_at?: string | null;
  attention_cells?: { condition: string; check: string; followup: string; value: string; advice: string };
};
type TReminder = { id: number | string; title: string; scheduled_date?: string | null; reminder_type?: string; type?: string; is_done?: boolean; status?: string; member_name?: string | null; member?: string | null };
type DocOut = { id: string; doc_type: string; file_name: string; status?: string | null; processing_status?: string | null; processing_status_label?: string | null; doc_date?: string | null; created_at?: string | null };
type ChangeRequest = { id: string; target_label?: string | null; status: string; action_url?: string | null; updated_at?: string | null; created_at?: string | null; patient_facing_note?: string | null; patient_note?: string | null };
type MissingDataRequest = { id: string; title: string; reason: string; instructions?: string | null; due_date?: string | null; status: string; response_text?: string | null; updated_at?: string | null; created_at?: string | null };
type CmoFollowUp = { id: number; reason: string; item: string; suggested_date?: string | null; priority?: string | null; status: string; needs_more_data?: boolean };
type MemberOverview = { id: string; name: string; relation: string; age: number | null; gender: string | null; color: string; latest_vitals: { type: string; value1: string | null; value2: string | null; recorded_at: string | null }[]; active_meds: number; due_reminders: number; last_record_at: string | null };
type MedicationOut = { id: number; drug_name: string; generic_name_en?: string | null; brand_name?: string | null; dose?: string | null; frequency?: string | null; indication?: string | null; linked_problem_id?: number | null; related_problem_id?: number | null; is_published?: boolean; status?: string | null; member_name?: string | null };
type EmergencyReadiness = {
  counts?: {
    core_total?: number;
    available_total?: number;
    red_zone?: number;
    medications?: number;
    problems?: number;
    vitals?: number;
  };
  warnings?: Array<{ message?: string | null }>;
};

// ── Vital types used for abnormal detection on the home ───────────────────────
const VITAL_TYPES = [
  { key: 'blood_pressure', label: '血壓', format: (r: RecordOut) => (r.value2 ? `${r.value1}/${r.value2} mmHg` : r.value1 ? `收縮壓 ${r.value1} mmHg` : '–') },
  { key: 'glucose', label: '血糖', format: (r: RecordOut) => r.value1 ?? '–' },
  { key: 'heart_rate', label: '心跳', format: (r: RecordOut) => r.value1 ?? '–' },
  { key: 'bmi', label: 'BMI', format: (r: RecordOut) => r.value1 ?? '–' },
  { key: 'weight', label: '體重', format: (r: RecordOut) => r.value1 ?? '–' },
] as const;

const RECORD_LABELS: Record<string, string> = {
  blood_pressure: '血壓',
  glucose: '血糖',
  heart_rate: '心跳',
  bmi: 'BMI',
  weight: '體重',
  body_fat: '體脂率',
  sleep: '睡眠',
  steps: '步數',
};

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
const ATTENTION_FIELDS = [
  { key: 'condition', label: '病況' },
  { key: 'check', label: '檢查' },
  { key: 'followup', label: '回診' },
  { key: 'value', label: '數值' },
  { key: 'advice', label: '建議' },
] as const;

const HOME_RESOURCE_KEYS = [
  'reminders',
  'documents',
  'changeRequests',
  'records',
  'conditions',
  'sync',
  'familyOverview',
  'recommendation',
  'missingRequests',
  'followUps',
  'medications',
  'emergencyReadiness',
] as const;
type HomeResourceKey = typeof HOME_RESOURCE_KEYS[number];

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

function problemTitleForPatient(p?: { display_name?: string | null; display_layman?: string | null } | null): string {
  if (!p) return '健康摘要';
  return patientSafeText(p.display_layman || p.display_name);
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
  const [syncCounts, setSyncCounts] = useState<Record<string, number>>({});
  const [familyOverview, setFamilyOverview] = useState<MemberOverview[]>([]);
  const [emergencyReadiness, setEmergencyReadiness] = useState<EmergencyReadiness | null>(null);
  const [dataState, setDataState] = useState<'loading' | 'ready' | 'partial' | 'error'>('loading');
  const [failedResources, setFailedResources] = useState<HomeResourceKey[]>([]);
  const snapshotScopeRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);

  const load = useCallback(async () => {
    const scopeKey = activeMember || '__family__';
    const hasSameScopeSnapshot = snapshotScopeRef.current === scopeKey;
    const requestSequence = ++requestSequenceRef.current;
    if (!hasSameScopeSnapshot) {
      // Never retain another family member's data while switching scope.
      snapshotScopeRef.current = null;
      setReminders([]);
      setDocs([]);
      setChangeRequests([]);
      setRecords([]);
      setCmoSummary(null);
      setSyncCounts({});
      setFamilyOverview([]);
      setCmoRecommendation(null);
      setMissingRequests([]);
      setCmoFollowUps([]);
      setMedications([]);
      setEmergencyReadiness(null);
      setFailedResources([]);
      setDataState('loading');
    }
    const params = memberQueryParams(activeMember);
    const selectedMember = members.find((member) => member.name === activeMember);
    const emergencyParams = selectedMember?.id ? { member_id: selectedMember.id } : undefined;
    const results = await Promise.allSettled([
      api.get('/api/patients/me/reminders', params),                      // 0
      api.get('/api/documents', params),                                  // 1
      api.get('/api/patients/me/change-requests', params),                // 2
      api.get('/api/records', { limit: '50', ...(params ?? {}) }),        // 3
      api.get('/api/patients/me/problems/summary', params),                // 4
      api.get('/api/patients/me/sync-state', params),                     // 5
      api.get('/api/members/overview'),                                   // 6
      api.get('/api/patients/me/recommendations/latest', params),          // 7
      api.get('/api/patients/me/missing-data-requests', params),           // 8
      api.get('/api/patients/me/follow-ups', params),                      // 9
      api.get('/api/medications', params),                                 // 10
      api.get('/api/patients/me/emergency-readiness', emergencyParams),     // 11
    ]);
    if (requestSequence !== requestSequenceRef.current) return;

    const fulfilled = (i: number): boolean => results[i].status === 'fulfilled';
    const value = (i: number): unknown => (results[i] as PromiseFulfilledResult<unknown>).value;
    const arrayValue = <T,>(i: number): T[] => Array.isArray(value(i)) ? value(i) as T[] : [];

    // A rejected refresh keeps the last successful value for this member. Only
    // fulfilled responses may replace state, including a legitimate empty list.
    if (fulfilled(0)) setReminders(arrayValue<TReminder>(0));
    if (fulfilled(1)) setDocs(arrayValue<DocOut>(1));
    if (fulfilled(2)) setChangeRequests(arrayValue<ChangeRequest>(2));
    if (fulfilled(3)) setRecords(arrayValue<RecordOut>(3));
    if (fulfilled(4)) setCmoSummary((value(4) as CmoSummary | null) ?? null);
    if (fulfilled(5)) setSyncCounts((value(5) as { counts?: Record<string, number> } | null)?.counts ?? {});
    if (fulfilled(6)) setFamilyOverview(arrayValue<MemberOverview>(6));
    if (fulfilled(7)) setCmoRecommendation((value(7) as CmoRecommendation | null) ?? null);
    if (fulfilled(8)) setMissingRequests(arrayValue<MissingDataRequest>(8));
    if (fulfilled(9)) setCmoFollowUps(arrayValue<CmoFollowUp>(9));
    if (fulfilled(10)) setMedications(arrayValue<MedicationOut>(10));
    if (fulfilled(11)) setEmergencyReadiness((value(11) as EmergencyReadiness | null) ?? null);

    const rejectedCount = results.filter((result) => result.status === 'rejected').length;
    const failed = HOME_RESOURCE_KEYS.filter((_, index) => results[index].status === 'rejected');
    setFailedResources(failed);
    if (rejectedCount < results.length) snapshotScopeRef.current = scopeKey;
    setDataState(
      rejectedCount === 0
        ? 'ready'
        : hasSameScopeSnapshot || rejectedCount < results.length
          ? 'partial'
          : 'error',
    );
  }, [activeMember, members]);

  // Fetch on mount + whenever the sync cursor advances. A data-fetch effect
  // legitimately setStates on completion (accepted pattern in this codebase).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, sync.version]);

  const today = todayStr();
  const href = (path: string, extra?: Record<string, string | null | undefined>) => (
    path === '/dashboard/tasks'
      ? userMemberHref(path, activeMember, extra)
      : memberHref(path, activeMember, extra)
  );

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
  const publishedMedications = medications
    .filter((med) => med.is_published && med.status !== 'deleted')
    .slice(0, 4);
  const publishedLinkedMeds = publishedMedications.filter((med) => med.linked_problem_id || med.related_problem_id);
  const currentConditions = (cmoSummary?.top_problems ?? [])
    .filter((problem) => !isJunkProblemName(problem.display_layman || problem.display_name))
    .slice(0, 4);

  const hasHigh = abnormalVitals.some((v) => v.flag.level === 'high');
  const topRec = cmoSummary?.top_problems?.find((p) => !isJunkProblemName(p.display_layman || p.display_name)) ?? null;
  const cmoRecommendationAt = cmoRecommendation?.published_at || cmoSummary?.last_verified_at;
  const cmoUpdatedRecently = withinDays(cmoRecommendationAt, 7);
  const attentionCells = cmoRecommendation?.attention_cells ?? { condition: '', check: '', followup: '', value: '', advice: '' };
  const hasAttentionCells = ATTENTION_FIELDS.some((field) => Boolean(attentionCells[field.key]?.trim()));

  // 首頁只陳述資料狀態，不把「沒有目前提醒」推論成臨床結論。
  const statusLine = (() => {
    if (hasHigh) return { text: '有量測被標示為需優先追蹤', tone: 'red' as const, icon: 'emergency' };
    if (abnormalVitals.length > 0) return { text: `有 ${abnormalVitals.length} 項量測標示需追蹤`, tone: 'amber' as const, icon: 'trend' };
    if (pendingMissingRequests.length > 0) return { text: `醫療團隊需要你補充 ${pendingMissingRequests.length} 份資料`, tone: 'amber' as const, icon: 'records' };
    if (pendingRequests.length > 0) return { text: `有 ${pendingRequests.length} 項資料建議補充`, tone: 'amber' as const, icon: 'records' };
    if (cmoUpdatedRecently) return { text: '醫療團隊最近更新了健康內容', tone: 'green' as const, icon: 'health' };
    return { text: '目前沒有新的提醒資料', tone: 'green' as const, icon: 'records' };
  })();
  const heroStyle: React.CSSProperties = statusLine.tone === 'red'
    ? { background: 'linear-gradient(135deg,#faecea,#fff)', borderColor: '#f2d3cf' }
    : statusLine.tone === 'amber'
    ? { background: 'linear-gradient(135deg,#fdf6e3,#fff)', borderColor: '#efdfae' }
    : { background: 'linear-gradient(135deg,#ecfeff,#e7f4ec)', borderColor: '#cffafe' };

  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家總覽' : '本人');
  const latestUpdatedAt = [
    ...records.map((record) => record.recorded_at),
    ...docs.map((doc) => doc.created_at || doc.doc_date || null),
    ...familyOverview.map((member) => member.last_record_at),
    cmoRecommendationAt,
    cmoSummary?.last_verified_at,
  ]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
  const emergencyCounts = emergencyReadiness?.counts;
  const emergencyAvailable = emergencyCounts?.available_total;
  const emergencyTotal = emergencyCounts?.core_total;
  const openTodoCount = dueReminders.length + pendingRequests.length + pendingMissingRequests.length + activeCmoFollowUps.length;
  const recentActivity = [
    ...records.filter((record) => Boolean(record.recorded_at)).map((record) => ({
      id: `record-${record.id}`,
      title: `${RECORD_LABELS[record.record_type] || record.record_type} ${record.value2 ? `${record.value1}/${record.value2}` : record.value1 || '已記錄'}`,
      meta: record.recorded_at,
      label: '本人紀錄',
      href: href('/dashboard/history'),
    })),
    ...docs.filter((doc) => Boolean(doc.created_at || doc.doc_date)).map((doc) => ({
      id: `doc-${doc.id}`,
      title: patientSafeText(doc.file_name, '上傳文件'),
      meta: doc.created_at || doc.doc_date || '',
      label: '文件',
      href: href('/dashboard/documents'),
    })),
    ...(cmoRecommendationAt ? [{
      id: 'medical-team-update',
      title: '醫療團隊更新健康內容',
      meta: cmoRecommendationAt,
      label: '醫療團隊',
      href: href('/dashboard/health'),
    }] : []),
  ].sort((a, b) => new Date(b.meta).getTime() - new Date(a.meta).getTime()).slice(0, 5);
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
      desc: patientSafeText(c.patient_facing_note || c.patient_note, '醫療團隊整理時發現缺這份資料'),
      onClick: () => router.push(safeInternalActionUrl(c.action_url, href('/dashboard/upload'))),
    })),
    ...pendingMissingRequests.map((request) => ({
      id: `m-${request.id}`,
      color: 'var(--hk-blue)',
      title: `需要補資料：${requestTitleForPatient(request.title)}`,
      badge: request.status === 'needs_cmo_review' ? '已回覆' : '補資料',
      badgeCls: request.status === 'needs_cmo_review' ? 'hk-b-green' : 'hk-b-blue',
      desc: patientSafeText(request.instructions || request.reason, '醫療團隊需要這份資料才能完成建議'),
      onClick: () => router.push(href('/dashboard/reminders')),
    })),
  ].filter((item) => !isJunkProblemName(item.title));
  const visibleHomeAlerts = homeAlerts.slice(0, MAX_HOME_ALERTS);
  const hiddenAlertCount = Math.max(0, homeAlerts.length - visibleHomeAlerts.length);
  const failed = (resource: HomeResourceKey) => failedResources.includes(resource);
  const alertResourcesFailed = ['reminders', 'changeRequests', 'records', 'conditions', 'recommendation', 'missingRequests', 'followUps']
    .some((resource) => failed(resource as HomeResourceKey));

  if (dataState === 'loading' || dataState === 'error') {
    return (
      <div className="hk-home-wrap">
        <PageHeader
          eyebrow="總覽"
          title="我的健康全貌"
          description="從目前成員、最近更新、病況、用藥、量測與急診資料完整度開始查看。內容只會呈現目前已取得的資料。"
        />
        <HomeDataState state={dataState} onRetry={() => { void load(); }} />
      </div>
    );
  }

  return (
    <div className="hk-home-wrap">
      <PageHeader
        eyebrow="總覽"
        title="我的健康全貌"
        description="從目前成員、最近更新、病況、用藥、量測與急診資料完整度開始查看。內容只會呈現目前已取得的資料。"
      />
      <HomeDataState state={dataState} onRetry={() => { void load(); }}>
        <NhiReminderCard />

      {/* 全家總覽：成員快速切換條 */}
      {!activeMember && familyOverview.length > 1 && (
        <div className="family-overview-strip hk-home-full" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {familyOverview.map((m) => {
            const abn = m.latest_vitals.map((v) => vitalFlag(v.type, v.value1, v.value2)).some(isAbnormal);
            return (
              <button key={m.id} onClick={() => switchTo(m.name)} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1.5px solid ${abn ? '#f2d3cf' : 'var(--hk-line)'}`, borderRadius: 12, padding: '8px 12px', cursor: 'pointer' }}>
                <span style={{ width: 28, height: 28, borderRadius: 14, background: m.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>{m.name.slice(0, 1)}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{m.name}</span>
                <span className={`hk-badge ${abn ? 'hk-b-red' : 'hk-b-green'}`}>{abn ? '留意' : '正常'}</span>
              </button>
            );
          })}
        </div>
      )}

      <section className="hk-card" aria-labelledby="home-health-alerts-title" style={{ marginBottom: 12, borderColor: visibleHomeAlerts.length ? '#efdfae' : 'var(--hk-line)' }}>
        <div className="hk-ctitle" id="home-health-alerts-title">
          重要健康提醒
          <span className={`hk-badge ${visibleHomeAlerts.length ? 'hk-b-amber' : 'hk-b-green'}`}>
            {visibleHomeAlerts.length ? `${visibleHomeAlerts.length} 件需要留意` : alertResourcesFailed ? '部分資料待重新載入' : '目前沒有待處理提醒'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: statusLine.tone === 'red' ? 'var(--hk-red)' : statusLine.tone === 'amber' ? 'var(--hk-amber)' : 'var(--hk-teal)', fontWeight: 800, lineHeight: 1.55 }}>
          <Icon name={statusLine.icon} size={20} />
          <span>{statusLine.text}</span>
        </div>
        {visibleHomeAlerts.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            {visibleHomeAlerts.map((item) => (
              <AlertRow key={item.id} color={item.color} title={item.title} badge={item.badge} badgeCls={item.badgeCls} desc={item.desc} onClick={item.onClick} />
            ))}
            {hiddenAlertCount > 0 && <Link href={href('/dashboard/tasks')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 8 }}>另外 {hiddenAlertCount} 件到待辦查看</Link>}
          </div>
        ) : (
          <p style={{ margin: '7px 0 0', color: 'var(--hk-ink-2)', fontSize: 13, lineHeight: 1.6 }}>{alertResourcesFailed ? '部分提醒資料暫時無法更新；畫面保留上次成功取得的內容，請重試。' : '這只代表目前已取得的資料沒有待處理提醒；身體不適時仍應依實際狀況就醫。'}</p>
        )}
      </section>

      <div className="hk-home-overview-grid" aria-label="健康全貌摘要">
        <section className="hk-card hk-home-overview-card">
          <div className="hk-ctitle">目前成員</div>
          <h2>{scopeLabel}</h2>
          <p>{members.length > 1 && !activeMember ? `目前可查看 ${members.length} 位家庭成員的資料。` : '目前頁面會依選取的成員顯示資料。'}</p>
          <SourceBadge source="家庭成員與目前選取範圍" />
        </section>

        <section className="hk-card hk-home-overview-card">
          <div className="hk-ctitle">最後更新</div>
          <h2>{latestUpdatedAt ? relativeTime(latestUpdatedAt) : '尚未取得'}</h2>
          <p>{latestUpdatedAt ? `最近一筆資料時間：${new Date(latestUpdatedAt).toLocaleString('zh-TW')}` : '目前沒有可顯示的更新時間。'}</p>
          <SourceBadge source="量測、文件或醫療團隊整理時間" />
        </section>

        <section className="hk-card hk-home-overview-card">
          <div className="hk-ctitle">目前病況</div>
          {currentConditions.length > 0 ? (
            <div className="hk-overview-list">
              {currentConditions.map((problem) => (
                <div className="hk-overview-list-item" key={problem.id}>
                  <strong>{problemTitleForPatient(problem)}</strong>
                  {problem.verified_by_name && <SourceBadge confirmed label="已確認" />}
                </div>
              ))}
            </div>
          ) : <div className="hk-overview-empty">{failed('conditions') ? '病況摘要暫時無法載入，請重試。' : '目前沒有可顯示的病況摘要。'}</div>}
          <Link href={href('/dashboard/conditions')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看我的病況</Link>
        </section>

        <section className="hk-card hk-home-overview-card">
          <div className="hk-ctitle">目前用藥</div>
          {publishedMedications.length > 0 ? (
            <div className="hk-overview-list">
              {publishedMedications.slice(0, 3).map((medication) => (
                <div className="hk-overview-list-item" key={medication.id}>
                  <strong>{patientSafeText(medication.drug_name || medication.generic_name_en || medication.brand_name, '用藥項目')}</strong>
                  <span>{medication.frequency || medication.dose || '已發布'}</span>
                </div>
              ))}
            </div>
          ) : <div className="hk-overview-empty">{failed('medications') ? '用藥摘要暫時無法載入，請重試。' : '目前沒有醫療團隊發布的用藥摘要。'}</div>}
          <Link href={href('/dashboard/medications')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看目前用藥</Link>
        </section>

        <section className="hk-card hk-home-overview-card">
          <div className="hk-ctitle">最新量測與趨勢</div>
          {Object.keys(latestByType).length > 0 ? (
            <div className="hk-overview-list">
              {VITAL_TYPES.filter((vital) => latestByType[vital.key]).slice(0, 3).map((vital) => (
                <div className="hk-overview-list-item" key={vital.key}>
                  <strong>{vital.label}</strong>
                  <span>{vital.format(latestByType[vital.key])}</span>
                </div>
              ))}
            </div>
          ) : <div className="hk-overview-empty">{failed('records') ? '量測資料暫時無法載入，請重試。' : '目前沒有量測紀錄。'}</div>}
          <Link href={href('/dashboard/trends')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看趨勢</Link>
        </section>

        <section className="hk-card hk-home-overview-card">
          <div className="hk-ctitle">急診資料完整度</div>
          {emergencyAvailable != null && emergencyTotal != null ? (
            <>
              <h2>{emergencyAvailable}/{emergencyTotal} 項</h2>
              <p>{emergencyReadiness?.warnings?.length ? `有 ${emergencyReadiness.warnings.length} 項資料需要留意。` : '這是目前急診連結可提供的核心資料數量。'}</p>
            </>
          ) : <div className="hk-overview-empty">{failed('emergencyReadiness') ? '急診資料完整度暫時無法更新，請重試。' : '目前尚未有急診資料完整度。'}</div>}
          <SourceBadge source="急診資料準備狀態" />
          <Link href={href('/dashboard/emergency')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看急診資訊</Link>
        </section>
      </div>

      <div className="hk-home-secondary-grid">
        <section className="hk-card">
          <div className="hk-ctitle">
            待辦摘要
            <span className={`hk-badge ${openTodoCount ? 'hk-b-amber' : 'hk-b-green'}`}>{openTodoCount ? `${openTodoCount} 件` : '目前沒有待處理'}</span>
          </div>
          <div className="hk-overview-list">
            <div className="hk-overview-list-item"><span>提醒</span><strong>{dueReminders.length} 件</strong></div>
            <div className="hk-overview-list-item"><span>醫療團隊追蹤</span><strong>{activeCmoFollowUps.length} 件</strong></div>
            <div className="hk-overview-list-item"><span>補資料</span><strong>{pendingMissingRequests.length + pendingRequests.length} 件</strong></div>
          </div>
          <Link href={href('/dashboard/tasks')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看待辦</Link>
        </section>

        <section className="hk-card">
          <div className="hk-ctitle">
            最近活動
            <SourceBadge source="文件、量測與醫療團隊更新" />
          </div>
          {recentActivity.length > 0 ? (
            <div className="hk-overview-list">
              {recentActivity.map((activity) => (
                <Link key={activity.id} href={activity.href} className="hk-overview-list-item hk-overview-list-link">
                  <strong><Icon name="activity" size={15} /> {activity.title}</strong>
                  <span>{activity.label} · {relativeTime(activity.meta)}</span>
                </Link>
              ))}
            </div>
          ) : <div className="hk-overview-empty">{failed('records') || failed('documents') || failed('recommendation') ? '最近活動暫時無法完整載入，請重試。' : '目前沒有可顯示的最近活動。'}</div>}
        </section>
      </div>

      {/* 舊版重複摘要暫留供資料契約相容，但不再呈現；首頁只保留上方
          的健康全貌、待辦與最近活動三層資訊。 */}
      <div className="hk-home-grid" hidden style={{ display: 'none' }}>
        <div className="hk-home-main">
          {/* ① 今日健康狀態 */}
          <div className="hk-card hk-home-hero" style={heroStyle}>
            <div style={{ fontSize: 22, fontWeight: 850, lineHeight: 1.38, color: 'var(--hk-ink)' }}>
              <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 8, color: statusLine.tone === 'red' ? 'var(--hk-red)' : statusLine.tone === 'amber' ? 'var(--hk-amber)' : 'var(--hk-teal)' }}>
                <Icon name={statusLine.icon} size={22} />
              </span>{statusLine.text}
            </div>
            <div style={{ fontSize: 13, color: 'var(--hk-ink-2)', marginTop: 8 }}>
              {scopeLabel}
              {cmoRecommendationAt ? ` · 醫療團隊最近整理於 ${relativeTime(cmoRecommendationAt)}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <span className={`hk-badge ${visibleHomeAlerts.length ? 'hk-b-amber' : 'hk-b-green'}`}>{visibleHomeAlerts.length ? `${visibleHomeAlerts.length} 件重要事` : '無高風險提醒'}</span>
              <span className={`hk-badge ${processingDocs.length ? 'hk-b-amber' : 'hk-b-blue'}`}>{processingDocs.length ? `${processingDocs.length} 份資料整理中` : Object.keys(syncCounts).length ? '同步已更新' : '資料狀態穩定'}</span>
              <span className="hk-badge hk-b-cmo">{cmoRecommendation || topRec ? '醫療團隊有已確認內容' : '等待醫療團隊更新'}</span>
            </div>
          </div>

          {/* ② 重要提醒（僅有才出現，不製造焦慮） */}
          {visibleHomeAlerts.length > 0 && (
            <div className="hk-card">
              <div className="hk-ctitle">重要提醒
                <span className="hk-badge hk-b-amber">前 {visibleHomeAlerts.length} 項</span>
              </div>
              {visibleHomeAlerts.map((item) => (
                <AlertRow key={item.id} color={item.color} title={item.title} badge={item.badge} badgeCls={item.badgeCls} desc={item.desc} onClick={item.onClick} />
              ))}
              {hiddenAlertCount > 0 && (
                <Link href={href('/dashboard/reminders')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>
                  另外 {hiddenAlertCount} 項移到提醒頁查看
                </Link>
              )}
            </div>
          )}

          {/* ③ F1 需要注意 */}
          <div className="hk-card">
            <div className="hk-ctitle">需要注意
              {cmoRecommendation?.published_at && <span className="hk-badge hk-b-cmo">{relativeTime(cmoRecommendation.published_at)}</span>}
            </div>
            {cmoRecommendation || topRec ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))', gap: 8 }}>
                  {ATTENTION_FIELDS.map((field) => (
                    <div key={field.key} style={{ border: '1px solid var(--hk-line)', borderRadius: 8, padding: '10px 9px', minHeight: 62, background: '#fff' }}>
                      <div style={{ fontSize: 11, color: 'var(--hk-ink-3)', fontWeight: 800 }}>{field.label}</div>
                      <div style={{ marginTop: 6, fontSize: 14, color: 'var(--hk-ink)', fontWeight: 850, wordBreak: 'break-word' }}>
                        {hasAttentionCells ? (attentionCells[field.key] || '—') : field.key === 'condition' ? problemTitleForPatient(topRec) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.55, color: 'var(--hk-ink-2)' }}>
                  {cmoRecommendation
                    ? patientSafeText(cmoRecommendation.recommendation, cmoRecommendation.health_summary || '醫療團隊已完成一則健康內容。')
                    : `${problemTitleForPatient(topRec)} 已由醫療團隊整理。`}
                </div>
                {pendingMissingRequests.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {pendingMissingRequests.slice(0, 4).map((request) => (
                      <button
                        key={request.id}
                        type="button"
                        className="hk-badge hk-b-amber"
                        style={{ border: 'none', cursor: 'pointer' }}
                        onClick={() => router.push(href('/dashboard/reminders', { highlight: `missing-${request.id}` }))}
                      >
                        補資料：{requestTitleForPatient(request.title)}
                      </button>
                    ))}
                  </div>
                )}
                <Link href={href('/dashboard/health')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看健康全貌 <Icon name="arrowRight" size={16} /></Link>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--hk-ink-3)', padding: '6px 0' }}>
                醫療團隊整理完成後，內容會顯示在這裡。
              </div>
            )}
          </div>
        </div>

        <aside className="hk-home-side">
          <div className="hk-card">
            <div className="hk-ctitle">最新生命徵象</div>
            {VITAL_TYPES.map((vt) => {
              const latest = latestByType[vt.key];
              if (!latest) return null;
              const flag = vitalFlag(vt.key, latest.value1, latest.value2);
              return (
                <AlertRow
                  key={vt.key}
                  color={isAbnormal(flag) ? 'var(--hk-amber)' : 'var(--hk-green)'}
                  title={`${vt.label} ${vt.format(latest)}`}
                  badge={flag.label}
                  badgeCls={isAbnormal(flag) ? 'hk-b-amber' : 'hk-b-green'}
                  desc={latest.recorded_at ? `紀錄於 ${relativeTime(latest.recorded_at)}` : '最近一次量測'}
                  onClick={() => router.push(href('/dashboard/trends'))}
                />
              );
            })}
            {Object.keys(latestByType).length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--hk-ink-3)' }}>尚未有生命徵象紀錄。</div>
            )}
          </div>

          <div className="hk-card">
            <div className="hk-ctitle">目前用藥
              <span className="hk-badge hk-b-blue">{publishedLinkedMeds.length} 項</span>
            </div>
            {publishedLinkedMeds.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--hk-ink-3)' }}>目前沒有醫療團隊已發布的用藥摘要。</div>
            ) : publishedLinkedMeds.map((med) => (
              <AlertRow
                key={med.id}
                color="var(--hk-blue)"
                title={patientSafeText(med.drug_name || med.generic_name_en || med.brand_name, '用藥')}
                badge={med.frequency || med.dose || '用藥'}
                badgeCls="hk-b-blue"
                desc={patientSafeText(med.indication, '已由醫療團隊整理到病況內容')}
                onClick={() => router.push(href('/dashboard/conditions'))}
              />
            ))}
          </div>

          {activeCmoFollowUps.length > 0 && (
            <div className="hk-card">
              <div className="hk-ctitle">醫療團隊追蹤提醒
                <span className="hk-badge hk-b-blue">{activeCmoFollowUps.length} 件</span>
              </div>
              {activeCmoFollowUps.slice(0, 2).map((task) => (
                <AlertRow
                  key={task.id}
                  color={task.priority === 'high' ? 'var(--hk-red)' : 'var(--hk-blue)'}
                  title={requestTitleForPatient(task.item || task.reason)}
                  badge={task.suggested_date ? task.suggested_date : '待追蹤'}
                  badgeCls={task.priority === 'high' ? 'hk-b-red' : 'hk-b-blue'}
                  desc={patientSafeText(task.reason, '依醫療團隊內容持續追蹤')}
                  onClick={() => router.push(href('/dashboard/reminders', { highlight: `followup-${task.id}` }))}
                />
              ))}
              <Link href={href('/dashboard/reminders')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看追蹤提醒</Link>
            </div>
          )}

          {/* 急診保命連結（核心安全功能：產生 24h QR 給現場醫師唯讀） */}
          <div className="hk-card" style={{ borderColor: '#f2d3cf', background: 'linear-gradient(135deg,#ffffff,#faecea)' }}>
            <div className="hk-ctitle">急診保命連結</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--hk-ink-2)', lineHeight: 1.5 }}>產生 24 小時 QR，讓現場醫師唯讀看到保命資料（過敏／用藥／腎功能等）。</div>
              <Link href={href('/dashboard/emergency')} className="hk-btn hk-btn-sm" style={{ flexShrink: 0, whiteSpace: 'nowrap', background: '#c0453a', color: '#fff' }}>產生連結</Link>
            </div>
          </div>
        </aside>
      </div>
      <ReadOnlyNotice>
        這裡整理的是你目前提供、匯入或由醫療團隊確認的資料，不等同醫療診斷；若有急症疑慮，請直接就醫。
      </ReadOnlyNotice>
      </HomeDataState>
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
          <div aria-hidden="true" style={{ width: 96, height: 96, borderRadius: '50%', background: 'linear-gradient(135deg,#faecea,#f2d3cf)', color: '#a03a30', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 28px' }}><Icon name="alert" size={44} /></div>
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
          <div aria-hidden="true" style={{ width: 96, height: 96, borderRadius: '50%', background: 'linear-gradient(135deg,#d5e7ec,#cfe3e8)', color: '#33596a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 28px' }}><Icon name="family" size={44} /></div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--hk-ink)', marginBottom: 12 }}>還沒有家庭成員</h2>
          <p style={{ fontSize: 15, color: 'var(--hk-ink-2)', lineHeight: 1.8, marginBottom: 36 }}>先新增家庭成員，就可以開始記錄每個人的健康資料</p>
          <button onClick={() => router.push('/dashboard/settings')} className="hk-btn hk-btn-primary" style={{ width: 'auto', padding: '14px 36px' }}><Icon name="user" size={16} /> 新增第一位成員</button>
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
