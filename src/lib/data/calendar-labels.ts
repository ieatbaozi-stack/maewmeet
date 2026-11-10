// R13 §1.4: ป้ายลิงก์ในไฟล์ .ics ตามภาษาที่ผู้ใช้ตั้งในบัญชี (user.locale) ณ ตอนดาวน์โหลด · อ่านจาก messages/*.json แบบเดียวกับข้อความ LINE
// ไม่ hard-code ข้อความ: คีย์ `appointments.calendar.labelMap` / `labelPlan` (ux) · ไม่มีโคลอน ics.ts ต่อ ": " เอง
import type { CalendarLinkLabels } from '@/lib/calendar';
import en from '../../../messages/en.json';
import th from '../../../messages/th.json';

export type CalendarLabelLocale = 'th' | 'en';

export function calendarLinkLabels(locale: CalendarLabelLocale | null | undefined): CalendarLinkLabels {
  const c = (locale === 'en' ? en : th).appointments.calendar;
  return { map: c.labelMap, plan: c.labelPlan };
}
