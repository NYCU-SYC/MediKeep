import { NextRequest, NextResponse } from 'next/server'
import { getApiBaseUrl } from '@/lib/serverDeployment'

export const dynamic = 'force-dynamic'

const API_BASE_URL = getApiBaseUrl()

type RouteContext = {
  params: Promise<{
    path: string[]
  }>
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const GET_MAX_ATTEMPTS = 3
const READ_ATTEMPT_TIMEOUT_MS = 20_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_RESPONSE_HEADERS = [
  'content-disposition',
  'content-security-policy',
  'referrer-policy',
  'retry-after',
  'x-content-type-options',
  'x-request-id',
  'x-robots-tag',
  'x-total-count',
]
const PROXY_ERROR_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
}
// Local development still supports multipart uploads through this proxy.
// Production NHI uploads use presigned object-storage URLs, but other binary
// patient uploads must not be aborted by the ordinary API read timeout.
const WRITE_ATTEMPT_TIMEOUT_MS = 300_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backendUnavailableResponse(attempts: number) {
  return NextResponse.json(
    {
      error: {
        code: 'backend_unavailable',
        message: 'Backend service is temporarily unavailable',
        retryable: true,
        details: {},
      },
    },
    {
      status: 502,
      headers: {
        ...PROXY_ERROR_HEADERS,
        'X-HealthKeep-Api-Proxy-Attempts': String(attempts),
      },
    },
  )
}

function buildBackendUrl(req: NextRequest, path: string[]) {
  const url = new URL(req.url)
  const backendUrl = new URL(`${API_BASE_URL}/api/${path.map(encodeURIComponent).join('/')}`)
  backendUrl.search = url.search
  return backendUrl
}

function forwardRequestHeaders(req: NextRequest) {
  const headers = new Headers()
  const allowList = [
    'accept',
    'authorization',
    'content-type',
    'cookie',
    'idempotency-key',
    'x-impact-preview-token',
    'x-request-id',
    'if-none-match',
    'if-modified-since',
  ]

  for (const key of allowList) {
    const value = req.headers.get(key)
    if (value) headers.set(key, value)
  }

  return headers
}

function proxyResponseHeaders(resp: Response, attempts: number) {
  const headers = new Headers()
  headers.set('Cache-Control', 'no-store')
  headers.set('X-HealthKeep-Api-Proxy', 'generic')
  headers.set('X-HealthKeep-Api-Proxy-Attempts', String(attempts))

  const setCookie = resp.headers.get('set-cookie')
  if (setCookie) headers.set('Set-Cookie', setCookie)

  for (const key of SAFE_RESPONSE_HEADERS) {
    const value = resp.headers.get(key)
    if (value) headers.set(key, value)
  }

  return headers
}

function forwardResponse(resp: Response, body: ArrayBuffer | null, attempts: number) {
  const headers = proxyResponseHeaders(resp, attempts)

  if ([204, 304].includes(resp.status)) {
    return new NextResponse(null, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    })
  }

  headers.set('Content-Type', resp.headers.get('content-type') || 'application/json')
  return new NextResponse(body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  })
}

function unsafeBackendRedirectResponse(attempts: number) {
  return NextResponse.json(
    {
      error: {
        code: 'unsafe_backend_redirect',
        message: 'Backend redirect was refused by the API proxy',
        retryable: false,
        details: {},
      },
    },
    {
      status: 502,
      headers: {
        ...PROXY_ERROR_HEADERS,
        'X-HealthKeep-Api-Proxy': 'generic',
        'X-HealthKeep-Api-Proxy-Attempts': String(attempts),
      },
    },
  )
}

function isAuthorizedDocumentDownload(path: string[], method: string) {
  if (method !== 'GET') return false
  const authenticatedDocument = path.length === 3
    && path[0] === 'documents'
    && DOCUMENT_ID_PATTERN.test(path[1])
    && path[2] === 'download'
  const emergencyDocument = path.length === 5
    && path[0] === 'emergency'
    && path[1].length >= 8
    && path[2] === 'documents'
    && DOCUMENT_ID_PATTERN.test(path[3])
    && path[4] === 'download'
  return authenticatedDocument || emergencyDocument
}

function trustedStorageRedirect(location: string | null) {
  if (!location) return null

  let target: URL
  try {
    target = new URL(location)
  } catch {
    return null
  }
  if (target.protocol !== 'https:' || target.username || target.password) return null

  const trustedOrigins = new Set<string>()
  for (const configured of (process.env.HEALTHKEEP_STORAGE_REDIRECT_ORIGINS || '').split(',')) {
    const value = configured.trim()
    if (!value) continue
    try {
      const origin = new URL(value)
      if (origin.protocol === 'https:' && !origin.username && !origin.password) {
        trustedOrigins.add(origin.origin)
      }
    } catch {
      // Invalid deployment entries are ignored; an empty allowlist fails closed.
    }
  }
  return trustedOrigins.has(target.origin) ? location : null
}

function forwardStorageRedirect(resp: Response, location: string, attempts: number) {
  const headers = proxyResponseHeaders(resp, attempts)
  headers.set('Location', location)
  return new NextResponse(null, {
    status: 307,
    statusText: resp.statusText,
    headers,
  })
}

async function proxy(req: NextRequest, context: RouteContext) {
  const { path } = await context.params
  const method = req.method.toUpperCase()
  const maxAttempts = method === 'GET' ? GET_MAX_ATTEMPTS : 1
  const requestBody = BODY_METHODS.has(method) ? await req.arrayBuffer() : undefined
  const attemptTimeout = method === 'GET' ? READ_ATTEMPT_TIMEOUT_MS : WRITE_ATTEMPT_TIMEOUT_MS

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), attemptTimeout)

    try {
      const resp = await fetch(buildBackendUrl(req, path), {
        method,
        headers: forwardRequestHeaders(req),
        // Forward the raw bytes (not text) so binary multipart uploads — PDFs,
        // images, DICOM — are not corrupted by a UTF-8 decode/encode round-trip.
        body: requestBody,
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      })

      if (REDIRECT_STATUSES.has(resp.status)) {
        const location = resp.status === 307 && isAuthorizedDocumentDownload(path, method)
          ? trustedStorageRedirect(resp.headers.get('location'))
          : null
        return location
          ? forwardStorageRedirect(resp, location, attempt)
          : unsafeBackendRedirectResponse(attempt)
      }

      const body = [204, 304].includes(resp.status) ? null : await resp.arrayBuffer()

      if (method === 'GET' && resp.status >= 500 && attempt < maxAttempts) {
        console.warn('[api-proxy] transient backend response', {
          path: path.join('/'),
          status: resp.status,
          attempt,
        })
        await sleep(250 * attempt)
        continue
      }

      return forwardResponse(resp, body, attempt)
    } catch (error) {
      console.error('[api-proxy] backend request failed', {
        path: path.join('/'),
        method,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      })
      if (attempt === maxAttempts) {
        return backendUnavailableResponse(attempt)
      }
      await sleep(250 * attempt)
    } finally {
      clearTimeout(timer)
    }
  }

  return backendUnavailableResponse(maxAttempts)
}

export async function GET(req: NextRequest, context: RouteContext) {
  return proxy(req, context)
}

export async function POST(req: NextRequest, context: RouteContext) {
  return proxy(req, context)
}

export async function PUT(req: NextRequest, context: RouteContext) {
  return proxy(req, context)
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  return proxy(req, context)
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  return proxy(req, context)
}
