import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublicViewerPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ token: 'share-token' }) }));

const series = {
  id: 'series-1',
  series_number: 1,
  series_description: '胸部影像',
  modality: 'CT',
  body_part: 'CHEST',
  instance_count: 0,
  storage_available: false,
  instances: [],
};

describe('public DICOM viewer landmarks', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one main landmark and h1 while loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container, unmount } = render(<PublicViewerPage />);
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { level: 1, name: '正在載入分享影像' })).toBeInTheDocument();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    unmount();
  });

  it('renders an error icon and one clear h1 when a public link is invalid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      headers: { get: () => null },
    }));
    const { container } = render(<PublicViewerPage />);
    expect(await screen.findByRole('heading', { level: 1, name: '無法開啟分享影像' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('此分享連結已過期或已被撤銷');
    expect(container.querySelector('svg.lucide-triangle-alert')).toBeInTheDocument();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it.each([
    {
      label: 'study',
      heading: '胸部電腦斷層',
      payload: {
        share_id: 'share-1',
        share_type: 'study',
        expires_at: null,
        study: {
          id: 'study-1',
          member_name: '本人',
          study_date: '20260812',
          study_description: '胸部電腦斷層',
          modality: 'CT',
          series: [series],
        },
      },
    },
    {
      label: 'series',
      heading: '胸部影像',
      payload: {
        share_id: 'share-2',
        share_type: 'series',
        expires_at: null,
        series,
      },
    },
  ])('keeps exactly one main and h1 for a $label share', async ({ heading, payload }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    const { container } = render(<PublicViewerPage />);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('svg.lucide-scan-line')).toBeInTheDocument();
  });
});
