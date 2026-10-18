# R1_CONTRACT.md — บัญชี + reset PIN + หน้า admin (reset)

> ผู้เขียน: Lead · 2026-10-18 · สถานะ: **รอ boss เห็นชอบ**
> อ้างอิง: [PRD §4 U1–U3, U12](docs/prd/PRD.md) · [ADR 0002](docs/adr/0002-auth-pin.md) (ทั้งฉบับ รวม §7 pepper) · [ADR 0003](docs/adr/0003-rbac.md) · [ARCHITECTURE §5](docs/design/ARCHITECTURE.md) · [R0_CONTRACT](R0_CONTRACT.md)
> ข้อเสนอเลขเวอร์ชันเมื่อจบรอบ: **v0.2.0**

## 1. เป้าหมาย
ผู้ใช้สมัคร ล็อกอิน ออกจากระบบ และลืม PIN ได้จริงบน preview: สมัครด้วย username + ชื่อที่แสดง + PIN 6 หลัก · ล็อกอินพร้อม lockout/rate limit · ขอ reset → super admin อนุมัติในหน้า admin → เข้าด้วย `123456` บนเครื่องที่ขอ → ถูกบังคับตั้ง PIN ใหม่
หลังรอบนี้ แอปยังไม่มีกลุ่ม/ปฏิทิน (R2+) — แท็บอื่นยังเป็นหน้าว่างเหมือน R0

Stories: **U1, U2, U3, U12 (เฉพาะส่วน reset), U13 (เฉพาะ "เปลี่ยน PIN" และ "ออกจากระบบทุกเครื่อง" ที่ endpoint ใช้ร่วม)** · เกณฑ์ตรวจ = ADR 0002 "Test requirements" ข้อ 1–18

## 2. ขอบเขต
**ทำ**
- `src/lib/auth/**`: pin (argon2id + pepper หลายเวอร์ชัน + dummy hash), กติกา PIN (20 ตัวต้องห้าม), session (token → SHA-256, sliding 60 วัน), throttle (`login_throttle` + `rate_limit_bucket`), pepper fingerprint + โหมด `AUTH_MAINTENANCE` (ADR 0002 §7, fail closed, ไม่มีโค้ดสร้าง pepper), reset flow (lazy expiry), `getActor(cookies)` ต่อเข้า route wrapper
- endpoint ตาม ARCHITECTURE §5 (U1–U3): `POST /api/auth/signup` · `login` · `logout` · `logout-all` · `GET /api/auth/session` · `POST /api/auth/pin-reset` · `GET /api/auth/pin-reset/status` · `GET /api/auth/admin/pin-resets` · `POST …/:id/approve` · `…/:id/reject` · `POST /api/auth/pin` — ทุกตัวลงทะเบียนใน manifest และเมทริกซ์ RBAC
- `must_change_pin`: ทุก API ยกเว้น `auth/pin` และ `auth/logout` → 403 `PIN_CHANGE_REQUIRED` (เทสต์วนจาก manifest)
- audit log (approve/reject), notification (`pin_reset.approved`, `pin_reset.cancelled_by_login`) — เขียนลงตาราง ยังไม่มีหน้า/กระดิ่ง (R5/R4)
- หน้าจอ (ไทย/อังกฤษ × สว่าง/มืด ครบ): `/login` ต่อ API จริง · `/signup` · `/forgot` (ขอ reset + แสดงสถานะ pending/approved ตาม cookie) · `/set-pin` (บังคับหลัง reset) · `/admin/pin-resets` (รายการคำขอ: เวลา, อุปกรณ์ย่อ, ประเทศ, ปุ่มอนุมัติ/ปฏิเสธ + คำเตือนให้ยืนยันกับเจ้าของนอกระบบ ตาม ADR 0002 §6) · แท็บ "ฉัน": ออกจากระบบ/ออกจากทุกเครื่อง/เปลี่ยน PIN
- middleware/guard: ยังไม่ล็อกอิน → ไป `/login` · ล็อกอินแล้วแต่ `must_change_pin` → ไป `/set-pin` · ผู้ที่ไม่ใช่ super admin เข้า `/admin/**` → 404
- `scripts/create-super-admin.ts` (OPS): boss รันบนเครื่องตัวเองกับ Turso จริง — อ่าน username/PIN จาก prompt, pepper จาก env ของ boss (ไม่รับเป็น argument) · ตั้ง `is_admin=1` · ปฏิเสธ PIN ต้องห้าม
- `scripts/pepper-fingerprint.ts` และ `scripts/admin-reset-pin.ts` ใช้งานได้จริง (R0 เป็นโครง) · health เพิ่ม `pepper: {ok, currentVersion, usersByVersion}` โดยไม่เปิดเผยค่า
- UX: ข้อความ R1 ทั้งสองภาษา (ฟอร์ม, ข้อผิดพลาด, แจ้ง lockout, หน้า forgot/set-pin/admin) · วัด argon2 บน Node 24 ใน CI แล้วจดผลใน Handoff
- docs: อัปเดต `docs/OPERATIONS.md` (ขั้นสร้าง super admin คนแรก, ซ้อมกู้ pepper), `CHANGELOG.md`

