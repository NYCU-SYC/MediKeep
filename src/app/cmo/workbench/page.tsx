'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  COHORTS, deriveClinical, enrichAlert, deriveActionItems,
  avgHealthScore, formatRelative, formatDetectedAt, cohortLabel,
  humanizeNextAction, enrichWithMockPov, safeArray,
  type ClinicalPatient, type RiskLevel, type FollowUpStatus,
  type AlertOut, type QueueItem,
} from '@/lib/clinical'
import {
  MOCK_PATIENTS, MOCK_ALERTS, MOCK_PROBLEMS,
  MOCK_SOURCE_DOCS, MOCK_ALLERGIES, MOCK_QUEUE_TYPE,
} from '@/lib/mockClinicalData'
import { type DrawerOrigin } from '@/lib/healthkeepTypes'
import { PRIORITY_META, toPriority } from '@/lib/statusSystem'
import { api } from '@/lib/api'
import { useSync } from '@/lib/sync'
import {
  KpiTile, RiskPill, FollowUpPill, TrendIcon, ScoreBar,
  CohortChip, AlertRow, ActionItemRow, DemoBadge,
} from './_components/atoms'
import { PatientSnapshot } from './_components/snapshot'
import { ClinicalWorklist } from './_components/worklist'

type SortKey = 'risk_desc' | 'health_asc' | 'last_activity' | 'pending_desc' | 'name'

interface Stats {
  overview: {
    total_patients: number
    pending_drafts: number
    pending_change_requests?: number
    unpublished_problems: number
    records_24h: number
    documents_24h: number
    dicom_24h: number
    records_7d: number
    documents_7d: number
    records_change_pct: number
  }
  alerts: AlertOut[]
}

interface QueueEnvelope {
  items: QueueItem[]
  page_info?: {
    page: number
    per_page: number
    total: number
    has_next: boolean
    has_prev: boolean
  }
}

interface CockpitQueueItem {
  id: string
  bucket: string
  patient_id: string
  patient: string
  patient_public_id: string
  target_type: string
  target_id: string | null
  target_label: string
  priority: 'low' | 'medium' | 'high' | string
  source: string
  status: string
  last_updated: string | null
  next_action: string
  patient_visible_effect: string
  review_url: string
}

interface CockpitBucket {
  key: string
  label: string
  count: number
  items: CockpitQueueItem[]
}

interface CockpitSummary {
  all_pending: number
  needs_review: number
  critical_high: number
  new_uploads: number
  need_user_reply: number
  follow_up_due: number
  draft_ready: number
  missing_data: number
  nhi_imports: number
  abnormal_findings: number
  recently_processed: number
}

interface PatientPriorityRow {
  patient_id: string
  patient: string
  patient_public_id: string
  priority: 'Critical' | 'High' | 'Medium' | 'Low' | 'No Action Needed' | string
  priority_score: number
  latest_event: string
  latest_event_type: string
  new_sources: string[]
  abnormal_count: number
  pending_count: number
  need_user_reply: boolean
  missing_data_count: number
  draft_ready_count: number
  follow_up_due: boolean
  last_updated: string | null
  cmo_status: string
  suggested_action: string
  review_url: string
  workspace_url: string
  matched_buckets: string[]
  items: CockpitQueueItem[]
}

interface CockpitPageInfo {
  page: number
  per_page: number
  total: number
  has_next: boolean
  has_prev: boolean
}

interface CockpitEnvelope {
  summary?: CockpitSummary
  patients?: PatientPriorityRow[]
  page_info?: CockpitPageInfo
  buckets: CockpitBucket[]
}

type QueueFilterKey =
  | 'all_pending'
  | 'critical_high'
  | 'new_uploads'
  | 'abnormal_findings'
  | 'need_user_reply'
  | 'follow_up_due'
  | 'draft_ready'
  | 'missing_data'
  | 'nhi_imports'
  | 'recently_processed'

// RISK_OPTION_LABEL / FOLLOW_OPTION_LABEL moved into _components/worklist.tsx
// where the filter UI lives.

const REVIEWED_ALERTS_KEY = 'cmo:reviewed-alerts'

// Patient priority queue fetch page size. The backend caps per_page at 200; the
// queue is risk-sorted so page 1 holds the most urgent rows (fast first paint).
// Remaining pages are loaded in the background and appended, so client-side
// filter / sort / "顯示 N / M 位" keep operating over the full set.
const COCKPIT_PAGE_SIZE = 200

async function fetchJson<T>(url: string): Promise<T> {
  return await api.get(url) as T
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'CMO workbench API request failed.'
}

function unwrapQueue(payload: QueueEnvelope | QueueItem[]): QueueItem[] {
  return Array.isArray(payload) ? payload : safeArray(payload?.items)
}

function loadReviewedAlerts(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(REVIEWED_ALERTS_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch { return new Set() }
}

function persistReviewedAlerts(s: Set<string>) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(REVIEWED_ALERTS_KEY, JSON.stringify(Array.from(s))) } catch { /* ignore */ }
}

