import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getHealthTimeline } from '@/lib/healthTimeline'
import HealthTimelinePage from './page'

const memberState = vi.hoisted(() => ({
  activeMember: '本人' as string,
  members: [
    { id: 'self', name: '本人' },
    { id: 'family', name: '家人' },
  ],
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/healthTimeline', () => ({
  getHealthTimeline: vi.fn(),
}))

vi.mock('../member-context', () => ({
  useActiveMember: () => memberState,
}))

vi.mock('@/lib/sync', () => ({
  useSync: () => ({ viewVersions: {} }),
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
    is_important: true,
    member_name: '本人',
  },
]

describe('HealthTimelinePage member and mobile year behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    memberState.activeMember = '本人'
    vi.mocked(getHealthTimeline).mockResolvedValue({ items: events, next_cursor: null })
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
})
