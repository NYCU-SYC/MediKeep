import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConditionsPage from './page';
import { api } from '@/lib/api';


const { showToast, refreshNow } = vi.hoisted(() => ({
  showToast: vi.fn(),
  refreshNow: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 500;
    code = 'request_failed';
    details = null;
  },
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
    members: [{ name: '本人' }],
  }),
}));

vi.mock('../toast-context', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/lib/sync', () => ({
  useSync: () => ({
    viewVersions: {},
    refreshNow,
  }),
}));

const nhiDraft = {
  id: 41,
  member_name: '本人',
  diagnosis: '高血壓',
  date: '2026-02-01',
  facility: '安心診所',
  section: 'outpatient',
  section_label: '門診紀錄',
  review_status: 'pending',
  review_status_label: '待醫療團隊整理',
  publish_status: 'not_published',
  publish_status_label: '尚未發布到健康檔案',
  source: 'nhi_import',
  source_label: '健保匯入',
  organization_label: 'AI 整理',
  confirmation_label: '尚未醫療確認',
  patient_tracking_state: 'following',
  patient_tracking_state_id: 'state-41',
} as const;

function mockSuccessfulLoads() {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/api/conditions') return [];
    if (path === '/api/patients/me/problems') return [];
    if (path === '/api/patients/me/nhi-condition-drafts') return [{ ...nhiDraft }];
    throw new Error(`unexpected path: ${path}`);
  });
}

describe('ConditionsPage NHI disease management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuccessfulLoads();
  });

  it('shows the safe NHI section with all six tracking states and shared filters', async () => {
    render(<ConditionsPage />);

    expect(await screen.findByRole('heading', { name: '健保匯入／尚未醫療確認' })).toBeInTheDocument();
    const diagnosis = screen.getByText('高血壓');
    const card = diagnosis.closest('article');
    expect(card).not.toBeNull();
    expect(within(card!).getByText('健保匯入')).toBeInTheDocument();
    expect(within(card!).getByText('AI 整理')).toBeInTheDocument();
    expect(within(card!).getByText('尚未醫療確認')).toBeInTheDocument();
    expect(within(card!).queryByRole('button', { name: '修改' })).not.toBeInTheDocument();
    expect(within(card!).queryByRole('button', { name: '移除' })).not.toBeInTheDocument();

    const select = within(card!).getByRole('combobox', { name: /更新高血壓的個人追蹤狀況/ });
    expect(within(select).getAllByRole('option')).toHaveLength(7);
    expect(within(select).getByRole('option', { name: '我覺得已完成治療' })).toBeInTheDocument();
    expect(screen.getByText('健保匯入疾病').parentElement).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: '已完成／不用追蹤' }));
    expect(screen.queryByText('高血壓')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByText('高血壓')).toBeInTheDocument();
  });

  it('updates optimistically and restores the prior overlay through undo', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ reported_state: { id: 'state-41' } })
      .mockResolvedValueOnce({ id: 'state-41', reported_status: 'following' });
    render(<ConditionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '全部' }));
    const select = screen.getByRole('combobox', { name: /更新高血壓的個人追蹤狀況/ }) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'resolved_by_self_report' } });
    expect(select.value).toBe('resolved_by_self_report');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/patients/me/nhi-drafts/41/tracking-state',
      { tracking_state: 'resolved_by_self_report' },
    ));

    fireEvent.click(await screen.findByRole('button', { name: '復原上次變更' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/patients/me/patient-reported-states/state-41/restore-previous',
      {},
    ));
    await waitFor(() => expect((screen.getByRole('combobox', { name: /更新高血壓的個人追蹤狀況/ }) as HTMLSelectElement).value).toBe('following'));
  });

  it('rolls an optimistic tracking change back when the API rejects it', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('network failed'));
    render(<ConditionsPage />);
    const select = await screen.findByRole('combobox', { name: /更新高血壓的個人追蹤狀況/ }) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'actively_treating' } });
    expect(select.value).toBe('actively_treating');
    await waitFor(() => expect((screen.getByRole('combobox', { name: /更新高血壓的個人追蹤狀況/ }) as HTMLSelectElement).value).toBe('following'));
    expect(showToast).toHaveBeenCalledWith('追蹤狀況更新失敗，已恢復原本狀態', 'error');
  });

  it('announces an NHI load error and can retry without hiding the other sections', async () => {
    let failNhi = true;
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/conditions' || path === '/api/patients/me/problems') return [];
      if (path === '/api/patients/me/nhi-condition-drafts') {
        if (failNhi) throw new Error('offline');
        return [{ ...nhiDraft }];
      }
      throw new Error(`unexpected path: ${path}`);
    });
    render(<ConditionsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('健保匯入疾病讀取失敗');
    failNhi = false;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('高血壓')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
