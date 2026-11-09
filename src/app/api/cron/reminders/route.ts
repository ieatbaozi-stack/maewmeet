// GET|POST /api/cron/reminders — ตัวตั้งเวลาเตือนก่อนนัด (Vercel Schedules ทุก 15 นาที ใช้ GET) · Bearer CRON_SECRET แบบเดียวกับ /api/cron/daily · R10 §1.5 · รันซ้ำได้
import { getDb } from '@/db/client';
import { runReminderCron } from '@/lib/data/services/reminders';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/cron/reminders',
  handler: ({ now }) => runReminderCron(getDb(), now),
});

export const POST = route({
  method: 'POST',
  path: '/api/cron/reminders',
  handler: ({ now }) => runReminderCron(getDb(), now),
});
