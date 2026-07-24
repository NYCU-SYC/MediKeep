export type ReviewStatus = 'pending_review' | 'in_review' | 'ready_to_publish' | 'published' | 'needs_info'
export type ReviewPriority = 'routine' | 'normal' | 'high' | 'urgent'

export type SourceEvidence = {
  type: string
  id: string
  label: string
  status: string
}

export type AttentionCells = {
  condition: string
  check: string
  followup: string
  value: string
  advice: string
}

export type ProblemLinkResourceType =
  | 'condition'
  | 'medication'
  | 'health_record'
  | 'document'
  | 'dicom_study'
  | 'nhi_draft'
  | 'follow_up'
  | 'missing_data_request'

export type ProblemSlotItem = {
  id?: string | number
  resource_type?: ProblemLinkResourceType | string
  resource_id?: string
  event_date?: string | null
  linked_at?: string | null
  resource?: Record<string, unknown>
  [key: string]: unknown
}

export type ProblemTimelineItem = {
  id: string
  date?: string | null
  event_date?: string | null
  type: string
  label: string
  source_excerpt?: string | null
  resource_id?: string | number | null
}

export type HealthProblem = {
  problem_id: number
  member_name?: string | null
  member_id?: string | null
  title: string
  plain_language_title: string
  severity: 'high' | 'medium' | 'low' | 'insufficient'
  status: string
  status_code?: 'underlying' | 'following' | 'resolved' | string
  diagnosis_status?: 'confirmed' | 'suspected' | 'ruled_out' | 'pending_confirmation' | string
  problem_kind?: 'active' | 'chronic' | 'resolved' | 'suspected' | 'acute' | string
  diagnosis_description?: string | null
  evidence_note?: string | null
  treatment_plan?: string | null
  follow_up_cadence?: string | null
  follow_up_recommendation?: string | null
  source: string
  evidence: SourceEvidence[]
  source_records: string[]
  related_conditions?: ConditionReview[]
  related_medications?: MedicationReview[]
  slots?: Record<ProblemLinkResourceType | string, ProblemSlotItem[]>
  timeline?: ProblemTimelineItem[]
  linked_diagnoses_count?: number
  linked_meds_count?: number
  linked_resources_count?: number
  cmo_internal_note: string
  user_visible_explanation: string
  recommended_action: string
  publish_to_user: boolean
  is_verified: boolean
  is_published: boolean
  icd10_code?: string | null
  created_at?: string | null
}

export type ConditionReview = {
  id: number
  display_name: string
  icd10_code?: string | null
  status?: string | null
  member_name?: string | null
  onset_date?: string | null
  note?: string | null
  linked_problem_id?: number | null
  related_problem_id?: number | null
  is_verified?: boolean
  is_published?: boolean
}

export type MedicationReview = {
  id: number
  member_name?: string | null
  medication_name: string
  drug_name?: string
  generic_name_en?: string | null
  brand_name?: string | null
  dose?: string | null
  route?: string | null
  possible_indication: string
  indication?: string | null
  frequency: string
  duration: string
  related_problem_id: number | null
  linked_problem_id?: number | null
  is_self_paid?: boolean
  price_amount?: number | null
  price_currency?: string | null
  source_record: string | null
  cmo_comment: string
  user_visible_summary: string
  is_verified: boolean
  is_published: boolean
  status: string
}

export type NHITimelineEvent = {
  id: string
  date: string | null
  institution: string
  department: string
  diagnosis: string
  medication: string
  procedure: string
  exam_or_lab: string
  raw_record: string
  normalized_summary: string
  related_problem_ids: number[]
  section: string
  section_label: string
  status: string
}

export type UserFacingSummary = {
  id?: string
  series_id?: string
  patient_id?: string
  member_name?: string
  version?: number
  status?: string
  title: string
  health_summary: string
  recommendation: string
  next_step: string
  attention_cells?: AttentionCells
  follow_up_date?: string | null
  source_refs?: SourceEvidence[]
  quality_checks?: Record<string, unknown>
  created_at?: string | null
  published_at?: string | null
}

export type PatientReview = {
  patient_id: string
  patient_public_id: string
  name: string
  display_name: string
  age: number | null
  sex: string | null
  nhi_upload_status: string
  cmo_review_status: ReviewStatus
  priority: ReviewPriority
  last_updated: string | null
  problem_count: number
  published_problem_count: number
  high_risk_count: number
  missing_info_count: number
  follow_up_count: number
  nhi_draft_count: number
  pending_nhi_draft_count: number
  accepted_nhi_draft_count: number
  rejected_nhi_draft_count: number
  primary_health_problems: Array<Pick<HealthProblem, 'problem_id' | 'title' | 'plain_language_title' | 'severity' | 'status' | 'is_published'>>
  state?: {
    cmo_review_status: ReviewStatus
    priority: ReviewPriority
    inferred_status: ReviewStatus
    inferred_priority: ReviewPriority
    last_reviewed_at: string | null
    updated_at: string | null
    updated_by: string | null
  }
}

export type ReviewQueueResponse = {
  patients: PatientReview[]
  summary: Record<string, number>
}

export type NhiRecord = {
  id: number
  draft_type: string
  status: string
  triage_status?: 'pending' | 'linked' | 'dismissed' | 'rejected' | string
  priority_hint: string
  section: string
  section_label: string
  title: string
  date: string | null
  facility: string
  department: string
  diagnosis: string
  icd10: string
  medication: string
  procedure: string
  exam_or_lab: string
  summary: string
  raw_record: string
  member_name: string | null
  created_at: string | null
  reviewed_at: string | null
  source: string
}

