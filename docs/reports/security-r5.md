# Security review — R5 (บัญชีของฉัน · หน้า super admin · audit log · /privacy)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-10-27 · `git diff 0a6d5c0..efaefef` (branch `r5`) · เทียบ R5_CONTRACT §2/§5/§6/§8, ADR 0003 (+Addendum R5), ADR 0006
- วิธี: อ่านโค้ด route/service/repo/serializer/UI ทั้งหมดของ R5 + PoC แบบ integration (handler จริง + libSQL ไฟล์จริง + migration จริง ผ่าน harness `tests/groups/harness`) ด้วย env แบบ CI (`.github/scripts/ci-env.sh`, Node 24.22.0) · ไฟล์ PoC อยู่นอก repo: `scratchpad/secr5/{a-admin,b-account,c-race}.test.ts` (รันชั่วคราวใต้ `tests/_secr5_tmp/` แล้วลบทิ้ง — ไม่ commit) · log ผลรันจริง: `scratchpad/secr5/log*.txt` · ไม่แก้ `src/`
- สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ดเท่านั้น

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 6 (L1–L6) |
| Info | 6 |

ไม่พบทางยกสิทธิ์เข้า `/api/admin/*`, ไม่พบ IDOR, ไม่พบข้อมูลอ่อนไหวรั่วใน response admin (pin_hash/pepper/note/busy/รายละเอียดนัด/พิกัด/locale/theme), ไม่พบ SQL/LIKE injection, PIN brute-force ผ่าน `/api/me/delete` ถูกจำกัดด้วยตัวนับเดียวกับ login, การลบบัญชีลบร่องรอยครบตามสัญญา และไม่มีทาง "ฟื้น" บัญชีที่ลบด้วย login/session/reset · ข้อพบทั้งหมดเป็นระดับต่ำ — ที่ควรแก้ก่อนสุดคือ **L1 (login แข่งกับการลบบัญชี → เหลือ session ของบัญชีที่ลบ และเครื่องนั้นติดล็อก login/สมัคร/ออกจากระบบไม่ได้)**

