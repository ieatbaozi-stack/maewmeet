// callApi — เรียก /api/auth/* ด้วย JSON + same-origin (CSRF) และแปลงผลเป็นข้อมูล ไม่ throw
import { describe, expect, it } from 'vitest';
import { callApi } from '@/components/auth/api';

function stubFetch(res: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('callApi', () => {
  it('POST: ส่ง JSON + Content-Type + same-origin credentials · คืน data', async () => {
    const { impl, calls } = stubFetch(json({ data: { user: { mustChangePin: false } } }, 200));
    const r = await callApi<{ user: { mustChangePin: boolean } }>('/api/auth/login', {
      body: { username: 'a', pin: '135790' },
      fetchImpl: impl,
    });
    expect(r).toEqual({ ok: true, data: { user: { mustChangePin: false } } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/auth/login');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect(calls[0]!.init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(calls[0]!.init.body).toBe(JSON.stringify({ username: 'a', pin: '135790' }));
  });

  it('GET: ไม่ส่ง body/Content-Type', async () => {
    const { impl, calls } = stubFetch(json({ data: { status: 'none' } }, 200));
    await callApi('/api/auth/pin-reset/status', { method: 'GET', fetchImpl: impl });
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.body).toBeUndefined();
    expect(calls[0]!.init.headers).toBeUndefined();
  });

  it('error ของ API → รหัส + ค่า ICU (INVALID_CREDENTIALS ← attemptsRemaining)', async () => {
    const { impl } = stubFetch(json({ error: { code: 'INVALID_CREDENTIALS', params: { attemptsRemaining: 2 } } }, 401));
    const r = await callApi('/api/auth/login', { body: {}, fetchImpl: impl });
    expect(r.ok).toBe(false);
    if (!r.ok && r.kind === 'api') {
      expect(r.status).toBe(401);
      expect(r.error.code).toBe('INVALID_CREDENTIALS');
      expect(r.error.values.attemptsRemaining).toBe(2);
    } else throw new Error('expected api failure');
  });

  it('LOGIN_LOCKED ให้ retryAfterSec และ retryAfterMin', async () => {
    const { impl } = stubFetch(json({ error: { code: 'LOGIN_LOCKED', params: { retryAfterSec: 300 } } }, 429));
    const r = await callApi('/api/auth/login', { body: {}, fetchImpl: impl });
    if (r.ok || r.kind !== 'api') throw new Error('expected api failure');
    expect(r.error.values).toMatchObject({ retryAfterSec: 300, retryAfterMin: 5 });
  });

  it('body ที่ parse ไม่ได้ (เช่น 502 HTML) → UNKNOWN ไม่ throw', async () => {
    const { impl } = stubFetch(new Response('<html>bad gateway</html>', { status: 502 }));
    const r = await callApi('/api/auth/login', { body: {}, fetchImpl: impl });
    if (r.ok || r.kind !== 'api') throw new Error('expected api failure');
    expect(r.error.code).toBe('UNKNOWN');
  });

  it('เครือข่ายล้ม → kind network', async () => {
    const { impl } = stubFetch(new TypeError('failed to fetch'));
    expect(await callApi('/api/auth/login', { body: {}, fetchImpl: impl })).toEqual({ ok: false, kind: 'network' });
  });
});
