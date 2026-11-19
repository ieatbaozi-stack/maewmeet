# ARCHITECTURE — แมวเจอกัน (maewmeet) v1

> เจ้าของไฟล์: Architect · สถานะ: **ตรงกับโค้ดจริงที่ v0.14.0 (ออกรุ่น 2026-11-19 · R0–R16 · ตรวจ 2026-11-19)** — ADR 0001–0015 สถานะ Accepted · ใช้ประกอบ [DOCS_SYNC_CONTRACT](../contracts/DOCS_SYNC_CONTRACT.md) (ทุก route ใน ROUTE_MANIFEST และทุกตารางที่ migration สร้างต้องมีชื่อในไฟล์นี้)
> แหล่งความจริงของโค้ด: schema = `src/db/schema.ts` + `drizzle/*.sql` · routes = `src/app/api/_lib/manifest.ts` (`ROUTE_MANIFEST`) · env = `.env.example` + `src/lib/shared/env.ts` · cron = `vercel.json` + `.github/workflows/keepalive.yml` — ถ้าเอกสารนี้ขัดกับไฟล์เหล่านี้ ให้ถือโค้ดเป็นหลักแล้วแจ้ง architect
> repo บน GitHub เป็น **public** แล้ว (ผลต่อ keepalive ดูข้อ 8)
> แก้รอบ 2 (2026-10-16): การจัดการ pepper (ADR 0002 §7) — env `PIN_PEPPER_V<n>`, ตาราง `pepper_fingerprint`, `AUTH_MAINTENANCE` · keep-alive Turso 2 ชั้น (ADR 0001 §3.1) — ตาราง `system_heartbeat`, `/api/cron/heartbeat`, GitHub Actions · สัปดาห์เริ่มวันจันทร์ (ADR 0004)
> แหล่งความจริงของความต้องการ: [PRD](../prd/PRD.md) · ตัดสินใจรายเรื่อง: [ADR 0001](../adr/0001-stack-and-project-structure.md) · [0002](../adr/0002-auth-pin.md) · [0003](../adr/0003-rbac.md) · [0004](../adr/0004-time-and-timezone.md) · [0005](../adr/0005-common-free-time-algorithm.md) · [0006](../adr/0006-busy-visibility.md) · [0007](../adr/0007-notifications.md) · [0008](../adr/0008-i18n-and-theme.md) · [0009](../adr/0009-going-counts-as-busy.md) · [0010](../adr/0010-daily-busy-series.md) · [0011](../adr/0011-line-reminders.md) · [0012](../adr/0012-busy-routines.md) · [0013](../adr/0013-drop-place-search-cache.md) · [0014](../adr/0014-csp-unsafe-inline-accepted.md) · [0015](../adr/0015-data-retention-group-restore-purge.md)
> **หมายเหตุ R13 (2026-11-11, boss อนุมัติ):** การค้นหาสถานที่ผ่าน Nominatim (U10 `GET /api/places/search`, action `place.search`, env `PLACE_SEARCH_ENABLED`/`NOMINATIM_*`/`NEXT_PUBLIC_MAP_*`) และภาพแผนที่ OSM ถูกเอาออกแล้ว — ผู้ใช้วางลิงก์แผนที่เอง + ปุ่มเปิด Google Maps / Apple Maps · ตาราง `place_search_cache` + งาน cron ล้างมัน **ถูกลบใน migration `0006` (R15, [ADR 0013](../adr/0013-drop-place-search-cache.md), ย้อนไม่ได้)** · ส่วนที่พูดถึงเรื่องนี้ด้านล่างคงไว้เป็นประวัติ · ดู [R13_CONTRACT §1.3](../contracts/R13_CONTRACT.md) และ [PRD D11](../prd/PRD.md)
> **หมายเหตุ R16 (2026-11-19, ออกรุ่นใน v0.14.0):** rate limit ใหม่ `group:settings` / `prefs:update` / `api:read` (ข้อ 2, 5, 11) · DTO คำเชิญค้างและ notification `group.invite.received` มีธง `actorSystemAdmin` (ข้อ 5) · ข้อจำกัดที่รู้และความเสี่ยงที่ยอมรับ (redirect ได้ 200 ระหว่าง stream, Server-Timing เฉพาะ API, CSP `'unsafe-inline'` — [ADR 0014](../adr/0014-csp-unsafe-inline-accepted.md)) อยู่ข้อ 11 · ไม่มี route/ตารางใหม่
> **หมายเหตุ R17 (2026-11-19, ยังไม่ออกรุ่น — เสนอ v0.15.0):** นโยบายเก็บข้อมูลที่ลบ [ADR 0015](../adr/0015-data-retention-group-restore-purge.md) — กลุ่มที่ลบเก็บ 30 วัน super admin กู้ได้ (`POST /api/admin/groups/:gid/restore`, action `admin.group.restore` ใน `SUPER_ADMIN_ONLY`/`SUPER_ADMIN_AUDITED`) แล้ว cron daily ลบถาวร (ข้อ 8 งานที่ 5) · DTO กลุ่มของ admin มี `purgeAt`/`restorable`/`restoreBlockedReason` · notification ชนิดใหม่ `group.restored` (ADR 0007, กระดิ่งเท่านั้น) · audit action `group.restore`/`group.purge` · บัญชียังล้างทันที แต่ `POST /api/me/delete` ต้องส่ง `confirmUsername` (ข้อ 5) · **ไม่มี migration/ตาราง/env ใหม่**
> โค้ดใน §3 เริ่มจากฉบับที่ใช้ตอน R0–R1 แล้วปรับตามโค้ดจริงถึง v0.14.0 (R16 ไม่มี migration — schema เท่ากับ v0.13.0) — คอลัมน์ทุกตัวที่ยังมีอยู่ตรงกับ `src/db/schema.ts` (สรุปตารางทั้งหมดอยู่ต้น §3) · ชื่อไฟล์/คอลัมน์ถือเป็นสัญญา เปลี่ยนต้องผ่าน migration + ADR/contract

## สารบัญ
1. โครงโฟลเดอร์และเจ้าของ · 2. การไหลของ request · 3. Schema Drizzle (ตารางทั้งหมด) · 4. Session และ actor · 5. API endpoint ต่อ story · 6. รหัส error · 7. ตัวแปร env (`.env.example`) · 8. งานตามเวลา (cron) · 9. คำถามถึง Lead / ประเด็นเปิด · 10. เปิดแบบแอปบนหน้าจอโฮม (R15) · 11. Rate limit ที่ wrapper + ข้อจำกัดที่รู้ (R16)

---

## 1. โครงโฟลเดอร์และเจ้าของ
เจ้าของตาม [TEAM.md](../team/TEAM.md) (เลขบทบาทในวงเล็บ) · `★` = path ใหม่ที่ TEAM.md ยังไม่ระบุ ต้องให้ Lead ยืนยัน (ข้อ 9)

```text
maewmeet/
├── src/
│   ├── app/                                   Front-end (6) — ทุกอย่างยกเว้น api/
│   │   ├── layout.tsx                         root: อ่าน cookie mm_locale/mm_theme → <html lang data-theme>, NextIntlClientProvider
│   │   ├── (public)/                          หน้าก่อนล็อกอิน
│   │   │   ├── login/page.tsx                 U1, U2 (สถานะคำขอ reset), U14/U15 สลับก่อนล็อกอิน
│   │   │   ├── signup/page.tsx                U1
│   │   │   └── forgot-pin/page.tsx            U2
│   │   ├── set-pin/page.tsx                   U3 (หน้าเดียวที่เข้าได้ระหว่าง must_change_pin)
│   │   ├── (app)/                             หลังล็อกอิน — layout ตรวจ session, ถ้า must_change_pin → redirect /set-pin
│   │   │   ├── page.tsx                       U11 หน้าหลัก (นัดถัดไป)
│   │   │   ├── calendar/page.tsx              U7 ลง busy ของฉัน (+ มุมมองรวม)
│   │   │   ├── groups/page.tsx                U4 รายการกลุ่ม + ใส่โค้ดเชิญ (U5)
│   │   │   ├── groups/[groupId]/page.tsx      U8 ปฏิทินกลุ่ม (เดือน/วัน), U9 วันว่างร่วม
│   │   │   ├── groups/[groupId]/settings/     U6 สมาชิก/บทบาท/หน้าต่างวันว่าง/โค้ดเชิญ
│   │   │   ├── appointments/[id]/page.tsx     U10, U10.1, U10.2
│   │   │   ├── notifications/page.tsx         ADR 0007
│   │   │   └── me/page.tsx                    U13, U14, U15
│   │   ├── admin/                             U12 (layout ตรวจ is_admin ผ่าน service — ไม่ใช่แค่ซ่อนเมนู)
│   │   └── api/                               Platform (5) — ยกเว้น auth/ และ line/
│   │       ├── _lib/                          route wrapper, manifest, serializer ของ HTTP, error→status
│   │       ├── auth/**                        Auth & Access (8): signup, login, logout, pin, pin-reset, admin/pin-resets
│   │       ├── me/**  groups/**  appointments/**  invites/**  prefs/**  admin/**   (places/** ถูกลบ R13)
│   │       ├── cron/daily/route.ts            งานรายวัน (ข้อ 8)
│   │       ├── cron/heartbeat/route.ts        keep-alive จาก GitHub Actions (ข้อ 8)
│   │       ├── cron/reminders/route.ts        เตือนก่อนนัด ทุก 15 นาที (R10, ADR 0011, ข้อ 8)
│   │       ├── health/route.ts                OPS (10) ★ (ไฟล์อยู่ใน api/ แต่เนื้อหาเป็นของ OPS)
│   │       └── line/webhook/route.ts          Integrations (9) — R10 webhook LINE OA
│   ├── components/                            Front-end (6)
│   │   └── brand/                             UX & Brand (4) — แมว SVG, โลโก้
│   ├── i18n/request.ts                        Front-end (6) — ADR 0008
│   ├── styles/tokens.css                      UX & Brand (4) — light + dark (ADR 0008 §4)
│   ├── db/                                    Platform (5)
│   │   ├── schema.ts                          ข้อ 3
│   │   └── client.ts                          drizzle(libsql) จาก env; เทสต์ใช้ file: ชั่วคราว
│   └── lib/
│       ├── calendar/                          Calendar & Time (7) — ห่อ temporal-polyfill (ADR 0004/0005)
│       │   ├── time.ts  format.ts  busy.ts  free-time.ts
│       ├── auth/                              Auth & Access (8) — ADR 0002
│       │   ├── pin.ts (argon2+pepper, PIN ต้องห้าม)  session.ts  throttle.ts  reset.ts  csrf.ts
│       ├── rbac/                              Auth & Access (8) — ADR 0003
│       │   ├── actions.ts  can.ts  types.ts  errors.ts (PolicyError)
│       ├── data/                              Platform (5)
│       │   ├── repos/*.ts                     query Drizzle ล้วน (ห้าม import จาก src/app — lint)
│       │   ├── services/*.ts                  ทุกฟังก์ชัน: (actor, input) → authorize() บรรทัดแรก → repos → audit/notify
│       │   ├── policy-context.ts              โหลด GroupCtx/role/ผู้สร้าง ให้ can()
│       │   ├── serializers/*.ts               DTO + กรอง busy (ADR 0006)
│       │   ├── notifications/                 แกนแจ้งเตือน + channel in_app (ADR 0007)
│       │   └── audit.ts
│       ├── shared/  ★                         ErrorCode union, Result type, id generator — ใช้ร่วมทุกโดเมน (ข้อ 9 Q1)
│       └── integrations/line/                 Integrations (9) — channel LINE: dispatch outbox, webhook (R10, ADR 0011)
├── messages/th.json  en.json                  เนื้อหา UX (4) · คีย์เพิ่มได้โดย Front-end (6)
├── drizzle/                                   Platform (5) — migration ที่ drizzle-kit generate (มีเวอร์ชัน)
├── drizzle.config.ts  ★                       Platform (5) (ข้อ 9 Q1)
├── tests/                                     TEST (11) · ยกเว้น tests/calendar/** = Calendar & Time (7)
│   ├── rbac/matrix.fixture.ts                 ADR 0003 §4
│   ├── calendar/fixtures/                     แปลงจาก docs/adr/0005-fixtures/
│   └── e2e/                                   Playwright 375/390/768 × TH/EN × light/dark
├── next.config.ts  .github/**                 OPS (10) — รวม .github/workflows/keepalive.yml (ADR 0001 §3.1)
├── scripts/pepper-fingerprint.ts  scripts/admin-reset-pin.ts  ★  OPS (10) — ADR 0002 §7.4 (ข้อ 9 Q1)
├── vercel.json  ★                             OPS (10) — crons + schedules (ข้อ 8)
└── .env.example  .nvmrc  ★                    OPS (10) — ข้อ 7 · Node 24
```
ไม่มี `proxy.ts`/`middleware.ts` ใน v1 (ADR 0001)

