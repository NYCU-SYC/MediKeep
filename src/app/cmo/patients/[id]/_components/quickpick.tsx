'use client'

// One-click quick-pick chips — minimise CMO typing.
// Clicking a chip sets the field value; clicking the active chip again clears it
// (when allowClear). Purely presentational: value + handler arrive via props and
// reuse the existing `.cmo-chip` styling.

import { type ReactNode, useMemo, useState } from 'react'
import {
  DRUGS,
  displayDrugName,
  searchDiagnoses,
  searchDrugs,
  type DiagnosisEntry,
  type DrugEntry,
} from '@/lib/clinicalDictionary'

export type QuickPickOption = { label: string; value?: string }

export function QuickPick({
  options,
  value,
  onPick,
  ariaLabel,
  allowClear = true,
  mode = 'set',
  separator = '',
}: {
  options: ReadonlyArray<QuickPickOption>
  value?: string
  onPick: (next: string) => void
  ariaLabel?: string
  allowClear?: boolean
  // 'set' replaces the field (with toggle-clear); 'append' inserts the option
  // text into an existing value — used to compose textareas from templates.
  mode?: 'set' | 'append'
  separator?: string
}) {
  if (options.length === 0) return null
  return (
    <div className="cmo-chipbar" style={{ marginTop: 6 }} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const optionValue = opt.value ?? opt.label
        const active = mode === 'set' && (value ?? '').trim() === optionValue
        const handlePick = () => {
          if (mode === 'append') {
            const current = value ?? ''
            onPick(current ? `${current}${separator}${optionValue}` : optionValue)
          } else {
            onPick(active && allowClear ? '' : optionValue)
          }
        }
        return (
          <button
            type="button"
            key={opt.label}
            className={`cmo-chip${active ? ' active' : ''}`}
            aria-pressed={active}
            onClick={handlePick}
          >
            {mode === 'append' ? `＋ ${opt.label}` : opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Canned presets (all ≤ 20 chars so they fit the C7 cell cap) ───────────────

export const MED_FREQUENCY_OPTIONS: ReadonlyArray<QuickPickOption> = [
  { label: '每日1次' },
  { label: '每日2次' },
  { label: '每日3次' },
  { label: '每日4次' },
  { label: '睡前' },
  { label: '需要時' },
  { label: '每週1次' },
]

export const MED_ROUTE_OPTIONS: ReadonlyArray<QuickPickOption> = [
  { label: '口服' },
  { label: '針劑' },
  { label: '皮下注射' },
  { label: '外用' },
  { label: '吸入' },
  { label: '舌下' },
  { label: '其他' },
]

export const PROBLEM_CADENCE_OPTIONS: ReadonlyArray<QuickPickOption> = [
  { label: '每 1 個月' },
  { label: '每 3 個月' },
  { label: '每 6 個月' },
  { label: '每年' },
  { label: '每次回診追蹤' },
  { label: '暫無需回診' },
]

export const ATTENTION_CHECK_OPTIONS: ReadonlyArray<QuickPickOption> = [
  { label: '血壓' },
  { label: '血糖' },
  { label: 'HbA1c' },
  { label: 'LDL' },
  { label: '腎功能' },
  { label: '體重' },
]

export const ATTENTION_FOLLOWUP_OPTIONS: ReadonlyArray<QuickPickOption> = [
  { label: '2 週內' },
  { label: '1 個月' },
  { label: '3 個月' },
  { label: '下次回診前' },
]

export const ATTENTION_ADVICE_OPTIONS: ReadonlyArray<QuickPickOption> = [
  { label: '回診確認' },
  { label: '持續追蹤' },
  { label: '維持用藥' },
  { label: '注意飲食' },
  { label: '規律運動' },
]

// ── Free-text templates (append mode): short chip label, full sentence value ──

export const SUMMARY_HEALTH_TEMPLATES: ReadonlyArray<QuickPickOption> = [
  { label: '整體穩定', value: '整體狀況穩定，目前持續追蹤中。' },
  { label: '數值偏高', value: '本次部分數值偏高，需要留意並持續追蹤。' },
  { label: '檢查正常', value: '檢查結果大致正常，暫無立即風險。' },
  { label: '慢性病控制中', value: '慢性疾病目前控制良好，依醫囑追蹤即可。' },
]

export const SUMMARY_ADVICE_TEMPLATES: ReadonlyArray<QuickPickOption> = [
  { label: '規律服藥', value: '請依醫囑規律服藥，勿自行停藥或改劑量。' },
  { label: '回診確認', value: '建議回診時與醫師確認目前狀況與用藥。' },
  { label: '維持追蹤', value: '維持目前的追蹤與生活習慣即可。' },
  { label: '注意症狀', value: '若出現不適或症狀變化，請盡快就醫。' },
  { label: '控制飲食', value: '請注意飲食控制，減少高鹽、高糖與高油食物。' },
]

export const SUMMARY_NEXTSTEP_TEMPLATES: ReadonlyArray<QuickPickOption> = [
  { label: '2 週回診', value: '請於 2 週內回診。' },
  { label: '補抽血報告', value: '請上傳最近一次抽血檢驗報告。' },
  { label: '記錄血壓', value: '請持續每日記錄血壓並上傳。' },
  { label: '記錄血糖', value: '請持續記錄血糖數值並上傳。' },
  { label: '回診追蹤', value: '請依約回診追蹤。' },
]

// Common generic drug names for the medication autocomplete datalist.
// Derived from the central clinical dictionary so there is one source of truth.
export const COMMON_GENERIC_NAMES: readonly string[] = DRUGS.map((drug) => drug.generic)

// ── Search-select: type a few chars (or nothing) and pick — fills many fields ─

function SearchSelect<T>({
  placeholder,
  search,
  getKey,
  renderOption,
  onSelect,
  ariaLabel,
}: {
  placeholder: string
  search: (query: string) => T[]
  getKey: (item: T) => string
  renderOption: (item: T) => ReactNode
  onSelect: (item: T) => void
  ariaLabel?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => (open ? search(query) : []), [open, query, search])
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="cmo-input"
        value={query}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
      />
      {open && results.length > 0 && (
        <div className="cmo-search-pop" role="listbox">
          {results.map((item) => (
            <button
              key={getKey(item)}
              type="button"
              className="cmo-search-opt"
              role="option"
              aria-selected={false}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onSelect(item); setQuery(''); setOpen(false) }}
            >
              {renderOption(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Diagnosis autocomplete: matches ICD-10 / English / 中文 / 縮寫; empty query
// shows common chronic diagnoses so zero-typing picks work.
export function DiagnosisSearch({ onSelect, placeholder = '診斷快搜：ICD-10 / 中英文 / 縮寫（如 DM、CKD）' }: {
  onSelect: (entry: DiagnosisEntry) => void
  placeholder?: string
}) {
  return (
    <SearchSelect<DiagnosisEntry>
      placeholder={placeholder}
      search={(query) => searchDiagnoses(query, 8)}
      getKey={(entry) => entry.icd10}
      renderOption={(entry) => (
        <>
          <strong>{entry.name_zh} · {entry.icd10}</strong>
          <span>{entry.name_en} · Tier {entry.tier}</span>
        </>
      )}
      onSelect={onSelect}
      ariaLabel="診斷快搜"
    />
  )
}

// Drug autocomplete: matches generic / brand / 中文品名; picking fills name and
// exposes the entry so callers can offer dose/frequency chips.
export function DrugSearch({ onSelect, placeholder = '藥物快搜：學名 / 商品名 / 中文（如 脈優、Lipitor）' }: {
  onSelect: (entry: DrugEntry) => void
  placeholder?: string
}) {
  return (
    <SearchSelect<DrugEntry>
      placeholder={placeholder}
      search={(query) => searchDrugs(query, 8)}
      getKey={(entry) => entry.generic}
      renderOption={(entry) => (
        <>
          <strong>{displayDrugName(entry)}{entry.zh ? ` · ${entry.zh}` : ''}</strong>
          <span>{entry.category}{entry.brands?.length ? ` · ${entry.brands[0]}` : ''} · {entry.doses.join(' / ')}</span>
        </>
      )}
      onSelect={onSelect}
      ariaLabel="藥物快搜"
    />
  )
}
