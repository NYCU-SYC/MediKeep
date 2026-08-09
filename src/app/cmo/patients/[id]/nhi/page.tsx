'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import PatientContentEntryLauncher, { sendToPatientContentPanel } from '../_components/PatientContentEntryDrawer'
import type { RedZoneDraftPatch } from '../_components/PatientContentEntryDrawer'
import { RowActionsMenu, type RowActionGroup } from '../_components/RowActionsMenu'

type SectionKey =
  | 'outpatient' | 'inpatient' | 'med' | 'surgery'
  | 'imaging' | 'lab' | 'vaccine' | 'covid'
  | 'tcm' | 'dental' | 'advance_directive'
type DraftStatus = 'pending' | 'accepted' | 'rejected'
type TriageStatus = 'pending' | 'linked' | 'dismissed' | 'rejected'
type SourceTriageAction = 'link_to_problem' | 'dismiss' | 'reject' | 'request_missing_data'

interface DraftPayload {
  extracted_fields?: Record<string, unknown>
  confidence?: number | { overall?: number }
  nhi_section?: SectionKey
  parser?: string
  model_meta?: {
    run_id?: string
    ocr_engine?: string
    llm_model?: string
    timestamp?: string
  }
  detail?: {
    medications?: Array<{ code: string; name: string; qty: string }>
    orders?: Array<{ code: string; name: string; qty: string }>
    lab_results?: Array<{ item: string; value: string; unit: string; ref: string }>
    imaging_reports?: string[]
  }
  icd10_candidates?: string[]
  [key: string]: unknown
}

interface Draft {
  id: number
  draft_type: string
  member_name?: string | null
  payload: DraftPayload | null
  status: DraftStatus
  triage_status?: TriageStatus | null
  priority_hint?: 'tier1' | 'tier2' | 'tier3' | null
  created_at?: string | null
}

interface ProblemOption {
  problem_id: number
  title: string
  plain_language_title?: string
  member_name?: string | null
  status?: string
  diagnosis_status?: string
  icd10_code?: string | null
}

const SECTIONS: Array<{ key: SectionKey; label: string; subtitle: string; icon: string }> = [
  { key: 'outpatient', label: '門診資料',     subtitle: '一般門診就醫', icon: '🩺' },
  { key: 'inpatient',  label: '住診資料',     subtitle: '住院紀錄', icon: '🏥' },
  { key: 'med',        label: '用藥資料',     subtitle: '處方與調劑', icon: '💊' },
  { key: 'surgery',    label: '手術資料',     subtitle: '手術與處置', icon: '🔪' },
  { key: 'imaging',    label: '影像/病理',    subtitle: 'CT/X-ray/EKG/報告', icon: '🩻' },
  { key: 'lab',        label: '檢驗檢查',     subtitle: '抽血/尿液檢驗', icon: '🧪' },
  { key: 'vaccine',    label: '預防接種',     subtitle: '疫苗接種紀錄', icon: '💉' },
  { key: 'covid',      label: 'COVID-19',     subtitle: '疫苗與檢測', icon: '🦠' },
  { key: 'tcm',        label: '中醫門診',     subtitle: '中醫就醫', icon: '🌿' },
  { key: 'dental',     label: '牙醫門診',     subtitle: '牙科就醫', icon: '🦷' },
  { key: 'advance_directive', label: '器捐／安寧意願', subtitle: '器官捐贈與安寧意願', icon: '📜' },
]

const STATUS_META: Record<DraftStatus, { label: string; color: string; bg: string }> = {
  pending:  { label: '待審',  color: '#a97614', bg: '#fdf6e3' },
  accepted: { label: '已核',  color: '#2e8b57', bg: '#e7f4ec' },
  rejected: { label: '已退',  color: '#a03a30', bg: '#faecea' },
}

const TRIAGE_META: Record<TriageStatus, { label: string; color: string; bg: string }> = {
  pending: { label: '待整理', color: '#a97614', bg: '#fdf6e3' },
  linked: { label: '已入 Problem', color: '#2e8b57', bg: '#e7f4ec' },
  dismissed: { label: '免關聯', color: '#56687a', bg: '#f6f9fa' },
  rejected: { label: '已退回', color: '#a03a30', bg: '#faecea' },
}

/**
 * One status chip instead of two stacked ones. Triage state is what the CMO
 * acts on, so it wins; the legacy accept/reject state only shows when it adds
 * information the triage state doesn't already carry.
 */
function rowStatusMeta(status: DraftStatus, triage: TriageStatus) {
  if (triage !== 'pending') return TRIAGE_META[triage]
  if (status === 'accepted') return { label: '已核 · 待整理', color: '#a97614', bg: '#fdf6e3' }
  if (status === 'rejected') return STATUS_META.rejected
  return { label: '待整理', color: '#a97614', bg: '#fdf6e3' }
}

function normalizeIcd(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase()
}

/**
 * Find an existing Problem whose ICD-10 matches this source row, so the CMO can
 * link with one click instead of opening the dropdown. Falls back to a
 * category match (first 3 chars, e.g. E11.9 ↔ E11.65) which is how ICD-10
 * groups the same disease.
 */
function suggestedProblemForDraft(icd: string, problems: ProblemOption[]): { problem: ProblemOption; exact: boolean } | null {
  const code = normalizeIcd(icd)
  if (!code) return null
  const exact = problems.find((problem) => normalizeIcd(problem.icd10_code) === code)
  if (exact) return { problem: exact, exact: true }
  const category = code.split('.')[0]
  if (category.length < 3) return null
  const loose = problems.find((problem) => normalizeIcd(problem.icd10_code).split('.')[0] === category)
  return loose ? { problem: loose, exact: false } : null
}

function problemLabel(problem: ProblemOption) {
  return problem.plain_language_title || problem.title
}

async function fetchJson<T>(url: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, { credentials: 'include', ...init })
    if (!res.ok) return fallback
    return await res.json() as T
  } catch { return fallback }
}

