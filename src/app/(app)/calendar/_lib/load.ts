// โหลดข้อมูลแท็บปฏิทินฝั่งเซิร์ฟเวอร์ — เรียก service ตรง (authorize() บรรทัดแรกของ service ยังทำงานเหมือนผ่าน API)
// สิทธิ์ตัดสินที่ service เสมอ: ไม่ใช่สมาชิก/กลุ่มถูกลบ → NOT_FOUND → สถานะ "gone" (UI ไม่เปิดเผยว่ากลุ่มมีอยู่)
import { pageRequest } from "@/app/_lib/session";
import type { InitialCalendar, CalView } from "@/components/calendar/CalendarView";
import { isValidDate, monthGrid, todayIn, type DateISO, type EpochMs } from "@/lib/calendar";
import { dataCtx } from "@/lib/data/context";
import { getGroupCalendar } from "@/lib/data/services/calendar";
import { getGroup, listMyGroups } from "@/lib/data/services/groups";
import { getActor } from "@/lib/auth/session";
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
      /** มี ?g= แต่ไม่ใช่กลุ่มของฉัน → แสดงกลุ่มแรกแทน (UI แจ้งสั้นๆ; API ยัง 404 ไม่เปิดเผยว่ากลุ่มมีอยู่) */
      groupMissing: boolean;
      initial: InitialCalendar;
    };

const VIEWS: readonly CalView[] = ["month", "day", "mine"];

/** group ที่ขอมาไม่ใช่ของฉัน/ไม่มี → ใช้กลุ่มแรก (ไม่เปิดเผยว่ามี) + groupMissing=true · d ที่ผิดรูปแบบ → วันนี้ · v ที่ไม่รู้จัก → เดือน */
export async function loadCalendarPage(search: CalendarSearch): Promise<CalendarPageData> {
  const req = await pageRequest();
  const actor = await getActor(req);
  const nowMs = clock.now();
  const ctx = dataCtx(req, nowMs);

  const { groups } = await listMyGroups(actor, ctx);
  const first = groups[0];
  if (!first) return { kind: "no-group" };
  const match = groups.find((g) => g.id === search.g);
  const chosen = match ?? first;
  const groupMissing = search.g !== undefined && search.g !== "" && match === undefined;
  const options = groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount }));
  const view = VIEWS.find((v) => v === search.v) ?? "month";

  let tz: string;
  try {
    tz = (await getGroup(actor, chosen.id, ctx)).group.tz;
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") {
      // เพิ่งถูกนำออก/กลุ่มถูกลบระหว่างทาง
      const today = todayIn("Asia/Bangkok", nowMs);
      return { kind: "ready", groups: options, gid: chosen.id, tz: "Asia/Bangkok", today, nowMs, date: today, view, groupMissing, initial: { status: "gone" } };
    }
    throw e;
  }

  const today = todayIn(tz, nowMs);
  const date = search.d !== undefined && isValidDate(search.d) ? search.d : today;
  const grid = monthGrid(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  const range = fetchRange(grid.from, grid.to);
  let initial: InitialCalendar;
  try {
    initial = { status: "ready", data: await getGroupCalendar(actor, chosen.id, range, ctx) };
  } catch (e) {
    initial = { status: e instanceof AppError && e.code === "NOT_FOUND" ? "gone" : "error" };
  }
  return { kind: "ready", groups: options, gid: chosen.id, tz, today, nowMs, date, view, groupMissing, initial };
}
