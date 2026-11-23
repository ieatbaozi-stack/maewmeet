# Security review — v1.0 (R18 V3: §S แชร์นัดให้คนนอกกลุ่ม + H1–H3 + D1 + ตรวจทั้งระบบ)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-22 · branch `feat/r18-v1` HEAD `091a2d4` · ช่วง `git diff d6f413a..HEAD` · เทียบ [R18_CONTRACT](../contracts/R18_CONTRACT.md) §S, H1–H3, D1, V3 + [ADR 0016](../adr/0016-appointment-share-guests.md) · กฎเหล็ก CLAUDE.md ข้อ 6–9
- วิธี: อ่านโค้ดฝั่งเซิร์ฟเวอร์ทุกไฟล์ของ §S (routes, `rbac/*`, `policy-context.ts`, `repos/share-link.ts`, `repos/appointment-guest.ts`, `services/share.ts`, `services/share-views.ts`, `serializers/share.ts`, `share-token.ts`, `safe-next.ts`, `share-page.ts`, `/i/[token]/page.tsx`) + จุดที่ §S แตะของเดิม (notify, visibleToOwner, busy, reminder, LINE outbox, account purge, group purge, invites, groups leave/remove, maintenance) · รันเทสต์เอง · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด · ❓ = ยืนยันไม่ได้

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Info | 5 |

**Verdict: ผ่านแบบมีข้อสังเกต** — §S ตัดสินสิทธิ์ที่เซิร์ฟเวอร์ผ่าน `can()` ทุกเส้นทาง (ทางแขกแยก action/DTO ไม่ขยาย `appointment.view` เดิม → แขกได้ NOT_FOUND จากทางสมาชิกทุกทาง) · token 128 บิต derive จาก id ด้วย HKDF/HMAC เก็บแค่ hash ไม่ลง log/audit/notification · 404 `SHARE_LINK_INVALID` เป็น body เดียวทุกเหตุ, 410 ไม่มี reason · เพดาน 10 อยู่ในคำสั่ง INSERT เดียวใน `BEGIN IMMEDIATE` · `safeNext` เป็น allowlist ตรงรูป · วงจรข้อมูล (ออก/ถูกลบ/ลบบัญชี/ลบ-กู้-purge กลุ่ม/cron/แขก→สมาชิก) ครบ · H1 จองช่องก่อน handler · D1 ประทับ `inviterId`/`inviteeId` แล้วล้างตอนลบบัญชีถูกต้องและไม่ออกทาง API · ทั้งระบบ: `npm audit` 0, ไม่พบความลับใน repo, ข้อพบเก่า (r16 Low 1, r17 Low 1) ปิดแล้ว · Low 1 = ถังรวม H3 ทำให้ผู้โจมตีที่มีไม่กี่ IP ปิดการใช้โค้ดเชิญของทั้งระบบได้ (trade-off ที่ contract เลือก แต่ยังไม่มีคู่มือรับมือใน OPERATIONS)

