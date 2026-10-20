// ส่วนร่วมของ service กลุ่ม/คำเชิญ (R2) — audit ตาม ADR 0003 · ชนิด notification
import type { DbOrTx } from '@/db/client';
import { insertAuditLog } from '@/lib/data/repos/audit-log';
import type { Actor, Allow, UserActor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';

/** หลัง authorize() ผ่านแล้วของ action ที่ต้องล็อกอินเสมอ — แปลงชนิดให้ compiler (anonymous ถูกตัดที่ can() ไปก่อนแล้ว) */
export function asUser(actor: Actor): UserActor {
  if (actor.kind !== 'user') throw new AppError('AUTH_REQUIRED');
  return actor;
}

/** ชนิด notification ของ R2 (params = ค่าดิบ ไม่ใช่ข้อความแปล · ห้ามมีโค้ดเชิญ — ADR 0007) */
export const NOTIFY_KIND = {
  inviteReceived: 'group.invite.received', // → ผู้ถูกเชิญ · { groupId, groupName, inviterName, inviteId }
  inviteAccepted: 'group.invite.accepted', // → ผู้เชิญ   · { groupId, groupName, inviteeName, inviteId }
  inviteDeclined: 'group.invite.declined', // → ผู้เชิญ   · { groupId, groupName, inviteeName, inviteId }
} as const;

export type AuditEntry = {
  /** ชื่อ action ของ ADR 0003 */
  action: string;
  targetType: 'group' | 'member' | 'invite';
  targetId: string;
  groupId: string;
  /** ห้ามมี PIN/token/hash/โค้ดเชิญ — repo ปฏิเสธคีย์ที่ตรง pin|token|hash|secret|pepper|code|password */
  meta?: Record<string, unknown>;
};

/**
 * เขียน audit_log ในฐานะผู้กระทำ · `allow.auditAsSuperAdmin` → meta.asSuperAdmin = true
 * (super admin ใช้สิทธิ์ที่ role ในกลุ่มไม่มี / ทำกับกลุ่มที่ไม่ได้เป็นสมาชิก — ADR 0003 "audit")
 * การเปลี่ยนข้อมูลของกลุ่ม/สมาชิก/คำเชิญ audit ทุกครั้งไม่ว่าใครทำ · การอ่านเรียก `auditRead` (เฉพาะเมื่อ SA ใช้สิทธิ์ SA)
 */
export async function audit(db: DbOrTx, actor: UserActor, allow: Allow, e: AuditEntry, now: number): Promise<void> {
  await insertAuditLog(
    db,
    {
      id: newId(),
      actorId: actor.id,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      groupId: e.groupId,
      meta: { ...(e.meta ?? {}), asSuperAdmin: allow.auditAsSuperAdmin },
    },
    now,
  );
}

export async function auditRead(db: DbOrTx, actor: UserActor, allow: Allow, e: AuditEntry, now: number): Promise<void> {
  if (allow.auditAsSuperAdmin) await audit(db, actor, allow, e, now);
}
