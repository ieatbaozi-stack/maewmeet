// serializer busy — ที่เดียวที่ busy ออกจากระบบ (ADR 0006 §2–3) · Security ตรวจจบที่ไฟล์นี้
//
// ชนิดแยกกันระดับ type: BusyHiddenView **ไม่มีฟิลด์** title/note (ไม่ใช่ null/"") · BusySharedView มี title? (ไม่มี note) · BusyOwnView มีครบ
// ทุกฟังก์ชันสร้างอ็อบเจกต์ใหม่จากรายชื่อฟิลด์ที่อนุญาต (allowlist) — ไม่ลบฟิลด์ออกจากแถว DB
// ผู้ดูที่ไม่ใช่เจ้าของไม่มีทางได้ OwnBusyRow: repo ฝั่งแชร์ไม่ SELECT note (ดู repos/busy.ts) และ toBusyForViewers รับ SharedBusyRow เท่านั้น
// ไม่ส่ง created_at/updated_at ให้คนอื่น (กันเดาพฤติกรรม) · รายการที่ไม่ได้กรอก title กับรายการซ่อน หน้าตาเหมือนกัน (UX X28)
// R6F (ADR 0010 §6): seriesId ส่งให้เจ้าของเท่านั้น (BusyOwnView) · มุมมองของคนอื่นไม่มี key นี้เลยทุกกรณี (SharedBusyRow ไม่มีคอลัมน์ series_id)
// R6D (ADR 0009 §2): ทุกชิ้นใน busy[] ที่คนอื่นเห็นมี `kind` — 'busy' (busy_block) · 'appointment' (นัดที่ตอบ "ไป" ในกลุ่มที่กำลังดู) ·
//   'other_group_appointment' (นัดกลุ่มอื่น — แค่ช่วงเวลา ไม่มี key id/title/group/place/tz เลย ไม่ใช่ null)
import type { GoingBusyRow, OwnBusyRow, SharedBusyRow } from '@/lib/data/repos/busy';
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
export type BusyHiddenView = { kind: 'busy' } & BusyBase;
/** รายการที่เพื่อนเห็น title ได้ — ไม่มี note */
export type BusySharedView = BusyHiddenView & { title?: string };
/** นัดที่สมาชิกตอบ "ไป" ในกลุ่มที่กำลังดู — สมาชิกกลุ่มนี้เห็นนัดนี้อยู่แล้ว (ADR 0009 §2) */
export type AppointmentBusyView = { kind: 'appointment'; appointmentId: string; userId: string; title: string; startAt: number; endAt: number };
/** นัดกลุ่มอื่นที่สมาชิกตอบ "ไป" — ช่วงเวลาเท่านั้น (รวมช่วงที่ทับ/ชนขอบของคนเดียวกันแล้ว: ไม่บอกจำนวนนัด/กลุ่ม) */
export type OtherGroupBusyView = { kind: 'other_group_appointment'; userId: string; startAt: number; endAt: number };
/** ชิ้นเดียวใน busy[] ของปฏิทิน/วันว่าง/เตือนนัดทับ */
export type MemberBusyView = BusySharedView | BusyHiddenView | AppointmentBusyView | OtherGroupBusyView;
export type MemberBusyKind = MemberBusyView['kind'];
/**
 * เจ้าของเห็นครบ · R6F: seriesId (ชุดรายวัน · null = รายการเดี่ยว) · R14: routineId (วันของ routine · null = ไม่ใช่/แยกออกแล้ว)
 * — **เจ้าของเท่านั้น** ไม่อยู่ใน BUSY_SHARED_FIELDS (ADR 0010 §6, ADR 0012 §7)
 */
export type BusyOwnView = BusyBase & { title: string | null; note: string | null; hidden: boolean; seriesId: string | null; routineId: string | null };

/** ชื่อฟิลด์ของ kind 'busy' ที่ส่งให้คนอื่นได้ทั้งหมด (allowlist — เทสต์ใช้ตรวจ) */
export const BUSY_SHARED_FIELDS = ['kind', 'id', 'userId', 'allDay', 'startAt', 'endAt', 'localStartDate', 'localEndDate', 'tz', 'title'] as const;
/** allowlist ต่อชนิด (ADR 0009 §2) — ฟิลด์ครบทั้งหมด ห้ามเกิน */
export const BUSY_VIEW_FIELDS = {
  busy: BUSY_SHARED_FIELDS,
  appointment: ['kind', 'appointmentId', 'userId', 'title', 'startAt', 'endAt'],
  other_group_appointment: ['kind', 'userId', 'startAt', 'endAt'],
} as const satisfies Record<MemberBusyKind, readonly string[]>;

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
    seriesId: r.seriesId ?? null,
    routineId: r.routineId ?? null,
  };
}

/**
 * มุมมองที่ส่งให้สมาชิกกลุ่ม / super admin ผ่านกลุ่ม — hideDetail → BusyHiddenView (ไม่มี title) · ไม่ซ่อน → title ถ้ามี
 * ตัดซ้ำสองชั้น: SQL ตัด title ของรายการซ่อนแล้ว และที่นี่ตัดตามธง hideDetail อีกครั้ง
 */
