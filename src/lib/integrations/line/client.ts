// Messaging API client — Push (มี X-Line-Retry-Key) + Reply · ไม่ log token / LINE user id / เนื้อหา
// ตัวเรียกเครือข่าย inject ได้ (เทสต์ห้ามยิง LINE จริง)
import { LINE_DISPATCH } from '@/lib/shared/limits';
import type { LineConfig } from './config';

export type LineFetch = (url: string, init: RequestInit) => Promise<Response>;

let override: LineFetch | null = null;

export function setLineFetch(fn: LineFetch): void {
  override = fn;
}

export function resetLineFetch(): void {
  override = null;
}

function lineFetch(): LineFetch {
  return override ?? ((url, init) => fetch(url, init));
}

export const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
export const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

export type PushResult =
  | { outcome: 'sent' }
  | { outcome: 'retry'; code: string }
  | { outcome: 'dead'; code: string }
  | { outcome: 'monthly_limit' };

function headers(config: LineConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' };
}

/** ADR 0011 §5: 2xx/409 = sent · 5xx/timeout/429 อื่น = retry · 429 monthly limit · 4xx อื่น = dead */
export async function pushText(config: LineConfig, input: { to: string; text: string; retryKey: string }): Promise<PushResult> {
  let res: Response;
  try {
    res = await lineFetch()(LINE_PUSH_URL, {
      method: 'POST',
      headers: { ...headers(config), 'X-Line-Retry-Key': input.retryKey },
      body: JSON.stringify({ to: input.to, messages: [{ type: 'text', text: input.text }] }),
      signal: AbortSignal.timeout(LINE_DISPATCH.timeoutMs),
    });
  } catch {
    return { outcome: 'retry', code: 'LINE_NETWORK' };
  }
  if (res.ok || res.status === 409) return { outcome: 'sent' }; // 409 = retry key นี้ถูกรับไปแล้ว
  if (res.status === 429) {
    const body = await res.text().catch(() => '');
    return /monthly limit/i.test(body) ? { outcome: 'monthly_limit' } : { outcome: 'retry', code: 'LINE_RATE_LIMIT' };
  }
  if (res.status >= 500) return { outcome: 'retry', code: `LINE_HTTP_${res.status}` };
  return { outcome: 'dead', code: `LINE_HTTP_${res.status}` };
}

/** ตอบกลับในแชท (ไม่กินโควตา) · ล้มเหลว = เงียบ (reply token ใช้ได้ครั้งเดียว ไม่มี retry · ไม่ rollback การผูก) */
export async function replyText(config: LineConfig, input: { replyToken: string; text: string }): Promise<void> {
  try {
    await lineFetch()(LINE_REPLY_URL, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ replyToken: input.replyToken, messages: [{ type: 'text', text: input.text }] }),
      signal: AbortSignal.timeout(LINE_DISPATCH.timeoutMs),
    });
  } catch {
    // เงียบตามสัญญา
  }
}
