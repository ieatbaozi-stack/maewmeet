# ADR 0001 — Stack และโครงโปรเจกต์

- **Status**: Proposed (Architect, 2026-10-15) — รอ Lead/boss รับ · แก้รอบ 2 (2026-10-16): ข้อ 3.1 keep-alive ของ Turso
- **เกี่ยวข้อง**: [PRD §2 D12, §5, §7](../prd/PRD.md) · [ARCHITECTURE.md](../design/ARCHITECTURE.md) · ADR [0002](0002-auth-pin.md) [0004](0004-time-and-timezone.md) [0008](0008-i18n-and-theme.md)

## Context
PRD กำหนดตายตัว: Next.js (App Router) + TypeScript · Drizzle + Turso (libSQL/SQLite) · Vercel Hobby · Vitest + Playwright · GitHub Actions · ต้นทุน ≈ $0 ที่หลักสิบ–ร้อยผู้ใช้ ADR นี้ล็อก **เวอร์ชัน**, เลือก **ไลบรารีวันเวลา 1 ตัว**, ระบุข้อจำกัดแพลตฟอร์มที่กระทบดีไซน์ และวางโครงโฟลเดอร์ให้ตรงขอบเขตไฟล์ใน [TEAM.md](../team/TEAM.md)

## Decision

### 1. เวอร์ชัน (ตรวจจาก npm registry 2026-10-15 — R0 ให้ pin ตามนี้หรือ patch ที่ใหม่กว่าในสายเดียวกัน)
| ส่วน | เลือก | หมายเหตุ |
|---|---|---|
| Runtime | **Node.js 24.x** (`"engines": {"node": "24.x"}`) | Vercel default = 24.x (มี 22.x ด้วย) · ต้องใช้ 24 เพราะ `crypto.argon2` (ADR 0002) เพิ่มใน v24.7.0 · CI ใช้ 24 เหมือนกัน |
| Framework | **next 16.4.x** (latest 16.4.1, 2026-10-14) + react 19.x | Next 16: `cookies()`/`params` เป็น async, `middleware.ts` → `proxy.ts` (Node runtime), Turbopack เป็นค่าเริ่มต้น, `next lint` ถูกถอด (ใช้ ESLint ตรง) |
| `cacheComponents` | **ปิด** ใน v1 | ทุกหน้าอ่าน cookie (session/locale/theme) อยู่แล้ว เป็น dynamic ทั้งแอป — เปิดแล้วต้องห่อ Suspense รอบทุกจุดที่อ่าน cookie โดยไม่ได้ประโยชน์ |
| `proxy.ts` | **ไม่ใช้** ใน v1 | ตรวจ session ใน Route Handler/Server Component ผ่าน service layer (ไม่พึ่ง proxy เป็นด่านสิทธิ์) · security headers ใส่ใน `next.config.ts` (OPS) |
| ORM | drizzle-orm 0.45.x + drizzle-kit 0.31.x | dialect `turso` / driver `drizzle-orm/libsql` |
| DB client | @libsql/client 0.18.x | เทสต์ใช้ `file:` libSQL ชั่วคราว รัน migration จริง |
| Validation | zod 4.x | schema input ทุก endpoint |
| วันเวลา | **temporal-polyfill 1.0.x** (ดูข้อ 2) | |
| i18n | next-intl 4.14.x | ADR 0008 |
| CSS | Tailwind 4.x + CSS variables tokens | UX เป็นเจ้าของ tokens |
| แผนที่ | Leaflet 1.9.4 + tile OSM | ตาม D11 · ปฏิบัติตาม [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) (attribution มุมขวาล่าง, ส่ง Referer) |
| ค้นหาสถานที่ | Nominatim ผ่าน **proxy ฝั่งเซิร์ฟเวอร์** `/api/places/search` + cache ใน DB + throttle 1 req/s ทั้งระบบ + kill switch env | [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/): สูงสุด 1 req/s รวมทุกผู้ใช้, ต้องระบุตัว (User-Agent), ห้าม autocomplete, แนะนำ proxy+cache, ต้องปิดบริการได้โดยไม่ต้องอัปเดตซอฟต์แวร์ |
| Test | vitest 5.x · @playwright/test 1.64.x | |
| TypeScript | ตามที่ `create-next-app@16.4` ติดตั้ง | npm latest เป็น 7.0.x — R0 ต้องยืนยันว่า `next build` (type-check) ผ่านกับเวอร์ชันที่ใช้ ถ้าไม่ผ่านให้ pin 5.x/6.x |

