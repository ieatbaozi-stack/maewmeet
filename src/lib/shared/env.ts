// ตัวแปร env — ARCHITECTURE §7 · ADR 0002 §7.1 (pepper) · CLAUDE.md กฎ 7
// - ตรวจด้วย zod · ขาด/ผิดรูป → โยน EnvError ที่ "ระบุชื่อตัวแปร" แต่ **ไม่มีค่าของตัวแปรเลย** (ห้ามพิมพ์ความลับ)
// - 2 โปรไฟล์: deployed (VERCEL_ENV = production|preview) เข้มกว่า dev/test (file: ได้, ไม่ต้องมี token)
// - โหลดแบบ lazy (getEnv) เพื่อให้ `next build` ไม่ต้องมีความลับ — จุด "ล้มตอนเริ่ม" ให้เรียก assertEnv()
//   จาก instrumentation.ts (นอกขอบเขต Platform — ดู Handoff) และ /api/health (OPS) รายงาน 503 เมื่อ assertEnv ล้ม
// - PIN_PEPPER_*: ไม่อยู่ใน schema บังคับ (ผิด/ขาด ≠ EnvError) — Auth ตรวจผ่าน readPepperEnv แล้ว fail closed เป็น AUTH_MAINTENANCE · health = 503 (ADR 0002 §7.1)
import { z } from 'zod';

const BASE64_RE = /^[A-Za-z0-9+/\-_]+={0,2}$/;

/** '' หรือช่องว่างล้วน = ไม่ได้ตั้ง (.env.example มีบรรทัด `X=`) */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const optionalString = z.preprocess(blankToUndefined, z.string().optional());

/** base64 ที่ถอดได้ ≥ minBytes ไบต์ */
function base64Secret(minBytes: number) {
  return z
    .string()
    .refine((v) => BASE64_RE.test(v) && Buffer.from(v, 'base64').length >= minBytes, {
      message: `must be base64 of at least ${minBytes} bytes`,
    });
}

/** SERVER_TIMING_ENABLED: 'true' | 'false' | ไม่ตั้ง (R7_CONTRACT §2) — ใช้ทั้งใน schema กลางและ serverTimingEnabled() */
const serverTimingFlagSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v),
  z.enum(['true', 'false']).optional(),
);

const DB_URL_SCHEMES =['file:', 'libsql:', 'http:', 'https:', 'ws:', 'wss:'] as const;
const REMOTE_DB_URL_SCHEMES = ['libsql:', 'https:', 'wss:'] as const;

const originString = z.string().refine(
  (v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === v.replace(/\/$/, '');
    } catch {
      return false;
    }
  },
  { message: 'must be an origin like https://host (no path)' },
);

/** โปรไฟล์ dev/test — ใช้กับทุกสภาพแวดล้อม (deployed เพิ่มเงื่อนไขทับ) */
const envObject = z.object({
  // ── ฐานข้อมูล ──
  TURSO_DATABASE_URL: z.preprocess(
    blankToUndefined,
    z.string().refine((v) => DB_URL_SCHEMES.some((s) => v.startsWith(s)), {
      message: 'must start with file:, libsql:, http(s): or ws(s):',
    }),
  ),
  TURSO_AUTH_TOKEN: optionalString,
  // ── ความลับของแอป (ต้องมีทุกสภาพแวดล้อม) ──
  APP_SECRET: z.preprocess(blankToUndefined, base64Secret(32)),
  CRON_SECRET: z.preprocess(blankToUndefined, z.string().min(16)),
  // ── URL ──
  APP_ORIGIN: z.preprocess(blankToUndefined, originString.optional()),
  VERCEL_URL: optionalString,
  VERCEL_ENV: optionalString,
  // ── proxy: เชื่อ header IP (x-vercel-forwarded-for / x-real-ip / x-forwarded-for) เฉพาะเมื่อ VERCEL ถูกตั้ง (Vercel ใส่ให้เอง) หรือ TRUST_PROXY_HEADERS=1
  //    ตั้งเมื่ออยู่หลัง reverse proxy ที่เขียนทับ header เหล่านี้เองเท่านั้น — ไม่งั้นผู้เรียกปลอม IP หลบ rate limit ได้ (ADR 0002 §3)
  VERCEL: optionalString,
  TRUST_PROXY_HEADERS: optionalString,
  // ── pepper: ไม่ตรวจที่นี่ — ผิด/ขาดต้องไม่ทำให้ getEnv() โยน (ทุก route จะ 500) · ADR 0002 §7.1 fail closed เฉพาะ auth
  //    (AUTH_MAINTENANCE) + /api/health 503 ผ่าน readPepperEnv/requirePepper ใน src/lib/auth/pepper.ts
  PIN_PEPPER_CURRENT_VERSION: optionalString,
  // ── ค้นหาสถานที่ / แผนที่ ──
  PLACE_SEARCH_ENABLED: z.preprocess(
    blankToUndefined,
    z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  ),
  NOMINATIM_BASE_URL: z.preprocess(blankToUndefined, z.url().default('https://nominatim.openstreetmap.org')),
  NOMINATIM_CONTACT: optionalString,
  // ── R7 §2: ตัวนับ query + header Server-Timing (ไม่ตั้ง = เปิด ยกเว้น production — ดู serverTimingEnabled) ──
  SERVER_TIMING_ENABLED: serverTimingFlagSchema,
  // ── R10: LINE Messaging API (ไม่ตั้ง = ช่องทางปิดเงียบ · ค่าลับ ห้าม log) ──
  LINE_MESSAGING_ACCESS_TOKEN: optionalString,
  LINE_MESSAGING_CHANNEL_SECRET: optionalString,
  // ── อื่น ๆ ──
  LOG_LEVEL: z.preprocess(blankToUndefined, z.enum(['debug', 'info', 'warn', 'error']).default('info')),
  NODE_ENV: optionalString,
});

