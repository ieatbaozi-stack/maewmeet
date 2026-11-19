# Security review — R17 (กู้กลุ่ม 30 วัน + ลบถาวรอัตโนมัติ · ยืนยันลบบัญชีด้วยชื่อผู้ใช้)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-19 · branch `feat/r17-retention` HEAD `f78d989` · ช่วง `git diff 7ff7e45..HEAD -- src tests` · เทียบ [R17_CONTRACT](../contracts/R17_CONTRACT.md) §1, §2, §5, §8 + [ADR 0015](../adr/0015-data-retention-group-restore-purge.md) · กฎเหล็ก CLAUDE.md ข้อ 6–9
- วิธี: อ่านโค้ดฝั่งเซิร์ฟเวอร์ทุกไฟล์ใน diff (route, rbac, repos, services, serializer, notify) + โค้ดเดิมที่เกี่ยว (`repos/account.ts`, `repos/line.ts`, `repos/reminder.ts`, `tx.ts`, `schema.ts`) · รันเทสต์ของทีม · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด · ❓ = ยืนยันไม่ได้

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Info | 5 |

**Verdict: ผ่านแบบมีข้อสังเกต** — route กู้คืนตรวจ SA ที่เซิร์ฟเวอร์ผ่าน policy กลางก่อนแตะอะไร (403 แบบเดียวกับ admin route อื่น) · การแก้ `src/lib/rbac` เป็นการเพิ่ม action ใหม่ล้วน ไม่กระทบ action อื่น · กู้คืน/ลบถาวรตัดสินด้วยคำสั่งเดียวที่มีเงื่อนไข ใช้เส้นเวลาเดียวกัน · purge ล้างครบทุกตารางที่อ้างกลุ่ม · `confirmUsername` ตรวจก่อนจองตัวนับ PIN ไม่สะท้อนชื่อ · Low 1 = ถ้ากลุ่มเดียวลบไม่สำเร็จ purge ทั้งรอบหยุด ไม่บล็อก merge

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **G1 SA เท่านั้น ตรวจที่เซิร์ฟเวอร์** | **PASS** | 📖 `services/admin-groups.ts:65` `authorize(actor,'admin.group.restore',{type:'none'})` เป็นบรรทัดแรก ก่อน limiter (`:68`) และก่อนอ่าน DB → คนที่ไม่ใช่ SA ไม่กินโควตา ไม่เห็นว่ากลุ่มมีอยู่ไหม · `can.ts:262` ด่าน `isSuperAdminOnly` → FORBIDDEN · manifest `manifest.ts:100` auth `actor` → CSRF Origin + JSON content-type (`route.ts:268`) · ✅ `r17-group-retention.test.ts:128` admin/mod/member/คนนอก ได้ 403 ไบต์ตรงกับ route admin อื่น ไม่มี audit/แจ้งเตือน · `:145` anonymous 401, origin ผิด 403 CSRF_REJECTED, SA ต้องเปลี่ยน PIN 403, SA ถูกระงับ 401, gid ผิดรูป 400 (`z.uuid()`) |
| **การแก้ `src/lib/rbac` (นอกขอบเขต platform)** | **PASS** | 📖 diff = เพิ่ม `'admin.group.restore'` ใน `ACTIONS` (`actions.ts:84`), `SUPER_ADMIN_ONLY` (`:121`), `SUPER_ADMIN_AUDITED` (`:137`), `ACTION_RESOURCE` = `['none']` (`:222`), `RULES` = `superAdminAction(...)` (`can.ts:238`) — ไม่ลบ/เปลี่ยนบรรทัดเดิม ไม่แตะ `PUBLIC_ACTIONS`/`PIN_CHANGE_ALLOWED` → action ใหม่ไม่ใช่ public และ mustChangePin ถูกบล็อก · ✅ `tests/rbac` (matrix fixture เพิ่ม `SA_ONLY`) ผ่าน · `tests/security/r5-admin-surface.test.ts` ยืนยัน route ↔ action และ service ↔ action ผ่าน |
| **G1 คำสั่งเดียวมีเงื่อนไข + แข่ง purge/ลบบัญชี** | **PASS** | 📖 `repos/admin-groups.ts:107-113` `UPDATE … WHERE deleted_at IS NOT NULL AND max(deleted_at,START)+30d > now AND EXISTS(admin ที่ active) RETURNING` · purge ตรวจซ้ำเป็นคำสั่งแรกในธุรกรรมของตัวเอง (`group-purge.ts:38-40`) และ DELETE แถวกลุ่มด้วยเงื่อนไขเดิม ไม่ได้ 1 แถว → throw rollback (`:51-53`) · เส้นเวลา: กู้ได้ ⇔ `now < max(d,S)+30d` · ลบได้ ⇔ `d ≤ now−30d ∧ S ≤ now−30d` ⇔ `max(d,S)+30d ≤ now` — ตรงข้ามกันพอดี · ลบบัญชี: `markUserDeletedGuarded` มี `NOT holdsLiveGroupAdmin` (`repos/account.ts:27-29, 67`) ในคำสั่งเดียว → กู้ก่อน = ลบบัญชีถูกปฏิเสธ (admin ของกลุ่มที่กลับมา) · ลบบัญชีก่อน = สมาชิกภาพหาย → กู้ได้ 409 NO_ACTIVE_ADMIN · ✅ `r17-group-retention.test.ts:369,398` (แข่ง 6 รอบ + ลำดับกำหนด), `:241` (admin ลบบัญชีแล้ว → 409) |
| **G1 error ไม่รั่ว** | **PASS** | 📖 404/409 `{reason}` ออกเฉพาะหลังผ่าน authorize (SA) · reason เป็น enum `RETENTION_EXPIRED`/`NO_ACTIVE_ADMIN` ไม่มีชื่อกลุ่ม · ผลสำเร็จคืน `{id, restored, changed}` ไม่มีชื่อ |
| **G1 rate limit** | **PASS** | 📖 `takeUserSlot(ADMIN_RATE_LIMITS.write)` 60/10 นาที/ผู้ใช้ ร่วมกับ suspend/unlock · ✅ `:253` ครั้งที่ 61 = 429 |
| **G2 purge ครบ ไม่มีข้อมูลค้าง** | **PASS (Info 2, 3)** | 📖 ไล่ `schema.ts` ทุก FK: อ้าง `groups` = `group_member`, `group_invite`, `appointment` · อ้าง `appointment` = `appointment_rsvp`, `appointment_reminder` · ไม่มี FK แต่อ้างกลุ่ม = `notification.params.groupId`, `notification_outbox.payload.params.groupId` (ทุก kind ของกลุ่ม/นัดมี `groupId` — `notify.ts:40-75`, LINE payload ไม่ตัด `groupId` `:97`) · `busy_block`/`busy_routine` ผูกผู้ใช้ไม่ผูกกลุ่ม · ลบครบทั้ง 7 ชนิดแบบชัดเจน (`group-purge.ts:42-50`) · คงไว้: `audit_log` (id/enum/ตัวเลข ไม่มีชื่อ — whitelist `serializers/admin.ts:113-147`), `rate_limit_bucket` (cron ลบใน 2 วัน) · ✅ `:286` ไม่มีแถวลูก/แจ้งเตือน/outbox ค้าง กลุ่มอื่นไม่ถูกแตะ |
| **G2 audit `group.purge` ไม่มีชื่อ** | **PASS** | 📖 `maintenance.ts:36` meta = `GroupPurgeCounts` (ตัวเลข 7 ช่อง) actor `NULL` · whitelist `group.purge` มีแค่ 7 คีย์ตัวเลข · ✅ `:286` ตรวจ meta |
| **G2 ธุรกรรม / batch / idempotent** | **PASS (Low 1)** | 📖 ธุรกรรมแยกต่อกลุ่ม (`maintenance.ts:33`) · batch 25 + `remaining` · หลังงานเก็บกวาดเดิม (heartbeat/cleaned ไม่หายถ้า purge ล้ม) · ✅ `:329` รันซ้ำไม่ลบเพิ่ม · `:338` batch 25+3 · `:359` cleaned ยังทำงาน |
| **B2 ลบก่อน 30 วันไม่ได้** | **PASS (Info 5)** | 📖 `group-retention.ts:50-65` START = 2026-12-01 00:00 Asia/Bangkok ผ่าน `parseLocalDateTime` (กฎ 9) · `purgeDeletedAtCutoff` คืน null จนกว่า `S ≤ now−30d` · WHERE `deleted_at ≤ cutoff` → ไม่มีทางลบกลุ่มที่ `max(d,S)+30d > now` · ✅ `:414,429` ลบไปก่อน 100 วัน: ยังอยู่จนครบ START+30d · EDGE−1ms กู้ได้ EDGE ไม่ได้ |
| **G5 `group.restored` ไม่รั่วชื่อ SA / เฉพาะสมาชิก active / ไม่ส่ง LINE** | **PASS** | 📖 params = `{groupId, groupName, actorSystemAdmin:true}` ไม่มี id/ชื่อ SA (`services/admin-groups.ts:83`) · ผู้รับ = `listActiveMemberIds` (JOIN `u.status='active'`, `repos/admin-groups.ts:119-124`) ตัด SA เองออก · `LINE_KINDS` ไม่มี `group.restored` (`notify.ts:94`) · ข้อความ TH/EN ใช้ "ผู้ดูแลระบบ"/"A system admin" ไม่มีตัวแปรชื่อผู้กระทำ (`messages/*.json:793`) · ✅ `:164,202` ไม่มีชื่อ SA ไม่เข้า outbox · allowlist params (`tests/security/appointment-input-isolation.test.ts:239`) |
| **A1 `confirmUsername`** | **PASS** | 📖 `services/account.ts:36` zod `.strict()` `min(1).max(64)` · ลำดับ `deleteMe`: authorize → ADMIN_TRANSFER_REQUIRED (เดิม) → pepper → PIN_FORMAT → อ่านแถว → **เทียบชื่อ (`:94-96`)** → จองตัวนับ IP/username → verify PIN · ไม่ตรง = `VALIDATION {fields:{confirmUsername:'MISMATCH'}}` ไม่มีชื่อจริงใน error · `normalizeUsername` ตัวเดียวกับ login (`auth/services/login.ts:80`) เทียบกับ `username_normalized` ของ**ผู้เรียกเอง** → ไม่ใช่ช่อง enumeration · PIN ยังบังคับ (ชื่อถูกแต่ PIN ผิด = นับตามเดิม) · ✅ `tests/account/delete.test.ts:104` ไม่ส่ง → REQUIRED ไม่นับ · `:120` ผิด 10 ครั้งไม่ล็อก ไม่สะท้อนชื่อ · `:150` ยาวเกิน/คีย์แปลก → VALIDATION |
| **DTO `purgeAt`/`restorable`/`restoreBlockedReason` เฉพาะ SA** | **PASS** | 📖 `toAdminGroupDto`/`toAdminGroupDetailDto`/`groupRetentionDto` ถูกเรียกเฉพาะใน `services/admin-groups.ts` (หลัง `authorize('admin.group.list'/'view')`) · `grep` ไม่พบใน serializer/route อื่น |
| **ความลับ/PIN/hash ไม่ลง log** (กฎ 7) | **PASS** | ✅ `git diff 7ff7e45..HEAD \| grep '^+' \| grep -iE 'secret\|token\|password\|pepper\|console\.(log\|error)'` → พบแค่คำในเอกสาร (`CRON_SECRET` ชื่อ env ใน OPERATIONS) ไม่มีค่าจริง ไม่มี `console.*` ในโค้ดใหม่ |
| **migration** (กฎ 8) | **N/A** | ไม่มีไฟล์ใน `drizzle/` ใหม่ (R17 §8 G6) |

