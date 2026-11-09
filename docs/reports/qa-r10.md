# QA R10 — เตือนก่อนนัด (LINE OA + กระดิ่ง) + ปุ่มขั้น 2 (branch feat/r10-line-reminders)

ผู้ตรวจ: qa (อิสระ) · 2026-11-09 · ตรวจ `main...HEAD` (HEAD `c696f19`) ตาม R10_CONTRACT §6 · Windows, Node v26.13.0 (ไม่ใช่ 24)

## Verdict: ผ่านแบบมีข้อสังเกต
ไม่มีข้อ H · เกณฑ์ R10-1 ถึง R10-10 ผ่านตามที่ตรวจได้ในเครื่อง (R10-10 ส่วน CI/Vercel preview ตรวจไม่ได้) · ข้อสังเกตที่ควรตัดสินก่อน merge: M1 (ถ้อยคำ "อีกวันเดียว/One day to go")

## ข้อพบ
| # | ระดับ | เรื่อง |
|---|---|---|
| 1 | M | `messages/th.json` / `messages/en.json` คีย์ `notifications.appointment.reminder_1d`: "อีกวันเดียวถึงนัด" / "One day to go" ตายตัว แต่ `reminder_1d` ส่งได้ตั้งแต่ ~24 ชม. จนเหลือ ≥ 3 ชม. (`src/lib/calendar/reminders.ts:24`): นัดพุธ 23:00 สร้างก่อนอังคาร 23:00 → เตือนเลื่อนเป็นพุธ 08:00 (เหลือ 15 ชม.) · ตัวตั้งเวลาพลาดแล้วไปส่งตอนเหลือ 3 ชม. ก็ยังขึ้น "อีกวันเดียว" · contract §1.3 ห้ามคำตายตัวที่ไม่ตรงวันจริง (ในกระดิ่งมีวันเวลาจริงต่อท้ายอยู่ จึงไม่ผิดข้อมูล แต่ข้อความหลักขัดกัน) · ข้อความ LINE (`line.message.reminder_1d` "ใกล้ถึงนัดแล้ว" / "Coming up") เป็นกลางอยู่แล้ว · แนะนำใช้ถ้อยคำเป็นกลางแบบเดียวกันในกระดิ่ง (เช่น "ใกล้ถึงนัดแล้ว" / "Coming up") — เปลี่ยนข้อความ/อาจกระทบ e2e จึงไม่แก้เอง รายงาน main |
| 2 | L | Vercel Hobby: ตรวจเอกสาร Schedules จริง (https://vercel.com/docs/schedules/limits) Hobby มี jitter "Always 15 minutes" + ความถี่ต่ำสุด 15 นาที → รอบจริงเหลื่อมได้ถึง ~15 นาที · `reminder_1h` ยังส่งทันถ้าพลาดไม่เกิน ~45 นาทีก่อนเริ่ม (minLead 15 นาที) · แค่ข้อสังเกต ไม่เกินเงื่อนไขใน contract |
| 3 | L | ภาพเต็มหน้า (fullPage) ของ `/me` เห็นลิงก์ "ข้ามไปที่เนื้อหา" ลอยกลางหน้าและพื้นหลังไล่สีขาดช่วง — เป็นอาการของภาพเต็มหน้า (ส่วน fixed) ไม่ใช่บั๊กของ R10 |

## ตรวจตามเกณฑ์
- **R10-1/3 ผู้รับ + ไม่ส่งซ้ำ** (`tests/line/reminders.test.ts` 20 ข้อ): going เท่านั้นสำหรับ 1d/1h · nudge เฉพาะ maybe/ยังไม่ตอบ · ไม่ไป/คนออกแล้ว/ออกแล้วกลับเข้า/บัญชีระงับ/กลุ่มลบ/นัดยกเลิก ไม่ได้รับ · รันซ้ำ+รันพร้อมกันได้ผลเดิม · แก้เวลานัดเตือนตามเวลาใหม่ · อ่านโค้ด: `claimReminder` เป็น INSERT…SELECT ที่มีเงื่อนไข active/startAt/กลุ่มยังอยู่ ในธุรกรรมเดียวกับ `notify()` (`services/reminders.ts:31`) ✓
- **R10-2 กรณีพิเศษ §1.2** (`tests/calendar/reminders.test.ts`): ช่วงเงียบ 22:00/07:59/08:00 · ข้ามเที่ยงคืน/เดือน/ปี/ปีอธิกสุรทิน · tz ของนัด (Tokyo) · DST (London, Apia) · ขอบ 3 ชม. / 15 นาที (พอดี = ส่ง, ขาด 1 ms = ไม่ส่ง) · `scheduledAt == rawDue` ไม่ข้าม, +1 ms ข้าม · ตัวอย่างพุธ 23:00 สร้างอังคาร 23:30 = ข้าม 1d+nudge (เทียบก่อนเลื่อนช่วงเงียบ ตรงโค้ด `decideReminder`) แต่ยังมี 1h · `scheduled_at` อัปเดตเฉพาะเมื่อ startAt เปลี่ยน (`repos/appointment.ts` CASE) ✓ · ใช้ `src/lib/calendar` เท่านั้น (กฎ 9)
- **R10-4 กระดิ่ง** e2e: 3 ชนิด × th/en × สว่าง/มืด × 375/390/768 ข้อความถูกภาษา กดไป `/appointments/<id>` · `rsvp_nudge` ไม่เข้า outbox (`LINE_KINDS` ใน `notify.ts` + เทสต์) ✓ ดูภาพจริงแล้ว: ไอคอน/สีต่างกันชัด ข้อความ 3 บรรทัดตัด "…" ตอนชื่อกลุ่มยาว (พฤติกรรมเดียวกับ `appointment.created` เดิม)
- **R10-5 LINE** (`tests/line/channel.test.ts`): เนื้อหา (ชื่อนัด วันเวลา ชื่อกลุ่ม ลิงก์ `?openExternalBrowser=1` ไม่มีสถานที่/รายละเอียด/ชื่อสมาชิก) · retry key · retry ≤ 5 · 429 monthly limit ไม่ retry/ไม่พัง · ไม่มี env = ปิดเงียบ (`lineConfig` null → ไม่เขียน outbox, API `available:false`, `/me` ซ่อน) ✓
- **R10-6 webhook**: ลายเซ็นผิด/ไม่มี secret = 401 (`handleLineWebhook` ตรวจ raw body ก่อน parse, timing-safe) · โค้ดผิด/หมดอายุ/ใช้แล้ว reply ข้อความเดียวกัน · ข้อความไม่ใช่รูปโค้ดเงียบ · unfollow ยกเลิกผูก · rate limit (`tests/line/webhook.test.ts`) ✓ ไม่ตรวจเชิงลึกด้าน security (agent security ทำคู่ขนาน)
- **R10-7** อ่าน `console.*` ในโค้ด LINE/cron: log เฉพาะชื่อ error/จำนวน ไม่มีโค้ด/token/LINE id/เนื้อหา ✓ (สแกนอย่างจริงจังเป็นงาน security)
- **R10-8 ปุ่มขั้น 2** e2e: กดแล้วฟอร์ม busy เปิดทันที · URL ไม่มี `add=` · ปิดแล้วอยู่ปฏิทิน · รีเฟรชไม่เด้งซ้ำ ทุก viewport/ภาษา/ธีม ✓ ดูภาพ th/dark 375 แล้วฟอร์มเปิดถูกต้อง (วันที่ = วันนี้)
- **R10-9 `/privacy`**: ส่วน "ข้อความทาง LINE / Messages on LINE" + ข้อ retention (LINE user ID เก็บจนยกเลิก/ลบบัญชี/unfollow) ทั้ง TH/EN · บอกชัดว่าไม่ส่งสถานที่ รายละเอียด ชื่อสมาชิก และถ้าไม่เชื่อมไม่มีอะไรไป LINE ✓ e2e ผ่านทุกภาษา/viewport
- **R10-10 migration**: `tests/platform/migration-0004.test.ts` (DB ว่างและ DB ที่มีข้อมูล backfill `scheduled_at = created_at`) ผ่าน · SQL เพิ่มอย่างเดียว ไม่ลบ/เปลี่ยนคอลัมน์เดิม · DEFAULT 0 ทำให้โค้ดรุ่นเก่ายัง INSERT ได้ · CI/Vercel preview ตรวจไม่ได้
- **vercel.json**: เทียบกับ JSON schema ทางการ (https://openapi.vercel.sh/vercel.json) — `schedules.<ชื่อ>` รับ `schedule`, `timezone`, `path`, `requestMethod` (GET/POST) ตรงที่ใช้ · `crons` เดิม (`/api/cron/daily`) ยังอยู่ · ทั้งสอง path เรียกด้วย `CRON_SECRET` ผ่าน wrapper `route` เดียวกัน (`tests/security/cron-auth.test.ts` ครอบ) · รันทำงานจริงบน Vercel ตรวจไม่ได้ (OPERATIONS J2)
- **OPERATIONS**: J1.1 ระบุรัน migration `0004` กับ preview แล้ว prod **ก่อน merge** ชัดเจน, J1.2–J1.5 หลัง merge ตรงกับ contract §8 · SQL ลบบัญชีด้วยมือ I3 ล้าง `line_link_code` และ `notification_outbox` (ทดสอบ `tests/ops/manual-delete-sql.test.ts` ผ่านเมื่อไฟล์เป็น LF) ✓
- **TH/EN + hard-code**: ข้อความใหม่ทั้งหมดผ่าน `messages/*.json` (`me.line.*`, `notifications.appointment.*`, `privacy.*`, `line.*`) · ถ้อยคำเป็นธรรมชาติ ยกเว้น M1 · `LineSection` ไม่มีข้อความฝัง · ที่อยู่เพิ่มเพื่อน OA ส่งผ่าน API ตาม contract
- **a11y/จอ**: e2e `checkLayout` ตรวจ ปุ่ม/ลิงก์/input ≥ 44×44 px และไม่ล้นแนวนอนทุกสถานะ (idle/โค้ด/linked/กระดิ่ง/ฟอร์มขั้น 2) · `aria-live="polite"` ที่บล็อกโค้ด · `role="alert"` ที่ข้อผิดพลาด · Sheet ยืนยันยกเลิกใช้ `alert` + โฟกัสเริ่มที่ปุ่มยกเลิก · ดูภาพจริง 375/390/768 × th/en × สว่าง/มืด (เลือกดู 6 ภาพจาก 60) คอนทราสต์อ่านชัดทั้งสองธีม · ไม่ได้วัดคอนทราสต์เชิงตัวเลข

## คำสั่งที่รันและผลจริง
- `npx tsc --noEmit -p .` → ไม่มี error · `npx eslint . --ignore-pattern ".claude/**"` → ไม่มี output (ผ่าน) · `npm run build` → สำเร็จ (เห็น `/api/me/line`, `/api/cron/reminders`, `/api/line/webhook` ในตาราง route)
- `npx vitest run` ทั้งชุดแบบดิบ: 145 ไฟล์ 4966 เทสต์ ผ่าน 3896 ล้ม 1052 — ที่ล้มเกือบทั้งหมดเป็น EPERM ตอน cleanup `tests/helpers/db.ts:29` (rmSync ไฟล์ DB ชั่วคราวที่ Windows ล็อก)
- แยก EPERM ออก: ใช้ config ชั่วคราวนอก repo (`<scratchpad>/qa10/vc.mjs` + setup ที่กลืน EPERM/EBUSY ของ `rmSync` เท่านั้น, timeout 60 วิ) ไม่แตะโค้ด repo → **145 ไฟล์ 4966 เทสต์ ผ่าน 4931 ล้ม 17** · 17 ข้อที่ล้มเป็นปัญหาเครื่องเดิมทั้งหมด ไม่เกี่ยวกับ R10: `free-time` (ไม่มี Python), `admin-reset-pin-script`/`pepper-fingerprint-script`/`release` (spawn `.bin/tsx` ENOENT → exit null), `health` (Node v26 ไม่ใช่ v24), `config-hygiene` 2 ข้อ (CRLF), `manual-delete-sql` 4 ข้อ (OPERATIONS.md เป็น CRLF ทำให้ regex บล็อก SQL ว่าง — แปลงเป็น LF ชั่วคราวแล้วรันซ้ำ 4/4 ผ่าน แล้วคืนไฟล์เดิม `git status` สะอาด)
- ชุด R10 เฉพาะ (`tests/line`, `tests/calendar/reminders`, `tests/platform/migration-0004`, `tests/ui`, `tests/notifications` ด้วย config เดียวกัน): 32 ไฟล์ 604 เทสต์ ผ่านทั้งหมด
- `E2E_PORT=3117 npx playwright test tests/e2e/r10-reminders.spec.ts --output=C:/pw/o --workers=3` → **60 passed (1.3m)** (3 viewport × th/en × สว่าง/มืด รวมกรณี 401 และไม่มี env LINE) · ไม่ได้รัน e2e ทั้งชุด (เฉพาะส่วนที่เกี่ยวข้องกับ R10 ตามคำสั่ง)

## ตรวจไม่ได้
CI และ Vercel preview บน GitHub · Schedules ทำงานจริง/ส่ง `CRON_SECRET`/preview กินรอบ (OPERATIONS J2, ต้อง boss/ops) · ส่ง LINE จริง/webhook จริง (R10-11 หลัง merge) · `/me` ใช้ LINE API จำลองด้วย `page.route` ตามที่ผู้ทำ e2e ออกแบบ (ไม่ได้ยิง `/api/me/line` จริงที่มี env LINE) · Node 24 · PowerShell จริง · การวัดคอนทราสต์เชิงตัวเลข · security เชิงลึก (security-r10)
