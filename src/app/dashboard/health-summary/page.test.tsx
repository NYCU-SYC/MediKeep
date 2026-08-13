import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthSummaryCompatibilityPage from './page';

const { replace, apiGet } = vi.hoisted(() => ({
  replace: vi.fn(),
  apiGet: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('member=%E5%AA%BD%E5%AA%BD&filter=active&next=%2Fdashboard%2Ftasks'),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/api', () => ({
  api: { get: apiGet },
}));

describe('health summary legacy URL compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '#confirmed';
  });

  it('replaces the old URL with canonical health while preserving query and hash', async () => {
    render(<HealthSummaryCompatibilityPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      '/dashboard/health?member=%E5%AA%BD%E5%AA%BD&filter=active&next=%2Fdashboard%2Ftasks#confirmed',
    ));
    expect(screen.getByRole('link', { name: '立即前往' })).toHaveAttribute(
      'href',
      '/dashboard/health?member=%E5%AA%BD%E5%AA%BD&filter=active&next=%2Fdashboard%2Ftasks',
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(apiGet).not.toHaveBeenCalled();
  });
});