function bucketTone(key: string): { bg: string; fg: string; border: string } {
  if (key === 'high_risk' || key === 'red_zone_pending') return { bg: '#fff1f2', fg: '#be123c', border: '#fecdd3' }
  if (key === 'needs_clarification' || key === 'missing_data_requests' || key === 'user_replies') return { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' }
  if (key === 'nhi_imports') return { bg: '#f0f9ff', fg: '#075985', border: '#bae6fd' }
  if (key === 'verified_drafts') return { bg: '#ecfdf5', fg: '#047857', border: '#bbf7d0' }
  return { bg: '#f8fafc', fg: '#475569', border: '#e2e8f0' }
}

function priorityTone(priority: string): { bg: string; fg: string; border: string } {
  // Backed by the canonical PRIORITY_META (single source of truth, statusSystem.ts).
  const meta = PRIORITY_META[toPriority(priority)]
  return { bg: meta.bg, fg: meta.fg, border: meta.border }
}

// group:'action' = needs CMO action today (prominent). group:'reference' =
// situational-awareness counts (NHI updated / Resolved) that should NOT compete
// visually with action items — rendered as a smaller muted row.
const QUEUE_FILTERS: Array<{ key: QueueFilterKey; label: string; short: string; group: 'action' | 'reference' }> = [
  { key: 'all_pending', label: 'All pending', short: 'Pending', group: 'action' },
  { key: 'critical_high', label: 'Critical / High', short: 'High', group: 'action' },
  { key: 'new_uploads', label: 'New uploads', short: 'Uploads', group: 'action' },
  { key: 'abnormal_findings', label: 'Abnormal findings', short: 'Abnormal', group: 'action' },
  { key: 'need_user_reply', label: 'Need reply', short: 'Reply', group: 'action' },
  { key: 'follow_up_due', label: 'Follow-up due', short: 'Due', group: 'action' },
  { key: 'draft_ready', label: 'Draft ready', short: 'Draft', group: 'action' },
  { key: 'missing_data', label: 'Missing data', short: 'Missing', group: 'action' },
  { key: 'nhi_imports', label: 'NHI updated', short: 'NHI', group: 'reference' },
  { key: 'recently_processed', label: 'Resolved', short: 'Resolved', group: 'reference' },
]

function summaryCount(summary: CockpitSummary | null, key: QueueFilterKey) {
  return summary?.[key] ?? 0
}

function patientMatchesFilter(row: PatientPriorityRow, key: QueueFilterKey) {
  if (key === 'all_pending') return row.pending_count > 0
  if (key === 'critical_high') return row.priority === 'Critical' || row.priority === 'High'
  if (key === 'new_uploads') return row.matched_buckets.includes('follow_up_uploads')
  if (key === 'abnormal_findings') return row.abnormal_count > 0
  if (key === 'need_user_reply') return row.need_user_reply || row.matched_buckets.includes('user_replies')
  if (key === 'follow_up_due') return row.follow_up_due || row.matched_buckets.includes('follow_up_due')
  if (key === 'draft_ready') return row.draft_ready_count > 0 || row.matched_buckets.includes('verified_drafts')
  if (key === 'missing_data') return row.missing_data_count > 0 || row.matched_buckets.includes('needs_clarification') || row.matched_buckets.includes('missing_data_requests')
  if (key === 'nhi_imports') return row.matched_buckets.includes('nhi_imports')
  if (key === 'recently_processed') return row.matched_buckets.includes('recently_processed')
  return true
}

function CMOStatsBar({
  summary,
  activeKey,
  onSelect,
}: {
  summary: CockpitSummary | null
  activeKey: QueueFilterKey
  onSelect: (key: QueueFilterKey) => void
}) {
  return (
    <section className="cmo-card cmo-section" style={{ marginTop: 10, padding: 12 }}>
      <div className="cmo-title-row" style={{ marginBottom: 10 }}>
        <div>
          <h2 className="cmo-section-title" style={{ margin: 0 }}>Today&apos;s CMO Work</h2>
          <div className="cmo-subtitle">Click a number to filter the patient-level queue. Counts are patient-first unless the source only exposes work-item totals.</div>
        </div>
      </div>
      {(() => {
        const renderCard = (filter: typeof QUEUE_FILTERS[number], compact: boolean) => {
          const isActive = activeKey === filter.key
          const tone = filter.key === 'critical_high' || filter.key === 'abnormal_findings'
            ? priorityTone('Critical')
            : filter.key === 'missing_data' || filter.key === 'need_user_reply' || filter.key === 'follow_up_due'
              ? bucketTone('needs_clarification')
              : filter.key === 'draft_ready'
                ? bucketTone('verified_drafts')
                : bucketTone(filter.key)
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => onSelect(filter.key)}
              style={{
                textAlign: 'left',
                border: `1px solid ${isActive ? tone.fg : tone.border}`,
                background: isActive ? tone.bg : '#fff',
                borderRadius: 8,
                padding: compact ? '7px 10px' : '10px 11px',
                cursor: 'pointer',
                minHeight: compact ? 54 : 82,
                opacity: compact && !isActive ? 0.92 : 1,
              }}
              aria-pressed={isActive}
            >
              <div style={{ fontSize: compact ? 10 : 11, color: tone.fg, fontWeight: 850 }}>{filter.label}</div>
              <div style={{ fontSize: compact ? 18 : 26, lineHeight: compact ? '22px' : '30px', color: '#0f172a', fontWeight: 900 }}>{summaryCount(summary, filter.key)}</div>
              {!compact && <div className="cmo-subtitle" style={{ fontSize: 10 }}>{filter.short}</div>}
            </button>
          )
        }
        const actionFilters = QUEUE_FILTERS.filter((f) => f.group === 'action')
        const refFilters = QUEUE_FILTERS.filter((f) => f.group === 'reference')
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8 }}>
              {actionFilters.map((f) => renderCard(f, false))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', whiteSpace: 'nowrap' }}>參考數字</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 170px))', gap: 8, flex: 1 }}>
                {refFilters.map((f) => renderCard(f, true))}
              </div>
            </div>
          </>
        )
      })()}
    </section>
  )
}

type BatchActionPayload = {
  action: string
  title?: string
  item?: string
  reason?: string
  instructions?: string
  days?: number
  due_date?: string
  suggested_date?: string
  priority?: string
  notify_patient?: boolean
}

