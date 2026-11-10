// Route manifest — ARCHITECTURE §2/§5 · ADR 0003 §4 ข้อ 5–6
// ทุก src/app/api/**/route.ts ต้องลงทะเบียน {method, path, action} ที่นี่ (เทสต์ tests/platform/manifest.test.ts สแกนไฟล์จริง)
// route() ใน ./route.ts จะโยน error ตอนโหลดโมดูลถ้า method+path ไม่อยู่ในนี้
// path ใช้รูป Next แบบ `:param` (เช่น /api/groups/:gid) — ตรงกับโฟลเดอร์ [gid]
import type { Action } from '@/lib/rbac/actions';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * - `actor`: ผู้ใช้/ไม่ระบุตัว — non-GET ผ่าน CSRF Origin + JSON · สิทธิ์ตัดสินใน service ด้วย authorize(action)
 * - `cron`: ระบบ — Bearer CRON_SECRET (constant-time) · ไม่มี actor/CSRF (server-to-server)
 * - `public`: GET สาธารณะที่ไม่ต้องรู้ actor และไม่ผูก action (health)
 */
export type RouteAuth = 'actor' | 'cron' | 'public';

export type ManifestEntry = {
  readonly method: HttpMethod;
  readonly path: string;
  /** action ของ ADR 0003 ที่ service เรียก authorize() · null = ไม่ผ่าน RBAC (cron/health) */
  readonly action: Action | null;
  readonly auth: RouteAuth;
  /** บทบาทเจ้าของไฟล์ route (R0_CONTRACT §4) */
  readonly owner: 'platform' | 'auth' | 'ops' | 'integrations';
};

