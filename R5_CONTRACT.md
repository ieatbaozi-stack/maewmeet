# R5_CONTRACT.md — บัญชีของฉัน (U13) + หน้า super admin เต็ม (U12) + audit log + ประกาศความเป็นส่วนตัว

> ผู้เขียน: Lead · 2026-10-26 · สถานะ: boss สั่ง "ทำต่อได้เลย" หลัง R4B merge = ถือว่าเห็นชอบ (แย้งได้ตลอด)
> อ้างอิง: [PRD U12, U13, D8, §3 กติกา super admin](docs/prd/PRD.md) · [ADR 0002](docs/adr/0002-auth-pin.md) · [ADR 0003 RBAC](docs/adr/0003-rbac.md) · R1 (pin change, logout-all, admin reset) ทำแล้ว
> ข้อเสนอเลขเวอร์ชัน: **v0.7.0**

## 1. เป้าหมาย
ผู้ใช้จัดการบัญชีตัวเองได้ครบ (เปลี่ยนชื่อ, ลบบัญชี, อ่านประกาศความเป็นส่วนตัว) และ super admin มีหน้าดูแลระบบครบ (ผู้ใช้, กลุ่ม, audit log) โดยทุกการกระทำของ super admin ต่อคนอื่นถูกบันทึก และไม่เปิดเผยข้อมูลส่วนตัว (busy/นัด) ของกลุ่ม

## 2. ขอบเขต
**มีแล้ว (ไม่ทำซ้ำ แค่ตรวจว่ายังผ่าน)**: เปลี่ยน PIN (ต้องใส่ PIN เดิม) · ออกจากระบบ/ทุกเครื่อง · อนุมัติ/ปฏิเสธ reset · โอน admin และลบกลุ่ม (`/api/groups/:gid/transfer-admin`, `DELETE /api/groups/:gid` — super admin ทำได้และลง audit อยู่แล้ว)

**ทำ**
1. **เปลี่ยนชื่อที่แสดง** `PATCH /api/me` `{displayName}` (action `self.update`) — ใช้ `name-rules` ชุดเดียวกับสมัคร (1–40, NFC, ห้ามตัวควบคุม/bidi/zero-width) · จำกัด 10 ครั้ง/วัน/ผู้ใช้ (ตอบ 429 `RATE_LIMITED`) · ไม่ audit (เรื่องของตัวเอง) · ชื่อใหม่เห็นทันทีในกลุ่ม/นัด/RSVP (ทุกที่ join จาก `user.display_name` อยู่แล้ว — เทสต์ยืนยัน)
2. **ลบบัญชี** `POST /api/me/delete` `{pin}` (action `self.delete`):
   - ต้องใส่ PIN ปัจจุบัน — ผิดนับเข้า login throttle เดียวกับ login (กันเดา PIN จาก session ที่ถูกขโมย) · must_change_pin → 403 ตามเดิม
   - ถือ admin ของกลุ่มที่ยังไม่ถูกลบ → 409 `ADMIN_TRANSFER_REQUIRED` พร้อม `groups:[{id,name}]` (เฉพาะกลุ่มที่ผู้ใช้เป็น admin) · ไม่มีสถานะครึ่งทาง
   - super admin ลบบัญชีตัวเองผ่านแอปไม่ได้ (403 `FORBIDDEN`) — ต้องทำผ่าน SQL (กันระบบไม่มี super admin)
   - transaction เดียว: ลบ session ทั้งหมด · ออกจากทุกกลุ่ม (ลบ `group_member`) · ลบ busy_block ทั้งหมด · ลบ appointment_rsvp และ notification ของตัวเอง · ยกเลิกคำเชิญที่ผู้ใช้สร้างและยังไม่ใช้ (`revoked`) · ปฏิเสธ/ปิดคำเชิญตรงที่ส่งถึงผู้ใช้ · ยกเลิกคำขอ reset ที่ค้าง · `user.status='deleted'`, `deleted_at`, `pin_hash=NULL`, `display_name=''` (UI แสดง "บัญชีที่ถูกลบ"), `username/username_normalized = 'deleted-'+id` (คืนชื่อผู้ใช้เดิมให้คนอื่นสมัครได้) · นัดที่ผู้ใช้สร้างยังอยู่ (ผู้สร้างแสดงเป็น "บัญชีที่ถูกลบ") · audit `user.delete` (actor=ตัวเอง, meta ไม่มีชื่อ/PIN)
   - ลบแล้ว login ไม่ได้ (ตอบเหมือน "ไม่พบ/PIN ผิด" ไม่บอกว่าถูกลบ) · ลบซ้ำ/ใช้ session เก่า → 401
