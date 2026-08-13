'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useActiveMember } from '../member-context'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getHealthEncounter,
  getHealthEpisode,
  getHealthTimeline,
  HealthEncounterDetails,
  HealthEpisodeDetails,
  HealthTimelineEvent,
  HealthTimelineDetailCategory,
  HealthTimelineDetailItem,
  HealthTimelineQuery,
  saveNhiFactToProfile,
} from '@/lib/healthTimeline'
import { ALL_MEMBERS, memberHref } from '@/lib/members'
import { useSync } from '@/lib/sync'
import { useToast } from '../toast-context'
import { AccessibleDialog } from '../_components/Shared'
import {
  PATIENT_CONDITION_STATUS_OPTIONS,
  PATIENT_MEDICATION_USAGE_OPTIONS,
} from '@/lib/patientStatus'
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
  episode: '健康問題歷程',
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
  imaging_summary: '影像',
  procedure: '處置',
  procedures: '處置／手術',
  encounter: '整合就醫',
  test: '檢測',
  tests: '檢測',
  lab_results: '檢驗',
}

const FIXED_EVENT_TYPES = [
  'outpatient', 'inpatient', 'condition', 'medication', 'surgery', 'lab',
  'imaging', 'pathology', 'vaccine', 'tcm', 'dental', 'procedure',
]

