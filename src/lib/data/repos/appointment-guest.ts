// repo: แขกของนัด (appointment_guest) — R18 §S4–S7 · ADR 0016 §2.2, §2.4, §5.3, §7
// "แขกที่มีผล" = removed_at IS NULL — ทุกคิวรีในไฟล์นี้ที่อ่าน/นับแขกมีเงื่อนไขนี้ (ยกเว้นที่ระบุว่าอ่านแถวที่ถูกนำออก)
// คำตอบ RSVP ของแขกอยู่ในแถวนี้ (ไม่ใช่ appointment_rsvp) — คิวรีของสมาชิกที่ join group_member จึงไม่นับแขกโดยบังเอิญ
// เลือกคอลัมน์แบบ allowlist ทุกคิวรี (ไม่ SELECT * ไปถึง serializer)
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import type { AppointmentRow, RsvpResponse } from './appointment';
import { actorGuardClause, type ActorGuard } from './group-member';

/** แขกที่มีผลของนัด + ชื่อ + ผู้ชวน — หน้านัดของสมาชิก (S6) · เรียงตามเวลาเข้า */
export type GuestListRow = { userId: string; displayName: string; response: RsvpResponse | null; invitedBy: string | null; joinedAt: number };

export async function listGuestsOfAppointment(db: DbOrTx, appointmentId: string): Promise<GuestListRow[]> {
  const rows = await db.all<{ user_id: string; display_name: string; response: RsvpResponse | null; invited_by: string | null; joined_at: number }>(sql`
    SELECT ag.user_id AS user_id, u.display_name AS display_name, ag.response AS response, ag.invited_by AS invited_by, ag.joined_at AS joined_at
      FROM appointment_guest ag JOIN "user" u ON u.id = ag.user_id
     WHERE ag.appointment_id = ${appointmentId} AND ag.removed_at IS NULL
     ORDER BY ag.joined_at, ag.user_id`);
  return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, response: r.response, invitedBy: r.invited_by, joinedAt: Number(r.joined_at) }));
}

/** แขกเป้าหมายที่มีผล (นำออกได้) · ไม่มี/ถูกนำออกแล้ว → null */
export async function findActiveGuest(db: DbOrTx, appointmentId: string, userId: string): Promise<{ invitedBy: string | null; response: RsvpResponse | null } | null> {
  const rows = await db.all<{ invited_by: string | null; response: RsvpResponse | null }>(sql`
    SELECT invited_by, response FROM appointment_guest WHERE appointment_id = ${appointmentId} AND user_id = ${userId} AND removed_at IS NULL`);
  const r = rows[0];
  return r ? { invitedBy: r.invited_by, response: r.response } : null;
}

/**
 * ข้อมูลมุมมองแขกของผู้ใช้ต่อนัด — คำตอบของตัวเอง + ชื่อผู้ชวน "เฉพาะถ้ายังเป็นสมาชิกของกลุ่มนัด" (ไม่งั้น null — กติกาเดียวกับ createdBy)
 * ผู้เรียกผ่านด่าน appointment.guest.* มาแล้ว · ไม่มีแถวที่มีผล → null
 */
export async function findGuestView(db: DbOrTx, appointmentId: string, userId: string): Promise<{ response: RsvpResponse | null; inviterName: string | null } | null> {
  const rows = await db.all<{ response: RsvpResponse | null; inviter_name: string | null }>(sql`
    SELECT ag.response AS response,
           (SELECT iu.display_name FROM group_member im JOIN "user" iu ON iu.id = im.user_id
             WHERE im.group_id = a.group_id AND im.user_id = ag.invited_by) AS inviter_name
      FROM appointment_guest ag JOIN appointment a ON a.id = ag.appointment_id
     WHERE ag.appointment_id = ${appointmentId} AND ag.user_id = ${userId} AND ag.removed_at IS NULL`);
  const r = rows[0];
  return r ? { response: r.response, inviterName: r.inviter_name } : null;
}

/**
 * แขกตอบ RSVP — UPDATE คำสั่งเดียว เปิดเฉพาะ: แถวที่มีผล + นัด active + ยังไม่จบ + กลุ่มไม่ลบ + ผู้ตอบไม่ใช่สมาชิกของกลุ่มนัด
 * คืน false = เงื่อนไขไม่ผ่าน (ผู้เรียกวินิจฉัยต่อ)
 */
