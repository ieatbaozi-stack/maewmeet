# R4A_CONTRACT.md — วันว่างร่วม (common free time)

> ผู้เขียน: Lead · 2026-10-20 · สถานะ: boss สั่ง "ทำต่อ" หลัง R3 merge = ถือว่าเห็นชอบ (แย้งได้ตลอด) · branch `r4a` (แตกจาก `r3` ที่ merge แล้ว)
> อ้างอิง: [PRD U9, U9.1, D9](docs/prd/PRD.md) · [ADR 0005 อัลกอริทึม + fixtures](docs/adr/0005-common-free-time-algorithm.md) · [ADR 0004](docs/adr/0004-time-and-timezone.md) · [ADR 0006](docs/adr/0006-busy-visibility.md)
> ข้อเสนอเลขเวอร์ชัน: **v0.5.0**

## 0. ทำไมแยก R4 เป็น R4A / R4B
PRD รวม "วันว่างร่วม + นัด + RSVP + แผนที่ + หน้าหลัก" ไว้ที่ R4 ซึ่งใหญ่กว่า R3 สองเท่า (PR ใหญ่ = ตรวจยาก, CI ช้า, ข้อผิดพลาดซ่อนง่าย) จึงแบ่ง:
- **R4A (รอบนี้)**: วันว่างร่วม — lib `free-time`, `GET /api/groups/:gid/availability`, หน้าจอ "วันที่ว่างตรงกัน" (เดือน/วัน, ว่าง X/Y, ใครติด) · ปุ่ม "สร้างนัด" ยังไม่ทำงานจนกว่า R4B (ซ่อนหรือ disabled พร้อมข้อความ)
- **R4B (ถัดไป, v0.6.0)**: นัด (สร้าง/แก้/ยกเลิก) + RSVP + เตือนนัดทับ busy + ค้นหาสถานที่ (Nominatim proxy) + แผนที่ OSM + แจ้งเตือนในแอป + หน้าหลัก (นัดถัดไป)

## 1. เป้าหมาย
สมาชิกกลุ่มเปิดดูได้ว่าวันไหนทุกคนว่างพร้อมกัน (และช่วงเวลาไหน) หรือถ้าไม่มีวันว่างครบ เห็น "ว่าง X/Y" รายวันพร้อมใครติด — คำนวณจาก busy ของสมาชิกปัจจุบันตามหน้าต่างวันของกลุ่ม (ค่าเริ่มต้น 08:00–22:00, ขั้นต่ำ 2 ชม. — ตั้งได้อยู่แล้วที่หน้าตั้งค่ากลุ่ม R2)

Stories: **U9, U9.1** · D9 · ADR 0005 ทั้งฉบับ · ADR 0006 (blockers ต้องผ่าน serializer)

