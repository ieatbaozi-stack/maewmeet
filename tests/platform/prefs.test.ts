// POST /api/prefs — R0_CONTRACT §3: {locale?, theme?} → cookie mm_locale/mm_theme (1 ปี, SameSite=Lax, Secure)
// ค่านอกชุด → VALIDATION · ไม่ตั้ง cookie เมื่อถูกปฏิเสธ · ไม่แตะ DB (R1 ค่อยบันทึกลงบัญชี)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as prefsPOST } from '@/app/api/prefs/route';
import { CACHE_CONTROL } from '@/app/api/_lib/route';
import { PREFS_COOKIE_MAX_AGE_SEC } from '@/lib/data/services/prefs';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const ORIGIN = 'https://maewmeet.test';

let t: InstalledTestDb;
beforeEach(async () => {
  t = await installTestDb({ APP_ORIGIN: ORIGIN });
});
afterEach(async () => {
  await t.cleanup();
});

const post = (body: unknown) =>
  prefsPOST(
    new Request(`${ORIGIN}/api/prefs`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

function parseSetCookies(res: Response): Map<string, { value: string; attrs: string[] }> {
  const out = new Map<string, { value: string; attrs: string[] }>();
  for (const line of res.headers.getSetCookie()) {
    const [pair = '', ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    out.set(pair.slice(0, eq), { value: pair.slice(eq + 1), attrs });
  }
  return out;
}

describe('POST /api/prefs', () => {
  it('ตั้งทั้งสองค่า → 200 {data} + 2 cookie พร้อม attribute ตามสัญญา', async () => {
    const res = await post({ locale: 'en', theme: 'dark' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    expect(await res.json()).toEqual({ data: { locale: 'en', theme: 'dark' } });

    const cookies = parseSetCookies(res);
    expect([...cookies.keys()].sort()).toEqual(['mm_locale', 'mm_theme']);
    expect(cookies.get('mm_locale')?.value).toBe('en');
    expect(cookies.get('mm_theme')?.value).toBe('dark');
    expect(PREFS_COOKIE_MAX_AGE_SEC).toBe(31_536_000); // 365 วัน
    for (const { attrs } of cookies.values()) {
      expect(attrs).toEqual(expect.arrayContaining(['Path=/', 'Max-Age=31536000', 'SameSite=Lax', 'Secure', 'HttpOnly']));
    }
  });

  it.each([
    [{ locale: 'th' }, ['mm_locale']],
    [{ theme: 'system' }, ['mm_theme']],
    [{ theme: 'light' }, ['mm_theme']],
  ] as const)('ส่งค่าเดียว %j → ตั้งเฉพาะ cookie นั้น', async (body, names) => {
    const res = await post(body);
    expect(res.status).toBe(200);
    expect([...parseSetCookies(res).keys()]).toEqual(names);
  });

  it.each([
    ['locale นอกชุด', { locale: 'jp' }, { locale: 'INVALID' }],
    ['theme นอกชุด', { theme: 'blue' }, { theme: 'INVALID' }],
    ['ตัวพิมพ์ใหญ่ไม่นับ', { locale: 'TH' }, { locale: 'INVALID' }],
    ['object ว่าง', {}, { _: 'INVALID' }],
    ['null', null, { _: 'INVALID_TYPE' }],
    ['array', ['th'], { _: 'INVALID_TYPE' }],
    ['ฟิลด์แปลก', { locale: 'th', userId: 'x' }, { userId: 'UNKNOWN_FIELD' }],
  ] as const)('%s → 400 VALIDATION และไม่ตั้ง cookie', async (_label, body, fields) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.json()).toEqual({ error: { code: 'VALIDATION', params: { fields } } });
  });

  it('ไม่เขียน DB (R0 ยังไม่มีบัญชี)', async () => {
    await post({ locale: 'en' });
    const rs = await t.db.$client.execute('select count(*) as n from user');
    expect(Number(rs.rows[0]?.n)).toBe(0);
  });
});
