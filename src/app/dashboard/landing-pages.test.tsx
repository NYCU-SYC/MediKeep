import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthLandingPage from './health/page';
import RecordsLandingPage from './records/page';
import TasksLandingPage from './tasks/page';
import MoreLandingPage from './more/page';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('./member-context', () => ({
  useActiveMember: () => ({ activeMember: '', setActiveMember: vi.fn(), members: [] }),
}));

const apiGet = vi.fn<(path: unknown, params?: unknown) => Promise<unknown>>();

vi.mock('@/lib/api', () => ({
  api: {
    get: (path: unknown, params?: unknown) => apiGet(path, params),
  },
}));

describe('five-entry task landings', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue([]);
  });

  it('consolidates self-managed and confirmed health content without collapsing source and confirmation', async () => {
    apiGet.mockImplementation((path: unknown) => {
      if (path === '/api/conditions') return Promise.resolve([
        { id: 1, display_name: '氣喘', source: 'patient_created', is_patient_managed: true, is_verified: false },
        { id: 2, display_name: '高血壓', source: 'document', is_verified: true },
      ]);
      if (path === '/api/medications') return Promise.resolve([
        { id: 3, drug_name: '血壓藥', source: 'cmo_created', is_verified: true, is_published: true },
      ]);
      if (path === '/api/patients/me/recommendations/latest') return Promise.resolve({
        id: 'rec-1',
        title: 'CMO 最新 raw 摘要',
        health_summary: '整體狀況穩定',
        recommendation: '依 CMO 建議追蹤',
        next_step: '回診時攜帶量測紀錄',
        published_at: '2026-08-12T08:00:00Z',
      });
      return Promise.resolve([]);
    });
    render(<HealthLandingPage />);
    expect(screen.getByRole('heading', { name: '健康' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('氣喘')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: '我目前管理的內容' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '醫療團隊已確認' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '醫療團隊最新整理' })).toBeInTheDocument();
    expect(screen.getByText('醫療團隊 最新 原始資料 摘要')).toBeInTheDocument();
    expect(screen.queryByText(/\bCMO\b|\braw\b/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /急診資訊/ })).toHaveAttribute('href', '/dashboard/emergency');
    expect(screen.getAllByText('來源：文件整理').length).toBeGreaterThan(0);
    expect(screen.getAllByText('醫療團隊已確認').length).toBeGreaterThan(0);
    expect(screen.getByText(/健保匯入或文件整理不會自動等於已確認/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('exposes record tasks and existing worker routes', () => {
    render(<RecordsLandingPage />);
    expect(screen.getByRole('heading', { name: '紀錄' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /量測與健康事件/ })).toHaveAttribute('href', '/dashboard/history');
    expect(screen.getByRole('link', { name: /上傳資料/ })).toHaveAttribute('href', '/dashboard/upload');
    expect(screen.getByRole('link', { name: /健保資料/ })).toHaveAttribute('href', '/dashboard/nhi');
    expect(screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/dashboard/history')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /操作紀錄/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('exposes task groups with count links after the read-only GET summary resolves', async () => {
    render(<TasksLandingPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '待辦' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /我的提醒/ })).toHaveAttribute('href', '/dashboard/reminders');
    expect(screen.getByRole('link', { name: /醫療團隊交辦/ })).toHaveAttribute('href', '/dashboard/reminders');
    expect(screen.getByRole('link', { name: /補資料/ })).toHaveAttribute('href', '/dashboard/reminders');
  });

  it('retains successful task counts when the next partial retry fails that resource', async () => {
    let round = 0;
    apiGet.mockImplementation((path: unknown) => {
      if (path === '/api/patients/me/reminders') {
        round += 1;
        return round === 1
          ? Promise.resolve([{ status: 'pending' }, { status: 'pending' }])
          : Promise.reject(new Error('reminders temporarily unavailable'));
      }
      if (path === '/api/patients/me/follow-ups') {
        return round === 1 ? Promise.reject(new Error('follow-ups unavailable')) : Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    render(<TasksLandingPage />);
    expect(await screen.findByText('2 件待處理')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(6));
    expect(screen.getByText('2 件待處理')).toBeInTheDocument();
    expect(screen.queryByText('尚未取得')).not.toBeInTheDocument();
  });

  it('keeps more actions grouped and does not expose an unfinished notification control', () => {
    render(<MoreLandingPage />);
    expect(screen.getByRole('heading', { name: '更多' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /家庭與權限/ }).some((link) => link.getAttribute('href') === '/dashboard/settings')).toBe(true);
    expect(screen.getByRole('link', { name: /分享管理/ })).toHaveAttribute('href', '/dashboard/imaging/shares');
    expect(screen.getByText(/通知偏好控制尚未提供完整操作流程/)).toBeInTheDocument();
  });
});
