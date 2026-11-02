# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](docs/NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-02

## เสร็จแล้ว
- R0–R5: foundation, บัญชี PIN, กลุ่ม, ปฏิทิน + busy, วันว่างร่วม + สร้างนัด, หน้า super admin + audit log (ดู CHANGELOG)
- ออก **v0.7.0** (2026-10-28) · ออก **v0.7.1** (2026-11-01) รวม R6A + R6B
- CI-1: artifact Playwright อัปโหลดเฉพาะตอนเทสต์ล้ม (PR #10) · R6A (PR #11) · R6B (PR #13)
- ทีม agent v2: 10 บทบาทใน `.claude/agents/` (PR นี้)
- **R6C merge แล้ว** (PR #15, merge commit `4990f3e`, 2026-11-01) — F3ก ตั้งสี/รูปทรงของตัวเองต่อกลุ่ม · migration `0002` (`color_slot`/`shape_slot`) · ผลตรวจ: qa ผ่าน (`docs/reports/qa-r6c.md`) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6c.md`)
- **migration `0002` รันแล้ว** (boss ยืนยัน 2026-11-02 ตามที่ main แจ้ง — เลขาไม่ได้ตรวจฐาน Turso เอง)
- **R6D merge แล้ว** (PR #16, merge commit `44dad19`, 2026-11-02) — G1 จำกลุ่มที่เลือกไว้ต่อเครื่อง · G2 ตอบ "ไป" = ไม่ว่างทุกกลุ่ม + popup ยืนยัน/เตือนนัดชน (ไม่บล็อก) · ไม่มี migration · ADR `docs/adr/0009-going-counts-as-busy.md`
  - ผลตรวจอิสระ: qa ผ่านแบบมีข้อสังเกต (`docs/reports/qa-r6d.md`, 0H/0M/4L) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6d.md`, 0C/0H/0M/2L/5I)
- **ออก v0.8.0 แล้ว** (2026-11-02, tag `v0.8.0`, commit `37271af` `chore(release): v0.8.0`) รวม R6C + R6D · ข้อเสนอ v0.9.0 ใน `R6D_CONTRACT.md` ไม่ได้ใช้ (รอบออกเป็น v0.8.0)
- **R6E เสร็จแล้ว (โค้ด/เทสต์/รีวิว) — รอ boss merge PR แล้วออก v0.8.1** (`R6E_CONTRACT.md`, branch `chore/r6e-cleanup`, 20 commit ตั้งแต่ `37271af` ณ HEAD `4cf522a` · ตั้งแต่ `37b9f60` มีแค่รายงาน qa/security)
  - E1–E10 ปิดตาม contract: E1/E2 คำ popup "ไป" · E3 มุมมองวัน 375 · E4 ปุ่ม RSVP บรรทัดเดียว · E5 assertion `appt-story` (ตรวจแล้วจาก R6D `1541016` ไม่มี commit ใหม่ในรอบนี้) · E6 authorize-first ผ่านบน Windows (`be05a8a`) · E7 `home-rsvp-hint` testid · E8/E9 samples + ADR 0009 · E10 F5 คงข้อความ
  - E11 (feedback boss): ลง busy ทับ busy เดิม → popup ยืนยันก่อนบันทึก (`f7a7955`)
  - E12 (feedback boss): แถบ progress/วงหมุน/skeleton/transition ปิดด้วย reduced-motion (`8ae447a`, `3750048`)
  - **ผลตรวจอิสระ:** qa **ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r6e.md`, 0H/0M/4L) · security **ผ่าน** (`docs/reports/security-r6e.md`, 0C/0H/0M/0L, Info 4) · ไม่มีการแตะ api/auth/rbac/schema/drizzle/config ความปลอดภัย (ตรวจ `git diff`)
  - **R6D L1/L2 ปิดแล้ว** (security ตรวจซ้ำ 2026-11-02) · **F5 ปิดแล้ว** (boss เลือกคงข้อความ `privacy.draft` 2026-11-02 — ไม่แก้โค้ด)
- **เลขาตรวจ:** `gh pr list --head chore/r6e-cleanup` ตอนรันเลขา ไม่พบ PR (ยังไม่ยืนยันว่า main เปิดแล้วหรือยัง) · CI/Vercel ยังไม่ยืนยัน

## กำลังทำ
- **R6F** — busy หลายวันเฉพาะช่วงเวลา + ลบทั้งชุด (`R6F_CONTRACT.md` ที่ยัง untracked, boss เห็นชอบ 2026-11-02, §2 = (ข) มีชุด + migration `0003`) · ข้อเสนอเลข **v0.9.0** (MINOR)
  - branch `feat/r6f-daily-busy` (แตกจาก `main` ที่ `37271af`) · ทำใน worktree แยก `.claude/worktrees/agent-a9b1c46957dc239b8` · ยังไม่มี upstream (ยังไม่ push)
  - ทำแล้วบน branch (ตรวจด้วย `git log`): ADR `0010-daily-busy-series.md` (architect `258334a`, สถานะ Proposed) · main ตัดสินประเด็นเปิด (`87264dd`, `313e016`) · platform: `expandDailyBusyInput` (`8bed164`), migration `0003_r6f_busy_series.sql` + `series_id` + index (`d125181`), `POST` kind `daily` + ลบ `scope=series` + rate limit (`a93ba6f`)
  - **ยังไม่ทำ:** ux / frontend / test (เริ่มหลัง R6E merge ตาม contract) · ยังไม่รันเทสต์รอบ R6F ในเครื่องเลขา
  - **boss ต้องรัน migration `0003` บน Turso ก่อน deploy R6F** (ไฟล์ migration มีแล้ว ยังไม่ได้รันบนฐานจริง)
- หลัง R6E ปิด: main เปิด PR เข้า `main` (ถ้ายังไม่เปิด) แล้วหยุด → boss ตรวจ merge (Create a merge commit) + รัน `npx tsx scripts/release.ts 0.8.1` + push tag เอง

## รอ boss
- merge PR ของ R6E (Create a merge commit) แล้วรัน `npx tsx scripts/release.ts 0.8.1` + push tag (ข้อเสนอเลข **v0.8.1** — PATCH, ไม่มี migration, ไม่แตะ API/schema/RBAC)
- ก่อน deploy R6F: รัน migration `0003` บน Turso
- ตัดสินช่องทางแจ้งเตือนก่อนนัด (F6) — ยังค้างจากเดิม

## เหลือ
- F1 onboarding · F2 ความช้าฝั่งเซิร์ฟเวอร์ (วัดก่อน-หลัง) · F6 แจ้งเตือนก่อนนัด (**boss ยังไม่ตัดสินช่องทาง**) — ตาม `docs/NEXT_PHASE.md`
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
  - ข้อเดิม: `docs/design/samples` ใช้ `data-slot` → **แก้แล้วใน R6E (E8)** ไม่อยู่ในรายการนี้

## ข้อสังเกต
- **vitest ทั้งชุดบน Windows ล้ม ~907 ข้อ เป็นปัญหาเดิม** — qa รันเทียบ main แล้ว (main `37271af` ล้ม 908, branch R6E ล้ม 907, ไม่มีเทสต์ที่ล้มเพิ่มเมื่อเทียบ main) · รายงาน qa เป็นตัวเลขของ qa ไม่ใช่ของเลขา
- `npm run lint` จาก root ไปสแกน worktree ที่ซ้อนใน `.claude/worktrees/` → 26 errors (ทั้งหมดอยู่ใน worktree R6F) · ใช้ `npx eslint . --ignore-pattern ".claude/**"` ได้ 0 problems (qa รันแล้ว) — ปัญหาการตั้งค่า ไม่ใช่โค้ดของ R6E
- รายงาน qa ระบุ HEAD `1bf6ec5` และ security ระบุ HEAD `37b9f60` — เพราะรายงานเขียนก่อน commit ของตัวเอง · `git diff --stat 37b9f60..HEAD` = เฉพาะ `docs/reports/qa-r6e.md` และ `security-r6e.md` (ยืนยันแล้ว) จึงไม่มีโค้ดที่ไม่ได้รีวิว
- ยังไม่ยืนยัน: CI และ Vercel preview ของ R6E (ยังไม่มี PR ที่เลขาตรวจได้)
- ยังไม่ยืนยัน: ใบรับรอง Handoff ของแต่ละบทบาทใน R6E ไม่มีไฟล์ในรีโปให้ตรวจ (มีเฉพาะรายงาน qa/security)
- ยังไม่ยืนยัน: ผล `npm test` ของรอบ R6E/R6F ในเครื่องเลขา — เลขาไม่ได้รันเอง ผลที่ทราบมาจากรายงาน qa/security เท่านั้น
- เครื่อง Windows ของ boss: เทสต์ฐานข้อมูลบางไฟล์ล้มด้วย EPERM ตอนลบโฟลเดอร์ชั่วคราว, `config-hygiene` ข้อ permissions ล้มบน CRLF, และ `tests/release` CLI ล้มเพราะ `.bin/tsx` ENOENT — เป็นปัญหาเดิม (ดูผลจริงจาก CI)
- ช่องวันในปฏิทินจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)
