// Vitest ขั้นต่ำ (Platform สร้างชั่วคราวใน R0 ขั้น 2 — TEST (#11) รับช่วงต่อในขั้น 3)
// vite 8: alias @/* จาก tsconfig ด้วย resolve.tsconfigPaths
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
