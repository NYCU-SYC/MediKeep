'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { normalizeDateInput } from '@/lib/cmoReview'
import { normalizeMemberName, uniqueMemberNames } from '@/lib/members'
import { drugByName, searchDiagnoses, displayDrugName, type DiagnosisEntry, type DrugEntry } from '@/lib/clinicalDictionary'
import { DiagnosisSearch, DrugSearch, QuickPick, MED_FREQUENCY_OPTIONS } from './quickpick'

type ProblemStatus = 'underlying' | 'following' | 'resolved'
type FillPanelKey = 'source' | 'problem' | 'condition' | 'medication' | 'followup' | 'record' | 'redzone'
type RedZoneSection = 'allergy' | 'implant' | 'profile' | 'mri'
type TriState = '' | 'true' | 'false'
type FillTarget =
  | 'problem.display_name'
  | 'problem.display_layman'
  | 'problem.icd10_code'
  | 'problem.onset_date'
  | 'condition.display_name'
  | 'condition.icd10_code'
  | 'medication.drug_name'
  | 'medication.dose'
  | 'medication.frequency'
  | 'reminder.title'
  | 'reminder.scheduled_date'
  | 'reminder.note'
  | 'record.record_type'
  | 'record.value1'
  | 'record.value2'
  | 'record.unit'
  | 'record.note'
  | 'redzone.allergy_substance'
  | 'redzone.allergy_reaction'
  | 'redzone.implant_type'
  | 'redzone.implant_model'
  | 'redzone.profile_egfr'
  | 'redzone.profile_blood_type'
  | 'redzone.profile_emergency_contact'
  | 'redzone.mri_note'

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

interface RedZoneAllergyForm {
  category: string
  substance: string
  reaction: string
  severity: string
  status: string
  source: string
  onset_date: string
  note: string
}

interface RedZoneImplantForm {
  type: string
  subtype: string
  model: string
  body_site: string
  implant_date: string
  hospital: string
  note: string
}

interface RedZoneProfileForm {
  blood_type: string
  rh_factor: string
  egfr_value: string
  egfr_date: string
  ckd_stage: string
  is_dialysis: TriState
  dialysis_modality: string
  dialysis_schedule: string
  emergency_contact_name: string
  emergency_contact_relation: string
  emergency_contact_phone: string
}

interface RedZoneMriForm {
  has_pacemaker: TriState
  pacemaker_detail: string
  has_metal_implant: TriState
  metal_implant_detail: string
  has_fixed_denture: TriState
  has_other: TriState
  other_detail: string
}

interface Medication {
  id: number
  member_name?: string | null
  drug_name: string
  dose?: string | null
  frequency?: string | null
  intent?: string | null
  is_active: boolean
}

interface Reminder {
  id: number
  member_name?: string | null
  title: string
  scheduled_date?: string | null
  is_done: boolean
  note?: string | null
}

interface ProblemSnapshot {
  id: number
  member_name?: string | null
  display_name: string
  display_layman?: string | null
  is_verified: boolean
  is_published: boolean
}

interface PatientSnapshot {
  problems: ProblemSnapshot[]
  conditions: Array<{ id: number; member_name?: string | null; display_name?: string | null }>
  medications: Medication[]
  reminders?: Reminder[]
  family_members?: Array<{ id: string; name?: string | null; relation?: string | null }>
}

interface ProblemBridge {
  id: number
  display_name: string
  display_layman?: string | null
  is_verified: boolean
  is_published: boolean
}

type FillPatch = {
  problem?: Partial<ProblemForm>
  condition?: Partial<ConditionForm>
  medication?: Partial<MedicationForm>
  reminder?: Partial<ReminderForm>
  record?: Partial<RecordForm>
  redzone?: RedZoneDraftPatch
}

export type RedZoneDraftPatch = {
  section?: RedZoneSection
  allergy?: Partial<RedZoneAllergyForm>
  implant?: Partial<RedZoneImplantForm>
  profile?: Partial<RedZoneProfileForm>
  mri?: Partial<RedZoneMriForm>
}

type FillEventDetail = {
  text?: string
  textByPanel?: Partial<Record<FillPanelKey, string>>
  target?: FillTarget
  patch?: FillPatch
  source?: string
  open?: boolean
  queueOnly?: boolean
  forcePanel?: FillPanelKey
  respectActivePanel?: boolean
}

interface FillQueueItem {
  id: string
  source: string
  summary: string
  panel: FillPanelKey
  text?: string
  target?: FillTarget
  patch?: FillPatch
}

interface EntryState {
  activePanel: FillPanelKey
  activeTarget: FillTarget
  lastSource: string
  problemForm: ProblemForm
  conditionForm: ConditionForm
  medicationForm: MedicationForm
  reminderForm: ReminderForm
  recordForm: RecordForm
  redZoneSection: RedZoneSection
  redZoneAllergyForm: RedZoneAllergyForm
  redZoneImplantForm: RedZoneImplantForm
  redZoneProfileForm: RedZoneProfileForm
  redZoneMriForm: RedZoneMriForm
}

const TARGET_OPTIONS: Array<{ value: FillTarget; label: string }> = [
  { value: 'problem.display_name', label: 'Problem name' },
  { value: 'problem.display_layman', label: 'Problem 白話名稱' },
  { value: 'problem.icd10_code', label: 'Problem ICD-10' },
  { value: 'problem.onset_date', label: 'Problem 起始日期' },
  { value: 'condition.display_name', label: '慢性病/疾病史名稱' },
  { value: 'condition.icd10_code', label: '疾病史 ICD-10' },
  { value: 'medication.drug_name', label: '藥物名稱' },
  { value: 'medication.dose', label: '藥物劑量' },
  { value: 'medication.frequency', label: '藥物頻率' },
  { value: 'reminder.title', label: '回診/追蹤事項' },
  { value: 'reminder.scheduled_date', label: '回診日期' },
  { value: 'reminder.note', label: '回診備註' },
  { value: 'record.record_type', label: '量測/檢驗類型' },
  { value: 'record.value1', label: '量測/檢驗數值 1' },
  { value: 'record.value2', label: '量測/檢驗數值 2' },
  { value: 'record.unit', label: '量測/檢驗單位' },
  { value: 'record.note', label: '量測/檢驗來源備註' },
  { value: 'redzone.allergy_substance', label: '保命紅區 · 過敏物質' },
  { value: 'redzone.allergy_reaction', label: '保命紅區 · 過敏反應' },
  { value: 'redzone.implant_type', label: '保命紅區 · 植入物類型' },
  { value: 'redzone.implant_model', label: '保命紅區 · 植入物型號' },
  { value: 'redzone.profile_egfr', label: '保命紅區 · eGFR' },
  { value: 'redzone.profile_blood_type', label: '保命紅區 · 血型' },
  { value: 'redzone.profile_emergency_contact', label: '保命紅區 · 緊急聯絡' },
  { value: 'redzone.mri_note', label: '保命紅區 · MRI 風險說明' },
]

const FILL_PANEL_OPTIONS: Array<{ key: FillPanelKey; label: string; subtitle: string }> = [
  { key: 'source', label: '來源帶入', subtitle: '選取文字或接收 NHI/Draft' },
  { key: 'problem', label: '健康摘要', subtitle: 'Problem 與病人白話摘要' },
  { key: 'condition', label: '慢性病', subtitle: '疾病史與 Problem candidate' },
  { key: 'medication', label: '藥物', subtitle: '藥名、劑量、active/stopped' },
  { key: 'followup', label: '回診', subtitle: '回診與追蹤事項' },
  { key: 'record', label: '紀錄', subtitle: '量測與檢驗值' },
  { key: 'redzone', label: '保命紅區', subtitle: '過敏、植入物、腎功能、MRI' },
]

const PROBLEM_TEMPLATES: Array<Pick<ProblemForm, 'display_name' | 'display_layman' | 'icd10_code' | 'status' | 'tier'> & { label: string }> = [
  { label: '高血壓', display_name: 'Hypertension', display_layman: '高血壓（血管壓力長期偏高）', icd10_code: 'I10', status: 'underlying', tier: 2 },
  { label: '糖尿病', display_name: 'Type 2 diabetes mellitus', display_layman: '第二型糖尿病（血糖長期偏高）', icd10_code: 'E11.9', status: 'underlying', tier: 2 },
  { label: '高血脂', display_name: 'Hyperlipidemia', display_layman: '高血脂（血液中的油脂偏高）', icd10_code: 'E78.5', status: 'underlying', tier: 2 },
  { label: 'CKD', display_name: 'Chronic kidney disease', display_layman: '慢性腎臟病（腎功能需要長期追蹤）', icd10_code: 'N18.9', status: 'underlying', tier: 1 },
  { label: '疑似 AF', display_name: 'Suspected atrial fibrillation', display_layman: '疑似心房顫動（心跳節律可能不規則）', icd10_code: 'I48.91', status: 'following', tier: 1 },
]

