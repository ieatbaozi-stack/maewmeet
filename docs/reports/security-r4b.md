# Security review — R4B (นัด / RSVP / สถานที่ / แจ้งเตือน / หน้าหลัก)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-10-26 · `git diff 93c86e2..HEAD` (โค้ด = `b7e93d0`; HEAD `ac68871` เพิ่มเฉพาะ qa-r4b.md) · เทียบ R4B_CONTRACT §3/§5/§6, ADR 0001/0003/0006/0007, security-r3/r4a, qa-r4b
- วิธี: อ่านโค้ด + PoC กับ `next build` + `next start` จริงบนสำเนา repo (พอร์ต 3947, DB ไฟล์แยก, Nominatim ปลอมที่ 127.0.0.1:9317 ไม่ยิงเครือข่ายจริง) ผู้ใช้ 9 บทบาท (anonymous/suspended/must_change_pin/outsider/member/moderator/admin/ออกกลุ่มแล้ว/super admin) · ไม่แก้ `src/` · PoC อยู่ใน scratchpad `sec/repo/poc{1-4}.mjs`, `redos.mjs` · ปิดเซิร์ฟเวอร์แล้ว

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 (M1) |
| Low | 5 (L1–L5) |
| Info | 7 |

ไม่พบ IDOR, ไม่พบ busy detail รั่ว (note / title ซ่อน / busy คนนอกกลุ่ม), ไม่พบ XSS/open-redirect/SSRF จากผู้ใช้, CSP ไม่ถูกแตะ. ข้อพบเดียวที่ควรแก้ก่อน merge คือ **M1: ไม่มี rate limit เขียน + สร้าง/ยกเลิกวนไม่จำกัด → notification flood ×49 และเผางบ row-writes ของ Turso**

## Verdict ต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **R4B-2 สิทธิ์ (D4)** | **PASS** | เมทริกซ์ HTTP จริง (ด้านล่าง) · 404 ไบต์เดียวกัน (ไม่มี vs ของกลุ่มอื่น, ทั้ง `/appointments/:id` และ `/groups/:gid/appointments`) · member แก้/ยกเลิกของคนอื่น = 403 (ยอมรับได้: สมาชิกเห็นนัดอยู่แล้ว) · mass assignment 9 คีย์ = 400 UNKNOWN_FIELD · สลับ id ข้ามกลุ่ม = 404 · ออกกลุ่มแล้ว RSVP/GET = 404 · SA RSVP = 403, SA แก้/ยกเลิก/ดูมี audit `asSuperAdmin` |
| **R4B-4 เตือนนัดทับ/ความเป็นส่วนตัว busy** | **PASS** | canary: `/check` และ create ไม่มี `CANARY-N` (note), ไม่มี title ที่ซ่อน, ไม่มี busy ของ dave (อยู่กลุ่มอื่น); title ที่ไม่ซ่อน (`CANARY-VIS-T`) ออกตาม ADR 0006 · ใช้ `toBusyForViewers` ตัวเดียว · path `unknown` QA ทดสอบแล้ว · SSR/RSC ของคนนอกกลุ่มไม่มี title/G1 id |
| **R4B-6 สถานที่ + proxy** | **PASS (มี L1–L3)** | SSRF: base URL มาจาก env เท่านั้น · `redirect:'error'` พิสูจน์แล้ว (302 → 503 upstream) · body 400 KB → 503 ใน 22 ms · ช้า 9 s → ตัดที่ 4.0 s · ผลปลอม (`osmUrl:'javascript:'`, `url`, osm_type `../../x`, osm_id `1; DROP`) ถูกทิ้ง: client ได้ osmUrl ที่เซิร์ฟเวอร์สร้างเอง `https://www.openstreetmap.org/...` เท่านั้น · cache คีย์ `th:wat arun` (ภาษา+normalize) · cache hit ไม่เรียกต้นทาง (mock นับ 1) · ไม่ log q/contact (server.log grep = 0) · `Cache-Control: private, no-store` · anonymous 401 |
| **R4B-7 แจ้งเตือน** | **PASS (มี M1 เรื่อง flood)** | สร้างนัด → 4 แถว/5 สมาชิก ยกเว้นผู้สร้าง · ผู้ออกกลุ่มเห็น 0 แถว unread 0 ไม่รั่วชื่อนัด (เดิม 11) · dave ส่ง ids ของ erin + id สุ่ม → `updated:0` ไม่ยืนยันการมีอยู่ · cursor ปลอม (ไม่ใช่ base64, `{}`, SQL string, เลขใหญ่, UUID ผิด) = 400 หรือ 200 ว่าง ไม่ error 500 · limit 0/51 = 400 · `href` สร้างจาก id ที่ผ่าน `^[A-Za-z0-9_-]{1,64}$` · params ไม่มีความลับ (allowlist + regex คีย์) · cron ลบ >90 วัน + place cache 30 วัน มีใน `maintenance.ts:55-58` |
| **R4B-10 i18n/CSP/escape** | **PASS** | CSP ตัวเดียวกับ R3/R4A (img-src เพิ่มเฉพาะ `https://tile.openstreetmap.org` มาแต่ ADR 0001, `next.config.ts` ไม่อยู่ใน diff) · ไม่มี `dangerouslySetInnerHTML`/`innerHTML` ทั้ง `src/` · ชื่อ/สถานที่/คำอธิบายเรนเดอร์เป็น text (`<bdi>`), `<script>` ในคำอธิบายถูกเก็บเป็นข้อความดิบแล้ว React escape · `aria-label` ใช้ค่า text ผ่าน ICU (ไม่ใช่ HTML) · tile URL สร้างจากจำนวนเต็มเท่านั้น |

