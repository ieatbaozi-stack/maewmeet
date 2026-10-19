// D1: createDb ส่ง busy timeout ให้ `file:` — ต้องรอล็อกของ process อื่นแทนตอบ SQLITE_BUSY ทันที
//
// ทำไมเทสต์เดิมไม่นิ่งเมื่อรันทั้งชุด (root cause): เทสต์ "writer หลาย process" ใช้ 8 process × 40 ธุรกรรมเขียนไฟล์เดียวกันและตัดสินผ่าน/ตกจาก
// "ไม่มี writer ใดรอล็อกเกิน FILE_BUSY_TIMEOUT_MS (1000ms)" — busy handler ของ SQLite เป็นแบบ sleep+retry ไม่เป็นธรรม (ไม่ใช่คิว)
// เมื่อเครื่องกำลังรัน vitest หลาย worker (argon2, next build ฯลฯ) writer ที่ถูกแย่งซ้ำ ๆ หรือถูก OS พักเกิน 1 วินาทีจึงได้ BUSY ได้
// = ผลขึ้นกับโหลดของเครื่อง ไม่ใช่ความถูกต้องของโค้ด · แก้: แยกสิ่งที่ต้องพิสูจน์ออกเป็นเทสต์ที่ไม่ขึ้นกับเวลา/โหลด
//   (1) createDb ส่ง option timeout จริง → ตรวจที่อาร์กิวเมนต์ของ createClient (mock) ไม่ต้องมีการแข่งขัน
//   (2) timeout มีผลจริง → ให้ process อื่น "ถือล็อกไว้จนกว่าจะถูกสั่งเลิก" แล้วดูว่า createDb รอ ≥ ~timeout แล้วค่อย BUSY (ขอบล่างของเวลารอไม่ขึ้นกับโหลด)
//       และ client ที่ไม่มี timeout ได้ BUSY (ควบคุม)
//   (3) การเขียนหลาย process ชนกันจริงยังมี แต่ writer ใช้ timeout ที่ระบุชัดต่อเทสต์ (ยาวกว่าค่าเริ่มต้นมาก) และงานน้อยลง — พิสูจน์เฉพาะ "ไม่มีเขียนหาย/ไม่ล็อกค้าง"
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { createDb, FILE_BUSY_TIMEOUT_MS } from '@/db/client';

// ห่อ createClient ให้ตรวจอาร์กิวเมนต์ได้ (ทำงานจริงเหมือนเดิม)
vi.mock('@libsql/client', async (importOriginal) => {
  const m = await importOriginal<typeof import('@libsql/client')>();
  return { ...m, createClient: vi.fn(m.createClient) };
});

const run = promisify(execFile);
const WRITERS = 4;
const WRITES_EACH = 15;
/** timeout ของ writer ใน (3): ระบุชัดต่อเทสต์ ยาวพอที่ไม่ขึ้นกับโหลดเครื่อง (ไม่ใช่ค่าของแอป — แอปใช้ FILE_BUSY_TIMEOUT_MS) */
const WRITER_TIMEOUT_MS = Number(process.env.MAEWMEET_TEST_WRITER_TIMEOUT_MS || 30_000);

let dir: string;
let url: string;
let writerScript: string;
let holderScript: string;

const CLIENT_URL = pathToFileURL(createRequire(import.meta.url).resolve('@libsql/client')).href;
// writer = process แยก (driver file: เป็น sync — ในโปรเซสเดียวไม่เกิดการแย่งล็อกจริง)
const WRITER_SOURCE = `
import { createClient } from '${CLIENT_URL}';
const [url, id, n, timeout] = process.argv.slice(2);
const client = createClient({ url, timeout: Number(timeout) });
let failed = 0, firstError = '';
for (let i = 0; i < Number(n); i++) {
  try {
    const tx = await client.transaction('write');
    await tx.execute({ sql: 'insert into w(writer, seq) values (?, ?)', args: [id, i] });
    await tx.commit();
  } catch (e) { failed++; firstError ||= String(e.code ?? e.message); }
}
client.close();
console.log(JSON.stringify({ failed, firstError }));
`;
// holder = ถือล็อกเขียนไว้จนกว่าจะถูกฆ่า (ไม่มีตัวจับเวลา → ไม่ขึ้นกับโหลด)
const HOLDER_SOURCE = `
import { createClient } from '${CLIENT_URL}';
const c = createClient({ url: process.argv[2] });
const tx = await c.transaction('write');
await tx.execute("insert into w(writer, seq) values ('holder', 0)");
console.log('locked');
setInterval(() => {}, 1 << 30);
`;

