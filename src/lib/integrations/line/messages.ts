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
    title: sanitizeDisplayText(input.title),
    groupName: sanitizeDisplayText(input.groupName),
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
    title: sanitizeDisplayText(input.title),
    groupName: sanitizeDisplayText(input.groupName),
    when: format(input.startAt, { locale, style: 'datetime-full', tz: input.tz }),
    url: `${input.appOrigin}/appointments/${input.appointmentId}?openExternalBrowser=1`,
  });
}

export function renderLineLinkReply(locale: LineLocale, reply: LineLinkReply): string {
  return translator(locale)(`line.link.${reply}`);
}
