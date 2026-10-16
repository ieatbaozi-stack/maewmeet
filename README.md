# แมวเจอกัน (maewmeet)

เว็บแอปนัดหมายกลุ่มเพื่อน: ทุกคนลงว่า **ไม่ว่างวันไหน** → ระบบหา **วันที่ทุกคนว่าง** → สร้างนัด (กินข้าว/เที่ยว/กิจกรรม) พร้อมสถานที่และเวลา
ใช้บนมือถือเกือบ 100% (iPad บ้าง) · UI คลีน พาสเทล professional ไม่ใช่ AI slop · ไทย/อังกฤษ · สว่าง/มืด

> เจ้าของงาน: **boss** · สร้างด้วยทีม AI agent แบบ software engineering full loop (ไม่ vibe code)

## agent ใหม่ ให้เริ่มที่นี่
1. อ่าน [CLAUDE.md](CLAUDE.md) (กติกาที่ต้องรู้ก่อนแตะอะไร)
2. อ่าน [TEAM.md](TEAM.md) หา **บทบาทของตัวเอง** และขอบเขตไฟล์
3. อ่าน [PROCESS.md](PROCESS.md) เฟส กติกา เกต และ **ใบรับรองงาน (Handoff Certificate)**
4. อ่าน [docs/prd/PRD.md](docs/prd/PRD.md) (ความต้องการที่อนุมัติแล้ว สิทธิ์ตามบทบาท โมเดลข้อมูลร่าง)
5. ถ้าทำงานหน้าจอ อ่าน [docs/design/UI_DIRECTION.md](docs/design/UI_DIRECTION.md) ให้จบก่อนเขียน UI
6. ข้อมูลประกอบการตัดสินใจ: [docs/research/RESEARCH_REPORT.md](docs/research/RESEARCH_REPORT.md) (รวมคำตอบเรื่อง LINE)
7. เลขา: [SECRETARY.md](SECRETARY.md)

## โครงโฟลเดอร์ (ปัจจุบันมีแค่เอกสาร)
```
maewmeet/
  README.md  CLAUDE.md  TEAM.md  PROCESS.md  SECRETARY.md
  docs/
    prd/PRD.md
    design/UI_DIRECTION.md
    research/RESEARCH_REPORT.md
    adr/  reports/  team/
  Pre-start/                         (ข้อมูลตั้งต้นของ boss · ไม่ push · ห้ามแก้)
```
โครง `src/`, `drizzle/`, `tests/`, `.github/` จะถูกสร้างในเฟส 3 (Foundation) ตาม ADR ของ Architect

## สถานะ
- เฟส 0 Discovery: เสร็จ
- เฟส 1 Requirements: เสร็จ — [docs/prd/PRD.md](docs/prd/PRD.md) อนุมัติแล้ว 2026-10-15
- เฟส 2 Design: **อนุมัติแล้ว** 2026-10-16 (aurora, สัปดาห์เริ่มจันทร์, กัน pepper หาย)
  — ADR 0001–0008, ARCHITECTURE, UX, tokens, หน้าตัวอย่าง `docs/design/samples/`, ภาพหน้าจอ `docs/design/screenshots/` · คำตอบ Lead: [docs/prd/LEAD_DECISIONS.md](docs/prd/LEAD_DECISIONS.md)
- R0 Foundation: [R0_CONTRACT.md](R0_CONTRACT.md) เห็นชอบแล้ว · **กำลังทำ** · repo: github.com/ieatbaozi-stack/maewmeet (private)
- รายงานล่าสุด: [docs/reports/2026-10-16.md](docs/reports/2026-10-16.md)
