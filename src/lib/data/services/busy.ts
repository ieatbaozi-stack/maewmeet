// service: busy ของฉัน — U7 · D5 · ADR 0004 §2, ADR 0006 · เจ้าของเท่านั้น (SA ก็แก้/ลบของคนอื่นไม่ได้ — PRD §3 แถว 3)
//  - authorize() บรรทัดแรกทุกฟังก์ชัน (ด่านบัญชี: anonymous / suspended / must_change_pin) แล้วจึงแตะข้อมูล
//  - รายการของคนอื่น = ไม่มี: คิวรีผูก user_id ของผู้กระทำ → NOT_FOUND (404) เหมือนไม่มี id นั้น (IDOR) ไม่ใช่ FORBIDDEN
//  - เวลาทั้งหมดผ่าน normalizeBusyInput ของ lib เวลา (ไม่คำนวณวันเอง) · ขีดจำกัดจาก src/lib/shared/limits.ts
//  - เพดาน 300 = คำสั่งเดียวมีเงื่อนไขในตัว (repo) — ที่นี่แค่วินิจฉัยสาเหตุหลังถูกปฏิเสธ
//  - R6F (ADR 0010): kind 'daily' ขยายด้วย expandDailyBusyInput → insert N แถวคำสั่งเดียว (ทั้งหมดหรือไม่มีเลย) · ลบ scope=series · PATCH = หลุดจากชุด
//  - rate limit เขียน (BUSY_WRITE_RATE_LIMITS): create 30/10 นาที, delete 60/10 นาที ต่อผู้ใช้ → RATE_LIMITED + Retry-After
import { z } from 'zod';
import { DEFAULT_TZ, expandDailyBusyInput, normalizeBusyInput, type BusyInput, type BusyInputError, type BusyRow } from '@/lib/calendar';
import {
  activeBusyCount,
  deleteOwnBusy,
  deleteOwnBusySeries,
  findOwnBusy,
  insertBusyIfUnderCap,
  insertBusySeriesIfUnderCap,
  listOwnActiveBusy,
  listOwnBusyInRange,
  updateOwnBusyIfUnderCap,
  type BusyWrite,
  type OwnBusyRow,
} from '@/lib/data/repos/busy';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import {
  BUSY_MAX_BACKDATE_DAYS,
  BUSY_MAX_PER_USER,
  BUSY_MAX_SPAN_DAYS,
  BUSY_MAX_TIMED_DAYS,
  BUSY_NOTE_MAX,
  BUSY_TITLE_MAX,
  BUSY_WRITE_RATE_LIMITS,
  ME_BUSY_RANGE_MAX_ITEMS,
} from '@/lib/shared/limits';
import { checkVisibleName, hasForbiddenChars } from '@/lib/shared/name-rules';
import { takeUserSlot } from '../admin-input';
import type { DataCtx } from '../context';
import { toBusyOwnView, type BusyOwnView } from '../serializers/busy';
import { inTx } from '../tx';
import { asUser } from './group-common';
import { parseDateRange } from './calendar';

// ───────── input schemas (zod ที่ route · strict = คีย์แปลก/userId/id/createdAt ฯลฯ ถูกปฏิเสธ — mass assignment) ─────────
const kindField = z.enum(['all_day', 'timed']);
/** R6F (ADR 0010 §1): 'daily' = ชุดรายวัน — **สร้างเท่านั้น** (PATCH ส่ง 'daily' = VALIDATION) */
const createKindField = z.enum(['all_day', 'timed', 'daily']);
const dateField = z.string().max(32);
const timeField = z.string().max(16);
const tzField = z.string().max(64);
// ความยาวดิบกว้างกว่าเพดานจริงเล็กน้อย: เพดานจริงนับเป็น code point หลัง NFC ใน service (TOO_LONG)
const titleField = z.string().max(BUSY_TITLE_MAX * 8).nullable();
const noteField = z.string().max(BUSY_NOTE_MAX * 8).nullable();

const metaShape = {
  title: titleField.optional(),
  note: noteField.optional(),
  hideDetail: z.boolean().optional(),
};
const scheduleFields = {
  startDate: dateField.optional(),
  endDate: dateField.optional(),
  startTime: timeField.optional(),
  endTime: timeField.optional(),
  tz: tzField.optional(),
};
const scheduleShape = { kind: kindField.optional(), ...scheduleFields };
const createScheduleShape = { kind: createKindField.optional(), ...scheduleFields };

