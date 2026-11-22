// R18 §S — แชร์นัดให้คนนอกกลุ่ม (ADR 0016) · เทสต์ระดับ API (handler จริงผ่าน Request/Response + migration จริง)
// ครอบ: token/safeNext · สร้าง/ยกเลิกลิงก์ role×action · หน้า /i/<token> (service ของหน้า) · join (404 เหมือนกันทุกไบต์ · 410 · เพดาน 10 แข่งช่องสุดท้าย)
//       แขกที่ถูกนำออกกลับไม่ได้ · ออกเองกลับได้ · แขกไม่เห็นอะไรนอกนัดนั้น · RSVP แขก · รายการของฉัน · going-as-busy · แจ้งเตือน · เตือนก่อนนัด
//       วงจร: ออก/ถูกลบจากกลุ่ม · ลบบัญชี · ลบ/กู้กลุ่ม · ลบกลุ่มถาวร · cron ลบลิงก์เก่า · แขก→สมาชิก · ไม่มี token ใน audit/แจ้งเตือน/log
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActor } from '@/lib/auth/session';
import { dataCtx } from '@/lib/data/context';
import { purgeGroupIfDue } from '@/lib/data/repos/group-purge';
import { loadOutboxSendContext } from '@/lib/data/repos/line';
import { GUEST_APPOINTMENT_FIELDS, SHARE_PREVIEW_FIELDS } from '@/lib/data/serializers/share';
import { runDailyMaintenance } from '@/lib/data/services/maintenance';
import { runReminderCron } from '@/lib/data/services/reminders';
import { getSharePage, type SharePageDto } from '@/lib/data/services/share';
import { hashShareToken, parseShareToken, shareTokenFor } from '@/lib/data/share-token';
import { inTx } from '@/lib/data/tx';
import { newId } from '@/lib/shared/id';
import { safeNext } from '@/lib/shared/safe-next';
import { del, dumpAllTables, makeCode } from '../groups/harness';
import { DAY, HOUR, MIN, SLOT, call, get, join, makeGroup, mustCreate, patch, person, post, put, setupHarness, world, type Harness, type Person, type World } from '../appointments/util';
import { ORIGIN, handlerFor } from '../auth/harness';

let h: Harness;
let w: World;
let g: Person; // คนนอก ที่จะเป็นแขก
let g2: Person;

beforeAll(async () => {
  h = await setupHarness();
  w = await world(h);
  g = await person(h, 'guest1');
  g2 = await person(h, 'guest2');
});
afterAll(async () => {
  await h.cleanup();
});
// ถัง rate limit (join 10/15 นาที ฯลฯ) — เลื่อนนาฬิกาข้ามหน้าต่างทุกเทสต์ (นัดตัวอย่างอยู่อีก 6 วัน)
beforeEach(() => {
  h.clock.advance(61 * MIN);
});

type LinkRes = { url: string; linkId: string; createdAt: number; reused: boolean };
const tokenOf = (url: string) => url.split('/i/')[1]!;
async function shareLink(p: Person, id: string): Promise<LinkRes & { token: string }> {
  const r = await post<LinkRes>(p.c, `/api/appointments/${id}/share-link`);
  expect([200, 201], r.text).toContain(r.status);
  return { ...r.data, token: tokenOf(r.data.url) };
}
const joinTok = (p: Person, token: unknown) => post<{ status: string; appointmentId: string; joined: boolean }>(p.c, '/api/share/join', { token });
const guestView = (p: Person, id: string) => get<{ appointment: Record<string, unknown> }>(p.c, `/api/appointments/${id}/guest`);
const memberDetail = (p: Person, id: string) => get<{ appointment: Record<string, unknown> & { guests: { items: { userId: string; canRemove: boolean; invitedBy: { userId: string } | null; response: string | null }[]; counts: Record<string, number> }; shareLinks: { id: string; mine: boolean; url?: string }[] } }>(p.c, `/api/appointments/${id}`);
async function page(p: Person | null, token: unknown): Promise<SharePageDto> {
  const headers = new Headers({ 'x-real-ip': p?.c.ip ?? '10.9.9.9' });
  if (p) headers.set('cookie', p.c.cookieHeader());
  const req = new Request(`${ORIGIN}/i/x`, { headers });
  return getSharePage(await getActor(req), token, dataCtx(req, h.clock.now()));
}
async function guestRow(id: string, userId: string) {
  return (await h.rows<{ response: string | null; removed_at: number | null; invited_by: string | null; link_id: string | null }>('SELECT response, removed_at, invited_by, link_id FROM appointment_guest WHERE appointment_id = ? AND user_id = ?', [id, userId]))[0] ?? null;
}
const kindsOf = async (p: Person) => (await get<{ notifications: { kind: string; params: Record<string, unknown> }[] }>(p.c, '/api/me/notifications')).data.notifications;

async function seedUsers(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = newId();
    await h.rows('INSERT INTO user (id, username, username_normalized, display_name, created_at, updated_at) VALUES (?,?,?,?,?,?)', [id, `seed${id.slice(0, 8)}`, `seed${id.slice(0, 8)}`, 'seed', h.clock.now(), h.clock.now()]);
    ids.push(id);
  }
  return ids;
}

