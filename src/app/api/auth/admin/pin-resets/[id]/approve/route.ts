// POST /api/auth/admin/pin-resets/:id/approve — pending → approved (24 ชม.) · pin_hash = NULL · audit + notification
import { authCtx } from '@/lib/auth/context';
import { approvePinResetRequest, pinResetParamsSchema } from '@/lib/auth/services/admin-resets';
import { route } from '../../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/auth/admin/pin-resets/:id/approve',
  params: pinResetParamsSchema,
  handler: ({ actor, params, req, now }) => approvePinResetRequest(actor, params.id, authCtx(req, now)),
});
