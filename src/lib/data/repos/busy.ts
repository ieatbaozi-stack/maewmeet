// repo: busy_block — U7/U8, ADR 0006 · query ล้วน ไม่รู้จัก actor · เวลา = now ที่ผู้เรียก inject
//
// สองทางอ่านที่แยกกันโดยโครงสร้าง (ADR 0006 §2):
//   - ฝั่งเจ้าของ (OwnBusyRow)    : SELECT ทุกคอลัมน์รวม `note` — ใช้เฉพาะ WHERE user_id = <เจ้าของ> เท่านั้น
//   - ฝั่งแชร์   (SharedBusyRow)  : **ไม่ SELECT `note` เลย** และ `title` ถูกตัดใน SQL เมื่อ hide_detail = 1 (CASE) — ตัวอักษรของรายการซ่อนไม่ออกจาก DB
//                                   และ **ไม่ SELECT `series_id`** (R6F, ADR 0010 §6 — ความเป็นชุดเห็นเฉพาะเจ้าของ)
//                                   และ **ไม่ SELECT `routine_id`** (R14, ADR 0012 §7 — ความเป็น routine เห็นเฉพาะเจ้าของ)
// การเขียนที่แข่งกันได้ (เพดาน 300) = คำสั่ง SQL เดียวที่มีเงื่อนไขในตัว (INSERT … SELECT … WHERE count < cap) เหมือน R2 — ไม่มี check-then-act
// ทุกคำสั่งเขียนผูก user_id ของผู้กระทำ (เจ้าของเท่านั้น) — busy ไม่ผูกกลุ่ม จึงไม่มี role ให้ ActorGuard ตรวจ; ตัวป้องกันคือ user_id + สถานะบัญชียัง active
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { appointment, appointmentRsvp, busyBlock, groupMember, groups } from '@/db/schema';
import type { DbOrTx, Tx } from '@/db/client';
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
  /** R6F: ชุดรายวัน · ไม่ส่ง = ไม่แตะ (insert เดี่ยว = NULL) · null = หลุดจากชุด (PATCH สำเร็จ) */
  seriesId?: string | null;
  /** R14: ไม่ส่ง = ไม่แตะ (insert เดี่ยว = NULL) · null = หลุดจาก routine (PATCH สำเร็จ — ADR 0012 §5) */
  routineId?: null;
};

/**
 * ขอบหน้าต่างที่ผู้ใช้ยังสร้าง/แก้ได้: แถวที่ end_at > ขอบนี้ถูกนับเข้าเพดาน (H1/M1)
 * ย้อนหลัง BUSY_MAX_BACKDATE_DAYS ตามวันท้องถิ่นของ tz ใดก็ได้ ⇒ เผื่ออีก 1 วัน (ความต่าง tz ≤ 26 ชม.) ไม่ให้แถวที่ยังย้อนลงได้หลุดการนับ
 */
export const busyWindowStart = (now: number): number => now - (BUSY_MAX_BACKDATE_DAYS + 1) * DAY_MS;

/**
 * จำนวนแถวในหน้าต่าง (ไม่นับ excludeId ถ้ามี) — **นับเฉพาะ routine_id IS NULL** (R14, ADR 0012 §6: แถวของ routine มีเพดานของตัวเอง ไม่กินที่ 300)
 * ใช้ทั้ง insertBusyIfUnderCap / insertBusySeriesIfUnderCap / updateOwnBusyIfUnderCap / activeBusyCount
 */
