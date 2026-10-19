// GET /api/auth/admin/pin-resets?status=pending — รายการคำขอ reset สำหรับ super admin (U2, U12)
import { authCtx } from '@/lib/auth/context';
import { listPinResets, listPinResetsQuerySchema } from '@/lib/auth/services/admin-resets';
import { route } from '../../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/auth/admin/pin-resets',
  input: listPinResetsQuerySchema,
  handler: ({ actor, req, now }) => listPinResets(actor, authCtx(req, now)),
});
