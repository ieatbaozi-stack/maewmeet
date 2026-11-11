# Security review — R14b (UI busy routine · แก้ `remaining` ของ GET /api/me/busy-routines · แถบ detailTruncated)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-11 · branch `feat/r14b-busy-routine-ui` HEAD `335b5bc` · ดู `git diff origin/main...HEAD` (8 commit, 25 ไฟล์) · เทียบ R14_CONTRACT §11, ADR 0006, ADR 0012 §7, กฎเหล็ก CLAUDE.md ข้อ 6–8 · ต่อจาก `security-r14a.md`
- วิธี: อ่านโค้ดจริงทุกไฟล์ใน diff ที่แตะข้อมูล routine/busy · รันเทสต์ของทีมเอง · ไม่แก้ `src/`/`tests/`/config · ไม่มี probe ค้าง
- เครื่อง: Windows (checkout CRLF) · เทสต์รันผ่าน shim นอก repo ที่กลืน `EPERM` · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 3 |

**Verdict: ผ่าน** ไม่พบการรั่วของข้อมูล routine หรือ note ไปถึงคนอื่น ไม่พบ XSS และไม่พบ injection

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **afc1bd9 subquery `remaining`: injection** | **PASS** | 📖 `src/lib/data/repos/busy-routine.ts:173` ส่วนที่เขียนเองมีแค่ชื่อตาราง/คอลัมน์คงที่ (`"busy_routine"."user_id"`, `"busy_routine"."id"`) · ค่าเดียวที่มาจากภายนอกคือ `${now}` ซึ่ง drizzle `sql` ส่งเป็นพารามิเตอร์ (ไม่ต่อสตริง) และเป็นเวลาของเซิร์ฟเวอร์ ไม่ใช่อินพุตผู้ใช้ |
| **afc1bd9: นับเฉพาะของเจ้าของ** | **PASS** | 📖 แถวนอกถูกกรองด้วย `eq(busyRoutine.userId, userId)` (`:176`) · subquery ผูก `b.user_id = busy_routine.user_id AND b.routine_id = busy_routine.id` แถว busy ของคนอื่นจึงนับเข้าไม่ได้ แม้มี `routine_id` ตรงกัน · โค้ดเดิม (`b.routine_id = "id"` ผูกกับ `b.id`) ให้ 0 เสมอ ไม่ได้รั่ว แค่ผิด · ✅ `tests/platform/r14-busy-routine.test.ts:573` สร้าง routine 7 วัน/สัปดาห์ของ b ไว้ด้วย แล้วผลของ a ตรงพอดี `{10, 8, 3}` → `{9, 4, 0}` หลังเลื่อนนาฬิกา · `:589` ล็อกรูป SQL ไว้กันถอยหลัง |
| **GET /api/me/busy?from&to เพิ่มในปฏิทิน (ป้าย "ประจำ")** | **PASS** | 📖 route `src/app/api/me/busy/route.ts` ผูก `actor` (ของฉันเท่านั้น, query `.strict()` + `dateField`) · `CalendarView.tsx:228-241` เก็บเฉพาะรายการที่มี `routineId` ลง `Map` ใน state ไม่ผสมกับข้อมูลกลุ่ม · `DayPanel.tsx:128` ใช้ map เฉพาะแถวที่ `member.userId === myId` และชนิด busy · id ของ busy ไม่ซ้ำข้ามผู้ใช้ จึงติดป้าย/ปุ่มแก้บนแถวของคนอื่นไม่ได้ · note อยู่ใน map แต่ส่งต่อเฉพาะให้ `BusyFormSheet` ของเจ้าของ (ทำแบบเดิมในรายการ "ของฉัน") ไม่แสดงในแถวปฏิทิน · ล้มเหลว = ไม่มีป้าย · ไม่ยิงคำขอนี้ในมุมมองว่างตรงกัน (ตรง §11) |
| **ไม่มีข้อมูล routine ใน URL / storage / log / analytics** | **PASS** | ✅ grep `localStorage|sessionStorage|console.|sendBeacon|gtag|document.cookie|innerHTML|eval(` ในไฟล์ routine ใหม่ + CalendarView/DayPanel/BusyItemLine/FreeView: ไม่พบ ยกเว้นโค้ดเดิมที่เขียน `g`/`v`/`d` ลง URL (`CalendarView.tsx:254-261,425`) ไม่มีค่าของ routine · path API ใช้ `encodeURIComponent` กับ id (`routine-model.ts:513-522`) และ `from` เป็นวันที่ที่คำนวณเอง · `callApiFull` = `same-origin`, `no-store` |
| **XSS ผ่าน title/note** | **PASS** | ✅ `grep -rn dangerouslySetInnerHTML src` ไม่พบเลย · 📖 title แสดงเป็น text child ของ React (`RoutineList.tsx:93-97`, `RoutineScopeSheet.tsx:140` ผ่าน `<Name>`) · `withNames` (`Name.tsx:18-29`) แยกด้วย placeholder แล้วใส่ชื่อเป็น child ของ `<bdi>` ไม่ผ่าน ICU/HTML · `aria-label` ที่ใส่ title (`RoutineList.tsx:90,124`, `DayPanel.tsx:142`) เป็น attribute ที่ React escape เอง · note แสดงใน `<textarea value>` เท่านั้น · เซิร์ฟเวอร์ยังตรวจ title ด้วย `checkVisibleName` (ไม่มี bidi/control) |
| **detailTruncated ไม่เปิดเผยเพิ่ม** | **PASS** | 📖 `FreeView.tsx:84-91` แสดงข้อความคงที่ `availability.detailTruncated` อย่างเดียว ไม่มีจำนวน/ชื่อ · flag มาจาก `services/availability.ts:170-204` (มีตั้งแต่ R14a) · `nobodyLoggedBusy` (`availability/model.ts:214`) ใช้ `notFreeUserIds` ที่มีใน DTO อยู่แล้ว ไม่ได้ขอข้อมูลใหม่ |
| **canary ใน e2e 335b5bc มีความหมาย** | **PASS** | 📖 `tests/e2e/r14b-busy-routine.spec.ts:135-136` canary ไม่ซ้ำต่อเทสต์ทั้ง title และ note · เปิดซ่อนรายละเอียด · ฝั่ง Bob ตรวจทั้ง (ก) ทุก response `/api/*` ที่หน้าได้รับ + ยิงตรง calendar/availability ที่มี positive control (`length > 200`) (ข) DOM ทั้งหน้ารวม SSR (`:257-258`) (ค) ไม่มี `routineId/rangeKind/"weekdays"` และ Bob ไม่เรียก `busy-routines` (`:259-263`) (ง) ไม่มีป้าย/ปุ่ม routine (`:244-245`) · ⚠️ e2e ไม่ได้รันในเครื่องนี้ (ดูด้านล่าง) |
| **ความลับ / log** (กฎ 7) | **PASS** | ✅ grep บรรทัดที่เพิ่มใน diff หา `password|secret|api_key|token|postgres://|BEGIN KEY`: เจอแค่ `process.env.TURSO_AUTH_TOKEN` ใน e2e (อ่านจาก env ไม่มีค่าจริง) · ไม่มี env ใหม่ |
| **สิทธิ์ที่เซิร์ฟเวอร์** (กฎ 6) | **PASS** | 📖 ปุ่มแก้/ลบ routine ใน UI เรียก API เดิมของ R14a ที่ตรวจเจ้าของใน SQL แล้ว (ดู security-r14a) · UI ไม่ได้เป็นด่านเดียว |
| **schema / migration** (กฎ 8) | **N/A** | ไม่มี migration ใหม่ |

