// R0-15: .github/scripts/keepalive.sh กับ server จำลองในเครื่อง — exit code ทุกกรณี + ไม่พิมพ์ CRON_SECRET
// ต้องมี bash + curl + jq (มีใน ubuntu runner ของ GitHub) — ถ้าไม่มีจะข้ามพร้อมเหตุผล
import { execFile, spawnSync, type ExecFileException } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '../../.github/scripts/keepalive.sh');
const SECRET = `ka-${randomBytes(12).toString('hex')}`;
const hasTools = ['bash', 'curl', 'jq'].every((bin) => spawnSync('which', [bin]).status === 0);

type Scenario = { hbStatus?: number; health: [number, unknown] };

const health = (vercelCron: number | null, extra: Record<string, unknown> = {}) => ({
  ok: true,
  version: '0.0.0',
  node: 'v24.0.0',
  argon2: true,
  db: true,
  heartbeatAgeHours: { vercelCron, githubActions: 0.01 },
  ...extra,
});

const SCENARIOS: Record<string, Scenario> = {
  ok: { health: [200, health(5.25)] },
  hb401: { hbStatus: 401, health: [200, health(1)] },
  hb500: { hbStatus: 500, health: [200, health(1)] },
  health503: { health: [503, health(1, { ok: false, db: false })] },
  cron49: { health: [200, health(49)] },
  cron48: { health: [200, health(48)] },
  cronNull: { health: [200, health(null)] },
  notJson: { health: [200, '<html>oops</html>'] },
  wrapped: { health: [200, { data: health(2) }] },
  redirect: { health: [302, ''] },
};

const servers: http.Server[] = [];
const origin: Record<string, string> = {};
let deadOrigin = '';

function listen(sc: Scenario): Promise<string> {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/cron/heartbeat') {
      const status = sc.hbStatus ?? (req.headers.authorization === `Bearer ${SECRET}` ? 200 : 401);
      res.writeHead(status, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    if (req.method === 'GET' && req.url === '/api/health') {
      const [status, body] = sc.health;
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(status, status === 302 ? { location: 'https://example.invalid/' } : { 'content-type': 'application/json' }).end(text);
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

function run(env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      [SCRIPT],
      {
        encoding: 'utf8',
        // env สะอาด (ไม่ส่ง secret อื่นของเครื่องให้สคริปต์) · NODE_ENV ใส่เพราะ next ทำให้เป็นฟิลด์บังคับใน ProcessEnv
        env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', KEEPALIVE_RETRY_DELAY: '1', ...env },
      },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        const code = err === null ? 0 : typeof err.code === 'number' ? err.code : -1;
        resolve({ code, out: `${stdout}${stderr}` });
      },
    );
  });
}

beforeAll(async () => {
  if (!hasTools) return;
  for (const [name, sc] of Object.entries(SCENARIOS)) origin[name] = await listen(sc);
  // พอร์ตที่ปิดไปแล้ว = server ล่ม
  const tmp = http.createServer();
  await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', () => r()));
  deadOrigin = `http://127.0.0.1:${(tmp.address() as AddressInfo).port}`;
  await new Promise<void>((r) => tmp.close(() => r()));
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe.skipIf(!hasTools)('keepalive.sh (server จำลอง)', () => {
  const cases: [label: string, env: () => Record<string, string>, expected: number, expectOut?: RegExp][] = [
    ['ยังไม่ตั้ง secret ทั้งคู่ → ข้าม', () => ({}), 0, /::warning/],
    ['ไม่มี CRON_SECRET → ข้าม', () => ({ APP_ORIGIN: origin.ok! }), 0, /CRON_SECRET/],
    ['ปกติ', () => ({ APP_ORIGIN: origin.ok!, CRON_SECRET: SECRET }), 0, /vercelCron=5\.25/],
    ['APP_ORIGIN มี / ท้าย', () => ({ APP_ORIGIN: `${origin.ok!}/`, CRON_SECRET: SECRET }), 0],
    ['secret ผิด → heartbeat 401', () => ({ APP_ORIGIN: origin.ok!, CRON_SECRET: 'wrong-secret-000000' }), 1, /HTTP 401/],
    ['heartbeat 401', () => ({ APP_ORIGIN: origin.hb401!, CRON_SECRET: SECRET }), 1, /HTTP 401/],
    ['heartbeat 500', () => ({ APP_ORIGIN: origin.hb500!, CRON_SECRET: SECRET }), 1, /HTTP 500/],
    ['health 503', () => ({ APP_ORIGIN: origin.health503!, CRON_SECRET: SECRET }), 1, /HTTP 503/],
    ['vercelCron 49 ชม.', () => ({ APP_ORIGIN: origin.cron49!, CRON_SECRET: SECRET }), 1, /49/],
    ['vercelCron 48 ชม. พอดี (≤ 48 ผ่าน)', () => ({ APP_ORIGIN: origin.cron48!, CRON_SECRET: SECRET }), 0],
    ['vercelCron 48 ชม. กับ MAX=24', () => ({ APP_ORIGIN: origin.cron48!, CRON_SECRET: SECRET, MAX_VERCEL_CRON_AGE_HOURS: '24' }), 1],
    ['vercelCron null (cron ยังไม่เคยรัน)', () => ({ APP_ORIGIN: origin.cronNull!, CRON_SECRET: SECRET }), 1, /null/],
    ['health ไม่ใช่ JSON', () => ({ APP_ORIGIN: origin.notJson!, CRON_SECRET: SECRET }), 1],
    ['health ห่อ {data} ก็อ่านได้', () => ({ APP_ORIGIN: origin.wrapped!, CRON_SECRET: SECRET }), 0],
    ['health 302 (ไม่ตาม redirect)', () => ({ APP_ORIGIN: origin.redirect!, CRON_SECRET: SECRET }), 1, /HTTP 302/],
    ['server ล่ม', () => ({ APP_ORIGIN: deadOrigin, CRON_SECRET: SECRET }), 1, /HTTP 000/],
    ['APP_ORIGIN มี path', () => ({ APP_ORIGIN: `${origin.ok!}/app`, CRON_SECRET: SECRET }), 1, /origin/],
  ];

  it.each(cases)('%s → exit %i', async (_label, env, expected, expectOut) => {
    const { code, out } = await run(env());
    expect(code, out).toBe(expected);
    if (expectOut) expect(out).toMatch(expectOut);
    expect(out).not.toContain(SECRET);
  });
});

describe('keepalive.sh — เงื่อนไขทดสอบ', () => {
  it('มี bash/curl/jq ใน CI (ถ้าข้ามบนเครื่องอื่นได้ แต่ใน CI ต้องรันจริง)', () => {
    if (process.env.CI === 'true') expect(hasTools).toBe(true);
  });
});
