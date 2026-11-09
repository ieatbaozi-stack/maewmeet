// view-model แจ้งเตือน (R4B ADR 0007): ป้ายกระดิ่ง · อัปเดตจำนวนยังไม่อ่าน · แปลงแถว → ข้อความ/ปลายทาง · ป้ายเวลา · ทุก kind มีข้อความ th/en
import { IntlMessageFormat } from 'intl-messageformat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  badgeText,
  bellCount,
  isolate,
  markAllRead,
  markIdsRead,
  mergePage,
  notificationView,
  shouldApplyRefresh,
  timeLabel,
  unreadAfterMarkOne,
  unreadOf,
  whenLabel,
  type NotificationItem,
} from '@/components/notifications/model';
import { NOTIFICATION_KINDS } from '@/lib/data/notifications/notify';
import { parseLocalDateTime } from '@/lib/calendar';

const ROOT = path.resolve(import.meta.dirname, '../..');
const messages = (l: 'th' | 'en') => JSON.parse(readFileSync(path.join(ROOT, `messages/${l}.json`), 'utf8')) as Record<string, unknown>;
const lookup = (m: Record<string, unknown>, key: string): string | undefined =>
  key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), m) as string | undefined;
const fmt = (l: 'th' | 'en', key: string, values: Record<string, string | number>) => {
  const msg = lookup(messages(l), key);
  if (msg === undefined) throw new Error(`missing ${l}:${key}`);
  return String(new IntlMessageFormat(msg, l).format(values));
};

const TZ = 'Asia/Bangkok';
const at = (d: string, t: string) => parseLocalDateTime(d, t, TZ);
const item = (id: string, readAt: number | null = null, createdAt = 1): NotificationItem => ({ id, kind: 'pin_reset.cancelled_by_login', params: {}, createdAt, readAt });

describe('badgeText / bellCount', () => {
  it('0/ไม่ทราบ → ไม่แสดง · 1–9 ตัวเลข · >9 = "9+"', () => {
    expect(badgeText(null)).toBeNull();
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-3)).toBeNull();
    expect(badgeText(Number.NaN)).toBeNull();
    expect(badgeText(1)).toBe('1');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(10)).toBe('9+');
    expect(badgeText(250)).toBe('9+');
  });
  it('bellCount ไม่ส่งค่าเพี้ยนเข้า ICU', () => {
    expect(bellCount(null)).toBe(0);
    expect(bellCount(-1)).toBe(0);
    expect(bellCount(3.7)).toBe(3);
  });
});