const MEDICATION_TEMPLATES: Array<Pick<MedicationForm, 'drug_name' | 'dose' | 'frequency' | 'intent' | 'note'> & { label: string }> = [
  { label: '降壓藥', drug_name: 'Amlodipine', dose: '5 mg', frequency: '每日一次', intent: 'chronic', note: '由 CMO 依來源資料確認，病人端僅顯示用藥摘要。' },
  { label: '降血脂', drug_name: 'Atorvastatin', dose: '20 mg', frequency: '每日一次', intent: 'chronic', note: '需於回診時確認持續服用狀態。' },
  { label: '糖尿病用藥', drug_name: 'Metformin', dose: '500 mg', frequency: '每日兩次', intent: 'chronic', note: '依 NHI/藥袋資料整理，劑量異動需 CMO 確認。' },
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

function todayInputDate() {
  return new Date().toISOString().slice(0, 10)
}

function nowInputDateTime() {
  return new Date().toISOString().slice(0, 16)
}

function normalizeDate(value: string) {
  // Shared parser handles western + ROC-era (民國) dates; fall back to a 10-char slice.
  return normalizeDateInput(value) || value.slice(0, 10)
}

function defaultProblemForm(): ProblemForm {
  return { display_name: '', display_layman: '', icd10_code: '', status: 'following', tier: 3, is_suspected: false, onset_date: '', cmo_note: '' }
}

function defaultConditionForm(): ConditionForm {
  return { display_name: '', icd10_code: '', status: 'active', onset_date: '', note: '', sync_problem: true }
}

function defaultMedicationForm(): MedicationForm {
  return { drug_name: '', dose: '', frequency: '每日一次', intent: 'chronic', started_on: todayInputDate(), ended_on: '', is_active: true, note: '' }
}

function defaultReminderForm(): ReminderForm {
  return { title: '', scheduled_date: todayInputDate(), repeat_type: 'none', note: '' }
}

function defaultRecordForm(): RecordForm {
  return { record_type: 'blood_pressure', value1: '', value2: '', unit: 'mmHg', recorded_at: nowInputDateTime(), note: '' }
}

function defaultRedZoneAllergyForm(): RedZoneAllergyForm {
  return { category: 'drug', substance: '', reaction: '', severity: 'moderate', status: 'confirmed', source: 'nhi_cmo_entry', onset_date: '', note: '' }
}

function defaultRedZoneImplantForm(): RedZoneImplantForm {
  return { type: '', subtype: '', model: '', body_site: '', implant_date: '', hospital: '', note: '' }
}

function defaultRedZoneProfileForm(): RedZoneProfileForm {
  return {
    blood_type: '',
    rh_factor: '',
    egfr_value: '',
    egfr_date: '',
    ckd_stage: '',
    is_dialysis: '',
    dialysis_modality: '',
    dialysis_schedule: '',
    emergency_contact_name: '',
    emergency_contact_relation: '',
    emergency_contact_phone: '',
  }
}

function defaultRedZoneMriForm(): RedZoneMriForm {
  return {
    has_pacemaker: '',
    pacemaker_detail: '',
    has_metal_implant: '',
    metal_implant_detail: '',
    has_fixed_denture: '',
    has_other: '',
    other_detail: '',
  }
}

function cleanPayload(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && value !== null && value !== undefined))
}

function numberText(value: string) {
  const match = value.match(/-?\d+(?:\.\d+)?/)
  return match?.[0] ?? value
}