### 2. ไลบรารีวันเวลา: `temporal-polyfill` (FullCalendar)
- ใช้ **เฉพาะภายใน `src/lib/calendar/**`** (ห่อด้วย API ของเราเอง) — โค้ดอื่นห้าม import ตรง (ESLint `no-restricted-imports`) และห้ามใช้ `new Date()` คำนวณวัน (CLAUDE.md กฎ 9)
- เหตุผล:
  1. **ถูกต้องเรื่อง tz โดยชนิดข้อมูล**: แยก `PlainDate` (busy ทั้งวัน = วันที่ลอย ไม่มี tz), `Instant` (UTC ในฐาน), `ZonedDateTime` (แปลงหน้าต่างวัน 08:00–22:00 ของ tz กลุ่ม) — ตรงกับโมเดลใน ADR 0004 พอดี ไม่ต้องเลียนแบบด้วย `Date`
  2. **ขนาด**: 19.5 kB min+gzip (ตาม README ของแพ็กเกจ) เทียบ Luxon 24.2 kB gzip (วัดจริงจาก `luxon.min.js` 3.7.2) · date-fns+@date-fns/tz เล็กกว่า แต่ไม่มีชนิด `PlainDate`/`ZonedDateTime` ต้องเขียนกฎขอบวันเองบน `Date` ซึ่งเป็นจุดเสี่ยงที่ PROCESS ข้อ 10 เตือน
  3. **อนาคต**: Temporal เป็นมาตรฐาน — native แล้วใน Chrome/Edge 144, Firefox 139, Node 26 แต่ **Safari/iOS ยังไม่มี** (MDN browser-compat-data 8.1.5, 2026-10-08: safari = preview, safari_ios = false) และ Vercel Node 24 ยังไม่มี → ต้องใช้ polyfill ทั้งฝั่ง client และ server ใน v1 เมื่อทุกเป้าหมายมี native ค่อยถอด (เปลี่ยนแค่ไฟล์เดียวใน `src/lib/calendar`)
- การ**แสดงผล** (พ.ศ./ชื่อเดือน) ใช้ `Intl.DateTimeFormat` (`th-TH-u-ca-buddhist`) — ทดลองแล้วได้ `วันพฤหัสบดีที่ 15 ตุลาคม พ.ศ. 2569 เวลา 10:30` (ADR 0004)

