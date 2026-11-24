# ICS_IMPORT_CONTRACT.md — นำเข้าไฟล์ `.ics` เป็นเวลาไม่ว่างของฉัน (v1.1.0)

> ผู้เขียน: main (Antigravity · Gemini 4 Neon) · 2026-11-23 · สถานะ: **boss เห็นชอบแล้ว** 2026-11-23 (B1–B4 = ค่าแนะนำ (ก) ทั้ง 4 ข้อ · boss เปลี่ยนได้ก่อนเริ่มเขียนโค้ด)
> ที่มา: [PRD.md §6](../prd/PRD.md) (`v1.x: นำเข้า ICS`) · [PROGRESS.md](../team/PROGRESS.md) หัวข้อ "เหลือ → งานหลัง 1.0"
> branch งานโค้ดที่แนะนำ: `feat/ics-import` จาก `main` ล่าสุด (หลัง merge contract นี้) · ใช้คู่กับ [DOCS_SYNC_CONTRACT.md](DOCS_SYNC_CONTRACT.md)
> ระดับงาน: **ระดับ C** (ฟีเจอร์ใหม่หลายส่วน แตะ `src/lib/calendar`, `src/app/api`, `src/lib/rbac`, `src/lib/data`, `src/components`, ไฟล์อัปโหลดจากผู้ใช้) · แนะนำทำใน Claude Code ทีม agent เต็มตาม `AGENTS.md` §3 · **บังคับผ่าน qa + Claude Code `security` agent** ก่อน merge · เลขรุ่นหลังเสร็จตาม semver: **v1.1.0**

> **ปิดรอบ + ออกรุ่น v1.1.0 (2026-11-24)** · PR #49 merge แล้ว (`2d2b93b`) · tag `v1.1.0` → `87f7db0` · ไม่มี migration · qa รอบ 2 ผ่าน (`12f5120`) · security รอบ 1 ไม่ผ่าน (M1) → แก้ตาม §7 (`d0804a6`) → ตรวจซ้ำผ่าน (`984f5a4`)

---

## 0. หลักของรอบนี้
- **เป้าหมาย:** ให้ผู้ใช้ส่งออกไฟล์ `.ics` จาก Google Calendar / Apple Calendar / Outlook แล้วนำเข้ามาเป็น **เวลาไม่ว่างของฉัน (`busy_block`)** ได้ในครั้งเดียว โดยเห็นตัวอย่างและเลือก/ตัดรายการได้ก่อนบันทึก
- **นำเข้าเป็น `busy_block` เท่านั้น (ไม่สร้างนัดของกลุ่ม):** ใช้คำนวณวันว่างร่วมในทุกกลุ่มที่ผู้ใช้สังกัดตามกฎ D5 และ ADR 0006 เดิม
- **รับเฉพาะไฟล์ `.ics` ที่อัปโหลดจากเครื่องผู้ใช้:** **ไม่รับ URL** (`webcal://` / `https://`) เพื่อปิดความเสี่ยง SSRF และไม่เพิ่ม cron sync ภายนอก
- **ไม่มี migration (ตาม B4 = (ก)):** เก็บเป็นแถว `busy_block` ปกติ (`series_id = null`, `routine_id = null`) ไม่แตะ schema เดิม ไม่มี env ใหม่ ไม่ใช่ breaking change ต่อ deploy เดิม
- **ความเป็นส่วนตัวมาก่อน:** ดีฟอลต์ **ซ่อนรายละเอียด (`hideDetail = true`)** สำหรับทุกรายการที่นำเข้า (ตาม B3 = (ก)) และ **ไม่เก็บ** `DESCRIPTION`, `LOCATION`, `ATTENDEE`, `ORGANIZER`, `URL` จากไฟล์ `.ics`

---

## 1. ตัวแปลง `.ics` และกฎเวลา (`platform` · `src/lib/calendar/ics-import.ts`)

