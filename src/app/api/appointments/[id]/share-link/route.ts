// POST /api/appointments/:id/share-link — สร้าง/ขอลิงก์ชวนคนนอกของฉัน (get-or-create: กดซ้ำได้ลิงก์เดิม) — R18 §S1 · เจ้าของ: Platform
// สร้างใหม่ = 201 · ได้ลิงก์เดิม = 200 · body { url, linkId, createdAt, reused } (ไม่มี token_hash)
import { dataCtx } from '@/lib/data/context';
import { createShareLink, shareAppointmentParamsSchema } from '@/lib/data/services/share';
import { reply, route } from '../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/appointments/:id/share-link',
  params: shareAppointmentParamsSchema,
  handler: async ({ actor, params, req, now }) => {
    const r = await createShareLink(actor, params.id, dataCtx(req, now));
    return reply(r, { status: r.reused ? 200 : 201 });
  },
});
