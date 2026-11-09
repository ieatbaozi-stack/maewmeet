// ตรวจ X-Line-Signature — HMAC-SHA256(channel secret, raw body) แบบ base64 · เทียบ constant-time (R10 §2)
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();

export function computeLineSignature(rawBody: Buffer, channelSecret: string): string {
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}

export function verifyLineSignature(rawBody: Buffer, header: string | null, channelSecret: string): boolean {
  if (!header) return false;
  return timingSafeEqual(digest(computeLineSignature(rawBody, channelSecret)), digest(header));
}
