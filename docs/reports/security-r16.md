# Security review — R16 (เก็บงานค้าง: rate limit H1–H3 · ป้าย SA H4/H4b · คำเชิญตรงแข่งลบบัญชี H7 · H5/ADR 0014 · UI U3/U4)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-19 · branch `feat/r16-cleanup` HEAD `1f9670d` · ช่วง `git diff 9db2c08..HEAD -- src tests` (+ เอกสารที่เปลี่ยน) · เทียบ R16_CONTRACT §1, §2 (U3/U4), §5 (B1, B3), §6 · กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่านโค้ดฝั่งเซิร์ฟเวอร์ทุกไฟล์ใน diff + ไล่ handler ของ GET ทุก route ที่ต้องล็อกอิน · รันเทสต์ของทีม · รัน `next start` จาก build ใน worktree (`.next` BUILD_ID 09:08) บนพอร์ต 3917 กับ DB ไฟล์ชั่วคราวใน scratchpad แล้ว curl จริง · ไม่แก้ `src/`/`tests/`/config (`git status` สะอาดหลังตรวจ)
- เครื่อง: Windows · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด · ❓ = ยืนยันไม่ได้

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Info | 6 |

**Verdict: ผ่านแบบมีข้อสังเกต** — H1/H2/H3 นับถูกจุด (404/403 กินโควตา, HEAD นับรวมกับ GET), 429 ไม่มีข้อมูลและไม่เป็น oracle · H4/H4b ไม่มีชื่อ SA ในแถว notification ใหม่และใน `/api/me/invites`, ไม่มีทางทำให้คนที่ไม่ใช่ SA แสดงเป็น "ผู้ดูแลระบบ" · H7 เงื่อนไขผู้รับอยู่ใน INSERT เดียว 404 ไบต์ตรงกับ "ไม่พบ" และ rollback ครบ · H5 ยืนยันด้วย curl ว่า HTML 200 ไม่มีข้อมูลกลุ่ม/ชื่อคนอื่น · Low 1 = ชื่อ SA นอกกลุ่มยังออกทาง `GET /api/groups/:gid/invites` (`creatorName`) ให้ admin/moderator ของกลุ่ม — อยู่นอกขอบ H4/H4b ที่ contract เขียนไว้ ไม่บล็อก merge

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **H1 `group:settings` 30/10 นาที นับก่อน NOT_FOUND** | **PASS** | 📖 `services/groups.ts:185-191` นับเมื่อ policy ตอบ `NOT_FOUND`/`FORBIDDEN` (ด่านกลุ่ม) และหลังผ่านด่าน · ด่านบัญชี (anonymous/suspended/must_change_pin) ไม่นับ — ตัดสินจากรหัสของ policy กลาง ไม่เทียบ role เอง · ✅ curl: bob (คนนอก) `PATCH /api/groups/<กลุ่มของ alice>` 31 ครั้ง → `30×404, 1×429` |
| **H2 `prefs:update` 60/10 นาที** | **PASS** | 📖 `services/prefs.ts:58-62` `authorize` ก่อน · นับเฉพาะ `actor.kind === 'user'` · `api/prefs/route.ts:15-17` นับก่อน `saveAccountLocale` และก่อนคืนคุกกี้ · ✅ curl: (ใช้ไป 1 ครั้งก่อนหน้า) 61 ครั้ง → `59×200, 2×429` · 429 ไม่มี `Set-Cookie` มี `retry-after: 406` |
| **H3 `api:read` 600/10 นาที** | **PASS (Info 1–3)** | 📖 `api/_lib/route.ts:296-316` นับหลังรู้ actor ก่อนใช้ผลของ handler — handler ตอบ 404/403 ก็นับ · `await readSlot` ก่อน `await pending` เสมอ → ถ้าเกินได้ 429 ไม่ว่าผลของ handler เป็นอะไร (ไม่มี oracle 404 vs 200) · `readLimited` ใช้ `entry.method` ของ manifest (`read-limit.ts:29`) · ✅ HEAD: Next 16.4.5 ใช้ GET handler แทน HEAD (`node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js:39-42`) → curl 300×GET `/api/groups` + 300×HEAD `/api/me/invites` = 600×200 แล้วคำขอถัดไป `GET /api/groups/:gid`, `GET /api/groups/:gid/../../groups`, `HEAD /api/me/line` → 429 ทั้งหมด · body `{"error":{"code":"RATE_LIMITED"}}` + `retry-after: 419` + `cache-control: private, no-store` ไม่มี Server-Timing · ระหว่างนั้น `POST /api/prefs` ของ bob = 200 และ `GET /api/groups` ของ alice = 200 (ถังแยกต่อผู้ใช้) · path แปลก/ตัวพิมพ์ต่างไปไม่ถึง handler อื่น (route ของ Next จับตาม path จริง) · VALIDATION ของ zod ตอบก่อน resolve actor → ไม่นับแต่ก็ไม่แตะ DB |
| **H3 ผลข้างเคียงของ handler ที่วิ่งขนาน** | **PASS (Info 1)** | 📖 ไล่ handler ของ GET ทั้ง 22 route ที่ต้องล็อกอิน: ที่เขียน DB มีแค่ audit การอ่านของ super admin — `auditRead` (`group-common.ts:52-53` เขียนเฉพาะ `allow.auditAsSuperAdmin`) ใน `getGroup`, `listInvites`, `getGroupCalendar`, `getGroupAvailability`, `getAppointment`, `getAppointmentIcs`, `listGroupAppointments` และ `insertAuditViewThrottled`/`insertGroupViewThrottled` ใน `GET /api/admin/audit`, `/api/admin/groups/:gid` · ไม่มี GET ที่ส่ง LINE/สร้าง notification/ใช้ token ครั้งเดียว/expire คำเชิญ · `getSessionInfo` อ่านอย่างเดียว (ต่ออายุ session เกิดใน `resolveActor` ก่อนขั้นนี้อยู่แล้ว) |
| **H3 Map ใน process 1,000 คีย์** | **PASS (Info 2)** | 📖 `read-limit.ts:19-48` เก็บ `userId → windowEnd` เฉพาะผู้ที่ถูกปฏิเสธ · คีย์มาจาก session จริงเท่านั้น (ผู้โจมตีต้องมีบัญชี 1,000 บัญชีที่ยิงเกินโควตาจึงจะเต็ม) · เต็มแล้วทิ้งตัวเก่าสุด — เสียแค่ทางลัด DB ยังตัดสิน · หน่วยความจำ ≈ 1,000 × (uuid + number) ระดับ 100 KB · ข้าม instance: ถัง `rate_limit_bucket` เป็นตัวตัดสินร่วม (UPSERT มีเพดาน) ทางลัดเป็นของแต่ละ instance |
| **H4 notification `group.invite.received`** | **PASS** | 📖 `services/invites.ts:154-168` `inviterSystemAdmin = group.actorRole === null` หลัง `authorize('invite.direct.create')` — `anyMember()` (`can.ts:206`) ให้คนนอกผ่านได้เฉพาะ SA → ธง true ได้เฉพาะ SA ที่ไม่ใช่สมาชิก · `inviterName: ''` ไม่อ่านชื่อ SA ลงแถว · notification นี้เป็น in-app อย่างเดียว (`insertNotification` ไม่เขียน LINE outbox) · allowlist params เพิ่ม `actorSystemAdmin` เท่านั้น (`tests/security/appointment-input-isolation.test.ts:223`) · UI ใช้ธงเมื่อ `=== true` เท่านั้น (`notifications/model.ts:221`) |
| **H4b `GET /api/me/invites`** | **PASS (Info 4)** | 📖 `serializers/groups.ts:155-166` เลือกฟิลด์ทีละตัว — `inviterIsSuperAdmin`/`inviterIsMember` ไม่ออกทาง API · `systemAdmin = isAdmin && !isMember` ตัดสินตอนอ่าน (EXISTS ใน query เดียว `repos/group-invite.ts:196-197`) · `is_admin` ตั้งได้ทาง SQL เท่านั้น (`repos/user.ts:134` ไม่มี endpoint) → ผู้ใช้ทั่วไปทำให้ตัวเองแสดงเป็น "ผู้ดูแลระบบ" ไม่ได้ · ✅ `tests/platform/r16-hardening.test.ts:260` ไม่มีคีย์ภายในใน JSON |
| **H7 คำเชิญตรงแข่งลบ/ระงับบัญชี** | **PASS** | 📖 `repos/group-invite.ts:383-392` `AND EXISTS (SELECT 1 FROM user u WHERE u.id = invitee AND u.status = 'active')` อยู่ใน `INSERT … SELECT … WHERE` เดียวกับเงื่อนไขกลุ่ม/ActorGuard/เพดาน · `invitee_gone` เช็กก่อน `invitee_full`/role → ตอบ `USER_NOT_FOUND` เดียวกับ username ที่ไม่มี (`services/invites.ts:146`) · throw ใน `inTx` → `expireDueDirectInvites` + notification + audit rollback ทั้งก้อน · ลบบัญชีหลัง INSERT commit → `purgeDeletedUserFootprint` ปิดคำเชิญที่ได้รับอยู่แล้ว (SQLite เขียนทีละธุรกรรม — ไม่มีช่องกลาง) · ✅ `tests/groups/r16-direct-invite-race.test.ts` hook เปลี่ยนสถานะผู้รับจริงระหว่างตรวจกับ INSERT: `r.text === none.text` และ invites/notifications/audit/outbox = 0 ทั้ง deleted และ suspended |
| **H5 HTML 200 ระหว่าง stream ไม่มีข้อมูลหลุด** | **PASS (Info 5)** | ✅ `next start` + curl: anonymous `/`, `/groups`, `/me`, `/admin`, `/notifications`, `/admin/users`, `/groups/<uuid>` → 200 + `meta refresh 1;url=/login` + `NEXT_REDIRECT;replace;/login;307` · bob (ล็อกอิน, ไม่ใช่สมาชิก/ไม่ใช่ SA) `/groups/<กลุ่ม alice>`, `/groups/<gid>/settings`, `/admin`, `/admin/users`, `/admin/audit`, `/groups/nonexistent-id` → 200 + `NEXT_HTTP_ERROR_FALLBACK;404` · `/groups/<gid>/calendar`, `/free` → 404 จริง · `/login`, `/signup`, `/forgot`, `/set-pin` ตอนล็อกอิน → 200 + redirect `/` · ทุกหน้า `grep -c PrivGroupXYZ` = 0 และ `grep -c alicesec` = 0 · ตรวจย้อน: alice เปิดหน้ากลุ่มตัวเองเห็นชื่อกลุ่ม (1) · ความยาว HTML ของกลุ่มที่มีจริงกับ id ที่ไม่มี ต่างกัน 44 ไบต์ = ความยาว path ต่างกัน 22 ตัว × 2 จุด (ไม่ใช่ข้อมูลกลุ่ม) |
| **ADR 0014 CSP `'unsafe-inline'`** | **PASS** | ✅ `grep -rn "dangerouslySetInnerHTML\|innerHTML\s*=" src` ไม่พบ · CSP จริงจาก header ของ `next start`: `script-src 'self' 'unsafe-inline'` ไม่มี `'unsafe-eval'`, `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'` ตรงกับที่ ADR อ้าง · `href` ที่มาจากข้อมูลผู้ใช้ (`mapUrl`) ถูกจำกัด https (`tests/security/appointment-input-isolation.test.ts` §2) และ React 19.3.1 บล็อก `javascript:` URL · เหตุผลใน ADR ถูกต้องและระบุจุดที่ยังไม่ยืนยันไว้ตรงไปตรงมา |
| **U3/U4** | **PASS** | 📖 `SkeletonHold.tsx` วาดแค่ skeleton เปล่า + ข้อความ `states.loading` ไม่รับ props/ข้อมูลผู้ใช้ · เก็บ state แค่ตัวเลขเวลา → ไม่มีข้อมูลค้างของผู้ใช้ก่อนหน้าหลังออกจากระบบ · `signalNavStart("/login")` ใน `AccountActions.tsx`/`DeleteAccountSheet.tsx` แค่เปิดแถบ progress ลำดับ logout/redirect เดิมไม่เปลี่ยน |
| **ความลับในเอกสาร** (กฎ 7) | **PASS** | ✅ `git diff 9db2c08..HEAD -- '*.md' '*.html' playwright.config.ts \| grep '^+' \| grep -iE 'secret\|token\|password\|pepper\|Bearer\|libsql://\|sk-\|ghp_\|<base64 ≥32>'` → พบแค่คำว่า "notify.ts", "§4", ชื่อบทบาท, "SkeletonHold" ไม่มีค่าจริง |
| **migration** (กฎ 8) | **N/A** | ไม่มี migration ใน R16 |

