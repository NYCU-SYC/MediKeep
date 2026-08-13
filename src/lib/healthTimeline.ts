import { api, ApiError } from '@/lib/api'

export type HealthTimelineEvent = {
  id: string
  occurred_at: string
  event_date?: string | null
  event_type: string
  title: string
  summary: string
  display_title?: string | null
  display_summary?: string | null
  facility_name?: string | null
  source_type: string
  review_status: string
  organization_label: string | null
  is_important: boolean
  member_name: string | null
  encounter_id?: string | null
  episode_id?: string | null
  episode_start_date?: string | null
  episode_end_date?: string | null
  visit_count?: number | null
  included_types?: string[]
  record_count?: number | null
  source_count?: number | null
  detail_counts?: Record<string, number>
  rule_summary?: string | null
  ai_summary?: string | null
  policy_version?: string | null
  focus_kind?: string | null
  focus_status?: string | null
  focus_method?: string | null
  primary_topics?: string[]
  status?: string | null
  source_id?: string | number | null
  created_at?: string | null
  ai_organized?: boolean
  organization_method?: string | null
  medical_confirmation?: string | null
}

export type HealthTimelineResponse = {
  items: HealthTimelineEvent[]
  next_cursor: string | null
}

export type HealthTimelineQuery = {
  member?: string | null
  year?: string | null
  event_type?: string | null
  source_type?: string | null
  cursor?: string | null
  limit?: number
  from?: string | null
  to?: string | null
}

export type HealthTimelineDetailItem = {
  id: string
  title: string
  summary: string | null
  occurred_at: string | null
  source_type: string | null
  is_primary?: boolean
  profile_kind?: 'condition' | 'medication' | null
  can_save_to_profile?: boolean
  saved_to_profile?: boolean
  saved_target_type?: 'condition' | 'medication' | null
  saved_target_id?: string | null
}

export type HealthTimelineDetailCategory = {
  key: string
  label: string
  count: number
  items: HealthTimelineDetailItem[]
}

export type HealthTimelineProvenance = {
  source_type: string
  source_label: string | null
  record_count: number | null
}

export type HealthEncounterDetails = {
  encounter_id: string
  categories: HealthTimelineDetailCategory[]
  provenance: HealthTimelineProvenance[]
}

export type HealthEpisodeVisit = {
  encounter_id: string
  date: string | null
  facility: string | null
  categories: HealthTimelineDetailCategory[]
  record_count: number
  source_count: number
  link_reason: string
}

export type HealthEpisodeDetails = {
  episode_id: string
  display_title: string
  display_summary: string | null
  start_date: string | null
  end_date: string | null
  visit_count: number
  source_count: number
  included_types: string[]
  detail_counts: Record<string, number>
  rule_summary: string | null
  policy_version: string | null
  visits: HealthEpisodeVisit[]
  provenance: HealthTimelineProvenance[]
}

export class HealthTimelineContractError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(message, 502, 'invalid_health_timeline_contract', details)
    this.name = 'HealthTimelineContractError'
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new HealthTimelineContractError(`Health timeline field ${field} is missing or invalid`)
  }
  return value
}

function requiredId(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new HealthTimelineContractError(`Health timeline field ${field} is missing or invalid`)
}

function nullableString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new HealthTimelineContractError(`Health timeline field ${field} is invalid`)
  }
  return value
}

function optionalString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  if (value === null || value === undefined) return null
  return typeof value === 'string' && value.trim() ? value : null
}

function optionalNumber(record: Record<string, unknown>, field: string): number | null {
  const value = record[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalBoolean(record: Record<string, unknown>, field: string): boolean | undefined {
  const value = record[field]
  return typeof value === 'boolean' ? value : undefined
}

function optionalStringArray(record: Record<string, unknown>, field: string): string[] | undefined {
  const value = record[field]
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  return strings.length === value.length ? strings : undefined
}

function optionalNumberMap(record: Record<string, unknown>, field: string): Record<string, number> | undefined {
  const value = asRecord(record[field])
  if (!value) return undefined
  const entries = Object.entries(value)
  if (entries.some(([, item]) => typeof item !== 'number' || !Number.isFinite(item))) return undefined
  return Object.fromEntries(entries.map(([key, item]) => [key, item as number]))
}

function requiredBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field]
  if (typeof value !== 'boolean') {
    throw new HealthTimelineContractError(`Health timeline field ${field} is missing or invalid`)
  }
  return value
}

