// notify() — ADR 0007 §1 · เขียนแถว notification ของช่องทาง in_app "ภายใน transaction เดียวกับเหตุการณ์" (ผู้เรียกส่ง tx)
//  - params = ค่าดิบ (id, ชื่อ ณ เวลาเกิด, instant เป็น epoch ms) — ห้ามข้อความที่แปลแล้ว และห้าม PIN/token/โค้ดเชิญ
//  - ผู้ก่อเหตุไม่ได้รับแจ้งของตัวเอง: ผู้เรียกกรองออกจาก userIds (ADR 0007 §1)
//  - เขียนล้ม → โยน → transaction ของเหตุการณ์หลัก rollback ทั้งก้อน (ADR 0007 test 4)
//  - เพิ่มชนิดใหม่ = เพิ่มใน union + ตาราง params + คีย์ข้อความ th/en (เทสต์วนจาก NOTIFICATION_KINDS) + เสนอ Lead/ADR ก่อน
//  - R11 §1: appointment.updated / appointment.rsvp_changed แทนที่รายการที่ยังไม่อ่านของเหตุการณ์เดียวกัน (updated รวม changes กับของเดิม) · appointment.cancelled เข้า LINE เฉพาะ lineUserIds (แคบกว่ากระดิ่ง) และมีเพดาน unread ต่อกลุ่มแยกจาก created
import type { DbOrTx } from '@/db/client';
import type { RsvpResponse } from '@/lib/data/repos/appointment';
import { insertLineOutboxRows, usersWithLine } from '@/lib/data/repos/line';
import { deleteUnreadEventRows, insertNotificationRows, usersUnderUnreadCap, type UnreadCappedKind } from '@/lib/data/repos/notification';
import { lineConfig } from '@/lib/integrations/line/config';
import { getEnv } from '@/lib/shared/env';
import { newId } from '@/lib/shared/id';
import { APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX } from '@/lib/shared/limits';

export const NOTIFICATION_KINDS = [
  'group.invite.received',
  'group.invite.accepted',
  'group.invite.declined',
  'appointment.created',
  'appointment.reminder_1d',
  'appointment.reminder_1h',
  'appointment.rsvp_nudge',
  'pin_reset.approved',
  'pin_reset.cancelled_by_login',
  'appointment.cancelled',
  'appointment.updated',
  'appointment.rsvp_changed',
  'group.member.joined',
  'group.member.left',
  'group.member.removed',
  'group.member.role_changed',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** R10 §1.3: ค่าดิบของการเตือนก่อนนัด */
type AppointmentReminderParams = { groupId: string; groupName: string; appointmentId: string; title: string; startAt: number; tz: string };
/** R11 §1: ชนิดที่อ้างชื่อผู้กระทำ · actorId เก็บไว้ล้างชื่อตอนลบบัญชีเท่านั้น (ไม่ออกทาง API — ดู INTERNAL_PARAM_KEYS) */
type AppointmentActorParams = AppointmentReminderParams & { actorName: string; actorId: string };
type GroupMemberEventParams = { groupId: string; groupName: string; memberName: string; memberId: string };

/** params ต่อชนิด — ตรงกับ ADR 0007 §1 + R11 §1 (ชื่อ ณ เวลาเกิดเหตุ · instant = epoch ms) */
export type NotificationParamsByKind = {
  'group.invite.received': { groupId: string; groupName: string; inviterName: string; inviteId: string };
  'group.invite.accepted': { groupId: string; groupName: string; inviteeName: string; inviteId: string };
  'group.invite.declined': { groupId: string; groupName: string; inviteeName: string; inviteId: string };
  'appointment.created': { groupId: string; groupName: string; appointmentId: string; title: string; startAt: number; tz: string };
  'appointment.reminder_1d': AppointmentReminderParams;
  'appointment.reminder_1h': AppointmentReminderParams;
  'appointment.rsvp_nudge': AppointmentReminderParams;
  'pin_reset.approved': { expiresAt: number };
  'pin_reset.cancelled_by_login': Record<string, never>;
  'appointment.cancelled': AppointmentActorParams;
  /** startAt / tz = ค่าใหม่หลังแก้ */
  'appointment.updated': AppointmentActorParams & { changes: 'time' | 'place' | 'both' };
  /** responderId ใช้จับคู่ "ผู้ตอบคนเดิม" ตอนแทนที่ และล้างชื่อตอนลบบัญชี (ไม่ออกทาง API) */
  'appointment.rsvp_changed': AppointmentReminderParams & { responderName: string; responderId: string; response: RsvpResponse };
  'group.member.joined': GroupMemberEventParams;
  'group.member.left': GroupMemberEventParams;
  /** ไม่บอกชื่อผู้นำออก (R11 §1) */
  'group.member.removed': { groupId: string; groupName: string };
  'group.member.role_changed': { groupId: string; groupName: string; role: 'admin' | 'moderator' | 'member' };
};

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** ตัวอ้างอิงภายใน (ใช้แทนที่ + ล้างชื่อตอนลบบัญชี) — ตัดออกก่อนส่งออกทาง API เสมอ */
export const INTERNAL_PARAM_KEYS: readonly string[] = ['actorId', 'responderId', 'memberId'];

/** params ที่ส่งออกไปหา client ได้ */
export function publicParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([k]) => !INTERNAL_PARAM_KEYS.includes(k)));
}

