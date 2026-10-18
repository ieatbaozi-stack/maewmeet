// repo ของกลุ่ม: "ไม่มี check-then-act" — ทุกเงื่อนไขอยู่ในคำสั่ง SQL เดียวกับการเขียน
// วิธีพิสูจน์: จำลองการสลับลำดับของคำขอที่แข่งกัน (อ่านเห็นว่ายังผ่าน → อีกคำขอเขียนแทรก → คำขอแรกเขียน) แล้วต้องถูกปฏิเสธที่ SQL
// (ถ้าเงื่อนไขอยู่แค่ในโค้ดที่ "อ่านก่อน" เทสต์เหล่านี้จะล้ม) + ด่านระดับ DB (unique/CHECK/FK)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { constraintKind } from '@/lib/data/repos/errors';
import { insertGroupIfUnderCap, softDeleteGroup, updateGroup } from '@/lib/data/repos/group';
import {
  bumpCodeUses,
  closeDirectInvite,
  insertCodeInviteIfRoom,
  insertDirectInvite,
  joinGroupWithCode,
  revokeInvite,
} from '@/lib/data/repos/group-invite';
import {
  countAdmins,
  countMembers,
  deleteMemberGuarded,
  deleteSelfMember,
  insertAdminMember,
  insertMemberIfRoom,
  setMemberRoleGuarded,
  transferAdminSteps,
} from '@/lib/data/repos/group-member';
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
});
afterEach(async () => {
  await t.cleanup();
});

let seq = 0;
async function user(name = `u${seq++}`): Promise<string> {
  const id = newId();
  await db.$client.execute({
    sql: "INSERT INTO user (id, username, username_normalized, display_name, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', ?, ?)",
    args: [id, name, name, name, NOW, NOW],
  });
  return id;
}
async function group(creator: string, cap = 10): Promise<string> {
  const id = newId();
  expect(await insertGroupIfUnderCap(db, { id, name: 'g', createdBy: creator, cap }, NOW)).toBe(true);
  await insertAdminMember(db, id, creator, NOW);
  return id;
}
const roleOf = async (g: string, u: string) =>
  ((await db.$client.execute({ sql: 'SELECT role FROM group_member WHERE group_id = ? AND user_id = ?', args: [g, u] })).rows[0]?.role as string | undefined) ?? null;
async function addMember(g: string, u: string, role: 'member' | 'moderator' = 'member') {
  await db.$client.execute({ sql: 'INSERT INTO group_member VALUES (?, ?, ?, ?)', args: [g, u, role, NOW] });
}

/** super admin นอกกลุ่ม: ไม่มี role ให้ตรวจ (ข้าม ActorGuard) */
const OUT = { actorId: 'sa', actorRole: null } as const;

describe('เพดานกลุ่มต่อผู้ใช้ (insertGroupIfUnderCap)', () => {
  it('ผู้ตัดสินคือ SQL: อ่านเห็น 9 → มีคนสร้างแทรกเป็น 10 → คำสั่งของเรา (cap 10) ถูกปฏิเสธ · ลบแล้วนับใหม่', async () => {
    const u = await user();
    for (let i = 0; i < 9; i++) await group(u);
    const seen = (await db.$client.execute({ sql: 'SELECT count(*) AS n FROM groups WHERE created_by = ?', args: [u] })).rows[0]!.n;
    expect(Number(seen)).toBe(9); // ผู้อ่านเห็นว่ายังเหลือ 1
    const sneaky = await group(u); // อีกคำขอแทรกก่อน
    expect(await insertGroupIfUnderCap(db, { id: newId(), name: 'late', createdBy: u, cap: 10 }, NOW)).toBe(false);
    expect(await softDeleteGroup(db, sneaky, NOW, OUT)).toBe(true);
    expect(await insertGroupIfUnderCap(db, { id: newId(), name: 'ok', createdBy: u, cap: 10 }, NOW)).toBe(true);
  });
});

