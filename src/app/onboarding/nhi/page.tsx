'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import NhiFirstImportFlow from '@/components/NhiFirstImportFlow'
import { api, ApiError } from '@/lib/api'
import { getNhiOnboarding } from '@/lib/nhiImports'
import { nextRouteFromSearch, routeWithNext } from '@/lib/internalRoutes'

type Member = { name: string }
type PageState = 'loading' | 'ready' | 'error' | 'disabled' | 'redirecting'

function memberRows(value: unknown): Member[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { members?: unknown }).members)
      ? (value as { members: unknown[] }).members
      : []
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const name = (row as { name?: unknown }).name
    return typeof name === 'string' && name.trim() ? [{ name: name.trim() }] : []
  })
}

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.message) return error.message
  return '首次健保匯入目前無法載入，請確認網路後重試。'
}

function NhiOnboardingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = nextRouteFromSearch(searchParams.toString(), '/dashboard')
  const [state, setState] = useState<PageState>('loading')
  const [members, setMembers] = useState<Member[]>([])
  const [memberName, setMemberName] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const me = await api.get('/api/auth/me') as { authenticated?: boolean; needs_binding?: boolean }
      if (!me?.authenticated) {
        router.replace(routeWithNext('/upload-entry', '/onboarding/nhi'))
        return
      }
      const [onboardingState, memberResponse] = await Promise.all([
        getNhiOnboarding(),
        api.get('/api/members'),
      ])
      const nextMembers = memberRows(memberResponse)
      setMembers(nextMembers)
      setMemberName((current) => current || nextMembers[0]?.name || '')
      if (onboardingState.feature_enabled === false) {
        setState('disabled')
      } else if (onboardingState.completed_at || onboardingState.skipped_at) {
        setState('redirecting')
        router.replace(next)
      } else {
        setState('ready')
      }
    } catch (caught) {
      setState('error')
      setError(errorText(caught))
    }
  }, [next, router])

  // This effect intentionally starts the remote admission check on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  if (state === 'loading' || state === 'redirecting') {
    return (
      <main className="page-wrap" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <section className="hk-card" role="status" aria-live="polite" aria-busy="true" style={{ width: 'min(100%, 520px)' }}>
          <h1 style={{ margin: 0, color: 'var(--hk-ink)' }}>首次健保匯入</h1>
          <p style={{ margin: '10px 0 0', color: 'var(--hk-ink-2)', lineHeight: 1.6 }}>
            {state === 'redirecting' ? '設定已完成，正在回到原本頁面…' : '正在確認匯入狀態…'}
          </p>
        </section>
      </main>
    )
  }

  if (state === 'disabled') {
    return (
      <main className="page-wrap" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <section className="hk-card" role="status" style={{ width: 'min(100%, 520px)' }}>
          <h1 style={{ margin: 0, color: 'var(--hk-ink)' }}>首次健保匯入</h1>
          <p style={{ margin: '10px 0 0', color: 'var(--hk-ink-2)', lineHeight: 1.65 }}>
            這項功能目前尚未開放。其他健康資料仍可使用；功能開放後，你可以再從健保資料頁開始匯入。
          </p>
          <Link className="hk-btn hk-btn-primary" style={{ display: 'inline-flex', marginTop: 16 }} href={next}>回到 HealthKeep</Link>
        </section>
      </main>
    )
  }

  if (state === 'error') {
    return (
      <main className="page-wrap" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <section className="hk-card" role="alert" style={{ width: 'min(100%, 520px)' }}>
          <h1 style={{ margin: 0, color: 'var(--hk-ink)' }}>首次健保匯入</h1>
          <p style={{ margin: '10px 0 0', color: 'var(--hk-red)', lineHeight: 1.65 }}>{error}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            <button type="button" className="hk-btn hk-btn-primary" onClick={() => void load()}>重新載入</button>
            <Link className="hk-btn hk-btn-ghost" href={routeWithNext('/upload-entry', '/onboarding/nhi')}>重新登入</Link>
          </div>
        </section>
      </main>
    )
  }

  return (
    <NhiFirstImportFlow
      memberName={memberName}
      members={members}
      onMemberChange={setMemberName}
      onBack={() => router.replace(next)}
      nextPath={next}
      onComplete={() => router.replace(next)}
      completeOnboarding
    />
  )
}

export default function NhiOnboardingPage() {
  return (
    <Suspense fallback={
      <main className="page-wrap" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <section className="hk-card" role="status" aria-live="polite" style={{ width: 'min(100%, 520px)' }}>
          <h1 style={{ margin: 0, color: 'var(--hk-ink)' }}>首次健保匯入</h1>
          <p style={{ margin: '10px 0 0', color: 'var(--hk-ink-2)' }}>正在準備匯入頁面…</p>
        </section>
      </main>
    }>
      <NhiOnboardingContent />
    </Suspense>
  )
}
