/**
 * รายชื่อ action ของ RBAC กลาง — ADR 0003 §3 + ARCHITECTURE §5 (ครอบทุกแถวของ PRD §3)
 *
 * ไฟล์นี้เป็นที่เดียวที่ประกาศ: ACTIONS, PUBLIC_ACTIONS, PIN_CHANGE_ALLOWED, SUPER_ADMIN_ONLY,
 * และชนิด resource ที่แต่ละ action รับ (ACTION_RESOURCE) — เพิ่ม action ใหม่ต้องเติมทุกที่
 * (compiler บังคับผ่าน `satisfies Record<Action, …>`)
 */

export const ACTIONS = [
  // ── บัญชี / สาธารณะ (นอกตาราง §3 — ADR 0003 ตารางล่าง) ──
  'auth.signup',
  'auth.login',
  'auth.logout',
  'auth.pinReset.request',
  'auth.pinReset.status',
  'prefs.cookie.set',
  'self.pin.change',
  'self.read',
  'self.update',
  'self.session.revokeAll',
  'self.delete',

  // ── §3 แถว 1: สร้างกลุ่ม · + รายการกลุ่มของฉัน ──
  'group.create',
  'group.list.mine',

  // ── §3 แถว 2–3: busy ของตัวเอง / ของคนอื่น ──
  'busy.create',
  'busy.update',
  'busy.delete',
  'busy.list.own',

  // ── §3 แถว 4–5: ดูกลุ่ม / ปฏิทิน / วันว่างร่วม ──
  'group.view',
  'group.calendar.view',
  'group.availability.view',

  // ── §3 แถว 6–8 + U5(ก): คำเชิญ ──
  'invite.code.create',
  'invite.direct.create',
  'invite.list',
  'invite.code.redeem',
  'invite.direct.respond',
  'invite.direct.list.mine',
  'invite.revoke',

  // ── §3 แถว 9–11: นัด ──
  'appointment.create',
  'appointment.view',
  'appointment.update',
  'appointment.cancel',
  'appointment.rsvp',
  'appointment.list.mine',

  // ── §3 แถว 12–17: จัดการกลุ่ม/สมาชิก ──
  'member.remove',
  'group.update',
  'member.setRole',
  'group.transferAdmin',
  'group.delete',
  'group.leave',

  // ── §3 แถว 18–19: super admin ──
  'pinReset.list',
  'pinReset.decide',
  'admin.console.view',
  'admin.user.list',
  'admin.user.suspend',
  'admin.user.unlock',
  'admin.group.list',
  'admin.audit.view',

  // ── อื่น ๆ ──
  'notification.list.own',
  'notification.markRead.own',
  'place.search',
] as const;

export type Action = (typeof ACTIONS)[number];

/** ทำได้โดยไม่ต้องล็อกอิน (ADR 0003 ตารางล่าง) */
export const PUBLIC_ACTIONS = [
  'auth.signup',
  'auth.login',
  'auth.pinReset.request',
  'auth.pinReset.status',
  'prefs.cookie.set',
] as const satisfies readonly Action[];

/** ทำได้ระหว่าง must_change_pin (ADR 0003 §3 ค่าคงที่ · PRD §3 กติกาเสริม · U3) */
export const PIN_CHANGE_ALLOWED = [
  'self.pin.change',
  'auth.logout',
  'prefs.cookie.set',
] as const satisfies readonly Action[];

/** เฉพาะ super admin (§3 แถว 18–19) */
export const SUPER_ADMIN_ONLY = [
  'pinReset.list',
  'pinReset.decide',
  'admin.console.view',
  'admin.user.list',
  'admin.user.suspend',
  'admin.user.unlock',
  'admin.group.list',
  'admin.audit.view',
] as const satisfies readonly Action[];

/**
 * action เฉพาะ super admin ที่เปลี่ยนข้อมูลของผู้ใช้อื่น → `auditAsSuperAdmin: true`
 * (PRD §3 กติกาเสริม "ทุกการกระทำของ super admin ต่อกลุ่ม/ผู้ใช้อื่น ลง audit log")
 * action ดูรายการ (list/view) ไม่ติดธง — ดูคำถามถึง Lead ในรายงาน R0
 */
