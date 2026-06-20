'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from './member-context';
import { getTypeMeta } from './record-types';
import { cleanPatientProblems } from './problem-filter';
import { vitalFlag, isAbnormal } from './vital-range';
import { api } from '@/lib/api';
import { useSync } from '@/lib/sync';
import { useToast } from './toast-context';
import { memberDisplayName, memberHref, memberHrefWithCurrentSearch, memberQueryParams, normalizeMemberName } from '@/lib/members';

type RecordOut = {
  id: string;
  member_name: string;
  record_type: string;
  value1: string | null;
  value2: string | null;
  unit: string | null;
  note: string | null;
  recorded_at: string;
};

type CmoSummary = {
  total: number;
  active_count: number;
  resolved_count: number;
  last_verified_at: string | null;
  top_problems: Array<{
    id: number;
    display_name: string;
    display_layman: string | null;
    tier: number;
    is_suspected: boolean;
    verified_by_name: string | null;
  }>;
};

// ─── Vital metric definitions ─────────────────────────────────────────────────
// Quick-action link for body_composition types points to the body_composition form
const VITAL_TYPES = [
  {
    key: 'blood_pressure', label: '血壓', icon: '❤️', unit: 'mmHg', color: '#f44336',
    uploadType: 'blood_pressure',
    format: (r: RecordOut) => r.value2 ? `${r.value1}/${r.value2}` : (r.value1 ?? '–'),
  },
  {
    key: 'heart_rate', label: '心跳', icon: '💓', unit: 'bpm', color: '#e91e63',
    uploadType: 'heart_rate',
    format: (r: RecordOut) => r.value1 ?? '–',
  },
  {
    key: 'glucose', label: '血糖', icon: '🩸', unit: 'mg/dL', color: '#ff9800',
    uploadType: 'glucose',
    format: (r: RecordOut) => r.value1 ?? '–',
  },
  {
    key: 'weight', label: '體重', icon: '⚖️', unit: 'kg', color: '#2196f3',
    uploadType: 'body_composition',
    format: (r: RecordOut) => r.value1 ?? '–',
  },
  {
    key: 'steps', label: '步數', icon: '👟', unit: '步', color: '#4caf50',
    uploadType: 'steps',
    format: (r: RecordOut) => r.value1 ? Number(r.value1).toLocaleString() : '–',
  },
  {
    key: 'sleep', label: '睡眠', icon: '😴', unit: 'h', color: '#9c27b0',
    uploadType: 'sleep',
    format: (r: RecordOut) => r.value1 ?? '–',
  },
  {
    key: 'bmi', label: 'BMI', icon: '📊', unit: '', color: '#00bcd4',
    uploadType: 'body_composition',
    format: (r: RecordOut) => r.value1 ?? '–',
  },
  {
    key: 'body_fat', label: '體脂率', icon: '🔬', unit: '%', color: '#795548',
    uploadType: 'body_composition',
    format: (r: RecordOut) => r.value1 ?? '–',
  },
] as const;

type VitalKey = typeof VITAL_TYPES[number]['key'];

type MemberOverview = {
  id: string; name: string; relation: string; age: number | null; gender: string | null; color: string;
  latest_vitals: { type: string; value1: string | null; value2: string | null; recorded_at: string | null }[];
  active_meds: number; due_reminders: number; last_record_at: string | null;
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
}

function formatValue(r: RecordOut): string {
  if (r.record_type === 'blood_pressure' && r.value1 && r.value2) return `${r.value1}/${r.value2}`;
  return `${r.value1 ?? '–'} ${r.unit ?? ''}`.trim();
}

function SectionLabel({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
      <h2 style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>
        {title}
      </h2>
      {right}
    </div>
  );
}

// ─── Today overview (persona-first home band) ──────────────────────────────────
type TimelineItem = {
  id: string; at: string | null; actor: 'you' | 'medical_team' | 'system'; title: string;
  target_label?: string | null; target_type?: string | null; target_id?: string | null;
  member_name?: string | null;
  status?: string; available_actions?: string[]; short_description?: string | null; action_url?: string | null;
};
type ChangeRequest = {
  id: string;
  target_label?: string | null;
  target_type?: string | null;
  member_name?: string | null;
  status: string;
  action_url?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  patient_facing_note?: string | null;
  patient_note?: string | null;
};
type TReminder = {
  id: number | string;
  title: string;
  scheduled_date?: string | null;
  reminder_type?: string;
  type?: string;
  is_done?: boolean;
  status?: string;
  member_name?: string | null;
  member?: string | null;
};
type TProblem = { id: number; display_name: string; display_layman?: string | null; status: string; patient_tracking_state?: string | null; tier?: number };
type TMed = { id: number; drug_name?: string; name?: string; status?: string; is_active?: boolean; patient_reported_usage_status?: string | null; is_verified?: boolean | null; source?: string | null; updated_at?: string | null; created_at?: string | null };
type DocOut = {
  id: string;
  doc_type: string;
  file_name: string;
  note?: string | null;
  status?: string | null;
  processing_status?: string | null;
  processing_status_label?: string | null;
  processing_note?: string | null;
  next_action?: string | null;
  doc_date?: string | null;
  created_at?: string | null;
  is_verified?: boolean | null;
  linked_to_verified_data?: boolean | null;
};
type TodayTodoItem = {
  id: string;
  title: string;
  meta: string;
  status: string;
  cta: string;
  route: string;
  tone?: 'urgent' | 'info' | 'normal';
};
type Allergyish = { substance?: string; reaction?: string; drug_name?: string; dose?: string; is_verified?: boolean | null; source?: string | null; updated_at?: string | null; created_at?: string | null };
type CritTier1 = {
  drug_allergies?: Allergyish[]; food_allergies?: Allergyish[]; contrast_allergies?: Allergyish[];
  high_risk_medications?: Allergyish[]; implants?: { type?: string; device_type?: string; is_verified?: boolean | null; source?: string | null }[];
  renal_function?: { egfr?: number | null; is_dialysis?: boolean; is_verified?: boolean | null; source?: string | null } | null;
};
type Critical = { tier1?: CritTier1 } | null;
type RedZoneItem = {
  id?: string;
  key?: string;
  label?: string | null;
  value?: string | null;
  tier?: number;
  category?: string | null;
  status?: string | null;
  source?: string | null;
  is_verified?: boolean | null;
  last_reviewed_at?: string | null;
};
type RedZoneDetail = {
  tiers?: {
    tier1?: RedZoneItem[];
    tier2?: RedZoneItem[];
    tier3?: RedZoneItem[];
  };
} | null;

