# ADR 0016 — แชร์นัดให้คนนอกกลุ่ม: ลิงก์ชวนต่อสมาชิก + "แขกของนัด"

- **Status**: Accepted (2026-11-20) · boss ตัดสินใน [R18_CONTRACT](../contracts/R18_CONTRACT.md) §S และ §9 "คำตัดสินที่บันทึกแล้ว" (2026-11-20): สมาชิกทุกคนชวนคนนอกได้ · ลิงก์ของใครของมัน มีป้าย "มากับ X" · เพดาน 10 แขก/นัด · แขกเห็นแค่จำนวนคนไป ไม่เห็นชื่อสมาชิก · มี migration · บันทึกโดย Architect 2026-11-20 จากการอ่านโค้ดที่ `66d7e82` (branch `feat/r18-v1`) **ก่อน** platform เริ่ม §S · รวมข้อมูลจาก ux (`docs/design/R18_SHARE_FLOW.md` commit `32c422a`: path `/i/<token>`, ชื่อชนิดแจ้งเตือน) และคำตัดสินของ main 2026-11-20 (แขกที่ถูกนำออกกลับเข้านัดนั้นไม่ได้ · ลิงก์ถูกยกเลิกกับไม่พบตอบ 404 เหมือนกัน) · ข้อที่ไม่อยู่ในคำตัดสินของ boss และ Architect ตัดสินเอง ติดป้าย **[A]** — boss/main เปลี่ยนได้โดยไม่กระทบโครงข้อมูล
- **เกี่ยวข้อง**: [ADR 0003](0003-rbac.md) (action ใหม่) · [ADR 0004](0004-time-and-timezone.md) (เวลา) · [ADR 0006](0006-busy-visibility.md) · [ADR 0007](0007-notifications.md) (ผู้รับ/ชนิดใหม่) · [ADR 0009](0009-going-counts-as-busy.md) §1 (going = ไม่ว่าง) · [ADR 0011](0011-line-reminders.md) (เตือนก่อนนัด/LINE) · [ADR 0015](0015-data-retention-group-restore-purge.md) (กู้/ลบถาวร) · `docs/design/ARCHITECTURE.md` ข้อ 3, 5, 8 (อัปเดตใน R18 §6 ไม่ใช่ตอนนี้)
- **เจ้าของการ implement**: Platform (S1–S8: schema/migration `0007`, repos, services, serializers, routes, cron, purge) · Auth (RBAC ใน `src/lib/rbac/*` + ค่า rate limit + `safeNext`) · Frontend (หน้า `/i/[token]`, หน้านัดฝั่งแขก/สมาชิก) · UX (ถ้อยคำ TH/EN, flow) · Ops (rollback ใน OPERATIONS, header `/i/*` ใน `next.config.ts` ถ้า main มอบ) · ตรวจโดย Security (บังคับ — แตะ auth/rbac/api/schema/ข้อมูลคน) + QA

## Context
- วันนี้นัด (`appointment`) เห็นได้เฉพาะสมาชิกกลุ่ม: ทุกเส้นทางผ่าน `loadAppointmentCtx` → `can()` ที่ด่านกลุ่ม `inGroup` (คนนอก = `NOT_FOUND`) · RSVP/นับคน/เตือน/กระดิ่ง/going-as-busy ทั้งหมด join `group_member` ด้วยกติกา `rsvp.updated_at >= joined_at` (ADR 0009 §1, `repos/appointment.ts` `listCurrentRsvps`, `repos/reminder.ts` `listReminderAudience`, `repos/notification.ts` `visibleToOwner`)
- ผู้ใช้ขอชวนเพื่อนนอกกลุ่มมานัดครั้งเดียวโดยไม่ต้องเข้ากลุ่ม (เห็นปฏิทิน/busy/สมาชิก) — boss อนุมัติเป็น §S
- แนวที่มีอยู่ให้ยืม: โค้ดเชิญ (`src/lib/data/invite-code.ts` HMAC-SHA256 ด้วย subkey HKDF ของ `APP_SECRET`, เก็บแค่ hash) · การเขียนแบบ "คำสั่ง SQL เดียวมีเงื่อนไขในตัว" (`insertAppointmentIfUnderCap`, `joinGroupWithCode`) · rate limit แบบจองถัง (`reserveBucket`/`refundBucket`, `rateKey`, `ipRateSpec`) · ไม่มี `proxy.ts`/`middleware.ts` (ADR 0001 §1, ADR 0009) · locale มาจากคุกกี้ ไม่มี locale ใน URL (ADR 0008 §1, `src/i18n/request.ts`)
- รอบนี้มี migration ได้ **1 ชุด แบบเพิ่มอย่างเดียว** (R18 §0) — ไม่แตะตาราง/ข้อมูลเดิม

## Decision

### 1. หลักการ
1. แขก = **"แขกของนัดนั้น"** หนึ่งแถวต่อ (นัด, ผู้ใช้) ไม่มีแถว `group_member` ไม่ผ่าน `inGroup` ไม่มี role · ทุกเส้นทางเดิมของสมาชิก **ไม่เปลี่ยนพฤติกรรม** (แขกยังได้ `NOT_FOUND` จาก `GET /api/appointments/:id`, กลุ่ม, ปฏิทินกลุ่ม, วันว่าง, รายการนัดของกลุ่ม)
2. ทางของแขกเป็น action/route/DTO **แยก** (ไม่ขยาย `appointment.view`/`appointment.rsvp` เดิม) — manifest ผูก 1 action ต่อ route ได้ตรงตัว และเทสต์ role×action เดิมไม่ต้องแก้
3. คำตอบ RSVP ของแขกเก็บ **ในแถวแขก** (ไม่ใช่ `appointment_rsvp`) — คิวรีของสมาชิกที่ join `group_member` ไม่มีทางนับ/แสดงแขกโดยบังเอิญ และลบแขก = ลบคำตอบในแถวเดียว
4. "หมดอายุ" ของลิงก์ **คำนวณสดทุกครั้ง ไม่เก็บค่า** (ข้อ 2.3) — เหตุผลเดียวกับโค้ดเชิญที่ตรวจแบบ lazy · เก็บเฉพาะเหตุการณ์ที่เป็นการกระทำ (`revoked_at`)
5. สิทธิ์ทุกข้อตัดสินที่เซิร์ฟเวอร์ (กฎ 6) · การเขียนที่แข่งกันได้ = คำสั่งเดียวมีเงื่อนไขในตัว (ไม่มี check-then-act)

### 2. Data model — migration `0007_r18_appointment_share.sql` (เพิ่มอย่างเดียว)
ชื่อไฟล์ตามแบบเดิม (`000N_rNN_<topic>.sql`) · สร้างด้วย drizzle-kit จาก `src/db/schema.ts` · **platform ต้องอ่าน SQL ที่สร้างแล้วยืนยันว่ามี `ON DELETE` ครบทุก FK** (ADR 0012/`schema.ts` บันทึกว่า drizzle-kit 0.31.11 ทำ `ON DELETE` หายในกรณี `ALTER TABLE ADD ... REFERENCES` — ที่นี่เป็น `CREATE TABLE` ใหม่ซึ่งรูปแบบ 0005 ยืนยันว่าออกมาถูก แต่ต้องตรวจซ้ำ)

#### 2.1 `appointment_share_link`
| คอลัมน์ | ชนิด | กติกา |
|---|---|---|
| `id` | text PK | UUIDv4 (`newId()`) |
| `appointment_id` | text NOT NULL | FK → `appointment.id` **ON DELETE CASCADE** |
| `created_by` | text NOT NULL | FK → `user.id` (no action — แถว user ไม่ถูกลบจริง, ลบบัญชี = anonymize เหมือน `appointment.created_by`) |
| `token_hash` | text NOT NULL | hex 64 ตัว (ข้อ 3) — ไม่เก็บ token ดิบ |
| `created_at` | integer NOT NULL | epoch ms UTC จาก `clock.now()` |
| `revoked_at` | integer NULL | เวลาที่ถูกยกเลิก (มือ / ผู้สร้างออก-ถูกลบ / ลบบัญชี) |
| `revoked_by` | text NULL | FK → `user.id` **ON DELETE SET NULL** |

- `uniqueIndex('share_link_token_hash_uq').on(token_hash)`
- `uniqueIndex('share_link_one_active_uq').on(appointment_id, created_by).where(revoked_at IS NULL)` — "1 ลิงก์ที่ยังไม่ถูกยกเลิกต่อคนต่อนัด" (S1)
- `index('share_link_appointment_idx').on(appointment_id)` — รายการลิงก์ของนัด, ลบตามกลุ่ม/D1
- `index('share_link_creator_idx').on(created_by, revoked_at)` — ยกเลิกตอนออกกลุ่ม/ลบบัญชี
- `check('share_link_revoked_ck', revoked_at IS NOT NULL OR revoked_by IS NULL)`
- **ไม่มี** `expires_at`/`status` — ดูข้อ 2.3 · ไม่มี `group_id` (ได้จาก `appointment.group_id` — นัดย้ายกลุ่มไม่ได้)

