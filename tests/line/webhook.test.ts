// R10-6 + API /api/me/line · ADR 0011 Test requirements ข้อ 5–6
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, get, person, post, setupHarness, type Harness, type Person } from '../appointments/util';
import { call, dumpAllTables } from '../groups/harness';
import { ACCESS_TOKEN, CHANNEL_SECRET, HOUR, LINE_A, LINE_B, MIN, callWebhook, clearFakeLine, disableLineEnv, enableLineEnv, fakeLine, linkLine, sendEvents, signBody, textEvent, unfollowEvent } from './util';
import { normalizeLineLinkCode } from '@/lib/integrations/line/link-code';
import { LINE_LINK_RATE_LIMITS } from '@/lib/shared/limits';
import th from '../../messages/th.json';
import en from '../../messages/en.json';

type Status = { available: boolean; addFriendUrl: string | null; linked: boolean; pendingExpiresAt: number | null };
type CodeDto = { code: string; expiresAt: number };

let h: Harness;
let a: Person;
let b: Person;

beforeEach(async () => {
  enableLineEnv();
  h = await setupHarness();
  a = await person(h, 'alice');
  b = await person(h, 'bob');
});
afterEach(async () => {
  vi.restoreAllMocks();
  clearFakeLine();
  disableLineEnv();
  await h.cleanup();
});

const status = (p: Person) => get<Status>(p.c, '/api/me/line');
const newCode = async (p: Person) => {
  const r = await post<CodeDto>(p.c, '/api/me/line');
  expect(r.status, r.text).toBe(201);
  return r.data;
};
const lineIdOf = async (id: string) => (await h.rows<{ l: string | null }>('SELECT line_user_id AS l FROM user WHERE id = ?', [id]))[0]!.l;
const replyText = (line: ReturnType<typeof fakeLine>, i = 0) => line.replies()[i]!.body.messages[0]!.text;

describe('ลายเซ็น', () => {
  it('ถูก + events ว่าง (ปุ่ม Verify) = 200', async () => {
    const res = await sendEvents([]);
    expect(res.status).toBe(200);
  });

  it.each<[string, (raw: string) => string | null]>([
    ['ไม่มี header', () => null],
    ['ว่าง', () => ''],
    ['ผิด', () => 'AAAA'],
    ['secret ผิด', (raw) => signBody(raw, 'other-secret')],
    ['ของ body อื่น', () => signBody('{"events":[]}x')],
  ])('%s = 401 ไม่ประมวลผล', async (_n, sign) => {
    const line = fakeLine();
    const code = await newCode(a);
    const raw = JSON.stringify({ events: [textEvent(LINE_A, code.code)] });
    const res = await callWebhook(raw, sign(raw));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'AUTH_REQUIRED' } });
    expect(await lineIdOf(a.id)).toBeNull();
    expect(line.calls).toHaveLength(0);
  });

  it('ตรวจลายเซ็นก่อน parse: JSON พังที่ลายเซ็นผิด = 401 · ลายเซ็นถูก = 400', async () => {
    const raw = '{not json';
    expect((await callWebhook(raw, 'bad')).status).toBe(401);
    expect((await callWebhook(raw, signBody(raw))).status).toBe(400);
  });

  it('ไม่มี env = 401 เหมือนลายเซ็นผิด ไม่ประมวลผล', async () => {
    disableLineEnv();
    const raw = JSON.stringify({ events: [] });
    expect((await callWebhook(raw, signBody(raw))).status).toBe(401);
  });

  it('body ใหญ่เกิน = 400', async () => {
    const raw = JSON.stringify({ events: [], pad: 'x'.repeat(300 * 1024) });
    expect((await callWebhook(raw, signBody(raw))).status).toBe(400);
  });
});