## 2. การไหลของ request

```text
                 ┌──────────── Route Handler: src/app/api/**/route.ts (บาง) ────────────┐
HTTP request ──► │ route(spec) wrapper  (src/app/api/_lib/route.ts)                     │
                 │  1. CSRF: non-GET ต้อง Origin == app host และ JSON content-type         │
                 │  2. parse + validate input ด้วย zod (VALIDATION error เป็นรหัส)           │
                 │  3. actor = getActor(cookies)  ← src/lib/auth/session.ts                 │
                 │       hash(token) → session JOIN user (status, is_admin, must_change_pin) │
                 │       sliding renew (≤ 1 write/วัน)                                      │
                 │  3½. R16: GET + ผู้ใช้ล็อกอิน + action ไม่สาธารณะ → จองช่อง `api:read`    │
                 │      ขนานกับข้อ 4 (เต็ม → 429 ทิ้งผล handler) — ข้อ 11                    │
                 │  4. result = service(actor, input)                                       │
                 │  5. JSON {data} | {error:{code,params}} + Cache-Control: private,no-store │
                 └──────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
   service: src/lib/data/services/<domain>.ts
     ctx = loadPolicyContext(actor, ref)          ← policy-context.ts (1 query: กลุ่ม + role ของ actor + เจ้าของ resource)
     authorize(actor, ACTION, ctx)                ← src/lib/rbac/can.ts (pure) — throw PolicyError(code,status)
     db.transaction(tx => repos… + audit(tx) + notify(tx))
     return serializer(viewer, rows)              ← ADR 0006 กรอง busy ที่นี่
                                       │
                                       ▼
   repos: src/lib/data/repos/*.ts  →  Drizzle  →  @libsql/client  →  Turso

Server Component (src/app/(app)/**/page.tsx):
   actor = await getActor(await cookies())  →  service เดียวกัน (อ่านอย่างเดียว)  →  render
   (ไม่มีการ mutate จาก Server Component/Server Action ใน v1)
```
- **ลำดับนี้ตายตัว**: ไม่มี service ไหนข้าม `authorize()` · repos ไม่รู้จัก actor
- เวลา "ตอนนี้" มาจาก `clock.now()` ที่ inject ได้ (เทสต์ควบคุมเวลา — ADR 0002/0004)
- PolicyError → HTTP: `AUTH_REQUIRED`/`ACCOUNT_SUSPENDED` 401 · `PIN_CHANGE_REQUIRED`/`FORBIDDEN` 403 · `NOT_FOUND` 404 · `ADMIN_TRANSFER_REQUIRED`/`CONFLICT` 409 · `RATE_LIMITED`/`LOGIN_LOCKED` 429 (+ `Retry-After`)
- Route manifest (`src/app/api/_lib/manifest.ts`): ทุก route ลงทะเบียน `{method, path, action}` — ใช้ทั้งเอกสาร (ข้อ 5) และเทสต์เมทริกซ์อัตโนมัติ (ADR 0003 §4)

## 3. Schema Drizzle (ตรงกับ v0.14.0 — R16 และ R17 ไม่มี migration ใหม่ ล่าสุดคือ `0006`)

### ตารางทั้งหมดในฐานจริง (หลัง migration `0000`–`0006`)
| ตาราง | สร้าง/แก้ใน migration | ที่มา | หมายเหตุ |
|---|---|---|---|
| `user` | `0000_init` | ADR 0002 | `line_user_id` ใช้จริงตั้งแต่ R10 (ไม่มี migration เพิ่ม — คอลัมน์มีตั้งแต่ 0000) |
| `session` | `0000_init` | ADR 0002 §4 | |
| `login_throttle` | `0000_init` | ADR 0002 §3 | |
| `rate_limit_bucket` | `0000_init` | ADR 0002 §3 | ทุก bucket rate limit (prefix ใน `src/lib/shared/limits.ts`) |
| `pin_reset_request` | `0000_init` | ADR 0002 §6 | |
| `pepper_fingerprint` | `0000_init` | ADR 0002 §7.2 | |
| `system_heartbeat` | `0000_init` | ADR 0001 §3.1 | |
| `groups` | `0000_init` · index `created_by` ใน `0001_r2_groups_created_by_idx` · + `icon` ใน `0006_r15_group_icon_drop_place_cache` | U4–U6, R15 §1.2 | |
| `group_member` | `0000_init` · + `color_slot`, `shape_slot` ใน `0002_r6c_member_appearance` | R6C F3ก | |
| `group_invite` | `0000_init` | U5, ADR 0002 §8 | |
| `busy_block` | `0000_init` · + `series_id` ใน `0003_r6f_busy_series` · + `routine_id` ใน `0005_r14_busy_routine` | ADR 0004/0006/0010/0012 | |
| `busy_routine` | `0005_r14_busy_routine` | ADR 0012 | |
| `busy_routine_skip` | `0005_r14_busy_routine` | ADR 0012 §5, §13 | |
| `appointment` | `0000_init` · + `scheduled_at` ใน `0004_r10_line_reminders` (backfill = `created_at`) | U10, ADR 0011 | |
| `appointment_rsvp` | `0000_init` | U10.1 | |
| `appointment_reminder` | `0004_r10_line_reminders` | ADR 0011 §2 | |
| `line_link_code` | `0004_r10_line_reminders` | ADR 0011, R10 §2 | |
| `notification` | `0000_init` | ADR 0007 | |
| `notification_outbox` | `0000_init` | ADR 0007 §2 | ใช้จริงตั้งแต่ R10 (channel `line`) · เพดาน LINE นับจากตารางนี้ (ข้อ 8) |
| `audit_log` | `0000_init` | U12 | |
| ~~`place_search_cache`~~ | สร้าง `0000_init` · **DROP ใน `0006_r15_group_icon_drop_place_cache`** | ADR 0013 | ไม่มีในฐานแล้ว |

รวม 20 ตารางที่ยังอยู่ · migration ทั้งหมดเป็นแบบเพิ่มอย่างเดียว ยกเว้น `0006` ที่ลบ `place_search_cache` (ย้อนไม่ได้)

หลักการ: id = `text` UUIDv4 สร้างในแอป · เวลา = `integer` epoch ms UTC (ตั้งค่าจาก `clock.now()` ไม่ใช้ default ของ DB) · วันที่ = `text` `YYYY-MM-DD` · boolean = `integer({mode:'boolean'})` · enum บังคับทั้ง TS (`enum`) และ DB (`check`) · ตาราง `groups` เป็นพหูพจน์เพราะ `GROUP` เป็นคำสงวน SQL

