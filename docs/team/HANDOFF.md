# HANDOFF — สถานะล่าสุดสำหรับเครื่องมือใดก็ได้ที่เพิ่งเปิด repo

> อัปเดต: 2026-11-23 20:02 (เวลาไทย) โดย secretary (Antigravity · Gemini 4 Neon · branch `docs/ics-import-contract`) · ตรวจกับ `git log`, `gh pr view 47`, `docs/contracts/ICS_IMPORT_CONTRACT.md`
> **กติกา:** ใครจบงาน (Claude Code หรือ Antigravity ก็ได้) ให้อัปเดตไฟล์นี้ในรอบเดียวกับงานนั้น · ไฟล์นี้เป็นสรุป หลักฐานจริงอยู่ที่ git/PR

## 1. Production
- เวอร์ชันล่าสุดที่ออกแล้ว: **v1.0.1** · tag `v1.0.1` → commit `80856c2` (`chore(release): v1.0.1`) ✔ ตรวจด้วย `git rev-parse v1.0.1^{commit}` · CI บน `main` (`45174826022`) ผ่าน ✔
- `package.json` = `1.0.1` · CHANGELOG `[1.0.1] - 2026-11-23` (`[Unreleased]` ว่าง) ✔
- โหมด: **maintenance mode** (ดู `docs/NEXT_PHASE.md`) ไม่มีรอบ R ใหม่โดยค่าเริ่มต้น · งานที่เข้ามาคือแก้บั๊ก/security ตามรายงาน และงานที่ boss ตัดสินแล้ว
- `/api/health` บน prod: **ยืนยันแล้วเป็น `1.0.1`** (2026-11-23 19:43 · `ok:true`, `db:true`, `argon2:true`, `pepper.ok:true`, `node:v24.22.3`, heartbeat vercelCron 17.07h / githubActions 5.17h) ✔
- header `/i/<token ปลอม>` บน prod `v1.0.1`: `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` · `X-Robots-Tag: noindex, nofollow` ✔ (token จริงบน prod ยังไม่ได้ลอง)

## 2. Pull Request
| PR | หัวข้อ | สถานะ (ตรวจจาก `git log` 2026-11-23) |
|---|---|---|
| #42 | R18 แชร์นัดให้คนนอกกลุ่ม → v1.0.0 | MERGED (`1b07381`) → tag `v1.0.0` (`c906d09`) |
| #43 | docs post-release v1.0.0 (R18 closed) | MERGED (`29534c2`) |
| #44 | DUALTOOL (`docs/antigravity-team`) Claude Code + Antigravity | MERGED (`55469e5`) |
| #45 | `fix/post-v1-polish`: F18 `guest.goingHint` (หน้าแขก + หน้าหลัก) + eslint worktree ignore | MERGED (`68c181d`) → tag `v1.0.1` (`80856c2`) |
| #46 | `docs/release-1.0.1`: เอกสารหลังออกรุ่น v1.0.1 | MERGED (`e71f62c`) |
| #47 | `docs/v1.0.1-verify`: ยืนยัน deploy v1.0.1 + ปิดหมายเหตุ F18 ใน `V1_UI_AUDIT.md` | MERGED (`f5b23ab`) |

- **งานค้างหลักยึด `docs/team/PROGRESS.md` ส่วน "เหลือ"** (ถ้าขัดกันให้ยึด PROGRESS)