export const ROUTE_MANIFEST = [
  // ── ระบบ (R0) ──
  { method: 'GET', path: '/api/cron/daily', action: null, auth: 'cron', owner: 'platform' },
  { method: 'POST', path: '/api/cron/heartbeat', action: null, auth: 'cron', owner: 'platform' },
  { method: 'GET', path: '/api/health', action: null, auth: 'public', owner: 'ops' },
  // ── U14/U15 (R0) ──
  { method: 'POST', path: '/api/prefs', action: 'prefs.cookie.set', auth: 'actor', owner: 'platform' },
  // ── U1–U3, U12, U13 (R1 · Auth & Access) ──
  { method: 'POST', path: '/api/auth/signup', action: 'auth.signup', auth: 'actor', owner: 'auth' },
  { method: 'POST', path: '/api/auth/login', action: 'auth.login', auth: 'actor', owner: 'auth' },
  { method: 'POST', path: '/api/auth/logout', action: 'auth.logout', auth: 'actor', owner: 'auth' },
  { method: 'POST', path: '/api/auth/logout-all', action: 'self.session.revokeAll', auth: 'actor', owner: 'auth' },
  { method: 'GET', path: '/api/auth/session', action: 'self.read', auth: 'actor', owner: 'auth' },
  { method: 'POST', path: '/api/auth/pin-reset', action: 'auth.pinReset.request', auth: 'actor', owner: 'auth' },
  { method: 'GET', path: '/api/auth/pin-reset/status', action: 'auth.pinReset.status', auth: 'actor', owner: 'auth' },
  { method: 'GET', path: '/api/auth/admin/pin-resets', action: 'pinReset.list', auth: 'actor', owner: 'auth' },
  { method: 'POST', path: '/api/auth/admin/pin-resets/:id/approve', action: 'pinReset.decide', auth: 'actor', owner: 'auth' },
  { method: 'POST', path: '/api/auth/admin/pin-resets/:id/reject', action: 'pinReset.decide', auth: 'actor', owner: 'auth' },
  { method: 'POST', path: '/api/auth/pin', action: 'self.pin.change', auth: 'actor', owner: 'auth' },
  // ── U4–U6 (R2 · Platform) ──
  { method: 'POST', path: '/api/groups', action: 'group.create', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/groups', action: 'group.list.mine', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/groups/:gid', action: 'group.view', auth: 'actor', owner: 'platform' },
  { method: 'PATCH', path: '/api/groups/:gid', action: 'group.update', auth: 'actor', owner: 'platform' },
  { method: 'DELETE', path: '/api/groups/:gid', action: 'group.delete', auth: 'actor', owner: 'platform' },
  { method: 'DELETE', path: '/api/groups/:gid/members/:uid', action: 'member.remove', auth: 'actor', owner: 'platform' },
  { method: 'PATCH', path: '/api/groups/:gid/members/:uid', action: 'member.setRole', auth: 'actor', owner: 'platform' },
  { method: 'PATCH', path: '/api/groups/:gid/members/me/appearance', action: 'member.setOwnAppearance', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/groups/:gid/transfer-admin', action: 'group.transferAdmin', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/groups/:gid/leave', action: 'group.leave', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/groups/:gid/invites/direct', action: 'invite.direct.create', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/groups/:gid/invites/code', action: 'invite.code.create', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/groups/:gid/invites', action: 'invite.list', auth: 'actor', owner: 'platform' },
  { method: 'DELETE', path: '/api/groups/:gid/invites/:iid', action: 'invite.revoke', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/invites/redeem', action: 'invite.code.redeem', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/me/invites', action: 'invite.direct.list.mine', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/me/invites/:iid/accept', action: 'invite.direct.respond', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/me/invites/:iid/decline', action: 'invite.direct.respond', auth: 'actor', owner: 'platform' },
  // ── U7–U8 (R3 · Platform) ──
  { method: 'GET', path: '/api/me/busy', action: 'busy.list.own', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/me/busy', action: 'busy.create', auth: 'actor', owner: 'platform' },
  { method: 'PATCH', path: '/api/me/busy/:id', action: 'busy.update', auth: 'actor', owner: 'platform' },
  { method: 'DELETE', path: '/api/me/busy/:id', action: 'busy.delete', auth: 'actor', owner: 'platform' },
  // ── R14 (Platform) — busy routine ของฉัน (ADR 0012 §5) · "เฉพาะวันนี้" ใช้ PATCH/DELETE /api/me/busy/:id เดิม ──
  { method: 'GET', path: '/api/me/busy-routines', action: 'busy.routine.list.own', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/me/busy-routines', action: 'busy.routine.create', auth: 'actor', owner: 'platform' },
  { method: 'PATCH', path: '/api/me/busy-routines/:id', action: 'busy.routine.update', auth: 'actor', owner: 'platform' },
  { method: 'DELETE', path: '/api/me/busy-routines/:id', action: 'busy.routine.delete', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/groups/:gid/calendar', action: 'group.calendar.view', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/groups/:gid/availability', action: 'group.availability.view', auth: 'actor', owner: 'platform' },
  // ── U10–U11, D11, ADR 0007 (R4B · Platform) ──
  { method: 'POST', path: '/api/groups/:gid/appointments', action: 'appointment.create', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/groups/:gid/appointments', action: 'appointment.view', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/groups/:gid/appointments/check', action: 'appointment.create', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/appointments/:id', action: 'appointment.view', auth: 'actor', owner: 'platform' },
  { method: 'PATCH', path: '/api/appointments/:id', action: 'appointment.update', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/appointments/:id/cancel', action: 'appointment.cancel', auth: 'actor', owner: 'platform' },
  { method: 'PUT', path: '/api/appointments/:id/rsvp', action: 'appointment.rsvp', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/appointments/:id/calendar.ics', action: 'appointment.view', auth: 'actor', owner: 'platform' }, // R12 §5
  { method: 'GET', path: '/api/me/appointments', action: 'appointment.list.mine', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/me/notifications', action: 'notification.list.own', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/me/notifications/read', action: 'notification.markRead.own', auth: 'actor', owner: 'platform' },
  // ── U12–U13 (R5 · Platform + Auth & Access) ──
  { method: 'PATCH', path: '/api/me', action: 'self.update', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/me/delete', action: 'self.delete', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/admin/users', action: 'admin.user.list', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/admin/users/:id/suspend', action: 'admin.user.suspend', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/admin/users/:id/unsuspend', action: 'admin.user.suspend', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/admin/users/:id/unlock', action: 'admin.user.unlock', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/admin/groups', action: 'admin.group.list', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/admin/groups/:gid', action: 'admin.group.view', auth: 'actor', owner: 'platform' },
  { method: 'GET', path: '/api/admin/audit', action: 'admin.audit.view', auth: 'actor', owner: 'platform' },
  // ── R6D G1 (Platform) — คุกกี้กลุ่มปัจจุบัน · ใช้กฎ member.setOwnAppearance (ค่าตั้งส่วนตัวของสมาชิกในกลุ่ม: สมาชิกเท่านั้น) ──
  { method: 'PUT', path: '/api/me/current-group', action: 'member.setCurrentGroup', auth: 'actor', owner: 'platform' },
  // ── R10 (Platform + Integrations) — เตือนก่อนนัด / เชื่อม LINE · webhook ตรวจ X-Line-Signature ใน handler (raw body) ──
  { method: 'GET', path: '/api/cron/reminders', action: null, auth: 'cron', owner: 'platform' },
  { method: 'POST', path: '/api/cron/reminders', action: null, auth: 'cron', owner: 'platform' },
  { method: 'POST', path: '/api/line/webhook', action: null, auth: 'public', owner: 'integrations' },
  { method: 'GET', path: '/api/me/line', action: 'self.read', auth: 'actor', owner: 'platform' },
  { method: 'POST', path: '/api/me/line', action: 'self.update', auth: 'actor', owner: 'platform' },
  { method: 'DELETE', path: '/api/me/line', action: 'self.update', auth: 'actor', owner: 'platform' },
] as const satisfies readonly ManifestEntry[];

export function findRoute(method: string, path: string): ManifestEntry | undefined {
  return (ROUTE_MANIFEST as readonly ManifestEntry[]).find((e) => e.method === method && e.path === path);
}
