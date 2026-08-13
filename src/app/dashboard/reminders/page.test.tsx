import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RemindersPage from './page';
import { api } from '@/lib/api';

const { showToast, push, replace, setActiveMember } = vi.hoisted(() => ({
  showToast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  setActiveMember: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/reminders',
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

const reminder = {
  id: 17,
  member_name: '本人',
  type: 'follow_up',
  source: 'patient_created',
  status: 'active',
  is_verified: false,
  is_patient_managed: true,
  title: '固定回診提醒',
  scheduled_date: '2026-09-01',
  time: '09:00',
  is_done: false,
  visit_types: [],
};

describe('RemindersPage recoverable deletion retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/patients/me/reminders') return [{ ...reminder }];
      if (path === '/api/patients/me/follow-ups') return [];
      if (path === '/api/patients/me/missing-data-requests') return [];
      throw new Error(`unexpected path: ${path}`);
    });
  });

  it('reuses explicit keys for reminder delete and undo logical retries', async () => {
    vi.mocked(api.delete)
      .mockRejectedValueOnce(new Error('delete response lost'))
      .mockResolvedValueOnce({
        id: reminder.id,
        deleted: true,
        deleted_at: '2026-08-12T09:15:00',
        recoverable: true,
      })
      .mockResolvedValueOnce({ id: reminder.id, deleted: true, recoverable: true });
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error('undo response lost'))
      .mockResolvedValueOnce({ ...reminder });

    render(<RemindersPage />);
    expect(await screen.findByText(reminder.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: `刪除「${reminder.title}」？` })).toHaveTextContent('移到最近刪除');
    expect(screen.getByRole('dialog', { name: `刪除「${reminder.title}」？` })).toHaveTextContent('不會立即永久清除');
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    const firstDeleteKey = vi.mocked(api.delete).mock.calls[0][1]?.idempotencyKey;
    expect(firstDeleteKey).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '刪除' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.delete).mock.calls[1][1]?.idempotencyKey).toBe(firstDeleteKey);

    const deletedToast = showToast.mock.calls.find(([message]) => message === '已刪除提醒');
    expect(deletedToast).toBeTruthy();
    expect(deletedToast?.[2]?.label).toBe('復原');
    act(() => deletedToast?.[2]?.onClick());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const firstUndoKey = vi.mocked(api.post).mock.calls[0][2]?.idempotencyKey;
    expect(firstUndoKey).toBeTruthy();

    const retryToast = await waitFor(() => {
      const found = showToast.mock.calls.find(([message]) => message === '復原失敗，提醒仍留在最近刪除中');
      expect(found).toBeTruthy();
      return found;
    });
    act(() => retryToast?.[2]?.onClick());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls[1][2]?.idempotencyKey).toBe(firstUndoKey);
    expect(await screen.findByText(reminder.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.delete).mock.calls[2][1]?.idempotencyKey).not.toBe(firstDeleteKey);
  });

  it('shows the failed task section even when another section and personal reminders loaded', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/patients/me/reminders') return [{ ...reminder }];
      if (path === '/api/patients/me/follow-ups') return [{
        id: 3,
        reason: '確認血壓趨勢',
        item: '一週後回報血壓',
        suggested_date: '2026-08-20',
        priority: 'normal',
        needs_more_data: false,
        needs_cmo_recheck: true,
        status: 'open',
      }];
      if (path === '/api/patients/me/missing-data-requests') throw new Error('service unavailable');
      throw new Error(`unexpected path: ${path}`);
    });

    render(<RemindersPage />);

    expect(await screen.findByText(reminder.title)).toBeInTheDocument();
    expect(await screen.findByText('一週後回報血壓')).toBeInTheDocument();
    expect(await screen.findByText('補件與資料請求載入不完整')).toBeInTheDocument();
    expect(screen.getByText(/已保留上次成功載入的內容/)).toBeInTheDocument();
  });

  it('humanizes technical member labels and never exposes unknown reminder sources', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/patients/me/reminders') return [
        {
          ...reminder,
          id: 18,
          title: '未知來源提醒',
          member_name: 'self',
          source: 'backend_source_v2',
        },
        {
          ...reminder,
          id: 19,
          title: '醫療團隊提醒',
          member_name: 'Owner',
          source: 'CMO',
        },
      ];
      if (path === '/api/patients/me/follow-ups') return [];
      if (path === '/api/patients/me/missing-data-requests') return [];
      throw new Error(`unexpected path: ${path}`);
    });

    render(<RemindersPage />);

    expect(await screen.findByText('未知來源提醒')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByText('其他來源')).toBeInTheDocument();
    expect(await screen.findByText('醫療團隊建立')).toBeInTheDocument();
    expect(screen.getAllByText('本人').length).toBeGreaterThan(0);
    expect(screen.getAllByText('家庭管理者').length).toBeGreaterThan(0);

    const visibleText = document.body.textContent ?? '';
    expect(visibleText).not.toContain('backend_source_v2');
    expect(visibleText).not.toContain('Owner');
    expect(visibleText).not.toContain('CMO');
    expect(visibleText).not.toContain('self');
  });
});
