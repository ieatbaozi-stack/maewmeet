// notify() — ADR 0007 §1 · เขียนแถว notification ของช่องทาง in_app "ภายใน transaction เดียวกับเหตุการณ์" (ผู้เรียกส่ง tx)
//  - params = ค่าดิบ (id, ชื่อ ณ เวลาเกิด, instant เป็น epoch ms) — ห้ามข้อความที่แปลแล้ว และห้าม PIN/token/โค้ดเชิญ
//  - ผู้ก่อเหตุไม่ได้รับแจ้งของตัวเอง: ผู้เรียกกรองออกจาก userIds (ADR 0007 §1)
//  - เขียนล้ม → โยน → transaction ของเหตุการณ์หลัก rollback ทั้งก้อน (ADR 0007 test 4)
//  - เพิ่มชนิดใหม่ = เพิ่มใน union + ตาราง params + คีย์ข้อความ th/en (เทสต์วนจาก NOTIFICATION_KINDS) + เสนอ Lead/ADR ก่อน
import type { DbOrTx } from '@/db/client';
import { insertLineOutboxRows, usersWithLine } from '@/lib/data/repos/line';
import { insertNotificationRows, usersUnderUnreadCreatedCap } from '@/lib/data/repos/notification';
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
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** R10 §1.3: ค่าดิบของการเตือนก่อนนัด */
type AppointmentReminderParams = { groupId: string; groupName: string; appointmentId: string; title: string; startAt: number; tz: string };

/** params ต่อชนิด — ตรงกับ ADR 0007 §1 (ชื่อ ณ เวลาเกิดเหตุ · instant = epoch ms) */
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
};

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** ชนิดที่ส่งทาง LINE (R10 §1.4) — ชนิดอื่นทั้งหมดไม่เข้า outbox · rsvp_nudge เป็นกระดิ่งเท่านั้น */
const LINE_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>(['appointment.reminder_1d', 'appointment.reminder_1h']);

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

/** แจ้งผู้รับทุกคนใน userIds (ตัดซ้ำ) แถวละคน · คืนจำนวนแถวที่เขียน (appointment.created: ข้ามผู้ที่ unread ของกลุ่มนั้นครบเพดาน) */
export async function notify<K extends NotificationKind>(
  tx: DbOrTx,
  input: { userIds: readonly string[]; kind: K; params: NotificationParamsByKind[K] },
  now: number,
): Promise<number> {
  let userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return 0;
  if (userIds.length > NOTIFY_MAX_RECIPIENTS) throw new Error('notify: too many recipients');
  assertPlainParams(input.params as Record<string, unknown>);
  // coalesce (SEC M1): appointment.created ที่ยังไม่อ่านของกลุ่มเดียวกันครบเพดานแล้ว → ไม่เขียนเพิ่มให้ผู้รับคนนั้น (นัดยังสร้างได้ปกติ เห็นในรายการนัด)
  if (input.kind === 'appointment.created') {
    const open = await usersUnderUnreadCreatedCap(tx, userIds, (input.params as { groupId: string }).groupId, APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX);
    userIds = userIds.filter((u) => open.has(u));
    if (userIds.length === 0) return 0;
  }
  const rows = userIds.map((userId) => ({ id: newId(), userId, kind: input.kind, params: { ...input.params } as Record<string, unknown> }));
  await insertNotificationRows(tx, rows, now);
  // ADR 0011 §5: ไม่มี env LINE = ไม่เขียน outbox (ไม่สะสมแถวเก่าไว้ส่งทีหลัง) · payload = {kind, params} แปลตอนส่ง
  if (LINE_KINDS.has(input.kind) && lineConfig(getEnv()) !== null) {
    const linked = await usersWithLine(tx, userIds);
    await insertLineOutboxRows(
      tx,
      rows.filter((r) => linked.has(r.userId)).map((r) => ({ id: newId(), notificationId: r.id, userId: r.userId, payload: { kind: r.kind, params: r.params } })),
      now,
    );
  }
  return userIds.length;
}
