// repo: busy_block — U7/U8, ADR 0006 · query ล้วน ไม่รู้จัก actor · เวลา = now ที่ผู้เรียก inject
//
// สองทางอ่านที่แยกกันโดยโครงสร้าง (ADR 0006 §2):
//   - ฝั่งเจ้าของ (OwnBusyRow)    : SELECT ทุกคอลัมน์รวม `note` — ใช้เฉพาะ WHERE user_id = <เจ้าของ> เท่านั้น
//   - ฝั่งแชร์   (SharedBusyRow)  : **ไม่ SELECT `note` เลย** และ `title` ถูกตัดใน SQL เมื่อ hide_detail = 1 (CASE) — ตัวอักษรของรายการซ่อนไม่ออกจาก DB
// การเขียนที่แข่งกันได้ (เพดาน 300) = คำสั่ง SQL เดียวที่มีเงื่อนไขในตัว (INSERT … SELECT … WHERE count < cap) เหมือน R2 — ไม่มี check-then-act
// ทุกคำสั่งเขียนผูก user_id ของผู้กระทำ (เจ้าของเท่านั้น) — busy ไม่ผูกกลุ่ม จึงไม่มี role ให้ ActorGuard ตรวจ; ตัวป้องกันคือ user_id + สถานะบัญชียัง active
import { and, asc, eq, gt, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { appointment, appointmentRsvp, busyBlock, groupMember, groups } from '@/db/schema';
import type { DbOrTx } from '@/db/client';
import { DAY_MS } from '@/lib/shared/clock';
import { BUSY_MAX_BACKDATE_DAYS } from '@/lib/shared/limits';

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

/**
 * ขอบหน้าต่างที่ผู้ใช้ยังสร้าง/แก้ได้: แถวที่ end_at > ขอบนี้ถูกนับเข้าเพดาน (H1/M1)
 * ย้อนหลัง BUSY_MAX_BACKDATE_DAYS ตามวันท้องถิ่นของ tz ใดก็ได้ ⇒ เผื่ออีก 1 วัน (ความต่าง tz ≤ 26 ชม.) ไม่ให้แถวที่ยังย้อนลงได้หลุดการนับ
 */
export const busyWindowStart = (now: number): number => now - (BUSY_MAX_BACKDATE_DAYS + 1) * DAY_MS;

/** จำนวนแถวในหน้าต่าง (ไม่นับ excludeId ถ้ามี) */
const windowCount = (userId: string, now: number, excludeId?: string) =>
  excludeId === undefined
    ? sql`(SELECT count(*) FROM busy_block WHERE user_id = ${userId} AND end_at > ${busyWindowStart(now)})`
    : sql`(SELECT count(*) FROM busy_block WHERE user_id = ${userId} AND end_at > ${busyWindowStart(now)} AND id <> ${excludeId})`;

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
      AND ${windowCount(input.userId, now)} < ${input.cap}
    RETURNING id`);
  if (rows.length !== 1) return null;
  return findOwnBusy(db, input.id, input.userId);
}

export async function activeBusyCount(db: DbOrTx, userId: string, now: number): Promise<number> {
  const rows = await db.all<{ n: number }>(sql`SELECT ${windowCount(userId, now)} AS n`);
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
 * แก้ busy ของเจ้าของ — คำสั่งเดียว · เพดาน: ถ้ารายการเดิมอยู่นอกหน้าต่าง (end_at <= ขอบ) แต่ค่าใหม่อยู่ในหน้าต่าง (ฟื้น/ย้ายเข้าเขตที่นับ)
 * ต้องมีที่ว่าง: จำนวนแถวอื่นในหน้าต่าง (ไม่นับแถวนี้) < cap · อยู่ในหน้าต่างอยู่แล้ว หรือค่าใหม่อยู่นอกหน้าต่าง ไม่เพิ่มจำนวน → ไม่ตรวจ · คืน null = ไม่มี/ไม่ใช่ของผู้กระทำ/เต็มเพดาน
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
        sql`(${busyBlock.endAt} > ${busyWindowStart(now)} OR ${next.endAt} <= ${busyWindowStart(now)} OR ${windowCount(userId, now, id)} < ${cap})`,
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

/** รายการของฉันที่ครอบวันท้องถิ่นใดวันหนึ่งใน [from, to] (YYYY-MM-DD รวมปลาย) — ผู้เรียกขอ limit+1 เพื่อรู้ว่าถูกตัด */
export async function listOwnBusyInRange(db: DbOrTx, userId: string, from: string, to: string, limit: number): Promise<OwnBusyRow[]> {
  return db
    .select()
    .from(busyBlock)
    .where(and(eq(busyBlock.userId, userId), lte(busyBlock.localStartDate, to), gte(busyBlock.localEndDate, from)))
    .orderBy(asc(busyBlock.startAt), asc(busyBlock.id))
    .limit(limit);
}

/**
 * คิวรีฝั่งแชร์ — busy ของ "สมาชิกปัจจุบัน" ของกลุ่มที่ทับช่วงเวลา [fromMs, toMs) (epoch ms · ผู้เรียกแปลงวัน from/to ด้วย tz ของกลุ่ม)
 * ทับ = start_at < toMs AND end_at > fromMs — ตัดสินด้วย "ช่วงเวลาจริง" ไม่ใช่วันท้องถิ่นของเจ้าของ (L3: tz เจ้าของต่างจากกลุ่มได้) และใช้ดัชนี busy_user_*_idx
 * เรียง start_at, id (กำหนดแน่นอน) + LIMIT — ผู้เรียกส่ง limit = เพดาน+1 เพื่อรู้ว่าถูกตัด
 * ส่งคืน query builder (ไม่ execute) เพื่อให้เทสต์ตรวจ `.toSQL()` ว่าไม่มีคอลัมน์ `note` (ADR 0006 test 9)
 * ผู้เรียกต้องผ่านด่านกลุ่มมาแล้ว (service: authorize group.calendar.view) — repo นี้ไม่รู้จักผู้ดู
 */
export function sharedBusyInGroupQuery(db: DbOrTx, groupId: string, fromMs: number, toMs: number, limit: number) {
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
    .where(and(eq(groupMember.groupId, groupId), lt(busyBlock.startAt, toMs), gt(busyBlock.endAt, fromMs)))
    .orderBy(asc(busyBlock.startAt), asc(busyBlock.id))
    .limit(limit);
}

/** คืนไม่เกิน `max` แถว + truncated เมื่อมีเกิน */
export async function listSharedBusyInGroup(
  db: DbOrTx,
  groupId: string,
  fromMs: number,
  toMs: number,
  max: number,
): Promise<{ rows: SharedBusyRow[]; truncated: boolean }> {
  const rows = await sharedBusyInGroupQuery(db, groupId, fromMs, toMs, max + 1);
  return rows.length > max ? { rows: rows.slice(0, max), truncated: true } : { rows, truncated: false };
}

// ───────── R6D G2: นัดที่ตอบ "ไป" = ช่วงไม่ว่าง (ADR 0009 §1) ─────────

/**
 * แถว going ที่เตรียมให้สมาชิกกลุ่มที่กำลังดู — นัดกลุ่มอื่น: appointmentId/title เป็น NULL ตั้งแต่ใน SQL (CASE)
 * ไม่มี group_id / place_name / lat / lng / map_url / description / tz ของนัดใด ๆ
 */
export type GoingBusyRow = {
  userId: string;
  startAt: number;
  endAt: number;
  /** นัดอยู่ในกลุ่มที่กำลังดู */
  sameGroup: boolean;
  appointmentId: string | null;
  title: string | null;
};

const viewerMember = alias(groupMember, 'vm');
const apptMember = alias(groupMember, 'am');

/**
 * คิวรีเดียว (ADR 0009 §1): นัด active ที่ "สมาชิกปัจจุบันของกลุ่ม groupId" ตอบ going จากทุกกลุ่ม ที่ทับช่วง [fromMs, toMs) (ครึ่งเปิด ชนขอบไม่นับ)
 * นับเฉพาะเมื่อ: กลุ่มของนัดยังไม่ถูกลบ · ผู้ตอบยังเป็นสมาชิกกลุ่มของนัด และ rsvp.updated_at >= joined_at (กติกาเดียวกับ listCurrentRsvps)
 * excludeAppointmentId: ตัดนัดนี้ออก *เฉพาะเมื่ออยู่ในกลุ่ม groupId* (ใส่ id นัดกลุ่มอื่นไม่มีผล — ไม่เป็น oracle)
 * ส่งคืน query builder (ไม่ execute) ให้เทสต์ตรวจ `.toSQL()` · ผู้เรียกต้องผ่านด่านกลุ่มมาแล้ว
 */
export function goingBusyInGroupQuery(db: DbOrTx, groupId: string, fromMs: number, toMs: number, limit: number, excludeAppointmentId?: string) {
  const same = sql`${appointment.groupId} = ${groupId}`;
  const conds = [eq(viewerMember.groupId, groupId)];
  if (excludeAppointmentId !== undefined) conds.push(sql`NOT (${appointment.id} = ${excludeAppointmentId} AND ${same})`);
  return db
    .select({
      userId: appointmentRsvp.userId,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      sameGroup: sql<number>`(${same})`,
      appointmentId: sql<string | null>`CASE WHEN ${same} THEN ${appointment.id} ELSE NULL END`,
      title: sql<string | null>`CASE WHEN ${same} THEN ${appointment.title} ELSE NULL END`,
    })
    .from(viewerMember)
    .innerJoin(appointmentRsvp, and(eq(appointmentRsvp.userId, viewerMember.userId), eq(appointmentRsvp.response, 'going')))
    .innerJoin(
      appointment,
      and(eq(appointment.id, appointmentRsvp.appointmentId), eq(appointment.status, 'active'), lt(appointment.startAt, toMs), gt(appointment.endAt, fromMs)),
    )
    .innerJoin(groups, and(eq(groups.id, appointment.groupId), isNull(groups.deletedAt)))
    .innerJoin(
      apptMember,
      and(eq(apptMember.groupId, appointment.groupId), eq(apptMember.userId, appointmentRsvp.userId), sql`${appointmentRsvp.updatedAt} >= ${apptMember.joinedAt}`),
    )
    .where(and(...conds))
    .orderBy(asc(appointment.startAt), asc(appointment.endAt), asc(appointmentRsvp.userId), asc(appointment.id))
    .limit(limit);
}

/** คืนไม่เกิน `max` แถว + truncated เมื่อมีเกิน */
export async function listGoingBusyInGroup(
  db: DbOrTx,
  groupId: string,
  fromMs: number,
  toMs: number,
  max: number,
  excludeAppointmentId?: string,
): Promise<{ rows: GoingBusyRow[]; truncated: boolean }> {
  const raw = await goingBusyInGroupQuery(db, groupId, fromMs, toMs, max + 1, excludeAppointmentId);
  const rows: GoingBusyRow[] = raw.slice(0, max).map((r) => ({
    userId: r.userId,
    startAt: r.startAt,
    endAt: r.endAt,
    sameGroup: Number(r.sameGroup) === 1,
    appointmentId: r.appointmentId,
    title: r.title,
  }));
  return { rows, truncated: raw.length > max };
}
