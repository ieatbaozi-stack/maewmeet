# Security review — v1.1.0 นำเข้าไฟล์ `.ics` (feat/ics-import · PR #49)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้ · ผู้ทำ = Antigravity/Gemini) · 2026-11-24 · branch `feat/ics-import` HEAD `12f5120` · ช่วง `git diff main...HEAD` · เทียบ [ICS_IMPORT_CONTRACT](../contracts/ICS_IMPORT_CONTRACT.md) I1–I5, A2–A5 + [ADR 0017](../adr/0017-ics-import.md) · กฎเหล็ก CLAUDE.md ข้อ 6–9
- วิธี: อ่านโค้ดฝั่งเซิร์ฟเวอร์ทุกไฟล์ที่เปลี่ยน (`src/lib/calendar/ics-import.ts`, `src/lib/data/services/busy-import.ts`, `src/lib/data/repos/busy.ts`, routes 2 ตัว, `_lib/route.ts`, `_lib/manifest.ts`, `auth/throttle.ts`, `shared/errors.ts`, `shared/limits.ts`) + `IcsImportSheet.tsx` (ส่วนที่เกี่ยวกับความปลอดภัย) · ยิง input ร้ายกับ parser จริงด้วยสคริปต์ชั่วคราวนอก repo (scratchpad) · รันเทสต์เอง · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด · ❓ = ยืนยันไม่ได้
- ระดับ: 🔴 ร้ายแรง (ต้องแก้) · 🟡 กลาง · 🟢 ต่ำ/ข้อสังเกต

## สรุป
| ระดับ | จำนวน |
|---|---|
| 🔴 | 0 |
| 🟡 | 1 (ต้องแก้ก่อน merge) |
| 🟢 | 4 |

**Verdict: FAIL** — เหตุผลเดียวคือ 🟡 M1 (TZID จากไฟล์ถูกเก็บลง cache ระดับ module แบบไม่มีเพดาน → หน่วยความจำโตข้ามคำขอ ขัด A3/ADR 0017 §2 "ไม่สะสมหน่วยความจำ") · แก้ได้ในไม่กี่บรรทัด · ส่วนอื่นผ่านหมด: parser เป็นเส้นตรงจริง (worst case ที่วัดได้ ≤ 31 ms ต่อไฟล์ 512 KB), cap ทั้ง 3 ตรวจระหว่างสแกน, ไม่มี prototype pollution, ไม่ fetch URL, RBAC/`must_change_pin`/SA/strict/CSRF/rate limit/atomic cap ถูก, ไม่เก็บ DESCRIPTION/LOCATION/ATTENDEE/ORGANIZER/URL, ไม่ log เนื้อหา, `hideDetail` ดีฟอลต์ `true` · แก้ M1 แล้ว security ตรวจซ้ำเฉพาะจุดนั้นได้

## ข้อพบ

### 🟡 M1 — TZID จากไฟล์ `.ics` สะสมใน cache `validTz` แบบไม่มีเพดาน (memory โตข้ามคำขอ)
- ที่: `src/lib/calendar/zone.ts:10,15-27` (`const validTz = new Map<string, boolean>()` เก็บทั้งผลบวกและลบของทุกสตริงที่ส่งเข้ามา ไม่มีเพดาน/ไม่มีหมดอายุ) · ถูกป้อนจาก `src/lib/calendar/ics-import.ts:335-345` (`resolveIcsTimeZone` เรียก `isValidTimeZone` กับ TZID ดิบ และกับตัวที่ตัด `/` ออก) ← `:411-414` (ทุก `DTSTART`/`DTEND` ที่มี `TZID=`) · `parsePropertyLine` `:247-257` ไม่จำกัดความยาวค่า parameter
- ของเดิมก่อนรอบนี้ป้อน cache ได้แค่ `tz` ≤ 64 ตัว 1 ค่าต่อคำขอ (`busy-routines.ts:90`) · รอบนี้ 1 คำขอ preview ป้อนได้ ~1,000 สตริงไม่ซ้ำ (500 VEVENT × DTSTART+DTEND) ยาวรวมเกือบ 512 KB
- ทำซ้ำ (✅ รันจริง `NODE_OPTIONS=--expose-gc node node_modules/tsx/dist/cli.mjs <scratchpad>/fuzz/tzcache.ts`): สร้างไฟล์ 522,812 ไบต์ มี 500 VEVENT แต่ละอันมี `DTSTART;TZID=Zz/<req>_<i>_qqq…(470 ตัว)a:...` และ `DTEND;TZID=...b:...` ไม่ซ้ำกันข้ามคำขอ → `parseIcsToBusy` 200 ครั้ง แล้ว `gc()`:
  ```
  200 previews (worst-case unique TZID) retained heap ≈ 26.4 MB  (≈ 135 KB/request) · parse ms median=25.0 max=44.4
  control (same file 200x) retained ≈ 0.5 MB
  ```
  หน่วยความจำไม่คืนแม้ GC แล้ว (ตัวควบคุมที่ใช้ไฟล์เดิมซ้ำโตแค่ 0.5 MB → การโตมาจาก cache ของสตริงไม่ซ้ำ)
