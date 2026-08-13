import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProblemsLegacyRedirectPage from './page';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

beforeEach(() => {
  navigation.replace.mockReset();
  navigation.search = '';
  window.history.replaceState(null, '', '/');
});

describe('legacy problems redirect', () => {
  it('preserves existing parameters and hash while adding the confirmed view', async () => {
    navigation.search = 'member=%E7%8E%8B%E5%B0%8F%E6%98%8E&next=%2Fdashboard%2Ftasks&filters=active%2Crecent&import=job-7';
    window.history.replaceState(null, '', '/dashboard/problems#source-3');
    render(<ProblemsLegacyRedirectPage />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));

    const url = new URL(String(navigation.replace.mock.calls[0][0]), 'https://healthkeep.test');
    expect(url.pathname).toBe('/dashboard/conditions');
    expect(url.searchParams.get('member')).toBe('王小明');
    expect(url.searchParams.get('next')).toBe('/dashboard/tasks');
    expect(url.searchParams.get('filters')).toBe('active,recent');
    expect(url.searchParams.get('import')).toBe('job-7');
    expect(url.searchParams.get('section')).toBe('confirmed');
    expect(url.hash).toBe('#source-3');
  });

  it('keeps an explicit section instead of overwriting it', async () => {
    navigation.search = 'section=reported&filter=mine';
    window.history.replaceState(null, '', '/dashboard/problems#details');
    render(<ProblemsLegacyRedirectPage />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));

    expect(navigation.replace).toHaveBeenCalledWith('/dashboard/conditions?section=reported&filter=mine#details');
  });

  it('does not render another main region or heading while replacing the route', async () => {
    render(<ProblemsLegacyRedirectPage />);

    expect(screen.getByRole('status')).toHaveTextContent('正在開啟病況頁面');
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard/conditions?section=confirmed'));
  });
});
