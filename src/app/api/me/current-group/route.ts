// PUT /api/me/current-group — body { gid } → คุกกี้ mm_group (1 ปี, HttpOnly, SameSite=Lax, Secure) · R6D G1 · ADR 0009 §5 · เจ้าของ: Platform
// ไม่ใช่สมาชิก/กลุ่มไม่มี/ลบแล้ว → 404 ไม่มี Set-Cookie · ไม่มี Origin/ไม่ใช่ JSON → 403 CSRF_REJECTED (wrapper)
import { dataCtx } from '@/lib/data/context';
import { currentGroupInputSchema, rememberCurrentGroup } from '@/lib/data/services/current-group';
import { reply, route } from '../../_lib/route';

export const PUT = route({
  method: 'PUT',
  path: '/api/me/current-group',
  input: currentGroupInputSchema,
  handler: async ({ actor, input, req, now }) => {
    const { result, cookies } = await rememberCurrentGroup(actor, input, dataCtx(req, now));
    return reply(result, { cookies });
  },
});
