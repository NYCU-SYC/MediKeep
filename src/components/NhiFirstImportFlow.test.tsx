import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NhiFirstImportFlow from './NhiFirstImportFlow';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

function renderFlow(memberName = '本人') {
  const onMemberChange = vi.fn();
  const result = render(
    <NhiFirstImportFlow
      memberName={memberName}
      members={[{ name: '本人' }, { name: '媽媽' }]}
      onMemberChange={onMemberChange}
      onBack={vi.fn()}
    />,
  );
  const input = result.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { ...result, input, onMemberChange };
}

describe('NhiFirstImportFlow', () => {
  beforeEach(() => {
    push.mockReset();
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('rejects unsupported documents before upload', () => {
    const { input } = renderFlow();
    fireEvent.change(input, { target: { files: [new File(['pdf'], 'report.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('僅接受 .html、.htm，或單一 .zip');
    expect(screen.getByRole('button', { name: '開始匯入並查看進度' })).toBeDisabled();
  });

  it('accepts multiple HTML files and requires explicit ownership confirmation', () => {
    const { input } = renderFlow();
    const files = [
      new File(['<!doctype html><table></table>'], '門診.html', { type: 'text/html' }),
      new File(['<html><table></table></html>'], '用藥.html', { type: 'text/html' }),
    ];
    fireEvent.change(input, { target: { files } });
    expect(screen.getByText('2 個檔案')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: '開始匯入並查看進度' });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(start).toBeEnabled();
  });

  it('uploads with a stable idempotency key and opens the resumable job page', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'job-123', state: 'queued' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    }));
    const { input } = renderFlow();
    fireEvent.change(input, {
      target: { files: [new File(['<!doctype html><html><table></table></html>'], '門診.html', { type: 'text/html' })] },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '開始匯入並查看進度' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
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
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job-awaiting', state: 'awaiting_upload' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job-awaiting', state: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    const { input } = renderFlow();
    fireEvent.change(input, {
      target: { files: [new File(['<html><table></table></html>'], '門診.html', { type: 'text/html' })] },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '開始匯入並查看進度' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/patients/me/nhi-imports/job-awaiting/files/upload-1');
    expect(fetchMock.mock.calls[1][1]?.body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[2][0]).toBe('/api/patients/me/nhi-imports/job-awaiting/complete');
    expect(fetchMock.mock.calls[2][1]?.body).toContain('sha256');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/nhi/import/job-awaiting'));
  });

  it('recovers a duplicate upload by reopening the existing job', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      detail: { code: 'duplicate_bundle', job_id: 'existing-job' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    const { input } = renderFlow();
    fireEvent.change(input, {
      target: { files: [new File(['<html><table></table></html>'], '門診.html', { type: 'text/html' })] },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '開始匯入並查看進度' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/nhi/import/existing-job'));
  });

  it('uploads a presigned target directly without leaking the HealthKeep bearer token', async () => {
    window.localStorage.setItem('healthkeep_session_token', 'patient-secret');
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'job-s3',
        state: 'awaiting_upload',
        upload_targets: [{
          id: 'upload-s3', name: '門診.html', status: 'awaiting_upload',
          upload_url: 'https://private-storage.example/upload-signed', method: 'PUT',
          headers: { 'x-amz-checksum-sha256': 'signed-checksum' },
        }],
      }), { status: 202, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job-s3', state: 'queued' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));

    const { input } = renderFlow();
    fireEvent.change(input, {
      target: { files: [new File(['<html><table></table></html>'], '門診.html', { type: 'text/html' })] },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '開始匯入並查看進度' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][0]).toBe('https://private-storage.example/upload-signed');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      headers: { 'x-amz-checksum-sha256': 'signed-checksum' },
    });
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/nhi/import/job-s3'));
  });
});
