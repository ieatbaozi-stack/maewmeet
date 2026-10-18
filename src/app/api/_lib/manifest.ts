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
] as const satisfies readonly ManifestEntry[];

export function findRoute(method: string, path: string): ManifestEntry | undefined {
  return (ROUTE_MANIFEST as readonly ManifestEntry[]).find((e) => e.method === method && e.path === path);
}
