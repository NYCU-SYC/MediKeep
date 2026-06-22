import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '')

type RouteContext = {
  params: Promise<{
    path: string[]
  }>
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function backendUnavailableResponse() {
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

function forwardResponse(resp: Response, body: string) {
  const headers = new Headers()
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', resp.headers.get('content-type') || 'application/json')
  headers.set('X-HealthKeep-Api-Proxy', 'generic')

  const setCookie = resp.headers.get('set-cookie')
  if (setCookie) headers.set('Set-Cookie', setCookie)

  return new NextResponse(body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  })
}

async function proxy(req: NextRequest, context: RouteContext) {
  const { path } = await context.params
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)

  try {
    const method = req.method.toUpperCase()
    const resp = await fetch(buildBackendUrl(req, path), {
      method,
      headers: forwardRequestHeaders(req),
      body: BODY_METHODS.has(method) ? await req.text() : undefined,
      cache: 'no-store',
      signal: controller.signal,
    })
    const body = await resp.text()
    return forwardResponse(resp, body)
  } catch {
    return backendUnavailableResponse()
  } finally {
    clearTimeout(timer)
  }
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
