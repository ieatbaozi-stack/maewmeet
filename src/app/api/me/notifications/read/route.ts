// POST /api/me/notifications/read {ids} | {all:true} — ทำเครื่องหมายอ่านแล้ว (เฉพาะของฉัน) — ADR 0007 §3 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { markMyNotificationsRead, markNotificationsReadInputSchema } from '@/lib/data/services/notifications';
import { route } from '../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/me/notifications/read',
  input: markNotificationsReadInputSchema,
  handler: ({ actor, input, req, now }) => markMyNotificationsRead(actor, input, dataCtx(req, now)),
});
