# ADR 0011 — เตือนก่อนนัดผ่าน LINE OA + กระดิ่ง: ผูกบัญชีด้วยโค้ด, กำหนดเวลา, ตัวตั้งเวลา

- **Status**: Proposed (Architect, 2026-11-09) · รอบ R10 · มี migration `0004` · **มีข้อที่รอ main ยืนยัน** ดู §9
- **เกี่ยวข้อง**: [R10_CONTRACT](../contracts/R10_CONTRACT.md) · [ADR 0007](0007-notifications.md) (เติม/เปลี่ยน ดู §8) · [ADR 0004](0004-time-and-timezone.md) · [ADR 0009](0009-going-counts-as-busy.md) §1 · [ADR 0001](0001-stack-and-project-structure.md) §3 · [RESEARCH §2](../research/RESEARCH_REPORT.md)
- **เจ้าของการ implement**: Platform (migration, service เตือน, `notify()`, `src/lib/integrations/**`, webhook, API, `/api/cron/reminders`, ฟังก์ชันเวลาใน `src/lib/calendar`) · OPS (`vercel.json`, env) · UX/Frontend (ถ้อยคำ, `/me`, กระดิ่ง) · ตรวจโดย QA + Security & Privacy

## Context
boss เลือกเตือนก่อนนัด 1 วันและ 1 ชม. ทาง LINE OA + กระดิ่ง (R10 §1) · OA แผนฟรี 300 ข้อความ/เดือน ส่งเกินไม่ได้ (contract) · ADR 0007 วางชั้นช่องทาง + outbox ไว้แล้ว แต่ไม่มีผู้ผลิตเหตุการณ์ตามเวลา และ Cron Jobs บน Hobby รันได้วันละครั้ง · ของเดิมที่ใช้ต่อ: `user.line_user_id` (unique), `notification_outbox`, `notify()`, `inTx`, กติกา RSVP ปัจจุบัน (ADR 0009 §1), Bearer `CRON_SECRET`

## Decision

### 1. ผูกบัญชีด้วยโค้ดผ่าน webhook (ไม่ใช้ LINE Login)
ขั้นตอนตาม R10 §2: `/me` สร้างโค้ด → ผู้ใช้ส่งในแชท OA → webhook ผูก `line_user_id` → reply ยืนยัน
- **ทำไมไม่ LINE Login**: push ส่งได้เฉพาะผู้ที่เป็นเพื่อนกับ OA อยู่แล้ว การส่งโค้ดในแชทจึงได้ทั้งการเป็นเพื่อนและ `userId` ในขั้นเดียว · ไม่ต้องมี LINE Login channel, OAuth callback/state และความลับชุดเพิ่ม · contract §5 ไม่ทำ · ถ้าเพิ่มภายหลังไม่ต้องย้ายข้อมูล เพราะ provider เดียวกันได้ `userId` เดียวกัน [L1]
- **โค้ด**: สุ่มจาก CSPRNG · prefix คงที่ + 8 ตัวจาก alphabet 31 ตัวของโค้ดเชิญ (≈ 39.6 บิต) · prefix ทำให้แยกจากข้อความทั่วไปและโค้ดเชิญ (ค่าจริง platform กับ ux กำหนด) · อายุ 10 นาที ใช้ครั้งเดียว · โค้ดใหม่ยกเลิกโค้ดเก่าของผู้ใช้นั้น
- **`line_link_code` เก็บแค่ hash** แบบเดียวกับ `group_invite.code_hash`: HMAC-SHA256 ด้วยคีย์ HKDF จาก `APP_SECRET` (info แยก เช่น `maewmeet/line-link-code/v1`) · ใช้โค้ด + ผูกบัญชีอยู่ใน transaction เดียว ด้วยคำสั่งมีเงื่อนไข (`ยังไม่ใช้ AND expires_at > now`) · ชน unique ของ `line_user_id` = ปฏิเสธ
- **webhook**: ตรวจ `x-line-signature` (HMAC-SHA256 + channel secret, base64, timing-safe) กับ raw body **ก่อน** parse JSON [L2] · ผิด/ไม่มี = 401 · `events` ว่าง = 200 [L3] · ประมวลผลเฉพาะ `message` ข้อความจาก `source.type = 'user'` ที่ตรงรูปแบบโค้ด และ `unfollow` · ไม่มี `userId` ใน event [L1] = ไม่ทำอะไร · ข้อความอื่นเงียบ
- **ส่งซ้ำจาก LINE**: โค้ดใช้ครั้งเดียวจึงไม่ผูกซ้ำ · reply token ใช้ได้ครั้งเดียว ภายใน 1 นาที [L3] → reply ทันทีหลัง commit · reply ล้มไม่ rollback การผูก (`/me` แสดงสถานะจริง)
- **Rate limit** ใช้ชั้นเดิม: สร้างโค้ดต่อ user · ลองโค้ดต่อ hash ของ LINE user id (ห้ามใช้/log ค่าดิบ)
- **`unfollow`** ล้าง `line_user_id` + ลบแถว outbox `pending` ของผู้ใช้นั้น · ยกเลิกจาก `/me` ล้างแบบเดียวกัน