## Info
1. **Info 1 — canary ครอบเฉพาะกรณีซ่อนรายละเอียด:** e2e (`r14b-busy-routine.spec.ts:169`) เปิด `routine-hide` ก่อนตรวจ ฝั่ง Bob จึงพิสูจน์ว่า title ไม่ออก **และ** note ไม่ออกในกรณีซ่อน แต่ไม่ได้พิสูจน์ใน e2e ว่า note ไม่ออกเมื่อ*ไม่*ซ่อน (title แสดงได้ แต่ note ต้องไม่แสดง) · ระดับเซิร์ฟเวอร์ครอบแล้ว (`tests/platform/r14-busy-routine.test.ts` canary ตาม ADR 0006 และ `sharedBusyInGroupQuery` ไม่เลือกคอลัมน์ `note`) จึงไม่บังคับ · เสนอเพิ่มในรอบหน้า
2. **Info 2 — SQL ใน e2e ต่อสตริงวันที่:** `seedSpread` (`r14b-busy-routine.spec.ts:649`) ใส่ `date` และ `TZ` ลง SQL ตรงๆ · ค่ามาจาก `addDays` และค่าคงที่ ไม่ใช่อินพุตผู้ใช้ และเป็นโค้ดทดสอบ จึงไม่ใช่ช่องโหว่ · ฟังก์ชันนี้เขียนลง `TURSO_DATABASE_URL` ใดก็ตามที่ตั้งไว้ (รูปแบบเดิมของ e2e ทั้งชุด `tests/e2e/support/env.ts:10`) อย่ารัน e2e โดยตั้ง env ชี้ฐานจริง
3. **Info 3 — คำขอเพิ่มต่อการเลื่อนช่วง:** ปฏิทินเดือน/วันยิง `GET /api/me/busy?from&to` อีก 1 ครั้งต่อช่วง/`version` (`CalendarView.tsx:228-232`) · เป็นข้อมูลของตัวเอง และกันยิงซ้ำด้วย key แล้ว ไม่ใช่ประเด็นความปลอดภัย

## คำสั่งที่รัน + ผลจริง
```
npx vitest run tests/platform/r14-busy-routine.test.ts tests/ui/r14b-routine-model.test.ts
  → Tests 1 failed | 86 passed (87)   # ข้อที่ล้ม: R14-5 canary "Test timed out in 5000ms" (เครื่องช้า)
npx vitest run tests/platform/r14-busy-routine.test.ts tests/ui/r14b-routine-model.test.ts --testTimeout=60000
  → Test Files 2 passed (2) · Tests 87 passed (87) · Duration 96.45s
npx vitest run tests/security tests/ui --testTimeout=60000
  → Test Files 1 failed | 37 passed (38) · Tests 2 failed | 893 passed | 1 skipped (896)
    ล้ม 2 ข้อ = config-hygiene "ci.yml / keepalive.yml permissions" (ปัญหา CRLF เดิมของเครื่อง Windows ไม่เกี่ยวกับรอบนี้)
npx tsc --noEmit -p .        → exit 0
npx eslint src/components/busy src/components/calendar src/components/availability src/lib/data/repos/busy-routine.ts → exit 0
grep dangerouslySetInnerHTML ใน src → ไม่พบ
```

## สิ่งที่ตรวจไม่ได้
- e2e `tests/e2e/r14b-busy-routine.spec.ts` ไม่ได้รันในเครื่องนี้ (Windows ต้องมี build + เซิร์ฟเวอร์ e2e) · ตรวจจากการอ่านโค้ดเท่านั้น ผลจริงให้ดูจาก CI
- `npm test` ทั้งชุดไม่ได้รัน (EPERM/timeout เดิมของเครื่อง)
