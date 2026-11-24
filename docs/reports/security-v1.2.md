# Security review — v1.2.0 อัปเกรดนำเข้า `.ics` (`RRULE` / `EXDATE` / `RECURRENCE-ID`), เก็บตก v1.1.0 และตัดงาน manual หลังออกรุ่น (`feat/v1.2-ics-rrule` · PR #54)

- ผู้ตรวจ: `security` (อิสระ · แชตใหม่ใน Antigravity · **Gemini 4 Carbon** — คนละโมเดลกับผู้ทำ `Gemini 4 Neon` และคนละโมเดลกับผู้ตรวจ QA `Gemini 4 Hydrogen` · **boss อนุญาตเป็นกรณีพิเศษชั่วคราว 2026-11-25** แทน Claude Code `security` agent)
- ขอบเขต: 2026-11-25 · branch `feat/v1.2-ics-rrule` HEAD `acb3e5d` (ฐาน `origin/main` `fcbccd6`) · ช่วง `git diff main...HEAD` · เทียบ [V1_2_CONTRACT](../contracts/V1_2_CONTRACT.md) (R1–R4, H1–H2, O1–O2), [ICS_IMPORT_CONTRACT](../contracts/ICS_IMPORT_CONTRACT.md), [ADR 0017](../adr/0017-ics-import.md) §6 และกฎเหล็ก `CLAUDE.md` ข้อ 6–9
- วิธี: อ่านโค้ดจริงทุกไฟล์ที่แตะและไฟล์ข้างเคียงที่เชื่อมกัน (`src/app/api/_lib/route.ts`, `src/app/api/_lib/actor.ts`, `src/lib/rbac/can.ts`, `src/lib/rbac/actions.ts`, `src/lib/auth/session.ts`, `src/lib/calendar/ics-import.ts`, `src/lib/calendar/zone.ts`, `src/lib/data/services/busy-import.ts`, `src/components/busy/IcsImportSheet.tsx`, `scripts/release.ts`) · เขียนสคริปต์จำลองอินพุตร้าย (adversarial CPU/memory/prototype/stream-cancel) นอก repo ใน scratch · รันเกตและเทสต์ซ้ำด้วยตัวเอง · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด · ❓ = ยืนยันไม่ได้
- ระดับ: 🔴 ร้ายแรง (ต้องแก้) · 🟡 กลาง · 🟢 ต่ำ/ข้อสังเกต

## สรุป
| ระดับ | จำนวน |
|---|---|
| 🔴 | 0 |
| 🟡 | 1 |
| 🟢 | 3 |

**Verdict รอบ 1 (HEAD `acb3e5d`): FAIL (ไม่ผ่าน)** — ติดประเด็นเดียวคือ **🟡 M1** (การขยาย `RRULE:FREQ=MONTHLY` ที่มี `COUNT` จากปี `1900` ไม่มีงบรวมระดับไฟล์และจัดสรร `Temporal.PlainDate` ทุกเดือนในอดีต → ไฟล์ `.ics` ขนาดเพียง **~62 KB** บล็อก Node.js event loop แบบ synchronous นาน **~10.4–12.3 วินาทีต่อคำขอ** ขัดเกณฑ์รับ `V1_2_CONTRACT` ข้อ R4 "เพดานกัน DoS (CPU / Memory)") · แก้ได้ในไม่กี่บรรทัดใน `src/lib/calendar/ics-import.ts` · ส่วนอื่นทั้งหมดผ่านครบและแข็งแรง: H2 (`preAuthLargeBody` + stream cancel), H1 (`END:VCALENDAR`), R1–R3, ความเป็นส่วนตัวของ `UID` (ไม่หลุดออก DTO/DB/log), `hideDetail` ดีฟอลต์ `true`, ไม่มี ReDoS, ไม่มี prototype pollution, ไม่มี memory leak ข้ามคำขอ (`0.00 MB`), RBAC/`authorize()` บรรทัดแรก และ `scripts/release.ts` ปลอดภัย · เมื่อ `platform` แก้ M1 แล้ว ส่งตรวจซ้ำเฉพาะจุด M1 ได้ทันที

---

## ข้อพบ

