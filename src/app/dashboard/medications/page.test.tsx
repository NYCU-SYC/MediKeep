import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MedicationsPage from './page';
import { api } from '@/lib/api';

const { showToast, refreshNow, setActiveMember, push, replace } = vi.hoisted(() => ({
  showToast: vi.fn(),
  refreshNow: vi.fn(),
  setActiveMember: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/medications',
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
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
    members: [{ name: '本人', relation: '本人' }],
    setActiveMember,
    canWriteMember: () => true,
    writeAccessReason: () => null,
  }),
}));

vi.mock('../toast-context', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/lib/sync', () => ({
  useSync: () => ({ viewVersions: {}, refreshNow }),
}));

const candidate = {
  fact_id: 'med-fact-1',
  kind: 'medication',
  profile_kind: 'medication',
  title: '降壓藥 A',
  summary: '門診處方摘要',
  evidence_summary: '2026-08-01 門診',
  date: '2026-08-01',
  facility: '安心診所',
  last_seen_at: '2026-08-02T09:20:00Z',
  encounter_ref: { id: 'encounter-private-med-1', date: '2026-08-01', member_name: '本人' },
  evidence_refs: [{ type: 'health_document', id: 'document-private-med-1', title: '門診用藥清單.pdf' }, { type: 'nhi_source_row', id: 'source-row-private-med-1' }],
  source_refs: [{ type: 'health_document', id: 'document-private-med-1', title: '門診用藥清單.pdf' }],
  member_name: '本人',
  source_label: '健保存摺',
  medication_state: 'unknown',
  eligible: true,
  can_save_to_profile: true,
  saved_to_profile: false,
  saved_target_id: null,
};

const ineligibleCandidate = {
  fact_id: 'med-fact-2',
  kind: 'medication',
  profile_kind: 'medication',
  title: '給藥事件',
  summary: '只代表曾經給藥',
  evidence_summary: '住院給藥紀錄',
  date: null,
  facility: '安心醫院',
  member_name: '本人',
  source_label: '健保存摺',
  medication_state: 'administered',
  eligible: false,
  can_save_to_profile: false,
  ineligible_reason: '給藥事件不能直接加入用藥清單',
  saved_to_profile: false,
  saved_target_id: null,
};

function mockBaseLoads() {
  vi.mocked(api.get).mockImplementation(async (path: string, params?: Record<string, string>) => {
    if (path === '/api/medications') return [];
    if (path === '/api/patients/me/profile-candidates') {
      if (params?.cursor === 'next-1') return { items: [], previous_cursor: null, next_cursor: null };
      return { items: [candidate, ineligibleCandidate], previous_cursor: null, next_cursor: 'next-1' };
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

describe('MedicationsPage User medication management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockBaseLoads();
  });

  it('requires an explicit usage status for every eligible NHI candidate and paginates safely', async () => {
    render(<MedicationsPage />);
    fireEvent.click(screen.getByText('從健保匯入找可加入的用藥'));
    expect(await screen.findByText('降壓藥 A')).toBeInTheDocument();
    expect(screen.getByText('來源狀態：不明')).toBeInTheDocument();
    expect(screen.getByText('不可加入：給藥事件不能直接加入用藥清單')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '選擇我的實際狀況' })).toHaveLength(1);
    const candidateCard = screen.getByText('降壓藥 A').closest('article');
    expect(candidateCard).not.toBeNull();
    const evidenceSummary = within(candidateCard!).getByText('查看證據');
    expect(evidenceSummary).toHaveStyle({ minHeight: '44px' });
    const evidenceDetails = evidenceSummary.closest('details');
    expect(evidenceDetails).not.toHaveAttribute('open');
    fireEvent.click(evidenceSummary);
    expect(evidenceDetails).toHaveAttribute('open');
    expect(within(candidateCard!).getByText('安心診所')).toBeInTheDocument();
    expect(within(candidateCard!).getByText('醫療文件：門診用藥清單.pdf')).toBeInTheDocument();
    expect(within(candidateCard!).getByText('健保存摺來源紀錄')).toBeInTheDocument();
    expect(within(candidateCard!).queryByText('encounter-private-med-1')).not.toBeInTheDocument();
    expect(within(candidateCard!).queryByText('document-private-med-1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('搜尋藥名或證據摘要'), { target: { value: '降壓' } });
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/patients/me/profile-candidates', expect.objectContaining({ q: '降壓', limit: '10' })));

    fireEvent.click(screen.getByRole('button', { name: '選擇我的實際狀況' }));
    expect(await screen.findByRole('dialog', { name: '你目前如何管理「降壓藥 A」？' })).toBeInTheDocument();
    expect(screen.getByLabelText('我不確定')).toBeChecked();
    expect(screen.queryByRole('button', { name: '加入並標記仍在使用' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('我正在吃'));
    fireEvent.click(screen.getByLabelText('我確認這是我目前對這筆用藥的管理狀況，之後可以再修改。'));
    fireEvent.click(screen.getByRole('button', { name: '儲存我的狀況' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/patients/me/profile-candidates/med-fact-1/confirm',
      { usage_status: 'taking' },
    ));
    expect(await screen.findByText('已在我的用藥')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/patients/me/profile-candidates', expect.objectContaining({ cursor: 'next-1', limit: '10' })));
  });

  it('uses a safety dialog instead of native confirm for self-stopped usage', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/medications') return [{
        id: 7, member_name: '本人', drug_name: '既有藥', frequency: '一天一次', intent: 'chronic', is_active: true,
        is_verified: false, is_published: false, patient_reported_usage_status: 'taking',
      }];
      throw new Error(`unexpected path: ${path}`);
    });
    vi.mocked(api.post).mockResolvedValue({ medication: { patient_reported_usage_status: 'self_stopped' } });
    render(<MedicationsPage />);
    const usage = await screen.findByRole('combobox', { name: '更新既有藥的目前實際用藥狀況' });
    fireEvent.change(usage, { target: { value: 'self_stopped' } });
    expect(await screen.findByRole('dialog', { name: '確認要儲存這個用藥狀況嗎？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認儲存' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/patients/me/medications/7/usage-state',
      { usage_status: 'self_stopped' },
    ));
  });

  it('opens the medication form as a focused dialog and returns focus to its trigger', async () => {
    render(<MedicationsPage />);
    const trigger = screen.getByRole('button', { name: '新增藥物' });
    fireEvent.click(trigger);
    const name = await screen.findByPlaceholderText('例：Norvasc、脈優');
    await waitFor(() => expect(document.activeElement).toBe(name));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('does not show an empty state when candidate loading fails', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/medications') return [];
      if (path === '/api/patients/me/profile-candidates') throw new Error('candidate offline');
      throw new Error(`unexpected path: ${path}`);
    });
    render(<MedicationsPage />);
    fireEvent.click(screen.getByText('從健保匯入找可加入的用藥'));
    expect(await screen.findByRole('alert')).toHaveTextContent('健保匯入用藥讀取失敗');
    expect(screen.queryByText('目前沒有符合條件的可加入用藥候選。')).not.toBeInTheDocument();
  });
});