const SOURCE_LABELS: Record<string, string> = {
  nhi: '健保資料',
  nhi_import: '健保匯入',
  nhi_html: '健保資料',
  nhi_health_passbook: '健保存摺',
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

const ENCOUNTER_CATEGORY_LABELS: Record<string, string> = {
  diagnosis: '診斷',
  diagnoses: '診斷',
  condition: '診斷',
  conditions: '診斷',
  medication: '用藥',
  medications: '用藥',
  prescription: '用藥',
  prescriptions: '用藥',
  laboratory: '檢驗',
  laboratories: '檢驗',
  lab: '檢驗',
  labs: '檢驗',
  imaging: '影像',
  surgery: '手術',
  surgeries: '手術',
  operation: '手術',
  operations: '手術',
  procedure: '處置／手術',
  procedures: '處置／手術',
  lab_results: '檢驗',
  imaging_summary: '影像',
  test: '檢測',
  tests: '檢測',
  vaccine: '疫苗',
  vaccines: '疫苗',
  vaccination: '疫苗',
  tcm: '中醫',
  dental: '牙科',
}

const ENCOUNTER_CATEGORY_ORDER = [
  'diagnosis', 'condition', 'medication', 'laboratory', 'lab', 'lab_results',
  'imaging', 'imaging_summary', 'procedure', 'procedures', 'surgery', 'operation',
  'vaccine', 'test', 'tests',
]

type MonthGroup = { month: number; events: HealthTimelineEvent[] }
type YearGroup = { year: number; months: MonthGroup[] }

function normalizeType(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isReadableChineseLabel(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

function isImportant(event: HealthTimelineEvent): boolean {
  const normalized = normalizeType(event.event_type)
  return event.is_important || IMPORTANT_EVENT_TYPES.has(normalized)
}

function eventTypeLabel(value: string): string {
  return EVENT_TYPE_LABELS[normalizeType(value)] || (isReadableChineseLabel(value) ? value : '其他健康事件')
}

function sourceLabel(value: string): string {
  return SOURCE_LABELS[normalizeType(value)] || (isReadableChineseLabel(value) ? value : '其他資料來源')
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

function encounterCategoryLabel(value: string): string {
  const normalized = normalizeType(value).replace(/\s+/g, '_')
  return ENCOUNTER_CATEGORY_LABELS[normalized] || (isReadableChineseLabel(value) ? value : '其他健康資訊')
}

function categoryDisplayLabel(category: HealthTimelineDetailCategory): string {
  const mapped = ENCOUNTER_CATEGORY_LABELS[normalizeType(category.key).replace(/\s+/g, '_')]
  if (mapped) return mapped
  if (category.label && isReadableChineseLabel(category.label)) return category.label
  return '其他健康資訊'
}

function organizationMethodLabel(value: string): string {
  const normalized = normalizeType(value).replace(/[\s-]+/g, '_')
  if (normalized.includes('manual') || normalized.includes('human')) return '人工整理'
  if (normalized.includes('rule') || normalized.includes('deterministic')) return '規則整理'
  if (normalized.includes('ai') || normalized.includes('model')) return '系統輔助整理'
  return isReadableChineseLabel(value) ? value : '系統整理'
}

function focusKindLabel(value: string): string {
  const normalized = normalizeType(value).replace(/[\s-]+/g, '_')
  if (normalized === 'encounter') return '單次就醫重點'
  if (normalized === 'episode') return '健康問題歷程'
  return isReadableChineseLabel(value) ? value : '健康重點'
}

function focusStatusLabel(value: string): string {
  const normalized = normalizeType(value).replace(/[\s-]+/g, '_')
  if (['published', 'active', 'ready'].includes(normalized)) return '已呈現'
  if (['pending', 'draft', 'review'].includes(normalized)) return '整理中'
  return isReadableChineseLabel(value) ? value : '狀態已記錄'
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

function selectOptions(values: string[], labels: Record<string, string>, includeUnknown = false): string[] {
  return [...new Set(values.map(normalizeType))]
    .filter(Boolean)
    .filter((value) => includeUnknown || Boolean(labels[value]) || isReadableChineseLabel(value))
    .sort((a, b) => (labels[a] || a).localeCompare(labels[b] || b, 'zh-TW'))
}

type EncounterCardProps = {
  event: HealthTimelineEvent
  important: boolean
  showMemberBadge: boolean
}

function displayTitle(event: HealthTimelineEvent): string {
  return event.display_title?.trim() || event.title
}

function displaySummary(event: HealthTimelineEvent): string {
  return event.display_summary?.trim() || event.summary
}

function encounterFacility(event: HealthTimelineEvent): string {
  const legacyLabel = event.organization_label?.trim()
  const legacyFacility = legacyLabel && !['AI 整理', '規則整理'].includes(legacyLabel) ? legacyLabel : null
  return event.facility_name?.trim() || legacyFacility || '院所未提供'
}

function eventMetaText(event: HealthTimelineEvent): string {
  if (event.episode_id) {
    const start = event.episode_start_date || event.event_date || event.occurred_at
    const end = event.episode_end_date || start
    const fallbackDate = end || start || event.occurred_at
    const range = start && end && start !== end
      ? `${formatDate(start)}－${formatDate(end)}`
      : formatDate(fallbackDate)
    const visits = typeof event.visit_count === 'number' ? `${event.visit_count} 次就醫` : '相關就醫'
    return `${range} · ${visits}`
  }
  return `${formatDate(event.occurred_at)} · ${encounterFacility(event)}`
}

function encounterCategoryBadges(event: HealthTimelineEvent): { visible: string[]; remaining: number } {
  const values = [
    ...Object.entries(event.detail_counts ?? {})
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .map(([key]) => key),
    ...(event.included_types ?? []),
  ]
    .map((value) => ({ key: normalizeType(value).replace(/\s+/g, '_'), label: encounterCategoryLabel(value) }))
    .filter(({ key }) => !['encounter', 'outpatient', 'inpatient'].includes(key))
  const categories = [...new Map(values.map(({ label }) => [label, label])).values()]
  return { visible: categories.slice(0, 3), remaining: Math.max(0, categories.length - 3) }
}

function hasPublishedFocus(event: HealthTimelineEvent): boolean {
  return Boolean(event.display_title?.trim() && event.focus_method?.trim())
}

function EncounterCard({ event, important, showMemberBadge }: EncounterCardProps) {
  const router = useRouter()
  const sync = useSync()
  const [expanded, setExpanded] = useState(false)
  const [details, setDetails] = useState<HealthEncounterDetails | HealthEpisodeDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [savingFactIds, setSavingFactIds] = useState<Set<string>>(new Set())
  const [savedFactIds, setSavedFactIds] = useState<Set<string>>(new Set())
  const [confirmationFact, setConfirmationFact] = useState<HealthTimelineDetailItem | null>(null)
  const [confirmationStatus, setConfirmationStatus] = useState('')
  const requestVersion = useRef(0)
  const confirmationSelectRef = useRef<HTMLSelectElement>(null)
  const { canWriteMember, writeAccessReason } = useActiveMember()
  const { showToast } = useToast()
  const detailsId = `encounter-details-${event.id}`
  const title = displayTitle(event)
  const summary = displaySummary(event)
  const categoryBadges = encounterCategoryBadges(event)
  const hasFocus = hasPublishedFocus(event)
  const confirmation = reviewLabel(event.medical_confirmation || event.review_status)

  const loadDetails = useCallback(async () => {
    if (!event.encounter_id && !event.episode_id) return
    const version = requestVersion.current + 1
    requestVersion.current = version
    setDetailsLoading(true)
    setDetailsError('')
    try {
      const response = event.episode_id
        ? await getHealthEpisode(event.episode_id)
        : await getHealthEncounter(event.encounter_id as string)
      if (version !== requestVersion.current) return
      setDetails(response)
    } catch {
      if (version !== requestVersion.current) return
      setDetailsError('就醫明細目前無法載入，摘要仍可查看。')
    } finally {
      if (version === requestVersion.current) setDetailsLoading(false)
    }
  }, [event.encounter_id, event.episode_id])

  const toggleDetails = () => {
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (nextExpanded && !details && !detailsLoading) void loadDetails()
  }

  const sortCategories = (values: HealthTimelineDetailCategory[]) => [...values].sort((left, right) => {
    const leftIndex = ENCOUNTER_CATEGORY_ORDER.indexOf(normalizeType(left.key).replace(/\s+/g, '_'))
    const rightIndex = ENCOUNTER_CATEGORY_ORDER.indexOf(normalizeType(right.key).replace(/\s+/g, '_'))
    return (leftIndex < 0 ? ENCOUNTER_CATEGORY_ORDER.length : leftIndex) - (rightIndex < 0 ? ENCOUNTER_CATEGORY_ORDER.length : rightIndex)
  })
  const episodeDetails = details && 'visits' in details ? details : null
  const encounterDetails = details && 'categories' in details ? details : null
  const categories = sortCategories(encounterDetails?.categories ?? [])
  const primaryItems = episodeDetails
    ? episodeDetails.visits.flatMap((visit) => visit.categories.flatMap((category) => category.items.filter((item) => item.is_primary)))
    : categories.flatMap((category) => category.items.filter((item) => item.is_primary))

  const saveFact = async (item: HealthTimelineDetailItem, explicitStatus: string) => {
    if (!item.profile_kind || item.saved_to_profile || savedFactIds.has(item.id)) return
    if (!explicitStatus) {
      showToast('請先選擇目前狀態，再加入健康檔案。', 'info')
      return
    }
    if (!canWriteMember(event.member_name)) {
      showToast(writeAccessReason(event.member_name) ?? '目前身份為唯讀，無法加入健康檔案。', 'info')
      return
    }
    setSavingFactIds((current) => new Set(current).add(item.id))
    try {
      const savedResource = await saveNhiFactToProfile(
        item.id,
        item.profile_kind === 'condition' ? { status: explicitStatus } : { usage_status: explicitStatus },
      )
      setSavedFactIds((current) => new Set(current).add(item.id))
      setConfirmationFact(null)
      setConfirmationStatus('')
      sync.refreshNow()
      const savedMember = savedResource.resource?.member_name || event.member_name
      const destination = item.profile_kind === 'condition' ? '/dashboard/conditions' : '/dashboard/medications'
      const destinationLabel = item.profile_kind === 'condition' ? '查看我的病況' : '查看我的用藥'
      showToast(
        item.profile_kind === 'condition'
          ? '已加入我的病況，請確認目前是否仍需追蹤'
          : '已加入我的用藥，請確認目前是否仍在服用',
        'success',
        {
          label: destinationLabel,
          onClick: () => router.push(memberHref(destination, savedMember)),
          durationMs: 10000,
        },
      )
    } catch {
      showToast('加入健康檔案失敗，請稍後再試。', 'error')
    } finally {
      setSavingFactIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  const openFactConfirmation = (item: HealthTimelineDetailItem) => {
    if (!canWriteMember(event.member_name)) {
      showToast(writeAccessReason(event.member_name) ?? '目前身份為唯讀，無法加入健康檔案。', 'info')
      return
    }
    setConfirmationStatus('')
    setConfirmationFact(item)
  }

  const renderFactItem = (item: HealthTimelineDetailItem) => {
    const saved = Boolean(item.saved_to_profile || savedFactIds.has(item.id))
    const saving = savingFactIds.has(item.id)
    const actionLabel = item.profile_kind === 'condition' ? '加入我的病況' : '加入我的用藥'
    return (
      <li key={item.id} className={styles.categoryItem}>
        <span className={styles.factTitle}>{item.title}</span>
        {item.summary && item.summary !== item.title && <span className={styles.categoryItemSummary}>{item.summary}</span>}
        <div className={styles.factMeta}>
          {item.source_type && <span className="hk-badge hk-b-blue">{sourceLabel(item.source_type)}</span>}
          {item.can_save_to_profile && item.profile_kind && (
            <button
              type="button"
              className={styles.saveFactButton}
              disabled={saved || saving}
              onClick={() => openFactConfirmation(item)}
            >
              {saving ? '加入中…' : saved ? '已加入我的健康檔案' : actionLabel}
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <article className={`${styles.event} ${styles.encounter} ${event.episode_id ? styles.episode : ''} ${important ? styles.eventImportant : ''}`} data-testid={event.episode_id ? 'episode-card' : 'encounter-card'}>
      <div className={styles.encounterHeader}>
        <div className={styles.encounterHeading}>
          <div className={styles.encounterMeta}>
            <time dateTime={event.occurred_at}>{eventMetaText(event)}</time>
          </div>
          <h4 id={`encounter-title-${event.id}`} className={styles.eventTitle}>{title}</h4>
        </div>
        <div className={styles.encounterAction}>
          <button
            type="button"
            className={styles.encounterToggle}
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`${expanded ? '收合' : '展開'} ${title}的明細`}
            onClick={toggleDetails}
          >
            <span>{expanded ? '收合明細' : '展開明細'}</span>
            <span aria-hidden="true">{expanded ? '−' : '+'}</span>
          </button>
        </div>
      </div>

      <p className={styles.eventSummary}>{summary}</p>
      {event.primary_topics && event.primary_topics.length > 0 && (
        <div className={styles.keyFacts} aria-label="關鍵事實">
          <span className={styles.keyFactsLabel}>關鍵事實</span>
          {event.primary_topics.slice(0, 4).map((topic) => <span key={topic}>{topic}</span>)}
        </div>
      )}
      <div className={styles.badges} aria-label="就醫事件標籤">
        {categoryBadges.visible.map((category) => <span key={category} className="hk-badge hk-b-gray">{category}</span>)}
        {categoryBadges.remaining > 0 && <span className="hk-badge hk-b-gray">+{categoryBadges.remaining}</span>}
        {event.episode_id && <span className="hk-badge hk-b-green">健康問題歷程</span>}
        {hasFocus && <span className="hk-badge hk-b-cmo">系統整理重點</span>}
        <span className="hk-badge hk-b-blue">健保存摺</span>
        <span className={`hk-badge ${confirmation.className}`}>{confirmation.label}</span>
        {showMemberBadge && event.member_name && <span className="hk-badge hk-b-accent">{event.member_name}</span>}
        {important && <span className="hk-badge hk-b-amber">重要事件類型</span>}
      </div>

      {(typeof event.record_count === 'number' || typeof event.source_count === 'number') && (
        <div className={styles.encounterFooter}>
          <div className={styles.encounterCounts} aria-label="就醫整合摘要">
            {event.episode_id && typeof event.visit_count === 'number'
              ? <span>串連 {event.visit_count} 次就醫</span>
              : typeof event.record_count === 'number' && <span>整合 {event.record_count} 筆</span>}
            {typeof event.source_count === 'number' && <span>{event.source_count} 個來源</span>}
          </div>
        </div>
      )}

      <div id={detailsId} className={styles.encounterDetails} role="region" aria-labelledby={`encounter-title-${event.id}`} aria-busy={detailsLoading} hidden={!expanded}>
        <h5 className={styles.srOnly}>{title}的分類明細</h5>
        {event.rule_summary && (
          <section className={styles.ruleSummary} aria-labelledby={`${detailsId}-rule-summary`}>
            <h6 id={`${detailsId}-rule-summary`} className={styles.detailSectionTitle}>資料如何整理</h6>
            <p>{event.rule_summary}</p>
          </section>
        )}
        {detailsLoading && <p className={styles.detailStatus} role="status">正在載入分類明細…</p>}
        {detailsError && (
          <div className={styles.detailError} role="alert">
            <span>{detailsError}</span>
            <button type="button" className={styles.detailRetry} onClick={() => void loadDetails()} disabled={detailsLoading}>重試展開</button>
          </div>
        )}
        {!detailsLoading && !detailsError && details && primaryItems.length > 0 && (
          <section className={styles.primarySection} aria-labelledby={`${detailsId}-primary`}>
            <h6 id={`${detailsId}-primary`} className={styles.detailSectionTitle}>{event.episode_id ? '這段歷程以什麼健康問題串連' : '這次主要看到'}</h6>
            <ul className={styles.primaryItems}>
              {primaryItems.map((item) => <li key={item.id}>{item.title}</li>)}
            </ul>
          </section>
        )}
        {!detailsLoading && !detailsError && encounterDetails && categories.length === 0 && (
          <p className={styles.detailStatus}>目前沒有可顯示的分類明細。</p>
        )}
        {!detailsLoading && !detailsError && encounterDetails && categories.length > 0 && (
          <div className={styles.categoryGrid}>
            {categories.map((category) => (
              <section key={category.key} className={styles.categorySection} aria-labelledby={`${detailsId}-${category.key}`}>
                <div className={styles.categoryHeader}>
                  <h6 id={`${detailsId}-${category.key}`} className={styles.categoryTitle}>{categoryDisplayLabel(category)}</h6>
                  <span className={styles.categoryCount}>{category.count} 筆</span>
                </div>
                {category.items.length > 0 ? (
                  <ul className={styles.categoryItems}>
                    {category.items.map(renderFactItem)}
                  </ul>
                ) : <p className={styles.detailStatus}>此分類沒有可顯示的項目。</p>}
              </section>
            ))}
          </div>
        )}
        {!detailsLoading && !detailsError && episodeDetails && episodeDetails.visits.length === 0 && (
          <p className={styles.detailStatus}>目前沒有可顯示的就醫明細。</p>
        )}
        {!detailsLoading && !detailsError && episodeDetails && episodeDetails.visits.length > 0 && (
          <div className={styles.visitList}>
            {episodeDetails.visits.map((visit, visitIndex) => (
              <section key={visit.encounter_id} className={styles.visitSection} aria-labelledby={`${detailsId}-visit-${visit.encounter_id}`}>
                <div className={styles.visitHeader}>
                  <div>
                    <div className={styles.visitEyebrow}>第 {episodeDetails.visits.length - visitIndex} 次相關就醫</div>
                    <h6 id={`${detailsId}-visit-${visit.encounter_id}`} className={styles.visitTitle}>
                      {visit.date ? formatDate(visit.date) : '日期未提供'} · {visit.facility || '院所未提供'}
                    </h6>
                  </div>
                  <span className={styles.visitCount}>{visit.source_count} 個來源</span>
                </div>
                <div className={styles.categoryGrid}>
                  {sortCategories(visit.categories).map((category) => (
                    <section key={category.key} className={styles.categorySection} aria-label={categoryDisplayLabel(category)}>
                      <div className={styles.categoryHeader}>
                        <h6 className={styles.categoryTitle}>{categoryDisplayLabel(category)}</h6>
                        <span className={styles.categoryCount}>{category.count} 項</span>
                      </div>
                      <ul className={styles.categoryItems}>{category.items.map(renderFactItem)}</ul>
                    </section>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {(event.source_id !== null && event.source_id !== undefined
          || event.policy_version
          || event.organization_method
          || event.focus_kind
          || event.focus_status
          || event.created_at) && (
          <details className={styles.technicalDetails}>
            <summary>原始事件、代碼與技術欄位</summary>
            <dl className={styles.technicalList}>
              <div><dt>事件類型</dt><dd>{eventTypeLabel(event.event_type)}</dd></div>
              {event.source_id !== null && event.source_id !== undefined && <div><dt>來源記錄</dt><dd>已保留於系統</dd></div>}
              {event.policy_version && <div><dt>整理規則版本</dt><dd>{event.policy_version}</dd></div>}
              {event.organization_method && <div><dt>整理方法</dt><dd>{organizationMethodLabel(event.organization_method)}</dd></div>}
              {event.focus_kind && <div><dt>重點類型</dt><dd>{focusKindLabel(event.focus_kind)}</dd></div>}
              {event.focus_status && <div><dt>重點狀態</dt><dd>{focusStatusLabel(event.focus_status)}</dd></div>}
              {event.created_at && <div><dt>建立時間</dt><dd>{event.created_at}</dd></div>}
            </dl>
          </details>
        )}
      </div>
      <AccessibleDialog
        open={Boolean(confirmationFact)}
        onClose={() => {
          if (confirmationFact && savingFactIds.has(confirmationFact.id)) return
          setConfirmationFact(null)
          setConfirmationStatus('')
        }}
        title={confirmationFact?.profile_kind === 'condition' ? '確認目前病況狀態' : '確認目前是否使用這項藥物'}
        description={confirmationFact?.profile_kind === 'condition'
          ? '健保內容是就醫證據，不代表目前仍有這個病況。請依你現在知道的情況選擇。'
          : '處方、調劑或院內給藥不代表目前仍在服用。請依你實際使用情況選擇；不確定也可以如實標記。'}
        initialFocusRef={confirmationSelectRef}
      >
        {confirmationFact && (
          <form onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            void saveFact(confirmationFact, confirmationStatus)
          }}>
            <div className="hk-field">
              <label htmlFor={`${detailsId}-candidate-status`} className="hk-label">
                {confirmationFact.profile_kind === 'condition' ? '這個病況目前的狀態' : '你目前是否使用這項藥物'}
              </label>
              <select
                ref={confirmationSelectRef}
                id={`${detailsId}-candidate-status`}
                className="hk-input"
                value={confirmationStatus}
                onChange={(changeEvent) => setConfirmationStatus(changeEvent.target.value)}
                required
              >
                <option value="">請選擇目前狀態</option>
                {(confirmationFact.profile_kind === 'condition'
                  ? PATIENT_CONDITION_STATUS_OPTIONS
                  : PATIENT_MEDICATION_USAGE_OPTIONS
                ).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </div>
            <div className="hk-card" role="note" style={{ marginTop: 14 }}>
              <strong>{confirmationFact.title}</strong>
              {confirmationFact.summary && confirmationFact.summary !== confirmationFact.title && <p>{confirmationFact.summary}</p>}
              <p style={{ marginBottom: 0 }}>加入後會標示為「健保匯入、由我確認目前狀態」，不會被標成醫療團隊已確認。</p>
            </div>
            <div className="hk-dialog-actions">
              <button
                type="button"
                className="hk-btn hk-btn-ghost"
                disabled={savingFactIds.has(confirmationFact.id)}
                onClick={() => {
                  setConfirmationFact(null)
                  setConfirmationStatus('')
                }}
              >
                取消
              </button>
              <button
                type="submit"
                className="hk-btn hk-btn-primary"
                disabled={!confirmationStatus || savingFactIds.has(confirmationFact.id)}
              >
                {savingFactIds.has(confirmationFact.id) ? '加入中…' : '確認並加入'}
              </button>
            </div>
          </form>
        )}
      </AccessibleDialog>
    </article>
  )
}

type LegacyEventCardProps = EncounterCardProps & { review: { label: string; className: string } }

function LegacyEventCard({ event, important, review, showMemberBadge }: LegacyEventCardProps) {
  return (
    <article className={`${styles.event} ${important ? styles.eventImportant : ''}`}>
      <div className={styles.eventTop}>
        <h4 className={styles.eventTitle}>{event.title}</h4>
        <time className={styles.eventDate} dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
      </div>
      <p className={styles.eventSummary}>{event.summary}</p>
      <div className={styles.badges} aria-label="事件標籤">
        <span className="hk-badge hk-b-gray">{eventTypeLabel(event.event_type)}</span>
        <span className="hk-badge hk-b-blue">{sourceLabel(event.source_type)}</span>
        {event.organization_label && <span className="hk-badge hk-b-cmo">{organizationMethodLabel(event.organization_label)}</span>}
        <span className={`hk-badge ${review.className}`}>{review.label}</span>
        {showMemberBadge && event.member_name && <span className="hk-badge hk-b-accent">{event.member_name}</span>}
        {important && <span className="hk-badge hk-b-amber">重要事件類型</span>}
      </div>
      {(event.source_id !== null && event.source_id !== undefined || event.policy_version || event.organization_method || event.created_at) && (
        <details className={styles.technicalDetails}>
          <summary>原始事件與技術欄位</summary>
          <dl className={styles.technicalList}>
            <div><dt>事件類型</dt><dd>{eventTypeLabel(event.event_type)}</dd></div>
            {event.source_id !== null && event.source_id !== undefined && <div><dt>來源記錄</dt><dd>已保留於系統</dd></div>}
            {event.policy_version && <div><dt>整理規則版本</dt><dd>{event.policy_version}</dd></div>}
            {event.organization_method && <div><dt>整理方法</dt><dd>{organizationMethodLabel(event.organization_method)}</dd></div>}
            {event.created_at && <div><dt>建立時間</dt><dd>{event.created_at}</dd></div>}
          </dl>
        </details>
      )}
    </article>
  )
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
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const [failedRequest, setFailedRequest] = useState<{ cursor: string | null; append: boolean } | null>(null)
  const hasSnapshotRef = useRef(false)
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
    setFailedRequest(null)
    try {
      const response = await getHealthTimeline({ ...query, cursor })
      if (version !== requestVersion.current) return
      setItems((previous) => append ? [...previous, ...response.items] : response.items)
      setNextCursor(response.next_cursor)
      hasSnapshotRef.current = true
      setHasSnapshot(true)
    } catch {
      if (version !== requestVersion.current) return
      setError('健康時間軸目前無法載入，請稍後重試。')
      setFailedRequest({ cursor, append })
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
  const showMemberBadge = !memberFilter && members.length > 1
  const showFullPageError = Boolean(error) && !hasSnapshotRef.current && !hasSnapshot

  const retryFailedRequest = () => {
    void loadPage(failedRequest?.cursor ?? null, failedRequest?.append ?? false)
  }

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

      <details className={styles.filterDisclosure} open>
        <summary className={styles.filterSummary}>篩選條件</summary>
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
      </details>

      {showFullPageError ? (
        <section className={`hk-card ${styles.error}`} role="alert">
          <div className={styles.errorTitle}>時間軸暫時無法載入</div>
          <p className={styles.errorText}>{error}</p>
          <button type="button" className={styles.retry} onClick={retryFailedRequest} disabled={loading}>
            {loading ? '載入中…' : '重試'}
          </button>
        </section>
      ) : loading && !hasSnapshot && items.length === 0 ? (
        <section className="hk-card" role="status" aria-live="polite" aria-busy="true">
          <div className={styles.loadingLine} style={{ width: '42%' }} />
          <div className={styles.loadingLine} style={{ width: '88%' }} />
          <div className={styles.loadingLine} style={{ width: '64%' }} />
          <p className={styles.emptyText}>正在載入健康事件…</p>
        </section>
      ) : (
        <>
          {error && hasSnapshot && (
            <section className={`hk-card ${styles.error}`} role="alert">
              <div className={styles.errorTitle}>無法更新時間軸</div>
              <p className={styles.errorText}>{error} 畫面已保留上一次成功載入的內容，尚未將這次失敗顯示成沒有資料。</p>
              <button type="button" className={styles.retry} onClick={retryFailedRequest} disabled={loading}>
                {loading ? '載入中…' : failedRequest?.append ? '重試載入更多' : '重試目前篩選'}
              </button>
            </section>
          )}
          {items.length === 0 ? (
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
                          return event.encounter_id || event.episode_id ? (
                            <EncounterCard key={event.id} event={event} important={important} showMemberBadge={showMemberBadge} />
                          ) : (
                            <LegacyEventCard key={event.id} event={event} important={important} review={review} showMemberBadge={showMemberBadge} />
                          )
                        })}
                      </section>
                    ))}
                  </div>
                </section>
              )
            })}
            {nextCursor && !error && (
              <div className={styles.loadMoreWrap}>
                <button type="button" className={styles.loadMore} onClick={() => void loadPage(nextCursor, true)} disabled={loading}>
                  {loading ? '載入中…' : '載入更多事件'}
                </button>
              </div>
            )}
          </div>
        </div>
          )}
        </>
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
