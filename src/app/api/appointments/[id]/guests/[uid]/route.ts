// DELETE /api/appointments/:id/guests/:uid — สมาชิกนำแขกออก (ผู้สร้างนัด · admin/mod · ผู้ชวนแขกคนนั้น · SA audited) — R18 §S6 · เจ้าของ: Platform
// แขกที่ถูกนำออกกลับเข้านัดนี้ไม่ได้อีกทุกลิงก์ · ไม่มี/ถูกนำออกแล้ว → NOT_FOUND
import { dataCtx } from '@/lib/data/context';
import { guestTargetParamsSchema, removeGuest } from '@/lib/data/services/share';
import { route } from '../../../../_lib/route';

export const DELETE = route({
  method: 'DELETE',
  path: '/api/appointments/:id/guests/:uid',
  params: guestTargetParamsSchema,
  handler: ({ actor, params, req, now }) => removeGuest(actor, params.id, params.uid, dataCtx(req, now)),
});