### เมทริกซ์ HTTP ที่รันจริง
| endpoint | anon | suspended | must_change_pin | outsider | ออกกลุ่ม | member | moderator | admin | SA(ไม่เป็นสมาชิก) |
|---|---|---|---|---|---|---|---|---|---|
| GET นัด | 401 | 401 | 403 | 404 | 404 | 200 | 200 | 200 | 200 (+audit) |
| PATCH นัดของคนอื่น | 401 | 401 | 403 | 404 | 404 | 403 | 200 | 200 | 200 (+audit) |
| cancel นัดของคนอื่น | 401 | 401 | 403 | 404 | 404 | 403 | 200 | 200 | 200 |
| PUT rsvp | 401 | 401 | 403 | 404 | 404 | 200 | 200 | 200 | 403 |
| list กลุ่ม / check | 401 | 401 | 403 | 404 | 404 | 200 | 200 | 200 | 200 |
| me/appointments, me/notifications | 401 | 401 | 403 | 200 (ว่าง/ของตัวเอง) | 200 (ไม่เห็นของกลุ่มเก่า) | 200 | 200 | 200 | 200 |

CSRF: ทุก route เขียน (PUT rsvp, PATCH, POST create/check/cancel/read) ถูกปฏิเสธ 403 เมื่อ no-Origin / Origin อื่น / `null` / `text/plain` / `x-www-form-urlencoded`. Header: `Cache-Control: private, no-store`, ไม่มี ETag; หน้า SSR `private, no-cache, no-store, max-age=0, must-revalidate`; เนื้อหานัดโหลดฝั่ง client (ไม่อยู่ใน HTML/RSC ของคนอื่น).

## Findings