#### 2.2 `appointment_guest`
| คอลัมน์ | ชนิด | กติกา |
|---|---|---|
| `appointment_id` | text NOT NULL | FK → `appointment.id` **ON DELETE CASCADE** |
| `user_id` | text NOT NULL | FK → `user.id` **ON DELETE CASCADE** |
| `invited_by` | text NULL | FK → `user.id` **ON DELETE SET NULL** · คัดลอกจาก `link.created_by` ตอนเข้า — ป้าย "มากับ X" อยู่รอดแม้ลิงก์ถูกลบตาม D1 |
| `link_id` | text NULL | FK → `appointment_share_link.id` **ON DELETE SET NULL** · ไว้ตรวจย้อน/นับ "เข้าทางลิงก์นี้กี่คน" |
| `response` | text NULL | `going` / `maybe` / `not_going` · NULL = ยังไม่ตอบ |
| `responded_at` | integer NULL | เวลาตอบล่าสุด |
| `joined_at` | integer NOT NULL | เวลาเข้าเป็นแขก (ใช้กรองแจ้งเตือนเก่า — ข้อ 7.2) |
| `removed_at` | integer NULL | **ถูกนำออกโดยสมาชิก** (ข้อ 7.1) · ไม่ NULL = แถวเป็น "ตัวกันกลับเข้า" ของนัดนี้ ไม่ใช่แขกแล้ว |
| `removed_by` | text NULL | FK → `user.id` **ON DELETE SET NULL** · ผู้นำออก (ไม่แสดงต่อแขก) |

- `primaryKey(appointment_id, user_id)` — เข้าซ้ำไม่สร้างแถวซ้ำ · และทำให้แถวที่ถูกนำออกกันการเข้าใหม่ได้ทุกลิงก์ของนัดนั้นโดยไม่ต้องมีตารางที่สาม
- `index('appointment_guest_user_idx').on(user_id)` — นัดของฉัน/เตือน/กระดิ่ง/ลบบัญชี
- `index('appointment_guest_link_idx').on(link_id).where(link_id IS NOT NULL)` — ตั้ง NULL ก่อนลบลิงก์
- `check('appointment_guest_response_ck', response IS NULL OR response IN ('going','maybe','not_going'))`
- `check('appointment_guest_responded_ck', (response IS NULL) = (responded_at IS NULL))`
- `check('appointment_guest_removed_ck', removed_at IS NOT NULL OR removed_by IS NULL)`
- **แขกที่มีผล (active guest)** = แถวที่ `removed_at IS NULL` — **ทุกคิวรีฝั่งแขก** (สิทธิ์, นับเพดาน, นับ going/maybe, รายการของฉัน, going-as-busy, myConflicts, เตือน, แจ้งเตือน, `visibleToOwner`, รายชื่อแขกในหน้าสมาชิก) ต้องมีเงื่อนไขนี้ · ตอนนำออกตั้ง `removed_at/removed_by` และล้าง `response = NULL, responded_at = NULL` ในคำสั่งเดียว

#### 2.3 ลิงก์ "ใช้ได้" (คำนวณ ไม่เก็บ)
ลิงก์ L ของนัด A ในกลุ่ม G ใช้ได้ ณ `now` ⇔ ทั้งหมดจริง:
`L.revoked_at IS NULL` · `A.status = 'active'` · `A.end_at > now` · `G.deleted_at IS NULL` · ผู้สร้างลิงก์ยังเป็นสมาชิกของ G **และ** `group_member.joined_at <= L.created_at` (ลิงก์ของสมาชิกภาพรอบก่อนไม่ฟื้นแม้กลับเข้ากลุ่ม) · บัญชีผู้สร้าง `status = 'active'`
- เหตุผลที่ไม่เก็บ expiry: ทุกเงื่อนไขมีแหล่งความจริงอยู่แล้ว (`end_at` แก้ได้ภายหลัง, ยกเลิก, ลบ/กู้กลุ่ม) — เก็บซ้ำ = ต้องตามแก้ทุกจุดและเสี่ยงไม่ตรงกัน · กู้กลุ่ม (R17) แล้วลิงก์ที่ยังไม่ถึง `end_at` กลับมาใช้ได้เอง (สอดคล้อง D2 ของโค้ดเชิญ — ops บันทึกใน OPERATIONS §K)
- เงื่อนไขชุดนี้เขียน **ที่เดียว** เป็น SQL fragment ใน repo ใหม่ `src/lib/data/repos/share-link.ts` แล้วใช้ทั้ง preview, join, รายการลิงก์

#### 2.4 แขก "ใช้สิทธิ์ได้"
แถวแขก (A, U) มีผล ⇔ `removed_at IS NULL` **และ** `G.deleted_at IS NULL` ของกลุ่มของนัด (ไม่สนใจ `A.status`/`end_at` — แขกยังเปิดดูนัดที่ยกเลิก/ผ่านไปแล้วได้แบบอ่านอย่างเดียวเหมือนสมาชิก) · ผู้ใช้ที่เป็นสมาชิกของ G ต้อง **ไม่มี** แถวแขก **ที่มีผล** ของนัดใน G (ข้อ 8.4 รักษาไว้ · แถวที่ถูกนำออกคงอยู่ได้ — ไม่มีผลระหว่างเป็นสมาชิก) — rule ฝั่ง RBAC ปฏิเสธซ้ำอีกชั้น (ข้อ 5.2)

### 3. Token และ URL
- **ได้มาจาก id ของลิงก์ (deterministic) ไม่ใช่สุ่มแล้วเก็บ** — เพราะ S1 ต้อง "กดซ้ำได้ลิงก์เดิม" แต่เราเก็บแค่ hash จึงต้องสร้าง token เดิมซ้ำได้โดยไม่เก็บ token ดิบ:
  - `token = base64url( HMAC-SHA256( K_tok, "share-link:" + link.id ) [0..16) )` → **22 ตัวอักษร `[A-Za-z0-9_-]`, 128 บิต** · `K_tok = HKDF-SHA256(APP_SECRET, salt ว่าง, info 'maewmeet/appointment-share-token/v1', 32)`
  - `token_hash = hex( HMAC-SHA256( K_hash, token ) )` · `K_hash = HKDF(APP_SECRET, info 'maewmeet/appointment-share-hash/v1')` — แบบเดียวกับ `hashInviteCode` (cache subkey ต่อค่า secret แบบ `subkeys` Map)
  - ผู้ที่ได้ dump ฐานอย่างเดียว (ไม่มี `APP_SECRET`) สร้าง token จาก id หรือย้อนจาก hash ไม่ได้ · 128 บิตเดาออนไลน์ไม่ได้ (rate limit ข้อ 6 เป็นชั้นเสริม)
  - ราคา: เปลี่ยน `APP_SECRET` = ลิงก์ทั้งหมดใช้ไม่ได้ (เหมือนโค้ดเชิญ) — สมาชิกกดชวนใหม่ได้ลิงก์ใหม่ · ops เติมใน OPERATIONS
  - ไฟล์: `src/lib/data/share-token.ts` (platform) คู่กับ `invite-code.ts` — `shareTokenFor(linkId, secret)`, `hashShareToken(token, secret)`, `parseShareToken(raw)` (ตรงรูป `^[A-Za-z0-9_-]{22}$` ไม่งั้น `null` ก่อนแตะฐาน)