- ผลจริง: ผู้ใช้ที่ล็อกอิน 1 บัญชี ใช้ preview ได้ 20 ครั้ง/10 นาที → ~2.7 MB/10 นาที ≈ 390 MB/วันต่อ instance ที่อยู่นาน (Vercel Fluid ใช้ instance ซ้ำข้ามคำขอ) · หลายบัญชีคูณเพิ่ม → instance OOM/ช้าลงทุกคนที่ใช้ instance เดียวกัน · ต้องล็อกอิน จึงไม่ใช่ 🔴 · ขัดเกณฑ์ A3 "memory/size cap" และ ADR 0017 §2 ข้อ 1
- ข้อเสนอการแก้ (เจ้าของ `platform` ทั้งสองไฟล์ · เลือกอย่างใดอย่างหนึ่งหรือทั้งคู่):
  1. `zone.ts`: cache เฉพาะผล `true` (ชุดเขตเวลาที่ถูกมีจำนวนจำกัด) ไม่ cache ผลลบ — ปิดต้นเหตุทั้งระบบ
  2. `ics-import.ts` `resolveIcsTimeZone`: ปฏิเสธ (`null`) ทันทีถ้า TZID ยาวเกิน 64 ตัว หรือไม่ตรงชุดอักขระ `^[A-Za-z0-9_+\-/. ]+$` ก่อนเรียก `isValidTimeZone`
  - เพิ่มเทสต์: preview ด้วย TZID ไม่ซ้ำจำนวนมาก แล้วยืนยันว่า cache ไม่โต (หรือ `isValidTimeZone` ไม่ถูกเรียกกับสตริงยาว)

### 🟢 L1 — `route.ts` อ่าน JSON body ได้ถึง 768 KB ก่อน `resolveActor` (ข้อสังเกตจาก qa)
- ที่: `src/app/api/_lib/route.ts:282-288` (ขั้น 2 validate ก่อนขั้น 3 actor `:297`) · `preview/route.ts:11` `maxBodyBytes: 768 KB`
- ประเมิน: เป็นลำดับเดิมของทุก route (เดิม 64 KB) · CSRF (Origin + `application/json`) ตรวจก่อนอ่าน body (`:276-279`) แต่ผู้โจมตีนอกเบราว์เซอร์ปลอม Origin ได้ จึงถือว่า anonymous ส่ง 768 KB ได้ · อ่านแบบ stream ตัดทันทีเมื่อเกิน (`:203-217`) · zod `icsText` ไม่มี `.max` แต่ถูกจำกัดโดย body cap อยู่แล้ว · ✅ วัด TextDecoder + `JSON.parse` ของ body 786,014 ไบต์ = **0.72 ms/คำขอ** (กรณี escape หนัก 780,020 ไบต์ = 2.31 ms) · parser ไม่ถูกเรียกเพราะ `authorize` ใน service ปฏิเสธก่อน → ต้นทุนหลักคือแบนด์วิดท์ขาเข้า (Vercel จำกัด body 4.5 MB อยู่แล้ว) · **ไม่เป็นความเสี่ยง DoS ที่มีนัย** → 🟢 · ถ้าอยากเข้มขึ้นในอนาคต: resolve actor ก่อนอ่าน body สำหรับ route ที่ `maxBodyBytes > MAX_BODY_BYTES`

### 🟢 L2 — rate limit preview จองช่องก่อนตรวจขนาด/parse (ถูกต้อง) แต่หลังอ่าน body
- ที่: `services/busy-import.ts:131-141` · 📖 `takeSlots` (precheck แล้วจอง) ก่อน `Buffer.byteLength` และ `parseIcsToBusy` → ไฟล์ใหญ่/ผิดก็กินโควตา กัน CPU spam ได้ตามเจตนา ADR · ส่วนต้นทุนอ่าน body ดู L1 · ไม่ต้องแก้