### M1 — Medium · ไม่มี rate limit เขียน: สร้าง/ยกเลิกวนไม่จำกัด → notification flood 49 แถวต่อครั้ง + เผางบ row-writes
**ที่**: `src/lib/data/services/appointments.ts:createAppointment` (+ `repos/appointment.ts:insertAppointmentIfUnderCap` เพดาน 100 นับเฉพาะ active) · `notify.ts` · route wrapper ไม่มี limiter ของการเขียน
**Repro (วัดจริง)**: สมาชิกคนเดียววน `POST create` + `POST cancel` 40 รอบใน 724 ms (เฉลี่ย create 11 ms, **≈55 ครั้ง/วินาที**) ได้ notification เพิ่ม 120 แถว (3 ผู้รับ) ไม่มี 429 เพราะยกเลิกคืนโควตา 100. กลุ่ม 50 คน → 49 แถว × 55/วินาที ≈ **2,700 row-writes/วินาที** (+ audit 2 แถว/รอบ) — Turso Free 10 ล้านแถว/เดือน (ADR 0001 §3) หมดในราว 1 ชม.; ผู้ไม่หวังดีตั้งกลุ่มเอง ชวนบัญชีปลอมเป็นสมาชิกแล้วยิงได้ หรือกลั่นแกล้งเพื่อนในกลุ่ม (กระดิ่งท่วม, อ่านทีละ ≤100 id) · ไม่มีเพดานจำนวน notification ต่อผู้ใช้ (ล้างที่ 90 วัน)
**ประเมิน**: Medium (ต้องมีบัญชี แต่สมัครฟรี; กระทบ availability/งบทั้งระบบ ไม่กระทบความลับ). ตรงกับที่สัญญาไว้ "R6 backlog" แต่เพราะเป็นตัวคูณ ×49 ควรทำก่อน deploy จริง
**แก้**: (1) limiter ต่อผู้ใช้สำหรับ create/update/cancel ผ่าน `reserveBucket` (เช่น 20 ครั้ง/ชม. + 5/นาที สำหรับ create, นับ cancel ด้วย) (2) นับ "สร้างในช่วง 24 ชม." ต่อกลุ่มเป็นเพดานแยกจาก active (กันวน create/cancel) (3) รวมแจ้งเตือนของกลุ่มเดียวกันที่ยังไม่อ่าน (coalesce) หรือจำกัด unread ต่อผู้ใช้ (เช่น 500) (4) ใส่ในเทสต์

### L1 — Low · ช่องห่าง 1 req/s ทั้งระบบถูกบัญชีหลายตัวยึดได้ (DoS ของค้นหาสถานที่)
**ที่**: `services/places.ts` ลำดับ rate-limit ต่อผู้ใช้ → `reserveCallSlot` · **Repro**: ผู้ใช้หนึ่งยิง query ไม่ซ้ำ 12 ครั้ง: ได้ 200 หนึ่งครั้ง ที่เหลือ 429 (ถูกต้องตามออกแบบ); ผู้ใช้อื่น (carol) ที่ยิงพร้อมกันได้ 429 ในครั้งที่ชนช่อง แล้ว 200 เมื่อไม่ชน. ผู้โจมตี 1 บัญชีใช้ได้ ≤10 ช่อง/นาที (1/6 ของความจุ) → เหยื่อโดนสุ่มชน ≈17%; 6+ บัญชี (signup 5/ชม./IP → 2 IP) ยึดต่อเนื่องได้. ผู้ใช้ที่ถูก 429 ยังเสียโควตาต่อนาทีของตัวเอง
**ประเมิน**: Low — เป็นความสะดวกเท่านั้น วางลิงก์/พิกัดยังใช้ได้ (R4B_CONTRACT §6), ไม่มีเงิน/ข้อมูลเสี่ยง
**แก้**: ไม่ให้ 429 นับโควตาผู้ใช้เมื่อถูกช่องกลางปฏิเสธ (refund) · คิวรอสั้น ๆ (≤1.5 วินาที) แทนปฏิเสธทันที · โควตาต่อ IP ร่วมด้วย