- **URL หน้าเปิดลิงก์: `/i/<token>`** (ใช้ตาม ux `docs/design/R18_SHARE_FLOW.md` commit `32c422a` — ตรวจแล้วไม่ชน routing: ไม่มี `src/app/i`, ไม่มี route `/i/*` ใน `(app)`/`(public)`/`api` และไม่มี proxy/middleware · ข้อเดียวที่ต้องระวัง: อย่าสร้าง route ใน route group อื่นที่ resolve เป็น `/i/...` ซ้ำ) → ไฟล์ `src/app/i/[token]/page.tsx` (ระดับเดียวกับ `src/app/privacy` — นอก `(app)` ที่บังคับล็อกอิน และนอก `(public)` ที่ไล่คนล็อกอินแล้ว) · ไม่มี locale prefix (ADR 0008) และไม่มี proxy/middleware ให้ต้องยกเว้น · ลิงก์เต็ม = `configuredAppOrigin(getEnv()) + '/i/' + token` (ตัวเดียวกับ .ics)
- **ไม่ index / ไม่รั่ว**: `generateMetadata` คืน `robots: { index: false, follow: false, nocache: true }` + `referrer: 'no-referrer'` · **และ** header `X-Robots-Tag: noindex, nofollow` สำหรับ `source: '/i/:path*'` ใน `next.config.ts` `headers()` (metadata ของ Next 16 อาจถูก stream ไปท้าย `<body>` สำหรับ bot ที่ไม่ใช่ HTML-limited — header จึงเป็นด่านที่แน่นอน) · Referrer-Policy ทั้งเว็บเป็น `strict-origin-when-cross-origin` อยู่แล้ว (ลิงก์ออกนอก เช่น ปุ่มแผนที่ ส่งแค่ origin) · OG/title ของหน้า **ทั่วไป** (ชื่อแอป + "มีคนชวนคุณไปนัด") ไม่มีชื่อนัด — LINE ดึงตัวอย่างลิงก์ไปเก็บที่เซิร์ฟเวอร์ของ LINE **[A]**
- **GET ไม่มีผลข้างเคียง**: เปิด/ตัวดึงตัวอย่างของ LINE เปิด `/i/<token>` ได้ไม่จำกัดโดยไม่สร้างแถวใด ๆ (นอกจากถัง rate limit) · การเข้าเป็นแขกต้องกดปุ่ม → `POST`
- **ห้าม log token**: ไม่ใส่ใน `console.*`, audit, notification params (ชั้น `FORBIDDEN_PARAM_KEY` จับคีย์ `token`/`hash` อยู่แล้ว), error message · ข้อจำกัดที่รับได้: access log ของ Vercel บันทึก path `/i/<token>` (เหมือนลิงก์แชร์ทั่วไป) — บันทึกใน OPERATIONS
- **กลับมาหลัง login/สมัคร (S3)**: หน้า `/i/<token>` ส่งคนที่ยังไม่ล็อกอินไป `/login?next=/i/<token>` (และลิงก์ "สมัคร" ส่ง `next` ต่อ) · ฟังก์ชันกลาง `safeNext(raw): string` ใน `src/lib/shared/safe-next.ts` (auth เจ้าของ) **allowlist แบบตรงรูปเท่านั้น**: ยอมรับเฉพาะ `^/i/[A-Za-z0-9_-]{22}$` อย่างอื่นทั้งหมด (รวม `//x`, `/\x`, `https:`, `%2F`, ช่องว่าง, path อื่นในแอป) → `'/'` · `LoginForm`/`SignupForm` ใช้ `safeNext` แทน `'/'` ตายตัวเดิม · `mustChangePin` → `/set-pin` ตามเดิม (ไม่พา `next` ต่อ — กรณีหายาก ผู้ใช้กดลิงก์ใหม่ได้) · ไม่ทำ auto-join หลัง login: กลับมาที่การ์ดแล้วกด "เพิ่มนัดนี้" เอง (ยินยอมชัด)

### 4. API / หน้า
| method · path | action (manifest) | หมายเหตุ |
|---|---|---|
| (หน้า) `GET /i/[token]` | `appointment.share.preview` | server component เรียก service ตรง · ไม่มี API route |
| `POST /api/appointments/:id/share-link` | `appointment.share.create` | get-or-create · คืน `{ url, linkId, createdAt, reused }` |
| `DELETE /api/appointments/:id/share-links/:lid` | `appointment.share.revoke` | `:lid` ต้องเป็นของนัด `:id` ไม่งั้น `NOT_FOUND` (กัน IDOR) |
| `POST /api/share/join` body `{ token }` | `appointment.guest.join` | token อยู่ใน body (ไม่อยู่ใน path ของ API) · zod `.strict()` |
| `GET /api/appointments/:id/guest` | `appointment.guest.view` | DTO แขก (ข้อ 5.4) |
| `PUT /api/appointments/:id/guest/rsvp` | `appointment.guest.rsvp` | `{ response }` แบบ `rsvpInputSchema` เดิม |
| `GET /api/appointments/:id/guest/calendar.ics` | `appointment.guest.view` | builder เดิม `buildAppointmentIcs` ข้อมูลชุดเดียวกับ .ics สมาชิก |
| `DELETE /api/appointments/:id/guest` | `appointment.guest.leave` | แขกออกเอง |
| `DELETE /api/appointments/:id/guests/:uid` | `appointment.guest.remove` | สมาชิกลบแขก (UI ยืนยัน 1 ขั้น) |
- หน้า `/appointments/[id]` (ใน `(app)`): โหลดบริบทครั้งเดียว ถ้าผู้ดูเป็นแขก → เรนเดอร์มุมมองแขกจาก service แขก · ไม่ใช่ทั้งสมาชิกและแขก → `notFound()` เหมือนเดิม (ลิงก์ในกระดิ่งของแขกชี้ path เดิมได้)
- หน้า `/i/[token]`: ล็อกอินแล้วและเป็นสมาชิก/แขกของนัดอยู่แล้ว → `redirect('/appointments/<id>')` · ล็อกอินแล้วแต่ยังไม่ใช่ → การ์ด + ปุ่ม "เพิ่มนัดนี้" · ยังไม่ล็อกอิน → การ์ด + ปุ่ม login/สมัคร (มี `next`)

### 5. RBAC (ADR 0003 — auth เจ้าของ `src/lib/rbac/*`)

#### 5.1 resource ชนิดใหม่ (`types.ts` + `RESOURCE_TYPES` + `ACTION_RESOURCE`)
- `ShareLinkResource = { type: 'shareLink'; group: GroupCtx; appointmentCreatedBy: string; linkCreatedBy: string }`
- `AppointmentGuestResource = { type: 'appointmentGuest'; group: GroupCtx; isGuest: boolean }` — สถานะของ **ผู้กระทำเอง** ต่อนัดนี้ · `isGuest` = มีแถวที่ `removed_at IS NULL` (แถวที่ถูกนำออก = false)
- `GuestTargetResource = { type: 'guestTarget'; group: GroupCtx; appointmentCreatedBy: string; invitedBy: string | null; guestUserId: string }`
- `policy-context.ts`: `loadAppointmentCtx` เติม `isGuest` (LEFT JOIN `appointment_guest` ของ actor ใน query เดิม — +0 query) · `loadShareLinkCtx(db, actor, appointmentId, linkId)` / `loadGuestTargetCtx(db, actor, appointmentId, guestUserId)` — แถวที่ไม่ตรงนัด = ไม่มี → `goneGroupCtx` (NOT_FOUND ทุกไบต์เหมือนคนนอก)

#### 5.2 action ใหม่และใครทำได้
| action | resource | กฎ (หลังด่านบัญชี ข้อ 1–4 ของ `can()` ตามเดิม) |
|---|---|---|
| `appointment.share.preview` | `none` | **PUBLIC** (เพิ่มใน `PUBLIC_ACTIONS`) · `anyUser` · ข้อมูลที่ได้ถูกจำกัดที่ DTO (ข้อ 5.4) · ไม่เข้า `PIN_CHANGE_ALLOWED` (ผู้ที่ติดเปลี่ยน PIN ถูก `requireUser`/หน้าพาไป `/set-pin` อยู่แล้ว — preview ไม่ใช่ทางเลี่ยงเพราะคืนข้อมูลเท่ากับคนไม่ล็อกอิน) |
| `appointment.share.create` | `appointment` | `inGroup` → สมาชิกทุก role ✅ · SA ที่ไม่ใช่สมาชิก **FORBIDDEN** (ไม่มี "มากับ X" ที่เป็นสมาชิก — แบบ `appointmentRsvp`) · คนนอก/กลุ่มลบ NOT_FOUND · กฎธุรกิจใน service (409): นัด `cancelled` → `APPOINTMENT_CANCELLED` · `end_at <= now` → `APPOINTMENT_PAST` |
| `appointment.share.revoke` | `shareLink` | `inGroup` → `grant( role ∈ {admin, moderator} ∨ (role ≠ null ∧ (actor = linkCreatedBy ∨ actor = appointmentCreatedBy)), sa )` · SA ใช้สิทธิ์ = **audited** (`ALLOW_AUDITED`) · สมาชิกอื่น FORBIDDEN (เห็นนัดอยู่แล้ว) |
| `appointment.guest.join` | `none` | `anyUser` (ล็อกอิน + active + ไม่ติดเปลี่ยน PIN) · ความสามารถจริงอยู่ที่ token (service) · SA เข้าเป็นแขกได้เหมือนผู้ใช้ทั่วไป (ไม่ใช่สิทธิ์ SA ไม่ audit แบบ SA) |
| `appointment.guest.view` | `appointmentGuest` | `group.deleted` → NOT_FOUND · `group.actorRole ≠ null` → NOT_FOUND (สมาชิกใช้ทางสมาชิก) · `!isGuest` → NOT_FOUND · อื่น ✅ · **ไม่มีข้อยกเว้น SA** |
| `appointment.guest.rsvp` | `appointmentGuest` | เหมือน `guest.view` · กฎธุรกิจ: นัด active + ยังไม่จบ (409 เดิม `APPOINTMENT_CANCELLED`/`APPOINTMENT_PAST`) |
| `appointment.guest.leave` | `appointmentGuest` | เหมือน `guest.view` (กลุ่มลบ = NOT_FOUND; แถวจะกลับมาเมื่อกู้ หรือหายเมื่อ purge) |
| `appointment.guest.remove` | `guestTarget` | `inGroup` → `grant( role ∈ {admin, moderator} ∨ (role ≠ null ∧ (actor = appointmentCreatedBy ∨ actor = invitedBy)), sa )` · SA audited · แขกเป้าหมายไม่มีอยู่ **หรือถูกนำออกไปแล้ว** → service ตอบ NOT_FOUND ก่อนถึง `can` (แบบ `requireTargetMember`) · ผล = ตั้ง `removed_at` (ไม่ลบแถว) → **กลับเข้านัดนี้ไม่ได้อีกทุกลิงก์** (ข้อ 7.1) |
- ไม่มี action "ดูรายการลิงก์" แยก: ลิงก์ที่แสดงในหน้านัดของสมาชิกกรองด้วย `can(actor, 'appointment.share.revoke', link)` แบบ `invite.list` — สมาชิกธรรมดาเห็นเฉพาะของตัวเอง · admin/mod/ผู้สร้างนัด/SA เห็นทุกลิงก์ของนัด (ไม่เห็น URL ของคนอื่น — ข้อ 5.4)
- `ACTION_RESOURCE` ต้องเติมครบ (compiler บังคับผ่าน `satisfies`) · เพิ่มคีย์ใน `SUPER_ADMIN_AUDITED` **ไม่ได้** (ตัวนั้นเฉพาะ `SUPER_ADMIN_ONLY`) — การ audit ของ SA มาจาก `ALLOW_AUDITED` ของ `grant` ตามกลไกเดิม

