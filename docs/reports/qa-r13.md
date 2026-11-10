# qa-r13 — ตรวจอิสระ R13 (สถานที่แบบวางลิงก์ + ป้ายลิงก์ในปฏิทิน)

ผู้ตรวจ: qa · branch `feat/r13-location-simplify` @ `5d99338` (+ แก้ test 1 จุดโดย qa) · เครื่อง Windows, Node v26.13.0 · 2026-11-11

## Verdict: ผ่านแบบมีข้อสังเกต
พบบั๊กในเทสต์ 1 จุด (r12 e2e ภาษา EN ล้มทุก viewport เพราะ commit `5d99338` เปลี่ยนภาษาป้าย .ics เป็นคุกกี้ก่อน แต่ spec ยังคาดว่าเป็นไทย) — qa แก้แล้ว ไม่พบบั๊กในโค้ดผลิตภัณฑ์

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npm run lint` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 (ไม่มี `/api/places/search` ในรายการ route) |
| `vitest run` (ทั้งชุด, shim นอก repo กลืน EPERM ของ `rmSync`) | 5180 ผ่าน / 21 ล้ม / 18 skip (150 ไฟล์) |
| `playwright test r13-location --workers=2 --retries=0` | 42/42 ผ่าน (3 viewport) |
| `playwright test r12-add-to-calendar appt- privacy headers r6d-going account --workers=2 --retries=1` (ก่อนแก้) | 193 ผ่าน / 12 ล้ม (ทั้งหมดคือ r12 EN, ดูบั๊ก #1) / 38 skip |
| `playwright test r12-add-to-calendar --workers=2 --retries=0` (หลังแก้) | 132/132 ผ่าน |

Vitest 21 ที่ล้ม = เรื่องเครื่อง ไม่แตะไฟล์ R13: config-hygiene permissions x2 (CRLF) · release CLI x2 (tsx) · pepper-fingerprint x4, admin-reset-pin x3, manual-delete-sql x4 (subprocess/ไม่มี sqlite3) · free-time oracle.py (ไม่มี Python) · health (`v26` ไม่ตรง `^v24`) · auth security-r1 x2, ip-ratelimit, admin/search (timeout ตอนรันขนาน — รันเดี่ยวผ่านทั้งหมด)
หมายเหตุ: e2e รอบแรกแบบ 4 worker มี timeout/flaky มาก (argon2 + SQLite บนเครื่องนี้) รันใหม่ 2 worker ผ่านหมด · ไม่ได้รัน e2e ทั้งชุด (เฉพาะกลุ่มข้างบน)

## ตารางเกณฑ์
| # | ผล | หลักฐาน |
|---|---|---|
| R13-1 | ผ่าน | e2e: ไม่มีปุ่ม/ชิป/แผงวาง, ช่องชื่อ+ลิงก์เห็นทันที, บันทึก 4 กรณี, ลิงก์ผิด error ตอน blur/ส่ง (ภาพ form-err) · อ่านโค้ด `PlaceField.tsx` |
| R13-2 | ผ่าน | e2e UA iPhone = Apple+Google (Apple ก่อน), Android = Google เดียว, href encode ไทย/`&`/`#`, ไม่มี hydration error (`useSyncExternalStore` server=google) · Vitest `appointments-map` |
| R13-3 | ผ่าน | ไม่มีภาพแผนที่ · 3 กรณีถูก · ปุ่ม ≥ 44px สว่าง/มืด · ดูภาพจริง 375/768 (ข้อสังเกต #2) |
| R13-4 | ผ่าน | e2e นัดเก่า: พิกัดอย่างเดียวแสดง `lat,lng` แก้ชื่อแล้วค่าเดิมอยู่ · ลิงก์ OSM บันทึกกลับ mapUrl+พิกัดไม่หาย · แก้เอาลิงก์/ชื่อออกถูก |
| R13-5 | ผ่าน | สร้าง .ics 7 แบบ (TH/EN, มี/ไม่มีลิงก์, ลิงก์ 500 ตัว, URL มีอักษรไทย, ลิงก์แทรก CRLF+ATTENDEE) แล้วอ่านด้วย `ical.js` และ `node-ical` (ติดตั้งนอก repo): DTSTART 19:00 TZID=Asia/Bangkok = 12:00Z ถูก, DESCRIPTION มีป้าย 2 บรรทัด/บรรทัดเดียว, `URL` = ลิงก์แผนที่ (ไม่มี/ไม่ปลอดภัย = ลิงก์นัด), ไม่มีบรรทัดเกิน 75 octet, ไม่มี LF เปล่า, 1 VEVENT, ไม่มี ATTENDEE จริง (ข้อความแทรกถูก escape เป็น `\n` ใน DESCRIPTION) · ภาษา: คุกกี้ → user.locale → th (Vitest `ics-route` + e2e r13/r12 en) · Google `details` ป้ายตรง |
| R13-6 | ผ่าน | grep `places/search|place.search|PLACE_SEARCH|NOMINATIM|tile.openstreetmap|PlaceMap|tileGrid|places.(search|paste|map|clear)|selected.aria` ใน src/messages/tests/.env.example/README/quickstart: เหลือเฉพาะเทสต์/คอมเมนต์ที่ยืนยันว่า "ไม่มี" · th/en keys ตรงกัน (diff ว่าง) · `/privacy` TH/EN ตรงพฤติกรรม (ส่งชื่อเมื่อกดเท่านั้น, ป้ายปฏิทิน, วันที่ 11 พ.ย.) |
| R13-7 | ผ่าน | README บรรทัด 46-47 + quickstart 671-672, 739-741 ตรงปุ่ม/วิธีใหม่ · ไม่มีไฟล์ใหม่ใน `drizzle/`, schema แก้แค่คอมเมนต์ · lint/tsc/build เขียว · CI/Vercel ตรวจจากเครื่องนี้ไม่ได้ |

## บั๊กที่เจอ
1. (กลาง, เทสต์) `tests/e2e/r12-add-to-calendar.spec.ts` (ข้อ R12.1-1/2 และ R12-2/4) ใช้ `L('th')` ตายตัวสำหรับ .ics ทั้งที่ `5d99338` ให้ป้ายตามคุกกี้ `mm_locale` → ภาษา EN ล้มทุก viewport/ธีม (12 เคสจริง CI จะแดง) · **แก้แล้ว** เป็น `L(locale)` (commit `qa:`), รันซ้ำ 132/132 ผ่าน

## ข้อสังเกต (ไม่บล็อก)
1. 21 ล้มของ Vitest เป็นเรื่องเครื่อง (ดูข้างบน) ผลจริงดู CI
2. ปุ่ม `place-open` ที่โฮสต์ยาวมาก (375, 4 บรรทัด): ข้อความอยู่กลางปุ่ม มี padding ไม่ชิดขอบ ไม่ล้น — ยอมรับได้ (กรณีสุดขั้ว; โฮสต์จริงอย่าง maps.app.goo.gl บรรทัดเดียว) ตาม ux/a11y: ปุ่มยังกดได้ aria-label เต็ม ไม่มีเนื้อหาถูกตัดทิ้ง · ที่ 768 ข้อความ "(host)" ปกติไม่ตัดบรรทัดในภาพที่ตรวจ
3. หน้ารายละเอียด 768 กรณีชื่ออย่างเดียวบน iPhone: ปุ่ม Apple/Google ซ้อนแนวตั้งและกว้างไม่เท่ากัน (ชิดซ้าย) — เล็กน้อย เป็นเรื่องความสวยงาม
4. `.ics` `URL` เป็นลิงก์แผนที่ ทำให้ลิงก์นัดอยู่ใน DESCRIPTION เท่านั้น — ตาม contract, ผลบน iPhone จริงรอ T3 ของ boss
5. `/api/prefs` ไม่บันทึก `user.locale` ตอนสลับภาษา (มีอยู่ก่อน R13, contract ระบุไม่แก้)

## Anti-slop / ไม่ถอยหลัง
ใช้ token เดิม ไม่มีสีตายตัว/กรอบซ้อน/ไอคอนตกแต่งเกิน · ภาพตรวจ: ฟอร์ม th/en × สว่าง/มืด × Android/iPhone UA × 375/390/768 และรายละเอียด 4 กรณี (ภาพอยู่ใน scratchpad ของ qa ไม่ commit) · R12/R12.1 e2e (add-to-calendar) ผ่าน หลังแก้ spec · appt-*, privacy, headers, r6d, account ผ่าน

## ตรวจไม่ได้
iPhone/Android เครื่องจริง (R13-8), CI/Vercel, e2e ทั้งชุด, Vitest ที่ล้มเพราะเครื่อง Windows
