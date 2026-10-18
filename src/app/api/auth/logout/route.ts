// POST /api/auth/logout — ลบ session ปัจจุบัน · ใช้ได้ระหว่าง must_change_pin (ADR 0003 §3)
import { authCtx } from '@/lib/auth/context';
import { logout } from '@/lib/auth/services/session-info';
import { reply, route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/auth/logout',
  handler: async ({ actor, req, now }) => {
    const { cookies } = await logout(actor, authCtx(req, now));
    return reply({ ok: true }, { cookies });
  },
});