```ts
// src/db/schema.ts — สรุป (drizzle-orm, sqlite-core) · ตัดคอมเมนต์ยาวออก ดูไฟล์จริงสำหรับรายละเอียด
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const ms = (n: string) => integer(n);                                  // epoch ms UTC
const bool = (n: string) => integer(n, { mode: 'boolean' });

// ───────── บัญชี (ADR 0002) ─────────
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),                               // ตามที่พิมพ์ (แสดงผล)
  usernameNormalized: text('username_normalized').notNull(),          // NFKC + lowercase — ใช้ค้น/unique (D2)
  displayName: text('display_name').notNull(),                        // 1–40 ตัวอักษร
  pinHash: text('pin_hash'),                                          // PHC argon2id · NULL = ถูก reset อนุมัติแล้ว/ลบบัญชี
  pinPepperVersion: integer('pin_pepper_version').notNull().default(1),
  isAdmin: bool('is_admin').notNull().default(false),                 // super admin — ตั้งใน DB เท่านั้น
  mustChangePin: bool('must_change_pin').notNull().default(false),
  status: text('status', { enum: ['active', 'suspended', 'deleted'] }).notNull().default('active'),
  locale: text('locale', { enum: ['th', 'en'] }).notNull().default('th'),             // ADR 0008
  theme: text('theme', { enum: ['system', 'light', 'dark'] }).notNull().default('system'),
  lineUserId: text('line_user_id'),                                   // v1.x (D13)
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
  deletedAt: ms('deleted_at'),
}, (t) => [
  uniqueIndex('user_username_norm_uq').on(t.usernameNormalized),
  uniqueIndex('user_line_user_id_uq').on(t.lineUserId),             // NULL ซ้ำได้ใน SQLite
  check('user_status_ck', sql`${t.status} in ('active','suspended','deleted')`),
  check('user_locale_ck', sql`${t.locale} in ('th','en')`),
  check('user_theme_ck', sql`${t.theme} in ('system','light','dark')`),
]);

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),                                        // SHA-256(token) hex — ไม่เก็บ token ดิบ
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: ms('created_at').notNull(),
  expiresAt: ms('expires_at').notNull(),
  lastSeenAt: ms('last_seen_at').notNull(),
  userAgent: text('user_agent'),                                      // ตัดที่ 200 ตัวอักษร
}, (t) => [index('session_user_idx').on(t.userId), index('session_expires_idx').on(t.expiresAt)]);

export const loginThrottle = sqliteTable('login_throttle', {
  key: text('key').primaryKey(),                                      // 'u:' + username_normalized (มีบัญชีหรือไม่ก็ตาม)
  failures: integer('failures').notNull().default(0),
  lockedUntil: ms('locked_until'),
  updatedAt: ms('updated_at').notNull(),
});

export const rateLimitBucket = sqliteTable('rate_limit_bucket', {
  key: text('key').primaryKey(),                                      // 'login:ip:<hmac>' ฯลฯ (ADR 0002 §3)
  windowStart: ms('window_start').notNull(),
  count: integer('count').notNull(),
}, (t) => [index('rate_limit_window_idx').on(t.windowStart)]);

export const pinResetRequest = sqliteTable('pin_reset_request', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['pending', 'approved', 'rejected', 'used', 'expired', 'cancelled'] }).notNull(),
  deviceTokenHash: text('device_token_hash').notNull(),               // SHA-256 ของ cookie mm_reset (ADR 0002 §6)
  requesterUa: text('requester_ua'),                                  // ย่อ เช่น "iPhone · Safari"
  requesterCountry: text('requester_country'),                        // x-vercel-ip-country
  requestedAt: ms('requested_at').notNull(),
  pendingExpiresAt: ms('pending_expires_at').notNull(),               // requested + 7 วัน
  decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
  decidedAt: ms('decided_at'),
  expiresAt: ms('expires_at'),                                        // approved + 24 ชม. (D3)
  usedAt: ms('used_at'),
}, (t) => [
  uniqueIndex('pin_reset_one_open_uq').on(t.userId).where(sql`${t.status} in ('pending','approved')`), // U2: ค้างได้ 1
  index('pin_reset_status_idx').on(t.status, t.requestedAt),
  check('pin_reset_status_ck', sql`${t.status} in ('pending','approved','rejected','used','expired','cancelled')`),
]);

// ───────── กลุ่ม (U4–U6, D6–D9) ─────────
export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),                                       // 1–60
  tz: text('tz').notNull().default('Asia/Bangkok'),                   // ADR 0004 §4
  freeWindowStartMin: integer('free_window_start_min').notNull().default(480),   // 08:00
  freeWindowEndMin: integer('free_window_end_min').notNull().default(1320),      // 22:00
  minFreeMinutes: integer('min_free_minutes').notNull().default(120),
  icon: text('icon'),                                                 // R15 (0006): คีย์ใน allowlist กลาง · NULL = ไอคอนเริ่มต้น (แมว) — ดู "ไอคอนกลุ่ม" ใต้บล็อกนี้
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
  deletedAt: ms('deleted_at'),                                        // soft delete (U6)
}, (t) => [
  check('groups_window_ck', sql`${t.freeWindowStartMin} >= 0 and ${t.freeWindowStartMin} < ${t.freeWindowEndMin}
        and ${t.freeWindowEndMin} <= 1440 and ${t.freeWindowStartMin} % 30 = 0 and ${t.freeWindowEndMin} % 30 = 0`),
  check('groups_min_free_ck', sql`${t.minFreeMinutes} >= 30 and ${t.minFreeMinutes} % 30 = 0
        and ${t.minFreeMinutes} <= ${t.freeWindowEndMin} - ${t.freeWindowStartMin}`),
]);

export const groupMember = sqliteTable('group_member', {
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['admin', 'moderator', 'member'] }).notNull(),
  joinedAt: ms('joined_at').notNull(),
  colorSlot: integer('color_slot'),                                   // R6C (0002): 1–10 · NULL = สีจาก hash เดิม
  shapeSlot: integer('shape_slot'),                                   // R6C (0002): 1–10 · NULL = รูปทรงจาก hash เดิม
}, (t) => [
  primaryKey({ columns: [t.groupId, t.userId] }),                     // U5: เข้าซ้ำไม่สร้างแถวซ้ำ
  index('group_member_user_idx').on(t.userId),
  uniqueIndex('group_one_admin_uq').on(t.groupId).where(sql`${t.role} = 'admin'`),   // กลุ่มละ 1 admin
  check('group_member_role_ck', sql`${t.role} in ('admin','moderator','member')`),
  check('group_member_color_slot_ck', sql`${t.colorSlot} is null or (typeof(${t.colorSlot}) = 'integer' and ${t.colorSlot} between 1 and 10)`),
  check('group_member_shape_slot_ck', sql`${t.shapeSlot} is null or (typeof(${t.shapeSlot}) = 'integer' and ${t.shapeSlot} between 1 and 10)`),
]);

export const groupInvite = sqliteTable('group_invite', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['direct', 'code'] }).notNull(),
  inviteeUserId: text('invitee_user_id').references(() => user.id, { onDelete: 'cascade' }),   // direct
  codeHash: text('code_hash'),                                        // code: HMAC-SHA256(APP_SECRET-derived, code) — ไม่เก็บโค้ดดิบ
  codeHint: text('code_hint'),                                        // 2 ตัวท้าย ให้ผู้สร้างจำได้ในรายการ
  status: text('status', { enum: ['active', 'accepted', 'declined', 'revoked', 'expired'] }).notNull().default('active'),
  usesCount: integer('uses_count').notNull().default(0),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: ms('created_at').notNull(),
  expiresAt: ms('expires_at').notNull(),                              // created + 7 วัน (D6) — ตรวจแบบ lazy
  revokedAt: ms('revoked_at'),
  revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('group_invite_code_hash_uq').on(t.codeHash),
  uniqueIndex('group_invite_direct_active_uq').on(t.groupId, t.inviteeUserId)
    .where(sql`${t.kind} = 'direct' and ${t.status} = 'active'`),
  index('group_invite_group_idx').on(t.groupId, t.status),
  index('group_invite_invitee_idx').on(t.inviteeUserId, t.status),
  check('group_invite_kind_ck', sql`(${t.kind} = 'direct' and ${t.inviteeUserId} is not null and ${t.codeHash} is null)
        or (${t.kind} = 'code' and ${t.codeHash} is not null and ${t.inviteeUserId} is null)`),
]);

// ───────── ปฏิทิน (U7, ADR 0004/0006) ─────────
export const busyBlock = sqliteTable('busy_block', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title'),                                               // "ทำอะไร" ≤ 80 — แชร์ได้ถ้าไม่ซ่อน
  note: text('note'),                                                 // ≤ 500 — เห็นเฉพาะเจ้าของ (ADR 0006)
  allDay: bool('all_day').notNull(),
  startAt: ms('start_at').notNull(),                                  // timed: แหล่งความจริง · all-day: คำนวณ (เพื่อ query)
  endAt: ms('end_at').notNull(),                                      // exclusive
  localStartDate: text('local_start_date').notNull(),                 // all-day: แหล่งความจริง (รวมปลาย)
  localEndDate: text('local_end_date').notNull(),
  tz: text('tz').notNull().default('Asia/Bangkok'),
  hideDetail: bool('hide_detail').notNull().default(false),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
  seriesId: text('series_id'),                                        // R6F (0003, ADR 0010) · ไม่มี FK · เห็นเฉพาะเจ้าของ
  routineId: text('routine_id'),                                      // R14 (0005, ADR 0012) · ไม่มี FK · เห็นเฉพาะเจ้าของ
}, (t) => [
  index('busy_user_start_idx').on(t.userId, t.startAt),
  index('busy_user_end_idx').on(t.userId, t.endAt),
  index('busy_user_series_idx').on(t.userId, t.seriesId).where(sql`${t.seriesId} is not null`),
  index('busy_user_routine_idx').on(t.userId, t.routineId).where(sql`${t.routineId} is not null`),
  check('busy_range_ck', sql`${t.endAt} > ${t.startAt} and ${t.localEndDate} >= ${t.localStartDate}`),
]);
// busy_routine / busy_routine_skip (R14, 0005) — สรุปคอลัมน์ใต้บล็อกนี้ ("busy routine")

// ───────── นัด (U10–U11) ─────────
export const appointment = sqliteTable('appointment', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),                                     // 1–80
  description: text('description'),                                   // ≤ 1000
  placeName: text('place_name'),
  lat: real('lat'),
  lng: real('lng'),
  mapUrl: text('map_url'),                                            // https เท่านั้น ≤ 500
  startAt: ms('start_at').notNull(),
  endAt: ms('end_at').notNull(),
  tz: text('tz').notNull(),
  localDate: text('local_date').notNull(),                            // วันท้องถิ่นของจุดเริ่ม
  status: text('status', { enum: ['active', 'cancelled'] }).notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
  cancelledAt: ms('cancelled_at'),
  cancelledBy: text('cancelled_by').references(() => user.id, { onDelete: 'set null' }),
  scheduledAt: ms('scheduled_at').notNull().default(0),               // R10 (0004): เวลาสร้าง/เลื่อน start ล่าสุด · backfill = created_at
}, (t) => [
  index('appointment_group_start_idx').on(t.groupId, t.startAt),
  index('appointment_start_idx').on(t.status, t.startAt),            // U11 upcoming ข้ามกลุ่ม
  check('appointment_range_ck', sql`${t.endAt} > ${t.startAt}`),
  check('appointment_latlng_ck', sql`(${t.lat} is null and ${t.lng} is null)
        or (${t.lat} is not null and ${t.lng} is not null
            and ${t.lat} between -90 and 90 and ${t.lng} between -180 and 180)`),   // ต้องระบุ NOT NULL: CHECK ที่ได้ NULL ถือว่าผ่าน
  check('appointment_status_ck', sql`${t.status} in ('active','cancelled')`),
]);

export const appointmentRsvp = sqliteTable('appointment_rsvp', {
  appointmentId: text('appointment_id').notNull().references(() => appointment.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  response: text('response', { enum: ['going', 'maybe', 'not_going'] }).notNull(),
  updatedAt: ms('updated_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.appointmentId, t.userId] }),
  index('rsvp_user_idx').on(t.userId),
  check('rsvp_response_ck', sql`${t.response} in ('going','maybe','not_going')`),
]);

// ───────── เตือนก่อนนัด / LINE (R10, ADR 0011, migration 0004) ─────────
export const appointmentReminder = sqliteTable('appointment_reminder', {   // กันเตือนซ้ำต่อ (นัด, ชนิด, เวลาเริ่ม)
  appointmentId: text('appointment_id').notNull().references(() => appointment.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['appointment.reminder_1d', 'appointment.reminder_1h', 'appointment.rsvp_nudge'] }).notNull(),
  startAt: ms('start_at').notNull(),                                  // เลื่อนนัด = startAt ใหม่ = เตือนใหม่ได้
  createdAt: ms('created_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.appointmentId, t.kind, t.startAt] }),
  check('appointment_reminder_kind_ck', sql`${t.kind} in ('appointment.reminder_1d','appointment.reminder_1h','appointment.rsvp_nudge')`),
]);

export const lineLinkCode = sqliteTable('line_link_code', {           // โค้ดเชื่อม LINE: เก็บ HMAC เท่านั้น · ใช้ครั้งเดียว · อายุ 10 นาที
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  createdAt: ms('created_at').notNull(),
  expiresAt: ms('expires_at').notNull(),
  usedAt: ms('used_at'),
}, (t) => [
  uniqueIndex('line_link_code_hash_uq').on(t.codeHash),
  index('line_link_code_user_idx').on(t.userId),
  index('line_link_code_expires_idx').on(t.expiresAt),
]);
// user.line_user_id (มีตั้งแต่ 0000) = LINE userId ที่ได้จาก webhook ตอนผู้ใช้ส่งโค้ดในแชท OA · NULL = ไม่เชื่อม

// ───────── แจ้งเตือน (ADR 0007) ─────────
export const notification = sqliteTable('notification', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                                       // NotificationKind
  params: text('params', { mode: 'json' }).notNull(),                 // ค่าดิบ ไม่ใช่ข้อความแปลแล้ว
  readAt: ms('read_at'),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  index('notification_user_created_idx').on(t.userId, t.createdAt),
  index('notification_user_unread_idx').on(t.userId, t.readAt),
]);

export const notificationOutbox = sqliteTable('notification_outbox', {   // สร้างตั้งแต่ 0000 (D13) · ใช้จริงตั้งแต่ R10 (LINE)
  id: text('id').primaryKey(),
  notificationId: text('notification_id').references(() => notification.id, { onDelete: 'set null' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  channel: text('channel', { enum: ['line'] }).notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),               // {kind, params}
  status: text('status', { enum: ['pending', 'sent', 'failed', 'dead'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ms('next_attempt_at').notNull(),
  lastError: text('last_error'),                                      // ห้ามมีความลับ
  createdAt: ms('created_at').notNull(),
  sentAt: ms('sent_at'),
}, (t) => [index('outbox_due_idx').on(t.status, t.nextAttemptAt)]);

// ───────── audit / cache ─────────
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),   // NULL = ระบบ
  action: text('action').notNull(),                                   // ชื่อ action จาก ADR 0003
  targetType: text('target_type').notNull(),                          // 'user' | 'group' | 'pin_reset' | ...
  targetId: text('target_id').notNull(),
  groupId: text('group_id'),
  meta: text('meta', { mode: 'json' }),                               // ห้ามมี PIN/token/โค้ด
  createdAt: ms('created_at').notNull(),
}, (t) => [
  index('audit_created_idx').on(t.createdAt),
  index('audit_target_idx').on(t.targetType, t.targetId),
  index('audit_actor_idx').on(t.actorId),
]);

export const pepperFingerprint = sqliteTable('pepper_fingerprint', {  // ADR 0002 §7.2
  version: integer('version').primaryKey(),
  fingerprint: text('fingerprint').notNull(),                         // hex HMAC-SHA256(pepper, "maewmeet/pepper-fingerprint/v1")
  createdAt: ms('created_at').notNull(),
});

export const systemHeartbeat = sqliteTable('system_heartbeat', {      // ADR 0001 §3.1 keep-alive
  source: text('source', { enum: ['vercel-cron', 'github-actions'] }).primaryKey(),
  lastAt: ms('last_at').notNull(),
}, (t) => [check('heartbeat_source_ck', sql`${t.source} in ('vercel-cron','github-actions')`)]);

// ⚠ R15: ตารางนี้ถูกลบใน migration 0006 (ADR 0013) — คงไว้เป็นประวัติ (ไม่มีใน `src/db/schema.ts` แล้ว)
export const placeSearchCache = sqliteTable('place_search_cache', {   // proxy Nominatim (ADR 0001)
  queryNormalized: text('query_normalized').primaryKey(),             // lowercase + trim + collapse space + locale
  results: text('results', { mode: 'json' }).notNull(),               // [{name, lat, lng, osmUrl}] สูงสุด 5
  fetchedAt: ms('fetched_at').notNull(),                              // เก็บ 30 วัน
});
```

### busy routine (R14, [ADR 0012](../adr/0012-busy-routines.md) ทางเลือก C, migration `drizzle/0005_*`)
แหล่งความจริงของคอลัมน์คือ `src/db/schema.ts` — ข้างล่างเป็นสรุป
- `busy_routine` (กฎ — เห็นเฉพาะเจ้าของ): `id`, `user_id` → user (cascade), `title`, `note`, `hide_detail`, `all_day`, `weekdays` (bitmask ISO 1–127), `start_min`/`end_min` (นาที ลงตัว 30 · `end_min ≤ start_min` = ข้ามเที่ยงคืน · 1440 = 24:00 · NULL เมื่อ all-day), `range_kind` ('weeks'|'months' แสดงผลเท่านั้น), `start_date`/`end_date` (วันท้องถิ่น รวมปลาย), `tz`, `created_at`/`updated_at` · index `(user_id, end_date)`
- `busy_routine_skip` (`routine_id` → busy_routine cascade, `local_date`) PK คู่ — วันที่ผู้ใช้ลบ/แยกออก กันการขยายใหม่ฟื้นกลับ
- `busy_block.routine_id` (nullable, **ไม่มี FK** เหมือน `series_id` — drizzle-kit ทำ cascade หาย · แถวถูกลบด้วยคำสั่งชัดเจนใน tx เดียวกับการลบกฎ · ไม่ backfill) + partial index `(user_id, routine_id) WHERE routine_id IS NOT NULL` · แถว routine คือ busy ธรรมดาสำหรับทุกทางอ่านของกลุ่ม (ปฏิทิน วันว่าง เตือนนัดทับ ไม่แก้) · `routine_id` และตารางกฎไม่ออกถึงคนอื่น (ADR 0006)
- บันทึก/แก้ = เขียนกฎ + ขยายแถวด้วย `routineRange`/`expandRoutine` (`src/lib/calendar`, กฎ 9) ใน tx เดียว · เพดาน: busy เดี่ยว 300 นับเฉพาะ `routine_id IS NULL` · routine ที่ยังไม่จบ ≤ 10/คน (สร้างใหม่/ต่ออายุชุดที่จบแล้ว — การแยกตอนแก้ "ตั้งแต่…ไป" ไม่นับ, B12) · เพดานแข็ง 20 ชุดที่ยังไม่จบ ทุกทางรวมการแยก (§10) · แก้ในที่จนเหลือ 0 วันในอนาคต = `VALIDATION weekdays NO_OCCURRENCE` · "วันนี้" ตอนแก้ใช้ tz เดิมของ routine · วันของ routine ในอนาคต ≤ 1,500/คน · ช่วง ≤ 26 สัปดาห์/6 เดือน · วันจบ ≤ วันนี้ + 12 เดือน · rate limit `busy:routine` 20/10 นาที (R14_CONTRACT §1.2, §9)
- cron (`maintenance.ts`) ลบ `busy_routine` ที่จบเกิน 93 วัน (90 + 3 ให้แถว busy หมดอายุก่อน)
- เพดานแถวต่อคำขอ (B11): ปฏิทินกลุ่มที่ส่งรายการให้ client = `CALENDAR_MAX_ITEMS` 5,000 · ทางคำนวณวันว่างร่วม/เตือนนัดทับ (ไม่ส่งรายการ) = คำนวณจาก `FREE_TIME_MAX_ITEMS` 32,000 แต่ availability ส่งรายละเอียด busy ให้ client ≤ 5,000 ชิ้น + ธง `detailTruncated` (วันว่างยังถูก, §10) · ก่อนป้อน `commonFreeTime` รวมช่วงที่ติด/ทับกันของสมาชิกคนเดียวกันด้วย `mergeBusyForFreeTime` (ผลวันว่างเท่าเดิม)

