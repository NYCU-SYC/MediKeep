import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_UPLOAD_MAX_BYTES, uploadDocument, validateDocumentBeforeUpload } from './document-upload';

describe('document upload adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('fails locally for oversized and unsupported files', () => {
    const oversized = new File([new Uint8Array(DOCUMENT_UPLOAD_MAX_BYTES + 1)], 'report.pdf', { type: 'application/pdf' });
    expect(validateDocumentBeforeUpload(oversized)).toContain('25 MB');
    expect(validateDocumentBeforeUpload(new File(['x'], 'report.exe'))).toContain('格式');
  });

  it('keeps the logical operation key and lets the browser set multipart boundaries', async () => {
    localStorage.setItem('healthkeep_session_token', 'test-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'doc-1' }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    const form = new FormData();
    form.append('file', new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' }));

    await uploadDocument(form, 'stable-upload-1');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token', 'Idempotency-Key': 'stable-upload-1' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('explains that rejected content was not saved', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'document_content_mismatch' } }), { status: 415, headers: { 'Content-Type': 'application/json' } }));
    await expect(uploadDocument(new FormData(), 'stable-upload-2')).rejects.toEqual(
      expect.objectContaining({ status: 415 }),
    );
  });
});
