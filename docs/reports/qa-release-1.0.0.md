# qa — รอบหลังออกรุ่น v1.0.0 (`docs/release-1.0.0`)

> ผู้ตรวจ: qa (อิสระ) · 2026-11-23 · base `origin/main` · ตรวจ commit `68a8a97` `7bdaa5c` `9aa9c4d`

**Verdict: ผ่านแบบมีข้อสังเกต** (ไม่มี Critical/High/Medium · พบข้อความล้าสมัย 3 จุด แก้แล้วใน commit `qa:` ของ branch นี้)

## 1. ข้อเท็จจริงที่ตรวจเอง
- `git rev-parse v1.0.0^{commit}` = `c906d091…` ✓ · `git merge-base --is-ancestor 1b07381 v1.0.0` = เป็น ancestor ✓ · `1b07381` = "Merge pull request #42 …/feat/r18-v1" ✓
- `curl https://maewmeet.vercel.app/api/health` → `{"ok":true,"version":"1.0.0",…,"db":true,"pepper":{"ok":true,…}}` ✓
- `curl -sI https://maewmeet.vercel.app/i/<token ปลอม>` → `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` · `X-Robots-Tag: noindex, nofollow` ✓ (ยังไม่ได้ลอง token จริงบน prod)
- CI: main run บน `1b07381` (45124539036) = success · release run 45130814542 (`c906d09`) ตอนตรวจ: changes/contrast/typecheck/lint/build ✓ · `test + migration` และ e2e (1)–(4) ยังรันอยู่ → **ยังไม่ทราบผลสุดท้าย**
- `package.json` = 1.0.0 · CHANGELOG `[1.0.0] - 2026-11-23` + `[Unreleased]` ว่าง · quickstart ท้ายหน้า `app v1.0.0`

## 2. DOCS_SYNC §3 ทีละข้อ
| ข้อ | ผล |
|---|---|
| CHANGELOG | ✓ Added/Changed ครบ R18 (§S, migration 0007, ลิมิต H2/H3, purge คำเชิญ, G1, ยืนยันลบ C1) |
| quickstart ท้ายหน้า | ✓ v1.0.0 |
| PROGRESS "เหลือ" + บรรทัดรุ่น | ✓ หลังแก้ — "/api/health ยังไม่ยืนยัน" และ "header /i ยังไม่ยืนยัน" ล้าสมัย → แก้เป็นผลที่ qa ตรวจแล้ว |
| NEXT_PHASE | ✓ หลังแก้ — บรรทัด 14 "แอปอยู่ที่ v0.15.0 (2026-11-20)" → v1.0.0 (2026-11-23) · หมายเหตุ R18 = ปิดรอบ/ออกรุ่นแล้ว ✓ |
| PRD หมายเหตุ + ติ๊ก | ✓ "R0–R18 · v1.0.0 · โหมดดูแล" |
| R18_CONTRACT บรรทัดปิดรอบ | ✓ แฮช `1b07381`/`c906d09` ตรงที่ตรวจ |
| รายงานวัน 2026-11-23 | ✓ หลังแก้ — 3 จุดที่ยังเขียนว่า README เก่า / health ยังไม่ยืนยัน / header ยังไม่ยืนยัน แก้ให้ตรงสถานะจริง |
| ARCHITECTURE | ✓ บรรทัด 3/11/507/627 ระบุ v1.0.0 · ข้อความ v0.15.0 ที่เหลือ (บรรทัด 10, 473) เป็นบริบทประวัติ/rollback ไม่ใช่สถานะ |

grep ข้อความล้าสมัยของ R18 ("ยังไม่ออกรุ่น", "เตรียมขึ้น 1.0", "v0.15.0" เป็นสถานะ, "กำลังทำ") ใน README, PROGRESS, NEXT_PHASE, ARCHITECTURE, quickstart, PRD, v1-readiness, OPERATIONS, VERSIONING: เหลือเฉพาะบริบทประวัติ (R18_CONTRACT บรรทัด 5 "PR #41 · v0.15.0" = จุดเริ่ม branch, OPERATIONS rollback 0007→v0.15.0, VERSIONING "ก่อน 1.0 ประวัติ")

## 3. คำสั่งที่รัน
- `npx vitest run tests/ops/docs-sync.test.ts --reporter=agent` → 1 file · **8/8 passed** (หลังแก้)
- `git diff --check origin/main..HEAD` → ไม่มีผล (exit 0)

## ข้อสังเกต
1. (Info) PROGRESS บรรทัด 12 "CI บน 1b07381 เขียว" ตรงกับ `gh run list` (success) แล้ว แต่ข้อความยังบอกว่า "เลขายังไม่ตรวจ" — ไม่ผิดข้อเท็จจริง
2. (Info) release CI run 45130814542 ยังไม่จบตอนตรวจ — main ควรดูผลก่อน merge PR เอกสารนี้
3. (Info) เช็กลิสต์มือถือ boss ช่อง "ผล" ยังว่าง (ไม่บล็อก) · ไม่ได้รันชุดเทสต์เต็ม (เครื่อง Windows)
