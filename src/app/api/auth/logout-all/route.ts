// POST /api/auth/logout-all — ลบทุก session ของตัวเอง (U1, U13)
import { authCtx } from '@/lib/auth/context';
import { logoutAll } from '@/lib/auth/services/session-info';
import { clearCurrentGroupCookie } from '@/lib/shared/current-group-cookie';
import { reply, route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/auth/logout-all',
  handler: async ({ actor, req, now }) => {
    const { revoked, cookies } = await logoutAll(actor, authCtx(req, now));
    return reply({ revoked }, { cookies: [...cookies, clearCurrentGroupCookie()] }); // R6D G1: ลืมกลุ่มปัจจุบันของเครื่องด้วย (ADR 0009 §5)
  },
});
