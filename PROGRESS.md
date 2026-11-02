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
- **R6D เสร็จ (รอ boss merge)** — branch `feat/r6d-remember-group-going-busy` (HEAD `ce46f98`)
  - G1: จำกลุ่มที่เลือกไว้ต่อเครื่อง (คุกกี้ `mm_group` + `PUT /api/me/current-group`) · เปิดแถบ "ปฏิทิน" แล้วยังเป็นกลุ่มเดิม
  - G2: ตอบ "ไป" = ไม่ว่างทุกกลุ่ม · กลุ่มอื่นเห็นแค่ "ติดนัดกลุ่มอื่น" (ไม่เห็นชื่อนัด/กลุ่ม) · popup ยืนยันเมื่อตอบ "ไป" / เปลี่ยนจาก "ไป" · เตือนนัดชน (ไม่บล็อก)
  - ไม่มี migration · ADR `docs/adr/0009-going-counts-as-busy.md`
  - ผลตรวจอิสระ: **qa ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r6d.md`, 0H/0M/4L) · **security ผ่านแบบมีข้อสังเกต** (`docs/reports/security-r6d.md`, 0C/0H/0M/2L/5I) — L1/L2 แก้แล้ว (`814136b`, `1541016`)
  - ยังไม่ยืนยัน: security ยังไม่ได้ตรวจซ้ำหลังแก้ L1/L2 (รายงานของ security ผูกกับ `e1ef6aa`)

## รอ boss
- [ ] merge PR `feat/r6d-remember-group-going-busy` เข้า `main` แบบ **Create a merge commit** (boss กดเอง)
- [ ] ออก **v0.8.0** หลัง merge: `npx tsx scripts/release.ts 0.8.0` + push tag — รวม R6C + R6D (ทั้งคู่อยู่ใต้ `[Unreleased]` ใน CHANGELOG ตอนนี้ · เลขเป็นข้อเสนอของ main ยังไม่ได้รับการตัดสิน)
  - หมายเหตุ: `R6D_CONTRACT.md` เขียนข้อเสนอ **v0.9.0** ไว้ตอนยังไม่มี R6C รวม · ถ้าออกรวมกันเป็น v0.8.0 ตามข้อเสนอของ main ให้ถือว่าข้อเสนอใน contract ล้าสมัย (ต้องการให้ Lead ยืนยัน)

## เหลือ
- F1 onboarding · F2 ความช้า (วัดก่อน-หลัง) · F5 ข้อความหน้า /privacy · F6 แจ้งเตือนก่อนนัด (**boss ยังไม่ตัดสินช่องทาง**) — ตาม `docs/NEXT_PHASE.md`
- R6 hardening backlog (ดู `docs/NEXT_PHASE.md`)
- backlog จาก R6D (ไม่บล็อก merge):
  - qa-r6d L1: ข้อความ "และอีก 1+ รายการ" ควรไม่มีตัวเลข (`appointments.goingConfirm.conflictMore`)
  - qa-r6d L2: ปุ่ม "ไปทั้งสองนัด" ตอนชนกับ busy ที่ลงเองแต่ไม่มีนัด (ข้อความไม่ตรงนิดหนึ่ง)
  - qa-r6d L3: มุมมองวัน 375px ชื่อนัดยาวถูกบีบเป็นคอลัมน์แคบ (เชิงเลย์เอาต์)
  - qa-r6d L4: ปุ่ม "Can't go" ตัด 2 บรรทัดที่ 768 EN
  - ADR 0009 §5 เขียน body `{ groupId }` แต่โค้ดใช้ `{ gid }` (`src/lib/data/services/current-group.ts`) — architect แก้เอกสาร
  - ADR เลขไม่ตรง: contract/commit `b3b2972` เรียก "0008" แต่ไฟล์จริงคือ `0009-going-counts-as-busy.md` (`0008` คือ i18n-and-theme)
  - `home-rsvp-hint` เป็น id ไม่ใช่ testid (`src/components/home/HomeView.tsx`) — ไม่กระทบ a11y
  - security-r6d Info 5: การ์ดรายการ `myConflict` มีเพดาน 500 ไม่มีธง truncated (ผลแค่ UI)
  - security-r6d L1: assertion ใน `appt-story.spec.ts` ผ่อนเกินไป — ข้อเสนอในรายงานยังไม่ได้ทำ (ใน `1541016` แก้เพียงบางส่วน ต้องตรวจซ้ำ)
- backlog ค้างจาก R6C (ไม่บล็อก merge):
  - `tests/security/authorize-first.test.ts:154` เทียบ path ด้วย `/` ล้มบน Windows (security-r6c L2)
  - `docs/design/samples/*.html` ยังใช้ `data-slot` (qa-r6c L2 — ไฟล์ตัวอย่างดีไซน์ ไม่ได้ส่งขึ้นโปรดักชัน)

## ข้อสังเกต
- ยังไม่ยืนยัน: CI ของ PR R6D (ยังไม่มีผล) · ใบรับรอง Handoff ของแต่ละบทบาทใน R6D ไม่มีไฟล์ในรีโปให้ตรวจ (มีเฉพาะรายงาน qa/security)
- ยังไม่ยืนยัน: ผลรัน `npm test` ทั้งชุดของรอบ R6D ในเครื่องเลขา (เลขาไม่ได้รันเอง) — ผลที่ทราบมาจากรายงาน qa/security เท่านั้น
- เครื่อง Windows ของ boss: เทสต์ฐานข้อมูลบางไฟล์ล้มด้วย EPERM ตอนลบโฟลเดอร์ชั่วคราว และ `config-hygiene` ข้อ permissions ล้มบน CRLF — เป็นปัญหาเดิม (ดูผลจริงจาก CI)
- ช่องวันในปฏิทินจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)
