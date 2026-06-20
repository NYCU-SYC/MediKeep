'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import PatientContentEntryLauncher, { sendToPatientContentPanel } from '../_components/PatientContentEntryDrawer'

type SectionKey =
  | 'outpatient' | 'inpatient' | 'med' | 'surgery'
  | 'imaging' | 'lab' | 'vaccine' | 'covid'
  | 'tcm' | 'dental'
type DraftStatus = 'pending' | 'accepted' | 'rejected'

interface DraftPayload {
  extracted_fields?: Record<string, unknown>
  confidence?: number | { overall?: number }
  nhi_section?: SectionKey
  parser?: string
  model_meta?: {
    run_id?: string
    ocr_engine?: string
    llm_model?: string
    timestamp?: string
  }
  detail?: {
    medications?: Array<{ code: string; name: string; qty: string }>
    orders?: Array<{ code: string; name: string; qty: string }>
    lab_results?: Array<{ item: string; value: string; unit: string; ref: string }>
    imaging_reports?: string[]
  }
  icd10_candidates?: string[]
  [key: string]: unknown
}

interface Draft {
  id: number
  draft_type: string
  member_name?: string | null
  payload: DraftPayload | null
  status: DraftStatus
  priority_hint?: 'tier1' | 'tier2' | 'tier3' | null
  created_at?: string | null
}

const SECTIONS: Array<{ key: SectionKey; label: string; subtitle: string; icon: string }> = [
  { key: 'outpatient', label: '門診資料',     subtitle: '一般門診就醫', icon: '🩺' },
  { key: 'inpatient',  label: '住診資料',     subtitle: '住院紀錄', icon: '🏥' },
  { key: 'med',        label: '用藥資料',     subtitle: '處方與調劑', icon: '💊' },
  { key: 'surgery',    label: '手術資料',     subtitle: '手術與處置', icon: '🔪' },
  { key: 'imaging',    label: '影像/病理',    subtitle: 'CT/X-ray/EKG/報告', icon: '🩻' },
  { key: 'lab',        label: '檢驗檢查',     subtitle: '抽血/尿液檢驗', icon: '🧪' },
  { key: 'vaccine',    label: '預防接種',     subtitle: '疫苗接種紀錄', icon: '💉' },
  { key: 'covid',      label: 'COVID-19',     subtitle: '疫苗與檢測', icon: '🦠' },
  { key: 'tcm',        label: '中醫門診',     subtitle: '中醫就醫', icon: '🌿' },
  { key: 'dental',     label: '牙醫門診',     subtitle: '牙科就醫', icon: '🦷' },
]

const STATUS_META: Record<DraftStatus, { label: string; color: string; bg: string }> = {
  pending:  { label: '待審',  color: '#a16207', bg: '#fef3c7' },
  accepted: { label: '已核',  color: '#047857', bg: '#ecfdf5' },
  rejected: { label: '已退',  color: '#be123c', bg: '#fff1f2' },
}

async function fetchJson<T>(url: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, { credentials: 'include', ...init })
    if (!res.ok) return fallback
    return await res.json() as T
  } catch { return fallback }
}

