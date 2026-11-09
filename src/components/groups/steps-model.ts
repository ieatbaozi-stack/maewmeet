/**
 * R8 — โมเดลสถานะแถบขั้นตอนหน้ากลุ่ม (docs/design/R8_ONBOARDING.md §2) · ฟังก์ชันล้วน ไม่มี I/O
 *   ขั้น 1 ชวนเพื่อน: เสร็จเมื่อสมาชิก ≥ 2 · ขั้น 2 ลงวันไม่ว่าง: เสร็จเมื่อแถวของผู้ดูมี hasUpcomingBusy
 *   ขั้น 3 ดูวันว่างตรงกัน: เป็นลิงก์เสมอ ไม่มีสถานะเสร็จ ไม่นับ "ครบ" · ขั้น 4 สร้างนัด: เสร็จเมื่อมีนัดที่กำลังจะถึง ≥ 1
 */
export type StepId = "invite" | "busy" | "free" | "plan";
export type StepState = "done" | "next" | "todo";

export const STEP_IDS: readonly StepId[] = ["invite", "busy", "free", "plan"];
export const STEP_TOTAL = STEP_IDS.length;

export interface StepsInput {
  memberCount: number;
  /** แถวของผู้ดูเองมี busy ใน 30 วันข้างหน้า (ไม่มีแถว/ไม่มีค่า = false) */
  viewerHasBusy: boolean;
  /** นัดที่กำลังจะถึง (ไม่นับที่ยกเลิก) — กลุ่มคนเดียวไม่โหลด = 0 */
  upcomingCount: number;
}

export interface StepsResult {
  steps: { id: StepId; n: number; state: StepState }[];
  /** จำนวนขั้นที่เสร็จ (ขั้น 3 ไม่มีวันนับ) จากทั้งหมด STEP_TOTAL */
  doneCount: number;
  /** ขั้น 1, 2, 4 เสร็จครบ — ขั้น 3 ไม่ถูกนับ */
  allDone: boolean;
}

export function computeSteps({ memberCount, viewerHasBusy, upcomingCount }: StepsInput): StepsResult {
  const done: Record<StepId, boolean> = {
    invite: memberCount >= 2,
    busy: viewerHasBusy === true,
    free: false,
    plan: upcomingCount >= 1,
  };
  const allDone = done.invite && done.busy && done.plan;
  // "ถัดไป" = ขั้นแรกที่ยังไม่เสร็จ (ขั้น 3 ไม่เคยเสร็จ จึงมาก่อนขั้น 4 เสมอ) · ครบแล้วไม่มี "ถัดไป"
  const nextId = allDone ? null : (STEP_IDS.find((id) => !done[id]) ?? null);
  const steps = STEP_IDS.map((id, i) => ({
    id,
    n: i + 1,
    state: (done[id] ? "done" : id === nextId ? "next" : "todo") as StepState,
  }));
  return { steps, doneCount: STEP_IDS.filter((id) => done[id]).length, allDone };
}

/** R10: ปุ่มขั้น 2 "ลงวันไม่ว่าง" → ปฏิทินพร้อมเปิดฟอร์มลง busy (add=1 อ่านครั้งเดียวที่ CalendarView แล้วลบออกจาก URL) */
export const stepBusyAddHref = (groupId: string): string => `/calendar?g=${encodeURIComponent(groupId)}&v=month&add=1`;