describe('token / safeNext (unit)', () => {
  it('token 22 ตัว [A-Za-z0-9_-] · deterministic ต่อ id+secret · hash hex 64 · parse ตรงรูปเท่านั้น', () => {
    const secret = Buffer.alloc(32, 7).toString('base64');
    const id = newId();
    const t = shareTokenFor(id, secret);
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(shareTokenFor(id, secret)).toBe(t);
    expect(shareTokenFor(id, Buffer.alloc(32, 8).toString('base64'))).not.toBe(t);
    expect(shareTokenFor(newId(), secret)).not.toBe(t);
    expect(hashShareToken(t, secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(t, secret)).not.toContain(t);
    expect(parseShareToken(t)).toBe(t);
    for (const bad of [t + 'a', t.slice(1), `${t.slice(0, 21)}=`, `${t.slice(0, 21)}/`, '', null, 5, `${t.slice(0, 21)} `]) expect(parseShareToken(bad)).toBeNull();
  });
  it('safeNext ยอมเฉพาะ /i/<22> · อื่นทั้งหมด → /', () => {
    const ok = '/i/abcdefghijklmnopqrstuv';
    expect(safeNext(ok)).toBe(ok);
    for (const bad of ['//evil.com', '/\\evil', 'https://evil.com/i/abcdefghijklmnopqrstuv', '/i/../admin', '/i/%2F%2Fabcdefghijklmnopq', '/i/abcdefghijklmnopqrstu', '/i/abcdefghijklmnopqrstuvw', '/i/abcdefghijklmnopqrstuv/', ' /i/abcdefghijklmnopqrstuv', '/admin', '/', undefined, null, ['/i/abcdefghijklmnopqrstuv'], 42]) {
      expect(safeNext(bad), String(bad)).toBe('/');
    }
  });
});

describe('S1 สร้างลิงก์ — role×action', () => {
  it('สมาชิกทุก role ได้ลิงก์ของตัวเอง (201) · กดซ้ำได้ลิงก์/URL เดิม (200 reused) · คนนอก 404 · SA นอกกลุ่ม 403 · แขก 404 · anonymous 401', async () => {
    const ap = await mustCreate(w.b, w.gid);
    const seen = new Set<string>();
    for (const p of [w.a, w.m, w.b, w.c]) {
      const r1 = await post<LinkRes>(p.c, `/api/appointments/${ap.id}/share-link`);
      expect(r1.status, r1.text).toBe(201);
      expect(r1.data.reused).toBe(false);
      expect(r1.data.url).toMatch(new RegExp(`^${ORIGIN}/i/[A-Za-z0-9_-]{22}$`));
      expect(Object.keys(r1.data).sort()).toEqual(['createdAt', 'linkId', 'reused', 'url']);
      const r2 = await post<LinkRes>(p.c, `/api/appointments/${ap.id}/share-link`);
      expect(r2.status).toBe(200);
      expect(r2.data).toMatchObject({ url: r1.data.url, linkId: r1.data.linkId, reused: true });
      seen.add(r1.data.linkId);
    }
    expect(seen.size).toBe(4);
    expect((await post(w.o.c, `/api/appointments/${ap.id}/share-link`)).status).toBe(404);
    expect((await post(w.boss.c, `/api/appointments/${ap.id}/share-link`)).code).toBe('FORBIDDEN');
    const anon = await post(new (w.a.c.constructor as new () => Person['c'])(), `/api/appointments/${ap.id}/share-link`);
    expect(anon.status).toBe(401);
    // แขกชวนต่อไม่ได้
    const l = await shareLink(w.b, ap.id);
    expect((await joinTok(g, l.token)).status).toBe(200);
    expect((await post(g.c, `/api/appointments/${ap.id}/share-link`)).status).toBe(404);
    // ไม่มี token ดิบในฐาน
    expect(await dumpAllTables(h)).not.toContain(l.token);
  });

  it('นัดยกเลิก → 409 APPOINTMENT_CANCELLED · จบแล้ว → 409 APPOINTMENT_PAST · กลุ่มลบ → 404', async () => {
    const ap = await mustCreate(w.b, w.gid);
    expect((await post(w.b.c, `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
    expect((await post(w.b.c, `/api/appointments/${ap.id}/share-link`)).code).toBe('APPOINTMENT_CANCELLED');
    const short = await mustCreate(w.b, w.gid, { startDate: isoDay(h.clock.now() + DAY), endDate: isoDay(h.clock.now() + DAY), startTime: '10:00', endTime: '11:00' });
    const saved = h.clock.now();
    h.clock.set(short.endAt + MIN);
    expect((await post(w.b.c, `/api/appointments/${short.id}/share-link`)).code).toBe('APPOINTMENT_PAST');
    h.clock.set(saved);
    const gid = await makeGroup(w.a, 'ลบทิ้ง');
    const ap2 = await mustCreate(w.a, gid);
    expect((await del(w.a.c, `/api/groups/${gid}`)).status).toBe(200);
    expect((await post(w.a.c, `/api/appointments/${ap2.id}/share-link`)).status).toBe(404);
  });
});

function isoDay(ms: number): string {
  return new Date(ms + 7 * HOUR).toISOString().slice(0, 10);
}

describe('S3 หน้าเปิดลิงก์ (service ของหน้า /i/[token])', () => {
  it('preview: คีย์ตรง allowlist ทุกตัว · ไม่มีชื่อสมาชิก/description/id · ยอด = สมาชิก+แขก going/maybe · GET ไม่สร้างแถว', async () => {
    const ap = await mustCreate(w.a, w.gid, { title: 'หมูกระทะ', description: 'ลับมาก-DESC', placeName: 'ร้านป้า' });
    await put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' });
    await put(w.c.c, `/api/appointments/${ap.id}/rsvp`, { response: 'maybe' });
    const l = await shareLink(w.m, ap.id);
    const before = await h.count('appointment_guest');
    const anon = await page(null, l.token);
    expect(anon.kind).toBe('preview');
    if (anon.kind !== 'preview') return;
    expect(anon.signedIn).toBe(false);
    expect(Object.keys(anon.preview).sort()).toEqual([...SHARE_PREVIEW_FIELDS].sort());
    expect(anon.preview).toMatchObject({ state: 'ok', title: 'หมูกระทะ', placeName: 'ร้านป้า', groupName: 'ก๊วนแมว', inviterName: w.m.displayName, counts: { going: 1, maybe: 1 } });
    const text = JSON.stringify(anon);
    for (const leak of ['ลับมาก-DESC', ap.id, w.gid, w.a.displayName, w.b.displayName, w.c.displayName, w.a.id]) expect(text, leak).not.toContain(leak);
    // แขกตอบไป → ยอดรวม
    expect((await joinTok(g, l.token)).status).toBe(200);
    await put(g.c, `/api/appointments/${ap.id}/guest/rsvp`, { response: 'going' });
    const after = await page(g2, l.token);
    expect(after.kind === 'preview' && after.preview.counts).toEqual({ going: 2, maybe: 1 });
    expect(after.kind === 'preview' && after.signedIn).toBe(true);
    expect(await h.count('appointment_guest')).toBe(before + 1);
    // สมาชิก/แขกอยู่แล้ว → redirect target
    expect(await page(w.b, l.token)).toEqual({ kind: 'member', appointmentId: ap.id });
    expect(await page(g, l.token)).toEqual({ kind: 'guest', appointmentId: ap.id });
  });

  it('ผิดรูป/ไม่มี/ยกเลิก → invalid (ไม่มีรายละเอียด) · นัดยกเลิก → expired', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.b, ap.id);
    expect(await page(null, 'short')).toEqual({ kind: 'invalid' });
    expect(await page(null, 'A'.repeat(22))).toEqual({ kind: 'invalid' });
    expect((await del(w.b.c, `/api/appointments/${ap.id}/share-links/${l.linkId}`)).status).toBe(200);
    expect(await page(null, l.token)).toEqual({ kind: 'invalid' });
    const l2 = await shareLink(w.b, ap.id);
    expect(l2.token).not.toBe(l.token);
    expect((await page(null, l2.token)).kind).toBe('preview');
    expect((await post(w.a.c, `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
    expect(await page(null, l2.token)).toEqual({ kind: 'expired' });
  });

  it('เกิน share:view:ip → rateLimited ไม่มีข้อมูลนัด', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.a, ap.id);
    const p = await person(h, `viewer${Date.now() % 100000}`);
    let last: SharePageDto | null = null;
    for (let i = 0; i < 121; i++) last = await page(p, l.token);
    expect(last).toMatchObject({ kind: 'rateLimited' });
    expect(JSON.stringify(last)).not.toContain('กินข้าว');
  });
});

describe('S4/S5 join', () => {
  it('เข้าได้ · ซ้ำ idempotent · สมาชิก join → member ไม่มีแถว · audit ไม่มี token/hash/URL', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.c, ap.id);
    const r1 = await joinTok(g, l.token);
    expect(r1.status, r1.text).toBe(200);
    expect(r1.data).toEqual({ status: 'guest', appointmentId: ap.id, joined: true });
    expect(await guestRow(ap.id, g.id)).toMatchObject({ invited_by: w.c.id, link_id: l.linkId, response: null, removed_at: null });
    expect((await joinTok(g, l.token)).data).toEqual({ status: 'guest', appointmentId: ap.id, joined: false });
    expect((await joinTok(w.b, l.token)).data).toEqual({ status: 'member', appointmentId: ap.id, joined: false });
    expect(await guestRow(ap.id, w.b.id)).toBeNull();
    const audits = await h.rows<{ action: string; meta: string }>("SELECT action, meta FROM audit_log WHERE target_id = ? AND action LIKE 'appointment.%'", [ap.id]);
    expect(audits.map((a) => a.action).sort()).toEqual(['appointment.create', 'appointment.guest.join', 'appointment.share.create']);
    const blob = JSON.stringify(audits);
    expect(blob).not.toContain(l.token);
    expect(blob).not.toContain('/i/');
    const hash = (await h.rows<{ token_hash: string }>('SELECT token_hash FROM appointment_share_link WHERE id = ?', [l.linkId]))[0]!.token_hash;
    expect(blob).not.toContain(hash);
    expect(JSON.parse(audits.find((a) => a.action === 'appointment.guest.join')!.meta)).toEqual({ linkId: l.linkId, invitedBy: w.c.id, asSuperAdmin: false });
  });

  it('404 SHARE_LINK_INVALID ทุกไบต์เหมือนกัน: ผิดรูป · ไม่มี · ยกเลิก · ผู้สร้างออกจากกลุ่ม · แขกที่ถูกนำออก', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const revoked = await shareLink(w.c, ap.id);
    await del(w.c.c, `/api/appointments/${ap.id}/share-links/${revoked.linkId}`);
    const leaver = await person(h, `leaver${Date.now() % 100000}`);
    await join(w.a, leaver, w.gid);
    const left = await shareLink(leaver, ap.id);
    expect((await post(leaver.c, `/api/groups/${w.gid}/leave`)).status).toBe(200);
    const good = await shareLink(w.a, ap.id);
    const victim = await person(h, `victim${Date.now() % 100000}`);
    expect((await joinTok(victim, good.token)).status).toBe(200);
    expect((await del(w.a.c, `/api/appointments/${ap.id}/guests/${victim.id}`)).status).toBe(200);
    const responses = [
      await joinTok(g2, 'not-a-token'),
      await joinTok(g2, 'B'.repeat(22)),
      await joinTok(g2, revoked.token),
      await joinTok(g2, left.token),
      await joinTok(victim, good.token),
    ];
    for (const r of responses) {
      expect(r.status).toBe(404);
      expect(r.text).toBe('{"error":{"code":"SHARE_LINK_INVALID"}}');
      expect(r.headers.get('retry-after')).toBeNull();
      expect(r.headers.get('server-timing')).toBeNull();
    }
    expect(await guestRow(ap.id, g2.id)).toBeNull();
  });

  it('410 SHARE_LINK_EXPIRED ไม่มี reason: นัดยกเลิก · กลุ่มถูกลบ', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.a, ap.id);
    await post(w.a.c, `/api/appointments/${ap.id}/cancel`);
    const r = await joinTok(g2, l.token);
    expect([r.status, r.text]).toEqual([410, '{"error":{"code":"SHARE_LINK_EXPIRED"}}']);
    const gid = await makeGroup(w.a, 'จะลบ');
    const ap2 = await mustCreate(w.a, gid);
    const l2 = await shareLink(w.a, ap2.id);
    await del(w.a.c, `/api/groups/${gid}`);
    const r2 = await joinTok(g2, l2.token);
    expect([r2.status, r2.text]).toEqual([410, '{"error":{"code":"SHARE_LINK_EXPIRED"}}']);
  });

  it('เพดาน 10: แข่งกัน 2 คนที่ช่องสุดท้าย → แขกพอดี 10 อีกคน 409 SHARE_FULL {max:10} · แถวที่ถูกนำออกไม่นับเพดาน', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.a, ap.id);
    const seeded = await seedUsers(9);
    for (const u of seeded) await h.rows('INSERT INTO appointment_guest (appointment_id, user_id, invited_by, link_id, joined_at) VALUES (?,?,?,?,?)', [ap.id, u, w.a.id, l.linkId, h.clock.now()]);
    const [x, y] = [await person(h, `racex${Date.now() % 100000}`), await person(h, `racey${Date.now() % 100000}`)];
    const rs = await Promise.all([joinTok(x, l.token), joinTok(y, l.token)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const full = rs.find((r) => r.status === 409)!;
    expect(full.text).toBe('{"error":{"code":"SHARE_FULL","params":{"max":10}}}');
    expect(await h.count('appointment_guest WHERE appointment_id = ? AND removed_at IS NULL', [ap.id])).toBe(10);
    expect((await page(null, l.token)).kind === 'preview' && ((await page(null, l.token)) as { preview: { state: string } }).preview.state).toBe('full');
    // นำออก 1 คน → มีที่ว่าง (แถวที่ถูกนำออกไม่นับ)
    expect((await del(w.a.c, `/api/appointments/${ap.id}/guests/${seeded[0]}`)).status).toBe(200);
    const loser = rs[0]!.status === 409 ? x : y;
    expect((await joinTok(loser, l.token)).status).toBe(200);
  });

  it('แขกที่ถูกนำออกเปิดลิงก์อื่นของนัดเดียวกัน → 404 ไม่ได้แถวใหม่ · แขกที่ออกเอง → เข้าใหม่ได้', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const la = await shareLink(w.a, ap.id);
    const lb = await shareLink(w.b, ap.id);
    const r = await person(h, `rem${Date.now() % 100000}`);
    expect((await joinTok(r, la.token)).status).toBe(200);
    expect((await del(w.a.c, `/api/appointments/${ap.id}/guests/${r.id}`)).status).toBe(200);
    expect((await joinTok(r, lb.token)).code).toBe('SHARE_LINK_INVALID');
    expect(await page(r, lb.token)).toEqual({ kind: 'invalid' });
    expect((await guestRow(ap.id, r.id))!.removed_at).not.toBeNull();
    // ออกเอง
    expect((await joinTok(g2, la.token)).status).toBe(200);
    expect((await call(g2.c, 'DELETE', `/api/appointments/${ap.id}/guest`)).status).toBe(200);
    expect(await guestRow(ap.id, g2.id)).toBeNull();
    expect((await joinTok(g2, lb.token)).data).toMatchObject({ status: 'guest', joined: true });
  });
});

