# ADR 0015 — การเก็บข้อมูลที่ลบ: กลุ่มเก็บ 30 วัน กู้คืนได้ แล้วลบถาวรอัตโนมัติ · บัญชีล้างทันที

- **Status**: Accepted (2026-11-19) · boss ตัดสิน B1–B4 = (ก) ทุกข้อ ใน [R17_CONTRACT](../contracts/R17_CONTRACT.md) §5 (2026-11-19) · ที่มา R16 §5 B4 = (ก) (boss 2026-11-18) · บันทึกโดย Architect 2026-11-19 หลังอ่านโค้ด platform commit `20de516` · ส่วนเติม R18 (2026-11-22): ลำดับลบแขก/ลิงก์ใน purge กลุ่ม + ลำดับงาน D1/§S7 ใน cron (§4)
- **เกี่ยวข้อง**: [ADR 0003](0003-rbac.md) (action `admin.group.restore`) · [ADR 0004](0004-time-and-timezone.md) (เวลา UTC + `src/lib/calendar`) · [ADR 0007](0007-notifications.md) (ชนิด `group.restored`) · [ADR 0002](0002-auth-pin.md) (ลบบัญชียืนยันด้วย PIN) · `docs/design/ARCHITECTURE.md` ข้อ 5, 8 · `docs/OPERATIONS.md` (ops: วิธีกู้ด้วยมือ/นโยบาย)
- **เจ้าของการ implement**: Platform (`src/lib/data/group-retention.ts`, `repos/group-purge.ts`, `repos/admin-groups.ts`, `services/admin-groups.ts`, `services/maintenance.ts`, `services/account.ts`) · Frontend (หน้า admin กลุ่ม, sheet ยืนยันลบ) · UX (ถ้อยคำ TH/EN)

## Context
- ก่อน R17: ลบกลุ่ม = soft delete (`groups.deleted_at`) ข้อมูลอยู่ **ตลอดไป** และ super admin กู้ไม่ได้ · FK จาก `group_member`, `group_invite`, `appointment` (→ `appointment_rsvp`, `appointment_reminder`) เป็น `ON DELETE CASCADE` · `notification.params.groupId` และ `notification_outbox.payload.params.groupId` อ้างกลุ่มผ่าน JSON (ไม่มี FK) · `audit_log.group_id` ไม่มี FK
- ลบบัญชี (U13) ล้างข้อมูลส่วนตัวทันทีแล้ว anonymize แถว `user` (ARCHITECTURE ข้อ 3 "กฎข้อมูลที่ schema บังคับไม่ได้") — กู้ไม่ได้ตั้งแต่ตอนกด
- boss ต้องการ "ลบกลุ่มแล้วเก็บ 30 วัน super admin กู้ได้ แล้วลบถาวรอัตโนมัติ" และ "อะไรที่ลบหายถาวร ต้อง confirm หนักแน่น" (R17 §2)
- Vercel Hobby มี cron รายวันครั้งเดียว (ADR 0001) — ไม่เพิ่ม cron

## Decision

### 1. นโยบาย (B1–B4)
| ข้อ | ผลตัดสิน | ผลต่อระบบ |
|---|---|---|
| B1 บัญชี | (ก) คงแบบเดิม **ล้างทันที กู้ไม่ได้** แม้แต่ super admin | ไม่มีช่วงเก็บ · ยืนยันหนักขึ้น: `POST /api/me/delete` ต้องมี `confirmUsername` (ข้อ 5) |
| B2 กลุ่มที่ลบก่อนออกรุ่น | (ก) นับ 30 วันจาก**วันเริ่มใช้กติกา** ไม่ใช่วันที่ลบจริง | ไม่มีกลุ่มเก่าถูกลบถาวรทันทีวันแรก (ข้อ 2) |
| B3 แจ้งเตือนตอนกู้ | (ก) สมาชิกที่บัญชี active ทุกคนได้ `group.restored` ในกระดิ่ง ไม่ส่ง LINE | ADR 0007 ชนิดใหม่ |
| B4 ใครกู้ได้ | (ก) **super admin เท่านั้น** | action `admin.group.restore` อยู่ใน `SUPER_ADMIN_ONLY` + `SUPER_ADMIN_AUDITED` (ADR 0003) |

