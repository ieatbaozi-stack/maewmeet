// serializer busy routine — R14 · ADR 0012 §5, §7 · **เจ้าของเท่านั้น** (ไม่มีมุมมองสำหรับคนอื่นเลย — ไม่มี endpoint ให้ดู routine ของคนอื่น)
// สร้างอ็อบเจกต์ใหม่จาก allowlist · ไม่ส่ง user_id / created_at / updated_at (ไม่จำเป็นต่อ UI)
import { formatRoutineTime, isOvernight, maskToWeekdays } from '@/lib/calendar';
import type { OwnRoutineListRow, OwnRoutineRow } from '@/lib/data/repos/busy-routine';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';

export type RoutineOwnView = {
  id: string;
  title: string | null;
  note: string | null;
  hidden: boolean;
  allDay: boolean;
  /** ISO 1 = จันทร์ … 7 = อาทิตย์ เรียงจากจันทร์ */
  weekdays: number[];
  /** 'HH:mm' · null เมื่อ allDay */
  startTime: string | null;
  /** 'HH:mm' หรือ "24:00" · null เมื่อ allDay */
  endTime: string | null;
  /** จบวันถัดไป (endTime ≤ startTime) — นับเป็นวันที่เริ่ม */
  overnight: boolean;
  rangeKind: 'weeks' | 'months';
  /** วันแรก/วันสุดท้ายของช่วง (รวมปลาย) — weeks: จันทร์ → อาทิตย์ · months: วันที่ 1 → วันสุดท้ายของเดือน */
  startDate: string;
  endDate: string;
  tz: string;
  /** วันของชุดนี้ที่ยังไม่สิ้นสุด (end_at > ตอนนี้) — ไม่นับวันที่ลบ/แยกไปแล้ว */
  remaining: number;
};

/** allowlist ของ RoutineOwnView (เทสต์ใช้ตรวจ) */
export const ROUTINE_OWN_FIELDS = [
  'id',
  'title',
  'note',
  'hidden',
  'allDay',
  'weekdays',
  'startTime',
  'endTime',
  'overnight',
  'rangeKind',
  'startDate',
  'endDate',
  'tz',
  'remaining',
] as const satisfies readonly (keyof RoutineOwnView)[];

export function toRoutineOwnView(r: OwnRoutineRow | OwnRoutineListRow, remaining?: number): RoutineOwnView {
  const timed = !r.allDay && r.startMin !== null && r.endMin !== null;
  return {
    id: r.id,
    title: r.title === null ? null : sanitizeDisplayText(r.title),
    note: r.note,
    hidden: r.hideDetail,
    allDay: r.allDay,
    weekdays: maskToWeekdays(r.weekdays),
    startTime: timed ? formatRoutineTime(r.startMin!) : null,
    endTime: timed ? formatRoutineTime(r.endMin!) : null,
    overnight: timed ? isOvernight(r.startMin!, r.endMin!) : false,
    rangeKind: r.rangeKind,
    startDate: r.startDate,
    endDate: r.endDate,
    tz: r.tz,
    remaining: remaining ?? ('remaining' in r ? r.remaining : 0),
  };
}
