# Security review — R15a (ไอคอนกลุ่ม · เว้น/คืนหลายวันของแบบประจำ · manifest/ไอคอนแอป · migration 0006)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-16 · branch `feat/r15a-feedback` HEAD `230cb10` · ดู `git diff origin/main...HEAD` (18 commit, 123 ไฟล์) · เทียบ R15_CONTRACT §1, §6, §8 · ADR 0012 §13 · ADR 0013 · ADR 0003 (rbac) · ADR 0006 (busy visibility) · กฎเหล็ก CLAUDE.md ข้อ 6–9 · ต่อจาก `security-r14a.md` / `security-r14b.md`
- วิธี: อ่านโค้ดจริงทุกไฟล์ฝั่งเซิร์ฟเวอร์ใน diff (route, service, repo, serializer, rbac, schema, migration, manifest, layout) และไฟล์ client ที่แตะ storage/ไอคอน · รันเทสต์ของทีมเอง · ตรวจ chunk ของ PNG · ไม่แก้ `src/`/`tests/`/config · ไม่มี probe ค้าง
- เครื่อง: Windows (checkout CRLF) · เทสต์รันผ่าน shim นอก repo ที่กลืน `EPERM` · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Info | 4 |

**Verdict: ผ่านแบบมีข้อสังเกต** ไม่พบช่องยกระดับสิทธิ์ ไม่พบ IDOR/oracle ไม่พบข้อมูล skip หรือ routine รั่วไปถึงคนอื่น ไม่พบ XSS/injection · Low 1 ข้อเป็นเรื่องลำดับ migrate/deploy ในเอกสาร ops ไม่ใช่โค้ด และไม่บล็อก merge ถ้า boss ทำตามข้อแนะนำ

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **`group.icon.update`: role** (R15-3, B2) | **PASS** | 📖 `src/lib/rbac/can.ts:222` = `adminOrModerator()` เหมือน `group.update` · `actions.ts` resource = `['group']` · ✅ `tests/rbac/group-icon.test.ts:56` เทียบกับ `group.update` ทุกช่อง (role × SA × สถานะบัญชี × กลุ่มลบ) · member → 403, ไม่ใช่สมาชิก → 404, suspended/deleted/must_change_pin ถูกปฏิเสธ |
| **SA** | **PASS** | 📖 SA ที่ไม่ใช่สมาชิกตั้งได้ตามกติกาการแก้กลุ่มเดิม (B2 + §8) · audit ผ่าน `audit(tx, me, allow, …)` ได้ `asSuperAdmin: true` · ✅ `tests/groups/group-icon.test.ts:98` · กลุ่มที่ลบแล้ว SA ก็ได้ 404 (`:89`) |
| **IDOR / 404 แยกไม่ออก** | **PASS** | 📖 `services/groups.ts:185-188` `loadGroupCtx` → `authorize` ก่อนอ่าน/เขียนอะไร · ✅ `group-icon.test.ts:79` คนนอก / กลุ่มคนอื่น / uuid ที่ไม่มี ได้ status + body เท่ากันทุกไบต์ · zod ของ body ตรวจก่อน handler (`api/_lib/route.ts:270-276`) แต่ไม่ขึ้นกับว่ากลุ่มมีจริงไหม จึงไม่เป็น oracle |
| **การเขียนผูก role ที่ยังถืออยู่** | **PASS** | 📖 `updateGroup` (`repos/group.ts:48-55`) มี `actorGuardClause` + `deleted_at IS NULL` ในคำสั่ง UPDATE เดียวกัน · ถูกถอดบทบาท/กลุ่มถูกลบระหว่างทาง → `staleOrGone` |
| **allowlist เท่านั้น** (B1) | **PASS** | 📖 `setGroupIconInputSchema = z.object({ icon: z.enum(GROUP_ICON_KEYS).nullable() }).strict()` (`services/groups.ts`) · 24 คีย์ `[a-z]+` คงที่ใน `src/lib/shared/group-icons.ts` · ไม่มี URL/รูป/emoji/HTML · ✅ `group-icon.test.ts:137` คีย์แปลก/URL/emoji/ตัวใหญ่/ตัวเลข → 400 |
| **ค่าไม่รู้จักในฐาน → null** | **PASS** | 📖 ทุก DTO ผ่าน `normalizeGroupIcon` (serializers groups/appointments, services calendar/availability) · UI `GroupIcon.tsx` ใช้ `displayGroupIcon` แล้วเลือก path จาก `GROUP_ICON_NODES` (ค่าคงที่ในโค้ด) ค่าจากเซิร์ฟเวอร์ไม่ถูกใส่ลง DOM เป็น markup · ✅ `group-icon.test.ts:198` · `grep dangerouslySetInnerHTML src` ไม่พบ |
| **audit ไอคอน** | **PASS** | 📖 `services/groups.ts:196` action `group.update` meta `{fields:['icon']}` (ไม่มีค่าไอคอน ไม่มีข้อมูลคน) · ค่าเท่าเดิม → ไม่เขียน ไม่ audit (`:191`) |
| **skips: เจ้าของเท่านั้น** (R15-2) | **PASS** | 📖 `authorize(…,'busy.routine.update', ownerRes(actor))` แล้วทุก SQL ผูก `user_id = ผู้กระทำ` (`repos/busy-routine.ts` `lockOwnRoutine`, `deleteRoutineRowsOn`, `insertRoutineSkips` มี `EXISTS … user_id`, `deleteRoutineSkipsOn` มี `EXISTS … user_id`, `routineRowDatesOn`) · `lockOwnRoutine` ตรวจ `userActive` ในคำสั่งเขียน · ✅ `r15-routine-skips.test.ts:302` id คนอื่น / ไม่มี / SA → 404 เท่ากันทุกไบต์ · ค่าวันผิดบน id คนอื่นก็ยัง 404 (ตรวจวันกับกฎ*หลัง*ผ่านด่านเจ้าของ `busy-routines.ts:492-505`) จึงไม่บอกกฎของคนอื่น |
| **skips: rate limit ก่อน validation** | **PASS (มี Info 1)** | 📖 `busy-routines.ts:477` `takeUserSlot(busy:routine)` ก่อน `parseSkipDates`/เพดาน/ownership · ✅ `r15-routine-skips.test.ts:328` คำขอที่ได้ 400/404 ก็นับ · bucket ร่วมกับ POST/PATCH/DELETE |
| **skips: ≤ 31 วัน / ขนาดคำขอ** | **PASS** | 📖 zod: อาร์เรย์ละ ≤ 64 สตริงยาว ≤ 32 (`busy-routines.ts:143`) · service: หลังตัดซ้ำ add ∪ remove ≤ 31 → `LIMIT_REACHED skipDays` · ค่าที่สะท้อนใน error เป็นวันที่ที่ผ่าน `isValidDate` แล้วเท่านั้น (รูปแบบผิดชี้แค่ช่อง `add`/`remove`) · ✅ `:225`, `:246` |
| **skips: transaction เดียว · ทั้งหมดหรือไม่มีเลย · 1,500** | **PASS** | 📖 ทุกขั้นอยู่ใน `inTx` · คำสั่งแรกเป็นการเขียน (`UPDATE … SET updated_at = updated_at` ถือ write lock ก่อนอ่าน — ไม่มี check-then-act) · คืนแถวผ่าน `insertRoutineRowsIfUnderCap` (cap ในคำสั่งเดียว) เกิน → throw = rollback · ✅ `:268` rollback ทั้งคำขอ |
| **skips: พร้อมกัน** | **PASS** | 📖 `updateRoutine` อ่าน skip *ภายใน* tx หลังเขียนกฎแล้ว (`busy-routines.ts:~367`) ส่วน skips ถือ write lock ก่อนอ่าน → SQLite serialize · ✅ `:346`, `:364` (เว้นพร้อมกัน / เว้นพร้อม PATCH ทั้งชุด ไม่มีวันฟื้น) |
| **skips: อดีต / ของคนอื่น** | **PASS** | 📖 `checkRoutineSkipDate` (`lib/calendar/routine.ts`) `d < today(tz ของชุด)` → PAST ทั้ง add และ remove · ใช้ lib กลาง (กฎ 9) · ✅ `:203`, `:261` |
| **skippedDates ไม่ให้คนอื่นเห็น** (ADR 0006/0012 §7) | **PASS** | 📖 `skippedDates` อยู่ใน `RoutineOwnView` เท่านั้น · ใช้ที่ `GET /api/me/busy-routines`, POST/PATCH routine, POST skips (ทั้งหมดเป็น `/api/me/*` ของผู้กระทำ) · `listUserRoutineSkipsFrom` JOIN `busy_routine.user_id = ผู้ใช้` · ทางอ่านของกลุ่ม (calendar/availability) ไม่เปลี่ยน คนอื่นเห็นแค่ว่าวันนั้นไม่มี busy · ✅ `r15-routine-skips.test.ts:66` canary: เพื่อนไม่เห็น `skippedDates`/routine id/วันที่เว้นในทุกทาง · `tests/busy/calendar-visibility.test.ts` ล็อกรายการ route ที่แตะ busy รวม `/skips` |
| **`icon`/`groupIcon` ใน DTO: ไม่มีข้อมูลอื่นรั่วเพิ่ม** | **PASS** | 📖 diff เพิ่มแค่คอลัมน์ `groups.icon` ใน select เดิม (`findAppointmentAccess`, `groupNamesAndMemberCounts`, `toGroupSummary`, `toGroupDetail`, calendar/availability `group`) · ทุกทางเป็นของสมาชิก (หรือ SA ที่ audit) อยู่แล้ว · ไม่เพิ่มในหน้าเข้าร่วมด้วยโค้ด/คำเชิญ (คนนอกไม่เห็น) · ไอคอนเป็นค่าของกลุ่ม ไม่ใช่ข้อมูลคน · ✅ `calendar-visibility.test.ts` schema `.strict()` อัปเดตเพิ่มแค่ `icon` |
| **migration 0006** (กฎ 8, R15-1) | **PASS (มี Low 1)** | 📖 SQL มี 2 คำสั่ง: `DROP TABLE place_search_cache` + `ALTER TABLE groups ADD icon text` (nullable ไม่ backfill) · ตารางที่ลบไม่มี FK ไม่ผูกผู้ใช้ เป็น cache ที่ไม่ได้ใช้ตั้งแต่ R13 → การเสียข้อมูลยอมรับได้ (B8) · `git grep` ไม่พบโค้ด/สคริปต์/workflow ที่อ้างตารางนี้นอก docs/tests/migration เก่า · journal `when` เรียงถูก (0006 = 2026-11-15 > 0005) · ✅ `npx drizzle-kit check` → `Everything's fine` · ✅ `tests/platform/migration-0006.test.ts` ข้อมูลเดิมไม่เปลี่ยน |
| **manifest / metadata** | **PASS** | 📖 `src/app/manifest.ts` static ล้วน (ชื่อจาก `messages/th.json`, สีจาก tokens, path ไอคอน `/brand/app/*` ใน origin เดียวกัน) ไม่อ่าน cookie/session/locale ไม่มีข้อมูลผู้ใช้ · `layout.tsx` เพิ่มแค่ `apple` icon + `appleWebApp` · ไม่มี origin ภายนอกใหม่ · CSP เดิม `manifest-src 'self'`, `img-src 'self' data: blob:` ครอบอยู่แล้ว (`next.config.ts:46`) · header ความปลอดภัยใช้กับ `/:path*` รวม `/manifest.webmanifest` · ไม่มี service worker |
| **PNG ไม่มี metadata** | **PASS** | ✅ แยก chunk ทั้ง 4 ไฟล์ใน `public/brand/app/`: มีแค่ `IHDR pHYs IDAT… IEND` · ไม่มี `tEXt/iTXt/zTXt/eXIf/tIME` · ขนาด 180/192/512/512 ตรงสเปก |
| **localStorage ขั้น 3** | **PASS (มี Info 2)** | 📖 `src/components/groups/free-seen.ts:8` คีย์ `mm:free-seen:v1:<userId>:<groupId>` ค่า `"1"` · ไม่มีชื่อ/busy/โค้ดเชิญ/token · ไม่ส่งเซิร์ฟเวอร์ · ไม่ใช่ด่านสิทธิ์ (ปุ่มสร้างนัดตัดสินที่เซิร์ฟเวอร์ `groups/[gid]/page.tsx`) · ผูก userId จึงไม่ปนข้ามบัญชีบนเครื่องเดียวกัน · รูปแบบเดียวกับ `busy/notice.ts:6` ที่มีอยู่แล้ว |
| **ความลับ / log** (กฎ 7) | **PASS** | ✅ grep บรรทัดที่เพิ่มใน diff หา `secret|token|password|api_key|BEGIN KEY`: เจอแค่ชื่อ env ใน OPERATIONS (`$env:TURSO_AUTH_TOKEN` ไม่มีค่า) และชื่อคอลัมน์ `device_token_hash` ใน snapshot · ไม่มี env ใหม่ · ไม่มี `console.*` ใหม่ฝั่งเซิร์ฟเวอร์ |
| **CSRF** | **PASS** | 📖 ทั้งสอง route ใหม่ผ่าน `route()` (Origin + JSON content-type ก่อน zod) · ✅ `group-icon.test.ts:107` ไม่มี Origin → 403 CSRF_REJECTED · `tests/auth/must-change-pin.test.ts` sweep รวม route ใหม่ · `tests/security/authorize-first.test.ts` ผ่าน |

