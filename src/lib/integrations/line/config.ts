// ค่าตั้งช่องทาง LINE — R10 §2: ไม่มี env = ช่องทางปิดเงียบ · ค่าลับอยู่ใน env เท่านั้น (กฎ 7) ห้าม log
import { configuredAppOrigin, type Env } from '@/lib/shared/env';

export type LineConfig = { readonly accessToken: string; readonly channelSecret: string; readonly appOrigin: string };

/** ลิงก์เพิ่มเพื่อน OA — ค่าสาธารณะ (R10 §2) */
export const LINE_ADD_FRIEND_URL = 'https://line.me/R/ti/p/@324icfvb';

/** ต้องมีครบทั้ง token + secret + origin ไม่งั้น null (ปิดช่องทาง) */
export function lineConfig(env: Env): LineConfig | null {
  const accessToken = env.LINE_MESSAGING_ACCESS_TOKEN;
  const channelSecret = env.LINE_MESSAGING_CHANNEL_SECRET;
  const appOrigin = configuredAppOrigin(env);
  if (!accessToken || !channelSecret || !appOrigin) return null;
  return { accessToken, channelSecret, appOrigin };
}
