// repo: ลิงก์ชวนนัด (appointment_share_link) + การเข้าเป็นแขกด้วยลิงก์ — R18 §S · ADR 0016 §2.3, §6
// query ล้วน ไม่รู้จัก actor · เวลา = now ที่ผู้เรียก inject · ไม่มี token ดิบในชั้นนี้ (รับ/คืนเฉพาะ token_hash ภายใน)
//
// ลิงก์ L ของนัด A ในกลุ่ม G "ใช้ได้" ณ now ⇔ (ADR 0016 §2.3 — เขียนที่เดียวในไฟล์นี้ ใช้ทั้ง preview / join / สร้าง):
//   ถูกต้อง (ไม่ผ่าน = 404 SHARE_LINK_INVALID): L.revoked_at IS NULL · ผู้สร้างยังเป็นสมาชิกของ G ตั้งแต่ก่อนสร้างลิงก์ (joined_at <= L.created_at) · บัญชีผู้สร้าง active
//   ยังเปิด  (ไม่ผ่าน = 410 SHARE_LINK_EXPIRED): A.status = 'active' · A.end_at > now · G.deleted_at IS NULL
// คิวรีอ้าง alias l = appointment_share_link · a = appointment · g = groups เสมอ
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import type { GroupRole } from './group';
import { actorGuardClause, type ActorGuard } from './group-member';

/** ลิงก์ถูกต้อง (ยังไม่ถูกยกเลิก + ผู้สร้างยังเป็นสมาชิกรอบเดิม + บัญชี active) */
export const linkIntactSql: SQL = sql`(l.revoked_at IS NULL AND EXISTS (
  SELECT 1 FROM group_member lcm JOIN "user" lcu ON lcu.id = lcm.user_id
   WHERE lcm.group_id = a.group_id AND lcm.user_id = l.created_by AND lcm.joined_at <= l.created_at AND lcu.status = 'active'))`;

/** นัดยังเปิด + กลุ่มยังไม่ถูกลบ */
export const linkOpenSql = (now: number): SQL => sql`(a.status = 'active' AND a.end_at > ${now} AND g.deleted_at IS NULL)`;

/** ลิงก์ใช้ได้ทั้งหมด */
export const linkUsableSql = (now: number): SQL => sql`(${linkIntactSql} AND ${linkOpenSql(now)})`;

export type ShareLinkRow = { id: string; appointmentId: string; createdBy: string; createdAt: number };

type LinkRaw = { id: string; appointment_id: string; created_by: string; created_at: number };
const toLink = (r: LinkRaw): ShareLinkRow => ({ id: r.id, appointmentId: r.appointment_id, createdBy: r.created_by, createdAt: Number(r.created_at) });

/**
 * get-or-create (S1): สร้างลิงก์ใหม่ถ้า นัด active + ยังไม่จบ + กลุ่มไม่ลบ + ผู้สร้างเป็นสมาชิกที่บัญชี active — คำสั่งเดียว
 * มีลิงก์ที่ยังไม่ถูกยกเลิกของคนนี้ในนัดนี้อยู่แล้ว → ไม่สร้าง (partial unique index share_link_one_active_uq → DO NOTHING)
 * คืน true = สร้างแถวใหม่ · false = ไม่สร้าง (มีอยู่แล้ว หรือเงื่อนไขไม่ผ่าน — ผู้เรียกอ่าน findActiveShareLinkOf แล้ววินิจฉัย)
 */
