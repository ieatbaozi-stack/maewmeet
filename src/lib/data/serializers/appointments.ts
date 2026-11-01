// DTO ของนัด + RSVP + ผลเตือนนัดทับ (R4B) — ที่เดียวที่นัดออกจากระบบ
//  - ชื่อ/สถานที่/คำอธิบายผ่าน sanitizeDisplayText ตอนอ่าน (แถวที่เข้ามาก่อนมีกติกา) · คำอธิบายคงขึ้นบรรทัดได้
//  - RSVP: นับ/แสดงเฉพาะ "สมาชิกปัจจุบัน" (repo join group_member) · ชื่อ = ชื่อที่แสดง · สี/รูปทรง = memberAppearance ชุดเดียวกับปฏิทิน (R6C)
//  - ผู้สร้าง/ผู้ยกเลิก: แสดงเมื่อยังเป็นสมาชิกกลุ่ม ไม่งั้น null (ไม่เปิดเผยชื่อคนที่ออกแล้ว)
//  - busy ในผลเตือนนัดทับผ่าน toBusyForViewers ตัวเดียวกับปฏิทิน/วันว่าง — ไม่มี note · รายการซ่อนไม่มี title
import type { AppointmentRow, MyCommitmentRow, RsvpResponse, RsvpRow } from '@/lib/data/repos/appointment';
import { daysUntil } from '@/lib/calendar';
import { memberAppearance, type AppearanceSlots, type MemberAppearance } from '@/lib/shared/member-color';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { MemberBusyView } from './busy';

export const RSVP_RESPONSES = ['going', 'maybe', 'not_going'] as const satisfies readonly RsvpResponse[];

/** colorIndex/shapeIndex 0–9 จาก memberAppearance (slot ที่เลือก ?? hash เดิม) */
export type PersonDto = { userId: string; displayName: string; colorIndex: number; shapeIndex: number };

export type RsvpCountsDto = { going: number; maybe: number; not_going: number; noResponse: number };

export type RsvpSummaryDto = {
  counts: RsvpCountsDto;
  /** คำตอบของผู้ดู · null = ยังไม่ตอบ (หรือผู้ดูไม่ใช่สมาชิก) */
  mine: RsvpResponse | null;
};

export type RsvpDetailDto = RsvpSummaryDto & {
  /** รายชื่อสมาชิกปัจจุบันต่อคำตอบ (ตามเวลาที่ตอบ เก่า→ใหม่) */
  members: Record<RsvpResponse, PersonDto[]>;
};

export type AppointmentStatus = 'active' | 'cancelled';

export type AppointmentDto = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  description: string | null;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
  /** epoch ms UTC */
  startAt: number;
  endAt: number;
  /** tz ของกลุ่ม ณ ตอนสร้าง/แก้เวลา — ใช้แสดงเวลา */
  tz: string;
  /** วันท้องถิ่นของจุดเริ่ม YYYY-MM-DD (ใน tz ของนัด) */
  localDate: string;
  status: AppointmentStatus;
  /** end_at <= เวลาของคำขอ — ตอบ RSVP ไม่ได้แล้ว */
  isPast: boolean;
  /** "อีกกี่วัน" เป็นวันปฏิทินใน tz ของนัด ณ เวลาของคำขอ (วันนี้ = 0 · ผ่านแล้วเป็นลบ) */
  daysUntil: number;
  createdBy: PersonDto | null;
  createdAt: number;
  updatedAt: number;
  cancelledAt: number | null;
  cancelledBy: PersonDto | null;
  rsvp: RsvpSummaryDto;
  /**
   * R6D (ADR 0009 §3, main ตัดสิน (ข)): เฉพาะ DTO รายการ — true = ฉันตอบ "ไป" นัดนี้ และนัดนี้ทับนัดอื่นที่ฉันตอบ "ไป" หรือ busy ของฉัน (ชนขอบไม่นับ)
   * ค่าของผู้ขอเท่านั้น (รายการเป็นของ session user เสมอ) · ไม่มี key ใน DTO รายละเอียด (ใช้ myConflicts)
   */
  myConflict?: boolean;
};

