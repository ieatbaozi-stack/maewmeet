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
  // R17 G5: super admin กู้คืนกลุ่มที่ลบ → สมาชิกที่บัญชี active ทุกคน (กระดิ่งเท่านั้น ไม่เข้า LINE)
  'group.restored',
  // R18 §S (ADR 0016 §7.2): ถึงแขกของนัด — ชนิดแยก params ไม่มีชื่อ/id ผู้กระทำ (แขกไม่เห็นชื่อสมาชิก)
  'appointment.guest.updated',
  'appointment.guest.cancelled',
  'appointment.guest.removed',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** R10 §1.3: ค่าดิบของการเตือนก่อนนัด */
type AppointmentReminderParams = { groupId: string; groupName: string; appointmentId: string; title: string; startAt: number; tz: string };
/**
 * R11 §1: ชนิดที่อ้างชื่อผู้กระทำ · actorId เก็บไว้ล้างชื่อตอนลบบัญชีเท่านั้น (ไม่ออกทาง API — ดู INTERNAL_PARAM_KEYS)
 * R15b B7: actorSystemAdmin = ผู้กระทำเป็น super admin ที่ไม่ใช่สมาชิกกลุ่ม → actorName '' (ไม่เก็บชื่อคนนอกกลุ่ม · UI แสดง common.systemAdmin)
 * แถวเก่าก่อน R15b ไม่มีคีย์นี้ = false
 */
type AppointmentActorParams = AppointmentReminderParams & { actorName: string; actorId: string; actorSystemAdmin: boolean };
type GroupMemberEventParams = { groupId: string; groupName: string; memberName: string; memberId: string };

/** params ต่อชนิด — ตรงกับ ADR 0007 §1 + R11 §1 (ชื่อ ณ เวลาเกิดเหตุ · instant = epoch ms) */
export type NotificationParamsByKind = {
  /** R16 H4: actorSystemAdmin = ผู้เชิญเป็น super admin ที่ไม่ใช่สมาชิก → inviterName '' (UI แสดง common.systemAdmin) · แถวก่อน R16 ไม่มีคีย์นี้ = false */
  'group.invite.received': { groupId: string; groupName: string; inviterName: string; inviteId: string; actorSystemAdmin: boolean };
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
  /**
   * responderId ใช้จับคู่ "ผู้ตอบคนเดิม" ตอนแทนที่ และล้างชื่อตอนลบบัญชี (ไม่ออกทาง API)
   * R18 §S: responderGuest = ผู้ตอบเป็นแขกของนัด (ไม่ใช่สมาชิก) · แถวเก่าไม่มีคีย์นี้ = false
   */
  'appointment.rsvp_changed': AppointmentReminderParams & { responderName: string; responderId: string; response: RsvpResponse; responderGuest?: boolean };
  'group.member.joined': GroupMemberEventParams;
  'group.member.left': GroupMemberEventParams;
  /** ไม่บอกชื่อผู้นำออก (R11 §1) */
  'group.member.removed': { groupId: string; groupName: string };
  'group.member.role_changed': { groupId: string; groupName: string; role: 'admin' | 'moderator' | 'member' };
  /**
   * R17 G5 (B3): กลุ่มถูกกู้คืน — ผู้กระทำเป็น super admin เสมอ (B4) → ไม่เก็บชื่อ SA · actorSystemAdmin: true ให้ UI แสดง common.systemAdmin (แบบ R16 H4)
   * groupName = ชื่อกลุ่ม ณ เวลากู้คืน
   */
  'group.restored': { groupId: string; groupName: string; actorSystemAdmin: true };
  /** R18 §S: นัดที่ฉันเป็นแขกถูกแก้เวลา/สถานที่ — startAt / tz = ค่าใหม่ · ไม่มีชื่อผู้แก้ · แทนที่ unread แบบ appointment.updated */
  'appointment.guest.updated': AppointmentReminderParams & { changes: 'time' | 'place' | 'both' };
  /** R18 §S: นัดที่ฉันเป็นแขกถูกยกเลิก — ไม่มีชื่อผู้ยกเลิก · LINE เฉพาะ lineUserIds (แขกที่ตอบ going) */
  'appointment.guest.cancelled': AppointmentReminderParams;
  /** R18 §S: ฉันถูกนำออกจากนัด — ไม่มี appointmentId (ลิงก์ไป '/') · ไม่บอกผู้นำออก · groupId ไว้ให้ purge กลุ่มลบตาม JSON · กระดิ่งเท่านั้น */
  'appointment.guest.removed': { groupId: string; groupName: string; title: string; startAt: number; tz: string };
};

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** ตัวอ้างอิงภายใน (ใช้แทนที่ + ล้างชื่อตอนลบบัญชี) — ตัดออกก่อนส่งออกทาง API เสมอ */
/** R18 D1: inviterId / inviteeId ถูกประทับโดย cron ตอนลบคำเชิญเก่า (repos/invite-purge.ts) เพื่อให้ล้างชื่อตอนลบบัญชีได้ */
export const INTERNAL_PARAM_KEYS: readonly string[] = ['actorId', 'responderId', 'memberId', 'inviterId', 'inviteeId'];

