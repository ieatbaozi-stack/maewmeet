# QA — รอบเคลียร์เอกสาร `docs/sync-r15` (DOCS_SYNC §2–§6)

ผู้ตรวจ: qa · ตรวจ `git diff 8af88ee..HEAD` (HEAD ตอนตรวจ `2bc7808`) · เครื่อง Windows, Node v26.13.0

## Verdict: ผ่านแบบมีข้อสังเกต
ไม่มี Critical/High · เอกสารตรงของจริงที่ v0.13.0 ทุกข้อที่สุ่ม · แก้ 1 จุดในเทสต์ docs-sync (ช่องโหว่ของตัวตรวจ route) ใน commit `qa:`

## ข้อพบ (เรียงความรุนแรง)
1. **Medium (แก้แล้ว)** — `tests/ops/docs-sync.test.ts` ข้อ route ตรวจแค่ "path โผล่ที่ไหนก็ได้ในไฟล์" + ทางลัด "path แม่ + ท้าย path ที่ไหนก็ได้" · ลบแถว `GET /api/admin/users` ออกจากตารางข้อ 5 เทสต์ยังผ่าน (path ยังอยู่ในข้อความอื่น 3 ที่) และลบแถว `PUT /api/groups/:gid/icon` ก็ผ่าน · แก้ให้ตรวจเฉพาะส่วน "## 5. API" และต้องเป็น `` `METHOD /path` `` (ตรงทั้ง 72 route ของ manifest ไม่ต้องแก้ ARCHITECTURE) · ยืนยันแล้วว่าลบแถวทั้งสองกรณีล้มพร้อมข้อความ `ข้อ 5 ขาดแถว route … GET /api/admin/users`
2. **Low** — `docs/reports/2026-11-18.md` บรรทัด "[Unreleased] … ops กำลังแก้ working tree ยังไม่ commit" ล้าสมัยแล้ว (ops commit `de54f16`) และ `docs/team/PROGRESS.md` ข้อ 0 ยังเขียน "qa: ยังไม่มีไฟล์", "architect (ยังไม่ยืนยัน)", "ADR 0001–0009" ทั้งที่ ARCHITECTURE ทำแล้ว (ADR 0001–0013 Accepted) · ให้ secretary อัปเดตก่อน merge (ไม่แก้เอง — ไฟล์ของ secretary)
3. **Low** — ตัวตรวจตารางจับแค่ "ชื่อตารางมีในไฟล์" (ลบชื่อ `group_invite` จนไม่เหลือเลยล้มถูกต้อง แต่ชื่อที่ยังโผล่ในย่อหน้าอื่นจะผ่าน) · ยอมรับได้
4. **Info** — lockfile เพิ่มแพ็กเกจใหม่ `@isaacs/nonrecursive-glob-match` (dependency ของ minimatch 11.0.1) และ `@esbuild/*` 0.25.12 ใต้ `@esbuild-kit/core-utils` เท่านั้น · ไม่แตะอย่างอื่น (ให้ security ยืนยัน)

## 1. ข้อเท็จจริงที่สุ่มยืนยันกับโค้ด (ตรง ทุกข้อ)
เลขรุ่น 0.13.0 (package.json = CHANGELOG = quickstart = PRD = PROGRESS; tag `v0.13.0` → `964a6f5`) · ไอคอนกลุ่ม 24 (`src/components/icons/group-icons.ts`) · routes 72 = จำนวน `path:` ใน manifest = 72 แถวตารางข้อ 5 · ตารางใน schema 20 ทุกตารางมีชื่อใน ARCHITECTURE · migration 0000–0006 · bucket `busy:update` 60/10 นาที, `group:membership` 30/ชม., `group:icon` 30/10 นาที, `busy:routine` 20/10 นาที (`src/lib/shared/limits.ts`) · OA cap `oaPerMonth: 300` + รหัส `LINE_OA_CAP` · `group:icon` นับเฉพาะเมื่อค่าเปลี่ยน (`services/groups.ts:219-222`) · cron: `0 19 * * *` daily, `*/15 * * * *` reminders (Asia/Bangkok), keepalive `17 */12 * * *` · retention notification/outbox 90 วัน, routine 90+3 · `.env.example` มี `TRUST_PROXY_HEADERS`/`SERVER_TIMING_ENABLED` และอยู่ใน OPERATIONS · ADR 13 ไฟล์ Accepted ทั้งหมด · next.config.ts คอมเมนต์ Leaflet แก้แล้ว

