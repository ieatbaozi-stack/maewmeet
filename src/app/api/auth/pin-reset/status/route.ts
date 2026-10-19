// GET /api/auth/pin-reset/status — สถานะคำขอที่ผูกกับเครื่องนี้ (cookie mm_reset): none | pending | approved(expiresAt) | closed
import { authCtx } from '@/lib/auth/context';
import { getPinResetStatus } from '@/lib/auth/services/pin-reset';
import { route } from '../../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/auth/pin-reset/status',
  handler: ({ actor, req, now }) => getPinResetStatus(actor, authCtx(req, now)),
});