**ไม่ทำ**: กลุ่ม/ปฏิทิน/นัด (R2–R4) · หน้า admin ส่วนผู้ใช้/กลุ่ม/audit viewer (R5) · เปลี่ยนชื่อที่แสดง/ลบบัญชี (R5) · LINE (R7)

## 3. คำตอบ Lead ต่อคำถาม RBAC 6 ข้อจาก R0 (boss แย้งได้)
1. super admin ลบ/เปลี่ยนบทบาท**ตัวเอง**ผ่าน `member.remove`/`member.setRole` → **ปฏิเสธ** (ใช้ `group.leave` + กฎ D8 แทน) — Auth แก้ `can()` + fixture ใน R1
2. `appointment.rsvp` โดย SA ที่ไม่ใช่สมาชิก → 403 (คงเดิม)
3. `group.leave` โดย SA ที่ไม่ใช่สมาชิก → 404 (คงเดิม)
4. `auditAsSuperAdmin` เฉพาะ action แก้ไข + การใช้สิทธิ์ข้ามกลุ่ม (คงเดิม) · เพิ่ม `admin.audit.view` เข้ารายการที่ถูกบันทึก (การเปิดดู audit เป็นเรื่องอ่อนไหว)
5. `group.transferAdmin` เป้าหมายเป็น member/moderator ได้ ไม่ใช่ตัวเอง/คนที่เป็น admin อยู่แล้ว (คงเดิม)
6. `invite.list` ของ MEM กรองเฉพาะของตัวเองที่ชั้นข้อมูล → เทสต์ใน R2

