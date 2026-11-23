// POST /api/share/join { token } — เข้าเป็นแขกของนัดด้วยลิงก์ชวน — R18 §S4/S5 · เจ้าของ: Platform
// 200 { status: 'guest' | 'member', appointmentId, joined } · 404 SHARE_LINK_INVALID (body เดียวกันทุกเหตุ) · 410 SHARE_LINK_EXPIRED · 409 SHARE_FULL { max }
import { dataCtx } from '@/lib/data/context';
import { joinShare, joinShareInputSchema } from '@/lib/data/services/share';
import { route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/share/join',
  input: joinShareInputSchema,
  handler: ({ actor, input, req, now }) => joinShare(actor, input, dataCtx(req, now)),
});
