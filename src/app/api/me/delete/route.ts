// POST /api/me/delete — ลบบัญชีของฉัน (U13 · R5 §2 ข้อ 2) · ต้องใส่ PIN ปัจจุบัน · สำเร็จ = ล้างคุกกี้ session + mm_group · เจ้าของ: Platform
import { authCtx } from '@/lib/auth/context';
import { deleteMe, deleteMeInputSchema } from '@/lib/data/services/account';
import { clearCurrentGroupCookie } from '@/lib/shared/current-group-cookie';
import { reply, route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/me/delete',
  input: deleteMeInputSchema,
  handler: async ({ actor, input, req, now }) => {
    const { deleted, cookies } = await deleteMe(actor, input, authCtx(req, now));
    // R6D G1: ลบบัญชีสำเร็จ → ลบคุกกี้กลุ่มปัจจุบันด้วย (ADR 0009 §5)
    return reply({ deleted }, { cookies: [...cookies, clearCurrentGroupCookie()] });
  },
});