export const SUPER_ADMIN_AUDITED = [
  'pinReset.decide',
  'admin.user.suspend',
  'admin.user.unlock',
] as const satisfies readonly (typeof SUPER_ADMIN_ONLY)[number][];

/** ชนิด resource (ดู `Resource` ใน types.ts) */
export const RESOURCE_TYPES = [
  'none',
  'self',
  'group',
  'member',
  'invite',
  'directInvite',
  'appointment',
  'busy',
  'ownedByUser',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * resource ที่แต่ละ action รับได้ — ใช้ทั้งบังคับชนิดตอน compile (`ResourceFor<A>`) และตรวจตอน runtime
 * (ส่งผิดชนิด = บั๊กของ service → `RbacMisuseError`)
 */
export const ACTION_RESOURCE = {
  'auth.signup': ['none'],
  'auth.login': ['none'],
  'auth.logout': ['none'],
  'auth.pinReset.request': ['none'],
  'auth.pinReset.status': ['none'],
  'prefs.cookie.set': ['none'],
  'self.pin.change': ['none'],
  'self.read': ['none'],
  'self.update': ['none'],
  'self.session.revokeAll': ['none'],
  'self.delete': ['self'],

  'group.create': ['none'],
  'group.list.mine': ['none'],

  'busy.create': ['none'],
  'busy.update': ['busy'],
  'busy.delete': ['busy'],
  'busy.list.own': ['none'],

  'group.view': ['group'],
  'group.calendar.view': ['group'],
  'group.availability.view': ['group'],

  'invite.code.create': ['group'],
  'invite.direct.create': ['group'],
  'invite.list': ['group'],
  'invite.code.redeem': ['none'],
  'invite.direct.respond': ['directInvite'],
  'invite.direct.list.mine': ['none'],
  'invite.revoke': ['invite'],

  'appointment.create': ['group'],
  'appointment.view': ['group', 'appointment'],
  'appointment.update': ['appointment'],
  'appointment.cancel': ['appointment'],
  'appointment.rsvp': ['appointment'],
  'appointment.list.mine': ['none'],

  'member.remove': ['member'],
  'group.update': ['group'],
  'member.setRole': ['member'],
  'group.transferAdmin': ['member'],
  'group.delete': ['group'],
  'group.leave': ['group'],

  'pinReset.list': ['none'],
  'pinReset.decide': ['none'],
  'admin.console.view': ['none'],
  'admin.user.list': ['none'],
  'admin.user.suspend': ['none'],
  'admin.user.unlock': ['none'],
  'admin.group.list': ['none'],
  'admin.audit.view': ['none'],

  'notification.list.own': ['ownedByUser'],
  'notification.markRead.own': ['ownedByUser'],
  'place.search': ['none'],
} as const satisfies Record<Action, readonly ResourceType[]>;

const PUBLIC_SET: ReadonlySet<Action> = new Set(PUBLIC_ACTIONS);
const PIN_CHANGE_SET: ReadonlySet<Action> = new Set(PIN_CHANGE_ALLOWED);
const SUPER_ADMIN_SET: ReadonlySet<Action> = new Set(SUPER_ADMIN_ONLY);
const SUPER_ADMIN_AUDITED_SET: ReadonlySet<Action> = new Set(SUPER_ADMIN_AUDITED);
const ACTION_SET: ReadonlySet<string> = new Set(ACTIONS);

export const isAction = (value: string): value is Action => ACTION_SET.has(value);
export const isPublicAction = (a: Action): boolean => PUBLIC_SET.has(a);
export const isPinChangeAllowed = (a: Action): boolean => PIN_CHANGE_SET.has(a);
export const isSuperAdminOnly = (a: Action): boolean => SUPER_ADMIN_SET.has(a);
export const isSuperAdminAudited = (a: Action): boolean => SUPER_ADMIN_AUDITED_SET.has(a);