## 2. ขอบเขต
**ทำ**
- **`src/lib/calendar/free-time.ts`** (Calendar & Time) ตาม ADR 0005 §1–2: `commonFreeTime(group, members, busyBlocks, fromDate, toDate)` pure function · `subtract`/overlap ตัวเดียวกัน export สำหรับ R4B (เตือนนัดทับ) · เวลาในผลเป็น instant + `HH:MM` ใน tz กลุ่ม (ปลาย 24:00) · ช่วง ≤ 62 วัน (เกิน → ปฏิเสธ `RANGE_TOO_LARGE` ตาม ADR 0005 — ตรวจรหัสที่ repo ใช้จริงกับ R3 `VALIDATION fields.from/to` แล้วเลือกให้สม่ำเสมอ และบันทึกในใบรับรอง)
- **fixtures**: แปลง `docs/adr/0005-fixtures/{cases,expected}.json` เป็น Vitest `test.each` ทุกเคส (T1–T24) + ตรวจว่า oracle ทั้ง 2 ตัวยังให้ค่าตรงกัน (รัน `oracle.py`) + property test (ผลเทียบกับ implementation ช้าแบบ slot 1 นาทีบนข้อมูลสุ่ม ใน tz ที่ไม่มี DST และ London)
- **`GET /api/groups/:gid/availability?from&to`** (Platform): สมาชิกกลุ่ม (หรือ super admin → audit) · action `group.availability.view` (มีใน RBAC แล้ว) · 404 สำหรับคนนอก/ถูกลบออก/กลุ่มถูกลบ · ดึง busy เฉพาะคอลัมน์ที่จำเป็น (ไม่ SELECT `note`; `title` เฉพาะที่ไม่ซ่อน) ด้วยสมาชิกปัจจุบัน ช่วง ±14 ชม. ตาม ADR 0005 §3 · `Cache-Control: private, no-store` · ตอบ `{group:{tz,windowStartMin,windowEndMin,minFreeMinutes}, from, to, members:[…], days:[{date, freeMembers, totalMembers, allFree, segments:[{startAt,endAt,start:'HH:MM',end:'HH:MM'}], blockers:[BusySharedView-like]}], truncated?}` — **blockers ผ่าน serializer เดียวของ ADR 0006** (รายการซ่อน = "ไม่ว่าง" ไม่มี title) · ขีดจำกัดแถว busy ที่โหลด (ใช้ค่าเดียวกับปฏิทิน 5000 + `truncated`)
- **หน้าจอ** (Front-end + UX): แท็บ/หน้า "วันที่ว่างตรงกัน" ในกลุ่ม (หรือโหมดในแท็บปฏิทิน — UX ตัดสินจาก wireframe): เดือน (วัน "ว่างร่วม" เด่นชัด ต่างจากตัวเลข X/Y ตาม Consequences ของ ADR 0005) · รายละเอียดวัน: ช่วงว่างร่วม, ใครติด (ตามการมองเห็น), ปุ่ม "สร้างนัด" (ยังไม่ทำงาน — แสดง disabled + ข้อความ "เร็วๆ นี้" หรือซ่อน ตามที่ UX เสนอ) · สรุปบนสุด: "วันที่ว่างตรงกันเร็วที่สุด" (ถ้ามี) · สถานะว่าง/โหลด/ผิดพลาด/กลุ่มคนเดียว · ลิงก์ไปตั้งค่าหน้าต่างวัน (ถ้ามีสิทธิ์) · TH/EN × light/dark · พ.ศ. · เริ่มจันทร์
- RBAC: ใช้ action เดิม; เพิ่มแถวเมทริกซ์/เทสต์สแกน authorize-first ให้ route ใหม่

**ไม่ทำ**: นัด/RSVP/แผนที่/แจ้งเตือน/หน้าหลัก (R4B) · หน้าต่างข้ามเที่ยงคืน (ADR 0005: v1 ไม่รองรับ) · cache ผลคำนวณ

