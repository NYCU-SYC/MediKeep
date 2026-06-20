'use client'

// Patient snapshot drawer — designed for clinician 30-second context.
//
// This drawer is aligned with API Contract v2 §4.3 (Problem) and CMO Intake
// Console Spec §3.2 (Patient POV). It renders, in order:
//
//   1. Drawer context header (Opened from / patient basic info)
//   2. Critical Red Zone (Tier-1 problems + drug allergies)
//   3. Risk + health score
//   4. Why-this-risk reasoning
//   5. Problem-Oriented View (cards grouped by status)
//   6. Draft summary (requires clinician review)
//   7. Latest abnormal findings
//   8. Recent activity
//   9. Source documents (traceability)
//  10. Suggested next action
//  11. Physician note (localStorage placeholder)
//  12. Action bar (mark reviewed / open chart / nav)

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  cohortLabel, composeAiSummary, formatRelative,
  riskExplanation, humanizeNextAction,
  type ClinicalPatient,
} from '@/lib/clinical'
import { DRAWER_ORIGIN_LABEL, type DrawerOrigin, type Problem } from '@/lib/healthkeepTypes'
import { RiskPill, FollowUpPill, TrendIcon, ScoreBar } from './atoms'

function notesKey(userId: string): string { return `cmo:physician-note:${userId}` }
function reviewKey(userId: string): string { return `cmo:patient-reviewed:${userId}` }

function loadFromStorage(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  try { return window.localStorage.getItem(key) ?? fallback } catch { return fallback }
}

const PROBLEM_STATUS_LABEL = {
  underlying: '長期持續 (Underlying)',
  following:  '追蹤中 (Following)',
  resolved:   '已解除 (Resolved)',
} as const

const SOURCE_TYPE_LABEL = {
  nhi_html:     'NHI 健康存摺',
  paper_scan:   '紙本掃描',
  photo:        '照片 / 拍攝',
  manual_entry: 'CMO 手動輸入',
  voice:        '語音轉錄',
  dicom:        'DICOM 影像',
} as const

interface SnapshotProps {
  patient: ClinicalPatient
  origin: DrawerOrigin
  originContext?: string  // Optional sub-context (e.g. alert title or cohort id)
  onClose: () => void
}

