import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NhiOnboardingGate from './NhiOnboardingGate'
import { getNhiOnboarding } from '@/lib/nhiImports'

const navigation = vi.hoisted(() => ({ pathname: '/dashboard', search: '' }))
const replace = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ replace }),
}))

vi.mock('@/lib/nhiImports', () => ({
  getNhiOnboarding: vi.fn(),
}))

function incompleteState() {
  return {
    feature_enabled: true,
    reminder_required: true,
    seen_at: null,
    skipped_at: null,
    completed_at: null,
  }
}

describe('NhiOnboardingGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigation.pathname = '/dashboard'
    navigation.search = ''
    vi.mocked(getNhiOnboarding).mockResolvedValue(incompleteState())
  })

  it('redirects incomplete users to the full onboarding page with a safe next route', async () => {
    render(<NhiOnboardingGate />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/onboarding/nhi?next=%2Fdashboard'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not redirect a resumable import page and does not create a loop', async () => {
    navigation.pathname = '/dashboard/nhi/import/job-123'
    render(<NhiOnboardingGate />)
    await waitFor(() => expect(getNhiOnboarding).toHaveBeenCalledTimes(1))
    expect(replace).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('treats the legacy skipped response as a compatibility completion', async () => {
    vi.mocked(getNhiOnboarding).mockResolvedValue({ ...incompleteState(), skipped_at: '2026-08-11T00:00:00Z' })
    render(<NhiOnboardingGate />)
    await waitFor(() => expect(getNhiOnboarding).toHaveBeenCalledTimes(1))
    expect(replace).not.toHaveBeenCalled()
  })

  it('shows retryable status failure without a blank page or redirect loop', async () => {
    vi.mocked(getNhiOnboarding).mockRejectedValue(new Error('offline'))
    render(<NhiOnboardingGate />)
    expect(await screen.findByRole('status')).toHaveTextContent('無法確認')
    fireEvent.click(screen.getByRole('button', { name: '重新確認' }))
    await waitFor(() => expect(getNhiOnboarding).toHaveBeenCalledTimes(2))
    expect(replace).not.toHaveBeenCalled()
  })
})