## 2. §5 / §3
§5: secretary (PROGRESS, NEXT_PHASE, quickstart v0.13.0 + แถวข้อจำกัด LINE 300, SECRETARY, PROCESS, TEAM, README LINE, รายงาน 2026-11-18) ทำครบ · ops (CHANGELOG R15b, R*, OPERATIONS repo public/keepalive 60 วัน/bucket/OA cap/env/Dependabot, next.config, ci-artifacts แก้ไว้แล้วใน `7d5ed24`, docs-sync) ครบ · architect (ARCHITECTURE + ADR 0001–0009) ครบ · ux (R14 doc:152, samples/templates create ไม่มีค้นหาสถานที่ — grep ไม่พบ) ครบ · main (สถานะ R14/R15 contract = "ปิดรอบแล้ว") ครบ
§3 ทั้ง 8 ข้อ: CHANGELOG ✓ · quickstart ท้ายหน้า ✓ · PROGRESS บรรทัดรุ่น ✓ (ข้อสังเกต 2) · NEXT_PHASE ✓ · PRD หมายเหตุ v0.13.0 ✓ · R14/R15 contract ✓ · รายงานวันที่ออกรุ่น ✓ · ARCHITECTURE ✓

## 3. เทสต์ docs-sync (ทำให้ล้มจริงแล้ว revert ทุกครั้ง)
- `npx vitest run tests/ops/docs-sync.test.ts` → 8 passed
- quickstart `app v0.13.0`→`v0.12.0` → ล้ม: "quickstart-th.html ท้ายหน้าเป็น v0.12.0 แต่ package.json เป็น v0.13.0"
- เปลี่ยนชื่อ route `/icon` ทุกที่ใน ARCHITECTURE → ล้ม ระบุ `/api/groups/:p/icon`
- ลบชื่อตาราง `group_invite` → ล้ม "ขาดตาราง: group_invite (สร้างใน drizzle/0000_init.sql)"
- เปลี่ยนบรรทัด Status ADR 0003 เป็น Draft → ล้ม · ใส่ "Draft proposed ร่าง" ในเนื้อ ADR (ไม่ใช่บรรทัด Status) → ผ่าน (ADR check ดูเฉพาะบรรทัด Status ✓; บรรทัดจริง "Accepted … เสนอ Proposed" ผ่านถูกต้อง)
- เปลี่ยนตัวแปรแรกใน `.env.example` → ล้ม "OPERATIONS.md ขาดตัวแปร: ZZ_NEWVAR"
- หลังแก้ตามข้อพบ 1: ลบแถวตาราง 2 กรณีล้มถูกต้อง · `npx eslint tests/ops/docs-sync.test.ts` + `npx tsc --noEmit` ผ่าน

## 4. docs/design/samples (Playwright chromium, 375×800)
create, group, members, appt-detail, home, group-settings, groups × TH/EN × สว่าง/มืด = 28 ชุด: scrollWidth ไม่เกินจอ (overflow 0), ไม่มี `data-missing` (คีย์ EN ครบ), ไม่มี error/warning ใน console, **ไม่มี input ค้นหา** ในทุกหน้า · create มีแค่ชื่อสถานที่ + ช่องลิงก์แผนที่ (ภาพ create-en-dark) · อวาตาร์มีสีและรูปทรงต่างกันต่อสมาชิก (ภาพ members/group/appt-detail) · แถบนาวด้านล่างเป็น sticky จึงทับกลางภาพ fullPage — ไม่ใช่บั๊ก

## 5. คำสั่งที่รัน (ผลจริง)
- `npm run typecheck` → ผ่าน · `npm run lint` → ผ่าน · `npm run build` → ผ่าน
- `npx vitest run tests/ops tests/release` บน HEAD → 10 failed | 101 passed | 17 skipped · ล้มทั้งหมดเป็นสาเหตุเครื่อง: tsx subprocess (`.bin/tsx` ENOENT / exit null) ใน admin-reset-pin-script, pepper-fingerprint-script, release.test (2 ข้อ) และ health.test (Node v26 ≠ v24)
- เทียบ `8af88ee` (git worktree ชั่วคราว ลบแล้ว): 14 failed | 89 passed — ชุดที่ล้มบน HEAD เป็นสับเซตของชุดที่ล้มบน base (base ล้มเพิ่ม manual-delete-sql 4 ข้อ ซึ่งผ่านบน HEAD เพราะ ops แก้ retry ลบ temp DB บน win32) → ไม่มีอะไรถอยหลัง
- ไม่ได้รัน `npm test` ทั้งชุดและ e2e (ปัญหาเดิมบน Windows) · ผล CI ดูจาก GitHub

## 6. ภาษา
README (แถว LINE) และ quickstart (แถว "ค้นหาในแอป", "ข้อจำกัด") อ่านเป็นธรรมชาติ ไม่แปลตรงตัว · ตัวเลข 300/เดือนตรงกับโค้ด · ข้อความ UI/EN ไม่ถูกแตะในรอบนี้
