import { describe, expect, it } from 'vitest';
import { weekdayShort } from '@/components/shell/weekday';
import { weekdayDate } from '@/components/availability/model';

// 2026-10-24 = เสาร์ · 2026-10-22 = พฤหัสบดี
describe('weekdayShort — ผลเหมือนกันทุกเอนจิน (กัน hydration #418)', () => {
  it('th: ชื่อเต็มตัดคำนำหน้า "วัน" (ไม่ใช้ weekday:short ที่ ICU ต่างกัน)', () => {
    expect(weekdayShort('2026-10-24', { locale: 'th' })).toBe('เสาร์');
    expect(weekdayShort('2026-10-22', { locale: 'th' })).toBe('พฤหัสบดี');
    expect(weekdayShort('2026-10-25', { locale: 'th' })).toBe('อาทิตย์');
  });
  it('en: short', () => {
    expect(weekdayShort('2026-10-24', { locale: 'en' })).toBe('Sat');
    expect(weekdayShort('2026-10-22', { locale: 'en' })).toBe('Thu');
  });
  it('รับ epoch ms + tz: ข้ามเที่ยงคืนตามเขตเวลา', () => {
    const ms = Date.UTC(2026, 9, 24, 18, 0); // 01:00 วันอาทิตย์ ที่กรุงเทพ
    expect(weekdayShort(ms, { locale: 'th', tz: 'Asia/Bangkok' })).toBe('อาทิตย์');
    expect(weekdayShort(ms, { locale: 'en', tz: 'UTC' })).toBe('Sat');
  });
  it('ไม่มีจุดย่อ/ไม่มีคำนำหน้า "วัน" ในผลไทยทุกวัน', () => {
    for (let d = 19; d <= 25; d++) {
      const s = weekdayShort(`2026-10-${d}`, { locale: 'th' });
      expect(s).not.toMatch(/^วัน/u);
      expect(s).not.toContain('.');
    }
  });
  it('weekdayDate short ใช้ helper เดียวกัน', () => {
    expect(weekdayDate('2026-10-24', 'th', 'short')).toMatch(/^เสาร์ 24 ต\.ค\.$/);
  });
});
