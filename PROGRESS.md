# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](docs/NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-03 (เวลาไทย)

## เสร็จแล้ว
- R0–R5: foundation, บัญชี PIN, กลุ่ม, ปฏิทิน + busy, วันว่างร่วม + สร้างนัด, หน้า super admin + audit log (ดู CHANGELOG)
- ออก **v0.7.0** (2026-10-28) · ออก **v0.7.1** (2026-11-01) รวม R6A + R6B
- CI-1: artifact Playwright อัปโหลดเฉพาะตอนเทสต์ล้ม (PR #10) · R6A (PR #11) · R6B (PR #13)
- ทีม agent v2: 10 บทบาทใน `.claude/agents/` (PR #14)
- **R6C merge แล้ว** (PR #15, merge commit `4990f3e`, 2026-11-01) — F3ก ตั้งสี/รูปทรงของตัวเองต่อกลุ่ม · migration `0002` (`color_slot`/`shape_slot`) · ผลตรวจ: qa ผ่าน (`docs/reports/qa-r6c.md`) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6c.md`)
- **migration `0002` รันแล้ว** (boss ยืนยัน 2026-11-02 ตามที่ main แจ้ง — เลขาไม่ได้ตรวจฐาน Turso เอง)
- **R6D merge แล้ว** (PR #16, merge commit `44dad19`, 2026-11-02) — G1 จำกลุ่มที่เลือกไว้ต่อเครื่อง · G2 ตอบ "ไป" = ไม่ว่างทุกกลุ่ม + popup ยืนยัน/เตือนนัดชน (ไม่บล็อก) · ไม่มี migration · ADR `docs/adr/0009-going-counts-as-busy.md`
  - ผลตรวจอิสระ: qa ผ่านแบบมีข้อสังเกต (`docs/reports/qa-r6d.md`, 0H/0M/4L) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6d.md`, 0C/0H/0M/2L/5I)
- **ออก v0.8.0 แล้ว** (2026-11-02, tag `v0.8.0`, commit `37271af` `chore(release): v0.8.0`) รวม R6C + R6D · ข้อเสนอ v0.9.0 ใน `R6D_CONTRACT.md` ไม่ได้ใช้ (รอบออกเป็น v0.8.0)
- **R6E merge แล้ว** (PR #17 "R6E: cleanup backlog + busy overlap confirm + loading polish (v0.8.1)", merge commit `b1daec1`, `gh pr view 17` mergedAt 2026-11-02T16:52:25Z = 23:52 เวลาไทย) — E1–E12 ตาม `R6E_CONTRACT.md` (E11 popup ลงทับ busy เดิม · E12 progress/spinner/skeleton/transition ปิดด้วย reduced-motion)
  - ผลตรวจอิสระ: qa **ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r6e.md`, 0H/0M/4L) · security **ผ่าน** (`docs/reports/security-r6e.md`, 0C/0H/0M/0L, Info 4)
  - **R6D L1/L2 ปิดแล้ว** · **F5 ปิดแล้ว** (boss เลือกคงข้อความ `privacy.draft` 2026-11-02 — ไม่แก้โค้ด)
- **ออก v0.8.1 แล้ว** (tag `v0.8.1` → commit `72d7881` `chore(release): v0.8.1`, เวลาไทย 2026-11-03 03:10 — ตรวจจาก `git log`/`git tag`) รวม R6E · หัวข้อ `[0.8.1] - 2026-11-03` ใน CHANGELOG · รอบนี้ไม่มี migration
  - tag `v0.8.1` ชี้ไปที่ `72d7881` (`git rev-parse v0.8.1`) · main ตอนนี้ที่ `72d7881`

## R6F — เสร็จแล้ว (โค้ด/เทสต์/รีวิว) — รอ migration `0003` + เปิด PR + merge + ออก v0.9.0
- busy หลายวันเฉพาะช่วงเวลา (ทั้งวัน/เฉพาะช่วงเวลา) + ลบวันนี้/ลบทั้งชุด · `R6F_CONTRACT.md` (tracked บน branch, boss เห็นชอบ 2026-11-02, §2 = (ข) มีชุด + migration `0003`) · ADR `docs/adr/0010-daily-busy-series.md` (ไฟล์ในรีโปยังเขียนสถานะ *Proposed*)
- branch `feat/r6f-daily-busy` (แตกจาก `main`, มี merge `7aabdf4` ของ main) · HEAD ณ เลขา `2a33843` · **ยังไม่ push** (ไม่มี upstream) · **ยังไม่มี PR** (`gh pr list --head feat/r6f-daily-busy` ว่าง ตรวจ 2026-11-03)
- เลขเวอร์ชันที่เสนอ: **v0.9.0** (MINOR) · ยังไม่ออก
- ผลตรวจอิสระ (ของผู้ตรวจ ไม่ใช่ของเลขา):
  - qa **ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r6f.md`, HEAD ที่ตรวจ `8391d79`, 0H/0M/3L)
  - security **ผ่าน** (`docs/reports/security-r6f.md`, 0C/0H/0M/0L, Info 5, HEAD ที่ตรวจ `438beab`)
- ผู้ทำตาม commit author จริง: architect (`258334a`) · main (`3123a0f`, `87264dd`, `313e016`, `7aabdf4`) · platform (`8bed164`, `d125181`, `a93ba6f`) · ux (`7d97edd`) · test (`3a9bd73`) · frontend (`f903665`, `8391d79`) · ops (`438beab`) · qa (`2a33843`) · security (`286bee8`) · auth ไม่มี commit ในรอบนี้
- **ขั้นต่อไป (ตามลำดับ):**
  1. boss รัน migration `0003` บน Turso **preview** ก่อนเปิด/ทดสอบ PR และ **prod** ก่อน merge (ขั้นตอนใน `docs/OPERATIONS.md` ส่วน R6F)
  2. main เปิด PR เข้า `main` แล้วหยุด → boss merge แบบ **Create a merge commit**
  3. ออก v0.9.0 เมื่อ CI เขียวบน main: `npx tsx scripts/release.ts 0.9.0 --skip-gates` (`--skip-gates` เพราะ `npm test` ทั้งชุดล้มบน Windows จากปัญหาเดิม — ต้องดูผลจริงจาก CI) แล้ว boss push tag เอง
- **ยังไม่ยืนยัน:** migration `0003` ยังไม่รันบนฐานใด (เลขาไม่ได้ตรวจ Turso) · CI/Vercel ของ branch ยังไม่มี · ผล `npm test` รอบ R6F ในเครื่องเลขาไม่มี (เลขาไม่ได้รัน) — ผลที่ทราบมาจากรายงาน qa/security เท่านั้น

## รอ boss
- ก่อนเปิด/ทดสอบ PR R6F: รัน migration `0003` บน Turso **preview** · ก่อน merge: รันบน **prod** (ตาม OPERATIONS)
- merge PR R6F (Create a merge commit) แล้วออก v0.9.0 + push tag เอง
- ตัดสินช่องทางแจ้งเตือนก่อนนัด (F6) — ยังค้างจากเดิม

## เหลือ
- ตาม `docs/NEXT_PHASE.md`: F1 onboarding · F2 ความช้าฝั่งเซิร์ฟเวอร์ (วัดก่อน-หลัง) · F6 แจ้งเตือนก่อนนัด (**boss ยังไม่ตัดสินช่องทาง**) · R6 hardening (ดู NEXT_PHASE)
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
- **ความไม่ตรงกันเรื่องลำดับ migration:** `docs/OPERATIONS.md` (หมายเหตุ R6F) เขียน "ทำทีละฐาน (prod แล้ว preview)" แต่ main สั่งให้ทำ preview ก่อนเปิด/ทดสอบ PR และ prod ก่อน merge — เลขาไม่ได้แก้ OPERATIONS (นอกขอบเขต) → แจ้ง main ให้ยืนยันลำดับ
- **ความจริงที่ไม่ตรงกับ PROGRESS รอบก่อน (แก้แล้ว):** `R6F_CONTRACT.md` ถูก track แล้วบน branch (ไม่ใช่ untracked) · รอบก่อนเขียนว่า R6E "รอ merge" — ตอนนี้ merge แล้ว (PR #17)
- **vitest ทั้งชุดบน Windows ล้มหลายร้อยข้อ เป็นปัญหาเดิม** — qa รันเทียบ main แล้ว (main `37271af` ล้ม 908, branch R6E ล้ม 907) · รายงาน qa เป็นตัวเลขของ qa ไม่ใช่ของเลขา
- `npm run lint` จาก root ไปสแกน worktree ที่ซ้อนใน `.claude/worktrees/` → ใช้ `npx eslint . --ignore-pattern ".claude/**"` แทน (qa รันแล้ว 0 problems) — ปัญหาการตั้งค่า
- เครื่อง Windows ของ boss: เทสต์ฐานข้อมูลบางไฟล์ล้มด้วย EPERM ตอนลบโฟลเดอร์ชั่วคราว, `config-hygiene` ข้อ permissions ล้มบน CRLF, `tests/release` CLI ล้มเพราะ `.bin/tsx` ENOENT — เป็นปัญหาเดิม (ดูผลจริงจาก CI)
- ยังไม่ยืนยัน: CI และ Vercel preview ของ R6E และ R6F (เลขาไม่ได้ตรวจ) · ใบรับรอง Handoff ของแต่ละบทบาทไม่มีไฟล์ในรีโป (มีเฉพาะรายงาน qa/security)
- ช่องวันในปฏิทินจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)
