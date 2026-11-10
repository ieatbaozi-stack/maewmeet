# Security review — R14a (busy routine ฝั่งเซิร์ฟเวอร์ · migration 0005 · เพดาน/rate limit · FREE_TIME_MAX_ITEMS)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-11 · branch `feat/r14-busy-routine` HEAD `3805ce7` · ดู `git diff origin/main...HEAD` (17 commit, 57 ไฟล์) · เทียบ R14_CONTRACT §1.2, §1.3, R14-3, R14-5, R14-7, §8, §9 · ADR 0012 §5–§7 · ADR 0006 · ADR 0003 · กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่านโค้ดจริงทุกคำสั่ง SQL ของ routine · รันเทสต์ของทีม · เขียน probe ชั่วคราวใน `tests/_secprobe/` (รันแล้วลบ ไม่ commit) · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows (checkout CRLF) · เทสต์รันผ่าน shim นอก repo ที่กลืน `EPERM` ของ `fs.rmSync` · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 1 |
| Info | 5 |

**Verdict: ผ่านแบบมีข้อสังเกต**
- ไม่พบการรั่วของข้อมูล routine หรือ IDOR: ทุกคำสั่งผูก `user_id` ของผู้กระทำ · SA แก้ของคนอื่นไม่ได้ · ของคนอื่นตอบ 404 เหมือน id ที่ไม่มี · `routineId`/`weekdays`/`rangeKind`/note ไม่ออกทางอ่านฝั่งแชร์ทางไหนเลย · migration เพิ่มอย่างเดียว · ลบบัญชีแล้วข้อมูลหายครบ
- พบ 2 ข้อระดับ Medium เรื่องเพดานและต้นทุน:
  - **M1:** เลี่ยงเพดาน 10 ชุดได้ด้วยวงแยก + แก้ในที่ (ขัดเกณฑ์ R14-3)
  - **M2:** `FREE_TIME_MAX_ITEMS` ทำให้คำตอบ availability ส่งรายการ busy ให้ client ได้ถึง ~25,000 ชิ้น / 6.9 MB ขัด §9 B11 ที่บอกว่า "ไม่ส่งทุกชิ้นให้ client" และอาจเกินเพดาน response 4.5 MB ของ Vercel Functions
