// GET /api/appointments/:id/calendar.ics — เพิ่มนัดลงปฏิทินในเครื่อง (R12 §5) · เจ้าของ: Platform
// เปิดจากลิงก์ (Sec-Fetch-Mode: navigate) แล้วไม่สำเร็จ → 303 ไปหน้าที่ตรวจสิทธิ์ของตัวเอง ผู้ใช้จึงไม่เจอ JSON ดิบ · เรียกแบบ API ได้รหัสตามปกติ
import { dataCtx } from '@/lib/data/context';
import { appointmentParamsSchema, getAppointmentIcs } from '@/lib/data/services/appointments';
import { configuredAppOrigin, getEnv } from '@/lib/shared/env';
import { CACHE_CONTROL, reply, route, type RouteContext } from '../../../_lib/route';

/** §9: ถ้าทดสอบเครื่องจริงพบว่า `inline` ดีกว่าบน iPhone เปลี่ยนจุดนี้จุดเดียว */
const ICS_DISPOSITION = 'attachment';
/** ชื่อไฟล์คงที่ ห้ามมาจากชื่อนัด */
const ICS_FILENAME = 'maewmeet-plan.ics';

async function redirectNavigation(res: Response, req: Request, ctx: RouteContext | undefined): Promise<Response> {
  if (res.ok || req.headers.get('sec-fetch-mode') !== 'navigate') return res;
  const parsed = appointmentParamsSchema.safeParse(await ctx?.params);
  const location = parsed.success ? `/appointments/${parsed.data.id}` : '/';
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': CACHE_CONTROL } });
}

export const GET = route({
  method: 'GET',
  path: '/api/appointments/:id/calendar.ics',
  params: appointmentParamsSchema,
  finalize: redirectNavigation,
  handler: async ({ actor, params, req, now }) => {
    const appOrigin = configuredAppOrigin(getEnv()) ?? new URL(req.url).origin;
    const ics = await getAppointmentIcs(actor, params.id, appOrigin, dataCtx(req, now));
    return reply(ics, {
      contentType: 'text/calendar; charset=utf-8',
      headers: { 'Content-Disposition': `${ICS_DISPOSITION}; filename="${ICS_FILENAME}"` },
    });
  },
});
