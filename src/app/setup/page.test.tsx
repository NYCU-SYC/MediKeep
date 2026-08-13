import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SetupPage from './page';

const replace = vi.fn();
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/lib/api', () => ({
  setPatientSessionToken: vi.fn(),
  api: { get: apiGet },
  ApiError: class ApiError extends Error {
    status = 500;
    retryAfter = null;
  },
}));

describe('setup family invite deep link', () => {
  it('prefills and previews an eight-character code without joining automatically', async () => {
    window.history.replaceState({}, '', '/setup?mode=join&code=ab12cd34&next=%2Fdashboard%2Freminders%3Fhighlight%3Dfollowup-1');
    apiGet.mockResolvedValue({ authenticated: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ family_name: '測試家庭', join_code: 'AB12CD34', member_count: 2, requires_confirmation: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SetupPage />);
    expect(await screen.findByDisplayValue('AB12CD34')).toBeInTheDocument();
    expect(await screen.findByText('測試家庭')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /確認加入此家庭/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/auth/join/preview?join_code=AB12CD34'), { credentials: 'include' });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/join', expect.anything());
    expect(apiGet).toHaveBeenCalledWith('/api/auth/me');
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: /確認加入此家庭/ })).not.toBeDisabled());
  });

  it('uses one main heading per step and exposes the color chooser as named 44px buttons', async () => {
    window.history.replaceState({}, '', '/setup?next=%2Fdashboard');
    apiGet.mockResolvedValue({ authenticated: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ family_id: 'family-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<SetupPage />);
    expect(await screen.findByRole('heading', { level: 1, name: '設定您的家庭' })).toBeInTheDocument();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);

    fireEvent.click(screen.getByRole('checkbox', { name: /我確認要建立一個新的獨立家庭/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步：新增成員/ }));

    expect(await screen.findByRole('heading', { level: 1, name: '新增家庭成員' })).toBeInTheDocument();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '自訂' }));
    const defaultColor = screen.getByRole('button', { name: '選擇藍灰色' });
    const purple = screen.getByRole('button', { name: '選擇紫色' });
    expect(defaultColor.tagName).toBe('BUTTON');
    expect(defaultColor).toHaveAttribute('aria-pressed', 'true');
    expect(defaultColor).toHaveStyle({ width: '44px', height: '44px' });
    purple.focus();
    expect(purple).toHaveFocus();
    fireEvent.click(purple);
    expect(defaultColor).toHaveAttribute('aria-pressed', 'false');
    expect(purple).toHaveAttribute('aria-pressed', 'true');
  });
});
