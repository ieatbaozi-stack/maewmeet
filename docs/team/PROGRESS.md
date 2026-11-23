# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](../../CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](../NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-23 (เวลาไทย) · **v1.0.0 เป็นรุ่นล่าสุดที่ออกแล้ว** (ออก 2026-11-23 · tag `v1.0.0` → `c906d09`) · **โปรเจกต์ปิดรอบ R0–R18 · เข้าโหมดดูแล (maintenance mode)**

> **วิธีอ่านไฟล์นี้:** สถานะจริงอยู่ที่หัวข้อ **สถานะปัจจุบัน** และ **เหลือ** (ตรวจกับ git log, CHANGELOG, `docs/reports/` เมื่อ 2026-11-23) · ประวัติรอบเดิมทั้งหมดอยู่ใน [PROGRESS_ARCHIVE.md](PROGRESS_ARCHIVE.md) (คำต่อคำ)

## สถานะปัจจุบัน — 2026-11-23 (v1.0.0 ออกแล้ว · maintenance mode)
- **R18 ปิดรอบ + ออกรุ่น v1.0.0** (2026-11-23): PR #42 merge `1b07381` · release commit `c906d09` `chore(release): v1.0.0` · tag `v1.0.0` → `c906d09` · บรรทัดปิดรอบใน contract `68a8a97` · รายละเอียดรอบ R18 [ประวัติ] อยู่ที่ PROGRESS_ARCHIVE
- **migration `0007`** (เพิ่มตาราง `appointment_share_link` + `appointment_guest` อย่างเดียว) รันแล้ว preview 2026-11-22 · prod 2026-11-23 ก่อน merge (ตามที่ main แจ้ง)
- **ผลตรวจอิสระ R18:** qa `docs/reports/qa-r18.md` ผ่านแบบมีข้อสังเกต · security `docs/reports/security-v1.md` ผ่าน (ตรวจซ้ำ `3c7d8c2`)
- **CI:** main รายงานว่า CI บน `1b07381` เขียว (รอบที่สองของ H5) — ข้อมูลจาก main ยังไม่ได้ตรวจด้วย `gh` โดยเลขา
- **เลขรุ่นในระบบ:** `package.json` = `1.0.0` · ตรงกับ CHANGELOG `[1.0.0] - 2026-11-23` · quickstart ท้ายหน้า `app v1.0.0` · PRD หมายเหตุ 1.0.0 (ตรวจด้วย `tests/ops/docs-sync.test.ts` 8/8 ผ่าน)
- **production `/api/health` version:** ยังไม่ยืนยัน (main จะยืนยันหลัง Vercel deploy เสร็จ)

## เหลือ (รายการเปิดจริงหลัง 1.0 · ตรวจ 2026-11-23)

### 1. ระดับเครื่อง boss / ของจริง (ไม่บล็อกรุ่น · ต้องจดผล)
- **เช็กลิสต์บนมือถือจริง:** [docs/reports/r18-boss-device-checklist.md](../reports/r18-boss-device-checklist.md) — ช่อง "ผล" ยังว่างทั้งหมด (ลิงก์ในชื่อนัดบน LINE · ป้าย "ผู้ดูแลระบบ" · เปิดเต็มจอบน iOS · ปุ่ม Apple Maps ที่ 768 · ชวนคนนอก/LINE in-app browser · แบนเนอร์ iOS (G1) · iPad 1 เครื่อง) · ผลส่งให้ main/secretary เพื่อจด
- **ยืนยันบน production (ยังไม่ยืนยันโดยเลขา):** header `Cache-Control` ของ `/i/<token>` บน production build (security-v1 Info 3 — ตรวจในเครื่องแล้ว แต่ Vercel preview ติด SSO) · ด้วย `curl -sI` หรือ ops/qa
- **เครื่อง boss:** ติดตั้ง Node 24 (เครื่องเป็น v26 ทำให้เทสต์ health ล้ม) · ติดตั้ง Python สำหรับเทสต์ที่ต้องใช้ Python
- **เทสต์ที่ล้มเฉพาะเครื่อง Windows** (ปัญหาเครื่อง ไม่ใช่ repo): `release.test` (`.bin/tsx` ENOENT) · `config-hygiene` ข้อ permissions (CRLF) · `npm test` ทั้งชุดมี EPERM/timeout · ผลจริงดูจาก CI

### 2. เฝ้าดู (watch)
- **picomatch GHSA-fc5q-39xc-vjpf** — ยังไม่มีรุ่นแก้ (ตรวจซ้ำ 2026-11-20) คงยอมรับความเสี่ยงตาม OPERATIONS (dev/test/lint เท่านั้น) · ตรวจใหม่เมื่อมี Dependabot alert หรือรุ่นแก้

### 3. งานหลัง 1.0 (ยังไม่เริ่ม · ต้องมี contract สั้นก่อนทำ)
- **นำเข้า ICS** (PRD v1.x · ตัดสินแล้ว ไม่ทำใน 1.0 — งานหลัง 1.0 ถ้ามีคนขอ)
- **F18 ข้อความหน้าแขก:** "ตอบ ไป = ช่วงนี้ไม่ว่างในทุกกลุ่ม" แสดงให้แขกที่ไม่ได้อยู่กลุ่ม — เสนอคีย์ `guest.goingHint` (ux · `docs/design/V1_UI_AUDIT.md` F18 · ไม่แก้ใน 1.0 เพื่อไม่ขยายขอบเขต)

### 4. ตัดสินแล้ว — ไม่ทำ (ไม่ใช่งานค้าง)
- ข้อเสนอ PRD ที่ไม่มีคนขอ: deny list ผู้ถูกลบ · ผู้รับปิดรับคำเชิญตรง · ชื่อกลุ่มคล้ายกัน — ไม่ทำใน 1.0 (R18 §4 · B3)
- guard ตอบ 200 ก่อน redirect (R16 H5) · Server-Timing บนหน้า RSC (R16 H6) · DST day strip (ไม่จำเป็น ใช้ Asia/Bangkok อย่างเดียว)
- CSP แบบ nonce — ยอมรับความเสี่ยง (ADR 0014)
- security-r16 Info 2–4 · security-r17 Info 3–4 — ไม่แก้ บันทึกเหตุผลใน ADR 0015 / OPERATIONS
- security-r17 Info 1–2 — ไม่แก้โค้ด จดใน OPERATIONS §K
- security-v1 Info 5 (access log ของ Vercel มี path `/i/<token>`) — ยอมรับตาม ADR 0016 §3 (จดใน OPERATIONS)
- แถวแจ้งเตือนเก่าที่แสดงชื่อ SA — ไม่มี backfill (ไม่มี migration)
- ลิงก์ในชื่อนัด/ชื่อกลุ่มบน LINE กดไม่ได้ — เป็นการตั้งใจตาม R15b (ยืนยันผลบนมือถือจริงใน checklist ข้อ 1)
