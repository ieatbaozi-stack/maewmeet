// service: busy routine ของฉัน — R14 · ADR 0012 §4–§7 · R14_CONTRACT §1.2–§1.3 · เจ้าของเท่านั้น (SA ก็ดู/แก้/ลบของคนอื่นไม่ได้)
//  - authorize() บรรทัดแรกทุกฟังก์ชัน (busy.routine.* — auth) · ownerId = ผู้กระทำ: ความเป็นเจ้าของตัดสินที่ SQL (user_id = ผู้กระทำ) → ของคนอื่น = NOT_FOUND (IDOR)
//  - ตรวจ/ขยายด้วย planRoutine ของ lib เวลา (กฎ 9) ก่อน rate limit (ผิดอินพุตไม่กินโควตา) · title/note ใช้กติกาเดียวกับ busy เดี่ยว
//  - เขียนใน inTx เดียว · คำสั่งแรกเป็นการเขียนเสมอ · เพดาน 10 ชุด / 1,500 แถวอนาคต อยู่ในคำสั่งเขียน (repo) — ที่นี่แค่วินิจฉัยสาเหตุหลังถูกปฏิเสธ
//  - rate limit BUSY_ROUTINE_RATE_LIMIT ต่อคำขอ (รวม POST/PATCH/DELETE)
//  - ขอบเขตแก้/ลบ (ADR 0012 §5, B4/B5): "เฉพาะวันนี้" = PATCH/DELETE /api/me/busy/:id (services/busy.ts) · "ตั้งแต่…" = from · "ทั้งหมด" = ไม่ส่ง from
import { z } from 'zod';
import {
  addDays,
  DEFAULT_TZ,
  isValidDate,
  planRoutine,
  routinePeriodStart,
  todayIn,
  type BusyInputError,
  type RoutinePlan,
  type RoutineRangeInput,
  type RoutineRangeKind,
} from '@/lib/calendar';
import {
  countActiveRoutines,
  countFutureRoutineRows,
  countRoutineRemaining,
  deleteOwnRoutine,
  deleteRoutineRowsFrom,
  deleteRoutineSkipsFrom,
  findOwnRoutine,
  insertRoutineIfUnderCap,
  insertRoutineRowsIfUnderCap,
  listOwnRoutines,
  listRoutineSkips,
  moveRoutineSkips,
  setOwnRoutineEndGuarded,
  updateOwnRoutineGuarded,
  type OwnRoutineRow,
  type RoutineWrite,
} from '@/lib/data/repos/busy-routine';
import type { Tx } from '@/db/client';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import {
  BUSY_NOTE_MAX,
  BUSY_ROUTINE_LIST_MAX,
  BUSY_ROUTINE_MAX_ACTIVE,
  BUSY_ROUTINE_MAX_AHEAD_MONTHS,
  BUSY_ROUTINE_MAX_FUTURE_ROWS,
  BUSY_ROUTINE_MAX_MONTHS,
  BUSY_ROUTINE_MAX_WEEKS,
  BUSY_ROUTINE_RATE_LIMIT,
  BUSY_TITLE_MAX,
} from '@/lib/shared/limits';
import { takeUserSlot } from '../admin-input';
import type { DataCtx } from '../context';
import { toRoutineOwnView, type RoutineOwnView } from '../serializers/busy-routine';
import { inTx } from '../tx';
import { parseBusyNote, parseBusyTitle } from './busy';
import { asUser } from './group-common';

// ───────── input schemas (strict — ไม่มี userId/id/routineId/createdAt ให้ส่ง: mass assignment) ─────────
const dateField = z.string().max(32);
const monthField = z.string().max(16);
const timeField = z.string().max(16);
const ruleShape = {
  rangeKind: z.enum(['weeks', 'months']),
  fromWeek: dateField.optional(),
  toWeek: dateField.optional(),
  fromMonth: monthField.optional(),
  toMonth: monthField.optional(),
  /** ISO 1–7 · ค่า/ซ้ำตรวจใน lib (INVALID_WEEKDAYS) · ว่าง → REQUIRED */
  weekdays: z.array(z.number()).max(7),
  allDay: z.boolean(),
  startTime: timeField.optional(),
  endTime: timeField.optional(),
  tz: z.string().max(64).optional(),
  title: z.string().max(BUSY_TITLE_MAX * 8).nullable().optional(),
  note: z.string().max(BUSY_NOTE_MAX * 8).nullable().optional(),
  hideDetail: z.boolean().optional(),
};

