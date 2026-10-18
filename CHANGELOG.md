# Changelog

การเปลี่ยนแปลงที่สำคัญทั้งหมดของ maewmeet (แมวเจอกัน) บันทึกไว้ที่นี่

รูปแบบตาม [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) และนับเวอร์ชันแบบ [Semantic Versioning](https://semver.org/lang/th/) — กติกาของเราอยู่ใน [docs/VERSIONING.md](docs/VERSIONING.md)
ชื่อรอบงาน (R0–R7) ไม่ใช่เลขเวอร์ชัน · เวอร์ชันออกโดย boss ด้วย `scripts/release.ts` เท่านั้น

## [Unreleased]

> รอบ R0 (Foundation) — ข้อเสนอเลขเวอร์ชัน: **v0.1.0** · ร่างตาม R0_CONTRACT §2 — Lead ปรับให้ตรงของที่รวมจริงก่อน release
> รอบ R1 (บัญชี + reset PIN + หน้า admin) — ข้อเสนอเลขเวอร์ชัน: **v0.2.0** (มีความสามารถใหม่ที่ผู้ใช้เห็น + env ใหม่) · ร่างตาม R1_CONTRACT §2 — Lead ปรับให้ตรงของที่รวมจริงก่อน release

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

### Changed
- R1 — `GET /api/auth/pin-reset/status` ตอบเพียง `none | pending | approved | closed` และคำขอที่ถูกปฏิเสธ/ยกเลิก/หมดอายุจะแสดง "ส่งคำขอแล้ว" จนครบ 7 วันนับจากที่ออกคุกกี้ แล้วจึง "ปิดแล้ว" (เพื่อไม่ให้รู้ว่า username มีจริงหรือไม่)
- R1 — ข้อความใต้แป้นกรอก PIN ในขั้น "ตั้ง/ยืนยัน PIN ใหม่" ตรงกับขั้นตอน (เดิมขึ้น "ใส่ PIN ของคุณ" ในขั้นยืนยัน)
- R1 — super admin ลบ/เปลี่ยนบทบาทตัวเองผ่านกลุ่มไม่ได้ (ใช้ออกจากกลุ่ม + โอน admin) · การเปิดดู audit log ถูกบันทึกเอง · super admin อนุมัติคำขอ reset ของตัวเองไม่ได้ (ใช้สคริปต์ break-glass)
- ดีไซน์ตามที่ Lead จดไว้ในเฟส 2: แถบล่างธีมมืดทึบขึ้น (A4) · `--surface-veil` .92 + noise กัน banding (A5) · legend "ว่างครึ่งหนึ่งขึ้นไป" · รองรับ `data-theme="system"` (Q10)

### Security
- R1 — จำนวนครั้งที่ผิดถูก "จอง" แบบอะตอมมิกก่อนตรวจ PIN (ทั้งต่อ username และต่อ IP): ยิงคำขอขนาน 60 ตัวตรวจ PIN ได้ไม่เกิน 5 ครั้งต่อ username และไม่เกิน 20 ครั้งต่อ IP · PIN ถูกในชุดที่ยิงหลังถูกล็อกไม่เข้าได้ · เปลี่ยน PIN (ใส่ PIN เดิม) ใช้ตัวนับชุดเดียวกัน
- R1 — อนุมัติคำขอ reset แล้วล้างตัวนับ lockout ของผู้ใช้ · `123456` กับคุกกี้เครื่องที่ผูกไว้ข้ามการล็อก username ได้ (ยังกินโควตา IP) · ใช้ reset เป็นธุรกรรมเดียว (ล้มกลางทางไม่เหลือสถานะครึ่งทาง)
- R1 — IP ของผู้เรียกเชื่อ header จาก proxy เฉพาะบน Vercel หรือเมื่อตั้ง `TRUST_PROXY_HEADERS=1` (ปลอม `x-forwarded-for` หลบเพดานไม่ได้) · ไม่เชื่อ = ถังร่วม `unknown` เพดาน ×50
- R1 — ไม่มี PIN/hash/token/pepper ใน response หรือ log (เทสต์ตรวจ) · คุกกี้ reset เซ็นด้วย HMAC ปลอมเวลาออกไม่ได้
- Security headers ใน `next.config.ts`: CSP (ไม่มี `unsafe-eval`, tile OSM อนุญาตเฉพาะรูปภาพ), `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
- cron ทั้งสอง endpoint ต้องมี `Authorization: Bearer <CRON_SECRET>` (ผิด → 401)
- ทุก request ที่ไม่ใช่ GET ตรวจ Origin · ความลับอยู่ใน env เท่านั้น (`.env.example` ไม่มีค่าจริง)
- `/api/health` ไม่เปิดเผยค่า env หรือรายละเอียดข้อผิดพลาดภายใน

### Upgrade notes
รุ่นแรก — ไม่มีของเดิมให้ย้าย แต่ต้องตั้งค่าครั้งแรกก่อน deploy (ทีละขั้นใน `docs/OPERATIONS.md`):
1. สร้างฐานข้อมูล Turso แล้วตั้ง `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` ใน Vercel
2. สร้างความลับเองบนเครื่อง (ห้ามส่งในแชท/ใส่ใน repo): `PIN_PEPPER_V1` (+ `PIN_PEPPER_CURRENT_VERSION=1`), `APP_SECRET`, `CRON_SECRET` · เก็บ pepper สำรอง 2 ที่ตาม ADR 0002 §7.4
3. ตั้ง `APP_ORIGIN` และตัวแปรอื่นตาม `.env.example`
4. GitHub Secrets: `CRON_SECRET` + `APP_ORIGIN` สำหรับ workflow keep-alive · เปิดแจ้งเตือน Actions ล้ม
5. รัน migration แรกกับฐาน Turso ก่อนเปิดใช้ แล้วตรวจ `GET /api/health` → 200
6. (R1) หลัง deploy ครั้งแรก boss สมัครบัญชีเองบนเว็บ แล้วตั้ง `is_admin = 1` ด้วย SQL บน Turso (ขั้นตอนใน `docs/OPERATIONS.md` H1) · **อย่าตั้ง `TRUST_PROXY_HEADERS=1` บน Vercel หรือเมื่อแอปเปิดรับคำขอตรงจากอินเทอร์เน็ตโดยไม่มี proxy** (ไม่จำเป็นบน Vercel — แพลตฟอร์มจัดการให้)

### Docs
- R1 — `docs/adr/0002-auth-pin.md` §3/§5 (จองก่อน verify, IP ที่เชื่อได้, กฎ endpoint สถานะ, SA อนุมัติตัวเองไม่ได้, ข้าม lockout ด้วยคุกกี้เครื่อง) · `docs/adr/0003-rbac.md` (กฎเสริมของ SA) · `R1_CONTRACT.md` §6 (guard ตอบ 200 เป็นส่วนเบี่ยงเบนที่ยอมรับ — ทบทวน R6) · `docs/OPERATIONS.md` (TRUST_PROXY_HEADERS)
- เฟส 0 — งานวิจัยตั้งต้น `docs/research/RESEARCH_REPORT.md`
- เฟส 1 — `docs/prd/PRD.md` (stories U1–U15, เมทริกซ์สิทธิ์ §3) · `docs/prd/LEAD_DECISIONS.md`
- เฟส 1 — ADR 0001–0008: stack/โครงโปรเจกต์ · PIN auth + pepper · RBAC · เวลา/โซนเวลา · อัลกอริทึมหาเวลาว่างร่วม (+ fixtures/oracle) · การมองเห็นช่วงไม่ว่าง · การแจ้งเตือน · i18n และธีม
- เฟส 2 — `docs/design/ARCHITECTURE.md` (schema 17 ตาราง, API, env, cron) · `UX.md` · `UI_DIRECTION.md` (ธีม aurora, สัปดาห์เริ่มวันจันทร์) · `CONTRAST.md` · ตัวอย่าง HTML + ภาพหน้าจอ + เครื่องมือ (`contrast.mjs`, `shoot.mjs`)
- กติกาทีม: `CLAUDE.md`, `TEAM.md`, `PROCESS.md`, `SECRETARY.md` · ส่งงานแบบ git bundle (CLAUDE.md กฎ 10)
