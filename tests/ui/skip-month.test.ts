// R18 fix: สลับโหมด "เว้น ↔ เอากลับ" ต้องไปเดือนที่มีวันของโหมดปลายทาง (ไม่ค้างเดือนที่ไม่มีวันเว้น)
import { describe, expect, it } from 'vitest';
import { initialMonth, monthAfterModeChange, type SkipPool } from '@/components/busy/skip-model';

const pool = (available: string[], skipped: string[]): SkipPool => ({ days: [...available, ...skipped].sort(), available, skipped }) as SkipPool;

describe('monthAfterModeChange', () => {
  // วันที่เว้นไว้อยู่เดือนถัดไป (ธ.ค.) · วันที่เว้นได้ยังมีใน พ.ย.
  const p = pool(['2026-11-25', '2026-11-30', '2026-12-02'], ['2026-12-09', '2026-12-16']);
  it('skip (พ.ย.) → restore: ไปเดือนที่มีวันเว้น (ธ.ค.) ไม่ค้าง พ.ย.', () => {
    expect(monthAfterModeChange(p, 'restore', '2026-11')).toBe('2026-12');
  });
  it('restore (ธ.ค.) → skip: คงเดือนเดิมถ้ามีวันที่เว้นได้ · ไม่งั้นไปเดือนแรกของโหมด', () => {
    expect(monthAfterModeChange(p, 'skip', '2026-12')).toBe('2026-12');
    const q = pool(['2026-11-25'], ['2026-12-09']);
    expect(monthAfterModeChange(q, 'skip', '2026-12')).toBe('2026-11');
  });
  it('เดือนปัจจุบันมีวันของโหมดปลายทางอยู่ → คงเดิม', () => {
    expect(monthAfterModeChange(pool(['2026-11-25'], ['2026-11-26']), 'restore', '2026-11')).toBe('2026-11');
  });
  it('ไม่มีเดือนปัจจุบัน/ไม่มีวันในโหมดนั้น → initialMonth (ตกไปวันแรกของชุด)', () => {
    const none = pool(['2026-11-25'], []);
    expect(monthAfterModeChange(none, 'restore', '2026-11')).toBe(initialMonth(none, 'restore'));
    expect(monthAfterModeChange(p, 'skip', null)).toBe('2026-11');
  });
});