const USAGE_LABEL: Record<string, string> = {
  taking: '正在吃', not_taking: '沒有在吃', doctor_stopped: '醫師已停藥',
  course_completed: '療程吃完了', self_stopped: '自己先停了', side_effect_stopped: '因副作用停用', unsure: '不確定',
};
const TODO_STATUS_LABEL: Record<string, string> = {
  overdue: '已逾期',
  due_today: '今天到期',
  needs_clarification: '需要補充',
  needs_document_action: '需補件 / 重傳',
  patient_reported_active: '已同步給醫療團隊',
  pending_review: '待醫療團隊整理',
  document_processing: '整理中',
};
const TIMELINE_FALLBACK_LABEL: Record<string, string> = {
  medication_update: '你更新用藥實際狀況',
  'medication update': '你更新用藥實際狀況',
  'medication.update': '你更新用藥實際狀況',
};
const DOCUMENT_STATUS_STYLE: Record<string, { label: string; bg: string; color: string; border: string; next: string }> = {
  uploaded: { label: '已收到，未整理', bg: '#fff7ed', color: '#9a3412', border: '#fed7aa', next: '等待醫療團隊整理' },
  queued: { label: '等待處理', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', next: '等待 OCR / AI 或人工分類' },
  extracting: { label: 'AI 擷取中', bg: '#eef2ff', color: '#4338ca', border: '#c7d2fe', next: '完成後會交由醫療團隊確認' },
  needs_review: { label: 'CMO QA 中', bg: '#fefce8', color: '#854d0e', border: '#fde68a', next: '等待醫療團隊確認或補件要求' },
  confirmed: { label: '可作為摘要依據', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', next: '可從健康摘要追溯回原始文件' },
  failed: { label: '處理失敗', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', next: '請重新上傳清楚版本' },
  rejected: { label: '退件 / 需補件', bg: '#fef2f2', color: '#991b1b', border: '#fecaca', next: '請依醫療團隊說明補件或重傳' },
};

function documentStatus(doc?: DocOut | null): string {
  return doc?.processing_status || doc?.status || 'uploaded';
}

function documentStatusStyle(doc?: DocOut | null) {
  const status = documentStatus(doc);
  return DOCUMENT_STATUS_STYLE[status] ?? DOCUMENT_STATUS_STYLE.uploaded;
}

function todayStr(): string {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function OverviewCard({ title, children, cta }: { title: string; children: React.ReactNode; cta?: React.ReactNode }) {
  return (
    <div className="dashboard-overview-card" style={{ background: '#fff', borderRadius: '16px', padding: '18px 20px', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '128px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.5px' }}>{title}</span>
        {cta}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function normalizeReminderMember(member?: string | null): string {
  const value = (member ?? '').trim();
  return value === 'self' ? '本人' : value;
}

function reminderMember(reminder?: TReminder | null): string {
  return normalizeReminderMember(reminder?.member_name ?? reminder?.member);
}

function reminderRoute(reminder?: TReminder | null): string {
  if (!reminder) return '/dashboard/reminders';
  const params = new URLSearchParams({ highlight: String(reminder.id) });
  const member = reminderMember(reminder);
  if (member) params.set('member', member);
  return `/dashboard/reminders?${params.toString()}`;
}

function copyEvidenceTag(item?: { is_verified?: boolean | null; source?: string | null; last_reviewed_at?: string | null; updated_at?: string | null; created_at?: string | null }): string {
  const verified = item?.is_verified ? '已確認' : '未確認';
  const source = item?.source || '來源未記錄';
  const rawDate = item?.last_reviewed_at || item?.updated_at || item?.created_at || null;
  const date = rawDate ? new Date(rawDate).toLocaleDateString('zh-TW') : '日期未記錄';
  return `（${verified}；來源：${source}；日期：${date}）`;
}

function TodayOverview() {
  const router = useRouter();
  const sync = useSync();
  const { showToast } = useToast();
  const { activeMember, members } = useActiveMember();
  const [reminders, setReminders] = useState<TReminder[]>([]);
  const [problems, setProblems] = useState<TProblem[]>([]);
  const [meds, setMeds] = useState<TMed[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [critical, setCritical] = useState<Critical>(null);
  const [redZone, setRedZone] = useState<RedZoneDetail>(null);
  const [docs, setDocs] = useState<DocOut[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const params = memberQueryParams(activeMember);
    // allSettled (not per-call `.catch(()=>[])`) so a genuine fetch failure
    // surfaces as a retry banner instead of masquerading as "you have no data".
    const results = await Promise.allSettled([
      api.get('/api/patients/me/reminders', params),
      api.get('/api/patients/me/problems'),
      api.get('/api/medications', params),
      api.get('/api/patients/me/timeline', { limit: '20', ...(params ?? {}) }),
      api.get('/api/my/critical-summary', params),
      api.get('/api/patients/me/red-zone', params),
      api.get('/api/documents', params),
      api.get('/api/patients/me/sync-state', params),
      api.get('/api/patients/me/change-requests', params),
    ]);
    const at = (i: number): unknown =>
      results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<unknown>).value : null;
    const arr = (i: number): unknown[] => { const v = at(i); return Array.isArray(v) ? v : []; };
    setReminders(arr(0) as TReminder[]);
    setProblems(cleanPatientProblems(arr(1) as TProblem[]));  // 過濾呈現層垃圾名稱（如測試資料 SSSSSSSS）
    setMeds(arr(2) as TMed[]);
    setTimeline(arr(3) as TimelineItem[]);
    setCritical((at(4) as Critical) ?? null);
    setRedZone((at(5) as RedZoneDetail) ?? null);
    setDocs(arr(6) as DocOut[]);
    setCounts((at(7) as { counts?: Record<string, number> } | null)?.counts ?? {});
    setChangeRequests(arr(8) as ChangeRequest[]);
    // 401 already triggers a redirect inside the api client; any other rejection
    // means we genuinely failed to load part of the dashboard.
    setLoadError(results.some(r => r.status === 'rejected'));
  }, [activeMember]);

  // Fetch external data on mount + whenever the sync cursor advances.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, sync.version]);

  const today = todayStr();
  const dueReminders = reminders.filter(r => !r.is_done && r.status !== 'completed' && r.status !== 'deleted' && r.scheduled_date && r.scheduled_date <= today);
  const upcoming = reminders.filter(r => !r.is_done && r.scheduled_date && r.scheduled_date >= today).sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''));
  const nextVisit = upcoming.find(r => (r.reminder_type || r.type) === 'follow_up') ?? upcoming[0] ?? null;
  const nextVisitRoute = reminderRoute(nextVisit);
  const nextVisitMember = reminderMember(nextVisit);
  const activeMeds = meds.filter(m => m.is_active !== false && m.status !== 'stopped' && m.status !== 'completed' && m.status !== 'inactive');
  const notTaking = meds.filter(m => m.patient_reported_usage_status && m.patient_reported_usage_status !== 'taking');
  const tracked = problems.filter(p => p.status === 'following' || p.status === 'underlying');
  const chronicProblems = problems.filter(p => p.status === 'underlying');
  const followingProblems = problems.filter(p => p.status === 'following');
  const divergentTracking = problems.filter(p => p.patient_tracking_state && !['following', 'actively_treating'].includes(p.patient_tracking_state));
  // 折疊重複的時間軸項目（例如同一筆回診被連續更新數次），避免動態洗版
  const dedupeTimeline = (items: TimelineItem[]) => {
    const seen = new Set<string>();
    return items.filter(t => { const k = t.title || t.id; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家總覽' : '本人');
  const memberScopedHref = (path: string, extra?: Record<string, string | null | undefined>) => memberHref(path, activeMember, extra);
  const scopedRoute = (path: string): string => {
    const [base, query = ''] = path.split('?');
    const extra = Object.fromEntries(new URLSearchParams(query).entries());
    return memberScopedHref(base, extra);
  };
  const activeMemberName = normalizeMemberName(activeMember);
  const matchesActiveMember = (member?: string | null): boolean => !activeMemberName || normalizeMemberName(member) === activeMemberName;
  const clarificationRequests = changeRequests.filter((request) => request.status === 'needs_clarification' && matchesActiveMember(request.member_name));
  const needsSupplement = clarificationRequests.length;
  const t1 = critical?.tier1 ?? {};
  const redzoneCount = (t1.drug_allergies?.length ?? 0) + (t1.food_allergies?.length ?? 0) + (t1.contrast_allergies?.length ?? 0)
    + (t1.high_risk_medications?.length ?? 0) + (t1.implants?.length ?? 0) + (t1.renal_function ? 1 : 0);
  const nhiDocs = docs.filter((d) => {
    const text = `${d.doc_type} ${d.file_name} ${d.note ?? ''}`.toLowerCase();
    return text.includes('nhi') || text.includes('健保') || text.includes('健康存摺');
  });
  const latestNhi = nhiDocs[0] ?? null;
  const latestNhiDate = latestNhi?.doc_date || latestNhi?.created_at || null;
  const pendingNhiReview = counts.nhi_pending_review ?? counts.verified_drafts_awaiting_publish ?? 0;
  const publishedNhi = counts.nhi_published ?? counts.published_from_nhi ?? 0;
  const docsNeedingAction = docs.filter((d) => ['failed', 'rejected'].includes(documentStatus(d)));
  const docsWaitingForTeam = docs.filter((d) => ['uploaded', 'queued', 'extracting', 'needs_review'].includes(documentStatus(d)));
  const docsConfirmed = docs.filter((d) => documentStatus(d) === 'confirmed' || d.is_verified || d.linked_to_verified_data);
  const latestDoc = docs[0] ?? null;
  const latestDocStyle = documentStatusStyle(latestDoc);
  const latestDocDate = latestDoc?.doc_date || latestDoc?.created_at || null;
  const actionableDoc = docsNeedingAction[0] ?? null;
  const parsedNhiCount = (() => {
    const text = latestNhi?.note ?? '';
    const match = text.match(/(\d+)\s*(?:筆|rows?|records?|drafts?)/i);
    return match ? Number(match[1]) : null;
  })();
  const scopedTimeline = timeline.filter((t) => matchesActiveMember(t.member_name));
  const recentActivity = dedupeTimeline(scopedTimeline.filter(t => t.actor === 'you' || t.actor === 'medical_team')).slice(0, 5);
  const todoItems: TodayTodoItem[] = [
    ...dueReminders.slice(0, 4).map((r) => ({
      id: `reminder-${r.id}`,
      title: `${r.scheduled_date && r.scheduled_date < today ? '逾期提醒' : '今天到期'} · ${r.title}`,
      meta: r.scheduled_date ? `日期：${new Date(`${r.scheduled_date}T00:00:00`).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' })} · 類型：${r.reminder_type || r.type || '提醒'}` : '日期未設定',
      status: r.scheduled_date && r.scheduled_date < today ? 'overdue' : 'due_today',
      cta: '到提醒頁處理',
      route: reminderRoute(r),
      tone: 'urgent' as const,
    })),
    ...clarificationRequests.slice(0, 4).map((request) => ({
      id: `clarification-${request.id}`,
      title: `醫療團隊需要你補充 · ${request.target_label || '這筆資料'}`,
      meta: `${request.updated_at || request.created_at ? relativeTime(request.updated_at || request.created_at || '') : '時間未記錄'} · ${request.patient_facing_note || request.patient_note || '請補充資訊後送回醫療團隊'}`,
      status: 'needs_clarification',
      cta: '補充資料',
      route: scopedRoute(request.action_url || `/dashboard/clarifications/${request.id}`),
      tone: 'urgent' as const,
    })),
    ...docsNeedingAction.slice(0, 2).map((doc) => ({
      id: `doc-action-${doc.id}`,
      title: `文件需要處理 · ${doc.file_name}`,
      meta: doc.processing_note || '這份文件目前不能作為病歷整理依據，請查看文件庫的補件或重傳說明。',
      status: 'needs_document_action',
      cta: '查看文件狀態',
      route: memberScopedHref('/dashboard/documents'),
      tone: 'urgent' as const,
    })),
    ...(needsSupplement > 0 && clarificationRequests.length === 0 ? [{
      id: 'clarification-count',
      title: `醫療團隊需要你補充 · ${needsSupplement} 項資料`,
      meta: '目前有待補充項目，請到健康管理記錄查看 target、狀態與回覆入口。',
      status: 'needs_clarification',
      cta: '查看需要補充',
      route: memberScopedHref('/dashboard/history'),
      tone: 'urgent' as const,
    }] : []),
    ...notTaking.slice(0, 3).map((m) => ({
      id: `med-gap-${m.id}`,
      title: `用藥實際狀況待整理 · ${m.drug_name || m.name || '用藥'}`,
      meta: `你回報：${USAGE_LABEL[m.patient_reported_usage_status ?? ''] || m.patient_reported_usage_status || '狀態未明'} · 醫療團隊可在 CMO 端看到`,
      status: 'patient_reported_active',
      cta: '查看用藥',
      route: memberScopedHref('/dashboard/medications'),
      tone: 'info' as const,
    })),
    ...(docsWaitingForTeam.length > 0 ? [{
      id: 'documents-processing',
      title: `文件整理中 · ${docsWaitingForTeam.length} 份`,
      meta: '已收到的文件仍在 OCR / AI 擷取或醫療團隊 QA 中，尚未等於病歷整理完成。',
      status: 'document_processing',
      cta: '查看文件庫',
      route: memberScopedHref('/dashboard/documents'),
      tone: 'info' as const,
    }] : []),
    ...(pendingNhiReview > 0 ? [{
      id: 'nhi-pending',
      title: `NHI 待醫療團隊整理 · ${latestNhi?.file_name || '健康存摺匯入資料'}`,
      meta: `${pendingNhiReview} 筆待 review${publishedNhi ? ` · ${publishedNhi} 筆已發布` : ''}`,
      status: 'pending_review',
      cta: '查看 NHI 匯入',
      route: memberScopedHref('/dashboard/nhi'),
      tone: 'info' as const,
    }] : []),
  ].slice(0, 8);

  const copyForDoctor = async () => {
    const redZoneItems = [
      ...(redZone?.tiers?.tier1 ?? []),
      ...(redZone?.tiers?.tier2 ?? []),
    ].filter((item) => item.value || item.label);
    const lines: string[] = [
      `【HealthKeep 重點摘要】· ${scopeLabel} · 產生日期 ${today}`,
      '（HealthKeep 整理摘要，非正式病歷；每項請看確認狀態、來源與日期，並以現場評估與醫院正式病歷為準）',
    ];
    if (redZoneItems.length > 0) {
      lines.push('— 保命紅區 / 重要背景 —');
      redZoneItems.forEach((item) => {
        lines.push(`${item.label || '紅區資料'}：${item.value || '-'} ${copyEvidenceTag(item)}`);
      });
    } else if (redzoneCount > 0) {
      lines.push('— 保命紅區 —');
      (t1.drug_allergies ?? []).forEach(a => lines.push(`藥物過敏：${a.substance}${a.reaction ? `（${a.reaction}）` : ''} ${copyEvidenceTag(a)}`));
      (t1.contrast_allergies ?? []).forEach(a => lines.push(`顯影劑過敏：${a.substance} ${copyEvidenceTag(a)}`));
      (t1.food_allergies ?? []).forEach(a => lines.push(`食物過敏：${a.substance} ${copyEvidenceTag(a)}`));
      (t1.high_risk_medications ?? []).forEach(m => lines.push(`高風險用藥：${m.drug_name}${m.dose ? ` ${m.dose}` : ''} ${copyEvidenceTag(m)}`));
      (t1.implants ?? []).forEach(i => lines.push(`植入物：${i.type ?? i.device_type ?? ''} ${copyEvidenceTag(i)}`));
      if (t1.renal_function) lines.push(`腎功能：eGFR ${t1.renal_function.egfr ?? '-'}${t1.renal_function.is_dialysis ? '、洗腎中' : ''} ${copyEvidenceTag(t1.renal_function)}`);
    }
    if (tracked.length) { lines.push('— 追蹤中病症 —'); tracked.slice(0, 8).forEach(p => lines.push(`${p.display_layman || p.display_name}`)); }
    if (activeMeds.length) { lines.push('— 目前用藥 —'); activeMeds.slice(0, 12).forEach(m => lines.push(`${m.drug_name || m.name} ${copyEvidenceTag(m)}`)); }
    if (notTaking.length) { lines.push('— 病人回報未服用 —'); notTaking.forEach(m => lines.push(`${m.drug_name || m.name}：${USAGE_LABEL[m.patient_reported_usage_status ?? ''] ?? ''}`)); }
    const hasContent = redzoneCount > 0 || tracked.length > 0 || activeMeds.length > 0 || notTaking.length > 0;
    const text = hasContent
      ? lines.join('\n')
      : '目前 HealthKeep 尚未整理出 active 保命紅區，請仍以醫院正式病歷與現場評估為準。';
    try {
      await navigator.clipboard.writeText(text);
      showToast(hasContent ? '已複製重點摘要，可貼給醫師' : '尚無紅區資料，已複製提示訊息', hasContent ? 'success' : 'info');
    } catch { showToast('複製失敗，請手動選取', 'error'); }
  };

  // Concrete Red Zone item labels (not just a count) for the dashboard card.
  const rzItems: string[] = [];
  (t1.drug_allergies ?? []).forEach(a => rzItems.push(`藥物過敏：${a.substance}`));
  (t1.contrast_allergies ?? []).forEach(a => rzItems.push(`顯影劑過敏：${a.substance}`));
  (t1.food_allergies ?? []).forEach(a => rzItems.push(`食物過敏：${a.substance}`));
  (t1.high_risk_medications ?? []).forEach(m => rzItems.push(`高風險用藥：${m.drug_name}`));
  (t1.implants ?? []).forEach(i => rzItems.push(`植入物：${i.type ?? i.device_type ?? ''}`));
  if (t1.renal_function) rzItems.push(`腎功能：eGFR ${t1.renal_function.egfr ?? '-'}${t1.renal_function.is_dialysis ? '、洗腎中' : ''}`);

  const routeFor = (tt?: string | null, actionUrl?: string | null): string | null => {
    if (actionUrl) return actionUrl;
    switch (tt) {
      case 'reminder': case 'appointment': return '/dashboard/reminders';
      case 'problem': case 'condition': case 'change_request': case 'allergy': case 'red_zone': return '/dashboard/health-profile';
      case 'medication': case 'medication_regimen': case 'medication_event': return '/dashboard/medications';
      case 'source_document': return '/dashboard/documents';
      default: return null;
    }
  };
  const timelineTitle = (t: TimelineItem): string => {
    const base = t.title || '';
    const head = base.split(' · ')[0];
    const replacement = TIMELINE_FALLBACK_LABEL[head];
    if (!replacement) return base;
    return `${replacement}${t.target_label ? ` · ${t.target_label}` : ''}`;
  };
  const renderRow = (t: TimelineItem, prefix: string): React.ReactNode => {
    const route = routeFor(t.target_type, t.action_url);
    const href = route ? scopedRoute(route) : null;
    const isClar = t.status === 'needs_clarification';
    const hasLabel = Boolean(t.target_label && t.title.includes(t.target_label));
    return (
      <div key={t.id} onClick={() => { if (href) router.push(href); }}
        style={{ cursor: href ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: '1px', padding: '3px 0' }}>
        <div style={{ fontSize: '13px', color: '#334155', fontWeight: isClar ? 700 : 500 }}>
          {prefix}{timelineTitle(t)}{t.target_label && !hasLabel && !TIMELINE_FALLBACK_LABEL[(t.title || '').split(' · ')[0]] ? <span style={{ color: '#0f172a', fontWeight: 700 }}> · {t.target_label}</span> : null}
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', gap: '8px' }}>
          {t.at && <span>{relativeTime(t.at)}</span>}
          {isClar && <span style={{ color: '#b45309', fontWeight: 700 }}>需要你補充 →</span>}
          {!isClar && href && <span style={{ color: 'var(--primary)' }}>查看詳情 →</span>}
        </div>
      </div>
    );
  };

  const fmtDate = (s?: string | null) => s ? new Date(`${s}T00:00:00`).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' }) : '';
  const ctaBtn = (label: string, onClick: () => void, primary = false): React.ReactNode => (
    <button onClick={onClick} className={`dashboard-cta-button${primary ? ' primary' : ''}`} style={{
      padding: '10px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
      border: primary ? 'none' : '1px solid var(--gray-200)',
      background: primary ? 'var(--primary)' : '#fff', color: primary ? '#fff' : '#334155',
      whiteSpace: 'normal', textAlign: 'center',
    }}>{label}</button>
  );

  return (
    <div style={{ marginBottom: '32px' }}>
      {/* ── Load-failure banner (distinct from "you have no data") ── */}
      {loadError && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px',
          padding: '12px 16px', marginBottom: '16px', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '13px', color: '#b91c1c', fontWeight: 600 }}>
            部分資料載入失敗，畫面可能不完整——這不代表你沒有資料。請檢查連線後重試。
          </span>
          <button onClick={() => load()} style={{
            border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c',
            borderRadius: '8px', padding: '6px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
          }}>重新載入</button>
        </div>
      )}
      {/* Today header + at-a-glance todo chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0 }}>今天 · {scopeLabel}</h2>
        {dueReminders.length > 0 && (
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#b45309', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '20px', padding: '4px 12px' }}>
            {dueReminders.length} 項待回診 / 待辦
          </span>
        )}
        {needsSupplement > 0 && (
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '20px', padding: '4px 12px' }}>
            {needsSupplement} 項需要你補充
          </span>
        )}
        {notTaking.length > 0 && (
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#0e7490', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: '20px', padding: '4px 12px' }}>
            你標記 {notTaking.length} 項藥沒在吃
          </span>
        )}
        {docsNeedingAction.length > 0 && (
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '20px', padding: '4px 12px' }}>
            {docsNeedingAction.length} 份文件需補件
          </span>
        )}
        {docsWaitingForTeam.length > 0 && docsNeedingAction.length === 0 && (
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '20px', padding: '4px 12px' }}>
            {docsWaitingForTeam.length} 份文件整理中
          </span>
        )}
        {dueReminders.length === 0 && needsSupplement === 0 && docsNeedingAction.length === 0 && docsWaitingForTeam.length === 0 && (
          <span style={{ fontSize: '13px', color: '#64748b' }}>今天沒有待辦，已確認的資料可到健康摘要查看。</span>
        )}
      </div>

      {/* Primary CTAs — all functional */}
      <div className="dashboard-primary-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px' }}>
        {ctaBtn('🩺 剛看完醫生？更新回診資料', () => router.push(memberScopedHref('/dashboard/upload')), true)}
        {ctaBtn('📷 拍藥袋或報告', () => router.push(memberScopedHref('/dashboard/upload', { tab: 'file' })))}
        {ctaBtn('🔔 新增回診提醒', () => router.push(memberScopedHref('/dashboard/reminders')))}
        {ctaBtn('🩺 查看醫療團隊整理', () => router.push(memberScopedHref('/dashboard/health-profile')))}
        {ctaBtn('📋 複製給醫師', copyForDoctor)}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <OverviewCard title="今日待辦" cta={<button onClick={() => router.push(memberScopedHref('/dashboard/history'))} style={linkBtn}>查看完整紀錄</button>}>
          {todoItems.length > 0 ? (
            <div className="dashboard-todo-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
              {todoItems.map((item) => (
                <button key={item.id} onClick={() => router.push(item.route)} style={{
                  textAlign: 'left',
                  border: `1px solid ${item.tone === 'urgent' ? '#fed7aa' : item.tone === 'info' ? '#bae6fd' : '#e2e8f0'}`,
                  background: item.tone === 'urgent' ? '#fff7ed' : item.tone === 'info' ? '#f0f9ff' : '#fff',
                  borderRadius: '12px',
                  padding: '12px',
                  cursor: 'pointer',
                }}>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', lineHeight: 1.4 }}>{item.title}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>{item.meta}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
                    <span style={{ fontSize: '11px', color: item.tone === 'urgent' ? '#b45309' : '#0369a1', background: '#fff', borderRadius: '999px', padding: '2px 8px', fontWeight: 800 }}>{TODO_STATUS_LABEL[item.status] || item.status}</span>
                    <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 800 }}>{item.cta} →</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ border: '1px dashed #cbd5e1', borderRadius: '12px', padding: '14px', color: '#64748b', fontSize: '13px', lineHeight: 1.6 }}>
              今天沒有到期提醒、待補充資料或 NHI 待處理事項。若剛看完醫生，可以用上方按鈕上傳藥袋、報告或新增回診提醒。
            </div>
          )}
        </OverviewCard>
      </div>

      {/* Summary cards */}
      <div className="dashboard-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
        <OverviewCard title="下次回診 / 檢查" cta={<button onClick={() => router.push(nextVisitRoute)} style={linkBtn}>管理</button>}>
          {nextVisit ? (
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>{fmtDate(nextVisit.scheduled_date)}</div>
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>{nextVisit.title}</div>
              {nextVisitMember && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>成員：{nextVisitMember}</div>}
            </div>
          ) : (
            <button onClick={() => router.push(memberScopedHref('/dashboard/reminders'))} style={emptyBtn}>尚未設定，點此新增回診提醒 →</button>
          )}
        </OverviewCard>

        <OverviewCard title="目前用藥" cta={<button onClick={() => router.push(memberScopedHref('/dashboard/medications'))} style={linkBtn}>管理</button>}>
          {meds.length > 0 ? (
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>{activeMeds.length} 種使用中</div>
              {notTaking.length > 0 ? (
                <div style={{ fontSize: '12px', color: '#0e7490', marginTop: '4px' }}>你標記沒在吃：{notTaking.map(m => m.drug_name || m.name).slice(0, 3).join('、')}{notTaking.length > 3 ? ' 等' : ''}</div>
              ) : (
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>可隨時回報「我沒在吃」</div>
              )}
            </div>
          ) : (
            <button onClick={() => router.push(memberScopedHref('/dashboard/medications'))} style={emptyBtn}>尚無用藥紀錄，點此新增 →</button>
          )}
        </OverviewCard>

        <OverviewCard title="正在追蹤的病症" cta={<button onClick={() => router.push(memberScopedHref('/dashboard/health-profile'))} style={linkBtn}>查看</button>}>
          {tracked.length > 0 ? (
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
                {chronicProblems.length > 0 ? `${chronicProblems.length} 項長期慢性病` : `${followingProblems.length} 項追蹤中`}
              </div>
              {chronicProblems.length > 0 && followingProblems.length > 0 && (
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>另有 {followingProblems.length} 項追蹤中</div>
              )}
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                {(chronicProblems.length > 0 ? chronicProblems : followingProblems).slice(0, 3).map(p => p.display_layman || p.display_name).join('、')}
                {(chronicProblems.length > 0 ? chronicProblems : followingProblems).length > 3 ? ' 等' : ''}
              </div>
              {divergentTracking.length > 0 && <div style={{ fontSize: '11px', color: '#0e7490', marginTop: '4px' }}>{divergentTracking.length} 項你已更新追蹤偏好</div>}
            </div>
          ) : (
            <button onClick={() => router.push(memberScopedHref('/dashboard/health-profile'))} style={emptyBtn}>查看醫師健康摘要 →</button>
          )}
        </OverviewCard>

        <OverviewCard title="保命紅區 (Tier 1)" cta={<div style={{ display: 'flex', gap: 8 }}>{redzoneCount > 0 && <button onClick={copyForDoctor} style={linkBtn}>複製</button>}<button onClick={() => router.push(memberScopedHref('/dashboard/emergency'))} style={linkBtn}>🚑 急診連結</button><button onClick={() => router.push(memberScopedHref('/dashboard/redzone'))} style={linkBtn}>查看全部</button></div>}>
          {rzItems.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {rzItems.slice(0, 5).map((label, i) => (
                <div key={i} style={{ fontSize: '13px', color: '#7f1d1d', fontWeight: 600 }}>• {label}</div>
              ))}
              {rzItems.length > 5 && <div style={{ fontSize: '11px', color: '#94a3b8' }}>等 {rzItems.length} 項 · 點「複製給醫師」帶走完整版</div>}
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
              目前尚無醫療團隊整理的保命紅區。你可以先補充已知過敏或緊急聯絡人，醫療團隊整理後會顯示在這裡。
            </div>
          )}
        </OverviewCard>

        <OverviewCard title="資料整理狀態" cta={<button onClick={() => router.push(memberScopedHref('/dashboard/documents'))} style={linkBtn}>文件庫</button>}>
          {docs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="dashboard-doc-status-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: '8px' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '8px' }}>
                  <div style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a' }}>{docs.length}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>已上傳</div>
                </div>
                <div style={{ background: docsWaitingForTeam.length ? '#eff6ff' : '#f8fafc', border: `1px solid ${docsWaitingForTeam.length ? '#bfdbfe' : '#e2e8f0'}`, borderRadius: '10px', padding: '8px' }}>
                  <div style={{ fontSize: '18px', fontWeight: 900, color: docsWaitingForTeam.length ? '#1d4ed8' : '#64748b' }}>{docsWaitingForTeam.length}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>整理 / QA 中</div>
                </div>
                <div style={{ background: docsNeedingAction.length ? '#fef2f2' : '#f0fdf4', border: `1px solid ${docsNeedingAction.length ? '#fecaca' : '#bbf7d0'}`, borderRadius: '10px', padding: '8px' }}>
                  <div style={{ fontSize: '18px', fontWeight: 900, color: docsNeedingAction.length ? '#b91c1c' : '#15803d' }}>{docsNeedingAction.length || docsConfirmed.length}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>{docsNeedingAction.length ? '需補件' : '可作依據'}</div>
                </div>
              </div>
              {actionableDoc ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 12px', lineHeight: 1.5 }}>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#991b1b' }}>{actionableDoc.file_name}</div>
                  <div style={{ fontSize: '12px', color: '#7f1d1d', marginTop: 2 }}>{actionableDoc.next_action || '請依文件庫狀態補件或重新上傳。'}</div>
                </div>
              ) : latestDoc ? (
                <div style={{ background: latestDocStyle.bg, border: `1px solid ${latestDocStyle.border}`, borderRadius: '10px', padding: '10px 12px', lineHeight: 1.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: latestDocStyle.color, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {latestDoc.file_name}
                    </div>
                    <span style={{ fontSize: '10px', color: latestDocStyle.color, background: '#fff', borderRadius: '999px', padding: '2px 8px', fontWeight: 800, whiteSpace: 'nowrap' }}>
                      {latestDoc.processing_status_label || latestDocStyle.label}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: 3 }}>
                    {latestDocDate ? `${new Date(latestDocDate).toLocaleDateString('zh-TW')} · ` : ''}{latestDoc.next_action || latestDocStyle.next}
                  </div>
                </div>
              ) : null}
              <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                「已上傳」只代表收到原始檔；只有醫療團隊確認後，才會被當作白話摘要或健康檔案依據。
              </div>
            </div>
          ) : (
            <button onClick={() => router.push(memberScopedHref('/dashboard/upload', { tab: 'file' }))} style={emptyBtn}>
              尚未上傳文件。上傳藥袋、報告或健康存摺後，可在這裡追蹤處理與 QA 狀態 →
            </button>
          )}
        </OverviewCard>

        <OverviewCard title="NHI 匯入狀態" cta={<button onClick={() => router.push(memberScopedHref('/dashboard/nhi'))} style={linkBtn}>查看匯入</button>}>
          {latestNhi ? (
            <div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', lineHeight: 1.4 }}>{latestNhi.file_name}</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '5px' }}>
                匯入時間：{latestNhiDate ? new Date(latestNhiDate).toLocaleDateString('zh-TW') : '未記錄'} · 狀態：{latestNhi.status || '待整理'}
              </div>
              <div style={{ fontSize: '12px', color: '#0e7490', marginTop: '5px' }}>
                {parsedNhiCount ? `已解析約 ${parsedNhiCount} 筆 raw rows` : '已存入原始匯入資料'}
                {pendingNhiReview ? ` · ${pendingNhiReview} 筆待醫療團隊整理` : ''}
                {publishedNhi ? ` · ${publishedNhi} 筆已發布到健康檔案` : ''}
              </div>
            </div>
          ) : (
            <button onClick={() => router.push(memberScopedHref('/dashboard/upload'))} style={emptyBtn}>
              尚未匯入 NHI 健康存摺。上傳後可追蹤 raw data、CMO 整理與發布狀態 →
            </button>
          )}
        </OverviewCard>

        <OverviewCard title="最近動態">
          {recentActivity.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {recentActivity.map(t => renderRow(t, t.actor === 'medical_team' ? '✓ ' : '• '))}
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>目前尚無新動態。上傳資料、回診或新增提醒後會出現在這裡。</div>
          )}
        </OverviewCard>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = { border: 'none', background: 'none', color: 'var(--primary)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', padding: 0 };
