// R15b §4 · R15-7 — hardening ฝั่งเซิร์ฟเวอร์ (ไม่มี migration)
//  - rate limit: PATCH /api/me/busy/:id (busy:update · 404 ก็นับ) · PATCH /api/me/busy-routines/:id นับก่อน NOT_FOUND (R14a Info 1)
//    · เข้า/ออกกลุ่ม (group:membership — ออก + ใช้โค้ดที่เข้าได้จริง · R11 Info 7) · PUT /api/groups/:gid/icon (group:icon · R15a Info 3)
//  - DELETE /api/me/busy/:id ?scope= ซ้ำ → 400 VALIDATION
//  - /api/prefs บันทึก user.locale เมื่อล็อกอิน
//  - B7: super admin นอกกลุ่มแก้/ยกเลิกนัด → กระดิ่งไม่มีชื่อ มีธง actorSystemAdmin
//  - LINE: ชื่อนัด/กลุ่มไม่เป็นลิงก์ (neutralizeLinks) · B6 เพดานรวม OA 300/เดือน Asia/Bangkok (นับในคำสั่งจอง)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderLineCancelled, renderLineReminder, neutralizeLinks } from '@/lib/integrations/line/messages';
import { newId } from '@/lib/shared/id';
import {
  BUSY_ROUTINE_RATE_LIMIT,
  BUSY_WRITE_RATE_LIMITS,
  GROUP_ICON_RATE_LIMIT,
  GROUP_MEMBERSHIP_RATE_LIMIT,
  LINE_SEND_CAPS,
} from '@/lib/shared/limits';
import { call, del, get, join, makeCode, makeGroup, patch, person, post, setupHarness, Client, type Harness, type Person } from '../groups/harness';
import { mustCreate, world, type World } from '../appointments/util';
import { HOUR, LINE_A, clearFakeLine, disableLineEnv, enableLineEnv, fakeLine, linkLine, runCron } from '../line/util';

const NOW = Date.UTC(2026, 10, 11, 3); // 2026-11-11 10:00 BKK

let h: Harness;
afterEach(async () => {
  vi.restoreAllMocks();
  await h?.cleanup();
});

const code = (r: { json: unknown }) => (r.json as { error?: { code: string; params?: unknown } }).error;
const busyBody = { kind: 'timed', startDate: '2026-11-20', startTime: '09:00', endDate: '2026-11-20', endTime: '10:00' };

describe('rate limit PATCH /api/me/busy/:id (busy:update)', () => {
  let a: Person;
  let b: Person;
  beforeEach(async () => {
    h = await setupHarness({ startAt: NOW });
    a = await person(h, 'alice');
    b = await person(h, 'bob');
  });

  it('นับทุกคำขอหลังด่านบัญชี รวม 404 (id ของคนอื่น) · ครบแล้ว 429 + Retry-After · ถังแยกจาก delete', async () => {
    const mine = await post<{ busy: { id: string } }>(a.c, '/api/me/busy', busyBody);
    const theirs = await post<{ busy: { id: string } }>(b.c, '/api/me/busy', busyBody);
    expect([mine.status, theirs.status]).toEqual([201, 201]);
    const limit = BUSY_WRITE_RATE_LIMITS.update.limit;
    for (let i = 0; i < limit - 1; i++) expect((await patch(a.c, `/api/me/busy/${theirs.data.busy.id}`, { title: `x${i}` })).status).toBe(404);
    expect((await patch(a.c, `/api/me/busy/${mine.data.busy.id}`, { title: 'สุดท้าย' })).status).toBe(200);
    const over = await patch(a.c, `/api/me/busy/${mine.data.busy.id}`, { title: 'เกิน' });
    expect(over.status).toBe(429);
    expect(code(over)?.code).toBe('RATE_LIMITED');
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    // ถังของคนอื่นไม่กระทบ · delete คนละถัง
    expect((await patch(b.c, `/api/me/busy/${theirs.data.busy.id}`, { title: 'ของบ๊อบ' })).status).toBe(200);
    expect((await del(a.c, `/api/me/busy/${mine.data.busy.id}`)).status).toBe(200);
  });
});

