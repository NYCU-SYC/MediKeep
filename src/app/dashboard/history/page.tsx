'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { RECORD_TYPE_META, getTypeMeta } from '../record-types';
import { useSync } from '@/lib/sync';
import { memberHrefWithCurrentSearch, normalizeMemberName } from '@/lib/members';

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

type ActivityEvent = {
  id: string;
  patient_id?: string;
  actor?: 'you' | 'medical_team' | 'system';
  actor_role?: 'patient' | 'family_manager' | 'cmo_admin' | 'system' | string;
  actor_label?: string;
  event_type?: string;
  target_type?: string | null;
  target_id?: string | null;
  target_label?: string | null;
  member_name?: string | null;
  title: string;
  short_description?: string | null;
  status?: string;
  priority?: 'low' | 'medium' | 'high' | string;
  related_problem_label?: string | null;
  source_document_id?: string | null;
  patient_facing_note?: string | null;
  action_url?: string | null;
  available_actions?: string[];
  created_at?: string | null;
  updated_at?: string | null;
  at?: string | null;
};

type ActivityTab = 'all' | 'mine' | 'team' | 'action_required';

const ACTIVITY_TABS: Array<{ key: ActivityTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '我做的事' },
  { key: 'team', label: '醫療團隊整理' },
  { key: 'action_required', label: '需要我處理' },
];

const STATUS_LABELS: Record<string, string> = {
  pending: '待處理',
  processing: '整理中',
  needs_clarification: '需要補充',
  replied: '已回覆',
  completed: '已完成',
  published: '已發布',
  unpublished: '暫時撤下',
  withdrawn: '已撤回',
  reverted: '已還原',
  rejected: '未採用',
  failed: '失敗',
  kept_as_patient_reported: '保留為你回報',
  reconciled_to_official: '已整理到正式紀錄',
  done: '已記錄',
};

