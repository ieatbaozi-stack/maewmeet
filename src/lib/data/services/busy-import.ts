// service: นำเข้าไฟล์ .ics เป็นเวลาไม่ว่างของฉัน — ICS_IMPORT_CONTRACT A2–A5 · ADR 0017
//  - authorize(actor, 'busy.create', { type: 'none' }) บรรทัดแรกทุกฟังก์ชัน (ด่านบัญชี: anonymous / suspended / must_change_pin)
//  - ผูก user_id = asUser(actor).id เสมอ (SA นำเข้าแทนคนอื่นไม่ได้)
//  - ห้าม log icsText หรือ SUMMARY ในทุกกรณี
import { z } from 'zod';
import {
  busyDedupeKey,
  DEFAULT_TZ,
  ICS_IMPORT_DEFAULT_WINDOW_DAYS,
  ICS_IMPORT_MAX_BYTES,
  ICS_IMPORT_MAX_EVENTS,
  ICS_IMPORT_MAX_LINES,
  normalizeBusyInput,
  parseIcsToBusy,
  type BusyInput,
  type IcsImportWindowDays,
  type IcsSkipCounts,
} from '@/lib/calendar';
import { BUSY_IMPORT_RATE_LIMITS, rateKey } from '@/lib/auth/throttle';
import {
  activeBusyCount,
  insertBusyBatchIfUnderCap,
  listOwnBusyForDedupe,
  type BusyImportRow,
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
  BUSY_TITLE_MAX,
  ICS_IMPORT_MAX_BATCH,
} from '@/lib/shared/limits';
import type { DataCtx } from '../context';
import { takeSlots } from '../rate-slots';
import { toBusyOwnView, type BusyOwnView } from '../serializers/busy';
import { inTx } from '../tx';
import { busyInputError, parseBusyTitle } from './busy';
import { asUser } from './group-common';

// ───────── input schemas (strict กัน mass assignment) ─────────
const windowDaysSchema = z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)]);

export const previewBusyImportSchema = z
  .object({
    icsText: z.string().min(1),
    windowDays: windowDaysSchema.optional(),
  })
  .strict();
export type PreviewBusyImportInput = z.output<typeof previewBusyImportSchema>;

const importItemSchema = z
  .object({
    kind: z.enum(['all_day', 'timed']),
    startDate: z.string().max(32),
    endDate: z.string().max(32),
    startTime: z.string().max(16).optional(),
    endTime: z.string().max(16).optional(),
    tz: z.string().max(64).optional(),
    title: z.string().max(BUSY_TITLE_MAX * 8).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'timed') {
      if (v.startTime === undefined) ctx.addIssue({ code: 'invalid_type', expected: 'string', input: undefined, path: ['startTime'] });
      if (v.endTime === undefined) ctx.addIssue({ code: 'invalid_type', expected: 'string', input: undefined, path: ['endTime'] });
    } else {
      if (v.startTime !== undefined) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'NOT_ALLOWED' });
      if (v.endTime !== undefined) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'NOT_ALLOWED' });
    }
  });

export const confirmBusyImportSchema = z
  .object({
    items: z.array(importItemSchema).min(1).max(ICS_IMPORT_MAX_BATCH),
    hideDetail: z.boolean().optional(),
    skipDuplicates: z.boolean().optional(),
  })
  .strict();
export type ConfirmBusyImportInput = z.output<typeof confirmBusyImportSchema>;

// ───────── response DTOs ─────────
export type IcsPreviewItemDto = {
  readonly kind: 'all_day' | 'timed';
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly tz: string;
  readonly title: string | null;
  readonly rounded: boolean;
  readonly duplicate: boolean;
};

export type PreviewBusyImportResult = {
  readonly windowDays: IcsImportWindowDays;
  readonly totalEvents: number;
  readonly skipped: IcsSkipCounts;
  readonly quota: {
    readonly used: number;
    readonly max: number;
    readonly remaining: number;
  };
  readonly maxImportPerBatch: number;
  readonly items: readonly IcsPreviewItemDto[];
};

