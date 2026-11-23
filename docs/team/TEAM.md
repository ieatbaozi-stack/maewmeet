# TEAM.md — ทีม AI ของ แมวเจอกัน (maewmeet)

> **ตัวจริงที่ agent ใช้:** `.claude/agents/*.md` (ชื่อ ขอบเขตไฟล์ model ยึดตามไฟล์นั้น · ถ้าไม่ตรงให้ยึด `.claude/agents/`)
> **แม่แบบต้นทาง (อ่านอย่างเดียว):** `TEAM_maewmeet.md` ของ boss — ดึงส่วน workflow/เช็กลิสต์/บทเรียนกลับมาแล้ว ตัด techlead ออก (D1 ใน [DUALTOOL_CONTRACT](../contracts/DUALTOOL_CONTRACT.md))
> กระบวนการ: [PROCESS.md](PROCESS.md) · เลขา: [SECRETARY.md](SECRETARY.md) · ความต้องการ: [docs/prd/PRD.md](../prd/PRD.md) · สถานะส่งต่อ: [HANDOFF.md](HANDOFF.md)

ทีมนี้เป็น **บทบาท (role)** ไม่ใช่คน · **main** (ผู้ประสานงาน / Orchestrator) คือ session หลักที่คุยกับ boss ไม่ใช่ไฟล์ agent · main เขียนโค้ดเองไม่ได้ (กฎ 10) แก้ได้เฉพาะ `docs/contracts/**` และ `docs/prd/**`

## 1. รายชื่อ agent (10 ตัว · ตรวจจาก `.claude/agents/` 2026-11-23)

| agent | model | ขอบเขตไฟล์ (แก้ได้) | ใช้เมื่อ |
|---|---|---|---|
| `architect` | opus | `docs/adr/**`, `docs/design/ARCHITECTURE.md`, `docs/research/**` | ออกแบบ data model, ADR, ค้นคว้า API/ข้อจำกัด |
| `ux` | sonnet | `docs/design/**` (ยกเว้น ARCHITECTURE.md), `src/styles/tokens*`, `src/components/brand/**`, `public/brand/**`, เนื้อหา `messages/*.json` | flow, wireframe, tokens สว่าง/มืด, ข้อความ TH/EN |
| `platform` | opus | `src/db/**`, `drizzle/**`, `drizzle.config.ts`, `src/instrumentation.ts`, `src/lib/data/**`, `src/lib/shared/**`, `src/app/api/**` (ยกเว้น auth, health), `src/lib/calendar/**`, `tests/calendar/**`, `src/lib/integrations/**`, `src/app/api/line/**` | schema/migration, API, งานวัน-เวลา, LINE (จนกว่า boss ตัดสินช่องทาง F6 ตามไฟล์ platform) |
| `frontend` | sonnet | `src/app/**` (ไม่รวม api), `src/components/**` (ไม่รวม brand), `src/i18n/**`, `src/styles/**` (ไม่รวม tokens), เพิ่มคีย์ `messages/*.json` | หน้าเว็บ, ฟอร์ม, responsive, สลับภาษา/ธีม |
| `auth` | opus | `src/lib/auth/**`, `src/lib/rbac/**`, `src/app/api/auth/**` | PIN/hash, lockout, session, reset flow, RBAC กลาง |
| `ops` | sonnet | `.github/**`, `next.config.ts`, `vercel.json`, `scripts/pepper-fingerprint.ts`, `scripts/admin-reset-pin.ts`, `.env.example`, `.nvmrc`, `src/app/api/health/**`, `docs/OPERATIONS.md`, `CHANGELOG.md` (ส่วน Unreleased), `docs/VERSIONING.md`, `scripts/release*.ts` | CI, health, env/secret, release (ไม่ออกรุ่น/ไม่สร้าง tag เอง) |
| `test` | sonnet | `tests/**` (ยกเว้น `tests/calendar/**`), `vitest.config.ts`, `playwright.config.ts` | เทสต์ Vitest/Playwright, เมทริกซ์ role×action |
| `qa` | sonnet | แก้ได้ทุกไฟล์ที่พบบั๊ก/a11y เล็ก (commit `qa: …`) · การแก้ใหญ่รายงาน main แทน · เขียนรายงาน `docs/reports/qa-*.md` | **ผู้ตรวจอิสระ** ทุกรอบที่มีโค้ด (ห้ามตรวจงานที่ตัวเองทำ) |
| `security` | opus | เขียนได้เฉพาะ `docs/reports/security-*.md` · ไม่แก้โค้ด/เทสต์/config | **ผู้ตรวจอิสระ** เมื่อแตะ auth/rbac/api/schema/ข้อมูลคน |
| `secretary` | haiku | `docs/team/PROGRESS.md`, `docs/team/**`, `docs/reports/**` (ยกเว้น `qa-*`, `security-*`) · ไม่เขียนโค้ด | บันทึกความคืบหน้า, รายงานประจำวัน, จดบั๊กนอกขอบเขต |

**หลักเลือก model:** งานที่พลาดแล้วแพง (ออกแบบ, สิทธิ์/ความปลอดภัย, ข้อมูล/เวลา) → opus · ลงมือทั่วไป (UI, CI, เทสต์, QA, เอกสารเทคนิค) → sonnet · บันทึก/เอกสารที่ไม่ต้องคิดลึก → haiku
**ไม่ต้องเรียกครบทุกตัวทุกรอบ** — เลือกเฉพาะที่จำเป็นกับงาน · งานเล็กมาก ส่ง dev ตัวเดียวที่เหมาะที่สุด + qa ตรวจ ไม่ข้ามขั้นตรวจ