### ไอคอนกลุ่ม + migration 0006 (R15, [R15_CONTRACT](../contracts/R15_CONTRACT.md) §1.2, §1.5)
- **`groups.icon text NULL`** — เพิ่มอย่างเดียว (`ALTER TABLE groups ADD icon text` ไม่ rebuild ตาราง · ไม่ backfill · แถวเดิมเป็น NULL = ไอคอนเริ่มต้น "แมว") · **ไม่ใส่ CHECK ใน DB** เพื่อให้เพิ่ม/ถอดคีย์ได้โดยไม่ต้อง migration (allowlist บังคับใน service + เทสต์)
- **allowlist คีย์เป็น constant กลางที่เดียว** (platform ทำจากรายการของ ux · อยู่ที่ `src/lib/shared/group-icons.ts`): `GROUP_ICON_KEYS` (`as const`, ~24 คีย์ ASCII kebab-case เช่น `food`, `badminton`) + `DEFAULT_GROUP_ICON` · เซิร์ฟเวอร์ใช้ใน zod (`z.enum(GROUP_ICON_KEYS).nullable()`) · UI ใช้ map คีย์ → ไฟล์ SVG ของ ux · ห้ามรับรูป/URL/emoji/ข้อความอิสระ
- **อ่าน**: ค่าใน DB ที่ไม่อยู่ใน allowlist ปัจจุบัน (เช่นคีย์ที่ถอดออกภายหลัง) → แสดงเป็นไอคอนเริ่มต้น ไม่ error · DTO ส่ง `icon: string | null` ทุกที่ที่ส่งชื่อกลุ่มอยู่แล้ว (หัวปฏิทิน/ตัวเลือกกลุ่ม, การ์ดหน้ากลุ่ม, หน้าหลัก)
- **เขียน**: action `group.icon.update` (auth, R15 §8 — ผู้ดูแล/ผู้ช่วยดูแล + SA ตามกติกาแก้กลุ่มเดิม) ตรวจที่เซิร์ฟเวอร์ (กฎ 6) · กลุ่มที่ลบแล้ว → `NOT_FOUND` แบบเดียวกับ `group.update` · ส่ง `null` = กลับไปไอคอนเริ่มต้น · route จริง `PUT /api/groups/:gid/icon` (rate limit `group:icon` 30/10 นาที)
- **ลบ `place_search_cache`** + งาน cron `stalePlaceSearchCache` ในไฟล์ migration เดียวกัน — ย้อนไม่ได้ ([ADR 0013](../adr/0013-drop-place-search-cache.md)) · rollback = ย้อนแอปอย่างเดียว ตารางหายถาวร (รุ่นเก่ามีงาน cron ที่อ้างตารางนี้ใน batch เดียว → ดูขั้นตอนใน ADR 0013)
- ผลกับรุ่นเดิม: รุ่นก่อน 0006 ไม่อ่าน `groups.icon` → ไม่กระทบ · เทสต์: `tests/platform/migration-0006.test.ts` (ฐานที่มีข้อมูล R14 → ข้อมูลเดิมเท่าเดิม, `groups.icon` NULL, ไม่มีตาราง cache — R15-1)

### ความต่างจาก "โมเดลข้อมูลร่าง" ใน PRD §5 (เหตุผลสั้น)
| PRD ร่าง | ฉบับนี้ | เหตุผล |
|---|---|---|
| `user.failed_attempts`, `locked_until` | ย้ายไป `login_throttle` (คีย์ด้วย username ที่พิมพ์) | lockout ต้องเหมือนกันไม่ว่าบัญชีมีจริงหรือไม่ (U1 AC กันไล่ชื่อ) — ADR 0002 §3 |
| `user.username` | + `username_normalized` (unique) | D2 ไม่สนตัวพิมพ์ แต่แสดงตามที่พิมพ์ |
| — | `user.pin_pepper_version`, `updated_at`, `deleted_at` | rotation pepper, ลบบัญชี (U13) |
| `session(id, user_id, expires_at, user_agent)` | + `created_at`, `last_seen_at`; `id` = hash ของ token | ADR 0002 §4 |
| `pin_reset_request` | + `device_token_hash`, `requester_ua/country`, `pending_expires_at`, `used_at` | ผูก `123456` กับเครื่อง + ข้อมูลให้ admin ยืนยัน (ADR 0002 §6) |
| `group` | ชื่อตาราง `groups` + `tz`, `updated_at` · + `icon` (R15) | คำสงวน SQL · ADR 0004 §4 · ไอคอนกลุ่ม R15 §1.2 |
| `group_invite` | + `code_hint`, `uses_count`, `revoked_by` | U5/U6 รายการโค้ด + audit |
| `busy_block` | + `created_at/updated_at`, index · + `series_id` (R6F) · + `routine_id` (R14) | ชุดรายวัน ADR 0010 · routine ADR 0012 |
| — | `busy_routine`, `busy_routine_skip` (R14) | busy ทำซ้ำรายสัปดาห์ (ADR 0012) |
| `group_member` | + `color_slot`, `shape_slot` (R6C) | สมาชิกเลือกสี/รูปทรงเองในกลุ่ม |
| `appointment` | + `local_date`, `cancelled_*`, timestamps · + `scheduled_at` (R10) | U10.2 นัดยกเลิกยังเห็นได้ · ตัดสินเตือนก่อนนัด (ADR 0011) |
| — | `appointment_reminder`, `line_link_code` (R10) | กันเตือนซ้ำ · เชื่อม LINE ด้วยโค้ดครั้งเดียว (ADR 0011) |
| `appointment_rsvp` | + `updated_at` | — |
| `audit_log(target)` | แยก `target_type`, `target_id`, `group_id`, `meta` | ค้น/กรองในหน้า admin (U12) |
| `notification_outbox` | + `notification_id`, `next_attempt_at`, `last_error`, `sent_at` | retry (ADR 0007) |
| — | `rate_limit_bucket`, ~~`place_search_cache`~~ (ลบใน 0006) | rate limit ไม่มี Redis (ADR 0002) · Nominatim policy (ADR 0001) — เลิกใช้ R13, ลบ R15 (ADR 0013) |
| — | `pepper_fingerprint`, `system_heartbeat` | ตรวจ pepper ผิดค่า (ADR 0002 §7.2) · keep-alive Turso (ADR 0001 §3.1) |

### กฎข้อมูลที่ schema บังคับไม่ได้ (บังคับใน service + เทสต์)
- username: `^[a-z0-9._]{3,20}$` หลัง normalize (ASCII เท่านั้น กันตัวอักษรหน้าตาเหมือนกัน) · display name: 1–40 ตัวอักษรใดก็ได้ (ไทยได้)
- ลบบัญชี (U13): ต้องไม่ถือ role admin กลุ่มใด → ลบ session, busy, busy routine (ต้องลบเอง — anonymize ไม่เกิด cascade, ADR 0012), rsvp, notification, membership, คำเชิญค้าง → anonymize แถว user (`username_normalized = 'deleted:'||id`, `username=''`, `display_name=''`, `pin_hash=NULL`, `line_user_id=NULL`, `status='deleted'`) — คงแถวไว้ให้ FK ของนัด/audit · UI แสดงชื่อเป็นคีย์แปล "ผู้ใช้ที่ลบบัญชีแล้ว"
- หมดอายุทุกชนิด (โค้ดเชิญ, reset) ตรวจแบบ lazy ตอนอ่าน — cron แค่เก็บกวาด

## 4. Session และ actor (สรุป — ละเอียดใน ADR 0002 §4)
`getActor(cookies)`: ไม่มี cookie → `{kind:'anonymous'}` · มี → `SELECT … FROM session JOIN user WHERE session.id = sha256(token) AND expires_at > now` → ไม่เจอ/หมดอายุ → anonymous + ลบ cookie · `user.status != 'active'` → ลบ session ทั้งหมดของ user แล้วถือเป็น anonymous · คืน `{kind:'user', id, isSuperAdmin, status, mustChangePin}`
Layout `(app)` เรียก `getActor` → anonymous → redirect `/login` · `mustChangePin` → redirect `/set-pin` (เป็น UX เท่านั้น ด่านจริงคือ `can()`)

## 5. API endpoint ต่อ story
ทุก endpoint: JSON, prefix `/api`, ผ่าน wrapper ข้อ 2 · ตารางนี้ **ตรงกับ `ROUTE_MANIFEST` ใน `src/app/api/_lib/manifest.ts` ที่ v0.14.0 ทีละแถว (R16 ไม่มี route ใหม่) + R17 (ยังไม่ออกรุ่น) เพิ่ม `POST /api/admin/groups/:gid/restore`** — path เขียนแบบ manifest (`:param`) · คอลัมน์ "action" = ชื่อใน [ADR 0003](../adr/0003-rbac.md) ที่ service เรียก · "auth" = `actor` (session + CSRF Origin/JSON สำหรับ non-GET) / `cron` (Bearer `CRON_SECRET`) / `public` · "เจ้าของ" = บทบาทที่เขียน route
เพิ่ม/เปลี่ยน route ใน manifest ต้องแก้ตารางนี้ใน PR เดียวกัน (DOCS_SYNC §2) · เทสต์ `tests/ops/docs-sync.test.ts` ตรวจว่าทุก path ใน manifest มีในไฟล์นี้

