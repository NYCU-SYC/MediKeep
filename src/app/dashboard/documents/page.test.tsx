import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateApiGetCache } from '@/lib/api';
import DocumentsPage from './page';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/dashboard/documents',
  useSearchParams: () => new URLSearchParams('member=%E7%8E%8B%E5%B0%8F%E6%98%8E'),
}));
vi.mock('../member-context', () => ({
  useActiveMember: () => ({
    activeMember: '王小明', setActiveMember: vi.fn(), members: [{ name: '王小明' }],
    canWriteMember: () => true, writeAccessReason: () => null,
  }),
}));
const showToast = vi.fn();
vi.mock('../toast-context', () => ({ useToast: () => ({ showToast }) }));

const documentItem = {
  id: 'doc-1', member_name: '王小明', doc_type: 'lab_report', file_name: '檢驗報告.pdf', file_size: 1024,
  note: null, doc_date: '2026-08-10T00:00:00Z', created_at: '2026-08-10T00:00:00Z', status: 'confirmed',
  processing_status: 'confirmed', processing_status_label: '文件可作為整理依據', processing_note: '已確認原始文件。',
  next_action: '目前不需要操作。', is_verified: true, linked_to_verified_data: true,
};

function idempotencyHeader(init?: RequestInit) {
  return new Headers(init?.headers).get('Idempotency-Key');
}

describe('document recovery UX', () => {
  beforeEach(() => {
    invalidateApiGetCache();
    showToast.mockClear();
    push.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const uploadPolicy = {
    max_file_bytes: 25 * 1024 * 1024,
    max_file_mb: 25,
    allowed_extensions: ['.pdf', '.jpg', '.jpeg', '.png', '.html', '.htm', '.doc', '.docx'],
    allowed_mime_types: ['application/pdf'],
    content_validation: true,
  };

  it('rejects an oversized file before upload and explains that it was not saved', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => url.includes('/upload-policy') ? uploadPolicy : [],
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsPage />);
    await screen.findByText('目前沒有符合條件的文件');
    const oversized = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: 25 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText('選擇文件'), { target: { files: [oversized] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('超過 25 MB');
    expect(screen.getByRole('alert')).toHaveTextContent('尚未保存');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('moves a document to recent deletion and restores it without a native confirm', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method || 'GET';
      if (method === 'DELETE') return { ok: true, status: 200, json: async () => ({ deleted_at: '2026-08-12T00:00:00Z', recoverable: true, save_state: 'saved' }) };
      if (method === 'POST') return { ok: true, status: 200, json: async () => ({ document: documentItem, save_state: 'restored' }) };
      if (_url.includes('/upload-policy')) return { ok: true, status: 200, json: async () => uploadPolicy };
      return { ok: true, status: 200, json: async () => [documentItem] };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsPage />);
    expect(await screen.findByText('檢驗報告.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除：檢驗報告.pdf' }));
    expect(screen.getByRole('dialog', { name: '移到最近刪除？' })).toHaveTextContent('可以復原');
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(screen.queryByText('檢驗報告.pdf')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /最近刪除/ }));
    expect(await screen.findByText('檢驗報告.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    await waitFor(() => expect(screen.queryByText('檢驗報告.pdf')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: '目前文件' }));
    expect(await screen.findByText('檢驗報告.pdf')).toBeInTheDocument();
  });

  it('reuses the delete operation key after an ambiguous lost response', async () => {
    const deleteKeys: Array<string | null> = [];
    let deleteAttempts = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method || 'GET';
      if (method === 'DELETE') {
        deleteAttempts += 1;
        deleteKeys.push(idempotencyHeader(init));
        if (deleteAttempts === 1) throw new Error('response lost');
        return { ok: true, status: 200, json: async () => ({ deleted_at: '2026-08-12T00:00:00Z', recoverable: true, save_state: 'soft_deleted_bytes_retained' }) };
      }
      if (url.includes('/upload-policy')) return { ok: true, status: 200, json: async () => uploadPolicy };
      if (url.includes('deleted=true')) return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => [documentItem] };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsPage />);

    expect(await screen.findByText('檢驗報告.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除：檢驗報告.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(deleteAttempts).toBe(1));
    await waitFor(() => expect(screen.getByRole('button', { name: '移到最近刪除' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(deleteAttempts).toBe(2));
    expect(deleteKeys[0]).toBeTruthy();
    expect(deleteKeys[1]).toBe(deleteKeys[0]);
  });

  it('reuses a failed restore key and starts a new delete key after confirmed restore', async () => {
    const deleteKeys: Array<string | null> = [];
    const restoreKeys: Array<string | null> = [];
    let restoreAttempts = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method || 'GET';
      if (method === 'DELETE') {
        deleteKeys.push(idempotencyHeader(init));
        return { ok: true, status: 200, json: async () => ({ deleted_at: '2026-08-12T00:00:00Z', recoverable: true, save_state: 'soft_deleted_bytes_retained' }) };
      }
      if (method === 'POST') {
        restoreAttempts += 1;
        restoreKeys.push(idempotencyHeader(init));
        if (restoreAttempts === 1) throw new Error('restore response lost');
        return { ok: true, status: 200, json: async () => ({ document: documentItem, save_state: 'restored' }) };
      }
      if (url.includes('/upload-policy')) return { ok: true, status: 200, json: async () => uploadPolicy };
      if (url.includes('deleted=true')) return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => [documentItem] };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocumentsPage />);

    expect(await screen.findByText('檢驗報告.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除：檢驗報告.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(deleteKeys).toHaveLength(1));
    fireEvent.click(screen.getByRole('tab', { name: /最近刪除/ }));
    fireEvent.click(await screen.findByRole('button', { name: '復原' }));
    await waitFor(() => expect(restoreAttempts).toBe(1));
    await waitFor(() => expect(screen.getByRole('button', { name: '復原' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    await waitFor(() => expect(restoreAttempts).toBe(2));
    expect(restoreKeys[0]).toBeTruthy();
    expect(restoreKeys[1]).toBe(restoreKeys[0]);

    fireEvent.click(screen.getByRole('tab', { name: '目前文件' }));
    fireEvent.click(await screen.findByRole('button', { name: '移到最近刪除：檢驗報告.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最近刪除' }));
    await waitFor(() => expect(deleteKeys).toHaveLength(2));
    expect(deleteKeys[0]).toBeTruthy();
    expect(deleteKeys[1]).not.toBe(deleteKeys[0]);
  });
});