function idempotencyKey(scope: string): string {
  return `${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(toText).join('、')
  return JSON.stringify(v)
}

function firstText(fields: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = toText(fields[key])
    if (text) return text
  }
  return ''
}

function formatDate(s: string | undefined): string {
  if (!s) return '—'
  return s.replace(/T.*$/, '')
}

function isNhiDraft(d: Draft): boolean {
  const payload = d.payload ?? {}
  const fields = payload.extracted_fields ?? {}
  const runId = String(payload.model_meta?.run_id ?? '')
  const knownNhiSection = typeof payload.nhi_section === 'string'
  const importedByNhiParser = payload.parser === 'nhi_html_v2' || payload.parser === 'nhi_html_v1'
  const contractDemoDraft = runId.startsWith('contract-v2-demo-')
  const hasNhiLikeFields = [
    'visit_date', 'facility', 'diagnosis', 'icd10', 'key_medications',
    'lab_total_items', 'vaccine', 'imaging_summary', 'raw_code',
    'raw_description', 'source_doc_page', 'source_doc_bbox',
  ].some((key) => fields[key] !== undefined)
  const reviewableType = [
    'condition', 'problem', 'medication', 'medication_event',
    'allergy', 'lab_report', 'imaging', 'procedure', 'vaccine',
  ].includes(d.draft_type)
  return importedByNhiParser || knownNhiSection || contractDemoDraft || (reviewableType && hasNhiLikeFields)
}

function memberLabel(d: Draft): string {
  return d.member_name || '本人'
}

function sectionOf(d: Draft): SectionKey | null {
  const explicit = d.payload?.nhi_section as SectionKey | undefined
  if (explicit && SECTIONS.some((s) => s.key === explicit)) return explicit
  if (d.draft_type === 'medication' || d.draft_type === 'medication_event') return 'med'
  if (d.draft_type === 'lab_report') return 'lab'
  if (d.draft_type === 'imaging') return 'imaging'
  if (d.draft_type === 'vaccine') return 'vaccine'
  if (d.draft_type === 'procedure') return 'surgery'
  if (d.draft_type === 'condition' || d.draft_type === 'problem' || d.draft_type === 'allergy') return 'outpatient'
  return null
}

function targetForNhiField(key: string) {
  const lower = key.toLowerCase()
  if (lower.includes('icd')) return 'problem.icd10_code' as const
  if (lower.includes('diagnosis')) return 'condition.display_name' as const
  if (lower.includes('medication') || lower.includes('drug')) return 'medication.drug_name' as const
  if (lower.includes('date')) return 'reminder.scheduled_date' as const
  if (lower.includes('facility')) return 'record.note' as const
  return 'problem.display_layman' as const
}

function recordTypeForLab(item: string) {
  const text = item.toLowerCase()
  if (text.includes('hba1c') || text.includes('糖化')) return 'hba1c'
  if (text.includes('glucose') || text.includes('glu') || text.includes('血糖')) return 'glucose'
  if (text.includes('egfr')) return 'egfr'
  if (text.includes('weight') || text.includes('體重')) return 'weight'
  return 'glucose'
}

function sendNhiFieldToPanel(key: string, value: unknown) {
  const text = toText(value)
  if (!text) return
  sendToPatientContentPanel({
    source: `NHI ${key}`,
    target: targetForNhiField(key),
    text,
    open: false,
    patch: key.toLowerCase().includes('diagnosis')
      ? { problem: { display_layman: text }, condition: { display_name: text } }
      : undefined,
  })
}

function sendNhiMedicationToPanel(medication: { code: string; name: string; qty: string }) {
  sendToPatientContentPanel({
    source: 'NHI 用藥明細',
    open: false,
    patch: {
      medication: {
        drug_name: medication.name,
        dose: medication.qty,
        note: `NHI drug code ${medication.code}`,
      },
    },
  })
}

function sendNhiLabToPanel(row: { item: string; value: string; unit: string; ref: string }) {
  sendToPatientContentPanel({
    source: 'NHI 檢驗項目',
    open: false,
    patch: {
      record: {
        record_type: recordTypeForLab(row.item),
        value1: row.value,
        unit: row.unit,
        note: `${row.item}${row.ref ? ` · ref ${row.ref}` : ''}`,
      },
    },
  })
}

function sendNhiDraftSummaryToPanel(draft: Draft) {
  const fields = draft.payload?.extracted_fields ?? {}
  const section = sectionOf(draft)
  const diagnosis = firstText(fields, ['diagnosis', 'diagnosis_text', 'vaccine', 'imaging_summary', 'impression_text', 'substance', 'analyte_name', 'raw_description', 'modality'])
  const icd10 = firstText(fields, ['icd10', 'icd10_candidates'])
  const visitDate = firstText(fields, ['visit_date', 'onset_date'])
  const facility = firstText(fields, ['facility', 'hospital', 'source_doc_page'])
  const keyMedications = firstText(fields, ['key_medications', 'raw_description', 'raw_code'])
  const labLabel = firstText(fields, ['diagnosis', 'analyte_name', 'lab_total_items'])

  if (section === 'med') {
    sendToPatientContentPanel({
      source: `NHI 用藥摘要 #${draft.id}`,
      open: false,
      patch: {
        medication: {
          drug_name: keyMedications || diagnosis,
          note: [facility, visitDate, icd10 ? `ICD ${icd10}` : ''].filter(Boolean).join(' · '),
        },
      },
    })
    return
  }

  if (section === 'lab') {
    sendToPatientContentPanel({
      source: `NHI 檢驗摘要 #${draft.id}`,
      open: false,
      patch: {
        record: {
          record_type: recordTypeForLab(labLabel),
          note: [labLabel, facility, visitDate].filter(Boolean).join(' · '),
        },
      },
    })
    return
  }

  sendToPatientContentPanel({
    source: `NHI 摘要 #${draft.id}`,
    open: false,
    patch: {
      problem: {
        display_name: diagnosis,
        display_layman: diagnosis,
        icd10_code: icd10,
        onset_date: visitDate ? visitDate.slice(0, 10) : '',
      },
      condition: {
        display_name: diagnosis,
        icd10_code: icd10,
        onset_date: visitDate ? visitDate.slice(0, 10) : '',
        note: [facility, keyMedications].filter(Boolean).join(' · '),
      },
    },
  })
}

