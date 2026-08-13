import { getPatientSessionToken } from './api';

export const DOCUMENT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_UPLOAD_ACCEPT = '.pdf,.html,.htm,.jpg,.jpeg,.png,.doc,.docx';

export class DocumentUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DocumentUploadError';
  }
}

function policyMessage(status: number, code?: string): string {
  if (status === 413 || code === 'document_too_large') return '檔案超過 25 MB，尚未上傳。請縮小檔案後重試。';
  if (status === 415 || code?.startsWith('document_')) return '檔案格式或實際內容不符合上傳規則，尚未上傳。請改用 PDF、JPG、PNG、HTML、DOC 或 DOCX。';
  if (status === 403) return '你目前只能查看這位成員的資料，檔案尚未上傳。';
  if (status === 429) return '目前上傳次數較多，檔案尚未保存，請稍後重試。';
  if (status === 503) return '上傳服務暫時不可用，檔案尚未保存，請稍後重試。';
  return '文件上傳失敗，檔案尚未保存。請確認網路後重試。';
}

export function validateDocumentBeforeUpload(file: File): string | null {
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) return policyMessage(413);
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  if (!DOCUMENT_UPLOAD_ACCEPT.split(',').includes(extension)) return policyMessage(415);
  return null;
}

export async function uploadDocument(formData: FormData, idempotencyKey: string): Promise<unknown> {
  const token = getPatientSessionToken();
  const response = await fetch('/api/documents', {
    method: 'POST',
    credentials: 'include',
    body: formData,
    headers: {
      'Idempotency-Key': idempotencyKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string };
      detail?: { code?: string; message?: string } | string;
    } | null;
    const detail = payload?.detail;
    const code = payload?.error?.code || (typeof detail === 'object' ? detail?.code : undefined) || 'document_upload_failed';
    const serverMessage = payload?.error?.message || (typeof detail === 'object' ? detail?.message : undefined);
    const message = [413, 415, 403, 429, 503].includes(response.status)
      ? policyMessage(response.status, code)
      : (serverMessage || policyMessage(response.status, code));
    throw new DocumentUploadError(message, response.status, code);
  }
  return response.json();
}
