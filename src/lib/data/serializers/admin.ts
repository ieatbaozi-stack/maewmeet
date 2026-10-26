// DTO ของหน้า super admin (R5 — U12) — ที่เดียวที่ข้อมูล admin ออกจากระบบ (ไม่ reuse row ดิบ — R5_CONTRACT §6)
//  - ผู้ใช้: ไม่มี pin_hash / pepper version / locale / theme / line id
//  - กลุ่ม: ชื่อ + role + จำนวน เท่านั้น · ไม่มี busy / ชื่อหรือรายละเอียดนัด / ตำแหน่ง / หมายเหตุ (ADR 0006)
//  - audit: meta ผ่าน whitelist ต่อ action — คีย์ที่ไม่รู้จัก/ค่าที่ไม่ใช่ค่าพื้นฐานถูกตัดทิ้ง (repo ปฏิเสธคีย์ต้องห้ามตอนเขียนอยู่แล้ว)
import type { AdminGroupDetailRow, AdminGroupRow, AdminMemberRow } from '@/lib/data/repos/admin-groups';
import type { AdminUserRow } from '@/lib/data/repos/admin-users';
import type { AuditListRow } from '@/lib/data/repos/admin-audit';
import type { GroupRole } from '@/lib/data/repos/group';
import { sanitizeDisplayText as clean } from '@/lib/shared/name-rules';

// ───────── ผู้ใช้ ─────────
export type AdminUserDto = {
  id: string;
  username: string;
  displayName: string;
  status: 'active' | 'suspended' | 'deleted';
  isAdmin: boolean;
  createdAt: number;
  groupCount: number;
  locked: boolean;
  lockedUntil: number | null;
  hasOpenReset: boolean;
};

export const toAdminUserDto = (r: AdminUserRow): AdminUserDto => ({
  id: r.id,
  username: r.username,
  displayName: clean(r.displayName),
  status: r.status,
  isAdmin: r.isAdmin,
  createdAt: r.createdAt,
  groupCount: r.groupCount,
  locked: r.lockedUntil !== null,
  lockedUntil: r.lockedUntil,
  hasOpenReset: r.hasOpenReset,
});

/** ผลของ suspend / unsuspend / unlock */
export type AdminUserActionDto = { id: string; status: 'active' | 'suspended'; changed: boolean };

// ───────── กลุ่ม ─────────
export type AdminGroupDto = {
  id: string;
  name: string;
  adminUsername: string | null;
  memberCount: number;
  createdAt: number;
  deletedAt: number | null;
};

export const toAdminGroupDto = (r: AdminGroupRow): AdminGroupDto => ({
  id: r.id,
  name: clean(r.name),
  adminUsername: r.adminUsername,
  memberCount: r.memberCount,
  createdAt: r.createdAt,
  deletedAt: r.deletedAt,
});

export type AdminGroupMemberDto = { userId: string; username: string; displayName: string; role: GroupRole; joinedAt: number };

export type AdminGroupDetailDto = {
  id: string;
  name: string;
  tz: string;
  createdAt: number;
  deletedAt: number | null;
  memberCount: number;
  openAppointmentCount: number;
  members: AdminGroupMemberDto[];
};

export const toAdminGroupDetailDto = (g: AdminGroupDetailRow, members: AdminMemberRow[]): AdminGroupDetailDto => ({
  id: g.id,
  name: clean(g.name),
  tz: g.tz,
  createdAt: g.createdAt,
  deletedAt: g.deletedAt,
  memberCount: members.length,
  openAppointmentCount: g.openAppointmentCount,
  members: members.map((m) => ({ userId: m.userId, username: m.username, displayName: clean(m.displayName), role: m.role, joinedAt: m.joinedAt })),
});

// ───────── audit ─────────

/**
 * คีย์ meta ที่แสดงได้ต่อ action (ตรงกับที่ service เขียนจริง — grep `action: '` ใน src/lib/**) · action ที่ไม่อยู่ในตาราง → meta = {}
 * ห้ามเพิ่มคีย์ที่เป็นข้อความอิสระของผู้ใช้ (ชื่อนัด/หมายเหตุ/ชื่อที่แสดง) — ค่าทั้งหมดเป็น id / enum / ตัวเลข / ช่วงวันที่
 */
