# V1_2_CONTRACT.md — อัปเกรดนำเข้า `.ics` (`RRULE` + เก็บตก) และตัดงาน manual หลังออกรุ่น (v1.2.0)

> ผู้เขียน: main (Antigravity · Gemini 4 Neon) · 2026-11-25 · สถานะ: **boss เห็นชอบแล้ว** (2026-11-25)
> branch งาน: `feat/v1.2-ics-rrule` จาก `main` (`fcbccd6`) · **1 PR เดียว · ไม่มี migration · ไม่มี env ใหม่** · ใช้คู่กับ [DOCS_SYNC_CONTRACT.md](DOCS_SYNC_CONTRACT.md)
> ระดับงาน: **ระดับ B (เสี่ยง)** — แตะ `src/lib/calendar/ics-import.ts`, `src/app/api/_lib/route.ts` · **บังคับผ่าน QA อิสระ (แชตใหม่) + Claude Code `security` agent 1 ครั้งก่อน boss merge** · เลขรุ่นที่เสนอ: **v1.2.0** (MINOR — ความสามารถใหม่ไม่ breaking ตาม `docs/VERSIONING.md`)

---

## 0. เป้าหมายของรอบนี้
1. ทำให้นำเข้าไฟล์ `.ics` ใช้งานจริงได้กับตารางประจำจาก Google Calendar, Apple Calendar และ Outlook ด้วยการรองรับ `RRULE` (`DAILY` / `WEEKLY` / `MONTHLY`), `EXDATE`, และ `RECURRENCE-ID` โดยยังคุมเพดานความปลอดภัยและไม่มี migration
2. ปิดข้อสังเกต 🟢 จากรอบ v1.1.0 ไปพร้อมกัน: ตรวจ `END:VCALENDAR` (QA #6) และตรวจ session/ด่านบัญชีก่อนอ่าน body ขนาดใหญ่ > 64 KB ใน `route.ts` (Security L1)
3. ลดขั้นตอน manual ยิบย่อยหลังออกรุ่นถาวร: ให้ `scripts/release.ts` ขยับเลขรุ่นเอกสารครบทั้ง 5 ไฟล์ใน commit release เดียว และยกเลิกการเปิด PR เอกสารตามหลัง release รวมถึงยกเลิกการให้ boss คอยเช็ค/เปิด PR จด `/api/health`
4. ล้าง branch เก่าที่ merge เข้า `main` แล้ว (53 local + 53 remote — ไม่แตะ `main` และไม่แตะ `docs/public-scan` ที่ยังไม่ merge)

---

## 1. อัปเกรด `.ics` import รองรับ `RRULE` / `EXDATE` / `RECURRENCE-ID` (`platform` · `ux` · `test`)

| # | ข้อกำหนด | เกณฑ์รับ |
|---|---|---|
| R1 | **ขยาย `RRULE` ใน pure parser (`src/lib/calendar/ics-import.ts`):** รองรับ `FREQ=DAILY \| WEEKLY \| MONTHLY` พร้อม `INTERVAL` (`DAILY` ≤ 366, `WEEKLY` ≤ 52, `MONTHLY` ≤ 12), `BYDAY` (plain `MO..SU` สำหรับ `WEEKLY`, ordinal `[+-]?[1-5](MO..SU)` หรือ plain `MO..SU` สำหรับ `MONTHLY`), `BYMONTHDAY` (`1..31` หรือ `-31..-1` สำหรับ `MONTHLY`), `WKST` (`MO..SU`, ดีฟอลต์ `MO`), `COUNT` (`1..10000`), `UNTIL` · แตกเป็นรายการเดี่ยวในช่วง `[วันนี้ - 7 วัน, วันนี้ + windowDays]` · คงเวลาท้องถิ่น (wall-clock) ใน `TZID` ของเหตุการณ์ข้าม DST · ทุกรายการผ่าน outward rounding 30 นาที + `normalizeBusyInput` + dedupe + `hideDetail = true` เดิมทั้งหมด | เทสต์ครบ `DAILY`, `WEEKLY`, `MONTHLY` (รวมวันที่ 31 ที่บางเดือนไม่มี, `-1FR`, `BYMONTHDAY=-1`), all-day หลายวัน, ข้าม DST (`America/New_York`), ปัด 30 นาที, และ integration preview → confirm → dedupe → hideDetail |
| R2 | **รองรับ `EXDATE` และ `RECURRENCE-ID`:** อ่าน `EXDATE` (ได้หลายบรรทัด/คั่นด้วย `,`, สูงสุด 200 ค่า/VEVENT, รองรับ `VALUE=DATE`/UTC/`TZID`/floating) · อ่าน `UID` + `RECURRENCE-ID` เพื่อตัด instance เดิมออกจาก master `RRULE` เมื่อถูกเลื่อนเวลาหรือยกเลิก (ไม่ว่า override อยู่ก่อนหรือหลัง master) · **`UID` ใช้จับคู่เฉพาะในหน่วยความจำระหว่าง parse เท่านั้น ห้ามส่งออก API/เก็บ DB/log** | เทสต์ `EXDATE` (single/multi/comma/VALUE=DATE บน timed), `RECURRENCE-ID` (ย้ายเวลา + ยกเลิก + อยู่ก่อน master) และตรวจว่า `UID` ไม่ปรากฏใน DTO/DB/console |
| R3 | **การข้าม `RRULE` ซับซ้อนและข้อความ 2 ภาษา (`ux`):** กฎที่อยู่นอกขอบเขต (`YEARLY`/รายชั่วโมง/`BYSETPOS`/`BYYEARDAY`/`BYWEEKNO`/`BYMONTH`/`BYHOUR`/`BYMINUTE`/`BYSECOND`, มีทั้ง `COUNT` และ `UNTIL`, `RRULE` > 512 ตัว, `EXDATE` > 200, รูปแบบผิด, หรือเกินงบ step) → ข้ามลง `skipped.rrule` · นัดซ้ำที่จบก่อนช่วง 7 วัน → `skipped.past` · นัดซ้ำที่เริ่มหลังช่วง `windowDays` → `skipped.tooFarAhead` · ปรับข้อความ `busy.import.skipped.rrule` (TH/EN) และ `docs/design/ICS_IMPORT.md` ให้สื่อว่าเป็น "นัดซ้ำแบบซับซ้อน" | `tests/i18n/messages.test.ts`, `no-hardcoded-text.test.ts`, `render.test.ts` ผ่าน · E2E แสดงทั้งรายการที่แตกจาก `RRULE` และ `ics-skip-rrule` ของนัดซ้ำแบบซับซ้อนครบ 375/390/768 × TH/EN × สว่าง/มืด |
| R4 | **เพดานกัน DoS (CPU / Memory):** ใช้ O(1) fast-forward ข้ามช่วงอดีต (`DAILY`/`WEEKLY`/`MONTHLY`), จำกัด step สูงสุดต่อ VEVENT (`2,000`), จำกัดรายการที่แตกออกต่อ VEVENT (`ICS_IMPORT_MAX_OCCURRENCES_PER_EVENT = 200`), จำกัดรายการที่ส่งออกรวมทั้งไฟล์ (`ICS_IMPORT_MAX_EXPANDED_ITEMS = 500` — เกินคืน `TOO_LARGE { limit: 'events', max: 500 }` → `413 ICS_TOO_LARGE`) · ไม่มี backtracking regex | เทสต์ `DTSTART:1990` + `FREQ=DAILY` และ `FREQ=WEEKLY;COUNT=5000` จบใน < 50ms · เทสต์แตกเกิน 500 รายการคืน `TOO_LARGE` ทันทีไม่สะสมหน่วยความจำ |

---

## 2. เก็บตกความปลอดภัยและคุณภาพจากรอบ ICS (`platform` · `architect` · `test`)

| # | ข้อกำหนด | เกณฑ์รับ |
|---|---|---|
| H1 | **บังคับ `END:VCALENDAR` (QA #6):** `parseIcsToBusy` ต้องเห็น `BEGIN:VCALENDAR` และ `END:VCALENDAR` ปิดครบ และไม่มี `VEVENT` ค้างเปิดตอนจบไฟล์ มิฉะนั้นคืน `{ ok: false, error: 'INVALID', reason: 'NOT_ICS' }` (`400 ICS_INVALID`) | เทสต์ไฟล์ขาด `END:VCALENDAR` และไฟล์ที่ `VEVENT` ไม่ปิด → `INVALID NOT_ICS` / `400 ICS_INVALID` |
| H2 | **ตรวจ actor + ด่านบัญชีก่อนอ่าน body > 64 KB (Security L1):** ใน `src/app/api/_lib/route.ts` สำหรับ route non-GET ที่ `auth === 'actor'`, `action` ไม่ใช่สาธารณะ (`!isPublicAction`), และ `spec.maxBodyBytes > MAX_BODY_BYTES` ให้เรียก `resolveActor(req)` และตรวจด่านบัญชี (`AUTH_REQUIRED` 401 · `ACCOUNT_SUSPENDED` 401 · `PIN_CHANGE_REQUIRED` 403 · `FORBIDDEN` 403 สำหรับ SA-only) **ก่อน** `readJsonBody` พร้อมยกเลิก `req.body` เมื่อถูกปฏิเสธ · ไม่เรียก `resolveActor` ซ้ำในคำขอเดียวกัน · service ยังคงเรียก `authorize()` บรรทัดแรกตามเดิม | เทสต์ anonymous / suspended / `must_change_pin` ส่ง body ใหญ่เกิน 768 KB หรือ JSON พังไปยัง `POST /api/me/busy/import/preview` → ได้ `401 AUTH_REQUIRED` / `401 ACCOUNT_SUSPENDED` / `403 PIN_CHANGE_REQUIRED` โดยไม่อ่าน body · `tests/auth/must-change-pin.test.ts` และ `tests/security/authorize-first.test.ts` ผ่าน |

---

## 3. ตัดงาน manual หลังออกรุ่นถาวร (`main` · `ops` · `secretary` · `test`)

| # | ข้อกำหนด | เกณฑ์รับ |
|---|---|---|
| O1 | **`scripts/release.ts` ขยับเลขรุ่นครบ 5 ไฟล์เอกสาร:** เพิ่ม `README.md` (บรรทัด `**สถานะ:**`) และ `docs/team/HANDOFF.md` (บรรทัด `เวอร์ชันล่าสุดที่ออกแล้ว`) เข้า `DOC_VERSION_TARGETS` ร่วมกับ `docs/guides/quickstart-th.html`, `docs/prd/PRD.md`, `docs/team/PROGRESS.md` และอัปเดต `tests/ops/docs-sync.test.ts` + `tests/release/release.test.ts` | `tests/ops/docs-sync.test.ts` ตรวจครบ 5 ไฟล์ + CHANGELOG · `tests/release/release.test.ts` (ส่วน unit/repo) ยืนยันว่า 1 commit release ขยับครบทั้ง 5 ไฟล์และผ่านเงื่อนไข docs-sync ทันที |
| O2 | **ยกเลิก PR เอกสารตามหลัง release และ PR จด `/api/health`:** อัปเดต `docs/contracts/DOCS_SYNC_CONTRACT.md`, `AGENTS.md`, `docs/VERSIONING.md`, `docs/OPERATIONS.md`, `docs/team/HANDOFF.md`, `docs/team/PROGRESS.md` ให้เอกสาร §2 จบใน PR งานหลัก และเลขรุ่นจบใน `scripts/release.ts` · `/api/health` ปล่อยให้ `keepalive.yml` ตรวจอัตโนมัติ ไม่ต้องเปิด PR จด | เอกสารทุกไฟล์ตรงกัน ไม่ขัดแย้ง และ `tests/ops/docs-sync.test.ts` + `tests/ops/operations-doc.test.ts` ผ่าน |

---

## 4. ขอบเขตบทบาทและการมอบหมายพิเศษ
- **`main`:** `docs/contracts/V1_2_CONTRACT.md`, `docs/contracts/DOCS_SYNC_CONTRACT.md`, `docs/prd/PRD.md`, `AGENTS.md` (มอบหมายตามกติกาไฟล์นอกตาราง) + ล้าง branch เก่าที่ merge แล้ว
- **`architect`:** `docs/adr/0017-ics-import.md` (ภาคผนวก v1.2.0), `docs/design/ARCHITECTURE.md` (ข้อ 2 request flow + สถานะ v1.1.1/v1.2.0)
- **`ux`:** `docs/design/ICS_IMPORT.md`, เนื้อหา `messages/th.json` และ `messages/en.json`
- **`platform`:** `src/lib/calendar/ics-import.ts`, `src/lib/calendar/index.ts`, `src/app/api/_lib/route.ts`, `tests/calendar/ics-import.test.ts`
- **`ops`:** `scripts/release.ts`, `CHANGELOG.md` (`[Unreleased]`), `docs/VERSIONING.md`, `docs/OPERATIONS.md`
- **`test`:** `tests/busy/ics-import-api.test.ts`, `tests/e2e/ics-import.spec.ts`, `tests/ops/docs-sync.test.ts`, `tests/release/release.test.ts`
- **`secretary`:** `README.md`, `docs/guides/quickstart-th.html`, `docs/team/HANDOFF.md`, `docs/team/PROGRESS.md`, `docs/NEXT_PHASE.md`, `docs/reports/2026-11-25.md`
- **ผู้ตรวจอิสระ (หลังเปิด PR · ก่อน boss merge):** `qa` (แชตใหม่คนละโมเดลตาม `AGENTS.md` §6) + **Claude Code `security` agent** (`docs/reports/security-v1.2.md`)
