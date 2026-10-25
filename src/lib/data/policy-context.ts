// policy-context — ARCHITECTURE §2 · ADR 0003 §1
// โหลด GroupCtx (กลุ่มมีอยู่/ถูกลบ + role ของ actor) ด้วย query เดียว แล้วส่งให้ can() ของ src/lib/rbac (pure)
//
// กฎป้องกัน IDOR (R2-6): กลุ่มที่ไม่มีอยู่ = กลุ่มที่ถูกลบ = `{deleted: true, actorRole: null}` → can() ตอบ NOT_FOUND เหมือนกันทุกกรณี
// (แม้ super admin — ด่านกลุ่มตัดก่อนกฎของ action) จึงแยก "ไม่มี" ออกจาก "ไม่ใช่สมาชิก" ไม่ได้จากภายนอก
// actor ที่ไม่ใช่ user (anonymous) → ไม่แตะ DB; can() ปฏิเสธ AUTH_REQUIRED ที่ด่านแรกอยู่แล้ว
import type { DbOrTx } from '@/db/client';
import { findAppointmentAccess, type AppointmentRow } from '@/lib/data/repos/appointment';
import { findGroupAccess } from '@/lib/data/repos/group-member';
import type { Actor, GroupCtx } from '@/lib/rbac/types';

export const goneGroupCtx = (id: string): GroupCtx => ({ id, deleted: true, actorRole: null });

export async function loadGroupCtx(db: DbOrTx, actor: Actor, groupId: string): Promise<GroupCtx> {
  if (actor.kind !== 'user') return goneGroupCtx(groupId);
  const row = await findGroupAccess(db, groupId, actor.id);
  if (!row) return goneGroupCtx(groupId);
  return { id: row.id, deleted: row.deletedAt !== null, actorRole: row.role };
}

export type AppointmentCtx = {
  /** นัดที่โหลดได้ · null = ไม่มี / ผู้เรียกไม่ใช่ user — ผู้เรียกต้อง authorize() ก่อนใช้ค่านี้ */
  appointment: AppointmentRow | null;
  group: GroupCtx;
  groupName: string;
};

/**
 * โหลดนัด + GroupCtx ของกลุ่มที่นัดสังกัด + role ของ actor ใน query เดียว (ใช้กับ appointment.* ที่รับ :id)
 * นัดไม่มีอยู่ = กลุ่มที่ถูกลบ = `{deleted: true, actorRole: null}` → can() ตอบ NOT_FOUND เหมือนคนนอกกลุ่มทุกไบต์ (กัน IDOR / oracle)
 */
export async function loadAppointmentCtx(db: DbOrTx, actor: Actor, appointmentId: string): Promise<AppointmentCtx> {
  const gone: AppointmentCtx = { appointment: null, group: goneGroupCtx(appointmentId), groupName: '' };
  if (actor.kind !== 'user') return gone;
  const row = await findAppointmentAccess(db, appointmentId, actor.id);
  if (!row) return gone;
  return {
    appointment: row.appointment,
    group: { id: row.appointment.groupId, deleted: row.groupDeleted, actorRole: row.role },
    groupName: row.groupName,
  };
}
