# R0_CONTRACT.md — Foundation

> ผู้เขียน: Lead · 2026-10-16 · สถานะ: **boss เห็นชอบแล้ว** 2026-10-16 18:52 · ส่งงานแบบ bundle (§7.1)
> อ้างอิง: [PRD](docs/prd/PRD.md) · [ADR 0001–0008](docs/adr/) · [ARCHITECTURE](docs/design/ARCHITECTURE.md) · [UI_DIRECTION](docs/design/UI_DIRECTION.md) · [LEAD_DECISIONS](docs/prd/LEAD_DECISIONS.md)
> ข้อเสนอเลขเวอร์ชันเมื่อจบรอบ: **v0.1.0** (boss เป็นคนรัน release และ push)

## 1. เป้าหมาย
วางฐานที่ทุกรอบถัดไปสร้างต่อได้ทันทีโดยไม่ต้องรื้อ: โครงโปรเจกต์ที่ build ได้, CI เขียวครบทุกเกต, schema v1 ทั้งชุดพร้อม migration แรก, ระบบออกรุ่น, ธีม aurora + สว่าง/มืด + ไทย/อังกฤษ ที่สลับได้จริง, และ RBAC กลางที่มีเทสต์เมทริกซ์ครบ
**ผู้ใช้ยังสมัคร/ล็อกอินไม่ได้ในรอบนี้** (R1) — สิ่งที่ boss เห็นได้คือ shell ของแอปบน preview ที่สลับภาษา/ธีมได้ และ `/api/health` ที่ตอบ 200

Stories ที่แตะ: U14, U15 (โครงและกลไก) · §3 ทั้งตาราง (policy + เทสต์ ยังไม่มี endpoint ใช้)

## 2. ขอบเขต
**ทำ**
- โครง Next 16.4 + TypeScript + Tailwind 4 + ESLint ตาม ADR 0001 §1 · Node 24 (`.nvmrc`, `engines`)
- กฎ ESLint: ห้าม import `temporal-polyfill` และห้าม `new Date(` นอก `src/lib/calendar/**` + `tests/**` · ห้าม `src/lib/data/repos/**` import จาก `src/app/**` · ห้ามสี hex/px นอก `src/styles/tokens*` (stylelint หรือ grep ใน CI)
- `src/db/schema.ts` **ครบทั้ง v1** ตาม ARCHITECTURE §3 (17 ตาราง) + migration แรกใน `drizzle/` + client
- `src/lib/shared/**`: `errors.ts` (ErrorCode union ตาม ARCHITECTURE §6), `env.ts` (zod — ล้มตอนเริ่มถ้าตัวแปรต้องมีหาย), `result.ts`, `id.ts`, `clock.ts` (inject เวลาได้)
- `src/app/api/_lib/**`: route wrapper (CSRF Origin, zod, error→status, `Cache-Control: private, no-store`) + manifest
- `src/lib/rbac/**`: `actions.ts` (action ครบทุกแถวของ PRD §3 + สถานะ `must_change_pin`), `can.ts` (pure, ทำงานจริงครบ), `types.ts`, `errors.ts` — ยังไม่มี service ใดเรียกใช้
- endpoint: `GET /api/health` · `GET /api/cron/daily` · `POST /api/cron/heartbeat` · `POST /api/prefs` (ตั้ง cookie ภาษา/ธีมก่อนล็อกอิน)
- i18n: next-intl แบบไม่มี locale ใน URL (ADR 0008) · `messages/th.json`, `en.json` สำหรับ shell + `errors.*` ครบทุกรหัส
- ธีม: `data-theme` ฝั่งเซิร์ฟเวอร์จาก cookie (ไม่มีกระพริบ) · `system | light | dark` · aurora component (CSS ล้วน ตาม UI_DIRECTION §3.5)
- App shell: root layout, `(public)/login` เป็นหน้าแสดง (แป้น PIN ยังไม่ส่งข้อมูล), `(app)` layout + แถบนำทางล่าง 4 แท็บ + หน้าว่างของแต่ละแท็บ, หน้า 404 พร้อมแมว · ตัวสลับภาษา/ธีม
- แก้ที่ Lead จดไว้ในเฟส 2: A4 แถบล่างธีมมืดทึบขึ้น · A5 `--surface-veil` .92 + noise กัน banding · legend "ว่างครึ่งหนึ่งขึ้นไป" · `data-theme="system"` (Q10)
- Test infra: Vitest + libSQL `file:` ชั่วคราวที่รัน migration จริง · Playwright 375/390/768 × th/en × light/dark · โครงเทสต์เมทริกซ์ RBAC (สร้างอัตโนมัติจาก fixture)
- CI GitHub Actions: lint · typecheck · test · build · migration check · e2e · contrast (`docs/design/tools/contrast.mjs`)
- Ops: `next.config.ts` (security headers), `vercel.json` (cron), `.env.example` (ARCHITECTURE §7), `.github/workflows/keepalive.yml`, `docs/OPERATIONS.md` (ตั้งค่าครั้งแรก, pepper, keep-alive, กู้ Turso)
- Release: `CHANGELOG.md` (`[Unreleased]`), `docs/VERSIONING.md`, `scripts/release.ts` (boss รัน)

