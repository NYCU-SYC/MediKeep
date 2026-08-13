import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, invalidateApiGetCache } from './api';

afterEach(() => {
  invalidateApiGetCache();
  vi.unstubAllGlobals();
});

describe('patient API authentication routing', () => {
  it('redirects patient 401 to login while preserving the safe current route', async () => {
    const replace = vi.fn();
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      location: { pathname: '/dashboard/reminders', search: '?member=%E6%9C%AC%E4%BA%BA&highlight=followup-1', replace },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'login required' }),
    }));

    await expect(api.get('/api/patients/me/reminders')).rejects.toBeInstanceOf(ApiError);
    expect(replace).toHaveBeenCalledWith('/upload-entry?next=%2Fdashboard%2Freminders%3Fmember%3D%25E6%259C%25AC%25E4%25BA%25BA%26highlight%3Dfollowup-1');
  });

  it.each([403, 409])('does not redirect patient %s', async (status) => {
    const replace = vi.fn();
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      location: { pathname: '/dashboard/reminders', search: '', replace },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Request failed',
      json: async () => ({ detail: 'not allowed' }),
    }));

    await expect(api.get('/api/patients/me/reminders')).rejects.toBeInstanceOf(ApiError);
    expect(replace).not.toHaveBeenCalled();
  });

  it('exposes retryability and Retry-After for recoverable failures', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      location: { pathname: '/dashboard', search: '', replace: vi.fn() },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'rate_limited', message: '請稍後再試', retryable: true },
    }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '37' } })));

    const error = await api.get('/api/patients/me/emergency-readiness').catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ retryable: true, retryAfter: 37, status: 429 });
  });

  it('deduplicates concurrent GETs, reuses the short cache, and invalidates after writes', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      location: { pathname: '/dashboard', search: '', replace: vi.fn() },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1 }]), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 2 }]), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      api.get('/api/patients/me/reminders'),
      api.get('/api/patients/me/reminders'),
    ]);
    expect(first).toEqual([{ id: 1 }]);
    expect(second).toEqual([{ id: 1 }]);
    expect(await api.get('/api/patients/me/reminders')).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await api.patch('/api/patients/me/reminders/1', { is_done: true });
    expect(await api.get('/api/patients/me/reminders')).toEqual([{ id: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reuses a caller supplied idempotency key for logical retries', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      location: { pathname: '/dashboard', search: '', replace: vi.fn() },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'reminder-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/api/patients/me/reminders', { title: '回診' }, { idempotencyKey: 'legacy-reminder-stable-1' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('legacy-reminder-stable-1');
  });

  it('supports caller supplied operation keys for patch and delete retries', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    vi.stubGlobal('fetch', fetchMock);

    await api.patch('/api/resource/1', { status: 'updated' }, { idempotencyKey: 'patch-operation-1' });
    await api.delete('/api/resource/1', { idempotencyKey: 'delete-operation-1' });

    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Idempotency-Key')).toBe('patch-operation-1');
    expect(new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).get('Idempotency-Key')).toBe('delete-operation-1');
  });

  it('keeps JSON content type when a mutation supplies its own headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.patch('/api/patients/me/onboarding', { completion_method: 'no_file' }, {
      headers: { 'X-Request-ID': 'onboarding-browser-contract' },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Request-ID')).toBe('onboarding-browser-contract');
    expect(init.body).toBe(JSON.stringify({ completion_method: 'no_file' }));
  });

  it('normalizes save state and field errors from the shared error envelope', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      location: { pathname: '/dashboard', search: '', replace: vi.fn() },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'validation_failed',
        message: '請修正欄位',
        save_state: 'not_saved',
        field_errors: { title: '必填', date: ['日期格式錯誤'] },
      },
    }), { status: 422, headers: { 'Content-Type': 'application/json' } })));

    const error = await api.post('/api/patients/me/reminders', {}).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'validation_failed',
      saveState: 'not_saved',
      fieldErrors: { title: ['必填'], date: ['日期格式錯誤'] },
    });
  });

  it('uses retry timing from the shared error envelope when no Retry-After header exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'busy', message: '請稍後重試', retryable: true, save_state: 'not_saved', retry_at: 12,
      },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })));

    const error = await api.get('/api/retry-contract').catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ retryable: true, retryAfter: 12, saveState: 'not_saved' });
  });
});