function triStateToBoolean(value: TriState) {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function mergeNote(current: string, addition: string) {
  if (!addition.trim()) return current
  return current.trim() ? `${current}\n${addition.trim()}` : addition.trim()
}

export function sendToPatientContentPanel(detail: FillEventDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<FillEventDetail>('healthkeep:cmo-fill', { detail: { open: true, ...detail } }))
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '未記錄'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function panelForTarget(target: FillTarget): FillPanelKey {
  if (target.startsWith('problem.')) return 'problem'
  if (target.startsWith('condition.')) return 'condition'
  if (target.startsWith('medication.')) return 'medication'
  if (target.startsWith('reminder.')) return 'followup'
  if (target.startsWith('redzone.')) return 'redzone'
  return 'record'
}

function panelForPatch(patch?: FillPatch): FillPanelKey | null {
  if (!patch) return null
  if (patch.redzone) return 'redzone'
  if (patch.problem) return 'problem'
  if (patch.condition) return 'condition'
  if (patch.medication) return 'medication'
  if (patch.reminder) return 'followup'
  if (patch.record) return 'record'
  return null
}

function labelForPanel(panel: FillPanelKey) {
  return FILL_PANEL_OPTIONS.find((option) => option.key === panel)?.label ?? '目前分頁'
}

function defaultTargetForPanel(panel: FillPanelKey): FillTarget {
  if (panel === 'condition') return 'condition.display_name'
  if (panel === 'medication') return 'medication.drug_name'
  if (panel === 'followup') return 'reminder.note'
  if (panel === 'record') return 'record.note'
  if (panel === 'redzone') return 'redzone.mri_note'
  return 'problem.display_layman'
}

function targetForPanel(panel: FillPanelKey, fallback: FillTarget): FillTarget {
  if (panel === 'source') return fallback
  if (panel === 'problem') return fallback.startsWith('problem.') ? fallback : 'problem.display_layman'
  if (panel === 'condition') return fallback.startsWith('condition.') ? fallback : 'condition.display_name'
  if (panel === 'medication') return fallback.startsWith('medication.') ? fallback : 'medication.drug_name'
  if (panel === 'followup') return fallback.startsWith('reminder.') ? fallback : 'reminder.note'
  if (panel === 'record') return fallback.startsWith('record.') ? fallback : 'record.note'
  if (panel === 'redzone') return fallback.startsWith('redzone.') ? fallback : 'redzone.mri_note'
  return fallback
}

function patchForPanel(patch: FillPatch | undefined, panel: FillPanelKey): FillPatch | undefined {
  if (!patch || panel === 'source') return patch
  if (panel === 'problem') return patch.problem ? { problem: patch.problem } : undefined
  if (panel === 'condition') return patch.condition ? { condition: patch.condition } : undefined
  if (panel === 'medication') return patch.medication ? { medication: patch.medication } : undefined
  if (panel === 'followup') return patch.reminder ? { reminder: patch.reminder } : undefined
  if (panel === 'record') return patch.record ? { record: patch.record } : undefined
  if (panel === 'redzone') return patch.redzone ? { redzone: patch.redzone } : undefined
  return patch
}

let queueSequence = 0

function compactText(value: string | null | undefined) {
  const text = value?.trim()
  if (!text) return ''
  return text.length > 72 ? `${text.slice(0, 72)}...` : text
}

function summaryForPatch(patch?: FillPatch) {
  if (!patch) return ''
  if (patch.problem) return compactText(patch.problem.display_layman || patch.problem.display_name || patch.problem.icd10_code)
  if (patch.condition) return compactText(patch.condition.display_name || patch.condition.icd10_code)
  if (patch.medication) return compactText([patch.medication.drug_name, patch.medication.dose, patch.medication.frequency].filter(Boolean).join(' · '))
  if (patch.reminder) return compactText([patch.reminder.title, patch.reminder.scheduled_date].filter(Boolean).join(' · '))
  if (patch.redzone?.allergy) return compactText(['紅區過敏', patch.redzone.allergy.substance, patch.redzone.allergy.reaction].filter(Boolean).join(' · '))
  if (patch.redzone?.implant) return compactText(['紅區植入物', patch.redzone.implant.type, patch.redzone.implant.model].filter(Boolean).join(' · '))
  if (patch.redzone?.profile) return compactText(['紅區基本/腎功能', patch.redzone.profile.egfr_value, patch.redzone.profile.blood_type, patch.redzone.profile.emergency_contact_name].filter(Boolean).join(' · '))
  if (patch.redzone?.mri) return compactText(['紅區 MRI', patch.redzone.mri.pacemaker_detail, patch.redzone.mri.metal_implant_detail, patch.redzone.mri.other_detail].filter(Boolean).join(' · '))
  if (patch.record) return compactText([patch.record.record_type, patch.record.value1, patch.record.unit, patch.record.note].filter(Boolean).join(' · '))
  return ''
}

function buildQueueItem(detail: FillEventDetail): FillQueueItem {
  queueSequence += 1
  const panel = detail.target ? panelForTarget(detail.target) : panelForPatch(detail.patch) ?? 'source'
  const textSummary = detail.text ? compactText(detail.text) : ''
  const patchSummary = summaryForPatch(detail.patch)
  return {
    id: `${Date.now()}-${queueSequence}`,
    source: detail.source || '未命名來源',
    summary: patchSummary || textSummary || '待套用資料',
    panel,
    text: detail.text,
    target: detail.target,
    patch: detail.patch,
  }
}

export default function PatientContentEntryLauncher({ patientId, contextLabel, presentation = 'floating' }: { patientId: string; contextLabel?: string; presentation?: 'floating' | 'inline' }) {
  const isInline = presentation === 'inline'
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<PatientSnapshot | null>(null)
  const [activePanel, setActivePanel] = useState<FillPanelKey>('source')
  const [activeTarget, setActiveTarget] = useState<FillTarget>('problem.display_layman')
  const [lastSource, setLastSource] = useState(contextLabel ?? '')
  const [flash, setFlash] = useState('')
  const [toast, setToast] = useState('')
  const [importQueue, setImportQueue] = useState<FillQueueItem[]>([])
  const [undoStack, setUndoStack] = useState<EntryState[]>([])
  const [busy, setBusy] = useState('')
  const [bridgeBusy, setBridgeBusy] = useState('')
  const [lastProblemBridge, setLastProblemBridge] = useState<ProblemBridge | null>(null)
  const [problemForm, setProblemForm] = useState<ProblemForm>(defaultProblemForm)
  const [conditionForm, setConditionForm] = useState<ConditionForm>(defaultConditionForm)
  const [medicationForm, setMedicationForm] = useState<MedicationForm>(defaultMedicationForm)
  const [reminderForm, setReminderForm] = useState<ReminderForm>(defaultReminderForm)
  const [recordForm, setRecordForm] = useState<RecordForm>(defaultRecordForm)
  const [redZoneSection, setRedZoneSection] = useState<RedZoneSection>('allergy')
  const [redZoneAllergyForm, setRedZoneAllergyForm] = useState<RedZoneAllergyForm>(defaultRedZoneAllergyForm)
  const [redZoneImplantForm, setRedZoneImplantForm] = useState<RedZoneImplantForm>(defaultRedZoneImplantForm)
  const [redZoneProfileForm, setRedZoneProfileForm] = useState<RedZoneProfileForm>(defaultRedZoneProfileForm)
  const [redZoneMriForm, setRedZoneMriForm] = useState<RedZoneMriForm>(defaultRedZoneMriForm)
  const [selectedMember, setSelectedMember] = useState('本人')

  const memberOptions = useMemo(() => {
    const names = uniqueMemberNames(
      snapshot?.family_members?.map((item) => item.name),
      ['本人'],
      snapshot?.conditions.map((item) => item.member_name),
      snapshot?.medications.map((item) => item.member_name),
      snapshot?.reminders?.map((item) => item.member_name),
    )
    return names.length ? names : ['本人']
  }, [snapshot])
  const activeMeds = useMemo(() => snapshot?.medications
    .filter((medication) => medication.is_active)
    .filter((medication) => normalizeMemberName(medication.member_name) === selectedMember) ?? [], [selectedMember, snapshot])
  const upcoming = useMemo(() => snapshot?.reminders
    ?.filter((reminder) => !reminder.is_done)
    .filter((reminder) => normalizeMemberName(reminder.member_name) === selectedMember) ?? [], [selectedMember, snapshot])
  const pendingPatientProblems = useMemo(
    () => snapshot?.problems
      .filter((problem) => !problem.is_published)
      .filter((problem) => normalizeMemberName(problem.member_name) === selectedMember) ?? [],
    [selectedMember, snapshot],
  )
  const currentEntryState = useMemo<EntryState>(() => ({
    activePanel,
    activeTarget,
    lastSource,
    problemForm,
    conditionForm,
    medicationForm,
    reminderForm,
    recordForm,
    redZoneSection,
    redZoneAllergyForm,
    redZoneImplantForm,
    redZoneProfileForm,
    redZoneMriForm,
  }), [activePanel, activeTarget, conditionForm, lastSource, medicationForm, problemForm, recordForm, redZoneAllergyForm, redZoneImplantForm, redZoneMriForm, redZoneProfileForm, redZoneSection, reminderForm])
  const currentEntryStateRef = useRef(currentEntryState)
  const panelReady = useMemo<Record<FillPanelKey, boolean>>(() => ({
    source: Boolean(lastSource),
    problem: Boolean(problemForm.display_name.trim() || problemForm.display_layman.trim()),
    condition: Boolean(conditionForm.display_name.trim()),
    medication: Boolean(medicationForm.drug_name.trim()),
    followup: Boolean(reminderForm.title.trim()),
    record: Boolean(recordForm.value1.trim()),
    redzone: Boolean(
      redZoneAllergyForm.substance.trim()
      || redZoneImplantForm.type.trim()
      || redZoneProfileForm.egfr_value.trim()
      || redZoneProfileForm.blood_type.trim()
      || redZoneProfileForm.is_dialysis
      || redZoneProfileForm.dialysis_schedule.trim()
      || redZoneProfileForm.emergency_contact_name.trim()
      || redZoneMriForm.pacemaker_detail.trim()
      || redZoneMriForm.metal_implant_detail.trim()
      || redZoneMriForm.other_detail.trim()
      || redZoneMriForm.has_pacemaker
      || redZoneMriForm.has_metal_implant
      || redZoneMriForm.has_fixed_denture
      || redZoneMriForm.has_other
    ),
  }), [conditionForm.display_name, lastSource, medicationForm.drug_name, problemForm.display_layman, problemForm.display_name, recordForm.value1, redZoneAllergyForm.substance, redZoneImplantForm.type, redZoneMriForm.has_fixed_denture, redZoneMriForm.has_metal_implant, redZoneMriForm.has_other, redZoneMriForm.has_pacemaker, redZoneMriForm.metal_implant_detail, redZoneMriForm.other_detail, redZoneMriForm.pacemaker_detail, redZoneProfileForm.blood_type, redZoneProfileForm.dialysis_schedule, redZoneProfileForm.egfr_value, redZoneProfileForm.emergency_contact_name, redZoneProfileForm.is_dialysis, reminderForm.title])

  const notify = useCallback((message: string) => {
    setFlash(message)
    setToast(message)
    window.setTimeout(() => {
      setFlash('')
      setToast('')
    }, 1800)
  }, [])

  const loadSnapshot = useCallback(async () => {
    try {
      const data = await api.get(`/api/cmo/patients/${patientId}`) as PatientSnapshot
      setSnapshot(data)
    } catch {
      setSnapshot(null)
    }
  }, [patientId])

  useEffect(() => {
    if (open || isInline) loadSnapshot()
  }, [isInline, loadSnapshot, open])

  useEffect(() => {
    const familyMemberNames = uniqueMemberNames(snapshot?.family_members?.map((item) => item.name))
    if (familyMemberNames.length > 0 && !familyMemberNames.includes(selectedMember)) {
      setSelectedMember(familyMemberNames[0])
      return
    }
    if (!memberOptions.includes(selectedMember)) setSelectedMember(memberOptions[0] ?? '本人')
  }, [memberOptions, selectedMember, snapshot])

  useEffect(() => {
    currentEntryStateRef.current = currentEntryState
  }, [currentEntryState])

  const applyRedZonePatch = useCallback((patch: RedZoneDraftPatch) => {
    if (patch.allergy) {
      setRedZoneAllergyForm((prev) => ({ ...prev, ...patch.allergy }))
      setRedZoneSection('allergy')
    }
    if (patch.implant) {
      setRedZoneImplantForm((prev) => ({ ...prev, ...patch.implant }))
      setRedZoneSection('implant')
    }
    if (patch.profile) {
      setRedZoneProfileForm((prev) => ({ ...prev, ...patch.profile }))
      setRedZoneSection('profile')
    }
    if (patch.mri) {
      setRedZoneMriForm((prev) => ({ ...prev, ...patch.mri }))
      setRedZoneSection('mri')
    }
    if (patch.section) setRedZoneSection(patch.section)
  }, [])

  const applyText = useCallback((target: FillTarget, text: string) => {
    const clean = text.trim()
    if (!clean) return
    if (target === 'problem.display_name') setProblemForm((prev) => ({ ...prev, display_name: clean }))
    else if (target === 'problem.display_layman') setProblemForm((prev) => ({ ...prev, display_layman: clean }))
    else if (target === 'problem.icd10_code') setProblemForm((prev) => ({ ...prev, icd10_code: clean.toUpperCase() }))
    else if (target === 'problem.onset_date') setProblemForm((prev) => ({ ...prev, onset_date: normalizeDate(clean) }))
    else if (target === 'condition.display_name') setConditionForm((prev) => ({ ...prev, display_name: clean }))
    else if (target === 'condition.icd10_code') setConditionForm((prev) => ({ ...prev, icd10_code: clean.toUpperCase() }))
    else if (target === 'medication.drug_name') setMedicationForm((prev) => ({ ...prev, drug_name: clean }))
    else if (target === 'medication.dose') setMedicationForm((prev) => ({ ...prev, dose: clean }))
    else if (target === 'medication.frequency') setMedicationForm((prev) => ({ ...prev, frequency: clean }))
    else if (target === 'reminder.title') setReminderForm((prev) => ({ ...prev, title: clean }))
    else if (target === 'reminder.scheduled_date') setReminderForm((prev) => ({ ...prev, scheduled_date: normalizeDate(clean) }))
    else if (target === 'reminder.note') setReminderForm((prev) => ({ ...prev, note: prev.note ? `${prev.note}\n${clean}` : clean }))
    else if (target === 'record.record_type') setRecordForm((prev) => ({ ...prev, record_type: clean }))
    else if (target === 'record.value1') setRecordForm((prev) => ({ ...prev, value1: clean }))
    else if (target === 'record.value2') setRecordForm((prev) => ({ ...prev, value2: clean }))
    else if (target === 'record.unit') setRecordForm((prev) => ({ ...prev, unit: clean }))
    else if (target === 'record.note') setRecordForm((prev) => ({ ...prev, note: prev.note ? `${prev.note}\n${clean}` : clean }))
    else if (target === 'redzone.allergy_substance') {
      setRedZoneAllergyForm((prev) => ({ ...prev, substance: clean }))
      setRedZoneSection('allergy')
    } else if (target === 'redzone.allergy_reaction') {
      setRedZoneAllergyForm((prev) => ({ ...prev, reaction: clean }))
      setRedZoneSection('allergy')
    } else if (target === 'redzone.implant_type') {
      setRedZoneImplantForm((prev) => ({ ...prev, type: clean }))
      setRedZoneSection('implant')
    } else if (target === 'redzone.implant_model') {
      setRedZoneImplantForm((prev) => ({ ...prev, model: clean }))
      setRedZoneSection('implant')
    } else if (target === 'redzone.profile_egfr') {
      setRedZoneProfileForm((prev) => ({ ...prev, egfr_value: numberText(clean) }))
      setRedZoneSection('profile')
    } else if (target === 'redzone.profile_blood_type') {
      setRedZoneProfileForm((prev) => ({ ...prev, blood_type: clean.toUpperCase().replace(/[^ABO+-]/g, '') }))
      setRedZoneSection('profile')
    } else if (target === 'redzone.profile_emergency_contact') {
      setRedZoneProfileForm((prev) => ({ ...prev, emergency_contact_name: clean }))
      setRedZoneSection('profile')
    } else if (target === 'redzone.mri_note') {
      setRedZoneMriForm((prev) => ({ ...prev, has_other: 'true', other_detail: mergeNote(prev.other_detail, clean) }))
      setRedZoneSection('mri')
    }
  }, [])

  const applyPatch = useCallback((patch?: FillPatch) => {
    if (!patch) return
    if (patch.problem) setProblemForm((prev) => ({ ...prev, ...patch.problem }))
    if (patch.condition) setConditionForm((prev) => ({ ...prev, ...patch.condition }))
    if (patch.medication) setMedicationForm((prev) => ({ ...prev, ...patch.medication }))
    if (patch.reminder) setReminderForm((prev) => ({ ...prev, ...patch.reminder }))
    if (patch.record) setRecordForm((prev) => ({ ...prev, ...patch.record }))
    if (patch.redzone) applyRedZonePatch(patch.redzone)
  }, [applyRedZonePatch])

  const restoreEntryState = useCallback((state: EntryState) => {
    setActivePanel(state.activePanel)
    setActiveTarget(state.activeTarget)
    setLastSource(state.lastSource)
    setProblemForm(state.problemForm)
    setConditionForm(state.conditionForm)
    setMedicationForm(state.medicationForm)
    setReminderForm(state.reminderForm)
    setRecordForm(state.recordForm)
    setRedZoneSection(state.redZoneSection)
    setRedZoneAllergyForm(state.redZoneAllergyForm)
    setRedZoneImplantForm(state.redZoneImplantForm)
    setRedZoneProfileForm(state.redZoneProfileForm)
    setRedZoneMriForm(state.redZoneMriForm)
  }, [])

  const rememberUndo = useCallback(() => {
    setUndoStack((prev) => [currentEntryStateRef.current, ...prev].slice(0, 12))
  }, [])

  const undoLastImport = useCallback(() => {
    const previous = undoStack[0]
    if (!previous) {
      notify('沒有可復原的帶入')
      return
    }
    restoreEntryState(previous)
    setUndoStack((prev) => prev.slice(1))
    notify('已復原上一次帶入')
  }, [notify, restoreEntryState, undoStack])

  const applyQueueItem = useCallback((item: FillQueueItem) => {
    rememberUndo()
    setLastSource(item.source)
    applyPatch(item.patch)
    if (item.text && item.target) {
      setActiveTarget(item.target)
      applyText(item.target, item.text)
    }
    setActivePanel(item.panel)
    setImportQueue((prev) => prev.filter((queued) => queued.id !== item.id))
    notify(`已套用 ${item.source}`)
  }, [applyPatch, applyText, notify, rememberUndo])

  const applyDetailDirectly = useCallback((detail: FillEventDetail) => {
    rememberUndo()
    if (detail.source) setLastSource(detail.source)
    const inferredPanel = detail.target ? panelForTarget(detail.target) : panelForPatch(detail.patch)
    const shouldStayOnActivePanel = (detail.respectActivePanel ?? isInline) && activePanel !== 'source'
    const nextPanel = detail.forcePanel ?? (shouldStayOnActivePanel ? activePanel : inferredPanel) ?? 'source'
    const routedPatch = detail.forcePanel || shouldStayOnActivePanel ? patchForPanel(detail.patch, nextPanel) : detail.patch
    const routedText = detail.textByPanel?.[nextPanel] ?? detail.text
    const fallbackTarget = detail.target ?? defaultTargetForPanel(nextPanel)
    applyPatch(routedPatch)
    if (routedText) {
      const target = shouldStayOnActivePanel ? targetForPanel(nextPanel, fallbackTarget) : fallbackTarget
      setActiveTarget(target)
      applyText(target, routedText)
    }
    setActivePanel(nextPanel)
    const panelLabel = shouldStayOnActivePanel || detail.forcePanel ? ` · ${labelForPanel(nextPanel)}` : ''
    notify(detail.source ? `已帶到右側${panelLabel}：${detail.source}` : `已帶入填寫面板${panelLabel}`)
  }, [activePanel, applyPatch, applyText, isInline, notify, rememberUndo])

  useEffect(() => {
    const onFill = (event: Event) => {
      const detail = (event as CustomEvent<FillEventDetail>).detail
      if (detail.queueOnly) {
        const item = buildQueueItem(detail)
        setImportQueue((prev) => [item, ...prev].slice(0, 30))
        setActivePanel('source')
        notify(`已加入整理籃：${item.summary}`)
        return
      }
      if (detail.open !== false) setOpen(true)
      applyDetailDirectly(detail)
    }
    window.addEventListener('healthkeep:cmo-fill', onFill)
    return () => window.removeEventListener('healthkeep:cmo-fill', onFill)
  }, [applyDetailDirectly, notify])

  const importSelection = () => {
    const text = window.getSelection()?.toString().trim()
    if (!text) {
      notify('請先選取 NHI 或文件中的文字')
      return
    }
    rememberUndo()
    applyText(activeTarget, text)
    setActivePanel(panelForTarget(activeTarget))
    setLastSource(contextLabel ?? 'selected text')
    notify('已帶入選取文字')
  }

  // One diagnosis pick fills name + 白話名稱 + ICD-10 + tier + status, so the
  // CMO never re-types the layman translation for a common chronic disease.
  const pickDiagnosisForProblem = useCallback((entry: DiagnosisEntry) => {
    rememberUndo()
    setProblemForm((prev) => ({
      ...prev,
      display_name: entry.name_en,
      display_layman: entry.layman,
      icd10_code: entry.icd10,
      tier: entry.tier,
      status: entry.status,
      is_suspected: false,
    }))
    notify(`已帶入 ${entry.name_zh} · ${entry.icd10}`)
  }, [notify, rememberUndo])

  const pickDiagnosisForCondition = useCallback((entry: DiagnosisEntry) => {
    rememberUndo()
    setConditionForm((prev) => ({
      ...prev,
      display_name: entry.name_zh,
      icd10_code: entry.icd10,
      status: entry.status === 'resolved' ? 'resolved' : 'active',
    }))
    notify(`已帶入 ${entry.name_zh} · ${entry.icd10}`)
  }, [notify, rememberUndo])

  // One drug pick fills the name and the first common dose/frequency; remaining
  // doses are offered as chips below the field.
  const pickDrug = useCallback((entry: DrugEntry) => {
    rememberUndo()
    setMedicationForm((prev) => ({
      ...prev,
      drug_name: displayDrugName(entry),
      dose: entry.doses[0] ?? prev.dose,
      frequency: entry.frequencies[0] ?? prev.frequency,
      note: prev.note.trim() ? prev.note : `用途分類：${entry.category}`,
    }))
    notify(`已帶入 ${displayDrugName(entry)}`)
  }, [notify, rememberUndo])

  // Dose chips follow whichever drug is currently in the field.
  const activeDrugEntry = useMemo(() => drugByName(medicationForm.drug_name), [medicationForm.drug_name])

  // Suggest an ICD-10 + layman name from a diagnosis name that arrived via
  // import (NHI row / draft) but has no code attached yet.
  const problemIcdSuggestions = useMemo(() => {
    if (problemForm.icd10_code.trim()) return []
    const query = problemForm.display_name.trim() || problemForm.display_layman.trim()
    if (query.length < 2) return []
    return searchDiagnoses(query, 3)
  }, [problemForm.display_layman, problemForm.display_name, problemForm.icd10_code])

  const createProblem = async () => {
    if (!problemForm.display_name.trim() && !problemForm.display_layman.trim()) {
      notify('請先帶入或輸入 Problem 名稱')
      return
    }
    setBusy('problem')
    try {
      const created = await api.post(`/api/cmo/patients/${patientId}/problems`, {
        member_name: selectedMember,
        display_name: problemForm.display_name.trim() || problemForm.display_layman.trim(),
        display_layman: problemForm.display_layman.trim() || null,
        icd10_code: problemForm.icd10_code.trim() || null,
        status: problemForm.status,
        is_suspected: problemForm.is_suspected,
        tier: problemForm.tier,
        onset_date: problemForm.onset_date || null,
        cmo_note: problemForm.cmo_note.trim() || null,
      }) as ProblemBridge
      setLastProblemBridge(created)
      setProblemForm(defaultProblemForm())
      await loadSnapshot()
      notify('已建立 Problem，請接著 Verify/Publish 到使用者端')
    } finally {
      setBusy('')
    }
  }

  const createCondition = async () => {
    if (!conditionForm.display_name.trim()) {
      notify('請先帶入或輸入疾病史')
      return
    }
    setBusy('condition')
    try {
      await api.post(`/api/cmo/patients/${patientId}/conditions`, {
        member_name: selectedMember,
        display_name: conditionForm.display_name.trim(),
        icd10_code: conditionForm.icd10_code.trim() || null,
        status: conditionForm.status,
        onset_date: conditionForm.onset_date || null,
        note: conditionForm.note.trim() || null,
      })
      if (conditionForm.sync_problem) {
        const created = await api.post(`/api/cmo/patients/${patientId}/problems`, {
          member_name: selectedMember,
          display_name: conditionForm.display_name.trim(),
          display_layman: conditionForm.display_name.trim(),
          icd10_code: conditionForm.icd10_code.trim() || null,
          status: conditionForm.status === 'resolved' ? 'resolved' : 'underlying',
          tier: 3,
          cmo_note: conditionForm.note.trim() || '由 CMO structured entry 建立，需 publish 後病人端才顯示。',
        }) as ProblemBridge
        setLastProblemBridge(created)
      }
      setConditionForm(defaultConditionForm())
      await loadSnapshot()
      notify(conditionForm.sync_problem ? '已建立疾病史與 Problem，請接著 Publish' : '已建立疾病史，請到 Patient POV 發布')
    } finally {
      setBusy('')
    }
  }

  const runBridgeAction = async (action: 'verify' | 'publish' | 'unpublish' | 'verify_publish') => {
    if (!lastProblemBridge) return
    setBridgeBusy(action)
    try {
      let updated = lastProblemBridge
      if (action === 'verify_publish') {
        if (!updated.is_verified) {
          updated = await api.post(`/api/cmo/problems/${lastProblemBridge.id}/verify`) as ProblemBridge
        }
        updated = await api.post(`/api/cmo/problems/${lastProblemBridge.id}/publish`) as ProblemBridge
      } else {
        updated = await api.post(`/api/cmo/problems/${lastProblemBridge.id}/${action}`) as ProblemBridge
      }
      setLastProblemBridge(updated)
      await loadSnapshot()
      notify(action === 'verify' ? '已 Verify，尚未顯示在使用者端' : action === 'unpublish' ? '已取消使用者端發布' : '已 Publish，使用者端可見')
    } finally {
      setBridgeBusy('')
    }
  }

  const runSnapshotProblemAction = async (problem: ProblemSnapshot, action: 'verify_publish' | 'publish' | 'delete') => {
    if (action === 'delete') {
      const label = problem.display_layman || problem.display_name
      if (!window.confirm(`刪除這筆尚未發布的 Problem 草稿？\n${label}\n\n系統會保留 audit log，但此草稿會從 CMO queue 與 patient POV 移除。`)) return
    }
    setBridgeBusy(`${action}-${problem.id}`)
    try {
      if (action === 'delete') {
        await api.delete(`/api/cmo/problems/${problem.id}`)
        if (lastProblemBridge?.id === problem.id) setLastProblemBridge(null)
        await loadSnapshot()
        notify('已刪除 Problem 草稿')
        return
      }
      let updated: ProblemBridge = problem
      if (action === 'verify_publish' && !problem.is_verified) {
        updated = await api.post(`/api/cmo/problems/${problem.id}/verify`) as ProblemBridge
      }
      updated = await api.post(`/api/cmo/problems/${problem.id}/publish`) as ProblemBridge
      setLastProblemBridge(updated)
      await loadSnapshot()
      notify('已 Publish，使用者端可見')
    } finally {
      setBridgeBusy('')
    }
  }

  const createMedication = async () => {
    if (!medicationForm.drug_name.trim()) {
      notify('請先帶入或輸入藥物')
      return
    }
    setBusy('medication')
    try {
      await api.post(`/api/cmo/patients/${patientId}/medications`, {
        member_name: selectedMember,
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
      await loadSnapshot()
      notify('已新增藥物療程，請到 Patient POV 發布')
    } finally {
      setBusy('')
    }
  }

  const createReminder = async () => {
    if (!reminderForm.title.trim()) {
      notify('請先帶入或輸入回診/追蹤事項')
      return
    }
    setBusy('reminder')
    try {
      await api.post(`/api/cmo/patients/${patientId}/reminders`, {
        member_name: selectedMember,
        title: reminderForm.title.trim(),
        scheduled_date: reminderForm.scheduled_date || null,
        repeat_type: reminderForm.repeat_type,
        is_done: false,
        note: reminderForm.note.trim() || null,
      })
      setReminderForm(defaultReminderForm())
      await loadSnapshot()
      notify('已新增回診/追蹤')
    } finally {
      setBusy('')
    }
  }

  const createRecord = async () => {
    if (!recordForm.value1.trim()) {
      notify('請至少帶入或輸入數值 1')
      return
    }
    setBusy('record')
    try {
      await api.post(`/api/cmo/patients/${patientId}/records`, {
        member_name: selectedMember,
        record_type: recordForm.record_type,
        value1: recordForm.value1.trim(),
        value2: recordForm.value2.trim() || null,
        unit: recordForm.unit.trim() || null,
        recorded_at: recordForm.recorded_at || null,
        note: recordForm.note.trim() || `CMO structured entry${lastSource ? ` from ${lastSource}` : ''}`,
      })
      setRecordForm(defaultRecordForm())
      await loadSnapshot()
      notify('已新增量測/檢驗紀錄')
    } finally {
      setBusy('')
    }
  }

  const createRedZoneAllergy = async () => {
    if (!redZoneAllergyForm.substance.trim()) {
      notify('請先填入保命紅區過敏物質')
      return
    }
    setBusy('redzone-allergy')
    try {
      await api.post('/api/cmo/red-zone', cleanPayload({
        ...redZoneAllergyForm,
        patient_id: patientId,
        member_name: selectedMember,
        tier: ['severe', 'anaphylaxis'].includes(redZoneAllergyForm.severity) ? 1 : 2,
        source: redZoneAllergyForm.source || 'nhi_cmo_entry',
        note: redZoneAllergyForm.note || (lastSource ? `CMO quick entry from ${lastSource}` : ''),
      }))
      setRedZoneAllergyForm(defaultRedZoneAllergyForm())
      notify('已新增保命紅區過敏；User 保命紅區會同步更新')
    } finally {
      setBusy('')
    }
  }

  const createRedZoneImplant = async () => {
    if (!redZoneImplantForm.type.trim()) {
      notify('請先填入植入物類型')
      return
    }
    setBusy('redzone-implant')
    try {
      await api.post(`/api/cmo/patients/${patientId}/implants`, cleanPayload({
        ...redZoneImplantForm,
        source: 'nhi_cmo_entry',
        note: redZoneImplantForm.note || (lastSource ? `CMO quick entry from ${lastSource}` : ''),
      }))
      setRedZoneImplantForm(defaultRedZoneImplantForm())
      notify('已新增保命紅區植入物；User 保命紅區會同步更新')
    } finally {
      setBusy('')
    }
  }

  const saveRedZoneProfile = async () => {
    const egfr = redZoneProfileForm.egfr_value.trim()
    const egfrNumber = egfr ? Number(egfr) : undefined
    if (egfr && Number.isNaN(egfrNumber)) {
      notify('eGFR 需為數字')
      return
    }
    const isDialysis = triStateToBoolean(redZoneProfileForm.is_dialysis)
    const payload = cleanPayload({
      blood_type: redZoneProfileForm.blood_type.trim() || undefined,
      rh_factor: redZoneProfileForm.rh_factor.trim() || undefined,
      egfr_value: egfrNumber,
      egfr_date: redZoneProfileForm.egfr_date || undefined,
      ckd_stage: redZoneProfileForm.ckd_stage.trim() || undefined,
      is_dialysis: isDialysis,
      dialysis_modality: redZoneProfileForm.dialysis_modality.trim() || undefined,
      dialysis_schedule: redZoneProfileForm.dialysis_schedule.trim() || undefined,
      emergency_contact_name: redZoneProfileForm.emergency_contact_name.trim() || undefined,
      emergency_contact_relation: redZoneProfileForm.emergency_contact_relation.trim() || undefined,
      emergency_contact_phone: redZoneProfileForm.emergency_contact_phone.trim() || undefined,
    })
    if (Object.keys(payload).length === 0) {
      notify('請先帶入腎功能、血型或緊急聯絡資料')
      return
    }
    setBusy('redzone-profile')
    try {
      await api.put(`/api/cmo/patients/${patientId}/profile`, payload)
      setRedZoneProfileForm(defaultRedZoneProfileForm())
      notify('已儲存紅區基本/腎功能資料；User 保命紅區會同步更新')
    } finally {
      setBusy('')
    }
  }

  const saveRedZoneMri = async () => {
    const payload = cleanPayload({
      has_pacemaker: triStateToBoolean(redZoneMriForm.has_pacemaker),
      pacemaker_detail: redZoneMriForm.pacemaker_detail.trim() || undefined,
      has_metal_implant: triStateToBoolean(redZoneMriForm.has_metal_implant),
      metal_implant_detail: redZoneMriForm.metal_implant_detail.trim() || undefined,
      has_fixed_denture: triStateToBoolean(redZoneMriForm.has_fixed_denture),
      has_other: triStateToBoolean(redZoneMriForm.has_other),
      other_detail: redZoneMriForm.other_detail.trim() || undefined,
    })
    if (Object.keys(payload).length === 0) {
      notify('請先帶入 MRI 風險或安全問診資料')
      return
    }
    setBusy('redzone-mri')
    try {
      await api.put(`/api/cmo/patients/${patientId}/mri-safety`, payload)
      setRedZoneMriForm(defaultRedZoneMriForm())
      notify('已儲存 MRI 安全資料；User 保命紅區會同步更新')
    } finally {
      setBusy('')
    }
  }

  const toggleMedicationActive = async (medication: Medication) => {
    setBusy(`med-${medication.id}`)
    try {
      await api.patch(`/api/cmo/medications/${medication.id}`, {
        is_active: !medication.is_active,
        ended_on: medication.is_active ? todayInputDate() : null,
      })
      await loadSnapshot()
      notify(medication.is_active ? '已標記停用' : '已恢復 active')
    } finally {
      setBusy('')
    }
  }

  const panel = (
          <aside className={isInline ? 'cmo-fill-drawer cmo-fill-inline-panel' : 'cmo-drawer cmo-fill-drawer'} aria-label="病人端內容填寫面板">
            <div className="cmo-fill-head">
              <div>
                <div className="cmo-kpi-label">Patient-facing content panel</div>
                <h2 className="cmo-section-title" style={{ marginTop: 5 }}>{isInline ? '右側填寫面板' : '病人端內容填寫'}</h2>
                <div className="cmo-subtitle">固定面板，可一邊閱讀 NHI / 文件 / Draft，一邊帶入結構化欄位。</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" className="cmo-button" disabled={undoStack.length === 0} onClick={undoLastImport}>Undo</button>
                {!isInline && <button type="button" className="cmo-button" onClick={() => setOpen(false)}>關閉</button>}
              </div>
            </div>

            {flash && <div className="cmo-card cmo-section" style={{ margin: '12px 0', background: '#e7f4ec', borderColor: '#cfe8da', color: '#2e8b57' }}>{flash}</div>}

            <nav className="cmo-fill-tabs" aria-label="病人端內容填寫分類">
              {FILL_PANEL_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={activePanel === option.key ? 'active' : ''}
                  onClick={() => setActivePanel(option.key)}
                >
                  <span>{option.label}</span>
                  <small>{option.key === 'source' && isInline ? '左側點選即時帶入' : option.key === 'source' && importQueue.length > 0 ? `${importQueue.length} 筆待套用` : panelReady[option.key] ? '已帶入' : option.subtitle}</small>
                </button>
              ))}
            </nav>

            <div className={isInline ? 'cmo-fill-inline-body' : undefined}>
            <div className="cmo-fill-context">
              <div>
                <div className="cmo-kpi-label">目前來源</div>
                <strong>{lastSource || contextLabel || '尚未選取來源'}</strong>
              </div>
              <div>
                <div className="cmo-kpi-label">目前處理成員</div>
                <div className="cmo-chipbar" style={{ marginTop: 6 }}>
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
              </div>
              <div className="cmo-subtitle">資料只會先進入 CMO 編輯區；Problem、Condition、Medication、Reminder、Record 都會寫入目前成員。紅區新增/儲存會寫入 audit 並同步到 User 保命紅區；完整 verify/revert 可到紅區頁處理。</div>
            </div>

            {lastProblemBridge && (
              <PatientBridgePanel
                patientId={patientId}
                problem={lastProblemBridge}
                busy={bridgeBusy}
                onAction={runBridgeAction}
              />
            )}

            <PendingPatientSurfacePanel
              patientId={patientId}
              problems={pendingPatientProblems}
              busy={bridgeBusy}
              onAction={runSnapshotProblemAction}
            />

            {activePanel === 'source' && (
              <section className={`cmo-card cmo-section ${isInline ? 'cmo-fill-source-panel' : ''}`}>
                <div className="cmo-title-row" style={{ marginBottom: 10 }}>
                  <div>
                    <h3 className="cmo-section-title" style={{ margin: 0 }}>來源文字帶入</h3>
                    <div className="cmo-subtitle">{isInline ? '點左側 NHI 資料列，右側會即時帶入對應分頁。' : '先連續加入多筆來源，再逐筆套用到對應分頁確認。'}</div>
                  </div>
                  <span className="cmo-badge" style={{ background: '#e7f3f5', color: '#33596a' }}>{lastSource || contextLabel || 'source'}</span>
                </div>
                {!isInline && <div className="cmo-fill-queue">
                  <div className="cmo-title-row" style={{ marginBottom: 8 }}>
                    <div>
                      <div className="cmo-kpi-label">待處理整理籃</div>
                      <strong>{importQueue.length} 筆待套用</strong>
                    </div>
                    {importQueue.length > 0 && (
                      <button type="button" className="cmo-button" onClick={() => setImportQueue([])}>清空</button>
                    )}
                  </div>
                  {importQueue.length === 0 ? (
                    <div className="cmo-muted">尚未加入來源資料。</div>
                  ) : (
                    <div className="cmo-list">
                      {importQueue.map((item) => {
                        const panelLabel = FILL_PANEL_OPTIONS.find((option) => option.key === item.panel)?.label ?? '來源'
                        return (
                          <div key={item.id} className="cmo-list-item cmo-fill-queue-item">
                            <div>
                              <span className="cmo-badge" style={{ background: '#eef2f5', color: '#45596a' }}>{panelLabel}</span>
                              <strong>{item.summary}</strong>
                              <div className="cmo-subtitle">{item.source}</div>
                            </div>
                            <div className="cmo-fill-queue-actions">
                              <button type="button" className="cmo-button primary" onClick={() => applyQueueItem(item)}>套用</button>
                              <button type="button" className="cmo-button" onClick={() => setImportQueue((prev) => prev.filter((queued) => queued.id !== item.id))}>移除</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>}
                <div className="cmo-fill-step-grid">
                  <div className="cmo-list-item">
                    <div className="cmo-kpi-label">Step 1</div>
                    <strong>{isInline ? '點左側資料列' : '先在原始資料頁加入整理籃'}</strong>
                    <div className="cmo-subtitle">{isInline ? '先點右側要填的分頁，再按左側「帶到右側」。' : 'NHI row 可連續按「加入整理籃」，不會強制打開面板。'}</div>
                  </div>
                  <div className="cmo-list-item">
                    <div className="cmo-kpi-label">Step 2</div>
                    <strong>{isInline ? '必要時按 Undo' : '在整理籃逐筆套用確認'}</strong>
                    <div className="cmo-subtitle">藥物進藥物分頁，檢驗進紀錄分頁，診斷進健康摘要或慢性病。</div>
                  </div>
                </div>
                <Field label="選取文字要帶入的欄位">
                  <select className="cmo-select" value={activeTarget} onChange={(event) => setActiveTarget(event.target.value as FillTarget)}>
                    {TARGET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </Field>
                <button type="button" className="cmo-button primary" style={{ width: '100%' }} onClick={importSelection}>
                  帶入目前選取文字
                </button>
                <div className="cmo-subtitle">手動選字只用於 parser 沒抓到的例外欄位；常規情境建議用 NHI / Intake row 上的整理籃按鈕。</div>
              </section>
            )}

            {activePanel === 'problem' && (
              <section className="cmo-card cmo-section">
                <PanelIntro title="醫師健康摘要 · Problem" subtitle="只整理病人端會看到的 Problem 摘要；建立後仍需 verify / publish。" />
                <Field label="診斷快搜 · 選一次自動帶入白話名稱、ICD-10 與 Tier">
                  <DiagnosisSearch onSelect={pickDiagnosisForProblem} />
                </Field>
                <div className="cmo-chipbar" style={{ marginBottom: 10 }}>
                  {PROBLEM_TEMPLATES.map((template) => (
                    <button key={template.label} type="button" className="cmo-chip" onClick={() => setProblemForm({ ...problemForm, ...template, is_suspected: template.status === 'following' })}>{template.label}</button>
                  ))}
                </div>
                <Field label="Problem name"><input className="cmo-input" value={problemForm.display_name} onChange={(event) => setProblemForm({ ...problemForm, display_name: event.target.value })} /></Field>
                <Field label="病人端白話名稱"><input className="cmo-input" value={problemForm.display_layman} onChange={(event) => setProblemForm({ ...problemForm, display_layman: event.target.value })} /></Field>
                {problemIcdSuggestions.length > 0 && (
                  <div style={{ marginBottom: 9 }}>
                    <div className="cmo-kpi-label" style={{ marginBottom: 5 }}>可能對應的 ICD-10（點選補齊）</div>
                    <div className="cmo-chipbar">
                      {problemIcdSuggestions.map((entry) => (
                        <button key={entry.icd10} type="button" className="cmo-chip" onClick={() => pickDiagnosisForProblem(entry)}>
                          {entry.name_zh} · {entry.icd10}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="cmo-field-grid">
                  <Field label="ICD-10"><input className="cmo-input" value={problemForm.icd10_code} onChange={(event) => setProblemForm({ ...problemForm, icd10_code: event.target.value })} /></Field>
                  <Field label="起始日期"><input className="cmo-input" type="date" value={problemForm.onset_date} onChange={(event) => setProblemForm({ ...problemForm, onset_date: event.target.value })} /></Field>
                  <Field label="狀態">
                    <select className="cmo-select" value={problemForm.status} onChange={(event) => setProblemForm({ ...problemForm, status: event.target.value as ProblemStatus })}>
                      <option value="underlying">Underlying</option>
                      <option value="following">Following</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </Field>
                  <Field label="Tier">
                    <select className="cmo-select" value={problemForm.tier} onChange={(event) => setProblemForm({ ...problemForm, tier: Number(event.target.value) as 1 | 2 | 3 })}>
                      <option value={1}>Tier 1</option>
                      <option value={2}>Tier 2</option>
                      <option value={3}>Tier 3</option>
                    </select>
                  </Field>
                </div>
                <NoteBox value={problemForm.cmo_note} onChange={(value) => setProblemForm({ ...problemForm, cmo_note: value })} />
                <button type="button" className="cmo-button primary" disabled={busy === 'problem'} onClick={createProblem}>建立 Problem</button>
              </section>
            )}

            {activePanel === 'condition' && (
              <section className="cmo-card cmo-section">
                <PanelIntro title="慢性病管理 · Condition" subtitle="用於補齊疾病史或建立 Problem candidate；建立後需到 Patient POV 發布。" />
                <Field label="診斷快搜 · 選一次自動帶入名稱與 ICD-10">
                  <DiagnosisSearch onSelect={pickDiagnosisForCondition} />
                </Field>
                <Field label="疾病/病史名稱"><input className="cmo-input" value={conditionForm.display_name} onChange={(event) => setConditionForm({ ...conditionForm, display_name: event.target.value })} /></Field>
                <div className="cmo-field-grid">
                  <Field label="ICD-10"><input className="cmo-input" value={conditionForm.icd10_code} onChange={(event) => setConditionForm({ ...conditionForm, icd10_code: event.target.value })} /></Field>
                  <Field label="狀態">
                    <select className="cmo-select" value={conditionForm.status} onChange={(event) => setConditionForm({ ...conditionForm, status: event.target.value as 'active' | 'resolved' })}>
                      <option value="active">Active</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </Field>
                </div>
                <NoteBox value={conditionForm.note} onChange={(value) => setConditionForm({ ...conditionForm, note: value })} />
                <label className="cmo-chip" style={{ marginBottom: 10 }}>
                  <input type="checkbox" checked={conditionForm.sync_problem} onChange={(event) => setConditionForm({ ...conditionForm, sync_problem: event.target.checked })} />
                  同步建立 Problem candidate
                </label>
                <button type="button" className="cmo-button primary" disabled={busy === 'condition'} onClick={createCondition}>新增疾病史</button>
              </section>
            )}

            {activePanel === 'medication' && (
              <section className="cmo-card cmo-section">
                <PanelIntro title="藥物追蹤 · Medication" subtitle="用 NHI / 藥袋資料帶入藥名與劑量；新增後需到 Patient POV 發布，才會進入使用者端用藥頁。" />
                <Field label="藥物快搜 · 選一次自動帶入藥名、劑量與頻率">
                  <DrugSearch onSelect={pickDrug} />
                </Field>
                <div className="cmo-chipbar" style={{ marginBottom: 10 }}>
                  {MEDICATION_TEMPLATES.map((template) => (
                    <button key={template.label} type="button" className="cmo-chip" onClick={() => setMedicationForm({ ...medicationForm, ...template })}>{template.label}</button>
                  ))}
                </div>
                <Field label="藥名"><input className="cmo-input" value={medicationForm.drug_name} onChange={(event) => setMedicationForm({ ...medicationForm, drug_name: event.target.value })} /></Field>
                <div className="cmo-field-grid">
                  <Field label="劑量">
                    <input className="cmo-input" value={medicationForm.dose} onChange={(event) => setMedicationForm({ ...medicationForm, dose: event.target.value })} />
                    {activeDrugEntry && (
                      <QuickPick
                        options={activeDrugEntry.doses.map((dose) => ({ label: dose }))}
                        value={medicationForm.dose}
                        onPick={(next) => setMedicationForm({ ...medicationForm, dose: next })}
                        ariaLabel="常用劑量"
                      />
                    )}
                  </Field>
                  <Field label="頻率">
                    <input className="cmo-input" value={medicationForm.frequency} onChange={(event) => setMedicationForm({ ...medicationForm, frequency: event.target.value })} />
                    <QuickPick
                      options={(activeDrugEntry?.frequencies ?? MED_FREQUENCY_OPTIONS.map((option) => option.label)).map((freq) => ({ label: freq }))}
                      value={medicationForm.frequency}
                      onPick={(next) => setMedicationForm({ ...medicationForm, frequency: next })}
                      ariaLabel="常用頻次"
                    />
                  </Field>
                  <Field label="類型">
                    <select className="cmo-select" value={medicationForm.intent} onChange={(event) => setMedicationForm({ ...medicationForm, intent: event.target.value as MedicationForm['intent'] })}>
                      <option value="chronic">慢性處方</option>
                      <option value="acute">固定療程</option>
                      <option value="prn">PRN</option>
                    </select>
                  </Field>
                  <Field label="開始"><input className="cmo-input" type="date" value={medicationForm.started_on} onChange={(event) => setMedicationForm({ ...medicationForm, started_on: event.target.value })} /></Field>
                </div>
                <NoteBox value={medicationForm.note} onChange={(value) => setMedicationForm({ ...medicationForm, note: value })} />
                <button type="button" className="cmo-button primary" disabled={busy === 'medication'} onClick={createMedication}>新增藥物療程</button>
                <MiniList title="目前 active medication" empty="沒有 active medication">
                  {activeMeds.slice(0, 5).map((medication) => (
                    <div className="cmo-list-item cmo-row" key={medication.id}>
                      <div><strong>{medication.drug_name}</strong><div className="cmo-subtitle">{[medication.dose, medication.frequency, medication.intent].filter(Boolean).join(' · ')}</div></div>
                      <button type="button" className="cmo-button" disabled={busy === `med-${medication.id}`} onClick={() => toggleMedicationActive(medication)}>停用</button>
                    </div>
                  ))}
                </MiniList>
              </section>
            )}

            {activePanel === 'followup' && (
              <section className="cmo-card cmo-section">
                <PanelIntro title="回診紀錄 · Follow-up" subtitle="把 encounter 或報告中的追蹤日期整理成可處理事項，不只是通知。" />
                <div className="cmo-chipbar" style={{ marginBottom: 10 }}>
                  {FOLLOWUP_TEMPLATES.map((template) => (
                    <button key={template.label} type="button" className="cmo-chip" onClick={() => setReminderForm({ ...reminderForm, ...template })}>{template.label}</button>
                  ))}
                </div>
                <Field label="事項"><input className="cmo-input" value={reminderForm.title} onChange={(event) => setReminderForm({ ...reminderForm, title: event.target.value })} /></Field>
                <div className="cmo-field-grid">
                  <Field label="日期"><input className="cmo-input" type="date" value={reminderForm.scheduled_date} onChange={(event) => setReminderForm({ ...reminderForm, scheduled_date: event.target.value })} /></Field>
                  <Field label="重複">
                    <select className="cmo-select" value={reminderForm.repeat_type} onChange={(event) => setReminderForm({ ...reminderForm, repeat_type: event.target.value as ReminderForm['repeat_type'] })}>
                      <option value="none">不重複</option>
                      <option value="monthly">每月</option>
                      <option value="yearly">每年</option>
                    </select>
                  </Field>
                </div>
                <NoteBox value={reminderForm.note} onChange={(value) => setReminderForm({ ...reminderForm, note: value })} />
                <button type="button" className="cmo-button primary" disabled={busy === 'reminder'} onClick={createReminder}>新增回診/追蹤</button>
                <MiniList title="待處理回診/追蹤" empty="沒有待處理回診">
                  {upcoming.slice(0, 4).map((reminder) => (
                    <div className="cmo-list-item" key={reminder.id}>
                      <strong>{reminder.title}</strong>
                      <div className="cmo-subtitle">{formatDate(reminder.scheduled_date)} · {reminder.note ?? ''}</div>
                    </div>
                  ))}
                </MiniList>
              </section>
            )}

            {activePanel === 'record' && (
              <section className="cmo-card cmo-section">
                <PanelIntro title="量測/檢驗摘要 · Record" subtitle="用於 CMO 已確認的量測與檢驗值；未確認 OCR 不應直接進病人端。" />
                <div className="cmo-field-grid">
                  <Field label="類型">
                    <select className="cmo-select" value={recordForm.record_type} onChange={(event) => {
                      const option = RECORD_TYPE_OPTIONS.find((item) => item.value === event.target.value)
                      setRecordForm({ ...recordForm, record_type: event.target.value, unit: option?.unit ?? recordForm.unit })
                    }}>
                      {RECORD_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </Field>
                  <Field label="數值 1"><input className="cmo-input" value={recordForm.value1} onChange={(event) => setRecordForm({ ...recordForm, value1: event.target.value })} /></Field>
                  <Field label="數值 2"><input className="cmo-input" value={recordForm.value2} onChange={(event) => setRecordForm({ ...recordForm, value2: event.target.value })} /></Field>
                  <Field label="單位"><input className="cmo-input" value={recordForm.unit} onChange={(event) => setRecordForm({ ...recordForm, unit: event.target.value })} /></Field>
                </div>
                <Field label="來源/備註"><input className="cmo-input" value={recordForm.note} onChange={(event) => setRecordForm({ ...recordForm, note: event.target.value })} placeholder="例：NHI lab row / PDF p2" /></Field>
                <button type="button" className="cmo-button primary" disabled={busy === 'record'} onClick={createRecord}>新增健康紀錄</button>
              </section>
            )}

            {activePanel === 'redzone' && (
              <section className="cmo-card cmo-section">
                <PanelIntro title="保命紅區 · Quick edit" subtitle="NHI 審閱中可直接整理過敏、植入物、腎功能與 MRI 安全資料；儲存後會寫入紅區 audit 並同步到使用者端保命紅區。" />
                <div className="cmo-chipbar" style={{ marginBottom: 12 }}>
                  {([
                    ['allergy', '過敏/禁忌'],
                    ['implant', '植入物'],
                    ['profile', '腎功能/聯絡'],
                    ['mri', 'MRI 安全'],
                  ] as Array<[RedZoneSection, string]>).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`cmo-chip ${redZoneSection === key ? 'active' : ''}`}
                      onClick={() => setRedZoneSection(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {redZoneSection === 'allergy' && (
                  <>
                    <div className="cmo-field-grid">
                      <Field label="類型">
                        <select className="cmo-select" value={redZoneAllergyForm.category} onChange={(event) => setRedZoneAllergyForm({ ...redZoneAllergyForm, category: event.target.value })}>
                          <option value="drug">藥物</option>
                          <option value="contrast_agent">顯影劑</option>
                          <option value="food">食物</option>
                          <option value="environment">環境</option>
                          <option value="other">其他</option>
                        </select>
                      </Field>
                      <Field label="物質"><input className="cmo-input" value={redZoneAllergyForm.substance} onChange={(event) => setRedZoneAllergyForm({ ...redZoneAllergyForm, substance: event.target.value })} placeholder="Penicillin / Iodine" /></Field>
                      <Field label="嚴重度">
                        <select className="cmo-select" value={redZoneAllergyForm.severity} onChange={(event) => setRedZoneAllergyForm({ ...redZoneAllergyForm, severity: event.target.value })}>
                          <option value="mild">輕微</option>
                          <option value="moderate">中等</option>
                          <option value="severe">嚴重</option>
                          <option value="anaphylaxis">過敏性休克</option>
                        </select>
                      </Field>
                      <Field label="狀態">
                        <select className="cmo-select" value={redZoneAllergyForm.status} onChange={(event) => setRedZoneAllergyForm({ ...redZoneAllergyForm, status: event.target.value })}>
                          <option value="confirmed">確認</option>
                          <option value="suspected">疑似</option>
                          <option value="not_sure">不確定</option>
                          <option value="ruled_out">已排除</option>
                        </select>
                      </Field>
                      <Field label="反應"><input className="cmo-input" value={redZoneAllergyForm.reaction} onChange={(event) => setRedZoneAllergyForm({ ...redZoneAllergyForm, reaction: event.target.value })} placeholder="皮疹、呼吸困難、休克" /></Field>
                      <Field label="發生日期"><input className="cmo-input" type="date" value={redZoneAllergyForm.onset_date} onChange={(event) => setRedZoneAllergyForm({ ...redZoneAllergyForm, onset_date: event.target.value })} /></Field>
                    </div>
                    <NoteBox value={redZoneAllergyForm.note} onChange={(value) => setRedZoneAllergyForm({ ...redZoneAllergyForm, note: value })} />
                    <button type="button" className="cmo-button primary" disabled={busy === 'redzone-allergy' || !redZoneAllergyForm.substance.trim()} onClick={createRedZoneAllergy}>新增保命紅區過敏</button>
                  </>
                )}

                {redZoneSection === 'implant' && (
                  <>
                    <div className="cmo-field-grid">
                      <Field label="類型"><input className="cmo-input" value={redZoneImplantForm.type} onChange={(event) => setRedZoneImplantForm({ ...redZoneImplantForm, type: event.target.value })} placeholder="支架 / Pacemaker / Port-A" /></Field>
                      <Field label="型號"><input className="cmo-input" value={redZoneImplantForm.model} onChange={(event) => setRedZoneImplantForm({ ...redZoneImplantForm, model: event.target.value })} /></Field>
                      <Field label="子類型"><input className="cmo-input" value={redZoneImplantForm.subtype} onChange={(event) => setRedZoneImplantForm({ ...redZoneImplantForm, subtype: event.target.value })} /></Field>
                      <Field label="部位"><input className="cmo-input" value={redZoneImplantForm.body_site} onChange={(event) => setRedZoneImplantForm({ ...redZoneImplantForm, body_site: event.target.value })} /></Field>
                      <Field label="日期"><input className="cmo-input" type="date" value={redZoneImplantForm.implant_date} onChange={(event) => setRedZoneImplantForm({ ...redZoneImplantForm, implant_date: event.target.value })} /></Field>
                      <Field label="醫院"><input className="cmo-input" value={redZoneImplantForm.hospital} onChange={(event) => setRedZoneImplantForm({ ...redZoneImplantForm, hospital: event.target.value })} /></Field>
                    </div>
                    <NoteBox value={redZoneImplantForm.note} onChange={(value) => setRedZoneImplantForm({ ...redZoneImplantForm, note: value })} />
                    <button type="button" className="cmo-button primary" disabled={busy === 'redzone-implant' || !redZoneImplantForm.type.trim()} onClick={createRedZoneImplant}>新增保命紅區植入物</button>
                  </>
                )}

                {redZoneSection === 'profile' && (
                  <>
                    <div className="cmo-field-grid">
                      <Field label="eGFR"><input className="cmo-input" inputMode="decimal" value={redZoneProfileForm.egfr_value} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, egfr_value: numberText(event.target.value) })} placeholder="58" /></Field>
                      <Field label="eGFR 日期"><input className="cmo-input" type="date" value={redZoneProfileForm.egfr_date} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, egfr_date: event.target.value })} /></Field>
                      <Field label="CKD Stage"><input className="cmo-input" value={redZoneProfileForm.ckd_stage} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, ckd_stage: event.target.value })} /></Field>
                      <Field label="透析">
                        <select className="cmo-select" value={redZoneProfileForm.is_dialysis} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, is_dialysis: event.target.value as TriState })}>
                          <option value="">未知/不改</option>
                          <option value="true">是</option>
                          <option value="false">否</option>
                        </select>
                      </Field>
                      <Field label="血型"><input className="cmo-input" value={redZoneProfileForm.blood_type} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, blood_type: event.target.value.toUpperCase() })} placeholder="A / B / AB / O" /></Field>
                      <Field label="Rh"><input className="cmo-input" value={redZoneProfileForm.rh_factor} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, rh_factor: event.target.value })} placeholder="+ / -" /></Field>
                      <Field label="緊急聯絡人"><input className="cmo-input" value={redZoneProfileForm.emergency_contact_name} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, emergency_contact_name: event.target.value })} /></Field>
                      <Field label="關係"><input className="cmo-input" value={redZoneProfileForm.emergency_contact_relation} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, emergency_contact_relation: event.target.value })} /></Field>
                      <Field label="電話"><input className="cmo-input" value={redZoneProfileForm.emergency_contact_phone} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, emergency_contact_phone: event.target.value })} /></Field>
                    </div>
                    <div className="cmo-field-grid">
                      <Field label="透析方式"><input className="cmo-input" value={redZoneProfileForm.dialysis_modality} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, dialysis_modality: event.target.value })} /></Field>
                      <Field label="透析時間"><input className="cmo-input" value={redZoneProfileForm.dialysis_schedule} onChange={(event) => setRedZoneProfileForm({ ...redZoneProfileForm, dialysis_schedule: event.target.value })} /></Field>
                    </div>
                    <button type="button" className="cmo-button primary" disabled={busy === 'redzone-profile'} onClick={saveRedZoneProfile}>儲存紅區基本/腎功能</button>
                  </>
                )}

                {redZoneSection === 'mri' && (
                  <>
                    <div className="cmo-field-grid">
                      {([
                        ['has_pacemaker', '心律調節器'],
                        ['has_metal_implant', '金屬植入物'],
                        ['has_fixed_denture', '固定假牙'],
                        ['has_other', '其他 MRI 風險'],
                      ] as Array<[keyof RedZoneMriForm, string]>).map(([key, label]) => (
                        <Field key={key} label={label}>
                          <select className="cmo-select" value={String(redZoneMriForm[key])} onChange={(event) => setRedZoneMriForm({ ...redZoneMriForm, [key]: event.target.value as TriState })}>
                            <option value="">未知/不改</option>
                            <option value="true">是</option>
                            <option value="false">否</option>
                          </select>
                        </Field>
                      ))}
                      <Field label="節律器細節"><input className="cmo-input" value={redZoneMriForm.pacemaker_detail} onChange={(event) => setRedZoneMriForm({ ...redZoneMriForm, pacemaker_detail: event.target.value })} /></Field>
                      <Field label="金屬植入物細節"><input className="cmo-input" value={redZoneMriForm.metal_implant_detail} onChange={(event) => setRedZoneMriForm({ ...redZoneMriForm, metal_implant_detail: event.target.value })} /></Field>
                    </div>
                    <NoteBox value={redZoneMriForm.other_detail} onChange={(value) => setRedZoneMriForm({ ...redZoneMriForm, has_other: value.trim() ? 'true' : redZoneMriForm.has_other, other_detail: value })} />
                    <button type="button" className="cmo-button primary" disabled={busy === 'redzone-mri'} onClick={saveRedZoneMri}>儲存 MRI 安全資料</button>
                  </>
                )}

                <div className="cmo-fill-step-grid" style={{ marginTop: 12 }}>
                  <div className="cmo-list-item">
                    <div className="cmo-kpi-label">Patient visible</div>
                    <strong>紅區會同步到 User 保命紅區</strong>
                    <div className="cmo-subtitle">新增或儲存後仍保留 CMO audit；必要時到完整紅區頁做 verify/revert。</div>
                  </div>
                  <div className="cmo-list-item">
                    <div className="cmo-kpi-label">Full red-zone</div>
                    <Link className="cmo-button" href={`/cmo/patients/${patientId}/redzone`}>開完整紅區頁</Link>
                  </div>
                </div>
              </section>
            )}
            </div>
          </aside>
  )

  if (isInline) return panel

  return (
    <>
      {!open && toast && <div className="cmo-fill-toast">{toast}</div>}
      <button type="button" className="cmo-fill-fab" onClick={() => setOpen(true)}>
        病人端內容填寫
        {importQueue.length > 0 && <span>{importQueue.length}</span>}
      </button>
      {open && (
        <>
          <div className="cmo-drawer-backdrop" onClick={() => setOpen(false)} />
          {panel}
        </>
      )}
    </>
  )
}

