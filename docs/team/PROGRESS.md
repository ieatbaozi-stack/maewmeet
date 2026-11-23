# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](../../CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](../NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-22 (เวลาไทย) · **v1.0.0 ยังเป็นรุ่นล่าสุดที่ออกแล้ว** (ออก 2026-11-20 · tag `v0.15.0` → `17918b8`) · **R18 อยู่ระหว่างทำ** (เป้า 1.0 · ยังไม่ออกรุ่น · branch `feat/r18-v1`)

> **วิธีอ่านไฟล์นี้:** สถานะจริงอยู่ที่หัวข้อ **สถานะปัจจุบัน** และ **เหลือ** (ตรวจกับ git log, โค้ด, CHANGELOG, `docs/reports/` เมื่อ 2026-11-22) · ประวัติรอบเดิมทั้งหมดอยู่ใน [PROGRESS_ARCHIVE.md](PROGRESS_ARCHIVE.md) (คำต่อคำ)

## สถานะปัจจุบัน — 2026-11-22 (R18 ระหว่างทำ · เป้าปิดโปรเจกต์ที่ 1.0)
- **contract:** [docs/contracts/R18_CONTRACT.md](../contracts/R18_CONTRACT.md) (boss เห็นชอบ 2026-11-20 · ตัดสิน §11 2026-11-22) · branch `feat/r18-v1` จาก `main` `d6f413a` · ยังไม่มี PR
- **ทำแล้วในโค้ด/เอกสาร** (ตรวจจาก `git log main..feat/r18-v1` และไฟล์ที่อ้าง · ยังไม่ผ่าน qa รอบ R18):
  - **§S แชร์นัดให้คนนอกกลุ่ม:** ADR 0016 Accepted (`02f4fa8`) · S1–S8 (`13ee066` rbac, `3c5ea5b` migration 0007, `eccfb96` platform, `88721bf` frontend, `26043f8` e2e, `091a2d4` ceiling perf) · S9 ux (`e9ca44e`, `338cc5b`, `32c422a`)
  - **§1 ข้อมูล:** D1 purge คำเชิญเก่า 30 วัน (`d5c4562`) · D2 บันทึก/ถ้อยคำ (`86ab22b`, `32c422a`, `88721bf`) · D3 ตัดสินไม่แก้ บันทึกแล้ว (`86ab22b`)
  - **§2 hardening:** H1 (`193ba97`) · H2+H3 (`82db023`) · H4 ข้อความ 429 ปฏิทิน (`88721bf`) · H5 e2e `retries: 0` + H6 i18n render test (`16a67d7`) · H7 picomatch ตรวจซ้ำ 2026-11-20 ยังไม่มีรุ่นแก้ คงยอมรับความเสี่ยง (`86ab22b`)
  - **§3 ยืนยันการลบ:** C1 ยืนยันลบวันนี้ / ยกเลิกคำเชิญตรง (`88721bf` + e2e `26043f8`) · C2 ตรวจแล้ว 16 แถว (`docs/design/R17_DELETE_CONFIRM.md` §8.2)
  - **§4 ข้อเสนอ PRD:** ตัดสินแล้ว ไม่ทำ (`8c195d7`)
  - **§5 ตรวจรับ:** V1 `docs/reports/v1-readiness.md` (`8c6badc`) · V3 `docs/reports/security-v1.md` ผลแบบมีข้อสังเกต (`eac8f95`) · Low 1 แก้ (`bb7a282`) · Info 1 แก้ (`9818d50`) · V5 audit `docs/design/V1_UI_AUDIT.md` (`6a7f437`)
  - **§10 ลด token:** T1 กติกาเทสต์ใน agent (`b155b09`) · T2 ย้าย [ประวัติ] ไป PROGRESS_ARCHIVE (`9a3ce92`) · ข้อเสนอ (`43fe045`)
  - **§11:** G3 e2e EN (`e50d5fc`) · G1 spec แบนเนอร์ iOS (`6a7f437` · ดู "เหลือ" ข้อ 1.1) · G4 ไม่ทำใน 1.0 และ G5 ติ๊ก PRD (`8c195d7`)
  - **§6 เอกสาร (เลขา รอบนี้):** README (สถานะ, ชวนคนนอก, ยืนยันการลบ, แจ้งเตือนแขก) · quickstart (หัวข้อ "ชวนคนนอกกลุ่มมาร่วมนัด", ยืนยันลบแบบประจำ) · NEXT_PHASE · รายการนี้ · V4 checklist (`docs/reports/r18-boss-device-checklist.md`) — ยังไม่ commit ณ เวลาเขียนรายการนี้
- **เลขรุ่น:** ไม่เปลี่ยน (ยัง v0.15.0 ใน `package.json`) — release.ts จะเปลี่ยนเมื่อ boss ออกรุ่น

## เหลือ (รายการเดียวที่ใช้ต่อ · ตรวจ 2026-11-22)

