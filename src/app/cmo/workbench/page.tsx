'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import {
  PatientReview,
  ReviewPriority,
  ReviewQueueResponse,
  ReviewStatus,
  cleanText,
  formatDateTime,
  priorityMeta,
  reviewStatusMeta,
} from '@/lib/cmoReview'

const statusOptions: Array<{ key: ReviewStatus | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending_review', label: '待整理' },
  { key: 'in_review', label: '整理中' },
  { key: 'ready_to_publish', label: '待發布' },
  { key: 'needs_info', label: '需補資料' },
  { key: 'published', label: '已發布' },
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

export default function CmoWorkbenchPage() {
  const [patients, setPatients] = useState<PatientReview[]>([])
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ReviewStatus | 'all'>('all')
  const [priority, setPriority] = useState<ReviewPriority | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [busyPatient, setBusyPatient] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      const params: Record<string, string> = {}
      if (query.trim()) params.q = query.trim()
      if (status !== 'all') params.status = status
      if (priority !== 'all') params.priority = priority
      const data = await api.get('/api/cmo/review/patients', params) as ReviewQueueResponse
      setPatients(data.patients ?? [])
      setSummary(data.summary ?? {})
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '無法載入 CMO 工作佇列'
      setNotice(message)
      setPatients([])
      setSummary({})
    } finally {
      setLoading(false)
    }
  }, [priority, query, status])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 180)
    return () => window.clearTimeout(timer)
  }, [load])

  const updatePatientState = async (patient: PatientReview, patch: Partial<Pick<PatientReview, 'cmo_review_status' | 'priority'>>) => {
    setBusyPatient(patient.patient_id)
    setNotice('')
    try {
      const updated = await api.patch(`/api/cmo/review/patients/${patient.patient_id}/state`, patch) as PatientReview
      setPatients((rows) => rows.map((row) => row.patient_id === patient.patient_id ? updated : row))
      setNotice(`已更新 ${updated.name} 的整理狀態。`)
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '更新失敗，請稍後再試。')
    } finally {
      setBusyPatient('')
    }
  }

  return (
    <main className="cmo-page">
      <section className="cmo-title-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="cmo-kpi-label">HealthKeep CMO Panel</div>
          <h1 className="cmo-title" style={{ marginTop: 6 }}>Patient Queue</h1>
          <div className="cmo-subtitle">只顯示 CMO 進入整理前需要判斷的狀態：誰要處理、為什麼重要、下一步去哪裡整理。</div>
        </div>
        <button type="button" className="cmo-button" onClick={() => void load()} disabled={loading}>
          {loading ? '更新中' : '重新整理'}
        </button>
      </section>

      <section className="cmo-kpi-grid" style={{ gridTemplateColumns: 'repeat(6,minmax(0,1fr))' }}>
        <QueueMetric label="待整理" value={summary.pending_review ?? 0} />
        <QueueMetric label="整理中" value={summary.in_review ?? 0} />
        <QueueMetric label="需補資料" value={summary.needs_info ?? 0} />
        <QueueMetric label="待發布" value={summary.ready_to_publish ?? 0} />
        <QueueMetric label="高優先" value={summary.urgent ?? 0} />
        <QueueMetric label="NHI imports" value={summary.nhi_imports ?? 0} />
      </section>

      <section className="cmo-card cmo-toolbar" aria-label="Queue filters">
        <label style={{ flex: '1 1 280px', minWidth: 240 }}>
          <span className="cmo-kpi-label">搜尋使用者</span>
          <input
            className="cmo-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="姓名、Patient ID、HealthKeep ID"
            style={{ marginTop: 6 }}
          />
        </label>
        <label style={{ flex: '0 0 190px' }}>
          <span className="cmo-kpi-label">整理狀態</span>
          <select className="cmo-select" value={status} onChange={(event) => setStatus(event.target.value as ReviewStatus | 'all')} style={{ marginTop: 6 }}>
            {statusOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
        <label style={{ flex: '0 0 190px' }}>
          <span className="cmo-kpi-label">優先程度</span>
          <select className="cmo-select" value={priority} onChange={(event) => setPriority(event.target.value as ReviewPriority | 'all')} style={{ marginTop: 6 }}>
            {priorityOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
      </section>

      {notice && <div className="cmo-card cmo-section" style={{ marginBottom: 12, borderColor: notice.includes('失敗') || notice.includes('無法') ? '#fecaca' : '#bbf7d0' }}>{notice}</div>}

      <section className="cmo-card" style={{ overflow: 'hidden' }}>
        <div className="cmo-title-row" style={{ padding: '16px 18px', borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <h2 className="cmo-section-title" style={{ marginBottom: 2 }}>使用者工作佇列</h2>
            <div className="cmo-subtitle">每列只保留整理決策需要的資訊。完整 NHI 與 CMO output 在病患工作區處理。</div>
          </div>
          <span className="cmo-badge" style={{ background: '#f1f5f9', color: '#334155' }}>{patients.length} 位使用者</span>
        </div>
        {loading ? (
          <div className="cmo-section">
            <div className="cmo-skeleton-grid">
              <div className="cmo-skeleton-card" />
              <div className="cmo-skeleton-card" />
              <div className="cmo-skeleton-card" />
            </div>
          </div>
        ) : patients.length === 0 ? (
          <div className="cmo-section" style={{ textAlign: 'center', color: '#64748b' }}>目前沒有符合條件的使用者。</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cmo-table">
              <thead>
                <tr>
                  <th>使用者</th>
                  <th>NHI / 整理狀態</th>
                  <th>主要健康問題</th>
                  <th>需注意</th>
                  <th>最後更新</th>
                  <th>優先程度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <PatientRow
                    key={patient.patient_id}
                    patient={patient}
                    busy={busyPatient === patient.patient_id}
                    onStateChange={(nextStatus) => updatePatientState(patient, { cmo_review_status: nextStatus })}
                    onPriorityChange={(nextPriority) => updatePatientState(patient, { priority: nextPriority })}
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

function QueueMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="cmo-card cmo-kpi">
      <div className="cmo-kpi-label">{label}</div>
      <div className="cmo-kpi-value">{value}</div>
    </div>
  )
}

function PatientRow({
  patient,
  busy,
  onStateChange,
  onPriorityChange,
}: {
  patient: PatientReview
  busy: boolean
  onStateChange: (next: ReviewStatus) => void
  onPriorityChange: (next: ReviewPriority) => void
}) {
  const status = reviewStatusMeta[patient.cmo_review_status]
  const priority = priorityMeta[patient.priority]
  const mainProblem = patient.primary_health_problems[0]
  return (
    <tr>
      <td style={{ minWidth: 240 }}>
        <div style={{ fontWeight: 850, color: '#0f172a' }}>{patient.name}</div>
        <div className="cmo-subtitle" style={{ marginTop: 3 }}>{patient.patient_public_id}</div>
        <div className="cmo-subtitle">{patient.age ? `${patient.age} 歲` : '年齡未記錄'} · {patient.sex || '性別未記錄'}</div>
      </td>
      <td style={{ minWidth: 220 }}>
        <div className="cmo-chipbar">
          <ToneBadge label={patient.nhi_upload_status === 'parsed' ? 'NHI 已解析' : patient.nhi_upload_status === 'uploaded' ? '已上傳' : '無 NHI'} tone={patient.nhi_upload_status === 'parsed' ? 'blue' : 'slate'} />
          <ToneBadge label={status.label} tone={status.tone} />
        </div>
        <div className="cmo-subtitle">NHI drafts {patient.nhi_draft_count} · 待審 {patient.pending_nhi_draft_count}</div>
      </td>
      <td style={{ minWidth: 260 }}>
        <div style={{ fontWeight: 780 }}>{mainProblem ? cleanText(mainProblem.plain_language_title || mainProblem.title) : '尚未建立主要健康問題'}</div>
        <div className="cmo-subtitle">{patient.problem_count} 個問題 · 已發布 {patient.published_problem_count}</div>
      </td>
      <td style={{ minWidth: 180 }}>
        <div className="cmo-chipbar">
          <ToneBadge label={`高風險 ${patient.high_risk_count}`} tone={patient.high_risk_count > 0 ? 'red' : 'slate'} />
          <ToneBadge label={`補資料 ${patient.missing_info_count}`} tone={patient.missing_info_count > 0 ? 'amber' : 'slate'} />
        </div>
        <div className="cmo-subtitle">追蹤事項 {patient.follow_up_count}</div>
      </td>
      <td style={{ minWidth: 140 }}>{formatDateTime(patient.last_updated)}</td>
      <td style={{ minWidth: 220 }}>
        <div className="cmo-chipbar" style={{ marginBottom: 8 }}>
          <ToneBadge label={priority.label} tone={priority.tone} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
          <select className="cmo-select" value={patient.priority} disabled={busy} onChange={(event) => onPriorityChange(event.target.value as ReviewPriority)}>
            {prioritySelectOptions.map((item) => <option key={item} value={item}>{priorityMeta[item].label}</option>)}
          </select>
          <select className="cmo-select" value={patient.cmo_review_status} disabled={busy} onChange={(event) => onStateChange(event.target.value as ReviewStatus)}>
            {statusSelectOptions.map((item) => <option key={item} value={item}>{reviewStatusMeta[item].label}</option>)}
          </select>
        </div>
      </td>
      <td style={{ minWidth: 150 }}>
        <Link className="cmo-button primary" href={`/cmo/patients/${patient.patient_id}`}>
          進入整理
        </Link>
      </td>
    </tr>
  )
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
  return (
    <span className="cmo-badge" style={{ background: color.bg, color: color.fg, border: `1px solid ${color.border}` }}>{label}</span>
  )
}
