// Clinical signal derivation for CMO Panel.
// Pure functions — no React, no fetch — easy to test and reuse.
// Derives risk, cohort, follow-up status, action items from CMO queue API.

export type RiskLevel = 'critical' | 'high' | 'moderate' | 'stable'
export type Trend = 'worsening' | 'stable' | 'improving'
export type FollowUpStatus = 'overdue' | 'due_soon' | 'on_track' | 'unknown'

// Shape returned by GET /api/cmo/workbench/queue.
// Mock patients (from src/lib/mockClinicalData.ts) reuse this shape
// + add isDemoData + demoOverrides so they can carry explicit clinical
// signals the real backend hasn't yet produced (lab values, age/sex etc.).
export interface QueueItem {
  user_id: string
  patient_id?: string
  patient_public_id?: string
  display_name: string
  pending_drafts: number
  draft_count?: number
  pending_change_requests?: number
  change_request_count?: number
  last_request_at?: string | null
  tier1_drafts?: number
  // Number of NHI 健康存摺 drafts (any status). Lets the workbench show a
  // direct shortcut to /cmo/patients/{id}/nhi even after triage is done.
  nhi_drafts_count?: number
  unpublished_problems: number
  records_count: number
  documents_count: number
  dicom_count: number
  last_activity: string | null
  queue_type: string
  queue_category?: import('./healthkeepTypes').QueueCategory
  source_type?: string
  document_type?: string | null
  upload_status?: string
  confidence_summary?: { min: number | null; avg: number | null; low_count: number }
  next_action: string
  highest_priority_tier: number | null
  highest_problem_name: string | null
  priority?: number
  assigned_reviewer?: string | null
  last_updated?: string | null
  merged_count?: number
  merged_patient_ids?: string[]
  merged_display_names?: string[]
  isDemoData?: boolean
  demoOverrides?: DemoOverrides
}

export interface DemoOverrides {
  age?: number
  sex?: 'Male' | 'Female' | 'Other'
  cohorts?: string[]
  riskLevel?: RiskLevel
  riskScore?: number
  trend?: Trend
  abnormalFindings?: AbnormalFinding[]
}

export interface AbnormalFinding {
  item: string
  value: string
  reference?: string
  severity: 'critical' | 'high' | 'moderate'
  detectedAt: string | null
}

// Enriched patient — what the CMO Panel actually renders.
export interface ClinicalPatient extends QueueItem {
  riskLevel: RiskLevel
  riskScore: number      // 0–100, higher = more clinical risk
  healthScore: number    // 0–100, inverse-weighted summary
  cohorts: string[]      // cohort ids this patient belongs to
  trend: Trend
  followUpStatus: FollowUpStatus
  primaryFinding: string
  abnormalFindings: AbnormalFinding[]
  ageSex: string         // "67F" / "—"
  isDemoData: boolean    // true for mock patients (resolved from QueueItem.isDemoData)
  // ── POV fields (filled from MOCK_PROBLEMS for demo patients) ──
  // Real backend patients leave these empty until /api/cmo/patients/{id}/pov
  // is wired up — the snapshot drawer falls back to "no problem cards yet".
  problems?: import('./healthkeepTypes').Problem[]
  sourceDocuments?: import('./healthkeepTypes').SourceDocument[]
  allergies?: import('./healthkeepTypes').Allergy[]
  queueCategory?: import('./healthkeepTypes').QueueCategory
}

export interface CohortDef {
  id: string
  label: string
  en: string
  match?: RegExp                                          // keyword/ICD match
  computed?: (p: ClinicalPatient) => boolean              // derived membership
}

