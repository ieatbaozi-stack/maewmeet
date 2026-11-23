# ADR 0017 — นำเข้าไฟล์ `.ics` เป็นเวลาไม่ว่างของฉัน (`busy_block`)

- **Status**: Accepted (2026-11-23) · boss อนุมัติใน [ICS_IMPORT_CONTRACT.md](../contracts/ICS_IMPORT_CONTRACT.md) §6 (2026-11-23): B1 ข้าม `RRULE` พร้อมสรุปจำนวนและแนะนำแบบประจำ · B2 ดีฟอลต์ 90 วันข้างหน้า (เลือก 30/60/90/180 วัน) · B3 ดีฟอลต์ซ่อนรายละเอียด (`hideDetail = true`) · B4 ไม่มี migration (เทียบเวลาตรงกันเป๊ะ) · บันทึกโดย Architect 2026-11-23 ก่อนเริ่มงาน `platform` · ข้อที่ไม่อยู่ในคำตัดสิน B1–B4 และ Architect ตัดสินติดป้าย **[A]**
- **เกี่ยวข้อง**: [ADR 0003](0003-rbac.md) (RBAC `busy.create`) · [ADR 0004](0004-time-and-timezone.md) (เวลา/เขตเวลา/`STEP_MINUTES = 30`) · [ADR 0006](0006-busy-visibility.md) (การมองเห็น `busy_block` และ `hide_detail`) · [ADR 0010](0010-daily-busy-series.md) (batch insert คำสั่ง SQL เดียวมีเงื่อนไขเพดาน 300 ในตัว) · [ADR 0012](0012-busy-routines.md) (busy routine — แยกจาก `busy_block` เดี่ยว) · `docs/design/ARCHITECTURE.md` ข้อ 5 (อัปเดตเมื่อปิดรอบ)
- **เจ้าของการ implement**: `platform` (parser `src/lib/calendar/ics-import.ts`, service/repo/routes, route `maxBodyBytes`, `tests/calendar/ics-import.test.ts`) · `auth` (ถัง rate limit `BUSY_IMPORT_RATE_LIMITS` ใน `src/lib/auth/throttle.ts`) · `ux` (`docs/design/ICS_IMPORT.md`, เนื้อหา `messages/*.json`) · `frontend` (`IcsImportSheet`, ปุ่มในปฏิทินแท็บ "ของฉัน", `/privacy`) · `test` (integration + E2E) · `ops` + `secretary` (DOCS_SYNC) · ตรวจอิสระโดย `qa` + Claude Code `security` agent (บังคับ)

## Context
- ผู้ใช้ต้องการนำตารางจาก Google Calendar / Apple Calendar / Outlook เข้ามาเป็นเวลาไม่ว่างใน maewmeet โดยไม่ต้องกรอกทีละรายการ
- โครงสร้างเดิมของ maewmeet มี `busy_block` ที่ผูกกับผู้ใช้ (`user_id`, ไม่ผูกกลุ่ม — D5), บังคับเวลาแบบ `timed` ลงตัว 30 นาที (`STEP_MINUTES = 30`), เพดาน `BUSY_MAX_PER_USER = 300` แถวที่ active (`routine_id IS NULL`), และแยกทางอ่านเจ้าของ (`OwnBusyRow`) กับฝั่งกลุ่ม (`SharedBusyRow`, ตัด `title` ใน SQL เมื่อ `hide_detail = 1`)
- รอบนี้ **ไม่มี migration** (B4) และ **ไม่รับ URL ภายนอก** (`webcal://` / `https://`) เพื่อปิดความเสี่ยง SSRF และไม่เพิ่ม cron sync ภายนอก

## Decision

### 1. สถาปัตยกรรมและการแบ่งจุดประมวลผล (Server Preview + Server Confirm)
1. **Pure ICS Parser (`src/lib/calendar/ics-import.ts`)**:
   - เป็น pure module ใน `src/lib/calendar/` ใช้เฉพาะ `temporal-polyfill` และฟังก์ชันใน `src/lib/calendar/` เท่านั้น **ไม่ import จาก `@/lib/shared/*` หรือ DB/env/clock** — รับ `nowMs`, `defaultTz`, `windowDays` และลิมิตผ่าน options
   - Linear O(n) single-pass scanner ไม่มี backtracking regex เพื่อป้องกัน ReDoS
