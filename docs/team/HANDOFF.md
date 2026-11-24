# HANDOFF — สถานะล่าสุดสำหรับเครื่องมือใดก็ได้ที่เพิ่งเปิด repo

> อัปเดต: 2026-11-24 (เวลาไทย) โดย secretary (Claude Code · branch `docs/handoff-1.1.0`) · ตรวจจาก main `b5a2c3d` กับ `git log`, `git tag`, `gh pr view 50`, `gh pr checks 49`, `CHANGELOG.md`, `docs/reports/qa-ics-import.md`, `docs/reports/security-ics-import.md`
> **กติกา:** ใครจบงาน (Claude Code หรือ Antigravity ก็ได้) ให้อัปเดตไฟล์นี้ในรอบเดียวกับงานนั้น · ไฟล์นี้เป็นสรุป หลักฐานจริงอยู่ที่ git/PR

## 1. Production
- เวอร์ชันล่าสุดที่ออกแล้ว: **v1.1.0** · tag `v1.1.0` → commit `87f7db0` (`chore(release): v1.1.0`, 2026-11-24) ✔ ตรวจด้วย `git rev-parse v1.1.0^{commit}`
- `package.json` = `1.1.0` · CHANGELOG `[1.1.0] - 2026-11-24` ✔ · การแก้ CHANGELOG ของ ops commit แล้ว `26d7548` และอยู่ใน main แล้ว ✔
- หน้าเว็บ production หลัง v1.1.0: boss ตรวจแล้ว 2026-11-24 ว่าปกติ · `/api/health` บน prod หลัง v1.1.0: **boss ตรวจแล้ว 2026-11-24 ว่าถูกต้อง เป็น version `1.1.0`** (ฟิลด์อื่นใน JSON ยังไม่ได้ระบุ) · ครั้งก่อนหน้าที่ยืนยันแล้วคือ v1.0.1 (2026-11-23 19:43 · `ok:true`, `db:true`, `argon2:true`, `pepper.ok:true`)
- header `/i/<token ปลอม>` บน prod `v1.0.1`: `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` · `X-Robots-Tag: noindex, nofollow` ✔ (token จริงบน prod ยังไม่ได้ลอง)
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

- **งานค้างหลักยึด `docs/team/PROGRESS.md` ส่วน "เหลือ"** (ถ้าขัดกันให้ยึด PROGRESS)

## 3. สถานะรายการ R18 / หลัง 1.0 (ตรวจกับ git)
| ข้อ | งาน | สถานะ |
|---|---|---|
| 1 | G1 แบนเนอร์ติดตั้ง iOS + V5 UI polish (`V1_UI_AUDIT.md`) | เสร็จครบ F01–F20 (F18 ใน v1.0.1) ✔ |
| 2 | G2 Lighthouse มือถือ | qa วัดบน local prod build ผ่านทั้ง 3 หน้า (`qa-r18.md`, calendar 87) · preview จริงติด SSO |
| 3 | V2 qa + V3 security + ops release docs | qa `qa-r18.md` ผ่านแบบมีข้อสังเกต · security `security-v1.md` ผ่าน (`3c7d8c2`) ✔ |
| 4 | migration 0007 (`appointment_share_link` + `appointment_guest`) | อยู่บน main ✔ · boss รันแล้วทั้ง preview (2026-11-22) และ prod (2026-11-23 ก่อน merge #42) ✔ |
| 5 | PR #42–#47 + tag `v1.0.0`, `v1.0.1` | เสร็จครบตาม git ✔ |
| 6 | นำเข้าไฟล์ .ics (v1.1.0 · ไม่มี migration) | ออกรุ่นแล้ว 2026-11-24 (PR #49 · tag `v1.1.0`) ✔ · ยืนยันบน production ยังไม่ได้ทำ |

## 4. งานต้องให้ boss ทำเอง
- เช็กลิสต์เครื่องจริง: [r18-boss-device-checklist.md](../reports/r18-boss-device-checklist.md) (LINE ในแอป, แบนเนอร์ iOS, iPad, Apple Maps 768) · **ยังไม่มีผลจด**
- ตรวจ header `/i/<token>` บน prod ด้วย token จริง (ตรวจแล้วเฉพาะ token ปลอม)
- ~~ยืนยัน `/api/health` บน prod ว่าเป็น `1.1.0`~~ ✔ เสร็จแล้ว: boss ยืนยัน 2026-11-24 (ดู §1)

## 5. รอบปัจจุบัน
- **ไม่มีรอบพัฒนาเปิดอยู่** · v1.1.0 ออกแล้ว (2026-11-24) · เอกสารหลังออกรุ่น v1.1.0 merge แล้ว (PR #50 · `b5a2c3d`) · ไม่มีรอบเปิดค้าง · รอบถัดไปเริ่มจาก `git pull` ที่ main และ contract ใหม่
- **บทเรียนจากรอบ ICS (ตามที่ main แจ้ง):**
  - PR จาก Antigravity อาจเปิดเป็น **Draft** → ต้องกด Ready for review ก่อน boss merge
  - บน Windows `release.ts` เกตเทสต์ล้มเพราะปัญหาเครื่อง (EPERM / Python) → รอ CI บน `main` เขียวก่อน แล้วใช้ `--skip-gates` ตามที่ main กำหนด
- ~~**ข้อสังเกตเอกสาร:** `docs/reports/qa-ics-import.md` หัวรายงานยังเป็น "ไม่ผ่าน" ของรอบ 1 · รอ qa แก้หัวรายงาน~~ ✔ เสร็จแล้ว: qa แก้หัวรายงาน `46d2caf` (2026-11-24) · หัวรายงานแสดง "Verdict ล่าสุด: รอบ 2 ผ่าน (`12f5120`)"

## 6. วิธีเริ่มงานถัดไป
- **Claude Code:** อ่าน `CLAUDE.md` → `docs/team/TEAM.md` → `docs/team/PROCESS.md` → contract ของรอบ → ไฟล์นี้
- **Antigravity:** อ่าน `AGENTS.md` ก่อน (หรือ `.agent/rules/maewmeet.md`) แล้วต่อที่ `CLAUDE.md` · `docs/team/PROGRESS.md`
- ระดับงาน A / B / C ตาม `AGENTS.md` §3 — ระดับ B ต้องผ่าน Claude Code `security` ก่อน boss merge
- ทุกงานมี contract (ระดับ A ใช้ contract ย่อใน PR) → branch → PR → **หยุด** · ห้าม push `main` · ห้าม merge · ห้าม tag/release
- ประตูสุดท้ายเป็นของ boss: merge และรัน `npx tsx scripts/release.ts <เลข>` แล้ว push tag เอง

## 7. กติกาที่ไม่เปลี่ยน
- อีเมล commit ต้องเป็น noreply `309017158+ieatbaozi-stack@users.noreply.github.com` (อีเมลปลอมทำให้ Vercel ไม่ deploy)
- ห้ามใส่ค่าลับ (token, pepper, secret) ในไฟล์นี้หรือในแชท