## 4. ความรับผิดชอบไฟล์
| บทบาท | ไฟล์ |
|---|---|
| Auth & Access (#8) | `src/lib/auth/**`, `src/app/api/auth/**`, `src/lib/rbac/**` (แก้ข้อ 3.1, 3.4), `tests/auth/**`, `tests/rbac/**` |
| Platform (#5) | `src/db/**` + migration ใหม่ถ้าจำเป็น (เช่น เพิ่ม index/คอลัมน์ที่ ADR 0002 ต้องการและ schema ยังขาด), `src/lib/data/repos/**` สำหรับ user/session/throttle/reset/audit/notification, `src/app/api/_lib/**` (ต่อ `getActor`), `instrumentation.ts` |
| UX & Brand (#4) | `messages/*.json` (ส่วน R1), `src/styles/**`, `src/components/brand/**`, `docs/design/**` (wireframe หน้า signup/forgot/set-pin/admin-resets + ภาพหน้าจอ 4 ชุดต่อหน้า) |
| Front-end (#6) | `src/app/(public)/**`, `src/app/(app)/**`, `src/components/**` (ไม่รวม brand), `src/i18n/**`, `middleware`/`proxy` |
| OPS (#10) | `scripts/*.ts` (3 ตัวข้างบน), `src/app/api/health/**`, `.github/**`, `docs/OPERATIONS.md` |
| TEST (#11) | `tests/e2e/**`, `tests/helpers/**`, `vitest.config.ts`, `playwright.config.ts` |
| Release (#15) | `CHANGELOG.md`, `docs/VERSIONING.md` |
| QA (#12) + Security (#13) | ตรวจอิสระ คนละ agent กับผู้เขียน · Security ตรวจ: timing/enumeration, cookie flags, CSRF, ไม่มีความลับใน log, pepper fail-closed, อุปกรณ์ผูก 123456 |

## 5. ลำดับ
```
ขั้น 1  Platform: repos + getActor wiring (ขนานกับ UX: messages + wireframe)
ขั้น 2  Auth: lib/auth + endpoints + RBAC fixes + เทสต์ ADR 0002 ข้อ 1–17
ขั้น 3  ขนาน: Front-end (หน้าจอ) · OPS (scripts + health) · TEST (e2e ข้อ 18 + เมทริกซ์ auto)
ขั้น 4  QA + Security อิสระ → แก้ (commit `qa:`/`security fix:`)
ขั้น 5  Lead รันเกตซ้ำ → รายงานเลขา → bundle → boss push/merge
```
ทุก commit ใช้ `user.name` = ชื่อบทบาท · ตามกฎ R0-19 (เทสต์ที่เขียนคู่โค้ดตัวเองแตะ `tests/<โดเมน>/**` ได้)

## 6. เกณฑ์ผ่าน
| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R1-1 | ADR 0002 test requirements ข้อ 1–17 | เทสต์ทั้ง 17 ข้อมีและผ่าน (`npm test`) — Handoff ระบุไฟล์เทสต์ต่อข้อ |
| R1-2 | ข้อ 18 E2E | Playwright: ขอ reset → super admin อนุมัติ → `123456` เครื่องเดิม → `/set-pin` → `123456` ใช้ไม่ได้ · เกิน 24 ชม. (นาฬิกาจำลอง) ผิด |
| R1-3 | RBAC | เมทริกซ์ผ่านรวมแถว `must_change_pin` · endpoint ใหม่ทุกตัวอยู่ใน manifest · แก้ข้อ 3.1/3.4 มีเทสต์ |
| R1-4 | argon2 | วัดบน Node 24 ใน CI ≤ 100 ms/verify ที่ 1 vCPU (ถ้าเกินให้รายงาน ไม่เดา) · ใช้ `crypto.argon2` ไม่ใช้ native addon |
| R1-5 | หน้าจอมือถือ | e2e 375/390/768 × th/en × light/dark ทุกหน้าใหม่: ไม่มี horizontal scroll, ปุ่ม ≥ 44px, ไม่มีข้อความ hard-code (เทสต์ i18n เดิม) |
| R1-6 | i18n | key parity th/en + ทุก `errors.<CODE>` ที่ R1 ใช้มี 2 ภาษา · lockout แสดง "ลองใหม่ใน …" ถูกต้องทั้งสองภาษา |
| R1-7 | ความลับ | ไม่มี PIN/hash/token/pepper ใน log/response (เทสต์ข้อ 12, 17) · `grep` repo ไม่พบค่าจริง · ไม่มีโค้ดสร้าง pepper (ข้อ 16) |
| R1-8 | scripts | `create-super-admin.ts` ทดสอบกับ DB ชั่วคราว: ปฏิเสธ PIN ต้องห้าม, ไม่พิมพ์ PIN/pepper, สร้างแล้วล็อกอินได้ · `admin-reset-pin.ts` ทดสอบ flow ใน ADR 0002 §7 |
| R1-9 | CI + ขอบเขตไฟล์ | เกต R0 ทั้งหมดยังผ่าน · commit แตะเฉพาะไฟล์ตาม §4 (ยกเว้นเทสต์คู่โค้ด) |
| R1-10 | ตรวจอิสระ | QA รันเกตซ้ำเอง + ภาพหน้าจอ · Security ตาม §4 · ทั้งคู่ห้ามแก้โค้ดที่ตัวเองตรวจ |

## 7. ความเสี่ยง / สิ่งที่ boss ต้องตัดสินใจ
**ตัดสินใจ (ตอบสั้น ๆ ก็พอ)**
1. อนุมัติ contract นี้ หรือสั่งแก้
2. **สร้าง super admin คนแรกอย่างไร** — Lead เสนอ: boss รัน `scripts/create-super-admin.ts` เองหลังสร้าง Turso + ตั้ง pepper (ทีมไม่เคยเห็น PIN ของ boss) · ระหว่างพัฒนา/ทดสอบใช้บัญชีจำลองใน DB ชั่วคราว · ทางเลือก: ให้ "ผู้สมัครคนแรก" เป็น super admin อัตโนมัติ (ไม่แนะนำ — ใครเข้าเว็บก่อนก็ยึดระบบได้)
3. คำตอบข้อ 3 (RBAC 6 ข้อ) — เห็นต่างข้อไหนบอกเลข

**ความเสี่ยง**
- ผลวัด argon2 บน Vercel Hobby จริงต้องรอ deploy — ใน CI วัดบนเครื่องจำลอง จะแยกบอกชัดว่าเป็นตัวเลขจากที่ไหน
- เทสต์ที่ต้องใช้ pepper จริง/Turso จริง ปิดหลัง boss deploy (R1 รันกับ libSQL ไฟล์ + pepper ทดสอบที่สร้างในเทสต์เท่านั้น)
- Vitest เคยล้ม 1 ครั้งแบบไม่ซ้ำใน R0 — TEST ต้องรันเทสต์ซ้ำ 3 รอบก่อนส่ง ถ้าเจอเทสต์ไม่เสถียรให้แก้ที่ต้นเหตุ ไม่ใส่ retry

## 8. สิ่งที่ boss ต้องทำในรอบนี้
- [ ] อนุมัติ contract + ตอบข้อ 7.2
- [ ] หลังทีมส่ง bundle: pull/push + เปิด PR ตามที่ทำใน R0 (ผมจะให้คำสั่งทีละบรรทัดเหมือนเดิม)
- [ ] ยังไม่ต้องสร้าง Turso/Vercel/pepper — ทำตอนใกล้ deploy จริง (ก่อน R2 จบหรือเมื่อ boss อยากลอง preview) ผมจะแจ้งก่อน
