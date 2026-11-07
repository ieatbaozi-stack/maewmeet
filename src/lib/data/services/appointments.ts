// service: นัด + RSVP + เตือนนัดทับ — U10, U10.1, U10.2, U11 · R4B_CONTRACT §2 · ADR 0003 (appointment.*) · ADR 0006 · ADR 0007
//  - authorize() บรรทัดแรกทุกฟังก์ชัน (โหลด GroupCtx / AppointmentCtx เพื่อสร้าง resource ให้ can() เท่านั้น) · ไม่ใช่สมาชิก/นัดไม่มี/กลุ่มลบแล้ว → NOT_FOUND ตัวเดียวกันทุกไบต์
//  - สมาชิกที่ไม่มีสิทธิ์แก้/ยกเลิกนัดของคนอื่น → FORBIDDEN (403) เพราะเห็นนัดอยู่แล้ว · super admin ที่ไม่ใช่สมาชิกตอบ RSVP ไม่ได้ (FORBIDDEN)
//  - การเขียนทุกอย่าง = คำสั่ง SQL เดียวมีเงื่อนไขในตัว + ActorGuard (repos/appointment.ts) · ไม่ผ่าน → วินิจฉัยเพื่อเลือกรหัสที่ถูก
//  - เวลาทั้งหมดผ่าน src/lib/calendar (normalizeBusyInput แบบ timed ใน tz กลุ่ม · todayIn/daysUntil) — ไม่คำนวณวันเอง
//  - สร้างนัด: notify(tx) 'appointment.created' ถึงสมาชิกทุกคนยกเว้นผู้สร้าง ใน transaction เดียวกัน (ล้ม → นัด rollback)
//  - เตือนนัดทับ: busy ของสมาชิกปัจจุบันผ่านคิวรีฝั่งแชร์ + serializer เดียวกับปฏิทิน/วันว่าง (ไม่มี note · รายการซ่อนไม่มี title) · ไม่บล็อกการสร้าง/แก้
//  - R6D (ADR 0009): busy รวมนัดที่ตอบ "ไป" จากทุกกลุ่ม (ตัดนัดตัวเองออก) · myConflicts ของ session user ในรายละเอียด · myConflict ในรายการ
import { z } from 'zod';
import { membersBlockedDuring, normalizeBusyInput, overlapsRange, type BusyInputError } from '@/lib/calendar';
import { findGroupById } from '@/lib/data/repos/group';
import { listMemberIds, listMembers } from '@/lib/data/repos/group-member';
import {
  cancelAppointmentGuarded,
  countActiveFutureAppointments,
  countCreatedLastDay,
  currentMemberNames,
  groupNamesAndMemberCounts,
  insertAppointmentIfUnderCap,
  listCurrentRsvps,
  listGroupAppointmentRows,
  listMyUpcomingAppointmentRows,
  myCommitmentsOverlapping,
  updateAppointmentGuarded,
  upsertRsvpIfOpen,
  type AppointmentCursor,
  type AppointmentPatch,
  type AppointmentRow,
  type AppointmentScope,
  type AppointmentWrite,
  type ListedAppointment,
} from '@/lib/data/repos/appointment';
import { rateKey, type RateSpec } from '@/lib/auth/throttle';
import { refundBucket, reserveBucket } from '@/lib/data/repos/rate-limit-bucket';
import { authorize, can } from '@/lib/rbac/can';
import type { Actor, Allow, GroupCtx, UserActor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import {
  APPOINTMENT_DESCRIPTION_MAX,
  APPOINTMENT_LIST_DEFAULT,
  APPOINTMENT_LIST_MAX,
  APPOINTMENT_MAX_ACTIVE_PER_GROUP,
  APPOINTMENT_MAX_BACKDATE_MS,
  APPOINTMENT_MAX_CREATED_PER_GROUP_PER_DAY,
  APPOINTMENT_WRITE_RATE_LIMITS,
  APPOINTMENT_MAX_SPAN_DAYS,
  APPOINTMENT_PLACE_NAME_MAX,
  APPOINTMENT_TITLE_MAX,
  APPOINTMENT_MY_CONFLICTS_MAX,
  APPOINTMENT_LIST_CONFLICT_SCAN_MAX,
} from '@/lib/shared/limits';
import { parseMapUrl } from '@/lib/shared/location-parse';
import { memberAppearance } from '@/lib/shared/member-color';
import { checkVisibleName, hasForbiddenChars, sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { DataCtx } from '../context';
import { notify } from '../notifications/notify';
import { groupRowOf, loadAppointmentCtx, loadGroupCtx, type AppointmentCtx } from '../policy-context';
import {
  toAppointmentDetailDto,
  toAppointmentDto,
  type AppointmentDetailDto,
  type AppointmentDto,
  type MemberLook,
  type MyConflictsDto,
  type OverlapDto,
  NO_CONFLICTS,
  toMyConflictDto,
} from '../serializers/appointments';
import { loadMemberBusy, type MemberBusyItem } from './member-busy';
import { inTx, serialized } from '../tx';
import { asUser, audit, auditRead } from './group-common';
import { AVAILABILITY_FETCH_MARGIN_MS } from './availability';
import { busyInputError } from './busy';

// ───────── input schemas (strict = ไม่รับ groupId / createdBy / status / cancelledBy / tz / id ฯลฯ จาก body — mass assignment) ─────────
const idField = z.uuid();
const dateField = z.string().max(32);
const timeField = z.string().max(16);
// ความยาวดิบกว้างกว่าเพดานจริงเล็กน้อย: เพดานจริงนับเป็น code point หลัง NFC ใน service (TOO_LONG)
const titleField = z.string().max(APPOINTMENT_TITLE_MAX * 8);
const descriptionField = z.string().max(APPOINTMENT_DESCRIPTION_MAX * 8).nullable();
const placeNameField = z.string().max(APPOINTMENT_PLACE_NAME_MAX * 8).nullable();
const coordField = z.number().nullable();
const linkField = z.string().max(2000).nullable();

const placeShape = {
  placeName: placeNameField.optional(),
  lat: coordField.optional(),
  lng: coordField.optional(),
  mapUrl: linkField.optional(),
};
const scheduleShape = { startDate: dateField, startTime: timeField, endDate: dateField, endTime: timeField };

export const appointmentGroupParamsSchema = z.object({ gid: idField });
export const appointmentParamsSchema = z.object({ id: idField });

export const createAppointmentInputSchema = z
  .object({ title: titleField, description: descriptionField.optional(), ...placeShape, ...scheduleShape })
  .strict();
export type CreateAppointmentInput = z.output<typeof createAppointmentInputSchema>;

/**
 * ตรวจนัดทับล่วงหน้า (ไม่เขียน) — ต้องการแค่ช่วงเวลา
 * appointmentId? (R6D, ADR 0009 §4): ฟอร์มแก้นัดส่ง id นัดเดิม → ไม่นับคำตอบ "ไป" ของนัดนั้นเอง · ผูกกลุ่ม :gid ใน SQL (id นัดกลุ่มอื่นไม่มีผล)
 */
export const checkAppointmentInputSchema = z.object({ ...scheduleShape, appointmentId: idField.optional() }).strict();
export type CheckAppointmentInput = z.output<typeof checkAppointmentInputSchema>;

const SCHEDULE_KEYS = ['startDate', 'startTime', 'endDate', 'endTime'] as const;
const PATCH_KEYS = ['title', 'description', 'placeName', 'lat', 'lng', 'mapUrl'] as const;

/** PATCH: เวลาเป็น "ทั้งก้อนหรือไม่ส่งเลย" · ฟิลด์อื่นส่งทีละตัวได้ (null = ล้างค่า ยกเว้น title) · lat/lng ต้องไปด้วยกัน (ตรวจใน service) · ต้องมีอย่างน้อยหนึ่งฟิลด์ */
export const updateAppointmentInputSchema = z
  .object({
    title: titleField.optional(),
    description: descriptionField.optional(),
    ...placeShape,
    startDate: dateField.optional(),
    startTime: timeField.optional(),
    endDate: dateField.optional(),
    endTime: timeField.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const touchesSchedule = SCHEDULE_KEYS.some((k) => v[k] !== undefined);
    if (touchesSchedule) {
      for (const k of SCHEDULE_KEYS) if (v[k] === undefined) ctx.addIssue({ code: 'invalid_type', expected: 'string', input: undefined, path: [k] });
    } else if (!PATCH_KEYS.some((k) => v[k] !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['_'], message: 'EMPTY' });
    }
  });
export type UpdateAppointmentInput = z.output<typeof updateAppointmentInputSchema>;

export const rsvpInputSchema = z.object({ response: z.enum(['going', 'maybe', 'not_going']) }).strict();
export type RsvpInput = z.output<typeof rsvpInputSchema>;

/** รูปร่างเท่านั้น — ความหมาย (scope/limit/cursor) ตรวจหลังด่านสิทธิ์ */
export const listAppointmentsQuerySchema = z
  .object({ scope: z.string().max(16).optional(), limit: z.string().max(8).optional(), cursor: z.string().max(256).optional() })
  .strict();
export type ListAppointmentsQuery = z.output<typeof listAppointmentsQuerySchema>;

/** rsvp=going (R6D แท็บ "ของฉัน"): เฉพาะนัดที่ฉันตอบ "ไป" · ค่าอื่น → VALIDATION fields.rsvp INVALID (ตรวจใน service) */
export const myAppointmentsQuerySchema = z.object({ limit: z.string().max(8).optional(), rsvp: z.string().max(16).optional() }).strict();
export type MyAppointmentsQuery = z.output<typeof myAppointmentsQuerySchema>;

// ───────── parsing / validation (หลัง authorize) ─────────
function titleOf(raw: string): string {
  const r = checkVisibleName(raw, { min: 1, max: APPOINTMENT_TITLE_MAX });
  if (!r.ok) throw new AppError('VALIDATION', { fields: { title: r.reason } });
  return r.name;
}

function placeNameOf(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const r = checkVisibleName(raw, { min: 1, max: APPOINTMENT_PLACE_NAME_MAX });
  if (!r.ok) throw new AppError('VALIDATION', { fields: { placeName: r.reason } });
  return r.name;
}

/** คำอธิบาย: NFC, \r\n→\n, แท็บ→ช่องว่าง, ตัดหัวท้าย, ≤ 1000 code point, ห้ามตัวควบคุม/จัดรูป (bidi, zero-width ฯลฯ) นอกจากขึ้นบรรทัด · ว่าง → null */
function descriptionOf(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
  if (text === '') return null;
  if (hasForbiddenChars(text.replace(/\n/g, ''))) throw new AppError('VALIDATION', { fields: { description: 'INVALID' } });
  if ([...text].length > APPOINTMENT_DESCRIPTION_MAX) throw new AppError('VALIDATION', { fields: { description: 'TOO_LONG' } });
  return text;
}

function coordsOf(lat: number | null | undefined, lng: number | null | undefined): { lat: number | null; lng: number | null } {
  if (lat == null && lng == null) return { lat: null, lng: null };
  if (lat == null || lng == null) throw new AppError('INVALID_COORDINATES', { field: lat == null ? 'lat' : 'lng' });
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) throw new AppError('INVALID_COORDINATES', { field: 'lat' });
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) throw new AppError('INVALID_COORDINATES', { field: 'lng' });
  return { lat, lng };
}

