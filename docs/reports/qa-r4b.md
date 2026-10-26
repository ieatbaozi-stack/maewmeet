# QA R4B — นัด / RSVP / สถานที่ / แจ้งเตือน / หน้าหลัก (independent review)

ผู้ตรวจ: QA (ไม่ใช่ผู้เขียน) · branch `r4b` HEAD `b7e93d0` · ช่วง `93c86e2..HEAD` · 2026-10-26 · Node 24.22
รันทั้งหมดในสำเนา repo แยก (`/home/claude/qa-r4b`, พอร์ต 3217, DB แยก, `--retries=0 --workers=2`) ไม่อิงใบรับรองของผู้ทำ

## Verdict
**ผ่านแบบมีเงื่อนไข — ไม่มี Critical/High** · Medium 3 ข้อ (RSVP เก่าฟื้นเมื่อกลับเข้ากลุ่ม, แก้เวลานัดที่กำลังเกิดอยู่ไม่ได้, ข้อความ "ตอบเป็นคนแรกได้เลย" บนนัดที่ยกเลิก) ควรแก้ก่อน merge · Low 7 ข้อ จดไว้ได้
ไม่พบ IDOR/รั่ว busy/XSS/คำเตือนรั่ว ในส่วนที่ตรวจ (canary ผ่าน) · ไม่พบ ECONNRESET/closed-browser ในทั้ง 3 ชุด e2e (ดูล่าง)

## เกต (รันซ้ำเอง)
| เกต | ผล |
|---|---|
| lint / typecheck / db:check | exit 0 ทั้งสาม |
| check-style-literals (`src`) | ผ่าน |
| contrast | 312 คู่ ไม่ผ่าน 0 · ต่ำสุด 4.54:1 · dark block ตรงกัน 66 token |
| build | ผ่าน |
| vitest เต็ม (1 รอบ) | 97/98 ไฟล์ ผ่าน, 4106 ผ่าน, 4 ล้มใน `tests/security/config-hygiene.test.ts` — **สำเนาไม่มี `.git`** (เทสต์ใช้ git) = ข้อจำกัดของ harness · รันไฟล์นั้นใน repo จริง: รอบแรกล้ม 2 ข้อ (ไม่ได้เก็บรายละเอียด), รอบที่ 2 และ 3 ผ่าน 12/12 → ดู L7 |
| e2e batch 1 `appt-story appt-validation appt-layout` | 18 passed / 12 skipped (skip = เรื่องเล่าเต็มเฉพาะ mobile-390 ตามสเปก) · 5.1 นาที |
| e2e batch 2 `free-story free-layout calendar-story calendar-layout calendar-errors busy-api groups-responsive` | 141 passed / 18 skipped · 20.4 นาที |
| e2e appt-layout เฉพาะ mobile-375 (เก็บภาพจริง) | 4 passed |
| flake ECONNRESET/closed-browser | **ไม่เกิดเลย** ใน 3 ชุด (grep ทั้ง log และ stderr ของเซิร์ฟเวอร์ที่ Playwright pipe: ไม่มี) → ยังสรุปสาเหตุของ flake เดิมไม่ได้; ไม่มีหลักฐานว่าเป็นเซิร์ฟเวอร์ crash |

เทสต์ repro ของ QA (ไม่ commit) อยู่ที่ scratchpad `qa/qa-repro.test.ts`, `qa/parse.test.ts`

## ผลตามเกต R4B
| เกต | ผล | หมายเหตุ |
|---|---|---|
| R4B-1 สร้างนัด | PASS (+M2) | validation, strict schema, ข้ามเที่ยงคืน/เดือน/ปี, Europe/London DST ผ่านเทสต์เดิม · ดู M2 |
| R4B-2 สิทธิ์ | PASS | ตรวจอ่านโค้ด: authorize แรกทุกฟังก์ชัน, เขียนเป็น SQL เดียว+ActorGuard · เมทริกซ์เดิมผ่านใน vitest · L1 (API แก้นัดที่จบแล้วได้) |
| R4B-3 RSVP | **FAIL บางส่วน** | M1: ออกแล้วกลับเข้า → RSVP เก่าโผล่ (repro R1) · upsert อะตอมมิก, ปิดเมื่อยกเลิก/จบ ถูก |
| R4B-4 เตือนนัดทับ | PASS | **path `unknown` ทดสอบแล้ว**: seed busy_block 5,100 แถวของ B รอบช่วงนัด → check ตอบ `status:"unknown"` และการสร้างนัดตอบ 201 + overlap `unknown` (repro R4) |
| R4B-5 ยกเลิก | PASS (+M3, L1) | ไม่นับเพดาน/ไม่เป็น "ถัดไป" |
| R4B-6 สถานที่+proxy | PASS (+L3, L4) | อ่านโค้ด: kill switch, rate limit/ช่องห่าง, คีย์แคชมีภาษา (`th:`/`en:`), ล้มไม่แคช, sanitize/สร้าง OSM URL เอง, เพดาน 256 KiB + timeout, `redirect:'error'` |
| R4B-7 แจ้งเตือน | PASS (+L2, L5) | keyset ไม่ซ้ำ/ไม่ตกหล่นเมื่อ createdAt เท่ากัน (7 แถว limit 3 = 3 หน้า ครบ 7, repro R6) · ผู้ที่ออกกลุ่มไม่เห็น/ไม่นับ (R5) · mark ของคนอื่นถูกเมิน |
| R4B-8 หน้าหลัก | PASS | daysUntil ใช้วันปฏิทินใน tz นัด (นัด 19 ต.ค. 00:00 vs ตอนนี้ 18 ต.ค. 10:00 = 1) · กำลังเกิดอยู่ = "ongoing" ไม่ใช่ "อีก N วัน" |
| R4B-9 มือถือ | PASS | e2e 375/390/768 × th/en × light/dark ผ่าน · ดูภาพจริง 8 ภาพ (ด้านล่าง) |
| R4B-10 i18n/contrast/CSP | PASS | key th=en=769 ตรงกัน · contrast ผ่าน · CSP ไม่ถูกแตะ |
| R4B-11 เรื่องเล่า | PASS | appt-story ผ่าน |
| R4B-12 เกต | PASS ตามที่รันได้ | vitest 3 รอบ/CI GitHub ไม่ได้ตรวจ (รันรอบเดียวตามคำสั่ง) |