type RuleFields = {
  rangeKind: RoutineRangeKind;
  fromWeek?: string | undefined;
  toWeek?: string | undefined;
  fromMonth?: string | undefined;
  toMonth?: string | undefined;
  allDay: boolean;
  startTime?: string | undefined;
  endTime?: string | undefined;
};

/** ช่วงต้องครบตามชนิด (weeks = fromWeek+toWeek · months = fromMonth+toMonth ห้ามปน) · ทั้งวัน = ห้ามมีเวลา · มีเวลา = ต้องครบสองปลาย */
function checkRule(v: RuleFields, ctx: z.RefinementCtx): void {
  const missing = (path: string) => ctx.addIssue({ code: 'invalid_type', expected: 'string', input: undefined, path: [path] });
  const forbidden = (path: string) => ctx.addIssue({ code: 'custom', path: [path], message: 'NOT_ALLOWED' });
  const need = v.rangeKind === 'weeks' ? (['fromWeek', 'toWeek'] as const) : (['fromMonth', 'toMonth'] as const);
  const deny = v.rangeKind === 'weeks' ? (['fromMonth', 'toMonth'] as const) : (['fromWeek', 'toWeek'] as const);
  for (const k of need) if (v[k] === undefined) missing(k);
  for (const k of deny) if (v[k] !== undefined) forbidden(k);
  if (v.allDay) {
    if (v.startTime !== undefined) forbidden('startTime');
    if (v.endTime !== undefined) forbidden('endTime');
  } else {
    if (v.startTime === undefined) missing('startTime');
    if (v.endTime === undefined) missing('endTime');
  }
}

export const createRoutineInputSchema = z.object(ruleShape).strict().superRefine(checkRule);
export type CreateRoutineInput = z.output<typeof createRoutineInputSchema>;

/** PATCH = กฎใหม่ทั้งชุด + from (ไม่ส่ง = "ทั้งหมด" ส่วนที่ยังไม่ผ่าน) — ADR 0012 §5 */
export const updateRoutineInputSchema = z
  .object({ ...ruleShape, from: dateField.optional() })
  .strict()
  .superRefine(checkRule);
export type UpdateRoutineInput = z.output<typeof updateRoutineInputSchema>;

export const routineParamsSchema = z.object({ id: z.uuid() });
/** GET /api/me/busy-routines — ไม่รับ query (คีย์แปลก → VALIDATION UNKNOWN_FIELD) */
export const listRoutinesQuerySchema = z.object({}).strict();
/** DELETE /api/me/busy-routines/:id?from=YYYY-MM-DD — ไม่ส่ง = ลบทั้งหมด (รวมวันที่ผ่านแล้ว) · คีย์แปลก → VALIDATION (route parse เอง) */
export const deleteRoutineQuerySchema = z.object({ from: dateField.optional() }).strict();

// ───────── helpers ─────────
const ownerRes = (actor: Actor) => ({ type: 'busy', ownerId: actor.kind === 'user' ? actor.id : '' }) as const;

/**
 * รหัสผิดพลาดของ planRoutine → AppError — รูปแบบเดียวกับ busy เดี่ยว (params.field ชี้ช่อง) · เพดานความยาว/ไกล = LIMIT_REACHED status 400 (ความผิดของอินพุต)
 * ux: docs/design/R14_BUSY_ROUTINE.md §6
 */