#### 5.3 action เดิมที่ขยาย (พฤติกรรมของสมาชิกไม่เปลี่ยน)
| ของเดิม | สิ่งที่เพิ่มสำหรับแขก |
|---|---|
| `appointment.view` / `appointment.rsvp` / `appointment.update` / `appointment.cancel` | **ไม่เปลี่ยน** — แขกได้ NOT_FOUND เหมือนคนนอก (แขกแก้/ยกเลิกนัด/ชวนต่อไม่ได้ — S4) |
| `appointment.list.mine` (`listMyUpcomingAppointmentRows`) | `UNION ALL` แถวที่ฉันเป็นแขก: นัด `active` + `end_at > now` + กลุ่มไม่ลบ · `rsvp=going` → `ag.response = 'going'` · แถวแขกออกเป็น `GuestAppointmentDto` (ข้อ 5.4) ภายใต้ union `AppointmentListItemDto` แยกด้วย `viewerKind: 'member' \| 'guest'` |
| ปฏิทิน "ของฉัน" | ใช้ `GET /api/me/appointments?rsvp=going` อยู่แล้ว → ได้นัดแขกที่ตอบไปด้วย |
| going = ไม่ว่าง (ADR 0009 §1, `goingBusyInGroupQuery`) | **[A]** นัดที่ฉันเป็นแขกและตอบ `going` นับเป็นไม่ว่างใน **กลุ่มของฉันเอง** (เหมือนนัดกลุ่มอื่น) — เพิ่มสาขา `UNION ALL` จาก `appointment_guest` (`response='going'`, นัด active, กลุ่มนัดไม่ลบ, ทับช่วง) ที่ **ใส่ `same_group = 0`, id/title = NULL ตายตัว** และ `a.group_id <> :gid` → ออกเป็น `other_group_appointment` เสมอ (ไม่มี id/ชื่อ/กลุ่ม) · **ในกลุ่มเจ้าของนัด แขกไม่ใช่สมาชิกจึงไม่อยู่ในการหาวันว่าง** (S4) |
| `myConflicts` (`myCommitmentsSql`) | สาขาที่สามสำหรับนัดที่ฉันเป็นแขกตอบ `going` (ของ session user เท่านั้น ใส่ชื่อนัด/ชื่อกลุ่มได้) · คำนวณให้แขกในหน้านัดแขกด้วย |
| เตือนก่อนนัด (`listReminderAudience`) | `UNION ALL` แขกที่บัญชี `active` พร้อม `response` → `reminderRecipients` เดิมใช้ได้ทันที (1d/1h = going · nudge = maybe/ยังไม่ตอบ) · LINE ส่งเมื่อผูกไว้ ผ่าน `notify()` เดิม **นับในเพดาน OA 300/เดือนเดิม** (ไม่มีเพดานแยก) |
| แจ้งเตือน (ADR 0007) | ข้อ 7.2 |

#### 5.4 DTO
- **`SharePreviewDto`** (หน้า `/i/<token>` — ใครก็ได้ที่ถือ token):
  `{ state: 'ok' | 'full', title, startAt, endAt, tz, localDate, placeName, lat, lng, mapUrl, groupName, groupIcon, inviterName: string | null, counts: { going, maybe } }`
  - `inviterName` = ชื่อผู้สร้างลิงก์ (ผ่าน `sanitizeDisplayText`) — คนเดียวที่แขกเห็นชื่อ ("X ชวนคุณ")
  - `counts` = **สมาชิกปัจจุบัน (กติกา `listCurrentRsvps`) + แขก** เฉพาะ `going`/`maybe` · **ไม่มี** `not_going`/`noResponse`/`memberCount` (จะบอกขนาดกลุ่ม)
  - **ไม่มี**: id นัด/กลุ่ม, `description` **[A]**, ผู้สร้างนัด, ผู้ยกเลิก, รายชื่อใด ๆ, สมาชิก, busy, นัดอื่น, `myConflicts`, `permissions`
  - **ลิงก์ใช้ไม่ได้ — 3 คำตอบเท่านั้น** (S2 · main 2026-11-20 ข้อ 3 · ux §4) · ทุกแบบ **ไม่มีรายละเอียดนัด/กลุ่ม/เวลา**:
    | คำตอบ | HTTP · code | เมื่อไร |
    |---|---|---|
    | ไม่พบ (ตัวเดียวกันทุกไบต์) | **404 `SHARE_LINK_INVALID`** body เดียวกันไม่มี detail | token ผิดรูป · ไม่มีในฐาน · **ถูกยกเลิก** (`revoked_at`) · ผู้สร้างออก/ถูกลบ/บัญชีไม่ active · ผู้เปิดเป็นแขกที่ **ถูกนำออก** จากนัดนี้ (เฉพาะตอน join — ตอน preview ไม่รู้ตัวผู้ใช้ก็ได้) |
    | หมดอายุ | **410 `SHARE_LINK_EXPIRED`** ไม่มี reason | token ใช้ได้ทุกข้อ (มีอยู่ ไม่ถูกยกเลิก ผู้สร้างยังเป็นสมาชิก) แต่นัดจบ / ถูกยกเลิก / กลุ่มถูกลบ — รวมเป็นค่าเดียวตาม ux (ไม่บอกว่ายกเลิกหรือกลุ่มลบ) |
    | เต็ม | `state: 'full'` ใน preview · **409 `SHARE_FULL`** `{ max: 10 }` ตอน join | token ใช้ได้และนัดยังเปิด แต่แขก (ที่มีผล) ครบ 10 |
    - ลำดับตรวจ: รูป token → หา hash → `revoked_at`/ผู้สร้าง (ไม่ผ่าน = 404) → กลุ่ม/นัด (ไม่ผ่าน = 410) → เพดาน · การเทียบที่ทำให้ 404 ต้องไม่ต่างกันในเนื้อหาตอบ/header (เวลาตอบต่างกันได้เล็กน้อย — 128 บิตเดาไม่ได้อยู่แล้ว)
    - **ux ต้องปรับ**: สถานะ "ถูกปิด" (`state.revoked.*`) กับ "ไม่พบ" (`state.invalid.*`) แยกกันไม่ได้แล้วที่เซิร์ฟเวอร์ → ใช้หน้าเดียว (ข้อความเป็นกลาง เช่น "ลิงก์นี้ใช้ไม่ได้ ขอลิงก์ใหม่จากคนที่ชวน")
- **`GuestAppointmentDto`** (แขกที่เข้าแล้ว — รายการ/หน้านัด): ฟิลด์ของ preview + `id`, `description`, `status`, `isPast`, `daysUntil`, `viewerKind: 'guest'`, `invitedBy: string | null` (ชื่อผู้ชวน **เฉพาะถ้ายังเป็นสมาชิก** ไม่งั้น null — แบบ `createdBy` เดิม), `myRsvp`, `permissions: { canRsvp, canLeave }`, `myConflicts`/`myConflictsTruncated` (ของตัวเอง) · ไม่มี `groupId` · `counts` แบบเดียวกับ preview
- **`AppointmentDetailDto` ของสมาชิก** (เดิม) เติม:
  - `guests: { items: GuestPersonDto[]; counts: RsvpCountsDto; max: 10 }` · `GuestPersonDto = { userId, displayName, response, invitedBy: PersonDto | null, canRemove }` (ชื่อแขกเห็นได้โดยสมาชิก — S6 · `/privacy` ต้องบอก) · `rsvp.counts` เดิม **คงเป็นของสมาชิกเท่านั้น** (`noResponse` ยังคำนวณจาก memberCount) — UI รวมเองถ้าต้องการยอดรวม
  - `shareLinks: ShareLinkDto[]` (กรองตาม 5.2) · `ShareLinkDto = { id, createdBy: PersonDto | null, createdAt, guestsJoined, mine, url? }` — `url` มี **เฉพาะ `mine`** (สร้างใหม่จาก id ทุกครั้งที่อ่าน ไม่เก็บ) · ไม่มี `token_hash` เด็ดขาด
  - `permissions.canShare` (ใช้ซ่อนปุ่มเท่านั้น)

