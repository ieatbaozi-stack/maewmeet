// /api/me/line — สถานะ (GET) · สร้างโค้ดเชื่อม (POST) · ยกเลิกการเชื่อม (DELETE) · R10 §2 · session ตรวจที่เซิร์ฟเวอร์ · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { createMyLineCode, getMyLineStatus, unlinkMyLine } from '@/lib/data/services/line-link';
import { reply, route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/me/line',
  handler: ({ actor, req, now }) => getMyLineStatus(actor, dataCtx(req, now)),
});

export const POST = route({
  method: 'POST',
  path: '/api/me/line',
  handler: async ({ actor, req, now }) => reply(await createMyLineCode(actor, dataCtx(req, now)), { status: 201 }),
});

export const DELETE = route({
  method: 'DELETE',
  path: '/api/me/line',
  handler: ({ actor, req, now }) => unlinkMyLine(actor, dataCtx(req, now)),
});
