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

## เหลือ
- **R6C**: F3ก ให้สมาชิกตั้งสี/รูปทรงของตัวเองต่อกลุ่ม ซ้ำกันได้ (มี migration) + QA L2–L4 ที่ค้างจาก R6B (ดู Errata ใน `R6B_CONTRACT.md`)
- F1 onboarding · F2 ความช้า (วัดก่อน-หลัง) · F5 ข้อความหน้า /privacy · F6 แจ้งเตือนก่อนนัด (**boss ยังไม่ตัดสินช่องทาง**) — ตาม `docs/NEXT_PHASE.md`
- R6 hardening backlog (ดู `docs/NEXT_PHASE.md`)

## ข้อสังเกต
- ช่องวันในปฏิทินจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)