function linkOf(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const url = parseMapUrl(raw);
  if (url === null) throw new AppError('INVALID_MAP_URL', { field: 'mapUrl' });
  return url;
}

function timeError(e: BusyInputError): AppError {
  if (e.code === 'SPAN_TOO_LONG') {
    return new AppError('LIMIT_REACHED', { field: e.field ?? 'endDate', limit: 'appointmentSpan', max: APPOINTMENT_MAX_SPAN_DAYS }, { status: 400 });
  }
  return busyInputError(e, 'timed');
}

type ScheduleInput = { startDate: string; startTime: string; endDate: string; endTime: string };
type Schedule = Pick<AppointmentWrite, 'startAt' | 'endAt' | 'tz' | 'localDate'>;

/**
 * ช่วงเวลา (ใน tz กลุ่ม): ลงตัว 30 นาที · end > start · ข้ามเที่ยงคืน/เดือน/ปีได้ · ยาวไม่เกิน 62 วัน · เริ่มย้อนหลังได้ไม่เกิน 1 ชม.
 * `currentStartAt` (แก้นัดเดิม): ตรวจย้อนหลังเฉพาะเมื่อเวลาเริ่ม "เปลี่ยนจริง" — ขยาย/แก้เวลาจบของนัดที่กำลังเกิดอยู่ได้ (QA M2) · end > start เท่านั้น ไม่บังคับ end > now
 */
