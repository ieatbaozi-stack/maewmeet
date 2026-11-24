// ตรรกะการเลือกในหน้า Preview ของ IcsImportSheet (ระดับ A · QA 🟢 #7)
import { describe, expect, it } from 'vitest';
import { icsBulkActionDisabled, initialIcsSelection } from '@/components/busy/ics-import-model';

describe('initialIcsSelection', () => {
  it('เลือกรายการไม่ซ้ำเริ่มต้นและข้ามรายการซ้ำ', () => {
    expect(
      initialIcsSelection(
        [{ duplicate: false }, { duplicate: true }, { duplicate: false }],
        10,
      ),
    ).toEqual([true, false, true]);
  });

  it('จำกัดจำนวนที่เลือกไม่เกิน maxSelectable (และรับค่า 0/ติดลบได้ปลอดภัย)', () => {
    const items = [{ duplicate: false }, { duplicate: false }, { duplicate: false }];
    expect(initialIcsSelection(items, 2)).toEqual([true, true, false]);
    expect(initialIcsSelection(items, 0)).toEqual([false, false, false]);
    expect(initialIcsSelection(items, -5)).toEqual([false, false, false]);
  });

  it('เมื่อทุกรายการซ้ำหมด ไม่เลือกเลยสักรายการ', () => {
    expect(initialIcsSelection([{ duplicate: true }, { duplicate: true }], 10)).toEqual([false, false]);
  });
});

describe('icsBulkActionDisabled', () => {
  const base = {
    loading: false,
    submitting: false,
    allDuplicates: false,
    quotaRemaining: 10,
    selectedCount: 2,
  };

  it('สถานะปกติที่มีรายการไม่ซ้ำและมีรายการเลือกอยู่ → เปิดทั้งสองปุ่ม', () => {
    expect(icsBulkActionDisabled(base)).toEqual({ selectAll: false, selectNone: false });
  });

  it('ทุกรายการซ้ำหมด (allDuplicates) และยังไม่ได้เลือก → ปิดทั้ง "เลือกทั้งหมด" และ "ไม่เลือก"', () => {
    expect(icsBulkActionDisabled({ ...base, allDuplicates: true, selectedCount: 0 })).toEqual({
      selectAll: true,
      selectNone: true,
    });
  });

  it('ทุกรายการซ้ำหมด แต่ผู้ใช้ติ๊กเลือกเอง 1 รายการ → "เลือกทั้งหมด" ยังปิด ส่วน "ไม่เลือก" เปิดใช้งานได้', () => {
    expect(icsBulkActionDisabled({ ...base, allDuplicates: true, selectedCount: 1 })).toEqual({
      selectAll: true,
      selectNone: false,
    });
  });

  it('โควตาคงเหลือเป็น 0 → ปิด "เลือกทั้งหมด" (กดแล้วไม่มีโควตาให้เลือก)', () => {
    expect(icsBulkActionDisabled({ ...base, quotaRemaining: 0, selectedCount: 0 })).toEqual({
      selectAll: true,
      selectNone: true,
    });
    expect(icsBulkActionDisabled({ ...base, quotaRemaining: 0, selectedCount: 1 })).toEqual({
      selectAll: true,
      selectNone: false,
    });
  });

  it('มีรายการไม่ซ้ำแต่ยังไม่ได้เลือก (selectedCount = 0) → เปิด "เลือกทั้งหมด", ปิด "ไม่เลือก"', () => {
    expect(icsBulkActionDisabled({ ...base, selectedCount: 0 })).toEqual({
      selectAll: false,
      selectNone: true,
    });
  });

  it('กำลังโหลดหรือกำลังส่ง → ปิดทั้งสองปุ่มเสมอ', () => {
    expect(icsBulkActionDisabled({ ...base, loading: true })).toEqual({ selectAll: true, selectNone: true });
    expect(icsBulkActionDisabled({ ...base, submitting: true })).toEqual({ selectAll: true, selectNone: true });
  });
});
