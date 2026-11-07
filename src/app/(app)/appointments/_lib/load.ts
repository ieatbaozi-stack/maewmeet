// โหลดนัดฝั่งเซิร์ฟเวอร์ — เรียก service ตรง (authorize() บรรทัดแรกของ service ทำงานเหมือนผ่าน API)
// ไม่ใช่สมาชิก / ถูกลบออก / นัดไม่มี / id ผิดรูป → notFound() (404 ไม่แยกจากไม่มีอยู่จริง)
import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { dataCtx } from "@/lib/data/context";
import { getAppointment, listGroupAppointments } from "@/lib/data/services/appointments";
import type { AppointmentDetailDto } from "@/lib/data/serializers/appointments";
import type { AppointmentListDto } from "@/lib/data/services/appointments";
import { getRequestSession } from "@/lib/auth/page-session";
import { clock } from "@/lib/shared/clock";
import { AppError } from "@/lib/shared/errors";

async function scope() {
  const { req, actor } = await getRequestSession();
  return { actor, ctx: dataCtx(req, clock.now()) };
}

async function orNotFound<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

const idSchema = z.uuid();

/** cache ต่อ request: generateMetadata + page อ่านครั้งเดียว */
export const loadAppointment = cache(async (id: string): Promise<AppointmentDetailDto> => {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) notFound();
  const { actor, ctx } = await scope();
  return (await orNotFound(() => getAppointment(actor, parsed.data, ctx))).appointment;
});

/** หน้าแรกของ "กำลังจะถึง" ของกลุ่ม (หน้ารายการ) */
export async function loadGroupAppointments(gid: string): Promise<AppointmentListDto> {
  const parsed = idSchema.safeParse(gid);
  if (!parsed.success) notFound();
  const { actor, ctx } = await scope();
  return orNotFound(() => listGroupAppointments(actor, parsed.data, { scope: "upcoming", limit: "50" }, ctx));
}
