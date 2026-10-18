// DTO ของกลุ่ม/สมาชิก/คำเชิญ (R2) — ห้ามส่ง code_hash / pin_hash / username ของคนอื่นออกจากที่นี่
// รหัสผ่านของโค้ดเชิญ: DTO ของรายการไม่มีฟิลด์ code เลย (มีเฉพาะ codeHint) · โค้ดเต็มอยู่ใน CreatedCodeInviteDto ครั้งเดียวตอนสร้าง
import type { GroupOfUser, GroupRow, GroupRole } from '@/lib/data/repos/group';
import type { InviteListRow, PendingDirectInvite } from '@/lib/data/repos/group-invite';
import type { MemberWithUser } from '@/lib/data/repos/group-member';
import { memberColorIndex } from '@/lib/shared/member-color';

export type GroupSummaryDto = {
  id: string;
  name: string;
  /** role ของฉันในกลุ่ม */
  role: GroupRole;
  memberCount: number;
  createdAt: number;
};

export const toGroupSummary = (r: GroupOfUser): GroupSummaryDto => ({
  id: r.group.id,
  name: r.group.name,
  role: r.role,
  memberCount: r.memberCount,
  createdAt: r.group.createdAt,
});

export type MemberDto = {
  userId: string;
  displayName: string;
  role: GroupRole;
  /** 0–9 · คงที่ต่อ (ผู้ใช้, กลุ่ม) */
  colorIndex: number;
  joinedAt: number;
};

export type GroupDetailDto = {
  id: string;
  name: string;
  tz: string;
  freeWindowStartMin: number;
  freeWindowEndMin: number;
  minFreeMinutes: number;
  createdAt: number;
  /** role ของผู้ดู · null = super admin ที่ไม่ใช่สมาชิก */
  myRole: GroupRole | null;
  memberCount: number;
  members: MemberDto[];
};

export const toGroupDetail = (g: GroupRow, myRole: GroupRole | null, members: MemberWithUser[]): GroupDetailDto => ({
  id: g.id,
  name: g.name,
  tz: g.tz,
  freeWindowStartMin: g.freeWindowStartMin,
  freeWindowEndMin: g.freeWindowEndMin,
  minFreeMinutes: g.minFreeMinutes,
  createdAt: g.createdAt,
  myRole,
  memberCount: members.length,
  members: members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    role: m.role,
    colorIndex: memberColorIndex(g.id, m.userId),
    joinedAt: m.joinedAt,
  })),
});

export type InviteDto = {
  id: string;
  kind: 'code' | 'direct';
  /** 4 ตัวท้ายของโค้ด (kind = code) */
  codeHint: string | null;
  /** ผู้รับ (kind = direct) */
  inviteeName: string | null;
  createdBy: string;
  creatorName: string;
  createdAt: number;
  expiresAt: number;
  usesCount: number;
};

export const toInviteDto = (r: InviteListRow): InviteDto => ({
  id: r.id,
  kind: r.kind,
  codeHint: r.codeHint,
  inviteeName: r.inviteeName,
  createdBy: r.createdBy,
  creatorName: r.creatorName,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  usesCount: r.usesCount,
});

/** ผลของการสร้างโค้ด — `code` (XXXX-XXXX) อยู่ที่นี่ที่เดียว และคืนครั้งเดียว */
export type CreatedCodeInviteDto = {
  id: string;
  code: string;
  codeHint: string;
  createdAt: number;
  expiresAt: number;
};

export type PendingInviteDto = PendingDirectInvite;
