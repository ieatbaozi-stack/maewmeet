/**
 * เมทริกซ์สิทธิ์ที่คาดหวัง — ถอดจาก PRD §3 ทีละแถว + LEAD_DECISIONS (Q2, Q3) + ADR 0003 §3
 * ห้ามคัดค่าจาก src/lib/rbac/can.ts — ไฟล์นี้คือ "สเปก" ที่โค้ดต้องตรง
 *
 * คอลัมน์ (6 บทบาทของ PRD §3 · super admin แยก 2 แบบตาม ADR 0003 §4.1):
 *   SA_nonmember  super admin ที่ไม่ได้อยู่กลุ่มนั้น
 *   SA_member     super admin ที่เป็นสมาชิก role "member" (ทดสอบ union สิทธิ์ SA ∪ role — ADR 0003 §2.6)
 *   GA            group admin · MOD moderator · MEM member
 *   NM            ล็อกอินแล้วแต่ไม่ใช่สมาชิก · AN ไม่ได้ล็อกอิน
 * สำหรับ action ที่ไม่ผูกกลุ่ม คอลัมน์ GA/MOD/MEM/NM = ผู้ใช้ทั่วไป (role ไม่มีผล)
 *
 * ค่า: 'allow' | รหัสปฏิเสธ | 'na' (ไม่มีกรณีนี้ในโลกจริง เช่น "เป้าหมายคือตัวเอง" ของคนที่ไม่ใช่สมาชิก)
 */
import type { Action, ResourceType } from '@/lib/rbac/actions';
import type { PolicyErrorCode } from '@/lib/rbac/types';

export const COLUMNS = ['SA_nonmember', 'SA_member', 'GA', 'MOD', 'MEM', 'NM', 'AN'] as const;
export type Column = (typeof COLUMNS)[number];

export type Expect = 'allow' | PolicyErrorCode | 'na';
export type Row = Readonly<Record<Column, Expect>>;

/**
 * scenario ของ resource ต่อ actor ในคอลัมน์:
 *  any            — ไม่มีเงื่อนไขเจ้าของ/เป้าหมาย
 *  own / other    — resource (busy, โค้ดเชิญ, นัด, คำเชิญตรง, notification) เป็น/ไม่เป็นของ actor
 *  target:<role>  — สมาชิกเป้าหมายที่เป็นคนอื่นและถือ role นั้น
 *  target:self    — เป้าหมายคือ actor เอง (role = role ของ actor)
 *  holdsGroupAdmin / noGroupAdmin — self.delete: ยังถือ role admin กลุ่มใดอยู่หรือไม่
 */
export type Scenario =
  | 'any'
  | 'own'
  | 'other'
  | 'target:member'
  | 'target:moderator'
  | 'target:admin'
  | 'target:self'
  | 'holdsGroupAdmin'
  | 'noGroupAdmin';

export type MatrixEntry = {
  /** อ้างอิงแถวใน PRD §3 / ADR 0003 */
  readonly ref: string;
  readonly resource: ResourceType;
  readonly cases: Partial<Readonly<Record<Scenario, Row>>>;
};

// ── ตัวย่อให้อ่านเทียบ PRD ได้ด้วยตา ──
const OK = 'allow';
const AUTH = 'AUTH_REQUIRED';
const NF = 'NOT_FOUND';
const FB = 'FORBIDDEN';
const ATR = 'ADMIN_TRANSFER_REQUIRED';
const NA = 'na';

const r = (
  SA_nonmember: Expect,
  SA_member: Expect,
  GA: Expect,
  MOD: Expect,
  MEM: Expect,
  NM: Expect,
  AN: Expect,
): Row => ({ SA_nonmember, SA_member, GA, MOD, MEM, NM, AN });

