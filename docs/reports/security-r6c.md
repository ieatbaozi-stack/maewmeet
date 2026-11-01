# Security review — R6C (ตั้งสี/รูปทรงของตัวเองต่อกลุ่ม · migration 0002)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-01 · `git diff main...HEAD` (branch `feat/r6c-member-appearance`, HEAD `7460a3b`) · เทียบ R6C_CONTRACT §1/§2/§4, ADR 0003, กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่านโค้ด rbac/route/service/repo/serializer/migration ทั้งหมดใน diff + รันเทสต์ของทีมเอง + PoC แบบ integration (handler จริง + libSQL ไฟล์จริง + migration จริง ผ่าน `tests/groups/harness`) · ไฟล์ช่วย/PoC อยู่นอก repo ใน scratchpad (ไม่ commit): `poc/tests/poc.test.ts`, `afb/tests/afb.test.ts` (สำเนา authorize-first ที่แก้ตัวแยก path), `gen/` (drizzle-kit generate ทดลอง), `eperm-preload.cjs` · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows (checkout CRLF) · TEMP/TMP ชี้ scratchpad + preload ข้าม EPERM ของ `fs.rmSync`
- สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ดเท่านั้น

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 (L1–L2) |
| Info | 4 |

**Verdict: ผ่านแบบมีข้อสังเกต** — ไม่พบทางตั้งหน้าตาให้คนอื่น, ไม่พบการรั่วข้ามกลุ่ม, ด่าน CSRF/PIN/suspended/rate limit/validation ทำงานจริง, migration 0002 ปลอดภัยกับฐานที่มีข้อมูล และยืนยันได้ว่า SQL ที่ drizzle-kit 0.31.11 generate รันไม่ได้จริง ข้อพบเป็นระดับต่ำ (เอกสาร/กระบวนการ และเทสต์บน Windows)

