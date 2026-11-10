# R11_CONTRACT.md — แจ้งเตือนเหตุการณ์นัดและสมาชิก (กระดิ่ง + LINE ยกเลิกนัด)

> ผู้เขียน: main · 2026-11-10 · สถานะ: **boss เห็นชอบขอบเขตแล้ว** 2026-11-10 ("งั้นก็ตามที่แนะนำ เลยครับ ทำต่อได้")
> ที่มา: boss ขอเพิ่มในกระดิ่ง และให้ยกเลิกนัดแจ้งผ่าน LINE ด้วย · เลื่อนนัดไม่ส่ง LINE (boss 2026-11-10)
> branch: `feat/r11-notification-events` · ข้อเสนอเลขเวอร์ชัน: **v0.12.0** · **ไม่มี migration** (`notification.kind` เป็น text · outbox เก็บ payload JSON) ถ้าพบว่าจำเป็นต้องมี หยุดและแจ้ง main ก่อน

## 1. ชนิดแจ้งเตือนใหม่
ทุกแถวเขียนใน transaction เดียวกับการกระทำ · ไม่แจ้งผู้กระทำเอง · ผู้รับต้องเป็นสมาชิกปัจจุบันของกลุ่มและบัญชี active ยกเว้น `removed` ที่ส่งถึงคนที่เพิ่งถูกนำออก

| ชนิด | เกิดเมื่อ | ผู้รับกระดิ่ง | LINE | กดแล้วไป |
|---|---|---|---|---|
| `appointment.cancelled` | ยกเลิกนัดสำเร็จ และ `startAt > now` | ตอบ "ไป" / "อาจไป" / ยังไม่ตอบ | **เฉพาะคนตอบ "ไป"** ที่เชื่อม LINE | หน้านัด |
| `appointment.updated` | เวลา (`startAt`/`endAt`) หรือสถานที่เปลี่ยนจริง | สมาชิกทุกคน | ไม่ส่ง | หน้านัด |
| `appointment.rsvp_changed` | คำตอบเปลี่ยนจากค่าเดิม (รวมตอบครั้งแรก) | **ผู้สร้างนัดเท่านั้น** | ไม่ส่ง | หน้านัด |
| `group.member.joined` | เข้ากลุ่มด้วยโค้ดเชิญ หรือรับคำเชิญตรงสำเร็จ (เป็นสมาชิกใหม่จริง) | admin + moderator (ยกเว้นผู้เชิญกรณีคำเชิญตรง เพราะได้ `group.invite.accepted` แล้ว) | ไม่ส่ง | หน้ากลุ่ม |
| `group.member.left` | ออกจากกลุ่มเอง | admin + moderator | ไม่ส่ง | หน้ากลุ่ม |
| `group.member.removed` | ถูกนำออก | คนที่ถูกนำออก | ไม่ส่ง | `/groups` |
| `group.member.role_changed` | `setMemberRole` เปลี่ยนจริง หรือ `transferAdmin` | คนที่สิทธิ์เปลี่ยน (โอนผู้ดูแล: ผู้รับตำแหน่ง และผู้ดูแลเดิมถ้าไม่ใช่ผู้กระทำ) | ไม่ส่ง | หน้ากลุ่ม |

ไม่แจ้งเมื่อ: ยกเลิกหลังเวลาเริ่ม · แก้แค่ชื่อ/รายละเอียดนัด · ตอบคำตอบเดิมซ้ำ · ผู้สร้างตอบนัดของตัวเอง · ผู้สร้างออกจากกลุ่มหรือบัญชีไม่ active แล้ว

### กันกระดิ่งรก
- `appointment.updated`: ถ้าผู้รับยังมีรายการของนัดเดียวกันที่ยังไม่อ่าน ให้แทนที่ของเดิม · `changes` รวมกับของเดิม (เคยเปลี่ยนเวลา แล้วเปลี่ยนสถานที่ต่อ = `both`) · `startAt` เป็นค่าล่าสุด
- `appointment.rsvp_changed`: ถ้าผู้สร้างยังมีรายการของนัดเดียวกันจากผู้ตอบคนเดิมที่ยังไม่อ่าน ให้แทนที่ของเดิม
- `appointment.cancelled`: ใช้เพดานรายการที่ยังไม่อ่านต่อกลุ่มต่อคนแบบเดียวกับ `appointment.created` แต่นับแยกชนิด เพื่อให้นัดใหม่ที่ค้างอ่านไม่บังการแจ้งยกเลิก · เกินเพดาน = ไม่เขียนกระดิ่งและไม่ส่ง LINE ให้คนนั้น (กันการสร้าง+ยกเลิกวนซ้ำ)
- `group.member.joined`, `group.member.left`, `group.member.role_changed`: ใช้เพดานรายการที่ยังไม่อ่านต่อกลุ่มต่อคนต่อชนิดแบบเดียวกัน (security R11 M1, L1) · เกินเพดาน = ไม่เขียนแถวใหม่ จนกว่าผู้รับจะอ่าน
- ชนิดอื่นไม่รวมรายการ

