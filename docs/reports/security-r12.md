# Security review — R12 (เพิ่มนัดลงปฏิทิน: `.ics` + ลิงก์ Google Calendar)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-10 · branch `feat/r12-add-to-calendar` HEAD `1336803` · ช่วง `origin/main...HEAD` · เทียบ R12_CONTRACT §5, §6, R12-3, R12-7, R12-10, R12-14, R12-17 + กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่านโค้ดจริง + รันเทสต์ของทีม + เขียนเทสต์ทดลองไว้นอก repo เพื่อยืนยันข้อพบ · ไม่แก้ `src/`/`tests/`/config
- repo เป็น public: ข้อที่ยังไม่แก้เขียนเฉพาะผลกระทบและทิศทางแก้ ขั้นตอนละเอียดส่งให้ main ในแชท
- เครื่อง: Windows (checkout CRLF) · **เทสต์ที่ใช้ DB รันผ่าน config และ shim นอก repo** (กลืน `EPERM`/`EBUSY` ตอน `rmSync` ของไดเรกทอรี DB ชั่วคราวเท่านั้น ไม่กระทบ assertion) · สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 |
| Info | 6 |

**Verdict: ผ่านแบบมีข้อสังเกต** — สิทธิ์ตรวจที่เซิร์ฟเวอร์ผ่าน policy กลาง คนนอกแยกนัดที่มีจริงกับนัดที่ไม่มีไม่ได้ ICS injection และ open redirect ทำไม่ได้ ไม่มีข้อมูลนอก §6 ออกไป · ข้อ Low ไม่บล็อกการ merge ให้ main ตัดสินว่าจะแก้ในรอบนี้หรือเข้า backlog · ยังต้องผ่าน CI และเครื่องจริง §9 ตาม contract

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **สิทธิ์ที่เซิร์ฟเวอร์** (กฎ 6, R12-3) | **PASS** | 📖 `appointments.ts:561-566` `appointmentFor` → `authorize('appointment.view')` ก่อนใช้แถว · `manifest.ts` `auth: 'actor'` · `can.ts:249-254` ด่านบัญชีตัดก่อน · ✅ เมทริกซ์ creator/admin/moderator/member/SA นอกกลุ่ม 200 · คนนอก/ถูกนำออก 404 · ไม่ล็อกอิน 401 · suspended 401 · `must_change_pin` 403 |
| **404 เหมือนกันทุกไบต์** (ADR 0003) | **PASS** | ✅ ทดลองเทียบ status + body + header ทั้งหมด: คนนอกกับนัดจริง = นัดที่ไม่มี · รวมนัดยกเลิก/จบแล้ว (ไม่ได้ 409) · กลุ่มถูกลบ (รวม SA) · ไม่มี `Server-Timing` บนคำตอบ error (`route.ts:347-350`) · 📖 `findAppointmentAccess` เป็น query เดียวทั้งกรณีมีและไม่มีนัด · ✅ เวลา median 1.22 ms (มีนัด) กับ 1.18 ms (ไม่มี) จาก 300 รอบบน SQLite ในเครื่อง เป็นตัวเลขชี้นำ ไม่ใช่การวัดบน production |
| **ด่านบัญชีไม่เป็น oracle** | **PASS** | ✅ ไม่ล็อกอิน / `must_change_pin` / suspended ได้คำตอบเดียวกันทั้งนัดจริงและนัดที่ไม่มี |
| **303 / open redirect** | **PASS** | 📖 `calendar.ics/route.ts:15-16` `Location` มาจาก `z.uuid()` ที่ parse แล้วเท่านั้น ไม่ผ่าน = `/` · ✅ ทดลอง `//evil.example`, `/\evil`, `https://evil`, CRLF, newline ท้าย, path traversal, `?`, `#`, ค่าว่าง และไม่มี `ctx`: ได้ `/` ทุกกรณี · คนนอกกับนัดที่ไม่มีต่างกันแค่ id ใน `Location` · ไม่มี `Set-Cookie` และ `Server-Timing` บน 303 |
| **`finalize` / text body กระทบ route อื่น** | **PASS** | 📖 ใช้ที่ `calendar.ics` ที่เดียว · ไม่ระบุ = คืน `res` เดิม (`route.ts:331-334`) · `textBody` ยังตั้ง `Cache-Control: private, no-store` ทับค่าจาก handler (`:98`) · ต่ออายุ session ก่อนสร้าง body (`:306-310`) · ✅ `GET /api/appointments/:id` ด้วย `Sec-Fetch-Mode: navigate` ยังได้ 404 JSON · เทสต์คุกกี้ต่ออายุผ่าน |
| **`Sec-Fetch-Mode` ปลอม** | **PASS** | ✅ ปลอม 6 ค่ากับคนนอกและไม่ล็อกอิน: ไม่มีข้อมูลนัดออก status ≥ 303 · ค่านี้เลือกแค่รูปคำตอบ error ไม่ได้ตัดสินสิทธิ์ (`route.ts:14`) |
| **ICS injection** (R12-7) | **PASS** | 📖 `ics.ts:47-54` escape `\` ก่อน แล้ว `;` `,` และขึ้นบรรทัดทุกแบบ ตัด `\p{Cc}\p{Cs}` · ✅ payload 21 แบบ ผ่านทั้ง builder ตรง ๆ และผ่าน DB + route · fuzz 3000 รอบ: ไม่มีบรรทัดนอก allowlist ลำดับ property คงที่ ≤ 75 octet ถอด escape แล้วได้ค่าเดิม |
| **Header / ชื่อไฟล์** (R12-4) | **PASS** | ✅ `Content-Disposition` คงที่แม้ชื่อนัดมี `"`, CRLF, ไทย, path · ไม่มี header แทรก · ไม่มี CORS |
| **ลิงก์ Google** (R12-10) | **PASS** | 📖 `ics.ts:115-127` · `AddToCalendarSheet.tsx:42` `rel="noopener noreferrer"` · ✅ ส่ง DTO ปลอมที่มีรายละเอียด/พิกัด/ชื่อกลุ่ม/สมาชิก: URL มีแค่ `action,text,dates,ctz,location,details` · ค่าที่มี `&`, `#`, `%0d%0a` decode กลับได้ตรง |
| **`appOrigin` / Host header** | **PASS (Info 2)** | ✅ โปรไฟล์ deployed ขาด `APP_ORIGIN` บน production = โหลด env ไม่ผ่าน · preview ใช้ `VERCEL_URL` · 📖 ทางอ่าน `x-forwarded-host` (`page.tsx:24-31`) ถึงได้เฉพาะเมื่อไม่ได้ตั้ง config ซึ่งไม่เกิดบน Vercel · route `.ics` ไม่อ่าน `x-forwarded-*` |
| **ไม่มีข้อมูลใน log** (R12-17) | **PASS** | ✅ spy console ทุกระดับ กรณีสำเร็จ / 404 / 400 / SA: ไม่พบชื่อนัดหรือสถานที่ · 📖 `logUnexpected` log แค่ชื่อชนิด error · diff ไม่เพิ่ม `console.*` |
| **`/privacy`** (R12-14) | **PASS (Info 3)** | 📖 `privacy.calendar.body` TH/EN ตรงกับข้อมูลที่ออกจริงตาม §6 · ✅ คีย์ TH/EN ครบเท่ากัน |
| **ความลับ / migration** (กฎ 7, 8) | **PASS** | ✅ grep diff ไม่พบ token หรือค่าจริง · ไม่มีไฟล์ env หรือ migration ใน diff · repo track แค่ `.env.example` |
| **Audit ของ super admin** | **PASS มีข้อสังเกต (Low 1)** | ✅ นัด active เขียน audit `asSuperAdmin:true` · นัด cancelled/past ไม่เขียน |

