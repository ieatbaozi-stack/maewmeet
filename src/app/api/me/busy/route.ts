// GET /api/me/busy[?from&to] (ของฉันครบ title+note) · POST /api/me/busy (ลง busy — ผูกผู้ใช้ ไม่ผูกกลุ่ม D5) — U7 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { createBusy, createBusyInputSchema, listBusyQuerySchema, listMyBusy } from '@/lib/data/services/busy';
import { reply, route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/me/busy',
  input: listBusyQuerySchema,
  handler: ({ actor, input, req, now }) => listMyBusy(actor, input, dataCtx(req, now)),
});

export const POST = route({
  method: 'POST',
  path: '/api/me/busy',
  input: createBusyInputSchema,
  handler: async ({ actor, input, req, now }) => reply(await createBusy(actor, input, dataCtx(req, now)), { status: 201 }),
});
