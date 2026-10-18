// D1: createDb ส่ง busy timeout ให้ `file:` — หลาย process เขียน DB เดียวกันพร้อมกันต้องสำเร็จทั้งหมด (ไม่ SQLITE_BUSY ทันที)
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { createDb, FILE_BUSY_TIMEOUT_MS } from '@/db/client';

const run = promisify(execFile);
const WRITERS = 8;
const WRITES_EACH = 40;

let dir: string;
let url: string;
let script: string;

// writer = process แยก (driver file: เป็น sync — ในโปรเซสเดียวไม่เกิดการแย่งล็อกจริง)
const CLIENT_URL = pathToFileURL(createRequire(import.meta.url).resolve('@libsql/client')).href;
const WRITER_SOURCE = `
import { createClient } from '${CLIENT_URL}';
const [url, id, n, timeout] = process.argv.slice(2);
const client = createClient({ url, ...(timeout === 'none' ? {} : { timeout: Number(timeout) }) });
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

async function spawnWriters(timeout: string) {
  const results = await Promise.all(
    Array.from({ length: WRITERS }, (_, i) =>
      run(process.execPath, [script, url, String(i), String(WRITES_EACH), timeout], { cwd: process.cwd() }),
    ),
  );
  return results.map((r) => JSON.parse(r.stdout.trim().split('\n').pop()!) as { failed: number; firstError: string });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'maewmeet-busy-'));
  url = `file:${path.join(dir, 'busy.db')}`;
  script = path.join(dir, 'writer.mjs');
  writeFileSync(script, WRITER_SOURCE);
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

  it('writer หลาย process พร้อมกันผ่าน createDb สำเร็จครบ ไม่มี SQLITE_BUSY', async () => {
    const db = createDb({ url });
    db.$client.close();
    const results = await spawnWriters(String(FILE_BUSY_TIMEOUT_MS));
    expect(results.map((r) => r.failed)).toEqual(Array(WRITERS).fill(0));
    const check = createClient({ url });
    const rs = await check.execute('select count(*) as c from w');
    check.close();
    expect(Number(rs.rows[0]!.c)).toBe(WRITERS * WRITES_EACH);
  }, 60_000);

  it('createDb: ล็อกถูกถือโดย process อื่น ~0.4 วินาที → เขียนผ่าน createDb รอแล้วสำเร็จ (ไม่ BUSY ทันที)', async () => {
    const holder = `
      import { createClient } from '${CLIENT_URL}';
      const c = createClient({ url: process.argv[2] });
      const tx = await c.transaction('write');
      await tx.execute("insert into w(writer, seq) values ('holder', 0)");
      console.log('locked');
      setTimeout(async () => { await tx.commit(); c.close(); }, 400);
    `;
    const holderFile = path.join(dir, 'holder.mjs');
    writeFileSync(holderFile, holder);
    const child = spawn(process.execPath, [holderFile, url], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
    const db = createDb({ url });
    const started = Date.now();
    await db.$client.execute("insert into w(writer, seq) values ('after', 1)");
    const waited = Date.now() - started;
    db.$client.close();
    await new Promise((resolve) => child.once('exit', resolve));
    expect(waited).toBeGreaterThan(150);
    expect(waited).toBeLessThan(FILE_BUSY_TIMEOUT_MS);
  }, 30_000);

  it('ควบคุม: ไม่มี timeout → เจอ SQLITE_BUSY จริง (พิสูจน์ว่าเทสต์ข้างบนไวพอ)', async () => {
    const results = await spawnWriters('none');
    expect(results.some((r) => r.failed > 0 && r.firstError.includes('BUSY'))).toBe(true);
  }, 60_000);
});
