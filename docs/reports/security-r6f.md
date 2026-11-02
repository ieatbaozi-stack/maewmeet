# Security review — R6F (busy หลายวัน "เฉพาะช่วงเวลา" · ชุดรายวัน `series_id` · migration 0003)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-03 · branch `feat/r6f-daily-busy` HEAD `438beab` (โค้ดตรวจที่ `8391d79` · `438beab` เพิ่มแค่ `CHANGELOG.md`/`docs/OPERATIONS.md` ตรวจความลับแล้ว) · ช่วง `main..HEAD` · เทียบ R6F_CONTRACT §1–§7 + Errata, ADR 0010, ADR 0006, กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่าน `git diff main..HEAD -- src drizzle` ทุกบรรทัด + รันเทสต์ของทีม + PoC ของผู้ตรวจ (ไฟล์อยู่นอก repo ใน scratchpad `poc/r6f.test.ts` + `poc/vitest.poc.config.ts` ไม่ commit) · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows (checkout CRLF) · Vitest ใช้ config ชั่วคราวใน scratchpad (ข้าม EPERM ตอนลบไฟล์ DB ชั่วคราว) · qa/ops ทำงานใน worktree เดียวกันพร้อมกัน
- สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ดเท่านั้น

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 5 |

**Verdict: ผ่าน** — input `kind:'daily'` ถูกจำกัดครบ (strict, 62 วัน, ย้อนหลัง 7, step 30, ไม่ข้ามเที่ยงคืน, body ≤ 64 KB) · เพดาน 300 เป็นคำสั่ง SQL เดียวไม่มี check-then-act และทนการแข่งข้าม connection จริง · rate limit ผูก user id ของ session · ลบทั้งชุดผูก `user_id` ของผู้กระทำทั้งสองชั้น ของคนอื่น = 404 ไบต์เดียวกับ id ที่ไม่มี · `series_id` ไม่ออกจากฐานในคิวรีฝั่งแชร์เลย · migration 0003 เป็น ADD COLUMN nullable + partial index ปลอดภัยกับข้อมูลเดิม · ไม่มีความลับ/dependency ใหม่