## ผลต่อเกต — A) R18 diff
| เกต | ผล | หลักฐาน |
|---|---|---|
| **Token สร้าง/เก็บ** | **PASS** | 📖 `share-token.ts:21-29` token = base64url(HMAC-SHA256(HKDF(APP_SECRET,'…share-token/v1'), "share-link:"+id)[0..16)) = 22 ตัว 128 บิต · DB เก็บ `token_hash` = HMAC ด้วย subkey แยก (`…share-hash/v1`) · `parseShareToken` ตรงรูป `^[A-Za-z0-9_-]{22}$` ก่อนแตะฐาน · dump ฐานอย่างเดียวสร้าง/ย้อน token ไม่ได้ · `share_link_token_hash_uq` unique · ✅ `r18-share.test.ts:73` |
| **ไม่ log/คืน token** | **PASS** | 📖 ไม่มี `console.*` ใหม่ที่มีข้อมูล (มีแค่ `[cron] … ${errorCodeOf(e)}` `maintenance.ts:73,98`) · `route.ts:245` log `entry.path` (template) ไม่ใช่ path จริง · join รับ token ใน body · audit meta = `linkId`/`invitedBy`/`guestUserId`/`reason` (`serializers/admin.ts` whitelist) · `ShareLinkDto.url` มีเฉพาะ `mine` · ✅ `r18-share.test.ts:196,575` (audit/console ไม่มี token/hash/URL) |
| **404 เหมือนกันทุกเหตุ / 410 ไม่มีเหตุผล** | **PASS** | 📖 ลำดับ `services/share.ts:138-146` และ `:190-197`: รูปผิด/ไม่มี/`revoked_at`/ผู้สร้างออก-ถูกลบ-บัญชีไม่ active (`linkIntactSql` `repos/share-link.ts:14-16` รวม `joined_at <= created_at`)/แขกที่ถูกนำออก → `SHARE_LINK_INVALID` ตัวเดียว (ไม่มี params, `errors.ts` 404) · นัดจบ/ยกเลิก/กลุ่มลบ → 410 ไม่มี params · หน้า `/i` ใช้หน้าเดียวสำหรับ invalid · ✅ `r18-share.test.ts:216,244` เทียบ body ทุกไบต์ |
| **เพดาน 10 + แข่งช่องสุดท้าย** | **PASS** | 📖 `repos/share-link.ts:227-243` INSERT…SELECT เดียว: ลิงก์ใช้ได้ + ผู้เข้า active + ไม่ใช่สมาชิก + `count(removed_at IS NULL) < max` + `ON CONFLICT DO NOTHING` (แถวที่ถูกนำออกกันกลับเข้าด้วย PK) ใน `inTx` · ✅ `r18-share.test.ts:258` แข่ง 2 คน → พอดี 10 อีกคน 409 `{max:10}` · ❓ ข้าม instance บน Turso จริง |
| **แยกแขกออกจากข้อมูลกลุ่ม** | **PASS (Info 1)** | 📖 `guestSelf` (`can.ts`) NOT_FOUND ถ้ากลุ่มลบ/เป็นสมาชิก/ไม่ใช่แขกที่มีผล ไม่มีข้อยกเว้น SA · `appointment.view/rsvp/update/cancel`, กลุ่ม, ปฏิทิน, วันว่าง, รายการนัดกลุ่ม ใช้ `inGroup` เดิม → แขก NOT_FOUND · DTO แขก allowlist (`serializers/share.ts:34-49,123-147`) ไม่มี groupId/รายชื่อ/ผู้สร้างนัด/busy/permissions อื่น · ยอดแค่ going/maybe · `invitedBy` = ชื่อผู้ชวนเฉพาะยังเป็นสมาชิก · แจ้งเตือนถึงแขกเป็นชนิดแยกไม่มีชื่อผู้กระทำ (`notify.ts` `appointment.guest.*`) · `rsvp_changed` ส่งเฉพาะผู้สร้างนัด · .ics ไม่มี ORGANIZER/ATTENDEE (`calendar/ics.ts:168`) · ✅ `r18-share.test.ts:144,295` · `tests/rbac/share-guests.test.ts` |
| **busy ของคนในกลุ่ม** | **PASS** | 📖 `repos/appointment-guest.ts:217-227` นัดแขกที่สมาชิกตอบ going ขึ้นเป็นไม่ว่าง "กลุ่มอื่น" `same_group=0` ไม่ SELECT title/place/group · `a.group_id <> :gid` · แขกไม่เห็น busy ของใคร (ไม่ผ่าน `inGroup`) |
| **`/i/[token]` noindex/referrer/OG** | **PASS (Info 3)** | 📖 `page.tsx:14-23` title/OG ทั่วไป ไม่มีชื่อนัด/กลุ่ม/token · `robots index/follow false` · `referrer: no-referrer` · ✅ `tests/ops/headers.test.ts:42-45` `X-Robots-Tag: noindex, nofollow` สำหรับ `/i/:path*` · Referrer-Policy ทั้งเว็บ `strict-origin-when-cross-origin` ไม่ส่ง path ข้าม origin อยู่แล้ว · GET ไม่สร้างแถว (นอกจากถัง) |
| **`safeNext` open redirect** | **PASS** | 📖 `safe-next.ts:7-12` allowlist `^/i/[A-Za-z0-9_-]{22}$` ไม่ decode · ใช้ซ้ำที่ `redirectIfSignedIn` (`_lib/session.ts`), `postAuthDestination`/`SignupForm` ฝั่ง client · mustChangePin → `/set-pin` ก่อนเสมอ · ✅ `r18-share.test.ts:86` (`//x`, `/\x`, `https:`, `%2F`…) |
| **rate limit** | **PASS** | 📖 `SHARE_RATE_LIMITS` (`throttle.ts`) ตรง ADR §6 · join จอง IP+ผู้ใช้ก่อนแตะ token คืนช่องเมื่อสำเร็จ/สมาชิก/แขกอยู่แล้ว/เต็ม → นับเฉพาะ 404/410 (`services/share.ts:161-206`) · view 120/15 นาที/IP นับก่อน parse token (นับ token ผิดรูปด้วย) · `takeSlots` = precheck แล้วจอง (`rate-slots.ts`) · ✅ `tests/auth/share-rate-limits.test.ts`, `r18-share.test.ts:184` |
| **RBAC action ใหม่** | **PASS** | 📖 `can.ts` `shareCreate` (SA นอกกลุ่ม FORBIDDEN) · `shareRevoke`/`guestRemove` = admin/mod/ผู้สร้างนัด/ผู้สร้างลิงก์-ผู้ชวน + SA audited · ลบตัวเอง FORBIDDEN · `:lid` ต้องเป็นของนัด `:id` ใน query เดียว (`repos/share-link.ts:80`) ไม่งั้น goneGroupCtx → NOT_FOUND (กัน IDOR) · การเขียนมี `actorGuardClause` (role ต้องยังเหมือนเดิม) · `appointment.share.preview` เป็น PUBLIC แต่ไม่อยู่ใน `PIN_CHANGE_ALLOWED` · manifest 8 แถวใหม่ `auth:'actor'` → CSRF Origin + JSON · ✅ `tests/rbac` (matrix), `tests/security/authorize-first.test.ts`, `rbac-invariants.test.ts` |
| **วงจรชีวิต** | **PASS (Info 2)** | 📖 ออก/ถูกลบจากกลุ่ม: `revokeActiveShareLinksCreatedBy` ใน tx เดียวกัน (`services/groups.ts`) + `joined_at <= created_at` กันฟื้นเมื่อกลับเข้า · ลบบัญชี: ลบลิงก์ (ตั้ง `link_id` NULL ก่อน) + ลบแถวแขก (`repos/account.ts`) · `responderName` ของแขกล้างด้วยกลไก `responderId` เดิม · กลุ่ม soft delete: ทุกคิวรีแขกผูก `g.deleted_at IS NULL` · กู้: กลับมาเอง · purge: ลบแขกก่อนลิงก์ (`group-purge.ts`) + แจ้งเตือนตาม `groupId` (รวม `guest.removed`) · cron ลบลิงก์ที่จบเกิน 30 วันแบบ batch (`repos/share-link.ts:258-275`) · แขก→สมาชิก ย้ายคำตอบ + ลบแถวแขกใน tx ของการเข้ากลุ่มทั้ง 2 ทาง (`services/invites.ts` code + direct) — สองทางนี้คือทางเพิ่มสมาชิกทั้งหมด (`grep INSERT INTO group_member`) · LINE: `loadOutboxSendContext` ใช้แถวแขก `removed_at IS NULL` (ถูกนำออก = คำตอบถูกล้าง → STALE) · ✅ `r18-share.test.ts:481-575` |
| **H1 limiter ก่อน handler** | **PASS** | 📖 `route.ts:297-312` `await takeReadSlot` ก่อน `spec.handler` (ไม่รันขนานแล้ว) → 429 ไม่อ่านฐาน/ไม่เขียน audit การอ่านของ SA · ✅ `tests/platform/r18-read-limit-before-handler.test.ts` |
| **H2 precheck** | **PASS** | 📖 `throttle.ts precheckRates` อ่านอย่างเดียว ปฏิเสธเฉพาะ `count ≥ limit` (การจองจริงยังเป็นด่าน) → ไม่ทำให้ผ่านมากกว่าเดิม · ✅ `tests/auth/redeem-limits.test.ts` |
| **H3 ถังรวม 300/15 นาที** | **PASS (Low 1)** | 📖 `services/invites.ts:246-262` จองหลังถัง IP/ผู้ใช้ · คืนช่องเมื่อสำเร็จ · ถังเต็ม = 429 แม้โค้ดถูก (ดู Low 1) |
| **D1 ลบคำเชิญ + ประทับ id** | **PASS** | 📖 `repos/invite-purge.ts:371-398` ประทับ `inviterId`/`inviteeId` แล้ว DELETE ใน tx เดียว · `INTERNAL_PARAM_KEYS` เพิ่ม 2 คีย์ → `publicParams` ตัดออก (`services/notifications.ts:53` เป็นทางเดียวที่ params ออก API · invite ไม่ใช่ชนิด LINE) · ลบบัญชี: `json_remove` id + ล้างชื่อ (`repos/account.ts`) · ✅ `r18-invite-purge.test.ts:177-229` API ไม่มีคีย์ id · หลังลบบัญชีชื่อ = '' และไม่มี id ค้างในฐาน |
| **migration 0007** (กฎ 8) | **PASS** | 📖 `drizzle/0007_r18_appointment_share.sql` CREATE TABLE ใหม่ 2 ตาราง ไม่แตะตารางเดิม · FK ครบ `ON DELETE` ตาม ADR §2 (appointment CASCADE, created_by no action, อื่น SET NULL) · CHECK 4 ตัว · partial unique "1 ลิงก์ active ต่อคนต่อนัด" · ✅ `tests/platform/migration-0007.test.ts` |

