// ADR 0003 กฎ membership-guard: การเขียนที่ผู้เรียกตัดสินสิทธิ์จาก role ที่อ่านมา ต้องตรวจซ้ำว่าผู้กระทำ "ยังถือ role นั้น" ในคำสั่ง SQL เดียวกับการเขียน
// วิธีพิสูจน์เหมือน groups-repos.test.ts: จำลองคำขอที่แข่งกัน (A ตัดสินว่า X เป็น admin/สมาชิก → อีกคำขอเปลี่ยน role/ลบ X → A เขียน) แล้วต้องถูกปฏิเสธที่ SQL
// SEC#1: สมาชิกที่ถูกลบกลางทางสร้างโค้ด/คำเชิญตรงไม่ได้ · SEC#4: admin เก่า (หลังโอน) ลบ/แก้กลุ่ม, ผู้ถูกลดสิทธิ์เพิกถอนคำเชิญของคนอื่นไม่ได้
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { findGroupById, insertGroupIfUnderCap, softDeleteGroup, updateGroup } from '@/lib/data/repos/group';
import { insertCodeInviteIfRoom, insertDirectInvite, revokeInvite } from '@/lib/data/repos/group-invite';
import { insertAdminMember, transferAdminSteps, type ActorGuard } from '@/lib/data/repos/group-member';
import { hashInviteCode } from '@/lib/data/invite-code';
import { newId } from '@/lib/shared/id';
import { createTestDb, type TestDb } from '../helpers/db';

let t: TestDb;
let db: Db;
const NOW = 1_800_000_000_000;
const SECRET = Buffer.alloc(32, 7).toString('base64');
beforeEach(async () => {
  t = await createTestDb();
  db = t.db;
  OUT = { actorId: await user(), actorRole: null };
});
afterEach(async () => {
  await t.cleanup();
});

let seq = 0;
async function user(): Promise<string> {
  const id = newId();
  const name = `u${seq++}`;
  await db.$client.execute({
    sql: "INSERT INTO user (id, username, username_normalized, display_name, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', ?, ?)",
    args: [id, name, name, name, NOW, NOW],
  });
  return id;
}
async function group(admin: string): Promise<string> {
  const id = newId();
  expect(await insertGroupIfUnderCap(db, { id, name: 'g', createdBy: admin, cap: 10 }, NOW)).toBe(true);
  await insertAdminMember(db, id, admin, NOW);
  return id;
}
const addMember = (g: string, u: string, role: 'member' | 'moderator' = 'member') =>
  db.$client.execute({ sql: 'INSERT INTO group_member (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', args: [g, u, role, NOW] });
const removeMember = (g: string, u: string) => db.$client.execute({ sql: 'DELETE FROM group_member WHERE group_id = ? AND user_id = ?', args: [g, u] });
const setRole = (g: string, u: string, role: string) =>
  db.$client.execute({ sql: 'UPDATE group_member SET role = ? WHERE group_id = ? AND user_id = ?', args: [role, g, u] });
/** super admin นอกกลุ่ม (user จริง เพราะ created_by/revoked_by เป็น FK) — actorRole null = ข้ามด่าน */
let OUT: ActorGuard;
const mine = (actorId: string, actorRole: ActorGuard['actorRole']): ActorGuard => ({ actorId, actorRole });
const activeInvitesBy = async (u: string) =>
  Number((await db.$client.execute({ sql: "SELECT count(*) AS n FROM group_invite WHERE created_by = ? AND status = 'active'", args: [u] })).rows[0]!.n);

const codeInput = (g: string, by: string, n = newId()) => {
  const code = `AB${n.replace(/[^A-Z2-9]/gi, '').toUpperCase().padEnd(6, '2').slice(0, 6)}`;
  return { id: newId(), groupId: g, codeHash: hashInviteCode(code, SECRET), codeHint: code.slice(-4), createdBy: by, expiresAt: NOW + 1000, cap: 20 };
};

