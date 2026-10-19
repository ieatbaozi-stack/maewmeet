// repo: pepper_fingerprint — ADR 0002 §7.2 · เก็บเฉพาะ fingerprint (HMAC ทางเดียว) ไม่เคยแตะค่า pepper
// ไม่มีฟังก์ชัน update/delete โดยตั้งใจ: แถวที่มีแล้วเปลี่ยนไม่ได้จากโค้ดแอป (การแก้ = ขั้นตอนดูแลระบบด้วยมือ)
import { asc, eq } from 'drizzle-orm';
import { pepperFingerprint } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export type PepperFingerprintRow = typeof pepperFingerprint.$inferSelect;

export async function getPepperFingerprint(db: DbOrTx, version: number): Promise<PepperFingerprintRow | null> {
  const rows = await db.select().from(pepperFingerprint).where(eq(pepperFingerprint.version, version)).limit(1);
  return rows[0] ?? null;
}

export async function listPepperFingerprints(db: DbOrTx): Promise<PepperFingerprintRow[]> {
  return db.select().from(pepperFingerprint).orderBy(asc(pepperFingerprint.version));
}

/** ตั้งเวอร์ชันครั้งแรก · มีแถวอยู่แล้ว → ไม่เขียนทับ (คืน false) */
export async function insertPepperFingerprintIfAbsent(
  db: DbOrTx,
  version: number,
  fingerprint: string,
  now: number,
): Promise<boolean> {
  const rows = await db
    .insert(pepperFingerprint)
    .values({ version, fingerprint, createdAt: now })
    .onConflictDoNothing()
    .returning({ version: pepperFingerprint.version });
  return rows.length === 1;
}