export async function setGuestResponseIfOpen(db: DbOrTx, input: { appointmentId: string; userId: string; response: RsvpResponse }, now: number): Promise<boolean> {
  const rows = await db.all<{ user_id: string }>(sql`
    UPDATE appointment_guest SET response = ${input.response}, responded_at = ${now}
     WHERE appointment_id = ${input.appointmentId} AND user_id = ${input.userId} AND removed_at IS NULL
       AND EXISTS (SELECT 1 FROM appointment a JOIN groups g ON g.id = a.group_id
                    WHERE a.id = appointment_guest.appointment_id AND a.status = 'active' AND a.end_at > ${now} AND g.deleted_at IS NULL
                      AND NOT EXISTS (SELECT 1 FROM group_member m WHERE m.group_id = a.group_id AND m.user_id = appointment_guest.user_id))
    RETURNING user_id`);
  return rows.length === 1;
}

/** แขกออกเอง (S4) — ลบแถวที่มีผล (คำตอบหายไปด้วย) → กลับเข้าได้อีกด้วยลิงก์ที่ยังใช้ได้ · คืน false = ไม่มีแถว */
export async function deleteGuestSelf(db: DbOrTx, appointmentId: string, userId: string): Promise<boolean> {
  const rows = await db.all<{ user_id: string }>(sql`
    DELETE FROM appointment_guest WHERE appointment_id = ${appointmentId} AND user_id = ${userId} AND removed_at IS NULL RETURNING user_id`);
  return rows.length === 1;
}

/**
 * สมาชิกนำแขกออก (S6) — ไม่ลบแถว: ตั้ง removed_at/removed_by + ล้างคำตอบในคำสั่งเดียว (แถวนี้กันการกลับเข้านัดนี้ทุกลิงก์)
 * เงื่อนไข: แถวที่มีผล + กลุ่มยังอยู่ + ผู้กระทำยังถือ role เดิม · คืน false = เงื่อนไขไม่ผ่าน
 */
export async function markGuestRemovedGuarded(
  db: DbOrTx,
  input: { appointmentId: string; userId: string; groupId: string; removedBy: string },
  guard: ActorGuard,
  now: number,
): Promise<boolean> {
  const rows = await db.all<{ user_id: string }>(sql`
    UPDATE appointment_guest SET removed_at = ${now}, removed_by = ${input.removedBy}, response = NULL, responded_at = NULL
     WHERE appointment_id = ${input.appointmentId} AND user_id = ${input.userId} AND removed_at IS NULL
       AND EXISTS (SELECT 1 FROM groups WHERE id = ${input.groupId} AND deleted_at IS NULL)
       AND ${actorGuardClause(input.groupId, guard)}
    RETURNING user_id`);
  return rows.length === 1;
}

/** แขกที่มีผลของนัด (บัญชี active) + คำตอบ — ผู้รับแจ้งเตือนแก้/ยกเลิกนัด (ADR 0016 §7.2) */
export async function listActiveGuestAudience(db: DbOrTx, appointmentId: string): Promise<{ userId: string; response: RsvpResponse | null }[]> {
  const rows = await db.all<{ user_id: string; response: RsvpResponse | null }>(sql`
    SELECT ag.user_id AS user_id, ag.response AS response
      FROM appointment_guest ag JOIN "user" u ON u.id = ag.user_id AND u.status = 'active'
     WHERE ag.appointment_id = ${appointmentId} AND ag.removed_at IS NULL
     ORDER BY ag.user_id`);
  return rows.map((r) => ({ userId: r.user_id, response: r.response }));
}

/**
 * ADR 0016 §8.4: แขกเข้าเป็นสมาชิกของกลุ่มนัด (โค้ด/คำเชิญตรง) — เรียกใน tx เดียวกับการได้แถวสมาชิก
 * ย้ายคำตอบที่มีของแถวที่มีผลไปเป็น RSVP สมาชิก (updated_at = now >= joined_at จึงนับ) แล้วลบเฉพาะแถวแขกที่มีผล (removed_at IS NULL)
 * แถวที่ถูกนำออก **คงไว้** (security-v1 Info 2 · main 2026-11-2x): ตัวกันกลับเข้านัดนั้นต้องอยู่รอด แม้เข้ากลุ่มแล้วออกภายหลัง
 *   ระหว่างเป็นสมาชิก แถวนี้ไม่มีผล (ทุกคิวรีฝั่งแขกกรอง removed_at IS NULL · join ตอบ 'member' ก่อนดูแถวนี้) · ลบเมื่อลบบัญชี/ลบกลุ่มถาวร/นัดถูกลบ
 * คืนจำนวนแถวแขกที่ลบ
 */
