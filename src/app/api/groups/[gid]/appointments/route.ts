// POST /api/groups/:gid/appointments (สร้างนัด + คำเตือนนัดทับ) · GET /api/groups/:gid/appointments?scope&limit&cursor (รายการนัดของกลุ่ม) — U10, U10.1 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import {
  appointmentGroupParamsSchema,
  createAppointment,
  createAppointmentInputSchema,
  listAppointmentsQuerySchema,
  listGroupAppointments,
} from '@/lib/data/services/appointments';
import { reply, route } from '../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/groups/:gid/appointments',
  params: appointmentGroupParamsSchema,
  input: createAppointmentInputSchema,
  handler: async ({ actor, params, input, req, now }) => reply(await createAppointment(actor, params.gid, input, dataCtx(req, now)), { status: 201 }),
});

export const GET = route({
  method: 'GET',
  path: '/api/groups/:gid/appointments',
  params: appointmentGroupParamsSchema,
  input: listAppointmentsQuerySchema,
  handler: ({ actor, params, input, req, now }) => listGroupAppointments(actor, params.gid, input, dataCtx(req, now)),
});
