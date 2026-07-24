const base = ''

export class ApiError extends Error {
  status: number
  code: string
  requestId?: string
  details: unknown

  constructor(message: string, status: number, code = 'request_failed', details?: unknown, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

const patientTokenKey = 'healthkeep_session_token'
const cmoTokenKey = 'healthkeep_cmo_session_token'

function canUseStorage() {
  return typeof window !== 'undefined' && !!window.localStorage
}

export function setPatientSessionToken(token?: string | null) {
  if (!canUseStorage()) return
  if (token) window.localStorage.setItem(patientTokenKey, token)
  else window.localStorage.removeItem(patientTokenKey)
}

export function getPatientSessionToken() {
  if (!canUseStorage()) return null
  return window.localStorage.getItem(patientTokenKey)
}

export function setCmoSessionToken(token?: string | null) {
  if (!canUseStorage()) return
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
  window.location.replace(path.startsWith('/api/cmo') ? '/cmo/login' : '/')
}

type ErrorPayload = {
  detail?: unknown
  error?: {
    code?: string
    message?: string
    details?: unknown
    request_id?: string
  }
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

async function request(path: string, init?: RequestInit) {
  const token = getSessionToken(path)
  const method = (init?.method ?? 'GET').toUpperCase()
  const idempotencyKey = method === 'POST'
    ? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `idem_${Date.now()}_${Math.random()}`)
    : null
  const res = await fetch(`${base}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    ...init,
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
    )
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  get: (path: string, params?: Record<string, string>) => {
    const url = params ? `${path}?${new URLSearchParams(params)}` : path
    return request(url)
  },
  post: (path: string, body?: unknown) =>
    request(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: (path: string, body: unknown) =>
    request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path: string, body: unknown) =>
    request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) =>
    request(path, { method: 'DELETE' }),
}
