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
  const bg = published ? '#e7f3f5' : verified ? '#e7f4ec' : '#fdf1e0'
  const fg = published ? '#33596a' : verified ? '#2e8b57' : '#b06a10'
  return <span className="cmo-badge" style={{ background: bg, color: fg }}>{copy}</span>
}

export function CriticalTile({ title, value, tone }: { title: string; value: string; tone: string }) {
  const missing = /未記錄|未填|未知|not recorded/i.test(value)
  return (
    <div className="cmo-card cmo-section" style={{ background: missing ? '#fefce8' : '#f6f9fa', borderColor: missing ? '#efdfae' : undefined }}>
      <div className="cmo-kpi-label">{title}</div>
      <div style={{ marginTop: 8, color: missing ? '#a97614' : tone, fontWeight: 820, lineHeight: 1.45 }}>{value}</div>
      {missing && <div className="cmo-subtitle" style={{ marginTop: 6, fontSize: 11 }}>未知需補，不代表正常。</div>}
    </div>
  )
}
