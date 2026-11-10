# QA R12 — ตรวจอิสระ (เพิ่มนัดลงปฏิทินในเครื่อง: .ics + Google Calendar)

branch `feat/r12-add-to-calendar` (HEAD `1336803`) · ผู้ตรวจ: qa · รันซ้ำเองทั้งหมด ไม่เชื่อใบรับรองผู้ทำ

## Verdict: ผ่านแบบมีข้อสังเกต
โค้ดและเอกสารตรง contract ทุกข้อที่ตรวจได้ในเครื่อง ไม่พบบั๊กที่ต้องแก้ (ไม่มีคอมมิตแก้โค้ด) · เหลือ R12-16 ส่วน CI/Vercel (ตรวจในเครื่องไม่ได้) และ R12-18 (เครื่องจริงของ boss)

## เกณฑ์
| # | ผล | หลักฐาน |
|---|---|---|
| R12-1 | ผ่าน | `showAddToCalendar` (model.ts) = going + !saving + active + !isPast · e2e r12 ข้อ R12-1 ผ่านทุก project/ภาษา/ธีม (ยังไม่ตอบ/อาจไป/ไม่ไป/ยกเลิกไม่มีปุ่ม) · "จบแล้ว" ครอบด้วย Vitest (E2E สร้างนัดอดีตไม่ได้) |
| R12-2 | ผ่าน | tests/calendar/ics-route.test.ts ครบทุกแถวของตาราง §5 ทั้ง API และ navigate (+ suspended, Sec-Fetch-Mode อื่น = ไม่ redirect) · ไล่ `finalize` ใน route.ts และ route ใหม่แล้วตรงตาราง |
| R12-3 | ผ่าน | เมทริกซ์ผู้สร้าง/admin/moderator/member/super admin/คนนอก/ถูกนำออก/ไม่ล็อกอิน/must_change_pin · 404 คนนอก = ไม่มีนัด ทุกไบต์ · service ใช้ `appointmentFor` + `authorize('appointment.view')` + `auditRead` และตรวจ cancelled/past หลัง authorize (คนนอกไม่รั่วเป็น 409) |
| R12-4 | ผ่าน | header + ชื่อไฟล์คงที่ (ทดสอบ `"`/CRLF/ไทย) · e2e ดาวน์โหลดจริงได้ชื่อ `maewmeet-plan.ics` |
| R12-5 | ผ่าน | tests/calendar/ics.test.ts (19:00–21:00 BKK = 120000Z–140000Z, ข้ามเที่ยงคืน/ปี/29 ก.พ., ไม่มี พ.ศ.) · ฟังก์ชันอยู่ใน `src/lib/calendar` |
| R12-6 | ผ่าน | UID = `<id>@maewmeet` เหมือนเดิมข้ามผู้ใช้/หลังแก้เวลา ต่างกันข้ามนัด |
| R12-7/8 | ผ่าน | เทสต์ escape/fold ผ่าน และผล parser อิสระด้านล่าง |
| R12-9 | ผ่าน | ดูหัวข้อ "parser อิสระ" |
| R12-10 | ผ่าน | decode ลิงก์ Google ได้ค่าเดิมตรงทั้งไทยและ `, ; \ :` · คีย์มีแค่ action,text,dates,ctz,location,details |
| R12-11 | ผ่าน | tests/ui/add-to-calendar.test.ts + e2e UA iPhone/iPadOS/Macintosh ไม่มีจอสัมผัส/Android/LINE iOS+Android |
| R12-12 | ผ่าน | `oneTime` เห็นใน sheet ก่อนกดเลือก · `googleNote` ติดปุ่ม Google (`aria-describedby`) · ข้อความทั้งหมดมาจาก messages · คีย์ TH/EN ครบ |
| R12-13 | ผ่านแบบมีข้อสังเกต | e2e r12 (375/390/768 × th/en × สว่าง/มืด) ไม่ล้นแนวนอน ปุ่ม ≥ 44px ผ่านหมด · ดูภาพหน้าจอจริงแล้ว (ด้านล่าง) |
| R12-14 | ผ่านแบบมีข้อสังเกต | `/privacy` TH/EN มีหัวข้อใหม่ + `updated` 10 พ.ย. 2569/10 Nov 2026 ตรงพฤติกรรมจริงและไม่ส่งรายละเอียด/พิกัด/ชื่อกลุ่ม/ชื่อสมาชิก · ข้อสังเกต 1 |
| R12-15 | ผ่าน | README, quickstart ("ครั้งเดียว", ส่งไป Google, ใน LINE, เปลี่ยนเวลาแจ้งกระดิ่งเท่านั้น/แก้ชื่อไม่แจ้ง) ตรง §1 · CHANGELOG มีบรรทัด |
| R12-16 | ตรวจบางส่วน | lint/typecheck/build ผ่าน, ไม่มี migration (diff ไม่แตะ drizzle/ หรือ schema) · CI/Vercel ตรวจในเครื่องไม่ได้ |
| R12-17 | (security) | มีเทสต์ "ไม่ log ชื่อนัด/สถานที่" ผ่าน · ไม่ได้ตรวจแทน security |
| R12-18 | ไม่ได้ตรวจ | เครื่องจริงของ boss ตาม §9 |