### 🟢 L3 — ความยาวค่า property/parameter ไม่มีเพดานแยก
- ที่: `ics-import.ts:211-259` · 📖 ✅ ไม่ใช่ปัญหาด้านเวลา (ทุกขั้นเป็นเส้นตรง ดูตารางด้านล่าง) และ SUMMARY ถูกตัด 80 code point ก่อนออก · ผลข้างเคียงเดียวคือ M1 · ถ้าแก้ M1 ด้วยข้อ 2 จะครอบคลุมจุดที่สำคัญแล้ว

### 🟢 L4 — `listOwnBusyForDedupe` ไม่มี LIMIT
- ที่: `repos/busy.ts` (ฟังก์ชันใหม่) · 📖 ผูก `user_id = me.id` และช่วงวัน · ขนาดถูกจำกัดโดยจำนวนแถวของเจ้าตัว (≤ 300 เดี่ยว + แถว routine) ไม่ SELECT title/note · ไม่ต้องแก้

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **ReDoS (ทุก regex)** | **PASS** | 📖 regex ใน parser มีแค่ `FORBIDDEN`/`ANY_SPACE`/`PICTO`/`MODIFIER`/`MARK`/`VISIBLE` (`ics-import.ts:123-128`) เป็น character class เดี่ยวทดสอบทีละ code point ไม่มี quantifier ซ้อน · การแยกบรรทัด/property/DURATION/วันที่เป็น loop ด้วย `charCodeAt` · `checkCsrf` regex เดิม · ✅ ตารางวัดเวลาด้านล่าง |
| **size cap ตรวจก่อนทำงานหนัก** | **PASS** | 📖 `inspectRawInput` (`:135-160`) นับ UTF-8 + หา null/control ในรอบเดียว ออกทันทีเมื่อเกิน → แล้วจึง `unfoldLines` · service ตรวจ `Buffer.byteLength` ซ้ำก่อน parse (`busy-import.ts:139`) · ✅ 512 KB+1 → `TOO_LARGE bytes` ใน 1.0 ms |
| **cap 20,000 บรรทัด + unfolding** | **PASS** | 📖 `pushRaw` นับ **บรรทัดดิบ** (รวมบรรทัดต่อที่ถูก unfold) ก่อนต่อสตริง (`:170-179`) → unfolding ไม่ทำให้ cap หลุด · ✅ 20,001 บรรทัด → `TOO_LARGE lines` 0.6 ms · พับ 19,980 บรรทัดเป็น SUMMARY ~480 KB → ผ่านใน 30.6 ms ชื่อออก 80 ตัว |
| **cap 500 VEVENT** | **PASS** | 📖 นับตอน `BEGIN:VEVENT` ระดับบน ออกทันทีที่ตัวที่ 501 (`:701-705`) · VEVENT ซ้อนใน component อื่นไม่ถูกประมวลผล · `totalEvents` ไม่ reset เมื่อมีหลาย VCALENDAR · ✅ 1,000 VEVENT → `TOO_LARGE events` 15.3 ms |
| **null byte / binary / control** | **PASS** | 📖 `0x00–0x1F` ยกเว้น TAB/LF/CR → `INVALID BINARY` (`:139`) → 400 `ICS_INVALID` · ✅ `\u0000`, `\u001b` → BINARY |
| **bidi / zero-width / control / private-use ในชื่อ** | **PASS** | 📖 `sanitizeIcsSummary` (`:292-332`) NFC → ตัด `\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Cn}`+filler → จำกัด combining mark 3 ตัว → ตัด 80 code point (array ของ code point ไม่ผ่า surrogate) → service ตรวจซ้ำด้วย `parseBusyTitle` (`busy-import.ts:186-191`, `:270`) · ✅ `‮evil‬`→`evil`, `a​b`→`ab`, ` x`→`x`, `priv`→`priv`, 😀×81 → 80 ตัว, SUMMARY 500 KB ล้วน bidi/zero-width → 9.7 ms · UI แสดงผ่าน React (ไม่มี `dangerouslySetInnerHTML` ใน `IcsImportSheet.tsx`) |
| **prototype pollution** | **PASS** | 📖 params = `Object.create(null)` (`:246`) · property เก็บผ่าน `switch` ชื่อคงที่ 7 ตัวเท่านั้น (`:740-765`) · `WINDOWS_TO_IANA[cleaned]` อ่านจาก object literal แต่ผลต้องผ่าน `isValidTimeZone` (สตริงเท่านั้น) · ✅ `DTSTART;__proto__=x;constructor=y;…(100k params)` → 7.8 ms, `Object.prototype.x` = undefined |
| **ไม่รับ/ไม่ fetch URL (SSRF)** | **PASS** | 📖 ไม่มี `fetch`/`http`/`webcal` ใน parser และ service · schema รับแค่ `icsText` string · property `URL` ถูกทิ้ง |
| **เวลาประมวลผล worst case** | **PASS** | ✅ (ทุกไฟล์ ≤ 512 KB) quote สลับยาว 500 KB 7.2 ms · พับ 19.9k บรรทัด 30.6 ms · ไทย+วรรณยุกต์ 500 KB 18.7 ms · VS16×50+ZWJ ซ้ำ 500 KB 20.2 ms · TZID 500 KB 5.1 ms · DURATION ตัวเลข 400 KB 2.8 ms · DURATION หน่วยซ้ำ 400 KB 5.1 ms · `BEGIN:X` ซ้อน 19k ชั้น 4.9 ms · CR เดี่ยวเป็นตัวแบ่งบรรทัด อ่านได้ถูก |
| **ไม่อ่าน DESCRIPTION/LOCATION/ATTENDEE/ORGANIZER/URL** | **PASS** | 📖 `ALLOWED_PROPS` 7 ตัว (`:118`) · `note` = NULL เสมอใน INSERT (`repos/busy.ts` CTE) · ✅ ไฟล์ที่มีทั้ง 5 property → `JSON.stringify(result)` ไม่พบ `secret`/`home addr`/`bob@`/`o@x`/`evil.example` · ✅ `ics-import-api.test.ts:139` |
| **`authorize()` บรรทัดแรก + ด่านบัญชี** | **PASS** | 📖 `busy-import.ts:127`, `:225` `authorize(actor,'busy.create',{type:'none'})` ก่อน rate limit/parse/DB · manifest 2 แถว `auth:'actor'` action `busy.create` · ✅ `tests/security` (authorize-first), `tests/rbac/matrix.test.ts`, `tests/platform/manifest.test.ts`, `ics-import-api.test.ts:93` (anonymous/suspended 401, must_change_pin 403 ทั้งสอง route), `tests/auth/must-change-pin.test.ts` (มี sample body ของ 2 route ใหม่) |
| **SA นำเข้าแทนคนอื่นไม่ได้ / mass assignment** | **PASS** | 📖 `user_id = asUser(actor).id` (`:128`, `:226`, `:292`) · schema `.strict()` ทั้งตัวนอกและ item (`:48-53`, `:56-83`) ไม่มีฟิลด์ userId/id/note/seriesId · ✅ `ics-import-api.test.ts:120` |
| **ไม่ไว้ใจค่าจาก client ตอน confirm** | **PASS** | 📖 ทุก item ผ่าน `normalizeBusyInput` + `parseBusyTitle` ใหม่ (`:245-287`) · id สร้างฝั่งเซิร์ฟเวอร์ (`newId()`) · `items` 1..100 · string มี `.max` · ค่าทั้งหมด bind เป็นพารามิเตอร์ใน `sql\`\`` ไม่ต่อสตริง |
| **atomic cap 300 / race** | **PASS** | 📖 `insertBusyBatchIfUnderCap` INSERT…SELECT เดียวมี `user active` + `windowCount + count(new_rows) <= cap` ใน `inTx` (serialized + transaction) เป็นคำสั่งแรก · ไม่พอ → 0 แถว → 409 `LIMIT_REACHED {limit:'busyCount',max:300}` · ✅ `ics-import-api.test.ts:250` (Promise.all 2 คำขอ ไม่เกิน 300) · ❓ แข่งข้าม instance บน Turso จริง (ใช้กลไกเดียวกับ ADR 0010 ที่ผ่านมาแล้ว) |
| **rate limit** | **PASS** | 📖 `BUSY_IMPORT_RATE_LIMITS` preview 20/10 นาที, confirm 10/10 นาที ต่อผู้ใช้ (`throttle.ts`) ผ่าน `takeSlots` · ✅ `ics-import-api.test.ts:278` 429 + `Retry-After` |
| **CSRF** | **PASS** | 📖 ทั้งสอง route เป็น POST `auth:'actor'` → `checkCsrf` (Origin ตรง + `application/json`) ก่อนอ่าน body (`route.ts:276-279`) · ส่ง JSON ไม่ใช่ multipart จึงไม่ต้องมีข้อยกเว้น |
| **`Cache-Control: private, no-store` รวม error** | **PASS** | 📖 ทุกคำตอบผ่าน `json()` (`route.ts:98-103`) รวม `errorResponse` (`:112-116`) และ 413 จาก body cap (throw `AppError` → catch → `errorResponse`) |
| **ไม่ log เนื้อหา `.ics`/SUMMARY** | **PASS** | 📖 ไม่มี `console.*` ในไฟล์ใหม่ · `logUnexpected` log แค่ method + path template + ชื่อชนิด error (`route.ts:235-244`) · `RangeError` ของ parser มีแค่ `defaultTz` (ค่าคงที่ฝั่งเซิร์ฟเวอร์) · VALIDATION params ไม่สะท้อนค่า/คีย์ของผู้เรียก (`validationParams`) · ✅ `ics-import-api.test.ts:303` spy console ทั้ง log/warn/error |
| **`hideDetail` ดีฟอลต์ + ไม่รั่วชื่อ** | **PASS** | 📖 service `input.hideDetail ?? true` (`:237`) · UI `useState(true)` (`IcsImportSheet.tsx:93`) · แถวที่นำเข้าเป็น `busy_block` ปกติ → ทางกลุ่มใช้ `SharedBusyRow` เดิม (ตัด title ใน SQL เมื่อ `hide_detail=1`, ไม่ SELECT note) · preview คืนชื่อเฉพาะจากไฟล์ของเจ้าตัวเอง, dedupe SELECT เฉพาะคอลัมน์เวลา · ✅ `ics-import-api.test.ts:139` (เพื่อนในกลุ่มไม่เห็นชื่อ), `calendar-visibility.test.ts` (busy ออกได้เฉพาะ `/me/*` กับ `/groups/:gid/calendar`) |
| **migration / env / ความลับ** (กฎ 7–8) | **PASS** | 📖 ไม่มี migration ไม่มี env ใหม่ (ใช้ `rate_limit_bucket` เดิม) · ไม่พบความลับใน diff |

