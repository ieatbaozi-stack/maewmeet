// PATCH|DELETE /api/me/busy/:id — แก้/ลบ busy ของตัวเอง · ของคนอื่น/ไม่มี id นั้น → 404 เหมือนกัน (IDOR) — U7 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { busyParamsSchema, deleteBusy, updateBusy, updateBusyInputSchema } from '@/lib/data/services/busy';
import { route } from '../../../_lib/route';

export const PATCH = route({
  method: 'PATCH',
  path: '/api/me/busy/:id',
  params: busyParamsSchema,
  input: updateBusyInputSchema,
  handler: ({ actor, params, input, req, now }) => updateBusy(actor, params.id, input, dataCtx(req, now)),
});

export const DELETE = route({
  method: 'DELETE',
  path: '/api/me/busy/:id',
  params: busyParamsSchema,
  handler: ({ actor, params, req, now }) => deleteBusy(actor, params.id, dataCtx(req, now)),
});