/** NOMINATIM_BASE_URL: https เท่านั้น · http ได้เฉพาะ localhost / 127.0.0.1 นอก production (dev/test mock) — กันส่งคำค้นแบบไม่เข้ารหัส/ชี้ไปโฮสต์ภายใน */
function nominatimUrlProblem(raw: string, nodeEnv: string | undefined): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'must be a valid URL';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && nodeEnv !== 'production') return null;
  return 'must be https (http://localhost or http://127.0.0.1 only outside production)';
}

export const baseEnvSchema = envObject.superRefine((env, ctx) => {
  const problem = nominatimUrlProblem(env.NOMINATIM_BASE_URL, env.NODE_ENV?.trim());
  if (problem !== null) ctx.addIssue({ code: 'custom', path: ['NOMINATIM_BASE_URL'], message: problem });
});

/** โปรไฟล์ deployed (Vercel production/preview) — "ต้องมีตอน runtime prod" */
export const deployedEnvSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (!REMOTE_DB_URL_SCHEMES.some((s) => env.TURSO_DATABASE_URL.startsWith(s))) {
    ctx.addIssue({ code: 'custom', path: ['TURSO_DATABASE_URL'], message: 'must be a remote libsql:/https:/wss: URL when deployed' });
  }
  if (env.TURSO_AUTH_TOKEN === undefined) {
    ctx.addIssue({ code: 'custom', path: ['TURSO_AUTH_TOKEN'], message: 'required when deployed' });
  }
  if (env.APP_ORIGIN === undefined && (env.VERCEL_ENV === 'production' || env.VERCEL_URL === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'required in production (preview may fall back to VERCEL_URL)' });
  }
});

export type Env = z.output<typeof baseEnvSchema>;
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** ข้อผิดพลาด env — message มีแต่ชื่อตัวแปร + เหตุผลทั่วไป ไม่มีค่า */
export class EnvError extends Error {
  readonly variables: readonly string[];
  constructor(problems: readonly { name: string; reason: string }[]) {
    const missing = problems.filter((p) => p.reason === 'missing').map((p) => p.name);
    const invalid = problems.filter((p) => p.reason !== 'missing').map((p) => `${p.name} (${p.reason})`);
    const parts: string[] = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (invalid.length) parts.push(`invalid: ${invalid.join(', ')}`);
    super(`Invalid environment configuration — ${parts.join('; ')}. See .env.example / docs/OPERATIONS.md`);
    this.name = 'EnvError';
    this.variables = [...new Set(problems.map((p) => p.name))];
  }
}

export function isEnvError(e: unknown): e is EnvError {
  return e instanceof EnvError;
}

export function isDeployed(source: EnvSource): boolean {
  return source.VERCEL_ENV === 'production' || source.VERCEL_ENV === 'preview';
}

/**
 * เชื่อ header IP จาก proxy ไหม — บน Vercel (env VERCEL ถูกตั้ง) หรือ operator ยืนยันด้วย TRUST_PROXY_HEADERS=1
 * อ่านจาก source ตรง ๆ (ไม่ผ่าน getEnv) เพื่อให้ฟังก์ชันอ่าน IP ใช้ได้โดยไม่ต้องมี env ครบ
 */
