'use client'

import Link from 'next/link'
import { usePathname, useParams, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { memberQueryParams, normalizeMemberName, uniqueMemberNames } from '@/lib/members'
import { useSync } from '@/lib/sync'
import { allRecommendationChecksPass, recommendationChecks } from './_lib'
import {
  QuickPick,
  DiagnosisSearch,
  DrugSearch,
  MED_FREQUENCY_OPTIONS,
  MED_ROUTE_OPTIONS,
  PROBLEM_CADENCE_OPTIONS,
  ATTENTION_CHECK_OPTIONS,
  ATTENTION_FOLLOWUP_OPTIONS,
  ATTENTION_ADVICE_OPTIONS,
  SUMMARY_HEALTH_TEMPLATES,
  SUMMARY_ADVICE_TEMPLATES,
  SUMMARY_NEXTSTEP_TEMPLATES,
  COMMON_GENERIC_NAMES,
  type QuickPickOption,
} from './_components/quickpick'
import { CmoDocumentUpload } from './_components/CmoDocumentUpload'
import {
  HealthProblem,
  ConditionReview,
  MedicationReview,
  NHITimelineEvent,
  NhiRecord,
  PublishReadiness,
  ReviewPriority,
  ReviewStatus,
  UserFacingSummary,
  WorkspaceResponse,
  cleanText,
  formatDateOnly,
  priorityMeta,
  reviewStatusMeta,
} from '@/lib/cmoReview'
import {
  TIER_TO_SEVERITY,
  displayDrugName,
  drugByName,
  type DiagnosisEntry,
  type DrugEntry,
} from '@/lib/clinicalDictionary'

export type RecommendationSourceRef = {
  id: string
  type: string
  title: string
  source: string
  status: string
}

export type AttentionCells = {
  condition: string
  check: string
  followup: string
  value: string
  advice: string
}

export type RecommendationForm = {
  series_id: string
  title: string
  health_summary: string
  recommendation: string
  next_step: string
  attention_cells: AttentionCells
  follow_up_date: string
  source_refs: RecommendationSourceRef[]
  no_source_reason?: string
}

export type CmoRecommendation = {
  id: string
  series_id: string
  patient_id?: string
  member_name?: string
  status: string
  title: string
  health_summary: string
  recommendation: string
  next_step: string
  attention_cells?: AttentionCells
  follow_up_date?: string | null
  source_refs: RecommendationSourceRef[]
  quality_checks?: Record<string, unknown>
  version: number
  created_at: string
  published_at?: string | null
}

export type InternalNoteEntry = {
  id: string | number
  created_at?: string | null
  created_by?: string | null
  snapshot: {
    note?: string
    source_refs?: RecommendationSourceRef[]
  }
}

export type RecommendationWorkspace = {
  current: CmoRecommendation | null
  published: CmoRecommendation | null
  drafts: CmoRecommendation[]
  history: CmoRecommendation[]
  internal_notes: InternalNoteEntry[]
}

export type PriorityReviewItem = {
  id: string
  type: string
  title: string
  source: string
  status: string
}

export type PublishMode = 'publish_now' | 'verify_draft' | 'verify_needs_secondary_review'
type ProblemAction = 'verify' | 'publish' | 'unpublish' | 'verify_publish'

export type HealthRecord = {
  id: string
  member_name?: string
  record_type: string
  value1?: string | null
  value2?: string | null
  unit?: string | null
  note?: string | null
  recorded_at?: string | null
}

export type Medication = {
  id: number
  drug_name: string
  dose?: string | null
  frequency?: string | null
  intent?: string | null
  note?: string | null
}

export type HealthDocument = {
  id: string
  doc_type: string
  file_name: string
  doc_date?: string | null
  created_at?: string | null
  processing_status?: string | null
  processing_status_label?: string | null
  hidden_from_patient?: boolean
  patient_visible?: boolean
}

export type Problem = {
  id: number
  member_name?: string | null
  display_name: string
  display_layman?: string | null
  icd10_code?: string | null
  status: string
  tier: number
  is_suspected?: boolean
  is_verified: boolean
  is_published: boolean
  duplicate_count?: number
  onset_date?: string | null
  source_document_id?: string | null
  cmo_note?: string | null
  linked_diagnoses_count?: number
  linked_meds_count?: number
  linked_labs_observations_count?: number
  linked_imaging_count?: number
  linked_procedures_count?: number
}

export type DicomStudy = {
  id: string
  member_name?: string
  modality?: string | null
  study_description?: string | null
  study_date?: string | null
  created_at?: string | null
  series_count?: number
  instance_count?: number
}

export type PatientData = {
  user: { id: string; patient_public_id?: string | null }
  records: HealthRecord[]
  conditions: Array<{ id: number; display_name: string; icd10_code?: string | null; status?: string | null }>
  documents: HealthDocument[]
  dicom_studies: DicomStudy[]
  problems: Problem[]
}

export type ConceptMetric = {
  diagnoses: number
  medications: number
  labs: number
  measurements: number
  documents: number
}

export type CriticalSummary = Record<string, unknown>
type LinkableResourceType = 'condition' | 'medication' | 'health_record' | 'document' | 'dicom_study' | 'nhi_draft' | 'follow_up' | 'missing_data_request'
type ProblemCreationContext = {
  resourceType: LinkableResourceType
  resourceId: number | string
  resourceLabel: string
}
type LinkableRow = { id: number | string; title: string; detail: string }
export type UnlinkedItems = {
  conditions: ConditionReview[]
  medications: MedicationReview[]
  health_records?: Array<Record<string, unknown>>
  documents?: Array<Record<string, unknown>>
  dicom_studies?: Array<Record<string, unknown>>
  nhi_drafts?: NhiRecord[]
  follow_ups?: Array<Record<string, unknown>>
  missing_data_requests?: Array<Record<string, unknown>>
}

export type MedicalTimelineItem = {
  id: string
  title: string
  kind: string
  source: string
  status: string
  date?: string | null
  detail: string
  important?: boolean
}

type ProblemForm = {
  title: string
  plainTitle: string
  severity: 'high' | 'medium' | 'low' | 'insufficient'
  status: 'following' | 'underlying' | 'resolved'
  diagnosisStatus: 'confirmed' | 'suspected' | 'ruled_out' | 'pending_confirmation'
  problemKind: 'active' | 'chronic' | 'resolved' | 'suspected' | 'acute'
  diagnosisDescription: string
  evidenceNote: string
  treatmentPlan: string
  followUpCadence: string
  followUpRecommendation: string
  cmoNote: string
  userExplanation: string
}

type MedicationForm = {
  medicationName: string
  genericNameEn: string
  brandName: string
  dose: string
  route: string
  possibleIndication: string
  frequency: string
  linkedProblemId: string
  isSelfPaid: boolean
  priceAmount: string
  cmoComment: string
}

type SummaryForm = {
  series_id?: string
  title: string
  health_summary: string
  recommendation: string
  next_step: string
  attention_cells: AttentionCells
  follow_up_date: string
  no_source_reason: string
}

type SummarySourceRef = {
  type: string
  id: string
  label: string
  status: string
}

type WorkspaceMode = 'summary' | 'structure' | 'reference'

type WorkspaceTask = {
  key: string
  label: string
  detail: string
  tone: 'red' | 'amber' | 'blue' | 'green' | 'slate'
  targetMode: WorkspaceMode
}

const workspaceModes: Array<{ key: WorkspaceMode; label: string; help: string }> = [
  { key: 'summary', label: 'C7 發布摘要', help: '五格提醒、待辦、最後給使用者看的說明' },
  { key: 'structure', label: 'C2 Problem 關聯', help: 'Problem、用藥、診斷與來源關聯整理' },
  { key: 'reference', label: 'C1 來源整理', help: '原始 NHI、時間線、上傳文件與批次整理' },
]

const emptyProblemForm: ProblemForm = {
  title: '',
  plainTitle: '',
  severity: 'medium',
  status: 'following',
  diagnosisStatus: 'pending_confirmation',
  problemKind: 'active',
  diagnosisDescription: '',
  evidenceNote: '',
  treatmentPlan: '',
  followUpCadence: '',
  followUpRecommendation: '',
  cmoNote: '',
  userExplanation: '',
}

const emptyMedicationForm: MedicationForm = {
  medicationName: '',
  genericNameEn: '',
  brandName: '',
  dose: '',
  route: '',
  possibleIndication: '',
  frequency: '',
  linkedProblemId: '',
  isSelfPaid: false,
  priceAmount: '',
  cmoComment: '',
}

// One-click whole-form fills for the most common cases — the CMO clicks one chip
// and the create form is populated, instead of typing every field by hand.
const COMMON_PROBLEM_PRESETS: Array<{ label: string; patch: Partial<ProblemForm> }> = [
  { label: '高血壓', patch: { title: '高血壓', plainTitle: '高血壓', diagnosisStatus: 'confirmed', problemKind: 'chronic', status: 'following', severity: 'medium' } },
  { label: '第二型糖尿病', patch: { title: '第二型糖尿病', plainTitle: '糖尿病', diagnosisStatus: 'confirmed', problemKind: 'chronic', status: 'following', severity: 'medium' } },
  { label: '高血脂', patch: { title: '高血脂症', plainTitle: '高血脂', diagnosisStatus: 'confirmed', problemKind: 'chronic', status: 'following', severity: 'medium' } },
  { label: '慢性腎臟病', patch: { title: '慢性腎臟病', plainTitle: '腎功能追蹤', diagnosisStatus: 'confirmed', problemKind: 'chronic', status: 'following', severity: 'medium' } },
  { label: '胃食道逆流', patch: { title: '胃食道逆流', plainTitle: '胃食道逆流', diagnosisStatus: 'confirmed', problemKind: 'active', status: 'following', severity: 'low' } },
  { label: '痛風', patch: { title: '痛風', plainTitle: '痛風', diagnosisStatus: 'confirmed', problemKind: 'chronic', status: 'following', severity: 'low' } },
]

const COMMON_MED_PRESETS: Array<{ label: string; patch: Partial<MedicationForm> }> = [
  { label: 'Metformin 500mg', patch: { medicationName: 'Metformin', genericNameEn: 'metformin', dose: '500mg', frequency: '每日2次', route: '口服' } },
  { label: 'Amlodipine 5mg', patch: { medicationName: 'Amlodipine', genericNameEn: 'amlodipine', dose: '5mg', frequency: '每日1次', route: '口服' } },
  { label: 'Atorvastatin 20mg', patch: { medicationName: 'Atorvastatin', genericNameEn: 'atorvastatin', dose: '20mg', frequency: '睡前', route: '口服' } },
  { label: 'Aspirin 100mg', patch: { medicationName: 'Aspirin', genericNameEn: 'aspirin', dose: '100mg', frequency: '每日1次', route: '口服' } },
  { label: 'Losartan 50mg', patch: { medicationName: 'Losartan', genericNameEn: 'losartan', dose: '50mg', frequency: '每日1次', route: '口服' } },
]

// One diagnosis pick from the central dictionary fills title, plain-language
// title, severity, tracking status and the ICD-10 description in one action.
function problemPatchFromDiagnosis(entry: DiagnosisEntry): Partial<ProblemForm> {
  return {
    title: entry.name_zh,
    plainTitle: entry.layman,
    severity: TIER_TO_SEVERITY[entry.tier],
    status: entry.status === 'resolved' ? 'resolved' : entry.status === 'underlying' ? 'underlying' : 'following',
    diagnosisStatus: 'confirmed',
    problemKind: entry.status === 'underlying' ? 'chronic' : entry.status === 'resolved' ? 'resolved' : 'active',
    diagnosisDescription: `${entry.name_en}（ICD-10：${entry.icd10}）`,
  }
}

// One drug pick fills name, generic, brand, first common dose/frequency, route
// and the indication category.
function medicationPatchFromDrug(entry: DrugEntry): Partial<MedicationForm> {
  return {
    medicationName: displayDrugName(entry),
    genericNameEn: entry.generic,
    brandName: entry.brands?.[0] ?? '',
    dose: entry.doses[0] ?? '',
    frequency: entry.frequencies[0] ?? '',
    route: entry.route ?? '口服',
    possibleIndication: entry.category,
  }
}

// Seed a Problem draft from one of the patient's own recorded diagnoses (an
// unlinked NHI / condition row) — real data, not a generic preset.
function problemPatchFromCondition(condition: ConditionReview): Partial<ProblemForm> {
  const resolved = condition.status === 'resolved'
  return {
    title: condition.display_name,
    plainTitle: condition.display_name,
    diagnosisStatus: 'confirmed',
    problemKind: resolved ? 'resolved' : 'active',
    status: resolved ? 'resolved' : 'following',
    diagnosisDescription: condition.icd10_code ? `ICD-10：${condition.icd10_code}` : '',
  }
}

const emptyAttentionCells: AttentionCells = {
  condition: '',
  check: '',
  followup: '',
  value: '',
  advice: '',
}

const attentionCellFields: Array<{ key: keyof AttentionCells; label: string; placeholder: string }> = [
  { key: 'condition', label: '病況', placeholder: '高血壓' },
  { key: 'check', label: '檢查', placeholder: '血壓' },
  { key: 'followup', label: '回診', placeholder: '2 週內' },
  { key: 'value', label: '數值', placeholder: '142/88' },
  { key: 'advice', label: '建議', placeholder: '回診確認' },
]

// One-click suggestions for each C7 cell: 病況 is auto-filled from the patient's
// own Problems; the rest come from canned presets. Saves the CMO from re-typing.
function attentionPresetOptions(key: keyof AttentionCells, problems: HealthProblem[]): ReadonlyArray<QuickPickOption> {
  if (key === 'condition') {
    const seen = new Set<string>()
    const out: QuickPickOption[] = []
    for (const problem of problems) {
      const label = (problem.plain_language_title || problem.title || '').trim().slice(0, 20)
      if (label && !seen.has(label)) {
        seen.add(label)
        out.push({ label })
      }
      if (out.length >= 5) break
    }
    return out
  }
  if (key === 'check') return ATTENTION_CHECK_OPTIONS
  if (key === 'followup') return ATTENTION_FOLLOWUP_OPTIONS
  if (key === 'advice') return ATTENTION_ADVICE_OPTIONS
  return []
}

const emptySummary: SummaryForm = {
  title: '今日健康摘要',
  health_summary: '',
  recommendation: '',
  next_step: '',
  attention_cells: emptyAttentionCells,
  follow_up_date: '',
  no_source_reason: '',
}

const SUMMARY_PUBLISH_CHECKS = [
  {
    key: 'plain_language',
    label: 'Plain language',
    help: 'Avoid ICD-only or chart shorthand in user-facing copy.',
    blocker: 'Rewrite the title, summary, recommendation, or next step in plain language.',
  },
  {
    key: 'has_next_step',
    label: 'Clear next step',
    help: 'Tell the user what to do next.',
    blocker: 'Add a concrete next step before marking ready or publishing.',
  },
  {
    key: 'has_follow_up_or_missing_data',
    label: 'Follow-up or missing-data state',
    help: 'Provide a follow-up date or say what data is still needed.',
    blocker: 'Add a follow-up date or describe the missing data request in the next step.',
  },
  {
    key: 'no_internal_note',
    label: 'No CMO-only note',
    help: 'Keep handoff, audit, and internal review language out of patient text.',
    blocker: 'Remove internal note, handoff, do-not-publish, or CMO-only wording.',
  },
  {
    key: 'no_unconfirmed_sources',
    label: 'Confirmed sources only',
    help: 'System-extracted sources must be confirmed before user release.',
    blocker: 'Confirm or remove unconfirmed system-extracted source references.',
  },
  {
    key: 'has_source_refs_or_reason',
    label: 'Source or reason',
    help: 'Keep source references, or state why no source reference applies.',
    blocker: 'Add at least one source reference or fill in the no-source reason.',
  },
  {
    key: 'medical_safety_copy',
    label: 'Safe medical wording',
    help: 'Avoid guarantee-style or absolute diagnostic claims.',
    blocker: 'Remove guarantee-style or absolute diagnostic wording.',
  },
] as const

type SummaryPublishCheckKey = (typeof SUMMARY_PUBLISH_CHECKS)[number]['key']

function summaryRecommendationForm(form: SummaryForm, sourceRefs: SummarySourceRef[]): RecommendationForm {
  return {
    series_id: form.series_id ?? '',
    title: form.title,
    health_summary: form.health_summary,
    recommendation: form.recommendation,
    next_step: form.next_step,
    attention_cells: form.attention_cells,
    follow_up_date: form.follow_up_date,
    no_source_reason: form.no_source_reason,
    source_refs: sourceRefs.map((ref) => ({
      id: ref.id,
      type: ref.type,
      title: ref.label,
      source: ref.label,
      status: ref.status,
    })),
  }
}

function summaryPublishChecks(form: SummaryForm, sourceRefs: SummarySourceRef[]): Record<SummaryPublishCheckKey, boolean> {
  return recommendationChecks(summaryRecommendationForm(form, sourceRefs))
}

function summaryPublishBlockers(form: SummaryForm, sourceRefs: SummarySourceRef[]) {
  const checks = summaryPublishChecks(form, sourceRefs)
  return SUMMARY_PUBLISH_CHECKS
    .filter((item) => !checks[item.key])
    .map((item) => item.blocker)
}

const severityToTier = { high: 1, medium: 2, low: 3, insufficient: 3 } as const
const severityLabels = { high: '高', medium: '中', low: '低', insufficient: '資訊不足' } as const
const problemStatusLabels: Record<ProblemForm['status'], string> = { following: '需要追蹤', underlying: '長期/慢性', resolved: '已處理' }
const diagnosisStatusLabels: Record<ProblemForm['diagnosisStatus'], string> = { confirmed: '確診', suspected: '疑似', ruled_out: '已排除', pending_confirmation: '待確認' }
const problemKindLabels: Record<ProblemForm['problemKind'], string> = { active: 'Active', chronic: 'Chronic', resolved: 'Resolved', suspected: 'Suspected', acute: 'Acute' }

function diagnosisStatusLabel(value?: string | null) {
  if (value === 'confirmed' || value === 'suspected' || value === 'ruled_out' || value === 'pending_confirmation') {
    return diagnosisStatusLabels[value]
  }
  return '待確認'
}

function diagnosisStatusTone(value?: string | null) {
  if (value === 'confirmed') return 'green'
  if (value === 'suspected' || value === 'pending_confirmation') return 'amber'
  if (value === 'ruled_out') return 'slate'
  return 'amber'
}

function problemKindLabel(value?: string | null) {
  if (value === 'active' || value === 'chronic' || value === 'resolved' || value === 'suspected' || value === 'acute') {
    return problemKindLabels[value]
  }
  return 'Active'
}

function problemPayloadFromForm(form: ProblemForm) {
  const diagnosisStatus = form.diagnosisStatus
  return {
    display_name: form.title.trim(),
    display_layman: form.plainTitle.trim() || form.title.trim(),
    tier: severityToTier[form.severity],
    status: form.status,
    diagnosis_status: diagnosisStatus,
    problem_kind: form.problemKind,
    is_suspected: diagnosisStatus === 'suspected' || form.problemKind === 'suspected',
    diagnosis_description: form.diagnosisDescription.trim() || undefined,
    evidence_note: form.evidenceNote.trim() || undefined,
    treatment_plan: form.treatmentPlan.trim() || undefined,
    follow_up_cadence: form.followUpCadence.trim() || undefined,
    follow_up_recommendation: form.followUpRecommendation.trim() || undefined,
    cmo_note: form.cmoNote.trim() || undefined,
    user_visible_explanation: form.userExplanation.trim() || undefined,
  }
}

function medicationPayloadFromForm(form: MedicationForm) {
  const priceText = form.priceAmount.trim()
  const priceAmount = priceText ? Number(priceText) : null
  return {
    drug_name: form.medicationName.trim(),
    generic_name_en: form.genericNameEn.trim() || undefined,
    brand_name: form.brandName.trim() || undefined,
    dose: form.dose.trim() || undefined,
    route: form.route.trim() || undefined,
    indication: form.possibleIndication.trim() || undefined,
    intent: form.possibleIndication.trim() || '待 CMO 確認用途',
    frequency: form.frequency.trim() || undefined,
    linked_problem_id: form.linkedProblemId ? Number(form.linkedProblemId) : null,
    is_self_paid: form.isSelfPaid,
    price_amount: Number.isFinite(priceAmount) ? priceAmount : null,
    price_currency: 'TWD',
    note: form.cmoComment.trim() || undefined,
    is_active: true,
  }
}

function problemFormFromReview(problem: HealthProblem): ProblemForm {
  return {
    title: problem.title,
    plainTitle: problem.plain_language_title || '',
    severity: problem.severity,
    status: (problem.status_code === 'underlying' || problem.status_code === 'resolved' || problem.status_code === 'following') ? problem.status_code : 'following',
    diagnosisStatus: problem.diagnosis_status === 'confirmed' || problem.diagnosis_status === 'suspected' || problem.diagnosis_status === 'ruled_out' || problem.diagnosis_status === 'pending_confirmation' ? problem.diagnosis_status : 'confirmed',
    problemKind: problem.problem_kind === 'active' || problem.problem_kind === 'chronic' || problem.problem_kind === 'resolved' || problem.problem_kind === 'suspected' || problem.problem_kind === 'acute' ? problem.problem_kind : 'active',
    diagnosisDescription: problem.diagnosis_description || '',
    evidenceNote: problem.evidence_note || '',
    treatmentPlan: problem.treatment_plan || '',
    followUpCadence: problem.follow_up_cadence || '',
    followUpRecommendation: problem.follow_up_recommendation || '',
    cmoNote: problem.cmo_internal_note || '',
    userExplanation: problem.user_visible_explanation || problem.plain_language_title || '',
  }
}

function medicationFormFromReview(medication: MedicationReview): MedicationForm {
  return {
    medicationName: medication.drug_name || medication.medication_name || '',
    genericNameEn: medication.generic_name_en || '',
    brandName: medication.brand_name || '',
    dose: medication.dose || '',
    route: medication.route || '',
    possibleIndication: medication.indication || medication.possible_indication || '',
    frequency: medication.frequency || '',
    linkedProblemId: String(medication.linked_problem_id ?? medication.related_problem_id ?? ''),
    isSelfPaid: Boolean(medication.is_self_paid),
    priceAmount: medication.price_amount == null ? '' : String(medication.price_amount),
    cmoComment: medication.cmo_comment || '',
  }
}

function ProblemAdvancedFields({
  form,
  setForm,
}: {
  form: ProblemForm
  setForm: (form: ProblemForm) => void
}) {
  return (
    <>
      <div className="cmo-form-grid">
        <div>
          <span className="cmo-kpi-label">Diagnosis status</span>
          <div className="cmo-segment" role="group" aria-label="診斷確定度" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            {(['confirmed', 'suspected', 'ruled_out', 'pending_confirmation'] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={form.diagnosisStatus === key ? 'active' : ''}
                aria-pressed={form.diagnosisStatus === key}
                onClick={() => setForm({ ...form, diagnosisStatus: key })}
              >
                {diagnosisStatusLabels[key]}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span className="cmo-kpi-label">Problem type</span>
          <select className="cmo-select" value={form.problemKind} onChange={(event) => setForm({ ...form, problemKind: event.target.value as ProblemForm['problemKind'] })}>
            <option value="active">{problemKindLabels.active}</option>
            <option value="chronic">{problemKindLabels.chronic}</option>
            <option value="resolved">{problemKindLabels.resolved}</option>
            <option value="suspected">{problemKindLabels.suspected}</option>
            <option value="acute">{problemKindLabels.acute}</option>
          </select>
        </label>
      </div>
      <label>
        <span className="cmo-kpi-label">Diagnosis description</span>
        <textarea className="cmo-textarea" value={form.diagnosisDescription} onChange={(event) => setForm({ ...form, diagnosisDescription: event.target.value })} placeholder="Keep the certificate wording or chart diagnosis here." />
      </label>
      <label>
        <span className="cmo-kpi-label">Evidence / rationale</span>
        <textarea className="cmo-textarea" value={form.evidenceNote} onChange={(event) => setForm({ ...form, evidenceNote: event.target.value })} placeholder="Record why this is confirmed, suspected, ruled out, or pending." />
      </label>
      <label>
        <span className="cmo-kpi-label">Treatment course</span>
        <textarea className="cmo-textarea" value={form.treatmentPlan} onChange={(event) => setForm({ ...form, treatmentPlan: event.target.value })} placeholder="Medication, surgery, imaging, procedures, or care process linked to this problem." />
      </label>
      <div className="cmo-form-grid">
        <label>
          <span className="cmo-kpi-label">Follow-up cadence</span>
          <input className="cmo-input" value={form.followUpCadence} onChange={(event) => setForm({ ...form, followUpCadence: event.target.value })} placeholder="e.g. every 3 months" />
          <QuickPick options={PROBLEM_CADENCE_OPTIONS} value={form.followUpCadence} onPick={(next) => setForm({ ...form, followUpCadence: next })} ariaLabel="常用回診頻率" />
        </label>
        <label>
          <span className="cmo-kpi-label">Follow-up recommendation</span>
          <textarea className="cmo-textarea" value={form.followUpRecommendation} onChange={(event) => setForm({ ...form, followUpRecommendation: event.target.value })} placeholder="What the patient or family should watch, prepare, or ask next." />
        </label>
      </div>
    </>
  )
}

function ProblemFormFields({
  form,
  setForm,
}: {
  form: ProblemForm
  setForm: (form: ProblemForm) => void
}) {
  return (
    <>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span className="cmo-kpi-label">診斷快搜 · 選一次自動帶入白話名稱、嚴重度與 ICD-10</span>
        <DiagnosisSearch onSelect={(entry) => setForm({ ...form, ...problemPatchFromDiagnosis(entry) })} />
      </label>
      <div className="cmo-form-grid">
        <label>
          <span className="cmo-kpi-label">Problem title</span>
          <input className="cmo-input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </label>
        <label>
          <span className="cmo-kpi-label">Plain-language title</span>
          <input className="cmo-input" value={form.plainTitle} onChange={(event) => setForm({ ...form, plainTitle: event.target.value })} />
        </label>
        <label>
          <span className="cmo-kpi-label">Severity</span>
          <select className="cmo-select" value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value as ProblemForm['severity'] })}>
            <option value="high">{severityLabels.high}</option>
            <option value="medium">{severityLabels.medium}</option>
            <option value="low">{severityLabels.low}</option>
            <option value="insufficient">{severityLabels.insufficient}</option>
          </select>
        </label>
        <label>
          <span className="cmo-kpi-label">Tracking status</span>
          <select className="cmo-select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProblemForm['status'] })}>
            <option value="following">{problemStatusLabels.following}</option>
            <option value="underlying">{problemStatusLabels.underlying}</option>
            <option value="resolved">{problemStatusLabels.resolved}</option>
          </select>
        </label>
      </div>
      <ProblemAdvancedFields form={form} setForm={setForm} />
      <label>
        <span className="cmo-kpi-label">CMO-only note</span>
        <textarea className="cmo-textarea" value={form.cmoNote} onChange={(event) => setForm({ ...form, cmoNote: event.target.value })} />
      </label>
      <label>
        <span className="cmo-kpi-label">User-facing explanation</span>
        <textarea className="cmo-textarea" value={form.userExplanation} onChange={(event) => setForm({ ...form, userExplanation: event.target.value })} />
      </label>
    </>
  )
}

