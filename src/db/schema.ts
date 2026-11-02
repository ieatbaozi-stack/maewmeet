// src/db/schema.ts — Schema v1 ทั้งชุด (17 ตาราง) ตาม docs/design/ARCHITECTURE.md §3
// คัดตามเอกสารตรงตัว (Architect ทดสอบร่างนี้กับ drizzle-kit แล้ว) — เปลี่ยนชื่อตาราง/คอลัมน์ต้องผ่าน Lead
// เวลาทุกคอลัมน์ = epoch ms UTC ตั้งจาก clock.now() ในแอป (ไม่ใช้ default ของ DB)
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
  name: text('name').notNull(),                                       // 1–40 (R2 §3 ข้อ 1 — บังคับใน service: trim, ห้ามควบคุม/bidi/zero-width)
  tz: text('tz').notNull().default('Asia/Bangkok'),                   // ADR 0004 §4
  freeWindowStartMin: integer('free_window_start_min').notNull().default(480),   // 08:00
  freeWindowEndMin: integer('free_window_end_min').notNull().default(1320),      // 22:00
  // R7 G1: ค่าที่กลุ่มใหม่ได้จริงมาจาก service (GROUP_DEFAULT_MIN_FREE_MINUTES = 240 ใน src/lib/shared/limits.ts) — default(120) คงไว้
  // เพราะเปลี่ยน default ของ SQLite ต้อง rebuild ตาราง (ความเสี่ยงแบบ 0002) · ไม่มี migration: insert ของแอปส่งค่าเองทุกครั้ง
  minFreeMinutes: integer('min_free_minutes').notNull().default(120),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
  deletedAt: ms('deleted_at'),                                        // soft delete (U6)
}, (t) => [
  index('groups_created_by_idx').on(t.createdBy),                      // R2: นับกลุ่มที่สร้าง (เพดาน 10) — migration 0001
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
  // R6C F3ก: หน้าตาที่สมาชิกเลือกเองในกลุ่มนี้ (slot 1–10) · NULL = ใช้ hash เดิม (memberColorIndex) · สี/รูปทรงแยกอิสระ
  colorSlot: integer('color_slot'),
  shapeSlot: integer('shape_slot'),
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
  codeHash: text('code_hash'),                                        // code: HMAC-SHA256(HKDF(APP_SECRET,'maewmeet/invite-code/v1'), โค้ด normalize แล้ว) hex — ไม่เก็บโค้ดดิบ
  codeHint: text('code_hint'),                                        // 4 ตัวท้ายของโค้ด (ไม่มีขีด) ให้ผู้สร้าง/admin/mod จำได้ในรายการ
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
  // R6F (ADR 0010 §4): ชุดรายวัน · uuid ที่เซิร์ฟเวอร์สร้างตอน POST kind:'daily' (N ≥ 2) · NULL = รายการเดี่ยว · ไม่มี FK (ไม่มีตารางชุด)
  // เห็นเฉพาะเจ้าของ — คิวรีฝั่งแชร์ไม่ SELECT คอลัมน์นี้ (ADR 0010 §6)
  seriesId: text('series_id'),
}, (t) => [
  index('busy_user_start_idx').on(t.userId, t.startAt),
  index('busy_user_end_idx').on(t.userId, t.endAt),
  index('busy_user_series_idx').on(t.userId, t.seriesId).where(sql`${t.seriesId} is not null`),
  check('busy_range_ck', sql`${t.endAt} > ${t.startAt} and ${t.localEndDate} >= ${t.localStartDate}`),
]);

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
