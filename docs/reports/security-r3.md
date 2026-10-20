# Security review — R3 (ปฏิทินกลุ่ม + busy)

- ผู้ตรวจ: Security (อิสระ — ไม่ได้เขียนโค้ดนี้) · วันที่: 2026-10-20
- ขอบเขต: `git diff 18b7841..HEAD` บน branch `r3` (HEAD `1e11bc4`) · เทียบ R3_CONTRACT §3/§5/§6, ADR 0006, ADR 0004
- วิธี: อ่านโค้ดแบบ adversarial + PoC จริง 2 แบบ (a) harness ของโปรเจกต์ (handler จริง + libSQL ไฟล์ + migration จริง) (b) `next build` + `next start` จริง (พอร์ต 3101, DB ไฟล์ชั่วคราว) ยิง HTTP ด้วย fetch · PoC อยู่นอก repo (scratchpad) ไม่แก้ `src/` ไม่แก้เทสต์ · ลบ DB/เซิร์ฟเวอร์ชั่วคราวแล้ว
- รันเทสต์เดิมซ้ำเอง: `vitest run tests/busy tests/rbac tests/security tests/calendar tests/auth/must-change-pin.test.ts` → 18 ไฟล์ / 2299 เทสต์ ผ่านหมด

## สรุปผล

| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 (M1) |
| Low | 5 (L1–L5) |

**ไม่พบช่องที่ `note` หรือ `title` ของรายการซ่อนรั่วให้ผู้ที่ไม่ใช่เจ้าของ ในทุกช่องทางที่ลอง.**
ข้อพบเดียวที่ควรแก้ก่อน merge คือ M1 (เพดาน 300 นับเฉพาะรายการที่ยังไม่สิ้นสุด ทำให้เพิ่มแถวได้ไม่จำกัด และปฏิทินกลุ่มไม่มี LIMIT → DoS/พองของข้อมูลต่อกลุ่ม) — กติกา R3-11 "Medium ขึ้นไปแก้และตรวจซ้ำ"

## Verdict ต่อเกต

| เกต | ผล | หลักฐาน |
|---|---|---|
| **R3-3 เจ้าของเท่านั้น** | **PASS** | PATCH/DELETE ของคนอื่น (สมาชิกกลุ่มเดียวกัน, คนนอก, super admin) → 404 `{"error":{"code":"NOT_FOUND"}}` เหมือน uuid ที่ไม่มีอยู่ทุกไบต์ · `userId`/`id`/`createdAt`/`updatedAt`/`hidden`/`constructor`/`__proto__` ใน body → 400 `UNKNOWN_FIELD` (strict) · `{...{__proto__:{userId}}}` ผ่าน spread ไม่สร้างคีย์ แถวยังเป็นของเจ้าของ · `GET /api/me/busy` คืน title+note ครบรวมรายการซ่อน |
| **R3-4 การมองเห็น** | **PASS** | ดูหัวข้อ "สิ่งที่ลองแล้วไม่พบช่องโหว่" ด้านล่าง (canary ทุกบทบาท × API + SSR HTML + audit + log + error body) |
| **R3-6 RBAC** | **PASS** | anonymous → 401 · suspended → 401 · `must_change_pin` → 403 ทั้ง 5 route (GET/POST/PATCH/DELETE me/busy + GET calendar) · กลุ่มถูกลบ → 404 แม้ super admin · เทสต์สแกน authorize-first ผ่าน |

สถานะรวม: เกต R3-3/4/6 ผ่านด้านความปลอดภัย · **เงื่อนไขก่อน sign-off: แก้ M1 แล้วให้ผมตรวจซ้ำ** (L1–L5 ไม่บล็อก)

---

## ข้อพบ

### M1 — Medium · เพดาน 300 ไม่คุมแถวที่สิ้นสุดแล้ว + ปฏิทินกลุ่มไม่มี LIMIT (DoS / พองของข้อมูล)

