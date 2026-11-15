# qa-r15a — ตรวจอิสระ R15a (ไอคอนกลุ่ม · เว้นบางวัน · เปิดเหมือนแอป · ปรับหน้าจอเล็กน้อย · migration 0006)

ผู้ตรวจ: qa · branch `feat/r15a-feedback` (ฐาน `4c5681b` v0.12.0) · เครื่อง Windows, Node v26 · 2026-11-16
ขอบเขต: R15-1 ถึง R15-5, R15-8 (ฝั่ง local) · security ตรวจแยกพร้อมกัน (`security-r15a.md`)

## Verdict: ผ่านแบบมีข้อสังเกต
พบ 1 บั๊กหน้าจอ (แถบขั้นตอนที่ขั้น "เสร็จแล้ว" บีบชื่อขั้นเหลือตัวอักษรเดียวต่อบรรทัดที่ 375/390 EN และขั้น 2–3 ที่ 768) — **แก้แล้ว** `f612b0b` · ที่เหลือเป็นข้อสังเกตเล็ก ไม่บล็อก · R15-4 (iPhone จริง) เป็นของ boss ตรวจไม่ได้ในเครื่องนี้

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 · 1 warning (`tests/e2e/r15a-feedback.spec.ts:138 'SkipRes' is defined but never used`) |
| `bash .github/scripts/check-style-literals.sh src` | "ไม่มีค่าสี hex / px นอก tokens" (ก่อนและหลังแก้ CSS) |
| `npm run contrast` | 338 คู่ ไม่ผ่าน 0 · ต่ำสุด 4.54:1 · token สว่าง/มืดตรงกัน |
| `npm run build` | exit 0 · มีเส้นทาง `/manifest.webmanifest` (static) |
| `npx drizzle-kit check` | "Everything's fine" |
| `vitest run` ทั้งชุด (shim EPERM) | 5711 ผ่าน / 23 ล้ม / 19 skip (15 ไฟล์ล้ม จาก 166) → จำแนกด้านล่าง |
| `vitest run <9 ไฟล์ที่ timeout> --testTimeout=60000 --no-file-parallelism` | **156/156 ผ่าน** (9 ไฟล์) |
| `playwright test tests/e2e/r15a-feedback.spec.ts --workers=2` | **34 ผ่าน / 2 skip (manifest รันที่ mobile-390 ตัวเดียวโดยออกแบบ) / 0 ล้ม / 0 flaky** (4.5 นาที) |
| `playwright test --workers=2` ทั้งชุด | 1038 ผ่าน / 128 skip / 0 ล้ม / 1 flaky (admin.spec.ts:126 ผ่านเมื่อ retry) · 35.9 นาที |

การจำแนก vitest ที่ล้ม:
- **ของเครื่อง (ไม่เกี่ยว R15a):** `calendar/free-time.test.ts:103` oracle.py (ไม่มี Python) · `ops/health.test.ts:91` (Node v26 ไม่ใช่ v24) · `ops/admin-reset-pin-script` 3 + `ops/pepper-fingerprint-script` 4 (subprocess/tsx) · `release/release.test.ts:364,382` (`.bin/tsx`) · `security/config-hygiene.test.ts:139` x2 (CRLF) — ตรงกับที่ลงไว้ใน qa-r14a/r14b
- **timeout 5 วิ ภายใต้โหลดของ e2e ที่รันพร้อมกัน:** `admin/search`, `appointments/r4b-hardening`, `auth/ip-ratelimit`, `auth/is-admin`, `auth/security-r1`, `auth/session-race`, `busy/calendar-visibility`, `groups/invite-code`, `platform/r14-busy-routine` → รันซ้ำเดี่ยวผ่านหมด (156/156)

