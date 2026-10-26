// PATCH /api/me — เปลี่ยนชื่อที่แสดง (U13 · R5 §2 ข้อ 1) · เจ้าของ: Platform
import { authCtx } from '@/lib/auth/context';
import { updateMe, updateMeInputSchema } from '@/lib/data/services/account';
import { route } from '../_lib/route';

export const PATCH = route({
  method: 'PATCH',
  path: '/api/me',
  input: updateMeInputSchema,
  handler: ({ actor, input, req, now }) => updateMe(actor, input, authCtx(req, now)),
});