## ผลต่อเกต — B) ทั้งระบบ 1.0
| หัวข้อ | ผล | หลักฐาน |
|---|---|---|
| auth/PIN/lockout/session/pepper | **PASS** | ✅ `tests/auth` 38 ไฟล์รวม security ผ่าน (ดูคำสั่ง) · 📖 cookie `httpOnly`/`secure`/`SameSite=Lax` (`auth/session.ts:43-55`) · pepper ไม่มีดีฟอลต์ หาย → AUTH_MAINTENANCE (`.env.example`) |
| RBAC ทุก route ใน manifest / authorize-first | **PASS** | ✅ `tests/security/authorize-first.test.ts`, `r5-admin-surface`, `tests/rbac` ผ่าน · manifest 83 แถว: public มีแค่ `/api/health`, `/api/line/webhook` · cron 3 แถว Bearer |
| รั่วข้ามกลุ่ม / busy | **PASS** | ✅ `tests/security/appointment-input-isolation`, `tests/busy/calendar-visibility` (ในชุดเต็ม) ผ่าน · §S ไม่เปิดทางใหม่ (ข้างบน) |
| invite code / admin-SA | **PASS** | r16 Low 1 (ชื่อ SA ใน `creatorName`) ปิดแล้ว — `serializers/groups.ts:116-124` `creatorSystemAdmin` · SA ใน §S: สร้างลิงก์ไม่ได้, revoke/remove = audited, ไม่มีชื่อ SA ในแจ้งเตือนแขก |
| ความลับใน repo/log | **PASS** | ✅ `git grep` รูปแบบคีย์ (sk-/AKIA/PRIVATE KEY/ghp_/JWT) = ไม่พบ · `.env.example` ไม่มีค่าลับ (มีแค่ค่าดีฟอลต์ที่ไม่ลับ) · ไม่มี `console.*` ที่พิมพ์ token/PIN/hash |
| headers/CSP | **PASS** | ADR 0014 (accepted) `'unsafe-inline'` ใน script/style · `frame-ancestors 'none'`, XFO DENY, nosniff, HSTS, COOP · ✅ `tests/ops/headers.test.ts` |
| dependency | **PASS** | ✅ `npm audit` และ `npm audit --omit=dev` = found 0 vulnerabilities (picomatch ที่เคยรับความเสี่ยงไม่ขึ้นแล้ว) |
| ข้อพบเก่า | — | r17 Low 1 ปิดแล้ว (`maintenance.ts` จับ error ต่อกลุ่ม + `failed`) · r16 Info 1 ปิดด้วย H1 · r16 Info 2–3, r17 Info 3–4 ตัดสินไม่แก้และบันทึกใน OPERATIONS (contract R18 §D3) · r17 Info 1–2 จดใน OPERATIONS §K/กล่องกู้คืน (D2) |

