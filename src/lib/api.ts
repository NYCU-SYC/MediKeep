import { nextRouteFromSearch, routeWithNext } from './internalRoutes'

const base = ''

export class ApiError extends Error {
  status: number
  code: string
  requestId?: string
  details: unknown
  retryable: boolean
  retryAfter: number | null
  saveState:
    | 'not_saved'
    | 'saved'
    | 'partially_saved'
    | 'unchanged'
    | 'metadata_preserved'
    | 'soft_deleted'
    | 'soft_deleted_bytes_retained'
    | 'restored'
    | 'unknown'
  fieldErrors: Record<string, string[]>
  partialSuccess: unknown

  constructor(
    message: string,
    status: number,
    code = 'request_failed',
    details?: unknown,
    requestId?: string,
    retryable = false,
    retryAfter: number | null = null,
    saveState: ApiError['saveState'] = 'unknown',
    fieldErrors: Record<string, string[]> = {},
    partialSuccess?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
    this.retryable = retryable
    this.retryAfter = retryAfter
    this.saveState = saveState
    this.fieldErrors = fieldErrors
    this.partialSuccess = partialSuccess
  }
}

const patientTokenKey = 'healthkeep_session_token'
const cmoTokenKey = 'healthkeep_cmo_session_token'
const GET_CACHE_TTL_MS = 15_000
const getCache = new Map<string, { expiresAt: number; value: unknown }>()
const inflightGets = new Map<string, Promise<unknown>>()

export function invalidateApiGetCache() {
  getCache.clear()
}

function cacheableGet(path: string) {
  return path !== '/api/auth/me'
    && !path.includes('/sync-state')
    && !/\/nhi-imports\/[^/?]+(?:\?|$)/.test(path)
}

function canUseStorage() {
  return typeof window !== 'undefined' && !!window.localStorage
}

export function setPatientSessionToken(token?: string | null) {
  if (!canUseStorage()) return
  invalidateApiGetCache()
  if (token) window.localStorage.setItem(patientTokenKey, token)
  else window.localStorage.removeItem(patientTokenKey)
}

export function getPatientSessionToken() {
  if (!canUseStorage()) return null
  return window.localStorage.getItem(patientTokenKey)
}

export function setCmoSessionToken(token?: string | null) {
  if (!canUseStorage()) return
  invalidateApiGetCache()
  if (token) window.localStorage.setItem(cmoTokenKey, token)
  else window.localStorage.removeItem(cmoTokenKey)
}

function getSessionToken(path: string) {
  if (!canUseStorage()) return null
  if (path.startsWith('/api/auth/me')) return null
  return window.localStorage.getItem(path.startsWith('/api/cmo') ? cmoTokenKey : patientTokenKey)
}

function redirectForAuth(path: string) {
  if (typeof window === 'undefined') return
  if (path.startsWith('/api/cmo')) {
    window.location.replace('/cmo/login')
    return
  }
  const current = `${window.location.pathname}${window.location.search}`
  const next = nextRouteFromSearch(`next=${encodeURIComponent(current)}`, '/dashboard')
  window.location.replace(routeWithNext('/upload-entry', next))
}

type ErrorPayload = {
  detail?: unknown
  error?: {
    code?: string
    message?: string
    details?: unknown
    request_id?: string
    retryable?: boolean
    save_state?: ApiError['saveState']
    field_errors?: Record<string, string[] | string>
    partial_success?: unknown
    retry_at?: string | number | null
  }
}

export type ApiMutationOptions = {
  /** Stable key for logical retries of the same mutation. */
  idempotencyKey?: string
  headers?: HeadersInit
}

function normalizeFieldErrors(value?: Record<string, string[] | string>): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).map(([field, messages]) => [
    field,
    Array.isArray(messages) ? messages.map(String) : [String(messages)],
  ]))
}

function detailMessage(detail: unknown): string | null {
  if (!detail) return null
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const first = detail.find((item) => Boolean(detailMessage(item)))
    return first ? detailMessage(first) : null
  }
  if (typeof detail === 'object') {
    const record = detail as Record<string, unknown>
    for (const key of ['message', 'reason', 'error', 'detail']) {
      if (typeof record[key] === 'string' && record[key]) return record[key]
    }
    if (typeof record.code === 'string' && record.code) return record.code
  }
  return null
}