## Findings

### Critical / High
ไม่พบ

### Medium
**M1 — RSVP เก่าฟื้นเมื่อสมาชิกออกแล้วกลับเข้ากลุ่ม** (R4B-3 "ออกแล้วไม่นับ")
`src/lib/data/repos/appointment.ts:237` (`listCurrentRsvps` join `group_member` โดยไม่ดู `joined_at`) · การออกกลุ่มไม่ลบแถว `appointment_rsvp`
Repro: B ตอบ going → B leave → B redeem โค้ดเข้าใหม่ → `GET /api/appointments/:id` ตอบ `rsvp.mine = "going"`, `counts.going = 1` (ทั้งที่ B ไม่เคยตอบหลังกลับเข้ามา). แก้: ลบ RSVP ของผู้ใช้ในนัดของกลุ่มตอนออก/ถูกนำออก หรือกรอง `rsvp.updated_at >= group_member.joined_at`

**M2 — แก้เวลานัดที่กำลังเกิดอยู่ (เริ่มมาแล้ว > 1 ชม.) ไม่ได้**
`src/lib/data/services/appointments.ts:183-188` (`scheduleOf` ตรวจ "เริ่มย้อนหลัง ≤ 1 ชม." แม้ค่าเริ่มไม่ได้เปลี่ยน) + PATCH เวลาเป็น all-or-none
Repro: นัดเริ่ม 3 ชม.ก่อน จบอีก 1 ชม. (ยัง upcoming/ongoing, `canEdit:true`) → PATCH `{title}` 200 แต่ PATCH ขยายเวลาจบ (ส่ง 4 ฟิลด์) = 400 `VALIDATION startTime IN_PAST`. UI (`buildPatchPayload` model.ts:208) จะเจอเหมือนกันเมื่อแก้เวลาจบ. แก้: ตรวจย้อนหลังเฉพาะเมื่อ startAt เปลี่ยน

**M3 — นัดที่ยกเลิก: กล่อง "ใครไปบ้าง" ชวนให้ตอบ**
`AppointmentDetail.tsx:214` ใช้ `appointments.rsvp.list.nobody` = "ยังไม่มีใครตอบ ตอบเป็นคนแรกได้เลย" แม้นัดยกเลิกแล้ว/จบแล้ว (ตอบไม่ได้) — ขัดกับแบนเนอร์ข้างบน (ภาพ detail-cancelled-th-light) · แก้: ใช้ข้อความกลางๆ เมื่อ `!canRsvp`

