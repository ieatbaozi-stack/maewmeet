// POST /api/groups/:gid/invites/direct — ชวนตรงถึง username (Q4: USER_NOT_FOUND · 30/ชม./ผู้ใช้) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { groupParamsSchema } from '@/lib/data/services/groups';
import { createDirectInvite, directInviteInputSchema } from '@/lib/data/services/invites';
import { reply, route } from '../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/groups/:gid/invites/direct',
  params: groupParamsSchema,
  input: directInviteInputSchema,
  handler: async ({ actor, params, input, req, now }) =>
    reply(await createDirectInvite(actor, params.gid, input, dataCtx(req, now)), { status: 201 }),
});
