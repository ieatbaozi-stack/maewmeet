# HANDOFF — สถานะล่าสุดสำหรับเครื่องมือใดก็ได้ที่เพิ่งเปิด repo

> อัปเดต: 2026-11-23 โดย secretary (รอบ DUALTOOL T5–T7) · ตรวจกับ `git log`, `gh pr view`, CHANGELOG, `package.json`
> **กติกา:** ใครจบงาน (Claude Code หรือ Antigravity ก็ได้) ให้อัปเดตไฟล์นี้ในรอบเดียวกับงานนั้น · ไฟล์นี้เป็นสรุป หลักฐานจริงอยู่ที่ git/PR

## 1. Production
- เวอร์ชันบน prod: **v1.0.0** · tag `v1.0.0` → commit `c906d09` (`chore(release): v1.0.0`) ✔ ตรวจด้วย `git rev-parse v1.0.0^{commit}`
- `package.json` = 1.0.0 · CHANGELOG `[1.0.0] - 2026-11-23` ✔
- โหมด: **maintenance mode** (ดู `docs/NEXT_PHASE.md`) ไม่มีรอบ R ใหม่โดยค่าเริ่มต้น · งานที่เข้ามาคือแก้บั๊ก/security ตามรายงาน และงานที่ boss ตัดสินแล้ว
- `/api/health` บน prod = **1.0.0** (main ตรวจ 2026-11-23 · qa ตรวจซ้ำด้วย `curl` ใน `qa-release-1.0.0.md`)

## 2. Pull Request
| PR | หัวข้อ | สถานะ (gh ตรวจ 2026-11-23) |
|---|---|---|
| #42 | R18 แชร์นัดให้คนนอกกลุ่ม → v1.0.0 | MERGED (`1b07381`) |
| #43 | docs post-release v1.0.0 (R18 closed) | **MERGED** 2026-11-23 07:41Z — ไม่ได้เปิดอยู่แล้ว |
| PR DUALTOOL (`docs/antigravity-team`) | ใช้ Claude Code คู่ Antigravity | ยังไม่เปิด (main เปิดหลัง qa ผ่าน) |

- PR ที่เปิดอยู่ตอนนี้: ไม่มี (ตรวจ `gh pr list --state open` ได้ผลว่าง)
- PROGRESS.md บน main (หลัง #43) อัปเดตเป็น v1.0.0 แล้ว — **งานค้างให้ยึด `docs/team/PROGRESS.md` ส่วน "เหลือ"** ตารางข้างล่างเป็นสรุปเก่า ถ้าขัดกันให้ยึด PROGRESS

## 3. งานค้าง (จาก PROGRESS "เหลือ" + ตรวจกับ git)
| ข้อ | งาน | สถานะที่ตรวจได้ |
|---|---|---|
| 1 | G1 แบนเนอร์สอนติดตั้ง iOS | โค้ด `InstallHint.tsx` อยู่บน main แล้ว · ยืนยันซ้ำที่ PROGRESS |
| 2 | V5 แก้ UI ตาม `V1_UI_AUDIT.md` (20 ข้อ) | **ไม่ยืนยัน** (ไม่พบหลักฐาน commit แก้ครบ) |
| 3 | G2 Lighthouse มือถือ | qa บันทึกใน `qa-r18.md` ว่าผ่านทั้ง 3 หน้า (calendar ใกล้เส้น 87) · วัดบน preview จริงยังไม่ยืนยัน |
| 4 | V2 qa ถดถอยเต็ม | `qa-r18.md` verdict **ผ่านแบบมีข้อสังเกต** (2026-11-22) · ปิดรอบและออก v1.0.0 แล้ว (PROGRESS: CI บน `1b07381` เขียวตามที่ main แจ้ง) |
| 5 | security re-check R18 | `docs/reports/security-v1.md` ผ่าน (ตรวจซ้ำ `3c7d8c2`) ตาม PROGRESS |
| 6 | งาน ops (CHANGELOG/OPERATIONS/VERSIONING) | commit `d45abce` อยู่บน main ✔ · ผู้ตรวจอิสระยังไม่ยืนยัน |
| 7 | migration 0007 (`appointment_share_link` + `appointment_guest`) | ไฟล์ `drizzle/0007_r18_appointment_share.sql` อยู่บน main ✔ · **boss รันแล้วทั้ง preview (2026-11-22) และ prod (2026-11-23 ก่อน merge #42)** ✔ |
| 8 | PR → merge → release | ทำแล้วตาม git (PR #42 merged · tag v1.0.0) ✔ |

## 4. งานต้องให้ boss ทำเอง
- เช็กลิสต์เครื่องจริง: [r18-boss-device-checklist.md](../reports/r18-boss-device-checklist.md) (LINE ในแอป, แบนเนอร์ iOS, iPad, Apple Maps 768) · **ยังไม่มีผลจด**
- ยืนยัน migration 0007 บน prod (ถ้ายังไม่ได้ทำ) และ rollback ใน `docs/OPERATIONS.md` ส่วน S8
- ตรวจ Antigravity ว่าเห็น `AGENTS.md` หรือ `.agent/rules/maewmeet.md` (DUALTOOL §8)

## 5. รอบปัจจุบัน
- **DUALTOOL** — ใช้ Claude Code คู่ Antigravity + ดึงแม่แบบ TEAM กลับ · contract [DUALTOOL_CONTRACT.md](../contracts/DUALTOOL_CONTRACT.md) (boss เห็นชอบ 2026-11-23)
- T1 `AGENTS.md`, T2 `.agent/rules/maewmeet.md`, T3 `CLAUDE.md`, T4 `qa.md` → ops · T5–T7 TEAM/PROCESS/HANDOFF → secretary (ไฟล์นี้)
- `AGENTS.md`, `.agent/rules/maewmeet.md` อยู่ใน branch นี้แล้ว (ตรวจโดย qa — ดู `docs/reports/qa-dualtool.md`)

## 6. วิธีเริ่มงานถัดไป
- **Claude Code:** อ่าน `CLAUDE.md` → `docs/team/TEAM.md` → `docs/team/PROCESS.md` → contract ของรอบ → ไฟล์นี้
- **Antigravity:** อ่าน `AGENTS.md` ก่อน (หรือ `.agent/rules/maewmeet.md` ที่ชี้มา) แล้วต่อที่ `CLAUDE.md` · `docs/team/PROGRESS.md`
- ระดับงาน A (ทั่วไป) / B (เสี่ยง: auth/rbac/schema/ข้อมูลคน) / C (ใหญ่) ตาม DUALTOOL §3 — ระดับ B ต้องผ่าน security ก่อน boss merge
- ทุกงานมี contract (ระดับ A ใช้ contract ย่อในคำอธิบาย PR) → branch → PR → **หยุด** · ห้าม push `main` · ห้าม merge · ห้าม tag/release
- ประตูสุดท้ายเป็นของ boss: boss merge และรัน `npx tsx scripts/release.ts <เลข>` แล้ว push tag เอง

## 7. กติกาที่ไม่เปลี่ยน
- อีเมล commit ต้องเป็น noreply `309017158+ieatbaozi-stack@users.noreply.github.com` (อีเมลปลอมทำให้ Vercel ไม่ deploy)
- ห้ามใส่ค่าลับ (token, pepper, secret) ในไฟล์นี้หรือในแชท
