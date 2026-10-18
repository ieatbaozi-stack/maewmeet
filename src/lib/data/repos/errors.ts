// แยกชนิดของ SQLite constraint error (libSQL: e.code = SQLITE_CONSTRAINT_UNIQUE | _PRIMARYKEY | _CHECK | _FOREIGNKEY | …)
// drizzle ห่อ error ไว้ใน cause → เดินสายโซ่หา code/message
export type ConstraintKind = 'unique' | 'check' | 'foreignkey' | 'notnull' | 'other';

export function constraintKind(e: unknown): ConstraintKind | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const o = cur as { code?: unknown; message?: unknown; cause?: unknown };
    const code = typeof o.code === 'string' ? o.code : '';
    const msg = typeof o.message === 'string' ? o.message : '';
    if (/^SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)/.test(code) || /UNIQUE constraint failed/i.test(msg)) return 'unique';
    if (/^SQLITE_CONSTRAINT_CHECK/.test(code) || /CHECK constraint failed/i.test(msg)) return 'check';
    if (/^SQLITE_CONSTRAINT_FOREIGNKEY/.test(code) || /FOREIGN KEY constraint failed/i.test(msg)) return 'foreignkey';
    if (/^SQLITE_CONSTRAINT_NOTNULL/.test(code) || /NOT NULL constraint failed/i.test(msg)) return 'notnull';
    if (code.startsWith('SQLITE_CONSTRAINT')) return 'other';
    cur = o.cause;
  }
  return null;
}
