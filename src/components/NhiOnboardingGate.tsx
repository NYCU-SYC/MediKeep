'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getNhiOnboarding, NhiOnboardingState } from '@/lib/nhiImports'
import { nextRouteFromSearch, routeWithNext, safeNextRoute } from '@/lib/internalRoutes'
import styles from './NhiOnboardingGate.module.css'

type GateStatus = 'loading' | 'ready' | 'unavailable'

function isImportFlow(pathname: string, mode: string | null): boolean {
  return pathname === '/onboarding/nhi'
    || pathname.startsWith('/dashboard/nhi/import/')
    || (pathname === '/dashboard/upload' && mode === 'nhi-first')
}

function currentRoute(pathname: string, search: string): string {
  return safeNextRoute(`${pathname}${search ? `?${search}` : ''}`, '/dashboard')
}

/**
 * The gate is deliberately a redirect coordinator, not a modal. The full
 * first-import journey lives at /onboarding/nhi, while resumable job pages
 * remain exempt so a queued import can never bounce back into onboarding.
 */
export default function NhiOnboardingGate() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirected = useRef(false)
  const [status, setStatus] = useState<GateStatus>('loading')
  const [onboarding, setOnboarding] = useState<NhiOnboardingState | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const next = await getNhiOnboarding()
      setOnboarding(next)
      setStatus('ready')
    } catch {
      setOnboarding(null)
      setStatus('unavailable')
    }
  }, [])

  // This effect intentionally starts the remote admission check on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const flowActive = isImportFlow(pathname, searchParams.get('mode'))
  const needsOnboarding = !flowActive
    && status === 'ready'
    && onboarding?.feature_enabled === true
    && onboarding.reminder_required === true
    && !onboarding.completed_at
    // A skipped response is a legacy compatibility completion. It must not
    // redirect old users into a new loop while the backend migrates fields.
    && !onboarding.skipped_at

  useEffect(() => {
    if (!needsOnboarding || redirected.current) return
    redirected.current = true
    const search = searchParams.toString()
    const next = currentRoute(pathname, search)
    router.replace(`/onboarding/nhi?next=${encodeURIComponent(next)}`)
  }, [needsOnboarding, pathname, router, searchParams])

  useEffect(() => {
    if (!needsOnboarding) redirected.current = false
  }, [needsOnboarding])

  if (status === 'loading') {
    return (
      <div className={styles.redirectNotice} role="status" aria-live="polite">
        正在確認首次健保匯入設定…
      </div>
    )
  }

  if (needsOnboarding) {
    return (
      <div className={styles.redirectNotice} role="status" aria-live="polite">
        正在開啟首次健保匯入頁面…
      </div>
    )
  }

  if (status === 'unavailable') {
    const next = nextRouteFromSearch(
      `next=${encodeURIComponent(currentRoute(pathname, searchParams.toString()))}`,
      '/dashboard',
    )
    return (
      <div className={styles.error} role="status" aria-live="polite">
        <span className={styles.errorText}>首次健保匯入狀態目前無法確認；健康資料頁仍可使用。</span>
        <button type="button" className={styles.retry} onClick={() => void load()}>重新確認</button>
        <Link className={styles.login} href={routeWithNext('/upload-entry', next)}>重新登入</Link>
      </div>
    )
  }

  if (status === 'ready' && onboarding?.feature_enabled === false) {
    return (
      <div className={styles.error} role="status" aria-live="polite">
        <span className={styles.errorText}>首次健保匯入功能目前未開放；其他健康資料仍可使用。</span>
        <button type="button" className={styles.retry} onClick={() => void load()}>重新確認</button>
      </div>
    )
  }

  return null
}
