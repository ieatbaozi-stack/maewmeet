// POST /api/auth/pin — ตั้ง PIN ใหม่หลัง reset (U3) / เปลี่ยน PIN (U13)
import { authCtx } from '@/lib/auth/context';
import { changePin, changePinInputSchema } from '@/lib/auth/services/pin-change';
import { route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/auth/pin',
  input: changePinInputSchema,
  handler: ({ actor, input, req, now }) => changePin(actor, input, authCtx(req, now)),
});
