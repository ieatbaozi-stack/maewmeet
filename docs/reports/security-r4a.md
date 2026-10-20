# Security review — R4A (วันว่างร่วม / common free time)

- ผู้ตรวจ: Security (อิสระ — ไม่ได้เขียนโค้ดนี้) · วันที่: 2026-10-20
- ขอบเขต: `git diff 68e2621..HEAD` บน branch `r4a` (HEAD `ab118db`) · เทียบ R4A_CONTRACT (R4A-4/5/6), ADR 0005, ADR 0006, ADR 0003, `security-r3.md`
- วิธี: อ่านโค้ดแบบ adversarial + PoC 2 แบบ (a) harness ของโปรเจกต์ (handler จริง + libSQL ไฟล์ + migration จริง + นาฬิกา inject) (b) `next build` + `next start` จริง (พอร์ต 3917, DB ไฟล์ชั่วคราว) ยิง HTTP ด้วย fetch · PoC อยู่นอก repo (scratchpad) ไม่แก้ `src/` ไม่แก้เทสต์ · หยุดเซิร์ฟเวอร์/ลบ DB ชั่วคราวแล้ว
- รันเทสต์เดิมซ้ำเอง: `vitest run tests/availability` → 2 ไฟล์ / 24 เทสต์ ผ่านหมด

## สรุปผล

| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 (M1) |
| Low | 3 (L1–L3) |
| Info / ยอมรับได้ | 5 (I1–I5) |

**ไม่พบช่องที่ `note` หรือ title ของรายการซ่อนรั่ว และไม่พบช่องที่ response รั่วมากกว่าปฏิทินกลุ่ม (`/calendar`) ในทุกช่องทางที่ลอง** (API ทุกบทบาทผู้ดู, SSR HTML ของ `/calendar?v=free`, audit, log, header, error body)
ข้อพบเดียวที่ต้องแก้ก่อน sign-off คือ **M1: response ของ `blockers` พองตามจำนวนวัน (แถวเดียวของสมาชิกที่ยาว 62 วัน ถูกส่งซ้ำ 62 ครั้ง)** — สมาชิกคนเดียวทำ response เป็น 4–9 MB ได้ด้วย busy 300 แถว (เทียบ `/calendar` ชุดเดียวกัน 74–145 KB)

## Verdict ต่อเกต

| เกต | ผล | หลักฐานย่อ |
|---|---|---|
| **R4A-4 การมองเห็น** | **PASS** | canary `CANARY-N` (note) / `CANARY-H` (title ซ่อน) ไม่โผล่ใน API (alice/bob/carol/super admin), หน้า SSR `?v=free` (HTML+RSC flight), log เซิร์ฟเวอร์ (0 ครั้ง), audit meta · คิวรี SELECT ของฝั่งแชร์ไม่ถูกแตะใน diff (`repos/busy.ts` ไม่อยู่ใน diff) · blockers ผ่าน `toBusyForViewers` ตัวเดียว (`serializers/busy.ts:62-71`) · `Cache-Control: private, no-store`, ไม่มี ETag, ไม่มี Set-Cookie |
| **R4A-5 RBAC** | **PASS** | ตารางด้านล่าง: 404 ไบต์เดียวกันทุกกรณี · anonymous 401 · `must_change_pin` 403 · suspended 401 · super admin non-member 200 + audit + ไม่ถูกนับ · กลุ่มถูกลบ 404 แม้ SA |
| **R4A-6 ขอบเขต/ประสิทธิภาพ** | **ยังไม่ผ่าน — เงื่อนไข: แก้ M1 แล้วให้ผมตรวจซ้ำ** | ส่วนที่ผ่าน: 62 วันพอดีผ่าน/63 → 400, from>to, รูปแบบวันที่ทุกแบบถูกปฏิเสธ, EXPLAIN ใช้ index, เวลา 107–150 ms ที่ 1 สมาชิก × 300 แถว · ส่วนที่ไม่ผ่าน: ขนาด response (M1) · กติกา R3-11 "Medium ขึ้นไปแก้และตรวจซ้ำ" |

