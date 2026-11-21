// มุมมองของแชร์นัด (R18 §S · ADR 0016 §5.4) ที่ทั้ง services/appointments.ts และ services/share.ts ใช้ — ไม่มี actor เป็นพารามิเตอร์แรก
// ผู้เรียกต้องผ่าน authorize() ของ action ที่ตรงกันมาแล้วเสมอ:
//   guestDetailDto     → appointment.guest.view (ผู้ดูเป็นแขกที่มีผลของนัด)
//   memberShareExtras  → appointment.view (ผู้ดูเป็นสมาชิก / SA)
import { overlapsRange } from '@/lib/calendar';
import type { DbOrTx } from '@/db/client';
import { myCommitmentsOverlapping, type AppointmentRow } from '@/lib/data/repos/appointment';
import { findGuestView, goingMaybeCounts, listGuestsOfAppointment, type GuestListRow } from '@/lib/data/repos/appointment-guest';
import { listShareLinksOfAppointment, type ShareLinkListRow } from '@/lib/data/repos/share-link';
import { can } from '@/lib/rbac/can';
import type { GroupCtx, UserActor } from '@/lib/rbac/types';
import { configuredAppOrigin, getEnv } from '@/lib/shared/env';
import { AppError } from '@/lib/shared/errors';
import { APPOINTMENT_MY_CONFLICTS_MAX } from '@/lib/shared/limits';
import type { DataCtx } from '../context';
import { shareTokenFor, shareUrlFor } from '../share-token';
import { NO_CONFLICTS, toMyConflictDto, toPersonDto, type MemberLook, type MyConflictsDto, type PersonDto } from '../serializers/appointments';
import { toGuestAppointmentDto, toGuestsBlock, toShareLinkDto, type GuestAppointmentDto, type GuestsBlockDto, type ShareLinkDto } from '../serializers/share';

/** origin ของลิงก์แชร์ = ตัวเดียวกับ .ics (APP_ORIGIN → VERCEL_URL) · ไม่ตั้ง (dev) → origin ของคำขอ */
export function shareAppOrigin(ctx: Pick<DataCtx, 'req'>): string {
  return configuredAppOrigin(getEnv()) ?? new URL(ctx.req.url).origin;
}

/** ลิงก์เต็มของลิงก์ชวน id นี้ (สร้างใหม่ทุกครั้ง — ไม่เก็บ token) */
export function shareUrlOf(ctx: Pick<DataCtx, 'req' | 'appSecret'>, linkId: string): string {
  return shareUrlFor(shareAppOrigin(ctx), shareTokenFor(linkId, ctx.appSecret));
}

/** myConflicts ของแขก (ของ session user เอง) — นัดยกเลิก/จบแล้ว → [] โดยไม่แตะ DB */
async function guestConflicts(db: DbOrTx, userId: string, now: number, row: AppointmentRow): Promise<MyConflictsDto> {
  if (row.status !== 'active' || row.endAt <= now) return NO_CONFLICTS;
  const rows = await myCommitmentsOverlapping(db, userId, row.startAt, row.endAt, row.id, APPOINTMENT_MY_CONFLICTS_MAX + 1);
  const hits = rows.filter((c) => !(c.kind === 'appointment' && c.id === row.id) && overlapsRange(c.startAt, c.endAt, row.startAt, row.endAt));
  return { myConflicts: hits.slice(0, APPOINTMENT_MY_CONFLICTS_MAX).map(toMyConflictDto), myConflictsTruncated: hits.length > APPOINTMENT_MY_CONFLICTS_MAX };
}

