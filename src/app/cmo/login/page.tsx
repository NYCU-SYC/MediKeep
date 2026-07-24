'use client'

import { type FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setCmoSessionToken } from '@/lib/api'

export default function CmoLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const submittedEmail = String(form.get('email') ?? email).trim()
    const submittedPassword = String(form.get('password') ?? password)

    if (!submittedEmail || !submittedPassword) {
      setError('請輸入 Email 與密碼。')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/cmo/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: submittedEmail, password: submittedPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: '' }))
        setError(data?.error?.message || data.detail || '登入失敗，請確認帳號或密碼。')
        return
      }
      const data = await res.json().catch(() => ({}))
      setCmoSessionToken(data.session_token)
      router.push('/cmo/dashboard')
    } catch {
      setError('目前無法連線到 CMO 服務，請稍後再試。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="cmo-shell cmo-login-grid">
      <section style={{ position: 'relative', overflow: 'hidden', padding: '56px clamp(28px, 6vw, 72px)', background: 'linear-gradient(135deg, #0e161d 0%, #1f2937 58%, #3e6b7e 140%)', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div className="cmo-brand" style={{ minWidth: 0 }}>
            <span className="cmo-logo">H</span>
            <span>HealthKeep <span style={{ color: '#9ca3af', fontWeight: 650 }}>CMO Console</span></span>
          </div>
          <div style={{ maxWidth: 560, marginTop: 92 }}>
            <div className="cmo-badge" style={{ background: 'rgb(255 255 255 / 0.10)', color: '#d5e7ec', border: '1px solid rgb(255 255 255 / 0.16)' }}>Clinical operations</div>
            <h1 style={{ margin: '18px 0 0', fontSize: 42, lineHeight: 1.18, letterSpacing: 0, fontWeight: 850 }}>
              把病患資訊整理成 CMO 能快速判讀的工作流。
            </h1>
            <p style={{ marginTop: 18, color: '#c8d4dc', fontSize: 15, lineHeight: 1.8 }}>
              工作台會依風險、Draft、未發布 Problem、文件與影像自動分流；進入病患頁後可直接查看紅區、交班摘要、Problem 與近期資料時間線。
            </p>
          </div>
        </div>

        <div className="cmo-grid-3" style={{ marginTop: 48 }}>
          {[
            ['優先排序', '高風險與待發布項目先出現'],
            ['快速整理', '一鍵複製交班摘要'],
            ['完整脈絡', 'Problem、紀錄、文件、影像同頁查閱'],
          ].map(([title, body]) => (
            <div key={title} className="cmo-card cmo-section" style={{ background: 'rgb(255 255 255 / 0.07)', borderColor: 'rgb(255 255 255 / 0.14)', color: '#fff' }}>
              <div style={{ fontWeight: 800 }}>{title}</div>
              <div style={{ marginTop: 5, color: '#c8d4dc', fontSize: 12 }}>{body}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', placeItems: 'center', padding: '40px 24px' }}>
        <form className="cmo-card cmo-section" onSubmit={handleSubmit} style={{ width: 'min(100%, 420px)', padding: 24 }}>
          <div className="cmo-kpi-label">Secure sign in</div>
          <h2 className="cmo-title" style={{ marginTop: 8 }}>CMO 登入</h2>
          <div className="cmo-subtitle">請使用授權的 CMO 帳號進入臨床工作台。</div>

          <label style={{ display: 'block', marginTop: 22 }}>
            <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>Email</div>
            <input
              className="cmo-input"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="doctor@hospital.tw"
            />
          </label>

          <div style={{ display: 'block', marginTop: 14 }}>
            <div className="cmo-row" style={{ marginBottom: 6 }}>
              <label htmlFor="cmo-password" className="cmo-kpi-label">密碼</label>
              <button type="button" className="cmo-muted" style={{ fontSize: 12 }} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? '隱藏' : '顯示'}
              </button>
            </div>
            <input
              id="cmo-password"
              className="cmo-input"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="輸入密碼"
            />
          </div>

          {error && (
            <div className="cmo-card cmo-section" role="alert" style={{ marginTop: 14, background: '#faecea', borderColor: '#f2d3cf', color: '#a03a30' }}>
              {error}
            </div>
          )}

          <button className="cmo-button primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 20 }}>
            {loading ? '登入中...' : '登入 CMO Console'}
          </button>

          <div className="cmo-subtitle" style={{ marginTop: 18 }}>
            所有 CMO 操作會保留審核紀錄，請勿使用共用帳號或在未受信任裝置登入。
          </div>
        </form>
      </section>
    </main>
  )
}