สถานะรวม: R4A-4/5 ผ่านด้านความปลอดภัย · R4A-6 รอแก้ M1 (L1–L3 ไม่บล็อก)

---

## ข้อพบ

### M1 — Medium · `blockers` ส่ง busy แถวเดิมซ้ำทุกวันที่ทับ → response พองเป็น O(แถว × วัน) (DoS / ทำให้ฟีเจอร์ล่มทั้งกลุ่ม)

**ที่ไหน**
- `src/lib/data/services/availability.ts:122-131` — ต่อวัน ต่อสมาชิก สร้าง `toBlockerView(id, touching)` ที่ใส่ *ทั้งแถว* (id, userId, startAt, endAt, localStartDate, localEndDate, tz, title?) ทุกแถวที่ทับวันนั้น ไม่ clip ไม่ dedupe (comment ในไฟล์ตั้งใจ: "รายการเต็ม ไม่ clip")
- `src/lib/shared/limits.ts:23,25,27,33` — busy ต่อผู้ใช้ 300 แถว (หน้าต่างที่นับ), all-day ยาวได้ 366 วัน, timed ยาวได้ 62 วัน, ปฏิทิน 5000 แถว → แถวเดียวถูกซ้ำได้สูงสุด 62 ครั้งต่อ request
- ไม่มี rate limit บน GET (backlog R6) และ route ไม่ compress ในตัว (`content-encoding` ว่างเมื่อ `next start`)
- `src/app/(app)/calendar/_lib/load.ts` (`getGroupAvailability` ใน SSR) ฝัง payload เดียวกันซ้ำใน HTML+RSC flight

**Repro (วัดจริง)**
สมาชิก bob (คนเดียว) ลง `POST /api/me/busy` `{kind:'all_day', startDate:'2026-11-01', endDate:'2027-10-31'}` ซ้ำ 300 ครั้ง (ได้ 201 ครบ 300, ครั้งที่ 301 → 409) แล้ว alice ขอ availability:

| กรณี | items ใน blockers | ขนาด | เวลา service |
|---|---|---|---|
| bob 300 แถว all-day 366 วัน, ไม่มี title, 62 วัน | 18,600 | **4.39 MiB** (`/calendar` ช่วงเดียวกัน 74 KB → ×60) | 107 ms (HTTP จริง 149 ms) |
| ตัวเดียวกัน, title ไทย 80 ตัวอักษรไม่ซ่อน, 42 วัน (ตารางเดือนที่ UI ขอจริง) | 12,600 | **6.10 MB** (`/calendar` 145 KB) | — |
| ตัวเดียวกัน, 62 วัน | 18,600 | **9.00 MB** | — |
| หน้า SSR `/calendar?v=free` (build จริง, bob 300 แถวซ่อน) | — | HTML ถอด gzip **2.74 MiB** (มุมมองเดือนปกติ 0.14 MiB) | 453 ms |
| ในฐานข้อมูล 50 สมาชิก × 100 แถว = 5000 แถว (เพดาน) all-day 366 วัน | 310,000 | **75.0 MiB** | **≈3.0 s** CPU ต่อ request (เธรดเดียว block) · ยิง 8 ขนานจะค้าง |

ผลกระทบ
1. **สมาชิกคนเดียว (ไม่ต้องมีสิทธิ์พิเศษ) ทำให้ "ว่างตรงกัน" ของทั้งกลุ่มช้า/ล่ม** — response 6–9 MB ต่อการเปิด 1 เดือน, parse บนมือถือ, และเกินเพดาน body ของ Vercel Function (4.5 MB — ควรยืนยันกับแผน hosting จริง) → 500 ทุกคนในกลุ่ม (busy เป็นของส่วนตัวแต่ถูกอ่านผ่านกลุ่ม ผู้ถูกกลั่นแกล้งลบแถวของคนอื่นไม่ได้ ต้อง kick สมาชิก)
2. ผู้ไม่หวังดีที่มีบัญชีหลายตัวในกลุ่มเดียว (17 บัญชี × 300 แถว = 5000) ทำ 75 MiB / 3 s CPU ต่อ request → ทรัพยากรเซิร์ฟเวอร์ (หน่วยความจำ JSON string 75 MB + object 310k) ไม่มี throttle
3. ต่างจาก R3 M1 ที่เป็นการพองของ *จำนวนแถว* (แก้ด้วยเพดาน 300 + LIMIT 5000 แล้ว) — นี่คือการคูณด้วย *จำนวนวัน* ซึ่งเพดานเดิมไม่ครอบคลุม (R4A_CONTRACT R4A-6 วัดด้วยข้อมูลหนาแน่นที่ *สั้น* → 932 KiB จึงไม่เห็น)

