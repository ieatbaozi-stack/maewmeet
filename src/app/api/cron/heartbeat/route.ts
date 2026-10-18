// POST /api/cron/heartbeat — GitHub Actions keepalive.yml (Bearer CRON_SECRET) · R0_CONTRACT §3 · ADR 0001 §3.1
// เขียน heartbeat('github-actions') แล้วคืน heartbeatAgeHours ของทุก source
import { getDb } from '@/db/client';
import { recordHeartbeat } from '@/lib/data/services/maintenance';
import { route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/cron/heartbeat',
  handler: ({ now }) => recordHeartbeat(getDb(), 'github-actions', now),
});
