// ธุรกรรมของ service กลุ่ม — ARCHITECTURE §2 "db.transaction(tx => repos… + audit(tx) + notify(tx))"
//
// ความถูกต้องไม่พึ่งโค้ดในไฟล์นี้: ทุกการเปลี่ยนสถานะที่แข่งกันได้ (โอน admin, เข้ากลุ่มตอนเต็ม, เพดานกลุ่ม/โค้ด, ใช้โค้ด)
// ตัดสินด้วยคำสั่ง SQL เดียวที่มีเงื่อนไขในตัว (conditional UPDATE / INSERT … SELECT … WHERE count < cap) — ไม่มี check-then-act
//
// สิ่งที่ไฟล์นี้ทำ: คิวเขียนใน process เดียวกันต่อ Db หนึ่งตัว เพราะ driver ของ `file:` เป็น sync —
// ธุรกรรมสองตัวใน process เดียวที่ซ้อนกันจะรอล็อกแบบบล็อก event loop จนครบ busy timeout แล้วได้ SQLITE_BUSY
// (ดู FILE_BUSY_TIMEOUT_MS ใน src/db/client.ts) · คิวทำให้ตัวที่สองรอที่ JS แทน → ผลเทสต์แข่งกันกำหนดได้ และ dev/E2E ไม่เจอ BUSY ภายใน process
// บน Turso (remote) คิวนี้ไม่ได้เป็นด่านความถูกต้อง — แต่ละ instance มีคิวของตัวเอง · ข้าม process ยังชนกันได้ → isSqliteBusy → CONFLICT (ลองใหม่ได้)
import type { Db, Tx } from '@/db/client';
import { isSqliteBusy } from '@/lib/auth/services/shared';
import { AppError } from '@/lib/shared/errors';

const tails = new WeakMap<object, Promise<unknown>>();

/** รัน fn ทีละตัวต่อ Db (ตัวถัดไปรอตัวก่อนหน้าจบ ไม่ว่าสำเร็จหรือล้ม) */
export function serialized<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(db) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  tails.set(db, run.catch(() => undefined));
  return run;
}

/** serialized + db.transaction · เขียนชนข้าม process → CONFLICT (ธุรกรรม rollback ทั้งก้อน) */
export function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return serialized(db, () =>
    db.transaction(fn).catch((e: unknown) => {
      throw isSqliteBusy(e) ? new AppError('CONFLICT') : e;
    }),
  );
}
