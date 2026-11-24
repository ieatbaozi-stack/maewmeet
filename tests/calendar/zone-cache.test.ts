// security M1 / ICS_IMPORT_CONTRACT §7 S1 — cache ของ isValidTimeZone ต้องไม่โตจากสตริงผิด — เจ้าของ: platform
import { describe, expect, it } from 'vitest';
import { isValidTimeZone, validTimeZoneCacheSize } from '@/lib/calendar/zone';

describe('S1 — isValidTimeZone cache เฉพาะผลที่ถูก', () => {
  it('สตริงผิดไม่ซ้ำ 4,000 ค่า (รวมยาว 470 ตัว) → ขนาด cache ไม่โต และทุกค่ายังคืน false', () => {
    // อุ่น cache ด้วยค่าที่ถูกก่อน แล้ววัดฐาน
    expect(isValidTimeZone('Asia/Bangkok')).toBe(true);
    const before = validTimeZoneCacheSize();
    const filler = 'q'.repeat(470);
    for (let i = 0; i < 2000; i++) {
      expect(isValidTimeZone(`Zz/req_${i}_${filler}`)).toBe(false);
      expect(isValidTimeZone(`Mars/Olympus_${i}`)).toBe(false);
    }
    expect(validTimeZoneCacheSize()).toBe(before);
  });

  it('ผลถูก/ผิดเหมือนเดิม ทั้งครั้งแรกและครั้งที่อยู่ใน cache แล้ว', () => {
    const valid = ['Asia/Bangkok', 'UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/London', 'Etc/GMT+7'];
    const invalid: unknown[] = ['', 'asia/bangkok', 'Not/A_Zone', '+07:00', '-05:00', 'Asia/Bangkok ', 7, null, undefined, {}];
    for (let round = 0; round < 2; round++) {
      for (const tz of valid) expect(isValidTimeZone(tz)).toBe(true);
      for (const tz of invalid) expect(isValidTimeZone(tz)).toBe(false);
    }
  });

  it('cache มีขนาดไม่เกินชุดเขตเวลาที่ถูกต้อง แม้เรียกครบทุกชื่อซ้ำหลายรอบ', () => {
    const all = [...Intl.supportedValuesOf('timeZone'), 'UTC'];
    for (let round = 0; round < 3; round++) for (const tz of all) expect(isValidTimeZone(tz)).toBe(true);
    const size = validTimeZoneCacheSize();
    for (let i = 0; i < 500; i++) isValidTimeZone(`Bogus/${i}`);
    expect(validTimeZoneCacheSize()).toBe(size);
    // นอกจากชุดของ runtime มีแค่ค่าถูกจากเทสต์ข้างบน (เช่น Etc/GMT+7) — จำกัดโดยธรรมชาติ
    expect(size).toBeLessThanOrEqual(all.length + 10);
  });
});
