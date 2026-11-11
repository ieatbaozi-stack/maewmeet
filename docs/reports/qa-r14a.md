# qa-r14a — ตรวจอิสระ R14a (busy แบบ routine ฝั่งเซิร์ฟเวอร์)

ผู้ตรวจ: qa · branch `feat/r14-busy-routine` @ `3805ce7` (ฐาน origin/main `98186ef`) · เครื่อง Windows, Node v26 · 2026-11-11
ขอบเขต: R14-1..R14-7 และ R14-9 (R14a ไม่มี UI → R14-8/R14-10 เป็นของ R14b)

## Verdict: ผ่านแบบมีข้อสังเกต
ไม่พบบั๊กที่ต้องแก้ ไม่ได้แก้โค้ดใด ๆ · มีข้อสังเกต 1 ข้อควรตัดสินก่อน R14b (ขนาด response ของ availability กรณีหนัก) และข้อเล็กอีก 5 ข้อ

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 (มี route `/api/me/busy-routines`, `/api/me/busy-routines/[id]`) |
| `vitest run` ทั้งชุด (shim EPERM) | 5504 ผ่าน / 17 ล้ม / 19 skip (157 ไฟล์) — 7 ไฟล์ที่ล้มเป็นเรื่องเครื่องทั้งหมด (ดูล่าง) |
| `vitest run tests/ops/manual-delete-sql.test.ts` หลังแปลง OPERATIONS.md เป็น LF ชั่วคราว (คืนไฟล์แล้ว) | 4/4 ผ่าน → ยืนยันว่า SQL ลบบัญชีด้วยมือที่เพิ่ม `busy_routine(_skip)` ถูกต้อง |
| `vitest run tests/perf/r14-routine-big-group.test.ts --silent=false` | ผ่าน (ตัวเลขข้างล่าง) |
| `playwright test --workers=4 --reporter=line` (ชุดเดิมทั้งหมด 3 viewport) | 969 ผ่าน / 126 skip / 0 ล้ม (17.1 นาที) |

17 ที่ล้มของ Vitest = เรื่องเครื่องที่รู้อยู่แล้ว ไม่แตะไฟล์ R14: free-time oracle.py (1) · config-hygiene CRLF (2) · ops/health Node v26 (1) · admin-reset-pin subprocess (3) · pepper-fingerprint subprocess (4) · release CLI tsx (2) · manual-delete-sql CRLF (4, ผ่านเมื่อ LF)

