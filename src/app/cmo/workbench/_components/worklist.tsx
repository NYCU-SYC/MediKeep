'use client'

// Clinical worklist section — extracted from page.tsx to keep page < 500 lines.
// Pure presentation: parent owns all state and callbacks.

import {
  cohortLabel, formatRelative, humanizeNextAction,
  type ClinicalPatient, type RiskLevel, type FollowUpStatus,
} from '@/lib/clinical'
import type { DrawerOrigin } from '@/lib/healthkeepTypes'
import {
  RiskPill, FollowUpPill, TrendIcon, ScoreBar,
  ActiveFilterChip, DemoBadge,
} from './atoms'

type SortKey = 'risk_desc' | 'health_asc' | 'last_activity' | 'pending_desc' | 'name'

const RISK_OPTION_LABEL: Record<RiskLevel, string> = {
  critical: 'Critical', high: 'High', moderate: 'Moderate', stable: 'Stable',
}
const FOLLOW_OPTION_LABEL: Record<FollowUpStatus, string> = {
  overdue: 'Overdue', due_soon: 'Due soon', on_track: 'On track', unknown: 'Unknown',
}

export interface ClinicalWorklistProps {
  worklist: ClinicalPatient[]
  totalPatients: number
  selectedPatientId: string | null
  search: string
  riskFilter: 'all' | RiskLevel
  followFilter: 'all' | FollowUpStatus
  cohortFilter: string
  sortKey: SortKey
  hasActiveFilter: boolean
  onSearchChange: (v: string) => void
  onRiskChange: (v: 'all' | RiskLevel) => void
  onFollowChange: (v: 'all' | FollowUpStatus) => void
  onCohortClear: () => void
  onSortChange: (v: SortKey) => void
  onClearAll: () => void
  onOpen: (p: ClinicalPatient, origin: DrawerOrigin, ctx?: string) => void
}

