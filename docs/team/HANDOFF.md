# HANDOFF — สถานะล่าสุดสำหรับเครื่องมือใดก็ได้ที่เพิ่งเปิด repo

> อัปเดต: 2026-11-24 (เวลาไทย) โดย secretary (Antigravity / Gemini 4 Neon · branch `fix/post-v1.1-polish`) · ตรวจจาก main `a36b9b2`, `git log`, `git tag`, `CHANGELOG.md`, `docs/reports/r18-boss-device-checklist.md`
> **กติกา:** ใครจบงาน (Claude Code หรือ Antigravity ก็ได้) ให้อัปเดตไฟล์นี้ในรอบเดียวกับงานนั้น · ไฟล์นี้เป็นสรุป หลักฐานจริงอยู่ที่ git/PR

## 1. Production
- เวอร์ชันล่าสุดที่ออกแล้ว: **v1.1.0** · tag `v1.1.0` → commit `87f7db0` (`chore(release): v1.1.0`, 2026-11-24) ✔
- `package.json` = `1.1.0` · CHANGELOG `[1.1.0] - 2026-11-24` ✔ (`[Unreleased]` มีรายการ polish ของ `fix/post-v1.1-polish`)
- การยืนยันบน production (boss · 2026-11-24): หน้าเว็บปกติ · `/api/health` เป็น `1.1.0` · เช็กลิสต์เครื่องจริง R18 ผ่านครบ 6 ข้อ (`r18-boss-device-checklist.md`) · ทดสอบนำเข้าไฟล์ `.ics` จริงผ่าน ✔
- header `/i/<token>` บน prod `v1.0.1` (token ปลอม): `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` · `X-Robots-Tag: noindex, nofollow` ✔ (boss ตัดสินใจข้ามการยิง `curl` ด้วย token จริง 2026-11-24 เพราะ UI จริงผ่านแล้ว)
- โหมด: **maintenance mode** (ดู `docs/NEXT_PHASE.md`) ไม่มีรอบ R ใหม่โดยค่าเริ่มต้น · งานที่เข้ามาคือแก้บั๊ก/security ตามรายงาน และงานที่ boss ตัดสินแล้ว

## 2. Pull Request
| PR | หัวข้อ | สถานะ (ตรวจจาก `git log` / `gh pr list` 2026-11-24) |
|---|---|---|
| #42 | R18 แชร์นัดให้คนนอกกลุ่ม → v1.0.0 | MERGED (`1b07381`) → tag `v1.0.0` (`c906d09`) |
| #43 | docs post-release v1.0.0 (R18 closed) | MERGED (`29534c2`) |
| #44 | DUALTOOL (`docs/antigravity-team`) Claude Code + Antigravity | MERGED (`55469e5`) |
| #45 | `fix/post-v1-polish`: F18 `guest.goingHint` + eslint worktree ignore | MERGED (`68c181d`) → tag `v1.0.1` (`80856c2`) |
| #46 | `docs/release-1.0.1`: เอกสารหลังออกรุ่น v1.0.1 | MERGED (`e71f62c`) |
| #47 | `docs/v1.0.1-verify`: ยืนยัน deploy v1.0.1 + ปิดหมายเหตุ F18 | MERGED (`f5b23ab`) |
| #48 | `docs/ics-import-contract`: สัญญา `ICS_IMPORT_CONTRACT.md` (v1.1.0) | MERGED (`65ccfa9`) |
| #49 | `feat/ics-import`: นำเข้าไฟล์ .ics เป็นเวลาไม่ว่าง (v1.1.0) | MERGED (`2d2b93b`) → tag `v1.1.0` (`87f7db0`) · `gh pr checks 49` ทุกรายการ pass |
| #50 | `docs/release-1.1.0`: เอกสารหลังออกรุ่น v1.1.0 (DOCS_SYNC §3) | MERGED (`b5a2c3d`) |
| #51 | `docs/handoff-1.1.0`: ปรับ HANDOFF + หัวรายงาน qa-ics-import | MERGED (`a36b9b2`) |

- **งานค้างหลักยึด `docs/team/PROGRESS.md` ส่วน "เหลือ"** (ถ้าขัดกันให้ยึด PROGRESS)

