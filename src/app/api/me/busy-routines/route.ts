// GET /api/me/busy-routines (routine ของฉัน + วันที่เหลือ) · POST (สร้างกฎ + ลงทุกวันใน tx เดียว) — R14 · ADR 0012 §5 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { createRoutine, createRoutineInputSchema, listMyRoutines, listRoutinesQuerySchema } from '@/lib/data/services/busy-routines';
import { reply, route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/me/busy-routines',
  input: listRoutinesQuerySchema,
  handler: ({ actor, req, now }) => listMyRoutines(actor, dataCtx(req, now)),
});

export const POST = route({
  method: 'POST',
  path: '/api/me/busy-routines',
  input: createRoutineInputSchema,
  handler: async ({ actor, input, req, now }) => reply(await createRoutine(actor, input, dataCtx(req, now)), { status: 201 }),
});
