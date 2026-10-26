// GET /api/me/appointments?limit — นัด active ที่ยังไม่จบ ข้ามทุกกลุ่มของฉัน (หน้าหลัก U11) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { listMyAppointments, myAppointmentsQuerySchema } from '@/lib/data/services/appointments';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/me/appointments',
  input: myAppointmentsQuerySchema,
  handler: ({ actor, input, req, now }) => listMyAppointments(actor, input, dataCtx(req, now)),
});
