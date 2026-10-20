# ADR 0007 — การแจ้งเตือน: ชั้นส่งแบบเสียบช่องทาง + `notification_outbox`

- **Status**: Proposed (Architect, 2026-10-15) · แก้ R2 (2026-10-19): ชนิดคำเชิญเป็น `group.invite.received|accepted|declined` (เดิม `invite.direct.*`)
- **เกี่ยวข้อง**: [PRD D13, U2, U5, U10, §6](../prd/PRD.md) · [RESEARCH §2](../research/RESEARCH_REPORT.md) · [ADR 0008](0008-i18n-and-theme.md) · [ARCHITECTURE §3](../design/ARCHITECTURE.md)
- **เจ้าของการ implement**: Platform (แกน `src/lib/data/notifications/**`) · Integrations (ช่องทาง LINE `src/lib/integrations/**`, v1.x)

## Context
v1 มีแค่ "ในแอป" (คำเชิญตรง, นัดใหม่, reset ได้รับอนุมัติ + การยกเลิกคำขอ reset อัตโนมัติตาม U2) · v1.x จะเพิ่ม LINE push ซึ่งส่งได้เฉพาะผู้ใช้ที่เป็นเพื่อนกับ OA, นับโควตาต่อผู้รับ, เกินได้ 429 (RESEARCH §2) · ข้อความต้องเก็บเป็นคีย์ + ตัวแปร แล้วแปลตามภาษาผู้รับตอนแสดง · Vercel Hobby cron วันละครั้ง (ADR 0001) จึงไม่มี worker ประจำ

## Decision

### 1. รูปแบบเหตุการณ์
```ts
// pseudo-code
type NotificationKind =
  | 'group.invite.received'         // → ผู้ถูกเชิญ  params: { groupId, groupName, inviterName, inviteId }
  | 'group.invite.accepted'         // → ผู้เชิญ     params: { groupId, groupName, inviteeName, inviteId }
  | 'group.invite.declined'         // → ผู้เชิญ     params: { groupId, groupName, inviteeName, inviteId }
  | 'appointment.created'           // params: { groupId, groupName, appointmentId, title, startAt, tz }
  | 'pin_reset.approved'            // params: { expiresAt }
  | 'pin_reset.cancelled_by_login'; // params: {}
// เพิ่มชนิดใหม่ = เพิ่มใน union + คีย์ข้อความ TH/EN (เทสต์คีย์ครบตรวจ)
notify(tx, { userIds: string[], kind, params })   // เรียกภายใน transaction เดียวกับการเปลี่ยนข้อมูล
```
- `params` เก็บ **ค่าดิบ** (id, ชื่อ ณ เวลาเกิด, instant เป็น epoch ms) — **ห้ามเก็บข้อความที่แปลแล้ว** และห้ามมี PIN/token/โค้ดเชิญ
- ผู้ก่อเหตุไม่ได้รับแจ้งของตัวเอง (เช่น ผู้สร้างนัด)

### 2. ช่องทาง (plug-in)
```ts
interface NotificationChannel {
  id: 'in_app' | 'line';
  isEnabledFor(user): boolean;              // in_app: true เสมอ · line: line_user_id != null && opt-in && ยังเป็นเพื่อน
  deliver(n: { userId, kind, params, locale }): Promise<'sent' | 'retry' | 'dead'>;
}
```
- **in_app (v1)**: เขียนแถว `notification` **ภายใน transaction เดียวกับเหตุการณ์** (ไม่ผ่าน outbox) — ไม่มีวันหลุด/ซ้ำ
- **ช่องทางภายนอก (v1.x)**: `notify()` เขียนแถว `notification_outbox` (`status = pending`) ใน transaction เดียวกัน → หลังตอบผู้ใช้ เรียก dispatcher ด้วย `after()` ของ Next (ทำงานต่อหลังส่ง response) → cron รายวันเก็บตกแถวที่ค้าง/retry
- retry: `attempts` สูงสุด 5, backoff `next_attempt_at = now + 2^attempts นาที` · LINE 429 "monthly limit" → `dead` ทั้งรอบเดือน (ไม่ retry) + super admin เห็นสถานะ · ผู้ใช้บล็อก OA (webhook `unfollow`) → ปิด `isEnabledFor`
- payload ของ outbox เก็บ `{kind, params}` (ไม่ใช่ข้อความแปลแล้ว) → แปลตาม `user.locale` ณ เวลาส่ง
- v1: ตาราง `notification_outbox` ถูกสร้างใน migration แรกแต่ไม่มีช่องทางที่เปิดใช้ → ไม่มีแถว

