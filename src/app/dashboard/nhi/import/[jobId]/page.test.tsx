import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NhiImportLoadingPage from './page';
import { getNhiImportJob } from '@/lib/nhiImports';

const replace = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useParams: () => ({ jobId: 'job-completed' }),
  useRouter: () => ({ replace }),
}));

vi.mock('@/lib/nhiImports', () => ({
  getNhiImportJob: vi.fn(),
  retryNhiImport: vi.fn(),
}));

const completedJob = {
  id: 'job-completed',
  state: 'completed',
  stage: 'completed',
  progress: 100,
  processed_sections: 2,
  total_sections: 2,
  retryable: false,
  error_code: null,
  error_message: null,
  updated_at: '2026-08-12T08:00:00Z',
  version: 1,
};

describe('NhiImportLoadingPage completed redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNhiImportJob).mockResolvedValue(completedJob);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.history.pushState({}, '', '/dashboard/nhi/import/job-completed?member=%E5%AE%B6%E4%BA%BA&next=%2Fdashboard%2Fhealth&filter=lab#latest');
  });

  it('preserves member, next, filters, and hash while appending the import job id', async () => {
    render(<NhiImportLoadingPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      '/dashboard/timeline?member=%E5%AE%B6%E4%BA%BA&next=%2Fdashboard%2Fhealth&filter=lab&import=job-completed#latest',
    ));
  });
});
