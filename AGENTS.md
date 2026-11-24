# AGENTS.md — กติกาสำหรับ AI ทุกเครื่องมือที่ทำงานใน repo maewmeet

ผู้อ่าน: AI ใน Claude Code, Antigravity (Opus/Gemini) หรือเครื่องมืออื่น · กติกาเดียวกันทุกเครื่องมือ · คุยกับ boss เป็นภาษาไทย สั้น ตรง ไม่ฟุ้ง
ต้นฉบับกติกาละเอียด: [CLAUDE.md](CLAUDE.md) · [docs/team/PROCESS.md](docs/team/PROCESS.md) · [docs/prd/PRD.md](docs/prd/PRD.md) · สถานะงาน [docs/team/PROGRESS.md](docs/team/PROGRESS.md) · สถานะส่งต่อล่าสุด [docs/team/HANDOFF.md](docs/team/HANDOFF.md) · ทีม [docs/team/TEAM.md](docs/team/TEAM.md) · เอกสารตาม [docs/contracts/DOCS_SYNC_CONTRACT.md](docs/contracts/DOCS_SYNC_CONTRACT.md)
ถ้าไฟล์นี้ขัดกับ CLAUDE.md ให้ยึด CLAUDE.md แล้วแจ้ง boss · โฟลเดอร์ `Pre-start/` อ่านได้ ห้ามแก้ ห้ามอ้างแทนเอกสารที่ root

## 1. กฎเหล็ก (ย่อ — ละเมิดแล้วงานถูกตีกลับ)
1. ไม่มี contract ไม่มีโค้ด (`docs/contracts/*_CONTRACT.md` · ระดับ A เล็กมากใช้ "contract ย่อ" ในคำอธิบาย PR: เป้าหมาย · ไฟล์ · เกณฑ์ผ่าน)
2. แตะเฉพาะไฟล์ในขอบเขตบทบาท (§4) ต้องแก้นอกขอบเขต → หยุดแล้วถาม/แจ้ง
3. เทสต์มาพร้อมโค้ดในงานเดียวกัน
4. ตรวจงานตัวเองก่อนส่ง แนบ Handoff Certificate (แม่แบบใน PROCESS.md) พร้อมผลคำสั่งจริง · ห้ามเขียนว่า "ผ่าน" ถ้าไม่ได้รัน ห้ามแต่งตัวเลข
5. คนทำกับคนตรวจเป็นคนละคน/คนละโมเดล (§6)
6. สิทธิ์ตรวจที่เซิร์ฟเวอร์เสมอ (ซ่อนปุ่มใน UI ไม่นับ) ผ่าน policy กลางใน `src/lib/rbac/**`
7. ความลับอยู่ใน env เท่านั้น · `.env.example` ไม่มีค่าจริง · ห้าม log PIN/token/hash · ห้ามให้ boss ส่งค่าลับในแชท
8. Schema เปลี่ยนด้วย migration แบบมีเวอร์ชัน (Drizzle) เท่านั้น · ห้ามเดาข้อมูลในฐานจริง
9. เวลา/วันที่: เก็บ UTC + วันที่ท้องถิ่นแยก (ดีฟอลต์ Asia/Bangkok) ใช้ `src/lib/calendar` เท่านั้น ห้ามคำนวณวันด้วย string/`new Date()`
10. ส่งงานเป็น PR แล้วหยุด: ทำบน branch แยก · ห้ามทำ/commit/push บน `main` · ห้าม merge PR เอง · ห้ามสร้าง tag/release — boss merge และออกรุ่นเอง

UI มี 2 ภาษา (ไทย/อังกฤษ) × 2 ธีม (สว่าง/มืด) — ห้าม hard-code ข้อความในคอมโพเนนต์ ทั้งสองภาษาต้องเป็นธรรมชาติ ไม่แปลตรงตัว (ดู [docs/design/UI_DIRECTION.md](docs/design/UI_DIRECTION.md))

