import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LegacyHealthRedirect, { mergeTarget } from './LegacyHealthRedirect';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('member=%E5%AA%BD%E5%AA%BD&filter=active&next=%2Fdashboard%2Ftasks'),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>,
}));

describe('legacy health redirects', () => {
  beforeEach(() => {
    replace.mockReset();
    window.location.hash = '#details';
  });

  it('preserves member, filters, next and the browser hash while enforcing the canonical view', async () => {
    render(<LegacyHealthRedirect target="/dashboard/emergency?view=important" label="急診資訊" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      '/dashboard/emergency?member=%E5%AA%BD%E5%AA%BD&filter=active&next=%2Fdashboard%2Ftasks&view=important#details',
    ));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '立即前往' })).toHaveAttribute(
      'href',
      '/dashboard/emergency?member=%E5%AA%BD%E5%AA%BD&filter=active&next=%2Fdashboard%2Ftasks&view=important',
    );
  });

  it('keeps target query values authoritative', () => {
    expect(mergeTarget('/dashboard/emergency?view=important', 'view=links&member=A', '#x'))
      .toBe('/dashboard/emergency?view=important&member=A#x');
  });
});
