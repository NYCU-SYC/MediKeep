// Shared pure helpers for the CMO patient workspace (Phase 2 extraction from
// page.tsx). Types are imported type-only from page.tsx, so there is no runtime
// import cycle (type imports are erased at compile time).
import type {
  RecommendationForm, CmoRecommendation, PriorityReviewItem, RecommendationSourceRef, PublishMode, HealthRecord,
  Problem, PatientData, Medication, ConceptMetric, HealthDocument, CriticalSummary, UnlinkedItems,
} from './page'

export const DEFAULT_RECOMMENDATION_TITLE = 'CMO 最新健康建議'
export const INTERNAL_NOTE_MARKERS = ['internal note', 'cmo-only', 'cmo only', 'handoff', 'do not publish', '不要發布', '不要給病人', '內部備註', '交班']
export type DraftPriorityHint = 'tier1' | 'tier2' | 'tier3'

export interface DraftPayloadLike {
  extracted_fields?: Record<string, unknown>
  confidence?: number | { overall?: number; per_field?: Record<string, number> }
  icd10_candidates?: string[]
  raw_text?: string
  [key: string]: unknown
}

export interface PendingDraftLike {
  id: number
  draft_type: string
  payload: DraftPayloadLike | null
  created_at?: string | null
  priority_hint?: DraftPriorityHint | null
  duplicate_of?: number | null
}

const DRAFT_TYPE_LABELS: Record<string, string> = {
  condition: '診斷',
  problem: '診斷',
  medication: '用藥',
  medication_event: '用藥',
  procedure: '手術／處置',
  imaging: '影像',
  lab_report: '檢驗',
  vaccine: '疫苗',
  vaccination: '疫苗',
  allergy: '過敏',
}

const DRAFT_HIDDEN_KEYS = new Set(['extracted_fields', 'field_confidence', 'confidence', 'icd10_candidates', 'nhi_kinds', 'model_meta'])

export function draftText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(draftText).filter(Boolean).join('、')
  return JSON.stringify(value)
}

export function draftFieldsToObj(payload: DraftPayloadLike | null | undefined): Record<string, string> {
  const obj: Record<string, string> = {}
  Object.entries(payload?.extracted_fields ?? {}).forEach(([key, value]) => {
    const text = draftText(value)
    if (text) obj[key] = text
  })
  Object.entries(payload ?? {}).forEach(([key, value]) => {
    if (DRAFT_HIDDEN_KEYS.has(key) || obj[key]) return
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
      const text = draftText(value)
      if (text) obj[key] = text
    }
  })
  return obj
}

export function pickDraftField(fields: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = fields[key]?.trim()
    if (value) return value
  }
  return ''
}

export function draftOverallConfidence(payload: DraftPayloadLike | null | undefined): number {
  const confidence = payload?.confidence
  const raw = typeof confidence === 'number' ? confidence : confidence?.overall
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 0
  return raw <= 1 ? raw : raw / 100
}

export function draftConfidenceLabel(score: number): { text: string; color: string } {
  if (score === 0) return { text: '信心未標', color: '#94a3b8' }
  const pct = Math.round(score * 100)
  if (pct >= 85) return { text: `${pct}%`, color: '#047857' }
  if (pct >= 65) return { text: `${pct}%`, color: '#a16207' }
  return { text: `${pct}%`, color: '#be123c' }
}

export function draftPriorityHint(draft: PendingDraftLike): DraftPriorityHint {
  return draft.priority_hint || 'tier3'
}

export function draftDisplay(draft: PendingDraftLike, fields: Record<string, string> = draftFieldsToObj(draft.payload)) {
  const rawText = draftText(draft.payload?.raw_text)
  const title =
    pickDraftField(fields, ['diagnosis', 'diagnosis_text', 'condition', 'display_name', 'drug_name', 'medication', 'medication_name', 'name', 'item', 'lab_item', 'test_name', 'procedure', 'vaccine', 'imaging_summary', 'impression_text', 'substance', 'analyte_name', 'raw_description']) ||
    draft.payload?.icd10_candidates?.[0] ||
    rawText.slice(0, 90) ||
    DRAFT_TYPE_LABELS[draft.draft_type] ||
    draft.draft_type
  return {
    date: pickDraftField(fields, ['visit_date', 'date', 'recorded_at', 'service_date', 'doc_date']) || formatDate(draft.created_at ?? undefined),
    facility: pickDraftField(fields, ['facility', 'hospital', 'institution', 'clinic', 'provider', 'organization', 'source']) || `Draft #${draft.id}`,
    title,
    summary: pickDraftField(fields, ['imaging_summary', 'impression_text', 'result', 'value', 'note', 'raw_description', 'key_medications']) || rawText.slice(0, 140),
    icd: pickDraftField(fields, ['icd10', 'icd10_code', 'icd_code', 'diagnosis_code']) || (draft.payload?.icd10_candidates ?? []).join('、'),
    typeLabel: DRAFT_TYPE_LABELS[draft.draft_type] || draft.draft_type,
  }
}