function PatientBridgePanel({
  patientId,
  problem,
  busy,
  onAction,
}: {
  patientId: string
  problem: ProblemBridge
  busy: string
  onAction: (action: 'verify' | 'publish' | 'unpublish' | 'verify_publish') => void
}) {
  return (
    <section className="cmo-card cmo-section cmo-patient-bridge">
      <div className="cmo-title-row" style={{ marginBottom: 10 }}>
        <div>
          <div className="cmo-kpi-label">Patient surface bridge</div>
          <strong>{problem.display_layman || problem.display_name}</strong>
          <div className="cmo-subtitle">建立後先留在 CMO gate；Verify + Publish 後才會出現在使用者端醫師健康摘要。</div>
        </div>
        <span className="cmo-badge" style={{
          background: problem.is_published ? '#e7f3f5' : problem.is_verified ? '#e7f4ec' : '#fdf1e0',
          color: problem.is_published ? '#33596a' : problem.is_verified ? '#2e8b57' : '#b06a10',
        }}>
          {problem.is_published ? 'Patient visible' : problem.is_verified ? 'Verified' : 'Needs verify'}
        </span>
      </div>
      <div className="cmo-fill-bridge-actions">
        {!problem.is_published && (
          <button type="button" className="cmo-button primary" disabled={Boolean(busy)} onClick={() => onAction('verify_publish')}>
            {busy === 'verify_publish' ? 'Publishing...' : 'Verify + Publish 到使用者端'}
          </button>
        )}
        {!problem.is_verified && (
          <button type="button" className="cmo-button" disabled={Boolean(busy)} onClick={() => onAction('verify')}>
            {busy === 'verify' ? 'Verifying...' : 'Verify'}
          </button>
        )}
        {problem.is_verified && !problem.is_published && (
          <button type="button" className="cmo-button primary" disabled={Boolean(busy)} onClick={() => onAction('publish')}>
            {busy === 'publish' ? 'Publishing...' : 'Publish 到使用者端'}
          </button>
        )}
        {problem.is_published && (
          <button type="button" className="cmo-button danger" disabled={Boolean(busy)} onClick={() => onAction('unpublish')}>
            {busy === 'unpublish' ? 'Unpublishing...' : '取消發布'}
          </button>
        )}
        <Link className="cmo-button" href={`/cmo/patients/${patientId}#publish-readiness`}>回 Patient POV</Link>
        <Link className="cmo-button" href={`/cmo/patients/${patientId}#patient-facing-preview`}>預覽使用者端</Link>
      </div>
    </section>
  )
}