### 6. เพดานและ rate limit
- **10 แขกต่อนัด** `APPOINTMENT_GUESTS_MAX = 10` ใน `src/lib/shared/limits.ts` · ตรวจ **ในคำสั่งเดียวกับการเพิ่ม** (S5) — `repos/share-link.ts` `insertGuestIfAllowed`:
  ```sql
  INSERT INTO appointment_guest (appointment_id, user_id, invited_by, link_id, joined_at)
  SELECT a.id, :me, l.created_by, l.id, :now
  FROM appointment_share_link l JOIN appointment a ON a.id = l.appointment_id
  WHERE l.token_hash = :hash AND <ลิงก์ใช้ได้ ข้อ 2.3>
    AND NOT EXISTS (SELECT 1 FROM group_member m WHERE m.group_id = a.group_id AND m.user_id = :me)
    AND (SELECT count(*) FROM appointment_guest g WHERE g.appointment_id = a.id AND g.removed_at IS NULL) < :max
  ON CONFLICT (appointment_id, user_id) DO NOTHING
  RETURNING appointment_id
  ```
  (มี `WHERE` อยู่แล้วจึงไม่ชน parsing ambiguity ของ `INSERT … SELECT … ON CONFLICT` — sqlite.org/lang_upsert) · รันใน `inTx` (`BEGIN IMMEDIATE`) → สองคนแข่งช่องสุดท้าย: คนที่สองเห็นจำนวน 10 แล้ว → ไม่ได้แถว · แถวที่ถูกนำออกไม่นับเพดาน แต่ยังชน PK → `DO NOTHING` = กันกลับเข้า · ไม่ได้แถว → วินิจฉัยในธุรกรรมเดียวกัน ตามลำดับ: เป็นสมาชิก = `{ status: 'member', appointmentId }` · มีแถวที่ `removed_at IS NOT NULL` = **404 `SHARE_LINK_INVALID`** (เหมือนลิงก์ไม่มี — ไม่บอกว่าถูกกัน) · เป็นแขกที่มีผลอยู่แล้ว = สำเร็จแบบ idempotent `{ status: 'guest', appointmentId }` · ลิงก์ใช้ไม่ได้ = 404/410 ตามข้อ 5.4 · เต็ม = 409 `SHARE_FULL`
- **get-or-create ลิงก์** (`insertShareLinkIfAllowed`): `INSERT … SELECT … WHERE <นัด active, ยังไม่จบ, กลุ่มไม่ลบ, ผู้สร้างยังเป็นสมาชิก active> ON CONFLICT (appointment_id, created_by) WHERE revoked_at IS NULL DO NOTHING` แล้วอ่านแถวที่ยังไม่ถูกยกเลิก → คืน token ที่ derive จาก id (S1 "กดซ้ำได้ลิงก์เดิม") · เพดานลิงก์ต่อนัดเท่าจำนวนสมาชิก (≤ 50) โดยธรรมชาติ
- **rate limit** (ถัง `rate_limit_bucket` เดิม · ค่าเสนอ — auth ยืนยัน/ปรับแล้วระบุใน handoff · `RATE_LIMITED` + `Retry-After` เดิม · ใช้ pre-check ราคาถูกก่อน `serialized` ตาม H2):
  | ถัง | ค่าเสนอ | นับอะไร |
  |---|---|---|
  | `share:create:u` | 30 / ชม. / ผู้ใช้ | ทุกคำขอหลังด่านสิทธิ์ (รวมกรณีได้ลิงก์เดิม) |
  | `share:revoke:u` | 60 / 10 นาที / ผู้ใช้ | ทุกคำขอหลังด่านสิทธิ์ |
  | `share:join:u` / `share:join:ip` (`ipRateSpec`) | 10 / 15 นาที / ผู้ใช้ · 30 / 15 นาที / IP | จองก่อนแตะ token, **คืนช่องเมื่อสำเร็จ/เป็นสมาชิก/เป็นแขกอยู่แล้ว/เต็ม** (นับเฉพาะ token ใช้ไม่ได้ — แบบ redeem) |
  | `share:guest:u` | 30 / ชม. / ผู้ใช้ | เข้าเป็นแขกสำเร็จจริง + ออกเอง (ถังเดียวกัน กันวนเข้า-ออก แบบ `GROUP_MEMBERSHIP_RATE_LIMIT`) |
  | `share:view:ip` (`ipRateSpec`) | 120 / 15 นาที / IP | ทุกการเรนเดอร์ `/i/<token>` (หน้า RSC เรียก `reserveBucket` เอง — ปิดช่อง security-r16 Info 3 สำหรับหน้านี้) · เกิน → หน้า "ลองใหม่ภายหลัง" ไม่มีข้อมูลนัด |
  | แขกตอบ RSVP | ใช้ `APPOINTMENT_WRITE_RATE_LIMITS.rsvp` เดิม | |
  | ลบแขก | `share:guest:remove:u` 60 / 10 นาที / ผู้ใช้ | หลังด่านสิทธิ์ |

### 7. วงจรชีวิต
#### 7.1 ลิงก์/แขก ตามเหตุการณ์
| เหตุการณ์ | ลิงก์ | แขก |
|---|---|---|
| นัดจบ (`end_at`) / ยกเลิก | ใช้ไม่ได้ทันที (คำนวณ) | อยู่ เห็นนัดแบบอ่านอย่างเดียว · ตอบไม่ได้ |
| แก้/เลื่อนนัด | ใช้ได้ต่อ (ตาม `end_at` ใหม่) | ได้แจ้งเตือน (7.2) |
| สมาชิก **ออก** (`leaveGroup`) / **ถูกลบ** (`removeMember`) | ลิงก์ที่เขาสร้างในกลุ่มนั้นที่ยังไม่ยกเลิก → `revoked_at = now, revoked_by = ผู้กระทำ` **ใน tx เดียวกัน** ถัดจาก `revokeActiveInvitesCreatedBy` เดิม (ฟังก์ชันใหม่ `revokeActiveShareLinksCreatedBy(tx, groupId, userId, revokedBy, now)`) · กลับเข้ากลุ่มก็ไม่ฟื้น (ด่าน `joined_at <= created_at` ซ้ำอีกชั้น) | **อยู่ต่อ** (S2) · ป้าย "มากับ X" → `invitedBy: null` ในมุมสมาชิก/แขก (คนที่ออกแล้วไม่แสดงชื่อ — กติกาเดิม) |
| แขก **ออกเอง** (`appointment.guest.leave`) | — | **ลบแถว** (คำตอบหายไปด้วย) → กลับเข้าได้อีกด้วยลิงก์ที่ยังใช้ได้ (นับในถัง `share:guest:u`) |
| แขก **ถูกนำออก** โดยผู้สร้างนัด/admin/mod/ผู้ชวน (`appointment.guest.remove`) | — | **ไม่ลบแถว** — ตั้ง `removed_at/removed_by`, ล้างคำตอบ → หายจากทุกมุมมอง/ผู้รับแจ้งเตือน และ **กลับเข้านัดนี้ไม่ได้อีกด้วยลิงก์ใด ๆ** (main 2026-11-20 ข้อ 2: ไม่งั้นการนำออกไร้ความหมาย) · ไม่มีปุ่ม "ปลดบล็อก" ใน 1.0 **[A]** — ถ้าต้องการให้เข้านัดได้ ผู้ใช้ต้องเข้ากลุ่มเป็นสมาชิก (เห็นนัดตามสิทธิ์สมาชิก) · **แถวนี้ไม่ถูกลบตอนเข้ากลุ่ม** (ข้อ 8.4 แก้ 2026-11-2x ตาม security-v1 Info 2 · main ตัดสิน) → ออกจากกลุ่มภายหลังก็กลับเป็นแขกของนัดนี้ไม่ได้ · ux ปรับ `guests.removeConfirm.body` ให้บอกว่า "เข้านัดนี้อีกไม่ได้" |
| ลบกลุ่ม (soft) | ใช้ไม่ได้ทันที (คำนวณ) | เข้าไม่ได้ทันที (ทุกคิวรีแขกผูก `groups.deleted_at IS NULL`) · ไม่มีแจ้งเตือนใหม่ (เตือนก่อนนัด join กลุ่มที่ไม่ลบอยู่แล้ว) |
| กู้กลุ่ม (R17) | ลิงก์ที่ยังไม่ยกเลิก + นัดยังไม่จบ กลับมาใช้ได้ | กลับมาครบ (แถวไม่ถูกแตะ) · **ไม่**ส่ง `group.restored` ให้แขก (ไม่ใช่สมาชิก) **[A]** |
| ลบกลุ่มถาวร (R17 purge) | ลบ | ลบ (7.3) |
| ผู้ใช้ที่เป็นแขก **เข้าเป็นสมาชิก** กลุ่มของนัด (โค้ด/คำเชิญตรง) | — | ข้อ 8.4: ย้ายคำตอบเป็น RSVP สมาชิก แล้วลบแถวแขก **ที่มีผล** ของนัดในกลุ่มนั้น ใน tx เดียวกับการเข้ากลุ่ม (แถวที่ถูกนำออกคงไว้) |
| ลบบัญชี | ข้อ 7.4 | ข้อ 7.4 |

