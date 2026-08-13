import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const DOCUMENT_ID = '11111111-2222-4333-8444-555555555555'
const BACKEND_ORIGIN = 'https://api.healthkeep.test'
const STORAGE_ORIGIN = 'https://private-objects.healthkeep.test'

type RouteContext = { params: Promise<{ path: string[] }> }

function context(path: string[]): RouteContext {
  return { params: Promise.resolve({ path }) }
}

async function loadRoute() {
  vi.resetModules()
  process.env.API_BASE_URL = BACKEND_ORIGIN
  process.env.HEALTHKEEP_STORAGE_REDIRECT_ORIGINS = STORAGE_ORIGIN
  return import('./route')
}

describe('same-origin API document proxy', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.API_BASE_URL
    delete process.env.HEALTHKEEP_STORAGE_REDIRECT_ORIGINS
  })

  it('manually passes through an allowlisted document-storage 307 without fetching PHI', async () => {
    const location = `${STORAGE_ORIGIN}/private/object?X-Amz-Signature=synthetic`
    const backendRedirect = new Response(null, {
      status: 307,
      headers: {
        Location: location,
        'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment; filename="record.html"',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Referrer-Policy': 'no-referrer',
      },
    })
    const bodyRead = vi.spyOn(backendRedirect, 'arrayBuffer')
    fetchMock.mockResolvedValueOnce(backendRedirect)
    const { GET } = await loadRoute()
    const request = new NextRequest(`https://app.healthkeep.test/api/documents/${DOCUMENT_ID}/download`, {
      headers: {
        Authorization: 'Bearer healthkeep-secret',
        Cookie: 'healthkeep_session=session-secret',
      },
    })

    const response = await GET(request, context(['documents', DOCUMENT_ID, 'download']))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [backendUrl, init] = fetchMock.mock.calls[0]
    expect(String(backendUrl)).toBe(`${BACKEND_ORIGIN}/api/documents/${DOCUMENT_ID}/download`)
    expect(init?.redirect).toBe('manual')
    expect((init?.headers as Headers).get('authorization')).toBe('Bearer healthkeep-secret')
    expect((init?.headers as Headers).get('cookie')).toBe('healthkeep_session=session-secret')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(location)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="record.html"')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(bodyRead).not.toHaveBeenCalled()
    expect(await response.text()).toBe('')
  })

  it('rejects an untrusted redirect instead of becoming an open redirect', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, {
      status: 307,
      headers: { Location: 'https://attacker.invalid/collect' },
    }))
    const { GET } = await loadRoute()
    const request = new NextRequest(`https://app.healthkeep.test/api/documents/${DOCUMENT_ID}/download`)

    const response = await GET(request, context(['documents', DOCUMENT_ID, 'download']))

    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    expect(await response.json()).toMatchObject({ error: { code: 'unsafe_backend_redirect' } })
  })

  it('adds sensitive headers to proxy-generated backend failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('backend offline'))
    const { POST } = await loadRoute()
    const request = new NextRequest('https://app.healthkeep.test/api/emergency/ABCDEFGH2345/open', {
      method: 'POST',
      body: JSON.stringify({ accessor_name: 'Doctor' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request, context(['emergency', 'ABCDEFGH2345', 'open']))

    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    expect(await response.json()).toMatchObject({ error: { code: 'backend_unavailable', retryable: true } })
  })

  it('rejects a trusted storage redirect from a non-document route', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, {
      status: 307,
      headers: { Location: `${STORAGE_ORIGIN}/private/object?signature=synthetic` },
    }))
    const { GET } = await loadRoute()
    const request = new NextRequest('https://app.healthkeep.test/api/patients/me')

    const response = await GET(request, context(['patients', 'me']))

    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
  })

  it('passes through a backend-authorized emergency document redirect', async () => {
    const location = `${STORAGE_ORIGIN}/private/emergency-document?signature=synthetic`
    fetchMock.mockResolvedValueOnce(new Response(null, {
      status: 307,
      headers: {
        Location: location,
        'Content-Disposition': 'attachment; filename="record.html"',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    }))
    const { GET } = await loadRoute()
    const token = 'ABCDEFGH2345'
    const request = new NextRequest(`https://app.healthkeep.test/api/emergency/${token}/documents/${DOCUMENT_ID}/download?accessor_name=doctor`)

    const response = await GET(request, context(['emergency', token, 'documents', DOCUMENT_ID, 'download']))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(location)
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('preserves the existing non-redirect body contract and safe document headers', async () => {
    fetchMock.mockResolvedValueOnce(new Response('local document bytes', {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="local.html"',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    }))
    const { GET } = await loadRoute()
    const request = new NextRequest(`https://app.healthkeep.test/api/documents/${DOCUMENT_ID}/download`)

    const response = await GET(request, context(['documents', DOCUMENT_ID, 'download']))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('local document bytes')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="local.html"')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('forwards retry and indexing headers from sensitive API responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'rate_limited', message: 'retry later', retryable: true },
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '42',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    }))
    const { GET } = await loadRoute()
    const request = new NextRequest('https://app.healthkeep.test/api/emergency/token/info')

    const response = await GET(request, context(['emergency', 'token', 'info']))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
  })

  it('preserves request correlation and pagination headers', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'study-1' }]), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': 'request-through-proxy-1',
        'X-Total-Count': '37',
      },
    }))
    const { GET } = await loadRoute()
    const request = new NextRequest('https://app.healthkeep.test/api/dicom/studies?limit=10', {
      headers: { 'X-Request-ID': 'request-through-proxy-1' },
    })

    const response = await GET(request, context(['dicom', 'studies']))

    expect((fetchMock.mock.calls[0][1]?.headers as Headers).get('x-request-id')).toBe('request-through-proxy-1')
    expect(response.headers.get('x-request-id')).toBe('request-through-proxy-1')
    expect(response.headers.get('x-total-count')).toBe('37')
  })
})
