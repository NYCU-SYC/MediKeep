'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { normalizeMemberName, uniqueMemberNames } from '@/lib/members'

type ProblemStatus = 'underlying' | 'following' | 'resolved'
type FillPanelKey = 'source' | 'problem' | 'condition' | 'medication' | 'followup' | 'record'
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
}

type FillEventDetail = {
  text?: string
  target?: FillTarget
  patch?: FillPatch
  source?: string
  open?: boolean
  queueOnly?: boolean
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
]

const FILL_PANEL_OPTIONS: Array<{ key: FillPanelKey; label: string; subtitle: string }> = [
  { key: 'source', label: '來源帶入', subtitle: '選取文字或接收 NHI/Draft' },
  { key: 'problem', label: '健康摘要', subtitle: 'Problem 與病人白話摘要' },
  { key: 'condition', label: '慢性病', subtitle: '疾病史與 Problem candidate' },
  { key: 'medication', label: '藥物', subtitle: '藥名、劑量、active/stopped' },
  { key: 'followup', label: '回診', subtitle: '回診與追蹤事項' },
  { key: 'record', label: '紀錄', subtitle: '量測與檢驗值' },
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
  const match = value.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/)
  if (!match) return value.slice(0, 10)
  return match[0].replace(/\//g, '-').split('-').map((part, index) => index === 0 ? part : part.padStart(2, '0')).join('-')
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
  return 'record'
}

