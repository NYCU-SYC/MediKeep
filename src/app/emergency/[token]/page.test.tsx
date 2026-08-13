import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmergencyBoardPage from './page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'token-1' }),
}));

const board = {
  patient: { name: '王小明', age: 72, sex: '男' },
  generated_at: '2026-08-12T08:00:00Z',
  access: {
    scope: 'emergency', expires_at: '2026-08-12T12:00:00Z', accessed_by: '王醫師', accessor_org: '急診', read_only: true,
  },
  red_zone: {
    tiers: {
      tier1: [{ id: 'rz-1', label: '嚴重過敏', value: '青黴素', tier: 1, category: 'allergy', status: 'active', source: 'cmo_created', is_verified: true, last_reviewed_at: '2026-08-10T00:00:00Z' }],
      tier2: [],
      tier3: [],
    },
    copy: { emergency_summary: '摘要', all_active: '摘要', disabled_reason: null },
  },
  medications: [],
  problems: [],
  vitals: [],
  evidence_documents: [],
  dicom_links: [],
  his_copy_text: '急診摘要',
  disclaimer: '本頁資料僅供急診照護參考。',
  accessed_by: '王醫師',
};

describe('EmergencyBoardPage accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ patient_label: '王小明的急診資料', expires_at: '2026-08-12T12:00:00Z' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => board }));
  });

  it('associates gate fields with labels and keeps one main heading before and after opening', async () => {
    render(<EmergencyBoardPage />);

    expect(await screen.findByRole('heading', { level: 1, name: '王小明的急診資料' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    fireEvent.change(screen.getByRole('textbox', { name: '您的姓名（必填）' }), { target: { value: '王醫師' } });
    fireEvent.change(screen.getByRole('textbox', { name: '院所或科別（選填）' }), { target: { value: '急診' } });
    fireEvent.click(screen.getByRole('button', { name: '檢視保命資料' }));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /王小明/ })).toBeInTheDocument());
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('醫療團隊整理', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/Tier|HIS|CMO|\bself\b/i)).not.toBeInTheDocument();
  });
});
