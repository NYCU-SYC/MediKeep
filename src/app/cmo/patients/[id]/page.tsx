'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { normalizeMemberName, uniqueMemberNames } from '@/lib/members'
import PatientContentEntryLauncher, { sendToPatientContentPanel } from './_components/PatientContentEntryDrawer'

type TabKey = 'overview' | 'fill' | 'requests' | 'problems' | 'readiness' | 'records' | 'documents' | 'imaging' | 'audit'
type ProblemFilter = 'all' | 'open' | 'verified' | 'published'
type ProblemStatus = 'underlying' | 'following' | 'resolved'
type PublishMode = 'publish_now' | 'verify_draft' | 'verify_needs_secondary_review'
type SourceAssignmentTargetType = 'problem' | 'condition' | 'medication' | 'allergy'
type DocumentStatusAction = 'needs_review' | 'confirmed' | 'rejected' | 'failed'

interface Problem {
  id: number
  member_name?: string | null
  icd10_code: string | null
  display_name: string
  display_layman: string | null
  status: string
  is_suspected: boolean
  tier: number
  is_verified: boolean
  is_published: boolean
  cmo_note: string | null
  source_document_id?: string | null
  onset_date?: string | null
}

interface UnlinkedCondition {
  id: number
  member_name?: string | null
  icd10_code?: string | null
  display_name?: string | null
  status?: string | null
  note?: string | null
  is_verified?: boolean
  is_published?: boolean
  source_document_id?: string | null
}

interface UnlinkedMedication {
  id: number
  drug_name: string
  dose?: string | null
  frequency?: string | null
  intent?: string | null
  note?: string | null
}

interface UnlinkedItems {
  conditions: UnlinkedCondition[]
  medications: UnlinkedMedication[]
}

interface Medication {
  id: number
  member_name: string
  drug_name: string
  dose?: string | null
  frequency?: string | null
  intent?: string | null
  note?: string | null
  is_active: boolean
  is_verified?: boolean
  is_published?: boolean
  source_document_id?: string | null
}

interface HealthRecord {
  id: string
  member_name: string
  record_type: string
  value1: string | null
  value2: string | null
  unit: string | null
  note: string | null
  recorded_at: string | null
}

interface Reminder {
  id: number
  member_name: string
  title: string
  scheduled_date?: string | null
  repeat_type?: string | null
  is_done: boolean
  note?: string | null
  created_at?: string | null
}

interface ChangeRequest {
  id: string
  patient_id: string
  target_type: string
  target_id: string | null
  member_name?: string | null
  target_label?: string
  action: string
  current_snapshot: Record<string, unknown> | null
  proposed_payload: Record<string, unknown>
  patient_note: string | null
  status: 'draft' | 'pending_review' | 'accepted' | 'modified_and_accepted' | 'rejected' | 'withdrawn' | 'needs_clarification' | 'needs_secondary_review'
  reviewer_note: string | null
  review_metadata?: { publish_mode?: PublishMode }
  requested_action?: string
  patient_facing_note?: string | null
  action_url?: string
  available_actions?: string[]
  priority?: 'high' | 'medium' | 'low'
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

interface ReportedState {
  id: string
  patient_id: string
  reported_by: string
  target_type: string
  target_id: string | null
  reported_status: string
  reported_payload: Record<string, unknown>
  note: string | null
  source_document_id: string | null
  reconciliation_status: string
  reconciled_by: string | null
  reconciled_at: string | null
  reviewer_note: string | null
  created_at: string | null
  updated_at: string | null
  withdrawn_at: string | null
}

interface HealthDocument {
  id: string
  member_name: string
  doc_type: string
  file_name: string
  file_size: number | null
  note: string | null
  doc_date: string | null
  status?: string | null
  processing_status?: string | null
  processing_status_label?: string | null
  processing_note?: string | null
  next_action?: string | null
  source?: string | null
  is_verified?: boolean
  linked_to_verified_data?: boolean
  hidden_from_patient?: boolean
  patient_visible?: boolean
  assignment_counts?: {
    problem: number
    condition: number
    medication_regimen: number
    allergy: number
    total: number
  }
  linked_targets?: Array<{
    type: string
    id: number
    label: string
    status?: string | null
  }>
  created_at: string | null
}

interface DicomStudy {
  id: string
  member_name: string
  modality: string | null
  study_description: string | null
  study_date: string | null
  series_count: number
  instance_count: number
  created_at: string | null
}

interface AuditEntry {
  id: string
  actor_type: string
  actor_id: string
  action: string
  target_type: string
  target_id: string | null
  target_label: string
  status: string
  created_at: string | null
  undo_available: boolean
  snapshot: Record<string, unknown>
}

interface PatientData {
  user: {
    id: string
    patient_public_id?: string
    display_name: string
    age?: number | null
    sex?: string | null
    blood_type?: string | null
    last_edited?: string | null
    verification_summary?: { verified: number; published: number; total: number }
  }
  problems: Problem[]
  conditions: UnlinkedCondition[]
  medications: Medication[]
  reminders?: Reminder[]
  change_requests?: ChangeRequest[]
  records: HealthRecord[]
  documents: HealthDocument[]
  dicom_studies: DicomStudy[]
}

interface ProblemForm {
  display_name: string
  display_layman: string
  icd10_code: string
  status: ProblemStatus
  tier: 1 | 2 | 3
  is_suspected: boolean
  onset_date: string
  cmo_note: string
}

interface ConditionForm {
  display_name: string
  icd10_code: string
  status: 'active' | 'resolved'
  onset_date: string
  note: string
  sync_problem: boolean
}

interface MedicationForm {
  drug_name: string
  dose: string
  frequency: string
  intent: 'chronic' | 'acute' | 'prn'
  started_on: string
  ended_on: string
  is_active: boolean
  note: string
}

interface ReminderForm {
  title: string
  scheduled_date: string
  repeat_type: 'none' | 'monthly' | 'yearly'
  note: string
}

interface RecordForm {
  record_type: string
  value1: string
  value2: string
  unit: string
  recorded_at: string
  note: string
}

interface SourceAssignmentForm {
  source_document_id: string
  target_type: SourceAssignmentTargetType
  target_id: string
  note: string
}

interface SourceAssignmentTarget {
  type: SourceAssignmentTargetType
  id: number
  label: string
  detail: string
  source_document_id?: string | null
}

interface DocumentStatusForm {
  document_id: string
  status: DocumentStatusAction
  note: string
}

interface ConceptMetric {
  diagnoses: number
  medications: number
  labs: number
  measurements: number
  documents: number
}

interface CriticalSummary {
  tier1: {
    drug_allergies: Array<{ id: number; substance: string; source_document_id?: string | null }>
    food_allergies: Array<{ id: number; substance: string; source_document_id?: string | null }>
    contrast_allergies: Array<{ id: number; substance: string; source_document_id?: string | null }>
    high_risk_medications: Array<{ id: number; drug_name: string; dose?: string | null; frequency?: string | null }>
    implants: Array<{ id: number; type: string; model?: string | null }>
    renal_function: { egfr: number | null; ckd_stage: string | null; is_dialysis: boolean; dialysis_schedule: string | null } | null
  }
  tier2: {
    blood_type: string | null
    underlying_diseases: Array<{ id: number; display_name: string; icd10_code: string | null; tier: number }>
    has_hep_b: boolean
    has_hep_c: boolean
    emergency_contact: { name: string; relation: string | null; phone: string | null } | null
  }
}

const RECORD_LABELS: Record<string, string> = { blood_pressure: '血壓', heart_rate: '心率', glucose: '血糖', weight: '體重', steps: '步數', sleep: '睡眠', bmi: 'BMI', body_fat: '體脂', temperature: '體溫', spo2: '血氧', hba1c: 'HbA1c' }
const DOC_LABELS: Record<string, string> = { lab_report: '檢驗報告', prescription: '處方', discharge: '出院摘要', image: '影像', other: '其他' }
const PROBLEM_TEMPLATES: Array<Pick<ProblemForm, 'display_name' | 'display_layman' | 'icd10_code' | 'status' | 'tier'> & { label: string }> = [
  { label: '高血壓', display_name: 'Hypertension', display_layman: '高血壓（血管壓力長期偏高）', icd10_code: 'I10', status: 'underlying', tier: 2 },
  { label: '糖尿病', display_name: 'Type 2 diabetes mellitus', display_layman: '第二型糖尿病（血糖長期偏高）', icd10_code: 'E11.9', status: 'underlying', tier: 2 },
  { label: '高血脂', display_name: 'Hyperlipidemia', display_layman: '高血脂（血液中的油脂偏高）', icd10_code: 'E78.5', status: 'underlying', tier: 2 },
  { label: 'CKD', display_name: 'Chronic kidney disease', display_layman: '慢性腎臟病（腎功能需要長期追蹤）', icd10_code: 'N18.9', status: 'underlying', tier: 1 },
  { label: '疑似心房顫動', display_name: 'Suspected atrial fibrillation', display_layman: '疑似心房顫動（心跳節律可能不規則）', icd10_code: 'I48.91', status: 'following', tier: 1 },
]
const CONDITION_TEMPLATES = PROBLEM_TEMPLATES.map((item) => ({ label: item.label, display_name: item.display_layman, icd10_code: item.icd10_code }))
const MEDICATION_TEMPLATES: Array<Pick<MedicationForm, 'drug_name' | 'dose' | 'frequency' | 'intent' | 'note'> & { label: string }> = [
  { label: '降壓藥', drug_name: 'Amlodipine', dose: '5 mg', frequency: '每日一次', intent: 'chronic', note: '由 CMO 依來源資料確認，病人端僅顯示用藥摘要。' },
  { label: '降血脂', drug_name: 'Atorvastatin', dose: '20 mg', frequency: '每日一次', intent: 'chronic', note: '需於回診時確認持續服用狀態。' },
  { label: '糖尿病', drug_name: 'Metformin', dose: '500 mg', frequency: '每日兩次', intent: 'chronic', note: '依 NHI/藥袋資料整理，劑量異動需 CMO 確認。' },
  { label: 'PRN 止痛', drug_name: 'Acetaminophen', dose: '500 mg', frequency: '需要時服用', intent: 'prn', note: 'PRN 用藥，病人端不提供自行調藥建議。' },
]
const FOLLOWUP_TEMPLATES: Array<Pick<ReminderForm, 'title' | 'repeat_type' | 'note'> & { label: string }> = [
  { label: '心臟科回診', title: '心臟科回診', repeat_type: 'none', note: '回診日前提醒，確認最近血壓、心跳與用藥清單。' },
  { label: '抽血追蹤', title: '抽血追蹤', repeat_type: 'none', note: '依醫囑或報告建議追蹤，病人端顯示提醒不提供診斷。' },
  { label: '藥袋上傳', title: '回診後上傳藥袋照片', repeat_type: 'none', note: '用於 CMO 更新 medication regimen。' },
  { label: '年度健檢', title: '年度健康檢查', repeat_type: 'yearly', note: '預防性追蹤提醒。' },
]
const NOTE_TEMPLATES = [
  '由 NHI/parser 匯入後 CMO 確認。',
  '來源文件仍需補齊，先標記為 following。',
  '病人端只顯示白話摘要；CMO note 不發布。',
  '下次回診需確認目前狀態與用藥。',
]
const RECORD_TYPE_OPTIONS = [
  { value: 'blood_pressure', label: '血壓', unit: 'mmHg' },
  { value: 'glucose', label: '血糖', unit: 'mg/dL' },
  { value: 'hba1c', label: 'HbA1c', unit: '%' },
  { value: 'weight', label: '體重', unit: 'kg' },
  { value: 'egfr', label: 'eGFR', unit: 'mL/min/1.73m2' },
  { value: 'temperature', label: '體溫', unit: 'C' },
]
const SOURCE_ASSIGNMENT_TARGET_TYPES: Array<{ value: SourceAssignmentTargetType; label: string }> = [
  { value: 'problem', label: 'Problem' },
  { value: 'condition', label: 'Condition' },
  { value: 'medication', label: 'Medication regimen' },
  { value: 'allergy', label: 'Red-zone allergy' },
]
const DOCUMENT_STATUS_ACTIONS: Array<{ value: DocumentStatusAction; label: string; help: string }> = [
  { value: 'needs_review', label: '需要人工確認', help: '內容可讀但尚未能作為整理依據。' },
  { value: 'confirmed', label: '文件可作為整理依據', help: '只確認文件處理狀態，不代表 clinical row 已驗證。' },
  { value: 'rejected', label: '退件或需補件', help: '文件不適合作為病歷整理依據。' },
  { value: 'failed', label: '處理失敗', help: '格式、畫質或檔案損毀導致無法處理。' },
]

const PUBLISH_MODE_COPY: Record<PublishMode, { label: string; help: string; submit: string }> = {
  publish_now: {
    label: 'Accept & Publish now',
    help: '病人端會立即看到正式資料。',
    submit: 'Accept modified & publish',
  },
  verify_draft: {
    label: 'Accept as verified draft',
    help: '只在 CMO Panel 中可見，病人端暫時看不到。',
    submit: 'Accept modified as draft',
  },
  verify_needs_secondary_review: {
    label: 'Mark for secondary review',
    help: '保留在 queue 中，需再次確認。',
    submit: 'Send to secondary review',
  },
}

const CHANGE_REQUEST_STATUS_COPY: Record<string, { label: string; bg: string; fg: string; help: string }> = {
  draft: { label: 'Draft', bg: '#f8fafc', fg: '#475569', help: 'Patient has not submitted this request.' },
  pending_review: { label: 'Pending CMO review', bg: '#fef3c7', fg: '#a16207', help: 'Review, edit, accept, reject, or ask for clarification.' },
  needs_clarification: { label: 'Waiting for User', bg: '#fff7ed', fg: '#c2410c', help: 'User sees this as a clarification task.' },
  needs_secondary_review: { label: 'Secondary review', bg: '#fefce8', fg: '#854d0e', help: 'Keep out of Patient View until reviewed again.' },
  accepted: { label: 'Accepted', bg: '#ecfdf5', fg: '#047857', help: 'Accepted by CMO.' },
  modified_and_accepted: { label: 'Modified + accepted', bg: '#ecfdf5', fg: '#047857', help: 'CMO changed the final value before accepting.' },
  rejected: { label: 'Rejected', bg: '#fff1f2', fg: '#be123c', help: 'Not applied to official data.' },
  withdrawn: { label: 'Withdrawn', bg: '#f8fafc', fg: '#64748b', help: 'User withdrew this request.' },
}

const REQUEST_ACTION_LABELS: Record<string, string> = {
  upload_clearer_photo: 'Upload clearer photo',
  provide_date: 'Provide date',
  provide_hospital: 'Provide hospital / clinic',
  confirm_medication_name: 'Confirm medication name',
  confirm_whether_taking: 'Confirm whether taking',
  confirm_follow_up_date: 'Confirm follow-up date',
  confirm_allergy_reaction: 'Confirm allergy reaction',
  provide_note: 'Provide note',
  upload_document: 'Upload source document',
}

const HIGH_RISK_REQUEST_TARGETS = new Set(['problem', 'condition', 'allergy', 'medication_regimen', 'medication_event'])

function defaultPublishModeForRequest(request: ChangeRequest): PublishMode {
  if (request.target_type === 'reminder' || request.target_type === 'appointment') return 'publish_now'
  return HIGH_RISK_REQUEST_TARGETS.has(request.target_type) ? 'verify_draft' : 'publish_now'
}

function editorFieldsFor(targetType: string): string[] {
  if (targetType === 'problem' || targetType === 'condition') return ['display_name', 'display_layman', 'status', 'is_suspected', 'onset_date', 'tier', 'problem_id']
  if (targetType === 'allergy') return ['substance', 'category', 'reaction', 'severity', 'status', 'tier']
  if (targetType === 'reminder' || targetType === 'appointment') return ['title', 'type', 'due_date', 'recurrence_rule', 'problem_id', 'source', 'is_patient_managed', 'status']
  if (targetType === 'medication_regimen' || targetType === 'medication_event') return ['display_name', 'drug_name', 'dose', 'frequency', 'route', 'start_date', 'end_date', 'status', 'problem_id']
  return []
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function requestStatusCopy(request: ChangeRequest) {
  return CHANGE_REQUEST_STATUS_COPY[request.status] ?? CHANGE_REQUEST_STATUS_COPY.pending_review
}

function requestTargetLabel(request: ChangeRequest) {
  return request.target_label
    || String(request.proposed_payload?.target_label ?? '')
    || String(request.current_snapshot?.display_layman ?? request.current_snapshot?.display_name ?? request.current_snapshot?.drug_name ?? request.current_snapshot?.substance ?? request.current_snapshot?.title ?? '')
    || `${request.target_type}${request.target_id ? ` #${request.target_id}` : ''}`
}

function requestNestedPayload(request: ChangeRequest, key: 'clarification_reply' | 'clarification_draft') {
  const value = request.proposed_payload?.[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requestClarificationQuestion(request: ChangeRequest) {
  return String(request.proposed_payload?.question || request.patient_facing_note || request.reviewer_note || '')
}

function requestActionLabel(request: ChangeRequest) {
  const action = request.requested_action || String(request.proposed_payload?.requested_action || '')
  return action ? REQUEST_ACTION_LABELS[action] ?? action : 'Provide note'
}

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== '' && value !== undefined))
}

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return await api.get(url) as T
  } catch {
    return fallback
  }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '未記錄'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function todayInputDate() {
  return new Date().toISOString().slice(0, 10)
}

function nowInputDateTime() {
  return new Date().toISOString().slice(0, 16)
}

function defaultProblemForm(): ProblemForm {
  return {
    display_name: '',
    display_layman: '',
    icd10_code: '',
    status: 'following',
    tier: 3,
    is_suspected: false,
    onset_date: '',
    cmo_note: '',
  }
}

