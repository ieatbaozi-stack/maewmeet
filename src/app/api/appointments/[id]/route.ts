// GET /api/appointments/:id (รายละเอียด + RSVP) · PATCH /api/appointments/:id (แก้ — ผู้สร้าง/admin/moderator/super admin) — U10 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { appointmentParamsSchema, getAppointment, updateAppointment, updateAppointmentInputSchema } from '@/lib/data/services/appointments';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/appointments/:id',
  params: appointmentParamsSchema,
  handler: ({ actor, params, req, now }) => getAppointment(actor, params.id, dataCtx(req, now)),
});

export const PATCH = route({
  method: 'PATCH',
  path: '/api/appointments/:id',
  params: appointmentParamsSchema,
  input: updateAppointmentInputSchema,
  handler: ({ actor, params, input, req, now }) => updateAppointment(actor, params.id, input, dataCtx(req, now)),
});
