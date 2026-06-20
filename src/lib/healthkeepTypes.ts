// HealthKeep entity types — aligned with API Contract v2 §4 schemas.
// JSON fields use snake_case to match backend; only client-side derived
// fields (riskLevel, healthScore etc. in clinical.ts) use camelCase.

// ── Tier / status enums ──────────────────────────────────────────────────────

export type ProblemStatus = 'underlying' | 'following' | 'resolved'
export type Tier = 1 | 2 | 3
export type AllergyStatus = 'confirmed' | 'suspected' | 'not_sure' | 'ruled_out'
export type ChangeRequestStatus = 'draft' | 'pending_review' | 'accepted' | 'modified_and_accepted' | 'rejected' | 'withdrawn' | 'needs_clarification' | 'needs_secondary_review'
export type CmoAcceptPublishMode = 'publish_now' | 'verify_draft' | 'verify_needs_secondary_review'
export type ChangeRequestAction = 'create' | 'update' | 'delete' | 'state_change' | 'link' | 'unlink' | 'reminder_create' | 'reminder_update' | 'reminder_delete'
export type ChangeRequestTargetType = 'problem' | 'condition' | 'allergy' | 'medication_regimen' | 'medication_event' | 'vaccine' | 'measurement' | 'appointment' | 'reminder' | 'family_medical_history' | 'patient_profile' | 'source_document' | 'other'
export type ReminderType = 'follow_up' | 'health_check' | 'screening' | 'vaccine' | 'medication_refill' | 'measurement' | 'document_upload' | 'custom'
export type ReminderSource = 'patient_created' | 'cmo_created' | 'system_rule' | 'imported'

// ── Problem (API Contract §4.3) ─────────────────────────────────────────────

export interface Problem {
  id: string
  patient_id: string
  icd10_code: string | null
  icd10_code_secondary: string[]
  display_name: string
  display_layman: string | null
  status: ProblemStatus
  is_suspected: boolean
  tier: Tier
  onset_date: string | null
  resolution_date: string | null
  recurrence_note: string | null
  cmo_note: string | null
  cmo_flags: string[]
  is_verified: boolean
  verified_by: string | null
  verified_at: string | null
  is_published: boolean
  published_at: string | null
  last_active_at: string
  // ── Convenience back-pointers for the snapshot drawer (POV view) ──
  source_document_ids: string[]
  linked_condition_count: number
  linked_medication_count: number
  linked_lab_count: number
}

// ── SourceDocument (API Contract §4.13) ─────────────────────────────────────

export type SourceType =
  | 'nhi_html' | 'paper_scan' | 'photo' | 'manual_entry' | 'voice' | 'dicom'

export interface SourceDocument {
  id: string
  patient_id: string
  source_type: SourceType
  original_filename: string
  mime_type: string
  file_size_bytes: number
  status: 'received' | 'parsing' | 'parsed' | 'failed' | 'deleted'
  ocr_status: 'pending' | 'done' | 'failed' | null
  created_at: string
}

// ── Allergy (API Contract §4.10) — used for Critical Red Zone ───────────────

export interface Allergy {
  id: string
  patient_id: string
  substance: string
  category: 'drug' | 'food' | 'environment' | 'other'
  reaction_description: string | null
  severity: 'mild' | 'moderate' | 'severe' | 'anaphylaxis' | null
  status: AllergyStatus
  tier: Tier
  verified: boolean
}

export interface PatientChangeRequest {
  id: string
  patient_id: string
  requester_user_id: string
  target_type: ChangeRequestTargetType
  target_id: string | null
  member_name?: string | null
  target_label?: string
  action: ChangeRequestAction
  current_snapshot: Record<string, unknown> | null
  proposed_payload: Record<string, unknown>
  patient_note: string | null
  status: ChangeRequestStatus
  reviewed_by: string | null
  reviewed_at: string | null
  reviewer_note: string | null
  review_metadata?: { publish_mode?: CmoAcceptPublishMode }
  requested_action?: string
  patient_facing_note?: string | null
  action_url?: string
  available_actions?: string[]
  priority?: 'high' | 'medium' | 'low'
  created_at: string
  updated_at: string
  withdrawn_at: string | null
}

export interface Reminder {
  id: number | string
  patient_id?: string
  user_id?: string
  member_name?: string
  problem_id?: number | string | null
  type: ReminderType
  reminder_type?: ReminderType
  title: string
  description?: string | null
  due_date?: string | null
  scheduled_date?: string | null
  recurrence_rule?: string | null
  repeat_type?: string | null
  source: ReminderSource
  is_patient_managed: boolean
  is_verified?: boolean
  status: 'active' | 'completed' | 'dismissed' | 'deleted'
  is_done?: boolean
  note?: string | null
  clinic?: string | null
  doctor?: string | null
  room?: string | null
  time?: string | null
  color?: string | null
  conclusion?: string | null
  visit_types?: string[]
  created_at: string
  updated_at?: string | null
  deleted_at?: string | null
}

// ── CMO Workbench queue typing (API Contract §7.1) ──────────────────────────
// Categories from CMO Intake Console Spec §3 Stage 1 (Workbench queue types).

export type QueueCategory =
  | 'ocr_pending'     // OCR 待確認 — drafts from photo/scan need CMO review
  | 'nhi_review'      // NHI 複核 — drafts auto-extracted from health-passbook
  | 'user_change_request' // 使用者資料異動 — patient-submitted edits
  | 'new_patient'     // 新客戶 — first-time intake
  | 'awaiting_review' // 待審 — generic CMO queue
  | 'awaiting_publish' // 待發布 — verified problems waiting for publish gate
  | 'awaiting_customer' // 待客戶確認 — published but unread by patient

export const QUEUE_CATEGORY_LABEL: Record<QueueCategory, string> = {
  ocr_pending:        'OCR 待確認',
  nhi_review:         'NHI 複核',
  user_change_request:'使用者異動',
  new_patient:        '新客戶',
  awaiting_review:    '待 CMO 複核',
  awaiting_publish:   '待發布',
  awaiting_customer:  '待客戶確認',
}

// ── Drawer-open context (for back navigation / traceability) ────────────────

export type DrawerOrigin =
  | 'priority'      // Top priority patients table
  | 'worklist'      // Clinical worklist
  | 'alert'         // Clinical alert center
  | 'cohort'        // After cohort filter
  | 'action'        // From clinical action item
  | 'url'           // Direct URL deep link (?patient=...)

export const DRAWER_ORIGIN_LABEL: Record<DrawerOrigin, string> = {
  priority: 'Top priority queue',
  worklist: 'Clinical worklist',
  alert:    'Alert center',
  cohort:   'Cohort filter',
  action:   'Action items',
  url:      'Deep link',
}

// ── Adapter helpers (for future API integration) ────────────────────────────
// Keep these tiny — they are intentionally identity passthroughs today since
// the backend already serializes snake_case. When the API switches to camel
// in the future, swap implementations here without touching call sites.

export function adaptProblem(raw: unknown): Problem | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as Problem
}

export function adaptSourceDocument(raw: unknown): SourceDocument | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as SourceDocument
}