## Verdict ต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **R5-2 ลบบัญชี (ด้านความปลอดภัย)** | **PASS (มี L1)** | ✅ PIN ผิดนับ `u:<username>` ตัวเดียวกับ login (สลับเดาระหว่าง delete กับ login ได้รวม 5 ครั้งแล้วล็อก) · ✅ 20 คำขอขนานจาก 20 IP ด้วย session ที่ขโมย → `INVALID_CREDENTIALS` 4 + `LOGIN_LOCKED` 16, `failures=5` (ไม่มี verify เกินเพดาน) · ✅ SA → 403 ก่อนแตะ PIN · ✅ must_change_pin → 403 `PIN_CHANGE_REQUIRED` · ✅ suspended → 401 `ACCOUNT_SUSPENDED` · ✅ หลังลบ: session เดิม 401 ทั้ง GET/PATCH/delete ซ้ำ · login ด้วย username เดิม = ไบต์เดียวกับ username ที่ไม่เคยมี (`sameResponse`) · login ด้วย `deleted-<id>` = INVALID_CREDENTIALS · ขอ reset ให้ username เดิม = 202 แต่ไม่สร้างคำขอ (0 แถว) · สมัคร username เดิมได้ (201) และผู้สมัครใหม่เห็นกลุ่ม/แจ้งเตือน/busy = ว่าง · dump ทุกตารางไม่พบชื่อที่แสดง/note/title ของ busy เดิม · race โอน admin ↔ ลบ: 📖 ด่าน "ถือ admin" อยู่ใน WHERE ของ UPDATE แรกของธุรกรรม (`markUserDeletedGuarded`) — ถูกต้อง |
| **R5-3 สิทธิ์ admin** | **PASS** | ✅ เมทริกซ์ 7 endpoint × 5 actor: anonymous 401 · ผู้ใช้ทั่วไป/admin กลุ่ม 403 `FORBIDDEN` · SA ที่ must_change_pin 403 `PIN_CHANGE_REQUIRED` · SA ที่ suspended 401 `ACCOUNT_SUSPENDED` (ตาม §8 Errata ข้อ 1) · ไม่มีแถว audit `admin.*` และสถานะเป้าหมายไม่เปลี่ยนจากคำขอที่ถูกปฏิเสธ · 📖 หน้า `/admin/**` ใช้ `requireSuperAdmin()` (อ่าน `status` สด) → 404 |
| **R5-4 ระงับ/ปลดล็อก** | **PASS (มี L2, L3)** | ✅ suspend ตัวเอง / SA อื่น = 403 · ✅ suspend ลบ session ทันที (session เดิม → 401) · login PIN ถูก = `ACCOUNT_SUSPENDED`, PIN ผิด = `INVALID_CREDENTIALS` (ไม่เปิดช่องไล่ว่าใครถูกระงับ) · ✅ ซ้ำ = `changed:false` ไม่เขียน audit · ✅ id ไม่ใช่ uuid → 400, ไม่มี → 404 |
| **R5-5 ความเป็นส่วนตัวของ admin** | **PASS** | ✅ canary: busy (`CANARY_NOTE`, `CANARY_BUSY_TITLE`), นัด (`CANARY_APPT/DESC/PLACE`, พิกัด 13.7, map URL), locale=en/theme=dark, meta ปลอมใน audit (`note`, nested object) — ไม่ปรากฏใน 6 response ของ `/api/admin/*` เลย · รายละเอียดกลุ่มมีแค่ id/name/tz/createdAt/deletedAt/memberCount/openAppointmentCount/members{userId,username,displayName,role,joinedAt} · ทุก response `Cache-Control: private, no-store` |
| **R5-6 audit** | **PASS (มี L4)** | ✅ suspend เขียนแถว actor=SA จาก session, target ถูก, meta `{state, asSuperAdmin}` · 📖 suspend/unsuspend/unlock/group.view/user.delete เขียน audit ใน `inTx` เดียวกับการเปลี่ยน · ✅ `admin.audit.view` เปิด 3 ครั้งใน 10 นาที = 1 แถว · ✅ whitelist ตอนอ่าน: คีย์ไม่รู้จัก/ค่า object ถูกตัด, string ถูกตัดที่ 64 ตัว · ค่า `<img onerror>` ใน meta เป็นข้อความ React escape (📖 `AdminAudit.tsx` เรนเดอร์ใน `<dd>` เป็น text) · actor ปลอมไม่ได้ (มาจาก session เท่านั้น) |
| **R5-7 ค้นหา/แบ่งหน้า** | **PASS** | ✅ `q='%'` เจอเฉพาะชื่อที่มี `%` จริง, `'_'` เฉพาะชื่อที่มี `_`, `'\'` ว่าง, `' OR 1=1 --` ว่าง (bind parameter) · 41 ตัว / NFKC ขยายเกิน 40 (`㍿`×11, `ﷺ`×5) / 5000 ตัว → 400 · bidi → 400 · cursor เสีย/`c` ติดลบ/1e300/id ไม่ใช่ uuid/ยาว 600 → 400 · `limit` 0/-1/101/1e2/abc/0001/" 5" → 400, 100 → 200 · ตัวกรอง audit ผิดรูป/คีย์แปลก → 400 |
| **CSRF / origin** | **PASS** | ✅ suspend (ไม่มี body) ด้วย Origin อื่น → 403 `CSRF_REJECTED` · `text/plain` (Request ดิบ ไม่ผ่าน harness) → 403 · `PATCH /api/me` Origin `null` → 403 · `POST /api/me/delete` Origin อื่น → 403 · ✅ mass assignment `{isAdmin, username}` ใน PATCH /api/me → 400 `UNKNOWN_FIELD` |
| **rate limit** | **PASS** | ✅ rename ขนาน 25 ครั้ง → 200 ×10, 429 ×15 (`Retry-After` 75600) · 📖 admin write 60/10 นาที ผ่าน `takeUserSlot` (UPSERT ใน `serialized`) ก่อนธุรกรรม |
| **XSS / CSP** | **PASS** | 📖 ไม่มี `dangerouslySetInnerHTML`/`innerHTML` ในไฟล์ R5 · `href` สร้างจาก uuid ใน DB เท่านั้น (`/admin/groups/${id}`, `/groups/${id}/settings`) · ชื่อ `<script>…</script>` บันทึกเป็นข้อความดิบ (✅) และเรนเดอร์ผ่าน React · `next.config.ts` (CSP) ไม่อยู่ใน diff R5 · `/privacy` ไม่มีสคริปต์/สไตล์ inline ใหม่ และ `back` เป็นค่าคงที่ `/me`/`/login` (ไม่มี open redirect) |

