// notify() — ADR 0007 §1 · เขียนแถว notification ของช่องทาง in_app "ภายใน transaction เดียวกับเหตุการณ์" (ผู้เรียกส่ง tx)
//  - params = ค่าดิบ (id, ชื่อ ณ เวลาเกิด, instant เป็น epoch ms) — ห้ามข้อความที่แปลแล้ว และห้าม PIN/token/โค้ดเชิญ
//  - ผู้ก่อเหตุไม่ได้รับแจ้งของตัวเอง: ผู้เรียกกรองออกจาก userIds (ADR 0007 §1)
//  - เขียนล้ม → โยน → transaction ของเหตุการณ์หลัก rollback ทั้งก้อน (ADR 0007 test 4)
//  - เพิ่มชนิดใหม่ = เพิ่มใน union + ตาราง params + คีย์ข้อความ th/en (เทสต์วนจาก NOTIFICATION_KINDS) + เสนอ Lead/ADR ก่อน
import type { DbOrTx } from '@/db/client';
import { insertNotificationRows } from '@/lib/data/repos/notification';
import { newId } from '@/lib/shared/id';

export const NOTIFICATION_KINDS = [
  'group.invite.received',
  'group.invite.accepted',
  'group.invite.declined',
  'appointment.created',
  'pin_reset.approved',
  'pin_reset.cancelled_by_login',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** params ต่อชนิด — ตรงกับ ADR 0007 §1 (ชื่อ ณ เวลาเกิดเหตุ · instant = epoch ms) */
export type NotificationParamsByKind = {
  'group.invite.received': { groupId: string; groupName: string; inviterName: string; inviteId: string };
  'group.invite.accepted': { groupId: string; groupName: string; inviteeName: string; inviteId: string };
  'group.invite.declined': { groupId: string; groupName: string; inviteeName: string; inviteId: string };
  'appointment.created': { groupId: string; groupName: string; appointmentId: string; title: string; startAt: number; tz: string };
  'pin_reset.approved': { expiresAt: number };
  'pin_reset.cancelled_by_login': Record<string, never>;
};

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

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

/** แจ้งผู้รับทุกคนใน userIds (ตัดซ้ำ) แถวละคน · คืนจำนวนแถวที่เขียน */
export async function notify<K extends NotificationKind>(
  tx: DbOrTx,
  input: { userIds: readonly string[]; kind: K; params: NotificationParamsByKind[K] },
  now: number,
): Promise<number> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return 0;
  if (userIds.length > NOTIFY_MAX_RECIPIENTS) throw new Error('notify: too many recipients');
  assertPlainParams(input.params as Record<string, unknown>);
  await insertNotificationRows(
    tx,
    userIds.map((userId) => ({ id: newId(), userId, kind: input.kind, params: { ...input.params } })),
    now,
  );
  return userIds.length;
}