type FlatInput = {
  kind?: 'all_day' | 'timed' | 'daily' | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  tz?: string | undefined;
};

/** ฟิลด์ตารางเวลาต้องครบตามแบบ: all_day = วันเริ่ม/จบ (ห้ามมีเวลา) · timed / daily = วัน+เวลาทั้งสองปลาย */
function checkSchedule(v: FlatInput, ctx: z.RefinementCtx): void {
  const missing = (path: string) => ctx.addIssue({ code: 'invalid_type', expected: 'string', input: undefined, path: [path] });
  const forbidden = (path: string) => ctx.addIssue({ code: 'custom', path: [path], message: 'NOT_ALLOWED' });
  if (v.kind === undefined) missing('kind');
  if (v.startDate === undefined) missing('startDate');
  if (v.endDate === undefined) missing('endDate');
  if (v.kind === 'timed' || v.kind === 'daily') {
    if (v.startTime === undefined) missing('startTime');
    if (v.endTime === undefined) missing('endTime');
  } else {
    if (v.startTime !== undefined) forbidden('startTime');
    if (v.endTime !== undefined) forbidden('endTime');
  }
}

export const createBusyInputSchema = z
  .object({ ...createScheduleShape, ...metaShape })
  .strict()
  .superRefine(checkSchedule);
export type CreateBusyInput = z.output<typeof createBusyInputSchema>;

const SCHEDULE_KEYS = Object.keys(scheduleShape) as (keyof FlatInput)[];

/** PATCH: ตารางเวลาเป็น "ทั้งก้อนหรือไม่ส่งเลย" (ส่งอย่างใดอย่างหนึ่ง = ต้องครบตามแบบ) · title/note/hideDetail ส่งทีละฟิลด์ได้ · ต้องมีอย่างน้อยหนึ่งฟิลด์ */
export const updateBusyInputSchema = z
  .object({ ...scheduleShape, ...metaShape })
  .strict()
  .superRefine((v, ctx) => {
    const touchesSchedule = SCHEDULE_KEYS.some((k) => v[k] !== undefined);
    if (touchesSchedule) checkSchedule(v, ctx);
    else if (v.title === undefined && v.note === undefined && v.hideDetail === undefined) {
      ctx.addIssue({ code: 'custom', path: ['_'], message: 'EMPTY' });
    }
  });
export type UpdateBusyInput = z.output<typeof updateBusyInputSchema>;

export const busyParamsSchema = z.object({ id: z.uuid() });
/** DELETE /api/me/busy/:id?scope=one|series (R6F, ADR 0010 §5) — ไม่ส่ง = 'one' · ค่า/คีย์แปลก → VALIDATION (route parse เอง) */
export const deleteBusyQuerySchema = z.object({ scope: z.enum(['one', 'series']).optional() }).strict();
export type DeleteBusyScope = 'one' | 'series';
/** GET /api/me/busy — ไม่ส่งอะไร = รายการที่ยังไม่สิ้นสุด · ส่ง from+to = รายการที่ครอบช่วงนั้น (≤ CALENDAR_MAX_RANGE_DAYS วัน) */
export const listBusyQuerySchema = z.object({ from: dateField.optional(), to: dateField.optional() }).strict();
export type ListBusyQuery = z.output<typeof listBusyQuerySchema>;

// ───────── helpers ─────────
const ownerRes = (ownerId: string) => ({ type: 'busy', ownerId }) as const;

/** ข้อความ "ทำอะไร" — ว่าง/ช่องว่างล้วน → null · ไม่งั้นกติกาชื่อที่คนอื่นเห็น (ไม่มีตัวควบคุม/bidi/zero-width) 1–80 */
export function parseBusyTitle(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const r = checkVisibleName(raw, { min: 1, max: BUSY_TITLE_MAX });
  if (!r.ok) throw new AppError('VALIDATION', { fields: { title: r.reason } });
  return r.name;
}


