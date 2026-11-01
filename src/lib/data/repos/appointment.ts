// repo: appointment + appointment_rsvp — U10/U11 · query ล้วน ไม่รู้จัก actor · เวลา = now ที่ผู้เรียก inject
// การเขียนที่แข่งกันได้เป็นคำสั่ง SQL เดียวที่มีเงื่อนไขในตัว (ไม่มี check-then-act):
//   - สร้างนัด: INSERT … SELECT … WHERE (กลุ่มยังอยู่ AND ผู้สร้างยังถือ role เดิม AND นัด active ที่ยังไม่จบ < cap)
//   - แก้นัด: UPDATE … WHERE (active AND กลุ่มยังอยู่ AND ผู้แก้ยังถือ role เดิม AND (ไม่เพิ่มจำนวนที่นับ OR ยังมีที่ว่าง))
//   - ยกเลิก: UPDATE … WHERE status = 'active' AND …
//   - RSVP: INSERT … SELECT … ON CONFLICT DO UPDATE (เปิดเฉพาะนัด active ที่ยังไม่จบ + ผู้ตอบยังเป็นสมาชิก)
// "นัดที่ยังนับเพดาน/ยังเป็น upcoming" = status active AND end_at > now (นัดที่กำลังเกิดอยู่ยังไม่ถือว่าผ่านไป)
import { and, asc, desc, eq, gt, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { appointment, appointmentRsvp, groupMember, groups, user } from '@/db/schema';
import type { DbOrTx } from '@/db/client';
import { actorGuardClause, type ActorGuard } from './group-member';
import type { GroupRole } from './group';
import { DAY_MS } from '@/lib/shared/clock';

export type AppointmentRow = typeof appointment.$inferSelect;
export type RsvpResponse = (typeof appointmentRsvp.$inferSelect)['response'];

/** ฟิลด์ที่ผู้ใช้กำหนดได้ (ผ่านการตรวจ/normalize ของ service แล้ว) */
export type AppointmentWrite = {
  title: string;
  description: string | null;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
  startAt: number;
  endAt: number;
  tz: string;
  localDate: string;
};

const groupAlive = (groupId: string) => sql`EXISTS (SELECT 1 FROM groups WHERE id = ${groupId} AND deleted_at IS NULL)`;

/** จำนวนนัดที่นับเพดานของกลุ่ม (active AND ยังไม่จบ) */
export async function countActiveFutureAppointments(db: DbOrTx, groupId: string, now: number): Promise<number> {
  const rows = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM appointment WHERE group_id = ${groupId} AND status = 'active' AND end_at > ${now}`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** นัดที่สร้างในกลุ่มภายใน 24 ชม.ล่าสุด รวมที่ยกเลิกแล้ว */
export async function countCreatedLastDay(db: DbOrTx, groupId: string, now: number): Promise<number> {
  const rows = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM appointment WHERE group_id = ${groupId} AND created_at > ${now - DAY_MS}`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * สร้างนัดถ้า: กลุ่มยังไม่ถูกลบ + ผู้สร้างยังถือ role เดิม (ActorGuard) + นัด active ที่ยังไม่จบในกลุ่ม < cap + นัดที่สร้างใน 24 ชม.ล่าสุด (รวมที่ยกเลิก) < dailyCap — คำสั่งเดียวอะตอมมิก
 * คืน null = ถูกปฏิเสธ (ผู้เรียกวินิจฉัยต่อด้วยการอ่าน — ไม่มีผลต่อความปลอดภัย)
 */
export async function insertAppointmentIfUnderCap(
  db: DbOrTx,
  input: AppointmentWrite & { id: string; groupId: string; createdBy: string; cap: number; dailyCap: number },
  guard: ActorGuard,
  now: number,
): Promise<AppointmentRow | null> {
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO appointment (id, group_id, title, description, place_name, lat, lng, map_url, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at)
    SELECT ${input.id}, ${input.groupId}, ${input.title}, ${input.description}, ${input.placeName}, ${input.lat}, ${input.lng}, ${input.mapUrl},
           ${input.startAt}, ${input.endAt}, ${input.tz}, ${input.localDate}, 'active', ${input.createdBy}, ${now}, ${now}
    WHERE ${groupAlive(input.groupId)}
      AND EXISTS (SELECT 1 FROM user WHERE id = ${input.createdBy} AND status = 'active')
      AND ${actorGuardClause(input.groupId, guard)}
      AND (SELECT count(*) FROM appointment WHERE group_id = ${input.groupId} AND status = 'active' AND end_at > ${now}) < ${input.cap}
      AND (SELECT count(*) FROM appointment WHERE group_id = ${input.groupId} AND created_at > ${now - DAY_MS}) < ${input.dailyCap}
    RETURNING id`);
  if (rows.length !== 1) return null;
  return findAppointmentById(db, input.id);
}

export async function findAppointmentById(db: DbOrTx, id: string): Promise<AppointmentRow | null> {
  const rows = await db.select().from(appointment).where(eq(appointment.id, id)).limit(1);
  return rows[0] ?? null;
}

export type AppointmentAccessRow = {
  appointment: AppointmentRow;
  groupName: string;
  groupDeleted: boolean;
  /** role ของผู้ดูในกลุ่ม · null = ไม่ใช่สมาชิก */
  role: GroupRole | null;
};

/** นัด + กลุ่ม + role ของ user ในกลุ่ม ใน query เดียว (policy-context) · ไม่มีนัด = null */
export async function findAppointmentAccess(db: DbOrTx, id: string, userId: string): Promise<AppointmentAccessRow | null> {
  const rows = await db
    .select({ a: appointment, groupName: groups.name, deletedAt: groups.deletedAt, role: groupMember.role })
    .from(appointment)
    .innerJoin(groups, eq(groups.id, appointment.groupId))
    .leftJoin(groupMember, and(eq(groupMember.groupId, appointment.groupId), eq(groupMember.userId, userId)))
    .where(eq(appointment.id, id))
    .limit(1);
  const r = rows[0];
  return r ? { appointment: r.a, groupName: r.groupName, groupDeleted: r.deletedAt !== null, role: r.role } : null;
}

/** ฟิลด์ที่แก้ได้ (ส่งเฉพาะที่เปลี่ยน) — เวลา 3 ตัวไปด้วยกันเสมอ */
export type AppointmentPatch = Partial<Omit<AppointmentWrite, 'startAt' | 'endAt' | 'tz' | 'localDate'>> &
  Partial<Pick<AppointmentWrite, 'startAt' | 'endAt' | 'tz' | 'localDate'>>;

/**
 * แก้นัด (เฉพาะ active + ยังไม่จบ + กลุ่มยังอยู่ + ผู้แก้ยังถือ role เดิม) — คำสั่งเดียว
 * เพดาน: ถ้านัดเดิมไม่ถูกนับ (end_at <= now) แต่ค่าใหม่ถูกนับ (ย้ายเข้าอนาคต) ต้องมีที่ว่าง: นัดอื่นที่นับ < cap ·
 * นัดเดิมถูกนับอยู่แล้ว หรือค่าใหม่ไม่ถูกนับ ไม่เพิ่มจำนวน → ไม่ตรวจ
 * คืน null = ไม่มี/ไม่ active/กลุ่มถูกลบ/ผู้แก้ไม่ถือ role เดิม/เต็มเพดาน (ผู้เรียกวินิจฉัยต่อ)
 */
export async function updateAppointmentGuarded(
  db: DbOrTx,
  input: { id: string; groupId: string; patch: AppointmentPatch; cap: number },
  guard: ActorGuard,
  now: number,
): Promise<AppointmentRow | null> {
  const p = input.patch;
  const set: Partial<typeof appointment.$inferInsert> = { updatedAt: now };
  if (p.title !== undefined) set.title = p.title;
  if (p.description !== undefined) set.description = p.description;
  if (p.placeName !== undefined) set.placeName = p.placeName;
  if (p.lat !== undefined) set.lat = p.lat;
  if (p.lng !== undefined) set.lng = p.lng;
  if (p.mapUrl !== undefined) set.mapUrl = p.mapUrl;
  if (p.startAt !== undefined) set.startAt = p.startAt;
  if (p.endAt !== undefined) set.endAt = p.endAt;
  if (p.tz !== undefined) set.tz = p.tz;
  if (p.localDate !== undefined) set.localDate = p.localDate;

  const newEnd = p.endAt === undefined ? sql`${appointment.endAt}` : sql`${p.endAt}`;
  const rows = await db
    .update(appointment)
    .set(set)
    .where(
      and(
        eq(appointment.id, input.id),
        eq(appointment.groupId, input.groupId),
        eq(appointment.status, 'active'),
        gt(appointment.endAt, now), // นัดที่จบแล้วแก้ไม่ได้ (QA L1)
        groupAlive(input.groupId),
        actorGuardClause(input.groupId, guard),
        sql`(${appointment.endAt} > ${now} OR ${newEnd} <= ${now} OR (SELECT count(*) FROM appointment o WHERE o.group_id = ${input.groupId} AND o.status = 'active' AND o.end_at > ${now} AND o.id <> ${input.id}) < ${input.cap})`,
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** ยกเลิก (เก็บแถว) — เฉพาะ active + ยังไม่จบ + กลุ่มยังอยู่ + ผู้ยกเลิกยังถือ role เดิม · คืน null = ไม่ผ่านเงื่อนไข */
export async function cancelAppointmentGuarded(
  db: DbOrTx,
  input: { id: string; groupId: string; cancelledBy: string },
  guard: ActorGuard,
  now: number,
): Promise<AppointmentRow | null> {
  const rows = await db
    .update(appointment)
    .set({ status: 'cancelled', cancelledAt: now, cancelledBy: input.cancelledBy, updatedAt: now })
    .where(
      and(
        eq(appointment.id, input.id),
        eq(appointment.groupId, input.groupId),
        eq(appointment.status, 'active'),
        gt(appointment.endAt, now), // นัดที่จบแล้วยกเลิกไม่ได้ (QA L1)
        groupAlive(input.groupId),
        actorGuardClause(input.groupId, guard),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

// ───────── รายการ ─────────
export type AppointmentScope = 'upcoming' | 'past' | 'all';
export type AppointmentCursor = { startAt: number; id: string };

/**
 * นัดของกลุ่ม (ผู้เรียกผ่านด่านกลุ่มมาแล้ว) — keyset (start_at, id) · ขอ limit+1 เพื่อรู้ว่ามีหน้าถัดไป
 *   upcoming: end_at > now (รวมที่ยกเลิก — แสดงสถานะ) เรียงเริ่มเร็วสุดก่อน · past: end_at <= now ใหม่สุดก่อน · all: ทั้งหมด ใหม่สุดก่อน
 */
export async function listGroupAppointmentRows(
  db: DbOrTx,
  groupId: string,
  q: { scope: AppointmentScope; now: number; limit: number; cursor: AppointmentCursor | null },
): Promise<AppointmentRow[]> {
  const asc_ = q.scope === 'upcoming';
  const conds: SQL[] = [eq(appointment.groupId, groupId)];
  if (q.scope === 'upcoming') conds.push(gt(appointment.endAt, q.now));
  if (q.scope === 'past') conds.push(lte(appointment.endAt, q.now));
  if (q.cursor) {
    conds.push(
      asc_
        ? sql`(${appointment.startAt}, ${appointment.id}) > (${q.cursor.startAt}, ${q.cursor.id})`
        : sql`(${appointment.startAt}, ${appointment.id}) < (${q.cursor.startAt}, ${q.cursor.id})`,
    );
  }
  return db
    .select()
    .from(appointment)
    .where(and(...conds))
    .orderBy(...(asc_ ? [asc(appointment.startAt), asc(appointment.id)] : [desc(appointment.startAt), desc(appointment.id)]))
    .limit(q.limit);
}

/** นัด active ที่ยังไม่จบ ข้ามทุกกลุ่มที่ฉันเป็นสมาชิก (กลุ่มที่ลบแล้วไม่รวม) เรียงเริ่มเร็วสุดก่อน */
export async function listMyUpcomingAppointmentRows(db: DbOrTx, userId: string, now: number, limit: number): Promise<AppointmentRow[]> {
  const rows = await db
    .select({ a: appointment })
    .from(groupMember)
    .innerJoin(groups, and(eq(groups.id, groupMember.groupId), sql`${groups.deletedAt} IS NULL`))
    .innerJoin(appointment, eq(appointment.groupId, groupMember.groupId))
    .where(and(eq(groupMember.userId, userId), eq(appointment.status, 'active'), gt(appointment.endAt, now)))
    .orderBy(asc(appointment.startAt), asc(appointment.id))
    .limit(limit);
  return rows.map((r) => r.a);
}

export async function groupNames(db: DbOrTx, groupIds: string[]): Promise<Map<string, string>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, groupIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export type MemberName = { groupId: string; userId: string; displayName: string; colorSlot: number | null; shapeSlot: number | null };

/** สมาชิกปัจจุบันของกลุ่มที่ระบุ (กรองคู่ group/user ที่ผู้เรียก) — ใช้หาชื่อผู้สร้าง/ผู้ยกเลิกที่ "ยังอยู่ในกลุ่ม" */
export async function currentMemberNames(db: DbOrTx, groupIds: string[], userIds: string[]): Promise<MemberName[]> {
  if (groupIds.length === 0 || userIds.length === 0) return [];
  return db
    .select({ groupId: groupMember.groupId, userId: groupMember.userId, displayName: user.displayName, colorSlot: groupMember.colorSlot, shapeSlot: groupMember.shapeSlot })
    .from(groupMember)
    .innerJoin(user, eq(user.id, groupMember.userId))
    .where(and(inArray(groupMember.groupId, groupIds), inArray(groupMember.userId, userIds)));
}

export async function memberCountsByGroup(db: DbOrTx, groupIds: string[]): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db
    .select({ groupId: groupMember.groupId, n: sql<number>`count(*)` })
    .from(groupMember)
    .where(inArray(groupMember.groupId, groupIds))
    .groupBy(groupMember.groupId);
  return new Map(rows.map((r) => [r.groupId, Number(r.n)]));
}

// ───────── RSVP ─────────
/** colorSlot/shapeSlot: หน้าตาที่ผู้ตอบเลือกในกลุ่มของนัด (R6C) — มาจาก group_member ที่ join อยู่แล้ว */
export type RsvpRow = { appointmentId: string; userId: string; response: RsvpResponse; displayName: string; colorSlot: number | null; shapeSlot: number | null };

/** คำตอบของ "สมาชิกปัจจุบัน" ของกลุ่มที่นัดสังกัดเท่านั้น (คนที่ออก/ถูกลบไม่นับ ไม่แสดง · คำตอบก่อน joined_at ปัจจุบันไม่นับ) — counts/members/mine/home ทุกที่มาจากฟังก์ชันนี้ */
export async function listCurrentRsvps(db: DbOrTx, appointmentIds: string[]): Promise<RsvpRow[]> {
  if (appointmentIds.length === 0) return [];
  return db
    .select({
      appointmentId: appointmentRsvp.appointmentId,
      userId: appointmentRsvp.userId,
      response: appointmentRsvp.response,
      displayName: user.displayName,
      colorSlot: groupMember.colorSlot,
      shapeSlot: groupMember.shapeSlot,
    })
    .from(appointmentRsvp)
    .innerJoin(appointment, eq(appointment.id, appointmentRsvp.appointmentId))
    // updated_at >= joined_at: คำตอบที่ให้ไว้ก่อนเข้ากลุ่มรอบปัจจุบัน (ออกแล้วกลับมา) ไม่นับ/ไม่แสดง/ไม่เป็น `mine` — ไม่ลบแถวตอนออก (QA M1)
    .innerJoin(
      groupMember,
      and(eq(groupMember.groupId, appointment.groupId), eq(groupMember.userId, appointmentRsvp.userId), sql`${appointmentRsvp.updatedAt} >= ${groupMember.joinedAt}`),
    )
    .innerJoin(user, eq(user.id, appointmentRsvp.userId))
    .where(inArray(appointmentRsvp.appointmentId, appointmentIds))
    .orderBy(asc(appointmentRsvp.updatedAt), asc(appointmentRsvp.userId));
}

/**
 * ตอบ/แก้คำตอบ — upsert คำสั่งเดียว เปิดเฉพาะ: นัด active + ยังไม่จบ + กลุ่มยังอยู่ + ผู้ตอบเป็นสมาชิกปัจจุบัน
 * คืน false = ไม่ผ่านเงื่อนไข (ผู้เรียกวินิจฉัยต่อ)
 */
export async function upsertRsvpIfOpen(
  db: DbOrTx,
  input: { appointmentId: string; userId: string; response: RsvpResponse },
  now: number,
): Promise<boolean> {
  const rows = await db.all<{ response: string }>(sql`
    INSERT INTO appointment_rsvp (appointment_id, user_id, response, updated_at)
    SELECT a.id, ${input.userId}, ${input.response}, ${now}
    FROM appointment a
    WHERE a.id = ${input.appointmentId}
      AND a.status = 'active'
      AND a.end_at > ${now}
      AND EXISTS (SELECT 1 FROM groups g WHERE g.id = a.group_id AND g.deleted_at IS NULL)
      AND EXISTS (SELECT 1 FROM group_member m WHERE m.group_id = a.group_id AND m.user_id = ${input.userId})
    ON CONFLICT (appointment_id, user_id) DO UPDATE SET response = excluded.response, updated_at = excluded.updated_at
    RETURNING response`);
  return rows.length === 1;
}