function idempotencyKey(scope: string): string {
  return `${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(toText).join('、')
  return JSON.stringify(v)
}

function firstText(fields: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = toText(fields[key])
    if (text) return text
  }
  return ''
}

function formatDate(s: string | undefined): string {
  if (!s) return '—'
  return s.replace(/T.*$/, '')
}

function isNhiDraft(d: Draft): boolean {
  const payload = d.payload ?? {}
  const fields = payload.extracted_fields ?? {}
  const runId = String(payload.model_meta?.run_id ?? '')
  const knownNhiSection = typeof payload.nhi_section === 'string'
  const importedByNhiParser = payload.parser === 'nhi_html_v2' || payload.parser === 'nhi_html_v1'
  const contractDemoDraft = runId.startsWith('contract-v2-demo-')
  const hasNhiLikeFields = [
    'visit_date', 'facility', 'diagnosis', 'icd10', 'key_medications',
    'lab_total_items', 'vaccine', 'imaging_summary', 'raw_code',
    'raw_description', 'source_doc_page', 'source_doc_bbox',
  ].some((key) => fields[key] !== undefined)
  const reviewableType = [
    'condition', 'problem', 'medication', 'medication_event',
    'allergy', 'lab_report', 'imaging', 'procedure', 'vaccine',
  ].includes(d.draft_type)
  return importedByNhiParser || knownNhiSection || contractDemoDraft || (reviewableType && hasNhiLikeFields)
}

function memberLabel(d: Draft): string {
  return d.member_name || '本人'
}

function sectionOf(d: Draft): SectionKey | null {
  const explicit = d.payload?.nhi_section as SectionKey | undefined
  if (explicit && SECTIONS.some((s) => s.key === explicit)) return explicit
  if (d.draft_type === 'medication' || d.draft_type === 'medication_event') return 'med'
  if (d.draft_type === 'lab_report') return 'lab'
  if (d.draft_type === 'imaging') return 'imaging'
  if (d.draft_type === 'vaccine') return 'vaccine'
  if (d.draft_type === 'procedure') return 'surgery'
  if (d.draft_type === 'condition' || d.draft_type === 'problem' || d.draft_type === 'allergy') return 'outpatient'
  return null
}

function targetForNhiField(key: string) {
  const lower = key.toLowerCase()
  if (lower.includes('icd')) return 'problem.icd10_code' as const
  if (lower.includes('diagnosis')) return 'condition.display_name' as const
  if (lower.includes('medication') || lower.includes('drug')) return 'medication.drug_name' as const
  if (lower.includes('date')) return 'reminder.scheduled_date' as const
  if (lower.includes('facility')) return 'record.note' as const
  return 'problem.display_layman' as const
}

function recordTypeForLab(item: string) {
  const text = item.toLowerCase()
  if (text.includes('hba1c') || text.includes('糖化')) return 'hba1c'
  if (text.includes('glucose') || text.includes('glu') || text.includes('血糖')) return 'glucose'
  if (text.includes('egfr')) return 'egfr'
  if (text.includes('weight') || text.includes('體重')) return 'weight'
  return 'glucose'
}

function includesAny(text: string, terms: string[]) {
  const lower = text.toLowerCase()
  return terms.some((term) => lower.includes(term.toLowerCase()))
}

function extractNumberText(value: string) {
  return value.match(/-?\d+(?:\.\d+)?/)?.[0] ?? value
}

function severityFromText(value: string) {
  const text = value.toLowerCase()
  if (includesAny(text, ['anaphylaxis', 'shock', '休克', '呼吸困難'])) return 'anaphylaxis'
  if (includesAny(text, ['severe', '嚴重', '重度'])) return 'severe'
  if (includesAny(text, ['mild', '輕微', '輕度'])) return 'mild'
  return 'moderate'
}

function mergeRedZonePatch(base: RedZoneDraftPatch | null, next: RedZoneDraftPatch | null): RedZoneDraftPatch | null {
  if (!next) return base
  if (!base) return next
  const allergy = { ...(base.allergy ?? {}), ...(next.allergy ?? {}) }
  const implant = { ...(base.implant ?? {}), ...(next.implant ?? {}) }
  const profile = { ...(base.profile ?? {}), ...(next.profile ?? {}) }
  const mri = { ...(base.mri ?? {}), ...(next.mri ?? {}) }
  return {
    section: next.section ?? base.section,
    ...(Object.keys(allergy).length > 0 ? { allergy } : {}),
    ...(Object.keys(implant).length > 0 ? { implant } : {}),
    ...(Object.keys(profile).length > 0 ? { profile } : {}),
    ...(Object.keys(mri).length > 0 ? { mri } : {}),
  }
}

function finalizeRedZonePatch(patch: RedZoneDraftPatch | null): RedZoneDraftPatch | null {
  if (!patch) return null
  const section = patch.allergy?.substance
    ? 'allergy'
    : patch.implant?.type
      ? 'implant'
      : patch.profile?.egfr_value || patch.profile?.blood_type || patch.profile?.emergency_contact_name
        ? 'profile'
        : patch.mri
          ? 'mri'
          : patch.section
  return { ...patch, section }
}

function redZonePatchForNhiField(key: string, value: unknown): RedZoneDraftPatch | null {
  const text = toText(value).trim()
  if (!text) return null
  const lowerKey = key.toLowerCase()
  const haystack = `${lowerKey} ${text.toLowerCase()}`

  if (includesAny(haystack, ['allergy', 'allergen', 'contraindication', 'substance', '過敏', '禁忌', '顯影劑', 'contrast', 'iodine', '碘'])) {
    const isReaction = includesAny(lowerKey, ['reaction', 'symptom', '反應', '症狀'])
    const isSeverity = includesAny(lowerKey, ['severity', '嚴重'])
    const isContrast = includesAny(haystack, ['contrast', 'iodine', '顯影劑', '碘'])
    return {
      section: 'allergy',
      allergy: {
        category: isContrast ? 'contrast_agent' : 'drug',
        substance: isReaction || isSeverity ? '' : text,
        reaction: isReaction ? text : '',
        severity: isSeverity ? severityFromText(text) : severityFromText(haystack),
        source: 'nhi_cmo_entry',
        note: `NHI ${key}`,
      },
    }
  }

  if (includesAny(haystack, ['egfr', 'estimated glomerular', '腎絲球'])) {
    return { section: 'profile', profile: { egfr_value: extractNumberText(text) } }
  }

  if (includesAny(haystack, ['dialysis', 'hemodialysis', 'peritoneal', '透析', '洗腎'])) {
    return { section: 'profile', profile: { is_dialysis: 'true', dialysis_schedule: text } }
  }

  if (includesAny(haystack, ['blood_type', 'blood type', 'abo', '血型'])) {
    return { section: 'profile', profile: { blood_type: text.toUpperCase().replace(/[^ABO]/g, ''), rh_factor: text.includes('-') ? '-' : text.includes('+') ? '+' : '' } }
  }

  if (includesAny(haystack, ['emergency_contact', 'contact_phone', '緊急聯絡', '聯絡人'])) {
    return { section: 'profile', profile: { emergency_contact_name: text } }
  }

  if (includesAny(haystack, ['pacemaker', '心律調節', '節律器'])) {
    return {
      section: 'implant',
      implant: { type: '心律調節器', model: text, note: `NHI ${key}` },
      mri: { has_pacemaker: 'true', pacemaker_detail: text },
    }
  }

  if (includesAny(haystack, ['implant', 'stent', 'port-a', 'porta', 'device', 'metal', 'prosthesis', '支架', '植入', '金屬', '人工關節', '人工瓣膜', '人工水晶體'])) {
    return {
      section: 'implant',
      implant: { type: text, note: `NHI ${key}` },
      mri: { has_metal_implant: 'true', metal_implant_detail: text },
    }
  }

  if (includesAny(haystack, ['mri', '磁振', '核磁', '金屬禁忌'])) {
    return { section: 'mri', mri: { has_other: 'true', other_detail: text } }
  }

  return null
}

function redZonePatchForDraft(draft: Draft): RedZoneDraftPatch | null {
  const fields = draft.payload?.extracted_fields ?? {}
  let patch: RedZoneDraftPatch | null = null
  Object.entries(fields).forEach(([key, value]) => {
    patch = mergeRedZonePatch(patch, redZonePatchForNhiField(key, value))
  })

  const raw = Object.values(fields).map(toText).join(' ')
  if (draft.draft_type === 'allergy') {
    patch = mergeRedZonePatch(patch, {
      section: 'allergy',
      allergy: {
        substance: firstText(fields, ['substance', 'allergen', 'drug_name', 'raw_description']) || raw,
        reaction: firstText(fields, ['reaction', 'reaction_description', 'symptom']),
        severity: severityFromText(firstText(fields, ['severity', 'reaction', 'raw_description']) || raw),
        category: includesAny(raw, ['contrast', '顯影劑', 'iodine', '碘']) ? 'contrast_agent' : 'drug',
        source: 'nhi_cmo_entry',
        note: `NHI allergy draft #${draft.id}`,
      },
    })
  }

  if (sectionOf(draft) === 'lab' && includesAny(raw, ['egfr', '腎絲球'])) {
    patch = mergeRedZonePatch(patch, {
      section: 'profile',
      profile: {
        egfr_value: extractNumberText(firstText(fields, ['value_numeric', 'value', 'raw_description', 'analyte_name']) || raw),
        egfr_date: firstText(fields, ['visit_date', 'result_date']).slice(0, 10),
      },
    })
  }

  if (includesAny(raw, ['pacemaker', '心律調節', '節律器', 'stent', '支架', 'port-a', '植入', '金屬'])) {
    patch = mergeRedZonePatch(patch, {
      section: 'implant',
      implant: { type: firstText(fields, ['procedure', 'raw_description', 'diagnosis', 'imaging_summary']) || raw, note: `NHI high-risk device draft #${draft.id}` },
      mri: { has_metal_implant: 'true', metal_implant_detail: raw },
    })
  }

  return finalizeRedZonePatch(patch)
}