/** บันทึกส่วนตัว (เจ้าของเห็นคนเดียว) — NFC, \r\n→\n, ตัดหัวท้าย, ≤ 500 code point, ห้ามตัวควบคุม/จัดรูป (bidi, zero-width ฯลฯ — กติกาเดียวกับ title) นอกจากขึ้นบรรทัด/แท็บ · ว่าง → null */
export function parseBusyNote(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (text === '') return null;
  if (hasForbiddenChars(text.replace(/[\n\t]/g, ''))) throw new AppError('VALIDATION', { fields: { note: 'INVALID' } });
  if ([...text].length > BUSY_NOTE_MAX) throw new AppError('VALIDATION', { fields: { note: 'TOO_LONG' } });
  return text;
}

/**
 * รหัสผิดพลาดของ lib เวลา → AppError (R3_CONTRACT §2 · UX §7.5 "จับคู่ error → ตำแหน่ง")
 * ชื่อฟิลด์ที่ผิดอยู่ใน params.field · SPAN_TOO_LONG/TOO_FAR_BACK → LIMIT_REACHED {limit, max} (status 400: เป็นความผิดของอินพุต ไม่ใช่สถานะของบัญชี)
 */
export function busyInputError(e: BusyInputError, kind: 'all_day' | 'timed' | 'daily'): AppError {
  const field = e.field;
  const params = (extra: Record<string, unknown> = {}) => ({ ...(field ? { field } : {}), ...extra });
  switch (e.code) {
    case 'INVALID_RANGE': {
      // daily (R6F): endDate < startDate = 'dates' · endTime ≤ startTime = 'time'
      const rangeKind = kind === 'all_day' ? 'dates' : kind === 'timed' ? 'time' : field === 'endDate' ? 'dates' : 'time';
      return new AppError('INVALID_RANGE', params({ kind: rangeKind }));
    }
    case 'TIME_NOT_ON_STEP':
    case 'INVALID_DATE':
    case 'DATE_OUT_OF_RANGE':
    case 'INVALID_LOCAL_TIME':
      return new AppError(e.code, params());
    case 'INVALID_TZ':
      return new AppError('INVALID_TIMEZONE', params());
    case 'SPAN_TOO_LONG':
      return new AppError('LIMIT_REACHED', params({ limit: 'busySpan', max: kind === 'all_day' ? BUSY_MAX_SPAN_DAYS : BUSY_MAX_TIMED_DAYS }), { status: 400 });
    case 'TOO_FAR_BACK':
      return new AppError('LIMIT_REACHED', params({ limit: 'busyBackdate', max: BUSY_MAX_BACKDATE_DAYS }), { status: 400 });
    case 'INVALID_TIME':
    case 'INVALID_FORMAT':
      return new AppError('VALIDATION', { fields: { [field ?? '_']: 'INVALID' } });
  }
}

function scheduleFrom(v: FlatInput, now: number): BusyRow {
  if (v.kind === 'daily') throw new TypeError('scheduleFrom: daily is expanded by dailyScheduleFrom'); // zod ของ PATCH ไม่รับ daily
  const tz = v.tz ?? DEFAULT_TZ;
  const input: BusyInput =
    v.kind === 'timed'
      ? { kind: 'timed', startDate: v.startDate!, startTime: v.startTime!, endDate: v.endDate!, endTime: v.endTime!, tz }
      : { kind: 'all_day', startDate: v.startDate!, endDate: v.endDate!, tz };
  const r = normalizeBusyInput(input, {
    now,
    maxSpanDays: BUSY_MAX_SPAN_DAYS,
    maxBackdateDays: BUSY_MAX_BACKDATE_DAYS,
    maxTimedDays: BUSY_MAX_TIMED_DAYS,
  });
  if (!r.ok) throw busyInputError(r.error, v.kind ?? 'all_day');
  return r.value;
}

const limitCount = () => new AppError('LIMIT_REACHED', { limit: 'busyCount', max: BUSY_MAX_PER_USER });

/**
 * การเขียนไม่ได้แถวทั้งที่ผ่านด่านต่าง ๆ มาแล้ว: เต็มเพดาน (ที่มีอยู่ + n > cap) → LIMIT_REACHED · อื่น ๆ (บัญชีเปลี่ยนสถานะระหว่างทาง) → CONFLICT
 * n = จำนวนแถวที่ขอเพิ่ม (เดี่ยว = 1 → เท่ากับ count >= cap แบบเดิม · ชุดรายวัน = N)
 */
