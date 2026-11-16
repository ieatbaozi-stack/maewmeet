// R15a (ฝั่ง UI) — ไอคอนกลุ่ม: ตัวเลือก (ค่าตั้งต้น/แมว→null/คีย์บอร์ด/ไม่เปลี่ยน) · แมป error · เส้นทาง SVG ครบทุก key · ชื่อ TH/EN ครบ
import { describe, expect, it } from 'vitest';
import type { FullResult } from '@/components/appointments/api';
import { GROUP_ICON_NODES } from '@/components/icons/group-icons';
import { iconBody, initialPick, isUnchanged, mapIconFailure, movePick } from '@/components/groups/icon-model';
import { DEFAULT_GROUP_ICON, GROUP_ICON_KEYS, displayGroupIcon } from '@/lib/shared/group-icons';
import en from '../../messages/en.json';
import th from '../../messages/th.json';

type Failure = Extract<FullResult<unknown>, { ok: false }>;
const api = (code: string, values: Record<string, string | number> = {}, status = 400): Failure =>
  ({ ok: false, kind: 'api', status, error: { code, key: `errors.${code}`, values }, fields: {} }) as unknown as Failure;
const network = { ok: false, kind: 'network' } as unknown as Failure;

describe('ข้อมูลไอคอน', () => {
  it('ทุก key ใน allowlist มีเส้นทาง SVG และชื่อ TH/EN (ไม่มี key เกิน/ขาด)', () => {
    expect(Object.keys(GROUP_ICON_NODES).sort()).toEqual([...GROUP_ICON_KEYS].sort());
    expect(GROUP_ICON_KEYS).toHaveLength(24);
    for (const k of GROUP_ICON_KEYS) {
      expect(GROUP_ICON_NODES[k].length).toBeGreaterThan(0);
      expect((th.groupIcon.names as Record<string, string>)[k]).toBeTruthy();
      expect((en.groupIcon.names as Record<string, string>)[k]).toBeTruthy();
    }
    expect(Object.keys(th.groupIcon.names).sort()).toEqual([...GROUP_ICON_KEYS].sort());
    expect(Object.keys(en.groupIcon.names).sort()).toEqual([...GROUP_ICON_KEYS].sort());
  });
  it('ค่าที่ไม่รู้จัก/null → แมว (ไม่ error)', () => {
    expect(displayGroupIcon(null)).toBe('cat');
    expect(displayGroupIcon('nope')).toBe('cat');
    expect(displayGroupIcon('badminton')).toBe('badminton');
    expect(DEFAULT_GROUP_ICON).toBe('cat');
  });
});

describe('ตัวเลือก (picker)', () => {
  it('เริ่มที่ไอคอนปัจจุบัน · ไม่ตั้ง/ไม่รู้จัก = แมว', () => {
    expect(initialPick('soccer')).toBe('soccer');
    expect(initialPick(null)).toBe('cat');
    expect(initialPick('???')).toBe('cat');
  });
  it('เลือก "แมว" ส่ง null (ไม่เก็บ "cat") · อื่นๆ ส่ง key', () => {
    expect(iconBody('cat')).toEqual({ icon: null });
    expect(iconBody('coffee')).toEqual({ icon: 'coffee' });
  });
  it('ยังไม่เปลี่ยนจากของเดิม: null เทียบกับ cat เท่ากัน', () => {
    expect(isUnchanged(null, 'cat')).toBe(true);
    expect(isUnchanged('food', 'food')).toBe(true);
    expect(isUnchanged('food', 'cat')).toBe(false);
    expect(isUnchanged(null, 'food')).toBe(false);
  });
  it('คีย์บอร์ด: ซ้าย/ขวา ±1 · บน/ล่าง ±คอลัมน์ · Home/End · ชนขอบอยู่ที่เดิม', () => {
    expect(movePick('food', 'ArrowRight', 4)).toBe('hotpot');
    expect(movePick('food', 'ArrowLeft', 4)).toBe('cat');
    expect(movePick('cat', 'ArrowLeft', 4)).toBe('cat');
    expect(movePick('cat', 'ArrowUp', 4)).toBe('cat');
    expect(movePick('cat', 'ArrowDown', 4)).toBe('coffee'); // ดัชนี 0 → 4
    expect(movePick('coffee', 'ArrowUp', 4)).toBe('cat');
    expect(movePick('cat', 'ArrowDown', 6)).toBe('badminton'); // 768: 6 คอลัมน์ → ดัชนี 6
    expect(movePick('food', 'End', 4)).toBe('star');
    expect(movePick('food', 'Home', 4)).toBe('cat');
    expect(movePick('star', 'ArrowRight', 4)).toBe('star');
    expect(movePick('star', 'ArrowDown', 4)).toBe('star');
  });
});

describe('แมป error ของการตั้งไอคอน (§1.4)', () => {
  it('403 = forbidden (ซ่อนปุ่มหลังรีเฟรช)', () => {
    expect(mapIconFailure(api('FORBIDDEN', {}, 403))).toEqual({ ref: { key: 'groupSettings.icon.error.forbidden', values: {} }, forbidden: true, gone: false });
  });
  it('404 = ข้อความกลาง NOT_FOUND + กลุ่มหาย · 429 = RATE_LIMITED กลาง', () => {
    expect(mapIconFailure(api('NOT_FOUND', {}, 404))).toMatchObject({ ref: { key: 'errors.NOT_FOUND' }, gone: true, forbidden: false });
    expect(mapIconFailure(api('RATE_LIMITED', { retryAfterSec: 5 }, 429))).toMatchObject({ ref: { key: 'errors.RATE_LIMITED' }, gone: false, forbidden: false });
  });
  it('เครือข่าย/VALIDATION/CONFLICT/อื่นๆ = generic (ไอคอนยังเป็นอันเดิม)', () => {
    for (const f of [network, api('VALIDATION'), api('CONFLICT', {}, 409), api('INTERNAL', {}, 500)]) {
      expect(mapIconFailure(f)).toEqual({ ref: { key: 'groupSettings.icon.error.generic', values: {} }, forbidden: false, gone: false });
    }
  });
});
