import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NhiOnboardingGate from './NhiOnboardingGate';
import { getNhiOnboarding, markNhiOnboardingSeen, skipNhiOnboarding } from '@/lib/nhiImports';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh }),
}));

vi.mock('@/lib/nhiImports', () => ({
  getNhiOnboarding: vi.fn(),
  markNhiOnboardingSeen: vi.fn(),
  skipNhiOnboarding: vi.fn(),
}));

describe('NhiOnboardingGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNhiOnboarding).mockResolvedValue({
      feature_enabled: true,
      reminder_required: true,
      seen_at: null,
      skipped_at: null,
      completed_at: null,
    });
    vi.mocked(markNhiOnboardingSeen).mockResolvedValue({
      feature_enabled: true,
      reminder_required: true,
      seen_at: '2026-08-09T11:00:00Z',
      skipped_at: null,
      completed_at: null,
    });
    vi.mocked(skipNhiOnboarding).mockResolvedValue({
      feature_enabled: true,
      reminder_required: false,
      seen_at: '2026-08-09T11:00:00Z',
      skipped_at: '2026-08-09T12:00:00Z',
      completed_at: null,
    });
  });

  it('shows the first-login reminder from server state', async () => {
    render(<NhiOnboardingGate />);
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('把近年的健保資料帶回 HealthKeep');
    expect(screen.getByRole('link', { name: '立即匯入' })).toHaveAttribute('href', '/dashboard/upload?mode=nhi-first');
    await waitFor(() => expect(markNhiOnboardingSeen).toHaveBeenCalledTimes(1));
  });

  it('persists skip on the server and closes the blocking reminder', async () => {
    render(<NhiOnboardingGate />);
    fireEvent.click(await screen.findByRole('button', { name: '稍後處理' }));
    await waitFor(() => expect(skipNhiOnboarding).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });
});
