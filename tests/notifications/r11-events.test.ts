// R11 §1: แจ้งเตือนเหตุการณ์นัด/สมาชิก — ผู้รับ (R11-1) · ไม่แจ้ง (R11-2) · แทนที่ที่ยังไม่อ่าน (R11-3) · transaction เดียว (R11-6) · ล้างชื่อตอนลบบัญชี (R11-7)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOOD_PIN } from '../auth/harness';
import { Client, MIN, call, get, join, mustCreate, patch, person, post, put, setupHarness, world, type Harness, type Person, type World } from '../appointments/util';
import { enableLineEnv, disableLineEnv, linkLine, LINE_A } from '../line/util';

let h: Harness;
let w: World;

beforeEach(async () => {
  disableLineEnv();
  h = await setupHarness();
  w = await world(h);
  await h.rows('DELETE FROM notification');
});
afterEach(async () => {
  disableLineEnv();
  await h.cleanup();
});

type N = { id: string; kind: string; params: Record<string, unknown>; readAt: number | null };
const inbox = async (p: { c: Client }) => (await get<{ notifications: N[] }>(p.c, '/api/me/notifications')).data.notifications;
const sorted = (...ids: string[]) => [...ids].sort();
const recipients = async (kind: string) => (await h.rows<{ user_id: string }>('SELECT user_id FROM notification WHERE kind = ? ORDER BY user_id', [kind])).map((r) => r.user_id);
const paramsFor = async (userId: string, kind: string) => {
  const rows = await h.rows<{ params: string }>('SELECT params FROM notification WHERE user_id = ? AND kind = ? ORDER BY created_at DESC, id DESC', [userId, kind]);
  return rows.map((r) => JSON.parse(r.params) as Record<string, unknown>);
};
const cancel = (p: Person, id: string) => post(p.c, `/api/appointments/${id}/cancel`);
const answer = async (p: Person, id: string, response: 'going' | 'maybe' | 'not_going') => {
  const r = await put(p.c, `/api/appointments/${id}/rsvp`, { response });
  expect(r.status, r.text).toBe(200);
};
const markAllRead = (p: { c: Client }) => post(p.c, '/api/me/notifications/read', { all: true });
const NEW_TIME = { startDate: '2026-10-25', startTime: '10:00', endDate: '2026-10-25', endTime: '11:00' } as const;
const SLOT_START = Date.UTC(2026, 9, 24, 3);