export type ConfirmBusyImportResult = {
  readonly created: number;
  readonly skippedDuplicates: number;
  readonly items: readonly BusyOwnView[];
};

/**
 * ขั้น 1: วิเคราะห์ไฟล์ `.ics` + เทียบซ้ำกับ busy_block เดิมของเจ้าตัว + คืนโควตาคงเหลือ
 * ไม่เขียนลง DB · นับ rate limit preview (20/10 นาที/ผู้ใช้)
 */
export async function previewBusyImport(
  actor: Actor,
  input: PreviewBusyImportInput,
  ctx: DataCtx,
): Promise<PreviewBusyImportResult> {
  authorize(actor, 'busy.create', { type: 'none' });
  const me = asUser(actor);
  const { now } = ctx;

  // จอง rate limit ก่อน parse เพื่อกัน CPU spam ด้วยไฟล์ขนาดใหญ่
  await takeSlots(
    ctx.db,
    [{ spec: BUSY_IMPORT_RATE_LIMITS.preview, key: rateKey(BUSY_IMPORT_RATE_LIMITS.preview, me.id) }],
    now,
  );

  // ตรวจขนาด UTF-8 byte จริงก่อน parse (512 KB)
  if (Buffer.byteLength(input.icsText, 'utf8') > ICS_IMPORT_MAX_BYTES) {
    throw new AppError('ICS_TOO_LARGE', { limit: 'bytes', max: ICS_IMPORT_MAX_BYTES });
  }

  const windowDays: IcsImportWindowDays = input.windowDays ?? ICS_IMPORT_DEFAULT_WINDOW_DAYS;
  const parsed = parseIcsToBusy(input.icsText, {
    nowMs: now,
    defaultTz: DEFAULT_TZ,
    windowDays,
    maxBytes: ICS_IMPORT_MAX_BYTES,
    maxLines: ICS_IMPORT_MAX_LINES,
    maxEvents: ICS_IMPORT_MAX_EVENTS,
    maxBackdateDays: BUSY_MAX_BACKDATE_DAYS,
    maxSpanDays: BUSY_MAX_SPAN_DAYS,
    maxTimedDays: BUSY_MAX_TIMED_DAYS,
    titleMax: BUSY_TITLE_MAX,
  });

  if (!parsed.ok) {
    if (parsed.error === 'TOO_LARGE') {
      throw new AppError('ICS_TOO_LARGE', { limit: parsed.limit, max: parsed.max });
    }
    throw new AppError('ICS_INVALID');
  }

  const used = await activeBusyCount(ctx.db, me.id, now);
  const remaining = Math.max(0, BUSY_MAX_PER_USER - used);

  const existingKeys = new Set<string>();
  if (parsed.items.length > 0) {
    let minDate = parsed.items[0]!.row.localStartDate;
    let maxDate = parsed.items[0]!.row.localEndDate;
    for (const item of parsed.items) {
      if (item.row.localStartDate < minDate) minDate = item.row.localStartDate;
      if (item.row.localEndDate > maxDate) maxDate = item.row.localEndDate;
    }
    const existing = await listOwnBusyForDedupe(ctx.db, me.id, minDate, maxDate);
    for (const r of existing) existingKeys.add(busyDedupeKey(r));
  }

  const seenInFile = new Set<string>();
  const items: IcsPreviewItemDto[] = parsed.items.map((item) => {
    const key = busyDedupeKey(item.row);
    const duplicate = existingKeys.has(key) || seenInFile.has(key);
    seenInFile.add(key);
    // ยืนยันชื่อผ่าน parseBusyTitle อีกชั้น (กันกรณีหลุด)
    let safeTitle: string | null = null;
    if (item.title !== null) {
      try {
        safeTitle = parseBusyTitle(item.title);
      } catch {
        safeTitle = null;
      }
    }
    return {
      kind: item.kind,
      startDate: item.startDate,
      endDate: item.endDate,
      ...(item.startTime !== undefined ? { startTime: item.startTime } : {}),
      ...(item.endTime !== undefined ? { endTime: item.endTime } : {}),
      tz: item.tz,
      title: safeTitle,
      rounded: item.rounded,
      duplicate,
    };
  });

  return {
    windowDays,
    totalEvents: parsed.totalEvents,
    skipped: parsed.skipped,
    quota: { used, max: BUSY_MAX_PER_USER, remaining },
    maxImportPerBatch: ICS_IMPORT_MAX_BATCH,
    items,
  };
}

