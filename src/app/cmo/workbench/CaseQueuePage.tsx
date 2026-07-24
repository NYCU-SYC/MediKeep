'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import {
  PatientReview,
  ReviewPriority,
  ReviewQueueResponse,
  ReviewStatus,
  cleanText,
  priorityMeta,
  reviewStatusMeta,
} from '@/lib/cmoReview'
import styles from './workbench.module.css'

type CaseCategory =
  | 'all'
  | 'pending_review'
  | 'in_review'
  | 'high_risk'
  | 'needs_info'
  | 'follow_up'
  | 'ready_to_publish'
  | 'nhi_imports'
  | 'published'

type DateRange = 'all' | '24h' | '7d' | '30d'
type BatchAction = 'request_missing_data' | 'create_follow_up' | 'snooze' | 'resolve_operational' | 'set_low_priority'
type BatchPriority = 'high' | 'medium' | 'low'

type BatchActionOption = {
  key: BatchAction
  label: string
  description: string
  patientEffect: string
  needsText?: boolean
  needsDays?: boolean
  requiresConfirm?: boolean
  buttonLabel: string
}

type BatchActionResult = {
  requested_count?: number
  updated?: Array<{ patient_id?: string; target_type?: string; target_id?: string | number; updated_count?: number }>
  blocked_high_risk_patients?: string[]
  skipped?: Array<{ patient_id?: string; target_type?: string; target_id?: string | number; reason?: string }>
}

const caseCategoryOptions: Array<{ key: CaseCategory; label: string }> = [
  { key: 'all', label: '全部案件' },
  { key: 'pending_review', label: '待初審' },
  { key: 'in_review', label: '整理中' },
  { key: 'high_risk', label: '高風險' },
  { key: 'needs_info', label: '資料缺口' },
  { key: 'follow_up', label: '待追蹤' },
  { key: 'ready_to_publish', label: '可發布' },
  { key: 'nhi_imports', label: 'NHI 匯入' },
  { key: 'published', label: '已發布' },
]

const dateRangeOptions: Array<{ key: DateRange; label: string }> = [
  { key: 'all', label: '不限時間' },
  { key: '24h', label: '24 小時' },
  { key: '7d', label: '7 天' },
  { key: '30d', label: '30 天' },
]

const priorityOptions: Array<{ key: ReviewPriority | 'all'; label: string }> = [
  { key: 'all', label: '全部優先度' },
  { key: 'urgent', label: '高優先處理' },
  { key: 'high', label: '優先' },
  { key: 'normal', label: '一般' },
  { key: 'routine', label: '低' },
]

const statusSelectOptions: ReviewStatus[] = ['pending_review', 'in_review', 'ready_to_publish', 'needs_info', 'published']
const prioritySelectOptions: ReviewPriority[] = ['urgent', 'high', 'normal', 'routine']

const batchActionOptions: BatchActionOption[] = [
  {
    key: 'request_missing_data',
    label: '請病人補資料',
    description: '建立補資料請求，清楚說明缺少的資料與用途。',
    patientEffect: '勾選通知時會顯示在病人端；CMO 內部備註不會被發布。',
    needsText: true,
    needsDays: true,
    buttonLabel: '送出補資料請求',
  },
  {
    key: 'create_follow_up',
    label: '新增追蹤／回診待辦',
    description: '建立固定回診、檢查追蹤或 CMO 再確認的待辦。',
    patientEffect: '勾選通知時會顯示在病人提醒；不會改動 Problem 或診斷狀態。',
    needsText: true,
    needsDays: true,
    buttonLabel: '建立追蹤待辦',
  },
  {
    key: 'snooze',
    label: '延後既有操作待辦',
    description: '只延後既有 follow-up 或 missing data request 的日期。',
    patientEffect: '高風險且仍有未發布內容時，後端會阻擋這個動作。',
    needsDays: true,
    requiresConfirm: true,
    buttonLabel: '延後待辦',
  },
  {
    key: 'resolve_operational',
    label: '標記操作待辦已完成',
    description: '只把既有 follow-up 或 missing data request 標成完成。',
    patientEffect: '不發布、不刪除、不改臨床內容。',
    requiresConfirm: true,
    buttonLabel: '標記已完成',
  },
  {
    key: 'set_low_priority',
    label: '降低操作待辦優先度',
    description: '把既有 follow-up 或 missing data request 的優先度改為低。',
    patientEffect: '不改病人可見的臨床摘要；高風險未發布內容仍會被阻擋。',
    requiresConfirm: true,
    buttonLabel: '降低優先度',
  },
]