describe('R11-1 ผู้รับตรงตาราง §1', () => {
  it('appointment.cancelled: ไป/อาจไป/ยังไม่ตอบ ได้กระดิ่ง · ไม่ไป/ผู้กระทำ/คนนอก/super admin ไม่ได้ · params ครบไม่มีตัวอ้างอิงภายใน', async () => {
    const ap = await mustCreate(w.b, w.gid, { title: 'หมูกระทะ' });
    await answer(w.m, ap.id, 'going');
    await answer(w.c, ap.id, 'not_going');
    await h.rows("DELETE FROM notification WHERE kind = 'appointment.rsvp_changed'");
    expect((await cancel(w.a, ap.id)).status).toBe(200);
    expect(await recipients('appointment.cancelled')).toEqual(sorted(w.m.id, w.b.id));
    const items = (await inbox(w.m)).filter((n) => n.kind === 'appointment.cancelled');
    expect(items).toHaveLength(1);
    expect(items[0]!.params).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap.id, title: 'หมูกระทะ', startAt: ap.startAt, tz: 'Asia/Bangkok', actorName: w.a.displayName });
    expect((await paramsFor(w.m.id, 'appointment.cancelled'))[0]).toMatchObject({ actorId: w.a.id });
    expect(await inbox(w.o)).toEqual([]);
    expect(await inbox(w.boss)).toEqual([]);
  });

  it('appointment.updated: เวลาเปลี่ยน → สมาชิกทุกคนยกเว้นผู้แก้ · startAt/tz ค่าใหม่ · changes แยกตามที่เปลี่ยน', async () => {
    const ap = await mustCreate(w.b, w.gid);
    const r = await patch<{ appointment: { startAt: number } }>(w.b.c, `/api/appointments/${ap.id}`, NEW_TIME);
    expect(r.status, r.text).toBe(200);
    expect(await recipients('appointment.updated')).toEqual(sorted(w.a.id, w.m.id, w.c.id));
    const first = (await inbox(w.a)).find((n) => n.kind === 'appointment.updated')!;
    expect(first.params).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap.id, title: ap.title, startAt: r.data.appointment.startAt, tz: 'Asia/Bangkok', actorName: w.b.displayName, changes: 'time' });
    expect(first.params.startAt).not.toBe(ap.startAt);
    await markAllRead(w.a);
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { placeName: 'เซ็นทรัล' })).status).toBe(200);
    expect(((await inbox(w.a)).find((n) => n.kind === 'appointment.updated' && n.readAt === null))!.params.changes).toBe('place');
    await markAllRead(w.a);
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { placeName: 'สยาม', startDate: '2026-10-26', startTime: '10:00', endDate: '2026-10-26', endTime: '11:00' })).status).toBe(200);
    expect(((await inbox(w.a)).find((n) => n.kind === 'appointment.updated' && n.readAt === null))!.params.changes).toBe('both');
  });

  it('appointment.updated: สถานที่นับรวมพิกัด/ลิงก์แผนที่ · จบเวลาอย่างเดียวเปลี่ยน = time', async () => {
    const ap = await mustCreate(w.b, w.gid);
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { mapUrl: 'https://maps.example.com/x' })).status).toBe(200);
    expect((await paramsFor(w.a.id, 'appointment.updated'))[0]!.changes).toBe('place');
    await markAllRead(w.a);
    h.clock.advance(1000);
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { startDate: '2026-10-24', startTime: '10:00', endDate: '2026-10-24', endTime: '12:00' })).status).toBe(200);
    expect((await paramsFor(w.a.id, 'appointment.updated'))[0]!.changes).toBe('time');
  });

  it('appointment.rsvp_changed: ถึงผู้สร้างเท่านั้น · params ครบ responderName/response · API ไม่เปิด responderId', async () => {
    const ap = await mustCreate(w.b, w.gid, { title: 'ไปทะเล' });
    await answer(w.c, ap.id, 'maybe');
    expect(await recipients('appointment.rsvp_changed')).toEqual([w.b.id]);
    const item = (await inbox(w.b)).find((n) => n.kind === 'appointment.rsvp_changed')!;
    expect(item.params).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap.id, title: 'ไปทะเล', startAt: ap.startAt, tz: 'Asia/Bangkok', responderName: w.c.displayName, response: 'maybe' });
    expect((await paramsFor(w.b.id, 'appointment.rsvp_changed'))[0]).toMatchObject({ responderId: w.c.id });
  });

  it('group.member.joined ด้วยโค้ด: admin + moderator · ผู้เข้า/สมาชิกธรรมดาไม่ได้', async () => {
    const x = await person(h, 'xena');
    await join(w.a, x, w.gid);
    expect(await recipients('group.member.joined')).toEqual(sorted(w.a.id, w.m.id));
    expect((await inbox(w.a)).find((n) => n.kind === 'group.member.joined')!.params).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว', memberName: x.displayName });
    expect((await paramsFor(w.a.id, 'group.member.joined'))[0]).toMatchObject({ memberId: x.id });
  });

  it('group.member.joined ด้วยคำเชิญตรง: admin + moderator ยกเว้นผู้เชิญ (ผู้เชิญได้ group.invite.accepted)', async () => {
    const x = await person(h, 'xena');
    const inv = await post<{ invite: { id: string } }>(w.m.c, `/api/groups/${w.gid}/invites/direct`, { username: 'xena' });
    expect(inv.status, inv.text).toBe(201);
    expect((await post(x.c, `/api/me/invites/${inv.data.invite.id}/accept`)).status).toBe(200);
    expect(await recipients('group.member.joined')).toEqual([w.a.id]);
    expect(await recipients('group.invite.accepted')).toEqual([w.m.id]);
  });

  it('group.member.left: admin + moderator ที่ยังอยู่', async () => {
    expect((await post(w.c.c, `/api/groups/${w.gid}/leave`)).status).toBe(200);
    expect(await recipients('group.member.left')).toEqual(sorted(w.a.id, w.m.id));
    expect((await inbox(w.a)).find((n) => n.kind === 'group.member.left')!.params).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว', memberName: w.c.displayName });
    expect(await inbox(w.c)).toEqual([]);
  });

  it('group.member.removed: คนที่ถูกนำออกเท่านั้น · params ไม่บอกชื่อผู้นำออก', async () => {
    expect((await call(w.m.c, 'DELETE', `/api/groups/${w.gid}/members/${w.c.id}`)).status).toBe(200);
    expect(await recipients('group.member.removed')).toEqual([w.c.id]);
    expect((await paramsFor(w.c.id, 'group.member.removed'))[0]).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว' });
    expect(await inbox(w.a)).toEqual([]);
  });

  it('group.member.role_changed: setMemberRole แจ้งคนที่สิทธิ์เปลี่ยน · ไม่แจ้งผู้กระทำ', async () => {
    expect((await patch(w.a.c, `/api/groups/${w.gid}/members/${w.b.id}`, { role: 'moderator' })).status).toBe(200);
    expect(await recipients('group.member.role_changed')).toEqual([w.b.id]);
    expect((await paramsFor(w.b.id, 'group.member.role_changed'))[0]).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว', role: 'moderator' });
  });

  it('transferAdmin โดย admin: ผู้รับตำแหน่งได้ role admin · admin เดิมเป็นผู้กระทำจึงไม่ได้', async () => {
    expect((await post(w.a.c, `/api/groups/${w.gid}/transfer-admin`, { toUserId: w.m.id })).status).toBe(200);
    expect(await recipients('group.member.role_changed')).toEqual([w.m.id]);
    expect((await paramsFor(w.m.id, 'group.member.role_changed'))[0]).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว', role: 'admin' });
  });

  it('transferAdmin โดย super admin: ผู้รับตำแหน่ง → admin · ผู้ดูแลเดิม → moderator', async () => {
    expect((await post(w.boss.c, `/api/groups/${w.gid}/transfer-admin`, { toUserId: w.c.id })).status).toBe(200);
    expect(await recipients('group.member.role_changed')).toEqual(sorted(w.c.id, w.a.id));
    expect((await paramsFor(w.c.id, 'group.member.role_changed'))[0]!.role).toBe('admin');
    expect((await paramsFor(w.a.id, 'group.member.role_changed'))[0]!.role).toBe('moderator');
  });

  it('บัญชีไม่ active ไม่ได้รับ · คนนอกกลุ่มไม่ได้รับทุกชนิด', async () => {
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [w.c.id]);
    const ap = await mustCreate(w.b, w.gid);
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { placeName: 'ร้าน' })).status).toBe(200);
    expect(await recipients('appointment.updated')).toEqual(sorted(w.a.id, w.m.id));
    expect(await inbox(w.o)).toEqual([]);
  });

  it('ชื่อ/ชื่อนัดผ่าน sanitizeDisplayText ก่อนเก็บ', async () => {
    await h.rows("UPDATE user SET display_name = ? WHERE id = ?", ['ชื่อ‮มี bidi', w.a.id]);
    const ap = await mustCreate(w.b, w.gid);
    await h.rows("UPDATE appointment SET title = ? WHERE id = ?", ['นัด​แอบ', ap.id]);
    expect((await cancel(w.a, ap.id)).status).toBe(200);
    expect((await paramsFor(w.b.id, 'appointment.cancelled'))[0]).toMatchObject({ actorName: 'ชื่อมี bidi', title: 'นัดแอบ' });
  });
});