export const AUDIT_META_WHITELIST: Readonly<Record<string, readonly string[]>> = {
  'pinReset.decide': ['decision', 'targetUserId'],
  'script.adminResetPin': ['targetUserId'],
  'group.create': ['asSuperAdmin'],
  'group.view': ['asSuperAdmin'],
  'group.update': ['fields', 'asSuperAdmin'],
  'group.delete': ['asSuperAdmin'],
  'group.leave': ['asSuperAdmin'],
  'group.transferAdmin': ['fromUserId', 'toUserId', 'asSuperAdmin'],
  'group.calendar.view': ['from', 'to', 'asSuperAdmin'],
  'group.availability.view': ['from', 'to', 'asSuperAdmin'],
  'member.remove': ['targetUserId', 'targetRole', 'asSuperAdmin'],
  'member.setRole': ['targetUserId', 'from', 'to', 'asSuperAdmin'],
  'invite.code.create': ['inviteId', 'asSuperAdmin'],
  'invite.direct.create': ['inviteId', 'inviteeUserId', 'asSuperAdmin'],
  'invite.list': ['asSuperAdmin'],
  'invite.revoke': ['inviteId', 'kind', 'asSuperAdmin'],
  'invite.code.redeem': ['inviteId', 'asSuperAdmin'],
  'invite.direct.respond': ['inviteId', 'decision', 'asSuperAdmin'],
  'appointment.create': ['appointmentId', 'asSuperAdmin'],
  'appointment.update': ['appointmentId', 'fields', 'asSuperAdmin'],
  'appointment.cancel': ['appointmentId', 'asSuperAdmin'],
  'appointment.view': ['appointmentId', 'scope', 'asSuperAdmin'],
  'appointment.check': ['asSuperAdmin'],
  // R5
  'user.delete': [],
  'admin.user.suspend': ['state', 'asSuperAdmin'],
  'admin.user.unlock': ['wasLocked', 'asSuperAdmin'],
  'admin.group.view': ['asSuperAdmin'],
  'admin.audit.view': ['filtered', 'asSuperAdmin'],
};

const META_STRING_MAX = 64;
const META_ARRAY_MAX = 16;

type MetaValue = string | number | boolean | null | string[];

/** ค่าพื้นฐานเท่านั้น: string (≤64 หลังทำความสะอาด) / number จำกัด / boolean / null / อาร์เรย์ของ string (≤16 ตัว) · อื่น ๆ = ตัดทิ้ง */
function safeMetaValue(v: unknown): MetaValue | undefined {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return clean(v).slice(0, META_STRING_MAX);
  if (Array.isArray(v)) {
    if (!v.every((x) => typeof x === 'string')) return undefined;
    return (v as string[]).slice(0, META_ARRAY_MAX).map((x) => clean(x).slice(0, META_STRING_MAX));
  }
  return undefined;
}

export function filterAuditMeta(action: string, meta: unknown): Record<string, MetaValue> {
  const allowed = Object.prototype.hasOwnProperty.call(AUDIT_META_WHITELIST, action) ? AUDIT_META_WHITELIST[action]! : [];
  const out: Record<string, MetaValue> = {};
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return out;
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(meta, key)) continue;
    const v = safeMetaValue((meta as Record<string, unknown>)[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export type AuditRowDto = {
  id: string;
  createdAt: number;
  action: string;
  /** null = ระบบ (สคริปต์/cron) หรือผู้กระทำที่ไม่มีแถวแล้ว */
  actor: { id: string; username: string } | null;
  targetType: string;
  targetId: string;
  groupId: string | null;
  meta: Record<string, MetaValue>;
};

export const toAuditRowDto = (r: AuditListRow): AuditRowDto => ({
  id: r.id,
  createdAt: r.createdAt,
  action: r.action,
  actor: r.actorId !== null && r.actorUsername !== null ? { id: r.actorId, username: r.actorUsername } : null,
  targetType: r.targetType,
  targetId: r.targetId,
  groupId: r.groupId,
  meta: filterAuditMeta(r.action, r.meta),
});
