'use client'

import { useSearchParams } from 'next/navigation'
import { useActiveMember } from '../member-context'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getHealthTimeline,
  HealthTimelineEvent,
  HealthTimelineQuery,
} from '@/lib/healthTimeline'
import { ALL_MEMBERS } from '@/lib/members'
import { useSync } from '@/lib/sync'
import styles from './HealthTimeline.module.css'

const PAGE_SIZE = 50
const IMPORTANT_EVENT_TYPES = new Set([
  'admission',
  'hospitalization',
  'hospitalisation',
  'inpatient',
  'surgery',
  'operation',
  'new_disease',
  'new-disease',
  'new diagnosis',
  'new_diagnosis',
  '住院',
  '手術',
  '新疾病',
])

const EVENT_TYPE_LABELS: Record<string, string> = {
  admission: '住院',
  hospitalization: '住院',
  hospitalisation: '住院',
  inpatient: '住院',
  surgery: '手術',
  operation: '手術',
  new_disease: '新疾病',
  'new-disease': '新疾病',
  new_diagnosis: '新疾病',
  'new diagnosis': '新疾病',
  outpatient: '門診',
  condition: '疾病',
  diagnosis: '診斷',
  medication: '用藥',
  vaccine: '疫苗',
  tcm: '中醫',
  dental: '牙科',
  pathology: '病理',
  laboratory: '檢驗',
  lab: '檢驗',
  imaging: '影像',
  procedure: '處置',
}

const FIXED_EVENT_TYPES = [
  'outpatient', 'inpatient', 'condition', 'medication', 'surgery', 'lab',
  'imaging', 'pathology', 'vaccine', 'tcm', 'dental', 'procedure',
]

const SOURCE_LABELS: Record<string, string> = {
  nhi: '健保資料',
  nhi_import: '健保匯入',
  nhi_html: '健保資料',
  document: '醫療文件',
  manual: '自行記錄',
  cmo: '醫療團隊',
  ai: 'AI 整理',
}

const FIXED_SOURCE_TYPES = ['nhi_import', 'document', 'manual', 'cmo']

const REVIEW_LABELS: Record<string, string> = {
  ai_generated: 'AI 整理',
  ai_organized: 'AI 整理',
  pending_review: '待確認',
  awaiting_confirmation: '待確認',
  clinically_confirmed: '醫療確認',
  medical_confirmed: '醫療確認',
  confirmed: '醫療確認',
}

type MonthGroup = { month: number; events: HealthTimelineEvent[] }
type YearGroup = { year: number; months: MonthGroup[] }

function normalizeType(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isImportant(event: HealthTimelineEvent): boolean {
  const normalized = normalizeType(event.event_type)
  return event.is_important || IMPORTANT_EVENT_TYPES.has(normalized)
}

function eventTypeLabel(value: string): string {
  return EVENT_TYPE_LABELS[normalizeType(value)] || value
}

function sourceLabel(value: string): string {
  return SOURCE_LABELS[normalizeType(value)] || value
}

function reviewLabel(value: string): { label: string; className: string } {
  const normalized = normalizeType(value)
  if (['clinically_confirmed', 'medical_confirmed', 'confirmed'].includes(normalized)) {
    return { label: REVIEW_LABELS[normalized] || '醫療確認', className: 'hk-b-green' }
  }
  if (['ai_generated', 'ai_organized'].includes(normalized)) {
    return { label: REVIEW_LABELS[normalized] || 'AI 整理', className: 'hk-b-cmo' }
  }
  return { label: REVIEW_LABELS[normalized] || '待確認', className: 'hk-b-amber' }
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })
}

function groupEvents(events: HealthTimelineEvent[]): YearGroup[] {
  const years = new Map<number, Map<number, HealthTimelineEvent[]>>()
  for (const event of [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))) {
    const date = new Date(event.occurred_at)
    if (Number.isNaN(date.getTime())) continue
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const months = years.get(year) ?? new Map<number, HealthTimelineEvent[]>()
    const monthEvents = months.get(month) ?? []
    monthEvents.push(event)
    months.set(month, monthEvents)
    years.set(year, months)
  }
  return [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, months]) => ({
      year,
      months: [...months.entries()]
        .sort(([a], [b]) => b - a)
        .map(([month, monthEvents]) => ({ month, events: monthEvents })),
    }))
}

function selectOptions(values: string[], labels: Record<string, string>): string[] {
  return [...new Set(values.map(normalizeType))]
    .filter(Boolean)
    .sort((a, b) => (labels[a] || a).localeCompare(labels[b] || b, 'zh-TW'))
}

