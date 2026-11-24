# QA `fix/post-v1.1-polish` — เก็บตกหลัง v1.1.0 (ปุ่มเลือกเร็ว ICS + ADR 0017 + ผลเครื่องจริง + DOCS_SYNC)

> ผู้ตรวจ: qa (แชตใหม่) · Antigravity · **Gemini 4 Neon** *(ใช้โมเดลเดียวกับผู้ทำตามที่ boss อนุมัติยกเว้นเป็นกรณีพิเศษเมื่อ 2026-11-24 เนื่องจากงานฝั่ง Claude Code แน่น; ตาม `AGENTS.md` §6 ปกติควรเป็นคนละโมเดล)* · branch `fix/post-v1.1-polish` HEAD `ed916c0` (เทียบ `main` `a36b9b2`) · ตรวจ 2026-11-24 · ระดับงาน **A** (UI model + unit/E2E test + เอกสาร · ไม่แตะ `src/app/api/**`, `src/lib/auth/**`, `src/lib/rbac/**`, schema/migration, ข้อมูลคน หรือความลับ)

## Verdict: ผ่าน
ตรวจครบทุกข้อของ contract ย่อ (`git diff main...HEAD` 10 ไฟล์ across 5 commits แยกตามบทบาท) และรันคำสั่งตรวจซ้ำเองทั้งหมด — **ไม่พบ 🔴 Blocker และไม่พบ 🟡 ควรแก้** · มีเพียง 1 🟢 ข้อสังเกตเล็กเรื่องข้อความสถานะก่อน QA ในเอกสารทีม (ปกติของ pre-QA commit ไม่บล็อก merge) · พร้อมเปิด PR (Ready for review) เข้า `main` ให้ CI ตรวจเต็มและรอ boss merge

---

## ข้อพบ (เรียงตามความรุนแรง)

- 🔴 **Blocker:** ไม่มี
- 🟡 **ควรแก้:** ไม่มี
- 🟢 **ข้อสังเกต (ไม่บังคับ):**
  1. `docs/team/HANDOFF.md:196, 204`, `docs/team/PROGRESS.md:220`, `docs/reports/2026-11-24.md:66` ระบุสถานะช่วงก่อน QA ว่า "รอ QA อิสระคนละโมเดล (`AGENTS.md` §6) ตรวจก่อนเปิด PR" (เป็นสถานะจริง ณ เวลาที่ `secretary` commit ก่อน QA รัน) — หลัง boss merge แล้ว `secretary` สามารถอัปเดตสถานะเป็น merged ในรอบปิด/รอบถัดไปตามปกติ

---

## ตรวจตาม contract ย่อ

| ข้อ | ผล | หลักฐานที่ตรวจจริง |
|---|---|---|
| 1. ปิดปุ่มเลือกเร็ว `IcsImportSheet` ตอน `allDuplicates` / โควตา 0 / `selectedCount` 0 | **ผ่าน** | `src/components/busy/ics-import-model.ts:38-44` (`icsBulkActionDisabled`): `selectAll` ปิดเมื่อ `loading \|\| submitting \|\| allDuplicates \|\| quotaRemaining <= 0` และ `selectNone` ปิดเมื่อ `loading \|\| submitting \|\| selectedCount <= 0` · `IcsImportSheet.tsx:166-172, 419, 428` ผูกค่าเข้าปุ่ม `ics-select-all` และ `ics-select-none` ครบ และลบ `initialSelection` เดิมออกแล้ว · กรณี `allDuplicates` แต่ผู้ใช้ติ๊กเลือกรายการซ้ำเอง 1 รายการ ปุ่ม "ไม่เลือก" เปิดให้ล้างได้ส่วน "เลือกทั้งหมด" ยังคงปิด (ไม่เผลอล้างรายการที่ผู้ใช้เลือกเอง) · กรณี `items.length === 0` บล็อก `.ics-bulk-actions` ไม่ถูกเรนเดอร์ (แสดง empty state) |
| 2. Unit test + E2E test ครอบคลุม | **ผ่าน** | `tests/ui/ics-import-model.test.ts` (9 เคส: `initialIcsSelection` ปกติ/cap 0/cap ติดลบ/ซ้ำหมด + `icsBulkActionDisabled` ปกติ/`allDuplicates` 0 และ 1/โควตา 0/`selectedCount` 0/`loading`/`submitting`) และ `tests/e2e/ics-import.spec.ts:148-158` (ตรวจ disabled ตอนซ้ำหมด + ติ๊กเองแล้ว `selectNone` เปิดและกดล้างได้ while `selectAll` ยังปิด ครบทั้ง `LOCALES × THEMES × 3 viewports`) · รันซ้ำเองผ่านทั้งหมด |
| 3. แก้ตัวเลข bind parameter ใน ADR 0017 เป็น `809 < 999` | **ผ่าน** | `docs/adr/0017-ics-import.md:72` แก้จาก `7 × 100 + 8 = 708` เป็น `8 × 100 + 9 = 809 < 999` · ตรวจเทียบโค้ดจริงใน `src/lib/data/repos/busy.ts:219-247` + `windowCount` (`:63`): `values` 8 พารามิเตอร์/แถว × 100 = 800 + พารามิเตอร์เดี่ยว 9 ตัว (`userId` 3 จุด, `hideFlag`, `now` 2 จุด, `windowCount` 2 ตัว, `cap`) = **809** ตรงเป๊ะ |
| 4. จดผลทดสอบเครื่องจริง boss และซิงก์ DOCS_SYNC | **ผ่าน** | `docs/reports/r18-boss-device-checklist.md` จดผลผ่านครบ 6 ข้อ + ตารางสรุป 2026-11-24 · `CHANGELOG.md` เพิ่มรายการใต้ `[Unreleased]` · `docs/team/PROGRESS.md`, `docs/team/HANDOFF.md`, `docs/reports/2026-11-24.md` ซิงก์ตรงกัน · `docs-sync.test.ts` และ `operations-doc.test.ts` ผ่าน |