export function routineInputError(e: BusyInputError, rangeKind: RoutineRangeKind): AppError {
  const field = e.field;
  const params = (extra: Record<string, unknown> = {}) => ({ ...(field ? { field } : {}), ...extra });
  switch (e.code) {
    case 'INVALID_RANGE':
      return new AppError('INVALID_RANGE', params({ kind: field === 'endTime' || field === 'startTime' ? 'time' : 'dates' }));
    case 'RANGE_ENDED':
      return new AppError('INVALID_RANGE', params({ kind: 'dates', reason: 'ENDED' }));
    case 'TIME_NOT_ON_STEP':
    case 'INVALID_DATE':
    case 'DATE_OUT_OF_RANGE':
    case 'INVALID_LOCAL_TIME':
      return new AppError(e.code, params());
    case 'INVALID_TZ':
      return new AppError('INVALID_TIMEZONE', params());
    case 'SPAN_TOO_LONG':
      return new AppError(
        'LIMIT_REACHED',
        params({ limit: 'routineSpan', max: rangeKind === 'weeks' ? BUSY_ROUTINE_MAX_WEEKS : BUSY_ROUTINE_MAX_MONTHS, rangeKind }),
        { status: 400 },
      );
    case 'TOO_FAR_AHEAD':
      return new AppError('LIMIT_REACHED', params({ limit: 'routineAhead', max: BUSY_ROUTINE_MAX_AHEAD_MONTHS }), { status: 400 });
    case 'WEEKDAYS_REQUIRED':
      return new AppError('VALIDATION', { fields: { weekdays: 'REQUIRED' } });
    case 'NO_OCCURRENCE':
      return new AppError('VALIDATION', { fields: { weekdays: 'NO_OCCURRENCE' } });
    case 'INVALID_WEEKDAYS':
      return new AppError('VALIDATION', { fields: { weekdays: 'INVALID' } });
    case 'INVALID_TIME':
    case 'INVALID_FORMAT':
    case 'TOO_FAR_BACK':
      return new AppError('VALIDATION', { fields: { [field ?? '_']: 'INVALID' } });
  }
}

function rangeOf(v: RuleFields): RoutineRangeInput {
  return v.rangeKind === 'weeks'
    ? { rangeKind: 'weeks', fromWeek: v.fromWeek!, toWeek: v.toWeek! }
    : { rangeKind: 'months', fromMonth: v.fromMonth!, toMonth: v.toMonth! };
}

function planOrThrow(
  v: RuleFields & { weekdays: number[]; tz?: string | undefined },
  now: number,
  extra: { startDate?: string; requireOccurrence?: boolean } = {},
): RoutinePlan {
  const r = planRoutine(
    { range: rangeOf(v), weekdays: v.weekdays, allDay: v.allDay, startTime: v.startTime, endTime: v.endTime, tz: v.tz ?? DEFAULT_TZ },
    {
      now,
      maxWeeks: BUSY_ROUTINE_MAX_WEEKS,
      maxMonths: BUSY_ROUTINE_MAX_MONTHS,
      maxAheadMonths: BUSY_ROUTINE_MAX_AHEAD_MONTHS,
      ...(extra.startDate !== undefined ? { startDate: extra.startDate } : {}),
      ...(extra.requireOccurrence !== undefined ? { requireOccurrence: extra.requireOccurrence } : {}),
    },
  );
  if (!r.ok) throw routineInputError(r.error, v.rangeKind);
  return r.value;
}

function writeOf(plan: RoutinePlan, v: { title?: string | null | undefined; note?: string | null | undefined; hideDetail?: boolean | undefined }): RoutineWrite {
  const { rule } = plan;
  return {
    title: parseBusyTitle(v.title),
    note: parseBusyNote(v.note),
    hideDetail: v.hideDetail ?? false,
    allDay: rule.allDay,
    weekdays: rule.weekdays,
    startMin: rule.startMin,
    endMin: rule.endMin,
    rangeKind: plan.rangeKind,
    startDate: rule.startDate,
    endDate: rule.endDate,
    tz: rule.tz,
  };
}

const rowsOf = (plan: RoutinePlan, skip: ReadonlySet<string> = new Set()) =>
  plan.rows
    .filter((r) => !skip.has(r.localStartDate))
    .map((r) => ({ id: newId(), startAt: r.startAt, endAt: r.endAt, localStartDate: r.localStartDate, localEndDate: r.localEndDate }));

const limitRoutines = () => new AppError('LIMIT_REACHED', { limit: 'routines', max: BUSY_ROUTINE_MAX_ACTIVE });
const limitRows = () => new AppError('LIMIT_REACHED', { limit: 'routineRows', max: BUSY_ROUTINE_MAX_FUTURE_ROWS });

