// POST /api/auth/signup — U1 · RL 5/ชม./IP · สร้าง session ทันที (ADR 0002 §3) · เจ้าของ: Auth & Access
import { authCtx } from '@/lib/auth/context';
import { signup, signupInputSchema } from '@/lib/auth/services/signup';
import { reply, route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/auth/signup',
  input: signupInputSchema,
  handler: async ({ actor, input, req, now }) => {
    const { user, cookies } = await signup(actor, input, authCtx(req, now));
    return reply({ user }, { status: 201, cookies });
  },
});