async function whyRejected(ctx: DataCtx, tx: Parameters<typeof activeBusyCount>[0], userId: string, n = 1): Promise<AppError> {
  return (await activeBusyCount(tx, userId, ctx.now)) + n > BUSY_MAX_PER_USER ? limitCount() : new AppError('CONFLICT');
}

/** ผลของ POST kind 'daily' (ADR 0010 §1) — items เรียง startAt · count = items.length · seriesId = null เมื่อได้วันเดียว */
export type CreateBusySeriesResult = { seriesId: string | null; count: number; items: BusyOwnView[] };

// ───────── U7 ─────────
/**
 * all_day / timed → `{ busy }` (เดิม) · daily (R6F) → `{ seriesId, count, items }` ทั้งหมดหรือไม่มีเลย
 * ลำดับ: authorize → ตรวจ/ขยายอินพุต (lib เวลา) → title/note → rate limit (ผิดอินพุตไม่กินโควตา — แบบนัด) → เขียนใน inTx (เพดาน 300 คำสั่งเดียว)
 */
export async function createBusy(actor: Actor, input: CreateBusyInput, ctx: DataCtx): Promise<{ busy: BusyOwnView } | CreateBusySeriesResult> {
  authorize(actor, 'busy.create', { type: 'none' });
  if (input.kind === 'daily') return createDailySeries(asUser(actor).id, input, ctx);
  const me = asUser(actor);
  const { now } = ctx;
  const schedule = scheduleFrom(input, now);
  const write: BusyWrite = {
    ...schedule,
    title: parseBusyTitle(input.title),
    note: parseBusyNote(input.note),
    hideDetail: input.hideDetail ?? false,
  };
  await takeUserSlot(ctx.db, BUSY_WRITE_RATE_LIMITS.create, me.id, now);
  const row = await inTx(ctx.db, async (tx) => {
    const created = await insertBusyIfUnderCap(tx, { ...write, id: newId(), userId: me.id, cap: BUSY_MAX_PER_USER }, now);
    if (!created) throw await whyRejected(ctx, tx, me.id);
    return created;
  });
  return { busy: toBusyOwnView(row) };
}

/** R6F (ADR 0010 §1–§3) — เรียกจาก createBusy หลัง authorize เท่านั้น */
async function createDailySeries(userId: string, input: CreateBusyInput, ctx: DataCtx): Promise<CreateBusySeriesResult> {
  const { now } = ctx;
  const r = expandDailyBusyInput(
    { kind: 'daily', startDate: input.startDate!, endDate: input.endDate!, startTime: input.startTime!, endTime: input.endTime!, tz: input.tz ?? DEFAULT_TZ },
    { now, maxDays: BUSY_MAX_TIMED_DAYS, maxBackdateDays: BUSY_MAX_BACKDATE_DAYS },
  );
  if (!r.ok) throw busyInputError(r.error, 'daily');
  const days = r.value;
  const shared = {
    title: parseBusyTitle(input.title),
    note: parseBusyNote(input.note),
    hideDetail: input.hideDetail ?? false,
    tz: days[0]!.tz,
  };
  await takeUserSlot(ctx.db, BUSY_WRITE_RATE_LIMITS.create, userId, now);
  // N = 1 → ไม่มีชุด (หน้าตา/พฤติกรรมเหมือน timed ทุกอย่าง — ADR 0010 §3)
  const seriesId = days.length >= 2 ? newId() : null;
  const rows = days.map((d) => ({ id: newId(), startAt: d.startAt, endAt: d.endAt, localStartDate: d.localStartDate, localEndDate: d.localEndDate }));
  const created = await inTx(ctx.db, async (tx) => {
    // INSERT เป็นคำสั่งแรกของธุรกรรม (ADR 0010 §3 [S5]) · ได้ไม่ครบ N → throw ใน inTx = rollback ทั้งก้อน
    const out = await insertBusySeriesIfUnderCap(tx, { userId, seriesId, cap: BUSY_MAX_PER_USER, shared, rows }, now);
    if (!out || out.length !== rows.length) throw await whyRejected(ctx, tx, userId, rows.length);
    return out;
  });
  return { seriesId, count: created.length, items: created.map(toBusyOwnView) };
}