/**
 * ชนิดที่ส่งทาง LINE (R10 §1.4 · R11 §2) — ชนิดอื่นทั้งหมดไม่เข้า outbox · rsvp_nudge เป็นกระดิ่งเท่านั้น
 * reminder: ทุกผู้รับ userIds · appointment.cancelled: เฉพาะ lineUserIds (บังคับ — ผู้รับกระดิ่งกว้างกว่าผู้รับ LINE)
 */
const LINE_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>(['appointment.reminder_1d', 'appointment.reminder_1h', 'appointment.cancelled']);

/** ค่าที่ไม่ต้องอยู่ใน payload ของ outbox: ข้อความ LINE ไม่มีชื่อคนกดยกเลิก (R11 §2) · ลดข้อมูลคนที่ค้างในคิว */
const LINE_PAYLOAD_OMIT: ReadonlySet<string> = new Set(['actorName', 'actorId']);

/** คีย์ที่ห้ามอยู่ใน params เด็ดขาด (ชั้นสุดท้าย — allowlist จริงอยู่ที่ชนิดด้านบน) */
const FORBIDDEN_PARAM_KEY = /pin|token|hash|secret|pepper|code|password/i;
/** ผู้รับสูงสุดต่อครั้ง (กลุ่มสูงสุด 50 คน) */
export const NOTIFY_MAX_RECIPIENTS = 200;

function assertPlainParams(params: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(params)) {
    if (FORBIDDEN_PARAM_KEY.test(k)) throw new Error(`notification param key not allowed: ${k}`);
    if (!(v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      throw new Error(`notification param must be a plain value: ${k}`);
    }
  }
}

type UpdateChanges = NotificationParamsByKind['appointment.updated']['changes'];

const isUpdateChanges = (v: unknown): v is UpdateChanges => v === 'time' || v === 'place' || v === 'both';

/** R11 §1: รวม changes ของรายการที่ถูกแทนที่ — เวลา + สถานที่ = both · both คงเป็น both */
function mergeChanges(previous: UpdateChanges, next: UpdateChanges): UpdateChanges {
  return previous === next ? next : 'both';
}

/**
 * แทนที่รายการที่ยังไม่อ่านของเหตุการณ์เดียวกัน — ลบแถวเก่าก่อนเขียนใหม่ใน transaction เดียว (ชนิดเหล่านี้ไม่มีแถว outbox)
 * คืน changes ที่รวมแล้วต่อผู้รับ (แต่ละคนอ่านไม่พร้อมกัน ค่าจึงต่างกันได้) · ค่าอื่นของแถวใหม่ (startAt ฯลฯ) เป็นค่าล่าสุด
 */
async function replaceUnread(tx: DbOrTx, kind: NotificationKind, userIds: readonly string[], params: Record<string, unknown>): Promise<Map<string, UpdateChanges>> {
  const merged = new Map<string, UpdateChanges>();
  if (kind === 'appointment.updated') {
    const replaced = await deleteUnreadEventRows(tx, { userIds, kind, appointmentId: String(params.appointmentId) });
    const next = params.changes as UpdateChanges;
    for (const row of replaced) {
      const previous = (row.params as { changes?: unknown } | null)?.changes;
      if (isUpdateChanges(previous)) merged.set(row.userId, mergeChanges(merged.get(row.userId) ?? next, previous));
    }
  } else if (kind === 'appointment.rsvp_changed') {
    await deleteUnreadEventRows(tx, { userIds, kind, appointmentId: String(params.appointmentId), responderId: String(params.responderId) });
  }
  return merged;
}

