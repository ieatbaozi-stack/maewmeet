# Security review — R15b (ความเร็ว · hardening เล็ก · B6/B7 · Next.js 16.4.5 · CI ข้ามเอกสาร)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-18 · branch `feat/r15b-speed-hardening` HEAD `ee7885c` (โค้ดล่าสุด `a6134cf` + commit เอกสาร PROGRESS) · ช่วง `git diff origin/main...HEAD` (13 commit, 49 ไฟล์) · เทียบ R15_CONTRACT §3, §4, §7 (B5–B7), §9 · กฎเหล็ก CLAUDE.md ข้อ 6–8 · ปิดข้อเดิมจาก `security-r10.md` (Low 1), `security-r11.md` (Low 2, Low 4, Info 7), `security-r14a.md` (Info 1), `security-r15a.md` (Info 3)
- วิธี: อ่านโค้ดจริงทุกไฟล์ฝั่งเซิร์ฟเวอร์ + CI ใน diff · รันเทสต์ของทีม · เขียน probe ชั่วคราวใน `tests/platform/` (ลบแล้ว `git status` สะอาด) · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows · Node v26.13.0 · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด · ❓ = ยืนยันไม่ได้

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Info | 6 |

**Verdict: ผ่านแบบมีข้อสังเกต** — การรวม query ไม่เปลี่ยนสิทธิ์ (ด่านเดิมทุกจุด ไม่มีการรั่วข้ามกลุ่ม) · rate limit ใหม่อะตอมมิก ยิงพร้อมกันเกินไม่ได้ · B7 ไม่มีชื่อ SA ในแถวใหม่ทุกทาง · /api/prefs เขียนได้เฉพาะบัญชีตัวเองที่ active · CI ไม่มีความลับ/`${{ }}` ใน run · Next 16.4.5 ปิด GHSA-mfr8-8qww-v76h (แอปไม่ใช้ `'use cache'`/`unstable_cache` อยู่แล้ว) · Low 1 คือ `neutralizeLinks` ยังมีรูปแบบที่ไม่ถูกแปลง (โดเมนที่มีอักษรไม่ใช่ ASCII, IPv4, จุดแบบอื่น) — ไม่บล็อก merge

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **`listMembersWithRsvps` = listMembers + listCurrentRsvps** (§3) | **PASS** | 📖 `repos/appointment.ts:309` LEFT JOIN `appointment_rsvp` บนแถว `group_member` ของ `groupId` = กลุ่มของนัด (`toDetailDto` ส่ง `row.groupId`) พร้อม `updated_at >= joined_at` เหมือน `listCurrentRsvps` (`:279`) → คำตอบก่อนกลับเข้ากลุ่ม/ของคนที่ออกแล้วไม่แสดง · PK (appointment_id,user_id) → ไม่เกิน 1 คำตอบต่อสมาชิก · ด่าน `loadAppointmentCtx` + `can()` ก่อนเรียกไม่เปลี่ยน · ✅ `tests/platform/r15b-golden.test.ts` JSON เท่าเดิมทุกไบต์ |
| **`getGroupPage` ด่านเดียว** | **PASS** | 📖 `services/groups.ts:153` `loadGroupCtx(actor)` → `authorize('group.view')` → รายละเอียด · รายการนัดผ่าน `listGroupAppointmentsIn` ที่ยัง `authorize('appointment.view')` บนด่านเดียวกัน (`services/appointments.ts`) · ด่านถูกโหลดในฟังก์ชันเดียวกัน ไม่รับด่านจากภายนอก · `loadGroupPage` เป็น `React.cache` ต่อ request · ✅ probe: คนนอก `GET /api/groups/:gid` และ `/appointments` → 404 |
| **`takeResolvedSessionUser` สับสนผู้ใช้ไม่ได้** | **PASS** | 📖 `auth/session.ts:135` WeakMap ผูกกับวัตถุ `Request` ของ request นั้น · ผู้เรียก (`appointments.ts:469`, `prefs.ts:43`) เทียบ `cached.id === actor.id` ก่อนใช้ ไม่ตรง → อ่าน DB เหมือนเดิม · ชื่อผ่าน `sanitizeDisplayText` |
| **`creatorActive` EXISTS** | **PASS** | 📖 `repos/appointment.ts:94` กติกาเดียวกับ `listActiveMemberIds` (`group_member` ของกลุ่มนัด + `user.status='active'`) · ใช้เลือกผู้รับ `rsvp_changed` เท่านั้น ไม่ใช่สิทธิ์ · อ่านก่อน tx (main รับตาม §9) — กรณีผู้สร้างออกพร้อมกัน แถวที่เขียนถูกซ่อนด้วย `visibleToOwner` (`repos/notification.ts:92`) · `rsvp_changed` ไม่อยู่ใน `LINE_KINDS` → ไม่ส่ง LINE · ✅ `tests/notifications` ผ่าน |
| **rate limit ใหม่** (§4) | **PASS** | 📖 ทุกจุดนับ*หลัง* `authorize` · PATCH busy (`busy.ts:297`) และ PATCH routine (`busy-routines.ts:345`) นับก่อนหาแถว → 404 ก็นับ (ปิด R14a Info 1) · leave (`groups.ts:357`) หลังด่านกลุ่ม · icon (`groups.ts:222`) เฉพาะที่ค่าเปลี่ยน (ปิด R15a Info 3) · ✅ probe ยิง PATCH busy 85 คำขอพร้อมกันบน id สุ่ม → 404 = 60 พอดี, 429 = 25 (`reserveBucket` UPSERT มีเงื่อนไขในคำสั่งเดียว) |
| **คืนช่อง (refund) ตอน redeem** | **PASS** | 📖 `invites.ts:241-281` จองถัง `group:membership` หลังจองถัง redeem และ*ก่อน* `joinGroupWithCode` · เต็ม → คืนช่อง redeem แล้ว 429 โดยไม่ตรวจโค้ด (ไม่เป็น oracle) · คืนช่อง membership เฉพาะเมื่อไม่ได้เข้าจริง (ผิด/เต็ม/เป็นสมาชิกแล้ว) → ครั้งที่เข้าได้จริงยังถือช่องอยู่ จำนวนเข้าสำเร็จต่อหน้าต่าง ≤ limit · refund ลดเฉพาะหน้าต่างเดิม (`refundBucket`) · ✅ probe 35 โค้ดถูกยิงพร้อมกัน: สถานะมีแค่ 200/429, เข้าสำเร็จ 10 ≤ 30 และตรงกับแถว `group_member` (ตัวจำกัดคือถัง redeem ที่จองไว้พร้อมกัน — ทางที่เข้มกว่า) · ✅ เทสต์ทีม `r15b-hardening.test.ts:88` |
| **`?scope=` ซ้ำ** | **PASS** | 📖 `api/me/busy/[id]/route.ts:24` `getAll('scope').length > 1` → VALIDATION รูปเดียวกับค่าผิด (ไม่สะท้อนค่า) · ✅ `r15b-hardening.test.ts:72` ไม่มีแถวถูกลบ |
| **LINE `neutralizeLinks`** (R10 L1 / R11 L4) | **PASS บางส่วน (Low 1)** | ✅ ตัวพิมพ์ใหญ่ `HTTPS://EVIL.COM` → `HTTPS:∕∕EVIL․COM` · `www.`/`bit.ly/abc` ติดอักษรไทย → แปลงแล้ว · zero-width/soft hyphen ถูก `sanitizeDisplayText` ตัดก่อน → แปลงแล้ว · แต่บางรูปแบบไม่ถูกแตะ ดู Low 1 |
| **B6 เพดาน OA 300/เดือน** | **PASS (Info 2)** | 📖 `repos/line.ts:159` เงื่อนไข `oaMonthCount < 300` อยู่ใน UPDATE เดียวกับการจอง (ภายใต้ `serialized`) → ไม่มี check-then-act · นับ `sent` ตั้งแต่ต้นเดือน Asia/Bangkok + `pending attempts>0` · ระยะเก็บ outbox 90 วัน > 1 เดือน · log มีแค่ตัวนับ `[line] OA monthly cap 300 reached; capped=N` (`dispatch.ts`) ไม่มี id/ชื่อ/LINE user · `lastError` เป็นรหัสล้วน · ✅ `r15b-hardening.test.ts:300-330` |
| **B7 `actorSystemAdmin`** (R11 Low 2) | **PASS (Info 1, 3)** | 📖 `appointments.ts:478` `actorRole === null` หลัง `authorize` = SA ที่ไม่ใช่สมาชิกเท่านั้น (`can.ts` `inGroup` ตัดคนนอกที่ไม่ใช่ SA) → `actorName: ''` ไม่อ่านชื่อเลย · `actorId` ยังเก็บแต่อยู่ใน `INTERNAL_PARAM_KEYS` ไม่ออกทาง API · LINE payload ตัด `actorName/actorId/actorSystemAdmin` (`notify.ts` `LINE_PAYLOAD_OMIT`) และข้อความ LINE ไม่มีชื่อผู้กระทำ · UI ใช้ป้ายแปลแล้ว (`model.ts:206`) · ✅ `r15b-hardening.test.ts:215` ไม่มี `actorId` และไม่มีคำว่า `boss` ใน params · ✅ `tests/ui/notifications-model-r11.test.ts` |
| **/api/prefs บันทึก locale** | **PASS (Info 5)** | 📖 `prefs.ts:43` actor มาจาก session ของ request เท่านั้น (ไม่มี userId จาก body) · `status === 'active'` + UPDATE มี `status='active'` (`repos/user.ts:34`) · ค่าผ่าน zod enum `th|en` · CSRF Origin ของ `route()` ครอบ POST อยู่แล้ว (`api/_lib/route.ts:119`) · คำตอบเท่าเดิม · ✅ `r15b-hardening.test.ts:173,196` |
| **CI ข้าม build/e2e เมื่อแก้เอกสารล้วน** | **PASS (Info 4)** | 📖 trigger = `pull_request` / `push main` / `workflow_dispatch` (ไม่มี `pull_request_target`) · `permissions: contents: read` · job `changes` ส่ง sha ผ่าน `env:` ไม่ใส่ `${{ }}` ใน `run:` · `persist-credentials: false` · ไม่มี `secrets.*` ใน ci.yml · `--no-renames`: ย้าย `src/x.ts` → `x.md` = มีไฟล์ลบนอก docs → `code=true` · ชื่อไฟล์แปลกถูก git quote (`"…"`) ไม่ตรง regex → `code=true` · `.MD` ตัวใหญ่ → `code=true` · lint/typecheck/test/contrast ยังรันทุก PR · `grep` ไม่พบโค้ดใน `src/` ที่ import/อ่าน `docs/` หรือ `.md` · ✅ `tests/ops/ci-docs-skip.test.ts` |
| **Next.js 16.4.5 / GHSA-mfr8-8qww-v76h** | **PASS** | ✅ `gh api advisories/GHSA-mfr8-8qww-v76h`: medium · `next >= 16.3.0, <= 16.4.4` · patched `16.4.5` · ต้องใช้ `'use cache'` ร่วมกับ `unstable_cache()` + root params · ✅ `grep "use cache|unstable_cache|cacheLife|cacheTag" src next.config.ts` ไม่พบ (มีแค่คอมเมนต์ `cacheComponents` ปิดไว้ `next.config.ts:96`) → เดิมก็ไม่เข้าเงื่อนไข · `node_modules/next` = 16.4.5 · lockfile เปลี่ยนเฉพาะแพ็กเกจ `next`/`@next/*`/`eslint-config-next` |
| **ความลับ / log** (กฎ 7) | **PASS** | ✅ grep บรรทัดที่เพิ่มหา `secret|token|password|api_key|BEGIN KEY|console.`: `console.warn` ใหม่ 2 จุด = ตัวนับ OA (ไม่มีข้อมูลคน) และ helper เทสต์ · OPERATIONS เปลี่ยน `boss` เป็น `<admin-username>` ไม่มีค่าจริง |
| **migration** (กฎ 8) | **N/A** | ไม่มี migration ใน R15b |