## Verdict ต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **RBAC `member.setOwnAppearance`** | **PASS** | 📖 `src/lib/rbac/can.ts:154-156` ใช้ `inGroup` (กลุ่มลบ/คนนอกที่ไม่ใช่ SA → NOT_FOUND) แล้ว `role !== null ? ALLOW : FORBIDDEN` → SA ที่ไม่ใช่สมาชิก 403 ไม่ใช่ `anyMember` (ซึ่งให้ SA ผ่าน) · ขั้น 1–3 ของ `can()` (anon/suspended/must_change_pin) มาก่อน · ✅ `tests/rbac` เมทริกซ์ `r(FB, OK, OK, OK, OK, NF, AUTH)` ผ่าน (ลำดับคอลัมน์ `SA_nonmember, SA_member, GA, MOD, MEM, NM, AN` — `tests/rbac/matrix.fixture.ts:17`) |
| **ตั้งของคนอื่นไม่ได้** | **PASS** | 📖 `services/groups.ts:280-289` ใช้ `asUser(actor).id` จาก session เท่านั้น · schema `.strict()` มีแค่ `color`/`shape` · route ไม่อ่าน query · ✅ PoC: `PATCH …/me/appearance?uid=<alice>&userId=<alice>` โดย bob → 200 และแถวของ alice ยัง `NULL/NULL` แถวของ bob = `7/8` · ✅ body `{userId}` → 400 `UNKNOWN_FIELD` · ✅ manifest มี `/appearance` ตัวเดียว (`me`) · 📖 `PATCH /members/me` (ไม่มี `/appearance`) ตกไปที่ `[uid]` และ `uid` ต้องเป็น uuid → 400 |
| **route / wrapper** | **PASS** | 📖 `route.ts` ผ่าน `route()` + manifest `PATCH /api/groups/:gid/members/me/appearance` `auth: 'actor'` (`manifest.ts:54`) → CSRF Origin+JSON, zod, actor, `no-store` · ✅ สำเนา authorize-first ส่วน B (แก้แค่ตัวแยก path) 133/133 ผ่าน รวมไฟล์ route ใหม่ และ "manifest ไม่มี entry กำพร้า" · ✅ `tests/groups/appearance.test.ts`: CSRF (Origin อื่น/`null`/ไม่มี Origin/`text/plain`) 403, anon 401, suspended 401, must_change_pin 403 `PIN_CHANGE_REQUIRED` ไม่เขียน, กลุ่มลบ 404, คนนอก 404, SA นอกกลุ่ม 403 ไม่สร้างแถว, rate limit 60 แล้ว 429 + `Retry-After` · ✅ `tests/auth/must-change-pin.test.ts` ครอบ route ใหม่ (SAMPLE_BODY) |
| **validation** | **PASS** | ✅ PoC: `true`/`[1]` → INVALID_TYPE · `2**53` → TOO_LARGE · `0` → TOO_SMALL · ขาดคีย์ → REQUIRED · `__proto__`/คีย์เกิน → UNKNOWN_FIELD · body 70 KB → 400 `_body: TOO_LARGE` · `1e1`/`1.0` (= 10/1 ใน JSON) → 200 ถูกต้อง · ✅ เทสต์ทีม: 11, 1.5, `"3"`, -1 → 400 · ✅ CHECK ใน DB เป็นด่านสุดท้าย (0/11/-1/1.5/'red' ถูกปฏิเสธ — `migration-0002.test.ts`) |
| **race / กลุ่มลบระหว่างทาง** | **PASS** | 📖 `repos/group-member.ts:211-228` UPDATE คำสั่งเดียวมีเงื่อนไข (group_id, user_id) + `EXISTS groups … deleted_at IS NULL` → ออก/ถูกลบ/กลุ่มลบระหว่าง authorize กับ UPDATE = 0 แถว → 404 ไม่สร้างแถวใหม่ · ✅ ออกแล้วกลับเข้า = แถวใหม่ slot NULL |
| **ข้อมูลรั่ว (DTO)** | **PASS** | 📖 `colorIndex`/`shapeIndex` ออกเฉพาะใน DTO ที่สมาชิก (หรือ SA) เห็นอยู่แล้ว (group detail, calendar, availability, นัด/RSVP/เตือนนัดทับ) · join `group_member` ผูก `groupId` ของกลุ่ม/นัดนั้นทุกจุด (`repos/appointment.ts:262-265` RSVP, `services/appointments.ts:274-279` list ใช้ `byGroup` ต่อกลุ่ม) → ค่าของกลุ่ม A ไม่ไปโผล่ในกลุ่ม B (✅ เทสต์ R6C-2) · `myAppearance` = ของผู้ดูเท่านั้น; SA ที่ไม่ใช่สมาชิก → `null` (`serializers/groups.ts:66,84`, `serializers/appointments.ts:176-182`) · ✅ response PATCH มี 4 ฟิลด์ (`color, colorIndex, shape, shapeIndex`) ไม่มี userId/username/hash · ✅ คนนอก กับ กลุ่มที่ไม่มีจริง ได้ body ไบต์เดียวกัน `{"error":{"code":"NOT_FOUND"}}` (ไล่หากลุ่มไม่ได้) |
| **ไม่ลง audit** | **PASS (เห็นด้วย)** | ค่าแสดงผลส่วนตัวของผู้กระทำเอง ไม่มีผลต่อสิทธิ์/ข้อมูลของคนอื่น และ SA ที่ไม่ใช่สมาชิกถูกปฏิเสธ (ไม่มีกรณี "ใช้สิทธิ์ SA" ที่ต้องติดธง audit ตาม ADR 0003 §2.6) · ✅ เทสต์ "ไม่ลง audit log" ผ่าน · ข้อเสีย: ย้อนดูไม่ได้ว่าใครเปลี่ยนเมื่อไร (ดู Info 3) — ยอมรับได้ |
| **migration 0002** | **PASS (มี L1)** | ✅ ยืนยันข้ออ้าง platform: รัน drizzle-kit 0.31.11 `generate` ใน scratchpad (journal/snapshot ก่อน 0002 + schema ปัจจุบัน) → ได้ `PRAGMA foreign_keys=OFF` + `CREATE TABLE __new_group_member` + `INSERT … SELECT …, "color_slot", "shape_slot" FROM group_member` (คอลัมน์ยังไม่มีในตารางเดิม → no such column) + `DROP TABLE` + `RENAME` — รันไม่ได้ และเป็นการ rebuild ตารางที่เสี่ยงกว่ามาก · ✅ SQL มือ = `ALTER TABLE ADD` 2 คอลัมน์ nullable + CHECK ระดับคอลัมน์ ไม่ rebuild ไม่แตะ FK/index/ข้อมูล · ✅ snapshot ที่ generate เองเทียบกับ `drizzle/meta/0002_snapshot.json` (ตัด `id`) = เท่ากันทุกไบต์เชิงโครงสร้าง · `prevId` ต่อจาก 0001 ถูก · ✅ `npm run db:check` = "Everything's fine" · ✅ `migration-0002.test.ts`: ฐานเก่าที่มีข้อมูล → แถวเดิมครบ slot NULL, index/FK cascade/role CHECK ยังอยู่, apply ซ้ำไม่พัง · ลำดับ deploy: 📖 โค้ดเก่าเลือกคอลัมน์ระบุชื่อ (drizzle) และ INSERT ไม่ใส่คอลัมน์ใหม่ → migrate ก่อน deploy ปลอดภัย · โค้ดใหม่บนฐานที่ยังไม่ migrate จะพัง (`listMembers` เลือกทั้งแถว) → ต้องรัน B6/B7 ก่อน merge ตาม OPERATIONS (เขียนไว้แล้ว) · ไม่ได้แตะ Turso |
| **ความลับ / log** | **PASS** | ✅ grep diff ไม่พบ secret/token/`process.env` ใหม่ · `.env.example` ไม่เปลี่ยน · 📖 ไม่มี `console.*` ใหม่ใน service/route/คอมโพเนนต์ · error ที่ไม่คาดคิดผ่าน `logUnexpected` (log แค่ชื่อชนิด) |
| **XSS** | **PASS** | 📖 `AppearanceSection.tsx` เรียก `callApi` (ตัวกลางที่ส่ง JSON same-origin) · ไม่มี `dangerouslySetInnerHTML`/`innerHTML` · `data-color`/`data-shape` มาจากตัวเลขของเซิร์ฟเวอร์ |

