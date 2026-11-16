// PUT /api/groups/:gid/icon — ตั้ง/ล้างไอคอนกลุ่ม (R15 §1.2, B1/B2) · body { icon: key | null } · action group.icon.update · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { groupParamsSchema, setGroupIcon, setGroupIconInputSchema } from '@/lib/data/services/groups';
import { route } from '../../../_lib/route';

export const PUT = route({
  method: 'PUT',
  path: '/api/groups/:gid/icon',
  params: groupParamsSchema,
  input: setGroupIconInputSchema,
  handler: ({ actor, params, input, req, now }) => setGroupIcon(actor, params.gid, input, dataCtx(req, now)),
});
