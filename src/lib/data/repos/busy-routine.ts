// repo: busy_routine / busy_routine_skip + แถวของ routine ใน busy_block — R14 · ADR 0012 §5–§6
// query ล้วน ไม่รู้จัก actor · เวลา/วันนี้ = ค่าที่ผู้เรียก inject
//  - เจ้าของเท่านั้น: ทุกคำสั่งผูก user_id ของผู้กระทำ (ของคนอื่น/ไม่มี → 0 แถว → service ตอบ NOT_FOUND)
//  - เพดาน = เงื่อนไขในคำสั่งเขียนเดียว (INSERT … SELECT … WHERE / UPDATE … WHERE) ไม่มี check-then-act:
//      routine ที่ยังไม่จบ (end_date >= วันนี้) < BUSY_ROUTINE_MAX_ACTIVE · แถว routine ในอนาคต + N ≤ BUSY_ROUTINE_MAX_FUTURE_ROWS
//  - ไม่มีทางอ่านฝั่งแชร์: ไฟล์นี้ถูกเรียกจาก services/busy-routines.ts (เจ้าของ) และ account/maintenance เท่านั้น
//  - busy_block.routine_id ไม่มี FK (migration 0005) → ลบแถวของ routine ด้วยคำสั่งชัดเจนใน tx เดียวกับการลบกฎ
import { and, asc, eq, sql } from 'drizzle-orm';
import { busyBlock, busyRoutine } from '@/db/schema';
import type { DbOrTx, Tx } from '@/db/client';

export type OwnRoutineRow = typeof busyRoutine.$inferSelect;

/** ฟิลด์ของกฎที่เขียน (ผลของ planRoutine + ข้อความ) */
export type RoutineWrite = {
  title: string | null;
  note: string | null;
  hideDetail: boolean;
  allDay: boolean;
  weekdays: number;
  startMin: number | null;
  endMin: number | null;
  rangeKind: 'weeks' | 'months';
  startDate: string;
  endDate: string;
  tz: string;
};

/** แถวหนึ่งวันที่จะ insert (ผลของ expandRoutine + id ที่เซิร์ฟเวอร์สร้าง) */
export type RoutineBusyRow = { id: string; startAt: number; endAt: number; localStartDate: string; localEndDate: string };

const ROUTINE_COLS = sql.raw(
  'id, user_id, title, note, hide_detail, all_day, weekdays, start_min, end_min, range_kind, start_date, end_date, tz, created_at, updated_at',
);

const userActive = (userId: string) => sql`EXISTS (SELECT 1 FROM user WHERE id = ${userId} AND status = 'active')`;

/** routine ที่ยังไม่จบ (end_date >= today) ของผู้ใช้ (ไม่นับ excludeId ถ้ามี) */
const activeRoutines = (userId: string, today: string, excludeId?: string) =>
  excludeId === undefined
    ? sql`(SELECT count(*) FROM busy_routine WHERE user_id = ${userId} AND end_date >= ${today})`
    : sql`(SELECT count(*) FROM busy_routine WHERE user_id = ${userId} AND end_date >= ${today} AND id <> ${excludeId})`;

/** แถวของ routine ในอนาคต (end_at > now) ของผู้ใช้ — ใช้ busy_user_routine_idx / busy_user_end_idx */
const futureRoutineRows = (userId: string, now: number) =>
  sql`(SELECT count(*) FROM busy_block WHERE user_id = ${userId} AND routine_id IS NOT NULL AND end_at > ${now})`;

/** แถวดิบ (snake_case) จาก RETURNING → OwnRoutineRow (ลำดับคีย์/ชนิดเท่ากับ drizzle select()) */
function routineFromRaw(r: Record<string, unknown>): OwnRoutineRow {
  const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id),
    userId: String(r.user_id),
    title: text(r.title),
    note: text(r.note),
    hideDetail: Number(r.hide_detail) === 1,
    allDay: Number(r.all_day) === 1,
    weekdays: Number(r.weekdays),
    startMin: int(r.start_min),
    endMin: int(r.end_min),
    rangeKind: String(r.range_kind) as OwnRoutineRow['rangeKind'],
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    tz: String(r.tz),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

const one = (rows: Record<string, unknown>[]): OwnRoutineRow | null => (rows.length === 1 ? routineFromRaw(rows[0]!) : null);

