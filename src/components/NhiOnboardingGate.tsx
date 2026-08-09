'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { getNhiOnboarding, markNhiOnboardingSeen, NhiOnboardingState, skipNhiOnboarding } from '@/lib/nhiImports'
import styles from './NhiOnboardingGate.module.css'

type GateStatus = 'loading' | 'ready' | 'unavailable'

function isImportFlow(pathname: string, mode: string | null): boolean {
  return pathname.startsWith('/dashboard/nhi/import/')
    || (pathname === '/dashboard/upload' && mode === 'nhi-first')
}

export default function NhiOnboardingGate() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLAnchorElement>(null)
  const previousFlowActive = useRef(false)
  const seenRequestStarted = useRef(false)
  const [status, setStatus] = useState<GateStatus>('loading')
  const [onboarding, setOnboarding] = useState<NhiOnboardingState | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    try {
      const next = await getNhiOnboarding()
      setOnboarding(next)
      setStatus('ready')
      setActionError('')
    } catch {
      setOnboarding(null)
      setStatus('unavailable')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const flowActive = isImportFlow(pathname, searchParams.get('mode'))
  const featureDisabled = status === 'ready' && onboarding?.feature_enabled === false
  const showNonBlockingNotice = !flowActive && (status === 'unavailable' || featureDisabled)
  const showGate = !flowActive
    && status === 'ready'
    && onboarding?.feature_enabled === true
    && onboarding.reminder_required === true
    && !onboarding.completed_at
    && !onboarding.skipped_at

  // GET remains observational. Displaying the dialog is the explicit event
  // that marks this identity's first-login reminder as seen.
  useEffect(() => {
    if (!showGate || onboarding?.seen_at || seenRequestStarted.current) return
    seenRequestStarted.current = true
    void markNhiOnboardingSeen()
      .then((next) => setOnboarding(next))
      .catch(() => { seenRequestStarted.current = false })
  }, [onboarding?.seen_at, showGate])

  // The dashboard layout persists while the import page redirects to the
  // timeline. Refresh the server-owned onboarding state at that boundary so
  // a successfully completed job cannot reveal the stale first-login modal.
  useEffect(() => {
    if (previousFlowActive.current && !flowActive) void load()
    previousFlowActive.current = flowActive
  }, [flowActive, load])

  // Move focus into the blocking dialog and prevent the page behind it from
  // scrolling. The first-import route itself is intentionally exempt above.
  useEffect(() => {
    if (!showGate) return
    primaryRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [showGate])

  const containTabFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!showGate || event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ))
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleSkip = async () => {
    setActionPending(true)
    setActionError('')
    try {
      const next = await skipNhiOnboarding()
      setOnboarding(next)
      setStatus('ready')
      router.refresh()
    } catch {
      setActionError('稍後處理未完成，請再試一次。')
    } finally {
      setActionPending(false)
    }
  }

  return (
    <>
      {showGate && (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="nhi-onboarding-title" onKeyDown={containTabFocus}>
          <section ref={dialogRef} className={styles.card}>
            <div className={styles.eyebrow}>首次資料匯入</div>
            <h1 id="nhi-onboarding-title" className={styles.title}>把近年的健保資料帶回 HealthKeep</h1>
            <p className={styles.body}>
              匯入後，我們會將資料整理成健康時間軸，讓您更容易回顧就醫、住院與手術等紀錄。您可以現在開始，也可以稍後從首頁提醒卡繼續。
            </p>
            <div className={styles.actions}>
              <Link ref={primaryRef} className={styles.primary} href="/dashboard/upload?mode=nhi-first">
                立即匯入
              </Link>
              <button
                type="button"
                className={styles.secondary}
                onClick={handleSkip}
                disabled={actionPending}
              >
                {actionPending ? '正在儲存…' : '稍後處理'}
              </button>
            </div>
            {actionError && <p className={styles.body} role="alert">{actionError}</p>}
          </section>
        </div>
      )}
      {showNonBlockingNotice && (
        <div className={styles.error} role="status" aria-live="polite">
          <span className={styles.errorText}>
            {featureDisabled ? 'NHI 匯入功能目前未開放，首頁仍可正常使用。' : 'NHI 匯入提醒目前無法載入，首頁仍可正常使用。'}
          </span>
          <button type="button" className={styles.retry} onClick={() => void load()}>重試</button>
        </div>
      )}
    </>
  )
}