### 🟡 M1 — `RRULE:FREQ=MONTHLY` พร้อม `COUNT` จากปีอดีต (`1900`) ไม่มีเพดานรวมทั้งไฟล์และจัดสรร `Temporal.PlainDate` ทุกเดือน → ไฟล์ ~62 KB บล็อก CPU นาน ~10–12 วินาที/คำขอ
- **ที่:** `src/lib/calendar/ics-import.ts:30` (`MAX_RRULE_STEPS = 2_000`), `:412, :443` (`year >= 1900`), `:746-783` (`monthlyDatesInMonth`), `:869-897` (`expandRruleDates` สาขา `MONTHLY`), `:1363` (`for (const ev of rawEvents)`)
- **กลไกที่หลุดเพดาน:**
  1. `parseDateToken` / `parseDateTimeToken` (`:412, :443`) ยอมรับ `DTSTART` ตั้งแต่ปี `1900` (ห่างจากปัจจุบัน ~126 ปี ≈ 1,512 เดือน)
  2. ใน `expandRruleDates` สาขา `MONTHLY` (`:872`): เมื่อมี `COUNT` (`rule.count !== undefined`) จะตั้ง `startM = 0` (ไม่ทำ O(1) fast-forward ข้ามช่วงอดีต) เพื่อนับจำนวนครั้งตั้งแต่เดือนแรกของ `DTSTART`
  3. ในแต่ละเดือน `monthlyDatesInMonth` (`:746-783`) สร้างวัตถุ `Temporal.PlainDate.from({ year, month, day })` สูงสุดถึง **31 ตัวต่อเดือน** (เช่น `BYDAY=MO,TU,WE,TH,FR,SA,SU` หรือ `BYMONTHDAY=1..31`) แม้เดือนนั้นจะอยู่ก่อน `earliestStartDate` ที่ใช้เพียงนับ `emitted++`
  4. เพดาน `MAX_RRULE_STEPS = 2_000` (`:30`) ถูกจำกัดแยก **ต่อ 1 `VEVENT`** เท่านั้น **ไม่มีเพดาน step หรือจำนวนวันที่ประเมินรวมทั้งไฟล์**
  5. เมื่อไฟล์ขนาดเพียง **62,568 ไบต์ (~62 KB)** มี `500` `VEVENT` โดยแต่ละตัวใส่ `DTSTART;VALUE=DATE:19000101` + `RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=10000`:
     - แต่ละ `VEVENT` ใช้เพียง `329` steps (`< MAX_RRULE_STEPS = 2,000`) และครบ `COUNT=10000` ในปี ~1927 (ก่อน `earliestStartDate`) จึงคืน `dates: []` (0 รายการ → นับเป็น `skipped.past++`) ไม่ชน `ICS_IMPORT_MAX_OCCURRENCES_PER_EVENT = 200` และไม่ชน `ICS_IMPORT_MAX_EXPANDED_ITEMS = 500`
     - ลูป `for (const ev of rawEvents)` (`:1363`) จึงรันครบทั้ง `500` `VEVENT` สร้าง `Temporal.PlainDate` รวมกว่า **5,000,000 วัตถุในคำขอเดียว**
- **ทำซ้ำ (✅ รันจริงด้วยสคริปต์ทดสอบ `sec-fuzz-v12.ts`):**
  ```
  1. 500x MONTHLY BYDAY=MO..SU COUNT=10000 (1900)   (62,568 B): median=10,360.13 ms  max=11,111.07 ms -> ok items=0 skipped.past=500
  2. 500x MONTHLY BYMONTHDAY=1..31 COUNT=10000      (96,568 B): median=10,090.89 ms  max=12,270.84 ms -> ok items=0 skipped.past=500
  3. 500x MONTHLY BYDAY=-1MO..-1FR COUNT=7500       (64,068 B): median= 9,001.66 ms  max= 9,281.17 ms -> ok items=0 skipped.past=500
  4. 500x MONTHLY single-day COUNT=1500 (1900-2024) (48,568 B): median= 2,626.39 ms  max= 2,630.32 ms -> ok items=0 skipped.past=500
  ```