**แก้ (เลือกอย่างใดอย่างหนึ่ง หรือรวม)**
- (แนะนำ) เปลี่ยนรูป response: ใส่ `busy: [...]` (แถวที่ผ่าน `toBusyForViewers` — เหมือน `/calendar`) *ครั้งเดียว* แล้วให้ `days[].blockers` เป็น `{ userId, itemIds: string[] }` — ขนาด O(แถว + วัน×สมาชิก) ลด ~60× และ UI (`components/availability/model.ts` `dayBlockers`) join ด้วย id ฝั่ง client (เป็น serializer เดียวเหมือนเดิม ไม่เพิ่มฟิลด์ใหม่)
- หรือจำกัดต่อ (สมาชิก, วัน) ไม่เกิน N (เช่น 5) รายการ + `more: number` — เร็วกว่าแต่ UI ต้องรับ "และอีก N"
- เพิ่มเทสต์: bob 300 แถว all-day 366 วัน, ช่วง 62 วัน → `Buffer.byteLength(JSON.stringify(res)) < 300 KiB` (และเทสต์ perf ปัจจุบันควรมีเคส "แถวยาว" นอกเหนือจากแถวสั้น)
- ควรมีเพดาน byte/จำนวน items ใน service เป็นตาข่ายสุดท้าย และ (R6) rate limit ต่อผู้ใช้บน GET ที่คำนวณหนัก

---

### L1 — Low · ไม่มี rate limit บน `GET /api/groups/:gid/availability` (และ SSR `/calendar?v=free`)
`route.ts` ทั้งไฟล์ — คำนวณหนักกว่า `/calendar` (lib + กรองต่อวัน) แต่ไม่มี throttle · อยู่ใน backlog R6 · ความเสี่ยงจริงต่ำเมื่อแก้ M1 (เวลาต่อ request ≈ 25–150 ms) · ถ้า M1 ยังไม่แก้ ให้ถือเป็นตัวคูณของ M1 · **แก้**: R6 rate limit ต่อ user+IP

### L2 — Low (ความถูกต้อง/ความเชื่อถือ ไม่ใช่ความลับ) · `truncated` ทำให้วันหลังๆ "ดูว่างเกินจริง"
`availability.ts:102` + `repos/busy.ts` — ดึง `ORDER BY start_at, id LIMIT 5001` แล้ว slice 5000 → แถวที่เริ่ม *ช้าสุด* ถูกทิ้ง ⇒ วันปลายช่วงอาจแสดง "ว่างร่วม" ทั้งที่มีคน busy · UI แสดง banner `free-truncated` ก็จริง แต่ **ตัวเลข `freeMembers/allFree/segments` ใน JSON ยังเป็นค่าที่ไม่ถูกต้อง** — R4B (ปุ่มสร้างนัด / เตือนนัดทับ ADR 0005 §4) ห้ามเชื่อผล availability เมื่อ `truncated=true` · เหลือจริงได้เฉพาะกลุ่มใหญ่มาก (50 × ~100 แถว/ช่วง; สมาชิกคนเดียวทำได้ไม่เกิน 300) · ขอบเขต margin 26 ชม. กิน cap เพิ่มเล็กน้อย (ไม่เป็นปัญหา) · **แก้**: เมื่อ truncated ให้ UI/lib ไม่ตัดสิน "ว่างร่วม" (แสดงเป็น "ไม่ทราบ") หรือบันทึกในสัญญา R4B ว่าห้ามใช้เป็นเกณฑ์ตัดสิน

