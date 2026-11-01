# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](docs/NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-01

## เสร็จแล้ว
- R0–R5: foundation, บัญชี PIN, กลุ่ม, ปฏิทิน + busy, วันว่างร่วม + สร้างนัด, หน้า super admin + audit log (ดู CHANGELOG)
- ออก **v0.7.0** (2026-10-28)
- CI-1: artifact Playwright อัปโหลดเฉพาะตอนเทสต์ล้ม (PR #10)
- R6A: B1 การ์ดนัดแสดงจำนวน "ไม่ไป" + F4 นับถอยหลังในรายการนัดถัดๆ ไป (PR #11)
- R6B: F3ข แท็บ "ว่างตรงกัน" เด่นขึ้น + F3ค ปุ่ม "สร้างนัด" บนปฏิทิน (PR #13)
- ออก **v0.7.1** (2026-11-01) รวม R6A + R6B
- ทีม agent v2: เหลือ 10 บทบาทใน `.claude/agents/` พร้อม tools/model + อีเมล commit แบบ noreply (PR นี้)
- **R6C เสร็จ (รอ boss merge)** — branch `feat/r6c-member-appearance` (HEAD `b2e09ca`)
  - F3ก: ตั้งสี 1–10 และรูปทรง 1–10 ของตัวเองต่อกลุ่ม แยกกัน ซ้ำกับคนอื่นได้ · "ใช้แบบอัตโนมัติ" กลับค่าเดิม · ไม่ตั้ง = หน้าตาเดิมทุกอย่าง
  - migration `0002` (คอลัมน์ `color_slot`/`shape_slot` nullable + CHECK 1–10, ไม่ backfill) · API `PATCH /api/groups/:gid/members/me/appearance`
  - QA เก็บตก R6B: L2 ปุ่มแถบบนจอกว้างซ่อนตอน gone/error/loading · L3 ธีมมืด · L4 ภาพหลังเลื่อนลงสุด
  - ผลตรวจอิสระ: **qa ผ่าน** (`docs/reports/qa-r6c.md`, L1 แก้แล้วและตรวจซ้ำ `b2e09ca`) · **security ผ่านแบบมีข้อสังเกต** (`docs/reports/security-r6c.md`, 0H/0M/2L, L1 แก้แล้ว `63be889`)
  - ข้อเสนอเลขเวอร์ชัน: **v0.8.0** (MINOR) — ยังอยู่ใต้ `[Unreleased]` ใน CHANGELOG ยังไม่ออก

## รอ boss
- [ ] รัน migration `0002` กับ Turso ก่อน merge: **B6** (prod) + **B7** (preview) ตาม [docs/OPERATIONS.md](docs/OPERATIONS.md) — ถ้าไม่ทำ preview/โค้ดใหม่บนฐานเดิมจะอ่าน `color_slot` ไม่ได้
- [ ] merge PR เข้า `main` แบบ **Create a merge commit** (boss กดเอง)
- [ ] ออก **v0.8.0** หลัง merge: `npx tsx scripts/release.ts 0.8.0` + push tag (เลขเป็นข้อเสนอ ยังไม่ได้รับการตัดสิน)

## เหลือ
- F1 onboarding · F2 ความช้า (วัดก่อน-หลัง) · F5 ข้อความหน้า /privacy · F6 แจ้งเตือนก่อนนัด (**boss ยังไม่ตัดสินช่องทาง**) — ตาม `docs/NEXT_PHASE.md`
- R6 hardening backlog (ดู `docs/NEXT_PHASE.md`)
- backlog ใหม่จาก R6C (ไม่บล็อก merge):
  - `tests/security/authorize-first.test.ts:154` เทียบ path ด้วย `/` ล้มบน Windows (security-r6c L2)
  - `docs/design/samples/*.html` ยังใช้ `data-slot` (qa-r6c L2 — ไฟล์ตัวอย่างดีไซน์ ไม่ได้ส่งขึ้นโปรดักชัน)

## ข้อสังเกต
- ยังไม่ยืนยัน: CI ของ PR (ยังไม่มีผล) · migration 0002 บน Turso จริง (ยังไม่ได้รัน; ตรวจแล้วกับ libSQL ไฟล์ในเครื่องเท่านั้น)
- เครื่อง Windows ของ boss: เทสต์ฐานข้อมูลบางไฟล์ล้มด้วย EPERM ตอนลบโฟลเดอร์ชั่วคราว และ `config-hygiene` ข้อ permissions ล้มบน CRLF — เป็นปัญหาเดิม (ดูผลจริงจาก CI)
- ช่องวันในปฏิทินจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)