2. **ทำไม Preview รันที่เซิร์ฟเวอร์ (`POST /api/me/busy/import/preview`) [A]**:
   - เซิร์ฟเวอร์เป็นแหล่งความจริงเดียวในการตรวจซ้ำกับ `busy_block` ที่มีอยู่ในฐานข้อมูลของผู้ใช้ (A4), คำนวณโควตาคงเหลือของ `BUSY_MAX_PER_USER = 300`, และรับรองว่ากติกา parse/sanitize เดียวกันทุกจุด
   - ฝั่ง client ตรวจเบื้องต้นก่อนส่ง (ขนาดไฟล์ ≤ 512 KB, ไฟล์ไม่ว่าง) เพื่อตอบสนองทันที แต่เซิร์ฟเวอร์ตรวจซ้ำทุกข้อ
3. **การส่งข้อมูลเป็น JSON ผ่าน `route()` wrapper เดิม [A]**:
   - ส่งเนื้อหาไฟล์ `.ics` (ข้อความ UTF-8) ใน JSON body `{ icsText, windowDays }` แทน `multipart/form-data` เพื่อให้ผ่านด่าน CSRF เดิม (`Origin` + `Content-Type: application/json`) ใน `src/app/api/_lib/route.ts` ได้ครบถ้วนโดยไม่ต้องสร้างข้อยกเว้น CSRF
   - ขยาย `RouteSpec` ให้รับ `maxBodyBytes?: number` (ดีฟอลต์คงเดิม `MAX_BODY_BYTES = 64 * 1024`) · `POST /api/me/busy/import/preview` กำหนด `maxBodyBytes: 768 * 1024` (เผื่อ JSON escape overhead ของไฟล์ `.ics` ขนาด 512 KB) แล้วตรวจขนาด UTF-8 byte จริงของ `icsText` ≤ `512 * 1024` ไบต์ก่อน parse
   - `POST /api/me/busy/import` คงเพดาน `64 * 1024` ไบต์เดิม (≤ 100 รายการที่ normalize แล้ว)

### 2. รูปแบบ Parser และนโยบายเวลา / TZID
1. **การป้องกันอินพุตก่อน Parse**:
   - ขนาด UTF-8 > **512 KB** (`524,288` ไบต์) → ตอบ `413 ICS_TOO_LARGE`
   - ปฏิเสธ null byte (`\u0000`) และ binary control bytes (`0x01–0x08`, `0x0B`, `0x0C`, `0x0E–0x1F`) · ตัด UTF-8 BOM (`\uFEFF`) นำหน้าได้
   - ต้องมีกรอบ `BEGIN:VCALENDAR` … `END:VCALENDAR` (ไม่มี → `400 ICS_INVALID`)
   - เพดาน **20,000 บรรทัดดิบ** (`ICS_IMPORT_MAX_LINES`) และ **500 `VEVENT`** (`ICS_IMPORT_MAX_EVENTS`) ต่อไฟล์ — เกิน → `413 ICS_TOO_LARGE` ทันทีระหว่างสแกน (ไม่สะสมหน่วยความจำต่อ)