function defaultConditionForm(): ConditionForm {
  return {
    display_name: '',
    icd10_code: '',
    status: 'active',
    onset_date: '',
    note: '',
    sync_problem: true,
  }
}

function defaultMedicationForm(): MedicationForm {
  return {
    drug_name: '',
    dose: '',
    frequency: '每日一次',
    intent: 'chronic',
    started_on: todayInputDate(),
    ended_on: '',
    is_active: true,
    note: '',
  }
}

function defaultReminderForm(): ReminderForm {
  return {
    title: '',
    scheduled_date: todayInputDate(),
    repeat_type: 'none',
    note: '',
  }
}

function defaultRecordForm(): RecordForm {
  return {
    record_type: 'blood_pressure',
    value1: '',
    value2: '',
    unit: 'mmHg',
    recorded_at: nowInputDateTime(),
    note: '',
  }
}

function defaultSourceAssignment(): SourceAssignmentForm {
  return {
    source_document_id: '',
    target_type: 'problem',
    target_id: '',
    note: '',
  }
}

function defaultDocumentStatusForm(): DocumentStatusForm {
  return {
    document_id: '',
    status: 'needs_review',
    note: '',
  }
}

function formatRecordValue(record: HealthRecord) {
  if (record.record_type === 'blood_pressure' && record.value1 && record.value2) return `${record.value1}/${record.value2} ${record.unit ?? 'mmHg'}`
  return `${record.value1 ?? '-'}${record.unit ? ` ${record.unit}` : ''}`
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function sourceDocumentLabel(doc: HealthDocument) {
  return `${formatDate(doc.doc_date ?? doc.created_at)} · ${DOC_LABELS[doc.doc_type] ?? doc.doc_type} · ${doc.file_name}`
}

function sourceTargetTypeLabel(type: string) {
  if (type === 'condition') return 'Condition'
  if (type === 'medication_regimen') return 'Medication regimen'
  return SOURCE_ASSIGNMENT_TARGET_TYPES.find((item) => item.value === type)?.label ?? type
}

function documentProcessingTone(status: string | null | undefined) {
  if (status === 'confirmed') return { bg: '#ecfdf5', fg: '#047857', label: 'Confirmed' }
  if (status === 'needs_review') return { bg: '#fff7ed', fg: '#c2410c', label: 'Needs review' }
  if (status === 'failed' || status === 'rejected') return { bg: '#fff1f2', fg: '#be123c', label: status === 'failed' ? 'Failed' : 'Rejected' }
  if (status === 'extracting' || status === 'queued') return { bg: '#eff6ff', fg: '#1d4ed8', label: status === 'extracting' ? 'Extracting' : 'Queued' }
  return { bg: '#f8fafc', fg: '#475569', label: 'Uploaded' }
}

function visibilityTone(doc: HealthDocument) {
  if (doc.patient_visible === false || doc.hidden_from_patient) return { bg: '#fff7ed', fg: '#c2410c', label: 'Hidden from patient' }
  return { bg: '#ecfdf5', fg: '#047857', label: 'Patient visible' }
}

function tierStyle(tier: number) {
  if (tier <= 1) return { bg: '#fff1f2', fg: '#be123c', label: 'T1' }
  if (tier === 2) return { bg: '#fef3c7', fg: '#a16207', label: 'T2' }
  return { bg: '#ecfdf5', fg: '#047857', label: `T${tier}` }
}

function statusLabel(status: string) {
  if (status === 'resolved') return '已解決'
  if (status === 'following') return '追蹤中'
  if (status === 'underlying') return '慢性/長期'
  return '目前問題'
}

function conceptMetrics(problem: Problem, data: PatientData, meds: Medication[]): ConceptMetric {
  const code = problem.icd10_code ?? ''
  const recordTypes = code.startsWith('I10') ? ['blood_pressure', 'heart_rate'] : code.startsWith('E78') ? ['ldl', 'hdl', 'cholesterol'] : code.startsWith('E1') ? ['glucose', 'hba1c', 'weight'] : []
  const labs = data.records.filter((record) => ['ldl', 'hdl', 'cholesterol', 'egfr', 'creatinine', 'glucose', 'hba1c'].includes(record.record_type) && (!recordTypes.length || recordTypes.includes(record.record_type))).length
  const measurements = data.records.filter((record) => ['blood_pressure', 'heart_rate', 'weight', 'spo2', 'temperature'].includes(record.record_type) && (!recordTypes.length || recordTypes.includes(record.record_type))).length
  const relatedMeds = meds.filter((med) => `${med.drug_name} ${med.intent ?? ''} ${med.note ?? ''}`.toLowerCase().includes(problem.display_name.toLowerCase()) || (code.startsWith('I10') && /amlodipine|壓/i.test(med.drug_name)) || (code.startsWith('E78') && /statin|脂/i.test(med.drug_name))).length
  return {
    diagnoses: data.conditions.filter((condition) => condition.icd10_code === code || condition.display_name === problem.display_name).length,
    medications: relatedMeds,
    labs,
    measurements,
    documents: data.documents.filter((doc) => ['lab_report', 'prescription', 'discharge'].includes(doc.doc_type)).length,
  }
}

function problemReadiness(problem: Problem) {
  const items = [
    { key: 'verified', label: 'Problem verified', done: problem.is_verified },
    { key: 'wording', label: 'Patient wording ready', done: Boolean(problem.display_layman) },
    { key: 'status', label: 'Status checked', done: ['underlying', 'following', 'resolved'].includes(problem.status) },
    { key: 'published', label: 'Published gate', done: problem.is_published },
  ]
  return {
    items,
    done: items.filter((item) => item.done).length,
    total: items.length,
  }
}

function readinessChecklist(data: PatientData, critical: CriticalSummary | null, unlinked: UnlinkedItems) {
  const problems = data.problems
  const allVerified = problems.length > 0 && problems.every((problem) => problem.is_verified)
  const lowReadiness = problems.filter((problem) => {
    const readiness = problemReadiness(problem)
    return readiness.done < readiness.total
  }).length
  const unlinkedCount = unlinked.conditions.length + unlinked.medications.length
  return [
    { label: 'Patient identity visible', done: Boolean(data.user.patient_public_id || data.user.id), detail: data.user.patient_public_id ?? data.user.id.slice(0, 8) },
    { label: 'Critical Red Zone loaded', done: Boolean(critical), detail: critical ? 'Tier 1/2/3 panel available' : 'Red Zone API pending' },
    { label: 'Problems verified', done: allVerified, detail: `${problems.filter((problem) => problem.is_verified).length}/${problems.length}` },
    { label: 'Unlinked items reviewed', done: unlinkedCount === 0, detail: `${unlinkedCount} item${unlinkedCount === 1 ? '' : 's'} need review` },
    { label: 'Patient wording generated', done: problems.every((problem) => Boolean(problem.display_layman) || !problem.is_published), detail: 'display_layman for patient-facing cards' },
    { label: 'CMO-only fields hidden', done: true, detail: 'Patient API strips cmo_note / cmo_flags' },
    { label: 'Source traceability available', done: data.records.length + data.documents.length + data.dicom_studies.length > 0, detail: `${data.records.length + data.documents.length + data.dicom_studies.length} source-facing rows` },
    { label: 'Publish readiness', done: lowReadiness === 0, detail: `${lowReadiness} problem${lowReadiness === 1 ? '' : 's'} incomplete` },
  ]
}

function StatCard({ label, value, note, tone }: { label: string; value: number | string; note: string; tone: string }) {
  return (
    <div className="cmo-card cmo-kpi">
      <div className="cmo-kpi-label">{label}</div>
      <div className="cmo-kpi-value" style={{ color: tone }}>{value}</div>
      <div className="cmo-subtitle" style={{ marginTop: 8 }}>{note}</div>
    </div>
  )
}

function EmptyState({ children }: { children: string }) {
  return <div className="cmo-card cmo-section cmo-muted" style={{ textAlign: 'center' }}>{children}</div>
}

function CmoPageState({
  eyebrow,
  title,
  body,
  tone = 'info',
  action,
}: {
  eyebrow: string
  title: string
  body: string
  tone?: 'info' | 'error' | 'empty'
  action?: ReactNode
}) {
  const colors = tone === 'error'
    ? { border: '#fecaca', bg: '#fff1f2', fg: '#be123c' }
    : tone === 'empty'
      ? { border: '#e2e8f0', bg: '#f8fafc', fg: '#475569' }
      : { border: '#bfdbfe', bg: '#eff6ff', fg: '#1d4ed8' }
  return (
    <div className="cmo-page">
      <div className="cmo-card cmo-section" style={{ maxWidth: 760, margin: '30px auto 0', borderColor: colors.border, background: colors.bg }}>
        <div className="cmo-kpi-label" style={{ color: colors.fg }}>{eyebrow}</div>
        <div className="cmo-title" style={{ marginTop: 8 }}>{title}</div>
        <div className="cmo-subtitle" style={{ lineHeight: 1.65 }}>{body}</div>
        {action && <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>{action}</div>}
      </div>
    </div>
  )
}

function CmoLoadingSkeleton() {
  return (
    <div className="cmo-page" aria-busy="true">
      <div className="cmo-card cmo-section">
        <div className="cmo-kpi-label">Patient POV</div>
        <div className="cmo-title" style={{ marginTop: 8 }}>正在整理病患資訊</div>
        <div className="cmo-subtitle">載入紅區資料、Problem、健康紀錄、文件與影像。</div>
        <div className="cmo-skeleton-grid" style={{ marginTop: 16 }}>
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="cmo-skeleton-card" />)}
        </div>
      </div>
    </div>
  )
}

