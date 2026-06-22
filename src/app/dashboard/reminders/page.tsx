'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { api } from '@/lib/api';
import { useToast } from '../toast-context';
import { useSync } from '@/lib/sync';
import type { ReminderType, ReminderSource } from '@/lib/healthkeepTypes';
import { memberDisplayName, normalizeMemberName as normalizeMemberParam, uniqueMemberNames } from '@/lib/members';

// ─── Types ────────────────────────────────────────────────────────────────────
type VisitType = 'outpatient' | 'hospitalization' | 'medication' | 'examination';

type Appointment = {
  id: string;
  member: string;
  type: ReminderType;
  source: ReminderSource;
  status: 'active' | 'completed' | 'dismissed' | 'deleted';
  isVerified: boolean;
  isPatientManaged: boolean;
  title: string;
  clinic: string;
  doctor: string;
  room: string;
  date: string;
  time: string;
  note: string;
  done: boolean;
  color: string;
  conclusion: string;
  visit_types: VisitType[];
};

// ─── Constants ────────────────────────────────────────────────────────────────
const VISIT_TYPE_INFO: Record<VisitType, { label: string; icon: string; color: string; bg: string }> = {
  outpatient:      { label: '門診',   icon: '🏥', color: '#2196f3', bg: '#e3f2fd' },
  hospitalization: { label: '住院',   icon: '🛏',  color: '#f44336', bg: '#fff0f0' },
  medication:      { label: '用藥',   icon: '💊', color: '#4caf50', bg: '#f0fff4' },
  examination:     { label: '檢查',   icon: '🔬', color: '#9c27b0', bg: '#f3e5f5' },
};

const REMINDER_TYPE_INFO: Record<ReminderType, { label: string; icon: string; color: string; bg: string }> = {
  follow_up:         { label: '回診',     icon: '🏥', color: '#2563eb', bg: '#eff6ff' },
  health_check:      { label: '健檢',     icon: '🧾', color: '#0f766e', bg: '#ecfdf5' },
  screening:         { label: '預防',     icon: '🛡️', color: '#7c3aed', bg: '#f5f3ff' },
  vaccine:           { label: '疫苗',     icon: '💉', color: '#b45309', bg: '#fff7ed' },
  medication_refill: { label: '藥物',     icon: '💊', color: '#16a34a', bg: '#f0fdf4' },
  measurement:       { label: '量測',     icon: '📈', color: '#dc2626', bg: '#fff1f2' },
  document_upload:   { label: '文件上傳', icon: '📎', color: '#475569', bg: '#f8fafc' },
  custom:            { label: '自訂',     icon: '🔔', color: '#64748b', bg: '#f1f5f9' },
};

const SOURCE_LABEL: Record<ReminderSource, string> = {
  patient_created: 'User created',
  cmo_created: 'CMO created',
  system_rule: 'System rule',
  imported: 'Imported',
};

