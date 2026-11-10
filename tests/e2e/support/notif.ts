// R10: ใส่แถวแจ้งเตือนตรงใน DB ของเซิร์ฟเวอร์ E2E (ไฟล์เดียวกับ next start) — cron เตือนจริงรันใน e2e ไม่ได้ (ไม่มีนาฬิกาจำลอง)
// จึงใส่แถวที่ notify() จะเขียน (kind + params ค่าดิบ ตาม ADR 0007) แล้วทดสอบฝั่งแสดงผล/การกดไปหน้านัดผ่าน UI จริง
import { randomUUID } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import { E2E_DATABASE_URL } from './env';

export type ReminderKind = 'appointment.reminder_1d' | 'appointment.reminder_1h' | 'appointment.rsvp_nudge';

export type ReminderParams = { groupId: string; groupName: string; appointmentId: string; title: string; startAt: number; tz: string };

let client: Client | undefined;
const db = (): Client => (client ??= createClient({ url: E2E_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined, timeout: 15_000 }));

async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 8 || !/database is locked|SQLITE_BUSY/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}

/** แทรกแถว notification ที่ยังไม่อ่าน · createdAt เรียงตามลำดับที่ส่งเข้ามา (+1 ms ต่อแถว) (ตัวหลังใหม่กว่า) · คืน id ของแถว */
export async function insertReminderNotifications(userId: string, rows: { kind: ReminderKind; params: ReminderParams }[]): Promise<string[]> {
  // ต้องไม่เก่ากว่า joined_at ของผู้ใช้ในกลุ่ม (repos/notification.ts visibleToOwner: created_at >= joined_at) → ใช้เวลาปัจจุบัน ไม่ย้อนหลัง
  const base = Date.now();
  const ids: string[] = [];
  for (const [i, r] of rows.entries()) {
    const id = randomUUID();
    ids.push(id);
    await withBusyRetry(() =>
      db().execute({
        sql: 'INSERT INTO notification (id, user_id, kind, params, read_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
        args: [id, userId, r.kind, JSON.stringify(r.params), base + i],
      }),
    );
  }
  return ids;
}

/** R11: แทรกแถวชนิดใดก็ได้พร้อม params ดิบ (ตามสัญญา R11 §1) · ลำดับเดียวกับ insertReminderNotifications (+1 ms ต่อแถว) · คืน id */
export async function insertNotifications(userId: string, rows: { kind: string; params: Record<string, unknown> }[]): Promise<string[]> {
  const base = Date.now();
  const ids: string[] = [];
  for (const [i, r] of rows.entries()) {
    const id = randomUUID();
    ids.push(id);
    await withBusyRetry(() =>
      db().execute({
        sql: 'INSERT INTO notification (id, user_id, kind, params, read_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
        args: [id, userId, r.kind, JSON.stringify(r.params), base + i],
      }),
    );
  }
  return ids;
}
