/**
 * ตรรกะบริสุทธิ์ของการเลือกในหน้า Preview ของ IcsImportSheet (ระดับ A · แยกทดสอบได้ใน tests/ui/ics-import-model.test.ts)
 */

export interface IcsSelectableItem {
  readonly duplicate: boolean;
}

/** เลือกรายการที่ไม่ซ้ำเริ่มต้นไม่เกิน maxSelectable (= min(quota.remaining, maxImportPerBatch)) */
export function initialIcsSelection(items: readonly IcsSelectableItem[], maxSelectable: number): boolean[] {
  const cap = Math.max(0, maxSelectable);
  let count = 0;
  return items.map((item) => {
    if (item.duplicate || count >= cap) return false;
    count++;
    return true;
  });
}

export interface IcsBulkActionStateInput {
  readonly loading: boolean;
  readonly submitting: boolean;
  readonly allDuplicates: boolean;
  readonly quotaRemaining: number;
  readonly selectedCount: number;
}

export interface IcsBulkActionDisabled {
  readonly selectAll: boolean;
  readonly selectNone: boolean;
}

/**
 * สถานะปิดปุ่มเลือกเร็ว ("เลือกทั้งหมด" / "ไม่เลือก") ในหน้า Preview:
 * - "เลือกทั้งหมด" ปิดเมื่อกำลังโหลด/ส่ง หรือไม่มีรายการไม่ซ้ำให้เลือก (allDuplicates) หรือโควตาคงเหลือเป็น 0
 * - "ไม่เลือก" ปิดเมื่อกำลังโหลด/ส่ง หรือยังไม่มีรายการที่เลือกอยู่ (selectedCount <= 0)
 */
export function icsBulkActionDisabled(input: IcsBulkActionStateInput): IcsBulkActionDisabled {
  const busy = input.loading || input.submitting;
  return {
    selectAll: busy || input.allDuplicates || input.quotaRemaining <= 0,
    selectNone: busy || input.selectedCount <= 0,
  };
}