describe('ผูกบัญชี', () => {
  it('โค้ดถูก: ผูก + reply success ตาม locale · โค้ดใช้ครั้งเดียว · /me แสดงสถานะ', async () => {
    const line = fakeLine();
    await h.rows("UPDATE user SET locale = 'en' WHERE id = ?", [a.id]);
    const { code, expiresAt } = await newCode(a);
    expect(code).toMatch(/^MM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(expiresAt).toBe(h.clock.now() + 10 * MIN);
    expect((await status(a)).data).toMatchObject({ linked: false, pendingExpiresAt: expiresAt });

    expect((await sendEvents([textEvent(LINE_A, code)])).status).toBe(200);
    expect(await lineIdOf(a.id)).toBe(LINE_A);
    expect(line.replies()).toHaveLength(1);
    expect(line.replies()[0]!.body.replyToken).toBe('reply-token-1');
    expect(line.replies()[0]!.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(replyText(line)).toBe(en.line.link.success);
    expect(line.pushes()).toHaveLength(0);
    expect((await status(a)).data).toMatchObject({ linked: true, pendingExpiresAt: null });
  });

  it('รับโค้ดพิมพ์เล็ก/เว้นวรรคหัวท้าย/ขีดยูนิโค้ด', async () => {
    const line = fakeLine();
    const { code } = await newCode(a);
    await sendEvents([textEvent(LINE_A, `  ${code.toLowerCase().replaceAll('-', '–')}\n`)]);
    expect(await lineIdOf(a.id)).toBe(LINE_A);
    expect(replyText(line)).toBe(th.line.link.success);
  });

  it('โค้ดผิด / หมดอายุ / ใช้แล้ว: reply ข้อความเดียวกันทุกกรณี ไม่บอกเหตุผล', async () => {
    const line = fakeLine();
    // ผิด
    await sendEvents([textEvent(LINE_A, 'MM-ABCD-EFGH')]);
    // หมดอายุ
    const expired = await newCode(a);
    h.clock.advance(10 * MIN);
    await sendEvents([textEvent(LINE_A, expired.code)]);
    expect(await lineIdOf(a.id)).toBeNull();
    // ใช้แล้ว (LINE อื่นลองซ้ำ)
    const fresh = await newCode(a);
    await sendEvents([textEvent(LINE_A, fresh.code)]);
    expect(await lineIdOf(a.id)).toBe(LINE_A);
    await sendEvents([textEvent(LINE_B, fresh.code)]);
    expect(await lineIdOf(a.id)).toBe(LINE_A);
    const texts = line.replies().map((r) => r.body.messages[0]!.text);
    expect(texts[0]).toBe(th.line.link.invalid);
    expect(texts[1]).toBe(th.line.link.invalid);
    expect(texts[3]).toBe(th.line.link.invalid);
  });

  it('โค้ดใหม่ยกเลิกโค้ดเก่าของผู้ใช้นั้น', async () => {
    const line = fakeLine();
    const first = await newCode(a);
    const second = await newCode(a);
    expect(first.code).not.toBe(second.code);
    await sendEvents([textEvent(LINE_A, first.code)]);
    expect(await lineIdOf(a.id)).toBeNull();
    expect(replyText(line)).toBe(th.line.link.invalid);
    await sendEvents([textEvent(LINE_A, second.code)]);
    expect(await lineIdOf(a.id)).toBe(LINE_A);
  });

  it('1 LINE ผูกได้ 1 บัญชี: ชนกัน = ปฏิเสธ', async () => {
    const line = fakeLine();
    await linkLine(h, a.id, LINE_A);
    const { code } = await newCode(b);
    await sendEvents([textEvent(LINE_A, code)]);
    expect(await lineIdOf(b.id)).toBeNull();
    expect(await lineIdOf(a.id)).toBe(LINE_A);
    expect(replyText(line)).toBe(th.line.link.alreadyLinked);
  });

  it('ข้อความอื่น / โค้ดเชิญ / สติกเกอร์ / จากกลุ่ม: เงียบ ไม่ reply', async () => {
    const line = fakeLine();
    await sendEvents([
      textEvent(LINE_A, 'วิธีใช้งาน'),
      textEvent(LINE_A, 'ABCD-EFGH'),
      textEvent(LINE_A, 'SATURDAY'),
      { type: 'message', replyToken: 'r', source: { type: 'user', userId: LINE_A }, message: { type: 'sticker', id: '1' } },
      { type: 'message', replyToken: 'r', source: { type: 'group', groupId: 'C1', userId: LINE_A }, message: { type: 'text', id: '1', text: 'MM-ABCD-EFGH' } },
      { type: 'message', replyToken: 'r', source: { type: 'user' }, message: { type: 'text', id: '1', text: 'MM-ABCD-EFGH' } },
      { type: 'follow', replyToken: 'r', source: { type: 'user', userId: LINE_A } },
    ]);
    expect(line.calls).toHaveLength(0);
  });

  it('เดาโค้ด: rate limit ต่อบัญชี LINE · เต็มแล้วโค้ดถูกก็ใช้ไม่ได้ · reply เดิม', async () => {
    const line = fakeLine();
    for (let i = 0; i < LINE_LINK_RATE_LIMITS.attempt.limit; i++) await sendEvents([textEvent(LINE_A, 'MM-ABCD-EFGH', `r${i}`)]);
    const { code } = await newCode(a);
    await sendEvents([textEvent(LINE_A, code, 'last')]);
    expect(await lineIdOf(a.id)).toBeNull();
    expect(line.replies().at(-1)!.body.messages[0]!.text).toBe(th.line.link.invalid);
    const rows = await h.rows<{ key: string }>("SELECT key FROM rate_limit_bucket WHERE key LIKE 'line:code:try:%'");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.key).not.toContain(LINE_A);
  });

  it('reply ล้มไม่ rollback การผูก', async () => {
    fakeLine(['network']);
    const { code } = await newCode(a);
    expect((await sendEvents([textEvent(LINE_A, code)])).status).toBe(200);
    expect(await lineIdOf(a.id)).toBe(LINE_A);
  });

  it('เก็บแค่ hash: โค้ดดิบไม่อยู่ในฐานข้อมูล', async () => {
    fakeLine();
    const { code } = await newCode(a);
    const dump = await dumpAllTables(h);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(code.replaceAll('-', ''));
  });

  it('ไม่มีโค้ด/token/LINE id ใน log', async () => {
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    fakeLine();
    const { code } = await newCode(a);
    await sendEvents([textEvent(LINE_A, code), textEvent(LINE_B, 'MM-ABCD-EFGH', 'r2'), unfollowEvent(LINE_A)]);
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.join(' '))).join('\n');
    for (const secret of [code, LINE_A, LINE_B, CHANNEL_SECRET, ACCESS_TOKEN]) expect(logged).not.toContain(secret);
  });
});