## 2. เรื่องที่ boss ตัดสินแล้ว (ไม่ต้องถามซ้ำ)
- อีเมล commit ต้องเป็น `309017158+ieatbaozi-stack@users.noreply.github.com` เท่านั้น — อีเมลปลอมทำให้ Vercel ไม่ deploy
- Migration: รันกับ boss บน preview ก่อนเปิด PR และบน prod ก่อน merge แล้วค่อยบอกว่าพร้อม merge
- ลบถาวรใน UI ต้องยืนยันแบบพิมพ์คำ (type-to-confirm) ห้ามกดครั้งเดียว
- เอกสารตาม DOCS_SYNC ครบใน PR งานหลักเลย · ตอนออกรุ่น `scripts/release.ts` ขยับเลขรุ่นในเอกสารหลักทั้ง 5 ไฟล์ให้ใน commit เดียว (**ไม่เปิด PR เอกสารตามหลัง release** และ **ไม่เปิด PR เพื่อจด `/api/health`** — `keepalive.yml` ตรวจอัตโนมัติ)
- ประหยัด token ได้เฉพาะวิธีที่ไม่ลดคุณภาพ ห้ามข้ามเทสต์/ผู้ตรวจ · เปิดแชตใหม่ต่อรอบ
- boss merge และออกรุ่นเอง: `npx tsx scripts/release.ts <ver> --skip-gates` แล้ว push tag · AI เสนอเลขเวอร์ชันได้ (ดู [docs/VERSIONING.md](docs/VERSIONING.md)) แต่รันได้เฉพาะ `--dry-run`

## 3. ระดับงาน — ทำที่ไหน ใครตรวจ
| ระดับ | ตัวอย่าง | ทำที่ | ผู้ตรวจ |
|---|---|---|---|
| A ทั่วไป | UI, ข้อความ TH/EN, bug, เทสต์, เอกสาร, CI/ops, logic ที่ไม่แตะ `src/app/api/**` | Antigravity ทั้งรอบ | แชตใหม่ **คนละโมเดลกับคนทำ** (Opus ทำ → Gemini ตรวจ หรือสลับ) ตามเช็กลิสต์ qa + Code review (§6) |
| B เสี่ยง | เพิ่ม/แก้ route ใน `src/app/api/**`, แตะ `src/lib/auth/**`, `src/lib/rbac/**`, `src/app/api/auth/**`, schema/migration, ข้อมูลคน (busy, share link, guest), ความลับ | ทำใน Antigravity ได้ | ระดับ A + **Claude Code `security` agent 1 ครั้ง** ก่อน boss merge · migration ต้องรันกับ boss ตาม §2 |
| C ใหญ่ | ฟีเจอร์ใหม่หลายส่วน, ADR ใหม่, รื้อโครง, เปลี่ยนเวอร์ชันหลัก | Claude Code (ทีม agent เต็ม) | ตาม PROCESS.md |

ระดับ A = งานที่ไม่แตะ `src/app/api/**`, `src/lib/auth|rbac/**`, schema/migration, ข้อมูลคน, ความลับ เลย · ไม่แน่ใจว่าระดับไหน → ใช้ระดับสูงกว่า หรือถาม boss

## 4. บทบาท → ขอบเขตไฟล์ (จริงอยู่ที่ `.claude/agents/<บทบาท>.md`)
| บทบาท | model (Claude Code) | ขอบเขตไฟล์ |
|---|---|---|
| architect | opus | `docs/adr/**`, `docs/design/ARCHITECTURE.md`, `docs/research/**` |
| ux | sonnet | `docs/design/**` (ยกเว้น ARCHITECTURE.md), `src/styles/tokens*`, `src/components/brand/**`, `public/brand/**`, เนื้อหา `messages/*.json` |
| platform | opus | `src/db/**`, `drizzle/**`, `drizzle.config.ts`, `src/instrumentation.ts`, `src/lib/data/**`, `src/lib/shared/**`, `src/lib/calendar/**`, `src/lib/integrations/**`, `src/app/api/**` (ยกเว้น `auth`, `health`), `tests/calendar/**` |
| frontend | sonnet | `src/app/**` (ไม่รวม api), `src/components/**` (ไม่รวม brand), `src/i18n/**`, `src/styles/**` (ไม่รวม tokens), เพิ่มคีย์ `messages/*.json` |
| auth | opus | `src/lib/auth/**`, `src/lib/rbac/**`, `src/app/api/auth/**` |
| ops | sonnet | `.github/**`, `next.config.ts`, `vercel.json`, `scripts/pepper-fingerprint.ts`, `scripts/admin-reset-pin.ts`, `.env.example`, `.nvmrc`, `src/app/api/health/**`, `docs/OPERATIONS.md`, `CHANGELOG.md` (ส่วน Unreleased), `docs/VERSIONING.md`, `scripts/release*.ts` |
| test | sonnet | `tests/**` (ยกเว้น `tests/calendar/**`), `vitest.config.ts`, `playwright.config.ts` |
| qa | sonnet | ผู้ตรวจอิสระ: รายงาน `docs/reports/qa-<รอบ>.md` + แก้บั๊ก/a11y เล็กที่ได้รับมอบ |
| security | opus | ผู้ตรวจอิสระ: รายงาน `docs/reports/security-<รอบ>.md` เท่านั้น ไม่แก้โค้ด |
| secretary | haiku | `docs/team/**` (รวม `PROGRESS.md`), `docs/reports/**` (ยกเว้น `qa-*.md`, `security-*.md`) |

