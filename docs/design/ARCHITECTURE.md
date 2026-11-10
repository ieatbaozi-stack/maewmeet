# ARCHITECTURE — แมวเจอกัน (maewmeet) v1

> เจ้าของไฟล์: Architect · สถานะ: **ร่างเฟส 2 (Proposed)** รอ Lead/boss รับพร้อม ADR 0001–0008
> แก้รอบ 2 (2026-10-16): การจัดการ pepper (ADR 0002 §7) — env `PIN_PEPPER_V<n>`, ตาราง `pepper_fingerprint`, `AUTH_MAINTENANCE` · keep-alive Turso 2 ชั้น (ADR 0001 §3.1) — ตาราง `system_heartbeat`, `/api/cron/heartbeat`, GitHub Actions · สัปดาห์เริ่มวันจันทร์ (ADR 0004)
> แหล่งความจริงของความต้องการ: [PRD](../prd/PRD.md) · ตัดสินใจรายเรื่อง: [ADR 0001](../adr/0001-stack-and-project-structure.md) · [0002](../adr/0002-auth-pin.md) · [0003](../adr/0003-rbac.md) · [0004](../adr/0004-time-and-timezone.md) · [0005](../adr/0005-common-free-time-algorithm.md) · [0006](../adr/0006-busy-visibility.md) · [0007](../adr/0007-notifications.md) · [0008](../adr/0008-i18n-and-theme.md) · [0010](../adr/0010-daily-busy-series.md) · [0012](../adr/0012-busy-routines.md)
> **หมายเหตุ R13 (2026-11-11, boss อนุมัติ):** การค้นหาสถานที่ผ่าน Nominatim (U10 `GET /api/places/search`, action `place.search`, env `PLACE_SEARCH_ENABLED`/`NOMINATIM_*`/`NEXT_PUBLIC_MAP_*`) และภาพแผนที่ OSM ถูกเอาออกแล้ว — ผู้ใช้วางลิงก์แผนที่เอง + ปุ่มเปิด Google Maps / Apple Maps · ตาราง `place_search_cache` ยังอยู่ (cron ล้างแถวเก่ายังทำงาน) รอลบใน migration ครั้งถัดไป · ส่วนที่พูดถึงเรื่องนี้ด้านล่างคงไว้เป็นประวัติ · ดู [R13_CONTRACT §1.3](../contracts/R13_CONTRACT.md) และ [PRD D11](../prd/PRD.md)
> โค้ดในเอกสารนี้เป็น **ร่าง/pseudo-code** สำหรับ R0–R1 นำไปเขียนจริง — ชื่อไฟล์/คอลัมน์ถือเป็นสัญญา เปลี่ยนต้องผ่าน Lead

