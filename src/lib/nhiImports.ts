import { api, ApiError } from '@/lib/api'

export type NhiImportState =
  | 'queued'
  | 'running'
  | 'processing'
  | 'completed'
  | 'stalled'
  | 'failed'
  | 'partial'
  | 'needs_review'
  | (string & {})

export type NhiOnboardingState = {
  feature_enabled: boolean
  reminder_required: boolean
  seen_at: string | null
  skipped_at: string | null
  completed_at: string | null
}

export type NhiImportJob = {
  id: string
  state: NhiImportState
  stage: string
  progress: number
  processed_sections: number
  total_sections: number
  retryable: boolean
  error_code: string | null
  error_message: string | null
  updated_at: string
  version: number
  imported_sections?: string[]
  failed_sections?: string[]
}

export type NhiImportCreateInput = {
  member_name?: string | null
  source_type?: string | null
}

export class NhiContractError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(message, 502, 'invalid_nhi_contract', details)
    this.name = 'NhiContractError'
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function unwrap(value: unknown): unknown {
  const record = asRecord(value)
  if (!record) return value
  const data = asRecord(record.data)
  return data ?? value
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new NhiContractError(`NHI response field ${field} is missing or invalid`)
  }
  return value
}

function requiredId(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new NhiContractError(`NHI response field ${field} is missing or invalid`)
}

function nullableString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new NhiContractError(`NHI response field ${field} is invalid`)
  }
  return value
}

function optionalStringArray(record: Record<string, unknown>, field: string): string[] | undefined {
  const value = record[field]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new NhiContractError(`NHI response field ${field} is invalid`)
  }
  return value as string[]
}

function requiredBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field]
  if (typeof value !== 'boolean') {
    throw new NhiContractError(`NHI response field ${field} is missing or invalid`)
  }
  return value
}

function requiredFiniteNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new NhiContractError(`NHI response field ${field} is missing or invalid`)
  }
  return value
}

function parseOnboarding(raw: unknown): NhiOnboardingState {
  const record = asRecord(unwrap(raw))
  if (!record) throw new NhiContractError('NHI onboarding response is not an object')

  const featureEnabled = requiredBoolean(record, 'feature_enabled')
  const seenAt = nullableString(record, 'seen_at')
  const skippedAt = nullableString(record, 'skipped_at')
  const completedAt = nullableString(record, 'completed_at')
  const explicitReminder = record.reminder_required ?? record.show_reminder
  const reminderRequired = explicitReminder === undefined
    ? (Object.prototype.hasOwnProperty.call(record, 'skipped_at')
      && Object.prototype.hasOwnProperty.call(record, 'completed_at')
      && !skippedAt
      && !completedAt)
    : requiredBoolean({ reminder_required: explicitReminder }, 'reminder_required')

  return {
    feature_enabled: featureEnabled,
    reminder_required: reminderRequired,
    seen_at: seenAt,
    skipped_at: skippedAt,
    completed_at: completedAt,
  }
}

function parseJob(raw: unknown): NhiImportJob {
  const candidate = unwrap(raw)
  const nested = asRecord(candidate)
  const record = nested && asRecord(nested.job) ? asRecord(nested.job) as Record<string, unknown> : nested
  if (!record) throw new NhiContractError('NHI import job response is not an object')

  const progress = requiredFiniteNumber(record, 'progress')
  if (progress < 0 || progress > 100) {
    throw new NhiContractError('NHI import job progress is outside 0-100')
  }

  return {
    id: requiredId(record, 'id'),
    state: requiredString(record, 'state') as NhiImportState,
    stage: requiredString(record, 'stage'),
    progress,
    processed_sections: requiredFiniteNumber(record, 'processed_sections'),
    total_sections: requiredFiniteNumber(record, 'total_sections'),
    retryable: requiredBoolean(record, 'retryable'),
    error_code: nullableString(record, 'error_code'),
    error_message: nullableString(record, 'error_message'),
    updated_at: requiredString(record, 'updated_at'),
    version: requiredFiniteNumber(record, 'version'),
    imported_sections: optionalStringArray(record, 'imported_sections'),
    failed_sections: optionalStringArray(record, 'failed_sections'),
  }
}

export async function getNhiOnboarding(): Promise<NhiOnboardingState> {
  return parseOnboarding(await api.get('/api/patients/me/onboarding'))
}

export async function markNhiOnboardingSeen(): Promise<NhiOnboardingState> {
  const raw = await api.patch('/api/patients/me/onboarding', { seen: true })
  return raw === null ? getNhiOnboarding() : parseOnboarding(raw)
}

export async function skipNhiOnboarding(): Promise<NhiOnboardingState> {
  const raw = await api.patch('/api/patients/me/onboarding', { skip: true })
  return raw === null ? getNhiOnboarding() : parseOnboarding(raw)
}

export async function createNhiImport(input: NhiImportCreateInput = {}): Promise<NhiImportJob> {
  return parseJob(await api.post('/api/patients/me/nhi-imports', input))
}

export async function getNhiImportJob(jobId: string): Promise<NhiImportJob> {
  return parseJob(await api.get(`/api/patients/me/nhi-imports/${encodeURIComponent(jobId)}`))
}

export async function completeNhiImport(jobId: string): Promise<NhiImportJob | null> {
  const raw = await api.post(`/api/patients/me/nhi-imports/${encodeURIComponent(jobId)}/complete`)
  return raw === null ? null : parseJob(raw)
}

export async function retryNhiImport(jobId: string): Promise<NhiImportJob> {
  await api.post(`/api/patients/me/nhi-imports/${encodeURIComponent(jobId)}/retry`)
  return getNhiImportJob(jobId)
}
