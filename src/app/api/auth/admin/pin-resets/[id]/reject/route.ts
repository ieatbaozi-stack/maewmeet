// POST /api/auth/admin/pin-resets/:id/reject — pending → rejected · audit
import { authCtx } from '@/lib/auth/context';
import { pinResetParamsSchema, rejectPinResetRequest } from '@/lib/auth/services/admin-resets';
import { route } from '../../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/auth/admin/pin-resets/:id/reject',
  params: pinResetParamsSchema,
  handler: ({ actor, params, req, now }) => rejectPinResetRequest(actor, params.id, authCtx(req, now)),
});