### 1. ต้องทำก่อนออก 1.0 (เปิดอยู่)
1. **G1 แบนเนอร์สอนติดตั้ง iOS** — spec เสร็จ (`docs/design/V1_UI_AUDIT.md` §6) · โค้ดกำลังทำอยู่ใน worktree แต่**ยังไม่ commit** (ตรวจ 2026-11-22: `src/components/home/InstallHint.tsx`, `install-hint.ts`, `tests/ui/install-hint.test.ts` ค้างเป็น untracked และ `HomeView.tsx` แก้แล้ว) · ยังไม่ผ่านเทสต์/qa · ผู้ทำยังไม่ยืนยันในรายงาน
2. **V5 แก้ตาม audit** — `V1_UI_AUDIT.md` §3 มี 20 ข้อ (P2 14 · P3 6) · ยังไม่มี commit แก้ฝั่ง frontend · ถ้อยคำ/copy ที่ ux แก้แล้ว (`6a7f437`) · qa ตรวจว่าไม่ถอยหลัง
3. **G2 Lighthouse** (มือถือ Performance ≥ 85 · Accessibility ≥ 95) — ยังไม่มีผลวัด · qa วัดบน Vercel preview แล้วบันทึกใน `docs/reports/qa-r18.md` · ต่ำกว่าเกณฑ์ = แก้ก่อน merge
4. **V2 qa ถดถอยเต็ม** — ยังไม่เริ่ม (ยังไม่มี `qa-r18.md`) · รวม flow ชวนคนนอก และ C1 · รวม e2e ที่ G3 เพิ่ม
5. **security re-check รอบ R18** — ยังไม่มีรายงาน · ต้องดู: (ก) bb7a282 / 9818d50 (ข) security-v1 **Info 2** แขกที่ถูกนำออกเข้าเป็นสมาชิกแล้วออก อาจกลับมาเป็นแขกนัดเดิมได้ — **ขัดกับคำตัดสิน main ใน ADR 0016 หัวข้อสถานะ** (แขกที่ถูกนำออกกลับเข้านัดนั้นไม่ได้) · main/security ต้องตัดสินว่าแก้โค้ดหรือบันทึกยอมรับ (ค) security-v1 **Info 3** Cache-Control ของ `/i/*` บน build จริง ยังไม่ยืนยัน (ง) **Info 4** docs-sync แถว route §S — ตรวจซ้ำหลัง PR เอกสารนี้
6. **งาน ops (นอกเลขา):** เขียนแล้วใน `d45abce` — `CHANGELOG.md` `[Unreleased]` · `docs/OPERATIONS.md` หัวข้อ "ดูแลหลังปิดโปรเจกต์ (v1.0 · R18 §6)" · `docs/VERSIONING.md` · ยังไม่ผ่าน qa/ตรวจอิสระ · `scripts/release.ts 1.0.0 --dry-run` ยังไม่รัน
7. **งาน main:** PRD สถานะ 1.0 + ติ๊กทุกข้อ · บรรทัดปิดรอบ R18 ใน contract · ADR 0016 ตาม architect
8. **migration 0007** (`appointment_share_link` + `appointment_guest`) — boss รันบน **preview** ก่อนเปิด PR และบน **prod** ก่อน merge · ขั้น rollback อยู่ใน `docs/OPERATIONS.md` (ส่วน S8) · ยังไม่รันที่ไหนเลย
9. **PR → merge → release** — CI 2 รอบติดด้วย `retries: 0` (H5) ยังไม่มี · boss merge · boss รัน `npx tsx scripts/release.ts 1.0.0` และ push tag · หลังออกรุ่นต้องทำ DOCS_SYNC §3 ตาม

### 2. เครื่องจริงของ boss (ไม่บล็อก merge · ต้องจดผล)
- checklist: [docs/reports/r18-boss-device-checklist.md](../reports/r18-boss-device-checklist.md) — ลิงก์ในชื่อนัดบน LINE · ป้าย "ผู้ดูแลระบบ" ในกระดิ่ง · เปิดเต็มจอบน iOS · ปุ่ม Apple Maps ที่ 768 · ใหม่: เปิดลิงก์ชวนใน LINE, เพิ่มเป็นแขก, แบนเนอร์ iOS (ยังไม่มีในแอป) · iPad 1 เครื่อง (PRD §8 ข้อ 5)

### 3. เครื่องของ boss (ระดับเครื่อง ไม่ใช่ repo)
- ติดตั้ง Node 24 (เครื่องเป็น v26 ทำให้เทสต์ health ล้ม)
- เทสต์ที่ล้มเฉพาะเครื่อง Windows: `release.test` (`.bin/tsx` ENOENT) · `config-hygiene` ข้อ permissions (CRLF) · เทสต์ที่ต้องใช้ Python · `npm test` ทั้งชุดมี EPERM/timeout ในเครื่องนี้ · ผลจริงดูจาก CI

### 4. ตัดสินแล้ว — ไม่ทำ (ไม่ใช่งานค้าง)
- นำเข้า ICS (PRD v1.x) — ไม่ทำใน 1.0 (G4 · boss) · งานหลัง 1.0
- ข้อเสนอ PRD ที่ไม่มีคนขอ: deny list ผู้ถูกลบ · ผู้รับปิดรับคำเชิญตรง · ชื่อกลุ่มคล้ายกัน — ไม่ทำใน 1.0 (R18 §4 · B3)
- guard ตอบ 200 ก่อน redirect (R16 H5) · Server-Timing บนหน้า RSC (R16 H6) · DST day strip
- CSP แบบ nonce — ยอมรับความเสี่ยง (ADR 0014)
- security-r16 Info 2–4 · security-r17 Info 3–4 — ไม่แก้ บันทึกเหตุผลใน ADR 0015 / OPERATIONS (R18 D3)
- security-r17 Info 1–2 — ไม่แก้โค้ด จดใน OPERATIONS §K (R18 D2)
- security-v1 Info 5 (access log ของ Vercel มี path `/i/<token>`) — ยอมรับตาม ADR 0016 §3 (จดใน OPERATIONS)
- picomatch GHSA-fc5q-39xc-vjpf — ยังไม่มีรุ่นแก้ (ตรวจซ้ำ 2026-11-20) คงยอมรับความเสี่ยงใน OPERATIONS · ตรวจใหม่เมื่อมีรุ่นแก้
- แถวแจ้งเตือนเก่าที่แสดงชื่อ SA — ไม่มี backfill (ไม่มี migration)