### 3. การแสดงผลในแอป
- `GET /api/me/notifications?cursor=` คืน `{id, kind, params, createdAt, readAt}` — **UI แปล** ด้วย next-intl คีย์ `notifications.<kind>` + ICU params (ADR 0008) · วัน-เวลาใน params format ด้วย `src/lib/calendar` ตาม locale ผู้ดู
- `POST /api/me/notifications/read` (`{ids}` หรือ `{all: true}`)
- เก็บ 90 วัน (cron ลบเก่ากว่า) · badge นับ unread จาก index `(user_id, read_at)`
- `pin_reset.approved` ผู้ใช้จะเห็นหลังเข้าด้วย `123456` เท่านั้น → ช่องทางที่มีประโยชน์จริงใน v1 คือหน้า login ที่ถาม `/api/auth/pin-reset/status` (ADR 0002) · ใน v1.x LINE จะส่ง "ได้รับอนุมัติแล้ว ให้เข้าระบบแล้วตั้ง PIN ใหม่" (ไม่ส่ง PIN — RESEARCH §2 ข้อ 6)

## Alternatives considered
| ทางเลือก | ทำไมไม่เลือก |
|---|---|
| in_app ผ่าน outbox เหมือนช่องทางอื่น | เพิ่มความหน่วงและจุดพังโดยไม่จำเป็น — การเขียนแถว DB ใน transaction เดิมคือการ "ส่ง" แล้ว |
| เก็บข้อความที่แปลแล้วในแถว notification | ผู้ใช้สลับภาษาแล้วข้อความเก่ายังเป็นภาษาเดิม ขัด PRD §5 (0007) |
| Queue ภายนอก (Vercel Queues / QStash) | เพิ่มบริการ/ต้นทุน · ปริมาณหลักสิบข้อความต่อวัน outbox ใน Turso + `after()` + cron พอ |
| ส่ง LINE แบบ synchronous ใน request | LINE ช้า/ล่มแล้วทำให้การสร้างนัดล้ม · ไม่มี retry |

## Consequences
- + เพิ่ม LINE ใน R7 โดยไม่แตะโค้ดเหตุการณ์ (แค่เพิ่ม channel + `isEnabledFor`)
- + ข้อความเปลี่ยนตามภาษาผู้รับเสมอ
- − ชื่อกลุ่ม/ชื่อคนใน params เป็น snapshot — เปลี่ยนชื่อทีหลังข้อความเก่ายังเป็นชื่อเดิม (ยอมรับ; UI ลิงก์ไปที่ id จริง)
- − บน Hobby retry ที่ล้มหลัง `after()` จะรอจน cron วันถัดไป (ยอมรับสำหรับ v1.x)

## Test requirements
1. U5 (ก): ชวนตรง → ผู้ถูกชวนมี notification `group.invite.received` 1 แถว · ผู้ชวนไม่มี · ผู้รับ "รับ" → ผู้ชวนได้ `group.invite.accepted` · "ปฏิเสธ" → `group.invite.declined` (อย่างละ 1 แถว, params ไม่มีโค้ดเชิญ)
2. U10: สร้างนัด → สมาชิกทุกคนยกเว้นผู้สร้างได้ `appointment.created` คนละ 1 แถว · super admin ที่ไม่ใช่สมาชิกไม่ได้
3. U2: approve → `pin_reset.approved` · login ด้วย PIN เดิมระหว่าง pending → `pin_reset.cancelled_by_login`
4. Atomic: ทำให้การเขียน notification ล้ม (inject error) → เหตุการณ์หลัก (นัด/คำเชิญ) rollback ด้วย
5. i18n: แถวเดียวกันแสดงเป็นไทยเมื่อ `locale=th` และอังกฤษเมื่อ `en` · ทุก `NotificationKind` มีคีย์ใน `messages/th.json` และ `messages/en.json` (เทสต์วนจาก union)
6. ไม่มีความลับใน `params`/`payload`: ค้นหา PIN, token, โค้ดเชิญดิบ ในตาราง notification/outbox หลัง flow ทั้งหมด → ไม่เจอ
7. สิทธิ์: ผู้ใช้ A อ่าน/mark read notification ของ B ไม่ได้ (ADR 0003 `notification.*.own`)
8. (v1.x, R7) outbox: retry ตาม backoff, 429 → `dead`, unfollow → หยุดส่ง, dispatcher รันซ้ำไม่ส่งซ้ำ (idempotent ด้วย `status` + `id`)
