import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeDataState } from './_components/Shared';
import DashboardPage from './page';

const dashboardMocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  syncVersion: 0,
  failRefresh: false,
  members: [{ id: 'member-1', name: '王小明', relation: '本人', color: '#456' }],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('member=%E7%8E%8B%E5%B0%8F%E6%98%8E'),
}));
vi.mock('./member-context', () => ({
  useActiveMember: () => ({
    activeMember: '王小明',
    setActiveMember: vi.fn(),
    members: dashboardMocks.members,
    membersLoading: false,
    membersError: null,
  }),
}));
vi.mock('@/lib/sync', () => ({
  useSync: () => ({ version: dashboardMocks.syncVersion }),
}));
vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => dashboardMocks.apiGet(...args) },
}));
vi.mock('@/components/NhiReminderCard', () => ({ default: () => null }));

describe('dashboard home data states', () => {
  it('shows loading without pretending that empty is ready', () => {
    render(<HomeDataState state="loading" onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在整理你的健康全貌');
  });

  it('shows a retryable full error', () => {
    const onRetry = vi.fn();
    render(<HomeDataState state="error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps available sections visible in a partial state', () => {
    const onRetry = vi.fn();
    render(<HomeDataState state="partial" onRetry={onRetry}><div>已取得的健康資料</div></HomeDataState>);
    expect(screen.getByText('已取得的健康資料')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('retains successful medication and measurement snapshots when a refresh partially fails', async () => {
    dashboardMocks.syncVersion = 0;
    dashboardMocks.failRefresh = false;
    dashboardMocks.apiGet.mockImplementation(async (path: string) => {
      if (dashboardMocks.failRefresh && (path === '/api/records' || path === '/api/medications')) {
        throw new Error('temporary network failure');
      }
      if (path === '/api/records') {
        return [{ id: 'record-1', member_name: '王小明', record_type: 'blood_pressure', value1: '120', value2: '80', unit: 'mmHg', note: null, recorded_at: '2026-08-12T08:00:00Z' }];
      }
      if (path === '/api/medications') {
        return [{ id: 1, drug_name: '安全保留藥物', is_published: true, status: 'active', member_name: '王小明' }];
      }
      if (path === '/api/patients/me/problems/summary') return { total: 0, active_count: 0, resolved_count: 0, last_verified_at: null, top_problems: [] };
      if (path === '/api/patients/me/sync-state') return { counts: {} };
      if (path === '/api/patients/me/recommendations/latest') return null;
      if (path === '/api/patients/me/emergency-readiness') return { counts: { core_total: 6, available_total: 2 }, warnings: [] };
      return [];
    });

    const view = render(<DashboardPage />);
    expect(await screen.findByText('安全保留藥物')).toBeInTheDocument();
    expect(screen.getByText('120/80 mmHg')).toBeInTheDocument();

    dashboardMocks.failRefresh = true;
    dashboardMocks.syncVersion = 1;
    view.rerender(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('部分資料尚未載入')).toBeInTheDocument());
    expect(screen.getByText('安全保留藥物')).toBeInTheDocument();
    expect(screen.getByText('120/80 mmHg')).toBeInTheDocument();
    expect(screen.queryByText('目前沒有量測紀錄。')).not.toBeInTheDocument();
    expect(screen.queryByText('目前沒有醫療團隊發布的用藥摘要。')).not.toBeInTheDocument();
  });
});
