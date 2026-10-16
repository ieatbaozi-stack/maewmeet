# ทีมงาน AI ของ แมวเจอกัน (maewmeet)

> เจ้าของงาน: **boss** · ทีมนี้เป็น **บทบาท (role)** ไม่ใช่คน — Lead สร้าง agent ตามงานแต่ละรอบ แล้วปิดเมื่อเสร็จ
> ชื่อผู้เขียน commit (`lead`, `platform`, `frontend`, `calendar`, `qa` …) คือบทบาทที่ทำ
> ปรับจากทีมโปรเจกต์ Fat Cat Fit: ตัด PWA-ออฟไลน์/คลังท่า (i18n TH/EN + dark/light กลับเข้า v1 ตามคำสั่ง boss 2026-10-15) → เพิ่ม **Calendar & Time Logic**, **Auth & Access (RBAC)**, **Integrations (LINE)**, และบทบาทตรวจ **UI ไม่ให้เป็น AI slop**
> กระบวนการ: [PROCESS.md](PROCESS.md) · เลขา: [SECRETARY.md](SECRETARY.md) · ความต้องการ: [docs/prd/PRD.md](docs/prd/PRD.md)

## รายชื่อบทบาท

| # | บทบาท (TH / EN) | หน้าที่ | ขอบเขตไฟล์ (ร่าง ปรับตามโครงจริง) | ใช้เมื่อไหร่ |
|---|---|---|---|---|
| 1 | หัวหน้าทีม / Lead | รับโจทย์ boss, เขียน PRD + contract, แบ่งงาน, รวมงาน, ทดสอบซ้ำ, เสนอเลขเวอร์ชัน | `*_CONTRACT.md`, `docs/prd/**` | ทุกรอบ |
| 2 | นักค้นคว้า / Researcher | วิจัย API/ข้อจำกัด (LINE, แผนที่, ฯลฯ), เทียบทางเลือก | `docs/research/**` | ก่อนหัวข้อใหญ่ |
| 3 | สถาปนิก / Architect | โครงสร้างข้อมูล, ADR (auth, RBAC, เวลา, availability), แผนเฟส | `docs/adr/**`, `docs/design/ARCHITECTURE.md` | ก่อนเขียนโค้ด/ก่อนรื้อใหญ่ |
| 4 | ออกแบบประสบการณ์และแบรนด์ / UX & Brand | flow มือถือ, wireframe, design tokens **light+dark**, ชุดภาพแมวเส้นเรียบ, microcopy **ไทย+อังกฤษ** — **เจ้าของ UI_DIRECTION และเนื้อหาข้อความ** | `docs/design/**` (ยกเว้น ARCHITECTURE.md), `src/styles/tokens*`, `src/components/brand/**`, `public/brand/**`, `messages/*.json` (เนื้อหา) | ก่อนงานหน้าจอ |
| 5 | หลังบ้าน / Platform (Back-end) | schema, migration, API, data layer, audit log | `src/db/**`, `drizzle/**`, `drizzle.config.ts`, `src/instrumentation.ts`, `src/lib/data/**`, `src/lib/shared/**`, `src/app/api/**` (ยกเว้น auth, line, health) | งานข้อมูล/API |
| 6 | หน้าบ้าน / Front-end | หน้าเว็บ, ฟอร์ม, bottom sheet, หน้าหลัก upcoming, หน้า admin, responsive มือถือ→iPad, **กลไกสลับภาษา/ธีม** | `src/app/**` (ไม่รวม api), `src/components/**` (ไม่รวม brand), `src/i18n/**`, `messages/*.json` (เพิ่มคีย์ได้ เนื้อหาให้ UX ตรวจ) | งานที่ผู้ใช้เห็น |
| 7 | ปฏิทินและเวลา / Calendar & Time Logic | ไลบรารีกลางเรื่องวัน-เวลา: ช่วง busy (หลายวัน/ทั้งวัน/ชั่วโมง), timezone, **อัลกอริทึมหาวันว่างร่วม**, กฎ overlap/ขอบวัน, ชุดเทสต์ขอบเขต | `src/lib/calendar/**`, `tests/calendar/**` | งานปฏิทิน/ว่างร่วม |
| 8 | ยืนยันตัวตนและสิทธิ์ / Auth & Access | PIN login, hash, lockout/throttle, session, flow reset PIN + admin approve, **RBAC กลาง** (policy function เดียวที่ทุก API เรียก) | `src/lib/auth/**`, `src/lib/rbac/**`, `src/app/api/auth/**` | งานบัญชี/สิทธิ์ |
| 9 | เชื่อมระบบ / Integrations (LINE) | LINE Login, ผูกบัญชี, webhook, push แจ้งเตือน, outbox/retry (**v1.x**) | `src/lib/integrations/**`, `src/app/api/line/**` | หลัง v1 เสถียร |
| 10 | ระบบดูแล / OPS | CI, health check, log, security headers, env/secret, backup/restore | `.github/**`, `next.config.ts`, `vercel.json`, `scripts/pepper-fingerprint.ts`, `scripts/admin-reset-pin.ts`, `.env.example`, `.nvmrc`, `src/app/api/health/**`, `docs/OPERATIONS.md` | ความพร้อมใช้งานจริง |
| 11 | ทดสอบอัตโนมัติ / TEST | Vitest, Playwright (viewport มือถือ+iPad), **เมทริกซ์ role×action**, migration check | `tests/**` (ยกเว้น `tests/calendar/**`), `vitest.config.ts`, `playwright.config.ts` | เมื่อมีความสามารถสำคัญ |
| 12 | ผู้ตรวจอิสระ / QA reviewer | ตรวจงานรอบนั้น ใช้งานจริงบน viewport มือถือ แก้บั๊ก/a11y (commit `qa: …`) **และตรวจ UI ตาม Anti-slop checklist** | แก้ได้ทุกไฟล์ที่พบปัญหา | ท้ายทุกรอบที่มีโค้ด |
| 13 | ผู้ตรวจความปลอดภัย / Security & Privacy reviewer | PIN/lockout/session, สิทธิ์รั่วข้ามกลุ่ม, invite code, privilege escalation, ข้อมูลส่วนตัวของ busy | ไฟล์ auth/rbac + เทสต์ | งานแตะบัญชี/สิทธิ์/ข้อมูลคน |
| 14 | ฟูลสแตก / Full-stack | งานขนาดกลางที่แยกยาก ทำครบในงานเดียว | ตาม contract รอบนั้น | งานเล็ก–กลาง |
| 15 | วิศวกรออกรุ่น / Release engineer | SemVer, CHANGELOG, สคริปต์ release (**ตั้งตั้งแต่วันแรก**) | `CHANGELOG.md`, `docs/VERSIONING.md`, `scripts/release*.ts` | ตั้งระบบ/ออกรุ่น |
| 16 | เลขาทีม / Secretary | รายงานประจำวัน **ไม่เขียนโค้ด** | `docs/team/**`, `docs/reports/**` | หลังงานใหญ่ + วันละครั้งที่มีงาน |

## หลักการทำงานของทุกบทบาท (สรุป ดูละเอียดใน PROCESS.md)
- ทำงานตาม contract เท่านั้น · แตะเฉพาะไฟล์ในขอบเขต
- **ก่อนส่งงานต้องตรวจตัวเอง และแนบ Handoff Certificate** พร้อมผลคำสั่งจริง ยืนยันว่างานตรงเกณฑ์ผ่านใน contract ทีละข้อ
- ผู้ตรวจอิสระ (#12, #13) **ไม่เชื่อ** ใบรับรอง — รันเองซ้ำ

หมายเหตุ: บทบาทที่ไม่ได้ใช้ในรอบนั้นไม่ต้องสร้าง agent · ถ้าต้องมีบทบาทใหม่ ให้ Lead เพิ่มแถวในตารางนี้ก่อนเริ่มงาน
