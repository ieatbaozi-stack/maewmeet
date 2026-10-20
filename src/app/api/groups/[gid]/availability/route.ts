// GET /api/groups/:gid/availability?from&to — วันว่างร่วม: X/Y + ช่วงว่างร่วม + ใครติด (ผ่าน serializer เดียว ADR 0006) — U9, U9.1 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { availabilityParamsSchema, availabilityQuerySchema, getGroupAvailability } from '@/lib/data/services/availability';
import { route } from '../../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/groups/:gid/availability',
  params: availabilityParamsSchema,
  input: availabilityQuerySchema,
  handler: ({ actor, params, input, req, now }) => getGroupAvailability(actor, params.gid, input, dataCtx(req, now)),
});
