// Integration tests สำหรับนำเข้าไฟล์ .ics (ICS_IMPORT_CONTRACT §2 A2–A5, §4 · ADR 0017) — เจ้าของ: test
// เรียก route handler จริงผ่าน Request/Response บน libSQL จริง + migration จริง + นาฬิกา inject (now = 2026-10-18 10:00 BKK)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ICS_IMPORT_MAX_BYTES, ICS_IMPORT_MAX_EVENTS } from '@/lib/calendar';
import { BUSY_MAX_PER_USER, ICS_IMPORT_MAX_BATCH } from '@/lib/shared/limits';
import { Client, dumpAllTables, get, join, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

let h: Harness;
let a: Person;
let b: Person;

beforeEach(async () => {
  h = await setupHarness(); // now = 2026-10-18 10:00 Asia/Bangkok
  a = await person(h, 'alice');
  b = await person(h, 'bob');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

const wrap = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', body, 'END:VCALENDAR'].join('\r\n') + '\r\n';

const SAMPLE_ICS = wrap(
  [
    'BEGIN:VEVENT',
    'SUMMARY:ประชุมลับสุดยอด',
    'DESCRIPTION:ห้ามรั่วลงฐานข้อมูลเด็ดขาด',
    'LOCATION:ห้องลับชั้น 9',
    'ATTENDEE:mailto:secret@example.com',
    'DTSTART;TZID=Asia/Bangkok:20261025T091500',
    'DTEND;TZID=Asia/Bangkok:20261025T104500',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:เที่ยวทะเล',
    'DTSTART;VALUE=DATE:20261028',
    'DTEND;VALUE=DATE:20261030',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:นัดซ้ำทุกจันทร์',
    'DTSTART;TZID=Asia/Bangkok:20261026T090000',
    'DTEND;TZID=Asia/Bangkok:20261026T100000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO',
    'END:VEVENT',
  ].join('\r\n'),
);

type PreviewItem = {
  kind: 'all_day' | 'timed';
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  tz: string;
  title: string | null;
  rounded: boolean;
  duplicate: boolean;
};

type PreviewRes = {
  windowDays: number;
  totalEvents: number;
  skipped: Record<string, number>;
  quota: { used: number; max: number; remaining: number };
  maxImportPerBatch: number;
  items: PreviewItem[];
};

type ConfirmRes = {
  created: number;
  skippedDuplicates: number;
  items: Array<{ id: string; userId: string; title: string | null; note: string | null; hidden: boolean; allDay: boolean; seriesId?: string | null }>;
};

async function seedActive(userId: string, n: number): Promise<void> {
  const base = Date.UTC(2027, 0, 1);
  for (let i = 0; i < n; i += 50) {
    const vals: string[] = [];
    const args: (string | number)[] = [];
    for (let j = i; j < Math.min(n, i + 50); j++) {
      vals.push("(?, ?, 'seed', NULL, 0, ?, ?, '2027-01-01', '2027-01-01', 'Asia/Bangkok', 0, 1, 1)");
      args.push(`seed-${userId}-${j}`, userId, base + j * 1800_000, base + j * 1800_000 + 1800_000);
    }
    await h.rows(
      `INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${vals.join(',')}`,
      args,
    );
  }
}

describe('A2 — RBAC และด่านบัญชี', () => {
  it('anonymous → 401 · suspended → 401 · must_change_pin → 403 ทั้ง preview และ confirm', async () => {
    const anon = new Client();
    const validItem = { kind: 'all_day', startDate: '2026-10-25', endDate: '2026-10-25', title: 'X' };

    expect((await post(anon, '/api/me/busy/import/preview', { icsText: SAMPLE_ICS })).status).toBe(401);
    expect((await post(anon, '/api/me/busy/import', { items: [validItem] })).status).toBe(401);

    // suspended
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [b.id]);
    const susPrev = await post(b.c, '/api/me/busy/import/preview', { icsText: SAMPLE_ICS });
    expect(susPrev.status).toBe(401);
    expect(susPrev.code).toBe('ACCOUNT_SUSPENDED');
    const susConf = await post(b.c, '/api/me/busy/import', { items: [validItem] });
    expect(susConf.status).toBe(401);
    expect(susConf.code).toBe('ACCOUNT_SUSPENDED');

    // must_change_pin
    const c = await person(h, 'charlie');
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [c.id]);
    const pinPrev = await post(c.c, '/api/me/busy/import/preview', { icsText: SAMPLE_ICS });
    expect(pinPrev.status).toBe(403);
    expect(pinPrev.code).toBe('PIN_CHANGE_REQUIRED');
    const pinConf = await post(c.c, '/api/me/busy/import', { items: [validItem] });
    expect(pinConf.status).toBe(403);
    expect(pinConf.code).toBe('PIN_CHANGE_REQUIRED');
  });

  it('SA ส่ง userId แปลกปลอม (mass assignment) ถูกปฏิเสธ 400 และนำเข้าได้เฉพาะของตัวเองเท่านั้น', async () => {
    const sa = await person(h, 'superadmin', { admin: true });
    const bad = await post(sa.c, '/api/me/busy/import', {
      userId: a.id,
      items: [{ kind: 'all_day', startDate: '2026-10-25', endDate: '2026-10-25', title: 'SA' }],
    });
    expect(bad.status).toBe(400);
    expect(bad.code).toBe('VALIDATION');

    const ok = await post<ConfirmRes>(sa.c, '/api/me/busy/import', {
      items: [{ kind: 'all_day', startDate: '2026-10-25', endDate: '2026-10-25', title: 'SA Own' }],
    });
    expect(ok.status).toBe(201);
    expect(ok.data.items[0]!.userId).toBe(sa.id);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(0);
  });
});

describe('A4 + ความเป็นส่วนตัว — Preview → Confirm → กันซ้ำ → hideDetail ไม่รั่วในปฏิทินกลุ่ม', () => {
  it('นำเข้าครบ flow: ปัด 30 นาที, ข้าม RRULE, ดีฟอลต์ hideDetail=true, ไม่เก็บ DESCRIPTION/LOCATION/ATTENDEE และไม่รั่วชื่อให้เพื่อน', async () => {
    const gid = await makeGroup(a, 'ก๊วนเทสต์');
    await join(a, b, gid);

    const prev = await post<PreviewRes>(a.c, '/api/me/busy/import/preview', { icsText: SAMPLE_ICS });
    expect(prev.status).toBe(200);
    expect(prev.headers.get('cache-control')).toBe('private, no-store');
    expect(prev.data.windowDays).toBe(90);
    expect(prev.data.totalEvents).toBe(3);
    expect(prev.data.skipped.rrule).toBe(1);
    expect(prev.data.quota).toEqual({ used: 0, max: BUSY_MAX_PER_USER, remaining: BUSY_MAX_PER_USER });
    expect(prev.data.items).toHaveLength(2);
    expect(prev.data.items[0]).toMatchObject({
      kind: 'timed',
      startDate: '2026-10-25',
      startTime: '09:00',
      endDate: '2026-10-25',
      endTime: '11:00',
      title: 'ประชุมลับสุดยอด',
      rounded: true,
      duplicate: false,
    });
    expect(prev.data.items[1]).toMatchObject({
      kind: 'all_day',
      startDate: '2026-10-28',
      endDate: '2026-10-29',
      title: 'เที่ยวทะเล',
      rounded: false,
      duplicate: false,
    });

    // บันทึกโดยไม่ส่ง hideDetail → ดีฟอลต์ต้องเป็น true (B3)
    const confirmItems = prev.data.items.map(({ kind, startDate, endDate, startTime, endTime, tz, title }) => ({
      kind,
      startDate,
      endDate,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      tz,
      title,
    }));
    const conf = await post<ConfirmRes>(a.c, '/api/me/busy/import', { items: confirmItems });
    expect(conf.status).toBe(201);
    expect(conf.data.created).toBe(2);
    expect(conf.data.skippedDuplicates).toBe(0);
    expect(conf.data.items.every((x) => x.hidden === true && x.note === null)).toBe(true);

    // ตรวจ DB ทั้งหมด: DESCRIPTION / LOCATION / ATTENDEE ต้องไม่มีอยู่ในฐานเลย
    const dump = await dumpAllTables(h);
    expect(dump).not.toContain('ห้ามรั่วลงฐานข้อมูลเด็ดขาด');
    expect(dump).not.toContain('ห้องลับชั้น 9');
    expect(dump).not.toContain('secret@example.com');

    // เพื่อนในกลุ่ม (bob) ดูปฏิทินกลุ่ม → ต้องไม่มีฟิลด์ title/note เลย (BusyHiddenView ตาม ADR 0006)
    const cal = await get<{ busy: Array<{ userId: string; title?: string; note?: string }> }>(
      b.c,
      `/api/groups/${gid}/calendar?from=2026-10-20&to=2026-10-31`,
    );
    expect(cal.status).toBe(200);
    const aliceBlocks = cal.data.busy.filter((x) => x.userId === a.id);
    expect(aliceBlocks).toHaveLength(2);
    expect(aliceBlocks.every((x) => !('title' in x) && !('note' in x))).toBe(true);
    expect(cal.text).not.toContain('ประชุมลับสุดยอด');
    expect(cal.text).not.toContain('เที่ยวทะเล');

    // รอบ 2 นำเข้าไฟล์เดิมซ้ำ → preview ติ๊ก duplicate=true ทุกรายการ และ confirm (skipDuplicates=true) ไม่สร้างแถวเบิ้ล
    const prev2 = await post<PreviewRes>(a.c, '/api/me/busy/import/preview', { icsText: SAMPLE_ICS });
    expect(prev2.status).toBe(200);
    expect(prev2.data.quota.used).toBe(2);
    expect(prev2.data.items.every((x) => x.duplicate === true)).toBe(true);

    const conf2 = await post<ConfirmRes>(a.c, '/api/me/busy/import', { items: confirmItems });
    expect(conf2.status).toBe(201);
    expect(conf2.data.created).toBe(0);
    expect(conf2.data.skippedDuplicates).toBe(2);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(2);
  });
});

describe('A3 — เพดานขนาดไฟล์, เพดาน batch, และการแข่งกันชนเพดาน 300', () => {
  it('ปฏิเสธไฟล์เกิน 512 KB, ไฟล์ binary/ไม่ใช่ .ics, VEVENT เกิน 500 และ batch เกิน 100 รายการ', async () => {
    const tooBig = 'BEGIN:VCALENDAR\r\n' + 'A'.repeat(ICS_IMPORT_MAX_BYTES + 100) + '\r\nEND:VCALENDAR';
    const rBig = await post(a.c, '/api/me/busy/import/preview', { icsText: tooBig });
    expect(rBig.status).toBe(413);
    expect(rBig.code).toBe('ICS_TOO_LARGE');

    // เกินเพดาน JSON body 768 KB ที่ route() wrapper
    const hugeBody = 'BEGIN:VCALENDAR\r\n' + 'A'.repeat(800 * 1024) + '\r\nEND:VCALENDAR';
    const rHuge = await post(a.c, '/api/me/busy/import/preview', { icsText: hugeBody });
    expect(rHuge.status).toBe(413);
    expect(rHuge.code).toBe('ICS_TOO_LARGE');

    const rBin = await post(a.c, '/api/me/busy/import/preview', { icsText: 'BEGIN:VCALENDAR\0END:VCALENDAR' });
    expect(rBin.status).toBe(400);
    expect(rBin.code).toBe('ICS_INVALID');

    const ev = 'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261025\r\nSUMMARY:X\r\nEND:VEVENT\r\n';
    const rMany = await post(a.c, '/api/me/busy/import/preview', { icsText: wrap(ev.repeat(ICS_IMPORT_MAX_EVENTS + 10)) });
    expect(rMany.status).toBe(413);
    expect(rMany.code).toBe('ICS_TOO_LARGE');

    const overBatch = Array.from({ length: ICS_IMPORT_MAX_BATCH + 1 }, () => ({
      kind: 'all_day',
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    }));
    const rBatch = await post(a.c, '/api/me/busy/import', { items: overBatch });
    expect(rBatch.status).toBe(400);
    expect(rBatch.code).toBe('VALIDATION');
  });

  it('แข่งกันนำเข้า 2 คำขอพร้อมกันใกล้เพดาน 300 → ผ่านได้ไม่เกิน 300 แถว และคำขอที่เกินตกทั้งก้อน (LIMIT_REACHED)', async () => {
    await seedActive(a.id, 295);

    const makeBatch = (dayOffset: number) =>
      Array.from({ length: 4 }, (_, i) => ({
        kind: 'all_day' as const,
        startDate: `2026-11-${String(dayOffset + i).padStart(2, '0')}`,
        endDate: `2026-11-${String(dayOffset + i).padStart(2, '0')}`,
        title: `Race ${dayOffset}-${i}`,
      }));

    const [r1, r2] = await Promise.all([
      post<ConfirmRes>(a.c, '/api/me/busy/import', { items: makeBatch(1) }),
      post<ConfirmRes>(a.c, '/api/me/busy/import', { items: makeBatch(10) }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const failed = r1.status === 409 ? r1 : r2;
    expect(failed.code).toBe('LIMIT_REACHED');
    expect(failed.json.error?.params).toEqual({ limit: 'busyCount', max: BUSY_MAX_PER_USER });

    // ยืนยันจำนวนแถวใน DB = 299 (ไม่เกิน 300 และไม่มีแถวหลุดครึ่งก้อน)
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(299);
  });
});

describe('A5 — Rate Limit (429 + Retry-After) และไม่ log เนื้อหา .ics', () => {
  it('confirm เกิน 10 ครั้ง/10 นาที → 429 RATE_LIMITED + Retry-After · preview แยกถัง (20 ครั้ง/10 นาที)', async () => {
    // ยิง preview 20 ครั้ง → ผ่านทั้งหมด · ครั้งที่ 21 → 429
    for (let i = 0; i < 20; i++) {
      const r = await post(a.c, '/api/me/busy/import/preview', { icsText: SAMPLE_ICS });
      expect(r.status, `preview #${i + 1}`).toBe(200);
    }
    const prev21 = await post(a.c, '/api/me/busy/import/preview', { icsText: SAMPLE_ICS });
    expect(prev21.status).toBe(429);
    expect(prev21.code).toBe('RATE_LIMITED');
    expect(Number(prev21.headers.get('retry-after'))).toBeGreaterThan(0);

    // ถัง confirm แยกจาก preview → ยังยิงได้ครบ 10 ครั้ง · ครั้งที่ 11 → 429
    for (let i = 0; i < 10; i++) {
      const d = `2026-11-${String(1 + i).padStart(2, '0')}`;
      const r = await post(a.c, '/api/me/busy/import', { items: [{ kind: 'all_day', startDate: d, endDate: d }] });
      expect(r.status, `confirm #${i + 1}`).toBe(201);
    }
    const conf11 = await post(a.c, '/api/me/busy/import', {
      items: [{ kind: 'all_day', startDate: '2026-11-20', endDate: '2026-11-20' }],
    });
    expect(conf11.status).toBe(429);
    expect(conf11.code).toBe('RATE_LIMITED');
    expect(Number(conf11.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('ไม่ log เนื้อหา .ics หรือ SUMMARY ลง console ทั้งกรณีปกติและ error', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const secretSummary = 'TOP_SECRET_ICS_TITLE_98765';
    const secretIcs = wrap(`BEGIN:VEVENT\r\nSUMMARY:${secretSummary}\r\nDTSTART;VALUE=DATE:20261025\r\nEND:VEVENT`);

    await post(a.c, '/api/me/busy/import/preview', { icsText: secretIcs });
    await post(a.c, '/api/me/busy/import/preview', { icsText: `NOT_ICS_${secretSummary}` });
    await post(a.c, '/api/me/busy/import', { items: [{ kind: 'all_day', startDate: '2026-10-25', endDate: '2026-10-25', title: secretSummary }] });

    const allLogged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join('\n');
    expect(allLogged).not.toContain(secretSummary);
    expect(allLogged).not.toContain('BEGIN:VCALENDAR');
  });
});
