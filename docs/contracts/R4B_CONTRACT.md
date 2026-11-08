# R4B_CONTRACT.md — นัด + RSVP + สถานที่/แผนที่ + แจ้งเตือนในแอป + หน้าหลัก

> ผู้เขียน: Lead · 2026-10-21 · สถานะ: boss สั่ง "ทำต่อ" หลัง R4A merge = ถือว่าเห็นชอบ (แย้งได้ตลอด) · branch `r4b` (แตกจาก `r4a` ที่ merge แล้ว)
> อ้างอิง: [PRD U10, U10.1, U10.2, U11, D4, D11, D13](docs/prd/PRD.md) · [ADR 0003 RBAC](docs/adr/0003-rbac.md) · [ADR 0004](docs/adr/0004-time-and-timezone.md) · [ADR 0005 §4 (เตือนนัดทับ)](docs/adr/0005-common-free-time-algorithm.md) · [ADR 0006](docs/adr/0006-busy-visibility.md) · [ADR 0007 แจ้งเตือน](docs/adr/0007-notifications.md) · [ADR 0001 ค้นหาสถานที่/CSP](docs/adr/0001-stack-and-project-structure.md)
> ข้อเสนอเลขเวอร์ชัน: **v0.6.0**

## 1. เป้าหมาย
สมาชิกกด "สร้างนัด" จากวันที่ว่างร่วม (หรือจากหน้ากลุ่ม) ใส่ชื่อ/เวลา/สถานที่ → สมาชิกคนอื่นได้แจ้งเตือนในแอป ตอบ ไป/อาจไป/ไม่ไป → หน้าหลักเปิดมาเห็น "นัดถัดไป" ข้ามทุกกลุ่ม · แก้/ยกเลิกได้ตามสิทธิ์ (นัดที่ยกเลิกยังเห็นพร้อมสถานะ) · ถ้านัดทับ busy ของสมาชิก ระบบ **เตือนแต่ไม่บล็อก**

## 2. ขอบเขต
**ทำ**
- **นัด** (ตาราง `appointment`, `appointment_rsvp` มีใน schema แล้ว — ตรวจ index/constraint ก่อน ถ้าขาดทำ migration แบบมีเวอร์ชัน):
  - API: `POST /api/groups/:gid/appointments` · `GET /api/groups/:gid/appointments?scope=upcoming|past|all` · `GET /api/appointments/:id` · `PATCH /api/appointments/:id` · `POST /api/appointments/:id/cancel` · `PUT /api/appointments/:id/rsvp` (`going|maybe|not_going`) · `GET /api/me/appointments` (upcoming ข้ามทุกกลุ่มของฉัน สำหรับหน้าหลัก)
  - ฟิลด์: ชื่อ 1–80, รายละเอียด ≤1000, เวลาเริ่ม/จบ (ทีละ 30 นาที, end>start, ข้ามเที่ยงคืนได้, tz กลุ่ม — ใช้ lib `src/lib/calendar`), สถานที่: ชื่อ + (lat,lng คู่กัน) + `mapUrl` (https เท่านั้น ≤500) ทั้งหมดไม่บังคับ · ห้ามสร้างนัดที่เริ่มย้อนหลังเกิน 1 ชม. (กันพลาด) · ขีดจำกัด: นัดที่ยัง active ในอนาคต ≤ 100 ต่อกลุ่ม; ยกเลิกแล้วไม่นับ
  - สิทธิ์ (D4): สมาชิกทุกคนสร้างได้ · แก้/ยกเลิก = ผู้สร้าง + group admin/moderator (+ super admin) — ตามเมทริกซ์ `appointment.*` ที่มีใน RBAC แล้ว · คนนอกกลุ่ม/ถูกลบออก → 404 · แก้ฟิลด์ที่เปลี่ยนเวลา/สถานที่ → แจ้งเตือน `appointment.updated`? **ไม่** (ตาม ADR 0007 v1 มีแค่ `appointment.created`; เพิ่ม `appointment.cancelled` ได้ถ้า UX/Platform เห็นว่าจำเป็น — ให้เสนอใน Handoff ไม่เพิ่มเองเงียบๆ)
  - ยกเลิก: สถานะ `cancelled` + `cancelled_at/by` · ไม่ลบแถว · RSVP ยังอ่านได้แต่แก้ไม่ได้
  - **เตือนนัดทับ busy (U10.1)**: ตอนสร้าง/แก้ ระบบตอบรายชื่อสมาชิกที่ติด (ใช้ `membersBlockedDuring` จาก lib R4A) — **ไม่บล็อก**; รายละเอียดกรองตาม ADR 0006 (ซ่อน = "ไม่ว่าง") · endpoint ตรวจล่วงหน้า `POST /api/groups/:gid/appointments/check` (ไม่เขียน) เพื่อโชว์คำเตือนก่อนกดยืนยัน · ถ้า `truncated` ของ busy ที่โหลด ห้ามสรุปว่า "ไม่มีใครติด" (ส่งสถานะ `unknown`)
  - RSVP: ทุกสมาชิกปัจจุบันตอบได้ (รวมผู้สร้าง) · ตอบซ้ำ = แก้ · สรุปจำนวนต่อคำตอบ + รายชื่อ (ชื่อที่แสดงของสมาชิกปัจจุบัน) · สมาชิกที่ออกกลุ่มแล้ว RSVP หาย/ไม่นับ
  - นัดที่ผ่านไปแล้ว: RSVP ปิด (อ่านได้) · "วันที่ถูกต้อง" ใช้ tz กลุ่ม