/** INSERT กฎถูกปฏิเสธ: เต็ม 10 → LIMIT_REACHED · อื่น ๆ (บัญชีเปลี่ยนสถานะระหว่างทาง) → CONFLICT */
async function whyRoutineRejected(tx: Tx, userId: string, today: string): Promise<AppError> {
  return (await countActiveRoutines(tx, userId, today)) >= BUSY_ROUTINE_MAX_ACTIVE ? limitRoutines() : new AppError('CONFLICT');
}

/** INSERT แถวถูกปฏิเสธ: เกิน 1,500 → LIMIT_REACHED · อื่น ๆ → CONFLICT */
async function whyRowsRejected(tx: Tx, userId: string, now: number, adding: number): Promise<AppError> {
  return (await countFutureRoutineRows(tx, userId, now)) + adding > BUSY_ROUTINE_MAX_FUTURE_ROWS ? limitRows() : new AppError('CONFLICT');
}

/** UPDATE กฎถูกปฏิเสธ: หายแล้ว → NOT_FOUND · ถูกแก้ซ้อน/บัญชีเปลี่ยนสถานะ → CONFLICT · ต่ออายุชุดที่จบแล้วตอนเต็ม 10 → LIMIT_REACHED */
async function whyUpdateRejected(tx: Tx, current: OwnRoutineRow, userId: string, today: string, nextEnd?: string): Promise<AppError> {
  const now = await findOwnRoutine(tx, current.id, userId);
  if (!now) return new AppError('NOT_FOUND');
  if (now.updatedAt !== current.updatedAt) return new AppError('CONFLICT');
  if (nextEnd !== undefined && current.endDate < today && nextEnd >= today && (await countActiveRoutines(tx, userId, today)) >= BUSY_ROUTINE_MAX_ACTIVE) {
    return limitRoutines();
  }
  return new AppError('CONFLICT');
}

const futureCount = (rows: readonly { endAt: number }[], now: number) => rows.filter((r) => r.endAt > now).length;

function parseFrom(from: string | undefined): string | undefined {
  if (from === undefined) return undefined;
  if (!isValidDate(from)) throw new AppError('VALIDATION', { fields: { from: 'INVALID' } });
  return from;
}

// ───────── API ─────────
export type CreateRoutineResult = { routine: RoutineOwnView; count: number };

/** POST — กฎ + แถวทุกวัน (ตั้งแต่วันนี้) ใน tx เดียว ทั้งหมดหรือไม่มีเลย · count = จำนวนวันที่ลง */
export async function createRoutine(actor: Actor, input: CreateRoutineInput, ctx: DataCtx): Promise<CreateRoutineResult> {
  authorize(actor, 'busy.routine.create', { type: 'none' });
  const me = asUser(actor);
  const { now } = ctx;
  const plan = planOrThrow(input, now);
  const write = writeOf(plan, input);
  await takeUserSlot(ctx.db, BUSY_ROUTINE_RATE_LIMIT, me.id, now);
  const rows = rowsOf(plan);
  const routine = await inTx(ctx.db, async (tx) => {
    // คำสั่งแรก = INSERT กฎ (เพดาน 10 ในคำสั่ง) → INSERT แถว (เพดาน 1,500 ในคำสั่ง) · ล้มที่ใดก็ rollback ทั้งก้อน
    const created = await insertRoutineIfUnderCap(tx, { id: newId(), userId: me.id, write, cap: BUSY_ROUTINE_MAX_ACTIVE, today: plan.today }, now);
    if (!created) throw await whyRoutineRejected(tx, me.id, plan.today);
    const ok = await insertRoutineRowsIfUnderCap(
      tx,
      { userId: me.id, routineId: created.id, cap: BUSY_ROUTINE_MAX_FUTURE_ROWS, shared: { title: write.title, note: write.note, hideDetail: write.hideDetail, allDay: write.allDay, tz: write.tz }, rows },
      now,
    );
    if (!ok) throw await whyRowsRejected(tx, me.id, now, futureCount(rows, now));
    return created;
  });
  return { routine: toRoutineOwnView(routine, futureCount(rows, now)), count: rows.length };
}