- ข้อเสนอ: ให้ผู้ทำแก้ M1 และ M2 ก่อน merge หรือให้ boss รับความเสี่ยงเป็นลายลักษณ์อักษร

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **R14-5 ownership ทุกคำสั่ง** | **PASS** | 📖 `repos/busy-routine.ts`: `findOwnRoutine:147`, `updateOwnRoutineGuarded:200`, `setOwnRoutineEndGuarded:214`, `deleteRoutineRowsFrom:239`, `deleteOwnRoutine:249-250`, `listRoutineSkips:179` (JOIN กฎ + `r.user_id`), `moveRoutineSkips:224-225` (กฎทั้งสองต้องเป็นของผู้ใช้), `deleteRoutineSkipsFrom:233` ผูก `user_id` ทุกตัว · `repos/busy.ts insertSkipForOwnBusyRow` JOIN `r.user_id = b.user_id` และ `b.user_id = ผู้กระทำ` · ✅ `tests/platform/r14-busy-routine.test.ts:465` b และ root (SA) PATCH/DELETE routine ของ a ทั้งแบบมีและไม่มี `from` และ PATCH/DELETE `/api/me/busy/:id` บนแถว routine ของ a ได้ 404 ทุกกรณี snapshot ของ 3 ตารางไม่เปลี่ยน (ไม่มี skip งอก) |
| **IDOR 404 แยกไม่ออกจากไม่มี** | **PASS** | 📖 PATCH: `findOwnRoutine` คืน null → `NOT_FOUND` ก่อน rate limit (`services/busy-routines.ts:303-304`) เหมือน id ที่ไม่มี · DELETE ไม่มี `from`: กิน slot แล้ว `deleteOwnRoutine` คืน null → 404 (`:370-371`) เหมือนกัน · DELETE มี `from`: 404 ก่อน slot ทั้งสองกรณี · id เป็น UUIDv4 |
| **RBAC `busy.routine.*`** | **PASS** | 📖 `rbac/can.ts:195-199` list/create = anyUser, update/delete = ownerOnly · `actions.ts` resource `none`/`busy` · ด่านสถานะบัญชีของ `can()` ทำงานก่อน (suspended → ACCOUNT_SUSPENDED/401, deleted → AUTH_REQUIRED) · ✅ `tests/rbac/busy-routine.test.ts`, `tests/security/authorize-first.test.ts` (ครอบคลุม route ใหม่), `tests/auth/must-change-pin.test.ts` (มีทั้ง 2 route ใหม่) ผ่าน · ✅ `r14-busy-routine.test.ts:484` บัญชีถูกระงับ = 401 |
| **zod strict / mass assignment** | **PASS** | 📖 `createRoutineInputSchema` / `updateRoutineInputSchema` `.strict()` (`services/busy-routines.ts:110,114-117`) ไม่มี `userId/id/routineId/createdAt` · `routineParamsSchema` = `z.uuid()` · GET query `.strict()` · DELETE query `.strict()` (route parse เอง ผิด → VALIDATION ไม่สะท้อนค่า) · ✅ `r14-busy-routine.test.ts:166` คีย์ `userId`/`routineId` → VALIDATION ไม่มีอะไรถูกเขียน |
| **ไม่รั่วถึงคนอื่น (calendar / availability / check / preview)** | **PASS** | 📖 `sharedBusyInGroupQuery` (`repos/busy.ts:262-278`) เลือกคอลัมน์ทีละตัว ไม่มี `routine_id` / `note` · title ซ่อนตัดใน SQL (`CASE hide_detail`) · `BUSY_SHARED_FIELDS` ไม่เปลี่ยน · `busy_routine` / `busy_routine_skip` ถูกอ่านเฉพาะใน `repos/busy-routine.ts`, `account.ts`, `maintenance.ts`, `repos/busy.ts insertSkipForOwnBusyRow` (เจ้าของ) · `mergeBusyForFreeTime` ใช้แค่ป้อน `commonFreeTime` · id `m:<userId>:n` ไม่ออกใน DTO (`availability.ts:170-191` ใช้ `segments/freeMembers/freeMemberIds` + blockers ที่สร้างจากแถวจริง) · ✅ canary `r14-busy-routine.test.ts:500` ปฏิทิน / วันว่าง / check ของ b ไม่มี `routineId, routine_id, weekdays, rangeKind, range_kind, note, seriesId`, note canary, title ที่ซ่อน, id ของกฎ · `.toSQL()` ฝั่งแชร์ไม่มี `routine_id` (`:532`) |
| **ทางอื่น (แจ้งเตือน/LINE, .ics, admin, export)** | **PASS** | 📖 service routine ไม่สร้าง notification/outbox · `.ics` เป็นของนัดเท่านั้น · `admin-groups` ไม่อ่าน busy (คอมเมนต์และโค้ด) · ไม่มี endpoint export busy · `GET /api/me/busy?from&to` คืน `routineId` ให้เจ้าของเท่านั้น (`WHERE user_id = me`) |
| **hide_detail** | **PASS** | 📖 `hide_detail` คัดลอกลงทุกแถว (`insertRoutineRowsIfUnderCap:120`) แล้วใช้ทางอ่านเดิม · ✅ canary: routine ซ่อน → ไม่มี key `title` |
| **เพดาน 10 ชุด** | **FAIL → M1** | ✅ probe: เลี่ยงได้ด้วยวงแยก + แก้ในที่ (รายละเอียดใน M1) |
| **เพดาน 1,500 แถว / 300 เดี่ยว / ยิงพร้อมกัน** | **PASS** | 📖 เพดานอยู่ในคำสั่ง `INSERT … SELECT … WHERE` เดียว (`busy-routine.ts:122`) · `windowCount` นับเฉพาะ `routine_id IS NULL` · PATCH ที่แยกวันเดียวต้องมีที่ว่างใน 300 (`repos/busy.ts:187`) · skip ถูก rollback เมื่อ UPDATE ล้ม (`services/busy.ts` throw ใน `inTx`) · ✅ `tests/busy/r14-caps-concurrency.test.ts` (6 POST พร้อมกันที่ 1,496 แถว → สำเร็จพอดี 2 · PATCH แยกวันพร้อมกันที่ 299 → พอดี 1) และ `r14-busy-routine.test.ts:231-315` ผ่าน |
| **rate limit `busy:routine`** | **PASS** | 📖 20/10 นาที ต่อผู้ใช้ ครอบ POST/PATCH/DELETE (`limits.ts` `BUSY_ROUTINE_RATE_LIMIT`) · ตรวจอินพุตก่อนกิน slot · ✅ `r14-busy-routine.test.ts:316` ครั้งที่ 21 = 429 + Retry-After แยกต่อผู้ใช้ |
| **บัญชี active ในคำสั่งเขียน** | **PASS (Low 1)** | 📖 `insertRoutineIfUnderCap`, `insertRoutineRowsIfUnderCap`, `updateOwnRoutineGuarded` มี `userActive` · `setOwnRoutineEndGuarded` และ `deleteOwnRoutine` ไม่มี (ดู L1) |
| **R14-7 ลบบัญชี / cron** | **PASS** | 📖 `account.ts:127-128` ลบ `busy_block` (รวมแถว routine) และ `busy_routine` ใน tx เดียวกับการ anonymize · skip ตาม FK cascade (`foreign_keys` เปิด — `tests/platform/schema.test.ts`) · cron `oldBusyRoutines` ลบกฎที่จบก่อน วันนี้ − 93 วัน (กฎ 9 ใช้ `todayIn`/`addDays`) · ✅ `r14-busy-routine.test.ts:557,567` และ `tests/platform/cron.test.ts` ผ่าน |
| **OPERATIONS SQL ลบด้วยมือ** | **PASS (Info 5)** | 📖 เพิ่มลบ `busy_routine_skip` แล้ว `busy_routine` มีด่าน `status = 'deleted'` เหมือนบรรทัดอื่น · ✅ เทสต์ของทีมล้ม 4/4 ในเครื่องนี้เพราะ CRLF (regex ` ```sql\n`) · copy เทสต์ที่ตัด `\r` ก่อน → ผ่าน 4/4 รวมกรณี routine ของ bob หาย ของ alice อยู่ |
| **migration 0005** (กฎ 8) | **PASS** | 📖 `CREATE TABLE` ×2, `CREATE INDEX` ×2, `ALTER TABLE busy_block ADD routine_id text` ไม่ rebuild ไม่แตะข้อมูลเดิม · CHECK ครบตาม ADR · FK `busy_routine.user_id` / `busy_routine_skip.routine_id` ON DELETE CASCADE · ✅ `tests/platform/migration-0005.test.ts` ผ่าน |
| **ความลับ / log** (กฎ 7) | **PASS** | ✅ grep `console.` / `logger.` ในไฟล์ routine ไม่พบ · error ของ routine มีแค่ `field`/`limit`/`max` ไม่มีค่าที่ผู้ใช้ส่ง · ไม่มี env ใหม่ |
| **ต้นทุน FREE_TIME_MAX_ITEMS (DoS)** | **ข้อสังเกต → M2** | ✅ perf จริง (ดูด้านล่าง) |

## Findings

### Medium

**M1. เพดาน "routine ที่ยังไม่จบ ≤ 10 ต่อคน" ถูกเลี่ยงได้โดยไม่จำกัดจำนวน ด้วยวงแยก (B12) + แก้ในที่** — R14-3 / §1.2
- ต้นเหตุ:
  - `src/lib/data/services/busy-routines.ts:337` การแยกใช้ `cap: null` (B12)
  - `src/lib/data/repos/busy-routine.ts:201` การแก้ในที่ไม่ตรวจเพดาน 10 เมื่อ `end_date` เดิม ≥ วันนี้ แม้จะยืดวันจบออกไปใหม่
  - `services/busy-routines.ts:312` การแก้ในที่ยอมรับชุดที่ได้ 0 วัน (`requireOccurrence: false`)
- ขั้นตอนทำซ้ำ (✅ probe ชั่วคราว `tests/_secprobe/split-loop.test.ts`, now = 2026-11-11):
  1. สร้าง 10 ชุด `weeks 2026-11-16..2026-11-30, weekdays [1]` → เต็ม 10
  2. PATCH ชุด R0 `{…, from: '2026-11-23'}` → แยก: R0 จบ 22 พ.ย. (ยังไม่จบ) + ชุดใหม่ N (ไม่นับเพดาน)
  3. PATCH ชุด N แก้ในที่เป็น `fromWeek/toWeek 2026-11-09` (จันทร์ 9 พ.ย. ผ่านแล้ว) → 0 แถว แต่ `end_date` 15 พ.ย. ≥ วันนี้ = ยังนับว่า "ไม่จบ"
  4. PATCH R0 แก้ในที่กลับเป็น `2026-11-16..2026-11-30` → ผ่าน เพราะ `end_date` เดิม ≥ วันนี้ จึงไม่ตรวจเพดาน
  5. ทำข้อ 2–4 ซ้ำ
- ผลจริง: 55 คำขอ (เลื่อนนาฬิกาข้าม rate limit ทุก 20 คำขอ) → `{"active":25,"zeroRow":15,"rows":30}` · POST สร้างใหม่ยังได้ 409 `routines` (หน้าตาเหมือนเพดานทำงาน แต่จริงมี 25 ชุด)
- ผลกระทบ:
  - (ก) เพดาน 10 ใช้ไม่ได้จริง: แต่ละชิ้นเป็นกฎอิสระที่แก้ในที่เป็นอะไรก็ได้ภายหลัง
  - (ข) `busy_routine` โตได้ตาม rate limit เท่านั้น (~6 ชิ้น/10 นาที ≈ 900 แถว/วัน/ผู้ใช้ แถวละ note ได้ถึง 500 ตัว) · cron ลบเมื่อจบเกิน 93 วัน
  - (ค) ชุดที่เกิน `BUSY_ROUTINE_LIST_MAX` 50 ไม่ขึ้นในรายการของเจ้าของ (`truncated`) แต่ยังมีผลกับวันว่าง
  - (ง) คนเดียวอัดแถว routine ใน 62 วันได้เต็ม 1,500 (เดิมสูงสุด 10 ชุด × 62 = 620) ซึ่งเพิ่มน้ำหนักให้ M2
  - เพดาน 1,500 แถวยังคุมต้นทุนคำนวณอยู่ ไม่มีข้อมูลรั่ว
- ข้อเสนอให้ผู้ทำเลือก:
  - (1) ใน `updateOwnRoutineGuarded` ตรวจเพดาน 10 เมื่อการแก้ในที่ "ยืด `end_date` ออกไป" แล้วชุดอื่นที่ยังไม่จบมี ≥ 10 ชุด
  - (2) ให้ชิ้นจากการแยกนับเพดาน แต่ยกเว้นได้แค่ครั้งเดียวต่อ lineage
  - (3) เพดานแข็งรวม เช่น ≤ 2×10 หรือ ≤ `BUSY_ROUTINE_LIST_MAX` ใน `insertRoutineIfUnderCap` ตอน `cap: null`
  - ทางไหนก็ต้องมีเทสต์วงข้างบน · ถ้าเปลี่ยนความหมาย B12 → main ถาม boss

**M2. `FREE_TIME_MAX_ITEMS` 32,000 ทำให้ GET availability ส่งรายการ busy ให้ client ได้ ~25,000 ชิ้น / 6.9 MB ต่อคำขอ** — §9 B11, DoS / ความพร้อมใช้งาน
- ต้นเหตุ:
  - `src/lib/data/services/availability.ts:119` โหลดถึง 32,000 แถว (busy) + 32,000 (going)
  - `:162-169, :190` ส่ง `busy[]` = ทุกแถวที่ทับหน้าต่างวัน กลับไปใน DTO
  - B11 เขียนว่าเพดานใหม่ใช้ "ทางคำนวณ ไม่ส่งทุกชิ้นให้ client" และปฏิทินที่ส่งรายการคงไว้ 5,000 แต่ availability ส่งรายการด้วย จึงไม่ได้ถูกจำกัดที่ 5,000 อีกต่อไป
- ผลจริง: ✅ `R14_PERF_HEAVY=1 npx vitest run tests/perf/r14-routine-big-group.test.ts` (50 คน × 10 ชุดทุกวัน)

  | route | วัน | แถวใน DB | ชิ้นที่ส่ง | bytes | wall (median) |
  |---|---|---|---|---|---|
  | GET calendar | 42 | 21,000 | 5,000 (truncated) | 1,320,453 | 99 ms |
  | GET availability | 42 | 21,500 | **16,800** | **4,652,047** | 439 ms |
  | GET availability | 62 | 31,500 | **24,800** | **6,869,967** | 837 ms |
  | POST appointments/check | 1 | 1,500 | 50 | 18,991 | 32 ms |

  ก่อน R14 availability ถูกจำกัดที่ 5,000 ชิ้น (≈ 1.3–1.8 MB ตามกรณี A/B ในรอบนี้)
- ผลกระทบ:
  - (ก) Vercel Functions มีเพดาน response body 4.5 MB → กลุ่มที่หนักแบบกรณี C น่าจะได้ error แทนวันว่าง ทั้ง 42 และ 62 วัน · **ยังไม่ได้ยืนยันบน Vercel จริง** · ข้อนี้คือความพร้อมใช้งานของฟีเจอร์หลักพังทั้งกลุ่ม
  - (ข) GET availability ไม่มี rate limit: สมาชิกคนใดก็ดึงซ้ำได้ ครั้งละหลาย MB และ ~0.8 s CPU/DB
  - (ค) ใช้คนน้อยลงถ้าใช้ M1: ราว 11–18 คนที่อัดแถวเต็ม (1,800 แถว/คนใน 62 วัน) ก็ทำให้ response ของทั้งกลุ่มเกิน 4.5 MB ได้ · แต่ละคนต้องเป็นสมาชิกกลุ่ม (เชิญเข้า) ไม่ใช่คนนอก
- ข้อเสนอ:
  - (1) จำกัดจำนวน `busy[]` ที่ส่งใน availability ไว้ที่ `CALENDAR_MAX_ITEMS` (คำนวณจาก 32,000 ได้ แต่ส่งรายการไม่เกิน 5,000 + ธง `itemsTruncated`) หรือส่งชิ้นที่รวมแล้วต่อสมาชิกแทนแถวจริง
  - (2) หรือวัด response บน preview Vercel ก่อน merge แล้วให้ boss ตัดสิน
  - (3) พิจารณา rate limit อ่าน availability ต่อผู้ใช้

### Low

**L1. `setOwnRoutineEndGuarded` และ `deleteOwnRoutine` ไม่ตรวจบัญชี active ในคำสั่ง** (`src/lib/data/repos/busy-routine.ts:212-215`, `:248-251`)
- ต่างจากคำสั่งเขียนอื่นของ routine และจาก ADR 0012 §6 ที่เขียนว่า "ตรวจบัญชี active ในคำสั่งเดียวกับการเขียน"
- ผลกระทบต่ำ:
  - ด่าน `can()` ตัดบัญชีที่ถูกระงับหรือลบก่อนถึง SQL
  - ช่องเหลือแค่ race: ถูกระงับระหว่างคำขอ "หยุดตั้งแต่…" หรือ "ลบทั้งหมด" ที่กำลังวิ่ง ซึ่งแตะได้แค่ข้อมูลตัวเอง
  - ทางแยกชุดถูกจับต่อด้วย `insertRoutineIfUnderCap` (`userActive`) → CONFLICT rollback
- ข้อเสนอ: เพิ่ม `userActive` ให้ตรง ADR หรือแก้ ADR ให้ตรงโค้ด (แบบเดียวกับ `deleteOwnBusy` เดิมที่ไม่ตรวจ)

### Info
1. **PATCH `/api/me/busy-routines/:id` ที่ 404 ไม่กิน rate limit** (`services/busy-routines.ts:303-315`): `findOwnRoutine` ทำก่อน `takeUserSlot` จึงเดา id ได้ไม่จำกัดด้วยถัง `busy:routine` · คำตอบเหมือนกันทั้ง "ของคนอื่น" และ "ไม่มี" และ id เป็น UUIDv4 จึงไม่ใช่ช่องโหว่ · บันทึกไว้เผื่ออยากให้สม่ำเสมอกับ DELETE
2. **PATCH ส่ง `tz` ใหม่ได้ → "วันนี้" ขยับ ±1 วัน** (`services/busy-routines.ts:305-307, :326`) · `deleteRoutineRowsFrom(fromDate: plan.today)` คิดจาก tz ใหม่ เช่น `Etc/GMT+12` อาจลบแถวของเมื่อวานของตัวเองได้ · กระทบแค่ข้อมูลตัวเอง แต่ขัด "วันในอดีตไม่ถูกแตะ" (R14-4) เล็กน้อย · ส่งต่อ qa · R14a ไม่มี UI เลือก tz
3. **ข้อจำกัดที่ยอมรับแล้ว (ADR 0012 §7 / ADR 0010 §6 ข้อ 4):** คนในกลุ่มเดารูปแบบ routine จากเวลาที่ซ้ำได้ ("ไม่ว่าง 9–18 ทุก จ.–ศ.") เท่ากับลงทีละวัน ไม่ใช่การรั่วใหม่
4. **`busy_block.routine_id` ไม่มี FK** (ADR 0012 §5 ตัดสินแล้ว) · ตรวจแล้วทุกทางลบกฎ (`deleteOwnRoutine`, `account.ts`, cron +3 วัน, SQL ด้วยมือ) ลบหรือปล่อยให้แถวหมดอายุก่อน ไม่พบแถวกำพร้าที่ทำให้สิทธิ์ผิด · แถวกำพร้า (ถ้ามี) เป็น busy ธรรมดาของเจ้าของ และ `insertSkipForOwnBusyRow` JOIN กฎ จึงไม่ insert skip ลอย
5. **`tests/ops/manual-delete-sql.test.ts` ล้ม 4/4 บนเครื่อง Windows** เพราะ OPERATIONS.md เป็น CRLF และ regex ใช้ `\n` (ปัญหาเครื่อง ไม่ใช่โค้ด) · copy ที่ตัด `\r` ผ่าน 4/4 · ผลจริงดูจาก CI

## คำสั่งที่รัน + ผลจริง
ทุกคำสั่งรันใน worktree ด้วย `NODE_OPTIONS="--import file:///…/scratchpad/ignore-eperm.mjs"`

1. ```
   npx vitest run tests/rbac/busy-routine.test.ts tests/platform/r14-busy-routine.test.ts tests/busy/r14-caps-concurrency.test.ts tests/platform/migration-0005.test.ts tests/calendar/free-time-merge.test.ts tests/calendar/routine.test.ts tests/busy/calendar-visibility.test.ts tests/security/authorize-first.test.ts tests/auth/must-change-pin.test.ts tests/ops/manual-delete-sql.test.ts tests/platform/cron.test.ts tests/rbac/busy-calendar.test.ts tests/rbac/busy-series.test.ts tests/busy/busy-api.test.ts tests/availability/availability-api.test.ts tests/platform/schema.test.ts
   ```
   → `Test Files 1 failed | 15 passed (16)` · `Tests 4 failed | 729 passed (733)` · ที่ล้ม 4 ตัวคือ `manual-delete-sql` ทั้งหมด (`expected '' to match /^BEGIN;/` เพราะ CRLF — Info 5)
2. probe `tests/_secprobe/manual-delete-lf.test.ts` (copy เทสต์ข้างบน แต่ตัด `\r` จาก OPERATIONS.md) → 4/4 passed
3. probe `tests/_secprobe/split-loop.test.ts` (M1) → passed · log `{"requests":55,"active":25,"zeroRow":15,"rows":30}` · `create after loop 409 {"error":{"code":"LIMIT_REACHED","params":{"limit":"routines","max":10}}}`
4. `R14_PERF_OUT=… npx vitest run tests/perf/r14-routine-big-group.test.ts` → `Tests 2 passed | 1 skipped` · กรณี B availability 62 วัน: 7,000 แถว, ส่ง 5,500 ชิ้น, 1,804,081 bytes, 145 ms
5. `R14_PERF_HEAVY=1 R14_PERF_OUT=… npx vitest run tests/perf/r14-routine-big-group.test.ts -t "C "` → `Tests 1 passed | 2 skipped` · ตัวเลขตามตาราง M2
6. ลบ `tests/_secprobe/` แล้ว `git status --short` → ว่าง (ไม่มีไฟล์ค้าง)

## สิ่งที่ตรวจไม่ได้
- เพดาน response 4.5 MB บน Vercel จริง (M2 ก) และเวลาบน Turso remote: ตัวเลขข้างบนเป็น libSQL ในเครื่อง
- การรัน migration 0005 บนฐาน preview/prod จริง: boss รันก่อน merge ตาม OPERATIONS
- `npm test` ทั้งชุด, lint, typecheck, build, e2e: ไม่ได้รันในรอบนี้ (เครื่อง Windows มี EPERM/timeout เดิม) ผลจริงดูจาก CI และรายงาน qa
- การแข่งกันข้าม process บน Turso: ตรวจจากการอ่านโค้ดเท่านั้น (เพดานอยู่ในคำสั่งเขียนเดียว + guard `updated_at`)