| Story | Method + path | action (RBAC) | auth | หมายเหตุ | เจ้าของ |
|---|---|---|---|---|---|
| ระบบ | `GET /api/cron/daily` | — | cron | ข้อ 8 · งานแรก = เขียน heartbeat | Platform |
| ระบบ | `POST /api/cron/heartbeat` | — | cron | GitHub Actions ทุก 12 ชม. เขียน heartbeat แล้วคืน `heartbeatAgeHours` | Platform |
| ระบบ | `GET /api/health` | — | public | 200/503 + `checks: {db, pepper, heartbeat}` เป็น pass/fail เท่านั้น (ADR 0002 §7.1) | OPS |
| U14, U15 | `POST /api/prefs` | `prefs.cookie.set` | actor | `{locale?, theme?}` ตั้ง cookie (ก่อนล็อกอิน / must_change_pin) · ล็อกอินอยู่ + ส่ง locale → บันทึก `user.locale` ด้วย (R15b) · R16 H2: ล็อกอินอยู่ → RL `prefs:update` 60/10 นาที/ผู้ใช้ (เกิน = 429 ไม่ตั้งคุกกี้ใหม่ คุกกี้เดิมคงอยู่) · ไม่ได้ล็อกอินไม่นับ | Platform |
| U1 | `POST /api/auth/signup` | `auth.signup` | actor | `{username, displayName, pin, pinConfirm}` · RL 5/ชม./IP · สร้าง session ทันที · locale/theme จาก cookie | Auth |
| U1 | `POST /api/auth/login` | `auth.login` | actor | `{username, pin}` · throttle (ADR 0002 §3) · ตั้ง cookie session + `mm_locale`/`mm_theme` จากบัญชี | Auth |
| U1, U3 | `POST /api/auth/logout` | `auth.logout` | actor | ลบ session ปัจจุบัน · อนุญาตระหว่าง must_change_pin | Auth |
| U1, U13 | `POST /api/auth/logout-all` | `self.session.revokeAll` | actor | ลบทุก session ของตัวเอง | Auth |
| U1 | `GET /api/auth/session` | `self.read` | actor | คืน `{id, username, displayName, isAdmin, mustChangePin, locale, theme}` หรือ 401 | Auth |
| U2 | `POST /api/auth/pin-reset` | `auth.pinReset.request` | actor | `{username}` · ตอบ 202 เหมือนกันทุกกรณี + cookie `mm_reset` | Auth |
| U2 | `GET /api/auth/pin-reset/status` | `auth.pinReset.status` | actor | จาก cookie `mm_reset`: `pending \| approved(expiresAt) \| closed` | Auth |
| U2, U12 | `GET /api/auth/admin/pin-resets` | `pinReset.list` | actor | `?status=` · รายการคำขอ + requester_ua/country | Auth |
| U2, U12 | `POST /api/auth/admin/pin-resets/:id/approve` | `pinReset.decide` | actor | → approved, pin_hash = NULL, audit, notification | Auth |
| U2, U12 | `POST /api/auth/admin/pin-resets/:id/reject` | `pinReset.decide` | actor | → rejected, audit | Auth |
| U3, U13 | `POST /api/auth/pin` | `self.pin.change` | actor | `{newPin, newPinConfirm, currentPin?}` (currentPin ไม่ต้องเมื่อ must_change_pin) | Auth |
| U4 | `POST /api/groups` | `group.create` | actor | `{name}` → ผู้สร้างเป็น admin | Platform |
| U4 | `GET /api/groups` | `group.list.mine` | actor | กลุ่มที่เป็นสมาชิก + role ของฉัน + `icon` | Platform |
| U4, U6 | `GET /api/groups/:gid` | `group.view` | actor | รายละเอียด + สมาชิก (id, display name, role, สี/รูปทรง) | Platform |
| U6, D9 | `PATCH /api/groups/:gid` | `group.update` | actor | `{name?, freeWindowStartMin?, freeWindowEndMin?, minFreeMinutes?}` · R16 H1: RL `group:settings` 30/10 นาที/ผู้ใช้ (ทุกกลุ่มรวม) นับหลังด่านบัญชี — 404/403 ของด่านกลุ่มก็นับ (ถังเต็ม → 429 แทน 404/403) · ด่านบัญชี (anonymous/suspended/must_change_pin) ไม่นับ | Platform |
| U6 | `DELETE /api/groups/:gid` | `group.delete` | actor | soft delete + audit | Platform |
| U6 (R15) | `PUT /api/groups/:gid/icon` | `group.icon.update` | actor | `{icon: <คีย์ใน allowlist> \| null}` · `.strict()` · RL `group:icon` · route แยกเพื่อให้ 1 route = 1 action | Platform |
| U6, D7 | `DELETE /api/groups/:gid/members/:uid` | `member.remove` | actor | 409 ถ้าเป้าหมายเป็น admin | Platform |
| U6 | `PATCH /api/groups/:gid/members/:uid` | `member.setRole` | actor | `{role: 'moderator' \| 'member'}` | Platform |
| R6C | `PATCH /api/groups/:gid/members/me/appearance` | `member.setOwnAppearance` | actor | `{color: 1–10 \| null, shape: 1–10 \| null}` → `group_member.color_slot/shape_slot` · RL `member:appearance` | Platform |
| U6, D8 | `POST /api/groups/:gid/transfer-admin` | `group.transferAdmin` | actor | `{toUserId}` · admin เดิมกลายเป็น moderator | Platform |
| U6, D8 | `POST /api/groups/:gid/leave` | `group.leave` | actor | 409 ถ้าเป็น admin | Platform |
| U5 (ก) | `POST /api/groups/:gid/invites/direct` | `invite.direct.create` | actor | `{username}` · RL 30/ชม. · สร้าง notification `group.invite.received` — R16 H4: params มี `actorSystemAdmin` (super admin ที่ไม่ใช่สมาชิกเชิญ → `true` + `inviterName ''`) · คำตอบ `invite` เป็น `InviteDto` มี `creatorSystemAdmin` (H4c — กติกาเดียวกับรายการคำเชิญ) | Platform |
| U5 (ข) | `POST /api/groups/:gid/invites/code` | `invite.code.create` | actor | คืนโค้ด **ครั้งเดียว** (`XXXX-XXXX`, alphabet 31 ตัว ตัด 0 O 1 I L) + expiresAt | Platform |
| U5, U6 | `GET /api/groups/:gid/invites` | `invite.list` | actor | MEM เห็นเฉพาะของตัวเอง · `InviteDto` มี `creatorSystemAdmin` — R16 H4c: ผู้สร้างเป็น super admin และไม่ใช่สมาชิกกลุ่มนั้น *ณ ตอนอ่าน* → `true` + `creatorName ''` (UI แสดง `common.systemAdmin`; `creatorName ''` + ธง false = บัญชีที่ลบแล้ว) · ธงภายใน `creatorIsSuperAdmin`/`creatorIsMember` ไม่ออกทาง API | Platform |
| U5, U6 | `DELETE /api/groups/:gid/invites/:iid` | `invite.revoke` | actor | | Platform |
| U5 (ข) | `POST /api/invites/redeem` | `invite.code.redeem` | actor | `{code}` · ผิด/หมดอายุ/เพิกถอน → `INVITE_INVALID` เดียวกัน · RL ADR 0002 · สมาชิกเดิม → 200 ไม่สร้างแถว | Platform |
| U5 (ก) | `GET /api/me/invites` | `invite.direct.list.mine` | actor | คำเชิญตรงที่ค้าง · DTO `{id, groupId, groupName, inviterName, createdAt, expiresAt, actorSystemAdmin}` — R16 H4b: ผู้สร้างเป็น super admin และไม่ใช่สมาชิกกลุ่มนั้น *ณ ตอนอ่าน* → `actorSystemAdmin: true` + `inviterName ''` (UI แสดง `common.systemAdmin`) · ธงภายใน `inviterIsSuperAdmin`/`inviterIsMember` ไม่ออกทาง API | Platform |
| U5 (ก) | `POST /api/me/invites/:iid/accept` | `invite.direct.respond` | actor | | Platform |
| U5 (ก) | `POST /api/me/invites/:iid/decline` | `invite.direct.respond` | actor | | Platform |
| U7 | `GET /api/me/busy` | `busy.list.own` | actor | `?from&to` · เห็นครบรวม note | Platform |
| U7 | `POST /api/me/busy` | `busy.create` | actor | `{allDay, startDate, endDate, startTime?, endTime?, tz?, title?, note?, hideDetail}` → `normalizeBusyInput` (ADR 0004) · ชุดรายวัน (ADR 0010) | Platform |
| U7 | `PATCH /api/me/busy/:id` | `busy.update` | actor | เจ้าของเท่านั้น · บนแถว routine = แยกเป็น busy เดี่ยว + skip | Platform |
| U7 | `DELETE /api/me/busy/:id` | `busy.delete` | actor | เจ้าของเท่านั้น · บนแถว routine = ลบวันนั้น + บันทึก skip | Platform |
| U7 (R14) | `GET /api/me/busy-routines` | `busy.routine.list.own` | actor | routine ของฉัน (รวม note) + จำนวนวันที่เหลือ + `skippedDates` · ชุดที่ยังไม่จบครบทุกชุด + ที่จบแล้ว ≤ 50 · ADR 0012 | Platform |
| U7 (R14) | `POST /api/me/busy-routines` | `busy.routine.create` | actor | กฎ (`weekdays`, เวลา/all-day, ช่วง weeks/months) → ขยายแถวใน tx เดียว · zod `.strict()` | Platform |
| U7 (R14) | `PATCH /api/me/busy-routines/:id` | `busy.routine.update` | actor | เจ้าของเท่านั้น (SA ไม่ได้) · `from` = แก้ตั้งแต่สัปดาห์/เดือนนั้น (ไม่ส่ง = ทุกวันที่ยังไม่ผ่าน) | Platform |
| U7 (R14) | `DELETE /api/me/busy-routines/:id` | `busy.routine.delete` | actor | `?from=` · มี `from` = หยุดตั้งแต่วันนั้น · ไม่มี = ลบทั้งหมดรวมอดีต | Platform |
| U7 (R15) | `POST /api/me/busy-routines/:id/skips` | `busy.routine.update` | actor | `{add?, remove?}` ≤ 31 วัน · tx เดียว ทั้งหมดหรือไม่มี · RL `busy:routine` · คืนวัน = ขยายใหม่ตามกฎปัจจุบัน เฉพาะวันที่ยังไม่ผ่าน · เพดาน 1,500 — ADR 0012 §13 | Platform |
| U8 | `GET /api/groups/:gid/calendar` | `group.calendar.view` | actor | `?from&to` ≤ 62 วัน · หน้าจอเดือนส่งช่วง `monthGrid()` **เริ่มวันจันทร์** (ADR 0004) · busy กรองตาม ADR 0006/0009 · นัดในช่วง · ≤ 5,000 รายการ | Platform |
| U9, U9.1 | `GET /api/groups/:gid/availability` | `group.availability.view` | actor | `?from&to` · ผล ADR 0005 + blockers (กรอง ADR 0006) · คำนวณจาก ≤ 32,000 แถว + รวมช่วงต่อคน (R14 B11) · ส่งรายละเอียด ≤ 5,000 + `detailTruncated` | Platform |
| U10, U10.1 | `POST /api/groups/:gid/appointments` | `appointment.create` | actor | บันทึก + `warnings` + notification `appointment.created` · RL `appt:create:s`/`appt:create:d` | Platform |
| U8, U10 | `GET /api/groups/:gid/appointments` | `appointment.view` | actor | `?from&to` · รวมนัดที่ยกเลิก (U10.2) | Platform |
| U10, U10.1 | `POST /api/groups/:gid/appointments/check` | `appointment.create` | actor | ตรวจนัดทับ busy ล่วงหน้า คืน `warnings` ไม่บันทึก | Platform |
| U10 | `GET /api/appointments/:id` | `appointment.view` | actor | + RSVP สรุป + ของฉัน | Platform |
| U10.2 | `PATCH /api/appointments/:id` | `appointment.update` | actor | คืน `warnings` ใหม่ | Platform |
| U10.2 | `POST /api/appointments/:id/cancel` | `appointment.cancel` | actor | status = cancelled (ยังเห็นได้) · แจ้ง `appointment.cancelled` (ส่ง LINE หลังตอบ API — R11) | Platform |
| U10.1 | `PUT /api/appointments/:id/rsvp` | `appointment.rsvp` | actor | `{response: 'going' \| 'maybe' \| 'not_going'}` | Platform |
| R12 | `GET /api/appointments/:id/calendar.ics` | `appointment.view` | actor | ไฟล์ .ics ชื่อคงที่ `maewmeet-plan.ics` · เปิดแบบ navigate แล้วไม่สำเร็จ → 303 ไปหน้านัด · cross-site navigate → FORBIDDEN | Platform |
| U11 | `GET /api/me/appointments` | `appointment.list.mine` | actor | `?limit&rsvp=` · นัด active ที่ยังไม่จบ ข้ามทุกกลุ่ม · `rsvp=going` = นัดที่ฉันตอบไป (R6D) | Platform |
| ADR 0007 | `GET /api/me/notifications` | `notification.list.own` | actor | `?cursor=` | Platform |
| ADR 0007 | `POST /api/me/notifications/read` | `notification.markRead.own` | actor | | Platform |
| U13, U14, U15 | `PATCH /api/me` | `self.update` | actor | `{displayName?, locale?, theme?}` · ตั้ง cookie ภาษา/ธีมด้วย · RL `me:rename` (ข้อมูลตัวเองอ่านผ่าน `GET /api/auth/session`) | Platform |
| U13 | `POST /api/me/delete` | `self.delete` | actor | `{pin, confirmUsername}` (`.strict()`) · R17 A1: `confirmUsername` normalize แบบ login ต้องตรงชื่อผู้ใช้ของตัวเอง — ไม่ส่ง/ไม่ตรง → 400 `VALIDATION` `{fields:{confirmUsername:'REQUIRED'\|'MISMATCH'}}` ก่อน verify PIN (ไม่นับเป็น PIN ผิด) · 409 ถ้ายังเป็น admin กลุ่ม · ล้างข้อมูลทันที กู้ไม่ได้ (ADR 0015 B1) · ล้างคุกกี้ session + `mm_group` | Platform |
| U12 | `GET /api/admin/users` | `admin.user.list` | actor | `?q=&cursor=` · ค้นหา username/display name + สถานะล็อก | Platform |
| U12 | `POST /api/admin/users/:id/suspend` | `admin.user.suspend` | actor | ลบทุก session · audit | Platform |
| U12 | `POST /api/admin/users/:id/unsuspend` | `admin.user.suspend` | actor | audit | Platform |
| U12 | `POST /api/admin/users/:id/unlock` | `admin.user.unlock` | actor | ลบ `login_throttle` ของ username นั้น · audit | Platform |
| U12 | `GET /api/admin/groups` | `admin.group.list` | actor | `?q=&status=active\|deleted\|all&cursor=` · โอน admin/ลบกลุ่มใช้ endpoint กลุ่มปกติ (SA ผ่าน policy) · R17: แต่ละแถวมี `purgeAt` (epoch ms ที่จะลบถาวร · null = ยังไม่ลบ) · `restorable` · `restoreBlockedReason` (`'RETENTION_EXPIRED'\|'NO_ACTIVE_ADMIN'\|null`) คำนวณที่เซิร์ฟเวอร์ (ADR 0015 §2–3) | Platform |
| U12 | `GET /api/admin/groups/:gid` | `admin.group.view` | actor | รายละเอียดกลุ่มเพื่อดูแล (ไม่มี busy/รายละเอียดนัด) + audit · R17: มี `purgeAt`/`restorable`/`restoreBlockedReason` เหมือนรายการ | Platform |
| R17 G1 | `POST /api/admin/groups/:gid/restore` | `admin.group.restore` | actor | super admin เท่านั้น (ไม่ใช่ SA → 403 แบบ admin route อื่น) · limiter เขียนของ admin · UPDATE มีเงื่อนไขคำสั่งเดียว (ยังลบอยู่ + ยังไม่ถึง `purgeAt` + มี admin ที่บัญชี active) → audit `group.restore` + notify `group.restored` ในธุรกรรมเดียว · 200 `{group:{id, restored:true, changed}}` (`changed:false` = ไม่ได้ลบอยู่) · 404 ไม่มี/ลบถาวรแล้ว · 409 `CONFLICT {reason:'RETENTION_EXPIRED'\|'NO_ACTIVE_ADMIN'}` (ADR 0015 §3) | Platform |
| U12 | `GET /api/admin/audit` | `admin.audit.view` | actor | `?cursor=&targetType=` | Platform |
| R6D G1 | `PUT /api/me/current-group` | `member.setCurrentGroup` | actor | `{gid}` → คุกกี้ `mm_group` · ไม่ใช่สมาชิก → 404 ไม่มี Set-Cookie (ADR 0009 §5) | Platform |
| R10 | `GET /api/cron/reminders` | — | cron | เตือนก่อนนัด (Vercel Schedules ทุก 15 นาที เรียกแบบ GET) · รันซ้ำได้ · จากนั้นส่ง outbox LINE (ADR 0011) | Platform |
| R10 | `POST /api/cron/reminders` | — | cron | ทำงานเหมือน GET (เผื่อตัวเรียกภายนอก เช่น fallback cron-job.org ตาม ADR 0011 — ยังไม่ได้ใช้) | Platform |
| R10 | `POST /api/line/webhook` | — | public | ไม่มี actor/CSRF · ด่านคือ `X-Line-Signature` กับ raw body (`LINE_MESSAGING_CHANNEL_SECRET`) · body ≤ 256 KB · ≤ 20 events · รับโค้ดเชื่อมจากแชท OA → ตั้ง `user.line_user_id` | Integrations |
| R10 | `GET /api/me/line` | `self.read` | actor | สถานะเชื่อม LINE ของฉัน (ไม่ส่ง LINE user id ออก) | Platform |
| R10 | `POST /api/me/line` | `self.update` | actor | สร้างโค้ดเชื่อม (คืนครั้งเดียว · DB เก็บ HMAC · อายุ 10 นาที) → 201 · RL `line:code:create` | Platform |
| R10 | `DELETE /api/me/line` | `self.update` | actor | ยกเลิกการเชื่อม | Platform |
| U10 (เลิกใช้) | ~~`GET /api/places/search?q=`~~ | ~~`place.search`~~ | — | เอาออกแล้ว R13 · ตาราง cache ลบ R15 (ADR 0013) · **ไม่อยู่ใน manifest** | — |

