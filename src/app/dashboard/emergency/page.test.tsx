import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmergencyPage from './page';
import { api } from '@/lib/api';

const { push, setActiveMember, showToast } = vi.hoisted(() => ({
  push: vi.fn(),
  setActiveMember: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../toast-context', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../member-context', () => ({
  useActiveMember: () => ({
    activeMember: '王小明',
    members: [
      { id: 'member-self', name: '王小明', relation: 'self', color: '#3e6b7e' },
      { id: 'member-owner', name: '家庭窗口', relation: 'Owner', color: '#2e8b57' },
      { id: 'member-cmo', name: '醫療窗口', relation: 'CMO', color: '#a97614' },
      { id: 'member-unknown', name: '其他成員', relation: 'backend_relation_v2', color: '#607d8b' },
    ],
    setActiveMember,
  }),
}));

vi.mock('../redzone/page', () => ({
  default: () => <div>急診重要資料</div>,
}));

describe('EmergencyPage member relation labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/patients/me/emergency-links') return { links: [], accesses: [] };
      if (path === '/api/patients/me/emergency-readiness') {
        return {
          member: { id: 'member-self', name: '王小明', relation: 'self' },
          counts: { core_total: 0, available_total: 0 },
          can_write: true,
          creatable: false,
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });
  });

  it('humanizes self, Owner, and CMO while hiding unknown backend relation values', async () => {
    render(<EmergencyPage />);

    expect(await screen.findByRole('button', { name: '王小明 · 本人' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '家庭窗口 · 家庭管理者' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '醫療窗口 · 醫療團隊' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '其他成員 · 家庭成員' })).toBeInTheDocument();
    expect(screen.getByText('目前指定：王小明（本人）')).toBeInTheDocument();

    const visibleText = document.body.textContent ?? '';
    expect(visibleText).not.toContain('self');
    expect(visibleText).not.toContain('Owner');
    expect(visibleText).not.toContain('CMO');
    expect(visibleText).not.toContain('backend_relation_v2');
  });

  it('keeps the last successful emergency links when refresh fails', async () => {
    let failLinkRefresh = false;
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/patients/me/emergency-links') {
        if (failLinkRefresh) throw new Error('temporary link refresh failure');
        return {
          links: [{
            id: 'link-1', token: 'safe-token', url: 'https://example.test/emergency/safe-token', label: '保留的急診連結',
            scope: 'red_zone,problems,medications,vitals', expires_at: '2026-08-13T00:00:00Z', revoked_at: null,
            active: true, access_count: 0, last_accessed_at: null, created_at: '2026-08-12T00:00:00Z',
          }],
          accesses: [],
        };
      }
      if (path === '/api/patients/me/emergency-readiness') {
        return { member: { id: 'member-self', name: '王小明', relation: 'self' }, counts: { core_total: 1, available_total: 1 }, can_write: true, creatable: true };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    render(<EmergencyPage />);
    expect(await screen.findByText('保留的急診連結')).toBeInTheDocument();
    failLinkRefresh = true;
    fireEvent.click(screen.getByRole('button', { name: '重新整理連結' }));

    await waitFor(() => expect(screen.getByText(/以下保留上次成功載入的連結與存取紀錄/)).toBeInTheDocument());
    expect(screen.getByText('保留的急診連結')).toBeInTheDocument();
    expect(screen.queryByText('目前沒有有效連結。需要時按上方「產生連結」。')).not.toBeInTheDocument();
  });
});
