import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './page';
import { api } from '@/lib/api';

const { push, replace, showToast, setMembers, setActiveMember, setMembersError } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  showToast: vi.fn(),
  setMembers: vi.fn(),
  setActiveMember: vi.fn(),
  setMembersError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 500;
    code = 'request_failed';
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  setPatientSessionToken: vi.fn(),
}));

vi.mock('../member-context', () => ({
  useActiveMember: () => ({
    activeMember: '本人',
    members: [{ id: 'member-1', name: '本人', relation: 'self', age: 40, gender: '男', color: '#2196f3' }],
    membersLoading: false,
    membersError: false,
    setMembers,
    setActiveMember,
    setMembersError,
  }),
}));

vi.mock('../toast-context', () => ({
  useToast: () => ({ showToast }),
}));

const familyInfo = {
  family_name: '安心家庭',
  join_code: 'ABC123',
  join_code_status: 'active',
  role: 'owner',
  health_data_scope: 'family',
  permissions: {
    can_view_family_health_data: true,
    can_edit_patient_reported_data: true,
    can_manage_family_members: true,
    can_manage_member_access: true,
    can_manage_join_code: true,
    can_rename_family: true,
    can_leave_family: false,
    can_reset_empty_family: false,
  },
};

function mockLoads({ failRequests = false }: { failRequests?: boolean } = {}) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/api/auth/family') return familyInfo;
    if (path === '/api/auth/family/access') {
      return {
        preview_token: 'access-preview-token',
        members: [{ id: 'member-1', name: '本人', relation: 'self' }],
        identities: [
          { id: 'identity-1', display_name: '主要帳號', role: 'owner', health_data_scope: 'family', is_current: true },
          { id: 'identity-2', display_name: '家人帳號', role: 'member', health_data_scope: 'none', is_current: false },
        ],
      };
    }
    if (path === '/api/patients/me/change-requests') {
      if (failRequests) throw new Error('offline');
      return [];
    }
    throw new Error(`unexpected path: ${path}`);
  });
  vi.mocked(api.post).mockImplementation(async (path: string) => {
    if (path === '/api/auth/family/access/identity-2/impact-preview') {
      return {
        preview_token: 'access-preview-token',
        action: 'change_family_write_scope',
        identity_id: 'identity-2',
        display_name: '家人帳號',
        current_scope: 'none',
        current_scope_label: '僅查看，不可新增或修改',
        current_member_id: null,
        current_member_name: null,
        proposed_scope: 'family',
        proposed_scope_label: '可編輯全家庭回報資料',
        proposed_member_id: null,
        proposed_member_name: null,
        family_read_access_unchanged: true,
        clinical_records_changed: false,
        reversible_by_family_manager: true,
        next_action: 'confirm_or_cancel',
      };
    }
    if (path === '/api/members/member-1/impact-preview') {
      return {
        preview_token: 'member-preview-token',
        action: 'remove_family_member',
        member_id: 'member-1',
        member_name: '本人',
        health_records_deleted: false,
        health_records_retained: 3,
        retained_record_counts: { measurements: 2, documents: 1 },
        retained_record_labels: { measurements: '量測', documents: '文件' },
        name_keyed_record_counts: { measurements: 2, documents: 1 },
        stable_id_record_counts: { emergency_links: 1 },
        affected_login_identities: [{
          id: 'identity-2',
          display_name: '家人帳號',
          role: 'member',
          current_scope: 'member',
          scope_after_removal: 'none',
          scope_after_removal_label: '僅查看，不可新增或修改',
        }],
        login_scope_after_removal: 'role_dependent',
        directory_entry_recoverable: false,
        stable_identity_reserved: true,
        next_action: 'confirm_or_cancel',
      };
    }
    throw new Error(`unexpected path: ${path}`);
  });
  vi.mocked(api.patch).mockResolvedValue({
    members: [{ id: 'member-1', name: '本人', relation: '本人' }],
    identities: [
      { id: 'identity-1', display_name: '主要帳號', role: 'owner', health_data_scope: 'family', is_current: true },
      { id: 'identity-2', display_name: '家人帳號', role: 'member', health_data_scope: 'family', is_current: false },
    ],
  });
}

