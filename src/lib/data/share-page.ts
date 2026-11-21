// ตัวโหลดฝั่งเซิร์ฟเวอร์ของหน้า /i/[token] (R18 §S3 · ADR 0016 §3–§4) — frontend เรนเดอร์ผลลัพธ์ · platform เป็นเจ้าของการตัดสินทั้งหมด
// ใช้ใน server component เท่านั้น:
//   const page = await loadSharePage(params.token);
//   switch (page.kind) { case 'member': case 'guest': redirect(`/appointments/${page.appointmentId}`); case 'pinChangeRequired': redirect('/set-pin'); ... }
// - Request ที่ส่งให้ service มีคุกกี้ (session) + header IP ของคำขอจริง (ถัง share:view:ip ต่อการเรนเดอร์) — ไม่มี token ใน header/log
// - GET ไม่สร้างแถวใด ๆ นอกจากถัง rate limit · ไม่ log token (ห้ามใส่ token ใน console/metadata/OG ของหน้า)
import { headers } from 'next/headers';
import { getRequestSession } from '@/lib/auth/page-session';
import { clock } from '@/lib/shared/clock';
import { dataCtx } from './context';
import { getSharePage, type SharePageDto } from './services/share';

const IP_HEADERS = ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for'] as const;

export type { SharePageDto };

export async function loadSharePage(rawToken: string): Promise<SharePageDto> {
  const [{ actor, req: sessionReq }, h] = await Promise.all([getRequestSession(), headers()]);
  const forwarded = new Headers(sessionReq.headers);
  for (const k of IP_HEADERS) {
    const v = h.get(k);
    if (v) forwarded.set(k, v);
  }
  const req = new Request(sessionReq.url, { headers: forwarded });
  return getSharePage(actor, rawToken, dataCtx(req, clock.now()));
}
