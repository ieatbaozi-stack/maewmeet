// service: ปฏิทินกลุ่ม — U8 · ADR 0006 §1, §3 · action `group.calendar.view`
//  - โหลด GroupCtx (1 query) → authorize บรรทัดแรกของส่วนที่แตะข้อมูล · ไม่ใช่สมาชิก/กลุ่มไม่มี/ลบแล้ว → NOT_FOUND (404) เหมือนกันหมด
//  - ตรวจช่วงวันที่ *หลัง* ผ่านด่านกลุ่ม (คนนอกได้ 404 แม้ส่งช่วงผิด — ไม่เป็น oracle ว่ากลุ่มมีจริง)
//  - busy ของสมาชิกปัจจุบันของกลุ่มนี้เท่านั้น (JOIN group_member ของ gid นี้) ผ่าน serializer เดียว (toBusyForViewers) — ไม่มีมุมมองเจ้าของ แม้เป็นรายการของผู้ดูเอง
//  - super admin ที่ไม่ใช่สมาชิก → audit `group.calendar.view` (ตามกติกาอ่านของ R2: auditRead)
import { z } from 'zod';
import { compareDates, isValidDate, spanDays } from '@/lib/calendar';
import { findGroupById } from '@/lib/data/repos/group';
import { listMembers } from '@/lib/data/repos/group-member';
import { listSharedBusyInGroup } from '@/lib/data/repos/busy';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { CALENDAR_MAX_RANGE_DAYS } from '@/lib/shared/limits';
import { memberColorIndex } from '@/lib/shared/member-color';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { DataCtx } from '../context';
import { loadGroupCtx } from '../policy-context';
import { toBusyForViewers, type BusyHiddenView, type BusySharedView } from '../serializers/busy';
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
  /** 0–9 · คงที่ต่อ (ผู้ใช้, กลุ่ม) */
  colorIndex: number;
};

export type GroupCalendarDto = {
  group: { id: string; tz: string };
  from: string;
  to: string;
  /** ผู้ดู (ถ้าเป็นสมาชิก) ก่อน แล้วตามช่องสี */
  members: CalendarMemberDto[];
  /** เรียงตามเวลาเริ่ม · ทุกชิ้นผ่าน toBusyForViewers */
  busy: (BusySharedView | BusyHiddenView)[];
};

export async function getGroupCalendar(actor: Actor, groupId: string, query: CalendarQuery, ctx: DataCtx): Promise<GroupCalendarDto> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.calendar.view', { type: 'group', group });
  const me = asUser(actor);
  for (const f of ['from', 'to'] as const) if (query[f] === undefined) throw new AppError('VALIDATION', { fields: { [f]: 'REQUIRED' } });
  const range = parseDateRange(query.from!, query.to!);
  const row = await findGroupById(ctx.db, groupId);
  if (!row || row.deletedAt !== null) throw new AppError('NOT_FOUND');

  const members = await listMembers(ctx.db, groupId);
  const busy = await listSharedBusyInGroup(ctx.db, groupId, range.from, range.to);
  await auditRead(ctx.db, me, allow, { action: 'group.calendar.view', targetType: 'group', targetId: groupId, groupId, meta: { from: range.from, to: range.to } }, ctx.now);

  const dtos: CalendarMemberDto[] = members.map((m) => ({
    userId: m.userId,
    displayName: sanitizeDisplayText(m.displayName),
    colorIndex: memberColorIndex(groupId, m.userId),
  }));
  dtos.sort(
    (a, b) =>
      Number(b.userId === me.id) - Number(a.userId === me.id) ||
      a.colorIndex - b.colorIndex ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  return { group: { id: row.id, tz: row.tz }, from: range.from, to: range.to, members: dtos, busy: busy.map(toBusyForViewers) };
}