function MedicationAdvancedFields({
  form,
  setForm,
  problems,
}: {
  form: MedicationForm
  setForm: (form: MedicationForm) => void
  problems: HealthProblem[]
}) {
  const doseEntry = drugByName(form.medicationName) ?? drugByName(form.genericNameEn)
  return (
    <>
      <div className="cmo-form-grid">
        <label>
          <span className="cmo-kpi-label">Generic name (English)</span>
          <input className="cmo-input" list="hk-generic-names" value={form.genericNameEn} onChange={(event) => setForm({ ...form, genericNameEn: event.target.value })} placeholder="e.g. metformin" />
          <datalist id="hk-generic-names">
            {COMMON_GENERIC_NAMES.map((name) => <option key={name} value={name} />)}
          </datalist>
        </label>
        <label>
          <span className="cmo-kpi-label">Brand name</span>
          <input className="cmo-input" value={form.brandName} onChange={(event) => setForm({ ...form, brandName: event.target.value })} />
        </label>
        <label>
          <span className="cmo-kpi-label">Dose</span>
          <input className="cmo-input" value={form.dose} onChange={(event) => setForm({ ...form, dose: event.target.value })} />
          {doseEntry && (
            <QuickPick
              options={doseEntry.doses.map((dose) => ({ label: dose }))}
              value={form.dose}
              onPick={(next) => setForm({ ...form, dose: next })}
              ariaLabel="常用劑量"
            />
          )}
        </label>
        <label>
          <span className="cmo-kpi-label">Linked problem</span>
          <select className="cmo-select" value={form.linkedProblemId} onChange={(event) => setForm({ ...form, linkedProblemId: event.target.value })}>
            <option value="">No linked problem</option>
            {problems.map((problem) => (
              <option key={problem.problem_id} value={problem.problem_id}>{problem.plain_language_title || problem.title}</option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ marginTop: 4 }}>
        <span className="cmo-kpi-label">途徑（點選即可）</span>
        <QuickPick options={MED_ROUTE_OPTIONS} value={form.route} onPick={(next) => setForm({ ...form, route: next })} ariaLabel="給藥途徑" />
      </div>
      <div className="cmo-form-grid">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
          <input type="checkbox" checked={form.isSelfPaid} onChange={(event) => setForm({ ...form, isSelfPaid: event.target.checked })} />
          <span className="cmo-kpi-label" style={{ margin: 0 }}>Self-paid</span>
        </label>
        <label>
          <span className="cmo-kpi-label">Price (TWD)</span>
          <input className="cmo-input" inputMode="decimal" value={form.priceAmount} onChange={(event) => setForm({ ...form, priceAmount: event.target.value })} />
        </label>
      </div>
    </>
  )
}

function MedicationFormFields({
  form,
  setForm,
  problems,
}: {
  form: MedicationForm
  setForm: (form: MedicationForm) => void
  problems: HealthProblem[]
}) {
  // Dose/frequency chips follow whichever drug is currently in the field.
  const drugEntry = drugByName(form.medicationName) ?? drugByName(form.genericNameEn)
  const frequencyOptions = drugEntry
    ? drugEntry.frequencies.map((freq) => ({ label: freq }))
    : MED_FREQUENCY_OPTIONS

  return (
    <>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span className="cmo-kpi-label">藥物快搜 · 選一次自動帶入學名、商品名、劑量與用途</span>
        <DrugSearch onSelect={(entry) => setForm({ ...form, ...medicationPatchFromDrug(entry) })} />
      </label>
      <div className="cmo-form-grid">
        <label>
          <span className="cmo-kpi-label">Medication name</span>
          <input className="cmo-input" value={form.medicationName} onChange={(event) => setForm({ ...form, medicationName: event.target.value })} />
        </label>
        <label>
          <span className="cmo-kpi-label">Indication / use</span>
          <input className="cmo-input" value={form.possibleIndication} onChange={(event) => setForm({ ...form, possibleIndication: event.target.value })} />
        </label>
        <label>
          <span className="cmo-kpi-label">Frequency</span>
          <input className="cmo-input" value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })} />
          <QuickPick options={frequencyOptions} value={form.frequency} onPick={(next) => setForm({ ...form, frequency: next })} ariaLabel="常用頻次" />
        </label>
      </div>
      <MedicationAdvancedFields form={form} setForm={setForm} problems={problems} />
      <label>
        <span className="cmo-kpi-label">CMO comment</span>
        <textarea className="cmo-textarea" value={form.cmoComment} onChange={(event) => setForm({ ...form, cmoComment: event.target.value })} />
      </label>
    </>
  )
}

function workspaceUnlinkedCount(workspace: WorkspaceResponse) {
  const unlinked = workspace.cmo_output.unlinked
  return (unlinked?.conditions?.length ?? 0) + (unlinked?.medications?.length ?? 0)
}

function problemCompletionGap(problem: HealthProblem) {
  return [
    !problem.diagnosis_description,
    !problem.evidence_note,
    !problem.follow_up_recommendation,
    !problem.user_visible_explanation,
  ].filter(Boolean).length
}

function workspaceTaskList(workspace: WorkspaceResponse): WorkspaceTask[] {
  const patient = workspace.patient
  const riskSignals = workspace.source_review.risk_signals
  const unlinkedCount = workspaceUnlinkedCount(workspace)
  const incompleteProblems = workspace.cmo_output.problems.filter((problem) => problemCompletionGap(problem) > 0)
  const unpublishedProblems = workspace.cmo_output.problems.filter((problem) => !problem.is_published)
  const unpublishedMeds = workspace.cmo_output.medications.filter((medication) => !medication.is_published)
  const tasks: WorkspaceTask[] = []

  if (riskSignals.length > 0) {
    tasks.push({
      key: 'risk',
      label: `${riskSignals.length} 個風險訊號先判讀`,
      detail: riskSignals[0]?.label ?? 'NHI risk signal',
      tone: riskSignals.some((signal) => signal.severity === 'high') ? 'red' : 'amber',
      targetMode: 'reference',
    })
  }
  if (patient.pending_nhi_draft_count > 0) {
    tasks.push({
      key: 'nhi-pending',
      label: `${patient.pending_nhi_draft_count} 筆 NHI 尚未確認`,
      detail: `${patient.accepted_nhi_draft_count} accepted / ${patient.rejected_nhi_draft_count} rejected`,
      tone: patient.pending_nhi_draft_count > 20 ? 'amber' : 'blue',
      targetMode: 'reference',
    })
  }
  if (incompleteProblems.length > 0) {
    tasks.push({
      key: 'problem-completion',
      label: `${incompleteProblems.length} 個 Problem 缺少整理欄位`,
      detail: incompleteProblems.slice(0, 2).map((problem) => problem.plain_language_title || problem.title).join('、'),
      tone: 'amber',
      targetMode: 'structure',
    })
  }
  if (unlinkedCount > 0) {
    tasks.push({
      key: 'unlinked',
      label: `${unlinkedCount} 筆診斷/用藥未配對 Problem`,
      detail: '先完成關聯，使用者摘要才不會斷裂',
      tone: 'amber',
      targetMode: 'structure',
    })
  }
  if (unpublishedProblems.length + unpublishedMeds.length > 0) {
    tasks.push({
      key: 'publish',
      label: `${unpublishedProblems.length + unpublishedMeds.length} 筆已整理資料尚未發布`,
      detail: `${unpublishedProblems.length} Problem / ${unpublishedMeds.length} medication`,
      tone: 'blue',
      targetMode: 'structure',
    })
  }
  if ((workspace.cmo_output.missing_info_requests?.length ?? 0) > 0) {
    tasks.push({
      key: 'missing-info',
      label: `${workspace.cmo_output.missing_info_requests.length} 個待補資料要求`,
      detail: workspace.cmo_output.missing_info_requests[0]?.title ? String(workspace.cmo_output.missing_info_requests[0].title) : 'Missing data request',
      tone: 'red',
      targetMode: 'summary',
    })
  }

  return tasks
}

function summaryCompletion(form: SummaryForm) {
  const items = [
    Boolean(form.health_summary.trim()),
    Boolean(form.recommendation.trim()),
    Boolean(form.next_step.trim()),
    Boolean(form.follow_up_date.trim()),
  ]
  return { done: items.filter(Boolean).length, total: items.length }
}

