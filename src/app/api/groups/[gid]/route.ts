// GET /api/groups/:gid (รายละเอียด + สมาชิก + สี) · PATCH (ชื่อ/หน้าต่างวันว่าง D9) · DELETE (soft delete) — U4, U6 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { deleteGroup, getGroup, groupParamsSchema, updateGroupInputSchema, updateGroupSettings } from '@/lib/data/services/groups';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/groups/:gid',
  params: groupParamsSchema,
  handler: ({ actor, params, req, now }) => getGroup(actor, params.gid, dataCtx(req, now)),
});

export const PATCH = route({
  method: 'PATCH',
  path: '/api/groups/:gid',
  params: groupParamsSchema,
  input: updateGroupInputSchema,
  handler: ({ actor, params, input, req, now }) => updateGroupSettings(actor, params.gid, input, dataCtx(req, now)),
});

export const DELETE = route({
  method: 'DELETE',
  path: '/api/groups/:gid',
  params: groupParamsSchema,
  handler: ({ actor, params, req, now }) => deleteGroup(actor, params.gid, dataCtx(req, now)),
});