## Findings

### L1 — Low · login แข่งกับการลบบัญชี → session ของบัญชีที่ลบค้างใน DB และเครื่องที่ถือ cookie นั้น login/สมัคร/ออกจากระบบไม่ได้ ✅
- **ที่มา**: `login()` (`src/lib/auth/services/login.ts`) อ่าน user → verify argon2 (ช้า) → `issueSession()` โดย **ไม่มีเงื่อนไขสถานะตอน INSERT session** · `deleteMe()` ลบ session ทั้งหมดในธุรกรรม แต่ session ที่ login สร้าง *หลัง* ธุรกรรมลบ commit จะรอด · `findSessionWithUser` ไม่กรอง `status='deleted'` · `can()` ขั้น 2 ปฏิเสธทุก action (รวม `auth.login`, `auth.signup`, `auth.logout` ที่เป็น public) ด้วย `AUTH_REQUIRED` เมื่อ actor เป็น user ที่ `status ≠ active` และ response 401 ไม่ล้างคุกกี้
- **ทำซ้ำ** (`c-race.test.ts`, `b-account.test.ts`): `Promise.all([client2.login(u, PIN), client1.POST /api/me/delete {pin}])` ×6 → login 200 ทั้ง 6 ครั้ง และเหลือ **session ของบัญชีที่ `status='deleted'` 3 แถว** · ใช้ cookie นั้นต่อ: `GET /api/auth/session` 401, `POST /api/auth/logout` **401 และแถว session ยังอยู่**, login บัญชีอื่นจากเครื่องเดียวกัน **401 AUTH_REQUIRED**, สมัครใหม่ **401 AUTH_REQUIRED**
- **ผลกระทบ**: ไม่ได้สิทธิ์เพิ่ม (actor ถูกปฏิเสธทุก action, หน้าเว็บ `getPageUser` คืน null) แต่ (ก) ขัด §2 ข้อ 2 "ลบ session ทั้งหมด" — แถวค้างอย่างน้อย 60 วัน และต่ออายุเองได้เรื่อย ๆ ถ้าเครื่องนั้นยังเรียก API (📖 `getActor` เรียก `touchSession` ก่อนส่ง actor ให้ `can()` ปฏิเสธ) (ข) เครื่องนั้นติดล็อกจนกว่าผู้ใช้จะล้างคุกกี้เอง (หน้า `/login` แสดงปกติแต่กดเข้าไม่ได้) — ต้องจังหวะพร้อมกันระดับร้อย ms จึงเป็น Low
- **แนวทาง** (ให้ Auth/Platform เลือก): `issueSession` ใช้ `INSERT … SELECT … WHERE EXISTS (user active-or-suspended)` หรือให้ `findSessionWithUser`/`getActor` ถือ session ของบัญชี `deleted` เป็น anonymous (และลบแถว) · ให้ `auth.logout`/route ที่ได้ `AUTH_REQUIRED` ล้างคุกกี้ session

