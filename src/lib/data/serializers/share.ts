// DTO ของแชร์นัด / แขก — R18 §S · ADR 0016 §5.4 · ที่เดียวที่ข้อมูลฝั่งแขกออกจากระบบ
//  - สร้างอ็อบเจกต์ใหม่แบบ allowlist ทุกตัว (ADR 0009 §2) — คีย์ตรงกับ *_FIELDS ด้านล่าง (เทสต์ snapshot คีย์)
//  - SharePreviewDto: ไม่มี id นัด/กลุ่ม · description · ผู้สร้างนัด · รายชื่อ · busy · นัดอื่น · permissions · token/hash
//  - ชื่อ/สถานที่ผ่าน sanitizeDisplayText · ยอดเฉพาะ going/maybe (ไม่มี not_going / ยังไม่ตอบ / จำนวนสมาชิก — บอกขนาดกลุ่ม)
import type { AppointmentRow, RsvpResponse } from '@/lib/data/repos/appointment';
import type { GuestListRow } from '@/lib/data/repos/appointment-guest';
import { daysUntil } from '@/lib/calendar';
import { normalizeGroupIcon, type GroupIconKey } from '@/lib/shared/group-icons';
import { APPOINTMENT_GUESTS_MAX } from '@/lib/shared/limits';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { MyConflictsDto, PersonDto, RsvpCountsDto } from './appointments';

export type GoingMaybeDto = { going: number; maybe: number };

/** การ์ดนัดบนหน้า /i/<token> (ใครก็ได้ที่ถือ token) */
export type SharePreviewDto = {
  state: 'ok' | 'full';
  title: string;
  startAt: number;
  endAt: number;
  tz: string;
  localDate: string;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
  groupName: string;
  groupIcon: GroupIconKey | null;
  /** ผู้สร้างลิงก์ ("X ชวนคุณ") — คนเดียวที่ผู้ถือลิงก์เห็นชื่อ */
  inviterName: string | null;
  counts: GoingMaybeDto;
};

export const SHARE_PREVIEW_FIELDS = [
  'state',
  'title',
  'startAt',
  'endAt',
  'tz',
  'localDate',
  'placeName',
  'lat',
  'lng',
  'mapUrl',
  'groupName',
  'groupIcon',
  'inviterName',
  'counts',
] as const satisfies readonly (keyof SharePreviewDto)[];

export type CardInput = {
  title: string;
  startAt: number;
  endAt: number;
  tz: string;
  localDate: string;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
  groupName: string;
  groupIcon: string | null;
};

const nameOrNull = (raw: string | null | undefined): string | null => {
  if (raw === null || raw === undefined) return null;
  const s = sanitizeDisplayText(raw);
  return s === '' ? null : s;
};

function card(c: CardInput) {
  return {
    title: sanitizeDisplayText(c.title),
    startAt: c.startAt,
    endAt: c.endAt,
    tz: c.tz,
    localDate: c.localDate,
    placeName: c.placeName === null ? null : sanitizeDisplayText(c.placeName),
    lat: c.lat,
    lng: c.lng,
    mapUrl: c.mapUrl,
    groupName: sanitizeDisplayText(c.groupName),
    groupIcon: normalizeGroupIcon(c.groupIcon),
  };
}

export function toSharePreviewDto(c: CardInput & { full: boolean; inviterName: string | null; going: number; maybe: number }): SharePreviewDto {
  return {
    state: c.full ? 'full' : 'ok',
    ...card(c),
    inviterName: nameOrNull(c.inviterName),
    counts: { going: c.going, maybe: c.maybe },
  };
}

/** มุมมองนัดของแขกที่เข้าแล้ว (รายละเอียด) — ไม่มี groupId · ไม่มีรายชื่อใคร · invitedBy = ชื่อผู้ชวนเฉพาะถ้ายังเป็นสมาชิก */
export type GuestAppointmentDto = {
  id: string;
  viewerKind: 'guest';
  title: string;
  description: string | null;
  startAt: number;
  endAt: number;
  tz: string;
  localDate: string;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
  groupName: string;
  groupIcon: GroupIconKey | null;
  status: 'active' | 'cancelled';
  isPast: boolean;
  daysUntil: number;
  invitedBy: string | null;
  myRsvp: RsvpResponse | null;
  counts: GoingMaybeDto;
  permissions: { canRsvp: boolean; canLeave: boolean };
  myConflicts: MyConflictsDto['myConflicts'];
  myConflictsTruncated: boolean;
};