### L3 — Low · พารามิเตอร์ query ซ้ำ (`from=a&from=b`) — คนสุดท้ายชนะแบบเงียบ
`route.ts` `queryObject` ใช้ `Object.fromEntries` (มีอยู่แล้วใน R3 ทุก route) · ไม่มีผลต่อความปลอดภัย (ผลผ่าน validation เดียวกัน, 200) · แค่ควรทราบเมื่อทำ cache/WAF ที่ขอบ

---

## Info / ยอมรับได้ (ไม่ต้องแก้ — บันทึกเป็น accepted)

- **I1 — การอนุมานจากผลลัพธ์ (inference) เป็นสิ่งที่มากับฟีเจอร์**: `segments`/`freeMembers`/`notFreeUserIds`/flag "ว่างแต่ไม่ถึงขั้นต่ำ" ทำให้เดา *ช่วงเวลา* ที่คนหนึ่งไม่ว่างได้ — แต่ ADR 0006 ให้เวลาของรายการซ่อนเปิดเผยอยู่แล้ว (ปฏิทินกลุ่มแสดงเวลาตรงๆ) จึงไม่เพิ่มข้อมูล · สิ่งที่ซ่อนจริง (title ซ่อน, note) ไม่มีทางอนุมานจาก availability · รายการซ่อน กับรายการไม่กรอก title หน้าตาเหมือนกัน (X28) ยืนยันแล้ว
- **I2 — busy เป็นรายผู้ใช้ข้ามกลุ่ม**: availability ของกลุ่ม G แสดง busy ทั้งหมดของสมาชิกของ G ไม่ว่ารายการนั้น "ตั้งใจ" ให้กลุ่มไหน (ADR 0006 ออกแบบไว้) · ทดสอบ: bob อยู่ G1+G2, dave (G2 เท่านั้น) มี busy ชื่อ canary → G1 response ไม่มี canary ของ dave/ไม่มี id กลุ่ม G2/ไม่มี userId ของ dave · ฟิลด์ `tz` ของเจ้าของที่มากับแถวเหมือน `/calendar` (R3 L2)
- **I3 — สมาชิกที่ถูกระงับ (suspended) ยังถูกนับ** ใน members/ว่างร่วม เหมือนปฏิทิน (R3 L5, ยืนยันเจตนาไว้แล้ว) · ยืนยันซ้ำ: carol suspended ยังอยู่ใน `members` ของ alice
- **I4 — tz ของกลุ่ม**: ไม่มีทางเขียน `groups.tz` ผ่าน API ใดเลย (ค่าเริ่มต้น Asia/Bangkok) ⇒ tz ไม่ถูก inject จากผู้ใช้; ถ้า DB ถูกแก้ให้เป็นค่าผิด `assertTimeZone` จะโยน CalendarError ⇒ 500 ทั่วไป (ไม่สะท้อนค่า) · ขอบ margin 26 ชม. ครอบ all-day ระหว่าง UTC+14 ↔ UTC−12 ตามเทสต์ Kiritimati ผ่าน; แถวที่ดึงเกินไม่ถูกส่งออกเว้นแต่ทับหน้าต่างวันในช่วงที่ขอ (กรองซ้ำที่ `availability.ts:126-129`)
- **I5 — super admin PATCH หน้าต่างของกลุ่มที่ไม่ใช่สมาชิกได้ (200)** เป็นพฤติกรรม R2 เดิม (`group.update` + SA ผ่าน, มี audit) ไม่ใช่การเปลี่ยนของ R4A; สมาชิกธรรมดา → 403, คนนอก → 404 ยืนยันแล้ว

---

## สิ่งที่ลองแล้วไม่พบช่องโหว่ (ยืนยันด้วยการรันจริง)