| # | งาน | เกณฑ์รับ |
|---|---|---|
| I1 | **Pure ICS parser** ใน `src/lib/calendar/ics-import.ts`: ใช้ `temporal-polyfill` + `src/lib/calendar` เท่านั้น (ห้าม `new Date()`, ไม่อ่านนาฬิกาเอง — รับ `nowMs` + `defaultTz` แบบ inject) · รองรับ RFC 5545 line unfolding (`CRLF`/`LF` + space/tab), text unescape (`\\`, `\,`, `\;`, `\n`), `VEVENT` ภายใต้ `VCALENDAR` · อ่านเฉพาะ `SUMMARY`, `DTSTART`, `DTEND`, `DURATION`, `TRANSP`, `STATUS`, `RRULE` | เทสต์ครอบไฟล์จริงจาก Google Calendar, Apple Calendar, Outlook · ทน CRLF/LF, UTF-8 ภาษาไทย, บรรทัดพับกลางตัวอักษรไทย, ค่า parameter ที่มีเครื่องหมายคำพูด |
| I2 | **เวลาและเขตเวลา:** รองรับ 4 รูปแบบ: (1) `VALUE=DATE` (`YYYYMMDD`) → `all_day` โดย `DTEND` แบบ exclusive ของ RFC 5545 ลบ 1 วันเป็น `localEndDate` แบบ inclusive (ไม่มี `DTEND`/`DURATION` = 1 วัน) · (2) `YYYYMMDDTHHMMSSZ` (UTC) → แปลงเป็นเขตเวลาผู้ใช้/ดีฟอลต์ `Asia/Bangkok` · (3) `TZID=<IANA>` ที่ผ่าน `isValidTimeZone` → แปลงเป็น instant แล้วแปลงเป็น `defaultTz` (`Asia/Bangkok`) · (4) floating time (ไม่มี `Z`/ไม่มี `TZID`) → ตีความเป็น `defaultTz` (`Asia/Bangkok`) · TZID แบบ Windows (เช่น `SE Asia Standard Time`) หรือไม่รู้จัก → ตามนโยบายใน ADR 0017 | เทสต์ครบทั้ง 4 รูปแบบ + กรณีข้ามเที่ยงคืน + `DTEND` exclusive ของ all-day + ไฟล์จาก `buildAppointmentIcs` เดิมของ maewmeet นำเข้ากลับได้ตรงวันเวลา |
| I3 | **ปัดเวลาลงตัว 30 นาที (`STEP_MINUTES = 30`):** อ้างอิง `src/lib/calendar/busy.ts` ที่บังคับเวลา `timed` ลงตัว 30 นาที → ปัดแบบ **กันพลาด (outward rounding)**: เวลาเริ่มปัด **ลง** เป็นครึ่งชั่วโมง (floor) เวลาจบปัด **ขึ้น** เป็นครึ่งชั่วโมง (ceil) เช่น `09:15–10:45` → `09:00–11:00` · รายการ `timed` ที่เริ่ม=จบ (0 นาที) หรือ `end <= start` → ข้าม | เทสต์กรณีลงตัวอยู่แล้วไม่เปลี่ยน, `09:15–10:45` → `09:00–11:00`, `23:45–00:15` ข้ามวัน, ช่วง 0 นาทีถูกข้าม |
| I4 | **การกรองและเหตุผลที่ข้าม (ส่งคืนในผล preview ครบทุกข้อ):** ข้ามอัตโนมัติพร้อมนับจำนวนแยกเหตุผล: (1) `TRANSP:TRANSPARENT` (สถานะว่าง/Free) · (2) `STATUS:CANCELLED` · (3) จบก่อน `วันนี้ − BUSY_MAX_BACKDATE_DAYS` (7 วัน) · (4) เริ่มหลังขอบเขตล่วงหน้า (**B2 = (ก)**: ดีฟอลต์ 90 วัน, เลือกได้ 30/60/90/180 วัน) · (5) ยาวเกิน `BUSY_MAX_TIMED_DAYS` (62 วัน) หรือ `BUSY_MAX_SPAN_DAYS` (366 วัน) · (6) มี `RRULE` (**B1 = (ก)**: ข้ามแล้วสรุปจำนวน) · (7) รูปแบบวันเวลา/TZID อ่านไม่ได้ | เทสต์ยืนยันตัวนับเหตุผลที่ข้ามทุกข้อแม่นยำ ไม่มีรายการไม่ถูกต้องหลุดผ่าน `normalizeBusyInput` |
| I5 | **ชื่อรายการ (`SUMMARY`):** ตัดให้ไม่เกิน `BUSY_TITLE_MAX` (80 code point) หลัง `NFC` + ล้างอักขระควบคุม/bidi/zero-width ให้ผ่าน `parseBusyTitle` (ถ้าว่างหรือไม่เหลือตัวอักษร → `title: null`) · ไม่รับ `DESCRIPTION`/`LOCATION`/`ATTENDEE` เข้า `note` หรือฟิลด์อื่น | เทสต์ชื่อยาว > 80 ตัดสวยไม่ผ่า surrogate pair · bidi/zero-width/control chars ถูกล้างหรือปฏิเสธอย่างปลอดภัย |

