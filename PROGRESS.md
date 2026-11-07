# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](docs/NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-08 (เวลาไทย) · ตรวจด้วย `git log`, `git tag`, `git ls-remote --tags origin v0.9.1`, `CHANGELOG.md`, `docs/reports/perf-r7-*.md`, `qa-r7.md`, `security-r7.md`

## เสร็จแล้ว
- R0–R5: foundation, บัญชี PIN, กลุ่ม, ปฏิทิน + busy, วันว่างร่วม + สร้างนัด, หน้า super admin + audit log (ดู CHANGELOG)
- ออก **v0.7.0** (2026-10-28) · ออก **v0.7.1** (2026-11-01) รวม R6A + R6B
- CI-1: artifact Playwright อัปโหลดเฉพาะตอนเทสต์ล้ม (PR #10) · R6A (PR #11) · R6B (PR #13)
- ทีม agent v2: 10 บทบาทใน `.claude/agents/` (PR #14)
- **R6C merge แล้ว** (PR #15, merge commit `4990f3e`, 2026-11-01) — F3ก ตั้งสี/รูปทรงของตัวเองต่อกลุ่ม · migration `0002` (`color_slot`/`shape_slot`) · qa ผ่าน (`docs/reports/qa-r6c.md`) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6c.md`)
- **migration `0002` รันแล้ว** (boss ยืนยัน 2026-11-02 ตามที่ main แจ้ง — เลขาไม่ได้ตรวจฐาน Turso เอง)
- **R6D merge แล้ว** (PR #16, merge commit `44dad19`, 2026-11-02) — G1 จำกลุ่มที่เลือกไว้ต่อเครื่อง · G2 ตอบ "ไป" = ไม่ว่างทุกกลุ่ม + popup ยืนยัน/เตือนนัดชน (ไม่บล็อก) · ไม่มี migration · ADR `docs/adr/0009-going-counts-as-busy.md`
  - ผลตรวจอิสระ: qa ผ่านแบบมีข้อสังเกต (`docs/reports/qa-r6d.md`, 0H/0M/4L) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6d.md`, 0C/0H/0M/2L/5I)
- **ออก v0.8.0 แล้ว** (2026-11-02, tag `v0.8.0`, commit `37271af` `chore(release): v0.8.0`) รวม R6C + R6D
- **R6E merge แล้ว** (PR #17, merge commit `b1daec1`, 2026-11-02 23:52 เวลาไทย) — E1–E12 ตาม `R6E_CONTRACT.md`
  - ผลตรวจอิสระ: qa **ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r6e.md`, 0H/0M/4L) · security **ผ่าน** (`docs/reports/security-r6e.md`, 0C/0H/0M/0L, Info 4)
  - **R6D L1/L2 ปิดแล้ว** · **F5 ปิดแล้ว** (boss เลือกคงข้อความ `privacy.draft` 2026-11-02 — ไม่แก้โค้ด)
- **ออก v0.8.1 แล้ว** (tag `v0.8.1` → commit `72d7881` `chore(release): v0.8.1`, 2026-11-03 03:10 เวลาไทย) รวม R6E · รอบนี้ไม่มี migration

## R6F — merge + ออก v0.9.0 แล้ว (2026-11-03) ✅
- **PR #18** (branch `feat/r6f-daily-busy`) merge เข้า `main` ด้วย merge commit `3aaab63` · `gh pr view 18`: state MERGED, mergedAt 2026-11-02T22:06:07Z (= 05:06 เวลาไทย 2026-11-03)
- busy หลายวันเฉพาะช่วงเวลา (ทั้งวัน/เฉพาะช่วงเวลา) + ลบวันนี้/ลบทั้งชุด · `R6F_CONTRACT.md` · ADR `docs/adr/0010-daily-busy-series.md` (commit `a7f66c0` `docs(adr): 0010 accepted`)
- ผลตรวจอิสระ: qa **ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r6f.md`, 0H/0M/3L) · security **ผ่าน** (`docs/reports/security-r6f.md`, 0C/0H/0M/0L, Info 5)
- migration `0003` (`busy_block.series_id` + partial index): **boss รันแล้วทั้ง preview และ prod** (boss ยืนยัน 2026-11-03) — เลขาไม่ได้ตรวจฐาน Turso เอง
- **ออก v0.9.0 แล้ว** (2026-11-03, tag `v0.9.0` → commit `ea1bf5f` `chore(release): v0.9.0`; `git rev-parse v0.9.0^{commit}` ยืนยันแล้ว) รวม R6F · หัวข้อ `[0.9.0] - 2026-11-03` ใน CHANGELOG · `[Unreleased]` ว่างหลังออก
- ผู้ทำ R6F ตาม commit author: architect (`258334a`, `a7f66c0`) · main (`3123a0f`, `87264dd`, `313e016`, `7aabdf4`) · platform (`8bed164`, `d125181`, `a93ba6f`) · ux (`7d97edd`) · test (`3a9bd73`) · frontend (`f903665`, `8391d79`) · ops (`438beab`, `ca104a0`) · qa (`2a33843`) · security (`286bee8`)
- **ยังไม่ยืนยัน:** CI และ Vercel ของ `main` หลัง merge (เลขาไม่ได้ตรวจ) · ผล `npm test` ในเครื่องเลขาไม่มี (เลขาไม่ได้รัน)

## R7 — merge + ออก v0.9.1 แล้ว (2026-11-08) ✅
- **PR #19** (branch `perf/r7-speed`, HEAD `603f21c`) merge เข้า `main` ด้วย merge commit `c896b92` (`Merge pull request #19`, 2026-11-08 06:02 เวลาไทย)
- **ออก v0.9.1 แล้ว** (2026-11-08, tag `v0.9.1` → commit `628175d` `chore(release): v0.9.1`; `git rev-parse v0.9.1^{commit}` = `628175d` · `git ls-remote --tags origin v0.9.1` เห็น tag บน GitHub แล้ว · หัวข้อ `[0.9.1] - 2026-11-08` ใน CHANGELOG) รวม R7 · `[Unreleased]` ว่างหลังออก
- **ไม่มี migration** รอบนี้ → ไม่ต้องรันฐาน Turso
- contract: `R7_CONTRACT.md` (`f44551a`, main) · branch แตกจาก `ea1bf5f` (v0.9.0)
- เนื้อหา: **G1** กลุ่มใหม่ "ว่างอย่างน้อย" 240 นาที (`73bd68d`, `14a7f2c`) · **F2 ความเร็ว** วัดก่อน (`b721a22` baseline) → เฟส B ตาม §3.1 (`2c4167e` `896720c` `6c3ef87` `5361858` `6c64caa` `45660c2` `a18cd83`) → วัดหลัง (`cb15b59`) · Server-Timing + env `SERVER_TIMING_ENABLED` (`ecc91dd`, `7c5b2f9`) · CHANGELOG `[Unreleased]` (`ef3026a`)
- **ตัวเลขหลัก** (จาก `perf-r7-after.md` · จำนวน query, ในเครื่อง libSQL ไฟล์):
  - home `/` 13 → 9 (−31%) · waves 7 → 3 · **ผ่าน**
  - ปฏิทินเดือน `/calendar?v=month` 15 → 8 (−47%) · **ผ่าน**
  - ว่างตรงกัน `?v=free` 15 → 8 (−47%) · **ผ่าน**
  - แท็บของฉัน `?v=mine` 3 HTTP → 1 HTTP (24 → 11 query)
  - เพิ่ม busy 3 คำขอต่อกัน → 2 คำขอ (14 → 7 query)
  - RSVP `PUT rsvp` 10 → 9 (−10%) · **ไม่ถึงเกณฑ์ 30%** (ตั้งใจคงไว้: ด่านสิทธิ์, rate limit นอกธุรกรรม, BEGIN/upsert/COMMIT, session, DTO) — ต้องให้ boss ตัดสิน
- **ผลตรวจอิสระ:**
  - qa **ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r7.md`, 0H/0M/3L · รันที่ HEAD `cb15b59`) — L1 RSVP ไม่ถึงเกณฑ์ · L2 `/groups/[gid]` ผ่านด่านกลุ่ม 2 ครั้ง · L3 e2e บน Windows 15 ล้มจาก ENOENT ของ path ยาว + server หลุด 1 ครั้ง (รันซ้ำด้วย path สั้น 329 passed / 0 failed)
  - security **ผ่าน** (`docs/reports/security-r7.md`) — Low 1 (Server-Timing เป็น oracle "username active" ผ่าน pin-reset เมื่อผู้เรียกล็อกอิน) **แก้แล้ว `c563097`** (platform) และตรวจซ้ำผ่าน `4eb3f15` · Info 5
  - ⚠️ qa รันที่ `cb15b59` ก่อน fix `c563097` — การแก้ครั้งนั้น security ตรวจซ้ำแล้ว แต่ qa ยังไม่ได้รันซ้ำ (ไม่ใช่ข้อบกพร่อง แค่ข้อสังเกต)
- **เกณฑ์ contract:** R7-1 / R7-2 / R7-3 / R7-5 ผ่าน (ตามรายงาน qa/security) · R7-4 ผ่าน 3 เส้นทางหลัก · RSVP ไม่ผ่าน · R7-6 ข้าม (optimistic ไม่ทำตาม contract §3.1) · R7-7 **ยังไม่ยืนยัน** (CI / Vercel preview ยังไม่ได้ตรวจ)
- **ยังไม่ยืนยัน:** เวลาจริงบน Turso ญี่ปุ่น (ยังไม่ได้วัด) · CI และ Vercel preview ของ branch (ตอนนี้ merge/release แล้ว แต่เลขาไม่ได้ตรวจ CI ของ `main` หลัง v0.9.1) · ผลเทสต์ทั้งชุดบน Windows (ยังมี EPERM/timeout/ENOENT ตามปกติ)

### การตัดสินของ boss (R7)
1. **RSVP ลด 10 → 9 query (ไม่ถึงเกณฑ์ 30%)** — ยอมรับตามที่ main เสนอ รอ boss ยืนยัน (ยังไม่พบคำตอบของ boss ในรีโป) · การลดต่อต้องเปลี่ยนการออกแบบ (ย้าย rate limit เข้าธุรกรรม / คืน DTO แบบย่อจาก PUT ซึ่งเปลี่ยนรูป API) → เก็บไว้ใน backlog
2. **merge PR #19** — เสร็จแล้ว (merge commit `c896b92`)
3. **ออก v0.9.1** — เสร็จแล้ว (`628175d`, tag `v0.9.1`, 2026-11-08)

### backlog ใหม่จาก R7 (ไม่บล็อก)
- RSVP ลดได้อีกถ้าออกแบบใหม่ (ดูข้อ 1 ด้านบน) · หน้า RSVP จากหน้าหลักยังเป็น 2 คำขอ (GET detail → PUT) เพราะ popup นัดชนของ R6D ต้องใช้ `myConflicts` ก่อนยืนยัน
- `/groups/[gid]` ผ่านด่านกลุ่ม 2 ครั้ง (`getGroup` + `listGroupAppointments`) ราว −1 query (qa-r7 L2)
- Server-Timing บนหน้า RSC ยังไม่มี (ใช้ harness วัดแทน) · วัดเวลาจริงบน Turso ญี่ปุ่นยังไม่ได้ทำ
- security-r7 Info 1–5: Info 1 หน้าต่างหลัง commit ของ RSVP (ยอมรับได้) · Info 2 `resolvedUsers` ระวังถ้ามีผู้เรียกใหม่หลังเขียน · Info 3 audit super admin บนหน้า `/calendar` (ยอมรับได้) · Info 4 ค่าเริ่มต้น Server-Timing "เปิด" เมื่อไม่มี `VERCEL_ENV` · Info 5 `total;dur` เป็นเวลาจริง (oracle หลักคือจำนวน query ซึ่งแก้แล้วใน Low 1)
- ข้อสังเกตเครื่อง Windows (R7): **Node v26.13.0** ในเครื่อง (เทสต์ `ops/health` คาด v24 → ล้ม) · path ยาวของ Playwright `--output` ทำ ENOENT · config Vitest ชั่วคราวข้าม EPERM (เสนอทำถาวร — ข้อเสนอเดิมจาก R6F)

## รอ boss
- **RSVP 10→9** — ยอมรับตามที่ main เสนอ รอ boss ยืนยัน (ดูหัวข้อ R7 ด้านบน)
- **F6 แจ้งเตือนก่อนนัด** — boss ต้องเลือกช่องทาง (ยังค้างจากเดิม)
- R7 เฟส A เดิม (เปิด preview อ่าน Server-Timing ด้วย DevTools เพื่อวัดเวลาจริงกับ Turso ญี่ปุ่น) — ยังไม่ได้ทำ เลื่อนเป็น backlog

## เหลือ
- **งานหลักที่ค้าง** (ตาม `docs/NEXT_PHASE.md`):
  - **F1 onboarding** — ยังไม่มี contract
  - **F6 แจ้งเตือนก่อนนัด** — **boss ต้องเลือกช่องทางก่อน** (ยังไม่ตัดสิน)
- **backlog ของ R7 (ไม่บล็อก):**
  - RSVP ลดต่อ (9 query, ไม่ถึงเกณฑ์ 30%) — ต้องออกแบบใหม่ (ดูหัวข้อ R7)
  - หน้า RSVP จากหน้าหลักยังเป็น 2 คำขอ (GET detail → PUT) เพราะ popup นัดชนของ R6D ต้องใช้ `myConflicts`
  - `/groups/[gid]` ผ่านด่านกลุ่ม 2 ครั้ง (ราว −1 query)
  - Server-Timing บนหน้า RSC ยังไม่มี
  - วัดเวลาจริงบน Turso ญี่ปุ่น (F2 เฟส A) ยังไม่ได้ทำ
  - ทำ config/helper ถาวรให้ Vitest ข้าม EPERM บน Windows (ข้อเสนอเดิม)
  - qa/security L/Info ที่เหลือจาก R7: ดู `docs/reports/qa-r7.md`, `docs/reports/security-r7.md`
- **R6 hardening (ดู `docs/NEXT_PHASE.md` หัวข้อ backlog R6 hardening):** rate limit แบบ global/อ่าน · retention กลุ่ม/คำเชิญที่ลบ · e2e retries ซ่อน flake · guard stream HTTP 200 · CSP unsafe-inline · DST day strip · แจ้งเตือน appointment.cancelled · กู้กลุ่ม/บัญชีที่ลบ
- **backlog R6F (ไม่บล็อก):**
  - qa-r6f L1: ป้ายชุดใน `MineList.tsx:99` เป็น `<span aria-label>` ไม่มี role — screen reader อาจไม่อ่าน aria-label (ข้อความที่มองเห็นยังอ่านได้) · ตัดสินใจโดย ux/frontend
  - qa-r6f L2: "Certain hours" ในปุ่ม segmented ขึ้น 2 บรรทัดที่ 375 EN (ไม่ล้น ปุ่มสูงกว่า 44px) — เชิงรูปลักษณ์
  - qa-r6f L3: `editNote` อยู่ท้ายฟอร์มแก้ไข ต้องเลื่อนถึง (เปิดเผยไว้แล้ว)
  - security-r6f Info 1: `?scope=` ซ้ำใช้ค่าสุดท้าย (`route.ts:21`) — ข้อมูลของผู้กระทำเอง · ทางเลือก: ปฏิเสธเมื่อซ้ำ
  - security-r6f Info 2: ขยายวัน 62 วันก่อนชน rate limit (ต้นทุนราว 2.5 ms/ครั้งที่วัดเอง)
  - security-r6f Info 3: กิจวัตร "17:00–20:00 ทุกวัน" เดาได้จากรูปแบบเวลา (ไม่ได้รั่วเพิ่มจากการเป็นชุด)
  - security-r6f Info 4: PATCH busy ไม่มี rate limit (contract กำหนดเฉพาะ create/delete)
  - security-r6f Info 5: การแข่งกันข้าม connection ทดสอบบน SQLite ไฟล์เดียวเท่านั้น ยังไม่ทดสอบบน Turso จริง
  - ข้อเสนอ (qa/security): ทำ config/helper ถาวรให้ Vitest ข้าม EPERM ตอนลบ temp DB บน Windows (ตอนนี้ทุก agent ทำ config ชั่วคราวเอง)
  - รอบหน้า (ตาม R6F Errata): "ลบตั้งแต่วันนี้เป็นต้นไป" และ "แก้ทั้งชุด"
- **backlog ที่ R6E ไม่รับ (ไม่บล็อก):**
  - qa-r6e L1: skeleton ไม่มี delay 150 ms / min-duration 250 ms ตาม R6E_POLISH §3.3 (`LoadingState.tsx`, `loading.tsx`)
  - qa-r6e L2: `NavProgress` ฟังแค่คลิกลิงก์ — `router.push` จากโค้ด (เช่นหลังบันทึก) ไม่ขึ้นแถบ (ปุ่มมีวงหมุนของตัวเองแล้ว)
  - qa-r6e L3: เทสต์ "นำทางเร็วไม่กระพริบ" ใช้ `--loading-delay` 5000 ms จำลอง ไม่ได้วัดเวลาจริง 150 ms
  - qa-r6e L4: ยังไม่วัด CLS (layout shift) — ปุ่มคงขนาดได้ ≤ 1px และ skeleton กำหนดขนาดด้วย CSS (อ่านโค้ด)
  - security-r6e Info 1: assertion `appt-story.spec.ts:133-134` ลบรูป `myConflicts` จากทุก response ของ B — ถ้า endpoint อื่นใช้รูปเดียวกันในอนาคตจะไม่จับ (ข้อจำกัดของเทสต์ ไม่ใช่ช่องโหว่)
  - security-r6e Info 2: E11 ไม่ดู `truncated` และช่วงยาวใช้รายการที่ยังไม่จบ → อาจเตือนไม่ครบ (UX ไม่ใช่ความปลอดภัย)
  - security-r6e Info 3: E11 เพิ่ม `GET /api/me/busy` 1 ครั้งต่อการบันทึก (อ่านของตัวเอง)
  - security-r6e Info 4: CSP ยังมี `'unsafe-inline'` ใน script-src/style-src (`next.config.ts`) — ของเดิม, nonce อยู่ใน hardening
  - security-r6d Info 5: การ์ดรายการ `myConflict` มีเพดาน 500 ไม่มีธง truncated (ผลแค่ UI)

## ข้อสังเกต
- **ลำดับ migration `0003` (ปิดแล้ว):** commit `ca104a0` (ops) แก้ `docs/OPERATIONS.md` ให้ตรงกับลำดับที่ main สั่ง (preview ก่อน PR, prod ก่อน merge) — ปิดตาม commit message
- **ADR 0010 (ปิดแล้ว):** commit `a7f66c0` `docs(adr): 0010 accepted` — ไม่ใช่ *Proposed* อีกต่อไป (ตรวจจาก commit message)
- **ความจริงที่ไม่ตรงกับ PROGRESS รอบก่อน (แก้แล้ว):** รอบก่อนเขียนว่า R6F "รอ migration/PR" และ "ยังไม่ push" — ปัจจุบัน merge + ออก v0.9.0 แล้ว (ตรวจด้วย `gh pr view 18` และ `git tag`)
- **vitest ทั้งชุดบน Windows ล้มหลายร้อยข้อ เป็นปัญหาเดิม** — qa รันเทียบ main แล้ว (main `37271af` ล้ม 908, branch R6E ล้ม 907) · รายงาน qa เป็นตัวเลขของ qa ไม่ใช่ของเลขา
- `npm run lint` จาก root ไปสแกน worktree ที่ซ้อนใน `.claude/worktrees/` → ใช้ `npx eslint . --ignore-pattern ".claude/**"` แทน (qa รันแล้ว 0 problems) — ปัญหาการตั้งค่า
- เครื่อง Windows ของ boss: เทสต์ฐานข้อมูลบางไฟล์ล้มด้วย EPERM ตอนลบโฟลเดอร์ชั่วคราว, `config-hygiene` ข้อ permissions ล้มบน CRLF, `tests/release` CLI ล้มเพราะ `.bin/tsx` ENOENT — เป็นปัญหาเดิม (ดูผลจริงจาก CI)
- ยังไม่ยืนยัน: CI และ Vercel preview ของ R6E, R6F และ `main` หลัง v0.9.0 / v0.9.1 (เลขาไม่ได้ตรวจ) · ใบรับรอง Handoff ของแต่ละบทบาทไม่มีไฟล์ในรีโป (มีเฉพาะรายงาน qa/security)
- ช่องวันในปฏิทินจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)
