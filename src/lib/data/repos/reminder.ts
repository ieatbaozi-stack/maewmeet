// repo: เตือนก่อนนัด — R10 §1.2 · ADR 0011 §3 · claim เป็น INSERT … SELECT เดียวที่มีเงื่อนไขในตัว (นัด active + startAt ตรง + กลุ่มยังอยู่) · PK กันซ้ำ
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { REMINDER_KINDS, REMINDER_RULES, type ReminderKind } from '@/lib/calendar';
import type { RsvpResponse } from './appointment';

export type ReminderCandidate = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  startAt: number;
  tz: string;
  scheduledAt: number;
  done: readonly string[];
};

/**
 * นัด active ที่อยู่ในหน้าต่างของชนิดใดชนิดหนึ่งและชนิดนั้นยังไม่ได้เขียน — ตัวกรองหยาบ (ค่าจาก REMINDER_RULES) · การตัดสินจริงอยู่ที่ decideReminder
 * เงื่อนไข start_at ด้านนอกให้ใช้ appointment_start_idx ได้ · นัดที่ทำครบแล้วถูกตัดก่อน LIMIT จึงไม่บังแถวใหม่ (ADR 0011 §4)
 */
export function reminderCandidatesSql(now: number, limit: number): SQL {
  const rules = REMINDER_KINDS.map((k) => REMINDER_RULES[k]);
  const from = now + Math.min(...rules.map((r) => r.minLeadMs));
  const to = now + Math.max(...rules.map((r) => r.leadMs));
  const windows = sql.join(
    REMINDER_KINDS.map((k) => {
      const r = REMINDER_RULES[k];
      return sql`(a.start_at >= ${now + r.minLeadMs} AND a.start_at <= ${now + r.leadMs}
        AND NOT EXISTS (SELECT 1 FROM appointment_reminder ar WHERE ar.appointment_id = a.id AND ar.start_at = a.start_at AND ar.kind = ${k}))`;
    }),
    sql` OR `,
  );
  return sql`
    SELECT a.id AS id, a.group_id AS group_id, g.name AS group_name, a.title AS title, a.start_at AS start_at, a.tz AS tz, a.scheduled_at AS scheduled_at,
           (SELECT group_concat(ar.kind) FROM appointment_reminder ar WHERE ar.appointment_id = a.id AND ar.start_at = a.start_at) AS done
    FROM appointment a
    JOIN groups g ON g.id = a.group_id AND g.deleted_at IS NULL
    WHERE a.status = 'active' AND a.start_at >= ${from} AND a.start_at <= ${to} AND (${windows})
    ORDER BY a.start_at, a.id
    LIMIT ${limit}`;
}

type CandidateRaw = { id: string; group_id: string; group_name: string; title: string; start_at: number; tz: string; scheduled_at: number; done: string | null };

export async function listReminderCandidates(db: DbOrTx, now: number, limit: number): Promise<ReminderCandidate[]> {
  const rows = await db.all<CandidateRaw>(reminderCandidatesSql(now, limit));
  return rows.map((r) => ({
    id: r.id,
    groupId: r.group_id,
    groupName: r.group_name,
    title: r.title,
    startAt: Number(r.start_at),
    tz: r.tz,
    scheduledAt: Number(r.scheduled_at),
    done: r.done ? r.done.split(',') : [],
  }));
}

/** จองสิทธิ์เตือนชนิดนี้ ณ startAt นี้ · false = มีผู้เขียนแล้ว หรือนัดไม่ active / เลื่อนเวลา / กลุ่มถูกลบ */
export async function claimReminder(db: DbOrTx, input: { appointmentId: string; kind: ReminderKind; startAt: number }, now: number): Promise<boolean> {
  const rows = await db.all<{ appointment_id: string }>(sql`
    INSERT INTO appointment_reminder (appointment_id, kind, start_at, created_at)
    SELECT a.id, ${input.kind}, a.start_at, ${now}
    FROM appointment a
    JOIN groups g ON g.id = a.group_id AND g.deleted_at IS NULL
    WHERE a.id = ${input.appointmentId} AND a.status = 'active' AND a.start_at = ${input.startAt}
    ON CONFLICT (appointment_id, kind, start_at) DO NOTHING
    RETURNING appointment_id`);
  return rows.length === 1;
}

export type ReminderAudienceRow = { userId: string; response: RsvpResponse | null };

/** สมาชิกปัจจุบัน (บัญชี active) + คำตอบตามกติกา ADR 0009 §1 (คำตอบก่อน joined_at ปัจจุบันถือว่ายังไม่ตอบ) */
export async function listReminderAudience(db: DbOrTx, appointmentId: string, groupId: string): Promise<ReminderAudienceRow[]> {
  const rows = await db.all<{ user_id: string; response: RsvpResponse | null }>(sql`
    SELECT gm.user_id AS user_id, r.response AS response
    FROM group_member gm
    JOIN user u ON u.id = gm.user_id AND u.status = 'active'
    LEFT JOIN appointment_rsvp r ON r.appointment_id = ${appointmentId} AND r.user_id = gm.user_id AND r.updated_at >= gm.joined_at
    WHERE gm.group_id = ${groupId}`);
  return rows.map((r) => ({ userId: r.user_id, response: r.response }));
}