**ที่ไหน**
- `src/lib/data/repos/busy.ts:42-43` `activeCount` นับเฉพาะ `end_at > now`; ใช้ที่ `:59` (INSERT) และ `:99` (UPDATE)
- `src/lib/data/repos/busy.ts:140-159` `sharedBusyInGroupQuery` ไม่มี `LIMIT`
- `src/lib/data/services/calendar.ts:332` เรียกคิวรีนั้นตรง ๆ (สมาชิก ≤ 50 × แถวต่อคนไม่จำกัด)
- ไม่มี rate limit บน 4 route เขียนใหม่ และไม่มี job ลบ busy เก่า (`grep busy src/app/api/cron` ว่าง)

**ทำไมเป็นปัญหา** ลงย้อนหลังได้ ≤ 7 วัน (`BUSY_MAX_BACKDATE_DAYS`) และรายการที่ `end_at <= now` ไม่นับเข้า 300 → สมาชิกคนหนึ่ง POST รายการ "ที่จบไปแล้ว" ได้ไม่จำกัด (หรือ POST 300 อนาคต → PATCH ย้ายเข้าอดีต ≤ 7 วัน → ทำซ้ำ) ทุกแถวอยู่ในหน้าต่างที่ปฏิทินเดือนนี้ขอ จึงถูกส่งให้สมาชิกทุกคนของทุกกลุ่มที่เขาอยู่ และคิวรีสแกนแถวของสมาชิกทุกคนทั้งประวัติ (`EXPLAIN QUERY PLAN`: `SEARCH b USING INDEX busy_user_end_idx (user_id=?)` + `USE TEMP B-TREE FOR ORDER BY` — ไม่มี range บน start/end เพราะกรองด้วย `local_*_date`)

**Repro (harness)**
```
for i in 1..400: POST /api/me/busy {kind:'all_day', startDate:'2026-10-12', endDate:'2026-10-12', title:'x'*80, note:'n'}   # now = 2026-10-18
→ 400 × 201 ใน 1.9 วินาที, ไม่มี 409
GET /api/groups/:g1/calendar?from=2026-10-01&to=2026-10-31   (เป็นสมาชิกอีกคน)
→ 200, 129,617 ไบต์, busy.length = 400
```
แล้วยังลงรายการอนาคตได้อีก 300 (301 → 409 ตามที่ออกแบบ) · ขยายเป็น 50k แถว ≈ 16 MB ต่อคำขอปฏิทิน; ผู้โจมตีเป็นสมาชิกที่ล็อกอินแล้ว (ไม่ใช่ anonymous)

**แนวทางแก้ (เลือกอย่างน้อย 1+2)**
1. เพดานแถวรวมที่ "ยังอยู่ในหน้าต่างแก้ไขได้": นับ `end_at > now - (BACKDATE_DAYS+1)*86400000` (หรือเพดานแถวทั้งหมดต่อผู้ใช้ เช่น 600) ในเงื่อนไข SQL เดียวกันของ `insertBusyIfUnderCap` / `updateOwnBusyIfUnderCap` · ปรับเทสต์ "เกินเพดาน" ให้ครอบกรณีรายการที่จบแล้ว
2. ใส่ `.limit(N)` (เช่น 50 × 300 = 15,000 หรือต่ำกว่า) + เรียง/กรองด้วย `start_at`/`end_at` (กว้างกว่าช่วงวัน ±1 วัน เพื่อไม่พลาด tz) ให้ใช้ index ได้
3. cron ลบ busy ที่ `end_at < now - 90 วัน` (หรือ archive) · และ/หรือ rate limit ต่อผู้ใช้บน POST/PATCH `/api/me/busy`

---

### L1 — Low · `note` รับตัวจัดรูป/bidi (Cf) ได้ — ปลอดภัยตราบที่ยังเห็นคนเดียว
`src/lib/data/services/busy.ts:124` `NOTE_FORBIDDEN` ห้ามเฉพาะ Cc/Zl/Zp · PoC: `note: "CANARY-Z‮"` → 201 และเก็บตามนั้น (title ปฏิเสธ `INVALID` ถูกต้อง) · ไม่ใช่ช่องโหว่ใน R3 เพราะ `note` ออกให้เจ้าของเท่านั้น · **ข้อเสนอ**: ถ้าอนาคตมีส่งออก/แชร์/แจ้งเตือนที่มี note ให้กรอง Cf ที่ serializer ขาออก หรือใช้กฎเดียวกับ title ก่อนเปิดฟีเจอร์นั้น (บันทึกใน ADR 0006 ว่า note ไม่ผ่านกฎ bidi)