export function draftSummaryText(draft: PendingDraftLike) {
  const fields = draftFieldsToObj(draft.payload)
  const display = draftDisplay(draft, fields)
  return [
    display.title,
    display.icd ? `ICD ${display.icd}` : '',
    display.facility,
    display.date,
    display.summary,
  ].filter(Boolean).join(' · ')
}

export function defaultRecommendationForm(): RecommendationForm {
  return {
    series_id: '',
    title: DEFAULT_RECOMMENDATION_TITLE,
    health_summary: '',
    recommendation: '',
    next_step: '',
    summary_condition: '',
    summary_exam: '',
    summary_followup: '',
    summary_values: '',
    summary_advice: '',
    follow_up_date: '',
    source_refs: [],
  }
}

export function recommendationFormFromRow(row: CmoRecommendation | null): RecommendationForm {
  if (!row) return defaultRecommendationForm()
  return {
    series_id: row.series_id,
    title: row.title || DEFAULT_RECOMMENDATION_TITLE,
    health_summary: row.health_summary || '',
    recommendation: row.recommendation || '',
    next_step: row.next_step || '',
    summary_condition: row.summary_condition || row.attention_summary?.condition || '',
    summary_exam: row.summary_exam || row.attention_summary?.exam || '',
    summary_followup: row.summary_followup || row.attention_summary?.followup || '',
    summary_values: row.summary_values || row.attention_summary?.values || '',
    summary_advice: row.summary_advice || row.attention_summary?.advice || '',
    follow_up_date: row.follow_up_date || '',
    source_refs: row.source_refs || [],
  }
}

export function simplifyMedicalLanguage(text: string) {
  return text
    .replace(/\b[A-Z]\d{2}(?:\.\d+)?\b/g, '')
    .replace(/Hypertension/gi, '高血壓')
    .replace(/Type 2 diabetes mellitus/gi, '第二型糖尿病')
    .replace(/Hyperlipidemia/gi, '高血脂')
    .replace(/Chronic kidney disease|CKD/gi, '慢性腎臟病')
    .replace(/Suspected atrial fibrillation/gi, '疑似心房顫動')
    .replace(/\beGFR\b/g, '腎功能指標 eGFR')
    .replace(/\bHbA1c\b/g, '糖化血色素 HbA1c')
    .replace(/\bLDL\b/g, '低密度膽固醇 LDL')
    .replace(/\babnormal findings?\b/gi, '需要留意的結果')
    .replace(/\bconfirmed\b/gi, '已確認')
    .replace(/\bunconfirmed\b/gi, '尚未確認')
    .replace(/\s+/g, ' ')
    .trim()
}

export function recommendationSourceFromItem(item: PriorityReviewItem): RecommendationSourceRef {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    source: item.source,
    status: item.status,
  }
}

export function recommendationChecks(form: RecommendationForm) {
  const text = [form.title, form.health_summary, form.recommendation, form.next_step].join('\n')
  const lower = text.toLowerCase()
  const noInternalNote = !INTERNAL_NOTE_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))
  const noUnconfirmedSources = form.source_refs.every((ref) => {
    const source = ref.source.toLowerCase()
    const status = ref.status.toLowerCase()
    const isSystem = source.includes('system') || source.includes('extracted')
    const isConfirmed = ['confirmed', 'published', 'accepted', 'reviewed', 'imported'].some((token) => status.includes(token))
    return !isSystem || isConfirmed
  })
  return {
    plain_language: !/\b[A-Z]\d{2}(?:\.\d+)?\b/.test(text),
    has_next_step: Boolean(form.next_step.trim()),
    has_follow_up_or_missing_data: Boolean(form.follow_up_date.trim() || /補資料|補充|上傳|回覆/.test(form.next_step)),
    no_internal_note: noInternalNote,
    no_unconfirmed_sources: noUnconfirmedSources,
    medical_safety_copy: !/保證|一定會|診斷為|絕對/.test(text),
  }
}

export function allRecommendationChecksPass(checks: Record<string, boolean>) {
  return Object.values(checks).every(Boolean)
}

