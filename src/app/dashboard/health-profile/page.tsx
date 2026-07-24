'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { useToast } from '../toast-context';
import { useSync } from '@/lib/sync';
import { useActiveMember } from '../member-context';
import { memberDisplayName, memberHref, memberQueryParams, normalizeMemberName } from '@/lib/members';
import { cleanPatientProblems, isJunkProblemName } from '../problem-filter';
import type { PatientChangeRequest } from '@/lib/healthkeepTypes';
import type { EvidenceDocument } from '@/lib/evidence';
import { evidenceMeta, evidenceTitle, evidenceUnavailableText } from '@/lib/evidence';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MyProblem {
  id: number;
  member_name?: string | null;
  icd10_code: string | null;
  display_name: string;
  display_layman: string | null;
  status: 'underlying' | 'following' | 'resolved';
  tier: number;
  is_suspected: boolean;
  onset_date: string | null;
  resolution_date: string | null;
  is_verified: boolean;
  verified_by_name: string | null;
  created_at: string | null;
  patient_tracking_state?: string | null;   // patient-reported overlay (immediate)
  source_document_id?: string | null;
  evidence_document?: EvidenceDocument | null;
}

// Patient's own tracking preference — set DIRECTLY, takes effect immediately,
// never blocks on CMO approval. Distinct from the official `status`.
const TRACKING_OPTIONS: { key: string; label: string }[] = [
  { key: 'actively_treating', label: '我還在治療' },
  { key: 'following', label: '我還在追蹤' },
  { key: 'doctor_said_no_follow_up', label: '醫師說不用追蹤' },
  { key: 'no_longer_tracking', label: '我不想再追蹤' },
  { key: 'resolved_by_self_report', label: '我覺得已經好了' },
  { key: 'unsure', label: '我不確定' },
];
const TRACKING_LABELS: Record<string, string> = Object.fromEntries(TRACKING_OPTIONS.map(o => [o.key, o.label]));

// Local YYYY-MM-DD for a date `days` from today (avoids UTC off-by-one).
function dateStrFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Medication {
  id: number;
  member_name?: string;
  drug_name: string;
  drug_name_layman?: string | null;
  dose?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  status?: string;
  is_active?: boolean;
}

interface Reminder {
  id: number;
  member_name?: string;
  title?: string;
  reminder_type?: string;
  remind_at?: string;
  due_date?: string | null;
  scheduled_date?: string | null;
  is_done?: boolean;
  note?: string | null;
}

interface RecordOut {
  id: string;
  member_name: string;
  record_type: string;
  value1: string | null;
  value2: string | null;
  unit: string | null;
  recorded_at: string;
}

type FeedbackKind = 'incorrect' | 'outdated' | 'missing_context' | 'not_sure';

type ProblemFeedbackPayload = {
  kind: FeedbackKind;
  note: string;
};

const FEEDBACK_OPTIONS: Array<{ key: FeedbackKind; label: string; requestedAction: string; placeholder: string }> = [
  { key: 'incorrect', label: '內容可能有錯', requestedAction: 'provide_note', placeholder: '例：這不是高血壓，是當時短暫血壓偏高。' },
  { key: 'outdated', label: '狀態已經改變', requestedAction: 'provide_date', placeholder: '例：2026/6 回診時醫師說已不用追蹤。' },
  { key: 'missing_context', label: '少了重要背景', requestedAction: 'upload_document', placeholder: '例：我有新的檢驗報告或出院摘要可以補上。' },
  { key: 'not_sure', label: '我不確定，請協助確認', requestedAction: 'provide_note', placeholder: '例：家人說有吃藥，但我不確定藥名或日期。' },
];

const REQUEST_STATUS_META: Record<string, { label: string; help: string; bg: string; color: string; border: string }> = {
  draft: { label: '回報草稿', help: '尚未送交醫療團隊。', bg: '#f6f9fa', color: '#56687a', border: '#e3e9ee' },
  pending_review: { label: '已送交醫療團隊', help: 'CMO 會先審查，不會直接覆蓋正式病歷。', bg: '#e7f3f5', color: '#33596a', border: '#cfe3e8' },
  needs_clarification: { label: '需要你補充', help: '醫療團隊需要更多資訊後才會繼續整理。', bg: '#fdf1e0', color: '#b06a10', border: '#fed7aa' },
  needs_secondary_review: { label: '醫療團隊二次確認中', help: '這筆內容還不會直接發布到正式摘要。', bg: '#fefce8', color: '#a97614', border: '#efdfae' },
  accepted: { label: '已確認', help: '醫療團隊已處理這次回報。', bg: '#e7f4ec', color: '#2e8b57', border: '#bfe0cd' },
  modified_and_accepted: { label: '已修正後確認', help: '醫療團隊已依最終內容整理。', bg: '#e7f4ec', color: '#2e8b57', border: '#bfe0cd' },
  rejected: { label: '未採用', help: '醫療團隊未採用這次回報。', bg: '#faecea', color: '#a03a30', border: '#fecdd3' },
  withdrawn: { label: '已撤回', help: '你已撤回這次回報。', bg: '#f6f9fa', color: '#6b7c8c', border: '#e3e9ee' },
};

function requestStatusMeta(req?: PatientChangeRequest) {
  return req ? REQUEST_STATUS_META[req.status] ?? REQUEST_STATUS_META.pending_review : null;
}

function feedbackOption(kind: FeedbackKind) {
  return FEEDBACK_OPTIONS.find((option) => option.key === kind) ?? FEEDBACK_OPTIONS[0];
}

// ─── Categorization ───────────────────────────────────────────────────────────

type CategoryKey = 'treating' | 'following' | 'screening' | 'resolved';

interface CategoryDef {
  key: CategoryKey;
  label: string;
  icon: string;
  dot: string;
  border: string;
  badgeBg: string;
  badgeFg: string;
  emptyText: string;
}

const CATEGORIES: Record<CategoryKey, CategoryDef> = {
  treating: {
    key: 'treating',
    label: '治療中',
    icon: '🔴',
    dot: '#c0453a',
    border: '#c0453a',
    badgeBg: '#faecea',
    badgeFg: '#b91c1c',
    emptyText: '目前沒有需治療的疾病',
  },
  following: {
    key: 'following',
    label: '追蹤中',
    icon: '🟣',
    dot: '#9333ea',
    border: '#9333ea',
    badgeBg: '#f3e8ff',
    badgeFg: '#7e22ce',
    emptyText: '目前沒有需追蹤的項目',
  },
  screening: {
    key: 'screening',
    label: '健檢預防',
    icon: '🟡',
    dot: '#eab308',
    border: '#eab308',
    badgeBg: '#fdf6e3',
    badgeFg: '#a97614',
    emptyText: '醫師將為您安排定期檢查',
  },
  resolved: {
    key: 'resolved',
    label: '已痊癒',
    icon: '⚪',
    dot: '#93a3af',
    border: '#c8d4dc',
    badgeBg: '#e3e9ee',
    badgeFg: '#56687a',
    emptyText: '目前沒有已痊癒的紀錄',
  },
};