## ตารางเกณฑ์
| # | ผล | หลักฐาน |
|---|---|---|
| R14-1 | ผ่าน | `drizzle/0005_r14_busy_routine.sql` อ่านเอง: CREATE TABLE ใหม่ 2 + CREATE INDEX 2 + `ALTER TABLE busy_block ADD routine_id` เท่านั้น ไม่ rebuild · `migration-0005.test.ts` (สร้างฐานรูป R13 มีข้อมูล → apply → แถวเดิมครบทุกไบต์ `routine_id` NULL ทั้งหมด, apply ซ้ำไม่พัง) ผ่าน · OPERATIONS rollback เรียง DROP INDEX → DROP COLUMN ถูก |
| R14-2 | ผ่าน | สคริปต์ของฉันเอง (ลบแล้ว): ข้ามเที่ยงคืนข้ามปี 30 ธ.ค.→2 ม.ค. ครบ 4 แถว ยาว 8 ชม. · 23:00–24:00 ก.พ. 2028 (27 ก.พ.–1 มี.ค. มี 29) 4 แถว 60 นาที · เดือน ก.พ. 2028 → 29 วัน, 2027 → 28 วัน · NY 02:00 วันที่ 14 มี.ค. ปฏิเสธ (field startTime), 23:00–02:30 จบในช่องว่างปฏิเสธ (field endTime), fold พ.ย. ผ่าน 14 แถว · Lord Howe 02:00 ต.ค. ปฏิเสธ · 00:00–00:00 = 0..1440 ทั้งวัน · 23:30–24:00 ไม่ข้ามวัน · เริ่ม 24:00/เริ่มเท่าจบ/09:15 ปฏิเสธถูกรหัส · 0 วัน = `NO_OCCURRENCE` |
| R14-3 | ผ่าน | integration ของฉัน: สร้าง 10 ชุดแล้วชุดที่ 11 → 409 `LIMIT_REACHED routines max 10` · แก้ "ตั้งแต่…ไป" แบบแยกตอนมี 10 ชุด → 200 (B12) แล้ว `busy_routine` = 11 แถว ชุดใหม่ยังสร้างไม่ได้ · 8 ชุด ทุกวัน 182 วัน = 1,456 แถว ชุดที่ 9 → 409 `routineRows max 1500` และ DB ยังเป็น 1,456 แถว/8 ชุด (atomic) · วันที่แยกด้วย PATCH `/api/me/busy/:id` → `routine_id` NULL นับเป็น busy เดี่ยว (1) · เทสต์ทีม `r14-caps-concurrency` + `r14-busy-routine` ผ่าน · อ่านโค้ด: ทุกเพดานเป็นเงื่อนไขในคำสั่ง INSERT/UPDATE เดียว (`repos/busy-routine.ts` 77–125, 189–204) ไม่มี check-then-act · `windowCount` นับ `routine_id IS NULL` |
| R14-4 | ผ่าน | ลบวันเดียวแล้ว PATCH ทั้งชุด → วันนั้นไม่ฟื้น (5 วัน → 4) · แยกวันแล้ว PATCH ทั้งชุด → วันที่แยกไม่ฟื้น · ลบทั้งหมด → 200 `scope:all count:3` skip เหลือ 0 · แยก (split) ย้าย skip ≥ from ไปชุดใหม่ ลบแถวเดิม ≥ from · แถวอดีต/วันที่แยกแล้วไม่ถูกแตะ (ดูข้อสังเกต 3) |
| R14-5 | ผ่าน | bob PATCH/DELETE routine ของ alice → 404 ทั้งคู่ · action `busy.routine.update/delete` = `ownerOnly` (SA ไม่ผ่าน), `list.own/create` = `anyUser` · body `.strict()` · ปฏิทินกลุ่มที่ bob ดู (13 KB) ไม่มีสตริง routine/weekdays/rangeKind · `repos/busy.ts` ฝั่งแชร์ไม่ SELECT `routine_id` · security ตรวจลึกแยกอีกชุด |
| R14-6 | ผ่านแบบมีข้อสังเกต | ดูตัวเลขด้านล่าง: ไม่มี `truncated` ในทางวันว่างทั้ง 2 กรณี (สูงสุด 21.9% ของเพดาน 32,000) · `mergeBusyForFreeTime` มีเทสต์เทียบผล `free-time-merge.test.ts` ผ่าน · ข้อสังเกต 1 เรื่องขนาด response |
| R14-7 | ผ่าน | `account.ts` ลบ `busy_routine` เอง · `maintenance.ts` ลบ routine ที่ `end_date < วันนี้ − 93 วัน` หลัง `oldBusyBlocks` ใน batch เดียว (ส่วนเผื่อ 3 วันครอบกรณีข้ามคืน/ต่าง tz — ตรวจเลขแล้วถูก) · เทสต์ cron/account/manual-delete-sql ผ่าน · OPERATIONS ตรงโค้ด (ถัง `busy:routine` 20/10 นาที, 93 วัน) |
| R14-9 | ผ่านบางส่วน | lint/tsc/build/vitest/e2e ในเครื่องเขียว (ยกเว้นเรื่องเครื่อง) · CI/Vercel ดูหลังเปิด PR · README/quickstart ไม่ต้องแก้ใน R14a (ไม่มี UI; memory ระบุให้ทำใน R14b) |

## ตัวเลข perf (รันซ้ำเอง, libSQL ในเครื่อง, กลุ่ม 50 คน)
| กรณี | route | วัน | แถวใน DB | เพดาน | truncated | % เพดาน | bytes |
|---|---|---|---|---|---|---|---|
| A | calendar | 42 | 3,150 | 5,000 | false | 63 | 834 KB |
| A | availability | 62 | 4,650 | 32,000 | false | 14.5 | 1.49 MB |
| B | calendar | 42 | 4,650 | 5,000 | false | 93 | 1.23 MB |
| B | availability | 62 | 7,000 | 32,000 | false | 21.9 | 1.80 MB |
| B | appointments/check | 1 | 400 | 32,000 | false | 1.3 | 19 KB |