describe('R11-2 ไม่แจ้ง', () => {
  it('ยกเลิกหลังเวลาเริ่ม ไม่เขียนแถว', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await answer(w.c, ap.id, 'going');
    await h.rows('DELETE FROM notification');
    h.clock.set(SLOT_START + 10 * MIN);
    expect((await cancel(w.b, ap.id)).status).toBe(200);
    expect(await h.count('notification')).toBe(0);
    expect(await h.count('notification_outbox')).toBe(0);
  });

  it('แก้แค่ชื่อ/รายละเอียด ไม่แจ้ง', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await h.rows('DELETE FROM notification');
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { title: 'ชื่อใหม่', description: 'รายละเอียดใหม่' })).status).toBe(200);
    expect(await h.count('notification')).toBe(0);
  });

  it('ส่งเวลา/สถานที่เดิมซ้ำ ไม่ถือว่าเปลี่ยน', async () => {
    const ap = await mustCreate(w.b, w.gid, { placeName: 'ร้านเดิม' });
    await h.rows('DELETE FROM notification');
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { placeName: 'ร้านเดิม', startDate: '2026-10-24', startTime: '10:00', endDate: '2026-10-24', endTime: '11:00' })).status).toBe(200);
    expect(await h.count('notification')).toBe(0);
  });

  it('ตอบคำตอบเดิมซ้ำ ไม่แจ้ง · เปลี่ยนคำตอบ = แจ้ง', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await answer(w.c, ap.id, 'going');
    await h.rows('DELETE FROM notification');
    await answer(w.c, ap.id, 'going');
    expect(await h.count('notification')).toBe(0);
    await answer(w.c, ap.id, 'maybe');
    expect(await recipients('appointment.rsvp_changed')).toEqual([w.b.id]);
  });

  it('ผู้สร้างตอบนัดตัวเอง ไม่แจ้ง', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await h.rows('DELETE FROM notification');
    await answer(w.b, ap.id, 'going');
    expect(await h.count('notification')).toBe(0);
  });

  it('ผู้สร้างออกจากกลุ่มแล้ว หรือบัญชีไม่ active ไม่แจ้ง', async () => {
    const left = await mustCreate(w.b, w.gid);
    expect((await post(w.b.c, `/api/groups/${w.gid}/leave`)).status).toBe(200);
    await h.rows('DELETE FROM notification');
    await answer(w.c, left.id, 'going');
    expect(await recipients('appointment.rsvp_changed')).toEqual([]);

    const suspended = await mustCreate(w.m, w.gid, { title: 'อีกนัด' });
    await h.rows('DELETE FROM notification');
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [w.m.id]);
    await answer(w.c, suspended.id, 'going');
    expect(await recipients('appointment.rsvp_changed')).toEqual([]);
  });

  it('เข้ากลุ่มซ้ำด้วยโค้ด (เป็นสมาชิกอยู่แล้ว) ไม่แจ้ง · role ไม่เปลี่ยน ไม่แจ้ง', async () => {
    const code = (await post<{ invite: { code: string } }>(w.a.c, `/api/groups/${w.gid}/invites/code`)).data.invite.code;
    const r = await post<{ alreadyMember: boolean }>(w.c.c, '/api/invites/redeem', { code });
    expect(r.data.alreadyMember).toBe(true);
    expect((await patch(w.a.c, `/api/groups/${w.gid}/members/${w.m.id}`, { role: 'moderator' })).status).toBe(200);
    expect(await h.count('notification')).toBe(0);
  });

  it('รับคำเชิญตรงทั้งที่เป็นสมาชิกอยู่แล้ว ไม่แจ้ง joined แต่ผู้เชิญยังได้ accepted', async () => {
    const x = await person(h, 'xena');
    const inv = await post<{ invite: { id: string } }>(w.m.c, `/api/groups/${w.gid}/invites/direct`, { username: 'xena' });
    expect(inv.status, inv.text).toBe(201);
    await join(w.a, x, w.gid); // เข้าด้วยโค้ดก่อนจะกดรับคำเชิญตรง
    await h.rows('DELETE FROM notification');
    const r = await post<{ alreadyMember: boolean }>(x.c, `/api/me/invites/${inv.data.invite.id}/accept`);
    expect(r.status, r.text).toBe(200);
    expect(r.data.alreadyMember).toBe(true);
    expect(await recipients('group.member.joined')).toEqual([]);
    expect(await recipients('group.invite.accepted')).toEqual([w.m.id]);
  });

  it('ปฏิเสธคำเชิญตรง ไม่แจ้ง joined', async () => {
    const x = await person(h, 'xena');
    const inv = await post<{ invite: { id: string } }>(w.m.c, `/api/groups/${w.gid}/invites/direct`, { username: 'xena' });
    expect((await post(x.c, `/api/me/invites/${inv.data.invite.id}/decline`)).status).toBe(200);
    expect(await recipients('group.member.joined')).toEqual([]);
  });
});