/**
 * R18 §S (security-v1 Info 1 · ADR 0016 §5.4 "ไม่มี groupId"): คีย์ภายในเฉพาะชนิดของแขก — groupId อยู่ในฐานเพื่อ purge กลุ่มตาม JSON
 * และเพดาน unread ต่อกลุ่ม แต่ไม่ส่งออกทาง API (แขกไม่ควรเห็น id กลุ่ม · UI ของชนิดแขกไม่ใช้)
 */
const INTERNAL_PARAM_KEYS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  'appointment.guest.updated': ['groupId'],
  'appointment.guest.cancelled': ['groupId'],
  'appointment.guest.removed': ['groupId'],
};

/** params ที่ส่งออกไปหา client ได้ · kind = ชนิดของแถว (ตัดคีย์ภายในเฉพาะชนิดด้วย) */
export function publicParams(params: Record<string, unknown>, kind?: string): Record<string, unknown> {
  const perKind = kind !== undefined && Object.prototype.hasOwnProperty.call(INTERNAL_PARAM_KEYS_BY_KIND, kind) ? INTERNAL_PARAM_KEYS_BY_KIND[kind]! : [];
  return Object.fromEntries(Object.entries(params).filter(([k]) => !INTERNAL_PARAM_KEYS.includes(k) && !perKind.includes(k)));
}

/**
 * ชนิดที่ส่งทาง LINE (R10 §1.4 · R11 §2) — ชนิดอื่นทั้งหมดไม่เข้า outbox · rsvp_nudge เป็นกระดิ่งเท่านั้น
 * reminder: ทุกผู้รับ userIds · appointment.cancelled: เฉพาะ lineUserIds (บังคับ — ผู้รับกระดิ่งกว้างกว่าผู้รับ LINE)
 */
const LINE_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>(['appointment.reminder_1d', 'appointment.reminder_1h', 'appointment.cancelled', 'appointment.guest.cancelled']);

/** ค่าที่ไม่ต้องอยู่ใน payload ของ outbox: ข้อความ LINE ไม่มีชื่อคนกดยกเลิก (R11 §2) · ลดข้อมูลคนที่ค้างในคิว */
const LINE_PAYLOAD_OMIT: ReadonlySet<string> = new Set(['actorName', 'actorId', 'actorSystemAdmin']);

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
  if (kind === 'appointment.updated' || kind === 'appointment.guest.updated') {
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
const UNREAD_CAPPED_KINDS: ReadonlySet<NotificationKind> = new Set<UnreadCappedKind>(['appointment.created', 'appointment.cancelled', 'appointment.guest.cancelled', 'group.member.joined', 'group.member.left', 'group.member.role_changed']);
const cappedKind = (kind: NotificationKind): kind is UnreadCappedKind => UNREAD_CAPPED_KINDS.has(kind);

/**
 * LINE ของ appointment.cancelled แคบกว่ากระดิ่ง จึงบังคับระบุ lineUserIds ทั้งชนิดข้อมูลและตอนรันจริง · ชนิดอื่นห้ามระบุ
 * (เพิ่มชนิด LINE ใหม่ = ต้องตัดสินใจเรื่องผู้รับแบบชัดเจนตรงนี้)
 */
type LineAudienceInput<K extends NotificationKind> = K extends 'appointment.cancelled' | 'appointment.guest.cancelled' ? { lineUserIds: readonly string[] } : { lineUserIds?: undefined };

/** แจ้งผู้รับทุกคนใน userIds (ตัดซ้ำ) แถวละคน · คืนจำนวนแถวที่เขียน (appointment.created: ข้ามผู้ที่ unread ของกลุ่มนั้นครบเพดาน) */
export async function notify<K extends NotificationKind>(
  tx: DbOrTx,
  input: { userIds: readonly string[]; kind: K; params: NotificationParamsByKind[K] } & LineAudienceInput<K>,
  now: number,
): Promise<number> {
  const lineUserIds = (input as { lineUserIds?: readonly string[] }).lineUserIds;
  if ((input.kind === 'appointment.cancelled' || input.kind === 'appointment.guest.cancelled') && lineUserIds === undefined) throw new Error(`notify: ${input.kind} requires lineUserIds`);
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