## Findings

### Low 1 — super admin นอกกลุ่มรู้สถานะนัด cancelled/จบแล้วโดยไม่มี audit
- ที่: 📖 `src/lib/data/services/appointments.ts:567-569` ตรวจสถานะแล้ว throw ก่อน `auditRead` · `getAppointment` เขียน audit ก่อนเสมอ
- ผล: ✅ super admin นอกกลุ่มขอนัด cancelled ได้ 409 `APPOINTMENT_CANCELLED` โดย audit ไม่เพิ่ม (นัดจบแล้วก็เช่นกัน) · ส่วน `GET /api/appointments/:id` กรณีเดียวกันเขียน audit 1 แถว · contract §5 ให้ทำ "แบบเดียวกับ `getAppointment`" และ `/privacy` บอกว่าการเปิดดูของ system admin ถูกบันทึกทุกครั้ง
- ขอบเขต: รั่วแค่สถานะ ไม่มีชื่อนัดหรือสถานที่ และเฉพาะ super admin
- ทิศทางแก้: ย้าย `auditRead` ขึ้นก่อนการตรวจสถานะ + เทสต์

### Low 2 — การเปิดลิงก์ข้ามไซต์ได้ไฟล์เหมือนการเปิดจากในแอป
- ที่: 📖 `src/app/api/appointments/[id]/calendar.ics/route.ts:14` ดูเฉพาะ `Sec-Fetch-Mode` ไม่ดู `Sec-Fetch-Site`
- ผล: คุกกี้ `SameSite=Lax` ถูกส่งตอน top-level navigate ✅ route ตอบ 200 แบบ `attachment` แม้ `Sec-Fetch-Site: cross-site` · เว็บอื่นอ่านเนื้อไฟล์ไม่ได้ แต่สั่งให้เกิดการดาวน์โหลดในเครื่องผู้ใช้ได้ และผลต่างระหว่าง "ดาวน์โหลด" กับ "ถูก redirect" อาจเป็นช่องให้เว็บอื่นเดาสถานะสมาชิกของผู้เปิดได้ 📖 ส่วนหลังยังไม่ได้ทดลองบนเบราว์เซอร์จริง
- ขอบเขต: ผู้โจมตีต้องรู้ id ของนัดซึ่งเป็น UUID สุ่ม · เรื่องนี้ไม่เคยมีที่หน้า `/appointments/<id>` เพราะตอบเป็นหน้า HTML ทั้งสองกรณี
- ทิศทางแก้: ถ้า `Sec-Fetch-Site` เป็น `cross-site` ให้ตอบ 303 ไปหน้านัดเสมอ ลิงก์ในแอปเป็น same-origin จึงไม่กระทบ · หรือจดเป็นความเสี่ยงที่ยอมรับ