## Low
1. **Low 1 — ช่วงระหว่าง migrate prod กับ deploy รุ่นใหม่ cron รายวันของ v0.12.0 ล้มทั้ง batch** (`docs/OPERATIONS.md:121`)
   - เอกสารเขียนว่า "รัน migrate ก่อน merge ปลอดภัย" แต่ v0.12.0 ยังมีงาน `stalePlaceSearchCache` ใน `db.batch([...])` เดียวกับงานเก็บกวาดอื่น (`git show origin/main:src/lib/data/repos/maintenance.ts:79`, `services/maintenance.ts:24`) · ข้อ Rollback (`OPERATIONS.md:128`) อธิบายผลนี้ไว้แล้ว แต่ไม่ได้บอกว่าเกิดในช่วง "migrate แล้ว ยังไม่ merge" ด้วย
   - ขั้นตอนที่เกิดจริง: boss รัน 0006 บน prod → ยังไม่ merge/deploy ก่อน 19:00 UTC (02:00 น. ไทย, `vercel.json:6`) → `/api/cron/daily` ของรุ่นเก่ารัน `DELETE FROM place_search_cache` → no such table → batch ทั้งชุด roll back · session/rate-limit bucket/คำขอรีเซ็ต PIN/notification/busy เก่าไม่ถูกล้างรอบนั้น
   - ผลด้านความปลอดภัยจำกัด: session หมดอายุยังถูกปฏิเสธตอนอ่าน (`repos/session.ts:84` `gt(expiresAt, now)`) · แค่ retention เลื่อนไป 1 วัน และ heartbeat ยังขึ้น (เขียนแยกก่อน batch) จึงไม่เห็นใน health
   - แนะนำ (ops): เติมในข้อ "ลำดับกับ deploy" ว่าให้ migrate prod กับ merge ในวันเดียวกันก่อน 02:00 น. หรือถ้าข้ามคืน ให้ตรวจผล cron วันถัดไป · ไม่ต้องแก้โค้ด