**1. PRIVACY**
- Canary ทุกบทบาท: alice(admin) / bob(เจ้าของ busy) / carol / super admin ที่ไม่ใช่สมาชิก → response เหมือนกันทุกบทบาท (7,119 ตัวอักษร), มีเฉพาะ title ที่ไม่ซ่อน, ไม่มี note, ไม่มี title ซ่อน, ไม่มีของกลุ่มอื่น
- Build จริง: `GET /calendar?v=free&g=<gid>` ของสมาชิก — HTML 92 KB ไม่มี canary note/title ซ่อน, `displayName`/ชื่อกลุ่มที่เป็น `<img onerror>` / `<script>` ถูก escape (ไม่พบ raw)
- คนนอกที่ใส่ `?g=<gid จริง>` กับ `?g=<uuid ไม่มี>`: HTML **ยาวเท่ากัน และเหมือนกันทุกตัวอักษรเมื่อ normalize uuid** (54,759 = 54,759 ในรอบแรก, 54,723 = 54,723 ในรอบสอง; uuid ที่ต่างมีเฉพาะที่สะท้อนใน URL ของ flight) ⇒ ไม่เป็น oracle · ข้อมูลกลุ่มไม่ถูก SSR ให้คนนอก (server เลือกกลุ่มจาก `listMyGroups` เท่านั้น: `load.ts` `groups.find(g => g.id === search.g) ?? first`)
- หน้า `/groups/:gid/settings` ของคนนอก (gid จริง vs ไม่มี) → HTML เหมือนกัน (ผ่านการ normalize uuid) = หน้า 404 เดียวกัน; สมาชิกเห็น UI ตามบทบาท, PATCH ฝั่ง API ตรวจจริง (member → 403)
- Header: `Cache-Control: private, no-store` ทั้ง 200 และ error; ไม่มี `ETag`/`Last-Modified`; `Vary` เป็นของ Next (rsc…); หน้า SSR `private, no-cache, no-store, max-age=0, must-revalidate`; `If-None-Match: *` → 200 เต็ม (ไม่มี 304)
- audit: SA ที่ไม่ใช่สมาชิก → 1 แถว `group.availability.view` meta `{from,to,asSuperAdmin:true}` เท่านั้น (ไม่มีข้อมูล busy/ชื่อ); สมาชิกธรรมดาไม่ audit; log เซิร์ฟเวอร์ไม่มีข้อความผู้ใช้ (`grep -c CANARY server.log` = 0; `logUnexpected` log เฉพาะชื่อชนิด error)
- SELECT list: `sharedBusyInGroupQuery` ไม่ถูกแก้ใน diff; ยังไม่ SELECT `note`, `title` ซ่อนถูก CASE ตัดใน SQL, `toBusyForViewers` ตัดซ้ำ; มุมมองแบบ strict zod ในเทสต์ R4A ปฏิเสธฟิลด์เกิน
- ไม่มี `dangerouslySetInnerHTML`/`innerHTML` ใน `src/components/availability` และ `CalendarView` (grep ว่าง); ชื่อในประโยคผ่าน `Name`/`withNames` (bdi + ตัวแทน PUA ซึ่ง `sanitizeDisplayText` ตัดทิ้ง) ไม่ผ่าน ICU เป็นคำสั่ง; `aria-label` ของช่องวันใช้เฉพาะวันที่/ตัวเลข ไม่ใช้ชื่อ/ชื่อรายการ

**2. AUTHZ — เมทริกซ์ที่ยิงจริง** (ทุกกรณี body `{"error":{"code":"NOT_FOUND"}}` เหมือนกันทุกไบต์ แม้ใส่ช่วงวันที่ผิด/เกิน 62 วัน)