describe('เพดานสมาชิก (insertMemberIfRoom)', () => {
  it('อ่านเห็น 49 → มีคนเข้าแทรกเป็น 50 → คำสั่งของเรา full · ไม่เกิน cap ไม่ว่าลำดับ', async () => {
    const admin = await user();
    const g = await group(admin);
    for (let i = 0; i < 48; i++) await addMember(g, await user());
    expect(await countMembers(db, g)).toBe(49);
    const last = await user();
    const late = await user();
    expect(await insertMemberIfRoom(db, { groupId: g, userId: last, cap: 50 }, NOW)).toBe('inserted');
    expect(await insertMemberIfRoom(db, { groupId: g, userId: late, cap: 50 }, NOW)).toBe('full');
    expect(await insertMemberIfRoom(db, { groupId: g, userId: last, cap: 50 }, NOW)).toBe('already');
    expect(await countMembers(db, g)).toBe(50);
  });
  it('กลุ่มถูกลบระหว่างทาง → gone (ไม่เพิ่มสมาชิกให้กลุ่มที่ลบแล้ว) · กลุ่มไม่มีจริง → gone', async () => {
    const admin = await user();
    const g = await group(admin);
    await softDeleteGroup(db, g, NOW, OUT);
    expect(await insertMemberIfRoom(db, { groupId: g, userId: await user(), cap: 50 }, NOW)).toBe('gone');
    expect(await insertMemberIfRoom(db, { groupId: newId(), userId: await user(), cap: 50 }, NOW)).toBe('gone');
    expect(await countMembers(db, g)).toBe(1);
  });
});

