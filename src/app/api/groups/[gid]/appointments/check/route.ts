// POST /api/groups/:gid/appointments/check — ตรวจนัดทับ busy ล่วงหน้า (ไม่เขียนข้อมูล) — U10.1 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { appointmentGroupParamsSchema, checkAppointmentInputSchema, checkAppointmentOverlap } from '@/lib/data/services/appointments';
import { route } from '../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/groups/:gid/appointments/check',
  params: appointmentGroupParamsSchema,
  input: checkAppointmentInputSchema,
  handler: ({ actor, params, input, req, now }) => checkAppointmentOverlap(actor, params.gid, input, dataCtx(req, now)),
});
