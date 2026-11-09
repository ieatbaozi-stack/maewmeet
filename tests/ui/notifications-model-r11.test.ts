// R11 §3: กระดิ่งแสดง 7 ชนิดใหม่ — params, href, ไอคอน, UNKNOWN เมื่อ params ผิด, และ select ของ ICU ตกกิ่งถูกจริง (render ผ่าน next-intl)
import { createTranslator } from 'next-intl';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONS } from '@/components/icons/lucide';
import { isolate, notificationView } from '@/components/notifications/model';
import { parseLocalDateTime } from '@/lib/calendar';

const ROOT = path.resolve(import.meta.dirname, '../..');
const messages = (l: 'th' | 'en') => JSON.parse(readFileSync(path.join(ROOT, `messages/${l}.json`), 'utf8'));
const render = (l: 'th' | 'en', key: string, values: Record<string, string>) =>
  createTranslator({ locale: l, messages: messages(l) })(key as never, values as never) as string;

const TZ = 'Asia/Bangkok';
const startAt = parseLocalDateTime('2026-10-24', '18:00', TZ);
const appt = { groupId: 'g1', groupName: 'ก๊วน', appointmentId: 'ap1', title: 'หมูกระทะ', startAt, tz: TZ };
const strip = (s: string) => s.replace(/[⁨⁩]/g, '');

