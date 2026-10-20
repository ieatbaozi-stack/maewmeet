# QA R4A — วันว่างร่วม (independent review)

ผู้ตรวจ: QA (ไม่ใช่ผู้เขียน) · branch `r4a` HEAD `ab118db` · ช่วง `68e2621..HEAD` · 2026-10-20 · Node 24.22

## Verdict
**ผ่านแบบมีเงื่อนไข — ไม่มี Critical/High** · อัลกอริทึม, API, การมองเห็น (canary), e2e ผ่านหมดและตรงกับที่คำนวณมือ · เหลือ Medium 3 ข้อ (ข้อความค้าง/ลิงก์ที่หายบนหน้ากลุ่ม, คำสัญญา "สร้างนัด" บนหน้าหลัก, ขนาด payload) ควรแก้ก่อน merge หรือจดเป็น R4B-prereq

## เกต (รันซ้ำเอง ไม่อิงใบรับรอง)
| เกต | ผล |
|---|---|
| lint / typecheck / db:check | ผ่าน (exit 0 ทั้งสาม) |
| check-style-literals (`src`) | ผ่าน |
| contrast | ผ่าน 294 คู่ ไม่ผ่าน 0 · ต่ำสุด 4.54:1 · dark block ตรงกัน |
| build | ผ่าน (มี route availability) |
| vitest เต็ม | รอบ 1: 84 files / 3361 tests ผ่าน (256 s) · รอบ 2: 84 files / 3361 tests ผ่าน (204 s) · perf 50×62: median 84 ms, 932 KiB |
| e2e free-story, free-layout, calendar-story/layout/errors, busy-api (`--retries=0`, พอร์ต 3917 และ 3918, DB แยก) | รอบ 1: 21 passed / 18 skipped · รอบ 2: 21 passed / 18 skipped (skip = เรื่องเล่าเต็มรันเฉพาะ mobile-390 ตามสเปก) · ไม่มี flaky |

## Pass/Fail ตามเกต R4A
| เกต | ผล | หมายเหตุ |
|---|---|---|
| R4A-1 อัลกอริทึม | PASS | fixtures T1–T24 + property ผ่านใน vitest · ทำซ้ำมือเพิ่ม 8 เคส (ด้านล่าง) ตรง |
| R4A-2 U9 AC ผ่าน API | PASS | T1/T2/T24 ในเทสต์ API + e2e |
| R4A-3 U9.1 / T24 แยกชัด | PASS | กรอบประ+"3/3" vs ทึบ+ติ๊ก; aria-label ต่างกัน |
| R4A-4 การมองเห็น | PASS | canary ใน e2e/API ผ่าน · ไม่พบ note/title ซ่อน |
| R4A-5 RBAC | PASS | (เทสต์ API 404/403/401 ผ่าน; ไม่ได้ตรวจเชิงลึกซ้ำ — Security ทำ) |
| R4A-6 ขอบเขต/perf | PASS (มีข้อสังเกต M3) | 62 วันพอดีผ่าน/63 ปฏิเสธ · perf < 200 ms |
| R4A-7 มือถือ | PASS | e2e layout ผ่านทั้ง 3 viewport · ภาพจริง 375 th/en ดูแล้วตรง sample |
| R4A-8 i18n/คอนทราสต์ | PASS | key parity th/en ไม่ขาด (ตรวจเอง) · contrast ผ่าน |
| R4A-9 e2e เรื่องเล่า | PASS | ผ่าน 2 รอบ |
| R4A-10 เกต+ตรวจอิสระ | PASS (CI GitHub ไม่ได้ตรวจ — นอกขอบเขตเครื่องนี้) | |

## ทำซ้ำมือ (ไม่อยู่ใน fixtures) — ทั้งหมดตรงที่คาด
- สมาชิกที่ busy เป็นช่วง ๆ แต่เหลือช่วง ≥ min (A ติด 08–10, 12–14, 16–22) → ว่าง · ว่างร่วม 10–12, 14–16 (API)
- หน้าต่าง 00:00–24:00 + busy 22:00→02:00 → `00:00-22:00` / `02:00-24:00` (ป้าย 24:00 ถูก)
- busy แตะขอบหน้าต่าง (06–08, 22–23:59) → ไม่มีผล ไม่มี blockers
- London วัน DST 2027-03-28 หน้าต่าง 00–24 min 60, A 00:30→03:00 → `03:00-24:00` ยาว 21 ชม. (วัน 23 ชม.) ตรง T22
- Kathmandu (+5:45) กับ busy tz Bangkok → `10:45-22:00` ถูก
- solo group → 200, 1/1; all-day ของ Pacific/Kiritimati วัน 11-05 ปิดเฉพาะ 11-05 ของกลุ่ม Bangkok
- **margin 26 ชม. พอและใช้ถูกทั้งสองปลาย**: brute force 12 tz (Kiritimati, GMT+12, Chatham, Kolkata, Kathmandu, Apia, ...) × 12 tz × 5 หน้าต่าง (รวม 00:00–00:30, 23:30–24:00) × ช่วง 1/42 วัน × วันแรก/วันสุดท้าย: all-day ทุกแถวที่ lib ต้องใช้อยู่ในช่วงดึง ไม่มีหลุด (สคริปต์: scratchpad `qa/margin.test.ts`) · derive มือ: กรณีแคบสุดเหลือ ~30 นาที (ปลายต้น: owner +14 / กลุ่ม −12 หน้าต่างเริ่ม 23:30) → พอแต่ **แน่นมาก** ห้ามลดค่า
- tz ของเบราว์เซอร์ต่างกลุ่ม: เบราว์เซอร์ Pacific/Kiritimati (วันที่ 10-21) กลุ่ม Bangkok (วันนี้ 10-20) → ช่องวันนี้ยัง selectable, ช่องเมื่อวานเป็น past ถูก (ตัดสินด้วย tz กลุ่ม)