### L2 — Low · Nominatim ตอบ 200 แต่รูปร่างผิด/ว่าง ถูกแคช 30 วัน (cache "ไม่พบ" ถาวร)
**ที่**: `services/places.ts:216-219` · **Repro**: mock ตอบ `{"error":"x"}` → `{"results":[]}` และแถว `place_search_cache` `th:obj1` = `[]`; ค้นซ้ำไม่เรียกต้นทางอีก (ยืนยันข้อ L4 ของ QA ด้วยการรัน). ผล: ความผิดพลาดชั่วคราวของต้นทาง (หรือ ban ที่ตอบ JSON) กลายเป็น "ไม่พบสถานที่" 30 วัน — เป็นปัญหาความถูกต้อง/ความพร้อมใช้ ไม่ใช่การโจมตี (ผู้ใช้เปิด cache poisoning ไม่ได้: key มาจาก q ของตัวเองและค่าผ่าน sanitize) 
**แก้**: ไม่แคชเมื่อ JSON ไม่ใช่อาร์เรย์; TTL สั้น (เช่น 1 ชม.) สำหรับผลว่าง

### L3 — Low · ชื่อผลค้นหาที่มี `<img onerror>` ผ่านไปถึงลูกค้าเป็นข้อความดิบ (ปลอดภัยเพราะ React escape แต่ไม่มีชั้นที่สอง)
**ที่**: `sanitizePlaceResults` ตัดเฉพาะตัวควบคุม/bidi (ตั้งใจ — ชื่อสถานที่มี `<`, `&` ได้จริง). **Repro**: ต้นทางตอบ display_name `<img src=x onerror=alert(1)> Café` → client ได้สตริงนี้ (ตัว `‮` ถูกลบ). `PlaceField.tsx` เรนเดอร์เป็น text/`aria-label` ผ่าน ICU → ไม่ execute. ความเสี่ยงอยู่ที่ผู้พัฒนาอนาคตเปลี่ยนเป็น HTML เท่านั้น; ต้นทางคือ OSM (คนทั่วไปแก้ชื่อได้) จึง "ผู้ใช้ OSM → ผู้ใช้เรา" เป็นเส้นทางจริง
**แก้**: คง CSP เดิม (ห้าม inline handler? — `script-src 'unsafe-inline'` ที่มีอยู่เดิมไม่ช่วย; ควรย้ายไป nonce ตามที่ ADR 0001 เสนอไว้ใน R6) + เทสต์ lint ห้าม `dangerouslySetInnerHTML`

### L4 — Low · `mapUrl` รับ https ทุกโฮสต์ (IP ส่วนตัว, `https://./`, โฮสต์ลวง) — ฟิชชิ่งผ่านลิงก์ในนัด
**Repro**: เก็บสำเร็จ `https://127.0.0.1/`, `https://[::1]/`, `https://./`, `https://xn--l-7sbq6ba.com/` (homograph "аррlе" ถูกแปลงเป็น punycode — UI แสดง host ที่เป็น punycode จึงเห็นว่าแปลก = ดี). ปฏิเสธครบ: `javascript:` (ทุกตัวพิมพ์), `data:`, `vbscript:`, `file:`, `http:`, `//host`, userinfo, backslash, tab/space กลางสตริง, bidi/zero-width, >500, port เกิน, `geo:`. เซิร์ฟเวอร์ไม่ fetch ลิงก์นี้ (ไม่มี SSRF); ลิงก์เปิดด้วย `target=_blank rel="noopener noreferrer"` (`PlaceMap.tsx:146-148`, `HomeView.tsx:312-314`)
**แก้ (ไม่บังคับ)**: ปฏิเสธโฮสต์ที่เป็น IP literal/ไม่มีจุด/localhost; แสดงโฮสต์ข้างลิงก์เสมอ (ทำแล้วบางส่วน); บล็อกนัดทั้งโดเมนผ่าน allowlist ถ้าต้องการเข้มกว่า

### L5 — Low · RSVP/แจ้งเตือนเก่าฟื้นเมื่อกลับเข้ากลุ่ม (ตรงกับ M1/L2 ของ QA)
ผลต่อความเป็นส่วนตัว: ชื่อนัดเก่าของกลุ่มกลับมาให้ผู้ที่เคยออกเมื่อกลับเข้า (เป็นสมาชิกจึงเห็นนัดอยู่แล้ว) — ไม่รั่วข้ามขอบเขต; ผู้ที่ถูกนำออกไม่เห็นระหว่างอยู่นอกกลุ่ม (พิสูจน์แล้ว). แก้ตามที่ QA เสนอ (ลบ RSVP ตอนออก/ถูกนำออก)