- **ผลกระทบ:** ต้องล็อกอินผ่านด่าน H2 ก่อน (จึงไม่ใช่ 🔴) แต่ผู้ใช้ที่ล็อกอิน 1 บัญชีมีโควตา `busy:import:preview` **20 ครั้ง / 10 นาที** → ส่งไฟล์ 62 KB คำขอเดียวบล็อก Node.js event loop แบบ synchronous นาน **> 10–12 วินาที** และ 20 คำขอบล็อก CPU ของ Vercel Fluid Compute instance รวม **> 200 วินาที** กระทบคำขอของผู้ใช้อื่นที่ใช้ instance เดียวกัน · ขัดเกณฑ์รับ `V1_2_CONTRACT` ข้อ R4 ("เพดานกัน DoS (CPU / Memory)")
- **ข้อเสนอการแก้ (เจ้าของ `platform` · แตะเฉพาะ `src/lib/calendar/ics-import.ts` + เทสต์ใน `tests/calendar/ics-import.test.ts`):**
  1. **กำหนดเพดานงบรวมระดับไฟล์** ใน `ParseCtx` (เช่น `maxTotalRruleSteps` ~ `4_000` และ/หรือนับจำนวนวันผู้สมัครที่ประเมินรวมทั้งไฟล์ `maxTotalEvaluatedDates` ~ `10_000` ข้ามทุก `VEVENT`): เมื่อเกินงบรวมของไฟล์ให้คืน `{ ok: false, error: 'TOO_LARGE', limit: 'events', max: maxItems }` (`413 ICS_TOO_LARGE`) ทันที — ปิดตัวคูณ `500 VEVENT × งบต่อ VEVENT` ทั้งหมด
  2. **(เสริมให้ 1 VEVENT เร็วระดับ < 5 ms แม้เริ่มปี 1900):** ใน `expandRruleDates` สาขา `MONTHLY` สำหรับเดือนที่ทั้งเดือนอยู่ก่อน `earliestStartDate` และอยู่หลังเดือนของ `dtstartDate` ให้นับจำนวนวันที่ตรงเงื่อนไขในเดือนนั้นด้วยเลขคณิต (`daysInMonth` + วันในสัปดาห์ของวันที่ 1) เพื่อบวก `emitted` โดยไม่ต้องสร้างวัตถุ `Temporal.PlainDate` ทีละวัน
  3. เพิ่ม regression test ใน `tests/calendar/ics-import.test.ts` ยืนยันว่าไฟล์ที่มี `500` `VEVENT` แบบ `DTSTART:19000101` + `RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=10000` ถูกตัดด้วย `TOO_LARGE` (หรือประมวลผลเสร็จ) ใน `< 100 ms`

---

### 🟢 L1 — `EXDATE` คั่นด้วยคอมมาว่างจำนวนมาก (`EXDATE:,,,,,,...`)
- **ที่:** `src/lib/calendar/ics-import.ts:728-733` (`parseExdates` นับ `total > MAX_EXDATES_PER_EVENT` หลัง `if (!tok) continue;`)
- **ประเมิน:** บรรทัด `EXDATE:` ที่มี `,` ล้วน ~500,000 ตัวถูกจำกัดขนาดรวมโดย `ICS_IMPORT_MAX_BYTES = 512 KB` อยู่แล้ว · ✅ วัดจริงกับ `EXDATE:` + `,` × 500,000 ตัว ใช้เวลาเพียง **16.32 ms** ไม่เป็นความเสี่ยง DoS · ไม่ต้องแก้

### 🟢 L2 — ผู้ใช้ที่ล็อกอินแล้วส่ง JSON body ใหญ่ (≤ 768 KB) ที่ไม่ผ่าน zod จะถูกตัดก่อน `takeSlots`
- **ที่:** `src/app/api/_lib/route.ts:318-323` vs `src/lib/data/services/busy-import.ts:132-136`
- **ประเมิน:** H2 ตัด anonymous / suspended / deleted / `must_change_pin` ก่อนอ่าน body เรียบร้อยแล้ว เหลือเฉพาะผู้ใช้ `active` ที่ผ่านด่านบัญชีแล้วซึ่งหากส่ง JSON ผิด schema ≤ 768 KB จะถูกตัดที่ขั้น zod ก่อนจองถัง `busy:import:preview` · ต้นทุน `TextDecoder` + `JSON.parse` ≤ 768 KB ต่ำมาก (~0.7–2.3 ms ตามที่วัดไว้ใน `security-ics-import.md` L1) · ไม่ต้องแก้

