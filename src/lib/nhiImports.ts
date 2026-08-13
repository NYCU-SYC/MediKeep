import { api, ApiError, getPatientSessionToken } from '@/lib/api'

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
  completion_method?: 'import_queued' | 'no_file' | 'legacy_skip' | string | null
  import_job_id?: string | null
  import_state?: string | null
  state?: string | null
  current_step?: string | null
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

export type NhiOnboardingCompletionInput = {
  completion_method: 'no_file'
  completed_at?: string
  import_job_id?: string | null
  import_state?: string | null
}

export type NhiUploadManifest = {
  name: string
  size: number
  sha256: string
  content_type: string
}

export type NhiUploadPolicy = {
  max_files: number
  max_total_bytes: number
  allowed_extensions: string[]
  allowed_content_types: string[]
  accept: string
  zip_must_be_single: boolean
  content_validation: string
}

export type NhiUploadTarget = {
  id?: string
  upload_id?: string
  name: string
  upload_url?: string | null
  method?: string | null
  headers?: Record<string, string> | null
  status?: string | null
}

export type NhiProfileCandidateReference = {
  type: string
  id: string
  label?: string | null
  title?: string | null
  name?: string | null
  file_name?: string | null
  date?: string | null
  facility?: string | null
  [key: string]: unknown
}

export type NhiProfileCandidateEncounterRef = {
  id: string
  date?: string | null
  member_name?: string | null
  facility?: string | null
  [key: string]: unknown
}

export type NhiProfileCandidate = {
  id: string
  fact_id: string
  kind: string
  profile_kind: 'condition' | 'medication' | null
  clinical_kind: string | null
  title: string
  summary: string
  evidence_summary: string | null
  date: string | null
  facility: string | null
  facility_ref: Record<string, unknown> | null
  member_name: string
  source_label: string
  source_type: string | null
  medication_state: 'prescribed' | 'dispensed' | 'administered' | 'unknown' | null
  eligibility: string | null
  eligible: boolean
  ineligible_reason: string | null
  usage_context: string | null
  normalized_key: string | null
  last_seen_at: string | null
  encounter_id: string | null
  encounter_ref: NhiProfileCandidateEncounterRef | null
  evidence_refs: NhiProfileCandidateReference[]
  source_refs: NhiProfileCandidateReference[]
  can_save_to_profile: boolean
  saved_to_profile: boolean
  saved_target_type: string | null
  saved_target_id: string | number | null
  saved_state: Record<string, unknown> | null
}

export type NhiProfileCandidatePage = {
  items: NhiProfileCandidate[]
  next_cursor: string | null
  previous_cursor: string | null
}

export type NhiProfileCandidateEvidenceGroup = {
  label: string
  count: number
}

function candidateReferenceLabel(ref: NhiProfileCandidateReference): string {
  const type = ref.type.trim().toLowerCase()
  const humanName = [ref.title, ref.label, ref.name, ref.file_name]
    .find((value) => typeof value === 'string' && value.trim())
  if (type === 'health_document') {
    return humanName ? `醫療文件：${humanName.trim()}` : '相關醫療文件'
  }
  if (type === 'nhi_source_row') return '健保存摺來源紀錄'
  if (type === 'nhi_draft') return '健保匯入整理紀錄'
  if (type === 'nhi_encounter_fact') return '本次就醫的健保資料'
  if (type === 'nhi_encounter') return '相關就醫紀錄'
  return humanName && /[\u3400-\u9fff]/u.test(humanName)
    ? `其他佐證資料：${humanName.trim()}`
    : '其他佐證資料'
}