- **สถานที่ + แผนที่ (D11)**:
  - `GET /api/places/search?q=` (action `place.search`): proxy Nominatim ฝั่งเซิร์ฟเวอร์ตาม ADR 0001 — cache ใน `place_search_cache` (30 วัน), throttle 1 req/s ทั้งระบบ (ตาราง/ตัวนับใน DB), kill switch env `PLACE_SEARCH_ENABLED`, User-Agent/Referer ตามนโยบาย Nominatim (ต้องมีอีเมลติดต่อจาก env — ห้าม hard-code), ผล ≤5, `Cache-Control: private, no-store` · **เทสต์ห้ามยิง Nominatim จริง** (mock fetch) · ผู้ใช้ต้องล็อกอิน + rate limit ต่อผู้ใช้
  - UI: กด "ค้นหา" (ไม่ autocomplete ทุกตัวอักษร) หรือวางลิงก์แผนที่/พิกัด (parse `lat,lng`, `geo:`, ลิงก์ OSM/Google Maps ที่มี `@lat,lng` — **ไม่เรียก Google API**, ลิงก์เก็บได้แต่ https เท่านั้น) · แผนที่ OSM ในหน้ารายละเอียดนัด: โหลดเฉพาะหน้านั้น (dynamic import), tile จาก `tile.openstreetmap.org` ตาม CSP ที่ตั้งไว้แล้ว, แสดง attribution © OpenStreetMap ตามเงื่อนไข · ปุ่ม "เปิดในแอปแผนที่" (`geo:` / ลิงก์) · ต้องใช้งานได้ถ้าโหลดแผนที่ไม่ได้ (ข้อความ + ชื่อ/พิกัด)
- **แจ้งเตือนในแอป (ADR 0007)**: `notify()` ใน transaction เดียวกับเหตุการณ์ · `appointment.created` ไปสมาชิกทุกคนยกเว้นผู้สร้าง (super admin ที่ไม่ใช่สมาชิกไม่ได้) · API `GET /api/me/notifications?cursor=`, `POST /api/me/notifications/read` (`{ids}` | `{all:true}`) · UI: ไอคอนกระดิ่ง + จำนวนยังไม่อ่าน + รายการ (แปลตามภาษาผู้ดู, กดแล้วไปหน้านัด) · เก็บ 90 วัน (cron ลบ — ต่อจาก R3 cron) · คีย์ข้อความครบ 2 ภาษาทุก kind (เทสต์วน union) · `params` เป็นค่าดิบ ไม่มีความลับ
- **หน้าหลัก (U11)**: การ์ดใหญ่ "นัดถัดไป" (ชื่อ, วัน-เวลา พ.ศ./24 ชม., สถานที่, "อีก N วัน", จำนวนคนไป, ชื่อกลุ่ม) + รายการนัดถัดๆ ไปข้ามทุกกลุ่ม + RSVP ของฉันบนการ์ด + ปุ่มตอบเร็ว · ไม่มีนัด → หน้าว่าง + แมว + ปุ่ม "ดูวันที่ว่างตรงกัน" (ลิงก์ `/calendar?v=free`) · มีกระดิ่งแจ้งเตือน · นัดที่ยกเลิกแสดงสถานะ (ไม่ใช่การ์ด "ถัดไป")
- **เปิดปุ่ม "สร้างนัด"** ใน day detail ของหน้า "ว่างตรงกัน" (R4A) → sheet สร้างนัดเติมวัน/ช่วงเวลาจาก segment ที่เลือก · ปุ่มสร้างนัดในหน้ากลุ่มและหน้า "นัดของกลุ่ม" (รายการ upcoming/past) · ถ้า `truncated=true` ของ availability ให้ขึ้นคำเตือนว่าผลอาจไม่ครบ ไม่ใช้เป็นตัวตัดสินอัตโนมัติ
- สีสมาชิกใน RSVP ใช้ชุดสีเดิม (R2/R3)