function parseEvent(raw: unknown): HealthTimelineEvent {
  const record = asRecord(raw)
  if (!record) throw new HealthTimelineContractError('Health timeline item is not an object')
  const displayTitle = optionalString(record, 'display_title')
  const title = displayTitle ?? optionalString(record, 'title')
  if (!title) throw new HealthTimelineContractError('Health timeline field title is missing or invalid')
  const displaySummary = optionalString(record, 'display_summary')
  const summary = displaySummary ?? optionalString(record, 'summary')
  if (!summary) throw new HealthTimelineContractError('Health timeline field summary is missing or invalid')
  const occurredAt = optionalString(record, 'occurred_at') ?? optionalString(record, 'event_date')
  if (!occurredAt) throw new HealthTimelineContractError('Health timeline field occurred_at is missing or invalid')
  const event: HealthTimelineEvent = {
    id: requiredId(record, 'id'),
    occurred_at: occurredAt,
    event_type: requiredString(record, 'event_type'),
    title,
    summary,
    source_type: requiredString(record, 'source_type'),
    review_status: requiredString(record, 'review_status'),
    organization_label: nullableString(record, 'organization_label'),
    is_important: requiredBoolean(record, 'is_important'),
    member_name: nullableString(record, 'member_name'),
  }
  if (record.event_date !== undefined) event.event_date = optionalString(record, 'event_date')
  if (displayTitle) event.display_title = displayTitle
  if (displaySummary) event.display_summary = displaySummary
  if (record.facility_name !== undefined) event.facility_name = nullableString(record, 'facility_name')
  const encounterId = optionalString(record, 'encounter_id')
  if (encounterId) event.encounter_id = encounterId
  const episodeId = optionalString(record, 'episode_id')
  if (episodeId) event.episode_id = episodeId
  if (record.episode_start_date !== undefined) event.episode_start_date = optionalString(record, 'episode_start_date')
  if (record.episode_end_date !== undefined) event.episode_end_date = optionalString(record, 'episode_end_date')
  if (record.visit_count !== undefined) event.visit_count = optionalNumber(record, 'visit_count')
  const includedTypes = optionalStringArray(record, 'included_types')
  if (includedTypes) event.included_types = includedTypes
  if (record.record_count !== undefined) event.record_count = optionalNumber(record, 'record_count')
  if (record.source_count !== undefined) event.source_count = optionalNumber(record, 'source_count')
  const detailCounts = optionalNumberMap(record, 'detail_counts')
  if (detailCounts) event.detail_counts = detailCounts
  if (record.rule_summary !== undefined) event.rule_summary = optionalString(record, 'rule_summary')
  if (record.ai_summary !== undefined) event.ai_summary = optionalString(record, 'ai_summary')
  if (record.policy_version !== undefined) event.policy_version = optionalString(record, 'policy_version')
  const focusKind = optionalString(record, 'focus_kind')
  if (focusKind) event.focus_kind = focusKind
  const focusStatus = optionalString(record, 'focus_status')
  if (focusStatus) event.focus_status = focusStatus
  if (record.focus_method !== undefined) event.focus_method = optionalString(record, 'focus_method')
  const primaryTopics = optionalStringArray(record, 'primary_topics')
  if (primaryTopics) event.primary_topics = primaryTopics
  if (record.status !== undefined) event.status = optionalString(record, 'status')
  if (typeof record.source_id === 'string' || typeof record.source_id === 'number') event.source_id = record.source_id
  if (record.created_at !== undefined) event.created_at = optionalString(record, 'created_at')
  const aiOrganized = optionalBoolean(record, 'ai_organized')
  if (aiOrganized !== undefined) event.ai_organized = aiOrganized
  if (record.organization_method !== undefined) event.organization_method = optionalString(record, 'organization_method')
  if (record.medical_confirmation !== undefined) event.medical_confirmation = optionalString(record, 'medical_confirmation')
  return event
}

function parseResponse(raw: unknown): HealthTimelineResponse {
  const root = asRecord(raw)
  const record = root && asRecord(root.data) ? asRecord(root.data) as Record<string, unknown> : root
  if (!record || !Array.isArray(record.items)) {
    throw new HealthTimelineContractError('Health timeline response must contain items')
  }
  const cursor = record.next_cursor
  if (cursor !== null && cursor !== undefined && typeof cursor !== 'string') {
    throw new HealthTimelineContractError('Health timeline next_cursor is invalid')
  }
  return {
    items: record.items.map(parseEvent),
    next_cursor: cursor ?? null,
  }
}

