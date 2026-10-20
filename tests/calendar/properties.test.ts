// property tests — สุ่มแบบกำหนด seed (ทำซ้ำได้) ไม่พึ่งไลบรารีเพิ่ม
import { describe, expect, it } from 'vitest';
import { dayWindow, eachDate, addDays, daysBetween, monthGrid, parseLocalDateTime, startOfWeek, toLocal, WEEK_START } from '@/lib/calendar';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
// ขอบเขต instant: 2000-01-02 .. 2100-12-30 UTC (เว้นขอบเพื่อไม่ให้วันท้องถิ่นหลุดช่วงปี)
const LO = Date.UTC(2000, 0, 2);
const HI = Date.UTC(2100, 11, 30);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

describe('round-trip local ↔ epoch (2000–2100)', () => {
  for (const tz of ['Asia/Bangkok', 'Asia/Tokyo', 'Europe/London', 'America/New_York']) {
    it(`${tz}: toLocal → parseLocalDateTime คืน instant เดิม (ปัดนาที) และ instant อยู่ใน dayWindow ของวันนั้น`, () => {
      const rand = rng(20261020);
      let folds = 0;
      for (let i = 0; i < 1500; i++) {
        const ms = Math.floor(LO + rand() * (HI - LO));
        const { date, minute } = toLocal(ms, tz);
        expect(date).toMatch(ISO_RE);
        expect(minute).toBeGreaterThanOrEqual(0);
        expect(minute).toBeLessThan(1440);

        const floored = ms - (((ms % 60_000) + 60_000) % 60_000);
        const back = parseLocalDateTime(date, hhmm(minute), tz);
        if (back !== floored) {
          // อนุญาตเฉพาะ DST fold: เวลาผนังซ้ำสองครั้ง → parse เลือกครั้งแรก (เร็วกว่า) และแปลงกลับได้เวลาผนังเดิม
          folds++;
          expect(back).toBeLessThan(floored);
          expect(floored - back).toBeLessThanOrEqual(2 * 3_600_000);
          expect(toLocal(back, tz)).toEqual({ date, minute });
        }

        const [ws, we] = dayWindow(date, 0, 1440, tz);
        expect(ws).toBeLessThanOrEqual(ms);
        expect(ms).toBeLessThan(we);
        // วันท้องถิ่นยาว 23–25 ชม. เท่านั้น
        expect(we - ws).toBeGreaterThanOrEqual(23 * 3_600_000);
        expect(we - ws).toBeLessThanOrEqual(25 * 3_600_000);
        // ขอบวัน: ws อยู่วันนี้ 00:00, we − 1ms ยังเป็นวันนี้, we เป็นวันถัดไป
        expect(toLocal(ws, tz)).toEqual({ date, minute: 0 });
        expect(toLocal(we - 1, tz).date).toBe(date);
        expect(toLocal(we, tz).date).toBe(addDays(date, 1));
      }
      if (tz === 'Asia/Bangkok' || tz === 'Asia/Tokyo') expect(folds).toBe(0);
    });
  }

  it('ไม่มี DST gap ให้ parse ผ่านโดยเวลาผนังเพี้ยน: ทุกเวลาที่ parse สำเร็จแปลงกลับตรงเดิม', () => {
    const rand = rng(7);
    for (const tz of ['Europe/London', 'America/New_York']) {
      for (let i = 0; i < 2000; i++) {
        const y = 2000 + Math.floor(rand() * 101);
        const date = `${y}-${pad(1 + Math.floor(rand() * 12))}-${pad(1 + Math.floor(rand() * 28))}`;
        const min = Math.floor(rand() * 48) * 30;
        try {
          const ms = parseLocalDateTime(date, hhmm(min), tz);
          expect(toLocal(ms, tz)).toEqual({ date, minute: min });
        } catch (e) {
          expect((e as { code?: string }).code).toBe('INVALID_LOCAL_TIME');
        }
      }
    }
  });
});

