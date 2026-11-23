# HANDOFF — สถานะล่าสุดสำหรับเครื่องมือใดก็ได้ที่เพิ่งเปิด repo

> อัปเดต: 2026-11-23 18:30 (เวลาไทย) โดย secretary (Antigravity · Claude Opus 5.5 · branch `fix/post-v1-polish`) · ตรวจกับ `git log`, `CHANGELOG.md`, `package.json`
> **กติกา:** ใครจบงาน (Claude Code หรือ Antigravity ก็ได้) ให้อัปเดตไฟล์นี้ในรอบเดียวกับงานนั้น · ไฟล์นี้เป็นสรุป หลักฐานจริงอยู่ที่ git/PR

## 1. Production
- เวอร์ชันบน prod: **v1.0.0** · tag `v1.0.0` → commit `c906d09` (`chore(release): v1.0.0`) ✔ ตรวจด้วย `git rev-parse v1.0.0^{commit}`
- `package.json` = 1.0.0 · CHANGELOG `[1.0.0] - 2026-11-23` (`[Unreleased]` มี F18 บน branch นี้) ✔
- โหมด: **maintenance mode** (ดู `docs/NEXT_PHASE.md`) ไม่มีรอบ R ใหม่โดยค่าเริ่มต้น · งานที่เข้ามาคือแก้บั๊ก/security ตามรายงาน และงานที่ boss ตัดสินแล้ว
- `/api/health` บน prod = **1.0.0** (main ตรวจ 2026-11-23 · qa ตรวจซ้ำด้วย `curl` ใน `qa-release-1.0.0.md`)

## 2. Pull Request
| PR | หัวข้อ | สถานะ (ตรวจจาก `git log` 2026-11-23) |
|---|---|---|
| #42 | R18 แชร์นัดให้คนนอกกลุ่ม → v1.0.0 | MERGED (`1b07381`) |
| #43 | docs post-release v1.0.0 (R18 closed) | MERGED (`29534c2`) |
| #44 | DUALTOOL (`docs/antigravity-team`) Claude Code + Antigravity | MERGED (`55469e5`) |
| branch `fix/post-v1-polish` | F18 `guest.goingHint` (หน้าแขก + การ์ดแขกบนหน้าหลัก) + eslint worktree ignore + อัปเดต HANDOFF | QA รอบแรก (Claude Opus 5.5) ผ่านแบบมีข้อสังเกต `qa-post-v1-polish.md` · แก้ข้อ 🟡 หน้าหลักแล้ว (Claude Opus 5.5) · **รอ QA รอบสอง (แชตใหม่ Gemini) ตรวจส่วนหน้าหลัก ก่อนเปิด PR** |

- **งานค้างหลักยึด `docs/team/PROGRESS.md` ส่วน "เหลือ"** (ถ้าขัดกันให้ยึด PROGRESS)

## 3. สถานะรายการ R18 / หลัง 1.0 (ตรวจกับ git)
| ข้อ | งาน | สถานะ |
|---|---|---|
| 1 | G1 แบนเนอร์ติดตั้ง iOS + V5 UI polish (`V1_UI_AUDIT.md`) | อยู่บน main แล้ว (`a2438b0` แก้ F01–F20 ยกเว้น F18) ✔ · **F18 (`guest.goingHint`) แก้แล้วบน branch `fix/post-v1-polish`** |
| 2 | G2 Lighthouse มือถือ | qa วัดบน local prod build ผ่านทั้ง 3 หน้า (`qa-r18.md`, calendar 87) · preview จริงติด SSO |
| 3 | V2 qa + V3 security + ops release docs | qa `qa-r18.md` ผ่านแบบมีข้อสังเกต · security `security-v1.md` ผ่าน (`3c7d8c2`) · ops `d45abce` อยู่บน main ✔ |
| 4 | migration 0007 (`appointment_share_link` + `appointment_guest`) | อยู่บน main ✔ · **boss รันแล้วทั้ง preview (2026-11-22) และ prod (2026-11-23 ก่อน merge #42)** ✔ |
| 5 | PR #42/#43/#44 + tag `v1.0.0` | เสร็จครบตาม git · `main` ในเครื่อง pull ถึง `55469e5` แล้ว ✔ |

## 4. งานต้องให้ boss ทำเอง
- เช็กลิสต์เครื่องจริง: [r18-boss-device-checklist.md](../reports/r18-boss-device-checklist.md) (LINE ในแอป, แบนเนอร์ iOS, iPad, Apple Maps 768) · **ยังไม่มีผลจด**
- ตรวจ header `/i/<token>` บน prod ด้วย token จริง (qa ตรวจเฉพาะ token ปลอม)
- เปิดแชตใหม่ใน Antigravity ด้วย **Gemini** (คนละโมเดลกับผู้แก้รอบล่าสุด Claude Opus 5.5) เพื่อตรวจ QA รอบสองของ `fix/post-v1-polish` — เน้น commit แก้หน้าหลัก (`HomeView.tsx` + เทสต์) · ต่อท้ายผลใน `docs/reports/qa-post-v1-polish.md`

## 5. รอบปัจจุบัน
- **`fix/post-v1-polish`** (ระดับ A · Antigravity · Gemini 4 Neon) — แก้ F18 (`guest.goingHint` TH/EN + `RsvpControl` + `GuestAppointmentView` + test), เพิ่ม `.claude/worktrees/**` ใน `eslint.config.mjs`, เพิ่ม `CHANGELOG.md` `[Unreleased]`, อัปเดต `HANDOFF.md`/`PROGRESS.md`/`2026-11-23.md`
- ล้าง worktree ค้างจาก Claude Code ใน `.claude/worktrees/` และ prune แล้ว (`npm run lint` กลับมาทำงานปกติ)
- QA รอบแรก (Claude Opus 5.5 · แชตใหม่) ผ่านแบบมีข้อสังเกต → boss เลือกแก้ใน branch นี้: `HomeView.tsx` ใช้ `guest.goingHint` เมื่อ `isGuestItem(a)` + เทสต์ใน `tests/ui/share-render.test.ts` (ยืนยันแล้วว่าเทสต์ล้มเมื่อถอดการแก้)

## 6. วิธีเริ่มงานถัดไป
- **Claude Code:** อ่าน `CLAUDE.md` → `docs/team/TEAM.md` → `docs/team/PROCESS.md` → contract ของรอบ → ไฟล์นี้
- **Antigravity:** อ่าน `AGENTS.md` ก่อน (หรือ `.agent/rules/maewmeet.md`) แล้วต่อที่ `CLAUDE.md` · `docs/team/PROGRESS.md`
- ระดับงาน A / B / C ตาม `AGENTS.md` §3 — ระดับ B ต้องผ่าน Claude Code `security` ก่อน boss merge
- ทุกงานมี contract (ระดับ A ใช้ contract ย่อใน PR) → branch → PR → **หยุด** · ห้าม push `main` · ห้าม merge · ห้าม tag/release
- ประตูสุดท้ายเป็นของ boss: merge และรัน `npx tsx scripts/release.ts <เลข>` แล้ว push tag เอง

## 7. กติกาที่ไม่เปลี่ยน
- อีเมล commit ต้องเป็น noreply `309017158+ieatbaozi-stack@users.noreply.github.com` (อีเมลปลอมทำให้ Vercel ไม่ deploy)
- ห้ามใส่ค่าลับ (token, pepper, secret) ในไฟล์นี้หรือในแชท