function scheduleOf(v: ScheduleInput, tz: string, now: number, currentStartAt?: number): Schedule {
  const r = normalizeBusyInput({ kind: 'timed', startDate: v.startDate, startTime: v.startTime, endDate: v.endDate, endTime: v.endTime, tz }, { now });
  if (!r.ok) throw timeError(r.error);
  if (r.value.startAt !== currentStartAt && r.value.startAt < now - APPOINTMENT_MAX_BACKDATE_MS) throw new AppError('VALIDATION', { fields: { startTime: 'IN_PAST' } });
  return { startAt: r.value.startAt, endAt: r.value.endAt, tz, localDate: r.value.localStartDate };
}

function newFields(v: CreateAppointmentInput, tz: string, now: number): AppointmentWrite {
  const title = titleOf(v.title);
  const description = descriptionOf(v.description);
  const placeName = placeNameOf(v.placeName);
  const { lat, lng } = coordsOf(v.lat, v.lng);
  const mapUrl = linkOf(v.mapUrl);
  return { title, description, placeName, lat, lng, mapUrl, ...scheduleOf(v, tz, now) };
}

function patchOf(v: UpdateAppointmentInput, tz: string, now: number, currentStartAt: number): AppointmentPatch {
  const patch: AppointmentPatch = {};
  if (v.title !== undefined) patch.title = titleOf(v.title);
  if (v.description !== undefined) patch.description = descriptionOf(v.description);
  if (v.placeName !== undefined) patch.placeName = placeNameOf(v.placeName);
  if (v.lat !== undefined || v.lng !== undefined) {
    if (v.lat === undefined || v.lng === undefined) throw new AppError('INVALID_COORDINATES', { field: v.lat === undefined ? 'lat' : 'lng' });
    Object.assign(patch, coordsOf(v.lat, v.lng));
  }
  if (v.mapUrl !== undefined) patch.mapUrl = linkOf(v.mapUrl);
  if (SCHEDULE_KEYS.some((k) => v[k] !== undefined)) {
    Object.assign(patch, scheduleOf({ startDate: v.startDate!, startTime: v.startTime!, endDate: v.endDate!, endTime: v.endTime! }, tz, now, currentStartAt));
  }
  return patch;
}