## Verdict ต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **1. input daily** | **PASS** | ✅ PoC 27 กรณี → 4xx ทุกกรณี และ `busy_block` = 0 แถว: 63 วัน → `LIMIT_REACHED busySpan max 62` · `9999-12-31`/ปี 0000 → `DATE_OUT_OF_RANGE` · `-002026-…` → `INVALID_DATE` · ย้อนหลัง 8 วัน → `LIMIT_REACHED busyBackdate 7` · endDate<startDate → `INVALID_RANGE dates` · endTime ≤ startTime → `INVALID_RANGE time` · `24:00`/`17:00:00`/ตัวเลขอารบิก/เต็มความกว้าง → `VALIDATION INVALID` · `17:15` → `TIME_NOT_ON_STEP` · tz `Mars/Phobos`/`../../etc/passwd` → `INVALID_TIMEZONE` · tz 65 ตัว → `TOO_LONG` · DST gap NY 02:00 → `INVALID_LOCAL_TIME` (ทั้งคำขอ) · `seriesId`/`userId`/`__proto__`/`constructor` → `UNKNOWN_FIELD` · array/number → `INVALID_TYPE` · title 81 / note 501 → `TOO_LONG` · `kind:'DAILY'` → `INVALID` · body 2 MB → 400 ไม่มีแถว (📖 `MAX_BODY_BYTES = 64 KB` `src/app/api/_lib/route.ts:27`) · ✅ CPU: ช่วงใหญ่ถูกตัดก่อนขยาย (📖 `exceedsMaxSpan` ก่อน `eachDate` `src/lib/calendar/busy.ts`) — `1900…2999` ปฏิเสธใน ~0 ms · ขยาย 62 วัน tz `America/New_York` ×200 = 507.7 ms (~2.5 ms/ครั้ง) · POST 62 แถวจริง 12.8 ms, response 20 KB · fold 01:00–01:30 NY ได้ 30 นาทีทุกวัน |
| **2. เพดาน 300 + transaction** | **PASS** | 📖 `insertBusySeriesIfUnderCap` (`src/lib/data/repos/busy.ts:89`) = `WITH v AS (VALUES …) INSERT … SELECT … FROM v WHERE EXISTS(user active) AND windowCount + N <= cap RETURNING id` คำสั่งเดียว · subquery ไม่ correlated กับ v → ผ่านทั้ง N หรือ 0 · ได้ไม่ครบ N → `null` → service throw ใน `inTx` (`services/busy.ts:252-256`) = rollback (ชั้นกันที่สอง) · ไม่มี SELECT ก่อน INSERT ใน tx · ✅ PoC **สอง `Db` instance คนละ connection** (คิว `serialized` แยก → ชนล็อก SQLite จริง) 250 แถว + 28 ×2 พร้อมกัน → `['ok 28', 'err CONFLICT']` รวม 278 ไม่มีชุดครึ่ง · ✅ ขอบ: 273+28 → 409 `LIMIT_REACHED` คง 273 · 272+28 → 201 = 300 พอดี · ✅ เทสต์ทีม R6F-5 (2 และ 6 คำขอพร้อมกัน, ชน PK กลางชุด, throw หลัง INSERT, บัญชีระงับ) ผ่าน |
| **3. rate limit** | **PASS (Info 2)** | 📖 `takeUserSlot(db, spec, me.id, now)` (`services/busy.ts:224, 248, 325`) key = prefix + user id จาก session (ผู้ใช้กำหนดไม่ได้) · create/delete คนละ bucket · ✅ PoC: A สร้าง 30 ครั้ง → ครั้งที่ 31 `429 RATE_LIMITED Retry-After 600` · B ยังสร้างได้ 201 · A ยิง DELETE id ของ B ×61 → `{404, 429}` เท่านั้น (เผาโควตา A เอง) · B ลบของตัวเองได้ 200 → ไม่มีทางทำให้คนอื่นโดนล็อก · หลัง 10 นาที A สร้างได้อีก · ✅ DoS: 30 คำขอ × 62 วัน → 201 ×4, 409 ×26, แถว 248 ≤ 300 (เพดาน 300 เป็นตัวจำกัดจริง ไม่ใช่ 30×62 = 1,860) |
| **4. ลบทั้งชุด (IDOR)** | **PASS (Info 1)** | 📖 `deleteOwnBusySeries` (`repos/busy.ts:177`): `WHERE user_id = :me AND (id = :id OR (series_id IS NOT NULL AND series_id = (SELECT series_id … WHERE id = :id AND user_id = :me)))` — ทั้งชั้นนอกและ subquery ผูกผู้กระทำ · super admin ไม่มีทางลัด (`authorize('busy.delete', ownerRes(me))` + SQL ผูก user_id) · ✅ PoC เทียบไบต์ (แทน id ด้วย `<ID>`): ผู้ใช้อื่นและ super admin × scope `''/one/series` × (แถวในชุดของคนอื่น · แถวเดี่ยวของคนอื่น · `seriesId` ของคนอื่นใช้เป็น id) = ไบต์เดียวกับ id ที่ไม่มี `{"error":{"code":"NOT_FOUND"}}` 404 · แถวของคนอื่นไม่เปลี่ยน · seriesId ของตัวเองใช้เป็น id → 404 · PATCH ส่ง `seriesId` → 400 (เข้าชุดคนอื่นไม่ได้) · scope=series บนแถวเดี่ยวของตัวเอง → ไม่แตะชุดคนอื่น · ✅ เทสต์ทีม `tests/rbac/busy-series.test.ts` (ค่าแปลก 10 แบบ → 400 ไม่สะท้อนค่า; series_id ปลอมข้ามผู้ใช้ → ลบเฉพาะของตัวเอง) ผ่าน |
| **5. ความเป็นส่วนตัว (ADR 0006/0010 §6)** | **PASS (Info 3)** | 📖 `sharedBusyInGroupQuery` (`repos/busy.ts:214`) projection ระบุคอลัมน์ ไม่มี `series_id`/`note` · `myCommitmentsSql` (`repos/appointment.ts`) ไม่ SELECT `series_id` และผูก `b.user_id = :me` · `toBusyOwnView` ใช้เฉพาะเส้นทางเจ้าของ (`services/busy.ts`) · หน้าเว็บ (RSC) `calendar/_lib/load.ts` เรียก `getGroupCalendar`/`getGroupAvailability` service เดียวกับ API (📖) · ✅ PoC canary: ชุดซ่อนชื่อ (title/note = canary สุ่ม) + แถวเดี่ยวซ่อนชื่อ → B (สมาชิก) ดู calendar / availability / appointments/check / me/appointments / me/busy และ C (คนนอก) ดู calendar (404) → ไม่มีคำว่า `series` (ไม่สนตัวพิมพ์), ไม่มีค่า seriesId, note, title ซ่อน ในไบต์ใดเลย · ชุดซ่อนกับแถวเดี่ยวซ่อนในปฏิทินกลุ่มมีชุดคีย์เดียวกัน `allDay,endAt,id,kind,localEndDate,localStartDate,startAt,tz,userId` และค่าเหมือนกันทุกฟิลด์ยกเว้นเวลา/id → โยงเป็นชุดจากฟิลด์ไม่ได้ · id แต่ละวันเป็น UUIDv4 สุ่ม (prefix ไม่ซ้ำ) · ✅ เทสต์ทีม R6F-7 (+ `.toSQL()` ไม่มี series_id) ผ่าน |
| **6. migration 0003** | **PASS** | ✅ `drizzle/0003_r6f_busy_series.sql` = `ALTER TABLE busy_block ADD series_id text` + `CREATE INDEX busy_user_series_idx … WHERE series_id is not null` — ไม่ rebuild ตาราง ไม่ backfill ไม่มีข้อมูล · journal idx 3 `when` > 0002 · ✅ `tests/platform/migration-0003.test.ts` (แถวเดิมครบทุกไบต์, NULL, index เดิมอยู่, CHECK/FK เดิม, apply ซ้ำไม่พัง) ผ่าน · ✅ `npx drizzle-kit check` → `Everything's fine` · ✅ `.env.example` ไม่เปลี่ยน (diff 0 บรรทัด) |
| **7. frontend** | **PASS** | ✅ grep บรรทัดที่เพิ่มใน `src/components`: ไม่มี `console.`, `localStorage`, `innerHTML`/`dangerously`, URL ภายนอก · เรียกเฉพาะ `/api/me/busy` (GET/POST) และ `/api/me/busy/:id?scope=one|series` (DELETE) — scope เป็น union literal ไม่ใช่ข้อความผู้ใช้ · ข้อความผ่าน i18n (`messages/th.json`/`en.json`) · `package.json`/`package-lock.json` ไม่เปลี่ยน (ไม่มี dependency ใหม่) · ขยายวันฝั่ง client ใช้ `expandDailyBusyInput` จาก `src/lib/calendar` (สรุปก่อนบันทึก) เซิร์ฟเวอร์ตรวจซ้ำเอง |
| **8. ความลับใน diff** | **PASS** | ✅ grep ทุกบรรทัดที่เพิ่มใน `git diff main..HEAD` หา `secret\|password\|token\|api_key\|PRIVATE\|turso\|authToken` → พบแค่ตัวอย่าง placeholder ใน ADR/OPERATIONS (`libsql://maewmeet-prod-xxxx.turso.io`, `Read-Host -AsSecureString`) และชื่อคอลัมน์ `device_token_hash` ใน snapshot · ไม่มีค่าจริง · service/repo ใหม่ไม่ log อะไร |