export function PatientSnapshot({ patient, origin, originContext, onClose }: SnapshotProps) {
  const aiSummary = useMemo(() => composeAiSummary(patient), [patient])
  const reasons = useMemo(() => riskExplanation(patient), [patient])
  const suggestedAction = humanizeNextAction(patient.next_action)

  // Physician note — localStorage only (no backend yet).
  const [note, setNote] = useState<string>(() => loadFromStorage(notesKey(patient.user_id), ''))
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [reviewedAt, setReviewedAt] = useState<string>(() => loadFromStorage(reviewKey(patient.user_id), ''))

  useEffect(() => {
    if (typeof window === 'undefined' || noteState !== 'saving') return
    const t = window.setTimeout(() => {
      try { window.localStorage.setItem(notesKey(patient.user_id), note) } catch { /* quota */ }
      setNoteState('saved')
    }, 500)
    return () => window.clearTimeout(t)
  }, [note, noteState, patient.user_id])

  function handleNoteChange(value: string) { setNote(value); setNoteState('saving') }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function markReviewed() {
    const now = new Date().toISOString()
    try { window.localStorage.setItem(reviewKey(patient.user_id), now) } catch { /* ignore */ }
    setReviewedAt(now)
  }
  function clearReviewed() {
    try { window.localStorage.removeItem(reviewKey(patient.user_id)) } catch { /* ignore */ }
    setReviewedAt('')
  }

  // ── Derived POV data ────────────────────────────────────────────────────
  // Use stable references (useMemo with patient as dep) so downstream
  // memoization doesn't churn — React Compiler / lint require this.
  const problems = useMemo(() => patient.problems ?? [], [patient])
  const sourceDocs = useMemo(() => patient.sourceDocuments ?? [], [patient])
  const allergies = useMemo(() => patient.allergies ?? [], [patient])

  const tier1Problems = useMemo(() => problems.filter((p) => p.tier === 1), [problems])
  const tier1Allergies = useMemo(
    () => allergies.filter((a) => a.tier === 1 && (a.status === 'confirmed' || a.status === 'suspected')),
    [allergies],
  )
  const hasCriticalRedZone = tier1Problems.length > 0 || tier1Allergies.length > 0 || patient.riskLevel === 'critical'

  const problemsByStatus = useMemo(() => {
    const groups: Record<'underlying' | 'following' | 'resolved', Problem[]> = {
      underlying: [], following: [], resolved: [],
    }
    problems.forEach((pr) => { groups[pr.status].push(pr) })
    return groups
  }, [problems])

  // Visual emphasis for critical/high patients
  const headerTone: React.CSSProperties = patient.riskLevel === 'critical'
    ? { borderTop: '4px solid #dc2626' }
    : patient.riskLevel === 'high'
    ? { borderTop: '4px solid #ea580c' }
    : {}

  return (
    <>
      <div className="cmo-drawer-backdrop" onClick={onClose} />
      <aside className="cmo-drawer" aria-label="Patient snapshot" style={headerTone}>
        <div className="cmo-section">

          {/* ── 0. Drawer context header (Opened from / back) ────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            padding: '8px 10px', borderRadius: 6, background: '#eef2ff', fontSize: 12,
          }}>
            <button type="button" onClick={onClose}
              aria-label="Close and return"
              style={{ border: 0, background: 'transparent', color: '#1d4ed8', cursor: 'pointer', fontWeight: 700, padding: 0 }}>
              ← Back to workbench
            </button>
            <span style={{ color: '#475569' }}>·</span>
            <span style={{ color: '#3730a3', fontWeight: 700 }}>Opened from: {DRAWER_ORIGIN_LABEL[origin]}</span>
            {originContext && (
              <>
                <span style={{ color: '#475569' }}>·</span>
                <span style={{ color: '#475569' }}>{originContext}</span>
              </>
            )}
          </div>

          {/* ── 1. Patient basic info ────────────────────────────────── */}
          <div className="cmo-title-row" style={{ marginBottom: 8 }}>
            <div>
              <div className="cmo-kpi-label">Patient snapshot · For clinician review</div>
              <h2 className="cmo-title" style={{ fontSize: 20, marginTop: 4 }}>{patient.display_name}</h2>
              <div className="cmo-subtitle">{patient.ageSex} · ID {patient.user_id.slice(0, 8)}</div>
            </div>
            <button className="cmo-button" type="button" onClick={onClose} aria-label="Close snapshot">Close</button>
          </div>

          <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
            <RiskPill level={patient.riskLevel} />
            <FollowUpPill status={patient.followUpStatus} />
            <TrendIcon trend={patient.trend} />
            {patient.cohorts.slice(0, 4).map((c) => (
              <span key={c} className="cmo-badge" style={{ background: '#eef2ff', color: '#3730a3' }}>{cohortLabel(c)}</span>
            ))}
            {reviewedAt && (
              <span className="cmo-badge" style={{ background: '#dcfce7', color: '#166534' }}>
                ✓ Reviewed {formatRelative(reviewedAt)}
              </span>
            )}
          </div>

          {/* ── 2. Critical Red Zone (Tier 1 problems + tier-1 allergies) ── */}
          {hasCriticalRedZone && (
            <div className="cmo-card cmo-section" style={{ background: '#fff1f2', borderColor: '#fecaca', marginBottom: 12 }}>
              <div className="cmo-row">
                <div className="cmo-kpi-label" style={{ color: '#991b1b' }}>Critical Red Zone (Tier 1)</div>
                <span className="cmo-badge" style={{ background: '#fee2e2', color: '#991b1b' }}>Pending CMO review</span>
              </div>
              {tier1Problems.length === 0 && tier1Allergies.length === 0 && (
                <div className="cmo-subtitle" style={{ marginTop: 6, fontSize: 12 }}>
                  Patient risk level marked Critical but no tier-1 problem / allergy mapped yet. Suggested CMO action: review and assign tier-1 problem(s).
                </div>
              )}
              {tier1Problems.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#991b1b', marginBottom: 4 }}>Problems</div>
                  {tier1Problems.map((pr) => (
                    <div key={pr.id} style={{ fontSize: 13, color: '#0f172a', padding: '3px 0' }}>
                      • {pr.display_name}{pr.icd10_code ? <span style={{ color: '#64748b' }}> ({pr.icd10_code})</span> : null}
                      {pr.is_suspected && <span className="cmo-badge" style={{ marginLeft: 6, background: '#fff7ed', color: '#9a3412', fontSize: 10 }}>SUSPECTED</span>}
                    </div>
                  ))}
                </div>
              )}
              {tier1Allergies.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#991b1b', marginBottom: 4 }}>Drug / contrast allergies</div>
                  {tier1Allergies.map((a) => (
                    <div key={a.id} style={{ fontSize: 13, color: '#0f172a', padding: '3px 0' }}>
                      ⚠ {a.substance}{a.severity ? <span style={{ color: '#64748b' }}> · {a.severity}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── 3. Risk + Health score + Why-this-risk ───────────────── */}
          <div className="cmo-grid-2" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div className="cmo-card cmo-section" style={{ padding: 12 }}>
              <div className="cmo-kpi-label">Risk score (internal triage signal)</div>
              <div style={{ fontSize: 24, fontWeight: 850, color: '#0f172a' }}>
                {patient.riskScore}<span style={{ fontSize: 13, color: '#94a3b8' }}> / 100</span>
              </div>
              <ScoreBar score={patient.riskScore} level={patient.riskLevel} />
            </div>
            <div className="cmo-card cmo-section" style={{ padding: 12 }}>
              <div className="cmo-kpi-label">Health score</div>
              <div style={{ fontSize: 24, fontWeight: 850, color: '#0f172a' }}>
                {patient.healthScore}<span style={{ fontSize: 13, color: '#94a3b8' }}> / 100</span>
              </div>
              <div className="cmo-subtitle">Trend: <TrendIcon trend={patient.trend} /></div>
            </div>
          </div>

          <div className="cmo-card cmo-section" style={{ background: '#f8fafc', marginBottom: 12 }}>
            <div className="cmo-kpi-label">Why this risk level?</div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#334155', fontSize: 12, lineHeight: 1.7 }}>
              {reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>

          {/* ── 4. Problem-Oriented View (cards grouped by status) ──── */}
          <div className="cmo-card cmo-section" style={{ marginBottom: 12 }}>
            <div className="cmo-row">
              <div className="cmo-kpi-label">Problem-Oriented View</div>
              <span className="cmo-subtitle" style={{ fontSize: 11 }}>
                {problems.length === 0 ? 'No verified problems yet' : `${problems.length} problem${problems.length > 1 ? 's' : ''}`}
              </span>
            </div>
            {problems.length === 0 ? (
              <div className="cmo-subtitle" style={{ marginTop: 8, fontSize: 12 }}>
                Patient POV data not yet linked to this drawer. {patient.isDemoData ? '' : 'Real backend POV endpoint (/api/cmo/patients/{id}/pov) pending integration.'}
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {(['underlying', 'following', 'resolved'] as const).map((st) => (
                  problemsByStatus[st].length > 0 ? (
                    <div key={st} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
                        {PROBLEM_STATUS_LABEL[st]} · {problemsByStatus[st].length}
                      </div>
                      {problemsByStatus[st].map((pr) => <ProblemCard key={pr.id} pr={pr} />)}
                    </div>
                  ) : null
                ))}
              </div>
            )}
          </div>

          {/* ── 5. Draft summary ───────────────────────────────────── */}
          <div className="cmo-card cmo-section" style={{ marginBottom: 12, background: '#fffdf5', borderColor: '#fde68a' }}>
            <div className="cmo-row">
              <div className="cmo-kpi-label" style={{ color: '#854d0e' }}>Draft summary · Requires clinician review</div>
              <span className="cmo-badge" style={{ background: '#fef3c7', color: '#a16207' }}>Needs confirmation</span>
            </div>
            <pre style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: '#334155', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{aiSummary}</pre>
          </div>

          {/* ── 6. Latest abnormal findings ─────────────────────────── */}
          {patient.abnormalFindings.length > 0 && (
            <div className="cmo-card cmo-section" style={{ marginBottom: 12 }}>
              <div className="cmo-kpi-label">Latest abnormal findings · For clinician review</div>
              <div style={{ marginTop: 8 }}>
                {patient.abnormalFindings.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: i < patient.abnormalFindings.length - 1 ? '1px dashed #e2e8f0' : 'none' }}>
                    <span className={`risk-pill ${f.severity === 'critical' ? 'critical' : f.severity === 'high' ? 'high' : 'moderate'}`} style={{ fontSize: 10 }}>
                      <span className="dot" />{f.severity}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: '#0f172a', fontWeight: 600 }}>{f.item}</span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>{f.value}{f.reference ? ` (ref ${f.reference})` : ''}</span>
                  </div>
                ))}
                <div className="cmo-subtitle" style={{ marginTop: 6, fontSize: 11 }}>
                  Values derived from problem labels. Lab numeric values pending integration.
                </div>
              </div>
            </div>
          )}

          {/* ── 7. Recent activity ─────────────────────────────────── */}
          <div className="cmo-card cmo-section" style={{ marginBottom: 12 }}>
            <div className="cmo-kpi-label">Recent activity</div>
            <div style={{ marginTop: 6, fontSize: 13, color: '#334155', lineHeight: 1.8 }}>
              Last activity: <strong>{formatRelative(patient.last_activity)}</strong><br />
              Pending drafts: <strong>{patient.pending_drafts}</strong>{patient.tier1_drafts ? <> · Tier 1: <strong style={{ color: '#dc2626' }}>{patient.tier1_drafts}</strong></> : null}<br />
              Unpublished problems: <strong>{patient.unpublished_problems}</strong><br />
              Records / documents / DICOM: {patient.records_count} / {patient.documents_count} / {patient.dicom_count}
            </div>
          </div>

          {/* ── 8. Source documents (traceability) ─────────────────── */}
          <div className="cmo-card cmo-section" style={{ marginBottom: 12 }}>
            <div className="cmo-row">
              <div className="cmo-kpi-label">Source documents · Traceability</div>
              <span className="cmo-subtitle" style={{ fontSize: 11 }}>{sourceDocs.length} linked</span>
            </div>
            {sourceDocs.length === 0 ? (
              <div className="cmo-subtitle" style={{ marginTop: 6, fontSize: 12 }}>
                No source document linked. Suggested action: upload backing document via Intake before publishing.
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {sourceDocs.map((d) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12, borderBottom: '1px dashed #e2e8f0' }}>
                    <span className="cmo-badge" style={{ background: '#eef2ff', color: '#3730a3', fontSize: 10 }}>
                      {SOURCE_TYPE_LABEL[d.source_type]}
                    </span>
                    <span style={{ flex: 1, color: '#0f172a' }}>{d.original_filename}</span>
                    <span style={{ color: '#64748b' }}>{formatRelative(d.created_at)}</span>
                    <span className="cmo-badge" style={{
                      background: d.ocr_status === 'done' ? '#dcfce7' : d.ocr_status === 'pending' ? '#fef3c7' : '#f1f5f9',
                      color:      d.ocr_status === 'done' ? '#166534' : d.ocr_status === 'pending' ? '#a16207' : '#475569',
                      fontSize: 10,
                    }}>{d.ocr_status ? `OCR ${d.ocr_status}` : 'no OCR'}</span>
                  </div>
                ))}
                <div className="cmo-subtitle" style={{ marginTop: 6, fontSize: 11 }}>
                  Document viewer pending — these IDs link to /api/source-documents/{`{id}`}/download once that endpoint is integrated.
                </div>
              </div>
            )}
          </div>

          {/* ── 9. Suggested next action ───────────────────────────── */}
          <div className="cmo-card cmo-section" style={{ marginBottom: 12, background: '#eff6ff', borderColor: '#bfdbfe' }}>
            <div className="cmo-kpi-label" style={{ color: '#1e40af' }}>Suggested next action · Pending clinician decision</div>
            <div style={{ marginTop: 6, color: '#1e3a8a', fontWeight: 700, fontSize: 14 }}>{suggestedAction}</div>
          </div>

          {/* ── 10. Physician note (local only) ───────────────────── */}
          <div className="cmo-card cmo-section" style={{ marginBottom: 12 }}>
            <div className="cmo-row">
              <div className="cmo-kpi-label">Physician note</div>
              <span className="cmo-subtitle" style={{ fontSize: 11 }}>
                {noteState === 'saving' ? '正在保存到本機…' : noteState === 'saved' ? '已保存到本機草稿' : ''}
              </span>
            </div>
            <div className="cmo-subtitle" style={{ fontSize: 11, margin: '4px 0 8px', color: '#a16207' }}>
              本欄目前只存在這台瀏覽器，不會寫入後端 audit，也不會同步給其他 CMO。正式交班請到病患資料頁使用可稽核流程。
            </div>
            <textarea className="cmo-textarea" rows={3} value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
              placeholder="例如：已電話告知，下次門診追蹤血壓；或標註其他臨床觀察。" />
          </div>

          {/* ── 11. Action bar ─────────────────────────────────────── */}
          <div className="cmo-list">
            {!reviewedAt ? (
              <button className="cmo-button primary" type="button" onClick={markReviewed}>
                本機標記已看過
              </button>
            ) : (
              <button className="cmo-button" type="button" onClick={clearReviewed}>
                取消本機標記 · {formatRelative(reviewedAt)}
              </button>
            )}
            <div className="cmo-subtitle" style={{ fontSize: 11, padding: '2px 6px', color: '#a16207' }}>
              此標記僅用於目前瀏覽器，不代表正式 CMO review，也不會寫入稽核紀錄。
            </div>
            {patient.isDemoData ? (
              <>
                <button className="cmo-button" type="button" disabled
                  title="Demo patient — backend record does not exist"
                  style={{ opacity: .55, cursor: 'not-allowed' }}>
                  Open patient chart (unavailable for demo)
                </button>
                <div className="cmo-subtitle" style={{ fontSize: 11, padding: '4px 6px' }}>
                  This patient is part of the demo cohort. Chart / NHI / draft pages are linked to backend records and are disabled for demo rows.
                </div>
              </>
            ) : (
              <>
                <Link className="cmo-button" href={`/cmo/patients/${patient.user_id}`}>Open patient chart →</Link>
                <Link className="cmo-button" href={`/cmo/patients/${patient.user_id}/nhi`}>NHI 健康存摺</Link>
                <Link className="cmo-button" href={`/cmo/patients/${patient.user_id}/intake`}>Review drafts</Link>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

// ── ProblemCard — one row in the POV view ─────────────────────────────────
function ProblemCard({ pr }: { pr: Problem }) {
  const statusColor = pr.status === 'underlying' ? '#7c3aed' : pr.status === 'following' ? '#0891b2' : '#64748b'
  const tierColor = pr.tier === 1 ? '#dc2626' : pr.tier === 2 ? '#ea580c' : '#64748b'
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 6, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          padding: '1px 6px', borderRadius: 4, background: tierColor, color: '#fff',
          fontSize: 10, fontWeight: 850, letterSpacing: '.4px',
        }}>T{pr.tier}</span>
        <strong style={{ color: '#0f172a', fontSize: 13 }}>{pr.display_name}</strong>
        {pr.icd10_code && <span style={{ color: '#64748b', fontSize: 11, fontFamily: 'ui-monospace,monospace' }}>{pr.icd10_code}</span>}
        {pr.is_suspected && <span className="cmo-badge" style={{ background: '#fff7ed', color: '#9a3412', fontSize: 10 }}>SUSPECTED</span>}
        <span style={{ marginLeft: 'auto', padding: '1px 6px', borderRadius: 4, background: statusColor + '22', color: statusColor, fontSize: 10, fontWeight: 800 }}>
          {pr.status}
        </span>
      </div>
      {pr.display_layman && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#475569' }}>{pr.display_layman}</div>
      )}
      {pr.cmo_note && (
        <div style={{ marginTop: 5, padding: '4px 8px', background: '#f8fafc', borderLeft: '3px solid #94a3b8', fontSize: 11, color: '#334155', borderRadius: '0 4px 4px 0' }}>
          <strong>CMO note:</strong> {pr.cmo_note}
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', gap: 10, fontSize: 11, color: '#64748b', flexWrap: 'wrap' }}>
        <span>{pr.linked_condition_count} Dx</span>
        <span>· {pr.linked_medication_count} Med</span>
        <span>· {pr.linked_lab_count} Lab</span>
        {pr.source_document_ids.length > 0 && <span>· {pr.source_document_ids.length} source doc</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <span className="cmo-badge" style={{
            background: pr.is_verified ? '#dcfce7' : '#fef3c7',
            color:      pr.is_verified ? '#166534' : '#a16207',
            fontSize: 10,
          }}>{pr.is_verified ? '✓ Verified' : 'Pending verify'}</span>
          <span className="cmo-badge" style={{
            background: pr.is_published ? '#dbeafe' : '#f1f5f9',
            color:      pr.is_published ? '#1e40af' : '#475569',
            fontSize: 10,
          }}>{pr.is_published ? '✓ Published' : 'Unpublished'}</span>
        </span>
      </div>
    </div>
  )
}