ไฟล์ที่ไม่มีเจ้าของ (เช่น `package.json`, `tsconfig.json`, config lint) และ `docs/contracts/**`, `docs/prd/**` (เจ้าของคือ main/ผู้ประสานงาน) → ให้ contract ของรอบระบุผู้แก้ ไม่ใช่แก้เองตามใจ

## 5. วิธีสวมบทบาท (เครื่องมือที่ไม่มี sub-agent เช่น Antigravity)
Claude Code เรียก sub-agent แยกตัวได้ แต่เครื่องมืออื่นไม่มี — ให้ AI ตัวเดียวสวมบทบาททีละช่วงแทน:
1. ดูรายการไฟล์ที่จะแก้ → เทียบกับตาราง §4 → เลือกบทบาทที่เป็นเจ้าของไฟล์นั้น (แตะหลายบทบาท = ทำทีละบทบาท commit แยกตามผู้เขียน)
2. อ่าน `.claude/agents/<บทบาท>.md` ทั้งไฟล์ (ขอบเขตไฟล์ เช็กลิสต์เฉพาะบทบาท และข้อห้ามของบทบาทนั้น)
3. ทำงานตามเช็กลิสต์ของบทบาทนั้น เทสต์มาพร้อมโค้ด แล้วแนบ Handoff Certificate
4. commit ด้วย `user.name=<บทบาท>` (ข้อ git ใน §7)
5. ต้องแก้ไฟล์นอกขอบเขตของบทบาทที่สวมอยู่ → หยุด ระบุใน PR/ถาม boss ว่าให้บทบาทใดแก้ อย่าแก้เงียบๆ
6. ห้ามสวมบทบาทตรวจ (qa/security) กับงานที่ตัวเองเพิ่งเขียนในแชตเดียวกัน — ดู §6

## 6. ผู้ตรวจ
- เปิด **แชตใหม่ คนละโมเดลกับคนทำ** (ไม่ใช่แชตเดิมที่เพิ่งเขียนโค้ด) · อ่าน contract/คำอธิบาย PR + `git diff main...HEAD` แล้ว **รันคำสั่งตรวจซ้ำเอง ไม่เชื่อใบรับรองของผู้ทำ**
- ใช้เช็กลิสต์ใน `.claude/agents/qa.md` (รวมหัวข้อ "Code review" 9 ข้อและระดับ 🔴/🟡/🟢) · งานที่แตะ auth/rbac/api/schema/ข้อมูลคน ให้ไล่แบบ `.claude/agents/security.md` ด้วย
- เขียนรายงาน `docs/reports/qa-<รอบ>.md` (ดูตัวอย่าง `docs/reports/qa-r18.md`) — verdict: ผ่าน / ผ่านแบบมีข้อสังเกต / ไม่ผ่าน · ข้อพบเรียงตามความรุนแรง ระบุ `ไฟล์:บรรทัด` + สถานการณ์ที่พังจริง · บอกสิ่งที่ตรวจไม่ได้
- ระดับ B: ต้องให้ Claude Code `security` agent ตรวจอีก 1 ครั้งก่อน boss merge (บอก boss ให้เปิดเซสชัน Claude Code)
- ผู้ตรวจแก้ได้เฉพาะบั๊ก/a11y เล็กที่ได้รับมอบ (commit `qa: …`) การแก้ใหญ่/เปลี่ยนพฤติกรรมให้รายงานกลับ

