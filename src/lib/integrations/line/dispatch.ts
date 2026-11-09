// ส่ง notification_outbox ทาง LINE — ADR 0007 §2 · ADR 0011 §5 · R10 §1.4
//  - จองแถวก่อนส่ง (claimOutboxRow) → รันซ้ำ/พร้อมกันไม่ส่งซ้ำ · retry key = id แถว
//  - ตรวจซ้ำก่อนส่ง: นัด active · startAt ตรงกับตอนเข้าคิว · กลุ่มยังอยู่ · ผู้รับ active + ยังเชื่อม + ยังตอบ going · เหลือเวลา ≥ minLead — ไม่ผ่าน = dead รหัส STALE
//  - เพดาน LINE_SEND_CAPS ตรวจตอนจองแถว (claimOutboxRow) เกิน = dead รหัส LINE_CAP ไม่ push · กระดิ่งเขียนไปแล้วไม่กระทบ
//  - retry ≤ 5 ครั้ง backoff 2^attempts นาที · 429 monthly limit → dead ทั้งคิวและไม่ลองอีกจนสิ้นเดือน · log เฉพาะจำนวน
import type { Db } from '@/db/client';
import { DEFAULT_TZ, reminderStillSendable, startOfMonthAt } from '@/lib/calendar';
import {
  capOutboxRow,
  claimOutboxRow,
  deadAllPendingLine,
  finishOutboxRow,
  lineMonthlyLimitHit,
  listDueLineOutbox,
  loadOutboxSendContext,
  markOutboxMonthlyLimit,
  markOutboxRetry,
  type OutboxRow,
} from '@/lib/data/repos/line';
import { serialized } from '@/lib/data/tx';
import { MINUTE_MS } from '@/lib/shared/clock';
import { getEnv } from '@/lib/shared/env';
import { LINE_DISPATCH } from '@/lib/shared/limits';
import { pushText } from './client';
import { lineConfig, type LineConfig } from './config';
import { renderLineReminder, type LineReminderKind } from './messages';

export type LineDispatchResult = {
  enabled: boolean;
  sent: number;
  retried: number;
  dead: number;
  stale: number;
  capped: number;
  monthlyLimit: boolean;
  more: boolean;
};

type ReminderPayload = { kind: LineReminderKind; appointmentId: string; startAt: number; tz: string; title: string; groupName: string };

function parsePayload(raw: unknown): ReminderPayload | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { kind, params } = raw as { kind?: unknown; params?: unknown };
  if ((kind !== 'appointment.reminder_1d' && kind !== 'appointment.reminder_1h') || params === null || typeof params !== 'object') return null;
  const p = params as Record<string, unknown>;
  if (typeof p.appointmentId !== 'string' || typeof p.tz !== 'string' || typeof p.title !== 'string' || typeof p.groupName !== 'string') return null;
  if (typeof p.startAt !== 'number' || !Number.isFinite(p.startAt)) return null;
  return { kind, appointmentId: p.appointmentId, startAt: p.startAt, tz: p.tz, title: p.title, groupName: p.groupName };
}

type RowResult = 'sent' | 'retried' | 'dead' | 'stale' | 'capped' | 'monthly_limit' | 'skipped';

async function processRow(db: Db, config: LineConfig, row: OutboxRow, now: number): Promise<RowResult> {
  if (row.attempts >= LINE_DISPATCH.maxAttempts) {
    await serialized(db, () => finishOutboxRow(db, row.id, 'dead', row.lastError ?? 'LINE_MAX_ATTEMPTS', now));
    return 'dead';
  }
  const payload = parsePayload(row.payload);
  if (!payload) {
    await serialized(db, () => finishOutboxRow(db, row.id, 'dead', 'BAD_PAYLOAD', now));
    return 'dead';
  }
  const attempt = row.attempts + 1;
  const target = { kind: payload.kind, appointmentId: payload.appointmentId };
  const claimed = await serialized(db, () => claimOutboxRow(db, row, target, now + 2 ** attempt * MINUTE_MS, now));
  if (!claimed) return (await serialized(db, () => capOutboxRow(db, row, now))) ? 'capped' : 'skipped';

  const ctx = await loadOutboxSendContext(db, { userId: row.userId, appointmentId: payload.appointmentId });
  if (
    ctx === null ||
    ctx.apptStatus !== 'active' ||
    ctx.apptStartAt !== payload.startAt ||
    ctx.groupDeleted ||
    ctx.userStatus !== 'active' ||
    ctx.lineUserId === null ||
    ctx.response !== 'going' ||
    !reminderStillSendable(payload.kind, payload.startAt, now)
  ) {
    await serialized(db, () => finishOutboxRow(db, row.id, 'dead', 'STALE', now));
    return 'stale';
  }

  const text = renderLineReminder(ctx.locale, payload.kind, { ...payload, appOrigin: config.appOrigin });
  const res = await pushText(config, { to: ctx.lineUserId, text, retryKey: row.id });
  if (res.outcome === 'sent') {
    await serialized(db, () => finishOutboxRow(db, row.id, 'sent', null, now));
    return 'sent';
  }
  if (res.outcome === 'monthly_limit') {
    await serialized(db, () => markOutboxMonthlyLimit(db, row.id, now));
    return 'monthly_limit';
  }
  if (res.outcome === 'dead' || attempt >= LINE_DISPATCH.maxAttempts) {
    await serialized(db, () => finishOutboxRow(db, row.id, 'dead', res.code, now));
    return 'dead';
  }
  await serialized(db, () => markOutboxRetry(db, row.id, res.code));
  return 'retried';
}

function logMonthlyLimit(dropped: number): void {
  console.warn(`[line] monthly limit reached; dropped=${dropped}`);
}

export async function dispatchLineOutbox(db: Db, now: number, opts: { shouldStop?: () => boolean } = {}): Promise<LineDispatchResult> {
  const result: LineDispatchResult = { enabled: false, sent: 0, retried: 0, dead: 0, stale: 0, capped: 0, monthlyLimit: false, more: false };
  const config = lineConfig(getEnv());
  if (!config) return result;
  result.enabled = true;

  if (await lineMonthlyLimitHit(db, startOfMonthAt(now, DEFAULT_TZ))) {
    result.monthlyLimit = true;
    const dropped = await serialized(db, () => deadAllPendingLine(db, now));
    if (dropped > 0) logMonthlyLimit(dropped);
    result.dead += dropped;
    return result;
  }

  const rows = await listDueLineOutbox(db, now, LINE_DISPATCH.perRun + 1);
  result.more = rows.length > LINE_DISPATCH.perRun;
  for (const row of rows.slice(0, LINE_DISPATCH.perRun)) {
    if (opts.shouldStop?.()) {
      result.more = true;
      break;
    }
    let outcome: RowResult;
    try {
      outcome = await processRow(db, config, row, now);
    } catch (e) {
      console.error(`[line] dispatch failed ${e instanceof Error ? e.name : typeof e}`);
      continue;
    }
    if (outcome === 'sent') result.sent += 1;
    else if (outcome === 'retried') result.retried += 1;
    else if (outcome === 'dead') result.dead += 1;
    else if (outcome === 'stale') result.stale += 1;
    else if (outcome === 'capped') result.capped += 1;
    else if (outcome === 'monthly_limit') {
      result.monthlyLimit = true;
      const dropped = await serialized(db, () => deadAllPendingLine(db, now));
      logMonthlyLimit(dropped + 1);
      result.dead += dropped + 1;
      result.more = false;
      break;
    }
  }
  return result;
}
