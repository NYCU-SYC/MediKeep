// Small presentational primitives for the CMO patient workspace.
// Extracted from page.tsx (Phase 2 componentization). Pure, no state.
import { type ReactNode } from 'react'

export function StatCard({ label, value, note, tone }: { label: string; value: number | string; note: string; tone: string }) {
  return (
    <div className="cmo-card cmo-kpi">
      <div className="cmo-kpi-label">{label}</div>
      <div className="cmo-kpi-value" style={{ color: tone }}>{value}</div>
      <div className="cmo-subtitle" style={{ marginTop: 8 }}>{note}</div>
    </div>
  )
}

export function EmptyState({ children }: { children: string }) {
  return <div className="cmo-card cmo-section cmo-muted" style={{ textAlign: 'center' }}>{children}</div>
}

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  )
}

export function QuickChipRow({ children }: { children: ReactNode }) {
  return <div className="cmo-chipbar" style={{ margin: '10px 0 12px' }}>{children}</div>
}

export function RecordList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <div style={{ marginTop: 14 }}>
      <div className="cmo-kpi-label" style={{ marginBottom: 8 }}>{title}</div>
      <div className="cmo-list">
        {hasChildren ? children : <div className="cmo-muted">{empty}</div>}
      </div>
    </div>
  )
}

export function DiffBox({ title, data, empty }: { title: string; data: Record<string, unknown> | null; empty: string }) {
  return (
    <div className="cmo-card cmo-section" style={{ background: '#fff' }}>
      <div className="cmo-kpi-label">{title}</div>
      {data && Object.keys(data).length > 0 ? (
        <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, color: '#334155', maxHeight: 260, overflow: 'auto' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : (
        <div className="cmo-muted" style={{ marginTop: 8 }}>{empty}</div>
      )}
    </div>
  )
}
