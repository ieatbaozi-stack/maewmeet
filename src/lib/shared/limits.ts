// เพดานของกลุ่ม/คำเชิญ — R2_CONTRACT §3 ข้อ 2–3, 5 · ปรับได้ที่นี่ที่เดียว (ทุกด่านอ่านจากค่าเหล่านี้)
import { DAY_MS, MINUTE_MS } from './clock';

export const GROUP_LIMITS = {
  /** กลุ่มที่ผู้ใช้หนึ่งคน "สร้าง" ได้ (นับเฉพาะที่ยังไม่ถูกลบ) */
  groupsCreatedPerUser: 10,
  /** สมาชิกต่อกลุ่ม */
  membersPerGroup: 50,
  /** โค้ดเชิญที่ยังใช้ได้พร้อมกันต่อกลุ่ม */
  activeCodesPerGroup: 20,
  /** อายุโค้ดเชิญ/คำเชิญตรง (D6, R2 §3 ข้อ 5) */
  inviteTtlMs: 7 * DAY_MS,
  /** คำเชิญตรงที่ค้าง (active, ยังไม่หมดอายุ, กลุ่มยังอยู่) ต่อผู้รับหนึ่งคน — กันสแปมผู้รับจากหลายผู้ชวน/หลายกลุ่ม */
  pendingDirectInvitesPerInvitee: 20,
  /** GET /api/me/invites คืนสูงสุดกี่รายการ (ใหม่สุดก่อน) */
  myInvitesListMax: 50,
  nameMin: 1,
  nameMax: 40,
} as const;

/**
 * R7 G1 (boss 2026-11-03): กลุ่มใหม่ "ว่างอย่างน้อย" = 4 ชม. — ส่งตอน insert ที่ service → repo (insertGroupIfUnderCap)
 * ไม่ใช่ DB default: schema.ts ยัง `default(120)` เพราะ SQLite เปลี่ยน default ต้อง rebuild ตาราง (ความเสี่ยงแบบ migration 0002)
 * กลุ่มที่มีอยู่ไม่เปลี่ยน · ช่วงเวลาว่างของกลุ่มใหม่ยังเป็น DB default 08:00–22:00 (480–1320)
 */
export const GROUP_DEFAULT_MIN_FREE_MINUTES = 240;

// เพดาน busy / ปฏิทิน — R3_CONTRACT §2 (ค่าเริ่มต้นของ Lead) · lib เวลารับค่าเหล่านี้เป็นพารามิเตอร์ ไม่ฮาร์ดโค้ด
/** busy ต่อผู้ใช้ที่ end_at > now − (BUSY_MAX_BACKDATE_DAYS + 1) วัน = ทุกแถวที่ยังสร้าง/แก้ได้ (รวมที่จบแล้วแต่ยังย้อนลงได้) — R3 H1 */
export const BUSY_MAX_PER_USER = 300;
/** ช่วงเดียวครอบได้ไม่เกินกี่วันปฏิทิน (ทั้งสองแบบ) */
export const BUSY_MAX_SPAN_DAYS = 366;
/** busy แบบมีเวลา ยาวสุดกี่วัน (ความยาวจริง — ADR 0004 §2) */
export const BUSY_MAX_TIMED_DAYS = 62;
/** ลงย้อนหลังได้ไม่เกินกี่วัน */
export const BUSY_MAX_BACKDATE_DAYS = 7;
/** ช่วงวันที่ที่ขอดูได้ต่อคำขอ (ปฏิทินกลุ่ม · รายการของฉันแบบช่วง) — monthGrid() ≤ 42 วัน */
export const CALENDAR_MAX_RANGE_DAYS = 62;
/** ปฏิทินกลุ่ม: แถว busy สูงสุดต่อคำตอบ (เกิน → truncated: true) */
export const CALENDAR_MAX_ITEMS = 5000;
/** GET /api/me/busy?from&to: แถวสูงสุดต่อคำตอบ (เกิน → truncated: true) */
export const ME_BUSY_RANGE_MAX_ITEMS = 1000;
/** แถว busy ที่จบนานกว่านี้ถูก cron รายวันลบถาวร (วัน) — ต้องมากกว่า BUSY_MAX_BACKDATE_DAYS มาก */
export const BUSY_RETENTION_DAYS = 90;
/** R8 F1 §2.2: "ลงวันไม่ว่างแล้ว" = มี busy_block ทับช่วง [ตอนนี้, ตอนนี้ + N วันปฏิทินใน tz ของกลุ่ม) */
export const UPCOMING_BUSY_LOOKAHEAD_DAYS = 30;
/** ความยาวสูงสุดของ title / note (อักขระ = code point) */
export const BUSY_TITLE_MAX = 80;
export const BUSY_NOTE_MAX = 500;
/**
 * R6F (ADR 0010 §8 · main ตัดสิน 2026-11-02): limiter เขียน busy ต่อผู้ใช้ — fixed window ผ่าน rate_limit_bucket · เกิน → RATE_LIMITED + Retry-After
 * create นับต่อคำขอ (ทุก kind — ชุดรายวัน 62 แถวก็นับ 1) · delete นับต่อคำขอ (ทั้ง scope=one และ series)
 */
