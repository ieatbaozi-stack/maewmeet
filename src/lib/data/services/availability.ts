// service: วันว่างร่วมของกลุ่ม — U9, U9.1 · ADR 0005 §1–3 · ADR 0006 §1, §3 · action `group.availability.view`
//  - โหลด GroupCtx (1 query) → authorize บรรทัดแรก · ไม่ใช่สมาชิก/กลุ่มไม่มี/ลบแล้ว (รวม super admin) → NOT_FOUND เหมือนกันหมด
//  - ตรวจช่วงวันที่หลังผ่านด่านกลุ่ม (parseDateRange ตัวเดียวกับปฏิทิน: ≤ 62 วัน · VALIDATION fields.from/to)
//  - สมาชิกที่นับ = สมาชิกปัจจุบันของกลุ่ม ณ ตอนเรียก (ไม่ cache) · super admin ที่ไม่ใช่สมาชิกไม่ถูกนับ แต่ audit การอ่าน
//  - busy: คิวรีฝั่งแชร์ตัวเดียวกับปฏิทิน (ไม่ SELECT note · title ซ่อนตัดใน SQL) · busy ส่งครั้งเดียวที่ระดับบนผ่าน serializer เดียว (toBusyForViewers) · days[].blockers อ้างด้วย id (M1/M3 R4A)
//  - R6D (ADR 0009): busy รวมนัดที่สมาชิกตอบ "ไป" จากทุกกลุ่ม (loadMemberBusy) · นัดกลุ่มอื่น = ช่วงเวลาเท่านั้น
//  - รูปร่าง: busy[] ครั้งเดียว (เรียง startAt,endAt,kind,id) · days[].blockers = [{userId, itemIdx}] ดัชนีเข้า busy[]
import { z } from 'zod';
import {
  commonFreeTime,
  dayWindow,
  overlapsRange,
  type DateISO,
  type FreeSegment,
} from '@/lib/calendar';
import type { GroupRow } from '@/lib/data/repos/group';
import { listMembers } from '@/lib/data/repos/group-member';
import { authorize } from '@/lib/rbac/can';
import type { Actor, Allow, UserActor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { memberAppearance } from '@/lib/shared/member-color';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { DataCtx } from '../context';
import { groupRowOf, loadGroupCtx } from '../policy-context';
import type { AvailabilityBusyView, BlockerRef } from '../serializers/busy';
import { loadMemberBusy, type MemberBusyItem } from './member-busy';
import { asUser, auditRead } from './group-common';
import { parseDateRange, type CalendarGroupInfo } from './calendar';

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

export type AvailabilityMemberDto = { userId: string; displayName: string; colorIndex: number; shapeIndex: number };

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
  /**
   * ทุกสมาชิกที่มี busy ตัดกับหน้าต่างของวันนั้น (ไม่เฉพาะคนที่นับว่าไม่ว่าง) · เรียงตาม members · itemIdx = ดัชนีใน `busy[]` ระดับบน เรียงน้อย→มาก (= startAt,id)
   * (รายการเต็ม ไม่ clip — UI คำนวณ "ต่อจากเมื่อวาน")
   */
  blockers: BlockerRef[];
};

export type GroupAvailabilityDto = {
  group: { id: string; tz: string; windowStartMin: number; windowEndMin: number; minFreeMinutes: number };
  from: DateISO;
  to: DateISO;
  /** ผู้ดู (ถ้าเป็นสมาชิก) ก่อน แล้วตามช่องสี — ตรงกับ /calendar */
  members: AvailabilityMemberDto[];
  days: AvailabilityDayDto[];
  /**
   * busy ที่ถูกอ้างโดย days[].blockers อย่างน้อยหนึ่งวัน — ส่งครั้งเดียว ผ่าน serializer busy (ซ่อน → ไม่มี title · ไม่มี note)
   * มี kind: busy | appointment | other_group_appointment (ADR 0009 §2) · เรียง startAt, endAt, kind, id
   */
  busy: AvailabilityBusyView[];
  /** true = busy หรือ going เกิน CALENDAR_MAX_ITEMS ในช่วงนี้ → คำนวณจากส่วนแรก (ผลอาจดู "ว่าง" เกินจริง) */
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
  return availabilityFor(ctx, asUser(actor), allow, groupRowOf(group), query);
}

/** ด่านกลุ่มผ่านแล้ว 1 ครั้ง · `load(query)` = ผลเดียวกับ getGroupAvailability(…, query) ทุกไบต์ (ตรวจช่วงวันที่ + audit SA ทุกครั้งที่เรียก) */
export type GroupAvailabilityHandle = { group: CalendarGroupInfo; load: (query: AvailabilityQuery) => Promise<GroupAvailabilityDto> };

/**
 * R7 B-2: เปิด "ว่างตรงกัน" ของกลุ่มสำหรับ loader ของหน้า (แทน getGroup → getGroupAvailability ที่อ่านด่านกลุ่ม/แถวกลุ่มซ้ำ)
 * loadGroupCtx + authorize('group.availability.view') ครั้งเดียว (1 query) → คืน tz/role ทันที แล้ว `load(range)` อ่านสมาชิก ∥ busy
 * ไม่ใช่สมาชิก/กลุ่มไม่มี/ลบแล้ว → NOT_FOUND ตอนเปิด · handle ผูกกับ request เดียว — ห้ามเก็บข้าม request
 */
