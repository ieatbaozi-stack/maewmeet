// auth ของ cron — `Authorization: Bearer <CRON_SECRET>` (Vercel cron ส่งให้เอง · GitHub Actions ส่งจาก Secrets)
// เทียบแบบ constant-time: hash ทั้งสองฝั่งด้วย SHA-256 ให้ยาวเท่ากันก่อน timingSafeEqual (ไม่รั่วความยาว)
import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function isAuthorizedCron(req: Request, cronSecret: string): boolean {
  const header = req.headers.get('authorization');
  if (!header) return false;
  const match = /^Bearer (.+)$/.exec(header);
  const token = match?.[1];
  if (!token) return false;
  return safeEqual(token, cronSecret);
}
