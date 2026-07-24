// Problem-oriented presentational components for the CMO patient workspace.
// Extracted from page.tsx (Phase 2 componentization, 重構計畫 §15 — split the
// monolith in safe, type-checked batches). Pure presentation: all data + actions
// arrive via props. Types are imported type-only from page.tsx (no runtime cycle);
// shared helpers come from _lib.
import type { Problem, HealthDocument, ConceptMetric } from '../page'
import {
  tierStyle, statusLabel, problemReadiness,
  sourceDocumentLabel, documentProcessingTone, visibilityTone,
  formatDate, readinessChecklist,
} from '../_lib'
import { normalizeMemberName } from '@/lib/members'

export function ProblemRow({ problem }: { problem: Problem }) {
  const tier = tierStyle(problem.tier)
  return (
    <div className="cmo-list-item cmo-row">
      <div>
        <strong>{problem.display_layman || problem.display_name}</strong>
        <div className="cmo-subtitle">{normalizeMemberName(problem.member_name)} · {problem.icd10_code ?? '無 ICD'} · {statusLabel(problem.status)}</div>
      </div>
      <span className="cmo-badge" style={{ background: tier.bg, color: tier.fg }}>{tier.label}</span>
    </div>
  )
}

export function TierUpgradeControl({ tier, disabled, onChange }: { tier: number; disabled: boolean; onChange: (tier: 1 | 2 | 3) => void }) {
  return (
    <div className="cmo-segment" title="Tier change is a CMO decision and should be auditable in production.">
      {([1, 2, 3] as const).map((nextTier) => (
        <button
          key={nextTier}
          type="button"
          disabled={disabled || tier === nextTier}
          className={tier === nextTier ? 'active' : ''}
          onClick={() => onChange(nextTier)}
        >
          T{nextTier}
        </button>
      ))}
    </div>
  )
}

export function VerifyPublishPanel({ problem, busy, onAction }: { problem: Problem; busy: boolean; onAction: (id: number, action: 'verify' | 'publish' | 'unpublish') => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {!problem.is_verified && <button className="cmo-button" disabled={busy} onClick={() => onAction(problem.id, 'verify')}>Verify</button>}
      {problem.is_verified && !problem.is_published && <button className="cmo-button primary" disabled={busy} onClick={() => onAction(problem.id, 'publish')}>Publish</button>}
      {problem.is_published && <button className="cmo-button danger" disabled={busy} onClick={() => onAction(problem.id, 'unpublish')}>Unpublish</button>}
    </div>
  )
}

