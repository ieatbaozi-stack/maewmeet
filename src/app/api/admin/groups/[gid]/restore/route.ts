// POST /api/admin/groups/:gid/restore — super admin กู้คืนกลุ่มที่ลบภายใน 30 วัน (R17 G1 · B4) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { adminGroupParamsSchema, restoreAdminGroup } from '@/lib/data/services/admin-groups';
import { route } from '../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/admin/groups/:gid/restore',
  params: adminGroupParamsSchema,
  handler: ({ actor, params, req, now }) => restoreAdminGroup(actor, params.gid, dataCtx(req, now)),
});
