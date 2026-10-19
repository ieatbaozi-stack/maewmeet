// POST /api/auth/pin-reset — ขอ reset PIN (ไม่ต้องล็อกอิน) · 202 เหมือนกันทุกกรณี + cookie mm_reset (ADR 0002 §5)
import { authCtx } from '@/lib/auth/context';
import { pinResetRequestSchema, requestPinReset } from '@/lib/auth/services/pin-reset';
import { reply, route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/auth/pin-reset',
  input: pinResetRequestSchema,
  handler: async ({ actor, input, req, now }) => {
    const { accepted, cookies } = await requestPinReset(actor, input, authCtx(req, now));
    return reply({ accepted }, { status: 202, cookies });
  },
});
