# DUALTOOL_CONTRACT.md — ใช้ Claude Code คู่กับ Antigravity + อัปเดตทีมจาก TEAM template

> สถานะ: **boss เห็นชอบแล้ว 2026-11-23** · เอกสารล้วน ไม่มีโค้ดแอป ไม่ต้องออกรุ่น
> ที่มา: boss 2026-11-23 — usage limit ของ Claude Code เต็มไว จะใช้ Antigravity (Opus 5.5 + Gemini) ทำงานส่วนใหญ่หลัง v1.0.0 และอยากให้ทั้งสองเครื่องมือทำงานร่วมกันได้มากกว่างาน UI เล็กๆ · และให้ตรวจว่า `TEAM_maewmeet.md` (แม่แบบที่ให้เพื่อน มี techlead) มีอะไรควรดึงกลับเข้า repo

## 1. เป้าหมาย
1. Antigravity เปิด repo แล้วรู้กติกาเดียวกับ Claude Code โดย boss ไม่ต้องอธิบายซ้ำ
2. แบ่งงานชัด: งานไหนทำใน Antigravity ได้เลย งานไหนต้องมี Claude Code ร่วม
3. ข้อมูลที่ตอนนี้อยู่นอก repo (memory ของ Claude Code, handoff note) ที่ทุกเครื่องมือต้องรู้ → ย้ายเข้า repo
4. ดึงส่วนที่ดีจากแม่แบบ TEAM กลับมา โดยไม่ทำให้ซ้ำซ้อนหรือเปลือง token เพิ่ม

## 2. การตัดสินใจ (main เสนอ · boss เห็นชอบ)
- **D1 ไม่เพิ่ม agent `techlead`** — ใน maewmeet หน้าที่ของ techlead ซ้อนกับ qa (รันซ้ำ+ตรวจตาม contract) และ security อยู่แล้ว เพิ่มเป็นอีกขั้น opus ทุกรอบ = เปลือง token สวนทางเป้า · **แต่ดึง "Code Review Checklist" 9 ข้อของ techlead มาใส่** (a) ไฟล์ qa และ (b) ใช้เป็นเช็กลิสต์ของผู้ตรวจฝั่ง Antigravity
- **D2 รูปแบบไฟล์กติกา** — ต้นฉบับเดียวที่ `AGENTS.md` (root) · `.agent/rules/maewmeet.md` เป็นไฟล์สั้นชี้ไป AGENTS.md (เผื่อ Antigravity เวอร์ชันที่อ่านแค่ rules folder) · `CLAUDE.md` คงเดิมแต่เพิ่มลิงก์ไป AGENTS.md
- **D3 ระดับงานใน Antigravity** (ดู §3)

## 3. แบ่งงานระหว่างเครื่องมือ (ใส่ใน AGENTS.md)
| ระดับ | ตัวอย่าง | ทำที่ | ผู้ตรวจ |
|---|---|---|---|
| A — ทั่วไป | UI, ข้อความ TH/EN, bug, เทสต์, เอกสาร, CI/ops, API/logic ที่ไม่แตะสิทธิ์ | Antigravity ทั้งรอบ | แชตใหม่ใน Antigravity **คนละโมเดลกับคนทำ** (Opus ทำ → Gemini ตรวจ หรือสลับ) ตามเช็กลิสต์ qa + review |
| B — เสี่ยง | แตะ `src/lib/auth/**`, `src/lib/rbac/**`, `api/auth`, schema/migration, ข้อมูลคน (busy, share link, guest), ความลับ | ทำใน Antigravity ได้ | ระดับ A + **Claude Code `security` agent 1 ครั้ง** ก่อน boss merge · migration ยังต้องรันกับ boss บน preview ก่อนเปิด PR และ prod ก่อน merge |
| C — ใหญ่ | ฟีเจอร์ใหม่หลายส่วน, ADR ใหม่, รื้อโครง, เปลี่ยนเวอร์ชันหลัก | Claude Code (ทีม agent เต็ม) | ตาม PROCESS เดิม |

ทุกระดับใช้กติกาเดิม: contract ก่อนโค้ด (ระดับ A เล็กมาก ใช้ "contract ย่อ" ในคำอธิบาย PR ได้: เป้าหมาย · ไฟล์ · เกณฑ์ผ่าน) · ทำบน branch → PR → หยุด · ผู้เขียน commit = ชื่อบทบาทที่ตรงกับไฟล์ที่แก้ + อีเมล noreply · ผลเทสต์จริงใน PR · เอกสารตาม DOCS_SYNC