export default function NhiSectionsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [patientName, setPatientName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionKey>('outpatient')
  const [statusFilter, setStatusFilter] = useState<DraftStatus | 'all'>('all')
  const [memberFilter, setMemberFilter] = useState('全部')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<number | null>(null)
  const [flash, setFlash] = useState('')

  const loadAll = useCallback(async () => {
    // Fetch all statuses, then keep NHI parser drafts plus contract-demo raw review drafts.
    const [pending, accepted, rejected, patient] = await Promise.all([
      fetchJson<Draft[]>(`/api/cmo/patients/${id}/drafts?status=pending`, []),
      fetchJson<Draft[]>(`/api/cmo/patients/${id}/drafts?status=accepted`, []),
      fetchJson<Draft[]>(`/api/cmo/patients/${id}/drafts?status=rejected`, []),
      fetchJson<{ user?: { display_name: string } } | null>(`/api/cmo/patients/${id}`, null),
    ])
    const all = [...pending, ...accepted, ...rejected]
      .filter(isNhiDraft)
    setDrafts(all)
    setPatientName(patient?.user?.display_name ?? '')
    setLoading(false)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  const memberOptions = useMemo(() => {
    const seen = new Set<string>()
    drafts.forEach((draft) => seen.add(memberLabel(draft)))
    return ['全部', ...Array.from(seen)]
  }, [drafts])

  const memberDrafts = useMemo(
    () => memberFilter === '全部' ? drafts : drafts.filter((draft) => memberLabel(draft) === memberFilter),
    [drafts, memberFilter]
  )

  // Per-section counts
  const sectionStats = useMemo(() => {
    const stats: Record<SectionKey, { total: number; pending: number; accepted: number; rejected: number }> = {} as Record<SectionKey, { total: number; pending: number; accepted: number; rejected: number }>
    SECTIONS.forEach((s) => { stats[s.key] = { total: 0, pending: 0, accepted: 0, rejected: 0 } })
    memberDrafts.forEach((d) => {
      const sec = sectionOf(d)
      if (sec && stats[sec]) {
        stats[sec].total += 1
        stats[sec][d.status] += 1
      }
    })
    return stats
  }, [memberDrafts])

  // Drafts in active section, filtered by status
  const visible = useMemo(() => {
    return memberDrafts
      .filter((d) => sectionOf(d) === activeSection)
      .filter((d) => statusFilter === 'all' || d.status === statusFilter)
      .sort((a, b) => {
        const da = String(a.payload?.extracted_fields?.visit_date ?? '')
        const db = String(b.payload?.extracted_fields?.visit_date ?? '')
        return db.localeCompare(da)  // newest first
      })
  }, [memberDrafts, activeSection, statusFilter])

  const pendingInSection = useMemo(
    () => visible.filter((d) => d.status === 'pending').map((d) => d.id),
    [visible]
  )

  const toggleOne = (draftId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(draftId)) next.delete(draftId); else next.add(draftId)
      return next
    })
  }

  const selectAllPending = () => setSelected(new Set(pendingInSection))
  const clearSelection = () => setSelected(new Set())

  const flashFor = (msg: string) => {
    setFlash(msg)
    window.setTimeout(() => setFlash(''), 1600)
  }

  const runBulk = async (action: 'accept' | 'reject') => {
    const ids = Array.from(selected)
    if (ids.length === 0 || busy) return
    setBusy(true)
    try {
      const url = action === 'accept' ? '/api/cmo/drafts/bulk-accept' : '/api/cmo/drafts/bulk-reject'
      const res = await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey(`nhi-bulk-${action}`) },
        body: JSON.stringify({
          draft_ids: ids,
          ...(action === 'reject' ? { blocked_reason: 'manual_review' } : {}),
        }),
      })
      const out = await res.json().catch(() => ({})) as { accepted?: number; rejected?: number; blocked_high_risk?: { id: number; target_label?: string }[]; affected_views?: string[]; detail?: string }
      if (!res.ok) {
        flashFor(out.detail || '批次處理失敗，資料沒有被更新')
        return
      }
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

  const runSingle = async (action: 'accept' | 'reject', draftId: number) => {
    if (busy) return
    setBusy(true)
    try {
      const url = `/api/cmo/drafts/${draftId}/${action}`
      const init: RequestInit = {
        method: 'POST',
        credentials: 'include',
        headers: { 'Idempotency-Key': idempotencyKey(`nhi-${action}-${draftId}`) },
      }
      if (action === 'reject') {
        init.headers = { ...init.headers, 'Content-Type': 'application/json' }
        init.body = JSON.stringify({ blocked_reason: 'manual_review' })
      }
      const res = await fetch(url, init)
      const out = await res.json().catch(() => ({})) as { detail?: string }
      if (!res.ok) {
        flashFor(out.detail || '處理失敗，資料沒有被更新')
        return
      }
      setSelected((prev) => { const n = new Set(prev); n.delete(draftId); return n })
      setExpanded(null)
      flashFor(action === 'accept' ? '已接受 1 筆' : '已退回 1 筆')
      await loadAll()
    } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="cmo-page"><div className="cmo-card cmo-section"><div className="cmo-kpi-label">NHI 健康存摺</div><div className="cmo-title" style={{ marginTop: 8 }}>正在載入 10 個資料區塊</div></div></div>
  }

  const currentMeta = SECTIONS.find((s) => s.key === activeSection)!
  const currentStats = sectionStats[activeSection]

  return (
    <div className="cmo-page">
      <header className="cmo-title-row">
        <div>
          <button className="cmo-button" type="button" onClick={() => router.push(`/cmo/patients/${id}`)}>← 返回病患資料</button>
          <h1 className="cmo-title" style={{ marginTop: 12 }}>NHI 健康存摺 · 10 個資料區塊</h1>
          <div className="cmo-subtitle">
            {patientName || id} · 共 {drafts.length} 筆紀錄 · 目前檢視：{memberFilter} · 來源：MHB_1150403_213
          </div>
          {memberOptions.length > 2 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {memberOptions.map((member) => (
                <button
                  key={member}
                  type="button"
                  className={`cmo-chip ${memberFilter === member ? 'active' : ''}`}
                  onClick={() => { setMemberFilter(member); setSelected(new Set()); setExpanded(null) }}
                >
                  {member}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {flash && <span className="cmo-badge" style={{ background: '#ecfdf5', color: '#047857', fontSize: 13 }}>{flash}</span>}
          <Link className="cmo-button" href={`/cmo/patients/${id}/intake`}>切換 Triage 模式</Link>
        </div>
      </header>

      <div className="cmo-nhi-shell split">
        {/* Left: section sidebar */}
        <aside className="cmo-card cmo-nhi-sidebar">
          <div className="cmo-kpi-label" style={{ padding: '10px 12px 4px' }}>10 個資料區塊</div>
          {SECTIONS.map((s) => {
            const stats = sectionStats[s.key]
            const isActive = activeSection === s.key
            const hasPending = stats.pending > 0
            return (
              <button
                key={s.key} type="button"
                className={`cmo-nhi-section-tab ${isActive ? 'active' : ''}`}
                onClick={() => { setActiveSection(s.key); setSelected(new Set()); setExpanded(null) }}
              >
                <div className="icon">{s.icon}</div>
                <div className="body">
                  <div className="label">{s.label}</div>
                  <div className="meta">
                    {stats.total === 0 ? <span className="cmo-muted">無資料</span> : (
                      <>
                        <span>{stats.total} 筆</span>
                        {hasPending && <span className="badge pending">{stats.pending} 待審</span>}
                        {stats.accepted > 0 && <span className="badge ok">{stats.accepted}</span>}
                      </>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </aside>

        {/* Right: section content */}
        <main className="cmo-card cmo-nhi-content">
          <div className="cmo-nhi-section-header">
            <div>
              <h2 className="cmo-section-title" style={{ margin: 0, fontSize: 18 }}>
                <span style={{ marginRight: 8 }}>{currentMeta.icon}</span>{currentMeta.label}
              </h2>
              <div className="cmo-subtitle">{currentMeta.subtitle}</div>
            </div>
            <div className="cmo-nhi-status-chips">
              {(['all', 'pending', 'accepted', 'rejected'] as const).map((k) => {
                const count = k === 'all' ? currentStats.total : currentStats[k]
                const lbl = k === 'all' ? '全部' : STATUS_META[k].label
                return (
                  <button key={k} type="button"
                    className={`cmo-chip ${statusFilter === k ? 'active' : ''}`}
                    onClick={() => setStatusFilter(k)}>
                    {lbl} <span>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {currentStats.total === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
              此區塊目前沒有可審資料。若 Workbench 顯示待審 draft，請切換其他區塊；若全部區塊皆為 0，代表尚未完成 NHI 匯入或 parser 尚未標記 section。
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>
              此狀態下沒有紀錄。
            </div>
          ) : (
            <>
              <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
                <table className="cmo-triage-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}></th>
                      <th style={{ width: 80 }}>成員</th>
                      <th>日期</th>
                      <th>機構</th>
                      <th>{activeSection === 'vaccine' ? '疫苗' : activeSection === 'lab' ? '檢查項目' : '診斷 / 內容'}</th>
                      <th>ICD</th>
                      <th>狀態</th>
                      <th style={{ width: 150, textAlign: 'right' }}>動作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((d) => {
                      const f = d.payload?.extracted_fields ?? {}
                      const isSel = selected.has(d.id)
                      const isExp = expanded === d.id
                      const sMeta = STATUS_META[d.status]
                      const rowDate = firstText(f, ['visit_date', 'onset_date']) || d.created_at || ''
                      const facility = firstText(f, ['facility', 'hospital'])
                      const sourceLabel = facility || (f.source_doc_page ? `source p.${toText(f.source_doc_page)}` : d.payload?.model_meta?.run_id || '—')
                      const contentLabel = firstText(f, ['diagnosis', 'diagnosis_text', 'vaccine', 'imaging_summary', 'impression_text', 'substance', 'analyte_name', 'raw_description', 'modality', 'raw_code']) || d.draft_type
                      const icd = firstText(f, ['icd10', 'icd10_candidates'])
                      const secondary = firstText(f, ['key_medications', 'value_numeric', 'unit', 'severity', 'reaction', 'days_supply'])
                      return [
                        <tr key={`r-${d.id}`}
                          className={`${isSel ? 'selected' : ''} ${isExp ? 'expanded' : ''}`}
                          onClick={(e) => {
                            const t = e.target as HTMLElement
                            if (t.closest('input,button')) return
                            setExpanded(isExp ? null : d.id)
                          }}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={isSel}
                              disabled={d.status !== 'pending'}
                              onChange={() => toggleOne(d.id)} />
                          </td>
                          <td><span className="cmo-badge">{memberLabel(d)}</span></td>
                          <td style={{ whiteSpace: 'nowrap', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                            {formatDate(rowDate)}
                          </td>
                          <td><strong style={{ fontWeight: 700 }}>{sourceLabel}</strong></td>
                          <td>
                            <div style={{ color: '#0f172a', fontWeight: 650 }}>
                              {contentLabel.slice(0, 80)}
                            </div>
                            {f.lab_total_items ? <div className="cmo-subtitle" style={{ marginTop: 2 }}>共 {toText(f.lab_total_items)} 項檢驗</div> : null}
                            {f.key_medications ? <div className="cmo-subtitle" style={{ marginTop: 2 }}>{toText(f.key_medications).slice(0, 60)}</div> : null}
                            {secondary && !f.key_medications && !f.lab_total_items ? <div className="cmo-subtitle" style={{ marginTop: 2 }}>{secondary.slice(0, 60)}</div> : null}
                          </td>
                          <td style={{ color: '#475569', fontFamily: 'ui-monospace,monospace', fontSize: 12 }}>{icd || '—'}</td>
                          <td>
                            <span className="cmo-badge" style={{ background: sMeta.bg, color: sMeta.color }}>{sMeta.label}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="cmo-quickact always-visible" style={{ justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="cmo-button"
                                style={{ minHeight: 28, padding: '4px 8px', fontSize: 12 }}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  sendNhiDraftSummaryToPanel(d)
                                }}
                              >
                                帶到右側
                              </button>
                              {d.status === 'pending' ? (
                                <>
                                <button type="button" className="ok" disabled={busy} title="接受" onClick={() => runSingle('accept', d.id)}>✓</button>
                                <button type="button" className="no" disabled={busy} title="退回" onClick={() => runSingle('reject', d.id)}>✕</button>
                                </>
                              ) : <span className="cmo-muted" style={{ fontSize: 11 }}>已處理</span>}
                            </div>
                          </td>
                        </tr>,
                        isExp ? <DetailRow key={`e-${d.id}`} draft={d} /> : null
                      ]
                    })}
                  </tbody>
                </table>
              </div>

              {pendingInSection.length > 0 && (
                <div className="cmo-nhi-section-footer">
                  <div className="cmo-subtitle">
                    區塊「{currentMeta.label}」共有 {pendingInSection.length} 筆待審紀錄
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button className="cmo-button" type="button" onClick={selectAllPending}>
                      全選此區塊待審
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        <PatientContentEntryLauncher patientId={id} contextLabel="NHI 健康存摺" presentation="inline" />
      </div>

      {selected.size > 0 && (
        <div className="cmo-bulk-bar">
          <span className="count">已選 {selected.size} 筆</span>
          <span className="cmo-subtitle">區塊「{currentMeta.label}」內的批次操作</span>
          <div className="actions">
            <button className="cmo-button" type="button" onClick={clearSelection}>清除</button>
            <button className="cmo-button danger" type="button" disabled={busy} onClick={() => runBulk('reject')}>全部退回</button>
            <button className="cmo-button primary" type="button" disabled={busy} onClick={() => runBulk('accept')}>全部接受 ({selected.size})</button>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ draft }: { draft: Draft }) {
  const f = draft.payload?.extracted_fields ?? {}
  const detail = draft.payload?.detail ?? {}

  return (
    <tr>
      <td colSpan={8} style={{ padding: 0, background: 'transparent', borderBottom: '1px solid #fde68a' }}>
        <div className="cmo-detail-card">
          <div className="cmo-detail-grid">
            {Object.entries(f).map(([k, v]) => (
              <div className="cmo-detail-field" key={k}>
                <span className="k">{k}</span>
                <div style={{ padding: '6px 8px', background: '#fff', border: '1px solid #d9e0ea', borderRadius: 6, fontSize: 13 }}>
                  {toText(v) || '—'}
                </div>
                {toText(v) && (
                  <button type="button" className="cmo-button" style={{ minHeight: 28, padding: '4px 8px', fontSize: 12 }} onClick={() => sendNhiFieldToPanel(k, v)}>
                    帶到右側
                  </button>
                )}
              </div>
            ))}
          </div>

          {detail.medications && detail.medications.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>用藥明細 ({detail.medications.length} 項)</div>
              <table className="cmo-table" style={{ fontSize: 12 }}>
                <thead><tr><th>代碼</th><th>藥名</th><th>數量</th><th>動作</th></tr></thead>
                <tbody>{detail.medications.map((m, i) => (
                  <tr key={i}><td>{m.code}</td><td>{m.name}</td><td>{m.qty}</td><td><button type="button" className="cmo-button" style={{ minHeight: 28, padding: '4px 8px', fontSize: 12 }} onClick={() => sendNhiMedicationToPanel(m)}>帶到右側</button></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {detail.lab_results && detail.lab_results.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>檢驗項目 ({detail.lab_results.length} 項)</div>
              <table className="cmo-table" style={{ fontSize: 12 }}>
                <thead><tr><th>項目</th><th>數值</th><th>單位</th><th>參考</th><th>動作</th></tr></thead>
                <tbody>{detail.lab_results.map((r, i) => (
                  <tr key={i}><td>{r.item}</td><td>{r.value}</td><td>{r.unit}</td><td>{r.ref}</td><td><button type="button" className="cmo-button" style={{ minHeight: 28, padding: '4px 8px', fontSize: 12 }} onClick={() => sendNhiLabToPanel(r)}>帶到右側</button></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {detail.imaging_reports && detail.imaging_reports.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>影像報告</div>
              {detail.imaging_reports.map((r, i) => (
                <pre key={i} className="cmo-source-raw" style={{ marginBottom: 6 }}>{r}</pre>
              ))}
            </div>
          )}

          {detail.orders && detail.orders.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="cmo-kpi-label" style={{ marginBottom: 6 }}>處置／醫囑 ({detail.orders.length} 項)</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {detail.orders.map((o, i) => <li key={i}>{o.code} · {o.name}</li>)}
              </ul>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}