export async function insertShareLinkIfAllowed(
  db: DbOrTx,
  input: { id: string; appointmentId: string; createdBy: string; tokenHash: string },
  now: number,
): Promise<boolean> {
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO appointment_share_link (id, appointment_id, created_by, token_hash, created_at)
    SELECT ${input.id}, a.id, ${input.createdBy}, ${input.tokenHash}, ${now}
      FROM appointment a JOIN groups g ON g.id = a.group_id
     WHERE a.id = ${input.appointmentId} AND a.status = 'active' AND a.end_at > ${now} AND g.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM group_member m JOIN "user" u ON u.id = m.user_id
                    WHERE m.group_id = a.group_id AND m.user_id = ${input.createdBy} AND u.status = 'active')
    ON CONFLICT (appointment_id, created_by) WHERE revoked_at IS NULL DO NOTHING
    RETURNING id`);
  return rows.length === 1;
}

/** ลิงก์ที่ยังไม่ถูกยกเลิกของผู้ใช้ในนัดนี้ (มีได้ไม่เกิน 1) */
export async function findActiveShareLinkOf(db: DbOrTx, appointmentId: string, createdBy: string): Promise<ShareLinkRow | null> {
  const rows = await db.all<LinkRaw>(sql`
    SELECT id, appointment_id, created_by, created_at FROM appointment_share_link
     WHERE appointment_id = ${appointmentId} AND created_by = ${createdBy} AND revoked_at IS NULL LIMIT 1`);
  return rows[0] ? toLink(rows[0]) : null;
}

export type ShareLinkAccessRow = {
  link: ShareLinkRow;
  groupId: string;
  appointmentCreatedBy: string;
  groupDeleted: boolean;
  /** role ของผู้ดูในกลุ่มของนัด · null = ไม่ใช่สมาชิก */
  role: GroupRole | null;
};

/**
 * policy-context ของ appointment.share.revoke: ลิงก์ (ยังไม่ถูกยกเลิก) ที่เป็นของนัด :id เท่านั้น + กลุ่ม + role ของผู้ดู — query เดียว
 * ลิงก์ของนัดอื่น / ถูกยกเลิกแล้ว / ไม่มี → null (ผู้เรียกส่ง goneGroupCtx → NOT_FOUND เหมือนคนนอก)
 */
export async function findShareLinkAccess(db: DbOrTx, appointmentId: string, linkId: string, userId: string): Promise<ShareLinkAccessRow | null> {
  const rows = await db.all<LinkRaw & { group_id: string; appt_created_by: string; deleted_at: number | null; role: GroupRole | null }>(sql`
    SELECT l.id AS id, l.appointment_id AS appointment_id, l.created_by AS created_by, l.created_at AS created_at,
           a.group_id AS group_id, a.created_by AS appt_created_by, g.deleted_at AS deleted_at, m.role AS role
      FROM appointment_share_link l
      JOIN appointment a ON a.id = l.appointment_id
      JOIN groups g ON g.id = a.group_id
      LEFT JOIN group_member m ON m.group_id = a.group_id AND m.user_id = ${userId}
     WHERE l.id = ${linkId} AND l.appointment_id = ${appointmentId} AND l.revoked_at IS NULL
     LIMIT 1`);
  const r = rows[0];
  if (!r) return null;
  return { link: toLink(r), groupId: r.group_id, appointmentCreatedBy: r.appt_created_by, groupDeleted: r.deleted_at !== null, role: r.role };
}

/** ยกเลิกลิงก์ด้วยมือ — คำสั่งเดียว: ยังไม่ถูกยกเลิก + เป็นของนัดนี้ + กลุ่มยังอยู่ + ผู้กระทำยังถือ role เดิม · คืน false = เงื่อนไขไม่ผ่าน */
export async function revokeShareLinkGuarded(
  db: DbOrTx,
  input: { linkId: string; appointmentId: string; groupId: string; revokedBy: string },
  guard: ActorGuard,
  now: number,
): Promise<boolean> {
  const rows = await db.all<{ id: string }>(sql`
    UPDATE appointment_share_link SET revoked_at = ${now}, revoked_by = ${input.revokedBy}
     WHERE id = ${input.linkId} AND appointment_id = ${input.appointmentId} AND revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM groups WHERE id = ${input.groupId} AND deleted_at IS NULL)
       AND ${actorGuardClause(input.groupId, guard)}
    RETURNING id`);
  return rows.length === 1;
}

/**
 * สมาชิกออก/ถูกลบจากกลุ่ม (ADR 0016 §7.1): ลิงก์ที่เขาสร้างในนัดของกลุ่มนั้นที่ยังไม่ถูกยกเลิก → revoked (ผู้กระทำ = revokedBy)
 * เรียกใน tx เดียวกับการลบแถวสมาชิก (ถัดจาก revokeActiveInvitesCreatedBy) · แขกที่เข้ามาแล้วอยู่ต่อ · คืนจำนวน
 */
export async function revokeActiveShareLinksCreatedBy(db: DbOrTx, groupId: string, createdBy: string, revokedBy: string, now: number): Promise<number> {
  const rows = await db.all<{ id: string }>(sql`
    UPDATE appointment_share_link SET revoked_at = ${now}, revoked_by = ${revokedBy}
     WHERE created_by = ${createdBy} AND revoked_at IS NULL
       AND appointment_id IN (SELECT id FROM appointment WHERE group_id = ${groupId})
    RETURNING id`);
  return rows.length;
}

/** ลิงก์ที่ยังไม่ถูกยกเลิกของนัด + จำนวนแขก (ที่มีผล) ที่เข้าทางลิงก์นั้น — หน้านัดของสมาชิก (ผู้เรียกกรองด้วย can share.revoke) */
export type ShareLinkListRow = ShareLinkRow & { guestsJoined: number };

export async function listShareLinksOfAppointment(db: DbOrTx, appointmentId: string): Promise<ShareLinkListRow[]> {
  const rows = await db.all<LinkRaw & { n: number }>(sql`
    SELECT l.id AS id, l.appointment_id AS appointment_id, l.created_by AS created_by, l.created_at AS created_at,
           (SELECT count(*) FROM appointment_guest ag WHERE ag.link_id = l.id AND ag.removed_at IS NULL) AS n
      FROM appointment_share_link l
     WHERE l.appointment_id = ${appointmentId} AND l.revoked_at IS NULL
     ORDER BY l.created_at, l.id`);
  return rows.map((r) => ({ ...toLink(r), guestsJoined: Number(r.n) }));
}

// ───────── หน้าเปิดลิงก์ / การเข้าเป็นแขก ─────────

/**
 * ทุกอย่างที่หน้า /i/<token> และการวินิจฉัย join ต้องใช้ — คิวรีเดียว · เลือกคอลัมน์แบบ allowlist (ไม่มี description / created_by ของนัด / รายชื่อ)
 * counts = สมาชิกปัจจุบัน (กติกา listCurrentRsvps: updated_at >= joined_at) + แขกที่มีผล · เฉพาะ going / maybe
 * viewer* = ของผู้เปิด (ถ้าล็อกอิน) — สมาชิกของกลุ่มนัด / แถวแขก (active | removed)
 */
export type ShareLookupRow = {
  linkId: string;
  linkCreatedBy: string;
  intact: boolean;
  open: boolean;
  appointmentId: string;
  groupId: string;
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
  inviterName: string;
  activeGuests: number;
  going: number;
  maybe: number;
  viewerIsMember: boolean;
  viewerGuest: 'active' | 'removed' | null;
};

const countWith = (response: 'going' | 'maybe'): SQL => sql`(
  (SELECT count(*) FROM appointment_rsvp r
     JOIN group_member rm ON rm.group_id = a.group_id AND rm.user_id = r.user_id AND r.updated_at >= rm.joined_at
     JOIN "user" ru ON ru.id = r.user_id
    WHERE r.appointment_id = a.id AND r.response = ${response})
  + (SELECT count(*) FROM appointment_guest cg WHERE cg.appointment_id = a.id AND cg.removed_at IS NULL AND cg.response = ${response}))`;

export async function findShareByTokenHash(db: DbOrTx, tokenHash: string, viewerId: string | null, now: number): Promise<ShareLookupRow | null> {
  const viewer = viewerId ?? '';
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT l.id AS link_id, l.created_by AS link_created_by,
           ${linkIntactSql} AS is_intact, ${linkOpenSql(now)} AS is_open,
           a.id AS appointment_id, a.group_id AS group_id, a.title AS title, a.start_at AS start_at, a.end_at AS end_at, a.tz AS tz,
           a.local_date AS local_date, a.place_name AS place_name, a.lat AS lat, a.lng AS lng, a.map_url AS map_url,
           g.name AS group_name, g.icon AS group_icon,
           (SELECT iu.display_name FROM "user" iu WHERE iu.id = l.created_by) AS inviter_name,
           (SELECT count(*) FROM appointment_guest ag WHERE ag.appointment_id = a.id AND ag.removed_at IS NULL) AS active_guests,
           ${countWith('going')} AS going, ${countWith('maybe')} AS maybe,
           EXISTS (SELECT 1 FROM group_member vm WHERE vm.group_id = a.group_id AND vm.user_id = ${viewer}) AS viewer_member,
           (SELECT CASE WHEN vg.removed_at IS NULL THEN 'active' ELSE 'removed' END FROM appointment_guest vg
             WHERE vg.appointment_id = a.id AND vg.user_id = ${viewer}) AS viewer_guest
      FROM appointment_share_link l
      JOIN appointment a ON a.id = l.appointment_id
      JOIN groups g ON g.id = a.group_id
     WHERE l.token_hash = ${tokenHash}
     LIMIT 1`);
  const r = rows[0];
  if (!r) return null;
  const num = (v: unknown) => Number(v);
  const optNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    linkId: String(r.link_id),
    linkCreatedBy: String(r.link_created_by),
    intact: num(r.is_intact) === 1,
    open: num(r.is_open) === 1,
    appointmentId: String(r.appointment_id),
    groupId: String(r.group_id),
    title: String(r.title),
    startAt: num(r.start_at),
    endAt: num(r.end_at),
    tz: String(r.tz),
    localDate: String(r.local_date),
    placeName: r.place_name === null ? null : String(r.place_name),
    lat: optNum(r.lat),
    lng: optNum(r.lng),
    mapUrl: r.map_url === null ? null : String(r.map_url),
    groupName: String(r.group_name),
    groupIcon: r.group_icon === null ? null : String(r.group_icon),
    inviterName: r.inviter_name === null ? '' : String(r.inviter_name),
    activeGuests: num(r.active_guests),
    going: num(r.going),
    maybe: num(r.maybe),
    viewerIsMember: viewerId !== null && num(r.viewer_member) === 1,
    viewerGuest: viewerId === null || r.viewer_guest === null ? null : r.viewer_guest === 'active' ? 'active' : 'removed',
  };
}

