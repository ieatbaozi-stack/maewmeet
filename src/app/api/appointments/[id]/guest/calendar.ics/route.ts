// GET /api/appointments/:id/guest/calendar.ics — .ics ของแขก (ข้อมูลชุดเดียวกับของสมาชิก) — R18 §S4 · เจ้าของ: Platform
// เปิดจากลิงก์แล้วไม่สำเร็จ → 303 ไปหน้านัด (แบบ .ics สมาชิก R12 §5) · cross-site navigate → ปฏิเสธก่อน service
import { dataCtx } from '@/lib/data/context';
import { getGuestAppointmentIcs, shareAppointmentParamsSchema } from '@/lib/data/services/share';
import { configuredAppOrigin, getEnv } from '@/lib/shared/env';
import { AppError } from '@/lib/shared/errors';
import { CACHE_CONTROL, reply, route, type RouteContext } from '../../../../_lib/route';

const ICS_FILENAME = 'maewmeet-plan.ics';
const isNavigation = (req: Request): boolean => req.headers.get('sec-fetch-mode') === 'navigate';

async function redirectNavigation(res: Response, req: Request, ctx: RouteContext | undefined): Promise<Response> {
  if (res.ok || !isNavigation(req)) return res;
  const parsed = shareAppointmentParamsSchema.safeParse(await ctx?.params);
  const location = parsed.success ? `/appointments/${parsed.data.id}` : '/';
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': CACHE_CONTROL } });
}

export const GET = route({
  method: 'GET',
  path: '/api/appointments/:id/guest/calendar.ics',
  params: shareAppointmentParamsSchema,
  finalize: redirectNavigation,
  handler: async ({ actor, params, req, now }) => {
    if (isNavigation(req) && req.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('FORBIDDEN');
    const appOrigin = configuredAppOrigin(getEnv()) ?? new URL(req.url).origin;
    const ics = await getGuestAppointmentIcs(actor, params.id, appOrigin, dataCtx(req, now));
    return reply(ics, { contentType: 'text/calendar; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="${ICS_FILENAME}"` } });
  },
});
