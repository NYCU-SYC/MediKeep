import { NextRequest, NextResponse } from 'next/server'
import { getApiBaseUrl, getEmergencyPublicOrigin, getSiteOrigin } from '@/lib/serverDeployment'

export const dynamic = 'force-dynamic'

function safeHost(value: string) {
  try {
    const url = new URL(value)
    return url.host
  } catch {
    return value || null
  }
}

export async function GET(req: NextRequest) {
  const apiBaseUrl = getApiBaseUrl()
  const siteOrigin = getSiteOrigin(req)
  const emergencyPublicOrigin = getEmergencyPublicOrigin(req)
  const warnings: string[] = []
  let backendStatus = 0
  let backendOk = false

  if (!apiBaseUrl || apiBaseUrl.includes('localhost') || apiBaseUrl.includes('127.0.0.1')) {
    warnings.push('API_BASE_URL/NEXT_PUBLIC_API_BASE_URL is local; production deploy must point to the public backend.')
  }

  if (!siteOrigin || siteOrigin.includes('localhost') || siteOrigin.includes('127.0.0.1')) {
    warnings.push('NEXT_PUBLIC_FRONTEND_ORIGIN/NEXT_PUBLIC_PUBLIC_BASE_URL is local or missing; fixed-domain links may not be shareable.')
  }

  if (!emergencyPublicOrigin || emergencyPublicOrigin.includes('localhost') || emergencyPublicOrigin.includes('127.0.0.1')) {
    warnings.push('NEXT_PUBLIC_EMERGENCY_PUBLIC_BASE_URL is local or missing; QR links may not scan from mobile devices.')
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(`${apiBaseUrl}/health`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      backendStatus = response.status
      backendOk = response.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    backendStatus = 0
    backendOk = false
  }

  return NextResponse.json(
    {
      ok: backendOk && warnings.length === 0,
      backend: {
        ok: backendOk,
        status: backendStatus,
        host: safeHost(apiBaseUrl),
      },
      frontend: {
        origin: siteOrigin || null,
        cmo_login_url: siteOrigin ? `${siteOrigin}/cmo/login` : null,
        user_dashboard_url: siteOrigin ? `${siteOrigin}/dashboard` : null,
        emergency_public_origin: emergencyPublicOrigin || null,
      },
      warnings,
    },
    {
      status: backendOk ? 200 : 502,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
