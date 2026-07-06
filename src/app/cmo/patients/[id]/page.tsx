'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import {
  HealthProblem,
  MedicationReview,
  NHITimelineEvent,
  NhiRecord,
  ReviewPriority,
  ReviewStatus,
  UserFacingSummary,
  WorkspaceResponse,
  cleanText,
  formatDateOnly,
  priorityMeta,
  reviewStatusMeta,
} from '@/lib/cmoReview'

export type RecommendationSourceRef = {
  id: string
  type: string
  title: string
  source: string
  status: string
}

export type RecommendationForm = {
  series_id: string
  title: string
  health_summary: string
  recommendation: string
  next_step: string
  summary_condition: string
  summary_exam: string
  summary_followup: string
  summary_values: string
  summary_advice: string
  follow_up_date: string
  source_refs: RecommendationSourceRef[]
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
export type UnlinkedItems = {
  conditions: Array<{ id: number; display_name: string; icd10_code?: string | null; status?: string | null }>
  medications: Array<{ id: number; drug_name: string; dose?: string | null; frequency?: string | null; intent?: string | null }>
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
  certainty: 'confirmed' | 'suspected' | 'ruled_out'
  course: 'acute' | 'chronic' | 'episodic' | 'preventive'
  followupNote: string
  trackingNote: string
  cmoNote: string
  userExplanation: string
}

type MedicationForm = {
  medicationName: string
  brandName: string
  genericNameEn: string
  dose: string
  possibleIndication: string
  frequency: string
  route: string
  selfPayPrice: string
  relatedProblemId: string
  cmoComment: string
}

type SummaryForm = {
  series_id?: string
  title: string
  health_summary: string
  recommendation: string
  next_step: string
  summary_condition: string
  summary_exam: string
  summary_followup: string
  summary_values: string
  summary_advice: string
  follow_up_date: string
}

const emptyProblemForm: ProblemForm = {
  title: '',
  plainTitle: '',
  severity: 'medium',
  status: 'following',
  certainty: 'confirmed',
  course: 'chronic',
  followupNote: '',
  trackingNote: '',
  cmoNote: '',
  userExplanation: '',
}

const emptyMedicationForm: MedicationForm = {
  medicationName: '',
  brandName: '',
  genericNameEn: '',
  dose: '',
  possibleIndication: '',
  frequency: '',
  route: '',
  selfPayPrice: '',
  relatedProblemId: '',
  cmoComment: '',
}

const emptySummary: SummaryForm = {
  title: '今日健康摘要',
  health_summary: '',
  recommendation: '',
  next_step: '',
  summary_condition: '',
  summary_exam: '',
  summary_followup: '',
  summary_values: '',
  summary_advice: '',
  follow_up_date: '',
}

const severityToTier = { high: 1, medium: 2, low: 3, insufficient: 3 } as const
const severityLabels = { high: '高', medium: '中', low: '低', insufficient: '資訊不足' } as const
const triageLabels: Record<string, { label: string; tone: string }> = {
  dismissed: { label: '免關聯', tone: 'slate' },
  rejected: { label: '已退回', tone: 'red' },
  needs_data: { label: '需補資料', tone: 'amber' },
}

export default function CmoPatientWorkspacePage() {
  const params = useParams<{ id: string }>()
  const patientId = params.id
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [problemForm, setProblemForm] = useState<ProblemForm>(emptyProblemForm)
  const [medicationForm, setMedicationForm] = useState<MedicationForm>(emptyMedicationForm)
  const [summaryForm, setSummaryForm] = useState<SummaryForm>(emptySummary)

  const load = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      const data = await api.get(`/api/cmo/review/patients/${patientId}/workspace`) as WorkspaceResponse
      setWorkspace(data)
      setSelectedRecordId((current) => current ?? data.source_review.nhi_records[0]?.id ?? null)
      setSummaryForm(formFromSummary(data.cmo_output.user_facing_summary, data))
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '無法載入病患整理工作區')
      setWorkspace(null)
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

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
    return (workspace?.source_review.nhi_records ?? []).find((row) => row.id === selectedRecordId) ?? filteredRecords[0] ?? null
  }, [filteredRecords, selectedRecordId, workspace])

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
    setBusy('problem')
    try {
      await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/problems`, {
        display_name: problemForm.title.trim(),
        display_layman: problemForm.plainTitle.trim() || problemForm.userExplanation.trim() || problemForm.title.trim(),
        tier: severityToTier[problemForm.severity],
        status: problemForm.status,
        certainty: problemForm.certainty,
        course: problemForm.course,
        followup_note: problemForm.followupNote.trim() || undefined,
        tracking_note: problemForm.trackingNote.trim() || undefined,
        cmo_note: problemForm.cmoNote.trim() || undefined,
      })
      setProblemForm(emptyProblemForm)
      await refreshAfterMutation('已建立新的健康問題，請視需要 verify / publish。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '建立健康問題失敗。')
    } finally {
      setBusy('')
    }
  }

  const createMedication = async (event: FormEvent) => {
    event.preventDefault()
    if (!workspace || !medicationForm.medicationName.trim()) return
    setBusy('medication')
    try {
      const created = await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/medications`, {
        drug_name: medicationForm.medicationName.trim(),
        brand_name: medicationForm.brandName.trim() || undefined,
        generic_name_en: medicationForm.genericNameEn.trim() || undefined,
        dose: medicationForm.dose.trim() || undefined,
        intent: medicationForm.possibleIndication.trim() || '待 CMO 確認用途',
        frequency: medicationForm.frequency.trim() || undefined,
        route: medicationForm.route.trim() || undefined,
        self_pay_price: medicationForm.selfPayPrice.trim() || undefined,
        note: medicationForm.cmoComment.trim() || undefined,
        is_active: true,
      }) as { id?: number }
      const problemId = Number(medicationForm.relatedProblemId)
      if (created.id && Number.isFinite(problemId) && problemId > 0) {
        await api.post(`/api/cmo/problems/${problemId}/links`, {
          resource_type: 'medication',
          resource_id: created.id,
          note: medicationForm.possibleIndication.trim() || undefined,
        })
      }
      setMedicationForm(emptyMedicationForm)
      await refreshAfterMutation('已新增用藥整理項目。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '新增用藥失敗。')
    } finally {
      setBusy('')
    }
  }

  const runProblemAction = async (problem: HealthProblem, action: 'verify' | 'publish' | 'unpublish') => {
    setBusy(`problem-${problem.problem_id}`)
    try {
      await api.post(`/api/cmo/problems/${problem.problem_id}/${action}`)
      await refreshAfterMutation(action === 'publish' ? '已發布健康問題到使用者端。' : action === 'verify' ? '已確認健康問題。' : '已從使用者端撤下健康問題。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '健康問題操作失敗。')
    } finally {
      setBusy('')
    }
  }

  const runMedicationAction = async (medication: MedicationReview, action: 'publish' | 'unpublish') => {
    setBusy(`med-${medication.id}`)
    try {
      await api.post(`/api/cmo/medications/${medication.id}/${action}`)
      await refreshAfterMutation(action === 'publish' ? '已發布用藥整理到使用者端。' : '已從使用者端撤下用藥整理。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '用藥操作失敗。')
    } finally {
      setBusy('')
    }
  }

  const linkSelectedRecordToProblem = async (problemId: number) => {
    if (!workspace || !selectedRecord) return
    setBusy(`link-record-${selectedRecord.id}`)
    try {
      await api.post(`/api/cmo/problems/${problemId}/links`, {
        resource_type: 'draft',
        resource_id: selectedRecord.id,
        note: selectedRecord.summary || selectedRecord.title,
      })
      await refreshAfterMutation('已將來源資料加入 Problem 容器。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '關聯來源資料失敗。')
    } finally {
      setBusy('')
    }
  }

  const triageSelectedRecord = async (triage: 'dismissed' | 'rejected' | 'needs_data') => {
    if (!workspace || !selectedRecord) return
    setBusy(`triage-record-${selectedRecord.id}`)
    try {
      await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/resource-triage`, {
        resource_type: 'draft',
        resource_id: selectedRecord.id,
        triage,
        note: selectedRecord.summary || selectedRecord.title,
        title: `補充資料：${selectedRecord.title}`,
        reason: selectedRecord.summary || selectedRecord.diagnosis || selectedRecord.title,
        source_excerpt: selectedRecord.raw_record || selectedRecord.summary || selectedRecord.title,
      })
      await refreshAfterMutation(triage === 'needs_data' ? '已建立補資料任務。' : triage === 'rejected' ? '已退回此來源資料。' : '已標記此資料免關聯。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '來源資料標記失敗。')
    } finally {
      setBusy('')
    }
  }

  const saveSummary = async (readyToPublish = false) => {
    if (!workspace) return
    setBusy(readyToPublish ? 'ready-summary' : 'summary')
    try {
      await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/recommendations/draft`, summaryPayload(summaryForm, sourceRefs, readyToPublish))
      if (readyToPublish) await updateState({ cmo_review_status: 'ready_to_publish' })
      else await refreshAfterMutation('已儲存使用者摘要草稿。')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '儲存摘要失敗。')
    } finally {
      setBusy('')
    }
  }

  const publishSummary = async () => {
    if (!workspace) return
    setBusy('publish-summary')
    try {
      await api.post(`/api/cmo/patients/${workspace.patient.patient_id}/recommendations/publish`, summaryPayload(summaryForm, sourceRefs, true))
      await api.patch(`/api/cmo/review/patients/${workspace.patient.patient_id}/state`, { cmo_review_status: 'published' })
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
          <div className="cmo-kpi-label">Patient Review Workspace</div>
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
  return (
    <main className="cmo-page">
      <section className="cmo-title-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="cmo-kpi-label">Patient Review Workspace</div>
          <h1 className="cmo-title" style={{ marginTop: 6 }}>{patient.name}</h1>
          <div className="cmo-subtitle">{patient.patient_public_id} · NHI drafts {patient.nhi_draft_count} · Problems {patient.problem_count}</div>
        </div>
        <div className="cmo-chipbar" style={{ justifyContent: 'flex-end' }}>
          <ToneBadge label={reviewStatusMeta[patient.cmo_review_status].label} tone={reviewStatusMeta[patient.cmo_review_status].tone} />
          <ToneBadge label={priorityMeta[patient.priority].label} tone={priorityMeta[patient.priority].tone} />
          <Link href="/cmo/workbench" className="cmo-button">回 Queue</Link>
          <Link href={`/cmo/patients/${patient.patient_id}/nhi`} className="cmo-button">看完整 NHI</Link>
          <button type="button" className="cmo-button" onClick={() => setShowPreview(true)}>預覽病患端</button>
        </div>
      </section>

      {notice && <div className="cmo-card cmo-section" style={{ marginTop: 14, borderColor: notice.includes('失敗') || notice.includes('無法') ? '#fecaca' : '#bbf7d0' }}>{notice}</div>}

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

      <div className="cmo-review-workspace">
        <section className="cmo-source-column">
          <SourceReview
            workspace={workspace}
            sectionFilter={sectionFilter}
            setSectionFilter={setSectionFilter}
            filteredRecords={filteredRecords}
            selectedRecord={selectedRecord}
            setSelectedRecordId={setSelectedRecordId}
            problems={workspace.cmo_output.problems}
            busy={busy}
            onLinkRecord={linkSelectedRecordToProblem}
            onTriageRecord={triageSelectedRecord}
          />
        </section>

        <section className="cmo-output-column">
          <ProblemListPanel
            problems={workspace.cmo_output.problems}
            busy={busy}
            form={problemForm}
            setForm={setProblemForm}
            onSubmit={createProblem}
            onAction={runProblemAction}
          />

          <MedicationPanel
            medications={workspace.cmo_output.medications}
            busy={busy}
            form={medicationForm}
            setForm={setMedicationForm}
            problems={workspace.cmo_output.problems}
            onSubmit={createMedication}
            onAction={runMedicationAction}
          />

          <TimelineSummaryPanel events={workspace.cmo_output.timeline_summary} />

          <SummaryBuilder
            workspace={workspace}
            form={summaryForm}
            setForm={setSummaryForm}
            sourceRefs={sourceRefs}
            busy={busy}
            showPreview={showPreview}
            setShowPreview={setShowPreview}
            onSave={() => void saveSummary(false)}
            onReady={() => void saveSummary(true)}
            onPublish={() => void publishSummary()}
          />
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
  problems,
  busy,
  onLinkRecord,
  onTriageRecord,
}: {
  workspace: WorkspaceResponse
  sectionFilter: string
  setSectionFilter: (value: string) => void
  filteredRecords: NhiRecord[]
  selectedRecord: NhiRecord | null
  setSelectedRecordId: (value: number) => void
  problems: HealthProblem[]
  busy: string
  onLinkRecord: (problemId: number) => void
  onTriageRecord: (triage: 'dismissed' | 'rejected' | 'needs_data') => void
}) {
  const overview = workspace.source_review.nhi_overview
  const [selectedProblemId, setSelectedProblemId] = useState('')
  const activeProblemId = selectedProblemId || String(problems[0]?.problem_id ?? '')
  return (
    <div className="cmo-card cmo-section cmo-sticky-panel">
      <div className="cmo-title-row">
        <div>
          <h2 className="cmo-section-title">左側資料來源</h2>
          <div className="cmo-subtitle">CMO 判斷用：原始資料、解析摘要、timeline、診斷、用藥、檢查與風險線索。</div>
        </div>
      </div>

      <div className="cmo-review-metrics">
        <Metric label="NHI records" value={overview.total} />
        <Metric label="Pending" value={overview.pending} />
        <Metric label="Accepted" value={overview.accepted} />
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

      <SourceBlock title="系統偵測風險線索" count={workspace.source_review.risk_signals.length}>
        {workspace.source_review.risk_signals.length === 0 ? <EmptyText text="目前沒有高風險線索。" /> : workspace.source_review.risk_signals.slice(0, 6).map((signal) => (
          <div key={signal.id} className="cmo-list-item">
            <div className="cmo-title-row" style={{ gap: 8 }}>
              <strong>{signal.label}</strong>
              <ToneBadge label={signal.severity === 'high' ? '高' : '中'} tone={signal.severity === 'high' ? 'red' : 'amber'} />
            </div>
            <div className="cmo-subtitle">{formatDateOnly(signal.date)} · {signal.source}</div>
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{cleanText(signal.summary, '沒有摘要')}</div>
          </div>
        ))}
      </SourceBlock>

      <SourceBlock title="NHI 解析紀錄" count={filteredRecords.length}>
        {filteredRecords.slice(0, 80).map((record) => (
          <button
            key={record.id}
            type="button"
            className={`cmo-list-item cmo-record-button ${selectedRecord?.id === record.id ? 'active' : ''}`}
            onClick={() => setSelectedRecordId(record.id)}
          >
            <div className="cmo-title-row" style={{ gap: 8 }}>
              <strong>{record.title}</strong>
              <ToneBadge label={record.section_label} tone={record.status === 'pending' ? 'amber' : record.status === 'accepted' ? 'green' : 'slate'} />
              {record.triage_status && <ToneBadge label={triageLabels[record.triage_status]?.label ?? record.triage_status} tone={triageLabels[record.triage_status]?.tone ?? 'slate'} />}
              {record.linked_problem_ids && record.linked_problem_ids.length > 0 && <ToneBadge label="已關聯" tone="green" />}
            </div>
            <div className="cmo-subtitle">{formatDateOnly(record.date)} · {cleanText(record.facility, '院所未記錄')}</div>
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{cleanText(record.summary || record.diagnosis, '沒有解析摘要')}</div>
          </button>
        ))}
      </SourceBlock>

      {selectedRecord && (
        <div className="cmo-card cmo-section" style={{ marginTop: 14, background: '#f8fafc' }}>
          <h3 className="cmo-section-title">選取紀錄詳情</h3>
          <KeyValue label="日期" value={formatDateOnly(selectedRecord.date)} />
          <KeyValue label="院所" value={cleanText(selectedRecord.facility)} />
          <KeyValue label="診斷" value={cleanText(selectedRecord.diagnosis)} />
          <KeyValue label="用藥" value={cleanText(selectedRecord.medication)} />
          <KeyValue label="檢查 / 處置" value={cleanText(selectedRecord.exam_or_lab || selectedRecord.procedure)} />
          {selectedRecord.triage_status && (
            <div className="cmo-chipbar" style={{ marginTop: 8 }}>
              <ToneBadge label={triageLabels[selectedRecord.triage_status]?.label ?? selectedRecord.triage_status} tone={triageLabels[selectedRecord.triage_status]?.tone ?? 'slate'} />
              {selectedRecord.triage_note && <span className="cmo-subtitle">{selectedRecord.triage_note}</span>}
              {selectedRecord.missing_data_request_id && <span className="cmo-subtitle">補資料任務 #{selectedRecord.missing_data_request_id}</span>}
            </div>
          )}
          <details style={{ marginTop: 10 }}>
            <summary className="cmo-button" style={{ width: 'fit-content' }}>查看原始資料</summary>
            <pre className="cmo-source-raw" style={{ marginTop: 10 }}>{selectedRecord.raw_record || selectedRecord.summary || '沒有原始文字'}</pre>
          </details>
          <div className="cmo-card cmo-section" style={{ marginTop: 12, background: '#fff' }}>
            <h4 className="cmo-section-title">Problem 容器操作</h4>
            <div className="cmo-form-grid">
              <label>
                <span className="cmo-kpi-label">加入 Problem</span>
                <select className="cmo-select" value={activeProblemId} onChange={(event) => setSelectedProblemId(event.target.value)}>
                  {problems.length === 0 ? <option value="">尚未建立 Problem</option> : problems.map((problem) => (
                    <option key={problem.problem_id} value={problem.problem_id}>{problem.plain_language_title || problem.title}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="cmo-chipbar" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="cmo-button primary"
                disabled={!activeProblemId || busy === `link-record-${selectedRecord.id}`}
                onClick={() => onLinkRecord(Number(activeProblemId))}
              >
                加入 Problem
              </button>
              <button type="button" className="cmo-button" disabled={busy === `triage-record-${selectedRecord.id}`} onClick={() => onTriageRecord('dismissed')}>標記免關聯</button>
              <button type="button" className="cmo-button" disabled={busy === `triage-record-${selectedRecord.id}`} onClick={() => onTriageRecord('rejected')}>退回</button>
              <button type="button" className="cmo-button" disabled={busy === `triage-record-${selectedRecord.id}`} onClick={() => onTriageRecord('needs_data')}>需要補資料</button>
            </div>
            {selectedRecord.linked_problem_ids && selectedRecord.linked_problem_ids.length > 0 && (
              <div className="cmo-subtitle" style={{ marginTop: 8 }}>已關聯 Problem #{selectedRecord.linked_problem_ids.join(', #')}</div>
            )}
          </div>
        </div>
      )}

      <SourceBlock title="使用者上傳資料" count={workspace.source_review.uploads.length}>
        {workspace.source_review.uploads.length === 0 ? <EmptyText text="目前沒有其他上傳文件。" /> : workspace.source_review.uploads.slice(0, 8).map((doc) => (
          <div key={String(doc.id)} className="cmo-list-item">
            <strong>{String(doc.file_name ?? '未命名文件')}</strong>
            <div className="cmo-subtitle">{String(doc.doc_type ?? 'document')} · {String(doc.processing_status_label ?? doc.status ?? 'status unknown')}</div>
          </div>
        ))}
      </SourceBlock>
    </div>
  )
}

function ProblemListPanel({
  problems,
  busy,
  form,
  setForm,
  onSubmit,
  onAction,
}: {
  problems: HealthProblem[]
  busy: string
  form: ProblemForm
  setForm: (form: ProblemForm) => void
  onSubmit: (event: FormEvent) => void
  onAction: (problem: HealthProblem, action: 'verify' | 'publish' | 'unpublish') => void
}) {
  return (
    <div className="cmo-card cmo-section">
      <div className="cmo-title-row">
        <div>
          <h2 className="cmo-section-title">主要健康問題 Problem List</h2>
          <div className="cmo-subtitle">CMO 內部 note 和使用者可見說明分開。發布後才會進入使用者端。</div>
        </div>
      </div>

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
                <ToneBadge label={problem.certainty === 'suspected' ? '疑似' : problem.certainty === 'ruled_out' ? '已排除' : '確認'} tone={problem.certainty === 'suspected' ? 'amber' : problem.certainty === 'ruled_out' ? 'slate' : 'blue'} />
                <ToneBadge label={problem.is_published ? '使用者可見' : problem.is_verified ? '已確認' : '待確認'} tone={problem.is_published ? 'green' : problem.is_verified ? 'blue' : 'amber'} />
              </div>
            </div>
            <div className="cmo-chipbar" style={{ marginTop: 8 }}>
              <span className="cmo-badge">診斷 {problem.linked_diagnoses_count ?? 0}</span>
              <span className="cmo-badge">用藥 {problem.linked_meds_count ?? 0}</span>
              <span className="cmo-badge">檢查/數值 {(problem.linked_labs_observations_count ?? 0) + (problem.linked_measurements_count ?? 0)}</span>
              <span className="cmo-badge">影像 {problem.linked_imaging_count ?? 0}</span>
            </div>
            <div className="cmo-review-two">
              <div>
                <div className="cmo-kpi-label">CMO internal note</div>
                <p>{cleanText(problem.cmo_internal_note, '沒有內部備註')}</p>
              </div>
              <div>
                <div className="cmo-kpi-label">使用者可見說明</div>
                <p>{cleanText(problem.user_visible_explanation, '尚未整理白話說明')}</p>
              </div>
            </div>
            <div className="cmo-chipbar">
              {!problem.is_verified && <button className="cmo-button" disabled={busy === `problem-${problem.problem_id}`} onClick={() => onAction(problem, 'verify')}>確認</button>}
              {problem.is_verified && !problem.is_published && <button className="cmo-button primary" disabled={busy === `problem-${problem.problem_id}`} onClick={() => onAction(problem, 'publish')}>發布給使用者</button>}
              {problem.is_published && <button className="cmo-button" disabled={busy === `problem-${problem.problem_id}`} onClick={() => onAction(problem, 'unpublish')}>撤下</button>}
            </div>
          </article>
        ))}
      </div>

      <form onSubmit={onSubmit} className="cmo-card cmo-section" style={{ marginTop: 14, background: '#f8fafc' }}>
        <h3 className="cmo-section-title">新增健康問題</h3>
        <div className="cmo-form-grid">
          <label>
            <span className="cmo-kpi-label">問題名稱</span>
            <input className="cmo-input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：頭部外傷後出血追蹤" />
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
              <option value="following">追蹤中</option>
              <option value="underlying">觀察中</option>
              <option value="resolved">已解決</option>
            </select>
          </label>
          <label>
            <span className="cmo-kpi-label">確定性</span>
            <select className="cmo-select" value={form.certainty} onChange={(event) => setForm({ ...form, certainty: event.target.value as ProblemForm['certainty'] })}>
              <option value="confirmed">確認</option>
              <option value="suspected">疑似</option>
              <option value="ruled_out">已排除</option>
            </select>
          </label>
          <label>
            <span className="cmo-kpi-label">病程</span>
            <select className="cmo-select" value={form.course} onChange={(event) => setForm({ ...form, course: event.target.value as ProblemForm['course'] })}>
              <option value="chronic">慢性</option>
              <option value="acute">急性</option>
              <option value="episodic">反覆/事件型</option>
              <option value="preventive">預防追蹤</option>
            </select>
          </label>
        </div>
        <div className="cmo-form-grid">
          <label>
            <span className="cmo-kpi-label">回診/補資料 note</span>
            <input className="cmo-input" value={form.followupNote} onChange={(event) => setForm({ ...form, followupNote: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">追蹤 note</span>
            <input className="cmo-input" value={form.trackingNote} onChange={(event) => setForm({ ...form, trackingNote: event.target.value })} />
          </label>
        </div>
        <label>
          <span className="cmo-kpi-label">CMO internal note</span>
          <textarea className="cmo-textarea" value={form.cmoNote} onChange={(event) => setForm({ ...form, cmoNote: event.target.value })} placeholder="只給 CMO 看的交班或判斷依據，不會出現在使用者端。" />
        </label>
        <label>
          <span className="cmo-kpi-label">使用者可見說明</span>
          <textarea className="cmo-textarea" value={form.userExplanation} onChange={(event) => setForm({ ...form, userExplanation: event.target.value })} placeholder="白話說明，避免看起來像直接診斷。" />
        </label>
        <button className="cmo-button primary" disabled={busy === 'problem' || !form.title.trim()}>建立 Problem</button>
      </form>
    </div>
  )
}

function MedicationPanel({
  medications,
  busy,
  form,
  setForm,
  problems,
  onSubmit,
  onAction,
}: {
  medications: MedicationReview[]
  busy: string
  form: MedicationForm
  setForm: (form: MedicationForm) => void
  problems: HealthProblem[]
  onSubmit: (event: FormEvent) => void
  onAction: (medication: MedicationReview, action: 'publish' | 'unpublish') => void
}) {
  return (
    <div className="cmo-card cmo-section">
      <h2 className="cmo-section-title">用藥整理 Medication Review</h2>
      <div className="cmo-list">
        {medications.length === 0 ? <EmptyText text="尚未建立用藥整理。" /> : medications.map((medication) => (
          <div key={medication.id} className="cmo-list-item">
            <div className="cmo-title-row">
              <div>
                <strong>{medication.medication_name}</strong>
                <div className="cmo-subtitle">{cleanText(medication.frequency, '頻率未記錄')} · {cleanText(medication.possible_indication, '用途待確認')}</div>
                <div className="cmo-subtitle" style={{ marginTop: 4 }}>
                  {[medication.brand_name, medication.generic_name_en, medication.dose, medication.route, medication.self_pay_price ? `自費 ${medication.self_pay_price}` : ''].filter(Boolean).join(' · ') || '商品名、學名、途徑與自費價格待補'}
                </div>
              </div>
              <ToneBadge label={medication.is_published ? '使用者可見' : medication.is_verified ? '已確認' : '待確認'} tone={medication.is_published ? 'green' : medication.is_verified ? 'blue' : 'amber'} />
            </div>
            <p style={{ margin: '8px 0', color: '#334155', lineHeight: 1.55 }}>{cleanText(medication.cmo_comment, '沒有 CMO 備註')}</p>
            <div className="cmo-chipbar">
              {!medication.is_published ? (
                <button className="cmo-button primary" disabled={busy === `med-${medication.id}`} onClick={() => onAction(medication, 'publish')}>發布用藥摘要</button>
              ) : (
                <button className="cmo-button" disabled={busy === `med-${medication.id}`} onClick={() => onAction(medication, 'unpublish')}>撤下</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={onSubmit} className="cmo-card cmo-section" style={{ marginTop: 14, background: '#f8fafc' }}>
        <h3 className="cmo-section-title">新增用藥整理</h3>
        <div className="cmo-form-grid">
          <label>
            <span className="cmo-kpi-label">藥物名稱</span>
            <input className="cmo-input" value={form.medicationName} onChange={(event) => setForm({ ...form, medicationName: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">商品名</span>
            <input className="cmo-input" value={form.brandName} onChange={(event) => setForm({ ...form, brandName: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">英文學名</span>
            <input className="cmo-input" value={form.genericNameEn} onChange={(event) => setForm({ ...form, genericNameEn: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">劑量</span>
            <input className="cmo-input" value={form.dose} onChange={(event) => setForm({ ...form, dose: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">可能用途</span>
            <input className="cmo-input" value={form.possibleIndication} onChange={(event) => setForm({ ...form, possibleIndication: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">頻率 / 時間</span>
            <input className="cmo-input" value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">途徑</span>
            <input className="cmo-input" value={form.route} onChange={(event) => setForm({ ...form, route: event.target.value })} placeholder="口服 / 外用 / 注射" />
          </label>
          <label>
            <span className="cmo-kpi-label">自費價格</span>
            <input className="cmo-input" value={form.selfPayPrice} onChange={(event) => setForm({ ...form, selfPayPrice: event.target.value })} />
          </label>
          <label>
            <span className="cmo-kpi-label">關聯 Problem</span>
            <select className="cmo-select" value={form.relatedProblemId} onChange={(event) => setForm({ ...form, relatedProblemId: event.target.value })}>
              <option value="">不關聯</option>
              {problems.map((problem) => (
                <option key={problem.problem_id} value={problem.problem_id}>{problem.plain_language_title || problem.title}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span className="cmo-kpi-label">CMO comment</span>
          <textarea className="cmo-textarea" value={form.cmoComment} onChange={(event) => setForm({ ...form, cmoComment: event.target.value })} />
        </label>
        <button className="cmo-button primary" disabled={busy === 'medication' || !form.medicationName.trim()}>新增用藥整理</button>
      </form>
    </div>
  )
}

function TimelineSummaryPanel({ events }: { events: NHITimelineEvent[] }) {
  return (
    <div className="cmo-card cmo-section">
      <h2 className="cmo-section-title">就醫紀錄 Timeline Summary</h2>
      <div className="cmo-timeline-list">
        {events.length === 0 ? <EmptyText text="目前沒有可整理的 timeline。" /> : events.slice(0, 12).map((event) => (
          <div key={event.id} className="cmo-timeline-item">
            <div className="cmo-timeline-date">{formatDateOnly(event.date)}</div>
            <div>
              <strong>{cleanText(event.normalized_summary || event.diagnosis, '就醫紀錄')}</strong>
              <div className="cmo-subtitle">{cleanText(event.institution, '院所未記錄')} · {event.section_label}</div>
              <div style={{ marginTop: 5, fontSize: 13, color: '#334155' }}>{cleanText(event.medication || event.exam_or_lab || event.procedure, '沒有用藥或檢查摘要')}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryBuilder({
  workspace,
  form,
  setForm,
  sourceRefs,
  busy,
  showPreview,
  setShowPreview,
  onSave,
  onReady,
  onPublish,
}: {
  workspace: WorkspaceResponse
  form: SummaryForm
  setForm: (form: SummaryForm) => void
  sourceRefs: Array<{ type: string; id: string; label: string; status: string }>
  busy: string
  showPreview: boolean
  setShowPreview: (value: boolean) => void
  onSave: () => void
  onReady: () => void
  onPublish: () => void
}) {
  const attentionFields: Array<{ key: keyof Pick<SummaryForm, 'summary_condition' | 'summary_exam' | 'summary_followup' | 'summary_values' | 'summary_advice'>; label: string }> = [
    { key: 'summary_condition', label: '病況' },
    { key: 'summary_exam', label: '檢查' },
    { key: 'summary_followup', label: '回診' },
    { key: 'summary_values', label: '數值' },
    { key: 'summary_advice', label: '建議' },
  ]
  const hasAttentionSummary = attentionFields.some((field) => form[field.key].trim())
  return (
    <div className="cmo-card cmo-section">
      <div className="cmo-title-row">
        <div>
          <h2 className="cmo-section-title">User-facing Summary Builder</h2>
          <div className="cmo-subtitle">以下內容會出現在使用者端；請保持白話、精簡、可行動。</div>
        </div>
        <ToneBadge label="使用者可見" tone="green" />
      </div>
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
      <div className="cmo-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
        {attentionFields.map((field) => (
          <label key={field.key}>
            <span className="cmo-kpi-label">{field.label}</span>
            <input
              className="cmo-input"
              maxLength={20}
              value={form[field.key]}
              onChange={(event) => setForm({ ...form, [field.key]: event.target.value.slice(0, 20) })}
              placeholder="20 字內"
            />
            <div className="cmo-subtitle" style={{ fontSize: 11, marginTop: 4 }}>{form[field.key].length}/20</div>
          </label>
        ))}
      </div>

      <div className="cmo-card cmo-section" style={{ background: '#f8fafc', margin: '12px 0' }}>
        <h3 className="cmo-section-title">來源提示</h3>
        {sourceRefs.length === 0 ? <EmptyText text="尚無可引用來源；發布前請至少保留 CMO 確認狀態。" /> : sourceRefs.map((ref) => (
          <div key={ref.id} className="cmo-subtitle">{ref.label} · {ref.status}</div>
        ))}
      </div>

      <div className="cmo-chipbar">
        <button className="cmo-button" disabled={busy === 'summary'} onClick={onSave}>儲存草稿</button>
        <button className="cmo-button" disabled={busy === 'ready-summary'} onClick={onReady}>標記待發布</button>
        <button className="cmo-button" onClick={() => setShowPreview(!showPreview)}>{showPreview ? '返回修改' : '預覽使用者端'}</button>
        <button className="cmo-button primary" disabled={busy === 'publish-summary' || !hasAttentionSummary} onClick={onPublish}>發布給使用者</button>
      </div>
      {!hasAttentionSummary && <div className="cmo-subtitle" style={{ marginTop: 8 }}>發布前至少填寫一格「需要注意」。</div>}

      {showPreview && <PublishPreview workspace={workspace} form={form} sourceRefs={sourceRefs} />}
    </div>
  )
}

function PublishPreview({ workspace, form, sourceRefs }: { workspace: WorkspaceResponse; form: SummaryForm; sourceRefs: Array<{ label: string; status: string }> }) {
  const visibleProblems = workspace.cmo_output.problems.filter((problem) => problem.is_published || problem.publish_to_user).slice(0, 4)
  const visibleMeds = workspace.cmo_output.medications.filter((medication) => medication.is_published).slice(0, 4)
  const attentionRows = [
    ['病況', form.summary_condition],
    ['檢查', form.summary_exam],
    ['回診', form.summary_followup],
    ['數值', form.summary_values],
    ['建議', form.summary_advice],
  ] as const
  return (
    <section className="cmo-card cmo-section cmo-publish-preview">
      <div className="cmo-kpi-label">Publish Preview</div>
      <h3>{form.title || '今日健康摘要'}</h3>
      <div className="cmo-user-preview-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
        {attentionRows.map(([label, value]) => (
          <div key={label} className="cmo-list-item">
            <div className="cmo-kpi-label">{label}</div>
            <strong>{cleanText(value, '—')}</strong>
          </div>
        ))}
      </div>
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
      <div className="cmo-card cmo-section" style={{ background: '#fff', marginTop: 12 }}>
        <h4>資料來源與提醒</h4>
        {sourceRefs.map((ref) => <div key={ref.label} className="cmo-subtitle">{ref.label} · {ref.status}</div>)}
        <p className="cmo-subtitle" style={{ marginTop: 8 }}>以上為 CMO 根據 NHI 與已確認資料整理出的提醒，不等同診斷；實際診療請依醫師面診與醫療院所紀錄為準。</p>
      </div>
    </section>
  )
}

function SourceBlock({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="cmo-source-block" open>
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
  return <button type="button" className={`cmo-chip ${active ? 'active' : ''}`} onClick={onClick}>{children}</button>
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 8, margin: '7px 0', fontSize: 13 }}>
      <div className="cmo-kpi-label">{label}</div>
      <div style={{ color: '#111827', wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}

function EmptyText({ text }: { text: string }) {
  return <div className="cmo-list-item" style={{ color: '#64748b', background: '#f8fafc' }}>{text}</div>
}

function ToneBadge({ label, tone }: { label: string; tone: string }) {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    red: { bg: '#fff1f2', fg: '#be123c', border: '#fecaca' },
    amber: { bg: '#fffbeb', fg: '#a16207', border: '#fde68a' },
    blue: { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
    green: { bg: '#ecfdf5', fg: '#047857', border: '#bbf7d0' },
    purple: { bg: '#f5f3ff', fg: '#6d28d9', border: '#ddd6fe' },
    slate: { bg: '#f8fafc', fg: '#475569', border: '#e2e8f0' },
  }
  const color = colors[tone] ?? colors.slate
  return <span className="cmo-badge" style={{ background: color.bg, color: color.fg, border: `1px solid ${color.border}` }}>{label}</span>
}

function formFromSummary(summary: UserFacingSummary | null, workspace: WorkspaceResponse): SummaryForm {
  if (summary) {
    const attention = summary.attention_summary
    return {
      series_id: summary.series_id,
      title: summary.title || '今日健康摘要',
      health_summary: summary.health_summary || '',
      recommendation: summary.recommendation || '',
      next_step: summary.next_step || '',
      summary_condition: summary.summary_condition || attention?.condition || '',
      summary_exam: summary.summary_exam || attention?.exam || '',
      summary_followup: summary.summary_followup || attention?.followup || '',
      summary_values: summary.summary_values || attention?.values || '',
      summary_advice: summary.summary_advice || attention?.advice || '',
      follow_up_date: summary.follow_up_date || '',
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
    summary_condition: problem ? (problem.plain_language_title || problem.title).slice(0, 20) : (risk?.label || '').slice(0, 20),
    summary_exam: '',
    summary_followup: '',
    summary_values: '',
    summary_advice: '',
    follow_up_date: '',
  }
}

function summaryPayload(form: SummaryForm, sourceRefs: Array<{ type: string; id: string; label: string; status: string }>, readyToPublish: boolean) {
  const condition = form.summary_condition.trim()
  const exam = form.summary_exam.trim()
  const followup = form.summary_followup.trim()
  const values = form.summary_values.trim()
  const advice = form.summary_advice.trim()
  const healthSummary = [condition && `病況：${condition}`, exam && `檢查：${exam}`, followup && `回診：${followup}`, values && `數值：${values}`, advice && `建議：${advice}`].filter(Boolean).join('；')
  return {
    series_id: form.series_id,
    title: form.title.trim() || '今日健康摘要',
    health_summary: form.health_summary.trim() || healthSummary,
    recommendation: form.recommendation.trim() || advice || healthSummary,
    next_step: form.next_step.trim() || followup || advice,
    summary_condition: condition,
    summary_exam: exam,
    summary_followup: followup,
    summary_values: values,
    summary_advice: advice,
    follow_up_date: form.follow_up_date.trim() || null,
    source_refs: sourceRefs.map((ref) => ({
      source: ref.label,
      target_type: ref.type,
      target_id: ref.id,
      status: ref.status,
    })),
    quality_checks: {
      plain_language: true,
      medical_safety_copy: true,
      has_missing_data_state: true,
    },
    ready_to_publish: readyToPublish,
  }
}
