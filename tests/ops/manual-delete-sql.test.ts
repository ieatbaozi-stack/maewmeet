// OPS (#10) R5 — docs/OPERATIONS.md I3.2 "ลบบัญชีด้วยมือ": SQL ในเอกสารรันได้จริงบน schema ปัจจุบัน และให้ผลเท่ากับ POST /api/me/delete
// (เทียบทีละข้อกับ R5_CONTRACT §2 ข้อ 2) · แถว audit ที่สร้างมีรูป UUID (cursor ของ /api/admin/audit ตรวจรูปนี้)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOOD_PIN } from '../auth/harness';
import { Client, get, join, makeGroup, mustCreate, person, post, put, setupHarness, type Harness, type Person } from '../appointments/util';

const doc = readFileSync(path.join(process.cwd(), 'docs/OPERATIONS.md'), 'utf8');
const i3 = doc.slice(doc.indexOf('### I3'), doc.indexOf('## ภาคผนวก: ตารางสรุปตัวแปร env'));
const SQL = /```sql\n([\s\S]*?)```/.exec(i3)?.[1] ?? '';

let h: Harness;
let a: Person;
let b: Person;
let boss: Person;

beforeEach(async () => {
  h = await setupHarness();
  a = await person(h, 'alice');
  b = await person(h, 'bob');
  boss = await person(h, 'boss', { admin: true });
});
afterEach(async () => {
  await h.cleanup();
});

