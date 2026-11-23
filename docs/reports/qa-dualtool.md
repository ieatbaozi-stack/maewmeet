# QA DUALTOOL — เอกสารล้วน (AGENTS.md / TEAM / PROCESS / HANDOFF)

> ผู้ตรวจ: qa (อิสระ) · branch `docs/antigravity-team` (rebase บน origin/main หลัง PR #43) · ตรวจ 2026-11-23

## Verdict: ผ่านแบบมีข้อสังเกต
เอกสารตรงของจริงตาม §7 · พบข้อความเก่า/ขัดกัน 4 จุด แก้แล้วใน commit qa · เหลือ 2 ข้อสังเกตให้ main ตัดสิน

## ข้อพบ (เรียงตามความรุนแรง)
1. (กลาง, แก้แล้ว) HANDOFF ล้าสมัยกับ main: migration 0007 เขียนว่า "ยังไม่ยืนยัน" ทั้งที่ boss รันแล้ว preview+prod · "PROGRESS ล้าสมัย" ทั้งที่ #43 อัปเดตแล้ว · แถว V2/security เขียน "ยังไม่ยืนยัน" · แก้ให้ตรง PROGRESS (งานค้างให้ยึด PROGRESS) และเขียน PR เป็น "PR DUALTOOL (docs/antigravity-team)"
2. (กลาง, แก้แล้ว) `AGENTS.md` §7 trailer บอกให้ใช้ "ชื่อโมเดลจริง" อย่างเดียว ขัดกับธรรมเนียม/CLAUDE.md/qa.md (trailer ที่ main ให้) → แยกสองกรณี: Claude Code ใช้ `Claude Opus 5.5` ที่ main ให้ทุกบทบาท · Antigravity ใช้โมเดลจริง
3. (ต่ำ, แก้แล้ว) `PROCESS.md` (หัวข้อ "กติกาสำหรับเครื่องมือ AI") และ `HANDOFF.md` §5/§6 ยังเขียนว่า AGENTS.md "ยังไม่มีในสาขานี้/จะมีเมื่อ T1 merge" ทั้งที่มีแล้ว → ลบ/แก้
4. (ต่ำ, แก้แล้ว) `AGENTS.md` ไม่ลิงก์ HANDOFF → เพิ่มในหัว "อ่านก่อน" · เพิ่มบรรทัดเริ่มเครื่อง (Node 24.x จาก `.nvmrc`/engines, `npm ci`, `npm run dev`) ให้ AI ใหม่รันได้ทันที
5. (ข้อสังเกต 🟡 ให้ main ตัดสิน ไม่ได้แก้) ระดับ A ใน AGENTS §3 รวม "API/logic ที่ไม่แตะสิทธิ์" ว่าไม่ต้อง security แต่ CLAUDE.md/PROCESS บอกต้องมี security เมื่อ "แตะ api" ทั่วไป → AI ใหม่อาจเข้าใจต่างกัน (เพิ่ม route ใหม่ที่รับข้อมูลผู้ใช้นับเป็น A หรือ B?) · AGENTS มีกฎ "ไม่แน่ใจ → ระดับสูงกว่า" ช่วยอยู่ แต่ควรให้ main ชี้ขาดในหนึ่งประโยค (เสนอ: เพิ่ม/แก้ route ใน `src/app/api/**` = B)
6. (ข้อสังเกต 🟢) `git diff --check` เตือน trailing whitespace ที่ CLAUDE.md บรรทัด 4/12/27 (บรรทัดที่ ops แก้) · ไม่กระทบเนื้อหา

## ตรวจตามเกณฑ์ §7
| ข้อ | ผล | หลักฐาน |
|---|---|---|
| 1 ไฟล์มี · AGENTS ≤ ~200 | ผ่าน | `AGENTS.md` 100 บรรทัด · `.agent/rules/maewmeet.md` 8 · `HANDOFF.md` 53 (≤ 60) |
| 2 path/คำสั่งจริง | ผ่าน | ไล่ทุก path ใน AGENTS/TEAM (docs/VERSIONING, UI_DIRECTION, qa-r18, OPERATIONS, ci.yml, scripts/*, .nvmrc, vercel.json, src/lib/*, src/app/api/*, tests/calendar, docs/guides/quickstart-th.html, SECRETARY.md ฯลฯ) → `[ -e ]` พบครบ · คำสั่ง lint/typecheck/test/build/test:e2e/db:generate/db:check/dev มีใน package.json · `release.ts` มี `--dry-run`/`--skip-gates` จริง · tag `v1.0.0` → `c906d09` ตรง HANDOFF |
| 3 ไม่ขัดกัน | ผ่านแบบมีข้อสังเกต | แก้ข้อ 2–3 แล้ว · เหลือข้อ 5 |
| 4 TEAM ตรง agent | ผ่าน | 10 agent ตรง `.claude/agents/*.md` (ชื่อ, model: architect/platform/auth/security=opus · ux/frontend/ops/test/qa=sonnet · secretary=haiku, ขอบเขตไฟล์ platform/ops/test/ux/frontend/secretary ตรงข้อความ "ขอบเขตไฟล์ของคุณ") · AGENTS §4 ตรงเช่นกัน (platform ใน AGENTS ไม่ระบุ `api/line` แต่ครอบด้วย `api/**`) |
| 5 lint + docs-sync | ผ่าน | ด้านล่าง |
| 6 PR มีหัวข้อ "เอกสาร"/agent | ยังไม่ตรวจ | main ยังไม่เปิด PR — ต้องใส่ (AGENTS §7 กำหนด) |
| ความลับ | ผ่าน | ไม่มี token/pepper/ค่า env ในไฟล์ที่เปลี่ยน (มีแต่อีเมล noreply ของ boss ซึ่งเป็นค่าสาธารณะที่กฎกำหนด) |

## อ่านแบบ "AI ที่ไม่รู้จักโปรเจกต์"
ระดับ A/B ทำได้ถูกโดยไม่ต้องถามในกรณีทั่วไป: ลิงก์ครบ · ตารางระดับงาน+ผู้ตรวจชัด · วิธีสวมบทบาท 6 ขั้น · คำสั่ง/commit/ข้อจำกัด Windows ครบ · ข้อ boss ตัดสินแล้ว ย้ายจาก memory ครบ 6 ข้อ · ช่องกำกวมเดียวคือข้อ 5 และไม่ระบุว่า Antigravity ต้อง push/เปิด PR ด้วยเครื่องมือไหน (ใช้ git/gh ปกติ — ไม่ได้เขียน) 🟢

## Code review 9 ข้อใน qa.md
ครบ 9 ข้อตาม D1/T4 · ไม่ซ้ำ/ขัดของเดิมเหนือหัวข้อ (ข้อ 1,6,8 เสริมของเดิมที่เป็นระดับตรวจ contract/กฎเหล็ก/DOCS_SYNC) · ระดับ 🔴/🟡/🟢 ตรงนิยาม verdict ที่มีอยู่ · อยู่ตำแหน่งหลังรายการหลัก ไม่กระทบ frontmatter (name/model ไม่เปลี่ยน)

## คำสั่งที่รัน + ผลจริง (Windows, Node v26)
- `npm run lint` → ผ่าน (ไม่มี error)
- `npx vitest run tests/ops/docs-sync.test.ts tests/ops/operations-doc.test.ts --reporter=agent` → 2 files, 15 tests ผ่านทั้งหมด
- `git diff origin/main...HEAD --check` → เตือน trailing whitespace ใน CLAUDE.md (ข้อ 6)

## ตรวจไม่ได้ / ไม่เกี่ยว
- Antigravity อ่านไฟล์ไหนจริง (DUALTOOL §8 ให้ boss ยืนยัน)
- `tests/ops` admin-reset-pin / pepper-fingerprint และ health ที่ secretary รายงานว่าล้ม: ไม่ได้รันซ้ำ (diff นี้ไม่แตะโค้ด/เทสต์) · เป็นปัญหาเครื่อง Windows/Node v26 ที่ PROGRESS บันทึกไว้ ("เครื่องเป็น v26 ทำให้เทสต์ health ล้ม", EPERM/timeout ทั้งชุด) — ยึดผล CI