| ผู้เรียก | กลุ่ม | ผล |
|---|---|---|
| คนนอก | gid จริง / uuid ไม่มี | 404 / 404 |
| ออกกลุ่มเอง (leave) / ถูก kick | gid จริง | 404 (ทันที ไม่ถูกนับในผลของคนอื่น) |
| อดีตสมาชิก, เจ้าของ, super admin | กลุ่มที่ถูกลบ | 404 ทั้งหมด (ไม่ audit) |
| super admin | uuid ไม่มี | 404 |
| super admin ไม่ใช่สมาชิก | gid จริง | 200, ไม่ถูกนับ, audit 1 แถว (read-only — ไม่มี route เขียน availability) |
| anonymous | — | 401 |
| `must_change_pin` | — | 403 |
| suspended | — | 401 |
| gid ไม่ใช่ uuid | — | 400 (รูปร่างเท่านั้น เหมือน `/calendar`; ไม่ขึ้นกับการมีอยู่ของกลุ่ม) |
| query แปลก `?foo=1` | — | 400 UNKNOWN_FIELD (ตรวจรูปร่างก่อน — ไม่ใช่ oracle เพราะเกิดกับทุกผู้เรียกเท่ากัน) |

authorize เป็นบรรทัดแรกของ service (`availability.ts:68-70`) · ช่วงวันที่ตรวจ *หลัง* ด่านสิทธิ์ · IDOR: `gid` คือ resource เดียวในคำขอ ไม่มี id รองให้สลับ

**3. INPUT**
- `from`/`to`: เลขอาหรับ-อินดิก, ปีพุทธ 2569, `+002026-…`, ISO-datetime, `2026-1-1`, `NaN`, `Infinity`, ว่าง, `2026-02-29`, ปี 1999/2101, ช่องว่างนำ/ตาม, NUL, `0000-00-00`, ติดลบ, ยาว >32 → ทั้งหมด 400 `VALIDATION` (`INVALID`/`TOO_LONG`) ไม่สะท้อนค่า · 2000-01-01…2100-12-31 → `RANGE_TOO_LARGE`; 2026-11-01…2027-01-01 (62 วัน) → 200; …01-02 (63 วัน) → 400; from>to → `BEFORE_FROM`
- ไม่มี N+1: คิวรี 4 ตัวต่อ request (ctx, group, members, busy) + audit เฉพาะ SA
- เวลา CPU ที่ 1 สมาชิก × 300 แถวยาว: 107 ms · ชุด perf ของทีม (3.2k แถวสั้น): ผ่าน < 200 ms ตามที่รายงาน

**4. FRONT-END**
- URL: `?g` ถูกจับคู่กับรายการกลุ่มของฉัน (ไม่ใช้ค่าดิบ), `?d` ผ่าน `isValidDate`, `?v` ผ่าน allowlist; `router.replace(\`/calendar?g=${id}…\`)` และ `callApi(\`/api/groups/${gid}/availability?from&to\`)` ใช้ค่าที่เซิร์ฟเวอร์ให้ (uuid) / `DateISO` เท่านั้น ⇒ ไม่มี open redirect/injection เข้า path API
- ลิงก์ `/groups/:gid/settings#window` แสดงเฉพาะ `canEditWindow` (คำนวณฝั่ง server) — ตัวหน้า settings ตรวจที่ server (`loadGroupSettings` → `getGroup` + `listInvites` → NOT_FOUND→404) และ PATCH ตรวจ `group.update` (member 403, คนนอก 404) ⇒ ซ่อนปุ่มเป็นแค่ความสะดวก

---

## ข้อเสนอเล็ก (ไม่ใช่ข้อพบ)
1. เมื่อแก้ M1 ให้คง "ผ่าน serializer เดียว" — ถ้าย้าย `busy[]` ขึ้นระดับบน ให้ใช้ `toBusyForViewers` ตัวเดิมและต่อยอดเทสต์ canary เดิม (ข้อ 1/5/7/8/9/10)
2. เพิ่มเคส perf/ขนาดแบบ "แถวยาวซ้ำ" ใน `tests/availability/availability-perf.test.ts`
3. R4B: เมื่อใช้ availability เป็นเกณฑ์เตือนนัดทับ ให้พิจารณา `truncated` (L2) และคำนวณจาก `membersBlockedDuring` บนช่วงนัดโดยตรง
