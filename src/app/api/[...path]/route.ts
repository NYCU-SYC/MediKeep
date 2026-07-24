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
const ATTEMPT_TIMEOUT_MS = 20_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backendUnavailableResponse(attempts: number) {
  return NextResponse.json(
    {
      error: {
        code: 'backend_unavailable',
        message: 'Backend service is temporarily unavailable',
        details: {},
      },
    },
    {
      status: 502,
      headers: {
        'Cache-Control': 'no-store',
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
    'if-none-match',
    'if-modified-since',
  ]

  for (const key of allowList) {
    const value = req.headers.get(key)
    if (value) headers.set(key, value)
  }

  return headers
}

function forwardResponse(resp: Response, body: ArrayBuffer | null, attempts: number) {
  const headers = new Headers()
  headers.set('Cache-Control', 'no-store')
  headers.set('X-HealthKeep-Api-Proxy', 'generic')
  headers.set('X-HealthKeep-Api-Proxy-Attempts', String(attempts))

  const setCookie = resp.headers.get('set-cookie')
  if (setCookie) headers.set('Set-Cookie', setCookie)

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

async function proxy(req: NextRequest, context: RouteContext) {
  const { path } = await context.params
  const method = req.method.toUpperCase()
  const maxAttempts = method === 'GET' ? GET_MAX_ATTEMPTS : 1
  const requestBody = BODY_METHODS.has(method) ? await req.arrayBuffer() : undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS)

    try {
      const resp = await fetch(buildBackendUrl(req, path), {
        method,
        headers: forwardRequestHeaders(req),
        // Forward the raw bytes (not text) so binary multipart uploads — PDFs,
        // images, DICOM — are not corrupted by a UTF-8 decode/encode round-trip.
        body: requestBody,
        cache: 'no-store',
        signal: controller.signal,
      })
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