### 2. กติกาเวลา (ที่เดียว: `src/lib/data/group-retention.ts`)
- `GROUP_RETENTION_DAYS = 30` · `GROUP_RETENTION_START_DATE = '2026-12-01'` → `GROUP_RETENTION_START_MS` = 00:00 Asia/Bangkok ของวันนั้น คำนวณด้วย `parseLocalDateTime` ของ `src/lib/calendar` (กฎ 9, ADR 0004)
- **เวลาลบถาวร** `purgeAt = max(deleted_at, START) + 30 วัน` · **กู้ได้** เมื่อ `now < purgeAt` · **ลบถาวรได้** เมื่อ `purgeAt <= now` — เส้นเดียวกัน ไม่มีช่วงที่ทั้งกู้ได้และลบได้ หรือไม่ได้ทั้งคู่
- B2 ทำด้วย **ค่าคงที่ในโค้ด** ไม่แก้ `deleted_at` ในฐาน (ค่าจริงของ "ลบเมื่อไร" ยังอยู่ให้ audit/หน้า admin) · ค่า START เลือก "ไม่ก่อนวันออกรุ่น" — ช้ากว่าวันออกรุ่นได้ (= เก็บนานขึ้น) ห้ามเร็วกว่า · **ถ้าออกรุ่นหลัง 2026-12-01 ต้องเลื่อนค่านี้ก่อน merge** (R17 §8)
- ก่อน `START + 30 วัน` (2026-12-31 00:00 Asia/Bangkok) ไม่มีกลุ่มไหนถึงกำหนด — `purgeDeletedAtCutoff()` คืน `null` และ cron ไม่ลบอะไร

### 3. กู้คืน — `POST /api/admin/groups/:gid/restore`
- ลำดับ: `authorize('admin.group.restore')` (ไม่ใช่ SA → **403 FORBIDDEN** แบบเดียวกับ `/api/admin/*` ทุกตัว — R17 §8 แก้ข้อความ "404" ใน §1) → limiter เขียนของ admin (`ADMIN_RATE_LIMITS.write`) → ธุรกรรมเขียนเดียว:
  1. `UPDATE groups SET deleted_at = NULL ... WHERE id = ? AND deleted_at IS NOT NULL AND max(deleted_at, START) + 30 วัน > now AND <มี admin ที่บัญชี active> RETURNING` — **คำสั่งเดียวมีเงื่อนไขในตัว** (ไม่มีช่อง check-then-act)
  2. ได้แถว → audit `group.restore` (meta `asSuperAdmin`) + `notify(group.restored)` ในธุรกรรมเดียวกัน
  3. ไม่ได้แถว → วินิจฉัยในธุรกรรมเดียวกัน: ไม่มีกลุ่ม/ลบถาวรแล้ว → 404 `NOT_FOUND` · ไม่ได้ลบอยู่ → 200 `{changed: false}` (ไม่ audit ไม่แจ้ง) · เกินเวลา → 409 `CONFLICT {reason: 'RETENTION_EXPIRED'}` · ไม่มี admin ที่ active → 409 `CONFLICT {reason: 'NO_ACTIVE_ADMIN'}`
- กู้ได้ทั้งกลุ่มเท่านั้น (สมาชิก/นัด/คำเชิญเดิมกลับมาเพราะไม่เคยถูกลบ) · ไม่มีการกู้รายการย่อย (R17 §6)
- หน้า admin ไม่คำนวณเอง: รายการ/รายละเอียดกลุ่มคืน `purgeAt` / `restorable` / `restoreBlockedReason` ที่เซิร์ฟเวอร์คำนวณด้วยฟังก์ชันเดียวกัน (กฎ 6)

