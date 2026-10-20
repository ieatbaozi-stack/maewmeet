// GET /api/groups/:gid/invites — คำเชิญที่ยังใช้ได้ของกลุ่ม (MEM เห็นเฉพาะของตัวเอง กรองที่ชั้นข้อมูล) · ไม่มีโค้ดเต็ม · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { groupParamsSchema } from '@/lib/data/services/groups';
import { listInvites } from '@/lib/data/services/invites';
import { route } from '../../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/groups/:gid/invites',
  params: groupParamsSchema,
  handler: ({ actor, params, req, now }) => listInvites(actor, params.gid, dataCtx(req, now)),
});