function categorize(p: MyProblem): CategoryKey {
  if (p.status === 'resolved') return 'resolved';
  if (p.is_suspected) return 'following';
  if (p.status === 'underlying') return 'treating';
  return 'following';
}

// ─── Medication matching ──────────────────────────────────────────────────────

function matchMedsToProblem(problem: MyProblem, allMeds: Medication[]): Medication[] {
  const code = (problem.icd10_code || '').toUpperCase();
  const keywords: string[] = [];
  if (code.startsWith('I10') || code.startsWith('I11') || code.startsWith('I12') || code.startsWith('I13')) {
    keywords.push('pril', 'sartan', 'olol', 'amlodipine', 'dipine', '壓');
  }
  if (code.startsWith('E11') || code.startsWith('E10')) {
    keywords.push('metformin', 'insulin', 'gliptin', 'flozin', 'glinide', '糖');
  }
  if (code.startsWith('E78')) {
    keywords.push('statin', '脂');
  }
  if (code.startsWith('N18')) {
    keywords.push('腎');
  }
  if (code.startsWith('M')) {
    keywords.push('關節', 'NSAID', 'celecoxib', 'ibuprofen');
  }
  if (keywords.length === 0) return [];
  return allMeds.filter(m => {
    const name = (m.drug_name || '').toLowerCase();
    const layman = (m.drug_name_layman || '').toLowerCase();
    return keywords.some(kw => name.includes(kw.toLowerCase()) || layman.includes(kw.toLowerCase()));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

function formatFullDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '—';
  const diff = Date.now() - then;
  const day = 86400000;
  if (diff < day) return '今天';
  if (diff < day * 2) return '昨天';
  if (diff < day * 7) return `${Math.floor(diff / day)} 天前`;
  if (diff < day * 30) return `${Math.floor(diff / (day * 7))} 週前`;
  if (diff < day * 365) return `${Math.floor(diff / (day * 30))} 個月前`;
  return `${Math.floor(diff / (day * 365))} 年前`;
}

// Friendly tier label and dot color (NEVER show raw "T1/T2/T3" to patient)
function tierFriendly(tier: number): { label: string; dot: string } | null {
  if (tier === 1) return { label: '需優先關注', dot: '#c0453a' };
  if (tier === 2) return { label: '持續追蹤', dot: '#b7791f' };
  if (tier >= 3) return { label: '一般紀錄', dot: '#93a3af' };
  return null;
}

function statusLabel(status: string): string {
  if (status === 'resolved') return '已痊癒';
  if (status === 'following') return '追蹤中';
  return '治療中';
}

function problemTitleForPatient(p: MyProblem): string {
  const label = (p.display_layman || p.display_name || '').trim();
  if (isJunkProblemName(label)) return '待醫療團隊整理的健康項目';
  const withoutCodes = label.replace(/\b[A-Z]\d{2}(?:\.\d+)?\b/gi, '').replace(/\s+/g, ' ').trim();
  return withoutCodes || '待醫療團隊整理的健康項目';
}

function shouldShowRawProblemDetails(p: MyProblem): boolean {
  return Boolean(p.icd10_code || (p.display_layman && p.display_name !== p.display_layman) || p.source_document_id || p.evidence_document);
}

function problemEvidenceText(p: MyProblem): string {
  const doc = p.evidence_document;
  if (doc?.available) {
    const meta = evidenceMeta(doc);
    return `${evidenceTitle(doc)}${meta ? `（${meta}）` : ''}`;
  }
  if (doc) return `${evidenceTitle(doc)}（${evidenceUnavailableText(doc)}）`;
  if (p.source_document_id) return `已記錄來源文件 ID：${p.source_document_id}，但目前沒有可檢視連結`;
  return p.is_verified ? '醫療團隊已確認，但此列尚未連結原始文件' : '尚未連結原始文件';
}

async function loadSection<T>(label: string, request: Promise<unknown>, fallback: T): Promise<{ data: T; error: string | null }> {
  try {
    return { data: await request as T, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : '無法載入';
    return { data: fallback, error: `${label}：${message}` };
  }
}

function findNextVisit(problem: MyProblem, reminders: Reminder[]): Reminder | null {
  const now = Date.now();
  const candidates = reminders
    .filter(r => !r.is_done)
    .filter(r => {
      const when = r.remind_at || r.due_date || r.scheduled_date;
      if (!when) return false;
      return new Date(when).getTime() >= now - 86400000;
    });
  // Try matching by problem name in reminder title/note
  const name = (problem.display_layman || problem.display_name || '').toLowerCase();
  const matched = candidates.find(r => {
    const t = (r.title || '').toLowerCase();
    const n = (r.note || '').toLowerCase();
    return name && (t.includes(name) || n.includes(name));
  });
  if (matched) return matched;
  // Fall back to soonest visit-type reminder
  const visits = candidates
    .filter(r => (r.reminder_type || '').includes('visit') || (r.title || '').includes('回診') || (r.title || '').includes('門診'))
    .sort((a, b) => new Date(a.remind_at || a.due_date || 0).getTime() - new Date(b.remind_at || b.due_date || 0).getTime());
  return visits[0] || null;
}

// ─── Disease card ─────────────────────────────────────────────────────────────

function ProblemCard({
  p,
  cat,
  meds,
  nextVisit,
  onCopy,
  onCopyDoctor,
  pendingRequest,
  onReportIssue,
  onRequestState,
  onTrackingState,
  onWithdraw,
  onAddReminder,
  onOpenRequest,
}: {
  p: MyProblem;
  cat: CategoryDef;
  meds: Medication[];
  nextVisit: Reminder | null;
  onCopy: () => void;
  onCopyDoctor: () => void;
  pendingRequest?: PatientChangeRequest;
  onReportIssue: (payload: ProblemFeedbackPayload) => Promise<void> | void;
  onRequestState: (status: MyProblem['status']) => void;
  onTrackingState: (state: string) => void;
  onWithdraw: () => void;
  onAddReminder: (date: string) => void;
  onOpenRequest: (request: PatientChangeRequest) => void;
}) {
  const isResolved = cat.key === 'resolved';
  const tierInfo = !isResolved ? tierFriendly(p.tier) : null;
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [reminderDate, setReminderDate] = useState(() => dateStrFromToday(30));
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('incorrect');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const pendingMeta = requestStatusMeta(pendingRequest);
  const selectedFeedback = feedbackOption(feedbackKind);

  const submitFeedback = async () => {
    if (!feedbackNote.trim()) return;
    setSubmittingFeedback(true);
    try {
      await onReportIssue({ kind: feedbackKind, note: feedbackNote.trim() });
      setFeedbackNote('');
      setShowFeedback(false);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: '14px',
        padding: '18px 20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        borderLeft: `4px solid ${cat.border}`,
        border: `1px solid #eef2f5`,
        borderLeftWidth: '4px',
        borderLeftColor: cat.border,
        opacity: isResolved ? 0.78 : 1,
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#22313f', margin: 0, lineHeight: 1.3 }}>
          {problemTitleForPatient(p)}
        </h3>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {tierInfo && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              fontSize: '11px', fontWeight: 600, padding: '2px 9px',
              borderRadius: '20px', background: '#f6f9fa', color: '#56687a',
              border: '1px solid #e3e9ee',
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: tierInfo.dot, flexShrink: 0 }} />
              {tierInfo.label}
            </span>
          )}
          {p.is_verified && !isResolved && (
            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: '#d1fae5', color: '#065f46', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              CMO 已確認
            </span>
          )}
          {pendingRequest && (
            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: pendingMeta?.bg ?? '#fdf6e3', color: pendingMeta?.color ?? '#92400e', border: `1px solid ${pendingMeta?.border ?? '#efdfae'}` }}>
              {pendingMeta?.label ?? '待醫療團隊確認'}
            </span>
          )}
          {p.is_suspected && (
            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: '#fdf6e3', color: '#a97614' }}>
              疑似診斷
            </span>
          )}
        </div>
      </div>

      {/* Info rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#45596a' }}>
        {meds.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <span style={{ flexShrink: 0, opacity: 0.7 }}>💊</span>
            <span style={{ lineHeight: 1.5 }}>
              {meds.slice(0, 4).map(m => m.drug_name_layman || m.drug_name).join('、')}
              {meds.length > 4 && <span style={{ color: '#93a3af' }}> 等 {meds.length} 種</span>}
            </span>
          </div>
        )}
        {nextVisit && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <span style={{ flexShrink: 0, opacity: 0.7 }}>📅</span>
            <span>
              下次回診：<strong style={{ color: '#22313f' }}>{formatDate(nextVisit.remind_at || nextVisit.due_date)}</strong>
              {nextVisit.title && <span style={{ color: '#93a3af' }}> · {nextVisit.title}</span>}
            </span>
          </div>
        )}
        {isResolved && p.resolution_date && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6b7c8c' }}>
            <span style={{ opacity: 0.7 }}>✓</span>
            <span>痊癒於 {formatFullDate(p.resolution_date)}</span>
          </div>
        )}
      </div>

      {/* Two-layer overlay: your own tracking mark vs the medical team's record */}
      {p.patient_tracking_state && (
        <div style={{ marginTop: '12px', padding: '8px 10px', background: '#ecfeff', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#3e6b7e' }}>
            你目前標記：{TRACKING_LABELS[p.patient_tracking_state] ?? p.patient_tracking_state}
          </span>
          <span style={{ fontSize: '11px', color: '#6b7c8c' }}>
            醫療整理狀態：{statusLabel(p.status)}
            {p.patient_tracking_state !== 'following' && p.patient_tracking_state !== 'actively_treating' && ' · 醫療團隊尚未整理這次更新'}
          </span>
        </div>
      )}

      {pendingRequest && pendingMeta && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: pendingMeta.bg, border: `1px solid ${pendingMeta.border}`, borderRadius: 10, color: pendingMeta.color }}>
          <div style={{ fontSize: 12, fontWeight: 850 }}>{pendingMeta.label}</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, marginTop: 3, color: '#56687a' }}>
            {pendingRequest.patient_facing_note || pendingRequest.reviewer_note || pendingMeta.help}
          </div>
          {pendingRequest.status === 'needs_clarification' && (
            <button
              onClick={() => onOpenRequest(pendingRequest)}
              style={{
                marginTop: 8, padding: '6px 10px', fontSize: 12, fontWeight: 800,
                background: '#fff', color: '#b06a10', border: '1px solid #fed7aa',
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              補充資料
            </button>
          )}
          {['draft', 'pending_review', 'needs_clarification'].includes(pendingRequest.status) && (
            <button
              onClick={onWithdraw}
              style={{
                marginTop: 8, marginLeft: pendingRequest.status === 'needs_clarification' ? 8 : 0,
                padding: '6px 10px', fontSize: 12, fontWeight: 800,
                background: '#fff', color: '#a03a30', border: '1px solid #fecdd3',
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              撤回回報
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      {!isResolved && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
          <button
            onClick={onCopy}
            style={{
              padding: '6px 12px', fontSize: '12px', fontWeight: 600,
              background: '#eef2f5', color: '#56687a', border: '1px solid #e3e9ee',
              borderRadius: '8px', cursor: 'pointer',
            }}
          >
            📋 複製白話摘要
          </button>
          {!pendingRequest ? (
            <button
              onClick={() => setShowFeedback((open) => !open)}
              style={{
                padding: '6px 12px', fontSize: '12px', fontWeight: 600,
                background: '#fdf1e0', color: '#b06a10', border: '1px solid #fed7aa',
                borderRadius: '8px', cursor: 'pointer',
              }}
            >
              {showFeedback ? '取消回報' : '回報資料有誤'}
            </button>
          ) : (
            <button
              onClick={() => onOpenRequest(pendingRequest)}
              title="已有待處理回報，請查看目前狀態"
              style={{
                padding: '6px 12px', fontSize: '12px', fontWeight: 600,
                background: '#f6f9fa', color: '#56687a', border: '1px solid #e3e9ee',
                borderRadius: '8px', cursor: 'pointer',
              }}
            >
              查看回報狀態
            </button>
          )}
          {!showDatePicker ? (
            <button
              onClick={() => { setReminderDate(dateStrFromToday(30)); setShowDatePicker(true); }}
              style={{
                padding: '6px 12px', fontSize: '12px', fontWeight: 600,
                background: '#e7f4ec', color: '#2e8b57', border: '1px solid #bfe0cd',
                borderRadius: '8px', cursor: 'pointer',
              }}
            >
              新增回診提醒
            </button>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <input
                type="date"
                value={reminderDate}
                autoFocus
                onChange={(e) => setReminderDate(e.target.value)}
                style={{
                  padding: '5px 10px', fontSize: '12px', fontWeight: 600, color: '#2e8b57',
                  background: '#fff', border: '1px solid #bfe0cd', borderRadius: '8px', cursor: 'pointer',
                }}
              />
              <button
                onClick={() => {
                  if (!reminderDate) return;
                  onAddReminder(reminderDate);
                  setShowDatePicker(false);
                }}
                disabled={!reminderDate}
                style={{
                  padding: '6px 12px', fontSize: '12px', fontWeight: 700, color: '#fff',
                  background: reminderDate ? '#2e8b57' : '#bfe0cd', border: 'none',
                  borderRadius: '8px', cursor: reminderDate ? 'pointer' : 'not-allowed',
                }}
              >
                確認回診日期
              </button>
              <button
                onClick={() => setShowDatePicker(false)}
                style={{
                  padding: '6px 10px', fontSize: '12px', fontWeight: 600, color: '#6b7c8c',
                  background: '#fff', border: '1px solid #e3e9ee', borderRadius: '8px', cursor: 'pointer',
                }}
              >
                取消
              </button>
            </span>
          )}
        </div>
      )}

      <details className="hk-problem-details" style={{ marginTop: 12 }}>
        <summary>詳細資料與進階操作</summary>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shouldShowRawProblemDetails(p) && (
            <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f6f9fa', border: '1px solid #e3e9ee', fontSize: 12, color: '#56687a', lineHeight: 1.6 }}>
              {p.display_layman && p.display_name !== p.display_layman && <div>原始醫療名稱：{p.display_name}</div>}
              {p.icd10_code && <div>ICD：{p.icd10_code}</div>}
              <ProblemEvidenceLine doc={p.evidence_document ?? null} fallbackId={p.source_document_id ?? null} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={onCopyDoctor}
              style={{
                padding: '6px 12px', fontSize: '12px', fontWeight: 600,
                background: '#fff', color: '#0369a1', border: '1px solid #bae6fd',
                borderRadius: '8px', cursor: 'pointer',
              }}
            >
              複製給醫師
            </button>
            {!isResolved && (
              <>
                <select
                  value={p.patient_tracking_state ?? ''}
                  onChange={(event) => {
                    if (event.target.value) onTrackingState(event.target.value);
                  }}
                  title="更新你自己的追蹤偏好（立即生效，不需等醫療團隊）"
                  style={{
                    padding: '6px 10px', fontSize: '12px', fontWeight: 600,
                    background: '#ecfeff', color: '#3e6b7e', border: '1px solid #a5f3fc',
                    borderRadius: '8px', cursor: 'pointer',
                  }}
                >
                  <option value="" disabled>更新我的追蹤狀態…</option>
                  {TRACKING_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <select
                  value=""
                  onChange={(event) => {
                    const value = event.target.value as MyProblem['status'];
                    if (value) onRequestState(value);
                    event.currentTarget.value = '';
                  }}
                  title="請醫療團隊更新正式醫療紀錄（需整理確認）"
                  style={{
                    padding: '6px 10px', fontSize: '12px', fontWeight: 600,
                    background: '#fff', color: '#0369a1', border: '1px solid #bae6fd',
                    borderRadius: '8px', cursor: 'pointer',
                  }}
                >
                  <option value="">請醫療團隊改正式狀態</option>
                  <option value="underlying">長期治療中</option>
                  <option value="following">追蹤中</option>
                  <option value="resolved">已結束</option>
                </select>
              </>
            )}
          </div>
        </div>
      </details>

      {showFeedback && !pendingRequest && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: '1px solid #fed7aa', background: '#fdf1e0' }}>
          <div style={{ fontSize: 12, fontWeight: 850, color: '#b06a10', marginBottom: 8 }}>送交醫療團隊確認</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, fontWeight: 800, color: '#b06a10' }}>
              回報類型
              <select
                value={feedbackKind}
                onChange={(event) => setFeedbackKind(event.target.value as FeedbackKind)}
                style={{ border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 10px', fontSize: 12, background: '#fff', color: '#431407' }}
              >
                {FEEDBACK_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, fontWeight: 800, color: '#b06a10' }}>
              需要確認的內容
              <textarea
                value={feedbackNote}
                onChange={(event) => setFeedbackNote(event.target.value)}
                rows={3}
                placeholder={selectedFeedback.placeholder}
                style={{ border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 10px', fontSize: 12, background: '#fff', color: '#431407', resize: 'vertical', minHeight: 74 }}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <div style={{ fontSize: 11, color: '#b06a10', lineHeight: 1.5 }}>送出後會進入 CMO 工作佇列；正式摘要不會在 QA 前被直接覆蓋。</div>
            <button
              onClick={submitFeedback}
              disabled={!feedbackNote.trim() || submittingFeedback}
              title={!feedbackNote.trim() ? '請先填寫需要確認的內容' : '送交醫療團隊確認'}
              style={{
                padding: '8px 12px', fontSize: 12, fontWeight: 850,
                background: feedbackNote.trim() && !submittingFeedback ? '#b06a10' : '#fed7aa',
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: feedbackNote.trim() && !submittingFeedback ? 'pointer' : 'not-allowed',
              }}
            >
              {submittingFeedback ? '送出中...' : '送出回報'}
            </button>
          </div>
        </div>
      )}

      {/* Source footer */}
      {(p.verified_by_name || p.created_at) && (
        <div style={{
          marginTop: '12px', paddingTop: '10px',
          borderTop: '1px dashed #e3e9ee',
          fontSize: '11px', color: '#93a3af',
        }}>
          <div style={{ fontStyle: 'italic' }}>
            {p.verified_by_name ? `✓ 由 ${p.verified_by_name} 醫師確認` : '○ 待醫師確認'}
            {p.created_at && (
              <>
                <span style={{ margin: '0 6px' }}>·</span>
                最後更新 {formatRelative(p.created_at)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProblemEvidenceLine({ doc, fallbackId }: { doc: EvidenceDocument | null; fallbackId: string | null }) {
  if (!doc) {
    return (
      <div style={{ marginTop: '6px', color: '#93a3af', lineHeight: 1.45 }}>
        原始文件：{fallbackId ? `已記錄 ID：${fallbackId}，但尚未建立可檢視連結` : '尚未連結原始文件'}
      </div>
    );
  }
  if (!doc.available || !doc.download_url) {
    return (
      <div style={{ marginTop: '6px', color: '#93a3af', lineHeight: 1.45 }}>
        原始文件：{evidenceTitle(doc)} · {evidenceUnavailableText(doc)}
      </div>
    );
  }
  return (
    <div style={{ marginTop: '6px', lineHeight: 1.45 }}>
      原始文件：
      <a href={doc.download_url} target="_blank" rel="noreferrer" style={{ color: '#3e6b7e', fontWeight: 700, textDecoration: 'none', wordBreak: 'break-word' }}>
        查看 {evidenceTitle(doc)}
      </a>
      {evidenceMeta(doc) && <span style={{ color: '#93a3af' }}> · {evidenceMeta(doc)}</span>}
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function CategorySection({
  cat,
  problems,
  allMeds,
  reminders,
  onCopyOne,
  onCopyDoctorOne,
  pendingByProblem,
  onReportIssue,
  onRequestState,
  onTrackingState,
  onWithdraw,
  onAddReminder,
  onOpenRequest,
}: {
  cat: CategoryDef;
  problems: MyProblem[];
  allMeds: Medication[];
  reminders: Reminder[];
  onCopyOne: (p: MyProblem) => void;
  onCopyDoctorOne: (p: MyProblem) => void;
  pendingByProblem: Map<string, PatientChangeRequest>;
  onReportIssue: (p: MyProblem, payload: ProblemFeedbackPayload) => Promise<void> | void;
  onRequestState: (p: MyProblem, status: MyProblem['status']) => void;
  onTrackingState: (p: MyProblem, state: string) => void;
  onWithdraw: (requestId: string) => void;
  onAddReminder: (p: MyProblem, date: string) => void;
  onOpenRequest: (request: PatientChangeRequest) => void;
}) {
  return (
    <section style={{ marginBottom: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: cat.dot }} />
        <h2 style={{ fontSize: '12px', fontWeight: 700, color: '#56687a', textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>
          {cat.label}
        </h2>
        <span style={{ fontSize: '12px', color: '#93a3af', fontWeight: 600 }}>
          {problems.length > 0 ? `· ${problems.length}` : ''}
        </span>
      </div>

      {problems.length === 0 ? (
        <div style={{
          background: '#fafbfc', borderRadius: '12px', padding: '20px',
          border: '1px dashed #e3e9ee', fontSize: '13px', color: '#93a3af', textAlign: 'center',
        }}>
          {cat.emptyText}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {problems.map(p => (
            <ProblemCard
              key={p.id}
              p={p}
              cat={cat}
              meds={matchMedsToProblem(p, allMeds)}
              nextVisit={findNextVisit(p, reminders)}
              pendingRequest={pendingByProblem.get(String(p.id))}
              onCopy={() => onCopyOne(p)}
              onCopyDoctor={() => onCopyDoctorOne(p)}
              onReportIssue={(payload) => onReportIssue(p, payload)}
              onRequestState={(status) => onRequestState(p, status)}
              onTrackingState={(state) => onTrackingState(p, state)}
              onWithdraw={() => {
                const req = pendingByProblem.get(String(p.id));
                if (req) onWithdraw(req.id);
              }}
              onAddReminder={(date) => onAddReminder(p, date)}
              onOpenRequest={onOpenRequest}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Daily metrics summary ────────────────────────────────────────────────────

function MetricsRow({ records }: { records: RecordOut[] }) {
  const latest = useMemo(() => {
    const map: Record<string, RecordOut> = {};
    for (const r of records) if (!map[r.record_type]) map[r.record_type] = r;
    return map;
  }, [records]);

  const items = [
    {
      key: 'blood_pressure', label: '血壓', icon: '❤️', color: '#f44336',
      value: latest.blood_pressure?.value1 && latest.blood_pressure?.value2
        ? `${latest.blood_pressure.value1}/${latest.blood_pressure.value2}` : null,
      unit: 'mmHg',
    },
    {
      key: 'glucose', label: '血糖', icon: '🩸', color: '#ff9800',
      value: latest.glucose?.value1 || null, unit: 'mg/dL',
    },
    {
      key: 'weight', label: '體重', icon: '⚖️', color: '#2196f3',
      value: latest.weight?.value1 || null, unit: 'kg',
    },
  ];

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px',
      marginBottom: '24px',
    }}>
      {items.map(it => (
        <div key={it.key} style={{
          background: '#fff', borderRadius: '12px', padding: '12px 14px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #eef2f5',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '18px' }}>{it.icon}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '10px', color: '#93a3af', fontWeight: 600, letterSpacing: '0.3px' }}>{it.label}</div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: it.value ? '#22313f' : '#c8d4dc', lineHeight: 1.2 }}>
              {it.value || '—'}
              {it.value && <span style={{ fontSize: '10px', color: '#93a3af', fontWeight: 500, marginLeft: '3px' }}>{it.unit}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HealthProfileLoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div key={item} style={{ background: '#fff', border: '1px solid #eef2f5', borderRadius: 14, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ width: '42%', height: 16, borderRadius: 999, background: '#e3e9ee', marginBottom: 12 }} />
          <div style={{ width: '72%', height: 11, borderRadius: 999, background: '#eef2f5', marginBottom: 8 }} />
          <div style={{ width: '55%', height: 11, borderRadius: 999, background: '#eef2f5' }} />
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HealthProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const sync = useSync();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const [problems, setProblems] = useState<MyProblem[]>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [requests, setRequests] = useState<PatientChangeRequest[]>([]);
  const [records, setRecords] = useState<RecordOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家' : '本人');
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    const params = memberQueryParams(activeMember);
    Promise.all([
      loadSection<MyProblem[]>('健康摘要', api.get('/api/patients/me/problems', params), []),
      loadSection<Medication[]>('用藥資料', api.get('/api/medications', params), []),
      loadSection<Reminder[]>('提醒資料', api.get('/api/patients/me/reminders', params), []),
      loadSection<PatientChangeRequest[]>('回報狀態', api.get('/api/patients/me/change-requests'), []),
      loadSection<RecordOut[]>('近期量測', api.get('/api/records', { ...(params ?? {}), limit: '20' }), []),
    ]).then(([pData, mData, rData, reqData, recData]) => {
      if (!alive) return;
      setLoadError([pData, mData, rData, reqData, recData].map((item) => item.error).filter(Boolean).join('；'));
      setProblems(cleanPatientProblems(Array.isArray(pData.data) ? pData.data : []));
      setMeds(Array.isArray(mData.data) ? mData.data.filter((m: Medication) => m.is_active !== false && m.status !== 'discontinued') : []);
      setReminders(Array.isArray(rData.data) ? rData.data : []);
      setRequests(Array.isArray(reqData.data) ? reqData.data : []);
      setRecords(Array.isArray(recData.data) ? recData.data : []);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activeMember, reloadToken]);

  // Cross-view sync: refetch problems when the medical team publishes/reconciles.
  useEffect(() => {
    if (sync.version === 0) return;
    let alive = true;
    api.get('/api/patients/me/problems', memberQueryParams(activeMember)).then(d => { if (alive && Array.isArray(d)) setProblems(cleanPatientProblems(d)); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMember, sync.viewVersions.patient_problem_detail, sync.viewVersions.patient_dashboard]);

  const grouped = useMemo(() => {
    const g: Record<CategoryKey, MyProblem[]> = { treating: [], following: [], screening: [], resolved: [] };
    for (const p of problems) g[categorize(p)].push(p);
    return g;
  }, [problems]);

  const pendingByProblem = useMemo(() => {
    const map = new Map<string, PatientChangeRequest>();
    for (const req of requests) {
      if (req.target_type === 'problem' && req.target_id && ['draft', 'pending_review', 'needs_clarification'].includes(req.status)) {
        map.set(String(req.target_id), req);
      }
    }
    return map;
  }, [requests]);

  async function refreshRequests() {
    const data = await api.get('/api/patients/me/change-requests').catch(() => []);
    setRequests(Array.isArray(data) ? data as PatientChangeRequest[] : []);
  }

  function openRequest(req: PatientChangeRequest) {
    const destination = req.status === 'needs_clarification'
      ? req.action_url || `/dashboard/clarifications/${req.id}`
      : req.action_url || '/dashboard/history';
    router.push(memberHref(destination, activeMember));
  }

  async function reportIssue(p: MyProblem, feedback: ProblemFeedbackPayload) {
    const existing = pendingByProblem.get(String(p.id));
    if (existing) {
      if (existing.status === 'needs_clarification') openRequest(existing);
      else showToast('已有待醫療團隊確認的回報，請先查看或撤回原本請求', 'info');
      return;
    }
    const option = feedbackOption(feedback.kind);
    try {
      const created = await api.post('/api/patients/me/change-requests', {
        target_type: 'problem',
        target_id: p.id,
        action: 'update',
        current_snapshot: p,
        proposed_payload: {
          patient_reported_issue: true,
          issue_type: feedback.kind,
          requested_action: option.requestedAction,
          target_label: p.display_layman || p.display_name,
          member_name: p.member_name || activeMember || '本人',
        },
        patient_note: feedback.note,
        status: 'pending_review',
      }) as PatientChangeRequest;
      setRequests(prev => [created, ...prev]);
      showToast('已送交醫療團隊確認', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'duplicate_change_request') {
        const existingRequest = (error.details as { existing_request?: PatientChangeRequest } | undefined)?.existing_request;
        if (existingRequest) setRequests(prev => [existingRequest, ...prev.filter(req => req.id !== existingRequest.id)]);
        showToast('已有待確認的相同異動，請先查看或撤回原本請求', 'info');
        return;
      }
      showToast('送出失敗，請稍後再試', 'error');
    }
  }

  async function requestStateChange(p: MyProblem, status: MyProblem['status']) {
    if (status === p.status) return;
    const existing = pendingByProblem.get(String(p.id));
    if (existing) {
      showToast('已有待醫療團隊確認的狀態異動', 'info', {
        label: '撤回',
        durationMs: 10000,
        onClick: () => withdrawRequest(existing.id),
      });
      return;
    }
    try {
      const created = await api.post(`/api/patients/me/problems/${p.id}/request-state-change`, {
        to_status: status,
        patient_note: `希望將狀態改為「${statusLabel(status)}」`,
      }) as PatientChangeRequest;
      setRequests(prev => [created, ...prev.filter(req => req.id !== created.id)]);
      showToast('狀態異動已送交醫療團隊確認', 'success', {
        label: '撤回',
        durationMs: 10000,
        onClick: () => withdrawRequest(created.id),
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'duplicate_change_request') {
        const existingRequest = (error.details as { existing_request?: PatientChangeRequest } | undefined)?.existing_request;
        if (existingRequest) setRequests(prev => [existingRequest, ...prev.filter(req => req.id !== existingRequest.id)]);
        showToast('已有待確認的相同異動', 'info');
        return;
      }
      showToast('送出失敗，請稍後再試', 'error');
    }
  }

  // Patient tracking preference — immediate overlay, no CMO approval (two-layer model).
  async function setTrackingState(p: MyProblem, state: string) {
    const previous = p.patient_tracking_state ?? null;
    if (state === previous) return;
    setProblems(prev => prev.map(x => x.id === p.id ? { ...x, patient_tracking_state: state } : x));
    try {
      await api.post(`/api/patients/me/problems/${p.id}/tracking-state`, { tracking_state: state });
      showToast(`已更新：你目前標記「${TRACKING_LABELS[state] ?? state}」`, 'success',
        previous ? { label: '改回', durationMs: 8000, onClick: () => setTrackingState({ ...p, patient_tracking_state: state }, previous) } : undefined);
      sync.refreshNow();
    } catch {
      setProblems(prev => prev.map(x => x.id === p.id ? { ...x, patient_tracking_state: previous } : x));
      showToast('更新失敗，請稍後再試', 'error');
    }
  }

  async function withdrawRequest(requestId: string) {
    try {
      const updated = await api.post(`/api/patients/me/change-requests/${requestId}/withdraw`) as PatientChangeRequest;
      setRequests(prev => prev.map(req => req.id === updated.id ? updated : req));
      showToast('已撤回異動請求', 'info');
    } catch {
      showToast('撤回失敗，可能已被醫療團隊處理', 'error');
      await refreshRequests();
    }
  }

  async function addProblemReminder(p: MyProblem, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
      showToast('請選擇有效的回診日期', 'error');
      return;
    }
    try {
      const created = await api.post('/api/patients/me/reminders', {
        type: 'follow_up',
        title: `${p.display_layman || p.display_name} 回診提醒`,
        scheduled_date: date,
        // Tag the member viewing this profile so it shows in the Reminders tab
        // under the same person (both screens share the member filter).
        member_name: activeMember || '本人',
        note: '由使用者在健康摘要中新增。',
      }) as Reminder;
      setReminders(prev => [created, ...prev]);
      showToast(`已新增回診提醒（${date}），可在「回診紀錄」查看`, 'success', {
        label: 'Undo',
        durationMs: 10000,
        onClick: async () => {
          await api.delete(`/api/patients/me/reminders/${created.id}`);
          setReminders(prev => prev.filter(item => String(item.id) !== String(created.id)));
        },
      });
      sync.refreshNow();
    } catch {
      showToast('新增提醒失敗，請稍後再試', 'error');
    }
  }

  async function requestProblemCreate() {
    const name = window.prompt('請輸入想補充的健康狀況或症狀', '');
    if (!name?.trim()) return;
    try {
      const created = await api.post('/api/patients/me/problems/request-create', {
        display_name: name.trim(),
        display_layman: name.trim(),
        status: 'following',
        is_suspected: true,
        patient_note: `${activeMember ? `對象：${activeMember}。` : ''}使用者自我回報，待醫療團隊確認。`,
      }) as PatientChangeRequest;
      setRequests(prev => [created, ...prev]);
      showToast('已送交醫療團隊確認', 'success', {
        label: '撤回',
        durationMs: 10000,
        onClick: () => withdrawRequest(created.id),
      });
    } catch {
      showToast('送出失敗，請稍後再試', 'error');
    }
  }

  function buildProblemMarkdown(p: MyProblem): string {
    const meds_p = matchMedsToProblem(p, meds);
    const next = findNextVisit(p, reminders);
    const lines: string[] = [];
    lines.push(`## ${p.display_layman || p.display_name}`);
    if (p.icd10_code) lines.push(`- 醫學名稱：${p.display_name} (${p.icd10_code})`);
    lines.push(`- 狀態：${p.is_suspected ? '疑似 / 追蹤中' : statusLabel(p.status)}`);
    if (p.tier) lines.push(`- 嚴重度：T${p.tier}`);
    lines.push(`- 來源文件：${problemEvidenceText(p)}`);
    if (meds_p.length > 0) lines.push(`- 用藥：${meds_p.map(m => m.drug_name_layman || m.drug_name).join('、')}`);
    if (next) lines.push(`- 下次回診：${formatFullDate(next.remind_at || next.due_date || next.scheduled_date)}${next.title ? ` (${next.title})` : ''}`);
    if (p.onset_date) lines.push(`- 發病日期：${formatFullDate(p.onset_date)}`);
    if (p.resolution_date) lines.push(`- 痊癒日期：${formatFullDate(p.resolution_date)}`);
    return lines.join('\n');
  }

  function buildDoctorMarkdown(p: MyProblem): string {
    const lines: string[] = [];
    lines.push(`## ${p.display_name} (${p.icd10_code || 'no code'})`);
    lines.push(`- 狀態: ${statusLabel(p.status)}`);
    lines.push(`- 嚴重度: Tier ${p.tier}`);
    lines.push(`- Evidence: ${problemEvidenceText(p)}`);
    lines.push(`- 發病: ${p.onset_date || '未記錄'}`);
    if (p.resolution_date) lines.push(`- 痊癒日期: ${p.resolution_date}`);
    if (p.verified_by_name) lines.push(`- 確認醫師: ${p.verified_by_name}`);
    return lines.join('\n');
  }

  async function copyOne(p: MyProblem) {
    try {
      await navigator.clipboard.writeText(buildProblemMarkdown(p));
      setCopyMsg(`已複製「${p.display_layman || p.display_name}」`);
      setTimeout(() => setCopyMsg(null), 2000);
    } catch {
      setCopyMsg('複製失敗，請手動選取');
      setTimeout(() => setCopyMsg(null), 2000);
    }
  }

  async function copyDoctorOne(p: MyProblem) {
    try {
      await navigator.clipboard.writeText(buildDoctorMarkdown(p));
      setCopyMsg(`已複製醫師格式：「${p.display_name}」`);
      setTimeout(() => setCopyMsg(null), 2000);
    } catch {
      setCopyMsg('複製失敗，請手動選取');
      setTimeout(() => setCopyMsg(null), 2000);
    }
  }

  async function copyAll() {
    const sections: string[] = [];
    sections.push(`# ${scopeLabel}的健康摘要`);
    sections.push(`_由 HealthKeep 醫療團隊整理 · ${new Date().toLocaleDateString('zh-TW')}_\n`);
    for (const key of ['treating', 'following', 'resolved'] as CategoryKey[]) {
      const list = grouped[key];
      if (list.length === 0) continue;
      sections.push(`# ${CATEGORIES[key].label}（${list.length}）`);
      for (const p of list) sections.push(buildProblemMarkdown(p));
    }
    try {
      await navigator.clipboard.writeText(sections.join('\n\n'));
      setCopyMsg('已複製完整健康摘要');
      setTimeout(() => setCopyMsg(null), 2200);
    } catch {
      setCopyMsg('複製失敗，請手動選取');
      setTimeout(() => setCopyMsg(null), 2200);
    }
  }

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div className="hk-health-wrap">

        {/* Top-right link to history timeline */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button
            onClick={() => router.push(memberHref('/dashboard/history', activeMember))}
            style={{
              background: 'none', border: 'none', color: '#059669',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              padding: '4px 6px',
            }}
          >
            查看完整就醫紀錄 →
          </button>
        </div>

        {/* Compact hero */}
        <div
          style={{
            background: 'linear-gradient(135deg, #e7f4ec 0%, #d1fae5 100%)',
            borderRadius: '16px',
            padding: '18px 22px',
            marginBottom: '20px',
            border: '1px solid #bfe0cd',
            display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
          }}
        >
          <div style={{
            width: '42px', height: '42px', borderRadius: '12px',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '22px', flexShrink: 0,
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
          }}>
            🩺
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 style={{ fontSize: '18px', fontWeight: 800, color: '#064e3b', margin: 0, lineHeight: 1.2 }}>
              {scopeLabel}的醫師健康摘要
            </h1>
            <p style={{ fontSize: '12px', color: '#2e8b57', margin: '3px 0 0' }}>
              用藥、提醒、生命徵象與 Problem 摘要皆依目前成員顯示；醫療團隊發布後會同步到對應成員的健康摘要
            </p>
          </div>
          {!loading && problems.length > 0 && (
            <div style={{ display: 'flex', gap: '14px', flexShrink: 0, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#064e3b', lineHeight: 1 }}>{grouped.treating.length}</div>
                <div style={{ fontSize: '10px', color: '#2e8b57', fontWeight: 600, marginTop: '2px' }}>治療中</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#064e3b', lineHeight: 1 }}>{grouped.following.length}</div>
                <div style={{ fontSize: '10px', color: '#2e8b57', fontWeight: 600, marginTop: '2px' }}>追蹤中</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#064e3b', lineHeight: 1 }}>{grouped.resolved.length}</div>
                <div style={{ fontSize: '10px', color: '#2e8b57', fontWeight: 600, marginTop: '2px' }}>已痊癒</div>
              </div>
            </div>
          )}
        </div>

        {loadError && (
          <div style={{ background: '#fdf1e0', border: '1px solid #fed7aa', borderRadius: 12, padding: '12px 14px', color: '#b06a10', fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
            <strong>部分資料暫時無法載入。</strong>
            <div style={{ marginTop: 4 }}>{loadError}</div>
            <button
              onClick={() => setReloadToken((value) => value + 1)}
              style={{ marginTop: 8, padding: '7px 10px', border: '1px solid #fed7aa', borderRadius: 8, background: '#fff', color: '#b06a10', fontWeight: 800, cursor: 'pointer' }}
            >
              重新載入
            </button>
          </div>
        )}

        {/* Daily metrics */}
        {!loading && records.length > 0 && (
          <div onClick={() => router.push('/dashboard')} style={{ cursor: 'pointer' }}>
            <MetricsRow records={records} />
          </div>
        )}

        {/* Loading */}
        {loading && (
          <HealthProfileLoadingSkeleton />
        )}

        {!loading && problems.length === 0 && loadError && (
          <div style={{ background: '#faecea', borderRadius: '16px', padding: '36px 28px', textAlign: 'center', border: '1px solid #fecdd3', marginTop: 14 }}>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#8f342b', marginBottom: 8 }}>健康摘要暫時無法載入</h3>
            <p style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.7, maxWidth: 460, margin: '0 auto 18px' }}>
              這不是代表沒有病歷資料。請重新載入；如果仍失敗，醫療團隊端需要確認 API 或權限狀態。
            </p>
            <button
              onClick={() => setReloadToken((value) => value + 1)}
              style={{ padding: '10px 18px', background: '#fff', color: '#a03a30', border: '1px solid #fecdd3', borderRadius: 10, fontWeight: 800, cursor: 'pointer' }}
            >
              重新載入
            </button>
          </div>
        )}

        {/* Empty (no problems at all) */}
        {!loading && problems.length === 0 && !loadError && (
          <div style={{
            background: '#fff', borderRadius: '16px', padding: '52px 32px',
            textAlign: 'center', border: '1px dashed #c8d4dc',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '14px' }}>📋</div>
            <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#22313f', marginBottom: '8px' }}>
              {scopeLabel}還沒有醫師確認的資料
            </h3>
            <p style={{ fontSize: '13px', color: '#6b7c8c', lineHeight: 1.7, maxWidth: '380px', margin: '0 auto 22px' }}>
              當您上傳健康資料後，醫療團隊會審閱並整理出您的健康狀況摘要
            </p>
            <button
              onClick={requestProblemCreate}
              style={{
                padding: '10px 24px',
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#fff', border: 'none', borderRadius: '10px',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              }}
            >
              新增自我回報的健康狀況
            </button>
            <button
              onClick={() => router.push('/dashboard/upload')}
              style={{
                marginLeft: '10px',
                padding: '10px 18px',
                background: '#fff',
                color: '#059669', border: '1px solid #bfe0cd', borderRadius: '10px',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              }}
            >
              上傳健康資料
            </button>
          </div>
        )}

        {/* 4 categories */}
        {!loading && problems.length > 0 && (
          <>
            <CategorySection cat={CATEGORIES.treating} problems={grouped.treating} allMeds={meds} reminders={reminders} pendingByProblem={pendingByProblem} onCopyOne={copyOne} onCopyDoctorOne={copyDoctorOne} onReportIssue={reportIssue} onRequestState={requestStateChange} onTrackingState={setTrackingState} onWithdraw={withdrawRequest} onAddReminder={addProblemReminder} onOpenRequest={openRequest} />
            <CategorySection cat={CATEGORIES.following} problems={grouped.following} allMeds={meds} reminders={reminders} pendingByProblem={pendingByProblem} onCopyOne={copyOne} onCopyDoctorOne={copyDoctorOne} onReportIssue={reportIssue} onRequestState={requestStateChange} onTrackingState={setTrackingState} onWithdraw={withdrawRequest} onAddReminder={addProblemReminder} onOpenRequest={openRequest} />
            <CategorySection cat={CATEGORIES.screening} problems={grouped.screening} allMeds={meds} reminders={reminders} pendingByProblem={pendingByProblem} onCopyOne={copyOne} onCopyDoctorOne={copyDoctorOne} onReportIssue={reportIssue} onRequestState={requestStateChange} onTrackingState={setTrackingState} onWithdraw={withdrawRequest} onAddReminder={addProblemReminder} onOpenRequest={openRequest} />
            <CategorySection cat={CATEGORIES.resolved} problems={grouped.resolved} allMeds={meds} reminders={reminders} pendingByProblem={pendingByProblem} onCopyOne={copyOne} onCopyDoctorOne={copyDoctorOne} onReportIssue={reportIssue} onRequestState={requestStateChange} onTrackingState={setTrackingState} onWithdraw={withdrawRequest} onAddReminder={addProblemReminder} onOpenRequest={openRequest} />
          </>
        )}

        {/* Footer copy button */}
        {!loading && problems.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '28px 0 16px' }}>
            <button
              onClick={copyAll}
              style={{
                padding: '12px 22px',
                background: '#fff', color: '#56687a',
                border: '1.5px solid #e3e9ee', borderRadius: '12px',
                fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#10b981';
                (e.currentTarget as HTMLButtonElement).style.color = '#059669';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#e3e9ee';
                (e.currentTarget as HTMLButtonElement).style.color = '#56687a';
              }}
            >
              📋 複製完整健康摘要
            </button>
          </div>
        )}

        {/* About footer */}
        {!loading && problems.length > 0 && (
          <div style={{
            background: '#f6f9fa', borderRadius: '12px', padding: '14px 18px',
            fontSize: '12px', color: '#6b7c8c', lineHeight: 1.7,
            border: '1px solid #e3e9ee', marginBottom: '20px',
          }}>
            <div style={{ fontWeight: 700, color: '#56687a', marginBottom: '4px' }}>📌 關於本頁資料</div>
            這些健康摘要由您的醫師審閱您的紀錄與檢驗結果後整理而成。如有疑問請與您的醫療團隊聯繫。
          </div>
        )}

        {/* Toast */}
        {copyMsg && (
          <div style={{
            position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
            background: '#22313f', color: '#fff', padding: '10px 18px',
            borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 100,
          }}>
            {copyMsg}
          </div>
        )}
      </div>
    </div>
  );
}