function WorkflowTabs({
  active,
  setActive,
  tasks,
}: {
  active: WorkspaceMode
  setActive: (mode: WorkspaceMode) => void
  tasks: WorkspaceTask[]
}) {
  const counts = tasks.reduce<Record<WorkspaceMode, number>>((acc, task) => {
    acc[task.targetMode] += 1
    return acc
  }, { summary: 0, structure: 0, reference: 0 })
  return (
    <div className="cmo-workflow-tabs" role="tablist" aria-label="CMO workspace steps">
      {workspaceModes.map((mode, index) => (
        <button
          key={mode.key}
          type="button"
          role="tab"
          aria-selected={active === mode.key}
          className={active === mode.key ? 'active' : ''}
          onClick={() => setActive(mode.key)}
        >
          <span>{index + 1}. {mode.label}</span>
          <small>{mode.help}</small>
          {counts[mode.key] > 0 && <b>{counts[mode.key]}</b>}
        </button>
      ))}
    </div>
  )
}

function MemberScopeBar({
  members,
  activeMember,
  onSelect,
}: {
  members: string[]
  activeMember: string
  onSelect: (member: string) => void
}) {
  if (!members.length) return null
  return (
    <section className="cmo-card cmo-section" style={{ marginTop: 14 }}>
      <div className="cmo-title-row">
        <div>
          <h2 className="cmo-section-title">Member scope</h2>
          <div className="cmo-subtitle">CMO review, draft, publish, and preview are scoped to one family member.</div>
        </div>
        <div className="cmo-chipbar" style={{ justifyContent: 'flex-end' }}>
          {members.map((member) => (
            <button
              key={member}
              type="button"
              className={`cmo-chip ${activeMember === member ? 'active' : ''}`}
              onClick={() => onSelect(member)}
            >
              {member}
            </button>
          ))}
        </div>
      </div>
      {!activeMember && (
        <div className="cmo-subtitle" style={{ marginTop: 8, color: '#a97614' }}>
          Select a member before creating or publishing medical data.
        </div>
      )}
    </section>
  )
}