### 3. ข้อจำกัดแพลตฟอร์มที่กระทบดีไซน์ (ตรวจ 2026-10-15)
**Vercel Hobby** ([limits](https://vercel.com/docs/limits), [fair use](https://vercel.com/docs/limits/fair-use-guidelines), [cron](https://vercel.com/docs/cron-jobs/usage-and-pricing))
- ต่อเดือน: Function Invocations 1,000,000 · Active CPU 4 ชม. · Provisioned Memory 360 GB-hr · Fast Data Transfer 100 GB · Fast Origin Transfer 10 GB
- Function: 2 GB / 1 vCPU, max duration 300 s · runtime log เก็บ **1 ชม.** เท่านั้น
- **Cron: วันละ 1 ครั้ง เวลาคลาดได้ ±59 นาที** และ Vercel ไม่ retry → งานที่ต้องตรงเวลา (หมดอายุ `123456` 24 ชม., หมดอายุโค้ดเชิญ) **ต้องตรวจแบบ lazy ตอนใช้งาน** ไม่พึ่ง cron · cron ใช้แค่ทำความสะอาด + กัน Turso archive
- **ห้ามใช้เชิงพาณิชย์** (รวมถึงโฆษณา/รับเงินทำเว็บ) · โปรเจกต์ Hobby **ต่อกับ Git repo ที่เป็นของ GitHub Organization ไม่ได้** → repo ต้องอยู่ใต้บัญชีส่วนตัวของ boss
- Cron ป้องกันด้วย env `CRON_SECRET` ที่ Vercel ส่งมาเป็น `Authorization: Bearer …` อัตโนมัติ ([manage cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs))
- IP ผู้ใช้: `x-forwarded-for`/`x-real-ip` ถูก Vercel **เขียนทับ** กันปลอม ([request headers](https://vercel.com/docs/headers/request-headers)) → ใช้เป็นกุญแจ rate limit ได้ (ADR 0002)

**Turso Free** ([pricing](https://turso.tech/pricing.md), [archive](https://docs.turso.tech/cli/group/unarchive.md))
- 100 DB · 5 GB · rows read 500 ล้าน/เดือน · **rows written 10 ล้าน/เดือน** · แผนถัดไป Developer $5.99/เดือน
- **DB บนแผนฟรีถูก archive/sleep หลังไม่มีการใช้งาน 10 วัน** — เอกสารทางการ 2 หน้าใช้คำต่างกัน: "archived after 10 days of inactivity" ([group unarchive](https://docs.turso.tech/cli/group/unarchive)) และ "go to sleep after 10 days of inactivity" ([db wakeup](https://docs.turso.tech/cli/db/wakeup)) · **ตรวจซ้ำ 2026-10-16: เอกสารไม่ได้นิยามว่า "activity" นับจากอะไร (read อย่างเดียวนับหรือไม่) และไม่ได้บอกว่า request ไปยังฐานที่หลับแล้วจะปลุกเองหรือไม่** — กู้ได้ด้วย `turso db wakeup <db>` / `turso group unarchive <group>` เท่านั้นตามเอกสาร
  → จึงออกแบบ keep-alive แบบ **ไม่พึ่งสมมติฐาน** (ข้อ 3.1)
- งบการเขียน: login 1 ครั้ง ≈ 3–5 row writes (session, throttle, rate bucket) — 10 ล้าน/เดือนเหลือเฟือที่ขนาดร้อยคน แต่ห้ามเขียนทุก request (เช่น `last_seen_at` ให้อัปเดตไม่เกินวันละครั้งต่อ session — ADR 0002)

#### 3.1 Keep-alive ของ Turso (boss สั่ง 2026-10-16: ต้อง active ตลอด)
| ชั้น | กลไก | ความถี่ | ช่องว่างสูงสุดระหว่างครั้ง |
|---|---|---|---|
| 1. หลัก | Vercel cron → `GET /api/cron/daily` — งานแรกคือ **เขียน** (ไม่ใช่แค่อ่าน) `UPSERT system_heartbeat(source='vercel-cron', last_at=now)` แล้วจึงทำความสะอาด | วันละครั้ง (Hobby) คลาด ±59 นาที | ~26 ชม. (24 ชม. + คลาดสุดสองฝั่ง) — ห่างจาก 10 วันมาก แต่ Vercel ระบุว่า cron "best effort" อาจหลุดบางครั้งและไม่ retry |
| 2. สำรองอิสระ | GitHub Actions `schedule` (`.github/workflows/keepalive.yml`, OPS) → `curl` `POST /api/cron/heartbeat` ด้วย `Authorization: Bearer $CRON_SECRET` (เก็บใน GitHub Secrets) → เขียน `system_heartbeat(source='github-actions')` แล้ว `GET /api/health` | ทุก 12 ชม. (`17 */12 * * *` — เลี่ยงต้นชั่วโมงตามคำแนะนำ GitHub) | ~12 ชม. + ความหน่วงช่วงโหลดสูง |
| 3. ใช้งานจริง | ทุก login/เขียนข้อมูลของผู้ใช้ | ตามการใช้งาน | — |

- ใช้ **การเขียน** เป็นตัว keep-alive เพราะเอกสารไม่ยืนยันว่า read นับ — การเขียนเป็นสัญญาณที่แรงที่สุดที่เราควบคุมได้ (ต้นทุน 2–3 row writes/วัน จากโควตา 10 ล้าน/เดือน)
- ต้องพังพร้อมกันทั้ง 2 ชั้นติดต่อกัน **เกิน 9 วัน** จึงจะถึงเกณฑ์ archive — และชั้น 2 ทำหน้าที่ **เตือน** ด้วย: workflow ล้ม (endpoint ไม่ตอบ 2xx, health 503, หรือ heartbeat ของ `vercel-cron` เก่ากว่า 48 ชม.) → GitHub แจ้ง workflow ล้ม → boss รู้ภายใน ~12 ชม. มีเวลาแก้อีกหลายวัน · **เงื่อนไข**: GitHub ส่งแจ้งเตือนของ scheduled workflow ให้ "ผู้ใช้ที่สร้าง workflow" (หรือคนล่าสุดที่แก้บรรทัด cron / เปิดใช้ใหม่) ([notifications for workflow runs](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)) → ไฟล์นี้ต้องถูก push จากบัญชี GitHub ของ boss และ boss เปิดการแจ้งเตือน Actions (อย่างน้อยแบบ "failed only") ทางอีเมล — OPS ใส่เป็นขั้นตอนตรวจใน OPERATIONS.md
- ข้อควรรู้ของ GitHub ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)): `schedule` อาจหน่วง/หลุดช่วงโหลดสูง · **repo สาธารณะ**ที่ไม่มีความเคลื่อนไหว 60 วันจะถูกปิด scheduled workflow อัตโนมัติ → **ให้ repo เป็น private** (ไม่โดนกติกานี้) ถ้าเป็น public ต้องมี commit อย่างน้อยทุก 60 วัน
- ชั้น 2 วิ่งผ่าน Vercel ไม่ได้ต่อ Turso ตรง → ไม่ต้องเอา `TURSO_AUTH_TOKEN` ไปไว้ใน GitHub (ลดจุดรั่ว) · ข้อเสีย: ถ้า Vercel ล่มทั้งโปรเจกต์ ทั้งสองชั้นล้มพร้อมกัน — แต่ชั้น 2 จะส่งอีเมลเตือนทันที
- `/api/health` รายงาน `heartbeatAgeHours` ต่อ source (ไม่เปิดเผยข้อมูลอื่น) · หน้า super admin แสดงเวลา heartbeat ล่าสุด
- แผนสำรองถ้าหลับไปแล้ว: runbook ใน `docs/OPERATIONS.md` (OPS) — `turso db wakeup` / `turso group unarchive` แล้วเช็ก health · ถ้าต้องการตัดความเสี่ยงนี้ถาวร: แผน Developer $5.99/เดือน (เอกสารระบุกติกา 10 วันเฉพาะ "users on a free plan")

### 4. โครงโปรเจกต์
รายละเอียดเต็มอยู่ใน [ARCHITECTURE.md §1](../design/ARCHITECTURE.md) — หลักการ:
- `src/lib/<domain>/**` = logic บริสุทธิ์ทดสอบได้โดยไม่มี Next (calendar, rbac, auth) · `src/lib/data/**` = repository + service (เรียก rbac ทุกครั้ง) · `src/app/api/**` = Route Handler บาง ๆ (parse → service → serialize)
- **การ mutate ทั้งหมดผ่าน Route Handler ใน `src/app/api/**`** (ไม่ใช้ Server Actions เขียนข้อมูลใน v1 — กันการตรวจสิทธิ์หลุดไปอยู่ในไฟล์ของ Front-end) · Server Component อ่านข้อมูลผ่าน service function เดียวกัน (ผ่าน policy เหมือนกัน)
- migration อยู่ใน `drizzle/` สร้างด้วย `drizzle-kit generate` และ CI รัน `drizzle-kit check` + apply บน DB ว่าง

## Alternatives considered
| ทางเลือก | ทำไมไม่เลือก |
|---|---|
| Luxon | ไม่มีชนิด "วันที่ลอย" แยกชัด, ไม่ tree-shake (24.2 kB gzip ทั้งก้อน), และเป็นทางที่ต่างจากมาตรฐาน Temporal ที่เบราว์เซอร์กำลังมี |
| date-fns 4 + @date-fns/tz (`TZDate`) | เล็กและนิยม แต่ทุกอย่างยังเป็น `Date` (instant) — busy ทั้งวันต้องแทนด้วยเที่ยงคืนของ tz หนึ่ง ทำให้กฎ "วันที่ลอย" และขอบวันข้าม tz เขียนเองและพลาดง่าย |
| @js-temporal/polyfill (ของ champions) | ถูกต้องตาม spec แต่ใหญ่กว่า (~52 kB ตามตารางเทียบใน README ของ temporal-polyfill) และ release ล่าสุด 0.5.1 (2025-03) ช้ากว่า |
| ใช้ Server Actions สำหรับ mutation | สะดวกฝั่ง Front-end แต่การตรวจสิทธิ์จะกระจายไปไฟล์ใน `src/app/**` ของ Front-end ขัด PROCESS ข้อ 6 และขอบเขตไฟล์ |
| Next 15.5 (LTS สายเก่า) | ยังได้ patch แต่โปรเจกต์ใหม่ควรเริ่มที่ 16 เพื่อไม่ต้อง migrate `middleware`→`proxy` และ async API ทีหลัง |

## Consequences
- + ทุกจุดคำนวณเวลาอยู่ไฟล์เดียว เปลี่ยนเป็น native Temporal ได้ทีหลังโดยไม่แตะโค้ดอื่น
- + ไม่มี native binary (argon2 ใช้ `node:crypto` — ADR 0002) → bundle บน Vercel ไม่มีปัญหา prebuilt
- − bundle client +~20 kB gzip จาก polyfill (โหลดเฉพาะหน้าปฏิทิน/ฟอร์มเวลา ด้วย dynamic import ถ้า Lighthouse ไม่ผ่าน ≥ 85)
- − ผูกกับ Node 24 (เครื่อง dev ต้องใช้ 24 ด้วย — R0 ใส่ `.nvmrc`)
- − Cron วันละครั้ง: งานพื้นหลัง (outbox LINE v1.x) ต้องส่งทันทีด้วย `after()` ของ Next แล้วให้ cron เก็บตก

## Test requirements
- R0: `npm run build` ผ่านบน Node 24 ใน CI · health check (`/api/health`) บน preview ตอบ 200 และรายงาน `node >= 24.7` + `crypto.argon2` ใช้ได้ + ต่อ DB ได้ (PRD §8 ข้อ 4, PROCESS เกต Build)
- ESLint rule ห้าม import `temporal-polyfill` นอก `src/lib/calendar/**` และห้าม `new Date(` นอก `src/lib/calendar/**` + `tests/**` (CLAUDE.md กฎ 9) — มีเทสต์ lint ที่ล้มเมื่อฝ่าฝืน
- `drizzle-kit check` + apply ทุก migration บน DB ว่าง (PROCESS เกต Migration)
- keep-alive (ข้อ 3.1): `/api/cron/daily` และ `/api/cron/heartbeat` เขียนแถว `system_heartbeat` ของ source ตัวเองทุกครั้ง (เทสต์ตรวจ `last_at` = เวลานาฬิกาจำลอง) · workflow GitHub ล้มเมื่อ health 503 หรือ heartbeat `vercel-cron` เก่ากว่า 48 ชม. (OPS ทดสอบด้วย `workflow_dispatch` บน preview)
- cron `/api/cron/daily` และ `/api/cron/heartbeat`: ปฏิเสธเมื่อไม่มี/ผิด `CRON_SECRET` (401) · รันซ้ำ 2 ครั้งติดได้ผลเท่าเดิม (idempotent)
- `/api/places/search`: ครั้งที่สองด้วยคำค้นเดียวกันไม่เรียก Nominatim (cache) · เกิน 1 req/s ทั้งระบบได้ `RATE_LIMITED` · ตั้ง `PLACE_SEARCH_ENABLED=false` แล้วได้ `FEATURE_DISABLED`