## ข้อพบ

### Low 1 — ถังรวม H3 ทำให้คนไม่กี่ IP ปิดการใช้โค้ดเชิญของทั้งระบบได้ และยังไม่มีคู่มือรับมือ
- ที่: `src/lib/data/services/invites.ts:246` (precheck รวม `redeem:all`) และ `:254-261` (จองถังรวม **ก่อน**ตรวจโค้ด) · ค่า `INVITE_RATE_LIMITS.redeemGlobal` 300/15 นาที (`:58`)
- ทำซ้ำ: ผู้โจมตีมี 10 IP (ถัง IP 30/15 นาที) × 3 บัญชีต่อ IP (ถังผู้ใช้ 10/15 นาที; สมัครได้ 5 บัญชี/ชม./IP) → ส่ง `POST /api/invites/redeem` ด้วยโค้ดผิด 300 ครั้งต่อหน้าต่าง → ถังรวมเต็ม → **ผู้ใช้จริงทุกคนที่พิมพ์โค้ดถูกได้ 429** จนหมดหน้าต่าง แล้วผู้โจมตีทำซ้ำได้ทุก 15 นาที
- ผลกระทบ: availability ของการเข้ากลุ่มด้วยโค้ดเท่านั้น (คำเชิญตรง/ลิงก์ชวนนัด/ข้อมูลไม่กระทบ · ไม่รั่วข้อมูล · 429 ไม่เป็น oracle) · เป็น trade-off ที่ contract H3 ขอไว้เอง แต่ `docs/OPERATIONS.md` ยังไม่มีวิธีสังเกต/รับมือ (grep `redeem:all` ไม่พบในเอกสาร)
- ข้อเสนอ: **ops** — เพิ่มใน OPERATIONS: อาการ (ผู้ใช้แจ้งว่าใส่โค้ดถูกแล้วได้ "ลองใหม่ภายหลัง"), วิธีดู `SELECT count FROM rate_limit_bucket WHERE key LIKE 'redeem:all%'`, ทางแก้ชั่วคราว (ใช้คำเชิญตรงแทน / ลบแถวถัง) · **auth (ถ้า main เห็นควร รอบหลัง)** — ลดรัศมี เช่น ให้ถังรวมบังคับเฉพาะผู้เรียกที่มีครั้งผิดในถังผู้ใช้/IP ของตัวเองแล้ว (คนที่ลองครั้งแรกยังผ่าน) หรือเปลี่ยนเป็นสัญญาณเตือน ops แทนการปิด