describe('R11-3 แทนที่รายการที่ยังไม่อ่าน', () => {
  it('appointment.updated: ยังไม่อ่าน → แทนที่ · อ่านแล้ว → แถวใหม่ · นัดอื่นไม่แตะ', async () => {
    const ap = await mustCreate(w.b, w.gid);
    const other = await mustCreate(w.b, w.gid, { title: 'อีกนัด' });
    await h.rows('DELETE FROM notification');
    await patch(w.b.c, `/api/appointments/${other.id}`, { placeName: 'ร้านอื่น' });
    await patch(w.b.c, `/api/appointments/${ap.id}`, { placeName: 'ร้าน 1' });
    h.clock.advance(1000);
    await patch(w.b.c, `/api/appointments/${ap.id}`, NEW_TIME);

    let rows = await h.rows<{ params: string }>("SELECT params FROM notification WHERE user_id = ? AND kind = 'appointment.updated' AND json_extract(params, '$.appointmentId') = ?", [w.a.id, ap.id]);
    expect(rows).toHaveLength(1);
    expect((JSON.parse(rows[0]!.params) as { changes: string }).changes).toBe('time');
    expect(await h.count("notification WHERE user_id = ? AND kind = 'appointment.updated' AND json_extract(params, '$.appointmentId') = ?", [w.a.id, other.id])).toBe(1);

    await markAllRead(w.a);
    h.clock.advance(1000);
    await patch(w.b.c, `/api/appointments/${ap.id}`, { placeName: 'ร้าน 3' });
    rows = await h.rows("SELECT params FROM notification WHERE user_id = ? AND kind = 'appointment.updated' AND json_extract(params, '$.appointmentId') = ?", [w.a.id, ap.id]);
    expect(rows).toHaveLength(2);
    expect(await h.count("notification WHERE user_id = ? AND read_at IS NULL AND kind = 'appointment.updated' AND json_extract(params, '$.appointmentId') = ?", [w.a.id, ap.id])).toBe(1);
  });

  it('appointment.rsvp_changed: ผู้ตอบคนเดิมแทนที่ · คนละคน = คนละแถว · อ่านแล้ว = แถวใหม่', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await h.rows('DELETE FROM notification');
    await answer(w.c, ap.id, 'going');
    await answer(w.m, ap.id, 'maybe');
    h.clock.advance(1000);
    await answer(w.c, ap.id, 'not_going');
    const unread = await paramsFor(w.b.id, 'appointment.rsvp_changed');
    expect(unread).toHaveLength(2);
    expect(unread.map((p) => p.responderName).sort()).toEqual([w.c.displayName, w.m.displayName].sort());
    expect(unread.find((p) => p.responderName === w.c.displayName)!.response).toBe('not_going');

    await markAllRead(w.b);
    h.clock.advance(1000);
    await answer(w.c, ap.id, 'going');
    expect(await paramsFor(w.b.id, 'appointment.rsvp_changed')).toHaveLength(3);
    expect(await h.count("notification WHERE user_id = ? AND read_at IS NULL AND kind = 'appointment.rsvp_changed'", [w.b.id])).toBe(1);
  });

  it('ชนิดอื่นไม่รวมรายการ', async () => {
    const x = await person(h, 'xena');
    const y = await person(h, 'yuki');
    await join(w.a, x, w.gid);
    await join(w.a, y, w.gid);
    expect(await paramsFor(w.a.id, 'group.member.joined')).toHaveLength(2);
  });
});

