import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmergencyImagingPage from './page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'token-1', studyId: 'study-1' }),
}));

const study = {
  study: { id: 'study-1', study_description: '胸部電腦斷層', study_date: '20260812', modality: 'CT' },
  series: [{
    id: 'series-1',
    series_number: 1,
    series_description: '胸部軸向影像',
    modality: 'CT',
    body_part: 'CHEST',
    instance_count: 1,
    instances: [{ id: 'instance-1', instance_number: 1, rows: 512, columns: 512, window_center: 40, window_width: 400 }],
  }],
  expires_at: '2026-08-12T12:00:00Z',
};

describe('EmergencyImagingPage accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/emergency/token-1/imaging/study-1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => study }));
  });

  it('labels the access gate and viewer controls with one main heading per view', async () => {
    render(<EmergencyImagingPage />);

    expect(await screen.findByRole('heading', { level: 1, name: '檢視限時醫療影像' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    fireEvent.change(screen.getByRole('textbox', { name: '您的姓名（必填）' }), { target: { value: '王醫師' } });
    fireEvent.click(screen.getByRole('button', { name: '檢視影像' }));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '胸部電腦斷層' })).toBeInTheDocument());
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('slider', { name: '影像亮度（窗位）' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '影像對比（窗寬）' })).toBeInTheDocument();
    expect(screen.queryByText(/\bWC\b|\bWW\b/)).not.toBeInTheDocument();
  });
});
