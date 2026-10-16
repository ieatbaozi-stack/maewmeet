# ADR 0002 — Auth ด้วย PIN 6 หลัก: hash, lockout, session, reset `123456`

- **Status**: Proposed (Architect, 2026-10-15) · แก้รอบ 2 (2026-10-16): เพิ่ม §7 การจัดการ pepper · **§6 (ผูก `123456` กับเครื่อง) — Accepted โดย boss 2026-10-16**
- **เกี่ยวข้อง**: [PRD D1–D3, U1–U3, U12, U13, §3 กติกาเสริม, §10](../prd/PRD.md) · [RESEARCH §3](../research/RESEARCH_REPORT.md) · [ADR 0003](0003-rbac.md) · [ARCHITECTURE §3–§4](../design/ARCHITECTURE.md)
- **เจ้าของการ implement**: Auth & Access (`src/lib/auth/**`, `src/app/api/auth/**`)

## Context
PIN 6 หลัก = 1,000,000 แบบ (ลบ PIN ต้องห้าม 20 ตัว) อ่อนโดยธรรมชาติ ต้องชดเชยด้วย (1) hash ช้า + pepper นอกฐาน (2) lockout ต่อ username และต่อ IP (3) session ยาวไม่ต้องกรอกบ่อย (4) flow reset ที่ช่อง `123456` เปิดให้น้อยที่สุด · รันบน Vercel serverless (Node 24, ไม่มี Redis) + Turso

## Decision