function errorMessage(payload: ErrorPayload, fallback: string) {
  if (payload?.error?.message) return payload.error.message
  const message = detailMessage(payload?.detail)
  if (message) return message
  return fallback
}

function retryDelaySeconds(value: string | number | null | undefined, headerValue: string | null): number | null {
  const candidate = value ?? headerValue
  if (candidate === null || candidate === undefined || candidate === '') return null
  if (typeof candidate === 'number') {
    if (!Number.isFinite(candidate) || candidate <= 0) return null
    return candidate > 1_000_000_000 ? Math.max(1, Math.ceil(candidate - Date.now() / 1000)) : Math.ceil(candidate)
  }
  const numeric = Number(candidate)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000 ? Math.max(1, Math.ceil(numeric - Date.now() / 1000)) : Math.ceil(numeric)
  }
  const timestamp = Date.parse(candidate)
  return Number.isFinite(timestamp) ? Math.max(1, Math.ceil((timestamp - Date.now()) / 1000)) : null
}

async function request(path: string, init?: RequestInit) {
  const token = getSessionToken(path)
  const method = (init?.method ?? 'GET').toUpperCase()
  const idempotencyKey = method === 'POST'
    ? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `idem_${Date.now()}_${Math.random()}`)
    : null
  const res = await fetch(`${base}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText })) as ErrorPayload
    if (res.status === 401) redirectForAuth(path)
    throw new ApiError(
      errorMessage(err, 'Request failed'),
      res.status,
      err?.error?.code,
      err?.error?.details ?? err?.detail,
      err?.error?.request_id,
      err?.error?.retryable ?? [429, 502, 503].includes(res.status),
      retryDelaySeconds(err?.error?.retry_at, res.headers?.get?.('retry-after') ?? null),
      err?.error?.save_state
        ?? (typeof err?.error?.details === 'object' && err.error.details !== null ? (err.error.details as { save_state?: ApiError['saveState'] }).save_state : undefined)
        ?? 'unknown',
      normalizeFieldErrors(
        err?.error?.field_errors
        ?? (typeof err?.error?.details === 'object' && err.error.details !== null ? (err.error.details as { field_errors?: Record<string, string[] | string> }).field_errors : undefined),
      ),
      err?.error?.partial_success
        ?? (typeof err?.error?.details === 'object' && err.error.details !== null ? (err.error.details as { partial_success?: unknown }).partial_success : undefined),
    )
  }
  if (res.status === 204) return null
  return res.json()
}

function getRequest(path: string, params?: Record<string, string>) {
  const url = params ? `${path}?${new URLSearchParams(params)}` : path
  const cached = getCache.get(url)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  if (cached) getCache.delete(url)

  const pending = inflightGets.get(url)
  if (pending) return pending

  const next = request(url)
    .then((value) => {
      if (cacheableGet(url)) {
        getCache.set(url, { expiresAt: Date.now() + GET_CACHE_TTL_MS, value })
      }
      return value
    })
    .finally(() => {
      inflightGets.delete(url)
    })
  inflightGets.set(url, next)
  return next
}

async function mutationRequest(path: string, init: RequestInit) {
  // Drop stale reads both before and after a mutation. The second clear also
  // removes GETs that may have completed while the write was in flight.
  invalidateApiGetCache()
  try {
    return await request(path, init)
  } finally {
    invalidateApiGetCache()
  }
}

export const api = {
  get: (path: string, params?: Record<string, string>) => getRequest(path, params),
  post: (path: string, body?: unknown, options?: ApiMutationOptions) =>
    mutationRequest(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: {
        ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        ...options?.headers,
      },
    }),
  put: (path: string, body: unknown, options?: ApiMutationOptions) =>
    mutationRequest(path, {
      method: 'PUT', body: JSON.stringify(body),
      headers: { ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}), ...options?.headers },
    }),
  patch: (path: string, body: unknown, options?: ApiMutationOptions) =>
    mutationRequest(path, {
      method: 'PATCH', body: JSON.stringify(body),
      headers: { ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}), ...options?.headers },
    }),
  delete: (path: string, options?: ApiMutationOptions) =>
    mutationRequest(path, {
      method: 'DELETE',
      headers: { ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}), ...options?.headers },
    }),
}