## ฝั่งไคลเอนต์ที่ตรวจ (ภาพ/พฤติกรรมจริง)
- Sheet: Tab วนอยู่ใน dialog (ปุ่มปิด ↔ สร้างนัด), Shift+Tab วนกลับ, Escape ปิดและคืนโฟกัสไปช่องวันที่เปิด · `aria-modal`, `aria-labelledby` ชี้หัววัน
- ตาราง: roving tabindex เหลือ 1 ช่อง (`tabindex=0`) · ลูกศรขวา+ลง จากวันนี้ไปถึงวันที่ถูก · ช่อง past คลิกแล้วไม่เปิด dialog
- console ว่าง (ไม่มี hydration warning/err) ทั้ง th ที่ 375/768 และ en/dark
- ผลซ้อนกันของคำขอเดือน: effect ใช้ `live` + key ต่อคำขอ → ผลเก่าถูกทิ้ง (อ่านโค้ด; ไม่พบช่องโหว่)
- หน้าหลักผู้ไม่มีกลุ่ม: CTA → `/calendar?v=free` → การ์ด "ยังไม่มีกลุ่มให้ดูปฏิทิน" (ไม่พัง)
- `/groups/:gid/settings#window` เลื่อนถึง section ถูกทั้ง admin และสมาชิก (top=0)

## Findings

### Critical / High
ไม่พบ

### Medium
**M1 — หน้ากลุ่มยังบอกว่า "ปฏิทินกลุ่มกำลังมา" และไม่มีลิงก์ไปวันว่างร่วม**
`src/app/(app)/groups/[gid]/page.tsx:86-95` (key `group.calendarSoon.*`, messages/th.json:506 · en.json:506). ปฏิทินมีตั้งแต่ R3 และวันว่างร่วมเสร็จใน R4A แต่ panel ยังโชว์ข้อความ placeholder เดิม ("อีกไม่นานคุณจะเห็นวันที่ทุกคนว่างตรงกันที่นี่") และไม่มีลิงก์ใดจากหน้ากลุ่มไป `/calendar?g=<gid>&v=free` ทั้งที่ UX X34(4) ระบุ deep link นี้ · ทำซ้ำ: เปิดกลุ่มที่มี ≥ 2 คน → เห็น panel (ภาพ `group-page.png` ใน scratchpad). แก้: เปลี่ยน panel เป็น CTA "ดูวันที่ว่างตรงกัน" → `/calendar?g=<gid>&v=free`, ลบ key `calendarSoon` และแก้ `tests/e2e/groups-responsive.spec.ts` ที่อ้างถึง

**M2 — หน้าหลักสัญญาว่า "สร้างนัดจากวันนั้นได้เลย" แต่ปุ่มสร้างนัดยัง disabled**
`messages/*.json` `empty.home.body` (th: "…แล้วสร้างนัดจากวันนั้นได้เลย" / en: "…then make a plan from it.") + `src/app/(app)/page.tsx` · ผู้ใช้กด CTA ไปเจอปุ่ม "สร้างนัด · เร็วๆ นี้" ที่กดไม่ได้ → ผิดคาด. แก้ชั่วคราวจน R4B: "ดูว่าวันไหนทุกคนว่างตรงกัน" (ตัดท่อนหลัง) หรือคืนเมื่อ R4B ส่ง

**M3 — ขนาด payload `blockers` ซ้ำ item ต่อวัน (932 KiB กรณีหนาแน่น 50 คน × 62 วัน)**
`src/lib/data/services/availability.ts` (สร้าง `blockers` ต่อวันแล้วใส่ item เต็มทุกวันที่ทับ) · busy หลายวันถูกส่งซ้ำทุกวัน และหน้า SSR `?v=free` ฝัง DTO ทั้งก้อนลง HTML/RSC อีกชั้น (`calendar/_lib/load.ts`) · UI ขอ 42 วัน (~630 KiB สัดส่วน) ไม่ใช่ 62 · ผลวัดจริงใน scratchpad กลุ่ม 3 คน/42 วัน = 10 KiB (ปกติเล็ก) แต่ response ไม่ถูก compress ในเซิร์ฟเวอร์ `next start` ที่ทดสอบ (`content-encoding` ว่าง; Vercel จะ brotli ให้) · ยอมรับได้สำหรับกลุ่มจริง (~3–10 คน) แต่เพดาน 5000 แถวทำให้กลุ่ม ~17 คนที่ลงเต็ม 300 รายการ truncated ก่อน · **ข้อเสนอลด**: (1) dedupe — ส่ง `busy: {[id]: item}` ระดับบน แล้ว `days[].blockers = [{userId, itemIds}]` (ลด 5–10×สำหรับ busy หลายวัน) (2) ตัด `tz`/`hideDetail`/`userId` ซ้ำจาก item ที่ UI ไม่ใช้ (3) รายละเอียดวันดึงแบบ lazy `?date=` ตอนเปิด sheet ส่วนตารางเดือนส่งเฉพาะ `{date, free, total, allFree, notFreeUserIds}` + segments (≈ <40 KiB ที่ 50 คน) · ไม่ต้องแก้ก่อน R4B ถ้ากลุ่มเล็ก แต่ควรจดเป็นหนี้