## ข้อพบ

### Low 1 — กลุ่มเดียวที่ purge ไม่ผ่าน ทำให้ purge ทั้งรอบหยุด และค้างทุกวัน
- ที่: `src/lib/data/services/maintenance.ts:32-41` — loop ไม่มี try/catch ต่อกลุ่ม · `inTx` แปลง SQLITE_BUSY เป็น `AppError('CONFLICT')` (`tx.ts`) แล้ว throw ออกจาก `runDailyMaintenance` · รายการเรียง `ORDER BY deleted_at, id` (`group-purge.ts:28`)
- สถานการณ์: (1) บน Turso คนละ instance — SA กดกู้คืนกลุ่ม X ตอน cron กำลังลบ X → ธุรกรรม purge แพ้ snapshot → CONFLICT → กลุ่มที่เหลือในชุดของวันนั้นไม่ถูกลบ และ cron ตอบ error (heartbeat/เก็บกวาดเสร็จไปแล้ว ไม่หาย) · หายเองวันถัดไป · (2) ถ้ามีเหตุที่ล้มซ้ำทุกครั้งกับกลุ่มแรกในลำดับ (เช่นแถวใดแถวหนึ่งใน `notification.params`/`notification_outbox.payload` เป็น JSON เสีย — `json_extract` ของ SQLite โยน `malformed JSON` และ DELETE สแกนทั้งตาราง `group-purge.ts:42-43`) → purge ไม่คืบหน้าเลยทุกวัน ข้อมูลกลุ่มที่ถึงกำหนดค้างเกิน 30 วันโดยไม่มีใครรู้ (นอกจากดู `purgedGroups.remaining`)
- โอกาสเกิด: ต่ำ — params/payload เขียนผ่าน drizzle JSON mode เสมอ ไม่พบทางเขียน JSON เสีย · ❓ ทำซ้ำข้าม process ในเครื่องไม่ได้
- ข้อเสนอ (ส่ง main มอบ platform/ops): จับ error ต่อกลุ่ม ข้ามไปกลุ่มถัดไปและนับ `failed` ใน `purgedGroups` · ops เพิ่มการเฝ้าดู `remaining`/`failed` ใน OPERATIONS

