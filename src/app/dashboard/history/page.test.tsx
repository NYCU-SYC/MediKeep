import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryPage from './page';
import { api } from '@/lib/api';

const { showToast, push, replace, setActiveMember } = vi.hoisted(() => ({
  showToast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  setActiveMember: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/history',
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../member-context', () => ({
  useActiveMember: () => ({
    activeMember: '本人',
    members: [{ name: '本人', relation: '本人', color: '#607d8b' }],
    setActiveMember,
    canWriteMember: () => true,
    writeAccessReason: () => null,
  }),
}));

vi.mock('../toast-context', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/lib/sync', () => ({
  useSync: () => ({ viewVersions: {} }),
}));

const measurement = {
  id: 'measurement-1',
  member_name: '本人',
  record_type: 'weight',
  value1: '68',
  value2: null,
  unit: 'kg',
  note: null,
  recorded_at: '2026-08-12T08:00:00',
  created_at: '2026-08-12T08:00:00',
};

describe('HistoryPage recoverable measurement retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/records') return [{ ...measurement }];
      if (path === '/api/patients/me/timeline') return [];
      throw new Error(`unexpected path: ${path}`);
    });
  });

  it('reuses stable keys after ambiguous delete and restore failures', async () => {
    vi.mocked(api.delete)
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({
        id: measurement.id,
        deleted: true,
        recoverable: true,
        deleted_at: '2026-08-12T09:00:00',
        save_state: 'saved',
      });
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error('restore response lost'))
      .mockResolvedValueOnce({ ...measurement });

    render(<HistoryPage />);
    expect(await screen.findByText('68 kg')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    const firstDeleteOptions = vi.mocked(api.delete).mock.calls[0][1];
    expect(firstDeleteOptions?.idempotencyKey).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.delete).mock.calls[1][1]?.idempotencyKey)
      .toBe(firstDeleteOptions?.idempotencyKey);

    const deletedToast = showToast.mock.calls.find(([message]) => message === '已移至最近刪除');
    expect(deletedToast).toBeTruthy();
    act(() => deletedToast?.[2]?.onClick());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const firstRestoreOptions = vi.mocked(api.post).mock.calls[0][2];
    expect(firstRestoreOptions?.idempotencyKey).toBeTruthy();

    const retryToast = await waitFor(() => {
      const found = showToast.mock.calls.find(([message]) => message === '復原失敗，紀錄仍留在最近刪除中');
      expect(found).toBeTruthy();
      return found;
    });
    act(() => retryToast?.[2]?.onClick());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls[1][2]?.idempotencyKey)
      .toBe(firstRestoreOptions?.idempotencyKey);
    expect(await screen.findByText('68 kg')).toBeInTheDocument();
  });

  it('never exposes unknown activity enums, source ids, or technical role labels', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/records') return [];
      if (path === '/api/patients/me/timeline') return [
        {
          id: 'activity-owner',
          actor: 'Owner',
          target_type: 'experimental_event_v2',
          target_label: '測試資料甲',
          member_name: 'self',
          title: 'experimental_event_v2',
          short_description: 'status=opaque_status_v2',
          status: 'opaque_status_v2',
          source_document_id: 'document-internal-id-123',
          created_at: '2026-08-12T09:00:00Z',
        },
        {
          id: 'activity-cmo',
          actor: 'CMO',
          target_type: 'condition',
          target_label: '測試資料乙',
          member_name: 'Owner',
          title: 'condition_status_changed',
          status: 'completed',
          created_at: '2026-08-12T08:00:00Z',
        },
      ];
      throw new Error(`unexpected path: ${path}`);
    });

    render(<HistoryPage />);

    expect(await screen.findByText('測試資料甲的狀態已更新')).toBeInTheDocument();
    expect(screen.getAllByText('其他資料').length).toBeGreaterThan(0);
    expect(screen.getAllByText('狀態待確認').length).toBeGreaterThan(0);
    expect(screen.getAllByText('家庭管理者').length).toBeGreaterThan(0);
    expect(screen.getAllByText('醫療團隊').length).toBeGreaterThan(0);
    expect(screen.getAllByText('本人').length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: '有來源文件' })).toBeInTheDocument();

    const visibleText = document.body.textContent ?? '';
    expect(visibleText).not.toContain('experimental_event_v2');
    expect(visibleText).not.toContain('opaque_status_v2');
    expect(visibleText).not.toContain('document-internal-id-123');
    expect(visibleText).not.toContain('Owner');
    expect(visibleText).not.toContain('CMO');
    expect(visibleText).not.toContain('self');
  });
});
