# Security review — R12 (เพิ่มนัดลงปฏิทิน: `.ics` + ลิงก์ Google Calendar)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-10 · branch `feat/r12-add-to-calendar` ตรวจครั้งแรก HEAD `1336803` · **ตรวจซ้ำการแก้ Low 1/Low 2 ที่ `0dab604`** (ช่วง `41582ed..0dab604` รวม contract `eea8695` และ privacy `b4488df`) · เทียบ R12_CONTRACT §5, §6, R12-3, R12-7, R12-10, R12-14, R12-17 + กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่านโค้ดจริง + รันเทสต์ของทีม + เขียนเทสต์ทดลองไว้นอก repo เพื่อยืนยันข้อพบ · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows (checkout CRLF) · **เทสต์ที่ใช้ DB รันผ่าน config และ shim นอก repo** (กลืน `EPERM`/`EBUSY` ตอน `rmSync` ของไดเรกทอรี DB ชั่วคราวเท่านั้น ไม่กระทบ assertion) · สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด

## สรุป (สถานะล่าสุด `0dab604`)
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 (Low 1 และ Low 2 แก้แล้ว) |
| Info | 9 ที่ยังเปิด (Info 3 ปิดแล้ว) |

**Verdict (ตรวจซ้ำ `0dab604`): ผ่าน** — Low 1 และ Low 2 ปิดแล้ว การแก้ไม่สร้างช่องใหม่ระดับ Low ขึ้นไป · สิทธิ์ตรวจที่เซิร์ฟเวอร์ผ่าน policy กลาง คนนอกแยกนัดที่มีจริงกับนัดที่ไม่มีไม่ได้ ICS injection และ open redirect ทำไม่ได้ ไม่มีข้อมูลนอก §6 ออกไป · ข้อ Info ไม่บล็อกการ merge · ยังต้องผ่าน CI และเครื่องจริง §9 ตาม contract