### 4. ลบถาวรอัตโนมัติ — ข้อ 6 ของ `runDailyMaintenance` (cron daily เดิม)
- เลือก id กลุ่มที่ `deleted_at IS NOT NULL AND deleted_at <= cutoff` (`cutoff = now − 30 วัน` และ ≥ START) เก่าสุดก่อน ไม่เกิน `GROUP_PURGE_BATCH = 25` กลุ่ม/รอบ (เกินไปรอบถัดไป · ผลคืน `purgedGroups: {groups, failed, remaining}`)
- **ธุรกรรมเขียนแยกต่อกลุ่ม** · ในธุรกรรม: ตรวจเงื่อนไขซ้ำเป็นคำสั่งแรก (ถูกกู้ไปแล้ว → ข้าม) แล้วลบตาม**ลำดับ**:
  1. `notification_outbox` ที่ `payload.params.groupId` = กลุ่ม (ทุกสถานะ)
  2. `notification` ที่ `params.groupId` = กลุ่ม (ของทุกผู้รับ)
  3. `appointment_reminder` → 4. `appointment_rsvp` (ของนัดในกลุ่ม) → 5. `appointment` → 6. `group_invite` → 7. `group_member`
  8. แถว `groups` (เงื่อนไขเดิมซ้ำ · ไม่ได้ 1 แถว → throw ให้ rollback ทั้งก้อน)
  9. audit `group.purge` (actor = ระบบ `NULL`) meta = **จำนวนแถวเท่านั้น** (`members, invites, appointments, rsvps, reminders, notifications, outbox`) ไม่มีชื่อกลุ่ม
- ลบลูกด้วยคำสั่งชัดเจนแทนพึ่ง cascade อย่างเดียว — ได้จำนวนแถวจริงไปลง audit และไม่ค้างแม้ `foreign_keys` ถูกปิด
- ข้อ 6 ทำ**หลัง**งานเก็บกวาดข้อ 1–4 (คนละธุรกรรม) — ลบกลุ่มล้มไม่ทำให้งานเก็บกวาดหาย · รันซ้ำได้ (idempotent: กลุ่มที่ลบแล้วไม่อยู่ในรายการอีก)
- **แข่งกับการกู้คืน:** ทั้งสองฝั่งเป็นธุรกรรมเขียนที่มีเงื่อนไขในคำสั่ง — ฝั่งที่เขียนก่อนชนะ · กู้ก่อน → `deleted_at` เป็น NULL → purge ข้าม · purge ก่อน → กู้ได้ 404 · และเส้นเวลาเดียวกัน (ข้อ 2) ทำให้ ณ เวลาเดียวกันมีเพียงฝั่งเดียวที่เงื่อนไขเป็นจริง
- **ส่วนเติม R18 (2026-11-22, Architect — อ่านโค้ดที่ `091a2d4`):**
  - **ลำดับลบใน `purgeGroupIfDue` เพิ่ม 2 ขั้น** หลังข้อ 2 (`notification`) และก่อนข้อ 3 (`appointment_reminder`): `appointment_guest` → `appointment_share_link` ของนัดในกลุ่ม (แขกก่อนเพราะ FK `link_id`) — [ADR 0016 §7.3](0016-appointment-share-guests.md) · `GroupPurgeCounts`/meta ของ audit `group.purge` เพิ่ม `guests`, `shareLinks` (จำนวนเท่านั้น) · แจ้งเตือนของแขก (รวม `appointment.guest.removed`) มี `params.groupId` จึงถูกลบในข้อ 2 เดิม
  - **ลำดับงานใน `runDailyMaintenance`**: เก็บกวาดข้อ 1–4 → ลบกลุ่มถาวร (ข้อนี้) → **R18 D1 `purgeOldInvites`** (คำเชิญที่จบ `max(expires_at, revoked_at)` เกิน 30 วัน · boss B1) → **R18 §S7 `purgeOldShareLinks`** (ลิงก์ที่สิ้นสุดเกิน 30 วัน) · ทั้งสองงานใหม่ทำ**หลัง**ลบกลุ่มถาวร เพราะคำเชิญ/ลิงก์ของกลุ่มที่ purge ถูกลบไปพร้อมกลุ่มแล้ว (ไม่นับซ้ำ) และหลังงาน `expiredInvites` ที่เปลี่ยนสถานะไปแล้ว · แต่ละงานเป็นธุรกรรมต่อชุด (200 แถว ≤ 10 ชุด/รอบ) ล้มแล้วหยุดรอบนั้นโดยไม่ทำให้ cron ล้ม · ผลคืนในฟิลด์ `purgedInvites`, `purgedShareLinks`
  - **กู้กลุ่ม**: คำเชิญ/ลิงก์ชวน/แขกของกลุ่มที่ยังไม่ถูกลบกลับมาพร้อมกลุ่ม (ไม่เคยถูกแตะ) · คำเชิญที่จบแล้วเกิน 30 วันอาจถูก D1 ลบไปแล้วระหว่างกลุ่มอยู่ในถังลบ (ไม่กระทบการกู้ — เป็นคำเชิญที่ใช้ไม่ได้อยู่แล้ว) · ข้อควรรู้หลังกู้ (โค้ดเชิญที่ยังไม่หมดอายุใช้ได้อีก · เพดานกลุ่มต่อผู้สร้างอาจเกิน) และเรื่องที่ตัดสินแล้วว่าไม่แก้ (security-r17 Info 3–4, security-r16 Info 4 — R18 D3) บันทึกใน `docs/OPERATIONS.md` ส่วน K4