export type AppointmentPermissionsDto = {
  /** ใช้ซ่อน/แสดงปุ่มเท่านั้น — สิทธิ์จริงตัดสินที่เซิร์ฟเวอร์ทุกครั้ง */
  canEdit: boolean;
  canCancel: boolean;
  canRsvp: boolean;
};

/**
 * สิ่งที่ "ฉัน" มีอยู่แล้วที่ทับนัดนี้ (ADR 0009 §3) — ของ session user เท่านั้น จึงมีชื่อ/กลุ่มของตัวเองได้
 * busy ที่ไม่มี title (หรือ title ว่าง) → title: null (UI ใช้ "ช่วงไม่ว่างที่ลงไว้") · ไม่มี note
 */
export type MyConflictDto =
  | { kind: 'appointment'; appointmentId: string; title: string; groupId: string; groupName: string; startAt: number; endAt: number; tz: string }
  | { kind: 'busy'; busyId: string; title: string | null; allDay: boolean; startAt: number; endAt: number; localStartDate: string; localEndDate: string; tz: string };

export type MyConflictsDto = { myConflicts: MyConflictDto[]; myConflictsTruncated: boolean };

export const NO_CONFLICTS: MyConflictsDto = Object.freeze({ myConflicts: [], myConflictsTruncated: false }) as MyConflictsDto;

export type AppointmentDetailDto = Omit<AppointmentDto, 'rsvp' | 'myConflict'> & {
  rsvp: RsvpDetailDto;
  permissions: AppointmentPermissionsDto;
  /** หน้าตาของผู้ดูในกลุ่มของนัด (R6C) · null = ผู้ดูไม่ใช่สมาชิก (super admin นอกกลุ่ม) */
  myAppearance: MemberAppearance | null;
  /**
   * R6D: นัดที่ฉันตอบ "ไป" (ทุกกลุ่ม ยกเว้นนัดนี้) + busy ของฉัน ที่ทับนัดนี้ (ครึ่งเปิด ชนขอบไม่นับ) ≤ 5 รายการ เรียงเวลาเริ่ม
   * คำนวณใน GET /api/appointments/:id และ PUT .../rsvp เท่านั้น · สร้าง/แก้/ยกเลิก และนัดยกเลิก/จบแล้ว/ผู้ดูไม่ใช่สมาชิก → []
   * ป้าย "ชนกับนัดอื่น" = rsvp.mine === 'going' && myConflicts.length > 0
   */
  myConflicts: MyConflictDto[];
  /** true = มีรายการชนมากกว่า 5 */
  myConflictsTruncated: boolean;
};

export type OverlapBlockedDto = {
  userId: string;
  displayName: string;
  colorIndex: number;
  shapeIndex: number;
  /** busy ของคนนี้ที่ทับนัด (เรียง startAt, endAt, kind, id) — ผ่าน serializer เดียวกับปฏิทิน · kind ตาม ADR 0009 §2 */
  items: MemberBusyView[];
};

export type OverlapDto = {
  /** `unknown` = busy ที่โหลดถูกตัด (เกินเพดาน) — ห้ามสรุปว่า "ไม่มีใครติด" · blocked คือที่พบในส่วนที่โหลดได้ */
  status: 'ok' | 'unknown';
  blocked: OverlapBlockedDto[];
};

const person = (groupId: string, userId: string, displayName: string, slots: AppearanceSlots | null): PersonDto => ({
  userId,
  displayName: sanitizeDisplayText(displayName),
  ...memberAppearance(groupId, userId, slots),
});

/** ชื่อ + slot หน้าตาของสมาชิกปัจจุบัน (R6C) */
export type MemberLook = { displayName: string } & AppearanceSlots;

export type AppointmentContext = {
  viewerId: string;
  now: number;
  groupName: string;
  /** สมาชิกปัจจุบันของกลุ่มที่นัดสังกัด (userId → ชื่อ + slot หน้าตา) */
  members: ReadonlyMap<string, MemberLook>;
  memberCount: number;
  /** RSVP ของสมาชิกปัจจุบันของนัดนี้ */
  rsvps: readonly RsvpRow[];
};

