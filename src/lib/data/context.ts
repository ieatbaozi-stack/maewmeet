// context ที่ route ส่งให้ service ของกลุ่ม/คำเชิญ — db / req (อ่าน IP สำหรับ rate limit) / now (จาก clock ของ request) / APP_SECRET
// (รูปเดียวกับ AuthCtx ของ src/lib/auth/context.ts แต่ไม่ผูกกับ pepper)
import { getDb, type Db } from '@/db/client';
import { getEnv } from '@/lib/shared/env';

export type DataCtx = {
  readonly db: Db;
  readonly req: Request;
  /** epoch ms ของ request นี้ (clock ที่ inject ได้) */
  readonly now: number;
  /** base64 ของ APP_SECRET — subkey ของ HMAC โค้ดเชิญ / IP */
  readonly appSecret: string;
};

export function dataCtx(req: Request, now: number): DataCtx {
  return { db: getDb(), req, now, appSecret: getEnv().APP_SECRET };
}