describe('R11 notificationView', () => {
  it('appointment.cancelled', () => {
    const v = notificationView('appointment.cancelled', { ...appt, actorName: 'นุ่น' }, 'th');
    expect(v).toMatchObject({ known: true, messageKey: 'notifications.appointment.cancelled', icon: 'calendar-x', href: '/appointments/ap1' });
    expect(strip(render('th', v.messageKey, v.values))).toBe('นุ่น ยกเลิกนัด หมูกระทะ (เสาร์ 24 ต.ค. 18:00) ในกลุ่ม “ก๊วน”');
    expect(strip(render('en', v.messageKey, v.values))).toContain('cancelled');
  });

  it('appointment.updated: select ตาม changes ทั้ง 3 กิ่ง TH/EN (ไม่ตกไป other ผิดกิ่ง)', () => {
    const text = (l: 'th' | 'en', changes: string) => {
      const v = notificationView('appointment.updated', { ...appt, actorName: 'นุ่น', changes }, l);
      expect(v.known).toBe(true);
      expect(v.href).toBe('/appointments/ap1');
      expect(v.values.changes).toBe(changes); // ดิบ ไม่ isolate
      return strip(render(l, v.messageKey, v.values));
    };
    expect(text('th', 'time')).toContain('เปลี่ยนเวลานัด');
    expect(text('th', 'place')).toContain('เปลี่ยนสถานที่นัด');
    expect(text('th', 'both')).toContain('เปลี่ยนเวลาและสถานที่');
    expect(text('en', 'time')).toContain('changed the time:');
    expect(text('en', 'place')).toContain('changed the place for');
    expect(text('en', 'both')).toContain('changed the time and place');
  });

  it('appointment.rsvp_changed: select ตาม response ทั้ง 3 กิ่ง', () => {
    const text = (l: 'th' | 'en', response: string) => {
      const v = notificationView('appointment.rsvp_changed', { ...appt, responderName: 'ขวัญ', response }, l);
      expect(v.known).toBe(true);
      return strip(render(l, v.messageKey, v.values));
    };
    expect(text('th', 'going')).toContain('ขวัญ ไปนัด');
    expect(text('th', 'maybe')).toContain('อาจไปนัด');
    expect(text('th', 'not_going')).toContain('ไม่ไปนัด');
    expect(text('en', 'going')).toContain('is going to');
    expect(text('en', 'maybe')).toContain('might go to');
    expect(text('en', 'not_going')).toContain('make');
  });

  it('group.member.role_changed: select ตาม role ทั้ง 3 กิ่ง · href หน้ากลุ่ม', () => {
    const text = (l: 'th' | 'en', role: string) => {
      const v = notificationView('group.member.role_changed', { groupId: 'g1', groupName: 'ก๊วน', role }, l);
      expect(v).toMatchObject({ known: true, href: '/groups/g1' });
      return strip(render(l, v.messageKey, v.values));
    };
    expect(text('th', 'admin')).toContain('ผู้ดูแลกลุ่ม');
    expect(text('th', 'moderator')).toContain('ผู้ช่วยดูแลกลุ่ม');
    expect(text('th', 'member')).toContain('สมาชิกของกลุ่ม');
    expect(text('en', 'admin')).toContain('an admin of');
    expect(text('en', 'moderator')).toContain('a moderator in');
    expect(text('en', 'member')).toContain('regular member');
  });

  it('joined / left / removed: ข้อความ href ถูก', () => {
    for (const l of ['th', 'en'] as const) {
      const j = notificationView('group.member.joined', { groupId: 'g1', groupName: 'ก๊วน', memberName: 'มาย' }, l);
      const lf = notificationView('group.member.left', { groupId: 'g1', groupName: 'ก๊วน', memberName: 'มาย' }, l);
      const r = notificationView('group.member.removed', { groupId: 'g1', groupName: 'ก๊วน' }, l);
      expect([j.href, lf.href, r.href]).toEqual(['/groups/g1', '/groups/g1', '/groups']);
      expect(strip(render(l, j.messageKey, j.values))).toContain('มาย');
      expect(strip(render(l, lf.messageKey, lf.values))).toContain('มาย');
      expect(strip(render(l, r.messageKey, r.values))).toContain('ก๊วน');
      expect(r.values).toEqual({ groupName: isolate('ก๊วน') });
    }
  });

  it('ค่าผู้ใช้ถูก isolate · ชื่อว่าง = บัญชีที่ถูกลบ', () => {
    const v = notificationView('group.member.left', { groupId: 'g1', groupName: 'ก๊วน', memberName: '' }, 'th', 'บัญชีที่ถูกลบ');
    expect(v.values.memberName).toBe(isolate('บัญชีที่ถูกลบ'));
    expect(notificationView('group.member.left', { groupId: 'g1', groupName: 'ก๊วน', memberName: '' }, 'th').known).toBe(false);
  });

  it('params ไม่ครบ/enum ผิด → UNKNOWN', () => {
    const bad = [
      notificationView('appointment.updated', { ...appt, actorName: 'a', changes: 'name' }, 'th'),
      notificationView('appointment.updated', { ...appt, actorName: 'a' }, 'th'),
      notificationView('appointment.rsvp_changed', { ...appt, responderName: 'a', response: 'yes' }, 'th'),
      notificationView('appointment.rsvp_changed', { ...appt, response: 'going' }, 'th'),
      notificationView('appointment.cancelled', { ...appt }, 'th'),
      notificationView('appointment.cancelled', { ...appt, actorName: 'a', appointmentId: '../x' }, 'th'),
      notificationView('group.member.role_changed', { groupId: 'g1', groupName: 'ก๊วน', role: 'owner' }, 'th'),
      notificationView('group.member.role_changed', { groupName: 'ก๊วน', role: 'admin' }, 'th'),
      notificationView('group.member.joined', { groupId: 'g1', groupName: 'ก๊วน' }, 'th'),
      notificationView('group.member.removed', {}, 'th'),
    ];
    for (const v of bad) expect(v).toMatchObject({ known: false, messageKey: 'notifications.unknown', href: null });
  });

  it('ไอคอนทุกตัวที่ใช้มีใน ICONS', () => {
    const kinds: [string, Record<string, unknown>][] = [
      ['appointment.cancelled', { ...appt, actorName: 'a' }],
      ['appointment.updated', { ...appt, actorName: 'a', changes: 'time' }],
      ['appointment.rsvp_changed', { ...appt, responderName: 'a', response: 'going' }],
      ['appointment.rsvp_changed', { ...appt, responderName: 'a', response: 'maybe' }],
      ['group.member.joined', { groupId: 'g1', groupName: 'g', memberName: 'a' }],
      ['group.member.left', { groupId: 'g1', groupName: 'g', memberName: 'a' }],
      ['group.member.removed', { groupName: 'g' }],
      ['group.member.role_changed', { groupId: 'g1', groupName: 'g', role: 'admin' }],
    ];
    for (const [k, p] of kinds) expect(Object.keys(ICONS)).toContain(notificationView(k, p, 'en').icon);
  });
});