ครอบคลุม story: U1 ✓ U2 ✓ U3 ✓ U4 ✓ U5 ✓ U6 ✓ U7 ✓ U8 ✓ U9 ✓ U9.1 ✓ U10 ✓ U10.1 ✓ U10.2 ✓ U11 ✓ U12 ✓ U13 ✓ U14 ✓ U15 ✓

## 6. รหัส error (union เดียว — `src/lib/shared/errors.ts` ★)
| กลุ่ม | รหัส |
|---|---|
| ทั่วไป | `VALIDATION` `NOT_FOUND` `FORBIDDEN` `CONFLICT` `RATE_LIMITED` `FEATURE_DISABLED` `UNKNOWN` |
| auth | `AUTH_MAINTENANCE`(503 — pepper ใช้ไม่ได้, ADR 0002 §7.1) `AUTH_REQUIRED` `ACCOUNT_SUSPENDED` `PIN_CHANGE_REQUIRED` `INVALID_CREDENTIALS`(params: attemptsRemaining) `LOGIN_LOCKED`(retryAfterSec) `USERNAME_TAKEN` `USERNAME_FORMAT` `PIN_FORMAT` `PIN_MISMATCH` `PIN_TOO_WEAK` `CSRF_REJECTED` |
| กลุ่ม/คำเชิญ | `ADMIN_TRANSFER_REQUIRED` `INVITE_INVALID` `ALREADY_MEMBER`(ใช้เป็นผลสำเร็จแบบมีธง ไม่ใช่ error) `USER_NOT_FOUND`(ชวนตรง — ดู Q4) |
| เวลา | `INVALID_RANGE` `INVALID_DATE` `INVALID_LOCAL_TIME` `TIME_NOT_ON_STEP` `DATE_OUT_OF_RANGE` `RANGE_TOO_LARGE` `INVALID_TIMEZONE` `INVALID_WINDOW` |
| นัด | `INVALID_MAP_URL` `INVALID_COORDINATES` `APPOINTMENT_CANCELLED` |
ทุกรหัสมีคีย์ `errors.<CODE>` ใน `messages/th.json` และ `en.json` (ADR 0008 เทสต์ข้อ 4)

## 7. ตัวแปร env (ตรงกับ `.env.example` ที่ v0.14.0 — ไม่มีค่าจริง · R16 ไม่มีตัวแปรใหม่)
แหล่งความจริง: `.env.example` (เจ้าของ OPS) + schema zod ใน `src/lib/shared/env.ts` · ขั้นตั้งค่าบน Vercel และวิธีสร้างความลับ: `docs/OPERATIONS.md` (ส่วน C, D, J) · ห้ามใส่ค่าจริงในไฟล์/แชท/PR (กฎ 7)

| ตัวแปร | ต้องมีเมื่อ | ใช้ทำอะไร |
|---|---|---|
| `TURSO_DATABASE_URL` | ทุกสภาพแวดล้อม | `libsql://…` · dev/test ใช้ `file:` |
| `TURSO_AUTH_TOKEN` | prod/preview | token ของ DB (ว่างได้เมื่อใช้ `file:`) |
| `PIN_PEPPER_CURRENT_VERSION` | ทุกสภาพแวดล้อม (ดีฟอลต์ 1) | เวอร์ชัน pepper ที่ใช้ hash ใหม่ (ADR 0002 §7.3) |
| `PIN_PEPPER_V1` (`PIN_PEPPER_V<n>`) | ทุกสภาพแวดล้อม | base64 ≥ 32 ไบต์ · ไม่มีค่าดีฟอลต์ — หาย/ว่าง/ผิดค่า → login ปิด (`AUTH_MAINTENANCE`) · Vercel Type Secret แยกค่า Production/Preview · หมุนโดยเพิ่ม `PIN_PEPPER_V2` |
| `APP_SECRET` | ทุกสภาพแวดล้อม | base64 ≥ 32 ไบต์ · HKDF แยก subkey: invite-code HMAC, rate-limit IP HMAC, LINE link-code HMAC |
| `CRON_SECRET` | ทุกสภาพแวดล้อม | ≥ 16 ตัวอักษร · Vercel ส่งเป็น `Authorization: Bearer` ให้ cron/schedule · ใส่ค่าเดียวกันใน GitHub Secrets (`CRON_SECRET` + `APP_ORIGIN`) ให้ workflow keepalive |
| `APP_ORIGIN` | prod (preview ใช้ `VERCEL_URL` ถ้าว่าง) | ตรวจ Origin (CSRF) · ลิงก์ในข้อความ LINE/.ics |
| `TRUST_PROXY_HEADERS` | ไม่บังคับ (Vercel ไม่ต้องตั้ง) | `1` = เชื่อ header IP จาก reverse proxy · ไม่ตั้งและไม่มี `VERCEL` = ทุกคำขอรวมถัง `unknown` เพดาน ×50 |
| `LOG_LEVEL` | ไม่บังคับ (ดีฟอลต์ `info`) | `debug\|info\|warn\|error` — ห้าม log PIN/hash/token/โค้ดเชิญ/โค้ดเชื่อม LINE ทุกระดับ |
| `SERVER_TIMING_ENABLED` | ไม่บังคับ | R7: `true\|false` · ว่าง = เปิดยกเว้น `VERCEL_ENV=production` · header มีแค่จำนวน query + เวลา |
| `LINE_MESSAGING_ACCESS_TOKEN` | Production เท่านั้น (R10) | Channel access token ของ LINE OA ใช้ Push/Reply · ว่าง = ช่องทาง LINE ปิดเงียบ กระดิ่งทำงานปกติ |
| `LINE_MESSAGING_CHANNEL_SECRET` | Production เท่านั้น (R10) | ตรวจ `X-Line-Signature` ของ `POST /api/line/webhook` |

ไม่ใช้แล้ว (ลบจาก `.env.example`): `PLACE_SEARCH_ENABLED`, `NOMINATIM_BASE_URL`, `NOMINATIM_CONTACT`, `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION` (R13 เอาค้นหาสถานที่/แผนที่ออก) · ไม่ใช้ LINE Login (`LINE_LOGIN_*` ไม่มี — เชื่อมบัญชีด้วยโค้ดในแชท OA ตาม ADR 0011)
ตัวแปรที่ Vercel ใส่ให้เอง (ไม่อยู่ใน `.env.example`): `VERCEL`, `VERCEL_URL`, `VERCEL_ENV` · เทสต์ (Vitest) สร้าง `TURSO_DATABASE_URL=file:<tmp>` และความลับสุ่มต่อรอบเอง · แอป **ล้มตอนเริ่ม** ถ้าตัวแปร "ต้องมี" หายหรือสั้นเกิน (zod ใน `src/lib/shared/env.ts`) — ยกเว้น pepper ที่ล้มเป็น `AUTH_MAINTENANCE` แทน

## 8. งานตามเวลา (cron)
ที่มา: `vercel.json` (OPS) + `.github/workflows/keepalive.yml` (OPS) ที่ v0.14.0 (R16 ไม่เปลี่ยนตาราง cron — keepalive แก้เฉพาะ comment เรื่อง repo public)

| ตัวเรียก | ตาราง | เรียก | หมายเหตุ |
|---|---|---|---|
| Vercel Cron Jobs (`crons`) | `0 19 * * *` (19:00 UTC ≈ 02:00 Asia/Bangkok, Hobby คลาดได้ในชั่วโมงนั้น) | `GET /api/cron/daily` | งานรายวันด้านล่าง · ทำงานเฉพาะ production deployment |
| Vercel Schedules (`schedules.reminders`) | `*/15 * * * *` timezone `Asia/Bangkok` | `GET /api/cron/reminders` | R10 เตือนก่อนนัด 1 วัน / 1 ชม. / ชวนตอบ RSVP แล้วส่งคิว LINE · Hobby มี jitter ในกรอบ 15 นาที · fallback ที่เตรียมไว้ (ยังไม่ใช้): cron-job.org เรียก endpoint เดิม (ADR 0011) |
| GitHub Actions `keepalive.yml` | `17 */12 * * *` + `workflow_dispatch` | `POST /api/cron/heartbeat` → `GET /api/health` | keep-alive ชั้นที่ 2 ของ Turso + สัญญาณเตือน: ล้ม (exit 1) ถ้า status ≠ 2xx หรือ heartbeat `vercel-cron` เก่ากว่า 48 ชม. → GitHub ส่งอีเมล |

ทุกตัวใช้ `Authorization: Bearer <CRON_SECRET>` (ตรวจแบบ constant-time ใน route wrapper) และทุกงาน idempotent — Vercel อาจยิงซ้ำหรือข้าม

