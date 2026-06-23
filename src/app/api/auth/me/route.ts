import { NextRequest, NextResponse } from 'next/server'
import { getApiBaseUrl } from '@/lib/serverDeployment'

const API_BASE_URL = getApiBaseUrl()
const BACKEND_ME_URL = `${API_BASE_URL}/api/auth/me`
const MAX_ATTEMPTS = 4

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetry(status: number, body: string) {
  return status >= 500 || body.includes('Tunnel Unavailable')
}

function backendErrorResponse() {
  return NextResponse.json(
    {
      error: {
        code: 'backend_unavailable',
        message: 'Backend auth service is temporarily unavailable',
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

async function getFromBackend(req: NextRequest) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  const headers = new Headers()
  const authorization = req.headers.get('authorization')
  const cookie = req.headers.get('cookie')

  if (authorization) headers.set('Authorization', authorization)
  if (cookie) headers.set('Cookie', cookie)

  try {
    return await fetch(BACKEND_ME_URL, {
      method: 'GET',
      headers,
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

export async function GET(req: NextRequest) {
  let lastBody = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const resp = await getFromBackend(req)
      lastBody = await resp.text()

      if (!shouldRetry(resp.status, lastBody) || attempt === MAX_ATTEMPTS) {
        return forwardBackendResponse(resp, lastBody, attempt)
      }
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        return backendErrorResponse()
      }
    }

    await sleep(250 * attempt)
  }

  return backendErrorResponse()
}
