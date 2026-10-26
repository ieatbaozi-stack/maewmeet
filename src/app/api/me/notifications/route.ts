// GET /api/me/notifications?cursor&limit — แจ้งเตือนในแอปของฉัน (ใหม่สุดก่อน + unreadCount) — ADR 0007 §3 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { listMyNotifications, notificationListQuerySchema } from '@/lib/data/services/notifications';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/me/notifications',
  input: notificationListQuerySchema,
  handler: ({ actor, input, req, now }) => listMyNotifications(actor, input, dataCtx(req, now)),
});
