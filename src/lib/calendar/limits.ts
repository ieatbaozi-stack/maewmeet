// ตัวช่วยตรวจเพดานแบบ pure — ค่าเพดานจริงอยู่ที่ src/lib/shared/limits.ts (Platform) ส่งเข้ามาเป็นพารามิเตอร์
// R3_CONTRACT §2: ช่วงเดียว ≤ 366 วัน · ลงย้อนหลัง ≤ 7 วัน (นับตามวันท้องถิ่นของ tz ผู้ใช้/กลุ่ม ณ เวลา now ที่ inject)
import { addDays, daysBetween } from './date';
import { todayIn } from './zone';
import type { DateISO, EpochMs } from './constants';

/** จำนวนวันปฏิทินที่ช่วงครอบ (รวมปลายทั้งสอง) · 2026-05-01..2026-05-01 = 1 */
export function spanDays(localStartDate: DateISO, localEndDate: DateISO): number {
  return daysBetween(localStartDate, localEndDate) + 1;
}

/** true ถ้าช่วงครอบวันเกิน maxDays */
export function exceedsMaxSpan(localStartDate: DateISO, localEndDate: DateISO, maxDays: number): boolean {
  return spanDays(localStartDate, localEndDate) > maxDays;
}

/** วันท้องถิ่นที่เก่าที่สุดที่ยังถือว่า "ไม่ย้อนหลังเกิน" = วันนี้ใน tz − maxBackdateDays */
export function earliestAllowedDate(nowMs: EpochMs, tz: string, maxBackdateDays: number): DateISO {
  return addDays(todayIn(tz, nowMs), -maxBackdateDays);
}

/**
 * ลงย้อนหลังเกินเพดานหรือไม่ — ตัดสินจาก **วันท้องถิ่นสุดท้ายของรายการ** (local_end_date):
 * ถ้าปลายช่วงอยู่ก่อน (วันนี้ − maxBackdateDays) ถือว่าเก่าเกิน · รายการที่เริ่มนานแล้วแต่ยังไม่จบ (แก้ของที่กำลังดำเนินอยู่) ไม่ถูกปฏิเสธ
 */
export function isTooFarBack(localEndDate: DateISO, nowMs: EpochMs, tz: string, maxBackdateDays: number): boolean {
  return localEndDate < earliestAllowedDate(nowMs, tz, maxBackdateDays);
}