## ข้อพบ

### Low 1 — `neutralizeLinks` ไม่แปลงโดเมนที่มีอักษรไม่ใช่ ASCII, IPv4 และจุดแบบอื่น
- ที่: `src/lib/integrations/line/messages.ts:25` regex จุดคือ `([A-Za-z0-9-])\.(?=[A-Za-z])` — ต้องมีอักษร ASCII ทั้งก่อนและหลังจุด และรู้จักแค่ `.` ตัวเดียว
- ✅ ผลจาก probe (`sanitizeDisplayText` → `neutralizeLinks`):
  - `ทดสอบ.com` → ไม่เปลี่ยน · `ตัวอย่าง.ไทย` → ไม่เปลี่ยน · `examplé.com` → ไม่เปลี่ยน (ตัวท้ายก่อนจุดเป็น é)
  - `192.168.1.10/login` → ไม่เปลี่ยน · `1.1.1.1` → ไม่เปลี่ยน (`http://192.168.1.10` scheme ถูกแปลง แต่ตัว IP ไม่ถูกแปลง)
  - `example。com` (U+3002) · `example．com` (U+FF0E) · `ｅｘａｍｐｌｅ.com` (ตัวเต็มความกว้าง) → ไม่เปลี่ยน
- สถานการณ์: admin/moderator ตั้งชื่อกลุ่ม หรือผู้สร้างนัดตั้งชื่อนัดเป็น `ทดสอบ.com` หรือ `192.168.1.10/login` → ข้อความ LINE เตือนนัด/ยกเลิกนัดมีข้อความนี้ตามเดิม ถ้า LINE ทำ autolink กับรูปแบบนี้ ผู้รับจะเห็นลิงก์ที่กดได้ในข้อความจากบัญชี OA ของแอป
- ❓ **ยืนยันไม่ได้**ว่าแอป LINE ทำ autolink กับ IDN แบบ Unicode, IPv4 หรือ `。`/`．` หรือไม่ (ไม่พบเอกสารทางการของกติกา autolink ของ LINE · ไม่ได้ทดสอบบนเครื่องจริง) · ระดับความเสี่ยงเท่ากับ R10 L1 เดิม (ต้องเป็นสมาชิกที่ตั้งชื่อได้อยู่แล้ว ผู้รับเป็นคนในกลุ่มเดียวกัน)
- ข้อเสนอ (platform): ใช้คลาส Unicode `/([\p{L}\p{N}\p{M}-])[.。．｡](?=[\p{L}\p{N}])/gu` และแปลงจุดของ IPv4 ด้วย (เช่น `\d\.\d` เมื่อมีจุด ≥ 3 จุดติดกัน) · เพิ่มกรณีด้านบนในเทสต์ · ทางเลือก: ทดสอบกับแอป LINE จริงก่อนแล้วค่อยตัดสินว่าต้องแก้ไหม