export async function openGroupAvailability(actor: Actor, groupId: string, ctx: DataCtx): Promise<GroupAvailabilityHandle> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.availability.view', { type: 'group', group });
  const me = asUser(actor);
  const row = groupRowOf(group);
  return { group: { id: row.id, tz: row.tz, myRole: group.actorRole }, load: (query) => availabilityFor(ctx, me, allow, row, query) };
}

/**
 * ส่วนหลังด่านสิทธิ์ (R7 B-3) — เรียกได้จาก getGroupAvailability/openGroupAvailability เท่านั้น (ไม่ export: ต้องมี `allow` จาก authorize('group.availability.view'))
 * row = แถวกลุ่มจาก loadGroupCtx (ไม่อ่านกลุ่มซ้ำ) · ตรวจช่วงวันที่หลังด่าน · สมาชิก ∥ busy (อิสระกันหลังผ่านด่าน)
 */
async function availabilityFor(ctx: DataCtx, me: UserActor, allow: Allow, row: GroupRow, query: AvailabilityQuery): Promise<GroupAvailabilityDto> {
  for (const f of ['from', 'to'] as const) if (query[f] === undefined) throw new AppError('VALIDATION', { fields: { [f]: 'REQUIRED' } });
  const range = parseDateRange(query.from!, query.to!);
  const groupId = row.id;
  const { fromMs, toMs } = availabilityFetchRange(range, row);
  const [memberRows, { items, truncated }] = await Promise.all([listMembers(ctx.db, groupId), loadMemberBusy(ctx.db, groupId, row.tz, fromMs, toMs)]);
  const members: AvailabilityMemberDto[] = memberRows.map((m) => ({
    userId: m.userId,
    displayName: sanitizeDisplayText(m.displayName),
    ...memberAppearance(groupId, m.userId, m),
  }));
  members.sort(
    (a, b) =>
      Number(b.userId === me.id) - Number(a.userId === me.id) ||
      a.colorIndex - b.colorIndex ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  const memberIds = members.map((m) => m.userId);
  await auditRead(ctx.db, me, allow, { action: 'group.availability.view', targetType: 'group', targetId: groupId, groupId, meta: { from: range.from, to: range.to } }, ctx.now);

  const win = { tz: row.tz, winStartMin: row.freeWindowStartMin, winEndMin: row.freeWindowEndMin, minFreeMin: row.minFreeMinutes };
  // busy_block (SharedBusyRow ⊇ BusyInput ไม่มี note) + going เป็น timed ที่คีย์ภายใน g:* (ADR 0009 §2)
  const free = commonFreeTime(win, memberIds, items.map((i) => i.input), range.from, range.to);

  // blockers = ทุกสมาชิกที่มี busy ตัดกับหน้าต่างของวัน (all-day ครอบวันนั้น หรือ timed ทับหน้าต่าง) — lib ให้เฉพาะคนที่นับว่าไม่ว่าง
  const sortedRows = items.filter((r) => r.input.allDay || r.input.endAt > r.input.startAt); // loadMemberBusy เรียงแล้ว (compareBusyViews)
  const indexOf = new Map<string, number>(sortedRows.map((r, i) => [r.key, i])); // ดัชนีชั่วคราวในแถวที่เรียงแล้ว (ก่อนบีบเหลือเฉพาะที่ถูกอ้าง)
  const byMember = new Map<string, MemberBusyItem[]>(memberIds.map((id) => [id, []]));
  for (const r of sortedRows) byMember.get(r.input.userId)?.push(r);
  const referenced = new Set<number>();

  const raw = free.map((d) => {
    const [w0, w1] = dayWindow(d.date, row.freeWindowStartMin, row.freeWindowEndMin, row.tz);
    const blockers: { userId: string; idx: number[] }[] = [];
    for (const id of memberIds) {
      const idx = byMember
        .get(id)!
        .map((b) => b.input)
        .filter((b) => (b.allDay ? b.localStartDate <= d.date && d.date <= b.localEndDate : overlapsRange(b.startAt, b.endAt, w0, w1)))
        .map((b) => indexOf.get(b.id)!);
      if (idx.length === 0) continue;
      for (const i of idx) referenced.add(i);
      blockers.push({ userId: id, idx });
    }
    return { d, blockers };
  });

  // บีบดัชนี: เก็บเฉพาะแถวที่ถูกอ้าง (คงลำดับ startAt,id) แล้วแปลงดัชนี
  const busy: AvailabilityBusyView[] = [];
  const remap = new Map<number, number>();
  sortedRows.forEach((r, i) => {
    if (!referenced.has(i)) return;
    remap.set(i, busy.length);
    busy.push(r.view);
  });

  const days: AvailabilityDayDto[] = raw.map(({ d, blockers }) => {
    const freeSet = new Set(d.freeMemberIds);
    return {
      date: d.date,
      freeMembers: d.freeMembers,
      totalMembers: d.totalMembers,
      allFree: d.allFree,
      notFreeUserIds: memberIds.filter((id) => !freeSet.has(id)),
      segments: d.segments,
      blockers: blockers.map((b) => ({ userId: b.userId, itemIdx: b.idx.map((i) => remap.get(i)!) })),
    };
  });

  return {
    group: { id: row.id, tz: row.tz, windowStartMin: row.freeWindowStartMin, windowEndMin: row.freeWindowEndMin, minFreeMinutes: row.minFreeMinutes },
    from: range.from,
    to: range.to,
    members,
    days,
    busy,
    truncated,
  };
}