// Cohort definitions — keyword/ICD heuristics on the problem name + next_action.
// These are best-effort signals for triage, NOT clinical diagnoses.
export const COHORTS: CohortDef[] = [
  { id: 'diabetes',     label: '糖尿病',          en: 'Diabetes',           match: /糖尿|血糖|HbA1c|\bE1[01]/i },
  { id: 'hypertension', label: '高血壓',          en: 'Hypertension',       match: /高血壓|血壓|hypertension|\bI1[0-5]/i },
  { id: 'hyperlipid',   label: '高血脂',          en: 'Hyperlipidemia',     match: /高血脂|血脂|膽固醇|lipid|\bE78/i },
  { id: 'metabolic',    label: '代謝/肥胖',       en: 'Metabolic Risk',     match: /肥胖|代謝|BMI|metabolic|\bE66/i },
  { id: 'cardiovasc',   label: '心血管風險',      en: 'Cardiovascular',     match: /心房|顫動|atrial|fibrillation|冠|stroke|腦中風|\bI2[01]|\bI63/i },
  { id: 'trauma',       label: '創傷/出血',       en: 'Trauma',             match: /骨折|挫傷|出血|fracture|hemorrhage|\bS0|\bS5/i },
  { id: 'respiratory',  label: '呼吸道',          en: 'Respiratory',        match: /肺炎|氣管|呼吸|COVID|U07|J1[0-8]/i },
  { id: 'overdue',      label: '長期未追蹤',      en: 'Long Gap',           computed: (p) => p.followUpStatus === 'overdue' },
  { id: 'worsening',    label: '近期惡化',        en: 'Recently Worsened',  computed: (p) => p.trend === 'worsening' },
]

export function cohortLabel(id: string): string {
  return COHORTS.find((c) => c.id === id)?.label ?? id
}

export function ageDays(iso: string | null): number {
  if (!iso) return -1
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return -1
  return Math.floor((Date.now() - t) / 86400000)
}

export function followUpStatus(lastActivity: string | null): FollowUpStatus {
  const d = ageDays(lastActivity)
  if (d < 0) return 'unknown'
  if (d > 90) return 'overdue'
  if (d > 30) return 'due_soon'
  return 'on_track'
}

export function deriveTrend(p: QueueItem): Trend {
  const t1 = p.tier1_drafts ?? 0
  const cr = p.pending_change_requests ?? p.change_request_count ?? 0
  if (t1 > 0) return 'worsening'
  if (p.pending_drafts > 5) return 'worsening'
  if (p.pending_drafts > 0 || p.unpublished_problems > 0 || cr > 0) return 'stable'
  return 'improving'
}

// Risk derivation — combines tier, pending volume, unpublished problems.
// Returns 0–100 score and discrete level for badge rendering.
export function deriveRisk(p: QueueItem): { level: RiskLevel; score: number } {
  const tier = p.highest_priority_tier
  const t1 = p.tier1_drafts ?? 0
  const cr = p.pending_change_requests ?? p.change_request_count ?? 0
  let level: RiskLevel = 'stable'
  let base = 10
  if (tier === 1 || t1 > 0) { level = 'critical'; base = 88 }
  else if (tier === 2 || p.pending_drafts >= 5 || cr >= 3) { level = 'high'; base = 64 }
  else if (p.pending_drafts > 0 || p.unpublished_problems > 0 || cr > 0) { level = 'moderate'; base = 38 }

  const additive = p.pending_drafts * 1.2 + p.unpublished_problems * 2.5 + cr * 2 + t1 * 3
  const score = Math.round(Math.min(100, Math.max(0, base + additive)))
  return { level, score }
}

// Heuristic conversion of highest_problem_name into a "finding" entry —
// used in the drawer when no structured lab values are available.
function findingsFromProblem(name: string | null, severity: AbnormalFinding['severity']): AbnormalFinding[] {
  if (!name) return []
  return [{
    item: name,
    value: 'See chart',
    severity,
    detectedAt: null,
  }]
}