/** R11 §1: ชนิดที่มีเพดาน unread ต่อกลุ่มต่อผู้รับ (นับแยกชนิด — created ที่ค้างอ่านไม่บังการแจ้งยกเลิก) · เกิน = ไม่มีทั้งกระดิ่งและ LINE ของผู้รับคนนั้น */
const UNREAD_CAPPED_KINDS: ReadonlySet<NotificationKind> = new Set<UnreadCappedKind>(['appointment.created', 'appointment.cancelled', 'group.member.joined', 'group.member.left', 'group.member.role_changed']);
const cappedKind = (kind: NotificationKind): kind is UnreadCappedKind => UNREAD_CAPPED_KINDS.has(kind);

/**
 * LINE ของ appointment.cancelled แคบกว่ากระดิ่ง จึงบังคับระบุ lineUserIds ทั้งชนิดข้อมูลและตอนรันจริง · ชนิดอื่นห้ามระบุ
 * (เพิ่มชนิด LINE ใหม่ = ต้องตัดสินใจเรื่องผู้รับแบบชัดเจนตรงนี้)
 */
type LineAudienceInput<K extends NotificationKind> = K extends 'appointment.cancelled' ? { lineUserIds: readonly string[] } : { lineUserIds?: undefined };

/** แจ้งผู้รับทุกคนใน userIds (ตัดซ้ำ) แถวละคน · คืนจำนวนแถวที่เขียน (appointment.created: ข้ามผู้ที่ unread ของกลุ่มนั้นครบเพดาน) */
export async function notify<K extends NotificationKind>(
  tx: DbOrTx,
  input: { userIds: readonly string[]; kind: K; params: NotificationParamsByKind[K] } & LineAudienceInput<K>,
  now: number,
): Promise<number> {
  const lineUserIds = (input as { lineUserIds?: readonly string[] }).lineUserIds;
  if (input.kind === 'appointment.cancelled' && lineUserIds === undefined) throw new Error('notify: appointment.cancelled requires lineUserIds');
  let userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return 0;
  if (userIds.length > NOTIFY_MAX_RECIPIENTS) throw new Error('notify: too many recipients');
  const params = input.params as Record<string, unknown>;
  assertPlainParams(params);
  // coalesce (SEC M1): ชนิดนี้ที่ยังไม่อ่านของกลุ่มเดียวกันครบเพดานแล้ว → ไม่เขียนเพิ่มให้ผู้รับคนนั้น (การกระทำยังสำเร็จปกติ เห็นในรายการนัด)
  const kind: NotificationKind = input.kind;
  if (cappedKind(kind)) {
    const open = await usersUnderUnreadCap(tx, userIds, kind, (input.params as { groupId: string }).groupId, APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX);
    userIds = userIds.filter((u) => open.has(u));
    if (userIds.length === 0) return 0;
  }
  const mergedChanges = await replaceUnread(tx, input.kind, userIds, params);
  const rows = userIds.map((userId) => {
    const changes = mergedChanges.get(userId);
    return { id: newId(), userId, kind: input.kind, params: changes === undefined ? { ...params } : { ...params, changes } };
  });
  await insertNotificationRows(tx, rows, now);
  // ADR 0011 §5: ไม่มี env LINE = ไม่เขียน outbox (ไม่สะสมแถวเก่าไว้ส่งทีหลัง) · payload = {kind, params} แปลตอนส่ง
  if (LINE_KINDS.has(input.kind) && lineConfig(getEnv()) !== null) {
    const audience = lineUserIds === undefined ? null : new Set(lineUserIds);
    const candidates = audience === null ? rows : rows.filter((r) => audience.has(r.userId));
    const linked = await usersWithLine(tx, candidates.map((r) => r.userId));
    await insertLineOutboxRows(
      tx,
      candidates
        .filter((r) => linked.has(r.userId))
        .map((r) => ({
          id: newId(),
          notificationId: r.id,
          userId: r.userId,
          payload: { kind: r.kind, params: Object.fromEntries(Object.entries(r.params).filter(([k]) => !LINE_PAYLOAD_OMIT.has(k))) },
        })),
      now,
    );
  }
  return userIds.length;
}
