'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import PatientContentEntryLauncher, { sendToPatientContentPanel } from '../_components/PatientContentEntryDrawer'

type PriorityHint = 'tier1' | 'tier2' | 'tier3'
type GroupKey = 'none' | 'icd' | 'facility' | 'type'
type StatFilter = 'all' | PriorityHint | 'needs_action'
type DraftAction = 'accept' | 'reject' | 'modify' | 'defer' | 'duplicate'

interface DraftPayload {
  extracted_fields?: Record<string, unknown>
  field_confidence?: Record<string, number>
  confidence?: number | { overall?: number; per_field?: Record<string, number> }
  icd10_candidates?: string[]
  suggested_problem_id?: number
  linked_problem_id?: number | string | null
  raw_text?: string
  nhi_kinds?: string[]
  [key: string]: unknown
}

interface Draft {
  id: number
  draft_type: string
  payload: DraftPayload | null
  status: string
  created_at: string | null
  priority_hint?: PriorityHint | null
  cmo_internal_note?: string | null
}

interface PatientProblem {
  id: number
  display_name: string
  display_layman?: string | null
  icd10_code?: string | null
}

const TYPE_LABELS: Record<string, string> = {
  condition: '診斷', medication: '用藥', procedure: '手術／處置',
  imaging: '影像', lab_report: '檢驗', vaccination: '疫苗', allergy: '過敏',
}

const TIER_META: Record<PriorityHint, { label: string; color: string }> = {
  tier1: { label: 'Tier 1 · 危及生命', color: '#be123c' },
  tier2: { label: 'Tier 2 · 重要追蹤', color: '#a16207' },
  tier3: { label: 'Tier 3 · 一般紀錄', color: '#475569' },
}

async function fetchJson<T>(url: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    if (init?.method && init.method !== 'GET') {
      return await api.post(url, init.body ? JSON.parse(String(init.body)) : undefined) as T
    }
    return await api.get(url) as T
  } catch { return fallback }
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(toText).join('、')
  return JSON.stringify(v)
}

function overallConfidence(p: DraftPayload | null | undefined): number {
  const c = p?.confidence
  const raw = typeof c === 'number' ? c : c?.overall
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 0
  return raw <= 1 ? raw : raw / 100
}

function confidenceLabel(pct: number): { text: string; color: string } {
  if (pct === 0) return { text: '—', color: '#94a3b8' }
  const p = Math.round(pct * 100)
  if (p >= 85) return { text: `${p}%`, color: '#047857' }
  if (p >= 65) return { text: `${p}%`, color: '#a16207' }
  return { text: `${p}%`, color: '#be123c' }
}

function fieldsToObj(p: DraftPayload | null | undefined): Record<string, string> {
  const obj: Record<string, string> = {}
  Object.entries(p?.extracted_fields ?? {}).forEach(([k, v]) => { obj[k] = toText(v) })
  return obj
}

function tierOf(d: Draft): PriorityHint { return d.priority_hint || 'tier3' }

function needsAction(d: Draft, problems: PatientProblem[]): boolean {
  // Needs action if: low confidence OR severe tier1 without matched problem
  const conf = overallConfidence(d.payload)
  if (conf > 0 && conf < 0.7) return true
  if (tierOf(d) === 'tier1') {
    const codes = d.payload?.icd10_candidates ?? []
    const matched = codes.some((c) => problems.some((p) => p.icd10_code === c))
    if (!matched) return true
  }
  return false
}

function formatDate(s: string | undefined): string {
  if (!s) return '—'
  return s.replace(/T.*$/, '')
}

function targetForDraftField(key: string) {
  const lower = key.toLowerCase()
  if (lower.includes('icd')) return 'problem.icd10_code' as const
  if (lower.includes('diagnosis') || lower.includes('condition')) return 'condition.display_name' as const
  if (lower.includes('drug') || lower.includes('medication')) return 'medication.drug_name' as const
  if (lower.includes('dose')) return 'medication.dose' as const
  if (lower.includes('frequency')) return 'medication.frequency' as const
  if (lower.includes('date')) return 'reminder.scheduled_date' as const
  if (lower.includes('value')) return 'record.value1' as const
  return 'problem.display_layman' as const
}

