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
    canWriteMember: () => true,
    writeAccessReason: () => null,
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
    if (path === '/api/patients/me/nhi-health-facts') return [];
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
      if (path === '/api/patients/me/nhi-health-facts') return [];
      throw new Error(`unexpected path: ${path}`);
    });
    render(<ConditionsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('健保匯入疾病讀取失敗');
    failNhi = false;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('高血壓')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('searches paginated clinical candidates and saves an eligible condition explicitly', async () => {
    let saved = false;
    vi.mocked(api.get).mockImplementation(async (path: string, params?: Record<string, string>) => {
      if (path === '/api/conditions') return [];
      if (path === '/api/patients/me/problems') return [];
      if (path === '/api/patients/me/nhi-condition-drafts') return [];
      if (path === '/api/patients/me/profile-candidates') {
        if (params?.cursor === 'next-1') return {
          items: [{
            fact_id: 'fact-j45', kind: 'condition', profile_kind: 'condition', clinical_kind: 'condition', title: '第二頁病況', summary: '第二頁證據',
            evidence_summary: '第二頁證據', member_name: '本人', source_label: '健保存摺', eligible: true, can_save_to_profile: true,
            saved_to_profile: false, medication_state: null,
          }], previous_cursor: null, next_cursor: null,
        };
        return {
          items: [{
            fact_id: 'fact-j30', kind: 'condition', profile_kind: 'condition', clinical_kind: 'condition', title: '過敏性鼻炎', summary: 'J30',
            evidence_summary: '門診診斷摘要', date: '2026-04-02', facility: '健康診所', member_name: '本人', source_label: '健保存摺',
            last_seen_at: '2026-04-03T08:30:00Z', encounter_ref: { id: 'encounter-private-j30', date: '2026-04-02', member_name: '本人' },
            evidence_refs: [{ type: 'health_document', id: 'document-private-j30', title: '門診診斷證明.pdf' }, { type: 'nhi_source_row', id: 'source-row-private-j30' }],
            source_refs: [{ type: 'health_document', id: 'document-private-j30', title: '門診診斷證明.pdf' }],
            eligible: true, can_save_to_profile: true, saved_to_profile: saved, saved_target_id: saved ? 12 : null, medication_state: null,
          }, {
            fact_id: 'fact-test', kind: 'condition', profile_kind: 'condition', clinical_kind: 'lab', title: '血液檢查結果', summary: '這不是病況',
            evidence_summary: '檢驗報告', member_name: '本人', source_label: '健保存摺', eligible: false, can_save_to_profile: false,
            ineligible_reason: '檢查結果不可加入病況', saved_to_profile: false, medication_state: null,
          }], previous_cursor: null, next_cursor: 'next-1',
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });
    vi.mocked(api.post).mockImplementation(async () => {
      saved = true;
      return { created: true, target_type: 'condition', target_id: 12 };
    });
    render(<ConditionsPage />);

    fireEvent.click(screen.getByText('從健保匯入找可加入的病況'));
    expect(await screen.findByText('過敏性鼻炎')).toBeInTheDocument();
    expect(screen.getByText('血液檢查結果')).toBeInTheDocument();
    expect(screen.getByText('不可加入：檢查結果不可加入病況')).toBeInTheDocument();
    const candidateCard = screen.getByText('過敏性鼻炎').closest('article');
    expect(candidateCard).not.toBeNull();
    const evidenceSummary = within(candidateCard!).getByText('查看證據');
    expect(evidenceSummary).toHaveStyle({ minHeight: '44px' });
    const evidenceDetails = evidenceSummary.closest('details');
    expect(evidenceDetails).not.toHaveAttribute('open');
    fireEvent.click(evidenceSummary);
    expect(evidenceDetails).toHaveAttribute('open');
    expect(within(candidateCard!).getByText('最近就醫日期')).toBeInTheDocument();
    expect(within(candidateCard!).getByText('健康診所')).toBeInTheDocument();
    expect(within(candidateCard!).getByText('醫療文件：門診診斷證明.pdf')).toBeInTheDocument();
    expect(within(candidateCard!).getByText('健保存摺來源紀錄')).toBeInTheDocument();
    expect(within(candidateCard!).queryByText('encounter-private-j30')).not.toBeInTheDocument();
    expect(within(candidateCard!).queryByText('document-private-j30')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('搜尋疾病名稱或證據摘要'), { target: { value: '過敏' } });
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/patients/me/profile-candidates', expect.objectContaining({ q: '過敏', limit: '10' })));
    const add = screen.getByRole('button', { name: '確認狀態後加入' });
    fireEvent.click(add);
    expect(api.post).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: '確認目前病況狀態' });
    const status = within(dialog).getByRole('combobox', { name: '這個病況目前的狀態' });
    const confirm = within(dialog).getByRole('button', { name: '確認並加入' });
    expect(status).toHaveValue('');
    expect(confirm).toBeDisabled();
    await waitFor(() => expect(document.activeElement).toBe(status));
    fireEvent.change(status, { target: { value: 'active' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/patients/me/profile-candidates/fact-j30/confirm',
      { status: 'active' },
    ));
    expect(await screen.findByText('已在我的病況')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    expect(await screen.findByText('第二頁病況')).toBeInTheDocument();
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/patients/me/profile-candidates', expect.objectContaining({ limit: '10', cursor: 'next-1' }));
  });

  it('opens the condition form as a focused dialog and returns focus to the trigger', async () => {
    render(<ConditionsPage />);
    const trigger = screen.getByRole('button', { name: '新增我的病況' });
    fireEvent.click(trigger);
    const field = await screen.findByPlaceholderText('例：最近容易頭暈');
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('reuses the same create key when saving a condition is retried', async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error('connection lost after send'))
      .mockResolvedValueOnce({
        id: 72,
        member_name: '本人',
        display_name: '最近容易頭暈',
        status: 'active',
        source: 'patient_created',
        is_patient_managed: true,
        is_verified: false,
        is_published: false,
      });
    render(<ConditionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '新增我的病況' }));
    fireEvent.change(screen.getByPlaceholderText('例：最近容易頭暈'), {
      target: { value: '最近容易頭暈' },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存我的病況' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: '儲存我的病況' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '儲存我的病況' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    const firstOptions = vi.mocked(api.post).mock.calls[0][2];
    const secondOptions = vi.mocked(api.post).mock.calls[1][2];
    expect(firstOptions?.idempotencyKey).toMatch(/^condition-create-/);
    expect(secondOptions?.idempotencyKey).toBe(firstOptions?.idempotencyKey);
  });

  it('keeps candidate API errors separate from an empty candidate state', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/conditions' || path === '/api/patients/me/problems' || path === '/api/patients/me/nhi-condition-drafts') return [];
      if (path === '/api/patients/me/profile-candidates') throw new Error('candidate offline');
      throw new Error(`unexpected path: ${path}`);
    });
    render(<ConditionsPage />);
    fireEvent.click(screen.getByText('從健保匯入找可加入的病況'));
    expect(await screen.findByRole('alert')).toHaveTextContent('可加入的健保疾病讀取失敗');
    expect(screen.queryByText('目前沒有符合條件的臨床病況候選。')).not.toBeInTheDocument();
  });
});
