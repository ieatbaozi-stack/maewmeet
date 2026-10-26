// ชื่อวันแบบสั้น ที่ผลเหมือนกันทุกเอนจิน (SSR/Node กับเบราว์เซอร์) — กัน hydration mismatch
// เหตุ: Intl `weekday: 'short'` ภาษาไทยให้ "เสาร์"/"พฤหัส" ใน Node แต่ "ส."/"พฤ." ใน Chrome (ข้อมูล ICU ต่างกัน)
// ไทย: ใช้ชื่อเต็ม (ตรงกันทุกเอนจิน) แล้วตัดคำนำหน้า "วัน" · อังกฤษ: short ("Sat") ตรงกันอยู่แล้ว
import { format, type CalendarLocale, type DateISO, type EpochMs } from "@/lib/calendar";

export function weekdayShort(value: EpochMs | DateISO, opts: { locale: CalendarLocale; tz?: string }): string {
  if (opts.locale === "en") return format(value, { locale: "en", style: "weekday-short", ...(opts.tz ? { tz: opts.tz } : {}) });
  const long = format(value, { locale: "th", style: "weekday-long", ...(opts.tz ? { tz: opts.tz } : {}) });
  return long.replace(/^\u0E27\u0E31\u0E19/u, "") /* คำนำหน้า "วัน" (escape: ไม่ใช่ข้อความ UI) */;
}
