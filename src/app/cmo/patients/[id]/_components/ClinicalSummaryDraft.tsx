'use client'

// Clinical Summary — AI 初稿態（設計規格 §8.3 / Page 3, P0；本版含 DB+audit 持久化）.
// 系統依病患既有結構化資料（problems / 用藥 / 異常量測 / 病史）預先組裝成分區
// 摘要草稿，每筆標「AI 未確認」與來源；CMO 只需 ✓確認 / ✎修改 / ✕忽略。
//
// 持久化：本元件為「受控元件」——確認狀態由 `reviews`（來自伺服器 audit 軌跡）決定，
// 每次決定透過 `onDecision` 寫回（POST → audit log）。確認是「審閱確認」，與 Problem
// 的 verify→publish 閘不同；不會變更臨床資料列、不會發布、可完整回溯。
import { type CSSProperties, useMemo } from 'react'

export interface SummaryDraftItem {
  id: string
  primary: string
  secondary?: string
  source?: string | null
  flag?: string
  section?: string
}
export interface SummaryDraftSection {
  key: string
  title: string
  items: SummaryDraftItem[]
}
export type SummaryDecision = 'confirmed' | 'dismissed' | 'cleared'

interface Props {
  sections: SummaryDraftSection[]
  reviews: Record<string, string>
  onDecision: (itemKey: string, decision: SummaryDecision, item: SummaryDraftItem) => void
  onEdit?: (item: SummaryDraftItem) => void
  onAddConfirmed?: (items: SummaryDraftItem[]) => void
  busyItemKey?: string
}

const FLAG_STYLE: Record<string, { bg: string; fg: string }> = {
  高風險: { bg: '#faecea', fg: '#a03a30' },
  '出血風險（見警示）': { bg: '#faecea', fg: '#a03a30' },
  '不可能值 · 待確認': { bg: '#fefce8', fg: '#a97614' },
  偏高: { bg: '#fdf1e0', fg: '#b06a10' },
}

export function ClinicalSummaryDraft({ sections, reviews, onDecision, onEdit, onAddConfirmed, busyItemKey }: Props) {
  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const total = allItems.length
  const confirmedItems = useMemo(() => allItems.filter((i) => reviews[i.id] === 'confirmed'), [allItems, reviews])

  if (total === 0) return null

  const btn: CSSProperties = { fontSize: 11, padding: '3px 7px', borderRadius: 6, border: '0.5px solid #c8d4dc', background: '#fff', cursor: 'pointer', color: '#56687a' }
  const disabledBtn: CSSProperties = { opacity: 0.62, cursor: 'wait' }

  return (
    <section className="cmo-card cmo-section" style={{ background: 'linear-gradient(135deg,#ffffff,#f6f9fa)' }}>
      <div className="cmo-title-row" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <div className="cmo-kpi-label">Patient-facing categories</div>
          <h2 className="cmo-section-title" style={{ margin: '4px 0' }}>
            病人端分類草稿 <span className="cmo-badge" style={{ background: '#eef2f5', color: '#56687a', fontWeight: 500 }}>AI 初稿</span>
          </h2>
          <div className="cmo-subtitle">依 User 端六分類自動組裝，每筆附來源；確認/忽略會寫入稽核軌跡，但不變更臨床資料列、不發布。</div>
        </div>
        <span className="cmo-badge" style={{ background: confirmedItems.length === total ? '#e7f4ec' : '#e7f3f5', color: confirmedItems.length === total ? '#2e8b57' : '#33596a' }}>
          已確認 {confirmedItems.length} / {total}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 8 }}>
        {sections.map((section) => (
          <div key={section.key} style={{ border: '0.5px solid #e3e9ee', borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{section.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {section.items.map((item) => {
                const decision = reviews[item.id]
                const isConfirmed = decision === 'confirmed'
                const isDismissed = decision === 'dismissed'
                const isBusy = busyItemKey === item.id
                const flag = item.flag ? FLAG_STYLE[item.flag] ?? { bg: '#eef2f5', fg: '#56687a' } : null
                return (
                  <div
                    key={item.id}
                    style={{
                      borderTop: '0.5px solid #eef2f5', paddingTop: 6,
                      opacity: isDismissed ? 0.5 : 1,
                      background: isConfirmed ? '#e7f4ec' : 'transparent',
                      borderRadius: isConfirmed ? 6 : 0, padding: isConfirmed ? '6px' : '6px 0 0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, textDecoration: isDismissed ? 'line-through' : 'none' }}>{item.primary}</span>
                        {item.flag && flag && <span className="cmo-badge" style={{ background: flag.bg, color: flag.fg, marginLeft: 6 }}>{item.flag}</span>}
                        {item.secondary && <div className="cmo-subtitle" style={{ fontSize: 11, marginTop: 1 }}>{item.secondary}</div>}
                        <span className="cmo-badge" style={{ background: '#e7f3f5', color: '#33596a', marginTop: 3, fontSize: 10 }}>
                          來源：{item.source || '未連結'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {isDismissed ? (
                          <button type="button" style={{ ...btn, ...(isBusy ? disabledBtn : {}) }} disabled={isBusy} onClick={() => onDecision(item.id, 'cleared', item)} aria-label="復原">{isBusy ? '儲存中' : '復原'}</button>
                        ) : (
                          <>
                            <button type="button" style={{ ...btn, ...(isConfirmed ? { background: '#dcefe3', color: '#2e8b57', borderColor: '#cfe8da' } : {}), ...(isBusy ? disabledBtn : {}) }} disabled={isBusy} onClick={() => onDecision(item.id, isConfirmed ? 'cleared' : 'confirmed', item)} aria-label="確認">{isBusy ? '儲存中' : isConfirmed ? '已確認' : '確認'}</button>
                            <button type="button" style={{ ...btn, ...(isBusy ? disabledBtn : {}) }} disabled={isBusy} onClick={() => onEdit?.(item)} aria-label="修改">修改</button>
                            <button type="button" style={{ ...btn, ...(isBusy ? disabledBtn : {}) }} disabled={isBusy} onClick={() => onDecision(item.id, 'dismissed', item)} aria-label="忽略">忽略</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button
          type="button"
          className="cmo-button"
          disabled={confirmedItems.length === 0}
          onClick={() => onAddConfirmed?.(confirmedItems)}
        >
          將已確認 {confirmedItems.length} 項加入建議草稿
        </button>
      </div>
    </section>
  )
}