#### 7.2 แจ้งเตือนถึงแขก (ADR 0007 — เจ้าของ `notify.ts`/`repos/notification.ts`: platform)
- **ชื่อชนิด** ตาม ux (`R18_SHARE_FLOW.md` §7): `appointment.guest.updated`, `appointment.guest.cancelled`, `appointment.guest.removed` (ชนิดแยก ไม่ใช้ธงบนชนิดเดิม — params ไม่มีชื่อ/id ผู้กระทำตั้งแต่ระดับชนิด ไม่ต้องแก้ `AppointmentActorParams` และการล้างชื่อตอนลบบัญชีไม่ต้องรู้จักชนิดใหม่) · `appointment.guest.added` / `appointment.guest.joined` (ux เสนอเสริม) **ไม่ทำใน 1.0** **[A]** — แขกกดเพิ่มเองเห็นผลทันที · ผู้ชวนเห็นในรายชื่อแขก · คีย์ข้อความค้างไว้ได้
- **มองเห็นได้**: `visibleToOwner` ปัจจุบันซ่อน `appointment.*` ของคนที่ไม่ใช่สมาชิก → เพิ่มเงื่อนไข (1) `OR EXISTS (SELECT 1 FROM appointment_guest ag JOIN appointment a ON a.id = ag.appointment_id JOIN groups g ON g.id = a.group_id AND g.deleted_at IS NULL WHERE ag.user_id = notification.user_id AND ag.removed_at IS NULL AND ag.appointment_id = json_extract(params,'$.appointmentId') AND notification.created_at >= ag.joined_at)` — ออก/ถูกนำออกจากนัด หรือกลุ่มถูกลบ → แจ้งเตือนของนัดนั้นหายเหมือนสมาชิกที่ออก (2) **`OR kind = 'appointment.guest.removed'`** เห็นเสมอ (แบบ `group.member.removed` — ไม่งั้นถูกซ่อนทันทีเพราะไม่ใช่แขกแล้ว) · เพดาน unread ต่อกลุ่ม (`usersUnderUnreadCap`) ใช้ `visibleToOwner` ตัวเดียวกันจึงทำงานต่อ
- **แก้/เลื่อน** (`updateAppointment`): แขกที่มีผลทุกคน (บัญชี active) ได้ `appointment.guest.updated` `{ groupId, groupName, appointmentId, title, startAt, tz, changes }` ในกระดิ่ง · **ยกเลิก** (`cancelAppointment`): `appointment.guest.cancelled` `{ groupId, groupName, appointmentId, title, startAt, tz }` กระดิ่ง = แขกที่ `response ≠ 'not_going'` (รวมยังไม่ตอบ) · LINE = แขกที่ `going` (กติกาเดียวกับสมาชิก R11 §1 → เพิ่มชนิดนี้ใน `LINE_KINDS` และบังคับ `lineUserIds` แบบ `appointment.cancelled`) · เรียก `notify()` แยกจากของสมาชิกใน tx เดียวกัน · **ไม่มีชื่อ/id ผู้กระทำ** (แขกไม่เห็นชื่อสมาชิก) · `appointment.guest.updated` ใช้การแทนที่ unread แบบ `appointment.updated` (รวม `changes`) · `appointment.guest.cancelled` เข้าเพดาน unread ต่อกลุ่มแบบ `appointment.cancelled`
- **เตือนก่อนนัด**: ผ่าน `listReminderAudience` ที่ขยายแล้ว (5.3) — params เดิมไม่มีชื่อคน
- **แขกตอบ RSVP** → ผู้สร้างนัด (ถ้ายังเป็นสมาชิก active — `c.creatorActive` เดิม) ได้ `appointment.rsvp_changed` แบบเดิม + `responderGuest: true` · `responderId` = id แขก (ล้างชื่อตอนลบบัญชีด้วยกลไกเดิมแล้ว)
- **แขกถูกนำออก** → `appointment.guest.removed` `{ groupId, groupName, title, startAt, tz }` กระดิ่งเท่านั้น ไม่เข้า LINE · **ไม่มี `appointmentId`** (ลิงก์ไป `/` ตาม ux — หน้านัดจะ 404 อยู่แล้ว) · ไม่บอกชื่อผู้นำออก · มี `groupId` เพื่อให้ purge กลุ่มลบตาม JSON ได้ · ข้อยกเว้นใน `visibleToOwner` ข้างบน · แขกออกเอง → ไม่แจ้งใคร **[A]**
- เพิ่มคีย์ข้อความ TH/EN ทุกชนิด/ตัวแปรใหม่ (เทสต์วนจาก `NOTIFICATION_KINDS`) · `FORBIDDEN_PARAM_KEY` ต้องยังผ่าน (ห้ามคีย์ที่มี token/hash/code)

#### 7.3 ลบกลุ่มถาวร — `src/lib/data/repos/group-purge.ts` `purgeGroupIfDue`
แทรก **หลัง** ลบ `notification` และ **ก่อน** ลบ `appointment_reminder` (ลำดับลูก→แม่, ไม่พึ่ง cascade แบบเดิม):
```sql
DELETE FROM appointment_guest      WHERE appointment_id IN (SELECT id FROM appointment WHERE group_id = :gid);  -- ก่อนลิงก์ (FK link_id)
DELETE FROM appointment_share_link WHERE appointment_id IN (SELECT id FROM appointment WHERE group_id = :gid);
```
- เติม `guests`, `shareLinks` ใน `GroupPurgeCounts` (ลง audit `group.purge` เป็นจำนวนเท่านั้น) · แจ้งเตือนของแขกที่มี `params.groupId` (รวม `appointment.guest.removed`) ถูกลบโดยคำสั่ง notification เดิมอยู่แล้ว

#### 7.4 ลบบัญชี — `src/lib/data/repos/account.ts` `purgeDeletedUserFootprint`
(แถว `user` ไม่ถูกลบจริง → FK cascade จาก user ไม่ทำงาน ต้องลบเอง)
1. `UPDATE appointment_guest SET link_id = NULL WHERE link_id IN (SELECT id FROM appointment_share_link WHERE created_by = :me)` แล้ว `DELETE FROM appointment_share_link WHERE created_by = :me` (แขกที่เขาชวนยังอยู่ — ป้ายกลายเป็น null เพราะไม่ใช่สมาชิกแล้ว)
2. `DELETE FROM appointment_guest WHERE user_id = :me` (ฐานะแขก — คำตอบหายไปพร้อมแถว)
3. `invited_by`/`revoked_by` ที่ชี้ผู้ใช้นี้ในแถวของคนอื่น: ไม่แตะ (ชี้แถว user ที่ anonymize แล้ว ไม่มีชื่อ)
4. เติม `shareLinks`, `guestRows` ใน `PurgeCounts` · การล้างชื่อใน `rsvp_changed` ที่แขกคนนี้ตอบใช้คำสั่ง `responderId` เดิม (ข้อ 7.2)

#### 7.5 ลบลิงก์เก่า 30 วัน (ตาม D1/B1) — `runDailyMaintenance`
- ลิงก์ "สิ้นสุด" ณ `ended_at = min( coalesce(revoked_at, end_at), coalesce(cancelled_at, end_at), end_at )` (คอลัมน์ของนัด) · ลบเมื่อ `ended_at <= now − 30 วัน` (ใช้ค่าคงที่/ฟังก์ชันวันเก็บของ D1 ตัวเดียวกัน — ไม่คำนวณวันเอง กฎ 9) · ลิงก์ที่ยัง active และนัดยังไม่จบ → `ended_at = end_at > now` ไม่ถูกแตะ
- ทำเป็นชุด (`LIMIT` ค่าคงที่เดียวกับ D1) และ **ตั้ง `appointment_guest.link_id = NULL` ของลิงก์ชุดนั้นก่อนลบ** (ไม่พึ่ง FK SET NULL) · ผล cron มีฟิลด์ `purgedShareLinks` (จำนวน) คู่กับ `purgedInvites`
- แถวแขกไม่มีอายุแยก: อยู่ตามนัด (เหมือน `appointment_rsvp`) ถูกลบเมื่อลบกลุ่มถาวร/ลบบัญชี/ออก/ถูกลบ