function sendNhiDraftToRedZone(draft: Draft) {
  const redzone = redZonePatchForDraft(draft)
  if (!redzone) return
  sendToPatientContentPanel({
    source: `NHI 保命紅區 #${draft.id}`,
    open: false,
    forcePanel: 'redzone',
    patch: { redzone },
  })
}

function sendNhiFieldToPanel(key: string, value: unknown) {
  const text = toText(value)
  if (!text) return
  const redzone = redZonePatchForNhiField(key, value)
  if (redzone) {
    sendToPatientContentPanel({
      source: `NHI 保命紅區 ${key}`,
      target: targetForNhiField(key),
      text,
      textByPanel: {
        problem: text,
        condition: text,
        medication: text,
        followup: text,
        record: `NHI ${key}: ${text}`,
        redzone: text,
      },
      open: false,
      respectActivePanel: true,
      patch: { redzone: finalizeRedZonePatch(redzone) ?? redzone },
    })
    return
  }
  sendToPatientContentPanel({
    source: `NHI ${key}`,
    target: targetForNhiField(key),
    text,
    textByPanel: {
      problem: text,
      condition: text,
      medication: text,
      followup: text,
      record: `NHI ${key}: ${text}`,
      redzone: text,
    },
    open: false,
    respectActivePanel: true,
    patch: key.toLowerCase().includes('diagnosis')
      ? { problem: { display_layman: text }, condition: { display_name: text } }
      : undefined,
  })
}

function sendNhiMedicationToPanel(medication: { code: string; name: string; qty: string }) {
  sendToPatientContentPanel({
    source: 'NHI 用藥明細',
    target: 'medication.drug_name',
    text: medication.name,
    textByPanel: {
      problem: medication.name,
      condition: medication.name,
      medication: medication.name,
      followup: `用藥追蹤：${medication.name}`,
      record: `NHI drug ${medication.code}: ${medication.name} ${medication.qty}`.trim(),
      redzone: medication.name,
    },
    open: false,
    respectActivePanel: true,
    patch: {
      medication: {
        drug_name: medication.name,
        dose: medication.qty,
        note: `NHI drug code ${medication.code}`,
      },
    },
  })
}

