# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](../../CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](../NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-24 (เวลาไทย) · **v1.1.1 เป็นรุ่นล่าสุดที่ออกแล้ว** (ออก 2026-11-24 · tag `v1.1.0` → `87f7db0`) · **โปรเจกต์ปิดรอบ R0–R18 · เข้าโหมดดูแล (maintenance mode)**

> **วิธีอ่านไฟล์นี้:** สถานะจริงอยู่ที่หัวข้อ **สถานะปัจจุบัน** และ **เหลือ** (ตรวจกับ git log, CHANGELOG, `docs/reports/` เมื่อ 2026-11-24) · ประวัติรอบเดิมทั้งหมดอยู่ใน [PROGRESS_ARCHIVE.md](PROGRESS_ARCHIVE.md) (คำต่อคำ)

## สถานะปัจจุบัน — 2026-11-24 (v1.1.0 ออกแล้ว · maintenance mode)
- **ออกรุ่น minor v1.1.0** (2026-11-24): PR #49 (`feat/ics-import`, นำเข้าไฟล์ .ics เป็นเวลาไม่ว่าง) merge `2d2b93b` · release commit `87f7db0` `chore(release): v1.1.0` · tag `v1.1.0` → `87f7db0` · ไม่มี migration · ICS_IMPORT_CONTRACT ปิดรอบแล้ว (`155ec05`)
- **ผลตรวจอิสระ ICS:** qa `docs/reports/qa-ics-import.md` รอบ 2 ผ่าน (`12f5120`) · security `docs/reports/security-ics-import.md` รอบ 1 ไม่ผ่าน (M1 แคช TZID ไม่มีเพดาน `e4a2a2c`) → platform แก้ `d0804a6` → security รอบ 2 ผ่าน (`984f5a4`) · ไม่มี 🔴/🟡 ค้าง
- **CI ของ PR #49** (`gh pr checks 49` ตรวจ 2026-11-24): ทุกรายการ pass รวม `test + migration`, `e2e (Playwright)` 1–4 และ Vercel Preview
- **เลขรุ่นในเอกสาร:** `package.json` = `1.1.0` · CHANGELOG `[1.1.0] - 2026-11-24` · quickstart ท้ายหน้า `app v1.1.0` · PRD หมายเหตุ v1.1.0 · บรรทัดนี้ตรงกับ `package.json`
- **production หลัง v1.1.0:** boss ยืนยันแล้ว 2026-11-24 — `/api/health` เป็น `1.1.0`, เช็กลิสต์มือถือจริง R18 ผ่านครบ 6 ข้อ ([r18-boss-device-checklist.md](../reports/r18-boss-device-checklist.md)), และทดสอบนำเข้าไฟล์ `.ics` จริงผ่าน ✔
- **DUALTOOL (Claude Code + Antigravity):** PR #44 merge `55469e5` · PR #46–#48 merge แล้ว · อยู่บน `main` แล้ว
- **รอบเก็บตกระดับ A (`fix/post-v1.1-polish`, 2026-11-24):** ปิดปุ่มเลือกเร็วใน `IcsImportSheet` ตอนซ้ำหมด/โควตาเป็น 0/ไม่ได้เลือก (+ unit/E2E test), แก้ตัวเลข bind param ใน ADR 0017 (`809 < 999`), และจดผลทดสอบเครื่องจริง + ซิงก์เอกสาร · **รอ QA อิสระคนละโมเดลตรวจก่อนเปิด PR**

## เหลือ (รายการเปิดจริงหลัง v1.1.0 · ตรวจ 2026-11-24)

### 1. ระดับเครื่อง boss (ไม่บล็อกรุ่น)
- **เครื่อง boss:** ติดตั้ง Node 24 (เครื่องเป็น v26 ทำให้เทสต์ health ล้ม) · ติดตั้ง Python สำหรับเทสต์ที่ต้องใช้ Python
- **เทสต์ที่ล้มเฉพาะเครื่อง Windows** (ปัญหาเครื่อง ไม่ใช่ repo): `release.test` (`.bin/tsx` ENOENT) · `config-hygiene` ข้อ permissions (CRLF) · `npm test` ทั้งชุดมี EPERM/timeout · ผลจริงดูจาก CI

### 2. เฝ้าดู (watch)
- **picomatch GHSA-fc5q-39xc-vjpf** — ยังไม่มีรุ่นแก้ (ตรวจซ้ำ 2026-11-20) คงยอมรับความเสี่ยงตาม OPERATIONS (dev/test/lint เท่านั้น) · ตรวจใหม่เมื่อมี Dependabot alert หรือรุ่นแก้

### 3. ตัดสินแล้ว — ไม่ทำ (ไม่ใช่งานค้าง)
- ข้อเสนอ PRD ที่ไม่มีคนขอ: deny list ผู้ถูกลบ · ผู้รับปิดรับคำเชิญตรง · ชื่อกลุ่มคล้ายกัน — ไม่ทำใน 1.0 (R18 §4 · B3)
- guard ตอบ 200 ก่อน redirect (R16 H5) · Server-Timing บนหน้า RSC (R16 H6) · DST day strip (ไม่จำเป็น ใช้ Asia/Bangkok อย่างเดียว)
- CSP แบบ nonce — ยอมรับความเสี่ยง (ADR 0014)
- security-r16 Info 2–4 · security-r17 Info 3–4 — ไม่แก้ บันทึกเหตุผลใน ADR 0015 / OPERATIONS
- security-r17 Info 1–2 — ไม่แก้โค้ด จดใน OPERATIONS §K
- security-v1 Info 5 (access log ของ Vercel มี path `/i/<token>`) — ยอมรับตาม ADR 0016 §3 (จดใน OPERATIONS)
- แถวแจ้งเตือนเก่าที่แสดงชื่อ SA — ไม่มี backfill (ไม่มี migration)
- ลิงก์ในชื่อนัด/ชื่อกลุ่มบน LINE กดไม่ได้ — เป็นการตั้งใจตาม R15b (ยืนยันผลบนมือถือจริงแล้ว 2026-11-24)
- ตรวจ header `/i/<token>` ด้วย token จริงผ่าน `curl` บน production — boss ตัดสินใจข้าม (2026-11-24) เนื่องจากตรวจ token ปลอมบน prod ผ่านแล้วและทดสอบ Flow แชร์นัดรับแขกบน UI จริงผ่านแล้ว
