import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getNhiProfileCandidates,
  nhiProfileCandidateEvidenceGroups,
  saveNhiProfileCandidate,
} from './nhiImports'

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

vi.mock('@/lib/api', () => ({
  api: {
    get: apiGet,
    post: apiPost,
    patch: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, status = 500) {
      super(message)
      this.status = status
    }
  },
  getPatientSessionToken: vi.fn(() => null),
}))

describe('NHI profile candidate adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves encounter, last-seen, document, and source evidence references', async () => {
    apiGet.mockResolvedValue({
      items: [{
        fact_id: 'fact-med-1',
        kind: 'medication',
        clinical_kind: 'medication',
        eligibility: 'eligible',
        eligible: true,
        usage_context: 'dispensed',
        normalized_key: 'normalized-medication-key',
        title: '降壓藥 A',
        summary: '門診調劑紀錄',
        date: null,
        facility: null,
        facility_ref: { name: '安心診所', organization_code: 'facility-private-code' },
        member_name: '本人',
        last_seen_at: '2026-08-11T09:30:00Z',
        encounter_id: 'encounter-private-id',
        encounter_ref: {
          id: 'encounter-private-id',
          date: '2026-08-01',
          member_name: '本人',
          facility: '安心診所',
          persisted_relation: 'visit',
        },
        evidence_refs: [
          { type: 'health_document', id: 'document-private-id', title: '門診用藥清單.pdf', page: 2 },
          { type: 'nhi_source_row', id: 'source-row-private-id', row_kind: 'dispensing' },
        ],
        source_refs: [
          { type: 'health_document', id: 'document-private-id', title: '門診用藥清單.pdf', page: 2 },
          { type: 'nhi_draft', id: 42, section: 'medications' },
        ],
        source_label: '健保存摺',
        saved_to_profile: false,
        saved_state: { saved: false },
      }],
      next_cursor: null,
      previous_cursor: null,
    })

    const page = await getNhiProfileCandidates({ kind: 'medication' })
    const candidate = page.items[0]

    expect(candidate).toMatchObject({
      fact_id: 'fact-med-1',
      medication_state: 'dispensed',
      eligibility: 'eligible',
      usage_context: 'dispensed',
      normalized_key: 'normalized-medication-key',
      date: '2026-08-01',
      facility: '安心診所',
      last_seen_at: '2026-08-11T09:30:00Z',
      encounter_id: 'encounter-private-id',
      saved_state: { saved: false },
    })
    expect(candidate.encounter_ref).toMatchObject({ id: 'encounter-private-id', persisted_relation: 'visit' })
    expect(candidate.facility_ref).toMatchObject({ organization_code: 'facility-private-code' })
    expect(candidate.evidence_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'health_document', id: 'document-private-id', page: 2 }),
      expect.objectContaining({ type: 'nhi_source_row', id: 'source-row-private-id', row_kind: 'dispensing' }),
    ]))
    expect(candidate.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'nhi_draft', id: '42', section: 'medications' }),
    ]))
    expect(nhiProfileCandidateEvidenceGroups(candidate)).toEqual([
      { label: '醫療文件：門診用藥清單.pdf', count: 1 },
      { label: '健保存摺來源紀錄', count: 1 },
      { label: '健保匯入整理紀錄', count: 1 },
    ])
  })

  it('confirms a candidate through the canonical explicit-confirmation endpoint', async () => {
    apiPost.mockResolvedValue({ created: true })

    await saveNhiProfileCandidate('candidate-1', { usage_status: 'taking' })

    expect(apiPost).toHaveBeenCalledWith(
      '/api/patients/me/profile-candidates/candidate-1/confirm',
      { usage_status: 'taking' },
    )
  })
})