describe('SEC#1 — ผู้สร้างคำเชิญต้องยังเป็นสมาชิก (ถือ role เดิม) ในคำสั่งเดียวกับการสร้าง', () => {
  it('โค้ด: สมาชิกถูกลบหลังตัดสินสิทธิ์ → stale ไม่มีแถว active · ถูกเปลี่ยน role → stale · ยังถือ role เดิม → ok', async () => {
    const a = await user();
    const k = await user();
    const g = await group(a);
    await addMember(g, k);
    expect(await insertCodeInviteIfRoom(db, codeInput(g, k, 'AAAAAA'), NOW, mine(k, 'member'))).toBe('ok');
    await setRole(g, k, 'moderator'); // ถูกเลื่อน/ลดกลางทาง: role ที่ตัดสินสิทธิ์ไว้ (member) ไม่ใช่ของจริงแล้ว
    expect(await insertCodeInviteIfRoom(db, codeInput(g, k, 'BBBBBB'), NOW, mine(k, 'member'))).toBe('stale');
    expect(await insertCodeInviteIfRoom(db, codeInput(g, k, 'CCCCCC'), NOW, mine(k, 'moderator'))).toBe('ok');
    await removeMember(g, k); // ถูกลบ
    const before = await activeInvitesBy(k);
    expect(await insertCodeInviteIfRoom(db, codeInput(g, k, 'DDDDDD'), NOW, mine(k, 'moderator'))).toBe('stale');
    expect(await activeInvitesBy(k)).toBe(before);
  });

  it('โค้ด: super admin นอกกลุ่ม (actorRole null) ข้ามด่านได้ · กลุ่มที่ลบแล้วยัง gone ก่อน stale', async () => {
    const a = await user();
    const g = await group(a);
    expect(await insertCodeInviteIfRoom(db, codeInput(g, OUT.actorId, 'EEEEEE'), NOW, OUT)).toBe('ok');
    await softDeleteGroup(db, g, NOW, mine(a, 'admin'));
    expect(await insertCodeInviteIfRoom(db, codeInput(g, a, 'FFFFFF'), NOW, mine('ghost', 'member'))).toBe('gone');
  });

  it('คำเชิญตรง: สมาชิกถูกลบหลังตัดสินสิทธิ์ → null ไม่มีแถว · ยังเป็นสมาชิก → แถว · super admin นอกกลุ่มผ่าน', async () => {
    const a = await user();
    const k = await user();
    const x = await user();
    const g = await group(a);
    await addMember(g, k);
    const d = (to: string, by: string) => ({ id: newId(), groupId: g, inviteeUserId: to, createdBy: by, expiresAt: NOW + 1000, inviteeCap: 20 });
    expect(await insertDirectInvite(db, d(x, k), NOW, mine(k, 'member'))).toMatchObject({ kind: 'direct', createdBy: k, inviteeUserId: x, status: 'active' });
    await removeMember(g, k);
    const y = await user();
    expect(await insertDirectInvite(db, d(y, k), NOW, mine(k, 'member'))).toBeNull();
    expect(await activeInvitesBy(k)).toBe(1); // เหลือแค่ของเดิมก่อนถูกลบ
    expect(await insertDirectInvite(db, d(y, OUT.actorId), NOW, OUT)).toMatchObject({ createdBy: OUT.actorId }); // SA นอกกลุ่มไม่ถูกด่านนี้กัน
  });
});

describe('SEC#4 — admin เก่า/ผู้ถูกลดสิทธิ์ ทำสิ่งที่ role เดิมเคยอนุญาตไม่ได้แล้ว', () => {
  it('softDeleteGroup + updateGroup: หลังโอน admin → ex-admin ถูกปฏิเสธ กลุ่มยังอยู่ · admin ใหม่ทำได้', async () => {
    const a = await user();
    const b = await user();
    const g = await group(a);
    await addMember(g, b, 'moderator');
    // a ตัดสินสิทธิ์ว่าเป็น admin แล้ว → โอนให้ b ก่อนที่ a จะเขียน
    expect(await t.db.transaction((tx) => transferAdminSteps(tx, { groupId: g, toUserId: b, fromAdminId: a }))).not.toBeNull();
    expect(await softDeleteGroup(db, g, NOW, mine(a, 'admin'))).toBe(false);
    expect(await updateGroup(db, g, { name: 'ยึดกลุ่ม' }, NOW, mine(a, 'admin'))).toBeNull();
    expect((await findGroupById(db, g))?.deletedAt).toBeNull();
    expect((await findGroupById(db, g))?.name).toBe('g');
    expect((await updateGroup(db, g, { name: 'ใหม่' }, NOW, mine(b, 'admin')))?.name).toBe('ใหม่');
    expect(await softDeleteGroup(db, g, NOW, mine(b, 'admin'))).toBe(true);
  });

  it('softDeleteGroup/updateGroup: admin ถูกลบออกจากกลุ่ม (ไม่ใช่สมาชิกแล้ว) ก็ถูกปฏิเสธ · super admin นอกกลุ่มลบ/แก้ได้', async () => {
    const a = await user();
    const g = await group(a);
    await removeMember(g, a);
    expect(await softDeleteGroup(db, g, NOW, mine(a, 'admin'))).toBe(false);
    expect(await updateGroup(db, g, { name: 'x' }, NOW, mine(a, 'admin'))).toBeNull();
    expect((await updateGroup(db, g, { name: 'sa' }, NOW, OUT))?.name).toBe('sa');
    expect(await softDeleteGroup(db, g, NOW, OUT)).toBe(true);
  });

  it('revokeInvite: ผู้เพิกถอนที่ถูกลดสิทธิ์ (mod → member) หรือถูกลบ เพิกถอนโค้ดของคนอื่นไม่ได้ · ยังถือ role เดิมได้', async () => {
    const a = await user();
    const m = await user();
    const g = await group(a);
    await addMember(g, m, 'moderator');
    const mk = async (c: string) => {
      const input = codeInput(g, a, c);
      expect(await insertCodeInviteIfRoom(db, input, NOW, mine(a, 'admin'))).toBe('ok');
      return input.id;
    };
    const i1 = await mk('GGGGGG');
    const i2 = await mk('HHHHHH');
    const i3 = await mk('JJJJJJ');
    await setRole(g, m, 'member'); // m ถูกลดสิทธิ์ระหว่างที่คำขอ "เพิกถอนของ a" ซึ่งอ้างสิทธิ์ moderator อยู่ระหว่างทาง
    expect(await revokeInvite(db, g, i1, m, NOW, mine(m, 'moderator'))).toBeNull();
    await removeMember(g, m);
    expect(await revokeInvite(db, g, i2, m, NOW, mine(m, 'member'))).toBeNull();
    expect(await activeInvitesBy(a)).toBe(3);
    expect(await revokeInvite(db, g, i3, a, NOW, mine(a, 'admin'))).toMatchObject({ status: 'revoked', revokedBy: a });
    expect(await revokeInvite(db, g, i1, OUT.actorId, NOW, OUT)).toMatchObject({ status: 'revoked' });
  });
});
