// service: วันว่างร่วมของกลุ่ม — U9, U9.1 · ADR 0005 §1–3 · ADR 0006 §1, §3 · action `group.availability.view`
//  - โหลด GroupCtx (1 query) → authorize บรรทัดแรก · ไม่ใช่สมาชิก/กลุ่มไม่มี/ลบแล้ว (รวม super admin) → NOT_FOUND เหมือนกันหมด
//  - ตรวจช่วงวันที่หลังผ่านด่านกลุ่ม (parseDateRange ตัวเดียวกับปฏิทิน: ≤ 62 วัน · VALIDATION fields.from/to)
//  - สมาชิกที่นับ = สมาชิกปัจจุบันของกลุ่ม ณ ตอนเรียก (ไม่ cache) · super admin ที่ไม่ใช่สมาชิกไม่ถูกนับ แต่ audit การอ่าน
//  - busy: คิวรีฝั่งแชร์ตัวเดียวกับปฏิทิน (ไม่ SELECT note · title ซ่อนตัดใน SQL) · blockers ผ่าน serializer เดียว (toBlockerView → toBusyForViewers)
import { z } from 'zod';
import {
  commonFreeTime,
  dayWindow,
  overlapsRange,
  type DateISO,
  type FreeSegment,
  type FreeTimeBusyInput,
} from '@/lib/calendar';
import { findGroupById } from '@/lib/data/repos/group';
import { listMembers } from '@/lib/data/repos/group-member';
import { listSharedBusyInGroup, type SharedBusyRow } from '@/lib/data/repos/busy';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { CALENDAR_MAX_ITEMS } from '@/lib/shared/limits';
import { memberColorIndex } from '@/lib/shared/member-color';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { DataCtx } from '../context';
import { loadGroupCtx } from '../policy-context';
import { toBlockerView, type BlockerView } from '../serializers/busy';
import { asUser, auditRead } from './group-common';
import { parseDateRange } from './calendar';

export const availabilityParamsSchema = z.object({ gid: z.uuid() });
/** รูปร่างเท่านั้น — ความหมายของวันที่ตรวจหลังด่านสิทธิ์ (เหมือนปฏิทิน) */
export const availabilityQuerySchema = z.object({ from: z.string().max(32).optional(), to: z.string().max(32).optional() }).strict();
export type AvailabilityQuery = z.output<typeof availabilityQuerySchema>;

const HOUR_MS = 3_600_000;
/**
 * ขอบขยายของช่วงดึง busy (ADR 0005 §3 เสนอ ±14 ชม.) — ใช้ 26 ชม. เพราะ busy ทั้งวันเก็บ start_at/end_at เป็นเที่ยงคืนใน tz *ของเจ้าของ*
 * ซึ่งต่างจาก tz กลุ่มได้สูงสุด 26 ชม. (UTC+14 ↔ UTC−12) · แถวที่ดึงเกินไม่มีผล (lib ตัดสินด้วยวันที่ลอย/instant) จึงขยายได้ปลอดภัย
 */
export const AVAILABILITY_FETCH_MARGIN_MS = 26 * HOUR_MS;

export type AvailabilityMemberDto = { userId: string; displayName: string; colorIndex: number };

export type AvailabilityDayDto = {
  date: DateISO;
  /** = totalMembers − notFreeUserIds.length */
  freeMembers: number;
  totalMembers: number;
  /** ว่างร่วม ⇔ segments.length > 0 (T24: freeMembers = total แต่ allFree = false ได้) */
  allFree: boolean;
  /** สมาชิกที่ไม่ว่างตามกฎ ADR 0005 §1 (ติดทั้งวัน หรือเหลือว่างไม่ถึงขั้นต่ำ) — ลำดับเดียวกับ members */
  notFreeUserIds: string[];
  segments: FreeSegment[];
  /** ทุกสมาชิกที่มี busy ตัดกับหน้าต่างของวันนั้น (ไม่เฉพาะคนที่นับว่าไม่ว่าง) · รายการเต็ม ไม่ clip (UI คำนวณ "ต่อจากเมื่อวาน") */
  blockers: BlockerView[];
};

export type GroupAvailabilityDto = {
  group: { id: string; tz: string; windowStartMin: number; windowEndMin: number; minFreeMinutes: number };
  from: DateISO;
  to: DateISO;
  /** ผู้ดู (ถ้าเป็นสมาชิก) ก่อน แล้วตามช่องสี — ตรงกับ /calendar */
  members: AvailabilityMemberDto[];
  days: AvailabilityDayDto[];
  /** true = busy เกิน CALENDAR_MAX_ITEMS ในช่วงนี้ → คำนวณจากส่วนแรก (ผลอาจดู "ว่าง" เกินจริง) */
  truncated: boolean;
};

