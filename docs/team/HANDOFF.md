# HANDOFF — สถานะล่าสุดสำหรับเครื่องมือใดก็ได้ที่เพิ่งเปิด repo

> อัปเดต: 2026-11-25 (เวลาไทย) โดย secretary (Antigravity / Gemini 4 Neon · branch `feat/v1.2-ics-rrule`) · ตรวจจาก `origin/main` `fcbccd6`, `git log`, `git tag`, `gh pr list`
> **กติกา:** อัปเดตไฟล์นี้พร้อม PR งานหลัก · เมื่อ boss รัน `scripts/release.ts <ver>` สคริปต์จะขยับเลขรุ่นในไฟล์นี้ให้อัตโนมัติ (ไม่ต้องเปิด PR เอกสารตามหลัง release หรือ PR จด `/api/health`)

## 1. Production
- เวอร์ชันล่าสุดที่ออกแล้ว: **v1.1.1** (ปรับเลขรุ่นอัตโนมัติโดย `scripts/release.ts` · ดูประวัติและ tag จริงใน `CHANGELOG.md` และ `git tag`)
- รุ่นที่ยืนยันบน prod ล่าสุด: **v1.1.1** (tag `v1.1.1` → `7f4c853`, 2026-11-25) — boss ยืนยัน `/api/health = 1.1.1` และผู้ใช้จริงใช้งานปกติ
- `/api/health` บน prod: `.github/workflows/keepalive.yml` ตรวจอัตโนมัติทุก 12 ชม. — ไม่ต้องเปิด PR แยกเพื่อจดผลอีก (boss อนุมัติ 2026-11-25)
- โหมด: **maintenance mode** (ดู `docs/NEXT_PHASE.md`) · งานที่ทำคือแก้บั๊ก/security และงานที่ boss เห็นชอบแล้ว

## 2. Pull Request
| PR | หัวข้อ | สถานะ (ตรวจจาก `git log` / `gh pr view` 2026-11-25) |
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
| #52 | `fix/post-v1.1-polish`: ปิดปุ่มเลือกเร็ว ICS + ADR 0017 (809) + ผลเครื่องจริง | MERGED (`6a18e09`) → tag `v1.1.1` (`7f4c853`) · `gh pr checks 52` 12/12 pass |
| #53 | `docs/release-1.1.1`: เอกสารหลังออกรุ่น v1.1.1 | MERGED (`fcbccd6`) · CI main pass (`45456461197`) |

- **งานค้างหลักยึด `docs/team/PROGRESS.md` ส่วน "เหลือ"** (ถ้าขัดกันให้ยึด PROGRESS)
- **ล้าง branch เก่าแล้ว (2026-11-25):** ลบ local 53 + remote 53 branch ที่ merge เข้า `main` แล้ว (ไม่แตะ `main` และ `docs/public-scan` ที่ยังไม่ merge)

