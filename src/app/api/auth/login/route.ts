// POST /api/auth/login — U1, U2, U3 · throttle ต่อ username + IP (ADR 0002 §3) · 123456 ผูกเครื่อง (§5–§6)
import { authCtx } from '@/lib/auth/context';
import { login, loginInputSchema } from '@/lib/auth/services/login';
import { reply, route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/auth/login',
  input: loginInputSchema,
  handler: async ({ actor, input, req, now }) => {
    const { user, cookies } = await login(actor, input, authCtx(req, now));
    return reply({ user }, { cookies });
  },
});