### Info 1 — กู้คืนข้ามเพดานที่นับเฉพาะกลุ่มที่ยังอยู่
- `GROUP_LIMITS.groupsCreatedPerUser` นับ `deleted_at IS NULL` (`repos/group.ts:84-88`) และ `pendingDirectInvitesPerInvitee` นับคำเชิญของกลุ่มที่ยังอยู่ → ผู้ใช้สร้างครบ 10 กลุ่ม ลบ 1 สร้างใหม่ 1 แล้ว SA กู้กลุ่มเดิม = 11 กลุ่ม · ทำได้เฉพาะ SA ไม่ใช่ช่องยกระดับสิทธิ์ · ยอมรับได้ ควรจดใน OPERATIONS

### Info 2 — โค้ดเชิญที่ยังไม่หมดอายุกลับมาใช้ได้หลังกู้คืน
- ตั้งใจตาม §1 G1 ("คำเชิญเดิมกลับมา") · โค้ดอายุ 7 วัน → มีผลเฉพาะกลุ่มที่ลบแล้วกู้ภายใน 7 วัน · ถ้ากลุ่มถูกลบเพราะโค้ดรั่ว admin กลุ่มต้องเพิกถอนเองหลังกู้ — แนะนำให้ ux/ops ใส่ในคำแนะนำของ SA ก่อนกดกู้

