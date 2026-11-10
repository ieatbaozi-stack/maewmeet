// busy ของสมาชิกกลุ่ม = busy_block (ADR 0006) ∪ นัดที่ตอบ "ไป" จากทุกกลุ่ม (ADR 0009 §1–2) — ที่เดียวที่ปฏิทิน/วันว่าง/เตือนนัดทับใช้
//  - 2 คิวรี (busy ฝั่งแชร์ + going) รันขนานกัน · เพดานแยกกัน · truncated = busyTruncated || goingTruncated
//  - going → มุมมองตามชนิด (serializer) → รวมช่วงกลุ่มอื่นของคนเดียวกัน → BusyInput timed ให้ lib (คีย์ภายใน 'g:<ลำดับ>' ไม่ออกนอกเซิร์ฟเวอร์)
//  - วันท้องถิ่นของ going คำนวณด้วย toLocal ของ src/lib/calendar ใน tz กลุ่ม (กฎ 9) · lib commonFreeTime/membersBlockedDuring ไม่ต้องแก้
import { toLocal, type FreeTimeBusyInput } from '@/lib/calendar';
import type { DbOrTx } from '@/db/client';
import { listGoingBusyInGroup, listSharedBusyInGroup } from '@/lib/data/repos/busy';
import { CALENDAR_MAX_ITEMS } from '@/lib/shared/limits';
import { compareBusyViews, mergeOtherGroupViews, toBusyForViewers, toGoingForViewers, type MemberBusyView } from '../serializers/busy';

/** ชิ้นเดียว: `input` = สิ่งที่ lib ใช้ (ภายใน) · `view` = สิ่งที่ส่งออก (ผ่าน serializer แล้ว) */
export type MemberBusyItem = { key: string; input: FreeTimeBusyInput; view: MemberBusyView };

/**
 * busy ทั้งหมดของสมาชิกปัจจุบันของกลุ่มที่ทับ [fromMs, toMs) เรียงตาม compareBusyViews
 * `excludeAppointmentId`: ตัดนัดนี้ (ของกลุ่มนี้เท่านั้น) ออกจาก going — ใช้ตอนเตือนนัดทับของนัดเดิม (ADR 0009 §4)
 * ผู้เรียกต้องผ่านด่านกลุ่มมาแล้ว
 */
export async function loadMemberBusy(
  db: DbOrTx,
  groupId: string,
  tz: string,
  fromMs: number,
  toMs: number,
  excludeAppointmentId?: string,
  /** เพดานแถวต่อแหล่ง (busy / going) — ปฏิทินที่ส่งรายการ = CALENDAR_MAX_ITEMS (ดีฟอลต์) · ทางคำนวณ = FREE_TIME_MAX_ITEMS (R14 B11) */
  max: number = CALENDAR_MAX_ITEMS,
): Promise<{ items: MemberBusyItem[]; truncated: boolean }> {
  const [busy, going] = await Promise.all([
    listSharedBusyInGroup(db, groupId, fromMs, toMs, max),
    listGoingBusyInGroup(db, groupId, fromMs, toMs, max, excludeAppointmentId),
  ]);
  const items: MemberBusyItem[] = busy.rows.map((r) => ({ key: r.id, input: r, view: toBusyForViewers(r) }));
  mergeOtherGroupViews(going.rows.map(toGoingForViewers)).forEach((view, i) => {
    const key = `g:${i}`;
    items.push({
      key,
      view,
      input: {
        id: key,
        userId: view.userId,
        allDay: false,
        startAt: view.startAt,
        endAt: view.endAt,
        localStartDate: toLocal(view.startAt, tz).date,
        localEndDate: toLocal(view.endAt - 1, tz).date,
      },
    });
  });
  items.sort((a, b) => compareBusyViews(a.view, b.view));
  return { items, truncated: busy.truncated || going.truncated };
}