### 8. รายละเอียดเพิ่มเติมที่ต้องตรงกัน
1. **Audit** (`audit_log`, target_type `'appointment'`, target_id = id นัด, `group_id` = กลุ่มของนัด · **ห้ามมี token/hash/URL ใน meta**):
   `appointment.share.create` (เฉพาะเมื่อสร้างแถวใหม่ · meta `{ linkId }`) · `appointment.share.revoke` (meta `{ linkId, reason: 'manual' }`) · `appointment.guest.join` (meta `{ linkId, invitedBy }`) · `appointment.guest.leave` · `appointment.guest.remove` (meta `{ guestUserId }`) · การยกเลิกอัตโนมัติตอนออก/ถูกลบจากกลุ่ม: เติม `shareLinksRevoked: <จำนวน>` ใน meta ของ `group.leave`/`member.remove` เดิม (ไม่เขียนแถวแยก) · ลบบัญชี: จำนวนอยู่ใน `PurgeCounts` · SA ใช้สิทธิ์ revoke/remove = แถว audit ปกติผ่าน `audit(tx, me, allow, …)` เดิม (ธง `auditAsSuperAdmin`) · หน้า audit ของ SA ต้องแสดงชื่อ action ใหม่ได้ (frontend + messages)
2. **Error codes ใหม่** ใน `src/lib/shared/errors.ts`: `SHARE_LINK_INVALID` (**404**, ไม่มี detail — body เดียวกันทุกเหตุ) · `SHARE_LINK_EXPIRED` (**410**, ไม่มี detail) · `SHARE_FULL` (409, detail `{ max: 10 }`) — ตามข้อ 5.4
3. **ห้ามรั่ว**: คิวรีฝั่งแขกทุกตัวเลือกคอลัมน์แบบ allowlist (ไม่ `SELECT *` ไปถึง serializer) · serializer แขกสร้างอ็อบเจกต์ใหม่ (แบบ ADR 0009 §2) · เทสต์ snapshot คีย์ของ `SharePreviewDto`/`GuestAppointmentDto` ต้องไม่มีคีย์อื่น
4. **แขกที่เป็นสมาชิกอยู่แล้ว / กลายเป็นสมาชิกภายหลัง** (S4):
   - join ตอนเป็นสมาชิกอยู่แล้ว → ไม่สร้างแถว · คืน `{ status: 'member', appointmentId }` · คืนช่อง rate limit · ไม่ audit
   - แขกเข้ากลุ่มภายหลัง (`joinGroupWithCode` ใน `redeemInviteCode`, `insertMemberIfRoom` ใน `respondToDirectInvite`): ใน tx เดียวกัน หลังได้แถวสมาชิก → `INSERT INTO appointment_rsvp (appointment_id, user_id, response, updated_at) SELECT ag.appointment_id, ag.user_id, ag.response, :now FROM appointment_guest ag JOIN appointment a ON a.id = ag.appointment_id WHERE ag.user_id = :me AND a.group_id = :gid AND ag.removed_at IS NULL AND ag.response IS NOT NULL ON CONFLICT (appointment_id, user_id) DO UPDATE SET response = excluded.response, updated_at = excluded.updated_at` แล้ว `DELETE FROM appointment_guest WHERE user_id = :me AND removed_at IS NULL AND appointment_id IN (SELECT id FROM appointment WHERE group_id = :gid)` (**แก้ตาม security-v1 Info 2 · main ตัดสิน**: ลบเฉพาะแถวที่มีผล · แถวที่ถูกนำออกคงไว้เป็นตัวกันกลับเข้า — ระหว่างเป็นสมาชิกไม่มีผลเพราะทุกคิวรีฝั่งแขกกรอง `removed_at IS NULL` และ join ตอบ `member` ก่อนดูแถวนี้ · ออกจากกลุ่มภายหลัง → เปิดลิงก์ได้ 404 `SHARE_LINK_INVALID` เหมือนเดิม) — คำตอบเดิมไม่หาย (`updated_at = now >= joined_at`) และไม่มีสถานะซ้อน
5. **เวลา**: ทุกการเทียบเวลาใช้ epoch ms ที่ `ctx.now`/`clock.now()` · `daysUntil`/`localDate` ผ่าน `src/lib/calendar` (กฎ 9) · ไม่มีคอลัมน์วันที่ท้องถิ่นใหม่
6. **ความลับ**: ไม่มี env ใหม่ (ใช้ `APP_SECRET` ผ่าน HKDF info ใหม่ 2 ค่า) — สอดคล้อง R18 §0

### 9. Rollback ของ migration `0007` (ops ใส่ใน OPERATIONS · platform ตรวจ)
1. **ย้อนแอปอย่างเดียว (Vercel Instant Rollback) พอ** — รุ่น v0.15.0 ไม่รู้จักตารางใหม่ ไม่ SELECT/INSERT ตารางนั้น · ผลระหว่างอยู่รุ่นเก่า: แขกเข้าไม่ได้ (หน้า `/i/*` และทางแขกไม่มี) แต่ข้อมูลอยู่ครบ · ข้อควรรู้ที่อ่านจากโค้ด (**ยังไม่ได้รันจริง**): (ก) cron ของรุ่นเก่า purge กลุ่มโดยลบ `appointment` → แถวแขก/ลิงก์ของนัดนั้นหายตาม FK CASCADE **ถ้า `foreign_keys` เปิด** — ถ้าปิดจะค้างเป็นแถวกำพร้า (ไม่มีใครอ่านเห็น) ลบได้ด้วย `DELETE FROM appointment_guest WHERE appointment_id NOT IN (SELECT id FROM appointment)` และเช่นเดียวกันกับลิงก์ หลังกลับรุ่นใหม่ (ข) ลบบัญชีบนรุ่นเก่าไม่ลบแถวแขก/ลิงก์ของคนนั้น → หลังกลับรุ่นใหม่รัน 7.4 ข้อ 1–2 ด้วยมือกับ user ที่ `status='deleted'` (ops เขียนคำสั่ง) (ค) DB ที่มีตารางใหม่ไม่ทำให้ migration check ของรุ่นเก่าล้ม (เกณฑ์ S8 — platform/ops ยืนยันใน CI)
2. **ถอดตารางจริง** — ไม่แนะนำ ทำเมื่อ boss สั่งเท่านั้น ลำดับ: `DROP TABLE IF EXISTS appointment_guest;` → `DROP TABLE IF EXISTS appointment_share_link;` (index หายตามตาราง · แขกก่อนเพราะ FK `link_id`) · ผล: แขกและลิงก์ทั้งหมดหายถาวร (นัด/RSVP ของสมาชิกไม่กระทบ) · แถว `0007` ใน `__drizzle_migrations` **ยังไม่ได้ตรวจกับฐานจริง** — แจ้ง main ก่อนแตะ (ถ้าไม่ลบแถวนั้น drizzle จะไม่สร้างตารางใหม่เมื่อ deploy รุ่นใหม่ซ้ำ)
3. ลำดับ deploy ตาม R18 §8: รัน `0007` บน preview กับ boss → เปิด PR → รันบน prod **ก่อน** merge (รุ่นเก่าทำงานกับฐานที่มีตารางใหม่ได้ ข้อ 1)

## Consequences
- **บวก**: ชวนคนนอกได้โดยไม่ขยายสิทธิ์กลุ่ม · ทางของสมาชิกไม่เปลี่ยน (ความเสี่ยงถอยหลังต่ำ) · ไม่มี expiry ที่ต้องตามแก้ · ลิงก์เดิมแชร์ซ้ำได้โดยไม่เก็บ token · ลบ/กู้/ลบถาวรเข้ากับ R17 ได้ตรง
- **ลบ/ค่าใช้จ่าย**: คิวรี 4 ตัวได้สาขา `UNION ALL` เพิ่ม (`listMyUpcomingAppointmentRows`, `goingBusyInGroupQuery`, `myCommitmentsSql`, `listReminderAudience`) + `visibleToOwner` ซับซ้อนขึ้น — ต้องมีเทสต์ `.toSQL()`/ข้อมูลจริงแบบเดิม · ชื่อแขกเห็นโดยสมาชิกทั้งกลุ่มของนัด (ต้องเขียนใน `/privacy`) · ยอด going/maybe บอกจำนวนสมาชิกที่ตอบบางส่วนแก่คนถือลิงก์ (boss ยอมรับ) · เปลี่ยน `APP_SECRET` = ลิงก์ทั้งหมดตาย · path `/i/<token>` อยู่ใน access log ของ Vercel

