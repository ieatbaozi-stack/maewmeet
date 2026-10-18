// POST /api/groups/:gid/invites/code — สร้างโค้ดเชิญ · คืนโค้ดเต็ม (XXXX-XXXX) "ครั้งเดียว" ในตอบสนองนี้เท่านั้น · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { groupParamsSchema } from '@/lib/data/services/groups';
import { createCodeInvite } from '@/lib/data/services/invites';
import { reply, route } from '../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/groups/:gid/invites/code',
  params: groupParamsSchema,
  handler: async ({ actor, params, req, now }) => reply(await createCodeInvite(actor, params.gid, dataCtx(req, now)), { status: 201 }),
});