export type JoinedGuest = { appointmentId: string; groupId: string; linkId: string; invitedBy: string };

/**
 * เข้าเป็นแขก (S4/S5) — INSERT … SELECT เดียว: ลิงก์ใช้ได้ (§2.3) + ผู้เข้าบัญชี active + ไม่ใช่สมาชิกของกลุ่มนัด + แขกที่มีผล < max
 * เพดานอยู่ในคำสั่งเดียวกับการเพิ่ม (รันใน inTx = BEGIN IMMEDIATE) → แข่งช่องสุดท้าย: คนที่สองเห็นครบแล้วจึงไม่ได้แถว
 * แถวที่ถูกนำออก (removed_at) ไม่นับเพดาน แต่ยังชน PK → DO NOTHING = กันกลับเข้านัดนี้ทุกลิงก์
 * คืนแถวที่สร้าง หรือ null (ผู้เรียกวินิจฉัยด้วย findShareByTokenHash ในธุรกรรมเดียวกัน)
 */
export async function insertGuestIfAllowed(
  db: DbOrTx,
  input: { tokenHash: string; userId: string; max: number },
  now: number,
): Promise<JoinedGuest | null> {
  const rows = await db.all<{ appointment_id: string; link_id: string | null; invited_by: string | null }>(sql`
    INSERT INTO appointment_guest (appointment_id, user_id, invited_by, link_id, joined_at)
    SELECT a.id, ${input.userId}, l.created_by, l.id, ${now}
      FROM appointment_share_link l
      JOIN appointment a ON a.id = l.appointment_id
      JOIN groups g ON g.id = a.group_id
     WHERE l.token_hash = ${input.tokenHash} AND ${linkUsableSql(now)}
       AND EXISTS (SELECT 1 FROM "user" ju WHERE ju.id = ${input.userId} AND ju.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM group_member jm WHERE jm.group_id = a.group_id AND jm.user_id = ${input.userId})
       AND (SELECT count(*) FROM appointment_guest jg WHERE jg.appointment_id = a.id AND jg.removed_at IS NULL) < ${input.max}
    ON CONFLICT (appointment_id, user_id) DO NOTHING
    RETURNING appointment_id, link_id, invited_by`);
  const r = rows[0];
  if (!r) return null;
  const groups = await db.all<{ group_id: string }>(sql`SELECT group_id FROM appointment WHERE id = ${r.appointment_id}`);
  return { appointmentId: r.appointment_id, groupId: groups[0]?.group_id ?? '', linkId: r.link_id ?? '', invitedBy: r.invited_by ?? '' };
}