export async function listMyRoutines(actor: Actor, ctx: DataCtx): Promise<{ routines: RoutineOwnView[]; truncated: boolean }> {
  authorize(actor, 'busy.routine.list.own', { type: 'none' });
  const me = asUser(actor);
  const rows = await listOwnRoutines(ctx.db, me.id, ctx.now, todayIn(DEFAULT_TZ, ctx.now), BUSY_ROUTINE_LIST_MAX + 1);
  return { routines: rows.slice(0, BUSY_ROUTINE_LIST_MAX).map((r) => toRoutineOwnView(r)), truncated: rows.length > BUSY_ROUTINE_LIST_MAX };
}

export type UpdateRoutineResult = {
  /** กฎที่ครอบ from แล้ว (แก้ในที่ = ชุดเดิม · แยก = ชุดใหม่) */
  routine: RoutineOwnView;
  /** แยกชุด: ชุดเดิมที่ถูกตัดวันจบเป็น from − 1 · แก้ในที่ = null */
  previous: RoutineOwnView | null;
  /** จำนวนวันที่ลงใหม่ */
  count: number;
};

/**
 * PATCH — แก้ตั้งแต่ from (ปัดเป็นต้นสัปดาห์/ต้นเดือนตาม range_kind ของชุดเดิม · ไม่ส่ง = วันนี้ = "ทั้งหมด" ส่วนที่ยังไม่ผ่าน) — ADR 0012 §5
 *  - from ≤ วันนี้ หรือ ≤ วันแรกของชุด → แก้ในที่: UPDATE กฎ · ลบแถวของชุดที่วันเริ่ม ≥ วันนี้ · ขยายใหม่ตั้งแต่วันนี้ (เว้นวันใน skip)
 *  - from > วันนี้ และ > วันแรก → แยก: ชุดเดิมจบ from − 1 · ชุดใหม่ (กฎใหม่) เริ่ม from · ย้าย skip ≥ from · ลบแถวเดิม ≥ from · ขยายชุดใหม่
 *  แถวในอดีตและวันที่แยกเป็น busy เดี่ยวแล้วไม่ถูกแตะ · ความยาว (26 สัปดาห์/6 เดือน) คิดจากช่วงที่จะเก็บ (ต่ออายุชุดยาว = ส่งช่วงที่เริ่มสัปดาห์/เดือนนี้)
 */
export async function updateRoutine(actor: Actor, id: string, input: UpdateRoutineInput, ctx: DataCtx): Promise<UpdateRoutineResult> {
  authorize(actor, 'busy.routine.update', ownerRes(actor));
  const me = asUser(actor);
  const { now } = ctx;
  const from = parseFrom(input.from);
  const current = await findOwnRoutine(ctx.db, id, me.id);
  if (!current) throw new AppError('NOT_FOUND');
  const tz = input.tz ?? current.tz;
  const spec = { ...input, tz };
  const today = todayIn(tz, now);
  const fromStart = from === undefined ? undefined : routinePeriodStart(from, current.rangeKind);
  const split = fromStart !== undefined && fromStart > today && fromStart > current.startDate;
  if (split && fromStart > current.endDate) throw new AppError('INVALID_RANGE', { field: 'from', kind: 'dates' });

  const plan = split ? planOrThrow(spec, now, { startDate: fromStart }) : planOrThrow(spec, now, { requireOccurrence: false });
  const write = writeOf(plan, input);
  const shared = { title: write.title, note: write.note, hideDetail: write.hideDetail, allDay: write.allDay, tz: write.tz };
  await takeUserSlot(ctx.db, BUSY_ROUTINE_RATE_LIMIT, me.id, now);

  return inTx(ctx.db, async (tx) => {
    if (!split) {
      const updated = await updateOwnRoutineGuarded(
        tx,
        { id, userId: me.id, expectedUpdatedAt: current.updatedAt, write, cap: BUSY_ROUTINE_MAX_ACTIVE, today: plan.today },
        now,
      );
      if (!updated) throw await whyUpdateRejected(tx, current, me.id, plan.today, write.endDate);
      const skip = new Set(await listRoutineSkips(tx, id, me.id));
      await deleteRoutineRowsFrom(tx, { routineId: id, userId: me.id, fromDate: plan.today });
      const rows = rowsOf(plan, skip);
      if (!(await insertRoutineRowsIfUnderCap(tx, { userId: me.id, routineId: id, cap: BUSY_ROUTINE_MAX_FUTURE_ROWS, shared, rows }, now))) {
        throw await whyRowsRejected(tx, me.id, now, futureCount(rows, now));
      }
      return { routine: toRoutineOwnView(updated, futureCount(rows, now)), previous: null, count: rows.length };
    }
    const cutEnd = addDays(fromStart!, -1);
    const truncated = await setOwnRoutineEndGuarded(tx, { id, userId: me.id, expectedUpdatedAt: current.updatedAt, endDate: cutEnd }, now);
    if (!truncated) throw await whyUpdateRejected(tx, current, me.id, plan.today);
    const next = await insertRoutineIfUnderCap(tx, { id: newId(), userId: me.id, write, cap: BUSY_ROUTINE_MAX_ACTIVE, today: plan.today }, now);
    if (!next) throw await whyRoutineRejected(tx, me.id, plan.today);
    await moveRoutineSkips(tx, { fromId: id, toId: next.id, userId: me.id, fromDate: fromStart! });
    const skip = new Set(await listRoutineSkips(tx, next.id, me.id));
    await deleteRoutineRowsFrom(tx, { routineId: id, userId: me.id, fromDate: fromStart! });
    const rows = rowsOf(plan, skip);
    if (!(await insertRoutineRowsIfUnderCap(tx, { userId: me.id, routineId: next.id, cap: BUSY_ROUTINE_MAX_FUTURE_ROWS, shared, rows }, now))) {
      throw await whyRowsRejected(tx, me.id, now, futureCount(rows, now));
    }
    return {
      routine: toRoutineOwnView(next, futureCount(rows, now)),
      previous: toRoutineOwnView(truncated, await countRoutineRemaining(tx, id, me.id, now)),
      count: rows.length,
    };
  });
}

