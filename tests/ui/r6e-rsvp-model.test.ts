// R6E E1/E2 — ปุ่มยืนยัน "ไป" เลือกคำตามชนิดที่ชน · ข้อความ "และนัดอื่นอีก" ไม่มีตัวเลข/ตัวแปร
import { describe, expect, it } from 'vitest';
import { goingConfirmKey } from '@/components/appointments/model';
import en from '../../messages/en.json';
import th from '../../messages/th.json';

const busy = { kind: 'busy' as const };
const appt = { kind: 'appointment' as const };

describe('goingConfirmKey (R6E-2)', () => {
  it('ไม่ชนอะไร → toConfirm', () => expect(goingConfirmKey([])).toBe('toConfirm'));
  it('ชนเฉพาะ busy ที่ลงเอง → conflictConfirmBusy', () => {
    expect(goingConfirmKey([busy])).toBe('conflictConfirmBusy');
    expect(goingConfirmKey([busy, busy, busy])).toBe('conflictConfirmBusy');
  });
  it('ชนนัด → conflictConfirm', () => expect(goingConfirmKey([appt])).toBe('conflictConfirm'));
  it('ชนนัดร่วมกับ busy → conflictConfirm', () => {
    expect(goingConfirmKey([busy, appt])).toBe('conflictConfirm');
    expect(goingConfirmKey([appt, busy])).toBe('conflictConfirm');
  });
  it('รายการถูกตัด (อาจมีนัดที่มองไม่เห็น) → conflictConfirm แม้ที่เห็นเป็น busy ล้วน', () => {
    expect(goingConfirmKey([busy, busy, busy, busy], true)).toBe('conflictConfirm');
  });
  it('ปุ่มทั้งสามแบบมีคำต่างกันทั้ง TH/EN และคีย์ครบ', () => {
    for (const m of [th, en]) {
      const g = m.appointments.goingConfirm;
      expect(new Set([g.toConfirm, g.conflictConfirm, g.conflictConfirmBusy]).size).toBe(3);
    }
    expect(th.appointments.goingConfirm.conflictConfirm).toBe('ไปทั้งสองนัด');
    expect(en.appointments.goingConfirm.conflictConfirm).toBe('Going to both');
  });
});

describe('conflictMore ไม่มีตัวเลข (R6E-1)', () => {
  it('TH/EN ไม่มี placeholder และไม่มีเลข', () => {
    for (const m of [th, en]) {
      const s = m.appointments.goingConfirm.conflictMore;
      expect(s).not.toMatch(/[{}]/);
      expect(s).not.toMatch(/[0-9๐-๙]/);
    }
  });
  it('ไม่มี caller ส่ง count: "1+" อีก', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/appointments/RsvpConfirm.tsx', 'utf8');
    expect(src).not.toContain('1+');
  });
});