/** มุมมองแขก (รายละเอียด) — 3 query ขนาน · แถวแขกหายระหว่างทาง (ออก/ถูกนำออกพร้อมกัน) → NOT_FOUND */
export async function guestDetailDto(
  db: DbOrTx,
  userId: string,
  now: number,
  c: { appointment: AppointmentRow | null; groupName: string; groupIcon: string | null },
): Promise<GuestAppointmentDto> {
  const row = c.appointment;
  if (!row) throw new AppError('NOT_FOUND');
  const [view, counts, conflicts] = await Promise.all([findGuestView(db, row.id, userId), goingMaybeCounts(db, [row.id]), guestConflicts(db, userId, now, row)]);
  if (!view) throw new AppError('NOT_FOUND');
  return toGuestAppointmentDto(
    { row, groupName: c.groupName, groupIcon: c.groupIcon, inviterName: view.inviterName, myRsvp: view.response, counts: counts.get(row.id) ?? { going: 0, maybe: 0 }, now },
    conflicts,
  );
}

export type MemberShareExtras = { guests: GuestsBlockDto; shareLinks: ShareLinkDto[]; canShare: boolean };

/**
 * ส่วนเพิ่มในรายละเอียดนัดของสมาชิก (ADR 0016 §5.4): รายชื่อแขก + ลิงก์ชวนที่ผู้ดูเห็นได้ + canShare (ซ่อนปุ่มเท่านั้น)
 * ลิงก์กรองด้วย can(appointment.share.revoke) แบบ invite.list · url เฉพาะลิงก์ของผู้ดูเอง · นัดยกเลิก/จบแล้ว = ลิงก์ตายถาวร → [] (ไม่ query)
 * ผู้ชวน ("มากับ X") / ผู้สร้างลิงก์ แสดงเฉพาะถ้ายังเป็นสมาชิก (members = สมาชิกปัจจุบันของกลุ่มนัด)
 */
export async function memberShareExtras(
  db: DbOrTx,
  actor: UserActor,
  ctx: Pick<DataCtx, 'req' | 'appSecret'>,
  now: number,
  row: AppointmentRow,
  group: GroupCtx,
  /** สมาชิกปัจจุบันของกลุ่มนัด — รับเป็น Promise ได้ ให้คิวรีแขก/ลิงก์เริ่มพร้อมคิวรีสมาชิก (ไม่เพิ่มรอบรอ) */
  membersIn: ReadonlyMap<string, MemberLook> | Promise<ReadonlyMap<string, MemberLook>>,
  /** แขก/ลิงก์ที่โหลดมากับ query สิทธิ์แล้ว (loadAppointmentCtx withShare) — มี = ไม่ query ซ้ำ */
  preloaded?: { guests: GuestListRow[]; links: ShareLinkListRow[] },
): Promise<MemberShareExtras> {
  const open = row.status === 'active' && row.endAt > now;
  const [guests, allLinks, members] = await Promise.all([
    preloaded ? preloaded.guests : listGuestsOfAppointment(db, row.id),
    preloaded ? preloaded.links : open ? listShareLinksOfAppointment(db, row.id) : Promise.resolve([]),
    membersIn,
  ]);
  const links = open ? allLinks : [];
  const person = (id: string | null): PersonDto | null => {
    if (id === null) return null;
    const m = members.get(id);
    return m === undefined ? null : toPersonDto(row.groupId, id, m.displayName, m);
  };
  return {
    guests: toGuestsBlock(
      guests,
      person,
      (g) => can(actor, 'appointment.guest.remove', { type: 'guestTarget', group, appointmentCreatedBy: row.createdBy, invitedBy: g.invitedBy, guestUserId: g.userId }).allow,
    ),
    shareLinks: links
      .filter((l) => can(actor, 'appointment.share.revoke', { type: 'shareLink', group, appointmentCreatedBy: row.createdBy, linkCreatedBy: l.createdBy }).allow)
      .map((l) => {
        const mine = l.createdBy === actor.id;
        return toShareLinkDto(l, person(l.createdBy), mine, mine ? shareUrlOf(ctx, l.id) : null);
      }),
    canShare: open && can(actor, 'appointment.share.create', { type: 'appointment', group, createdBy: row.createdBy }).allow,
  };
}
