export type ReviewStatus = 'pending_review' | 'in_review' | 'ready_to_publish' | 'published' | 'needs_info'
export type ReviewPriority = 'routine' | 'normal' | 'high' | 'urgent'

export type SourceEvidence = {
  type: string
  id: string
  label: string
  status: string
}

export type ProblemLink = {
  id: number
  problem_id: number
  patient_id: string
  resource_type: string
  resource_id: string
  resource_label?: string | null
  resource_date?: string | null
  triage: string
  note?: string | null
  linked_at?: string | null
}

export type HealthProblem = {
  problem_id: number
  title: string
  plain_language_title: string
  severity: 'high' | 'medium' | 'low' | 'insufficient'
  status: string
  certainty?: 'confirmed' | 'suspected' | 'ruled_out' | string
  course?: string
  followup_note?: string
  tracking_note?: string
  source: string
  evidence: SourceEvidence[]
  source_records: string[]
  links?: ProblemLink[]
  linked_diagnoses_count?: number
  linked_meds_count?: number
  linked_labs_observations_count?: number
  linked_imaging_count?: number
  linked_procedures_count?: number
  linked_measurements_count?: number
  cmo_internal_note: string
  user_visible_explanation: string
  recommended_action: string
  publish_to_user: boolean
  is_verified: boolean
  is_published: boolean
  icd10_code?: string | null
  created_at?: string | null
}

export type MedicationReview = {
  id: number
  medication_name: string
  generic_name_en?: string | null
  brand_name?: string | null
  dose?: string | null
  route?: string | null
  self_pay_price?: string | null
  possible_indication: string
  frequency: string
  duration: string
  related_problem_id: number | null
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
  summary_condition?: string
  summary_exam?: string
  summary_followup?: string
  summary_values?: string
  summary_advice?: string
  attention_summary?: {
    condition: string
    exam: string
    followup: string
    values: string
    advice: string
  }
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
  linked_problem_ids?: number[]
  triage_status?: 'dismissed' | 'rejected' | 'needs_data' | null
  triage_note?: string | null
  missing_data_request_id?: string | null
}

export type RiskSignal = {
  id: string
  label: string
  severity: 'high' | 'medium' | 'low'
  source: string
  date: string | null
  summary: string
}

export type WorkspaceResponse = {
  patient: PatientReview
  state: PatientReview['state']
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
  }
  cmo_output: {
    problems: HealthProblem[]
    medications: MedicationReview[]
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
