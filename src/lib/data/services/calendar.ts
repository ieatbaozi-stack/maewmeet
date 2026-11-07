// service: ปฏิทินกลุ่ม — U8 · ADR 0006 §1, §3 · action `group.calendar.view`
//  - โหลด GroupCtx (1 query) → authorize บรรทัดแรกของส่วนที่แตะข้อมูล · ไม่ใช่สมาชิก/กลุ่มไม่มี/ลบแล้ว → NOT_FOUND (404) เหมือนกันหมด
//  - ตรวจช่วงวันที่ *หลัง* ผ่านด่านกลุ่ม (คนนอกได้ 404 แม้ส่งช่วงผิด — ไม่เป็น oracle ว่ากลุ่มมีจริง)
//  - busy ของสมาชิกปัจจุบันของกลุ่มนี้เท่านั้น (JOIN group_member ของ gid นี้) ผ่าน serializer เดียว — ไม่มีมุมมองเจ้าของ แม้เป็นรายการของผู้ดูเอง
//  - R6D (ADR 0009): รวมนัดที่สมาชิกตอบ "ไป" จากทุกกลุ่ม (loadMemberBusy) · นัดกลุ่มอื่น = ช่วงเวลาเท่านั้น
//  - super admin ที่ไม่ใช่สมาชิก → audit `group.calendar.view` (ตามกติกาอ่านของ R2: auditRead)
import { z } from 'zod';
import { addDays, compareDates, isValidDate, spanDays, startOfDay } from '@/lib/calendar';
import type { GroupRole, GroupRow } from '@/lib/data/repos/group';
import { listMembers } from '@/lib/data/repos/group-member';
import { loadMemberBusy } from './member-busy';
import { authorize } from '@/lib/rbac/can';
import type { Actor, Allow, UserActor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { CALENDAR_MAX_RANGE_DAYS } from '@/lib/shared/limits';
import { memberAppearance } from '@/lib/shared/member-color';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { DataCtx } from '../context';
import { groupRowOf, loadGroupCtx } from '../policy-context';
import type { MemberBusyView } from '../serializers/busy';
import { asUser, auditRead } from './group-common';

export const calendarParamsSchema = z.object({ gid: z.uuid() });
/** รูปร่างเท่านั้น — การมีอยู่/ความหมายของวันที่/ช่วงตรวจใน service หลังด่านสิทธิ์ (parseDateRange) · ไม่ให้ anonymous/คนนอกได้ 400 ก่อน 401/404 */
export const calendarQuerySchema = z.object({ from: z.string().max(32).optional(), to: z.string().max(32).optional() }).strict();
export type CalendarQuery = z.output<typeof calendarQuerySchema>;

/**
 * ช่วงวันที่ท้องถิ่น [from, to] รวมปลาย: รูปแบบ YYYY-MM-DD ที่มีจริง ปี 2000–2100 · from ≤ to · ยาวไม่เกิน CALENDAR_MAX_RANGE_DAYS
 * ผิด → VALIDATION { fields: { from|to: reason } } (ไม่สะท้อนค่าที่ส่งมา)
 */
export function parseDateRange(from: string, to: string): { from: string; to: string } {
  const check = (field: 'from' | 'to', value: string): string => {
    if (!isValidDate(value)) throw new AppError('VALIDATION', { fields: { [field]: 'INVALID' } });
    return value;
  };
  const f = check('from', from);
  const t = check('to', to);
  if (compareDates(f, t) > 0) throw new AppError('VALIDATION', { fields: { to: 'BEFORE_FROM' } });
  if (spanDays(f, t) > CALENDAR_MAX_RANGE_DAYS) throw new AppError('VALIDATION', { fields: { to: 'RANGE_TOO_LARGE' } });
  return { from: f, to: t };
}

export type CalendarMemberDto = {
  userId: string;
  displayName: string;
  /** 0–9 · slot ที่สมาชิกเลือก (R6C) ?? hash คงที่ต่อ (ผู้ใช้, กลุ่ม) */
  colorIndex: number;
  /** 0–9 · รูปทรง (R6C) — ไม่ตั้ง = เท่ากับ hash ของสี */
  shapeIndex: number;
};

export type GroupCalendarDto = {
  group: { id: string; tz: string };
  from: string;
  to: string;
  /** ผู้ดู (ถ้าเป็นสมาชิก) ก่อน แล้วตามช่องสี */
  members: CalendarMemberDto[];
  /**
   * เรียง startAt, endAt, kind, id (ADR 0009 §2) · ทุกชิ้นผ่าน serializer busy:
   * kind "busy" (busy_block) · "appointment" (นัดที่ตอบไปในกลุ่มนี้ — มี appointmentId/title) · "other_group_appointment" (นัดกลุ่มอื่น — ช่วงเวลาเท่านั้น)
   */
  busy: MemberBusyView[];
  /** true = busy หรือ going มีแถวเกิน CALENDAR_MAX_ITEMS ในช่วงนี้ → ส่งมาเฉพาะส่วนแรก (เรียงตามเวลาเริ่ม) · UI ควรแจ้งผู้ใช้ */
  truncated: boolean;
};

export async function getGroupCalendar(actor: Actor, groupId: string, query: CalendarQuery, ctx: DataCtx): Promise<GroupCalendarDto> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.calendar.view', { type: 'group', group });
  return calendarFor(ctx, asUser(actor), allow, groupRowOf(group), query);
}