const windowCount = (userId: string, now: number, excludeId?: string) =>
  excludeId === undefined
    ? sql`(SELECT count(*) FROM busy_block WHERE user_id = ${userId} AND routine_id IS NULL AND end_at > ${busyWindowStart(now)})`
    : sql`(SELECT count(*) FROM busy_block WHERE user_id = ${userId} AND routine_id IS NULL AND end_at > ${busyWindowStart(now)} AND id <> ${excludeId})`;

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
    RETURNING id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at, series_id, routine_id`);
  // R7 B-4: RETURNING ทุกคอลัมน์ แทนการอ่านกลับด้วย findOwnBusy (−1 query) · แปลงชนิดเหมือน drizzle select (เทสต์เทียบกับ findOwnBusy)
  const r = rows.length === 1 ? rows[0]! : null;
  return r === null ? null : ownBusyFromRaw(r);
}

/** แถวดิบ (snake_case) จาก RETURNING ของ busy_block → OwnBusyRow (ลำดับคีย์/ชนิดเท่ากับ drizzle select() ของตาราง) */
function ownBusyFromRaw(r: Record<string, unknown>): OwnBusyRow {
  const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return {
    id: String(r.id),
    userId: String(r.user_id),
    title: text(r.title),
    note: text(r.note),
    allDay: Number(r.all_day) === 1,
    startAt: Number(r.start_at),
    endAt: Number(r.end_at),
    localStartDate: String(r.local_start_date),
    localEndDate: String(r.local_end_date),
    tz: String(r.tz),
    hideDetail: Number(r.hide_detail) === 1,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    seriesId: text(r.series_id),
    routineId: text(r.routine_id),
  };
}

/** แถวหนึ่งวันของชุด (ผลของ expandDailyBusyInput + id ที่เซิร์ฟเวอร์สร้าง) */
export type BusySeriesRow = { id: string; startAt: number; endAt: number; localStartDate: string; localEndDate: string };

/**
 * R6F (ADR 0010 §3): เพิ่ม N แถว (ชุดเดียว) ถ้าผู้ใช้ active และ windowCount + N <= cap — คำสั่ง INSERT … SELECT เดียว ไม่มี check-then-act
 * เงื่อนไขใน WHERE ไม่ขึ้นกับแถวของ v (subquery ไม่ correlated) → ผ่านทั้ง N หรือไม่ผ่านทั้ง N · `+ N <= cap` คือรูปทั่วไปของ `count < cap` (N=1)
 * คืน null = ได้ไม่ครบ N (ปกติคือ 0 = ถูกปฏิเสธ) — **ต้องเรียกใน inTx และผู้เรียก throw เมื่อได้ null** → rollback ทั้งก้อน (ไม่มีแถวค้าง)
 * ห้ามมี SELECT ก่อนคำสั่งนี้ใน transaction เดียวกัน (ให้ได้ write lock ตั้งแต่คำสั่งแรก — ADR 0010 §3 [S5])
 * พารามิเตอร์ = 5×N + 9 (N ≤ 62 → ≤ 319 < 999) · เท่ากับ N แล้วอ่านกลับเรียง start_at, id
 */
export async function insertBusySeriesIfUnderCap(
  tx: Tx,
  input: {
    userId: string;
    seriesId: string | null;
    cap: number;
    shared: Pick<BusyWrite, 'title' | 'note' | 'hideDetail' | 'tz'>;
    rows: readonly BusySeriesRow[];
  },
  now: number,
): Promise<OwnBusyRow[] | null> {
  const n = input.rows.length;
  if (n === 0) return [];
  const values = sql.join(
    input.rows.map((r) => sql`(${r.id}, ${r.startAt}, ${r.endAt}, ${r.localStartDate}, ${r.localEndDate})`),
    sql`, `,
  );
  const { title, note, hideDetail, tz } = input.shared;
  const inserted = await tx.all<{ id: string }>(sql`
    WITH v(id, start_at, end_at, local_start_date, local_end_date) AS (VALUES ${values})
    INSERT INTO busy_block (id, user_id, series_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at)
    SELECT v.id, ${input.userId}, ${input.seriesId}, ${title}, ${note}, 0, v.start_at, v.end_at, v.local_start_date, v.local_end_date, ${tz}, ${hideDetail ? 1 : 0}, ${now}, ${now}
    FROM v
    WHERE EXISTS (SELECT 1 FROM user WHERE id = ${input.userId} AND status = 'active')
      AND ${windowCount(input.userId, now)} + ${n} <= ${input.cap}
    RETURNING id`);
  if (inserted.length !== n) return null;
  return tx
    .select()
    .from(busyBlock)
    .where(and(eq(busyBlock.userId, input.userId), inArray(busyBlock.id, input.rows.map((r) => r.id))))
    .orderBy(asc(busyBlock.startAt), asc(busyBlock.id));
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
 * R14: แถวของ routine (routine_id ไม่ NULL) ไม่เคยถูกนับ → PATCH ที่ทำให้หลุดเป็น busy เดี่ยวคือ "เข้าเขตที่นับ" เสมอ (ADR 0012 §5) — ต้องมีที่ว่าง
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
        sql`((${busyBlock.routineId} IS NULL AND ${busyBlock.endAt} > ${busyWindowStart(now)}) OR ${next.endAt} <= ${busyWindowStart(now)} OR ${windowCount(userId, now, id)} < ${cap})`,
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

/**
 * R6F (ADR 0010 §5): ลบทั้งชุดของแถว id — คำสั่งเดียว · ทั้งสองชั้นผูก user_id = ผู้กระทำ (ของคนอื่น/ไม่มี → 0 แถว → ผู้เรียกตอบ NOT_FOUND)
 * แถวที่ไม่มีชุด (series_id NULL) → ลบแถวนั้นแถวเดียว · ลบทุกแถวของชุดรวมวันที่ผ่านไปแล้ว · คืนจำนวนแถวที่ลบ
 */
export async function deleteOwnBusySeries(db: DbOrTx, id: string, userId: string): Promise<number> {
  const rows = await db.all<{ id: string }>(sql`
    DELETE FROM busy_block
    WHERE user_id = ${userId}
      AND (id = ${id}
           OR (series_id IS NOT NULL AND series_id = (SELECT series_id FROM busy_block WHERE id = ${id} AND user_id = ${userId})))
    RETURNING id`);
  return rows.length;
}

/**
 * R14 (ADR 0012 §5): ก่อนลบ/แก้แยกวันเดียวของ routine — บันทึก skip ของวันนั้น (กันการขยายใหม่ฟื้นกลับ) · คำสั่งเดียว ผูก user_id ทั้งแถวและกฎ
 * แถวที่ไม่ใช่ของ routine / ไม่ใช่ของผู้กระทำ / ไม่มี → 0 แถว (no-op) · ซ้ำ → ไม่ทำอะไร · ต้องเรียกใน tx เดียวกับการลบ/แก้ (เป็นคำสั่งเขียนแรก)
 */
export async function insertSkipForOwnBusyRow(tx: Tx, id: string, userId: string): Promise<void> {
  await tx.run(sql`
    INSERT INTO busy_routine_skip (routine_id, local_date)
    SELECT b.routine_id, b.local_start_date FROM busy_block b
      JOIN busy_routine r ON r.id = b.routine_id AND r.user_id = b.user_id
     WHERE b.id = ${id} AND b.user_id = ${userId} AND b.routine_id IS NOT NULL
    ON CONFLICT DO NOTHING`);
}

/**
 * รายการของฉันที่ยังไม่สิ้นสุด (ใกล้สุดก่อน) — **เฉพาะ routine_id IS NULL** (R14, ADR 0012 §8: วันของ routine แสดงในส่วน routine จาก GET /api/me/busy-routines ไม่ท่วมรายการนี้)
 * วันที่แยกออกจาก routine แล้ว (routine_id = NULL) อยู่ในรายการนี้ตามปกติ
 */
export async function listOwnActiveBusy(db: DbOrTx, userId: string, now: number, limit: number): Promise<OwnBusyRow[]> {
  return db
    .select()
    .from(busyBlock)
    .where(and(eq(busyBlock.userId, userId), isNull(busyBlock.routineId), gt(busyBlock.endAt, now)))
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
