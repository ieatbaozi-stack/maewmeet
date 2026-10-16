import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// กฎของโปรเจกต์ — R0_CONTRACT §2 / R0-3 · CLAUDE.md กฎ 9 · ADR 0001 §2
const TEMPORAL_MSG =
  "ใช้ temporal-polyfill ได้เฉพาะใน src/lib/calendar/** (ADR 0001 §2) — เรียกผ่าน API ของ src/lib/calendar แทน";
const NEW_DATE_MSG =
  "ห้าม new Date() นอก src/lib/calendar/** (CLAUDE.md กฎ 9) — ใช้ src/lib/calendar หรือ clock ที่ inject ได้ (src/lib/shared/clock)";
const REPO_APP_MSG =
  "src/lib/data/repos/** ห้าม import จาก src/app/** (ARCHITECTURE §1) — repo ต้องเป็น query ล้วน";

const temporalImportBan = {
  paths: [{ name: "temporal-polyfill", message: TEMPORAL_MSG }],
  patterns: [{ group: ["temporal-polyfill/*"], message: TEMPORAL_MSG }],
};

const repoAppImportBan = {
  patterns: [
    {
      group: ["@/app", "@/app/**", "**/src/app", "**/src/app/**", "**/app/**"],
      message: REPO_APP_MSG,
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "Pre-start/**",
    "docs/**",
    "drizzle/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),

  // 1) ห้าม import temporal-polyfill นอก src/lib/calendar/** และ tests/**
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["src/lib/calendar/**", "tests/**"],
    rules: {
      "no-restricted-imports": ["error", temporalImportBan],
    },
  },

  // 2) ห้าม new Date( นอก src/lib/calendar/**, tests/**, *.config.*, scripts/**
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["src/lib/calendar/**", "tests/**", "**/*.config.*", "scripts/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date']", message: NEW_DATE_MSG },
      ],
    },
  },

  // 3) src/lib/data/repos/** ห้าม import จาก src/app/** (ต้องคงกฎ temporal ไว้ด้วย เพราะ config นี้ทับ no-restricted-imports)
  {
    files: ["src/lib/data/repos/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: temporalImportBan.paths,
          patterns: [...temporalImportBan.patterns, ...repoAppImportBan.patterns],
        },
      ],
    },
  },
]);
