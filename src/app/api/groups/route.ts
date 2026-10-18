// POST /api/groups (สร้างกลุ่ม — ผู้สร้างเป็น admin) · GET /api/groups (กลุ่มของฉัน) — U4 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { createGroup, createGroupInputSchema, listMyGroups } from '@/lib/data/services/groups';
import { reply, route } from '../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/groups',
  input: createGroupInputSchema,
  handler: async ({ actor, input, req, now }) => reply({ group: await createGroup(actor, input, dataCtx(req, now)) }, { status: 201 }),
});

export const GET = route({
  method: 'GET',
  path: '/api/groups',
  handler: ({ actor, req, now }) => listMyGroups(actor, dataCtx(req, now)),
});
