// Vitest — เจ้าของ: TEST (#11) (Platform ร่างใน R0 ขั้น 2)
// - unit/integration ทั้งหมดใน tests/**/*.test.ts (รวม tests/calendar/** ของ Calendar & Time)
// - tests/e2e/** เป็นของ Playwright (*.spec.ts · playwright.config.ts) — ไม่ให้ Vitest หยิบไปรัน
// - vite 8: alias @/* จาก tsconfig ด้วย resolve.tsconfigPaths
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**', 'test-results/**', 'playwright-report/**'],
  },
});