### 2. เวลาถึงกำหนด ช่วงเงียบ และ `scheduled_at`
ฟังก์ชันบริสุทธิ์ใน `src/lib/calendar` (เช่น `reminders.ts`) รับ `now` เป็นพารามิเตอร์ ใช้ `tz` ของนัด (กฎ 9):

```ts
// pseudo-code
rawDue('1d') = startAt - 24h          // ช่วงเวลาจริง ไม่ใช่ addDaysAt
rawDue('1h') = startAt - 60min
due('1d' | 'nudge') = เลื่อนออกจากช่วงเงียบ(rawDue, tz)   // due('1h') = rawDue
  // { date, minute } = toLocal(rawDue, tz)
  // minute >= 1320 (22:00) → 08:00 ของ addDays(date, 1)
  // minute <  480  (08:00) → 08:00 ของ date
  // อื่น ๆ → rawDue · 08:00 คำนวณด้วย dayWindow(...)[0] (ห้าม parseLocalDateTime: มันปฏิเสธ DST gap)
shouldSend = due <= now && startAt - now >= minLead && scheduledAt <= due
  // minLead: 1d/nudge = 3 ชม. · 1h = 15 นาที · ขอบเท่ากันถือว่าส่ง/ไม่ข้าม
```

- **`appointment.scheduled_at`** = เวลาที่ตั้ง `startAt` ค่าปัจจุบัน · ตั้งตอนสร้าง · อัปเดตเมื่อ `startAt` เปลี่ยนเท่านั้น (แก้ชื่อ/สถานที่ไม่แตะ) · ทำให้ `scheduledAt > due` = ข้ามชนิดนั้น ไม่ส่งย้อนหลังตอนสร้างกระชั้นหรือเลื่อนเวลา
- **Migration**: SQLite เพิ่มคอลัมน์ `NOT NULL` ต้องมี default → `NOT NULL DEFAULT 0` แล้ว `UPDATE ... SET scheduled_at = created_at` · รุ่นเก่าที่ยังรันอยู่จึงเขียนแถวได้ (0 = ไม่ข้าม)
- **หานัด**: `status = 'active'`, กลุ่มไม่ถูกลบ, `now + 15 นาที <= start_at <= now + 24 ชม.` (ช่วงเงียบเลื่อน due ไปข้างหลังเท่านั้น ขอบบนจึงพอ) · ใช้ index `appointment_start_idx` แล้วคำนวณ `shouldSend` ในแอป

### 3. กันส่งซ้ำด้วย `appointment_reminder`
PK `(appointment_id, kind, start_at)` · `kind` = ชื่อเต็มใน `NotificationKind` · ทำ **1 transaction ต่อ 1 คู่ (นัด, ชนิด)**:
1. `INSERT` แบบมีเงื่อนไข: นัดยัง `active` และ `start_at` ตรงค่าที่อ่านมา · `ON CONFLICT DO NOTHING` · เขียนไม่ได้แถว = จบ
2. อ่านผู้รับภายใน transaction นั้น (§5)
3. `notify()` เขียนกระดิ่ง + outbox

ล้มกลางทาง = rollback แล้วรอบถัดไปทำใหม่ · รันซ้ำ/พร้อมกันมีผู้ชนะคนเดียว · `start_at` ใน PK ทำให้เลื่อนนัดแล้วเตือนใหม่ได้ · ไม่มีผู้รับก็เขียนแถว (ผู้รับตัดสิน ณ เวลาถึงกำหนดครั้งเดียว ตอบ "ไป" ทีหลังไม่ได้เตือนย้อนหลัง)

