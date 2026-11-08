# QA R8 — F1 onboarding + privacy copy (branch feat/r8-onboarding)

ผู้ตรวจ: qa (อิสระ) · 2026-11-08 · ตรวจ `git log main..HEAD` (7 commit) ตาม R8_CONTRACT §5

## Verdict: ผ่านแบบมีข้อสังเกต
พบบั๊ก a11y/visual 1 จุดและแก้แล้ว (commit `qa:` ด้านล่าง) · ที่เหลือเป็นข้อเสนอระดับต่ำ ไม่บล็อก

## ข้อพบ
| # | ระดับ | เรื่อง |
|---|---|---|
| 1 | M (แก้แล้ว) | การ์ดแนะนำหน้าหลัก `<ol>` ไม่แสดงเลข 1-4: `src/app/globals.css:96` รีเซ็ต `ol { list-style: none }` และ `.intro-card ol` (`src/components/groups/groups.css:112`) ไม่ตั้งคืน → เห็นเป็นข้อความไม่มีเลข (ภาพ en-dark 390 ก่อนแก้) ทั้งที่หัวข้อบอก "4 ขั้น" และเป็นลำดับ · แก้: `list-style: decimal` · ยืนยันด้วยภาพ th-light 375 หลังแก้ (1.–4. แสดง) |
| 2 | L | (a) ปุ่ม "สร้างนัด" ซ้ำ: ตอนแถบขยาย (ขั้น 4) ปุ่มอยู่ใน step 4 และใน btn-row เดิมห่างกันราว 150px (ภาพ steps-two 375) → รก/ไม่ชัดว่าปุ่มไหนหลัก แนะนำ: ซ่อน btn-row ปุ่มสร้างนัดเมื่อแถบยังไม่ allDone (เหลือ "ชวนเพื่อน") หรือทำปุ่มขั้น 4 เป็นลิงก์ข้อความ · ไม่บล็อก (ปุ่ม primary ในแถบมีเพียงขั้นถัดไป จึงลำดับความสำคัญยังอ่านออก) |
| 3 | L | (b) ขั้น 2 ปุ่ม "ลงวันไม่ว่าง" พาไปปฏิทินเดือน ไม่ได้เปิดฟอร์ม → ป้ายปุ่มสัญญาว่าลงได้ แต่ต้องกดต่ออีก 1-2 ครั้ง · contract §2.1 อนุญาต ("เปิดฟอร์ม / ไปปฏิทิน") จึงผ่าน แต่ถ้าปรับเป็น "ไปปฏิทิน" หรือเปิดฟอร์มตรงจะลดการหลุดทาง (เสนอรอบหลัง) |
| 4 | L | (c) ขั้น 3 เป็น "ถัดไป" ค้างจนมีนัด: สอดคล้อง contract (ไม่มีสถานะเสร็จ) และสมเหตุผล (ขั้น 3 ต้องมาก่อนสร้างนัด) ยอมรับได้ · ข้อสังเกต: ผู้ใช้ที่ดูวันว่างแล้วไม่ได้รับสัญญาณตอบกลับ |
| 5 | L | แถบขยายหลัง allDone: ขั้น 4 มีทั้งป้าย "เสร็จแล้ว" และปุ่มสร้างนัด แถวแน่น ชื่อขั้นตัดบรรทัด ("Make a / plan" ที่ 390 en) ไม่ล้น · `.steps-list` ใช้ `list-style:none` Safari/VoiceOver อาจไม่ประกาศเป็นรายการ (มี aria-label บน ol; แก้ได้ด้วย role="list") |

