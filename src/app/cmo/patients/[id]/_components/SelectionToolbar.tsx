'use client'

// Highlight-to-Summary floating toolbar (設計規格 §9.A, P0).
// When the CMO selects text inside an evidence zone (timeline / review queue /
// document text — anything marked [data-selection-zone]), a small toolbar pops
// up AT the selection offering one-click classification into the structured
// summary, with the source automatically captured from the nearest
// [data-source] ancestor. Typing surfaces (input/textarea/contenteditable) are
// excluded so it never interrupts note-writing.
import { useEffect, useRef, useState } from 'react'

export interface SelectionCategoryOption {
  value: string
  label: string
}

interface SelectionState {
  x: number
  y: number
  text: string
  source: string | null
}

interface Props {
  categories: SelectionCategoryOption[]
  onPick: (category: string, payload: { text: string; source: string | null }) => void
  zoneSelector?: string
  minChars?: number
}

export function SelectionToolbar({ categories, onPick, zoneSelector = '[data-selection-zone]', minChars = 2 }: Props) {
  const [sel, setSel] = useState<SelectionState | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function elementOf(node: Node | null): HTMLElement | null {
      if (!node) return null
      return node instanceof HTMLElement ? node : node.parentElement
    }
    function update() {
      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      if (!selection || selection.isCollapsed || text.length < minChars) { setSel(null); return }
      const anchor = elementOf(selection.anchorNode)
      if (!anchor) { setSel(null); return }
      // Never trigger while typing.
      if (anchor.closest('input, textarea, [contenteditable="true"]')) { setSel(null); return }
      if (!anchor.closest(zoneSelector)) { setSel(null); return }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) { setSel(null); return }
      const source = anchor.closest('[data-source]')?.getAttribute('data-source') || null
      setSel({ x: rect.left + rect.width / 2, y: rect.top, text, source })
    }
    const onMouseUp = () => window.setTimeout(update, 0)
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift' || e.shiftKey) window.setTimeout(update, 0) }
    const onMouseDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setSel(null) }
    const onScroll = () => setSel(null)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [zoneSelector, minChars])

  if (!sel) return null
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const left = Math.min(Math.max(190, sel.x), vw - 190)
  const top = Math.max(56, sel.y)

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="將選取文字加入結構化摘要"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed', top, left, transform: 'translate(-50%, calc(-100% - 8px))', zIndex: 60,
        background: '#ffffff', border: '1px solid #c8d4dc', borderRadius: 10,
        boxShadow: '0 8px 28px rgba(15,23,42,0.18)', padding: 8, maxWidth: 360,
        display: 'flex', flexWrap: 'wrap', gap: 6,
      }}
    >
      <div style={{ width: '100%', fontSize: 11, color: '#6b7c8c', marginBottom: 2, lineHeight: 1.4 }}>
        加入結構化摘要{sel.source ? ` · 來源：${sel.source}` : ''}
      </div>
      {categories.map((c) => (
        <button
          key={c.value}
          type="button"
          className="cmo-button"
          style={{ fontSize: 12, padding: '4px 9px' }}
          onClick={() => {
            onPick(c.value, { text: sel.text, source: sel.source })
            window.getSelection()?.removeAllRanges()
            setSel(null)
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
