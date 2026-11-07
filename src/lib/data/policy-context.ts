// policy-context — ARCHITECTURE §2 · ADR 0003 §1
// โหลด GroupCtx (กลุ่มมีอยู่/ถูกลบ + role ของ actor) ด้วย query เดียว แล้วส่งให้ can() ของ src/lib/rbac (pure)
//
// กฎป้องกัน IDOR (R2-6): กลุ่มที่ไม่มีอยู่ = กลุ่มที่ถูกลบ = `{deleted: true, actorRole: null}` → can() ตอบ NOT_FOUND เหมือนกันทุกกรณี
// (แม้ super admin — ด่านกลุ่มตัดก่อนกฎของ action) จึงแยก "ไม่มี" ออกจาก "ไม่ใช่สมาชิก" ไม่ได้จากภายนอก
// actor ที่ไม่ใช่ user (anonymous) → ไม่แตะ DB; can() ปฏิเสธ AUTH_REQUIRED ที่ด่านแรกอยู่แล้ว
import type { DbOrTx } from '@/db/client';
import { findAppointmentAccess, type AppointmentRow } from '@/lib/data/repos/appointment';
import type { GroupRow } from '@/lib/data/repos/group';
import { findGroupWithAccess } from '@/lib/data/repos/group-member';
import type { Actor, GroupCtx } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';

export const goneGroupCtx = (id: string): GroupCtx => ({ id, deleted: true, actorRole: null });

/**
 * GroupCtx + แถวกลุ่มที่อ่านมาใน query เดียวกัน (R7 B-3) · `row` = null เมื่อไม่มีกลุ่ม / actor ไม่ใช่ user
 * can() ใช้เฉพาะ id/deleted/actorRole — service อ่าน `row` ผ่าน `groupRowOf()` *หลัง* authorize() ผ่านแล้วเท่านั้น
 */
export type LoadedGroupCtx = GroupCtx & { readonly row: GroupRow | null };

export async function loadGroupCtx(db: DbOrTx, actor: Actor, groupId: string): Promise<LoadedGroupCtx> {
  if (actor.kind !== 'user') return { ...goneGroupCtx(groupId), row: null };
  const hit = await findGroupWithAccess(db, groupId, actor.id);
  if (!hit) return { ...goneGroupCtx(groupId), row: null };
  return { id: hit.group.id, deleted: hit.group.deletedAt !== null, actorRole: hit.role, row: hit.group };
}

/** แถวกลุ่มที่ยังไม่ถูกลบ — เรียกหลัง authorize() เท่านั้น (ไม่มี/ลบแล้ว ถูก can() ตัดเป็น NOT_FOUND ไปก่อน · เช็กซ้ำกันพลาด) */
export function groupRowOf(group: LoadedGroupCtx): GroupRow {
  if (!group.row || group.row.deletedAt !== null) throw new AppError('NOT_FOUND');
  return group.row;
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