### L2 — Low · `tz` ของเจ้าของ (ค่าที่ API รับเป็น IANA ใดก็ได้) ถูกส่งให้เพื่อนทุกคน
`src/lib/data/repos/busy.ts:150` + `BUSY_SHARED_FIELDS` · PoC: owner POST `tz:'America/New_York'` → สมาชิกเห็น `"tz":["Asia/Bangkok","America/New_York"]` · เป็นไปตาม ADR 0006 §2 (tz อยู่ใน allowlist) และ UI ไม่มีตัวเลือก tz (ADR 0004) แต่ API เปิดรับ จึงเป็นการเปิดเผยตำแหน่งโดยประมาณถ้าผู้ใช้ตั้งเอง/ไคลเอนต์อื่นตั้งให้ · **ข้อเสนอ**: ฝั่งแชร์ไม่ต้องส่ง `tz` ถ้าไม่ใช้ (UI คำนวณจาก `startAt`+tz กลุ่ม — ตรวจ `spanOf(b, groupTz)`) หรือยืนยันว่ายอมรับและบอก boss

### L3 — Low · ความถูกต้อง: กรองวันของคิวรีแชร์ใช้ "วันท้องถิ่นของเจ้าของ" เทียบกับช่วงตารางของกลุ่ม
`src/lib/data/repos/busy.ts:157` (`local_start_date <= to AND local_end_date >= from`) · เจ้าของ tz ต่างจาก tz กลุ่ม (ผ่าน API เท่านั้น) อาจทำให้รายการชิดขอบตารางหายหรือเกินได้ ≤ 1 วัน (ตรวจจากโค้ด ไม่ได้ PoC) · ไม่ใช่ปัญหาความลับ · แก้พร้อม M1 ข้อ 2: กรองด้วย `start_at < toEpoch(to+1) AND end_at > toEpoch(from)` ใน tz กลุ่ม

### L4 — Low · `GET /api/me/busy?from&to` ตัดที่ 1000 แถวเงียบ ๆ
`src/lib/data/services/busy.ts:217` · หลังแก้ M1 จะไม่เกิน แต่ก่อนแก้ผู้ใช้ที่ถูกพองแถวจะไม่เห็นว่าถูกตัด · เสนอให้คืนธง truncated หรือใช้เพดานเดียวกับ M1

### L5 — Low / ยืนยันเจตนา · สมาชิกที่ถูกระงับ (suspended) ยังปรากฏในปฏิทินกลุ่มพร้อม busy
PoC: owner `status='suspended'` → สมาชิกอื่นยังเห็น busy (1 รายการ) และรายชื่อ 3 คน (`listMembers`/`sharedBusyInGroupQuery` ไม่กรอง `user.status`) · สอดคล้องกับรายชื่อสมาชิกที่มีอยู่ (R2) จึงไม่ใช่ regression · ถ้า PRD ต้องการให้ผู้ถูกระงับ "หายจากปฏิทิน" ให้เพิ่มเงื่อนไข `user.status='active'` ทั้งสองคิวรี

---

## สิ่งที่ลองแล้วไม่พบช่องโหว่ (ยืนยันด้วยการรันจริง)