export function toBusyForViewers(r: SharedBusyRow): BusySharedView | BusyHiddenView {
  const view: BusyHiddenView = { kind: 'busy', ...base(r) };
  if (r.hideDetail || r.title === null) return view;
  const title = sanitizeDisplayText(r.title);
  return title === '' ? view : { ...view, title };
}

/**
 * วันว่างร่วม (U9.1, ADR 0006 §3): busy ส่ง *ครั้งเดียว* ที่ระดับบนของ response เป็นอาร์เรย์ (เรียง startAt, id) ผ่าน toBusyForViewers ตัวเดียวกัน
 * → รายการซ่อน/ไม่ได้กรอก title ไม่มีฟิลด์ title · ไม่มี note · แต่ละวันอ้างด้วย *ดัชนี* ในอาร์เรย์นั้น (เลขสั้น — id เป็น uuid 36 ตัวอักษร
 * ซ้ำ แถว×วัน ก็ยังพอง ~700 KB ที่ 300 แถว × 62 วัน) ⇒ ขนาด O(แถว + วัน×สมาชิก×เลขสั้น)
 */
export type AvailabilityBusyView = MemberBusyView;
/** itemIdx = ดัชนีใน `busy[]` ระดับบน · เรียงจากน้อยไปมาก (= ลำดับ compareBusyViews) */
export type BlockerRef = { userId: string; itemIdx: number[] };

/** เรียง startAt, id ให้ผลคงที่ (แถว busy_block ล้วน) */
export const compareBusyRows = (a: Pick<SharedBusyRow, 'startAt' | 'id'>, b: Pick<SharedBusyRow, 'startAt' | 'id'>): number =>
  a.startAt - b.startAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const KIND_ORDER: Record<MemberBusyKind, number> = { busy: 0, appointment: 1, other_group_appointment: 2 };
const tieKey = (v: MemberBusyView): string => (v.kind === 'busy' ? v.id : v.kind === 'appointment' ? v.appointmentId : v.userId);

/** ลำดับของ busy[] (ADR 0009 §2): startAt, endAt, kind (busy < appointment < other_group_appointment), id|appointmentId|userId */
export function compareBusyViews(a: MemberBusyView, b: MemberBusyView): number {
  if (a.startAt !== b.startAt) return a.startAt - b.startAt;
  if (a.endAt !== b.endAt) return a.endAt - b.endAt;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  const ka = tieKey(a);
  const kb = tieKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * แถว going → มุมมองสำหรับสมาชิกกลุ่มที่กำลังดู · สร้างอ็อบเจกต์ใหม่จาก allowlist ต่อชนิด
 * ตัดซ้ำสองชั้น: SQL ให้ id/title เป็น NULL แล้วเมื่อเป็นนัดกลุ่มอื่น และที่นี่ไม่อ่าน id/title เลยถ้าไม่ใช่กลุ่มเดียวกัน
 */
export function toGoingForViewers(r: GoingBusyRow): AppointmentBusyView | OtherGroupBusyView {
  if (r.sameGroup && r.appointmentId !== null) {
    return { kind: 'appointment', appointmentId: r.appointmentId, userId: r.userId, title: sanitizeDisplayText(r.title ?? ''), startAt: r.startAt, endAt: r.endAt };
  }
  return { kind: 'other_group_appointment', userId: r.userId, startAt: r.startAt, endAt: r.endAt };
}

/**
 * รวมช่วง `other_group_appointment` ของ user เดียวกันที่ทับ/ชนขอบเป็นช่วงเดียว (ไม่บอกว่ามีกี่นัด/กี่กลุ่ม) · ชนิดอื่นคงเดิม
 * ผลวันว่างไม่เปลี่ยน (ยูเนียนของช่วงเท่าเดิม) · คืนอ็อบเจกต์ใหม่ เรียงตาม compareBusyViews
 */
export function mergeOtherGroupViews(views: readonly (AppointmentBusyView | OtherGroupBusyView)[]): (AppointmentBusyView | OtherGroupBusyView)[] {
  const out: (AppointmentBusyView | OtherGroupBusyView)[] = [];
  const byUser = new Map<string, OtherGroupBusyView[]>();
  for (const v of views) {
    if (v.kind !== 'other_group_appointment') {
      out.push(v);
      continue;
    }
    const list = byUser.get(v.userId) ?? [];
    list.push(v);
    byUser.set(v.userId, list);
  }
  for (const [userId, list] of byUser) {
    list.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
    let cur: OtherGroupBusyView | null = null;
    for (const v of list) {
      if (cur !== null && v.startAt <= cur.endAt) {
        if (v.endAt > cur.endAt) cur.endAt = v.endAt;
        continue;
      }
      if (cur !== null) out.push(cur);
      cur = { kind: 'other_group_appointment', userId, startAt: v.startAt, endAt: v.endAt };
    }
    if (cur !== null) out.push(cur);
  }
  return out.sort(compareBusyViews);
}
