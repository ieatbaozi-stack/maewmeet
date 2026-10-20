// DELETE /api/groups/:gid/invites/:iid — เพิกถอนโค้ด/คำเชิญ (admin/mod/SA ทุกแถว · MEM เฉพาะที่ตัวเองสร้าง) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { groupInviteParamsSchema, revokeInvite } from '@/lib/data/services/invites';
import { route } from '../../../../_lib/route';

export const DELETE = route({
  method: 'DELETE',
  path: '/api/groups/:gid/invites/:iid',
  params: groupInviteParamsSchema,
  handler: ({ actor, params, req, now }) => revokeInvite(actor, params.gid, params.iid, dataCtx(req, now)),
});