## 7. git
- branch แยกต่อ 1 contract (ชื่อแนว `feat/r19-xxx`, `docs/xxx`, `fix/xxx`) · ห้าม commit บน `main` · push เฉพาะ branch ตัวเอง
- commit แบบ conventional: `feat:` `fix:` `qa:` `docs:` `chore:` `test:`
- ผู้เขียน = ชื่อบทบาท + อีเมล noreply ของ boss:
  `git -c user.name=<บทบาท> -c user.email=309017158+ieatbaozi-stack@users.noreply.github.com commit -m "feat: ..."`
- trailer ท้าย message แยกสองกรณี:
  - **commit จาก Claude Code (ทีม agent)** ใช้ trailer ที่ main ให้มาในแต่ละรอบ — ธรรมเนียมโปรเจกต์คือ `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` เหมือนกันทุกบทบาท (ไม่ต้องเปลี่ยนตามโมเดลของ agent นั้น)
  - **commit จาก Antigravity** ใช้ **ชื่อโมเดลที่ใช้จริงในแชตนั้น** ห้ามอ้างโมเดลที่ไม่ได้ใช้ ตามผู้ให้บริการ เช่น `Co-Authored-By: <ชื่อโมเดลจริง> <noreply@anthropic.com>` (Claude) · `Co-Authored-By: <ชื่อโมเดลจริง> <noreply@google.com>` (Gemini)
- อย่าใช้ `git add -A` เมื่อมีหลายแชตทำงาน worktree เดียวกัน — ระบุไฟล์ของตัวเอง · ห้าม `git stash`/สลับ branch ถ้าไม่ได้รับมอบ
- เปิด PR แล้ว **หยุด** · คำอธิบาย PR ต้องมี: เปลี่ยนอะไร · ผลเทสต์จริง (คำสั่ง + ผลลัพธ์) · ผลตรวจจากผู้ตรวจอิสระ · หัวข้อ "เอกสาร" ตาม DOCS_SYNC · ระดับงาน (A/B/C) และโมเดลที่ใช้ทำ/ตรวจ

## 8. คำสั่งตรวจคุณภาพ (ทุกคำสั่งอยู่ใน `package.json`)
| เกต | คำสั่ง |
|---|---|
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Unit/Integration (เฉพาะไฟล์) | `npx vitest run <ไฟล์> --reporter=agent` (ล้มเห็น assertion/expected/received เต็ม · ผ่านเหลือบรรทัดสรุปเดียว) |
| Unit/Integration (ทั้งชุด) | `npm test` — รันชุดที่เกี่ยวข้องเต็มหนึ่งครั้งก่อนส่ง |
| Build | `npm run build` |
| E2E (Playwright, viewport 375/390/768) | `npm run test:e2e -- --reporter=line` |
| Migration | `npm run db:generate` (สร้าง) · `npm run db:check` (ตรวจ) |
| เอกสารตรงของจริง | `npx vitest run tests/ops/docs-sync.test.ts tests/ops/operations-doc.test.ts --reporter=agent` |
ระหว่างทำรันเฉพาะไฟล์ที่กระทบ · ก่อนส่งรันชุดที่เกี่ยวข้องเต็มหนึ่งครั้ง · Handoff ต้องแนบผลคำสั่งจริง

## 9. ข้อจำกัดเครื่อง Windows ของ boss (ปัญหาเดิม — รายงานตามจริง ยึดผล CI)
- checkout เป็น CRLF ทำให้ `tests/security/config-hygiene.test.ts` ข้อ permissions ล้ม
- `tests/release` ส่วน CLI ล้มเพราะ `.bin/tsx` ENOENT
- `npm test` ทั้งชุดมี EPERM/timeout จำนวนมาก
- ความล้มเหลวเหล่านี้ให้อ้างถึง ไม่ต้องสืบซ้ำ และห้ามแก้เทสต์/config เพื่อให้ผ่านบนเครื่องเดียว · ผลจริงดูจาก CI (`.github/workflows/ci.yml`)

## 10. เมื่อไม่แน่ใจ
ความต้องการกำกวมหรือขัดกัน → หยุดแล้วถาม boss อย่าเดาแล้วทำต่อ · เจอบั๊กนอกขอบเขต → จดไว้ใน PR หรือแจ้ง boss ไม่แอบแก้ · วนแก้ประเด็นเดิมเกิน 3 รอบ → หยุดแล้วถาม (อาจเป็นปัญหาที่ contract ไม่ใช่โค้ด)