## migration 0006 (R15-1)
- SQL มี 2 คำสั่งเท่านั้น: `DROP TABLE place_search_cache` + `ALTER TABLE groups ADD icon text` · journal/snapshot ครบ (`drizzle-kit check` ผ่าน)
- สคริปต์ของฉัน (ไม่ commit): apply 0000–0005 → ใส่แถวใน `place_search_cache` → apply 0006 → ตารางที่หายมีแค่ `place_search_cache` ไม่มีตารางใหม่ · คอลัมน์ที่เพิ่มมีแค่ `groups.icon` (TEXT, nullable, ไม่มี default) ไม่มีคอลัมน์ไหนหาย · จำนวนแถวตารางอื่นไม่เปลี่ยน (ฐานทดสอบของผมว่างเกือบทั้งหมด ผมใส่ข้อมูลผู้ใช้ไม่สำเร็จเพราะชื่อตารางไม่ตรง — การพิสูจน์ "ข้อมูลเดิมไม่เปลี่ยน" อาศัย SQL ที่เป็น ADD COLUMN/DROP TABLE ล้วน + เทสต์ของผู้ทำ)
- เทสต์ `tests/platform/migration-0006.test.ts` (ผู้ทำ) อยู่ในชุดที่ผ่าน
- ฐาน prod/preview ที่มีข้อมูล R14 จริง: ตรวจไม่ได้ (ต้องรันกับ boss ตาม memory "Migration before merge")