---

## 2. API, การกันซ้ำ, สิทธิ์ และความปลอดภัย (`platform` · `auth` · `architect`)

| # | งาน | เกณฑ์รับ |
|---|---|---|
| A1 | **ADR 0017 (`architect` เขียนก่อนโค้ด):** กำหนดสถาปัตยกรรม parser, จุด parse (preview ที่เซิร์ฟเวอร์ vs client), นโยบาย TZID, สูตรกันซ้ำ (**B4**), ลิมิตขนาดไฟล์/บรรทัด/VEVENT, และ rate limit | ADR 0017 สถานะ Accepted ก่อนเริ่มงาน `platform` |
| A2 | **Endpoint ใหม่ + Route Manifest (`src/app/api/_lib/manifest.ts`):** เพิ่ม route สำหรับนำเข้าของเจ้าตัวเท่านั้น (เช่น `POST /api/me/busy/import/preview` รับไฟล์/ข้อความ `.ics` คืนรายการที่ตรวจแล้ว + สรุปที่ข้าม + โควตาคงเหลือ, และ `POST /api/me/busy/import` บันทึกรายการที่ผู้ใช้ยืนยัน) · `authorize()` บรรทัดแรกด้วยสิทธิ์เจ้าของ `busy.write` (ด่านบัญชี: บล็อก anonymous / suspended / `must_change_pin` · SA แก้/นำเข้าแทนคนอื่นไม่ได้) | เทสต์ `tests/platform/manifest.test.ts` + `tests/security/authorize-first.test.ts` + `tests/rbac/matrix.test.ts` ผ่าน |
| A3 | **เพดานและความปลอดภัยของอินพุต:** (1) ขนาดไฟล์สูงสุด **512 KB** ตรวจก่อนอ่าน/parse · ปฏิเสธ null byte / binary · (2) จำกัด **20,000 บรรทัด** และ **500 `VEVENT`** ต่อไฟล์ (linear O(n) parser ไม่มี backtracking regex กัน ReDoS) · (3) จำกัดนำเข้าต่อครั้งไม่เกิน **100 รายการ** (หรือพื้นที่คงเหลือของ `BUSY_MAX_PER_USER = 300` แล้วแต่ค่าน้อยกว่า) · (4) บันทึกใน transaction เดียวแบบ atomic ตรวจ `activeBusyCount + N <= 300` (กันแข่ง) — เกินเพดานตอบ `LIMIT_REACHED { limit: 'busyCount', max: 300 }` ทั้งก้อน (all-or-nothing) | เทสต์: ไฟล์เกิน 512 KB → ปฏิเสธ · ไฟล์หลอก VEVENT 1,000 ตัว → ปฏิเสธ/ตัดตามเพดานเร็วไม่ค้าง · แข่งนำเข้า 2 คำขอพร้อมกันใกล้ 300 → ไม่เกิน 300 แถว · ไม่มีข้อมูลคนอื่นรั่ว |
| A4 | **กันซ้ำ (ตาม B4 = (ก)):** เทียบรายการที่จะนำเข้ากับ `busy_block` ที่ยัง active ของผู้ใช้ในช่วงวันที่เดียวกัน ถ้าเวลาตรงกันเป๊ะ (`allDay`, `startAt`, `endAt`, `localStartDate`, `localEndDate`) → ติ๊กสถานะ "ซ้ำกับที่มีอยู่" และ **ไม่เลือกโดยค่าเริ่มต้น** ในหน้า preview (และตรวจซ้ำฝั่งเซิร์ฟเวอร์ตอนกดยืนยันตามตัวเลือก) | เทสต์นำเข้าไฟล์เดิมซ้ำรอบ 2 → ระบบเห็นว่ารายการซ้ำทั้งหมด ไม่สร้างแถวเบิ้ล |
| A5 | **Rate Limit (`auth`):** เพิ่มถังเฉพาะ `busy:import` ผ่าน `rate_limit_bucket` เดิม (ไม่มี migration) เช่น **10 ครั้ง / 10 นาที / ผู้ใช้** (preview และ confirm แยกถังหรือนับร่วมตาม ADR 0017) → เกินตอบ `429 RATE_LIMITED` + `Retry-After` · **ห้าม log เนื้อหาไฟล์ `.ics` หรือ `SUMMARY`** | เทสต์ 429 + `Retry-After` · ตรวจไม่พบการ log payload `.ics` |