**ไม่ทำ (รอบอื่น)**: สมัคร/ล็อกอิน/PIN/session (R1) · `src/lib/auth/pin.ts` + fingerprint pepper (R1 — health รอบนี้แค่รายงานว่า `crypto.argon2` ใช้ได้) · กลุ่ม (R2) · ไลบรารีปฏิทิน (R3) · วันว่าง/นัด (R4) · หน้า admin (R5)

## 3. API & ชนิดข้อมูล
| Method/Path | ใคร | ผล |
|---|---|---|
| `GET /api/health` | ทุกคน | 200 `{ok, version, node, argon2: bool, db: bool, heartbeatAgeHours: {vercelCron, githubActions}}` · 503 ถ้า DB ต่อไม่ได้หรือ env ต้องมีหาย · ไม่เปิดเผยค่า env/ข้อผิดพลาดภายใน |
| `GET /api/cron/daily` | Vercel cron (Bearer `CRON_SECRET`) | เขียน `system_heartbeat('vercel-cron')` ก่อน แล้วงานทำความสะอาด ARCHITECTURE §8 ข้อ 1–3 · 401 ถ้า secret ผิด · idempotent |
| `POST /api/cron/heartbeat` | GitHub Actions (Bearer) | เขียน `system_heartbeat('github-actions')` · 401 ถ้า secret ผิด |
| `POST /api/prefs` | ทุกคน | body `{locale?: 'th'\|'en', theme?: 'system'\|'light'\|'dark'}` → ตั้ง cookie `mm_locale`/`mm_theme` (1 ปี, `SameSite=Lax`, `Secure`) · ค่านอกชุด → `VALIDATION` · R1 จะต่อให้บันทึกลงบัญชีเมื่อล็อกอิน |
รูปแบบ response: `{data}` หรือ `{error:{code, params}}` (ADR 0008 §5) · ทุก route ลงทะเบียนใน manifest

