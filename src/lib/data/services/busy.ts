// service: busy ของฉัน — U7 · D5 · ADR 0004 §2, ADR 0006 · เจ้าของเท่านั้น (SA ก็แก้/ลบของคนอื่นไม่ได้ — PRD §3 แถว 3)
//  - authorize() บรรทัดแรกทุกฟังก์ชัน (ด่านบัญชี: anonymous / suspended / must_change_pin) แล้วจึงแตะข้อมูล
//  - รายการของคนอื่น = ไม่มี: คิวรีผูก user_id ของผู้กระทำ → NOT_FOUND (404) เหมือนไม่มี id นั้น (IDOR) ไม่ใช่ FORBIDDEN
//  - เวลาทั้งหมดผ่าน normalizeBusyInput ของ lib เวลา (ไม่คำนวณวันเอง) · ขีดจำกัดจาก src/lib/shared/limits.ts
//  - เพดาน 300 = คำสั่งเดียวมีเงื่อนไขในตัว (repo) — ที่นี่แค่วินิจฉัยสาเหตุหลังถูกปฏิเสธ
import { z } from 'zod';
import { DEFAULT_TZ, normalizeBusyInput, type BusyInput, type BusyInputError, type BusyRow } from '@/lib/calendar';
import {
  activeBusyCount,
  deleteOwnBusy,
  findOwnBusy,
  insertBusyIfUnderCap,
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
} from '@/lib/shared/limits';
import { checkVisibleName } from '@/lib/shared/name-rules';
import type { DataCtx } from '../context';
import { toBusyOwnView, type BusyOwnView } from '../serializers/busy';
import { inTx } from '../tx';
import { asUser } from './group-common';
import { parseDateRange } from './calendar';

// ───────── input schemas (zod ที่ route · strict = คีย์แปลก/userId/id/createdAt ฯลฯ ถูกปฏิเสธ — mass assignment) ─────────
const kindField = z.enum(['all_day', 'timed']);
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
const scheduleShape = {
  kind: kindField.optional(),
  startDate: dateField.optional(),
  endDate: dateField.optional(),
  startTime: timeField.optional(),
  endTime: timeField.optional(),
  tz: tzField.optional(),
};

type FlatInput = {
  kind?: 'all_day' | 'timed' | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  tz?: string | undefined;
};

/** ฟิลด์ตารางเวลาต้องครบตามแบบ: all_day = วันเริ่ม/จบ (ห้ามมีเวลา) · timed = วัน+เวลาทั้งสองปลาย */
function checkSchedule(v: FlatInput, ctx: z.RefinementCtx): void {
  const missing = (path: string) => ctx.addIssue({ code: 'invalid_type', expected: 'string', input: undefined, path: [path] });
  const forbidden = (path: string) => ctx.addIssue({ code: 'custom', path: [path], message: 'NOT_ALLOWED' });
  if (v.kind === undefined) missing('kind');
  if (v.startDate === undefined) missing('startDate');
  if (v.endDate === undefined) missing('endDate');
  if (v.kind === 'timed') {
    if (v.startTime === undefined) missing('startTime');
    if (v.endTime === undefined) missing('endTime');
  } else {
    if (v.startTime !== undefined) forbidden('startTime');
    if (v.endTime !== undefined) forbidden('endTime');
  }
}

export const createBusyInputSchema = z
  .object({ ...scheduleShape, ...metaShape })
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

/** ตัวควบคุม (Cc) / ตัวคั่นบรรทัด-ย่อหน้า (Zl/Zp) — ตรวจหลังตัด \n และ \t ที่อนุญาตออกแล้ว */
const NOTE_FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/** บันทึกส่วนตัว (เจ้าของเห็นคนเดียว) — NFC, \r\n→\n, ตัดหัวท้าย, ≤ 500 code point, ห้ามตัวควบคุมอื่นนอกจากขึ้นบรรทัด/แท็บ · ว่าง → null */
export function parseBusyNote(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (text === '') return null;
  if (NOTE_FORBIDDEN.test(text.replace(/[\n\t]/g, ''))) throw new AppError('VALIDATION', { fields: { note: 'INVALID' } });
  if ([...text].length > BUSY_NOTE_MAX) throw new AppError('VALIDATION', { fields: { note: 'TOO_LONG' } });
  return text;
}

/**
 * รหัสผิดพลาดของ lib เวลา → AppError (R3_CONTRACT §2 · UX §7.5 "จับคู่ error → ตำแหน่ง")
 * ชื่อฟิลด์ที่ผิดอยู่ใน params.field · SPAN_TOO_LONG/TOO_FAR_BACK → LIMIT_REACHED {limit, max} (status 400: เป็นความผิดของอินพุต ไม่ใช่สถานะของบัญชี)
 */