/**
 * ขั้น 2: บันทึกรายการที่ผู้ใช้ยืนยันแบบ atomic all-or-nothing (เพดาน 300 ในคำสั่ง SQL เดียว)
 * ดีฟอลต์ hideDetail = true (B3) · skipDuplicates = true (B4) · note = null เสมอ
 */
export async function confirmBusyImport(
  actor: Actor,
  input: ConfirmBusyImportInput,
  ctx: DataCtx,
): Promise<ConfirmBusyImportResult> {
  authorize(actor, 'busy.create', { type: 'none' });
  const me = asUser(actor);
  const { now } = ctx;

  // จอง rate limit confirm (10/10 นาที/ผู้ใช้)
  await takeSlots(
    ctx.db,
    [{ spec: BUSY_IMPORT_RATE_LIMITS.confirm, key: rateKey(BUSY_IMPORT_RATE_LIMITS.confirm, me.id) }],
    now,
  );

  // ดีฟอลต์ซ่อนรายละเอียดจากคนในกลุ่ม (B3 = (ก))
  const hideDetail = input.hideDetail ?? true;
  const skipDuplicates = input.skipDuplicates ?? true;

  // ตรวจและ normalize ทุกรายการใหม่ฝั่งเซิร์ฟเวอร์ (ไม่ไว้ใจ payload จาก client)
  const normalized: BusyImportRow[] = [];
  const seenKeys = new Set<string>();
  let intraDuplicates = 0;

  for (const item of input.items) {
    const tz = item.tz ?? DEFAULT_TZ;
    const busyInput: BusyInput =
      item.kind === 'timed'
        ? {
            kind: 'timed',
            startDate: item.startDate,
            startTime: item.startTime!,
            endDate: item.endDate,
            endTime: item.endTime!,
            tz,
          }
        : {
            kind: 'all_day',
            startDate: item.startDate,
            endDate: item.endDate,
            tz,
          };
    const r = normalizeBusyInput(busyInput, {
      now,
      maxSpanDays: BUSY_MAX_SPAN_DAYS,
      maxBackdateDays: BUSY_MAX_BACKDATE_DAYS,
      maxTimedDays: BUSY_MAX_TIMED_DAYS,
    });
    if (!r.ok) throw busyInputError(r.error, item.kind);
    const title = parseBusyTitle(item.title);
    const key = busyDedupeKey(r.value);
    if (skipDuplicates && seenKeys.has(key)) {
      intraDuplicates++;
      continue;
    }
    seenKeys.add(key);
    normalized.push({
      id: newId(),
      title,
      allDay: r.value.allDay,
      startAt: r.value.startAt,
      endAt: r.value.endAt,
      localStartDate: r.value.localStartDate,
      localEndDate: r.value.localEndDate,
      tz: r.value.tz,
    });
  }

  const out = await inTx(ctx.db, async (tx) => {
    const res = await insertBusyBatchIfUnderCap(
      tx,
      { userId: me.id, cap: BUSY_MAX_PER_USER, hideDetail, skipDuplicates, rows: normalized },
      now,
    );
    if (!res.ok) {
      const current = await activeBusyCount(tx, me.id, now);
      if (current + res.pendingCount > BUSY_MAX_PER_USER) {
        throw new AppError('LIMIT_REACHED', { limit: 'busyCount', max: BUSY_MAX_PER_USER });
      }
      throw new AppError('CONFLICT');
    }
    return res;
  });

  return {
    created: out.rows.length,
    skippedDuplicates: intraDuplicates + out.skippedDuplicates,
    items: out.rows.map(toBusyOwnView),
  };
}
