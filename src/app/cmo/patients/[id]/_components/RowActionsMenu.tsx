'use client'

// Overflow menu for table-row actions. Keeps the primary action visible and
// hides secondary/destructive ones behind "⋯", so an action column holds 2–3
// controls instead of 8 (which crushed CJK labels into vertical text).

import { useEffect, useRef, useState, type ReactNode } from 'react'

export type RowAction = {
  key: string
  label: string
  /** Short hint shown under the label. */
  hint?: string
  tone?: 'default' | 'danger'
  disabled?: boolean
  onSelect: () => void
}

export type RowActionGroup = {
  /** Optional heading, e.g. "Legacy 流程". */
  title?: string
  actions: RowAction[]
}

export function RowActionsMenu({
  groups,
  ariaLabel = '更多動作',
  trigger,
}: {
  groups: RowActionGroup[]
  ariaLabel?: string
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const usable = groups.filter((group) => group.actions.length > 0)
  if (usable.length === 0) return null

  return (
    <div className="cmo-rowmenu" ref={wrapRef} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="cmo-rowmenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        {trigger ?? '⋯'}
      </button>
      {open && (
        <div className="cmo-rowmenu-pop" role="menu">
          {usable.map((group, index) => (
            <div key={group.title ?? `g${index}`} className="cmo-rowmenu-group">
              {group.title && <div className="cmo-rowmenu-title">{group.title}</div>}
              {group.actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  role="menuitem"
                  className={`cmo-rowmenu-item${action.tone === 'danger' ? ' danger' : ''}`}
                  disabled={action.disabled}
                  onClick={() => { setOpen(false); action.onSelect() }}
                >
                  <span className="lbl">{action.label}</span>
                  {action.hint && <span className="hint">{action.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
