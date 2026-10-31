// ข้อความที่หน้าหลัก/แจ้งเตือน/กระดิ่งใช้ ต้องมีครบ th/en และ format ได้ด้วยค่าที่โค้ดส่งจริง (ไม่มี ICU tag)
import { IntlMessageFormat } from 'intl-messageformat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const msgs = { th: JSON.parse(readFileSync(path.join(ROOT, 'messages/th.json'), 'utf8')), en: JSON.parse(readFileSync(path.join(ROOT, 'messages/en.json'), 'utf8')) } as Record<'th' | 'en', Record<string, unknown>>;
const get = (l: 'th' | 'en', key: string): string | undefined =>
  key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), msgs[l]) as string | undefined;
const fmt = (l: 'th' | 'en', key: string, v: Record<string, string | number> = {}) => String(new IntlMessageFormat(get(l, key) as string, l).format(v));

const FILES = [
  'src/components/home/HomeView.tsx',
  'src/components/notifications/NotificationsView.tsx',
  'src/components/shell/Bell.tsx',
];
const staticKeys = (): string[] => {
  const keys = new Set<string>();
  for (const f of FILES) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) keys.add(m[1]!);
  }
  return [...keys];
};
// คีย์ที่ประกอบแบบไดนามิกในโค้ด
const DYNAMIC = [
  ...(['going', 'maybe', 'not_going'] as const).map((a) => `appointments.rsvp.answer.${a}`),
  ...(['going', 'maybe', 'not_going', 'none'] as const).map((a) => `appointments.rsvp.mine.${a}`),
  'errors.APPOINTMENT_CANCELLED',
  'errors.APPOINTMENT_PAST',
  'errors.NOT_FOUND',
  'errors.FORBIDDEN',
  ...['justNow', 'minutes', 'hours', 'yesterday', 'date'].map((k) => `notifications.time.${k}`),
];

describe('คีย์ข้อความของหน้าหลัก/แจ้งเตือน', () => {
  it('พบคีย์แบบตรงๆ ในโค้ดอย่างน้อย 30 คีย์ (กัน regex พัง)', () => {
    expect(staticKeys().length).toBeGreaterThan(30);
  });
  it.each(['th', 'en'] as const)('%s: ทุกคีย์ที่ใช้มีอยู่จริง', (l) => {
    const missing = [...staticKeys(), ...DYNAMIC].filter((k) => typeof get(l, k) !== 'string');
    expect(missing).toEqual([]);
  });
});

describe('ICU ของหน้าหลัก', () => {
  it('นับถอยหลัง: วันนี้/พรุ่งนี้/อีก N วัน ทั้งสองภาษา', () => {
    expect(fmt('th', 'home.countdown.before', { days: 0 })).toBe('วันนี้');
    expect(fmt('th', 'home.countdown.before', { days: 1 })).toBe('พรุ่งนี้');
    expect(fmt('th', 'home.countdown.before', { days: 4 })).toBe('อีก');
    expect(fmt('th', 'home.countdown.after', { days: 4 })).toBe('วัน');
    expect(fmt('th', 'home.countdown.aria', { days: 4 })).toBe('อีก 4 วัน');
    expect(fmt('en', 'home.countdown.before', { days: 0 })).toBe('Today');
    expect(fmt('en', 'home.countdown.aria', { days: 4 })).toBe('In 4 days');
    expect(fmt('en', 'home.countdown.after', { days: 4 })).toBe('days');
  });
  it('แถว aria: สถานะคำตอบของฉัน', () => {
    const v = { title: 'T', when: 'Sat 24 Oct 18:00', group: 'G' };
    expect(fmt('en', 'home.row.aria', { ...v, countdown: 'In 4 days', state: 'none' })).toContain('no reply yet');
    expect(fmt('en', 'home.row.aria', { ...v, countdown: 'In 4 days', state: 'going' })).toContain('going');
    expect(fmt('th', 'home.row.aria', { ...v, countdown: 'อีก 4 วัน', state: 'maybe' })).toContain('อาจไป');
  });
  it('แถว aria มีนับถอยหลัง (R6A F4) ทั้ง th/en', () => {
    const v = { title: 'T', when: 'W', group: 'G', state: 'none' };
    expect(fmt('th', 'home.row.aria', { ...v, countdown: fmt('th', 'home.countdown.aria', { days: 2 }) })).toBe('T, อีก 2 วัน, W, กลุ่ม G, ยังไม่ได้ตอบ');
    expect(fmt('en', 'home.row.aria', { ...v, countdown: fmt('en', 'home.countdown.aria', { days: 1 }) })).toBe('T, Tomorrow, W, G, no reply yet');
  });
  it('จำนวน "ไม่ไป" บนการ์ด (R6A B1) ทั้ง th/en', () => {
    expect(fmt('th', 'appointments.rsvp.summary.notGoing', { count: 2 })).toBe('ไม่ไป 2');
    expect(fmt('en', 'appointments.rsvp.summary.notGoing', { count: 2 })).toBe('2 can’t go');
  });
  it('moreNote และกระดิ่ง', () => {
    expect(fmt('en', 'home.moreNote', { count: 20 })).toContain('20');
    expect(fmt('th', 'notifications.bell.aria', { count: 0 })).toBe('การแจ้งเตือน');
    expect(fmt('th', 'notifications.bell.aria', { count: 3 })).toContain('3');
    expect(fmt('en', 'notifications.bell.aria', { count: 1 })).toBe('Notifications, 1 unread');
    expect(fmt('en', 'notifications.unreadCount', { count: 0 })).toBe('All caught up');
  });
});