describe('SettingsPage user-facing safety and accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoads();
  });

  it('uses plain-language sections and does not expose unfinished notification controls', async () => {
    render(<SettingsPage />);

    expect(await screen.findByRole('heading', { level: 1, name: '家庭與帳號' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '家庭' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '權限' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '通知與資料異動' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '帳號' })).toBeInTheDocument();
    expect(await screen.findByText('家庭管理者', { selector: 'div' })).toBeInTheDocument();
    expect(screen.queryByText(/Owner|Joined member|CMO|self/)).not.toBeInTheDocument();
    expect(screen.getByText(/目前沒有可儲存的開關/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.getByLabelText('關係')).toHaveValue('本人');
  });

  it('shows a real load error instead of an empty history state', async () => {
    mockLoads({ failRequests: true });
    render(<SettingsPage />);

    expect(await screen.findByText('暫時無法載入異動紀錄')).toBeInTheDocument();
    expect(screen.queryByText(/尚無資料異動紀錄/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新載入' })).toBeInTheDocument();
  });

  it('reuses the same create key after an ambiguous member-create failure', async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error('connection lost after send'))
      .mockResolvedValueOnce({
        id: 'member-2',
        name: '媽媽',
        relation: '母親',
        age: 66,
        gender: '女',
        color: '#f44336',
        sort_order: 1,
        created_at: '2026-08-12T12:00:00',
      });
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /新增家庭成員/ }));
    fireEvent.change(screen.getByLabelText('稱謂'), { target: { value: '媽媽' } });
    fireEvent.change(screen.getByLabelText('關係'), { target: { value: '母親' } });
    fireEvent.change(screen.getByLabelText('年齡（選填）'), { target: { value: '66' } });
    fireEvent.change(screen.getByLabelText('性別'), { target: { value: '女' } });

    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: '新增' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    const firstOptions = vi.mocked(api.post).mock.calls[0][2];
    const secondOptions = vi.mocked(api.post).mock.calls[1][2];
    expect(firstOptions?.idempotencyKey).toMatch(/^family-member-create-/);
    expect(secondOptions?.idempotencyKey).toBe(firstOptions?.idempotencyKey);
  });

  it('previews a permission change before saving its impact', async () => {
    render(<SettingsPage />);
    const scopeSelects = await screen.findAllByRole('combobox', { name: '可修改的健康資料範圍' });

    fireEvent.change(scopeSelects[1], { target: { value: 'family' } });
    const dialog = screen.getByRole('dialog', { name: '確認健康資料編輯權限' });
    expect(await within(dialog).findByText('伺服器確認的變更影響')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('所有同家庭成員仍可查看');
    expect(dialog).toHaveTextContent('可編輯全家庭回報資料');
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '確認變更' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      '/api/auth/family/access/identity-2',
      { health_data_scope: 'family', family_member_id: null },
      { headers: { 'X-Impact-Preview-Token': 'access-preview-token' } },
    ));
  });

  it('confirms member removal in a focus-trapped dialog and returns focus on Escape', async () => {
    render(<SettingsPage />);
    const removeButton = await screen.findByRole('button', { name: '移除' });

    removeButton.focus();
    fireEvent.click(removeButton);
    const dialog = screen.getByRole('dialog', { name: '移除「本人」？' });
    expect(await within(dialog).findByText('伺服器確認的影響範圍')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('既有健康紀錄不會刪除，共有 3 筆會保留');
    expect(dialog).toHaveTextContent('保留類型：量測、文件');
    expect(dialog).toHaveTextContent('受影響登入身份：家人帳號（僅查看，不可新增或修改）');
    expect(dialog).toHaveTextContent('不能用重新新增的方式接回舊資料');
    expect(dialog).toHaveTextContent('這個名稱會保留');
    expect(api.delete).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '移除「本人」？' })).not.toBeInTheDocument());
    await waitFor(() => expect(removeButton).toHaveFocus());
  });

  it('sends the current signed impact preview when removal is confirmed', async () => {
    vi.mocked(api.delete).mockResolvedValue({
      ok: true,
      member_id: 'member-1',
      recoverable: false,
      health_records_deleted: false,
      health_records_retained: 3,
      stable_identity_reserved: true,
    });
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '移除' }));
    const dialog = screen.getByRole('dialog', { name: '移除「本人」？' });
    await within(dialog).findByText('伺服器確認的影響範圍');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認移除' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(
      '/api/members/member-1',
      { headers: { 'X-Impact-Preview-Token': 'member-preview-token' } },
    ));
    expect(showToast).toHaveBeenCalledWith('已移除 本人', 'info');
  });
});