export async function listMyBusy(actor: Actor, query: ListBusyQuery, ctx: DataCtx): Promise<{ busy: BusyOwnView[]; truncated: boolean }> {
  authorize(actor, 'busy.list.own', { type: 'none' });
  const me = asUser(actor);
  let rows: OwnBusyRow[];
  let truncated = false;
  if (query.from === undefined && query.to === undefined) {
    rows = await listOwnActiveBusy(ctx.db, me.id, ctx.now, BUSY_MAX_PER_USER + 100);
  } else {
    if (query.from === undefined || query.to === undefined) {
      throw new AppError('VALIDATION', { fields: { [query.from === undefined ? 'from' : 'to']: 'REQUIRED' } });
    }
    const range = parseDateRange(query.from, query.to);
    rows = await listOwnBusyInRange(ctx.db, me.id, range.from, range.to, ME_BUSY_RANGE_MAX_ITEMS + 1);
    if (rows.length > ME_BUSY_RANGE_MAX_ITEMS) {
      truncated = true;
      rows = rows.slice(0, ME_BUSY_RANGE_MAX_ITEMS);
    }
  }
  return { busy: rows.map(toBusyOwnView), truncated };
}

export async function updateBusy(actor: Actor, id: string, input: UpdateBusyInput, ctx: DataCtx): Promise<{ busy: BusyOwnView }> {
  // ownerId = ผู้กระทำ: ด่านบัญชีของ can() ทำงานก่อน · ความเป็นเจ้าของตัดสินจริงที่คิวรี (user_id = ผู้กระทำ) → ไม่ใช่ = NOT_FOUND
  authorize(actor, 'busy.update', ownerRes(actor.kind === 'user' ? actor.id : ''));
  const me = asUser(actor);
  const { now } = ctx;
  const current = await findOwnBusy(ctx.db, id, me.id);
  if (!current) throw new AppError('NOT_FOUND');

  const touchesSchedule = SCHEDULE_KEYS.some((k) => input[k] !== undefined);
  const schedule: BusyRow = touchesSchedule
    ? scheduleFrom(input, now)
    : {
        allDay: current.allDay,
        startAt: current.startAt,
        endAt: current.endAt,
        localStartDate: current.localStartDate,
        localEndDate: current.localEndDate,
        tz: current.tz,
      };
  const next: BusyWrite = {
    ...schedule,
    title: input.title === undefined ? current.title : parseBusyTitle(input.title),
    note: input.note === undefined ? current.note : parseBusyNote(input.note),
    hideDetail: input.hideDetail ?? current.hideDetail,
    // R6F (ADR 0010 §5): PATCH สำเร็จทุกครั้ง (แม้แก้แค่ชื่อ) = วันนั้นหลุดจากชุด
    seriesId: null,
  };
  const row = await inTx(ctx.db, async (tx) => {
    const updated = await updateOwnBusyIfUnderCap(tx, id, me.id, next, BUSY_MAX_PER_USER, now);
    if (updated) return updated;
    if (!(await findOwnBusy(tx, id, me.id))) throw new AppError('NOT_FOUND'); // ถูกลบระหว่างทาง
    throw await whyRejected(ctx, tx, me.id);
  });
  return { busy: toBusyOwnView(row) };
}

/**
 * ลบ busy ของตัวเอง · scope 'one' (ดีฟอลต์ = ลบวันนี้) · 'series' (R6F) = ลบทุกวันในชุดของแถวนี้ รวมวันที่ผ่านไปแล้ว (แถวไม่มีชุด → แถวเดียว)
 * ความเป็นเจ้าของตัดสินที่ SQL (user_id = ผู้กระทำ) → ของคนอื่น/ไม่มี = NOT_FOUND · count = จำนวนแถวที่ลบ (บอกเจ้าของเท่านั้น)
 */
export async function deleteBusy(actor: Actor, id: string, ctx: DataCtx, scope: DeleteBusyScope = 'one'): Promise<{ deleted: true; count: number }> {
  authorize(actor, 'busy.delete', ownerRes(actor.kind === 'user' ? actor.id : ''));
  const me = asUser(actor);
  await takeUserSlot(ctx.db, BUSY_WRITE_RATE_LIMITS.delete, me.id, ctx.now);
  const count = await inTx(ctx.db, async (tx) => (scope === 'series' ? deleteOwnBusySeries(tx, id, me.id) : (await deleteOwnBusy(tx, id, me.id)) ? 1 : 0));
  if (count === 0) throw new AppError('NOT_FOUND');
  return { deleted: true, count };
}