---

## Code review (9 ข้อ ตาม `.claude/agents/qa.md`)

| ข้อ | ผล | หมายเหตุ |
|---|---|---|
| 1. ตรง contract / ขอบเขตบทบาท | ผ่าน | 5 commits แยกตามบทบาทชัดเจนตรง `AGENTS.md` §4: `4f9a194` (`frontend`: `src/components/busy/*`), `cd57f6d` (`test`: `tests/ui/*`, `tests/e2e/*`), `1699b3c` (`architect`: `docs/adr/*`), `853ad4c` (`ops`: `CHANGELOG.md`), `ed916c0` (`secretary`: `docs/team/*`, `docs/reports/*`) · อีเมล noreply และ conventional commits ถูกต้องทุกตัว |
| 2. ถูกจริง / edge cases | ผ่าน | `initialIcsSelection` กัน `maxSelectable <= 0` ด้วย `Math.max(0, maxSelectable)` · `icsBulkActionDisabled` ครอบทุกสถานะ `loading`, `submitting`, `allDuplicates`, `quotaRemaining <= 0`, `selectedCount <= 0` และพฤติกรรมตอนผู้ใช้ติ๊กเลือกรายการซ้ำเอง |
| 3. สถาปัตยกรรม | ผ่าน | แยก pure UI model (`ics-import-model.ts`) ไว้ในโฟลเดอร์คอมโพเนนต์ ไม่มี side effect ไม่ข้ามชั้น ไม่สร้างของซ้ำ |
| 4. คุณภาพโค้ด | ผ่าน | อ่านง่าย ชื่อชัด TypeScript strict ไม่มี `any` ไม่มีโค้ดตาย/debug/TODO ไร้เจ้าของ |
| 5. คุณภาพเทสต์ | ผ่าน | Unit 9 เคส + E2E ครอบทั้ง 3 viewport (375/390/768) × TH/EN × สว่าง/มืด · ไม่ mock กลวง ไม่ flaky (15/15 ผ่านใน 14.3s) |
| 6. กฎเหล็ก | ผ่าน | ไม่ hard-code ข้อความ UI · ไม่มีค่าสี/px นอก token · ไม่มีความลับ · ไม่มี migration · ไม่แตะ API/auth/RBAC (ระดับ A แท้) |
| 7. ประสิทธิภาพ | ผ่าน | Pure helper O(n) น้ำหนักเบา ไม่เพิ่ม query หรือโหลดซ้ำ |
| 8. เอกสาร (DOCS_SYNC) | ผ่าน | อัปเดตครบทุกไฟล์ที่เกี่ยวข้อง (`CHANGELOG.md`, `docs/adr/0017-ics-import.md`, `r18-boss-device-checklist.md`, `PROGRESS.md`, `HANDOFF.md`, `2026-11-24.md`) · `docs-sync.test.ts` + `operations-doc.test.ts` ผ่าน |
| 9. ความปลอดภัยที่เห็นชัด | ผ่าน | ไม่พบจุดเสี่ยง (pure UI state + tests + docs · ไม่แตะฝั่งเซิร์ฟเวอร์/สิทธิ์/ข้อมูลคน) |

