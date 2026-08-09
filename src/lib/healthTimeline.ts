import { api, ApiError } from '@/lib/api'

export type HealthTimelineEvent = {
  id: string
  occurred_at: string
  event_type: string
  title: string
  summary: string
  source_type: string
  review_status: string
  is_important: boolean
  member_name: string | null
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
  return {
    id: requiredId(record, 'id'),
    occurred_at: requiredString(record, 'occurred_at'),
    event_type: requiredString(record, 'event_type'),
    title: requiredString(record, 'title'),
    summary: requiredString(record, 'summary'),
    source_type: requiredString(record, 'source_type'),
    review_status: requiredString(record, 'review_status'),
    is_important: requiredBoolean(record, 'is_important'),
    member_name: nullableString(record, 'member_name'),
  }
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