## 3. ความรับผิดชอบไฟล์
| บทบาท | ไฟล์ |
|---|---|
| Calendar & Time (#9) | `src/lib/calendar/free-time.ts` (+ export ใน index), `tests/calendar/free-time*.test.ts` |
| Platform (#5) | `src/lib/data/repos/availability*.ts` หรือต่อใน busy repo, `src/lib/data/services/availability.ts`, serializer (ต่อจาก busy.ts), `src/app/api/groups/[gid]/availability/**`, manifest, limits |
| Auth (#8) | เทสต์ RBAC/สแกนของ route ใหม่ (ถ้า action พอแล้วไม่ต้องแก้ src) |
| UX (#4) | `messages/*.json` ส่วน R4A, wireframe/sample/ภาพ, `docs/design/**`, `src/styles/**` |
| Front-end (#6) | `src/app/(app)/**` ส่วนวันว่าง, `src/components/availability/**` |
| TEST (#11) | `tests/e2e/**` เรื่องเล่า + layout; canary: blockers ของ availability ไม่รั่ว note/title ที่ซ่อน (ADR 0006 ข้อ 5–6) |
| Release (#15) | `CHANGELOG.md` |
| QA + Security | ตรวจอิสระ |

## 4. ลำดับ
```
ขั้น 1  Calendar & Time: free-time + fixtures   ‖ UX: wireframe + messages
ขั้น 2  Platform: availability endpoint + serializer   ‖ Auth: RBAC/สแกน
ขั้น 3  Front-end ‖ TEST
ขั้น 4  QA + Security อิสระ → แก้ → ตรวจซ้ำจุดที่แก้
ขั้น 5  Lead รันเกตซ้ำ → รายงาน → bundle → boss push/merge
```

## 5. เกณฑ์ผ่าน
| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R4A-1 | อัลกอริทึม | ADR 0005 T1–T24 ผ่านทุกแถว (ตรง `expected.json` และ oracle ทั้ง 2 ตัว) · property test เทียบ slot-1-นาที · pure (ไม่มี DB/HTTP/`new Date`) · inject `now` เมื่อเกี่ยว |
| R4A-2 | U9 AC | integration ผ่าน API: ข้อมูล T1, T2 ได้ผลตรงตาราง ADR 0005 / RESEARCH §5 |
| R4A-3 | U9.1 | วันไม่ว่างครบแสดง X/Y + blockers · ว่าง 3/3 แต่ไม่ว่างร่วม (T24) แยกชัดใน UI |
| R4A-4 | การมองเห็น | canary: response availability ไม่มี `note` และไม่มี title ของรายการซ่อน (ทุกบทบาทผู้ดู รวม super admin) · SQL snapshot ไม่มี `note` · no-store |
| R4A-5 | RBAC | เมทริกซ์ HTTP ครบ · 404 คนนอก/ถูกลบ/กลุ่มถูกลบ · สมาชิกที่ออกแล้วไม่ถูกนับทันที · super admin ที่ไม่ใช่สมาชิกไม่ถูกนับในผล (T16) แต่ audit การอ่าน · `must_change_pin` → 403 |
| R4A-6 | ขอบเขต/ประสิทธิภาพ | ช่วง >62 วัน ถูกปฏิเสธ · กลุ่ม 50 คน × 62 วัน × busy หนาแน่นคำนวณ < 200 ms (วัดและแนบ) · EXPLAIN ใช้ index |
| R4A-7 | หน้าจอมือถือ | e2e 375/390/768 × th/en × light/dark: ไม่ล้นจอ ปุ่ม ≥ 44px ไม่ hard-code ข้อความ · เดือน 4/5/6 สัปดาห์ · ชื่อยาว |
| R4A-8 | i18n/คอนทราสต์ | key parity · `npm run contrast` ผ่าน (วัน "ว่างร่วม" ต้องไม่พึ่งสีอย่างเดียว) |
| R4A-9 | e2e เรื่องเล่า | A,B,C ในกลุ่ม ลง busy ต่างกัน → เห็นวันว่างร่วมที่คาดหวัง + ช่วงเวลา · เปลี่ยนหน้าต่างวันของกลุ่ม → ผลเปลี่ยน · C ออกกลุ่ม → ผลนับ 2 คนทันที |
| R4A-10 | เกต + ตรวจอิสระ | lint/typecheck/db:check/style-literals/contrast/build · vitest ซ้ำ 3 รอบไม่ล้ม · CI เขียวบน GitHub · commit ตรงขอบเขต · QA + Security รันซ้ำเอง · Medium+ แก้และตรวจซ้ำ |

## 6. ความเสี่ยง
- ตัวเลข "ว่าง 3/3" ≠ "ว่างร่วม" → UI ต้องสื่อต่างกันชัด (UX)
- วัน/เวลาเงียบผิด (ขอบวัน DST ของกลุ่ม tz ต่างประเทศ) → fixtures T19–T22 + property test
- Blockers รั่วรายละเอียด → serializer เดียว + canary
- ผลที่ดูแน่นอนเกินจริง: busy ของคนที่ยังไม่ได้ลง = "ว่าง" → ข้อความช่วยใน UI ว่าอิงจากที่สมาชิกลงไว้ (UX)

## 7. สิ่งที่ boss ต้องทำ
- [ ] (ไม่บังคับ) ตอบถ้าไม่เห็นด้วยกับการแยก R4A/R4B
- [ ] หลังทีมส่ง bundle: fetch/push + เปิด PR ชื่อ `R4A: common free time` + รอ CI เขียว + merge
- [ ] ยังค้าง: deploy จริง Turso + Vercel (แนะนำทำก่อน R4B เพื่อเห็นบนมือถือจริง) · release tag v0.1.0–v0.3.0 (+ v0.4.0)