### Info 1 — แจ้งเตือนถึงแขกมี `groupId` ทั้งที่ DTO แขกตั้งใจไม่มี
- `services/appointments.ts:761,812`, `services/share.ts:300` ใส่ `groupId` ใน params ของ `appointment.guest.*` (จำเป็นสำหรับ purge กลุ่มตาม JSON) และ `publicParams` (`services/notifications.ts:53`) ไม่ตัดออก → แขกเห็น uuid กลุ่มทาง `GET /api/notifications` · เป็นแค่ id (ทุก route กลุ่มตอบแขก NOT_FOUND) ไม่ใช่ช่องสิทธิ์ · ถ้าต้องการให้ตรง ADR §5.4 ("ไม่มี groupId") → platform ตัด `groupId` ตอนส่งออกสำหรับชนิด `appointment.guest.*` (ไม่บังคับ)

### Info 2 — แขกที่ถูกนำออก ถ้าเข้าเป็นสมาชิกแล้วออก จะกลับมาเป็นแขกนัดเดิมได้
- `repos/appointment-guest.ts:108-109` `convertGuestRowsToMember` ลบแถวแขก **รวมแถวที่ถูกนำออก** (ตาม ADR §8.4) → ตัวกันกลับเข้าหาย · ทำซ้ำ: ถูกนำออกจากนัด A → ได้โค้ดเชิญกลุ่ม G → เข้ากลุ่ม → ออก → เปิดลิงก์ที่ยังใช้ได้ของ A → เป็นแขกได้อีก · ต้องผ่านการรับเข้ากลุ่มโดยสมาชิกก่อน จึงยอมรับได้ · main รับทราบ/บันทึกใน ADR ถ้าต้องการ

