import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LegacyNhiImportJobRedirectPage from './page';

const navigation = vi.hoisted(() => ({
  jobId: 'job-1',
  replace: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ jobId: navigation.jobId }),
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

beforeEach(() => {
  navigation.jobId = 'job-1';
  navigation.replace.mockReset();
  navigation.search = '';
  window.history.replaceState(null, '', '/');
});

describe('legacy NHI import job redirect', () => {
  it('preserves every query parameter and the hash', async () => {
    navigation.jobId = 'job/7';
    navigation.search = 'member=%E6%9D%8E%E5%B0%8F%E8%8F%AF&next=%2Fdashboard%2Frecords&filters=failed&import=legacy-9&section=confirmed';
    window.history.replaceState(null, '', '/dashboard/nhi-import/jobs/job%2F7#review-row-2');
    render(<LegacyNhiImportJobRedirectPage />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));

    const url = new URL(String(navigation.replace.mock.calls[0][0]), 'https://healthkeep.test');
    expect(url.pathname).toBe('/dashboard/nhi/import/job%2F7');
    expect(url.searchParams.get('member')).toBe('李小華');
    expect(url.searchParams.get('next')).toBe('/dashboard/records');
    expect(url.searchParams.get('filters')).toBe('failed');
    expect(url.searchParams.get('import')).toBe('legacy-9');
    expect(url.searchParams.get('section')).toBe('confirmed');
    expect(url.hash).toBe('#review-row-2');
  });

  it('keeps duplicate and unknown query values instead of narrowing the legacy URL', async () => {
    navigation.search = 'tag=a&tag=b&unknown=%E5%80%BC';
    window.history.replaceState(null, '', '/dashboard/nhi-import/jobs/job-1#details');
    render(<LegacyNhiImportJobRedirectPage />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));

    const url = new URL(String(navigation.replace.mock.calls[0][0]), 'https://healthkeep.test');
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b']);
    expect(url.searchParams.get('unknown')).toBe('值');
    expect(url.hash).toBe('#details');
  });

  it('redirects the compatibility page without adding a main region or heading', async () => {
    render(<LegacyNhiImportJobRedirectPage />);

    expect(screen.getByRole('status')).toHaveTextContent('正在開啟健保資料匯入進度');
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard/nhi/import/job-1'));
  });
});