**1. ความเป็นส่วนตัวของ `note` / title ที่ซ่อน** — seed `CANARY-T` (ไม่ซ่อน), `CANARY-H` (title ซ่อน), `CANARY-N` (note) แล้วค้นสตริงดิบ:
- `/api/groups/:gid/calendar` ในฐานะ: สมาชิก, เจ้าของเอง, สมาชิกถูกลบออก (ก่อนลบเห็นได้ปกติ → หลังลบ 404 ทันที), คนนอกทุกกลุ่ม (404), anonymous (401), super admin ที่ไม่ใช่สมาชิก (200; ไม่มี CANARY-N/H; มี audit `group.calendar.view` meta = `{from,to,asSuperAdmin:true}` ไม่มี title/note) → ไม่พบ `CANARY-N` / `CANARY-H` เลย; พบ `CANARY-T` เฉพาะรายการไม่ซ่อน
- ข้ามกลุ่ม: O อยู่ G1+G2, ดูผ่าน G2 เห็นเฉพาะข้อมูลของ G2 · O ออก G1 → busy ของ O หายจากปฏิทิน G1 ทันที · rejoin → กลับมา · กลุ่มถูกลบ → 404 แม้ super admin
- รูปร่าง: รายการซ่อน = 8 คีย์ (ไม่มี `title`/`hidden`/`hideDetail`/`note`/`createdAt`/`updatedAt`) · SQL ฝั่งแชร์ SELECT list ไม่มี `note` และตัด `title` ด้วย CASE ใน SQL; serializer สร้างอ็อบเจกต์ใหม่จาก allowlist (`src/lib/data/serializers/busy.ts:41-60`) · สลับ `hideDetail` true↔false มีผลคำขอถัดไปทันที (ไม่มี cache) · PATCH `note:null` ล้างจริง
- **SSR / RSC / HTML**: `next build` + `next start` จริง · GET `/calendar?g=…` ในฐานะ owner, สมาชิก, admin ของกลุ่ม, คนนอก, super admin, anonymous → HTML (62 KB, flight payload ฝังในหน้า) ไม่มี `CANARY-N`, ไม่มี `CANARY-H`; มี `CANARY-T` เฉพาะสมาชิก · ไม่มี `__NEXT_DATA__` (App Router) · คำว่า `note`/`hidden` ที่พบคือ key ของแค็ตตาล็อกข้อความ i18n ไม่ใช่ข้อมูล · props ที่ server ส่งให้ client ของ "คนอื่น" มีเฉพาะ `GroupCalendarDto` (shared/hidden view) — มุมมอง "ของฉัน" (`note`) ดึงฝั่ง client จาก `/api/me/busy` ซึ่งผูกกับ session เท่านั้น
- **Header**: ทุกคำตอบของ 5 route ใหม่ (200/400/401/403/404) มี `Cache-Control: private, no-store` (route wrapper `json()`), หน้า `/calendar` ได้ `private, no-cache, no-store, max-age=0, must-revalidate` · ไม่มี ETag → `If-None-Match: *`/`If-Modified-Since` ได้ 200 ไม่ใช่ 304
- **Error / log**: ส่ง title/note/tz/คีย์แปลกที่มี canary ไปทุกทางที่ validate ล้ม (วันผิด, tz ผิด, `userId` เกิน, title ยาว, ตัวควบคุม) → body เป็นรหัส+ชื่อฟิลด์เท่านั้น ไม่สะท้อนค่า (`CalendarError.message` ที่มีค่าอินพุตไม่ถูกส่งต่อเข้า `AppError`) · `console.error` ใน route log เฉพาะ method/path/ชื่อชนิด error · log ของ `next start` ตลอดการยิง: 0 ครั้งที่มี `CANARY` · `audit_log` ทั้งตาราง: ไม่มี canary
- **Oracle**: คนนอก / gid ไม่มีจริง / กลุ่มถูกลบ / ช่วงวันผิด / ไม่มี from-to → 404 `{"error":{"code":"NOT_FOUND"}}` ไบต์เดียวกัน (ตรวจช่วงหลังด่านสิทธิ์) · `:id` ที่ไม่ใช่ uuid → 400 (ไม่เป็น oracle ของข้อมูล)

**2. Authz** — IDOR/mass-assignment ตามตาราง R3-3 ด้านบน · `must_change_pin`/suspended/anonymous ตาม R3-6 · CSRF: POST/PATCH/DELETE ใหม่ด้วย Origin `https://evil.example`, `null`, ไม่มี Origin, หรือ `content-type: text/plain` → 403 `CSRF_REJECTED` ทั้งหมด (แถวไม่ถูกแก้/ลบ) · `?g=` ใน `/calendar`: ต้องอยู่ใน `listMyGroups` ของผู้ดูจึงถูกใช้ (ไม่งั้นตกเป็นกลุ่มแรก) · `v` เป็น whitelist · `d` ผ่าน `isValidDate` · ค่าแปลก (`javascript:`, `"><script>`, `//evil.com`, `../../admin`, SQL) ไม่ทำให้เกิด redirect (ไม่มี Location) และไม่ถูกสะท้อนเป็น HTML — การปรากฏของ `//evil.com` ใน flight payload คือ router state ของ Next แบบ URL-encoded เท่านั้น

