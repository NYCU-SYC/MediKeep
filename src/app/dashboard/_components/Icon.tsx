// Consistent inline-SVG icon set for the User App (Phase 3).
// Replaces emoji-as-icons (inconsistent across platforms, unprofessional for a
// medical product) with one stroke-based set. Keyed by the existing emoji so
// callers don't need to change their data; falls back to the raw string.
import { type ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  '🏠': <><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10h14V10" /></>,
  '🩺': <path d="M3 12h4l2 6 4-14 2 8h6" />,
  '🔔': <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 21h4" /></>,
  '👤': <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  '🧬': <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h4" /><path d="M9 13h6M9 17h4" /></>,
  '🛟': <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" />,
  '🆘': <><path d="M12 3 2 20h20z" /><path d="M12 10v4" /><path d="M12 17.5h.01" /></>,
  '🏥': <><path d="M4 21V5h16v16" /><path d="M12 8v6M9 11h6" /></>,
  '💊': <><path d="M10.5 3.5a4.95 4.95 0 0 1 7 7l-7 7a4.95 4.95 0 0 1-7-7z" /><path d="M7 7l7 7" /></>,
  '📈': <><path d="M3 17l6-6 4 4 7-7" /><path d="M17 8h4v4" /></>,
  '📑': <><path d="M6 3h8l4 4v14H6z" /><path d="M9 12h6M9 16h6" /></>,
  '➕': <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  '🩻': <><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3" /><rect x="7" y="8" width="10" height="8" rx="1" /></>,
  '📁': <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  '📋': <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 9h6M9 13h6M9 17h4" /></>,
  // named icons used directly
  family: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M16 6a3 3 0 0 1 0 6M18 20c0-2.2-1-3.8-2.5-4.6" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
}

export function Icon({ name, size = '1.25em' }: { name: string; size?: string | number }) {
  const inner = PATHS[name]
  if (!inner) return <span aria-hidden>{name}</span>
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: 'block', flexShrink: 0 }}
    >
      {inner}
    </svg>
  )
}

// Filled brand heart for the HealthKeep logo (replaces 💙).
export function HeartLogo({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" />
    </svg>
  )
}
