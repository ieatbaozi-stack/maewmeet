// PUT /api/appointments/:id/rsvp — ตอบ ไป/อาจไป/ไม่ไป (ตอบซ้ำ = แก้) — U10 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { appointmentParamsSchema, rsvpInputSchema, setRsvp } from '@/lib/data/services/appointments';
import { route } from '../../../_lib/route';

export const PUT = route({
  method: 'PUT',
  path: '/api/appointments/:id/rsvp',
  params: appointmentParamsSchema,
  input: rsvpInputSchema,
  handler: ({ actor, params, input, req, now }) => setRsvp(actor, params.id, input, dataCtx(req, now)),
});
