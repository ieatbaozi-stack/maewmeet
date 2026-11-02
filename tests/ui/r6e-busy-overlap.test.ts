// R6E E11 / R6E-9 — หา busy ของตัวเองที่ทับกับรายการที่กำลังจะลง/แก้ (ฟังก์ชันล้วน)
import { describe, expect, it } from 'vitest';
import type { OwnBusy } from '@/components/calendar/model';
import { candidateOf, findOverlaps, limitOverlaps, listQueryFor, OVERLAP_SHOW_MAX } from '@/components/busy/overlap-model';
import { normalizeBusyInput } from '@/lib/calendar';

const own = (id: string, p: Parameters<typeof normalizeBusyInput>[0], extra: Partial<OwnBusy> = {}): OwnBusy => {
  const r = normalizeBusyInput(p);
  if (!r.ok) throw new Error('bad fixture');
  return { id, title: null, note: null, hidden: false, ...r.value, ...extra };
};
const timed = (d: string, s: string, e: string, ed = d) => ({ kind: 'timed' as const, startDate: d, startTime: s, endDate: ed, endTime: e });
const allDay = (s: string, e = s) => ({ kind: 'all_day' as const, startDate: s, endDate: e });
const cand = (p: Parameters<typeof candidateOf>[0]) => {
  const c = candidateOf(p);
  if (!c) throw new Error('bad candidate');
  return c;
};
const payload = (p: ReturnType<typeof timed> | ReturnType<typeof allDay>) => p as Parameters<typeof candidateOf>[0];

describe('findOverlaps (R6E-9)', () => {
  const existing = [own('a', timed('2026-11-10', '10:00', '12:00')), own('d', allDay('2026-11-12'))];

  it('ทับช่วงเวลา → พบ', () => {
    expect(findOverlaps(cand(payload(timed('2026-11-10', '11:00', '13:00'))), existing, null).map((b) => b.id)).toEqual(['a']);
  });
  it('ไม่ทับ → ว่าง', () => {
    expect(findOverlaps(cand(payload(timed('2026-11-10', '13:00', '14:00'))), existing, null)).toEqual([]);
  });
  it('ชนขอบพอดี (จบ 10:00 / เริ่ม 12:00) ไม่นับ', () => {
    expect(findOverlaps(cand(payload(timed('2026-11-10', '08:00', '10:00'))), existing, null)).toEqual([]);
    expect(findOverlaps(cand(payload(timed('2026-11-10', '12:00', '13:00'))), existing, null)).toEqual([]);
  });
  it('ตอนแก้ ไม่นับรายการตัวเอง (เวลาเดิมเป๊ะ = ไม่ทับ)', () => {
    expect(findOverlaps(cand(payload(timed('2026-11-10', '10:00', '12:00'))), existing, 'a')).toEqual([]);
    expect(findOverlaps(cand(payload(timed('2026-11-10', '10:00', '12:00'))), existing, null).map((b) => b.id)).toEqual(['a']);
  });
  it('ตอนแก้ แต่ทับรายการอื่น → พบรายการอื่น', () => {
    const more = [...existing, own('b', timed('2026-11-10', '11:00', '15:00'))];
    expect(findOverlaps(cand(payload(timed('2026-11-10', '10:00', '12:00'))), more, 'a').map((b) => b.id)).toEqual(['b']);
  });
  it('ทั้งวันเทียบตามวันท้องถิ่น: ทั้งวันทับช่วงเวลาในวันนั้น · วันถัดไปไม่ทับ', () => {
    expect(findOverlaps(cand(payload(allDay('2026-11-10'))), existing, null).map((b) => b.id)).toEqual(['a']);
    expect(findOverlaps(cand(payload(allDay('2026-11-11'))), existing, null)).toEqual([]);
    expect(findOverlaps(cand(payload(timed('2026-11-12', '09:00', '10:00'))), existing, null).map((b) => b.id)).toEqual(['d']);
  });
  it('ช่วงเวลาที่จบเที่ยงคืนพอดีไม่ทับทั้งวันของวันถัดไป', () => {
    expect(findOverlaps(cand(payload(timed('2026-11-11', '22:00', '00:00', '2026-11-12'))), existing, null)).toEqual([]);
  });
  it('หลายวัน (ทั้งวัน) ทับที่ปลายด้านเดียว', () => {
    expect(findOverlaps(cand(payload(allDay('2026-11-08', '2026-11-10'))), existing, null).map((b) => b.id)).toEqual(['a']);
    expect(findOverlaps(cand(payload(allDay('2026-11-12', '2026-11-14'))), existing, null).map((b) => b.id)).toEqual(['d']);
  });
  it('ข้ามคืนทับ', () => {
    expect(findOverlaps(cand(payload(timed('2026-11-09', '23:00', '10:30', '2026-11-10'))), existing, null).map((b) => b.id)).toEqual(['a']);
  });
  it('เรียงตามเวลาเริ่ม', () => {
    const list = [own('z', timed('2026-11-10', '14:00', '16:00')), own('y', timed('2026-11-10', '10:00', '11:00'))];
    expect(findOverlaps(cand(payload(allDay('2026-11-10'))), list, null).map((b) => b.id)).toEqual(['y', 'z']);
  });
});

describe('limitOverlaps / candidateOf / listQueryFor', () => {
  it('แสดงไม่เกิน 4 · เกิน = more', () => {
    expect(OVERLAP_SHOW_MAX).toBe(4);
    expect(limitOverlaps([1, 2, 3, 4])).toEqual({ shown: [1, 2, 3, 4], more: false });
    expect(limitOverlaps([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3, 4], more: true });
    expect(limitOverlaps([])).toEqual({ shown: [], more: false });
  });
  it('payload ที่แปลงไม่ได้ → null (ให้เซิร์ฟเวอร์ตัดสิน ไม่บล็อก)', () => {
    expect(candidateOf({ kind: 'timed', startDate: 'x', endDate: 'y', startTime: '10:00', endTime: '11:00' })).toBeNull();
  });
  it('query ช่วงวัน ≤ 62 วันส่ง from/to · ยาวกว่านั้นไม่ส่ง', () => {
    expect(listQueryFor(cand(payload(allDay('2026-11-10', '2026-11-12'))))).toBe('?from=2026-11-10&to=2026-11-12');
    expect(listQueryFor(cand(payload(allDay('2026-11-01', '2027-03-01'))))).toBe('');
  });
});