function HealthTimelineContent() {
  const searchParams = useSearchParams()
  const { activeMember, members } = useActiveMember()
  const sync = useSync()
  const timelineVersion = sync.viewVersions.patient_timeline ?? 0
  const headingRef = useRef<HTMLHeadingElement>(null)
  const currentYear = new Date().getFullYear()
  const defaultMember = activeMember && activeMember !== ALL_MEMBERS ? activeMember : ''
  const [memberFilter, setMemberFilter] = useState(defaultMember)
  const [yearFilter, setYearFilter] = useState('recent')
  const [typeFilter, setTypeFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [items, setItems] = useState<HealthTimelineEvent[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [mobileYearExpanded, setMobileYearExpanded] = useState<Record<number, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestVersion = useRef(0)

  const query = useMemo<HealthTimelineQuery>(() => {
    const recentFrom = `${currentYear - 2}-01-01`
    const recentTo = `${currentYear}-12-31`
    return {
      member: memberFilter || null,
      year: yearFilter !== 'recent' && yearFilter !== 'all' ? yearFilter : null,
      event_type: typeFilter || null,
      source_type: sourceFilter || null,
      from: yearFilter === 'recent' ? recentFrom : null,
      to: yearFilter === 'recent' ? recentTo : null,
      limit: PAGE_SIZE,
    }
  }, [currentYear, memberFilter, sourceFilter, typeFilter, yearFilter])

  const loadPage = useCallback(async (cursor: string | null, append: boolean) => {
    const version = requestVersion.current + 1
    requestVersion.current = version
    setLoading(true)
    setError('')
    try {
      const response = await getHealthTimeline({ ...query, cursor })
      if (version !== requestVersion.current) return
      setItems((previous) => append ? [...previous, ...response.items] : response.items)
      setNextCursor(response.next_cursor)
    } catch {
      if (version !== requestVersion.current) return
      setError('健康時間軸目前無法載入，請稍後重試。')
      if (!append) setItems([])
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void loadPage(null, false)
  }, [loadPage, timelineVersion])

  // Keep the route's member context reflected when the user switches family
  // members from the dashboard chrome. ALL_MEMBERS is the empty-string value,
  // so switching back to the family view must explicitly clear this filter.
  useEffect(() => {
    setMemberFilter(activeMember && activeMember !== ALL_MEMBERS ? activeMember : '')
  }, [activeMember])

  const yearGroups = useMemo(() => groupEvents(items), [items])
  const eventTypes = useMemo(
    () => selectOptions([...FIXED_EVENT_TYPES, ...items.map((item) => item.event_type)], EVENT_TYPE_LABELS),
    [items],
  )
  const sourceTypes = useMemo(
    () => selectOptions([...FIXED_SOURCE_TYPES, ...items.map((item) => item.source_type)], SOURCE_LABELS),
    [items],
  )
  const importedJobId = searchParams.get('import')

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value)
    headingRef.current?.focus()
  }

  const toggleMobileYear = useCallback((year: number, defaultExpanded: boolean) => {
    setMobileYearExpanded((current) => ({
      ...current,
      [year]: !(current[year] ?? defaultExpanded),
    }))
  }, [])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>健康時間軸</h1>
          <p className={styles.subtitle}>依年份、月份與事件回顧近三年的健康紀錄；重要事件只代表事件類型標記，不代表嚴重度。</p>
        </div>
        {importedJobId && <div className={styles.importNote} role="status" aria-live="polite">已完成匯入：{importedJobId}</div>}
      </header>

      <div className={styles.filters} aria-label="健康時間軸篩選">
        <label className={styles.filterLabel}>
          成員
          <select className={styles.select} value={memberFilter} onChange={(event) => updateFilter(setMemberFilter, event.target.value)}>
            <option value="">全部成員</option>
            {members.map((member) => <option key={member.id} value={member.name}>{member.name}</option>)}
          </select>
        </label>
        <label className={styles.filterLabel}>
          年份
          <select className={styles.select} value={yearFilter} onChange={(event) => updateFilter(setYearFilter, event.target.value)}>
            <option value="recent">近三年</option>
            {[currentYear, currentYear - 1, currentYear - 2].map((year) => <option key={year} value={String(year)}>{year} 年</option>)}
            <option value="all">全部年份</option>
          </select>
        </label>
        <label className={styles.filterLabel}>
          事件類型
          <select className={styles.select} value={typeFilter} onChange={(event) => updateFilter(setTypeFilter, event.target.value)}>
            <option value="">全部類型</option>
            {eventTypes.map((type) => <option key={type} value={type}>{eventTypeLabel(type)}</option>)}
          </select>
        </label>
        <label className={styles.filterLabel}>
          資料來源
          <select className={styles.select} value={sourceFilter} onChange={(event) => updateFilter(setSourceFilter, event.target.value)}>
            <option value="">全部來源</option>
            {sourceTypes.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
          </select>
        </label>
      </div>

      {error ? (
        <section className={`hk-card ${styles.error}`} role="alert">
          <div className={styles.errorTitle}>時間軸暫時無法載入</div>
          <p className={styles.errorText}>{error}</p>
          <button type="button" className={styles.retry} onClick={() => void loadPage(null, false)} disabled={loading}>
            {loading ? '載入中…' : '重試'}
          </button>
        </section>
      ) : loading && items.length === 0 ? (
        <section className="hk-card" role="status" aria-live="polite" aria-busy="true">
          <div className={styles.loadingLine} style={{ width: '42%' }} />
          <div className={styles.loadingLine} style={{ width: '88%' }} />
          <div className={styles.loadingLine} style={{ width: '64%' }} />
          <p className={styles.emptyText}>正在載入健康事件…</p>
        </section>
      ) : items.length === 0 ? (
        <section className={`hk-card ${styles.empty}`} role="status" aria-live="polite">
          <div className={styles.emptyTitle}>目前沒有符合篩選條件的健康事件</div>
          <p className={styles.emptyText}>時間軸只顯示 API 已確認提供的資料；尚未有資料時不會以示例內容填補。</p>
        </section>
      ) : (
        <div className={styles.content}>
          <aside className={styles.yearRail} aria-label="年份導覽">
            <span className={styles.yearRailLabel}>年份</span>
            {yearGroups.map((group) => <a key={group.year} className={styles.yearLink} href={`#timeline-${group.year}`}>{group.year}</a>)}
          </aside>
          <div className={styles.timeline} aria-busy={loading}>
            {yearGroups.map((yearGroup, yearIndex) => {
              const eventCount = yearGroup.months.reduce((count, month) => count + month.events.length, 0)
              const defaultExpanded = yearIndex === 0
              const expanded = mobileYearExpanded[yearGroup.year] ?? defaultExpanded
              const contentId = `timeline-year-content-${yearGroup.year}`
              return (
                <section key={yearGroup.year} id={`timeline-${yearGroup.year}`} className={styles.yearSection} aria-labelledby={`timeline-heading-${yearGroup.year}`}>
                  <div className={styles.yearHeader}>
                    <h2 id={`timeline-heading-${yearGroup.year}`} className={styles.yearHeading}>{yearGroup.year}<span className={styles.yearCount}>{eventCount} 筆</span></h2>
                    <button
                      type="button"
                      className={styles.yearToggle}
                      aria-expanded={expanded}
                      aria-controls={contentId}
                      aria-label={`${expanded ? '收合' : '展開'} ${yearGroup.year} 年健康事件`}
                      onClick={() => toggleMobileYear(yearGroup.year, defaultExpanded)}
                    >
                      <span aria-hidden="true">{expanded ? '−' : '+'}</span>
                      <span>{expanded ? '收合' : '展開'}</span>
                    </button>
                  </div>
                  <div id={contentId} className={styles.yearBody} data-mobile-expanded={expanded ? 'true' : 'false'}>
                    {yearGroup.months.map((monthGroup) => (
                      <section key={monthGroup.month} className={styles.monthSection}>
                        <h3 className={styles.monthHeading}>{monthGroup.month} 月</h3>
                        {monthGroup.events.map((event) => {
                          const important = isImportant(event)
                          const review = reviewLabel(event.review_status)
                          return (
                            <article key={event.id} className={`${styles.event} ${important ? styles.eventImportant : ''}`}>
                              <div className={styles.eventTop}>
                                <h4 className={styles.eventTitle}>{event.title}</h4>
                                <time className={styles.eventDate} dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
                              </div>
                              <p className={styles.eventSummary}>{event.summary}</p>
                              <div className={styles.badges} aria-label="事件標籤">
                                <span className="hk-badge hk-b-gray">{eventTypeLabel(event.event_type)}</span>
                                <span className="hk-badge hk-b-blue">{sourceLabel(event.source_type)}</span>
                                <span className={`hk-badge ${review.className}`}>{review.label}</span>
                                {event.member_name && <span className="hk-badge hk-b-accent">{event.member_name}</span>}
                                {important && <span className="hk-badge hk-b-amber">重要事件類型</span>}
                              </div>
                            </article>
                          )
                        })}
                      </section>
                    ))}
                  </div>
                </section>
              )
            })}
            {nextCursor && (
              <div className={styles.loadMoreWrap}>
                <button type="button" className={styles.loadMore} onClick={() => void loadPage(nextCursor, true)} disabled={loading}>
                  {loading ? '載入中…' : '載入更多事件'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TimelineFallback() {
  return (
    <section className="hk-card" role="status" aria-live="polite">
      <p style={{ color: 'var(--hk-ink-3)', fontSize: 13 }}>正在準備健康時間軸…</p>
    </section>
  )
}

export default function HealthTimelinePage() {
  return (
    <Suspense fallback={<TimelineFallback />}>
      <HealthTimelineContent />
    </Suspense>
  )
}