describe('R11-6 transaction เดียวกับการกระทำ', () => {
  const failNotifications = () => h.rows("CREATE TRIGGER fail_notif BEFORE INSERT ON notification BEGIN SELECT RAISE(ABORT, 'BOOM'); END");

  it('ยกเลิกนัด: เขียนแจ้งเตือนล้ม → นัดไม่ถูกยกเลิก · ไม่มีแถว', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await h.rows('DELETE FROM notification');
    await failNotifications();
    expect((await cancel(w.b, ap.id)).status).toBe(500);
    expect(await h.rows('SELECT status FROM appointment WHERE id = ?', [ap.id])).toEqual([{ status: 'active' }]);
    expect(await h.count('notification')).toBe(0);
  });

  it('แก้นัด / RSVP / ออกกลุ่ม / นำออก / เปลี่ยน role / โอน admin: ล้ม → การกระทำไม่เกิด', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await h.rows('DELETE FROM notification');
    await failNotifications();
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { placeName: 'ร้าน' })).status).toBe(500);
    expect((await h.rows<{ place_name: string | null }>('SELECT place_name FROM appointment WHERE id = ?', [ap.id]))[0]!.place_name).toBeNull();
    expect((await put(w.c.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' })).status).toBe(500);
    expect(await h.count('appointment_rsvp')).toBe(0);
    expect((await post(w.c.c, `/api/groups/${w.gid}/leave`)).status).toBe(500);
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [w.gid, w.c.id])).toBe(1);
    expect((await call(w.a.c, 'DELETE', `/api/groups/${w.gid}/members/${w.c.id}`)).status).toBe(500);
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [w.gid, w.c.id])).toBe(1);
    expect((await patch(w.a.c, `/api/groups/${w.gid}/members/${w.c.id}`, { role: 'moderator' })).status).toBe(500);
    expect((await h.rows<{ role: string }>('SELECT role FROM group_member WHERE group_id = ? AND user_id = ?', [w.gid, w.c.id]))[0]!.role).toBe('member');
    expect((await post(w.a.c, `/api/groups/${w.gid}/transfer-admin`, { toUserId: w.c.id })).status).toBe(500);
    expect((await h.rows<{ role: string }>('SELECT role FROM group_member WHERE group_id = ? AND user_id = ?', [w.gid, w.a.id]))[0]!.role).toBe('admin');
    expect(await h.count('notification')).toBe(0);
  });

  it('เข้ากลุ่มด้วยโค้ด: ล้ม → ไม่เป็นสมาชิก', async () => {
    const x = await person(h, 'xena');
    const code = (await post<{ invite: { code: string } }>(w.a.c, `/api/groups/${w.gid}/invites/code`)).data.invite.code;
    await failNotifications();
    expect((await post(x.c, '/api/invites/redeem', { code })).status).toBe(500);
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [w.gid, x.id])).toBe(0);
  });
});

