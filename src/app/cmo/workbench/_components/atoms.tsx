// Presentational atoms for the CMO Command Center.
// No data fetching, no derived state — pure render.

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import type { RiskLevel, WorkloadLevel, FollowUpStatus, EnrichedAlert, ActionItem } from '@/lib/clinical'

const RISK_LABELS: Record<RiskLevel, string> = {
  critical: 'Critical', high: 'High', moderate: 'Moderate', stable: 'Stable',
}
const FOLLOW_LABELS: Record<FollowUpStatus, string> = {
  overdue: 'Overdue', due_soon: 'Due soon', on_track: 'On track', unknown: 'Unknown',
}
const WORKLOAD_LABELS: Record<WorkloadLevel, string> = {
  heavy: 'Heavy workload', moderate: 'Moderate workload', light: 'Light workload',
}
const WORKLOAD_STYLE: Record<WorkloadLevel, CSSProperties> = {
  heavy: { background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' },
  moderate: { background: '#f0f9ff', color: '#075985', borderColor: '#bae6fd' },
  light: { background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' },
}

export function KpiTile({ tone, label, value, delta, deltaTone, note }: {
  tone: 'critical' | 'high' | 'attention' | 'ok' | 'info'
  label: string
  value: string | number
  delta?: string
  deltaTone?: 'up' | 'down' | 'flat'
  note: string
}) {
  return (
    <div className={`cmo-card cmo-clin-kpi ${tone}`}>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {delta && deltaTone && (
        <div className={`delta ${deltaTone}`}>
          <span>{deltaTone === 'up' ? '▲' : deltaTone === 'down' ? '▼' : '•'}</span>
          {delta}
        </div>
      )}
      <div className="note">{note}</div>
    </div>
  )
}

export function RiskPill({ level }: { level: RiskLevel }) {
  return <span className={`risk-pill ${level}`}><span className="dot" />{RISK_LABELS[level]}</span>
}

export function WorkloadPill({ level, score }: { level: WorkloadLevel; score: number }) {
  return <span className="cmo-badge" style={{ ...WORKLOAD_STYLE[level], border: `1px solid ${WORKLOAD_STYLE[level].borderColor}` }}>{WORKLOAD_LABELS[level]} · {score}</span>
}

export function FollowUpPill({ status }: { status: FollowUpStatus }) {
  return <span className={`followup-pill ${status}`}>{FOLLOW_LABELS[status]}</span>
}

export function TrendIcon({ trend }: { trend: 'worsening' | 'stable' | 'improving' }) {
  const arrow = trend === 'worsening' ? '↗' : trend === 'improving' ? '↘' : '→'
  const label = trend === 'worsening' ? '惡化' : trend === 'improving' ? '改善' : '穩定'
  return <span className={`trend-ind ${trend}`}>{arrow} {label}</span>
}

export function ScoreBar({ score, level }: { score: number; level: RiskLevel }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span className={`score-bar ${level}`}><span style={{ width: `${score}%` }} /></span>
      <strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: '#0f172a' }}>{score}</strong>
    </span>
  )
}

export function CohortChip({ label, total, highRisk, active, onClick }: {
  label: string; total: number; highRisk: number; active: boolean; onClick: () => void
}) {
  return (
    <button type="button" className={`cohort-chip ${active ? 'active' : ''}`} onClick={onClick}
      aria-pressed={active} title={`${label} · ${total} 位病患 · ${highRisk} 高風險`}>
      <span>{label}</span>
      <span className="ct">{total}</span>
      {highRisk > 0 && <span className="hi">⚠ {highRisk}</span>}
    </button>
  )
}

export function AlertRow({ alert, detectedAtLabel, reviewed, onOpen, onMarkReviewed }: {
  alert: EnrichedAlert
  detectedAtLabel: string
  reviewed: boolean
  onOpen: () => void
  onMarkReviewed: () => void
}) {
  const sevPillCls = alert.severity === 'critical' ? 'critical' : alert.severity === 'high' ? 'high' : 'moderate'
  const sevLabel = alert.severity === 'critical' ? 'Critical' : alert.severity === 'high' ? 'High' : 'Moderate'
  const statusLabel = reviewed ? 'Reviewed' : 'New'
  const statusStyle: React.CSSProperties = reviewed
    ? { background: '#dcfce7', color: '#166534' }
    : { background: '#dbeafe', color: '#1e40af' }
  return (
    <div className={`alert-row ${alert.severity} ${reviewed ? 'is-reviewed' : ''}`}>
      <div className="bar" />
      <div className="body">
        <div className="top">
          <span className={`risk-pill ${sevPillCls}`}><span className="dot" />{sevLabel}</span>
          <span className="name">{alert.display_name}</span>
          <span className="meta">· {alert.itemLabel}</span>
          <span className="cmo-badge" style={statusStyle}>{statusLabel}</span>
        </div>
        <div className="msg">{alert.message}</div>
        <div className="step">→ Suggested: {alert.recommendedStep}</div>
        <div className="meta">{detectedAtLabel} · For clinician review</div>
      </div>
      <div className="right">
        {!reviewed && (
          <button type="button" className="cmo-button" onClick={onMarkReviewed}
            title="標記此警示為已讀（寫入稽核軌跡，可跨裝置保留）">標記已讀</button>
        )}
        <button type="button" className="cmo-button primary" onClick={onOpen}>Open snapshot</button>
      </div>
    </div>
  )
}

// Removable filter pill — shown in the active-filters bar above the worklist.
// Clicking the × clears that one filter.
export function ActiveFilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="active-filter-chip" role="status">
      <span>{label}</span>
      <button type="button" aria-label={`Clear filter ${label}`} onClick={onClear} className="x">×</button>
    </span>
  )
}

// Small "Demo" pill — shown next to mock patient names so CMO immediately
// knows which rows are demo data vs real backend records.
export function DemoBadge() {
  return (
    <span title="Mock cohort — not in backend yet"
      style={{
        display: 'inline-block', padding: '1px 6px', borderRadius: 4,
        background: '#ede9fe', color: '#5b21b6', fontSize: 10,
        fontWeight: 800, letterSpacing: '.3px', verticalAlign: 'middle',
        marginLeft: 6,
      }}>DEMO</span>
  )
}

// Action item rows route through onOpen so the workbench can open the
// snapshot drawer (with origin context) instead of always doing a hard
// navigation — important for demo patients whose backend chart doesn't exist.
export function ActionItemRow({ item, onOpen }: { item: ActionItem; onOpen?: () => void }) {
  return (
    <div className="action-item">
      <span className={`prio ${item.priority}`}>{item.priority.toUpperCase()}</span>
      <div>
        <div className="task">{item.task}</div>
        <div className="sub">{item.patient} · {item.taskType} · Due {item.dueLabel}</div>
      </div>
      {onOpen ? (
        <button type="button" className="cmo-button" onClick={onOpen}>Open snapshot</button>
      ) : (
        <Link className="cmo-button" href={`/cmo/patients/${item.patientId}`}>Open</Link>
      )}
    </div>
  )
}

export function SectionHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: ReactNode }) {
  return (
    <div className="cmo-title-row" style={{ marginBottom: 10 }}>
      <div>
        <h2 className="cmo-section-title" style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <div className="cmo-subtitle">{subtitle}</div>
      </div>
      {right}
    </div>
  )
}
