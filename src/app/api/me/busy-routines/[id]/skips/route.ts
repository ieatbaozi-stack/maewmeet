// POST /api/me/busy-routines/:id/skips — เว้น/คืนหลายวันของ routine ของตัวเองในคำขอเดียว (R15 §1.1 · ADR 0012 §13) · เจ้าของ: Platform
// body { add?: DateISO[], remove?: DateISO[] } (strict) · ของคนอื่น/ไม่มี → 404 (IDOR) · rate limit busy:routine นับที่ service ก่อนตรวจค่า
import { dataCtx } from '@/lib/data/context';
import { routineParamsSchema, routineSkipsInputSchema, setRoutineSkips } from '@/lib/data/services/busy-routines';
import { route } from '../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/me/busy-routines/:id/skips',
  params: routineParamsSchema,
  input: routineSkipsInputSchema,
  handler: ({ actor, params, input, req, now }) => setRoutineSkips(actor, params.id, input, dataCtx(req, now)),
});