describe('อัปเดตจำนวนยังไม่อ่าน', () => {
  it('อ่านหนึ่งรายการ: ลด 1 เฉพาะที่ยังไม่อ่าน · ไม่ต่ำกว่า 0', () => {
    expect(unreadAfterMarkOne(3, true)).toBe(2);
    expect(unreadAfterMarkOne(3, false)).toBe(3);
    expect(unreadAfterMarkOne(0, true)).toBe(0);
  });
  it('markIdsRead แตะเฉพาะ id ที่ระบุและที่ยังไม่อ่าน (readAt เดิมไม่ถูกเขียนทับ)', () => {
    const list = [item('a'), item('b', 5), item('c')];
    const r = markIdsRead(list, ['a', 'b'], 99);
    expect(r.map((i) => i.readAt)).toEqual([99, 5, null]);
    expect(unreadOf(r)).toBe(1);
    expect(list[0]!.readAt).toBeNull(); // ไม่แก้ของเดิม
  });
  it('markAllRead', () => {
    const r = markAllRead([item('a'), item('b', 5)], 99);
    expect(r.map((i) => i.readAt)).toEqual([99, 5]);
    expect(unreadOf(r)).toBe(0);
  });
  it('shouldApplyRefresh: ทิ้งผลที่ตามหลังคำขอใหม่กว่า หรือก่อนการแก้ในเครื่อง', () => {
    expect(shouldApplyRefresh({ seq: 2, gen: 1 }, { seq: 2, gen: 1 })).toBe(true);
    expect(shouldApplyRefresh({ seq: 1, gen: 1 }, { seq: 2, gen: 1 })).toBe(false);
    expect(shouldApplyRefresh({ seq: 2, gen: 1 }, { seq: 2, gen: 2 })).toBe(false);
  });
  it('mergePage ต่อท้าย ตัดซ้ำ คงลำดับ', () => {
    const r = mergePage([item('a'), item('b')], [item('b'), item('c')]);
    expect(r.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('notificationView — ข้อความ ปลายทาง ไอคอน', () => {
  const gid = '0198a000-0000-7000-8000-000000000001';
  it('appointment.created → /appointments/<id> + when ใน tz นัด', () => {
    const v = notificationView('appointment.created', { groupId: gid, groupName: 'แก๊ง', appointmentId: 'ap-1', title: 'หมูกระทะ', startAt: at('2026-10-24', '18:00'), tz: TZ }, 'en');
    expect(v).toMatchObject({ known: true, messageKey: 'notifications.appointment.created', href: '/appointments/ap-1', icon: 'calendar-plus', tone: 'appt' });
    expect(v.values.when).toBe('Sat 24 Oct 18:00');
    expect(v.values.groupName).toBe('⁨แก๊ง⁩');
  });
  it('R10: reminder_1d/1h/rsvp_nudge → /appointments/<id> + when ใน tz นัด (ไม่ใช้ "พรุ่งนี้")', () => {
    const p = { groupId: gid, groupName: 'แก๊ง', appointmentId: 'ap-9', title: 'หมูกระทะ', startAt: at('2026-10-24', '18:00'), tz: TZ };
    for (const kind of ['appointment.reminder_1d', 'appointment.reminder_1h', 'appointment.rsvp_nudge']) {
      const v = notificationView(kind, p, 'en');
      expect(v).toMatchObject({ known: true, messageKey: `notifications.${kind}`, href: '/appointments/ap-9', tone: 'appt' });
      expect(v.values.when).toBe('Sat 24 Oct 18:00');
    }
    expect(notificationView('appointment.reminder_1d', { ...p, title: '' }, 'th').known).toBe(false);
    expect(notificationView('appointment.rsvp_nudge', { ...p, appointmentId: '../x' }, 'th').known).toBe(false);
  });
  it('invite.received → /groups · accepted/declined → /groups/<gid> · pin_reset.* → /me', () => {
    expect(notificationView('group.invite.received', { groupId: gid, groupName: 'G', inviterName: 'P', inviteId: 'i' }, 'th').href).toBe('/groups');
    expect(notificationView('group.invite.accepted', { groupId: gid, groupName: 'G', inviteeName: 'N', inviteId: 'i' }, 'th').href).toBe(`/groups/${gid}`);
    expect(notificationView('group.invite.declined', { groupId: gid, groupName: 'G', inviteeName: 'N', inviteId: 'i' }, 'th')).toMatchObject({ href: `/groups/${gid}`, icon: 'user-minus' });
    expect(notificationView('pin_reset.approved', { expiresAt: at('2026-10-21', '17:42') }, 'th').href).toBe('/me');
    expect(notificationView('pin_reset.cancelled_by_login', {}, 'th').href).toBe('/me');
  });
  it('วันหมดอายุ PIN จัดรูปด้วย lib (พ.ศ. ไม่โชว์ปีใน when) ตาม locale', () => {
    expect(notificationView('pin_reset.approved', { expiresAt: at('2026-10-21', '17:42') }, 'en').values.expiresAt).toBe('Wed 21 Oct 17:42');
  });
  it('ชนิดไม่รู้จัก/params ไม่ครบ/ผิดชนิด → notifications.unknown ไม่มีลิงก์ ไม่โชว์ค่าดิบ', () => {
    for (const [kind, params] of [
      ['appointment.cancelled', { groupName: 'G', title: 'T', appointmentId: 'a', startAt: 1, tz: TZ }],
      ['totally.new', {}],
      ['appointment.created', { groupName: 'G' }],
      ['appointment.created', { groupName: 'G', title: 'T', appointmentId: 'a', startAt: 'x', tz: TZ }],
      ['group.invite.accepted', { groupName: 'G', inviteeName: 'N' }],
      ['pin_reset.approved', { expiresAt: Number.NaN }],
    ] as const) {
      const v = notificationView(kind, params as Record<string, unknown>, 'th');
      expect(v).toMatchObject({ known: false, messageKey: 'notifications.unknown', href: null, values: {} });
    }
  });
  it('id ในเส้นทางต้องเป็นอักขระปลอดภัย (กัน path injection)', () => {
    const bad = notificationView('appointment.created', { groupName: 'G', title: 'T', appointmentId: '../../admin', startAt: 1, tz: TZ }, 'th');
    expect(bad.known).toBe(false);
    expect(notificationView('group.invite.accepted', { groupId: 'a/b', groupName: 'G', inviteeName: 'N' }, 'th').known).toBe(false);
  });
  it('tz ในพารามิเตอร์พัง → ใช้ Asia/Bangkok ไม่ throw', () => {
    expect(() => notificationView('appointment.created', { groupName: 'G', title: 'T', appointmentId: 'a', startAt: 1, tz: 'Nope/Zone' }, 'en')).not.toThrow();
  });
  it('isolate ตัด embedding/isolate ที่แฝงมาในชื่อ แล้วห่อใหม่', () => {
    expect(isolate('a\u2069b\u202ec\u2066')).toBe('\u2068abc\u2069');
  });
  it('ทุก NotificationKind ใน union แปลงได้ (known) และมีข้อความ th/en ที่ format ได้ด้วยค่าจริงโดยไม่เหลือ {…}', () => {
    const samples: Record<string, Record<string, unknown>> = {
      'group.invite.received': { groupId: gid, groupName: 'ก๊วน', inviterName: 'ปาล์ม', inviteId: 'i1' },
      'group.invite.accepted': { groupId: gid, groupName: 'ก๊วน', inviteeName: 'นุ่น', inviteId: 'i1' },
      'group.invite.declined': { groupId: gid, groupName: 'ก๊วน', inviteeName: 'ขวัญ', inviteId: 'i1' },
      'appointment.created': { groupId: gid, groupName: 'ก๊วน', appointmentId: 'ap1', title: 'หมูกระทะ', startAt: at('2026-10-24', '18:00'), tz: TZ },
      'appointment.reminder_1d': { groupId: gid, groupName: 'ก๊วน', appointmentId: 'ap1', title: 'หมูกระทะ', startAt: at('2026-10-24', '18:00'), tz: TZ },
      'appointment.reminder_1h': { groupId: gid, groupName: 'ก๊วน', appointmentId: 'ap1', title: 'หมูกระทะ', startAt: at('2026-10-24', '18:00'), tz: TZ },
      'appointment.rsvp_nudge': { groupId: gid, groupName: 'ก๊วน', appointmentId: 'ap1', title: 'หมูกระทะ', startAt: at('2026-10-24', '18:00'), tz: TZ },
      // R11 (params ตามสัญญา §1)
      'appointment.cancelled': { groupId: gid, groupName: 'ก๊วน', appointmentId: 'ap1', title: 'หมูกระทะ', startAt: at('2026-10-24', '18:00'), tz: TZ, actorName: 'ปาล์ม' },
      'appointment.updated': { groupId: gid, groupName: 'ก๊วน', appointmentId: 'ap1', title: 'หมูกระทะ', startAt: at('2026-10-24', '18:00'), tz: TZ, actorName: 'ปาล์ม', changes: 'both' },
      'appointment.rsvp_changed': { groupId: gid, groupName: 'ก๊วน', appointmentId: 'ap1', title: 'หมูกระทะ', startAt: at('2026-10-24', '18:00'), tz: TZ, responderName: 'นุ่น', response: 'going' },
      'group.member.joined': { groupId: gid, groupName: 'ก๊วน', memberName: 'นุ่น' },
      'group.member.left': { groupId: gid, groupName: 'ก๊วน', memberName: 'นุ่น' },
      'group.member.removed': { groupId: gid, groupName: 'ก๊วน' },
      'group.member.role_changed': { groupId: gid, groupName: 'ก๊วน', role: 'moderator' },
      'pin_reset.approved': { expiresAt: at('2026-10-21', '17:42') },
      'pin_reset.cancelled_by_login': {},
    };
    for (const kind of NOTIFICATION_KINDS) {
      for (const l of ['th', 'en'] as const) {
        const v = notificationView(kind, samples[kind]!, l);
        expect(v.known, `${kind} ${l}`).toBe(true);
        const text = fmt(l, v.messageKey, v.values);
        expect(text.length).toBeGreaterThan(5);
        expect(text).not.toMatch(/[{}]/);
      }
    }
  });
  it('notifications.unknown มีทั้ง th/en', () => {
    expect(fmt('th', 'notifications.unknown', {})).toBeTruthy();
    expect(fmt('en', 'notifications.unknown', {})).toBeTruthy();
  });
});

describe('whenLabel', () => {
  it('ไทย/อังกฤษ 24 ชม. ไม่มี AM/PM', () => {
    expect(whenLabel(at('2026-10-24', '18:00'), TZ, 'en')).toBe('Sat 24 Oct 18:00');
    expect(whenLabel(at('2026-10-24', '18:00'), TZ, 'th')).toBe('เสาร์ 24 ต.ค. 18:00');
  });
  it('นัดต่าง tz แสดงเวลาท้องถิ่นของนัด', () => {
    expect(whenLabel(at('2026-10-24', '18:00'), 'Asia/Tokyo', 'en')).toBe('Sat 24 Oct 20:00');
  });
});

describe('timeLabel — ป้ายเวลา', () => {
  const now = at('2026-10-20', '18:00');
  const ago = (ms: number) => now - ms;
  it('เมื่อสักครู่ < 1 นาที', () => {
    expect(timeLabel(ago(30_000), now, 'th').key).toBe('notifications.time.justNow');
    expect(timeLabel(now + 5_000, now, 'th').key).toBe('notifications.time.justNow'); // นาฬิกาเอียงไปข้างหน้า
  });
  it('N นาทีที่แล้ว', () => {
    expect(timeLabel(ago(12 * 60_000), now, 'th')).toEqual({ key: 'notifications.time.minutes', values: { count: 12 } });
    expect(timeLabel(ago(59 * 60_000 + 59_000), now, 'th').values).toEqual({ count: 59 });
  });
  it('N ชม.ที่แล้ว เฉพาะวันเดียวกัน', () => {
    expect(timeLabel(ago(3 * 3_600_000), now, 'th')).toEqual({ key: 'notifications.time.hours', values: { count: 3 } });
  });
  it('ข้ามเที่ยงคืน (แม้ไม่ถึง 24 ชม.) = เมื่อวาน HH:MM ตามวันท้องถิ่น', () => {
    const justAfterMidnight = at('2026-10-20', '00:30');
    const late = at('2026-10-19', '21:00');
    expect(timeLabel(late, justAfterMidnight, 'en')).toEqual({ key: 'notifications.time.yesterday', values: { time: '21:00' } });
    expect(timeLabel(at('2026-10-19', '18:20'), now, 'en')).toEqual({ key: 'notifications.time.yesterday', values: { time: '18:20' } });
  });
  it('เก่ากว่าเมื่อวาน = วัน วันที่ · เวลา', () => {
    const r = timeLabel(at('2026-10-18', '14:05'), now, 'en');
    expect(r).toEqual({ key: 'notifications.time.date', values: { date: 'Sun 18 Oct', time: '14:05' } });
    expect(fmt('en', r.key, r.values)).toBe('Sun 18 Oct · 14:05');
  });
});