### 4. ตัวตั้งเวลา: Vercel Schedules (beta) + fallback
```json
"schedules": { "reminders": { "schedule": "*/15 * * * *", "path": "/api/cron/reminders", "requestMethod": "GET" } }
```
- ต้องตั้ง `requestMethod: "GET"` เพราะค่าปริยายของ path คือ `POST` [V1] · ลงทะเบียนใน `src/app/api/_lib/manifest.ts` ด้วย `auth: 'cron'` เหมือน `/api/cron/daily` · Vercel ส่ง `Authorization: Bearer <CRON_SECRET>` ให้ path target [V2]
- **Handler อิงสถานะ ไม่อิงรอบ**: ใช้ `now` ของ route ไม่ใช้เวลาที่ตารางระบุ · Vercel อาจส่งซ้ำ รันซ้อน ตามเก็บหลายรอบ และไม่ retry รอบที่ล้ม [V3] → §3 และ outbox รับมือได้โดยไม่ต้องเก็บ execution ID · รอบที่หายมาเก็บในรอบถัดไปภายใต้เงื่อนไข `minLead`
- **ความคลาดเคลื่อน**: Hobby มี jitter 15 นาทีเสมอ [V4] → รอบห่างกันได้ถึง ~30 นาที · เตือน 1 ชม. จึงถึงจริงช่วง T−60 ถึงราว T−30 · เตือน 1 วันที่เลื่อนจากช่วงเงียบถึงช่วง 08:00–08:30
- **ลำดับต่อรอบ**: สร้างเตือนที่ถึงกำหนด → ส่ง outbox · จำกัดจำนวนรายการที่ **ถึงกำหนดและยังไม่ส่ง** ต่อรอบ (อย่าจำกัดที่ผล query มิฉะนั้นแถวที่ทำแล้วจะบังแถวใหม่) · ค่าเพดานให้ platform กำหนด
- **โควตา**: 2,880–2,976 รอบ/เดือน (96 รอบ/วัน) จากเพดาน 5,000 รอบ/เดือนต่อ team · ทั้งรอบตามตารางและรอบกดมือนับรวม · เกินแล้วถูกข้ามจนรอบบิลถัดไป [V4]
- **Preview**: schedule แบบ static บน Preview เริ่มเป็น inactive จึงไม่กินรอบจนกว่าจะเปิดเอง [V3] · ops ต้องเปิดชั่วคราวเพื่อทดสอบ แล้วปิด
- **Fallback (เสนอ main ตาม R10 §1.5)**: cron-job.org เรียก endpoint เดิมทุก 15 นาทีด้วย header `Authorization` · ไม่แก้ endpoint · รองรับ custom header และทุกนาทีได้ แต่ timeout 30 วินาที [C1] → ต้องลดเพดานงานต่อรอบให้จบทัน · ต้องถอด schedule ของ Vercel ในการเปลี่ยนเดียวกัน
- `/api/cron/daily` คงเป็น `crons` เดิม (R10 ไม่ได้สั่งย้าย)

### 5. แยกช่องทางตามคำตอบ
| คำตอบ ณ เวลาถึงกำหนด | ชนิด | กระดิ่ง | LINE |
|---|---|---|---|
| `going` | `appointment.reminder_1d`, `appointment.reminder_1h` | ได้ | ได้ถ้าเชื่อมแล้ว |
| `maybe` หรือยังไม่ตอบ | `appointment.rsvp_nudge` (1 ครั้ง) | ได้ | **ไม่ได้ · ไม่กินโควตา** |
| `not_going` | — | ไม่ได้ | ไม่ได้ |

- **ผู้รับ** = สมาชิกปัจจุบัน · "ตอบแล้ว" ใช้กติกา ADR 0009 §1 (`rsvp.updated_at >= joined_at`) → ออกแล้วกลับเข้ากลุ่ม คำตอบเก่าถือว่า "ยังไม่ตอบ"
- เหตุการณ์นี้ระบบเป็นผู้ก่อ ผู้สร้างนัดจึงรับเหมือนสมาชิกทั่วไป
- **Outbox เฉพาะชนิดที่อนุญาต**: `LINE_KINDS = {reminder_1d, reminder_1h}` · ไม่ใช่ทุกชนิด
- **ตรวจก่อนส่งจริงทุกแถว** (ไม่ผ่าน = `dead` + `last_error` เป็นรหัสล้วน ไม่มีเนื้อหา): นัดยัง `active` · `startAt` ตรง `params.startAt` · ผู้รับยังตอบ `going` และเป็นสมาชิก · ยังเชื่อม LINE · `startAt - now >= minLead`
- **ส่ง**: Push ทีละคน · `X-Line-Retry-Key` = `outbox.id` (UUIDv4 ตรงรูปแบบ ใช้ได้ 24 ชม. [L4]; แถวเตือน 1 วันหมดสิทธิ์ส่งภายใน 21 ชม.)

