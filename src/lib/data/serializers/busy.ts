// serializer busy — ที่เดียวที่ busy ออกจากระบบ (ADR 0006 §2–3) · Security ตรวจจบที่ไฟล์นี้
//
// ชนิดแยกกันระดับ type: BusyHiddenView **ไม่มีฟิลด์** title/note (ไม่ใช่ null/"") · BusySharedView มี title? (ไม่มี note) · BusyOwnView มีครบ
// ทุกฟังก์ชันสร้างอ็อบเจกต์ใหม่จากรายชื่อฟิลด์ที่อนุญาต (allowlist) — ไม่ลบฟิลด์ออกจากแถว DB
// ผู้ดูที่ไม่ใช่เจ้าของไม่มีทางได้ OwnBusyRow: repo ฝั่งแชร์ไม่ SELECT note (ดู repos/busy.ts) และ toBusyForViewers รับ SharedBusyRow เท่านั้น
// ไม่ส่ง created_at/updated_at ให้คนอื่น (กันเดาพฤติกรรม) · รายการที่ไม่ได้กรอก title กับรายการซ่อน หน้าตาเหมือนกัน (UX X28)
import type { OwnBusyRow, SharedBusyRow } from '@/lib/data/repos/busy';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';

type BusyBase = {
  id: string;
  userId: string;
  allDay: boolean;
  startAt: number;
  endAt: number;
  localStartDate: string;
  localEndDate: string;
  tz: string;
};

/** รายการซ่อนรายละเอียด (หรือไม่ได้กรอกว่าทำอะไร) ที่เพื่อนเห็น — เวลาเท่านั้น */
export type BusyHiddenView = BusyBase;
/** รายการที่เพื่อนเห็น title ได้ — ไม่มี note */
export type BusySharedView = BusyBase & { title?: string };
/** เจ้าของเห็นครบ */
export type BusyOwnView = BusyBase & { title: string | null; note: string | null; hidden: boolean };

/** ชื่อฟิลด์ที่ส่งให้คนอื่นได้ทั้งหมด (allowlist เดียว — เทสต์ใช้ตรวจ) */
export const BUSY_SHARED_FIELDS = ['id', 'userId', 'allDay', 'startAt', 'endAt', 'localStartDate', 'localEndDate', 'tz', 'title'] as const;

const base = (r: BusyBase): BusyBase => ({
  id: r.id,
  userId: r.userId,
  allDay: r.allDay,
  startAt: r.startAt,
  endAt: r.endAt,
  localStartDate: r.localStartDate,
  localEndDate: r.localEndDate,
  tz: r.tz,
});

export function toBusyOwnView(r: OwnBusyRow): BusyOwnView {
  return {
    ...base(r),
    title: r.title === null ? null : sanitizeDisplayText(r.title),
    note: r.note,
    hidden: r.hideDetail,
  };
}

/**
 * มุมมองที่ส่งให้สมาชิกกลุ่ม / super admin ผ่านกลุ่ม — hideDetail → BusyHiddenView (ไม่มี title) · ไม่ซ่อน → title ถ้ามี
 * ตัดซ้ำสองชั้น: SQL ตัด title ของรายการซ่อนแล้ว และที่นี่ตัดตามธง hideDetail อีกครั้ง
 */
export function toBusyForViewers(r: SharedBusyRow): BusySharedView | BusyHiddenView {
  const view = base(r);
  if (r.hideDetail || r.title === null) return view;
  const title = sanitizeDisplayText(r.title);
  return title === '' ? view : { ...view, title };
}

/**
 * วันว่างร่วม (U9.1, ADR 0006 §3): busy ส่ง *ครั้งเดียว* ที่ระดับบนของ response เป็นอาร์เรย์ (เรียง startAt, id) ผ่าน toBusyForViewers ตัวเดียวกัน
 * → รายการซ่อน/ไม่ได้กรอก title ไม่มีฟิลด์ title · ไม่มี note · แต่ละวันอ้างด้วย *ดัชนี* ในอาร์เรย์นั้น (เลขสั้น — id เป็น uuid 36 ตัวอักษร
 * ซ้ำ แถว×วัน ก็ยังพอง ~700 KB ที่ 300 แถว × 62 วัน) ⇒ ขนาด O(แถว + วัน×สมาชิก×เลขสั้น)
 */
export type AvailabilityBusyView = BusySharedView | BusyHiddenView;
/** itemIdx = ดัชนีใน `busy[]` ระดับบน · เรียงจากน้อยไปมาก (= ลำดับ startAt, id) */
export type BlockerRef = { userId: string; itemIdx: number[] };

/** เรียง startAt, id ให้ผลคงที่ */
export const compareBusyRows = (a: Pick<SharedBusyRow, 'startAt' | 'id'>, b: Pick<SharedBusyRow, 'startAt' | 'id'>): number =>
  a.startAt - b.startAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
