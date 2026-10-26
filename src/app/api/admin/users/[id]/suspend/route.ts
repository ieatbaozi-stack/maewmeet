// POST /api/admin/users/:id/suspend — super admin (U12 · R5 §2 ข้อ 3) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { adminUserParamsSchema, suspendUser } from '@/lib/data/services/admin-users';
import { route } from '../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/admin/users/:id/suspend',
  params: adminUserParamsSchema,
  handler: ({ actor, params, req, now }) => suspendUser(actor, params.id, dataCtx(req, now)),
});