export const BUSY_WRITE_RATE_LIMITS = {
  create: { prefix: 'busy:create', limit: 30, windowMs: 10 * MINUTE_MS },
  delete: { prefix: 'busy:delete', limit: 60, windowMs: 10 * MINUTE_MS },
} as const;

/** ชนิดเพดานที่ใส่ใน params ของ LIMIT_REACHED (UX แปลตามนี้) */
export type LimitKind =
  | 'groups'
  | 'members'
  | 'codes'
  | 'pendingInvites'
  | 'busyCount'
  | 'busySpan'
  | 'busyBackdate'
  | 'appointments'
  | 'appointmentsPerDay'
  | 'appointmentSpan';

// ───────── นัด / แจ้งเตือน / สถานที่ — R4B_CONTRACT §2 ─────────
export const APPOINTMENT_TITLE_MAX = 80;
export const APPOINTMENT_DESCRIPTION_MAX = 1000;
export const APPOINTMENT_PLACE_NAME_MAX = 120;
export const APPOINTMENT_MAP_URL_MAX = 500;
/** นัดที่ยัง active และยังไม่จบ (end_at > now) ต่อกลุ่ม — ยกเลิกแล้วไม่นับ (R4B-1/R4B-5) */
export const APPOINTMENT_MAX_ACTIVE_PER_GROUP = 100;
/** สร้าง/ย้ายเวลานัดให้เริ่มย้อนหลังได้ไม่เกินนี้ (กันกดพลาด) */
export const APPOINTMENT_MAX_BACKDATE_MS = 60 * 60 * 1000;
/** ความยาวนัดสูงสุด (วัน) — เท่ากับ busy แบบมีเวลา (ADR 0004 §2) */
export const APPOINTMENT_MAX_SPAN_DAYS = BUSY_MAX_TIMED_DAYS;
export const APPOINTMENT_LIST_DEFAULT = 20;
export const APPOINTMENT_LIST_MAX = 50;
/** R6D (ADR 0009 §3): myConflicts ในรายละเอียดนัด — สูงสุด 5 รายการ (+ myConflictsTruncated) */
export const APPOINTMENT_MY_CONFLICTS_MAX = 5;
/** R6D: เพดานคำมั่นของฉันที่โหลดเพื่อคำนวณ myConflict ของการ์ดในรายการ (1 query ต่อหน้า) */
export const APPOINTMENT_LIST_CONFLICT_SCAN_MAX = 500;
export const NOTIFICATION_LIST_DEFAULT = 20;
export const NOTIFICATION_LIST_MAX = 50;
/** POST /api/me/notifications/read {ids} — จำนวน id สูงสุดต่อคำขอ */
export const NOTIFICATION_READ_IDS_MAX = 100;

/** นัดที่ "สร้าง" ในกลุ่มภายใน 24 ชม.ล่าสุด (rolling) — นับรวมนัดที่ยกเลิกแล้ว กันวน create/cancel · เกิน → LIMIT_REACHED { limit: 'appointmentsPerDay', max } (R4B SEC M1) */
export const APPOINTMENT_MAX_CREATED_PER_GROUP_PER_DAY = 30;
/** แจ้งเตือนที่ยังไม่อ่านต่อผู้ใช้ต่อกลุ่มต่อชนิด (ชนิดที่มีเพดาน: UnreadCappedKind) — ครบแล้วไม่เขียนเพิ่ม (coalesce; ผู้ใช้เห็น 20+ อยู่แล้ว) · นับเฉพาะที่เห็นได้ */
export const APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX = 20;
/** limiter เขียนต่อผู้ใช้ (ทุกกลุ่มรวมกัน) — fixed window ผ่าน rate_limit_bucket · เกิน → RATE_LIMITED + Retry-After */
export const APPOINTMENT_WRITE_RATE_LIMITS = {
  createShort: { prefix: 'appt:create:s', limit: 10, windowMs: 10 * MINUTE_MS },
  createDay: { prefix: 'appt:create:d', limit: 30, windowMs: DAY_MS },
  update: { prefix: 'appt:update', limit: 60, windowMs: 10 * MINUTE_MS },
  cancel: { prefix: 'appt:cancel', limit: 60, windowMs: 10 * MINUTE_MS },
  rsvp: { prefix: 'appt:rsvp', limit: 120, windowMs: 10 * MINUTE_MS },
} as const;