---

## 3. ประสบการณ์ผู้ใช้และหน้าจอ (`ux` · `frontend`)

| # | งาน | เกณฑ์รับ |
|---|---|---|
| U1 | **ทางเข้า + Flow 2 ขั้น (`ux` ออกแบบใน `docs/design/ICS_IMPORT.md` ก่อน `frontend` ทำ):** ปุ่ม "นำเข้า .ics" ในหน้าปฏิทินแท็บ "ของฉัน" → เปิด Sheet 2 ขั้น: (1) เลือกไฟล์ `.ics` + เลือกช่วงล่วงหน้า (ดีฟอลต์ 90 วัน · เลือกได้ 30/60/90/180 วัน) + คำอธิบายสั้นว่าไฟล์ไม่ถูกส่งต่อใคร · (2) หน้า Preview แสดงสรุป (นำเข้าได้ / ข้ามพร้อมเหตุผล / ซ้ำ) + สวิตช์ **"ซ่อนรายละเอียดจากคนในกลุ่ม"** (**เปิดเป็นค่าเริ่มต้น** ตาม B3 = (ก)) + รายการพร้อม checkbox เลือก/ยกเลิก + ตัวเลขโควตา `X/300` + ปุ่ม "นำเข้า N รายการ" | ผ่าน 375/390/768 × TH/EN × สว่าง/มืด · เป้าแตะ ≥ 44px · ไม่มีเลื่อนแนวนอน · คอนทราสต์ ≥ 4.5:1 |
| U2 | **ข้อความ 2 ภาษา (`messages/th.json`, `messages/en.json`):** ครบทุกสถานะ (เลือกไฟล์, โหลด, ไฟล์ใหญ่เกิน, ไฟล์ไม่ใช่ `.ics`, ไม่มีรายการที่ใช้ได้, เหตุผลที่ข้ามทุกแบบ, เตือนปัดเวลาครึ่งชั่วโมง, โควตาเต็ม, นำเข้าสำเร็จ) — เป็นธรรมชาติทั้ง TH/EN ไม่แปลตรงตัว | `tests/i18n/messages.test.ts`, `no-hardcoded-text.test.ts`, `render.test.ts` ผ่าน |
| U3 | **ความเป็นส่วนตัว (`/privacy`):** เพิ่มข้อความสั้นว่าไฟล์ `.ics` ที่อัปโหลดใช้อ่านเฉพาะวันเวลา (และชื่อสั้นหากผู้ใช้เลือกแสดง) เพื่อสร้างเวลาไม่ว่างของบัญชีนั้น ไม่เก็บไฟล์ต้นฉบับ และไม่เก็บรายละเอียด/รายชื่อผู้ร่วมประชุมจากไฟล์ | ข้อความ TH/EN ตรงกับการทำงานจริง |