## Findings

### L1 — Low · migration 0002 เขียนมือ ขัดคอมเมนต์ "ห้ามเขียน SQL มือ" ใน `drizzle.config.ts:2` โดยยังไม่มีบันทึกข้อยกเว้นในเอกสารกติกา 📖✅
- **ที่มา**: `drizzle.config.ts:2` ระบุ `generate: npm run db:generate (ห้ามเขียน SQL มือ)` · `drizzle/0002_r6c_member_appearance.sql` เขียนมือ (เหตุผลอยู่ในหัวไฟล์และ `docs/OPERATIONS.md` เท่านั้น)
- **ยืนยันแล้ว**: ข้ออ้างจริง (ดูเกต migration) และ SQL มือปลอดภัยกว่าที่ generate ได้ · snapshot ตรง schema จึง `generate` ครั้งต่อไปไม่สร้าง diff ซ้ำ
- **ความเสี่ยง**: ครั้งหน้า agent อาจ "แก้ให้ถูกกติกา" ด้วยการ generate ใหม่ (ได้ SQL rebuild ที่ `INSERT…SELECT` คอลัมน์ที่ไม่มี หรือในกรณีอื่นที่รันได้ = rebuild ตารางบนฐานจริงพร้อม `PRAGMA foreign_keys=OFF` ซึ่งไม่มีผลภายในธุรกรรมของ migrator) หรือเขียนมือโดยไม่ตรวจ snapshot
- **แนวทาง** (Lead/platform): ปรับคอมเมนต์ใน `drizzle.config.ts` (หรือ ADR 0001) ให้ระบุข้อยกเว้น: "เขียนมือได้เฉพาะเมื่อ generate ผิด · ต้องเทียบ snapshot กับผล generate + `db:check` + migration test บนฐานมีข้อมูล" · ไม่บล็อกการ merge