## Info
1. **Info 1 — rate limit นับหลังตรวจโครงสร้าง zod:** `route()` ตรวจ body ด้วย zod ก่อนเรียก handler (`src/app/api/_lib/route.ts:270-276`) คำขอ `/skips` ที่โครงสร้างผิด (คีย์แปลก, อาร์เรย์ > 64, ไม่ใช่สตริง) จึงได้ 400 โดยไม่นับ bucket · ส่วน "ค่า" (วันที่, ซ้ำ, > 31, ownership) นับก่อนตามที่ ADR 0012 §13.1 ต้องการ · งานของคำขอที่ไม่นับมีแค่ parse JSON เล็ก ๆ ไม่แตะฐาน จึงไม่ใช่ช่อง DoS · เหมือนรูปแบบเดิมของ route อื่นทั้งระบบ
2. **Info 2 — คีย์ localStorage เหลือหลัง logout:** `mm:free-seen:v1:<userId>:<groupId>` (`free-seen.ts:8`) ไม่ถูกลบตอน logout คนที่ใช้เครื่องต่อเปิด DevTools จะเห็น UUID ของผู้ใช้และกลุ่มที่เคยเปิดดูวันว่าง (ไม่มีชื่อ ไม่มีข้อมูล busy) · ระดับเดียวกับ `mm_busy_notice_seen:<userId>` ที่มีอยู่ · เสนอรอบหลัง: ล้าง prefix `mm:` ตอน logout ถ้าต้องการ
3. **Info 3 — PUT icon ไม่มี rate limit:** `setGroupIcon` (`services/groups.ts:185`) ไม่มี bucket เหมือน `PATCH /api/groups/:gid` เดิม · admin/moderator สลับไอคอนรัว ๆ ได้ 1 แถว audit ต่อครั้ง (ค่าเท่าเดิมไม่เขียน) · ผู้ทำได้ต้องมีสิทธิ์ดูแลกลุ่มอยู่แล้ว · ถ้าจะเพิ่ม ให้ทำพร้อมกับ PATCH กลุ่มในรอบ hardening (R15b §4 / B9 rate limit global)
4. **Info 4 — `OPERATIONS.md:117` ข้อ Rate limit** ระบุ `busy:routine` สำหรับ POST/PATCH/DELETE แต่ยังไม่ได้เพิ่ม `POST /api/me/busy-routines/:id/skips` (ใช้ bucket เดียวกัน) · เอกสารเท่านั้น

