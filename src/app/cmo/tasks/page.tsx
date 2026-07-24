'use client'

// Cross-patient Follow-up / Task center（設計規格 Page 5 / §8, P1）.
// 把所有病患的 FollowUpTask + MissingDataRequest 彙整成一個分流清單，避免漏追。
// 純消費 /api/cmo/tasks；逾期/到期/等待狀態由後端依日期+狀態算好。可一鍵完成/結案
// 並跳回病患工作台。
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

interface TaskRow {
  id: string
  raw_id: string | number
  kind: 'follow_up' | 'missing_data'
  patient_id: string
  patient: string
  title: string
  detail: string
  category: string
  priority: string
  due: string
  due_date: string | null
  bucket: string
  status: string
  workspace_url: string
}
interface TaskSummary {
  overdue: number
  due_soon: number
  awaiting_user: number
  awaiting_cmo: number
  done: number
  total: number
}
interface TasksEnvelope {
  tasks: TaskRow[]
  summary: TaskSummary
}
type Notice = { tone: 'ok' | 'error'; text: string }

const CATEGORY_STYLE: Record<string, { bg: string; fg: string }> = {
  補問病患: { bg: '#e7f3f5', fg: '#0c447c' },
  追蹤檢查: { bg: '#eef2ff', fg: '#26215c' },
  提醒病患: { bg: '#e1f5ee', fg: '#085041' },
  團隊確認: { bg: '#faece7', fg: '#712b13' },
  待補資料: { bg: '#fefce8', fg: '#a97614' },
}
const BUCKET_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  overdue: { label: '逾期', bg: '#faecea', fg: '#a03a30' },
  due_soon: { label: '本週到期', bg: '#fdf1e0', fg: '#b06a10' },
  awaiting_cmo: { label: '待 CMO 覆核', bg: '#fefce8', fg: '#a97614' },
  awaiting_user: { label: '待病患回覆', bg: '#e7f3f5', fg: '#0c447c' },
  open: { label: '待處理', bg: '#eef2f5', fg: '#56687a' },
  done: { label: '已完成', bg: '#e7f4ec', fg: '#2e8b57' },
}
const CATEGORIES = ['全部', '追蹤檢查', '補問病患', '提醒病患', '團隊確認', '待補資料']

async function fetchTasks(): Promise<TasksEnvelope> {
  return (await api.get('/api/cmo/tasks')) as TasksEnvelope
}