**Code review:** ไม่มี agent `techlead` (D1) — เช็กลิสต์ Code Review 9 ข้อ อยู่ในหัวข้อ Code review ของ `qa.md` (ตาม DUALTOOL T4)

## 2. ใครส่งต่อใคร (แผนผัง workflow)

```
boss ──โจทย์──▶ main (ผู้ประสานงาน)
   │ 1) ถ้าต้องออกแบบ/ค้นคว้าก่อน
   ├──▶ architect (ADR/data model/ค้นคว้า)   ┐
   │    ux (flow/tokens/ข้อความ)              ┘ ส่งกลับ main
   │ 2) main เขียน contract ──▶ boss เห็นชอบ (ยังไม่เห็นชอบ = ห้ามเริ่มโค้ด)
   │ 3) มอบงานตาม contract (ขนานได้ถ้าไฟล์ไม่ชนกัน)
   ├──▶ platform / frontend / auth / ops / test   (ทำบน branch · เทสต์มาพร้อมโค้ด · ตรวจตัวเอง · Handoff)
   │ 4) ตรวจอิสระ (คนละ agent กับผู้ทำ)
   ├──▶ qa        (ทุกรอบที่มีโค้ด · รวม Code review)
   ├──▶ security  (เมื่อแตะ auth/rbac/api/schema/ข้อมูลคน)
   │      ไม่ผ่าน → main มอบผู้ทำเดิมแก้บน branch เดิม → Handoff ใหม่ → กลับข้อ 4
   │ 5) บันทึก ──▶ secretary (PROGRESS + รายงานวัน + HANDOFF)
   │ 6) main รวมผล → เปิด PR (ตามเช็กลิสต์ใน PROCESS) → หยุด
   ▼
 boss ตรวจ → กด Merge → boss รัน release และ push tag เอง
```

งานเอกสารล้วน (ไม่แตะโค้ด/เทสต์/config): ข้ามขั้น security ได้ · qa ตรวจว่าเอกสารตรงของจริง (รายละเอียดใน PROCESS)

## 3. เจ้าของเอกสารและไฟล์ (กันชนกัน)

| ผลงาน | เจ้าของ |
|---|---|
| `docs/contracts/**`, `docs/prd/**` | main |
| `docs/adr/**`, `docs/design/ARCHITECTURE.md`, `docs/research/**` | architect |
| `docs/design/**` (อื่น), `src/styles/tokens*`, `src/components/brand/**`, `public/brand/**`, เนื้อหา `messages/*.json` | ux |
| `docs/reports/qa-*.md` | qa |
| `docs/reports/security-*.md` | security |
| `docs/team/**`, `docs/reports/YYYY-MM-DD.md`, `README.md`, `docs/NEXT_PHASE.md`, `docs/guides/quickstart-th.html` | secretary |
| `CHANGELOG.md` (Unreleased), `docs/OPERATIONS.md`, `docs/VERSIONING.md`, `.github/**`, `scripts/release*.ts` | ops |
| `AGENTS.md`, `.agent/rules/maewmeet.md` (ตาม DUALTOOL T1–T2) | ops |
| โค้ดและเทสต์ | ตามขอบเขตของแต่ละ agent (ตาราง §1) |

หมายเหตุ: ไฟล์ที่ไม่มีเจ้าของในตารางนี้ (เช่น `package.json`, config lint) main ระบุผู้แก้ใน contract ของรอบนั้น

## 4. ประวัติ (บทบาทเดิม 16 รวมเข้า agent ไหน)

ทีมเดิมมี 16 บทบาท (ปรับจากทีม Fat Cat Fit) รวมเข้าเหลือ 10 agent ตาม `.claude/agents/` จริง:

| # | บทบาทเดิม | อยู่ที่ agent |
|---|---|---|
| 1 | หัวหน้าทีม / Lead | main (ไม่ใช่ไฟล์ agent) |
| 2 | นักค้นคว้า | architect |
| 3 | สถาปนิก | architect |
| 4 | UX & Brand | ux |
| 5 | หลังบ้าน / Platform | platform |
| 6 | หน้าบ้าน / Front-end | frontend |
| 7 | ปฏิทินและเวลา | platform (`src/lib/calendar`) |
| 8 | ยืนยันตัวตนและสิทธิ์ | auth |
| 9 | เชื่อมระบบ (LINE) | platform (`src/lib/integrations`, `api/line`) |
| 10 | ระบบดูแล / OPS | ops |
| 11 | ทดสอบอัตโนมัติ | test |
| 12 | ผู้ตรวจอิสระ / QA | qa |
| 13 | ผู้ตรวจความปลอดภัย | security |
| 14 | ฟูลสแตก | ไม่มี agent แยก (contract รอบแบ่งให้ platform + frontend) |
| 15 | วิศวกรออกรุ่น | ops |
| 16 | เลขาทีม | secretary |
| — | Tech Lead (เพื่อนเพิ่ม) | ไม่เพิ่ม (D1) · ย้ายเช็กลิสต์ไปที่ qa |