## 3. สถานะรายการ R18 / หลัง 1.0 (ตรวจกับ git)
| ข้อ | งาน | สถานะ |
|---|---|---|
| 1 | G1 แบนเนอร์ติดตั้ง iOS + V5 UI polish (`V1_UI_AUDIT.md`) | เสร็จครบ F01–F20 (F18 ใน v1.0.1) ✔ · ยืนยันเครื่องจริงแล้ว ✔ |
| 2 | G2 Lighthouse มือถือ | qa วัดบน local prod build ผ่านทั้ง 3 หน้า (`qa-r18.md`, calendar 87) · preview จริงติด SSO |
| 3 | V2 qa + V3 security + ops release docs | qa `qa-r18.md` ผ่านแบบมีข้อสังเกต · security `security-v1.md` ผ่าน (`3c7d8c2`) ✔ |
| 4 | migration 0007 (`appointment_share_link` + `appointment_guest`) | อยู่บน main ✔ · boss รันแล้วทั้ง preview (2026-11-22) และ prod (2026-11-23 ก่อน merge #42) ✔ |
| 5 | PR #42–#51 + tag `v1.0.0`, `v1.0.1`, `v1.1.0` | เสร็จครบตาม git ✔ |
| 6 | นำเข้าไฟล์ .ics (v1.1.0 · ไม่มี migration) | ออกรุ่นแล้ว 2026-11-24 (PR #49 · tag `v1.1.0`) ✔ · boss ยืนยัน `/api/health` + `.ics` จริงบน prod แล้ว ✔ |

## 4. งานต้องให้ boss ทำเอง
- ~~เช็กลิสต์เครื่องจริง R18~~ ✔ ผ่านครบ 6 ข้อ (2026-11-24 · `r18-boss-device-checklist.md`) · ~~`curl` header token จริง~~ ข้ามตามการตัดสินใจของ boss
- เปิดแชตใหม่ (คนละโมเดลกับ Gemini 4 Neon) ให้ **QA อิสระ** ตรวจ branch `fix/post-v1.1-polish` → แล้วเปิด PR / กด Merge

## 5. รอบปัจจุบัน
- **กำลังเปิด branch `fix/post-v1.1-polish` (ระดับ A · ยังไม่เปิด PR รอ QA อิสระ):** ทำโดย Antigravity (Gemini 4 Neon) — ปิดปุ่มเลือกเร็ว `IcsImportSheet` ตอนซ้ำหมด/โควตาเป็น 0/ไม่ได้เลือก (+ unit/E2E test), แก้ bind param ADR 0017 (`809 < 999`), จดผลทดสอบเครื่องจริง R18/v1.1.0 และซิงก์เอกสาร · **ถัดไป: QA อิสระคนละโมเดล (`AGENTS.md` §6) → เปิด PR**
- **บทเรียนที่ยึดใช้:** PR จาก Antigravity ต้องตรวจว่าไม่ค้าง Draft ก่อนให้ boss merge · บน Windows รอ CI บน `main` เขียวแล้วค่อยออกรุ่นด้วย `--skip-gates`

## 6. วิธีเริ่มงานถัดไป
- **Claude Code:** อ่าน `CLAUDE.md` → `docs/team/TEAM.md` → `docs/team/PROCESS.md` → contract ของรอบ → ไฟล์นี้
- **Antigravity:** อ่าน `AGENTS.md` ก่อน (หรือ `.agent/rules/maewmeet.md`) แล้วต่อที่ `CLAUDE.md` · `docs/team/PROGRESS.md`
- ระดับงาน A / B / C ตาม `AGENTS.md` §3 — ระดับ B ต้องผ่าน Claude Code `security` ก่อน boss merge
- ทุกงานมี contract (ระดับ A ใช้ contract ย่อใน PR) → branch → PR → **หยุด** · ห้าม push `main` · ห้าม merge · ห้าม tag/release
- ประตูสุดท้ายเป็นของ boss: merge และรัน `npx tsx scripts/release.ts <เลข>` แล้ว push tag เอง

## 7. กติกาที่ไม่เปลี่ยน
- อีเมล commit ต้องเป็น noreply `309017158+ieatbaozi-stack@users.noreply.github.com` (อีเมลปลอมทำให้ Vercel ไม่ deploy)
- ห้ามใส่ค่าลับ (token, pepper, secret) ในไฟล์นี้หรือในแชท
