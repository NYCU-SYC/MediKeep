'use client'

// CMO Dashboard — 工作分流中心（設計規格 §4 / Page 1, P0）.
// 登入後第一眼：6 KPI + 風險分布 + 今日建議優先處理 + 跨病患待辦。
// 純消費既有 API（/workbench/stats、/workbench/queues），KPI 點擊深連結到
// 已套用篩選的 Patient Queue（workbench 已支援 ?queue= 參數）。
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

interface StatsOverview {
  total_patients: number
  new_patients_24h: number
}
interface CmoAlert {
  level: string
  category: string
  user_id: string
  display_name: string
  message: string
}
interface Stats {
  overview: StatsOverview
  alerts: CmoAlert[]
}
interface QueueSummary {
  all_pending: number
  needs_review: number
  critical_high: number
  missing_data: number
  follow_up_due: number
}
interface PatientRow {
  patient_id: string
  patient: string | null
  priority: string
  pending_count: number
  abnormal_count: number
  cmo_status: string
  suggested_action: string
  workspace_url: string
}
interface QueueEnvelope {
  summary: QueueSummary
  patients: PatientRow[]
}

async function fetchJson<T>(url: string): Promise<T> {
  return (await api.get(url)) as T
}

const RISK_STYLE: Record<string, { bg: string; fg: string }> = {
  Critical: { bg: '#faecea', fg: '#a03a30' },
  High: { bg: '#fdf1e0', fg: '#b06a10' },
  Medium: { bg: '#fefce8', fg: '#a97614' },
  Low: { bg: '#e7f4ec', fg: '#2e8b57' },
}
const RISK_LABEL_ZH: Record<string, string> = { Critical: '危急', High: '高', Medium: '中', Low: '低' }
const RISK_ORDER = ['Critical', 'High', 'Medium', 'Low'] as const
const RISK_BAR: Record<string, string> = { Critical: '#e24b4a', High: '#d85a30', Medium: '#ef9f27', Low: '#5dcaa5' }

function riskStyle(priority: string) {
  return RISK_STYLE[priority] ?? RISK_STYLE.Low
}