---

## Anti-slop / Responsive / a11y (`UI_DIRECTION.md`)
- ไม่มีการเปลี่ยนแปลงข้อความ UI, CSS หรือ token สี — ยืนยันซ้ำด้วย `check-style-literals.sh src` ผ่าน (`ไม่มีค่าสี hex / px นอก tokens`), `contrast.mjs` ผ่าน 338/338 คู่ (ต่ำสุด 4.54:1)
- ปุ่ม `ics-select-all` และ `ics-select-none` ใช้ native `disabled` บน `<button type="button" className="btn btn-secondary">` ตามระบบเดิม (เป้าแตะ ≥ 44px) และผ่าน E2E `assertNoOverflow` ครบ 375 / 390 / 768 × TH / EN × สว่าง / มืด

---

## คำสั่งที่รันซ้ำเอง + ผลจริง (เครื่อง Windows, HEAD `ed916c0`)

| คำสั่ง | ผลจริง |
|---|---|
| `npm run lint` (`eslint .`) | **ผ่าน** (exit 0) |
| `npx eslint tests/e2e/ics-import.spec.ts tests/ui/ics-import-model.test.ts` | **ผ่าน** (exit 0) |
| `npm run typecheck` (`tsc --noEmit`) | **ผ่าน** (exit 0) |
| `bash -c "tr -d '\r' < .github/scripts/check-style-literals.sh \| bash -s -- src"` | **ผ่าน** (`src: ไม่มีค่าสี hex / px นอก tokens`) |
| `bash -c "tr -d '\r' < .github/scripts/check-env-example.sh \| bash -s -- .env.example"` | **ผ่าน** (`.env.example: ไม่มีค่าลับ`) |
| `node docs/design/tools/contrast.mjs` | **ผ่าน** (338 คู่ · ไม่ผ่าน 0 · ต่ำสุด 4.54:1) |
| `npm run build` (`next build`) | **ผ่าน** (51/51 pages · exit 0) |
| `npx vitest run tests/ui/ics-import-model.test.ts tests/calendar/ics-import.test.ts tests/busy/ics-import-api.test.ts tests/i18n/messages.test.ts tests/i18n/no-hardcoded-text.test.ts tests/i18n/render.test.ts tests/ops/docs-sync.test.ts tests/ops/operations-doc.test.ts --reporter=agent --testTimeout=60000` | **ผ่าน 8 ไฟล์ / 291 tests** (6.81s) |
| `npx vitest run tests/ui/ tests/i18n/ tests/ops/docs-sync.test.ts tests/ops/operations-doc.test.ts tests/calendar/ics-import.test.ts tests/busy/ics-import-api.test.ts --reporter=agent --testTimeout=60000` | **ผ่าน 47 ไฟล์ / 1,023 tests** (7.73s) |
| `npx vitest run tests/ui/ tests/i18n/ tests/ops/ tests/calendar/ics-import.test.ts tests/busy/ics-import-api.test.ts --reporter=agent --testTimeout=60000` | **ผ่าน 50 ไฟล์ / 1,078 tests · ล้ม 5 ไฟล์ / 15 tests (ปัญหาเฉพาะเครื่อง Windows ทั้งหมด ไม่เกี่ยวกับรอบนี้):** `admin-reset-pin-script.test.ts` (3, `.bin/tsx` ENOENT), `pepper-fingerprint-script.test.ts` (4, `.bin/tsx` ENOENT), `ci-docs-skip.test.ts` (3, Windows path กับ `bash`), `health.test.ts` (1, เครื่องเป็น Node `v26.13.0` ไม่ใช่ `v24.`), `manual-delete-sql.test.ts` (4, CRLF บน `docs/OPERATIONS.md` ซึ่งไม่ได้แก้ในรอบนี้) |
| `$env:PW_CHROMIUM_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"; $env:E2E_PORT="3127"; npx playwright test tests/e2e/ics-import.spec.ts --reporter=line --workers=4` | **ผ่าน 15/15** (14.3s · 375/390/768 × TH/EN × light/dark) |

---

## สิ่งที่ตรวจไม่ได้
- ไม่ได้รัน `npm test` ทั้งชุดในเครื่อง Windows และ 5 ไฟล์ใน `tests/ops/` ล้มจากข้อจำกัดเฉพาะเครื่อง Windows (`AGENTS.md` §9 — ยึดผล CI บน PR เป็นหลัก)
- รอบนี้ใช้โมเดลเดียวกับผู้ทำ (**Gemini 4 Neon**) ตามการอนุญาตยกเว้นของ boss เมื่อ 2026-11-24