export default function PatientPovPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<PatientData | null>(null)
  const [critical, setCritical] = useState<CriticalSummary | null>(null)
  const [unlinked, setUnlinked] = useState<UnlinkedItems>({ conditions: [], medications: [] })
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [reportedStates, setReportedStates] = useState<ReportedState[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [query, setQuery] = useState('')
  const [problemFilter, setProblemFilter] = useState<ProblemFilter>('all')
  const [busyProblem, setBusyProblem] = useState<number | null>(null)
  const [entryBusy, setEntryBusy] = useState('')
  const [flash, setFlash] = useState('')
  const [lastActionAuditId, setLastActionAuditId] = useState<string | null>(null)
  const [reviewerNotes, setReviewerNotes] = useState<Record<string, string>>({})
  const [reportedStateNotes, setReportedStateNotes] = useState<Record<string, string>>({})
  const [problemForm, setProblemForm] = useState<ProblemForm>(defaultProblemForm)
  const [conditionForm, setConditionForm] = useState<ConditionForm>(defaultConditionForm)
  const [medicationForm, setMedicationForm] = useState<MedicationForm>(defaultMedicationForm)
  const [reminderForm, setReminderForm] = useState<ReminderForm>(defaultReminderForm)
  const [recordForm, setRecordForm] = useState<RecordForm>(defaultRecordForm)
  const [sourceAssignment, setSourceAssignment] = useState<SourceAssignmentForm>(defaultSourceAssignment)
  const [selectedMember, setSelectedMember] = useState('全部')

  const loadData = useCallback(async () => {
    setLoadError('')
    setLoading(true)
    try {
      const patient = await api.get(`/api/cmo/patients/${id}`) as PatientData | null
      const [redzone, unlinkedItems, auditItems, reportedItems] = await Promise.all([
        fetchJson<CriticalSummary | null>(`/api/cmo/patients/${id}/critical-summary`, null),
        fetchJson<UnlinkedItems>(`/api/cmo/patients/${id}/unlinked`, { conditions: [], medications: [] }),
        fetchJson<AuditEntry[]>(`/api/cmo/patients/${id}/audit-log`, []),
        fetchJson<ReportedState[]>(`/api/cmo/patient-reported-states?patient_id=${id}&status=active_patient_reported,needs_clarification`, []),
      ])
      setData(patient)
      setCritical(redzone)
      setUnlinked(unlinkedItems)
      setAuditLog(auditItems)
      setReportedStates(reportedItems)
    } catch (error) {
      setData(null)
      setLoadError(error instanceof Error ? error.message : 'CMO patient data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    let alive = true
    setLoadError('')
    setLoading(true)
    ;(async () => {
      try {
        const patient = await api.get(`/api/cmo/patients/${id}`) as PatientData | null
        const [redzone, unlinkedItems, auditItems, reportedItems] = await Promise.all([
          fetchJson<CriticalSummary | null>(`/api/cmo/patients/${id}/critical-summary`, null),
          fetchJson<UnlinkedItems>(`/api/cmo/patients/${id}/unlinked`, { conditions: [], medications: [] }),
          fetchJson<AuditEntry[]>(`/api/cmo/patients/${id}/audit-log`, []),
          fetchJson<ReportedState[]>(`/api/cmo/patient-reported-states?patient_id=${id}&status=active_patient_reported,needs_clarification`, []),
        ])
        if (!alive) return
        setData(patient)
        setCritical(redzone)
        setUnlinked(unlinkedItems)
        setAuditLog(auditItems)
        setReportedStates(reportedItems)
      } catch (error) {
        if (!alive) return
        setData(null)
        setLoadError(error instanceof Error ? error.message : 'CMO patient data could not be loaded.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash
      if (hash === '#publish-readiness' || hash === '#patient-facing-preview') {
        setActiveTab('readiness')
        window.setTimeout(() => document.querySelector(hash)?.scrollIntoView({ block: 'start' }), 80)
      }
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  const memberOptions = useMemo(() => {
    const names = uniqueMemberNames(
      ['本人'],
      data?.problems.map((item) => item.member_name),
      data?.conditions.map((item) => item.member_name),
      data?.medications.map((item) => item.member_name),
      data?.reminders?.map((item) => item.member_name),
      data?.records.map((item) => item.member_name),
      data?.documents.map((item) => item.member_name),
      data?.dicom_studies.map((item) => item.member_name),
    )
    return ['全部', ...names]
  }, [data])
  const memberMatches = useCallback((member?: string | null) => selectedMember === '全部' || normalizeMemberName(member) === selectedMember, [selectedMember])
  const scopedData = useMemo(() => {
    if (!data || selectedMember === '全部') return data
    return {
      ...data,
      problems: data.problems.filter((item) => memberMatches(item.member_name)),
      conditions: data.conditions.filter((item) => memberMatches(item.member_name)),
      medications: data.medications.filter((item) => memberMatches(item.member_name)),
      reminders: data.reminders?.filter((item) => memberMatches(item.member_name)),
      records: data.records.filter((item) => memberMatches(item.member_name)),
      documents: data.documents.filter((item) => memberMatches(item.member_name)),
      dicom_studies: data.dicom_studies.filter((item) => memberMatches(item.member_name)),
    }
  }, [data, memberMatches, selectedMember])
  const activeMedications = useMemo(() => scopedData?.medications.filter((med) => med.is_active) ?? [], [scopedData])
  const openReminders = useMemo(() => scopedData?.reminders?.filter((reminder) => !reminder.is_done) ?? [], [scopedData])
  const openProblems = useMemo(() => scopedData?.problems.filter((problem) => problem.status !== 'resolved') ?? [], [scopedData])
  const pendingProblems = useMemo(() => scopedData?.problems.filter((problem) => !problem.is_published || !problem.is_verified) ?? [], [scopedData])
  const pendingConditions = useMemo(() => scopedData?.conditions.filter((condition) => !condition.is_published) ?? [], [scopedData])
  const pendingMedicationPublishes = useMemo(() => scopedData?.medications.filter((medication) => !medication.is_published) ?? [], [scopedData])
  const pendingClinicalRows = pendingProblems.length + pendingConditions.length + pendingMedicationPublishes.length
  const openReportedStates = useMemo(
    () => reportedStates.filter((state) => state.reconciliation_status === 'active_patient_reported' || state.reconciliation_status === 'needs_clarification'),
    [reportedStates],
  )
  const changeRequests = useMemo(() => data?.change_requests ?? [], [data])
  const pendingChangeRequests = useMemo(() => changeRequests.filter((request) => request.status === 'pending_review'), [changeRequests])
  const readiness = useMemo(() => scopedData ? readinessChecklist(scopedData, critical, unlinked) : [], [critical, scopedData, unlinked])
  const readinessDone = useMemo(() => readiness.filter((item) => item.done).length, [readiness])
  const unlinkedCount = unlinked.conditions.length + unlinked.medications.length
  const criticalCount = useMemo(() => {
    if (!critical) return 0
    return critical.tier1.drug_allergies.length + critical.tier1.contrast_allergies.length + critical.tier1.implants.length + (critical.tier1.renal_function ? 1 : 0)
  }, [critical])
  const sourceAssignmentTargets = useMemo<SourceAssignmentTarget[]>(() => {
    if (!data) return []
    const allergyTargets: SourceAssignmentTarget[] = critical ? [
      ...critical.tier1.drug_allergies.map((item) => ({
        type: 'allergy' as const,
        id: item.id,
        label: item.substance,
        detail: 'Tier 1 drug allergy',
        source_document_id: item.source_document_id ?? null,
      })),
      ...critical.tier1.contrast_allergies.map((item) => ({
        type: 'allergy' as const,
        id: item.id,
        label: item.substance,
        detail: 'Tier 1 contrast allergy',
        source_document_id: item.source_document_id ?? null,
      })),
      ...critical.tier1.food_allergies.map((item) => ({
        type: 'allergy' as const,
        id: item.id,
        label: item.substance,
        detail: 'Tier 1 food allergy',
        source_document_id: item.source_document_id ?? null,
      })),
    ] : []

    return [
      ...(scopedData?.problems ?? data.problems).map((problem) => ({
        type: 'problem' as const,
        id: problem.id,
        label: problem.display_layman || problem.display_name,
        detail: `${problem.display_name} · ${problem.icd10_code ?? 'no ICD'} · ${statusLabel(problem.status)}`,
        source_document_id: problem.source_document_id ?? null,
      })),
      ...(scopedData?.conditions ?? data.conditions).map((condition) => ({
        type: 'condition' as const,
        id: condition.id,
        label: condition.display_name ?? `Condition #${condition.id}`,
        detail: [condition.icd10_code ?? 'no ICD', condition.status ?? 'no status', condition.is_published ? 'published' : 'not published'].join(' · '),
        source_document_id: condition.source_document_id ?? null,
      })),
      ...(scopedData?.medications ?? data.medications).map((medication) => ({
        type: 'medication' as const,
        id: medication.id,
        label: medication.drug_name,
        detail: [medication.dose, medication.frequency, medication.intent, medication.is_active ? 'active' : 'inactive'].filter(Boolean).join(' · '),
        source_document_id: medication.source_document_id ?? null,
      })),
      ...allergyTargets,
    ]
  }, [critical, data, scopedData])

  const visibleProblems = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (scopedData?.problems ?? []).filter((problem) => {
      const byFilter =
        problemFilter === 'all' ||
        (problemFilter === 'open' && problem.status !== 'resolved') ||
        (problemFilter === 'verified' && problem.is_verified) ||
        (problemFilter === 'published' && problem.is_published)
      const haystack = [problem.display_name, problem.display_layman ?? '', problem.icd10_code ?? '', problem.cmo_note ?? ''].join(' ').toLowerCase()
      return byFilter && (!term || haystack.includes(term))
    }).sort((a, b) => a.tier - b.tier || Number(a.is_published) - Number(b.is_published))
  }, [problemFilter, query, scopedData])

  const timeline = useMemo(() => {
    const records = (scopedData?.records ?? []).map((record) => ({
      id: record.id,
      kind: '紀錄',
      title: RECORD_LABELS[record.record_type] ?? record.record_type,
      detail: `${formatRecordValue(record)} · ${record.member_name}`,
      date: record.recorded_at,
    }))
    const documents = (scopedData?.documents ?? []).map((doc) => ({
      id: doc.id,
      kind: '文件',
      title: DOC_LABELS[doc.doc_type] ?? doc.doc_type,
      detail: `${doc.file_name}${doc.note ? ` · ${doc.note}` : ''}`,
      date: doc.doc_date ?? doc.created_at,
    }))
    const imaging = (scopedData?.dicom_studies ?? []).map((study) => ({
      id: study.id,
      kind: '影像',
      title: `${study.modality ?? 'DICOM'} ${study.study_description ?? ''}`.trim(),
      detail: `${study.series_count} series · ${study.instance_count} images`,
      date: study.created_at,
    }))
    return [...records, ...documents, ...imaging]
      .filter((item) => !query.trim() || `${item.title} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
  }, [query, scopedData])

  const handoffText = useMemo(() => {
    if (!data) return ''
    const allergies = critical?.tier1.drug_allergies.map((item) => item.substance).join(', ') || '無'
    const problems = openProblems.slice(0, 6).map((problem) => `${problem.display_name}${problem.icd10_code ? `(${problem.icd10_code})` : ''}`).join('; ') || '無'
    const meds = activeMedications.slice(0, 6).map((med) => med.drug_name).join(', ') || '無'
    const followUps = openReminders.slice(0, 3).map((reminder) => `${formatDate(reminder.scheduled_date)} ${reminder.title}`).join('; ') || '無'
    const latest = timeline.slice(0, 5).map((item) => `${formatDate(item.date)} ${item.kind}: ${item.title} ${item.detail}`).join('\n')
    return [
      `病患：${data.user.display_name}`,
      `資料範圍：${selectedMember === '全部' ? '全家 / 全帳號' : selectedMember}`,
      `紅區：藥物過敏 ${allergies}；血型 ${critical?.tier2.blood_type ?? '未填'}；緊急聯絡 ${critical?.tier2.emergency_contact?.name ?? '未填'}`,
      `Problem：${problems}`,
      `用藥：${meds}`,
      `回診/追蹤：${followUps}`,
      `待處理：${pendingClinicalRows} 筆 clinical row 仍需 verify/publish`,
      latest ? `近期資料：\n${latest}` : '近期資料：無',
    ].join('\n')
  }, [activeMedications, critical, data, openProblems, openReminders, pendingClinicalRows, selectedMember, timeline])

  const copyHandoff = async () => {
    if (!handoffText) return
    await navigator.clipboard.writeText(handoffText)
    notify('已複製交班摘要')
  }

  const verifyRedZoneAll = async () => {
    const ok = window.confirm([
      '這會把目前未確認的紅區項目批次標記為「已確認」。',
      '',
      '請只在你已逐項核對來源文件、日期與臨床意義後使用。',
      '這個動作不會自動完成逐欄 evidence 綁定，也不代表 AI/OCR 已正確擷取。',
      '',
      '確定要繼續嗎？',
    ].join('\n'))
    if (!ok) return
    setEntryBusy('verify-rz')
    try {
      const res = await api.post(`/api/cmo/patients/${id}/red-zone/verify-all`) as { total?: number }
      await loadData()
      notify(res?.total ? `已確認紅區 ${res.total} 項` : '紅區已全部確認')
    } finally {
      setEntryBusy('')
    }
  }

  const assignSourceDocument = async () => {
    const targetId = Number(sourceAssignment.target_id)
    if (!sourceAssignment.source_document_id || !sourceAssignment.target_id || !Number.isInteger(targetId)) {
      notify('請先選擇來源文件與要連結的 clinical row')
      return
    }
    setEntryBusy('source-assignment')
    try {
      await api.post(`/api/cmo/patients/${id}/source-assignments`, {
        source_document_id: sourceAssignment.source_document_id,
        target_type: sourceAssignment.target_type,
        target_id: targetId,
        note: sourceAssignment.note.trim() || null,
      })
      setSourceAssignment((prev) => ({ ...prev, target_id: '', note: '' }))
      await loadData()
      notify('已連結來源文件')
    } finally {
      setEntryBusy('')
    }
  }

  const updateDocumentStatus = async (doc: HealthDocument, status: DocumentStatusAction, note: string) => {
    const cleanNote = note.trim()
    if (cleanNote.length < 6) {
      notify('請輸入 CMO audit note')
      return
    }
    setEntryBusy(`doc-status-${doc.id}`)
    try {
      await api.patch(`/api/cmo/patients/${id}/documents/${doc.id}/status`, {
        status,
        note: cleanNote,
      })
      await loadData()
      notify('已更新文件處理狀態')
    } finally {
      setEntryBusy('')
    }
  }

  const revertDocumentStatus = async (entry: AuditEntry, note: string) => {
    if (!entry.target_id) {
      notify('找不到要復原的文件')
      return
    }
    const cleanNote = note.trim()
    if (cleanNote.length < 6) {
      notify('請輸入 CMO audit note')
      return
    }
    setEntryBusy(`doc-status-revert-${entry.id}`)
    try {
      await api.post(`/api/cmo/patients/${id}/documents/${entry.target_id}/status/revert`, {
        audit_id: entry.id,
        note: cleanNote,
      })
      await loadData()
      notify('已復原文件處理狀態')
    } finally {
      setEntryBusy('')
    }
  }

  const runChangeRequestAction = async (
    requestItem: ChangeRequest,
    action: 'accept' | 'modify' | 'reject' | 'needs',
    options?: { modifiedPayload?: Record<string, unknown>; publishMode?: PublishMode },
  ) => {
    const reviewer_note = reviewerNotes[requestItem.id]?.trim() || undefined
    if (action === 'needs' && !reviewer_note) {
      notify('請先填寫要 User 補充的具體問題')
      return
    }
    setEntryBusy(`cr-${requestItem.id}`)
    try {
      let response: { audit_id?: string } | null = null
      if (action === 'modify') {
        response = await api.post(`/api/cmo/change-requests/${requestItem.id}/modify-and-accept`, {
          modified_payload: options?.modifiedPayload ?? requestItem.proposed_payload,
          publish_mode: options?.publishMode ?? defaultPublishModeForRequest(requestItem),
          reviewer_note,
        }) as { audit_id?: string }
      } else {
        const endpoint = action === 'accept' ? 'accept' : action === 'reject' ? 'reject' : 'needs-clarification'
        response = await api.post(`/api/cmo/change-requests/${requestItem.id}/${endpoint}`, {
          reviewer_note,
          ...(action === 'needs' ? { question: reviewer_note, patient_facing_note: reviewer_note, requested_action: requestItem.requested_action ?? requestItem.proposed_payload?.requested_action } : {}),
          ...(action === 'accept' ? { publish_mode: options?.publishMode ?? defaultPublishModeForRequest(requestItem) } : {}),
        }) as { audit_id?: string }
      }
      if (response?.audit_id) setLastActionAuditId(response.audit_id)
      await loadData()
      notify(action === 'accept' ? '已接受 request' : action === 'modify' ? '已修改並接受 request' : action === 'reject' ? '已拒絕 request' : '已標記需補充')
    } finally {
      setEntryBusy('')
    }
  }

  const runReportedStateAction = async (state: ReportedState, action: 'reconcile' | 'keep' | 'needs') => {
    const endpoint = action === 'reconcile'
      ? 'reconcile'
      : action === 'keep'
        ? 'keep-as-patient-reported'
        : 'needs-clarification'
    setEntryBusy(`reported-${state.id}`)
    try {
      await api.post(`/api/cmo/patient-reported-states/${state.id}/${endpoint}`, {
        reviewer_note: reportedStateNotes[state.id]?.trim() || undefined,
      })
      setReportedStateNotes((prev) => {
        const next = { ...prev }
        delete next[state.id]
        return next
      })
      await loadData()
      notify(action === 'reconcile' ? '已 reconcile 到正式紀錄' : action === 'keep' ? '已保留為 User 實際狀態' : '已要求 User 補充說明')
    } finally {
      setEntryBusy('')
    }
  }

  const undoLastAction = async () => {
    if (!lastActionAuditId) {
      notify('沒有可 undo 的 CMO action')
      return
    }
    setEntryBusy('undo')
    try {
      await api.post(`/api/cmo/actions/${lastActionAuditId}/undo`)
      setLastActionAuditId(null)
      await loadData()
      notify('已 undo 上一個 CMO action')
    } finally {
      setEntryBusy('')
    }
  }

  const undoAuditEntry = async (entry: AuditEntry) => {
    if (!entry.undo_available) return
    if (!window.confirm(`Undo this audited CMO action?\n${entry.action} · ${entry.target_label}`)) return
    setEntryBusy(`audit-${entry.id}`)
    try {
      await api.post(`/api/cmo/actions/${entry.id}/undo`)
      await loadData()
      notify(`已 undo · ${entry.target_label}`)
    } finally {
      setEntryBusy('')
    }
  }

  const notify = (message: string) => {
    setFlash(message)
    window.setTimeout(() => setFlash(''), 1600)
  }

  const createProblemEntry = async () => {
    if (!problemForm.display_name.trim()) {
      notify('請先輸入或選擇 Problem')
      return
    }
    setEntryBusy('problem')
    try {
      await api.post(`/api/cmo/patients/${id}/problems`, {
        member_name: selectedMember === '全部' ? '本人' : selectedMember,
        display_name: problemForm.display_name.trim(),
        display_layman: problemForm.display_layman.trim() || null,
        icd10_code: problemForm.icd10_code.trim() || null,
        status: problemForm.status,
        is_suspected: problemForm.is_suspected,
        tier: problemForm.tier,
        onset_date: problemForm.onset_date || null,
        cmo_note: problemForm.cmo_note.trim() || null,
      })
      setProblemForm(defaultProblemForm())
      await loadData()
      notify('已建立 Problem，請後續 verify/publish')
    } finally {
      setEntryBusy('')
    }
  }

  const createConditionEntry = async () => {
    if (!conditionForm.display_name.trim()) {
      notify('請先輸入或選擇慢病/疾病史')
      return
    }
    setEntryBusy('condition')
    try {
      await api.post(`/api/cmo/patients/${id}/conditions`, {
        member_name: selectedMember === '全部' ? '本人' : selectedMember,
        display_name: conditionForm.display_name.trim(),
        icd10_code: conditionForm.icd10_code.trim() || null,
        status: conditionForm.status,
        onset_date: conditionForm.onset_date || null,
        note: conditionForm.note.trim() || null,
      })
      if (conditionForm.sync_problem) {
        await api.post(`/api/cmo/patients/${id}/problems`, {
          member_name: selectedMember === '全部' ? '本人' : selectedMember,
          display_name: conditionForm.display_name.trim(),
          display_layman: conditionForm.display_name.trim(),
          icd10_code: conditionForm.icd10_code.trim() || null,
          status: conditionForm.status === 'resolved' ? 'resolved' : 'underlying',
          is_suspected: false,
          tier: 3,
          onset_date: conditionForm.onset_date || null,
          cmo_note: conditionForm.note.trim() || '由 CMO 快速建立，需 publish 後病人端才顯示。',
        })
      }
      setConditionForm(defaultConditionForm())
      await loadData()
      notify(conditionForm.sync_problem ? '已建立疾病史與 Problem，請檢查 publish gate' : '已建立疾病史，請檢查 publish gate')
    } finally {
      setEntryBusy('')
    }
  }

  const createMedicationEntry = async () => {
    if (!medicationForm.drug_name.trim()) {
      notify('請先輸入或選擇藥物')
      return
    }
    setEntryBusy('medication')
    try {
      await api.post(`/api/cmo/patients/${id}/medications`, {
        member_name: selectedMember === '全部' ? '本人' : selectedMember,
        drug_name: medicationForm.drug_name.trim(),
        dose: medicationForm.dose.trim() || null,
        frequency: medicationForm.frequency.trim() || null,
        intent: medicationForm.intent,
        started_on: medicationForm.started_on || null,
        ended_on: medicationForm.ended_on || null,
        is_active: medicationForm.is_active,
        note: medicationForm.note.trim() || null,
      })
      setMedicationForm(defaultMedicationForm())
      await loadData()
      notify('已新增 medication regimen')
    } finally {
      setEntryBusy('')
    }
  }

  const toggleMedicationActive = async (medication: Medication) => {
    setEntryBusy(`med-${medication.id}`)
    try {
      await api.patch(`/api/cmo/medications/${medication.id}`, {
        is_active: !medication.is_active,
        ended_on: medication.is_active ? todayInputDate() : null,
      })
      await loadData()
      notify(medication.is_active ? '已標記停藥' : '已恢復 active medication')
    } finally {
      setEntryBusy('')
    }
  }

  const createReminderEntry = async () => {
    if (!reminderForm.title.trim()) {
      notify('請先輸入或選擇回診/追蹤事項')
      return
    }
    setEntryBusy('reminder')
    try {
      await api.post(`/api/cmo/patients/${id}/reminders`, {
        member_name: selectedMember === '全部' ? '本人' : selectedMember,
        title: reminderForm.title.trim(),
        scheduled_date: reminderForm.scheduled_date || null,
        repeat_type: reminderForm.repeat_type,
        is_done: false,
        note: reminderForm.note.trim() || null,
      })
      setReminderForm(defaultReminderForm())
      await loadData()
      notify('已新增回診/追蹤提醒')
    } finally {
      setEntryBusy('')
    }
  }

  const toggleReminderDone = async (reminder: Reminder) => {
    setEntryBusy(`reminder-${reminder.id}`)
    try {
      await api.patch(`/api/cmo/reminders/${reminder.id}`, { is_done: !reminder.is_done })
      await loadData()
      notify(reminder.is_done ? '已恢復待追蹤' : '已標記完成')
    } finally {
      setEntryBusy('')
    }
  }

  const createRecordEntry = async () => {
    if (!recordForm.value1.trim()) {
      notify('請至少輸入第一個數值')
      return
    }
    setEntryBusy('record')
    try {
      await api.post(`/api/cmo/patients/${id}/records`, {
        member_name: selectedMember === '全部' ? '本人' : selectedMember,
        record_type: recordForm.record_type,
        value1: recordForm.value1.trim(),
        value2: recordForm.value2.trim() || null,
        unit: recordForm.unit.trim() || null,
        recorded_at: recordForm.recorded_at || null,
        note: recordForm.note.trim() || 'CMO structured entry',
      })
      setRecordForm(defaultRecordForm())
      await loadData()
      notify('已新增健康紀錄')
    } finally {
      setEntryBusy('')
    }
  }

  const runProblemAction = async (problemId: number, action: 'verify' | 'publish' | 'unpublish') => {
    setBusyProblem(problemId)
    try {
      await api.post(`/api/cmo/problems/${problemId}/${action}`)
      await loadData()
    } finally {
      setBusyProblem(null)
    }
  }

  const runConditionPublishAction = async (conditionId: number, action: 'publish' | 'unpublish') => {
    setEntryBusy(`condition-${conditionId}-${action}`)
    try {
      await api.post(`/api/cmo/conditions/${conditionId}/${action}`)
      await loadData()
      notify(action === 'publish' ? '已發布疾病史到使用者端' : '已撤回使用者端疾病史')
    } finally {
      setEntryBusy('')
    }
  }

  const runMedicationPublishAction = async (medicationId: number, action: 'publish' | 'unpublish') => {
    setEntryBusy(`medication-${medicationId}-${action}`)
    try {
      await api.post(`/api/cmo/medications/${medicationId}/${action}`)
      await loadData()
      notify(action === 'publish' ? '已發布用藥到使用者端' : '已撤回使用者端用藥')
    } finally {
      setEntryBusy('')
    }
  }

  const runTierUpdate = async (problemId: number, tier: 1 | 2 | 3) => {
    setBusyProblem(problemId)
    try {
      await api.post(`/api/cmo/problems/${problemId}/tier`, { tier })
      await loadData()
    } finally {
      setBusyProblem(null)
    }
  }

  useEffect(() => {
    if (activeTab !== 'requests') return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const first = pendingChangeRequests[0]
      if (!first && event.key.toLowerCase() !== 'u') return
      const key = event.key.toLowerCase()
      if (key === 'a' && first) runChangeRequestAction(first, 'accept')
      if (key === 'm' && first) runChangeRequestAction(first, 'modify')
      if (key === 'r' && first) runChangeRequestAction(first, 'reject')
      if (key === 'n' && first) runChangeRequestAction(first, 'needs')
      if (key === 'u') undoLastAction()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTab, pendingChangeRequests, lastActionAuditId, reviewerNotes]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <CmoLoadingSkeleton />
  }

  if (loadError) {
    return (
      <CmoPageState
        eyebrow="Load error"
        title="無法載入 CMO 病患資料"
        body={`這通常是 API、權限或本機後端狀態問題，不代表病患不存在。錯誤：${loadError}`}
        tone="error"
        action={<button type="button" className="cmo-button primary" onClick={loadData}>重新載入</button>}
      />
    )
  }

  if (!data) {
    return (
      <CmoPageState
        eyebrow="Empty patient"
        title="找不到這位病患"
        body="API 已回應，但沒有可顯示的病患資料。請確認 patient id、家庭權限與 CMO session。"
        tone="empty"
        action={<button type="button" className="cmo-button" onClick={() => router.push('/cmo/workbench')}>返回工作台</button>}
      />
    )
  }

  return (
    <div className="cmo-page">
      <PatientContentEntryLauncher patientId={id} contextLabel="Patient POV" />
      <header className="cmo-title-row">
        <div>
          <button type="button" className="cmo-button" onClick={() => router.push('/cmo/workbench')}>返回工作台</button>
          <h1 className="cmo-title" style={{ marginTop: 12 }}>{data.user.display_name}</h1>
          <div className="cmo-subtitle">
            {data.user.patient_public_id ?? `User ${data.user.id.slice(0, 8)}`}
            {' · '}
            {data.user.age ? `${data.user.age}y` : 'age not recorded'} / {data.user.sex ?? 'sex not recorded'}
            {' · '}Blood {data.user.blood_type ?? 'not recorded'}
            {' · '}Last edited {formatDate(data.user.last_edited)}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <span className="cmo-badge" style={{ background: '#ecfdf5', color: '#047857' }}>
              Verified {data.user.verification_summary?.verified ?? 0}/{data.user.verification_summary?.total ?? data.problems.length}
            </span>
            <span className="cmo-badge" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
              Published {data.user.verification_summary?.published ?? 0}/{data.user.verification_summary?.total ?? data.problems.length}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {flash && <span className="cmo-badge" style={{ background: '#ecfdf5', color: '#047857' }}>{flash}</span>}
          <button type="button" className="cmo-button" onClick={copyHandoff}>複製交班摘要</button>
          <Link className="cmo-button" href={`/cmo/patients/${id}/nhi`}>NHI 健康存摺 (10 區塊)</Link>
          <Link className="cmo-button" href={`/cmo/patients/${id}/intake`}>Triage 模式</Link>
          <button type="button" className="cmo-button" disabled={entryBusy === 'verify-rz'} onClick={verifyRedZoneAll} title="僅在已逐項核對來源文件後使用；批次確認不會自動完成 evidence 綁定。">✓ 批次確認紅區</button>
          <Link className="cmo-button primary" href={`/cmo/patients/${id}/redzone`}>編輯紅區</Link>
        </div>
      </header>

      <section className="cmo-card cmo-toolbar" style={{ marginTop: 14 }}>
        <div>
          <div className="cmo-kpi-label">家庭成員資料範圍</div>
          <div className="cmo-subtitle">
            Problems、Conditions、Medications、Reminders、Records、Documents、Imaging 皆依目前選取的家庭成員分流。
          </div>
        </div>
        <div className="cmo-chipbar" style={{ flex: '1 1 360px', justifyContent: 'flex-end' }}>
          {memberOptions.map((member) => (
            <button
              key={member}
              type="button"
              className={`cmo-chip ${selectedMember === member ? 'active' : ''}`}
              onClick={() => setSelectedMember(member)}
            >
              {member}
            </button>
          ))}
        </div>
      </section>

      <section className="cmo-kpi-grid">
        <StatCard label="待發布 clinical rows" value={pendingClinicalRows} note={`${pendingProblems.length} Problem · ${pendingConditions.length} Condition · ${pendingMedicationPublishes.length} Medication`} tone="#be123c" />
        <StatCard label="User requests" value={pendingChangeRequests.length} note="使用者異動待審核" tone="#a16207" />
        <StatCard label="User reported states" value={openReportedStates.length} note="實際用藥 / 追蹤狀態待 reconcile" tone="#0f766e" />
        <StatCard label="目前 Problem" value={openProblems.length} note={`${data.problems.length} 個總 Problem`} tone="#2563eb" />
        <StatCard label="紅區重點" value={criticalCount} note="過敏、植入物、腎功能" tone="#dc2626" />
        <StatCard label="Unlinked items" value={unlinkedCount} note="需掛到 Problem 或標記已檢視" tone="#a16207" />
        <StatCard label="Publish readiness" value={`${readinessDone}/${readiness.length}`} note="發布前 checklist" tone={readinessDone === readiness.length ? '#059669' : '#be123c'} />
        <StatCard label="文件/影像" value={(scopedData?.documents.length ?? 0) + (scopedData?.dicom_studies.length ?? 0)} note={`${scopedData?.documents.length ?? 0} 文件 · ${scopedData?.dicom_studies.length ?? 0} 影像`} tone="#0f766e" />
      </section>

      <section className="cmo-grid-2">
        <div className="cmo-card cmo-section">
          <h2 className="cmo-section-title">Critical Red Zone</h2>
          <div className="cmo-grid-3">
            <CriticalTile title="Tier 1 · 藥物過敏" value={critical?.tier1.drug_allergies.map((item) => item.substance).join(', ') || '未記錄'} tone="#be123c" />
            <CriticalTile title="Tier 1 · 顯影劑/食物" value={[...(critical?.tier1.contrast_allergies ?? []), ...(critical?.tier1.food_allergies ?? [])].map((item) => item.substance).join(', ') || '未記錄'} tone="#a16207" />
            <CriticalTile title="Tier 1 · 腎功能" value={critical?.tier1.renal_function ? `eGFR ${critical.tier1.renal_function.egfr ?? '-'} · CKD ${critical.tier1.renal_function.ckd_stage ?? '-'}` : '未記錄'} tone="#7c3aed" />
            <CriticalTile title="Tier 1 · 植入物" value={critical?.tier1.implants.map((item) => item.model || item.type).join(', ') || '未記錄'} tone="#0f766e" />
            <CriticalTile title="Tier 2 · 血型/肝炎" value={`${critical?.tier2.blood_type ?? '未填'} · B肝 ${critical?.tier2.has_hep_b ? '是' : '否'} · C肝 ${critical?.tier2.has_hep_c ? '是' : '否'}`} tone="#2563eb" />
            <CriticalTile title="Tier 2 · 緊急聯絡" value={critical?.tier2.emergency_contact ? `${critical.tier2.emergency_contact.name} ${critical.tier2.emergency_contact.phone ?? ''}` : '未記錄'} tone="#334155" />
            <CriticalTile title="Tier 3 · 人口統計" value={`${data.user.age ? `${data.user.age}y` : '年齡未記錄'} · ${data.user.sex ?? '性別未記錄'}`} tone="#64748b" />
          </div>
        </div>

        <div className="cmo-card cmo-section">
          <h2 className="cmo-section-title">交班摘要</h2>
          <textarea className="cmo-textarea" rows={9} readOnly value={handoffText} />
        </div>
      </section>

      <div className="cmo-card cmo-toolbar">
        <div className="cmo-tabs" style={{ flex: '1 1 460px' }}>
          {[
            ['overview', '總覽'],
            ['requests', `User requests${pendingChangeRequests.length ? ` (${pendingChangeRequests.length})` : ''}`],
            ['problems', 'Problem'],
            ['readiness', 'Publish readiness'],
            ['records', '健康紀錄'],
            ['documents', '文件'],
            ['imaging', '影像'],
            ['audit', `Audit / History${auditLog.length ? ` (${auditLog.length})` : ''}`],
          ].map(([key, label]) => (
            <button key={key} type="button" className={`cmo-tab ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key as TabKey)}>{label}</button>
          ))}
        </div>
        <button
          type="button"
          className="cmo-button primary"
          onClick={() => sendToPatientContentPanel({ source: 'Patient POV' })}
        >
          開啟填寫面板
        </button>
        <input className="cmo-input" style={{ flex: '1 1 260px' }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋 Problem、紀錄、文件" />
        {activeTab === 'problems' && (
          <select className="cmo-select" style={{ width: 170 }} value={problemFilter} onChange={(event) => setProblemFilter(event.target.value as ProblemFilter)}>
            <option value="all">全部 Problem</option>
            <option value="open">未解決</option>
            <option value="verified">已 Verify</option>
            <option value="published">已 Publish</option>
          </select>
        )}
      </div>

      {activeTab === 'overview' && (
        <section className="cmo-grid-2">
          <div className="cmo-card cmo-section">
            <h2 className="cmo-section-title">待整理清單</h2>
            <div className="cmo-list">
              {pendingChangeRequests.length > 0 && (
                <button type="button" className="cmo-list-item cmo-row" onClick={() => setActiveTab('requests')} style={{ textAlign: 'left', cursor: 'pointer' }}>
                  <div>
                    <strong>User change requests</strong>
                    <div className="cmo-subtitle">{pendingChangeRequests.length} request{pendingChangeRequests.length > 1 ? 's' : ''} waiting for accept / reject / clarification</div>
                  </div>
                  <span className="cmo-badge" style={{ background: '#fef3c7', color: '#a16207' }}>Open</span>
                </button>
              )}
              {openReportedStates.length > 0 && (
                <button type="button" className="cmo-list-item cmo-row" onClick={() => setActiveTab('requests')} style={{ textAlign: 'left', cursor: 'pointer' }}>
                  <div>
                    <strong>User reported states</strong>
                    <div className="cmo-subtitle">{openReportedStates.length} actual-state report{openReportedStates.length > 1 ? 's' : ''} waiting for reconcile / keep / clarification</div>
                  </div>
                  <span className="cmo-badge" style={{ background: '#ecfdf5', color: '#047857' }}>Reconcile</span>
                </button>
              )}
              {pendingClinicalRows === 0 ? (
                <div className="cmo-muted">沒有待 verify/publish 的 clinical row。</div>
              ) : (
                <>
                  {pendingProblems.slice(0, 6).map((problem) => <ProblemRow key={problem.id} problem={problem} />)}
                  <NonProblemPublishPanel
                    compact
                    documents={scopedData?.documents ?? data.documents}
                    conditions={pendingConditions.slice(0, 4)}
                    medications={pendingMedicationPublishes.slice(0, 4)}
                    busy={entryBusy}
                    onConditionAction={runConditionPublishAction}
                    onMedicationAction={runMedicationPublishAction}
                  />
                </>
              )}
            </div>
          </div>
          <TimelinePanel items={timeline.slice(0, 10)} />
        </section>
      )}

      {activeTab === 'requests' && (
        <section className="cmo-list">
          <ReportedStatesPanel
            states={reportedStates}
            busy={entryBusy}
            notes={reportedStateNotes}
            onNoteChange={(stateId, note) => setReportedStateNotes(prev => ({ ...prev, [stateId]: note }))}
            onAction={runReportedStateAction}
          />
          <ChangeRequestsPanel
            requests={changeRequests}
            busy={entryBusy}
            notes={reviewerNotes}
            lastActionAuditId={lastActionAuditId}
            onNoteChange={(requestId, note) => setReviewerNotes(prev => ({ ...prev, [requestId]: note }))}
            onAction={runChangeRequestAction}
            onUndo={undoLastAction}
          />
        </section>
      )}

      {activeTab === 'fill' && (
        <PatientSurfaceEditor
          data={scopedData ?? data}
          entryBusy={entryBusy}
          problemForm={problemForm}
          conditionForm={conditionForm}
          medicationForm={medicationForm}
          reminderForm={reminderForm}
          recordForm={recordForm}
          setProblemForm={setProblemForm}
          setConditionForm={setConditionForm}
          setMedicationForm={setMedicationForm}
          setReminderForm={setReminderForm}
          setRecordForm={setRecordForm}
          onCreateProblem={createProblemEntry}
          onCreateCondition={createConditionEntry}
          onCreateMedication={createMedicationEntry}
          onToggleMedication={toggleMedicationActive}
          onCreateReminder={createReminderEntry}
          onToggleReminder={toggleReminderDone}
          onCreateRecord={createRecordEntry}
        />
      )}

      {activeTab === 'problems' && (
        <section className="cmo-list">
          {visibleProblems.length === 0 ? <EmptyState>沒有符合條件的 Problem。</EmptyState> : visibleProblems.map((problem) => (
            <ProblemCard key={problem.id} problem={problem} documents={scopedData?.documents ?? data.documents} metrics={conceptMetrics(problem, scopedData ?? data, activeMedications)} busy={busyProblem === problem.id} onAction={runProblemAction} onTierChange={runTierUpdate} />
          ))}
        </section>
      )}

      {activeTab === 'readiness' && (
        <section className="cmo-grid-2">
          <PublishReadinessPanel items={readiness} />
          <PatientFacingPreview problems={scopedData?.problems ?? data.problems} />
          <NonProblemPublishPanel
            documents={scopedData?.documents ?? data.documents}
            conditions={pendingConditions}
            medications={pendingMedicationPublishes}
            busy={entryBusy}
            onConditionAction={runConditionPublishAction}
            onMedicationAction={runMedicationPublishAction}
          />
          <UnlinkedItemsPanel items={unlinked} />
        </section>
      )}

      {activeTab === 'records' && <RecordTable records={scopedData?.records ?? data.records} />}
      {activeTab === 'documents' && (
        <section className="cmo-list">
          <SourceDocumentReviewPanel documents={scopedData?.documents ?? data.documents} auditEntries={auditLog} busy={entryBusy} onStatusUpdate={updateDocumentStatus} onStatusRevert={revertDocumentStatus} />
          <SourceAssignmentPanel
            documents={scopedData?.documents ?? data.documents}
            targets={sourceAssignmentTargets}
            form={sourceAssignment}
            busy={entryBusy === 'source-assignment'}
            onChange={setSourceAssignment}
            onAssign={assignSourceDocument}
          />
          <DocumentTable documents={scopedData?.documents ?? data.documents} />
        </section>
      )}
      {activeTab === 'imaging' && <ImagingTable studies={scopedData?.dicom_studies ?? data.dicom_studies} />}
      {activeTab === 'audit' && <AuditHistoryPanel entries={auditLog} busy={entryBusy} onUndo={undoAuditEntry} />}
    </div>
  )
}

function CriticalTile({ title, value, tone }: { title: string; value: string; tone: string }) {
  return (
    <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
      <div className="cmo-kpi-label">{title}</div>
      <div style={{ marginTop: 8, color: tone, fontWeight: 820, lineHeight: 1.45 }}>{value}</div>
    </div>
  )
}

function AuditHistoryPanel({ entries, busy, onUndo }: { entries: AuditEntry[]; busy: string; onUndo: (entry: AuditEntry) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (entries.length === 0) {
    return <EmptyState>目前沒有 audit/history。CMO publish、reconcile、red-zone、undo 操作後會出現在這裡。</EmptyState>
  }
  return (
    <section className="cmo-list">
      <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
        <div className="cmo-title-row">
          <div>
            <h2 className="cmo-section-title" style={{ marginBottom: 4 }}>Audit / History</h2>
            <div className="cmo-subtitle">First-class event log for who / when / what / source / status. High-risk actions can be reviewed and undone when supported.</div>
          </div>
          <span className="cmo-badge" style={{ background: '#eef2ff', color: '#3730a3' }}>{entries.length} entries</span>
        </div>
      </div>
      {entries.map((entry) => {
        const isOpen = expanded === entry.id
        const statusTone = entry.status === 'reverted' ? ['#f1f5f9', '#475569'] : entry.status === 'needs_clarification' ? ['#fff7ed', '#c2410c'] : entry.status === 'rejected' ? ['#fff1f2', '#be123c'] : ['#ecfdf5', '#047857']
        return (
          <article key={entry.id} className="cmo-card cmo-section">
            <div className="cmo-title-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span className="cmo-badge" style={{ background: entry.actor_type === 'cmo' ? '#eff6ff' : '#f8fafc', color: entry.actor_type === 'cmo' ? '#1d4ed8' : '#475569' }}>{entry.actor_type}</span>
                  <span className="cmo-badge" style={{ background: statusTone[0], color: statusTone[1] }}>{entry.status}</span>
                  <span className="cmo-badge" style={{ background: '#f1f5f9', color: '#475569' }}>{entry.target_type}</span>
                </div>
                <h3 className="cmo-section-title" style={{ marginBottom: 4 }}>{entry.action} · {entry.target_label}</h3>
                <div className="cmo-subtitle">
                  {formatDate(entry.created_at)} · target {entry.target_id || 'none'} · actor {entry.actor_id}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" className="cmo-button" onClick={() => setExpanded(isOpen ? null : entry.id)}>{isOpen ? 'Hide snapshot' : 'View snapshot'}</button>
                {entry.undo_available ? (
                  <button type="button" className="cmo-button danger" disabled={busy === `audit-${entry.id}`} onClick={() => onUndo(entry)}>Undo</button>
                ) : (
                  <button type="button" className="cmo-button" disabled title="此 audit entry 不支援自動 undo；請使用對應 structured editor 或新增反向修正。">Undo unavailable</button>
                )}
              </div>
            </div>
            {isOpen && (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto', marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, fontSize: 11 }}>
                {JSON.stringify(entry.snapshot, null, 2)}
              </pre>
            )}
          </article>
        )
      })}
    </section>
  )
}

const REPORTED_STATUS_LABELS: Record<string, string> = {
  taking: 'User says taking',
  not_taking: 'User says not taking',
  doctor_stopped: 'Doctor stopped',
  course_completed: 'Course completed',
  self_stopped: 'Self stopped',
  side_effect_stopped: 'Stopped due to side effect',
  unsure: 'User unsure',
  actively_treating: 'Still treating',
  following: 'Still following',
  no_longer_tracking: 'No longer tracking',
  doctor_said_no_follow_up: 'Doctor said no follow-up',
  resolved_by_self_report: 'User says resolved',
  patient_says_incorrect: 'User says incorrect',
}

function reportedStatusLabel(status: string) {
  return REPORTED_STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
}

function reportedStateTitle(state: ReportedState) {
  const payload = state.reported_payload ?? {}
  const candidates = [
    payload.drug_name,
    payload.display_name,
    payload.display_layman,
    payload.title,
    payload.substance,
    payload.target_label,
  ]
  const label = candidates.find((value) => typeof value === 'string' && value.trim())
  return label ? String(label) : `${state.target_type}${state.target_id ? ` #${state.target_id}` : ''}`
}

function ReportedStatesPanel({
  states,
  busy,
  notes,
  onNoteChange,
  onAction,
}: {
  states: ReportedState[]
  busy: string
  notes: Record<string, string>
  onNoteChange: (stateId: string, note: string) => void
  onAction: (state: ReportedState, action: 'reconcile' | 'keep' | 'needs') => void
}) {
  const open = states.filter((state) => state.reconciliation_status === 'active_patient_reported')
  const waiting = states.filter((state) => state.reconciliation_status === 'needs_clarification')
  return (
    <section className="cmo-list">
      <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
        <div className="cmo-title-row">
          <div>
            <h2 className="cmo-section-title" style={{ marginBottom: 4 }}>User Reported States</h2>
            <div className="cmo-subtitle">Patient reality overlay: actual medication use, tracking preference, or red-zone correction. Reconcile only after CMO review.</div>
          </div>
          <span className="cmo-badge" style={{ background: open.length ? '#fff7ed' : '#ecfdf5', color: open.length ? '#c2410c' : '#047857' }}>
            {open.length} pending reconcile
          </span>
        </div>
      </div>
      {open.length === 0 && waiting.length === 0 ? (
        <EmptyState>目前沒有 User reported states 待處理。</EmptyState>
      ) : (
        <>
          {open.map((state) => {
            const isBusy = busy === `reported-${state.id}`
            return (
              <article key={state.id} className="cmo-card cmo-section">
                <div className="cmo-title-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span className="cmo-badge" style={{ background: '#ecfdf5', color: '#047857' }}>actual state</span>
                      <span className="cmo-badge" style={{ background: '#eef2ff', color: '#3730a3' }}>{state.target_type}</span>
                      <span className="cmo-badge" style={{ background: '#fff7ed', color: '#c2410c' }}>{reportedStatusLabel(state.reported_status)}</span>
                    </div>
                    <h3 className="cmo-section-title" style={{ marginBottom: 4 }}>{reportedStateTitle(state)}</h3>
                    <div className="cmo-subtitle">
                      Reported {formatDate(state.created_at)} · target {state.target_id || 'none'} · source {state.source_document_id ? `document ${state.source_document_id}` : 'user input'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="cmo-button primary" disabled={isBusy} onClick={() => onAction(state, 'reconcile')}>Reconcile official</button>
                    <button className="cmo-button" disabled={isBusy} onClick={() => onAction(state, 'keep')}>Keep overlay</button>
                    <button className="cmo-button danger" disabled={isBusy} onClick={() => onAction(state, 'needs')}>Need clarification</button>
                  </div>
                </div>
                {state.note && (
                  <div className="cmo-card cmo-section" style={{ background: '#fff7ed', borderColor: '#fed7aa', marginTop: 10 }}>
                    <div className="cmo-kpi-label" style={{ color: '#9a3412' }}>User note</div>
                    <div style={{ marginTop: 6, fontSize: 13, color: '#431407', lineHeight: 1.6 }}>{state.note}</div>
                  </div>
                )}
                <div className="cmo-grid-2" style={{ marginTop: 12 }}>
                  <DiffBox title="Reported payload" data={state.reported_payload} empty="No payload." />
                  <DiffBox title="CMO interpretation" data={{
                    reported_status: reportedStatusLabel(state.reported_status),
                    reconciliation_status: state.reconciliation_status,
                    action_hint: state.target_type === 'medication'
                      ? 'Reconcile official will update medication active/stopped when derivable.'
                      : state.target_type === 'problem'
                        ? 'Reconcile official will update problem following/resolved when derivable.'
                        : 'For this target, keep overlay or request clarification unless a dedicated reconciler exists.',
                  }} empty="No interpretation." />
                </div>
                <div style={{ marginTop: 12 }}>
                  <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>CMO reviewer note</div>
                  <textarea
                    className="cmo-textarea"
                    rows={2}
                    value={notes[state.id] ?? ''}
                    onChange={(event) => onNoteChange(state.id, event.target.value)}
                    placeholder="Required for clarification; useful for audit trail on reconcile/keep."
                  />
                </div>
              </article>
            )
          })}
          {waiting.length > 0 && (
            <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
              <h3 className="cmo-section-title">Waiting for User clarification</h3>
              <div className="cmo-list">
                {waiting.map((state) => (
                  <div key={state.id} className="cmo-list-item cmo-row">
                    <div>
                      <strong>{reportedStateTitle(state)}</strong>
                      <div className="cmo-subtitle">{reportedStatusLabel(state.reported_status)} · reviewer note: {state.reviewer_note || 'none'}</div>
                    </div>
                    <span className="cmo-badge" style={{ background: '#fff7ed', color: '#c2410c' }}>needs clarification</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ChangeRequestsPanel({
  requests,
  busy,
  notes,
  lastActionAuditId,
  onNoteChange,
  onAction,
  onUndo,
}: {
  requests: ChangeRequest[]
  busy: string
  notes: Record<string, string>
  lastActionAuditId: string | null
  onNoteChange: (requestId: string, note: string) => void
  onAction: (requestItem: ChangeRequest, action: 'accept' | 'modify' | 'reject' | 'needs', options?: { modifiedPayload?: Record<string, unknown>; publishMode?: PublishMode }) => void
  onUndo: () => void
}) {
  const pending = requests.filter((request) => request.status === 'pending_review')
  const waitingForUser = requests.filter((request) => request.status === 'needs_clarification')
  const reviewed = requests.filter((request) => request.status !== 'pending_review' && request.status !== 'needs_clarification')
  const renderRequest = (requestItem: ChangeRequest) => {
    const isPending = requestItem.status === 'pending_review'
    const statusCopy = requestStatusCopy(requestItem)
    const targetLabel = requestTargetLabel(requestItem)
    const clarificationReply = requestNestedPayload(requestItem, 'clarification_reply')
    const clarificationDraft = requestNestedPayload(requestItem, 'clarification_draft')
    const clarificationQuestion = requestClarificationQuestion(requestItem)
    const userReplied = Boolean(clarificationReply)
    return (
      <article key={requestItem.id} className="cmo-card cmo-section">
        <div className="cmo-title-row">
          <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className="cmo-badge" style={{ background: statusCopy.bg, color: statusCopy.fg }}>
                {statusCopy.label}
              </span>
              <span className="cmo-badge" style={{ background: '#eef2ff', color: '#3730a3' }}>{requestItem.target_type}</span>
              <span className="cmo-badge" style={{ background: '#ecfdf5', color: '#047857' }}>{requestItem.action}</span>
              {userReplied && <span className="cmo-badge" style={{ background: '#dbeafe', color: '#1d4ed8' }}>User replied</span>}
              {requestItem.priority && <span className="cmo-badge" style={{ background: requestItem.priority === 'high' ? '#fff1f2' : '#f8fafc', color: requestItem.priority === 'high' ? '#be123c' : '#475569' }}>{requestItem.priority}</span>}
            </div>
            <h3 className="cmo-section-title" style={{ marginBottom: 4 }}>
              {targetLabel}
            </h3>
            <div className="cmo-subtitle">
              Created {formatDate(requestItem.created_at)} · member {requestItem.member_name || 'not resolved'} · requested action {requestActionLabel(requestItem)}
              {requestItem.target_id ? ` · target ${requestItem.target_id}` : ''}
            </div>
            <div className="cmo-subtitle" style={{ marginTop: 4 }}>{statusCopy.help}</div>
          </div>
          {isPending && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="cmo-button" disabled={busy === `cr-${requestItem.id}`} onClick={() => onAction(requestItem, 'needs')}>Clarify (N)</button>
              <button className="cmo-button danger" disabled={busy === `cr-${requestItem.id}`} onClick={() => onAction(requestItem, 'reject')}>Reject (R)</button>
            </div>
          )}
        </div>
        {requestItem.patient_note && (
          <div className="cmo-card cmo-section" style={{ background: '#fff7ed', borderColor: '#fed7aa', marginTop: 10 }}>
            <div className="cmo-kpi-label" style={{ color: '#9a3412' }}>Patient note</div>
            <div style={{ marginTop: 6, fontSize: 13, color: '#431407', lineHeight: 1.6 }}>{requestItem.patient_note}</div>
          </div>
        )}
        {clarificationQuestion && (
          <div className="cmo-card cmo-section" style={{ background: '#fff7ed', borderColor: '#fed7aa', marginTop: 10 }}>
            <div className="cmo-kpi-label" style={{ color: '#9a3412' }}>Clarification question shown to User</div>
            <div style={{ marginTop: 6, fontSize: 13, color: '#431407', lineHeight: 1.6 }}>{clarificationQuestion}</div>
          </div>
        )}
        {(clarificationReply || clarificationDraft) && (
          <div className="cmo-card cmo-section" style={{ background: clarificationReply ? '#eff6ff' : '#f8fafc', borderColor: clarificationReply ? '#bfdbfe' : '#e2e8f0', marginTop: 10 }}>
            <div className="cmo-kpi-label" style={{ color: clarificationReply ? '#1d4ed8' : '#475569' }}>{clarificationReply ? 'User clarification reply' : 'User saved draft'}</div>
            <div style={{ marginTop: 6, fontSize: 13, color: '#0f172a', lineHeight: 1.6 }}>
              {valueToText((clarificationReply || clarificationDraft)?.reply_text)}
              {(clarificationReply || clarificationDraft)?.reply_date ? ` · date ${valueToText((clarificationReply || clarificationDraft)?.reply_date)}` : ''}
              {(clarificationReply || clarificationDraft)?.source_document_id ? ` · source ${valueToText((clarificationReply || clarificationDraft)?.source_document_id)}` : ''}
              {(clarificationReply || clarificationDraft)?.uncertain ? ' · User marked uncertain' : ''}
            </div>
          </div>
        )}
        {isPending ? (
          <StructuredChangeRequestEditor
            requestItem={requestItem}
            busy={busy === `cr-${requestItem.id}`}
            onSubmit={(payload, publishMode, dirty) => onAction(requestItem, dirty ? 'modify' : 'accept', { modifiedPayload: payload, publishMode })}
          />
        ) : (
          <div className="cmo-grid-2" style={{ marginTop: 12 }}>
            <DiffBox title="Current official value" data={requestItem.current_snapshot} empty="No official row yet. This is a create request." />
            <DiffBox title="User proposed value" data={requestItem.proposed_payload} empty="No proposed payload." />
          </div>
        )}
        {isPending ? (
          <div style={{ marginTop: 12 }}>
            <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>CMO reviewer note</div>
            <textarea
              className="cmo-textarea"
              rows={2}
              value={notes[requestItem.id] ?? ''}
              onChange={(event) => onNoteChange(requestItem.id, event.target.value)}
              placeholder="Optional note for rejection, clarification, or modified acceptance."
            />
            <div className="cmo-subtitle" style={{ marginTop: 6 }}>
              Shortcuts while this tab is open: A accept with default mode · M submit current final values · R reject · N clarification · U undo last action.
            </div>
          </div>
        ) : requestItem.reviewer_note ? (
          <div className="cmo-card cmo-section" style={{ marginTop: 12, background: '#f8fafc' }}>
            <div className="cmo-kpi-label">Reviewer note</div>
            <div style={{ marginTop: 6, fontSize: 13 }}>{requestItem.reviewer_note}</div>
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <section className="cmo-list">
      <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
        <div className="cmo-title-row">
          <div>
            <h2 className="cmo-section-title" style={{ marginBottom: 4 }}>User Change Requests</h2>
            <div className="cmo-subtitle">Review user self-reports and proposed edits without letting patient-side changes overwrite verified rows.</div>
          </div>
          <button className="cmo-button" disabled={!lastActionAuditId || busy === 'undo'} onClick={onUndo}>Undo last action (U)</button>
        </div>
      </div>
      {pending.length === 0 && waitingForUser.length === 0 && reviewed.length === 0 ? (
        <EmptyState>目前沒有 User change requests。</EmptyState>
      ) : (
        <>
          {pending.map(renderRequest)}
          {waitingForUser.length > 0 && (
            <div className="cmo-card cmo-section" style={{ background: '#fff7ed', borderColor: '#fed7aa' }}>
              <h3 className="cmo-section-title">Waiting for User clarification</h3>
              <div className="cmo-subtitle">These are visible to the User as 補充資料 tasks. They should not be accepted until the User replies or CMO reopens the request.</div>
              <div className="cmo-list" style={{ marginTop: 10 }}>{waitingForUser.slice(0, 8).map(renderRequest)}</div>
            </div>
          )}
          {reviewed.length > 0 && (
            <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
              <h3 className="cmo-section-title">Reviewed requests</h3>
              <div className="cmo-list">{reviewed.slice(0, 8).map(renderRequest)}</div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function StructuredChangeRequestEditor({
  requestItem,
  busy,
  onSubmit,
}: {
  requestItem: ChangeRequest
  busy: boolean
  onSubmit: (payload: Record<string, unknown>, publishMode: PublishMode, dirty: boolean) => void
}) {
  const [finalPayload, setFinalPayload] = useState<Record<string, unknown>>(() => ({ ...requestItem.proposed_payload }))
  const [publishMode, setPublishMode] = useState<PublishMode>(() => defaultPublishModeForRequest(requestItem))
  const [error, setError] = useState('')
  const current = requestItem.current_snapshot ?? {}
  const proposed = requestItem.proposed_payload ?? {}
  const configured = editorFieldsFor(requestItem.target_type)
  const fields = configured.length > 0 ? configured : Array.from(new Set([...Object.keys(current), ...Object.keys(proposed)]))
  const compactFinal = compactPayload(finalPayload)
  const dirty = JSON.stringify(compactFinal) !== JSON.stringify(compactPayload(proposed))
  const modeCopy = PUBLISH_MODE_COPY[publishMode]

  const setField = (field: string, value: unknown) => {
    setFinalPayload((prev) => ({ ...prev, [field]: value }))
    setError('')
  }

  const validate = () => {
    if ((requestItem.target_type === 'problem' || requestItem.target_type === 'condition') && !String(finalPayload.display_name ?? '').trim()) return 'display_name is required.'
    if (requestItem.target_type === 'allergy' && (!String(finalPayload.substance ?? '').trim() || !String(finalPayload.category ?? '').trim())) return 'substance and category are required.'
    if ((requestItem.target_type === 'reminder' || requestItem.target_type === 'appointment') && !String(finalPayload.title ?? '').trim()) return 'title is required.'
    if ((requestItem.target_type === 'medication_regimen' || requestItem.target_type === 'medication_event') && !String(finalPayload.drug_name ?? finalPayload.display_name ?? '').trim()) return 'medication name is required.'
    return ''
  }

  const submit = () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    onSubmit(compactFinal, publishMode, dirty)
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
        <div className="cmo-title-row">
          <div>
            <div className="cmo-kpi-label">Structured final value</div>
            <div className="cmo-subtitle" style={{ marginTop: 4 }}>
              {dirty ? 'Unsaved final-value edits' : 'Final value matches user proposal'}
            </div>
          </div>
          <label style={{ minWidth: 260 }}>
            <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>Publish gate</div>
            <select className="cmo-select" value={publishMode} onChange={(event) => setPublishMode(event.target.value as PublishMode)}>
              {(Object.keys(PUBLISH_MODE_COPY) as PublishMode[]).map((mode) => <option key={mode} value={mode}>{PUBLISH_MODE_COPY[mode].label}</option>)}
            </select>
          </label>
        </div>
        <div className="cmo-subtitle" style={{ marginTop: 8 }}>{modeCopy.help}</div>
      </div>

      <div className="cmo-card table-wrap" style={{ marginTop: 10, overflow: 'auto' }}>
        <table className="cmo-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Current official value</th>
              <th>User proposed value</th>
              <th>CMO final value</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => {
              const currentValue = current[field]
              const proposedValue = proposed[field]
              const finalValue = finalPayload[field] ?? ''
              const modified = valueToText(finalValue) !== valueToText(proposedValue)
              return (
                <tr key={field}>
                  <td style={{ fontWeight: 800, color: '#334155' }}>
                    {field}
                    {modified && <span className="cmo-badge" style={{ marginLeft: 6, background: '#fef3c7', color: '#92400e' }}>modified</span>}
                  </td>
                  <td style={{ fontSize: 12, color: '#475569' }}>{valueToText(currentValue)}</td>
                  <td style={{ fontSize: 12, color: '#475569' }}>{valueToText(proposedValue)}</td>
                  <td>{renderFinalValueInput(field, finalValue, requestItem.target_type, setField)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="cmo-card cmo-section" style={{ marginTop: 10, background: '#fff1f2', borderColor: '#fecdd3', color: '#be123c' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
        <details className="cmo-subtitle">
          <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Raw payload preview</summary>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', marginTop: 8 }}>{JSON.stringify({ current, proposed, final: compactFinal }, null, 2)}</pre>
        </details>
        <button className="cmo-button primary" disabled={busy} onClick={submit}>{modeCopy.submit}</button>
      </div>
    </div>
  )
}

function renderFinalValueInput(field: string, value: unknown, targetType: string, setField: (field: string, value: unknown) => void): ReactNode {
  if (typeof value === 'boolean' || field === 'is_suspected' || field === 'is_patient_managed') {
    return (
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => setField(field, event.target.checked)} />
        <span className="cmo-subtitle">{Boolean(value) ? 'Yes' : 'No'}</span>
      </label>
    )
  }
  if (field === 'tier') {
    return <select className="cmo-select" value={String(value || 3)} onChange={(event) => setField(field, Number(event.target.value))}>{[1, 2, 3].map((tier) => <option key={tier} value={tier}>Tier {tier}</option>)}</select>
  }
  if (field === 'status') {
    const options = targetType === 'allergy'
      ? ['confirmed', 'suspected', 'not_sure', 'ruled_out']
      : targetType === 'reminder' || targetType === 'appointment'
        ? ['active', 'completed', 'dismissed', 'deleted']
        : targetType === 'medication_regimen' || targetType === 'medication_event'
          ? ['active', 'inactive', 'completed', 'deleted']
          : ['underlying', 'following', 'resolved', 'active']
    return <select className="cmo-select" value={String(value || options[0])} onChange={(event) => setField(field, event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
  }
  if (field === 'category') {
    const options = ['medication', 'food', 'contrast_agent', 'environmental', 'drug', 'other']
    return <select className="cmo-select" value={String(value || options[0])} onChange={(event) => setField(field, event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
  }
  if (field === 'severity') {
    const options = ['mild', 'moderate', 'severe', 'anaphylaxis']
    return <select className="cmo-select" value={String(value || options[1])} onChange={(event) => setField(field, event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
  }
  if (field === 'type') {
    const options = ['follow_up', 'health_check', 'screening', 'vaccine', 'medication_refill', 'measurement', 'document_upload', 'custom']
    return <select className="cmo-select" value={String(value || options[0])} onChange={(event) => setField(field, event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
  }
  if (field.includes('date')) {
    return <input className="cmo-input" type="date" value={String(value || '')} onChange={(event) => setField(field, event.target.value)} />
  }
  return <input className="cmo-input" value={String(value ?? '')} onChange={(event) => setField(field, event.target.value)} />
}

function DiffBox({ title, data, empty }: { title: string; data: Record<string, unknown> | null; empty: string }) {
  return (
    <div className="cmo-card cmo-section" style={{ background: '#fff' }}>
      <div className="cmo-kpi-label">{title}</div>
      {data && Object.keys(data).length > 0 ? (
        <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, color: '#334155', maxHeight: 260, overflow: 'auto' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : (
        <div className="cmo-muted" style={{ marginTop: 8 }}>{empty}</div>
      )}
    </div>
  )
}

function ProblemRow({ problem }: { problem: Problem }) {
  const tier = tierStyle(problem.tier)
  return (
    <div className="cmo-list-item cmo-row">
      <div>
        <strong>{problem.display_layman || problem.display_name}</strong>
        <div className="cmo-subtitle">{normalizeMemberName(problem.member_name)} · {problem.icd10_code ?? '無 ICD'} · {statusLabel(problem.status)}</div>
      </div>
      <span className="cmo-badge" style={{ background: tier.bg, color: tier.fg }}>{tier.label}</span>
    </div>
  )
}

function ProblemCard({ problem, documents, metrics, busy, onAction, onTierChange }: {
  problem: Problem
  documents: HealthDocument[]
  metrics: ConceptMetric
  busy: boolean
  onAction: (id: number, action: 'verify' | 'publish' | 'unpublish') => void
  onTierChange: (id: number, tier: 1 | 2 | 3) => void
}) {
  const tier = tierStyle(problem.tier)
  const readiness = problemReadiness(problem)
  const sourceDoc = problem.source_document_id ? documents.find((doc) => doc.id === problem.source_document_id) ?? null : null
  return (
    <article className="cmo-card cmo-section">
      <div className="cmo-title-row">
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span className="cmo-badge" style={{ background: tier.bg, color: tier.fg }}>{tier.label}</span>
            <span className="cmo-badge" style={{ background: '#f8fafc', color: '#475569' }}>{normalizeMemberName(problem.member_name)}</span>
            <span className="cmo-badge" style={{ background: '#f1f5f9', color: '#334155' }}>{statusLabel(problem.status)}</span>
            {problem.is_suspected && <span className="cmo-badge" style={{ background: '#fef3c7', color: '#a16207' }}>疑似</span>}
            {problem.is_verified && <span className="cmo-badge" style={{ background: '#ecfdf5', color: '#047857' }}>Verified</span>}
            {problem.is_published && <span className="cmo-badge" style={{ background: '#eff6ff', color: '#1d4ed8' }}>Published</span>}
          </div>
          <h3 className="cmo-title" style={{ fontSize: 18 }}>{problem.display_layman || problem.display_name}</h3>
          <div className="cmo-subtitle">{problem.display_name} · {problem.icd10_code ?? '無 ICD-10'} · {normalizeMemberName(problem.member_name)} · 起始 {formatDate(problem.onset_date)}</div>
          <div className="cmo-subtitle" style={{ marginTop: 6 }}>
            {sourceDoc ? (
              <>
                Evidence: {sourceDocumentLabel(sourceDoc)} · {sourceDoc.processing_status_label ?? documentProcessingTone(sourceDoc.processing_status).label} · {visibilityTone(sourceDoc).label}
              </>
            ) : problem.source_document_id ? (
              <>Evidence id {problem.source_document_id} is recorded but not visible in this patient document list.</>
            ) : (
              <>Evidence missing: assign a same-patient source before publishing high-risk or evidence-backed content.</>
            )}
          </div>
          <div className="cmo-chipbar" style={{ marginTop: 10 }}>
            <span className="cmo-chip">{metrics.diagnoses} Dx</span>
            <span className="cmo-chip">{metrics.medications} Med</span>
            <span className="cmo-chip">{metrics.labs} Lab</span>
            <span className="cmo-chip">{metrics.measurements} Vitals</span>
            <span className="cmo-chip">{metrics.documents} Docs</span>
            <span className="cmo-chip">{readiness.done}/{readiness.total} ready</span>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <TierUpgradeControl tier={problem.tier} disabled={busy} onChange={(nextTier) => onTierChange(problem.id, nextTier)} />
          <VerifyPublishPanel problem={problem} busy={busy} onAction={onAction} />
        </div>
      </div>
      {problem.cmo_note && <div className="cmo-card cmo-section" style={{ marginTop: 12, background: '#f8fafc' }}>{problem.cmo_note}</div>}
    </article>
  )
}

function PatientSurfaceEditor({
  data,
  entryBusy,
  problemForm,
  conditionForm,
  medicationForm,
  reminderForm,
  recordForm,
  setProblemForm,
  setConditionForm,
  setMedicationForm,
  setReminderForm,
  setRecordForm,
  onCreateProblem,
  onCreateCondition,
  onCreateMedication,
  onToggleMedication,
  onCreateReminder,
  onToggleReminder,
  onCreateRecord,
}: {
  data: PatientData
  entryBusy: string
  problemForm: ProblemForm
  conditionForm: ConditionForm
  medicationForm: MedicationForm
  reminderForm: ReminderForm
  recordForm: RecordForm
  setProblemForm: (value: ProblemForm) => void
  setConditionForm: (value: ConditionForm) => void
  setMedicationForm: (value: MedicationForm) => void
  setReminderForm: (value: ReminderForm) => void
  setRecordForm: (value: RecordForm) => void
  onCreateProblem: () => void
  onCreateCondition: () => void
  onCreateMedication: () => void
  onToggleMedication: (medication: Medication) => void
  onCreateReminder: () => void
  onToggleReminder: (reminder: Reminder) => void
  onCreateRecord: () => void
}) {
  const activeMeds = data.medications.filter((medication) => medication.is_active)
  const upcoming = (data.reminders ?? []).filter((reminder) => !reminder.is_done)

  return (
    <section className="cmo-list">
      <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
        <div className="cmo-title-row">
          <div>
            <div className="cmo-kpi-label">CMO structured entry · feeds patient-facing surfaces</div>
            <h2 className="cmo-section-title" style={{ marginTop: 6 }}>病人端內容填寫工作區</h2>
            <div className="cmo-subtitle">
              這裡不是讓 CMO 從零打病歷，而是補齊 patient 端「醫師健康摘要 / 慢性病管理 / 藥物追蹤 / 回診紀錄」需要的結構化資料。Problem、Condition、Medication 需 publish 後才會顯示給病人。
            </div>
          </div>
          <div className="cmo-chipbar" style={{ justifyContent: 'flex-end' }}>
            <span className="cmo-chip">{data.problems.length} Problems</span>
            <span className="cmo-chip">{data.conditions.length} Conditions</span>
            <span className="cmo-chip">{activeMeds.length} Active meds</span>
            <span className="cmo-chip">{upcoming.length} Follow-ups</span>
          </div>
        </div>
      </div>

      <div className="cmo-grid-2">
        <div className="cmo-card cmo-section">
          <h3 className="cmo-section-title">醫師健康摘要 · Problem Builder</h3>
          <div className="cmo-subtitle">建立 Problem 不會立刻發布；CMO 需在 Problem tab verify / publish。</div>
          <QuickChipRow>
            {PROBLEM_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                className="cmo-chip"
                onClick={() => setProblemForm({
                  ...problemForm,
                  display_name: template.display_name,
                  display_layman: template.display_layman,
                  icd10_code: template.icd10_code,
                  status: template.status,
                  tier: template.tier,
                  is_suspected: template.status === 'following',
                })}
              >
                {template.label}
              </button>
            ))}
          </QuickChipRow>
          <div className="cmo-field-grid">
            <FormField label="Problem name">
              <input className="cmo-input" value={problemForm.display_name} onChange={(event) => setProblemForm({ ...problemForm, display_name: event.target.value })} placeholder="Hypertension" />
            </FormField>
            <FormField label="病人端白話名稱">
              <input className="cmo-input" value={problemForm.display_layman} onChange={(event) => setProblemForm({ ...problemForm, display_layman: event.target.value })} placeholder="高血壓（血管壓力長期偏高）" />
            </FormField>
            <FormField label="ICD-10">
              <input className="cmo-input" value={problemForm.icd10_code} onChange={(event) => setProblemForm({ ...problemForm, icd10_code: event.target.value })} placeholder="I10" />
            </FormField>
            <FormField label="狀態">
              <select className="cmo-select" value={problemForm.status} onChange={(event) => setProblemForm({ ...problemForm, status: event.target.value as ProblemStatus })}>
                <option value="underlying">Underlying / 長期</option>
                <option value="following">Following / 追蹤</option>
                <option value="resolved">Resolved / 已結案</option>
              </select>
            </FormField>
            <FormField label="Tier">
              <select className="cmo-select" value={problemForm.tier} onChange={(event) => setProblemForm({ ...problemForm, tier: Number(event.target.value) as 1 | 2 | 3 })}>
                <option value={1}>Tier 1 · 保命紅區</option>
                <option value={2}>Tier 2 · 重要追蹤</option>
                <option value={3}>Tier 3 · 一般資訊</option>
              </select>
            </FormField>
            <FormField label="起始日期">
              <input className="cmo-input" type="date" value={problemForm.onset_date} onChange={(event) => setProblemForm({ ...problemForm, onset_date: event.target.value })} />
            </FormField>
          </div>
          <label className="cmo-chip" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={problemForm.is_suspected} onChange={(event) => setProblemForm({ ...problemForm, is_suspected: event.target.checked })} />
            疑似 / 需追蹤
          </label>
          <NoteTemplateRow value={problemForm.cmo_note} onChange={(value) => setProblemForm({ ...problemForm, cmo_note: value })} />
          <button className="cmo-button primary" type="button" disabled={entryBusy === 'problem'} onClick={onCreateProblem}>
            建立 Problem，待 verify/publish
          </button>
        </div>

        <div className="cmo-card cmo-section">
          <h3 className="cmo-section-title">慢性病管理 · Condition Entry</h3>
          <div className="cmo-subtitle">用於 patient 慢性病管理與 Problem candidate；建立後仍需在 publish gate 發布，避免病人看到未審核正式資料。</div>
          <QuickChipRow>
            {CONDITION_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                className="cmo-chip"
                onClick={() => setConditionForm({ ...conditionForm, display_name: template.display_name, icd10_code: template.icd10_code })}
              >
                {template.label}
              </button>
            ))}
          </QuickChipRow>
          <div className="cmo-field-grid">
            <FormField label="疾病/病史名稱">
              <input className="cmo-input" value={conditionForm.display_name} onChange={(event) => setConditionForm({ ...conditionForm, display_name: event.target.value })} placeholder="高血壓" />
            </FormField>
            <FormField label="ICD-10">
              <input className="cmo-input" value={conditionForm.icd10_code} onChange={(event) => setConditionForm({ ...conditionForm, icd10_code: event.target.value })} placeholder="I10" />
            </FormField>
            <FormField label="狀態">
              <select className="cmo-select" value={conditionForm.status} onChange={(event) => setConditionForm({ ...conditionForm, status: event.target.value as 'active' | 'resolved' })}>
                <option value="active">Active</option>
                <option value="resolved">Resolved</option>
              </select>
            </FormField>
            <FormField label="起始日期">
              <input className="cmo-input" type="date" value={conditionForm.onset_date} onChange={(event) => setConditionForm({ ...conditionForm, onset_date: event.target.value })} />
            </FormField>
          </div>
          <NoteTemplateRow value={conditionForm.note} onChange={(value) => setConditionForm({ ...conditionForm, note: value })} />
          <label className="cmo-chip" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={conditionForm.sync_problem} onChange={(event) => setConditionForm({ ...conditionForm, sync_problem: event.target.checked })} />
            同步建立 Problem candidate
          </label>
          <button className="cmo-button primary" type="button" disabled={entryBusy === 'condition'} onClick={onCreateCondition}>
            新增疾病史
          </button>
        </div>
      </div>

      <div className="cmo-grid-2">
        <div className="cmo-card cmo-section">
          <h3 className="cmo-section-title">藥物追蹤 · Regimen Entry</h3>
          <div className="cmo-subtitle">CMO 確認 active / stopped；建立後仍需 publish，劑量異動應回到 source evidence 或 draft review。</div>
          <QuickChipRow>
            {MEDICATION_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                className="cmo-chip"
                onClick={() => setMedicationForm({
                  ...medicationForm,
                  drug_name: template.drug_name,
                  dose: template.dose,
                  frequency: template.frequency,
                  intent: template.intent,
                  note: template.note,
                })}
              >
                {template.label}
              </button>
            ))}
          </QuickChipRow>
          <div className="cmo-field-grid">
            <FormField label="藥名">
              <input className="cmo-input" value={medicationForm.drug_name} onChange={(event) => setMedicationForm({ ...medicationForm, drug_name: event.target.value })} placeholder="Amlodipine" />
            </FormField>
            <FormField label="劑量">
              <input className="cmo-input" value={medicationForm.dose} onChange={(event) => setMedicationForm({ ...medicationForm, dose: event.target.value })} placeholder="5 mg" />
            </FormField>
            <FormField label="頻率">
              <select className="cmo-select" value={medicationForm.frequency} onChange={(event) => setMedicationForm({ ...medicationForm, frequency: event.target.value })}>
                <option value="每日一次">每日一次</option>
                <option value="每日兩次">每日兩次</option>
                <option value="每日三次">每日三次</option>
                <option value="每週一次">每週一次</option>
                <option value="需要時服用">需要時服用</option>
              </select>
            </FormField>
            <FormField label="療程類型">
              <select className="cmo-select" value={medicationForm.intent} onChange={(event) => setMedicationForm({ ...medicationForm, intent: event.target.value as MedicationForm['intent'] })}>
                <option value="chronic">慢性處方</option>
                <option value="acute">固定療程</option>
                <option value="prn">PRN / 需要時</option>
              </select>
            </FormField>
            <FormField label="開始">
              <input className="cmo-input" type="date" value={medicationForm.started_on} onChange={(event) => setMedicationForm({ ...medicationForm, started_on: event.target.value })} />
            </FormField>
            <FormField label="結束">
              <input className="cmo-input" type="date" value={medicationForm.ended_on} onChange={(event) => setMedicationForm({ ...medicationForm, ended_on: event.target.value })} />
            </FormField>
          </div>
          <NoteTemplateRow value={medicationForm.note} onChange={(value) => setMedicationForm({ ...medicationForm, note: value })} />
          <button className="cmo-button primary" type="button" disabled={entryBusy === 'medication'} onClick={onCreateMedication}>
            新增藥物療程
          </button>
          <RecordList title="目前 active medication" empty="沒有 active medication">
            {activeMeds.slice(0, 8).map((medication) => (
              <div className="cmo-list-item cmo-row" key={medication.id}>
                <div>
                  <strong>{medication.drug_name}</strong>
                  <div className="cmo-subtitle">{[medication.dose, medication.frequency, medication.intent].filter(Boolean).join(' · ') || 'No regimen detail'}</div>
                </div>
                <button className="cmo-button" type="button" disabled={entryBusy === `med-${medication.id}`} onClick={() => onToggleMedication(medication)}>標記停用</button>
              </div>
            ))}
          </RecordList>
        </div>

        <div className="cmo-card cmo-section">
          <h3 className="cmo-section-title">回診紀錄 · Follow-up Task</h3>
          <div className="cmo-subtitle">這是可處理的追蹤事項；不是單純 notification。可由 encounter / problem / medication 後續自動生成。</div>
          <QuickChipRow>
            {FOLLOWUP_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                className="cmo-chip"
                onClick={() => setReminderForm({ ...reminderForm, title: template.title, repeat_type: template.repeat_type, note: template.note })}
              >
                {template.label}
              </button>
            ))}
          </QuickChipRow>
          <div className="cmo-field-grid">
            <FormField label="事項">
              <input className="cmo-input" value={reminderForm.title} onChange={(event) => setReminderForm({ ...reminderForm, title: event.target.value })} placeholder="心臟科回診" />
            </FormField>
            <FormField label="日期">
              <input className="cmo-input" type="date" value={reminderForm.scheduled_date} onChange={(event) => setReminderForm({ ...reminderForm, scheduled_date: event.target.value })} />
            </FormField>
            <FormField label="重複">
              <select className="cmo-select" value={reminderForm.repeat_type} onChange={(event) => setReminderForm({ ...reminderForm, repeat_type: event.target.value as ReminderForm['repeat_type'] })}>
                <option value="none">不重複</option>
                <option value="monthly">每月</option>
                <option value="yearly">每年</option>
              </select>
            </FormField>
          </div>
          <NoteTemplateRow value={reminderForm.note} onChange={(value) => setReminderForm({ ...reminderForm, note: value })} />
          <button className="cmo-button primary" type="button" disabled={entryBusy === 'reminder'} onClick={onCreateReminder}>
            新增回診/追蹤
          </button>
          <RecordList title="待處理回診/追蹤" empty="沒有待處理回診">
            {upcoming.slice(0, 8).map((reminder) => (
              <div className="cmo-list-item cmo-row" key={reminder.id}>
                <div>
                  <strong>{reminder.title}</strong>
                  <div className="cmo-subtitle">{formatDate(reminder.scheduled_date)} · {reminder.note ?? 'No note'}</div>
                </div>
                <button className="cmo-button" type="button" disabled={entryBusy === `reminder-${reminder.id}`} onClick={() => onToggleReminder(reminder)}>完成</button>
              </div>
            ))}
          </RecordList>
        </div>
      </div>

      <div className="cmo-card cmo-section">
        <h3 className="cmo-section-title">量測/檢驗摘要 · Structured Record</h3>
        <div className="cmo-subtitle">只用於補登已知來源或 CMO 確認值；不可作為未審核 OCR 數值直接發布。</div>
        <div className="cmo-field-grid">
          <FormField label="類型">
            <select
              className="cmo-select"
              value={recordForm.record_type}
              onChange={(event) => {
                const option = RECORD_TYPE_OPTIONS.find((item) => item.value === event.target.value)
                setRecordForm({ ...recordForm, record_type: event.target.value, unit: option?.unit ?? recordForm.unit })
              }}
            >
              {RECORD_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FormField>
          <FormField label="數值 1">
            <input className="cmo-input" value={recordForm.value1} onChange={(event) => setRecordForm({ ...recordForm, value1: event.target.value })} placeholder="例如 130 或 7.2" />
          </FormField>
          <FormField label="數值 2">
            <input className="cmo-input" value={recordForm.value2} onChange={(event) => setRecordForm({ ...recordForm, value2: event.target.value })} placeholder="血壓舒張壓等，可空白" />
          </FormField>
          <FormField label="單位">
            <input className="cmo-input" value={recordForm.unit} onChange={(event) => setRecordForm({ ...recordForm, unit: event.target.value })} />
          </FormField>
          <FormField label="時間">
            <input className="cmo-input" type="datetime-local" value={recordForm.recorded_at} onChange={(event) => setRecordForm({ ...recordForm, recorded_at: event.target.value })} />
          </FormField>
          <FormField label="來源/備註">
            <input className="cmo-input" value={recordForm.note} onChange={(event) => setRecordForm({ ...recordForm, note: event.target.value })} placeholder="例：檢驗報告第 2 頁，CMO 確認" />
          </FormField>
        </div>
        <button className="cmo-button primary" type="button" disabled={entryBusy === 'record'} onClick={onCreateRecord}>
          新增健康紀錄
        </button>
      </div>
    </section>
  )
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  )
}

function QuickChipRow({ children }: { children: ReactNode }) {
  return <div className="cmo-chipbar" style={{ margin: '10px 0 12px' }}>{children}</div>
}

function NoteTemplateRow({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ marginTop: 10, marginBottom: 12 }}>
      <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>CMO note / source note</div>
      <div className="cmo-chipbar" style={{ marginBottom: 8 }}>
        {NOTE_TEMPLATES.map((note) => (
          <button key={note} type="button" className="cmo-chip" onClick={() => onChange(value ? `${value}\n${note}` : note)}>
            {note}
          </button>
        ))}
      </div>
      <textarea className="cmo-textarea" rows={3} value={value} onChange={(event) => onChange(event.target.value)} placeholder="CMO-only note 或 source trace；病人端不直接顯示。" />
    </div>
  )
}

function RecordList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <div style={{ marginTop: 14 }}>
      <div className="cmo-kpi-label" style={{ marginBottom: 8 }}>{title}</div>
      <div className="cmo-list">
        {hasChildren ? children : <div className="cmo-muted">{empty}</div>}
      </div>
    </div>
  )
}

function TierUpgradeControl({ tier, disabled, onChange }: { tier: number; disabled: boolean; onChange: (tier: 1 | 2 | 3) => void }) {
  return (
    <div className="cmo-segment" title="Tier change is a CMO decision and should be auditable in production.">
      {([1, 2, 3] as const).map((nextTier) => (
        <button
          key={nextTier}
          type="button"
          disabled={disabled || tier === nextTier}
          className={tier === nextTier ? 'active' : ''}
          onClick={() => onChange(nextTier)}
        >
          T{nextTier}
        </button>
      ))}
    </div>
  )
}

function VerifyPublishPanel({ problem, busy, onAction }: { problem: Problem; busy: boolean; onAction: (id: number, action: 'verify' | 'publish' | 'unpublish') => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {!problem.is_verified && <button className="cmo-button" disabled={busy} onClick={() => onAction(problem.id, 'verify')}>Verify</button>}
      {problem.is_verified && !problem.is_published && <button className="cmo-button primary" disabled={busy} onClick={() => onAction(problem.id, 'publish')}>Publish</button>}
      {problem.is_published && <button className="cmo-button danger" disabled={busy} onClick={() => onAction(problem.id, 'unpublish')}>Unpublish</button>}
    </div>
  )
}

function PublishReadinessPanel({ items }: { items: ReturnType<typeof readinessChecklist> }) {
  return (
    <div id="publish-readiness" className="cmo-card cmo-section" style={{ scrollMarginTop: 90 }}>
      <h2 className="cmo-section-title">Publish Readiness Checklist</h2>
      <div className="cmo-list">
        {items.map((item) => (
          <div key={item.label} className="cmo-list-item cmo-row">
            <div>
              <strong>{item.label}</strong>
              <div className="cmo-subtitle">{item.detail}</div>
            </div>
            <span className="cmo-badge" style={{ background: item.done ? '#ecfdf5' : '#fff1f2', color: item.done ? '#047857' : '#be123c' }}>
              {item.done ? 'Ready' : 'Needs review'}
            </span>
          </div>
        ))}
      </div>
      <div className="cmo-subtitle" style={{ marginTop: 12 }}>
        Publish remains a CMO action. This panel prevents hidden blockers before patient-facing release.
      </div>
    </div>
  )
}

function PatientFacingPreview({ problems }: { problems: Problem[] }) {
  const published = problems.filter((problem) => problem.is_published)
  return (
    <div id="patient-facing-preview" className="cmo-card cmo-section" style={{ scrollMarginTop: 90 }}>
      <h2 className="cmo-section-title">Patient-facing Preview</h2>
      {published.length === 0 ? (
        <div className="cmo-muted">No published problem will be visible to the patient yet.</div>
      ) : (
        <div className="cmo-list">
          {published.map((problem) => (
            <div key={problem.id} className="cmo-list-item">
              <div className="cmo-row">
                <strong>{problem.display_layman || problem.display_name}</strong>
                <span className="cmo-badge" style={{ background: '#eff6ff', color: '#1d4ed8' }}>Patient visible</span>
              </div>
              <div className="cmo-subtitle">{normalizeMemberName(problem.member_name)} · {statusLabel(problem.status)} · {problem.icd10_code ?? '無 ICD'} · CMO notes hidden</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ClinicalPublishBadge({ verified, published }: { verified?: boolean; published?: boolean }) {
  const copy = published ? 'Patient visible' : verified ? 'Verified, not published' : 'Needs CMO verify'
  const bg = published ? '#eff6ff' : verified ? '#ecfdf5' : '#fff7ed'
  const fg = published ? '#1d4ed8' : verified ? '#047857' : '#c2410c'
  return <span className="cmo-badge" style={{ background: bg, color: fg }}>{copy}</span>
}

function NonProblemPublishPanel({
  documents,
  conditions,
  medications,
  busy,
  onConditionAction,
  onMedicationAction,
  compact = false,
}: {
  documents: HealthDocument[]
  conditions: UnlinkedCondition[]
  medications: Medication[]
  busy: string
  onConditionAction: (conditionId: number, action: 'publish' | 'unpublish') => void
  onMedicationAction: (medicationId: number, action: 'publish' | 'unpublish') => void
  compact?: boolean
}) {
  const documentById = new Map(documents.map((doc) => [doc.id, doc]))
  const rows = [
    ...conditions.map((condition) => ({
      key: `condition-${condition.id}`,
      type: 'condition' as const,
      id: condition.id,
      title: condition.display_name ?? `Condition #${condition.id}`,
      detail: [normalizeMemberName(condition.member_name), condition.icd10_code ?? '無 ICD', condition.status ?? 'no status'].filter(Boolean).join(' · '),
      verified: Boolean(condition.is_verified),
      published: Boolean(condition.is_published),
      source: condition.source_document_id,
      sourceDoc: condition.source_document_id ? documentById.get(condition.source_document_id) ?? null : null,
    })),
    ...medications.map((medication) => ({
      key: `medication-${medication.id}`,
      type: 'medication' as const,
      id: medication.id,
      title: medication.drug_name,
      detail: [normalizeMemberName(medication.member_name), medication.dose, medication.frequency, medication.intent, medication.is_active ? 'active' : 'inactive'].filter(Boolean).join(' · '),
      verified: Boolean(medication.is_verified),
      published: Boolean(medication.is_published),
      source: medication.source_document_id,
      sourceDoc: medication.source_document_id ? documentById.get(medication.source_document_id) ?? null : null,
    })),
  ]

  if (rows.length === 0) {
    return compact ? null : (
      <div className="cmo-card cmo-section">
        <h2 className="cmo-section-title">Condition / Medication Publish Gate</h2>
        <div className="cmo-muted">沒有待發布的疾病史或用藥。</div>
      </div>
    )
  }

  const content = (
    <>
      {!compact && (
        <div className="cmo-title-row" style={{ marginBottom: 10 }}>
          <div>
            <h2 className="cmo-section-title">Condition / Medication Publish Gate</h2>
            <div className="cmo-subtitle">CMO 建立或修改後先留在 gate；Publish 後才會進入 User 端疾病與用藥頁。</div>
          </div>
          <span className="cmo-badge" style={{ background: '#fff7ed', color: '#c2410c' }}>{rows.length} pending</span>
        </div>
      )}
      <div className="cmo-list">
        {rows.map((row) => {
          const action = row.published ? 'unpublish' : 'publish'
          const busyKey = `${row.type}-${row.id}-${action}`
          const disabled = Boolean(busy) || (!row.published && !row.verified)
          return (
            <div key={row.key} className="cmo-list-item cmo-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span className="cmo-badge" style={{ background: '#f1f5f9', color: '#475569' }}>{row.type}</span>
                  <ClinicalPublishBadge verified={row.verified} published={row.published} />
                  <span className="cmo-badge" style={{ background: row.sourceDoc ? '#ecfdf5' : row.source ? '#fef3c7' : '#fff7ed', color: row.sourceDoc ? '#047857' : row.source ? '#a16207' : '#c2410c' }}>
                    {row.sourceDoc ? 'Evidence linked' : row.source ? 'Evidence id only' : 'Evidence missing'}
                  </span>
                </div>
                <strong>{row.title}</strong>
                <div className="cmo-subtitle">{row.detail || 'No detail'}</div>
                <div className="cmo-subtitle" style={{ marginTop: 6 }}>
                  {row.sourceDoc ? (
                    <>
                      Source: {sourceDocumentLabel(row.sourceDoc)} · {row.sourceDoc.processing_status_label ?? documentProcessingTone(row.sourceDoc.processing_status).label} · {visibilityTone(row.sourceDoc).label}
                    </>
                  ) : row.source ? (
                    <>Source document id {row.source} is recorded but not visible in this patient document list.</>
                  ) : (
                    <>Source missing: assign a same-patient document before relying on this row as evidence-backed.</>
                  )}
                </div>
              </div>
              <button
                type="button"
                className={`cmo-button ${row.published ? 'danger' : 'primary'}`}
                disabled={disabled}
                title={!row.published && !row.verified ? '請先由 CMO 更新或確認這筆資料，再發布。' : undefined}
                onClick={() => row.type === 'condition' ? onConditionAction(row.id, action) : onMedicationAction(row.id, action)}
              >
                {busy === busyKey ? 'Saving...' : row.published ? 'Unpublish' : row.verified ? 'Publish' : '需確認'}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )

  if (compact) {
    return <div style={{ display: 'grid', gap: 8 }}>{content}</div>
  }
  return <div className="cmo-card cmo-section">{content}</div>
}

function UnlinkedItemsPanel({ items }: { items: UnlinkedItems }) {
  const total = items.conditions.length + items.medications.length
  return (
    <div className="cmo-card cmo-section" style={{ gridColumn: '1 / -1' }}>
      <div className="cmo-title-row">
        <h2 className="cmo-section-title" style={{ margin: 0 }}>Unlinked Items</h2>
        <span className="cmo-badge" style={{ background: total ? '#fef3c7' : '#ecfdf5', color: total ? '#a16207' : '#047857' }}>{total} pending</span>
      </div>
      <div className="cmo-grid-2" style={{ marginTop: 12 }}>
        <UnlinkedColumn title="Conditions" rows={items.conditions.map((item) => ({
          id: `condition-${item.id}`,
          title: item.display_name || 'Unnamed condition',
          detail: `${item.icd10_code ?? 'no ICD'} · ${item.status ?? 'status unknown'}`,
        }))} />
        <UnlinkedColumn title="Medications" rows={items.medications.map((item) => ({
          id: `medication-${item.id}`,
          title: item.drug_name,
          detail: [item.dose, item.frequency, item.intent].filter(Boolean).join(' · ') || 'No regimen detail',
        }))} />
      </div>
      <div className="cmo-subtitle" style={{ marginTop: 12 }}>
        BACKEND_NEEDED: persistent many-to-many concept-map join tables. The current endpoint exposes unlinked rows but does not persist link/unlink yet.
      </div>
    </div>
  )
}

function UnlinkedColumn({ title, rows }: { title: string; rows: Array<{ id: string; title: string; detail: string }> }) {
  return (
    <div>
      <div className="cmo-kpi-label" style={{ marginBottom: 8 }}>{title}</div>
      <div className="cmo-list">
        {rows.length === 0 ? <div className="cmo-muted">No unlinked {title.toLowerCase()}.</div> : rows.map((row) => (
          <div className="cmo-list-item" key={row.id}>
            <strong>{row.title}</strong>
            <div className="cmo-subtitle">{row.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TimelinePanel({ items }: { items: Array<{ id: string; kind: string; title: string; detail: string; date: string | null }> }) {
  return (
    <div className="cmo-card cmo-section">
      <h2 className="cmo-section-title">近期資料時間線</h2>
      <div className="cmo-list">
        {items.length === 0 ? <div className="cmo-muted">尚無近期資料。</div> : items.map((item) => (
          <div className="cmo-list-item" key={`${item.kind}-${item.id}`}>
            <div className="cmo-row">
              <strong>{item.title}</strong>
              <span className="cmo-badge" style={{ background: '#f1f5f9', color: '#334155' }}>{item.kind}</span>
            </div>
            <div className="cmo-subtitle">{formatDate(item.date)} · {item.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecordTable({ records }: { records: HealthRecord[] }) {
  return (
    <div className="cmo-card table-wrap">
      <table className="cmo-table">
        <thead><tr><th>日期</th><th>成員</th><th>類型</th><th>數值</th><th>備註</th></tr></thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}><td>{formatDate(record.recorded_at)}</td><td>{record.member_name}</td><td>{RECORD_LABELS[record.record_type] ?? record.record_type}</td><td><strong>{formatRecordValue(record)}</strong></td><td>{record.note ?? ''}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SourceDocumentReviewPanel({
  documents,
  auditEntries,
  busy,
  onStatusUpdate,
  onStatusRevert,
}: {
  documents: HealthDocument[]
  auditEntries: AuditEntry[]
  busy: string
  onStatusUpdate: (doc: HealthDocument, status: DocumentStatusAction, note: string) => Promise<void>
  onStatusRevert: (entry: AuditEntry, note: string) => Promise<void>
}) {
  const [documentFilter, setDocumentFilter] = useState<'all' | 'unlinked' | 'hidden' | 'needs_review' | 'confirmed'>('all')
  const [auditFilter, setAuditFilter] = useState<'assignments' | 'all_document_events'>('assignments')
  const [statusForm, setStatusForm] = useState<DocumentStatusForm>(defaultDocumentStatusForm)
  const counts = useMemo(() => {
    const linked = documents.filter((doc) => (doc.assignment_counts?.total ?? 0) > 0).length
    return {
      total: documents.length,
      linked,
      unlinked: documents.length - linked,
      visible: documents.filter((doc) => doc.patient_visible !== false && !doc.hidden_from_patient).length,
      hidden: documents.filter((doc) => doc.patient_visible === false || doc.hidden_from_patient).length,
      needsReview: documents.filter((doc) => ['uploaded', 'queued', 'extracting', 'needs_review'].includes(doc.processing_status ?? 'uploaded')).length,
      confirmed: documents.filter((doc) => doc.processing_status === 'confirmed').length,
    }
  }, [documents])
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (documentFilter === 'unlinked') return (doc.assignment_counts?.total ?? 0) === 0
      if (documentFilter === 'hidden') return doc.patient_visible === false || doc.hidden_from_patient
      if (documentFilter === 'needs_review') return ['uploaded', 'queued', 'extracting', 'needs_review'].includes(doc.processing_status ?? 'uploaded')
      if (documentFilter === 'confirmed') return doc.processing_status === 'confirmed'
      return true
    })
  }, [documentFilter, documents])
  const selectedStatusDocument = useMemo(
    () => documents.find((doc) => doc.id === statusForm.document_id) ?? null,
    [documents, statusForm.document_id],
  )
  const documentAuditEntries = useMemo(() => {
    const sourceActions = new Set(['source_document_assign', 'source_document_status_update', 'source_document_create', 'source_document_update', 'source_document_delete'])
    return auditEntries.filter((entry) => {
      if (auditFilter === 'assignments') return entry.action === 'source_document_assign'
      return sourceActions.has(entry.action) || entry.target_type === 'source_document'
    })
  }, [auditEntries, auditFilter])
  const statusAction = DOCUMENT_STATUS_ACTIONS.find((item) => item.value === statusForm.status)
  const statusBusy = selectedStatusDocument ? busy === `doc-status-${selectedStatusDocument.id}` : false
  const canSubmitStatus = Boolean(selectedStatusDocument) && statusForm.note.trim().length >= 6 && !statusBusy

  return (
    <div className="cmo-card cmo-section">
      <div className="cmo-title-row">
        <div>
          <div className="cmo-kpi-label">Document review</div>
          <h2 className="cmo-section-title" style={{ marginTop: 6 }}>來源文件狀態與可追溯性</h2>
          <div className="cmo-subtitle">這裡顯示文件處理狀態、病人端可見性與已連結 clinical rows；不是 OCR/AI 完成按鈕。</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className="cmo-badge" style={{ background: '#f8fafc', color: '#475569' }}>{counts.total} docs</span>
          <span className="cmo-badge" style={{ background: counts.unlinked ? '#fff7ed' : '#ecfdf5', color: counts.unlinked ? '#c2410c' : '#047857' }}>{counts.unlinked} unlinked</span>
          <span className="cmo-badge" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{counts.visible} patient-visible</span>
          <span className="cmo-badge" style={{ background: counts.hidden ? '#fff7ed' : '#f8fafc', color: counts.hidden ? '#c2410c' : '#64748b' }}>{counts.hidden} hidden</span>
        </div>
      </div>

      <div className="cmo-field-grid" style={{ marginTop: 16 }}>
        <FormField label="文件篩選">
          <select className="cmo-select" value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value as typeof documentFilter)}>
            <option value="all">全部文件</option>
            <option value="unlinked">尚未連結 clinical row</option>
            <option value="hidden">病人端隱藏</option>
            <option value="needs_review">待處理 / 待確認</option>
            <option value="confirmed">已確認</option>
          </select>
        </FormField>
        <FormField label="Audit filter">
          <select className="cmo-select" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value as typeof auditFilter)}>
            <option value="assignments">Source assignments only</option>
            <option value="all_document_events">All document events</option>
          </select>
        </FormField>
      </div>

      <div className="cmo-card cmo-section" style={{ marginTop: 14, background: '#f8fafc' }}>
        <div className="cmo-title-row">
          <div>
            <div className="cmo-kpi-label">CMO document status workflow</div>
            <h3 className="cmo-section-title" style={{ marginTop: 4, fontSize: 18 }}>更新文件處理狀態</h3>
            <div className="cmo-subtitle">此動作只更新 source document processing status；不會 verify clinical row，也不會代表 OCR/AI 已正確擷取。</div>
          </div>
          <span className="cmo-badge" style={{ background: '#fff7ed', color: '#c2410c' }}>Audit note required</span>
        </div>
        <div className="cmo-field-grid" style={{ marginTop: 14 }}>
          <FormField label="文件">
            <select className="cmo-select" value={statusForm.document_id} onChange={(event) => setStatusForm({ ...statusForm, document_id: event.target.value })}>
              <option value="">選擇要更新的文件</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>{sourceDocumentLabel(doc)} · {doc.processing_status_label ?? documentProcessingTone(doc.processing_status).label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="新狀態">
            <select className="cmo-select" value={statusForm.status} onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value as DocumentStatusAction })}>
              {DOCUMENT_STATUS_ACTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="cmo-subtitle" style={{ marginTop: 8 }}>
          {statusAction?.help ?? '請選擇狀態'} {selectedStatusDocument ? `目前狀態：${selectedStatusDocument.processing_status_label ?? documentProcessingTone(selectedStatusDocument.processing_status).label}` : ''}
        </div>
        <textarea
          className="cmo-textarea"
          rows={3}
          style={{ marginTop: 10 }}
          value={statusForm.note}
          onChange={(event) => setStatusForm({ ...statusForm, note: event.target.value })}
          placeholder="必填。例：藥袋影像清楚，可作為 medication reconciliation 來源；尚未驗證任何 clinical row。"
        />
        <div className="cmo-row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
          <div className="cmo-subtitle" style={{ flex: '1 1 320px' }}>
            {selectedStatusDocument ? `${selectedStatusDocument.file_name} → ${statusAction?.label ?? statusForm.status}` : '尚未選擇文件'}
          </div>
          <button
            type="button"
            className="cmo-button primary"
            disabled={!canSubmitStatus}
            onClick={async () => {
              if (!selectedStatusDocument) return
              await onStatusUpdate(selectedStatusDocument, statusForm.status, statusForm.note)
              setStatusForm(defaultDocumentStatusForm())
            }}
            title={canSubmitStatus ? '寫入文件狀態、audit log 與 sync event' : '請選擇文件並輸入至少 6 個字的 CMO audit note'}
          >
            {statusBusy ? '更新中...' : 'Update status'}
          </button>
        </div>
      </div>

      <div className="cmo-grid-2" style={{ marginTop: 14 }}>
        <div>
          <div className="cmo-kpi-label" style={{ marginBottom: 8 }}>Filtered documents</div>
          <div className="cmo-list">
            {filteredDocuments.length === 0 ? <div className="cmo-muted">沒有符合條件的文件。</div> : filteredDocuments.slice(0, 6).map((doc) => {
              const statusTone = documentProcessingTone(doc.processing_status)
              const visibility = visibilityTone(doc)
              return (
                <div key={doc.id} className="cmo-list-item">
                  <div className="cmo-row">
                    <strong>{doc.file_name}</strong>
                    <span className="cmo-badge" style={{ background: statusTone.bg, color: statusTone.fg }}>{doc.processing_status_label ?? statusTone.label}</span>
                  </div>
                  <div className="cmo-subtitle">{formatDate(doc.doc_date ?? doc.created_at)} · {DOC_LABELS[doc.doc_type] ?? doc.doc_type} · {doc.processing_note ?? '尚無處理說明'}</div>
                  <div className="cmo-chipbar" style={{ marginTop: 8 }}>
                    <span className="cmo-chip" style={{ background: visibility.bg, color: visibility.fg }}>{visibility.label}</span>
                    <span className="cmo-chip">{doc.assignment_counts?.total ?? 0} linked rows</span>
                    {doc.linked_to_verified_data && <span className="cmo-chip">Linked to verified data</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div>
          <div className="cmo-kpi-label" style={{ marginBottom: 8 }}>Recent document audit</div>
          <div className="cmo-list">
            {documentAuditEntries.length === 0 ? <div className="cmo-muted">沒有符合條件的 audit event。</div> : documentAuditEntries.slice(0, 6).map((entry) => {
              const canRevert = entry.action === 'source_document_status_update' && Boolean(entry.target_id)
              const revertBusy = busy === `doc-status-revert-${entry.id}`
              return (
                <div key={entry.id} className="cmo-list-item">
                  <div className="cmo-row">
                    <strong>{entry.target_label}</strong>
                    <span className="cmo-badge" style={{ background: entry.action === 'source_document_assign' ? '#ecfdf5' : entry.action === 'source_document_status_update' ? '#eff6ff' : '#f8fafc', color: entry.action === 'source_document_assign' ? '#047857' : entry.action === 'source_document_status_update' ? '#1d4ed8' : '#475569' }}>{entry.action}</span>
                  </div>
                  <div className="cmo-subtitle">{formatDate(entry.created_at)} · {entry.target_type} · {entry.status}</div>
                  {canRevert && (
                    <button
                      type="button"
                      className="cmo-button"
                      style={{ marginTop: 8 }}
                      disabled={revertBusy}
                      onClick={async () => {
                        const note = window.prompt('請輸入復原文件狀態的 CMO audit note')
                        if (!note) return
                        await onStatusRevert(entry, note)
                      }}
                      title="只復原文件處理狀態，不會改 clinical verification"
                    >
                      {revertBusy ? '復原中...' : 'Revert status'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function SourceAssignmentPanel({
  documents,
  targets,
  form,
  busy,
  onChange,
  onAssign,
}: {
  documents: HealthDocument[]
  targets: SourceAssignmentTarget[]
  form: SourceAssignmentForm
  busy: boolean
  onChange: (value: SourceAssignmentForm) => void
  onAssign: () => void
}) {
  const documentById = useMemo(() => new Map(documents.map((doc) => [doc.id, doc])), [documents])
  const targetsForType = useMemo(() => targets.filter((target) => target.type === form.target_type), [form.target_type, targets])
  const selectedDocument = form.source_document_id ? documentById.get(form.source_document_id) : null
  const selectedTarget = targetsForType.find((target) => String(target.id) === form.target_id)
  const linkedTargets = targets.filter((target) => target.source_document_id)
  const canAssign = documents.length > 0 && Boolean(selectedTarget) && Boolean(selectedDocument) && !busy

  return (
    <div className="cmo-card cmo-section">
      <div className="cmo-title-row">
        <div>
          <div className="cmo-kpi-label">Source assignment MVP</div>
          <h2 className="cmo-section-title" style={{ marginTop: 6 }}>連結來源文件</h2>
          <div className="cmo-subtitle">
            只建立 provenance link，不會自動 verify、publish，或代表醫療內容已完成校對。
          </div>
        </div>
        <span className="cmo-badge" style={{ background: linkedTargets.length ? '#ecfdf5' : '#f8fafc', color: linkedTargets.length ? '#047857' : '#64748b' }}>
          {linkedTargets.length}/{targets.length} linked
        </span>
      </div>

      {documents.length === 0 ? (
        <div className="cmo-muted" style={{ marginTop: 12 }}>尚無可連結的文件。請先完成上傳與文件處理狀態確認。</div>
      ) : targets.length === 0 ? (
        <div className="cmo-muted" style={{ marginTop: 12 }}>尚無可連結的 Problem、Condition、Medication 或 Red-zone allergy。</div>
      ) : (
        <>
          <div className="cmo-field-grid" style={{ marginTop: 16 }}>
            <FormField label="來源文件">
              <select className="cmo-select" value={form.source_document_id} onChange={(event) => onChange({ ...form, source_document_id: event.target.value })}>
                <option value="">選擇文件</option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>{sourceDocumentLabel(doc)}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Clinical row 類型">
              <select className="cmo-select" value={form.target_type} onChange={(event) => onChange({ ...form, target_type: event.target.value as SourceAssignmentTargetType, target_id: '' })}>
                {SOURCE_ASSIGNMENT_TARGET_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="要連結的 row">
              <select className="cmo-select" value={form.target_id} onChange={(event) => onChange({ ...form, target_id: event.target.value })}>
                <option value="">{targetsForType.length ? '選擇 row' : '此類型暫無資料'}</option>
                {targetsForType.map((target) => (
                  <option key={`${target.type}-${target.id}`} value={target.id}>
                    {target.label} · {target.detail}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="CMO audit note">
              <input
                className="cmo-input"
                value={form.note}
                onChange={(event) => onChange({ ...form, note: event.target.value })}
                placeholder="例如：檢驗報告第 2 頁支持此 Problem"
              />
            </FormField>
          </div>

          <div className="cmo-row" style={{ marginTop: 14, alignItems: 'flex-start' }}>
            <div className="cmo-subtitle" style={{ flex: '1 1 320px' }}>
              {selectedDocument ? sourceDocumentLabel(selectedDocument) : '尚未選擇來源文件'}
              {' → '}
              {selectedTarget ? `${sourceTargetTypeLabel(selectedTarget.type)} · ${selectedTarget.label}` : '尚未選擇 row'}
            </div>
            <button
              type="button"
              className="cmo-button primary"
              disabled={!canAssign}
              onClick={onAssign}
              title={canAssign ? '寫入 source_document_id、audit log 與 sync event' : '請先選擇來源文件與 clinical row'}
            >
              {busy ? '連結中...' : 'Assign source'}
            </button>
          </div>

          <div className="cmo-list" style={{ marginTop: 16 }}>
            {targetsForType.slice(0, 6).map((target) => {
              const linkedDoc = target.source_document_id ? documentById.get(target.source_document_id) : null
              return (
                <div key={`${target.type}-${target.id}`} className="cmo-list-item cmo-row">
                  <div>
                    <strong>{target.label}</strong>
                    <div className="cmo-subtitle">{target.detail}</div>
                  </div>
                  <span className="cmo-badge" style={{ background: linkedDoc ? '#ecfdf5' : '#fff7ed', color: linkedDoc ? '#047857' : '#c2410c' }}>
                    {linkedDoc ? `Source: ${linkedDoc.file_name}` : 'Source pending'}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function DocumentTable({ documents }: { documents: HealthDocument[] }) {
  return (
    <div className="cmo-card table-wrap" id="documents">
      <table className="cmo-table">
        <thead><tr><th>日期</th><th>成員</th><th>類型</th><th>檔名</th><th>處理狀態</th><th>可見性</th><th>Linked rows</th><th>備註</th></tr></thead>
        <tbody>
          {documents.map((doc) => {
            const statusTone = documentProcessingTone(doc.processing_status)
            const visibility = visibilityTone(doc)
            const linkedTargets = doc.linked_targets ?? []
            return (
              <tr key={doc.id}>
                <td>{formatDate(doc.doc_date ?? doc.created_at)}</td>
                <td>{doc.member_name}</td>
                <td>{DOC_LABELS[doc.doc_type] ?? doc.doc_type}</td>
                <td>
                  <strong>{doc.file_name}</strong>
                  <div className="cmo-subtitle">{formatFileSize(doc.file_size)}{doc.source ? ` · ${doc.source}` : ''}</div>
                </td>
                <td>
                  <span className="cmo-badge" style={{ background: statusTone.bg, color: statusTone.fg }}>{doc.processing_status_label ?? statusTone.label}</span>
                  <div className="cmo-subtitle" style={{ marginTop: 6 }}>{doc.next_action ?? doc.processing_note ?? ''}</div>
                </td>
                <td>
                  <span className="cmo-badge" style={{ background: visibility.bg, color: visibility.fg }}>{visibility.label}</span>
                  <div className="cmo-subtitle" style={{ marginTop: 6 }}>{doc.linked_to_verified_data ? 'Verified-data source' : doc.is_verified ? 'Document verified' : 'Not clinically verified'}</div>
                </td>
                <td>
                  <strong>{doc.assignment_counts?.total ?? linkedTargets.length}</strong>
                  {linkedTargets.length > 0 ? (
                    <div className="cmo-chipbar" style={{ marginTop: 6 }}>
                      {linkedTargets.slice(0, 3).map((target) => (
                        <span key={`${target.type}-${target.id}`} className="cmo-chip">{sourceTargetTypeLabel(target.type)} · {target.label}</span>
                      ))}
                      {linkedTargets.length > 3 && <span className="cmo-chip">+{linkedTargets.length - 3}</span>}
                    </div>
                  ) : (
                    <div className="cmo-subtitle" style={{ marginTop: 6 }}>Source pending</div>
                  )}
                </td>
                <td>{doc.note ?? ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ImagingTable({ studies }: { studies: DicomStudy[] }) {
  return (
    <div className="cmo-card table-wrap">
      <table className="cmo-table">
        <thead><tr><th>日期</th><th>成員</th><th>Modality</th><th>描述</th><th>影像量</th></tr></thead>
        <tbody>
          {studies.map((study) => (
            <tr key={study.id}><td>{formatDate(study.created_at ?? study.study_date)}</td><td>{study.member_name}</td><td>{study.modality ?? 'DICOM'}</td><td>{study.study_description ?? '未命名檢查'}</td><td>{study.series_count} series · {study.instance_count} images</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
