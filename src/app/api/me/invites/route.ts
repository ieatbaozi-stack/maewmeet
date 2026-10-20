// GET /api/me/invites — คำเชิญตรงที่ค้างของฉัน (U5 ก) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { listMyInvites } from '@/lib/data/services/invites';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/me/invites',
  handler: ({ actor, req, now }) => listMyInvites(actor, dataCtx(req, now)),
});