### Info (ไม่ต้องแก้ / ยอมรับได้)
1. **ReDoS ตัวแยกพิกัด**: ช่องว่าง 1,990 ตัว = 5.4 ms (กำลังสอง, ถูกตัดที่ 2,000 ตัวก่อน regex); อินพุตอื่น (`,,`×990, `!3d`×600, `@1,`×990, `geo:;aaa`, `%25`×900) < 0.3 ms; 10k ตัวถูก `TOO_LONG` ก่อน regex ทำงาน. ฝั่งเซิร์ฟเวอร์ใช้เฉพาะ `parseMapUrl` (ไม่มี regex เสี่ยง)
2. **Contact**: `NOMINATIM_CONTACT` ไปที่ User-Agent และ `email=` ของคำขอขาออกเท่านั้น (นโยบาย Nominatim) · ไม่อยู่ใน response/SSR/log (ตรวจ grep ใน HTML ทุกบทบาท + server.log) · ถ้าตั้ง `NOMINATIM_BASE_URL` เป็นโฮสต์อื่น contact จะไปที่นั่น (เฉพาะผู้ดูแล env). `z.url()` ยอม `http:`/`file:` ใน env — แนะนำจำกัด https ในโปรไฟล์ deployed
3. **Audit meta ปลอดภัย**: `{appointmentId, fields:[ชื่อคีย์], asSuperAdmin}` · `appointment.check` / `view` ของ SA ลง audit; ไม่มี title/note/q ใน meta
4. **ลำดับ route wrapper**: CSRF → zod → actor: คำขอผิดรูปจากคนไม่ล็อกอินได้ 400 ก่อน 401 (ไม่รั่วข้อมูล; พฤติกรรมเดิมตั้งแต่ R0). `/api/places/search` ตรงข้าม: anonymous 401 ก่อน (ตั้งใจ)
5. **เพดาน 100 แข่งกัน**: เติม 90 แล้วยิง 25 ขนาน → 201×10 / 409×15, active ใน DB = 100 พอดี (SQL เดียวมีเงื่อนไข) · body 70 KB / description 5,000 → 400 · `check` ≈ 7.6 ms
6. **ทรัพยากรแคชค้นหา**: ผู้ใช้ 60 ครั้ง/ชม. × query ไม่ซ้ำสร้างแถวแคชเท่าจำนวน (cron ลบที่ 30 วัน) — เล็กน้อย, อยู่ใน M1 ถ้าจะทำ limiter รวม
7. **ไม่มี `Set-Cookie` ใหม่หรือ cache ข้ามผู้ใช้**: header ครบ `no-store` ทั้ง API และหน้า; RSC (`rsc:1`) ของ dave/anonymous ได้ redirect/ไม่มีเนื้อหานัดของกลุ่มอื่น

## สรุปที่ต้องทำ
- ก่อน merge: **M1** (limiter เขียนต่อผู้ใช้ + กัน create/cancel วน) — หรือ Lead ลงบันทึกรับความเสี่ยงชัดเจนพร้อมกำหนด R6 ก่อน deploy
- ควรทำ: L2 (ไม่แคชผลผิดรูปร่าง), L1 (refund โควตาเมื่อถูกช่องกลาง)
- ที่เหลือ: จดไว้

เกต: R4B-2 PASS · R4B-4 PASS · R4B-6 PASS · R4B-7 PASS (M1 ติดตามต่างหาก) · R4B-10 PASS · กติกา R3-11 "Medium ขึ้นไปแก้และตรวจซ้ำ" → รอแก้ M1 แล้วให้ผมตรวจซ้ำ
