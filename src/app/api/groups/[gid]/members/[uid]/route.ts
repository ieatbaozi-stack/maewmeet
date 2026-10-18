// DELETE /api/groups/:gid/members/:uid (ลบสมาชิก D7) · PATCH (ตั้ง/ปลด moderator) — U6 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { memberParamsSchema, removeMember, setMemberRole, setRoleInputSchema } from '@/lib/data/services/groups';
import { route } from '../../../../_lib/route';

export const DELETE = route({
  method: 'DELETE',
  path: '/api/groups/:gid/members/:uid',
  params: memberParamsSchema,
  handler: ({ actor, params, req, now }) => removeMember(actor, params.gid, params.uid, dataCtx(req, now)),
});

export const PATCH = route({
  method: 'PATCH',
  path: '/api/groups/:gid/members/:uid',
  params: memberParamsSchema,
  input: setRoleInputSchema,
  handler: ({ actor, params, input, req, now }) => setMemberRole(actor, params.gid, params.uid, input, dataCtx(req, now)),
});