export async function getHealthTimeline(query: HealthTimelineQuery = {}): Promise<HealthTimelineResponse> {
  const params: Record<string, string> = {}
  const values: Array<[keyof HealthTimelineQuery, string]> = [
    ['member', query.member ?? ''],
    ['year', query.year ?? ''],
    ['event_type', query.event_type ?? ''],
    ['source_type', query.source_type ?? ''],
    ['cursor', query.cursor ?? ''],
    ['from', query.from ?? ''],
    ['to', query.to ?? ''],
  ]
  for (const [key, value] of values) if (value) params[key] = value
  if (query.limit !== undefined) params.limit = String(query.limit)
  return parseResponse(await api.get('/api/patients/me/health-timeline', params))
}

function categoryLabel(value: string): string {
  const labels: Record<string, string> = {
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
    imaging_summary: '影像',
    procedure: '處置／手術',
    procedures: '處置／手術',
    surgery: '手術',
    surgeries: '手術',
    operation: '手術',
    operations: '手術',
    vaccine: '疫苗',
    vaccines: '疫苗',
    vaccination: '疫苗',
    test: '檢測',
    tests: '檢測',
    lab_results: '檢驗',
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_')
  return labels[normalized] || value
}

function parseDetailItem(raw: unknown, index: number): HealthTimelineDetailItem | null {
  if (typeof raw === 'string' && raw.trim()) {
    return { id: `${index}`, title: raw, summary: null, occurred_at: null, source_type: null }
  }
  const record = asRecord(raw)
  if (!record) return null
  const title = [record.title, record.name, record.label, record.value]
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
  if (!title) return null
  const id = typeof record.id === 'string' || typeof record.id === 'number'
    ? String(record.id)
    : `${index}`
  const item: HealthTimelineDetailItem = {
    id,
    title,
    summary: optionalString(record, 'summary') ?? optionalString(record, 'description'),
    occurred_at: optionalString(record, 'occurred_at') ?? optionalString(record, 'date'),
    source_type: optionalString(record, 'source_type'),
  }
  const isPrimary = optionalBoolean(record, 'is_primary')
  if (isPrimary !== undefined) item.is_primary = isPrimary
  const profileKind = optionalString(record, 'profile_kind')
  if (profileKind === 'condition' || profileKind === 'medication') item.profile_kind = profileKind
  const canSave = optionalBoolean(record, 'can_save_to_profile')
  if (canSave !== undefined) item.can_save_to_profile = canSave
  const saved = optionalBoolean(record, 'saved_to_profile')
  if (saved !== undefined) item.saved_to_profile = saved
  const savedTargetType = optionalString(record, 'saved_target_type')
  if (savedTargetType === 'condition' || savedTargetType === 'medication') item.saved_target_type = savedTargetType
  const savedTargetId = record.saved_target_id
  if (typeof savedTargetId === 'string' || typeof savedTargetId === 'number') item.saved_target_id = String(savedTargetId)
  return item
}

function parseCategory(key: string, raw: unknown): HealthTimelineDetailCategory | null {
  const record = asRecord(raw)
  const itemsValue = Array.isArray(raw)
    ? raw
    : record && Array.isArray(record.items)
      ? record.items
      : null
  if (!itemsValue) return null
  const items = itemsValue.map(parseDetailItem).filter((item): item is HealthTimelineDetailItem => item !== null)
  const label = record && typeof record.label === 'string' && record.label.trim()
    ? record.label
    : categoryLabel(key)
  const count = record && typeof record.count === 'number' && Number.isFinite(record.count)
    ? record.count
    : items.length
  return { key, label, count, items }
}

function parseCategories(raw: unknown): HealthTimelineDetailCategory[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      const record = asRecord(item)
      const key = record && [record.key, record.type, record.category, record.name]
        .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      return key ? [parseCategory(key, item)].filter((category): category is HealthTimelineDetailCategory => category !== null) : []
    })
  }
  const record = asRecord(raw)
  if (!record) return []
  return Object.entries(record).flatMap(([key, value]) => {
    const category = parseCategory(key, value)
    return category ? [category] : []
  })
}