describe('PATCH /api/me/busy-routines/:id นับ rate limit ก่อน NOT_FOUND (R14a Info 1)', () => {
  it('404 กินโควตา busy:routine จนได้ 429', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const body = { rangeKind: 'weeks', fromWeek: '2026-11-16', toWeek: '2026-11-23', weekdays: [1], allDay: true, title: 'x' };
    for (let i = 0; i < BUSY_ROUTINE_RATE_LIMIT.limit; i++) expect((await patch(a.c, `/api/me/busy-routines/${newId()}`, body)).status).toBe(404);
    const over = await patch(a.c, `/api/me/busy-routines/${newId()}`, body);
    expect(over.status).toBe(429);
    expect(code(over)?.code).toBe('RATE_LIMITED');
  });
});

describe('DELETE /api/me/busy/:id ?scope= ซ้ำ → 400', () => {
  it('scope ซ้ำทุกแบบถูกปฏิเสธด้วยรูปเดียวกับค่าผิด · ไม่ลบอะไร · scope เดียวยังใช้ได้', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const r = await post<{ busy: { id: string } }>(a.c, '/api/me/busy', busyBody);
    const id = r.data.busy.id;
    for (const q of ['scope=one&scope=series', 'scope=series&scope=one', 'scope=one&scope=one', 'scope=bad']) {
      const res = await del(a.c, `/api/me/busy/${id}?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.text, q).toBe('{"error":{"code":"VALIDATION","params":{"fields":{"scope":"INVALID"}}}}');
    }
    expect(await h.count('busy_block WHERE id = ?', [id])).toBe(1);
    expect((await del(a.c, `/api/me/busy/${id}?scope=one`)).status).toBe(200);
  });
});

describe('limiter เข้า/ออกกลุ่ม (group:membership — R11 Info 7)', () => {
  it('ออก + เข้าด้วยโค้ดได้จริง นับถังเดียวกัน · เป็นสมาชิกอยู่แล้ว/โค้ดผิดไม่กินถังนี้ · ครบแล้วทั้งออกและเข้าได้ 429', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const x = await person(h, 'xena');
    const gid = await makeGroup(a, 'ก๊วน');
    const g2 = await makeGroup(a, 'ก๊วนสอง');
    const c = await makeCode(a, gid);
    const limit = GROUP_MEMBERSHIP_RATE_LIMIT.limit;
    expect(limit % 2).toBe(0);
    await join(a, x, g2); // 1
    for (let i = 0; i < (limit - 2) / 2; i++) {
      expect((await post(x.c, '/api/invites/redeem', { code: c })).status).toBe(200);
      // เป็นสมาชิกอยู่แล้ว → 200 alreadyMember ไม่นับ
      const again = await post<{ alreadyMember: boolean }>(x.c, '/api/invites/redeem', { code: c });
      expect([again.status, again.data.alreadyMember]).toEqual([200, true]);
      expect((await post(x.c, `/api/groups/${gid}/leave`)).status).toBe(200);
    } // limit - 1
    // โค้ดผิด (นับในถัง redeem เดิม ไม่ใช่ถังนี้)
    expect(code(await post(x.c, '/api/invites/redeem', { code: 'ABCD-EFGH' }))?.code).toBe('INVITE_INVALID');
    expect((await post(x.c, '/api/invites/redeem', { code: c })).status).toBe(200); // ช่องสุดท้าย
    for (const g of [gid, g2]) {
      const leave = await post(x.c, `/api/groups/${g}/leave`);
      expect(leave.status).toBe(429);
      expect(code(leave)?.code).toBe('RATE_LIMITED');
      expect(Number(leave.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [g, x.id])).toBe(1);
    }
    const g3 = await makeGroup(a, 'ก๊วนสาม');
    const join3 = await post(x.c, '/api/invites/redeem', { code: await makeCode(a, g3) });
    expect(join3.status).toBe(429);
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [g3, x.id])).toBe(0);
    // หมดหน้าต่าง → ออกได้อีก
    h.clock.advance(GROUP_MEMBERSHIP_RATE_LIMIT.windowMs);
    expect((await post(x.c, `/api/groups/${gid}/leave`)).status).toBe(200);
    // ผู้ใช้อื่นไม่กระทบ
    const y = await person(h, 'yuki');
    await join(a, y, g3);
  });

  it('คนนอกกลุ่มเรียก leave → 404 ไม่กินโควตา', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const o = await person(h, 'oscar');
    const gid = await makeGroup(a, 'ก๊วน');
    for (let i = 0; i < GROUP_MEMBERSHIP_RATE_LIMIT.limit + 2; i++) expect((await post(o.c, `/api/groups/${gid}/leave`)).status).toBe(404);
    await join(a, o, gid);
  });
});

describe('rate limit PUT /api/groups/:gid/icon (group:icon — R15a Info 3)', () => {
  const put = (p: Person, gid: string, icon: string) => call(p.c, 'PUT' as 'POST', `/api/groups/${gid}/icon`, { icon });

  it('นับเฉพาะครั้งที่ค่าเปลี่ยน · ครบแล้ว 429 ค่าในฐานไม่เปลี่ยน · ค่าเท่าเดิมยัง 200', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const gid = await makeGroup(a, 'ก๊วน');
    for (let i = 0; i < GROUP_ICON_RATE_LIMIT.limit; i++) {
      const icon = i % 2 === 0 ? 'badminton' : 'soccer';
      expect((await put(a, gid, icon)).status).toBe(200);
      expect((await put(a, gid, icon)).status).toBe(200); // เท่าเดิม ไม่นับ
    }
    const last = (await h.rows<{ icon: string }>('SELECT icon FROM groups WHERE id = ?', [gid]))[0]!.icon;
    const next = last === 'badminton' ? 'soccer' : 'badminton';
    const over = await put(a, gid, next);
    expect(over.status).toBe(429);
    expect(code(over)?.code).toBe('RATE_LIMITED');
    expect((await h.rows<{ icon: string }>('SELECT icon FROM groups WHERE id = ?', [gid]))[0]!.icon).toBe(last);
    expect((await put(a, gid, last)).status).toBe(200);
  });

  it('สมาชิกธรรมดา (FORBIDDEN) ไม่กินโควตา', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const b = await person(h, 'bob');
    const gid = await makeGroup(a, 'ก๊วน');
    const gidB = await makeGroup(b, 'ของบ๊อบ');
    await join(a, b, gid);
    for (let i = 0; i < GROUP_ICON_RATE_LIMIT.limit + 2; i++) expect((await put(b, gid, i % 2 ? 'food' : 'game')).status).toBe(403);
    expect((await put(b, gidB, 'food')).status).toBe(200);
  });
});

describe('/api/prefs บันทึก user.locale', () => {
  const locale = async (id: string) => (await h.rows<{ locale: string }>('SELECT locale FROM user WHERE id = ?', [id]))[0]!.locale;

  it('ล็อกอิน → บันทึก · theme อย่างเดียวไม่แตะ · ค่าผิด 400 ไม่แตะ · ไม่ล็อกอิน → คุกกี้อย่างเดียว · body เท่าเดิม', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    expect(await locale(a.id)).toBe('th');
    const r = await post(a.c, '/api/prefs', { locale: 'en' });
    expect(r.status).toBe(200);
    expect(r.text).toBe('{"data":{"locale":"en"}}');
    expect(await locale(a.id)).toBe('en');
    expect((await post(a.c, '/api/prefs', { theme: 'dark' })).status).toBe(200);
    expect(await locale(a.id)).toBe('en');
    expect((await post(a.c, '/api/prefs', { locale: 'jp' })).status).toBe(400);
    expect(await locale(a.id)).toBe('en');
    expect((await post(a.c, '/api/prefs', { locale: 'th', theme: 'light' })).status).toBe(200);
    expect(await locale(a.id)).toBe('th');

    const anon = new Client();
    const before = await h.rows('SELECT id, locale, updated_at FROM user ORDER BY id');
    const ar = await post(anon, '/api/prefs', { locale: 'en' });
    expect(ar.status).toBe(200);
    expect(ar.setCookies.some((c) => c.startsWith('mm_locale=en'))).toBe(true);
    expect(await h.rows('SELECT id, locale, updated_at FROM user ORDER BY id')).toEqual(before);
  });

  it('บัญชีถูกระงับไม่ถูกเขียน (คำสั่ง UPDATE มีเงื่อนไข active)', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [a.id]);
    await post(a.c, '/api/prefs', { locale: 'en' });
    expect(await locale(a.id)).toBe('th');
  });
});

describe('B7: super admin นอกกลุ่มในกระดิ่ง', () => {
  let w: World;
  beforeEach(async () => {
    h = await setupHarness();
    w = await world(h);
  });
  type N = { kind: string; params: Record<string, unknown> };
  const bell = async (p: Person, kind: string) =>
    (await get<{ notifications: N[] }>(p.c, '/api/me/notifications?limit=50')).data.notifications.filter((n) => n.kind === kind).map((n) => n.params);

  it('ยกเลิก/แก้โดย SA นอกกลุ่ม → actorName ว่าง + actorSystemAdmin true · สมาชิกทำ → ชื่อจริง ธง false · ไม่มี actorId ออกทาง API', async () => {
    const ap = await mustCreate(w.b, w.gid);
    expect((await call(w.a.c, 'PUT' as 'POST', `/api/appointments/${ap.id}/rsvp`, { response: 'going' })).status).toBe(200);
    const upd = await patch(w.boss.c, `/api/appointments/${ap.id}`, { placeName: 'ร้านใหม่' });
    expect(upd.status, upd.text).toBe(200);
    const [u] = await bell(w.a, 'appointment.updated');
    expect(u).toMatchObject({ actorName: '', actorSystemAdmin: true });
    expect(u).not.toHaveProperty('actorId');
    expect(JSON.stringify(u)).not.toContain('boss');

    const cancel = await post(w.boss.c, `/api/appointments/${ap.id}/cancel`, {});
    expect(cancel.status, cancel.text).toBe(200);
    const [cx] = await bell(w.a, 'appointment.cancelled');
    expect(cx).toMatchObject({ actorName: '', actorSystemAdmin: true });

    const ap2 = await mustCreate(w.b, w.gid);
    await call(w.a.c, 'PUT' as 'POST', `/api/appointments/${ap2.id}/rsvp`, { response: 'going' });
    expect((await post(w.m.c, `/api/appointments/${ap2.id}/cancel`, {})).status).toBe(200);
    const byMod = (await bell(w.a, 'appointment.cancelled')).find((p) => p.appointmentId === ap2.id)!;
    expect(byMod.actorName).toBe(w.m.displayName);
    expect(byMod.actorSystemAdmin).toBe(false);
  });
});

describe('LINE: ชื่อนัด/ชื่อกลุ่มไม่เป็นลิงก์ (R10 L1 / R11 L4)', () => {
  it('neutralizeLinks: scheme + จุดของโดเมนถูกแทน · ข้อความไทย/ทศนิยมไม่ถูกแตะ', () => {
    expect(neutralizeLinks('ดู https://evil.com/x ด่วน')).toBe('ดู https:∕∕evil․com/x ด่วน');
    expect(neutralizeLinks('www.Example.co.th')).toBe('www․Example․co․th');
    expect(neutralizeLinks('mail a@b.io')).toBe('mail a@b․io');
    expect(neutralizeLinks('LINE.ME/R/abc')).toBe('LINE․ME/R/abc');
    for (const same of ['ม.6 พ.ศ. 2569 ป.ตรี', 'v1.2 ราคา 3.5 บาท', 'Dinner 7.30pm', 'กินข้าว 🍜', '']) expect(neutralizeLinks(same)).toBe(same);
  });

  it('ข้อความ LINE: ไม่มี URL/โดเมนจากชื่อ · ลิงก์นัดของเรายังอยู่ครบ (TH/EN · เตือน + ยกเลิก)', () => {
    const input = { title: 'โปร https://phish.example.com/login', groupName: 'ก๊วน bit.ly/x', startAt: Date.UTC(2026, 10, 20, 12), tz: 'Asia/Bangkok', appointmentId: newId(), appOrigin: 'https://maewmeet.test' };
    for (const locale of ['th', 'en'] as const) {
      for (const text of [renderLineReminder(locale, 'appointment.reminder_1d', input), renderLineCancelled(locale, input)]) {
        expect(text).not.toMatch(/phish\.example|example\.com|bit\.ly|https:\/\/phish/);
        expect(text).toContain('phish․example․com');
        expect(text).toContain(`https://maewmeet.test/appointments/${input.appointmentId}?openExternalBrowser=1`);
        expect(text.match(/https?:\/\//g)).toHaveLength(1);
      }
    }
  });
});

describe('B6: เพดานรวม LINE OA 300/เดือน (Asia/Bangkok)', () => {
  let w: World;
  const START_AT = Date.UTC(2026, 9, 24, 3); // 24 ต.ค. 10:00 BKK
  const bkk = (y: number, mo: number, d: number, hh = 0, mi = 0) => Date.UTC(y, mo - 1, d, hh - 7, mi);
  beforeEach(async () => {
    enableLineEnv();
    h = await setupHarness();
    w = await world(h);
    await linkLine(h, w.a.id, LINE_A);
  });
  afterEach(() => {
    clearFakeLine();
    disableLineEnv();
  });

  async function seedGoing(startAt: number): Promise<string> {
    const id = newId();
    await h.rows(
      "INSERT INTO appointment (id, group_id, title, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at, scheduled_at) VALUES (?, ?, 'นัด', ?, ?, 'Asia/Bangkok', '2026-10-24', 'active', ?, 0, 0, 0)",
      [id, w.gid, startAt, startAt + HOUR, w.b.id],
    );
    await h.rows("INSERT INTO appointment_rsvp (appointment_id, user_id, response, updated_at) VALUES (?, ?, 'going', ?)", [id, w.a.id, h.clock.now()]);
    return id;
  }
  /** แถว sent ของผู้ใช้อื่น (ไม่ชนเพดานต่อผู้รับ/ต่อนัดของ a) */
  async function seedSent(n: number, sentAt: number, status = 'sent', attempts = 1): Promise<void> {
    for (let i = 0; i < n; i++) {
      await h.rows(
        "INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at, sent_at) VALUES (?, ?, 'line', ?, ?, ?, ?, ?, ?)",
        [newId(), w.c.id, JSON.stringify({ kind: 'appointment.reminder_1d', params: { appointmentId: newId() } }), status, attempts, sentAt, sentAt, status === 'sent' ? sentAt : null],
      );
    }
  }
  const run = async () => {
    await seedGoing(START_AT);
    h.clock.set(START_AT - 24 * HOUR + 10 * 60_000);
    return runCron(h);
  };

  it('ส่งแล้ว 300 ในเดือนนี้ (Bangkok) → ไม่ push · dead LINE_OA_CAP · กระดิ่งยังเขียน · log ตัวนับไม่มี PII', async () => {
    const line = fakeLine();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedSent(LINE_SEND_CAPS.oaPerMonth, bkk(2026, 10, 1, 0, 0)); // ต้นเดือนพอดี (Bangkok) นับ
    const res = await run();
    expect(line.pushes()).toHaveLength(0);
    expect(res.line).toMatchObject({ sent: 0, capped: 1, oaCapped: 1 });
    expect(await h.count("notification_outbox WHERE status = 'dead' AND last_error = 'LINE_OA_CAP' AND user_id = ?", [w.a.id])).toBe(1);
    expect(await h.count("notification WHERE kind = 'appointment.reminder_1d' AND user_id = ?", [w.a.id])).toBe(1);
    const logs = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toContain('[line] OA monthly cap 300 reached; capped=1');
    expect(logs).not.toMatch(new RegExp(`${w.a.id}|${LINE_A}|${w.a.username}`));
  });

  it('299 ในเดือนนี้ → ส่งได้ 1 · แถวที่จองค้าง (pending attempts > 0) นับด้วย', async () => {
    const line = fakeLine();
    await seedSent(LINE_SEND_CAPS.oaPerMonth - 1, bkk(2026, 10, 5));
    const res = await run();
    expect(line.pushes()).toHaveLength(1);
    expect(res.line).toMatchObject({ sent: 1, oaCapped: 0 });
  });

  it('pending ที่จองแล้ว 1 + ส่งแล้ว 299 = เต็ม', async () => {
    const line = fakeLine();
    await seedSent(LINE_SEND_CAPS.oaPerMonth - 1, bkk(2026, 10, 5));
    await seedSent(1, bkk(2026, 10, 23, 23), 'pending', 1);
    await run();
    expect(line.pushes()).toHaveLength(0);
  });

  it('ของเดือนก่อน (30 ก.ย. 23:59 Bangkok = ยังเป็นวันที่ 30 ใน UTC+7) ไม่นับ', async () => {
    const line = fakeLine();
    await seedSent(LINE_SEND_CAPS.oaPerMonth, bkk(2026, 9, 30, 23, 59));
    const res = await run();
    expect(line.pushes()).toHaveLength(1);
    expect(res.line).toMatchObject({ sent: 1, oaCapped: 0 });
  });
});