### L2 — Low · login แข่งกับ suspend → session รอดการระงับ และกลับมาใช้ได้ทันทีหลัง unsuspend ✅
- **ที่มา**: เดียวกับ L1 — `suspendUser` ลบ session ในธุรกรรม แต่ login ที่ verify เสร็จหลังจากนั้นสร้าง session ใหม่ได้ (การเช็ก `live.status === 'suspended'` ใช้แถวที่อ่าน *ก่อน* verify)
- **ทำซ้ำ** (`c-race.test.ts`): `Promise.all([login(u), SA suspend u])` ×10 → session รอด 1 ครั้ง · หลัง `unsuspend` session นั้นเรียก `GET /api/groups` ได้ 200 โดยไม่ต้อง login ใหม่
- **ผลกระทบ**: ขัด "suspend = ลบ session ทั้งหมด (เด้งออกทันที)" ในกรณีขอบ · ผู้ถือ session ต้องรู้ PIN จริงอยู่แล้ว (login ใหม่หลัง unsuspend ได้อยู่ดี) จึงต่ำ แต่ถ้า SA ระงับเพราะ "เครื่องถูกขโมย" แล้ว unsuspend ให้เจ้าของ เครื่องที่ขโมยอาจยังมี session · **แนวทาง**: แก้จุดเดียวกับ L1 (INSERT session มีเงื่อนไข `status='active'`) หรือ unsuspend ลบ session ที่สร้างระหว่างถูกระงับ (`created_at >= suspended_at`)

### L3 — Low · SA unsuspend / unlock super admin คนอื่นได้ (ไม่สมมาตรกับกฎ "ห้ามระงับ SA อื่น") ✅
- `unsuspendUser` ไม่มีด่าน `target.isAdmin`/`target.id === me.id` (มีแค่ใน suspend) · ✅ boss2 ถูก ops ระงับด้วย SQL → boss `POST /api/admin/users/<boss2>/unsuspend` = 200 `changed:true` · unlock ของ SA อื่น = 200
- ผลกระทบ: การระงับ SA ทำได้ทาง SQL เท่านั้น (ตั้งใจให้เป็นการตัดสินของ boss/ops) แต่ SA อีกคนยกเลิกได้จากแอป — กรณี SA สองคนสมรู้กัน หรือ ops ระงับ SA ที่ถูกยึดบัญชีแล้ว SA อีกคน (หรือผู้ยึด session ของ SA อีกคน) ปลดคืน · มี audit `admin.user.suspend {state:'active'}` จึงตรวจย้อนได้ · **แนวทาง**: ให้ Auth ตัดสินว่า unsuspend SA = 403 เหมือน suspend (และบันทึกใน ADR 0003 Addendum) หรือรับเป็นความเสี่ยงยอมรับ

### L4 — Low · `GET /api/admin/groups/:gid` เขียน audit ทุกครั้ง: (ก) ปลอมแถว "SA เปิดดูกลุ่ม X" ได้ด้วยการนำทางข้ามไซต์ (ข) ไม่มีเพดาน → audit บวม ✅/📖
- (ก) คุกกี้ session เป็น `SameSite=Lax` (📖 `session.ts:52`) → การนำทางระดับบนสุดแบบ GET จากเว็บอื่น (ลิงก์/`window.open` ไปยัง `/api/admin/groups/<gid>`) แนบคุกกี้ → service เขียน `admin.group.view` actor = SA · CSRF guard ครอบเฉพาะ non-GET · ผู้โจมตีอ่านผลไม่ได้ (same-origin) แต่ทำให้ audit แสดงว่า SA เปิดดูกลุ่มที่ผู้โจมตีเลือก (เช่นกลุ่มของตัวเองเพื่อกล่าวหา) · R3 มีรูปแบบเดียวกันกับ `group.calendar.view` ของ SA
- (ข) ✅ เปิดรายละเอียด 5 ครั้ง = 5 แถว ไม่มี throttle (ต่างจาก `admin.audit.view`) — SA หรือผู้ถือ session SA ที่ถูกขโมยยิงวนได้ เผางบ row-writes (อ่านไม่มี rate limit — §2 "ไม่ทำ" R6)
- **แนวทาง**: ตรวจ `Sec-Fetch-Site`/`Sec-Fetch-Mode` (ปฏิเสธ `cross-site` + `navigate`) บน GET ที่มีผลข้างเคียงของ `/api/admin/*` และ/หรือ throttle `admin.group.view` ต่อ (SA, gid) แบบเดียวกับ `insertAuditViewThrottled`