/**
 * สร้างกฎถ้าผู้ใช้ active และ routine ที่ยังไม่จบ < cap (cap = null: ไม่ตรวจ — ชุดใหม่จากการแยก R14 B12 · บัญชี active ยังตรวจ) — คำสั่งเดียว · **ต้องเป็นคำสั่งเขียนแรกของ tx** (ได้ write lock ก่อนอ่านอะไร — ADR 0010 §3 [S5])
 * คืน null = ถูกปฏิเสธ (ผู้เรียกวินิจฉัยด้วย countActiveRoutines หลัง rollback)
 */
export async function insertRoutineIfUnderCap(
  tx: Tx,
  input: { id: string; userId: string; write: RoutineWrite; /** null = ไม่ตรวจเพดานชุด (แยกชุดตอนแก้ "ตั้งแต่…" — R14 B12) */ cap: number | null; today: string },
  now: number,
): Promise<OwnRoutineRow | null> {
  const w = input.write;
  const capCond = input.cap === null ? sql`1` : sql`${activeRoutines(input.userId, input.today)} < ${input.cap}`;
  const rows = await tx.all<Record<string, unknown>>(sql`
    INSERT INTO busy_routine (${ROUTINE_COLS})
    SELECT ${input.id}, ${input.userId}, ${w.title}, ${w.note}, ${w.hideDetail ? 1 : 0}, ${w.allDay ? 1 : 0}, ${w.weekdays}, ${w.startMin}, ${w.endMin},
           ${w.rangeKind}, ${w.startDate}, ${w.endDate}, ${w.tz}, ${now}, ${now}
    WHERE ${userActive(input.userId)} AND ${capCond}
    RETURNING ${ROUTINE_COLS}`);
  return one(rows);
}

/**
 * เพิ่มแถวของ routine N แถวคำสั่งเดียว ถ้าผู้ใช้ active และ แถว routine ในอนาคต + (แถวใหม่ที่ end_at > now) ≤ cap
 * เงื่อนไขไม่ correlated กับแถวของ v → ผ่านทั้ง N หรือไม่ผ่านเลย · คืน false = ได้ไม่ครบ (ผู้เรียก throw → rollback ทั้ง tx)
 * พารามิเตอร์ = 5×N + 13 (N ≤ 184 → ≤ 933 < 999 — ADR 0012 §6 "ขนาดคำสั่ง")
 */
export async function insertRoutineRowsIfUnderCap(
  tx: Tx,
  input: {
    userId: string;
    routineId: string;
    cap: number;
    shared: { title: string | null; note: string | null; hideDetail: boolean; allDay: boolean; tz: string };
    rows: readonly RoutineBusyRow[];
  },
  now: number,
): Promise<boolean> {
  const n = input.rows.length;
  if (n === 0) return true;
  const future = input.rows.filter((r) => r.endAt > now).length;
  const values = sql.join(
    input.rows.map((r) => sql`(${r.id}, ${r.startAt}, ${r.endAt}, ${r.localStartDate}, ${r.localEndDate})`),
    sql`, `,
  );
  const { title, note, hideDetail, allDay, tz } = input.shared;
  const inserted = await tx.all<{ id: string }>(sql`
    WITH v(id, start_at, end_at, local_start_date, local_end_date) AS (VALUES ${values})
    INSERT INTO busy_block (id, user_id, routine_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at)
    SELECT v.id, ${input.userId}, ${input.routineId}, ${title}, ${note}, ${allDay ? 1 : 0}, v.start_at, v.end_at, v.local_start_date, v.local_end_date, ${tz}, ${hideDetail ? 1 : 0}, ${now}, ${now}
    FROM v
    WHERE ${userActive(input.userId)} AND ${futureRoutineRows(input.userId, now)} + ${future} <= ${input.cap}
    RETURNING id`);
  return inserted.length === n;
}

/** วินิจฉัยหลังถูกปฏิเสธ (ไม่มีผลต่อความปลอดภัย) */
export async function countActiveRoutines(db: DbOrTx, userId: string, today: string): Promise<number> {
  const rows = await db.all<{ n: number }>(sql`SELECT ${activeRoutines(userId, today)} AS n`);
  return Number(rows[0]?.n ?? 0);
}

export async function countFutureRoutineRows(db: DbOrTx, userId: string, now: number): Promise<number> {
  const rows = await db.all<{ n: number }>(sql`SELECT ${futureRoutineRows(userId, now)} AS n`);
  return Number(rows[0]?.n ?? 0);
}