**3. Input** — body strict ทุกตัว · title 80 / note 500 นับเป็น code point (`😀`×500 ผ่าน, 501 → `TOO_LONG`) · title ปฏิเสธ bidi override, zero-width, ตัวควบคุม, ขึ้นบรรทัด (`INVALID`) ใช้ `checkVisibleName` ร่วมกับชื่อกลุ่ม/ผู้ใช้ · `<img onerror>` เก็บเป็นข้อความ (React escape) · ปี 2101 → `DATE_OUT_OF_RANGE`, 2100-12-31 ผ่านไม่ล้น · all-day 366 วันผ่าน / 367 → `LIMIT_REACHED busySpan` · timed 62 วันผ่าน / +30 นาที → ปฏิเสธ · 24:00, 10:15 → ปฏิเสธ · tz: `asia/bangkok`, `Z`, `+07:00`, `Asia/Bangkok␀`, `Asia/Bangkok␠`, ``, 64×`a` → `INVALID_TIMEZONE`; 65 ตัว → `TOO_LONG` · ช่วงปฏิทิน: 62 วันผ่าน, 63 / 2000–2100 → `RANGE_TOO_LARGE`; ช่องว่าง/NUL ใน from/to → `INVALID`; พารามิเตอร์ซ้ำ → ใช้ค่าสุดท้าย แล้วตรวจตามปกติ · epoch ms ไม่ล้น (ปี ≤ 2101)
- **เพดาน 300 แข่งกัน**: เตรียม 298 อนาคต + 6 รายการจบแล้ว → PATCH ฟื้นพร้อมกัน 6 ตัว → 200,200,409×4 → active = 300 พอดี · POST พร้อมกัน 8 ตัวที่ 300 → 409 ทั้งหมด (INSERT…SELECT…WHERE count<cap อะตอมมิกทำงานจริง) · (ช่องที่เหลือคือ M1 ซึ่งเป็นเรื่องแถวที่จบแล้ว ไม่ใช่การแข่ง)
- N+1: ไม่มี — ปฏิทินกลุ่มใช้ 3 คิวรี (group ctx, members, busy) ไม่ขึ้นกับจำนวนสมาชิก

**4. Front-end** — ไม่มี `dangerouslySetInnerHTML`/`innerHTML` ใน `src/components/{calendar,busy}` และ `(app)/calendar` · ชื่อสมาชิก/title ที่เพื่อนเห็นแสดงผ่าน `<Name>` = `<bdi>` และผ่าน `sanitizeDisplayText` ที่ serializer · `aria-label` ที่ใส่ข้อความผู้ใช้มีแค่ `MineList` (`busy.mine.openAria` ใช้ title ของ "ตัวเอง") และ `group-switch` (ชื่อกลุ่ม ผ่านกฎชื่อ) — React escape แล้ว · `localStorage` ใช้แค่ธงประกาศความเป็นส่วนตัว (`mm_busy_notice_seen:<userId>`) ครอบ try/catch ไม่มีข้อมูลเชิงความลับ · `history.replaceState`/`router.replace` ใช้ origin เดิมและ id จากรายการกลุ่มของเซิร์ฟเวอร์ ไม่มี open redirect

## ข้อเสนอเล็ก (ไม่ใช่ข้อพบ)
- เพิ่มเทสต์ canary ของ "SSR HTML ของ `/calendar`" ในชุด vitest/e2e (ปัจจุบัน e2e ตรวจ DOM+network; ยังไม่ตรวจ flight payload ใน HTML ดิบ)
- เพิ่มเทสต์ M1 (แถวจบแล้วนับในเพดาน) และ `.limit` ของคิวรีแชร์ เมื่อแก้
