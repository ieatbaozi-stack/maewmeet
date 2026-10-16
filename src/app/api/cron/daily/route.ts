// GET /api/cron/daily — Vercel cron (Bearer CRON_SECRET) · R0_CONTRACT §3 · ARCHITECTURE §8 · ADR 0001 §3.1
// เขียน heartbeat('vercel-cron') ก่อน แล้วเก็บกวาดข้อ 1–3 · idempotent · ข้อ 5 (pepper fingerprint) = R1
import { getDb } from '@/db/client';
import { runDailyMaintenance } from '@/lib/data/services/maintenance';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/cron/daily',
  handler: ({ now }) => runDailyMaintenance(getDb(), now),
});