## 4. ความรับผิดชอบไฟล์ (บทบาท → ไฟล์)
| บทบาท | ไฟล์ |
|---|---|
| Full-stack (#14) — scaffold | `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `.gitignore` (รักษา `Pre-start/`) |
| Platform (#5) | `src/db/**`, `drizzle/**`, `drizzle.config.ts`, `src/lib/shared/**`, `src/lib/data/**` (โครง), `src/app/api/_lib/**`, `src/app/api/cron/**`, `src/app/api/prefs/**` |
| Auth & Access (#8) | `src/lib/rbac/**`, `tests/rbac/**` (fixture เมทริกซ์ — ร่วมกับ TEST) |
| UX & Brand (#4) | `src/styles/tokens*`, `src/components/brand/**` (Cat, Logo, Aurora), `public/brand/**`, เนื้อหา `messages/*.json`, `docs/design/**` |
| Front-end (#6) | `src/app/**` (ไม่รวม api), `src/components/**` (ไม่รวม brand), `src/i18n/**` |
| OPS (#10) | `.github/**`, `next.config.ts`, `vercel.json`, `.env.example`, `.nvmrc`, `src/app/api/health/**`, `scripts/pepper-fingerprint.ts` (โครง), `docs/OPERATIONS.md` |
| TEST (#11) | `tests/**` (ยกเว้น calendar), `vitest.config.ts`, `playwright.config.ts` |
| Release (#15) | `CHANGELOG.md`, `docs/VERSIONING.md`, `scripts/release*.ts` |
| QA (#12) + Security (#13) | ตรวจอิสระหลังทุกบทบาทส่ง (คนละ agent กับคนทำ) |

## 5. ลำดับ/ความขึ้นต่อกัน
```
ขั้น 1  Full-stack: scaffold (build เปล่าผ่าน + lint/typecheck ผ่าน)
ขั้น 2  ขนาน: Platform (schema+migration+shared+api/_lib) · Auth (rbac) · UX (tokens+brand+messages) · Release · OPS (CI ร่าง)
ขั้น 3  ขนาน: Front-end (shell, ต้องรอ tokens+messages) · TEST (infra + matrix + e2e, ต้องรอ schema+rbac) · OPS (health, ต้องรอ shared/env)
ขั้น 4  QA + Security ตรวจอิสระ → แก้ (commit `qa: …`)
ขั้น 5  Lead รวม รันเกตทั้งหมดซ้ำ → เลขาเขียนรายงาน → ส่ง boss พร้อมข้อเสนอ v0.1.0
```

## 6. เกณฑ์ผ่าน (Handoff Certificate อ้างเลขข้อ)
| # | เกณฑ์ | วิธีตรวจ / ผลที่คาดหวัง |
|---|---|---|
| R0-1 | build ได้บน Node 24 | `node -v` → v24.x · `npm ci && npm run build` → exit 0 |
| R0-2 | lint + typecheck | `npm run lint` · `npm run typecheck` → 0 error |
| R0-3 | กฎ ESLint ทำงานจริง | เทสต์ที่ใส่ไฟล์ฝ่าฝืน (`new Date(` ใน `src/app`, import `temporal-polyfill` นอก calendar, repo import จาก app) แล้ว lint ต้องล้มทั้ง 3 กรณี |
| R0-4 | migration | `npx drizzle-kit check` ผ่าน · apply ทุก migration บน DB ว่างได้ · schema มี 17 ตารางตาม ARCHITECTURE §3 · constraint สำคัญ (username unique ไม่สนตัวพิมพ์, admin กลุ่มละ 1, reset ค้างได้ 1/ผู้ใช้) มีเทสต์ที่พิสูจน์ว่าปฏิเสธจริง |
| R0-5 | env | แอปล้มตอนเริ่มพร้อมข้อความชัด ถ้าขาดตัวแปรต้องมี (เทสต์) · `.env.example` ไม่มีค่าลับจริง (grep) |
| R0-6 | RBAC เมทริกซ์ | `npm test -- rbac` → ครบทุกช่อง PRD §3 × 6 บทบาท (super admin, group admin, moderator, member, ไม่ใช่สมาชิก, ไม่ได้ล็อกอิน) + แถว `must_change_pin` · เทสต์ล้มถ้ามี action ใหม่แต่ไม่มีใน fixture (compile-time หรือ runtime) |
| R0-7 | route wrapper | เทสต์: non-GET ที่ Origin ผิด → `CSRF_REJECTED` · input ผิด → `VALIDATION` · ทุก response มี `Cache-Control: private, no-store` · ทุก route อยู่ใน manifest (เทสต์สแกน `route.ts`) |
| R0-8 | health + cron | เทสต์: health 200 พร้อม `argon2: true` บน Node 24 · cron ทั้งสองตอบ 401 เมื่อ secret ผิด · รันซ้ำ 2 ครั้งผลเท่าเดิม · `system_heartbeat.last_at` = เวลานาฬิกาจำลอง |
| R0-9 | i18n | ทุกคีย์ใน `th.json` มีใน `en.json` และกลับกัน (เทสต์) · ทุก ErrorCode มี `errors.<CODE>` ทั้งสองภาษา (เทสต์) · ไม่มีข้อความไทย/อังกฤษ hard-code ใน `src/app/**`, `src/components/**` (lint/เทสต์) |
| R0-10 | ธีม | E2E: ตั้ง `mm_theme=dark` แล้ว HTML แรกจากเซิร์ฟเวอร์มี `data-theme="dark"` (ไม่ต้องรอ JS) · `system` ตามค่า emulate ของ Playwright · สลับในหน้า "ฉัน"/หน้า login แล้วคงอยู่หลังรีโหลด |
| R0-11 | aurora | มีเลเยอร์ `filter` เดียว · ≤ 4 ก้อน · `prefers-reduced-motion` → animation หยุด (E2E วัด) · หยุดเมื่อแท็บไม่ active · ไม่มีสคริปต์ภายนอก |
| R0-12 | E2E มือถือ | `npm run test:e2e` → shell ทุกแท็บ × 375/390/768 × th/en × light/dark: ไม่มี horizontal scroll, ปุ่มแตะ ≥ 44px, ภาพหน้าจอเก็บเป็น artifact ของ CI |
| R0-13 | คอนทราสต์ | `node docs/design/tools/contrast.mjs` → exit 0 (รวมคู่บน aurora) เป็น job ใน CI |
| R0-14 | CI | workflow `ci.yml` รันข้อ 1–13 บน PR และ main · เขียวบน branch สะอาด (Lead รันซ้ำเอง) |
| R0-15 | keep-alive workflow | `keepalive.yml` มี `schedule: '17 */12 * * *'` + `workflow_dispatch` · ล้มเมื่อ health ≠ 2xx หรือ heartbeat vercel-cron > 48 ชม. (OPS ทดสอบกับ server จำลองในเครื่อง — ทดสอบจริงหลัง deploy) |
| R0-16 | security headers | `next.config.ts` ตั้ง CSP (ไม่มี `unsafe-eval`, tile OSM อนุญาตเฉพาะ img), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'` · E2E ตรวจ header จริง |
| R0-17 | release | `CHANGELOG.md` มี `[Unreleased]` ที่สรุปงาน R0 · `scripts/release.ts --dry-run 0.1.0` แสดงสิ่งที่จะทำโดยไม่แก้ไฟล์ |
| R0-18 | OPERATIONS.md | มีขั้นตอนตั้งค่าครั้งแรกที่ boss ทำตามได้ทีละข้อ (Turso, Vercel, env, pepper ตาม ADR 0002 §7.4, GitHub Secrets, แจ้งเตือน Actions) · Lead ทำตามบนเอกสารแล้วไม่ติดขั้นไหน |
| R0-19 | ขอบเขตไฟล์ | ทุก commit แตะเฉพาะไฟล์ในตาราง §4 ของบทบาทผู้เขียน (`git log --name-only` ตรวจ) · `user.name` = ชื่อบทบาท · commit แบบ conventional |
| R0-20 | ตรวจอิสระ | QA: Anti-slop checklist + ภาพหน้าจอ 4 ชุด · Security: CSRF, headers, ไม่มีความลับใน repo/log, cron auth · ทั้งคู่รันเกตซ้ำเอง |

## 7. ความเสี่ยง / สิ่งที่ boss ต้องตัดสินใจ
**ตัดสินใจ**
1. **โค้ดไปถึง GitHub ของ boss ทางไหน** — **ตัดสินแล้ว (ก) bundle** (boss 19:03): Lead ส่ง `maewmeet-r0.bundle` + คำสั่งให้ boss pull/push เอง · CI บน GitHub จะรันครั้งแรกหลัง boss push → Lead ตรวจผลจากที่ boss แจ้ง · repo `ieatbaozi-stack/maewmeet` (private)
   - (ก) **แนะนำ**: ทีมทำงานใน git ของเราเอง (commit แยกตามบทบาท) แล้วส่ง `maewmeet-r0.bundle` ไฟล์เดียวเข้าโฟลเดอร์ boss → boss รัน 2 คำสั่ง (`git pull <bundle> main` + `git push`) — ได้ประวัติ commit ครบ
   - (ข) boss ให้สิทธิ์ repo กับ session นี้ → ทีม push เป็น branch `r0` แล้ว boss กด merge PR เอง
2. อนุมัติ contract นี้ (หรือสั่งแก้)

**ความเสี่ยง**
- เครื่องทำงานของทีมเป็น Node 22 — Lead ทดสอบแล้ว `npx node@24` ได้ v24.22.0 และ `crypto.argon2` ใช้ได้ (2026-10-16) → ทีมรันเกตบน Node 24 ได้จริง
- Next 16 + TypeScript 7 อาจยังไม่เข้ากัน → pin 5.x/6.x ตาม ADR 0001
- deploy preview จริงต้องรอ boss สร้าง Turso + Vercel + env (ขั้นตอนใน OPERATIONS.md) — เกตที่ต้องใช้ preview จริง (Lighthouse, keep-alive จริง) จะปิดหลัง boss deploy
- aurora บน Android รุ่นล่าง: R0 วัดได้แค่บน Chromium จำลอง (CPU throttle 4×) — ตัวเลขจริงรอ boss ลองบนเครื่อง

## 8. สิ่งที่ boss ต้องทำในรอบนี้
- [ ] อนุมัติ contract + เลือกข้อ 7.1 (ก) หรือ (ข)
- [ ] (กำลังทำ) สร้าง GitHub repo **private** ใต้บัญชีส่วนตัว
- [ ] หลังทีมส่งงาน: push → สร้าง Turso + Vercel → ตั้ง env ตาม `docs/OPERATIONS.md` → ส่งลิงก์ preview ให้ทีมตรวจรอบสุดท้าย → รัน release v0.1.0
