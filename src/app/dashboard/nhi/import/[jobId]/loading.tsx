export default function Loading() {
  return (
    <div className="hk-card" role="status" aria-live="polite" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ height: 30, width: '48%', borderRadius: 8, background: '#e8eff2' }} />
      <div style={{ height: 14, width: '76%', marginTop: 14, borderRadius: 6, background: '#eef2f5' }} />
      <div style={{ height: 12, marginTop: 28, borderRadius: 999, background: '#e8eff2' }} />
      <p style={{ marginTop: 14, color: 'var(--hk-ink-3)', fontSize: 13 }}>正在恢復匯入進度…</p>
    </div>
  )
}