---

## 4. เทสต์, ตรวจอิสระ และเอกสาร (`test` · `ops` · `secretary` · `qa` · `security`)
- **เทสต์ที่มาพร้อมโค้ด:**
  - Unit (`tests/calendar/ics-import.test.ts`): RFC 5545 unfolding/unescape, 4 รูปแบบเวลา, ปัด 30 นาที, กรอง `TRANSP`/`STATUS`/ช่วงวัน/`RRULE`, ตัดชื่อ 80 ตัวอักษร, ReDoS/ขนาดใหญ่
  - Integration (`tests/busy/ics-import-api.test.ts`): สิทธิ์ทุกบทบาท (`authorize`), กันซ้ำ, แข่งกันชนเพดาน 300, ไฟล์เกิน 512 KB, rate limit 429, `hideDetail` ไม่รั่วชื่อในปฏิทินกลุ่ม
  - E2E (`tests/e2e/ics-import.spec.ts`): 375/390/768 × TH/EN × สว่าง/มืด — อัปโหลดไฟล์ตัวอย่าง → เห็น preview + รายการที่ข้าม → ยืนยันนำเข้า → เห็นในปฏิทินของฉัน → อัปโหลดซ้ำเห็นสถานะซ้ำ
- **ผู้ตรวจอิสระ (บังคับก่อน merge):**
  - `qa`: รายงาน `docs/reports/qa-ics-import.md`
  - **Claude Code `security` agent:** รายงาน `docs/reports/security-ics-import.md` (ตรวจ file upload parsing, ReDoS, memory/size cap, RBAC, privacy/hideDetail, data leakage, logging)
- **เอกสาร (DOCS_SYNC §2):** `ARCHITECTURE.md` (routes ใหม่), `OPERATIONS.md` (rate limit ใหม่), `CHANGELOG.md` (`[Unreleased]`), `docs/guides/quickstart-th.html`, `README.md`, `PRD.md`, `PROGRESS.md`, `HANDOFF.md`

---

## 5. agent ที่จะเรียกและลำดับงาน
- **ทีมงาน:** `architect` (ADR 0017, `ARCHITECTURE.md`) · `ux` (`docs/design/ICS_IMPORT.md`, `messages/*.json`) · `platform` (I1–I5, A2–A4) · `auth` (A2 RBAC, A5 rate limit) · `frontend` (U1–U3) · `test` (unit/integration/e2e) · `ops` (`OPERATIONS.md`, `CHANGELOG.md`) · `secretary` (`README.md`, `quickstart-th.html`, `PROGRESS.md`, `HANDOFF.md`, รายงานวัน)
- **ผู้ตรวจอิสระ:** `qa` + **Claude Code `security` agent**
- **ลำดับ:**
  1. `architect` เขียน ADR 0017 + `ux` เขียน `docs/design/ICS_IMPORT.md` และคีย์ข้อความ
  2. `platform` + `auth` ทำ parser (`ics-import.ts`), API preview/import, rate limit และ unit/integration tests
  3. `frontend` ทำหน้า Import Sheet + `/privacy` + `test` ทำ E2E 3 viewport × 2 ภาษา × 2 ธีม
  4. `ops` + `secretary` อัปเดตเอกสารตาม DOCS_SYNC
  5. `qa` + `security` ตรวจอิสระ → แก้ข้อพบ (ถ้ามี) → เปิด PR → boss merge → ออกรุ่น **v1.1.0** (ไม่มี migration)