### Info 3 — purge ลบแถว outbox ที่ส่งแล้ว → ตัวนับ OA รายเดือนลดลงได้ (แทบไม่เกิด)
- `oaMonthCount` นับจาก `notification_outbox` (`repos/line.ts:18-20`) · LINE ไม่ส่งของกลุ่มที่ลบแล้ว (`repos/line.ts:254`, `repos/reminder.ts:38`) → แถวที่ส่งแล้วของกลุ่มที่ถูก purge มี `sent_at ≤ deleted_at ≤ now−30d` · ตกในเดือนปัจจุบันได้แค่เดือน 31 วันที่ลบวันที่ 1 แล้ว purge วันที่ 31 → เพดาน 300 คลาดได้ไม่กี่ข้อความ · ไม่ต้องแก้

### Info 4 — สแกนทั้งตารางต่อกลุ่ม ไม่มี index
- `json_extract` บน `notification`/`notification_outbox` = full scan × 2 ต่อกลุ่ม × ≤25 กลุ่ม/วัน · ADR 0015 ระบุไว้แล้วว่ายังไม่ได้วัด `EXPLAIN` · รับได้ที่ขนาดปัจจุบัน

### Info 5 — `GROUP_RETENTION_START_DATE` ผูกกับวันออกรุ่น
- เลื่อนช้ากว่าวันออกรุ่น = เก็บนานขึ้น (ปลอดภัย) · **ถ้าออกรุ่นหลัง 2026-12-01 ต้องเลื่อนค่าก่อน merge** (R17 §8) ไม่อย่างนั้นกลุ่มที่ลบก่อนออกรุ่นจะมีเวลาน้อยกว่า 30 วันหลังออกรุ่น (ขัด B2) — ให้ boss ตรวจตอน merge

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npx vitest run tests/rbac tests/admin tests/account tests/platform/r17-group-retention.test.ts` | ✅ 14/15 ไฟล์ · 2620 passed, 1 failed — `tests/admin/search.test.ts` "หน้าละ 30 · cursor…" **timeout 5000ms** (seed 64 ผู้ใช้ เครื่อง Windows ช้า) |
| `npx vitest run tests/admin/search.test.ts --testTimeout=30000` | ✅ 8/8 passed (24.6s) → ข้างบนเป็นเรื่องเวลาเครื่อง ไม่ใช่บั๊ก |
| `npx vitest run tests/security` | ✅ 9 ไฟล์ · 369 passed, 1 skipped (รอบนี้ config-hygiene ผ่านในเครื่อง) |
| `npx vitest run tests/ui/r17-restore-delete-model.test.ts tests/ui/notifications-model.test.ts tests/notifications tests/auth tests/line tests/groups/current-group.test.ts --testTimeout=30000` | ✅ 34 ไฟล์ · 505 passed |
| `npx tsc --noEmit -p .` | ✅ ไม่มี error |

## สิ่งที่ตรวจไม่ได้
- ❓ แข่ง restore × purge ข้าม process/instance บน Turso จริง (เทสต์ในเครื่องเป็น process เดียว ผ่านคิว `serialized`) — ตรวจจากเหตุผลของ snapshot isolation ของ SQLite/libsql
- ❓ e2e (`tests/e2e/r17-group-restore.spec.ts`, `account.spec.ts`) ไม่ได้รันบนเครื่อง Windows นี้ — ดูผลจาก CI
- ❓ ประสิทธิภาพ purge บนฐานจริง (Info 4)