### params (ค่าดิบ ผ่าน `sanitizeDisplayText` ก่อนเก็บ ไม่เก็บข้อความแปลแล้ว)
| ชนิด | params |
|---|---|
| `appointment.cancelled` | `groupId, groupName, appointmentId, title, startAt, tz, actorName` |
| `appointment.updated` | เหมือน `cancelled` + `changes: 'time' \| 'place' \| 'both'` (`startAt`, `tz` เป็นค่าใหม่) |
| `appointment.rsvp_changed` | `groupId, groupName, appointmentId, title, startAt, tz, responderName, response` |
| `group.member.joined` / `left` | `groupId, groupName, memberName` |
| `group.member.removed` | `groupId, groupName` (ไม่บอกชื่อผู้นำออก) |
| `group.member.role_changed` | `groupId, groupName, role: 'admin' \| 'moderator' \| 'member'` |

**คีย์ภายในใน DB (ไม่ส่งออก API และไม่อยู่ใน payload LINE):** `actorId` (cancelled/updated), `responderId` (rsvp_changed), `memberId` (joined/left) ใช้จับคู่รายการและล้างชื่อ

**ข้อมูลคนที่ลบบัญชี:** `actorName`, `responderName`, `memberName` ต้องถูกล้าง และคีย์ภายในต้องถูกลบ เมื่อเจ้าของบัญชีลบบัญชี แบบเดียวกับชื่อในแจ้งเตือนคำเชิญ (`src/lib/data/repos/account.ts`)

## 2. LINE เมื่อยกเลิกนัด
- เข้า `notification_outbox` ผ่าน `notify()` เหมือน R10 · แจ้งเฉพาะคนที่ตอบ "ไป" และเชื่อม LINE (กลุ่มผู้รับ LINE แคบกว่ากระดิ่ง)
- **ส่งทันที:** หลัง commit การยกเลิกสำเร็จ พยายาม dispatch ทันทีโดยไม่ทำให้คำตอบ API ช้าลง (เช่น `after()`) · ส่งไม่สำเร็จหรือ dispatch ไม่ได้ทำงาน = แถวยังอยู่ใน outbox และรอบ cron 15 นาทีลองต่อ · ห้ามส่งซ้ำ (จองแถวและ retry key เดิม)
- **ตรวจซ้ำก่อนส่ง:** นัดเป็น `cancelled` · `startAt` ตรงกับตอนเข้าคิว · `startAt > now` · กลุ่มยังอยู่ · ผู้รับ active + ยังเชื่อม LINE · ยังตอบ "ไป"
- เกณฑ์ตรวจของ reminder 1 วัน/1 ชั่วโมงต้องทำงานเหมือนเดิม ไม่อ่อนลง
- เนื้อหา LINE: ชื่อนัด วันเวลา ชื่อกลุ่ม ลิงก์เท่านั้น (ไม่มีชื่อคนกดยกเลิก) · ภาษาตาม `user.locale` ตอนส่ง
- ใช้เพดาน `LINE_SEND_CAPS`, retry, โควตาเต็มเดือน เดิม · เกินเพดาน = ไม่ส่ง LINE แต่กระดิ่งยังขึ้น
- ไม่มี env LINE = ปิดเงียบเหมือน R10

