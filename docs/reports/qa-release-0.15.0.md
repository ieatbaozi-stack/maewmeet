# qa — รอบหลังออกรุ่น v0.15.0 (`docs/release-0.15.0`)

> ผู้ตรวจ: qa (อิสระ) · 2026-11-20 · base `origin/main` · ตรวจ commit `37033e9` `c98be99` `4e60ecf`

**Verdict: ผ่านแบบมีข้อสังเกต** (ไม่มี Critical/High/Medium · พบข้อความเอกสารล้าสมัย 3 จุด แก้แล้วใน commit `qa:` ของ branch นี้)

## 1. ข้อเท็จจริงที่ตรวจเอง
- `git rev-parse v0.15.0^{commit}` = `17918b8c5c95…` ✓ · `git tag --points-at 17918b8` = `v0.15.0` ✓
- PR #40 = `c3e5c9f` "Merge pull request #40 …/feat/r17-retention" ✓ · `git merge-base --is-ancestor c3e5c9f 17918b8` = เป็น ancestor ✓
- `curl https://maewmeet.vercel.app/api/health` → `{"ok":true,"version":"0.15.0",…,"db":true,…}` ✓
- CHANGELOG มี `[0.15.0] - 2026-11-20` (Added/Changed/Fixed ครบ R17: กู้กลุ่ม, cron purge `purgedGroups`, กระดิ่ง `group.restored`, ป้าย audit, ยืนยันลบบัญชี `confirmUsername`, release.ts แก้ docs-sync) · `[Unreleased]` ว่าง ✓
- `package.json` version = 0.15.0 · quickstart ท้ายหน้า `app v0.15.0` ✓ (docs-sync test ตรวจ)
- ARCHITECTURE: route manifest 73 แถวตามที่ระบุ + `POST /api/admin/groups/:gid/restore` · ไม่มี migration/env ใหม่ (ล่าสุด `0006`) ✓

## 2. DOCS_SYNC §3 ทีละข้อ
| ข้อ | ผล |
|---|---|
| CHANGELOG ครบรายการ | ✓ |
| quickstart ท้ายหน้า | ✓ v0.15.0 |
| PROGRESS "เหลือ" ไม่มีของเสร็จ + บรรทัดรุ่นล่าสุด | ✓ หลังแก้ — เดิมข้อ 0 ยังลิสต์ "ARCHITECTURE บรรทัด 10 ยังเขียนเสนอ v0.15.0" ทั้งที่ architect แก้แล้ว (`c98be99`) และ qa-r17 ข้อ 2 (ล้มทีละกลุ่ม) ARCHITECTURE ข้อ 5 เล่าแล้ว → ลบออก |
| NEXT_PHASE สถานะ R17 | ✓ หลังแก้ — บรรทัด 58 เดิม "contract R17 ยังไม่มี / มี migration" ล้าสมัย |
| PRD หมายเหตุรุ่น + ติ๊ก | ✓ "R0–R17" · ติ๊ก retention กลุ่ม [x], คำเชิญเก่า [ ] ตรงกับ PROGRESS |
| R17_CONTRACT บรรทัดปิดรอบ | ✓ มี "ปิดรอบ + ออกรุ่น v0.15.0 (2026-11-20)" แฮช/วันที่ตรง |
| รายงานวัน 2026-11-20 | ✓ หลังแก้ — หัวข้อ "เอกสารที่ยังไม่ตรง" ล้าสมัยแล้วเปลี่ยนเป็นปิดแล้ว · "ยังไม่ยืนยัน health" → qa ตรวจแล้ว |
| ARCHITECTURE ตรงโค้ด | ✓ บรรทัด 3/10/ตาราง/§3/§7/cron ระบุ v0.15.0 · ไฟล์อ้าง `group-retention.ts` `group-purge.ts` (`GROUP_RETENTION_START_DATE`, `GROUP_PURGE_BATCH` 25) |

grep ข้อความล้าสมัยของ R17 ("เสนอ v0.15.0", "ยังไม่ออกรุ่น", "กำลังทำ", "รอเริ่มหลัง R16", "contract R17 ยังไม่มี") ใน docs ที่ไม่ใช่รายงานประวัติ: เหลือเฉพาะ R12–R14 contract/รายงานเก่า (ประวัติ ไม่แตะ)

## 3. คำสั่งที่รัน
- `npx vitest run tests/ops/docs-sync.test.ts` → 1 file passed · **8/8 passed**
- `git diff --check origin/main..HEAD` → ไม่มีผล (exit 0)

## ข้อสังเกต
1. (Info) ข้อความใน PROGRESS บรรทัด 4 / รายงานวัน เดิมว่า health = 0.15.0 "main รายงาน เลขาไม่ได้ตรวจ" — qa ตรวจเองแล้ว ตรงกัน
2. (Info) ผล CI ของ `17918b8`/main ไม่ได้ตรวจ (ไม่ได้รัน `gh run list`) · ไม่ได้รันชุดเทสต์เต็ม (เครื่อง Windows)