### L5 — Low · เปลี่ยนชื่อที่แสดงเป็นป้ายของระบบได้ ("บัญชีที่ถูกลบ", "Deleted account") ✅
- ✅ `PATCH /api/me {displayName:'บัญชีที่ถูกลบ'}` = 200 (และ `'Deleted account'`, `'boss'`) · UI ใช้ข้อความเดียวกันแทนบัญชีที่ลบ (display_name `''`) → ผู้ใช้ปลอมตัวเป็น "บัญชีที่ถูกลบ" ในรายชื่อสมาชิก/RSVP ได้ ทำให้สมาชิกเข้าใจผิดว่าใครยังอยู่ในกลุ่ม · ประกอบกับ §7 ข้อ 1 (คืน username) — คนอื่นสมัคร username เดิมแล้วตั้งชื่อเดิมได้ (ความเสี่ยงยอมรับแล้ว)
- **แนวทาง**: สงวนป้าย "บัญชีที่ถูกลบ"/"Deleted account" ใน `name-rules` (ทั้งสมัครและเปลี่ยนชื่อ) หรือให้ UI แสดงบัญชีที่ลบด้วยสไตล์ที่ผู้ใช้ปลอมไม่ได้ (ไอคอน/ตัวเอียง) · การปลอมเป็นชื่อ SA เป็นเรื่องเดิมตั้งแต่สมัคร — ไม่นับ

### L6 — Low · ลบบัญชีที่ถูกระงับไม่ได้ทั้งในแอปและด้วย SQL ของ OPERATIONS I3 (ไม่มีอะไรเกิดขึ้นแบบเงียบ) 📖
- ในแอป: ผู้ถูกระงับเรียก `/api/me/delete` ได้ 401 `ACCOUNT_SUSPENDED` (✅) · SQL I3.2 มีเงื่อนไข `status = 'active'` ทุกคำสั่ง → กับบัญชี `suspended` ทุกคำสั่งได้ 0 แถว และ I3.3 บอกว่า "จบเงียบ ๆ ไม่มี error" ทั้งที่ OPERATIONS I3 เองแนะนำ "ใช้ระงับก่อนเสมอ … ลบด้วยมือเฉพาะเมื่อ boss ตัดสิน" · I3.4 จะจับได้ว่าไม่สำเร็จ แต่ไม่มีขั้นตอนทางออก
- ผลกระทบ: บัญชีที่ใช้ผิดและถูกระงับ ลบ/คืน username ไม่ได้ตามคู่มือ (ข้อมูล busy/ชื่อยังอยู่) · **แนวทาง** (OPS): เพิ่มขั้น "unsuspend ใน `/admin/users` ก่อน แล้วรัน I3 ทันที" หรือให้ SQL ยอม `status IN ('active','suspended')`

