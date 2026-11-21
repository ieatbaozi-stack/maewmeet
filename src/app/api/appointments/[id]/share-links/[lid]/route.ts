// DELETE /api/appointments/:id/share-links/:lid — ยกเลิกลิงก์ชวน (ผู้สร้างลิงก์ · ผู้สร้างนัด · admin/mod · SA audited) — R18 §S2 · เจ้าของ: Platform
// :lid ต้องเป็นของนัด :id ไม่งั้น NOT_FOUND (กัน IDOR)
import { dataCtx } from '@/lib/data/context';
import { revokeShareLink, shareLinkParamsSchema } from '@/lib/data/services/share';
import { route } from '../../../../_lib/route';

export const DELETE = route({
  method: 'DELETE',
  path: '/api/appointments/:id/share-links/:lid',
  params: shareLinkParamsSchema,
  handler: ({ actor, params, req, now }) => revokeShareLink(actor, params.id, params.lid, dataCtx(req, now)),
});