### Info 3 — `/i/[token]` ไม่มี `nocache` ใน robots และยังไม่ยืนยัน Cache-Control บน build จริง
- `src/app/i/[token]/page.tsx:18` ไม่มี `nocache: true` ตาม ADR §3 (header `X-Robots-Tag` มีแล้ว จึงเป็นเรื่องเล็ก) · `next.config.ts` ไม่ตั้ง Cache-Control ของ `/i/*` (คอมเมนต์ระบุว่า "ยังไม่ยืนยันบน build จริง") · ❓ ไม่ได้รัน `next build` + curl รอบนี้ · ข้อเสนอ: frontend เติม `nocache: true` · ops/qa ยืนยัน header `Cache-Control: private, no-cache, no-store` ของ `/i/<token>` บน preview

### Info 4 — `tests/ops/docs-sync.test.ts` ยังล้ม (ARCHITECTURE ยังไม่มีแถว route §S)
- ✅ ชุดเต็มรอบแรก: ขาดทั้งแถว route และตาราง `appointment_guest`/`appointment_share_link` · รอบสอง (ARCHITECTURE กำลังถูกแก้ใน worktree โดยผู้อื่น — `git status` = `M docs/design/ARCHITECTURE.md`): เหลือแถว route `POST /api/appointments/:id/share-link` ฯลฯ · ไม่ใช่ช่องโหว่ แต่ต้องเขียวก่อนเปิด PR (DOCS_SYNC) → architect