describe('unfollow', () => {
  it('ยกเลิกการผูก + ล้างคิว pending ของผู้ใช้นั้น · ไม่แตะของคนอื่น/แถวจบแล้ว', async () => {
    fakeLine();
    await linkLine(h, a.id, LINE_A);
    await linkLine(h, b.id, LINE_B);
    const t = h.clock.now();
    const ins = (id: string, user: string, st: string) =>
      h.rows("INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at) VALUES (?, ?, 'line', '{}', ?, 0, ?, ?)", [id, user, st, t, t]);
    await ins('o-a-p', a.id, 'pending');
    await ins('o-a-s', a.id, 'sent');
    await ins('o-b-p', b.id, 'pending');
    expect((await sendEvents([unfollowEvent(LINE_A)])).status).toBe(200);
    expect(await lineIdOf(a.id)).toBeNull();
    expect(await lineIdOf(b.id)).toBe(LINE_B);
    expect((await h.rows<{ id: string }>('SELECT id FROM notification_outbox ORDER BY id')).map((r) => r.id)).toEqual(['o-a-s', 'o-b-p']);
  });

  it('unfollow ของ LINE ที่ไม่รู้จัก = เงียบ 200', async () => {
    const line = fakeLine();
    expect((await sendEvents([unfollowEvent(LINE_A)])).status).toBe(200);
    expect(line.calls).toHaveLength(0);
  });
});

