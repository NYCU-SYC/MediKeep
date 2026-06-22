// Leaf badge / tile components for the CMO patient workspace.
// Extracted from page.tsx (Phase 2 componentization). All colors come from the
// canonical statusSystem.ts so priority / source / status badges are identical
// across workbench, workspace, follow-up and missing-data cards.
import { PRIORITY_META, toPriority, sourceMeta, reviewToneMeta } from '@/lib/statusSystem'

export type ReviewPriority = 'critical' | 'high' | 'medium' | 'low'

export function PriorityBadge({ priority }: { priority: ReviewPriority }) {
  const m = PRIORITY_META[toPriority(priority)]
  return <span className="cmo-badge" style={{ background: m.bg, color: m.fg }}>{m.label}</span>
}

export function DataSourceBadge({ source }: { source: string }) {
  const m = sourceMeta(source)
  return <span className="cmo-badge" style={{ background: m.bg, color: m.fg }}>{source}</span>
}

export function ReviewStatusBadge({ status }: { status: string }) {
  const m = reviewToneMeta(status)
  return <span className="cmo-badge" style={{ background: m.bg, color: m.fg }}>{status}</span>
}

export function ClinicalPublishBadge({ verified, published }: { verified?: boolean; published?: boolean }) {
  const copy = published ? 'Patient visible' : verified ? 'Verified, not published' : 'Needs CMO verify'
  const bg = published ? '#eff6ff' : verified ? '#ecfdf5' : '#fff7ed'
  const fg = published ? '#1d4ed8' : verified ? '#047857' : '#c2410c'
  return <span className="cmo-badge" style={{ background: bg, color: fg }}>{copy}</span>
}

export function CriticalTile({ title, value, tone }: { title: string; value: string; tone: string }) {
  return (
    <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
      <div className="cmo-kpi-label">{title}</div>
      <div style={{ marginTop: 8, color: tone, fontWeight: 820, lineHeight: 1.45 }}>{value}</div>
    </div>
  )
}
