// ข้อความ LINE แปลตาม user.locale ณ เวลาส่ง (ADR 0007 §2) · เนื้อหา: ชื่อนัด วันเวลา ชื่อกลุ่ม ลิงก์นัด เท่านั้น (R10 §1.4)
import { createTranslator } from 'next-intl';
import { format } from '@/lib/calendar';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';

export type LineLocale = 'th' | 'en';
export type LineReminderKind = 'appointment.reminder_1d' | 'appointment.reminder_1h';
export type LineLinkReply = 'success' | 'invalid' | 'alreadyLinked';

type Translate = (key: string, values?: Record<string, string>) => string;

function translator(locale: LineLocale): Translate {
  return createTranslator({ locale, messages: (locale === 'th' ? th : en) as never }) as unknown as Translate;
}

/**
 * R15b §4 (security R10 L1 / R11 L4): ชื่อนัด/ชื่อกลุ่มเป็นข้อความอิสระ — ไม่ให้ LINE ทำเป็นลิงก์กดได้ (ลิงก์เดียวที่กดได้คือลิงก์นัดของเรา)
 *  ใช้หลัง sanitizeDisplayText (ตัดอักขระควบคุม/zero-width ของผู้ใช้ออกแล้ว) · แทนด้วยอักขระหน้าตาเหมือนเดิม ข้อความยังอ่านได้ทั้ง TH/EN
 *  1. "scheme://" (รวม ：／ แบบเต็มความกว้าง · ตัวอักษรทุกภาษา) → ":" + U+2215 ∕∕
 *  2. IPv4 (ตัวเลข 1–3 หลัก 4 ชุด คั่นด้วยจุดแบบใดก็ได้: 1.1.1.1 · 192.168.1.10/login) → ทุกจุดเป็น U+2024 ․
 *  3. จุดโดเมน: จุดแบบใดก็ได้ (. 。 ． ｡) ที่ "ก่อนเป็นตัวอักษร/ตัวเลข/เครื่องหมายกำกับ/ขีด และหลังเป็นตัวอักษร" (ทุกภาษา รวมตัวเต็มความกว้าง)
 *     → U+2024 ․ (ONE DOT LEADER) · ครอบ example.com · ทดสอบ.com · ตัวอย่าง.ไทย · examplé.com · ｅｘａｍｐｌｅ.com · example。com
 *  กติกาที่ตั้งใจไม่แตะ (ไม่ใช่โดเมน): ตัวเลขทศนิยม/เวลา/เวอร์ชัน (หลังจุดเป็นตัวเลข: 3.5 · 7.30 · v1.2) และจุดท้ายคำ (หลังจุดเป็นช่องว่าง/ท้ายข้อความ: "ชม.")
 *  ผลข้างเคียงที่ยอมรับ: คำย่อที่มีตัวอักษรตามหลังจุด (พ.ศ. · e.g.) ได้ ․ แทน . — หน้าตาเกือบเหมือนเดิม
 */
const DOTS = '.。．｡';
const SCHEME = /(\p{L}[\p{L}\p{N}+.-]*)[:：][/／]{2}/gu;
const IPV4 = new RegExp(`(?<![\\p{Nd}${DOTS}])\\p{Nd}{1,3}(?:[${DOTS}]\\p{Nd}{1,3}){3}(?![\\p{Nd}])`, 'gu');
const DOMAIN_DOT = new RegExp(`([\\p{L}\\p{N}\\p{M}-])[${DOTS}](?=\\p{L})`, 'gu');
const ONE_DOT = '․';

export function neutralizeLinks(text: string): string {
  return text
    .replace(SCHEME, '$1:∕∕')
    .replace(IPV4, (ip) => ip.replace(new RegExp(`[${DOTS}]`, 'gu'), ONE_DOT))
    .replace(DOMAIN_DOT, `$1${ONE_DOT}`);
}

const userText = (s: string): string => neutralizeLinks(sanitizeDisplayText(s));

const MESSAGE_KEY: Record<LineReminderKind, string> = {
  'appointment.reminder_1d': 'line.message.reminder_1d',
  'appointment.reminder_1h': 'line.message.reminder_1h',
};

export function renderLineReminder(
  locale: LineLocale,
  kind: LineReminderKind,
  input: { title: string; groupName: string; startAt: number; tz: string; appointmentId: string; appOrigin: string },
): string {
  return translator(locale)(MESSAGE_KEY[kind], {
    title: userText(input.title),
    groupName: userText(input.groupName),
    when: format(input.startAt, { locale, style: 'datetime-full', tz: input.tz }),
    url: `${input.appOrigin}/appointments/${input.appointmentId}?openExternalBrowser=1`,
  });
}

/** R11 §2: แจ้งยกเลิกนัด — ชื่อนัด วันเวลา ชื่อกลุ่ม ลิงก์ เท่านั้น (ไม่มีชื่อคนกดยกเลิก) */
export function renderLineCancelled(
  locale: LineLocale,
  input: { title: string; groupName: string; startAt: number; tz: string; appointmentId: string; appOrigin: string },
): string {
  return translator(locale)('line.message.cancelled', {
    title: userText(input.title),
    groupName: userText(input.groupName),
    when: format(input.startAt, { locale, style: 'datetime-full', tz: input.tz }),
    url: `${input.appOrigin}/appointments/${input.appointmentId}?openExternalBrowser=1`,
  });
}

export function renderLineLinkReply(locale: LineLocale, reply: LineLinkReply): string {
  return translator(locale)(`line.link.${reply}`);
}
