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
 *  - "scheme://" → ":" + U+2215 ∕∕ (ทับคล้ายกันแต่ไม่ใช่ "/" → ไม่เป็น URL)
 *  - จุดระหว่างตัวอักษร/ตัวเลข ASCII กับตัวอักษร ASCII (example.com, www.x.co, a@b.io) → U+2024 ․ (ONE DOT LEADER หน้าตาเหมือนจุด)
 *  ข้อความไทยและตัวเลขทศนิยม (3.5 · v1.2) ไม่ถูกแตะ · ใช้หลัง sanitizeDisplayText (ซึ่งตัดอักขระควบคุม/zero-width ของผู้ใช้ออกแล้ว)
 */
export function neutralizeLinks(text: string): string {
  return text.replace(/([A-Za-z][A-Za-z0-9+.-]*):\/\//g, '$1:∕∕').replace(/([A-Za-z0-9-])\.(?=[A-Za-z])/g, '$1․');
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