/** ทุกคนรวมไม่ได้ล็อกอิน */
const PUBLIC = r(OK, OK, OK, OK, OK, OK, OK);
/** ผู้ใช้ที่ล็อกอินทุกคน · ไม่ได้ล็อกอิน ❌ */
const ANY_USER = r(OK, OK, OK, OK, OK, OK, AUTH);
/** เฉพาะเจ้าของ — ของคนอื่นปฏิเสธทุกคนรวม SA */
const NOT_OWNER = r(FB, FB, FB, FB, FB, FB, AUTH);
/** สมาชิกทุก role + SA ทุกกลุ่ม · ไม่ใช่สมาชิก 404 */
const MEMBERS = r(OK, OK, OK, OK, OK, NF, AUTH);
/** §3 แถว 18–19 */
const SA_ONLY = r(OK, OK, FB, FB, FB, FB, AUTH);

export const MATRIX = {
  // ───────── นอกตาราง §3 (ADR 0003 ตารางล่าง) ─────────
  'auth.signup': { ref: 'ADR0003 PUBLIC (U1)', resource: 'none', cases: { any: PUBLIC } },
  'auth.login': { ref: 'ADR0003 PUBLIC (U1)', resource: 'none', cases: { any: PUBLIC } },
  'auth.pinReset.request': { ref: 'ADR0003 PUBLIC (U2: ขอได้แม้ไม่ล็อกอิน)', resource: 'none', cases: { any: PUBLIC } },
  'auth.pinReset.status': { ref: 'ADR0003 PUBLIC (U2)', resource: 'none', cases: { any: PUBLIC } },
  'prefs.cookie.set': { ref: 'ADR0003 PUBLIC (U14 U15)', resource: 'none', cases: { any: PUBLIC } },
  'auth.logout': { ref: 'ADR0003 ผู้ใช้ทุกคน (U1 U3)', resource: 'none', cases: { any: ANY_USER } },
  'self.pin.change': { ref: 'ADR0003 ผู้ใช้ทุกคน (U3 U13)', resource: 'none', cases: { any: ANY_USER } },
  'self.read': { ref: 'ADR0003 ผู้ใช้ทุกคน', resource: 'none', cases: { any: ANY_USER } },
  'self.update': { ref: 'ADR0003 ผู้ใช้ทุกคน (U13 U14 U15)', resource: 'none', cases: { any: ANY_USER } },
  'self.session.revokeAll': { ref: 'ADR0003 ผู้ใช้ทุกคน (U1 U13)', resource: 'none', cases: { any: ANY_USER } },
  'self.delete': {
    ref: 'ADR0003 + U13: ต้องโอน admin ของทุกกลุ่มก่อน · R5 §2 ข้อ 2: super admin ลบตัวเองผ่านแอปไม่ได้ (403)',
    resource: 'self',
    cases: {
      noGroupAdmin: r(FB, FB, OK, OK, OK, OK, AUTH),
      holdsGroupAdmin: r(FB, FB, ATR, ATR, ATR, ATR, AUTH),
    },
  },

  // ───────── §3 แถว 1 ─────────
  'group.create': { ref: '§3 สร้างกลุ่ม', resource: 'none', cases: { any: ANY_USER } },
  'group.list.mine': { ref: 'ADR0003 ผู้ใช้ทุกคน (U4)', resource: 'none', cases: { any: ANY_USER } },

  // ───────── §3 แถว 2–3 ─────────
  'busy.create': { ref: '§3 ลง busy ของตัวเอง', resource: 'none', cases: { any: ANY_USER } },
  'busy.list.own': { ref: '§3 busy ของตัวเอง', resource: 'none', cases: { any: ANY_USER } },
  'busy.update': {
    ref: '§3 แก้ busy ของตัวเอง ✅ / ของคนอื่น ❌ ทุกคน',
    resource: 'busy',
    cases: { own: ANY_USER, other: NOT_OWNER },
  },
  'busy.delete': {
    ref: '§3 ลบ busy ของตัวเอง ✅ / ของคนอื่น ❌ ทุกคน',
    resource: 'busy',
    cases: { own: ANY_USER, other: NOT_OWNER },
  },

  // ───────── §3 แถว 4–5 (Q3: SA ดูได้ทุกกลุ่ม) ─────────
  'group.view': { ref: '§3 ดูปฏิทินกลุ่ม/สมาชิก (ADR0003 แถว 4)', resource: 'group', cases: { any: MEMBERS } },
  'group.calendar.view': { ref: '§3 ดูปฏิทินกลุ่ม ✅ SA ทุกกลุ่ม · Q3', resource: 'group', cases: { any: MEMBERS } },
  'group.availability.view': { ref: '§3 ดูวันว่างร่วม', resource: 'group', cases: { any: MEMBERS } },

  // ───────── §3 แถว 6–8 ─────────
  'invite.code.create': { ref: '§3 สร้างโค้ดเชิญ', resource: 'group', cases: { any: MEMBERS } },
  'invite.direct.create': { ref: '§3 ชวนตรง (Q4)', resource: 'group', cases: { any: MEMBERS } },
  'invite.list': { ref: 'ADR0003 แถว 6 (MEM กรองใน data layer)', resource: 'group', cases: { any: MEMBERS } },
  'invite.code.redeem': {
    ref: '§3 ใช้โค้ดเชิญ: NM ✅ · สมาชิก "—" = สำเร็จ idempotent (U5) · AN ❌',
    resource: 'none',
    cases: { any: ANY_USER },
  },
  'invite.direct.respond': {
    ref: 'ADR0003 แถว 7b: เฉพาะผู้ถูกเชิญ',
    resource: 'directInvite',
    cases: { own: ANY_USER, other: NOT_OWNER },
  },
  'invite.direct.list.mine': { ref: 'ADR0003 แถว 7b', resource: 'none', cases: { any: ANY_USER } },
  'invite.revoke': {
    ref: '§3 เพิกถอนโค้ด: SA ทุกโค้ด · GA/MOD ทุกโค้ดในกลุ่ม · MEM เฉพาะที่ตัวเองสร้าง',
    resource: 'invite',
    cases: {
      own: r(OK, OK, OK, OK, OK, NF, AUTH),
      other: r(OK, OK, OK, OK, FB, NF, AUTH),
    },
  },

  // ───────── §3 แถว 9–11 (D4) ─────────
  'appointment.create': { ref: '§3 สร้างนัด (D4)', resource: 'group', cases: { any: MEMBERS } },
  'appointment.view': { ref: 'ADR0003 แถว 9', resource: 'appointment', cases: { any: MEMBERS } },
  'appointment.update': {
    ref: '§3 แก้นัด (D4): MEM เฉพาะนัดที่ตัวเองสร้าง',
    resource: 'appointment',
    cases: {
      own: r(OK, OK, OK, OK, OK, NF, AUTH),
      other: r(OK, OK, OK, OK, FB, NF, AUTH),
    },
  },
  'appointment.cancel': {
    ref: '§3 ยกเลิกนัด (D4): MEM เฉพาะนัดที่ตัวเองสร้าง',
    resource: 'appointment',
    cases: {
      own: r(OK, OK, OK, OK, OK, NF, AUTH),
      other: r(OK, OK, OK, OK, FB, NF, AUTH),
    },
  },
  'appointment.rsvp': {
    ref: '§3 RSVP: SA ✅ (ถ้าเป็นสมาชิก) · กติกาเสริม: SA นอกกลุ่มไม่ RSVP',
    resource: 'appointment',
    cases: { any: r(FB, OK, OK, OK, OK, NF, AUTH) },
  },
  'appointment.list.mine': { ref: 'ADR0003 ผู้ใช้ทุกคน (U11)', resource: 'none', cases: { any: ANY_USER } },

  // ───────── §3 แถว 12–17 ─────────
  'member.remove': {
    ref: '§3 ลบสมาชิก (D7): SA ทุกคน · GA ทุกคนยกเว้นตัวเอง · MOD เฉพาะ member · Q2: เป้าหมาย admin → 409 แม้ SA',
    resource: 'member',
    cases: {
      'target:member': r(OK, OK, OK, OK, FB, NF, AUTH),
      'target:moderator': r(OK, OK, OK, FB, FB, NF, AUTH),
      // GA: admin มีคนเดียว = ตัวเอง → ดู target:self
      'target:admin': r(ATR, ATR, NA, FB, FB, NF, AUTH),
      // R1_CONTRACT §3 ข้อ 1 (Lead): ลบตัวเองผ่าน member.remove ไม่ได้ทุกคนรวม SA → ใช้ group.leave + กฎ D8
      'target:self': r(NA, FB, FB, FB, FB, NA, NA),
    },
  },
  'group.update': {
    ref: '§3 แก้ชื่อกลุ่ม/หน้าต่างวันว่าง (D9)',
    resource: 'group',
    cases: { any: r(OK, OK, OK, OK, FB, NF, AUTH) },
  },
  'member.setRole': {
    ref: '§3 แต่งตั้ง/ปลด moderator: SA GA ✅ · เป้าหมาย admin ❌',
    resource: 'member',
    cases: {
      'target:member': r(OK, OK, OK, FB, FB, NF, AUTH),
      'target:moderator': r(OK, OK, OK, FB, FB, NF, AUTH),
      'target:admin': r(FB, FB, NA, FB, FB, NF, AUTH),
      // R1_CONTRACT §3 ข้อ 1: เปลี่ยน role ตัวเองไม่ได้ทุกคนรวม SA
      'target:self': r(NA, FB, FB, FB, FB, NA, NA),
    },
  },
  'group.transferAdmin': {
    ref: '§3 โอน admin (D8): SA GA ✅ · เป้าหมายเป็นสมาชิกและไม่ใช่ตัวเอง',
    resource: 'member',
    cases: {
      'target:member': r(OK, OK, OK, FB, FB, NF, AUTH),
      'target:moderator': r(OK, OK, OK, FB, FB, NF, AUTH),
      'target:admin': r(FB, FB, NA, FB, FB, NF, AUTH),
      'target:self': r(NA, FB, FB, FB, FB, NA, NA),
    },
  },
  'group.delete': { ref: '§3 ลบกลุ่ม', resource: 'group', cases: { any: r(OK, OK, OK, FB, FB, NF, AUTH) } },
  'group.leave': {
    ref: '§3 ออกจากกลุ่ม (D8): GA ต้องโอนก่อน · NM "—"',
    resource: 'group',
    cases: { any: r(NF, OK, ATR, OK, OK, NF, AUTH) },
  },
  'member.setOwnAppearance': {
    ref: 'R6C_CONTRACT §2 (F3a): สมาชิกทุก role ตั้งสี/รูปร่างของตัวเอง · SA นอกกลุ่ม 403 · NM 404',
    resource: 'group',
    cases: { any: r(FB, OK, OK, OK, OK, NF, AUTH) },
  },
  'member.setCurrentGroup': {
    ref: 'R6D G1 / ADR 0009 §5: จำกลุ่มปัจจุบัน (คุกกี้ mm_group) · สมาชิกทุก role · SA นอกกลุ่ม 403 · NM 404',
    resource: 'group',
    cases: { any: r(FB, OK, OK, OK, OK, NF, AUTH) },
  },

  // ───────── §3 แถว 18–19 ─────────
  'pinReset.list': { ref: '§3 อนุมัติ/ปฏิเสธ reset PIN', resource: 'none', cases: { any: SA_ONLY } },
  'pinReset.decide': { ref: '§3 อนุมัติ/ปฏิเสธ reset PIN', resource: 'none', cases: { any: SA_ONLY } },
  'admin.console.view': { ref: '§3 หน้า super admin', resource: 'none', cases: { any: SA_ONLY } },
  'admin.user.list': { ref: '§3 หน้า super admin', resource: 'none', cases: { any: SA_ONLY } },
  'admin.user.suspend': { ref: '§3 หน้า super admin', resource: 'none', cases: { any: SA_ONLY } },
  'admin.user.unlock': { ref: '§3 หน้า super admin', resource: 'none', cases: { any: SA_ONLY } },
  'admin.group.list': { ref: '§3 หน้า super admin', resource: 'none', cases: { any: SA_ONLY } },
  'admin.group.view': { ref: '§3 หน้า super admin · R5 §2 ข้อ 3 (รายละเอียดกลุ่ม + audit)', resource: 'none', cases: { any: SA_ONLY } },
  'admin.audit.view': { ref: '§3 หน้า super admin', resource: 'none', cases: { any: SA_ONLY } },

  // ───────── อื่น ๆ ─────────
  'notification.list.own': {
    ref: 'ADR0003 ownerId === actor.id (ADR 0007)',
    resource: 'ownedByUser',
    cases: { own: ANY_USER, other: NOT_OWNER },
  },
  'notification.markRead.own': {
    ref: 'ADR0003 ownerId === actor.id (ADR 0007)',
    resource: 'ownedByUser',
    cases: { own: ANY_USER, other: NOT_OWNER },
  },
} as const satisfies Record<Action, MatrixEntry>;