function sendNhiLabToPanel(row: { item: string; value: string; unit: string; ref: string }) {
  const recordType = recordTypeForLab(row.item)
  const redzone = recordType === 'egfr'
    ? { section: 'profile', profile: { egfr_value: extractNumberText(row.value) } } satisfies RedZoneDraftPatch
    : null
  sendToPatientContentPanel({
    source: redzone ? 'NHI eGFR 檢驗（保命紅區）' : 'NHI 檢驗項目',
    target: 'record.note',
    text: [row.item, row.value, row.unit].filter(Boolean).join(' '),
    textByPanel: {
      problem: row.item,
      condition: row.item,
      medication: row.item,
      followup: `追蹤檢驗：${row.item}`,
      record: [row.item, row.value, row.unit, row.ref ? `ref ${row.ref}` : ''].filter(Boolean).join(' · '),
      redzone: [row.item, row.value, row.unit].filter(Boolean).join(' '),
    },
    open: false,
    respectActivePanel: true,
    patch: {
      record: {
        record_type: recordType,
        value1: row.value,
        unit: row.unit,
        note: `${row.item}${row.ref ? ` · ref ${row.ref}` : ''}`,
      },
      ...(redzone ? { redzone } : {}),
    },
  })
}

function sendNhiDraftSummaryToPanel(draft: Draft) {
  const fields = draft.payload?.extracted_fields ?? {}
  const section = sectionOf(draft)
  const redzone = redZonePatchForDraft(draft)
  const diagnosis = firstText(fields, ['diagnosis', 'diagnosis_text', 'vaccine', 'imaging_summary', 'impression_text', 'substance', 'analyte_name', 'raw_description', 'modality'])
  const icd10 = firstText(fields, ['icd10', 'icd10_candidates'])
  const visitDate = firstText(fields, ['visit_date', 'onset_date'])
  const facility = firstText(fields, ['facility', 'hospital', 'source_doc_page'])
  const keyMedications = firstText(fields, ['key_medications', 'raw_description', 'raw_code'])
  const labLabel = firstText(fields, ['diagnosis', 'analyte_name', 'lab_total_items'])
  const summaryText = diagnosis || labLabel || keyMedications || facility || `NHI draft #${draft.id}`
  const medicationText = keyMedications || diagnosis || summaryText
  const recordText = [labLabel || diagnosis, facility, visitDate, keyMedications].filter(Boolean).join(' · ') || summaryText
  const followUpText = [diagnosis || labLabel || keyMedications, visitDate, facility].filter(Boolean).join(' · ') || summaryText
  const textByPanel = {
    problem: diagnosis || summaryText,
    condition: diagnosis || summaryText,
    medication: medicationText,
    followup: followUpText,
    record: recordText,
    redzone: diagnosis || summaryText,
  }

  if (section === 'med') {
    sendToPatientContentPanel({
      source: `NHI 用藥摘要 #${draft.id}`,
      target: 'medication.drug_name',
      text: medicationText,
      textByPanel,
      open: false,
      respectActivePanel: true,
      patch: {
        medication: {
          drug_name: keyMedications || diagnosis,
          note: [facility, visitDate, icd10 ? `ICD ${icd10}` : ''].filter(Boolean).join(' · '),
        },
        ...(redzone ? { redzone } : {}),
      },
    })
    return
  }

  if (section === 'lab') {
    sendToPatientContentPanel({
      source: `NHI 檢驗摘要 #${draft.id}`,
      target: 'record.note',
      text: recordText,
      textByPanel,
      open: false,
      respectActivePanel: true,
      patch: {
        record: {
          record_type: recordTypeForLab(labLabel),
          note: [labLabel, facility, visitDate].filter(Boolean).join(' · '),
        },
        ...(redzone ? { redzone } : {}),
      },
    })
    return
  }

  sendToPatientContentPanel({
    source: `NHI 摘要 #${draft.id}`,
    target: 'problem.display_layman',
    text: summaryText,
    textByPanel,
    open: false,
    respectActivePanel: true,
    patch: {
      problem: {
        display_name: diagnosis,
        display_layman: diagnosis,
        icd10_code: icd10,
        onset_date: visitDate ? visitDate.slice(0, 10) : '',
      },
      condition: {
        display_name: diagnosis,
        icd10_code: icd10,
        onset_date: visitDate ? visitDate.slice(0, 10) : '',
        note: [facility, keyMedications].filter(Boolean).join(' · '),
      },
      ...(redzone ? { redzone } : {}),
    },
  })
}

