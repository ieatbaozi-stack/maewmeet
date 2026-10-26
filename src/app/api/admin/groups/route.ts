// GET /api/admin/groups?q=&status=&cursor= — รายการกลุ่มสำหรับ super admin (U12 · R5 §2 ข้อ 3) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { adminGroupListQuerySchema, listAdminGroups } from '@/lib/data/services/admin-groups';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/admin/groups',
  input: adminGroupListQuerySchema,
  handler: ({ actor, input, req, now }) => listAdminGroups(actor, input, dataCtx(req, now)),
});
