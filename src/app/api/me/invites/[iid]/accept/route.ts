// POST /api/me/invites/:iid/accept — รับคำเชิญตรง (เข้ากลุ่ม · สมาชิกเต็ม → LIMIT_REACHED) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { myInviteParamsSchema, respondToDirectInvite } from '@/lib/data/services/invites';
import { route } from '../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/me/invites/:iid/accept',
  params: myInviteParamsSchema,
  handler: ({ actor, params, req, now }) => respondToDirectInvite(actor, params.iid, 'accept', dataCtx(req, now)),
});