export function nhiProfileCandidateEvidenceGroups(candidate: NhiProfileCandidate): NhiProfileCandidateEvidenceGroup[] {
  const unique = new Map<string, NhiProfileCandidateReference>()
  for (const ref of [...candidate.evidence_refs, ...candidate.source_refs]) {
    unique.set(`${ref.type.trim().toLowerCase()}\0${ref.id}`, ref)
  }
  const groups = new Map<string, number>()
  for (const ref of unique.values()) {
    const label = candidateReferenceLabel(ref)
    groups.set(label, (groups.get(label) ?? 0) + 1)
  }
  return [...groups.entries()].map(([label, count]) => ({ label, count }))
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

function optionalBoolean(record: Record<string, unknown>, field: string): boolean | undefined {
  const value = record[field]
  return typeof value === 'boolean' ? value : undefined
}

function optionalNumberOrString(record: Record<string, unknown>, field: string): string | number | null {
  const value = record[field]
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  return null
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
    completion_method: typeof record.completion_method === 'string' ? record.completion_method : null,
    import_job_id: typeof record.import_job_id === 'string' ? record.import_job_id : null,
    import_state: typeof record.import_state === 'string' ? record.import_state : null,
    state: typeof record.state === 'string' ? record.state : null,
    current_step: typeof record.current_step === 'string' ? record.current_step : null,
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

export async function getNhiUploadPolicy(): Promise<NhiUploadPolicy> {
  const raw = asRecord(unwrap(await api.get('/api/patients/me/nhi-imports/upload-policy')))
  if (!raw
    || typeof raw.max_files !== 'number'
    || typeof raw.max_total_bytes !== 'number'
    || !Array.isArray(raw.allowed_extensions)
    || raw.allowed_extensions.some(item => typeof item !== 'string')
    || !Array.isArray(raw.allowed_content_types)
    || raw.allowed_content_types.some(item => typeof item !== 'string')
    || typeof raw.accept !== 'string'
    || typeof raw.zip_must_be_single !== 'boolean'
    || typeof raw.content_validation !== 'string') {
    throw new NhiContractError('NHI upload policy response is invalid')
  }
  return raw as unknown as NhiUploadPolicy
}

export async function markNhiOnboardingSeen(): Promise<NhiOnboardingState> {
  const raw = await api.patch('/api/patients/me/onboarding', { seen: true })
  return raw === null ? getNhiOnboarding() : parseOnboarding(raw)
}

export async function skipNhiOnboarding(): Promise<NhiOnboardingState> {
  const raw = await api.patch('/api/patients/me/onboarding', { skip: true })
  return raw === null ? getNhiOnboarding() : parseOnboarding(raw)
}

export async function completeNhiOnboarding(input: NhiOnboardingCompletionInput): Promise<NhiOnboardingState> {
  const raw = await api.patch('/api/patients/me/onboarding', {
    ...input,
    completed_at: input.completed_at ?? new Date().toISOString(),
  })
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

type NhiFetchInit = RequestInit & { idempotencyKey?: string }

function nhiHeaders(init: NhiFetchInit): HeadersInit {
  const token = getPatientSessionToken()
  return {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers ?? {}),
  }
}

async function nhiFetchJson<T>(path: string, init: NhiFetchInit = {}): Promise<T | null> {
  const { idempotencyKey, ...requestInit } = init
  const response = await fetch(path, {
    ...requestInit,
    credentials: 'include',
    headers: nhiHeaders({ ...requestInit, idempotencyKey }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown; error?: { message?: string; code?: string } } | null
    const detail = payload?.error?.message
      || (typeof payload?.detail === 'string' ? payload.detail : null)
      || `NHI request failed (${response.status})`
    throw new ApiError(detail, response.status, payload?.error?.code ?? 'nhi_request_failed', payload?.detail)
  }
  if (response.status === 204) return null
  return await response.json().catch(() => null) as T | null
}

function fileDescriptorBody(memberName: string, files: NhiUploadManifest[]) {
  return JSON.stringify({ member_name: memberName, files })
}

export async function createNhiImportWithManifest(
  memberName: string,
  files: NhiUploadManifest[],
  idempotencyKey: string,
): Promise<NhiImportJob & { upload_targets?: NhiUploadTarget[] }> {
  const raw = await nhiFetchJson<unknown>('/api/patients/me/nhi-imports', {
    method: 'POST',
    body: fileDescriptorBody(memberName, files),
    idempotencyKey,
  })
  const record = asRecord(unwrap(raw))
  const job = parseJob(raw)
  const uploadTargets = record && Array.isArray(record.upload_targets)
    ? record.upload_targets.flatMap((value) => {
      const target = asRecord(value)
      if (!target || typeof target.name !== 'string') return []
      return [{
        id: typeof target.id === 'string' ? target.id : undefined,
        upload_id: typeof target.upload_id === 'string' ? target.upload_id : undefined,
        name: target.name,
        upload_url: typeof target.upload_url === 'string' ? target.upload_url : null,
        method: typeof target.method === 'string' ? target.method : null,
        headers: asRecord(target.headers) as Record<string, string> | null,
        status: typeof target.status === 'string' ? target.status : null,
      }]
    })
    : []
  return { ...job, upload_targets: uploadTargets }
}

export async function uploadNhiImportTarget(target: NhiUploadTarget, file: File): Promise<void> {
  if (!target.upload_url) throw new NhiContractError(`NHI upload target ${target.name} has no upload URL`)
  const method = (target.method || 'POST').toUpperCase()
  const isDirectObjectUpload = method === 'PUT'
  const form = new FormData()
  form.append('file', file, file.name)
  const token = getPatientSessionToken()
  const response = await fetch(target.upload_url, {
    method,
    body: isDirectObjectUpload ? file : form,
    credentials: isDirectObjectUpload ? undefined : 'include',
    headers: {
      ...(target.headers ?? {}),
      ...(!isDirectObjectUpload && token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown; error?: { message?: string; code?: string } } | null
    const detail = payload?.error?.message
      || (typeof payload?.detail === 'string' ? payload.detail : null)
      || `NHI file upload failed (${response.status})`
    throw new ApiError(detail, response.status, payload?.error?.code ?? 'nhi_upload_failed', payload?.detail)
  }
}

export async function completeNhiImportWithManifest(jobId: string, files: NhiUploadManifest[]): Promise<NhiImportJob | null> {
  const raw = await nhiFetchJson<unknown>(`/api/patients/me/nhi-imports/${encodeURIComponent(jobId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ files: files.map(({ name, sha256 }) => ({ name, sha256 })) }),
  })
  return raw === null ? null : parseJob(raw)
}

function candidateText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function candidateId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function parseCandidateReferences(value: unknown): NhiProfileCandidateReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const ref = asRecord(item)
    if (!ref) return []
    const type = candidateText(ref.type, candidateText(ref.source_type, candidateText(ref.target_type))).trim()
    const id = candidateId(ref.id ?? ref.source_id ?? ref.target_id).trim()
    if (!type || !id) return []
    return [{ ...ref, type, id } as NhiProfileCandidateReference]
  })
}

function parseCandidateEncounterRef(value: unknown): NhiProfileCandidateEncounterRef | null {
  const ref = asRecord(value)
  if (!ref) return null
  const id = candidateId(ref.id ?? ref.encounter_id).trim()
  if (!id) return null
  return {
    ...ref,
    id,
    date: candidateText(ref.date, candidateText(ref.encounter_date)) || null,
    member_name: candidateText(ref.member_name) || null,
    facility: candidateText(ref.facility, candidateText(ref.facility_name)) || null,
  }
}

function parseProfileCandidate(raw: unknown): NhiProfileCandidate | null {
  const record = asRecord(raw)
  if (!record) return null
  const factId = requiredId(record, 'fact_id' in record ? 'fact_id' : 'id')
  const rawKind = candidateText(record.kind, candidateText(record.profile_kind, 'unknown'))
  const profileKind = record.profile_kind === 'condition' || record.profile_kind === 'medication'
    ? record.profile_kind
    : rawKind === 'condition' || rawKind === 'medication' ? rawKind : null
  const title = candidateText(record.title, candidateText(record.name, candidateText(record.label)))
  if (!title.trim()) throw new NhiContractError('NHI profile candidate title is missing')
  const rawMedicationState = candidateText(record.medication_state, candidateText(record.medication_status, candidateText(record.prescription_state))).toLowerCase()
  const usageContext = candidateText(record.usage_context, rawMedicationState).toLowerCase()
  const medicationState = ['prescribed', 'dispensed', 'administered', 'unknown'].includes(usageContext)
    ? usageContext as NhiProfileCandidate['medication_state'] : null
  const canSave = optionalBoolean(record, 'can_save_to_profile')
  const eligible = optionalBoolean(record, 'eligible')
  const encounterRef = parseCandidateEncounterRef(record.encounter_ref)
  const facilityRef = asRecord(record.facility_ref)
  const evidenceRefs = parseCandidateReferences(record.evidence_refs)
  const sourceRefs = parseCandidateReferences(record.source_refs)
  return {
    id: factId,
    fact_id: factId,
    kind: rawKind,
    profile_kind: profileKind,
    clinical_kind: candidateText(record.clinical_kind, candidateText(record.kind)) || null,
    title,
    summary: candidateText(record.summary, candidateText(record.evidence_summary, candidateText(record.description))),
    evidence_summary: candidateText(record.evidence_summary, candidateText(record.summary)) || null,
    date: candidateText(record.date, candidateText(record.occurred_at, candidateText(record.event_date, encounterRef?.date ?? ''))) || null,
    facility: candidateText(record.facility, candidateText(record.facility_name, candidateText(facilityRef?.name, encounterRef?.facility ?? ''))) || null,
    facility_ref: facilityRef,
    member_name: candidateText(record.member_name, '本人'),
    source_label: candidateText(record.source_label, '健保存摺'),
    source_type: candidateText(record.source_type) || null,
    medication_state: medicationState,
    eligibility: candidateText(record.eligibility) || null,
    eligible: eligible ?? canSave ?? Boolean(profileKind),
    ineligible_reason: candidateText(record.ineligible_reason, candidateText(record.ineligibility_reason, candidateText(record.reason))) || null,
    usage_context: candidateText(record.usage_context) || null,
    normalized_key: candidateText(record.normalized_key) || null,
    last_seen_at: candidateText(record.last_seen_at) || null,
    encounter_id: candidateText(record.encounter_id, encounterRef?.id ?? '') || null,
    encounter_ref: encounterRef,
    evidence_refs: evidenceRefs,
    source_refs: sourceRefs,
    can_save_to_profile: canSave ?? eligible ?? Boolean(profileKind),
    saved_to_profile: Boolean(record.saved_to_profile),
    saved_target_type: candidateText(record.saved_target_type) || null,
    saved_target_id: optionalNumberOrString(record, 'saved_target_id'),
    saved_state: asRecord(record.saved_state),
  }
}

function parseCandidatePage(raw: unknown, maxItems = 10): NhiProfileCandidatePage {
  const root = asRecord(raw)
  const record = root && asRecord(root.data) ? asRecord(root.data) as Record<string, unknown> : root
  const values = Array.isArray(raw) ? raw : record && Array.isArray(record.items) ? record.items : []
  const items = values.flatMap((item) => {
    try {
      const parsed = parseProfileCandidate(item)
      return parsed ? [parsed] : []
    } catch {
      return []
    }
  }).slice(0, maxItems)
  const page = typeof record?.page === 'number' && Number.isFinite(record.page) ? record.page : null
  const next = record?.next_cursor ?? record?.next ?? (record?.has_more === true && page !== null ? String(page + 1) : null)
  const previous = record?.previous_cursor ?? record?.prev_cursor ?? record?.previous ?? (page !== null && page > 1 ? String(page - 1) : null)
  return {
    items,
    next_cursor: typeof next === 'string' && next ? next : null,
    previous_cursor: typeof previous === 'string' && previous ? previous : null,
  }
}

export async function getNhiProfileCandidates(input: {
  kind: 'condition' | 'medication'
  q?: string
  cursor?: string | null
  limit?: number
  member?: string | null
}): Promise<NhiProfileCandidatePage> {
  const limit = Math.min(10, Math.max(1, input.limit ?? 10))
  const page = input.cursor && /^\d+$/.test(input.cursor) ? input.cursor : '1'
  const params: Record<string, string> = {
    kind: input.kind,
    // q/cursor/limit are the forward contract. The page/search aliases keep
    // this adapter compatible with the current worker while it migrates.
    q: input.q?.trim() ?? '',
    cursor: input.cursor ?? '',
    limit: String(limit),
    page,
    page_size: String(limit),
  }
  if (input.q?.trim()) params.search = input.q.trim()
  else delete params.search
  if (!input.q?.trim()) delete params.q
  if (!input.cursor) delete params.cursor
  if (input.member) params.member = input.member
  return parseCandidatePage(await api.get('/api/patients/me/profile-candidates', params))
}

export async function saveNhiProfileCandidate(
  candidateId: string,
  body: { status?: string; usage_status?: string },
) {
  return api.post(`/api/patients/me/profile-candidates/${encodeURIComponent(candidateId)}/confirm`, body)
}