export function trustsProxyHeaders(source: EnvSource = process.env): boolean {
  const vercel = source.VERCEL?.trim();
  return (vercel !== undefined && vercel !== '' && vercel !== '0') || source.TRUST_PROXY_HEADERS?.trim() === '1';
}

/**
 * R7 §2: เปิดตัวนับ query/เวลา + header Server-Timing ไหม — อ่านจาก source ตรง (ไม่ผ่าน getEnv: env ส่วนอื่นผิดต้องไม่ทำให้ route wrapper ล้ม เช่น /api/health)
 * 'true' / 'false' = ตามนั้น · ไม่ตั้ง = เปิด ยกเว้น VERCEL_ENV=production (เฟส B ตัดสินค่าบน prod) · ค่าแปลก = ปิด (assertEnv รายงานชื่อตัวแปรเอง)
 */
export function serverTimingEnabled(source: EnvSource = process.env): boolean {
  const parsed = serverTimingFlagSchema.safeParse(source.SERVER_TIMING_ENABLED);
  if (!parsed.success) return false;
  if (parsed.data !== undefined) return parsed.data === 'true';
  return source.VERCEL_ENV !== 'production';
}

/** ตรวจ env จาก source ที่ให้ (ค่าเริ่มต้น process.env) — โยน EnvError ถ้าไม่ผ่าน */
export function loadEnv(source: EnvSource = process.env): Env {
  const schema = isDeployed(source) ? deployedEnvSchema : baseEnvSchema;
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? 'UNKNOWN');
    const raw = source[name];
    const isMissing = raw === undefined || raw.trim() === '';
    // ใช้ message ที่เราเขียนเอง (custom/refine) — ข้อความของ zod เองอาจอ้างค่าที่รับมา จึงไม่ใช้
    const reason = isMissing ? 'missing' : issue.code === 'custom' ? issue.message : issue.code;
    return { name, reason };
  });
  throw new EnvError(problems);
}

let cached: Env | undefined;

/** env ที่ตรวจแล้ว (cache ต่อ instance) */
export function getEnv(): Env {
  cached ??= loadEnv(process.env);
  return cached;
}

/** เรียกตอนเริ่ม instance (instrumentation.ts) — ล้มทันทีพร้อมชื่อตัวแปรที่ขาด */
export function assertEnv(): void {
  getEnv();
}

/** ล้าง cache — สำหรับเทสต์ที่เปลี่ยน process.env */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * origin ที่ยอมรับสำหรับตรวจ CSRF (ARCHITECTURE §7: APP_ORIGIN · preview ใช้ VERCEL_URL ถ้าว่าง)
 * undefined = ไม่ได้ตั้งทั้งคู่ (dev) → route wrapper เทียบกับ host ของ request เอง
 */
export function configuredAppOrigin(env: Env): string | undefined {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/$/, '');
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return undefined;
}

// ───────── pepper (ADR 0002 §7) — ชนิด + ตัวอ่าน; R0 ไม่เรียกตอนเริ่ม ─────────
export const PEPPER_ENV_RE = /^PIN_PEPPER_V([1-9][0-9]*)$/;
export const pepperValueSchema = base64Secret(32);

export type PepperEnv =
  | { ok: true; currentVersion: number; versions: ReadonlyMap<number, Buffer> }
  | { ok: false; problems: readonly string[] }; // ชื่อตัวแปรที่มีปัญหาเท่านั้น

/**
 * อ่าน PIN_PEPPER_CURRENT_VERSION + PIN_PEPPER_V<n> ทั้งหมด — ไม่โยน (fail closed เป็นหน้าที่ผู้เรียก: AUTH_MAINTENANCE)
 * ไม่มีค่าดีฟอลต์ ไม่สุ่มให้เอง (ADR 0002 §7.1)
 */
export function readPepperEnv(source: EnvSource = process.env): PepperEnv {
  const problems: string[] = [];
  const versions = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(source)) {
    const m = PEPPER_ENV_RE.exec(name);
    if (!m) continue;
    if (value === undefined || !pepperValueSchema.safeParse(value).success) {
      problems.push(name);
      continue;
    }
    versions.set(Number(m[1]), Buffer.from(value, 'base64'));
  }
  const cv = z.coerce.number().int().min(1).safeParse(blankToUndefined(source.PIN_PEPPER_CURRENT_VERSION));
  if (!cv.success) problems.push('PIN_PEPPER_CURRENT_VERSION');
  else if (!versions.has(cv.data) && !problems.includes(`PIN_PEPPER_V${cv.data}`)) problems.push(`PIN_PEPPER_V${cv.data}`);
  if (problems.length || !cv.success) return { ok: false, problems };
  return { ok: true, currentVersion: cv.data, versions };
}
