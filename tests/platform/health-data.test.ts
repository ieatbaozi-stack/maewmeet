// src/lib/data/health.ts — API ที่ OPS ใช้ทำ GET /api/health (R0-8) · ไม่โยน · ไม่รั่วรายละเอียด
import { afterEach, describe, expect, it } from 'vitest';
import { checkDbConnection, heartbeatAgeHours, readHealthData, readHeartbeatAgeHours } from '@/lib/data/health';
import { upsertHeartbeat } from '@/lib/data/repos/system-heartbeat';
import { HOUR_MS } from '@/lib/shared/clock';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

let t: InstalledTestDb | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

describe('health data', () => {
  it('ทุกอย่างปกติ → env/db true · ยังไม่มี heartbeat = null', async () => {
    t = await installTestDb();
    expect(await readHealthData(NOW)).toEqual({ env: true, db: true, heartbeatAgeHours: { vercelCron: null, githubActions: null } });
  });

  it('อายุ heartbeat เป็นชั่วโมง ทศนิยม 2 ตำแหน่ง ต่อ source', async () => {
    t = await installTestDb();
    await upsertHeartbeat(t.db, 'vercel-cron', NOW - 49 * HOUR_MS);
    await upsertHeartbeat(t.db, 'github-actions', NOW - HOUR_MS / 3);
    expect(await heartbeatAgeHours(t.db, NOW)).toEqual({ vercelCron: 49, githubActions: 0.33 });
    expect((await readHealthData(NOW)).heartbeatAgeHours).toEqual({ vercelCron: 49, githubActions: 0.33 });
  });

  it('DB ต่อไม่ได้ → db false, heartbeat null ทั้งคู่, ไม่โยน', async () => {
    t = await installTestDb({ TURSO_DATABASE_URL: 'file:/nonexistent-dir-maewmeet/x/y.db' });
    expect(await readHealthData(NOW)).toEqual({ env: true, db: false, heartbeatAgeHours: { vercelCron: null, githubActions: null } });
    // libSQL โยนตั้งแต่เปิด connection (getDb) — ทั้งสองฟังก์ชันต้องกลืนไว้
    expect(await checkDbConnection()).toBe(false);
    expect(await readHeartbeatAgeHours(NOW)).toBeNull();
  });

  it('env ต้องมีหาย → env false, db false (ไม่พยายามต่อ), ไม่โยน', async () => {
    t = await installTestDb({ CRON_SECRET: '' });
    const r = await readHealthData(NOW);
    expect(r).toEqual({ env: false, db: false, heartbeatAgeHours: { vercelCron: null, githubActions: null } });
    expect(JSON.stringify(r)).not.toContain(t.env.APP_SECRET);
  });
});
