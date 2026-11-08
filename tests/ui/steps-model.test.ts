import { describe, expect, it } from "vitest";
import { computeSteps } from "@/components/groups/steps-model";

const states = (r: ReturnType<typeof computeSteps>) => r.steps.map((s) => s.state);

describe("computeSteps (R8 แถบขั้นตอน)", () => {
  it("กลุ่มคนเดียว: ขั้น 1 ถัดไป, ที่เหลือรอ, ยังไม่ครบ", () => {
    const r = computeSteps({ memberCount: 1, viewerHasBusy: false, upcomingCount: 0 });
    expect(states(r)).toEqual(["next", "todo", "todo", "todo"]);
    expect(r.doneCount).toBe(0);
    expect(r.allDone).toBe(false);
  });

  it("เชิญแล้วแต่ยังไม่ลง busy: ขั้น 1 เสร็จ ขั้น 2 ถัดไป", () => {
    const r = computeSteps({ memberCount: 2, viewerHasBusy: false, upcomingCount: 0 });
    expect(states(r)).toEqual(["done", "next", "todo", "todo"]);
    expect(r.doneCount).toBe(1);
  });

  it("ลง busy แล้วแต่ยังไม่มีเพื่อน: ขั้น 2 เสร็จ ขั้น 1 ยังเป็นถัดไป", () => {
    const r = computeSteps({ memberCount: 1, viewerHasBusy: true, upcomingCount: 0 });
    expect(states(r)).toEqual(["next", "done", "todo", "todo"]);
  });

  it("ขั้น 1-2 เสร็จ ไม่มีนัด: ขั้น 3 เป็นถัดไป (มาก่อนขั้น 4)", () => {
    const r = computeSteps({ memberCount: 3, viewerHasBusy: true, upcomingCount: 0 });
    expect(states(r)).toEqual(["done", "done", "next", "todo"]);
    expect(r.allDone).toBe(false);
  });

  it("ขั้น 1, 2, 4 เสร็จ = ครบ: ไม่มีขั้นถัดไป, ขั้น 3 ไม่เสร็จและไม่ถูกนับ", () => {
    const r = computeSteps({ memberCount: 2, viewerHasBusy: true, upcomingCount: 1 });
    expect(states(r)).toEqual(["done", "done", "todo", "done"]);
    expect(r.allDone).toBe(true);
    expect(r.doneCount).toBe(3);
  });

  it("มีนัดแต่ยังไม่ลง busy: ไม่ครบ, ถัดไปคือขั้น 2", () => {
    const r = computeSteps({ memberCount: 2, viewerHasBusy: false, upcomingCount: 2 });
    expect(states(r)).toEqual(["done", "next", "todo", "done"]);
    expect(r.allDone).toBe(false);
  });

  it("มี 'ถัดไป' ได้ขั้นเดียวเสมอ (เมื่อยังไม่ครบ)", () => {
    for (const memberCount of [1, 2]) for (const viewerHasBusy of [false, true]) for (const upcomingCount of [0, 1]) {
      const r = computeSteps({ memberCount, viewerHasBusy, upcomingCount });
      expect(r.steps.filter((s) => s.state === "next").length).toBe(r.allDone ? 0 : 1);
    }
  });

  it("ขั้น 3 ไม่เคยเป็น done", () => {
    expect(computeSteps({ memberCount: 9, viewerHasBusy: true, upcomingCount: 9 }).steps[2]!.state).not.toBe("done");
  });
});