- **สิ่งที่คงไว้:** `audit_log` (รวม `group_id` ของกลุ่มที่ลบถาวรแล้ว — มีแค่ id/enum ไม่มีชื่อกลุ่ม · retention เดิม ไม่ขยาย R17 §6) · `rate_limit_bucket` ที่คีย์มี id กลุ่ม ปล่อยให้งานข้อ 1 ลบเองภายใน 2 วัน

### 5. บัญชี (B1) — ล้างทันทีเหมือนเดิม + ยืนยันหนักขึ้น
- `POST /api/me/delete` body = `{pin, confirmUsername}` (`.strict()`) · `confirmUsername` normalize แบบเดียวกับ login แล้วต้องตรง `username_normalized` ของผู้เรียก · ไม่ส่ง/ไม่ตรง → **400 `VALIDATION`** `{fields:{confirmUsername:'REQUIRED'|'MISMATCH'}}` **ก่อน** จองตัวนับและ verify PIN (ไม่นับเป็น PIN ผิด ไม่ล็อก ไม่สะท้อนชื่อจริงใน error)
- ขั้นตอนลบ/anonymize เดิมไม่เปลี่ยน · ไม่มีการเก็บข้อมูลส่วนตัว 30 วัน · แถว `user` ที่ anonymize คงไว้เป็น FK ของนัด/audit (R17 §6)

### 6. Schema
- **ไม่มี migration** (R17 §8 G6): ไม่มีคอลัมน์/ตารางใหม่ · ไม่เพิ่ม index `groups(deleted_at)` — ตาราง `groups` เล็กและ purge รันวันละครั้ง (platform ประเมิน · ยังไม่ได้วัดด้วย `EXPLAIN QUERY PLAN` บนฐานจริง)

## Consequences
- + กลุ่มที่ลบผิดกู้คืนได้ครบภายใน 30 วันโดยไม่มีงานมือในฐาน · หลังจากนั้นข้อมูลกลุ่ม (สมาชิกภาพ นัด RSVP คำเชิญ แจ้งเตือน คิว LINE) หายจริง — ลดข้อมูลค้างไม่มีกำหนด
- + บัญชียังตรงสิทธิ์ลบข้อมูล (ล้างทันที) และกดพลาดยากขึ้น
- − แจ้งเตือนเกี่ยวกับกลุ่มที่ลบถาวรหายจากกระดิ่งของผู้รับทุกคน (รวมที่ยังไม่อ่าน) — ตั้งใจ
- − `audit_log` มี `group_id` ที่ชี้กลุ่มที่ไม่มีแล้ว — หน้า audit ต้องรับได้ว่าไม่มีชื่อกลุ่ม
- − ค่า `GROUP_RETENTION_START_DATE` ผูกกับวันออกรุ่น ต้องตรวจก่อน merge · หลัง 2026-12-31 ค่านี้ไม่มีผลกับกลุ่มที่ลบหลัง START แล้ว
- − ถ้ามีกลุ่มถึงกำหนดเกิน 25 กลุ่ม/วัน จะลบช้าออกไปทีละวัน (ยอมรับ — กู้ไม่ได้อยู่แล้วเพราะเกินเวลา)
- เพิ่มตาราง/ช่องทางที่อ้างกลุ่มผ่าน JSON ในอนาคต → **ต้องเพิ่มคำสั่งลบใน `purgeGroupIfDue`** (ไม่มี FK ช่วย)

