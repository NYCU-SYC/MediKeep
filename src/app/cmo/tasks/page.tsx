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

const CATEGORY_STYLE: Record<string, { bg: string; fg: string }> = {
  補問病患: { bg: '#eff6ff', fg: '#0c447c' },
  追蹤檢查: { bg: '#eef2ff', fg: '#26215c' },
  提醒病患: { bg: '#e1f5ee', fg: '#085041' },
  團隊確認: { bg: '#faece7', fg: '#712b13' },
  待補資料: { bg: '#fefce8', fg: '#854d0e' },
}
const BUCKET_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  overdue: { label: '逾期', bg: '#fef2f2', fg: '#be123c' },
  due_soon: { label: '本週到期', bg: '#fff7ed', fg: '#c2410c' },
  awaiting_cmo: { label: '待 CMO 覆核', bg: '#fefce8', fg: '#854d0e' },
  awaiting_user: { label: '待病患回覆', bg: '#eff6ff', fg: '#0c447c' },
  open: { label: '待處理', bg: '#f1f5f9', fg: '#475569' },
  done: { label: '已完成', bg: '#ecfdf5', fg: '#047857' },
}
const CATEGORIES = ['全部', '追蹤檢查', '補問病患', '提醒病患', '團隊確認', '待補資料']

async function fetchTasks(): Promise<TasksEnvelope> {
  return (await api.get('/api/cmo/tasks')) as TasksEnvelope
}

export default function CmoTasksPage() {
  const [data, setData] = useState<TasksEnvelope | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState('全部')
  const [showDone, setShowDone] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

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
    setBusy(t.id)
    try {
      if (t.kind === 'follow_up') await api.patch(`/api/cmo/follow-ups/${t.raw_id}`, { status: 'completed' })
      else await api.patch(`/api/cmo/missing-data-requests/${t.raw_id}`, { status: 'resolved' })
      await reload()
    } catch { /* keep row; surfaced via no state change */ } finally { setBusy(null) }
  }

  if (loading) {
    return <div className="cmo-page"><div className="cmo-card cmo-section" style={{ textAlign: 'center', marginTop: '12vh' }}><div className="cmo-subtitle">載入追蹤事項中…</div></div></div>
  }
  if (error) {
    return <div className="cmo-page"><div className="cmo-card cmo-section" style={{ textAlign: 'center', marginTop: '12vh' }}><div className="cmo-title" style={{ fontSize: 18 }}>無法載入</div><div className="cmo-subtitle" style={{ marginTop: 8 }}>{error}</div><button type="button" className="cmo-button primary" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>重新整理</button></div></div>
  }

  const s = data?.summary
  const kpis = [
    { label: '逾期', value: s?.overdue ?? 0, tone: '#be123c' },
    { label: '本週到期', value: s?.due_soon ?? 0, tone: '#854d0e' },
    { label: '待病患回覆', value: s?.awaiting_user ?? 0, tone: '#185fa5' },
    { label: '待 CMO 覆核', value: s?.awaiting_cmo ?? 0, tone: '#854d0e' },
    { label: '已完成', value: s?.done ?? 0, tone: '#0f766e' },
  ]

  const renderCard = (t: TaskRow) => {
    const cat = CATEGORY_STYLE[t.category] ?? { bg: '#f1f5f9', fg: '#475569' }
    const badge = BUCKET_BADGE[t.bucket] ?? BUCKET_BADGE.open
    const isOverdue = t.bucket === 'overdue'
    return (
      <div key={t.id} className="cmo-card" style={{ padding: '10px 12px', marginBottom: 7, display: 'flex', gap: 10, alignItems: 'center', borderLeft: isOverdue ? '3px solid #e24b4a' : undefined, borderRadius: isOverdue ? '0 8px 8px 0' : undefined }}>
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
          <button type="button" className="cmo-button" disabled={busy === t.id} style={{ fontSize: 12, flexShrink: 0 }} onClick={() => complete(t)}>
            {t.kind === 'missing_data' ? '結案' : '完成'}
          </button>
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
          <div key={k.label} style={{ background: 'var(--color-background-secondary, #f8fafc)', borderRadius: 8, padding: '10px 12px' }}>
            <div className="cmo-kpi-label">{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.tone, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
          </div>
        ))}
      </section>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="cmo-button" style={{ fontSize: 12, padding: '4px 10px', background: category === c ? '#0f172a' : undefined, color: category === c ? '#fff' : undefined }} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>

      {overdue.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, margin: '4px 0 8px', color: '#be123c' }}>逾期 · 優先處理（{overdue.length}）</div>
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