function patchForDraft(draft: Draft, fields: Record<string, string>) {
  const diagnosis = fields.diagnosis || fields.diagnosis_text || fields.condition || fields.display_name || ''
  const icd10 = fields.icd10 || fields.icd10_code || draft.payload?.icd10_candidates?.[0] || ''
  const drugName = fields.drug_name || fields.medication || fields.medication_name || fields.name || ''
  const dose = fields.dose || fields.qty || fields.quantity || ''
  const frequency = fields.frequency || fields.freq || ''
  const labItem = fields.item || fields.lab_item || fields.test_name || ''
  const labValue = fields.value || fields.result || fields.lab_value || ''
  const unit = fields.unit || ''
  const date = fields.visit_date || fields.date || fields.recorded_at || ''
  if (draft.draft_type === 'medication' || drugName) {
    return {
      medication: {
        drug_name: drugName,
        dose,
        frequency,
        note: date ? `Draft ${draft.id} · ${date}` : `Draft ${draft.id}`,
      },
    }
  }
  if (draft.draft_type === 'lab_report' || labItem || labValue) {
    return {
      record: {
        record_type: labItem.toLowerCase().includes('egfr') ? 'egfr' : labItem.toLowerCase().includes('hba1c') ? 'hba1c' : 'glucose',
        value1: labValue,
        unit,
        note: `${labItem || draft.draft_type} · Draft ${draft.id}`,
      },
    }
  }
  return {
    problem: {
      display_name: diagnosis,
      display_layman: diagnosis,
      icd10_code: icd10,
      onset_date: date ? date.slice(0, 10) : '',
    },
    condition: {
      display_name: diagnosis,
      icd10_code: icd10,
      onset_date: date ? date.slice(0, 10) : '',
    },
  }
}

function sendDraftToPanel(draft: Draft, fields: Record<string, string>) {
  sendToPatientContentPanel({
    source: `Draft #${draft.id}`,
    open: false,
    queueOnly: true,
    patch: patchForDraft(draft, fields),
  })
}

function sendDraftFieldToPanel(key: string, value: string, draftId: number) {
  if (!value) return
  sendToPatientContentPanel({
    source: `Draft #${draftId} · ${key}`,
    target: targetForDraftField(key),
    text: value,
    open: false,
    queueOnly: true,
  })
}