export async function convertGuestRowsToMember(db: DbOrTx, userId: string, groupId: string, now: number): Promise<number> {
  await db.run(sql`
    INSERT INTO appointment_rsvp (appointment_id, user_id, response, updated_at)
    SELECT ag.appointment_id, ag.user_id, ag.response, ${now}
      FROM appointment_guest ag JOIN appointment a ON a.id = ag.appointment_id
     WHERE ag.user_id = ${userId} AND a.group_id = ${groupId} AND ag.removed_at IS NULL AND ag.response IS NOT NULL
    ON CONFLICT (appointment_id, user_id) DO UPDATE SET response = excluded.response, updated_at = excluded.updated_at`);
  const res = await db.run(sql`
    DELETE FROM appointment_guest WHERE user_id = ${userId} AND removed_at IS NULL AND appointment_id IN (SELECT id FROM appointment WHERE group_id = ${groupId})`);
  return res.rowsAffected;
}

/**
 * ยอดไป/อาจไป ต่อนัด = สมาชิกปัจจุบัน (กติกา listCurrentRsvps) + แขกที่มีผล — มุมมองแขก (ไม่มี not_going / ยังไม่ตอบ / จำนวนสมาชิก)
 * คิวรีเดียวแบบ scalar subquery ต่อนัด
 */
export type GoingMaybe = { going: number; maybe: number };

const count = (response: 'going' | 'maybe'): SQL => sql`(
  (SELECT count(*) FROM appointment_rsvp r
     JOIN group_member rm ON rm.group_id = a.group_id AND rm.user_id = r.user_id AND r.updated_at >= rm.joined_at
     JOIN "user" ru ON ru.id = r.user_id
    WHERE r.appointment_id = a.id AND r.response = ${response})
  + (SELECT count(*) FROM appointment_guest cg WHERE cg.appointment_id = a.id AND cg.removed_at IS NULL AND cg.response = ${response}))`;