// ───────── วงจรข้อมูล ─────────

/**
 * R18 §S7 / ADR 0016 §7.5: ลบลิงก์ที่ "สิ้นสุด" เกินกำหนดเก็บ 1 ชุด — ต้องเรียกในธุรกรรมเขียน (ผู้เรียกส่ง tx)
 * สิ้นสุด = min(coalesce(revoked_at, end_at), coalesce(cancelled_at, end_at), end_at) ของนัด · ลบเมื่อ <= cutoff
 * ลิงก์ที่ยัง active และนัดยังไม่จบ → ended = end_at > now > cutoff ไม่ถูกแตะ
 * ตั้ง appointment_guest.link_id = NULL ของลิงก์ชุดนี้ก่อนลบ (ไม่พึ่ง FK SET NULL) · more = ชุดนี้เต็ม limit
 */
const endedAt = sql`min(coalesce(l.revoked_at, a.end_at), coalesce(a.cancelled_at, a.end_at), a.end_at)`;

export async function purgeEndedShareLinksBatch(db: DbOrTx, cutoff: number, limit: number): Promise<{ deleted: number; more: boolean }> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT l.id AS id FROM appointment_share_link l JOIN appointment a ON a.id = l.appointment_id
     WHERE ${endedAt} <= ${cutoff}
     ORDER BY ${endedAt}, l.id LIMIT ${limit}`);
  if (rows.length === 0) return { deleted: 0, more: false };
  const ids = sql.join(
    rows.map((r) => sql`${r.id}`),
    sql`, `,
  );
  await db.run(sql`UPDATE appointment_guest SET link_id = NULL WHERE link_id IN (${ids})`);
  const res = await db.run(sql`
    DELETE FROM appointment_share_link WHERE id IN (${ids})
       AND id IN (SELECT l.id FROM appointment_share_link l JOIN appointment a ON a.id = l.appointment_id WHERE ${endedAt} <= ${cutoff})`);
  return { deleted: res.rowsAffected, more: rows.length >= limit };
}