### 🟢 L3 — การอ่าน `WEEKDAY_TO_ISO[kv.WKST]` บน plain object (`ics-import.ts:635`)
- **ที่:** `src/lib/calendar/ics-import.ts:537-545, 584, 635`
- **ประเมิน:** 📖 ✅ ปลอดภัยจากคีย์บน `Object.prototype` (`toString`, `valueOf`, `constructor`, `__proto__`) เพราะ `kv.WKST` ถูกแปลงเป็น `.toUpperCase()` ที่ `:584` ก่อนเสมอ และบน `Object.prototype` ไม่มี property ใดที่เป็นตัวพิมพ์ใหญ่ล้วน (`Object.getOwnPropertyNames(Object.prototype).filter(k => k === k.toUpperCase())` = `[]` · ทดสอบจริง `WKST=toString` ถูกปฏิเสธลง `skipped.rrule` ใน `0.73 ms`) · ไม่ต้องแก้ (หากปรับโค้ดรอบหน้าจะใช้ `Object.hasOwn` เพื่อความชัดเจนก็ได้)

---

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **H2: ตรวจ actor + ด่านบัญชีก่อนอ่าน body > 64 KB (`route.ts`)** | **PASS** | 📖 `src/app/api/_lib/route.ts:284-314` ทำงานเมื่อ `!isRead && entry.auth === 'actor' && entry.action !== null && !isPublicAction(entry.action) && maxBodyBytes > 64 KB` หลังผ่าน `checkCsrf` (`:276-279`) · ลำดับด่านบัญชีและรหัส error ตรงกับ `can()` ใน `src/lib/rbac/can.ts:321-328` ทุกกรณี (`AUTH_REQUIRED` 401 สำหรับ anonymous และ `status !== 'active'`, `ACCOUNT_SUSPENDED` 401, `PIN_CHANGE_REQUIRED` 403, `FORBIDDEN` 403 สำหรับ SA-only) · เรียก `req.body?.cancel()` ทุกทางปฏิเสธ · บรรทัด `:333` ใช้ `preResolvedActor` ต่อโดยไม่เรียก `resolveActor` ซ้ำ · service ยังเรียก `authorize()` บรรทัดแรกตามเดิม · ✅ ทดสอบด้วย `ReadableStream` ที่ส่ง `"{broken-json-" + "X"×100,000`: ทั้ง `anonymous`, `suspended`, `must_change_pin`, `deleted_user` คืน `401`/`403` โดย `cancelled=true` ก่อนเข้า `readJsonBody`/`JSON.parse` |
| **ไม่มี memory leak / oracle จาก H2 (`session.ts` + `Server-Timing`)** | **PASS** | 📖 anonymous ไม่มีคุกกี้หรือคุกกี้ไม่ตรง `TOKEN_SHAPE` คืน `ANONYMOUS_SESSION` โดยไม่แตะ DB (`session.ts:148-149`) · `renewed` และ `resolvedUsers` ใน `session.ts:118, 135` เป็น `WeakMap<Request, …>` จึงถูก GC ทิ้งเมื่อคำขอถูกปฏิเสธกลางคัน · `shouldExposeServerTiming` (`route.ts:401-404`) ตรวจ `status < 400` จึงไม่แนบ `Server-Timing` ในคำตอบ 401/403 (`server-timing=null`) และมี `Cache-Control: private, no-store` ทุกคำตอบ |
| **H1: บังคับกรอบ `END:VCALENDAR` และ `END:VEVENT` ปิดครบ** | **PASS** | 📖 `ics-import.ts:1227-1330` ตรวจ `!seenCalendar \|\| !seenEndCalendar \|\| inCalendar \|\| inEvent` → `INVALID NOT_ICS` (`400 ICS_INVALID`) · รองรับการตรวจจับ `VEVENT` ค้างเปิด, subcomponent (`VTIMEZONE`/`VALARM`) ค้างเปิดจนกิน `END:VCALENDAR`, และ `VCALENDAR` ชุดที่ 2 ไม่ปิด · ✅ `ics-import.test.ts:500-529` และ `ics-import-api.test.ts:370-375` ผ่าน |
| **ReDoS (ทุก regex ใหม่)** | **PASS** | 📖 regex ที่เพิ่มใน `ics-import.ts:547-548` มีเพียง `BYDAY_RE = /^([+-]?[1-5])?(MO\|TU\|WE\|TH\|FR\|SA\|SU)$/` และ `BYMONTHDAY_RE = /^[+-]?(?:[1-9]\|[12]\d\|3[01])$/` ซึ่งเป็น anchored finite language (ยาว 1–4 ตัวอักษร ไม่มี `+`/`*` ซ้อน) · `parseRrule` จำกัด `MAX_RRULE_LENGTH = 512` ก่อน split |
| **Prototype pollution (`RRULE` / `EXDATE` / `UID` / `RECURRENCE-ID`)** | **PASS** | 📖 `kv` ใน `parseRrule` (`:578`) และ `params` ใน `parsePropertyLine` (`:282`) ใช้ `Object.create(null)` · คีย์ `RRULE` กรองด้วย `RRULE_ALLOWED_KEYS` (`Set` 7 คีย์) · `overridesByUid` และ `overrideCounts` (`:1334-1335`) ใช้ `Map` · ✅ ทดสอบ `UID:__proto__`, `UID:constructor`, `RRULE:__proto__=1`, `WKST=toString`, `DTSTART;__proto__=polluted` → `0.73 ms`, `Object.keys(Object.prototype)` = `[]` |
| **ความเป็นส่วนตัวของ `UID` และ property อื่น (R2 / กฎ 7)** | **PASS** | 📖 `UID` ถูกตัดความยาว `≤ 256` (`:1320`) และใช้เฉพาะในตัวแปร local `overridesByUid` ใน `parseIcsToBusy` (`:1334-1349`) เท่านั้น ไม่อยู่ใน `ParsedIcsBusyItem`, `PreviewBusyImportResult`, `ConfirmBusyImportInput`, DB หรือ `console.*` · `DESCRIPTION`, `LOCATION`, `ATTENDEE`, `ORGANIZER`, `URL` ยังคงไม่อยู่ใน `ALLOWED_PROPS` · `hideDetail` ดีฟอลต์ `true` ทั้งฝั่ง service (`busy-import.ts:237`) และ UI (`IcsImportSheet.tsx:85`) · ✅ `ics-import-api.test.ts:303-368` (ตรวจ response text, `dumpAllTables` และ spy `console.log/warn/error`) |
| **Memory retention ข้ามคำขอ (M1 รอบ v1.1.0 + โครงสร้างใหม่)** | **PASS** | 📖 ไม่มี module-level mutable cache ใหม่ใน `ics-import.ts` · `EXDATE` / `RECURRENCE-ID` / `UNTIL` วิ่งผ่าน `resolveIcsTimeZone` (จำกัด `≤ 64` ตัวอักษร + `TZID_CHARS`) และ `zone.ts` cache เฉพาะผล `true` · ✅ รัน 200 คำขอด้วย `UID` ยาว 220 ตัว + `TZID` แปลกไม่ซ้ำ + `EXDATE` + `RECURRENCE-ID` (รวม 20,000 ค่าไม่ซ้ำ) หลัง `gc()`: **retained heap = `0.00 MB`** (control 200× = `0.12 MB`) |
| **เพดานกัน CPU DoS ของ `RRULE` / `EXDATE` (R4)** | **FAIL (🟡 M1)** | ✅ `DAILY` และ `WEEKLY` ทำ O(1) fast-forward แม่นยำทั้งกรณีมีและไม่มี `COUNT` · `140× VEVENT` ที่มี `200 EXDATE` (~491 KB) ใช้เวลา `75.03 ms` · แตกเกิน `500` รายการคืน `413 ICS_TOO_LARGE` ทันที · ❌ **แต่สาขา `MONTHLY` ที่มี `COUNT` จากปี `1900` ไม่มีงบรวมระดับไฟล์ ทำให้ `500 VEVENT` (~62–96 KB) ใช้เวลา `10.09–12.27 s`/คำขอ (ดู 🟡 M1)** |
| **RBAC / `authorize()` บรรทัดแรก / atomic cap 300 / rate limit / CSRF** | **PASS** | ✅ `tests/security` ทั้งโฟลเดอร์ (9 ไฟล์), `tests/rbac/matrix.test.ts`, `tests/auth/must-change-pin.test.ts`, `tests/platform/manifest.test.ts`, `tests/busy/ics-import-api.test.ts`, `tests/busy/calendar-visibility.test.ts` ผ่านครบ |
| **O1–O2: `scripts/release.ts` และเอกสาร (กฎ 7–8)** | **PASS** | 📖 `scripts/release.ts` ใช้ `execFileSync("git", args)` แบบอาร์เรย์อาร์กิวเมนต์ (ไม่ผ่าน shell) และรันเกตจากค่าคงที่ `GATES` เท่านั้น · ขยาย `DOC_VERSION_TARGETS` ครบ 5 ไฟล์ตรงกับ `tests/ops/docs-sync.test.ts` · ไม่มี migration ใหม่ (`db:check` ผ่าน) ไม่มี env ใหม่ และไม่พบความลับใน diff · ✅ `docs-sync.test.ts`, `operations-doc.test.ts`, `release.test.ts` (32 non-CLI) ผ่าน |