function BatchActionToolbar({
  selectedRows,
  busy,
  onClear,
  onRun,
}: {
  selectedRows: PatientPriorityRow[]
  busy: boolean
  onClear: () => void
  onRun: (payload: BatchActionPayload) => void
}) {
  const [action, setAction] = useState('request_missing_data')
  const [title, setTitle] = useState('請補充最近的報告或檢查資料')
  const [reason, setReason] = useState('CMO 整理資料時發現目前資訊不足，需要補充後才能完成建議。')
  const [instructions, setInstructions] = useState('請到上傳頁補上報告照片或 PDF；如果沒有檔案，也可以用文字說明檢查日期、院所與結果。')
  const [days, setDays] = useState(7)
  const [priority, setPriority] = useState('medium')
  const selectedCount = selectedRows.length
  const hasHighRisk = selectedRows.some((row) => row.priority === 'Critical' || row.priority === 'High' || row.abnormal_count > 0)
  const needsTitle = action === 'request_missing_data'
  const needsItem = action === 'create_follow_up'
  const needsReason = action === 'request_missing_data' || action === 'create_follow_up'
  const disabled = selectedCount === 0 || busy || (needsTitle && !title.trim()) || (needsItem && !title.trim()) || (needsReason && !reason.trim())

  return (
    <section className="cmo-card cmo-section" style={{ marginTop: 10, padding: 12, borderColor: selectedCount > 0 ? '#bae6fd' : '#e2e8f0', background: selectedCount > 0 ? '#f8fafc' : '#fff' }}>
      <div className="cmo-title-row" style={{ marginBottom: 10 }}>
        <div>
          <h2 className="cmo-section-title" style={{ margin: 0 }}>Batch Action Toolbar</h2>
          <div className="cmo-subtitle">{selectedCount} selected. Batch resolve/snooze only touches follow-up and missing-data tasks; high-risk patients are blocked by backend guardrails.</div>
        </div>
        <button type="button" className="cmo-button" disabled={selectedCount === 0 || busy} onClick={onClear}>Clear selection</button>
      </div>
      {hasHighRisk && (
        <div style={{ border: '1px solid #fecdd3', background: '#fff1f2', color: '#991b1b', borderRadius: 8, padding: '8px 10px', fontSize: 12, marginBottom: 10 }}>
          Selection includes Critical/High or abnormal patients. Snooze, resolve, and low-priority actions will be blocked for those patients.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 240px) repeat(auto-fit, minmax(180px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label className="cmo-field">
          <span className="cmo-kpi-label">Action</span>
          <select className="cmo-select" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="request_missing_data">Request missing data</option>
            <option value="create_follow_up">Create follow-up</option>
            <option value="snooze">Snooze operational tasks</option>
            <option value="resolve_operational">Resolve operational tasks</option>
            <option value="set_low_priority">Set operational tasks low priority</option>
          </select>
        </label>
        {(needsTitle || needsItem) && (
          <label className="cmo-field">
            <span className="cmo-kpi-label">{needsItem ? 'Follow-up item' : 'Missing data title'}</span>
            <input className="cmo-input" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
        )}
        {needsReason && (
          <label className="cmo-field">
            <span className="cmo-kpi-label">Reason</span>
            <input className="cmo-input" value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        )}
        {action === 'request_missing_data' && (
          <label className="cmo-field">
            <span className="cmo-kpi-label">User instructions</span>
            <input className="cmo-input" value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          </label>
        )}
        <label className="cmo-field">
          <span className="cmo-kpi-label">Days / due</span>
          <input className="cmo-input" type="number" min={1} max={90} value={days} onChange={(event) => setDays(Number(event.target.value) || 7)} />
        </label>
        <label className="cmo-field">
          <span className="cmo-kpi-label">Priority</span>
          <select className="cmo-select" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <button
          type="button"
          className="cmo-button primary"
          disabled={disabled}
          onClick={() => onRun({
            action,
            title: needsTitle ? title : undefined,
            item: needsItem ? title : undefined,
            reason: needsReason ? reason : undefined,
            instructions: action === 'request_missing_data' ? instructions : undefined,
            days,
            priority,
            notify_patient: true,
          })}
        >
          {busy ? 'Running…' : 'Run audited batch'}
        </button>
      </div>
    </section>
  )
}

function PriorityWorkQueue({
  rows,
  activeKey,
  allRowsCount,
  onOpenUrl,
  onOpenWorkspace,
  selectedIds,
  onToggleSelected,
  onRequestMissing,
  onSnooze,
  onResolve,
}: {
  rows: PatientPriorityRow[]
  activeKey: QueueFilterKey
  allRowsCount: number
  onOpenUrl: (url: string) => void
  onOpenWorkspace: (patientId: string) => void
  selectedIds: Set<string>
  onToggleSelected: (patientId: string) => void
  onRequestMissing: (row: PatientPriorityRow) => void
  onSnooze: (row: PatientPriorityRow) => void
  onResolve: (row: PatientPriorityRow) => void
}) {
  const activeLabel = QUEUE_FILTERS.find((filter) => filter.key === activeKey)?.label ?? 'All pending'
  // Cap rendered rows so the queue stays scannable + fast at mass scale (100s of
  // patients). Risk-sorted, so the most urgent are always in the first page.
  const PAGE = 30
  const [visibleCount, setVisibleCount] = useState(PAGE)
  // Reset is handled by a `key={queueFilter}` at the call site (remounts on
  // filter change) — avoids a setState-in-effect cascade.
  return (
    <section className="cmo-card cmo-section" style={{ marginTop: 10 }}>
      <div className="cmo-title-row" style={{ marginBottom: 10, position: 'sticky', top: 58, background: '#fff', zIndex: 5, paddingTop: 6, paddingBottom: 6 }}>
        <div>
          <h2 className="cmo-section-title" style={{ margin: 0 }}>Priority Work Queue</h2>
          <div className="cmo-subtitle">One row per patient. Expand a row for source-level review items and deep links.</div>
        </div>
        <span className="cmo-badge" style={{ background: '#f1f5f9', color: '#475569' }}>
          {rows.length} / {allRowsCount} patients · {activeLabel}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="cmo-cockpit-empty" style={{ border: '1px dashed #cbd5e1', borderRadius: 8, padding: 16, color: '#64748b', fontSize: 13 }}>
          No patients match this filter. Switch filters or refresh the live queue after the backend sync completes.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.slice(0, visibleCount).map((row) => {
            const tone = priorityTone(row.priority)
            const latestSource = row.new_sources.length ? row.new_sources.join(' · ') : row.latest_event_type
            const selected = selectedIds.has(row.patient_id)
            const hasUnsafeRisk = row.priority === 'Critical' || row.priority === 'High' || row.abnormal_count > 0
            const hasOperationalTasks = row.follow_up_due || row.missing_data_count > 0 || row.matched_buckets.includes('missing_data_requests')
            return (
              <article
                key={row.patient_id}
                className="cmo-card"
                style={{ padding: 12, borderColor: tone.border, background: row.priority === 'Critical' ? '#fffafa' : '#fff' }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b', fontWeight: 800 }}>
                        <input type="checkbox" checked={selected} onChange={() => onToggleSelected(row.patient_id)} />
                        Select
                      </label>
                      <strong style={{ color: '#0f172a', fontSize: 14 }}>{row.patient}</strong>
                      <span className="cmo-badge" style={{ background: tone.bg, color: tone.fg }}>{row.priority}</span>
                    </div>
                    <div className="cmo-subtitle" style={{ fontSize: 11, marginTop: 2 }}>{row.patient_public_id}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <span className="cmo-badge" style={{ background: '#f8fafc', color: '#475569' }}>{row.pending_count} pending</span>
                      {row.abnormal_count > 0 && <span className="cmo-badge" style={{ background: '#fff1f2', color: '#be123c' }}>{row.abnormal_count} abnormal</span>}
                      {row.draft_ready_count > 0 && <span className="cmo-badge" style={{ background: '#ecfdf5', color: '#047857' }}>{row.draft_ready_count} draft ready</span>}
                      {row.missing_data_count > 0 && <span className="cmo-badge" style={{ background: '#fff7ed', color: '#c2410c' }}>{row.missing_data_count} missing</span>}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 850, color: '#0f172a' }}>{row.latest_event}</div>
                    <div className="cmo-subtitle" style={{ fontSize: 11, marginTop: 3 }}>
                      {latestSource} · Updated {formatRelative(row.last_updated)}
                    </div>
                    <div style={{ marginTop: 7, fontSize: 12, color: '#334155' }}>
                      Suggested action: <strong>{row.suggested_action}</strong>
                    </div>
                  </div>
                  <div>
                    <div className="cmo-kpi-label">CMO status</div>
                    <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 800 }}>{row.cmo_status}</div>
                    <div className="cmo-subtitle" style={{ fontSize: 11, marginTop: 4 }}>
                      {row.matched_buckets.slice(0, 3).join(' · ') || 'No active bucket'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 220 }}>
                    <button type="button" className="cmo-button primary" onClick={() => onOpenUrl(row.review_url)}>Review Now</button>
                    <button type="button" className="cmo-button" onClick={() => onOpenWorkspace(row.patient_id)}>Workspace</button>
                    <button type="button" className="cmo-button" onClick={() => onRequestMissing(row)}>Request Missing Data</button>
                    <button
                      type="button"
                      className="cmo-button"
                      disabled={row.draft_ready_count === 0}
                      title={row.draft_ready_count === 0 ? 'No CMO-confirmed draft is ready to publish.' : 'Open publish readiness for preview and confirmation.'}
                      onClick={() => onOpenUrl(`/cmo/patients/${row.patient_id}#publish-readiness`)}
                    >
                      Publish Draft
                    </button>
                    <button type="button" className="cmo-button" disabled={hasUnsafeRisk || !hasOperationalTasks} title={hasUnsafeRisk ? 'High-risk or abnormal rows cannot be snoozed in batch.' : hasOperationalTasks ? 'Snooze eligible follow-up and missing-data tasks.' : 'No follow-up or missing-data task to snooze.'} onClick={() => onSnooze(row)}>Snooze</button>
                    <button type="button" className="cmo-button" disabled={hasUnsafeRisk || !hasOperationalTasks} title={hasUnsafeRisk ? 'High-risk or abnormal rows require item-level review before resolve.' : hasOperationalTasks ? 'Resolve eligible operational tasks only.' : 'No operational task to resolve.'} onClick={() => onResolve(row)}>Mark Resolved</button>
                  </div>
                </div>
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: 'pointer', color: '#0f766e', fontSize: 12, fontWeight: 850 }}>
                    {row.items.length} source item{row.items.length === 1 ? '' : 's'} · open review details
                  </summary>
                  <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                    {row.items.slice(0, 6).map((item, index) => {
                      const itemTone = item.priority === 'high' ? priorityTone('Critical') : item.priority === 'medium' ? priorityTone('Medium') : priorityTone('Low')
                      return (
                        <div
                          key={`${item.id}:${index}`}
                          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}
                        >
                          <div>
                            <strong style={{ fontSize: 12, color: '#0f172a' }}>{item.target_label}</strong>
                            <div className="cmo-subtitle" style={{ fontSize: 11 }}>{item.target_type}{item.target_id ? ` · ${item.target_id}` : ''}</div>
                          </div>
                          <div>
                            <span className="cmo-badge" style={{ background: itemTone.bg, color: itemTone.fg }}>{item.bucket}</span>
                            <div className="cmo-subtitle" style={{ fontSize: 11, marginTop: 3 }}>{item.source} · {item.status}</div>
                          </div>
                          <div style={{ fontSize: 12, color: '#334155' }}>{item.next_action}</div>
                          <button type="button" className="cmo-button" onClick={() => onOpenUrl(item.review_url)}>Open item</button>
                        </div>
                      )
                    })}
                  </div>
                </details>
              </article>
            )
          })}
          {rows.length > visibleCount && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '10px 0' }}>
              <span className="cmo-subtitle">顯示 {visibleCount} / {rows.length} 位（依風險排序，最急者在前）</span>
              <button type="button" className="cmo-button" onClick={() => setVisibleCount((n) => n + PAGE)}>顯示更多</button>
              <button type="button" className="cmo-button" onClick={() => setVisibleCount(rows.length)}>顯示全部</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function CockpitQueues({ buckets, onOpen }: { buckets: CockpitBucket[]; onOpen: (patientId: string) => void }) {
  const [activeKey, setActiveKey] = useState(() => buckets.find((bucket) => bucket.count > 0)?.key ?? 'high_risk')
  const active = buckets.find((bucket) => bucket.key === activeKey) ?? buckets.find((bucket) => bucket.count > 0) ?? buckets[0]
  if (!buckets.length) {
    return (
      <section className="cmo-card cmo-section" style={{ marginTop: 10 }}>
        <div className="cmo-kpi-label">CMO Cockpit Queue</div>
        <div className="cmo-subtitle">Queue buckets are not available from the backend yet. Use the live queue table below or retry after sync.</div>
      </section>
    )
  }
  return (
    <section className="cmo-card cmo-section" style={{ marginTop: 10 }}>
      <div className="cmo-title-row" style={{ marginBottom: 10 }}>
        <div>
          <h2 className="cmo-section-title" style={{ margin: 0 }}>Priority Queue</h2>
          <div className="cmo-subtitle">Start here. Every row shows patient, target, priority, source, current status, next action, and patient-visible effect.</div>
        </div>
        <span className="cmo-badge" style={{ background: '#f1f5f9', color: '#475569' }}>
          {buckets.reduce((sum, bucket) => sum + bucket.count, 0)} work items
        </span>
      </div>
      <div className="cmo-cockpit-buckets" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
        {buckets.map((bucket) => {
          const tone = bucketTone(bucket.key)
          const activeBucket = bucket.key === active?.key
          return (
            <button
              key={bucket.key}
              type="button"
              onClick={() => setActiveKey(bucket.key)}
              className="cmo-cockpit-bucket"
              style={{
                textAlign: 'left',
                border: `1px solid ${activeBucket ? tone.fg : tone.border}`,
                background: activeBucket ? tone.bg : '#fff',
                borderRadius: 8,
                padding: 10,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 11, color: tone.fg, fontWeight: 850 }}>{bucket.label}</div>
              <div style={{ fontSize: 24, color: '#0f172a', fontWeight: 900 }}>{bucket.count}</div>
            </button>
          )
        })}
      </div>
      {!active || active.items.length === 0 ? (
        <div className="cmo-cockpit-empty" style={{ border: '1px dashed #cbd5e1', borderRadius: 8, padding: 16, color: '#64748b', fontSize: 13 }}>
          {active?.label ?? 'This bucket'} 目前沒有待處理項目。若剛完成 QA、補件或發布，請用上方 Refresh live queue 重新抓後端狀態。
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="cmo-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Target</th>
                <th>Priority</th>
                <th>Source</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Next action</th>
                <th>Patient effect</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.items.map((item, index) => {
                const tone = item.priority === 'high' ? bucketTone('high_risk') : item.priority === 'medium' ? bucketTone('needs_clarification') : bucketTone('recently_processed')
                return (
                  <tr key={`${item.id}:${index}`}>
                    <td>
                      <strong style={{ color: '#0f172a' }}>{item.patient}</strong>
                      <div className="cmo-subtitle" style={{ fontSize: 11 }}>{item.patient_public_id}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: '#0f172a', fontWeight: 800 }}>{item.target_label}</div>
                      <div className="cmo-subtitle" style={{ fontSize: 11 }}>{item.target_type}{item.target_id ? ` · ${item.target_id}` : ''}</div>
                    </td>
                    <td><span className="cmo-badge" style={{ background: tone.bg, color: tone.fg }}>{item.priority}</span></td>
                    <td style={{ fontSize: 12 }}>{item.source}</td>
                    <td style={{ fontSize: 12 }}>{item.status}</td>
                    <td style={{ fontSize: 12 }}>{formatRelative(item.last_updated)}</td>
                    <td style={{ fontSize: 12, color: '#0f172a' }}>{item.next_action}</td>
                    <td style={{ fontSize: 12, color: '#475569' }}>{item.patient_visible_effect}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="cmo-button primary" onClick={() => onOpen(item.patient_id)}>Open review</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function WorkbenchPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [stats, setStats] = useState<Stats | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [cockpitSummary, setCockpitSummary] = useState<CockpitSummary | null>(null)
  const [patientQueueRows, setPatientQueueRows] = useState<PatientPriorityRow[]>([])
  const [cockpitBuckets, setCockpitBuckets] = useState<CockpitBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showDemo, setShowDemo] = useState(false)

  // ── URL-backed state ───────────────────────────────────────────────
  // Patient drawer + filters live in the URL so:
  //   - Browser back / forward works as a back-trail through clicks
  //   - Refresh keeps the user in the same view
  //   - Workbench URL is shareable / linkable
  const initialPatientId = searchParams.get('patient') ?? null
  const initialOrigin = (searchParams.get('from') as DrawerOrigin) ?? 'url'
  const initialOriginContext = searchParams.get('ctx') ?? undefined

  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [riskFilter, setRiskFilter] = useState<'all' | RiskLevel>(() => (searchParams.get('risk') as 'all' | RiskLevel) || 'all')
  const [cohortFilter, setCohortFilter] = useState<string>(() => searchParams.get('cohort') ?? '')
  const [followFilter, setFollowFilter] = useState<'all' | FollowUpStatus>(() => (searchParams.get('follow') as 'all' | FollowUpStatus) || 'all')
  const [sortKey, setSortKey] = useState<SortKey>(() => (searchParams.get('sort') as SortKey) || 'risk_desc')
  const [queueFilter, setQueueFilter] = useState<QueueFilterKey>(() => (searchParams.get('queue') as QueueFilterKey) || 'all_pending')
  const [drawerPatientId, setDrawerPatientId] = useState<string | null>(initialPatientId)
  const [drawerOrigin, setDrawerOrigin] = useState<DrawerOrigin>(initialOrigin)
  const [drawerOriginContext, setDrawerOriginContext] = useState<string | undefined>(initialOriginContext)
  const [reviewedAlerts, setReviewedAlerts] = useState<Set<string>>(() => loadReviewedAlerts())
  const [selectedPatientIds, setSelectedPatientIds] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchNotice, setBatchNotice] = useState('')

  // Sync filters + drawer to URL (replace, not push — no history bloat).
  // Only run on changes after mount.
  const syncUrl = useCallback((extra?: { patient?: string | null; from?: DrawerOrigin; ctx?: string }) => {
    const next = new URLSearchParams()
    if (search.trim()) next.set('q', search.trim())
    if (riskFilter !== 'all') next.set('risk', riskFilter)
    if (followFilter !== 'all') next.set('follow', followFilter)
    if (cohortFilter) next.set('cohort', cohortFilter)
    if (sortKey !== 'risk_desc') next.set('sort', sortKey)
    if (queueFilter !== 'all_pending') next.set('queue', queueFilter)
    const pid = extra && 'patient' in extra ? extra.patient : drawerPatientId
    if (pid) next.set('patient', pid)
    const from = extra?.from ?? drawerOrigin
    if (pid && from && from !== 'url') next.set('from', from)
    const ctx = extra?.ctx ?? drawerOriginContext
    if (pid && ctx) next.set('ctx', ctx)
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }, [router, search, riskFilter, followFilter, cohortFilter, sortKey, queueFilter, drawerPatientId, drawerOrigin, drawerOriginContext])

  // Push filter changes to URL whenever they change (after mount)
  const filterDeps = [search, riskFilter, followFilter, cohortFilter, sortKey, queueFilter]
  useEffect(() => { syncUrl() }, filterDeps) // eslint-disable-line react-hooks/exhaustive-deps

  const worklistRef = useRef<HTMLElement | null>(null)
  const pageStartTs = useMemo(() => new Date().toISOString(), [])

  const sync = useSync()

  // Bumped on every load so a stale background page-fetch can detect it has been
  // superseded (e.g. by a sync-triggered refresh) and stop appending rows.
  const cockpitReqId = useRef(0)

  const loadWorkbench = useCallback(async () => {
    const reqId = ++cockpitReqId.current
    setLoading(true)
    setLoadError('')
    let firstPageLoaded = false
    try {
      const [nextStats, nextQueue, firstCockpit] = await Promise.all([
        fetchJson<Stats | null>('/api/cmo/workbench/stats'),
        fetchJson<QueueEnvelope | QueueItem[]>('/api/cmo/workbench/queue'),
        fetchJson<CockpitEnvelope>(`/api/cmo/workbench/queues?page=1&per_page=${COCKPIT_PAGE_SIZE}`),
      ])
      if (cockpitReqId.current !== reqId) return // superseded by a newer load
      setStats(nextStats)
      setQueue(unwrapQueue(nextQueue))
      setCockpitSummary(firstCockpit.summary ?? null)
      setPatientQueueRows(safeArray(firstCockpit.patients))
      setCockpitBuckets(firstCockpit.buckets)
      firstPageLoaded = true
      setLoading(false) // page 1 is enough to paint; remaining pages stream in

      // Background-load any remaining pages and append, so client-side filter /
      // sort / "顯示 N / M 位" keep operating over the full risk-sorted queue.
      // (≤ COCKPIT_PAGE_SIZE patients → single page, no extra calls.)
      let info = firstCockpit.page_info
      let nextPage = (info?.page ?? 1) + 1
      while (info?.has_next && cockpitReqId.current === reqId) {
        const more = await fetchJson<CockpitEnvelope>(
          `/api/cmo/workbench/queues?page=${nextPage}&per_page=${COCKPIT_PAGE_SIZE}`,
        )
        if (cockpitReqId.current !== reqId) return
        setPatientQueueRows((prev) => [...prev, ...safeArray(more.patients)])
        info = more.page_info
        nextPage += 1
      }
    } catch (error) {
      if (cockpitReqId.current !== reqId) return
      if (!firstPageLoaded) {
        setStats(null)
        setQueue([])
        setCockpitSummary(null)
        setPatientQueueRows([])
        setCockpitBuckets([])
        setLoadError(errorMessage(error))
        setLoading(false)
      }
      // A later page failing leaves the rows already loaded in place (usable).
    }
  }, [])

  useEffect(() => { loadWorkbench() }, [loadWorkbench])

  // Cross-view sync: a patient request / withdrawal / reply elsewhere advances
  // the workbench cursor, and the queue + KPIs refetch automatically.
  useEffect(() => {
    if (sync.version > 0) loadWorkbench()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.viewVersions.cmo_workbench, sync.version])

  // ── Derived clinical data ─────────────────────────────────────────────────
  const realPatients = useMemo(() => safeArray(queue).map(deriveClinical), [queue])
  const demoPatients = useMemo(() => MOCK_PATIENTS
    .map(deriveClinical)
    .map((p) => enrichWithMockPov(p, {
      problems: MOCK_PROBLEMS, sourceDocs: MOCK_SOURCE_DOCS,
      allergies: MOCK_ALLERGIES, queueCategory: MOCK_QUEUE_TYPE,
    })), [])
  const patients = showDemo ? demoPatients : realPatients
  const mergedAlerts = useMemo(
    () => showDemo ? [...safeArray<AlertOut>(stats?.alerts), ...MOCK_ALERTS] : safeArray<AlertOut>(stats?.alerts),
    [showDemo, stats],
  )
  const enrichedAlerts = useMemo(() => mergedAlerts.map(enrichAlert), [mergedAlerts])
  const actionItems = useMemo(() => deriveActionItems(patients), [patients])
  const demoCount = useMemo(() => demoPatients.length, [demoPatients])
  const realCount = realPatients.length
  // Patients with NHI 健康存摺 imported drafts — surfaced separately even
  // when all drafts are accepted, so CMO can navigate back to the
  // 10-section NHI viewer at any time.
  const nhiPatients = useMemo(
    () => patients
      .filter((p) => (p.nhi_drafts_count ?? 0) > 0)
      .sort((a, b) => (b.nhi_drafts_count ?? 0) - (a.nhi_drafts_count ?? 0)),
    [patients],
  )

  // Resolved drawer patient from URL-backed id
  const drawerPatient = useMemo(
    () => drawerPatientId ? (patients.find((p) => p.user_id === drawerPatientId) ?? null) : null,
    [drawerPatientId, patients],
  )

  // Drawer open / close helpers that also sync URL
  const openDrawer = useCallback((patient: ClinicalPatient, origin: DrawerOrigin, ctx?: string) => {
    setDrawerPatientId(patient.user_id)
    setDrawerOrigin(origin)
    setDrawerOriginContext(ctx)
    syncUrl({ patient: patient.user_id, from: origin, ctx })
  }, [syncUrl])
  const closeDrawer = useCallback(() => {
    setDrawerPatientId(null)
    setDrawerOriginContext(undefined)
    syncUrl({ patient: null })
  }, [syncUrl])

  // ── KPI ──────────────────────────────────────────────────────────────────
  // Ordered by CMO Intake Console Spec §3 — queue / intake KPIs FIRST
  // (CMO workflow), risk-stratification KPIs SECOND.
  const kpis = useMemo(() => {
    // Spec queue counts (intake-centric)
    const byQueue = (cat: string) => patients.filter((p) => p.queueCategory === cat).length
    const pendingIntake     = byQueue('ocr_pending') + byQueue('new_patient')
    const awaitingReview    = byQueue('awaiting_review') + byQueue('nhi_review')
    const userChangeRequests = patients.reduce((sum, p) => sum + (p.pending_change_requests ?? p.change_request_count ?? 0), 0) || (stats?.overview.pending_change_requests ?? 0)
    const ocrPending        = byQueue('ocr_pending')
    const readyToPublish    = byQueue('awaiting_publish')
    // Risk / care-gap KPIs
    const highRisk      = patients.filter((p) => p.riskLevel === 'critical' || p.riskLevel === 'high').length
    const critical      = patients.filter((p) => p.riskLevel === 'critical').length
    const worsening     = patients.filter((p) => p.trend === 'worsening').length
    const criticalAlerts = enrichedAlerts.filter((a) => a.severity === 'critical' && !reviewedAlerts.has(`${a.user_id}-${a.category}`)).length
    const overdue       = patients.filter((p) => p.followUpStatus === 'overdue').length
    const dueSoon       = patients.filter((p) => p.followUpStatus === 'due_soon').length
    const avgHealth     = avgHealthScore(patients)
    const pendingActions = actionItems.length
    const totalPatients = stats?.overview.total_patients ?? patients.length
    return {
      pendingIntake, awaitingReview, ocrPending, readyToPublish,
      userChangeRequests,
      totalPatients, highRisk, critical, worsening,
      criticalAlerts, overdue, dueSoon, avgHealth, pendingActions,
    }
  }, [patients, enrichedAlerts, actionItems, stats, reviewedAlerts])

  // ── Cohort summary ───────────────────────────────────────────────────────
  const cohortSummary = useMemo(() => {
    return COHORTS.map((c) => {
      const inCohort = patients.filter((p) => p.cohorts.includes(c.id))
      const highRisk = inCohort.filter((p) => p.riskLevel === 'critical' || p.riskLevel === 'high').length
      return { id: c.id, label: c.label, en: c.en, total: inCohort.length, highRisk }
    }).filter((c) => c.total > 0)
  }, [patients])

  // ── Top priority (max 8, critical+high, sorted by risk score) ────────────
  const topPriority = useMemo(() => {
    return [...patients]
      .filter((p) => p.riskLevel === 'critical' || p.riskLevel === 'high')
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 8)
  }, [patients])

  // ── Filtered & sorted worklist ───────────────────────────────────────────
  const worklist = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = patients.filter((p) => {
      if (riskFilter !== 'all' && p.riskLevel !== riskFilter) return false
      if (followFilter !== 'all' && p.followUpStatus !== followFilter) return false
      if (cohortFilter && !p.cohorts.includes(cohortFilter)) return false
      if (term) {
        const hay = [p.display_name, p.user_id, p.primaryFinding, p.next_action].join(' ').toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
    return [...filtered].sort((a, b) => {
      if (sortKey === 'health_asc') return a.healthScore - b.healthScore
      if (sortKey === 'pending_desc') return b.pending_drafts - a.pending_drafts
      if (sortKey === 'last_activity') return new Date(b.last_activity ?? 0).getTime() - new Date(a.last_activity ?? 0).getTime()
      if (sortKey === 'name') return a.display_name.localeCompare(b.display_name, 'zh-Hant')
      return b.riskScore - a.riskScore
    })
  }, [patients, search, riskFilter, followFilter, cohortFilter, sortKey])

  const filteredPatientQueueRows = useMemo(() => {
    if (showDemo) return []
    return patientQueueRows.filter((row) => patientMatchesFilter(row, queueFilter))
  }, [patientQueueRows, queueFilter, showDemo])
  const selectedPatientRows = useMemo(() => patientQueueRows.filter((row) => selectedPatientIds.has(row.patient_id)), [patientQueueRows, selectedPatientIds])

  const hasActiveFilter = search.trim().length > 0 || riskFilter !== 'all' || followFilter !== 'all' || cohortFilter !== ''
  const clearAllFilters = () => { setSearch(''); setRiskFilter('all'); setFollowFilter('all'); setCohortFilter('') }
  const toggleSelectedPatient = (patientId: string) => {
    setSelectedPatientIds((prev) => {
      const next = new Set(prev)
      if (next.has(patientId)) next.delete(patientId)
      else next.add(patientId)
      return next
    })
  }
  const runBatchAction = async (payload: BatchActionPayload, patientIds?: string[]) => {
    const ids = patientIds ?? Array.from(selectedPatientIds)
    if (ids.length === 0) return
    setBatchBusy(true)
    setBatchNotice('')
    try {
      const result = await api.post('/api/cmo/workbench/batch-actions', { ...payload, patient_ids: ids }) as {
        updated?: unknown[]
        blocked_high_risk_patients?: string[]
        skipped?: unknown[]
      }
      const blocked = result.blocked_high_risk_patients?.length ?? 0
      const skipped = result.skipped?.length ?? 0
      setBatchNotice(`Batch completed: ${result.updated?.length ?? 0} patient rows touched${blocked ? ` · ${blocked} blocked by high-risk guardrail` : ''}${skipped ? ` · ${skipped} skipped pending CMO review` : ''}.`)
      await loadWorkbench()
      if (!patientIds) setSelectedPatientIds(new Set())
    } catch (error) {
      setBatchNotice(error instanceof Error ? error.message : 'Batch action failed.')
    } finally {
      setBatchBusy(false)
    }
  }
  const requestMissingForRow = (row: PatientPriorityRow) => {
    const title = window.prompt('需要使用者補什麼資料？', row.latest_event || '請補充最近的報告或檢查資料')
    if (!title?.trim()) return
    const reason = window.prompt('為什麼需要這份資料？', row.suggested_action || 'CMO 整理資料時發現目前資訊不足，需要補充後才能完成建議。')
    if (!reason?.trim()) return
    void runBatchAction({
      action: 'request_missing_data',
      title: title.trim(),
      reason: reason.trim(),
      instructions: '請到上傳頁補上報告照片或 PDF；如果沒有檔案，也可以用文字說明檢查日期、院所與結果。',
      priority: row.priority === 'Critical' || row.priority === 'High' ? 'high' : 'medium',
      notify_patient: true,
    }, [row.patient_id])
  }
  const snoozeRow = (row: PatientPriorityRow) => {
    void runBatchAction({ action: 'snooze', days: 7 }, [row.patient_id])
  }
  const resolveRow = (row: PatientPriorityRow) => {
    const ok = window.confirm(`Resolve eligible follow-up/missing-data tasks for ${row.patient}? High-risk, user-response, and publish items will remain untouched.`)
    if (!ok) return
    void runBatchAction({ action: 'resolve_operational' }, [row.patient_id])
  }

  const markAlertReviewed = (id: string) => {
    setReviewedAlerts((prev) => {
      const next = new Set(prev); next.add(id); persistReviewedAlerts(next); return next
    })
  }
  const handleCohortClick = (cohortId: string) => {
    setCohortFilter(cohortFilter === cohortId ? '' : cohortId)
    // Scroll to worklist so user sees the filter effect
    window.setTimeout(() => {
      worklistRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="cmo-page">
        <div className="cmo-card cmo-section">
          <div className="cmo-kpi-label">CMO Command Center</div>
          <div className="cmo-title" style={{ marginTop: 8 }}>Loading clinical dashboard…</div>
          <div className="cmo-subtitle">Preparing risk stratification, alerts, and action items.</div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="cmo-page">
        <div className="cmo-card cmo-section" style={{ textAlign: 'center', padding: 40, borderColor: '#fecdd3', background: '#fff1f2' }}>
          <div className="cmo-kpi-label" style={{ color: '#be123c' }}>CMO Command Center</div>
          <h1 className="cmo-title" style={{ marginTop: 8 }}>Workbench data failed to load</h1>
          <div className="cmo-subtitle" style={{ maxWidth: 620, margin: '10px auto 0', color: '#7f1d1d' }}>
            The queue is not empty; the backend request failed. Do not treat this as no CMO work.
          </div>
          <div className="cmo-card" style={{ marginTop: 14, padding: 12, textAlign: 'left', color: '#7f1d1d', background: '#fff', borderColor: '#fecdd3', wordBreak: 'break-word' }}>
            {loadError}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
            <button type="button" className="cmo-button primary" onClick={loadWorkbench}>Retry live queue</button>
            <button type="button" className="cmo-button" onClick={() => { setShowDemo(true); setLoadError('') }}>Open Demo Cohort</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Empty state for entire dashboard ─────────────────────────────────────
  if (patients.length === 0 && patientQueueRows.length === 0) {
    return (
      <div className="cmo-page">
        <div className="cmo-card cmo-section" style={{ textAlign: 'center', padding: 40 }}>
          <div className="cmo-kpi-label">CMO Command Center</div>
          <h1 className="cmo-title" style={{ marginTop: 8 }}>No patients in the active queue</h1>
          <div className="cmo-subtitle">Once patients are uploaded or linked, risk stratification will appear here.</div>
          <button
            type="button"
            onClick={() => setShowDemo(true)}
            style={{
              marginTop: 18,
              border: '1px solid #0f766e',
              background: '#ecfdf5',
              color: '#0f766e',
              borderRadius: 6,
              padding: '8px 12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Open Demo Cohort
          </button>
        </div>
      </div>
    )
  }

  const today = new Date()

  return (
    <div className="cmo-page">
      {/* Header */}
      <header className="cmo-title-row">
        <div>
          <h1 className="cmo-title">CMO Command Center</h1>
          <div className="cmo-subtitle">
            {today.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
            {' · '}For clinician review · Last loaded {formatRelative(pageStartTs)}
          </div>
        </div>
      </header>

      <div className="cmo-card cmo-mode-toggle" style={{ padding: 8, marginTop: 10, display: 'inline-flex', gap: 6, alignItems: 'center', background: '#fff' }}>
        {[
          { label: '正式 Queue', value: false, note: `${realCount} queue patients` },
          { label: 'Demo Cohort', value: true, note: `${demoCount} demo rows` },
        ].map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setShowDemo(tab.value)}
            style={{
              border: '1px solid',
              borderColor: showDemo === tab.value ? '#0f766e' : '#e5e7eb',
              background: showDemo === tab.value ? '#ecfdf5' : '#fff',
              color: showDemo === tab.value ? '#0f766e' : '#475569',
              borderRadius: 6,
              padding: '8px 12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
            title={tab.note}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showDemo && demoCount > 0 && (
        <div className="cmo-card" style={{ padding: '10px 14px', marginTop: 10, background: '#f5f3ff', borderColor: '#ddd6fe', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 8px', borderRadius: 4, background: '#ede9fe', color: '#5b21b6', fontSize: 11, fontWeight: 800 }}>DEMO COHORT</span>
          <span style={{ fontSize: 13, color: '#4c1d95' }}>
            Demo rows are isolated from the real CMO work queue. Demo data is not persisted and snapshot navigation to chart is disabled.
          </span>
        </div>
      )}

      {!showDemo && (
        <CMOStatsBar
          summary={cockpitSummary}
          activeKey={queueFilter}
          onSelect={setQueueFilter}
        />
      )}

      {showDemo ? (
        <section className="cmo-card cmo-section" style={{ marginTop: 10 }}>
          <div className="cmo-kpi-label">Priority Work Queue</div>
          <h2 className="cmo-section-title" style={{ margin: '4px 0 0' }}>Live queue hidden in Demo Cohort</h2>
          <div className="cmo-subtitle">
            Patient-level triage is connected to the real CMO API. Demo patients remain in the secondary worklist below so test data never looks publishable.
          </div>
        </section>
      ) : patientQueueRows.length > 0 ? (
        <>
          <BatchActionToolbar
            selectedRows={selectedPatientRows}
            busy={batchBusy}
            onClear={() => setSelectedPatientIds(new Set())}
            onRun={(payload) => runBatchAction(payload)}
          />
          {batchNotice && (
            <div className="cmo-card" style={{ marginTop: 8, padding: '8px 10px', background: '#f8fafc', color: '#334155', fontSize: 12 }}>
              {batchNotice}
            </div>
          )}
          <PriorityWorkQueue
            key={queueFilter}
            rows={filteredPatientQueueRows}
            activeKey={queueFilter}
            allRowsCount={patientQueueRows.length}
            onOpenUrl={(url) => router.push(url)}
            onOpenWorkspace={(patientId) => router.push(`/cmo/patients/${patientId}`)}
            selectedIds={selectedPatientIds}
            onToggleSelected={toggleSelectedPatient}
            onRequestMissing={requestMissingForRow}
            onSnooze={snoozeRow}
            onResolve={resolveRow}
          />
        </>
      ) : (
        <CockpitQueues buckets={cockpitBuckets} onOpen={(patientId) => router.push(`/cmo/patients/${patientId}`)} />
      )}

      <div className="cmo-card cmo-operator-strip" style={{
        display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px',
        marginTop: 10, marginBottom: 12, flexWrap: 'wrap',
      }}>
        <span className="cmo-kpi-label">Queue controls</span>
        <button type="button" className="cmo-button primary" onClick={loadWorkbench}>Refresh live queue</button>
        <span className="cmo-subtitle" style={{ fontSize: 12 }}>
          Review flow: Priority Queue → Patient Workspace → Preview / Publish → Audit.
        </span>
        <span className="cmo-operator-meta" style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 11 }}>
          Total {kpis.totalPatients} patient{kpis.totalPatients > 1 ? 's' : ''} · Avg health {kpis.avgHealth}/100
        </span>
      </div>

      <details className="cmo-command-secondary">
        <summary>
          Secondary analytics, cohorts, and legacy worklist
          <span>{worklist.length} filtered rows · {enrichedAlerts.length - reviewedAlerts.size} unreviewed alerts</span>
        </summary>
        <div className="cmo-command-secondary-body">

      {/* ── NHI Health Passbook quick access ──────────────────────────
          Lists patients with imported 健康存摺 drafts (any status).
          After triage these patients drop out of the regular queue but
          CMO still needs to reach the 10-section NHI viewer from here. */}
      {nhiPatients.length > 0 && (
        <section className="cmo-card cmo-section" style={{ marginTop: 10, padding: 14, background: '#f0f9ff', borderColor: '#bae6fd' }}>
          <div className="cmo-title-row" style={{ marginBottom: 8 }}>
            <div>
              <div className="cmo-kpi-label" style={{ color: '#075985' }}>NHI 健康存摺 patients · Quick access</div>
              <div className="cmo-subtitle" style={{ fontSize: 12 }}>
                These patients have imported NHI health passbook data with the 10-section viewer. Counts include accepted and rejected drafts (not just pending).
              </div>
            </div>
            <span className="cmo-badge" style={{ background: '#e0f2fe', color: '#075985' }}>
              {nhiPatients.length} patient{nhiPatients.length > 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {nhiPatients.map((p) => (
              <div key={p.user_id} className="cmo-card" style={{
                padding: '10px 12px', minWidth: 240, display: 'flex',
                flexDirection: 'column', gap: 4, background: '#fff', borderColor: '#bae6fd',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <strong style={{ color: '#0f172a', fontSize: 13 }}>{p.display_name}</strong>
                  <span className="cmo-badge" style={{ background: '#e0f2fe', color: '#075985', fontSize: 10 }}>
                    {p.nhi_drafts_count} drafts
                  </span>
                </div>
                <div className="cmo-subtitle" style={{ fontSize: 11 }}>
                  Last activity: {formatRelative(p.last_activity)}
              {p.pending_drafts > 0 && <> · <strong style={{ color: '#a16207' }}>{p.pending_drafts} pending review</strong></>}
              {(p.merged_count ?? 1) > 1 && <> · merged {(p.merged_count ?? 1) - 1} duplicate rows</>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <Link className="cmo-button primary" href={`/cmo/patients/${p.user_id}/nhi`} style={{ flex: 1, minHeight: 30, padding: '4px 8px', fontSize: 12 }}>
                    Open 10-section viewer
                  </Link>
                  <Link className="cmo-button" href={`/cmo/patients/${p.user_id}`} style={{ minHeight: 30, padding: '4px 10px', fontSize: 12 }}>
                    Chart
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── KPI Overview — Queue-first per CMO Intake Console Spec §3 ───── */}
      {/* Row 1: 今天的工作 (intake / review / publish queues) */}
      <section className="cmo-kpi-grid" aria-label="CMO queue KPI">
        <KpiTile tone="attention" label="Pending intake"
          value={kpis.pendingIntake}
          delta={kpis.ocrPending > 0 ? `${kpis.ocrPending} OCR 待確認` : undefined}
          deltaTone="flat"
          note="新客戶 + OCR 待 CMO 結構化" />
        <KpiTile tone="attention" label="Awaiting CMO review"
          value={kpis.awaitingReview}
          note="NHI 複核 + Draft 待 accept/reject" />
        <KpiTile tone="attention" label="User change requests"
          value={kpis.userChangeRequests}
          note="User self-reports and edits awaiting CMO action" />
        <KpiTile tone="info"      label="Ready to publish"
          value={kpis.readyToPublish}
          note="Verified problems pending publish gate" />
        <KpiTile tone="critical"  label="Critical alerts"
          value={kpis.criticalAlerts}
          delta={enrichedAlerts.length > kpis.criticalAlerts ? `${enrichedAlerts.length - kpis.criticalAlerts} reviewed` : undefined}
          deltaTone="flat"
          note="Unreviewed · Requires physician confirmation" />
        <KpiTile tone="critical"  label="High-risk patients"
          value={kpis.highRisk}
          delta={`${kpis.critical} critical`} deltaTone={kpis.critical > 0 ? 'up' : 'flat'}
          note="Tier 1 + high-risk pending review" />
        <KpiTile tone="attention" label="Overdue follow-up"
          value={kpis.overdue}
          delta={`${kpis.dueSoon} due soon`} deltaTone={kpis.dueSoon > 0 ? 'up' : 'flat'}
          note="No activity > 90 days" />
      </section>

      {/* Quick-actions strip — explicit entry points to the three stages */}
      <div className="cmo-card cmo-operator-strip" style={{
        display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px',
        marginBottom: 12, flexWrap: 'wrap',
      }}>
        <span className="cmo-kpi-label">Quick actions</span>
        <button type="button" className="cmo-button primary" onClick={loadWorkbench}>Refresh live queue</button>
        <span style={{ color: '#94a3b8' }}>·</span>
        <span className="cmo-subtitle" style={{ fontSize: 12 }}>
          Workflow: queue triage here · open a row for patient review · publish only from patient chart after QA.
        </span>
        <span className="cmo-operator-meta" style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 11 }}>
          Total {kpis.totalPatients} patient{kpis.totalPatients > 1 ? 's' : ''} · Avg health {kpis.avgHealth}/100
        </span>
      </div>

      {/* ── Top Priority + Alert Center ─────────────────────────────────── */}
      <section className="cmo-grid-2" style={{ marginTop: 14 }}>
        <div className="cmo-card cmo-section">
          <div className="cmo-title-row" style={{ marginBottom: 10 }}>
            <div>
              <h2 className="cmo-section-title" style={{ margin: 0 }}>Top priority patients</h2>
              <div className="cmo-subtitle">Sorted by risk score · Click any row for a 30-sec snapshot</div>
            </div>
            <span className="cmo-badge" style={{ background: '#fee2e2', color: '#991b1b' }}>{topPriority.length} flagged</span>
          </div>
          {topPriority.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
              No high-risk patients flagged at this time. Routine review recommended.
            </div>
          ) : (
            <div style={{ overflow: 'auto' }}>
              <table className="priority-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Risk</th>
                    <th>Score</th>
                    <th>Primary finding</th>
                    <th>Cohort</th>
                    <th>Follow-up</th>
                    <th>Trend</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {topPriority.map((p) => (
                    <tr key={p.user_id}
                      className={drawerPatientId === p.user_id ? 'is-selected' : ''}
                      onClick={() => openDrawer(p, 'priority')} title="Click for snapshot">
                      <td>
                        <strong style={{ color: '#0f172a' }}>{p.display_name}</strong>
                        {p.isDemoData && <DemoBadge />}
                        <div className="cmo-subtitle" style={{ marginTop: 1, fontSize: 11 }}>{p.ageSex} · {p.user_id.slice(0, 8)}</div>
                      </td>
                      <td><RiskPill level={p.riskLevel} /></td>
                      <td><ScoreBar score={p.riskScore} level={p.riskLevel} /></td>
                      <td>
                        <div style={{ fontSize: 12, color: '#0f172a' }}>{p.primaryFinding}</div>
                        <div className="cmo-subtitle" style={{ fontSize: 11 }}>{humanizeNextAction(p.next_action)}</div>
                      </td>
                      <td style={{ fontSize: 11 }}>{p.cohorts.slice(0, 2).map(cohortLabel).join(' · ') || '—'}</td>
                      <td><FollowUpPill status={p.followUpStatus} /></td>
                      <td><TrendIcon trend={p.trend} /></td>
                      <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <button className="cmo-button primary" type="button" onClick={() => openDrawer(p, 'priority')}>Review</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="cmo-card cmo-section">
          <div className="cmo-title-row" style={{ marginBottom: 10 }}>
            <div>
              <h2 className="cmo-section-title" style={{ margin: 0 }}>Clinical alert center</h2>
              <div className="cmo-subtitle">Abnormal findings · Care gaps · Missing data</div>
            </div>
            <span className="cmo-badge" style={{ background: '#fef3c7', color: '#a16207' }}>
              {enrichedAlerts.length - reviewedAlerts.size} unreviewed / {enrichedAlerts.length} total
            </span>
          </div>
          {enrichedAlerts.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
              No active alerts. Continue routine surveillance.
            </div>
          ) : (
            <div className="cmo-list">
              {enrichedAlerts.slice(0, 6).map((a, i) => {
                const p = patients.find((x) => x.user_id === a.user_id)
                const alertId = `${a.user_id}-${a.category}`
                // Alert backend does not yet expose a detected_at timestamp;
                // formatDetectedAt(null) renders "Recent · time not recorded".
                return (
                  <AlertRow key={`${alertId}-${i}`} alert={a}
                    detectedAtLabel={formatDetectedAt(null)}
                    reviewed={reviewedAlerts.has(alertId)}
                    onOpen={() => p && openDrawer(p, 'alert', a.itemLabel)}
                    onMarkReviewed={() => markAlertReviewed(alertId)} />
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Cohort Strip ────────────────────────────────────────────────── */}
      <section style={{ marginTop: 14 }}>
        <div className="cmo-title-row" style={{ marginBottom: 8 }}>
          <h2 className="cmo-section-title" style={{ margin: 0, fontSize: 14 }}>
            Cohort management
            <span className="cmo-subtitle" style={{ marginLeft: 8, fontWeight: 500 }}>Click a cohort to filter the worklist below</span>
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0' }}>
          {cohortSummary.length === 0 ? (
            <div className="cmo-subtitle">尚未偵測到具規模的慢性病或風險族群。Cohort tagging requires more linked problem data.</div>
          ) : cohortSummary.map((c) => (
            <CohortChip key={c.id} label={c.label}
              total={c.total} highRisk={c.highRisk}
              active={cohortFilter === c.id}
              onClick={() => handleCohortClick(c.id)} />
          ))}
        </div>
      </section>

      <div ref={worklistRef as React.RefObject<HTMLDivElement>}>
        <ClinicalWorklist
          worklist={worklist} totalPatients={patients.length}
          selectedPatientId={drawerPatientId}
          search={search} riskFilter={riskFilter} followFilter={followFilter}
          cohortFilter={cohortFilter} sortKey={sortKey} hasActiveFilter={hasActiveFilter}
          onSearchChange={setSearch} onRiskChange={setRiskFilter}
          onFollowChange={setFollowFilter} onCohortClear={() => setCohortFilter('')}
          onSortChange={setSortKey} onClearAll={clearAllFilters}
          onOpen={openDrawer} />
      </div>

      {/* ── Clinical Action Items ───────────────────────────────────────── */}
      <section style={{ marginTop: 18 }}>
        <div className="cmo-title-row" style={{ marginBottom: 10 }}>
          <div>
            <h2 className="cmo-section-title" style={{ margin: 0, fontSize: 18 }}>Clinical action items</h2>
            <div className="cmo-subtitle">Suggested next steps · Derived from risk + follow-up signals · Pending team assignment</div>
          </div>
          <span className="cmo-badge" style={{ background: '#f1f5f9', color: '#475569' }}>{actionItems.length} tasks</span>
        </div>
        {actionItems.length === 0 ? (
          <div className="cmo-card cmo-section" style={{ textAlign: 'center', color: '#64748b' }}>
            All suggested follow-up tasks are clear. Continue routine review.
          </div>
        ) : (
          <div className="cmo-list">
            {actionItems.map((it) => {
              const target = patients.find((x) => x.user_id === it.patientId)
              return (
                <ActionItemRow key={it.id} item={it}
                  onOpen={target ? () => openDrawer(target, 'action', it.task) : undefined} />
              )
            })}
          </div>
        )}
      </section>

        </div>
      </details>

      {drawerPatient && (
        <PatientSnapshot
          patient={drawerPatient}
          origin={drawerOrigin}
          originContext={drawerOriginContext}
          onClose={closeDrawer} />
      )}
    </div>
  )
}