## ข้อพบ

### Low 1 — ชื่อ SA นอกกลุ่มยังออกทาง `GET /api/groups/:gid/invites` (`creatorName`)
- ที่: `src/lib/data/repos/group-invite.ts:148` (`creatorName: user.displayName` ของผู้สร้าง) → `src/lib/data/serializers/groups.ts:118` (`creatorName: clean(r.creatorName)`) · UI แสดงที่ `src/components/groups/InviteSection.tsx:148` ("สร้างโดย …" ของโค้ดเชิญ) · คำเชิญตรงไม่แสดงในหน้าจอแต่มีใน JSON
- ทำซ้ำ: (1) SA ที่ไม่ใช่สมาชิกสร้างโค้ดเชิญ (`POST /api/groups/:gid/invites`) หรือคำเชิญตรงในกลุ่ม X (`invite.code.create`/`invite.direct.create` = `anyMember()` → SA ผ่านแบบ audited, `can.ts:205-206`) · (2) admin ของกลุ่ม X เปิดหน้าตั้งค่าคำเชิญ หรือ `GET /api/groups/X/invites` → เห็นชื่อจริงของ SA ใน `creatorName`
- ผลกระทบ: ผู้เห็นคือ admin/moderator ของกลุ่มที่ SA เข้าไปกระทำเอง (ไม่รั่วข้ามกลุ่ม) · แต่ไม่สอดคล้องกับหลัก B7/H4/H4b ที่ซ่อนตัวตน SA นอกกลุ่มจากคนในกลุ่ม · contract H4/H4b เขียนขอบเขตไว้แค่ notification ผู้ถูกเชิญ + `/api/me/invites` จึงไม่ใช่การผิด contract
- ข้อเสนอ (platform + frontend, รอบถัดไปหรือ R17): ใน `listActiveInvitesOfGroup` เพิ่ม `creatorIsSuperAdmin`/`creatorIsMember` แบบเดียวกับ H4b แล้ว serializer ส่ง `creatorName: ''` + `actorSystemAdmin: true` · UI ใช้ `common.systemAdmin` · หรือ main ตัดสินว่ายอมรับ (บันทึกใน §6)

