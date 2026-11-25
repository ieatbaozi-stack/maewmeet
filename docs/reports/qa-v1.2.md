# QA `feat/v1.2-ics-rrule` — อัปเกรด `.ics` (`RRULE` + `EXDATE` + `RECURRENCE-ID`), เก็บตก v1.1.0 และตัดงาน manual หลังออกรุ่น (v1.2.0)

> ผู้ตรวจ: `qa` (อิสระ · แชตใหม่) · Antigravity · **Gemini 4 Hydrogen** *(คนละโมเดลกับผู้ทำซึ่งใช้ Gemini 4 Neon ตาม `AGENTS.md` §6)* · branch `feat/v1.2-ics-rrule` HEAD `0e25452` (ฐาน PR #54 เทียบ `origin/main` `fcbccd6` · 27 ไฟล์, +1,372 / −186) · ตรวจ 2026-11-25
> ระดับงาน: **ระดับ B (เสี่ยง)** — แตะ `src/lib/calendar/ics-import.ts` และ `src/app/api/_lib/route.ts` · **ยังคงต้องผ่าน Claude Code `security` agent (`docs/reports/security-v1.2.md`) 1 ครั้งก่อน boss merge**

## Verdict: ผ่าน (สำหรับ QA — รอ Claude Code `security` agent ตามกติการะดับ B)
ตรวจโค้ด `git diff origin/main...HEAD` ครบทุกไฟล์ รันเกตและเทสต์ซ้ำเองทั้งหมด พร้อมตรวจภาพหน้าจอจริง 4 ชุด (375/390/768 × TH/EN × สว่าง/มืด) และไล่เช็กลิสต์ความปลอดภัยเบื้องต้นตาม `.claude/agents/security.md` — **ไม่พบ 🔴 Blocker และไม่พบ 🟡 ควรแก้** · มีเพียง **5 🟢 ข้อสังเกตเล็ก/ข้อมูล** (ไม่บล็อก QA)

> **หมายเหตุเรื่องขอบเขต:** ณ เวลาตรวจ Claude Code ติด rate limit จึงดำเนินการตรวจส่วน `qa` บน Antigravity (Gemini 4 Hydrogen) ก่อนตามที่ boss แจ้ง · รายงานนี้**ไม่แทน** `docs/reports/security-v1.2.md` จาก Claude Code `security` agent (เว้นแต่ boss จะตัดสินใจยกเว้นเป็นกรณีพิเศษ)

---

## ข้อพบ (เรียงตามความรุนแรง)

- 🔴 **Blocker:** ไม่มี
- 🟡 **ควรแก้:** ไม่มี
- 🟢 **ข้อสังเกต / ข้อมูล (ไม่บังคับ):**
  1. `scripts/release.ts:7`: คอมเมนต์หัวไฟล์ยังระบุ `quickstart/PRD/PROGRESS` (3 ไฟล์) ขณะที่ `DOC_VERSION_TARGETS` (`scripts/release.ts:224-230`) และโค้ดจริงอัปเดตครบ 5 ไฟล์ (`quickstart-th.html`, `PRD.md`, `PROGRESS.md`, `README.md`, `HANDOFF.md`) แล้ว — ไม่กระทบการทำงาน (`--dry-run` และ `release.test.ts` ผ่าน)
  2. `tests/busy/ics-import-api.test.ts:402-407`: เทสต์ H2 ส่ง `{}` (ทดสอบการข้ามขั้น zod validation) แต่ยังไม่มีเคสใน suite ที่ส่ง raw string ไม่ใช่ JSON (`"{broken"`) เพื่อทดสอบการข้าม `JSON.parse` โดยตรง · qa ยืนยันพฤติกรรมจริงในสคริปต์อิสระ (`ReadableStream` ส่ง `"{broken-json"` → ถูกยกเลิกและคืน `401`/`403` ก่อนอ่าน/parse body) แล้ว
  3. `src/lib/calendar/ics-import.ts:613`: `parseRrule` เรียก `parseDateTimeToken({ value: kv.UNTIL, params: {} }, defaultTz)` — หากไฟล์นอกมาตรฐาน RFC 5545 ใส่ `DTSTART;TZID=America/New_York:...` คู่กับ `UNTIL` แบบ floating ไม่มี `Z` จะตีความ `UNTIL` ตาม `defaultTz` (`Asia/Bangkok`) แทน `eventTz` · กรณีตามมาตรฐาน RFC 5545 (`UNTIL=...Z` หรือ `VALUE=DATE`) ถูกต้องครบถ้วน
  4. `src/lib/calendar/ics-import.ts:720`: `addExclusion` เก็บ `parsed.plainDateTime.toPlainDate()` ลง `dateFromDateTime` โดยไม่ได้ฉายผ่าน `defaultTz` — กรณีตามมาตรฐาน (`EXDATE;VALUE=DATE:...` บน all-day หรือ `EXDATE` datetime บน timed) ทำงานถูกต้องทั้งหมด
  5. **เกตระดับ B (`AGENTS.md` §3 · `V1_2_CONTRACT.md` §4):** ยังต้องรัน Claude Code `security` agent 1 ครั้งเพื่อออก `docs/reports/security-v1.2.md` ก่อน boss merge (และรอ CI `e2e (Playwright) (3)–(4)` ที่ยัง pending ตอนตรวจให้ครบ)

---

## ตรวจตามข้อ contract (`V1_2_CONTRACT.md`)

| ข้อ | ผล | หลักฐานที่ตรวจจริง |
|---|---|---|
| R1 (ขยาย `RRULE`: `DAILY` / `WEEKLY` / `MONTHLY`, `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `WKST`, `COUNT`, `UNTIL`, wall-clock ข้าม DST, outward rounding 30 นาที, `normalizeBusyInput`, dedupe, `hideDetail = true`) | **ผ่าน** | ตรวจ `src/lib/calendar/ics-import.ts:535-1181` ครบทุกสาขา (`DAILY` / `WEEKLY` / `MONTHLY`, วันที่ 31 ข้ามเดือนที่ไม่มี, `-1FR`, `BYMONTHDAY=-1`, `WKST=SU`, `America/New_York` DST, multi-day all-day) · `tests/calendar/ics-import.test.ts` และ `tests/busy/ics-import-api.test.ts` ผ่านทั้งหมด |
| R2 (`EXDATE` + `RECURRENCE-ID` + `UID` เฉพาะในหน่วยความจำ) | **ผ่าน** | `parseExdates` (`:724-739`, ≤ 200 ค่า/VEVENT, รองรับหลายบรรทัด/คอมมา/`VALUE=DATE`/UTC/`TZID`/floating) · เฟส 2 (`:1332-1349`) จับคู่ `RECURRENCE-ID` ต่อ `UID` ไม่ว่า override อยู่ก่อนหรือหลัง master (รวม `STATUS:CANCELLED` และ `TRANSP:TRANSPARENT`) · ตรวจแล้วว่า `UID` ไม่อยู่ใน `ParsedIcsBusyItem`, DTO, DB และ log |
| R3 (ข้าม `RRULE` ซับซ้อนลง `skipped.rrule` + ข้อความ TH/EN + `ICS_IMPORT.md`) | **ผ่าน** | นอกขอบเขต (`YEARLY`/รายชั่วโมง/`BYSETPOS`/`BYYEARDAY`/`BYWEEKNO`/`BYMONTH`/`BYHOUR`/`BYMINUTE`/`BYSECOND`, `COUNT`+`UNTIL`, `RRULE` > 512, `EXDATE` > 200, multi-`RRULE`, `RRULE`+`RECURRENCE-ID`, เกิน `2,000` steps) → `skipped.rrule` · แยก `past` / `tooFarAhead` (`:1177-1180`) · `messages/{th,en}.json` (`"นัดซ้ำแบบซับซ้อน"` / `"complex recurring event"`) + `docs/design/ICS_IMPORT.md` ตรงกัน · `tests/i18n/*` และ E2E `ics-import.spec.ts` ผ่าน |
| R4 (เพดานกัน DoS: O(1) fast-forward, ≤ 2,000 steps, ≤ 200/VEVENT, ≤ 500/ไฟล์, ไม่มี backtracking regex) | **ผ่าน** | `startK`/`startW`/`startM` fast-forward O(1) · `MAX_RRULE_STEPS = 2_000`, `ICS_IMPORT_MAX_OCCURRENCES_PER_EVENT = 200`, `ICS_IMPORT_MAX_EXPANDED_ITEMS = 500` → `TOO_LARGE { limit: 'events', max: 500 }` (`413 ICS_TOO_LARGE`) · วัดซ้ำเอง `DTSTART:19900101` DAILY + `DTSTART:19950102` WEEKLY `COUNT=5000`: median **1.07ms**, max **2.43ms** (`< 50ms`) · 400 KB RRULE: **1.47ms** |
| H1 (บังคับ `END:VCALENDAR` และ `END:VEVENT` ปิดครบ) | **ผ่าน** | `ics-import.ts:1328-1330`: `!seenCalendar \|\| !seenEndCalendar \|\| inCalendar \|\| inEvent` → `INVALID NOT_ICS` (`400 ICS_INVALID`) · ทดสอบทั้งไฟล์ขาด `END:VCALENDAR`, `VEVENT` ไม่ปิด, `VTIMEZONE` ไม่ปิด, และ `VCALENDAR` ชุดที่ 2 ไม่ปิด ผ่านหมด |
| H2 (`route.ts` ตรวจ actor + ด่านบัญชีก่อนอ่าน body > 64 KB) | **ผ่าน** | `src/app/api/_lib/route.ts:284-314` ตรวจตรงตามลำดับใน `src/lib/rbac/can.ts` (`AUTH_REQUIRED` 401 / `ACCOUNT_SUSPENDED` 401 / `PIN_CHANGE_REQUIRED` 403 / `FORBIDDEN` 403), ยกเลิก `req.body` ด้วย `cancel()` ทุกทางปฏิเสธ, และ reuse `preResolvedActor` ที่ `:333` ไม่เรียก `resolveActor` ซ้ำ · service ยังเรียก `authorize()` บรรทัดแรกตามเดิม (`authorize-first.test.ts` + `must-change-pin.test.ts` + `ics-import-api.test.ts` + `verify-v12.ts` ผ่าน) |
| O1 (`scripts/release.ts` ขยับเลขรุ่นครบ 5 ไฟล์เอกสาร) | **ผ่าน** | `DOC_VERSION_TARGETS` ครบ 5 ไฟล์ (`quickstart-th.html`, `PRD.md`, `PROGRESS.md`, `README.md`, `HANDOFF.md`) · `docs-sync.test.ts` ตรวจครบทั้ง 5 ไฟล์ + `CHANGELOG.md` · `release.test.ts` (32 non-CLI) ผ่าน · `npx tsx scripts/release.ts 1.2.0 --dry-run` พบตำแหน่งและสร้าง diff ตรงทุกไฟล์ |
| O2 (ยกเลิก PR เอกสารตามหลัง release และ PR จด `/api/health`) | **ผ่าน** | `DOCS_SYNC_CONTRACT.md`, `AGENTS.md`, `docs/VERSIONING.md`, `docs/OPERATIONS.md`, `docs/team/HANDOFF.md`, `docs/team/PROGRESS.md` สอดคล้องกันทั้งชุด ไม่มีข้อขัดแย้ง · `docs-sync.test.ts` และ `operations-doc.test.ts` ผ่าน |

---

## Code review (9 ข้อ ตาม `.claude/agents/qa.md`)

| ข้อ | ผล | หมายเหตุ |
|---|---|---|
| 1. ตรง contract / ขอบเขตบทบาท | ผ่าน | แยก 7 commits ตามบทบาท (`main`, `architect`, `platform`, `ux`, `ops`, `test`, `secretary`) ตรง `V1_2_CONTRACT` §4 และ `AGENTS.md` §4 · อีเมล noreply และ conventional commit ครบทุกตัว |
| 2. ถูกจริง / edge cases | ผ่าน | ไล่ตรรกะ `MONTHLY` (วันไม่มีในเดือน, ordinal ลบ, `COUNT` จากอดีต), `WEEKLY` (`WKST=SU`), `EXDATE`/`RECURRENCE-ID` ทั้งก่อน/หลัง master, และ `preAuthLargeBody` ใน `route.ts` ครบ (ข้อสังเกตเล็ก 🟢 3–4 ไม่กระทบการใช้งานปกติ) |
| 3. สถาปัตยกรรม | ผ่าน | `ics-import.ts` ยังคง pure (ใช้เฉพาะ `temporal-polyfill` และ `./*`) · `route.ts` reuse `isPublicAction`, `isPinChangeAllowed`, `isSuperAdminOnly` จาก `src/lib/rbac/actions.ts` ไม่ซ้ำตรรกะ |
| 4. คุณภาพโค้ด | ผ่าน | ชื่อตัวแปรและ type ชัด ไม่มี `any` ไม่มีโค้ดตาย/TODO ค้าง · `kv` ใน `parseRrule` ใช้ `Object.create(null)` กัน prototype pollution |
| 5. คุณภาพเทสต์ | ผ่าน | Unit + Integration + E2E + `docs-sync` + `release` ครอบคลุมเกณฑ์ (ข้อสังเกต 🟢 2 เรื่องเพิ่มเคส raw malformed JSON ลงใน integration suite) |
| 6. กฎเหล็ก | ผ่าน | สิทธิ์ตรวจฝั่งเซิร์ฟเวอร์ + `authorize()` บรรทัดแรก · ไม่มีความลับ/log payload/`UID` · ไม่มี migration · ใช้ `src/lib/calendar` · ไม่ hard-code ข้อความ UI · ผ่าน `check-style-literals.sh` และ `contrast.mjs` |
| 7. ประสิทธิภาพ | ผ่าน | Single-pass scanner + O(1) fast-forward (`median 1.07ms` สำหรับปี 1990) + ไม่มี backtracking regex + ยกเลิก body stream เมื่อถูกปฏิเสธที่ด่านบัญชี |
| 8. เอกสาร (DOCS_SYNC) | ผ่าน | อัปเดตครบทุกแถวที่เกี่ยว (`README.md`, `quickstart-th.html`, `CHANGELOG.md`, `ICS_IMPORT.md`, `ARCHITECTURE.md`, `OPERATIONS.md`, `VERSIONING.md`, `0017-ics-import.md`, `DOCS_SYNC_CONTRACT.md`, `AGENTS.md`, `PRD.md`, `PROGRESS.md`, `HANDOFF.md`, `NEXT_PHASE.md`, `2026-11-25.md`) · `docs-sync.test.ts` และ `operations-doc.test.ts` ผ่าน |
| 9. ความปลอดภัยเบื้องต้น (`.claude/agents/security.md`) | ผ่านเบื้องต้น (รอ `security` agent) | ไล่เช็กตาม `security.md`: ไม่รับ URL/SSRF, ลิมิตขนาด/บรรทัด/VEVENT/occurrences/expanded items, ไม่มี ReDoS, `Object.create(null)`, `UID` อยู่ในหน่วยความจำเท่านั้นไม่เข้า DB/DTO/log, `hideDetail` ดีฟอลต์ `true`, `route.ts` ตรวจ actor+ด่านบัญชีก่อนอ่าน body > 64 KB และยกเลิก stream + `Cache-Control: private, no-store` ทุก response · **ยังคงต้องให้ Claude Code `security` agent ตรวจและออก `docs/reports/security-v1.2.md`** |

---

## Anti-slop checklist (`UI_DIRECTION.md` §8) — ตรวจจากภาพหน้าจอจริง

ถ่ายภาพและวัด DOM จริงบน production build (`next start`) ที่ **375×812 (TH light, EN dark)**, **390×844 (EN light)**, **768×1024 (TH dark)** พร้อมไฟล์ `.ics` ที่แตก `RRULE` + `EXDATE` + `RECURRENCE-ID` และข้าม `FREQ=YEARLY` เป็น "นัดซ้ำแบบซับซ้อน":
- **ไม่พบ horizontal scroll:** `scrollWidth === clientWidth` ครบทั้ง 4 ชุด (375, 390, 768)
- **เป้าแตะ ≥ 44px:** ตรวจทุก `button`, `summary`, `label.ics-item-label` ใน sheet — `small: []` (ไม่มีตัวใด < 44px)
- **Token & คอนทราสต์:** `check-style-literals.sh src` ผ่าน · `contrast.mjs` ผ่าน 338/338 คู่ (ต่ำสุด 4.54:1)
- **ข้อความและหน้าตา:** ข้อความ `"นัดซ้ำแบบซับซ้อน 1 รายการ — แนะนำตั้ง “แบบประจำ” ในแอปแทน"` (TH) และ `"1 complex recurring event — try adding a Routine in the app instead"` (EN) อ่านเป็นธรรมชาติ, sentence case ถูกต้อง, Lucide icon เส้นเดียวสม่ำเสมอ, สวิตช์ "ซ่อนรายละเอียดจากคนในกลุ่ม" เปิดเริ่มต้นชัดเจน
- **คำตัดสินต่อหน้า:** `IcsImportSheet` ขั้น Preview (พร้อมรายการแตกจาก `RRULE`/`RECURRENCE-ID` และข้อความนัดซ้ำแบบซับซ้อน) — **เหมือนผลิตภัณฑ์จริง** ทั้ง 4 ชุด (TH/EN × สว่าง/มืด × 375/390/768)

---

## คำสั่งที่รันซ้ำเอง + ผลจริง (เครื่อง Windows, HEAD `0e25452`)

| คำสั่ง | ผลจริง |
|---|---|
| `npm run lint` (`eslint .`) | **ผ่าน** (exit 0) |
| `npx eslint tests/e2e/ics-import.spec.ts` | **ผ่าน** (exit 0) |
| `npm run typecheck` (`tsc --noEmit`) | **ผ่าน** (exit 0) |
| `npm run db:check` (`drizzle-kit check`) | **ผ่าน** (`Everything's fine`, exit 0) |
| `bash -c "tr -d '\r' < .github/scripts/check-style-literals.sh \| bash -s -- src"` | **ผ่าน** (`src: ไม่มีค่าสี hex / px นอก tokens`) |
| `bash -c "tr -d '\r' < .github/scripts/check-env-example.sh \| bash -s -- .env.example"` | **ผ่าน** (`.env.example: ไม่มีค่าลับ`) |
| `node docs/design/tools/contrast.mjs` | **ผ่าน** (338 คู่ · ไม่ผ่าน 0 · คู่ข้อความต่ำสุด 4.54:1) |
| `npm run build` (`next build`) | **ผ่าน** (51/51 pages · exit 0) |
| `npx vitest run tests/calendar/ics-import.test.ts tests/calendar/ics-tzid-guard.test.ts tests/calendar/zone-cache.test.ts tests/busy/ tests/auth/must-change-pin.test.ts tests/security/authorize-first.test.ts tests/rbac/ tests/platform/ tests/i18n/ tests/ui/ics-import-model.test.ts tests/ops/docs-sync.test.ts tests/ops/operations-doc.test.ts --reporter=agent --testTimeout=60000` | **ผ่าน 61 ไฟล์ / 4,294 tests** (51.51s) |
| `npx vitest run tests/security/ --reporter=agent --testTimeout=60000` | **ผ่าน 9 ไฟล์ / 407 passed, 1 skipped** (23.31s) |
| `npx vitest run tests/release/release.test.ts -t "^((?!CLI).)*$" --reporter=agent --testTimeout=60000` | **ผ่าน 1 ไฟล์ / 32 passed, 2 skipped** (5.39s · ข้าม 2 CLI tests จาก `.bin/tsx` ENOENT บน Windows ตาม `AGENTS.md` §9) |
| `npx tsx scripts/release.ts 1.2.0 --dry-run` | พบตำแหน่งเลขรุ่นครบ 5 ไฟล์เอกสาร + diff ตรงทุกจุด (ติดเฉพาะ branch ≠ `main` ตามคาด · exit 1 · ไม่มีไฟล์ถูกแก้) |
| `$env:PW_CHROMIUM_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"; $env:E2E_PORT="3130"; npx playwright test tests/e2e/ics-import.spec.ts tests/e2e/privacy.spec.ts --reporter=line --workers=4` | **ผ่าน 24/24** (19.1s · 375/390/768 × TH/EN × light/dark) |
| สคริปต์ตรวจอิสระนอก repo (`verify-v12.ts` + `shoot-v12.mjs`) | latency R4 median **1.07ms** (max 2.43ms), 400KB RRULE **1.47ms**, unsupported RRULE/EXDATE/steps/H1/UID/H2 `ReadableStream` cancel & malformed JSON ผ่านครบ · ภาพหน้าจอ 4 ชุด 0 overflow · 0 control < 44px |

## สถานะ CI บน PR #54 (`gh pr checks 54`, HEAD `0e25452`, run `45498127437`)
- **ผ่านแล้ว ณ เวลาตรวจ:** `changes` ✔ · `lint` ✔ · `typecheck` ✔ · `test + migration` ✔ · `contrast` ✔ · `build` ✔ · `Vercel` ✔ · `Vercel Preview Comments` ✔ · `e2e (Playwright) (1)` ✔ · `e2e (Playwright) (2)` ✔
- **ยัง `pending` ณ เวลาตรวจ:** `e2e (Playwright) (3)` · `e2e (Playwright) (4)`

## สิ่งที่ตรวจไม่ได้
- ไม่ได้รัน `npm test` ทั้งชุดและ 2 CLI tests ของ `tests/release/release.test.ts` ในเครื่อง Windows (`AGENTS.md` §9 — อ้างอิงผล CI `test + migration` ✔ แทน)
- ไม่ได้รัน E2E นอกเหนือจาก `ics-import.spec.ts` และ `privacy.spec.ts` ในเครื่อง (รอผล CI `e2e (Playwright) (3)–(4)` ครบ)
- ไม่ได้ออกรายงานความปลอดภัยแทน Claude Code `security` agent — **ยังคงต้องให้ Claude Code `security` agent ตรวจและสร้าง `docs/reports/security-v1.2.md` ก่อน merge** (เว้นแต่ boss จะตัดสินใจอนุญาตกรณีพิเศษ)