// ───────── cursor / limit ─────────
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
const fromB64 = (s: string): unknown => {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

function decodeCursor(raw: string | undefined): AppointmentCursor | null {
  if (raw === undefined) return null;
  const v = fromB64(raw) as { s?: unknown; i?: unknown } | null;
  if (!v || typeof v !== 'object' || !Number.isSafeInteger(v.s) || typeof v.i !== 'string' || !z.uuid().safeParse(v.i).success) {
    throw new AppError('VALIDATION', { fields: { cursor: 'INVALID' } });
  }
  return { startAt: v.s as number, id: v.i };
}

const encodeCursor = (r: Pick<AppointmentRow, 'startAt' | 'id'>): string => b64({ s: r.startAt, i: r.id });

export function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = /^[0-9]{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) throw new AppError('VALIDATION', { fields: { limit: 'INVALID' } });
  return n;
}

// ───────── helpers ─────────
const groupRes = (group: GroupCtx) => ({ type: 'group', group }) as const;
const apptRes = (c: AppointmentCtx) => ({ type: 'appointment', group: c.group, createdBy: c.appointment?.createdBy ?? '' }) as const;

/** โหลดนัด + บริบทกลุ่ม/role ให้ can() (ADR 0003 §1) — อ่านอย่างเดียว ยังไม่คืนข้อมูลใด ๆ ก่อน authorize */
async function appointmentFor(actor: Actor, id: string, ctx: DataCtx): Promise<AppointmentCtx> {
  return loadAppointmentCtx(ctx.db, actor, id);
}

type Reader = Parameters<typeof listMembers>[0];

/**
 * myConflict ของการ์ดในรายการ (main ตัดสิน (ข)): นัด active ที่ฉันตอบ going และทับนัด going อื่นของฉัน/busy ของฉัน (ชนขอบไม่นับ)
 * ไม่มีนัดที่ฉันตอบ going ในหน้านี้ → 0 query · มี → +1 query (คำมั่นของฉันในช่วงรวมของนัดเหล่านั้น เพดาน APPOINTMENT_LIST_CONFLICT_SCAN_MAX)
 * R7 B-4: "นัดที่ฉันตอบ going" มากับแถวรายการ (viewerGoing — กติกาเดียวกับ listCurrentRsvps) จึงไม่ต้องรอ rsvps → เริ่มพร้อม query อื่น
 */
async function listConflictFlags(db: Reader, viewerId: string, rows: AppointmentRow[], goingIds: ReadonlySet<string>): Promise<Set<string>> {
  const mine = rows.filter((r) => r.status === 'active' && goingIds.has(r.id));
  const flagged = new Set<string>();
  if (mine.length === 0) return flagged;
  const from = Math.min(...mine.map((r) => r.startAt));
  const to = Math.max(...mine.map((r) => r.endAt));
  const commitments = await myCommitmentsOverlapping(db, viewerId, from, to, null, APPOINTMENT_LIST_CONFLICT_SCAN_MAX);
  for (const r of mine) {
    const hit = commitments.some((c) => !(c.kind === 'appointment' && c.id === r.id) && overlapsRange(c.startAt, c.endAt, r.startAt, r.endAt));
    if (hit) flagged.add(r.id);
  }
  return flagged;
}

/**
 * DTO รายการ (หลายกลุ่มได้) — จำนวน RSVP + ของฉัน · ไม่มีรายชื่อ · myConflict ของผู้ขอ
 * R7 B-4: ชื่อกลุ่ม+จำนวนสมาชิก (query เดียว) ∥ ชื่อคน ∥ rsvps ∥ คำมั่นของฉัน — ทุก query หลังได้แถวนัดเริ่มพร้อมกัน (1 wave)
 */
async function toListDtos(db: Reader, viewerId: string, now: number, listed: readonly ListedAppointment[]): Promise<AppointmentDto[]> {
  if (listed.length === 0) return [];
  const rows = listed.map((l) => l.row);
  const goingIds = new Set(listed.filter((l) => l.viewerGoing).map((l) => l.row.id));
  const groupIds = [...new Set(rows.map((r) => r.groupId))];
  const people = [...new Set(rows.flatMap((r) => [r.createdBy, ...(r.cancelledBy ? [r.cancelledBy] : [])]))];
  const [info, members, rsvps, conflicts] = await Promise.all([
    groupNamesAndMemberCounts(db, groupIds),
    currentMemberNames(db, groupIds, people),
    listCurrentRsvps(db, rows.map((r) => r.id)),
    listConflictFlags(db, viewerId, rows, goingIds),
  ]);
  const byGroup = new Map<string, Map<string, MemberLook>>();
  for (const m of members) {
    const g = byGroup.get(m.groupId) ?? new Map<string, MemberLook>();
    g.set(m.userId, m);
    byGroup.set(m.groupId, g);
  }
  return rows.map((r) =>
    toAppointmentDto(
      r,
      {
        viewerId,
        now,
        groupName: info.get(r.groupId)?.name ?? '',
        members: byGroup.get(r.groupId) ?? new Map(),
        memberCount: info.get(r.groupId)?.memberCount ?? 0,
        rsvps,
      },
      conflicts.has(r.id),
    ),
  );
}

/**
 * R6D (ADR 0009 §3): นัด going อื่นของฉัน (ทุกกลุ่ม) + busy ของฉัน ที่ทับนัดนี้ — ของ session user เท่านั้น · 1 query (UNION ALL)
 * นัดยกเลิก/จบแล้ว หรือผู้ดูไม่ใช่สมาชิก (super admin นอกกลุ่ม) → [] โดยไม่แตะ DB · กรองซ้ำด้วย overlapsRange (ครึ่งเปิด) · ≤ 5 + truncated
 */