## คำสั่งที่รัน + ผลจริง
```
NODE_OPTIONS="--import file:///…/scratchpad/ignore-eperm.mjs" npx vitest run \
  tests/groups/group-icon.test.ts tests/rbac tests/platform/r15-routine-skips.test.ts tests/platform/migration-0006.test.ts \
  tests/security tests/calendar/routine-skip.test.ts tests/busy tests/groups/idor-and-list.test.ts \
  tests/auth/must-change-pin.test.ts tests/platform/cron.test.ts tests/platform/schema.test.ts
  รอบ 1 → Test Files 2 failed | 25 passed (27) · Tests 3 failed | 3059 passed | 1 skipped (3063)
  รอบ 2 (--reporter=dot) → Test Files 1 failed | 26 passed (27) · Tests 2 failed | 3060 passed | 1 skipped (3063)
  ข้อที่ล้มทั้งสองรอบ: tests/security/config-hygiene.test.ts ci.yml / keepalive.yml "permissions = contents: read"
    (regex \n ไม่ตรง CRLF ของ checkout Windows — ปัญหาเดิมของเครื่อง)
  ข้อที่ล้มเพิ่มในรอบ 1 เป็นอีกไฟล์หนึ่งที่ผ่านในรอบ 2 (output ถูกตัด ไม่ได้ชื่อไฟล์ — น่าจะ timeout ของเครื่องช้า ไม่ได้ยืนยัน)
npx drizzle-kit check → Everything's fine
node (แยก PNG chunk ของ public/brand/app/*) →
  apple-touch-icon.png 180x180 IHDR pHYs IEND · icon-192.png 192x192 IHDR pHYs IEND
  icon-512.png 512x512 IHDR pHYs IEND · icon-maskable-512.png 512x512 IHDR pHYs IEND   (ไม่นับ IDAT)
journal: 0005 2026-11-10T22:17:49Z → 0006 2026-11-15T04:23:40Z (เรียงถูก)
git grep place_search_cache (ไม่นับ docs/tests/drizzle meta) → เหลือแค่ 0000_init.sql, 0006, คอมเมนต์ใน schema.ts/maintenance.ts
grep dangerouslySetInnerHTML src → ไม่พบ
```

## สิ่งที่ตรวจไม่ได้
- e2e (`tests/e2e/r15a-feedback.spec.ts` รวมเทสต์ manifest และ step 3) ไม่ได้รันในเครื่อง Windows นี้ → ดูผลจาก CI
- `npm test` ทั้งชุด / lint / typecheck / build ไม่ได้รัน (qa ตรวจคู่ขนาน · ทั้งชุดในเครื่องนี้มี EPERM/timeout เดิม)
- migration 0006 บนฐาน preview/prod จริง (boss รันตาม OPERATIONS)
- พฤติกรรม iOS โหมดหน้าจอโฮม (cookie/ลิงก์ภายนอก) — boss ทดสอบ T3