export default function CmoDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [queue, setQueue] = useState<QueueEnvelope | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [s, q] = await Promise.all([
          fetchJson<Stats>('/api/cmo/workbench/stats'),
          fetchJson<QueueEnvelope>('/api/cmo/workbench/queues'),
        ])
        if (!alive) return
        setStats(s)
        setQueue(q)
      } catch {
        if (alive) setError('載入失敗，請重新整理頁面。')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const today = useMemo(() => {
    const d = new Date()
    const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 週${wd}`
  }, [])

  const riskDist = useMemo(() => {
    const counts: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    for (const p of queue?.patients ?? []) {
      const key = RISK_ORDER.includes(p.priority as typeof RISK_ORDER[number]) ? p.priority : 'Low'
      counts[key] = (counts[key] ?? 0) + 1
    }
    const max = Math.max(1, ...Object.values(counts))
    return { counts, max }
  }, [queue])

  const topPatients = useMemo(() => (queue?.patients ?? []).slice(0, 6), [queue])
  const todayPending = (queue?.summary.all_pending ?? 0)

  if (loading) {
    return (
      <div className="cmo-page">
        <div className="cmo-card cmo-section" style={{ textAlign: 'center', marginTop: '12vh' }}>
          <div className="cmo-kpi-label">CMO 工作台總覽</div>
          <div className="cmo-subtitle" style={{ marginTop: 8 }}>載入今日工作中…</div>
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="cmo-page">
        <div className="cmo-card cmo-section" style={{ textAlign: 'center', marginTop: '12vh' }}>
          <div className="cmo-title" style={{ fontSize: 18 }}>無法載入</div>
          <div className="cmo-subtitle" style={{ marginTop: 8 }}>{error}</div>
          <button type="button" className="cmo-button primary" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>重新整理</button>
        </div>
      </div>
    )
  }

  const kpis: Array<{ label: string; value: number; tone: string; href: string }> = [
    { label: '病患總數', value: stats?.overview.total_patients ?? 0, tone: '#22313f', href: '/cmo/workbench' },
    { label: '今日新增', value: stats?.overview.new_patients_24h ?? 0, tone: '#3e6b7e', href: '/cmo/workbench' },
    { label: '待處理', value: queue?.summary.all_pending ?? 0, tone: '#a97614', href: '/cmo/workbench?queue=all_pending' },
    { label: '高風險', value: queue?.summary.critical_high ?? 0, tone: '#a03a30', href: '/cmo/workbench?queue=critical_high' },
    { label: '資料不完整', value: queue?.summary.missing_data ?? 0, tone: '#b06a10', href: '/cmo/workbench?queue=missing_data' },
    { label: '需追蹤', value: queue?.summary.follow_up_due ?? 0, tone: '#6d28d9', href: '/cmo/workbench?queue=follow_up_due' },
  ]

  return (
    <div className="cmo-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div>
          <span style={{ fontSize: 20, fontWeight: 800 }}>工作台總覽</span>
          <span className="cmo-muted" style={{ marginLeft: 10, fontSize: 13 }}>{today}</span>
        </div>
        <span className="cmo-badge" style={{ background: '#fefce8', color: '#a97614' }}>今日待處理 {todayPending}</span>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="cmo-card" style={{ padding: '12px 14px', textDecoration: 'none', cursor: 'pointer' }}>
            <div className="cmo-kpi-label">{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 850, lineHeight: 1.1, color: k.tone, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
          </Link>
        ))}
      </section>

      <section className="cmo-grid-2" style={{ alignItems: 'start' }}>
        <div className="cmo-card cmo-section">
          <div className="cmo-title-row" style={{ marginBottom: 6 }}>
            <h2 className="cmo-section-title" style={{ margin: 0 }}>今日建議優先處理</h2>
            <span className="cmo-subtitle">依臨床嚴重度排序</span>
          </div>
          {topPatients.length === 0 ? (
            <div className="cmo-list-item"><div className="cmo-subtitle">今日佇列已清空，可檢視追蹤事項。</div></div>
          ) : (
            <div className="cmo-list">
              {topPatients.map((p) => {
                const rs = riskStyle(p.priority)
                return (
                  <Link key={p.patient_id} href={p.workspace_url} className="cmo-list-item cmo-row" style={{ textAlign: 'left', textDecoration: 'none', cursor: 'pointer', alignItems: 'flex-start', gap: 10 }}>
                    <span className="cmo-badge" style={{ background: rs.bg, color: rs.fg, flexShrink: 0 }}>{RISK_LABEL_ZH[p.priority] ?? p.priority}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.patient || '未命名病患'} <span className="cmo-muted" style={{ fontWeight: 400 }}>· {p.cmo_status}</span></div>
                      <div className="cmo-subtitle" style={{ marginTop: 2, lineHeight: 1.5 }}>{p.suggested_action || '進入工作台審閱'}</div>
                    </div>
                    <span className="cmo-muted" style={{ fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>待辦 {p.pending_count}{p.abnormal_count > 0 ? ` · 異常 ${p.abnormal_count}` : ''}</span>
                  </Link>
                )
              })}
            </div>
          )}
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <Link href="/cmo/workbench" className="cmo-subtitle" style={{ cursor: 'pointer' }}>查看完整病患佇列 →</Link>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="cmo-card cmo-section">
            <h2 className="cmo-section-title" style={{ marginTop: 0 }}>風險分布</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              {RISK_ORDER.map((key) => (
                <div key={key}>
                  <div className="cmo-row" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
                    <span className="cmo-muted">{RISK_LABEL_ZH[key]}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{riskDist.counts[key]}</span>
                  </div>
                  <div style={{ height: 6, background: '#eef2f5', borderRadius: 4 }}>
                    <div style={{ width: `${Math.round((riskDist.counts[key] / riskDist.max) * 100)}%`, height: 6, background: RISK_BAR[key], borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="cmo-card cmo-section">
            <div className="cmo-title-row" style={{ marginBottom: 6 }}>
              <h2 className="cmo-section-title" style={{ margin: 0 }}>跨病患待辦 / 警示</h2>
              <span className="cmo-subtitle">{stats?.alerts.length ?? 0}</span>
            </div>
            {(stats?.alerts.length ?? 0) === 0 ? (
              <div className="cmo-subtitle">目前沒有跨病患警示。</div>
            ) : (
              <div className="cmo-list">
                {(stats?.alerts ?? []).slice(0, 6).map((a, i) => (
                  <Link key={`${a.user_id}-${i}`} href={`/cmo/patients/${a.user_id}`} className="cmo-row" style={{ textDecoration: 'none', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderTop: i === 0 ? 'none' : '0.5px solid #e3e9ee' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: a.level === 'high' ? '#a03a30' : a.level === 'medium' ? '#a97614' : '#93a3af' }} />
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{a.display_name}</span>
                      <span className="cmo-subtitle" style={{ marginLeft: 6 }}>{a.message}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