function parseProvenance(raw: unknown): HealthTimelineProvenance[] {
  const values = Array.isArray(raw)
    ? raw
    : asRecord(raw)
      ? Object.entries(asRecord(raw) as Record<string, unknown>).map(([source_type, value]) => ({ source_type, value }))
      : []
  return values.flatMap((value) => {
    const record = asRecord(value)
    if (!record) return []
    const sourceType = optionalString(record, 'source_type') ?? optionalString(record, 'type') ?? optionalString(record, 'source')
    if (!sourceType) return []
    return [{
      source_type: sourceType,
      source_label: optionalString(record, 'source_label') ?? optionalString(record, 'label'),
      record_count: optionalNumber(record, 'record_count') ?? optionalNumber(record, 'count'),
    }]
  })
}

function parseEncounterDetails(raw: unknown, fallbackEncounterId: string): HealthEncounterDetails {
  const root = asRecord(raw)
  const record = root && asRecord(root.data) ? asRecord(root.data) as Record<string, unknown> : root
  if (!record) throw new HealthTimelineContractError('Health encounter response must be an object')
  const encounterId = optionalString(record, 'encounter_id') ?? fallbackEncounterId
  return {
    encounter_id: encounterId,
    categories: parseCategories(record.categories),
    provenance: parseProvenance(record.provenance),
  }
}

export async function getHealthEncounter(encounterId: string): Promise<HealthEncounterDetails> {
  const safeEncounterId = encodeURIComponent(encounterId)
  const raw = await api.get(`/api/patients/me/health-encounters/${safeEncounterId}`)
  return parseEncounterDetails(raw, encounterId)
}

function parseEpisodeDetails(raw: unknown, fallbackEpisodeId: string): HealthEpisodeDetails {
  const root = asRecord(raw)
  const record = root && asRecord(root.data) ? asRecord(root.data) as Record<string, unknown> : root
  if (!record) throw new HealthTimelineContractError('Health episode response must be an object')
  const visitsRaw = Array.isArray(record.visits) ? record.visits : []
  const visits: HealthEpisodeVisit[] = visitsRaw.flatMap((rawVisit) => {
    const visit = asRecord(rawVisit)
    if (!visit) return []
    const encounterId = optionalString(visit, 'encounter_id')
    if (!encounterId) return []
    return [{
      encounter_id: encounterId,
      date: optionalString(visit, 'date'),
      facility: optionalString(visit, 'facility'),
      categories: parseCategories(visit.categories),
      record_count: optionalNumber(visit, 'record_count') ?? 0,
      source_count: optionalNumber(visit, 'source_count') ?? 0,
      link_reason: optionalString(visit, 'link_reason') ?? 'deterministic_problem_episode',
    }]
  })
  return {
    episode_id: optionalString(record, 'episode_id') ?? fallbackEpisodeId,
    display_title: optionalString(record, 'display_title') ?? '健康問題相關就醫',
    display_summary: optionalString(record, 'display_summary'),
    start_date: optionalString(record, 'start_date'),
    end_date: optionalString(record, 'end_date'),
    visit_count: optionalNumber(record, 'visit_count') ?? visits.length,
    source_count: optionalNumber(record, 'source_count') ?? 0,
    included_types: optionalStringArray(record, 'included_types') ?? [],
    detail_counts: optionalNumberMap(record, 'detail_counts') ?? {},
    rule_summary: optionalString(record, 'rule_summary'),
    policy_version: optionalString(record, 'policy_version'),
    visits,
    provenance: parseProvenance(record.provenance),
  }
}

export async function getHealthEpisode(episodeId: string): Promise<HealthEpisodeDetails> {
  const safeEpisodeId = encodeURIComponent(episodeId)
  const raw = await api.get(`/api/patients/me/health-episodes/${safeEpisodeId}`)
  return parseEpisodeDetails(raw, episodeId)
}

export async function saveNhiFactToProfile(
  factId: string,
  body: { status?: string; usage_status?: string } = {},
): Promise<{
  created: boolean
  target_type: 'condition' | 'medication'
  target_id: string | number
  resource?: { member_name?: string | null }
}> {
  return api.post(`/api/patients/me/profile-candidates/${encodeURIComponent(factId)}/confirm`, body) as Promise<{
    created: boolean
    target_type: 'condition' | 'medication'
    target_id: string | number
    resource?: { member_name?: string | null }
  }>
}
