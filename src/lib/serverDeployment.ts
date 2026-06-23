import type { NextRequest } from 'next/server'

export function getApiBaseUrl() {
  return (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').trim().replace(/\/$/, '')
}

export function getConfiguredSiteOrigin() {
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const origin = process.env.NEXT_PUBLIC_FRONTEND_ORIGIN
    || process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
    || (vercelProductionUrl ? `https://${vercelProductionUrl}` : '')

  return origin.trim().replace(/\/$/, '')
}

export function getRequestOrigin(req: NextRequest) {
  const forwardedHost = req.headers.get('x-forwarded-host')
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https'
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, '')

  try {
    return new URL(req.url).origin
  } catch {
    return ''
  }
}

export function getSiteOrigin(req?: NextRequest) {
  return getConfiguredSiteOrigin() || (req ? getRequestOrigin(req) : '')
}

export function getEmergencyPublicOrigin(req?: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_EMERGENCY_PUBLIC_BASE_URL
    || process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
    || getSiteOrigin(req)
  ).trim().replace(/\/$/, '')
}