describe('R11-7 ลบบัญชีแล้วชื่อถูกล้าง', () => {
  it('actorName / responderName / memberName ถูกล้าง · ตัวอ้างอิงภายในหาย · ชื่อคนอื่นไม่ถูกแตะ', async () => {
    const ap = await mustCreate(w.b, w.gid);
    const other = await mustCreate(w.b, w.gid, { title: 'นัดของบ็อบ' });
    await patch(w.c.c, `/api/appointments/${ap.id}`, { placeName: 'จะถูกปฏิเสธเพราะไม่มีสิทธิ์' }).then((r) => expect(r.status).toBe(403));
    await answer(w.c, ap.id, 'going');
    await answer(w.m, ap.id, 'maybe');
    await patch(w.m.c, `/api/appointments/${ap.id}`, { placeName: 'ร้าน m' });
    await patch(w.m.c, `/api/appointments/${other.id}`, { placeName: 'ร้าน m2' });
    const x = await person(h, 'xena');
    await join(w.a, x, w.gid);
    await answer(x, ap.id, 'going');
    expect((await patch(w.a.c, `/api/groups/${w.gid}/members/${x.id}`, { role: 'moderator' })).status).toBe(200);
    await patch(x.c, `/api/appointments/${other.id}`, { placeName: 'ร้าน x' });
    expect((await patch(w.a.c, `/api/groups/${w.gid}/members/${x.id}`, { role: 'member' })).status).toBe(200);
    await h.rows('UPDATE notification SET read_at = created_at'); // ไม่ให้แถวถูกแทนที่ระหว่างทาง
    await patch(w.m.c, `/api/appointments/${other.id}`, { placeName: 'ร้าน m3' });

    expect((await post(x.c, '/api/me/delete', { pin: GOOD_PIN })).status).toBe(200);

    const scrubbed = await h.rows<{ kind: string; params: string }>(
      "SELECT kind, params FROM notification WHERE (json_extract(params, '$.memberId') = ? OR json_extract(params, '$.responderId') = ? OR json_extract(params, '$.actorId') = ?)",
      [x.id, x.id, x.id],
    );
    expect(scrubbed).toEqual([]);
    const rsvp = await paramsFor(w.b.id, 'appointment.rsvp_changed');
    const fromX = rsvp.filter((p) => !p.responderId);
    expect(fromX).toHaveLength(1);
    expect(fromX[0]).toMatchObject({ responderName: '', response: 'going' });
    expect(rsvp.some((p) => p.responderId === w.m.id && p.responderName === w.m.displayName)).toBe(true);
    const joined = await paramsFor(w.a.id, 'group.member.joined');
    expect(joined[0]).toMatchObject({ memberName: '' });
    expect(joined[0]).not.toHaveProperty('memberId');
    const updated = (await paramsFor(w.a.id, 'appointment.updated')).filter((p) => p.actorId === undefined);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ actorName: '' });
    expect((await paramsFor(w.a.id, 'appointment.updated')).some((p) => p.actorId === w.m.id && p.actorName === w.m.displayName)).toBe(true);
  });

  it('ออกจากกลุ่มแล้วลบบัญชี: memberName ใน left ถูกล้างด้วย', async () => {
    expect((await post(w.c.c, `/api/groups/${w.gid}/leave`)).status).toBe(200);
    expect((await post(w.c.c, '/api/me/delete', { pin: GOOD_PIN })).status).toBe(200);
    const left = await paramsFor(w.a.id, 'group.member.left');
    expect(left[0]).toMatchObject({ memberName: '' });
    expect(left[0]).not.toHaveProperty('memberId');
  });
});

describe('LINE ปิด/after นอก request scope', () => {
  it('ไม่มี env LINE: กระดิ่งขึ้น outbox ว่าง (ปิดเงียบ)', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await answer(w.c, ap.id, 'going');
    await linkLine(h, w.c.id, LINE_A);
    expect((await cancel(w.b, ap.id)).status).toBe(200);
    expect(await recipients('appointment.cancelled')).toContain(w.c.id);
    expect(await h.count('notification_outbox')).toBe(0);
  });

  it('after() นอก request scope (Vitest) ไม่ทำให้ยกเลิกนัดล้ม · แถวยังอยู่ให้ cron', async () => {
    enableLineEnv();
    const ap = await mustCreate(w.b, w.gid);
    await answer(w.c, ap.id, 'going');
    await linkLine(h, w.c.id, LINE_A);
    expect((await cancel(w.b, ap.id)).status).toBe(200);
    expect(await h.rows('SELECT status, attempts FROM notification_outbox')).toEqual([{ status: 'pending', attempts: 0 }]);
  });
});