| ผลจาก LINE | ทำอะไร |
|---|---|
| 2xx หรือ 409 (key นี้ถูกรับแล้ว [L4]) | `sent` |
| 5xx / timeout | retry ≤ 5 ครั้ง backoff ADR 0007 |
| 429 `You have reached your monthly limit.` [L3] | `dead` · หยุดเรียก LINE ในรอบนั้น · log จำนวน · กระดิ่งไม่กระทบ |
| 429 อื่น (rate limit) | retry แบบ 5xx |
| 4xx อื่น | `dead` |

- ไม่มี env LINE = `isEnabledFor` เป็นเท็จ ไม่เขียน outbox และไม่ส่ง (ไม่สะสมแถวเก่าไว้ส่งทีหลัง) · แถวกระดิ่งและ `appointment_reminder` ทำงานตามปกติ

### 6. ข้อมูลที่ออกไป LINE และความเป็นส่วนตัว
- **ส่ง**: ชื่อนัด วันเวลา ชื่อกลุ่ม ลิงก์นัด (`?openExternalBrowser=1` [L5]) · **ไม่ส่ง**: สถานที่ รายละเอียด ชื่อสมาชิก รายชื่อผู้ตอบ · แปลตาม `user.locale` ตอนส่ง
- ลิงก์เปิดข้อมูลไม่ได้ด้วยตัวเอง: `/appointments/<id>` ตรวจ session + สมาชิกที่เซิร์ฟเวอร์ (กฎ 6)
- ชื่อนัด/ชื่อกลุ่มเป็นข้อความอิสระ อาจมีข้อมูลส่วนตัว และออกจากระบบเราไปอยู่ที่ LINE · ส่งแล้วลบ/แก้ไม่ได้ · ยกเลิกนัดแล้วข้อความเดิมยังอยู่ในแชท → `/privacy` ต้องบอกครบ TH/EN (R10-9)
- เก็บฝั่งเรา: `line_user_id` (ล้างเมื่อยกเลิก/unfollow/ลบบัญชี) · hash ของโค้ด · `params` ใน outbox (ค่าดิบตาม ADR 0007)
- ห้าม log โค้ด/token/LINE user id/เนื้อหาข้อความ (กฎ 7) · `FORBIDDEN_PARAM_KEY` ของ `notify()` ใช้ต่อ · token และ channel secret อยู่ใน env เท่านั้น

### 7. โครง migration `0004` (รายละเอียดเป็นของ platform)
`appointment_reminder(appointment_id FK cascade, kind, start_at, created_at)` · `line_link_code(code_hash unique, user_id FK cascade, expires_at, used_at, created_at)` · `appointment.scheduled_at` ตาม §2 · ไม่แตะคอลัมน์เดิม

### 8. ส่วนที่เติม/เปลี่ยนจาก ADR 0007
| ADR 0007 | R10 | ชนิด |
|---|---|---|
| §1 union | +3 ชนิด params `{groupId, groupName, appointmentId, title, startAt, tz}` | เติม |
| §1 ผู้ก่อเหตุไม่ได้รับแจ้ง | ไม่ใช้กับเหตุการณ์ของระบบ (§5) | เติม |
| §2 `isEnabledFor`: `line_user_id` + opt-in + ยังเป็นเพื่อน | `line_user_id != null` + มี env · การผูกคือ opt-in · unfollow ล้างการผูก จึงไม่มีคอลัมน์ opt-in | เปลี่ยน |
| §2 ทุกชนิดเข้าช่องทางที่เปิด (Consequences) | LINE เฉพาะ `LINE_KINDS` · ข้อความ LINE ของ `pin_reset.approved` (§3) ยังไม่ทำ | เปลี่ยน |
| §2 dispatcher `after()` + cron รายวันเก็บตก | outbox มาจาก cron เท่านั้นในรอบนี้ → ส่งใน `/api/cron/reminders` ไม่ใช้ `after()` · Consequences "retry รอวันถัดไป" ไม่เป็นจริงแล้ว | เปลี่ยน |
| §2 retry 5 ครั้ง `2^attempts` นาที | คงเดิม แต่หยาบเท่ารอบ 15 นาที · เพิ่มการตรวจก่อนส่ง + retry key + ตาราง §5 | เติม |
| §2 429 → `dead` + super admin เห็นสถานะ | `dead` คงเดิม · ไม่มีหน้า admin (contract §5) ใช้ log จำนวนแทน | เปลี่ยน |
| Test 8 | ใช้ต่อ + เทสต์ด้านล่าง | เติม |

