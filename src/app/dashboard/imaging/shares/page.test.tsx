import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateApiGetCache } from '@/lib/api';
import SharesPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../member-context', () => ({
  useActiveMember: () => ({ activeMember: '王小明', canWriteMember: () => true, writeAccessReason: () => null }),
}));
const showToast = vi.fn();
vi.mock('../../toast-context', () => ({ useToast: () => ({ showToast }) }));

describe('DICOM share revoke', () => {
  beforeEach(() => invalidateApiGetCache());

  it('uses an accessible confirmation and keeps the row retryable when revoke fails', async () => {
    const share = {
      id: 'share-1', share_token: 'token-1', study_id: 'study-1', series_id: null,
      expires_at: null, access_count: 0, created_at: '2026-08-10T00:00:00Z', share_url: 'http://invalid/viewer/token-1',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [share] })
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), json: async () => ({ error: { message: '儲存服務暫時無法使用', retryable: true, save_state: 'unchanged' } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SharesPage />);
    expect(await screen.findByText(/viewer\/token-1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤銷' }));
    expect(screen.getByRole('dialog', { name: '撤銷這個分享連結？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤銷分享' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '重試撤銷' })).toBeInTheDocument());
    expect(screen.getByText('viewer/token-1', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('連結仍有效且保留');
  });
});
