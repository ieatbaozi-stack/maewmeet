// POST /api/invites/redeem — ใช้โค้ดเชิญเข้ากลุ่ม · ผิด/หมดอายุ/เพิกถอน/ไม่มี → INVITE_INVALID เดียวกัน · rate limit reserve ต่อผู้ใช้+IP · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { redeemInputSchema, redeemInviteCode } from '@/lib/data/services/invites';
import { route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/invites/redeem',
  input: redeemInputSchema,
  handler: ({ actor, input, req, now }) => redeemInviteCode(actor, input, dataCtx(req, now)),
});