## Info
1. **แถวแจ้งเตือนเก่าก่อน R15b ยังมีชื่อ SA** — B7 แก้เฉพาะแถวใหม่ (ไม่มี backfill เพราะไม่มี migration) · แถว `appointment.updated/cancelled` ที่ SA นอกกลุ่มทำไว้ก่อน merge ยังแสดงชื่อจริงจนหมดอายุ retention · ถ้าต้องการล้าง ต้องเป็น migration/สคริปต์ในรอบหลัง
2. **เพดาน OA ไม่แบ่งต่อกลุ่ม** — กลุ่มเดียวที่มีนัดและสมาชิกเชื่อม LINE เยอะใช้ 300 ข้อความได้หมด กลุ่มอื่นในเดือนนั้นได้แค่กระดิ่ง (ตาม B6 · ไม่มีข้อมูลรั่ว) · ❓ ขอบเดือนของโควตา LINE อาจไม่ใช่ Asia/Bangkok — ยืนยันไม่ได้ ถ้าโควตาของ LINE รีเซ็ตก่อนเรา จะหยุดส่งเร็วไปเล็กน้อย (ไม่เกินโควตา)
3. **ชื่อ SA ที่ไม่ใช่สมาชิกยังไปถึงผู้ถูกเชิญ** — SA นอกกลุ่มเชิญตรงได้ (`can.ts:206` `anyMember()` → ALLOW_AUDITED) แล้ว `group.invite.received` มี `inviterName` = ชื่อ SA (`invites.ts:153`) · ผู้รับคือผู้ถูกเชิญ ไม่ใช่สมาชิกกลุ่ม จึงอยู่นอกขอบ B7/R11 Low 2 · บันทึกไว้เพื่อความสอดคล้องถ้าต้องการใช้ป้าย "ผู้ดูแลระบบ" ทุกที่
4. **CI: สคริปต์ตัดสินมาจาก checkout ของ PR** — PR แก้ `changed-code.sh` ให้ตอบ `code=false` ได้ แต่ PR นั้นก็แก้ `ci.yml` ได้อยู่แล้ว (trust เท่าเดิม · repo private) · job ที่ถูกข้ามนับว่าผ่าน — ถ้าตั้ง required checks ในอนาคต ให้รวม `test` (รันทุก PR) ไว้ด้วย · reviewer ควรดูว่า PR "เอกสารล้วน" ไม่ได้แตะ `.github/`
5. **/api/prefs ไม่มี rate limit** — สลับ th/en รัว ๆ = UPDATE 1 แถวของตัวเองต่อครั้ง (ไม่มี audit ไม่มีแจ้งเตือน) · ผลกระทบต่ำ
6. **npm audit** — 23 รายการ (10 moderate, 13 high) ทั้งหมดเป็น dev toolchain (vitest/vite/eslint/drizzle-kit/esbuild) ยกเว้น `picomatch 4.0.7` ใต้ `next-intl → @parcel/watcher` (GHSA-fc5q-39xc-vjpf ReDoS · pattern ไม่ได้มาจากผู้ใช้ · ใช้ตอน dev/build) · มีอยู่ก่อนรอบนี้ (lockfile diff ไม่แตะ) · `next` ไม่อยู่ในรายการแล้ว

