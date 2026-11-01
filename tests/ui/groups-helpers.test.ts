// ตัวช่วยล้วนของหน้ากลุ่ม R2 — สี/ตัวอักษรย่อ/วันที่/หน้าต่างวันว่าง/สิทธิ์ที่ใช้ซ่อนปุ่ม
import { describe, expect, it } from 'vitest';
import {
  GROUP_NAME_MAX,
  NO_ACTIONS,
  WINDOW_END_OPTIONS,
  WINDOW_MIN_OPTIONS,
  WINDOW_START_OPTIONS,
  canEditSettings,
  deleteTypeMatches,
  durationRef,
  formatClock,
  formatShortDate,
  groupNameLength,
  isWindowValid,
  memberActions,
  memberInitial,
  memberSlot,
  viewerRole,
} from '@/components/groups/helpers';
import { GROUP_LIMITS } from '@/lib/shared/limits';

describe('memberSlot: index 0–9 → data-color/data-shape 1–10', () => {
  it('บวก 1 ตามที่ Lead ตัดสิน', () => {
    expect(memberSlot(0)).toBe(1);
    expect(memberSlot(9)).toBe(10);
  });
  it('ค่านอกช่วง/ไม่ใช่ตัวเลข วนกลับเข้า 1–10 (ไม่ทำให้ CSS หลุดช่อง)', () => {
    expect(memberSlot(10)).toBe(1);
    expect(memberSlot(-1)).toBe(10);
    expect(memberSlot(Number.NaN)).toBe(1);
    expect(memberSlot(3.9)).toBe(4);
  });
});

describe('memberInitial', () => {
  it('ไทย: พยัญชนะต้น', () => {
    expect(memberInitial('ต้นข้าว')).toBe('ต');
    expect(memberInitial('ปาล์ม')).toBe('ป');
  });
  it('ไทย: ข้ามสระนำ เ แ โ ใ ไ', () => {
    expect(memberInitial('เบิร์ด')).toBe('บ');
    expect(memberInitial('แมว')).toBe('ม');
    expect(memberInitial('โอ๊ต')).toBe('อ');
    expect(memberInitial('ไผ่')).toBe('ผ');
    expect(memberInitial('ใบเฟิร์น')).toBe('บ');
  });
  it('ละติน → พิมพ์ใหญ่ · ตัวเลข/อิโมจิใช้ตัวแรกตามจริง', () => {
    expect(memberInitial('beam_88')).toBe('B');
    expect(memberInitial('  mind')).toBe('M');
    expect(memberInitial('88beam')).toBe('8');
    expect(memberInitial('🐱 แมว')).toBe('🐱');
  });
  it('ว่าง → ?', () => {
    expect(memberInitial('')).toBe('?');
    expect(memberInitial('   ')).toBe('?');
  });
});

describe('formatShortDate (UX: th "25 ต.ค. 2569" · en "25 Oct 2026")', () => {
  const at = Date.UTC(2026, 9, 25, 5, 0, 0); // 25 ต.ค. 2026 12:00 เวลาไทย
  it('th เป็นปี พ.ศ. ชื่อเดือนย่อ', () => {
    expect(formatShortDate(at, 'th')).toBe('25 ต.ค. 2569');
  });
  it('en', () => {
    expect(formatShortDate(at, 'en')).toBe('25 Oct 2026');
  });
  it('ใช้เขตเวลา Asia/Bangkok: 18:00 UTC ของวันที่ 24 = วันที่ 25 ตี 1 ที่ไทย', () => {
    const lateUtc = Date.UTC(2026, 9, 24, 18, 0, 0);
    expect(formatShortDate(lateUtc, 'en')).toBe('25 Oct 2026');
    expect(formatShortDate(lateUtc, 'en', 'UTC')).toBe('24 Oct 2026');
  });
});