async function myConflictsFor(db: Reader, me: UserActor, now: number, row: AppointmentRow, group: GroupCtx): Promise<MyConflictsDto> {
  if (row.status !== 'active' || row.endAt <= now || group.actorRole === null) return NO_CONFLICTS;
  const rows = await myCommitmentsOverlapping(db, me.id, row.startAt, row.endAt, row.id, APPOINTMENT_MY_CONFLICTS_MAX + 1);
  const hits = rows.filter((c) => !(c.kind === 'appointment' && c.id === row.id) && overlapsRange(c.startAt, c.endAt, row.startAt, row.endAt));
  return { myConflicts: hits.slice(0, APPOINTMENT_MY_CONFLICTS_MAX).map(toMyConflictDto), myConflictsTruncated: hits.length > APPOINTMENT_MY_CONFLICTS_MAX };
}

/** DTO รายละเอียด — รายชื่อ RSVP + สิทธิ์ของผู้ดู · withConflicts = คำนวณ myConflicts (เฉพาะ getAppointment / setRsvp — ADR 0009 §3) */
async function toDetailDto(
  db: Reader,
  actor: UserActor,
  now: number,
  row: AppointmentRow,
  group: GroupCtx,
  groupName: string,
  withConflicts = false,
): Promise<AppointmentDetailDto> {
  const [members, rsvps, conflicts] = await Promise.all([
    listMembers(db, row.groupId),
    listCurrentRsvps(db, [row.id]),
    withConflicts ? myConflictsFor(db, actor, now, row, group) : Promise.resolve(NO_CONFLICTS),
  ]);
  const res = { type: 'appointment', group, createdBy: row.createdBy } as const;
  const open = row.status === 'active' && row.endAt > now;
  return toAppointmentDetailDto(
    row,
    { viewerId: actor.id, now, groupName, members: new Map(members.map((m) => [m.userId, m])), memberCount: members.length, rsvps },
    {
      canEdit: open && can(actor, 'appointment.update', res).allow,
      canCancel: open && can(actor, 'appointment.cancel', res).allow,
      canRsvp: open && can(actor, 'appointment.rsvp', res).allow,
    },
    conflicts,
  );
}

/**
 * U10.1 (ADR 0005 §4 · ADR 0006 §3): สมาชิกปัจจุบันที่ busy ทับ [startAt, endAt) — ไม่บล็อก
 * busy มาจากคิวรีฝั่งแชร์ตัวเดียวกับปฏิทิน/วันว่าง (ไม่ SELECT note · title ซ่อนตัดใน SQL) และออกผ่าน serializer busy · ดึงช่วงขยาย 26 ชม. (busy ทั้งวันเก็บเที่ยงคืนใน tz เจ้าของ)
 * R6D (ADR 0009 §4): รวมนัดที่สมาชิกตอบ "ไป" (ทุกกลุ่ม) · excludeAppointmentId = นัดที่กำลังสร้าง/แก้/ตรวจ (ไม่เตือนว่าชนนัดตัวเอง)
 * busy หรือ going ถูกตัดที่ CALENDAR_MAX_ITEMS → status 'unknown' (ห้ามสรุปว่าไม่มีใครติด)
 */
async function computeOverlap(db: Reader, groupId: string, tz: string, startAt: number, endAt: number, excludeAppointmentId?: string): Promise<OverlapDto> {
  const [members, { items, truncated }] = await Promise.all([
    listMembers(db, groupId),
    loadMemberBusy(db, groupId, tz, startAt - AVAILABILITY_FETCH_MARGIN_MS, endAt + AVAILABILITY_FETCH_MARGIN_MS, excludeAppointmentId),
  ]);
  const byKey = new Map<string, MemberBusyItem>(items.map((i) => [i.key, i]));
  const order = new Map<string, number>(items.map((i, n) => [i.key, n])); // items เรียงตาม compareBusyViews แล้ว
  const hits = membersBlockedDuring(startAt, endAt, tz, members.map((m) => m.userId), items.map((i) => i.input));
  const byMember = new Map(members.map((m) => [m.userId, m]));
  return {
    status: truncated ? 'unknown' : 'ok',
    blocked: hits.map((h) => ({
      userId: h.userId,
      displayName: sanitizeDisplayText(byMember.get(h.userId)?.displayName ?? ''),
      ...memberAppearance(groupId, h.userId, byMember.get(h.userId)),
      items: h.blocks
        .map((b) => b.id)
        .sort((a, b) => order.get(a)! - order.get(b)!)
        .map((k) => byKey.get(k)!.view),
    })),
  };
}

/** เตือนนัดทับเป็นของแถม: คำนวณล้ม (ไม่ควรเกิด) ต้องไม่ทำให้คำตอบของการสร้าง/แก้ที่สำเร็จไปแล้วล้ม → unknown */
async function overlapOrUnknown(db: Reader, row: AppointmentRow): Promise<OverlapDto> {
  try {
    return await computeOverlap(db, row.groupId, row.tz, row.startAt, row.endAt, row.id);
  } catch {
    return { status: 'unknown', blocked: [] };
  }
}

