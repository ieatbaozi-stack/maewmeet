// GET /api/auth/session — {id, username, displayName, isAdmin, mustChangePin, locale, theme} หรือ 401 (ARCHITECTURE §5)
// หมายเหตุ: ระหว่าง must_change_pin ตอบ 403 PIN_CHANGE_REQUIRED (R1_CONTRACT §2) — หน้าเว็บอ่านสถานะนี้ฝั่งเซิร์ฟเวอร์ด้วย getActor
import { authCtx } from '@/lib/auth/context';
import { getSessionInfo } from '@/lib/auth/services/session-info';
import { reply, route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/auth/session',
  handler: async ({ actor, req, now }) => {
    const { user, cookies } = await getSessionInfo(actor, authCtx(req, now));
    return reply({ user }, { cookies });
  },
});