## ตรวจตามเกณฑ์
- R8-1: `/privacy` ไม่มี "รับรอง"/"ร่างล่าสุด" ใน messages และ src/app/privacy (grep ว่าง ยกเว้นคอมเมนต์ที่ตั้งใจบอกว่าไม่ต้องรอรับรอง) · ใช้ "อัปเดตล่าสุด / Last updated" ทั้ง 2 ภาษา · e2e privacy ผ่าน
- R8-2: steps-model Vitest + e2e (solo → เพื่อนเข้า → ลง busy → สร้างนัด → ยุบ/ขยาย) ผ่านครบ
- R8-3: `listMembersWithUpcomingBusy` query เดียว (EXISTS) ส่ง boolean เท่านั้น ใช้ผ่าน service เดิมที่ authorize `group.view` ก่อน (คนนอก → 404) · เทสต์ r8-has-upcoming-busy 7 ข้อผ่าน (ขอบ 30 วัน, ไม่ใช่ busy ที่ "ไป", ไม่รั่วข้ามกลุ่ม, DTO ไม่มี title/note)
- R8-4: เพดาน `/groups/[gid]` คง 11 และ API คง 3 (+0) · r7-baseline เทสต์ผ่าน
- R8-5: e2e การ์ดแนะนำ: เห็น → ปิด → โหลดซ้ำไม่เห็น → /me "วิธีใช้งาน" รีเซ็ต · localStorage โยน error → ยังแสดง กดปิดได้ ไม่มี pageerror/console error (watchConsole ว่าง = ไม่มี hydration warning) · ใช้ useSyncExternalStore server snapshot "pending" จึงไม่ mismatch
- R8-6: ไม่มี hard-code (ข้อความทั้งหมดผ่าน messages) · i18n test ผ่าน · layout check ใน e2e: ไม่ล้นแนวนอน และ a/button ทุกตัว ≥ 44px ที่ 375/390/768 × th/en × light/dark · ดูภาพจริง: คอนทราสต์ป้าย "ยังไม่ได้ลง/No busy days yet" (tag-warn) ทั้งสว่าง/มืดอ่านชัด ไม่ใช้สีอย่างเดียว (มีข้อความ + sr-only hint + aria-label แถว) · ข้อความ TH/EN เป็นธรรมชาติ ไม่กล่าวหา
- a11y: ol มี aria-label · `aria-current="step"` เฉพาะขั้นถัดไป (ครบ → 0) · ปุ่มสลับมี aria-expanded/aria-controls · หลังกด "เข้าใจแล้ว" ย้ายโฟกัสไป h1 (tabIndex -1) · ลิงก์ /me "วิธีใช้งาน" มีคำอธิบายย่อย
- R8-7: `git diff main -- drizzle` ว่าง (0 ไบต์) · CI/Vercel preview ตรวจไม่ได้ในเครื่อง

## คำสั่งที่รัน + ผลจริง (Windows)
- `npx tsc --noEmit` → exit 0 ไม่มี error
- `npx eslint . --ignore-pattern ".claude/**"` → ไม่มี output (สะอาด)
- `npx vitest run tests/ui tests/i18n tests/platform/r8-has-upcoming-busy.test.ts tests/calendar/add-days-at.test.ts tests/perf/r7-baseline.test.ts tests/groups/members.test.ts` → 684 passed, 19 failed (703) · ล้มทั้งหมดเป็น `EPERM … rmSync` ที่ cleanup ของ temp DB (ปัญหาเดิมของ Windows; ไม่มี assertion ล้ม) · รัน verbose แยก r8-has-upcoming-busy + r7-baseline: 8/8 ข้อ ✓ (ไฟล์ถูกนับ FAIL เพราะ EPERM ตอน cleanup เท่านั้น)
- `npm run build` ผ่าน
- Playwright `tests/e2e/r8-onboarding.spec.ts --workers=1 --retries=0` ทั้ง 3 project → **30 passed (3.7m)** (ก่อนแก้ข้อ 1)
- หลังแก้ข้อ 1 + build ใหม่: `r8-onboarding + privacy + groups-story + groups-responsive --project=mobile-375 --workers=1 --retries=0 -g "th · light|privacy|story|responsive|ไม่ได้"` → **47 passed, 3 skipped (ตัวกรอง -g)** · ไม่ได้รันสเปกที่ได้รับผลกระทบทุกตัวบนทุก viewport หลังแก้ (ข้อแก้เป็น CSS บรรทัดเดียว)

## ตรวจไม่ได้
CI/Vercel preview · tests/security/config-hygiene (CRLF) · tests/release (tsx ENOENT) · npm test ทั้งชุด (EPERM) · ไม่ได้ดูภาพทุกชุด 30 ภาพด้วยตา (ดู 375/390/768 อย่างละ th/en × สว่าง/มืด ผสมกัน; ที่เหลือพึ่ง assertion layout/44px ของ e2e)