3. **หน้า super admin** (ทุก endpoint action `admin.*`, `isSuperAdminOnly`; ผู้ใช้ทั่วไป → 403 และหน้าเว็บ → redirect/404 ตามแบบเดิมของ `/admin/pin-resets`):
   - `GET /api/admin/users?q=&cursor=` — ค้นหา username (prefix, normalized) หรือชื่อที่แสดง (contains) · `q` ≤ 40 ตัว, escape `%_\` · หน้าละ 30 · cursor = (createdAt,id) · ฟิลด์: id, username, displayName, status, isAdmin, createdAt, groupCount, locked(bool + lockedUntil), hasOpenReset · **ไม่คืน** pin_hash/pepper/locale/theme
   - `POST /api/admin/users/:id/suspend` · `POST /api/admin/users/:id/unsuspend` (ทั้งคู่ action `admin.user.suspend`): suspend = status `suspended` + ลบ session ทั้งหมด (เด้งออกทันที) · ห้ามระงับตัวเอง และห้ามระงับ super admin คนอื่น (409 `CONFLICT`/`FORBIDDEN` ให้ Auth เลือกและบันทึก) · ผู้ถูกระงับเห็น `ACCOUNT_SUSPENDED` (มีแล้วในด่าน RBAC) · สมาชิกยังอยู่ในกลุ่ม (ไม่ซ่อนจากรายชื่อ — บันทึกเป็นข้อสังเกต) · ผู้ถูกลบ (deleted) ระงับ/คืนไม่ได้ → 404
   - `POST /api/admin/users/:id/unlock` (action `admin.user.unlock`): ล้าง login throttle ของผู้ใช้นั้น (key ตาม `login-throttle`) — ไม่แตะ PIN/สถานะ · ผู้ถูกลบ → 404
   - `GET /api/admin/groups?q=&status=active|deleted|all&cursor=` — ชื่อกลุ่ม contains · หน้าละ 30 · ฟิลด์: id, name, adminUsername, memberCount, createdAt, deletedAt
   - `GET /api/admin/groups/:gid` — รายละเอียดเพื่อดูแล: ชื่อ, tz, สมาชิก (username, displayName, role, joinedAt), จำนวนนัดที่ยังเปิด · **ไม่คืน** busy, ชื่อ/รายละเอียดนัด, ตำแหน่ง, หมายเหตุ (super admin ไม่ใช่สมาชิก — ADR 0006) · เขียน audit `admin.group.view` ทุกครั้งที่เปิดรายละเอียด (ไม่ audit การเปิดรายการ)
   - โอน admin / ลบกลุ่ม: ใช้ endpoint กลุ่มเดิม (ไม่สร้างซ้ำ) — เทสต์ยืนยันว่า super admin ที่ไม่ใช่สมาชิกทำได้และมี audit actor=super admin · **ไม่มีการกู้กลุ่มที่ลบ** (นอก PRD → R6)
   - `GET /api/admin/audit?actor=&action=&targetType=&targetId=&before=&limit=` — ใหม่→เก่า, `limit` ≤100 (ดีฟอลต์ 50), `before` = cursor (createdAt,id) · แต่ละแถว: id, createdAt, action, actor (id+username หรือ null=ระบบ), targetType, targetId, groupId, meta (**whitelist ต่อ action** — คีย์ที่ไม่รู้จักถูกตัดทิ้ง; repo ปฏิเสธคีย์ต้องห้ามตอนเขียนอยู่แล้ว) · การเปิดดู audit เขียน `admin.audit.view` (ไม่เกิน 1 แถว/10 นาที/ผู้ใช้ เพื่อไม่ให้ audit บวมจากการรีเฟรช)
   - ทุก endpoint admin เขียนมีตัวจำกัดอัตรา 60 ครั้ง/10 นาที/ผู้ใช้ · ตอบ `Cache-Control: no-store`
4. **หน้า UI**: `/admin` (สรุป: คำขอ reset ค้าง, ลิงก์ผู้ใช้/กลุ่ม/audit) · `/admin/users` · `/admin/groups` · `/admin/groups/[gid]` · `/admin/audit` — มือถือเป็นหลัก (การ์ดแทนตาราง ≤ 768px), TH/EN, ธีมสว่าง/มืด, ปุ่มทำลายล้าง (ระงับ/ลบกลุ่ม/โอน) ต้องยืนยันใน Sheet และบอกผลที่ตามมา · หน้า "ฉัน": เมนู "เปลี่ยนชื่อที่แสดง", "ลบบัญชี" (Sheet: อธิบายสิ่งที่จะหาย + ใส่ PIN; ถ้าเป็น admin กลุ่มใด แสดงรายชื่อกลุ่มที่ต้องโอนก่อนพร้อมลิงก์), "ความเป็นส่วนตัว", ลิงก์ไป `/admin`
5. **ประกาศความเป็นส่วนตัว** `/privacy` (สาธารณะ, TH/EN, ลิงก์จากหน้า login และหน้า "ฉัน"): เก็บอะไร (username, ชื่อที่แสดง, PIN แบบแฮช, วัน busy, นัด, cookie ภาษา/ธีม/เซสชัน) · ใครเห็นอะไร (busy: เจ้าของเห็นหมด, สมาชิกเห็นตามโหมดที่เจ้าของเลือก, หมายเหตุเห็นเฉพาะเจ้าของ) · ค้นหาสถานที่ส่งข้อความค้นหาไป OpenStreetMap/Nominatim ผ่านเซิร์ฟเวอร์เรา · แผนที่โหลดภาพจาก OSM (IP ผู้ใช้ถึง OSM) · ไม่มีโฆษณา/ติดตาม · ระยะเก็บ (busy/แจ้งเตือน เก่ากว่า 90 วันถูกลบ, คำขอ/audit เก็บไว้เพื่อความปลอดภัย) · วิธีลบบัญชีและสิ่งที่ลบ/ไม่ลบ · ติดต่อ super admin ผ่านกลุ่ม · **ข้อความนี้ไม่ใช่คำปรึกษากฎหมาย — boss ต้องอ่านและรับรองก่อนเปิดใช้จริง** (บันทึกใน §7)

**ไม่ทำ**: กู้กลุ่ม/บัญชีที่ลบ · ลบถาวร (hard purge) ของบัญชีที่ลบแล้ว · บังคับออกจากระบบเฉพาะบางเครื่อง · 2FA · export ข้อมูลส่วนตัว · อีเมล/LINE (R7) · rate limit แบบ global/อ่าน (R6)

## 3. ความรับผิดชอบไฟล์
| บทบาท | ไฟล์ |
|---|---|
| Platform (#5) | repos/services/serializers ใหม่ (`account`, `admin-users`, `admin-groups`, `admin-audit`), `src/app/api/{me,admin}/**`, cron/maintenance ถ้าจำเป็น, migration (ถ้า index ค้นหา/audit ขาด — เขียนแบบ additive) |
| Auth & Access (#8) | `src/lib/rbac/**` (ผูก action ใหม่: `self.update`, `self.delete`, `admin.*` กับ endpoint จริง; เพิ่ม `admin.group.view` ถ้าต้อง), `tests/rbac/**`, สแกน authorize-first ครอบ service ใหม่, ตัดสินกฎ ระงับ-ตัวเอง/SA |
| UX & Brand (#4) | `messages/*.json` ส่วน R5, wireframe หน้า admin + sheet ลบบัญชี + หน้า `/privacy` ร่างข้อความ TH/EN |
| Front-end (#6) | `src/app/(app)/{me,admin}/**`, `src/app/privacy/**`, `src/components/{account,admin}/**`, styles |
| TEST (#11) | `tests/e2e/**`, `tests/helpers/**`, canary (ไม่มี pin_hash/note/busy หลุดใน response admin), เมทริกซ์ HTTP |
| OPS (#10) | `docs/OPERATIONS.md` (วิธีตั้ง super admin ด้วย SQL, กรณีลืม PIN super admin, ขั้นตอนลบบัญชีด้วยมือถ้าจำเป็น) |
| Release (#15) | `CHANGELOG.md` |
| QA + Security | ตรวจอิสระ — เน้น §5 ข้อ R5-4/5/7 |

ทุก commit ใช้ `user.name` = ชื่อบทบาท

## 4. ลำดับ
```
ขั้น 1  UX: ดีไซน์ + messages + ร่าง /privacy   ‖ Platform: account + admin endpoints   ‖ Auth: RBAC + สแกน + เมทริกซ์
ขั้น 2  Front-end (หลัง UX + endpoint)           ‖ TEST: fixtures + canary + e2e
ขั้น 3  QA + Security อิสระ → แก้ → ตรวจซ้ำจุดที่แก้
ขั้น 4  Lead รันเกตซ้ำ (vitest ด้วย env แบบ CI + e2e เต็มชุด) → รายงาน → bundle → boss push/merge
```

## 5. เกณฑ์ผ่าน
| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R5-1 | เปลี่ยนชื่อ | validation เท่าสมัคร · เพดาน 10/วัน · ชื่อใหม่ขึ้นในรายชื่อสมาชิก/RSVP/นัด · ชื่อต้องห้าม (bidi/zero-width/ว่าง) ถูกปฏิเสธ |
| R5-2 | ลบบัญชี | PIN ผิด → ปฏิเสธ + นับ throttle · เป็น admin → 409 พร้อมรายชื่อกลุ่ม ไม่มีอะไรเปลี่ยน · สำเร็จ: ทุกข้อใน §2.2 ตรวจจาก DB · login/ session เดิมใช้ไม่ได้ · ชื่อผู้ใช้เดิมสมัครใหม่ได้ · นัดเดิมยังอยู่ ผู้สร้างแสดง "บัญชีที่ถูกลบ" · super admin ลบเองไม่ได้ |
| R5-3 | สิทธิ์ admin | เมทริกซ์ HTTP: anonymous 401 · ผู้ใช้ทั่วไป/สมาชิก/admin กลุ่ม 403 ทุก `/api/admin/*` · SA 200 · ผู้ที่ถูกระงับ 403 `ACCOUNT_SUSPENDED` แม้เป็น SA |
| R5-4 | ระงับ/ปลดล็อก | suspend ลบ session ทันที · login ถูกปฏิเสธด้วย `ACCOUNT_SUSPENDED` · unsuspend คืนได้ · ระงับตัวเอง/SA อื่นไม่ได้ · unlock ล้าง throttle และผู้ใช้ login ได้หลัง unlock · ทั้งหมดมี audit |
| R5-5 | ความเป็นส่วนตัวของ admin | canary: response `/api/admin/*` ไม่มี pin_hash/pepper/note/busy/ชื่อนัด/พิกัด · รายละเอียดกลุ่มมีเฉพาะชื่อ+role+จำนวน · SA เรียก `/api/groups/:gid/calendar|availability|appointments` ของกลุ่มที่ไม่ใช่สมาชิก → ผลตามเดิมของ R3–R4B (ไม่เปิดช่องใหม่) |
| R5-6 | audit | ทุก action ใน §2 ที่ต้อง audit มีแถวที่ actor/target ถูก ใน transaction เดียวกับการเปลี่ยน (rollback ทั้งก้อน) · `admin.audit.view` ลดความถี่ตามกติกา · meta ผ่าน whitelist · เรียงใหม่→เก่า, cursor ไม่ซ้ำ/ไม่ตกหล่นเมื่อ createdAt ซ้ำ · กรองได้ |
| R5-7 | ค้นหา/แบ่งหน้า | `q` ที่มี `%`/`_`/`\`/ยาวเกิน → ไม่ทำให้ LIKE กว้างผิดปกติ/ถูกปฏิเสธ · cursor เสีย → VALIDATION · ไม่มี N+1 (นับจำนวนด้วย query รวม) |
| R5-8 | UI | มือถือ 375/390/768 ไม่แตก (ไทย+อังกฤษ) · ทุกปุ่มทำลายล้างมี Sheet ยืนยัน · คีย์ TH/EN เท่ากัน · ไม่มีข้อความ hard-code · คอนทราสต์ ≥ 4.5:1 ทั้งสองธีม · a11y: โฟกัส/aria ของ Sheet · e2e: เปลี่ยนชื่อ, ลบบัญชี (รวมกรณีเป็น admin), SA ระงับ→ผู้ใช้เด้ง, ดู audit |
| R5-9 | /privacy | เข้าได้โดยไม่ล็อกอิน · TH/EN · ลิงก์จาก login และ "ฉัน" · ข้อความตรงกับพฤติกรรมจริง (QA ไล่ตรงทีละข้อ) |
| R5-10 | ไม่ถอยหลัง | เกต R0–R4B ยังผ่านทั้งหมด (vitest ด้วย env แบบ CI, e2e เต็มชุด, build, lint, typecheck, contrast) |

## 6. ความเสี่ยงที่เฝ้า
- การลบบัญชีทำให้ข้อมูลกลุ่มพัง (FK, นัดที่ผู้สร้างหาย, unique admin) — เทสต์รวมกรณีเป็น moderator ที่สร้างนัด, เป็นสมาชิกหลายกลุ่ม, มีคำเชิญค้าง
- race: ลบบัญชีพร้อมกับรับตำแหน่ง admin (โอนมาให้ตอนกำลังลบ) → ต้องไม่เหลือกลุ่มไร้ admin (ตรวจ admin ใน transaction เดียวกับการลบ)
- super admin เป็นช่องทางรั่วข้อมูล — response admin ต้องมี serializer เฉพาะ (ไม่ reuse row ดิบ)
- audit ถูกใช้เป็นช่องรั่ว meta — whitelist ตอนอ่าน + repo ปฏิเสธตอนเขียน

## 7. ข้อเสนอที่ Lead ตัดสินให้ (boss แย้งได้)
1. คืน username หลังลบบัญชี (เปลี่ยนเป็น `deleted-<id>`) — ข้อเสีย: มีคนสมัครชื่อเดิมแล้วสวมรอยได้ในวงเพื่อน; ข้อดี: ไม่เก็บ identifier เดิมของคนที่ลบ
2. การระงับไม่ถอดสมาชิกออกจากกลุ่ม (กลับมาใช้ต่อได้เลยเมื่อ unsuspend)
3. ไม่มีปุ่มกู้กลุ่มที่ลบ
4. ข้อความ `/privacy` ร่างโดยทีม ไม่ใช่คำปรึกษากฎหมาย — boss ต้องอ่านก่อนเปิดให้คนนอกใช้
5. deploy จริง (Turso + Vercel) และติด tag v0.1.0–v0.7.0 ทำหลัง R5 — Lead สอนทีละขั้น

## 8. Errata (บันทึกหลังทำจริง — Lead ตรวจ/รับรอง)
1. **`ACCOUNT_SUSPENDED` เป็น HTTP 401 ทั้งระบบ** (`ERROR_HTTP_STATUS` ใน `src/lib/shared/errors.ts` ตั้งแต่ R0 — ARCHITECTURE §2) ไม่ใช่ 403 อย่างที่ R5-3 เขียน · เทสต์เมทริกซ์ยืนยัน 401 + code `ACCOUNT_SUSPENDED` แม้เป็น SA · ไม่เปลี่ยนรหัสเพื่อไม่ทำให้ R1–R4B ถอยหลัง
2. การตัดสินของ backend (Auth & Access + Platform) ที่ §2 ข้อ 3 เปิดไว้ให้เลือก:
   - ระงับตัวเอง / super admin คนอื่น → **403 `FORBIDDEN`** (ไม่ใช่ 409 `CONFLICT`)
   - suspend ที่ถูกระงับอยู่แล้ว / unsuspend ที่ active อยู่แล้ว → **200 idempotent** `{changed:false}` และไม่เขียน audit
   - นัดที่ผู้ใช้ที่ลบบัญชีสร้าง: API คืน **`createdBy: null`** (serializer คืนชื่อเฉพาะสมาชิกปัจจุบัน) — แยกไม่ได้ว่า "ออกจากกลุ่ม" หรือ "ลบบัญชี" จึงใช้ข้อความ "สร้างโดยอดีตสมาชิกหรือบัญชีที่ถูกลบ" · ชื่อในแจ้งเตือนของคนอื่นถูกล้างเป็น `''` → UI แสดง "บัญชีที่ถูกลบ"
   - `GET /api/admin/groups/:gid` คืน **`userId`** ของสมาชิกด้วย (นอกเหนือ username/displayName/role/joinedAt) — ใช้เป็นค่า `toUserId` ของการโอน admin จากหน้า admin
   - action ใหม่ `admin.group.view` (SA-only, audit ทุกครั้งที่เปิดรายละเอียด) แยกจาก `admin.group.list` — บันทึกใน ADR 0003 Addendum R5
3. หน้าเว็บ: ป้าย action ของ audit ใน `messages/*.json` ใช้คีย์ที่แทน `.` ด้วย `_` (next-intl ห้ามจุดในชื่อคีย์) เช่น `adminAudit.actions.admin_user_suspend`
4. Follow-up ที่ทำในรอบนี้: `src/lib/auth/services/pin-change.ts` เขียนตัวนับ PIN ผ่าน `serialized()` แล้ว (เหมือน `services/account.ts`) + เทสต์ `tests/auth/pin-change-concurrency.test.ts`
5. รอบแก้หลัง QA/Security (2026-10-27): session สร้างเฉพาะบัญชี active ในคำสั่ง INSERT เดียว + session ของบัญชีที่ลบถือว่าไม่มี (Sec L1/L2) · unsuspend/unlock super admin คนอื่น → 403 (L3) · `admin.group.view` ไม่เกิน 1 แถว/(SA, กลุ่ม)/10 นาที (L4) · ห้ามชื่อที่แสดงเป็นป้าย "บัญชีที่ถูกลบ"/"Deleted account" → VALIDATION `RESERVED` (L5) · SQL ลบด้วยมือใช้กับบัญชีที่ระงับได้ (L6) · ลบบัญชีล้างอุปกรณ์/ประเทศของคำขอ reset (QA L2) · "บัญชีที่ถูกลบ" ตัดสินจาก displayName ว่างเท่านั้น (QA M1)