describe('S4 แขกไม่เห็นอะไรนอกนัดนั้น · RSVP แขก', () => {
  it('ทางสมาชิกทั้งหมด → 404 · มุมมองแขกมีคีย์ตาม allowlist · ไม่มีชื่อสมาชิก/busy/นัดอื่น', async () => {
    const ap = await mustCreate(w.a, w.gid, { description: 'รายละเอียดสำหรับแขก' });
    await mustCreate(w.a, w.gid, { title: 'นัดอื่นของกลุ่ม-LEAK' });
    await put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' });
    const l = await shareLink(w.c, ap.id);
    const x = await person(h, `iso${Date.now() % 100000}`);
    await joinTok(x, l.token);
    for (const [m, p, b] of [
      ['GET', `/api/appointments/${ap.id}`, undefined],
      ['PATCH', `/api/appointments/${ap.id}`, { title: 'x' }],
      ['POST', `/api/appointments/${ap.id}/cancel`, {}],
      ['PUT', `/api/appointments/${ap.id}/rsvp`, { response: 'going' }],
      ['GET', `/api/appointments/${ap.id}/calendar.ics`, undefined],
      ['GET', `/api/groups/${w.gid}`, undefined],
      ['GET', `/api/groups/${w.gid}/appointments`, undefined],
      ['GET', `/api/groups/${w.gid}/calendar?from=2026-10-20&to=2026-10-30`, undefined],
      ['GET', `/api/groups/${w.gid}/availability?from=2026-10-20&to=2026-10-30`, undefined],
      ['POST', `/api/appointments/${ap.id}/share-link`, {}],
      ['DELETE', `/api/appointments/${ap.id}/share-links/${l.linkId}`, undefined],
      ['DELETE', `/api/appointments/${ap.id}/guests/${w.b.id}`, undefined],
    ] as const) {
      const r = await call(x.c, m as 'GET', p, b);
      expect(r.status, `${m} ${p}`).toBe(404);
    }
    const v = await guestView(x, ap.id);
    expect(v.status, v.text).toBe(200);
    expect(Object.keys(v.data.appointment).sort()).toEqual([...GUEST_APPOINTMENT_FIELDS].sort());
    expect(v.data.appointment).toMatchObject({ id: ap.id, viewerKind: 'guest', description: 'รายละเอียดสำหรับแขก', invitedBy: w.c.displayName, myRsvp: null, counts: { going: 1, maybe: 0 }, permissions: { canRsvp: true, canLeave: true } });
    for (const leak of [w.a.displayName, w.b.displayName, w.gid, 'นัดอื่นของกลุ่ม-LEAK']) expect(v.text, leak).not.toContain(leak);
    const icsRes = await (await handlerFor({ method: "GET", path: "/api/appointments/:id/guest/calendar.ics" }))(
      new Request(`${ORIGIN}/api/appointments/${ap.id}/guest/calendar.ics`, { headers: { cookie: x.c.cookieHeader(), origin: ORIGIN } }),
      { params: Promise.resolve({ id: ap.id }) },
    );
    expect(icsRes.status).toBe(200);
    expect(await icsRes.text()).toContain("BEGIN:VCALENDAR");
    // คนอื่นที่ไม่ใช่แขก / สมาชิก → ทางแขก 404
    expect((await guestView(w.b, ap.id)).status).toBe(404);
    expect((await guestView(w.o, ap.id)).status).toBe(404);
    expect((await guestView(w.boss, ap.id)).status).toBe(404);
  });

  it('แขกตอบ RSVP → เก็บในแถวแขก (ไม่ใช่ appointment_rsvp) · ผู้สร้างนัดได้ rsvp_changed + responderGuest · rsvp.counts ของสมาชิกไม่นับแขก', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.b, ap.id);
    const x = await person(h, `rsvp${Date.now() % 100000}`);
    await joinTok(x, l.token);
    const r = await put<{ appointment: { myRsvp: string; counts: { going: number } } }>(x.c, `/api/appointments/${ap.id}/guest/rsvp`, { response: 'going' });
    expect(r.status, r.text).toBe(200);
    expect(r.data.appointment).toMatchObject({ myRsvp: 'going', counts: { going: 1 } });
    expect((await guestRow(ap.id, x.id))!.response).toBe('going');
    expect(await h.count('appointment_rsvp WHERE appointment_id = ? AND user_id = ?', [ap.id, x.id])).toBe(0);
    const n = (await kindsOf(w.a)).find((k) => k.kind === 'appointment.rsvp_changed' && k.params.appointmentId === ap.id);
    expect(n?.params).toMatchObject({ responderGuest: true, response: 'going', responderName: x.displayName });
    const d = await memberDetail(w.b, ap.id);
    expect((d.data.appointment.rsvp as { counts: Record<string, number> }).counts.going).toBe(0);
    expect(d.data.appointment.guests.counts).toEqual({ going: 1, maybe: 0, not_going: 0, noResponse: 0 });
    expect(d.data.appointment.guests.items[0]).toMatchObject({ userId: x.id, response: 'going', invitedBy: { userId: w.b.id } });
    // นัดยกเลิก → 409
    await post(w.a.c, `/api/appointments/${ap.id}/cancel`);
    expect((await put(x.c, `/api/appointments/${ap.id}/guest/rsvp`, { response: 'maybe' })).code).toBe('APPOINTMENT_CANCELLED');
  });

  it('รายการนัดของฉัน: การ์ดแขก viewerKind guest (rsvp=going ด้วย) · busy ของแขกขึ้นเป็น other_group_appointment ในกลุ่มของแขก ไม่ขึ้นในกลุ่มเจ้าของนัด', async () => {
    const x = await person(h, `list${Date.now() % 100000}`);
    const own = await makeGroup(x, 'กลุ่มของแขก');
    const ap = await mustCreate(w.a, w.gid, { title: 'ไปเที่ยว-TITLE' });
    const l = await shareLink(w.a, ap.id);
    await joinTok(x, l.token);
    const mine = await get<{ appointments: { id: string; viewerKind: string }[] }>(x.c, '/api/me/appointments');
    expect(mine.data.appointments.find((a) => a.id === ap.id)?.viewerKind).toBe('guest');
    expect((await get<{ appointments: { id: string }[] }>(x.c, '/api/me/appointments?rsvp=going')).data.appointments.map((a) => a.id)).not.toContain(ap.id);
    await put(x.c, `/api/appointments/${ap.id}/guest/rsvp`, { response: 'going' });
    expect((await get<{ appointments: { id: string }[] }>(x.c, '/api/me/appointments?rsvp=going')).data.appointments.map((a) => a.id)).toContain(ap.id);
    const memberList = await get<{ appointments: { viewerKind: string }[] }>(w.a.c, '/api/me/appointments');
    expect(memberList.data.appointments.every((a) => a.viewerKind === 'member')).toBe(true);
    const cal = await get(x.c, `/api/groups/${own}/calendar?from=2026-10-20&to=2026-10-30`);
    expect(cal.status, cal.text).toBe(200);
    expect(cal.text).toContain('other_group_appointment');
    expect(cal.text).not.toContain('ไปเที่ยว-TITLE');
    expect(cal.text).not.toContain(ap.id);
    const ownerCal = await get(w.a.c, `/api/groups/${w.gid}/calendar?from=2026-10-20&to=2026-10-30`);
    expect(ownerCal.text).not.toContain(x.id);
  });
});