async function withHolder<T>(fn: () => Promise<T> | T): Promise<T> {
  const child: ChildProcess = spawn(process.execPath, [holderScript, url], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout!.once('data', () => resolve());
      child.once('exit', () => reject(new Error('holder exited before locking')));
    });
    return await fn();
  } finally {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'maewmeet-busy-'));
  url = `file:${path.join(dir, 'busy.db')}`;
  writerScript = path.join(dir, 'writer.mjs');
  holderScript = path.join(dir, 'holder.mjs');
  writeFileSync(writerScript, WRITER_SOURCE);
  writeFileSync(holderScript, HOLDER_SOURCE);
  const setup = createClient({ url });
  await setup.execute('create table w(writer text, seq integer)');
  setup.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('createDb busy timeout (file:)', () => {
  it('ค่าเริ่มต้นเป็นมิลลิวินาทีที่สมเหตุสมผล', () => {
    expect(FILE_BUSY_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(FILE_BUSY_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });

  it('(1) createDb ส่ง timeout = FILE_BUSY_TIMEOUT_MS ให้ createClient เฉพาะ file: (ตรวจอาร์กิวเมนต์ ไม่ขึ้นกับเวลา/โหลด)', () => {
    const spy = vi.mocked(createClient);
    spy.mockClear();
    createDb({ url }).$client.close();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ url, timeout: FILE_BUSY_TIMEOUT_MS });
    spy.mockClear();
    createDb({ url: 'libsql://example.turso.io', authToken: 'x' }).$client.close();
    expect(spy.mock.calls[0]![0]).not.toHaveProperty('timeout'); // remote ไม่ใช้ busy timeout
  });

  it('(2) timeout มีผลจริง: ล็อกถูกถือไว้ไม่ปล่อย → createDb รอ ≈ timeout แล้วจึง BUSY · client ที่ไม่ตั้ง timeout ได้ BUSY ทันที', async () => {
    await withHolder(async () => {
      const bare = createClient({ url }); // ควบคุม: ไม่มี timeout (ค่าเริ่มต้นของ driver = 0)
      const bareErr = await bare.execute("insert into w(writer, seq) values ('bare', 1)").then(() => null, (e: unknown) => e);
      bare.close();
      expect(String((bareErr as { code?: unknown } | null)?.code ?? bareErr)).toMatch(/BUSY/);

      const db = createDb({ url });
      const started = Date.now();
      const err = await db.$client.execute("insert into w(writer, seq) values ('after', 1)").then(() => null, (e: unknown) => e);
      const waited = Date.now() - started;
      db.$client.close();
      expect(String((err as { code?: unknown } | null)?.code ?? err)).toMatch(/BUSY/);
      // ขอบล่างของเวลารอไม่ขึ้นกับโหลด (โหลดหนักทำให้นานขึ้นได้ แต่ไม่ทำให้สั้นลง) · เผื่อความละเอียดของนาฬิกา 10%
      expect(waited).toBeGreaterThanOrEqual(FILE_BUSY_TIMEOUT_MS * 0.9);
    });
  }, 60_000);

  it('(3) writer หลาย process ชนกันจริง: ใช้ timeout ที่ระบุต่อเทสต์ → เขียนสำเร็จครบ ไม่มี BUSY ไม่ล็อกค้าง', async () => {
    const results = await Promise.all(
      Array.from({ length: WRITERS }, (_, i) =>
        run(process.execPath, [writerScript, url, String(i), String(WRITES_EACH), String(WRITER_TIMEOUT_MS)], { cwd: process.cwd() }),
      ),
    );
    const parsed = results.map((r) => JSON.parse(r.stdout.trim().split('\n').pop()!) as { failed: number; firstError: string });
    expect(parsed.map((r) => r.failed)).toEqual(Array(WRITERS).fill(0));
    const check = createClient({ url });
    const rs = await check.execute('select count(*) as c from w'); // ธุรกรรมของ holder ไม่เคย commit · bare/after ล้มก่อนเขียน
    check.close();
    expect(Number(rs.rows[0]!.c)).toBe(WRITERS * WRITES_EACH);
  }, 120_000);
});