### 1. Hash PIN: argon2id ผ่าน `node:crypto` (built-in) + pepper
- ใช้ `crypto.argon2('argon2id', {...})` ของ Node — **เพิ่มใน v24.7.0** รองรับพารามิเตอร์ `secret` ซึ่งเอกสาร Node ระบุตรง ๆ ว่าคือ pepper ([Node crypto docs](https://nodejs.org/api/crypto.html#cryptoargon2algorithm-parameters-callback)) → ไม่มี native addon ให้ปวดหัวบน Vercel
- พารามิเตอร์ = ขั้นต่ำของ [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): **m = 19456 KiB (19 MiB), t = 2, p = 1**, salt (`nonce`) สุ่ม 16 ไบต์, `tagLength` 32
- เก็บเป็นสตริงแบบ PHC `$argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64>` ใน `user.pin_hash` + `user.pin_pepper_version`
- pepper มีหลายเวอร์ชันพร้อมกันได้ (`PIN_PEPPER_V1`, `PIN_PEPPER_V2`, … + `PIN_PEPPER_CURRENT_VERSION`) · แต่ละแถว `user.pin_pepper_version` บอกว่า hash ด้วยตัวไหน · **กติกาการเก็บ/ตรวจ/หมุน/สำรองทั้งหมดอยู่ใน §7**
- เปรียบเทียบด้วย `crypto.timingSafeEqual` · ผู้ใช้ไม่มีอยู่จริง → ยัง verify กับ dummy hash (คำนวณครั้งเดียวตอน cold start) ให้เวลาตอบใกล้เคียงกัน
- งบ CPU: ~ไม่กี่สิบ ms ต่อครั้งที่ 1 vCPU → Active CPU 4 ชม./เดือน ของ Hobby รองรับหลักแสนครั้ง login (ต้องวัดจริงใน R1 แล้วจดผลใน Handoff)
- **Fallback** ถ้า R0 พบว่า `crypto.argon2` ใช้บน Vercel ไม่ได้: `@node-rs/argon2` 2.2.x (อัปเดต 2026-10-06, มี prebuilt `linux-x64-gnu`, รองรับ option `secret`) ต้องใส่ใน `serverExternalPackages` — รูปแบบ PHC เดียวกันจึงสลับได้โดยไม่ migrate ข้อมูล

### 2. กติกา PIN
- ตัวเลข 6 หลักเท่านั้น (`^\d{6}$`)
- **PIN ต้องห้ามตอนตั้งเอง** (U1, U3): 20 ตัว = เลขซ้ำทั้งหมด 10 ตัว (`000000`…`999999`) + เรียงขึ้น 5 (`012345`,`123456`,`234567`,`345678`,`456789`) + เรียงลง 5 (`987654`,`876543`,`765432`,`654321`,`543210`) · `123456` อยู่ในกลุ่มเรียงขึ้น จึงตั้งเองไม่ได้ทุกกรณี → ผลพลอยได้: **PIN ปกติของใครก็ไม่มีวันเป็น `123456`** ทำให้ตีความ `123456` ตอน login ได้ไม่กำกวม (ข้อ 5)

### 3. Lockout / throttle (ไม่มี Redis — เก็บใน Turso)
ใช้ 2 ตาราง ([ARCHITECTURE §3](../design/ARCHITECTURE.md)):
- `login_throttle(key = 'u:' + username_normalized)` — **คีย์ด้วย username ที่พิมพ์มา ไม่ว่ามีบัญชีจริงหรือไม่** → พฤติกรรม lockout เหมือนกันทุกกรณี กันการไล่เดาชื่อ (U1 AC)
- `rate_limit_bucket(key, window_start, count)` — fixed window, เพิ่มค่าแบบอะตอมด้วย UPSERT เดียว:
  ```sql
  INSERT INTO rate_limit_bucket(key, window_start, count) VALUES (?1, ?2, 1)
  ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
    window_start = excluded.window_start
  RETURNING count;
  ```
  IP ถูก HMAC ด้วย subkey จาก `APP_SECRET` ก่อนเป็นคีย์ (ไม่เก็บ IP ดิบ) · IPv6 ใช้ prefix /64

| สิ่งที่จำกัด | กุญแจ | เกณฑ์ | ผลเมื่อเกิน |
|---|---|---|---|
| **ล็อกอินผิดต่อ username** | `u:<username>` | ผิดติดกัน 1–4 ครั้ง: ไม่ล็อก (ตอบจำนวนครั้งที่เหลือ) · ครั้งที่ f ≥ 5: ล็อก **min(2^(f−5) นาที, 24 ชม.)** = 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024 นาที แล้วคงที่ 24 ชม. | `429 LOGIN_LOCKED` + `retryAfterSec` · ระหว่างล็อก **PIN ถูกก็ไม่ให้เข้า** · สำเร็จ 1 ครั้ง → รีเซ็ต f = 0 · super admin ปลดล็อกได้ (U12) |
| ล็อกอินผิดต่อ IP | `login:ip:<hash>` | 20 ครั้ง / 15 นาที | `429 RATE_LIMITED` จนจบหน้าต่าง |
| สมัคร (U1) | `signup:ip:<hash>` | 5 ครั้ง / ชม. | `429 RATE_LIMITED` |
| ขอ reset (U2) | `reset:ip:<hash>` และ `reset:u:<username>` | 3 / ชม. ต่อ IP · 3 / 24 ชม. ต่อ username | ตอบข้อความเดียวกับปกติ (ไม่บอกว่าโดนจำกัด เพื่อไม่ให้รู้ว่ามีบัญชี) แต่ไม่สร้างคำขอ |
| พิมพ์โค้ดเชิญผิด (U5) | `invite:user:<id>`, `invite:ip:<hash>` | 10 / ชม. ต่อผู้ใช้ · 30 / ชม. ต่อ IP (นับเฉพาะที่ผิด) | `429 RATE_LIMITED` |
| ชวนตรง (U5) | `dinvite:user:<id>` | 30 / ชม. | `429 RATE_LIMITED` |
| ค้นหาสถานที่ | `nominatim:global` | 1 / วินาที ทั้งระบบ | `429 RATE_LIMITED` |

ผลด้านความปลอดภัย (คำนวณ): ผู้โจมตีที่รู้ username เดา PIN ได้ ~15 ครั้งในวันแรก (5 + ช่วงล็อกสะสม 1+2+…+512 = 1023 นาที ≈ 17 ชม.) จากนั้นวันละ 1 ครั้ง → ~380 ครั้ง/ปี ≈ **0.04%** ของ 999,980 PIN ที่ตั้งได้ · ราคาที่จ่าย: ใครรู้ username ก็ทำให้เจ้าของถูกล็อกได้ (DoS) — ยอมรับได้ในกลุ่มเพื่อน + มีปุ่มปลดล็อกของ super admin

ลำดับตรวจตอน login: IP bucket → `login_throttle` → verify (เสมอ แม้ไม่มีผู้ใช้) → บันทึกผล · ข้อความผิดเป็นรหัสเดียว `INVALID_CREDENTIALS` + `attemptsRemaining` ไม่ว่า username ไม่มีหรือ PIN ผิด (U1 AC) · บัญชี `suspended` ตอบ `ACCOUNT_SUSPENDED` **เฉพาะเมื่อ PIN ถูก** (ไม่เปิดช่องไล่ชื่อ)

### 4. Session: เขียนเอง (ตามแนว Lucia ที่ถูก deprecate แล้ว)
- token สุ่ม 20 ไบต์ (base32) ใน cookie `__Host-mm_session` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=60 วัน`; dev ใช้ชื่อ `mm_session`) · DB เก็บเฉพาะ **SHA-256(token)** เป็น `session.id` — ฐานรั่วก็เอา token ไปใช้ไม่ได้
- อายุ 60 วัน (U1) แบบ sliding: ถ้าเหลือ < 30 วัน ต่อเป็น now + 60 วัน · `last_seen_at` อัปเดตไม่เกินวันละครั้ง (ประหยัด row writes — ADR 0001)
- ออกจากระบบทุกเครื่อง = ลบทุกแถวของ user (U1, U13) · เปลี่ยน PIN (U13) / ตั้ง PIN ใหม่หลัง reset (U3) → ลบ session อื่นทั้งหมด เหลือเครื่องปัจจุบัน · ระงับบัญชี/ลบบัญชี → ลบทุก session
- ทุกครั้งที่อ่าน session ดึง `user.status`, `is_admin`, `must_change_pin` สดจาก DB (JOIN เดียว) — ไม่ cache สิทธิ์ใน cookie
- CSRF: request ที่ไม่ใช่ GET/HEAD ต้องมี `Origin` ตรงกับ host ของแอป + `Content-Type: application/json` (บังคับ preflight ข้ามโดเมน) + cookie `SameSite=Lax`

### 5. Flow reset PIN (U2, U3, D3)
สถานะ `pin_reset_request.status`: `pending → approved → used` · `pending → rejected` · `pending → cancelled` · `pending → expired` (ไม่มีใครตัดสินใน 7 วัน) · `approved → expired` (เกิน 24 ชม.)

```
REQUEST (ไม่ต้องล็อกอิน)  POST /api/auth/pin-reset {username}
  ตรวจ rate limit (เกิน → ตอบเหมือนปกติ ไม่สร้างแถว)
  สร้าง deviceToken สุ่ม 32 ไบต์ → set cookie __Host-mm_reset (HttpOnly, Max-Age 8 วัน)  ← ตั้งเสมอ แม้ไม่มี username นี้
  ถ้ามีผู้ใช้ status=active และไม่มีคำขอเปิด (pending/approved):
       insert {status:pending, device_token_hash: sha256(deviceToken), requester_ua (ย่อ), requester_country (x-vercel-ip-country), pending_expires_at: now+7d}
  ตอบ 202 ข้อความเดียวกันทุกกรณี

DECIDE (super admin)  POST /api/auth/admin/pin-resets/:id/approve | reject
  can(actor,'pinReset.decide') · ต้อง status=pending และยังไม่เลย pending_expires_at
  approve: status=approved, decided_by/at, expires_at=now+24h, user.pin_hash=NULL (PIN เดิมใช้ไม่ได้อีก — "PIN กลายเป็น 123456")
           + notification 'pin_reset.approved'
  reject : status=rejected
  ทั้งสองกรณี → audit_log (ใคร, เมื่อไร, ของใคร) (U2 AC)

LOGIN  POST /api/auth/login {username, pin}
  [throttle ตามข้อ 3]
  if pin == '123456':
     r = คำขอ status=approved ของ user นี้ ที่ now < expires_at
     ok = r มีจริง AND sha256(cookie __Host-mm_reset) == r.device_token_hash
     if ok: r.status=used, used_at=now · user.must_change_pin=1 · สร้าง session · ลบ cookie mm_reset
     else : นับเป็นล็อกอินผิด → INVALID_CREDENTIALS   (รวมกรณี pending: "123456 ยังใช้ไม่ได้")
  else:
     verify argon2 กับ user.pin_hash (NULL → ผิดเสมอ)
     ถ้าถูก และมีคำขอ status=pending → status=cancelled + notification 'pin_reset.cancelled_by_login' (U2 AC)

LAZY EXPIRY  ทุกจุดที่อ่านคำขอ: approved && now ≥ expires_at → expired · pending && now ≥ pending_expires_at → expired
             (cron รายวันทำซ้ำเพื่อความสะอาดเท่านั้น ไม่ใช่กลไกหลัก — Hobby cron คลาดได้ ±59 นาที)

SET NEW PIN  POST /api/auth/pin {newPin, currentPin?}
  must_change_pin=1 → ไม่ต้องใส่ currentPin · newPin ผ่านกติกาข้อ 2 (ห้าม 123456)
  ปกติ (U13) → ต้อง currentPin ถูก (นับเข้า login_throttle ด้วย)
  สำเร็จ: hash ใหม่, must_change_pin=0, ลบ session อื่นทั้งหมด, ยกเลิกคำขอ pending ที่ค้าง
```
- คำขอเปิดได้ 1 รายการต่อผู้ใช้ — บังคับด้วย partial unique index `WHERE status IN ('pending','approved')` (U2 AC)
- `GET /api/auth/pin-reset/status` อ่าน cookie `mm_reset` แล้วตอบได้แค่ `pending | approved | closed` ของคำขอที่ผูกกับเครื่องนี้ (username ไม่มีจริง → `pending` ตลอด ไม่รั่วข้อมูล) ใช้ให้หน้าเข้าสู่ระบบบอกว่า "ได้รับอนุมัติแล้ว ใช้ 123456 บนเครื่องนี้ได้ภายใน …"

### 6. ตัดสิน: **ผูก `123456` กับอุปกรณ์ที่กดขอ reset — ใช่** (boss ยืนยัน 2026-10-16)
เหตุผล
1. ปิดความเสี่ยงหลักที่ PRD §10 ระบุ ("24 ชม. หลัง reset ใครรู้ username ก็เข้าได้ก่อนเจ้าตัว") — ผู้โจมตีต้องมี cookie จากเครื่องที่กดขอด้วย
2. ต้นทุน UX ต่ำ: คนลืม PIN มักขอและเข้าจากมือถือเครื่องเดียวกัน · ถ้าเปลี่ยนเครื่อง/ล้าง cookie แค่รอหมดอายุแล้วขอใหม่ (หน้า UI ต้องบอกชัด "ใช้เครื่องนี้เข้าสู่ระบบหลังได้รับอนุมัติ")
3. ไม่ต้องมีช่องทางยืนยันตัวตนเพิ่ม (ไม่มีอีเมล/LINE ใน v1)

ข้อจำกัดที่ยังเหลือ: คนที่รู้ username กดขอ reset **ก่อน**เจ้าตัว → คำขอผูกกับเครื่องผู้โจมตี และคำขอของเจ้าตัวจะไม่ถูกสร้าง (มีได้ 1 รายการ) — ด่านสุดท้ายคือ **super admin ต้องยืนยันกับเพื่อนนอกระบบก่อนกดอนุมัติ** หน้า admin จึงต้องแสดงเวลาที่ขอ + ชนิดอุปกรณ์/เบราว์เซอร์แบบย่อ + ประเทศจาก IP ให้เทียบกับที่เพื่อนบอก

### 7. การจัดการ pepper (เพิ่มรอบ 2 ตามคำถาม boss)

> **สรุปสำหรับ boss**
> - **pepper คืออะไร**: กุญแจลับ 1 ค่าที่เอาไปผสมตอนแปลง PIN เป็น hash — เก็บใน Vercel env **ไม่อยู่ในฐานข้อมูล**
> - **ทำไมต้องมี**: ถ้าฐานข้อมูลหลุดออกไป (โดยที่ไม่มี pepper) คนร้ายเดา PIN 6 หลักของ 1 คนได้ภายใน **≤ 3.4 ชม. ด้วย CPU คอร์เดียว** (วัดจริง — ข้อ 7.5) · มี pepper แล้วฐานหลุดอย่างเดียวเดาไม่ได้เลย
> - **หายได้ทางไหน**: Vercel ไม่ได้ลบ env เอง และไม่มีวันหมดอายุ — หายได้เพราะ**คน**เท่านั้น: กดลบ/แก้ค่าผิด, ลบโปรเจกต์, ย้ายโปรเจกต์แล้วลืมตั้ง · และเมื่อตั้งเป็นชนิด Secret แล้ว **Vercel ไม่ให้อ่านค่ากลับ** ([Vercel docs](https://vercel.com/docs/environment-variables/sensitive-environment-variables)) ดังนั้นสำเนาที่ boss เก็บเองคือสำเนาเดียวที่อ่านได้
> - **เรากันไว้อย่างไร**: (1) ระบบไม่มีวันสร้าง pepper ใหม่เอง (2) เก็บ "ลายนิ้วมือ" ของ pepper ในฐาน — ถ้า env ถูกเปลี่ยนเป็นค่าผิด ระบบปิดเฉพาะการ login พร้อมแจ้งดูแลระบบ **ก่อน**ใครจะโดนนับว่า PIN ผิด (3) เก็บสำรอง 2 ที่ตามข้อ 7.4 (4) health check แดง + GitHub Actions แจ้งเตือนภายใน ~12 ชม. (เงื่อนไขการแจ้งเตือนใน [ADR 0001 §3.1](0001-stack-and-project-structure.md))
> - ผลคือ: ตั้งผิด = ระบบหยุดรอแก้ ไม่มีใครเสียหาย · ลบผิด = เอาค่าจากที่สำรองมาใส่คืน · ต้องหายพร้อมกัน 3 ที่ (Vercel + ตัวจัดการรหัสผ่าน + สำเนาออฟไลน์) จึงจะต้อง reset ทุกคน

#### 7.1 Fail closed — ห้ามสร้างหรือเดา pepper เอง
- โหลดค่า pepper จาก env ด้วย zod ตอนเริ่ม (`src/lib/shared/env.ts`): ต้องมี `PIN_PEPPER_CURRENT_VERSION` (จำนวนเต็ม ≥ 1) และ `PIN_PEPPER_V<n>` ของเวอร์ชันนั้น · ค่า pepper ต้องถอด base64 ได้ ≥ 32 ไบต์ · **ไม่มีค่าดีฟอลต์ ไม่ยอมรับค่าว่าง ไม่สุ่มให้เอง** ทั้งใน prod/preview (dev/test ต้องตั้งเองใน `.env.local`/fixture)
- ถ้าเงื่อนไขไม่ผ่าน หรือ fingerprint (7.2) ไม่ตรง → สถานะ `pepperState = 'unavailable'` (เก็บต่อ instance):
  - `GET /api/health` → **503** `{status:'degraded', checks:{pepper:'fail'}}` (ไม่บอกรายละเอียดอื่นต่อสาธารณะ)
  - endpoint ที่ต้องใช้ pepper — `auth.signup`, `auth.login`, `self.pin.change`, `self.delete` (ยืนยัน PIN) — ตอบ **503 `AUTH_MAINTENANCE`** ทันที **ก่อน**ตรวจ throttle/verify → **ไม่นับเป็นการล็อกอินผิด ไม่มีใครโดนล็อก** · UI แสดง "ระบบเข้าสู่ระบบปิดปรับปรุงชั่วคราว ข้อมูลของคุณปลอดภัย"
  - session ที่มีอยู่ใช้งานส่วนอื่นได้ปกติ (session ไม่ขึ้นกับ pepper) → คนที่ล็อกอินอยู่ไม่รู้สึกอะไร
  - log ระดับ `error` รหัส `PEPPER_CHECK_FAILED` + เวอร์ชันที่มีปัญหา (ไม่ log ค่า)
- ห้ามมีโค้ด path ใดที่ "ถ้า verify ไม่ผ่านกับ pepper ทุกตัว ให้ลองแบบไม่มี pepper" หรือ "hash ใหม่ด้วย pepper ที่มี" ตอนที่ fingerprint ไม่ตรง

#### 7.2 Fingerprint ของ pepper ในฐานข้อมูล
- ตาราง `pepper_fingerprint(version PK, fingerprint, created_at)` · `fingerprint = hex(HMAC-SHA256(key = pepper, msg = "maewmeet/pepper-fingerprint/v1"))` — เป็นทางเดียว เปิดเผยแล้วย้อนหา pepper ไม่ได้ (pepper 256 บิต) แต่ก็ไม่ส่งออก API สาธารณะ (หน้า super admin แสดงแค่ 8 ตัวแรก)
- ตรวจครั้งแรกที่ instance ต้องใช้ pepper (lazy, cache ผลไว้ใน memory ของ instance) สำหรับ **ทุกเวอร์ชันที่ตั้งใน env**:
  | สถานะใน DB | ผู้ใช้ที่ `pin_pepper_version = v` และมี `pin_hash` | การกระทำ |
  |---|---|---|
  | มีแถว v และตรง | — | ผ่าน |
  | มีแถว v แต่ไม่ตรง | — | **fail closed** (7.1) — env ถูกเปลี่ยนเป็นค่าผิด |
  | ไม่มีแถว v | 0 คน | ตั้งเวอร์ชันครั้งแรก: insert fingerprint (เฉพาะเวอร์ชันที่เท่ากับ `CURRENT`) |
  | ไม่มีแถว v | > 0 คน | **fail closed** — แถวหายผิดปกติ ต้องให้คนตรวจ |
  | เวอร์ชันที่มีผู้ใช้อยู่ แต่ env ไม่มี `PIN_PEPPER_V<v>` | > 0 คน | ผู้ใช้กลุ่มนั้นล็อกอินไม่ได้ → login ตอบ `AUTH_MAINTENANCE` **เฉพาะผู้ใช้กลุ่มนั้น** (ไม่นับผิด) + health แดง |
- ผล: env ถูกแก้ผิด → ตรวจเจอตั้งแต่ request แรก ก่อนจะมีการ verify PIN ใด ๆ

#### 7.3 หลายเวอร์ชันพร้อมกัน + หมุนเปลี่ยนโดยไม่ต้อง reset ใคร
- hash ใหม่ (สมัคร, ตั้ง/เปลี่ยน PIN) ใช้ `PIN_PEPPER_CURRENT_VERSION` เสมอ · verify ใช้เวอร์ชันของแถว
- login สำเร็จด้วยเวอร์ชันเก่า → rehash ด้วยเวอร์ชันปัจจุบันใน request เดียวกัน (อัปเดต `pin_hash` + `pin_pepper_version`)
- ขั้นตอนหมุน (ทำเมื่อสงสัยว่า pepper รั่ว หรือรอบดูแลปกติ): เพิ่ม `PIN_PEPPER_V2` → ตั้ง `CURRENT=2` → deploy → รอจนหน้า super admin แสดงจำนวนผู้ใช้ v1 = 0 (หรือคนที่ไม่ได้ล็อกอินนาน ให้ใช้ flow reset ปกติ) → **จึงลบ `PIN_PEPPER_V1`** · ห้ามลบเวอร์ชันที่ยังมีผู้ใช้ (หน้า admin + health แสดงจำนวนต่อเวอร์ชัน)
- หมายเหตุ: แทนชื่อ env เดิม `PIN_PEPPER`/`PIN_PEPPER_VERSION`/`PIN_PEPPER_PREVIOUS` ในฉบับแรก

#### 7.4 ข้อกำหนดการสำรอง (OPS เขียนเป็นขั้นตอนใน `docs/OPERATIONS.md` ช่วง R0 — Architect ระบุแค่ข้อกำหนด)
- สร้าง pepper **บนเครื่องของ boss** ด้วยตัวสุ่มที่ปลอดภัย (เช่น `openssl rand -base64 32`) — ไม่ให้ agent/CI สร้างแทน และไม่พิมพ์ค่าออกในแชท
- **ที่เก็บที่อนุญาต (ต้องมีครบ 2 ที่ นอกเหนือจาก Vercel)**:
  1. ตัวจัดการรหัสผ่านของ boss (เช่น 1Password / Bitwarden) — รายการชื่อ `maewmeet PIN_PEPPER_V<n> (production)` พร้อม fingerprint 8 ตัวแรก
  2. สำเนาออฟไลน์ที่ไม่ผูกกับบัญชีเดียวกับข้อ 1: กระดาษเก็บในที่ปลอดภัย หรือไฟล์เข้ารหัสใน USB/ฮาร์ดดิสก์ที่ไม่ซิงก์คลาวด์
- **ที่ห้ามเก็บ**: git repo ทุกรูปแบบ (รวม `.env` ที่หลุด commit, issue, PR, wiki) · แชททุกช่องทาง (LINE, Discord, บทสนทนากับ AI agent) · อีเมล · โน้ตที่ไม่เข้ารหัส/แอปโน้ตซิงก์คลาวด์ · ภาพหน้าจอ · ไฟล์ log/ข้อความ error
- ใน Vercel ตั้งเป็นชนิด **Secret** เฉพาะ environment **Production** · Preview ใช้ฐาน Turso แยก และ pepper **คนละค่า** (ไม่ต้องสำรองค่า preview)
- **ซ้อมกู้คืน** 1 ครั้งตอน R0 จบ และหลังหมุนทุกครั้ง: คำนวณ fingerprint จากสำเนาทั้ง 2 ที่ (สคริปต์ `scripts/pepper-fingerprint.ts` ของ OPS อ่านค่าจาก stdin ไม่รับเป็น argument) แล้วเทียบกับ 8 ตัวแรกในหน้า super admin — ต้องตรงทั้งคู่
- **ทางกู้ฉุกเฉินของ super admin** (break-glass): ถ้า pepper หายจริง super admin เองก็ล็อกอินไม่ได้และอนุมัติ reset ให้ใครไม่ได้ → OPS ต้องมีสคริปต์ `scripts/admin-reset-pin.ts` ที่ boss รันบนเครื่องตัวเองด้วย `TURSO_AUTH_TOKEN` เพื่อตั้ง `must_change_pin` + เปิดคำขอ reset ที่ approved ให้บัญชี super admin (ผูกเครื่องตาม §6 ด้วย token ที่สคริปต์พิมพ์ให้) แล้วผู้ใช้อื่นใช้ flow reset ปกติ · ใช้ได้เฉพาะเมื่อ pepper หายจริงหลังยืนยันว่าไม่มีสำเนาเหลือ

#### 7.5 ตัวเลข: ถ้าไม่มี pepper ฐานรั่วแล้วเดา PIN ได้เร็วแค่ไหน (วัดจริง)
- วัดบนเครื่อง dev ของ agent: Intel Xeon @ 2.80GHz, **ใช้ 1 คอร์**, Node 22, `@node-rs/argon2` 2.2.2 (argon2id, m = 19456 KiB, t = 2, p = 1 — พารามิเตอร์เดียวกับ §1) → **12.21 ms ต่อการ verify 1 ครั้ง** (เฉลี่ย 50 ครั้งหลัง warm-up; `crypto.argon2` ของ Node 24 เป็นอัลกอริทึมเดียวกัน ความเร็วระดับเดียวกัน — R1 วัดซ้ำบน Vercel)
- ไล่ครบ 1,000,000 PIN = 12,210 วินาที ≈ **3.4 ชม. ต่อผู้ใช้ 1 คน** (เฉลี่ยเจอครึ่งทาง ≈ 1.7 ชม.) ด้วยคอร์เดียว
- ผู้ใช้ 100 คน ≈ 339 ชม. คอร์เดียว ≈ **21 ชม. บนเครื่อง 16 คอร์ทั่วไป** — ไม่ต้องใช้ GPU และ lockout/throttle ไม่ช่วยเลยเพราะเดาแบบออฟไลน์
- ทำ argon2 ให้หนักขึ้นก็ไม่พอ: หนักขึ้น 10 เท่า (≈ 120 ms/ครั้ง ซึ่งเริ่มกิน Active CPU ของ Hobby) ก็ยังเดาได้ใน ~34 ชม./คน คอร์เดียว — พื้นที่ 10^6 เล็กเกินกว่า hash ช้าอย่างเดียวจะกันได้
- มี pepper 256 บิตที่อยู่นอกฐาน: ฐานรั่วอย่างเดียว **เดาไม่ได้** (ต้องเดา pepper ก่อน ซึ่งเป็นไปไม่ได้ในทางปฏิบัติ) · pepper ช่วยไม่ได้เฉพาะกรณีคนร้ายได้ทั้งฐาน **และ** env ของ Vercel ไปพร้อมกัน
- **ข้อสรุป: คุ้ม** — ค่าใช้จ่ายคือดูแลความลับ 1 ค่า ซึ่ง 7.1–7.4 ทำให้การหายไม่พังเงียบและกู้ได้ · ส่วนการไม่มี pepper แลกกับ "ฐานรั่ว = PIN ทุกคนรั่วภายในวันเดียว"

## Alternatives considered
| ทางเลือก | ทำไมไม่เลือก |
|---|---|
| Better Auth 1.7.x (username plugin) | ยังดูแลอยู่และรองรับ username+password แต่เอกสาร plugin ไม่ครอบ lockout ต่อ username แบบถอยหลัง, ไม่มีแนวคิด `must_change_pin` / `123456` ผูกเครื่อง / reset ที่ admin อนุมัติ → ต้องดัดแปลงหนักบน schema ของเขา (user/account/session/verification) จนได้ความซับซ้อนมากกว่าเขียน session ~150 บรรทัดเอง |
| Lucia v3 | [ถูก deprecate มีนาคม 2025](https://github.com/lucia-auth/lucia) — ผู้เขียนแนะนำให้เขียน session เองตามไฟล์ตัวอย่างแทน (ซึ่งคือสิ่งที่ ADR นี้ทำ) |
| Auth.js Credentials provider | ออกแบบให้ใช้ OAuth เป็นหลัก credentials ถูกจำกัดฟีเจอร์ (session แบบ JWT), ไม่มี lockout ในตัว |
| bcrypt | ไม่ memory-hard · จำกัดความยาว input 72 ไบต์ · OWASP แนะนำ argon2id ก่อน |
| `@node-rs/argon2` เป็นตัวหลัก | ดีและดูแลอยู่ แต่เป็น native addon ที่ต้องพึ่ง prebuilt ตาม platform — ใช้ built-in ได้ก็ไม่ต้องเพิ่ม dependency (เก็บเป็น fallback) |
| Rate limit ด้วย Upstash Redis | เพิ่มบริการภายนอก + ความลับ + ต้นทุน; ปริมาณหลักร้อยคน Turso UPSERT พอ |
| ไม่ผูก `123456` กับอุปกรณ์ | ง่ายกว่า แต่คงช่องโหว่ 24 ชม. ที่ PRD §10 ชี้ไว้ทั้งก้อน |
| **ไม่ใช้ pepper เลย** (ทบทวนรอบ 2) | ง่ายที่สุดและไม่มีความลับให้หาย แต่จากที่วัด (§7.5) ฐานรั่ว = เดา PIN ได้ ≤ 3.4 ชม./คน ด้วยคอร์เดียว, ทุกคนในกลุ่ม 100 คนภายใน ~21 ชม. บน 16 คอร์ — ความเสี่ยงหลักของ PIN 6 หลักที่ PRD §10 ยอมรับไว้โดยมีเงื่อนไขว่าต้องมี pepper |
| เก็บ pepper ใน KMS/secret manager ภายนอก | ปลอดภัยกว่าในเชิงหลักการ แต่เพิ่มบริการ/ต้นทุน/latency และยังเป็นความลับที่ต้องดูแลอยู่ดี — env ชนิด Secret ของ Vercel + สำรอง 2 ที่ + fingerprint พอสำหรับขนาดนี้ |
| ให้แอปสร้าง pepper เองถ้าไม่พบ | สะดวกตอนติดตั้ง แต่ถ้า env หายจะ**สร้างค่าใหม่เงียบ ๆ** แล้วทุกคนล็อกอินไม่ได้ + โดนนับผิดจนล็อก — ห้ามเด็ดขาด (§7.1) |
| ให้ `123456` ใช้ซ้ำได้ภายใน 24 ชม. | สะดวกกรณีปิดแอปก่อนตั้ง PIN แต่ขัด PRD U2 ("ล็อกอินด้วย 123456 สำเร็จ = used") · session ที่ได้ยังอยู่ 60 วัน จึงตั้ง PIN ต่อได้ |

## Consequences
- + ฐานรั่วอย่างเดียวแกะ PIN ไม่ได้ (ไม่มี pepper) · token session รั่วจากฐานไม่ได้ (เก็บ hash)
- + ไม่มีบริการภายนอกเพิ่ม · ไม่มี native addon
- − ต้องดูแล pepper: ตั้งผิด → login ปิด (ไม่มีใครเสียหาย) จนกว่าจะใส่ค่าถูก · หายทั้ง 3 ที่ (Vercel + ตัวจัดการรหัสผ่าน + ออฟไลน์) จึงจะต้อง reset ทุกคนผ่านทางกู้ฉุกเฉิน §7.4
- − มีสคริปต์ break-glass ที่เข้าถึง DB ตรง (ต้องเก็บ `TURSO_AUTH_TOKEN` อย่างระวัง)
- − ผู้รู้ username ทำให้เจ้าของโดนล็อกได้ (ยอมรับ + มีปุ่มปลดล็อก)
- − login ใช้ CPU/หน่วยความจำ (19 MiB) ต่อครั้ง — ต้องจับตา Active CPU ของ Hobby
- − หลัง approve PIN เดิมใช้ไม่ได้ ถ้าปล่อยเกิน 24 ชม. ต้องขอใหม่ (ตาม PRD U2)

## Test requirements
อ้าง [PRD U1–U3, U12, U13, §8 ข้อ 3](../prd/PRD.md) — เทสต์ integration ใช้ DB จริง (libSQL `file:`) และนาฬิกาจำลอง (inject `now`)
1. **U1** username ซ้ำต่างตัวพิมพ์ → `USERNAME_TAKEN` · PIN ไม่ใช่ 6 หลัก → `PIN_FORMAT` · PIN ต้องห้ามทั้ง 20 ตัว → `PIN_TOO_WEAK` (เทสต์วนครบทุกตัว)
2. **U1** login ผิดด้วย username ที่ไม่มี vs มีแต่ PIN ผิด → status, body, header เหมือนกันทุกไบต์ (ยกเว้น request id) และ lockout schedule เหมือนกัน
3. **U1** lockout: ผิด 4 ครั้ง `attemptsRemaining` = 4,3,2,1 · ครั้งที่ 5 → ล็อก 60 วินาที · PIN ถูกระหว่างล็อก → ยัง `LOGIN_LOCKED` · ครบเวลาแล้วผิดอีก → 120 วินาที · ตาราง 2^(f−5) ถึงเพดาน 24 ชม. · สำเร็จแล้วรีเซ็ต · super admin unlock แล้วเข้าได้ทันที
4. **U1** IP: 20 ครั้งผิดจาก IP เดียวใน 15 นาที (ต่าง username) → ครั้งที่ 21 `RATE_LIMITED` · สมัครครั้งที่ 6 ใน 1 ชม. → `RATE_LIMITED`
5. **U1** session: cookie มี `HttpOnly`,`Secure`,`SameSite=Lax`; DB ไม่มี token ดิบ (ค้นหา token ในทุกตารางไม่เจอ); หมดอายุ 60 วัน; sliding ต่ออายุเมื่อเหลือ < 30 วัน; logout-all ลบทุกแถว
6. **U2** ตอบเหมือนกันไม่ว่า username มีหรือไม่ (รวม `Set-Cookie: mm_reset`) · ขอซ้ำระหว่าง pending ไม่สร้างแถวใหม่ (นับแถว = 1)
7. **U2** ระหว่าง pending: PIN เดิมเข้าได้ และหลังเข้าได้คำขอเป็น `cancelled` + มี notification · `123456` ระหว่าง pending → `INVALID_CREDENTIALS` และนับ throttle
8. **U2/D3** approve แล้ว: `123456` + cookie ถูกเครื่อง → เข้าได้, `must_change_pin=1`, คำขอ `used` · `123456` **ไม่มี cookie / cookie เครื่องอื่น** → `INVALID_CREDENTIALS` · PIN เดิมหลัง approve → ผิด · เลื่อนนาฬิกา 24 ชม. + 1 วินาที → `123456` ผิด และคำขอเป็น `expired` (ไม่พึ่ง cron) · ใช้ `123456` ครั้งที่สอง → ผิด
9. **U2** approve/reject ลง `audit_log` ครบ (actor, target, เวลา) · ผู้ที่ไม่ใช่ super admin เรียก → 403 (เมทริกซ์ ADR 0003)
10. **U3** ระหว่าง `must_change_pin` ทุก endpoint ยกเว้น `POST /api/auth/pin` และ `POST /api/auth/logout` → 403 `PIN_CHANGE_REQUIRED` (วนจาก manifest ของ route ทั้งหมดอัตโนมัติ) · ตั้ง `123456` → `PIN_TOO_WEAK` · ตั้งสำเร็จ → session อื่นถูกลบ
11. **U13** เปลี่ยน PIN ต้องใส่ PIN เดิมถูก; ผิดนับ throttle
12. ไม่มี PIN/hash/token/pepper ใน log และ response: เทสต์จับ `console.*`/logger ระหว่าง flow ทั้งหมดแล้วค้นหาสตริง PIN, token, `$argon2id$` ไม่เจอ (PROCESS เช็กลิสต์ Auth)
13. Pepper rotation (§7.3): ผู้ใช้ hash ด้วย V1 → ตั้ง `PIN_PEPPER_V2` + `CURRENT=2` → login สำเร็จ, `pin_pepper_version` = 2, verify ด้วย V2 ผ่าน · ผู้ใช้ใหม่ได้ V2 ทันที · ไม่มีใครต้อง reset
14. Pepper fail-closed (§7.1): ไม่มี `PIN_PEPPER_CURRENT_VERSION` / ไม่มี `PIN_PEPPER_V<CURRENT>` / ค่าว่าง / base64 สั้นกว่า 32 ไบต์ → `/api/health` 503 · login/signup/เปลี่ยน PIN → 503 `AUTH_MAINTENANCE` · **`login_throttle` ไม่เปลี่ยน** (นับแถวก่อน-หลัง) · `/api/groups` ด้วย session เดิมยัง 200 · ไม่มีการเขียน `pepper_fingerprint` แถวใหม่
15. Fingerprint (§7.2): DB มี fingerprint ของ V1 → ตั้ง env V1 เป็นค่าอื่น → login ด้วย PIN ถูก → 503 `AUTH_MAINTENANCE` (ไม่ใช่ `INVALID_CREDENTIALS`) และ throttle ไม่ขยับ · ใส่ค่าถูกคืน → login ได้ทันที · DB ไม่มีแถว V1 แต่มีผู้ใช้ V1 → fail closed · DB ว่าง + ไม่มีผู้ใช้ → insert fingerprint ครั้งแรก · เวอร์ชันเก่าถูกลบออกจาก env ทั้งที่ยังมีผู้ใช้ → เฉพาะผู้ใช้กลุ่มนั้นได้ `AUTH_MAINTENANCE`
16. ไม่มีโค้ดสร้าง pepper: เทสต์ค้น `src/**` ไม่มีการเรียก `randomBytes`/`getRandomValues` ในโมดูล env/pepper (lint rule หรือ grep test) และไม่มีค่า fallback ใน schema env
17. ค่า pepper และ fingerprint เต็มไม่อยู่ใน log/response/หน้า admin (หน้า admin แสดงแค่ 8 ตัวแรก)
18. E2E (PRD §8 ข้อ 3): ขอ → super admin อนุมัติ → เข้าด้วย `123456` (เครื่องเดิม) → ถูกพาไปหน้าตั้ง PIN → `123456` ใช้ไม่ได้อีก · และกรณีเกิน 24 ชม.