## ตารางเกณฑ์
| # | ผล | หลักฐาน |
|---|---|---|
| R15-1 | ผ่าน (local) | ดูหัวข้อ migration |
| R15-2 เว้นหลายวัน | ผ่าน | e2e (th/light, en/dark x 3 จอ): ชุดทั้งเดือน → เว้น 2 วันคำขอเดียว (ยืนยัน body `{"add":[d1,d2]}` คำขอเดียว) → บัญชีอื่นเห็นว่าง → เอากลับ 1 วัน → กลับมาไม่ว่าง · เพดาน 31 · error ทุกแบบไม่ล้างวันที่เลือก · **มือผ่าน HTTP จริง:** เว้น 2 วัน (skipped=2) → แก้ทั้งชุดเปลี่ยนเวลา (200) → วันที่เว้น **ไม่ฟื้น** (rows 12 คงเดิม, list.skippedDates เดิม) → เอากลับ 1 วัน ได้แถวใหม่ตามเวลาใหม่ 11:00 (04:00Z) · past → 400 `dates:{d:PAST}` · add+remove วันเดียวกัน → `IN_BOTH` · ว่าง → `REQUIRED` · key แปลก → `UNKNOWN_FIELD` · บัญชีอื่น → 404 NOT_FOUND และไม่เห็นชุดของเรา |
| R15-2 วันที่เคยแยกแก้ | ผ่านตามออกแบบ | ADR 0012 §13 + เทสต์ platform (`r15-routine-skips`): add ไม่ลบแถวเดี่ยว · remove = คืน occurrence + แถวเดี่ยวคงอยู่ (2 แถว) · UI มี `restoreNote` ในแท็บเอากลับ (เห็นในภาพ th/light 375) |
| R15-3 ไอคอนกลุ่ม | ผ่าน | e2e: admin+moderator ตั้งได้ผ่าน UI · member ไม่มีปุ่ม + PUT → 403 · คนนอก 404 · ไม่ล็อกอิน 401 · "แมว"→เก็บ null · โผล่ที่การ์ดกลุ่ม/หัวปฏิทิน/แผ่นสลับกลุ่ม/หน้าหลักของสมาชิกอีกคน · **มือ:** `coffee`/`null`/`cat` ผ่าน (cat→null) · `<script>`, URL, emoji, สตริงว่าง → 400 `icon:INVALID` · **คีย์แปลกในฐาน** (UPDATE groups.icon='not-a-key') → API ส่ง `null` และการ์ดกลุ่ม/หน้าตั้งค่า/หัวปฏิทินแสดง `data-icon="cat"` ไม่ error |
| R15-3 เลือกไอคอน a11y | ผ่าน | `role=radiogroup`/`radio` + `aria-checked` + roving tabindex + ลูกศรเลื่อน (4 คอลัมน์มือถือ/6 คอลัมน์ ตั้งแต่ 768) · ตัวที่เลือก = กรอบหนา + พื้นสี + **วงกลมติ๊กมุมขวาบน** (ไม่พึ่งสีอย่างเดียว) — เห็นในภาพ th/light 375 · 24 แบบครบ ชื่อ TH/EN ทุกแบบ · (การกดลูกศรจริงในเบราว์เซอร์: ผมอ่านโค้ด `onKeyDown`/`movePick` + เทสต์ unit; ไม่ได้กดแป้นเอง) |
| R15-4 | ตรวจได้บางส่วน | production build: `<link rel=manifest>`, `apple-touch-icon` (180), `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style=default`, `mobile-web-app-capable=yes`, `viewport-fit=cover`, theme-color สองธีม · manifest: id/start_url/scope `/`, `display: standalone`, 192 any + 512 any + 512 maskable (แยก ไม่รวม) · ไอคอนดูด้วยตา 4 ไฟล์ถูกต้อง: ขนาด 180/192/512/512 · apple-touch และ maskable เป็น RGB ทึบ (ไม่มี alpha) · แมวอยู่กลางภาพในโซนปลอดภัย · `/manifest.webmanifest` ตอบ 200 โดยไม่ล็อกอิน · **ตรวจไม่ได้:** iPhone จริง/แถบ Safari/ลิงก์ภายนอกในโหมดแอป/logout-login ในโหมดแอป (T3 ของ boss) · safe-area บนอ่านจาก CSS (`env(safe-area-inset-top)` ที่ `.topbar` และ `.nav-progress`) จำลองใน Chromium ไม่ได้ |
| R15-5 ข้อ 1.4 | ผ่าน (มีแก้ 1) | ฟอร์มประจำ: `visibilityHide` ย้ายเข้าเนื้อฟอร์ม แถบล่าง = 2 บรรทัด + ปุ่ม ที่ 375 en (ภาพ) · ขั้น 3 เสร็จหลังเปิดดูวันว่าง (e2e ผ่าน + **บั๊กเลย์เอาต์ ดูข้อพบ 1**) · "Set hours" 1 บรรทัดที่ 375 EN และ "เฉพาะช่วงเวลา" 1 บรรทัดที่ 375/390 TH (ปุ่ม 44px) · ปุ่มแผนที่ 768: grid 2 คอลัมน์เท่ากัน (CSS) · ผมเห็นปุ่มเดียว (Google, ชื่ออย่างเดียว) ใน Chromium เพราะ Apple ขึ้นเฉพาะ iOS — เทสต์ r13 ยืนยันลำดับสองปุ่ม · /privacy: มีข้อ `busyStatus` TH/EN (e2e) · NavProgress/skeleton >= 250ms: เทสต์ unit ผ่าน (ไม่ได้ดูด้วยตา) |
| ปุ่ม >= 44px | ผ่าน | `checkLayout` ของ e2e ทุกหน้าใหม่ ผ่าน 3 จอ · ผมวัดเพิ่ม: ปุ่ม "เว้นบางวัน" 127x44 ที่ 375 · ปุ่ม/ช่อง/สวิตช์ทุกตัวในฟอร์มประจำ ที่ 375/390/768 x 4 combo = ไม่มีตัวเล็กกว่า 44 · ไม่มี horizontal scroll (overflow 0) |
| ไม่มี hard-code | ผ่าน | `RoutineSkipSheet`/`IconSection`/`GroupIcon`: ทุกข้อความผ่าน `t()` · คีย์ TH/EN คู่กันครบ |
| TH/EN เป็นธรรมชาติ | ผ่าน | อ่านทั้งชุดข้อความใหม่: "เว้นบางวัน / เอากลับ" กับ "Skip some days / Bring back", ข้อความ error บอกว่า "ยังไม่มีอะไรเปลี่ยน / Nothing changed" ตรงกันทุกกรณี · EN "Football" สำหรับ soccer เหมาะกับผู้ใช้ไทย |
| Anti-slop | ผ่าน | ปุ่มหลักสีเดียว (ปุ่มยืนยัน) รองเป็นขอบ · ไม่มีไล่สี/เงาใหม่/อีโมจิ · ไอคอนชุดเดียว (Lucide + 2 วาดเอง badminton/soccer สไตล์เดียวกัน) · วันที่เว้น = ลายเฉียง + ขีดฆ่า + aria (ไม่พึ่งสี) · ไม่มี token สี/ระยะใหม่ (style-literal ผ่าน) |
| R15-8 | ผ่านบางส่วน | lint/tsc/build/contrast/vitest/e2e local ตามตาราง · **CI/Vercel/preview migration ตรวจไม่ได้** (ยังไม่เปิด PR) · security รายงานแยก |