2. **RFC 5545 Unfolding และ Structure**:
   - Unfold บรรทัดต่อที่ขึ้นต้นด้วย `' '` (0x20) หรือ `'\t'` (0x09) หลัง `\r\n`, `\n`, หรือ `\r`
   - สนใจเฉพาะ `VEVENT` ชั้นบนสุดใต้ `VCALENDAR` · ข้ามคอมโพเนนต์ย่อย (`VALARM`, `VTIMEZONE`, `VTODO`, `VJOURNAL`, `VFREEBUSY`) เพื่อไม่ให้ `SUMMARY`/`DURATION` ของ `VALARM` ปนเข้า `VEVENT`
   - อ่านเฉพาะ 7 property: `SUMMARY`, `DTSTART`, `DTEND`, `DURATION`, `TRANSP`, `STATUS`, `RRULE` · **ละทิ้งทันที** ซึ่ง `DESCRIPTION`, `LOCATION`, `ATTENDEE`, `ORGANIZER`, `URL`, `UID` และ property อื่นทั้งหมด (ความเป็นส่วนตัวโดยโครงสร้าง)
   - Unescape ค่า TEXT ของ `SUMMARY` แบบ single-pass: `\\` → `\`, `\,` → `,`, `\;` → `;`, `\n`/`\N` → ช่องว่าง
3. **4 รูปแบบเวลาและนโยบาย TZID [A]**:
   - `(1) VALUE=DATE (YYYYMMDD)`: แปลงเป็น `all_day` · `DTEND` เป็น exclusive ตาม RFC 5545 จึงลบ 1 วันเป็น `localEndDate` แบบ inclusive · ถ้าไม่มี `DTEND` ใช้ `DURATION` (วัน/สัปดาห์ ≥ 1 วัน) · ถ้าไม่มีทั้งคู่ถือเป็น 1 วัน · ถ้า `endDate < startDate` → ข้าม (`invalid`)
   - `(2) UTC (YYYYMMDDTHHMMSSZ)`: แปลงเป็น instant UTC แล้วฉายเป็นเวลาท้องถิ่นใน `defaultTz` (`Asia/Bangkok`)
   - `(3) TZID=<name>:YYYYMMDDTHHMMSS`: ตัดเครื่องหมายคำพูดครอบและ `/` นำหน้า (ถ้าเหลือชื่อ IANA ที่ถูก) · ตรวจผ่าน `isValidTimeZone` · รองรับตารางแมปคงที่สำหรับชื่อเขตเวลา Windows ยอดนิยมจาก Outlook (เช่น `SE Asia Standard Time` → `Asia/Bangkok`, `Singapore Standard Time` → `Asia/Singapore`, `Tokyo Standard Time` → `Asia/Tokyo`, `UTC` → `UTC`, `Pacific/Eastern/Central/Mountain Standard Time`, `GMT/W. Europe/Central European/China/Korea/India/AUS Eastern Standard Time` รวม ~30 รายการตาม CLDR) · ถ้าไม่รู้จักทั้ง IANA และตาราง Windows → **ข้าม (`invalid`)** ไม่เดาเขตเวลาเอง
   - `(4) Floating time (YYYYMMDDTHHMMSS ไม่มี Z/TZID)`: ตีความเป็น `defaultTz` (`Asia/Bangkok`) ด้วย `disambiguation: 'compatible'`
   - `DURATION` สำหรับ `timed`: รองรับ RFC 5545 `P[nW][nD][T[nH][nM][nS]]` (บวกเท่านั้น) เมื่อไม่มี `DTEND` · ไม่มีทั้ง `DTEND` และ `DURATION` หรือ `end <= start` → ข้าม (`invalid`)
4. **การปัดเวลาลงตัว 30 นาที (`STEP_MINUTES = 30`)**:
   - ปัดแบบกันพลาด (outward rounding) บน `Temporal.ZonedDateTime` ใน `defaultTz`:
     - `start` ปัด **ลง** (floor) เป็น `:00` หรือ `:30`
     - `end` ปัด **ขึ้น** (ceil) เป็น `:00` หรือ `:30` (รองรับข้ามเที่ยงคืน เช่น `23:45–00:15` → `23:30–00:30` และ `23:30–23:45` → `23:30–00:00` วันถัดไป)
   - ทุกผลลัพธ์ผ่าน `normalizeBusyInput` ก่อนส่งออก เพื่อยืนยันกติกาเดียวกับ busy ปกติ 100%
   - แนบธง `rounded: boolean` ให้ UI แจ้งเตือนเมื่อมีการปัดเวลา
5. **ลำดับการกรองและตัวนับเหตุผลที่ข้าม (`skipped`) [A]**:
   - ลำดับตรวจต่อ 1 `VEVENT`: `cancelled` (`STATUS:CANCELLED`) → `transparent` (`TRANSP:TRANSPARENT`) → `rrule` (มี `RRULE`) → `invalid` (วันเวลา/TZID ผิด, 0 นาที, ปีนอก 2000–2100) → `past` (จบก่อน `วันนี้ − 7 วัน`) → `tooFarAhead` (เริ่มหลัง `วันนี้ + windowDays`, `windowDays ∈ {30, 60, 90, 180}`, ดีฟอลต์ 90) → `tooLong` (เกิน `BUSY_MAX_TIMED_DAYS = 62` หรือ `BUSY_MAX_SPAN_DAYS = 366`)
6. **ชื่อรายการ (`SUMMARY`)**:
   - `NFC` → ลบอักขระควบคุม/จัดรูป/bidi/zero-width/private-use (กติกาเดียวกับ `sanitizeDisplayText`) → ตัดไม่เกิน `BUSY_TITLE_MAX = 80` code point (ไม่ผ่า surrogate pair) → ตรวจซ้ำด้วย `parseBusyTitle` ฝั่ง service (ว่างหรือไม่เหลือตัวที่มองเห็น → `title: null`) · `note` เป็น `null` เสมอ

### 3. API, การกันซ้ำ (B4), การเขียนแบบ Atomic และ RBAC
1. **Endpoints & Manifest**:
   - `POST /api/me/busy/import/preview` — `auth: 'actor'`, `action: 'busy.create'`, `owner: 'platform'`
     - Request: `{ icsText: string, windowDays?: 30 | 60 | 90 | 180 }` (`.strict()`)
     - Response `{ data }`: `{ windowDays, items: IcsPreviewItem[], skipped: IcsSkippedCounts, totalEvents, quota: { used, max: 300, remaining }, maxImportPerBatch: 100 }`
     - แต่ละ `IcsPreviewItem`: `{ kind: 'all_day' | 'timed', startDate, endDate, startTime?, endTime?, tz, title: string | null, rounded: boolean, duplicate: boolean }`
   - `POST /api/me/busy/import` — `auth: 'actor'`, `action: 'busy.create'`, `owner: 'platform'`
     - Request: `{ items: ImportBusyItem[] (1..100), hideDetail?: boolean (default true), skipDuplicates?: boolean (default true) }` (`.strict()`)
     - Response `201 { data }`: `{ created: number, skippedDuplicates: number, items: BusyOwnView[] }`
   - ทั้งสอง service เรียก `authorize(actor, 'busy.create', { type: 'none' })` **บรรทัดแรก** — บล็อก anonymous (401), suspended (401), `must_change_pin` (403) · ผูก `user_id = asUser(actor).id` เสมอ (SA นำเข้าแทนคนอื่นไม่ได้)
   - ใช้ action `busy.create` เดิม สอดคล้องกับ `tests/security/authorize-first.test.ts` ส่วน C (`POST /api/me/busy*` → `busy.create`)
2. **สูตรกันซ้ำ (B4 = (ก) · ไม่มี migration)**:
   - คีย์เทียบซ้ำ: `(allDay, startAt, endAt, localStartDate, localEndDate)` ของแถว `busy_block` ที่ `user_id = me.id`
   - ในหน้า **Preview**: โหลด `busy_block` ของเจ้าตัวในช่วง `[minLocalStartDate, maxLocalEndDate]` แล้วติดธง `duplicate: true` ทั้งรายการที่ชนแถวเดิมใน DB และรายการที่ซ้ำกันเองภายในไฟล์ (ตัวแรกไม่ซ้ำ ตัวถัดไปซ้ำ) — หน้า UI จะ **ไม่ติ๊กเลือก** รายการซ้ำโดยค่าเริ่มต้น
   - ในขั้น **Confirm**:
     - ทุก item ผ่าน `normalizeBusyInput` + `parseBusyTitle` ใหม่ทั้งหมดฝั่งเซิร์ฟเวอร์ (ไม่ไว้ใจค่าจาก client)
     - บันทึกด้วยคำสั่ง SQL เดียวแบบ atomic ภายใต้ `inTx` (เป็นคำสั่งแรกของธุรกรรมเพื่อให้ได้ write lock ทันที ตาม ADR 0010 §3 [S5]):
       - เมื่อ `skipDuplicates = true`: ตัดแถวซ้ำใน batch ก่อน แล้วใช้ CTE `WITH v(...) AS (VALUES ...), new_rows AS (SELECT ... WHERE NOT EXISTS (SELECT 1 FROM busy_block b WHERE b.user_id = ... AND b.all_day = v.all_day AND b.start_at = v.start_at AND b.end_at = v.end_at AND b.local_start_date = v.local_start_date AND b.local_end_date = v.local_end_date)) INSERT INTO busy_block ... SELECT ... FROM new_rows WHERE EXISTS (user active) AND windowCount + (SELECT count(*) FROM new_rows) <= 300 RETURNING id`
       - จำนวน bind parameter สูงสุดสำหรับ 100 แถว = `7 × 100 + 8 = 708` < ขีดจำกัด SQLite 999
       - ถ้ายัดไม่ลง (`windowCount + pending > 300`) → ไม่ insert แม้แต่แถวเดียว (all-or-nothing) และตอบ `409 LIMIT_REACHED { limit: 'busyCount', max: 300 }`
       - แถวที่สร้างทั้งหมดมี `series_id = NULL`, `routine_id = NULL`, `note = NULL`, `hide_detail = hideDetail ? 1 : 0` (ดีฟอลต์ `1`)

### 4. Rate Limit & Logging (`auth` · A5)
- เพิ่ม `BUSY_IMPORT_RATE_LIMITS` ใน `src/lib/auth/throttle.ts` ใช้ตาราง `rate_limit_bucket` เดิม (ไม่มี migration) จองผ่าน `takeSlots` (มี `precheckRates` ก่อน `serialized` ตาม R18 H2):
  - `preview`: `busy:import:preview` — **20 ครั้ง / 10 นาที / ผู้ใช้** [A] (รองรับการสลับช่วงวัน 30/60/90/180 วันโดยไม่กินโควตา confirm)
  - `confirm`: `busy:import` — **10 ครั้ง / 10 นาที / ผู้ใช้** (ตาม ICS_IMPORT_CONTRACT A5)
- เกินเพดาน → `429 RATE_LIMITED` + header `Retry-After`
- **ห้าม log เนื้อหา `.ics` หรือ `SUMMARY` ในทุกกรณี** (ทั้งปกติและ error — `route.ts` `logUnexpected` log เฉพาะชื่อ error class)

### 5. Error Codes ใหม่ [A]
เพิ่ม 2 รหัสใน `src/lib/shared/errors.ts` (พร้อมคำแปล `errors.*` ทั้ง TH/EN):
- `ICS_TOO_LARGE` (`413`): ไฟล์เกิน 512 KB หรือเกิน 20,000 บรรทัด หรือเกิน 500 `VEVENT`
- `ICS_INVALID` (`400`): ไฟล์ไม่ใช่รูปแบบ `.ics` ที่อ่านได้ (binary/null byte/ไม่มี `VCALENDAR`)

## Consequences
- **ข้อดี**: ไม่มี migration และไม่มี env ใหม่ deploy ได้ทันทีไม่กระทบฐานข้อมูลเดิม · ปิดความเสี่ยง SSRF โดยโครงสร้าง · ข้อมูลส่วนตัว (`DESCRIPTION`, `LOCATION`, `ATTENDEE`, `ORGANIZER`, `URL`) ไม่เคยถูกเก็บลง DB และ `hideDetail = true` เป็นค่าเริ่มต้น · ป้องกัน ReDoS และ race condition ชนเพดาน 300 ด้วย single-pass parser + atomic CTE INSERT
- **ข้อจำกัดที่ยอมรับ**: รายการที่มี `RRULE` ถูกข้ามพร้อมสรุปจำนวน (ผู้ใช้ตั้ง "แบบประจำ" ในแอปแทนตาม B1) · เขตเวลาที่ไม่อยู่ใน IANA และไม่อยู่ในตาราง Windows ยอดนิยมจะถูกข้ามเป็น `invalid` แทนการเดา · การกันซ้ำอาศัยเวลาตรงกันเป๊ะ (B4) หากผู้ใช้แก้เวลาของแถวเดิมในแอปแล้วนำเข้าไฟล์เดิมซ้ำ จะนับเป็นรายการใหม่
