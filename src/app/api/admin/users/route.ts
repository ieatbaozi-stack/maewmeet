// GET /api/admin/users?q=&cursor= — รายชื่อผู้ใช้สำหรับ super admin (U12 · R5 §2 ข้อ 3) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { adminUserListQuerySchema, listAdminUsers } from '@/lib/data/services/admin-users';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/admin/users',
  input: adminUserListQuerySchema,
  handler: ({ actor, input, req, now }) => listAdminUsers(actor, input, dataCtx(req, now)),
});
