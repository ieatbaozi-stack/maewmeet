// POST /api/appointments/:id/cancel — ยกเลิกนัด (เก็บแถว สถานะ cancelled) — U10.2 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { appointmentParamsSchema, cancelAppointment } from '@/lib/data/services/appointments';
import { route } from '../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/appointments/:id/cancel',
  params: appointmentParamsSchema,
  handler: ({ actor, params, req, now }) => cancelAppointment(actor, params.id, dataCtx(req, now)),
});
