/**
 * ชนิดข้อมูลของ RBAC กลาง — ADR 0003 §1
 * `policy-context.ts` (Platform) โหลดค่าเหล่านี้จาก DB แล้วส่งเข้า `can()` — rbac ไม่ query เอง
 */
import type { ErrorCode } from '@/lib/shared/errors';
import type { Action, ACTION_RESOURCE } from './actions';

/** role ในกลุ่ม (ตรงกับ `group_member.role` — ARCHITECTURE §3) */
export type GroupRole = 'admin' | 'moderator' | 'member';

/** สถานะบัญชี (ตรงกับ `user.status` — ARCHITECTURE §3) */
export type AccountStatus = 'active' | 'suspended' | 'deleted';

export type AnonymousActor = { readonly kind: 'anonymous' };

export type UserActor = {
  readonly kind: 'user';
  readonly id: string;
  /** `user.is_admin = 1` (super admin ตั้งใน DB) */
  readonly isSuperAdmin: boolean;
  readonly status: AccountStatus;
  /** `user.must_change_pin = 1` (เข้าด้วย 123456 แล้ว — ADR 0002 §5, PRD U3) */
  readonly mustChangePin: boolean;
};

export type Actor = AnonymousActor | UserActor;

/** กลุ่มที่ resource ผูกอยู่ + role ของ actor ในกลุ่มนั้น */
export type GroupCtx = {
  readonly id: string;
  /** `group.deleted_at IS NOT NULL` → ทุก action ที่ผูกกลุ่มได้ NOT_FOUND */
  readonly deleted: boolean;
  /** role ของ actor ในกลุ่ม · `null` = ไม่ใช่สมาชิก (หรือ anonymous) */
  readonly actorRole: GroupRole | null;
};

export type NoResource = { readonly type: 'none' };
/** บัญชีของ actor เอง — ใช้กับ `self.delete` (ต้องไม่ถือ role admin กลุ่มใด — U13) */
export type SelfResource = { readonly type: 'self'; readonly holdsGroupAdmin: boolean };
export type GroupResource = { readonly type: 'group'; readonly group: GroupCtx };
/** สมาชิกเป้าหมาย (ลบ/ตั้ง role/โอน admin) — เป้าหมายต้องเป็นสมาชิกปัจจุบัน (ไม่ใช่ → service ตอบ NOT_FOUND ก่อนถึง can) */
export type MemberResource = {
  readonly type: 'member';
  readonly group: GroupCtx;
  readonly targetUserId: string;
  readonly targetRole: GroupRole;
};
export type InviteResource = { readonly type: 'invite'; readonly group: GroupCtx; readonly createdBy: string };
export type DirectInviteResource = { readonly type: 'directInvite'; readonly inviteeUserId: string };
export type AppointmentResource = {
  readonly type: 'appointment';
  readonly group: GroupCtx;
  readonly createdBy: string;
};
export type BusyResource = { readonly type: 'busy'; readonly ownerId: string };
/** ของที่ผูกผู้ใช้คนเดียว เช่น notification */
export type OwnedByUserResource = { readonly type: 'ownedByUser'; readonly ownerId: string };

// ───────── R18 §S (ADR 0016 §5.1) — แชร์นัดให้คนนอกกลุ่ม ─────────
/**
 * ลิงก์ชวนของนัด (`appointment_share_link`) — ใช้กับ `appointment.share.revoke` และกรองรายการลิงก์ในหน้านัด
 * `group` = กลุ่มของนัด + role ของ actor · `appointmentCreatedBy` = `appointment.created_by` · `linkCreatedBy` = `link.created_by`
 * ลิงก์ที่ไม่ใช่ของนัดใน path → policy-context ส่ง `goneGroupCtx` (NOT_FOUND เหมือนคนนอก)
 */
export type ShareLinkResource = {
  readonly type: 'shareLink';
  readonly group: GroupCtx;
  readonly appointmentCreatedBy: string;
  readonly linkCreatedBy: string;
};
/**
 * สถานะของ **ผู้กระทำเอง** ต่อนัดนี้ในฐานะแขก — ใช้กับ `appointment.guest.view/rsvp/leave`
 * `isGuest` = มีแถว `appointment_guest (appointment_id, actor.id)` ที่ `removed_at IS NULL` (ถูกนำออก/ไม่มีแถว = false)
 * `group.actorRole` ต้องโหลดจริง (สมาชิก = ไม่ใช่ทางของแขก → NOT_FOUND) · `group.deleted` = กลุ่มของนัดถูกลบ
 */
export type AppointmentGuestResource = {
  readonly type: 'appointmentGuest';
  readonly group: GroupCtx;
  readonly isGuest: boolean;
};
/**
 * แขกเป้าหมายที่สมาชิกจะนำออก — ใช้กับ `appointment.guest.remove`
 * ต้องเป็นแขกที่มีผล (`removed_at IS NULL`) ของนัดนี้ ไม่งั้น service ตอบ NOT_FOUND ก่อนถึง can (แบบ requireTargetMember)
 * `invitedBy` = `appointment_guest.invited_by` (null เมื่อผู้ชวนถูก SET NULL)
 */
export type GuestTargetResource = {
  readonly type: 'guestTarget';
  readonly group: GroupCtx;
  readonly appointmentCreatedBy: string;
  readonly invitedBy: string | null;
  readonly guestUserId: string;
};

export type Resource =
  | NoResource
  | SelfResource
  | GroupResource
  | MemberResource
  | InviteResource
  | DirectInviteResource
  | AppointmentResource
  | BusyResource
  | OwnedByUserResource
  | ShareLinkResource
  | AppointmentGuestResource
  | GuestTargetResource;

/** resource ที่ action `A` รับได้ (compile-time) */
export type ResourceFor<A extends Action> = Extract<Resource, { type: (typeof ACTION_RESOURCE)[A][number] }>;

/** รหัสที่ policy ตอบได้ — ทุกตัวต้องอยู่ใน ErrorCode ของ `src/lib/shared/errors.ts` */
export type PolicyErrorCode =
  | 'AUTH_REQUIRED'
  | 'ACCOUNT_SUSPENDED'
  | 'PIN_CHANGE_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ADMIN_TRANSFER_REQUIRED';

/** บังคับตอน compile: ถ้า Platform ตัดรหัสใดออกจาก ErrorCode บรรทัดนี้จะ error */
type AssertSubset<T extends ErrorCode> = T;
export type PolicyErrorCodeChecked = AssertSubset<PolicyErrorCode>;

export type PolicyStatus = 401 | 403 | 404 | 409;

export type Allow = {
  readonly allow: true;
  /** service ต้องเขียน audit_log ในฐานะ super admin (ใช้สิทธิ์ SA ที่ role ในกลุ่มไม่มี / action SA ที่เปลี่ยนข้อมูลผู้อื่น) */
  readonly auditAsSuperAdmin: boolean;
};
export type Deny = { readonly allow: false; readonly code: PolicyErrorCode; readonly status: PolicyStatus };
export type Decision = Allow | Deny;