## ภาพที่ดูจริง (ภาพจาก e2e + สคริปต์ของฉัน ที่ 375/390/768)
ตัวเลือกไอคอน th/light 375 · แผ่นสลับกลุ่ม en/dark 375 · การ์ดกลุ่ม th/light 768 · แผ่นเว้นบางวัน: เลือกแล้ว en/dark 375, แท็บเอากลับ th/light 375 (ลายเฉียง+ขีดฆ่า+restoreNote), ครบ 31 วัน th/light 768 (วันที่เหลือล็อก + แถบเตือน) · ขั้น 3 en/dark 390 (พบบั๊ก) · การ์ดแบบประจำ+ปุ่ม "เว้นบางวัน" th/light 375 (ชื่อ 60 ตัวไม่ล้น) · ฟอร์มประจำ en/light 375 · ฟอร์ม busy "Set hours" en/light 375 · รายละเอียดนัด + ปุ่มแผนที่ en/dark 768 · ไอคอนแอป 4 ไฟล์ · combo ที่ไม่ได้ไล่ดูทีละใบ (ผ่าน `checkLayout` อัตโนมัติเท่านั้น): th/dark และ en/light ของแผ่นเลือกไอคอน/เว้นบางวัน

## ข้อพบ (เรียงตามความรุนแรง)
1. **(กลาง · แก้แล้ว `f612b0b`) แถบขั้นตอน ขั้นที่ "เสร็จแล้ว" บีบชื่อเหลือตัวอักษรเดียวต่อบรรทัด** — `src/components/groups/groups.css:79,82,85` · ขั้น 3 หลังเปิดดูวันว่าง (ฟีเจอร์ใหม่ของรอบนี้) มีทั้งป้าย "Done" + ลิงก์ "Take another look" + ลูกศร แถวเดียว `nowrap` → ที่ 375/390 EN ชื่อ "See when everyone's free" ถูกบีบเป็น "See / whe / n / ever / yone' / s / free" · ที่ 768 (กริด 4 คอลัมน์) ขั้น 2 และ 3 ที่เสร็จแล้วบีบเหลือ 1–2 ตัวอักษรต่อบรรทัดเช่นกัน ("Ad/d/you/r…") — ส่วน 768 ขั้น 2 มีมาตั้งแต่ R8 · `checkLayout` ของ e2e ไม่จับ (ไม่ใช่ overflow แนวนอน/ปุ่มเล็ก) · แก้: `.steps-row` เป็น `flex-wrap: wrap`, `.steps-text` `flex: 1 1 40%`, ลูกศร `margin-left: auto` → ป้าย/ลิงก์ลงบรรทัดถัดไปเมื่อไม่พอ · ตรวจด้วยการฉีด CSS ใหม่เข้าหน้าจริง 375 en/dark, 375 th/light, 390 en/light, 768 en/light: ชื่อขั้นอ่านครบ · **หมายเหตุ:** ไม่ได้ rebuild/รัน e2e ทั้งชุดซ้ำหลังแก้ CSS (ชุดเต็มรันบน build เดิมก่อนแก้) — เป็น CSS ล้วน · ข้อเสนอ: เพิ่มเช็กความกว้างของ `.steps-text` ในสเปก step3 กันถอย
2. **(ต่ำ) ลิงก์ "Take another look" ที่ขึ้นบรรทัดใหม่ชิดซ้ายใต้ไอคอนติ๊ก** (ที่ 375) ไม่เยื้องเท่าชื่อขั้น — อ่านได้ แค่ไม่เนี้ยบ
3. **(ต่ำ) legend แท็บเอากลับ**: ช่อง "วันของชุดนี้" วาดเป็นสี่เหลี่ยมขาว แต่วันที่เหลือ (ที่ล็อก) ในแท็บเอากลับเป็นสีเบจ — ไม่ตรงกันเล็กน้อย (th/light 375)
4. **(ต่ำ) ปล่อยแค่ `mobile-web-app-capable`** — Next ปล่อย `mobile-web-app-capable=yes` แต่ไม่ปล่อย `apple-mobile-web-app-capable` · iOS 16.4+ ใช้ manifest `display: standalone` อยู่แล้ว น่าจะเปิดเต็มจอได้ แต่ต้องยืนยันบนเครื่องจริง (T3) · ถ้า T3 ไม่เป็นแอป ให้เพิ่ม `other: { 'apple-mobile-web-app-capable': 'yes' }` ใน `generateMetadata`
5. **(ต่ำ) lint warning** `tests/e2e/r15a-feedback.spec.ts:138` type `SkipRes` ไม่ได้ใช้ (ไฟล์ของ test ไม่ได้แก้เอง)
6. **(ข้อมูล) วันที่เคยแยกแก้ + เอาวันของชุดกลับ = มีสองรายการ** เป็นพฤติกรรมที่ออกแบบและแจ้งผู้ใช้แล้ว (restoreNote) ไม่ใช่บั๊ก