## 3. สถานะรายการ R18 / หลัง 1.0 (ตรวจกับ git)
| ข้อ | งาน | สถานะ |
|---|---|---|
| 1 | G1 แบนเนอร์ติดตั้ง iOS + V5 UI polish (`V1_UI_AUDIT.md`) | เสร็จครบ F01–F20 (`a2438b0` บน v1.0.0 + F18 `guest.goingHint` ใน PR #45 `68c181d` บน **v1.0.1** · ปิดหมายเหตุ F18 ใน `V1_UI_AUDIT.md` แล้วใน PR #47) ✔ |
| 2 | G2 Lighthouse มือถือ | qa วัดบน local prod build ผ่านทั้ง 3 หน้า (`qa-r18.md`, calendar 87) · preview จริงติด SSO |
| 3 | V2 qa + V3 security + ops release docs | qa `qa-r18.md` ผ่านแบบมีข้อสังเกต · security `security-v1.md` ผ่าน (`3c7d8c2`) · ops `d45abce` อยู่บน main ✔ |
| 4 | migration 0007 (`appointment_share_link` + `appointment_guest`) | อยู่บน main ✔ · **boss รันแล้วทั้ง preview (2026-11-22) และ prod (2026-11-23 ก่อน merge #42)** ✔ |
| 5 | PR #42–#47 + tag `v1.0.0`, `v1.0.1` | เสร็จครบตาม git · `main` ถึง `f5b23ab` แล้ว ✔ |

## 4. งานต้องให้ boss ทำเอง
- เช็กลิสต์เครื่องจริง: [r18-boss-device-checklist.md](../reports/r18-boss-device-checklist.md) (LINE ในแอป, แบนเนอร์ iOS, iPad, Apple Maps 768) · **ยังไม่มีผลจด**
- ตรวจ header `/i/<token>` บน prod ด้วย token จริง (ตรวจแล้วเฉพาะ token ปลอม)

## 5. รอบปัจจุบัน
- **งานถัดไปที่มี contract อนุมัติแล้ว:** **นำเข้าไฟล์ `.ics` เป็นเวลาไม่ว่าง (v1.1.0 · ระดับ C · ไม่มี migration)** — ดู [docs/contracts/ICS_IMPORT_CONTRACT.md](../contracts/ICS_IMPORT_CONTRACT.md) (branch `docs/ics-import-contract` · boss อนุมัติ 2026-11-23, B1–B4 = ค่าแนะนำ (ก) ทั้ง 4 ข้อ)
- **ขั้นถัดไปเมื่อ contract merge แล้ว:** เปิดรอบงานโค้ด `feat/ics-import` จาก `main` ล่าสุด — แนะนำทำใน **Claude Code (ทีม agent เต็ม)** ตาม `AGENTS.md` §3 (เริ่มจาก `architect` เขียน ADR 0017 + `ux` เขียน `docs/design/ICS_IMPORT.md`) · บังคับผ่าน `qa` + Claude Code `security` agent ก่อน boss merge
- งานใหม่รอบถัดไปให้เปิดแชตใหม่ต่อรอบตาม `AGENTS.md` §2

## 6. วิธีเริ่มงานถัดไป
- **Claude Code:** อ่าน `CLAUDE.md` → `docs/team/TEAM.md` → `docs/team/PROCESS.md` → contract ของรอบ → ไฟล์นี้
- **Antigravity:** อ่าน `AGENTS.md` ก่อน (หรือ `.agent/rules/maewmeet.md`) แล้วต่อที่ `CLAUDE.md` · `docs/team/PROGRESS.md`
- ระดับงาน A / B / C ตาม `AGENTS.md` §3 — ระดับ B ต้องผ่าน Claude Code `security` ก่อน boss merge
- ทุกงานมี contract (ระดับ A ใช้ contract ย่อใน PR) → branch → PR → **หยุด** · ห้าม push `main` · ห้าม merge · ห้าม tag/release
- ประตูสุดท้ายเป็นของ boss: merge และรัน `npx tsx scripts/release.ts <เลข>` แล้ว push tag เอง

## 7. กติกาที่ไม่เปลี่ยน
- อีเมล commit ต้องเป็น noreply `309017158+ieatbaozi-stack@users.noreply.github.com` (อีเมลปลอมทำให้ Vercel ไม่ deploy)
- ห้ามใส่ค่าลับ (token, pepper, secret) ในไฟล์นี้หรือในแชท
