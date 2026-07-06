// CMO recommendation editor cluster — extracted from page.tsx (Phase 2 componentization).
// Hook-free presentational components; shared types are type-only imports (no runtime cycle).
import type { CmoRecommendation, InternalNoteEntry, RecommendationForm, RecommendationWorkspace } from '../page'
import { recommendationChecks, allRecommendationChecksPass, DEFAULT_RECOMMENDATION_TITLE, formatDate } from '../_lib'
import { ReviewStatusBadge } from './badges'

export function RecommendationEditor({
  form,
  data,
  busy,
  publishConfirmOpen,
  internalNoteText,
  onChange,
  onPlainLanguage,
  onSaveDraft,
  onMarkReady,
  onOpenPublishConfirm,
  onCancelPublish,
  onConfirmPublish,
  onWithdraw,
  onInternalNoteChange,
  onSaveInternalNote,
}: {
  form: RecommendationForm
  data: RecommendationWorkspace
  busy: string
  publishConfirmOpen: boolean
  internalNoteText: string
  onChange: (patch: Partial<RecommendationForm>) => void
  onPlainLanguage: () => void
  onSaveDraft: () => void
  onMarkReady: () => void
  onOpenPublishConfirm: () => void
  onCancelPublish: () => void
  onConfirmPublish: () => void
  onWithdraw: () => void
  onInternalNoteChange: (value: string) => void
  onSaveInternalNote: () => void
}) {
  const checks = recommendationChecks(form)
  const canPublish = allRecommendationChecksPass(checks)
  const checkItems: Array<[keyof typeof checks, string]> = [
    ['plain_language', 'Plain language'],
    ['has_next_step', 'Clear next step'],
    ['has_follow_up_or_missing_data', 'Follow-up or data state'],
    ['no_internal_note', 'No internal note'],
    ['no_unconfirmed_sources', 'No unconfirmed extraction'],
    ['medical_safety_copy', 'Safe medical wording'],
  ]
  const latest = data.current
  const published = data.published
  const status = latest?.status ?? 'new draft'
  const publishTitle = canPublish ? 'Preview before publishing to user.' : 'Publish checklist is incomplete.'
  return (
    <div id="recommendation-editor" style={{ marginTop: 12 }}>
      <div className="cmo-title-row" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <h3 className="cmo-section-title" style={{ margin: 0 }}>Recommendation Editor</h3>
          <div className="cmo-subtitle">CMO edit mode + user preview. Internal notes are stored separately and never enter this payload.</div>
        </div>
        <ReviewStatusBadge status={status} />
      </div>

      <div className="cmo-grid-2" style={{ alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' }}>
        <div className="cmo-card cmo-section" style={{ background: '#f8fafc' }}>
          <div className="cmo-kpi-label">CMO edit</div>
          <label className="cmo-field" style={{ display: 'block', marginTop: 8 }}>
            <span className="cmo-kpi-label">Title</span>
            <input className="cmo-input" value={form.title} onChange={(event) => onChange({ title: event.target.value })} />
          </label>
          <label className="cmo-field" style={{ display: 'block', marginTop: 8 }}>
            <span className="cmo-kpi-label">User-facing health summary</span>
            <textarea className="cmo-textarea" rows={4} value={form.health_summary} onChange={(event) => onChange({ health_summary: event.target.value })} placeholder="白話說明目前最重要的健康狀態，不放 CMO internal note。" />
          </label>
          <label className="cmo-field" style={{ display: 'block', marginTop: 8 }}>
            <span className="cmo-kpi-label">User-facing recommendation *</span>
            <textarea className="cmo-textarea" rows={4} value={form.recommendation} onChange={(event) => onChange({ recommendation: event.target.value })} placeholder="給使用者看的建議：簡短、白話、避免診斷承諾。" />
          </label>
          <label className="cmo-field" style={{ display: 'block', marginTop: 8 }}>
            <span className="cmo-kpi-label">Next step *</span>
            <textarea className="cmo-textarea" rows={2} value={form.next_step} onChange={(event) => onChange({ next_step: event.target.value })} placeholder="例：請上傳最近 3 個月抽血報告，或下次回診時與醫師確認。" />
          </label>
          <label className="cmo-field" style={{ display: 'block', marginTop: 8 }}>
            <span className="cmo-kpi-label">Follow-up date / state</span>
            <input className="cmo-input" value={form.follow_up_date} onChange={(event) => onChange({ follow_up_date: event.target.value })} placeholder="例：2026-09-01 / 補資料後 CMO 再審閱" />
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" className="cmo-button" onClick={onPlainLanguage}>Plain-language conversion</button>
            <button type="button" className="cmo-button" disabled={busy === 'draft'} onClick={onSaveDraft}>{busy === 'draft' ? 'Saving…' : 'Save Draft'}</button>
            <button type="button" className="cmo-button" disabled={busy === 'ready'} onClick={onMarkReady}>{busy === 'ready' ? 'Saving…' : 'Mark Ready'}</button>
            <button type="button" className="cmo-button primary" disabled={!canPublish || busy === 'publish'} title={publishTitle} onClick={onOpenPublishConfirm}>
              Preview / Publish
            </button>
            <button type="button" className="cmo-button" disabled={!published || busy === 'withdraw'} title={!published ? 'No published recommendation to withdraw.' : 'Withdraw from user view with audit trail.'} onClick={onWithdraw}>
              Withdraw
            </button>
          </div>
        </div>

        <UserPreviewPanel form={form} published={published} />
      </div>

      <div className="cmo-card cmo-section" style={{ marginTop: 10, background: '#fff' }}>
        <div className="cmo-title-row" style={{ marginBottom: 8 }}>
          <div>
            <div className="cmo-kpi-label">Publish checklist</div>
            <div className="cmo-subtitle">All checks must pass before user-facing publish.</div>
          </div>
          <span className="cmo-badge" style={{ background: canPublish ? '#ecfdf5' : '#fff7ed', color: canPublish ? '#047857' : '#c2410c' }}>
            {Object.values(checks).filter(Boolean).length}/{Object.values(checks).length}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
          {checkItems.map(([key, label]) => (
            <span key={key} className="cmo-badge" style={{ justifyContent: 'center', background: checks[key] ? '#ecfdf5' : '#fff7ed', color: checks[key] ? '#047857' : '#c2410c' }}>
              {checks[key] ? '✓' : 'Needs'} {label}
            </span>
          ))}
        </div>
      </div>

      <div className="cmo-card cmo-section" style={{ marginTop: 10, background: '#f8fafc' }}>
        <div className="cmo-kpi-label">Source refs</div>
        {form.source_refs.length === 0 ? (
          <div className="cmo-subtitle" style={{ marginTop: 6 }}>No linked review item yet. Use Add Recommendation on a review item or select timeline text.</div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {form.source_refs.map((ref) => (
              <span key={ref.id} className="cmo-badge" style={{ background: '#eef2ff', color: '#3730a3' }}>
                {ref.type} · {ref.title}
                <button
                  type="button"
                  onClick={() => onChange({ source_refs: form.source_refs.filter((item) => item.id !== ref.id) })}
                  style={{ marginLeft: 6, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontWeight: 900 }}
                  aria-label={`Remove ${ref.title}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <InternalNotePanel
        value={internalNoteText}
        notes={data.internal_notes}
        busy={busy}
        onChange={onInternalNoteChange}
        onSave={onSaveInternalNote}
      />

      <VersionHistoryPanel history={data.history} />

      {publishConfirmOpen && (
        <PublishConfirmationModal
          form={form}
          checks={checks}
          busy={busy}
          onCancel={onCancelPublish}
          onConfirm={onConfirmPublish}
        />
      )}
    </div>
  )
}

function UserPreviewPanel({ form, published }: { form: RecommendationForm; published: CmoRecommendation | null }) {
  const hasSummary = form.health_summary.trim().length > 0
  const hasRecommendation = form.recommendation.trim().length > 0
  const hasNextStep = form.next_step.trim().length > 0
  const completed = [hasSummary, hasRecommendation, hasNextStep].filter(Boolean).length
  const previewState = hasRecommendation && hasNextStep ? 'Ready to review' : 'Draft incomplete'
  const previewTone = hasRecommendation && hasNextStep
    ? { background: '#ecfdf5', color: '#047857' }
    : { background: '#fff7ed', color: '#c2410c' }

  return (
    <div className="cmo-card cmo-section" style={{ alignSelf: 'start', background: '#ffffff', borderColor: '#bae6fd' }}>
      <div className="cmo-title-row" style={{ gap: 8, marginBottom: 10 }}>
        <div>
          <div className="cmo-kpi-label">User preview</div>
          <div className="cmo-subtitle">使用者會看到的摘要與下一步</div>
        </div>
        <span className="cmo-badge" style={previewTone}>{completed}/3 · {previewState}</span>
      </div>

      <div style={{ padding: 12, borderRadius: 8, background: '#f0fdfa', border: '1px solid #ccfbf1' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0, fontWeight: 850, color: '#0f172a', fontSize: 14, lineHeight: 1.35, wordBreak: 'break-word' }}>
            {form.title || DEFAULT_RECOMMENDATION_TITLE}
          </div>
          <span className="cmo-badge" style={{ flex: '0 0 auto', background: '#fff', color: '#0f766e' }}>
            Draft
          </span>
        </div>

        <div style={{ display: 'grid', gap: 8, marginTop: 10, maxHeight: 340, overflow: 'auto', paddingRight: 2 }}>
          <PreviewBlock
            label="健康摘要"
            value={form.health_summary}
            placeholder="尚未整理健康摘要。"
            tone={hasSummary ? 'normal' : 'empty'}
          />
          <PreviewBlock
            label="CMO 建議"
            value={form.recommendation}
            placeholder="尚未填寫給使用者看的建議。"
            tone={hasRecommendation ? 'highlight' : 'empty'}
          />
          <div style={{ padding: '8px 10px', borderRadius: 8, background: '#fff', border: '1px solid #dbeafe', color: hasNextStep ? '#1e40af' : '#c2410c', fontSize: 13, lineHeight: 1.5 }}>
            <strong>下一步：</strong>{form.next_step || '尚未設定'}
          </div>
        </div>

        {form.follow_up_date && <div className="cmo-subtitle" style={{ marginTop: 8 }}>追蹤：{form.follow_up_date}</div>}
      </div>

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
        <div className="cmo-kpi-label">Currently published</div>
        <div className="cmo-subtitle" style={{ marginTop: 4, wordBreak: 'break-word' }}>
          {published ? `${published.title} · v${published.version} · ${formatDate(published.published_at)}` : 'No published recommendation'}
        </div>
      </div>
    </div>
  )
}

function PreviewBlock({
  label,
  value,
  placeholder,
  tone,
}: {
  label: string
  value: string
  placeholder: string
  tone: 'normal' | 'highlight' | 'empty'
}) {
  const colors = tone === 'empty'
    ? { background: '#fff7ed', border: '#fed7aa', text: '#9a3412' }
    : tone === 'highlight'
      ? { background: '#ffffff', border: '#99f6e4', text: '#0f766e' }
      : { background: '#ffffff', border: '#dbeafe', text: '#334155' }
  return (
    <div style={{ padding: '8px 10px', borderRadius: 8, background: colors.background, border: `1px solid ${colors.border}` }}>
      <div className="cmo-kpi-label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ color: colors.text, fontSize: 13, fontWeight: tone === 'highlight' ? 820 : 650, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {value || placeholder}
      </div>
    </div>
  )
}

function InternalNotePanel({
  value,
  notes,
  busy,
  onChange,
  onSave,
}: {
  value: string
  notes: InternalNoteEntry[]
  busy: string
  onChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <div className="cmo-card cmo-section" style={{ marginTop: 10, background: '#fff' }}>
      <div className="cmo-title-row" style={{ marginBottom: 8 }}>
        <div>
          <div className="cmo-kpi-label">Internal CMO Note</div>
          <div className="cmo-subtitle">CMO-only audit note. This is stored separately and cannot be published to user.</div>
        </div>
        <span className="cmo-badge" style={{ background: '#f8fafc', color: '#475569' }}>CMO only</span>
      </div>
      <textarea className="cmo-textarea" rows={3} value={value} onChange={(event) => onChange(event.target.value)} placeholder="交班、判斷依據、需二次審閱原因。此內容不會進入 user-facing recommendation。" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="cmo-button" disabled={busy === 'internal-note'} onClick={onSave}>
          {busy === 'internal-note' ? 'Saving…' : 'Save Internal Note'}
        </button>
      </div>
      {notes.length > 0 && (
        <div className="cmo-list" style={{ marginTop: 10 }}>
          {notes.slice(0, 4).map((note) => (
            <div key={note.id} className="cmo-list-item">
              <div className="cmo-subtitle">{formatDate(note.created_at)} · CMO {note.created_by ?? ''}</div>
              <div style={{ color: '#0f172a', fontSize: 13, lineHeight: 1.5 }}>{note.snapshot.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VersionHistoryPanel({ history }: { history: CmoRecommendation[] }) {
  return (
    <div className="cmo-card cmo-section" style={{ marginTop: 10, background: '#f8fafc' }}>
      <div className="cmo-title-row" style={{ marginBottom: 8 }}>
        <div>
          <div className="cmo-kpi-label">Version history</div>
          <div className="cmo-subtitle">Every draft, publish, update, and withdrawal creates a version.</div>
        </div>
        <span className="cmo-badge" style={{ background: '#eef2ff', color: '#3730a3' }}>{history.length}</span>
      </div>
      {history.length === 0 ? (
        <div className="cmo-subtitle">No recommendation version yet.</div>
      ) : (
        <div className="cmo-list">
          {history.slice(0, 6).map((row) => (
            <div key={row.id} className="cmo-list-item">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
                <ReviewStatusBadge status={row.status} />
                <span className="cmo-badge" style={{ background: '#f8fafc', color: '#475569' }}>v{row.version}</span>
                <span className="cmo-badge" style={{ background: '#f8fafc', color: '#475569' }}>{formatDate(row.created_at)}</span>
              </div>
              <strong style={{ fontSize: 13 }}>{row.title}</strong>
              <div className="cmo-subtitle" style={{ marginTop: 4 }}>{row.recommendation.slice(0, 130)}{row.recommendation.length > 130 ? '...' : ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PublishConfirmationModal({
  form,
  checks,
  busy,
  onCancel,
  onConfirm,
}: {
  form: RecommendationForm
  checks: Record<string, boolean>
  busy: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const canConfirm = allRecommendationChecksPass(checks)
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(15, 23, 42, 0.38)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div className="cmo-card cmo-section" style={{ width: 'min(760px, 96vw)', maxHeight: '88vh', overflow: 'auto', background: '#fff' }}>
        <div className="cmo-title-row">
          <div>
            <h2 className="cmo-section-title" style={{ margin: 0 }}>Publish Confirmation</h2>
            <div className="cmo-subtitle">Review exactly what the user will see. This action writes a version and sync event.</div>
          </div>
          <span className="cmo-badge" style={{ background: canConfirm ? '#ecfdf5' : '#fff7ed', color: canConfirm ? '#047857' : '#c2410c' }}>
            {canConfirm ? 'Ready' : 'Blocked'}
          </span>
        </div>
        <UserPreviewPanel form={form} published={null} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6, marginTop: 10 }}>
          {Object.entries(checks).map(([key, ok]) => (
            <span key={key} className="cmo-badge" style={{ background: ok ? '#ecfdf5' : '#fff7ed', color: ok ? '#047857' : '#c2410c' }}>
              {ok ? '✓' : 'Needs'} {key.replaceAll('_', ' ')}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="cmo-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="cmo-button primary" disabled={!canConfirm || busy === 'publish'} onClick={onConfirm}>
            {busy === 'publish' ? 'Publishing…' : 'Confirm Publish to User'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function reviewAnchorForTarget(targetType: string | null, targetId: string | null) {
  if (!targetType || !targetId) return null
  const normalized: Record<string, string> = {
    source_document: 'document',
    document: 'document',
    change_request: 'request',
    patient_change_request: 'request',
    reported_state: 'reported',
    patient_reported_state: 'reported',
    problem: 'problem',
    condition: 'condition',
    medication: 'medication',
    medication_regimen: 'medication',
    unlinked_condition: 'unlinked-condition',
    unlinked_medication: 'unlinked-medication',
    follow_up: 'follow-up',
    followup: 'follow-up',
  }
  const prefix = normalized[targetType] ?? targetType.replaceAll('_', '-')
  return `review-item-${prefix}-${targetId}`
}
