// repo: busy_block — U7/U8, ADR 0006 · query ล้วน ไม่รู้จัก actor · เวลา = now ที่ผู้เรียก inject
//
// สองทางอ่านที่แยกกันโดยโครงสร้าง (ADR 0006 §2):
//   - ฝั่งเจ้าของ (OwnBusyRow)    : SELECT ทุกคอลัมน์รวม `note` — ใช้เฉพาะ WHERE user_id = <เจ้าของ> เท่านั้น
//   - ฝั่งแชร์   (SharedBusyRow)  : **ไม่ SELECT `note` เลย** และ `title` ถูกตัดใน SQL เมื่อ hide_detail = 1 (CASE) — ตัวอักษรของรายการซ่อนไม่ออกจาก DB
// การเขียนที่แข่งกันได้ (เพดาน 300) = คำสั่ง SQL เดียวที่มีเงื่อนไขในตัว (INSERT … SELECT … WHERE count < cap) เหมือน R2 — ไม่มี check-then-act
// ทุกคำสั่งเขียนผูก user_id ของผู้กระทำ (เจ้าของเท่านั้น) — busy ไม่ผูกกลุ่ม จึงไม่มี role ให้ ActorGuard ตรวจ; ตัวป้องกันคือ user_id + สถานะบัญชียัง active
import { and, asc, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { busyBlock, groupMember } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export type OwnBusyRow = typeof busyBlock.$inferSelect;

/** แถวที่เตรียมให้คนอื่น — ไม่มี note · title เป็น null เมื่อรายการซ่อนรายละเอียด (ตัดใน SQL) */
export type SharedBusyRow = {
  id: string;
  userId: string;
  allDay: boolean;
  startAt: number;
  endAt: number;
  localStartDate: string;
  localEndDate: string;
  tz: string;
  hideDetail: boolean;
  title: string | null;
};

/** ฟิลด์ที่เก็บ (ผลของ normalizeBusyInput + ข้อความ) */
export type BusyWrite = {
  title: string | null;
  note: string | null;
  allDay: boolean;
  startAt: number;
  endAt: number;
  localStartDate: string;
  localEndDate: string;
  tz: string;
  hideDetail: boolean;
};

/** busy ที่ "ยังไม่สิ้นสุด" = end_at > now (end_at เป็น exclusive) */
const activeCount = (userId: string, now: number) =>
  sql`(SELECT count(*) FROM busy_block WHERE user_id = ${userId} AND end_at > ${now})`;

/**
 * เพิ่ม busy ถ้าผู้ใช้ยัง active และมีรายการที่ยังไม่สิ้นสุด < cap — คำสั่งเดียวอะตอมมิก (INSERT … SELECT … WHERE)
 * คืน null = ถูกปฏิเสธ (ผู้เรียกวินิจฉัยด้วย `activeBusyCount` ต่อ — การอ่านนั้นไม่มีผลต่อความปลอดภัย)
 */
export async function insertBusyIfUnderCap(
  db: DbOrTx,
  input: BusyWrite & { id: string; userId: string; cap: number },
  now: number,
): Promise<OwnBusyRow | null> {
  const rows = await db.all<Record<string, unknown>>(sql`
    INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at)
    SELECT ${input.id}, ${input.userId}, ${input.title}, ${input.note}, ${input.allDay ? 1 : 0}, ${input.startAt}, ${input.endAt},
           ${input.localStartDate}, ${input.localEndDate}, ${input.tz}, ${input.hideDetail ? 1 : 0}, ${now}, ${now}
    WHERE EXISTS (SELECT 1 FROM user WHERE id = ${input.userId} AND status = 'active')
      AND ${activeCount(input.userId, now)} < ${input.cap}
    RETURNING id`);
  if (rows.length !== 1) return null;
  return findOwnBusy(db, input.id, input.userId);
}

export async function activeBusyCount(db: DbOrTx, userId: string, now: number): Promise<number> {
  const rows = await db.all<{ n: number }>(sql`SELECT ${activeCount(userId, now)} AS n`);
  return Number(rows[0]?.n ?? 0);
}

/** busy ของ *เจ้าของ* ตาม id — ไม่ใช่เจ้าของ = null (เหมือนไม่มี: IDOR → 404) */
export async function findOwnBusy(db: DbOrTx, id: string, userId: string): Promise<OwnBusyRow | null> {
  const rows = await db
    .select()
    .from(busyBlock)
    .where(and(eq(busyBlock.id, id), eq(busyBlock.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * แก้ busy ของเจ้าของ — คำสั่งเดียว · เพดาน: ถ้ารายการเดิมสิ้นสุดแล้วแต่ค่าใหม่ยังไม่สิ้นสุด (ฟื้นเข้าเขต "ยังไม่สิ้นสุด") ต้องมีที่ว่าง < cap
 * (รายการที่ยังไม่สิ้นสุดอยู่แล้ว หรือค่าใหม่สิ้นสุดแล้ว ไม่เพิ่มจำนวน → ไม่ตรวจ) · คืน null = ไม่มี/ไม่ใช่ของผู้กระทำ/เต็มเพดาน
 */
export async function updateOwnBusyIfUnderCap(
  db: DbOrTx,
  id: string,
  userId: string,
  next: BusyWrite,
  cap: number,
  now: number,
): Promise<OwnBusyRow | null> {
  const rows = await db
    .update(busyBlock)
    .set({ ...next, updatedAt: now })
    .where(
      and(
        eq(busyBlock.id, id),
        eq(busyBlock.userId, userId),
        sql`(${busyBlock.endAt} > ${now} OR ${next.endAt} <= ${now} OR ${activeCount(userId, now)} < ${cap})`,
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** ลบถาวร (ไม่มี deleted_at ในสคีมา · ไม่มีใครอ้างถึง busy) — เฉพาะของเจ้าของ · คืน false = ไม่มี/ไม่ใช่ของผู้กระทำ */
export async function deleteOwnBusy(db: DbOrTx, id: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(busyBlock)
    .where(and(eq(busyBlock.id, id), eq(busyBlock.userId, userId)))
    .returning({ id: busyBlock.id });
  return rows.length === 1;
}

/** รายการของฉันที่ยังไม่สิ้นสุด (ใกล้สุดก่อน) */
export async function listOwnActiveBusy(db: DbOrTx, userId: string, now: number, limit: number): Promise<OwnBusyRow[]> {
  return db
    .select()
    .from(busyBlock)
    .where(and(eq(busyBlock.userId, userId), gt(busyBlock.endAt, now)))
    .orderBy(asc(busyBlock.startAt), asc(busyBlock.id))
    .limit(limit);
}

/** รายการของฉันที่ครอบวันท้องถิ่นใดวันหนึ่งใน [from, to] (YYYY-MM-DD รวมปลาย) */
export async function listOwnBusyInRange(db: DbOrTx, userId: string, from: string, to: string, limit: number): Promise<OwnBusyRow[]> {
  return db
    .select()
    .from(busyBlock)
    .where(and(eq(busyBlock.userId, userId), lte(busyBlock.localStartDate, to), gte(busyBlock.localEndDate, from)))
    .orderBy(asc(busyBlock.startAt), asc(busyBlock.id))
    .limit(limit);
}

/**
 * คิวรีฝั่งแชร์ — busy ของ "สมาชิกปัจจุบัน" ของกลุ่มที่ครอบวันท้องถิ่นใดวันหนึ่งใน [from, to]
 * ส่งคืน query builder (ไม่ execute) เพื่อให้เทสต์ตรวจ `.toSQL()` ว่าไม่มีคอลัมน์ `note` (ADR 0006 test 9)
 * ผู้เรียกต้องผ่านด่านกลุ่มมาแล้ว (service: authorize group.calendar.view) — repo นี้ไม่รู้จักผู้ดู
 */
export function sharedBusyInGroupQuery(db: DbOrTx, groupId: string, from: string, to: string) {
  return db
    .select({
      id: busyBlock.id,
      userId: busyBlock.userId,
      allDay: busyBlock.allDay,
      startAt: busyBlock.startAt,
      endAt: busyBlock.endAt,
      localStartDate: busyBlock.localStartDate,
      localEndDate: busyBlock.localEndDate,
      tz: busyBlock.tz,
      hideDetail: busyBlock.hideDetail,
      // รายการซ่อน: title ไม่ถูกอ่านออกจากแถวเลย
      title: sql<string | null>`CASE WHEN ${busyBlock.hideDetail} = 0 THEN ${busyBlock.title} ELSE NULL END`,
    })
    .from(busyBlock)
    .innerJoin(groupMember, eq(groupMember.userId, busyBlock.userId))
    .where(and(eq(groupMember.groupId, groupId), lte(busyBlock.localStartDate, to), gte(busyBlock.localEndDate, from)))
    .orderBy(asc(busyBlock.startAt), asc(busyBlock.id));
}

export async function listSharedBusyInGroup(db: DbOrTx, groupId: string, from: string, to: string): Promise<SharedBusyRow[]> {
  return sharedBusyInGroupQuery(db, groupId, from, to);
}