### Low
- **L1 `d=` ใน URL ถูกเขียนเสมอ แล้วรีโหลดเปลี่ยนวันตั้งต้นของแผงขวา (iPad)**: `CalendarView.tsx` effect `replaceState` ใส่ `d=selected` แม้ผู้ใช้ไม่ได้เลือกวัน → รีโหลดตีความเป็น `dateGiven=true` ทำให้แผงขวาปักที่ "วันนี้" แทน "วันแรกที่ว่างร่วม" ตาม UX X39 (เห็น URL เปลี่ยนเป็น `&d=2026-10-20` ทันทีหลังโหลดครั้งแรก; ผล visible เฉพาะเมื่อวันนี้ไม่ใช่วันว่างร่วม — อ่านโค้ด ไม่ได้จำลองครบ). แก้: เขียน `d` ในมุมมอง free เฉพาะเมื่อ `freePicked != null`
- **L2 วันนี้ถือว่าว่างทั้งวัน**: API/UI ไม่ตัดช่วงเวลาที่ผ่านไปแล้วของวันนี้ (21:00 ยังโชว์ "ว่างร่วม 08–22") — พฤติกรรมตาม ADR (pure, ไม่มี now) แต่ควรจดเป็นข้อสังเกตสำหรับ R4B
- **L3 ข้อความ `none` ในช่อง/aria "ทั้งวันไม่ว่าง/busy all day" ไม่ตรงเมื่อ 0 คนว่างเพราะเหลือช่วงสั้นกว่าขั้นต่ำ** (ไม่ได้ติดทั้งวัน) — `availability.cell.aria` / `status.none`; รายละเอียดวัน (`noneBody`) พูดถูก แนะนำ "ไม่มีใครมีเวลาว่างพอ"
- **L4 ภาษาไทย "และCat"**: `joinNames` ไม่เว้นวรรคระหว่าง "และ" กับชื่อละติน ("Ann 6c4665 และCat b24f19") — cosmetic
- **L5 คำใหม่ "ไม่ได้ลงว่าติด"** (`availability.day.blockers.noBusy`) ไม่ตรงคำที่ใช้ทั่วแอป "ลงวันไม่ว่าง" — พิจารณา "ยังไม่ได้ลงวันไม่ว่าง"
- **L6 truncated**: เรียง `start_at` แล้ว LIMIT → วันท้ายช่วงเป็นฝั่งที่ "ว่างเกินจริง" (มีแถบเตือน X46 แล้ว) — ยอมรับได้
- **L7 หน้าต่าง DST ที่เริ่ม/จบในช่วง gap** (เช่น 01:00–02:00 London วัน spring-forward → หน้าต่างยาว 0): ไม่ crash ผลเป็น "0 ว่าง" — edge สุดโต่ง ไม่ทดสอบต่อ
- ข้อสังเกตคำศัพท์: แท็บ "ว่างตรงกัน/Free days" vs "ว่างร่วม/Everyone's free" ในรายละเอียด — สอดคล้องตาม UX §8.5 ยอมรับ

## ภาพจริง vs sample
ดู 375 th/light (สรุป, ตาราง 5 สัปดาห์, ช่องติ๊ก/ 2/3), sheet รายละเอียดวัน, หน้าหลักไม่มีกลุ่ม ตรงโครงกับ `docs/design/samples/availability.html` (การ์ดสรุปเขียว, 4 ปุ่มเรียงเดือน|ว่างตรงกัน|วัน|ของฉัน ไม่ล้น, ปุ่ม "สร้างนัด · เร็วๆ นี้" ท้าย sheet) · ไม่พบจุดเบี่ยง ยกเว้นที่ระบุใน M1/L4 · ภาพ en/dark 375 และ 768 ถ่ายไว้ใน scratchpad (`shots/`) ไม่พบล้นจอ

## ไฟล์ repro (นอก repo)
`/tmp/claude-0/-home-claude/dd92bedd-a845-5dfe-8e80-ceeeb2718b23/scratchpad/qa/{margin.test.ts,api.test.ts,qa-explore.spec.ts}` · ไม่ได้แก้ `src` และไม่ commit ไฟล์อื่นนอกจากรายงานนี้