## 3. ข้อความและหน้าจอ
- คีย์: `notifications.appointment.cancelled`, `.appointment.updated`, `.appointment.rsvp_changed`, `.group.member.joined`, `.group.member.left`, `.group.member.removed`, `.group.member.role_changed` · `line.message.cancelled` · TH/EN เป็นธรรมชาติ ไม่แปลตรงตัว
- `appointment.updated` แยกข้อความตาม `changes` · `rsvp_changed` แยกตาม `response` · `role_changed` แยกตาม `role`
- `notificationView` รองรับครบ พร้อมไอคอนและ `href` ตาม §1 · params ไม่ครบ = แสดงแบบ UNKNOWN เดิม
- ปรับข้อความกระดิ่งว่าง (`notifications.empty.body`) ให้ตรงของจริง
- `/privacy` บอกว่า LINE ส่งการยกเลิกนัดด้วย ทั้ง TH/EN

## 4. เอกสาร
- README และ `docs/guides/quickstart-th.html`: อัปเดตรายการกระดิ่งและ LINE ให้ครบทุกชนิด รวมผลคำเชิญ (รับ/ปฏิเสธ) และผลรีเซ็ต PIN ที่ขาดอยู่
- CHANGELOG ส่วน Unreleased

## 5. ไม่ทำ
แจ้งเมื่อลบกลุ่มหรือลบบัญชี · ส่ง LINE ชนิดอื่นนอกจากยกเลิกนัด · ตั้งค่าเปิด/ปิดรายชนิด · Web Push

## 6. ไฟล์ (บทบาท) และเกณฑ์
| บทบาท | งาน |
|---|---|
| platform | `notify()` และชนิดใหม่ · การแทนที่รายการที่ยังไม่อ่าน · จุดเรียกใน services นัด/กลุ่ม/คำเชิญ · ล้างชื่อใน account repo · dispatch + `renderLine*` · เทสต์ Vitest |
| ux | ข้อความ TH/EN ใน `messages/*.json` รวม `/privacy` |
| frontend | `src/components/notifications/model.ts` + การแสดงผล · เทสต์คอมโพเนนต์ |
| test | e2e กระดิ่งชนิดใหม่ 375/390/768 × th/en × สว่าง/มืด |
| ops | CHANGELOG |
| qa | ตรวจอิสระตาม contract |
| security | สิทธิ์และการรั่วข้ามกลุ่ม · ข้อมูลคนใน params · ผู้รับ LINE · การใช้โควตา LINE ในทางผิด |
| secretary | README, quickstart, PROGRESS, รายงาน |

| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R11-1 | ผู้รับของทุกชนิดตรงตาราง §1 รวมไม่แจ้งผู้กระทำ · คนนอกกลุ่มไม่ได้รับ | Vitest |
| R11-2 | กรณี "ไม่แจ้ง" ใน §1 ทั้งหมด | Vitest |
| R11-3 | แทนที่รายการที่ยังไม่อ่านตาม §1 · อ่านแล้วขึ้นรายการใหม่ | Vitest |
| R11-4 | ยกเลิกนัด: LINE เฉพาะคนตอบ "ไป" ที่เชื่อมแล้ว · ส่งทันที · ไม่ซ้ำเมื่อ cron รันตาม · cron ลองต่อเมื่อส่งไม่สำเร็จ | Vitest |
| R11-5 | ตรวจซ้ำก่อนส่ง §2 และ reminder เดิมยังผ่านเกณฑ์ R10 | Vitest |
| R11-6 | การแจ้งเตือนเขียนใน transaction เดียวกับการกระทำ: การกระทำล้มเหลว = ไม่มีแถว | Vitest |
| R11-7 | ลบบัญชีแล้วชื่อใน params ถูกล้าง | Vitest + security |
| R11-8 | กระดิ่งแสดงครบทุกชนิด TH/EN กดแล้วไปถูกหน้า | Vitest + e2e |
| R11-9 | ไม่มี PIN/token/LINE id/ความลับใน log, params, repo | security |
| R11-10 | เอกสารตาม §4 ตรงกับของจริง | qa |
| R11-11 | CI + Vercel preview เขียว | CI |
| R11-12 | หลัง merge: ยกเลิกนัดที่ตอบ "ไป" แล้วได้ LINE ทันที 1 ครั้ง | boss + main |

## 7. โควตา LINE
ยกเลิก 1 นัดใช้ข้อความเท่ากับจำนวนคนที่ตอบ "ไป" และเชื่อม LINE ไม่รวมคนกดยกเลิก · กลุ่ม 6 คนใช้ไม่เกิน 5 ข้อความต่อการยกเลิก 1 ครั้ง
