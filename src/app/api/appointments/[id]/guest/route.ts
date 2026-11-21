// GET /api/appointments/:id/guest (มุมมองแขก) · DELETE (แขกออกจากนัดเอง) — R18 §S4 · เจ้าของ: Platform
// ไม่ใช่แขกที่มีผล / เป็นสมาชิก / กลุ่มลบ → NOT_FOUND
import { dataCtx } from '@/lib/data/context';
import { getGuestAppointment, leaveAsGuest, shareAppointmentParamsSchema } from '@/lib/data/services/share';
import { route } from '../../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/appointments/:id/guest',
  params: shareAppointmentParamsSchema,
  handler: ({ actor, params, req, now }) => getGuestAppointment(actor, params.id, dataCtx(req, now)),
});

export const DELETE = route({
  method: 'DELETE',
  path: '/api/appointments/:id/guest',
  params: shareAppointmentParamsSchema,
  handler: ({ actor, params, req, now }) => leaveAsGuest(actor, params.id, dataCtx(req, now)),
});
