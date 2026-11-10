// PATCH|DELETE /api/me/busy-routines/:id — แก้/หยุด/ลบ routine ของตัวเอง · ของคนอื่น/ไม่มี id นั้น → 404 เหมือนกัน (IDOR) — R14 · ADR 0012 §5 · เจ้าของ: Platform
// PATCH body = กฎใหม่ทั้งชุด + from? · DELETE ?from= parse ที่ handler นี้ (route() อ่าน query เฉพาะ GET) · ผิด → VALIDATION ไม่สะท้อนค่าที่ส่งมา
import { dataCtx } from '@/lib/data/context';
import { deleteRoutine, deleteRoutineQuerySchema, routineParamsSchema, updateRoutine, updateRoutineInputSchema } from '@/lib/data/services/busy-routines';
import { AppError } from '@/lib/shared/errors';
import { route } from '../../../_lib/route';

export const PATCH = route({
  method: 'PATCH',
  path: '/api/me/busy-routines/:id',
  params: routineParamsSchema,
  input: updateRoutineInputSchema,
  handler: ({ actor, params, input, req, now }) => updateRoutine(actor, params.id, input, dataCtx(req, now)),
});

export const DELETE = route({
  method: 'DELETE',
  path: '/api/me/busy-routines/:id',
  params: routineParamsSchema,
  handler: ({ actor, params, req, now }) => {
    const q = deleteRoutineQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!q.success) throw new AppError('VALIDATION', { fields: { from: 'INVALID' } });
    return deleteRoutine(actor, params.id, dataCtx(req, now), q.data.from);
  },
});