export type DeleteRoutineResult = { deleted: true; scope: 'all' | 'from'; count: number };

/**
 * DELETE — ไม่ส่ง from = ลบทั้งหมด (กฎ + ทุกวันรวมอดีต) · from = หยุดตั้งแต่ (ปัดเป็นต้นสัปดาห์/เดือน · ไม่ก่อนวันนี้ — วันในอดีตคงเดิม)
 * หยุดตั้งแต่วันที่ ≤ วันแรกของชุด = ไม่มีวันก่อนหน้าให้คงไว้ → ลบทั้งหมด · count = จำนวนวันที่ลบ (บอกเจ้าของเท่านั้น)
 */
export async function deleteRoutine(actor: Actor, id: string, ctx: DataCtx, fromRaw?: string): Promise<DeleteRoutineResult> {
  authorize(actor, 'busy.routine.delete', ownerRes(actor));
  const me = asUser(actor);
  const { now } = ctx;
  const from = parseFrom(fromRaw);
  const current = from === undefined ? null : await findOwnRoutine(ctx.db, id, me.id);
  if (from !== undefined && !current) throw new AppError('NOT_FOUND');
  await takeUserSlot(ctx.db, BUSY_ROUTINE_RATE_LIMIT, me.id, now);

  const deleteAll = async (): Promise<DeleteRoutineResult> => {
    const count = await inTx(ctx.db, (tx) => deleteOwnRoutine(tx, id, me.id));
    if (count === null) throw new AppError('NOT_FOUND');
    return { deleted: true, scope: 'all', count };
  };
  if (current === null) return deleteAll();

  const today = todayIn(current.tz, now);
  const fromStart = routinePeriodStart(from!, current.rangeKind);
  const cut = fromStart > today ? fromStart : today;
  if (cut <= current.startDate) return deleteAll();
  if (cut > current.endDate) return { deleted: true, scope: 'from', count: 0 }; // ไม่มีวันหลัง cut ให้หยุด
  const count = await inTx(ctx.db, async (tx) => {
    const cutDone = await setOwnRoutineEndGuarded(tx, { id, userId: me.id, expectedUpdatedAt: current.updatedAt, endDate: addDays(cut, -1) }, now);
    if (!cutDone) throw await whyUpdateRejected(tx, current, me.id, today);
    const n = await deleteRoutineRowsFrom(tx, { routineId: id, userId: me.id, fromDate: cut });
    await deleteRoutineSkipsFrom(tx, { routineId: id, userId: me.id, fromDate: cut });
    return n;
  });
  return { deleted: true, scope: 'from', count };
}