### L2 — Low · `tests/security/authorize-first.test.ts:154` สแกน route ไม่เจอบน Windows (ปัญหาเดิม ไม่ใช่งานรอบนี้) ✅
- **ที่มา**: `walk(...)` คืน path แบบ `\` บน Windows แต่ predicate ใช้ `f.endsWith('/route.ts') && !f.includes('/_lib/')` → `ROUTE_FILES = []` → "พบ route ให้สแกน" ล้ม (0 < 20) และ "manifest ไม่มี entry กำพร้า" ล้มที่ `GET /api/cron/daily` (entry แรกที่ตรวจ ไม่เกี่ยวกับ cron โดยเฉพาะ) · ไฟล์เทสต์นี้ไม่ถูกแก้ใน branch (`git diff --stat main...HEAD -- tests/security` ว่าง) → ล้มแบบเดียวกันบน main
- **ทำซ้ำ**: บน Windows `npx vitest run tests/security/authorize-first.test.ts` → 2 failed · สำเนาที่แทน `\`→`/` ก่อนเทียบ → 133/133 ผ่าน
- **ผลกระทบ**: ด่านกันลืม wrapper/manifest ทำงานบน CI (Linux) เท่านั้น — ผู้ทำบน Windows ไม่ได้รับสัญญาณเตือน · **แนวทาง** (test): normalize ด้วย `rel(f)` ก่อนเทียบ

## Info
1. **validation มาก่อนตรวจสมาชิก** ✅ — คนนอกส่ง `color: 99` ได้ 400 `VALIDATION` แทน 404 (ลำดับ wrapper เดิม: zod → actor → service) · ไม่บอกอะไรเกี่ยวกับกลุ่ม (คำตอบเดียวกันไม่ว่ากลุ่มมีจริงหรือไม่) — ไม่นับเป็นรั่ว
2. **rate limit 60/10 นาที/ผู้ใช้ รวมทุกกลุ่ม** 📖 — `takeUserSlot` หลัง authorize (คนนอก/SA นอกกลุ่มไม่กินโควตา, ไม่มีทางทำให้คนอื่นโดนล็อก) · ตรงสัญญา
3. **ไม่มีประวัติการเปลี่ยนหน้าตา** — สมาชิกตั้งสี+รูปทรงเหมือนคนอื่นได้ (boss เลือก "ซ้ำกันได้") แยกได้ด้วยชื่อ/ตัวอักษรย่อเท่านั้น · การปลอมตัวด้วยหน้าตาอย่างเดียวไม่ได้สิทธิ์อะไรเพิ่ม · ความเสี่ยงยอมรับตาม R6C_CONTRACT §6
4. **Vercel preview ของ PR** — โค้ดใหม่อ่าน `color_slot` ทุกหน้ากลุ่ม/ปฏิทิน/นัด → ฐาน preview ต้องรัน B7 ก่อน preview จะเขียว (R6C-8) · OPERATIONS ระบุไว้แล้ว

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npx vitest run tests/groups/appearance.test.ts tests/rbac tests/security tests/platform/migration-0002.test.ts tests/auth/must-change-pin.test.ts` (TEMP/TMP→scratchpad + preload EPERM) | Test Files 2 failed / 14 passed (16) · Tests 4 failed / 2575 passed / 12 skipped (2591) · ล้มทั้ง 4 เป็นปัญหาเดิมของ Windows: `config-hygiene` ×2 (ci.yml/keepalive.yml permissions — CRLF) และ `authorize-first` ส่วน B ×2 (L2) |
| `npx vitest run tests/groups/appearance.test.ts tests/platform/migration-0002.test.ts tests/auth/must-change-pin.test.ts tests/platform/member-color.test.ts` | 4 files passed · 77 tests passed |
| สำเนา authorize-first (แก้ตัวแยก path) จาก scratchpad | 133/133 passed · รวม `src/app/api/groups/[gid]/members/me/appearance/route.ts` ✓ |
| PoC `poc.test.ts` (4 เคส: query uid, ค่าแปลก, body 70 KB, คนนอก vs กลุ่มผี) | 4/4 passed (ผลตามตารางเกต) |
| drizzle-kit 0.31.11 `generate` ลง scratchpad | ได้ SQL rebuild + `INSERT … SELECT "color_slot","shape_slot" FROM group_member` (รันไม่ได้) · snapshot เท่ากับของ repo (ตัด `id`) · prevId ตรง 0001 |
| `npm run db:check` | `Everything's fine 🐶🔥` |
| `npm run typecheck` | exit 0 ไม่มี error |

## สิ่งที่ไม่ได้ตรวจ
- ไม่ได้รัน e2e Playwright (`tests/e2e/r6c-appearance.spec.ts`) และ `next build` บนเครื่องนี้ — ดูผลจาก CI
- ไม่ได้รัน migration กับ Turso จริง (ห้ามแตะ) — ตรวจกับ libSQL ไฟล์ในเครื่อง; Turso ใช้ parser SQLite ตัวเดียวกัน (`ALTER TABLE ADD … CONSTRAINT … CHECK`)
- `tests/security/config-hygiene` ข้อ permissions ตรวจไม่ได้บน checkout CRLF — ดู CI