function buildRsvp(row: AppointmentRow, c: AppointmentContext): RsvpDetailDto {
  const members: Record<RsvpResponse, PersonDto[]> = { going: [], maybe: [], not_going: [] };
  let mine: RsvpResponse | null = null;
  for (const r of c.rsvps) {
    if (r.appointmentId !== row.id) continue;
    members[r.response].push(person(row.groupId, r.userId, r.displayName, r));
    if (r.userId === c.viewerId) mine = r.response;
  }
  const answered = members.going.length + members.maybe.length + members.not_going.length;
  return {
    counts: { going: members.going.length, maybe: members.maybe.length, not_going: members.not_going.length, noResponse: Math.max(0, c.memberCount - answered) },
    mine,
    members,
  };
}

function toBase(row: AppointmentRow, c: AppointmentContext): Omit<AppointmentDto, 'rsvp'> {
  const named = (id: string | null): PersonDto | null => {
    if (id === null) return null;
    const m = c.members.get(id);
    return m === undefined ? null : person(row.groupId, id, m.displayName, m);
  };
  return {
    id: row.id,
    groupId: row.groupId,
    groupName: sanitizeDisplayText(c.groupName),
    title: sanitizeDisplayText(row.title),
    description: row.description === null ? null : cleanMultiline(row.description),
    placeName: row.placeName === null ? null : sanitizeDisplayText(row.placeName),
    lat: row.lat,
    lng: row.lng,
    mapUrl: row.mapUrl,
    startAt: row.startAt,
    endAt: row.endAt,
    tz: row.tz,
    localDate: row.localDate,
    status: row.status,
    isPast: row.endAt <= c.now,
    daysUntil: daysUntil(c.now, row.startAt, row.tz),
    createdBy: named(row.createdBy),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cancelledAt: row.cancelledAt,
    cancelledBy: named(row.cancelledBy),
  };
}

/** คำอธิบายหลายบรรทัด: ทำความสะอาดทีละบรรทัด (คงการขึ้นบรรทัด) */
function cleanMultiline(raw: string): string {
  return raw
    .split(/\r\n?|\n/)
    .map((l) => sanitizeDisplayText(l))
    .join('\n')
    .trim();
}

/** มุมมองรายการ — จำนวนต่อคำตอบ + คำตอบของฉัน (ไม่มีรายชื่อ) */
export function toAppointmentDto(row: AppointmentRow, c: AppointmentContext, myConflict?: boolean): AppointmentDto {
  const { members: _members, ...summary } = buildRsvp(row, c);
  void _members;
  const dto: AppointmentDto = { ...toBase(row, c), rsvp: summary };
  if (myConflict !== undefined) dto.myConflict = myConflict;
  return dto;
}

/** แถวคำมั่นของฉัน → DTO (allowlist · สร้างอ็อบเจกต์ใหม่) */
export function toMyConflictDto(r: MyCommitmentRow): MyConflictDto {
  if (r.kind === 'appointment') {
    return { kind: 'appointment', appointmentId: r.id, title: sanitizeDisplayText(r.title), groupId: r.groupId, groupName: sanitizeDisplayText(r.groupName), startAt: r.startAt, endAt: r.endAt, tz: r.tz };
  }
  const title = r.title === null ? '' : sanitizeDisplayText(r.title);
  return {
    kind: 'busy',
    busyId: r.id,
    title: title === '' ? null : title,
    allDay: r.allDay,
    startAt: r.startAt,
    endAt: r.endAt,
    localStartDate: r.localStartDate,
    localEndDate: r.localEndDate,
    tz: r.tz,
  };
}

/** มุมมองรายละเอียด — รายชื่อต่อคำตอบ + สิทธิ์ของผู้ดู */
export function toAppointmentDetailDto(
  row: AppointmentRow,
  c: AppointmentContext,
  permissions: AppointmentPermissionsDto,
  conflicts: MyConflictsDto = NO_CONFLICTS,
): AppointmentDetailDto {
  const mine = c.members.get(c.viewerId);
  return {
    ...toBase(row, c),
    rsvp: buildRsvp(row, c),
    permissions,
    myAppearance: mine === undefined ? null : memberAppearance(row.groupId, c.viewerId, mine),
    myConflicts: [...conflicts.myConflicts],
    myConflictsTruncated: conflicts.myConflictsTruncated,
  };
}

export { person as toPersonDto };