const batchPriorityOptions: Array<{ key: BatchPriority; label: string }> = [
  { key: 'high', label: '高' },
  { key: 'medium', label: '中' },
  { key: 'low', label: '低' },
]

export default function CaseQueuePage() {
  const [patients, setPatients] = useState<PatientReview[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CaseCategory>('all')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [priority, setPriority] = useState<ReviewPriority | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [busyPatient, setBusyPatient] = useState('')
  const [selectedPatientIds, setSelectedPatientIds] = useState<string[]>([])
  const [batchAction, setBatchAction] = useState<BatchAction>('request_missing_data')
  const [batchTitle, setBatchTitle] = useState('')
  const [batchReason, setBatchReason] = useState('')
  const [batchDays, setBatchDays] = useState('7')
  const [batchPriority, setBatchPriority] = useState<BatchPriority>('medium')
  const [batchNotifyPatient, setBatchNotifyPatient] = useState(true)
  const [batchConfirmed, setBatchConfirmed] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      const params: Record<string, string> = {}
      if (query.trim()) params.q = query.trim()
      const data = await api.get('/api/cmo/review/patients', params) as ReviewQueueResponse
      setPatients(data.patients ?? [])
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '無法載入 CMO 案件佇列')
      setPatients([])
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180)
    return () => window.clearTimeout(timer)
  }, [load])

  const filteredBySecondaryControls = useMemo(() => patients.filter((patient) => (
    (priority === 'all' || patient.priority === priority) && matchesDateRange(patient, dateRange)
  )), [dateRange, patients, priority])

  const categoryCounts = useMemo(() => Object.fromEntries(
    caseCategoryOptions.map((option) => [
      option.key,
      filteredBySecondaryControls.filter((patient) => matchesCategory(patient, option.key)).length,
    ]),
  ) as Record<CaseCategory, number>, [filteredBySecondaryControls])

  const visiblePatients = useMemo(() => filteredBySecondaryControls.filter(
    (patient) => matchesCategory(patient, category),
  ), [category, filteredBySecondaryControls])

  const updatePatientState = async (patient: PatientReview, patch: Partial<Pick<PatientReview, 'cmo_review_status' | 'priority'>>) => {
    setBusyPatient(patient.patient_id)
    setNotice('')
    try {
      const updated = await api.patch(`/api/cmo/review/patients/${patient.patient_id}/state`, patch) as PatientReview
      setPatients((rows) => rows.map((row) => row.patient_id === patient.patient_id ? updated : row))
      setNotice(`已更新 ${updated.name} 的案件狀態。`)
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '更新失敗，請稍後再試。')
    } finally {
      setBusyPatient('')
    }
  }

  const togglePatientSelection = (patientId: string) => {
    setSelectedPatientIds((current) => current.includes(patientId)
      ? current.filter((id) => id !== patientId)
      : [...current, patientId])
  }

  const toggleAllVisible = () => {
    const visibleIds = visiblePatients.map((patient) => patient.patient_id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedPatientIds.includes(id))
    setSelectedPatientIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : Array.from(new Set([...current, ...visibleIds])))
  }

  const selectedPatients = patients.filter((patient) => selectedPatientIds.includes(patient.patient_id))
  const allVisibleSelected = visiblePatients.length > 0 && visiblePatients.every((patient) => selectedPatientIds.includes(patient.patient_id))
  const activeFilterCount = Number(category !== 'all') + Number(dateRange !== 'all') + Number(priority !== 'all') + Number(Boolean(query.trim()))

  const clearFilters = () => {
    setCategory('all')
    setDateRange('all')
    setPriority('all')
    setQuery('')
  }

  const runBatchAction = async () => {
    if (selectedPatientIds.length === 0) return
    const option = batchActionOptions.find((item) => item.key === batchAction)
    if (option?.needsText && (!batchTitle.trim() || !batchReason.trim())) {
      setNotice('請先填寫標題與原因，病人端才會知道要補什麼資料或追蹤什麼事項。')
      return
    }
    const days = Number(batchDays)
    if (option?.needsDays && (!Number.isFinite(days) || days < 1 || days > 90)) {
      setNotice('天數必須是 1 到 90 天。')
      return
    }
    if (option?.requiresConfirm && !batchConfirmed) {
      setNotice('請先勾選確認，避免把仍需 CMO 判斷的高風險內容誤標為已處理。')
      return
    }
    const selectedOperationalCount = selectedPatients.reduce((sum, patient) => sum + patient.missing_info_count + patient.follow_up_count, 0)
    if (['snooze', 'resolve_operational', 'set_low_priority'].includes(batchAction) && selectedOperationalCount === 0) {
      setNotice('目前選取的使用者沒有既有追蹤或補資料待辦可更新。')
      return
    }
    const body: Record<string, unknown> = {
      action: batchAction,
      patient_ids: selectedPatientIds,
      days: Number.isFinite(days) ? Math.max(1, Math.min(Math.round(days), 90)) : 7,
      priority: batchPriority,
      notify_patient: batchNotifyPatient,
    }
    if (batchAction === 'request_missing_data') {
      body.title = batchTitle.trim()
      body.reason = batchReason.trim()
      body.instructions = batchReason.trim()
    } else if (batchAction === 'create_follow_up') {
      body.item = batchTitle.trim()
      body.reason = batchReason.trim()
    }
    setBatchBusy(true)
    setNotice('')
    try {
      const result = await api.post('/api/cmo/workbench/batch-actions', body) as BatchActionResult
      await load()
      setSelectedPatientIds([])
      setBatchConfirmed(false)
      const patientCount = new Set((result.updated ?? []).map((item) => item.patient_id).filter(Boolean)).size
      const touchedCount = (result.updated ?? []).reduce((sum, item) => sum + (typeof item.updated_count === 'number' ? item.updated_count : 1), 0)
      const blockedCount = result.blocked_high_risk_patients?.length ?? 0
      const skippedCount = result.skipped?.length ?? 0
      setNotice(`批次操作完成：${patientCount || result.requested_count || 0} 位使用者、${touchedCount} 個項目已處理${blockedCount ? `；${blockedCount} 位因高風險未發布內容被阻擋` : ''}${skippedCount ? `；${skippedCount} 個項目略過` : ''}。`)
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '批次操作失敗，請確認選取案件與必填欄位後再試。')
    } finally {
      setBatchBusy(false)
    }
  }

  return (
    <main className={`cmo-page ${styles.page}`}>
      <section className={styles.header}>
        <div>
          <div className="cmo-kpi-label">HealthKeep CMO Panel</div>
          <h1 className={styles.pageTitle}>案件整理</h1>
          <p className={styles.pageSubtitle}>先依案件類型收斂工作範圍，再進入個案完成整理、追蹤與發布。</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.totalCount}>共 {patients.length} 件</span>
          <button type="button" className="cmo-button" onClick={() => void load()} disabled={loading}>
            {loading ? '更新中…' : '重新整理資料'}
          </button>
        </div>
      </section>

      <section className={styles.categoryPanel} aria-labelledby="case-category-title">
        <div className={styles.categoryHeader}>
          <div>
            <h2 id="case-category-title">案件分類</h2>
            <p>點選分類即可只看目前要處理的案件。</p>
          </div>
          <span>{categoryCounts[category]} 件</span>
        </div>
        <div className={styles.categoryTabs} role="group" aria-label="案件分類篩選">
          {caseCategoryOptions.map((option) => {
            const active = category === option.key
            return (
              <button
                key={option.key}
                type="button"
                className={`${styles.categoryTab} ${active ? styles.categoryTabActive : ''}`}
                aria-pressed={active}
                onClick={() => setCategory(option.key)}
              >
                <span>{option.label}</span>
                <strong>{categoryCounts[option.key]}</strong>
              </button>
            )
          })}
        </div>
      </section>

      <section className={styles.filterBar} aria-label="案件篩選工具">
        <div className={styles.timeFilters} role="group" aria-label="最後更新時間">
          {dateRangeOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={dateRange === option.key ? styles.timeFilterActive : ''}
              aria-pressed={dateRange === option.key}
              onClick={() => setDateRange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className={styles.priorityFilter}>
          <span className="cmo-kpi-label">優先程度</span>
          <select className="cmo-select" value={priority} onChange={(event) => setPriority(event.target.value as ReviewPriority | 'all')}>
            {priorityOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
        <label className={styles.searchField}>
          <span className="cmo-kpi-label">搜尋案件</span>
          <input className="cmo-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="姓名、Patient ID、HealthKeep ID" />
        </label>
        <div className={styles.filterSummary}>
          <span>顯示 {visiblePatients.length} / {patients.length} 件</span>
          <button type="button" onClick={clearFilters} disabled={activeFilterCount === 0}>清除篩選{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
        </div>
      </section>

      {selectedPatientIds.length > 0 && (
        <BatchActionPanel
          selectedPatients={selectedPatients}
          action={batchAction}
          setAction={(nextAction) => {
            setBatchAction(nextAction)
            setBatchConfirmed(false)
          }}
          title={batchTitle}
          setTitle={setBatchTitle}
          reason={batchReason}
          setReason={setBatchReason}
          days={batchDays}
          setDays={setBatchDays}
          priority={batchPriority}
          setPriority={setBatchPriority}
          notifyPatient={batchNotifyPatient}
          setNotifyPatient={setBatchNotifyPatient}
          confirmed={batchConfirmed}
          setConfirmed={setBatchConfirmed}
          busy={batchBusy}
          onRun={() => void runBatchAction()}
          onClear={() => setSelectedPatientIds([])}
        />
      )}

      {notice && (
        <div className={`${styles.notice} ${notice.includes('失敗') || notice.includes('無法') ? styles.noticeError : ''}`} role="status">
          {notice}
        </div>
      )}

      <section className={styles.tableCard} aria-labelledby="case-list-title">
        <div className={styles.tableHeader}>
          <div>
            <h2 id="case-list-title">{caseCategoryOptions.find((option) => option.key === category)?.label}</h2>
            <p>以更新時間、案件訊號與下一步快速掃描；完整臨床內容仍在病患工作區處理。</p>
          </div>
          {selectedPatientIds.length > 0 && <span className={styles.selectedCount}>已選 {selectedPatientIds.length} 件</span>}
        </div>

        {loading ? (
          <div className={styles.loadingGrid} aria-label="案件載入中">
            <div /><div /><div />
          </div>
        ) : visiblePatients.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>目前沒有符合條件的案件</strong>
            <span>可以切換分類或清除篩選查看其他案件。</span>
            {activeFilterCount > 0 && <button type="button" className="cmo-button" onClick={clearFilters}>查看全部案件</button>}
          </div>
        ) : (
          <div className={styles.tableViewport}>
            <table className={styles.caseTable}>
              <thead>
                <tr>
                  <th className={styles.checkboxCell}>
                    <input type="checkbox" aria-label="選取目前顯示的全部案件" checked={allVisibleSelected} onChange={toggleAllVisible} />
                  </th>
                  <th>更新時間</th>
                  <th>案件</th>
                  <th>案件分類</th>
                  <th>主要健康問題</th>
                  <th>待處理</th>
                  <th>狀態／優先度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visiblePatients.map((patient) => (
                  <PatientRow
                    key={patient.patient_id}
                    patient={patient}
                    busy={busyPatient === patient.patient_id}
                    selected={selectedPatientIds.includes(patient.patient_id)}
                    onToggleSelection={() => togglePatientSelection(patient.patient_id)}
                    onStateChange={(nextStatus) => void updatePatientState(patient, { cmo_review_status: nextStatus })}
                    onPriorityChange={(nextPriority) => void updatePatientState(patient, { priority: nextPriority })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

function matchesCategory(patient: PatientReview, category: CaseCategory) {
  if (category === 'all') return true
  if (category === 'high_risk') return patient.high_risk_count > 0 || patient.priority === 'urgent'
  if (category === 'needs_info') return patient.cmo_review_status === 'needs_info' || patient.missing_info_count > 0
  if (category === 'follow_up') return patient.follow_up_count > 0
  if (category === 'nhi_imports') return patient.nhi_draft_count > 0
  return patient.cmo_review_status === category
}

function matchesDateRange(patient: PatientReview, range: DateRange) {
  if (range === 'all') return true
  if (!patient.last_updated) return false
  const timestamp = new Date(patient.last_updated).getTime()
  if (Number.isNaN(timestamp)) return false
  const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30
  return Date.now() - timestamp <= hours * 60 * 60 * 1000
}

function formatCaseTime(value?: string | null) {
  if (!value) return { date: '尚無紀錄', time: '' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: value, time: '' }
  return {
    date: new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date),
    time: new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date),
  }
}

function PatientRow({
  patient,
  busy,
  selected,
  onToggleSelection,
  onStateChange,
  onPriorityChange,
}: {
  patient: PatientReview
  busy: boolean
  selected: boolean
  onToggleSelection: () => void
  onStateChange: (next: ReviewStatus) => void
  onPriorityChange: (next: ReviewPriority) => void
}) {
  const status = reviewStatusMeta[patient.cmo_review_status]
  const priority = priorityMeta[patient.priority]
  const mainProblem = patient.primary_health_problems[0]
  const updated = formatCaseTime(patient.last_updated)
  const signals = getCaseSignals(patient)

  return (
    <tr className={selected ? styles.selectedRow : undefined}>
      <td className={styles.checkboxCell}>
        <input type="checkbox" aria-label={`選取 ${patient.name}`} checked={selected} onChange={onToggleSelection} />
      </td>
      <td className={styles.dateCell}>
        <strong>{updated.date}</strong>
        {updated.time && <span>{updated.time}</span>}
      </td>
      <td className={styles.patientCell}>
        <strong>{patient.name}</strong>
        <span>{patient.patient_public_id}</span>
        <small>{patient.age ? `${patient.age} 歲` : '年齡未記錄'} · {patient.sex || '性別未記錄'}</small>
      </td>
      <td className={styles.signalCell}>
        <div className={styles.badgeWrap}>
          {signals.map((signal) => <ToneBadge key={signal.label} label={signal.label} tone={signal.tone} />)}
        </div>
      </td>
      <td className={styles.problemCell}>
        <strong>{mainProblem ? cleanText(mainProblem.plain_language_title || mainProblem.title) : '尚未建立主要健康問題'}</strong>
        <span>{patient.problem_count} 個問題 · 已發布 {patient.published_problem_count}</span>
      </td>
      <td className={styles.actionSummaryCell}>
        <span className={patient.high_risk_count > 0 ? styles.attentionStrong : ''}>高風險 {patient.high_risk_count}</span>
        <span>補資料 {patient.missing_info_count}</span>
        <span>追蹤 {patient.follow_up_count}</span>
      </td>
      <td className={styles.stateCell}>
        <div className={styles.badgeWrap}>
          <ToneBadge label={status.label} tone={status.tone} />
          <ToneBadge label={priority.label} tone={priority.tone} />
        </div>
        <select className="cmo-select" aria-label={`${patient.name} 的整理狀態`} value={patient.cmo_review_status} disabled={busy} onChange={(event) => onStateChange(event.target.value as ReviewStatus)}>
          {statusSelectOptions.map((item) => <option key={item} value={item}>{reviewStatusMeta[item].label}</option>)}
        </select>
        <select className="cmo-select" aria-label={`${patient.name} 的優先程度`} value={patient.priority} disabled={busy} onChange={(event) => onPriorityChange(event.target.value as ReviewPriority)}>
          {prioritySelectOptions.map((item) => <option key={item} value={item}>{priorityMeta[item].label}</option>)}
        </select>
      </td>
      <td className={styles.openCell}>
        <Link className="cmo-button primary" href={`/cmo/patients/${patient.patient_id}`}>進入整理</Link>
      </td>
    </tr>
  )
}

function getCaseSignals(patient: PatientReview): Array<{ label: string; tone: string }> {
  const signals: Array<{ label: string; tone: string }> = []
  if (patient.high_risk_count > 0 || patient.priority === 'urgent') signals.push({ label: '高風險', tone: 'red' })
  if (patient.missing_info_count > 0 || patient.cmo_review_status === 'needs_info') signals.push({ label: '資料缺口', tone: 'amber' })
  if (patient.follow_up_count > 0) signals.push({ label: '待追蹤', tone: 'blue' })
  if (patient.pending_nhi_draft_count > 0) signals.push({ label: 'NHI 待審', tone: 'purple' })
  if (signals.length === 0) signals.push({ label: reviewStatusMeta[patient.cmo_review_status].label, tone: reviewStatusMeta[patient.cmo_review_status].tone })
  return signals.slice(0, 3)
}

function BatchActionPanel({
  selectedPatients,
  action,
  setAction,
  title,
  setTitle,
  reason,
  setReason,
  days,
  setDays,
  priority,
  setPriority,
  notifyPatient,
  setNotifyPatient,
  confirmed,
  setConfirmed,
  busy,
  onRun,
  onClear,
}: {
  selectedPatients: PatientReview[]
  action: BatchAction
  setAction: (action: BatchAction) => void
  title: string
  setTitle: (value: string) => void
  reason: string
  setReason: (value: string) => void
  days: string
  setDays: (value: string) => void
  priority: BatchPriority
  setPriority: (value: BatchPriority) => void
  notifyPatient: boolean
  setNotifyPatient: (value: boolean) => void
  confirmed: boolean
  setConfirmed: (value: boolean) => void
  busy: boolean
  onRun: () => void
  onClear: () => void
}) {
  const option = batchActionOptions.find((item) => item.key === action)
  const needsText = Boolean(option?.needsText)
  const needsDays = Boolean(option?.needsDays)
  const needsConfirm = Boolean(option?.requiresConfirm)
  const daysNumber = Number(days)
  const invalidDays = needsDays && (!Number.isFinite(daysNumber) || daysNumber < 1 || daysNumber > 90)
  const missingRequiredText = needsText && (!title.trim() || !reason.trim())
  const operationalCount = selectedPatients.reduce((sum, patient) => sum + patient.missing_info_count + patient.follow_up_count, 0)
  const possibleBlockerCount = selectedPatients.filter((patient) => patient.high_risk_count > 0 && patient.published_problem_count < patient.problem_count).length
  const updatesOperationalTargets = ['snooze', 'resolve_operational', 'set_low_priority'].includes(action)
  const hasNoOperationalTargets = updatesOperationalTargets && operationalCount === 0
  const cannotRun = busy || missingRequiredText || invalidDays || (needsConfirm && !confirmed) || hasNoOperationalTargets

  return (
    <section data-batch-toolbar="true" aria-label="批次操作工具列" className={styles.batchPanel}>
      <div className={styles.batchHeader}>
        <div>
          <span>批次操作</span>
          <h2>已選取 {selectedPatients.length} 件案件</h2>
          <p>只處理操作待辦，不會批次發布 Problem、診斷、用藥或 CMO 內部備註。</p>
        </div>
        <button type="button" className="cmo-button" disabled={busy} onClick={onClear}>清除選取</button>
      </div>
      <div className={styles.batchMetrics}>
        <div><span>選取案件</span><strong>{selectedPatients.length}</strong></div>
        <div><span>既有操作待辦</span><strong>{operationalCount}</strong></div>
        <div><span>可能被阻擋</span><strong>{possibleBlockerCount}</strong></div>
      </div>
      <div className={styles.batchForm}>
        <label>
          <span>批次動作</span>
          <select className="cmo-select" value={action} onChange={(event) => setAction(event.target.value as BatchAction)}>
            {batchActionOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        {needsDays && (
          <label>
            <span>距今天數</span>
            <input className="cmo-input" inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value.replace(/[^0-9]/g, '').slice(0, 2))} />
          </label>
        )}
        {needsText && (
          <label>
            <span>優先度</span>
            <select className="cmo-select" value={priority} onChange={(event) => setPriority(event.target.value as BatchPriority)}>
              {batchPriorityOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
        )}
        {needsText && (
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={notifyPatient} onChange={(event) => setNotifyPatient(event.target.checked)} />
            <span>通知病人端／家庭端</span>
          </label>
        )}
        {needsText && (
          <label>
            <span>{action === 'create_follow_up' ? '追蹤項目' : '補資料標題'}</span>
            <input className="cmo-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={action === 'create_follow_up' ? '例：三個月後追蹤 LDL / HbA1c' : '例：請補最近三個月檢驗報告'} />
          </label>
        )}
        {needsText && (
          <label>
            <span>原因／給病人的指示</span>
            <textarea className="cmo-textarea" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="寫清楚為什麼需要，以及要補充哪些資料。" />
          </label>
        )}
      </div>
      <div className={styles.batchDescription}>
        <strong>{option?.description}</strong>
        <span>{option?.patientEffect}</span>
        {invalidDays && <span className={styles.validationText}>天數需介於 1 到 90 天。</span>}
        {hasNoOperationalTargets && <span className={styles.validationText}>目前選取案件沒有既有操作待辦可更新。</span>}
        {needsConfirm && (
          <label className={styles.confirmLabel}>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>我確認這只處理追蹤與補資料待辦；高風險未發布內容應由系統阻擋。</span>
          </label>
        )}
      </div>
      <button type="button" className="cmo-button primary" disabled={cannotRun} onClick={onRun}>
        {busy ? '執行中…' : option?.buttonLabel ?? '執行批次操作'}
      </button>
    </section>
  )
}

function ToneBadge({ label, tone }: { label: string; tone: string }) {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    red: { bg: '#faecea', fg: '#a03a30', border: '#f2d3cf' },
    amber: { bg: '#fdf6e3', fg: '#986011', border: '#efdfae' },
    blue: { bg: '#e7f3f5', fg: '#33596a', border: '#cfe3e8' },
    green: { bg: '#e7f4ec', fg: '#2e7d50', border: '#cfe8da' },
    purple: { bg: '#f0ecfa', fg: '#6d28d9', border: '#e2daf3' },
    slate: { bg: '#f6f9fa', fg: '#56687a', border: '#e3e9ee' },
  }
  const color = colors[tone] ?? colors.slate
  return <span className="cmo-badge" style={{ background: color.bg, color: color.fg, border: `1px solid ${color.border}` }}>{label}</span>
}
