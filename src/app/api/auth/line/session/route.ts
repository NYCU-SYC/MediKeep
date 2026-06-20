import { NextRequest, NextResponse } from 'next/server'

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '')
const BACKEND_SESSION_URL = `${API_BASE_URL}/api/auth/line/session`
const MAX_ATTEMPTS = 4

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetry(status: number, body: string) {
  return status >= 500 || body.includes('Tunnel Unavailable')
}

function backendErrorResponse(message = 'Backend login service is temporarily unavailable') {
  return NextResponse.json(
    {
      error: {
        code: 'backend_unavailable',
        message,
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

async function postToBackend(body: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    return await fetch(BACKEND_SESSION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      cache: 'no-store',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function forwardBackendResponse(resp: Response, body: string, attempts: number) {
  const headers = new Headers()
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', resp.headers.get('content-type') || 'application/json')
  headers.set('X-HealthKeep-Auth-Proxy-Attempts', String(attempts))

  const setCookie = resp.headers.get('set-cookie')
  if (setCookie) headers.set('Set-Cookie', setCookie)

  return new NextResponse(body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  let lastBody = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const resp = await postToBackend(body)
      lastBody = await resp.text()

      if (!shouldRetry(resp.status, lastBody) || attempt === MAX_ATTEMPTS) {
        return forwardBackendResponse(resp, lastBody, attempt)
      }
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        return backendErrorResponse()
      }
    }

    await sleep(300 * attempt)
  }

  return backendErrorResponse(lastBody || undefined)
}
