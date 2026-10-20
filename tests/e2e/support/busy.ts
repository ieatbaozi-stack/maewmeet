// ตัวช่วย E2E ของ R3 (busy + ปฏิทินกลุ่ม) — ตั้งฉากผ่าน API/DB ส่วนที่ไม่ใช่เป้าหมายของเทสต์ · ท่าทางหลักใช้ UI จริง
//
// นาฬิกา: `next start` เป็นโปรเซสแยก ไม่มี hook ปรับเวลาจากภายนอก (ดู auth.ts) → "วันนี้" ของแอป = เวลาจริง
//   เทสต์จึงใช้ **วันที่สัมพัทธ์กับวันนี้ (Asia/Bangkok)** เท่านั้น ไม่ hard-code วันที่ — คำนวณด้วย Intl + Date.UTC (tests/** ได้รับยกเว้นกฎ new Date)
//   เคสที่ต้องใช้เวลาจำลอง (DST, ขอบเที่ยงคืน, ย้อนหลังตามนาฬิกา inject) อยู่ที่ tests/busy/** + tests/calendar/** แล้ว
import { createClient, type Client } from '@libsql/client';
import type { APIRequestContext, Page, Response } from '@playwright/test';
import { E2E_DATABASE_URL } from './env';
import { api } from './groups';

export type DateISO = string; // YYYY-MM-DD
const TZ = 'Asia/Bangkok';

// ───────── วันที่ (pure) ─────────
const ymd = (ms: number): DateISO => new Date(ms).toISOString().slice(0, 10);
const utcMs = (d: DateISO): number => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y!, m! - 1, day!);
};

/** วันนี้ใน Asia/Bangkok (วันที่ท้องถิ่น ไม่ใช่ UTC) */
export function todayBkk(): DateISO {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());
}
export const addDays = (d: DateISO, n: number): DateISO => ymd(utcMs(d) + n * 86_400_000);
/** 0 = จันทร์ … 6 = อาทิตย์ (ISO) */
export const isoWeekday = (d: DateISO): number => (new Date(utcMs(d)).getUTCDay() + 6) % 7;
export const monthOf = (d: DateISO): string => d.slice(0, 7); // YYYY-MM
export const addMonths = (ym: string, n: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const t = (y! * 12 + (m! - 1)) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
export const daysInMonth = (ym: string): number => {
  const next = addMonths(ym, 1);
  return (utcMs(`${next}-01`) - utcMs(`${ym}-01`)) / 86_400_000;
};
/** จำนวนสัปดาห์ (แถว) ของตารางเดือนที่เริ่มจันทร์ — 4, 5 หรือ 6 */
export const weeksInMonthGrid = (ym: string): number => Math.ceil((isoWeekday(`${ym}-01`) + daysInMonth(ym)) / 7);
/** เดือนแรกที่ ≥ from ซึ่งตารางมี `weeks` แถว (ค้นภายใน 24 เดือน) */
export function nextMonthWithWeeks(from: string, weeks: 4 | 5 | 6): string {
  for (let i = 0; i < 24; i++) if (weeksInMonthGrid(addMonths(from, i)) === weeks) return addMonths(from, i);
  throw new Error(`ไม่พบเดือนที่มี ${weeks} สัปดาห์`);
}

/** ปีพุทธศักราช (ภาษาไทยแสดง พ.ศ.) */
export const buddhistYear = (ym: string): number => Number(ym.slice(0, 4)) + 543;

// ───────── DB (ไฟล์เดียวกับเซิร์ฟเวอร์) ─────────
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

/**
 * ใส่ busy ที่ "ยังไม่สิ้นสุด" ให้ผู้ใช้ n รายการด้วย SQL เดียว (ไม่ผ่าน API — 300 ครั้งผ่าน HTTP ช้าและกิน rate limit)
 * ใช้ครึ่งชั่วโมงถัด ๆ ไปในอนาคตไกล (ปีหน้า+) เพื่อไม่ชนข้อมูลที่เทสต์อื่นดู — title ไม่ซ้ำกับของจริง
 */
export async function seedBusyBulk(userId: string, n: number, titlePrefix = 'e2e-bulk'): Promise<void> {
  const start = Date.UTC(Number(todayBkk().slice(0, 4)) + 2, 0, 1); // ต้นปี +2 UTC — อยู่ในอนาคตเสมอ
  const date = ymd(start);
  for (let i = 0; i < n; i += 100) {
    const vals: string[] = [];
    const args: (string | number)[] = [];
    for (let j = i; j < Math.min(n, i + 100); j++) {
      vals.push(`(?, ?, ?, NULL, 0, ?, ?, '${date}', '${date}', '${TZ}', 0, 1, 1)`);
      args.push(`${titlePrefix}-${userId}-${j}`, userId, `${titlePrefix} ${j}`, start + j * 1800_000, start + (j + 1) * 1800_000);
    }
    await withBusyRetry(() =>
      db().execute({
        sql: `INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${vals.join(',')}`,
        args,
      }),
    );
  }
}

export async function countBusyRows(userId: string): Promise<number> {
  const r = await withBusyRetry(() => db().execute({ sql: 'SELECT COUNT(*) AS n FROM busy_block WHERE user_id = ?', args: [userId] }));
  return Number((r.rows[0] as unknown as { n: number }).n);
}

// ───────── API ─────────
export type BusyInput =
  | { kind: 'all_day'; startDate: DateISO; endDate: DateISO; title?: string; note?: string; hideDetail?: boolean }
  | { kind: 'timed'; startDate: DateISO; startTime: string; endDate: DateISO; endTime: string; title?: string; note?: string; hideDetail?: boolean };

export async function createBusyApi(request: APIRequestContext, body: BusyInput): Promise<string> {
  const r = await api(request, 'POST', '/api/me/busy', body);
  if (r.status !== 201) throw new Error(`create busy: ${r.status} ${r.text}`);
  return (JSON.parse(r.text) as { data: { busy: { id: string } } }).data.busy.id;
}

export async function calendarApi(request: APIRequestContext, gid: string, from: DateISO, to: DateISO) {
  return api(request, 'GET', `/api/groups/${gid}/calendar?from=${from}&to=${to}`);
}

// ───────── canary: ไม่พบ note ของ A ในหน้า/ response ใด ๆ ของ B ─────────
/** เก็บ body ของทุก response ที่เป็นข้อความ (HTML/JSON/RSC/JS) ระหว่างที่ B เปิดหน้า */
export function recordResponses(page: Page): { texts: string[]; urls: string[] } {
  const rec = { texts: [] as string[], urls: [] as string[] };
  page.on('response', (res: Response) => {
    const ct = res.headers()['content-type'] ?? '';
    if (!/json|text|javascript|x-component/i.test(ct)) return;
    rec.urls.push(res.url());
    res.text().then(
      (t) => rec.texts.push(t),
      () => undefined, // body หมดอายุเพราะ navigate — ไม่ใช่ปัญหา
    );
  });
  return rec;
}

/** สตริง canary ที่ไม่ซ้ำต่อเทสต์ (ไม่ซ้ำกับ note ของเทสต์อื่นที่รันขนาน) */
export const canary = (tag: string): string => `CANARY-${tag}-${Math.random().toString(36).slice(2, 10)}`;
