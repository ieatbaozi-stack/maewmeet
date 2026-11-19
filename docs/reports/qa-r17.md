# QA R17 — ลบแล้วเก็บ 30 วัน กู้คืนกลุ่ม + ยืนยันลบหนักขึ้น

> ผู้ตรวจ: qa (อิสระ) · branch `feat/r17-retention` · รวม 777ae9e (แก้ Low 1 ของ security) · ตรวจ 2026-11-19/20

## Verdict: ผ่าน (มีข้อสังเกต 3 ข้อ ไม่ขวาง merge)

## ตรวจตาม contract
| ข้อ | ผล | หลักฐาน |
|---|---|---|
| G1 restore route | ผ่าน | route + action `admin.group.restore` (SA only, 403) · เทสต์ `tests/platform/r17-group-retention.test.ts` ผ่าน |
| G2 purge + B2 | ผ่าน | `GROUP_RETENTION_START_DATE=2026-12-01` · 777ae9e: try/catch ต่อกลุ่ม, `failed`, json_valid guard, log เฉพาะ id+code · เทสต์ใหม่ผ่าน |
| G3/G4/G5 | ผ่าน | e2e r17-group-restore ผ่าน · ข้อความ TH/EN อ่านแล้วเป็นธรรมชาติ · plural EN ถูก |
| A1 | ผ่าน | หน้า info: เตือน "กู้คืนไม่ได้ แม้แต่ผู้ดูแลระบบ" + รายการ LINE · พิมพ์ชื่อผู้ใช้ก่อนปุ่มแดงกดได้ · โฟกัสเริ่มที่ "ยกเลิก" · เซิร์ฟเวอร์ตรวจ `confirmUsername` ก่อนจอง/verify PIN (`account.ts`) → 400 VALIDATION ไม่นับ PIN ผิด · UI กลับขั้น 1 พร้อม `role="alert"` + `aria-invalid`/`aria-describedby` · ไม่สะท้อนชื่อจริงใน error |
| A2 | ผ่าน | พิมพ์ชื่อกลุ่มเดิม + ข้อความ 30 วัน |
| A3 | ผ่าน | `RoutineScopeSheet` "from" มี ConfirmDialog (`confirmFrom`) · ตาราง ux 23 แถว: ไม่เหลือจุดหายถาวร-หลายวัน-ไม่ยืนยัน · ข้อ 6/8 (1 วัน ผ่าน chooser), 15/16 (ไม่มีข้อมูลสูญ) เป็นการตัดสินใจของ ux — boss อาจเข้มกว่านี้ได้ (เสนอ main) |
| §8 | ผ่าน | ไม่มี migration · 403 · rbac แตะ 6 บรรทัดตามที่ระบุ |
| ไม่มี hard-code / ไม่ถอยหลัง | ผ่าน | ข้อความทั้งหมดผ่าน messages · เทสต์เดิมที่แก้ (`delete`, `account.spec`, helper) แก้แค่ส่ง `confirmUsername` ไม่ลดเกณฑ์ |

## คำสั่งที่รันจริง
- `npm run lint` → ไม่มี error · `npm run typecheck` → ผ่าน · `npm run build` → สำเร็จ
- `npx vitest run tests/platform/r17-group-retention.test.ts tests/account tests/ui/r17-restore-delete-model.test.ts` (หลัง 777ae9e) → 4 files, 67 tests ผ่าน
- vitest โฟลเดอร์ที่แตะ (platform account ui admin rbac notifications i18n auth) → 3828/3830 ผ่าน; 2 ที่ล้ม (`admin/search`, `auth/security-r1`) คือ timeout 5 วิ ของเครื่อง — รันซ้ำ `--testTimeout=60000` ผ่านทั้ง 21
- `npx vitest run` ทั้งชุด → 5874 ผ่าน / 13 ล้ม / 19 skip ใน 7 ไฟล์: release CLI (tsx ENOENT), ops scripts (subprocess), health, free-time (python oracle), และ timeout (`r4b-hardening`, `security-r1`, `invite-code`, `admin/search`) — ไม่มีไฟล์ไหนเกี่ยวกับ R17 · เป็นปัญหาเดิมของเครื่อง Windows ผลจริงดู CI
- `npx playwright test r17-group-restore account r14b-busy-routine --workers=2` → 55 passed, 14 skipped (3.8m)
- `npx playwright test r5-layout admin --workers=2` → 29 passed, 10 skipped (2.7m)
- skip = เคสที่ spec กำหนดให้ข้ามบางโปรเจกต์ (ไม่ใช่ fail)

## ข้อสังเกต
1. (ต่ำ, แก้แล้ว) ADR 0015 §4 และ ARCHITECTURE บรรทัด R17 purge ยังเขียน `purgedGroups: {groups, remaining}` หลัง 777ae9e เพิ่ม `failed` → แก้เป็น `{groups, failed, remaining}` (commit qa)
2. (ข้อมูล) ARCHITECTURE/ADR ยังไม่เล่าเรื่อง "ล้มทีละกลุ่ม rollback เฉพาะกลุ่ม" — OPERATIONS (K2) เล่าไว้แล้ว ถ้า architect อยากเติมได้
3. (ข้อมูล) B2: `GROUP_RETENTION_START_DATE = 2026-12-01` — ถ้าออกรุ่นหลัง 1 ธ.ค. ต้องเลื่อนก่อน merge · เลขรุ่นใน package/README/CHANGELOG ยังเป็น v0.14.0 ตามที่กำหนด (CHANGELOG มีส่วน Unreleased)

## ตรวจไม่ได้ / ไม่ได้ทำ
- ภาพหน้าจอรายหน้าจอ (375/768 × TH/EN × สว่าง/มืด) ของ sheet ใหม่: ไม่ได้ถ่ายแยกเก็บในรอบนี้ · อาศัย `r5-layout` e2e (ตรวจ overflow/ layout 375/390/768 × th/en × light/dark ผ่านทั้งหมด) + e2e r17 ที่เดินหน้าจอจริง · คอนทราสต์ใช้ token เดิมที่ผ่าน CONTRAST.md (`btn-danger`, `alert-warn`) ไม่มีสีใหม่
- ไม่ได้รันบน CI/Linux