## Info
1. **`api:read` เกินโควตาแล้ว handler ยังทำงาน** — คำขอที่ได้ 429 จากการจองช่อง (ครั้งแรกต่อ instance ก่อนทางลัดจำไว้ + คำขอที่บินอยู่พร้อมกัน) ยังรัน handler ขนาน · ผลข้างเคียงที่พบมีแค่ audit การอ่านของ super admin (`group.view`, `invite.list`, `appointment.view`, `group.calendar.view`, `group.availability.view`, admin view แบบ throttled) ถูกบันทึกทั้งที่ SA ได้ 429 = บันทึกเกินจริง (ไม่ใช่ขาด) จึงไม่ลดความรับผิดชอบ · ไม่มี GET ใดส่งของ/แก้ข้อมูลอื่น · ถ้าวันหนึ่งมี GET ที่เขียน DB อย่างอื่น ต้องทบทวนโมเดล "ขนาน" นี้ (ควรเขียนไว้ในคอมเมนต์ `route.ts` ขั้น 3½)
2. **หน้าต่างคงที่ + ทางลัดต่อ instance** — ถังเป็น fixed window (ช่วงรอยต่อหน้าต่างยิงได้ ≈ 1,200 ใน 2 นาทีติดกัน) · ทางลัด `blockedUntil` ไม่แชร์ข้าม instance → instance ที่ยังไม่รู้จะถาม DB 1 ครั้งก่อนจำ · ทุก GET ที่ล็อกอินเขียน UPSERT 1 ครั้ง (ฝั่ง Turso คือเขียนไป primary) — เป็นเรื่องโหลด/ความเร็ว ไม่ใช่สิทธิ์ · การจองช่องล้มด้วย error DB → GET นั้นตอบ 500 (fail-closed)
3. **หน้า Server Component ไม่ผ่าน `api:read`** — ข้อมูลเดียวกัน (กลุ่ม, ปฏิทิน, แจ้งเตือน) อ่านผ่านหน้า RSC ได้โดยไม่นับ (`src/app/(app)/groups/_lib/load.ts`, `notifications/_lib/load.ts`) · ARCHITECTURE ข้อ 11 บันทึกไว้แล้ว ("หน้า Server Component (ไม่ผ่าน wrapper)") · สอดคล้อง contract H3 ที่กำหนดที่ `route.ts`
4. **H4b ตัดสินตอนอ่าน / H4 ตัดสินตอนสร้าง** — ถ้า boss ถอด `is_admin` ของ SA ด้วย SQL ขณะคำเชิญที่ SA สร้างยังค้าง (≤ 7 วัน) `/api/me/invites` จะกลับไปแสดงชื่อจริงของ SA ในขณะที่กระดิ่งยังเป็น "ผู้ดูแลระบบ" · เกิดได้เฉพาะงาน ops ด้วยมือ ผลกระทบต่ำ · SA ที่เข้ากลุ่มทีหลังแสดงชื่อจริง (ตั้งใจ — เทสต์ `r16-hardening.test.ts:260`)
5. **H5 หน้า not-found ระหว่าง stream ได้ 200** — `/groups/<gid>`, `/settings`, `/admin*` ของคนที่ไม่มีสิทธิ์ตอบ HTTP 200 + `NEXT_HTTP_ERROR_FALLBACK;404` (ไม่ใช่ 404 จริง) แต่ HTML ไม่มีข้อมูลกลุ่ม/ชื่อคนอื่น และกลุ่มที่มีจริงกับไม่มีจริงหน้าตาเหมือนกัน (ไม่เป็น oracle) · ตรงกับข้อสรุป §6 ของ platform
6. **รอยไฟล์ชั่วคราว** — ระหว่างตรวจ security สร้าง `./.sec-mig-tmp.mjs` ใน worktree ชั่วคราวเพื่อ migrate DB ทดสอบ (ต้องใช้ `node_modules` ของ worktree) แล้วลบทันที · `git status --short` ว่างหลังตรวจ