## ทางเลือกที่ไม่เลือก
- **B1 (ข) บัญชีเก็บ 30 วันกู้ได้** — ต้องเก็บ PIN hash/ชื่อ/LINE ไว้ต่อ ขัดทิศเดิมเรื่องสิทธิ์ลบข้อมูล · รอบใหญ่ (R17b)
- **B2 (ข) นับจากวันที่ลบจริง** — กลุ่มที่ลบเกิน 30 วันแล้วหายทันทีที่ cron รันครั้งแรก
- **B2 ด้วย migration ตั้ง `deleted_at` ใหม่** — ทำลายค่าจริงของ "ลบเมื่อไร" และต้องรันบน preview/prod · ค่าคงที่ในโค้ดย้อนได้ง่ายกว่า
- **B4 (ข) admin กลุ่มกู้เอง** — ต้องมีหน้า "กลุ่มที่ฉันลบ" + กติกาสิทธิ์ใหม่
- **cron แยกสำหรับ purge** — Hobby จำกัดจำนวน cron · งานวันละครั้งพอ
- **พึ่ง `ON DELETE CASCADE` อย่างเดียว** — ไม่ครอบ notification/outbox (JSON) และไม่ได้จำนวนแถวไปลง audit

## Test requirements
1. 29 วันยังอยู่และกู้ได้ · ครบ 30 วันถูกลบ · ไม่มีแถวลูก/แจ้งเตือน/outbox ค้าง · audit `group.purge` มีแค่จำนวนแถว
2. B2: กลุ่มที่ `deleted_at` ก่อน START ไม่ถูกลบก่อน START + 30 วัน
3. cron รันซ้ำ = ไม่ลบเพิ่ม/ไม่ error · batch 25 + `remaining`
4. กู้: SA สำเร็จ (สมาชิก/นัด/คำเชิญกลับมา + audit + แจ้งสมาชิก active ยกเว้นผู้กระทำ, ไม่เข้า outbox LINE) · ไม่ใช่ SA = 403 · เกินเวลา/ไม่มี admin active = 409 + reason · ไม่มีกลุ่ม = 404 · ยังไม่ลบ = 200 `changed:false`
5. แข่ง restore vs purge: ผลลัพธ์มีแค่ฝั่งเดียว ไม่มีสถานะครึ่งทาง
6. ลบบัญชี: ไม่ส่ง/ส่ง `confirmUsername` ผิด → 400 ไม่ลบ ไม่นับ PIN ผิด
- (platform มีใน `tests/platform/r17-group-retention.test.ts`, `tests/account/delete.test.ts` — architect อ่านรายชื่อไฟล์จาก commit `20de516` ไม่ได้ตรวจทีละเคส)

## ยืนยันแล้ว / ยังไม่ยืนยัน
- ยืนยันแล้ว (อ่านโค้ด commit `20de516` 2026-11-19): ค่าคงที่และสูตรใน `group-retention.ts` · ลำดับลบใน `repos/group-purge.ts` · UPDATE มีเงื่อนไขใน `restoreGroupGuarded` · `LINE_KINDS` ใน `notify.ts` ไม่มี `group.restored` (กระดิ่งเท่านั้น) · `audit_log.group_id` ไม่มี FK (`src/db/schema.ts`) · `AUDIT_META_WHITELIST` ของ `group.purge` เป็นจำนวนแถวล้วน · ไม่มีไฟล์ใน `drizzle/` ใหม่
- ยังไม่ยืนยัน: ประสิทธิภาพ query purge โดยไม่มี index บนฐานจริง (ไม่ได้รัน `EXPLAIN`) · วันออกรุ่นจริง (ถ้าหลัง 2026-12-01 ต้องเลื่อน START)