const STATUS_META: Record<string, { label: string; bg: string; color: string; border: string; helper: string }> = {
  pending: { label: '待處理', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', helper: '已排入處理流程。' },
  processing: { label: '整理中', bg: '#eef2ff', color: '#4338ca', border: '#c7d2fe', helper: '資料仍在整理，尚未完成確認。' },
  needs_clarification: { label: '需要你補充', bg: '#fff7ed', color: '#b45309', border: '#fed7aa', helper: '請補充資料後送回醫療團隊。' },
  replied: { label: '已回覆', bg: '#f0f9ff', color: '#0369a1', border: '#bae6fd', helper: '你的補充已送回醫療團隊。' },
  completed: { label: '已完成', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', helper: '這個動作已完成。' },
  published: { label: '已發布', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', helper: '已更新到 User 端可見內容。' },
  unpublished: { label: '暫時撤下', bg: '#f8fafc', color: '#475569', border: '#e2e8f0', helper: '醫療團隊暫時撤下先前發布內容。' },
  withdrawn: { label: '已撤回', bg: '#f8fafc', color: '#475569', border: '#e2e8f0', helper: '這次異動已撤回。' },
  reverted: { label: '已還原', bg: '#f8fafc', color: '#475569', border: '#e2e8f0', helper: '上一個操作已被還原。' },
  rejected: { label: '未採用', bg: '#fef2f2', color: '#991b1b', border: '#fecaca', helper: '醫療團隊未採用這次異動。' },
  failed: { label: '失敗', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', helper: '這個處理未成功，請查看下一步。' },
  done: { label: '已記錄', bg: '#f1f5f9', color: '#475569', border: '#e2e8f0', helper: '自我紀錄已保存。' },
};

const TYPE_LABELS: Record<string, string> = {
  reminder: '提醒',
  appointment: '回診',
  problem: 'Problem',
  condition: '疾病',
  medication: '用藥',
  medication_regimen: '用藥',
  medication_event: '用藥事件',
  allergy: '紅區/過敏',
  red_zone: '保命紅區',
  source_document: '來源文件',
  change_request: '資料異動',
  measurement: '量測',
};

const EVENT_FALLBACK_LABELS: Record<string, string> = {
  medication_update: '你更新用藥實際狀況',
  'medication update': '你更新用藥實際狀況',
  'medication.update': '你更新用藥實際狀況',
  reminder_create: '你新增提醒',
  reminder_update: '你更新提醒',
  reminder_delete: '你刪除提醒',
};

function activityTime(e: ActivityEvent): string {
  return e.created_at || e.at || e.updated_at || '';
}

function activityTitle(e: ActivityEvent): string {
  const title = e.title || '';
  const eventType = e.event_type || '';
  const label = EVENT_FALLBACK_LABELS[eventType] || EVENT_FALLBACK_LABELS[title.split(' · ')[0]];
  if (!label) return title;
  const target = e.target_label ? ` · ${e.target_label}` : '';
  return `${label}${target}`;
}

function routeForActivity(e: ActivityEvent): string {
  if (e.action_url) return e.action_url;
  switch (e.target_type) {
    case 'reminder':
    case 'appointment':
      return '/dashboard/reminders';
    case 'medication':
    case 'medication_regimen':
    case 'medication_event':
      return '/dashboard/medications';
    case 'source_document':
      return '/dashboard/documents';
    case 'problem':
    case 'condition':
    case 'allergy':
    case 'red_zone':
    case 'change_request':
      return '/dashboard/health-profile';
    default:
      return '/dashboard/history';
  }
}

function activityNeedsAction(e: ActivityEvent): boolean {
  return e.status === 'needs_clarification' || Boolean(e.available_actions?.includes('reply'));
}

function activityStatusMeta(status: string) {
  return STATUS_META[status] ?? STATUS_META.done;
}

function formatValue(r: RecordOut): string {
  if (r.record_type === 'blood_pressure' && r.value1 && r.value2) {
    return `${r.value1}/${r.value2} ${r.unit ?? ''}`;
  }
  return `${r.value1 ?? '-'} ${r.unit ?? ''}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
}

export default function HistoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const sync = useSync();
  // Refetch the activity stream whenever a timeline-touching event arrives
  // (CMO publish, clarification, reconcile…) so this page never sits stale.
  const timelineVersion = sync.viewVersions['patient_timeline'] ?? 0;
  const memberFilterOptions = ['全部', ...members.map(m => m.name)];
  const [records, setRecords] = useState<RecordOut[]>([]);
  const [loading, setLoading] = useState(true);
  // Initialise from global activeMember; sync whenever the header chip changes
  const [filterMember, setFilterMember] = useState(() => activeMember || '全部');
  const [filterType, setFilterType] = useState('全部');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [recordsLoadError, setRecordsLoadError] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityLoadError, setActivityLoadError] = useState(false);
  const [activityTab, setActivityTab] = useState<ActivityTab>('all');
  const [activityType, setActivityType] = useState('全部');
  const [activityStatus, setActivityStatus] = useState('全部');
  const [activityFrom, setActivityFrom] = useState('');
  const [activityTo, setActivityTo] = useState('');
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  const switchMember = (label: string) => {
    const normalized = label === '全部' ? '' : normalizeMemberName(label);
    setFilterMember(label);
    setActiveMember(normalized);
    router.replace(memberHrefWithCurrentSearch(pathname, searchParams.toString(), normalized), { scroll: false });
  };
  const [activitySource, setActivitySource] = useState('全部');
  const [activityOnlyAction, setActivityOnlyAction] = useState(false);

  // Keep local filter in sync with global member selection
  useEffect(() => {
    setFilterMember(activeMember || '全部');
  }, [activeMember]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setRecordsLoadError(false);
    try {
      const params = new URLSearchParams();
      if (filterMember !== '全部') params.set('member', filterMember);
      if (filterType !== '全部') params.set('record_type', filterType);
      params.set('limit', '200');
      const resp = await fetch(`/api/records?${params}`, { credentials: 'include' });
      if (resp.ok) {
        const data: RecordOut[] = await resp.json();
        setRecords(data);
      } else {
        throw new Error('records_load_failed');
      }
    } catch {
      setRecordsLoadError(true);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [filterMember, filterType]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityLoadError(false);
    try {
      const params = new URLSearchParams({ limit: '120' });
      if (filterMember !== '全部') params.set('member', filterMember);
      const resp = await fetch(`/api/patients/me/timeline?${params}`, { credentials: 'include' });
      if (!resp.ok) throw new Error('timeline_load_failed');
      setActivity(await resp.json() as ActivityEvent[]);
    } catch {
      setActivityLoadError(true);
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, [filterMember]);

  useEffect(() => { fetchActivity(); }, [fetchActivity, timelineVersion]);

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這筆紀錄嗎？這會 soft delete，系統仍會保留 audit/history。')) return;
    setDeleting(id);
    try {
      await fetch(`/api/records/${id}`, { method: 'DELETE', credentials: 'include' });
      setRecords(prev => prev.filter(r => r.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  // Group records by date for timeline display
  const filteredRecords = records.filter(r => {
    if (filterMember !== '全部' && r.member_name !== filterMember) return false;
    if (filterType !== '全部' && r.record_type !== filterType) return false;
    return true;
  });

  const byDate: Record<string, RecordOut[]> = {};
  filteredRecords.forEach(r => {
    const day = r.recorded_at.slice(0, 10);
    if (!byDate[day]) byDate[day] = [];
    byDate[day].push(r);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const activityTypes = useMemo(() => {
    const types = Array.from(new Set(activity.map(e => e.target_type).filter(Boolean) as string[]));
    return ['全部', ...types.sort()];
  }, [activity]);
  const activityStatuses = useMemo(() => {
    const statuses = Array.from(new Set(activity.map(e => e.status).filter(Boolean) as string[]));
    return ['全部', ...statuses.sort()];
  }, [activity]);
  const activitySources = useMemo(() => {
    const sources = Array.from(new Set(activity.map(e => e.source_document_id).filter(Boolean) as string[]));
    return ['全部', '有來源文件', ...sources.sort()];
  }, [activity]);
  const filteredActivity = useMemo(() => {
    const memberName = filterMember === '全部' ? '' : normalizeMemberName(filterMember);
    return activity.filter((e) => {
      const at = activityTime(e).slice(0, 10);
      if (memberName && normalizeMemberName(e.member_name) !== memberName) return false;
      if (activityTab === 'mine' && !(e.actor === 'you' || e.actor_role === 'patient')) return false;
      if (activityTab === 'team' && !(e.actor === 'medical_team' || e.actor_role === 'cmo_admin')) return false;
      if (activityTab === 'action_required' && !activityNeedsAction(e)) return false;
      if (activityOnlyAction && !activityNeedsAction(e)) return false;
      if (activityType !== '全部' && e.target_type !== activityType) return false;
      if (activityStatus !== '全部' && e.status !== activityStatus) return false;
      if (activityFrom && at && at < activityFrom) return false;
      if (activityTo && at && at > activityTo) return false;
      if (activitySource === '有來源文件' && !e.source_document_id) return false;
      if (activitySource !== '全部' && activitySource !== '有來源文件' && e.source_document_id !== activitySource) return false;
      return true;
    });
  }, [activity, activityFrom, activityOnlyAction, activitySource, activityStatus, activityTab, activityTo, activityType, filterMember]);
  const actionRequiredCount = filteredActivity.filter(activityNeedsAction).length;
  const teamActivityCount = filteredActivity.filter(e => e.actor === 'medical_team' || e.actor_role === 'cmo_admin').length;
  const sourceLinkedCount = filteredActivity.filter(e => Boolean(e.source_document_id)).length;
  const routeWithMember = useCallback((path: string): string => {
    if (filterMember === '全部') return path;
    const member = normalizeMemberName(filterMember);
    if (!member) return path;
    const [base, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    params.set('member', member);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }, [filterMember]);

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
        <button onClick={() => router.back()} style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#fff', border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer', color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow-sm)' }}>←</button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#111' }}>健康管理記錄</h2>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '2px' }}>互動紀錄 {filteredActivity.length} 筆 · 量測紀錄 {filteredRecords.length} 筆</p>
        </div>
        <button onClick={() => router.push(routeWithMember('/dashboard/upload'))} style={{
          background: 'var(--primary)', color: '#fff', border: 'none',
          padding: '10px 20px', borderRadius: '10px', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
        }}>
          + 新增紀錄
        </button>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: '10px', marginBottom: '18px',
      }}>
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '12px', padding: '12px' }}>
          <div style={{ fontSize: '20px', fontWeight: 900, color: actionRequiredCount ? '#b45309' : '#64748b' }}>{actionRequiredCount}</div>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#475569' }}>需要你處理</div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>補件、回覆或重新送交會出現在這裡。</div>
        </div>
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '12px' }}>
          <div style={{ fontSize: '20px', fontWeight: 900, color: '#15803d' }}>{teamActivityCount}</div>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#475569' }}>醫療團隊處理</div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>包含 QA、發布、撤回與補件要求。</div>
        </div>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px' }}>
          <div style={{ fontSize: '20px', fontWeight: 900, color: '#0f172a' }}>{sourceLinkedCount}</div>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#475569' }}>有 evidence</div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>可追溯到原始文件的更新。</div>
        </div>
      </div>

      <section style={{ background: '#fff', borderRadius: '16px', boxShadow: 'var(--shadow-sm)', padding: '18px', marginBottom: '26px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0 }}>醫療互動與資料處理紀錄</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0' }}>每筆紀錄都包含 actor、target、status、下一步與可追溯入口。</p>
          </div>
          <button onClick={fetchActivity} style={{ border: '1px solid var(--gray-200)', background: '#fff', borderRadius: '10px', padding: '8px 12px', color: '#334155', fontWeight: 700, cursor: 'pointer' }}>
            重新整理
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {ACTIVITY_TABS.map(t => (
            <button key={t.key} onClick={() => setActivityTab(t.key)} style={{
              padding: '8px 14px', borderRadius: '999px', border: '1px solid',
              borderColor: activityTab === t.key ? 'var(--primary)' : 'var(--gray-200)',
              background: activityTab === t.key ? 'var(--primary)' : '#fff',
              color: activityTab === t.key ? '#fff' : '#475569',
              fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <label style={{ fontSize: '12px', color: '#64748b', fontWeight: 700 }}>
            類型
            <select value={activityType} onChange={(e) => setActivityType(e.target.value)} style={{ marginLeft: 8, border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '6px 8px', background: '#fff' }}>
              {activityTypes.map(t => <option key={t} value={t}>{t === '全部' ? '全部' : TYPE_LABELS[t] || t}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '12px', color: '#64748b', fontWeight: 700 }}>
            狀態
            <select value={activityStatus} onChange={(e) => setActivityStatus(e.target.value)} style={{ marginLeft: 8, border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '6px 8px', background: '#fff' }}>
              {activityStatuses.map(s => <option key={s} value={s}>{s === '全部' ? '全部' : STATUS_LABELS[s] || s}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '12px', color: '#64748b', fontWeight: 700 }}>
            起日
            <input type="date" value={activityFrom} onChange={(e) => setActivityFrom(e.target.value)} style={{ marginLeft: 8, border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '5px 8px', background: '#fff' }} />
          </label>
          <label style={{ fontSize: '12px', color: '#64748b', fontWeight: 700 }}>
            迄日
            <input type="date" value={activityTo} onChange={(e) => setActivityTo(e.target.value)} style={{ marginLeft: 8, border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '5px 8px', background: '#fff' }} />
          </label>
          <label style={{ fontSize: '12px', color: '#64748b', fontWeight: 700 }}>
            來源文件
            <select value={activitySource} onChange={(e) => setActivitySource(e.target.value)} style={{ marginLeft: 8, border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '6px 8px', background: '#fff', maxWidth: 210 }}>
              {activitySources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '12px', color: '#64748b', fontWeight: 700, border: '1px solid var(--gray-200)', borderRadius: '999px', padding: '6px 10px', background: activityOnlyAction ? '#fff7ed' : '#fff' }}>
            <input type="checkbox" checked={activityOnlyAction} onChange={(e) => setActivityOnlyAction(e.target.checked)} />
            只看需要我處理
          </label>
          {(activityFrom || activityTo || activitySource !== '全部' || activityOnlyAction) && (
            <button type="button" onClick={() => { setActivityFrom(''); setActivityTo(''); setActivitySource('全部'); setActivityOnlyAction(false); }} style={{ border: 'none', background: 'transparent', color: 'var(--primary)', fontWeight: 800, cursor: 'pointer' }}>
              清除進階條件
            </button>
          )}
        </div>

        {activityLoading ? (
          <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>正在載入健康管理記錄...</div>
        ) : activityLoadError ? (
          <div role="alert" style={{ border: '1px solid #fecaca', background: '#fef2f2', borderRadius: '12px', padding: '22px', color: '#991b1b', lineHeight: 1.7 }}>
            <div style={{ fontWeight: 800, marginBottom: '4px' }}>互動紀錄載入失敗</div>
            <div style={{ fontSize: '13px', color: '#7f1d1d' }}>這不代表沒有 CMO 處理紀錄或補件要求。請重新整理後再判斷目前狀態。</div>
            <button type="button" onClick={fetchActivity} style={{ marginTop: '12px', border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', borderRadius: '8px', padding: '7px 12px', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
              重新載入互動紀錄
            </button>
          </div>
        ) : filteredActivity.length === 0 ? (
          <div style={{ border: '1px dashed #cbd5e1', borderRadius: '12px', padding: '22px', color: '#64748b', lineHeight: 1.7 }}>
            目前沒有符合條件的管理紀錄。若你剛上傳資料、回覆補充或醫療團隊剛發布更新，請按「重新整理」；也可以先到上傳頁新增 NHI、藥袋、回診資料。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredActivity.map(e => {
              const at = activityTime(e);
              const status = e.status || 'done';
              const needsAction = activityNeedsAction(e);
              const statusMeta = activityStatusMeta(status);
              const targetType = e.target_type ? (TYPE_LABELS[e.target_type] || e.target_type) : '資料';
              const cta = needsAction ? '補充資料' : e.available_actions?.includes('undo_if_available') ? '查看復原方式' : '查看詳情';
              return (
                <button key={e.id} onClick={() => router.push(routeWithMember(routeForActivity(e)))} style={{
                  width: '100%', textAlign: 'left', background: needsAction ? '#fff7ed' : '#fff',
                  border: `1px solid ${needsAction ? '#fed7aa' : statusMeta.border}`,
                  borderRadius: '12px', padding: '14px 16px', cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 800, color: e.actor === 'you' ? '#2563eb' : e.actor === 'medical_team' ? '#047857' : '#64748b' }}>{e.actor_label || (e.actor === 'you' ? '你' : e.actor === 'medical_team' ? '醫療團隊' : '系統')}</span>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>{targetType}</span>
                        {e.member_name && <span style={{ fontSize: '11px', color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '999px', padding: '2px 8px', fontWeight: 700 }}>{e.member_name}</span>}
                        <span style={{
                          fontSize: '11px', color: statusMeta.color, background: statusMeta.bg,
                          border: `1px solid ${statusMeta.border}`, borderRadius: '999px',
                          padding: '2px 8px', fontWeight: 800,
                        }}>{STATUS_LABELS[status] || statusMeta.label}</span>
                      </div>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', lineHeight: 1.4 }}>{activityTitle(e)}</div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', lineHeight: 1.5 }}>{e.short_description || e.patient_facing_note || '這筆資料有狀態更新，點擊可查看來源與下一步。'}</div>
                      <div style={{ fontSize: '12px', color: statusMeta.color, marginTop: '4px', lineHeight: 1.5, fontWeight: 700 }}>{statusMeta.helper}</div>
                      {e.related_problem_label && <div style={{ fontSize: '12px', color: '#0e7490', marginTop: '4px' }}>相關 Problem：{e.related_problem_label}</div>}
                      {e.source_document_id && <div style={{ fontSize: '12px', color: '#7c3aed', marginTop: '4px' }}>Evidence：已連結原始文件，可到文件庫查看（{e.source_document_id}）</div>}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      {at && <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>{formatDate(at)} {formatTime(at)}</div>}
                      <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 800 }}>{cta} →</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div style={{ marginBottom: '14px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0 }}>量測流水帳</h3>
        <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>血壓、血糖、體重、睡眠等自我量測紀錄。</p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '28px', flexWrap: 'wrap' }}>
        <div className="desktop-only">
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px' }}>成員</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {memberFilterOptions.map(m => (
              <button key={m} onClick={() => switchMember(m)} style={{
                padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                borderColor: filterMember === m ? 'var(--primary)' : 'var(--gray-200)',
                background: filterMember === m ? 'var(--primary)' : '#fff',
                color: filterMember === m ? '#fff' : '#555',
                fontSize: '13px', fontWeight: filterMember === m ? '700' : '500', cursor: 'pointer',
              }}>{m}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px' }}>類型</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {['全部', ...Object.keys(RECORD_TYPE_META)].map(t => {
              const info = t !== '全部' ? getTypeMeta(t) : null;
              return (
                <button key={t} onClick={() => setFilterType(t)} style={{
                  padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                  borderColor: filterType === t ? 'var(--primary)' : 'var(--gray-200)',
                  background: filterType === t ? 'var(--primary)' : '#fff',
                  color: filterType === t ? '#fff' : '#555',
                  fontSize: '13px', fontWeight: filterType === t ? '700' : '500', cursor: 'pointer',
                }}>
                  {info ? `${info.icon} ${info.label}` : '全部'}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#999', fontSize: '16px' }}>載入中...</div>
      ) : recordsLoadError ? (
        <div role="alert" style={{ textAlign: 'center', padding: '48px', background: '#fff', borderRadius: '16px', boxShadow: 'var(--shadow-sm)', border: '1px solid #fecaca' }}>
          <div style={{ fontWeight: '800', color: '#991b1b', marginBottom: '8px' }}>量測紀錄載入失敗</div>
          <div style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.6, marginBottom: '16px' }}>
            這不代表沒有自我量測資料。請重新載入確認。
          </div>
          <button onClick={fetchRecords} style={{
            color: '#fff', border: 'none', background: 'var(--primary)',
            cursor: 'pointer', fontWeight: '700', fontSize: '14px', borderRadius: '10px', padding: '10px 18px',
          }}>重新載入量測紀錄</button>
        </div>
      ) : dates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
          <div style={{ fontWeight: '700', color: '#333', marginBottom: '8px' }}>還沒有紀錄</div>
          <button onClick={() => router.push(routeWithMember('/dashboard/upload'))} style={{ color: 'var(--primary)', border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
            + 新增第一筆紀錄 →
          </button>
        </div>
      ) : (
        <div style={{ width: '100%' }}>
          {dates.map(date => (
            <div key={date} style={{ marginBottom: '28px' }}>
              {/* Date header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '5px', background: 'var(--primary)', flexShrink: 0 }} />
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#333' }}>
                  {new Date(date).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
                </div>
                <div style={{ flex: 1, height: '1px', background: 'var(--gray-200)' }} />
              </div>

              {/* Records for this date */}
              <div style={{ paddingLeft: '22px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {byDate[date].map(r => {
                  const meta = getTypeMeta(r.record_type);
                  return (
                    <div key={r.id} style={{
                      background: '#fff', borderRadius: '12px', padding: '14px 16px',
                      boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: '14px',
                      opacity: deleting === r.id ? 0.5 : 1, transition: 'opacity 0.2s',
                    }}>
                      <div style={{
                        width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
                        background: `${meta.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '20px',
                      }}>
                        {meta.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: '#999' }}>{meta.label}</span>
                          <span style={{ fontSize: '16px', fontWeight: '800', color: '#111' }}>{formatValue(r)}</span>
                          {r.member_name && (
                            <span style={{ fontSize: '11px', background: '#f0f4f8', color: '#666', padding: '2px 8px', borderRadius: '20px' }}>{r.member_name}</span>
                          )}
                        </div>
                        {r.note && <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{r.note}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '13px', color: '#999' }}>{formatTime(r.recorded_at)}</div>
                        <button
                          onClick={() => handleDelete(r.id)}
                          disabled={deleting === r.id}
                          style={{ fontSize: '11px', color: '#ccc', border: 'none', background: 'none', cursor: 'pointer', marginTop: '4px' }}
                        >
                          刪除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
