// Shared pure helpers for the CMO patient workspace (Phase 2 extraction from
// page.tsx). Types are imported type-only from page.tsx, so there is no runtime
// import cycle (type imports are erased at compile time).
import type { RecommendationForm, CmoRecommendation, PriorityReviewItem, RecommendationSourceRef, PublishMode, HealthRecord } from './page'

export const DEFAULT_RECOMMENDATION_TITLE = 'CMO 最新健康建議'
export const INTERNAL_NOTE_MARKERS = ['internal note', 'cmo-only', 'cmo only', 'handoff', 'do not publish', '不要發布', '不要給病人', '內部備註', '交班']

export function defaultRecommendationForm(): RecommendationForm {
  return {
    series_id: '',
    title: DEFAULT_RECOMMENDATION_TITLE,
    health_summary: '',
    recommendation: '',
    next_step: '',
    follow_up_date: '',
    source_refs: [],
  }
}

export function recommendationFormFromRow(row: CmoRecommendation | null): RecommendationForm {
  if (!row) return defaultRecommendationForm()
  return {
    series_id: row.series_id,
    title: row.title || DEFAULT_RECOMMENDATION_TITLE,
    health_summary: row.health_summary || '',
    recommendation: row.recommendation || '',
    next_step: row.next_step || '',
    follow_up_date: row.follow_up_date || '',
    source_refs: row.source_refs || [],
  }
}

export function simplifyMedicalLanguage(text: string) {
  return text
    .replace(/\b[A-Z]\d{2}(?:\.\d+)?\b/g, '')
    .replace(/Hypertension/gi, '高血壓')
    .replace(/Type 2 diabetes mellitus/gi, '第二型糖尿病')
    .replace(/Hyperlipidemia/gi, '高血脂')
    .replace(/Chronic kidney disease|CKD/gi, '慢性腎臟病')
    .replace(/Suspected atrial fibrillation/gi, '疑似心房顫動')
    .replace(/\beGFR\b/g, '腎功能指標 eGFR')
    .replace(/\bHbA1c\b/g, '糖化血色素 HbA1c')
    .replace(/\bLDL\b/g, '低密度膽固醇 LDL')
    .replace(/\babnormal findings?\b/gi, '需要留意的結果')
    .replace(/\bconfirmed\b/gi, '已確認')
    .replace(/\bunconfirmed\b/gi, '尚未確認')
    .replace(/\s+/g, ' ')
    .trim()
}

export function recommendationSourceFromItem(item: PriorityReviewItem): RecommendationSourceRef {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    source: item.source,
    status: item.status,
  }
}

export function recommendationChecks(form: RecommendationForm) {
  const text = [form.title, form.health_summary, form.recommendation, form.next_step].join('\n')
  const lower = text.toLowerCase()
  const noInternalNote = !INTERNAL_NOTE_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))
  const noUnconfirmedSources = form.source_refs.every((ref) => {
    const source = ref.source.toLowerCase()
    const status = ref.status.toLowerCase()
    const isSystem = source.includes('system') || source.includes('extracted')
    const isConfirmed = ['confirmed', 'published', 'accepted', 'reviewed', 'imported'].some((token) => status.includes(token))
    return !isSystem || isConfirmed
  })
  return {
    plain_language: !/\b[A-Z]\d{2}(?:\.\d+)?\b/.test(text),
    has_next_step: Boolean(form.next_step.trim()),
    has_follow_up_or_missing_data: Boolean(form.follow_up_date.trim() || /補資料|補充|上傳|回覆/.test(form.next_step)),
    no_internal_note: noInternalNote,
    no_unconfirmed_sources: noUnconfirmedSources,
    medical_safety_copy: !/保證|一定會|診斷為|絕對/.test(text),
  }
}

export function allRecommendationChecksPass(checks: Record<string, boolean>) {
  return Object.values(checks).every(Boolean)
}

export const PUBLISH_MODE_COPY: Record<PublishMode, { label: string; help: string; submit: string }> = {
  publish_now: {
    label: 'Accept & Publish now',
    help: '病人端會立即看到正式資料。',
    submit: 'Accept modified & publish',
  },
  verify_draft: {
    label: 'Accept as verified draft',
    help: '只在 CMO Panel 中可見，病人端暫時看不到。',
    submit: 'Accept modified as draft',
  },
  verify_needs_secondary_review: {
    label: 'Mark for secondary review',
    help: '保留在 queue 中，需再次確認。',
    submit: 'Send to secondary review',
  },
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '未記錄'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export const RECORD_LABELS: Record<string, string> = { blood_pressure: '血壓', heart_rate: '心率', glucose: '血糖', weight: '體重', steps: '步數', sleep: '睡眠', bmi: 'BMI', body_fat: '體脂', temperature: '體溫', spo2: '血氧', hba1c: 'HbA1c' }
export const DOC_LABELS: Record<string, string> = { lab_report: '檢驗報告', prescription: '處方', discharge: '出院摘要', image: '影像', other: '其他' }

export function formatRecordValue(record: HealthRecord) {
  if (record.record_type === 'blood_pressure' && record.value1 && record.value2) return `${record.value1}/${record.value2} ${record.unit ?? 'mmHg'}`
  return `${record.value1 ?? '-'}${record.unit ? ` ${record.unit}` : ''}`
}

export function formatFileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