export function ClinicalWorklist(props: ClinicalWorklistProps) {
  const {
    worklist, totalPatients, selectedPatientId,
    search, riskFilter, followFilter, cohortFilter, sortKey, hasActiveFilter,
    onSearchChange, onRiskChange, onFollowChange, onCohortClear,
    onSortChange, onClearAll, onOpen,
  } = props

  const origin: DrawerOrigin = cohortFilter ? 'cohort' : 'worklist'
  const originCtx = cohortFilter ? cohortLabel(cohortFilter) : undefined

  return (
    <section id="worklist" style={{ marginTop: 18, scrollMarginTop: 80 }}>
      <div className="cmo-title-row" style={{ marginBottom: 10 }}>
        <div>
          <h2 className="cmo-section-title" style={{ margin: 0, fontSize: 18 }}>Clinical worklist</h2>
          <div className="cmo-subtitle">
            Showing <strong>{worklist.length}</strong> of {totalPatients} patients
            {hasActiveFilter ? ' · Filters active' : ' · No filters'}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="cmo-card cmo-toolbar">
        <input className="cmo-input" style={{ flex: '1 1 260px', minWidth: 0 }}
          value={search} onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜尋病患姓名、ID、診斷、suggested action…"
          aria-label="Search patients" />
        <select className="cmo-select" style={{ width: 140 }}
          value={riskFilter} onChange={(e) => onRiskChange(e.target.value as 'all' | RiskLevel)}
          aria-label="Filter by risk level">
          <option value="all">All risk levels</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="moderate">Moderate</option>
          <option value="stable">Stable</option>
        </select>
        <select className="cmo-select" style={{ width: 150 }}
          value={followFilter} onChange={(e) => onFollowChange(e.target.value as 'all' | FollowUpStatus)}
          aria-label="Filter by follow-up status">
          <option value="all">All follow-up</option>
          <option value="overdue">Overdue (&gt; 90d)</option>
          <option value="due_soon">Due soon (30–90d)</option>
          <option value="on_track">On track</option>
          <option value="unknown">Unknown</option>
        </select>
        <select className="cmo-select" style={{ width: 200 }}
          value={sortKey} onChange={(e) => onSortChange(e.target.value as SortKey)}
          aria-label="Sort worklist">
          <option value="risk_desc">Sort: Risk score (high → low)</option>
          <option value="health_asc">Sort: Health score (low → high)</option>
          <option value="last_activity">Sort: Latest activity</option>
          <option value="pending_desc">Sort: Pending drafts</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>

      {/* Active filters bar */}
      {hasActiveFilter && (
        <div className="cmo-card" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', marginBottom: 10, flexWrap: 'wrap',
        }}>
          <span className="cmo-kpi-label" style={{ marginRight: 4 }}>Active filters</span>
          {search.trim() && <ActiveFilterChip label={`搜尋：${search.trim()}`} onClear={() => onSearchChange('')} />}
          {riskFilter !== 'all' && <ActiveFilterChip label={`Risk: ${RISK_OPTION_LABEL[riskFilter]}`} onClear={() => onRiskChange('all')} />}
          {followFilter !== 'all' && <ActiveFilterChip label={`Follow-up: ${FOLLOW_OPTION_LABEL[followFilter]}`} onClear={() => onFollowChange('all')} />}
          {cohortFilter && <ActiveFilterChip label={`Cohort: ${cohortLabel(cohortFilter)}`} onClear={onCohortClear} />}
          <button type="button" className="cmo-button" style={{ marginLeft: 'auto' }} onClick={onClearAll}>Clear all filters</button>
        </div>
      )}

      <div className="cmo-card table-wrap" style={{ overflow: 'auto' }}>
        <table className="cmo-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Risk</th>
              <th>Health</th>
              <th>Primary finding</th>
              <th>Cohort</th>
              <th>Trend</th>
              <th>Follow-up</th>
              <th>Last activity</th>
              <th>Suggested action</th>
              <th>Assigned</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {worklist.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
                  <div style={{ fontWeight: 700, color: '#334155', marginBottom: 8 }}>No patients match the current filters.</div>
                  <div style={{ marginBottom: 12, fontSize: 12 }}>Try widening risk / follow-up filters or clearing the cohort.</div>
                  {hasActiveFilter && (
                    <button type="button" className="cmo-button primary" onClick={onClearAll}>Clear all filters</button>
                  )}
                </td>
              </tr>
            ) : worklist.map((p) => (
              <tr key={p.user_id}
                className={selectedPatientId === p.user_id ? 'is-selected' : ''}
                style={{ cursor: 'pointer' }}
                onClick={() => onOpen(p, origin, originCtx)}
                title="Click for snapshot">
                <td>
                  <strong style={{ color: '#0f172a' }}>{p.display_name}</strong>
                  {p.isDemoData && <DemoBadge />}
                  {(p.merged_count ?? 1) > 1 && (
                    <span className="cmo-badge" style={{ marginLeft: 6, background: '#eff6ff', color: '#1d4ed8' }}>
                      merged x{p.merged_count}
                    </span>
                  )}
                  <div className="cmo-subtitle" style={{ marginTop: 2, fontSize: 11 }}>
                    {p.ageSex} · {p.user_id.slice(0, 8)}
                    {(p.merged_count ?? 1) > 1 && <> · {p.merged_patient_ids?.length ?? p.merged_count} source IDs</>}
                  </div>
                </td>
                <td>
                  <RiskPill level={p.riskLevel} />
                  <div style={{ marginTop: 4 }}><ScoreBar score={p.riskScore} level={p.riskLevel} /></div>
                </td>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#0f172a' }}>{p.healthScore}</td>
                <td>
                  <div style={{ fontSize: 13, color: '#0f172a' }}>{p.primaryFinding}</div>
                  {p.pending_drafts > 0 && (
                    <div className="cmo-subtitle" style={{ fontSize: 11 }}>
                      {p.pending_drafts} pending draft{p.pending_drafts > 1 ? 's' : ''}
                      {p.tier1_drafts ? ` · ${p.tier1_drafts} tier 1` : ''}
                    </div>
                  )}
                  {(p.pending_change_requests ?? p.change_request_count ?? 0) > 0 && (
                    <div className="cmo-subtitle" style={{ fontSize: 11, color: '#a16207', fontWeight: 800 }}>
                      {p.pending_change_requests ?? p.change_request_count} user change request{(p.pending_change_requests ?? p.change_request_count ?? 0) > 1 ? 's' : ''}
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 11 }}>{p.cohorts.slice(0, 3).map(cohortLabel).join(' · ') || '—'}</td>
                <td><TrendIcon trend={p.trend} /></td>
                <td><FollowUpPill status={p.followUpStatus} /></td>
                <td style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>{formatRelative(p.last_activity)}</td>
                <td style={{ fontSize: 12, color: '#1d4ed8' }}>{humanizeNextAction(p.next_action)}</td>
                <td style={{ fontSize: 12, color: '#64748b' }}>— <span style={{ fontSize: 10 }}>(unassigned)</span></td>
                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  <button className="cmo-button primary" type="button"
                    onClick={() => onOpen(p, origin, originCtx)}>
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