## คำสั่งที่รัน + ผลจริง
```
$ npx vitest run tests/calendar/ics-import.test.ts tests/busy/ics-import-api.test.ts tests/security tests/rbac/matrix.test.ts tests/platform/manifest.test.ts tests/busy/calendar-visibility.test.ts tests/auth/must-change-pin.test.ts --reporter=agent
 Test Files  15 passed (15)
      Tests  2696 passed | 1 skipped (2697)
   Duration  34.86s

$ gh pr checks 49
build pass · changes pass · contrast pass · e2e (Playwright) (1)-(4) pass · lint pass · test + migration pass · typecheck pass · Vercel pass · Vercel Preview Comments pass   (12/12)

$ node node_modules/tsx/dist/cli.mjs <scratchpad>/fuzz/fuzz.ts      → ตารางเวลาในเกต "เวลาประมวลผล worst case" + sanitize + leak check (null)
$ NODE_OPTIONS=--expose-gc node node_modules/tsx/dist/cli.mjs <scratchpad>/fuzz/tzcache.ts   → M1 (26.4 MB / 200 คำขอ, control 0.5 MB)
$ node -e "<TextDecoder + JSON.parse body 786,014 B ×50>"            → 0.72 ms/คำขอ (escape หนัก 2.31 ms) → L1
```
(`tests/security` ทั้งโฟลเดอร์ผ่านในเครื่องนี้รอบนี้ รวม `config-hygiene.test.ts` · ไม่ได้รัน `npm test` ทั้งชุดบน Windows ตามหมายเหตุเครื่อง boss — อ้างผล CI `test + migration` pass)

## สิ่งที่ตรวจไม่ได้
- ❓ race ข้าม instance บน Turso production (เทสต์เป็น libsql ในเครื่อง)
- ❓ อายุ instance จริงบน Vercel (ใช้ประเมินผลกระทบ M1 — ตัวเลข 390 MB/วันเป็นกรณีคำขอทั้งหมดลง instance เดียว)
- ไม่ได้รัน e2e ในเครื่อง Windows (CI e2e 4 shard pass)
