# qa — รอบหลังออกรุ่น v0.14.0 (`docs/release-0.14.0`)

> ผู้ตรวจ: qa (อิสระ) · 2026-11-19 · base `main` `7eaff23` · ตรวจ commit `0d7c649` `e3ef2c4` `14c8fd6` `3cdd304` `cc35bf8`

**Verdict: ผ่านแบบมีข้อสังเกต** (ไม่มี Critical/High/Medium · แก้ข้อความเอกสารที่ล้าสมัย 1 จุด)

## 1. DOCS_SYNC §3 (ตรวจเทียบ `git log 9db2c08..7eaff23`, R16_CONTRACT)
- CHANGELOG `[0.14.0] - 2026-11-19` มี H1–H4/H4b/H4c/H7, U1–U4, CI retries, config-hygiene, Notes (CSP/H5/H6, ไม่มี migration/env) — ตรง commit ที่ส่งจริง ✓
- quickstart ท้ายหน้า `app v0.14.0` ✓ · PRD "สถานะปัจจุบัน" v0.14.0 R0–R16 ✓ · R16_CONTRACT มีบรรทัด "ปิดรอบ + ออกรุ่น v0.14.0" ✓
- NEXT_PHASE: R16 = ออกรุ่น v0.14.0, ถัดไป R17 ✓ · รายงานวัน `2026-11-19.md` มีหัวข้อออกรุ่น ✓ · ARCHITECTURE v0.14.0 (ไม่มี route/migration/env ใหม่; docs-sync test ผ่าน) ✓
- PROGRESS "เหลือ": ไม่มีของที่เสร็จแล้ว · ข้อ 1 "ค้างจาก qa/security R16" **ไม่ stale** — qa-r16 Info 1 (ปฏิทินกลืน 429, `CalendarView.tsx:238`), คำแนะนำ render test ของ i18n namespace, security-r16 Info 1–5 ล้วนเป็นข้อสังเกตที่รายงานระบุว่าไม่แก้ในรอบนั้นและยังไม่มี commit ปิด (Info 6 ถูกระบุว่าลบแล้วตามรายงาน) ✓

## 2. `scripts/release.ts`
- แทนที่เฉพาะเลขรุ่นด้วย index ช่วง `[start,end)` ของ match (`locateDocVersion`) ไม่ re-serialize ไฟล์ → ข้อความอื่นและ CRLF คงเดิม (ตัดบรรทัดด้วย `\n` เหลือ `\r` ในบรรทัด offset ยังถูก) ✓ มีเทสต์ CRLF
- quickstart ใช้ match สุดท้ายของ `app vX.Y.Z`; PRD/PROGRESS ใช้ `vX.Y.Z` แรกในบรรทัดแรกที่มี keyword — ตัวเดียวกับที่ docs-sync test ใช้ (`DOC_VERSION_TARGETS` ร่วมกัน) ✓
- หาไม่เจอ/ไม่มีไฟล์ → ใส่ใน `docVersionMissing` → check `docs-version` ล้ม → `!pre.ok` return 1 **ก่อน** เกตและก่อน `writeFileSync` ✓ (เทสต์ 2 ข้อ)
- rollback: `files` (CHANGELOG, package.json, lock, 3 เอกสาร) ถูกเขียน/คืนในลูปเดียวกัน → คืนครบก่อน commit ✓
- dry-run จริง: `npx tsx scripts/release.ts 0.14.1 --dry-run --skip-gates` → พบตำแหน่งครบ 3 ไฟล์ ("พบตำแหน่งเลขรุ่นในเอกสารครบ") diff เปลี่ยน 1 บรรทัดต่อไฟล์ (quickstart `app v0.14.0→v0.14.1`, PRD, PROGRESS) · ล้มข้อเดียวคืออยู่ branch `docs/release-0.14.0` (ไม่ใช่ main — ตามที่ออกแบบ) · `git status` สะอาดหลังรัน, ไม่มี tag `v0.14.1` ✓ (ไม่ได้รัน release จริง)

## 3. คำสั่งที่รัน (Windows)
- `npx eslint . --ignore-pattern ".claude/**"` → 0 problems · `npx tsc --noEmit` → ไม่มี error
- `npx vitest run tests/ops tests/release` → 4 files fail / 7 pass · 10 failed / 108 passed / 17 skipped — ที่ล้มทั้งหมดเป็นปัญหาเครื่องเดิม: `release.test` 2 ข้อ (CLI ผ่าน tsx: `.bin/tsx` ENOENT), `pepper-fingerprint-script` 4, `admin-reset-pin-script` 3 (subprocess), `health` 1 (argon2/Node) · **docs-sync 8/8 ผ่าน** · ข้อใหม่ DOCS_SYNC §7 ใน `release.test` 7/7 ผ่าน
- ไม่ได้รัน `npm test` ทั้งชุด และไม่ได้เทียบ main `7eaff23` ด้วยการรันซ้ำ (เครื่อง Windows EPERM/timeout; ชุดที่ล้มไม่เกี่ยวกับไฟล์ที่ branch นี้แก้ ยกเว้น `release.test` ซึ่ง 2 ข้อที่ล้มเป็น ENOENT ของ tsx ก่อนถึงโค้ด) — ผลจริงดูจาก CI

## ข้อสังเกต
1. (Info) บรรทัด PROGRESS "อัปเดตล่าสุด" แทนเฉพาะ `vX` แรก → หลังออกรุ่น ข้อความข้างๆ จะขัดกัน (เช่น "v0.14.1 ออกแล้ว (tag v0.14.0 → …)") จนกว่า secretary จะเขียนบรรทัดใหม่ — ตั้งใจให้เป็นงานเลขาตาม §3 แต่ test ผ่านทันที
2. (Info) เทสต์ที่ผูกกับ "vX แรกของบรรทัด": ถ้าเลขาย้ายลำดับในบรรทัดให้รุ่นเก่าขึ้นก่อน script/test จะอ่านตัวนั้น (สอดคล้องกันทั้งคู่ จึงไม่เพี้ยน แต่ความหมายผิด)
3. (แก้แล้ว) `docs/reports/2026-11-19.md` ยังเขียนว่า ops "ยังไม่ commit" ทั้งที่ commit แล้ว → แก้ข้อความ (commit `qa:` ใน branch นี้)