export default function NhiSectionsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const targetDraftId = Number(searchParams.get('draft') ?? 0) || null
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [problemOptions, setProblemOptions] = useState<ProblemOption[]>([])
  const [bulkProblemId, setBulkProblemId] = useState('')
  const [patientName, setPatientName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionKey>('outpatient')
  const [statusFilter, setStatusFilter] = useState<DraftStatus | 'all'>('all')
  const [memberFilter, setMemberFilter] = useState('全部')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Undefined = untouched (an ICD match may seed it); '' = explicitly cleared.
  const [linkTargets, setLinkTargets] = useState<Record<number, string | undefined>>({})
  const [expanded, setExpanded] = useState<number | null>(null)
  const [flash, setFlash] = useState('')

  const loadAll = useCallback(async () => {
    // Fetch all statuses, then keep NHI parser drafts plus contract-demo raw review drafts.
    const [pending, accepted, rejected, patient, workspace] = await Promise.all([
      fetchJson<Draft[]>(`/api/cmo/patients/${id}/drafts?status=pending`, []),
      fetchJson<Draft[]>(`/api/cmo/patients/${id}/drafts?status=accepted`, []),
      fetchJson<Draft[]>(`/api/cmo/patients/${id}/drafts?status=rejected`, []),
      fetchJson<{ user?: { display_name: string } } | null>(`/api/cmo/patients/${id}`, null),
      fetchJson<{ cmo_output?: { problems?: ProblemOption[] } } | null>(`/api/cmo/review/patients/${id}/workspace`, null),
    ])
    const all = [...pending, ...accepted, ...rejected]
      .filter(isNhiDraft)
    setDrafts(all)
    setProblemOptions(workspace?.cmo_output?.problems ?? [])
    setPatientName(patient?.user?.display_name ?? '')
    setLoading(false)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (!targetDraftId || drafts.length === 0) return
    const target = drafts.find((draft) => draft.id === targetDraftId)
    if (!target) return
    const section = sectionOf(target)
    if (section) setActiveSection(section)
    setStatusFilter('all')
    setMemberFilter(memberLabel(target))
    setExpanded(target.id)
    if (target.status === 'pending') setSelected(new Set([target.id]))
    window.setTimeout(() => {
      document.getElementById(`nhi-draft-${target.id}`)?.scrollIntoView({ block: 'center' })
    }, 180)
  }, [drafts, targetDraftId])

  const memberOptions = useMemo(() => {
    const seen = new Set<string>()
    drafts.forEach((draft) => seen.add(memberLabel(draft)))
    return ['全部', ...Array.from(seen)]
  }, [drafts])

  const memberDrafts = useMemo(
    () => memberFilter === '全部' ? drafts : drafts.filter((draft) => memberLabel(draft) === memberFilter),
    [drafts, memberFilter]
  )

  // Per-section counts
  const sectionStats = useMemo(() => {
    const stats: Record<SectionKey, { total: number; pending: number; accepted: number; rejected: number }> = {} as Record<SectionKey, { total: number; pending: number; accepted: number; rejected: number }>
    SECTIONS.forEach((s) => { stats[s.key] = { total: 0, pending: 0, accepted: 0, rejected: 0 } })
    memberDrafts.forEach((d) => {
      const sec = sectionOf(d)
      if (sec && stats[sec]) {
        stats[sec].total += 1
        stats[sec][d.status] += 1
      }
    })
    return stats
  }, [memberDrafts])

  // Drafts in active section, filtered by status
  const visible = useMemo(() => {
    return memberDrafts
      .filter((d) => sectionOf(d) === activeSection)
      .filter((d) => statusFilter === 'all' || d.status === statusFilter)
      .sort((a, b) => {
        const da = String(a.payload?.extracted_fields?.visit_date ?? '')
        const db = String(b.payload?.extracted_fields?.visit_date ?? '')
        return db.localeCompare(da)  // newest first
      })
  }, [memberDrafts, activeSection, statusFilter])

  const pendingInSection = useMemo(
    () => visible.filter((d) => (d.triage_status ?? 'pending') === 'pending').map((d) => d.id),
    [visible]
  )

  const toggleOne = (draftId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(draftId)) next.delete(draftId); else next.add(draftId)
      return next
    })
  }

  const selectAllPending = () => setSelected(new Set(pendingInSection))
  const clearSelection = () => setSelected(new Set())

  const flashFor = (msg: string) => {
    setFlash(msg)
    window.setTimeout(() => setFlash(''), 1600)
  }

  const selectedDraftRows = useMemo(
    () => drafts.filter((draft) => selected.has(draft.id)),
    [drafts, selected]
  )

  const selectedMemberName = useMemo(() => {
    const names = Array.from(new Set(selectedDraftRows.map(memberLabel)))
    return names.length === 1 ? names[0] : ''
  }, [selectedDraftRows])

  const problemOptionsForMember = useCallback((memberName: string) => {
    return problemOptions.filter((problem) => !problem.member_name || problem.member_name === memberName || (memberName === '本人' && problem.member_name === 'self'))
  }, [problemOptions])

  const runSourceTriage = async (
    action: SourceTriageAction,
    ids: number[],
    options: { problemId?: number; memberName?: string } = {},
  ) => {
    if (ids.length === 0 || busy) return
    const memberName = options.memberName || selectedMemberName
    if (!memberName) {
      flashFor('請先只選同一位成員的來源列')
      return
    }
    if (action === 'link_to_problem' && !options.problemId) {
      flashFor('請先選擇要加入的 Problem')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/cmo/patients/${id}/source-triage/batch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey(`nhi-source-${action}`) },
        body: JSON.stringify({
          action,
          member_name: memberName,
          ...(options.problemId ? { problem_id: options.problemId } : {}),
          ...(action === 'request_missing_data' ? {
            title: '請補充 NHI 來源資料',
            reason: '醫療團隊需要補齊這筆來源，才能完成健康整理。',
          } : {}),
          ...(action === 'reject' ? { blocked_reason: 'manual_review' } : {}),
          items: ids.map((draftId) => ({ resource_type: 'nhi_draft', resource_id: draftId })),
        }),
      })
      const out = await res.json().catch(() => ({})) as { detail?: string | { message?: string }; updated?: unknown[] }
      if (!res.ok) {
        const detail = typeof out.detail === 'string' ? out.detail : out.detail?.message
        flashFor(detail || '來源整理失敗，資料沒有被更新')
        return
      }
      const count = out.updated?.length ?? ids.length
      const label: Record<SourceTriageAction, string> = {
        link_to_problem: '已加入 Problem',
        dismiss: '已標記免關聯',
        reject: '已退回來源',
        request_missing_data: '已建立補資料請求',
      }
      flashFor(`${label[action]} ${count} 筆`)
      setSelected((prev) => {
        const next = new Set(prev)
        ids.forEach((draftId) => next.delete(draftId))
        return next
      })
      await loadAll()
    } finally { setBusy(false) }
  }

  const runBulk = async (action: 'accept' | 'reject') => {
    const ids = Array.from(selected)
    if (ids.length === 0 || busy) return
    setBusy(true)
    try {
      const url = action === 'accept' ? '/api/cmo/drafts/bulk-accept' : '/api/cmo/drafts/bulk-reject'
      const res = await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey(`nhi-bulk-${action}`) },
        body: JSON.stringify({
          draft_ids: ids,
          ...(action === 'reject' ? { blocked_reason: 'manual_review' } : {}),
        }),
      })
      const out = await res.json().catch(() => ({})) as { accepted?: number; rejected?: number; blocked_high_risk?: { id: number; target_label?: string }[]; affected_views?: string[]; detail?: string }
      if (!res.ok) {
        flashFor(out.detail || '批次處理失敗，資料沒有被更新')
        return
      }
      const blocked = out.blocked_high_risk ?? []
      if (action === 'accept' && blocked.length > 0) {
        // High-risk (Tier 1) drafts can't be bulk-accepted — keep them selected
        // so the CMO confirms each one individually.
        flashFor(`已接受 ${out.accepted ?? 0} 筆；${blocked.length} 筆高風險（Tier 1）需逐筆確認`)
        setSelected(new Set(blocked.map(b => b.id)))
      } else {
        flashFor(action === 'accept' ? `已接受 ${out.accepted ?? ids.length} 筆` : `已退回 ${out.rejected ?? ids.length} 筆`)
        clearSelection()
      }
      await loadAll()
    } finally { setBusy(false) }
  }

  const runSingle = async (action: 'accept' | 'reject', draftId: number) => {
    if (busy) return
    setBusy(true)
    try {
      const url = `/api/cmo/drafts/${draftId}/${action}`
      const init: RequestInit = {
        method: 'POST',
        credentials: 'include',
        headers: { 'Idempotency-Key': idempotencyKey(`nhi-${action}-${draftId}`) },
      }
      if (action === 'reject') {
        init.headers = { ...init.headers, 'Content-Type': 'application/json' }
        init.body = JSON.stringify({ blocked_reason: 'manual_review' })
      }
      const res = await fetch(url, init)
      const out = await res.json().catch(() => ({})) as { detail?: string }
      if (!res.ok) {
        flashFor(out.detail || '處理失敗，資料沒有被更新')
        return
      }
      setSelected((prev) => { const n = new Set(prev); n.delete(draftId); return n })
      setExpanded(null)
      flashFor(action === 'accept' ? '已接受 1 筆' : '已退回 1 筆')
      await loadAll()
    } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="cmo-page"><div className="cmo-card cmo-section"><div className="cmo-kpi-label">NHI 健康存摺</div><div className="cmo-title" style={{ marginTop: 8 }}>正在載入 10 個資料區塊</div></div></div>
  }

  const currentMeta = SECTIONS.find((s) => s.key === activeSection)!
  const currentStats = sectionStats[activeSection]

  return (
    <div className="cmo-page">
      <header className="cmo-title-row">
        <div>
          <button className="cmo-button" type="button" onClick={() => router.push(`/cmo/patients/${id}`)}>← 返回病患資料</button>
          <h1 className="cmo-title" style={{ marginTop: 12 }}>NHI 健康存摺 · 10 個資料區塊</h1>
          <div className="cmo-subtitle">
            {patientName || id} · 共 {drafts.length} 筆紀錄 · 目前檢視：{memberFilter} · 來源：MHB_1150403_213
          </div>
          {memberOptions.length > 2 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {memberOptions.map((member) => (
                <button
                  key={member}
                  type="button"
                  className={`cmo-chip ${memberFilter === member ? 'active' : ''}`}
                  onClick={() => { setMemberFilter(member); setSelected(new Set()); setExpanded(null) }}
                >
                  {member}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {flash && <span className="cmo-badge" style={{ background: '#e7f4ec', color: '#2e8b57', fontSize: 13 }}>{flash}</span>}
          <Link className="cmo-button" href={`/cmo/patients/${id}/intake`}>切換 Triage 模式</Link>
        </div>
      </header>

      <div className="cmo-nhi-shell split">
        {/* Left: section sidebar */}
        <aside className="cmo-card cmo-nhi-sidebar">
          <div className="cmo-kpi-label" style={{ padding: '10px 12px 4px' }}>10 個資料區塊</div>
          {SECTIONS.map((s) => {
            const stats = sectionStats[s.key]
            const isActive = activeSection === s.key
            const hasPending = stats.pending > 0
            return (
              <button
                key={s.key} type="button"
                className={`cmo-nhi-section-tab ${isActive ? 'active' : ''}`}
                onClick={() => { setActiveSection(s.key); setSelected(new Set()); setExpanded(null) }}
              >
                <div className="icon">{s.icon}</div>
                <div className="body">
                  <div className="label">{s.label}</div>
                  <div className="meta">
                    {stats.total === 0 ? <span className="cmo-muted">無資料</span> : (
                      <>
                        <span>{stats.total} 筆</span>
                        {hasPending && <span className="badge pending">{stats.pending} 待審</span>}
                        {stats.accepted > 0 && <span className="badge ok">{stats.accepted}</span>}
                      </>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </aside>

        {/* Right: section content */}
        <main className="cmo-card cmo-nhi-content">
          <div className="cmo-nhi-section-header">
            <div>
              <h2 className="cmo-section-title" style={{ margin: 0, fontSize: 18 }}>
                <span style={{ marginRight: 8 }}>{currentMeta.icon}</span>{currentMeta.label}
              </h2>
              <div className="cmo-subtitle">{currentMeta.subtitle}</div>
            </div>
            <div className="cmo-nhi-status-chips">
              {(['all', 'pending', 'accepted', 'rejected'] as const).map((k) => {
                const count = k === 'all' ? currentStats.total : currentStats[k]
                const lbl = k === 'all' ? '全部' : STATUS_META[k].label
                return (
                  <button key={k} type="button"
                    className={`cmo-chip ${statusFilter === k ? 'active' : ''}`}
                    onClick={() => setStatusFilter(k)}>
                    {lbl} <span>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {currentStats.total === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#6b7c8c' }}>
              此區塊目前沒有可審資料。若 Workbench 顯示待審 draft，請切換其他區塊；若全部區塊皆為 0，代表尚未完成 NHI 匯入或 parser 尚未標記 section。
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#6b7c8c' }}>
              此狀態下沒有紀錄。
            </div>
          ) : (
            <>
              <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
                <table className="cmo-triage-table">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}></th>
                      <th style={{ width: 62 }}>成員</th>
                      <th style={{ width: 94 }}>日期</th>
                      <th style={{ width: 92 }}>機構</th>
                      <th>{activeSection === 'vaccine' ? '疫苗' : activeSection === 'lab' ? '檢查項目' : '診斷 / 內容'}</th>
                      <th style={{ width: 66 }}>ICD</th>
                      <th style={{ width: 82 }}>狀態</th>
                      <th style={{ width: 236, textAlign: 'right' }}>動作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((d) => {
                      const f = d.payload?.extracted_fields ?? {}
                      const isSel = selected.has(d.id)
                      const isExp = expanded === d.id
                      const rowDate = firstText(f, ['visit_date', 'onset_date']) || d.created_at || ''
                      const facility = firstText(f, ['facility', 'hospital'])
                      const sourceLabel = facility || (f.source_doc_page ? `source p.${toText(f.source_doc_page)}` : d.payload?.model_meta?.run_id || '—')
                      const contentLabel = firstText(f, ['diagnosis', 'diagnosis_text', 'vaccine', 'imaging_summary', 'impression_text', 'substance', 'analyte_name', 'raw_description', 'modality', 'raw_code']) || d.draft_type
                      const icd = firstText(f, ['icd10', 'icd10_candidates'])
                      const secondary = firstText(f, ['key_medications', 'value_numeric', 'unit', 'severity', 'reaction', 'days_supply'])
                      const redzoneCandidate = redZonePatchForDraft(d)
                      const triageStatus = d.triage_status ?? 'pending'
                      const memberProblems = problemOptionsForMember(memberLabel(d))
                      const suggestion = suggestedProblemForDraft(icd, memberProblems)
                      // An explicit pick (including clearing back to "選 Problem…") always
                      // wins; otherwise the ICD match seeds the dropdown.
                      const usingSuggestion = Boolean(suggestion) && linkTargets[d.id] === undefined
                      const selectedProblemId = linkTargets[d.id] ?? (suggestion ? String(suggestion.problem.problem_id) : '')
                      const rowStatus = rowStatusMeta(d.status, triageStatus)
                      // Secondary + destructive + legacy actions live behind "⋯" so the
                      // column keeps its labels readable instead of crushing them.
                      const rowMenuGroups: RowActionGroup[] = [
                        {
                          actions: [
                            ...(triageStatus === 'pending' && usingSuggestion && suggestion ? [{
                              key: 'clear-suggestion',
                              label: '清除自動配對',
                              hint: `目前建議：${problemLabel(suggestion.problem)}`,
                              onSelect: () => setLinkTargets((prev) => ({ ...prev, [d.id]: '' })),
                            }] : []),
                            ...(redzoneCandidate ? [{
                              key: 'redzone',
                              label: '帶到保命紅區',
                              hint: '過敏／植入物等紅區資料',
                              onSelect: () => sendNhiDraftToRedZone(d),
                            }] : []),
                            ...(triageStatus === 'pending' ? [
                              {
                                key: 'dismiss',
                                label: '免關聯',
                                hint: '這筆不需要進 Problem',
                                disabled: busy,
                                onSelect: () => { void runSourceTriage('dismiss', [d.id], { memberName: memberLabel(d) }) },
                              },
                              {
                                key: 'missing',
                                label: '需要補資料',
                                hint: '向使用者發出補件請求',
                                disabled: busy,
                                onSelect: () => { void runSourceTriage('request_missing_data', [d.id], { memberName: memberLabel(d) }) },
                              },
                              {
                                key: 'reject',
                                label: '退回',
                                hint: '來源有誤或無法採用',
                                tone: 'danger' as const,
                                disabled: busy,
                                onSelect: () => { void runSourceTriage('reject', [d.id], { memberName: memberLabel(d) }) },
                              },
                            ] : []),
                          ],
                        },
                        {
                          title: 'Legacy 流程',
                          actions: d.status === 'pending' ? [
                            { key: 'legacy-accept', label: 'Legacy 接受', disabled: busy, onSelect: () => runSingle('accept', d.id) },
                            { key: 'legacy-reject', label: 'Legacy 退回', tone: 'danger' as const, disabled: busy, onSelect: () => runSingle('reject', d.id) },
                          ] : [],
                        },
                      ]
                      return [
                        <tr id={`nhi-draft-${d.id}`} key={`r-${d.id}`}
                          className={`${isSel ? 'selected' : ''} ${isExp ? 'expanded' : ''}`}
                          onClick={(e) => {
                            const t = e.target as HTMLElement
                            if (t.closest('input,button')) return
                            setExpanded(isExp ? null : d.id)
                          }}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={isSel}
                              disabled={triageStatus !== 'pending'}
                              onChange={() => toggleOne(d.id)} />
                          </td>
                          <td><span className="cmo-badge">{memberLabel(d)}</span></td>
                          <td style={{ whiteSpace: 'nowrap', color: '#56687a', fontVariantNumeric: 'tabular-nums' }}>
                            {formatDate(rowDate)}
                          </td>
                          <td className="cmo-nhi-facility">{sourceLabel}</td>
                          <td>
                            <div className="cmo-nhi-title">{contentLabel}</div>
                            {/* One secondary line only — long drug lists used to push rows to
                                three lines and break the visual rhythm. Full text is in the
                                expanded detail row. */}
                            {f.lab_total_items ? <div className="cmo-nhi-sub">共 {toText(f.lab_total_items)} 項檢驗</div> : null}
                            {f.key_medications ? <div className="cmo-nhi-sub">{toText(f.key_medications)}</div> : null}
                            {secondary && !f.key_medications && !f.lab_total_items ? <div className="cmo-nhi-sub">{secondary}</div> : null}
                          </td>
                          <td className="cmo-nhi-icd">{icd || '—'}</td>
                          <td>
                            <span className="cmo-badge" style={{ background: rowStatus.bg, color: rowStatus.color, whiteSpace: 'nowrap' }}>{rowStatus.label}</span>
                          </td>
                          <td>
                            {/* Same control group on every row so the column stays aligned.
                                A matching ICD pre-selects the Problem; the CMO only confirms. */}
                            <div className="cmo-rowact">
                              {triageStatus === 'pending' && (
                                <div className={`cmo-rowact-link${usingSuggestion ? ' suggested' : ''}`}>
                                  <select
                                    className="cmo-select"
                                    value={selectedProblemId}
                                    aria-label="選擇要加入的 Problem"
                                    title={usingSuggestion && suggestion ? `ICD ${icd} ${suggestion.exact ? '完全符合' : '屬同一類'}，已自動帶入` : '選擇要加入的 Problem'}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) => setLinkTargets((prev) => ({ ...prev, [d.id]: event.target.value }))}
                                  >
                                    <option value="">選 Problem…</option>
                                    {memberProblems.map((problem) => (
                                      <option key={problem.problem_id} value={problem.problem_id}>
                                        {problemLabel(problem)}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="cmo-iconbtn primary"
                                    disabled={busy || !selectedProblemId}
                                    aria-label="加入選定的 Problem"
                                    title="加入選定的 Problem"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void runSourceTriage('link_to_problem', [d.id], { problemId: Number(selectedProblemId), memberName: memberLabel(d) })
                                    }}
                                  >
                                    ✓
                                  </button>
                                </div>
                              )}
                              <button
                                type="button"
                                className="cmo-iconbtn"
                                aria-label="帶到右側填寫面板"
                                title="帶到右側填寫面板"
                                onClick={(event) => { event.stopPropagation(); sendNhiDraftSummaryToPanel(d) }}
                              >
                                →
                              </button>
                              <RowActionsMenu groups={rowMenuGroups} />
                            </div>
                          </td>
                        </tr>,
                        isExp ? <DetailRow key={`e-${d.id}`} draft={d} /> : null
                      ]
                    })}
                  </tbody>
                </table>
              </div>

              {pendingInSection.length > 0 && (
                <div className="cmo-nhi-section-footer">
                  <div className="cmo-subtitle">
                    區塊「{currentMeta.label}」共有 {pendingInSection.length} 筆待審紀錄
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button className="cmo-button" type="button" onClick={selectAllPending}>
                      全選此區塊待審
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        <PatientContentEntryLauncher patientId={id} contextLabel="NHI 健康存摺" presentation="inline" />
      </div>

      {selected.size > 0 && (
        <div className="cmo-bulk-bar">
          <span className="count">已選 {selected.size} 筆</span>
          <span className="cmo-subtitle">區塊「{currentMeta.label}」內的 source triage{selectedMemberName ? ` · ${selectedMemberName}` : ' · 請勿跨成員'}</span>
          <div className="actions">
            {/* Primary bulk path: link every selected source row to one Problem. */}
            <select
              className="cmo-select"
              style={{ minHeight: 34, width: 170, fontSize: 13 }}
              value={bulkProblemId}
              aria-label="批次加入的 Problem"
              disabled={!selectedMemberName}
              onChange={(event) => setBulkProblemId(event.target.value)}
            >
              <option value="">選 Problem…</option>
              {problemOptionsForMember(selectedMemberName).map((problem) => (
                <option key={problem.problem_id} value={problem.problem_id}>{problemLabel(problem)}</option>
              ))}
            </select>
            <button
              className="cmo-button primary"
              type="button"
              disabled={busy || !selectedMemberName || !bulkProblemId}
              onClick={() => {
                void runSourceTriage('link_to_problem', Array.from(selected), { problemId: Number(bulkProblemId), memberName: selectedMemberName })
                setBulkProblemId('')
              }}
            >
              加入 Problem ({selected.size})
            </button>
            <button className="cmo-button" type="button" disabled={busy || !selectedMemberName} onClick={() => void runSourceTriage('dismiss', Array.from(selected))}>免關聯</button>
            <RowActionsMenu
              ariaLabel="更多批次動作"
              groups={[
                {
                  actions: [
                    { key: 'bulk-missing', label: '需要補資料', hint: '向使用者發出補件請求', disabled: busy || !selectedMemberName, onSelect: () => { void runSourceTriage('request_missing_data', Array.from(selected)) } },
                    { key: 'bulk-reject', label: '退回來源', hint: '來源有誤或無法採用', tone: 'danger', disabled: busy || !selectedMemberName, onSelect: () => { void runSourceTriage('reject', Array.from(selected)) } },
                  ],
                },
                {
                  title: 'Legacy 流程',
                  actions: [
                    { key: 'bulk-legacy-accept', label: 'Legacy 接受', disabled: busy, onSelect: () => runBulk('accept') },
                  ],
                },
              ]}
            />
            <button className="cmo-button" type="button" onClick={clearSelection}>清除</button>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ draft }: { draft: Draft }) {
  const f = draft.payload?.extracted_fields ?? {}
  const detail = draft.payload?.detail ?? {}

  return (
    <tr>
      <td colSpan={8} style={{ padding: 0, background: 'transparent', borderBottom: '1px solid #efdfae' }}>
        <div className="cmo-detail-card">
          <div className="cmo-detail-grid">
            {Object.entries(f).map(([k, v]) => (
              <div className="cmo-detail-field" key={k}>
                <span className="k">{k}</span>
                <div style={{ padding: '6px 8px', background: '#fff', border: '1px solid #e0e7ec', borderRadius: 6, fontSize: 13 }}>
                  {toText(v) || '—'}
                </div>
                {toText(v) && (
                  <button type="button" className="cmo-button" style={{ minHeight: 28, padding: '4px 8px', fontSize: 12 }} onClick={() => sendNhiFieldToPanel(k, v)}>
                    帶到右側
                  </button>
                )}
              </div>
            ))}
          </div>

          {detail.medications && detail.medications.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>用藥明細 ({detail.medications.length} 項)</div>
              <table className="cmo-table" style={{ fontSize: 12 }}>
                <thead><tr><th>代碼</th><th>藥名</th><th>數量</th><th>動作</th></tr></thead>
                <tbody>{detail.medications.map((m, i) => (
                  <tr key={i}><td>{m.code}</td><td>{m.name}</td><td>{m.qty}</td><td><button type="button" className="cmo-button" style={{ minHeight: 28, padding: '4px 8px', fontSize: 12 }} onClick={() => sendNhiMedicationToPanel(m)}>帶到右側</button></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {detail.lab_results && detail.lab_results.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>檢驗項目 ({detail.lab_results.length} 項)</div>
              <table className="cmo-table" style={{ fontSize: 12 }}>
                <thead><tr><th>項目</th><th>數值</th><th>單位</th><th>參考</th><th>動作</th></tr></thead>
                <tbody>{detail.lab_results.map((r, i) => (
                  <tr key={i}><td>{r.item}</td><td>{r.value}</td><td>{r.unit}</td><td>{r.ref}</td><td><button type="button" className="cmo-button" style={{ minHeight: 28, padding: '4px 8px', fontSize: 12 }} onClick={() => sendNhiLabToPanel(r)}>帶到右側</button></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {detail.imaging_reports && detail.imaging_reports.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>影像報告</div>
              {detail.imaging_reports.map((r, i) => (
                <pre key={i} className="cmo-source-raw" style={{ marginBottom: 6 }}>{r}</pre>
              ))}
            </div>
          )}

          {detail.orders && detail.orders.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>處置／醫囑 ({detail.orders.length} 項)</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {detail.orders.map((o, i) => <li key={i}>{o.code} · {o.name}</li>)}
              </ul>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}