// Resolve clinical fields. Demo overrides take precedence over heuristic
// derivation so mock patients with explicit risk/cohort/findings render
// exactly as authored.
export function deriveClinical(p: QueueItem): ClinicalPatient {
  const ov = p.demoOverrides
  const heuristic = deriveRisk(p)
  const level: RiskLevel = ov?.riskLevel ?? heuristic.level
  const score: number = ov?.riskScore ?? heuristic.score
  const trend: Trend = ov?.trend ?? deriveTrend(p)
  const fu = followUpStatus(p.last_activity)

  const partial: ClinicalPatient = {
    ...p,
    riskLevel: level,
    riskScore: score,
    healthScore: Math.max(0, 100 - score),
    followUpStatus: fu,
    trend,
    primaryFinding: (p.pending_change_requests ?? p.change_request_count ?? 0) > 0
      ? `${p.pending_change_requests ?? p.change_request_count} user change request${(p.pending_change_requests ?? p.change_request_count ?? 0) > 1 ? 's' : ''}`
      : p.highest_problem_name || '—',
    abnormalFindings: ov?.abnormalFindings ?? findingsFromProblem(
      p.highest_problem_name,
      level === 'critical' ? 'critical' : level === 'high' ? 'high' : 'moderate',
    ),
    ageSex: ov?.age && ov?.sex
      ? `${ov.age}${ov.sex === 'Male' ? 'M' : ov.sex === 'Female' ? 'F' : 'O'}`
      : '—',
    cohorts: [],
    isDemoData: p.isDemoData === true,
  }

  // Cohort resolution: explicit overrides win; otherwise heuristic match
  if (ov?.cohorts && ov.cohorts.length > 0) {
    partial.cohorts = Array.from(new Set(ov.cohorts))
  } else {
    const text = (p.highest_problem_name || '') + ' ' + (p.next_action || '')
    const cohorts: string[] = []
    COHORTS.forEach((c) => {
      if (c.match && c.match.test(text)) cohorts.push(c.id)
      if (c.computed && c.computed(partial)) cohorts.push(c.id)
    })
    partial.cohorts = Array.from(new Set(cohorts))
  }
  return partial
}

// Merge real queue items with the mock cohort. Real items keep precedence:
// if a mock id collides with a real id (shouldn't happen — mock ids start
// with "mock-") the real one wins.
export function mergeQueueWithMock(real: QueueItem[], mock: QueueItem[]): QueueItem[] {
  const realIds = new Set(real.map((r) => r.user_id))
  const merged = [...real]
  mock.forEach((m) => { if (!realIds.has(m.user_id)) merged.push(m) })
  return merged
}

// Attach POV (problems / source docs / allergies / queue category) to mock
// patients. Real backend patients pass through untouched — they get POV from
// /api/cmo/patients/{id}/pov when that endpoint is wired up.
export function enrichWithMockPov(
  patient: ClinicalPatient,
  pov: {
    problems?: Record<string, import('./healthkeepTypes').Problem[]>
    sourceDocs?: Record<string, import('./healthkeepTypes').SourceDocument[]>
    allergies?: Record<string, import('./healthkeepTypes').Allergy[]>
    queueCategory?: Record<string, import('./healthkeepTypes').QueueCategory>
  },
): ClinicalPatient {
  if (!patient.isDemoData) return patient
  return {
    ...patient,
    problems: pov.problems?.[patient.user_id] ?? [],
    sourceDocuments: pov.sourceDocs?.[patient.user_id] ?? [],
    allergies: pov.allergies?.[patient.user_id] ?? [],
    queueCategory: pov.queueCategory?.[patient.user_id],
  }
}

// ── Defensive utilities — prevent dashboard crashes on missing data ─────────

export function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