### Info
1. **เวลาตอบ**: ไม่พบความต่างที่มีนัยจากการวัดในเครื่อง แต่ไม่ได้วัดบน production ที่ใช้ Turso
2. **`page.tsx` กับ route ใช้ fallback ต่างกัน**: หน้าอ่าน `x-forwarded-host`/`x-forwarded-proto` ส่วน route ใช้ `new URL(req.url).origin` · มีผลเฉพาะ dev หรือ self-host ที่ไม่ตั้ง `APP_ORIGIN` และค่าไปถึงเฉพาะผู้ขอเอง ใน `href` Google ค่าผ่าน `encodeURIComponent`
3. **`/privacy` ยังไม่กล่าวถึงรายละเอียดรองของ §6**: `ctz`, ลิงก์ Google อยู่ในประวัติเบราว์เซอร์, ชื่อนัดอาจเป็นข้อความที่คนอื่นพิมพ์ · ส่วนหลักครบและถูกต้อง
4. **Audit ของการดาวน์โหลดใช้ action `appointment.view`** แยกจากการเปิดหน้านัดไม่ได้ · เป็นไปตาม contract ("ไม่เพิ่ม action ใหม่")
5. **ไม่มี rate limit เฉพาะ route นี้** เหมือน `GET /api/appointments/:id` · ต้องล็อกอินและงานต่อ request เล็ก
6. **ชื่อนัด/สถานที่เป็นข้อความที่สมาชิกพิมพ์** อาจมีลิงก์ที่แอปปฏิทินทำให้กดได้ · `DESCRIPTION` และ `URL` มาจากระบบเท่านั้น contract §6 ยอมรับแล้ว

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npx vitest run --config <นอก repo> tests/calendar/ics tests/ui/add-to-calendar tests/security tests/appointments/appointments tests/busy/calendar-visibility tests/ops/headers tests/rbac` | ไฟล์ 19 ผ่าน / 1 ล้ม · เทสต์ 2835 ผ่าน / 2 ล้ม / 1 ข้าม |
| 2 ข้อที่ล้ม | `tests/security/config-hygiene.test.ts` ข้อ permissions ของ `ci.yml` และ `keepalive.yml` ตรงกับปัญหา CRLF เดิมของเครื่อง Windows |
| `npx vitest run --config <นอก repo>` เทสต์ทดลอง 77 ข้อ (oracle, redirect, audit, injection, Google, origin, log) | 77 ผ่าน |
| `git diff origin/main...HEAD` grep ความลับ · `git ls-files` หา `.env` | ไม่พบค่าจริง · track แค่ `.env.example` |

## สิ่งที่ตรวจไม่ได้
- e2e บนเบราว์เซอร์และเซิร์ฟเวอร์จริง (`next build`/`next start`) · header ความปลอดภัยของ `next.config.ts` บน route นี้ยืนยันจาก config และ `tests/ops/headers.test.ts` ไม่ได้ยิงเซิร์ฟเวอร์จริง
- พฤติกรรมเบราว์เซอร์ของช่องเดาสถานะสมาชิกใน Low 2
- `npm test` ทั้งชุดและ CI · branch นี้ยังไม่มี PR
- การทำงานบนเครื่องจริง iPhone/Android ตาม §9 (R12-18) และเวลาตอบบน Turso production
