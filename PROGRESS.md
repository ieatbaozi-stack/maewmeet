# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](docs/NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-03 05:24 (เวลาไทย) · ตรวจด้วย `git log`, `git tag`, `gh pr view 18`

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

## R7 — กำลังทำ (branch `perf/r7-speed`, ยังไม่มีโค้ด) 🔄
- contract: `R7_CONTRACT.md` (commit `f44551a` โดย main, 2026-11-03 05:24) · boss เห็นชอบทิศทางแล้ว 2026-11-03
- branch `perf/r7-speed` แตกจาก `ea1bf5f` (v0.9.0) · checkout หลัก `maewmeet-git` · ไม่มี push / PR
- เนื้อหา: **F2 ความเร็ว** (เฟส A วัด baseline → เฟส B แก้ → วัดหลัง) + **G1** กลุ่มใหม่ "ว่างอย่างน้อย" ค่าเริ่มต้น 240 นาที (4 ชม.) · ไม่มี migration · ไม่แก้ DB default
- เลขเวอร์ชันที่เสนอ: **v0.9.1** (ถ้ามีแค่ G1 + ความเร็วที่ไม่เปลี่ยนรูป API) — ยังไม่ออก
- ขั้นต่อไป: platform (G1 + ตัวนับ query/Server-Timing) + ops + secretary ตามลำดับใน R7 §7 → baseline → main สรุปแจ้ง boss ก่อนเฟส B
- **ยังไม่มีผลวัดใดในรอบนี้** (ยังไม่มี `docs/reports/perf-r7-baseline.md`)

## รอ boss
- R7 เฟส A: เมื่อ main ส่งขั้นตอน ให้เปิดหน้า preview แล้วอ่าน `Server-Timing` ใน DevTools (เพื่อเวลาจริงกับ Turso ญี่ปุ่น)
- R7: ตรวจผลวัด baseline + เลือกรายการเฟส B ที่ main เสนอ
- ตัดสินช่องทางแจ้งเตือนก่อนนัด (F6) — ยังค้างจากเดิม

## เหลือ
- ตาม `docs/NEXT_PHASE.md`: F1 onboarding · F2 ความช้า (อยู่ใน R7) · F6 แจ้งเตือนก่อนนัด (**boss ยังไม่ตัดสินช่องทาง**) · R6 hardening (ดู NEXT_PHASE)
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
- **backlog R6 hardening (จาก NEXT_PHASE):** rate limit แบบ global/อ่าน, retention กลุ่ม/คำเชิญที่ลบ, e2e retries ซ่อน flake, guard stream HTTP 200, CSP unsafe-inline, DST day strip, แจ้งเตือน appointment.cancelled, กู้กลุ่ม/บัญชีที่ลบ

## ข้อสังเกต
- **ลำดับ migration `0003` (ปิดแล้ว):** commit `ca104a0` (ops) แก้ `docs/OPERATIONS.md` ให้ตรงกับลำดับที่ main สั่ง (preview ก่อน PR, prod ก่อน merge) — ปิดตาม commit message
- **ADR 0010 (ปิดแล้ว):** commit `a7f66c0` `docs(adr): 0010 accepted` — ไม่ใช่ *Proposed* อีกต่อไป (ตรวจจาก commit message)
- **ความจริงที่ไม่ตรงกับ PROGRESS รอบก่อน (แก้แล้ว):** รอบก่อนเขียนว่า R6F "รอ migration/PR" และ "ยังไม่ push" — ปัจจุบัน merge + ออก v0.9.0 แล้ว (ตรวจด้วย `gh pr view 18` และ `git tag`)
- **vitest ทั้งชุดบน Windows ล้มหลายร้อยข้อ เป็นปัญหาเดิม** — qa รันเทียบ main แล้ว (main `37271af` ล้ม 908, branch R6E ล้ม 907) · รายงาน qa เป็นตัวเลขของ qa ไม่ใช่ของเลขา
- `npm run lint` จาก root ไปสแกน worktree ที่ซ้อนใน `.claude/worktrees/` → ใช้ `npx eslint . --ignore-pattern ".claude/**"` แทน (qa รันแล้ว 0 problems) — ปัญหาการตั้งค่า
- เครื่อง Windows ของ boss: เทสต์ฐานข้อมูลบางไฟล์ล้มด้วย EPERM ตอนลบโฟลเดอร์ชั่วคราว, `config-hygiene` ข้อ permissions ล้มบน CRLF, `tests/release` CLI ล้มเพราะ `.bin/tsx` ENOENT — เป็นปัญหาเดิม (ดูผลจริงจาก CI)
- ยังไม่ยืนยัน: CI และ Vercel preview ของ R6E, R6F และ `main` หลัง v0.9.0 (เลขาไม่ได้ตรวจ) · ใบรับรอง Handoff ของแต่ละบทบาทไม่มีไฟล์ในรีโป (มีเฉพาะรายงาน qa/security)
- ช่องวันในปฏิทินจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)