function PendingPatientSurfacePanel({
  patientId,
  problems,
  busy,
  onAction,
}: {
  patientId: string
  problems: ProblemSnapshot[]
  busy: string
  onAction: (problem: ProblemSnapshot, action: 'verify_publish' | 'publish' | 'delete') => void
}) {
  if (problems.length === 0) return null

  return (
    <section className="cmo-card cmo-section cmo-patient-bridge">
      <div className="cmo-title-row" style={{ marginBottom: 10 }}>
        <div>
          <div className="cmo-kpi-label">Pending patient publish</div>
          <strong>{problems.length} 個 Problem 尚未顯示在使用者端</strong>
          <div className="cmo-subtitle">建立與 Verify 只代表 CMO 已整理；Publish 後才會出現在使用者端醫師健康摘要。</div>
        </div>
        <Link className="cmo-button" href={`/cmo/patients/${patientId}#publish-readiness`}>開啟 readiness</Link>
      </div>
      <div className="cmo-list">
        {problems.slice(0, 6).map((problem) => {
          const action = problem.is_verified ? 'publish' : 'verify_publish'
          const isBusy = busy === `${action}-${problem.id}`
          const deleteBusy = busy === `delete-${problem.id}`
          return (
            <div key={problem.id} className="cmo-list-item cmo-row">
              <div>
                <strong>{problem.display_layman || problem.display_name}</strong>
                <div className="cmo-subtitle">
                  {problem.is_verified ? '已 Verify，尚未 Publish 到使用者端' : '尚未 Verify；可一鍵 Verify + Publish'}
                </div>
              </div>
              <div className="cmo-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" className="cmo-button primary" disabled={Boolean(busy)} onClick={() => onAction(problem, action)}>
                  {isBusy ? 'Publishing...' : problem.is_verified ? 'Publish 到使用者端' : 'Verify + Publish'}
                </button>
                <button type="button" className="cmo-button danger" disabled={Boolean(busy)} onClick={() => onAction(problem, 'delete')} title="只刪除未發布草稿；已發布資料需先取消發布。">
                  {deleteBusy ? 'Deleting...' : '刪除草稿'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {problems.length > 6 && <div className="cmo-subtitle" style={{ marginTop: 8 }}>另有 {problems.length - 6} 個未發布 Problem，請到 Patient POV readiness 檢查。</div>}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 9 }}>
      <div className="cmo-kpi-label" style={{ marginBottom: 5 }}>{label}</div>
      {children}
    </label>
  )
}

function PanelIntro({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="cmo-fill-panel-intro">
      <div>
        <h3 className="cmo-section-title">{title}</h3>
        <div className="cmo-subtitle">{subtitle}</div>
      </div>
      <span className="cmo-badge" style={{ background: '#f6f9fa', color: '#45596a' }}>CMO confirm</span>
    </div>
  )
}

function NoteBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ margin: '8px 0 10px' }}>
      <div className="cmo-chipbar" style={{ marginBottom: 8 }}>
        {NOTE_TEMPLATES.map((note) => (
          <button key={note} type="button" className="cmo-chip" onClick={() => onChange(value ? `${value}\n${note}` : note)}>{note}</button>
        ))}
      </div>
      <textarea className="cmo-textarea" rows={2} value={value} onChange={(event) => onChange(event.target.value)} placeholder="CMO-only note 或 source trace；病人端不直接顯示。" />
    </div>
  )
}

function MiniList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <div style={{ marginTop: 12 }}>
      <div className="cmo-kpi-label" style={{ marginBottom: 8 }}>{title}</div>
      <div className="cmo-list">{hasChildren ? children : <div className="cmo-muted">{empty}</div>}</div>
    </div>
  )
}