## Info
1. **คำเชิญตรงแข่งกับการลบบัญชี** 📖 — `createDirectInvite` ตรวจ `invitee.status === 'active'` นอกธุรกรรม แล้ว `insertDirectInvite` ไม่มีเงื่อนไขสถานะผู้รับ (ต่างจาก `joinGroupWithCode`/`insertMemberIfRoom` ที่ R5 เพิ่ม `EXISTS user active`) → อาจเหลือคำเชิญ active + แจ้งเตือนถึงบัญชีที่ลบ · ✅ ลองแข่ง 6 ครั้ง ไม่เกิด (0 แถว) · ผลกระทบแค่ร่องรอยเล็ก (ผู้รับใช้ไม่ได้) — แนะนำเพิ่ม `EXISTS` เดียวกันใน INSERT เพื่อความสม่ำเสมอ
2. **ร่องรอยที่ยังเหลือหลังลบ** ✅ — `pin_reset_request` (สถานะ `cancelled` พร้อม `requester_ua`/country), `rate_limit_bucket` คีย์ที่มี user id (`me:rename:<id>`, `redeem:u:<id>`), `user.locale/theme/pin_pepper_version/created_at` · สอดคล้องกับ /privacy "คำขอ reset/audit เก็บไว้" แต่หัวข้อ "ลบ/ล้าง" เขียนว่า "pending PIN reset requests" — จริง ๆ คือเปลี่ยนสถานะ ไม่ได้ลบ (QA/UX ปรับถ้อยคำ) · /privacy เขียนว่านัดแสดงเป็นสร้างโดย "Deleted account" แต่ §8 Errata ข้อ 2 ใช้ "อดีตสมาชิกหรือบัญชีที่ถูกลบ"
3. **`admin.audit.view` throttle** — การค้นแบบกรองภายใน 10 นาทีหลังเปิดครั้งแรกไม่ถูกบันทึก (✅ แถวเดียว `filtered:false` หลังเปิด 1 ครั้ง + กรอง 2 ครั้ง) — ตรงตามสัญญา แต่ทำให้ audit ไม่บอกว่า SA ค้นใคร · ยอมรับได้
4. **admin กลุ่มที่ถูกระงับ** 📖 — SA ระงับผู้ถือ role admin ของกลุ่มได้ และโอน admin ให้สมาชิกที่ถูกระงับได้ → กลุ่มมี admin ที่ทำอะไรไม่ได้จนกว่า SA จะโอน · ตรงกับ §7 ข้อ 2 (ไม่ถอดสมาชิก) — บันทึกไว้ให้ OPS รู้
5. **409 `ADMIN_TRANSFER_REQUIRED` ตอบก่อนตรวจ PIN** ✅ — ผู้ถือ session (แม้ไม่รู้ PIN) เห็นรายชื่อกลุ่มที่ตัวเองเป็น admin — ข้อมูลเดียวกับที่ `GET /api/groups` ให้อยู่แล้ว ไม่นับเป็นรั่ว · ชื่อกลุ่มผ่าน `sanitizeDisplayText` และ UI เรนเดอร์เป็น text
6. **ค้นหา admin ไม่มี rate limit อ่าน** — `display_name LIKE '%q%'` สแกนทั้งตาราง (SA-only, q ≤ 40, escape แล้ว ไม่มี pattern ซับซ้อน) — ยอมรับตาม §2 "ไม่ทำ: rate limit แบบ global/อ่าน (R6)"

## ความเสี่ยงที่ยอมรับ (ตามสัญญา — ไม่นับเป็นข้อพบ)
- คืน username หลังลบ → คนอื่นสมัครชื่อเดิมแล้วสวมรอยในวงเพื่อนได้ (§7 ข้อ 1) · ✅ ยืนยันว่าผู้สมัครใหม่ไม่ได้ข้อมูล/สิทธิ์/ตัวนับล็อกของเจ้าของเดิม (ทุกอย่างผูก user id)
- การระงับไม่ถอดสมาชิกออกจากกลุ่ม (§7 ข้อ 2) · ไม่มีการกู้บัญชี/กลุ่ม (§7 ข้อ 3)
- `ACCOUNT_SUSPENDED` เป็น 401 (§8 Errata ข้อ 1)
- CSP มี `'unsafe-inline'` ใน script-src/style-src (ตั้งแต่ R0 — ไม่เปลี่ยนใน R5)
- ไม่มี rate limit อ่านของหน้า admin (R6)

## สิ่งที่ไม่ได้ตรวจ
- ไม่ได้รัน `next build`/`next start` + เบราว์เซอร์จริงในรอบนี้ (ตรวจ header/CSP/HTML จากโค้ดและ config; ทดสอบ API ผ่าน handler จริงแทน) · ไม่ได้รัน e2e ของทีม
