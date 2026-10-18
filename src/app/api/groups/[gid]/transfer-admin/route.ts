// POST /api/groups/:gid/transfer-admin — โอนความเป็น admin (D8) · admin เดิมกลายเป็น moderator · อะตอมมิก · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { groupParamsSchema, transferAdmin, transferAdminInputSchema } from '@/lib/data/services/groups';
import { route } from '../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/groups/:gid/transfer-admin',
  params: groupParamsSchema,
  input: transferAdminInputSchema,
  handler: ({ actor, params, input, req, now }) => transferAdmin(actor, params.gid, input, dataCtx(req, now)),
});
