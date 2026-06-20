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

interface CockpitEnvelope {
  buckets: CockpitBucket[]
}

// RISK_OPTION_LABEL / FOLLOW_OPTION_LABEL moved into _components/worklist.tsx
// where the filter UI lives.

const REVIEWED_ALERTS_KEY = 'cmo:reviewed-alerts'

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
  if (key === 'needs_clarification' || key === 'user_replies') return { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' }
  if (key === 'nhi_imports') return { bg: '#f0f9ff', fg: '#075985', border: '#bae6fd' }
  if (key === 'verified_drafts') return { bg: '#ecfdf5', fg: '#047857', border: '#bbf7d0' }
  return { bg: '#f8fafc', fg: '#475569', border: '#e2e8f0' }
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
          <h2 className="cmo-section-title" style={{ margin: 0 }}>CMO Cockpit Queue · 8+1</h2>
          <div className="cmo-subtitle">Start here for the next CMO action. Every row shows target, source, current status, and what the patient will see after completion.</div>
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
  const [drawerPatientId, setDrawerPatientId] = useState<string | null>(initialPatientId)
  const [drawerOrigin, setDrawerOrigin] = useState<DrawerOrigin>(initialOrigin)
  const [drawerOriginContext, setDrawerOriginContext] = useState<string | undefined>(initialOriginContext)
  const [reviewedAlerts, setReviewedAlerts] = useState<Set<string>>(() => loadReviewedAlerts())

  // Sync filters + drawer to URL (replace, not push — no history bloat).
  // Only run on changes after mount.
  const syncUrl = useCallback((extra?: { patient?: string | null; from?: DrawerOrigin; ctx?: string }) => {
    const next = new URLSearchParams()
    if (search.trim()) next.set('q', search.trim())
    if (riskFilter !== 'all') next.set('risk', riskFilter)
    if (followFilter !== 'all') next.set('follow', followFilter)
    if (cohortFilter) next.set('cohort', cohortFilter)
    if (sortKey !== 'risk_desc') next.set('sort', sortKey)
    const pid = extra && 'patient' in extra ? extra.patient : drawerPatientId
    if (pid) next.set('patient', pid)
    const from = extra?.from ?? drawerOrigin
    if (pid && from && from !== 'url') next.set('from', from)
    const ctx = extra?.ctx ?? drawerOriginContext
    if (pid && ctx) next.set('ctx', ctx)
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }, [router, search, riskFilter, followFilter, cohortFilter, sortKey, drawerPatientId, drawerOrigin, drawerOriginContext])

  // Push filter changes to URL whenever they change (after mount)
  const filterDeps = [search, riskFilter, followFilter, cohortFilter, sortKey]
  useEffect(() => { syncUrl() }, filterDeps) // eslint-disable-line react-hooks/exhaustive-deps

  const worklistRef = useRef<HTMLElement | null>(null)
  const pageStartTs = useMemo(() => new Date().toISOString(), [])

  const sync = useSync()

  const loadWorkbench = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [nextStats, nextQueue, nextCockpit] = await Promise.all([
        fetchJson<Stats | null>('/api/cmo/workbench/stats'),
        fetchJson<QueueEnvelope | QueueItem[]>('/api/cmo/workbench/queue'),
        fetchJson<CockpitEnvelope>('/api/cmo/workbench/queues'),
      ])
      setStats(nextStats)
      setQueue(unwrapQueue(nextQueue))
      setCockpitBuckets(nextCockpit.buckets)
    } catch (error) {
      setStats(null)
      setQueue([])
      setCockpitBuckets([])
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
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

  const hasActiveFilter = search.trim().length > 0 || riskFilter !== 'all' || followFilter !== 'all' || cohortFilter !== ''
  const clearAllFilters = () => { setSearch(''); setRiskFilter('all'); setFollowFilter('all'); setCohortFilter('') }

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
  if (patients.length === 0) {
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

      <CockpitQueues buckets={cockpitBuckets} onOpen={(patientId) => router.push(`/cmo/patients/${patientId}`)} />

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