describe('/api/me/line', () => {
  it('GET ไม่มี LINE id · พร้อมใช้: มี addFriendUrl', async () => {
    await linkLine(h, a.id, LINE_A);
    const r = await status(a);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ available: true, addFriendUrl: 'https://line.me/R/ti/p/@324icfvb', linked: true, pendingExpiresAt: null });
    expect(r.text).not.toContain(LINE_A);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });

  it('ไม่มี env: available=false ไม่มีลิงก์ · POST = FEATURE_DISABLED · DELETE ยังทำงาน', async () => {
    await linkLine(h, a.id, LINE_A);
    disableLineEnv();
    expect((await status(b)).data).toEqual({ available: false, addFriendUrl: null, linked: false, pendingExpiresAt: null });
    const r = await post(b.c, '/api/me/line');
    expect(r.status).toBe(503);
    expect(r.code).toBe('FEATURE_DISABLED');
    expect((await call(a.c, 'DELETE', '/api/me/line')).status).toBe(200);
    expect(await lineIdOf(a.id)).toBeNull();
  });

  it('ไม่ล็อกอิน = 401 ทุก method · ไม่มี Origin = 403', async () => {
    const anon = new Client();
    for (const m of ['GET', 'POST', 'DELETE'] as const) {
      const r = await call(anon, m, '/api/me/line');
      expect(r.status, m).toBe(401);
    }
    for (const m of ['POST', 'DELETE'] as const) {
      const r = await a.c.call(m as 'POST', '/api/me/line', {}, { headers: { origin: 'https://evil.example' } });
      expect(r.status, m).toBe(403);
      expect(r.code).toBe('CSRF_REJECTED');
    }
  });

  it('บัญชีถูกระงับ / ต้องเปลี่ยน PIN ใช้ไม่ได้ (ผ่าน policy กลาง)', async () => {
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [a.id]);
    expect((await status(a)).code).toBe('PIN_CHANGE_REQUIRED');
    expect((await post(a.c, '/api/me/line')).code).toBe('PIN_CHANGE_REQUIRED');
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [b.id]);
    expect((await status(b)).code).toBe('ACCOUNT_SUSPENDED');
  });

  it('เชื่อมแล้วขอโค้ดอีก = CONFLICT', async () => {
    await linkLine(h, a.id, LINE_A);
    const r = await post(a.c, '/api/me/line');
    expect(r.status).toBe(409);
    expect(r.code).toBe('CONFLICT');
  });

  it('rate limit การสร้างโค้ด', async () => {
    for (let i = 0; i < LINE_LINK_RATE_LIMITS.create.limit; i++) await newCode(a);
    const r = await post(a.c, '/api/me/line');
    expect(r.status).toBe(429);
    expect(r.code).toBe('RATE_LIMITED');
    h.clock.advance(HOUR);
    expect((await post(a.c, '/api/me/line')).status).toBe(201);
  });

  it('DELETE: ยกเลิก + ล้างโค้ด + ล้างคิว pending · idempotent', async () => {
    await linkLine(h, a.id, LINE_A);
    const t = h.clock.now();
    await h.rows("INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at) VALUES ('o', ?, 'line', '{}', 'pending', 0, ?, ?)", [a.id, t, t]);
    const r = await call(a.c, 'DELETE', '/api/me/line');
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ linked: false });
    expect(await lineIdOf(a.id)).toBeNull();
    expect(await h.count('notification_outbox')).toBe(0);
    expect((await call(a.c, 'DELETE', '/api/me/line')).status).toBe(200);
  });

  it('ลบบัญชี: ล้างโค้ดเชื่อมของผู้ใช้', async () => {
    await newCode(b);
    expect((await post(b.c, '/api/me/delete', { pin: '135792' })).status).toBe(200);
    expect(await h.count('line_link_code WHERE user_id = ?', [b.id])).toBe(0);
  });
});

describe('normalizeLineLinkCode', () => {
  it('รับเฉพาะรูปโค้ด', () => {
    expect(normalizeLineLinkCode('MM-ABCD-EFGH')).toBe('MM-ABCD-EFGH');
    expect(normalizeLineLinkCode('mm-abcd-efgh')).toBe('MM-ABCD-EFGH');
    for (const bad of ['', 'MMABCDEFGH', 'ABCD-EFGH', 'MM-ABC-EFGH', 'MM-ABCD-EFG0', 'MM-ABCD-EFGI', `MM-ABCD-EFGH ${'x'.repeat(40)}`]) {
      expect(normalizeLineLinkCode(bad), bad).toBeNull();
    }
  });
});