**งานของ `/api/cron/daily`** (`src/lib/data/services/maintenance.ts` + `src/lib/data/repos/maintenance.ts`, รันเป็น batch เดียว):
0. (ก่อนทุกข้อ) **เขียน** `system_heartbeat('vercel-cron')` — keep-alive ชั้นที่ 1 (ADR 0001 §3.1)
1. ลบ `session` ที่หมดอายุ · `rate_limit_bucket` ที่ `window_start` เก่ากว่า 2 วัน · `login_throttle` ที่ไม่ล็อกและไม่ขยับ 30 วัน
2. เปลี่ยนสถานะ `pin_reset_request` (pending/approved) / `group_invite` ที่หมดอายุเป็น `expired` (สำรอง — กลไกหลักคือ lazy)
3. ลบ `notification` เก่ากว่า 90 วัน · `notification_outbox` สถานะ `sent`/`dead` เก่ากว่า 90 วัน (ไม่แตะ `pending`) · `line_link_code` ที่หมดอายุหรือใช้แล้วเกิน 1 วัน
4. ลบ `busy_block` ที่จบเกิน 90 วัน แล้วลบ `busy_routine` ที่ `end_date` < วันนี้ − 93 วัน (90 + 3 · `busy_routine_skip` ตาม FK cascade) — ลำดับนี้ทำให้ไม่เหลือแถว busy กำพร้า (ADR 0012 §8)
5. **R17 — ลบกลุ่มถาวร** (`purgeExpiredGroups`, [ADR 0015](../adr/0015-data-retention-group-restore-purge.md) §4) หลัง batch ข้อ 1–4 (ในโค้ด `maintenance.ts` เรียกว่างานที่ 6) · กลุ่มที่ `max(deleted_at, 2026-12-01 00:00 Asia/Bangkok) + 30 วัน <= now` เก่าสุดก่อน ≤ 25 กลุ่ม/รอบ · **ธุรกรรมเขียนแยกต่อกลุ่ม**: ตรวจเงื่อนไขซ้ำ → ลบ `notification_outbox`/`notification` ที่ `params.groupId` ตรง → `appointment_reminder` → `appointment_rsvp` → `appointment` → `group_invite` → `group_member` → `groups` → audit `group.purge` (actor ระบบ, meta = จำนวนแถวเท่านั้น) · คง `audit_log` ไว้ · ผลอยู่ใน `purgedGroups: {groups, remaining}` ของคำตอบ · รันซ้ำได้ · แข่งกับการกู้คืน: ฝั่งที่เขียนก่อนชนะ
- ~~ลบ `place_search_cache` เก่ากว่า 30 วัน~~ — ลบพร้อมตารางใน migration 0006 (ADR 0013)
- ตรวจ fingerprint pepper (ADR 0002 §7.1–7.2) อยู่ที่ `GET /api/health` (`checks.pepper`, keepalive เรียกทุก 12 ชม.) และ fail closed ตอน login (`src/lib/auth/pepper.ts`) — ไม่ได้อยู่ใน cron รายวัน

**งานของ `/api/cron/reminders`** (`src/lib/data/services/reminders.ts`, ADR 0011): ต่อรอบตรวจนัด ≤ 500 · เขียนการเตือน ≤ 40 คู่ (นัด, ชนิด) · งบเวลา 20 วินาที · กันซ้ำด้วย PK ของ `appointment_reminder` ในธุรกรรมเดียวกับ `notify()` · จากนั้นส่ง `notification_outbox` ทาง LINE ≤ 40 แถว/รอบ (retry ≤ 5 ครั้ง backoff 2^attempts นาที)
**เพดาน LINE** (`LINE_SEND_CAPS` ใน `src/lib/shared/limits.ts`, นับจากแถว `notification_outbox` ในคำสั่งจองแถวเดียวกัน ไม่มีตารางนับแยก): ต่อ (นัด, ชนิด, ผู้รับ) 2 · ต่อผู้รับ 6 ต่อ 24 ชม. · **รวมทั้ง OA 300 push ต่อเดือนปฏิทิน (Asia/Bangkok)** (R15b, v0.13.0) — เกิน = แถวนั้น `dead` รหัส `LINE_CAP`/`LINE_OA_CAP` ไม่ push · กระดิ่งในแอปไม่กระทบ · LINE ตอบ 429 monthly limit → `dead` ทั้งคิวจนสิ้นเดือน

**repo เป็น public แล้ว** — GitHub ปิด scheduled workflow อัตโนมัติเมื่อ repo สาธารณะไม่มี activity 60 วัน → keepalive หยุดเงียบ (ไม่มีอีเมล "workflow ล้ม") · วิธีกันและวิธีเปิดคืนอยู่ใน `docs/OPERATIONS.md` ส่วน E · แหล่ง: GitHub Docs "Disabling and enabling a workflow" — "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days." (https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow, เข้าถึง 2026-11-18) · ชั้นที่ 1 (Vercel cron) ยังเขียน heartbeat ทุกวันจึงยัง keep-alive Turso ได้ แต่จะเสียสัญญาณเตือนเมื่อ Vercel cron หยุด · ไฟล์ workflow ยังต้อง push จากบัญชี boss และเปิดแจ้งเตือน Actions ทางอีเมล

## 9. คำถามถึง Lead / ประเด็นเปิด
| # | เรื่อง | ที่มา | ข้อเสนอของ Architect (ใช้เป็นค่าตั้งต้นจนกว่าจะตอบ) |
|---|---|---|---|
| Q1 | path ใหม่ที่ TEAM.md ไม่มีเจ้าของ: `src/lib/shared/**`, `drizzle.config.ts`, `vercel.json`, `.env.example`, `.nvmrc`, `src/app/api/health` | TEAM.md | `src/lib/shared/**` + `drizzle.config.ts` → Platform · `vercel.json`, `.env.example`, `.nvmrc`, `api/health` → OPS · Lead เพิ่มแถวใน TEAM.md |
| Q2 | super admin ลบสมาชิก "ทุกคน" (§3) รวม group admin ด้วยหรือไม่ — ถ้าลบได้ กลุ่มจะไม่มี admin | PRD §3 แถว "ลบสมาชิก" vs D8 | ปฏิเสธ 409 `ADMIN_TRANSFER_REQUIRED` จนกว่าจะโอน (SA โอนเองได้ — D8) |
| Q3 | §3 ให้ super admin "ดูปฏิทินกลุ่ม ✅ ทุกกลุ่ม" แต่ §5 (0006) บอก "เห็นได้เฉพาะคนที่อยู่กลุ่มเดียวกัน" | PRD §3 vs §5 | ยึด §3 (SA เห็นได้) แต่ `hide_detail` ยังมีผล + ลง audit log ทุกครั้งที่ SA นอกกลุ่มเปิดดู (ADR 0006) |
| Q4 | ชวนตรงด้วย username ที่ไม่มีจริง: บอกผู้ชวนว่า "ไม่พบ" (UX ดี แต่เปิดให้คนล็อกอินแล้วไล่เช็กชื่อ) หรือตอบกลาง ๆ | U5 vs U1 (กันไล่ชื่อ) | ตอบ `USER_NOT_FOUND` + จำกัด 30 ครั้ง/ชม./ผู้ใช้ (คนในระบบเป็นเพื่อนกันอยู่แล้ว) |
| Q5 | โค้ดเชิญใช้ได้หลายคนจนหมดอายุ หรือครั้งเดียว | D6 ไม่ระบุ | หลายคน (แชร์ในแชทกลุ่มได้) + นับ `uses_count` + เพิกถอนได้ |
| Q6 | busy "หลายวัน" แบบมีเวลา = ช่วงต่อเนื่องเดียว (เช่น ศ. 18:00 → อา. 12:00) หรือ "ทุกวันช่วงเวลาเดิม" | U7 | ช่วงต่อเนื่องเดียว (ตรง "ช่วงหลายวัน = 1 รายการ") — UX ต้องเขียนฟอร์มให้ชัด (ADR 0004 §2) |
| Q7 | busy มี `title` และ `note`: ตั้งใจให้ `note` แชร์ด้วยไหม | PRD §5 โมเดลร่าง | `title` แชร์ได้ (ถ้าไม่ซ่อน) · `note` เห็นเฉพาะเจ้าของ (ADR 0006) |
| Q8 | นัดที่สมาชิก RSVP "ไป" ควรนับเป็น busy ในการคำนวณวันว่างร่วมไหม | PRD ไม่ระบุ | ~~v1 ไม่นับ~~ → **R6D: นับ** (คำนวณสด ทุกกลุ่ม ไม่เปลี่ยน schema) — ดู [ADR 0009](../adr/0009-going-counts-as-busy.md) |
| Q9 | หน้าต่างวันว่างข้ามเที่ยงคืน (เช่น 18:00–02:00) | D9 | v1 ไม่รองรับ (validation ปฏิเสธ) |
| Q10 | (ปิดแล้วระหว่างเฟส 2) UI_DIRECTION ฉบับที่ UX แก้ใช้ `:root` + `[data-theme="dark"]` ตรงกับ D15 · เหลือแค่ให้ UX เพิ่มกรณี `data-theme="system"` ผ่าน `@media (prefers-color-scheme: dark)` ตาม ADR 0008 §4 | UI_DIRECTION vs ADR 0008 | UX ยืนยันใน tokens.css ตอน R0 |
| Q11 | คำขอ reset ที่ไม่มีใครตัดสิน ค้างได้นานแค่ไหน | U2 ไม่ระบุ | 7 วันแล้ว `expired` (ผู้ใช้ขอใหม่ได้) |
| Q12 | username อนุญาตเฉพาะ `a-z 0-9 . _` 3–20 ตัว (ไม่มีภาษาไทย) | D2 ไม่ระบุรูปแบบ | ตามข้อเสนอ — กันตัวอักษรหน้าเหมือน/ปัญหาตัวพิมพ์ · ชื่อที่แสดงใช้ไทยได้ |
| Q13 | path `scripts/pepper-fingerprint.ts`, `scripts/admin-reset-pin.ts`, `.github/workflows/keepalive.yml` | ADR 0002 §7.4, ADR 0001 §3.1 | เจ้าของ OPS (TEAM.md ให้ OPS เฉพาะ `.github/**` — `scripts/**` ยังมีแค่ `scripts/release*.ts` ของ Release) |

## 10. เปิดแบบแอปบนหน้าจอโฮม (R15 §1.3)
ข้อเสนอของ Architect (frontend implement · ux ทำ PNG · ops ดู headers) · ยืนยันบนเครื่องจริงที่ T3 (boss) · **implement แล้ว** (ตรวจ 2026-11-18): `src/app/manifest.ts` + `public/brand/app/` (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — ชื่อไฟล์จริงต่างจากข้อเสนอด้านล่างเล็กน้อย) · ตารางคงไว้เป็นเหตุผลการออกแบบ