function panelForPatch(patch?: FillPatch): FillPanelKey | null {
  if (!patch) return null
  if (patch.problem) return 'problem'
  if (patch.condition) return 'condition'
  if (patch.medication) return 'medication'
  if (patch.reminder) return 'followup'
  if (patch.record) return 'record'
  return null
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
  const [selectedMember, setSelectedMember] = useState('本人')

  const memberOptions = useMemo(() => {
    const names = uniqueMemberNames(
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
    () => snapshot?.problems.filter((problem) => !problem.is_published) ?? [],
    [snapshot],
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
  }), [activePanel, activeTarget, conditionForm, lastSource, medicationForm, problemForm, recordForm, reminderForm])
  const currentEntryStateRef = useRef(currentEntryState)
  const panelReady = useMemo<Record<FillPanelKey, boolean>>(() => ({
    source: Boolean(lastSource),
    problem: Boolean(problemForm.display_name.trim() || problemForm.display_layman.trim()),
    condition: Boolean(conditionForm.display_name.trim()),
    medication: Boolean(medicationForm.drug_name.trim()),
    followup: Boolean(reminderForm.title.trim()),
    record: Boolean(recordForm.value1.trim()),
  }), [conditionForm.display_name, lastSource, medicationForm.drug_name, problemForm.display_layman, problemForm.display_name, recordForm.value1, reminderForm.title])

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
    if (!memberOptions.includes(selectedMember)) setSelectedMember(memberOptions[0] ?? '本人')
  }, [memberOptions, selectedMember])

  useEffect(() => {
    currentEntryStateRef.current = currentEntryState
  }, [currentEntryState])

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
  }, [])

  const applyPatch = useCallback((patch?: FillPatch) => {
    if (!patch) return
    if (patch.problem) setProblemForm((prev) => ({ ...prev, ...patch.problem }))
    if (patch.condition) setConditionForm((prev) => ({ ...prev, ...patch.condition }))
    if (patch.medication) setMedicationForm((prev) => ({ ...prev, ...patch.medication }))
    if (patch.reminder) setReminderForm((prev) => ({ ...prev, ...patch.reminder }))
    if (patch.record) setRecordForm((prev) => ({ ...prev, ...patch.record }))
  }, [])

  const restoreEntryState = useCallback((state: EntryState) => {
    setActivePanel(state.activePanel)
    setActiveTarget(state.activeTarget)
    setLastSource(state.lastSource)
    setProblemForm(state.problemForm)
    setConditionForm(state.conditionForm)
    setMedicationForm(state.medicationForm)
    setReminderForm(state.reminderForm)
    setRecordForm(state.recordForm)
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
    applyPatch(detail.patch)
    const nextPanel = detail.target ? panelForTarget(detail.target) : panelForPatch(detail.patch)
    if (detail.text && detail.target) {
      setActiveTarget(detail.target)
      applyText(detail.target, detail.text)
    }
    setActivePanel(nextPanel ?? 'source')
    notify(detail.source ? `已帶到右側：${detail.source}` : '已帶入填寫面板')
  }, [applyPatch, applyText, notify, rememberUndo])

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

            {flash && <div className="cmo-card cmo-section" style={{ margin: '12px 0', background: '#ecfdf5', borderColor: '#bbf7d0', color: '#047857' }}>{flash}</div>}

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
              <div className="cmo-subtitle">資料只會先進入 CMO 編輯區；Problem、Condition、Medication、Reminder、Record 都會寫入目前成員，Problem、Condition、Medication 需 publish 後病人端才看得到。</div>
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
              <section className="cmo-card cmo-section">
                <div className="cmo-title-row" style={{ marginBottom: 10 }}>
                  <div>
                    <h3 className="cmo-section-title" style={{ margin: 0 }}>來源文字帶入</h3>
                    <div className="cmo-subtitle">{isInline ? '點左側 NHI 資料列，右側會即時帶入對應分頁。' : '先連續加入多筆來源，再逐筆套用到對應分頁確認。'}</div>
                  </div>
                  <span className="cmo-badge" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{lastSource || contextLabel || 'source'}</span>
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
                              <span className="cmo-badge" style={{ background: '#f1f5f9', color: '#334155' }}>{panelLabel}</span>
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
                    <div className="cmo-subtitle">{isInline ? '按「帶到右側」後，右側會直接切到對應表單。' : 'NHI row 可連續按「加入整理籃」，不會強制打開面板。'}</div>
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
                <div className="cmo-chipbar" style={{ marginBottom: 10 }}>
                  {PROBLEM_TEMPLATES.map((template) => (
                    <button key={template.label} type="button" className="cmo-chip" onClick={() => setProblemForm({ ...problemForm, ...template, is_suspected: template.status === 'following' })}>{template.label}</button>
                  ))}
                </div>
                <Field label="Problem name"><input className="cmo-input" value={problemForm.display_name} onChange={(event) => setProblemForm({ ...problemForm, display_name: event.target.value })} /></Field>
                <Field label="病人端白話名稱"><input className="cmo-input" value={problemForm.display_layman} onChange={(event) => setProblemForm({ ...problemForm, display_layman: event.target.value })} /></Field>
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
                <div className="cmo-chipbar" style={{ marginBottom: 10 }}>
                  {MEDICATION_TEMPLATES.map((template) => (
                    <button key={template.label} type="button" className="cmo-chip" onClick={() => setMedicationForm({ ...medicationForm, ...template })}>{template.label}</button>
                  ))}
                </div>
                <Field label="藥名"><input className="cmo-input" value={medicationForm.drug_name} onChange={(event) => setMedicationForm({ ...medicationForm, drug_name: event.target.value })} /></Field>
                <div className="cmo-field-grid">
                  <Field label="劑量"><input className="cmo-input" value={medicationForm.dose} onChange={(event) => setMedicationForm({ ...medicationForm, dose: event.target.value })} /></Field>
                  <Field label="頻率"><input className="cmo-input" value={medicationForm.frequency} onChange={(event) => setMedicationForm({ ...medicationForm, frequency: event.target.value })} /></Field>
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
          background: problem.is_published ? '#eff6ff' : problem.is_verified ? '#ecfdf5' : '#fff7ed',
          color: problem.is_published ? '#1d4ed8' : problem.is_verified ? '#047857' : '#c2410c',
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
      <span className="cmo-badge" style={{ background: '#f8fafc', color: '#334155' }}>CMO confirm</span>
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