## คำสั่งที่รัน + ผลจริง
```
npx vitest run tests/platform/r16-hardening.test.ts tests/groups/r16-direct-invite-race.test.ts tests/groups/direct-invite.test.ts tests/ui/r16-ui.test.ts tests/ui/name-isolation.test.ts tests/security/appointment-input-isolation.test.ts
  → Test Files 6 passed (6) · Tests 116 passed | 1 skipped (117)

npx vitest run tests/security tests/ops/headers.test.ts tests/rbac
  → Test Files 17 passed (17) · Tests 2877 passed | 1 skipped (2878)
  (config-hygiene ผ่านทั้งไฟล์ในเครื่องนี้)

grep -rn "dangerouslySetInnerHTML\|innerHTML\s*=" src   → ไม่พบ

# next start (build เดิมใน .next) พอร์ต 3917 + DB ไฟล์ชั่วคราว (migrate ด้วย drizzle migrator)
signup alicesec / bobsec → 201 / 201 · alice POST /api/groups "PrivGroupXYZ" → 201
anonymous GET / /groups /me /admin /notifications /admin/users /groups/<uuid>
  → 200 ทุกหน้า · meta refresh 1;url=/login · NEXT_REDIRECT;replace;/login;307
bob GET /groups/<gid> /groups/<gid>/settings /admin /admin/users /admin/audit /groups/nonexistent-id
  → 200 + NEXT_HTTP_ERROR_FALLBACK;404 · PrivGroupXYZ=0 · alicesec=0
bob GET /groups/<gid>/calendar /groups/<gid>/free → 404
bob GET /login /signup /forgot /set-pin → 200 + NEXT_REDIRECT;replace;/;307
alice GET /groups/<gid> → PrivGroupXYZ พบ 1
bob 300× GET /api/groups → 300×200 · 300× HEAD /api/me/invites → 300×200
bob GET /api/groups/<gid> → 429 {"error":{"code":"RATE_LIMITED"}} retry-after: 419 cache-control: private, no-store
bob GET /api/groups/<gid>/../../groups → 429 · HEAD /api/me/line → 429
bob POST /api/prefs → 200 · alice GET /api/groups → 200
bob 31× PATCH /api/groups/<gid ของ alice> → 30×404, 1×429
bob 61× POST /api/prefs → 59×200, 2×429 · 429 ไม่มี Set-Cookie, retry-after: 406
```

## ตรวจไม่ได้ / ไม่ได้ตรวจ
- ❓ e2e ทั้งชุด (เกณฑ์ H3 "ผู้ใช้ปกติไม่โดน 429") — ไม่ได้รันในเครื่อง Windows นี้ · ดูผลจาก CI
- ❓ พฤติกรรมข้ามหลาย instance บน Vercel/Turso จริง — ตรวจจากโค้ดเท่านั้น
- ไม่ได้ build ใหม่เอง ใช้ `.next` ที่มีอยู่ใน worktree (BUILD_ID เวลา 09:08 หลัง HEAD `1f9670d` 09:07) · ❓ ไม่ได้ยืนยันว่า build นั้นมาจาก HEAD ตรงทุกไฟล์ แต่ผล rate limit ตรงกับโค้ด R16 (มี `api:read`)
