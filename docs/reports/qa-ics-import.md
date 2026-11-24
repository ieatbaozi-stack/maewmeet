# QA `feat/ics-import` — นำเข้าไฟล์ `.ics` เป็นเวลาไม่ว่างของฉัน (v1.1.0)

> ผู้ตรวจ: qa (อิสระ) · Antigravity · **Gemini 4 Neon** (แชตใหม่ · ผู้ทำ: Gemini 4 Neon — ใช้โมเดลเดียวกันตามที่ boss อนุญาต 2026-11-24; ตาม `AGENTS.md` §6 ปกติควรเป็นคนละโมเดล) · branch `feat/ics-import` HEAD `139315c` (ฐาน PR #49 เทียบ `origin/main` `65ccfa9`) · ตรวจ 2026-11-24 · ระดับงาน **C** (แตะ `src/lib/calendar`, `src/app/api`, `src/lib/auth`, `src/lib/data`, `src/components`, อัปโหลดไฟล์) — **บังคับผ่าน Claude Code `security` agent (`docs/reports/security-ics-import.md`) เพิ่มอีก 1 รอบก่อน merge**

## Verdict: ไม่ผ่าน
พบ **2 🔴 Blocker** (CI `test + migration` ล้มจริงที่ `tests/auth/must-change-pin.test.ts:97` และกล่อง `alert-info` 3 จุดใน `IcsImportSheet` แสดงเป็นสีแดงข้อผิดพลาดจริงในภาพหน้าจอเพราะไม่มีคลาส `.alert-info` ใน CSS) และ **3 🟡 ควรแก้** (เปลี่ยนไฟล์เป็นไฟล์เสียในขั้น Preview แล้วชื่อไฟล์เปลี่ยนแต่รายการเก่าค้างและกดนำเข้าได้, ขาด `aria-busy`/สถานะโหลดตอนรีเฟรชใน Preview, `<summary>` ไม่มีลูกศรพับ/ขยาย) · ส่วนตรรกะ pure ICS parser, atomic batch insert, rate limit, RBAC, dedupe, i18n, และ DOCS_SYNC ทำได้ดีมาก — แก้ข้อ 🔴 และ 🟡 แล้วตรวจซ้ำ

## ข้อพบ (เรียงตามความรุนแรง)

1. 🔴 **Blocker — CI `test + migration` ล้มที่ `tests/auth/must-change-pin.test.ts:97`**
   - **ไฟล์:** `tests/auth/must-change-pin.test.ts:28-61`
   - **สถานการณ์ที่พังจริง:** ทั้งบน CI ของ PR #49 (`test + migration` job `137740617349`: ล้ม 1/190 ไฟล์) และรันซ้ำเองในเครื่อง → `POST /api/me/busy/import/preview` ตอบ `400 VALIDATION` แทน `403 PIN_CHANGE_REQUIRED` เนื่องจาก `route.ts` ตรวจ zod body (ขั้น 2) ก่อน resolve actor (ขั้น 3) และ `tests/auth/must-change-pin.test.ts` วนยิงทุก route ที่ `auth: 'actor'` ใน `ROUTE_MANIFEST` โดยส่ง `{}` หากไม่พบคีย์ใน `SAMPLE_BODY` · ขาดทั้ง `'POST /api/me/busy/import/preview'` และ `'POST /api/me/busy/import'` ใน `SAMPLE_BODY`
   - **ทางแก้ (`test`):** เพิ่มตัวอย่าง body ที่ผ่าน zod ของทั้ง 2 route ลงใน `SAMPLE_BODY` ของ `tests/auth/must-change-pin.test.ts`

2. 🔴 **Blocker — กล่องข้อมูลปกติ (`alert-info`) 3 จุดแสดงเป็นสีแดงข้อผิดพลาดทั้งธีมสว่างและมืด**
   - **ไฟล์:** `src/components/busy/IcsImportSheet.tsx:292, 367, 398` (อ้างคลาส `alert alert-info` ซึ่ง **ไม่มีนิยาม** ใน `src/app/globals.css:214, 287-288` — มีเฉพาะ `.alert` สี `--danger-soft`/`--danger-ink`, `.alert-warn`, `.alert-free`)
   - **สถานการณ์ที่พังจริง (ยืนยันจากภาพหน้าจอจริงที่ 375/390/768 × TH/EN × สว่าง/มืด):**
     - ขั้น 1 (`IcsImportSheet.tsx:292`): หมายเหตุความเป็นส่วนตัว (`busy.import.privacyNote`) ขึ้นเป็นกล่องพื้นแดง/ชมพู error
     - ขั้น 2 (`IcsImportSheet.tsx:367`): หมายเหตุปัดเวลา 30 นาที (`busy.import.preview.roundedNote`) ขึ้นเป็นกล่องพื้นแดง/ชมพู error
     - ขั้น 2 (`IcsImportSheet.tsx:398`): ข้อความ "ทุกรายการซ้ำกับที่มีอยู่แล้ว" (`busy.import.preview.allDuplicates`) ขึ้นเป็นกล่องพื้นแดง/ชมพู error
   - ขัดกับ `docs/design/UI_DIRECTION.md` §3 (`--danger-soft`/`--danger-ink` สำหรับกล่องข้อผิดพลาดเท่านั้น) และทำให้ผู้ใช้เข้าใจผิดว่าเกิดข้อผิดพลาดตั้งแต่เปิด sheet
   - **ทางแก้ (`frontend`):** นิยามคลาส `.alert-info` (เช่น พื้น `--surface-2` หรือ `--accent-soft` + ข้อความ `--ink` / `--accent-soft-ink` ที่มีคู่คอนทราสต์ผ่านใน `CONTRAST.md`) ใน CSS โดยใช้ token ล้วน หรือเปลี่ยนไปใช้กล่องข้อมูลที่ใช้ token ถูกต้องตาม `UI_DIRECTION.md`

3. 🟡 **ควรแก้ — เปลี่ยนไฟล์ในขั้น Preview เป็นไฟล์เสียแล้วชื่อไฟล์เปลี่ยนเป็นไฟล์เสียแต่รายการเก่าค้างและปุ่มนำเข้ายังกดได้ (รวมกรณีเปลี่ยนช่วงวันล้มเหลว)**
   - **ไฟล์:** `src/components/busy/IcsImportSheet.tsx:137-139, 142-148`
   - **สถานการณ์ที่พังจริง (ทำซ้ำยืนยันแล้วใน Playwright ที่ 375px TH light):**
     1. เปิด Preview ของไฟล์ที่ถูกต้อง (`good.ics`) เห็น 2 รายการและปุ่ม "นำเข้า 2 รายการ" เปิดอยู่
     2. กด "เปลี่ยนไฟล์" (`ics-change-file`) แล้วเลือกไฟล์เสีย `broken-file.ics` (ขนาด ≤ 512 KB แต่ไม่ใช่ `.ics`)
     3. บรรทัด 137–138 เรียก `setFileName("broken-file.ics")` และ `setIcsText(text)` **ก่อน** `requestPreview` สำเร็จ → พอ API ตอบ `400 ICS_INVALID`, หน้าจอแสดง error banner แต่หัวไฟล์เปลี่ยนเป็น `broken-file.ics` ขณะที่รายการด้านล่างยังเป็นของ `good.ics` และปุ่ม `ics-import-submit` ยัง `enabled` (ถ้ากดต่อจะเป็นการนำเข้ารายการไฟล์เก่าทั้งที่หัวแสดงชื่อไฟล์ใหม่ · และถ้ากดสลับช่วงวันต่อจะส่งเนื้อหาไฟล์เสียซ้ำ)
     4. กรณีเดียวกันเกิดใน `changeWindow` (บรรทัด 144): เรียก `setWindowDays(days)` ก่อน `requestPreview` สำเร็จ หาก API ล้มเหลว (เช่น 429) ปุ่ม segmented จะไฮไลต์ช่วงวันใหม่แต่รายการด้านล่างเป็นของช่วงวันเดิม
   - **ทางแก้ (`frontend`):** Commit `setFileName` / `setIcsText` / `setWindowDays` เฉพาะเมื่อ `requestPreview` ตอบ `res.ok === true`

4. 🟡 **ควรแก้ — ขาด `aria-busy` และตัวบ่งชี้สถานะกำลังโหลดเมื่อรีเฟรชในขั้น Preview**
   - **ไฟล์:** `src/components/busy/IcsImportSheet.tsx:257, 280-291, 300-316`
   - **สถานการณ์:** สเปก `docs/design/ICS_IMPORT.md` §2 ระบุให้ใส่ `aria-busy="true"` และแสดง `busy.import.loading` ระหว่างอ่าน/ส่งไปเซิร์ฟเวอร์ แต่ในคอมโพเนนต์ไม่มี `aria-busy` เลย และในขั้น Preview เมื่อผู้ใช้สลับช่วงล่วงหน้า (30/60/90/180) หรือกด "เปลี่ยนไฟล์" ปุ่มจะแค่ถูก `disabled` ไม่มีข้อความ/สถานะกำลังโหลดแจ้งให้ผู้ใช้รู้
   - **ทางแก้ (`frontend`):** เพิ่ม `aria-busy={loading || submitting}` และแสดงข้อความ `busy.import.loading` ระหว่าง `loading` ในขั้น Preview ด้วย

5. 🟡 **ควรแก้ — แถบ `<details><summary className="ics-skipped-summary">` ไม่มีไอคอนลูกศรพับ/ขยาย**
   - **ไฟล์:** `src/components/calendar/calendar-view.css:156`, `src/components/busy/IcsImportSheet.tsx:376-379`
   - **สถานการณ์ (ยืนยันจากภาพหน้าจอ `preview-375-th-light` และ `preview-768-th-dark`):** `.ics-skipped-summary` ใช้ `display: flex` ทำให้เบราว์เซอร์ตัด `::marker` (`▸`/`▾`) ออกไปทั้งหมดและไม่ได้ใส่ไอคอน Lucide แทน ผู้ใช้มองไม่ออกว่าแถบ "ข้ามไป N รายการ" กดขยายดูเหตุผลได้ (ต่างจาก wireframe `▸ ข้ามไป 4 รายการ` ใน `docs/design/ICS_IMPORT.md:66`)
   - **ทางแก้ (`frontend`):** เพิ่มไอคอน Lucide (`chevron-right` หรือ `chevron-down` ที่หมุนตาม `details[open]`) ใน `<summary>`

6. 🟢 **ข้อเสนอ — ไฟล์ `.ics` ที่ไม่มี `END:VCALENDAR` ยังผ่านเป็น `ok: true`**
   - **ไฟล์:** `src/lib/calendar/ics-import.ts:680, 733, 768`
   - **รายละเอียด:** ADR 0017 §2.1 ระบุว่าต้องมีกรอบ `BEGIN:VCALENDAR` … `END:VCALENDAR` แต่โค้ดตรวจเฉพาะ `seenCalendar` ตอนเจอ `BEGIN:VCALENDAR` ไฟล์ที่ขาดกลางทางไม่มี `END:VCALENDAR` จะคืน `ok: true` แทน `ICS_INVALID` (และ `VEVENT` ที่ไม่ปิดจะถูกนับใน `totalEvents` โดยไม่อยู่ทั้งใน `items` และ `skipped`) · เสนอเพิ่มการตรวจ `seenEndCalendar` หรือบันทึกเป็นข้อจำกัด

7. 🟢 **ข้อเสนอ — จุดเล็กใน ADR 0017 และปุ่ม "เลือกทั้งหมด" เมื่อซ้ำทุกรายการ**
   - `docs/adr/0017-ics-import.md:72` ระบุจำนวน bind param สูงสุด `7 × 100 + 8 = 708` แต่โค้ดจริงใน `src/lib/data/repos/busy.ts:203` เป็น `8 × 100 + 9 = 809 < 999` (เพราะส่ง `tz` รายแถว — ยังปลอดภัยต่ำกว่า 999)
   - `src/components/busy/IcsImportSheet.tsx:406-425`: เมื่อ `allDuplicates === true` ปุ่ม `selectAll` (`selectAllNonDupes`) กดแล้วไม่เลือกอะไรเลย — อาจปิด `disabled` หรือซ่อนแถวปุ่มเลือกเร็วเมื่อไม่มีรายการไม่ซ้ำ

---

## ตรวจตามข้อ contract (`ICS_IMPORT_CONTRACT.md`)

| ข้อ | ผล | หลักฐาน |
|---|---|---|
| I1 (Pure RFC 5545 parser) | ผ่าน | `src/lib/calendar/ics-import.ts` ใช้เฉพาะ `temporal-polyfill` + `./*` ไม่เรียก `new Date()`/DB/env · unfolding/unescape/nested `VALARM`/`VTIMEZONE`/`VTODO` ถูกต้อง · `tests/calendar/ics-import.test.ts` 18/18 ผ่าน |
| I2 (4 รูปแบบเวลา + TZID + round-trip) | ผ่าน | รองรับ `VALUE=DATE` (exclusive `DTEND` − 1 วัน), UTC `Z`, IANA + `/IANA` + Windows TZID ~37 โซน, floating time · round-trip กับ `buildAppointmentIcs` ผ่าน |
| I3 (ปัดเวลาออก 30 นาที) | ผ่าน | floor start / ceil end เป็นครึ่งชั่วโมง รวมข้ามเที่ยงคืน (`23:45–00:15` → `23:30–00:30`, `23:30–23:45` → `23:30–00:00` วันถัดไป + `localEndDate` วันเดิม) · 0 นาที / `end <= start` ข้าม · ผ่าน `normalizeBusyInput` |
| I4 (กรอง + นับ 7 เหตุผล) | ผ่าน | ครบทั้ง `cancelled`, `transparent`, `rrule`, `invalid`, `past` (−7 วัน), `tooFarAhead` (30/60/90/180 ดีฟอลต์ 90), `tooLong` (62/366 วัน) |
| I5 (SUMMARY 80 cp + ไม่เก็บฟิลด์ลับ) | ผ่าน | `NFC` + ล้าง control/bidi/zero-width + ตัด 80 code points ไม่ผ่า surrogate/ไม่ทิ้ง ZWJ ลอย + ตรวจซ้ำด้วย `parseBusyTitle` · ไม่เก็บ `DESCRIPTION`/`LOCATION`/`ATTENDEE`/`ORGANIZER`/`URL` (ตรวจ DB dump แล้วใน integration test) |
| A1 (ADR 0017) | ผ่าน | `docs/adr/0017-ics-import.md` สถานะ Accepted ก่อนเริ่มโค้ด |
| A2 (Endpoints + Manifest + RBAC) | **ไม่ผ่าน (ข้อพบ 1)** | `manifest.test.ts`, `authorize-first.test.ts`, `matrix.test.ts`, `ics-import-api.test.ts` ผ่านทั้งหมด · แต่ `tests/auth/must-change-pin.test.ts` ล้มเพราะขาด `SAMPLE_BODY` ของ 2 route ใหม่ |
| A3 (เพดาน 512KB / 20k บรรทัด / 500 VEVENT / 100 batch / atomic 300) | ผ่าน | `maxBodyBytes: 768*1024`, `Buffer.byteLength > 512*1024`, single-pass O(n) ไม่มี backtracking regex, `insertBusyBatchIfUnderCap` single-SQL CTE ใต้ `inTx` (809 < 999 params) · เทสต์ race ใกล้ 300 (295+4+4 → 201+409 `LIMIT_REACHED`, DB = 299) ผ่าน |
| A4 (กันซ้ำ B4 ไม่มี migration) | ผ่าน | `busyDedupeKey` เทียบ `(allDay, startAt, endAt, localStartDate, localEndDate)` ทั้งใน preview (DB + ซ้ำในไฟล์เอง) และ confirm (CTE `NOT EXISTS`) · `npm run db:check` ผ่าน ไม่มี migration |
| A5 (Rate limit + ไม่ log payload) | ผ่าน | `BUSY_IMPORT_RATE_LIMITS` (`busy:import:preview` 20/10 นาที, `busy:import` 10/10 นาที) ผ่าน `takeSlots` (`precheckRates` ก่อน `serialized`) · ตอบ 429 + `Retry-After` · ไม่ log `.ics`/`SUMMARY` |
| U1 (ทางเข้า + Sheet 2 ขั้น + 375/390/768 × TH/EN × สว่าง/มืด) | **ไม่ผ่าน (ข้อพบ 2–5)** | โครง 2 ขั้น, ปุ่มทางเข้า, โควตา `X/300`, สวิตช์ `hideDetail` เปิดเริ่มต้น, ไม่มี horizontal scroll, เป้าแตะ ≥ 44px ครบทุกปุ่ม · แต่กล่อง `alert-info` 3 จุดขึ้นสีแดง error (ข้อพบ 2), บั๊กเปลี่ยนไฟล์เสียใน Preview (ข้อพบ 3), ขาด `aria-busy` (ข้อพบ 4), `<summary>` ไม่มีลูกศร (ข้อพบ 5) |
| U2 (ข้อความ 2 ภาษา TH/EN) | ผ่าน | `messages.test.ts`, `no-hardcoded-text.test.ts`, `render.test.ts` ผ่าน 241/241 · ภาษาไทยและอังกฤษเป็นธรรมชาติ ไม่มีคำแปลตรงตัว ไม่มี ALL CAPS ไม่มีอีโมจิ |
| U3 (`/privacy` TH/EN) | ผ่าน | เพิ่ม `privacy.calendar.import` ใน `src/app/privacy/page.tsx` และ `messages/{th,en}.json` ตรงกับสัญญาและพฤติกรรมจริง · E2E `privacy.spec.ts` + `ics-import.spec.ts` ผ่าน |
| §4 (DOCS_SYNC) | ผ่าน | อัปเดตครบทุกไฟล์ตาม DOCS_SYNC §2 (`ARCHITECTURE.md`, `OPERATIONS.md`, `CHANGELOG.md`, `README.md`, `quickstart-th.html`, `PRD.md`, `PROGRESS.md`, `HANDOFF.md`) · `docs-sync.test.ts` + `operations-doc.test.ts` ผ่าน |

---

## Code review (9 ข้อ ตาม `.claude/agents/qa.md`)

| ข้อ | ผล | หมายเหตุ |
|---|---|---|
| 1 ตรง contract / ขอบเขตบทบาท | ผ่าน (มีข้อพบ 1–5) | แยก 15 commit ตามบทบาทชัดเจน (`architect`, `ux`, `platform`, `auth`, `frontend`, `test`, `ops`, `main`, `secretary`) · ไฟล์ตรงขอบเขต `AGENTS.md` §4 ทุก commit · อีเมล noreply และ trailer ถูกต้อง |
| 2 ถูกจริง / edge cases | **มีข้อพบ 3** | ฝั่ง parser/service/SQL แน่นมาก · ฝั่ง UI มีบั๊ก state mismatch ตอนเปลี่ยนไฟล์เสียหรือเปลี่ยน window ล้มเหลวในขั้น Preview (ข้อพบ 3) |
| 3 สถาปัตยกรรม | ผ่าน | Pure calendar module ไม่ import shared/DB/clock · UI เรียกผ่าน `callApi` · ใช้ `route()` wrapper + `takeSlots` + `inTx` + `Sheet` เดิม ไม่สร้างของซ้ำ |
| 4 คุณภาพโค้ด | ผ่าน | อ่านง่าย ชื่อชัด TypeScript เข้ม ไม่มี `any` ลวก ไม่มีโค้ดตาย/TODO ไร้เจ้าของ · `params` ใช้ `Object.create(null)` กัน prototype pollution |
| 5 คุณภาพเทสต์ | **ไม่ผ่าน (ข้อพบ 1)** | เทสต์ใหม่ (unit 18, integration 7, E2E 15) ครอบเกณฑ์ดี ไม่ mock จนกลวง · แต่ลืมอัปเดต `SAMPLE_BODY` ใน `tests/auth/must-change-pin.test.ts` ทำให้ CI ล้ม |
| 6 กฎเหล็ก | **มีข้อพบ 2** | `authorize()` บรรทัดแรกทุก service · ไม่มีความลับ/log payload · ไม่มี migration · ใช้ `src/lib/calendar` · ไม่ hard-code ข้อความ · CSS ใช้ token ล้วนผ่าน `check-style-literals.sh` · แต่ใช้คลาส `alert-info` ที่ไม่มีอยู่จริงทำให้ผิดกฎสี `UI_DIRECTION.md` §3 (ข้อพบ 2) |
| 7 ประสิทธิภาพ | ผ่าน | Parser single-pass O(n) · dedupe query จำกัดช่วง `[minDate, maxDate]` · confirm ใช้ single-SQL batch CTE ไม่มี N+1 |
| 8 เอกสาร (DOCS_SYNC) | ผ่าน | ครบทุกไฟล์ตาม DOCS_SYNC §2 · `docs-sync.test.ts` + `operations-doc.test.ts` ผ่าน (ข้อเสนอเล็ก 7 ใน ADR 0017) |
| 9 ความปลอดภัยที่เห็นชัด | ผ่านเบื้องต้น (รอ `security` agent) | ไล่ตาม `.claude/agents/security.md`: ไม่รับ URL (กัน SSRF), `authorize` บรรทัดแรก, `user_id = asUser(actor).id`, `.strict()` กัน mass assignment, `hideDetail` ดีฟอลต์ `true`, ไม่เก็บ/ไม่ส่งฟิลด์ลับ, `Cache-Control: private, no-store`, CSRF JSON เดิม, `maxBodyBytes` แบบ stream cancel · **หมายเหตุสำหรับ `security` agent:** `route.ts` อ่าน JSON body (768 KB สำหรับ preview) ในขั้น 2 ก่อน `resolveActor` ในขั้น 3 (เหมือนทุก route อื่น แต่ขนาดเพดานใหญ่ขึ้นจาก 64 KB → 768 KB) — ให้ Claude Code `security` agent ประเมินเชิงลึกใน `docs/reports/security-ics-import.md` |

---

## Anti-slop checklist (`UI_DIRECTION.md` §8) — ตรวจจากภาพหน้าจอจริง

ถ่ายภาพและวัด DOM จริงผ่าน Playwright (`next start` production build) ที่ **375×812 (TH light, EN dark)**, **390×844 (EN light)**, **768×1024 (TH dark)** รวม 12 หน้าจอ (แท็บ "ของฉัน", ขั้น 1 เลือกไฟล์, ขั้น 2 Preview พร้อมชื่อไทยยาวพิเศษ/ปัดเวลา/ขยาย skipped):
- **ไม่พบ horizontal scroll:** `scrollWidth === clientWidth` ครบทั้ง 12 จอ (375, 390, 768)
- **เป้าแตะ ≥ 44px:** ตรวจทุก `button`, `summary`, `label.ics-item-label` ใน sheet และแถบหัวแท็บ — ไม่พบตัวใดต่ำกว่า 44px (`small: []`)
- **Token & คอนทราสต์:** `check-style-literals.sh src` ผ่าน (ไม่มี hex/px สุ่ม), `contrast.mjs` ผ่าน 338/338 คู่ (ต่ำสุด 4.54:1)
- **ไอคอน/ข้อความ/แบรนด์:** ใช้ Lucide เส้นเดียวสม่ำเสมอ ไม่มีอีโมจิ ไม่มี gradient ปุ่ม/การ์ด ข้อความ TH/EN อ่านเป็นธรรมชาติ
- **จุดที่ไม่ผ่าน:** ข้อพบ 2 (กล่อง `alert-info` เป็นสีแดงข้อผิดพลาด) และข้อพบ 5 (`<summary>` ไม่มีสัญลักษณ์พับ/ขยาย)
- **คำตัดสินต่อหน้า:**
  - แท็บ "ของฉัน" (ปุ่ม "นำเข้า .ics" คู่กับ "ลงแบบประจำ" + หน้าว่าง): **เหมือนผลิตภัณฑ์จริง** — ระยะห่าง ลำดับชั้น และการตัดแถวสมดุลทั้ง 375/390/768 และทั้งสองธีม
  - `IcsImportSheet` ขั้น 1 และขั้น 2: **โครงและตัวอักษรเหมือนผลิตภัณฑ์จริง แต่สีกล่อง `alert-info` ที่แดงเหมือน error ทำให้ดูผิดพลาดทันทีที่เห็น** — ต้องแก้ข้อพบ 2 และข้อพบ 5 ก่อนส่ง

---

## คำสั่งที่รันซ้ำเอง + ผลจริง (เครื่อง Windows)

| คำสั่ง | ผลจริง |
|---|---|
| `npm run typecheck` | ผ่าน (exit 0) |
| `npm run lint` | ผ่าน (exit 0) |
| `tr -d '\r' < .github/scripts/check-style-literals.sh \| bash -s -- src` | ผ่าน (`src: ไม่มีค่าสี hex / px นอก tokens`) |
| `tr -d '\r' < .github/scripts/check-env-example.sh \| bash -s -- .env.example` | ผ่าน (`.env.example: ไม่มีค่าลับ`) |
| `node docs/design/tools/contrast.mjs` | ผ่าน (338 คู่ · ไม่ผ่าน 0 · ต่ำสุด 4.54:1) |
| `npm run db:check` | ผ่าน (`Everything's fine`) |
| `npm run build` | ผ่าน (`next build` สำเร็จ 51/51 pages รวม `/api/me/busy/import` และ `/api/me/busy/import/preview`) |
| `npx vitest run tests/calendar/ics-import.test.ts tests/busy/ics-import-api.test.ts tests/busy/busy-api.test.ts tests/busy/calendar-visibility.test.ts tests/platform/manifest.test.ts tests/security/authorize-first.test.ts tests/rbac/matrix.test.ts tests/i18n/messages.test.ts tests/i18n/no-hardcoded-text.test.ts tests/i18n/render.test.ts tests/ops/docs-sync.test.ts tests/ops/operations-doc.test.ts --reporter=agent --testTimeout=60000` | ผ่าน 12 ไฟล์ / 2,753 tests |
| `npx vitest run tests/auth/must-change-pin.test.ts tests/security/ tests/platform/ --reporter=agent --testTimeout=60000` | **ล้ม 1 / ผ่าน 46 (47 ไฟล์ · 968 passed, 1 failed, 1 skipped)** — ล้มเฉพาะ `tests/auth/must-change-pin.test.ts:97` (`POST /api/me/busy/import/preview → 400 VALIDATION`) |
| `$env:PW_CHROMIUM_PATH=...; $env:E2E_PORT=3125; npx playwright test tests/e2e/ics-import.spec.ts tests/e2e/privacy.spec.ts --reporter=line --workers=4` | ผ่าน 24/24 (20.0s · 375/390/768 × TH/EN × light/dark) |
| สคริปต์ตรวจภาพหน้าจอ + DOM (375/390/768 × TH/EN × light/dark + repro เปลี่ยนไฟล์เสีย) | 0 overflow · 0 control < 44px · **พบข้อพบ 2, 3, 5 จริง** |

## สถานะ CI บน PR #49 (`gh pr checks 49`, HEAD `139315c`)
- `lint` ✔ · `typecheck` ✔ · `build` ✔ · `changes` ✔ · `contrast` ✔ · `e2e (Playwright) (1)–(4)` ✔ · `Vercel` ✔
- **`test + migration` ✘** (job `137740617349`: 189/190 ไฟล์ผ่าน, ล้มเฉพาะ `tests/auth/must-change-pin.test.ts:97` — ตรงกับข้อพบ 1)

## สิ่งที่ตรวจไม่ได้
- ไม่ได้รัน `npm test` ทั้งชุดในเครื่อง Windows (ข้อจำกัดเดิมตาม `AGENTS.md` §9 — อ้างอิงผล CI `test + migration` 190 ไฟล์แทน)
- ไม่ได้ลองอัปโหลดไฟล์ `.ics` จริงจากแอปบนอุปกรณ์มือถือจริง (iOS Safari / LINE in-app browser)
- ไม่ได้ตรวจความปลอดภัยเชิงลึกแทน Claude Code `security` agent — **ยังคงบังคับต้องรัน `security` agent และสร้าง `docs/reports/security-ics-import.md` ก่อน merge**

---

## ติดตามผลหลังแก้ข้อพบ 1–5 (2026-11-24)
- boss สั่งให้แก้ข้อพบ 🔴 1–2 และ 🟡 3–5 ใน branch `feat/ics-import` แล้วส่งตรวจ `qa` รอบสอง:
  - `68dfbc7` (`frontend`): เพิ่ม `.alert-info` (`--accent-soft`/`--accent-soft-ink`) ใน `src/app/globals.css`, อัปเดต `fileName`/`icsText`/`windowDays` ใน `IcsImportSheet.tsx` เฉพาะเมื่อ preview สำเร็จ, เพิ่ม `aria-busy` + สถานะโหลดในขั้น Preview, เพิ่มไอคอน `chevron-right` หมุนตาม `<details open>` ใน `<summary>`, และป้องกันปุ่ม "เปลี่ยนไฟล์" ตัด 2 บรรทัด
  - `bbeeb1b` (`test`): เพิ่ม `SAMPLE_BODY` ของ `POST /api/me/busy/import/preview` และ `POST /api/me/busy/import` ใน `tests/auth/must-change-pin.test.ts` + เพิ่ม regression assertion ใน `tests/e2e/ics-import.spec.ts` (ตรวจสี `.alert-info` ≠ error, ตรวจ chevron, ตรวจเปลี่ยนไฟล์เสียใน Preview แล้วชื่อไฟล์เดิมไม่หาย)
- **ผลตรวจของผู้ทำหลังแก้:** `check-style-literals.sh src` ผ่าน · `npm run lint` ผ่าน · `npm run typecheck` ผ่าน · `node docs/design/tools/contrast.mjs` ผ่าน (338/338) · `npm run build` ผ่าน · `vitest` 8 ไฟล์รวม `must-change-pin.test.ts` ผ่าน 315/315 · Playwright `ics-import.spec.ts` ผ่าน 15/15 (375/390/768 × TH/EN × สว่าง/มืด)
- **ยังไม่นับเป็น QA รอบสอง (ตาม `AGENTS.md` §5.6 / §6):** แชตนี้เป็นผู้เขียนโค้ดส่วนแก้ (`68dfbc7`, `bbeeb1b`) เอง จึงห้ามตรวจรับรองงานที่เพิ่งแก้ในแชตเดียวกัน — **ต้องเปิดแชตใหม่เพื่อสวมบทบาท `qa` ตรวจรอบสองแล้วต่อท้ายรายงานนี้** และ **ต้องรัน Claude Code `security` agent เขียน `docs/reports/security-ics-import.md`** ก่อน merge

---

## QA รอบสอง — ตรวจส่วนแก้ (`68dfbc7`, `bbeeb1b`) + ผล CI PR #49 (2026-11-24)

> ผู้ตรวจ: qa (อิสระ · แชตใหม่) · Antigravity · **Gemini 4 Neon** (ใช้โมเดลเดียวกับผู้ทำตามที่ boss อนุญาต 2026-11-24; ตาม `AGENTS.md` §6 ปกติควรเป็นคนละโมเดล) · branch `feat/ics-import` HEAD `80a1ef7` (ตรวจ diff ของ `68dfbc7` + `bbeeb1b` และผล CI PR #49 run `45300000564`)

### Verdict รอบสอง: ผ่าน (สำหรับ QA · ยังคงรอ Claude Code `security` agent ก่อน merge)
ข้อพบ **🔴 1–2** และ **🟡 3–5** จากรอบแรกถูกแก้ครบตรงจุด ไม่พบข้อพบ 🔴/🟡 ใหม่ และ **CI บน PR #49 ผ่านครบทุก job** (รวม `test + migration` 190/190 ไฟล์ และ `e2e (Playwright) (1)–(4)`) · คงเหลือเฉพาะข้อเสนอ 🟢 6–7 เดิมซึ่งไม่บังคับ · งานนี้เป็นระดับ **C** จึงยัง **ต้องรัน Claude Code `security` agent เขียน `docs/reports/security-ics-import.md` ก่อน boss merge**

### ตรวจปิดข้อพบ 1–5 (ยืนยันจาก diff + รันซ้ำเอง + ภาพหน้าจอจริง)

| ข้อพบเดิม | Commit | ผลตรวจรอบสอง | หลักฐานที่ตรวจจริง |
|---|---|---|---|
| 1. 🔴 `must-change-pin.test.ts` ล้ม (CI `test + migration`) | `bbeeb1b` | **ปิดแล้ว (ผ่าน)** | เพิ่ม `SAMPLE_BODY` ของทั้ง `POST /api/me/busy/import/preview` และ `POST /api/me/busy/import` ใน `tests/auth/must-change-pin.test.ts:50-51` · รันซ้ำในเครื่องผ่านครบ และบน CI `test + migration` (job `138129848689`) ผ่าน 190/190 ไฟล์ |
| 2. 🔴 กล่อง `alert-info` 3 จุดเป็นสีแดง error | `68dfbc7`, `bbeeb1b` | **ปิดแล้ว (ผ่าน)** | นิยาม `.alert-info { background: var(--accent-soft); color: var(--accent-soft-ink); }` ใน `src/app/globals.css:289` (อยู่หลัง `.alert` บรรทัด 214 จึง override ถูกต้อง ใช้ token ล้วน และผ่าน `contrast.mjs` 338/338 — คู่ `--accent-soft-ink`/`--accent-soft` สว่าง/มืด 8.54:1) · ยืนยันจากภาพหน้าจอจริงทั้ง 3 จุด (`ics-privacy`, `ics-rounded-note`, `ics-all-duplicates`): สว่าง `rgb(227, 230, 247)` / `rgb(47, 58, 148)`, มืด `rgb(43, 47, 80)` / `rgb(202, 208, 247)` + มี regression assertion ใน `tests/e2e/ics-import.spec.ts:110-120` |
| 3. 🟡 เปลี่ยนไฟล์เสียหรือเปลี่ยนช่วงวันล้มเหลวใน Preview แล้ว state เพี้ยน | `68dfbc7`, `bbeeb1b` | **ปิดแล้ว (ผ่าน)** | `requestPreview()` ใน `src/components/busy/IcsImportSheet.tsx:95-115` commit `fileName`/`icsText`/`windowDays` เฉพาะเมื่อ `res.ok === true` · ทดสอบจริงในเบราว์เซอร์: (ก) เปลี่ยนเป็นไฟล์เสียใน Preview → แสดง error แต่ชื่อไฟล์เดิมและ `icsText` เดิมยังอยู่ (กดสลับช่วงวันต่อยังส่งไฟล์ดีเดิมสำเร็จ) · (ข) จำลอง 429 ตอนเปลี่ยนช่วงจาก 30→180 วัน → `aria-pressed` คงที่ 30 วันไม่เพี้ยน + มี regression test ใน `tests/e2e/ics-import.spec.ts:170-186` |
| 4. 🟡 ขาด `aria-busy` และตัวบ่งชี้โหลดในขั้น Preview | `68dfbc7` | **ปิดแล้ว (ผ่าน)** | เพิ่ม `aria-busy={loading \|\| submitting}` ที่ `ics-import-sheet` (`IcsImportSheet.tsx:259`), `aria-busy={loading}` ที่ `ics-pick-button` (`:287`), และแถบ `ics-preview-loading` (`role="status"`, `:321-325`) · ยืนยันในเบราว์เซอร์ด้วยการหน่วง `/api/me/busy/import/preview` 400ms → `aria-busy="true"` และแสดง `"กำลังอ่านไฟล์ปฏิทิน…"` แล้วสลับกลับ `"false"` เมื่อเสร็จ |
| 5. 🟡 `<summary>` ไม่มีไอคอนลูกศรพับ/ขยาย | `68dfbc7`, `bbeeb1b` | **ปิดแล้ว (ผ่าน)** | เพิ่ม `<Icon name="chevron-right" size="sm" className="ics-skipped-chevron" />` (`IcsImportSheet.tsx:387`) พร้อม CSS ซ่อน native marker และหมุน 90° เมื่อ `[open]` (`calendar-view.css:157-160`) · ยืนยันจากภาพหน้าจอและ computed transform (`none` → `matrix(0, 1, -1, 0, 0, 0)`) + assertion ใน `tests/e2e/ics-import.spec.ts:105` |
| เสริม (`68dfbc7`): ปุ่ม "เปลี่ยนไฟล์" ไม่ตัด 2 บรรทัด | `68dfbc7` | **ผ่าน** | `.ics-file-bar .btn { flex: none; white-space: nowrap; }` (`calendar-view.css:152`) · ทดสอบชื่อไฟล์ยาว 59 ตัวอักษรที่ 375/390/768 (TH/EN): ชื่อไฟล์ตัด `...` ปุ่มสูง 44px บรรทัดเดียว ไม่ล้นแนวนอน |

### อัปเดตเกณฑ์ contract และ Anti-slop หลังแก้
- **A2 (Endpoints + Manifest + RBAC):** **ผ่าน** (ข้อพบ 1 ปิดแล้วทั้งในเครื่องและ CI)
- **U1 (Sheet 2 ขั้น + 375/390/768 × TH/EN × สว่าง/มืด):** **ผ่าน** (ข้อพบ 2–5 ปิดครบ)
- **Anti-slop checklist (ตรวจภาพหน้าจอจริงรอบสอง 9 ภาพ — 375 TH light [step1/preview/alldup], 375 EN dark [step1/preview], 390 EN light [step1/preview], 768 TH dark [step1/preview]):**
  - `scrollWidth <= clientWidth` ครบทุกจอ (0 overflow) · เป้าแตะทุก control ≥ 44px (`smallControls: []`)
  - กล่อง `alert-info` ทั้ง 3 จุดเป็นโทนฟ้าม่วงอ่อน (`--accent-soft`/`--accent-soft-ink`) สบายตา อ่านง่ายทั้งธีมสว่างและมืด ไม่สับสนกับ error
  - แถบ `<details>` มีลูกศร `chevron-right` พับ/ขยายชัดทั้งตอนปิดและเปิด
  - **คำตัดสินต่อหน้า:** `IcsImportSheet` ขั้น 1 และขั้น 2 — **เหมือนผลิตภัณฑ์จริง** ทั้ง 375/390/768 × TH/EN × สว่าง/มืด

### คำสั่งที่รันซ้ำเองรอบสอง + ผลจริง (เครื่อง Windows, HEAD `80a1ef7`)

| คำสั่ง | ผลจริง |
|---|---|
| `npm run typecheck` | ผ่าน (exit 0) |
| `npm run lint` + `npx eslint tests/e2e/ics-import.spec.ts` | ผ่าน (exit 0) |
| `tr -d '\r' < .github/scripts/check-style-literals.sh \| bash -s -- src` | ผ่าน (`src: ไม่มีค่าสี hex / px นอก tokens`) |
| `node docs/design/tools/contrast.mjs` | ผ่าน (338 คู่ · ไม่ผ่าน 0 · คู่ข้อความต่ำสุด 4.54:1) |
| `npm run build` | ผ่าน (`next build` 51/51 pages) |
| `npx vitest run tests/auth/must-change-pin.test.ts tests/calendar/ics-import.test.ts tests/busy/ics-import-api.test.ts tests/busy/busy-api.test.ts tests/busy/calendar-visibility.test.ts tests/platform/manifest.test.ts tests/security/authorize-first.test.ts tests/rbac/matrix.test.ts tests/i18n/messages.test.ts tests/i18n/no-hardcoded-text.test.ts tests/i18n/render.test.ts tests/ops/docs-sync.test.ts tests/ops/operations-doc.test.ts --reporter=agent --testTimeout=60000` | ผ่าน **13 ไฟล์ / 2,787 tests** (35.04s) |
| `$env:PW_CHROMIUM_PATH=...; $env:E2E_PORT=3126; npx playwright test tests/e2e/ics-import.spec.ts tests/e2e/privacy.spec.ts --reporter=line --workers=4` | ผ่าน **24/24** (18.1s · 375/390/768 × TH/EN × light/dark) |
| สคริปต์ตรวจภาพหน้าจอ + DOM + พฤติกรรมรอบสอง (375/390/768 × TH/EN × light/dark · broken file · delayed preview · 429 window change · all-duplicates) | ผ่านทั้งหมด · 0 overflow · 0 control < 44px · ตรวจภาพจริง 9 ภาพผ่านทุกจุด |

### ผล CI บน PR #49 (`gh pr checks 49`, HEAD `80a1ef7`, run `45300000564`)
ผ่านครบ **12/12 checks**:
- `test + migration` ✔ (4m31s · job `138129848689`: Vitest **190/190 ไฟล์ผ่าน** + `db:check` + `drizzle-kit migrate` บน DB ว่าง)
- `lint` ✔ (45s · รวม `check-env-example.sh` และ `check-style-literals.sh`)
- `typecheck` ✔ (28s) · `contrast` ✔ (6s) · `build` ✔ (45s) · `changes` ✔ (4s)
- `e2e (Playwright) (1)` ✔ (12m30s) · `(2)` ✔ (18m34s) · `(3)` ✔ (20m4s) · `(4)` ✔ (19m57s)
- `Vercel` ✔ (`Deployment has completed`) · `Vercel Preview Comments` ✔

### สิ่งที่ตรวจไม่ได้ (คงเดิม)
- ไม่ได้รัน `npm test` ทั้งชุดในเครื่อง Windows (ข้อจำกัดเดิมตาม `AGENTS.md` §9 — อ้างอิงผล CI `test + migration` 190/190 ไฟล์ผ่านแทน)
- ไม่ได้ลองอัปโหลดไฟล์ `.ics` จริงจากแอปบนอุปกรณ์มือถือจริง (iOS Safari / LINE in-app browser)
- ไม่ได้ตรวจความปลอดภัยเชิงลึกแทน Claude Code `security` agent — **ยังคงบังคับต้องรัน Claude Code `security` agent สร้าง `docs/reports/security-ics-import.md` ก่อน merge**