type WindowCfg = { tz: string; freeWindowStartMin: number; freeWindowEndMin: number };

/** ช่วง instant [fromMs, toMs) ที่ต้องดึง busy: หน้าต่างของวันแรก − margin … หน้าต่างของวันสุดท้าย + margin */
export function availabilityFetchRange(range: { from: DateISO; to: DateISO }, g: WindowCfg): { fromMs: number; toMs: number } {
  const [first] = dayWindow(range.from, g.freeWindowStartMin, g.freeWindowEndMin, g.tz);
  const [, last] = dayWindow(range.to, g.freeWindowStartMin, g.freeWindowEndMin, g.tz);
  return { fromMs: first - AVAILABILITY_FETCH_MARGIN_MS, toMs: last + AVAILABILITY_FETCH_MARGIN_MS };
}

export async function getGroupAvailability(actor: Actor, groupId: string, query: AvailabilityQuery, ctx: DataCtx): Promise<GroupAvailabilityDto> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.availability.view', { type: 'group', group });
  const me = asUser(actor);
  for (const f of ['from', 'to'] as const) if (query[f] === undefined) throw new AppError('VALIDATION', { fields: { [f]: 'REQUIRED' } });
  const range = parseDateRange(query.from!, query.to!);
  const row = await findGroupById(ctx.db, groupId);
  if (!row || row.deletedAt !== null) throw new AppError('NOT_FOUND');

  const memberRows = await listMembers(ctx.db, groupId);
  const members: AvailabilityMemberDto[] = memberRows.map((m) => ({
    userId: m.userId,
    displayName: sanitizeDisplayText(m.displayName),
    colorIndex: memberColorIndex(groupId, m.userId),
  }));
  members.sort(
    (a, b) =>
      Number(b.userId === me.id) - Number(a.userId === me.id) ||
      a.colorIndex - b.colorIndex ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  const memberIds = members.map((m) => m.userId);

  const { fromMs, toMs } = availabilityFetchRange(range, row);
  const { rows, truncated } = await listSharedBusyInGroup(ctx.db, groupId, fromMs, toMs, CALENDAR_MAX_ITEMS);
  await auditRead(ctx.db, me, allow, { action: 'group.availability.view', targetType: 'group', targetId: groupId, groupId, meta: { from: range.from, to: range.to } }, ctx.now);

  const win = { tz: row.tz, winStartMin: row.freeWindowStartMin, winEndMin: row.freeWindowEndMin, minFreeMin: row.minFreeMinutes };
  const inputs: FreeTimeBusyInput[] = rows; // SharedBusyRow ⊇ BusyInput (ไม่มี note)
  const free = commonFreeTime(win, memberIds, inputs, range.from, range.to);

  // blockers = ทุกสมาชิกที่มี busy ตัดกับหน้าต่างของวัน (all-day ครอบวันนั้น หรือ timed ทับหน้าต่าง) — lib ให้เฉพาะคนที่นับว่าไม่ว่าง
  const timedBy = new Map<string, SharedBusyRow[]>();
  const allDayBy = new Map<string, SharedBusyRow[]>();
  for (const id of memberIds) {
    timedBy.set(id, []);
    allDayBy.set(id, []);
  }
  for (const r of rows) {
    if (r.allDay) allDayBy.get(r.userId)?.push(r);
    else if (r.endAt > r.startAt) timedBy.get(r.userId)?.push(r);
  }

  const days: AvailabilityDayDto[] = free.map((d) => {
    const [w0, w1] = dayWindow(d.date, row.freeWindowStartMin, row.freeWindowEndMin, row.tz);
    const freeSet = new Set(d.freeMemberIds);
    const blockers: BlockerView[] = [];
    for (const id of memberIds) {
      const touching = [
        ...allDayBy.get(id)!.filter((b) => b.localStartDate <= d.date && d.date <= b.localEndDate),
        ...timedBy.get(id)!.filter((b) => overlapsRange(b.startAt, b.endAt, w0, w1)),
      ];
      if (touching.length > 0) blockers.push(toBlockerView(id, touching));
    }
    return {
      date: d.date,
      freeMembers: d.freeMembers,
      totalMembers: d.totalMembers,
      allFree: d.allFree,
      notFreeUserIds: memberIds.filter((id) => !freeSet.has(id)),
      segments: d.segments,
      blockers,
    };
  });

  return {
    group: { id: row.id, tz: row.tz, windowStartMin: row.freeWindowStartMin, windowEndMin: row.freeWindowEndMin, minFreeMinutes: row.minFreeMinutes },
    from: range.from,
    to: range.to,
    members,
    days,
    truncated,
  };
}