## ทางเลือกที่ไม่เลือก
- **token สุ่มเก็บแค่ hash (แบบโค้ดเชิญตรงตัว)**: ทำ "กดซ้ำได้ลิงก์เดิม" ไม่ได้ (ต้องเก็บ token ดิบหรือเข้ารหัสเก็บ) · **เก็บ token แบบเข้ารหัส (AES-GCM)**: ได้ผลเท่ากันแต่มีความลับในฐานเพิ่มและต้องจัดการ nonce — deterministic HMAC ง่ายกว่า
- **โค้ดสั้นแบบ XXXX-XXXX**: ไม่มีใครพิมพ์ลิงก์ · 40 บิตต่ำเกินสำหรับ capability ที่เปิดดูได้โดยไม่ล็อกอิน
- **เก็บ RSVP แขกใน `appointment_rsvp`**: ทุกคิวรีสมาชิกปลอดภัยเพราะ join `group_member` แต่ลบแขกต้องลบสองที่ และกรณีแขก→สมาชิกต้องพึ่งกติกา `updated_at >= joined_at` ซึ่งอ่านยาก
- **ขยาย `appointment.view`/`appointment.rsvp` ให้รับแขก**: แตะกฎ `inGroup` ที่ทุก action ใช้ · manifest/เทสต์เดิมต้องเปลี่ยน · เสี่ยงรั่ว DTO สมาชิกให้แขก
- **เก็บ `expires_at`**: ต้องอัปเดตเมื่อแก้เวลานัด/ยกเลิก/ลบกลุ่ม — แหล่งความจริงซ้ำซ้อน
- **แขกที่ถูกนำออกเข้าใหม่ได้ด้วยลิงก์ที่ยังใช้ได้** (ux เสนอเป็นทางหนึ่ง): การนำออกไร้ผลจริง — main ตัดสินกันไว้ · **ตารางบล็อกแยก (ตารางที่สาม)**: ทำได้เท่ากันแต่เพิ่มตารางนอกขอบ S8 — ใช้คอลัมน์ `removed_at` บน PK เดิมแทน
- **บอกเหตุผลต่างกันระหว่าง "ถูกยกเลิก" กับ "ไม่พบ"**: ทำให้ไล่ตรวจได้ว่า token เคยมีอยู่ — main ตัดสินให้ตอบ 404 เหมือนกัน
- **auto-join หลัง login**: เร็วกว่า 1 คลิก แต่การเข้าเป็นแขกเกิดโดยผู้ใช้ไม่ได้กดยืนยันบนการ์ด

## Test requirements (platform/auth/test — ขั้นต่ำ)
1. RBAC ตาราง role×action ครบ 8 action ใหม่: admin/mod/member/ผู้สร้างนัด/ผู้สร้างลิงก์/ผู้ชวนแขก/SA สมาชิก/SA ไม่ใช่สมาชิก (audited)/คนนอก/แขก/anonymous/suspended/mustChangePin · แขกเรียก `GET /api/appointments/:id`, `PATCH`, `cancel`, `rsvp` (สมาชิก), `group.view`, calendar, availability, `share-link` → NOT_FOUND
2. ลิงก์: สร้างซ้ำได้ id/URL เดิม · นัดยกเลิก/จบ/กลุ่มลบ → สร้างไม่ได้ (409/404) · ยกเลิกแล้วสร้างใหม่ได้ลิงก์ใหม่ · ยกเลิก / ผู้สร้างออก/ถูกลบ → 404 **body เดียวกับ token ที่ไม่มีอยู่ทุกไบต์** · นัดจบ/ยกเลิก/กลุ่มลบ → 410 ไม่มี reason · กลับเข้ากลุ่ม → ลิงก์เก่ายังใช้ไม่ได้ · `:lid` ของนัดอื่น → NOT_FOUND
3. Preview: คีย์ DTO ตรง allowlist ทุกตัว (ไม่มีชื่อสมาชิก/description/id) · 404/410/full ไม่มีรายละเอียดนัด · หน้าส่ง `X-Robots-Tag` + meta robots/referrer · GET ไม่สร้างแถว
4. Join: เพดาน 10 — แข่ง 2 คนที่ช่องสุดท้าย (Promise.all บนฐานทดสอบ) ได้แขกพอดี 10 คนหนึ่งได้ `SHARE_FULL` · เข้าซ้ำ idempotent · แขกที่ถูกนำออกเปิดลิงก์เดิม/ลิงก์อื่นของนัดเดียวกัน → 404 และไม่ได้แถวใหม่ · แขกที่ออกเอง → เข้าใหม่ได้ · แถวที่ถูกนำออกไม่นับเพดาน 10 และไม่โผล่ในรายชื่อ/ยอด/เตือน/แจ้งเตือน · สมาชิก join → ไม่มีแถว · token ผิดรูปไม่แตะฐาน
5. `safeNext`: ยอมเฉพาะ `/i/<22>` · `//evil`, `/\evil`, `https://…`, `/i/../admin`, `%2F%2F`, ยาวผิด → `/`
6. แขกใน: รายการนัดของฉัน (`rsvp=going` ด้วย) · เตือน 1d/1h/nudge (+LINE เมื่อผูก) · แจ้งแก้/ยกเลิก (ไม่มีชื่อผู้กระทำ) · `appointment.guest.removed` ยังเห็นหลังถูกนำออก · แจ้งเตือน `appointment.*` หายหลังออก/ถูกลบ/กลุ่มลบ และกลับมาเมื่อกู้กลุ่ม
7. going-as-busy: นัดแขกที่ตอบไป ขึ้นเป็น `other_group_appointment` (ไม่มี id/title) ในกลุ่มของแขกเอง · **ไม่ขึ้น** ในวันว่าง/ปฏิทินของกลุ่มเจ้าของนัด
8. วงจร: ลบบัญชี (แขก/ผู้สร้างลิงก์) · soft delete → เข้าไม่ได้ · กู้ → กลับมา · purge → ไม่เหลือแถวแขก/ลิงก์ + counts ใน audit · D1 ลบลิงก์ที่สิ้นสุด > 30 วัน (revoked/cancelled/ended) ไม่แตะลิงก์ active · แขกเข้ากลุ่มภายหลัง → RSVP ย้าย + แถวแขกหาย
9. ไม่มี token/hash/URL ใน audit meta, notification params, log (สแกนแบบเทสต์ security เดิม)

## ยืนยันแล้ว / ยังไม่ยืนยัน
**ยืนยันแล้ว (อ่านโค้ดที่ `66d7e82`, 2026-11-20)**: ไม่มี `src/middleware.ts`/`src/proxy.ts` · locale จากคุกกี้ (`src/i18n/request.ts`) · `LoginForm` redirect `'/'` ตายตัว ไม่มีพารามิเตอร์ `next` · Referrer-Policy `strict-origin-when-cross-origin` ทั้งเว็บ (`next.config.ts`) · `visibleToOwner` ซ่อน `appointment.*` ของคนที่ไม่ใช่สมาชิก (`repos/notification.ts`) · ลำดับลบใน `purgeGroupIfDue` และรายการใน `purgeDeletedUserFootprint` ตามที่อ้าง · `revokeActiveInvitesCreatedBy` ถูกเรียกใน `leaveGroup`/`removeMember` · `randomToken` ต้อง ≥ 16 ไบต์ (`src/lib/shared/id.ts`) · `invite-code.ts` ใช้ HKDF info `'maewmeet/invite-code/v1'`
**ยืนยันจากเอกสารภายนอก**: SQLite UPSERT รับ conflict target แบบมี `WHERE` (partial index) และ `INSERT … SELECT` ควรมี `WHERE` เพื่อเลี่ยง parsing ambiguity — https://sqlite.org/lang_upsert.html (เข้าถึง 2026-11-20) · Next.js Metadata มี `robots` และ `referrer` และ metadata อาจถูก stream ไปท้าย `<body>` ยกเว้น HTML-limited bots — https://nextjs.org/docs/app/api-reference/functions/generate-metadata (lastUpdated 2026-11-18, เข้าถึง 2026-11-20)
**ยังไม่ยืนยัน (ต้องตรวจตอน implement)**: SQL ที่ drizzle-kit สร้างสำหรับ `0007` มี `ON DELETE` ครบ · ฐาน Turso จริงเปิด `PRAGMA foreign_keys` หรือไม่ (มีผลกับ rollback ข้อ 9.1) · partial unique index + `ON CONFLICT … WHERE` ทำงานบน libSQL รุ่นที่ใช้ (เทสต์ต้องรันจริง) · Next 16 ใส่ `Cache-Control: no-store` ให้หน้า `/i/[token]` ที่อ่านคุกกี้หรือไม่ (ถ้าไม่ ให้เพิ่มใน header เดียวกับ `X-Robots-Tag`) · ตัวดึงตัวอย่างลิงก์ของ LINE เคารพ `X-Robots-Tag` หรือไม่ (ไม่สำคัญเพราะ OG ทั่วไป) · ค่า rate limit ทั้งหมดเป็นค่าเสนอ (auth ยืนยัน)
