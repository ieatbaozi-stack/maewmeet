// R13 §1.4 (+ "main มอบเพิ่ม" ใต้ §3): ป้ายลิงก์ในไฟล์ .ics ตามภาษาที่ผู้ใช้เห็นอยู่ · อ่านจาก messages/*.json แบบเดียวกับข้อความ LINE
// ลำดับภาษา: คุกกี้ mm_locale ของคำขอ (ค่าในชุดเท่านั้น) → user.locale → th · เพราะ /api/prefs ไม่บันทึก user.locale ตอนสลับภาษา
// ไม่ hard-code ข้อความ: คีย์ `appointments.calendar.labelMap` / `labelPlan` (ux) · ไม่มีโคลอน ics.ts ต่อ ": " เอง
import type { CalendarLinkLabels } from '@/lib/calendar';
import { readCookie } from '@/lib/auth/request';
import { LOCALE_COOKIE, LOCALES, type Locale } from '@/lib/data/services/prefs';
import en from '../../../messages/en.json';
import th from '../../../messages/th.json';

export type CalendarLabelLocale = Locale;

/** คุกกี้ mm_locale ที่เป็นค่าในชุด (th/en) · ไม่มีหรือค่าผิด = null (ให้ผู้เรียกใช้ทางสำรอง) */
export function localeFromCookie(req: Request): Locale | null {
  const raw = readCookie(req, LOCALE_COOKIE);
  return raw !== null && (LOCALES as readonly string[]).includes(raw) ? (raw as Locale) : null;
}

/** คุกกี้ → ค่าในบัญชี → th */
export function resolveCalendarLocale(cookieLocale: Locale | null, accountLocale: Locale | null | undefined): Locale {
  return cookieLocale ?? accountLocale ?? 'th';
}

export function calendarLinkLabels(locale: CalendarLabelLocale | null | undefined): CalendarLinkLabels {
  const c = (locale === 'en' ? en : th).appointments.calendar;
  return { map: c.labelMap, plan: c.labelPlan };
}
