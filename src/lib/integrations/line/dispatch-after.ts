// ส่ง LINE ทันทีหลังยกเลิกนัด — R11 §2
//  - เรียกหลัง commit เท่านั้น: ใช้ after() ของ Next ให้ทำงานหลังตอบ API แล้ว (ไม่ทำให้คำตอบช้าลง)
//  - ทำเฉพาะแถวของนัดนี้ ชนิดนี้ (scope) — ไม่เร่งงานเตือนนัดของคนอื่น
//  - ไม่รับประกันการส่ง: ล้มเหลว/ไม่ทำงาน/ไม่มี request scope (เทสต์, cron, นอกคำขอ) = แถวยังอยู่ใน outbox และ cron 15 นาทีลองต่อ
//  - ไม่ส่งซ้ำ: claimOutboxRow จองทีละแถว · ใช้ X-Line-Retry-Key = id แถวเดิมทุกครั้ง (ดู dispatch.ts)
import { after } from 'next/server';
import type { Db } from '@/db/client';
import { clock } from '@/lib/shared/clock';
import { getEnv } from '@/lib/shared/env';
import { LINE_DISPATCH } from '@/lib/shared/limits';
import { lineConfig } from './config';
import { dispatchLineOutbox } from './dispatch';

export function dispatchCancelledLineAfterResponse(db: Db, appointmentId: string): void {
  if (lineConfig(getEnv()) === null) return;
  try {
    after(async () => {
      const startedAt = clock.now();
      try {
        await dispatchLineOutbox(db, startedAt, {
          scope: { kind: 'appointment.cancelled', appointmentId },
          shouldStop: () => clock.now() - startedAt >= LINE_DISPATCH.afterResponseBudgetMs,
        });
      } catch (e) {
        console.error(`[line] immediate dispatch failed ${e instanceof Error ? e.name : typeof e}`);
      }
    });
  } catch {
    // ไม่มี request scope — ปล่อยให้ cron ส่ง
  }
}
