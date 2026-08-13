import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NhiFirstImportFlow from './NhiFirstImportFlow';

const push = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

vi.mock('@/lib/api', () => {
  class MockApiError extends Error {
    status: number;
    code: string;
    details: unknown;

    constructor(message: string, status = 500, code = 'request_failed', details?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
      throw new MockApiError(typeof payload?.detail === 'string' ? payload.detail : `request failed (${response.status})`, response.status, 'request_failed', payload?.detail);
    }
    return response.status === 204 ? null : response.json();
  };

  return {
    ApiError: MockApiError,
    getPatientSessionToken: () => window.localStorage.getItem('healthkeep_session_token'),
    api: {
      get: (path: string, params?: Record<string, string>) => request(params ? `${path}?${new URLSearchParams(params)}` : path),
      patch: (path: string, body?: unknown) => request(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
      post: (path: string, body?: unknown) => request(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
    },
  };
});

function renderFlow(memberName = '本人', completeOnboarding = false) {
  const onMemberChange = vi.fn();
  const result = render(
    <NhiFirstImportFlow
      memberName={memberName}
      members={[{ name: '本人' }, { name: '媽媽' }]}
      onMemberChange={onMemberChange}
      onBack={vi.fn()}
      completeOnboarding={completeOnboarding}
    />,
  );
  const input = result.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { ...result, input, onMemberChange };
}

function jobBody(overrides: Record<string, unknown>) {
  return JSON.stringify({
    id: 'job-test',
    state: 'queued',
    stage: 'queued',
    progress: 0,
    processed_sections: 0,
    total_sections: 0,
    retryable: false,
    error_code: null,
    error_message: null,
    updated_at: '2026-08-12T00:00:00Z',
    version: 1,
    ...overrides,
  });
}

function policyResponse() {
  return new Response(JSON.stringify({
    max_files: 50,
    max_total_bytes: 50 * 1024 * 1024,
    allowed_extensions: ['.html', '.htm', '.zip'],
    allowed_content_types: ['text/html', 'application/zip'],
    accept: '.html,.htm,.zip,text/html,application/zip',
    zip_must_be_single: true,
    content_validation: '伺服器會再次驗證內容。',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function waitForPolicy(input: HTMLInputElement) {
  await waitFor(() => expect(input).not.toBeDisabled());
}

describe('NhiFirstImportFlow', () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(policyResponse()));
  });

  it('rejects unsupported documents before upload', async () => {
    const { input } = renderFlow();
    await waitForPolicy(input);
    fireEvent.change(input, { target: { files: [new File(['pdf'], 'report.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('僅接受 .html、.htm，或單一 .zip');
    expect(screen.getByRole('button', { name: '開始匯入並查看進度' })).toBeDisabled();
  });

  it('accepts multiple HTML files and requires explicit ownership confirmation', async () => {
    const { input } = renderFlow();
    await waitForPolicy(input);
    const files = [
      new File(['<!doctype html><table></table>'], '門診.html', { type: 'text/html' }),
      new File(['<html><table></table></html>'], '用藥.html', { type: 'text/html' }),
    ];
    fireEvent.change(input, { target: { files } });
    expect(screen.getByText('2 個檔案')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: '開始匯入並查看進度' });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/我確認這些健保存摺資料屬於/));
    expect(start).toBeEnabled();
  });

  it('explains why ownership confirmation is unavailable when no member exists', async () => {
    render(
      <NhiFirstImportFlow
        memberName=""
        members={[]}
        onMemberChange={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText(/尚未建立可選擇的本人資料/)).toBeInTheDocument();
    expect(screen.getByLabelText(/我確認這些健保存摺資料屬於/)).toBeDisabled();
    expect(screen.getByText('請先選擇上方的家庭成員。')).toBeInTheDocument();
  });

  it('requires an explicit no-file confirmation and sends no_file completion', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(policyResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
      feature_enabled: true,
      reminder_required: false,
      seen_at: '2026-08-12T00:00:00Z',
      skipped_at: null,
      completed_at: '2026-08-12T00:00:00Z',
      completion_method: 'no_file',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    renderFlow('本人', true);
    const complete = screen.getByRole('button', { name: '完成設定並繼續' });
    expect(complete).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/我目前沒有可匯入的檔案/));
    fireEvent.click(complete);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/patients/me/onboarding', expect.objectContaining({ method: 'PATCH' })));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ completion_method: 'no_file' });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('uploads with a stable idempotency key and opens the resumable job page', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(policyResponse())
      .mockResolvedValue(new Response(jobBody({ id: 'job-123', state: 'queued' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }));
    const { input } = renderFlow();
    await waitForPolicy(input);
    fireEvent.change(input, {
      target: { files: [new File(['<!doctype html><html><table></table></html>'], '門診.html', { type: 'text/html' })] },
    });
    fireEvent.click(screen.getByLabelText(/我確認這些健保存摺資料屬於/));
    fireEvent.click(screen.getByRole('button', { name: '開始匯入並查看進度' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1];
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^nhi-[a-f0-9]{64}$/);
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      member_name: '本人',
      files: [{ name: '門診.html', size: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }],
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/nhi/import/job-123'));
  });

  it('completes hash verification before opening an awaiting-upload job', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(policyResponse())
      .mockResolvedValueOnce(new Response(jobBody({
        id: 'job-awaiting',
        state: 'awaiting_upload',
        upload_targets: [{
          id: 'upload-1', name: '門診.html', status: 'awaiting_upload',
          upload_url: '/api/patients/me/nhi-imports/job-awaiting/files/upload-1',
        }],
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(jobBody({ id: 'job-awaiting', state: 'awaiting_upload' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(jobBody({ id: 'job-awaiting', state: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    const { input } = renderFlow();
    await waitForPolicy(input);
    fireEvent.change(input, {
      target: { files: [new File(['<html><table></table></html>'], '門診.html', { type: 'text/html' })] },
    });
    fireEvent.click(screen.getByLabelText(/我確認這些健保存摺資料屬於/));
    fireEvent.click(screen.getByRole('button', { name: '開始匯入並查看進度' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[2][0]).toBe('/api/patients/me/nhi-imports/job-awaiting/files/upload-1');
    expect(fetchMock.mock.calls[2][1]?.body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[3][0]).toBe('/api/patients/me/nhi-imports/job-awaiting/complete');
    expect(fetchMock.mock.calls[3][1]?.body).toContain('sha256');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/nhi/import/job-awaiting'));
  });

  it('recovers a queued job when the completion response is interrupted', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(policyResponse())
      .mockResolvedValueOnce(new Response(jobBody({
        id: 'job-recovered',
        state: 'awaiting_upload',
        upload_targets: [{
          id: 'upload-recovered', name: '門診.html', status: 'awaiting_upload',
          upload_url: '/api/patients/me/nhi-imports/job-recovered/files/upload-recovered',
        }],
      }), { status: 202, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError('network interrupted'))
      .mockResolvedValueOnce(new Response(jobBody({ id: 'job-recovered', state: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const { input } = renderFlow();
    await waitForPolicy(input);
    fireEvent.change(input, {
      target: { files: [new File(['<html><table></table></html>'], '門診.html', { type: 'text/html' })] },
    });
    fireEvent.click(screen.getByLabelText(/我確認這些健保存摺資料屬於/));
    fireEvent.click(screen.getByRole('button', { name: '開始匯入並查看進度' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[4][0]).toBe('/api/patients/me/nhi-imports/job-recovered');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/nhi/import/job-recovered'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recovers a duplicate upload by reopening the existing job', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(policyResponse())
      .mockResolvedValue(new Response(JSON.stringify({
        detail: { code: 'duplicate_bundle', job_id: 'existing-job' },
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    const { input } = renderFlow();
    await waitForPolicy(input);
    fireEvent.change(input, {
      target: { files: [new File(['<html><table></table></html>'], '門診.html', { type: 'text/html' })] },
    });
    fireEvent.click(screen.getByLabelText(/我確認這些健保存摺資料屬於/));
    fireEvent.click(screen.getByRole('button', { name: '開始匯入並查看進度' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/nhi/import/existing-job'));
  });

  it('uploads a presigned target directly without leaking the HealthKeep bearer token', async () => {
    window.localStorage.setItem('healthkeep_session_token', 'patient-secret');
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(policyResponse())
      .mockResolvedValueOnce(new Response(jobBody({
        id: 'job-s3',
        state: 'awaiting_upload',
        upload_targets: [{
          id: 'upload-s3', name: '門診.html', status: 'awaiting_upload',
          upload_url: 'https://private-storage.example/upload-signed', method: 'PUT',
          headers: { 'x-amz-checksum-sha256': 'signed-checksum' },
        }],
      }), { status: 202, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(jobBody({ id: 'job-s3', state: 'queued' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));

    const { input } = renderFlow();
    await waitForPolicy(input);
    fireEvent.change(input, {
      target: { files: [new File(['<html><table></table></html>'], '門診.html', { type: 'text/html' })] },
    });
    fireEvent.click(screen.getByLabelText(/我確認這些健保存摺資料屬於/));
    fireEvent.click(screen.getByRole('button', { name: '開始匯入並查看進度' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[2][0]).toBe('https://private-storage.example/upload-signed');
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: 'PUT',
      headers: { 'x-amz-checksum-sha256': 'signed-checksum' },
    });
    expect((fetchMock.mock.calls[2][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/nhi/import/job-s3'));
  });
});