**ไม่ทำ**: LINE/อีเมล (R7) · แจ้งเตือนก่อนนัด/นัดซ้ำ (recurring) · ปฏิทินส่งออก (ics) · แนบไฟล์/คอมเมนต์ · เลือก timezone ใน UI · รายการ "นัดทับกันเอง" ของผู้ใช้ข้ามกลุ่ม · autocomplete สถานที่ทุกตัวอักษร

## 3. ความรับผิดชอบไฟล์
| บทบาท | ไฟล์ |
|---|---|
| Platform (#5) | `src/db/**` + migration (ถ้าขาด), repos/services/serializers ของ appointment/rsvp/place/notification, `src/app/api/{groups/[gid]/appointments,appointments,places,me/appointments,me/notifications}/**`, manifest, limits, cron ลบ notification เก่า, `notify()` |
| Calendar & Time (#9) | เฉพาะถ้าต้องเพิ่มฟังก์ชันใน `src/lib/calendar/**` (เช่น parse/ตรวจเวลานัด, format "อีก N วัน") + tests |
| Auth & Access (#8) | `src/lib/rbac/**`, `tests/rbac/**` เมทริกซ์ appointment.* / notification.* / place.search ผูก endpoint จริง · เทสต์สแกน authorize-first ครอบ route ใหม่ |
| UX & Brand (#4) | `messages/*.json` ส่วน R4B, wireframe/sample/ภาพ (ฟอร์มนัด, รายละเอียดนัด+RSVP+แผนที่, รายการนัดกลุ่ม, หน้าหลัก, กระดิ่ง/รายการแจ้งเตือน, คำเตือนนัดทับ, ค้นหาสถานที่), `docs/design/**`, `src/styles/**` |
| Front-end (#6) | `src/app/(app)/**` (หน้าหลัก, นัด, แจ้งเตือน), `src/components/{appointments,notifications,home,places}/**`, ปุ่มสร้างนัดใน availability |
| TEST (#11) | `tests/e2e/**`, `tests/helpers/**`, mock Nominatim, canary |
| OPS (#10) | `docs/OPERATIONS.md` (env `PLACE_SEARCH_ENABLED`, อีเมลติดต่อ Nominatim, cron) |
| Release (#15) | `CHANGELOG.md` |
| QA + Security | ตรวจอิสระ — เน้น: IDOR นัด/RSVP ข้ามกลุ่ม, ผู้ถูกลบออกยังเห็นนัด/แจ้งเตือน, mass assignment (createdBy/groupId), SSRF/ลิงก์ที่ผู้ใช้ใส่ (mapUrl scheme javascript:/data:), XSS ชื่อนัด/สถานที่/คำอธิบาย, Nominatim proxy abuse (rate limit/ขนาด/cache poisoning), เตือนนัดทับรั่ว busy detail, notification params รั่ว, แสดงสมาชิกที่ออกแล้วใน RSVP |

ทุก commit ใช้ `user.name` = ชื่อบทบาท

## 4. ลำดับ
```
ขั้น 1  UX: ดีไซน์ + messages   ‖ Platform: appointments/RSVP/check/notify/notifications/places   ‖ Auth: RBAC + สแกน
ขั้น 2  Front-end (หลัง UX + endpoint)   ‖ TEST: fixtures + mock Nominatim + canary + e2e
ขั้น 3  QA + Security อิสระ → แก้ → ตรวจซ้ำจุดที่แก้
ขั้น 4  Lead รันเกตซ้ำ → รายงาน → bundle → boss push/merge
```

## 5. เกณฑ์ผ่าน
| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R4B-1 | U10 สร้างนัด | validation ครบ (ชื่อ, ช่วงเวลา ทีละ 30 นาที, end>start, lat/lng คู่, mapUrl https, ย้อนหลัง >1 ชม. ปฏิเสธ, เพดาน 100) · ข้ามเที่ยงคืน/เดือน/ปี · `local_date` ถูกใน tz กลุ่ม · strict schema (ไม่รับ groupId/createdBy จาก body) |
| R4B-2 | D4 สิทธิ์ | เมทริกซ์ HTTP: สมาชิกสร้างได้; แก้/ยกเลิก = ผู้สร้าง/admin/moderator/super admin เท่านั้น · member ธรรมดาแก้นัดคนอื่น → 403 (เห็นนัดได้ จึงไม่ใช่ 404) · คนนอก/ถูกลบออก/กลุ่มถูกลบ → 404 ทุก endpoint (ไม่แยกจากไม่มีอยู่จริง) · anonymous 401 · `must_change_pin` 403 · IDOR ข้ามกลุ่ม |
| R4B-3 | RSVP | going/maybe/not_going · ตอบซ้ำ=แก้ · สมาชิกที่ออกแล้วไม่นับ/ไม่แสดง · นัดยกเลิก/ผ่านแล้วตอบไม่ได้ · นับถูกตอนแข่งกัน (upsert อะตอมมิก) |
| R4B-4 | U10.1 เตือนนัดทับ | ตัวอย่างจาก ADR 0005 §4 (11–13 vs A 10–12 → A; B ทั้งวัน → B; 12–14 vs A จบ 12 → ไม่เตือน) ผ่าน API · ไม่บล็อกการสร้าง · รายละเอียดกรองตาม ADR 0006 (canary: ไม่มี note / title ที่ซ่อน) · busy truncated → `unknown` |
| R4B-5 | U10.2 ยกเลิก | สถานะ cancelled + ผู้ยกเลิก/เวลา · ยังอ่านได้ · แก้ไม่ได้ · ไม่ถูกนับเป็น "นัดถัดไป" · ไม่นับเพดาน |
| R4B-6 | สถานที่ + proxy | cache hit ไม่เรียก Nominatim (mock นับครั้ง) · เกิน 1 req/s ทั้งระบบ → `RATE_LIMITED` · `PLACE_SEARCH_ENABLED=false` → FEATURE_DISABLED · ผลถูก sanitize/จำกัด 5 · ไม่มีการยิงเครือข่ายจริงในเทสต์ · User-Agent/อีเมลติดต่อมาจาก env · parse พิกัด/ลิงก์: ค่าที่เป็นอันตราย (`javascript:`, `data:`, http ธรรมดา) ถูกปฏิเสธ |
| R4B-7 | แจ้งเตือน (ADR 0007 ข้อ 2,4,5,6,7) | สร้างนัด → ทุกสมาชิกยกเว้นผู้สร้างได้ 1 แถว · super admin ไม่ใช่สมาชิกไม่ได้ · เขียน notification ล้ม → นัด rollback · ทุก kind มีคีย์ th/en · ไม่มีความลับใน params · A อ่าน/mark ของ B ไม่ได้ · cursor pagination · cron ลบ >90 วัน |
| R4B-8 | หน้าหลัก U11 | นัดถัดไปถูก (ข้ามกลุ่ม, เวลา tz กลุ่ม, ไม่รวมยกเลิก/ผ่านแล้ว) · "อีก N วัน" ถูกที่ขอบเที่ยงคืน · ว่าง→แมว+ปุ่ม · จำนวนคนไปถูก · เรียงถูก |
| R4B-9 | หน้าจอมือถือ | e2e 375/390/768 × th/en × light/dark: หน้าหลัก, ฟอร์มนัด, รายละเอียด+แผนที่, รายการ, กระดิ่ง/แจ้งเตือน ทุกสถานะ: ไม่ล้นจอ, ปุ่ม ≥44px, ไม่ hard-code, ชื่อ/สถานที่ยาว, แผนที่โหลดไม่ได้ยังใช้งานได้ |
| R4B-10 | i18n/คอนทราสต์/CSP | key parity + `errors.*` ใหม่ · `npm run contrast` ผ่านรวมสีสถานะ RSVP (ไม่พึ่งสีอย่างเดียว) · CSP ไม่ถูกผ่อน (แผนที่ใช้ tile origin เดิม) · แสดงชื่อ/สถานที่ผ่าน `<bdi>`/escape เสมอ |
| R4B-11 | e2e เรื่องเล่า | A,B,C: A เห็นวันว่างร่วม → สร้างนัดจากวันนั้น (มีคำเตือนทับ busy ของ B) → B,C ได้แจ้งเตือน → B ตอบไป, C อาจไป → หน้าหลักของ B เห็นนัดถัดไป พร้อมจำนวนคนไป → A ยกเลิก → B เห็นสถานะยกเลิก, หน้าหลักไม่แสดงเป็น "ถัดไป" → C ออกกลุ่ม → C ไม่เห็นนัดอีก (404) |
| R4B-12 | เกต + ตรวจอิสระ | lint/typecheck/db:check/style-literals/contrast/build · vitest ซ้ำ 3 รอบไม่ล้ม · CI เขียวบน GitHub (e2e shard ≤40 นาที) · commit ตรงขอบเขต · QA + Security รันซ้ำเอง · Medium+ แก้และตรวจซ้ำ |

## 6. ความเสี่ยง
- **สิทธิ์นัด/RSVP ข้ามกลุ่ม (IDOR)** และผู้ถูกลบออกเห็นต่อ → เทสต์เมทริกซ์ + สแกน authorize-first
- **ลิงก์/ข้อความที่ผู้ใช้ใส่** (mapUrl, สถานที่, คำอธิบาย) → https เท่านั้น, ไม่ render HTML, `rel="noopener noreferrer"`, CSP เดิม
- **Nominatim**: นโยบายห้ามใช้หนัก/ห้าม autocomplete → กดค้นหา + cache + throttle + kill switch · ถูกบล็อกได้ → ต้องใช้งานได้โดยวางลิงก์/พิกัดเอง
- **เวลา**: นัดข้ามเที่ยงคืน, "อีก N วัน" ตามวันท้องถิ่น (ไม่ใช่ 24 ชม.), DST ของ tz ต่างประเทศ (API รับ tz กลุ่ม)
- **ขนาดงาน** ใหญ่ → จัดลำดับ: backend+RBAC+UX ก่อน, แล้ว UI; ถ้าเกินกำลัง CI (e2e) ให้ Lead ตัดสินแยกรอบ (แจ้ง boss)
- **แจ้งเตือนถูกสร้างพร้อมนัด**: transaction เดียว; กลุ่ม 50 คน = 49 แถว/นัด (ยอมรับ) — ตรวจเวลาเขียน

## 7. สิ่งที่ boss ต้องตัดสินใจ (ไม่ตอบ = ใช้ค่าที่ Lead เสนอ)
1. อนุมัติ contract (บอก "เริ่มเลย" ก็ถือว่าอนุมัติ)
2. **แจ้งเตือนเมื่อแก้/ยกเลิกนัด**: เสนอให้ v0.6.0 มีเฉพาะ "นัดใหม่" ตาม PRD; เพิ่ม "ยกเลิกนัด" ถ้าอยาก (บอกได้)
3. **อีเมลติดต่อสำหรับ Nominatim** (นโยบายบังคับให้ระบุตัวตนผู้ใช้งาน): ใช้อีเมลของคุณ (ตั้งใน env ตอน deploy — ผมไม่ใส่ใน repo/แชท) — ตอนทำ deploy จริงผมจะสอน
4. **ยังค้าง**: deploy จริง Turso + Vercel และ tag v0.1.0–v0.5.0 — ผมแนะนำทำหลัง R4B merge (แอปจะใช้งานได้ครบวงจรแล้ว)

## 8. สิ่งที่ boss ต้องทำในรอบนี้
- [ ] (ไม่บังคับ) ตอบข้อ 7.2
- [ ] หลังทีมส่ง bundle: fetch/push + เปิด PR ชื่อ `R4B: appointments + home` + รอ CI เขียว + merge
