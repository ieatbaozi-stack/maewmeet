// context ที่ route ส่งให้ทุก service ของ auth — db / req / now (จาก clock ของ request) / APP_SECRET / แหล่ง env ของ pepper
import { getDb, type Db } from '@/db/client';
import { getEnv, type EnvSource } from '@/lib/shared/env';

export type AuthCtx = {
  readonly db: Db;
  readonly req: Request;
  /** epoch ms ของ request นี้ (clock ที่ inject ได้) */
  readonly now: number;
  /** base64 ของ APP_SECRET — ใช้ HKDF subkey สำหรับ HMAC ของ IP */
  readonly appSecret: string;
  /** แหล่งอ่าน PIN_PEPPER_* (ค่าเริ่มต้น process.env · เทสต์ระดับ service ส่งเองได้) */
  readonly pepperSource: EnvSource;
};

export function authCtx(req: Request, now: number): AuthCtx {
  return { db: getDb(), req, now, appSecret: getEnv().APP_SECRET, pepperSource: process.env };
}