describe('OPERATIONS I3 — SQL ลบบัญชีด้วยมือ', () => {
  it('เอกสารมีบล็อก SQL ที่เป็นธุรกรรมเดียว และมีตัวแทน USER_ID', () => {
    expect(SQL).toMatch(/^BEGIN;/);
    expect(SQL.trim()).toMatch(/COMMIT;$/);
    expect(SQL).toContain("'USER_ID'");
  });

  it('รันแล้วผลเท่ากับการลบในแอป: session/สมาชิก/busy/RSVP/แจ้งเตือนหาย · คำเชิญปิด · ชื่อ/PIN ล้าง · username ว่าง · audit อ่านได้', async () => {
    const gid = await makeGroup(a, 'ก๊วน');
    await join(a, b, gid);
    const appt = await mustCreate(b, gid);
    expect((await put(a.c, `/api/appointments/${appt.id}/rsvp`, { response: 'going' })).status).toBe(200);
    expect((await put(b.c, `/api/appointments/${appt.id}/rsvp`, { response: 'going' })).status).toBe(200);
    expect((await post(b.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-10-24', endDate: '2026-10-24', note: 'ลับ' })).status).toBe(201);
    expect((await post(b.c, `/api/groups/${gid}/invites/code`)).status).toBe(201);
    // คำเชิญตรงที่ bob ได้รับ (จากกลุ่มอื่นของ alice) → alice ได้แจ้งเตือนเมื่อ bob ตอบ (ไม่ตอบ = ค้าง active)
    const g2 = await makeGroup(a, 'ก๊วนสอง');
    expect((await post(a.c, `/api/groups/${g2}/invites/direct`, { username: 'bob' })).status).toBe(201);

    await h.rows(
      "INSERT INTO pin_reset_request (id, user_id, status, device_token_hash, requester_ua, requester_country, requested_at, pending_expires_at) VALUES ('rq', ?, 'pending', 'x', 'iPhone · Safari', 'TH', ?, ?)",
      [b.id, h.clock.now(), h.clock.now() + 86_400_000],
    );
    // R14a: กิจวัตร + skip ของ bob ต้องหายด้วย (alice มีกิจวัตรของตัวเอง ต้องไม่ถูกแตะ)
    for (const [rid, uid] of [['rt-b', b.id], ['rt-a', a.id]] as const) {
      await h.rows(
        "INSERT INTO busy_routine (id, user_id, all_day, weekdays, range_kind, start_date, end_date, created_at, updated_at) VALUES (?, ?, 1, 2, 'weeks', '2026-10-26', '2026-11-22', ?, ?)",
        [rid, uid, h.clock.now(), h.clock.now()],
      );
      await h.rows("INSERT INTO busy_routine_skip (routine_id, local_date) VALUES (?, '2026-11-02')", [rid]);
    }
    const run = SQL.replaceAll('USER_ID', b.id);
    await h.db.$client.executeMultiple(run);

    const [u] = await h.rows<{ status: string; username: string; display_name: string; pin_hash: string | null; deleted_at: number | null }>(
      'SELECT status, username, display_name, pin_hash, deleted_at FROM user WHERE id = ?',
      [b.id],
    );
    expect(u).toMatchObject({ status: 'deleted', username: `deleted-${b.id}`, display_name: '', pin_hash: null });
    expect(u!.deleted_at).toBeGreaterThan(0);
    expect(await h.count('session WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count('group_member WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count('busy_block WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count('busy_routine WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count("busy_routine_skip WHERE routine_id = 'rt-b'")).toBe(0);
    expect(await h.count('busy_routine WHERE user_id = ?', [a.id])).toBe(1);
    expect(await h.count("busy_routine_skip WHERE routine_id = 'rt-a'")).toBe(1);
    expect(await h.count('appointment_rsvp WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count('notification WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count("group_invite WHERE created_by = ? AND status = 'active'", [b.id])).toBe(0);
    expect(await h.count("group_invite WHERE invitee_user_id = ? AND status = 'active'", [b.id])).toBe(0);
    expect(await h.count('pin_reset_request WHERE user_id = ? AND (requester_ua IS NOT NULL OR requester_country IS NOT NULL)', [b.id])).toBe(0);
    // นัดยังอยู่ · ผู้สร้างแสดงเป็น null (ไม่ใช่สมาชิกแล้ว)
    const view = await get<{ appointment: { createdBy: unknown } }>(a.c, `/api/appointments/${appt.id}`);
    expect(view.status).toBe(200);
    expect(view.json.data?.appointment.createdBy).toBeNull();
    // เข้าไม่ได้ · ชื่อเดิมสมัครใหม่ได้
    expect((await new Client().login('bob', GOOD_PIN)).code).toBe('INVALID_CREDENTIALS');
    expect((await new Client().post('/api/auth/signup', { username: 'bob', displayName: 'บ๊อบคนใหม่', pin: GOOD_PIN, pinConfirm: GOOD_PIN })).status).toBe(201);
    // audit: แถว user.delete (ผู้ทำ = ระบบ) · id รูป UUID → หน้า audit แบ่งหน้าผ่านแถวนี้ได้
    const [row] = await h.rows<{ id: string; actor_id: string | null }>("SELECT id, actor_id FROM audit_log WHERE action = 'user.delete' AND target_id = ?", [b.id]);
    expect(row!.actor_id).toBeNull();
    expect(row!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const page1 = await get<{ entries: { id: string }[]; nextCursor: string | null }>(boss.c, `/api/admin/audit?targetId=${b.id}&limit=1`);
    expect(page1.status).toBe(200);
    expect(page1.json.data?.entries[0]?.id).toBe(row!.id);
  });

  it('Security R5 L6: บัญชีที่ถูกระงับลบด้วย SQL นี้ได้ (ทางที่คู่มือแนะนำ: ระงับก่อน แล้วค่อยลบ)', async () => {
    expect((await post(boss.c, `/api/admin/users/${b.id}/suspend`)).status).toBe(200);
    await h.db.$client.executeMultiple(SQL.replaceAll('USER_ID', b.id));
    const [u] = await h.rows<{ status: string; display_name: string; pin_hash: string | null }>('SELECT status, display_name, pin_hash FROM user WHERE id = ?', [b.id]);
    expect(u).toMatchObject({ status: 'deleted', display_name: '', pin_hash: null });
    expect(await h.count("audit_log WHERE action = 'user.delete' AND target_id = ?", [b.id])).toBe(1);
  });

  it('ด่าน: super admin / ผู้ดูแลกลุ่มที่ยังอยู่ → ไม่มีอะไรเปลี่ยนเลย (ไม่มีสถานะครึ่งทาง) · รันซ้ำไม่เกิด audit ซ้ำ', async () => {
    const gid = await makeGroup(a, 'ก๊วนของอลิซ');
    await join(a, b, gid);
    const snap = async (id: string) => ({
      user: await h.rows('SELECT * FROM user WHERE id = ?', [id]),
      sessions: await h.count('session WHERE user_id = ?', [id]),
      members: await h.count('group_member WHERE user_id = ?', [id]),
      audit: await h.count('audit_log'),
    });
    for (const p of [boss, a]) {
      const before = await snap(p.id);
      await h.db.$client.executeMultiple(SQL.replaceAll('USER_ID', p.id));
      expect(await snap(p.id), p.id).toEqual(before);
    }
    await h.db.$client.executeMultiple(SQL.replaceAll('USER_ID', b.id));
    await h.db.$client.executeMultiple(SQL.replaceAll('USER_ID', b.id));
    expect(await h.count("audit_log WHERE action = 'user.delete' AND target_id = ?", [b.id])).toBe(1);
  });
});
