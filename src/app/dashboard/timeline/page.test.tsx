import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getHealthEncounter, getHealthEpisode, getHealthTimeline, saveNhiFactToProfile } from '@/lib/healthTimeline'
import HealthTimelinePage from './page'

const memberState = vi.hoisted(() => ({
  activeMember: '本人' as string,
  members: [
    { id: 'self', name: '本人' },
    { id: 'family', name: '家人' },
  ],
  canWriteMember: () => true,
  writeAccessReason: () => null,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/healthTimeline', () => ({
  getHealthEncounter: vi.fn(),
  getHealthEpisode: vi.fn(),
  getHealthTimeline: vi.fn(),
  saveNhiFactToProfile: vi.fn(),
}))

vi.mock('../member-context', () => ({
  useActiveMember: () => memberState,
}))

vi.mock('@/lib/sync', () => ({
  useSync: () => ({ viewVersions: {}, refreshNow: vi.fn() }),
}))

vi.mock('../toast-context', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

const events = [
  {
    id: 'event-newest',
    occurred_at: '2026-08-01T00:00:00Z',
    event_type: 'outpatient',
    title: '今年門診',
    summary: '今年的門診紀錄',
    source_type: 'nhi_import',
    review_status: 'ai_organized',
    organization_label: '規則整理',
    is_important: false,
    member_name: '本人',
  },
  {
    id: 'event-older',
    occurred_at: '2025-05-01T00:00:00Z',
    event_type: 'surgery',
    title: '去年手術',
    summary: '去年的手術紀錄',
    source_type: 'nhi_import',
    review_status: 'pending_review',
    organization_label: null,
    is_important: true,
    member_name: '本人',
  },
]

const encounterEvent = {
  id: 'encounter-event',
  encounter_id: 'encounter-2026-08-01',
  occurred_at: '2026-08-01T00:00:00Z',
  event_type: 'outpatient',
  included_types: ['outpatient', 'diagnosis', 'medication', 'laboratory', 'imaging'],
  title: '舊 API 主標題',
  summary: '舊 API 摘要。',
  display_title: '高血壓、糖尿病',
  display_summary: '本次就醫重點：高血壓、糖尿病。',
  facility_name: '臺大醫院',
  source_type: 'nhi_import',
  review_status: 'pending_review',
  organization_label: 'AI 整理',
  is_important: false,
  member_name: '本人',
  record_count: 4,
  source_count: 2,
  detail_counts: { diagnosis: 1, medication: 2, laboratory: 1, imaging: 1 },
  ai_organized: false,
  focus_method: 'deterministic_fallback_v1',
  ai_summary: '本次就醫包含診斷、用藥與檢驗紀錄。',
  rule_summary: '依日期與院所合併。',
  source_id: 'source-encounter-1',
  policy_version: 'timeline-group-v2',
  organization_method: 'rule_based_parser',
  focus_kind: 'encounter',
  focus_status: 'published',
  created_at: '2026-08-02T00:00:00Z',
  primary_topics: ['高血壓', '糖尿病'],
}

describe('HealthTimelinePage member and mobile year behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    memberState.activeMember = '本人'
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: events, next_cursor: null })
    vi.mocked(getHealthEncounter).mockResolvedValue({ encounter_id: encounterEvent.encounter_id, categories: [], provenance: [] })
    vi.mocked(getHealthEpisode).mockResolvedValue({
      episode_id: 'episode-default', display_title: '健康問題相關就醫', display_summary: null,
      start_date: null, end_date: null, visit_count: 0, source_count: 0,
      included_types: [], detail_counts: {}, rule_summary: null, policy_version: null,
      visits: [], provenance: [],
    })
    vi.mocked(saveNhiFactToProfile).mockResolvedValue({ created: true, target_type: 'condition', target_id: 1 })
  })

  it('clears the member filter when dashboard context switches back to all members', async () => {
    const { rerender } = render(<HealthTimelinePage />)

    await waitFor(() => expect(getHealthTimeline).toHaveBeenCalledWith(expect.objectContaining({ member: '本人' })))
    expect(screen.getByRole('combobox', { name: '成員' })).toHaveValue('本人')

    memberState.activeMember = ''
    rerender(<HealthTimelinePage />)

    await waitFor(() => expect(screen.getByRole('combobox', { name: '成員' })).toHaveValue(''))
    await waitFor(() => expect(getHealthTimeline).toHaveBeenLastCalledWith(expect.objectContaining({ member: null })))
  })

  it('defaults the newest mobile year open and exposes keyboard-focusable collapse controls', async () => {
    render(<HealthTimelinePage />)

    const newestToggle = await screen.findByRole('button', { name: '收合 2026 年健康事件' })
    const olderToggle = screen.getByRole('button', { name: '展開 2025 年健康事件' })
    const newestPanel = document.getElementById('timeline-year-content-2026')
    const olderPanel = document.getElementById('timeline-year-content-2025')

    expect(newestToggle).toHaveAttribute('aria-expanded', 'true')
    expect(newestToggle).toHaveAttribute('aria-controls', 'timeline-year-content-2026')
    expect(newestPanel).toHaveAttribute('data-mobile-expanded', 'true')
    expect(olderToggle).toHaveAttribute('aria-expanded', 'false')
    expect(olderToggle).toHaveAttribute('aria-controls', 'timeline-year-content-2025')
    expect(olderPanel).toHaveAttribute('data-mobile-expanded', 'false')
    expect(screen.getByRole('link', { name: '2026' })).toHaveAttribute('href', '#timeline-2026')

    olderToggle.focus()
    expect(olderToggle).toHaveFocus()
    fireEvent.click(olderToggle)

    expect(olderToggle).toHaveAttribute('aria-expanded', 'true')
    expect(olderPanel).toHaveAttribute('data-mobile-expanded', 'true')

    fireEvent.click(newestToggle)
    expect(newestToggle).toHaveAttribute('aria-expanded', 'false')
    expect(newestPanel).toHaveAttribute('data-mobile-expanded', 'false')
  })

  it('shows rule-based organization separately from medical confirmation', async () => {
    render(<HealthTimelinePage />)

    expect(await screen.findByText('規則整理')).toBeInTheDocument()
    expect(screen.getAllByText('待確認').length).toBeGreaterThan(0)
  })

  it('renders an encounter as one summary card and loads categorized details accessibly', async () => {
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: [encounterEvent], next_cursor: null })
    vi.mocked(getHealthEncounter).mockResolvedValue({
      encounter_id: encounterEvent.encounter_id,
      categories: [
        { key: 'diagnosis', label: '診斷', count: 1, items: [{ id: 'dx-1', title: '高血壓', summary: '持續追蹤', occurred_at: null, source_type: 'nhi_import', is_primary: true }] },
        { key: 'medication', label: '用藥', count: 2, items: [{ id: 'med-1', title: '降壓藥', summary: null, occurred_at: null, source_type: 'nhi_import', is_primary: true }] },
      ],
      provenance: [{ source_type: 'nhi_import', source_label: '健保匯入', record_count: 4 }],
    })

    render(<HealthTimelinePage />)

    const card = await screen.findByTestId('encounter-card')
    expect(within(card).getByRole('heading', { name: '高血壓、糖尿病' })).toBeInTheDocument()
    expect(within(card).getByText(/2026年8月1日 · 臺大醫院/)).toBeInTheDocument()
    expect(within(card).getByText('整合 4 筆')).toBeInTheDocument()
    expect(within(card).getByText('2 個來源')).toBeInTheDocument()
    expect(within(card).getByText('本次就醫重點：高血壓、糖尿病。')).toBeInTheDocument()
    expect(within(card).queryByText('本次就醫包含診斷、用藥與檢驗紀錄。')).not.toBeInTheDocument()

    const badges = within(card).getByLabelText('就醫事件標籤')
    expect(within(badges).getByText('診斷')).toBeInTheDocument()
    expect(within(badges).getByText('用藥')).toBeInTheDocument()
    expect(within(badges).getByText('檢驗')).toBeInTheDocument()
    expect(within(badges).getByText('+1')).toBeInTheDocument()
    expect(within(badges).getAllByText('系統整理重點')).toHaveLength(1)
    expect(within(badges).getByText('健保存摺')).toBeInTheDocument()
    expect(within(badges).getByText('待確認')).toBeInTheDocument()
    expect(within(badges).queryByText('規則整理')).not.toBeInTheDocument()
    expect(within(badges).queryByText('本人')).not.toBeInTheDocument()

    const toggle = within(card).getByRole('button', { name: '展開 高血壓、糖尿病的明細' })
    const details = document.getElementById('encounter-details-encounter-event')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', 'encounter-details-encounter-event')
    expect(details).toHaveAttribute('hidden')
    toggle.focus()
    expect(toggle).toHaveFocus()

    fireEvent.click(toggle)

    expect(getHealthEncounter).toHaveBeenCalledWith(encounterEvent.encounter_id)
    expect(within(card).getByText('資料如何整理')).toBeInTheDocument()
    await waitFor(() => expect(within(card).getByRole('heading', { name: '診斷' })).toBeInTheDocument())
    expect(within(card).getByRole('heading', { name: '這次主要看到' })).toBeInTheDocument()
    expect(within(card).getAllByText('高血壓').length).toBeGreaterThan(0)
    expect(within(card).getAllByText('降壓藥').length).toBeGreaterThan(0)
    expect(within(card).getAllByText('健保匯入').length).toBeGreaterThan(0)
    fireEvent.click(within(card).getByText('原始事件、代碼與技術欄位'))
    expect(within(card).getByText('timeline-group-v2')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(details).not.toHaveAttribute('hidden')
  })

  it('falls back to legacy title, summary, and facility fields for encounter cards', async () => {
    const legacyEncounter = {
      ...encounterEvent,
      id: 'legacy-encounter-event',
      encounter_id: 'legacy-encounter',
      title: '舊版就醫標題',
      summary: '舊版就醫摘要。',
      display_title: null,
      display_summary: null,
      facility_name: null,
      organization_label: '舊版院所',
      focus_method: null,
    }
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: [legacyEncounter], next_cursor: null })

    render(<HealthTimelinePage />)

    const card = await screen.findByTestId('encounter-card')
    expect(within(card).getByRole('heading', { name: '舊版就醫標題' })).toBeInTheDocument()
    expect(within(card).getByText('舊版就醫摘要。')).toBeInTheDocument()
    expect(within(card).getByText(/2026年8月1日 · 舊版院所/)).toBeInTheDocument()
    expect(within(card).queryByText('AI 整理')).not.toBeInTheDocument()
  })

  it('shows member badges only in the full-family view', async () => {
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: [encounterEvent], next_cursor: null })
    const { rerender } = render(<HealthTimelinePage />)
    const card = await screen.findByTestId('encounter-card')
    expect(within(card).queryByText('本人')).not.toBeInTheDocument()

    memberState.activeMember = ''
    rerender(<HealthTimelinePage />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '成員' })).toHaveValue(''))
    expect(within(await screen.findByTestId('encounter-card')).getByText('本人')).toBeInTheDocument()
  })

  it('keeps long focus copy available with a keyboard-accessible detail control', async () => {
    const longEncounter = {
      ...encounterEvent,
      id: 'long-encounter-event',
      encounter_id: 'long-encounter',
      display_title: '這是一個需要在手機寬度下仍可閱讀的長主題標題：高血壓與糖尿病後續追蹤',
      display_summary: '本次就醫重點包含多個分類與長文字摘要，內容應在窄螢幕中換行而不遮住展開明細控制。',
      focus_method: 'deterministic_fallback_v1',
    }
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: [longEncounter], next_cursor: null })

    render(<HealthTimelinePage />)

    const card = await screen.findByTestId('encounter-card')
    const toggle = within(card).getByRole('button', { name: /展開 .*的明細/ })
    expect(within(card).getByRole('heading', { name: longEncounter.display_title })).toBeInTheDocument()
    expect(within(card).getByText(longEncounter.display_summary)).toBeInTheDocument()
    toggle.focus()
    expect(toggle).toHaveFocus()
  })

  it('keeps the encounter summary visible and offers a retry when details fail', async () => {
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: [encounterEvent], next_cursor: null })
    vi.mocked(getHealthEncounter)
      .mockRejectedValueOnce(new Error('details unavailable'))
      .mockResolvedValueOnce({
        encounter_id: encounterEvent.encounter_id,
        categories: [{ key: 'imaging', label: '影像', count: 1, items: [{ id: 'img-1', title: '胸部影像', summary: null, occurred_at: null, source_type: 'nhi_import' }] }],
        provenance: [],
      })

    render(<HealthTimelinePage />)

    const card = await screen.findByTestId('encounter-card')
    fireEvent.click(within(card).getByRole('button', { name: '展開 高血壓、糖尿病的明細' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('摘要仍可查看')
    expect(within(card).getByText('本次就醫重點：高血壓、糖尿病。')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: '重試展開' }))
    await waitFor(() => expect(within(card).getByRole('heading', { name: '影像' })).toBeInTheDocument())
    expect(getHealthEncounter).toHaveBeenCalledTimes(2)
  })

  it('renders a cross-day health episode with complete visits and one-click profile actions', async () => {
    const episodeEvent = {
      ...encounterEvent,
      id: 'episode-event',
      encounter_id: null,
      episode_id: 'episode-g40',
      event_type: 'episode',
      display_title: '癲癇相關就醫',
      display_summary: '2026/3/1 至 2026/3/20，共 2 次相關就醫。',
      episode_start_date: '2026-03-01',
      episode_end_date: '2026-03-20',
      visit_count: 2,
      focus_method: null,
      included_types: ['diagnosis', 'medication'],
    }
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: [episodeEvent], next_cursor: null })
    vi.mocked(getHealthEpisode).mockResolvedValue({
      episode_id: 'episode-g40',
      display_title: '癲癇相關就醫',
      display_summary: '2026/3/1 至 2026/3/20，共 2 次相關就醫。',
      start_date: '2026-03-01',
      end_date: '2026-03-20',
      visit_count: 2,
      source_count: 3,
      included_types: ['diagnosis', 'medication'],
      detail_counts: { diagnoses: 2, medications: 1 },
      rule_summary: '只以相同 ICD 且相鄰就醫不超過 90 天串連。',
      policy_version: 'nhi_problem_episode_v1',
      visits: [
        {
          encounter_id: 'visit-2', date: '2026-03-20', facility: '乙醫院', record_count: 2, source_count: 2,
          link_reason: 'exact_problem_fact_within_window',
          categories: [
            { key: 'diagnoses', label: '診斷', count: 1, items: [{ id: 'dx-2', title: '癲癇', summary: null, occurred_at: null, source_type: 'nhi_health_passbook', is_primary: true, profile_kind: 'condition', can_save_to_profile: true, saved_to_profile: false }] },
            { key: 'medications', label: '用藥', count: 1, items: [{ id: 'med-2', title: '抗癲癇藥', summary: '1 錠', occurred_at: null, source_type: 'nhi_health_passbook', profile_kind: 'medication', can_save_to_profile: true, saved_to_profile: false }] },
          ],
        },
        {
          encounter_id: 'visit-1', date: '2026-03-01', facility: '甲醫院', record_count: 1, source_count: 1,
          link_reason: 'exact_problem_fact_within_window',
          categories: [{ key: 'diagnoses', label: '診斷', count: 1, items: [{ id: 'dx-1', title: '癲癇', summary: null, occurred_at: null, source_type: 'nhi_health_passbook', is_primary: true }] }],
        },
      ],
      provenance: [{ source_type: 'nhi_health_passbook', source_label: '健保存摺', record_count: 3 }],
    })

    render(<HealthTimelinePage />)
    const card = await screen.findByTestId('episode-card')
    expect(within(card).getByRole('heading', { name: '癲癇相關就醫' })).toBeInTheDocument()
    expect(within(within(card).getByLabelText('就醫事件標籤')).getByText('健康問題歷程')).toBeInTheDocument()
    expect(within(card).getByText('串連 2 次就醫')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: '展開 癲癇相關就醫的明細' }))
    await waitFor(() => expect(getHealthEpisode).toHaveBeenCalledWith('episode-g40'))
    expect(within(card).getByRole('heading', { name: /2026年3月20日 · 乙醫院/ })).toBeInTheDocument()
    expect(within(card).getByRole('heading', { name: /2026年3月1日 · 甲醫院/ })).toBeInTheDocument()
    const addCondition = within(card).getByRole('button', { name: '加入我的病況' })
    fireEvent.click(addCondition)
    expect(saveNhiFactToProfile).not.toHaveBeenCalled()
    const confirmationDialog = screen.getByRole('dialog', { name: '確認目前病況狀態' })
    const statusSelect = within(confirmationDialog).getByRole('combobox', { name: '這個病況目前的狀態' })
    expect(statusSelect).toHaveValue('')
    expect(within(confirmationDialog).getByRole('button', { name: '確認並加入' })).toBeDisabled()
    fireEvent.change(statusSelect, { target: { value: 'monitoring' } })
    fireEvent.click(within(confirmationDialog).getByRole('button', { name: '確認並加入' }))
    await waitFor(() => expect(saveNhiFactToProfile).toHaveBeenCalledWith('dx-2', { status: 'monitoring' }))
    expect(addCondition).toHaveTextContent('已加入我的健康檔案')
  })

  it('keeps legacy timeline items without encounter fields as ordinary event cards', async () => {
    render(<HealthTimelinePage />)

    const legacyCard = await screen.findByRole('heading', { name: '今年門診' })
    expect(legacyCard.closest('article')).not.toHaveAttribute('data-testid', 'encounter-card')
    expect(screen.queryByRole('button', { name: '展開明細' })).not.toBeInTheDocument()
  })

  it('replaces unknown event, source, and category codes with generic Chinese labels', async () => {
    const unknownEvent = {
      ...events[0],
      id: 'unknown-event',
      event_type: 'opaque_event_code_v9',
      source_type: 'opaque_source_77',
      organization_label: 'machine_parser_v3',
      organization_method: 'opaque_method_v2',
      source_id: 'raw-source-id-77',
      title: '其他就醫紀錄',
      summary: '這筆資料的技術分類目前沒有一般中文名稱。',
    }
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: [unknownEvent], next_cursor: null })

    render(<HealthTimelinePage />)

    const card = (await screen.findByRole('heading', { name: '其他就醫紀錄' })).closest('article')
    expect(card).not.toBeNull()
    const badges = within(card!).getByLabelText('事件標籤')
    expect(within(badges).getByText('其他健康事件')).toBeInTheDocument()
    expect(within(badges).getByText('其他資料來源')).toBeInTheDocument()
    expect(within(badges).getByText('系統整理')).toBeInTheDocument()
    fireEvent.click(within(card!).getByText('原始事件與技術欄位'))
    expect(within(card!).getByText('已保留於系統')).toBeInTheDocument()
    expect(within(card!).queryByText('opaque_event_code_v9')).not.toBeInTheDocument()
    expect(within(card!).queryByText('opaque_source_77')).not.toBeInTheDocument()
    expect(within(card!).queryByText('raw-source-id-77')).not.toBeInTheDocument()
    expect(within(card!).queryByText('opaque_method_v2')).not.toBeInTheDocument()
  })

  it('does not expose unknown encounter category or item source codes', async () => {
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: [encounterEvent], next_cursor: null })
    vi.mocked(getHealthEncounter).mockResolvedValue({
      encounter_id: encounterEvent.encounter_id,
      categories: [{
        key: 'opaque_category_88',
        label: 'opaque_category_label',
        count: 1,
        items: [{ id: 'other-1', title: '其他健康內容', summary: null, occurred_at: null, source_type: 'opaque_source_88' }],
      }],
      provenance: [],
    })

    render(<HealthTimelinePage />)
    const card = await screen.findByTestId('encounter-card')
    fireEvent.click(within(card).getByRole('button', { name: '展開 高血壓、糖尿病的明細' }))
    await waitFor(() => expect(within(card).getByRole('heading', { name: '其他健康資訊' })).toBeInTheDocument())
    expect(within(card).getByText('其他資料來源')).toBeInTheDocument()
    expect(within(card).queryByText('opaque_category_88')).not.toBeInTheDocument()
    expect(within(card).queryByText('opaque_category_label')).not.toBeInTheDocument()
    expect(within(card).queryByText('opaque_source_88')).not.toBeInTheDocument()
  })

  it('keeps the last successful cards when a filter refresh fails', async () => {
    vi.mocked(getHealthTimeline)
      .mockResolvedValueOnce({ items: events, next_cursor: null })
      .mockRejectedValueOnce(new Error('filtered timeline unavailable'))

    render(<HealthTimelinePage />)
    expect(await screen.findByText('今年門診')).toBeInTheDocument()
    expect(screen.getByText('去年手術')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '資料來源' }), { target: { value: 'cmo' } })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('無法更新時間軸')
    expect(alert).toHaveTextContent('保留上一次成功載入的內容')
    expect(screen.queryByText('時間軸暫時無法載入')).not.toBeInTheDocument()
    expect(screen.getByText('今年門診')).toBeInTheDocument()
    expect(screen.getByText('去年手術')).toBeInTheDocument()
    expect(screen.queryByText('目前沒有符合篩選條件的健康事件')).not.toBeInTheDocument()
    expect(getHealthTimeline).toHaveBeenLastCalledWith(expect.objectContaining({ source_type: 'cmo' }))
  })

  it('shows explicit empty and error states for the timeline request', async () => {
    vi.mocked(getHealthTimeline).mockResolvedValueOnce({ items: [], next_cursor: null })
    const { unmount } = render(<HealthTimelinePage />)
    expect(await screen.findByText('目前沒有符合篩選條件的健康事件')).toBeInTheDocument()
    unmount()

    vi.mocked(getHealthTimeline).mockRejectedValueOnce(new Error('timeline unavailable'))
    render(<HealthTimelinePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('時間軸暫時無法載入')
  })
})
