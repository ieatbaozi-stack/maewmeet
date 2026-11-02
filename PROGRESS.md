# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](docs/NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-02

## เสร็จแล้ว
- R0–R5: foundation, บัญชี PIN, กลุ่ม, ปฏิทิน + busy, วันว่างร่วม + สร้างนัด, หน้า super admin + audit log (ดู CHANGELOG)
- ออก **v0.7.0** (2026-10-28) · ออก **v0.7.1** (2026-11-01) รวม R6A + R6B
- CI-1: artifact Playwright อัปโหลดเฉพาะตอนเทสต์ล้ม (PR #10) · R6A (PR #11) · R6B (PR #13)
- ทีม agent v2: 10 บทบาทใน `.claude/agents/` (PR นี้)
- **R6C merge แล้ว** (PR #15, merge commit `4990f3e`, 2026-11-01) — F3ก ตั้งสี/รูปทรงของตัวเองต่อกลุ่ม · migration `0002` (`color_slot`/`shape_slot`) · ผลตรวจ: qa ผ่าน (`docs/reports/qa-r6c.md`) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6c.md`)
- **migration `0002` รันแล้ว** (boss ยืนยัน 2026-11-02 ตามที่ main แจ้ง — เลขาไม่ได้ตรวจฐาน Turso เอง)
- **R6D merge แล้ว** (PR #16, merge commit `44dad19`, 2026-11-02) — G1 จำกลุ่มที่เลือกไว้ต่อเครื่อง · G2 ตอบ "ไป" = ไม่ว่างทุกกลุ่ม + popup ยืนยัน/เตือนนัดชน (ไม่บล็อก) · ไม่มี migration · ADR `docs/adr/0009-going-counts-as-busy.md`
  - ผลตรวจอิสระ: qa ผ่านแบบมีข้อสังเกต (`docs/reports/qa-r6d.md`, 0H/0M/4L) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6d.md`, 0C/0H/0M/2L/5I)
  - ยังไม่ยืนยัน: security ยังไม่ได้ตรวจซ้ำหลังแก้ L1/L2 (`814136b`, `1541016`) — รายงานของ security ผูกกับ `e1ef6aa` · จะตรวจซ้ำใน R6E
- **ออก v0.8.0 แล้ว** (2026-11-02, tag `v0.8.0`, commit `37271af` `chore(release): v0.8.0`) รวม R6C + R6D · ข้อเสนอ v0.9.0 ใน `R6D_CONTRACT.md` ไม่ได้ใช้ (รอบออกเป็น v0.8.0)
- **F5 ปิดแล้ว** (boss เลือกคงข้อความ `privacy.draft` ตามเดิม 2026-11-02) — ไม่แก้โค้ด (`R6E_CONTRACT.md` E10)

## กำลังทำ
- **R6E** (`R6E_CONTRACT.md`, branch `chore/r6e-cleanup`) — เก็บงานค้างหลัง v0.8.0 · ข้อเสนอเลข **v0.8.1** (PATCH, ไม่มี migration, ไม่แตะ API/schema/RBAC) · boss เห็นชอบ contract 2026-11-02
  - E1–E10: backlog ของ R6C/R6D (qa-r6d L1–L4, security-r6d L1, security-r6c L2, qa-r6c L2, `home-rsvp-hint` testid, ADR 0009 ไม่ตรงโค้ด) + F5 (ปิดแล้ว)
  - E11 (feedback boss 2026-11-02): ลง busy ทับ busy เดิม → popup ยืนยันก่อนบันทึก
  - E12 (feedback boss 2026-11-02): ลื่นขึ้นตอนโหลด — สัญญาณ progress/วงหมุนเมื่อรอนาน, วงหมุนในปุ่มที่รอเซิร์ฟเวอร์, ปิดด้วย reduced-motion
  - ณ การอัปเดตนี้ branch มีแค่ commit เอกสาร (`5ee2f45`, `d58c46d`, `ae99975`) ยังไม่มี commit โค้ดของ R6E · ยังไม่มี Handoff ของบทบาทใดใน R6E
- หลัง R6E ปิด: main เปิด PR เข้า `main` แล้วหยุด → boss ตรวจ merge + รัน release v0.8.1 + push tag เอง

## รอ boss
- ไม่มีรายการค้างตอนนี้ (ข้อตัดสินของ R6E ครบแล้ว: F5 คงไว้ · เลข v0.8.1)
- ขั้นถัดไปของ boss จะมาหลัง R6E ปิด (merge PR + release v0.8.1)

## เหลือ
- F1 onboarding · F2 ความช้าฝั่งเซิร์ฟเวอร์ (วัดก่อน-หลัง) · F6 แจ้งเตือนก่อนนัด (**boss ยังไม่ตัดสินช่องทาง**) — ตาม `docs/NEXT_PHASE.md`
- R6 hardening backlog (ดู `docs/NEXT_PHASE.md`)
- backlog ที่ R6E ไม่รับ (ไม่บล็อก):
  - security-r6d Info 5: การ์ดรายการ `myConflict` มีเพดาน 500 ไม่มีธง truncated (ผลแค่ UI)

## ข้อสังเกต
- ยังไม่ยืนยัน: CI ของ PR #16 (R6D) และผลรัน `npm test` ของรอบ R6D ในเครื่องเลขา — เลขาไม่ได้รันเอง ผลที่ทราบมาจากรายงาน qa/security เท่านั้น
- ยังไม่ยืนยัน: ใบรับรอง Handoff ของแต่ละบทบาทใน R6C/R6D ไม่มีไฟล์ในรีโปให้ตรวจ (มีเฉพาะรายงาน qa/security)
- ยังไม่ยืนยัน: security ยังไม่ได้ตรวจซ้ำ R6D L1/L2 หลัง `814136b`/`1541016` (จะตรวจใน R6E)
- เครื่อง Windows ของ boss: เทสต์ฐานข้อมูลบางไฟล์ล้มด้วย EPERM ตอนลบโฟลเดอร์ชั่วคราว, `config-hygiene` ข้อ permissions ล้มบน CRLF, และ `tests/release` CLI ล้มเพราะ `.bin/tsx` ENOENT — เป็นปัญหาเดิม (ดูผลจริงจาก CI)
- ช่องวันในปฏิทินจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)
