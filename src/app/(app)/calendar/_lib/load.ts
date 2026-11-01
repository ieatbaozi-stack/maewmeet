// โหลดข้อมูลแท็บปฏิทินฝั่งเซิร์ฟเวอร์ — เรียก service ตรง (authorize() บรรทัดแรกของ service ยังทำงานเหมือนผ่าน API)
// สิทธิ์ตัดสินที่ service เสมอ: ไม่ใช่สมาชิก/กลุ่มถูกลบ → NOT_FOUND → สถานะ "gone" (UI ไม่เปิดเผยว่ากลุ่มมีอยู่)
// R6D G1 (ADR 0009 §5): กลุ่มที่แสดง = ?g= (ถ้าเป็นกลุ่มของฉัน) → คุกกี้ mm_group (uuid + อยู่ใน listMyGroups ที่โหลดอยู่แล้ว — 0 query เพิ่ม) → กลุ่มแรก
//   Server Component ตั้งคุกกี้ไม่ได้ → คืน rememberGid ให้หน้าเรนเดอร์ <RememberGroup> (PUT /api/me/current-group)
import { pageRequest } from "@/app/_lib/session";
import type { InitialAvailability, InitialCalendar, CalView } from "@/components/calendar/CalendarView";
import { canEditSettings, viewerRole } from "@/components/groups/helpers";
import { isValidDate, monthGrid, todayIn, type DateISO, type EpochMs } from "@/lib/calendar";
import { dataCtx } from "@/lib/data/context";
import { getGroupAvailability } from "@/lib/data/services/availability";
import { getGroupCalendar } from "@/lib/data/services/calendar";
import { getGroup, listMyGroups } from "@/lib/data/services/groups";
import { getActor } from "@/lib/auth/session";
import { readCookie } from "@/lib/auth/request";
import { CURRENT_GROUP_COOKIE, chooseCalendarGroup } from "@/lib/shared/current-group-cookie";
import { fetchRange } from "@/components/calendar/model";
import { clock } from "@/lib/shared/clock";
import { AppError } from "@/lib/shared/errors";

export interface CalendarSearch {
  g?: string | undefined;
  v?: string | undefined;
  d?: string | undefined;
}

export type CalendarPageData =
  | { kind: "no-group" }
  | {
      kind: "ready";
      groups: { id: string; name: string; memberCount: number }[];
      gid: string;
      tz: string;
      today: DateISO;
      nowMs: EpochMs;
      date: DateISO;
      view: CalView;
      /** มี ?g= แต่ไม่ใช่กลุ่มของฉัน → แสดงกลุ่มจากคุกกี้/กลุ่มแรกแทน (UI แจ้งสั้นๆ; API ยัง 404 ไม่เปิดเผยว่ากลุ่มมีอยู่) · คุกกี้ใช้ไม่ได้ → false เสมอ */
      groupMissing: boolean;
      /** R6D G1: ?g= เป็นกลุ่มของฉันแต่ต่างจากคุกกี้ → gid ที่หน้าควรจำ (เรนเดอร์ <RememberGroup gid>) · อื่น ๆ null */
      rememberGid: string | null;
      /** มี ?d= ที่ถูกต้องมาจริง (ไม่ใช่วันนี้ที่เดาให้) — มุมมอง "ว่างตรงกัน" ใช้เลือกวันที่แผงขวา */
      dateGiven: boolean;
      /** ผู้ดู admin/ผู้ช่วยดูแล → เห็นลิงก์ "ปรับช่วงเวลา" (ความสะดวกเท่านั้น — สิทธิ์จริงตรวจที่ API) */
      canEditWindow: boolean;
      initial: InitialCalendar;
      /** ?v=free: โหลดผลว่างร่วมของเดือนแรกที่เซิร์ฟเวอร์ (ไม่โหลดปฏิทิน — โหลดเมื่อสลับไปมุมมองเดือน) */
      initialAvailability: InitialAvailability | null;
    };

const VIEWS: readonly CalView[] = ["month", "free", "day", "mine"];

/** group ที่ขอมาไม่ใช่ของฉัน/ไม่มี → ใช้กลุ่มจากคุกกี้/กลุ่มแรก (ไม่เปิดเผยว่ามี) + groupMissing=true · d ที่ผิดรูปแบบ → วันนี้ · v ที่ไม่รู้จัก → เดือน */
export async function loadCalendarPage(search: CalendarSearch): Promise<CalendarPageData> {
  const req = await pageRequest();
  const actor = await getActor(req);
  const nowMs = clock.now();
  const ctx = dataCtx(req, nowMs);

  const { groups } = await listMyGroups(actor, ctx);
  const first = groups[0];
  if (!first) return { kind: "no-group" };
  const pick = chooseCalendarGroup(
    groups.map((g) => g.id),
    search.g,
    readCookie(req, CURRENT_GROUP_COOKIE),
  );
  const chosen = groups.find((g) => g.id === pick.gid) ?? first;
  const { groupMissing, rememberGid } = pick;
  const options = groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount }));
  const view = VIEWS.find((v) => v === search.v) ?? "month";

  let tz: string;
  let canEditWindow = false;
  try {
    const detail = (await getGroup(actor, chosen.id, ctx)).group;
    tz = detail.tz;
    canEditWindow = canEditSettings(viewerRole(detail.myRole));
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") {
      // เพิ่งถูกนำออก/กลุ่มถูกลบระหว่างทาง
      const today = todayIn("Asia/Bangkok", nowMs);
      return { kind: "ready", groups: options, gid: chosen.id, tz: "Asia/Bangkok", today, nowMs, date: today, view, groupMissing, rememberGid: null, dateGiven: false, canEditWindow: false, initial: { status: "gone" }, initialAvailability: view === "free" ? { status: "gone" } : null };
    }
    throw e;
  }

  const today = todayIn(tz, nowMs);
  const dateGiven = search.d !== undefined && isValidDate(search.d);
  const date = dateGiven && search.d !== undefined ? search.d : today;
  const grid = monthGrid(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  const range = fetchRange(grid.from, grid.to);
  const failure = (e: unknown) => ({ status: e instanceof AppError && e.code === "NOT_FOUND" ? ("gone" as const) : ("error" as const) });
  let initial: InitialCalendar;
  let initialAvailability: InitialAvailability | null = null;
  if (view === "free") {
    initial = { status: "skipped" };
    try {
      initialAvailability = { status: "ready", data: await getGroupAvailability(actor, chosen.id, range, ctx) };
    } catch (e) {
      initialAvailability = failure(e);
    }
  } else {
    try {
      initial = { status: "ready", data: await getGroupCalendar(actor, chosen.id, range, ctx) };
    } catch (e) {
      initial = failure(e);
    }
  }
  return { kind: "ready", groups: options, gid: chosen.id, tz, today, nowMs, date, view, groupMissing, rememberGid, dateGiven, canEditWindow, initial, initialAvailability };
}