function dateAfterDays(days: number) {
  const next = new Date()
  next.setDate(next.getDate() + days)
  return next.toISOString().slice(0, 10)
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function cmoReviewRequired(t: TaskRow) {
  return t.kind === 'missing_data' && t.status === 'needs_cmo_review'
}

export default function CmoTasksPage() {
  const [data, setData] = useState<TasksEnvelope | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState('全部')
  const [showDone, setShowDone] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const reload = async () => {
    try {
      const res = await fetchTasks()
      setData(res)
    } catch {
      setError('載入失敗，請重新整理。')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => {
    const rows = data?.tasks ?? []
    return category === '全部' ? rows : rows.filter((t) => t.category === category)
  }, [data, category])

  const overdue = filtered.filter((t) => t.bucket === 'overdue')
  const active = filtered.filter((t) => ['due_soon', 'open', 'awaiting_user', 'awaiting_cmo'].includes(t.bucket))
  const done = filtered.filter((t) => t.bucket === 'done')

  const complete = async (t: TaskRow) => {
    if (cmoReviewRequired(t)) {
      setNotice({ tone: 'error', text: '病患已回覆這筆補資料任務，請先進病患工作台覆核內容後再結案。' })
      return
    }
    setBusy(t.id)
    setNotice(null)
    try {
      if (t.kind === 'follow_up') await api.patch(`/api/cmo/follow-ups/${t.raw_id}`, { status: 'completed' })
      else await api.patch(`/api/cmo/missing-data-requests/${t.raw_id}`, { status: 'resolved' })
      setNotice({ tone: 'ok', text: '已更新任務狀態。' })
      await reload()
    } catch (err) {
      setNotice({ tone: 'error', text: getErrorMessage(err, '操作失敗，任務仍保留在清單中。') })
    } finally { setBusy(null) }
  }

  const snooze = async (t: TaskRow) => {
    if (cmoReviewRequired(t)) {
      setNotice({ tone: 'error', text: '病患已回覆這筆補資料任務，不能從任務中心延後；請先覆核回覆內容。' })
      return
    }
    const nextDue = dateAfterDays(7)
    setBusy(t.id)
    setNotice(null)
    try {
      if (t.kind === 'follow_up') {
        await api.patch(`/api/cmo/follow-ups/${t.raw_id}`, { suggested_date: nextDue, status: 'open' })
      } else {
        await api.patch(`/api/cmo/missing-data-requests/${t.raw_id}`, {
          due_date: nextDue,
          status: t.status === 'open' ? 'open' : 'waiting_for_user',
        })
      }
      setNotice({ tone: 'ok', text: `已延後到 ${nextDue}。` })
      await reload()
    } catch (err) {
      setNotice({ tone: 'error', text: getErrorMessage(err, '延後失敗，任務仍保留在原本期限。') })
    } finally { setBusy(null) }
  }

  if (loading) {
    return <div className="cmo-page"><div className="cmo-card cmo-section" style={{ textAlign: 'center', marginTop: '12vh' }}><div className="cmo-subtitle">載入追蹤事項中…</div></div></div>
  }
  if (error) {
    return <div className="cmo-page"><div className="cmo-card cmo-section" style={{ textAlign: 'center', marginTop: '12vh' }}><div className="cmo-title" style={{ fontSize: 18 }}>無法載入</div><div className="cmo-subtitle" style={{ marginTop: 8 }}>{error}</div><button type="button" className="cmo-button primary" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>重新整理</button></div></div>
  }

  const s = data?.summary
  const kpis = [
    { label: '逾期', value: s?.overdue ?? 0, tone: '#a03a30' },
    { label: '本週到期', value: s?.due_soon ?? 0, tone: '#a97614' },
    { label: '待病患回覆', value: s?.awaiting_user ?? 0, tone: '#185fa5' },
    { label: '待 CMO 覆核', value: s?.awaiting_cmo ?? 0, tone: '#a97614' },
    { label: '已完成', value: s?.done ?? 0, tone: '#3e6b7e' },
  ]

  const renderCard = (t: TaskRow) => {
    const cat = CATEGORY_STYLE[t.category] ?? { bg: '#eef2f5', fg: '#56687a' }
    const badge = BUCKET_BADGE[t.bucket] ?? BUCKET_BADGE.open
    const isOverdue = t.bucket === 'overdue'
    const reviewReason = cmoReviewRequired(t) ? '病患已回覆，請先進病患工作台覆核內容。' : ''
    const disabled = busy === t.id || Boolean(reviewReason)
    return (
      <div key={t.id} className="cmo-card" style={{ padding: '10px 12px', marginBottom: 7, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderLeft: isOverdue ? '3px solid #e24b4a' : undefined, borderRadius: isOverdue ? '0 8px 8px 0' : undefined }}>
        <span className="cmo-badge" style={{ background: cat.bg, color: cat.fg, flexShrink: 0 }}>{t.category}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.title}</div>
          <div className="cmo-subtitle" style={{ fontSize: 11.5, marginTop: 1 }}>
            <Link href={t.workspace_url} style={{ color: '#185fa5' }}>{t.patient} ↗</Link>
            {t.due ? ` · 期限 ${t.due}` : ''}
          </div>
        </div>
        <span className="cmo-badge" style={{ background: badge.bg, color: badge.fg, flexShrink: 0 }}>{badge.label}</span>
        {t.bucket !== 'done' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
            <button type="button" className="cmo-button" disabled={disabled} title={reviewReason || '延後 7 天'} style={{ fontSize: 12, flexShrink: 0 }} onClick={() => snooze(t)}>
              延後 7 天
            </button>
            <button type="button" className="cmo-button primary" disabled={disabled} title={reviewReason || (t.kind === 'missing_data' ? '標記補資料任務為已結案' : '標記追蹤任務為已完成')} style={{ fontSize: 12, flexShrink: 0 }} onClick={() => complete(t)}>
              {t.kind === 'missing_data' ? '結案' : '完成'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="cmo-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 800 }}>追蹤與待辦</span>
        <span className="cmo-subtitle">跨病患彙整 · 共 {data?.summary.total ?? 0} 項</span>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 12 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: 'var(--color-background-secondary, #f6f9fa)', borderRadius: 8, padding: '10px 12px' }}>
            <div className="cmo-kpi-label">{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.tone, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
          </div>
        ))}
      </section>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="cmo-button" style={{ fontSize: 12, padding: '4px 10px', background: category === c ? '#22313f' : undefined, color: category === c ? '#fff' : undefined }} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>

      {notice && (
        <div
          className="cmo-card"
          role={notice.tone === 'error' ? 'alert' : 'status'}
          style={{
            padding: '10px 12px',
            marginBottom: 12,
            borderColor: notice.tone === 'error' ? '#f2d3cf' : '#cfe8da',
            background: notice.tone === 'error' ? '#faecea' : '#e7f4ec',
            color: notice.tone === 'error' ? '#a03a30' : '#2e8b57',
            fontSize: 13,
            fontWeight: 750,
          }}
        >
          {notice.text}
        </div>
      )}

      {overdue.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, margin: '4px 0 8px', color: '#a03a30' }}>逾期 · 優先處理（{overdue.length}）</div>
          {overdue.map(renderCard)}
        </>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 8px' }}>待處理（{active.length}）</div>
      {active.length === 0 ? <div className="cmo-card cmo-section"><div className="cmo-subtitle">目前沒有待處理事項。</div></div> : active.map(renderCard)}

      <div style={{ marginTop: 14 }}>
        <button type="button" className="cmo-subtitle" style={{ cursor: 'pointer', background: 'none', border: 'none' }} onClick={() => setShowDone((v) => !v)}>
          {showDone ? '收合' : '查看'}已完成（{done.length}）{showDone ? ' ▲' : ' ▼'}
        </button>
        {showDone && <div style={{ marginTop: 8, opacity: 0.75 }}>{done.map(renderCard)}</div>}
      </div>
    </div>
  )
}