---

## 6. คำตัดสินของ boss (บันทึก 2026-11-23)
- **B1 นัดซ้ำ (`RRULE`):** **(ก) ข้ามรายการที่มี `RRULE`** แล้วสรุปจำนวนในหน้า preview พร้อมแนะนำให้ตั้ง "แบบประจำ" (Busy Routine) ในแอปแทน
- **B2 ช่วงวันล่วงหน้าที่นำเข้า:** **(ก) ดีฟอลต์ 90 วันข้างหน้า** (สลับเลือก 30 / 60 / 90 / 180 วัน ได้ในหน้า preview · ย้อนหลังไม่เกิน 7 วันตาม `BUSY_MAX_BACKDATE_DAYS`)
- **B3 ค่าเริ่มต้น "ซ่อนรายละเอียด (`hideDetail`)":** **(ก) เปิดซ่อนรายละเอียดเป็นค่าเริ่มต้น** สำหรับทุกรายการที่นำเข้า (ผู้ใช้กดเปิดแสดงเองได้ในหน้า preview)
- **B4 กลไกกันซ้ำ (Schema / Migration):** **(ก) ไม่มี migration** — เทียบเวลาตรงกันเป๊ะ (`allDay`, `startAt`, `endAt`, `localStartDate`, `localEndDate`) กับ `busy_block` เดิมของเจ้าตัวแล้วแจ้งว่าซ้ำใน preview

---

## 7. แก้ข้อพบ security M1 (boss เห็นชอบ 2026-11-24)
ที่มา: `docs/reports/security-ics-import.md` ข้อ 🟡 M1 — cache `validTz` ใน `src/lib/calendar/zone.ts` เก็บทั้งผลถูกและผิดโดยไม่มีเพดาน ไฟล์ `.ics` ป้อน TZID ใหม่ได้ ~1,000 ค่าต่อคำขอ → หน่วยความจำโตข้ามคำขอ (ขัด A3)

| # | ข้อกำหนด | เกณฑ์ผ่าน |
|---|---|---|
| S1 | `zone.ts` ห้ามให้ cache โตไม่จำกัดจากอินพุตผู้ใช้: cache เฉพาะผลที่ **ถูกต้อง** (ชุด IANA มีจำกัด) ผลที่ผิดไม่เก็บ · ไม่เปลี่ยน API/พฤติกรรมของ `isValidTimeZone` สำหรับผู้เรียกเดิม | เทสต์: เรียกด้วยสตริงผิดไม่ซ้ำ N ค่า → ขนาด cache ไม่โต · ผลถูก/ผิดเหมือนเดิม |
| S2 | `ics-import.ts` (`resolveIcsTimeZone`) ปฏิเสธ/ถือว่าไม่รู้จัก TZID ที่ยาวเกิน 64 ตัวอักษร หรือมีอักขระนอกชุดที่ IANA/Windows ใช้ **ก่อน** เรียก `isValidTimeZone` แล้วทำตามนโยบาย TZID ไม่รู้จักเดิมใน ADR 0017 | เทสต์: TZID ยาว/อักขระแปลก → ไม่เรียก validator, ผลเหมือน TZID ไม่รู้จัก · TZID IANA และ Windows เดิมยังผ่าน |

- **ผู้ทำ:** `platform` (ไฟล์: `src/lib/calendar/zone.ts`, `src/lib/calendar/ics-import.ts`, `tests/calendar/**`) · ไม่มี migration/env ใหม่
- **ผู้ตรวจ:** `security` ตรวจซ้ำเฉพาะ M1 แล้วอัปเดตรายงานเดิม