export type RiskSignal = {
  id: string
  label: string
  severity: 'high' | 'medium' | 'low'
  source: string
  date: string | null
  summary: string
}

export type PublishReadinessIssue = {
  code: string
  label: string
  detail: string
  target_type?: string | null
  target_id?: string | null
  next_action?: string | null
}

export type PublishReadiness = {
  patient_id: string
  member_name?: string | null
  member_scope?: string[] | null
  blockers: PublishReadinessIssue[]
  warnings: PublishReadinessIssue[]
  high_risk_flags: PublishReadinessIssue[]
  can_publish: boolean
  requires_secondary_review: boolean
  override_allowed: boolean
}

export type WorkspaceResponse = {
  patient: PatientReview
  state: PatientReview['state']
  family_members?: Array<{
    id: string
    name: string
    relation?: string | null
    age?: number | null
    gender?: string | null
    color?: string | null
  }>
  active_member?: string | null
  source_review: {
    nhi_overview: {
      total: number
      pending: number
      accepted: number
      rejected: number
      sections: Array<{ section: string; label: string; total: number; pending: number; accepted: number; rejected: number }>
    }
    nhi_records: NhiRecord[]
    timeline: NHITimelineEvent[]
    diagnoses: NhiRecord[]
    medication_records: NhiRecord[]
    exam_records: NhiRecord[]
    risk_signals: RiskSignal[]
    uploads: Array<Record<string, unknown>>
    measurements: Array<Record<string, unknown>>
    dicom_studies?: Array<Record<string, unknown>>
  }
  cmo_output: {
    problems: HealthProblem[]
    conditions: ConditionReview[]
    medications: MedicationReview[]
    unlinked: {
      conditions: ConditionReview[]
      medications: MedicationReview[]
      health_records?: Array<Record<string, unknown>>
      documents?: Array<Record<string, unknown>>
      dicom_studies?: Array<Record<string, unknown>>
      nhi_drafts?: NhiRecord[]
      follow_ups?: Array<Record<string, unknown>>
      missing_data_requests?: Array<Record<string, unknown>>
    }
    problem_links?: ProblemSlotItem[]
    timeline_summary: NHITimelineEvent[]
    follow_ups: Array<Record<string, unknown>>
    missing_info_requests: Array<Record<string, unknown>>
    user_facing_summary: UserFacingSummary | null
    published_summary: UserFacingSummary | null
  }
}

export const reviewStatusMeta: Record<ReviewStatus, { label: string; tone: string; description: string }> = {
  pending_review: { label: '待整理', tone: 'amber', description: '需要 CMO 開始整理資料' },
  in_review: { label: '整理中', tone: 'blue', description: 'CMO 已開始整理，尚未發布' },
  ready_to_publish: { label: '待發布', tone: 'purple', description: '摘要或問題已準備發布' },
  published: { label: '已發布', tone: 'green', description: '使用者端已可看到整理結果' },
  needs_info: { label: '需補資料', tone: 'red', description: '需要使用者補充資料後再整理' },
}

export const priorityMeta: Record<ReviewPriority, { label: string; tone: string; rank: number }> = {
  urgent: { label: '高優先處理', tone: 'red', rank: 0 },
  high: { label: '優先', tone: 'amber', rank: 1 },
  normal: { label: '一般', tone: 'blue', rank: 2 },
  routine: { label: '低', tone: 'slate', rank: 3 },
}

export function formatDateTime(value?: string | null) {
  if (!value) return '尚無紀錄'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatDateOnly(value?: string | null) {
  if (!value) return '日期未記錄'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function cleanText(value?: string | null, fallback = '未記錄') {
  const text = String(value ?? '').trim()
  return text || fallback
}

/**
 * Find the first date in free text and return it as YYYY-MM-DD.
 * Handles western dates (2025-07-21, 2025/7/21, 2025年7月21日, 20250721) and
 * Taiwan ROC-era dates (114/07/21, 民國114年7月21日, 1140721 → +1911).
 * ROC years 90–129 are accepted (2001–2040) to keep false positives low.
 */
export function extractDateFromText(text: string): string | undefined {
  const value = String(text ?? '')
  // `(?:^|\D)` guards the left edge instead of a lookbehind, which needs ES2018.
  // Western year with separators or 年月日
  let m = value.match(/(?:^|\D)((?:19|20)\d{2})\s*[-/.年]\s*(0?[1-9]|1[0-2])\s*[-/.月]\s*(0?[1-9]|[12]\d|3[01])(?!\d)/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // ROC year with separators or 年月日 (民國114年7月21日 / 114.7.21)
  m = value.match(/(?:^|\D)(1[0-2]\d|9\d)\s*[-/.年]\s*(0?[1-9]|1[0-2])\s*[-/.月]\s*(0?[1-9]|[12]\d|3[01])(?!\d)/)
  if (m) return `${Number(m[1]) + 1911}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // Compact western YYYYMMDD
  m = value.match(/(?:^|\D)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // Compact ROC YYYMMDD (e.g. 1140721)
  m = value.match(/(?:^|\D)(1[0-2]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/)
  if (m) return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`
  return undefined
}

/** Normalize a user/OCR-provided date string into YYYY-MM-DD, or return it unchanged. */
export function normalizeDateInput(value: string): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return extractDateFromText(text) ?? text
}