function CmoCommandCenter({
  workspace,
  activeMode,
  setActiveMode,
  busy,
  activeMember,
  onStatePatch,
}: {
  workspace: WorkspaceResponse
  activeMode: WorkspaceMode
  setActiveMode: (mode: WorkspaceMode) => void
  busy: string
  activeMember: string
  onStatePatch: (patch: { cmo_review_status?: ReviewStatus; priority?: ReviewPriority }) => void
}) {
  const patient = workspace.patient
  const tasks = workspaceTaskList(workspace)
  const urgentTasks = tasks.filter((task) => task.tone === 'red' || task.tone === 'amber')
  const reviewMeta = reviewStatusMeta[patient.cmo_review_status] ?? reviewStatusMeta.pending_review
  const priority = priorityMeta[patient.priority] ?? priorityMeta.normal
  const queueProblem = patient.primary_health_problems[0]
  const outputProblem = workspace.cmo_output.problems[0]
  const topProblemLabel = queueProblem?.plain_language_title || queueProblem?.title || outputProblem?.plain_language_title || outputProblem?.title || '尚未建立主要健康問題'

  return (
    <section className="cmo-command-center">
      <div className="cmo-command-main cmo-card cmo-section">
        <div className="cmo-title-row" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="cmo-kpi-label">病患整理工作區</div>
            <h1 className="cmo-title" style={{ marginTop: 6 }}>{patient.name}</h1>
            <div className="cmo-subtitle">
              {patient.patient_public_id} · NHI {patient.nhi_draft_count} 筆 · Problem {patient.problem_count} 個 · 最後更新 {formatDateOnly(patient.last_updated)}
            </div>
          </div>
          <div className="cmo-chipbar" style={{ justifyContent: 'flex-end' }}>
            <ToneBadge label={reviewMeta.label} tone={reviewMeta.tone} />
            <ToneBadge label={priority.label} tone={priority.tone} />
            <Link href="/cmo/workbench" className="cmo-button">返回佇列</Link>
            <Link href={`/cmo/patients/${patient.patient_id}/nhi${activeMember ? `?member=${encodeURIComponent(activeMember)}` : ''}`} className="cmo-button">完整 NHI</Link>
          </div>
        </div>

        <div className="cmo-command-grid">
          <div className="cmo-command-focus">
            <span className="cmo-kpi-label">一開始先看</span>
            <strong>{cleanText(topProblemLabel, '尚未建立主要健康問題')}</strong>
            <p>{urgentTasks[0]?.detail || '目前沒有高風險待辦，先完成使用者摘要與發布檢查。'}</p>
          </div>
          <div className="cmo-command-metrics">
            {[
              ['待確認 NHI', patient.pending_nhi_draft_count],
              ['風險訊號', workspace.source_review.risk_signals.length],
              ['未關聯', workspaceUnlinkedCount(workspace)],
              ['已發布 Problem', patient.published_problem_count],
            ].map(([label, value]) => (
              <div key={label} className="cmo-command-stat">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="cmo-command-actions">
          <button type="button" className="cmo-button" disabled={busy === 'state'} onClick={() => onStatePatch({ cmo_review_status: 'in_review' })}>標記整理中</button>
          <button type="button" className="cmo-button" disabled={busy === 'state'} onClick={() => onStatePatch({ cmo_review_status: 'needs_info' })}>需要補資料</button>
          <button type="button" className="cmo-button" disabled={busy === 'state'} onClick={() => onStatePatch({ priority: patient.priority === 'urgent' ? 'high' : 'urgent' })}>
            {patient.priority === 'urgent' ? '降為高優先' : '設為急件'}
          </button>
        </div>
      </div>

      <div className="cmo-card cmo-section cmo-command-tasks">
        <div className="cmo-title-row">
          <div>
            <h2 className="cmo-section-title">待處理重點</h2>
            <div className="cmo-subtitle">只列會影響整理完成的事項。</div>
          </div>
          <ToneBadge label={tasks.length ? `${tasks.length} tasks` : 'clear'} tone={tasks.length ? 'amber' : 'green'} />
        </div>
        <div className="cmo-task-list">
          {tasks.length === 0 ? (
            <EmptyText text="沒有阻擋整理完成的待辦。" />
          ) : tasks.slice(0, 5).map((task) => (
            <button key={task.key} type="button" className={`cmo-task-item ${task.tone}`} onClick={() => setActiveMode(task.targetMode)}>
              <span>{task.label}</span>
              <small>{task.detail}</small>
            </button>
          ))}
        </div>
      </div>

      <WorkflowTabs active={activeMode} setActive={setActiveMode} tasks={tasks} />
    </section>
  )
}

function CmoBriefPanel({
  workspace,
  summaryForm,
  setActiveMode,
  onCreateProblem,
}: {
  workspace: WorkspaceResponse
  summaryForm: SummaryForm
  setActiveMode: (mode: WorkspaceMode) => void
  onCreateProblem: () => void
}) {
  const completion = summaryCompletion(summaryForm)
  const topSignals = workspace.source_review.risk_signals.slice(0, 3)
  const topProblems = workspace.cmo_output.problems.slice(0, 4)
  const recentEvents = workspace.cmo_output.timeline_summary.slice(0, 4)

  return (
    <aside className="cmo-brief-panel">
      <section className="cmo-card cmo-section">
        <div className="cmo-title-row">
          <div>
            <h2 className="cmo-section-title">CMO 先掌握</h2>
            <div className="cmo-subtitle">把原始資料壓縮成整理前需要判斷的重點。</div>
          </div>
          <ToneBadge label={`${completion.done}/${completion.total} 摘要欄位`} tone={completion.done === completion.total ? 'green' : 'amber'} />
        </div>
        <div className="cmo-brief-grid">
          <div className="cmo-brief-card cmo-brief-card--primary">
            <div className="cmo-brief-content">
              <span>主要病史</span>
              <strong>{topProblems[0]?.plain_language_title || topProblems[0]?.title || '尚未整理'}</strong>
            </div>
            <div className="cmo-brief-actions">
              <button type="button" className="cmo-brief-action" onClick={() => setActiveMode('structure')}>整理 Problem</button>
              <button type="button" className="cmo-brief-action accent" onClick={() => onCreateProblem()}>＋ 新增 Problem</button>
            </div>
          </div>
          <div className="cmo-brief-card">
            <div className="cmo-brief-content">
              <span>近期/重大事件</span>
              <strong>{recentEvents[0] ? `${formatDateOnly(recentEvents[0].date)} · ${shortText(recentEvents[0].normalized_summary || recentEvents[0].diagnosis, '無摘要', 42)}` : '尚無時間線'}</strong>
            </div>
            <button type="button" className="cmo-brief-action" onClick={() => setActiveMode('reference')}>看時間線</button>
          </div>
          <div className="cmo-brief-card">
            <div className="cmo-brief-content">
              <span>用藥</span>
              <strong>{workspace.cmo_output.medications.length} 筆，{workspace.cmo_output.medications.filter((medication) => medication.is_published).length} 筆已發布</strong>
            </div>
            <button type="button" className="cmo-brief-action" onClick={() => setActiveMode('structure')}>整理用藥</button>
          </div>
          <div className="cmo-brief-card">
            <div className="cmo-brief-content">
              <span>待補資料</span>
              <strong>{workspace.cmo_output.missing_info_requests.length || workspace.patient.missing_info_count || 0} 項</strong>
            </div>
            <button type="button" className="cmo-brief-action" onClick={() => setActiveMode('summary')}>補進摘要</button>
          </div>
        </div>
      </section>

      <section className="cmo-card cmo-section">
        <div className="cmo-title-row">
          <h2 className="cmo-section-title">優先判讀</h2>
          <button type="button" className="cmo-button" onClick={() => setActiveMode('reference')}>開 Reference</button>
        </div>
        <div className="cmo-list">
          {topSignals.length === 0 ? <EmptyText text="目前沒有高風險 NHI 訊號。" /> : topSignals.map((signal) => (
            <div key={signal.id} className="cmo-list-item">
              <div className="cmo-title-row" style={{ gap: 8 }}>
                <strong>{shortText(signal.label, '風險訊號', 54)}</strong>
                <ToneBadge label={signal.severity === 'high' ? 'High' : 'Medium'} tone={signal.severity === 'high' ? 'red' : 'amber'} />
              </div>
              <div className="cmo-subtitle">{formatDateOnly(signal.date)} · {signal.source}</div>
            </div>
          ))}
        </div>
      </section>

      <details className="cmo-card cmo-section cmo-brief-reference">
        <summary>目前已整理資料</summary>
        <div className="cmo-list" style={{ marginTop: 10 }}>
          {topProblems.length === 0 ? <EmptyText text="尚未建立 Problem。" /> : topProblems.map((problem) => (
            <div key={problem.problem_id} className="cmo-list-item">
              <strong>{problem.plain_language_title || problem.title}</strong>
              <div className="cmo-subtitle">{problem.status} · {problem.is_published ? '已發布' : problem.is_verified ? '已驗證' : '待驗證'}</div>
            </div>
          ))}
        </div>
      </details>
    </aside>
  )
}

export default function CmoPatientWorkspacePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const patientId = params.id
  const sync = useSync()
  const patientSyncVersion = useMemo(() => sync.events.reduce((latest, event) => {
    if (event.patient_id !== patientId) return latest
    if (!event.affected_views?.some((view) => view === 'cmo_patient_pov' || view === 'cmo_red_zone')) return latest
    return Math.max(latest, event.id)
  }, 0), [patientId, sync.events])
  const [selectedMember, setSelectedMember] = useState(() => normalizeMemberName(searchParams.get('member')))
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [problemForm, setProblemForm] = useState<ProblemForm>(emptyProblemForm)
  const [problemCreatorOpen, setProblemCreatorOpen] = useState(false)
  const [pendingProblemLink, setPendingProblemLink] = useState<ProblemCreationContext | null>(null)
  const [medicationForm, setMedicationForm] = useState<MedicationForm>(emptyMedicationForm)
  const [editingProblemId, setEditingProblemId] = useState<number | null>(null)
  const [editingProblemForm, setEditingProblemForm] = useState<ProblemForm>(emptyProblemForm)
  const [editingMedicationId, setEditingMedicationId] = useState<number | null>(null)
  const [editingMedicationForm, setEditingMedicationForm] = useState<MedicationForm>(emptyMedicationForm)
  const [summaryForm, setSummaryForm] = useState<SummaryForm>(emptySummary)
  const [relationTargets, setRelationTargets] = useState<Record<string, string>>({})
  const [activeMode, setActiveMode] = useState<WorkspaceMode>('summary')
  const [publishReadiness, setPublishReadiness] = useState<PublishReadiness | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const problemCreatorFocusPending = useRef(false)

  useEffect(() => {
    setSelectedMember(normalizeMemberName(searchParams.get('member')))
  }, [searchParams])

  const selectMemberScope = useCallback((member: string) => {
    const normalized = normalizeMemberName(member)
    setSelectedMember(normalized)
    const nextParams = new URLSearchParams(searchParams.toString())
    if (normalized) nextParams.set('member', normalized)
    else nextParams.delete('member')
    const query = nextParams.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setNotice('')
    }
    try {
      const params = memberQueryParams(selectedMember)
      const [data, readiness] = await Promise.all([
        api.get(`/api/cmo/review/patients/${patientId}/workspace`, params) as Promise<WorkspaceResponse>,
        api.get(`/api/cmo/patients/${patientId}/publish-readiness`, params) as Promise<PublishReadiness>,
      ])
      setWorkspace(data)
      setPublishReadiness(readiness)
      setSelectedRecordId(data.source_review.nhi_records[0]?.id ?? null)
      setSummaryForm(formFromSummary(data.cmo_output.user_facing_summary, data))
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '無法載入病患整理工作區')
      if (!silent) {
        setWorkspace(null)
        setPublishReadiness(null)
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [patientId, selectedMember])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (patientSyncVersion > 0) void load(true)
  }, [load, patientSyncVersion])

  const memberOptions = useMemo(() => uniqueMemberNames(
    workspace?.family_members?.map((member) => member.name),
    workspace?.source_review.nhi_records.map((record) => record.member_name),
    workspace?.cmo_output.problems.map((problem) => problem.member_name),
    workspace?.cmo_output.conditions.map((condition) => condition.member_name),
    workspace?.cmo_output.medications.map((medication) => medication.member_name),
  ), [workspace])

  useEffect(() => {
    if (workspace && !selectedMember && memberOptions.length > 1) {
      selectMemberScope(memberOptions[0])
    }
  }, [memberOptions, selectMemberScope, selectedMember, workspace])

  const activeMemberName = selectedMember || workspace?.active_member || (memberOptions.length === 1 ? memberOptions[0] : '')

  const requireMemberScope = useCallback((action: string) => {
    if (activeMemberName) return activeMemberName
    setNotice(`Select a family member before ${action}.`)
    return ''
  }, [activeMemberName])

  const overridePayloadForPublish = useCallback((action: string) => {
    if (!publishReadiness?.requires_secondary_review) return {}
    const reason = overrideReason.trim()
    if (!reason) {
      setNotice(`High-risk ${action} requires an override reason in Publish Readiness.`)
      return null
    }
    return { override_reason: reason }
  }, [overrideReason, publishReadiness])

  const filteredRecords = useMemo(() => {
    const rows = workspace?.source_review.nhi_records ?? []
    if (sectionFilter === 'all') return rows
    if (sectionFilter === 'risk') {
      const riskIds = new Set((workspace?.source_review.risk_signals ?? []).map((signal) => Number(signal.id.replace('draft-', ''))))
      return rows.filter((row) => riskIds.has(row.id))
    }
    return rows.filter((row) => row.section === sectionFilter)
  }, [sectionFilter, workspace])

  const selectedRecord = useMemo(() => {
    return filteredRecords.find((row) => row.id === selectedRecordId) ?? filteredRecords[0] ?? null
  }, [filteredRecords, selectedRecordId])

  useEffect(() => {
    setSelectedRecordId((current) => {
      if (current !== null && filteredRecords.some((record) => record.id === current)) return current
      return filteredRecords[0]?.id ?? null
    })
  }, [filteredRecords])

  const sourceRefs = useMemo(() => {
    const refs = (workspace?.source_review.risk_signals ?? []).slice(0, 4).map((signal) => ({
      type: 'nhi_draft',
      id: signal.id,
      label: signal.source,
      status: 'confirmed',
    }))
    if (refs.length > 0) return refs
    return (workspace?.source_review.nhi_records ?? []).slice(0, 3).map((record) => ({
      type: 'nhi_draft',
      id: `draft-${record.id}`,
      label: `NHI ${record.section_label} · Draft #${record.id}`,
      status: record.status === 'accepted' ? 'accepted' : 'reviewed',
    }))
  }, [workspace])

  const refreshAfterMutation = async (message: string) => {
    await load()
    setNotice(message)
  }

  const updateState = async (patch: { cmo_review_status?: ReviewStatus; priority?: ReviewPriority }) => {
    if (!workspace) return
    setBusy('state')
    try {
      await api.patch(`/api/cmo/review/patients/${workspace.patient.patient_id}/state`, patch)
      await refreshAfterMutation('已更新整理狀態。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '整理狀態更新失敗。')
    } finally {
      setBusy('')
    }
  }

  const createProblem = async (event: FormEvent) => {
    event.preventDefault()
    if (!workspace || !problemForm.title.trim()) return
    const memberName = requireMemberScope('creating a problem')
    if (!memberName) return
    setBusy('problem')
    try {
      await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/problems`, {
        ...problemPayloadFromForm(problemForm),
        member_name: memberName,
        initial_link: pendingProblemLink ? {
          resource_type: pendingProblemLink.resourceType,
          resource_id: String(pendingProblemLink.resourceId),
        } : undefined,
      })
      const linkedLabel = pendingProblemLink?.resourceLabel
      setProblemForm(emptyProblemForm)
      setProblemCreatorOpen(false)
      setPendingProblemLink(null)
      await refreshAfterMutation(linkedLabel
        ? `已建立 Problem，並自動關聯「${linkedLabel}」。`
        : '已建立新的健康問題，請視需要確認或發布。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '建立健康問題失敗。')
    } finally {
      setBusy('')
    }
  }

  const createMedication = async (event: FormEvent) => {
    event.preventDefault()
    if (!workspace || !medicationForm.medicationName.trim()) return
    const memberName = requireMemberScope('creating a medication')
    if (!memberName) return
    setBusy('medication')
    try {
      await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/medications`, {
        ...medicationPayloadFromForm(medicationForm),
        member_name: memberName,
      })
      setMedicationForm(emptyMedicationForm)
      await refreshAfterMutation('已新增用藥整理項目。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '新增用藥失敗。')
    } finally {
      setBusy('')
    }
  }

  const runProblemAction = async (problem: HealthProblem, action: ProblemAction) => {
    setBusy(`problem-${problem.problem_id}`)
    try {
      const shouldPublish = action === 'publish' || action === 'verify_publish'
      const payload = shouldPublish ? overridePayloadForPublish('problem publish') : {}
      if (payload === null) return
      if (action === 'verify_publish') {
        await api.post(`/api/cmo/problems/${problem.problem_id}/verify`, {})
        await api.post(`/api/cmo/problems/${problem.problem_id}/publish`, payload)
      } else {
        await api.post(`/api/cmo/problems/${problem.problem_id}/${action}`, payload)
      }
      await refreshAfterMutation(shouldPublish ? '已確認並發布健康問題到使用者端。' : action === 'verify' ? '已確認健康問題，尚未發布。' : '已從使用者端撤下健康問題。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '健康問題操作失敗。')
    } finally {
      setBusy('')
    }
  }

  const deleteProblem = async (problem: HealthProblem) => {
    const label = problem.plain_language_title || problem.title
    if (!window.confirm(`刪除這筆尚未發布的 Problem 草稿？\n${label}\n\n系統會保留 audit log，但此草稿會從 CMO workspace 移除。`)) return
    setBusy(`problem-delete-${problem.problem_id}`)
    try {
      await api.delete(`/api/cmo/problems/${problem.problem_id}`)
      if (editingProblemId === problem.problem_id) {
        setEditingProblemId(null)
        setEditingProblemForm(emptyProblemForm)
      }
      await refreshAfterMutation('已刪除 Problem 草稿。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Problem 刪除失敗。')
    } finally {
      setBusy('')
    }
  }

  const beginProblemEdit = (problem: HealthProblem) => {
    setEditingMedicationId(null)
    setEditingProblemId(problem.problem_id)
    setEditingProblemForm(problemFormFromReview(problem))
  }

  const saveProblemEdit = async (problemId: number) => {
    setBusy(`problem-edit-${problemId}`)
    try {
      await api.patch(`/api/cmo/problems/${problemId}`, problemPayloadFromForm(editingProblemForm))
      setEditingProblemId(null)
      setEditingProblemForm(emptyProblemForm)
      await refreshAfterMutation('已儲存 Problem 診斷狀態與追蹤資訊；尚未發布的內容仍只在 CMO 端可見。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Problem 更新失敗。')
    } finally {
      setBusy('')
    }
  }

  const runMedicationAction = async (medication: MedicationReview, action: 'publish' | 'unpublish') => {
    setBusy(`med-${medication.id}`)
    try {
      const payload = action === 'publish' ? overridePayloadForPublish('medication publish') : {}
      if (payload === null) return
      await api.post(`/api/cmo/medications/${medication.id}/${action}`, payload)
      await refreshAfterMutation(action === 'publish' ? '已發布用藥整理到使用者端。' : '已從使用者端撤下用藥整理。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '用藥操作失敗。')
    } finally {
      setBusy('')
    }
  }

  const beginMedicationEdit = (medication: MedicationReview) => {
    setEditingProblemId(null)
    setEditingMedicationId(medication.id)
    setEditingMedicationForm(medicationFormFromReview(medication))
  }

  const saveMedicationEdit = async (medicationId: number) => {
    setBusy(`med-edit-${medicationId}`)
    try {
      await api.patch(`/api/cmo/medications/${medicationId}`, medicationPayloadFromForm(editingMedicationForm))
      setEditingMedicationId(null)
      setEditingMedicationForm(emptyMedicationForm)
      await refreshAfterMutation('已儲存用藥明細；發布前病人端不會看到 CMO 草稿。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '用藥明細更新失敗。')
    } finally {
      setBusy('')
    }
  }

  const setRelationTarget = (key: string, value: string) => {
    setRelationTargets((current) => ({ ...current, [key]: value }))
  }

  const focusProblemCreator = useCallback(() => {
    const formElement = document.getElementById('cmo-new-problem-form')
    const titleElement = document.getElementById('cmo-new-problem-title')
    if (!formElement || !titleElement) return false
    formElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    titleElement.focus()
    return true
  }, [])

  const openProblemCreator = (context?: ProblemCreationContext, options?: { keepMode?: boolean }) => {
    setPendingProblemLink(context ?? null)
    setProblemCreatorOpen(true)
    if (context) {
      setProblemForm((current) => current.title.trim() ? current : { ...current, title: context.resourceLabel })
    }
    problemCreatorFocusPending.current = true
    if (!options?.keepMode && activeMode !== 'structure') setActiveMode('structure')
  }

  const closeProblemCreator = () => {
    if (busy === 'problem') return
    problemCreatorFocusPending.current = false
    setProblemCreatorOpen(false)
    setPendingProblemLink(null)
  }

  useEffect(() => {
    if (!problemCreatorOpen || !problemCreatorFocusPending.current) return
    const frame = window.requestAnimationFrame(() => {
      problemCreatorFocusPending.current = !focusProblemCreator()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeMode, focusProblemCreator, problemCreatorOpen])

  const linkEntityToProblem = async (entityType: LinkableResourceType, entityId: number | string) => {
    if (!workspace) return
    const key = `${entityType}-${entityId}`
    const problemId = Number(relationTargets[key])
    if (!Number.isFinite(problemId) || problemId <= 0) {
      setNotice('請先選擇要配對的 Problem。')
      return
    }
    setBusy(`link-${key}`)
    try {
      await api.post(`/api/cmo/problems/${problemId}/links`, {
        resource_type: entityType,
        resource_id: String(entityId),
      })
      setRelationTargets((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      await refreshAfterMutation('已將資料配對到 Problem，CMO workspace 會保留這個關聯。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '資料配對失敗，請確認 item 與 Problem 屬於同一位病人。')
    } finally {
      setBusy('')
    }
  }

  const runSourceBatch = async (action: 'dismiss' | 'reject' | 'request_missing_data', recordIds: number[]) => {
    if (!workspace || recordIds.length === 0) return
    const memberName = requireMemberScope(`running C1 ${action}`)
    if (!memberName) return
    setBusy(`source-batch-${action}`)
    try {
      await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/source-triage/batch`, {
        action,
        member_name: memberName,
        items: recordIds.map((id) => ({ resource_type: 'nhi_draft', resource_id: id })),
        title: '請補充健保資料',
        reason: 'CMO 整理 NHI 紀錄時需要使用者補充或確認。',
      })
      const label = action === 'dismiss' ? '已標記不需處理。' : action === 'reject' ? '已拒絕選取來源。' : '已建立補資料請求。'
      await refreshAfterMutation(label)
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '批次整理失敗。')
    } finally {
      setBusy('')
    }
  }

  const saveSummary = async (readyToPublish = false) => {
    if (!workspace) return
    const memberName = requireMemberScope(readyToPublish ? 'marking a summary ready' : 'saving a summary draft')
    if (!memberName) return
    if (readyToPublish) {
      const blockers = summaryPublishBlockers(summaryForm, sourceRefs)
      if (blockers.length > 0) {
        setShowPreview(true)
        setNotice(`Cannot mark ready: ${blockers[0]}`)
        return
      }
    }
    setBusy(readyToPublish ? 'ready-summary' : 'summary')
    try {
      await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/recommendations/draft`, summaryPayload(summaryForm, sourceRefs, readyToPublish, memberName))
      if (readyToPublish) await refreshAfterMutation('Summary marked ready for the selected member.')
      else await refreshAfterMutation('已儲存使用者摘要草稿。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '儲存摘要失敗。')
    } finally {
      setBusy('')
    }
  }

  const publishSummary = async () => {
    if (!workspace) return
    const memberName = requireMemberScope('publishing a summary')
    if (!memberName) return
    const blockers = summaryPublishBlockers(summaryForm, sourceRefs)
    if (blockers.length > 0) {
      setShowPreview(true)
      setNotice(`Cannot publish: ${blockers[0]}`)
      return
    }
    setBusy('publish-summary')
    try {
      const overridePayload = overridePayloadForPublish('summary publish')
      if (overridePayload === null) return
      const overrideReasonValue = 'override_reason' in overridePayload ? overridePayload.override_reason : ''
      await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/recommendations/publish`, summaryPayload(summaryForm, sourceRefs, true, memberName, overrideReasonValue))
      await refreshAfterMutation('已發布使用者端健康摘要。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '發布摘要失敗。')
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <main className="cmo-page">
        <div className="cmo-card cmo-section">
          <div className="cmo-kpi-label">病患整理工作區</div>
          <h1 className="cmo-title" style={{ marginTop: 8 }}>正在載入整理工作區</h1>
          <div className="cmo-skeleton-grid" style={{ marginTop: 16 }}>
            <div className="cmo-skeleton-card" />
            <div className="cmo-skeleton-card" />
            <div className="cmo-skeleton-card" />
          </div>
        </div>
      </main>
    )
  }

  if (!workspace) {
    return (
      <main className="cmo-page">
        <div className="cmo-card cmo-section">
          <h1 className="cmo-title">無法載入病患資料</h1>
          <p className="cmo-subtitle">{notice || '請回到 Patient Queue 後重新進入。'}</p>
          <Link href="/cmo/workbench" className="cmo-button primary">回工作佇列</Link>
        </div>
      </main>
    )
  }

  const patient = workspace.patient
  if (workspaceModes.some((mode) => mode.key === activeMode)) {
    return (
      <main className="cmo-page cmo-patient-workspace-page">
        <CmoCommandCenter
          workspace={workspace}
          activeMode={activeMode}
          setActiveMode={setActiveMode}
          busy={busy}
          activeMember={activeMemberName}
          onStatePatch={(patch) => void updateState(patch)}
        />
        <MemberScopeBar
          members={memberOptions}
          activeMember={activeMemberName}
          onSelect={selectMemberScope}
        />

        {notice && (
          <div className="cmo-card cmo-section cmo-workspace-notice" style={{ borderColor: notice.includes('失敗') || notice.includes('Cannot') ? '#f2d3cf' : '#cfe8da' }}>
            {notice}
          </div>
        )}

        {activeMode === 'summary' && (
          <section className="cmo-workflow-layout cmo-summary-workflow" aria-label="CMO summary workflow">
            <CmoBriefPanel workspace={workspace} summaryForm={summaryForm} setActiveMode={setActiveMode} onCreateProblem={openProblemCreator} />
            <div className="cmo-primary-editor">
              <SummaryBuilder
                workspace={workspace}
                form={summaryForm}
                setForm={setSummaryForm}
                sourceRefs={sourceRefs}
                busy={busy}
                showPreview={showPreview}
                setShowPreview={setShowPreview}
                readiness={publishReadiness}
                overrideReason={overrideReason}
                setOverrideReason={setOverrideReason}
                onSave={() => void saveSummary(false)}
                onReady={() => void saveSummary(true)}
                onPublish={() => void publishSummary()}
                problemForm={problemForm}
                setProblemForm={setProblemForm}
                problemCreatorOpen={problemCreatorOpen}
                pendingProblemLink={pendingProblemLink}
                sourceConditions={workspace.cmo_output.unlinked?.conditions ?? workspace.cmo_output.conditions ?? []}
                onSubmitProblem={createProblem}
                onCreateProblem={(context) => openProblemCreator(context, { keepMode: true })}
                onCloseProblemCreator={closeProblemCreator}
                onClearProblemLink={() => setPendingProblemLink(null)}
                onProblemAction={runProblemAction}
                onDeleteProblem={(problem) => void deleteProblem(problem)}
              />
            </div>
          </section>
        )}

        {activeMode === 'structure' && (
          <section className="cmo-structure-workflow" aria-label="CMO structured data workflow">
            <div id="cmo-sec-problems" className="cmo-jump-anchor">
              <ProblemListPanel
                problems={workspace.cmo_output.problems}
                sourceConditions={workspace.cmo_output.unlinked?.conditions ?? workspace.cmo_output.conditions ?? []}
                busy={busy}
                form={problemForm}
                setForm={setProblemForm}
                editingId={editingProblemId}
                editingForm={editingProblemForm}
                setEditingForm={setEditingProblemForm}
                onSubmit={createProblem}
                onAction={runProblemAction}
                onDelete={(problem) => void deleteProblem(problem)}
                onBeginEdit={beginProblemEdit}
                onCancelEdit={() => {
                  setEditingProblemId(null)
                  setEditingProblemForm(emptyProblemForm)
                }}
                onSaveEdit={(problemId: number) => void saveProblemEdit(problemId)}
                creatorOpen={problemCreatorOpen}
                pendingLink={pendingProblemLink}
                onOpenCreator={() => openProblemCreator()}
                onCloseCreator={closeProblemCreator}
                onClearPendingLink={() => setPendingProblemLink(null)}
              />
            </div>

            <ProblemMapPanel
              problems={workspace.cmo_output.problems}
              conditions={workspace.cmo_output.conditions ?? []}
              medications={workspace.cmo_output.medications}
              unlinked={workspace.cmo_output.unlinked ?? { conditions: [], medications: [] }}
              busy={busy}
              relationTargets={relationTargets}
              setRelationTarget={setRelationTarget}
              onLink={(entityType, entityId) => void linkEntityToProblem(entityType, entityId)}
              onCreateProblem={openProblemCreator}
            />

            <div id="cmo-sec-meds" className="cmo-jump-anchor">
              <MedicationPanel
                medications={workspace.cmo_output.medications}
                problems={workspace.cmo_output.problems}
                busy={busy}
                form={medicationForm}
                setForm={setMedicationForm}
                editingId={editingMedicationId}
                editingForm={editingMedicationForm}
                setEditingForm={setEditingMedicationForm}
                onSubmit={createMedication}
                onAction={runMedicationAction}
                onBeginEdit={beginMedicationEdit}
                onCancelEdit={() => {
                  setEditingMedicationId(null)
                  setEditingMedicationForm(emptyMedicationForm)
                }}
                onSaveEdit={(medicationId: number) => void saveMedicationEdit(medicationId)}
              />
            </div>
          </section>
        )}

        {activeMode === 'reference' && (
          <section className="cmo-reference-workflow" aria-label="CMO reference workflow">
            <CmoDocumentUpload
              patientId={workspace.patient.patient_id}
              memberName={activeMemberName}
              onUploaded={() => void refreshAfterMutation('已上傳文件到來源資料。')}
            />
            <SourceReview
              workspace={workspace}
              sectionFilter={sectionFilter}
              setSectionFilter={setSectionFilter}
              filteredRecords={filteredRecords}
              selectedRecord={selectedRecord}
              setSelectedRecordId={setSelectedRecordId}
              relationTargets={relationTargets}
              setRelationTarget={setRelationTarget}
              onLink={(entityType, entityId) => void linkEntityToProblem(entityType, entityId)}
              onCreateProblem={openProblemCreator}
              onBatchTriage={(action, ids) => void runSourceBatch(action, ids)}
              busy={busy}
            />
            <TimelineSummaryPanel events={workspace.cmo_output.timeline_summary} />
          </section>
        )}
      </main>
    )
  }

  return (
    <main className="cmo-page">
      <section className="cmo-title-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="cmo-kpi-label">病患整理工作區</div>
          <h1 className="cmo-title" style={{ marginTop: 6 }}>{patient.name}</h1>
          <div className="cmo-subtitle">{patient.patient_public_id} · NHI drafts {patient.nhi_draft_count} · Problems {patient.problem_count}</div>
        </div>
        <div className="cmo-chipbar" style={{ justifyContent: 'flex-end' }}>
          <ToneBadge label={reviewStatusMeta[patient.cmo_review_status].label} tone={reviewStatusMeta[patient.cmo_review_status].tone} />
          <ToneBadge label={priorityMeta[patient.priority].label} tone={priorityMeta[patient.priority].tone} />
          <Link href="/cmo/workbench" className="cmo-button">回佇列</Link>
          <Link href={`/cmo/patients/${patient.patient_id}/nhi${activeMemberName ? `?member=${encodeURIComponent(activeMemberName)}` : ''}`} className="cmo-button">看完整 NHI</Link>
        </div>
      </section>

      {notice && <div className="cmo-card cmo-section" style={{ marginTop: 14, borderColor: notice.includes('失敗') || notice.includes('無法') ? '#f2d3cf' : '#cfe8da' }}>{notice}</div>}

      <section className="cmo-card cmo-section" style={{ marginTop: 14 }}>
        <div className="cmo-title-row">
          <div>
            <h2 className="cmo-section-title">整理狀態</h2>
            <div className="cmo-subtitle">這裡只管理 CMO 工作狀態，不改變臨床事實。</div>
          </div>
          <div className="cmo-chipbar">
            <button className="cmo-button" disabled={busy === 'state'} onClick={() => void updateState({ cmo_review_status: 'in_review' })}>標記整理中</button>
            <button className="cmo-button" disabled={busy === 'state'} onClick={() => void updateState({ cmo_review_status: 'needs_info' })}>需要補資料</button>
            <button className="cmo-button" disabled={busy === 'state'} onClick={() => void updateState({ priority: patient.priority === 'urgent' ? 'high' : 'urgent' })}>
              {patient.priority === 'urgent' ? '降為優先' : '標記高優先'}
            </button>
          </div>
        </div>
      </section>

      {(() => {
        const signals = workspace.source_review.risk_signals ?? []
        const high = signals.filter((s) => s.severity === 'high')
        return (
          <div className={`cmo-risk-strip${signals.length === 0 ? ' ok' : ''}`}>
            <span className="lbl">{signals.length === 0 ? '無高風險線索' : `風險線索 ${signals.length} 項`}</span>
            {high.slice(0, 4).map((s) => (
              <span key={s.id} className="cmo-badge" style={{ background: '#faecea', color: '#a03a30', border: '1px solid #f2d3cf' }}>{cleanText(s.label)}</span>
            ))}
            {signals.length === 0 && <span className="cmo-subtitle" style={{ margin: 0 }}>NHI 來源目前未偵測到需立即注意的高風險訊號。</span>}
          </div>
        )
      })()}

      <nav className="cmo-jump-nav" aria-label="病患整理區段導覽">
        <span className="cmo-kpi-label" style={{ marginRight: 2 }}>快速跳到</span>
        <a href="#cmo-sec-source">來源資料</a>
        <a href="#cmo-sec-problems">健康問題</a>
        <a href="#cmo-sec-map">Problem Map</a>
        <a href="#cmo-sec-meds">用藥整理</a>
        <a href="#cmo-sec-timeline">就醫紀錄</a>
        <a href="#cmo-sec-summary">使用者摘要</a>
      </nav>

      <div className="cmo-review-workspace">
        <section className="cmo-source-column cmo-jump-anchor" id="cmo-sec-source">
          <SourceReview
            workspace={workspace}
            sectionFilter={sectionFilter}
            setSectionFilter={setSectionFilter}
            filteredRecords={filteredRecords}
            selectedRecord={selectedRecord}
            setSelectedRecordId={setSelectedRecordId}
            relationTargets={relationTargets}
            setRelationTarget={setRelationTarget}
            onLink={(entityType, entityId) => void linkEntityToProblem(entityType, entityId)}
            onCreateProblem={openProblemCreator}
            onBatchTriage={(action, ids) => void runSourceBatch(action, ids)}
            busy={busy}
          />
        </section>

        <section className="cmo-output-column">
          <div id="cmo-sec-problems" className="cmo-jump-anchor">
          <ProblemListPanel
            problems={workspace.cmo_output.problems}
            sourceConditions={workspace.cmo_output.unlinked?.conditions ?? workspace.cmo_output.conditions ?? []}
            busy={busy}
            form={problemForm}
            setForm={setProblemForm}
            editingId={editingProblemId}
            editingForm={editingProblemForm}
            setEditingForm={setEditingProblemForm}
            onSubmit={createProblem}
            onAction={runProblemAction}
            onDelete={(problem) => void deleteProblem(problem)}
            onBeginEdit={beginProblemEdit}
            onCancelEdit={() => {
              setEditingProblemId(null)
              setEditingProblemForm(emptyProblemForm)
            }}
            onSaveEdit={(problemId: number) => void saveProblemEdit(problemId)}
                creatorOpen={problemCreatorOpen}
                pendingLink={pendingProblemLink}
                onOpenCreator={() => openProblemCreator()}
                onCloseCreator={closeProblemCreator}
                onClearPendingLink={() => setPendingProblemLink(null)}
          />
          </div>

          <ProblemMapPanel
            problems={workspace.cmo_output.problems}
            conditions={workspace.cmo_output.conditions ?? []}
            medications={workspace.cmo_output.medications}
            unlinked={workspace.cmo_output.unlinked ?? { conditions: [], medications: [] }}
            busy={busy}
            relationTargets={relationTargets}
            setRelationTarget={setRelationTarget}
            onLink={(entityType, entityId) => void linkEntityToProblem(entityType, entityId)}
            onCreateProblem={openProblemCreator}
          />

          <div id="cmo-sec-meds" className="cmo-jump-anchor">
          <MedicationPanel
            medications={workspace.cmo_output.medications}
            problems={workspace.cmo_output.problems}
            busy={busy}
            form={medicationForm}
            setForm={setMedicationForm}
            editingId={editingMedicationId}
            editingForm={editingMedicationForm}
            setEditingForm={setEditingMedicationForm}
            onSubmit={createMedication}
            onAction={runMedicationAction}
            onBeginEdit={beginMedicationEdit}
            onCancelEdit={() => {
              setEditingMedicationId(null)
              setEditingMedicationForm(emptyMedicationForm)
            }}
            onSaveEdit={(medicationId: number) => void saveMedicationEdit(medicationId)}
          />
          </div>

          <div id="cmo-sec-timeline" className="cmo-jump-anchor">
          <TimelineSummaryPanel events={workspace.cmo_output.timeline_summary} />
          </div>

          <div id="cmo-sec-summary" className="cmo-jump-anchor">
          <SummaryBuilder
            workspace={workspace}
            form={summaryForm}
            setForm={setSummaryForm}
            sourceRefs={sourceRefs}
            busy={busy}
            showPreview={showPreview}
            setShowPreview={setShowPreview}
            readiness={publishReadiness}
            overrideReason={overrideReason}
            setOverrideReason={setOverrideReason}
            onSave={() => void saveSummary(false)}
            onReady={() => void saveSummary(true)}
            onPublish={() => void publishSummary()}
            problemForm={problemForm}
            setProblemForm={setProblemForm}
            problemCreatorOpen={problemCreatorOpen}
            pendingProblemLink={pendingProblemLink}
            sourceConditions={workspace.cmo_output.unlinked?.conditions ?? workspace.cmo_output.conditions ?? []}
            onSubmitProblem={createProblem}
            onCreateProblem={(context) => openProblemCreator(context, { keepMode: true })}
            onCloseProblemCreator={closeProblemCreator}
            onClearProblemLink={() => setPendingProblemLink(null)}
            onProblemAction={runProblemAction}
            onDeleteProblem={(problem) => void deleteProblem(problem)}
          />
          </div>
        </section>
      </div>
    </main>
  )
}

function SourceReview({
  workspace,
  sectionFilter,
  setSectionFilter,
  filteredRecords,
  selectedRecord,
  setSelectedRecordId,
  relationTargets,
  setRelationTarget,
  onLink,
  onCreateProblem,
  onBatchTriage,
  busy,
}: {
  workspace: WorkspaceResponse
  sectionFilter: string
  setSectionFilter: (value: string) => void
  filteredRecords: NhiRecord[]
  selectedRecord: NhiRecord | null
  setSelectedRecordId: (value: number) => void
  relationTargets: Record<string, string>
  setRelationTarget: (key: string, value: string) => void
  onLink: (entityType: LinkableResourceType, entityId: number | string) => void
  onCreateProblem: (context?: ProblemCreationContext) => void
  onBatchTriage: (action: 'dismiss' | 'reject' | 'request_missing_data', ids: number[]) => void
  busy: string
}) {
  const overview = workspace.source_review.nhi_overview
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const activeSection = overview.sections.find((section) => section.section === sectionFilter)
  const showRiskSignals = sectionFilter === 'risk'
  const showUploads = sectionFilter === 'all'
  const showNhiRecords = sectionFilter !== 'risk'
  const recordBlockTitle = sectionFilter === 'all' ? 'NHI 解析紀錄' : `${activeSection?.label ?? 'NHI'} 紀錄`
  const hasSelection = selectedIds.length > 0
  const batchTitle = hasSelection ? undefined : '請先勾選至少一筆來源資料'
  const problems = workspace.cmo_output.problems
  const toggleSelected = (recordId: number, checked: boolean) => {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, recordId])) : current.filter((id) => id !== recordId))
  }
  return (
    <div className="cmo-card cmo-section cmo-sticky-panel">
      <div className="cmo-title-row">
        <div>
          <h2 className="cmo-section-title">左側資料來源</h2>
          <div className="cmo-subtitle">CMO 判斷用：原始資料、解析摘要、timeline、診斷、用藥、檢查與風險線索。</div>
        </div>
      </div>

      <div className="cmo-review-metrics">
        <Metric label="NHI 筆數" value={overview.total} />
        <Metric label="待審" value={overview.pending} />
        <Metric label="已採用" value={overview.accepted} />
      </div>

      <div className="cmo-chipbar" style={{ margin: '14px 0' }}>
        <FilterChip active={sectionFilter === 'all'} onClick={() => setSectionFilter('all')}>全部</FilterChip>
        <FilterChip active={sectionFilter === 'risk'} onClick={() => setSectionFilter('risk')}>風險線索</FilterChip>
        {overview.sections.map((section) => (
          <FilterChip key={section.section} active={sectionFilter === section.section} onClick={() => setSectionFilter(section.section)}>
            {section.label} {section.total}
          </FilterChip>
        ))}
      </div>

      <div className="cmo-chipbar" style={{ margin: '0 0 14px' }}>
        <span className="cmo-kpi-label">C1 批次整理：{selectedIds.length} selected</span>
        <button className="cmo-button" disabled={!hasSelection || busy === 'source-batch-dismiss'} title={batchTitle} onClick={() => onBatchTriage('dismiss', selectedIds)}>標記不需處理</button>
        <button className="cmo-button" disabled={!hasSelection || busy === 'source-batch-reject'} title={batchTitle} onClick={() => onBatchTriage('reject', selectedIds)}>拒絕來源</button>
        <button className="cmo-button primary" disabled={!hasSelection || busy === 'source-batch-request_missing_data'} title={batchTitle} onClick={() => onBatchTriage('request_missing_data', selectedIds)}>請使用者補資料</button>
      </div>

      {showRiskSignals && (
        <SourceBlock title="系統偵測風險線索" count={workspace.source_review.risk_signals.length} defaultOpen resetKey={sectionFilter}>
          <RiskSignalCompactList signals={workspace.source_review.risk_signals} />
        </SourceBlock>
      )}

      {showNhiRecords && (
        <SourceBlock title={recordBlockTitle} count={filteredRecords.length} defaultOpen resetKey={sectionFilter}>
          {filteredRecords.length === 0 ? <EmptyText text="這個分類目前沒有 NHI 紀錄。" /> : filteredRecords.slice(0, 80).map((record) => (
            <div
              key={record.id}
              role="button"
              tabIndex={0}
              className={`cmo-list-item cmo-record-button ${selectedRecord?.id === record.id ? 'active' : ''}`}
              onClick={() => setSelectedRecordId(record.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedRecordId(record.id)
                }
              }}
            >
              <div className="cmo-title-row" style={{ gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(record.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(record.id, event.target.checked)}
                  />
                  <strong>{record.title}</strong>
                </label>
                <ToneBadge label={record.section_label} tone={record.status === 'pending' ? 'amber' : record.status === 'accepted' ? 'green' : 'slate'} />
              </div>
              <div className="cmo-subtitle">{formatDateOnly(record.date)} · {cleanText(record.facility, '院所未記錄')}</div>
              <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{cleanText(record.summary || record.diagnosis, '沒有解析摘要')}</div>
              <div className="cmo-chipbar" style={{ marginTop: 8 }}>
                <select
                  className="cmo-select"
                  style={{ minWidth: 160 }}
                  value={relationTargets[`nhi_draft-${record.id}`] ?? ''}
                  disabled={busy === `link-nhi_draft-${record.id}` || problems.length === 0}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setRelationTarget(`nhi_draft-${record.id}`, event.target.value)}
                >
                  <option value="">選 Problem</option>
                  {problems.map((problem) => (
                    <option key={problem.problem_id} value={problem.problem_id}>{problem.plain_language_title || problem.title}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="cmo-button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onCreateProblem({
                      resourceType: 'nhi_draft',
                      resourceId: record.id,
                      resourceLabel: record.title,
                    })
                  }}
                >
                  ＋ 建立並關聯
                </button>
                <button
                  type="button"
                  className="cmo-button primary"
                  disabled={busy === `link-nhi_draft-${record.id}` || !relationTargets[`nhi_draft-${record.id}`]}
                  onClick={(event) => {
                    event.stopPropagation()
                    onLink('nhi_draft', record.id)
                  }}
                >
                  加入 Problem
                </button>
              </div>
            </div>
          ))}
        </SourceBlock>
      )}

      {showNhiRecords && selectedRecord && (
        <div className="cmo-card cmo-section" style={{ marginTop: 14, background: '#f6f9fa' }}>
          <h3 className="cmo-section-title">選取紀錄詳情</h3>
          <KeyValue label="日期" value={formatDateOnly(selectedRecord.date)} />
          <KeyValue label="院所" value={cleanText(selectedRecord.facility)} />
          <KeyValue label="診斷" value={cleanText(selectedRecord.diagnosis)} />
          <KeyValue label="用藥" value={cleanText(selectedRecord.medication)} />
          <KeyValue label="檢查 / 處置" value={cleanText(selectedRecord.exam_or_lab || selectedRecord.procedure)} />
          <details style={{ marginTop: 10 }}>
            <summary className="cmo-button" style={{ width: 'fit-content' }}>查看原始資料</summary>
            <pre className="cmo-source-raw" style={{ marginTop: 10 }}>{selectedRecord.raw_record || selectedRecord.summary || '沒有原始文字'}</pre>
          </details>
        </div>
      )}

      {showUploads && (
        <SourceBlock title="使用者上傳資料" count={workspace.source_review.uploads.length} resetKey={sectionFilter}>
          {workspace.source_review.uploads.length === 0 ? <EmptyText text="目前沒有其他上傳文件。" /> : workspace.source_review.uploads.slice(0, 8).map((doc) => (
            <div key={String(doc.id)} className="cmo-list-item">
              <strong>{String(doc.file_name ?? '未命名文件')}</strong>
              <div className="cmo-subtitle">{String(doc.doc_type ?? 'document')} · {String(doc.processing_status_label ?? doc.status ?? 'status unknown')}</div>
            </div>
          ))}
        </SourceBlock>
      )}
    </div>
  )
}

function ProblemMapPanel({
  problems,
  conditions,
  medications,
  unlinked,
  busy,
  relationTargets,
  setRelationTarget,
  onLink,
  onCreateProblem,
}: {
  problems: HealthProblem[]
  conditions: ConditionReview[]
  medications: MedicationReview[]
  unlinked: UnlinkedItems
  busy: string
  relationTargets: Record<string, string>
  setRelationTarget: (key: string, value: string) => void
  onLink: (entityType: LinkableResourceType, entityId: number | string) => void
  onCreateProblem: (context?: ProblemCreationContext) => void
}) {
  const unlinkedConditions = unlinked.conditions ?? conditions.filter((condition) => !condition.linked_problem_id && !condition.related_problem_id)
  const unlinkedMedications = unlinked.medications ?? medications.filter((medication) => !medication.linked_problem_id && !medication.related_problem_id)
  const text = (row: Record<string, unknown>, keys: string[], fallback = '') => {
    for (const key of keys) {
      const value = row[key]
      if (value !== null && value !== undefined && String(value).trim()) return String(value)
    }
    return fallback
  }
  const rowId = (row: Record<string, unknown>) => String(row.id ?? row.resource_id ?? '')
  const extraColumns = ([
    {
      title: 'NHI rows',
      entityType: 'nhi_draft',
      rows: (unlinked.nhi_drafts ?? []).map((row) => ({
        id: row.id,
        title: row.title || row.diagnosis || row.medication || 'NHI row',
        detail: [row.section_label, row.date, row.facility, row.triage_status].filter(Boolean).join(' · ') || 'NHI source',
      })),
    },
    {
      title: 'Measurements',
      entityType: 'health_record',
      rows: (unlinked.health_records ?? []).map((row) => ({
        id: rowId(row),
        title: text(row, ['record_type'], 'Measurement'),
        detail: [text(row, ['value1']), text(row, ['value2']), text(row, ['unit']), text(row, ['recorded_at'])].filter(Boolean).join(' · ') || 'Patient measurement',
      })),
    },
    {
      title: 'Documents',
      entityType: 'document',
      rows: (unlinked.documents ?? []).map((row) => ({
        id: rowId(row),
        title: text(row, ['file_name'], 'Document'),
        detail: [text(row, ['doc_type']), text(row, ['doc_date', 'created_at'])].filter(Boolean).join(' · ') || 'Uploaded source',
      })),
    },
    {
      title: 'Imaging',
      entityType: 'dicom_study',
      rows: (unlinked.dicom_studies ?? []).map((row) => ({
        id: rowId(row),
        title: text(row, ['study_description', 'modality'], 'Imaging study'),
        detail: [text(row, ['modality']), text(row, ['study_date', 'created_at'])].filter(Boolean).join(' · ') || 'DICOM study',
      })),
    },
    {
      title: 'Follow-ups',
      entityType: 'follow_up',
      rows: (unlinked.follow_ups ?? []).map((row) => ({
        id: rowId(row),
        title: text(row, ['item', 'reason'], 'Follow-up'),
        detail: [text(row, ['suggested_date']), text(row, ['priority']), text(row, ['status'])].filter(Boolean).join(' · ') || 'Follow-up task',
      })),
    },
    {
      title: 'Missing data',
      entityType: 'missing_data_request',
      rows: (unlinked.missing_data_requests ?? []).map((row) => ({
        id: rowId(row),
        title: text(row, ['title'], 'Missing data request'),
        detail: [text(row, ['priority']), text(row, ['status'])].filter(Boolean).join(' · ') || text(row, ['reason'], 'Request'),
      })),
    },
  ] as Array<{ title: string; entityType: LinkableResourceType; rows: LinkableRow[] }>).filter((column) => column.rows.length > 0)
  const unlinkedCount = unlinkedConditions.length + unlinkedMedications.length + extraColumns.reduce((sum, column) => sum + column.rows.length, 0)

  return (
    <section className="cmo-card cmo-section cmo-jump-anchor" id="cmo-sec-map">
      <div className="cmo-title-row">
        <div>
          <h2 className="cmo-section-title">Problem Map</h2>
          <div className="cmo-subtitle">把 diagnosis / medication 配對到同一個 Problem，避免住院與門診資料只平鋪顯示。</div>
        </div>
        <div className="cmo-chipbar" style={{ justifyContent: 'flex-end' }}>
          <ToneBadge label={unlinkedCount === 0 ? 'All linked' : `${unlinkedCount} unlinked`} tone={unlinkedCount === 0 ? 'green' : 'amber'} />
          <button type="button" className="cmo-button primary" onClick={() => onCreateProblem()}>＋ 建立 Problem</button>
        </div>
      </div>

      <div className="cmo-list" style={{ marginTop: 12 }}>
        {problems.length === 0 ? <EmptyText text="尚未建立 Problem，請先新增一個可整理的 Problem。" /> : problems.map((problem) => {
          const relatedConditions = problem.related_conditions ?? conditions.filter((condition) => (condition.linked_problem_id ?? condition.related_problem_id) === problem.problem_id)
          const relatedMeds = problem.related_medications ?? medications.filter((medication) => (medication.linked_problem_id ?? medication.related_problem_id) === problem.problem_id)
          return (
            <div key={problem.problem_id} className="cmo-list-item">
              <div className="cmo-title-row" style={{ gap: 8 }}>
                <div>
                  <strong>{problem.plain_language_title || problem.title}</strong>
                  <div className="cmo-subtitle">
                    {problem.problem_kind || 'active'} · {problem.diagnosis_status || 'pending'} · {problem.icd10_code || 'no ICD'}
                  </div>
                </div>
                <div className="cmo-chipbar" style={{ justifyContent: 'flex-end' }}>
                  <span className="cmo-chip">{relatedConditions.length} diagnosis</span>
                  <span className="cmo-chip">{relatedMeds.length} medication</span>
                  <span className="cmo-chip">{problem.linked_resources_count ?? 0} linked source</span>
                </div>
              </div>
              <div className="cmo-map-grid">
                <div>
                  <div className="cmo-kpi-label">Diagnosis / condition</div>
                  {relatedConditions.length === 0 ? (
                    <div className="cmo-muted">尚未配對 diagnosis 或 condition。</div>
                  ) : relatedConditions.map((condition) => (
                    <div key={condition.id} className="cmo-map-pill">
                      {condition.display_name}{condition.icd10_code ? ` · ${condition.icd10_code}` : ''}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="cmo-kpi-label">Medication</div>
                  {relatedMeds.length === 0 ? (
                    <div className="cmo-muted">尚未配對用藥。</div>
                  ) : relatedMeds.map((medication) => (
                    <div key={medication.id} className="cmo-map-pill">
                      {medication.medication_name}{medication.dose ? ` · ${medication.dose}` : ''}{medication.frequency ? ` · ${medication.frequency}` : ''}
                    </div>
                  ))}
                </div>
              </div>
              {problem.timeline && problem.timeline.length > 0 && (
                <div className="cmo-chipbar" style={{ marginTop: 8 }}>
                  {problem.timeline.slice(0, 4).map((item) => (
                    <span key={item.id} className="cmo-chip">{item.type}: {item.label}</span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="cmo-card cmo-section cmo-map-unlinked">
        <div className="cmo-title-row" style={{ marginBottom: 10 }}>
          <div>
            <h3 className="cmo-section-title">Unlinked items</h3>
            <div className="cmo-subtitle">這些資料還沒有被放到任何 Problem 下；選擇 Problem 後會寫入 audit。</div>
          </div>
        </div>
        {unlinkedCount === 0 ? (
          <EmptyText text="目前沒有未配對的來源資料。" />
        ) : (
          <div className="cmo-map-grid">
            <UnlinkedRelationColumn
              title="Diagnosis / condition"
              entityType="condition"
              rows={unlinkedConditions.map((condition) => ({
                id: condition.id,
                title: condition.display_name,
                detail: [condition.icd10_code, condition.status].filter(Boolean).join(' · ') || 'No status',
              }))}
              problems={problems}
              busy={busy}
              relationTargets={relationTargets}
              setRelationTarget={setRelationTarget}
              onLink={onLink}
              onCreateProblem={onCreateProblem}
            />
            <UnlinkedRelationColumn
              title="Medication"
              entityType="medication"
              rows={unlinkedMedications.map((medication) => ({
                id: medication.id,
                title: medication.medication_name || medication.drug_name || 'Medication',
                detail: [medication.dose, medication.frequency, medication.possible_indication].filter(Boolean).join(' · ') || 'No regimen detail',
              }))}
              problems={problems}
              busy={busy}
              relationTargets={relationTargets}
              setRelationTarget={setRelationTarget}
              onLink={onLink}
              onCreateProblem={onCreateProblem}
            />
            {extraColumns.map((column) => (
              <UnlinkedRelationColumn
                key={column.entityType}
                title={column.title}
                entityType={column.entityType}
                rows={column.rows}
                problems={problems}
                busy={busy}
                relationTargets={relationTargets}
                setRelationTarget={setRelationTarget}
                onLink={onLink}
              onCreateProblem={onCreateProblem}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function UnlinkedRelationColumn({
  title,
  entityType,
  rows,
  problems,
  busy,
  relationTargets,
  setRelationTarget,
  onLink,
  onCreateProblem,
}: {
  title: string
  entityType: LinkableResourceType
  rows: LinkableRow[]
  problems: HealthProblem[]
  busy: string
  relationTargets: Record<string, string>
  setRelationTarget: (key: string, value: string) => void
  onLink: (entityType: LinkableResourceType, entityId: number | string) => void
  onCreateProblem: (context: ProblemCreationContext) => void
}) {
  return (
    <div>
      <div className="cmo-kpi-label" style={{ marginBottom: 8 }}>{title}</div>
      <div className="cmo-list">
        {rows.length === 0 ? <div className="cmo-muted">No unlinked {title.toLowerCase()}.</div> : rows.map((row) => {
          const key = `${entityType}-${row.id}`
          const isBusy = busy === `link-${key}`
          return (
            <div key={key} className="cmo-list-item">
              <strong>{row.title}</strong>
              <div className="cmo-subtitle">{row.detail}</div>
              <div className="cmo-map-link-row">
                <select
                  className="cmo-select"
                  value={relationTargets[key] ?? ''}
                  disabled={isBusy || problems.length === 0}
                  onChange={(event) => setRelationTarget(key, event.target.value)}
                >
                  <option value="">Select problem</option>
                  {problems.map((problem) => (
                    <option key={problem.problem_id} value={problem.problem_id}>{problem.plain_language_title || problem.title}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="cmo-button"
                  disabled={isBusy}
                  onClick={() => onCreateProblem({ resourceType: entityType, resourceId: row.id, resourceLabel: row.title })}
                >
                  建立並關聯
                </button>
                <button
                  type="button"
                  className="cmo-button primary"
                  disabled={isBusy || !relationTargets[key]}
                  onClick={() => onLink(entityType, row.id)}
                >
                  {isBusy ? '關聯中…' : '關聯'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProblemCreateForm({
  sourceConditions,
  busy,
  form,
  setForm,
  pendingLink,
  onSubmit,
  onClose,
  onClearPendingLink,
}: {
  sourceConditions: ConditionReview[]
  busy: string
  form: ProblemForm
  setForm: (form: ProblemForm) => void
  pendingLink: ProblemCreationContext | null
  onSubmit: (event: FormEvent) => void
  onClose: () => void
  onClearPendingLink: () => void
}) {
  return (
    <form id="cmo-new-problem-form" onSubmit={onSubmit} className="cmo-card cmo-section" style={{ marginTop: 14, background: '#f6f9fa' }}>
      <div className="cmo-title-row">
        <div>
          <h3 className="cmo-section-title">新增健康問題</h3>
          <div className="cmo-subtitle">先建立 Problem 草稿，再確認與發布；有來源時可在同一次操作完成關聯。</div>
        </div>
        <button type="button" className="cmo-button" disabled={busy === 'problem'} onClick={onClose}>收合</button>
      </div>
      {pendingLink && (
        <div className="cmo-card cmo-section" style={{ margin: '12px 0', borderColor: '#b9d8ca', background: '#eef8f3' }}>
          <div className="cmo-title-row" style={{ gap: 10 }}>
            <div>
              <div className="cmo-kpi-label">建立後自動關聯</div>
              <strong>{pendingLink.resourceLabel}</strong>
            </div>
            <button type="button" className="cmo-button" onClick={onClearPendingLink}>只建立，不關聯</button>
          </div>
        </div>
      )}
      {sourceConditions.length > 0 && (
        <div className="cmo-chipbar" style={{ margin: '12px 0 8px' }}>
          <span className="cmo-kpi-label" style={{ alignSelf: 'center', marginRight: 2 }}>從病人診斷帶入</span>
          {sourceConditions.slice(0, 8).map((condition) => (
            <button key={condition.id} type="button" className="cmo-chip" title={condition.icd10_code ?? undefined} onClick={() => setForm({ ...form, ...problemPatchFromCondition(condition) })}>{condition.display_name}</button>
          ))}
        </div>
      )}
      <div className="cmo-chipbar" style={{ marginBottom: 8 }}>
        <span className="cmo-kpi-label" style={{ alignSelf: 'center', marginRight: 2 }}>常見診斷一鍵帶入</span>
        {COMMON_PROBLEM_PRESETS.map((preset) => (
          <button key={preset.label} type="button" className="cmo-chip" onClick={() => setForm({ ...form, ...preset.patch })}>{preset.label}</button>
        ))}
      </div>
      <div className="cmo-form-grid">
        <label>
          <span className="cmo-kpi-label">問題名稱</span>
          <input id="cmo-new-problem-title" className="cmo-input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：頭部外傷後出血追蹤" />
        </label>
        <label>
          <span className="cmo-kpi-label">白話問題名稱</span>
          <input className="cmo-input" value={form.plainTitle} onChange={(event) => setForm({ ...form, plainTitle: event.target.value })} placeholder="使用者看得懂的名稱" />
        </label>
        <label>
          <span className="cmo-kpi-label">嚴重程度</span>
          <select className="cmo-select" value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value as ProblemForm['severity'] })}>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
            <option value="insufficient">資訊不足</option>
          </select>
        </label>
        <label>
          <span className="cmo-kpi-label">目前狀態</span>
          <select className="cmo-select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProblemForm['status'] })}>
            <option value="following">需要追蹤</option>
            <option value="underlying">穩定觀察</option>
            <option value="resolved">已處理</option>
          </select>
        </label>
      </div>
      <ProblemAdvancedFields form={form} setForm={setForm} />
      <label>
        <span className="cmo-kpi-label">CMO 內部備註</span>
        <textarea className="cmo-textarea" value={form.cmoNote} onChange={(event) => setForm({ ...form, cmoNote: event.target.value })} placeholder="只給 CMO 看的交班或判斷依據，不會出現在使用者端。" />
      </label>
      <label>
        <span className="cmo-kpi-label">使用者可見說明</span>
        <textarea className="cmo-textarea" value={form.userExplanation} onChange={(event) => setForm({ ...form, userExplanation: event.target.value })} placeholder="白話說明，避免看起來像直接診斷。" />
      </label>
      <div className="cmo-chipbar">
        <button className="cmo-button primary" disabled={busy === 'problem' || !form.title.trim()}>
          {busy === 'problem' ? '建立中…' : pendingLink ? '建立並關聯' : '建立 Problem'}
        </button>
        <button type="button" className="cmo-button" disabled={busy === 'problem'} onClick={onClose}>取消</button>
      </div>
    </form>
  )
}

function C7ProblemReviewPanel({
  workspace,
  busy,
  form,
  setForm,
  creatorOpen,
  pendingLink,
  sourceConditions,
  onSubmit,
  onCreateProblem,
  onCloseCreator,
  onClearPendingLink,
  onProblemAction,
  onDeleteProblem,
  onUseProblem,
}: {
  workspace: WorkspaceResponse
  busy: string
  form: ProblemForm
  setForm: (form: ProblemForm) => void
  creatorOpen: boolean
  pendingLink: ProblemCreationContext | null
  sourceConditions: ConditionReview[]
  onSubmit: (event: FormEvent) => void
  onCreateProblem: (context?: ProblemCreationContext) => void
  onCloseCreator: () => void
  onClearPendingLink: () => void
  onProblemAction: (problem: HealthProblem, action: ProblemAction) => void
  onDeleteProblem: (problem: HealthProblem) => void
  onUseProblem: (problem: HealthProblem) => void
}) {
  const problems = workspace.cmo_output.problems
  const evidenceRows = workspace.source_review.nhi_records
    .filter((record) => record.triage_status !== 'dismissed' && record.triage_status !== 'rejected')
    .slice(0, 6)
  const existingNames = new Set(problems.flatMap((problem) => [problem.title, problem.plain_language_title].filter(Boolean).map((value) => String(value).trim().toLowerCase())))
  const candidateConditions = sourceConditions
    .filter((condition) => !existingNames.has(String(condition.display_name ?? '').trim().toLowerCase()))
    .slice(0, 5)

  return (
    <section className="cmo-c7-problem-review" aria-label="C7 Problem review and creation">
      <div className="cmo-title-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="cmo-kpi-label">同頁審閱與建立</div>
          <h4 className="cmo-section-title">Patient Problem 工作區</h4>
          <div className="cmo-subtitle">選既有 Problem 帶入 C7；也能從病人資料建立並自動關聯，或直接手動新增。</div>
        </div>
        <button type="button" className="cmo-button primary" onClick={() => creatorOpen ? onCloseCreator() : onCreateProblem()}>
          {creatorOpen ? '收合新增' : '＋ 快捷新增 Problem'}
        </button>
      </div>

      <div className="cmo-c7-review-grid">
        <div className="cmo-c7-review-pane">
          <div className="cmo-title-row" style={{ gap: 8 }}>
            <strong>目前 Problem</strong>
            <ToneBadge label={`${problems.length} 筆`} tone={problems.length ? 'blue' : 'amber'} />
          </div>
          <div className="cmo-c7-review-list">
            {problems.length === 0 ? <EmptyText text="目前沒有 Problem，可從右側病人資料建立或手動新增。" /> : problems.map((problem) => {
              const label = problem.plain_language_title || problem.title
              const problemBusy = busy === `problem-${problem.problem_id}` || busy === `problem-delete-${problem.problem_id}`
              return (
                <article key={problem.problem_id} className="cmo-c7-problem-row">
                  <div>
                    <strong>{label}</strong>
                    <div className="cmo-subtitle">{problem.icd10_code || '無 ICD-10'} · {problem.is_published ? '使用者可見' : problem.is_verified ? '已確認、未發布' : '待確認草稿'}</div>
                  </div>
                  <div className="cmo-chipbar">
                    <button type="button" className="cmo-button" disabled={problemBusy} onClick={() => onUseProblem(problem)}>帶入 C7</button>
                    {problem.is_published ? (
                      <button type="button" className="cmo-button" disabled={problemBusy} onClick={() => onProblemAction(problem, 'unpublish')} title="已發布內容需先撤下，才能刪除">
                        先撤下
                      </button>
                    ) : (
                      <button type="button" className="cmo-button danger" disabled={problemBusy} onClick={() => onDeleteProblem(problem)}>
                        {busy === `problem-delete-${problem.problem_id}` ? '刪除中…' : '刪除'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </div>

        <div className="cmo-c7-review-pane">
          <div className="cmo-title-row" style={{ gap: 8 }}>
            <strong>可轉成 Problem 的病人資料</strong>
            <ToneBadge label="建立時自動關聯" tone="green" />
          </div>
          <div className="cmo-c7-review-list">
            {candidateConditions.map((condition) => (
              <article key={`condition-${condition.id}`} className="cmo-c7-evidence-row">
                <div>
                  <strong>{condition.display_name}</strong>
                  <div className="cmo-subtitle">診斷 / 病史{condition.icd10_code ? ` · ${condition.icd10_code}` : ''}</div>
                </div>
                <button type="button" className="cmo-button" onClick={() => onCreateProblem({ resourceType: 'condition', resourceId: condition.id, resourceLabel: condition.display_name })}>由此建立</button>
              </article>
            ))}
            {evidenceRows.map((record) => {
              const label = cleanText(record.diagnosis || record.title || record.summary, `${record.section_label}紀錄`)
              return (
                <article key={`nhi-${record.id}`} className="cmo-c7-evidence-row">
                  <div>
                    <strong>{shortText(label, 'NHI 紀錄', 46)}</strong>
                    <div className="cmo-subtitle">{record.section_label} · {formatDateOnly(record.date)} · {record.facility || '院所未記錄'}</div>
                  </div>
                  <button type="button" className="cmo-button" onClick={() => onCreateProblem({ resourceType: 'nhi_draft', resourceId: record.id, resourceLabel: label })}>由此建立</button>
                </article>
              )
            })}
            {candidateConditions.length === 0 && evidenceRows.length === 0 && <EmptyText text="目前沒有待整理的病人資料；仍可使用手動新增。" />}
          </div>
        </div>
      </div>

      {creatorOpen && (
        <ProblemCreateForm
          sourceConditions={sourceConditions}
          busy={busy}
          form={form}
          setForm={setForm}
          pendingLink={pendingLink}
          onSubmit={onSubmit}
          onClose={onCloseCreator}
          onClearPendingLink={onClearPendingLink}
        />
      )}
    </section>
  )
}
function ProblemListPanel({
  problems,
  sourceConditions,
  busy,
  form,
  setForm,
  editingId,
  editingForm,
  setEditingForm,
  onSubmit,
  onAction,
  onDelete,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  creatorOpen,
  pendingLink,
  onOpenCreator,
  onCloseCreator,
  onClearPendingLink,
}: {
  problems: HealthProblem[]
  sourceConditions: ConditionReview[]
  busy: string
  form: ProblemForm
  setForm: (form: ProblemForm) => void
  editingId: number | null
  editingForm: ProblemForm
  setEditingForm: (form: ProblemForm) => void
  onSubmit: (event: FormEvent) => void
  onAction: (problem: HealthProblem, action: ProblemAction) => void
  onDelete: (problem: HealthProblem) => void
  onBeginEdit: (problem: HealthProblem) => void
  onCancelEdit: () => void
  onSaveEdit: (problemId: number) => void
  creatorOpen: boolean
  pendingLink: ProblemCreationContext | null
  onOpenCreator: () => void
  onCloseCreator: () => void
  onClearPendingLink: () => void
}) {
  return (
    <div className="cmo-card cmo-section cmo-structure-panel cmo-problem-work-panel">
      <div className="cmo-title-row">
        <div>
          <h2 className="cmo-section-title">主要健康問題</h2>
          <div className="cmo-subtitle">CMO 內部 note 和使用者可見說明分開。發布後才會進入使用者端。</div>
        </div>
        <button type="button" className="cmo-button primary" onClick={creatorOpen ? onCloseCreator : onOpenCreator}>
          {creatorOpen ? '收合建立表單' : '＋ 建立 Problem'}
        </button>
      </div>

      {creatorOpen && (
        <ProblemCreateForm
          sourceConditions={sourceConditions}
          busy={busy}
          form={form}
          setForm={setForm}
          pendingLink={pendingLink}
          onSubmit={onSubmit}
          onClose={onCloseCreator}
          onClearPendingLink={onClearPendingLink}
        />
      )}

      <div className="cmo-list" style={{ marginTop: 12 }}>
        {problems.length === 0 ? <EmptyText text="尚未建立 problem list。" /> : problems.map((problem) => (
          <article key={problem.problem_id} className="cmo-list-item">
            <div className="cmo-title-row">
              <div>
                <strong>{problem.plain_language_title || problem.title}</strong>
                <div className="cmo-subtitle">{problem.title}{problem.icd10_code ? ` · ${problem.icd10_code}` : ''}</div>
              </div>
              <div className="cmo-chipbar">
                <ToneBadge label={severityLabels[problem.severity]} tone={problem.severity === 'high' ? 'red' : problem.severity === 'medium' ? 'amber' : 'slate'} />
                <ToneBadge label={`診斷：${diagnosisStatusLabel(problem.diagnosis_status)}`} tone={diagnosisStatusTone(problem.diagnosis_status)} />
                <ToneBadge label={`類型：${problemKindLabel(problem.problem_kind)}`} tone="slate" />
                <ToneBadge label={problem.is_published ? '使用者可見' : problem.is_verified ? '已確認' : '待確認'} tone={problem.is_published ? 'green' : problem.is_verified ? 'blue' : 'amber'} />
              </div>
            </div>
            <div className="cmo-review-two">
              <div>
                <div className="cmo-kpi-label">診斷描述</div>
                <p>{cleanText(problem.diagnosis_description, '尚未保留診斷書或病歷描述')}</p>
              </div>
              <div>
                <div className="cmo-kpi-label">依據 / 判斷</div>
                <p>{cleanText(problem.evidence_note, '尚未填寫確診、疑似、排除或待確認依據')}</p>
              </div>
              <div>
                <div className="cmo-kpi-label">治療 / 處置</div>
                <p>{cleanText(problem.treatment_plan, '尚未整理藥物、手術、影像、檢查或治療過程')}</p>
              </div>
              <div>
                <div className="cmo-kpi-label">追蹤</div>
                <p>{[problem.follow_up_cadence, problem.follow_up_recommendation].filter(Boolean).join(' · ') || '尚未設定固定回診頻率或追蹤建議'}</p>
              </div>
            </div>
            <div className="cmo-review-two">
              <div>
                <div className="cmo-kpi-label">CMO 內部備註</div>
                <p>{cleanText(problem.cmo_internal_note, '沒有內部備註')}</p>
              </div>
              <div>
                <div className="cmo-kpi-label">使用者可見說明</div>
                <p>{cleanText(problem.user_visible_explanation, '尚未整理白話說明')}</p>
              </div>
            </div>
            <div className="cmo-chipbar">
              <button type="button" className="cmo-button" disabled={busy === `problem-${problem.problem_id}` || busy === `problem-edit-${problem.problem_id}`} onClick={() => onBeginEdit(problem)}>Edit</button>
              {!problem.is_verified && (
                <>
                  <button className="cmo-button" disabled={busy === `problem-${problem.problem_id}`} onClick={() => onAction(problem, 'verify')}>只確認</button>
                  <button className="cmo-button primary" disabled={busy === `problem-${problem.problem_id}`} onClick={() => onAction(problem, 'verify_publish')}>確認並發布</button>
                </>
              )}
              {problem.is_verified && !problem.is_published && <button className="cmo-button primary" disabled={busy === `problem-${problem.problem_id}`} onClick={() => onAction(problem, 'publish')}>發布給使用者</button>}
              {problem.is_published && (
                <>
                  <button className="cmo-button" disabled={busy === `problem-${problem.problem_id}`} onClick={() => onAction(problem, 'unpublish')}>撤下</button>
                  <button type="button" className="cmo-button danger" disabled title="已發布的 Problem 必須先撤下才能刪除">先撤下才能刪除</button>
                </>
              )}
              {!problem.is_published && (
                <button
                  type="button"
                  className="cmo-button danger"
                  disabled={busy === `problem-delete-${problem.problem_id}`}
                  onClick={() => onDelete(problem)}
                  title="刪除未發布的 Problem 草稿"
                >
                  {busy === `problem-delete-${problem.problem_id}` ? '刪除中…' : '刪除'}
                </button>
              )}
            </div>
            {editingId === problem.problem_id && (
              <form
                className="cmo-card cmo-section"
                style={{ marginTop: 12, background: '#f6f9fa' }}
                onSubmit={(event) => {
                  event.preventDefault()
                  onSaveEdit(problem.problem_id)
                }}
              >
                <h3 className="cmo-section-title">Edit problem</h3>
                {problem.is_published && (
                  <div className="cmo-subtitle" style={{ marginBottom: 10, color: '#a03a30' }}>
                    這筆已發布；儲存後會立即同步給使用者。如需先內部修訂，請先撤下。
                  </div>
                )}
                <ProblemFormFields form={editingForm} setForm={setEditingForm} />
                <div className="cmo-chipbar">
                  <button className="cmo-button primary" disabled={busy === `problem-edit-${problem.problem_id}` || !editingForm.title.trim()}>Save changes</button>
                  <button type="button" className="cmo-button" disabled={busy === `problem-edit-${problem.problem_id}`} onClick={onCancelEdit}>Cancel</button>
                </div>
              </form>
            )}
          </article>
        ))}
      </div>

    </div>
  )
}

function MedicationPanel({
  medications,
  problems,
  busy,
  form,
  setForm,
  editingId,
  editingForm,
  setEditingForm,
  onSubmit,
  onAction,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
}: {
  medications: MedicationReview[]
  problems: HealthProblem[]
  busy: string
  form: MedicationForm
  setForm: (form: MedicationForm) => void
  editingId: number | null
  editingForm: MedicationForm
  setEditingForm: (form: MedicationForm) => void
  onSubmit: (event: FormEvent) => void
  onAction: (medication: MedicationReview, action: 'publish' | 'unpublish') => void
  onBeginEdit: (medication: MedicationReview) => void
  onCancelEdit: () => void
  onSaveEdit: (medicationId: number) => void
}) {
  return (
    <div className="cmo-card cmo-section cmo-structure-panel cmo-medication-work-panel">
      <h2 className="cmo-section-title">用藥整理</h2>
      <div className="cmo-list">
        {medications.length === 0 ? <EmptyText text="尚未建立用藥整理。" /> : medications.map((medication) => (
          <div key={medication.id} className="cmo-list-item">
            <div className="cmo-title-row">
              <div>
                <strong>{medication.medication_name}</strong>
                <div className="cmo-subtitle">{cleanText(medication.frequency, '頻率未記錄')} · {cleanText(medication.possible_indication, '用途待確認')}</div>
              </div>
              <ToneBadge label={medication.is_published ? '使用者可見' : medication.is_verified ? '已確認' : '待確認'} tone={medication.is_published ? 'green' : medication.is_verified ? 'blue' : 'amber'} />
            </div>
            {(() => {
              const linkedProblemId = medication.linked_problem_id ?? medication.related_problem_id
              const linkedProblem = linkedProblemId == null ? null : problems.find((problem) => problem.problem_id === linkedProblemId)
              const priceLabel = medication.price_amount == null ? '' : `${medication.price_currency || 'TWD'} ${medication.price_amount}`
              return (
                <div className="cmo-chipbar" style={{ marginTop: 8 }}>
                  {medication.generic_name_en && <span className="cmo-badge">Generic: {medication.generic_name_en}</span>}
                  {medication.brand_name && <span className="cmo-badge">Brand: {medication.brand_name}</span>}
                  {medication.dose && <span className="cmo-badge">Dose: {medication.dose}</span>}
                  {linkedProblem && <span className="cmo-badge">Problem: {linkedProblem.plain_language_title || linkedProblem.title}</span>}
                  {medication.is_self_paid && <span className="cmo-badge">Self-paid{priceLabel ? ` · ${priceLabel}` : ''}</span>}
                </div>
              )
            })()}
            <p style={{ margin: '8px 0', color: '#45596a', lineHeight: 1.55 }}>{cleanText(medication.cmo_comment, '沒有 CMO 備註')}</p>
            <div className="cmo-chipbar">
              <button type="button" className="cmo-button" disabled={busy === `med-${medication.id}` || busy === `med-edit-${medication.id}`} onClick={() => onBeginEdit(medication)}>Edit</button>
              {!medication.is_published ? (
                <button className="cmo-button primary" disabled={busy === `med-${medication.id}`} onClick={() => onAction(medication, 'publish')}>發布用藥摘要</button>
              ) : (
                <button className="cmo-button" disabled={busy === `med-${medication.id}`} onClick={() => onAction(medication, 'unpublish')}>撤下</button>
              )}
            </div>
            {editingId === medication.id && (
              <form
                className="cmo-card cmo-section"
                style={{ marginTop: 12, background: '#f6f9fa' }}
                onSubmit={(event) => {
                  event.preventDefault()
                  onSaveEdit(medication.id)
                }}
              >
                <h3 className="cmo-section-title">Edit medication</h3>
                <MedicationFormFields form={editingForm} setForm={setEditingForm} problems={problems} />
                <div className="cmo-chipbar">
                  <button className="cmo-button primary" disabled={busy === `med-edit-${medication.id}` || !editingForm.medicationName.trim()}>Save changes</button>
                  <button type="button" className="cmo-button" disabled={busy === `med-edit-${medication.id}`} onClick={onCancelEdit}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={onSubmit} className="cmo-card cmo-section" style={{ marginTop: 14, background: '#f6f9fa' }}>
        <h3 className="cmo-section-title">新增用藥整理</h3>
        <div className="cmo-chipbar" style={{ marginBottom: 8 }}>
          <span className="cmo-kpi-label" style={{ alignSelf: 'center', marginRight: 2 }}>常用處方一鍵帶入</span>
          {COMMON_MED_PRESETS.map((preset) => (
            <button key={preset.label} type="button" className="cmo-chip" onClick={() => setForm({ ...form, ...preset.patch })}>{preset.label}</button>
          ))}
        </div>
        <div className="cmo-form-grid">
          <label>
            <span className="cmo-kpi-label">藥物名稱</span>
            <input className="cmo-input" value={form.medicationName} onChange={(event) => setForm({ ...form, medicationName: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">可能用途</span>
            <input className="cmo-input" value={form.possibleIndication} onChange={(event) => setForm({ ...form, possibleIndication: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">頻率 / 時間</span>
            <input className="cmo-input" value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })} />
            <QuickPick options={MED_FREQUENCY_OPTIONS} value={form.frequency} onPick={(next) => setForm({ ...form, frequency: next })} ariaLabel="常用頻次" />
          </label>
        </div>
        <MedicationAdvancedFields form={form} setForm={setForm} problems={problems} />
        <label>
          <span className="cmo-kpi-label">CMO comment</span>
          <textarea className="cmo-textarea" value={form.cmoComment} onChange={(event) => setForm({ ...form, cmoComment: event.target.value })} />
        </label>
        <button className="cmo-button primary" disabled={busy === 'medication' || !form.medicationName.trim()}>新增用藥整理</button>
      </form>
    </div>
  )
}

function RiskSignalCompactList({ signals }: { signals: WorkspaceResponse['source_review']['risk_signals'] }) {
  if (signals.length === 0) return <EmptyText text="目前沒有高風險線索。" />
  return (
    <div className="cmo-compact-alert-list">
      {signals.slice(0, 8).map((signal) => (
        <details key={signal.id} className={`cmo-compact-alert ${signal.severity === 'high' ? 'high' : 'medium'}`}>
          <summary>
            <span className="cmo-alert-dot" />
            <span className="cmo-compact-alert-main">
              <strong>{shortText(signal.label, '風險線索', 72)}</strong>
              <small>{formatDateOnly(signal.date)} · {cleanText(signal.source, '來源未記錄')}</small>
            </span>
            <ToneBadge label={signal.severity === 'high' ? '高' : '中'} tone={signal.severity === 'high' ? 'red' : 'amber'} />
          </summary>
          <div className="cmo-compact-alert-body">{cleanText(signal.summary, '沒有摘要')}</div>
        </details>
      ))}
      {signals.length > 8 && <div className="cmo-subtitle">另有 {signals.length - 8} 筆風險線索；請用上方篩選切到「風險線索」查看完整 NHI 紀錄。</div>}
    </div>
  )
}

function TimelineSummaryPanel({ events }: { events: NHITimelineEvent[] }) {
  return (
    <div className="cmo-card cmo-section">
      <div className="cmo-title-row">
        <div>
          <h2 className="cmo-section-title">這次需要看的變化</h2>
          <div className="cmo-subtitle">以 bulletin timeline 呈現來源、日期與重點；展開後再看用藥、檢查、處置與原始摘要。</div>
        </div>
        <ToneBadge label={`${events.length} 筆`} tone={events.length ? 'blue' : 'slate'} />
      </div>
      <div className="cmo-bulletin-list">
        {events.length === 0 ? <EmptyText text="目前沒有可整理的 timeline。" /> : events.slice(0, 12).map((event) => (
          <details key={event.id} className="cmo-bulletin-item">
            <summary>
              <span className="cmo-bulletin-date">{formatDateOnly(event.date)}</span>
              <span className="cmo-bulletin-main">
                <strong>{shortText(event.normalized_summary || event.diagnosis || event.medication || event.exam_or_lab || event.procedure, '就醫紀錄', 96)}</strong>
                <small>{cleanText(event.institution, '院所未記錄')} · {cleanText(event.department, '科別未記錄')}</small>
              </span>
              <span className="cmo-bulletin-tag">{event.section_label}</span>
            </summary>
            <div className="cmo-bulletin-body">
              <KeyValue label="摘要" value={cleanText(event.normalized_summary, '沒有摘要')} />
              <KeyValue label="診斷" value={cleanText(event.diagnosis, '沒有診斷摘要')} />
              <KeyValue label="用藥" value={cleanText(event.medication, '沒有用藥摘要')} />
              <KeyValue label="檢查" value={cleanText(event.exam_or_lab, '沒有檢查摘要')} />
              <KeyValue label="處置" value={cleanText(event.procedure, '沒有處置摘要')} />
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

function shortText(value: string | null | undefined, fallback: string, maxLength: number) {
  const text = cleanText(value, fallback)
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trim()}...`
}

function SummaryBuilder({
  workspace,
  form,
  setForm,
  sourceRefs,
  busy,
  showPreview,
  setShowPreview,
  readiness,
  overrideReason,
  setOverrideReason,
  onSave,
  onReady,
  onPublish,
  problemForm,
  setProblemForm,
  problemCreatorOpen,
  pendingProblemLink,
  sourceConditions,
  onSubmitProblem,
  onCreateProblem,
  onCloseProblemCreator,
  onClearProblemLink,
  onProblemAction,
  onDeleteProblem,
}: {
  workspace: WorkspaceResponse
  form: SummaryForm
  setForm: (form: SummaryForm) => void
  sourceRefs: SummarySourceRef[]
  busy: string
  showPreview: boolean
  setShowPreview: (value: boolean) => void
  readiness: PublishReadiness | null
  overrideReason: string
  setOverrideReason: (value: string) => void
  onSave: () => void
  onReady: () => void
  onPublish: () => void
  problemForm: ProblemForm
  setProblemForm: (form: ProblemForm) => void
  problemCreatorOpen: boolean
  pendingProblemLink: ProblemCreationContext | null
  sourceConditions: ConditionReview[]
  onSubmitProblem: (event: FormEvent) => void
  onCreateProblem: (context?: ProblemCreationContext) => void
  onCloseProblemCreator: () => void
  onClearProblemLink: () => void
  onProblemAction: (problem: HealthProblem, action: ProblemAction) => void
  onDeleteProblem: (problem: HealthProblem) => void
}) {
  const checks = summaryPublishChecks(form, sourceRefs)
  const localBlockers = SUMMARY_PUBLISH_CHECKS.filter((item) => !checks[item.key]).map((item) => item.blocker)
  const serverBlockers = readiness?.blockers ?? []
  const highRiskFlags = readiness?.high_risk_flags ?? []
  const needsOverride = Boolean(readiness?.requires_secondary_review)
  const overrideMissing = needsOverride && !overrideReason.trim()
  const canMarkReady = allRecommendationChecksPass(checks) && serverBlockers.length === 0
  const canPublish = canMarkReady
  const readyBlockers = [
    ...localBlockers,
    ...serverBlockers.map((item) => item.detail || item.label),
  ]
  const blockers = [
    ...readyBlockers,
    ...(overrideMissing ? ['Enter an override reason for high-risk publish.'] : []),
  ]

  return (
    <div className="cmo-card cmo-section">
      <div className="cmo-title-row">
        <div>
          <h2 className="cmo-section-title">使用者摘要編輯</h2>
          <div className="cmo-subtitle">以下內容會出現在使用者端；請保持白話、精簡、可行動。</div>
        </div>
        <ToneBadge label="使用者可見" tone="green" />
      </div>
      {readiness && (
        <div id="publish-readiness" className="cmo-section" style={{ background: '#f6f9fa', border: '1px solid #e3e9ee', borderRadius: 8, margin: '12px 0', padding: 12, scrollMarginTop: 90 }}>
          <div className="cmo-title-row">
            <div>
              <h3 className="cmo-section-title">Server publish readiness</h3>
              <div className="cmo-subtitle">Member: {readiness.member_name || 'not selected'} / blockers {serverBlockers.length} / high risk {highRiskFlags.length}</div>
            </div>
            <ToneBadge label={serverBlockers.length ? 'Blocked' : needsOverride ? 'Override required' : 'Ready'} tone={serverBlockers.length ? 'red' : needsOverride ? 'amber' : 'green'} />
          </div>
          {(serverBlockers.length > 0 || highRiskFlags.length > 0) && (
            <div className="cmo-list" style={{ marginTop: 10 }}>
              {serverBlockers.map((item) => (
                <div key={`blocker-${item.code}-${item.target_id ?? ''}`} className="cmo-list-item">
                  <strong>{item.label}</strong>
                  <div className="cmo-subtitle">{item.detail}</div>
                </div>
              ))}
              {highRiskFlags.map((item) => (
                <div key={`risk-${item.code}-${item.target_id ?? ''}`} className="cmo-list-item">
                  <strong>{item.label}</strong>
                  <div className="cmo-subtitle">{item.detail}</div>
                </div>
              ))}
            </div>
          )}
          {needsOverride && (
            <label style={{ display: 'block', marginTop: 10 }}>
              <span className="cmo-kpi-label">Override reason</span>
              <textarea
                className="cmo-textarea"
                rows={2}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Record the clinical reason for publishing this high-risk item now."
              />
            </label>
          )}
        </div>
      )}
      <div className="cmo-form-grid" style={{ marginTop: 12 }}>
        <label>
          <span className="cmo-kpi-label">今日健康摘要標題</span>
          <input className="cmo-input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </label>
        <label>
          <span className="cmo-kpi-label">建議追蹤時間</span>
          <input className="cmo-input" value={form.follow_up_date} onChange={(event) => setForm({ ...form, follow_up_date: event.target.value })} placeholder="例如：2 週內 / 下次回診前" />
        </label>
      </div>
      <div className="cmo-card cmo-section" style={{ background: '#f6f9fa', margin: '12px 0' }}>
        <div className="cmo-title-row">
          <div>
            <h3 className="cmo-section-title">C7 需要注意</h3>
            <div className="cmo-subtitle">病人端首頁只顯示這五格；每格最多 20 字。</div>
          </div>
          <ToneBadge label={Object.values(form.attention_cells).some(Boolean) ? '已填寫' : '空白'} tone={Object.values(form.attention_cells).some(Boolean) ? 'green' : 'amber'} />
        </div>
        <C7ProblemReviewPanel
          workspace={workspace}
          busy={busy}
          form={problemForm}
          setForm={setProblemForm}
          creatorOpen={problemCreatorOpen}
          pendingLink={pendingProblemLink}
          sourceConditions={sourceConditions}
          onSubmit={onSubmitProblem}
          onCreateProblem={onCreateProblem}
          onCloseCreator={onCloseProblemCreator}
          onClearPendingLink={onClearProblemLink}
          onProblemAction={onProblemAction}
          onDeleteProblem={onDeleteProblem}
          onUseProblem={(problem) => {
            const label = (problem.plain_language_title || problem.title).slice(0, 20)
            setForm({ ...form, attention_cells: { ...form.attention_cells, condition: label } })
          }}
        />
        <div className="cmo-form-grid" style={{ marginTop: 12 }}>
          {attentionCellFields.map((field) => {
            const value = form.attention_cells[field.key] || ''
            const presets = attentionPresetOptions(field.key, workspace.cmo_output.problems)
            return (
              <label key={field.key}>
                <span className="cmo-kpi-label">{field.label} · {value.length}/20</span>
                <input
                  className="cmo-input"
                  maxLength={20}
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(event) => setForm({ ...form, attention_cells: { ...form.attention_cells, [field.key]: event.target.value.slice(0, 20) } })}
                />
                <QuickPick
                  options={presets}
                  value={value}
                  onPick={(next) => setForm({ ...form, attention_cells: { ...form.attention_cells, [field.key]: next.slice(0, 20) } })}
                  ariaLabel={`${field.label}常用選項`}
                />
              </label>
            )
          })}
        </div>
      </div>
      <label>
        <span className="cmo-kpi-label">健康摘要</span>
        <textarea className="cmo-textarea" value={form.health_summary} onChange={(event) => setForm({ ...form, health_summary: event.target.value })} />
        <QuickPick mode="append" separator="" options={SUMMARY_HEALTH_TEMPLATES} value={form.health_summary} onPick={(next) => setForm({ ...form, health_summary: next })} ariaLabel="健康摘要範本" />
      </label>
      <label>
        <span className="cmo-kpi-label">CMO 給使用者的說明</span>
        <textarea className="cmo-textarea" value={form.recommendation} onChange={(event) => setForm({ ...form, recommendation: event.target.value })} />
        <QuickPick mode="append" separator="" options={SUMMARY_ADVICE_TEMPLATES} value={form.recommendation} onPick={(next) => setForm({ ...form, recommendation: next })} ariaLabel="給使用者說明範本" />
      </label>
      <label>
        <span className="cmo-kpi-label">下一步建議</span>
        <textarea className="cmo-textarea" value={form.next_step} onChange={(event) => setForm({ ...form, next_step: event.target.value })} />
        <QuickPick mode="append" separator="" options={SUMMARY_NEXTSTEP_TEMPLATES} value={form.next_step} onPick={(next) => setForm({ ...form, next_step: next })} ariaLabel="下一步建議範本" />
      </label>

      <div className="cmo-card cmo-section" style={{ background: '#f6f9fa', margin: '12px 0' }}>
        <h3 className="cmo-section-title">來源提示</h3>
        {sourceRefs.length === 0 ? (
          <>
            <EmptyText text="尚無可引用來源；發布前請填寫無來源原因。" />
            <label style={{ display: 'block', marginTop: 10 }}>
              <span className="cmo-kpi-label">無來源原因</span>
              <input
                className="cmo-input"
                value={form.no_source_reason}
                onChange={(event) => setForm({ ...form, no_source_reason: event.target.value })}
                placeholder="例如：本次只發布 CMO 整理提醒，無新增來源列"
              />
            </label>
          </>
        ) : sourceRefs.map((ref) => (
          <div key={ref.id} className="cmo-subtitle">{ref.label} · {ref.status}</div>
        ))}
      </div>

      <div className="cmo-section" style={{ background: '#f6f9fa', border: '1px solid #e3e9ee', borderRadius: 8, margin: '12px 0', padding: 12 }}>
        <div className="cmo-title-row">
          <div>
            <h3 className="cmo-section-title">發布安全檢查</h3>
            <div className="cmo-subtitle">儲存草稿只留在 CMO 端；標記待發布與正式發布必須通過以下檢查。</div>
          </div>
          <ToneBadge label={canPublish ? '可發布' : '需修正'} tone={canPublish ? 'green' : 'amber'} />
        </div>
        <div className="cmo-list" style={{ marginTop: 10 }}>
          {SUMMARY_PUBLISH_CHECKS.map((item) => (
            <div key={item.key} className="cmo-list-item" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
              <ToneBadge label={checks[item.key] ? 'OK' : 'Fix'} tone={checks[item.key] ? 'green' : 'amber'} />
              <div>
                <strong>{item.label}</strong>
                <div className="cmo-subtitle" style={{ margin: 0 }}>{item.help}</div>
              </div>
            </div>
          ))}
        </div>
        {!canPublish && <div className="cmo-subtitle" style={{ marginTop: 8, color: '#92400e' }}>目前阻擋：{blockers[0]}</div>}
      </div>

      <div className="cmo-chipbar">
        <button className="cmo-button" disabled={busy === 'summary'} onClick={onSave}>儲存草稿</button>
        <button className="cmo-button" disabled={busy === 'ready-summary' || !canPublish} title={!canPublish ? blockers[0] : undefined} onClick={onReady}>標記待發布</button>
        <button className="cmo-button" onClick={() => setShowPreview(!showPreview)}>{showPreview ? '返回修改' : '預覽使用者端'}</button>
        <button className="cmo-button primary" disabled={busy === 'publish-summary' || !canPublish} title={!canPublish ? blockers[0] : undefined} onClick={onPublish}>發布給使用者</button>
      </div>
      {(!form.recommendation.trim() || !form.next_step.trim()) && <div className="cmo-subtitle" style={{ marginTop: 8 }}>發布需要「使用者說明」與「下一步建議」。</div>}

      {showPreview && <PublishPreview workspace={workspace} form={form} sourceRefs={sourceRefs} />}
    </div>
  )
}

function PublishPreview({ workspace, form, sourceRefs }: { workspace: WorkspaceResponse; form: SummaryForm; sourceRefs: SummarySourceRef[] }) {
  const checks = summaryPublishChecks(form, sourceRefs)
  const hasBlockedInternalText = !checks.no_internal_note
  const visibleProblems = workspace.cmo_output.problems.filter((problem) => problem.is_published).slice(0, 4)
  const visibleMeds = workspace.cmo_output.medications.filter((medication) => medication.is_published).slice(0, 4)
  return (
    <section className="cmo-card cmo-section cmo-publish-preview">
      <div className="cmo-kpi-label">發布預覽</div>
      <div className="cmo-subtitle" style={{ marginBottom: 8 }}>此預覽只包含已發布給使用者的 problem 與用藥；草稿、待發布項目與 CMO 內部備註不會出現在病人端。</div>
      {hasBlockedInternalText && (
        <div className="cmo-list-item" style={{ background: '#fdf1e0', border: '1px solid #fed7aa', color: '#92400e', marginBottom: 12 }}>
          此草稿含 internal note / CMO-only / handoff 字樣，已阻擋發布；下方病人端文案先隱藏，請移除內部備註後再預覽。
        </div>
      )}
      <h3>{hasBlockedInternalText ? '預覽已阻擋' : (form.title || '今日健康摘要')}</h3>
      {!hasBlockedInternalText && (
        <div className="cmo-map-grid" style={{ margin: '10px 0 12px' }}>
          {attentionCellFields.map((field) => (
            <div key={field.key} className="cmo-list-item" style={{ minHeight: 58 }}>
              <div className="cmo-kpi-label">{field.label}</div>
              <strong>{form.attention_cells[field.key] || '—'}</strong>
            </div>
          ))}
        </div>
      )}
      <p>{hasBlockedInternalText ? '草稿含 CMO 內部內容，不能作為病人端摘要顯示。' : cleanText(form.health_summary, '尚未填寫健康摘要')}</p>
      <div className="cmo-user-preview-grid">
        <div>
          <h4>主要健康問題</h4>
          {visibleProblems.length === 0 ? <EmptyText text="目前沒有已發布的問題卡片。" /> : visibleProblems.map((problem) => (
            <div key={problem.problem_id} className="cmo-list-item">
              <strong>{problem.plain_language_title || problem.title}</strong>
              <div className="cmo-subtitle">{problem.status} · {severityLabels[problem.severity]}</div>
              <p>{cleanText(problem.user_visible_explanation, 'CMO 已確認，詳細說明待補。')}</p>
            </div>
          ))}
        </div>
        <div>
          <h4>用藥整理</h4>
          {visibleMeds.length === 0 ? <EmptyText text="目前沒有發布給使用者的用藥摘要。" /> : visibleMeds.map((medication) => (
            <div key={medication.id} className="cmo-list-item">
              <strong>{medication.medication_name}</strong>
              <div className="cmo-subtitle">{cleanText(medication.frequency)} · {cleanText(medication.possible_indication)}</div>
            </div>
          ))}
        </div>
      </div>
      <h4>CMO 給你的說明</h4>
      <p>{hasBlockedInternalText ? '已隱藏：內容含 CMO 內部備註或交班字樣。' : cleanText(form.recommendation, '尚未填寫')}</p>
      <h4>下一步</h4>
      <p>{hasBlockedInternalText ? '請先移除內部備註，再確認下一步是否可給使用者閱讀。' : cleanText(form.next_step, '尚未填寫')}</p>
      <div className="cmo-card cmo-section" style={{ background: '#fff', marginTop: 12 }}>
        <h4>資料來源與提醒</h4>
        {sourceRefs.length === 0
          ? <div className="cmo-subtitle">無來源原因：{form.no_source_reason || '尚未填寫'}</div>
          : sourceRefs.map((ref) => <div key={ref.label} className="cmo-subtitle">{ref.label} · {ref.status}</div>)}
        <p className="cmo-subtitle" style={{ marginTop: 8 }}>以上為 CMO 根據 NHI 與已確認資料整理出的提醒，不等同診斷；實際診療請依醫師面診與醫療院所紀錄為準。</p>
      </div>
    </section>
  )
}

function SourceBlock({ title, count, children, defaultOpen = false, resetKey = title }: { title: string; count: number; children: ReactNode; defaultOpen?: boolean; resetKey?: string }) {
  return (
    <details key={resetKey} className="cmo-source-block" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <span>{count}</span>
      </summary>
      <div className="cmo-list">{children}</div>
    </details>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="cmo-card cmo-section" style={{ minHeight: 74 }}>
      <div className="cmo-kpi-label">{label}</div>
      <div className="cmo-kpi-value" style={{ fontSize: 24 }}>{value}</div>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`cmo-chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{children}</button>
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 8, margin: '7px 0', fontSize: 13 }}>
      <div className="cmo-kpi-label">{label}</div>
      <div style={{ color: '#0e161d', wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}

function EmptyText({ text }: { text: string }) {
  return <div className="cmo-list-item" style={{ color: '#6b7c8c', background: '#f6f9fa' }}>{text}</div>
}

function ToneBadge({ label, tone }: { label: string; tone: string }) {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    red: { bg: '#faecea', fg: '#a03a30', border: '#f2d3cf' },
    amber: { bg: '#fdf6e3', fg: '#a97614', border: '#efdfae' },
    blue: { bg: '#e7f3f5', fg: '#33596a', border: '#cfe3e8' },
    green: { bg: '#e7f4ec', fg: '#2e8b57', border: '#cfe8da' },
    purple: { bg: '#f0ecfa', fg: '#6d28d9', border: '#e2daf3' },
    slate: { bg: '#f6f9fa', fg: '#56687a', border: '#e3e9ee' },
  }
  const color = colors[tone] ?? colors.slate
  return <span className="cmo-badge" style={{ background: color.bg, color: color.fg, border: `1px solid ${color.border}` }}>{label}</span>
}

function formFromSummary(summary: UserFacingSummary | null, workspace: WorkspaceResponse): SummaryForm {
  if (summary) {
    return {
      series_id: summary.series_id,
      title: summary.title || '今日健康摘要',
      health_summary: summary.health_summary || '',
      recommendation: summary.recommendation || '',
      next_step: summary.next_step || '',
      attention_cells: { ...emptyAttentionCells, ...(summary.attention_cells || {}) },
      follow_up_date: summary.follow_up_date || '',
      no_source_reason: typeof summary.quality_checks?.no_source_reason === 'string' ? summary.quality_checks.no_source_reason : '',
    }
  }
  const risk = workspace.source_review.risk_signals[0]
  const problem = workspace.cmo_output.problems[0]
  return {
    title: '今日健康摘要',
    health_summary: problem
      ? `目前最需要留意的是「${problem.plain_language_title || problem.title}」。`
      : risk
        ? `NHI 資料中有「${risk.label}」等需要 CMO 進一步整理的線索。`
        : '',
    recommendation: '',
    next_step: '',
    attention_cells: {
      ...emptyAttentionCells,
      condition: problem?.plain_language_title || problem?.title || risk?.label || '',
      check: risk?.source || '',
      followup: '',
      value: '',
      advice: '',
    },
    follow_up_date: '',
    no_source_reason: '',
  }
}

function summaryPayload(form: SummaryForm, sourceRefs: SummarySourceRef[], readyToPublish: boolean, memberName: string, overrideReason = '') {
  const checks = summaryPublishChecks(form, sourceRefs)
  return {
    series_id: form.series_id,
    member_name: memberName,
    title: form.title.trim() || '今日健康摘要',
    health_summary: form.health_summary.trim(),
    recommendation: form.recommendation.trim(),
    next_step: form.next_step.trim(),
    attention_cells: Object.fromEntries(
      attentionCellFields.map((field) => [field.key, form.attention_cells[field.key].trim().slice(0, 20)])
    ),
    follow_up_date: form.follow_up_date.trim() || null,
    no_source_reason: form.no_source_reason.trim(),
    source_refs: sourceRefs.map((ref) => ({
      source: ref.label,
      target_type: ref.type,
      target_id: ref.id,
      status: ref.status,
    })),
    quality_checks: {
      ...checks,
      has_missing_data_state: checks.has_follow_up_or_missing_data,
      no_source_reason: form.no_source_reason.trim(),
      override_reason_present: Boolean(overrideReason.trim()),
    },
    override_reason: overrideReason.trim() || undefined,
    ready_to_publish: readyToPublish,
  }
}