export const PUBLISH_MODE_COPY: Record<PublishMode, { label: string; help: string; submit: string }> = {
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

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '未記錄'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export const RECORD_LABELS: Record<string, string> = { blood_pressure: '血壓', heart_rate: '心率', glucose: '血糖', weight: '體重', steps: '步數', sleep: '睡眠', bmi: 'BMI', body_fat: '體脂', temperature: '體溫', spo2: '血氧', hba1c: 'HbA1c' }
export const DOC_LABELS: Record<string, string> = { lab_report: '檢驗報告', prescription: '處方', discharge: '出院摘要', image: '影像', other: '其他' }

export function formatRecordValue(record: HealthRecord) {
  if (record.record_type === 'blood_pressure' && record.value1 && record.value2) return `${record.value1}/${record.value2} ${record.unit ?? 'mmHg'}`
  return `${record.value1 ?? '-'}${record.unit ? ` ${record.unit}` : ''}`
}

export function bloodPressureNumbers(record: HealthRecord): { systolic: number; diastolic: number } | null {
  if (record.record_type !== 'blood_pressure') return null
  const systolic = Number(record.value1)
  const diastolic = Number(record.value2)
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return null
  return { systolic, diastolic }
}

export function isImplausibleBloodPressure(record: HealthRecord) {
  const bp = bloodPressureNumbers(record)
  if (!bp) return false
  return bp.systolic < 50 || bp.systolic > 260 || bp.diastolic < 30 || bp.diastolic > 160 || bp.diastolic > bp.systolic
}

export function isElevatedBloodPressure(record: HealthRecord) {
  const bp = bloodPressureNumbers(record)
  if (!bp || isImplausibleBloodPressure(record)) return false
  return bp.systolic >= 140 || bp.diastolic >= 90
}

// Highlight-to-Summary direct-create provenance marker. When a structured row
// (Problem / Condition / Medication) is created straight from a text selection,
// its note/cmo_note is prefixed with this marker so the source stays attached and
// can be rendered as a "選取建立" source badge. Format: 【選取來源】<source>｜摘錄：<excerpt>
export const SELECTION_SOURCE_MARKER = '【選取來源】'

export function parseSelectionSource(note: string | null | undefined): string | null {
  if (!note) return null
  const idx = note.indexOf(SELECTION_SOURCE_MARKER)
  if (idx === -1) return null
  const after = note.slice(idx + SELECTION_SOURCE_MARKER.length)
  const src = after.split('｜')[0]?.trim()
  return src || '選取建立'
}

export function formatFileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Problem / document presentation helpers (Phase 2 extraction from page.tsx) ──

export function sourceDocumentLabel(doc: HealthDocument) {
  return `${formatDate(doc.doc_date ?? doc.created_at)} · ${DOC_LABELS[doc.doc_type] ?? doc.doc_type} · ${doc.file_name}`
}

export function documentProcessingTone(status: string | null | undefined) {
  if (status === 'confirmed') return { bg: '#ecfdf5', fg: '#047857', label: 'Confirmed' }
  if (status === 'needs_review') return { bg: '#fff7ed', fg: '#c2410c', label: 'Needs review' }
  if (status === 'failed' || status === 'rejected') return { bg: '#fff1f2', fg: '#be123c', label: status === 'failed' ? 'Failed' : 'Rejected' }
  if (status === 'extracting' || status === 'queued') return { bg: '#eff6ff', fg: '#1d4ed8', label: status === 'extracting' ? 'Extracting' : 'Queued' }
  return { bg: '#f8fafc', fg: '#475569', label: 'Uploaded' }
}

export function visibilityTone(doc: HealthDocument) {
  if (doc.patient_visible === false || doc.hidden_from_patient) return { bg: '#fff7ed', fg: '#c2410c', label: 'Hidden from patient' }
  return { bg: '#ecfdf5', fg: '#047857', label: 'Patient visible' }
}

export function tierStyle(tier: number) {
  if (tier <= 1) return { bg: '#fff1f2', fg: '#be123c', label: 'T1' }
  if (tier === 2) return { bg: '#fef3c7', fg: '#a16207', label: 'T2' }
  return { bg: '#ecfdf5', fg: '#047857', label: `T${tier}` }
}

export function statusLabel(status: string) {
  if (status === 'resolved') return '已解決'
  if (status === 'following') return '追蹤中'
  if (status === 'underlying') return '慢性/長期'
  return '目前問題'
}

export function conceptMetrics(problem: Problem, data: PatientData, meds: Medication[]): ConceptMetric {
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

export function problemReadiness(problem: Problem) {
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

export function readinessChecklist(data: PatientData, critical: CriticalSummary | null, unlinked: UnlinkedItems) {
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