## ผลตรวจซ้ำการแก้ (`41582ed..0dab604`)
| เรื่อง | ผล | หลักฐาน |
|---|---|---|
| **Low 1: audit ก่อนตรวจสถานะ** | **ปิด** | 📖 `appointments.ts:568` `auditRead` มาก่อน `:569-570` · ✅ super admin นอกกลุ่ม: cancelled และจบแล้วได้ 409 + audit เพิ่ม 1 แถว `asSuperAdmin:true` ผู้กระทำถูกคน |
| **audit เกิดกับคนที่ไม่ควรไหม** | **ไม่เกิด** | ✅ นัด cancelled: admin/moderator/ผู้สร้าง/member/คนนอก/`must_change_pin`/ไม่ล็อกอิน audit เพิ่ม 0 · super admin ที่เป็นสมาชิกกลุ่มได้ 409 audit เพิ่ม 0 · super admin กับนัดไม่มีหรือกลุ่มถูกลบได้ 404 audit เพิ่ม 0 เพราะ `authorize` ตัดก่อน |
| **คนนอกยังไม่ได้ 409** | **PASS** | ✅ คนนอกกับนัด cancelled ตอบเหมือนนัดที่ไม่มีทุกไบต์ |
| **Low 2: ด่าน cross-site** | **ปิด** | 📖 `calendar.ics/route.ts:30` throw ก่อนเรียก service จึงไม่อ่านนัดและไม่เขียน audit · ✅ สมาชิกที่ `navigate` + `cross-site` ได้ 303 ไม่มี `Content-Disposition` |
| **303 ต่างกันระหว่างสมาชิก/คนนอกไหม** | **ไม่ต่าง** | ✅ admin/moderator/ผู้สร้าง/member/super admin/คนนอก/`must_change_pin`/suspended/ไม่ล็อกอิน และนัด cancelled/จบแล้ว/กลุ่มถูกลบ ได้ status + body + header เท่ากันทุกไบต์ · header มีแค่ `cache-control` กับ `location` · นัดจริงกับนัดที่ไม่มีต่างกันแค่ id ใน `Location` |
| **ด่านอยู่หลัง validation เดาอะไรได้ไหม** | **ไม่ได้** | 📖 ลำดับคือ params → actor → handler · ✅ id ผิดรูปได้ `/` ทุก actor เท่ากัน ค่าเดียวที่ต่างคือรูปแบบ id ซึ่งผู้เรียกกำหนดเอง · ด่านอยู่หลัง `resolveActor` เวลาตอบของผู้ล็อกอินจึงต่างจากไม่ล็อกอิน ดู Info 8 |
| **audit ถูกบังคับข้ามไซต์** | **ปิด** | ✅ super admin ที่ `cross-site` ได้ 303 audit เพิ่ม 0 · แบบ same-origin ยังเขียน audit |
| **เงื่อนไขด่านไม่กว้างหรือแคบเกิน** | **PASS** | ✅ `same-origin`, `same-site`, `none`, ไม่มี header และโหมดไม่ใช่ `navigate` พฤติกรรมเดิม · 📖 ลิงก์ในแอปเป็น same-origin · ไม่พบตัวช่วย redirect ภายในแบบ `?next=` ที่จะเปลี่ยน cross-site เป็น same-origin · route `GET /api/appointments/:id` ไม่ถูกกระทบ |
| **ปลอม header** | **PASS** | 📖 เบราว์เซอร์ห้ามสคริปต์ตั้ง `Sec-Fetch-*` · client ที่ไม่ใช่เบราว์เซอร์ปลอมได้แต่ได้เท่าสิทธิ์ของตัวเอง ด่านนี้กันเว็บอื่น ไม่ใช่ตัวตัดสินสิทธิ์ (ดู Info 7) |
| **`/privacy` (`b4488df`)** | **PASS** | 📖 TH/EN เพิ่มเขตเวลา, ประวัติเบราว์เซอร์, `.ics` ไม่มีเขตเวลา, ข้อความที่สมาชิกคนอื่นพิมพ์ ตรงกับโค้ด (`ics.ts` ไม่มี `TZID`, ลิงก์ Google มี `ctz`) · ✅ คีย์ TH/EN ครบเท่ากัน · Info 3 ปิด |
| **contract (`eea8695`)** | **ตรงกับโค้ด** | 📖 ทั้งสองแถวตรงกับ `0dab604` · ดู Info 9 เรื่องถ้อยคำ |

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **สิทธิ์ที่เซิร์ฟเวอร์** (กฎ 6, R12-3) | **PASS** | 📖 `appointments.ts:561-566` `appointmentFor` → `authorize('appointment.view')` ก่อนใช้แถว · `manifest.ts` `auth: 'actor'` · `can.ts:249-254` ด่านบัญชีตัดก่อน · ✅ เมทริกซ์ creator/admin/moderator/member/SA นอกกลุ่ม 200 · คนนอก/ถูกนำออก 404 · ไม่ล็อกอิน 401 · suspended 401 · `must_change_pin` 403 |
| **404 เหมือนกันทุกไบต์** (ADR 0003) | **PASS** | ✅ ทดลองเทียบ status + body + header ทั้งหมด: คนนอกกับนัดจริง = นัดที่ไม่มี · รวมนัดยกเลิก/จบแล้ว (ไม่ได้ 409) · กลุ่มถูกลบ (รวม SA) · ไม่มี `Server-Timing` บนคำตอบ error (`_lib/route.ts:347-350`) · 📖 `findAppointmentAccess` เป็น query เดียวทั้งกรณีมีและไม่มีนัด · ✅ เวลา median 0.89 ms (มีนัด) กับ 0.86 ms (ไม่มี) จาก 300 รอบบน SQLite ในเครื่อง เป็นตัวเลขชี้นำ ไม่ใช่การวัดบน production |
| **ด่านบัญชีไม่เป็น oracle** | **PASS** | ✅ ไม่ล็อกอิน / `must_change_pin` / suspended ได้คำตอบเดียวกันทั้งนัดจริงและนัดที่ไม่มี |
| **303 / open redirect** | **PASS** | 📖 `calendar.ics/route.ts:18-19` `Location` มาจาก `z.uuid()` ที่ parse แล้วเท่านั้น ไม่ผ่าน = `/` · ✅ ทดลอง `//evil.example`, `/\evil`, `https://evil`, CRLF, newline ท้าย, path traversal, `?`, `#`, ค่าว่าง และไม่มี `ctx`: ได้ `/` ทุกกรณี · คนนอกกับนัดที่ไม่มีต่างกันแค่ id ใน `Location` · ไม่มี `Set-Cookie` และ `Server-Timing` บน 303 |
| **`finalize` / text body กระทบ route อื่น** | **PASS** | 📖 ใช้ที่ `calendar.ics` ที่เดียว · ไม่ระบุ = คืน `res` เดิม (`_lib/route.ts:331-334`) · `textBody` ยังตั้ง `Cache-Control: private, no-store` ทับค่าจาก handler (`:98`) · ต่ออายุ session ก่อนสร้าง body (`:306-310`) · ✅ `GET /api/appointments/:id` ด้วย `Sec-Fetch-Mode: navigate` ยังได้ 404 JSON · เทสต์คุกกี้ต่ออายุผ่าน |
| **`Sec-Fetch-Mode` ปลอม** | **PASS** | ✅ ปลอม 6 ค่ากับคนนอกและไม่ล็อกอิน: ไม่มีข้อมูลนัดออก status ≥ 303 · ค่านี้เลือกแค่รูปคำตอบ error ไม่ได้ตัดสินสิทธิ์ (`calendar.ics/route.ts:14,17`) |
| **ICS injection** (R12-7) | **PASS** | 📖 `ics.ts:47-54` escape `\` ก่อน แล้ว `;` `,` และขึ้นบรรทัดทุกแบบ ตัด `\p{Cc}\p{Cs}` · ✅ payload 21 แบบ ผ่านทั้ง builder ตรง ๆ และผ่าน DB + route · fuzz 3000 รอบ: ไม่มีบรรทัดนอก allowlist ลำดับ property คงที่ ≤ 75 octet ถอด escape แล้วได้ค่าเดิม |
| **Header / ชื่อไฟล์** (R12-4) | **PASS** | ✅ `Content-Disposition` คงที่แม้ชื่อนัดมี `"`, CRLF, ไทย, path · ไม่มี header แทรก · ไม่มี CORS |
| **ลิงก์ Google** (R12-10) | **PASS** | 📖 `ics.ts:115-127` · `AddToCalendarSheet.tsx:42` `rel="noopener noreferrer"` · ✅ ส่ง DTO ปลอมที่มีรายละเอียด/พิกัด/ชื่อกลุ่ม/สมาชิก: URL มีแค่ `action,text,dates,ctz,location,details` · ค่าที่มี `&`, `#`, `%0d%0a` decode กลับได้ตรง |
| **`appOrigin` / Host header** | **PASS (Info 2)** | ✅ โปรไฟล์ deployed ขาด `APP_ORIGIN` บน production = โหลด env ไม่ผ่าน · preview ใช้ `VERCEL_URL` · 📖 ทางอ่าน `x-forwarded-host` (`page.tsx:24-31`) ถึงได้เฉพาะเมื่อไม่ได้ตั้ง config ซึ่งไม่เกิดบน Vercel · route `.ics` ไม่อ่าน `x-forwarded-*` |
| **ไม่มีข้อมูลใน log** (R12-17) | **PASS** | ✅ spy console ทุกระดับ กรณีสำเร็จ / 404 / 400 / SA: ไม่พบชื่อนัดหรือสถานที่ · 📖 `logUnexpected` log แค่ชื่อชนิด error · diff ทั้งสองช่วงไม่เพิ่ม `console.*` |
| **`/privacy`** (R12-14) | **PASS** | 📖 `privacy.calendar.body` TH/EN ตรงกับข้อมูลที่ออกจริงตาม §6 รวมรายละเอียดรองแล้ว · ✅ คีย์ TH/EN ครบเท่ากัน |
| **ความลับ / migration** (กฎ 7, 8) | **PASS** | ✅ grep diff ไม่พบ token หรือค่าจริง · ไม่มีไฟล์ env หรือ migration ใน diff · repo track แค่ `.env.example` |
| **Audit ของ super admin** | **PASS** | ✅ นัด active, cancelled และจบแล้ว เขียน audit `asSuperAdmin:true` · ปิด Low 1 |