ADR 0001 "Hobby cron วันละครั้ง" ยังจริงกับ Cron Jobs · Schedules เป็นบริการแยก [V1]

### 9. รอ main ยืนยัน (ADR เขียนตามทางที่ระบุไว้ก่อน)
1. **ช่วงเงียบกับ "กระชั้น < 1 วัน"**: นัดพุธ 23:00 สร้างอังคาร 23:30 → `due` = พุธ 08:00 · สูตร `scheduled_at > due` เป็นเท็จ จึง **ส่ง** แต่บรรทัด "สร้างกระชั้น < 1 วัน = ข้าม 1d" บอกว่าข้าม · **ADR ใช้สูตร** (ผู้รับยังได้เตือนล่วงหน้า 15 ชม.)
2. **ลำดับ migration**: R10 §8 และ OPERATIONS J1.1 เขียนว่ารันหลัง merge แต่ OPERATIONS ส่วน B กำหนด "prod ก่อน merge" (merge แล้ว deploy ทันที) · โค้ดใหม่เขียน `scheduled_at` → ถ้ารันหลัง merge การสร้างนัดจะล้มจนกว่าจะ migrate · **เสนอยึดส่วน B**
3. **`LINE_KINDS`**: contract §1.4 ไม่ได้ระบุว่าจำกัดเฉพาะการเตือน · ADR ตีความจากหัวข้อและ §7 ที่นับโควตาเฉพาะการเตือน
4. **`minLead` ตอนส่งจริง**: ขยายความ "ไม่ส่งย้อนหลังเกินเงื่อนไข" มาใช้กับแถวค้างใน outbox ด้วย
5. **โค้ดรูปแบบถูกแต่ใช้ไม่ได้**: contract ไม่ระบุการตอบ · เสนอ reply ข้อความเดียวกันทุกกรณี (ไม่บอกว่าผิด/หมดอายุ/ใช้แล้ว) ไม่กินโควตา [L6]
6. **อายุแถว outbox**: `sent`/`dead` เก็บชื่อนัดและชื่อกลุ่มไม่มีกำหนด ADR 0007 ไม่ได้ระบุ · เสนอให้ cron รายวันลบแถวจบแล้วที่เกิน 90 วันเท่ากับ notification · อยู่นอก contract ต้องให้ main ตัดสิน

## Alternatives considered
| ทางเลือก | ทำไมไม่เลือก |
|---|---|
| LINE Login + `bot_prompt` | แตะน้อยกว่าสำหรับผู้ใช้ แต่ต้องเพิ่ม channel, OAuth และความลับ · contract §5 ไม่ทำ |
| เก็บรายการเตือนต่อคนล่วงหน้า | ต้องตามแก้ทุกครั้งที่ RSVP/เวลา/สมาชิกเปลี่ยน · คำนวณ ณ เวลาถึงกำหนดตรงกับ R10 §1.1 |
| Dynamic one-time schedule ต่อนัด [V1] | ต้องใช้ queue target, เพดาน 500 ครั้ง/รอบบิล และต้องตามลบเมื่อเลื่อน/ยกเลิก |
| Queue target เพื่อให้ retry [V3] | เพิ่มบริการ · รอบถัดไปเก็บตกอยู่แล้ว |
| Multicast รวมผู้รับ | ภาษาต่อคนต่างกัน และ retry key ทั้งก้อน ติดตามผลรายคนไม่ได้ · โควตานับต่อผู้รับเท่ากัน [L6] |
| ใช้ `execution ID` กันซ้ำ | ป้องกันแค่การส่งซ้ำของรอบเดียว ไม่กันรอบซ้อนหรือ fallback |

