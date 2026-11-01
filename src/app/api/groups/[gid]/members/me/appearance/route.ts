// PATCH /api/groups/:gid/members/me/appearance — ตั้งสี/รูปทรงของฉันในกลุ่ม (R6C F3ก) · เจ้าของ: Platform
// body { color: 1–10 | null, shape: 1–10 | null } → 200 { colorIndex, shapeIndex, color, shape }
import { dataCtx } from '@/lib/data/context';
import { groupParamsSchema, setAppearanceInputSchema, setMyAppearance } from '@/lib/data/services/groups';
import { route } from '../../../../../_lib/route';

export const PATCH = route({
  method: 'PATCH',
  path: '/api/groups/:gid/members/me/appearance',
  params: groupParamsSchema,
  input: setAppearanceInputSchema,
  handler: ({ actor, params, input, req, now }) => setMyAppearance(actor, params.gid, input, dataCtx(req, now)),
});