## สิ่งที่ผมแก้
- `f612b0b` `qa: wrap step row so done badge and 'Take another look' no longer squeeze the title (375/390/768)` — `src/components/groups/groups.css` (3 บรรทัด ไม่มีค่าสี/px ใหม่; style-literal ผ่าน)

## ที่ตรวจไม่ได้ / ข้อจำกัด
- iPhone จริง (R15-4/T3) · Safari แถบ/โหมดแอป/ลิงก์ภายนอก/logout-login ในโหมดแอป · safe area จริง
- migration 0006 กับฐาน prod/preview จริง (ต้องรันกับ boss ก่อน merge) · CI/Vercel (ยังไม่เปิด PR)
- ปุ่ม Apple Maps (ขึ้นเฉพาะ iOS) ที่ 768 เห็นด้วยตาไม่ได้ — อาศัย CSS + เทสต์ r13
- ไม่ได้ดูภาพทุกใบของทุก combo · ไม่ได้กดแป้นลูกศรในตัวเลือกไอคอนด้วยมือ
- vitest ทั้งชุดรันพร้อม playwright จึงมี timeout (รันซ้ำเดี่ยวผ่านหมด)

## playwright ทั้งชุด
`playwright test --workers=2` (HEAD ก่อนแก้ CSS `f612b0b`, build เดิม): **1038 ผ่าน / 128 skip / 0 ล้ม / 1 flaky** (35.9 นาที) · flaky = `admin.spec.ts:126` "เรื่องราว en: SA เปิดรายละเอียดกลุ่ม → โอน admin → ลบกลุ่ม" ที่ mobile-390 ล้มรอบแรก (3.1 วิ) ผ่านเมื่อ retry · ไฟล์นี้ไม่ถูกแตะใน R15a (ไม่ได้สืบสาเหตุ — น่าจะ SQLITE_BUSY/โหลดเครื่อง; แจ้ง test ถ้าเจอซ้ำใน CI) · ไม่มี port/เซิร์ฟเวอร์ค้างจากก่อนรัน
