// Playwright — เจ้าของ: TEST (#11) · R0_CONTRACT R0-10, R0-11, R0-12, R0-16 · PROCESS.md เกต E2E มือถือ
//
// รัน: npm run build && npm run test:e2e
// - เบราว์เซอร์: Chromium ของ Playwright (CI: `npx playwright install --with-deps chromium`)
//   เครื่องที่ไม่มี build ตรงรุ่น → ตั้ง PW_CHROMIUM_PATH=/path/to/chromium (ห้ามใช้ใน CI)
// - เซิร์ฟเวอร์: `next start` (production build) · พอร์ต E2E_PORT (ดีฟอลต์ 3000 = APP_ORIGIN ของ .github/scripts/ci-env.sh)
//   ในเครื่องใช้ server ที่รันอยู่แล้วได้ (reuseExistingServer) · CI สตาร์ตใหม่เสมอ
// - DB: TURSO_DATABASE_URL จาก env ถ้ามี (CI ตั้งเป็น file: ใน runner) ไม่งั้น file: ชั่วคราวใน tmpdir
//   globalSetup apply migration (drizzle/) ก่อนเทสต์แรก — webServer ตรวจความพร้อมที่ /login (ไม่แตะ DB)
// - R1: เซิร์ฟเวอร์ได้ pepper ทดสอบ (CI: PIN_PEPPER_V1 จาก ci-env.sh · เครื่อง: ค่าตายตัวที่ไม่ใช่ความลับ) · เทสต์สมัครผู้ใช้สุ่มต่อเทสต์ผ่าน API
//   และใช้ x-real-ip สมมติต่อเทสต์เพื่อไม่ชน rate limit ต่อ IP (ดู tests/e2e/support/auth.ts)
// - ภาพหน้าจอทุกหน้า × ภาษา × ธีม → test-results/ (+ แนบใน playwright-report/) = artifact ของ CI
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { e2eServerEnv, E2E_BASE_URL, E2E_PORT } from './tests/e2e/support/env';

const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const isCI = !!process.env.CI;

/** มือถือ/แท็บเล็ตแบบ touch — R0-12: 375 / 390 / 768 */
const touch = { isMobile: true, hasTouch: true, browserName: 'chromium' as const };

const projects: PlaywrightTestConfig['projects'] = [
  { name: 'mobile-375', use: { ...touch, viewport: { width: 375, height: 812 }, deviceScaleFactor: 3 } },
  { name: 'mobile-390', use: { ...touch, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 } },
  { name: 'tablet-768', use: { ...touch, viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2 } },
];

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  // 2 รอบ: DB ไฟล์ของ E2E ไม่มี busy timeout ฝั่งแอป (src/db/client.ts ไม่ส่ง `timeout` ให้ createClient) → การเขียนซ้อนกันของหลาย worker
  // ตอบ 500 เป็นครั้งคราว (Handoff D1) · ลดเหลือ 1 (CI)/0 (เครื่อง) เมื่อ Platform แก้แล้ว
  retries: 2,
  timeout: 60_000, // R1: signup/login hash argon2 + หลายหน้า/เครื่องต่อเทสต์ — runner 2 vCPU ที่ --workers=4 ช้ากว่า 30 วิ
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/e2e/support/global-setup.ts',
  use: {
    baseURL: E2E_BASE_URL,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects,
  webServer: {
    command: `npm run start -- -p ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/login`,
    reuseExistingServer: !isCI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: e2eServerEnv(),
  },
});