## Findings

### Low 1 — ปิดแล้วใน `0dab604` (เดิม: super admin นอกกลุ่มรู้สถานะนัด cancelled/จบแล้วโดยไม่มี audit)
- ตอนตรวจครั้งแรก `getAppointmentIcs` ตรวจสถานะแล้ว throw ก่อน `auditRead` ต่างจาก `getAppointment` · ✅ ตรวจซ้ำแล้ว ดูหัวข้อตรวจซ้ำ

### Low 2 — ปิดแล้วใน `0dab604` (เดิม: การเปิดลิงก์ข้ามไซต์ได้ไฟล์เหมือนการเปิดจากในแอป)
- ตอนตรวจครั้งแรก route ดูเฉพาะ `Sec-Fetch-Mode` เว็บอื่นจึงสั่งดาวน์โหลดได้ และผลต่างระหว่างดาวน์โหลดกับ redirect อาจใช้เดาสถานะสมาชิกได้ · ✅ ตรวจซ้ำแล้ว ดูหัวข้อตรวจซ้ำ · ข้อจำกัดที่เหลือดู Info 7

### Info
1. **เวลาตอบ**: ไม่พบความต่างที่มีนัยจากการวัดในเครื่อง แต่ไม่ได้วัดบน production ที่ใช้ Turso
2. **`page.tsx` กับ route ใช้ fallback ต่างกัน**: หน้าอ่าน `x-forwarded-host`/`x-forwarded-proto` ส่วน route ใช้ `new URL(req.url).origin` · มีผลเฉพาะ dev หรือ self-host ที่ไม่ตั้ง `APP_ORIGIN` และค่าไปถึงเฉพาะผู้ขอเอง ใน `href` Google ค่าผ่าน `encodeURIComponent`
3. **ปิดแล้วใน `b4488df`** (เดิม: `/privacy` ยังไม่กล่าวถึงรายละเอียดรองของ §6)
4. **Audit ของการดาวน์โหลดใช้ action `appointment.view`** แยกจากการเปิดหน้านัดไม่ได้ · เป็นไปตาม contract ("ไม่เพิ่ม action ใหม่")
5. **ไม่มี rate limit เฉพาะ route นี้** เหมือน `GET /api/appointments/:id` · ต้องล็อกอินและงานต่อ request เล็ก
6. **ชื่อนัด/สถานที่เป็นข้อความที่สมาชิกพิมพ์** อาจมีลิงก์ที่แอปปฏิทินทำให้กดได้ · `DESCRIPTION` และ `URL` มาจากระบบเท่านั้น contract §6 ยอมรับแล้ว
7. **ด่าน cross-site ทำงานเมื่อเบราว์เซอร์ส่ง `Sec-Fetch-Site`**: เบราว์เซอร์ที่ไม่ส่ง header นี้ยังได้พฤติกรรมเดิมก่อนแก้ (ความเสี่ยงระดับเดียวกับ Low 2 เดิม และยังต้องรู้ UUID ของนัด) · การกดลิงก์ `.ics` จากแอปอื่นได้ `Sec-Fetch-Site: none` จึงยังดาวน์โหลดได้เมื่อผู้ใช้กดเอง
8. **เวลาตอบของ 303 ข้ามไซต์**: ✅ median สมาชิก 0.33 ms คนนอก 0.33 ms ไม่ล็อกอิน 0.04 ms · แยกสมาชิกกับคนนอกไม่ได้ · ผู้ล็อกอินกับไม่ล็อกอินต่างกันเพราะอ่าน session ซึ่งเป็นพฤติกรรมเดิมของทุก route และวัดข้ามไซต์จาก top-level navigation ได้ยาก
9. **ถ้อยคำ contract**: บรรทัดใหม่ของ §5 เขียนว่า cross-site ได้ 303 ไป `/appointments/<id>` "เสมอ" แต่ id ผิดรูปไป `/` ตามแถวในตาราง §5 · ไม่กระทบความปลอดภัย
10. **ต่ออายุ session บนคำตอบที่ไม่สำเร็จ**: 📖 `resolveSession` อาจต่ออายุแถวใน DB ก่อนถึงด่าน แต่คำตอบ error และ 303 ไม่ส่งคุกกี้ใหม่ ✅ ไม่มี `Set-Cookie` บน 303 ข้ามไซต์ · เป็นพฤติกรรมเดิมของคำตอบ error ทุก route