/**
 * limiter เขียนต่อผู้ใช้ (SEC M1) — จองทีละถังด้วย UPSERT อะตอมมิก; ถังใดเต็ม → คืนถังที่จองไปแล้ว แล้ว RATE_LIMITED + Retry-After (ถังที่เต็มช้าสุดเป็นตัวกำหนด)
 * เรียกหลัง authorize + ตรวจ input/สถานะแล้ว (คำขอที่ถูกปฏิเสธเพราะสิทธิ์/ไม่พบ ไม่กินโควตา และไม่แยกรหัสจาก NOT_FOUND)
 */
async function takeWriteSlots(db: Parameters<typeof serialized>[0], userId: string, specs: readonly RateSpec[], now: number): Promise<void> {
  const taken: RateSpec[] = [];
  for (const spec of specs) {
    const slot = await serialized(db, () => reserveBucket(db, rateKey(spec, userId), spec.windowMs, spec.limit, now));
    if (!slot.admitted) {
      for (const t of taken) await serialized(db, () => refundBucket(db, rateKey(t, userId), t.windowMs, now));
      throw new AppError('RATE_LIMITED', undefined, { retryAfterSec: Math.max(1, Math.ceil((slot.windowEnd - now) / 1000)) });
    }
    taken.push(spec);
  }
}

const activeGuard = (me: UserActor, group: GroupCtx) => ({ actorId: me.id, actorRole: group.actorRole });

/**
 * การเขียนไม่ได้แถวทั้งที่ผ่านด่านมาแล้ว — วินิจฉัยด้วยการอ่านใหม่ (ไม่มีผลต่อความปลอดภัย: การเขียนถูกปฏิเสธไปแล้ว)
 * นัด/กลุ่มหาย หรือผู้กระทำหลุดจากกลุ่ม → NOT_FOUND · ยกเลิกแล้ว → APPOINTMENT_CANCELLED · role เปลี่ยน → CONFLICT · เต็มเพดาน → LIMIT_REACHED
 */
async function whyWriteRejected(db: Reader, actor: UserActor, id: string, before: GroupCtx, now: number): Promise<AppError> {
  const again = await loadAppointmentCtx(db, actor, id);
  if (!again.appointment || again.group.deleted) return new AppError('NOT_FOUND');
  if (again.group.actorRole === null && !actor.isSuperAdmin) return new AppError('NOT_FOUND');
  if (again.appointment.status === 'cancelled') return new AppError('APPOINTMENT_CANCELLED');
  if (again.appointment.endAt <= now) return new AppError('APPOINTMENT_PAST');
  if (again.group.actorRole !== before.actorRole) return new AppError('CONFLICT');
  return (await countActiveFutureAppointments(db, again.appointment.groupId, now)) >= APPOINTMENT_MAX_ACTIVE_PER_GROUP
    ? new AppError('LIMIT_REACHED', { limit: 'appointments', max: APPOINTMENT_MAX_ACTIVE_PER_GROUP })
    : new AppError('CONFLICT');
}

async function auditAppt(tx: Parameters<typeof audit>[0], me: UserActor, allow: Allow, action: string, row: AppointmentRow, now: number, meta: Record<string, unknown> = {}): Promise<void> {
  await audit(tx, me, allow, { action, targetType: 'appointment', targetId: row.id, groupId: row.groupId, meta: { appointmentId: row.id, ...meta } }, now);
}

// ───────── U10: สร้าง ─────────
export type AppointmentWithOverlapDto = { appointment: AppointmentDetailDto; overlap: OverlapDto };

export async function createAppointment(actor: Actor, groupId: string, input: CreateAppointmentInput, ctx: DataCtx): Promise<AppointmentWithOverlapDto> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'appointment.create', groupRes(group));
  const me = asUser(actor);
  const { db, now } = ctx;
  const groupRow = groupRowOf(group); // R7 B-3: แถวกลุ่มมากับด่านกลุ่มแล้ว
  const fields = newFields(input, groupRow.tz, now);

  await takeWriteSlots(db, me.id, [APPOINTMENT_WRITE_RATE_LIMITS.createShort, APPOINTMENT_WRITE_RATE_LIMITS.createDay], now);
  const id = newId();
  const row = await inTx(db, async (tx) => {
    const created = await insertAppointmentIfUnderCap(
      tx,
      { ...fields, id, groupId, createdBy: me.id, cap: APPOINTMENT_MAX_ACTIVE_PER_GROUP, dailyCap: APPOINTMENT_MAX_CREATED_PER_GROUP_PER_DAY },
      activeGuard(me, group),
      now,
    );
    if (!created) throw await whyCreateRejected(tx, me, groupId, group, now);
    // ผู้รับ = สมาชิกปัจจุบันทุกคนยกเว้นผู้สร้าง (super admin ที่ไม่ใช่สมาชิกไม่อยู่ในรายชื่อ) — เขียนใน transaction เดียวกัน
    const recipients = (await listMemberIds(tx, groupId)).filter((uid) => uid !== me.id);
    await notify(
      tx,
      { userIds: recipients, kind: 'appointment.created', params: { groupId, groupName: sanitizeDisplayText(groupRow.name), appointmentId: id, title: created.title, startAt: created.startAt, tz: created.tz } },
      now,
    );
    await auditAppt(tx, me, allow, 'appointment.create', created, now);
    return created;
  });

  return { appointment: await toDetailDto(db, me, now, row, group, groupRow.name), overlap: await overlapOrUnknown(db, row) };
}

