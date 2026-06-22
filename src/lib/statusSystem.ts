// ─────────────────────────────────────────────────────────────────────────────
// Canonical status & badge system — SINGLE SOURCE OF TRUTH.
//
// Every status family the product uses (per UI/UX spec §10) is defined here once
// with its wire value, human label (zh-TW), and badge colors. UI code should
// import BADGE/labels from here instead of re-declaring local color maps, so
// wording, colors, filter labels and sort order stay consistent across the User
// App and CMO Panel.
//
// Wire values intentionally match the existing backend/API strings so this can
// be adopted incrementally without breaking any API contract.
// ─────────────────────────────────────────────────────────────────────────────

export type BadgeMeta = { label: string; bg: string; fg: string }

// ── Priority ─────────────────────────────────────────────────────────────────
export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'none'

// Colors match the established CMO palette so this can back priorityTone()
// without any visual regression.
export const PRIORITY_META: Record<Priority, BadgeMeta & { border: string }> = {
  critical: { label: 'Critical', bg: '#fff1f2', fg: '#be123c', border: '#fecdd3' },
  high:     { label: 'High',     bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  medium:   { label: 'Medium',   bg: '#f0f9ff', fg: '#075985', border: '#bae6fd' },
  low:      { label: 'Low',      bg: '#f8fafc', fg: '#475569', border: '#e2e8f0' },
  none:     { label: 'No action needed', bg: '#ecfdf5', fg: '#047857', border: '#bbf7d0' },
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
export function priorityRank(p: Priority): number { return PRIORITY_RANK[p] ?? 99 }

// Normalize loose/capitalized inputs (e.g. 'Critical', 'High') to a Priority.
export function toPriority(value: string | null | undefined): Priority {
  const v = (value ?? '').toLowerCase()
  if (v === 'critical') return 'critical'
  if (v === 'high') return 'high'
  if (v === 'medium') return 'medium'
  if (v === 'low') return 'low'
  return 'none'
}

// ── Data / record status (§10 Data Status) ──────────────────────────────────
export type DataStatus =
  | 'uploaded' | 'processing' | 'extracted' | 'needs_cmo_review'
  | 'cmo_confirmed' | 'ignored' | 'added_to_summary' | 'published' | 'archived'

export const DATA_STATUS_META: Record<DataStatus, BadgeMeta> = {
  uploaded:         { label: '已上傳',        bg: '#eff6ff', fg: '#1d4ed8' },
  processing:       { label: '整理中',        bg: '#eef2ff', fg: '#4338ca' },
  extracted:        { label: '已擷取',        bg: '#ecfeff', fg: '#0e7490' },
  needs_cmo_review: { label: '待 CMO 審閱',   bg: '#fef3c7', fg: '#a16207' },
  cmo_confirmed:    { label: 'CMO 已確認',    bg: '#ecfdf5', fg: '#047857' },
  ignored:          { label: '已忽略',        bg: '#f8fafc', fg: '#64748b' },
  added_to_summary: { label: '已加入摘要',    bg: '#f0fdf4', fg: '#15803d' },
  published:        { label: '已發布',        bg: '#ecfdf5', fg: '#047857' },
  archived:         { label: '已封存',        bg: '#f8fafc', fg: '#94a3b8' },
}

// ── User-facing status (§10 User Status) ─────────────────────────────────────
export type UserStatus =
  | 'no_action' | 'needs_review' | 'waiting_for_cmo' | 'waiting_for_user'
  | 'follow_up_due' | 'high_priority' | 'resolved'

export const USER_STATUS_META: Record<UserStatus, BadgeMeta> = {
  no_action:        { label: '無需處理',      bg: '#ecfdf5', fg: '#047857' },
  needs_review:     { label: '待檢視',        bg: '#fef3c7', fg: '#a16207' },
  waiting_for_cmo:  { label: '等待 CMO',      bg: '#eff6ff', fg: '#1d4ed8' },
  waiting_for_user: { label: '等待您回覆',    bg: '#fff7ed', fg: '#c2410c' },
  follow_up_due:    { label: '追蹤到期',      bg: '#fef2f2', fg: '#be123c' },
  high_priority:    { label: '高優先',        bg: '#fef2f2', fg: '#be123c' },
  resolved:         { label: '已完成',        bg: '#f8fafc', fg: '#64748b' },
}

// ── Recommendation status (§10 Recommendation Status) ────────────────────────
export type RecommendationStatus =
  | 'draft' | 'needs_review' | 'ready_to_publish' | 'published' | 'updated' | 'withdrawn'

export const RECOMMENDATION_STATUS_META: Record<RecommendationStatus, BadgeMeta> = {
  draft:            { label: 'Draft',           bg: '#f8fafc', fg: '#475569' },
  needs_review:     { label: 'Needs review',    bg: '#fef3c7', fg: '#a16207' },
  ready_to_publish: { label: 'Ready to publish',bg: '#eff6ff', fg: '#1d4ed8' },
  published:        { label: 'Published',       bg: '#ecfdf5', fg: '#047857' },
  updated:          { label: 'Updated',         bg: '#f0f9ff', fg: '#075985' },
  withdrawn:        { label: 'Withdrawn',        bg: '#f8fafc', fg: '#64748b' },
}

// ── Follow-up status (§10 Follow-up Status) ──────────────────────────────────
export type FollowUpStatus =
  | 'open' | 'due_soon' | 'overdue' | 'waiting_for_user' | 'completed' | 'resolved'

export const FOLLOW_UP_STATUS_META: Record<FollowUpStatus, BadgeMeta> = {
  open:             { label: 'Open',           bg: '#eff6ff', fg: '#1d4ed8' },
  due_soon:         { label: 'Due soon',       bg: '#fef3c7', fg: '#a16207' },
  overdue:          { label: 'Overdue',        bg: '#fef2f2', fg: '#be123c' },
  waiting_for_user: { label: 'Waiting for user',bg: '#fff7ed', fg: '#c2410c' },
  completed:        { label: 'Completed',      bg: '#ecfdf5', fg: '#047857' },
  resolved:         { label: 'Resolved',       bg: '#f8fafc', fg: '#64748b' },
}

// ── Data source badges (where a row originated) ──────────────────────────────
// §10 requires clear separation of NHI / User Upload / CMO Note / System
// Extracted sources. Centralized here so source coloring is consistent.
export type DataSource = 'user' | 'system' | 'cmo' | 'nhi' | 'document' | 'neutral'

export const SOURCE_META: Record<DataSource, BadgeMeta> = {
  user:     { label: 'User App',  bg: '#eff6ff', fg: '#1d4ed8' },
  system:   { label: 'System',    bg: '#f5f3ff', fg: '#6d28d9' },
  cmo:      { label: 'CMO',       bg: '#ecfdf5', fg: '#047857' },
  nhi:      { label: 'NHI',       bg: '#f0f9ff', fg: '#075985' },
  document: { label: 'Document',  bg: '#fffbeb', fg: '#b45309' },
  neutral:  { label: '—',         bg: '#f8fafc', fg: '#475569' },
}

export function sourceMeta(source: string | null | undefined): BadgeMeta {
  const s = (source ?? '').toLowerCase()
  if (s.includes('user')) return SOURCE_META.user
  if (s.includes('system') || s.includes('extract')) return SOURCE_META.system
  if (s.includes('cmo')) return SOURCE_META.cmo
  if (s.includes('nhi')) return SOURCE_META.nhi
  if (s.includes('doc')) return SOURCE_META.document
  return SOURCE_META.neutral
}

// Map a free-text review/data status string to a canonical tone (colors only;
// callers keep the original label). One palette for all "status" badges.
export function reviewToneMeta(status: string | null | undefined): { bg: string; fg: string } {
  const s = (status ?? '').toLowerCase()
  if (s.includes('overdue') || s.includes('rejected') || s.includes('failed') || s.includes('critical')) return { bg: '#fef2f2', fg: '#be123c' }
  if (s.includes('needs') || s.includes('waiting') || s.includes('uploaded') || s.includes('queued') || s.includes('unconfirmed')) return { bg: '#fff7ed', fg: '#c2410c' }
  if (s.includes('published') || s.includes('completed') || s.includes('resolved') || s.includes('confirmed') || s.includes('accepted') || s.includes('imported')) return { bg: '#ecfdf5', fg: '#047857' }
  if (s.includes('processing') || s.includes('extracting') || s.includes('review')) return { bg: '#eef2ff', fg: '#4338ca' }
  return { bg: '#f8fafc', fg: '#475569' }
}

// Generic lookup with a safe fallback so unknown wire values never crash the UI.
export function badgeMeta(map: Record<string, BadgeMeta>, value: string | null | undefined): BadgeMeta {
  if (value && map[value]) return map[value]
  return { label: value ?? '—', bg: '#f1f5f9', fg: '#475569' }
}
