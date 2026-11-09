// เครื่องมือเทสต์ R10: env LINE · LINE จำลอง · ยิง cron/webhook จริงผ่าน route handler
import { createHmac } from 'node:crypto';
import { expect } from 'vitest';
import { Client, DAY, HOUR, MIN, put, type Harness, type Person } from '../appointments/util';
import { POST as webhookPOST } from '@/app/api/line/webhook/route';
import { resetLineFetch, setLineFetch } from '@/lib/integrations/line/client';
import { resetEnvCache } from '@/lib/shared/env';
import type { ReminderCronResult } from '@/lib/data/services/reminders';

export const CHANNEL_SECRET = 'test-channel-secret-value';
export const ACCESS_TOKEN = 'test-access-token-value';
export const LINE_A = `U${'a'.repeat(32)}`;
export const LINE_B = `U${'b'.repeat(32)}`;

export function enableLineEnv(): void {
  process.env.LINE_MESSAGING_ACCESS_TOKEN = ACCESS_TOKEN;
  process.env.LINE_MESSAGING_CHANNEL_SECRET = CHANNEL_SECRET;
  resetEnvCache();
}

export function disableLineEnv(): void {
  delete process.env.LINE_MESSAGING_ACCESS_TOKEN;
  delete process.env.LINE_MESSAGING_CHANNEL_SECRET;
  resetEnvCache();
}

export type FakeCall = { url: string; headers: Record<string, string>; body: { to?: string; replyToken?: string; messages: { type: string; text: string }[] } };
type FakeReply = { status: number; body?: string } | 'network';

/** LINE จำลอง: คิวคำตอบ (หมดคิว = 200) · เก็บทุกคำขอ */
export function fakeLine(queue: FakeReply[] = []) {
  const calls: FakeCall[] = [];
  setLineFetch(async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as FakeCall['body'] });
    const next = queue.shift() ?? { status: 200, body: '{}' };
    if (next === 'network') throw new Error('network down');
    return new Response(next.body ?? '{}', { status: next.status });
  });
  return { calls, queue, pushes: () => calls.filter((c) => c.url.endsWith('/push')), replies: () => calls.filter((c) => c.url.endsWith('/reply')) };
}

export const clearFakeLine = resetLineFetch;

export async function runCron(h: Harness) {
  const r = await new Client().call<ReminderCronResult>('GET', '/api/cron/reminders', undefined, {
    headers: { authorization: `Bearer ${h.t.env.CRON_SECRET}` },
    noCookie: true,
  });
  expect(r.status, r.text).toBe(200);
  return r.data;
}

export const rsvp = async (p: Person, id: string, response: 'going' | 'maybe' | 'not_going') => {
  const r = await put(p.c, `/api/appointments/${id}/rsvp`, { response });
  expect(r.status, r.text).toBe(200);
};

export const linkLine = (h: Harness, userId: string, lineUserId: string) => h.rows('UPDATE user SET line_user_id = ? WHERE id = ?', [lineUserId, userId]);

export const signBody = (raw: string, secret = CHANNEL_SECRET) => createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('base64');

export async function callWebhook(raw: string, signature: string | null): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== null) headers.set('x-line-signature', signature);
  return webhookPOST(new Request('https://maewmeet.test/api/line/webhook', { method: 'POST', headers, body: raw }));
}

export async function sendEvents(events: unknown[]): Promise<Response> {
  const raw = JSON.stringify({ destination: 'Ux', events });
  return callWebhook(raw, signBody(raw));
}

export const textEvent = (userId: string, text: string, replyToken = 'reply-token-1') => ({ type: 'message', replyToken, source: { type: 'user', userId }, message: { type: 'text', id: '1', text } });
export const unfollowEvent = (userId: string) => ({ type: 'unfollow', source: { type: 'user', userId } });

export { DAY, HOUR, MIN };
