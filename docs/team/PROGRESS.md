# PROGRESS — ความคืบหน้า maewmeet

> ผู้ดูแล: `secretary` (อัปเดตทุกครั้งที่จบขั้นตอนสำคัญ) · รายละเอียด: [CHANGELOG.md](../../CHANGELOG.md) · งานถัดไป: [docs/NEXT_PHASE.md](../NEXT_PHASE.md)
> อัปเดตล่าสุด: 2026-11-10 (เวลาไทย) · **R11 ผ่านรีวิวอิสระแล้ว รอเปิด PR** · **R10 (F6) merge แล้ว (PR #26) และออก v0.11.0 แล้ว** · ตรวจด้วย `git log origin/main`, `git tag`, `git rev-list -n1 v0.11.0` (= `a77fc50`) และ `CHANGELOG.md` หัวข้อ `[0.11.0] - 2026-11-10` · ผลการทดสอบ LINE และ `/api/health` = ที่ boss รายงาน (เลขาไม่ได้ตรวจเอง) · รายงานวัน: `docs/reports/2026-11-10.md` · ก่อนหน้า: `docs/contracts/R10_CONTRACT.md`, `docs/reports/qa-r10.md`, `security-r10.md`, `docs/reports/2026-11-09.md`

## เสร็จแล้ว
- R0–R5: foundation, บัญชี PIN, กลุ่ม, ปฏิทิน + busy, วันว่างร่วม + สร้างนัด, หน้า super admin + audit log (ดู CHANGELOG)
- ออก **v0.7.0** (2026-10-28) · ออก **v0.7.1** (2026-11-01) รวม R6A + R6B
- CI-1: artifact Playwright อัปโหลดเฉพาะตอนเทสต์ล้ม (PR #10) · R6A (PR #11) · R6B (PR #13)
- ทีม agent v2: 10 บทบาทใน `.claude/agents/` (PR #14)
- **R6C merge แล้ว** (PR #15, merge commit `4990f3e`, 2026-11-01) — F3ก ตั้งสี/รูปทรงของตัวเองต่อกลุ่ม · migration `0002` (`color_slot`/`shape_slot`) · qa ผ่าน (`docs/reports/qa-r6c.md`) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6c.md`)
- **migration `0002` รันแล้ว** (boss ยืนยัน 2026-11-02 ตามที่ main แจ้ง — เลขาไม่ได้ตรวจฐาน Turso เอง)
- **R6D merge แล้ว** (PR #16, merge commit `44dad19`, 2026-11-02) — G1 จำกลุ่มที่เลือกไว้ต่อเครื่อง · G2 ตอบ "ไป" = ไม่ว่างทุกกลุ่ม + popup ยืนยัน/เตือนนัดชน (ไม่บล็อก) · ไม่มี migration · ADR `docs/adr/0009-going-counts-as-busy.md`
  - ผลตรวจอิสระ: qa ผ่านแบบมีข้อสังเกต (`docs/reports/qa-r6d.md`, 0H/0M/4L) · security ผ่านแบบมีข้อสังเกต (`docs/reports/security-r6d.md`, 0C/0H/0M/2L/5I)
- **ออก v0.8.0 แล้ว** (2026-11-02, tag `v0.8.0`, commit `37271af` `chore(release): v0.8.0`) รวม R6C + R6D
- **R6E merge แล้ว** (PR #17, merge commit `b1daec1`, 2026-11-02 23:52 เวลาไทย) — E1–E12 ตาม `R6E_CONTRACT.md`
  - ผลตรวจอิสระ: qa **ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r6e.md`, 0H/0M/4L) · security **ผ่าน** (`docs/reports/security-r6e.md`, 0C/0H/0M/0L, Info 4)
  - **R6D L1/L2 ปิดแล้ว** · **F5 ปิดแล้ว** (boss เลือกคงข้อความ `privacy.draft` 2026-11-02 — ไม่แก้โค้ด)
- **ออก v0.8.1 แล้ว** (tag `v0.8.1` → commit `72d7881` `chore(release): v0.8.1`, 2026-11-03 03:10 เวลาไทย) รวม R6E · รอบนี้ไม่มี migration
- **ออก v0.10.0 แล้ว** (2026-11-09, tag `v0.10.0` → commit `d670fcc` `chore(release): v0.10.0`) รวม R8 · **repo เปลี่ยนเป็น public** (2026-11-08) · รายละเอียดหัวข้อ "v0.10.0 + repo public" ด้านล่าง
- **ออก v0.11.0 แล้ว** (2026-11-10, tag `v0.11.0` → commit `a77fc50` `chore(release): v0.11.0`) รวม **R10** (F6 เตือนก่อนนัดทาง LINE OA + กระดิ่ง, เชื่อม LINE, ปุ่มขั้น 2) · migration `0004` (รันหลัง merge — ดูหัวข้อ R10) · รายละเอียดด้านล่าง

## R11 — แจ้งเตือนเหตุการณ์นัดและสมาชิก + LINE ยกเลิกนัด — รีวิวผ่าน รอเปิด PR ⏳
- contract `docs/contracts/R11_CONTRACT.md` (main) · boss เห็นชอบขอบเขต 2026-11-10 · **ไม่มี migration**
- เนื้อหา: กระดิ่งเพิ่มเหตุการณ์นัด (ยกเลิก, เปลี่ยนเวลา/สถานที่, คำตอบนัดถึงผู้สร้าง), คำเชิญ (รับ/ปฏิเสธ), สมาชิกเข้า/ออก, ถูกนำออก, เปลี่ยนสิทธิ์, ผลรีเซ็ต PIN · LINE ส่งการยกเลิกนัดเฉพาะคนที่ตอบ "ไป" · การเลื่อนนัดไม่ส่ง LINE
- เอกสาร README และ quickstart อัปเดตแล้ว (commit `ee35fb8` บน branch เดียวกัน)
- ผลตรวจอิสระ: **qa ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r11.md`, ตรวจซ้ำที่ `0e0861c`, qa commit `63e6945`) · **security ผ่านแบบมีข้อสังเกต** (`docs/reports/security-r11.md`) · ไม่มี Critical/High/Medium เปิดอยู่ · M1 และ L1 แก้แล้ว
- ผลเทสต์ที่ qa รายงาน (รันในเครื่องท้องถิ่น ยังไม่ใช่ CI): tsc และ eslint exit 0 · Vitest ชุดที่เกี่ยว R11: pass 773 · EPERM-only 524 · assertion fail 0 · ที่เหลือ 3 รายการ = CRLF ของเครื่อง Windows 2 และ skip ตั้งใจ 1 · Playwright ชุดกระดิ่ง: 121 passed · 26 skipped · 0 failed · e2e เต็มชุดก่อนแก้เพดาน: 796 passed · 126 skipped · 2 failed (qa แก้แล้ว รันซ้ำผ่าน)
- สถานะ: รอเปิด PR · CI · boss merge · เสนอเลขเวอร์ชัน **v0.12.0** (ยังไม่ออกรุ่น)
- **ยังไม่ยืนยัน:** CI, Vercel preview, `after()` และการส่ง LINE จริง (R11-12 หลัง merge โดย boss และ main)
- backlog จาก security (ไม่บล็อก): Low 2 ชื่อ super admin ที่ไม่ได้เป็นสมาชิกปรากฏในกระดิ่งของกลุ่ม · Low 3 ไม่มีเพดานรวมของ LINE OA · Low 4 ชื่อนัด/ชื่อกลุ่มเป็นข้อความอิสระที่ออกทาง OA · Info 7 ไม่มี limiter การเข้า/ออกกลุ่มซ้ำ (เพดานจำกัดแถวกระดิ่ง ไม่ได้จำกัดการกระทำ)
- **ข้อเสนอ R12 "เพิ่มลงปฏิทินของเครื่อง":** ยังไม่เริ่ม รอ boss ตัดสิน

## R10 — F6 เตือนก่อนนัด (LINE OA + กระดิ่ง) + ปุ่มขั้น 2 — merge แล้ว (PR #26) · ออก v0.11.0 แล้ว (2026-11-10) ✅
- **merge แล้ว:** PR #26 (`feat/r10-line-reminders`) merge เป็น `dd6ff8e` เมื่อ 2026-11-09 23:39 เวลาไทย (รายงานโดย boss/main)
- **ออก v0.11.0 แล้ว:** tag `v0.11.0` → commit `a77fc50` `chore(release): v0.11.0` (ตรวจด้วย `git rev-list -n1 v0.11.0`) · หัวข้อ `[0.11.0] - 2026-11-10` ใน CHANGELOG · `/api/health` ตอบ `0.11.0` (boss รายงาน)
- **เหตุการณ์หลัง merge (boss รายงาน · ไม่มีข้อมูลหาย เพราะ migration เป็นการเพิ่มอย่างเดียว):**
  - migration `0004` **ยังไม่ได้รันก่อน merge** (ลำดับที่ OPERATIONS กำหนดคือรันก่อน merge) → หลัง merge production โหลดนัดไม่สำเร็จ ("โหลดนัดไม่สำเร็จ") จน boss รัน `0004` บน prod แล้วจึงรันบน preview
  - Schedule `reminders` รอบ 23:50 และ 00:05 ล้ม (รอบ 00:05 บันทึก HTTP 500 · ยังไม่ได้อ่านข้อความ error ที่แน่ชัด) · รอบ 00:20 และ 00:35 Completed
  - **บทเรียน:** ลำดับ "migration ก่อน merge" ถูกบังคับด้วยคำสั่งอย่างเดียว · process หรือ CI guard ที่ตรวจ migration ที่ยังไม่รันเป็นรายการ backlog ที่ควรพิจารณา
- **การตั้งค่า LINE (boss รายงาน):** long-lived token และ Channel secret เก็บใน Bitwarden · ตั้งใน Vercel Production แล้วและ redeploy · Webhook Verify Success · Use webhook เปิด · Webhook redelivery ปิด (ไม่มี webhookEventId dedupe) · Error statistics aggregation เปิดตามที่แนะนำ · หน้า Schedules ของ Vercel: เปิดด้วยการต่อ `/schedules` ท้าย URL โปรเจกต์ (boss หาเมนูไม่เจอ)
- **ทดสอบ LINE จริง R10-11 (boss รายงาน ผ่าน):** รหัสเชื่อมในแชท OA · ข้อความยืนยันการเชื่อม · `/me` แสดงว่าเชื่อมแล้ว · คำค้น `วิธีใช้งาน` ยังได้การ์ด · `สวัสดี` ไม่ได้รับการตอบ · เตือน 1 ชม. ของนัดเวลา 02:00 วันที่ 10 พ.ย. ถึง LINE เวลา 01:05 และถึงกระดิ่ง · เห็นแต่ละช่องทางหนึ่งครั้ง ไม่พบข้อความซ้ำ
- **ยังไม่ได้ทดสอบบน LINE จริง:** เตือน 1 วัน และ `rsvp_nudge`
- contract `docs/contracts/R10_CONTRACT.md` (`b529819`, main) · **boss เห็นชอบ 2026-11-09** ("เพิ่ม แล้วเริ่มเลย") · แก้ตามผลรีวิว: `4ca32a2`, `767d6cc` (เพดาน LINE จาก security M1)
- branch `feat/r10-line-reminders` · HEAD `87018b3` ตอนรีวิว (ก่อน merge ที่ `dd6ff8e`) · แตกจาก main · 21 commit · `git diff --stat main..HEAD`: 64 ไฟล์ +5901 / −34
- เนื้อหา: เตือน 1 วัน + 1 ชม. ในกระดิ่งและ LINE เฉพาะคนตอบ "ไป" · `rsvp_nudge` กระดิ่งอย่างเดียวสำหรับ "อาจไป"/ยังไม่ตอบ · เชื่อม LINE ที่แท็บ "ฉัน" (webhook, ยกเลิก) · เพดาน LINE (นัด+ชนิด+ผู้รับ ≤ 2 ใน 24 ชม. · ผู้รับ ≤ 6 ใน 24 ชม.) · ปุ่มขั้น 2 เปิดฟอร์มลงวันไม่ว่าง · migration `0004_r10_line_reminders.sql` (เพิ่มอย่างเดียว)
- **ผลตรวจอิสระ:**
  - qa **ผ่าน** (`docs/reports/qa-r10.md`) · รอบแรกผ่านแบบมีข้อสังเกต (M1 ถ้อยคำ "อีกวันเดียว" ตายตัว) → แก้แล้ว `999b471`/`a75d7e8` · ตรวจซ้ำ `87018b3`: M1 ปิด · e2e `tests/e2e/r10-reminders.spec.ts` 60 passed (ตามรายงาน qa)
  - security **ผ่านแบบมีข้อสังเกต** (`docs/reports/security-r10.md`) · Critical 0 · High 0 · Medium 0 (M1 เพดาน LINE แก้แล้ว `73d85ac`) · Low ที่เปิดเป็น backlog: L1 ลิงก์ในชื่อนัด/ชื่อกลุ่มที่ LINE ทำให้กดได้ · L3 เพดานเป็นต่อผู้รับ ยังไม่มีเพดานรวมของ OA · L2 แก้แล้ว
- ตัวเลขเทสต์ (ของ qa ไม่ใช่เลขาที่รันเอง): tsc/eslint/build ผ่าน · vitest ทั้งชุดหลังกลืน EPERM 4980 ผ่าน 4945 ล้ม 17 (ปัญหาเครื่อง Windows เดิม ไม่เกี่ยวกับ R10)
- ผู้ทำ (ตาม `git log main..HEAD`): platform 4 · main 3 · ops 3 · ux 3 · architect 2 · qa 2 · security 2 · frontend 1 · test 1
- **ยังไม่ยืนยัน:** CI ของ `a77fc50` (ตอนตรวจล่าสุดยังรันอยู่) · เตือน 1 วันและ `rsvp_nudge` บน LINE จริง · ผลเทสต์ในรอบนี้ของเลขา (เลขาไม่ได้รันเอง)
- ข้อสังเกตนอกขอบเขต (ไม่บล็อก): qa L2 Hobby Schedules มี jitter ~15 นาที (`reminder_1h` ยังทันถ้าพลาดไม่เกิน ~45 นาที) · qa L3 ภาพ fullPage ของ `/me` (อาการของเดิม) · security Info 5 แถว outbox `pending` ไม่ถูกลบตาม retention ถ้าเอา env LINE ออกหลังเข้าคิว · security Info 8 event ที่ล้มกลางทางตอบ 200 ไม่ retry
- **ขั้นของ boss (contract §8) ตามที่รายงาน:** migration `0004` รันแล้ว (prod ก่อน แล้ว preview · หลัง merge ตามเหตุการณ์ด้านบน) · token/env/webhook ตั้งแล้ว · ทดสอบ R10-11 ผ่านตามที่ระบุ · **ยังไม่มีข้อมูลว่าชวนเพื่อนแล้วหรือยัง**
- Backlog R10 (ไม่บล็อก): security L1 (ลิงก์ในชื่อนัด/ชื่อกลุ่มที่ LINE ทำให้กดได้ · เสนอกรองข้อความที่ออก LINE) · L3 (เพดานเป็นต่อผู้รับ ยังไม่มีเพดานรวมของ OA หรือการแจ้งเตือนโควตา) · ถ้า repo กลับเป็น private ต้องลด CI
- ข้อเสนอ backlog จากเหตุการณ์ migration: process หรือ CI guard ตรวจ migration ที่ยังไม่รันบนฐานก่อน merge (ยังไม่ตัดสิน)

## v0.10.0 ออกแล้ว + repo เป็น public — 2026-11-09 ✅
- **R8 merge แล้ว** (PR #21, merge commit `e41f9d2`, 2026-11-08) — `gh pr view 21`: MERGED, mergedAt 2026-11-08T02:58:10Z · F1 onboarding + แก้ข้อความ `/privacy` · **ไม่มี migration** · ผลตรวจอิสระ: qa ผ่านแบบมีข้อสังเกต (`docs/reports/qa-r8.md`) · security ผ่าน (`docs/reports/security-r8.md`)
- **ออก v0.10.0 แล้ว** (2026-11-09): tag `v0.10.0` → commit `d670fcc` `chore(release): v0.10.0` (`git rev-list -n1 v0.10.0` = `d670fcc`; `git ls-remote --tags origin v0.10.0` เห็น tag · หัวข้อ `[0.10.0] - 2026-11-09` ใน CHANGELOG) · boss รันคำสั่งเอง ด้วย `--skip-gates` หลัง CI บน main เขียว
  - การ push ครั้งแรกถูก GitHub ปฏิเสธ (GH007 อีเมลส่วนตัวใน commit) boss จึงย้อน commit ออกรุ่นแล้วทำใหม่ด้วยอีเมล noreply (`git config user.email` ระดับ repo) · author ของ `d670fcc` ตรวจแล้วเป็น noreply
- **repo เปลี่ยนเป็น public** (2026-11-08) — `gh repo view`: visibility `PUBLIC` (ตรวจ 2026-11-09)
  - เหตุผล: โควตา GitHub Actions เดือน พ.ย. ($12) หมดใน 8 วัน ทำให้ CI ไม่เริ่ม · boss ตั้งใจเปิดชั่วคราว
  - ผลสแกนก่อนเปิด: `docs/reports/security-public-scan.md` (PR #22, merge `8fc15e6`) สรุป "เปิด public ได้"
- **การตั้งค่าหลังเปิด public:**
  - ตรวจด้วย `gh api` แล้ว: Secret scanning `enabled` + Push protection `enabled` · Dependabot alerts เปิด (`vulnerability-alerts` ตอบ 204) · Private vulnerability reporting `true` · PR จาก fork ต้องอนุมัติ `all_external_contributors`
  - ruleset `main` `active`: ต้องผ่าน PR (approvals 0) · status checks 9 ตัว (lint, typecheck, test + migration, build, contrast, e2e (Playwright) 1–4) · ห้าม force push / ลบ · bypass ได้เฉพาะ repository admin
  - ตามภาพหน้าจอของ boss (เลขาไม่ได้ตรวจผ่าน API): Vercel Git Fork Protection เปิด · boss ตั้ง "Keep my email addresses private" แล้ว
- **ยังไม่ยืนยัน:**
  - CI ของ commit `d670fcc` (`gh run list`: `chore(release): v0.10.0` status `in_progress`) ตอนบันทึก — ยังไม่เสร็จ
  - Deploy: ตอนที่ main ตรวจ `/api/health` ตอบ `0.9.1` (เพิ่ง push) · **เลขาตรวจซ้ำ 2026-11-09 04:38 เวลาไทย** `https://maewmeet.vercel.app/api/health` ตอบ `"version":"0.10.0"` (node v24.22.2) — เป็นหลักฐานระดับ endpoint ว่า prod รุ่นนี้ขึ้นแล้ว · ยังไม่ได้ตรวจหน้า Vercel dashboard หรือ CI ของ `d670fcc` จบ · **main ควรยืนยันอีกครั้ง** (ผลสองครั้งไม่ตรงกัน)
- **ข้อสังเกตจาก security-public-scan (L1, L2):** อีเมลส่วนตัวของ boss อยู่ใน metadata commit/tag เก่า (เห็นได้จาก `git log` ตอนนี้ที่ repo public) · ไม่ได้แก้ประวัติ · ยังไม่ทราบว่า boss เลือกทางใด (ดู `docs/reports/security-public-scan.md`) · username ตัวอย่าง `boss` ใน `docs/OPERATIONS.md` (L2) ยังไม่แก้

## R6F — merge + ออก v0.9.0 แล้ว (2026-11-03) ✅
- **PR #18** (branch `feat/r6f-daily-busy`) merge เข้า `main` ด้วย merge commit `3aaab63` · `gh pr view 18`: state MERGED, mergedAt 2026-11-02T22:06:07Z (= 05:06 เวลาไทย 2026-11-03)
- busy หลายวันเฉพาะช่วงเวลา (ทั้งวัน/เฉพาะช่วงเวลา) + ลบวันนี้/ลบทั้งชุด · `R6F_CONTRACT.md` · ADR `docs/adr/0010-daily-busy-series.md` (commit `a7f66c0` `docs(adr): 0010 accepted`)
- ผลตรวจอิสระ: qa **ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r6f.md`, 0H/0M/3L) · security **ผ่าน** (`docs/reports/security-r6f.md`, 0C/0H/0M/0L, Info 5)
- migration `0003` (`busy_block.series_id` + partial index): **boss รันแล้วทั้ง preview และ prod** (boss ยืนยัน 2026-11-03) — เลขาไม่ได้ตรวจฐาน Turso เอง
- **ออก v0.9.0 แล้ว** (2026-11-03, tag `v0.9.0` → commit `ea1bf5f` `chore(release): v0.9.0`; `git rev-parse v0.9.0^{commit}` ยืนยันแล้ว) รวม R6F · หัวข้อ `[0.9.0] - 2026-11-03` ใน CHANGELOG · `[Unreleased]` ว่างหลังออก
- ผู้ทำ R6F ตาม commit author: architect (`258334a`, `a7f66c0`) · main (`3123a0f`, `87264dd`, `313e016`, `7aabdf4`) · platform (`8bed164`, `d125181`, `a93ba6f`) · ux (`7d97edd`) · test (`3a9bd73`) · frontend (`f903665`, `8391d79`) · ops (`438beab`, `ca104a0`) · qa (`2a33843`) · security (`286bee8`)
- **ยังไม่ยืนยัน:** CI และ Vercel ของ `main` หลัง merge (เลขาไม่ได้ตรวจ) · ผล `npm test` ในเครื่องเลขาไม่มี (เลขาไม่ได้รัน)

## R7 — merge + ออก v0.9.1 แล้ว (2026-11-08) ✅
- **PR #19** (branch `perf/r7-speed`, HEAD `603f21c`) merge เข้า `main` ด้วย merge commit `c896b92` (`Merge pull request #19`, 2026-11-08 06:02 เวลาไทย)
- **ออก v0.9.1 แล้ว** (2026-11-08, tag `v0.9.1` → commit `628175d` `chore(release): v0.9.1`; `git rev-parse v0.9.1^{commit}` = `628175d` · `git ls-remote --tags origin v0.9.1` เห็น tag บน GitHub แล้ว · หัวข้อ `[0.9.1] - 2026-11-08` ใน CHANGELOG) รวม R7 · `[Unreleased]` ว่างหลังออก
- **PR #20** (`docs/v0.9.1-progress`) merge แล้ว (merge commit `9a53f1c`, ตรวจด้วย `git log origin/main` · รวม `d9e7950` `docs(progress): v0.9.1 released`)
- **ไม่มี migration** รอบนี้ → ไม่ต้องรันฐาน Turso
- contract: `R7_CONTRACT.md` (`f44551a`, main) · branch แตกจาก `ea1bf5f` (v0.9.0)
- เนื้อหา: **G1** กลุ่มใหม่ "ว่างอย่างน้อย" 240 นาที (`73bd68d`, `14a7f2c`) · **F2 ความเร็ว** วัดก่อน (`b721a22` baseline) → เฟส B ตาม §3.1 (`2c4167e` `896720c` `6c3ef87` `5361858` `6c64caa` `45660c2` `a18cd83`) → วัดหลัง (`cb15b59`) · Server-Timing + env `SERVER_TIMING_ENABLED` (`ecc91dd`, `7c5b2f9`) · CHANGELOG `[Unreleased]` (`ef3026a`)
- **ตัวเลขหลัก** (จาก `perf-r7-after.md` · จำนวน query, ในเครื่อง libSQL ไฟล์):
  - home `/` 13 → 9 (−31%) · waves 7 → 3 · **ผ่าน**
  - ปฏิทินเดือน `/calendar?v=month` 15 → 8 (−47%) · **ผ่าน**
  - ว่างตรงกัน `?v=free` 15 → 8 (−47%) · **ผ่าน**
  - แท็บของฉัน `?v=mine` 3 HTTP → 1 HTTP (24 → 11 query)
  - เพิ่ม busy 3 คำขอต่อกัน → 2 คำขอ (14 → 7 query)
  - RSVP `PUT rsvp` 10 → 9 (−10%) · **ไม่ถึงเกณฑ์ 30%** (ตั้งใจคงไว้: ด่านสิทธิ์, rate limit นอกธุรกรรม, BEGIN/upsert/COMMIT, session, DTO) — ต้องให้ boss ตัดสิน
- **ผลตรวจอิสระ:**
  - qa **ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r7.md`, 0H/0M/3L · รันที่ HEAD `cb15b59`) — L1 RSVP ไม่ถึงเกณฑ์ · L2 `/groups/[gid]` ผ่านด่านกลุ่ม 2 ครั้ง · L3 e2e บน Windows 15 ล้มจาก ENOENT ของ path ยาว + server หลุด 1 ครั้ง (รันซ้ำด้วย path สั้น 329 passed / 0 failed)
  - security **ผ่าน** (`docs/reports/security-r7.md`) — Low 1 (Server-Timing เป็น oracle "username active" ผ่าน pin-reset เมื่อผู้เรียกล็อกอิน) **แก้แล้ว `c563097`** (platform) และตรวจซ้ำผ่าน `4eb3f15` · Info 5
  - ⚠️ qa รันที่ `cb15b59` ก่อน fix `c563097` — การแก้ครั้งนั้น security ตรวจซ้ำแล้ว แต่ qa ยังไม่ได้รันซ้ำ (ไม่ใช่ข้อบกพร่อง แค่ข้อสังเกต)
- **เกณฑ์ contract:** R7-1 / R7-2 / R7-3 / R7-5 ผ่าน (ตามรายงาน qa/security) · R7-4 ผ่าน 3 เส้นทางหลัก · RSVP ไม่ผ่าน · R7-6 ข้าม (optimistic ไม่ทำตาม contract §3.1) · R7-7 **ยังไม่ยืนยัน** (CI / Vercel preview ยังไม่ได้ตรวจ)
- **ยังไม่ยืนยัน:** เวลาจริงบน Turso ญี่ปุ่น (ยังไม่ได้วัด) · CI และ Vercel preview ของ branch (ตอนนี้ merge/release แล้ว แต่เลขาไม่ได้ตรวจ CI ของ `main` หลัง v0.9.1) · ผลเทสต์ทั้งชุดบน Windows (ยังมี EPERM/timeout/ENOENT ตามปกติ)

### การตัดสินของ boss (R7)
1. **RSVP ลด 10 → 9 query (ไม่ถึงเกณฑ์ 30%)** — ยอมรับตามที่ main เสนอ รอ boss ยืนยัน (ยังไม่พบคำตอบของ boss ในรีโป) · การลดต่อต้องเปลี่ยนการออกแบบ (ย้าย rate limit เข้าธุรกรรม / คืน DTO แบบย่อจาก PUT ซึ่งเปลี่ยนรูป API) → เก็บไว้ใน backlog
2. **merge PR #19** — เสร็จแล้ว (merge commit `c896b92`)
3. **ออก v0.9.1** — เสร็จแล้ว (`628175d`, tag `v0.9.1`, 2026-11-08)

### backlog ใหม่จาก R7 (ไม่บล็อก)
- RSVP ลดได้อีกถ้าออกแบบใหม่ (ดูข้อ 1 ด้านบน) · หน้า RSVP จากหน้าหลักยังเป็น 2 คำขอ (GET detail → PUT) เพราะ popup นัดชนของ R6D ต้องใช้ `myConflicts` ก่อนยืนยัน
- `/groups/[gid]` ผ่านด่านกลุ่ม 2 ครั้ง (`getGroup` + `listGroupAppointments`) ราว −1 query (qa-r7 L2)
- Server-Timing บนหน้า RSC ยังไม่มี (ใช้ harness วัดแทน) · วัดเวลาจริงบน Turso ญี่ปุ่นยังไม่ได้ทำ
- security-r7 Info 1–5: Info 1 หน้าต่างหลัง commit ของ RSVP (ยอมรับได้) · Info 2 `resolvedUsers` ระวังถ้ามีผู้เรียกใหม่หลังเขียน · Info 3 audit super admin บนหน้า `/calendar` (ยอมรับได้) · Info 4 ค่าเริ่มต้น Server-Timing "เปิด" เมื่อไม่มี `VERCEL_ENV` · Info 5 `total;dur` เป็นเวลาจริง (oracle หลักคือจำนวน query ซึ่งแก้แล้วใน Low 1)
- ข้อสังเกตเครื่อง Windows (R7): **Node v26.13.0** ในเครื่อง (เทสต์ `ops/health` คาด v24 → ล้ม) · path ยาวของ Playwright `--output` ทำ ENOENT · config Vitest ชั่วคราวข้าม EPERM (เสนอทำถาวร — ข้อเสนอเดิมจาก R6F)

## R9 — README สำหรับคนนอก + จัด root — merge แล้ว (PR #23, merge commit `8b60634`, 2026-11-09 02:07 เวลาไทย) ✅
- contract: `docs/contracts/R9_CONTRACT.md` (`3c720ae`, main) · **boss เห็นชอบ 2026-11-09** ("เห็นชอบ ไม่ใส่ License") · branch แตกจาก main `8fc15e6`
- **ไม่แตะโค้ดแอป · ไม่มี migration · ไม่ออกรุ่น** (`git diff --name-only main..HEAD` ไม่มี `src/`, `drizzle/`, `CHANGELOG.md`) · เวอร์ชันปัจจุบัน **v0.9.1** (tag 2026-11-08) · `[Unreleased]` ยังเป็นของ R8 (ไม่เปลี่ยนในรอบนี้)
- เนื้อหา (ตาม contract §1–§5):
  - **จัด root** (`f04a191`, ops): ย้าย `R*_CONTRACT.md` ไป `docs/contracts/` และ `TEAM/PROCESS/SECRETARY/PROGRESS.md` ไป `docs/team/` ด้วย `git mv` (ประวัติคงอยู่) · root เหลือ README, CHANGELOG, CLAUDE และ config
  - **README ใหม่สำหรับคนนอก** (`4572f84`, secretary; แก้ตาม qa `d51646c`) · วิธีใช้, Features, Tech Stack, Getting Started, ตาราง env, สคริปต์, โครงสร้าง, ลิงก์ docs
  - **ภาพหน้าจอมือถือ 2 ภาพ** `docs/images/screenshot-home.png`, `screenshot-free-days.png` (ข้อมูลสมมติ, DB ในเครื่อง) (`eb904c0`, test)
  - **Quickguide ไทย** `docs/guides/quickstart-th.html` ไฟล์เดียว ไม่แก้เนื้อหา (`4572f84`, secretary)
  - **โลโก้ README สองธีม** `docs/images/logo-light.svg`, `logo-dark.svg` สีตายตัว ผ่าน `<picture>` · ไม่แตะ `public/brand/` ที่แอปใช้ (`1c014e4`, ux; `d51646c`, secretary)
  - **License: ไม่ใส่** (ค่าเริ่มต้นของ contract §5 — boss เลือก)
- commit (`git log --format='%h|%an' main..HEAD`): main `3c720ae`, `b3a1b1b` · ops `f04a191` · test `eb904c0` · secretary `4572f84`, `d51646c` · qa `1880695`, `36ff749` · ux `1c014e4`
- **ผลตรวจอิสระ:** qa **ผ่าน** (`docs/reports/qa-r9.md`)
  - รอบแรก (`1880695`) ผ่านแบบมีข้อสังเกต: M1 โลโก้ตัวอักษรหายบนธีมมืด → แก้แล้ว · L ข้อ 4–5 (ตาราง APP_ORIGIN, ขั้นตอน TURSO_AUTH_TOKEN) → แก้แล้วใน `d51646c` · L ข้อ 2 (TEAM.md แถว #1), ข้อ 3 (ลิงก์ contract เก่า 37 ลิงก์ — ยอมรับตาม contract §2), ข้อ 6 (quickguide "app v0.9.0" และรายการแจ้งเตือนใน README ไม่ครบ) → ค้าง ไม่บล็อก (ดู `docs/reports/2026-11-09.md`)
  - ตรวจซ้ำ `36ff749` ผ่าน (ขอบเขต diff, โลโก้, APP_ORIGIN ตรงโค้ด `env.ts`, Getting Started ฉบับใหม่ ได้ `migrations applied successfully` และ `GET /login` 200 และ `POST /api/auth/signup` 201, ลิงก์/รูปไม่เสีย)
  - ไม่มีรอบ security (contract §7 ไม่กำหนด) · qa ตรวจความลับ/ข้อมูลคนใน README, ภาพ และ quickguide แล้ว ไม่พบ
- **ตัวเลขเทสต์ (ตาม qa-r9 ไม่ใช่เลขาที่รัน):** lint exit 0, typecheck exit 0 · `vitest` branch ที่ `4572f84`: 3831 ผ่าน / 984 ล้ม (974 EPERM/EBUSY ตอนลบ temp) · main `8fc15e6`: 3833 ผ่าน / 982 ล้ม · ต่างกันไฟล์เดียว (`availability-perf`, รันเดี่ยวผ่านทั้งสอง) · ไม่มีอะไรล้มเพราะงาน R9
- **ยังไม่ยืนยัน:**
  - หน้า README บน github.com จริงทั้งธีมสว่าง/มืด (qa render ด้วย Playwright ในเครื่องแทน)
  - Node 24 (qa รันด้วย Node v26.13.0 ในเครื่อง)
  - PowerShell จริง (qa ใช้ bash; คำสั่งใน README บอกว่าใช้ได้ทั้งสองเชลล์ แต่ยังไม่ได้รันบน PowerShell)
  - ตัวเลขลิงก์เสีย 37 ลิงก์ เป็นของ qa (เลขาไม่ได้นับซ้ำ)
- **สถานะ:** merge แล้ว · PR #23 (`docs/r9-readme` → `main`) · `gh pr view 23`: state MERGED, mergedAt 2026-11-08T19:07:04Z (= 2026-11-09 02:07 เวลาไทย), merge commit `8b60634` · `gh pr checks 23`: 11 checks ผ่าน (Vercel, Vercel Preview Comments, build, contrast, e2e (Playwright) 1–4, lint, test + migration, typecheck)

## R8 — F1 onboarding + P1 privacy — merge แล้ว (PR #21, merge commit `e41f9d2`) ✅
- contract: `R8_CONTRACT.md` (`59661af`, main) · **boss อนุมัติ 2026-11-08** ("อนุมัติ เริ่มเลย") · branch แตกจาก main `628175d` (v0.9.1) · **ไม่มี migration** (`git diff main..HEAD -- drizzle` = ว่าง) · ออกแล้วเป็น **v0.10.0** (2026-11-09, `d670fcc`)
- เนื้อหา:
  - **P1** `/privacy`: ตัดข้อความ "เจ้าของแอปต้องรับรอง" · "ร่างล่าสุด" → "อัปเดตล่าสุด / Last updated" (`bd54b1c`, `d3c34db`)
  - **F1 แถบ 4 ขั้น** บนหน้ากลุ่ม: ชวนเพื่อน → ลงวันไม่ว่าง → ดูวันว่างตรงกัน → สร้างนัด · ปุ่มสร้างนัดมีปุ่มเดียว (`d3c34db`, `c31f702`)
  - **F1 ป้ายสมาชิก** "ยังไม่ได้ลงวันไม่ว่าง": ส่งเป็น boolean `hasUpcomingBusy` ใน query สมาชิกเดิม (EXISTS, ช่วง 30 วัน, นับเฉพาะ busy ที่ลงเอง ไม่นับ "ไป") · **+0 query** — `/groups/[gid]` ยังเป็น 11 query, API ยังเป็น 3 (`e3f0961`, ตาม qa R8-4 และ `r7-baseline` เทสต์ผ่าน)
  - **การ์ดแนะนำหน้าหลัก** + ลิงก์ "วิธีใช้งาน" ในแท็บ "ฉัน" รีเซ็ตการ์ดได้ · จำการปิดด้วย localStorage key `mm_intro_seen` ค่า `"1"` (`d3c34db`, `792f203`)
  - CHANGELOG `[Unreleased]` (`93ca6e0`, `a20aa31`) · เทสต์: platform 7 ข้อ, steps-model, e2e `r8-onboarding` (`4e7a29b`)
- ขนาดรอบ (`git diff --stat main..HEAD`): 33 ไฟล์ · +1359 / −38 (รวม contract และรายงาน)
- commit ตามผู้เขียน (13 commit ใน `git log main..HEAD`):
  - main `59661af` contract · ux `bd54b1c` ถ้อยคำ TH/EN + wireframe `docs/design/R8_ONBOARDING.md` · platform `e3f0961` hasUpcomingBusy
  - ops `93ca6e0`, `a20aa31` CHANGELOG · frontend `d3c34db`, `c31f702` UI · test `4e7a29b`, `a0f63d6` e2e
  - security `863ee2a` รีวิว · qa `792f203`, `4fc403d`, `9294994` แก้ CSS/รายงาน/รีเช็ก
- ผลตรวจอิสระ:
  - **security ผ่าน** (`docs/reports/security-r8.md`) 0C/0H/0M/0L, **Info 3** · รีวิวถึง HEAD `4e7a29b` — commit หลังจากนั้นที่แตะ `src/` (`792f203` CSS, `c31f702` UI) **ยังไม่ได้รับรีวิว security**
  - **qa ผ่านแบบมีข้อสังเกต** (`docs/reports/qa-r8.md`) · พบ M (การ์ดแนะนำ `<ol>` ไม่มีเลข 1–4) แก้แล้ว `792f203` · L (ปุ่มสร้างนัดซ้ำ) แก้แล้ว `c31f702` · รีเช็ก `c31f702` (`9294994`) พบ `groups-story` ล้ม 3 ข้อ จาก `memberRow` ที่ใช้ exact match กับ aria-label ที่มีประโยคต่อท้าย → **แก้แล้ว `a0f63d6`** (test)
  - ⚠️ **qa ไม่ได้รันซ้ำหลัง `a0f63d6`** · ผล `167 passed / 10 skipped / 0 failed` บน 3 project เป็นรายงานของ test ตามที่ main แจ้ง — เลขาไม่ได้รันซ้ำ ยังไม่ยืนยัน
- **backlog R8 (ไม่บล็อก):**
  1. ขั้น 2 ปุ่ม "ลงวันไม่ว่าง" พาไปปฏิทิน ไม่ได้เปิดฟอร์มลง busy ตรง (qa L3) — ทำรอบหน้า
  2. ขั้น 3 ค้าง "ถัดไป" จนกว่าจะมีนัด — ผู้ใช้ที่ดูวันว่างแล้วไม่ได้รับสัญญาณตอบกลับ (qa L4)
  3. `/privacy` เพิ่มประโยคว่าสมาชิกในกลุ่มเห็นว่าลงวันไม่ว่างแล้วหรือยัง (security Info 1 · ข้อเสนอ — boss ตัดสิน)
- **ยังไม่ยืนยัน:** CI และ Vercel preview ของ branch · ผลเทสต์หลัง `a0f63d6` (ดูข้อ qa ด้านบน)
- **PR #21** (`feat/r8-onboarding` → `main`): https://github.com/ieatbaozi-stack/maewmeet/pull/21 · **merge แล้ว** — ตรวจด้วย `git log main`: merge commit `e41f9d2` อยู่ใน history ของ `main` (เลขาไม่ได้ตรวจด้วย `gh pr view 21` รอบนี้) · เดิมเขียนว่า OPEN ซึ่งล้าสมัย

### รอ boss (R8)
1. ~~merge PR #21~~ — merge แล้ว (`e41f9d2`)
2. ~~ออก v0.10.0~~ — ออกแล้ว (`d670fcc`, 2026-11-09 · ดูหัวข้อ "v0.10.0 ออกแล้ว + repo เป็น public")

## รอ boss
- **R11 แจ้งเตือนเหตุการณ์นัดและสมาชิก** — รีวิวผ่านแล้ว · รอเปิด PR, CI และ boss merge (ดูหัวข้อ R11)
- **R7 RSVP 10→9** — ยอมรับตามที่ main เสนอ รอ boss ยืนยัน (ดูหัวข้อ R7 ด้านบน) · merge PR #19 และออก v0.9.1 เสร็จแล้ว
- **F6 แจ้งเตือนก่อนนัด** — boss เลือกแล้ว (LINE OA + กระดิ่ง, 2026-11-09) · R10 merge และออก v0.11.0 แล้ว (2026-11-10) · ค้างแค่ทดสอบเตือน 1 วันและ `rsvp_nudge` บน LINE จริง · ดูหัวข้อ R10
- R7 เฟส A เดิม (เปิด preview อ่าน Server-Timing ด้วย DevTools เพื่อวัดเวลาจริงกับ Turso ญี่ปุ่น) — ยังไม่ได้ทำ เลื่อนเป็น backlog ถ้าไม่ต้องการตัวเลขจริงก่อนงานถัดไป

## เหลือ
- **งานหลักที่ค้าง** (ตาม `docs/NEXT_PHASE.md`):
  - **F1 onboarding** — R8 merge แล้ว (`e41f9d2`) · **ออกแล้ว v0.10.0** (`d670fcc`, 2026-11-09)
- **งานค้างหลังเปิด public (เพิ่ม 2026-11-09, ไม่บล็อก):**
  - ทบทวนว่าจะกลับเป็น private ไหม — ถ้ากลับ ต้องแก้โควตา CI ก่อน (ผูกบัตร หรือลดการใช้ CI) · boss ตัดสิน
  - ลดการใช้นาที CI — ยังไม่ได้ทำ
  - L2 (security-public-scan): username ตัวอย่าง `boss` ใน `docs/OPERATIONS.md` — ยังไม่แก้ (ดู `docs/reports/security-public-scan.md`)
  - backlog R8 (step-2 CTA ไปปฏิทิน, step 3 ค้าง "ถัดไป", ประโยคเสริมใน `/privacy`) — ดูหัวข้อ "backlog R8" ด้านบน
  - **README สำหรับคนนอก (R9)** — merge แล้ว (PR #23, `8b60634`)
  - **F2 ความช้า** — R7 เสร็จ รอ boss ตัดสิน RSVP 10→9
  - **F6 แจ้งเตือนก่อนนัด** — R10 merge + ออก v0.11.0 แล้ว · ค้าง: ทดสอบเตือน 1 วันและ `rsvp_nudge` บน LINE จริง · CI ของ `a77fc50` ยังไม่ยืนยันผล
  - **Backlog R10:** security L1, L3 (ดูหัวข้อ R10)
- **backlog R7 และ R8 (ไม่บล็อก):** ดูหัวข้อ "backlog ใหม่จาก R7" และ "backlog R8" ด้านบน · qa/security L/Info ที่เหลือจาก R7: ดู `docs/reports/qa-r7.md`, `docs/reports/security-r7.md`
- **ทำ config/helper ถาวรให้ Vitest ข้าม EPERM บน Windows** (ข้อเสนอเดิม)
- **R6 hardening (ดู `docs/NEXT_PHASE.md` หัวข้อ backlog R6 hardening):** rate limit แบบ global/อ่าน · retention กลุ่ม/คำเชิญที่ลบ · e2e retries ซ่อน flake · guard stream HTTP 200 · CSP unsafe-inline · DST day strip · แจ้งเตือน appointment.cancelled · กู้กลุ่ม/บัญชีที่ลบ
- **backlog R6F (ไม่บล็อก):**
  - qa-r6f L1: ป้ายชุดใน `MineList.tsx:99` เป็น `<span aria-label>` ไม่มี role — screen reader อาจไม่อ่าน aria-label (ข้อความที่มองเห็นยังอ่านได้) · ตัดสินใจโดย ux/frontend
  - qa-r6f L2: "Certain hours" ในปุ่ม segmented ขึ้น 2 บรรทัดที่ 375 EN (ไม่ล้น ปุ่มสูงกว่า 44px) — เชิงรูปลักษณ์
  - qa-r6f L3: `editNote` อยู่ท้ายฟอร์มแก้ไข ต้องเลื่อนถึง (เปิดเผยไว้แล้ว)
  - security-r6f Info 1: `?scope=` ซ้ำใช้ค่าสุดท้าย (`route.ts:21`) — ข้อมูลของผู้กระทำเอง · ทางเลือก: ปฏิเสธเมื่อซ้ำ
  - security-r6f Info 2: ขยายวัน 62 วันก่อนชน rate limit (ต้นทุนราว 2.5 ms/ครั้งที่วัดเอง)
  - security-r6f Info 3: กิจวัตร "17:00–20:00 ทุกวัน" เดาได้จากรูปแบบเวลา (ไม่ได้รั่วเพิ่มจากการเป็นชุด)
  - security-r6f Info 4: PATCH busy ไม่มี rate limit (contract กำหนดเฉพาะ create/delete)
  - security-r6f Info 5: การแข่งกันข้าม connection ทดสอบบน SQLite ไฟล์เดียวเท่านั้น ยังไม่ทดสอบบน Turso จริง
  - ข้อเสนอ (qa/security): ทำ config/helper ถาวรให้ Vitest ข้าม EPERM ตอนลบ temp DB บน Windows (ตอนนี้ทุก agent ทำ config ชั่วคราวเอง)
  - รอบหน้า (ตาม R6F Errata): "ลบตั้งแต่วันนี้เป็นต้นไป" และ "แก้ทั้งชุด"
- **backlog ที่ R6E ไม่รับ (ไม่บล็อก):**
  - qa-r6e L1: skeleton ไม่มี delay 150 ms / min-duration 250 ms ตาม R6E_POLISH §3.3 (`LoadingState.tsx`, `loading.tsx`)
  - qa-r6e L2: `NavProgress` ฟังแค่คลิกลิงก์ — `router.push` จากโค้ด (เช่นหลังบันทึก) ไม่ขึ้นแถบ (ปุ่มมีวงหมุนของตัวเองแล้ว)
  - qa-r6e L3: เทสต์ "นำทางเร็วไม่กระพริบ" ใช้ `--loading-delay` 5000 ms จำลอง ไม่ได้วัดเวลาจริง 150 ms
  - qa-r6e L4: ยังไม่วัด CLS (layout shift) — ปุ่มคงขนาดได้ ≤ 1px และ skeleton กำหนดขนาดด้วย CSS (อ่านโค้ด)
  - security-r6e Info 1: assertion `appt-story.spec.ts:133-134` ลบรูป `myConflicts` จากทุก response ของ B — ถ้า endpoint อื่นใช้รูปเดียวกันในอนาคตจะไม่จับ (ข้อจำกัดของเทสต์ ไม่ใช่ช่องโหว่)
  - security-r6e Info 2: E11 ไม่ดู `truncated` และช่วงยาวใช้รายการที่ยังไม่จบ → อาจเตือนไม่ครบ (UX ไม่ใช่ความปลอดภัย)
  - security-r6e Info 3: E11 เพิ่ม `GET /api/me/busy` 1 ครั้งต่อการบันทึก (อ่านของตัวเอง)
  - security-r6e Info 4: CSP ยังมี `'unsafe-inline'` ใน script-src/style-src (`next.config.ts`) — ของเดิม, nonce อยู่ใน hardening
  - security-r6d Info 5: การ์ดรายการ `myConflict` มีเพดาน 500 ไม่มีธง truncated (ผลแค่ UI)

## ข้อสังเกต
- **ลำดับ migration `0003` (ปิดแล้ว):** commit `ca104a0` (ops) แก้ `docs/OPERATIONS.md` ให้ตรงกับลำดับที่ main สั่ง (preview ก่อน PR, prod ก่อน merge) — ปิดตาม commit message
- **ADR 0010 (ปิดแล้ว):** commit `a7f66c0` `docs(adr): 0010 accepted` — ไม่ใช่ *Proposed* อีกต่อไป (ตรวจจาก commit message)
- **ความจริงที่ไม่ตรงกับ PROGRESS รอบก่อน (แก้แล้ว):** รอบก่อนเขียนว่า R6F "รอ migration/PR" และ "ยังไม่ push" — ปัจจุบัน merge + ออก v0.9.0 แล้ว (ตรวจด้วย `gh pr view 18` และ `git tag`)
- **vitest ทั้งชุดบน Windows ล้มหลายร้อยข้อ เป็นปัญหาเดิม** — qa รันเทียบ main แล้ว (main `37271af` ล้ม 908, branch R6E ล้ม 907) · รายงาน qa เป็นตัวเลขของ qa ไม่ใช่ของเลขา
- `npm run lint` จาก root ไปสแกน worktree ที่ซ้อนใน `.claude/worktrees/` → ใช้ `npx eslint . --ignore-pattern ".claude/**"` แทน (qa รันแล้ว 0 problems) — ปัญหาการตั้งค่า
- เครื่อง Windows ของ boss: เทสต์ฐานข้อมูลบางไฟล์ล้มด้วย EPERM ตอนลบโฟลเดอร์ชั่วคราว, `config-hygiene` ข้อ permissions ล้มบน CRLF, `tests/release` CLI ล้มเพราะ `.bin/tsx` ENOENT — เป็นปัญหาเดิม (ดูผลจริงจาก CI)
- ยังไม่ยืนยัน: CI และ Vercel preview ของ R6E, R6F และ `main` หลัง v0.9.0 / v0.9.1 (เลขาไม่ได้ตรวจ) · ใบรับรอง Handoff ของแต่ละบทบาทไม่มีไฟล์ในรีโป (มีเฉพาะรายงาน qa/security)
- ช่องวันในปฏิทินจอ 360px กว้างประมาณ 43px (เป็นแบบนี้มาเดิม)