describe('S2/S6 ยกเลิกลิงก์ / นำแขกออก — role×action', () => {
  it('revoke: ผู้สร้างลิงก์ · ผู้สร้างนัด · admin · mod ✅ · สมาชิกอื่น 403 · SA ✅ (audited) · คนนอก/แขก 404 · :lid ของนัดอื่น 404', async () => {
    const ap = await mustCreate(w.b, w.gid);
    const other = await mustCreate(w.a, w.gid);
    const fresh = async () => (await shareLink(w.c, ap.id)).linkId;
    const lid1 = await fresh();
    expect((await del(w.m.c, `/api/appointments/${ap.id}/share-links/${lid1}`)).status).toBe(200);
    expect((await del(w.a.c, `/api/appointments/${ap.id}/share-links/${await fresh()}`)).status).toBe(200);
    expect((await del(w.b.c, `/api/appointments/${ap.id}/share-links/${await fresh()}`)).status).toBe(200); // ผู้สร้างนัด
    expect((await del(w.c.c, `/api/appointments/${ap.id}/share-links/${await fresh()}`)).status).toBe(200); // ผู้สร้างลิงก์
    const lid = await fresh();
    const outsider = await del(w.o.c, `/api/appointments/${ap.id}/share-links/${lid}`);
    expect(outsider.status).toBe(404);
    const wrong = await del(w.c.c, `/api/appointments/${other.id}/share-links/${lid}`);
    expect(wrong.text).toBe(outsider.text);
    const mOther = await shareLink(w.m, other.id);
    expect((await del(w.c.c, `/api/appointments/${other.id}/share-links/${mOther.linkId}`)).code).toBe('FORBIDDEN');
    expect((await del(w.boss.c, `/api/appointments/${ap.id}/share-links/${lid}`)).status).toBe(200);
    const sa = await h.rows<{ meta: string }>("SELECT meta FROM audit_log WHERE action = 'appointment.share.revoke' AND actor_id = ?", [w.boss.id]);
    expect(JSON.parse(sa[0]!.meta)).toEqual({ linkId: lid, reason: 'manual', asSuperAdmin: true });
    // ยกเลิกซ้ำ → 404
    expect((await del(w.c.c, `/api/appointments/${ap.id}/share-links/${lid}`)).status).toBe(404);
  });

  it('remove: ผู้สร้างนัด · ผู้ชวน · admin · mod ✅ · สมาชิกอื่น 403 · SA ✅ audited · แขกเอง/คนนอก 404 · ไม่มีเป้าหมาย 404 · ผู้ถูกนำออกได้ guest.removed (เห็นเสมอ)', async () => {
    const ap = await mustCreate(w.b, w.gid);
    const link = await shareLink(w.c, ap.id);
    const guests: Person[] = [];
    for (let i = 0; i < 6; i++) {
      const p = await person(h, `rm${i}${Date.now() % 100000}`);
      expect((await joinTok(p, link.token)).status).toBe(200);
      guests.push(p);
    }
    const detail = await memberDetail(w.c, ap.id);
    expect(detail.data.appointment.guests.items.every((x) => x.canRemove)).toBe(true);
    expect((await memberDetail(w.m, ap.id)).data.appointment.guests.items.every((x) => x.canRemove)).toBe(true);
    const url = `/api/appointments/${ap.id}/guests/`;
    expect((await del(w.b.c, url + guests[0]!.id)).status).toBe(200); // ผู้สร้างนัด
    expect((await del(w.c.c, url + guests[1]!.id)).status).toBe(200); // ผู้ชวน
    expect((await del(w.a.c, url + guests[2]!.id)).status).toBe(200);
    expect((await del(w.m.c, url + guests[3]!.id)).status).toBe(200);
    // สมาชิกที่ไม่ได้ชวน/ไม่ได้สร้างนัด
    const plain = await person(h, `plain${Date.now() % 100000}`);
    await join(w.a, plain, w.gid);
    expect((await memberDetail(plain, ap.id)).data.appointment.guests.items.every((x) => !x.canRemove)).toBe(true);
    expect((await del(plain.c, url + guests[4]!.id)).code).toBe('FORBIDDEN');
    expect((await del(w.o.c, url + guests[4]!.id)).status).toBe(404);
    expect((await del(guests[5]!.c, url + guests[4]!.id)).status).toBe(404);
    expect((await del(w.a.c, url + newId())).status).toBe(404);
    expect((await del(w.a.c, url + guests[0]!.id)).status).toBe(404); // ถูกนำออกไปแล้ว
    expect((await del(w.boss.c, url + guests[4]!.id)).status).toBe(200);
    const sa = await h.rows<{ meta: string }>("SELECT meta FROM audit_log WHERE action = 'appointment.guest.remove' AND actor_id = ?", [w.boss.id]);
    expect(JSON.parse(sa[0]!.meta)).toEqual({ guestUserId: guests[4]!.id, asSuperAdmin: true });
    const removed = await kindsOf(guests[0]!);
    expect(removed.map((n) => n.kind)).toContain('appointment.guest.removed');
    const rp = removed.find((n) => n.kind === 'appointment.guest.removed')!.params;
    // security-v1 Info 1: groupId อยู่ในฐาน (purge กลุ่ม) แต่ไม่ออกทาง API ของชนิดแขก
    expect(Object.keys(rp).sort()).toEqual(['groupName', 'startAt', 'title', 'tz']);
    const stored = await h.rows<{ params: string }>("SELECT params FROM notification WHERE user_id = ? AND kind = 'appointment.guest.removed'", [guests[0]!.id]);
    expect(JSON.parse(stored[0]!.params).groupId).toBe(w.gid);
    // ถูกนำออกแล้วไม่เห็นนัด
    expect((await guestView(guests[0]!, ap.id)).status).toBe(404);
  });
});