## Findings
ไม่มี Critical/High/Medium/Low

## Info
1. **`?scope=` ซ้ำ ใช้ค่าสุดท้าย** (`src/app/api/me/busy/[id]/route.ts:21` `Object.fromEntries(searchParams)`): `?scope=one&scope=series` → ลบทั้งชุด · กระทบเฉพาะข้อมูลของผู้กระทำเอง (SQL ผูก user_id) UI ไม่ส่งค่าซ้ำ เทสต์ทีมยอมรับ 200/400 · ถ้าอยากเข้มขึ้น: ปฏิเสธเมื่อ `searchParams.getAll('scope').length > 1` · อีกข้อ: `.strict()` ทำให้ query key อื่นใดๆ (เช่น cache-buster) ได้ 400 — ปลอดภัยแต่ควรรู้ไว้
2. **ขยายวันเกิดก่อนจองช่อง rate limit** (`services/busy.ts:236` ก่อน `:248`): หลังโดน 429 แล้ว คำขอ 62 วันที่ถูกต้องยังกิน CPU ~2.5 ms ต่อครั้ง (✅ วัดจริง tz NY) ก่อนตอบ 429 · ต้นทุนใกล้เคียง overhead ปกติของคำขอ และตามดีไซน์ "อินพุตผิดไม่กินโควตา" ไม่บล็อก
3. **การมองเห็นโดยรูปแบบเวลา**: คนในกลุ่มยังเดาได้ว่า "17:00–20:00 ทุกวัน" เป็นกิจวัตรจากช่วงเวลาที่เห็นอยู่แล้ว (ก่อน R6F ก็เห็นได้ถ้าลงทีละวัน) — ไม่ได้รั่วเพิ่มจากการเป็นชุด (ไม่มี seriesId/created_at/ลำดับ id ให้โยง)
4. **PATCH busy ไม่มี rate limit** — contract/Errata กำหนดเฉพาะ create/delete · PATCH แก้ได้ทีละแถวและอยู่ใต้เพดาน 300 เดิม ไม่ใช่ช่องทาง DoS แบบหลายแถว
5. **ข้าม process บน Turso**: ✅ PoC สอง connection บนไฟล์เดียวให้ CONFLICT (ล็อก SQLite) ไม่ใช่ทะลุเพดาน · 📖 บน libSQL remote ต้องพึ่งการ serialize ผู้เขียนของ SQLite/Turso เหมือน `insertBusyIfUnderCap` เดิม (ADR 0010 §3) — ไม่ได้ทดสอบกับ Turso จริง

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `git diff main..HEAD --stat` | 33 ไฟล์ (+4171/−73) · `src/` 18 ไฟล์ · `drizzle/0003_*` + meta · ไม่มี `package*.json`/`.env.example`/`next.config.ts` |
| `npx vitest run --config <scratchpad>/poc/vitest.poc.config.ts --reporter=verbose --silent=false` (PoC ผู้ตรวจ 10 เทสต์) | **10 passed (10)** · 9.32s · ผลย่อยตามตารางเกต 1–5 |
| `npx vitest run --config <scratchpad>/vitest.tmp.config.ts tests/platform/migration-0003.test.ts tests/platform/r6f-daily-busy.test.ts tests/rbac/busy-series.test.ts tests/calendar/daily-busy.test.ts tests/busy tests/security tests/rbac tests/ui/r6f-daily-busy.test.ts` | 20 files: **19 passed / 1 failed** · tests **2786 passed / 2 failed / 1 skipped** · 2 ตัวที่ล้ม = `tests/security/config-hygiene.test.ts` ข้อ permissions ของ `ci.yml`/`keepalive.yml` (ปัญหา CRLF เดิมของเครื่อง Windows ไม่เกี่ยวกับ R6F) |
| `npx drizzle-kit check` | `Everything's fine` |
| `git diff main..HEAD -- .env.example \| wc -l` | 0 |
| grep บรรทัดที่เพิ่มหา secret/token/password/turso | placeholder เท่านั้น (ดูเกต 8) |
| grep บรรทัดที่เพิ่มใน `src/components` หา `console.`/storage/`innerHTML`/http | ไม่พบ |

## สิ่งที่ตรวจไม่ได้ / ข้อจำกัด
- ไม่ได้รัน e2e Playwright (`r6f-daily-busy.spec.ts`, `r6f-layout.spec.ts`) — worktree ใช้ร่วมกับ qa/ops และ e2e บน Windows เคยชน `.next`/`test-results` · RSC payload ของหน้าเว็บยืนยันแบบ 📖 (หน้าเรียก service เดียวกับ API ที่ ✅ แล้ว) · ผลจริงดูจาก CI
- ไม่ได้ทดสอบการแข่งกับ Turso remote จริง (Info 5)
- ไม่ได้รัน `npm test` ทั้งชุด (EPERM/timeout เดิมบน Windows)