## คำสั่งที่รัน + ผลจริง
```
npx vitest run tests/platform/r15b-hardening.test.ts tests/platform/r15b-golden.test.ts tests/perf/r7-baseline.test.ts tests/notifications tests/ui/notifications-model-r11.test.ts tests/ops/ci-docs-skip.test.ts
  → Test Files 7 passed (7) · Tests 117 passed (117)
npx vitest run tests/security tests/rbac tests/line tests/integrations
  → Test Files 21 passed (21) · Tests 2980 passed | 1 skipped (2981)
npx vitest run tests/groups tests/busy tests/appointments tests/auth tests/account tests/admin tests/ui tests/i18n
  → Test Files 84 passed (84) · Tests 1518 passed (1518)
npx vitest run tests/platform tests/api tests/ops
  → Test Files 3 failed | 37 passed (40) · Tests 8 failed | 513 passed | 17 skipped (538)
    ล้ม: tests/ops/health.test.ts ("expected 'v26.13.0' to match /^v24\./" — เครื่องเป็น Node 26)
         tests/ops/pepper-fingerprint-script.test.ts ×4, tests/ops/admin-reset-pin-script.test.ts ×3 (subprocess สคริปต์ — ปัญหาเครื่องเดิม)
    ไม่เกี่ยวกับ diff R15b
npx tsc --noEmit -p .  → ไม่มี error
npm audit               → 23 vulnerabilities (10 moderate, 13 high)
npm audit --omit=dev    → 2 high (picomatch ← @parcel/watcher ← next-intl)
gh api advisories/GHSA-mfr8-8qww-v76h → medium · next >=16.3.0 <=16.4.4 · patched 16.4.5
probe (ลบแล้ว): neutralizeLinks 20 กรณี (ผลใน Low 1) · PATCH busy 85 พร้อมกัน → 404×60 + 429×25
               · redeem 35 โค้ดพร้อมกัน → 200/429 เท่านั้น, เข้า 10 = แถว group_member 10 · คนนอก GET group/appointments → 404
```

## ตรวจไม่ได้
- พฤติกรรม autolink ของแอป LINE จริง (Low 1, ❓) · ขอบเดือนของโควตา LINE OA (Info 2)
- e2e (Playwright) และ `npm run build` ไม่ได้รันในเครื่องนี้ — ดูผลจาก CI
- `npm test` ทั้งชุดไม่ได้รันรวดเดียว (รันแยกตามโฟลเดอร์ข้างบนครบทุกโฟลเดอร์ยกเว้น `tests/release`, `tests/lint`, `tests/e2e`, `tests/calendar`, `tests/availability`, `tests/places`, `tests/helpers` ซึ่ง diff ไม่แตะโค้ดที่ทดสอบ ยกเว้น `tests/helpers/fs.ts` ที่เป็นของเทสต์)