### Low
- **L1** API แก้/ยกเลิกนัดที่ **จบแล้วแต่ยัง active** ได้ (repro R3: PATCH title 200, cancel 200, DTO `canEdit/canCancel:true`) ขณะที่ UI ซ่อนปุ่ม (`live`) · ประวัติแก้ย้อนหลังได้ · `services/appointments.ts:454,480`
- **L2** แจ้งเตือน `appointment.*` เก่าของกลุ่มเดิมกลับมาปรากฏเมื่อกลับเข้ากลุ่ม (`repos/notification.ts:72` กรองตามสมาชิกปัจจุบัน) — สอดคล้องกับ M1 (ไม่ได้รัน repro แยก, อ่านโค้ด)
- **L3** `13,75` (ทศนิยมจุลภาค) ถูกแปลเป็น lat 13, lng 75 เงียบๆ (`location-parse.ts:50`); `13,7563 100,5018` ถูกปฏิเสธด้วยเหตุผล INVALID_CHARS ที่ไม่ตรง · ที่เหลือตรวจแล้วถูก: Google (`@`, `!3d!4d`, `?q=`, `/dir`, google.co.th), Apple (`ll`, `coordinate`), OSM (`mlat`, `#map`), geo:, ลบ/ศูนย์, ตัวเลขเต็มความกว้าง/ลบแบบ U+2212/จุลภาคเต็มความกว้างถูกปฏิเสธ, `evil.com@maps.google.com` = CREDENTIALS, `google.com.evil.com` = ลิงก์ล้วนไม่ดึงพิกัด
- **L4** (อ่านโค้ด ไม่ได้รัน) ถ้า Nominatim ตอบ 200 แต่เป็น JSON ที่ไม่ใช่อาร์เรย์ (เช่น `{"error":...}`) `sanitizePlaceResults` คืน `[]` แล้ว `putPlaceCache` แคช "ไม่พบ" 30 วัน (`services/places.ts:216-219`) — ควรไม่แคชเมื่อรูปร่างผิด
- **L5** คีย์ข้อความตายค้าง `notifications.appointment.cancelled` (th/en) + เทสต์ `notifications-model.test.ts:105` อ้างถึง ทั้งที่ kind นี้ไม่อยู่ใน `NOTIFICATION_KINDS` (v1 ไม่มี) · ส่วนข้อความ dialog ยกเลิก **สอดคล้อง** ตัดสินใจ "ไม่แจ้งเตือนยกเลิก" (`CANCEL_NOTIFIES=false` → "ระบบไม่ส่งแจ้งเตือนการยกเลิก ช่วยบอกเพื่อนในกลุ่มด้วย") = PASS
- **L6** UI: รายการแจ้งเตือนที่ชื่อกลุ่มยาวจะตัดด้วย "…" จนไม่เห็นชื่อนัด (notifications-th-light) · แถบสถานะยกเลิกบนหน้ารายละเอียดตัดคำ "ยกเลิก/แล้ว" 2 บรรทัดที่ 375px และคำว่า "ยกเลิกแล้ว" ซ้ำ 3 จุด (แบนเนอร์/แถบ/ป้าย)
- **L7** `config-hygiene` ล้ม 2 ข้อในการรันครั้งแรกใน repo จริง แล้วผ่านใน 2 รอบถัดไปโดยไม่มีการเปลี่ยนไฟล์ — ไม่ทราบสาเหตุ (น่าจะ race กับ e2e/ไฟล์ชั่วคราวใน working tree ที่รันพร้อมกัน) · ควรให้ TEST เฝ้าดู

## ตรวจแล้วไม่พบปัญหา
- **วันที่/เวลา**: นัดข้ามเที่ยงคืน/เดือน/ปี และ London DST อยู่ในเทสต์เดิมและผ่าน · `daysUntil` = วันปฏิทินใน tz นัด (ไม่ใช่ 24 ชม.) · upcoming/past ตัดที่ `end_at > now` เหมือนกันทั้งเพดาน/รายการ/หน้าหลัก/RSVP
- **cap**: อัปเดตที่ย้ายนัดที่จบแล้วเข้าอนาคตตรวจที่ว่างใน SQL เดียว ถูกต้อง
- **lat/lng**: ต้องไปคู่กัน, PATCH `null` ล้างได้, CHECK ระดับ DB
- **creator ออกจากกลุ่ม**: `createdBy: null` แสดงผลได้ (R5) · นับ noResponse = สมาชิก − คนที่ตอบ (เฉพาะสมาชิกปัจจุบัน) ไม่ติดลบ
- **แผนที่**: tileGrid ที่ ±90, ±180, lat 85.06, lng ±180 → x วนข้ามเส้นแบ่งวัน, แถวนอกโลก = ไม่มี tile, marker คำนวณถูก
- **hydration**: e2e hydration ผ่านทุกหน้าใหม่ (th/en) · ยังมี `date-full` ใน R4A components (ผ่าน e2e; หน้านัดใช้ `suppressHydrationWarning`) — ไม่พบเตือนจริง
- **ภาพจริง vs sample**: ดูภาพจริง 8 ภาพ (home-many th/light, detail th/light, form-warn-paste th/light, notifications th/light, detail-cancelled th/light, home-empty en/dark, list en/dark + ภาพ 375 อื่นโดยรวม) — โครงตรงกับ sample UX; ข้อสังเกตอยู่ใน M3/L6 · หมายเหตุ: ภาพ full-page มีแถบแท็บกลางภาพเป็นผลของ fullPage capture ไม่ใช่บั๊ก; tile แผนที่เป็น stub สีทึบ
- **ภาษา**: ข้อความไทย/อังกฤษของหน้าใหม่อ่านเป็นธรรมชาติ ศัพท์ "นัด/plan", "ไป/อาจไป/ไม่ไป" สม่ำเสมอ ยกเว้น M3

## ข้อจำกัดของการตรวจ
ไม่ได้ตรวจ CI บน GitHub · vitest เต็มรันครั้งเดียว · ไม่ได้ยิง Nominatim จริงและไม่ได้รัน repro ของ L4/L2 · ภาพจริงดู 375 เท่านั้น (390/768 อาศัย e2e layout assertions)
