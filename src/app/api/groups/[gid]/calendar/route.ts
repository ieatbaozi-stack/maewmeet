// GET /api/groups/:gid/calendar?from&to — ปฏิทินกลุ่ม: สมาชิก + busy ของสมาชิกปัจจุบัน ผ่าน serializer เดียว (ADR 0006) — U8 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { calendarParamsSchema, calendarQuerySchema, getGroupCalendar } from '@/lib/data/services/calendar';
import { route } from '../../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/groups/:gid/calendar',
  params: calendarParamsSchema,
  input: calendarQuerySchema,
  handler: ({ actor, params, input, req, now }) => getGroupCalendar(actor, params.gid, input, dataCtx(req, now)),
});
