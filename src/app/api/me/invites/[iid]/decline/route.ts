// POST /api/me/invites/:iid/decline — ปฏิเสธคำเชิญตรง · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { myInviteParamsSchema, respondToDirectInvite } from '@/lib/data/services/invites';
import { route } from '../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/me/invites/:iid/decline',
  params: myInviteParamsSchema,
  handler: ({ actor, params, req, now }) => respondToDirectInvite(actor, params.iid, 'decline', dataCtx(req, now)),
});