| เรื่อง | ข้อเสนอ | เหตุผล / แหล่ง |
|---|---|---|
| manifest | **`src/app/manifest.ts`** (file convention ของ Next, `MetadataRoute.Manifest`) — ไม่ใช้ `public/manifest.webmanifest` | Next สร้าง `<link rel="manifest">` ให้เอง · มี type ตรวจ · import `THEME_COLOR` จาก `src/styles/tokens.meta.ts` ได้ (สีไม่หลุดจาก tokens) · เป็น route handler ที่ cache เป็นค่าคงที่ถ้าไม่ใช้ request-time API [N2] → **ห้ามอ่าน cookie/locale ใน manifest** |
| เนื้อหา manifest | `name: "แมวเจอกัน"` · `short_name: "maewmeet"` (ux ยืนยันคำ) · `start_url: "/"` · `scope: "/"` · `display: "standalone"` · `theme_color`/`background_color` = `THEME_COLOR.light` · `lang: "th"` · icons 192, 512 (`purpose: "any"`) + 512 `purpose: "maskable"` | ตาม contract §1.3 · ตัวอย่างของ Next ใช้ `display: 'standalone'` + icons 192/512 [N2] |
| ไฟล์ไอคอน | PNG คงที่ใต้ `public/brand/app/` (เช่น `apple-touch-icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) — ux ทำจาก `public/brand/cats` · ไม่ใช้ file convention `app/apple-icon.png`/`app/icon.png` เพราะ file-based metadata มีลำดับเหนือ `metadata` [N1] อาจทับ favicon SVG เดิม | ไฟล์ static ไม่ผ่านโค้ด · ระวังชื่อชน: `public/brand/cats/manifest.json` เดิมเป็นรายการภาพของ ux ไม่ใช่ web manifest |
| apple-touch-icon | `metadata.icons.apple: [{ url: "/brand/app/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }]` ใน `generateMetadata` ของ `src/app/layout.tsx` (คง `icon` SVG เดิม) | Next ออก `<link rel="apple-touch-icon" sizes="180x180">` [N1] · iOS เลือกไอคอนจาก `link rel=apple-touch-icon` ตามขนาดที่เหมาะกับเครื่อง [A1] |
| metadata iOS | `appleWebApp: { capable: true, title: t("name"), statusBarStyle: "default" }` | Next 16 ออก `<meta name="mobile-web-app-capable">` (ไม่ใช่ `apple-mobile-web-app-capable`) + `apple-mobile-web-app-title` + `apple-mobile-web-app-status-bar-style` [N1] · iOS/iPadOS 26 เปิดเว็บที่เพิ่มหน้าจอโฮมเป็นแอปโดยดีฟอลต์ และ manifest ยังให้ไอคอน/ค่าอื่น [A2] · `default` = แถบสถานะไม่ทับเนื้อหา (ง่ายกว่า `black-translucent` ที่ต้องเว้น safe area บนเอง) |
| iOS รุ่นเก่า (< 26) | ถ้า T3 บนเครื่องรุ่นเก่ายังเปิดเป็น Safari: เพิ่ม `other: { "apple-mobile-web-app-capable": "yes" }` | แท็กเดิมของ Apple [A1] · Next ไม่ออกแท็กนี้แล้ว [N1] — **ยังไม่ยืนยัน**ว่าจำเป็นบนรุ่นเก่า (ไม่ได้ทดสอบ) |
| safe area | `viewport.viewportFit: "cover"` มีแล้วใน layout · ux/frontend ใช้ `env(safe-area-inset-top/bottom)` ที่แถบบน/แถบล่าง/ปุ่มลอย | contract §1.3 |
| CSP / proxy | `manifest-src 'self'` มีแล้ว (`next.config.ts`) · `img-src 'self'` ครอบไอคอน · ไม่มี `middleware`/`proxy` ที่จะ redirect `/manifest.webmanifest` ไปหน้า login (ตรวจโค้ด 2026-11-15) → ops ไม่ต้องแก้ headers ถ้ายังเป็นแบบนี้ | อ่านโค้ด |
| ลิงก์ภายนอก / login | ลิงก์ Google Maps / LINE / Google Calendar คง `<a href target="_blank" rel="noopener">` เดิม · ไม่ใส่ service worker (ไม่มี offline) · cookie session เดิมใช้ได้ | **ยังไม่ยืนยัน**ว่า iOS เปิดลิงก์นอก scope ในโหมดแอปอย่างไร และต้อง login ใหม่ในแอปครั้งแรกหรือไม่ (เอกสาร WebKit ที่อ่านไม่ระบุ [A2]) → ทดสอบ T3 แล้วให้ secretary ใส่ quickstart ตามผลจริง |
| ⚠ metadata แบบ stream | `generateMetadata` ของ root layout อ่าน locale (cookie) → Next อาจ stream metadata ไปต่อท้าย `<body>` สำหรับ browser ที่ไม่ใช่ bot [N1] | **ยังไม่ยืนยัน**ว่ามีผลกับ Safari ตอน "เพิ่มไปยังหน้าจอโฮม" · frontend ตรวจ HTML จริง (`curl -A "<UA ของ iPhone Safari>"`) ว่า `rel="manifest"` / `apple-touch-icon` อยู่ตรงไหน · ถ้าอยู่ใน body และ T3 ไม่ได้ไอคอน → ทางสำรอง: ใส่ `<link>` ตรงใน `<head>` ของ root layout |

แหล่งอ้างอิง §10 (เข้าถึง 2026-11-15)
- [N1] Next.js — generateMetadata (`icons.apple`, `manifest`, `appleWebApp` → `<meta name="mobile-web-app-capable">`, file-based metadata มีลำดับเหนือ, streaming metadata ต่อท้าย `<body>`) · lastUpdated 2026-11-06 — https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- [N2] Next.js — manifest file convention (`app/manifest.(json|webmanifest)` หรือ `app/manifest.ts`; "cached by default unless it uses a Request-time API") · lastUpdated 2026-03-03 — https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest · PWA guide (lastUpdated 2026-07-30) — https://nextjs.org/docs/app/guides/progressive-web-apps
- [A1] Apple — Safari Web Content Guide: Configuring Web Applications (`apple-touch-icon` + sizes, `apple-mobile-web-app-capable`, status-bar-style · เอกสาร archive อัปเดต 2016-12-12 ใช้เป็นประวัติ) — https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
- [A2] WebKit — WebKit Features in Safari 26.0 ("By default, every website added to the Home Screen opens as a web app"; manifest ยังใช้ไอคอน) — https://webkit.org/blog/17333/webkit-features-in-safari-26-0/

## 11. Rate limit ที่ wrapper + ข้อจำกัดที่รู้ (R16)
ที่มา: [R16_CONTRACT](../contracts/R16_CONTRACT.md) §1 (H1–H6), §5 (ผลตัดสิน boss 2026-11-18), §6 · อ่านโค้ด `feat/r16-cleanup` 2026-11-19 (`git diff 9db2c08..HEAD -- src`)

### 11.1 ถัง rate limit ใหม่ (`src/lib/shared/limits.ts` — เก็บใน `rate_limit_bucket` เหมือนถังอื่น นับรวมข้าม instance)
| prefix | เพดาน | นับที่ | นับ | ไม่นับ |
|---|---|---|---|---|
| `group:settings` (H1) | 30/10 นาที/ผู้ใช้ (ทุกกลุ่มรวม) | `updateGroupSettings` (`src/lib/data/services/groups.ts`) | `PATCH /api/groups/:gid` ทุกคำขอที่ผ่านด่านบัญชี รวมที่ด่านกลุ่มตอบ `NOT_FOUND`/`FORBIDDEN` (ตัดสินจากรหัสของ policy กลาง ไม่เทียบ role เอง) · ถังเต็ม → 429 แทน 404/403 | ด่านบัญชี (anonymous / suspended / must_change_pin) |
| `prefs:update` (H2) | 60/10 นาที/ผู้ใช้ | `takePrefsSlot` (`src/lib/data/services/prefs.ts`) หลังด่าน `prefs.cookie.set` ก่อนตั้งคุกกี้/เขียน `user.locale` | `POST /api/prefs` ของผู้ที่ล็อกอินอยู่ | ไม่ได้ล็อกอิน (หน้า login/signup/forgot — ไม่มีตัวตนให้ผูกถัง และไม่เขียน DB) |
| `api:read` (H3, boss B1) | 600/10 นาที/ผู้ใช้ รวมทุก route | wrapper `route()` ขั้น 3½ (`src/app/api/_lib/route.ts` + `src/lib/data/read-limit.ts`) | `GET` + `auth: 'actor'` + action ไม่ใช่ `null` และไม่สาธารณะ + actor เป็นผู้ใช้ (`readLimited()`) — รวม GET ที่ handler ตอบ error ด้วย | cron / health (auth ไม่ใช่ actor หรือ action `null`) · action สาธารณะ (เช่น สถานะ pin-reset) · anonymous · เมธอดอื่น (มีถังของตัวเองต่อ route) · webhook LINE (POST) · หน้า Server Component (ไม่ผ่าน wrapper) |

กลไก `api:read`:
- จองช่อง (UPSERT มีเพดาน `reserveBucket` ใน `serialized`) **ขนานกับ handler** ไม่เพิ่ม round trip · ผลของ limiter ตัดสินก่อนใช้ผล handler เสมอ — เต็ม → 429 `RATE_LIMITED` + `Retry-After` และทิ้งผล handler · ข้อควรรู้: handler เริ่มทำงานพร้อม limiter จึงอาจทำงานจบไปแล้วตอนถูกปฏิเสธ — ผลข้างเคียงของ GET (ถ้ามี เช่น audit ตอน SA เปิดดูกลุ่ม ตามข้อ 5 `GET /api/admin/groups/:gid`) อาจเกิดแม้ผู้เรียกได้ 429 (อ่านจากโค้ด ยังไม่ได้ทดสอบกรณีนี้)
- ทางลัดใน process: ผู้ใช้ที่เพิ่งถูกปฏิเสธ → จำ `userId → ปลายหน้าต่าง` (Map ≤ `READ_BLOCK_MEMO_MAX` = 1,000 คีย์ ทิ้งเก่าสุดเมื่อเต็ม) แล้วตอบ 429 ทันทีโดยไม่แตะ DB และไม่รัน handler จนหน้าต่างหมด · หาย/ล้นเพดาน = เสียแค่ทางลัด DB ยังเป็นตัวตัดสิน · ไม่ได้แชร์ข้าม instance (แต่ละ instance เรียนรู้เองจากการถูก DB ปฏิเสธครั้งแรก)
- ผลข้างเคียงต่อโหลด: GET ที่ล็อกอินทุกครั้งเขียน `rate_limit_bucket` 1 ครั้ง (ขนานกับ handler) · cron daily ลบถังเก่ากว่า 2 วันเหมือนเดิม (ข้อ 8)

### 11.2 ธง `actorSystemAdmin` / `creatorSystemAdmin` (H4, H4b, H4c — security R15b Info 3)
- notification `group.invite.received` params เพิ่ม `actorSystemAdmin: boolean` (ADR 0007 §1) — ตั้ง `true` เมื่อผู้เชิญผ่านด่านสิทธิ์ในฐานะ super admin ที่ไม่ใช่สมาชิก (`actorRole === null`) แล้วเก็บ `inviterName ''` · แถวก่อน R16 ไม่มีคีย์ = ถือเป็น `false` (ไม่เขียนย้อนหลัง — R16 §6)
- `GET /api/me/invites` DTO มี `actorSystemAdmin` คำนวณ *ตอนอ่าน* จาก `user.is_admin` ของผู้สร้าง + `EXISTS group_member` ใน query เดียว (`listPendingDirectInvitesFor`) · serializer เลือกฟิลด์ทีละตัว ไม่ส่งธงภายในออก · ต่างจาก notification ที่เป็นค่า ณ เวลาเกิด — ถ้า SA เข้ากลุ่มทีหลัง รายการคำเชิญจะแสดงชื่อจริง แต่กระดิ่งยังเป็น "ผู้ดูแลระบบ"
- H4c: `GET /api/groups/:gid/invites` และคำตอบของ `POST /api/groups/:gid/invites/direct` ใช้ `InviteDto.creatorSystemAdmin` — กติกาเดียวกัน (super admin และไม่ใช่สมาชิก *ณ ตอนอ่าน* → `true` + `creatorName ''`) · รายการอ่าน `user.is_admin` + สมาชิกภาพใน query เดียว (`listActiveInvitesOfGroup` ใน `src/lib/data/repos/group-invite.ts`) · คำตอบตอนสร้างใช้ `group.actorRole !== null` หลังด่านสิทธิ์ · serializer `toInviteDto` ไม่ส่งธงภายในออก

### 11.3 ข้อจำกัดที่รู้ / ความเสี่ยงที่ยอมรับ
| เรื่อง | สภาพจริง | เหตุผลที่ไม่แก้ | อ้างอิง |
|---|---|---|---|
| redirect ระหว่าง stream ได้ HTTP 200 | root `src/app/loading.tsx` (และ `src/app/(app)/loading.tsx`) ทำให้ทุกหน้าเป็น streaming → `redirect()` ใน Server Component ส่งเป็น status 200 + meta refresh / คำสั่งใน RSC payload แทน 3xx · client ย้ายหน้าทันที และ redirect ถูกโยนก่อน render จึงไม่มีข้อมูลหลุด · เกิดกับทุกหน้า ไม่ใช่แค่หน้า auth | แก้ได้ด้วย `proxy.ts` (ขัด ADR 0001 §1) หรือเอา loading boundary ออก (หน้าช้าลง ขัด F2) | R16 §6 H5 (platform ตรวจด้วย curl บน `next start` 2026-11-18) |
| `Server-Timing` มีเฉพาะ API | header ออกจาก wrapper `route()` เท่านั้น (เปิด/ปิดด้วย `SERVER_TIMING_ENABLED`, ข้อ 7) · หน้า RSC ไม่มี | Next 16 `headers()` ใน Server Component อ่านอย่างเดียว และหน้า streaming ส่ง header ก่อน query จบ · วัดหน้าด้วย `tests/perf/r7-baseline.test.ts` แทน | R16 §6 H6 |
| CSP ยังมี `'unsafe-inline'` ใน `script-src` / `style-src` | `next.config.ts` `contentSecurityPolicy()` | boss B3 = (ก) ไม่ทำ nonce ยอมรับความเสี่ยง | [ADR 0014](../adr/0014-csp-unsafe-inline-accepted.md) · R16 §5 B3 |
| SkeletonHold (U4) | `src/components/shell/SkeletonHold.tsx` ใน root layout เฝ้า `data-nav-loading` แล้ววาง skeleton ค้างให้ครบ 250 ms หลัง `loading.tsx` หาย (client-only ไม่กระทบ status/stream) | — (บันทึกไว้เพราะอยู่ที่ root layout ทุกหน้า) | R16 §1 U4 |
