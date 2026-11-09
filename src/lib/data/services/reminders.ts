// service: ตัวตั้งเวลาเตือนก่อนนัด — R10 §1 · ADR 0011 §3–5 · งานระบบ (ไม่มี actor) ด่านคือ CRON_SECRET ใน route wrapper
//  - รันซ้ำ/พร้อมกัน/catch-up ปลอดภัย: claimReminder (PK) เขียนในธุรกรรมเดียวกับ notify() · เงื่อนไขเวลาตัดสินใหม่ทุกรอบด้วย decideReminder (เกินเงื่อนไข = ไม่ส่ง)
//  - ผู้รับอ่านภายในธุรกรรม ณ เวลาถึงกำหนด: reminder_1d/1h = ตอบ going · rsvp_nudge = maybe หรือยังไม่ตอบ
//  - จำกัดงานต่อรอบ (จำนวน + เวลา) ที่เหลือไปรอบถัดไป
import type { Db } from '@/db/client';
import { decideReminder, REMINDER_KINDS, type ReminderKind } from '@/lib/calendar';
import { claimReminder, listReminderAudience, listReminderCandidates, type ReminderAudienceRow, type ReminderCandidate } from '@/lib/data/repos/reminder';
import { dispatchLineOutbox, type LineDispatchResult } from '@/lib/integrations/line/dispatch';
import { clock } from '@/lib/shared/clock';
import { REMINDER_CRON } from '@/lib/shared/limits';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import { notify } from '../notifications/notify';
import { inTx } from '../tx';

export type ReminderCronResult = {
  scanned: number;
  claimed: number;
  notified: number;
  failed: number;
  more: boolean;
  line: LineDispatchResult;
};

/** ผู้รับของแต่ละชนิด (ADR 0011 §5) */
export function reminderRecipients(kind: ReminderKind, audience: readonly ReminderAudienceRow[]): string[] {
  const wanted = kind === 'appointment.rsvp_nudge' ? (r: ReminderAudienceRow) => r.response === null || r.response === 'maybe' : (r: ReminderAudienceRow) => r.response === 'going';
  return audience.filter(wanted).map((r) => r.userId);
}

/** เขียนการเตือน 1 ชนิดของนัด 1 นัด — claim + notify ในธุรกรรมเดียว · คืนจำนวนผู้รับ หรือ null ถ้ามีรอบอื่นทำไปแล้ว/นัดเปลี่ยน */
async function writeReminder(db: Db, c: ReminderCandidate, kind: ReminderKind, now: number): Promise<number | null> {
  return inTx(db, async (tx) => {
    if (!(await claimReminder(tx, { appointmentId: c.id, kind, startAt: c.startAt }, now))) return null;
    const userIds = reminderRecipients(kind, await listReminderAudience(tx, c.id, c.groupId));
    return notify(
      tx,
      // ระบุชนิดเป็น literal เพื่อให้เทสต์สแกน allowlist ของ params (tests/security) ตรวจการเรียกนี้ได้
      { userIds, kind: kind as 'appointment.reminder_1d' | 'appointment.reminder_1h' | 'appointment.rsvp_nudge', params: { groupId: c.groupId, groupName: sanitizeDisplayText(c.groupName), appointmentId: c.id, title: c.title, startAt: c.startAt, tz: c.tz } },
      now,
    );
  });
}

export async function runReminderCron(db: Db, now: number): Promise<ReminderCronResult> {
  const startedAt = clock.now();
  const outOfTime = () => clock.now() - startedAt >= REMINDER_CRON.budgetMs;
  const candidates = await listReminderCandidates(db, now, REMINDER_CRON.scanMax);
  let claimed = 0;
  let notified = 0;
  let failed = 0;
  let more = false;

  outer: for (const c of candidates) {
    for (const kind of REMINDER_KINDS) {
      if (c.done.includes(kind)) continue;
      try {
        if (decideReminder({ kind, startAt: c.startAt, tz: c.tz, scheduledAt: c.scheduledAt, now }) !== 'send') continue;
        if (claimed >= REMINDER_CRON.maxClaimsPerRun || outOfTime()) {
          more = true;
          break outer;
        }
        const n = await writeReminder(db, c, kind, now);
        if (n !== null) {
          claimed += 1;
          notified += n;
        }
      } catch (e) {
        failed += 1; // rollback → รอบถัดไปลองใหม่ · รันพร้อมกันข้าม instance ก็มาทางนี้ (CONFLICT)
        console.error(`[reminders] failed ${e instanceof Error ? e.name : typeof e}`);
      }
    }
  }

  const line = await dispatchLineOutbox(db, now, { shouldStop: outOfTime });
  return { scanned: candidates.length, claimed, notified, failed, more: more || line.more, line };
}