/** action ที่ระหว่าง must_change_pin ยังทำได้ (PRD U3 + ADR 0003 เพิ่ม prefs.cookie.set) */
export const EXPECT_PIN_CHANGE_ALLOWED: readonly Action[] = ['self.pin.change', 'auth.logout', 'prefs.cookie.set'];

/**
 * action ที่ SA ทำแล้วต้องลง audit (ADR 0003 Test requirements: audit) — ใช้ตรวจธง auditAsSuperAdmin
 * R1_CONTRACT §3 ข้อ 4: เพิ่ม admin.audit.view (การเปิดดู audit เป็นเรื่องอ่อนไหว)
 */
export const EXPECT_SA_AUDITED_SA_ONLY: readonly Action[] = [
  'pinReset.decide',
  'admin.user.suspend',
  'admin.user.unlock',
  'admin.group.view',
  'admin.audit.view',
];

// ───────── R2-1: ข้อกำหนดกลุ่ม/สมาชิก/คำเชิญที่ตรวจเป็น "กฎ" ข้ามช่อง (ถอดจาก PRD §3 + D7/D8 ตรง ๆ) ─────────

/**
 * D7/D8: "ไม่มีใครลบ/เปลี่ยน role ของ admin ได้ นอกจากผ่านการโอน" — เป้าหมายถือ role admin
 * ต้องไม่ allow ให้ actor ใดเลย (ทั้ง 7 คอลัมน์)
 */
export const ADMIN_TARGET_NEVER_ALLOWED: readonly Action[] = ['member.remove', 'member.setRole', 'group.transferAdmin'];

/** D7: moderator ลบได้เฉพาะ role member */
export const MOD_REMOVABLE_TARGET_ROLES = ['member'] as const;

/**
 * `invite.list` (§3 แถว 6): คนที่ "เห็นทุกโค้ดในกลุ่ม" vs "เห็นเฉพาะที่ตัวเองสร้าง" — data layer กรองด้วย
 * can(actor,'invite.revoke',row) ดังนั้นผลกรองต้องตรงตารางนี้ (own = โค้ดที่ actor สร้าง, other = โค้ดของคนอื่น)
 */
export const INVITE_LIST_VISIBLE: Readonly<Record<'SA_nonmember' | 'SA_member' | 'GA' | 'MOD' | 'MEM', { own: boolean; other: boolean }>> = {
  SA_nonmember: { own: true, other: true },
  SA_member: { own: true, other: true },
  GA: { own: true, other: true },
  MOD: { own: true, other: true },
  MEM: { own: true, other: false },
};