const emptyBtn: React.CSSProperties = { border: 'none', background: 'none', color: 'var(--primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', padding: 0, textAlign: 'left' };

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members, membersLoading } = useActiveMember();
  const [records, setRecords] = useState<RecordOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [cmoSummary, setCmoSummary] = useState<CmoSummary | null>(null);
  const [familyOverview, setFamilyOverview] = useState<MemberOverview[]>([]);
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  // Fetch health records — works for both single member and 全部 mode
  useEffect(() => {
    if (membersLoading) return;
    if (members.length === 0) return;
    const url = activeMember
      ? `/api/records?member=${encodeURIComponent(activeMember)}&limit=50`
      : `/api/records?limit=50`; // 全部 mode: fetch all members
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: RecordOut[]) => setRecords(data))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [activeMember, members, membersLoading]);

  // Fetch CMO-verified health summary
  useEffect(() => {
    api.get('/api/patients/me/problems/summary')
      .then((data) => setCmoSummary(data as CmoSummary))
      .catch(() => setCmoSummary(null));
  }, []);

  // Fetch 家人狀態總覽（每位成員最新量測 / 用藥 / 待回診）
  useEffect(() => {
    api.get('/api/members/overview')
      .then((data) => setFamilyOverview(Array.isArray(data) ? data as MemberOverview[] : []))
      .catch(() => setFamilyOverview([]));
  }, [activeMember]);

  // Latest value per record type (API returns newest-first)
  const latestByType = useMemo(() => {
    const map: Partial<Record<VitalKey | string, RecordOut>> = {};
    for (const r of records) {
      if (!map[r.record_type]) map[r.record_type] = r;
    }
    return map;
  }, [records]);

  // 異常數值摘要（persona-first：首頁最上方先告訴病人「今天要注意什麼」）
  // 只取明確偏高/偏低（不含「留意」），避免通知疲勞。
  const abnormalVitals = useMemo(() => {
    const out: { key: string; label: string; value: string; flag: ReturnType<typeof vitalFlag> }[] = [];
    for (const vt of VITAL_TYPES) {
      const latest = latestByType[vt.key];
      if (!latest) continue;
      const flag = vitalFlag(vt.key, latest.value1, latest.value2);
      if (flag.level === 'high' || flag.level === 'low') {
        out.push({ key: vt.key, label: vt.label, value: vt.format(latest), flag });
      }
    }
    return out;
  }, [latestByType]);

  const activeMemberInfo = members.find(m => m.name === activeMember);
  const isAllMode = !activeMember; // 全部 mode
  const currentMemberHref = (path: string, extra?: Record<string, string | null | undefined>) => memberHref(path, activeMember, extra);
  const switchMember = (member: string) => {
    const normalized = normalizeMemberName(member);
    setActiveMember(normalized);
    router.replace(memberHrefWithCurrentSearch(pathname, searchParams.toString(), normalized), { scroll: false });
  };

  // ── No members yet ────────────────────────────────────────────────────────
  if (!membersLoading && members.length === 0) {
    return (
      <div className="page-wrap" style={{ flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{ width: '96px', height: '96px', borderRadius: '50%', background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '44px', margin: '0 auto 28px' }}>
            👨‍👩‍👧‍👦
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginBottom: '12px' }}>還沒有家庭成員</h2>
          <p style={{ fontSize: '15px', color: '#64748b', lineHeight: 1.8, marginBottom: '36px' }}>先新增家庭成員，就可以開始記錄每個人的健康數據</p>
          <button
            onClick={() => router.push('/dashboard/settings')}
            style={{ background: 'var(--primary)', color: '#fff', border: 'none', padding: '14px 36px', borderRadius: '12px', fontWeight: '700', fontSize: '15px', cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,123,255,0.35)' }}
          >
            + 新增第一位成員
          </button>
        </div>
      </div>
    );
  }

  // ── Main layout ───────────────────────────────────────────────────────────
  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%' }}>

        {/* ── Page header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '40px', paddingBottom: '28px', borderBottom: '1px solid var(--gray-200)',
          flexWrap: 'wrap', gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Avatar — member specific or family group icon */}
            {activeMemberInfo ? (
              <div style={{
                width: '56px', height: '56px', borderRadius: '50%', background: activeMemberInfo.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '18px', fontWeight: '800', color: '#fff', flexShrink: 0,
                boxShadow: `0 4px 16px ${activeMemberInfo.color}55`,
              }}>
                {activeMember.slice(0, 2)}
              </div>
            ) : (
              <div style={{
                width: '56px', height: '56px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #e0f2fe, #bae6fd)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '28px', flexShrink: 0,
              }}>
                👨‍👩‍👧‍👦
              </div>
            )}
            <div>
              <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', lineHeight: 1.2, margin: 0 }}>
                {activeMember ? `${activeMember}的健康總覽` : '家庭健康總覽'}
              </h1>
              {activeMemberInfo ? (
                <p style={{ fontSize: '13px', color: '#64748b', marginTop: '5px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span>{activeMemberInfo.relation}</span>
                  {activeMemberInfo.age && (<><span style={{ color: '#cbd5e1' }}>·</span><span>{activeMemberInfo.age} 歲</span></>)}
                  {activeMemberInfo.gender && (<><span style={{ color: '#cbd5e1' }}>·</span><span>{activeMemberInfo.gender}</span></>)}
                </p>
              ) : (
                <p style={{ fontSize: '13px', color: '#64748b', marginTop: '5px' }}>
                  {members.length} 位成員的數據總覽
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => router.push(currentMemberHref('/dashboard/upload'))}
            style={{
              background: 'var(--primary)', color: '#fff', border: 'none',
              padding: '12px 24px', borderRadius: '10px', fontWeight: '700',
              fontSize: '14px', cursor: 'pointer', flexShrink: 0,
              boxShadow: '0 2px 10px rgba(0,123,255,0.3)',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M6.5 1v11M1 6.5h11" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
            新增紀錄
          </button>
        </div>

        {/* ── 今日總覽（persona-first：今天要做什麼）── */}
        <TodayOverview />

        {/* ── 家人狀態總覽（照顧者一眼掌握每位家人）── */}
        {familyOverview.length > 1 && (
          <div style={{ marginBottom: '32px' }}>
            <SectionLabel title="家人狀態" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '12px' }}>
              {familyOverview.map(m => {
                const abn = m.latest_vitals.map(v => ({ v, f: vitalFlag(v.type, v.value1, v.value2) })).filter(x => isAbnormal(x.f));
                const isActive = m.name === activeMember;
                return (
                  <button
                    key={m.id}
                    onClick={() => switchMember(m.name)}
                    style={{
                      textAlign: 'left', background: '#fff', cursor: 'pointer',
                      border: `1.5px solid ${abn.length > 0 ? '#fecaca' : (isActive ? 'var(--primary)' : '#e2e8f0')}`,
                      borderRadius: '14px', padding: '14px', boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '18px', background: m.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>{m.name.slice(0, 1)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{m.name} <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>{m.relation}{m.age != null ? ` · ${m.age}歲` : ''}</span></div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>最後紀錄 {m.last_record_at ? relativeTime(m.last_record_at) : '尚無'}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px', minHeight: '22px' }}>
                      {abn.length > 0
                        ? abn.slice(0, 3).map(x => <span key={x.v.type} style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', background: x.f.bg, color: x.f.fg }}>{getTypeMeta(x.v.type).label} {x.f.label}</span>)
                        : <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', background: '#dcfce7', color: '#15803d' }}>數值正常</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '14px', marginTop: '10px', fontSize: '12px', color: '#475569' }}>
                      <span>💊 {m.active_meds} 種用藥</span>
                      <span style={{ color: m.due_reminders > 0 ? '#b45309' : '#94a3b8', fontWeight: m.due_reminders > 0 ? 700 : 400 }}>🔔 {m.due_reminders} 待回診</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 醫師健康摘要（最顯眼處）── */}
        {cmoSummary && cmoSummary.total > 0 && (
          <div
            onClick={() => router.push(currentMemberHref('/dashboard/health-profile'))}
            style={{
              background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
              borderRadius: '20px',
              padding: '24px 26px',
              marginBottom: '32px',
              border: '1px solid #a7f3d0',
              cursor: 'pointer',
              transition: 'transform 0.15s, box-shadow 0.15s',
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(16,185,129,0.18)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.transform = '';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '48px', height: '48px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '24px',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.35)',
                  }}
                >
                  🩺
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#064e3b', margin: 0 }}>
                      醫師健康摘要
                    </h2>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                      background: '#10b981', color: '#fff', letterSpacing: '0.3px',
                    }}>
                      ✓ 已確認
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: '#047857', margin: '3px 0 0' }}>
                    {cmoSummary.active_count > 0
                      ? `${cmoSummary.active_count} 項進行中、${cmoSummary.resolved_count} 項已改善`
                      : `${cmoSummary.resolved_count} 項已改善`}
                  </p>
                  {activeMember && (
                    <p style={{ fontSize: '11px', color: '#047857', margin: '3px 0 0', opacity: 0.85 }}>
                      目前 Problem 摘要仍為家庭帳號層級；用藥、提醒、紀錄與文件已依 {activeMember} 篩選。
                    </p>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '13px', color: '#047857', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                查看完整檔案
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            {cleanPatientProblems(cmoSummary.top_problems).length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {cleanPatientProblems(cmoSummary.top_problems).map(p => (
                  <div
                    key={p.id}
                    style={{
                      background: 'rgba(255,255,255,0.7)',
                      borderRadius: '10px',
                      padding: '8px 14px',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#064e3b',
                      display: 'flex', alignItems: 'center', gap: '6px',
                      border: '1px solid rgba(16,185,129,0.2)',
                    }}
                  >
                    {p.tier === 1 && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#dc2626' }} />}
                    {p.tier === 2 && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ea580c' }} />}
                    {p.tier >= 3 && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#94a3b8' }} />}
                    {p.display_layman || p.display_name}
                    {p.is_suspected && (
                      <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 700 }}>(疑似)</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 沒有醫師確認資料時，鼓勵上傳 ── */}
        {cmoSummary && cmoSummary.total === 0 && records.length > 0 && (
          <div
            style={{
              background: '#f8fafc',
              borderRadius: '14px',
              padding: '14px 20px',
              marginBottom: '28px',
              border: '1px dashed #cbd5e1',
              display: 'flex', alignItems: 'center', gap: '12px',
              fontSize: '13px', color: '#64748b',
            }}
          >
            <span style={{ fontSize: '18px' }}>🩺</span>
            <span>您的醫療團隊正在審閱資料中，確認後將顯示在「醫師健康摘要」</span>
          </div>
        )}

        {/* ── Loading ── */}
        {(membersLoading || loading) && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>載入中...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── Empty state (has member selected but no records) ── */}
        {!loading && !membersLoading && !isAllMode && activeMember && records.length === 0 && (
          <div style={{ background: '#fff', borderRadius: '20px', padding: '72px 40px', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: '64px', marginBottom: '24px' }}>📊</div>
            <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', marginBottom: '12px' }}>{activeMember} 還沒有任何健康紀錄</h3>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.8, marginBottom: '36px', maxWidth: '380px', margin: '0 auto 36px' }}>
              開始記錄血壓、血糖、體重等數值，<br />系統會自動分析健康趨勢
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {(['blood_pressure', 'glucose', 'body_composition'] as const).map(type => {
                const t = getTypeMeta(type === 'body_composition' ? 'weight' : type);
                const label = type === 'body_composition' ? '身體組成' : t.label;
                return (
                  <button key={type} onClick={() => router.push(currentMemberHref('/dashboard/upload', { type }))} style={{ padding: '12px 24px', borderRadius: '10px', border: `1.5px solid ${t.color}`, background: `${t.color}0d`, color: t.color, fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {t.icon} 記錄{label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Main content sections (has records) ── */}
        {!loading && records.length > 0 && (
          <>
            {/* ── 今天要注意什麼（異常數值，置頂提示）── */}
            {abnormalVitals.length > 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '16px', padding: '14px 18px', marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '22px', lineHeight: 1 }}>⚠️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 850, color: '#b91c1c' }}>今天有 {abnormalVitals.length} 項數值需要注意</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {abnormalVitals.map(a => (
                      <span key={a.key} style={{ fontSize: '13px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', background: a.flag.bg, color: a.flag.fg }}>
                        {a.label} {a.value} · {a.flag.label}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px', lineHeight: 1.5 }}>這是依一般參考區間的提示，非診斷。若持續或有不適，請與醫療團隊討論。</div>
                </div>
              </div>
            )}
            {/* ── Section: 最新生命徵象 ── */}
            <div style={{ marginBottom: '44px' }}>
              <SectionLabel
                title="最新生命徵象"
                right={records[0] && (
                  <span style={{ fontSize: '12px', color: '#c0cada' }}>更新於 {relativeTime(records[0].recorded_at)}</span>
                )}
              />

              <div className="grid-vitals">
                {VITAL_TYPES.map(vt => {
                  const latest = latestByType[vt.key];
                  const flag = latest ? vitalFlag(vt.key, latest.value1, latest.value2) : null;
                  const abnormal = isAbnormal(flag);
                  return (
                    <div
                      key={vt.key}
                      onClick={() => router.push(currentMemberHref('/dashboard/upload', { type: vt.uploadType }))}
                      style={{
                        background: '#fff', borderRadius: '16px', padding: '22px 20px',
                        boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
                        borderTop: `3px solid ${abnormal && flag ? flag.color : (latest ? vt.color : '#e2e8f0')}`,
                        transition: 'transform 0.15s, box-shadow 0.15s',
                        display: 'flex', flexDirection: 'column', minHeight: '140px',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                        (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-md)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.transform = '';
                        (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-sm)';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                        <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: latest ? `${vt.color}15` : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                          {vt.icon}
                        </div>
                        {latest ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                            {abnormal && flag && (
                              <span style={{ fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', background: flag.bg, color: flag.fg }}>{flag.label}</span>
                            )}
                            <span style={{ fontSize: '11px', color: '#c0cada' }}>{relativeTime(latest.recorded_at)}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '10px', background: '#f1f5f9', color: '#94a3b8', padding: '3px 9px', borderRadius: '20px', fontWeight: '600' }}>未記錄</span>
                        )}
                      </div>

                      <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600', letterSpacing: '0.2px' }}>{vt.label}</div>

                      {/* In 全部 mode, also show which member this reading belongs to */}
                      {isAllMode && latest?.member_name && (
                        <div style={{ fontSize: '10px', color: '#bbb', marginTop: '2px' }}>{latest.member_name}</div>
                      )}

                      <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
                        {latest ? (
                          <>
                            <div style={{ fontSize: '28px', fontWeight: '800', color: abnormal && flag ? flag.fg : '#0f172a', lineHeight: 1, letterSpacing: '-0.5px' }}>
                              {vt.format(latest)}
                            </div>
                            {vt.unit && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>{vt.unit}</div>}
                          </>
                        ) : (
                          <div style={{ fontSize: '14px', fontWeight: '700', color: vt.color, opacity: 0.55 }}>+ 點此記錄</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Section: 近期紀錄 ── */}
            <div style={{ marginBottom: '44px' }}>
              <SectionLabel
                title="近期紀錄"
                right={
                  <button
                    onClick={() => router.push('/dashboard/history')}
                    style={{ border: 'none', background: 'none', color: 'var(--primary)', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: 0 }}
                  >
                    查看全部
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                }
              />

              <div style={{ background: '#fff', borderRadius: '16px', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                {records.slice(0, 8).map((r, index) => {
                  const meta = getTypeMeta(r.record_type);
                  const isLast = index === Math.min(records.length, 8) - 1;
                  return (
                    <div
                      key={r.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '15px 20px', borderBottom: isLast ? 'none' : '1px solid #f1f5f9', transition: 'background 0.12s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#fafbfc'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
                    >
                      <div style={{ width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0, background: `${meta.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                        {meta.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{meta.label}</span>
                          <span style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a' }}>{formatValue(r)}</span>
                          {/* In 全部 mode, show which member */}
                          {isAllMode && r.member_name && (
                            <span style={{ fontSize: '10px', background: '#f0f4f8', color: '#666', padding: '2px 8px', borderRadius: '20px' }}>{r.member_name}</span>
                          )}
                        </div>
                        {r.note && <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.note}</div>}
                      </div>
                      <div style={{ fontSize: '12px', color: '#c0cada', flexShrink: 0 }}>{relativeTime(r.recorded_at)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Bottom row: Quick actions + More features ── */}
            <div className="grid-bottom-sections">

              {/* Quick actions */}
              <div>
                <SectionLabel title="快速記錄" />
                <div className="dashboard-quick-record-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {VITAL_TYPES.map(vt => (
                    <button
                      key={vt.key}
                      onClick={() => router.push(currentMemberHref('/dashboard/upload', { type: vt.uploadType }))}
                      style={{
                        padding: '16px 8px', borderRadius: '14px', border: `1.5px solid ${vt.color}22`,
                        background: `${vt.color}0a`, color: vt.color,
                        fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px',
                        transition: 'background 0.15s, border-color 0.15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = `${vt.color}18`;
                        (e.currentTarget as HTMLButtonElement).style.borderColor = `${vt.color}44`;
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = `${vt.color}0a`;
                        (e.currentTarget as HTMLButtonElement).style.borderColor = `${vt.color}22`;
                      }}
                    >
                      <span style={{ fontSize: '26px' }}>{vt.icon}</span>
                      {vt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* More features */}
              <div>
                <SectionLabel title="更多功能" />
                <div className="dashboard-feature-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                  {[
                    { icon: '🩺', label: '醫師健康摘要', desc: '醫師確認的健康狀況', href: '/dashboard/health-profile', color: '#10b981' },
                    { icon: '📈', label: '趨勢分析',   desc: '健康指標趨勢圖表', href: '/dashboard/trends',     color: '#00bcd4' },
                    { icon: '📊', label: '健康數值整理', desc: '規則式趨勢提醒', href: '/dashboard/ai',         color: '#7c3aed' },
                    { icon: '🏥', label: '慢性病管理',  desc: '記錄疾病與追蹤',  href: '/dashboard/conditions', color: '#f44336' },
                    { icon: '💊', label: '藥物追蹤',    desc: '管理用藥清單',    href: '/dashboard/medications', color: '#4caf50' },
                    { icon: '🔔', label: '回診紀錄',    desc: '回診預約與紀錄',  href: '/dashboard/reminders',  color: '#ff9800' },
                    { icon: '📋', label: '歷史紀錄',    desc: '完整時間軸查詢',  href: '/dashboard/history',    color: '#2196f3' },
                    { icon: '📁', label: '文件庫',      desc: '存放報告處方箋',  href: '/dashboard/documents',  color: '#607d8b' },
                    {
                      icon: '⚙️',
                      label: members.length > 1 ? '家庭設定' : '個人設定',
                      desc: members.length > 1 ? '成員管理與設定' : '帳號、通知與資料設定',
                      href: '/dashboard/settings',
                      color: '#94a3b8',
                    },
                  ].map(f => (
                    <button
                      key={f.href}
                      onClick={() => router.push(f.href)}
                      style={{
                        padding: '16px', borderRadius: '14px', border: `1px solid ${f.color}18`,
                        background: '#fff', textAlign: 'left', cursor: 'pointer',
                        boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'flex-start', gap: '12px',
                        transition: 'transform 0.15s, box-shadow 0.15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-md)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.transform = '';
                        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-sm)';
                      }}
                    >
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0, background: `${f.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
                        {f.icon}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '3px', whiteSpace: 'nowrap' }}>{f.label}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>{f.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </>
        )}
      </div>
    </div>
  );
}