## Consequences
- + ระบบอิงสถานะ: รอบซ้ำ/ซ้อน/หาย ไม่ทำให้ส่งซ้ำ และกลับมาทำต่อเองได้
- + เปลี่ยนตัวตั้งเวลาได้โดยไม่แก้ endpoint
- − เตือน 1 ชม. คลาดได้ราว 30 นาทีบน Hobby
- − Schedules เป็น beta เงื่อนไขอาจเปลี่ยน [V4]
- − ผู้ใช้ต้องคัดลอกโค้ดเองหนึ่งครั้ง
- − หลัง deploy ครั้งแรก นัดที่อยู่ในช่วงเตือนอยู่แล้วจะได้เตือนในรอบแรก เพราะ backfill = `created_at` (ตรงตาม contract)
- − ถึงเพดานโควตา LINE แล้วผู้ใช้ไม่รู้ตัวในรอบนี้ มีแค่ log (contract §5)

## Test requirements
1. เวลา (`tests/calendar`): ขอบ 21:59/22:00/07:59/08:00 · ข้ามเที่ยงคืน/เดือน/ปี · 3 ชม. และ 15 นาทีพอดีกับขาด 1 ms · `scheduledAt == due` กับ `due + 1` · tz อื่น + DST gap ที่ 08:00
2. ผู้รับตาม §5 รวมออกแล้วกลับเข้ากลุ่ม · `rsvp_nudge` ไม่เข้า outbox
3. รันซ้ำ/พร้อมกันได้ผลเดิม · เลื่อนนัดแล้วเตือนใหม่ แถวเก่าใน outbox ไม่ส่ง · แก้ชื่อนัดไม่เปลี่ยน `scheduled_at`
4. outbox ตามตาราง §5 ทุกแถว (LINE จำลอง) · retry key เดิมทุกครั้ง · ไม่มี env ไม่เขียน outbox
5. webhook: ลายเซ็นผิด/ไม่มี = 401 ก่อน parse · `events` ว่าง = 200 · โค้ดหมดอายุ/ใช้ซ้ำ/ชน unique · unfollow ล้างการผูกและคิว · ข้อความอื่นไม่ตอบ
6. ไม่มีโค้ด/token/LINE id ใน log, `params`, `last_error`

## แหล่งอ้างอิง (เข้าถึง 2026-11-09)
**ยืนยันจากเอกสารทางการ**
- [L1] LINE getting user IDs (provider เดียวกัน = `userId` เดียวกัน, อาจไม่มี `userId` ถ้าไม่ยินยอม): https://developers.line.biz/en/docs/messaging-api/getting-user-ids/
- [L2] LINE verify signature: https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- [L3] LINE Messaging API reference (`events` ว่าง, reply token, ข้อความ 429): https://developers.line.biz/en/reference/messaging-api/nojs/
- [L4] LINE retry key: https://developers.line.biz/en/docs/messaging-api/retrying-api-request/
- [L5] LINE URL scheme (`openExternalBrowser`): https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/
- [L6] LINE pricing (push นับ, reply ไม่นับ): https://developers.line.biz/en/docs/messaging-api/pricing/
- [V1] Vercel Schedules + เทียบกับ Cron Jobs: https://vercel.com/docs/schedules · https://vercel.com/docs/schedules/migrate-from-cron-jobs
- [V2] Vercel handling runs: https://vercel.com/docs/schedules/handle-runs
- [V3] Vercel concepts: https://vercel.com/docs/schedules/concepts
- [V4] Vercel limits: https://vercel.com/docs/schedules/limits
- [C1] cron-job.org FAQ: https://cron-job.org/en/faq/

**ยังไม่ยืนยัน (ops ตรวจบน preview ตาม R10 §1.5)**
- การใช้ `crons` กับ `schedules` พร้อมกันใน `vercel.json` คนละ path — เอกสารเตือนเฉพาะกรณี route เดียวกันซ้ำ ไม่ได้ยืนยันโดยตรง
- `CRON_SECRET` ถูกส่งจริงบน preview ของโปรเจกต์นี้ (เอกสารยืนยันเชิงกลไกเท่านั้น)
- โควตาฟรี 300 ข้อความ/เดือน: มาจาก contract (boss ตั้งใน OA) · หน้า pricing ไม่มีตัวเลขของไทย
- ระยะเวลาสูงสุดของ function ที่ใช้กับเพดานงานต่อรอบ: ไม่ได้ค้นในรอบนี้ platform ต้องตรวจก่อนตั้งค่า