// ─── API helpers ──────────────────────────────────────────────────────────────
function normalizeMemberName(member?: string | null): string {
  const value = (member ?? '').trim();
  return value === 'self' ? '本人' : value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromApi(a: any): Appointment {
  return {
    id: String(a.id),
    member: normalizeMemberName(a.member_name ?? a.member),
    type: (a.type ?? a.reminder_type ?? 'follow_up') as ReminderType,
    source: (a.source ?? 'patient_created') as ReminderSource,
    status: (a.status ?? (a.is_done ? 'completed' : 'active')) as Appointment['status'],
    isVerified: Boolean(a.is_verified ?? false),
    isPatientManaged: Boolean(a.is_patient_managed ?? true),
    title: a.title ?? '',
    clinic: a.clinic ?? '',
    doctor: a.doctor ?? '',
    room: a.room ?? '',
    date: a.scheduled_date ?? a.date ?? '',
    time: a.time ?? '09:00',
    note: a.note ?? '',
    done: Boolean(a.is_done ?? a.done ?? a.status === 'completed'),
    color: a.color ?? '#607d8b',
    conclusion: a.conclusion ?? '',
    visit_types: Array.isArray(a.visit_types) ? (a.visit_types as VisitType[]) : [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function UrgencyBadge({ days }: { days: number }) {
  if (days < 0)  return <span style={{ background: '#f0f4f8', color: '#999', fontSize: '11px', padding: '2px 8px', borderRadius: '20px' }}>已過期</span>;
  if (days === 0) return <span style={{ background: '#fff0f0', color: '#f44336', fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' }}>今天</span>;
  if (days <= 3)  return <span style={{ background: '#fff0f0', color: '#f44336', fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' }}>還有 {days} 天</span>;
  if (days <= 7)  return <span style={{ background: '#fff9e6', color: '#ff9800', fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' }}>還有 {days} 天</span>;
  return <span style={{ background: '#f0f4f8', color: '#666', fontSize: '11px', padding: '2px 8px', borderRadius: '20px' }}>還有 {days} 天</span>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '8px',
  border: '1px solid var(--gray-300)', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
};
const labelStyle: React.CSSProperties = {
  fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '6px', display: 'block',
};
const sectionLabel: React.CSSProperties = {
  fontSize: '12px', fontWeight: '700', color: '#aaa', textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: '10px', display: 'block',
};

// ─── Form State ───────────────────────────────────────────────────────────────
type NewAppt = {
  member: string; type: ReminderType; title: string; clinic: string; doctor: string; room: string;
  date: string; time: string; note: string;
  conclusion: string; visit_types: VisitType[];
};

// ─── Main Component ───────────────────────────────────────────────────────────
type CmoFollowUp = { id: number; reason: string; item: string; suggested_date: string | null; priority: string; needs_more_data: boolean; needs_cmo_recheck: boolean; status: string };
type CmoMissingDataRequest = { id: string; title: string; reason: string; instructions?: string | null; due_date?: string | null; priority: string; status: string; response_text?: string | null; responded_at?: string | null };

export default function RemindersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { members, activeMember, setActiveMember } = useActiveMember();
  const memberNames = useMemo(() => uniqueMemberNames(members.map(m => m.name)), [members]);
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家' : '本人');
  const filterOptions = ['全部', ...memberNames];

  const [appts, setAppts] = useState<Appointment[]>([]);
  const [cmoFollowUps, setCmoFollowUps] = useState<CmoFollowUp[]>([]);
  const [missingRequests, setMissingRequests] = useState<CmoMissingDataRequest[]>([]);
  const [missingReplies, setMissingReplies] = useState<Record<string, string>>({});
  const [missingReplyBusy, setMissingReplyBusy] = useState('');
  const loadCmoTasks = useCallback(() => {
    let alive = true;
    api.get('/api/patients/me/follow-ups')
      .then((r) => { if (alive) setCmoFollowUps(Array.isArray(r) ? (r as CmoFollowUp[]) : []); })
      .catch(() => { /* 靜默：無追蹤項目或未授權 */ });
    api.get('/api/patients/me/missing-data-requests')
      .then((r) => { if (alive) setMissingRequests(Array.isArray(r) ? (r as CmoMissingDataRequest[]) : []); })
      .catch(() => { /* 靜默：無補資料任務或未授權 */ });
    return () => { alive = false; };
  }, []);
  useEffect(() => loadCmoTasks(), [loadCmoTasks]);
  // Start filtered to the globally-selected member, sync on header chip changes
  const [filterMember, setFilterMember] = useState(() => activeMember || '全部');

  // Sync local filter with global member selection
  useEffect(() => { setFilterMember(activeMember || '全部'); }, [activeMember]);
  useEffect(() => {
    setForm(f => {
      if (activeMember && f.member !== activeMember) return { ...f, member: activeMember };
      if (!activeMember && !f.member && memberNames[0]) return { ...f, member: memberNames[0] };
      return f;
    });
  }, [activeMember, memberNames]);
  const [showDone, setShowDone] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expandedConclusion, setExpandedConclusion] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState<NewAppt>({
    member: activeMember || memberNames[0] || '', type: 'follow_up',
    title: '', clinic: '', doctor: '', room: '',
    date: '', time: '09:00', note: '',
    conclusion: '', visit_types: [],
  });

  const sync = useSync();
  const highlightParam = searchParams.get('highlight');
  const requestedMemberParam = searchParams.get('member');

  // Deep links from dashboard summary cards can target the exact reminder row.
  useEffect(() => {
    if (highlightParam) setHighlightId(highlightParam);
    if (requestedMemberParam !== null) {
      const targetMember = normalizeMemberParam(requestedMemberParam);
      setFilterMember(targetMember || '全部');
      setActiveMember(targetMember);
    }
  }, [highlightParam, requestedMemberParam, setActiveMember]);

  const selectMemberFilter = (label: string) => {
    const normalized = label === '全部' ? '' : normalizeMemberParam(label);
    setFilterMember(label);
    setActiveMember(normalized);
    const params = new URLSearchParams(searchParams.toString());
    if (normalized) {
      params.set('member', normalized);
    } else {
      params.delete('member');
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // Fetch the authoritative reminder list from the server (single source of truth).
  const loadReminders = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (activeMember) params.member = activeMember;
      const data = await api.get('/api/patients/me/reminders', Object.keys(params).length ? params : undefined);
      setAppts((data as unknown[]).map(fromApi));
    } catch {}
  }, [activeMember]);

  useEffect(() => {
    const migrateThenLoad = async () => {
      // One-time localStorage migration (guarded; no-op after first run)
      const legacy = localStorage.getItem('healthkeep_reminders_v1');
      if (legacy) {
        try {
          const items = JSON.parse(legacy) as Array<Record<string, unknown>>;
          for (const item of items) {
            await api.post('/api/patients/me/reminders', {
              type: item.type || item.reminder_type || 'follow_up',
              title: item.title || '提醒',
              scheduled_date: item.date || item.scheduled_date || null,
              repeat_type: item.repeat || item.repeat_type || 'none',
              is_done: item.done || item.is_done || false,
              note: item.note || null,
              member_name: item.member || activeMember,
              clinic: item.clinic || null,
              doctor: item.doctor || null,
              room: item.room || null,
              time: item.time || null,
              color: item.color || null,
              conclusion: item.conclusion || null,
              visit_types: item.visit_types || null,
            }).catch(() => {});
          }
        } catch {}
        localStorage.removeItem('healthkeep_reminders_v1');
      }
      await loadReminders();
    };
    migrateThenLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadReminders]);

  // Cross-view sync: when the medical team (or another device) changes a reminder,
  // the patient_reminders cursor advances and we refetch automatically.
  useEffect(() => {
    loadReminders();
    loadCmoTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.viewVersions.patient_reminders]);

  const submitMissingReply = async (request: CmoMissingDataRequest) => {
    const response_text = (missingReplies[request.id] || '').trim();
    if (!response_text) {
      showToast('請先輸入補充說明，或到上傳頁補件後再回覆。');
      return;
    }
    setMissingReplyBusy(request.id);
    try {
      await api.post(`/api/patients/me/missing-data-requests/${request.id}/reply`, { response_text });
      setMissingReplies((prev) => ({ ...prev, [request.id]: '' }));
      showToast('已送出給 CMO，醫療團隊會再次審閱。');
      loadCmoTasks();
    } catch {
      showToast('送出失敗，請稍後再試。');
    } finally {
      setMissingReplyBusy('');
    }
  };

  const filtered = appts
    .filter(a => {
      if (filterMember !== '全部' && a.member !== filterMember) return false;
      if (!showDone && a.done) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.date.localeCompare(b.date);
    });

  const upcoming = filtered.filter(a => !a.done);
  const done = filtered.filter(a => a.done);

  useEffect(() => {
    if (!highlightId) return;
    const frame = window.requestAnimationFrame(() => {
      highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightId, upcoming.length, done.length, filterMember, showDone]);

  const toggleDone = async (id: string) => {
    const appt = appts.find(a => a.id === id);
    if (!appt) return;
    try {
      setAppts(prev => prev.map(a => a.id === id ? { ...a, done: !appt.done, status: !appt.done ? 'completed' : 'active' } : a));
      const updated = await api.patch(`/api/patients/me/reminders/${id}`, { is_done: !appt.done });
      setAppts(prev => prev.map(a => a.id === id ? { ...a, ...fromApi(updated), done: !appt.done } : a));
      // Auto-expand conclusion when marking as done
      if (!appt.done) setExpandedConclusion(id);
    } catch {
      setAppts(prev => prev.map(a => a.id === id ? { ...a, done: appt.done, status: appt.status } : a));
      showToast('更新提醒失敗', 'error');
    }
  };

  const updateConclusion = async (id: string, conclusion: string) => {
    try {
      const updated = await api.patch(`/api/patients/me/reminders/${id}`, { conclusion });
      setAppts(prev => prev.map(a => a.id === id ? { ...a, ...fromApi(updated), conclusion } : a));
    } catch {}
  };

  const updateVisitTypes = async (id: string, types: VisitType[]) => {
    try {
      const updated = await api.patch(`/api/patients/me/reminders/${id}`, { visit_types: types });
      setAppts(prev => prev.map(a => a.id === id ? { ...a, ...fromApi(updated), visit_types: types } : a));
    } catch {}
  };

  const deleteAppt = async (id: string) => {
    const old = appts.find(a => a.id === id);
    if (!old) return;
    setAppts(prev => prev.filter(a => a.id !== id));
    try {
      await api.delete(`/api/patients/me/reminders/${id}`);
      showToast('已刪除提醒', 'info', {
        label: 'Undo',
        durationMs: 10000,
        onClick: async () => {
          try {
            const restored = await api.post(`/api/patients/me/reminders/${id}/undo-delete`);
            setAppts(prev => [fromApi(restored), ...prev]);
          } catch {
            setAppts(prev => [old, ...prev]);
          }
        },
      });
    } catch {
      setAppts(prev => [old, ...prev]);
      showToast('刪除失敗，請稍後再試', 'error');
    }
  };

  const addAppt = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const memberColor = members.find(m => m.name === form.member)?.color ?? '#607d8b';
    try {
      const created = await api.post('/api/patients/me/reminders', {
        type: form.type,
        title: form.title,
        member_name: form.member,
        scheduled_date: form.date || null,
        repeat_type: 'none',
        is_done: false,
        note: form.note || null,
        clinic: form.clinic || null,
        doctor: form.doctor || null,
        room: form.room || null,
        time: form.time || null,
        color: memberColor,
        conclusion: form.conclusion || null,
        visit_types: form.visit_types.length ? form.visit_types : null,
      });
      setAppts(prev => [...prev, fromApi(created)]);
      showToast('已新增提醒', 'success', {
        label: 'Undo',
        durationMs: 10000,
        onClick: async () => {
          const createdId = String((created as { id: string | number }).id);
          await api.delete(`/api/patients/me/reminders/${createdId}`);
          setAppts(prev => prev.filter(a => a.id !== createdId));
        },
      });
      setForm({
        member: activeMember || memberNames[0] || '', type: 'follow_up',
        title: '', clinic: '', doctor: '', room: '',
        date: '', time: '09:00', note: '',
        conclusion: '', visit_types: [],
      });
      setShowForm(false);
    } catch {
      showToast('新增提醒失敗', 'error');
    }
  };

  const toggleVisitType = (types: VisitType[], t: VisitType): VisitType[] =>
    types.includes(t) ? types.filter(x => x !== t) : [...types, t];

  // ─── Card ─────────────────────────────────────────────────────────────────
  const ApptCard = ({ a }: { a: Appointment }) => {
    const days = daysUntil(a.date);
    const isExpanded = expandedConclusion === a.id;
    const typeInfo = REMINDER_TYPE_INFO[a.type] ?? REMINDER_TYPE_INFO.custom;
    const isHighlighted = highlightId === a.id;

    return (
      <div ref={isHighlighted ? highlightRef : undefined} style={{
        background: '#fff', borderRadius: '14px', boxShadow: 'var(--shadow-sm)',
        borderLeft: `4px solid ${a.done ? '#ccc' : a.color}`,
        outline: isHighlighted ? '2px solid #2563eb' : 'none',
        outlineOffset: isHighlighted ? '2px' : '0',
        opacity: a.done ? 0.85 : 1,
      }}>
        {/* Main row */}
        <div style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          {/* Date block */}
          <div style={{
            textAlign: 'center', background: '#f8f9fa', borderRadius: '10px',
            padding: '8px 12px', flexShrink: 0, minWidth: '52px',
          }}>
            <div style={{ fontSize: '22px', fontWeight: '800', color: a.done ? '#ccc' : a.color, lineHeight: 1 }}>
              {new Date(a.date + 'T00:00:00').getDate()}
            </div>
            <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
              {new Date(a.date + 'T00:00:00').toLocaleDateString('zh-TW', { month: 'short' })}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            {/* Title + badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', background: typeInfo.bg, color: typeInfo.color, padding: '2px 8px', borderRadius: '20px', fontWeight: 700 }}>
                {typeInfo.icon} {typeInfo.label}
              </span>
              <span style={{
                fontSize: '15px', fontWeight: '700',
                color: a.done ? '#999' : '#111',
                textDecoration: a.done ? 'line-through' : 'none',
              }}>{a.title}</span>
              <span style={{ fontSize: '11px', background: '#f0f4f8', color: '#666', padding: '2px 8px', borderRadius: '20px' }}>
                {a.member}
              </span>
              <span style={{ fontSize: '10px', background: a.source === 'patient_created' ? '#ecfdf5' : '#eef2ff', color: a.source === 'patient_created' ? '#047857' : '#3730a3', padding: '2px 8px', borderRadius: '20px', fontWeight: 700 }}>
                {SOURCE_LABEL[a.source] ?? a.source}
              </span>
              {a.isVerified && <span style={{ fontSize: '10px', background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: '20px', fontWeight: 700 }}>CMO verified</span>}
              {!a.done && <UrgencyBadge days={days} />}
            </div>

            {/* Clinic + details row */}
            <div style={{ fontSize: '13px', color: '#777', lineHeight: 1.6 }}>
              <span>📍 {a.clinic}</span>
              {a.doctor && <span> · 👨‍⚕️ {a.doctor}</span>}
              {a.room && <span> · 診間：{a.room}</span>}
              <span> · ⏰ {a.time}</span>
            </div>

            {/* Pre-visit note */}
            {a.note && (
              <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>📝 {a.note}</div>
            )}

            {/* Visit type tags */}
            {a.visit_types.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                {a.visit_types.map(t => {
                  const info = VISIT_TYPE_INFO[t];
                  return (
                    <span key={t} style={{
                      fontSize: '11px', background: info.bg, color: info.color,
                      padding: '2px 8px', borderRadius: '20px', fontWeight: '600',
                    }}>{info.icon} {info.label}</span>
                  );
                })}
              </div>
            )}

            {/* Conclusion preview (when done) */}
            {a.done && a.conclusion && !isExpanded && (
              <div style={{ fontSize: '12px', color: '#666', marginTop: '6px', fontStyle: 'italic' }}>
                💬 {a.conclusion.length > 60 ? a.conclusion.slice(0, 60) + '...' : a.conclusion}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
            <button onClick={() => toggleDone(a.id)} style={{
              padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--gray-200)',
              background: a.done ? '#4caf50' : '#fff',
              color: a.done ? '#fff' : '#555',
              fontSize: '12px', cursor: 'pointer', fontWeight: '600',
            }}>{a.done ? '✓ 完成' : '標為完成'}</button>
            {a.done && (
              <button onClick={() => setExpandedConclusion(isExpanded ? null : a.id)} style={{
                padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--gray-200)',
                background: isExpanded ? '#e7f1ff' : '#fff',
                color: isExpanded ? 'var(--primary)' : '#666',
                fontSize: '11px', cursor: 'pointer',
              }}>{isExpanded ? '收起' : '就醫紀錄'}</button>
            )}
            <button onClick={() => deleteAppt(a.id)} style={{
              padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--gray-200)',
              background: '#fff', color: '#f44336', fontSize: '12px', cursor: 'pointer',
            }}>刪除</button>
          </div>
        </div>

        {/* ── Conclusion section (expandable, shown after marking done) ── */}
        {a.done && isExpanded && (
          <div style={{
            borderTop: '1px solid var(--gray-100)', padding: '16px',
            background: '#fafafa', borderRadius: '0 0 14px 14px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#555', marginBottom: '12px' }}>
              就醫紀錄
            </div>

            {/* Visit types */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '6px' }}>就醫類型</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(Object.keys(VISIT_TYPE_INFO) as VisitType[]).map(t => {
                  const info = VISIT_TYPE_INFO[t];
                  const isOn = a.visit_types.includes(t);
                  return (
                    <button key={t} type="button"
                      onClick={() => updateVisitTypes(a.id, toggleVisitType(a.visit_types, t))}
                      style={{
                        padding: '5px 12px', borderRadius: '20px', border: '1.5px solid',
                        borderColor: isOn ? info.color : '#ddd',
                        background: isOn ? info.bg : '#fff',
                        color: isOn ? info.color : '#666',
                        fontSize: '12px', cursor: 'pointer',
                        fontWeight: isOn ? '700' : '400',
                      }}>{info.icon} {info.label}</button>
                  );
                })}
              </div>
            </div>

            {/* Conclusion textarea */}
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '6px' }}>結論 / 醫師交代</div>
              <textarea
                value={a.conclusion}
                onChange={e => updateConclusion(a.id, e.target.value)}
                rows={3}
                placeholder="例：血壓控制良好，繼續服藥，3 個月後回診..."
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: '8px',
                  border: '1px solid #ddd', fontSize: '13px', fontFamily: 'inherit',
                  outline: 'none', resize: 'vertical',
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', width: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
          <button onClick={() => router.back()} style={{
            width: '44px', height: '44px', borderRadius: '10px', background: '#fff',
            border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer',
            color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: 'var(--shadow-sm)',
          }}>←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#111' }}>提醒中心</h2>
            <p style={{ fontSize: '14px', color: '#666', marginTop: '2px' }}>目前顯示：{scopeLabel} · {upcoming.length} 個即將到來的提醒</p>
          </div>
          <button onClick={() => setShowForm(v => !v)} style={{
            background: 'var(--primary)', color: '#fff', border: 'none',
            padding: '10px 20px', borderRadius: '10px', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
          }}>+ 新增提醒</button>
        </div>

        {/* CMO 追蹤項目（由醫療團隊建立，對應改版 §5.2 F / §6.2 流程④） */}
        {cmoFollowUps.length > 0 && (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '18px 20px', boxShadow: 'var(--shadow-sm)', marginBottom: '20px', borderLeft: '4px solid var(--primary)' }}>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#94a3b8', letterSpacing: '0.5px', marginBottom: '12px' }}>醫療團隊的追蹤項目</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {cmoFollowUps.map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>{t.item}{t.status === 'done' ? ' ✓' : ''}</div>
                    <div style={{ fontSize: '13px', color: '#475569', marginTop: '2px' }}>{t.reason}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>建議時間：{t.suggested_date || '依醫療團隊安排'}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
                    {t.needs_more_data && <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', background: '#eff6ff', color: '#1d4ed8' }}>需補資料</span>}
                    {t.status === 'done' && <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', background: '#f0fdf4', color: '#15803d' }}>已完成</span>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '10px' }}>這些是 CMO 醫療團隊為你安排的追蹤；標示「需補資料」者，可到「上傳」補件。</div>
          </div>
        )}

        {missingRequests.length > 0 && (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '18px 20px', boxShadow: 'var(--shadow-sm)', marginBottom: '20px', borderLeft: '4px solid #f59e0b' }}>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#b45309', letterSpacing: '0.5px', marginBottom: '12px' }}>CMO 要你補的資料</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {missingRequests.map((request) => {
                const waiting = request.status === 'waiting_for_user' || request.status === 'open';
                const responded = request.status === 'needs_cmo_review';
                return (
                  <div key={request.id} style={{ border: '1px solid #fde68a', borderRadius: '12px', padding: '14px', background: responded ? '#f0fdf4' : '#fffbeb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>{request.title}</div>
                        <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px' }}>為什麼需要：{request.reason}</div>
                        {request.instructions && <div style={{ fontSize: '13px', color: '#475569', marginTop: '3px' }}>怎麼補：{request.instructions}</div>}
                        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>期限：{request.due_date || '依 CMO 團隊安排'}</div>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 800, padding: '4px 10px', borderRadius: '999px', background: responded ? '#dcfce7' : '#fff7ed', color: responded ? '#15803d' : '#c2410c', flexShrink: 0 }}>
                        {responded ? '已送出，等待 CMO' : '待補資料'}
                      </span>
                    </div>
                    {waiting && (
                      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                        <textarea
                          value={missingReplies[request.id] || ''}
                          onChange={(event) => setMissingReplies((prev) => ({ ...prev, [request.id]: event.target.value }))}
                          placeholder="補充說明，例如：我已上傳報告，檢查日期是 2026/6/1，院所是..."
                          rows={2}
                          style={{ ...inputStyle, resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button type="button" onClick={() => router.push('/dashboard/upload')} style={{ background: '#fff', border: '1px solid var(--gray-300)', color: '#334155', borderRadius: '8px', padding: '8px 12px', fontWeight: 700, cursor: 'pointer' }}>去上傳資料</button>
                          <button type="button" disabled={missingReplyBusy === request.id} onClick={() => submitMissingReply(request)} style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 12px', fontWeight: 800, cursor: missingReplyBusy === request.id ? 'wait' : 'pointer', opacity: missingReplyBusy === request.id ? 0.72 : 1 }}>
                            {missingReplyBusy === request.id ? '送出中…' : '送出給 CMO'}
                          </button>
                        </div>
                      </div>
                    )}
                    {responded && request.response_text && (
                      <div style={{ marginTop: 10, fontSize: '12px', color: '#166534' }}>你的回覆：{request.response_text}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No members */}
        {members.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', background: '#fff', borderRadius: '16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>👨‍👩‍👧‍👦</div>
            <div style={{ fontWeight: '700', color: '#333', marginBottom: '8px' }}>請先新增家庭成員</div>
            <button onClick={() => router.push('/dashboard/settings')} style={{
              color: 'var(--primary)', border: 'none', background: 'none',
              cursor: 'pointer', fontWeight: '600', fontSize: '14px',
            }}>前往設定 →</button>
          </div>
        )}

        {/* ── Add Form ── */}
        {showForm && members.length > 0 && (
          <form onSubmit={addAppt} style={{
            background: '#fff', borderRadius: '16px', padding: '24px',
            boxShadow: 'var(--shadow-sm)', marginBottom: '24px',
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '20px' }}>新增提醒</h3>

            {/* Row 1: member + title */}
            <div className="grid-2col" style={{ marginBottom: '16px' }}>
              <div>
                <label style={labelStyle}>家庭成員</label>
                <select value={form.member} onChange={e => setForm(f => ({ ...f, member: e.target.value }))}
                  style={{ ...inputStyle, background: '#fff' }} required>
                  {memberNames.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>提醒類型</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as ReminderType }))}
                  style={{ ...inputStyle, background: '#fff' }}>
                  {(Object.keys(REMINDER_TYPE_INFO) as ReminderType[]).map(type => (
                    <option key={type} value={type}>{REMINDER_TYPE_INFO[type].label}</option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>提醒名稱 <span style={{ color: '#f44336' }}>*</span></label>
                <input type="text" placeholder="例：心臟科回診"
                  value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  style={inputStyle} required />
              </div>
            </div>

            {/* Row 2: clinic + doctor */}
            <div className="grid-2col" style={{ marginBottom: '16px' }}>
              <div>
                <label style={labelStyle}>診所 / 醫院 <span style={{ color: '#f44336' }}>*</span></label>
                <input type="text" placeholder="例：台大醫院"
                  value={form.clinic} onChange={e => setForm(f => ({ ...f, clinic: e.target.value }))}
                  style={inputStyle} required />
              </div>
              <div>
                <label style={labelStyle}>醫師姓名
                  <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（選填）</span>
                </label>
                <input type="text" placeholder="例：王大明 醫師"
                  value={form.doctor} onChange={e => setForm(f => ({ ...f, doctor: e.target.value }))}
                  style={inputStyle} />
              </div>
            </div>

            {/* Row 3: room + date + time */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={labelStyle}>診間號碼
                  <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（選填）</span>
                </label>
                <input type="text" placeholder="例：3A、內科 302"
                  value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>日期 <span style={{ color: '#f44336' }}>*</span></label>
                <input type="date" value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  style={inputStyle} required />
              </div>
              <div>
                <label style={labelStyle}>時間</label>
                <input type="time" value={form.time}
                  onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                  style={inputStyle} />
              </div>
            </div>

            {/* Note */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>注意事項
                <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（選填）</span>
              </label>
              <input type="text" placeholder="例：需要空腹、帶藥盒…"
                value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                style={inputStyle} />
            </div>

            {/* Divider for post-visit section */}
            <div style={{ borderTop: '1px solid #eee', paddingTop: '20px', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#888', marginBottom: '4px' }}>
                就醫後記錄
                <span style={{ color: '#bbb', fontWeight: 400, marginLeft: '6px' }}>（如為事後補填，可先填好）</span>
              </div>
            </div>

            {/* Visit types */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>就醫類型
                <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（可複選）</span>
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(Object.keys(VISIT_TYPE_INFO) as VisitType[]).map(t => {
                  const info = VISIT_TYPE_INFO[t];
                  const isOn = form.visit_types.includes(t);
                  return (
                    <button key={t} type="button"
                      onClick={() => setForm(f => ({ ...f, visit_types: toggleVisitType(f.visit_types, t) }))}
                      style={{
                        padding: '6px 14px', borderRadius: '20px', border: '1.5px solid',
                        borderColor: isOn ? info.color : '#ddd',
                        background: isOn ? info.bg : '#f8f9fa',
                        color: isOn ? info.color : '#666',
                        fontSize: '13px', cursor: 'pointer',
                        fontWeight: isOn ? '700' : '400',
                        display: 'flex', alignItems: 'center', gap: '4px',
                      }}>{info.icon} {info.label}</button>
                  );
                })}
              </div>
            </div>

            {/* Conclusion */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>結論 / 醫師交代
                <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（選填）</span>
              </label>
              <textarea
                placeholder="例：血壓控制良好，繼續服藥，3 個月後回診…"
                value={form.conclusion}
                onChange={e => setForm(f => ({ ...f, conclusion: e.target.value }))}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button type="submit" style={{
                background: 'var(--primary)', color: '#fff', border: 'none',
                padding: '10px 24px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer',
              }}>儲存</button>
              <button type="button" onClick={() => setShowForm(false)} style={{
                background: '#f8f9fa', color: '#666', border: 'none',
                padding: '10px 24px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer',
              }}>取消</button>
            </div>
          </form>
        )}

        {/* Filters */}
        {members.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div className="desktop-only" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {filterOptions.map(m => (
                <button key={m} onClick={() => selectMemberFilter(m)} style={{
                  padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                  borderColor: filterMember === m ? 'var(--primary)' : 'var(--gray-200)',
                  background: filterMember === m ? 'var(--primary)' : '#fff',
                  color: filterMember === m ? '#fff' : '#555',
                  fontSize: '13px', cursor: 'pointer',
                }}>{m}</button>
              ))}
            </div>
            <button onClick={() => setShowDone(v => !v)} style={{
              padding: '6px 14px', borderRadius: '20px', border: '1px solid var(--gray-200)',
              background: showDone ? '#f0f4f8' : '#fff', color: '#666', fontSize: '13px', cursor: 'pointer',
            }}>{showDone ? '隱藏已完成' : '顯示已完成'}</button>
          </div>
        )}

        {/* Upcoming grouped by reminder type */}
        {(Object.keys(REMINDER_TYPE_INFO) as ReminderType[]).map(type => {
          const list = upcoming.filter(a => a.type === type);
          if (list.length === 0) return null;
          const info = REMINDER_TYPE_INFO[type];
          return (
            <div key={type} style={{ marginBottom: '28px' }}>
              <span style={sectionLabel}>{info.icon} {info.label} · {list.length}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {list.map(a => <ApptCard key={a.id} a={a} />)}
              </div>
            </div>
          );
        })}

        {/* Done */}
        {showDone && done.length > 0 && (
          <div>
            <span style={sectionLabel}>已完成</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {done.map(a => <ApptCard key={a.id} a={a} />)}
            </div>
          </div>
        )}

        {/* Empty state */}
        {members.length > 0 && upcoming.length === 0 && (!showDone || done.length === 0) && (
          <div style={{ textAlign: 'center', padding: '60px', background: '#fff', borderRadius: '16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
            <div style={{ fontWeight: '700', color: '#333', marginBottom: '8px' }}>{scopeLabel}尚無提醒</div>
            <button onClick={() => setShowForm(true)} style={{
              color: 'var(--primary)', border: 'none', background: 'none',
              cursor: 'pointer', fontWeight: '600', fontSize: '14px',
            }}>新增回診或健檢提醒 →</button>
          </div>
        )}
      </div>
    </div>
  );
}