export function safeNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function safeDateLabel(iso: string | null | undefined, fallback = '—'): string {
  if (!iso) return fallback
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatPatientLabel(p: ClinicalPatient): string {
  const name = (p.display_name ?? '').split('·')[0].trim() || 'Unnamed patient'
  return p.isDemoData ? `${name} (demo)` : name
}

export function getPrimaryFinding(p: ClinicalPatient): string {
  if (p.abnormalFindings.length > 0) return p.abnormalFindings[0].item
  return p.primaryFinding || '—'
}

export function getLatestAlertDate(p: ClinicalPatient): string | null {
  const dates = p.abnormalFindings.map((f) => f.detectedAt).filter((d): d is string => !!d)
  if (dates.length === 0) return null
  dates.sort()
  return dates[dates.length - 1]
}

// ── Alert enrichment ─────────────────────────────────────────────────────────

export interface AlertOut {
  level: 'high' | 'medium' | 'low'
  category: string
  user_id: string
  display_name: string
  message: string
}

export interface EnrichedAlert extends AlertOut {
  severity: 'critical' | 'high' | 'moderate'
  itemLabel: string
  recommendedStep: string
  status: 'New'
}

export const ALERT_CATEGORY: Record<string, { item: string; step: string }> = {
  mri_safety_missing:   { item: 'MRI 安全問卷缺漏',      step: '請病患補填問卷後再排檢查' },
  high_priority:        { item: '高優先病患積壓',         step: '進入病患總覽，優先審閱 Tier 1 紀錄' },
  unpublished_problem:  { item: 'Problem 未發布',          step: '確認後對病患端發布' },
  missing_redzone:      { item: '紅區資料缺漏',           step: '補齊過敏 / 植入物 / 重症史' },
  missing_followup:     { item: '長期未追蹤',             step: '安排電話或回診' },
}

export function enrichAlert(a: AlertOut): EnrichedAlert {
  const meta = ALERT_CATEGORY[a.category] ?? { item: a.category, step: '進入病患資料審閱' }
  const severity: EnrichedAlert['severity'] =
    a.level === 'high' ? 'critical' : a.level === 'medium' ? 'high' : 'moderate'
  return { ...a, severity, itemLabel: meta.item, recommendedStep: meta.step, status: 'New' }
}

// ── Clinical action items (team task queue) ──────────────────────────────────

export interface ActionItem {
  id: string
  priority: 'p1' | 'p2' | 'p3'
  patient: string
  patientId: string
  task: string
  taskType: string
  dueLabel: string
}

export function deriveActionItems(patients: ClinicalPatient[]): ActionItem[] {
  const items: ActionItem[] = []
  patients.forEach((p) => {
    const t1 = p.tier1_drafts ?? 0
    if (t1 > 0) {
      items.push({
        id: `${p.user_id}-t1`,
        priority: 'p1',
        patient: p.display_name,
        patientId: p.user_id,
        task: `Confirm ${t1} critical-tier draft${t1 > 1 ? 's' : ''}`,
        taskType: 'Review critical alert',
        dueLabel: 'Today',
      })
    }
    if (p.followUpStatus === 'overdue') {
      items.push({
        id: `${p.user_id}-fu`,
        priority: 'p2',
        patient: p.display_name,
        patientId: p.user_id,
        task: 'Schedule follow-up — no activity > 90 days',
        taskType: 'Schedule follow-up',
        dueLabel: 'This week',
      })
    }
    if (p.unpublished_problems > 0 && p.riskLevel !== 'stable') {
      items.push({
        id: `${p.user_id}-pub`,
        priority: 'p2',
        patient: p.display_name,
        patientId: p.user_id,
        task: `Publish ${p.unpublished_problems} verified problem${p.unpublished_problems > 1 ? 's' : ''}`,
        taskType: 'Adjust care plan',
        dueLabel: '48 hours',
      })
    }
    if (p.pending_drafts > 5 && p.riskLevel === 'moderate') {
      items.push({
        id: `${p.user_id}-drafts`,
        priority: 'p3',
        patient: p.display_name,
        patientId: p.user_id,
        task: `Triage ${p.pending_drafts} pending drafts`,
        taskType: 'Complete physician note',
        dueLabel: 'This week',
      })
    }
  })
  const prioRank = { p1: 0, p2: 1, p3: 2 }
  items.sort((a, b) => prioRank[a.priority] - prioRank[b.priority])
  return items.slice(0, 12)
}

export function avgHealthScore(patients: ClinicalPatient[]): number {
  if (patients.length === 0) return 0
  const total = patients.reduce((s, p) => s + p.healthScore, 0)
  return Math.round(total / patients.length)
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '尚無紀錄'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins} 分鐘前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小時前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 週前`
  if (days < 365) return `${Math.floor(days / 30)} 個月前`
  return `${Math.floor(days / 365)} 年前`
}

// AI summary placeholder — text generation belongs server-side later.
// For now, compose a clinician-review-only summary from derived signals,
// using conservative language as required by the spec.
// All numeric scores are explicitly labelled as "internal triage signals",
// not medical scores.
export function composeAiSummary(p: ClinicalPatient): string {
  const lines: string[] = []
  const riskWord = p.riskLevel === 'critical' ? '危急' : p.riskLevel === 'high' ? '高' : p.riskLevel === 'moderate' ? '中度' : '穩定'
  lines.push(`Triage signal: ${riskWord} (internal score ${p.riskScore}/100). For clinician review — not a diagnosis.`)
  if (p.primaryFinding && p.primaryFinding !== '—') {
    lines.push(`Potential area of focus: ${p.primaryFinding}. Requires clinician confirmation.`)
  }
  if (p.trend === 'worsening') {
    lines.push('Abnormal trend detected in recent uploads — suggested trend review.')
  }
  if (p.followUpStatus === 'overdue') {
    lines.push('Follow-up gap > 90 days — potential care gap. Suggested follow-up.')
  }
  if ((p.tier1_drafts ?? 0) > 0) {
    lines.push(`${p.tier1_drafts} tier-1 draft(s) awaiting CMO confirmation.`)
  }
  if (p.cohorts.length > 0) {
    lines.push(`Cohort tags (keyword-matched, not a diagnosis): ${p.cohorts.map(cohortLabel).join(' / ')}.`)
  }
  if (lines.length === 1) {
    lines.push('No active alerts in triage signals. Suggested action: routine review at next scheduled visit.')
  }
  return lines.join('\n')
}

// Returns a list of human-readable reasons explaining WHY this patient
// landed in the current risk level. Used in the snapshot drawer to make
// the risk classification transparent and reviewable.
export function riskExplanation(p: ClinicalPatient): string[] {
  const reasons: string[] = []
  const tier = p.highest_priority_tier
  const t1 = p.tier1_drafts ?? 0
  if (tier === 1 || t1 > 0) {
    reasons.push(`Tier 1 finding present${t1 > 0 ? ` (${t1} draft${t1 > 1 ? 's' : ''})` : ''} — automatic critical flag`)
  } else if (tier === 2) {
    reasons.push('Tier 2 finding present — elevated baseline risk')
  }
  if (p.pending_drafts >= 5) {
    reasons.push(`${p.pending_drafts} pending drafts — volume above triage threshold`)
  }
  if ((p.pending_change_requests ?? p.change_request_count ?? 0) > 0) {
    const count = p.pending_change_requests ?? p.change_request_count ?? 0
    reasons.push(`${count} user change request${count > 1 ? 's' : ''} awaiting CMO review`)
  }
  if (p.unpublished_problems > 0) {
    reasons.push(`${p.unpublished_problems} verified problem${p.unpublished_problems > 1 ? 's' : ''} not yet published to patient`)
  }
  if (p.trend === 'worsening') {
    reasons.push('Worsening signal heuristic triggered (tier-1 or rising backlog)')
  }
  if (p.followUpStatus === 'overdue') {
    reasons.push('No activity > 90 days — care gap')
  }
  if (reasons.length === 0) {
    reasons.push('No elevating signals — classified as baseline')
  }
  return reasons
}

// Convert back-office next_action strings (e.g. "Open POV") into
// clinician-facing phrasing. Falls back to original text if unmapped.
export function humanizeNextAction(raw: string | null | undefined): string {
  if (!raw) return 'Routine review at next scheduled visit'
  const map: Record<string, string> = {
    'Open POV':           'Open patient overview · suggested action pending CMO review',
    'open pov':           'Open patient overview · suggested action pending CMO review',
    'Review drafts':      'Review pending drafts',
    'Review User Requests':'Review user-submitted change requests',
    'Confirm tier 1':     'Confirm tier-1 critical findings',
    'Publish':            'Publish verified problem(s) to patient',
    'Schedule follow-up': 'Schedule clinical follow-up',
  }
  return map[raw] ?? raw
}

// Synthetic "detected-at" formatter. Until alert backend tracks creation
// time, fall back to "Just now" / "Recent".
export function formatDetectedAt(iso: string | null | undefined): string {
  if (!iso) return 'Recent · time not recorded'
  return formatRelative(iso) + ' · detected'
}
