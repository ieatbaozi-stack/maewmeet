# Changelog

การเปลี่ยนแปลงที่สำคัญทั้งหมดของ maewmeet (แมวเจอกัน) บันทึกไว้ที่นี่

รูปแบบตาม [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) และนับเวอร์ชันแบบ [Semantic Versioning](https://semver.org/lang/th/) — กติกาของเราอยู่ใน [docs/VERSIONING.md](docs/VERSIONING.md)
ชื่อรอบงาน (R0–R7) ไม่ใช่เลขเวอร์ชัน · เวอร์ชันออกโดย boss ด้วย `scripts/release.ts` เท่านั้น

## [Unreleased]

> รอบ R0 (Foundation) — ข้อเสนอเลขเวอร์ชัน: **v0.1.0** · ร่างตาม R0_CONTRACT §2 — Lead ปรับให้ตรงของที่รวมจริงก่อน release

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

### Changed
- ดีไซน์ตามที่ Lead จดไว้ในเฟส 2: แถบล่างธีมมืดทึบขึ้น (A4) · `--surface-veil` .92 + noise กัน banding (A5) · legend "ว่างครึ่งหนึ่งขึ้นไป" · รองรับ `data-theme="system"` (Q10)

### Security
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

### Docs
- เฟส 0 — งานวิจัยตั้งต้น `docs/research/RESEARCH_REPORT.md`
- เฟส 1 — `docs/prd/PRD.md` (stories U1–U15, เมทริกซ์สิทธิ์ §3) · `docs/prd/LEAD_DECISIONS.md`
- เฟส 1 — ADR 0001–0008: stack/โครงโปรเจกต์ · PIN auth + pepper · RBAC · เวลา/โซนเวลา · อัลกอริทึมหาเวลาว่างร่วม (+ fixtures/oracle) · การมองเห็นช่วงไม่ว่าง · การแจ้งเตือน · i18n และธีม
- เฟส 2 — `docs/design/ARCHITECTURE.md` (schema 17 ตาราง, API, env, cron) · `UX.md` · `UI_DIRECTION.md` (ธีม aurora, สัปดาห์เริ่มวันจันทร์) · `CONTRAST.md` · ตัวอย่าง HTML + ภาพหน้าจอ + เครื่องมือ (`contrast.mjs`, `shoot.mjs`)
- กติกาทีม: `CLAUDE.md`, `TEAM.md`, `PROCESS.md`, `SECRETARY.md` · ส่งงานแบบ git bundle (CLAUDE.md กฎ 10)
