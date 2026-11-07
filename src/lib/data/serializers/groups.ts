// DTO ของกลุ่ม/สมาชิก/คำเชิญ (R2) — ห้ามส่ง code_hash / pin_hash / username ของคนอื่นออกจากที่นี่
// รหัสผ่านของโค้ดเชิญ: DTO ของรายการไม่มีฟิลด์ code เลย (มีเฉพาะ codeHint) · โค้ดเต็มอยู่ใน CreatedCodeInviteDto ครั้งเดียวตอนสร้าง
import type { GroupOfUser, GroupRow, GroupRole } from '@/lib/data/repos/group';
import type { InviteListRow, PendingDirectInvite } from '@/lib/data/repos/group-invite';
import type { MemberWithBusyFlag } from '@/lib/data/repos/group-member';
import { memberAppearance, type AppearanceSlots, type MemberAppearance } from '@/lib/shared/member-color';
import { sanitizeDisplayText as clean } from '@/lib/shared/name-rules';

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
  name: clean(r.group.name),
  role: r.role,
  memberCount: r.memberCount,
  createdAt: r.group.createdAt,
});

export type MemberDto = {
  userId: string;
  displayName: string;
  role: GroupRole;
  /** 0–9 · slot ที่สมาชิกเลือก (R6C) ?? hash คงที่ต่อ (ผู้ใช้, กลุ่ม) */
  colorIndex: number;
  /** 0–9 · รูปทรง (R6C) — ไม่ตั้ง = เท่ากับ hash ของสี */
  shapeIndex: number;
  joinedAt: number;
  /** R8 F1 §2.2: มี busy ที่ลงเองทับช่วง [ตอนนี้, +30 วัน) ไหม — boolean อย่างเดียว ไม่มีเวลา/ชื่อ busy (ADR 0006) */
  hasUpcomingBusy: boolean;
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
  /** หน้าตาของผู้ดูในกลุ่มนี้ (R6C picker) · null = ผู้ดูไม่ใช่สมาชิก */
  myAppearance: MyAppearanceDto | null;
};

/**
 * หน้าตาของฉันในกลุ่ม (R6C) — colorIndex/shapeIndex = ค่าที่ใช้แสดง (0–9)
 * color/shape = slot ที่เลือกไว้ (1–10) · null = "ใช้แบบอัตโนมัติ" (hash เดิม)
 */
export type MyAppearanceDto = MemberAppearance & { color: number | null; shape: number | null };

export const toMyAppearance = (groupId: string, userId: string, slots: AppearanceSlots): MyAppearanceDto => ({
  ...memberAppearance(groupId, userId, slots),
  color: slots.colorSlot,
  shape: slots.shapeSlot,
});

export const toGroupDetail = (g: GroupRow, myRole: GroupRole | null, members: MemberWithBusyFlag[], viewerId: string): GroupDetailDto => {
  const mine = members.find((m) => m.userId === viewerId);
  return {
    id: g.id,
    name: clean(g.name),
    tz: g.tz,
    freeWindowStartMin: g.freeWindowStartMin,
    freeWindowEndMin: g.freeWindowEndMin,
    minFreeMinutes: g.minFreeMinutes,
    createdAt: g.createdAt,
    myRole,
    memberCount: members.length,
    members: members.map((m) => ({
      userId: m.userId,
      displayName: clean(m.displayName),
      role: m.role,
      ...memberAppearance(g.id, m.userId, m),
      joinedAt: m.joinedAt,
      hasUpcomingBusy: m.hasUpcomingBusy === true,
    })),
    myAppearance: mine === undefined ? null : toMyAppearance(g.id, viewerId, mine),
  };
};

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
  inviteeName: r.inviteeName === null ? null : clean(r.inviteeName),
  createdBy: r.createdBy,
  creatorName: clean(r.creatorName),
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

export const toPendingInviteDto = (r: PendingDirectInvite): PendingInviteDto => ({
  ...r,
  groupName: clean(r.groupName),
  inviterName: clean(r.inviterName),
});