### Info 5 — access log ของ Vercel เก็บ path `/i/<token>`
- ยอมรับแล้วตาม ADR 0016 §3 และจดใน `docs/OPERATIONS.md:147` · แอปไม่ log เอง · ลิงก์รั่ว = ผู้ถือได้เพียงการ์ดนัดแบบจำกัด + ขอเป็นแขก (สมาชิกยกเลิก/นำออกได้) · ไม่ต้องทำเพิ่ม

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npx vitest run tests/platform/r18-share.test.ts tests/rbac tests/platform/migration-0007.test.ts tests/platform/r18-invite-purge.test.ts tests/platform/r18-read-limit-before-handler.test.ts tests/auth/redeem-limits.test.ts tests/auth/share-rate-limits.test.ts` | ✅ 14 ไฟล์ · 3136 passed |
| `npx vitest run tests/security tests/auth tests/ops/headers.test.ts tests/ui/share-model.test.ts tests/ui/share-render.test.ts` | ✅ 38 ไฟล์ · 723 passed, 1 skipped (config-hygiene ผ่านในเครื่องรอบนี้) |
| `npx vitest run` (ทั้งชุด) | 186 ไฟล์: 176 passed / 10 failed · 6605 passed, 17 failed, 19 skipped · สาเหตุที่ล้ม: timeout 5000ms ×4 (`admin/search`, `auth/ip-ratelimit`, `auth/security-r1`, `groups` membership) · Python ไม่มีในเครื่อง (`calendar/free-time` oracle) · `.bin/tsx` ENOENT / subprocess คืน null (`ops/admin-reset-pin-script`, `pepper-fingerprint-script`, `release`) · Node v26 ≠ /^v24/ (`ops/health`) · `ops/docs-sync` ×2 (Info 4) |
| `npx vitest run tests/ops/docs-sync.test.ts tests/auth/ip-ratelimit.test.ts tests/auth/security-r1.test.ts tests/groups --testTimeout=60000` | 14 ไฟล์: 13 passed · 191 passed, 1 failed = docs-sync แถว route (Info 4) → timeout ข้างบนเป็นเรื่องความเร็วเครื่อง ไม่ใช่บั๊ก |
| `npx tsc --noEmit -p .` | ✅ exit 0 |
| `npm audit` · `npm audit --omit=dev` | ✅ found 0 vulnerabilities ทั้งสอง |
| `git grep -nIE "(sk-…\|AKIA…\|-----BEGIN … PRIVATE KEY\|xox…\|ghp_…\|eyJhbGciOi…)"` | ✅ ไม่พบ |
| `git diff d6f413a..HEAD -- src \| grep '^+.*console\.'` | ✅ พบ 2 บรรทัด `[cron] … ${errorCodeOf(e)}` เท่านั้น |

## สิ่งที่ตรวจไม่ได้
- ❓ e2e (`tests/e2e/r18-share.spec.ts` ฯลฯ) ไม่ได้รันบนเครื่อง Windows นี้ — ดูผลจาก CI
- ❓ แข่งช่องสุดท้ายของเพดาน 10 / แขก→สมาชิกพร้อมกัน ข้าม instance บน Turso จริง (เทสต์ในเครื่องเป็น process เดียว) — ตรวจจากเหตุผลของ `BEGIN IMMEDIATE` + คำสั่งเดียวมีเงื่อนไข
- ❓ header `Cache-Control` ของ `/i/<token>` บน production build (Info 3)
- ❓ การดึงตัวอย่างลิงก์ของ LINE จริง (ควรเห็นแค่ชื่อแอป/คำอธิบายทั่วไป ตาม `generateMetadata`)

## ตรวจซ้ำ 2026-11-22
- ช่วง `git diff eac8f95..HEAD -- src` (HEAD `dcafebc`) · commit ที่แก้: `bb7a282` (auth, Low 1) · `9818d50` (platform, Info 1) · `dcafebc` (platform, Info 2) · `a2438b0` (frontend, Info 3 + ปรับ UI + แบนเนอร์ติดตั้งบน iOS) · ที่เหลือเป็นเอกสาร

| ข้อพบ | สถานะ | หลักฐาน |
|---|---|---|
| **Low 1** ถังรวม H3 ทำให้ทั้งระบบใช้โค้ดไม่ได้ | **ปิดแล้ว** (เหลือความเสี่ยงที่ยอมรับได้) | 📖 `services/invites.ts:250-279`: ถัง IP/ผู้ใช้เต็ม → 429 ตามเดิม · ถังรวมเต็ม → ปฏิเสธเฉพาะผู้เรียกที่ "ไม่สะอาด" (precheck: ถัง IP หรือผู้ใช้ > 0) · ตัดสินซ้ำ **หลังจอง** ใน `serialized` (`ipNow.count === 1 && userNow.count === 1`) → คำขอพร้อมกันของคนเดียวกันเห็น ≥ 2 และถูกปฏิเสธ (ข้าม instance ก็ fail-closed เพราะการจองเป็น UPSERT อะตอมมิก) · ผู้สะอาดที่ผ่านไม่ถือช่องรวม (`holdsGlobal=false`) แต่ครั้งที่ผิดค้างอยู่ในถัง IP/ผู้ใช้ → แต่ละคู่ (IP, บัญชี) ใหม่ได้เดาเพิ่มได้อย่างมาก 1 ครั้งต่อหน้าต่าง (ตรงกับที่อธิบายไว้ใน `:58-62`) · ความเสี่ยงที่เหลือ: ผู้ใช้จริงที่ใช้ IP ร่วมกับผู้โจมตี (CGNAT) หรือเพิ่งพิมพ์ผิด 1 ครั้งระหว่างถูกโจมตีจะได้ 429 — ยอมรับได้ · คู่มือรับมืออยู่ใน `docs/OPERATIONS.md:359-368` แล้ว (ห้ามลบถังด้วยมือระหว่างถูกโจมตี) · ✅ `tests/auth/redeem-limits.test.ts` (30 บัญชี × 10 IP → ผู้ถือโค้ดถูกยังเข้าได้ · ผู้สะอาดยิงพร้อมกัน 5 ครั้ง → ตรวจโค้ดได้ 1 ครั้ง · ถังรวมไม่เกินเพดานเมื่อแย่งช่องสุดท้าย) |
| **Info 1** แจ้งเตือนแขกมี `groupId` | **ปิดแล้ว** | 📖 `notify.ts:103-113` `publicParams(params, kind)` ตัด `groupId` ออกเฉพาะ `appointment.guest.*` · `services/notifications.ts:53` ส่ง `r.kind` (เป็นทางเดียวที่ params ออก API) · ในฐานยังเก็บ `groupId` ไว้ใช้ purge กลุ่ม/เพดาน unread · ชนิดของสมาชิกไม่เปลี่ยน · ✅ `tests/security/appointment-input-isolation.test.ts` |
| **Info 2** แขกที่ถูกนำออกกลับเข้าได้หลังเข้า-ออกกลุ่ม | **ปิดแล้ว** | 📖 `repos/appointment-guest.ts:111` DELETE เฉพาะ `removed_at IS NULL` · ไล่คิวรีที่อาจเจอแถวที่ถูกนำออกระหว่างเป็นสมาชิก: `isGuest`/`findActiveGuest`/รายชื่อแขก/นับเพดาน/`visibleToOwner`/busy/เตือน/LINE ล้วนกรอง `removed_at IS NULL` (คำตอบของแถวนั้นถูกล้างตอนนำออกแล้ว) · `findShareByTokenHash`/join ดู `viewerIsMember` ก่อนแถวที่ถูกนำออก → สมาชิกได้ 'member' · ลบบัญชี/purge กลุ่ม/ลบนัด ลบแถวนี้ไปด้วย · ✅ `tests/platform/r18-share.test.ts` (ถูกนำออก → เข้ากลุ่ม → ออก → เปิดลิงก์ = 404) |
| **Info 3** `/i/[token]` ไม่มี `nocache` | **ปิดแล้ว (ส่วนโค้ด)** | 📖 `src/app/i/[token]/page.tsx:18` `nocache: true` · ❓ ยังไม่ได้ยืนยัน header `Cache-Control` บน production build (ให้ ops/qa ตรวจบน preview ตามเดิม) |
| **Info 4** docs-sync ล้ม | **ปิดแล้ว** | ✅ `tests/ops/docs-sync.test.ts` ผ่านในรอบนี้ |
| **Info 5** access log มี `/i/<token>` | ยอมรับแล้ว (ไม่ต้องแก้) | ตามเดิม |

**ข้อพบใหม่: ไม่มี** — ไล่ diff ส่วนอื่นใน `src/` แล้ว: แบนเนอร์ติดตั้ง iOS (`components/home/install-hint.ts`) เก็บแค่ธง `"1"` ใน localStorage ไม่มีข้อมูลบัญชี/token และอ่าน UA เฉพาะฝั่ง client · ที่เหลือ (`LoginForm` ย้ายกล่องล็อก, `Name.tsx` class, `guest.fromGroup`, admin hub badge, CSS) เป็นการแสดงผลอย่างเดียว ไม่แตะสิทธิ์/ข้อมูล · ไม่มี `dangerouslySetInnerHTML` หรือ `console.*` เพิ่ม

| คำสั่ง | ผล |
|---|---|
| `npx vitest run tests/auth tests/security tests/rbac tests/platform/r18-share.test.ts tests/platform/r18-invite-purge.test.ts tests/notifications tests/groups tests/ui/install-hint.test.ts tests/ui/share-render.test.ts tests/ui/share-model.test.ts tests/ops/headers.test.ts tests/ops/docs-sync.test.ts --testTimeout=60000 --reporter=agent` | ✅ 63 ไฟล์ · 4093 passed, 1 skipped |

**Verdict หลังตรวจซ้ำ: ผ่าน** — Critical/High/Medium/Low = 0 · เหลือ Info 5 (ยอมรับแล้ว) และ ❓ Cache-Control ของ `/i/<token>` บน build จริง · e2e ยังต้องดูจาก CI
