// PATCH|DELETE /api/me/busy/:id — แก้/ลบ busy ของตัวเอง · ของคนอื่น/ไม่มี id นั้น → 404 เหมือนกัน (IDOR) — U7 · เจ้าของ: Platform
// R6F (ADR 0010 §5 · main ตัดสิน): DELETE ?scope=one|series parse ที่ handler นี้ (route() อ่าน query เฉพาะ GET) · ผิด → VALIDATION ไม่สะท้อนค่าที่ส่งมา
import { dataCtx } from '@/lib/data/context';
import { busyParamsSchema, deleteBusy, deleteBusyQuerySchema, updateBusy, updateBusyInputSchema } from '@/lib/data/services/busy';
import { AppError } from '@/lib/shared/errors';
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
  handler: ({ actor, params, req, now }) => {
    const q = deleteBusyQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!q.success) throw new AppError('VALIDATION', { fields: { scope: 'INVALID' } });
    return deleteBusy(actor, params.id, dataCtx(req, now), q.data.scope ?? 'one');
  },
});