async function whyCreateRejected(db: Reader, actor: UserActor, groupId: string, before: GroupCtx, now: number): Promise<AppError> {
  const again = await loadGroupCtx(db, actor, groupId);
  if (again.deleted || (again.actorRole === null && !actor.isSuperAdmin)) return new AppError('NOT_FOUND');
  if (again.actorRole !== before.actorRole) return new AppError('CONFLICT');
  if ((await countActiveFutureAppointments(db, groupId, now)) >= APPOINTMENT_MAX_ACTIVE_PER_GROUP) {
    return new AppError('LIMIT_REACHED', { limit: 'appointments', max: APPOINTMENT_MAX_ACTIVE_PER_GROUP });
  }
  return (await countCreatedLastDay(db, groupId, now)) >= APPOINTMENT_MAX_CREATED_PER_GROUP_PER_DAY
    ? new AppError('LIMIT_REACHED', { limit: 'appointmentsPerDay', max: APPOINTMENT_MAX_CREATED_PER_GROUP_PER_DAY })
    : new AppError('CONFLICT');
}

// ───────── U10.1: ตรวจนัดทับล่วงหน้า (ไม่เขียน) ─────────
export async function checkAppointmentOverlap(actor: Actor, groupId: string, input: CheckAppointmentInput, ctx: DataCtx): Promise<{ overlap: OverlapDto }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'appointment.create', groupRes(group));
  const me = asUser(actor);
  const { db, now } = ctx;
  const groupRow = groupRowOf(group); // R7 B-3: แถวกลุ่มมากับด่านกลุ่มแล้ว
  const s = scheduleOf(input, groupRow.tz, now);
  const overlap = await computeOverlap(db, groupId, s.tz, s.startAt, s.endAt, input.appointmentId);
  await auditRead(db, me, allow, { action: 'appointment.check', targetType: 'group', targetId: groupId, groupId }, now);
  return { overlap };
}

// ───────── รายการ / รายละเอียด ─────────
export type AppointmentListDto = { appointments: AppointmentDto[]; nextCursor: string | null };

export async function listGroupAppointments(actor: Actor, groupId: string, query: ListAppointmentsQuery, ctx: DataCtx): Promise<AppointmentListDto> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'appointment.view', groupRes(group));
  const me = asUser(actor);
  const { db, now } = ctx;
  const scope = query.scope ?? 'upcoming';
  if (scope !== 'upcoming' && scope !== 'past' && scope !== 'all') throw new AppError('VALIDATION', { fields: { scope: 'INVALID' } });
  const limit = parseLimit(query.limit, APPOINTMENT_LIST_DEFAULT, APPOINTMENT_LIST_MAX);
  const cursor = decodeCursor(query.cursor);
  const rows = await listGroupAppointmentRows(db, groupId, { scope: scope as AppointmentScope, now, limit: limit + 1, cursor, viewerId: me.id });
  const page = rows.slice(0, limit);
  await auditRead(db, me, allow, { action: 'appointment.view', targetType: 'group', targetId: groupId, groupId, meta: { scope } }, now);
  return {
    appointments: await toListDtos(db, me.id, now, page),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!.row) : null,
  };
}

export async function getAppointment(actor: Actor, id: string, ctx: DataCtx): Promise<{ appointment: AppointmentDetailDto }> {
  const c = await appointmentFor(actor, id, ctx);
  const allow = authorize(actor, 'appointment.view', apptRes(c));
  const me = asUser(actor);
  const row = c.appointment!;
  const { db, now } = ctx;
  await auditRead(db, me, allow, { action: 'appointment.view', targetType: 'appointment', targetId: id, groupId: row.groupId }, now);
  return { appointment: await toDetailDto(db, me, now, row, c.group, c.groupName, true) };
}

/** U11: นัด active ที่ยังไม่จบ ข้ามทุกกลุ่มของฉัน เรียงเริ่มเร็วสุดก่อน (ไม่รวมนัดที่ยกเลิก/ผ่านแล้ว/กลุ่มที่ลบ) · rsvp=going → เฉพาะที่ฉันตอบ "ไป" (R6D) */
export async function listMyAppointments(actor: Actor, query: MyAppointmentsQuery, ctx: DataCtx): Promise<{ appointments: AppointmentDto[] }> {
  authorize(actor, 'appointment.list.mine', { type: 'none' });
  const me = asUser(actor);
  const { db, now } = ctx;
  const limit = parseLimit(query.limit, APPOINTMENT_LIST_DEFAULT, APPOINTMENT_LIST_MAX);
  if (query.rsvp !== undefined && query.rsvp !== 'going') throw new AppError('VALIDATION', { fields: { rsvp: 'INVALID' } });
  const rows = await listMyUpcomingAppointmentRows(db, me.id, now, limit, { onlyGoing: query.rsvp === 'going' });
  return { appointments: await toListDtos(db, me.id, now, rows) };
}