---

## คำสั่งที่รันเอง + ผลจริง (HEAD `acb3e5d`)
```
$ npm run lint && npm run typecheck && npm run db:check
→ eslint . (exit 0) · tsc --noEmit (exit 0) · drizzle-kit check: "Everything's fine" (exit 0)

$ npx vitest run tests/calendar/ics-import.test.ts tests/calendar/ics-tzid-guard.test.ts tests/calendar/zone-cache.test.ts tests/busy/ics-import-api.test.ts tests/busy/calendar-visibility.test.ts tests/auth/must-change-pin.test.ts tests/security tests/rbac/matrix.test.ts tests/platform/manifest.test.ts tests/ops/docs-sync.test.ts tests/ops/operations-doc.test.ts --reporter=agent --testTimeout=60000
 Test Files  19 passed (19)
      Tests  2743 passed | 1 skipped (2744)
   Duration  44.38s

$ npx vitest run tests/release/release.test.ts -t "^((?!CLI).)*$" --reporter=agent --testTimeout=60000
 Test Files  1 passed (1)
      Tests  32 passed | 2 skipped (34)
   Duration  4.49s

$ npm run build
→ Next.js 16.4.5 production build สำเร็จ 51/51 static/dynamic routes (exit 0)

$ gh pr checks 54
→ Vercel pass · Vercel Preview Comments pass · build pass · changes pass · contrast pass · e2e (Playwright) (1)-(4) pass · lint pass · test + migration pass · typecheck pass  (12/12 pass บน commit 0e25452)

$ node --expose-gc node_modules/tsx/dist/cli.mjs <scratch>/sec-fuzz-v12.ts
→ พิสูจน์ 🟡 M1 (10.36s / 10.09s / 9.00s / 2.63s), EXDATE 491KB (75.03ms), prototype pollution (0.73ms, polluted=undefined, upperCollisions=[])

$ NODE_OPTIONS=--expose-gc node node_modules/tsx/dist/cli.mjs <scratch>/sec-h2-and-mem.ts
→ H2 ReadableStream cancel ก่อนอ่าน body ครบทั้ง 4 สถานะ (anonymous 401, suspended 401, must_change_pin 403, deleted_user 401 · cancelled=true · cache-control=private, no-store · server-timing=null)
→ Heap retention 200 คำขอ unique UID/TZID/EXDATE = -0.00 MB (control 200× = 0.12 MB)
```

## สิ่งที่ตรวจไม่ได้
- ไม่ได้รัน `npm test` ทั้งชุดและ 2 ข้อ CLI ของ `tests/release/release.test.ts` ในเครื่อง Windows ตามหมายเหตุเครื่อง boss (`AGENTS.md` §9 — อ้างผล CI `test + migration` pass แทน)
- ไม่ได้รัน Playwright E2E ซ้ำในแชต `security` นี้ (CI `e2e (Playwright) (1)–(4)` บน PR #54 ผ่านครบทั้ง 4 shard แล้ว)
- ❓ การแข่งธุรกรรมข้าม instance บน Turso production จริง (ใช้กลไก `inTx` + atomic CTE เดิมของ ADR 0010/0017 ที่ตรวจผ่านแล้วใน v1.1.0)
