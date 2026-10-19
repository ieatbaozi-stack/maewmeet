// R0-3 — กฎ ESLint ของโปรเจกต์ทำงานจริง (eslint.config.mjs)
// lint "ข้อความโค้ดจำลอง" ผ่าน ESLint Node API ด้วย filePath สมมติ (ไฟล์ไม่ต้องมีจริง ไม่เขียนลงดิสก์)
// ใช้ config จริงของ repo — ถ้าใครแก้ eslint.config.mjs จนกฎหาย เทสต์นี้ล้ม
import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');

let eslint: ESLint;
beforeAll(async () => {
  eslint = new ESLint({ cwd: ROOT });
  // R1 TEST: lint ครั้งแรกโหลด eslint.config.mjs + plugin ทั้งหมด (~1.4s ปกติ, เกิน 5s ตอน CPU ถูกแย่งหนัก — วัดได้จริงใน stress run)
  // warm-up ใน beforeAll (hookTimeout 30s) แทนให้เทสต์แรกแบกต้นทุน cold start
  await eslint.lintText('export {};\n', { filePath: path.join(ROOT, 'src/app/warmup.ts') });
}, 30_000);

type Msg = { ruleId: string | null; message: string; severity: number };

async function lint(relPath: string, code: string): Promise<Msg[]> {
  const filePath = path.join(ROOT, relPath);
  // กันกรณีไฟล์สมมติตกอยู่ใน globalIgnores — ถ้าถูก ignore ผลจะ "ผ่าน" แบบหลอก
  expect(await eslint.isPathIgnored(filePath), `${relPath} ต้องไม่ถูก ignore`).toBe(false);
  const [result] = await eslint.lintText(code, { filePath });
  expect(result).toBeDefined();
  return result!.messages.filter((m) => m.severity === 2);
}

const ruleIds = (msgs: Msg[]) => msgs.map((m) => m.ruleId);

const NEW_DATE = 'export const now = () => new Date();\n';
const TEMPORAL_IMPORT = "import { Temporal } from 'temporal-polyfill';\nexport const today = () => Temporal.Now.plainDateISO();\n";
const TEMPORAL_SUBPATH = "import 'temporal-polyfill/global';\nexport {};\n";
const REPO_IMPORTS_APP = "import Page from '@/app/page';\nexport const x = Page;\n";
const REPO_IMPORTS_APP_RELATIVE = "import Page from '../../../app/page';\nexport const x = Page;\n";

describe('R0-3 กฎ ESLint — กรณีที่ต้องล้ม', () => {
  it('new Date( ใน src/app/x.ts → no-restricted-syntax', async () => {
    const msgs = await lint('src/app/x.ts', NEW_DATE);
    expect(ruleIds(msgs)).toContain('no-restricted-syntax');
    expect(msgs.find((m) => m.ruleId === 'no-restricted-syntax')!.message).toMatch(/new Date/);
  });

  it('new Date( ใน src/components/x.tsx ก็ล้ม (ไม่ใช่เฉพาะ src/app)', async () => {
    expect(ruleIds(await lint('src/components/x.tsx', NEW_DATE))).toContain('no-restricted-syntax');
  });

  it('import temporal-polyfill ใน src/app/x.ts → no-restricted-imports', async () => {
    const msgs = await lint('src/app/x.ts', TEMPORAL_IMPORT);
    expect(ruleIds(msgs)).toContain('no-restricted-imports');
    expect(msgs.find((m) => m.ruleId === 'no-restricted-imports')!.message).toMatch(/temporal-polyfill/);
  });

  it('import temporal-polyfill/<subpath> ใน src/lib/shared/x.ts → no-restricted-imports', async () => {
    expect(ruleIds(await lint('src/lib/shared/x.ts', TEMPORAL_SUBPATH))).toContain('no-restricted-imports');
  });

  it('repo ใน src/lib/data/repos/x.ts import @/app/page → no-restricted-imports', async () => {
    const msgs = await lint('src/lib/data/repos/x.ts', REPO_IMPORTS_APP);
    expect(ruleIds(msgs)).toContain('no-restricted-imports');
    expect(msgs.find((m) => m.ruleId === 'no-restricted-imports')!.message).toMatch(/repos/);
  });

  it('repo import src/app ด้วย path สัมพัทธ์ก็ล้ม', async () => {
    expect(ruleIds(await lint('src/lib/data/repos/x.ts', REPO_IMPORTS_APP_RELATIVE))).toContain('no-restricted-imports');
  });

  it('repo ยังโดนกฎ temporal-polyfill (config ข้อ 3 ไม่ทับกฎข้อ 1 จนหาย)', async () => {
    expect(ruleIds(await lint('src/lib/data/repos/x.ts', TEMPORAL_IMPORT))).toContain('no-restricted-imports');
  });
});

describe('R0-3 กฎ ESLint — กรณีที่ต้องผ่าน', () => {
  it('src/lib/calendar/x.ts ใช้ new Date( และ temporal-polyfill ได้', async () => {
    expect(await lint('src/lib/calendar/x.ts', NEW_DATE + TEMPORAL_IMPORT.replace('export const today', 'export const today2'))).toEqual([]);
  });

  it('tests/x.ts ใช้ new Date( และ temporal-polyfill ได้', async () => {
    expect(await lint('tests/x.ts', NEW_DATE)).toEqual([]);
    expect(await lint('tests/x.ts', TEMPORAL_IMPORT)).toEqual([]);
  });

  it('ไฟล์นอก repos import @/app ได้ (กฎ repo ไม่ลามไปที่อื่น)', async () => {
    expect(ruleIds(await lint('src/lib/data/services/x.ts', REPO_IMPORTS_APP))).not.toContain('no-restricted-imports');
  });
});