// ───────── บัญชีของฉัน / หน้า super admin — R5_CONTRACT §2 ─────────
/** limiter ต่อผู้ใช้ (fixed window ผ่าน rate_limit_bucket) · เกิน → RATE_LIMITED + Retry-After */
export const ACCOUNT_RATE_LIMITS = {
  /** PATCH /api/me — เปลี่ยนชื่อที่แสดง 10 ครั้ง/วัน/ผู้ใช้ (นับเฉพาะที่เปลี่ยนจริง) */
  rename: { prefix: 'me:rename', limit: 10, windowMs: DAY_MS },
} as const;

// ───────── หน้าตาของฉันในกลุ่ม — R6C_CONTRACT §2 ─────────
/** PATCH /api/groups/:gid/members/me/appearance — 60 ครั้ง/10 นาที/ผู้ใช้ (ทุกกลุ่มรวมกัน) · เกิน → RATE_LIMITED + Retry-After */
export const MEMBER_APPEARANCE_RATE_LIMIT = { prefix: 'member:appearance', limit: 60, windowMs: 10 * MINUTE_MS } as const;

// ───────── กลุ่มปัจจุบัน (คุกกี้ mm_group) — R6D G1 · ADR 0009 §5 ─────────
/** PUT /api/me/current-group — 120 ครั้ง/10 นาที/ผู้ใช้ (เรียกเมื่อเปิดหน้ากลุ่ม/เปลี่ยนกลุ่ม) · เกิน → RATE_LIMITED + Retry-After */
export const CURRENT_GROUP_RATE_LIMIT = { prefix: 'me:current-group', limit: 120, windowMs: 10 * MINUTE_MS } as const;

export const ADMIN_RATE_LIMITS = {
  /** ทุก endpoint admin ที่เขียน (suspend / unsuspend / unlock) — 60 ครั้ง/10 นาที/ผู้ใช้ */
  write: { prefix: 'admin:write', limit: 60, windowMs: 10 * MINUTE_MS },
} as const;

/** หน้าละกี่แถวของรายการผู้ใช้/กลุ่มในหน้า admin */
export const ADMIN_PAGE_SIZE = 30;
/** ความยาวสูงสุดของคำค้น q (code point หลัง NFKC + trim) */
export const ADMIN_QUERY_MAX = 40;
/** audit log: ดีฟอลต์/สูงสุดต่อหน้า */
export const AUDIT_LIST_DEFAULT = 50;
export const AUDIT_LIST_MAX = 100;
/** การเปิดดู audit เขียน `admin.audit.view` ไม่เกิน 1 แถว/ช่วงนี้/ผู้ใช้ (กัน audit บวมจากการรีเฟรช) */
export const AUDIT_VIEW_LOG_INTERVAL_MS = 10 * MINUTE_MS;

// ───────── เตือนก่อนนัด / LINE — R10_CONTRACT §1, §2 · ADR 0011 §4 ─────────
export const REMINDER_CRON = {
  /** นัดที่ตรวจต่อรอบ (เรียงเริ่มเร็วสุดก่อน · query ตัดนัดที่ทำครบแล้วออกก่อน LIMIT) */
  scanMax: 500,
  /** จำนวนคู่ (นัด, ชนิด) ที่ถึงกำหนดและเขียนต่อรอบ ที่เหลือไปรอบถัดไป */
  maxClaimsPerRun: 40,
  /** เวลาทำงานสูงสุดต่อรอบ (ms) — ต่ำกว่า timeout 30 วินาทีของ fallback cron-job.org (ADR 0011 §4) */
  budgetMs: 20_000,
} as const;

export const LINE_DISPATCH = {
  perRun: 40,
  /** ADR 0007 §2: attempts สูงสุด 5 · backoff 2^attempts นาที */
  maxAttempts: 5,
  timeoutMs: 8_000,
  /** ส่งทันทีหลังยกเลิกนัด (R11 §2 — ทำงานหลังตอบ API แล้ว) · เกินเวลา = เหลือให้ cron */
  afterResponseBudgetMs: 20_000,
} as const;

/** เพดานกันโควตา LINE หมด (R10 §1.4 · Security M1) — นับจากแถว outbox ตอนจองส่ง · เกิน = ไม่ push กระดิ่งปกติ */
export const LINE_SEND_CAPS = {
  /** นัด + ชนิด + ผู้รับเดียวกัน */
  perAppointmentKindUser: 2,
  /** ผู้รับหนึ่งคน */
  perUser: 6,
  windowMs: DAY_MS,
} as const;

export const LINE_LINK_CODE_TTL_MS = 10 * MINUTE_MS;
export const LINE_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
export const LINE_WEBHOOK_MAX_EVENTS = 20;

export const LINE_LINK_RATE_LIMITS = {
  /** POST /api/me/line ต่อผู้ใช้ */
  create: { prefix: 'line:code:create', limit: 10, windowMs: 60 * MINUTE_MS },
  /** ข้อความรูปโค้ดใน webhook ต่อบัญชี LINE (คีย์เป็น HMAC ของ LINE user id) */
  attempt: { prefix: 'line:code:try', limit: 10, windowMs: 10 * MINUTE_MS },
} as const;
