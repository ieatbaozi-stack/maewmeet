// GET /api/admin/groups/:gid — รายละเอียดกลุ่มเพื่อดูแล (ไม่มี busy/รายละเอียดนัด) + audit admin.group.view (U12 · R5 §2 ข้อ 3) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { adminGroupParamsSchema, getAdminGroup } from '@/lib/data/services/admin-groups';
import { route } from '../../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/admin/groups/:gid',
  params: adminGroupParamsSchema,
  handler: ({ actor, params, req, now }) => getAdminGroup(actor, params.gid, dataCtx(req, now)),
});