## คำสั่งที่รัน + ผลจริง
ตรวจซ้ำที่ `0dab604`:
| คำสั่ง | ผล |
|---|---|
| `npx vitest run --config <นอก repo> tests/calendar/ics tests/ui/add-to-calendar tests/security tests/appointments/appointments tests/busy/calendar-visibility tests/ops/headers tests/rbac` | ไฟล์ 19 ผ่าน / 1 ล้ม · เทสต์ 2852 ผ่าน / 2 ล้ม / 1 ข้าม |
| 2 ข้อที่ล้ม | `tests/security/config-hygiene.test.ts` ข้อ permissions ของ `ci.yml` และ `keepalive.yml` ตรงกับปัญหา CRLF เดิมของเครื่อง Windows |
| เทสต์ทดลองชุดตรวจซ้ำ 15 ข้อ นอก repo (audit, ด่าน cross-site, oracle, เวลา) | 15 ผ่าน |
| เทสต์ทดลองชุดเดิม 77 ข้อ นอก repo | 76 ผ่าน / 1 ล้มตามคาด: ข้อที่บันทึกพฤติกรรมก่อนแก้ว่าสมาชิก cross-site ได้ไฟล์ · ผล audit ของ SA กรณี cancelled/จบแล้วเปลี่ยนจาก 0 เป็น 1 |
| `git diff 41582ed..HEAD` grep `console.`/token | ไม่พบ |

ตรวจครั้งแรกที่ `1336803`: ชุดเดียวกัน ไฟล์ 19 ผ่าน / 1 ล้ม · เทสต์ 2835 ผ่าน / 2 ล้ม (ข้อเดิม) / 1 ข้าม · เทสต์ทดลอง 77 ผ่าน · `git ls-files` track แค่ `.env.example`

## สิ่งที่ตรวจไม่ได้
- e2e บนเบราว์เซอร์และเซิร์ฟเวอร์จริง (`next build`/`next start`) · header ความปลอดภัยของ `next.config.ts` บน route นี้ยืนยันจาก config และ `tests/ops/headers.test.ts` ไม่ได้ยิงเซิร์ฟเวอร์จริง
- ค่า `Sec-Fetch-Site` จากเบราว์เซอร์จริงในการเปิดลิงก์ข้ามไซต์ (ตรวจระดับ handler ด้วย header ที่ตั้งเอง)
- `npm test` ทั้งชุดและ CI · branch นี้ยังไม่มี PR
- การทำงานบนเครื่องจริง iPhone/Android ตาม §9 (R12-18) และเวลาตอบบน Turso production
