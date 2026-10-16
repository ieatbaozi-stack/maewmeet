// ข้อความจาก messages/*.json — เทสต์หา element ด้วยข้อความจริงของแต่ละภาษา (ไม่ hard-code คำ)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';

export type Locale = 'th' | 'en';
export const LOCALES: readonly Locale[] = ['th', 'en'];

const cache = new Map<Locale, unknown>();
function load(locale: Locale): unknown {
  if (!cache.has(locale)) {
    cache.set(locale, JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../messages', `${locale}.json`), 'utf8')));
  }
  return cache.get(locale);
}

/** msg('en', 'login.pinProgress', { count: 6 }) → "6 of 6 digits entered" */
export function msg(locale: Locale, key: string, values?: Record<string, string | number>): string {
  let node: unknown = load(locale);
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node !== 'string') throw new Error(`ไม่พบข้อความ ${locale}:${key}`);
  return String(new IntlMessageFormat(node, locale).format(values));
}
