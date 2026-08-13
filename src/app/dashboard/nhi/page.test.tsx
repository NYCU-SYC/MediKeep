import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NhiImportPage from './page';
import { api } from '@/lib/api';

const setActiveMember = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../member-context', () => ({
  useActiveMember: () => ({
    activeMember: '本人',
    setActiveMember,
    members: [{ id: 'self', name: '本人' }],
  }),
}));

vi.mock('../toast-context', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/lib/sync', () => ({
  useSync: () => ({ viewVersions: {}, refreshNow: vi.fn() }),
}));

function item(index: number) {
  return {
    id: index,
    member_name: '本人',
    section: 'outpatient',
    raw_label: `原始分類-${index}`,
    date: `2026-08-${String(index).padStart(2, '0')}`,
    visit_date: `2026-08-${String(index).padStart(2, '0')}`,
    facility: `安心診所 ${index}`,
    hospital: null,
    department: '家醫科',
    diagnosis: `病況 ${index}`,
    icd10: index === 1 ? 'I10' : null,
    key_medications: null,
    lab_total_items: null,
    review_status: 'pending',
    review_status_label: '待整理',
    publish_status: 'not_published',
    publish_status_label: '尚未發布',
    official_layer: { status: 'pending', label: '等待醫療團隊整理', linked_object: null },
    published_layer: { status: 'not_published', label: '尚未發布', object: null },
    linked_official_object: null,
    related_problem: null,
    patient_visible_note: null,
    source_document_id: index === 1 ? 'document-technical-id' : null,
    source_document: null,
    available_actions: [],
    created_at: null,
    patient_tracking_state: null,
    patient_tracking_state_id: null,
  };
}

function mockOverviewAndItems(rows = Array.from({ length: 12 }, (_, index) => item(index + 1))) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/api/patients/me/nhi-imports') {
      return {
        has_data: true,
        summary: { total: rows.length, organised: 0, pending: rows.length, not_used: 0, latest_visit_date: '2026-08-12' },
        sections: [{ key: 'outpatient', label: '門診紀錄', total: rows.length, organised: 0, pending: rows.length, not_used: 0, latest_visit_date: '2026-08-12' }],
      };
    }
    if (path === '/api/patients/me/nhi-imports/outpatient') return { section: 'outpatient', count: rows.length, items: rows };
    throw new Error(`unexpected path: ${path}`);
  });
}

describe('NhiImportPage bounded records list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOverviewAndItems();
  });

  it('requests ten rows, caps legacy responses, supports search, and pages without an unbounded map', async () => {
    render(<NhiImportPage />);

    expect(await screen.findByText('病況 1')).toBeInTheDocument();
    expect(screen.getByText('病況 10')).toBeInTheDocument();
    expect(screen.queryByText('病況 11')).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      '/api/patients/me/nhi-imports/outpatient',
      expect.objectContaining({ member: '本人', page: '1', page_size: '10' }),
    ));

    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    expect(await screen.findByText('病況 11')).toBeInTheDocument();
    expect(screen.getByText('病況 12')).toBeInTheDocument();
    expect(screen.queryByText('病況 1')).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      '/api/patients/me/nhi-imports/outpatient',
      expect.objectContaining({ page: '2', page_size: '10' }),
    ));

    fireEvent.change(screen.getByPlaceholderText('搜尋疾病、院所或用藥'), { target: { value: '病況 12' } });
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    expect(await screen.findByText('病況 12')).toBeInTheDocument();
    expect(screen.queryByText('病況 11')).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      '/api/patients/me/nhi-imports/outpatient',
      expect.objectContaining({ page: '1', page_size: '10', search: '病況 12' }),
    ));
  });

  it('keeps codes inside professional details and gives every record control a 44px target', async () => {
    mockOverviewAndItems([item(1)]);
    render(<NhiImportPage />);

    const diagnosis = await screen.findByText('病況 1');
    const card = diagnosis.closest('div[style*="border: 1px solid"]') ?? diagnosis.parentElement?.parentElement;
    expect(card).not.toBeNull();
    expect(screen.queryByText('I10')).not.toBeInTheDocument();

    const sectionButton = screen.getByRole('button', { name: /門診紀錄/ });
    expect(sectionButton).toHaveStyle({ minHeight: '44px' });
    const detailsButton = screen.getByRole('button', { name: '查看整理狀態與來源' });
    expect(detailsButton).toHaveStyle({ minHeight: '44px' });
    expect(screen.getByRole('combobox', { name: /更新病況 1的個人追蹤狀況/ })).toHaveStyle({ minHeight: '44px' });

    fireEvent.click(detailsButton);
    const professional = screen.getByText('專業詳細資訊').closest('details');
    expect(professional).not.toBeNull();
    expect(within(professional!).getByText('I10')).toBeInTheDocument();
    expect(within(professional!).getByText('原始分類-1')).toBeInTheDocument();
    expect(within(professional!).getByText('document-technical-id')).toBeInTheDocument();
  });
});