export function ProblemCard({ problem, documents, metrics, busy, onAction, onTierChange }: {
  problem: Problem
  documents: HealthDocument[]
  metrics: ConceptMetric
  busy: boolean
  onAction: (id: number, action: 'verify' | 'publish' | 'unpublish') => void
  onTierChange: (id: number, tier: 1 | 2 | 3) => void
}) {
  const tier = tierStyle(problem.tier)
  const readiness = problemReadiness(problem)
  const sourceDoc = problem.source_document_id ? documents.find((doc) => doc.id === problem.source_document_id) ?? null : null
  return (
    <article className="cmo-card cmo-section">
      <div className="cmo-title-row">
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span className="cmo-badge" style={{ background: tier.bg, color: tier.fg }}>{tier.label}</span>
            <span className="cmo-badge" style={{ background: '#f6f9fa', color: '#56687a' }}>{normalizeMemberName(problem.member_name)}</span>
            <span className="cmo-badge" style={{ background: '#eef2f5', color: '#45596a' }}>{statusLabel(problem.status)}</span>
            {problem.is_suspected && <span className="cmo-badge" style={{ background: '#fdf6e3', color: '#a97614' }}>疑似</span>}
            {problem.is_verified && <span className="cmo-badge" style={{ background: '#e7f4ec', color: '#2e8b57' }}>Verified</span>}
            {problem.is_published && <span className="cmo-badge" style={{ background: '#e7f3f5', color: '#33596a' }}>Published</span>}
            {(problem.duplicate_count ?? 1) > 1 && (
              <span className="cmo-badge" style={{ background: '#eef2ff', color: '#3730a3' }} title="此問題在來源資料中重複出現，已自動合併顯示；原始紀錄仍保留可追溯。">
                合併 ×{problem.duplicate_count}
              </span>
            )}
          </div>
          <h3 className="cmo-title" style={{ fontSize: 18 }}>{problem.display_layman || problem.display_name}</h3>
          <div className="cmo-subtitle">{problem.display_name} · {problem.icd10_code ?? '無 ICD-10'} · {normalizeMemberName(problem.member_name)} · 起始 {formatDate(problem.onset_date)}</div>
          <div className="cmo-subtitle" style={{ marginTop: 6 }}>
            {sourceDoc ? (
              <>
                Evidence: {sourceDocumentLabel(sourceDoc)} · {sourceDoc.processing_status_label ?? documentProcessingTone(sourceDoc.processing_status).label} · {visibilityTone(sourceDoc).label}
              </>
            ) : problem.source_document_id ? (
              <>Evidence id {problem.source_document_id} is recorded but not visible in this patient document list.</>
            ) : (
              <>Evidence missing: assign a same-patient source before publishing high-risk or evidence-backed content.</>
            )}
          </div>
          <div className="cmo-chipbar" style={{ marginTop: 10 }}>
            <span className="cmo-chip">{metrics.diagnoses} Dx</span>
            <span className="cmo-chip">{metrics.medications} Med</span>
            <span className="cmo-chip">{metrics.labs} Lab</span>
            <span className="cmo-chip">{metrics.measurements} Vitals</span>
            <span className="cmo-chip">{metrics.documents} Docs</span>
            <span className="cmo-chip">{readiness.done}/{readiness.total} ready</span>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <TierUpgradeControl tier={problem.tier} disabled={busy} onChange={(nextTier) => onTierChange(problem.id, nextTier)} />
          <VerifyPublishPanel problem={problem} busy={busy} onAction={onAction} />
        </div>
      </div>
      {problem.cmo_note && <div className="cmo-card cmo-section" style={{ marginTop: 12, background: '#f6f9fa' }}>{problem.cmo_note}</div>}
    </article>
  )
}

export function PublishReadinessPanel({ items }: { items: ReturnType<typeof readinessChecklist> }) {
  return (
    <div id="publish-readiness" className="cmo-card cmo-section" style={{ scrollMarginTop: 90 }}>
      <h2 className="cmo-section-title">Publish Readiness Checklist</h2>
      <div className="cmo-list">
        {items.map((item) => (
          <div key={item.label} className="cmo-list-item cmo-row">
            <div>
              <strong>{item.label}</strong>
              <div className="cmo-subtitle">{item.detail}</div>
            </div>
            <span className="cmo-badge" style={{ background: item.done ? '#e7f4ec' : '#faecea', color: item.done ? '#2e8b57' : '#a03a30' }}>
              {item.done ? 'Ready' : 'Needs review'}
            </span>
          </div>
        ))}
      </div>
      <div className="cmo-subtitle" style={{ marginTop: 12 }}>
        Publish remains a CMO action. This panel prevents hidden blockers before patient-facing release.
      </div>
    </div>
  )
}

export function PatientFacingPreview({ problems }: { problems: Problem[] }) {
  const published = problems.filter((problem) => problem.is_published)
  return (
    <div id="patient-facing-preview" className="cmo-card cmo-section" style={{ scrollMarginTop: 90 }}>
      <h2 className="cmo-section-title">Patient-facing Preview</h2>
      {published.length === 0 ? (
        <div className="cmo-muted">No published problem will be visible to the patient yet.</div>
      ) : (
        <div className="cmo-list">
          {published.map((problem) => (
            <div key={problem.id} className="cmo-list-item">
              <div className="cmo-row">
                <strong>{problem.display_layman || problem.display_name}</strong>
                <span className="cmo-badge" style={{ background: '#e7f3f5', color: '#33596a' }}>Patient visible</span>
              </div>
              <div className="cmo-subtitle">{normalizeMemberName(problem.member_name)} · {statusLabel(problem.status)} · {problem.icd10_code ?? '無 ICD'} · CMO notes hidden</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