/** วันของ routine ที่ยังไม่สิ้นสุด (end_at > now) — ผูก user_id */
export async function countRoutineRemaining(db: DbOrTx, routineId: string, userId: string, now: number): Promise<number> {
  const rows = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM busy_block WHERE user_id = ${userId} AND routine_id = ${routineId} AND end_at > ${now}`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** กฎของ *เจ้าของ* ตาม id — ไม่ใช่เจ้าของ = null (IDOR → 404) */
export async function findOwnRoutine(db: DbOrTx, id: string, userId: string): Promise<OwnRoutineRow | null> {
  const rows = await db
    .select()
    .from(busyRoutine)
    .where(and(eq(busyRoutine.id, id), eq(busyRoutine.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export type OwnRoutineListRow = OwnRoutineRow & { remaining: number };

/**
 * routine ของฉัน: ยังไม่จบก่อน (end_date >= today) แล้วเรียง start_date, id · remaining = แถวที่ยังไม่สิ้นสุด (end_at > now) ของชุดนั้น
 * ผู้เรียกขอ limit+1 เพื่อรู้ว่าถูกตัด
 */
export async function listOwnRoutines(db: DbOrTx, userId: string, now: number, today: string, limit: number): Promise<OwnRoutineListRow[]> {
  const rows = await db
    .select({
      routine: busyRoutine,
      remaining: sql<number>`(SELECT count(*) FROM busy_block b WHERE b.user_id = ${busyRoutine.userId} AND b.routine_id = ${busyRoutine.id} AND b.end_at > ${now})`,
    })
    .from(busyRoutine)
    .where(eq(busyRoutine.userId, userId))
    .orderBy(sql`(${busyRoutine.endDate} < ${today})`, asc(busyRoutine.startDate), asc(busyRoutine.id))
    .limit(limit);
  return rows.map((r) => ({ ...r.routine, remaining: Number(r.remaining) }));
}

/** วันที่ข้าม (skip) ของ routine ของผู้ใช้ — อ่านใน tx หลังคำสั่งเขียนแรก */
export async function listRoutineSkips(db: DbOrTx, routineId: string, userId: string): Promise<string[]> {
  const rows = await db.all<{ d: string }>(sql`
    SELECT s.local_date AS d FROM busy_routine_skip s JOIN busy_routine r ON r.id = s.routine_id
     WHERE s.routine_id = ${routineId} AND r.user_id = ${userId}
     ORDER BY s.local_date`);
  return rows.map((r) => String(r.d));
}

/**
 * แก้กฎในที่ (PATCH ตั้งแต่ ≤ วันนี้/≤ วันแรก) — คำสั่งเดียว · เขียนแรกของ tx
 * เงื่อนไข: ของผู้กระทำ · บัญชี active · updated_at ยังเท่าที่อ่านมา (กันแก้ซ้อน) ·
 * เพดาน 10: ถ้ากฎเดิมจบไปแล้วแต่ค่าใหม่ยังไม่จบ (ต่ออายุชุดที่จบแล้ว = เพิ่มชุดที่ยังไม่จบ) ต้องมีที่ว่าง
 */
export async function updateOwnRoutineGuarded(
  tx: Tx,
  input: { id: string; userId: string; expectedUpdatedAt: number; write: RoutineWrite; cap: number; today: string },
  now: number,
): Promise<OwnRoutineRow | null> {
  const w = input.write;
  const rows = await tx.all<Record<string, unknown>>(sql`
    UPDATE busy_routine
       SET title = ${w.title}, note = ${w.note}, hide_detail = ${w.hideDetail ? 1 : 0}, all_day = ${w.allDay ? 1 : 0}, weekdays = ${w.weekdays},
           start_min = ${w.startMin}, end_min = ${w.endMin}, range_kind = ${w.rangeKind}, start_date = ${w.startDate}, end_date = ${w.endDate},
           tz = ${w.tz}, updated_at = ${now}
     WHERE id = ${input.id} AND user_id = ${input.userId} AND updated_at = ${input.expectedUpdatedAt} AND ${userActive(input.userId)}
       AND (end_date >= ${input.today} OR ${w.endDate} < ${input.today} OR ${activeRoutines(input.userId, input.today, input.id)} < ${input.cap})
    RETURNING ${ROUTINE_COLS}`);
  return one(rows);
}

/** ตัดวันจบของกฎ (แยกชุด / หยุดตั้งแต่) — คำสั่งเดียว · เขียนแรกของ tx · ของผู้กระทำ + updated_at ยังเท่าที่อ่านมา */
export async function setOwnRoutineEndGuarded(
  tx: Tx,
  input: { id: string; userId: string; expectedUpdatedAt: number; endDate: string },
  now: number,
): Promise<OwnRoutineRow | null> {
  const rows = await tx.all<Record<string, unknown>>(sql`
    UPDATE busy_routine SET end_date = ${input.endDate}, updated_at = ${now}
     WHERE id = ${input.id} AND user_id = ${input.userId} AND updated_at = ${input.expectedUpdatedAt} AND end_date >= ${input.endDate}
    RETURNING ${ROUTINE_COLS}`);
  return one(rows);
}

/** ย้าย skip ที่ ≥ fromDate จากกฎเดิมไปกฎใหม่ (แยกชุด — ADR 0012 §5) · ทั้งสองกฎต้องเป็นของผู้ใช้ */
export async function moveRoutineSkips(tx: Tx, input: { fromId: string; toId: string; userId: string; fromDate: string }): Promise<void> {
  await tx.run(sql`
    UPDATE busy_routine_skip SET routine_id = ${input.toId}
     WHERE routine_id = ${input.fromId} AND local_date >= ${input.fromDate}
       AND EXISTS (SELECT 1 FROM busy_routine WHERE id = ${input.fromId} AND user_id = ${input.userId})
       AND EXISTS (SELECT 1 FROM busy_routine WHERE id = ${input.toId} AND user_id = ${input.userId})`);
}

/** ลบ skip ที่ ≥ fromDate (หยุดตั้งแต่ — ไม่มีวันให้ข้ามแล้ว) */
export async function deleteRoutineSkipsFrom(tx: Tx, input: { routineId: string; userId: string; fromDate: string }): Promise<void> {
  await tx.run(sql`
    DELETE FROM busy_routine_skip
     WHERE routine_id = ${input.routineId} AND local_date >= ${input.fromDate}
       AND EXISTS (SELECT 1 FROM busy_routine WHERE id = ${input.routineId} AND user_id = ${input.userId})`);
}

/** ลบแถวของ routine ที่วันเริ่ม ≥ fromDate (ยังผูกกับ routine — วันที่แยกเป็น busy เดี่ยวแล้วไม่ถูกแตะ) · คืนจำนวน */
export async function deleteRoutineRowsFrom(tx: Tx, input: { routineId: string; userId: string; fromDate: string }): Promise<number> {
  const rows = await tx.all<{ id: string }>(sql`
    DELETE FROM busy_block WHERE user_id = ${input.userId} AND routine_id = ${input.routineId} AND local_start_date >= ${input.fromDate}
    RETURNING id`);
  return rows.length;
}

/**
 * ลบทั้งหมด: แถวทุกวันของ routine (รวมอดีต — ADR 0012 §5 / ADR 0010 §10 ข้อ 5) แล้วกฎ (skip ตาม FK cascade) · คำสั่งเขียนแรกคือ DELETE
 * คืน null = ไม่มี/ไม่ใช่ของผู้กระทำ (ไม่มีอะไรถูกลบ เพราะแถวผูก user_id เดียวกัน) · ไม่ใช่ null = จำนวนแถว busy ที่ลบ
 */
export async function deleteOwnRoutine(tx: Tx, id: string, userId: string): Promise<number | null> {
  const rows = await tx.all<{ id: string }>(sql`DELETE FROM busy_block WHERE user_id = ${userId} AND routine_id = ${id} RETURNING id`);
  const gone = await tx.delete(busyRoutine).where(and(eq(busyRoutine.id, id), eq(busyRoutine.userId, userId))).returning({ id: busyRoutine.id });
  return gone.length === 1 ? rows.length : null;
}

/** แถว busy_block ของ routine ตาม id ที่ส่งมา (อ่านกลับหลัง insert — ใช้ในเทสต์/ผลตอบ) */
export async function listRoutineRows(db: DbOrTx, routineId: string, userId: string) {
  return db
    .select()
    .from(busyBlock)
    .where(and(eq(busyBlock.userId, userId), eq(busyBlock.routineId, routineId)))
    .orderBy(asc(busyBlock.startAt), asc(busyBlock.id));
}