export default function IntakePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [problems, setProblems] = useState<PatientProblem[]>([])
  const [patientName, setPatientName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [statFilter, setStatFilter] = useState<StatFilter>('all')
  const [groupBy, setGroupBy] = useState<GroupKey>('none')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const [edited, setEdited] = useState<Record<number, Record<string, string>>>({})
  const [linked, setLinked] = useState<Record<number, string>>({})
  const [note, setNote] = useState<Record<number, string>>({})
  const [flash, setFlash] = useState('')
  const tableRef = useRef<HTMLTableSectionElement>(null)

  const loadAll = useCallback(async () => {
    const [d, p] = await Promise.all([
      fetchJson<Draft[]>(`/api/cmo/patients/${id}/drafts?status=pending`, []),
      fetchJson<{ problems?: PatientProblem[]; user?: { display_name: string } } | null>(`/api/cmo/patients/${id}`, null),
    ])
    setDrafts(Array.isArray(d) ? d : [])
    setProblems(p?.problems ?? [])
    setPatientName(p?.user?.display_name ?? '')
    setLoading(false)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  // Counts for stat tiles
  const counts = useMemo(() => {
    const c = { all: drafts.length, tier1: 0, tier2: 0, tier3: 0, needs_action: 0 }
    drafts.forEach((d) => {
      c[tierOf(d)] += 1
      if (needsAction(d, problems)) c.needs_action += 1
    })
    return c
  }, [drafts, problems])

  // Filter pipeline
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return drafts.filter((d) => {
      if (statFilter === 'all') { /* pass */ }
      else if (statFilter === 'needs_action') { if (!needsAction(d, problems)) return false }
      else if (tierOf(d) !== statFilter) return false
      if (!term) return true
      const f = d.payload?.extracted_fields ?? {}
      const hay = [
        f.facility, f.diagnosis, f.icd10, f.visit_date, d.draft_type,
        ...(d.payload?.icd10_candidates ?? []),
      ].map(toText).join(' ').toLowerCase()
      return hay.includes(term)
    })
  }, [drafts, problems, statFilter, search])

  // Grouping
  const grouped = useMemo(() => {
    const groups = new Map<string, Draft[]>()
    const keyOf = (d: Draft): string => {
      if (groupBy === 'none') {
        const t = tierOf(d)
        return `${t === 'tier1' ? '0' : t === 'tier2' ? '1' : '2'}_${TIER_META[t].label}`
      }
      if (groupBy === 'facility') return String(d.payload?.extracted_fields?.facility ?? '— 未知機構 —')
      if (groupBy === 'icd') {
        const codes = d.payload?.icd10_candidates ?? []
        return codes[0] || '— 無 ICD —'
      }
      if (groupBy === 'type') return TYPE_LABELS[d.draft_type] || d.draft_type
      return 'all'
    }
    visible.forEach((d) => {
      const k = keyOf(d)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(d)
    })
    // Sort group keys
    const sortedKeys = Array.from(groups.keys()).sort()
    return sortedKeys.map((k) => ({ key: k, label: k.replace(/^\d+_/, ''), items: groups.get(k)! }))
  }, [visible, groupBy])

  const visibleIds = useMemo(() => visible.map((d) => d.id), [visible])

  // Selection helpers
  const toggleOne = (draftId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(draftId)) next.delete(draftId); else next.add(draftId)
      return next
    })
  }
  const selectAllVisible = () => setSelected(new Set(visibleIds))
  const clearSelection = () => setSelected(new Set())

  // Initialize edit state when expanding a draft
  useEffect(() => {
    if (expanded === null) return
    if (edited[expanded]) return
    const d = drafts.find((x) => x.id === expanded)
    if (!d) return
    setEdited((prev) => ({ ...prev, [expanded]: fieldsToObj(d.payload) }))
    setLinked((prev) => ({ ...prev, [expanded]: d.payload?.suggested_problem_id ? String(d.payload.suggested_problem_id) : '' }))
    setNote((prev) => ({ ...prev, [expanded]: d.cmo_internal_note ?? '' }))
  }, [expanded, drafts, edited])

  // Single-draft actions
  const accept = async (draftId: number) => {
    await api.post(`/api/cmo/drafts/${draftId}/accept`)
  }
  const reject = async (draftId: number) => {
    await api.post(`/api/cmo/drafts/${draftId}/reject`, { cmo_internal_note: note[draftId] || undefined, blocked_reason: 'manual_review' })
  }
  const modify = async (draftId: number) => {
    await api.post(`/api/cmo/drafts/${draftId}/modify`, {
      modified_payload: { extracted_fields: edited[draftId] ?? {}, linked_problem_id: linked[draftId] || null },
      note: note[draftId] || undefined,
    })
  }
  const defer = async (draftId: number) => {
    await api.patch(`/api/cmo/drafts/${draftId}/triage`, {
      cmo_internal_note: note[draftId] || 'Deferred: needs more source review or external information.',
    })
  }
  const markDuplicate = async (draftId: number) => {
    await api.post(`/api/cmo/drafts/${draftId}/reject`, {
      blocked_reason: 'duplicate',
      cmo_internal_note: note[draftId] || 'Marked duplicate during CMO review.',
    })
  }

  const flashFor = (msg: string) => {
    setFlash(msg)
    window.setTimeout(() => setFlash(''), 1600)
  }

  const runSingle = async (action: DraftAction, draftId: number) => {
    if (busy) return
    setBusy(true)
    try {
      if (action === 'accept') await accept(draftId)
      else if (action === 'reject') await reject(draftId)
      else if (action === 'modify') await modify(draftId)
      else if (action === 'defer') await defer(draftId)
      else await markDuplicate(draftId)
      if (action !== 'defer') {
        setSelected((prev) => { const n = new Set(prev); n.delete(draftId); return n })
        setExpanded(null)
      }
      flashFor(action === 'reject' ? '已退回 1 筆' : action === 'defer' ? '已標記稍後處理' : action === 'duplicate' ? '已標記重複' : '已接受 1 筆')
      await loadAll()
    } finally { setBusy(false) }
  }

  const runBulk = async (action: 'accept' | 'reject') => {
    const ids = Array.from(selected)
    if (ids.length === 0 || busy) return
    setBusy(true)
    try {
      const url = action === 'accept' ? '/api/cmo/drafts/bulk-accept' : '/api/cmo/drafts/bulk-reject'
      const out = await api.post(url, {
        draft_ids: ids,
        ...(action === 'reject' ? { blocked_reason: 'manual_review' } : {}),
      })
        .catch(() => ({})) as { accepted?: number; rejected?: number; blocked_high_risk?: { id: number; target_label?: string }[] }
      const blocked = out.blocked_high_risk ?? []
      if (action === 'accept' && blocked.length > 0) {
        // High-risk (Tier 1) drafts can't be bulk-accepted — keep them selected
        // so the CMO confirms each one individually.
        flashFor(`已接受 ${out.accepted ?? 0} 筆；${blocked.length} 筆高風險（Tier 1）需逐筆確認`)
        setSelected(new Set(blocked.map(b => b.id)))
      } else {
        flashFor(action === 'accept' ? `已接受 ${out.accepted ?? ids.length} 筆` : `已退回 ${out.rejected ?? ids.length} 筆`)
        clearSelection()
      }
      await loadAll()
    } finally { setBusy(false) }
  }

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).matches('input, textarea, select')) return
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        const idx = focused == null ? -1 : visibleIds.indexOf(focused)
        const next = visibleIds[Math.min(visibleIds.length - 1, idx + 1)]
        if (next !== undefined) setFocused(next)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = focused == null ? visibleIds.length : visibleIds.indexOf(focused)
        const next = visibleIds[Math.max(0, idx - 1)]
        if (next !== undefined) setFocused(next)
      } else if (e.key === ' ' && focused != null) {
        e.preventDefault()
        toggleOne(focused)
      } else if (e.key === 'Enter' && focused != null) {
        e.preventDefault()
        setExpanded((cur) => cur === focused ? null : focused)
      } else if (e.key === 'a' && (selected.size > 0 || focused != null)) {
        e.preventDefault()
        if (selected.size > 0) runBulk('accept')
        else if (focused != null) runSingle('accept', focused)
      } else if (e.key === 'r' && (selected.size > 0 || focused != null)) {
        e.preventDefault()
        if (selected.size > 0) runBulk('reject')
        else if (focused != null) runSingle('reject', focused)
      } else if (e.key === 'd' && focused != null) {
        e.preventDefault()
        runSingle('defer', focused)
      } else if (e.key === 'Escape') {
        if (expanded != null) setExpanded(null)
        else if (selected.size > 0) clearSelection()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        selectAllVisible()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, selected, expanded, visibleIds]) // eslint-disable-line

  if (loading) {
    return <div className="cmo-page"><div className="cmo-card cmo-section"><div className="cmo-kpi-label">Intake Triage</div><div className="cmo-title" style={{ marginTop: 8 }}>正在載入待審 Draft</div></div></div>
  }

  if (drafts.length === 0) {
    return (
      <div className="cmo-page">
        <PatientContentEntryLauncher patientId={id} contextLabel="Intake Triage" />
        <div className="cmo-card cmo-section" style={{ textAlign: 'center', maxWidth: 680, margin: '10vh auto' }}>
          <div className="cmo-kpi-label">Intake Triage</div>
          <h1 className="cmo-title" style={{ marginTop: 8 }}>目前沒有待審 Draft</h1>
          <Link className="cmo-button primary" href={`/cmo/patients/${id}`} style={{ marginTop: 18 }}>返回病患資料</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="cmo-page">
      <PatientContentEntryLauncher patientId={id} contextLabel="Intake Triage" />
      <header className="cmo-title-row">
        <div>
          <button className="cmo-button" type="button" onClick={() => router.push(`/cmo/patients/${id}`)}>← 返回病患資料</button>
          <h1 className="cmo-title" style={{ marginTop: 12 }}>Intake Triage</h1>
          <div className="cmo-subtitle">
            {patientName || id} · 共 {drafts.length} 份待審
            　<span className="cmo-kbd">j</span>/<span className="cmo-kbd">k</span> 移動 ·{' '}
            <span className="cmo-kbd">space</span> 選 · <span className="cmo-kbd">enter</span> 展開 ·{' '}
            <span className="cmo-kbd">a</span> 接受 · <span className="cmo-kbd">r</span> 退回 · <span className="cmo-kbd">d</span> 稍後
          </div>
        </div>
        {flash && <span className="cmo-badge" style={{ background: '#ecfdf5', color: '#047857', fontSize: 13 }}>{flash}</span>}
      </header>

      {/* Stats tiles — click to filter */}
      <div className="cmo-triage-stats">
        {([
          ['all', '全部', counts.all, '#0f172a'],
          ['tier1', 'T1 危急', counts.tier1, '#be123c'],
          ['tier2', 'T2 重要', counts.tier2, '#a16207'],
          ['tier3', 'T3 一般', counts.tier3, '#475569'],
          ['needs_action', '需要動作', counts.needs_action, '#7c3aed'],
        ] as Array<[StatFilter, string, number, string]>).map(([key, label, n, color]) => (
          <button key={key} type="button"
            className={`cmo-triage-stat ${statFilter === key ? 'active' : ''}`}
            onClick={() => setStatFilter(key)}>
            <div className="lbl">{label}</div>
            <div className="num" style={{ color }}>{n}</div>
          </button>
        ))}
      </div>

      <div className="cmo-card cmo-triage-toolbar">
        <input className="cmo-input grow" placeholder="搜尋機構、診斷、ICD…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="cmo-select" style={{ width: 160 }} value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupKey)}>
          <option value="none">按 Tier 分組</option>
          <option value="icd">按 ICD 分組</option>
          <option value="facility">按機構分組</option>
          <option value="type">按類型分組</option>
        </select>
        <button className="cmo-button" type="button" onClick={selectAllVisible}>全選 ({visible.length})</button>
        {selected.size > 0 && <button className="cmo-button" type="button" onClick={clearSelection}>清除選擇</button>}
        <span className="cmo-subtitle" style={{ marginLeft: 'auto' }}>顯示 {visible.length} / {drafts.length}</span>
      </div>

      <div className="cmo-card" style={{ overflow: 'auto' }}>
        <table className="cmo-triage-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th>日期</th>
              <th>機構</th>
              <th>診斷 / 內容</th>
              <th>ICD</th>
              <th>類型</th>
              <th>信心</th>
              <th style={{ width: 92, textAlign: 'right' }}>快速</th>
            </tr>
          </thead>
          <tbody ref={tableRef}>
            {grouped.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: '#64748b', padding: 30 }}>沒有符合條件的 Draft。</td></tr>
            )}
            {grouped.flatMap((g) => [
              <tr key={`grp-${g.key}`} className="cmo-tier-row">
                <td colSpan={8}>{g.label} · {g.items.length} 筆
                  <button type="button" style={{ marginLeft: 12, fontSize: 11, color: '#2563eb', background: 'none', border: 0, cursor: 'pointer', fontWeight: 700 }}
                    onClick={() => setSelected((prev) => { const n = new Set(prev); g.items.forEach((d) => n.add(d.id)); return n })}>
                    全選此組
                  </button>
                </td>
              </tr>,
              ...g.items.flatMap((d) => {
                const f = d.payload?.extracted_fields ?? {}
                const conf = confidenceLabel(overallConfidence(d.payload))
                const tier = tierOf(d)
                const isSel = selected.has(d.id)
                const isExp = expanded === d.id
                const isFoc = focused === d.id
                return [
                  <tr key={`row-${d.id}`}
                    className={`${isSel ? 'selected' : ''} ${isExp ? 'expanded' : ''}`}
                    style={isFoc ? { boxShadow: 'inset 3px 0 0 #2563eb' } : undefined}
                    onClick={(e) => {
                      // Don't toggle expand if clicking checkbox or buttons
                      const t = e.target as HTMLElement
                      if (t.closest('input,button')) return
                      setFocused(d.id)
                      setExpanded(isExp ? null : d.id)
                    }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(d.id)} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                      {formatDate(toText(f.visit_date))}
                    </td>
                    <td><strong style={{ fontWeight: 700 }}>{toText(f.facility) || '—'}</strong></td>
                    <td>
                      <div style={{ color: '#0f172a', fontWeight: 650 }}>{toText(f.diagnosis) || (toText(f.vaccine) ? `💉 ${toText(f.vaccine)}` : '—')}</div>
                      {f.imaging_summary ? <div className="cmo-subtitle" style={{ marginTop: 2 }}>{toText(f.imaging_summary).slice(0, 80)}…</div> : null}
                    </td>
                    <td style={{ color: '#475569', fontFamily: 'ui-monospace,monospace', fontSize: 12 }}>{toText(f.icd10) || '—'}</td>
                    <td>
                      <span className={`cmo-tier-pill t${tier === 'tier1' ? '1' : tier === 'tier2' ? '2' : '3'}`}>{tier === 'tier1' ? 'T1' : tier === 'tier2' ? 'T2' : 'T3'}</span>{' '}
                      <span style={{ color: '#64748b', fontSize: 11 }}>{TYPE_LABELS[d.draft_type] || d.draft_type}</span>
                    </td>
                    <td style={{ color: conf.color, fontWeight: 800, fontSize: 12 }}>{conf.text}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="cmo-quickact">
                        <button type="button" className="ok" disabled={busy} title="接受 (a)" onClick={() => runSingle('accept', d.id)}>✓</button>
                        <button type="button" className="no" disabled={busy} title="退回 (r)" onClick={() => runSingle('reject', d.id)}>✕</button>
                      </div>
                    </td>
                  </tr>,
                  isExp ? <DetailRow key={`exp-${d.id}`} draft={d} problems={problems}
                    fields={edited[d.id] ?? fieldsToObj(d.payload)}
                    onFieldChange={(k, v) => setEdited((prev) => ({ ...prev, [d.id]: { ...(prev[d.id] ?? {}), [k]: v } }))}
                    linkedId={linked[d.id] ?? ''}
                    onLinkedChange={(v) => setLinked((prev) => ({ ...prev, [d.id]: v }))}
                    note={note[d.id] ?? ''}
                    onNoteChange={(v) => setNote((prev) => ({ ...prev, [d.id]: v }))}
                    onAction={(action) => runSingle(action, d.id)}
                    busy={busy} /> : null
                ]
              })
            ])}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="cmo-bulk-bar">
          <span className="count">已選 {selected.size} 筆</span>
          <span className="cmo-subtitle">批次操作會略過已展開編輯的內容</span>
          <div className="actions">
            <button className="cmo-button danger" type="button" disabled={busy} onClick={() => runBulk('reject')}>全部退回</button>
            <button className="cmo-button primary" type="button" disabled={busy} onClick={() => runBulk('accept')}>全部接受 ({selected.size})</button>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ draft, problems, fields, onFieldChange, linkedId, onLinkedChange, note, onNoteChange, onAction, busy }: {
  draft: Draft
  problems: PatientProblem[]
  fields: Record<string, string>
  onFieldChange: (k: string, v: string) => void
  linkedId: string
  onLinkedChange: (v: string) => void
  note: string
  onNoteChange: (v: string) => void
  onAction: (action: DraftAction) => void
  busy: boolean
}) {
  const codes = draft.payload?.icd10_candidates ?? []
  const matched = problems.filter((p) => p.icd10_code && codes.includes(p.icd10_code))
  const rawText = toText(draft.payload?.raw_text) || '尚未提供原始文字。若來源是 PDF/掃描，後續應在此顯示原圖或 OCR 區塊。'
  const conf = confidenceLabel(overallConfidence(draft.payload))
  return (
    <tr>
      <td colSpan={8} style={{ padding: 0, background: 'transparent', borderBottom: '1px solid #fde68a' }}>
        <div className="cmo-detail-card">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.9fr) minmax(320px, 1.35fr)', gap: 14, alignItems: 'start' }}>
            <aside className="cmo-card cmo-section" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
              <div className="cmo-kpi-label">Raw source / OCR preview</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="cmo-badge" style={{ background: '#fef3c7', color: '#92400e' }}>{TYPE_LABELS[draft.draft_type] || draft.draft_type}</span>
                <span className="cmo-badge" style={{ background: '#fff7ed', color: conf.color }}>Confidence {conf.text}</span>
                {matched.length === 0 && <span className="cmo-badge" style={{ background: '#fee2e2', color: '#991b1b' }}>NEW</span>}
              </div>
              <button type="button" className="cmo-button primary" style={{ width: '100%', marginTop: 10 }} onClick={() => sendDraftToPanel(draft, fields)}>
                加入整理籃
              </button>
              <pre style={{ margin: '12px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.55, color: '#334155', maxHeight: 220, overflow: 'auto' }}>{rawText}</pre>
              <div className="cmo-subtitle" style={{ marginTop: 10 }}>
                MVP placeholder: click-to-assign highlights and full source viewer require source-document mapping.
              </div>
            </aside>

            <div>
              <div className="cmo-detail-grid">
                {Object.entries(fields).map(([k, v]) => (
                  <label className="cmo-detail-field" key={k}>
                    <span className="k">{k}</span>
                    <input value={v} onChange={(e) => onFieldChange(k, e.target.value)} />
                    <button type="button" className="cmo-button" style={{ minHeight: 28, padding: '4px 8px', fontSize: 12 }} onClick={() => sendDraftFieldToPanel(k, v, draft.id)}>
                      加入整理籃
                    </button>
                  </label>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <div>
                  <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>連結 Problem</div>
                  {matched.length > 0 && (
                    <div className="cmo-subtitle" style={{ marginBottom: 6 }}>
                      自動配對到 {matched.length} 個 Problem
                    </div>
                  )}
                  <select className="cmo-select" value={linkedId} onChange={(e) => onLinkedChange(e.target.value)}>
                    <option value="">暫不連結 / NEW Problem</option>
                    {problems.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.display_layman || p.display_name}{p.icd10_code ? ` · ${p.icd10_code}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>CMO 備註</div>
                  <textarea className="cmo-textarea" rows={3} value={note} onChange={(e) => onNoteChange(e.target.value)}
                    placeholder="退回或標註原因，下一班 CMO 會看到" />
                </div>
              </div>
            </div>
          </div>

          <div className="cmo-detail-actions">
            <button className="cmo-button danger" type="button" disabled={busy} onClick={() => onAction('reject')}>退回</button>
            <button className="cmo-button danger" type="button" disabled={busy} onClick={() => onAction('duplicate')}>標重複</button>
            <button className="cmo-button" type="button" disabled={busy} onClick={() => onAction('defer')}>稍後處理</button>
            <button className="cmo-button" type="button" disabled={busy} onClick={() => onAction('modify')}>修正並接受</button>
            <button className="cmo-button primary" type="button" disabled={busy} onClick={() => onAction('accept')}>直接接受</button>
          </div>
        </div>
      </td>
    </tr>
  )
}