export const GUEST_APPOINTMENT_FIELDS = [
  'id',
  'viewerKind',
  'title',
  'description',
  'startAt',
  'endAt',
  'tz',
  'localDate',
  'placeName',
  'lat',
  'lng',
  'mapUrl',
  'groupName',
  'groupIcon',
  'status',
  'isPast',
  'daysUntil',
  'invitedBy',
  'myRsvp',
  'counts',
  'permissions',
  'myConflicts',
  'myConflictsTruncated',
] as const satisfies readonly (keyof GuestAppointmentDto)[];

/** การ์ดแขกในรายการ "นัดของฉัน" — เหมือนรายละเอียดแต่ไม่มี myConflicts (ใช้ธง myConflict แบบการ์ดสมาชิก) */
export type GuestAppointmentListItemDto = Omit<GuestAppointmentDto, 'myConflicts' | 'myConflictsTruncated'> & { myConflict?: boolean };

export type GuestViewInput = {
  row: AppointmentRow;
  groupName: string;
  groupIcon: string | null;
  inviterName: string | null;
  myRsvp: RsvpResponse | null;
  counts: GoingMaybeDto;
  now: number;
};

function cleanMultiline(raw: string): string {
  return raw
    .split(/\r\n?|\n/)
    .map((l) => sanitizeDisplayText(l))
    .join('\n')
    .trim();
}

function guestBase(v: GuestViewInput): Omit<GuestAppointmentDto, 'myConflicts' | 'myConflictsTruncated'> {
  const r = v.row;
  const open = r.status === 'active' && r.endAt > v.now;
  return {
    id: r.id,
    viewerKind: 'guest',
    ...card({ ...r, groupName: v.groupName, groupIcon: v.groupIcon }),
    description: r.description === null ? null : cleanMultiline(r.description),
    status: r.status,
    isPast: r.endAt <= v.now,
    daysUntil: daysUntil(v.now, r.startAt, r.tz),
    invitedBy: nameOrNull(v.inviterName),
    myRsvp: v.myRsvp,
    counts: { going: v.counts.going, maybe: v.counts.maybe },
    // ใช้ซ่อนปุ่มเท่านั้น — สิทธิ์จริงตัดสินที่เซิร์ฟเวอร์ทุกครั้ง
    permissions: { canRsvp: open, canLeave: true },
  };
}

export function toGuestAppointmentDto(v: GuestViewInput, conflicts: MyConflictsDto): GuestAppointmentDto {
  return { ...guestBase(v), myConflicts: [...conflicts.myConflicts], myConflictsTruncated: conflicts.myConflictsTruncated };
}

export function toGuestListItemDto(v: GuestViewInput, myConflict?: boolean): GuestAppointmentListItemDto {
  const dto: GuestAppointmentListItemDto = guestBase(v);
  if (myConflict !== undefined) dto.myConflict = myConflict;
  return dto;
}

// ───────── ฝั่งสมาชิก (หน้านัด) ─────────

/** แขกในหน้านัดของสมาชิก — ชื่อแขกเห็นได้โดยสมาชิก (S6) · invitedBy = ผู้ชวนเฉพาะถ้ายังเป็นสมาชิก ("มากับ X") */
export type GuestPersonDto = { userId: string; displayName: string; response: RsvpResponse | null; invitedBy: PersonDto | null; canRemove: boolean };

export type GuestsBlockDto = { items: GuestPersonDto[]; counts: RsvpCountsDto; max: number };

export function toGuestsBlock(rows: readonly GuestListRow[], invitedBy: (id: string | null) => PersonDto | null, canRemove: (row: GuestListRow) => boolean): GuestsBlockDto {
  const counts: RsvpCountsDto = { going: 0, maybe: 0, not_going: 0, noResponse: 0 };
  const items = rows.map((r): GuestPersonDto => {
    if (r.response === null) counts.noResponse++;
    else counts[r.response]++;
    return { userId: r.userId, displayName: sanitizeDisplayText(r.displayName), response: r.response, invitedBy: invitedBy(r.invitedBy), canRemove: canRemove(r) };
  });
  return { items, counts, max: APPOINTMENT_GUESTS_MAX };
}

/** ลิงก์ชวนในหน้านัดของสมาชิก — url มีเฉพาะลิงก์ของผู้ดูเอง (สร้างใหม่จาก id ทุกครั้งที่อ่าน) · ไม่มี token_hash เด็ดขาด */
export type ShareLinkDto = { id: string; createdBy: PersonDto | null; createdAt: number; guestsJoined: number; mine: boolean; url?: string };

export function toShareLinkDto(l: { id: string; createdAt: number; guestsJoined: number }, createdBy: PersonDto | null, mine: boolean, url: string | null): ShareLinkDto {
  const dto: ShareLinkDto = { id: l.id, createdBy, createdAt: l.createdAt, guestsJoined: l.guestsJoined, mine };
  if (mine && url !== null) dto.url = url;
  return dto;
}