/** ข้อมูลกลุ่มที่หน้า /calendar ต้องใช้ก่อนรู้ช่วงวันที่ (tz → วันนี้/เดือน · role → ลิงก์ "ปรับช่วงเวลา") — R7 B-2 */
export type CalendarGroupInfo = { id: string; tz: string; myRole: GroupRole | null };

/** ด่านกลุ่มผ่านแล้ว 1 ครั้ง · `load(query)` = ผลเดียวกับ getGroupCalendar(…, query) ทุกไบต์ (ตรวจช่วงวันที่ + audit SA ทุกครั้งที่เรียก) */
export type GroupCalendarHandle = { group: CalendarGroupInfo; load: (query: CalendarQuery) => Promise<GroupCalendarDto> };

/**
 * R7 B-2: เปิดปฏิทินกลุ่มสำหรับ loader ของหน้า (แทน getGroup → getGroupCalendar ที่อ่านด่านกลุ่ม/แถวกลุ่มซ้ำ)
 * loadGroupCtx + authorize('group.calendar.view') ครั้งเดียว (1 query) → คืน tz/role ทันที แล้ว `load(range)` อ่านสมาชิก ∥ busy
 * ไม่ใช่สมาชิก/กลุ่มไม่มี/ลบแล้ว → NOT_FOUND ตอนเปิด (ก่อนแตะข้อมูลอื่น) · handle ผูกกับ request เดียว — ห้ามเก็บข้าม request
 */
export async function openGroupCalendar(actor: Actor, groupId: string, ctx: DataCtx): Promise<GroupCalendarHandle> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.calendar.view', { type: 'group', group });
  const me = asUser(actor);
  const row = groupRowOf(group);
  return { group: { id: row.id, tz: row.tz, myRole: group.actorRole }, load: (query) => calendarFor(ctx, me, allow, row, query) };
}

/**
 * ส่วนหลังด่านสิทธิ์ (R7 B-3) — เรียกได้จาก getGroupCalendar/openGroupCalendar เท่านั้น (ไม่ export: ต้องมี `allow` จาก authorize('group.calendar.view'))
 * row = แถวกลุ่มจาก loadGroupCtx (ไม่อ่านกลุ่มซ้ำ) · ตรวจช่วงวันที่หลังด่าน · สมาชิก ∥ busy (อิสระกันหลังผ่านด่าน)
 */
async function calendarFor(ctx: DataCtx, me: UserActor, allow: Allow, row: GroupRow, query: CalendarQuery): Promise<GroupCalendarDto> {
  for (const f of ['from', 'to'] as const) if (query[f] === undefined) throw new AppError('VALIDATION', { fields: { [f]: 'REQUIRED' } });
  const range = parseDateRange(query.from!, query.to!);
  const groupId = row.id;
  // ช่วง [from, to] รวมปลาย ตามวันท้องถิ่นของ *กลุ่ม* → epoch [เที่ยงคืนต้น from, เที่ยงคืนต้นวันหลัง to) — ตรงกับที่ UI วางรายการตาม tz กลุ่ม (L3)
  const fromMs = startOfDay(range.from, row.tz);
  const toMs = startOfDay(addDays(range.to, 1), row.tz);
  const [members, { items, truncated }] = await Promise.all([listMembers(ctx.db, groupId), loadMemberBusy(ctx.db, groupId, row.tz, fromMs, toMs)]);
  await auditRead(ctx.db, me, allow, { action: 'group.calendar.view', targetType: 'group', targetId: groupId, groupId, meta: { from: range.from, to: range.to } }, ctx.now);

  const dtos: CalendarMemberDto[] = members.map((m) => ({
    userId: m.userId,
    displayName: sanitizeDisplayText(m.displayName),
    ...memberAppearance(groupId, m.userId, m),
  }));
  dtos.sort(
    (a, b) =>
      Number(b.userId === me.id) - Number(a.userId === me.id) ||
      a.colorIndex - b.colorIndex ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  return { group: { id: row.id, tz: row.tz }, from: range.from, to: range.to, members: dtos, busy: items.map((i) => i.view), truncated };
}
