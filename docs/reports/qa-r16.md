# qa-r16 — ตรวจอิสระ R16 (เก็บงานค้าง: hardening · UI · เทสต์/CI · เอกสาร)

ผู้ตรวจ: qa · branch `feat/r16-cleanup` (ฐาน `9db2c08`, HEAD ที่ตรวจ `1f9670d`) · Windows, Node v26 · 2026-11-19
ขอบเขต: R16_CONTRACT H1–H7, U1–U4, T1–T2, §4 เอกสาร, §5 ผลตัดสิน, §6 · security ตรวจแยก

## Verdict: ผ่านแบบมีข้อสังเกต
ไม่พบบั๊กที่ต้องแก้ · ไม่มีการแก้โค้ดโดย qa · ข้อสังเกตเป็น Info (ท้ายรายงาน)

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run contrast` | 338 คู่ ไม่ผ่าน 0 (ต่ำสุด 4.54:1) · บล็อกมืดตรงกับ prefers-color-scheme |
| `npm run build` | ผ่าน |
| `vitest run tests/platform tests/groups tests/ui tests/security tests/ops tests/perf tests/notifications tests/account` | 101 ไฟล์: 98 ผ่าน / 3 ล้ม · 1785 ผ่าน / 8 ล้ม / 19 skip · ที่ล้มทั้งหมดอยู่ใน `tests/ops` (ไฟล์ที่ R16 ไม่ได้แตะ): `pepper-fingerprint-script` (4) และ `admin-reset-pin-script` (3) = subprocess `tsx` คืน exit null บน Windows · `health` (1) = `process.version` v26.13.0 ไม่ตรง `/^v24\./` (เทสต์ล็อก Node 24) — ล้วนเป็นปัญหาเครื่อง ไม่ใช่โค้ด R16 |
| `vitest run tests/security/config-hygiene.test.ts` (รวม T2) | 15 ผ่าน (ไม่ล้มเรื่อง CRLF ในรอบนี้) |
| `playwright test r6e-loading r15a-feedback account` (3 project) | 46 ผ่าน / 26 skip / 0 ล้ม |
| `playwright test r14b-busy-routine groups-story groups-guards groups-responsive r11-notifications shell` (3 project) | 297 เทสต์: 277 ผ่าน / 20 skip / 0 ล้ม (r14b ที่ frontend รันไม่จบ รันจบแล้ว) |
| `playwright test r15a-feedback -g "step3\|skip (th/light\|en/dark)"` (เก็บภาพ) | 12 ผ่าน |
| สเปกชั่วคราวของ qa (ลบแล้ว ไม่ commit) ยิงเกินจริงบน `next start` | ดูหัวข้อ rate limit |

## เกณฑ์ contract ทีละข้อ
- **H1** ผ่าน: PATCH กลุ่มของตัวเอง ครั้งที่ 31 (นับรวม PATCH ตอนสร้าง) = 429 `RATE_LIMITED` + `Retry-After: 395` · คนนอกกลุ่มได้ 404 x30 แล้ว 429 ที่ครั้ง 31 (นับก่อน NOT_FOUND ตามสัญญา)
- **H2** ผ่าน: `POST /api/prefs` ครั้งที่ 61 (ล็อกอิน) = 429 + `Retry-After: 394` ไม่มี `Set-Cookie` · ไม่ล็อกอินยิง 70 ครั้ง = 200 ทั้งหมด (ไม่นับ) · client `usePrefs` แสดง `errors.RATE_LIMITED` และคืนธีมเดิม
- **H3** ผ่าน: `GET /api/me/invites` 600 ครั้งแรก = 200, ครั้งที่ 601 = 429 + `Retry-After: 390` + `Cache-Control: private, no-store` · หลังถูกบล็อก `/api/health` ยัง 200 · e2e ทั้งชุดที่รัน (ข้างบน) ไม่มี 429
- **H4/H4b** ผ่าน: super admin นอกกลุ่มเชิญตรง → แจ้งเตือน "ผู้ดูแลระบบ ชวนคุณเข้ากลุ่ม …" / "System admin invited you to …" และการ์ดในหน้า กลุ่ม แสดงป้ายเดียวกัน · `GET /api/me/invites` คืน `inviterName:""` + `actorSystemAdmin:true` ไม่มีชื่อบัญชีจริงใน body (ตรวจ th/light และ en/dark ที่ 375)
- **H5, H6** บันทึกเหตุผลใน §6 แล้ว (ไม่แก้/ทำไม่ได้) · เหตุผลสมเหตุสมผล ตรงกับ OPERATIONS และ NEXT_PHASE
- **H7** ผ่าน: `repos/group-invite.ts` เพิ่มเงื่อนไขสถานะผู้รับใน INSERT เดียว + service แปลง `invitee_gone` เป็น USER_NOT_FOUND · เทสต์ `tests/groups/r16-direct-invite-race.test.ts` ผ่านในชุด `tests/groups`
- **U1** ผ่าน (ดูภาพ `r15a-step3-done-en-dark-mobile-375.png`): "Done" + "Take another look" อยู่ใต้ชื่อขั้น เยื้องตรงกับชื่อ ไม่ลงชิดซ้ายใต้ไอคอน · th/light ผ่านใน e2e เดียวกัน (375/390/768 ไม่มี horizontal scroll, ปุ่ม ≥44px ผ่าน checkLayout)
- **U2** ผ่าน (ภาพ `r15a-skip-restore-th-light-mobile-375.png`, `…-en-dark-…`): ช่อง "วันของชุดนี้" ใช้สีเดียวกับช่องวันจริงในปฏิทินของแผ่น (surface-2) ทั้งสว่างและมืด · contrast ผ่าน
- **U3** ผ่าน: หน่วง `/login` 900 ms แล้วออกจากระบบจากหน้า "ฉัน" — `nav-progress` เปลี่ยน phase `idle → active → done → idle` (th/light, en/dark ที่ 375) · `signalNavStart` ถูกเรียกใน `AccountActions` และ `DeleteAccountSheet` · ลบบัญชีครอบด้วย `account.spec` (ผ่าน)
- **U4** ผ่านแบบตรวจเชิงโค้ด+เทสต์: `SkeletonHold` ที่ root layout, `skeletonHoldUntil` ล้วน (เทสต์ `tests/ui/r16-ui.test.ts` ผ่าน) และ e2e `r6e-loading` ข้อ "skeleton ≥250 ms" ผ่านทั้ง 3 viewport · ไม่ได้ถ่ายภาพเฟรมที่แผ่น hold ค้างอยู่ (จังหวะสั้นมาก)
- **T1** ผ่าน: `playwright.config.ts` `retries: isCI ? 1 : 0` + reporter github ใน CI · ตรงกับ B2 (เพิ่มเติม: เครื่องไม่ retry — ไม่ขัด contract) · รอบนี้ไม่พบ flaky (0 ล้ม ไม่ต้องรีไทร)
- **T2** ผ่าน: `config-hygiene.test.ts` 15 ผ่าน มีเทสต์บรรทัดว่างกลาง `run: |`
- **§4 เอกสาร** ผ่าน: CHANGELOG Unreleased, OPERATIONS (3 ถังใหม่, `api:read` นับ/ไม่นับอะไร, B3, H5, วิธีดู flaky), ARCHITECTURE §11, ADR 0014 (ระบุชัดว่าอะไรยืนยันแล้ว/ยังไม่ยืนยัน), ADR 0007 (`actorSystemAdmin`), NEXT_PHASE (backlog R6 ติดป้ายประวัติ + สถานะรายข้อ), PROGRESS, README/quickstart ตรงกับพฤติกรรมจริงที่ทดสอบ · docs-sync อยู่ในชุด vitest ที่รัน (ไม่มีไฟล์ docs ล้ม)
- **§5/§6** ตรงผลตัดสิน boss: B1=600/10 นาที, B2=retries 1, B3 ไม่ทำ, B4 → R17

## ข้อสังเกต (Info — ไม่ต้องแก้ก่อน merge)
1. ผู้ใช้ที่ติดถัง `api:read` แล้วเปิดปฏิทิน: `GET /api/me/busy?from&to` ได้ 429 แต่ `CalendarView.tsx:238` ตั้งใจกลืนความล้มเหลว (ออกแบบเดิม R14 "ล้มเหลว = ไม่มีข้อมูล routine") จึงไม่มีข้อความ 429 แสดง — แค่ไม่มีเครื่องหมาย routine ในโหมดกลุ่มเดี่ยว ส่วนฝั่งอื่นที่ใช้ `errors.RATE_LIMITED` ("ทำถี่เกินไปนิด รอสักครู่แล้วลองใหม่" / "That's a lot at once. Wait a moment and try again.") เป็นธรรมชาติทั้งสองภาษา · ผู้ใช้ปกติไม่ถึงเพดาน (การเปลี่ยนเดือนหนึ่งครั้งยิง GET ราว 3–5 ครั้ง ⇒ ต้องพลิกเดือน >100 ครั้ง/10 นาที)
2. หน้า RSC (กลุ่ม/แจ้งเตือน/ฉัน) ไม่ผ่าน API จึงไม่นับถัง `api:read` — ผู้ที่ติดถังยังเปิดหน้าได้ปกติ เป็นไปตามขอบเขต H3 (เฉพาะ GET API)
3. H5/H6 ไม่แก้ตามเหตุผลใน §6 — ไม่ได้ตรวจซ้ำด้วย curl (ตรวจแค่ความสอดคล้องของเหตุผล)

## ตรวจไม่ได้ / ข้อจำกัด
- บน Windows: 8 เทสต์ใน `tests/ops` ล้มเพราะเครื่อง (tsx subprocess, Node 26) — ไม่ได้เทียบกับ main `9db2c08` ด้วยการรันซ้ำ แต่ R16 ไม่แตะ `tests/ops` และ `scripts/` (ยืนยันด้วย `git diff 9db2c08..HEAD --stat -- tests/ops scripts` ว่าว่าง) · ผลจริงให้ดูจาก CI
- ไม่ได้รัน e2e ทั้งชุด (รันเฉพาะสเปกที่เกี่ยว 3 ชุดข้างบน)
- ไม่ได้ตรวจบนอุปกรณ์จริง/Safari