describe('eachDate', () => {
  it('จำนวน = daysBetween + 1, ต่อเนื่องวันละ 1, ตรงกับตัวนับอิสระด้วย Date.UTC', () => {
    const rand = rng(99);
    for (let i = 0; i < 400; i++) {
      const y = 2000 + Math.floor(rand() * 100);
      const from = `${y}-${pad(1 + Math.floor(rand() * 12))}-${pad(1 + Math.floor(rand() * 28))}`;
      const n = Math.floor(rand() * 400);
      const to = addDays(from, n);
      const days = eachDate(from, to);
      const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
      const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
      const oracle = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
      expect(oracle).toBe(n);
      expect(days).toHaveLength(n + 1);
      expect(daysBetween(from, to)).toBe(n);
      expect(days[0]).toBe(from);
      expect(days[days.length - 1]).toBe(to);
      for (let k = 1; k < days.length; k++) expect(days[k]).toBe(addDays(days[k - 1]!, 1));
    }
  });

  it('ปี 2000 (อธิกฯ) = 366 วัน, 2100 (ไม่อธิกฯ) = 365, 2024 = 366, 2025 = 365', () => {
    for (const [y, n] of [[2000, 366], [2100, 365], [2024, 366], [2025, 365]] as const) {
      expect(eachDate(`${y}-01-01`, `${y}-12-31`)).toHaveLength(n);
    }
  });
});

describe('startOfWeek', () => {
  it('ทุกวัน 2000–2100: เป็นวันจันทร์, ไม่เกินวันนั้น, ห่าง 0–6 วัน, idempotent', () => {
    let count = 0;
    for (let ms = Date.UTC(2000, 0, 1); ms <= Date.UTC(2100, 11, 31); ms += 86_400_000) {
      const d = new Date(ms);
      const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      const s = startOfWeek(date);
      const sd = new Date(`${s}T00:00:00Z`);
      expect(sd.getUTCDay()).toBe(WEEK_START); // 1 = จันทร์ (ตัวนับอิสระของ JS)
      const diff = (ms - sd.getTime()) / 86_400_000;
      expect(diff).toBeGreaterThanOrEqual(0);
      expect(diff).toBeLessThanOrEqual(6);
      expect(startOfWeek(s)).toBe(s);
      count++;
    }
    expect(count).toBe(101 * 365 + 25); // 2000-01-01..2100-12-31: อธิกสุรทิน 2000,2004,…,2096 = 25 ปี (2100 ไม่ใช่)
  });
});

describe('monthGrid invariants ทุกเดือน 2000–2100', () => {
  it('เริ่มจันทร์ จบอาทิตย์ 28/35/42 วัน ครอบทั้งเดือน และไม่เกินสัปดาห์ที่จำเป็น', () => {
    const seen = new Set<number>();
    for (let y = 2000; y <= 2100; y++) {
      for (let m = 1; m <= 12; m++) {
        const g = monthGrid(y, m);
        const first = new Date(Date.UTC(y, m - 1, 1));
        const last = new Date(Date.UTC(y, m, 0));
        const from = new Date(`${g.from}T00:00:00Z`);
        const to = new Date(`${g.to}T00:00:00Z`);
        const total = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;

        expect(from.getUTCDay()).toBe(1); // จันทร์
        expect(to.getUTCDay()).toBe(0); // อาทิตย์
        expect([28, 35, 42]).toContain(total);
        expect(total).toBe(g.weeks * 7);
        expect([4, 5, 6]).toContain(g.weeks);
        expect(from.getTime()).toBeLessThanOrEqual(first.getTime());
        expect(to.getTime()).toBeGreaterThanOrEqual(last.getTime());
        // ไม่เกินจำเป็น: ก่อนวันที่ 1 ไม่เกิน 6 วัน และหลังวันสุดท้ายไม่เกิน 6 วัน
        expect(first.getTime() - from.getTime()).toBeLessThanOrEqual(6 * 86_400_000);
        expect(to.getTime() - last.getTime()).toBeLessThanOrEqual(6 * 86_400_000);

        const days = eachDate(g.from, g.to);
        expect(days).toHaveLength(total);
        expect(days.filter((d) => d.startsWith(`${y}-${pad(m)}-`))).toHaveLength(last.getUTCDate());
        seen.add(g.weeks);
      }
    }
    expect([...seen].sort()).toEqual([4, 5, 6]);
  });
});