## R12-9: parser อิสระ
ติดตั้ง `ical.js@2` และ `node-ical` ใน scratchpad นอก repo (ไม่แตะ package.json ของแอป) · bundle `src/lib/calendar/ics.ts` ด้วย esbuild แล้วสร้างไฟล์จริงจากนัดชื่อไทยยาว (~110 ตัว) + `, ; \ :` และสถานที่ที่มี `" , ; : \`
- ไฟล์: 28 บรรทัด · บรรทัดยาวสุด 75 octet · จบ CRLF · ไม่มี BOM
- ical.js: parse ได้ · SUMMARY และ LOCATION ตรงกับต้นฉบับทุกตัวอักษร (=== true) · DTSTART 2026-11-21T12:00:00Z, DTEND 14:00:00Z · UID `0190…89ab@maewmeet` · URL/DESCRIPTION = ลิงก์นัด · STATUS CONFIRMED · property ที่มี: uid,dtstamp,dtstart,dtend,summary,location,description,url,status (ไม่มี ORGANIZER/ATTENDEE/VALARM)
- node-ical: SUMMARY/LOCATION ตรงต้นฉบับ · เวลาตรง · `attendee` = undefined
- ชื่อนัดแบบโจมตี `x\r\nATTENDEE:mailto:evil@x.com\nEND:VEVENT`: node-ical ได้ SUMMARY เป็นข้อความล้วน ไม่มี attendee
- ลิงก์ Google ของนัดเดียวกัน: `URL.searchParams` decode ได้ text/location ตรงต้นฉบับ · dates=`20261121T120000Z/20261121T140000Z` · ctz=Asia/Bangkok
หมายเหตุ: การพับตัดที่ขอบ code point จึงอาจทำให้วรรณยุกต์/สระลอยขึ้นต้นบรรทัดต่อ (เช่น `" ่ร้าน..."`) ถูกต้องตาม RFC และ parser ต่อกลับได้ครบ แต่ไม่ได้พับตามขอบ grapheme

## ภาพหน้าจอ (R12-13 / Anti-slop)
ถ่าย 36 ภาพจริง (3 project × th/en × สว่าง/มืด × Android/iPhone/LINE; หน้านัดเต็มและ sheet) ด้วยสเปกชั่วคราวที่ลบแล้ว เก็บใน scratchpad ไม่ commit · ดูภาพ 375 th สว่าง Android (หน้า + sheet), 390 en มืด iPhone, 768 th มืด LINE
- ปุ่ม "เพิ่มลงปฏิทิน" ใต้ RSVP เป็นปุ่มรอง เต็มกว้าง ไอคอนชุดเดียวกับทั้งแอป · sheet เห็น `oneTime` เป็นกล่องข้อมูลก่อนปุ่ม · อันดับแรกเป็นปุ่มหลัก (Google บน Android, .ics บน iPhone) · `googleNote` อยู่ใต้ปุ่ม Google ตัดบรรทัดไม่ล้น · โหมด LINE เหลือ oneTime + lineHint + ปุ่มเปิดเบราว์เซอร์
- Anti-slop: ไม่มีไล่สี/อีโมจิ/เงาลอยเกินจำเป็น ใช้ token เดิม ข้อความอ่านชัดทั้งสองธีม · ไม่เห็น horizontal scroll
- ข้อสังเกต 3: ภาพหน้าเต็ม (fullPage) ที่ 375 เห็นแถบนำทางล่างทับกลางภาพ เป็นอาการของการถ่าย fullPage กับ element แบบ fixed ไม่ใช่บั๊ก

## ข้อสังเกต (ไม่ถึงขั้นแก้)
1. ต่ำ: `/privacy` (th.json:1630, en.json) ไม่ได้บอกว่าลิงก์ Google ส่ง "เขตเวลา" ของนัด (`ctz`) ด้วย ตาม §6 ระบุว่าส่ง · เป็นข้อมูลระดับ Asia/Bangkok ไม่ระบุตัวคน แต่ถ้าต้องการให้ตรง §6 ครบ ให้ ux เพิ่มคำว่า "เขตเวลา" (ไม่แก้เอง เพราะเป็นข้อความ ux เป็นเจ้าของ)
2. ต่ำ: หน้า `page.tsx` ตอนไม่ตั้ง APP_ORIGIN (dev เท่านั้น) ใช้ `x-forwarded-host`/`host` สร้าง origin ลงลิงก์ที่ผู้ใช้กดเอง · production ใช้ค่าจาก env จึงไม่กระทบ
3. ดูหัวข้อภาพหน้าจอ (fullPage)

## คำสั่งที่รันจริงและผล
- `npm run lint` → ไม่มี error · `npm run typecheck` → ไม่มี error · `npm run build` → สำเร็จ (มี route `/api/appointments/[id]/calendar.ics`)
- Vitest **ไม่ใช้ shim** (`tests/calendar`, `tests/ui/add-to-calendar.test.ts`, `tests/security/authorize-first.test.ts`): pass 445 · fail 35 = EPERM `rmSync` ใน tests/helpers/db.ts:29 จำนวน 34 (หลักฐาน: ข้อความ `EPERM, Permission denied` ใน failureMessages ทุกข้อ) + 1 Python ไม่มี (oracle.py)
- Vitest **ใช้ shim นอก repo** (scratchpad `shim-setup.cjs`: ครอบ `fs.rmSync` ให้กลืน EPERM เท่านั้น ไม่แตะผลเทสต์อื่น): ชุด R12 + tests/appointments + tests/busy: pass 673 · fail 1 (Python)
- Vitest เต็มชุดด้วย shim `--no-file-parallelism`: pass 5145 · fail 17 · pending 18 · 17 ข้อล้วนเป็นของเครื่องนี้ ไม่เกี่ยว R12: Python ไม่มี ×1, Node v26 ไม่ใช่ v24 (health) ×1, subprocess/tsx ไม่ทำงานบน Windows (admin-reset-pin ×3, pepper-fingerprint ×4, release ×2), manual-delete-sql ×4 (ต้องใช้เครื่องมือ shell/sqlite ของ Linux), config-hygiene CRLF ×2
- Playwright `tests/e2e/r12-add-to-calendar.spec.ts` (`--workers=4`, 3 project): **120 passed** ไม่มี retry
- Playwright รอบ regression (appt-story, appt-layout, appt-validation, r11-notifications): 54 passed · 12 skipped · 0 failed · `privacy.spec.ts`: 9 passed
- ไม่ได้รัน `npm run test:e2e` เต็มชุด (รอบ R11 ใช้เวลานานและเครื่องล้น) → รันเฉพาะสเปกที่แตะหน้านัด/route/privacy/กระดิ่ง

## ตรวจไม่ได้
CI และ Vercel preview · e2e บน Linux · เครื่องจริง iPhone/Android (R12-18/§9) · การเปิด .ics ในแอป Calendar จริงและลิงก์ Google ที่ไม่มีเอกสารทางการ · การทำงานของ LINE in-app browser จริง (ตรวจด้วย UA จำลอง)