## ข้อสังเกต (เรียงตามความรุนแรง — ไม่มีข้อใดบล็อก)
1. **(กลาง) เพดานตอบ availability สูงขึ้นกว่าก่อน R14** — `FREE_TIME_MAX_ITEMS = 32,000` ใช้ทั้งทางคำนวณและรายการ `busy[]` ที่ส่งให้ client (`services/availability.ts:119`) ก่อน R14 เพดานคือ 5,000 แถว (~1.5 MB) ตอนนี้กรณี B วัด 1.8 MB ที่ 7,000 แถว; ประมาณเอง (ไม่ได้วัด) ถ้าแถวเต็ม 32,000 ≈ 330 ไบต์/แถว × 32,000 ≈ 10 MB ซึ่งเกินเพดานก่อนหน้า ~6 เท่า และน่าจะเกินขีดจำกัด response 4.5 MB ของ Vercel serverless (ผมไม่ได้ยืนยันกับ Vercel จริง) → เสี่ยง error/ช้าบนมือถือ แนะนำ R14b: ลดขนาด `busy[]` (ส่งเฉพาะแถวที่ client ต้องใช้ หรือรวมช่วงในฝั่งเซิร์ฟเวอร์ หรือ cap รายการที่ส่งไว้ 5,000 แต่ยังคำนวณจาก 32,000) — main ตั้ง deferred ไว้แล้ว ยืนยันว่าควรทำก่อนให้ผู้ใช้จริงลง routine หนัก
2. (ต่ำ) การแก้แบบแยกชุด (B12 ยกเว้นเพดาน 10) ทำให้ `busy_routine` ที่ยังไม่จบเกิน 10 ได้ (ทดสอบแล้ว 11) ถูกจำกัดโดยเพดาน 1,500 แถวเท่านั้น และ `GET /api/me/busy-routines` ตัดที่ 50 ชุด (`BUSY_ROUTINE_LIST_MAX`, field `truncated`) — ผู้ใช้ที่แยกชุดซ้ำ ๆ จะมีชุดที่มองไม่เห็นในรายการ R14b ควรแสดงเมื่อ `truncated:true` หรือชุดที่ถูกตัดวันจบ (`previous`) ที่ไม่เหลือวันแล้วควรถูกเก็บกวาด
3. (ต่ำ) `deleteRoutine` แบบ from (`services/busy-routines.ts:376-385`) ใช้ `cut = max(from ปัดแล้ว, วันนี้)` และลบแถว `local_start_date >= cut` → แถวของ "วันนี้" ที่จบไปแล้ว (เช่น 09:00–12:00 ตอน 15:00) ถูกลบด้วย ตรงกับ "ตั้งแต่…ไป" แบบนับวันนี้ แต่ UX ควรรู้ (สัญญาเขียนว่า "วันก่อนหน้าคงเดิม" — วันนี้ไม่ใช่วันก่อนหน้า จึงไม่ขัด)
4. (ต่ำ) `errors.LIMIT_REACHED` เคส `routineSpan` (ใช้เป็น fallback เท่านั้น) บอกแค่ "ไม่เกิน {max}" ไม่มีหน่วยสัปดาห์/เดือน — ฟอร์มจริงใช้ `busy.routine.error.spanWeeks/spanMonths` (มีหน่วย) จึงไม่กระทบ ถ้า frontend เรียก fallback ตรงจะกำกวม
5. (ต่ำ) คำศัพท์ไม่ตรงกัน: OPERATIONS.md ใช้ "กิจวัตร" ส่วน UI/ข้อความใช้ "แบบประจำ" (contract ใช้ routine) — แนะนำ ops/secretary ปรับให้ตรงกันตอน R14b
6. (ข้อมูล) ข้อความ error ครบ: key ใน `messages/th.json` กับ `en.json` เท่ากันทุกคีย์ (ตรวจด้วย node: en-only 0, th-only 0) · รูป error ของเซิร์ฟเวอร์ (`LIMIT_REACHED {limit,max,rangeKind?}`, `INVALID_RANGE {kind:'dates',reason:'ENDED'|…}`, `INVALID_LOCAL_TIME`, `VALIDATION fields.weekdays=REQUIRED|NO_OCCURRENCE`, `NOT_FOUND`, `RATE_LIMITED`, `CONFLICT`) ตรงตารางในดีไซน์โน้ต §6 และมีข้อความ TH/EN อ่านเป็นธรรมชาติ ไม่ใช่แปลตรง