// ───────── แก้ / ยกเลิก ─────────
export async function updateAppointment(actor: Actor, id: string, input: UpdateAppointmentInput, ctx: DataCtx): Promise<AppointmentWithOverlapDto> {
  const c = await appointmentFor(actor, id, ctx);
  const allow = authorize(actor, 'appointment.update', apptRes(c));
  const me = asUser(actor);
  const current = c.appointment!;
  const { db, now } = ctx;
  if (current.status === 'cancelled') throw new AppError('APPOINTMENT_CANCELLED');
  const groupRow = await findGroupById(db, current.groupId);
  if (!groupRow || groupRow.deletedAt !== null) throw new AppError('NOT_FOUND');
  if (current.endAt <= now) throw new AppError('APPOINTMENT_PAST'); // จบแล้วแก้ไม่ได้ (QA L1) — สอดคล้อง UI ที่ซ่อนปุ่ม
  const patch = patchOf(input, groupRow.tz, now, current.startAt);
  await takeWriteSlots(db, me.id, [APPOINTMENT_WRITE_RATE_LIMITS.update], now);

  const row = await inTx(db, async (tx) => {
    const updated = await updateAppointmentGuarded(
      tx,
      { id, groupId: current.groupId, patch, cap: APPOINTMENT_MAX_ACTIVE_PER_GROUP },
      activeGuard(me, c.group),
      now,
    );
    if (!updated) throw await whyWriteRejected(tx, me, id, c.group, now);
    await auditAppt(tx, me, allow, 'appointment.update', updated, now, { fields: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined) });
    return updated;
  });

  return { appointment: await toDetailDto(db, me, now, row, c.group, c.groupName), overlap: await overlapOrUnknown(db, row) };
}

export async function cancelAppointment(actor: Actor, id: string, ctx: DataCtx): Promise<{ appointment: AppointmentDetailDto }> {
  const c = await appointmentFor(actor, id, ctx);
  const allow = authorize(actor, 'appointment.cancel', apptRes(c));
  const me = asUser(actor);
  const current = c.appointment!;
  const { db, now } = ctx;
  if (current.status === 'cancelled') throw new AppError('APPOINTMENT_CANCELLED');
  if (current.endAt <= now) throw new AppError('APPOINTMENT_PAST'); // จบแล้วยกเลิกไม่ได้ (QA L1)
  await takeWriteSlots(db, me.id, [APPOINTMENT_WRITE_RATE_LIMITS.cancel], now);

  const row = await inTx(db, async (tx) => {
    const cancelled = await cancelAppointmentGuarded(tx, { id, groupId: current.groupId, cancelledBy: me.id }, activeGuard(me, c.group), now);
    if (!cancelled) throw await whyWriteRejected(tx, me, id, c.group, now);
    await auditAppt(tx, me, allow, 'appointment.cancel', cancelled, now);
    return cancelled;
  });
  return { appointment: await toDetailDto(db, me, now, row, c.group, c.groupName) };
}

// ───────── RSVP ─────────
export async function setRsvp(actor: Actor, id: string, input: RsvpInput, ctx: DataCtx): Promise<{ appointment: AppointmentDetailDto }> {
  const c = await appointmentFor(actor, id, ctx);
  authorize(actor, 'appointment.rsvp', apptRes(c));
  const me = asUser(actor);
  const current = c.appointment!;
  const { db, now } = ctx;
  if (current.status === 'cancelled') throw new AppError('APPOINTMENT_CANCELLED');
  if (current.endAt <= now) throw new AppError('APPOINTMENT_PAST');
  await takeWriteSlots(db, me.id, [APPOINTMENT_WRITE_RATE_LIMITS.rsvp], now);

  await inTx(db, async (tx) => {
    const ok = await upsertRsvpIfOpen(tx, { appointmentId: id, userId: me.id, response: input.response }, now);
    if (!ok) throw await whyRsvpRejected(tx, me, id, now);
  });
  // R7 B-4: ไม่อ่าน access ซ้ำหลัง commit — upsert สำเร็จ ⇒ ในคำสั่งเดียวกันนัดยัง active/ยังไม่จบ · กลุ่มยังอยู่ · ฉันยังเป็นสมาชิก
  // RSVP ไม่แตะแถวนัด จึงใช้แถว/บริบทที่อ่านไว้ก่อนเขียนได้ · คำตอบของทุกคน (รวมที่เพิ่งเข้ามา) + สมาชิก + myConflicts ยังอ่านใหม่ใน toDetailDto
  return { appointment: await toDetailDto(db, me, now, current, c.group, c.groupName, true) };
}

async function whyRsvpRejected(db: Reader, actor: UserActor, id: string, now: number): Promise<AppError> {
  const again = await loadAppointmentCtx(db, actor, id);
  if (!again.appointment || again.group.deleted || again.group.actorRole === null) return new AppError('NOT_FOUND');
  if (again.appointment.status === 'cancelled') return new AppError('APPOINTMENT_CANCELLED');
  if (again.appointment.endAt <= now) return new AppError('APPOINTMENT_PAST');
  return new AppError('CONFLICT');
}