export async function goingMaybeCounts(db: DbOrTx, appointmentIds: readonly string[]): Promise<Map<string, GoingMaybe>> {
  if (appointmentIds.length === 0) return new Map();
  const ids = sql.join(
    appointmentIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.all<{ id: string; going: number; maybe: number }>(sql`
    SELECT a.id AS id, ${count('going')} AS going, ${count('maybe')} AS maybe FROM appointment a WHERE a.id IN (${ids})`);
  return new Map(rows.map((r) => [r.id, { going: Number(r.going), maybe: Number(r.maybe) }]));
}

/** แถวนัดที่ฉันเป็นแขก (รายการ "นัดของฉัน") — นัด active + ยังไม่จบ + กลุ่มไม่ลบ · onlyGoing = ตอบ going */
export type GuestListedAppointment = {
  row: AppointmentRow;
  groupName: string;
  groupIcon: string | null;
  response: RsvpResponse | null;
  inviterName: string | null;
};

type ApptRaw = {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  map_url: string | null;
  start_at: number;
  end_at: number;
  tz: string;
  local_date: string;
  status: 'active' | 'cancelled';
  created_by: string;
  created_at: number;
  updated_at: number;
  cancelled_at: number | null;
  cancelled_by: string | null;
  scheduled_at: number;
};

/** คอลัมน์ของนัดที่ฝั่งแขกอ่าน — ครบรูป AppointmentRow (serializer แขกเลือกเฉพาะที่ส่งออกเองอีกชั้น) */
const APPT_COLS = sql`a.id AS id, a.group_id AS group_id, a.title AS title, a.description AS description, a.place_name AS place_name,
  a.lat AS lat, a.lng AS lng, a.map_url AS map_url, a.start_at AS start_at, a.end_at AS end_at, a.tz AS tz, a.local_date AS local_date,
  a.status AS status, a.created_by AS created_by, a.created_at AS created_at, a.updated_at AS updated_at,
  a.cancelled_at AS cancelled_at, a.cancelled_by AS cancelled_by, a.scheduled_at AS scheduled_at`;

const toRow = (r: ApptRaw): AppointmentRow => ({
  id: r.id,
  groupId: r.group_id,
  title: r.title,
  description: r.description,
  placeName: r.place_name,
  lat: r.lat === null ? null : Number(r.lat),
  lng: r.lng === null ? null : Number(r.lng),
  mapUrl: r.map_url,
  startAt: Number(r.start_at),
  endAt: Number(r.end_at),
  tz: r.tz,
  localDate: r.local_date,
  status: r.status,
  createdBy: r.created_by,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  cancelledAt: r.cancelled_at === null ? null : Number(r.cancelled_at),
  cancelledBy: r.cancelled_by,
  scheduledAt: Number(r.scheduled_at),
});

export async function listMyGuestAppointmentRows(db: DbOrTx, userId: string, now: number, limit: number, opts: { onlyGoing?: boolean } = {}): Promise<GuestListedAppointment[]> {
  const going = opts.onlyGoing ? sql` AND ag.response = 'going'` : sql``;
  const rows = await db.all<ApptRaw & { group_name: string; group_icon: string | null; response: RsvpResponse | null; inviter_name: string | null }>(sql`
    SELECT ${APPT_COLS}, g.name AS group_name, g.icon AS group_icon, ag.response AS response,
           (SELECT iu.display_name FROM group_member im JOIN "user" iu ON iu.id = im.user_id
             WHERE im.group_id = a.group_id AND im.user_id = ag.invited_by) AS inviter_name
      FROM appointment_guest ag
      JOIN appointment a ON a.id = ag.appointment_id AND a.status = 'active' AND a.end_at > ${now}
      JOIN groups g ON g.id = a.group_id AND g.deleted_at IS NULL
     WHERE ag.user_id = ${userId} AND ag.removed_at IS NULL${going}
     ORDER BY a.start_at, a.id
     LIMIT ${limit}`);
  return rows.map((r) => ({ row: toRow(r), groupName: r.group_name, groupIcon: r.group_icon, response: r.response, inviterName: r.inviter_name }));
}

/**
 * ADR 0016 §5.3 [A]: นัดที่สมาชิกของกลุ่ม groupId เป็น "แขก" และตอบ going → ไม่ว่างในกลุ่มของตัวเอง (เหมือนนัดกลุ่มอื่น)
 * แถวออกเป็น "กลุ่มอื่น" เสมอ: same_group = 0 · id/title เป็น NULL ตั้งแต่ใน SQL · a.group_id <> :gid (ในกลุ่มเจ้าของนัด แขกไม่ใช่สมาชิก)
 * เงื่อนไข: แถวที่มีผล · นัด active · กลุ่มนัดไม่ลบ · ทับ [fromMs, toMs) แบบครึ่งเปิด · ผู้เรียกผ่านด่านกลุ่มมาแล้ว
 * ไม่ SELECT title/place/lat/lng/map_url/description/group_id/tz ของนัด
 */
export function guestGoingBusyInGroupSql(groupId: string, fromMs: number, toMs: number, limit: number): SQL {
  return sql`
    SELECT ag.user_id AS user_id, a.start_at AS start_at, a.end_at AS end_at
      FROM group_member gvm
      JOIN appointment_guest ag ON ag.user_id = gvm.user_id AND ag.removed_at IS NULL AND ag.response = 'going'
      JOIN appointment a ON a.id = ag.appointment_id AND a.status = 'active' AND a.start_at < ${toMs} AND a.end_at > ${fromMs} AND a.group_id <> ${groupId}
      JOIN groups g ON g.id = a.group_id AND g.deleted_at IS NULL
     WHERE gvm.group_id = ${groupId}
     ORDER BY a.start_at, a.end_at, ag.user_id, a.id
     LIMIT ${limit}`;
}

export async function listGuestGoingBusyInGroup(db: DbOrTx, groupId: string, fromMs: number, toMs: number, limit: number): Promise<{ userId: string; startAt: number; endAt: number }[]> {
  const rows = await db.all<{ user_id: string; start_at: number; end_at: number }>(guestGoingBusyInGroupSql(groupId, fromMs, toMs, limit));
  return rows.map((r) => ({ userId: r.user_id, startAt: Number(r.start_at), endAt: Number(r.end_at) }));
}
