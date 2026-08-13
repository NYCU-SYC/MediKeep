import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ImagingPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard/imaging',
  useSearchParams: () => new URLSearchParams('member=%E7%8E%8B%E5%B0%8F%E6%98%8E'),
}));
vi.mock('../member-context', () => ({
  useActiveMember: () => ({
    activeMember: '王小明', setActiveMember: vi.fn(), members: [{ name: '王小明' }],
    canWriteMember: () => true, writeAccessReason: () => null,
  }),
}));
const showToast = vi.fn();
vi.mock('../toast-context', () => ({ useToast: () => ({ showToast }) }));

const study = {
  id: 'study-1', member_name: '王小明', study_instance_uid: 'uid', study_date: '20260810', study_description: '胸部 CT',
  modality: 'CT', patient_name: null, series_count: 1, instance_count: 20, available_instance_count: 20,
  missing_instance_count: 0, storage_available: true, note: null, created_at: '2026-08-10T00:00:00Z',
};

describe('DICOM recently deleted UX', () => {
  it('explains share revocation, soft deletes, and restores the study', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/restore')) return { ok: true, status: 200, json: async () => study };
      if (init?.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ deleted_at: '2026-08-12T00:00:00Z', recoverable: true, revoked_share_count: 1, save_state: 'saved' }) };
      if (url.includes('deleted=true')) return { ok: true, status: 200, headers: new Headers({ 'X-Total-Count': '1' }), json: async () => [{ ...study, deleted_at: '2026-08-12T00:00:00Z', recoverable: true }] };
      return { ok: true, status: 200, headers: new Headers({ 'X-Total-Count': '1' }), json: async () => [study] };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ImagingPage />);
    expect(await screen.findByText('胸部 CT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除：胸部 CT' }));
    const dialog = screen.getByRole('dialog', { name: '移到最近刪除？' });
    expect(dialog).toHaveTextContent('可復原');
    expect(dialog).toHaveTextContent('分享連結會立即撤銷');
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(screen.queryByText('胸部 CT')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /最近刪除/ }));
    expect(await screen.findByText('胸部 CT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    await waitFor(() => expect(screen.queryByText('胸部 CT')).not.toBeInTheDocument());
    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    const restoreCall = fetchMock.mock.calls.find(([url]) => url.includes('/restore'));
    expect(new Headers(deleteCall?.[1]?.headers).get('Idempotency-Key')).toMatch(/^dicom-delete-/);
    expect(new Headers(restoreCall?.[1]?.headers).get('Idempotency-Key')).toMatch(/^dicom-restore-/);
  });

  it('does not offer a recoverable delete when the original image is missing', async () => {
    const missingStudy = {
      ...study,
      id: 'study-missing',
      study_description: '原檔遺失的 CT',
      storage_available: false,
      available_instance_count: 0,
      missing_instance_count: 20,
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('deleted=true')) {
        return { ok: true, status: 200, headers: new Headers({ 'X-Total-Count': '0' }), json: async () => [] };
      }
      return { ok: true, status: 200, headers: new Headers({ 'X-Total-Count': '1' }), json: async () => [missingStudy] };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ImagingPage />);

    expect(await screen.findByText('原檔遺失的 CT')).toBeInTheDocument();
    const deleteButton = screen.getByRole('button', { name: '移到最近刪除：原檔遺失的 CT' });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute('title', expect.stringContaining('原始檔'));
    fireEvent.click(deleteButton);
    expect(screen.queryByRole('dialog', { name: '移到最近刪除？' })).not.toBeInTheDocument();
  });
});
