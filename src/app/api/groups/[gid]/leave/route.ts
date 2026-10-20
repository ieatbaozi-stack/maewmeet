// POST /api/groups/:gid/leave — ออกจากกลุ่มเอง (D8: admin ต้องโอนก่อน → 409) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { groupParamsSchema, leaveGroup } from '@/lib/data/services/groups';
import { route } from '../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/groups/:gid/leave',
  params: groupParamsSchema,
  handler: ({ actor, params, req, now }) => leaveGroup(actor, params.gid, dataCtx(req, now)),
});
