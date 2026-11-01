# QA — agents v2 (branch chore/agents-v2, a0ebfaf + c11efc3)

Verdict: **ผ่านแบบมีข้อสังเกต** (หลังแก้ H ข้อเดียวใน 4a3eaa7)

## ข้อพบ
- **H1 (แก้แล้ว)** `.claude/agents/qa.md:3`, `security.md:3` — description เป็น YAML แบบไม่ใส่ quote และมี `qa: ` / `แบบอิสระ: ` ทำให้ parse ไม่ผ่าน (js-yaml: bad indentation) agent 2 ตัวนี้จะโหลดไม่ขึ้นหรือไม่มี description → main เลือกไม่ได้ แก้โดยครอบ description ด้วย `"..."` ตอนนี้ทั้ง 10 ไฟล์ parse ผ่าน
- **M1** CLAUDE.md "วิธีใช้ทีม agent" ขัดกันเอง: main "เขียน contract" แต่ "ไม่แก้ไฟล์เอง" และไม่มี agent ตัวไหนเป็นเจ้าของ `*_CONTRACT.md` / `docs/prd/**` (แถว #1 Lead ของ TEAM.md) → ต้องตัดสิน: ให้ architect เป็นเจ้าของ หรืออนุญาต main แก้เฉพาะ contract
- **M2** CLAUDE.md ยังอ้าง "Lead" (บรรทัด 11, 32, 33) ทั้งที่ไม่มี agent Lead แล้ว ควรเปลี่ยนเป็น main · และกฎ 2 ชี้ไป `.claude/agents/` แทนตาราง TEAM.md ซึ่งขอบเขตของ ops/platform/frontend ขยายจากตารางเดิม (เช่น ops รับ CHANGELOG/release, platform รับ calendar/integrations, frontend รับ `src/styles/**`) ผู้ตรวจต้องรู้ว่าไฟล์ agent คือต้นฉบับขอบเขต
- **L1** ไฟล์ที่ไม่มีเจ้าของ (เหมือนเดิมใน TEAM.md ไม่ใช่การถอย): `package.json`/lockfile, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `README.md`, `PROCESS.md`, `TEAM.md`, `docs/NEXT_PHASE.md`, `public/` นอก brand
- **L2** PROGRESS.md "ช่องวันจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)" — หาหลักฐานใน docs/CHANGELOG/รายงาน QA ไม่เจอ (ยืนยันไม่ได้) · ข้อความอื่นตรงของจริง: v0.7.0 2026-10-28, v0.7.1 2026-11-01, PR #10/#11/#13, R6C + L2–L4 ใน errata R6B, F6 ยังไม่ตัดสิน
- **L3** reviewer มี Edit/Write/Bash: qa มี Edit ตามบทบาท (แก้บั๊กได้) ยอมรับได้ · security ไม่มี Edit ตรงตั้งใจ แต่ยังมี Write+Bash จึงบังคับด้วยข้อความเท่านั้น (ไม่ใช่กลไก) · architect มี WebSearch/WebFetch เหมาะกับงานค้นคว้า
- ข้อ OK: ผู้เขียน commit ทั้งสอง = `ops <309017158+ieatbaozi-stack@users.noreply.github.com>` · ไม่เหลือ `maewmeet.local` ในไฟล์ที่ track (เหลือแค่ใน .git/logs เก่า) · model ตรงตามที่ boss กำหนด (opus: architect/platform/auth/security · sonnet: frontend/ux/test/ops/qa · haiku: secretary) · ไม่มี tab, frontmatter `---` ครบ · tools เป็นชื่อจริง comma-separated · งาน TEAM.md #2–#16 มีเจ้าของครบ (#2,#3→architect, #7,#9→platform, #14 ตัด, #15→ops, #1 ดู M1) · ขอบเขตไฟล์ไม่ทับกันที่ตรวจเจอ (api: platform ยกเว้น auth/health; tests/calendar เป็นของ platform) · `.claude/agents/` และ CLAUDE.md อยู่ใน git ไม่ถูก ignore; `agent-log.jsonl`, `settings.local.json` อยู่ใน .gitignore · ไม่เหลือ fullstack/researcher/calendar/release/integrations agent

## คำสั่งที่รัน
- parse frontmatter ทั้ง 10 ไฟล์ด้วย js-yaml: ก่อนแก้ FAIL 2 (qa, security) · หลังแก้ OK 10/10
- `npx vitest run tests/ops tests/security` บน chore/agents-v2: 9 files failed, 126 failed | 202 passed | 29 skipped (357)
- เหมือนกันบน main: 9 failed, 126 failed | 202 passed | 29 skipped (357) → เท่ากัน (ปัญหา Windows เดิม)

## ตรวจไม่ได้
- ไม่ได้ลองให้ Claude Code โหลด agent จริง (ตรวจ YAML ด้วย js-yaml แทน) · ไม่ได้ยืนยัน Vercel preview