## ที่ตรวจไม่ได้
- CI/Vercel (ยังไม่เปิด PR) · migration กับฐาน Turso จริง (เป็นของ boss ตาม OPERATIONS) · ภาพหน้าจอ/a11y/คอนทราสต์ (R14a ไม่มี UI — ux แจ้งไว้ใน design note §9 แล้ว) · ขนาด response 32,000 แถว (ประมาณจากสัดส่วน ไม่ได้รันกรณีนั้น) · e2e ใหม่ของ routine ไม่มี (R14b)

---

## Re-review หลังแก้ตาม §10 (HEAD `7b9d21e`, 2026-11-11)

**Verdict: ผ่าน** — ข้อ 1–5 ของรอบแรกถูกแก้/รับทราบครบ ไม่พบ regression

| คำสั่ง | ผลจริง |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `vitest run` ทั้งชุด (shim EPERM) | 5510 ผ่าน / 17 ล้ม / 19 skip — 7 ไฟล์เดิมที่เป็นเรื่องเครื่อง (free-time oracle 1, admin-reset-pin 3, health 1, manual-delete-sql 4 CRLF, pepper-fingerprint 4, release CLI 2, config-hygiene 2) ไม่มีไฟล์ใหม่ล้ม |
| `vitest run tests/admin tests/availability` ซ้ำ 5 รอบ | 66/66 ผ่านทั้ง 5 รอบ → admin/search cursor flake ไม่เกิดซ้ำ |
| `availability-perf.test.ts` 3 รอบ (รวม merge) | median 36.1 / 35.9 / 35.8 ms (เพดาน 200) → 201.5 ms ที่ test เห็นไม่เกิดซ้ำ น่าจะเป็นช่วงเครื่องโหลดตอนรันทั้งชุดขนาน |
| A/B: แก้ชั่วคราว `availability.ts` ให้ไม่เรียก `mergeBusyForFreeTime` (คืนไฟล์แล้ว `git status` สะอาด) 3 รอบ | median 49.9 / 38.2 / 41.1 ms → **merge ไม่เพิ่มต้นทุน** (มีมันเร็วกว่าเล็กน้อย) |
| `playwright test free- appt-story r6e --project=mobile-390` (DTO availability เพิ่ม field) | 15/15 ผ่าน · ไม่รันชุดเต็ม เพราะเปลี่ยนแค่ field เพิ่มใน JSON |

### ข้อสังเกตรอบแรกเทียบกับการแก้
1. **ขนาด availability** — แก้แล้ว: `busy[]` ส่งไม่เกิน `CALENDAR_MAX_ITEMS` 5,000 ชิ้น + `detailTruncated` (`services/availability.ts`); blockers กรองเฉพาะชิ้นที่ส่ง, `notFreeUserIds`/`segments` ยังคำนวณจากทุกแถว → เพดานตอบกลับไปเท่า pre-R14 · เทสต์ `availability-api` ครอบแล้ว
2. **วนแยกชุดเกิน 10** — แก้แล้ว: เพดานแข็ง 20 (`BUSY_ROUTINE_HARD_MAX_ACTIVE`) ในคำสั่ง INSERT เดียวกัน (B12 ยังข้าม 10 ได้) · แก้ในที่จนไม่เหลือวันอนาคต → `VALIDATION weekdays NO_OCCURRENCE` · `GET` คืนชุดที่ยังไม่จบครบ, `truncated` นับเฉพาะชุดที่จบแล้วเกิน 50 · เทสต์ใหม่ใน `r14-busy-routine.test.ts` ผ่าน
3. **หยุดตั้งแต่วันนี้ลบแถวที่จบแล้ว** — ยอมรับ; ข้อความ `scope.delete.fromHelp` บอกแล้วทั้ง TH/EN
4. **`routineSpan` ไม่มีหน่วย** — แก้แล้ว: ตัด "(ไม่เกิน {max})" ออกจาก fallback ทั้งสองภาษา (ไม่มีตัวเลขลอย)
5. **คำศัพท์ "กิจวัตร"** — ไม่เปลี่ยนในรอบนี้ (ไม่แตะ OPERATIONS) ยังเป็นข้อเล็กสำหรับ R14b

