import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import ClarificationReplyPage from './page';

const { push, showToast } = vi.hoisted(() => ({
  push: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'request-1' }),
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../toast-context', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../../member-context', () => ({
  useActiveMember: () => ({ activeMember: '王小明' }),
}));

const requestItem = {
  id: 'request-1',
  target_type: 'problem',
  target_id: 'problem-1',
  member_name: '王小明',
  target_label: '高血壓追蹤',
  action: 'update',
  current_snapshot: {},
  proposed_payload: {},
  patient_note: null,
  status: 'needs_clarification',
  reviewer_note: null,
  requested_action: 'provide_note',
  patient_facing_note: '請補充最近一次回診日期。',
  available_actions: [],
  created_at: '2026-08-10T00:00:00Z',
  updated_at: '2026-08-10T00:00:00Z',
  withdrawn_at: null,
};

describe('ClarificationReplyPage withdrawal', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue(requestItem);
    vi.mocked(api.post).mockResolvedValue({ ...requestItem, status: 'withdrawn' });
  });

  it('confirms withdrawal in an accessible dialog without calling the native confirm API', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ClarificationReplyPage />);

    fireEvent.click(await screen.findByRole('button', { name: '撤回' }));

    const dialog = screen.getByRole('dialog', { name: '撤回這次補充？' });
    expect(dialog).toHaveTextContent('高血壓追蹤');
    expect(dialog).toHaveTextContent('正式健康紀錄不會被刪除');
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '確認撤回' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/patients/me/change-requests/request-1/withdraw'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/history?member=%E7%8E%8B%E5%B0%8F%E6%98%8E'));
  });

  it('uses neutral Chinese labels instead of exposing unknown request enums', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...requestItem,
      target_type: 'experimental_target_v2',
      status: 'backend_status_v2',
      requested_action: 'internal_action_v2',
      current_snapshot: { status: 'opaque_record_status' },
    });

    render(<ClarificationReplyPage />);

    expect(await screen.findByText('其他健康資料')).toBeInTheDocument();
    expect(screen.getAllByText('狀態待確認').length).toBeGreaterThan(0);
    expect(screen.getAllByText('補充相關資料').length).toBeGreaterThan(0);
    expect(screen.getByText('這筆目前狀態是「狀態待確認」，不能再送出補充。你仍可查看已送出的內容與歷史紀錄。')).toBeInTheDocument();

    const visibleText = document.body.textContent ?? '';
    expect(visibleText).not.toContain('experimental_target_v2');
    expect(visibleText).not.toContain('backend_status_v2');
    expect(visibleText).not.toContain('internal_action_v2');
    expect(visibleText).not.toContain('opaque_record_status');
  });
});
