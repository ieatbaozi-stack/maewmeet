# R6A_CONTRACT.md — หน้าหลัก: จำนวน "ไม่ไป" (B1) + นับถอยหลังในรายการนัดถัดๆ ไป (F4)

> ผู้เขียน: Lead · 2026-11-01 · สถานะ: **boss เห็นชอบแล้ว** 2026-11-01 ("approve ให้ทำทั้งหมด")
> อ้างอิง: [docs/NEXT_PHASE.md](docs/NEXT_PHASE.md) B1, F4 · [R4B_CONTRACT](R4B_CONTRACT.md) (หน้าหลัก U11) · ส่งงานเป็น PR ตาม CLAUDE.md กฎ 10
> ข้อเสนอเลขเวอร์ชัน: **v0.7.1** (แก้บั๊ก + ปรับ UI เล็ก ไม่มี schema/API ใหม่)

## 1. ขอบเขต
**ทำ**
1. **B1** การ์ด "นัดถัดไป" บนหน้าหลัก (`src/components/home/HomeView.tsx`) แสดง "ไม่ไป N" / "N can’t go" เมื่อ `counts.not_going > 0` — กติกาเดียวกับ "อาจไป" (ซ่อนเมื่อ 0) · ใช้คีย์เดิม `appointments.rsvp.summary.notGoing` (มีครบ TH/EN แล้ว) · ลำดับ: ไป → อาจไป → ไม่ไป → ยังไม่ตอบ (ตรงกับหน้ารายละเอียดนัด)
   - หน้ารายละเอียดนัด (`AppointmentDetail.tsx`) แสดงครบ 4 ค่าอยู่แล้ว → ไม่แก้ แค่ยืนยันว่าสอดคล้อง
2. **F4** แถวใน "นัดถัดๆ ไป" มีป้ายนับถอยหลังต่อท้ายชื่อ เช่น "หมูกระทะ · อีก 2 วัน" / "Mookata · In 2 days"
   - ใช้ตรรกะเดียวกับการ์ดนัดถัดไป (`countdownKind` + `daysUntil` ที่ API คำนวณเป็นวันปฏิทินใน tz ของนัด — ดีฟอลต์ Asia/Bangkok) → ไม่มีการคำนวณวันใหม่ในฝั่ง UI (กฎ 9)
   - ข้อความ: กำลังจัดอยู่ (`appointments.status.ongoing`) / วันนี้ / พรุ่งนี้ / อีก # วัน (`home.countdown.aria`) — ไม่เพิ่มคีย์ใหม่
   - ชื่อยาวถูกตัด (ellipsis) แต่ป้ายนับถอยหลังต้องเห็นเต็มเสมอ
   - `home.row.aria` เพิ่มพารามิเตอร์ `{countdown}` ให้ screen reader ได้ยินด้วย (แก้ทั้ง TH/EN)

**ไม่ทำ**: schema/migration · API · สิทธิ์ · อัปเดต `daysUntil` ข้ามเที่ยงคืนโดยไม่โหลดใหม่ (พฤติกรรมเดิมของการ์ด) · F1/F2/F3/F5/F6

## 2. ไฟล์ (บทบาท)
| บทบาท | ไฟล์ |
|---|---|
| Front-end (#6) | `src/components/home/HomeView.tsx`, `src/components/home/model.ts` (helper ล้วน), `src/styles/appointments.css` |
| UX & Brand (#4) | `messages/th.json`, `messages/en.json` (`home.row.aria` เท่านั้น) |
| TEST (#11) | `tests/ui/home-model.test.ts`, `tests/e2e/appt-layout.spec.ts` |
| Release (#15) | `CHANGELOG.md` (Unreleased) |
| QA | ตรวจอิสระ (agent แยก) |

## 3. เกณฑ์ผ่าน
| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R6A-1 | B1: not_going > 0 → แสดง "ไม่ไป N" · = 0 → ไม่แสดง · ลำดับ 4 ค่าตรงหน้ารายละเอียด | Vitest helper `rsvpCountItems` + e2e appt-layout (A ตอบไม่ไป → B เห็น `home-count-not_going`) |
| R6A-2 | F4: ป้ายแถวถูกต้องทุกกรณี — กำลังจัดอยู่ / วันนี้ (รวม daysUntil ≤ 0) / พรุ่งนี้ / อีก N วัน · นัดข้ามคืน · ขอบเที่ยงคืนเวลาไทย | Vitest helper `rowCountdown` (ใช้ `daysUntil` จาก API + `nowMs`) |
| R6A-3 | ข้อความ TH/EN: คีย์เท่ากัน · `home.row.aria` มี `{countdown}` ทั้งสองภาษา · ไม่มี hard-code | Vitest (เทสต์ messages ที่มีอยู่) + e2e ตรวจข้อความทั้ง th และ en |
| R6A-4 | เลย์เอาต์: 375/390/768 × th/en ไม่มี scroll แนวนอน · ปุ่ม ≥ 44px · ชื่อนัด 80 ตัวไม่ดันป้ายนับถอยหลังหาย | e2e appt-layout (`checkLayout`) — รันใน CI |
| R6A-5 | ไม่ถอยหลัง | CI ของ PR เขียวครบ (lint, typecheck, test, build, contrast, e2e 4 shard) |

## 4. ความเสี่ยง
- ป้ายในแถวแย่งที่ชื่อบนจอ 375 → ชื่อเป็น `min-width: 0` + ellipsis, ป้าย `flex: none` + nowrap
- `daysUntil` อิง tz ของนัด ไม่ใช่ tz เครื่องผู้ใช้ — ตั้งใจ (ตรงกับการ์ดเดิม) · ผู้ใช้ส่วนใหญ่อยู่ Asia/Bangkok