ที่แก้เพิ่มและตรวจโค้ดแล้วถูกต้อง: L1 `setOwnRoutineEndGuarded`/`deleteOwnRoutine` มี `userActive` ในคำสั่งเขียนเดียวกัน · Info 2 "วันนี้" ใช้ tz เดิมของชุด และ `rowsOf(plan, skip, today)` ไม่สร้างแถวก่อนวันนี้

### ข้อความใหม่ (อ่านแล้ว)
- `busy.routine.error.routinesEdit` TH "การแก้แบบนี้ต้องแยกเป็นอีกชุด แต่คุณมี…ครบ {max} ชุดแล้ว ยังไม่มีอะไรเปลี่ยน ลองแก้ “ทั้งหมดที่ยังไม่ถึง” แทน…" / EN "Changing it this way splits it into a second routine, but you already have {max} running…" — เป็นธรรมชาติ ตรงรูป server `LIMIT_REACHED {limit:'routines', max:20}` จากทางแยก (ชื่อปุ่มอ้างตรงกับ `scope.edit.all` ทั้งสองภาษา)
- `noOccurrenceEdit` TH/EN — ตรงรูป `VALIDATION fields.weekdays=NO_OCCURRENCE` จากการแก้ในที่ (frontend ต้องเลือกคีย์นี้เมื่อเป็นโหมดแก้ ไม่ใช่ `noOccurrence` ของโหมดสร้าง — ระบุใน design note แล้ว) · คำว่า "ยังไม่มีอะไรเปลี่ยน/Nothing was changed" ตรงกับพฤติกรรม rollback
- `availability.detailTruncated` TH/EN — อ่านเป็นธรรมชาติ ไม่โทษผู้ใช้ และบอกว่าวันว่างยังถูก ตรงความหมายของ flag
- คีย์ en/th ยังเท่ากัน (ตรวจรอบแรก; รอบนี้เพิ่มคู่ครบ 3 คีย์ทั้งสองภาษา)

ตรวจไม่ได้: CI/Vercel · ภาพ UI ของข้อความใหม่ (R14b)

---

## หมายเหตุ: CI PR #32 ล้มที่ `r6d-going-busy.spec.ts:120` (แก้ใน `cc1f9ba`)

**Verdict: การวิเคราะห์ถูก เป็นปัญหาของเทสต์ ไม่ใช่ regression ของแอป**
1. effect ที่ `replaceState` ใส่ `g`/`v`/`d` อยู่ใน `src/components/calendar/CalendarView.tsx` มาตั้งแต่ commit `1e11bc4` (R3) · `git diff origin/main...HEAD` ของ `src/components` และ `src/app` มีเฉพาะ API ใหม่ 3 ไฟล์ (`manifest.ts` + route `busy-routines`) ไม่แตะ UI → assert `/calendar$` แบบตรงตัวแข่งกับ effect นี้ (เกิดได้ทุกรุ่น ขึ้นกับจังหวะ)
2. regex ใหม่ตรวจโค้ดแล้ว: r6d `/calendar(\?(.*&)?g=<gidX>(&.*)?)?$` รับ `/calendar`, `?g=X&v=month&d=…`, `?v=month&g=X` และ **ปฏิเสธ** `g` ของกลุ่มอื่น (ส่วน query เป็น optional ทั้งก้อนแต่ถ้ามี `?` ต้องมี `g=X`) จึงยังพิสูจน์ว่าจำกลุ่ม X ได้ · aurora/shell `path(\?.*)?$` ยังกันไม่ให้ไปหน้าอื่น (ยังอยู่ท้าย URL) — ใช้ได้
3. รันจริง `npx playwright test tests/e2e/r6d-going-busy.spec.ts tests/e2e/aurora.spec.ts tests/e2e/shell.spec.ts --retries=0 --workers=1` (HEAD `cc1f9ba`, ทั้ง 3 project: mobile-375/390 + tablet-768): **144 ผ่าน / 12 skip / 0 ล้ม (8.9 นาที)** ไม่มี timeout ที่ workers=1 → ไม่ต้องเทียบกับ origin/main (ไม่เกิดปัญหาเครื่องให้เทียบ) · รายงานแบบ line ไม่แยกผลต่อ project (รวม 156 เทสต์ = 52 ต่อ project)