export function busyInputError(e: BusyInputError, kind: 'all_day' | 'timed'): AppError {
  const field = e.field;
  const params = (extra: Record<string, unknown> = {}) => ({ ...(field ? { field } : {}), ...extra });
  switch (e.code) {
    case 'INVALID_RANGE':
      return new AppError('INVALID_RANGE', params({ kind: kind === 'all_day' ? 'dates' : 'time' }));
    case 'TIME_NOT_ON_STEP':
    case 'INVALID_DATE':
    case 'DATE_OUT_OF_RANGE':
    case 'INVALID_LOCAL_TIME':
      return new AppError(e.code, params());
    case 'INVALID_TZ':
      return new AppError('INVALID_TIMEZONE', params());
    case 'SPAN_TOO_LONG':
      return new AppError('LIMIT_REACHED', params({ limit: 'busySpan', max: kind === 'timed' ? BUSY_MAX_TIMED_DAYS : BUSY_MAX_SPAN_DAYS }), { status: 400 });
    case 'TOO_FAR_BACK':
      return new AppError('LIMIT_REACHED', params({ limit: 'busyBackdate', max: BUSY_MAX_BACKDATE_DAYS }), { status: 400 });
    case 'INVALID_TIME':
    case 'INVALID_FORMAT':
      return new AppError('VALIDATION', { fields: { [field ?? '_']: 'INVALID' } });
  }
}

function scheduleFrom(v: FlatInput, now: number): BusyRow {
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

/** การเขียนไม่ได้แถวทั้งที่ผ่านด่านต่าง ๆ มาแล้ว: เต็มเพดาน → LIMIT_REACHED · อื่น ๆ (บัญชีเปลี่ยนสถานะระหว่างทาง) → CONFLICT */
async function whyRejected(ctx: DataCtx, tx: Parameters<typeof activeBusyCount>[0], userId: string): Promise<AppError> {
  return (await activeBusyCount(tx, userId, ctx.now)) >= BUSY_MAX_PER_USER ? limitCount() : new AppError('CONFLICT');
}

// ───────── U7 ─────────
export async function createBusy(actor: Actor, input: CreateBusyInput, ctx: DataCtx): Promise<{ busy: BusyOwnView }> {
  authorize(actor, 'busy.create', { type: 'none' });
  const me = asUser(actor);
  const { now } = ctx;
  const schedule = scheduleFrom(input, now);
  const write: BusyWrite = {
    ...schedule,
    title: parseBusyTitle(input.title),
    note: parseBusyNote(input.note),
    hideDetail: input.hideDetail ?? false,
  };
  const row = await inTx(ctx.db, async (tx) => {
    const created = await insertBusyIfUnderCap(tx, { ...write, id: newId(), userId: me.id, cap: BUSY_MAX_PER_USER }, now);
    if (!created) throw await whyRejected(ctx, tx, me.id);
    return created;
  });
  return { busy: toBusyOwnView(row) };
}

export async function listMyBusy(actor: Actor, query: ListBusyQuery, ctx: DataCtx): Promise<{ busy: BusyOwnView[] }> {
  authorize(actor, 'busy.list.own', { type: 'none' });
  const me = asUser(actor);
  let rows: OwnBusyRow[];
  if (query.from === undefined && query.to === undefined) {
    rows = await listOwnActiveBusy(ctx.db, me.id, ctx.now, BUSY_MAX_PER_USER + 100);
  } else {
    if (query.from === undefined || query.to === undefined) {
      throw new AppError('VALIDATION', { fields: { [query.from === undefined ? 'from' : 'to']: 'REQUIRED' } });
    }
    const range = parseDateRange(query.from, query.to);
    rows = await listOwnBusyInRange(ctx.db, me.id, range.from, range.to, 1000);
  }
  return { busy: rows.map(toBusyOwnView) };
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
  };
  const row = await inTx(ctx.db, async (tx) => {
    const updated = await updateOwnBusyIfUnderCap(tx, id, me.id, next, BUSY_MAX_PER_USER, now);
    if (updated) return updated;
    if (!(await findOwnBusy(tx, id, me.id))) throw new AppError('NOT_FOUND'); // ถูกลบระหว่างทาง
    throw await whyRejected(ctx, tx, me.id);
  });
  return { busy: toBusyOwnView(row) };
}

export async function deleteBusy(actor: Actor, id: string, ctx: DataCtx): Promise<{ deleted: true }> {
  authorize(actor, 'busy.delete', ownerRes(actor.kind === 'user' ? actor.id : ''));
  const me = asUser(actor);
  const ok = await inTx(ctx.db, (tx) => deleteOwnBusy(tx, id, me.id));
  if (!ok) throw new AppError('NOT_FOUND');
  return { deleted: true };
}
