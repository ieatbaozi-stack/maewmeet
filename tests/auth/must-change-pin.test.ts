// ADR 0002 Test requirement 10 (U3): ระหว่าง must_change_pin ทุก endpoint ยกเว้น POST /api/auth/pin และ POST /api/auth/logout
// → 403 PIN_CHANGE_REQUIRED — วนจาก manifest ของ route ทั้งหมดอัตโนมัติ (+ prefs ที่ ADR 0003 อนุญาตเพิ่ม)
// + ทุก service เรียก authorize() ก่อนแตะ DB (พิสูจน์ด้วย db ที่โยนทันทีเมื่อถูกแตะ)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST, type ManifestEntry } from '@/app/api/_lib/manifest';
import type { AuthCtx } from '@/lib/auth/context';
import { RESET_PIN } from '@/lib/auth/pin-rules';
import { approvePinResetRequest, listPinResets, rejectPinResetRequest } from '@/lib/auth/services/admin-resets';
import { login } from '@/lib/auth/services/login';
import { changePin } from '@/lib/auth/services/pin-change';
import { getPinResetStatus, requestPinReset } from '@/lib/auth/services/pin-reset';
import { getSessionInfo, logout, logoutAll } from '@/lib/auth/services/session-info';
import { signup } from '@/lib/auth/services/signup';
import { PIN_CHANGE_ALLOWED } from '@/lib/rbac/actions';
import type { Actor } from '@/lib/rbac/types';
import { Client, GOOD_PIN, loggedIn, setupHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
/** body ตัวอย่างที่ผ่าน validation ของแต่ละ route (route ใหม่ที่ไม่มีในตารางนี้ใช้ {} — ถ้าตก VALIDATION เทสต์จะบอกให้เพิ่ม) */
const SAMPLE_BODY: Record<string, unknown> = {
  'POST /api/prefs': { theme: 'dark' },
  'POST /api/auth/signup': { username: 'new_person', displayName: 'N', pin: '482915', pinConfirm: '482915' },
  'POST /api/auth/login': { username: 'someone', pin: '482915' },
  'POST /api/auth/pin-reset': { username: 'someone' },
  'POST /api/auth/pin': { newPin: RESET_PIN, newPinConfirm: RESET_PIN }, // ตั้งใจใช้ PIN ต้องห้าม เพื่อไม่เปลี่ยนสถานะ
  // R2 (Platform): route ที่ zod ตรวจ body ก่อน actor (route.ts ขั้น 2 ก่อนขั้น 3) ต้องมีตัวอย่างที่ผ่าน validation
  'POST /api/groups': { name: 'x' },
  'PATCH /api/groups/:gid': { name: 'x' },
  'PATCH /api/groups/:gid/members/:uid': { role: 'member' },
  'POST /api/groups/:gid/transfer-admin': { toUserId: UUID },
  'POST /api/groups/:gid/invites/direct': { username: 'someone' },
  'POST /api/invites/redeem': { code: 'ABCD-EFGH' },
  // R3 (Platform): busy — body ผ่าน zod ก่อน actor (ปฏิทินกลุ่มตรวจ from/to หลังด่านสิทธิ์ จึงไม่ต้องมีตัวอย่าง)
  'POST /api/me/busy': { kind: 'all_day', startDate: '2026-10-24', endDate: '2026-10-24' },
  'PATCH /api/me/busy/:id': { title: 'x' },
  // R4B (Platform): นัด/RSVP/แจ้งเตือน — body ผ่าน zod ก่อน actor
  'POST /api/groups/:gid/appointments': { title: 'x', startDate: '2026-10-24', startTime: '10:00', endDate: '2026-10-24', endTime: '11:00' },
  'POST /api/groups/:gid/appointments/check': { startDate: '2026-10-24', startTime: '10:00', endDate: '2026-10-24', endTime: '11:00' },
  'PATCH /api/appointments/:id': { title: 'x' },
  'PUT /api/appointments/:id/rsvp': { response: 'going' },
  'POST /api/me/notifications/read': { all: true },
};

const concretePath = (e: ManifestEntry) => e.path.replace(/:\w+/g, UUID);
const key = (e: ManifestEntry) => `${e.method} ${e.path}`;
const ALLOWED_KEYS = new Set(['POST /api/auth/pin', 'POST /api/auth/logout', 'POST /api/prefs']);

async function mustChangeClient(): Promise<Client> {
  await h.seedUser('alice');
  const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
  const phone = new Client();
  await phone.post('/api/auth/pin-reset', { username: 'alice' });
  const [r] = await h.rows<{ id: string }>('SELECT id FROM pin_reset_request');
  await boss.c.post(`/api/auth/admin/pin-resets/${r!.id}/approve`);
  const res = await phone.login('alice', RESET_PIN);
  expect(res.data.user).toMatchObject({ mustChangePin: true });
  return phone;
}

describe('manifest sweep ระหว่าง must_change_pin', () => {
  it('ALLOWED ในเทสต์ = PIN_CHANGE_ALLOWED ของ rbac ตรงกันพอดี (สัญญา PRD U3 + ADR 0003)', () => {
    const fromRbac = (PIN_CHANGE_ALLOWED as readonly string[]).slice().sort();
    expect(fromRbac).toEqual(['auth.logout', 'prefs.cookie.set', 'self.pin.change']);
    const actions = ROUTE_MANIFEST.filter((e) => ALLOWED_KEYS.has(key(e))).map((e) => e.action).sort();
    expect(actions).toEqual(fromRbac);
  });

  it('ทุก route (auth=actor) ใน manifest → 403 PIN_CHANGE_REQUIRED ยกเว้น 3 route ที่อนุญาต', async () => {
    const phone = await mustChangeClient();
    const actorRoutes = ROUTE_MANIFEST.filter((e) => e.auth === 'actor');
    // กันเทสต์ว่างผ่านเอง: ต้องครอบ route ของ auth ทั้ง 11 ตัว
    expect(actorRoutes.filter((e) => e.owner === 'auth')).toHaveLength(11);

    const blocked: string[] = [];
    for (const e of actorRoutes.filter((x) => !ALLOWED_KEYS.has(key(x)))) {
      const url = concretePath(e);
      const r = await phone.call(e.method as 'GET' | 'POST', url, e.method === 'GET' ? undefined : (SAMPLE_BODY[key(e)] ?? {}));
      expect(r.code, `${key(e)} → ${r.status} ${r.code} (route ใหม่? เพิ่มตัวอย่างใน SAMPLE_BODY)`).toBe('PIN_CHANGE_REQUIRED');
      expect(r.status, key(e)).toBe(403);
      blocked.push(key(e));
    }
    expect(blocked.length).toBe(actorRoutes.length - ALLOWED_KEYS.size);
    expect(blocked).toEqual(expect.arrayContaining(['GET /api/auth/session', 'POST /api/auth/logout-all', 'POST /api/auth/login']));

    // ผ่านด่าน PIN_CHANGE_REQUIRED (ได้ผลลัพธ์อื่น): prefs ตั้งได้ · pin ถึงขั้นตรวจกติกา PIN (PIN_TOO_WEAK)
    expect((await phone.post('/api/prefs', SAMPLE_BODY['POST /api/prefs'])).status).toBe(200);
    expect((await phone.post('/api/auth/pin', SAMPLE_BODY['POST /api/auth/pin'])).code).toBe('PIN_TOO_WEAK');
    // logout ได้ (และ session หายจริง)
    const out = await phone.post('/api/auth/logout');
    expect(out.status).toBe(200);
    expect(await h.count('session WHERE user_id = (SELECT id FROM user WHERE username = \'alice\')')).toBe(0);
  });

  it('ถ้าบทบาทอื่นเพิ่ม route แล้วลืมผ่าน authorize → เทสต์ด้านบนจะจับได้ (ตรวจว่า route ทุกตัวใน manifest มี action ใน rbac)', () => {
    for (const e of ROUTE_MANIFEST.filter((x) => x.auth === 'actor')) expect(e.action, key(e)).not.toBeNull();
  });

  it('super admin ที่ติด must_change_pin ก็ใช้หน้า admin ไม่ได้ (ไม่มีทางลัด)', async () => {
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    await h.rows("UPDATE user SET must_change_pin = 1 WHERE username = 'boss'");
    const r = await boss.c.getJson('/api/auth/admin/pin-resets');
    expect(r.code).toBe('PIN_CHANGE_REQUIRED');
  });
});

describe('service เรียก authorize() ก่อนแตะ DB', () => {
  const boom = new Proxy(
    {},
    {
      get() {
        throw new Error('DB TOUCHED BEFORE authorize()');
      },
    },
  ) as unknown as AuthCtx['db'];
  const ctx = (): AuthCtx => ({
    db: boom,
    req: new Request('https://maewmeet.test/x'),
    now: h.clock.now(),
    appSecret: Buffer.alloc(32, 1).toString('base64'),
    pepperSource: {},
  });
  const user = (o: Partial<Extract<Actor, { kind: 'user' }>> = {}): Actor => ({
    kind: 'user',
    id: 'u1',
    isSuperAdmin: false,
    status: 'active',
    mustChangePin: false,
    ...o,
  });
  const ANON: Actor = { kind: 'anonymous' };

  const calls: [string, (a: Actor) => Promise<unknown>, Record<string, string>][] = [
    // [ชื่อ, เรียก, รหัสที่คาดต่อ actor: anon | mustChange | suspended | plain]
    ['logout', (a) => logout(a, ctx()), { anon: 'AUTH_REQUIRED', suspended: 'ACCOUNT_SUSPENDED' }],
    ['logoutAll', (a) => logoutAll(a, ctx()), { anon: 'AUTH_REQUIRED', mustChange: 'PIN_CHANGE_REQUIRED', suspended: 'ACCOUNT_SUSPENDED' }],
    ['getSessionInfo', (a) => getSessionInfo(a, ctx()), { anon: 'AUTH_REQUIRED', mustChange: 'PIN_CHANGE_REQUIRED', suspended: 'ACCOUNT_SUSPENDED' }],
    [
      'changePin',
      (a) => changePin(a, { newPin: '482915', newPinConfirm: '482915', currentPin: '135792' }, ctx()),
      { anon: 'AUTH_REQUIRED', suspended: 'ACCOUNT_SUSPENDED' },
    ],
    ['listPinResets', (a) => listPinResets(a, ctx()), { anon: 'AUTH_REQUIRED', mustChange: 'PIN_CHANGE_REQUIRED', suspended: 'ACCOUNT_SUSPENDED', plain: 'FORBIDDEN' }],
    ['approve', (a) => approvePinResetRequest(a, UUID, ctx()), { anon: 'AUTH_REQUIRED', mustChange: 'PIN_CHANGE_REQUIRED', suspended: 'ACCOUNT_SUSPENDED', plain: 'FORBIDDEN' }],
    ['reject', (a) => rejectPinResetRequest(a, UUID, ctx()), { anon: 'AUTH_REQUIRED', mustChange: 'PIN_CHANGE_REQUIRED', suspended: 'ACCOUNT_SUSPENDED', plain: 'FORBIDDEN' }],
    ['login', (a) => login(a, { username: 'x', pin: '482915' }, ctx()), { mustChange: 'PIN_CHANGE_REQUIRED', suspended: 'ACCOUNT_SUSPENDED' }],
    ['signup', (a) => signup(a, { username: 'xyz', displayName: 'x', pin: '482915', pinConfirm: '482915' }, ctx()), { mustChange: 'PIN_CHANGE_REQUIRED', suspended: 'ACCOUNT_SUSPENDED' }],
    ['requestPinReset', (a) => requestPinReset(a, { username: 'x' }, ctx()), { mustChange: 'PIN_CHANGE_REQUIRED', suspended: 'ACCOUNT_SUSPENDED' }],
    ['getPinResetStatus', (a) => getPinResetStatus(a, ctx()), { mustChange: 'PIN_CHANGE_REQUIRED', suspended: 'ACCOUNT_SUSPENDED' }],
  ];

  const actors: [string, () => Actor][] = [
    ['anon', () => ANON],
    ['mustChange', () => user({ mustChangePin: true })],
    ['suspended', () => user({ status: 'suspended' })],
    ['plain', () => user()],
  ];

  for (const [name, call, expected] of calls) {
    for (const [label, mk] of actors) {
      const want = expected[label];
      if (!want) continue;
      it(`${name} · ${label} → ${want} โดยไม่แตะ DB`, async () => {
        await expect(call(mk())).rejects.toMatchObject({ code: want });
      });
    }
  }
});