## 4. งานและเจ้าของไฟล์
| # | ไฟล์ | ผู้แก้ | เนื้อหา |
|---|---|---|---|
| T1 | `AGENTS.md` (ใหม่, root) | ops | กติกาสำหรับทุกเครื่องมือ AI: ลิงก์ CLAUDE.md/PROCESS/PRD/PROGRESS · กฎเหล็ก 10 ข้อแบบย่อ · §3 ระดับงาน · บทบาท→ขอบเขตไฟล์ (สรุปจาก `.claude/agents/`) และวิธี "สวมบทบาท" ใน Antigravity · คำสั่งตรวจคุณภาพ (lint/typecheck/test `--reporter=agent`/build/e2e `--reporter=line`) · git: branch, author, อีเมล, trailer ตามโมเดลที่ใช้จริง · เรื่องที่ boss ตัดสินแล้ว (§5) · ข้อจำกัดเครื่อง Windows · ≤ ~200 บรรทัด |
| T2 | `.agent/rules/maewmeet.md` (ใหม่) | ops | ≤ 10 บรรทัด: "อ่าน AGENTS.md ก่อนทำอะไร" + 3 กฎที่ห้ามพลาด (ห้าม push main/merge/tag · อีเมล noreply · ห้าม log ความลับ) |
| T3 | `CLAUDE.md` | ops | เพิ่ม 1 บรรทัดชี้ AGENTS.md + แก้ข้อความ "TEAM.md เป็นต้นฉบับ ไม่แก้" ให้ตรงกับ T5 |
| T4 | `.claude/agents/qa.md` | ops | เพิ่มหัวข้อ "Code review" = เช็กลิสต์ 9 ข้อจากแม่แบบ techlead (ตรง contract · ถูกจริง · สถาปัตยกรรม/ADR · คุณภาพโค้ด · คุณภาพเทสต์ · กฎเหล็ก · N+1/โหลดซ้ำ · เอกสาร · ความปลอดภัยที่เห็นชัด) + ระดับ 🔴/🟡/🟢 |
| T5 | `docs/team/TEAM.md` | secretary | ตารางให้ตรง agent จริง 10 ตัว + คอลัมน์ model + แผนผัง workflow "ใครส่งต่อใคร" (จากแม่แบบ §4 ตัด techlead) + ตารางเจ้าของเอกสาร · ย้ายตาราง 16 บทบาทเดิมไปหัวข้อ "ประวัติ" |
| T6 | `docs/team/PROCESS.md` | secretary | เพิ่ม: กฎวนแก้ (>3 รอบประเด็นเดิม → ถาม boss) · เส้นทางงานเอกสารล้วน · เช็กลิสต์ main ก่อนเปิด PR (แม่แบบ §9) · บทเรียน (แม่แบบ §13) · ลิงก์ AGENTS.md §3 |
| T7 | `docs/team/HANDOFF.md` (ใหม่) | secretary | สถานะล่าสุดสำหรับเครื่องมือใดก็ได้ที่เพิ่งเปิด repo: เวอร์ชันบน prod, PR ที่เปิดอยู่, งานค้าง (ดึงจาก PROGRESS "เหลือ"), วิธีเริ่มรอบถัดไป · ≤ 60 บรรทัด · กติกา: ใครจบงาน (เครื่องมือไหนก็ได้) อัปเดตไฟล์นี้ |

ไม่แตะ: โค้ดแอป, เทสต์, `docs/team/PROGRESS.md` (รอ PR #43 merge ก่อน เลี่ยง conflict)

## 5. เรื่องที่ boss ตัดสินแล้ว (ย้ายจาก memory เข้า AGENTS.md)
- อีเมล commit ต้องเป็น `309017158+ieatbaozi-stack@users.noreply.github.com` ไม่งั้น Vercel ไม่ deploy
- migration: รันกับ boss บน preview ก่อนเปิด PR และบน prod ก่อน merge
- ลบถาวรใน UI ต้องยืนยันแบบพิมพ์คำ ห้ามกดครั้งเดียว
- เอกสารตาม DOCS_SYNC ทุก PR และหลังออกรุ่น โดย boss ไม่ต้องเตือน
- ประหยัด token ได้เฉพาะวิธีที่ไม่ลดคุณภาพ (ห้ามข้ามเทสต์/ผู้ตรวจ)
- boss merge และออกรุ่นเอง (`npx tsx scripts/release.ts <ver> --skip-gates` แล้ว push tag)

## 6. ผู้ตรวจ
- qa: เอกสารตรงกับของจริง (ทุกบทบาท/path/คำสั่งใน AGENTS.md มีอยู่จริงและรันได้) · ไม่มีความลับ · ไม่ขัดกับ CLAUDE.md/PROCESS
- security: ไม่ต้อง (ไม่แตะ auth/api/schema)

## 7. เกณฑ์ผ่าน
1. `AGENTS.md`, `.agent/rules/maewmeet.md`, `docs/team/HANDOFF.md` มีอยู่ · AGENTS.md ≤ ~200 บรรทัด
2. ทุก path ที่อ้างใน AGENTS.md มีจริง (`git ls-files` ตรวจ) · ทุกคำสั่งมีใน `package.json`
3. ไม่มีข้อความขัดกันระหว่าง AGENTS.md / CLAUDE.md / PROCESS.md (qa ไล่)
4. TEAM.md ตรงกับ `.claude/agents/*.md` ทั้งชื่อ ขอบเขต และ model
5. `npm run lint` และเทสต์ docs-sync (`tests/**/docs-sync*`) ผ่าน
6. PR มีหัวข้อ "เอกสาร" ตาม DOCS_SYNC และระบุ agent ที่ใช้

## 8. สิ่งที่ boss ต้องทำ
- เปิด Antigravity ที่ repo แล้วดูหน้า Rules/Customizations ว่าเห็น `AGENTS.md` หรือ `.agent/rules/maewmeet.md` (ยืนยันกับของจริง ผมไม่ยืนยันเวอร์ชันของ Antigravity)
- ส่งไฟล์แม่แบบเวอร์ชันใหม่ให้เพื่อน (ถ้าต้องการ) — ไม่อยู่ใน contract นี้
