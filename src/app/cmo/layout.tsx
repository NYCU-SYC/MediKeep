'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { api, setCmoSessionToken } from '@/lib/api'
import { SyncProvider } from '@/lib/sync'

interface CmoProfile {
  display_name: string
  email: string
}

export default function CmoLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isLogin = pathname === '/cmo/login'
  const [cmo, setCmo] = useState<CmoProfile | null>(null)

  useEffect(() => {
    if (isLogin) return
    let alive = true
    const goLogin = () => window.location.replace('/cmo/login')

    api.get('/api/cmo/auth/me')
      .then((profile) => {
        if (!alive) return
        if (!profile) {
          goLogin()
          return
        }
        setCmo(profile as CmoProfile)
      })
      .catch(() => {
        if (alive) goLogin()
      })

    return () => {
      alive = false
    }
  }, [isLogin])

  const logout = async () => {
    await api.post('/api/cmo/auth/logout').catch(() => null)
    setCmoSessionToken(null)
    setCmo(null)
    router.push('/cmo/login')
  }

  if (isLogin) return <>{children}</>

  const isWorkbench = pathname === '/cmo/workbench'
  const isPatient = pathname.startsWith('/cmo/patients')

  if (!cmo) {
    return (
      <div className="cmo-shell">
        <div className="cmo-page">
          <div className="cmo-card cmo-section" style={{ maxWidth: 420, margin: '18vh auto 0', textAlign: 'center' }}>
            <div className="cmo-kpi-label">CMO Console</div>
            <div className="cmo-title" style={{ fontSize: 20, marginTop: 8 }}>正在確認登入狀態</div>
            <div className="cmo-subtitle">若工作階段已過期，系統會帶你回登入頁。</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="cmo-shell">
      <nav className="cmo-topbar">
        <Link href="/cmo/workbench" className="cmo-brand" aria-label="HealthKeep CMO Console">
          <span className="cmo-logo">H</span>
          <span>
            HealthKeep
            <span className="cmo-muted" style={{ marginLeft: 8, fontWeight: 650 }}>CMO Console</span>
          </span>
        </Link>

        <div className="cmo-nav" aria-label="CMO navigation">
          <Link className={`cmo-nav-link ${isWorkbench ? 'active' : ''}`} href="/cmo/workbench">
            工作台
          </Link>
          <Link className={`cmo-nav-link ${isPatient ? 'active' : ''}`} href="/cmo/workbench#patients">
            病患清單
          </Link>
        </div>

        <div className="cmo-account">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div className="cmo-avatar">{cmo.display_name.slice(0, 1).toUpperCase()}</div>
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ fontSize: 12, fontWeight: 750 }}>{cmo.display_name}</div>
              <div className="cmo-muted" style={{ fontSize: 10 }}>{cmo.email}</div>
            </div>
          </div>
          <button type="button" className="cmo-button" onClick={logout} style={{ background: 'rgb(255 255 255 / 0.08)', color: '#fff', borderColor: 'rgb(255 255 255 / 0.16)' }}>
            登出
          </button>
        </div>
      </nav>

      <SyncProvider scope="cmo" enabled={!!cmo}>
        <main>{children}</main>
      </SyncProvider>
    </div>
  )
}
