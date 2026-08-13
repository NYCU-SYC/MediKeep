import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DicomUploadPage from './page';
import { invalidateApiGetCache } from '@/lib/api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../member-context', () => ({
  useActiveMember: () => ({ activeMember: '王小明', members: [{ name: '王小明' }], canWriteMember: () => true, writeAccessReason: () => null }),
}));
const showToast = vi.fn();
vi.mock('../../toast-context', () => ({ useToast: () => ({ showToast }) }));

describe('DICOM partial upload UX', () => {
  beforeEach(() => invalidateApiGetCache());
  const policy = {
    max_files: 100,
    max_file_bytes: 64 * 1024 * 1024,
    max_total_bytes: 512 * 1024 * 1024,
    max_zip_bytes: 512 * 1024 * 1024,
    max_zip_entries: 2000,
    max_zip_expanded_bytes: 1024 * 1024 * 1024,
    max_zip_compression_ratio: 100,
    dicom_extensions: ['.dcm', '.dicom', '(no extension)'],
    zip_extensions: ['.zip'],
    dicom_content_types: ['application/dicom'],
    zip_content_types: ['application/zip'],
  };

  it('retains failed files and retries only the failed batch', async () => {
    const success = { studies_created: 1, series_created: 1, instances_imported: 20, files_skipped: 0 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => policy })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => success })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => JSON.stringify({ error: { message: '安全儲存區暫時無法使用', save_state: 'not_saved', retryable: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ...success, instances_imported: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<DicomUploadPage />);
    await screen.findByText(/伺服器限制：每次最多 100 個檔案/);
    fireEvent.click(screen.getByRole('button', { name: /多個 DICOM/ }));
    const files = Array.from({ length: 21 }, (_, index) => new File(['DICM'], `image-${index}.dcm`, { type: 'application/dicom' }));
    const fileInput = container.querySelector('input[accept*=".dcm"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files } });
    fireEvent.click(screen.getByRole('button', { name: /上傳 21 個 DICOM 檔案/ }));
    expect(await screen.findByText('部分影像已完成匯入')).toBeInTheDocument();
    expect(screen.getByText('成功項目已保存；下方失敗批次尚未保存，可只重試這些項目。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /只重試這個檔案/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /只重試這個檔案/ })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps only server-reported failed items after a partially successful response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => policy })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          studies_created: 1,
          series_created: 1,
          instances_imported: 1,
          files_skipped: 1,
          partial_success: true,
          save_state: 'partially_saved',
          failed_items: [{ index: 1, filename: 'bad.dcm', code: 'dicom_content_invalid', message: '檔案內容不是可讀取的 DICOM，尚未儲存。', retryable: false, save_state: 'not_saved' }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<DicomUploadPage />);
    await screen.findByText(/伺服器限制：每次最多 100 個檔案/);
    fireEvent.click(screen.getByRole('button', { name: /多個 DICOM/ }));
    const files = [
      new File(['DICM'], 'good.dcm', { type: 'application/dicom' }),
      new File(['bad'], 'bad.dcm', { type: 'application/dicom' }),
    ];
    fireEvent.change(container.querySelector('input[accept*=".dcm"]') as HTMLInputElement, { target: { files } });
    fireEvent.click(screen.getByRole('button', { name: /上傳 2 個 DICOM 檔案/ }));
    expect(await screen.findByText('部分影像已完成匯入')).toBeInTheDocument();
    expect(screen.getByText('bad.dcm')).toBeInTheDocument();
    expect(screen.getByText('請更換或修正檔案')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重試/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