describe('S4 แจ้งเตือน/เตือนก่อนนัดถึงแขก', () => {
  it('แก้เวลา → appointment.guest.updated · ยกเลิก → appointment.guest.cancelled (ไม่มีชื่อผู้กระทำ) · ออกจากนัดแล้วแจ้งเตือนของนัดหาย', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.a, ap.id);
    const x = await person(h, `ntf${Date.now() % 100000}`);
    await joinTok(x, l.token);
    expect((await patch(w.a.c, `/api/appointments/${ap.id}`, { ...SLOT, startTime: '12:00', endTime: '13:00' })).status).toBe(200);
    let ns = await kindsOf(x);
    const upd = ns.find((n) => n.kind === 'appointment.guest.updated')!;
    expect(upd.params).toMatchObject({ appointmentId: ap.id, changes: 'time' });
    expect(Object.keys(upd.params).sort()).toEqual(['appointmentId', 'changes', 'groupName', 'startAt', 'title', 'tz']); // ไม่มี groupId (security-v1 Info 1)
    expect(await kindsOf(x).then((a) => a.some((n) => n.kind === 'appointment.updated'))).toBe(false);
    expect((await post(w.a.c, `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
    ns = await kindsOf(x);
    const can = ns.find((n) => n.kind === 'appointment.guest.cancelled')!;
    expect(JSON.stringify(can.params)).not.toContain(w.a.displayName);
    expect(Object.keys(can.params).sort()).toEqual(['appointmentId', 'groupName', 'startAt', 'title', 'tz']); // ไม่มี groupId (security-v1 Info 1)
    expect(JSON.stringify(await kindsOf(x))).not.toContain(w.gid);
    // ออกจากนัด → หาย
    expect((await call(x.c, 'DELETE', `/api/appointments/${ap.id}/guest`)).status).toBe(200);
    expect((await kindsOf(x)).filter((n) => n.params.appointmentId === ap.id)).toEqual([]);
  });

  it('เตือนก่อนนัด 1 วัน ถึงแขกที่ตอบไป', async () => {
    const start = h.clock.now() + 3 * DAY;
    const day = isoDay(start);
    const ap = await mustCreate(w.a, w.gid, { startDate: day, endDate: day, startTime: '18:00', endTime: '19:00' });
    const l = await shareLink(w.a, ap.id);
    const x = await person(h, `rem1d${Date.now() % 100000}`);
    await joinTok(x, l.token);
    await put(x.c, `/api/appointments/${ap.id}/guest/rsvp`, { response: 'going' });
    h.clock.set(ap.startAt - DAY + MIN);
    await runReminderCron(h.db, h.clock.now());
    expect((await kindsOf(x)).map((n) => n.kind)).toContain('appointment.reminder_1d');
    // LINE ตรวจซ้ำก่อนส่ง: คำตอบของแขกมาจากแถวแขก (ไม่ใช่ STALE เพราะไม่มี group_member)
    expect((await loadOutboxSendContext(h.db, { userId: x.id, appointmentId: ap.id }))?.response).toBe('going');
  });
});

describe('S7 วงจรข้อมูล', () => {
  it('ผู้สร้างลิงก์ออกจากกลุ่ม → ลิงก์ถูกยกเลิก (meta shareLinksRevoked) แขกอยู่ต่อ "มากับ" เป็น null · กลับเข้ากลุ่มลิงก์เก่ายังใช้ไม่ได้', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const inv = await person(h, `inv${Date.now() % 100000}`);
    await join(w.a, inv, w.gid);
    const l = await shareLink(inv, ap.id);
    const x = await person(h, `stay${Date.now() % 100000}`);
    await joinTok(x, l.token);
    expect((await post(inv.c, `/api/groups/${w.gid}/leave`)).status).toBe(200);
    const leave = await h.rows<{ meta: string }>("SELECT meta FROM audit_log WHERE action = 'group.leave' AND actor_id = ?", [inv.id]);
    expect(JSON.parse(leave[0]!.meta)).toMatchObject({ shareLinksRevoked: 1 });
    expect((await guestView(x, ap.id)).data.appointment.invitedBy).toBeNull();
    h.clock.advance(MIN); // กลับเข้ากลุ่มทีหลัง (joined_at > link.created_at)
    await join(w.a, inv, w.gid);
    // ลิงก์เก่าถูกยกเลิกแล้ว (revoked_at) → 404 · แม้ล้างค่า revoked ทิ้งก็ยังใช้ไม่ได้ (joined_at > created_at)
    expect((await joinTok(g2, l.token)).code).toBe('SHARE_LINK_INVALID');
    await h.rows('UPDATE appointment_share_link SET revoked_at = NULL, revoked_by = NULL WHERE id = ?', [l.linkId]);
    expect((await joinTok(g2, l.token)).code).toBe('SHARE_LINK_INVALID');
  });

  it('ลบกลุ่ม → แขกเข้าไม่ได้ทันที · กู้กลุ่ม → กลับมา · ลบถาวร → ไม่เหลือแถวแขก/ลิงก์ + counts', async () => {
    const gid = await makeGroup(w.a, 'วงจร');
    const ap = await mustCreate(w.a, gid);
    const l = await shareLink(w.a, ap.id);
    const x = await person(h, `life${Date.now() % 100000}`);
    await joinTok(x, l.token);
    expect((await del(w.a.c, `/api/groups/${gid}`)).status).toBe(200);
    expect((await guestView(x, ap.id)).status).toBe(404);
    expect((await get<{ appointments: { id: string }[] }>(x.c, '/api/me/appointments')).data.appointments.map((a) => a.id)).not.toContain(ap.id);
    expect((await post(w.boss.c, `/api/admin/groups/${gid}/restore`, {})).status).toBe(200);
    expect((await guestView(x, ap.id)).status).toBe(200);
    expect((await page(null, l.token)).kind).toBe('preview');
    await del(w.a.c, `/api/groups/${gid}`);
    const counts = await inTx(h.db, (tx) => purgeGroupIfDue(tx, gid, Number.MAX_SAFE_INTEGER));
    expect(counts).toMatchObject({ guests: 1, shareLinks: 1 });
    expect(await h.count('appointment_guest WHERE appointment_id = ?', [ap.id])).toBe(0);
    expect(await h.count('appointment_share_link WHERE appointment_id = ?', [ap.id])).toBe(0);
  });

  it('ลบบัญชี: ลิงก์ของผู้สร้างหาย (แขกที่เขาชวนอยู่ต่อ link_id = NULL) · แถวแขกของผู้ลบหาย', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const creator = await person(h, `delc${Date.now() % 100000}`);
    await join(w.a, creator, w.gid);
    const l = await shareLink(creator, ap.id);
    const x = await person(h, `delg${Date.now() % 100000}`);
    await joinTok(x, l.token);
    const y = await person(h, `delx${Date.now() % 100000}`);
    await joinTok(y, l.token);
    expect((await post(creator.c, '/api/me/delete', { pin: '135792', confirmUsername: creator.username })).status).toBe(200);
    expect(await h.count('appointment_share_link WHERE created_by = ?', [creator.id])).toBe(0);
    expect(await guestRow(ap.id, x.id)).toMatchObject({ link_id: null, removed_at: null });
    expect((await post(y.c, '/api/me/delete', { pin: '135792', confirmUsername: y.username })).status).toBe(200);
    expect(await guestRow(ap.id, y.id)).toBeNull();
  });

  it('แขกเข้าเป็นสมาชิกกลุ่มภายหลัง → คำตอบย้ายเป็น RSVP สมาชิก + แถวแขกที่มีผลหาย · แถวที่ถูกนำออกคงไว้ (security-v1 Info 2)', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const ap2 = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.a, ap.id);
    const l2 = await shareLink(w.a, ap2.id);
    const x = await person(h, `conv${Date.now() % 100000}`);
    await joinTok(x, l.token);
    await joinTok(x, l2.token);
    await put(x.c, `/api/appointments/${ap.id}/guest/rsvp`, { response: 'maybe' });
    await del(w.a.c, `/api/appointments/${ap2.id}/guests/${x.id}`);
    const code = await makeCode(w.a, w.gid);
    expect((await post(x.c, '/api/invites/redeem', { code })).status).toBe(200);
    expect(await h.count('appointment_guest WHERE user_id = ? AND removed_at IS NULL', [x.id])).toBe(0);
    expect(await h.count('appointment_guest WHERE user_id = ? AND removed_at IS NOT NULL', [x.id])).toBe(1);
    const d = await get<{ appointment: { rsvp: { mine: string | null } } }>(x.c, `/api/appointments/${ap.id}`);
    expect(d.data.appointment.rsvp.mine).toBe('maybe');
    // เป็นสมาชิกอยู่: นัดที่เคยถูกนำออกเห็นตามสิทธิ์สมาชิก · join → member ไม่สร้างแถว · แถวที่ถูกนำออกไม่อยู่ในรายชื่อแขก/ไม่นับเพดาน
    expect((await get(x.c, `/api/appointments/${ap2.id}`)).status).toBe(200);
    expect((await joinTok(x, l2.token)).data).toEqual({ status: 'member', appointmentId: ap2.id, joined: false });
    expect((await memberDetail(w.a, ap2.id)).data.appointment.guests.items.map((i) => i.userId)).not.toContain(x.id);
  });

  it('security-v1 Info 2: แขกที่ถูกนำออก → เข้ากลุ่ม → ออกจากกลุ่ม → เปิดลิงก์ = 404 SHARE_LINK_INVALID เดิมทุกไบต์ (ตัวกันกลับเข้ายังอยู่)', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.a, ap.id);
    const x = await person(h, `back${Date.now() % 100000}`);
    expect((await joinTok(x, l.token)).status).toBe(200);
    expect((await del(w.a.c, `/api/appointments/${ap.id}/guests/${x.id}`)).status).toBe(200);
    const before = await joinTok(x, l.token);
    expect(before.text).toBe('{"error":{"code":"SHARE_LINK_INVALID"}}');
    await join(w.a, x, w.gid);
    expect((await joinTok(x, l.token)).data).toMatchObject({ status: 'member', joined: false });
    h.clock.advance(MIN);
    expect((await post(x.c, `/api/groups/${w.gid}/leave`)).status).toBe(200);
    const after = await joinTok(x, l.token);
    expect([after.status, after.text]).toEqual([404, before.text]);
    expect(await page(x, l.token)).toEqual({ kind: 'invalid' });
    expect((await guestView(x, ap.id)).status).toBe(404);
    expect(await h.count('appointment_guest WHERE appointment_id = ? AND user_id = ? AND removed_at IS NULL', [ap.id, x.id])).toBe(0);
  });

  it('cron: ลบลิงก์ที่สิ้นสุดเกิน 30 วัน (revoked/นัดจบ) · ไม่แตะลิงก์ active · purgedShareLinks', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const alive = await shareLink(w.a, ap.id);
    const gone = await shareLink(w.b, ap.id);
    expect((await del(w.b.c, `/api/appointments/${ap.id}/share-links/${gone.linkId}`)).status).toBe(200);
    const x = await person(h, `cron${Date.now() % 100000}`);
    await joinTok(x, alive.token);
    const saved = h.clock.now();
    // 31 วันหลังยกเลิก — นัด (อีก ~6 วัน) ยังไม่จบ → ลิงก์ active ยังอยู่
    h.clock.set(saved + 31 * DAY);
    let res = await runDailyMaintenance(h.db, h.clock.now());
    expect(await h.count('appointment_share_link WHERE id = ?', [gone.linkId])).toBe(0);
    expect(res.purgedShareLinks).toBeGreaterThanOrEqual(1);
    // นัดจบ + 31 วัน → ลิงก์ active ถูกลบ · แขกอยู่ต่อ link_id = NULL
    h.clock.set(ap.endAt + 31 * DAY);
    res = await runDailyMaintenance(h.db, h.clock.now());
    expect(await h.count('appointment_share_link WHERE id = ?', [alive.linkId])).toBe(0);
    expect(await guestRow(ap.id, x.id)).toMatchObject({ link_id: null });
    h.clock.set(saved);
  });
});

describe('ไม่มี token ใน log / แจ้งเตือน', () => {
  it('console ไม่มี token ระหว่างทั้ง flow (join ผิด/ถูก/ยกเลิก)', async () => {
    const spies = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log'), vi.spyOn(console, 'info')];
    const ap = await mustCreate(w.a, w.gid);
    const l = await shareLink(w.a, ap.id);
    const x = await person(h, `log${Date.now() % 100000}`);
    await joinTok(x, l.token);
    await joinTok(x, l.token.replace(/.$/, 'Z'));
    await page(null, l.token);
    await del(w.a.c, `/api/appointments/${ap.id}/share-links/${l.linkId}`);
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
    spies.forEach((s) => s.mockRestore());
    expect(logged).not.toContain(l.token);
    const notifs = await h.rows<{ params: string }>('SELECT params FROM notification');
    expect(JSON.stringify(notifs)).not.toContain(l.token);
    expect(JSON.stringify(notifs)).not.toContain('/i/');
  });
});