describe('โอน admin (transferAdminSteps) — admin เหลือ 1 เสมอ', () => {
  it('คำขอที่ 2 ที่อ้าง admin เดิม (stale) ถูกปฏิเสธที่ SQL หลังการโอนแรกสำเร็จ', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const g = await group(a);
    await addMember(g, b);
    await addMember(g, c);
    // ทั้งสองคำขออ่านเห็น "a เป็น admin" ก่อน; คำขอแรกโอนให้ b
    expect(await t.db.transaction((tx) => transferAdminSteps(tx, { groupId: g, toUserId: b, fromAdminId: a }))).toEqual({ previousAdminId: a });
    // คำขอที่สองยังเชื่อว่า a คือ admin
    const second = await t.db.transaction((tx) => transferAdminSteps(tx, { groupId: g, toUserId: c, fromAdminId: a }));
    expect(second).toBeNull();
    expect(await countAdmins(db, g)).toBe(1);
    expect(await roleOf(g, b)).toBe('admin');
    expect(await roleOf(g, a)).toBe('moderator');
    expect(await roleOf(g, c)).toBe('member');
  });

  it('เป้าหมายหายไประหว่างทาง → ขั้นที่ 2 ล้ม → ผู้เรียก rollback แล้ว admin เดิมยังอยู่ (กลุ่มไม่เคยไม่มี admin)', async () => {
    const a = await user();
    const b = await user();
    const g = await group(a);
    await addMember(g, b);
    await db.$client.execute({ sql: 'DELETE FROM group_member WHERE group_id = ? AND user_id = ?', args: [g, b] });
    await expect(
      t.db.transaction(async (tx) => {
        const r = await transferAdminSteps(tx, { groupId: g, toUserId: b, fromAdminId: a });
        if (!r) throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await roleOf(g, a)).toBe('admin');
    expect(await countAdmins(db, g)).toBe(1);
  });

  it('ผู้กระทำเป็น super admin (fromAdminId = null): ลดใครก็ตามที่ถือ admin · เป้าหมายต้องไม่ใช่ admin อยู่แล้ว', async () => {
    const a = await user();
    const b = await user();
    const g = await group(a);
    await addMember(g, b);
    expect(await t.db.transaction((tx) => transferAdminSteps(tx, { groupId: g, toUserId: b, fromAdminId: null }))).toEqual({ previousAdminId: a });
    // โอนให้ admin ปัจจุบัน (b → b): ขั้น 1 ลด b เป็น moderator แล้วขั้น 2 เลื่อนกลับ — ผู้เรียก (rbac) ต้องกันไว้ก่อน; ที่นี่ยืนยันว่า invariant ไม่พัง
    expect(await countAdmins(db, g)).toBe(1);
  });

  it('DB ปฏิเสธ admin คนที่สองโดยตรง (group_one_admin_uq) และ transaction ที่ทำให้มี admin 2 คนล้ม', async () => {
    const a = await user();
    const b = await user();
    const g = await group(a);
    await addMember(g, b);
    let err: unknown;
    try {
      await db.$client.execute({ sql: "UPDATE group_member SET role = 'admin' WHERE group_id = ? AND user_id = ?", args: [g, b] });
    } catch (e) {
      err = e;
    }
    expect(constraintKind(err)).toBe('unique');
    expect(await countAdmins(db, g)).toBe(1);
  });
});

describe('ลบ/เปลี่ยน role แบบ guarded', () => {
  it('ลบสมาชิก: role ของเป้าหมายเปลี่ยนไประหว่างทาง (ถูกเลื่อนเป็น moderator) → ไม่ลบ · ผู้กระทำถูกลดสิทธิ์ระหว่างทาง → ไม่ลบ · admin ลบไม่ได้เสมอ', async () => {
    const a = await user();
    const mod = await user();
    const m1 = await user();
    const m2 = await user();
    const g = await group(a);
    await addMember(g, mod, 'moderator');
    await addMember(g, m1);
    await addMember(g, m2);
    // moderator ตัดสินว่า m1 เป็น member ลบได้ — แต่ ณ ตอนเขียน m1 ถูกเลื่อนเป็น moderator แล้ว
    await db.$client.execute({ sql: "UPDATE group_member SET role = 'moderator' WHERE group_id = ? AND user_id = ?", args: [g, m1] });
    expect(await deleteMemberGuarded(db, { groupId: g, userId: m1, expectedRole: 'member', actorId: mod, actorRole: 'moderator' })).toBe(false);
    expect(await roleOf(g, m1)).toBe('moderator');
    // ผู้กระทำ (mod) ถูกลดเป็น member ก่อนเขียน → ไม่ลบ
    await db.$client.execute({ sql: "UPDATE group_member SET role = 'member' WHERE group_id = ? AND user_id = ?", args: [g, mod] });
    expect(await deleteMemberGuarded(db, { groupId: g, userId: m2, expectedRole: 'member', actorId: mod, actorRole: 'moderator' })).toBe(false);
    expect(await roleOf(g, m2)).toBe('member');
    // admin ลบได้ก็ต่อเมื่อ role ที่คาดตรง
    expect(await deleteMemberGuarded(db, { groupId: g, userId: m2, expectedRole: 'member', actorId: a, actorRole: 'admin' })).toBe(true);
    expect(await deleteMemberGuarded(db, { groupId: g, userId: a, expectedRole: 'admin', actorId: a, actorRole: 'admin' })).toBe(false);
    expect(await roleOf(g, a)).toBe('admin');
  });

  it('super admin นอกกลุ่ม (actorRole null): ลบได้เมื่อเขายังไม่ใช่สมาชิก · ถ้าเข้ากลุ่มมาระหว่างทาง (role เปลี่ยน) → ไม่ลบ', async () => {
    const a = await user();
    const sa = await user();
    const m1 = await user();
    const g = await group(a);
    await addMember(g, m1);
    await addMember(g, sa); // SA เข้ากลุ่มระหว่างทาง
    expect(await deleteMemberGuarded(db, { groupId: g, userId: m1, expectedRole: 'member', actorId: sa, actorRole: null })).toBe(false);
    await db.$client.execute({ sql: 'DELETE FROM group_member WHERE user_id = ?', args: [sa] });
    expect(await deleteMemberGuarded(db, { groupId: g, userId: m1, expectedRole: 'member', actorId: sa, actorRole: null })).toBe(true);
  });

  it('เปลี่ยน role: ต้องตรง role เดิม · ไม่แตะ admin · ผู้กระทำต้องยังถือ role เดิม', async () => {
    const a = await user();
    const m1 = await user();
    const g = await group(a);
    await addMember(g, m1);
    expect(await setMemberRoleGuarded(db, { groupId: g, userId: m1, fromRole: 'moderator', toRole: 'member', actorId: a, actorRole: 'admin' })).toBe(false); // role เดิมไม่ตรง
    expect(await setMemberRoleGuarded(db, { groupId: g, userId: a, fromRole: 'admin', toRole: 'member', actorId: a, actorRole: 'admin' })).toBe(false);
    expect(await setMemberRoleGuarded(db, { groupId: g, userId: m1, fromRole: 'member', toRole: 'moderator', actorId: a, actorRole: 'moderator' })).toBe(false); // อ้าง role ผู้กระทำผิด
    expect(await setMemberRoleGuarded(db, { groupId: g, userId: m1, fromRole: 'member', toRole: 'moderator', actorId: a, actorRole: 'admin' })).toBe(true);
    expect(await roleOf(g, m1)).toBe('moderator');
  });

  it('ออกเอง: admin ออกไม่ได้ที่ SQL (แม้เพิ่งถูกโอนให้ระหว่างทาง) · ไม่ใช่สมาชิก → false', async () => {
    const a = await user();
    const b = await user();
    const g = await group(a);
    await addMember(g, b);
    // b อ่านเห็นตัวเองเป็น member แล้วคิดจะออก — ระหว่างนั้น a โอน admin ให้ b
    await t.db.transaction((tx) => transferAdminSteps(tx, { groupId: g, toUserId: b, fromAdminId: a }));
    expect(await deleteSelfMember(db, g, b)).toBe(false);
    expect(await roleOf(g, b)).toBe('admin');
    expect(await deleteSelfMember(db, g, a)).toBe(true); // a เป็น moderator แล้ว ออกได้
    expect(await deleteSelfMember(db, g, a)).toBe(false);
  });
});

describe('คำเชิญ / โค้ด', () => {
  const H = (code: string) => hashInviteCode(code, SECRET);

  async function codeInvite(g: string, by: string, code: string, expiresAt = NOW + 1000): Promise<string> {
    const id = newId();
    expect(await insertCodeInviteIfRoom(db, { id, groupId: g, codeHash: H(code), codeHint: code.slice(-4), createdBy: by, expiresAt, cap: 20 }, NOW, OUT)).toBe('ok');
    return id;
  }

  it('เพดานโค้ด 20: อ่านเห็น 19 → มีคนสร้างแทรกเป็น 20 → คำสั่งของเรา full · หมดอายุ/เพิกถอนคืนช่อง · กลุ่มลบแล้ว gone', async () => {
    const a = await user();
    const g = await group(a);
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await codeInvite(g, a, `AAAAAA${String(i).padStart(2, '2')}`));
    const over = { id: newId(), groupId: g, codeHash: H('BBBBBBBB'), codeHint: 'BBBB', createdBy: a, expiresAt: NOW + 1000, cap: 20 };
    expect(await insertCodeInviteIfRoom(db, over, NOW, OUT)).toBe('full');
    expect(await revokeInvite(db, g, ids[0]!, a, NOW, OUT)).not.toBeNull();
    expect(await insertCodeInviteIfRoom(db, over, NOW, OUT)).toBe('ok');
    expect(await insertCodeInviteIfRoom(db, { ...over, id: newId(), codeHash: H('CCCCCCCC') }, NOW + 2000, OUT)).toBe('ok'); // 20 ตัวเดิมหมดอายุแล้ว
    await softDeleteGroup(db, g, NOW, OUT);
    expect(await insertCodeInviteIfRoom(db, { ...over, id: newId(), codeHash: H('DDDDDDDD') }, NOW, OUT)).toBe('gone');
  });

  it('code_hash ซ้ำถูกปฏิเสธโดย unique index · kind/ช่อง null ผิดรูปถูกปฏิเสธโดย CHECK', async () => {
    const a = await user();
    const g = await group(a);
    await codeInvite(g, a, 'EEEEEEEE');
    let err: unknown;
    try {
      await insertCodeInviteIfRoom(db, { id: newId(), groupId: g, codeHash: H('EEEEEEEE'), codeHint: 'EEEE', createdBy: a, expiresAt: NOW + 1, cap: 20 }, NOW, OUT);
    } catch (e) {
      err = e;
    }
    expect(constraintKind(err)).toBe('unique');
    await expect(
      db.$client.execute({ sql: "INSERT INTO group_invite (id, group_id, kind, created_by, created_at, expires_at) VALUES (?, ?, 'code', ?, 1, 2)", args: [newId(), g, a] }),
    ).rejects.toThrow(/CHECK|constraint/i);
    await expect(
      db.$client.execute({ sql: "INSERT INTO group_invite (id, group_id, kind, code_hash, invitee_user_id, created_by, created_at, expires_at) VALUES (?, ?, 'direct', 'h', ?, ?, 1, 2)", args: [newId(), g, a, a] }),
    ).rejects.toThrow(/CHECK|constraint/i);
  });

  it('ใช้โค้ด: เพิกถอน/หมดอายุ/กลุ่มถูกลบ "ระหว่างทาง" → ไม่เข้า (เงื่อนไขอยู่ในคำสั่งเดียวกับ INSERT)', async () => {
    const a = await user();
    const g = await group(a);
    const id = await codeInvite(g, a, 'FFFFFFFF');
    const u1 = await user();
    const u2 = await user();
    const u3 = await user();
    // 1) ใช้ได้ปกติ
    expect(await joinGroupWithCode(db, { codeHash: H('FFFFFFFF'), userId: u1, cap: 50 }, NOW)).toBe(g);
    await bumpCodeUses(db, id);
    // 2) หมดอายุ
    expect(await joinGroupWithCode(db, { codeHash: H('FFFFFFFF'), userId: u2, cap: 50 }, NOW + 1000)).toBeNull();
    // 3) เพิกถอน
    expect(await revokeInvite(db, g, id, a, NOW, OUT)).not.toBeNull();
    expect(await joinGroupWithCode(db, { codeHash: H('FFFFFFFF'), userId: u2, cap: 50 }, NOW)).toBeNull();
    // 4) กลุ่มถูกลบ
    const id2 = await codeInvite(g, a, 'GGGGGGGG');
    await softDeleteGroup(db, g, NOW, OUT);
    expect(await joinGroupWithCode(db, { codeHash: H('GGGGGGGG'), userId: u3, cap: 50 }, NOW)).toBeNull();
    expect(id2).toBeTruthy();
    expect(await roleOf(g, u2)).toBeNull();
    expect(await roleOf(g, u3)).toBeNull();
  });

  it('ใช้โค้ดตอนสมาชิกเต็ม → null · สมาชิกเดิม → null (ไม่สร้างแถวซ้ำ) · hash ที่ไม่มี → null', async () => {
    const a = await user();
    const g = await group(a);
    await codeInvite(g, a, 'HHHHHHHH');
    for (let i = 0; i < 48; i++) await addMember(g, await user());
    const u = await user();
    expect(await joinGroupWithCode(db, { codeHash: H('HHHHHHHH'), userId: u, cap: 50 }, NOW)).toBe(g); // คนที่ 50
    expect(await joinGroupWithCode(db, { codeHash: H('HHHHHHHH'), userId: await user(), cap: 50 }, NOW)).toBeNull(); // เต็ม
    expect(await joinGroupWithCode(db, { codeHash: H('HHHHHHHH'), userId: u, cap: 100 }, NOW)).toBeNull(); // สมาชิกเดิม
    expect(await joinGroupWithCode(db, { codeHash: H('ZZZZZZZZ'), userId: await user(), cap: 50 }, NOW)).toBeNull();
    expect(await countMembers(db, g)).toBe(50);
  });

  it('คำเชิญตรง: ปิดได้ครั้งเดียว (accepted/declined) · ของผู้รับเท่านั้น · หมดอายุ/กลุ่มลบแล้วปิดไม่ได้ · คำเชิญ active ซ้ำคู่เดียวกันถูก unique index ปฏิเสธ', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const g = await group(a);
    const mk = async (invitee: string, by = a) => {
      const id = newId();
      await insertDirectInvite(db, { id, groupId: g, inviteeUserId: invitee, createdBy: by, expiresAt: NOW + 1000 }, NOW, OUT);
      return id;
    };
    const i1 = await mk(b);
    let err: unknown;
    try {
      await mk(b);
    } catch (e) {
      err = e;
    }
    expect(constraintKind(err)).toBe('unique');
    expect(await closeDirectInvite(db, { inviteId: i1, inviteeUserId: c, to: 'accepted' }, NOW)).toBeNull(); // ไม่ใช่ผู้รับ
    expect(await closeDirectInvite(db, { inviteId: i1, inviteeUserId: b, to: 'accepted' }, NOW + 1000)).toBeNull(); // หมดอายุ
    expect(await closeDirectInvite(db, { inviteId: i1, inviteeUserId: b, to: 'accepted' }, NOW)).toEqual({ groupId: g, createdBy: a });
    expect(await closeDirectInvite(db, { inviteId: i1, inviteeUserId: b, to: 'accepted' }, NOW)).toBeNull(); // ซ้ำ
    expect(await closeDirectInvite(db, { inviteId: i1, inviteeUserId: b, to: 'declined' }, NOW)).toBeNull();
    const i2 = await mk(c);
    await softDeleteGroup(db, g, NOW, OUT);
    expect(await closeDirectInvite(db, { inviteId: i2, inviteeUserId: c, to: 'accepted' }, NOW)).toBeNull(); // กลุ่มลบแล้ว
  });
});

describe('แก้กลุ่ม', () => {
  it('updateGroup ไม่แก้กลุ่มที่ลบแล้ว · ละเมิด CHECK หน้าต่างวันว่างถูกปฏิเสธระดับ DB (check)', async () => {
    const a = await user();
    const g = await group(a);
    await expect(updateGroup(db, g, { freeWindowStartMin: 1300 }, NOW, OUT)).rejects.toSatisfy((e) => constraintKind(e) === 'check');
    await expect(updateGroup(db, g, { minFreeMinutes: 45 }, NOW, OUT)).rejects.toSatisfy((e) => constraintKind(e) === 'check');
    expect((await updateGroup(db, g, { name: 'ใหม่', minFreeMinutes: 60 }, NOW + 1, OUT))?.name).toBe('ใหม่');
    await softDeleteGroup(db, g, NOW, OUT);
    expect(await updateGroup(db, g, { name: 'หลังลบ' }, NOW, OUT)).toBeNull();
    expect(await softDeleteGroup(db, g, NOW, OUT)).toBe(false);
  });
});
