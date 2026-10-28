# Changelog

การเปลี่ยนแปลงที่สำคัญทั้งหมดของ maewmeet (แมวเจอกัน) บันทึกไว้ที่นี่

รูปแบบตาม [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) และนับเวอร์ชันแบบ [Semantic Versioning](https://semver.org/lang/th/) — กติกาของเราอยู่ใน [docs/VERSIONING.md](docs/VERSIONING.md)
ชื่อรอบงาน (R0–R7) ไม่ใช่เลขเวอร์ชัน · เวอร์ชันออกโดย boss ด้วย `scripts/release.ts` เท่านั้น

## [Unreleased]

## [0.7.0] - 2026-10-28

### Added
- โครงโปรเจกต์ Next.js 16.4 + TypeScript 6 (strict) + Tailwind CSS 4 + ESLint 9 (flat config) บน Node 24 (`.nvmrc`, `engines`)
- กฎ ESLint ของโปรเจกต์: ห้าม `new Date(` และ import `temporal-polyfill` นอก `src/lib/calendar/**` · ห้าม `src/lib/data/repos/**` import จาก `src/app/**`
- Schema ฐานข้อมูล v1 ครบ 17 ตาราง (Drizzle + libSQL/Turso) พร้อม migration แรกใน `drizzle/`
- ชั้นกลาง `src/lib/shared/**`: รหัส error ชุดเดียว, ตรวจ env ด้วย zod (ล้มตอนเริ่มถ้าตัวแปรต้องมีหาย), `result`, `id`, `clock` ที่ inject เวลาได้
- route wrapper ของ API: ตรวจ Origin (CSRF), ตรวจ input ด้วย zod, แปลง error → HTTP status, `Cache-Control: private, no-store` ทุก response + manifest ของ route
- RBAC กลาง `src/lib/rbac/**` (`can()` แบบ pure) ครอบคลุมทุก action ใน PRD §3 + สถานะ `must_change_pin` พร้อมเทสต์เมทริกซ์ 6 บทบาท
- Endpoint: `GET /api/health` · `GET /api/cron/daily` · `POST /api/cron/heartbeat` · `POST /api/prefs` (ตั้งภาษา/ธีมก่อนล็อกอิน)
- สองภาษา ไทย/อังกฤษ (next-intl ไม่มี locale ใน URL) — ข้อความ shell + ข้อความ error ครบทุกรหัส
- ธีม `system | light | dark` ตั้งจากฝั่งเซิร์ฟเวอร์ (ไม่กระพริบ) + พื้นหลัง aurora แบบ CSS ล้วน (หยุดเมื่อ reduced-motion / แท็บไม่ active)
- App shell: หน้า login (แสดงอย่างเดียว ยังส่ง PIN ไม่ได้), แถบนำทางล่าง 4 แท็บ, หน้าว่างแต่ละแท็บ, หน้า 404 พร้อมแมว, ตัวสลับภาษา/ธีม
- โครงทดสอบ: Vitest + libSQL ไฟล์ชั่วคราวที่รัน migration จริง · Playwright 375/390/768 × th/en × light/dark
- CI GitHub Actions: lint · typecheck · test · build · migration check · e2e · contrast · workflow keep-alive ทุก 12 ชม.
- ระบบออกรุ่น: `CHANGELOG.md`, `docs/VERSIONING.md`, `scripts/release.ts` (`--dry-run` ได้) — boss เป็นคนรัน
- `docs/OPERATIONS.md` ขั้นตอนตั้งค่าครั้งแรก (Turso, Vercel, env, pepper, GitHub Secrets, keep-alive, กู้ Turso)

- R1 — สมัครสมาชิกและเข้าสู่ระบบจริงด้วย username + PIN 6 หลัก: `POST /api/auth/signup · login · logout · logout-all · pin` และ `GET /api/auth/session` (cookie session HttpOnly/Secure/SameSite=Lax, ต่ออายุแบบ sliding 60 วัน, เก็บเฉพาะ SHA-256 ของ token)
- R1 — PIN เก็บด้วย argon2id + pepper หลายเวอร์ชัน (หมุนได้โดยไม่ต้อง reset ใคร) · pepper หาย/ผิด → ปิด login (`AUTH_MAINTENANCE`) แทนการสร้างเอง · fingerprint ของ pepper ในฐานข้อมูล + `scripts/pepper-fingerprint.ts` + `/api/health` รายงานสถานะ pepper
- R1 — ล็อกเอาต์ตามจำนวนครั้งที่ผิดต่อ username (ครั้งที่ 5 ล็อก 1 นาที แล้วเพิ่มเป็นสองเท่าถึงเพดาน 24 ชม.) + จำกัดต่อ IP (ผิด 20 ครั้ง/15 นาที · สมัคร 5/ชม. · ขอ reset 3/ชม.) — ผู้ใช้ที่ไม่มีอยู่จริงตอบเหมือนผู้ใช้จริงทุกไบต์
- R1 — ลืม PIN: ผู้ใช้ขอจากหน้า `/forgot` → super admin อนุมัติที่ `/admin/pin-resets` → ใช้ PIN `123456` ได้ครั้งเดียวภายใน 24 ชม. **เฉพาะเครื่องที่กดขอ** (คุกกี้ผูกเครื่อง) → บังคับตั้ง PIN ใหม่ที่ `/set-pin` · อนุมัติ/ปฏิเสธบันทึก audit log + แจ้งเตือนผู้ใช้
- R1 — หน้าจอ ไทย/อังกฤษ × สว่าง/มืด: `/login` (แป้นกรอก PIN, แจ้ง lockout), `/signup`, `/forgot`, `/set-pin`, `/admin/pin-resets`, แท็บ "ฉัน" (เปลี่ยน PIN, ออกจากระบบทุกเครื่อง) + guard เปลี่ยนเส้นทางตามสถานะผู้ใช้ · ผู้ที่ไม่ใช่ super admin เข้า `/admin/**` ได้ 404
- R1 — `scripts/admin-reset-pin.ts` (กู้ฉุกเฉินเมื่อ pepper หายครบทุกสำเนา หรือ super admin ลืม PIN ของตัวเอง) · ขั้นตอนตั้ง super admin คนแรกด้วย SQL ใน `docs/OPERATIONS.md`
- R1 — env ใหม่ `TRUST_PROXY_HEADERS` (ไม่บังคับ) · บน Vercel ไม่ต้องตั้ง
- R1 — เทสต์: ADR 0002 ข้อ 1–17 ครบ + เทสต์ความปลอดภัยของการตรวจอิสระ (`tests/auth/security-r1.test.ts`, `client-ip.test.ts`) + Playwright เรื่องราว reset PIN, login, guards, เลย์เอาต์หน้า R1 × 375/390/768 × th/en × light/dark

- R2 — กลุ่ม: สร้างกลุ่ม (ผู้สร้างเป็น admin) · ชื่อ 1–40 ตัวอักษร · สร้างได้คนละ 10 กลุ่ม · สมาชิกกลุ่มละ 50 คน · แก้ชื่อ/ช่วงเวลาว่างของกลุ่ม · ลบกลุ่ม (soft delete) · ออกจากกลุ่ม · admin ต้องโอนก่อนออก
- R2 — บทบาท admin / moderator / member ตามตารางสิทธิ์ PRD §3: ตั้ง/ถอน moderator · นำสมาชิกออก (moderator นำออกได้เฉพาะ member) · โอน admin (admin เดิมกลายเป็น moderator) · super admin จัดการกลุ่มที่ไม่ได้เป็นสมาชิกได้และถูกบันทึก audit
- R2 — ชวนเพื่อน 2 ทาง: **ชวนตรงด้วย username** (หมดอายุ 7 วัน · ผู้รับกดรับ/ปฏิเสธในแท็บกลุ่ม · ผู้ชวนได้ notification) และ **โค้ดเชิญ `XXXX-XXXX`** (ใช้ได้หลายคน หมดอายุ 7 วัน เพิกถอนได้ แสดงโค้ดเต็มครั้งเดียวตอนสร้าง กลุ่มละไม่เกิน 20 โค้ดที่ยังใช้ได้)
- R2 — Endpoint: `POST/GET /api/groups` · `GET/PATCH/DELETE /api/groups/:gid` · `PATCH/DELETE …/members/:uid` · `POST …/transfer-admin · leave · invites/direct · invites/code` · `GET …/invites` · `DELETE …/invites/:iid` · `POST /api/invites/redeem` · `GET /api/me/invites` · `POST /api/me/invites/:iid/accept|decline`
- R2 — หน้าจอ ไทย/อังกฤษ × สว่าง/มืด: แท็บ "กลุ่ม" (รายการกลุ่ม · สร้างกลุ่ม · ใส่โค้ดเชิญ · คำเชิญที่ค้าง) · `/groups/[gid]` (หัวกลุ่ม, สมาชิกพร้อมบทบาทและสีประจำตัว, ที่ว่างของปฏิทิน) · `/groups/[gid]/settings` (ชื่อ, ช่วงเวลาว่าง, สมาชิก/บทบาท, โค้ดเชิญ, ชวนตรง, โอน admin, ออก/ลบกลุ่ม) — ปุ่มที่สิทธิ์ไม่พอซ่อน และเซิร์ฟเวอร์ตรวจซ้ำเสมอ
- R2 — notification ชนิด `group.invite.received | accepted | declined` ลงตาราง (ยังไม่มีกระดิ่ง — R4/R5) · ใช้รหัส error `LIMIT_REACHED` (ใหม่ใน R2), `INVITE_INVALID`, `USER_NOT_FOUND`, `ALREADY_MEMBER`, `ADMIN_TRANSFER_REQUIRED`, `INVALID_WINDOW` พร้อมข้อความ 2 ภาษา
- R2 — เทสต์: เมทริกซ์ RBAC ของ action กลุ่ม/สมาชิก/คำเชิญ · เทสต์ repo ว่าไม่มี check-then-act (จำลองคำขอสลับลำดับ) · เรื่องราว E2E สร้างกลุ่ม → ชวน → รับ → โอน admin · เลย์เอาต์ทุกหน้า/sheet/dialog × 375/390/768 × th/en × light/dark (รวมชื่อกลุ่มยาวไม่มีช่องว่าง)

- R3 — ปฏิทินและวันที่ไม่ว่าง (busy): บันทึกวัน/ช่วงเวลาที่ไม่ว่างของตัวเอง (ทั้งวันหรือกำหนดเวลา, หมายเหตุเห็นเฉพาะเจ้าของ) · ปฏิทินรายเดือนของกลุ่มดูได้ตามโหมดการมองเห็นที่เจ้าของเลือก · เพดาน 300 รายการต่อคน (นับเฉพาะช่วงที่ยังแก้ได้), ช่วงเวลาไม่เกิน 62 วัน (ทั้งวัน 366), ย้อนหลังแก้ได้ไม่เกิน 7 วัน · ข้อมูล busy เก่ากว่า 90 วันถูกลบโดย cron รายวัน · ตัวแปลง busy ตัวเดียว (serializer) กันข้อมูลหลุดข้ามผู้ดู (ADR 0006) · Endpoint `POST/GET /api/me/busy`, `PATCH/DELETE /api/me/busy/:id`, `GET /api/groups/:gid/calendar`
- R4A — หน้า "ว่างตรงกัน": คำนวณวันและช่วงเวลาที่สมาชิกทุกคนว่างร่วมกันตามช่วงเวลาว่างของกลุ่ม · แสดง "ว่าง X/Y" รายวันพร้อมคนที่ติด (ตามสิทธิ์การมองเห็น) · แยก "ทุกคนไม่ติดธุระ" กับ "ว่างร่วมนานพอทำกิจกรรม" ด้วยกรอบเส้นประกับเครื่องหมายถูก (ไม่พึ่งสีอย่างเดียว) · Endpoint `GET /api/groups/:gid/availability` (ตอบ `truncated` เมื่อข้อมูลเกินเพดาน — ห้ามใช้ตัดสินใจ) (ADR 0005)
- R4B — นัด: สร้าง/แก้/ยกเลิกนัด (ชื่อ, เวลาเริ่ม-จบทีละ 30 นาที, สถานที่, รายละเอียด) · ผู้สร้างและ admin/moderator แก้/ยกเลิกได้ · ยกเลิกแล้วยังเห็นพร้อมสถานะ · ตอบรับ ไป/อาจไป/ไม่ไป (RSVP) · เตือน (ไม่บล็อก) เมื่อนัดทับวันที่ไม่ว่างของสมาชิก · เพดานนัดที่ยังเปิด 100 ต่อกลุ่ม, 30 ต่อวันต่อกลุ่ม, ช่วงไม่เกิน 62 วัน · Endpoint `POST/GET /api/groups/:gid/appointments`, `POST …/check`, `GET/PATCH /api/appointments/:id`, `POST …/cancel`, `PUT …/rsvp`, `GET /api/me/appointments`
- R4B — สถานที่ + แผนที่: ค้นหาสถานที่ด้วยปุ่ม "ค้นหา" ผ่านเซิร์ฟเวอร์ (Nominatim ของ OpenStreetMap, แคช 30 วัน, จำกัด 1 คำขอ/วินาทีทั้งระบบ) หรือวางลิงก์แผนที่/พิกัด · แผนที่ภาพ OSM พร้อมลิงก์ที่มา · ปุ่มปิดฟีเจอร์ `PLACE_SEARCH_ENABLED=false` · ต้องตั้ง `NOMINATIM_CONTACT`
- R4B — แจ้งเตือนในแอป: กระดิ่ง + หน้ารายการ แจ้งเมื่อมีนัดใหม่ในกลุ่ม (ชนิด `appointment.created`; ไม่มีแจ้งเตือนเมื่อแก้/ยกเลิก) · ลบแจ้งเตือนเก่ากว่า 90 วันโดย cron รายวัน · `GET /api/me/notifications`, `POST /api/me/notifications/read`
- R4B — หน้าหลัก: การ์ดนัดถัดไป (ชื่อ, วัน-เวลา, สถานที่, อีกกี่วัน, จำนวนคนไป) + รายการนัดที่เหลือข้ามทุกกลุ่ม · ไม่มีนัดแสดงหน้าว่างพร้อมปุ่มไปดูวันที่ว่างตรงกัน
- R5 — เปลี่ยนชื่อที่แสดงที่แท็บ "ฉัน" (`PATCH /api/me`) — กติกาเดียวกับตอนสมัคร (1–40 ตัว ห้ามตัวควบคุม/bidi/zero-width) · วันละ 10 ครั้ง · เพื่อนในกลุ่มเห็นชื่อใหม่ทันที
- R5 — ลบบัญชีเองที่แท็บ "ฉัน" (`POST /api/me/delete`) — ต้องใส่ PIN ปัจจุบัน (ผิดนับรวมกับ login) · ยังเป็นผู้ดูแลกลุ่ม → บอกรายชื่อกลุ่มที่ต้องโอนก่อนพร้อมลิงก์ · ลบแล้วกู้คืนไม่ได้: ออกจากทุกกลุ่ม ลบ busy/RSVP/แจ้งเตือน ยกเลิกคำเชิญ ชื่อผู้ใช้เดิมว่างให้คนอื่นสมัคร · นัดที่สร้างยังอยู่ ผู้สร้างแสดงเป็น "บัญชีที่ถูกลบ"
- R5 — หน้าผู้ดูแลระบบ `/admin` (สรุป + ทางไปทุกหน้า) · `/admin/users` (ค้นหา, โหลดเพิ่ม, ระงับ/ยกเลิกระงับ — ผู้ถูกระงับถูกออกจากระบบทันที, ปลดล็อกการใส่ PIN ผิด) · `/admin/groups` + รายละเอียดกลุ่ม (เห็นแค่ชื่อ/บทบาท/จำนวน — ไม่เห็น busy หรือรายละเอียดนัด, โอนผู้ดูแล, ลบกลุ่ม) · `/admin/audit` (กรองตามการกระทำ/ชนิด/รหัสเป้าหมาย/ผู้ทำ) — ทุกปุ่มที่ย้อนไม่ได้ยืนยันใน Sheet ที่บอกผลที่ตามมา
- R5 — API ของ super admin: `GET /api/admin/users` · `POST /api/admin/users/:id/{suspend,unsuspend,unlock}` · `GET /api/admin/groups` · `GET /api/admin/groups/:gid` · `GET /api/admin/audit` (cursor ใหม่→เก่า, meta ผ่าน whitelist)
- R5 — ประกาศความเป็นส่วนตัว `/privacy` (สาธารณะ, ไทย/อังกฤษ, ลิงก์จากหน้าเข้าสู่ระบบและแท็บ "ฉัน") — **ร่างโดยทีม ไม่ใช่คำปรึกษากฎหมาย boss ต้องอ่านและรับรองก่อนเปิดให้คนนอกใช้**
- R5 — เทสต์: บัญชี (เปลี่ยนชื่อ/ลบรวม race), เมทริกซ์สิทธิ์ `/api/admin/*`, canary ข้อมูลส่วนตัวใน response admin, audit/cursor, ค้นหา, Playwright เรื่องราว (เปลี่ยนชื่อ, ลบบัญชีรวมกรณีเป็นผู้ดูแล, SA ระงับ→ผู้ใช้เด้ง, ดู audit, /privacy) + เลย์เอาต์หน้า R5 × 375/390/768 × th/en × light/dark

### Changed
- R1 — `GET /api/auth/pin-reset/status` ตอบเพียง `none | pending | approved | closed` และคำขอที่ถูกปฏิเสธ/ยกเลิก/หมดอายุจะแสดง "ส่งคำขอแล้ว" จนครบ 7 วันนับจากที่ออกคุกกี้ แล้วจึง "ปิดแล้ว" (เพื่อไม่ให้รู้ว่า username มีจริงหรือไม่)
- R1 — ข้อความใต้แป้นกรอก PIN ในขั้น "ตั้ง/ยืนยัน PIN ใหม่" ตรงกับขั้นตอน (เดิมขึ้น "ใส่ PIN ของคุณ" ในขั้นยืนยัน)
- R1 — super admin ลบ/เปลี่ยนบทบาทตัวเองผ่านกลุ่มไม่ได้ (ใช้ออกจากกลุ่ม + โอน admin) · การเปิดดู audit log ถูกบันทึกเอง · super admin อนุมัติคำขอ reset ของตัวเองไม่ได้ (ใช้สคริปต์ break-glass)
- ดีไซน์ตามที่ Lead จดไว้ในเฟส 2: แถบล่างธีมมืดทึบขึ้น (A4) · `--surface-veil` .92 + noise กัน banding (A5) · legend "ว่างครึ่งหนึ่งขึ้นไป" · รองรับ `data-theme="system"` (Q10)

- R5 — action ใหม่ `admin.group.view` (super admin เท่านั้น ลง audit ทุกครั้งที่เปิด) · super admin ลบบัญชีตัวเองในแอปไม่ได้ (ทำตาม `docs/OPERATIONS.md` I1/I3)
- R5 — ชื่อของบัญชีที่ถูกลบแสดงเป็น "บัญชีที่ถูกลบ" ในแจ้งเตือน/นัด/RSVP · ข้อความ "สร้างโดยอดีตสมาชิก" เปลี่ยนเป็น "สร้างโดยอดีตสมาชิกหรือบัญชีที่ถูกลบ"

### Security
- R1 — จำนวนครั้งที่ผิดถูก "จอง" แบบอะตอมมิกก่อนตรวจ PIN (ทั้งต่อ username และต่อ IP): ยิงคำขอขนาน 60 ตัวตรวจ PIN ได้ไม่เกิน 5 ครั้งต่อ username และไม่เกิน 20 ครั้งต่อ IP · PIN ถูกในชุดที่ยิงหลังถูกล็อกไม่เข้าได้ · เปลี่ยน PIN (ใส่ PIN เดิม) ใช้ตัวนับชุดเดียวกัน
- R1 — อนุมัติคำขอ reset แล้วล้างตัวนับ lockout ของผู้ใช้ · `123456` กับคุกกี้เครื่องที่ผูกไว้ข้ามการล็อก username ได้ (ยังกินโควตา IP) · ใช้ reset เป็นธุรกรรมเดียว (ล้มกลางทางไม่เหลือสถานะครึ่งทาง)
- R1 — IP ของผู้เรียกเชื่อ header จาก proxy เฉพาะบน Vercel หรือเมื่อตั้ง `TRUST_PROXY_HEADERS=1` (ปลอม `x-forwarded-for` หลบเพดานไม่ได้) · ไม่เชื่อ = ถังร่วม `unknown` เพดาน ×50
- R1 — ไม่มี PIN/hash/token/pepper ใน response หรือ log (เทสต์ตรวจ) · คุกกี้ reset เซ็นด้วย HMAC ปลอมเวลาออกไม่ได้
- Security headers ใน `next.config.ts`: CSP (ไม่มี `unsafe-eval`, tile OSM อนุญาตเฉพาะรูปภาพ), `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
- cron ทั้งสอง endpoint ต้องมี `Authorization: Bearer <CRON_SECRET>` (ผิด → 401)
- ทุก request ที่ไม่ใช่ GET ตรวจ Origin · ความลับอยู่ใน env เท่านั้น (`.env.example` ไม่มีค่าจริง)
- `/api/health` ไม่เปิดเผยค่า env หรือรายละเอียดข้อผิดพลาดภายใน
- R2 — โค้ดเชิญเก็บเป็น HMAC-SHA256 ด้วย subkey HKDF ของ `APP_SECRET` (ไม่ใช่ SHA-256 ล้วน เพราะโค้ดมีแค่ ~39.6 บิต ฐานรั่วแล้วไล่ย้อนได้) · แสดงโค้ดเต็มครั้งเดียวตอนสร้าง ไม่อยู่ใน log/audit/notification/รายการ · ผิดทุกสาเหตุตอบ `INVITE_INVALID` เหมือนกันทุกไบต์ · ใช้โค้ดจำกัด 10 ครั้ง/ผู้ใช้ + 30 ครั้ง/IP ต่อ 15 นาที แบบจองก่อนตรวจ (ยิงขนานไม่เกินเพดาน)
- R2 — ทุกการเขียนที่ขึ้นกับ role ของผู้กระทำ (แก้/ลบกลุ่ม · สร้างโค้ด · ชวนตรง · เพิกถอนคำเชิญ · นำออก/เปลี่ยน role) ตรวจในคำสั่ง SQL เดียวกันว่าผู้กระทำ **ยังถือ role เดิม** → สมาชิกที่เพิ่งถูกนำออกสร้างโค้ด/คำเชิญที่ใช้ได้ไม่ได้ และ admin เก่าหลังโอนลบ/แก้กลุ่มไม่ได้ (ตอบ 409) · ทุกการเปลี่ยนสถานะ (เพดาน 10 กลุ่ม/50 สมาชิก/20 โค้ด) เป็นคำสั่งเดียวมีเงื่อนไขในตัว ไม่มี check-then-act
- R2 — body ของ API อ่านแบบ stream นับไบต์และยกเลิกที่ 64 KiB (รวมแบบ chunked ที่ไม่มี `Content-Length`) แทนการอ่านทั้งก้อนก่อนวัด → `400 VALIDATION` (`_body: TOO_LARGE`)
- R2 — ชื่อกลุ่มต้องมีตัวที่มองเห็นอย่างน้อย 1 ตัว (ไม่รับชื่อที่มีแต่ U+2800 / U+034F / variation selector / ตัวเชื่อม / ช่องว่าง) · เครื่องหมายผสมต้องมีตัวฐานและซ้อนไม่เกิน 3 · ช่องว่างที่ไม่ใช่ U+0020 (NBSP, em-space, ideographic space ฯลฯ) ถูกปฏิเสธและช่องว่างซ้ำถูกยุบ · ZWJ ใช้ได้เฉพาะระหว่าง emoji (🐈‍⬛ 👨‍👩‍👧) · bidi / zero-width / ตัวควบคุม / tag character ยังห้าม
- R2 — ชวนตรง: หลังผู้รับปฏิเสธ ผู้ชวนคนเดิมชวนซ้ำเข้ากลุ่มเดิมไม่ได้ 24 ชม. (`409 CONFLICT`) กันสแปมผู้รับ

- R5 — ทุกการกระทำของ super admin ต่อบัญชี/กลุ่มของคนอื่นลง audit log ในธุรกรรมเดียวกับการเปลี่ยน · การเปิด audit log บันทึกไม่เกิน 1 แถว/10 นาที/คน · endpoint เขียนของ admin จำกัด 60 ครั้ง/10 นาที/คน
- R5 — response ของ `/api/admin/*` ใช้ serializer เฉพาะ (ไม่มี pin_hash/pepper/locale/theme/busy/ชื่อนัด/พิกัด/หมายเหตุ — มี canary test) · ค้นหา escape `%` `_` `\` และจำกัด 40 ตัว
- R5 — login ที่แข่งกับการลบบัญชี/การระงับสร้าง session ไม่ได้ (เงื่อนไขสถานะในคำสั่ง INSERT เดียว) · super admin ยกเลิกระงับ/ปลดล็อก super admin คนอื่นไม่ได้ · การเปิดรายละเอียดกลุ่มของ admin ลง audit ไม่เกิน 1 แถว/10 นาที · ตั้งชื่อที่แสดงเป็น "บัญชีที่ถูกลบ"/"Deleted account" ไม่ได้ · ลบบัญชีล้างอุปกรณ์/ประเทศของคำขอเปลี่ยน PIN
- R5 — ลบบัญชีกันการแข่งกับ "โอน admin มาให้ระหว่างลบ" ด้วยเงื่อนไขในคำสั่ง UPDATE เดียว (ไม่มีกลุ่มไร้ admin) · เปลี่ยน PIN เขียนตัวนับผ่านคิวเดียวกับธุรกรรมอื่น (ไม่ตอบ 500 เมื่อเขียนพร้อมกัน)

### Known limits
ข้อจำกัดที่รู้และยอมรับในรอบ R2 (บันทึกใน ADR 0002 §8 / R1_CONTRACT §6):
- **การนำออกไม่ "ติดตัว"** — ไม่มี ban list: ผู้ถูกนำออกเข้ากลุ่มเดิมได้อีกถ้ายังมีโค้ดใช้ได้หลายครั้งที่ไม่หมดอายุ/ไม่ถูกเพิกถอน (หรือถูกชวนตรงใหม่) · แนะนำให้เพิกถอนโค้ดของกลุ่มตอนนำคนออก (โค้ดที่ผู้ถูกนำออกสร้างไว้ถูกเพิกถอนให้อัตโนมัติ) · อาจเพิ่มตาราง ban ในรอบหน้า
- **IP ร่วมล็อกกันเอง** — เพดานใช้โค้ด 30 ครั้ง/IP/15 นาที: คนหลายคนหลัง NAT เดียวกัน (หอพัก ออฟฟิศ Wi-Fi สาธารณะ) ใช้โควตาร่วมกัน คนหนึ่งเดาผิดรัว ๆ ทำให้คนอื่นในเครือข่ายเดียวกันใช้โค้ดไม่ได้ชั่วคราว (เห็น `RATE_LIMITED` + เวลารอ) · ช่วงรอยต่อของ fixed window ยิงได้สูงสุดสองเท่าของเพดาน
- **ชวนตรงซ้ำถูกกันด้วยคูลดาวน์ 24 ชม.** — ต่อ (ผู้ชวน, กลุ่ม, ผู้รับ) หลังถูกปฏิเสธเท่านั้น · ยังไม่มีทางให้ผู้รับบล็อกผู้ชวน/กลุ่ม (นอกขอบเขต v1) · ผู้ชวนคนอื่นในกลุ่มเดียวกันยังชวนได้
- **guard ของหน้าตอบ HTTP 200** — หน้า server component ที่ guard สั่ง redirect/404 (ไม่ล็อกอิน · ต้องเปลี่ยน PIN · กลุ่มที่ไม่มีสิทธิ์) ตอบสถานะ 200 พร้อมเนื้อหา redirect/404 แทน 3xx/404 เพราะ response เป็น streaming (ส่วนเบี่ยงเบนที่ยอมรับตาม R1_CONTRACT §6 — ทบทวน R6) · ความปลอดภัยไม่ขึ้นกับ status ของหน้า: ข้อมูลทุกอย่างผ่าน service ที่ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์
- **แจ้งเตือนในแอปมีชนิดเดียวสำหรับนัด** — แจ้งเมื่อมีนัดใหม่เท่านั้น (ไม่แจ้งเมื่อแก้/ยกเลิก) · ยังไม่มีแจ้งเตือนก่อนถึงวันนัด หรือนัดซ้ำ
- R5 — ไม่มีการกู้บัญชี/กลุ่มที่ลบ และยังไม่มีการลบถาวร (hard purge) ของแถวที่ลบแล้ว · การระงับไม่ถอดสมาชิกออกจากกลุ่ม · ชื่อผู้ใช้ของคนที่ลบบัญชีมีคนอื่นสมัครซ้ำได้ (R5_CONTRACT §7)

### Upgrade notes
รุ่นแรก — ไม่มีของเดิมให้ย้าย แต่ต้องตั้งค่าครั้งแรกก่อน deploy (ทีละขั้นใน `docs/OPERATIONS.md`):
1. สร้างฐานข้อมูล Turso แล้วตั้ง `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` ใน Vercel
2. สร้างความลับเองบนเครื่อง (ห้ามส่งในแชท/ใส่ใน repo): `PIN_PEPPER_V1` (+ `PIN_PEPPER_CURRENT_VERSION=1`), `APP_SECRET`, `CRON_SECRET` · เก็บ pepper สำรอง 2 ที่ตาม ADR 0002 §7.4
3. ตั้ง `APP_ORIGIN` และตัวแปรอื่นตาม `.env.example`
4. GitHub Secrets: `CRON_SECRET` + `APP_ORIGIN` สำหรับ workflow keep-alive · เปิดแจ้งเตือน Actions ล้ม
5. รัน migration แรกกับฐาน Turso ก่อนเปิดใช้ แล้วตรวจ `GET /api/health` → 200
6. (R1) หลัง deploy ครั้งแรก boss สมัครบัญชีเองบนเว็บ แล้วตั้ง `is_admin = 1` ด้วย SQL บน Turso (ขั้นตอนใน `docs/OPERATIONS.md` H1) · **อย่าตั้ง `TRUST_PROXY_HEADERS=1` บน Vercel หรือเมื่อแอปเปิดรับคำขอตรงจากอินเทอร์เน็ตโดยไม่มี proxy** (ไม่จำเป็นบน Vercel — แพลตฟอร์มจัดการให้)
7. (R5) ไม่มีขั้นตอนเพิ่ม — แนะนำให้ตั้ง super admin คนที่สองตาม `docs/OPERATIONS.md` I1 และให้ boss อ่าน/รับรอง `/privacy` ก่อนเปิดให้คนนอกใช้

### Docs
- R5 — `docs/OPERATIONS.md` I (ตั้ง super admin ด้วย SQL, super admin ลืม PIN, ลบบัญชีด้วยมือ + SQL ที่มีเทสต์) · ADR 0003 Addendum R5 · R5_CONTRACT §8 Errata
- R1 — `docs/adr/0002-auth-pin.md` §3/§5 (จองก่อน verify, IP ที่เชื่อได้, กฎ endpoint สถานะ, SA อนุมัติตัวเองไม่ได้, ข้าม lockout ด้วยคุกกี้เครื่อง) · `docs/adr/0003-rbac.md` (กฎเสริมของ SA) · `R1_CONTRACT.md` §6 (guard ตอบ 200 เป็นส่วนเบี่ยงเบนที่ยอมรับ — ทบทวน R6) · `docs/OPERATIONS.md` (TRUST_PROXY_HEADERS)
- R2 — `docs/adr/0002-auth-pin.md` §8 (โค้ดเชิญ: HMAC + HKDF, code_hint, rate limit จองก่อนตรวจ, ข้อจำกัด IP ร่วม/fixed window, ไม่มี ban list, คูลดาวน์ชวนซ้ำ) · `docs/adr/0003-rbac.md` §5 (กฎ membership-guard: การเขียนต้องตรวจ role ผู้กระทำซ้ำแบบอะตอมมิก) · `docs/adr/0007-notifications.md` (ชนิด `group.invite.received|accepted|declined`) · `R2_CONTRACT.md`
- เฟส 0 — งานวิจัยตั้งต้น `docs/research/RESEARCH_REPORT.md`
- เฟส 1 — `docs/prd/PRD.md` (stories U1–U15, เมทริกซ์สิทธิ์ §3) · `docs/prd/LEAD_DECISIONS.md`
- เฟส 1 — ADR 0001–0008: stack/โครงโปรเจกต์ · PIN auth + pepper · RBAC · เวลา/โซนเวลา · อัลกอริทึมหาเวลาว่างร่วม (+ fixtures/oracle) · การมองเห็นช่วงไม่ว่าง · การแจ้งเตือน · i18n และธีม
- เฟส 2 — `docs/design/ARCHITECTURE.md` (schema 17 ตาราง, API, env, cron) · `UX.md` · `UI_DIRECTION.md` (ธีม aurora, สัปดาห์เริ่มวันจันทร์) · `CONTRAST.md` · ตัวอย่าง HTML + ภาพหน้าจอ + เครื่องมือ (`contrast.mjs`, `shoot.mjs`)
- กติกาทีม: `CLAUDE.md`, `TEAM.md`, `PROCESS.md`, `SECRETARY.md` · ส่งงานแบบ git bundle (CLAUDE.md กฎ 10)