## สารบัญ
1. โครงโฟลเดอร์และเจ้าของ · 2. การไหลของ request · 3. Schema Drizzle ฉบับร่าง · 4. Session และ actor · 5. API endpoint ต่อ story · 6. รหัส error · 7. ตัวแปร env (`.env.example`) · 8. งานตามเวลา (cron) · 9. คำถามถึง Lead / ประเด็นเปิด

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
│   │       ├── me/**  groups/**  appointments/**  invites/**  places/**  prefs/**  admin/**
│   │       ├── cron/daily/route.ts            งานรายวัน (ข้อ 8)
│   │       ├── cron/heartbeat/route.ts        keep-alive จาก GitHub Actions (ข้อ 8)
│   │       ├── health/route.ts                OPS (10) ★ (ไฟล์อยู่ใน api/ แต่เนื้อหาเป็นของ OPS)
│   │       └── line/**                        Integrations (9) — v1.x
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
│       └── integrations/                      Integrations (9) — channel LINE (v1.x)
├── messages/th.json  en.json                  เนื้อหา UX (4) · คีย์เพิ่มได้โดย Front-end (6)
├── drizzle/                                   Platform (5) — migration ที่ drizzle-kit generate (มีเวอร์ชัน)
├── drizzle.config.ts  ★                       Platform (5) (ข้อ 9 Q1)
├── tests/                                     TEST (11) · ยกเว้น tests/calendar/** = Calendar & Time (7)
│   ├── rbac/matrix.fixture.ts                 ADR 0003 §4
│   ├── calendar/fixtures/                     แปลงจาก docs/adr/0005-fixtures/
│   └── e2e/                                   Playwright 375/390/768 × TH/EN × light/dark
├── next.config.ts  .github/**                 OPS (10) — รวม .github/workflows/keepalive.yml (ADR 0001 §3.1)
├── scripts/pepper-fingerprint.ts  scripts/admin-reset-pin.ts  ★  OPS (10) — ADR 0002 §7.4 (ข้อ 9 Q1)
├── vercel.json  ★                             OPS (10) — crons (ข้อ 8)
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

## 3. Schema Drizzle ฉบับร่าง
หลักการ: id = `text` UUIDv4 สร้างในแอป · เวลา = `integer` epoch ms UTC (ตั้งค่าจาก `clock.now()` ไม่ใช้ default ของ DB) · วันที่ = `text` `YYYY-MM-DD` · boolean = `integer({mode:'boolean'})` · enum บังคับทั้ง TS (`enum`) และ DB (`check`) · ตาราง `groups` เป็นพหูพจน์เพราะ `GROUP` เป็นคำสงวน SQL

```ts
// src/db/schema.ts — ร่าง (drizzle-orm 0.45, sqlite-core)
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
}, (t) => [
  primaryKey({ columns: [t.groupId, t.userId] }),                     // U5: เข้าซ้ำไม่สร้างแถวซ้ำ
  index('group_member_user_idx').on(t.userId),
  uniqueIndex('group_one_admin_uq').on(t.groupId).where(sql`${t.role} = 'admin'`),   // กลุ่มละ 1 admin
  check('group_member_role_ck', sql`${t.role} in ('admin','moderator','member')`),
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
}, (t) => [
  index('busy_user_start_idx').on(t.userId, t.startAt),
  index('busy_user_end_idx').on(t.userId, t.endAt),
  check('busy_range_ck', sql`${t.endAt} > ${t.startAt} and ${t.localEndDate} >= ${t.localStartDate}`),
]);
// หลังจากนี้เพิ่มแล้ว: series_id (ADR 0010, 0003) · routine_id (ADR 0012, 0005) — ดูหมายเหตุใต้บล็อกนี้

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

export const notificationOutbox = sqliteTable('notification_outbox', {   // v1.x — สร้างตารางตั้งแต่ v1 (D13)
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
- `busy_block.routine_id` (nullable → busy_routine cascade, ไม่ backfill) + partial index `(user_id, routine_id) WHERE routine_id IS NOT NULL` · แถว routine คือ busy ธรรมดาสำหรับทุกทางอ่านของกลุ่ม (ปฏิทิน วันว่าง เตือนนัดทับ ไม่แก้) · `routine_id` และตารางกฎไม่ออกถึงคนอื่น (ADR 0006)
- บันทึก/แก้ = เขียนกฎ + ขยายแถวด้วย `routineRange`/`expandRoutine` (`src/lib/calendar`, กฎ 9) ใน tx เดียว · เพดาน: busy เดี่ยว 300 นับเฉพาะ `routine_id IS NULL` · routine ที่ยังไม่จบ ≤ 10/คน · วันของ routine ในอนาคต ≤ 1,500/คน · ช่วง ≤ 26 สัปดาห์/6 เดือน · วันจบ ≤ วันนี้ + 12 เดือน (R14_CONTRACT §1.2)

### ความต่างจาก "โมเดลข้อมูลร่าง" ใน PRD §5 (เหตุผลสั้น)
| PRD ร่าง | ฉบับนี้ | เหตุผล |
|---|---|---|
| `user.failed_attempts`, `locked_until` | ย้ายไป `login_throttle` (คีย์ด้วย username ที่พิมพ์) | lockout ต้องเหมือนกันไม่ว่าบัญชีมีจริงหรือไม่ (U1 AC กันไล่ชื่อ) — ADR 0002 §3 |
| `user.username` | + `username_normalized` (unique) | D2 ไม่สนตัวพิมพ์ แต่แสดงตามที่พิมพ์ |
| — | `user.pin_pepper_version`, `updated_at`, `deleted_at` | rotation pepper, ลบบัญชี (U13) |
| `session(id, user_id, expires_at, user_agent)` | + `created_at`, `last_seen_at`; `id` = hash ของ token | ADR 0002 §4 |
| `pin_reset_request` | + `device_token_hash`, `requester_ua/country`, `pending_expires_at`, `used_at` | ผูก `123456` กับเครื่อง + ข้อมูลให้ admin ยืนยัน (ADR 0002 §6) |
| `group` | ชื่อตาราง `groups` + `tz`, `updated_at` | คำสงวน SQL · ADR 0004 §4 |
| `group_invite` | + `code_hint`, `uses_count`, `revoked_by` | U5/U6 รายการโค้ด + audit |
| `busy_block` | + `created_at/updated_at`, index · + `series_id` (R6F) · + `routine_id` (R14) | ชุดรายวัน ADR 0010 · routine ADR 0012 |
| — | `busy_routine`, `busy_routine_skip` (R14) | busy ทำซ้ำรายสัปดาห์ (ADR 0012) |
| `appointment` | + `local_date`, `cancelled_*`, timestamps | U10.2 นัดยกเลิกยังเห็นได้ |
| `appointment_rsvp` | + `updated_at` | — |
| `audit_log(target)` | แยก `target_type`, `target_id`, `group_id`, `meta` | ค้น/กรองในหน้า admin (U12) |
| `notification_outbox` | + `notification_id`, `next_attempt_at`, `last_error`, `sent_at` | retry (ADR 0007) |
| — | `rate_limit_bucket`, `place_search_cache` | rate limit ไม่มี Redis (ADR 0002) · Nominatim policy (ADR 0001) |
| — | `pepper_fingerprint`, `system_heartbeat` | ตรวจ pepper ผิดค่า (ADR 0002 §7.2) · keep-alive Turso (ADR 0001 §3.1) |

### กฎข้อมูลที่ schema บังคับไม่ได้ (บังคับใน service + เทสต์)
- username: `^[a-z0-9._]{3,20}$` หลัง normalize (ASCII เท่านั้น กันตัวอักษรหน้าตาเหมือนกัน) · display name: 1–40 ตัวอักษรใดก็ได้ (ไทยได้)
- ลบบัญชี (U13): ต้องไม่ถือ role admin กลุ่มใด → ลบ session, busy, busy routine (ต้องลบเอง — anonymize ไม่เกิด cascade, ADR 0012), rsvp, notification, membership, คำเชิญค้าง → anonymize แถว user (`username_normalized = 'deleted:'||id`, `username=''`, `display_name=''`, `pin_hash=NULL`, `line_user_id=NULL`, `status='deleted'`) — คงแถวไว้ให้ FK ของนัด/audit · UI แสดงชื่อเป็นคีย์แปล "ผู้ใช้ที่ลบบัญชีแล้ว"
- หมดอายุทุกชนิด (โค้ดเชิญ, reset) ตรวจแบบ lazy ตอนอ่าน — cron แค่เก็บกวาด

## 4. Session และ actor (สรุป — ละเอียดใน ADR 0002 §4)
`getActor(cookies)`: ไม่มี cookie → `{kind:'anonymous'}` · มี → `SELECT … FROM session JOIN user WHERE session.id = sha256(token) AND expires_at > now` → ไม่เจอ/หมดอายุ → anonymous + ลบ cookie · `user.status != 'active'` → ลบ session ทั้งหมดของ user แล้วถือเป็น anonymous · คืน `{kind:'user', id, isSuperAdmin, status, mustChangePin}`
Layout `(app)` เรียก `getActor` → anonymous → redirect `/login` · `mustChangePin` → redirect `/set-pin` (เป็น UX เท่านั้น ด่านจริงคือ `can()`)

## 5. API endpoint ต่อ story
ทุก endpoint: JSON, prefix `/api`, ผ่าน wrapper ข้อ 2 · คอลัมน์ "action" = ชื่อใน [ADR 0003](../adr/0003-rbac.md) ที่ service เรียก · "เจ้าของ" = บทบาทที่เขียน route

| Story | Method + path | action (RBAC) | หมายเหตุ | เจ้าของ |
|---|---|---|---|---|
| U1 | `POST /api/auth/signup` | `auth.signup` | `{username, displayName, pin, pinConfirm}` · RL 5/ชม./IP · สร้าง session ทันที · locale/theme จาก cookie | Auth |
| U1 | `POST /api/auth/login` | `auth.login` | `{username, pin}` · throttle (ADR 0002 §3) · ตั้ง cookie session + `mm_locale`/`mm_theme` จากบัญชี | Auth |
| U1, U3 | `POST /api/auth/logout` | `auth.logout` | ลบ session ปัจจุบัน · อนุญาตระหว่าง must_change_pin | Auth |
| U1, U13 | `POST /api/auth/logout-all` | `self.session.revokeAll` | ลบทุก session ของตัวเอง | Auth |
| U1 | `GET /api/auth/session` | `self.read` | คืน `{id, username, displayName, isAdmin, mustChangePin, locale, theme}` หรือ 401 | Auth |
| U2 | `POST /api/auth/pin-reset` | `auth.pinReset.request` | `{username}` · ตอบ 202 เหมือนกันทุกกรณี + cookie `mm_reset` | Auth |
| U2 | `GET /api/auth/pin-reset/status` | `auth.pinReset.status` | จาก cookie `mm_reset`: `pending \| approved(expiresAt) \| closed` | Auth |
| U2, U12 | `GET /api/auth/admin/pin-resets?status=` | `pinReset.list` | รายการคำขอ + requester_ua/country | Auth |
| U2, U12 | `POST /api/auth/admin/pin-resets/:id/approve` | `pinReset.decide` | → approved, pin_hash = NULL, audit, notification | Auth |
| U2, U12 | `POST /api/auth/admin/pin-resets/:id/reject` | `pinReset.decide` | → rejected, audit | Auth |
| U3, U13 | `POST /api/auth/pin` | `self.pin.change` | `{newPin, newPinConfirm, currentPin?}` (currentPin ไม่ต้องเมื่อ must_change_pin) | Auth |
| U4 | `POST /api/groups` | `group.create` | `{name}` → ผู้สร้างเป็น admin | Platform |
| U4 | `GET /api/groups` | `group.list.mine` | กลุ่มที่เป็นสมาชิก + role ของฉัน | Platform |
| U4, U6 | `GET /api/groups/:gid` | `group.view` | รายละเอียด + สมาชิก (id, display name, role, สี) | Platform |
| U6, D9 | `PATCH /api/groups/:gid` | `group.update` | `{name?, freeWindowStartMin?, freeWindowEndMin?, minFreeMinutes?}` | Platform |
| U6 | `DELETE /api/groups/:gid` | `group.delete` | soft delete + audit | Platform |
| U6, D7 | `DELETE /api/groups/:gid/members/:uid` | `member.remove` | 409 ถ้าเป้าหมายเป็น admin | Platform |
| U6 | `PATCH /api/groups/:gid/members/:uid` | `member.setRole` | `{role: 'moderator' \| 'member'}` | Platform |
| U6, D8 | `POST /api/groups/:gid/transfer-admin` | `group.transferAdmin` | `{toUserId}` · admin เดิมกลายเป็น moderator | Platform |
| U6, D8 | `POST /api/groups/:gid/leave` | `group.leave` | 409 ถ้าเป็น admin | Platform |
| U5 (ก) | `POST /api/groups/:gid/invites/direct` | `invite.direct.create` | `{username}` · RL 30/ชม. · สร้าง notification | Platform |
| U5 (ข) | `POST /api/groups/:gid/invites/code` | `invite.code.create` | คืนโค้ด **ครั้งเดียว** (`XXXX-XXXX`, alphabet 31 ตัว ตัด 0 O 1 I L) + expiresAt | Platform |
| U5, U6 | `GET /api/groups/:gid/invites` | `invite.list` | MEM เห็นเฉพาะของตัวเอง | Platform |
| U5, U6 | `DELETE /api/groups/:gid/invites/:iid` | `invite.revoke` | | Platform |
| U5 (ข) | `POST /api/invites/redeem` | `invite.code.redeem` | `{code}` · ผิด/หมดอายุ/เพิกถอน → `INVITE_INVALID` เดียวกัน · RL ADR 0002 · สมาชิกเดิม → 200 ไม่สร้างแถว | Platform |
| U5 (ก) | `GET /api/me/invites` | `invite.direct.list.mine` | คำเชิญตรงที่ค้าง | Platform |
| U5 (ก) | `POST /api/me/invites/:iid/accept` · `/decline` | `invite.direct.respond` | | Platform |
| U7 | `GET /api/me/busy?from&to` | `busy.list.own` | เห็นครบรวม note | Platform |
| U7 | `POST /api/me/busy` | `busy.create` | `{allDay, startDate, endDate, startTime?, endTime?, tz?, title?, note?, hideDetail}` → `normalizeBusyInput` (ADR 0004) | Platform |
| U7 | `PATCH /api/me/busy/:id` | `busy.update` | เจ้าของเท่านั้น | Platform |
| U7 | `DELETE /api/me/busy/:id` | `busy.delete` | เจ้าของเท่านั้น · บนแถว routine = ลบวันนั้น + บันทึก skip (PATCH บนแถว routine = แยกเป็น busy เดี่ยว + skip) | Platform |
| U7 (R14) | `GET /api/me/busy-routines` | `busy.routine.list.own` | routine ของฉัน (รวม note) + จำนวนวันที่เหลือ · ADR 0012 | Platform |
| U7 (R14) | `POST /api/me/busy-routines` | `busy.routine.create` | กฎ (`weekdays`, เวลา/all-day, ช่วง weeks/months) → ขยายแถวใน tx เดียว · zod `.strict()` | Platform |
| U7 (R14) | `PATCH /api/me/busy-routines/:id` | `busy.routine.update` | เจ้าของเท่านั้น (SA ไม่ได้) · `from` = แก้ตั้งแต่สัปดาห์/เดือนนั้น (ไม่ส่ง = ทุกวันที่ยังไม่ผ่าน) | Platform |
| U7 (R14) | `DELETE /api/me/busy-routines/:id?from=` | `busy.routine.delete` | เจ้าของเท่านั้น · มี `from` = หยุดตั้งแต่วันนั้น · ไม่มี = ลบทั้งหมดรวมอดีต | Platform |
| U8 | `GET /api/groups/:gid/calendar?from&to` | `group.calendar.view` | ≤ 62 วัน · หน้าจอเดือนส่งช่วง `monthGrid()` **เริ่มวันจันทร์** (ADR 0004) · busy กรองตาม ADR 0006 · นัดในช่วง | Platform |
| U9, U9.1 | `GET /api/groups/:gid/availability?from&to` | `group.availability.view` | ผล ADR 0005 + blockers (กรอง ADR 0006) | Platform |
| U10 | `GET /api/places/search?q=` | `place.search` | proxy Nominatim + cache + 1 req/s + kill switch | Platform |
| U10, U10.1 | `POST /api/groups/:gid/appointments/preview` | `appointment.create` | dry-run คืน `warnings` (นัดทับ busy) ไม่บันทึก | Platform |
| U10, U10.1 | `POST /api/groups/:gid/appointments` | `appointment.create` | บันทึก + `warnings` + notification `appointment.created` | Platform |
| U8, U10 | `GET /api/groups/:gid/appointments?from&to` | `appointment.view` | รวมนัดที่ยกเลิก (U10.2) | Platform |
| U10 | `GET /api/appointments/:aid` | `appointment.view` | + RSVP สรุป + ของฉัน | Platform |
| U10.2 | `PATCH /api/appointments/:aid` | `appointment.update` | คืน `warnings` ใหม่ | Platform |
| U10.2 | `POST /api/appointments/:aid/cancel` | `appointment.cancel` | status = cancelled (ยังเห็นได้) | Platform |
| U10.1 | `PUT /api/appointments/:aid/rsvp` | `appointment.rsvp` | `{response: 'going' \| 'maybe' \| 'not_going'}` | Platform |
| U11 | `GET /api/me/appointments/upcoming?limit=` | `appointment.list.mine` | นัด active ที่ `end_at > now` ข้ามทุกกลุ่ม เรียงเวลา + daysUntil + จำนวนคนไป | Platform |
| U12 | `GET /api/admin/users?q=&cursor=` | `admin.user.list` | ค้นหา username/display name + สถานะล็อก | Platform |
| U12 | `POST /api/admin/users/:uid/suspend` · `/unsuspend` | `admin.user.suspend` | suspend ลบทุก session · audit | Platform |
| U12 | `POST /api/admin/users/:uid/unlock` | `admin.user.unlock` | ลบ `login_throttle` ของ username นั้น · audit | Platform |
| U12 | `GET /api/admin/groups?q=&cursor=` | `admin.group.list` | รวมกลุ่มที่ลบแล้ว · โอน admin/ลบกลุ่มใช้ endpoint กลุ่มปกติ (SA ผ่าน policy) | Platform |
| U12 | `GET /api/admin/audit?cursor=&targetType=` | `admin.audit.view` | | Platform |
| U13 | `GET /api/me` · `PATCH /api/me` | `self.read` · `self.update` | `{displayName?, locale?, theme?}` · ตั้ง cookie ภาษา/ธีมด้วย | Platform |
| U13 | `DELETE /api/me` | `self.delete` | `{pin}` ยืนยัน · 409 ถ้ายังเป็น admin กลุ่ม | Platform |
| U14, U15 | `POST /api/prefs` | `prefs.cookie.set` | `{locale?, theme?}` ตั้ง cookie อย่างเดียว (ก่อนล็อกอิน / must_change_pin) | Platform |
| U14, U15 | (ใช้ `PATCH /api/me`) | `self.update` | หลังล็อกอิน | Platform |
| ADR 0007 | `GET /api/me/notifications?cursor=` · `POST /api/me/notifications/read` | `notification.list.own` · `notification.markRead.own` | | Platform |
| ระบบ | `GET /api/cron/daily` | — (`CRON_SECRET`) | ข้อ 8 · งานแรก = เขียน heartbeat | Platform |
| ระบบ | `POST /api/cron/heartbeat` | — (`CRON_SECRET`) | GitHub Actions ทุก 12 ชม. เขียน heartbeat แล้วคืน `heartbeatAgeHours` | Platform |
| ระบบ | `GET /api/health` | — (public) | 200/503 + `checks: {db, pepper, heartbeat}` เป็น pass/fail เท่านั้น (ADR 0002 §7.1) | OPS |
| v1.x | `/api/line/**` | — | R7 | Integrations |

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

## 7. ตัวแปร env (`.env.example` สำหรับ R0 — ไม่มีค่าจริง)
```dotenv
# ── ฐานข้อมูล (Turso) ──────────────────────────────── ต้องมี: prod/preview
TURSO_DATABASE_URL=            # libsql://<db>-<org>.turso.io  · dev/test ใช้ file:./local.db
TURSO_AUTH_TOKEN=              # token ของ DB (ว่างได้เมื่อใช้ file:)

# ── ความลับของแอป ─────────────────────────────────── ต้องมี: ทุกสภาพแวดล้อม (dev ใช้ค่าสุ่มของตัวเอง)
PIN_PEPPER_CURRENT_VERSION=1   # เวอร์ชันที่ใช้ hash ใหม่ (ADR 0002 §7.3)
PIN_PEPPER_V1=                 # base64 ของ ≥32 ไบต์ · boss สร้างเองบนเครื่อง (openssl rand -base64 32)
                               # ไม่มีค่าดีฟอลต์ — หาย/ว่าง/ผิดค่า → login ปิด (AUTH_MAINTENANCE) ไม่สร้างใหม่เอง
                               # Vercel: ชนิด Secret, Production เท่านั้น · สำรอง 2 ที่ตาม ADR 0002 §7.4 · ห้ามใส่ใน repo/แชท
# PIN_PEPPER_V2=               # เพิ่มตอนหมุน · ลบตัวเก่าได้เมื่อไม่มีผู้ใช้เวอร์ชันนั้นเหลือ
APP_SECRET=                    # base64 ≥32 ไบต์ · HKDF แยก subkey: invite-code HMAC, rate-limit IP HMAC
CRON_SECRET=                   # ≥16 ตัวอักษรสุ่ม · Vercel ส่งเป็น Authorization: Bearer ให้ cron อัตโนมัติ
                               # ใส่ค่าเดียวกันใน GitHub Secrets ชื่อ CRON_SECRET + APP_ORIGIN สำหรับ workflow keepalive

# ── URL / คุกกี้ ────────────────────────────────────
APP_ORIGIN=                    # เช่น https://maewmeet.vercel.app · ใช้ตรวจ Origin (CSRF) · preview ใช้ VERCEL_URL ถ้าว่าง

# ── ค้นหาสถานที่ / แผนที่ (D11) ─────────────────────────
PLACE_SEARCH_ENABLED=true      # kill switch ตาม Nominatim usage policy
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_CONTACT=             # อีเมล/URL ติดต่อ ใส่ใน User-Agent "maewmeet/<ver> (<contact>)"
NEXT_PUBLIC_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
NEXT_PUBLIC_MAP_ATTRIBUTION=© OpenStreetMap contributors

# ── อื่น ๆ ─────────────────────────────────────────
LOG_LEVEL=info                 # debug|info|warn|error — ห้าม log PIN/hash/token/โค้ดเชิญ ทุกระดับ

# ── LINE (v1.x / R7) — ยังไม่ใช้ใน v1 ─────────────────────
# LINE_LOGIN_CHANNEL_ID=
# LINE_LOGIN_CHANNEL_SECRET=
# LINE_MESSAGING_CHANNEL_SECRET=      # ตรวจ X-Line-Signature
# LINE_MESSAGING_ACCESS_TOKEN=
```
ตัวแปรที่ Vercel ใส่ให้เอง (ไม่อยู่ใน .env.example): `VERCEL_URL`, `VERCEL_ENV` · เทสต์ (Vitest) สร้าง `TURSO_DATABASE_URL=file:<tmp>` และความลับสุ่มต่อรอบเอง · แอปต้อง **ล้มตอนเริ่ม** ถ้าตัวแปร "ต้องมี" หายหรือสั้นเกิน (ตรวจด้วย zod ใน `src/lib/shared/env.ts` ★)

## 8. งานตามเวลา (cron)
`vercel.json`: `{"crons":[{"path":"/api/cron/daily","schedule":"0 19 * * *"}]}` (19:00 UTC ≈ 02:00 BKK, คลาดได้ ±59 นาที — Hobby วันละครั้ง)
งาน (ทุกข้อ idempotent — Vercel อาจยิงซ้ำหรือข้าม):
1. ลบ `session` ที่หมดอายุ · `rate_limit_bucket` ที่ `window_start` เก่ากว่า 2 วัน · `login_throttle` ที่ไม่ล็อกและไม่ขยับ 30 วัน
2. เปลี่ยนสถานะ `pin_reset_request`/`group_invite` ที่หมดอายุ (สำรอง — กลไกหลักคือ lazy)
3. ลบ `notification` เก่ากว่า 90 วัน · `place_search_cache` เก่ากว่า 30 วัน
4. (v1.x) เก็บตก `notification_outbox` ที่ถึงเวลา retry
0. (ทำก่อนทุกข้อ) **เขียน** `system_heartbeat('vercel-cron')` — keep-alive ชั้นที่ 1 (ADR 0001 §3.1)
5. ตรวจ fingerprint pepper (ADR 0002 §7.2) ไปด้วย — ถ้าไม่ผ่าน response เป็น 503 ให้เห็นใน log ของ cron

**GitHub Actions `keepalive.yml`** (OPS) — ชั้นที่ 2 ของ keep-alive + สัญญาณเตือน: `schedule: '17 */12 * * *'` + `workflow_dispatch` → `POST $APP_ORIGIN/api/cron/heartbeat` (Bearer `CRON_SECRET`) → `GET /api/health` → ล้ม (exit 1) ถ้า status ≠ 2xx หรือ heartbeat `vercel-cron` เก่ากว่า 48 ชม. · repo ต้องเป็น private (กติกา 60 วันของ GitHub ใช้กับ public) · push จากบัญชี boss และเปิดแจ้งเตือน Actions ทางอีเมล

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
