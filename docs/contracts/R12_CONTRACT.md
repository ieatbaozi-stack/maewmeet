# R12_CONTRACT.md — เพิ่มนัดลงปฏิทินในเครื่อง (.ics + Google Calendar)

> ผู้เขียน: main · 2026-11-10 · สถานะ: **boss เห็นชอบแล้ว** 2026-11-10 ("เห็นชอบ เริ่มเลย")
> ที่มา: boss ถามว่าคนที่กด "ไป" เอานัดลงปฏิทิน iOS/Android ได้ไหม
> branch งาน: `feat/r12-add-to-calendar` แตกจาก `main` ล่าสุด (R11 / PR #28 merge แล้วที่ `348bd86` · contract นี้ตรวจเทียบกับ R11 แล้ว)
> ข้อเสนอเลขเวอร์ชัน: **v0.13.0** ถ้า boss ออก v0.12.0 (R11) ก่อน R12 merge · ถ้ายังไม่ออก R11 จะรวมอยู่ในรุ่นเดียวกับ R12 ให้ boss เลือกเลขตอนออกรุ่น · **ไม่มี migration** ถ้าพบว่าจำเป็นต้องมี หยุดและแจ้ง main ก่อน

## 1. เป้าหมาย
คนที่ตอบ "ไป" กด **เพิ่มลงปฏิทิน** ในหน้านัด แล้วได้นัดนั้นในปฏิทินของตัวเอง

**นี่คือการคัดลอกครั้งเดียว** นัดที่เลื่อนหรือยกเลิกภายหลัง **จะไม่เปลี่ยนตามในปฏิทินเครื่อง** ผู้ใช้ต้องแก้เอง และ UI ต้องบอกก่อนกด (§4.3)

R12 ไม่แก้กติกาแจ้งเตือนของ R11 คนที่เพิ่มลงปฏิทินแล้วจะรู้ว่านัดเปลี่ยนจากช่องทางเหล่านี้เท่านั้น
| เหตุการณ์ | คนที่ตอบ "ไป" ได้รับ |
|---|---|
| ยกเลิกก่อนเวลาเริ่ม | กระดิ่ง + LINE (ถ้าเชื่อม LINE) |
| เปลี่ยนเวลาหรือสถานที่ | กระดิ่งเท่านั้น |
| แก้แค่ชื่อนัด | ไม่มีแจ้งเตือน ชื่อในปฏิทินจะเก่าโดยไม่มีใครบอก |

### User story
ในฐานะสมาชิกที่ตอบ "ไป" ฉันอยากเพิ่มนัดลงปฏิทินในมือถือ เพื่อเห็นนัดรวมกับตารางอื่นของฉัน

## 2. ขอบเขต
**ทำ**
- ปุ่ม "เพิ่มลงปฏิทิน" ในหน้า `/appointments/[id]` + sheet เลือกปลายทาง
- ไฟล์ `.ics` ผ่าน route ที่ต้องล็อกอิน
- ลิงก์ Google Calendar แบบกรอกข้อมูลไว้ให้
- กรณีเปิดใน LINE in-app browser
- `/privacy`, README, quickstart

**ไม่ทำ**
- ปฏิทินแบบ subscribe / webcal / feed ที่อัปเดตเอง และ URL แบบมี token
- OAuth หรือ Google Calendar API
- เตือนจากไฟล์ (`VALARM`) · ใช้ค่าเตือนของปฏิทินในเครื่องตามปกติ
- ส่งออกหลายนัดพร้อมกัน · ลิงก์เฉพาะ Outlook/Yahoo
- เปลี่ยน RBAC, schema หรือ CSP

## 3. ผลตรวจเอกสาร (2026-11-10)
| เรื่อง | สิ่งที่ยืนยันได้ | สถานะ |
|---|---|---|
| รูปแบบ `.ics` | RFC 5545: `UID`, `DTSTAMP` บังคับ · บรรทัดไม่ควรเกิน 75 octet พับด้วย CRLF + ช่องว่าง · escape `\\`, `\;`, `\,`, `\n` ไม่ escape `:` · เวลา UTC ลงท้าย `Z` และห้ามมี `TZID` · ใช้ `DTEND` หรือ `DURATION` อย่างใดอย่างหนึ่ง | ทางการ [1] |
| iPhone: Safari เปิด `.ics` | **Apple ไม่มีเอกสารเรื่องนี้** คู่มือ iPhone พูดถึงการ subscribe และนำเข้า `.ics` จาก Mail [2] · รายงานจากนักพัฒนาบอกว่า Safari แสดงตัวอย่างและมี "Add All" [3] แต่บางรายงานบอกว่าดาวน์โหลดแล้วไม่มีตัวเลือก Calendar [4] | **ต้องทดสอบจริง** |
| iPhone: เพิ่มซ้ำหลังนัดเปลี่ยน (UID เดิม) | รายงานเดียว ไม่มีคำตอบจาก Apple: กด "Add All" แล้วไม่เกิดอะไร [3] | **ต้องทดสอบจริง** |
| ลิงก์ `calendar/render?action=TEMPLATE` | **Google ไม่มีเอกสารทางการ** ใช้กันแพร่หลายตามเอกสารชุมชน [5] · รายงานว่าบน Android ต้องใช้ `render` ส่วน `eventedit` เปิดแอปแล้วไม่ขึ้นฟอร์ม [6] · Google อาจเปลี่ยนได้โดยไม่แจ้ง | ไม่ทางการ · **ต้องทดสอบจริง** |
| Android เปิด `.ics` | Google ระบุเฉพาะ "import with ICS and CSV files on a computer" และไม่พูดถึงมือถือ [7] | **ต้องทดสอบจริง** |
| `openExternalBrowser=1` | LINE: ใช้ได้กับทุก URL ที่เปิดจากแอป LINE ยกเว้น LIFF · รองรับ iOS/Android ไม่รองรับ LINE PC [8] | ทางการ |
| ดาวน์โหลดไฟล์ใน LINE in-app browser | เอกสาร LINE ไม่พูดถึง [8] · WKWebView ต้องให้แอปรองรับการดาวน์โหลดเอง [9] | **สมมติว่าใช้ไม่ได้** (§4.4) |

## 4. พฤติกรรม
### 4.1 ใครเห็นปุ่ม
แสดงเมื่อ `a.rsvp.mine === "going"` และบันทึกคำตอบเสร็จแล้ว (`!saving`) และนัดยัง active และ `!a.isPast` · วางใต้ `RsvpControl` ใน `appt-rsvp-section` · เปลี่ยนจาก "ไป" เป็นคำตอบอื่น ปุ่มหาย

ซ่อนปุ่มเป็นเรื่องประสบการณ์ใช้งาน ไม่ใช่การป้องกัน สิทธิ์ตัดสินที่เซิร์ฟเวอร์ (§5) · route **ไม่บังคับว่าต้องตอบ "ไป"** เพราะสมาชิกทุกคนเห็นข้อมูลชุดนี้ในหน้านัดอยู่แล้ว

### 4.2 Sheet เลือกปลายทาง
ใช้ `Sheet` เดิม มี 2 ตัวเลือก แสดงเสมอทั้งคู่ · ตรวจอุปกรณ์จาก user agent **เพื่อจัดลำดับเท่านั้น** ตรวจผิดก็ยังเลือกได้

| อุปกรณ์ | อันดับ 1 | อันดับ 2 |
|---|---|---|
| iPhone / iPad (iPadOS ที่ UA เป็น Macintosh ดูจาก `maxTouchPoints > 1`) | ไฟล์ `.ics` | Google Calendar |
| Android | Google Calendar | ไฟล์ `.ics` |
| อื่น ๆ | Google Calendar | ไฟล์ `.ics` |

- ลิงก์ `.ics` เป็น `<a href>` ธรรมดา **ห้ามใช้ `next/link`** (กัน prefetch) และห้ามใช้ `fetch` + Blob
- ลิงก์ Google เป็น `<a target="_blank" rel="noopener noreferrer">`
- CSP เดิมไม่ต้องแก้ เพราะเป็นการนำทางด้วยลิงก์ ไม่ใช่ `fetch` หรือ `form`
- ตรวจ UA ตอนเปิด sheet ฝั่ง client เพื่อไม่ให้ hydrate ไม่ตรง · เขียนเป็นฟังก์ชัน pure ใน `components/appointments/model.ts`

### 4.3 ถ้อยคำ (ร่าง · ux เกลาได้ · อยู่ใน `messages/*.json` เท่านั้น)
| คีย์ `appointments.calendar.*` | ไทย | English |
|---|---|---|
| `add` | เพิ่มลงปฏิทิน | Add to calendar |
| `sheetTitle` | เพิ่มนัดนี้ลงปฏิทิน | Add this plan to your calendar |
| `device` | ปฏิทินในเครื่อง (ไฟล์ .ics) | Phone calendar (.ics file) |
| `google` | Google Calendar | Google Calendar |
| `oneTime` | เป็นการคัดลอกครั้งเดียว ถ้านัดเลื่อนหรือยกเลิกภายหลัง ปฏิทินจะไม่เปลี่ยนตาม ต้องแก้เอง | This is a one-time copy. If the plan moves or gets cancelled, your calendar won't update, so you'll need to change it yourself. |
| `googleNote` | ชื่อนัด เวลา และสถานที่จะถูกส่งไปที่ Google | The title, time and place will be sent to Google. |
| `lineHint` | เปิดในเบราว์เซอร์ก่อน แล้วค่อยเพิ่มลงปฏิทิน | Open this in your browser first, then add it to your calendar. |
| `lineOpen` | เปิดในเบราว์เซอร์ | Open in browser |

`oneTime` ต้องเห็นได้โดยไม่ต้องกดเพิ่ม · `googleNote` อยู่ติดตัวเลือก Google

### 4.4 ใน LINE in-app browser
เหตุผล: LINE in-app browser มีคุกกี้แยกจาก Safari/Chrome และเอกสารไม่รับรองการดาวน์โหลดไฟล์ (§3)
- ลิงก์นัดจาก LINE OA มี `?openExternalBrowser=1` อยู่แล้ว (`src/lib/integrations/line/messages.ts`) กรณีปกติจึงไม่เข้าเงื่อนไขนี้
- ถ้า UA มีโทเคน `Line/` (เช่นเพื่อนแปะลิงก์ในแชท): sheet **ไม่แสดง 2 ตัวเลือก** แต่แสดง `oneTime`, `lineHint` และลิงก์ `lineOpen` ไป `/appointments/<id>?openExternalBrowser=1`
- UA ของ LINE ไม่มีเอกสารรับรอง จึงใช้กับการแสดงผลเท่านั้น ไม่ใช้ตัดสินสิทธิ์
- ไม่ใช้ LIFF

## 5. API
### `GET /api/appointments/:id/calendar.ics`
- เพิ่มใน `ROUTE_MANIFEST`: `action: 'appointment.view'`, `auth: 'actor'`, `owner: 'platform'` · **ไม่เพิ่ม action ใหม่**
- service ใหม่ใน `services/appointments.ts` ใช้ `appointmentFor` + `authorize(actor, 'appointment.view', …)` + `auditRead` แบบเดียวกับ `getAppointment` (กฎ 6)
- `route()` ปัจจุบันคืน JSON เท่านั้น → เพิ่มทางเลือกใน `reply()` สำหรับ body ข้อความล้วน โดยยังผ่านขั้นตอนเดิมครบ (actor, ต่ออายุคุกกี้ session, `Cache-Control: private, no-store`) · ของเดิมต้องไม่เปลี่ยน

| กรณี | เรียกแบบ API | เปิดจากลิงก์ (`Sec-Fetch-Mode: navigate`) |
|---|---|---|
| สมาชิก, นัด active, ยังไม่จบ | 200 ไฟล์ `.ics` | 200 ไฟล์ `.ics` |
| ไม่ได้ล็อกอิน | 401 | 303 ไป `/appointments/<id>` |
| `must_change_pin` | 403 | 303 ไป `/appointments/<id>` |
| ไม่ใช่สมาชิก / ถูกนำออก / ไม่มีนัด | 404 | 303 ไป `/appointments/<id>` |
| id ผิดรูป | 400 `VALIDATION` | 303 ไป `/` |
| ยกเลิกแล้ว | 409 `APPOINTMENT_CANCELLED` | 303 ไป `/appointments/<id>` |
| จบแล้ว (`endAt <= now`) | 409 `APPOINTMENT_PAST` | 303 ไป `/appointments/<id>` |

- redirect ทำผ่านตัวเลือก `finalize` ของ `route()` ซึ่งทำงานหลังขั้นตอนเดิมทั้งหมด (ด่าน `authorize-first` บังคับ `export const GET = route(...)` จึงครอบด้วยฟังก์ชันอื่นไม่ได้) เพื่อไม่ให้ผู้ใช้เจอ JSON ดิบ · เปิดจากลิงก์แล้วไม่สำเร็จทุกกรณีได้ 303 รวม suspended และ 500 · หน้าปลายทางตรวจสิทธิ์ของตัวเองอยู่แล้ว
- เปิดจากลิงก์ข้ามไซต์ (`Sec-Fetch-Site: cross-site`) ได้ 303 ไป `/appointments/<id>` เสมอ (id ผิดรูปไป `/` ตามตาราง) แม้เป็นสมาชิก เพื่อไม่ให้เว็บอื่นสั่งดาวน์โหลดหรือเดาสถานะสมาชิก (security R12 Low 2)
- `auditRead` ทำก่อนตรวจสถานะยกเลิก/จบแล้ว เหมือน `getAppointment` (security R12 Low 1)
- ไม่ใช่สมาชิกกับไม่มีนัดต้องตอบเหมือนกันทุกไบต์ (ADR 0003)

Header ตอนสำเร็จ:
```
Content-Type: text/calendar; charset=utf-8
Content-Disposition: attachment; filename="maewmeet-plan.ics"
Cache-Control: private, no-store
```
ชื่อไฟล์คงที่ ห้ามมาจากชื่อนัด · `attachment` เป็นค่าเริ่มต้น ตั้งเป็นค่าคงที่เดียว ถ้าทดสอบจริง (§9) พบว่า `inline` ใช้ได้ดีกว่าบน iPhone ให้เปลี่ยนจุดเดียว

### รูปไฟล์
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//maewmeet//Add to Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:<appointmentId>@maewmeet
DTSTAMP:<now UTC>
DTSTART:<startAt UTC>
DTEND:<endAt UTC>
SUMMARY:<title>
LOCATION:<placeName>
DESCRIPTION:<appOrigin>/appointments/<id>
URL:<appOrigin>/appointments/<id>
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR
```
- ไม่มี `placeName` = ไม่มีบรรทัด `LOCATION` · ไม่มี `ORGANIZER`/`ATTENDEE`
- **เวลา**: ใช้ UTC รูป `YYYYMMDDTHHMMSSZ` ทั้งหมด ไม่ต้องมี `VTIMEZONE` · แปลงจาก epoch ms ด้วยฟังก์ชันใหม่ใน `src/lib/calendar` เท่านั้น (กฎ 9) · ปีเป็น ค.ศ. เสมอ
- **UID**: คงที่ต่อนัด ไม่ขึ้นกับผู้ใช้ เวลา หรือโดเมน · ลิงก์ Google ไม่มี UID กดซ้ำจึงอาจได้รายการซ้ำ
- **Escape (ค่า TEXT)**: `\` → `\\` ก่อน แล้ว `;` → `\;`, `,` → `\,`, CRLF/CR/LF → `\n` · อักขระควบคุมอื่นตัดทิ้ง · `:` ไม่ escape
- **Fold**: นับเป็น **octet ของ UTF-8** ไม่เกิน 75 ต่อบรรทัด รวมช่องว่างนำหน้าบรรทัดต่อ · พับด้วย CRLF + ช่องว่าง · **ห้ามตัดกลางตัวอักษร UTF-8** (ไทย 3 octet ต่อตัว) · ทุกบรรทัดจบด้วย CRLF รวมบรรทัดสุดท้าย · ไม่มี BOM
- `appOrigin` จาก `configuredAppOrigin(env)` · dev ที่ไม่มีค่าใช้ origin ของ request
- เขียนเองในไลบรารีกลาง ไม่เพิ่ม dependency runtime

### ลิงก์ Google Calendar (สร้างฝั่ง client จาก DTO · ไม่ผ่านเซิร์ฟเวอร์เรา)
```
https://calendar.google.com/calendar/render?action=TEMPLATE&text=<title>&dates=<startZ>/<endZ>&ctz=<tz>&location=<placeName>&details=<appOrigin>/appointments/<id>
```
ค่าทุกช่อง `encodeURIComponent` ยกเว้น `/` คั่นใน `dates` · ไม่มี `placeName` = ไม่มี `location` · `appOrigin` ส่งเป็น prop จาก `page.tsx`

## 6. ข้อมูลที่ออกนอกแอป
| ข้อมูล | ไฟล์ `.ics` | ลิงก์ Google |
|---|---|---|
| ชื่อนัด, เวลาเริ่ม/จบ | ส่ง | ส่ง |
| timezone ของนัด | เวลา UTC ไม่ระบุ tz | ส่ง (`ctz`) |
| ชื่อสถานที่ | ส่ง | ส่ง |
| ลิงก์นัด (มี id, ต้องล็อกอินจึงเปิดได้) | ส่ง | ส่ง |
| รายละเอียดนัด (ข้อความอิสระ) | **ไม่ส่ง** (boss เลือก 2026-11-10) | **ไม่ส่ง** (boss เลือก 2026-11-10) |
| พิกัด, ลิงก์แผนที่ | ไม่ส่ง | ไม่ส่ง |
| ชื่อกลุ่ม, ชื่อสมาชิก, RSVP, busy | ไม่ส่ง | ไม่ส่ง |

- ข้อมูลออกเมื่อผู้ใช้กดเองเท่านั้น
- ลิงก์ Google: ข้อมูลอยู่ใน URL จึงถึง Google และอยู่ในประวัติเบราว์เซอร์ · ไม่ส่ง Referer (`noreferrer`)
- ไฟล์ `.ics`: อยู่ในเครื่อง แต่ปฏิทินอาจซิงก์ไปบัญชี iCloud/Google ของผู้ใช้
- ชื่อนัดและสถานที่อาจเป็นข้อความที่คนอื่นพิมพ์ · ลบจากแอปแล้วไม่หายจากปฏิทินผู้ใช้
- **`/privacy` ต้องอัปเดต**: เพิ่ม Google เป็นปลายทางใหม่ เพิ่ม `{ key: "calendar", items: ["body"] }` ใน `SECTIONS`, คีย์ `privacy.calendar.{title,body}` TH/EN และแก้ `privacy.updated`
- route ห้าม log ชื่อนัดหรือสถานที่

## 7. ไฟล์และผู้รับผิดชอบ
| บทบาท | งาน |
|---|---|
| ux | `docs/design/R12_ADD_TO_CALENDAR.md` (wireframe sheet ทุกสถานะ), เนื้อหา `messages/*.json` รวม `/privacy` |
| platform | `src/lib/calendar/**` (เวลา UTC, สร้าง ICS, ลิงก์ Google), `tests/calendar/**`, route ใหม่ `calendar.ics/route.ts`, `manifest.ts`, `reply()` ใน `route.ts`, service, เทสต์ route |
| frontend | `AppointmentDetail.tsx`, คอมโพเนนต์ sheet ใหม่, `model.ts`, `page.tsx` (`appOrigin`), `privacy/page.tsx`, เพิ่มคีย์ `messages/*.json`, เทสต์ UI |
| test | `tests/e2e/r12-add-to-calendar.spec.ts` · เมทริกซ์สิทธิ์ของ route |
| secretary | `README.md`, `docs/guides/quickstart-th.html`, `docs/team/PROGRESS.md` (ไฟล์ README/quickstart ไม่มีเจ้าของ main มอบให้ secretary ตาม R11) |
| ops | `CHANGELOG.md` ส่วน Unreleased |
| qa | ตรวจอิสระตาม §8 |
| security | ตรวจอิสระ §5–§6 · รายงาน `docs/reports/security-r12.md` |

ลำดับ: boss เห็นชอบ → ux และ platform ขนานกัน → frontend → test → secretary, ops → qa, security → PR → ทดสอบเครื่องจริงบน preview (§9) → boss merge

## 8. เกณฑ์ผ่าน
| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R12-1 | ปุ่มแสดงเฉพาะตอบ "ไป", นัด active, ยังไม่จบ · ไม่แสดงกรณี อาจไป/ไม่ไป/ยังไม่ตอบ/ยกเลิก/จบแล้ว | Vitest + e2e |
| R12-2 | route ตอบตารางใน §5 ครบทุกแถว ทั้งแบบ API และแบบ navigate | Vitest |
| R12-3 | เมทริกซ์ super admin / admin / moderator / member / ไม่ใช่สมาชิก / ถูกนำออก / ไม่ล็อกอิน / `must_change_pin` ถูกต้อง · 404 ของคนนอกกับนัดไม่มีเหมือนกันทุกไบต์ · ไม่มีข้อมูลนัดใน response ที่ไม่สำเร็จ | Vitest + security |
| R12-4 | header ตรง §5 · ชื่อไฟล์คงที่แม้ชื่อนัดมี `"`, CRLF, ภาษาไทย | Vitest |
| R12-5 | เวลา UTC ถูกต้อง: 19:00–21:00 `Asia/Bangkok` = `120000Z`–`140000Z` · ข้ามเที่ยงคืน UTC · ข้ามปี · 29 ก.พ. · ไม่มีปี พ.ศ. | Vitest (`tests/calendar`) |
| R12-6 | UID เดิมทุกครั้งสำหรับนัดเดิม ต่างกันระหว่างนัด และเหมือนกันระหว่างผู้ใช้ | Vitest |
| R12-7 | Escape ถูกกับ `\ ; , :` และ CRLF/CR/LF · ชื่อนัดที่มี `\r\nATTENDEE:x` ไม่เกิดบรรทัดใหม่ | Vitest + security |
| R12-8 | Fold: ชื่อไทย 80 ตัวและสถานที่ยาว ทุกบรรทัด ≤ 75 octet · ไม่มี U+FFFD เมื่อ decode ทีละบรรทัด · unfold แล้วได้ค่าเดิม | Vitest |
| R12-9 | ไฟล์ผ่าน parser อิสระที่ไม่ใช่โค้ดของเรา (qa เลือกเอง ไม่เพิ่มใน dependency ของแอป) | qa แนบผล |
| R12-10 | ลิงก์ Google decode แล้วได้ค่าตรงตามภาษาไทยและอักขระพิเศษ · **ไม่มี** รายละเอียด/พิกัด/ชื่อกลุ่ม/ชื่อสมาชิก | Vitest + security |
| R12-11 | ลำดับตัวเลือกตาม §4.2 รวม iPadOS · UA LINE ได้หน้าตาม §4.4 | Vitest (`tests/ui`) |
| R12-12 | ข้อความ one-time เห็นได้ก่อนกดเพิ่ม · ไม่มี hard-code · คีย์ TH/EN ครบ | เทสต์ i18n + qa |
| R12-13 | 375/390/768 × th/en × สว่าง/มืด: ไม่มี horizontal scroll, ปุ่ม ≥ 44px, คอนทราสต์ผ่าน, ผ่าน Anti-slop | e2e + qa ภาพหน้าจอ |
| R12-14 | `/privacy` มีเนื้อหา §6 TH/EN และตรงกับพฤติกรรมจริง | qa + security |
| R12-15 | README และ quickstart อธิบายวิธีใช้และบอกว่าเป็นการคัดลอกครั้งเดียว | qa |
| R12-16 | ไม่มี migration · `npm run lint`, `typecheck`, `test`, `build`, `test:e2e` และ CI เขียว · Vercel preview เขียว | platform + qa |
| R12-17 | ไม่มีชื่อนัด/สถานที่ใน log | security |
| R12-18 | ผ่านเครื่องจริงตาม §9 ก่อน merge | boss + main |

ผู้ตรวจอิสระ: `qa` และ `security` (route ใหม่ + ข้อมูลออกไปบริการภายนอก) ต้องเป็นคนละตัวกับผู้ทำ (กฎ 5)

## 9. ทดสอบเครื่องจริงบน preview (iPhone: boss · Android: คนที่ boss ให้ช่วย · main บอกทีละขั้น)
ใช้นัดทดสอบชื่อไทยยาว มี `,` และ `;` เริ่ม 19:00 มีสถานที่

ผู้ช่วยทดสอบ Android ต้องเปิด preview ได้และใช้บัญชีทดสอบที่อยู่ในกลุ่มของนัดทดสอบ ไม่ใช้บัญชีจริงของใคร · boss เป็นคนส่งลิงก์ให้และรับผลกลับมาแจ้ง main

**iPhone**
| # | ทดสอบ | ผลที่ต้องได้ |
|---|---|---|
| I1 | Safari กด `.ics` (`attachment`) | เพิ่มลง Calendar ได้ · ชื่อไทยไม่เพี้ยน · เวลา 19:00 |
| I2 | ถ้า I1 ไม่ผ่าน ลอง `inline` | ใช้ค่าที่ผ่าน |
| I3 | Chrome บน iPhone กด `.ics` | จดผล |
| I4 | แอปที่ติดตั้งลงหน้าจอหลัก (PWA) กด `.ics` และ Google | จดผล · ถ้าไม่ได้ต้องไม่ค้าง |
| I5 | ลิงก์จาก LINE OA | ออก Safari แล้วใช้ได้ |
| I6 | แปะลิงก์ในแชท LINE แล้วเปิด | เห็นข้อความ §4.4 · ปุ่มพาออก Safari ได้ |
| I7 | เพิ่มแล้วเลื่อนเวลานัด แล้วเพิ่มอีกครั้ง | จดผล: อัปเดต, ซ้ำ หรือกดแล้วไม่เกิดอะไร |
| I8 | ยกเลิกนัดหลังเพิ่มแล้ว | ปฏิทินไม่เปลี่ยน ตรงกับข้อความในแอป |
| I9 | iPad Safari กด `.ics` | เหมือน I1 |

**Android**
| # | ทดสอบ | ผลที่ต้องได้ |
|---|---|---|
| A1 | Chrome + มีแอป Google Calendar กด Google | ขึ้นฟอร์มกรอกข้อมูลครบ · เวลา 19:00 · ชื่อไทยไม่เพี้ยน |
| A2 | Chrome ที่ยังไม่ล็อกอิน Google | ข้อมูลไม่หายหลังล็อกอิน |
| A3 | กด `.ics` แล้วเปิดด้วยแอปปฏิทิน (Google และ Samsung ถ้ามี) | จดผล |
| A4 | PWA กด `.ics` และ Google | จดผล |
| A5 | ลิงก์จาก LINE OA และลิงก์ที่แปะในแชท | เหมือน I5, I6 |
| A6 | กด Google ซ้ำ 2 ครั้ง | จดว่าได้รายการซ้ำไหม |

**เกณฑ์ตัดสิน**
- I1 และ I2 ไม่ผ่านทั้งคู่ หรือ A1 ไม่ผ่าน = **ไม่ merge** หยุดให้ boss ตัดสิน
- ข้ออื่นที่ไม่ผ่าน ให้จดเป็นข้อจำกัดและปรับคำอธิบายใน UI/quickstart ก่อน merge

## 10. ความเสี่ยง
- ลิงก์ Google ไม่มีเอกสารทางการ อาจเปลี่ยนได้ · `.ics` ยังเป็นทางเลือกสำรอง
- พฤติกรรม iOS/Android ต่างตามเวอร์ชันและแอปปฏิทิน เทสต์อัตโนมัติยืนยันได้แค่ไฟล์และลิงก์ ไม่ยืนยันการเพิ่มลงเครื่อง
- ผู้ใช้เข้าใจผิดว่าปฏิทินจะอัปเดตเอง · ลดด้วย `oneTime`, quickstart และการแจ้งเตือนของ R11 · การเลื่อนนัดไม่มี LINE (กระดิ่งเท่านั้น) คนที่ไม่เปิดแอปจึงอาจยึดเวลาเก่าในปฏิทิน

## 11. boss ต้องตัดสินใจ
| # | เรื่อง | ค่าแนะนำ |
|---|---|---|
| B1 | ส่ง "รายละเอียดนัด" ไปด้วยไหม | **ตัดสินแล้ว 2026-11-10: ไม่ส่ง** ("ไม่ส่ง ตามแนะนำ") เพราะเป็นข้อความอิสระ ≤ 1000 ตัวและจะอยู่ใน URL ที่ไป Google · ปฏิทินมีลิงก์กลับมาหน้านัดอยู่แล้ว |
| B2 | ใครทดสอบ Android จริงตาม §9 | **ตัดสินแล้ว 2026-11-10: คนที่ boss ให้ช่วย** ("ให้คนอื่นช่วย") · ไม่มีผล Android = merge ไม่ได้ตามเกณฑ์ |
| B3 | เห็นชอบ contract นี้และให้เริ่มงาน (R11 merge แล้ว) | **ตัดสินแล้ว 2026-11-10: เห็นชอบ** ("เห็นชอบ เริ่มเลย") |

## 12. แหล่งอ้างอิง (เข้าถึง 2026-11-10)
1. RFC 5545: https://www.rfc-editor.org/rfc/rfc5545.txt
2. Apple, Set up mail, contacts, and calendar accounts on iPhone: https://support.apple.com/en-mn/guide/iphone/ipha0d932e96/ios
3. Apple Developer Forums (ผู้ใช้รายงาน ไม่มีคำตอบจาก Apple): https://developer.apple.com/forums/thread/772082
4. Apple Developer Forums (ผู้ใช้รายงาน ไม่มีคำตอบจาก Apple): https://developer.apple.com/forums/thread/711525
5. เอกสารชุมชน: https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/main/services/google.md
6. รายงานปัญหา Drupal: https://www.drupal.org/project/addtocal_augment/issues/3513070
7. Google Calendar Help, Import events: https://support.google.com/calendar/answer/37118?hl=en
8. LINE Developers, Using LINE URL scheme: https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/
9. รายงานชุมชนเรื่องดาวน์โหลดใน WKWebView: https://github.com/maevsi/ios/issues/10