describe('หน้าต่างวันว่าง D9', () => {
  it('formatClock: นาทีจากเที่ยงคืน → HH:MM', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(480)).toBe('08:00');
    expect(formatClock(1320)).toBe('22:00');
    expect(formatClock(1410)).toBe('23:30');
    expect(formatClock(1440)).toBe('24:00');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatClock(99999)).toBe('24:00');
  });
  it('durationRef เลือกคีย์ตาม UX (< 60 นาที · ลงตัว ชม. · ชม.+นาที)', () => {
    expect(durationRef(30)).toEqual({ key: 'durationMin', values: { minutes: 30 } });
    expect(durationRef(120)).toEqual({ key: 'durationHour', values: { hours: 2 } });
    expect(durationRef(150)).toEqual({ key: 'durationHourMin', values: { hours: 2, minutes: 30 } });
    expect(durationRef(60)).toEqual({ key: 'durationHour', values: { hours: 1 } });
  });
  it('ตัวเลือกเลื่อนทีละ 30 นาทีและอยู่ในช่วงของ DB', () => {
    expect(WINDOW_START_OPTIONS[0]).toBe(0);
    expect(WINDOW_START_OPTIONS.at(-1)).toBe(1410);
    expect(WINDOW_END_OPTIONS[0]).toBe(30);
    expect(WINDOW_END_OPTIONS.at(-1)).toBe(1440);
    expect(WINDOW_MIN_OPTIONS[0]).toBe(30);
    for (const n of [...WINDOW_START_OPTIONS, ...WINDOW_END_OPTIONS, ...WINDOW_MIN_OPTIONS]) expect(n % 30).toBe(0);
  });
  it('isWindowValid ตรงกับ assertFreeWindow', () => {
    expect(isWindowValid(480, 1320, 120)).toBe(true);
    expect(isWindowValid(0, 1440, 30)).toBe(true);
    expect(isWindowValid(480, 480, 30)).toBe(false); // เริ่ม = จบ
    expect(isWindowValid(600, 480, 30)).toBe(false); // เริ่มหลังจบ
    expect(isWindowValid(480, 600, 180)).toBe(false); // ขั้นต่ำยาวกว่าช่วง
    expect(isWindowValid(480, 600, 120)).toBe(true); // เท่ากับช่วงพอดี
    expect(isWindowValid(485, 600, 30)).toBe(false); // ไม่ลงก้าว 30
    expect(isWindowValid(480, 1500, 30)).toBe(false); // เกิน 24:00
    expect(isWindowValid(480, 600, 15)).toBe(false); // ขั้นต่ำต่ำกว่า 30
  });
});

describe('ชื่อกลุ่ม', () => {
  it('ค่าสูงสุดอ้างจากค่าคงที่ของระบบ (ไม่เขียน 40 ซ้ำ)', () => {
    expect(GROUP_NAME_MAX).toBe(GROUP_LIMITS.nameMax);
  });
  it('นับเป็น code point หลัง NFC + trim', () => {
    expect(groupNameLength('  ก๊วนแบด  ')).toBe(7);
    expect(groupNameLength('🐱🐱')).toBe(2);
    expect(groupNameLength('   ')).toBe(0);
  });
  it('deleteTypeMatches: trim แล้วเทียบตรงตัว (ตัวพิมพ์เล็ก/ใหญ่ต่างกัน = ไม่ตรง)', () => {
    expect(deleteTypeMatches('ก๊วนแบด', 'ก๊วนแบด')).toBe(true);
    expect(deleteTypeMatches('  ก๊วนแบด ', 'ก๊วนแบด')).toBe(true);
    expect(deleteTypeMatches('ก๊วน', 'ก๊วนแบด')).toBe(false);
    expect(deleteTypeMatches('Team', 'team')).toBe(false);
    expect(deleteTypeMatches('', '')).toBe(false);
  });
});

describe('สิทธิ์สำหรับซ่อนปุ่ม (เซิร์ฟเวอร์ตัดสินจริง)', () => {
  it('viewerRole: super admin นอกกลุ่ม (null) ใช้ปุ่มของ admin', () => {
    expect(viewerRole(null)).toBe('admin');
    expect(viewerRole('member')).toBe('member');
  });
  it('admin: ทำกับ member/moderator ได้ทุกอย่าง ตั้ง role สลับกัน', () => {
    expect(memberActions('admin', 'member', false)).toEqual({ setRole: 'moderator', transfer: true, remove: true });
    expect(memberActions('admin', 'moderator', false)).toEqual({ setRole: 'member', transfer: true, remove: true });
  });
  it('ไม่มีปุ่มกับตัวเองหรือกับ admin (D7/D8)', () => {
    expect(memberActions('admin', 'member', true)).toBe(NO_ACTIONS);
    expect(memberActions('admin', 'admin', false)).toBe(NO_ACTIONS);
    expect(memberActions('moderator', 'admin', false)).toBe(NO_ACTIONS);
  });
  it('moderator: ลบได้เฉพาะ member · ตั้ง role/โอน ไม่ได้', () => {
    expect(memberActions('moderator', 'member', false)).toEqual({ setRole: null, transfer: false, remove: true });
    expect(memberActions('moderator', 'moderator', false)).toBe(NO_ACTIONS);
  });
  it('member: ไม่มีปุ่มจัดการ', () => {
    expect(memberActions('member', 'member', false)).toBe(NO_ACTIONS);
    expect(memberActions('member', 'moderator', false)).toBe(NO_ACTIONS);
  });
  it('canEditSettings: admin/moderator เท่านั้น', () => {
    expect(canEditSettings('admin')).toBe(true);
    expect(canEditSettings('moderator')).toBe(true);
    expect(canEditSettings('member')).toBe(false);
  });
});