## 3. สถานะรายการ R18 / หลัง 1.0 (ตรวจกับ git)
| ข้อ | งาน | สถานะ |
|---|---|---|
| 1 | G1 แบนเนอร์ติดตั้ง iOS + V5 UI polish (`V1_UI_AUDIT.md`) | เสร็จครบ F01–F20 (F18 ใน v1.0.1) ✔ · ยืนยันเครื่องจริงแล้ว ✔ |
| 2 | G2 Lighthouse มือถือ | qa วัดบน local prod build ผ่านทั้ง 3 หน้า (`qa-r18.md`, calendar 87) · preview จริงติด SSO |
| 3 | V2 qa + V3 security + ops release docs | qa `qa-r18.md` ผ่านแบบมีข้อสังเกต · security `security-v1.md` ผ่าน (`3c7d8c2`) ✔ |
| 4 | migration 0007 (`appointment_share_link` + `appointment_guest`) | อยู่บน main ✔ · boss รันแล้วทั้ง preview (2026-11-22) และ prod (2026-11-23 ก่อน merge #42) ✔ |
| 5 | PR #42–#52 + tag `v1.0.0`, `v1.0.1`, `v1.1.0`, `v1.1.1` | เสร็จครบตาม git ✔ |
| 6 | นำเข้าไฟล์ .ics (v1.1.0 + patch v1.1.1 · ไม่มี migration) | ออกรุ่นแล้ว (PR #49 `v1.1.0` · PR #52 `v1.1.1`) ✔ · boss ยืนยัน `/api/health` + `.ics` จริงบน prod ที่ v1.1.0 แล้ว ✔ |

## 4. งานต้องให้ boss ทำเอง
- ส่ง PR `feat/v1.2-ics-rrule` (ระดับ B · ไม่มี migration) ให้ **QA แชตใหม่** และ **Claude Code `security` agent** ตรวจ 1 รอบก่อนกด Merge
- หลัง Merge และ CI บน `main` เขียว: ออกรุ่น **v1.2.0** (`npx tsx scripts/release.ts 1.2.0 --skip-gates` แล้ว push `main` + `v1.2.0`) — จบใน commit เดียว ไม่ต้องเปิด PR เอกสารตามหลัง

## 5. รอบปัจจุบัน
- **รอบ v1.2.0 (`feat/v1.2-ics-rrule` · [V1_2_CONTRACT.md](../contracts/V1_2_CONTRACT.md) · ระดับ B · ไม่มี migration):** อัปเกรด `.ics` import รองรับ `RRULE` (`DAILY`/`WEEKLY`/`MONTHLY`) + `EXDATE` + `RECURRENCE-ID`, บังคับ `END:VCALENDAR` (H1), ตรวจ actor+ด่านบัญชีก่อนอ่าน body > 64 KB ใน `route.ts` (H2/Security L1), ขยาย `scripts/release.ts` ขยับเลขรุ่นครบ 5 ไฟล์เอกสาร และยกเลิก PR เอกสารตามหลัง release + ล้าง branch เก่าแล้ว
- **บทเรียนที่ยึดใช้:** PR จาก Antigravity ต้องตรวจว่าไม่ค้าง Draft ก่อนให้ boss merge · บน Windows รอ CI บน `main` เขียวแล้วค่อยออกรุ่นด้วย `--skip-gates` · หลังรัน `scripts/release.ts` ต้อง `git push origin main` และ `git push origin vX.Y.Z` ครบทั้งสองคำสั่ง · ไม่เปิด PR เอกสารตามหลัง release และไม่เปิด PR จด `/api/health`

## 6. วิธีเริ่มงานถัดไป
- **Claude Code:** อ่าน `CLAUDE.md` → `docs/team/TEAM.md` → `docs/team/PROCESS.md` → contract ของรอบ → ไฟล์นี้
- **Antigravity:** อ่าน `AGENTS.md` ก่อน (หรือ `.agent/rules/maewmeet.md`) แล้วต่อที่ `CLAUDE.md` · `docs/team/PROGRESS.md`
- ระดับงาน A / B / C ตาม `AGENTS.md` §3 — ระดับ B ต้องผ่าน Claude Code `security` ก่อน boss merge
- ทุกงานมี contract (ระดับ A ใช้ contract ย่อใน PR) → branch → PR → **หยุด** · ห้าม push `main` · ห้าม merge · ห้าม tag/release
- ประตูสุดท้ายเป็นของ boss: merge และรัน `npx tsx scripts/release.ts <เลข>` แล้ว push tag เอง

## 7. กติกาที่ไม่เปลี่ยน
- อีเมล commit ต้องเป็น noreply `309017158+ieatbaozi-stack@users.noreply.github.com` (อีเมลปลอมทำให้ Vercel ไม่ deploy)
- ห้ามใส่ค่าลับ (token, pepper, secret) ในไฟล์นี้หรือในแชท
