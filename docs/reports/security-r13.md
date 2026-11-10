# Security review — R13 (สถานที่แบบวางลิงก์ · ปุ่ม Google/Apple Maps · ป้ายลิงก์ในปฏิทิน · ลบการค้นหาสถานที่)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-11 · branch `feat/r13-location-simplify` HEAD `5d99338` · ดู `git diff origin/main...HEAD` (13 commit, 68 ไฟล์) · เทียบ R13_CONTRACT §1.1–§1.5, "main มอบเพิ่ม", R13-5, R13-6 + กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่านโค้ดจริง + รันเทสต์ของทีม + สคริปต์โจมตีนอก repo (scratchpad) เรียก `buildAppointmentIcs` / `googleCalendarUrl` / `mapSearchLink` / `mapOpenLink` / `parseMapUrl` ตัวจริง แล้วแยกไฟล์ด้วยตัวแยก content line ที่เขียนเอง (unfold → ตรวจรูป `NAME(;param)*:value` → allowlist property ใน VEVENT → นับ BEGIN/END → ≤ 75 octet ต่อบรรทัด) · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows (checkout CRLF) · เทสต์รันผ่าน shim นอก repo ที่กลืนเฉพาะ `EPERM` ของ `fs.rmSync` · สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 5 |

**Verdict: ผ่าน** — แทรกบรรทัด/property/component ผ่าน `URL:` ไม่ได้ รวมถึงแถวเก่าใน DB ที่ไม่ผ่าน `parseMapUrl` · คุกกี้ `mm_locale` เลือกได้แค่ `th`/`en` จาก allowlist และ messages import แบบ static · ปุ่ม Google/Apple เปลี่ยน host, scheme หรือ parameter ไม่ได้ · ลบ route ค้นหาแล้วไม่เหลือ route ที่ไม่ผ่าน authorize และ CSP แคบลง · RBAC/audit ของ `.ics` ไม่ถอยหลัง · ข้อ Info ไม่บล็อกการ merge · e2e และ CI ต้องดูผลจาก CI (ตรวจในเครื่องนี้ไม่ได้)

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **1. `.ics` `URL:` กัน CRLF / แทรก property / แทรก component** | **PASS** | 📖 `src/lib/calendar/ics.ts:156` `isSafeUriValue = /^[\x21-\x5b\x5d-\x7e]+$/` (ASCII ที่พิมพ์ได้ ไม่มี space, ตัวควบคุม, `\`, non-ASCII) และ `:150` ต้องขึ้นต้น `https://` · `:176` ไม่ผ่าน = ลิงก์นัด · ✅ ป้อน mapUrl 21 แบบตรงเข้า builder (เลี่ยง `parseMapUrl` = จำลองแถวเก่าใน DB): `\r\nATTENDEE:`, `\nEND:VEVENT\nBEGIN:VEVENT`, `\rBEGIN:VALARM`, space, tab, `\` + `nBEGIN:VALARM`, U+0085, U+2028, ไทย, NUL, DEL, ยาว 600 ตัว, `HTTPS://`, `http://`, `javascript:`, space นำหน้า, `%0D%0A` · ผล 0 ปัญหา: ทุกไฟล์มี VEVENT เดียว ไม่มี property นอก allowlist BEGIN/END ครบคู่ ไม่มี CR/LF เดี่ยว · ค่าที่ไม่ปลอดภัยทุกตัวได้ `URL:<ลิงก์นัด>` · ส่วนใน `DESCRIPTION` ผ่าน `escapeIcsText` (`:192`) จึงกลายเป็น `\n` ตามตัวอักษร · เทสต์ของทีม `tests/calendar/ics-route.test.ts:391` (แถว DB ที่มี CRLF) ผ่าน |
| **`;` `,` `:` `"` ใน URL** | **PASS (Info 2)** | 📖 `URL` ไม่มี parameter เลย ตัวแยกตัดชื่อที่ `:` ตัวแรก ทุกอย่างหลังจากนั้นเป็นค่า · RFC 5545 ไม่ escape ค่าชนิด URI · ✅ `https://x.example/a"b;VALUE=TEXT:c` ได้บรรทัด `URL:` บรรทัดเดียว ไม่มี parameter · ลิงก์ Google จริงที่มี `@13.7,100.5,17z?…;b,c:d` ได้ `URL` ตรงตามต้นฉบับ และ `DESCRIPTION` escape เป็น `\,` `\;` |
| **fold 75 octet** | **PASS** | 📖 `foldIcsLine` ไม่เปลี่ยนจาก R12.1 · ✅ ชื่อนัดไทย 200 ตัว + emoji 30 ตัว, สถานที่ `é`×100, URL ยาว 498 ตัว: ทุกบรรทัด ≤ 75 octet, unfold แล้วได้ค่าเดิม, ไม่ตัดกลาง code point |
| **2. คุกกี้ `mm_locale` ค่าแปลก** | **PASS** | 📖 `src/lib/data/calendar-labels.ts:7-8` import `en.json`/`th.json` แบบ static ไม่มี import ตามค่าในคุกกี้ (ไม่มีทาง path traversal) · `:15` รับเฉพาะค่าที่อยู่ใน `LOCALES` (`includes` เทียบแบบตรงตัว `__proto__`, `constructor`, `../`, `EN` ไม่ผ่าน) · `:24` เลือกได้แค่ `en` หรือ `th` แม้ `user.locale` ใน DB เป็นค่าอื่น · ป้ายเป็นข้อความจาก repo ผ่าน `escapeIcsText` / `encodeURIComponent` อีกชั้น · ✅ `tests/calendar/ics.test.ts:336-356` (`fr`, `EN`, ค่าว่าง, หลายคุกกี้) และ `ics-route.test.ts:344` ผ่าน · ✅ ป้ายโจมตี `a\r\nATTENDEE:x`, `END:VEVENT\nBEGIN:VALARM` ป้อนตรงเข้า builder ไม่แทรกบรรทัด |
| **3. ปุ่ม Google/Apple Maps** | **PASS** | 📖 `src/components/places/map-model.ts:56-61` host/scheme เป็นค่าคงที่ ชื่อผ่าน `encodeURIComponent` ทั้งก้อน · `MapAppLinks.tsx:106-111` `target="_blank" rel="noopener noreferrer"` · ✅ ชื่อ `ร้าน A&B #1`, `x/../../evil`, `//evil.example`, `a?api=2&query=b`, `javascript:alert(1)`, `@evil.example`, `%2F%2Fevil`, NUL/CRLF/tab: ทุกกรณี protocol `https:`, host `www.google.com` / `maps.apple.com`, path คงที่, key มีแค่ `api,query` / `q`, ไม่มี hash, decode กลับได้ชื่อเดิม |
| **ส่งชื่อเฉพาะตอนกด / ไม่ prefetch** | **PASS** | 📖 ปุ่มเป็น `<a href>` ธรรมดา ไม่มี `fetch`, `<link rel=prefetch/preconnect/dns-prefetch>`, รูปภาพภายนอก หรือ `useEffect` ที่ยิงออกนอกใน `PlaceField.tsx` / `MapAppLinks.tsx` · ชนิดเครื่องอ่าน `navigator.userAgent` ที่ client ผ่าน `useSyncExternalStore` ไม่ส่งไปเซิร์ฟเวอร์ (`MapAppLinks.tsx:80`) · `next/link` ไม่ได้ใช้ (ไม่มี prefetch อัตโนมัติ) · CSP `connect-src 'self'` บล็อกการยิงออกนอกอยู่แล้ว |
| **`/privacy` ตรงพฤติกรรมจริง** | **PASS** | 📖 `privacy.places.links` TH/EN: ไม่ค้นหา ไม่โหลดภาพแผนที่ ชื่อส่งเมื่อกดเองเท่านั้น ไม่มีชื่อ = ไม่ส่งชื่อ ตรงกับ `mapSearchLink` (ชื่อว่าง = หน้าแรก) · `privacy.calendar.body` บอกว่าลิงก์แผนที่อยู่ในช่อง URL/Location และ Details พร้อมป้าย ตรงกับ `ics.ts:162-176` · `privacy.updated` = 11 พ.ย. 2569 / 11 Nov 2026 · `src/app/privacy/page.tsx:20` เหลือ `links`, `noTracking` |
| **4. ลบ `/api/places/search` และส่วนที่เกี่ยว** | **PASS** | ✅ ไม่มีโฟลเดอร์ `src/app/api/places` · grep `places/search|nominatim|tile.openstreetmap|PLACE_SEARCH|MAP_TILE|MAP_ATTRIBUTION|place.search|place-fetch|PlaceMap` ใน `src messages next.config.ts .env.example .github` เหลือแค่คอมเมนต์ และ `placeSearchCache` ใน `schema.ts` + cron ลบแถวเก่าใน `repos/maintenance.ts:67-69` (contract อนุญาต) · 📖 `manifest.ts` ลบแถวเดียว, `actions.ts` / `can.ts` ลบ `place.search` ครบทั้ง `ACTIONS`, `ACTION_RESOURCE`, `RULES` · ✅ `tests/security/authorize-first.test.ts` และ `tests/rbac/**` ผ่าน |
| **CSP ไม่หลวมขึ้น** | **PASS** | 📖 `next.config.ts:43` `img-src 'self' data: blob:` (เอา `https://tile.openstreetmap.org` ออก) · directive อื่นไม่เปลี่ยน · `Referrer-Policy` คงเดิม · ✅ `tests/ops/headers.test.ts` ผ่าน |
| **env / ความลับ / log** (กฎ 7) | **PASS** | 📖 `env.ts` ลบ 5 ตัว และ `baseEnvSchema = envObject` เป็น `z.object` แบบตัด key ที่ไม่รู้จัก ค่าเก่าที่ยังค้างใน Vercel ไม่ทำให้ boot ล้ม · `.env.example`, `ci-env.sh`, `check-env-example.sh` ลบตรงกัน · ✅ grep บรรทัดที่เพิ่มใน diff ไม่พบ token/secret/key/`console.*` · ✅ `tests/platform/env.test.ts` ผ่าน |
| **5. ลิงก์ในการ์ดสถานที่** | **PASS** | 📖 `map-model.ts:37` https เท่านั้น ไม่งั้น `geo:` จากพิกัดที่ตรวจ `Number.isFinite` และช่วง (`:40`) · label ของ `geo:` ผ่าน `encodeURIComponent` หลังตัด `()` และตัวควบคุม (`:30`) · `AppointmentDetail.tsx:221-225` เลือก `OpenInMaps` / `MapAppLinks` / ไม่แสดง · ✅ `javascript:`, `JAVASCRIPT:`, `data:`, `http:`, space/newline นำหน้า ได้ `null` · ชื่อ `a)(b\n` ได้ `geo:13.7,100.5?q=13.7,100.5(a%20b)` · NaN ได้ `null` |
| **RBAC `appointment.view` / `auditRead` ของ `.ics`** | **PASS** | 📖 `appointments.ts:563-571` ลำดับเดิม `appointmentFor` → `authorize('appointment.view')` → `auditRead` → ตรวจสถานะ · ส่วนที่เพิ่ม (`:573-574`) อยู่หลัง authorize และอ่านแค่ `user.locale` ของผู้ขอเอง (`me.id`) · ด่าน cross-site ใน route ไม่เปลี่ยน · ✅ `tests/calendar/ics-route.test.ts` ผ่านทั้งไฟล์ |
| **การตรวจข้อมูลเข้า** | **PASS** | 📖 ฟอร์มส่งค่าไปเซิร์ฟเวอร์ ซึ่งยังตรวจ `mapUrl` ด้วย `parseMapUrl` (`appointments.ts:189-190`) และพิกัดด้วย `coordField` · `parseMapUrl` ไม่รับ IP, localhost, `.local`/`.internal`, credentials, ตัวควบคุม, `\`, ยาว > 500 |
| **migration** (กฎ 8) | **PASS** | ✅ ไม่มีไฟล์ migration ใน diff · `schema.ts` เปลี่ยนแค่คอมเมนต์ |

## Findings

### Info
1. **ช่อง `URL` ของ `.ics` เป็นลิงก์ที่สมาชิกพิมพ์แล้ว** (เปลี่ยนจาก R12 Info 6 ที่ `URL` มาจากระบบ) · `parseMapUrl` รับทุกโดเมนสาธารณะที่เป็น https ไม่ใช่แค่ Google/Apple/OSM สมาชิกในกลุ่มจึงใส่ลิงก์ที่ไม่ใช่แผนที่ได้ และ iPhone อาจแสดงเป็นปุ่ม Open ที่เด่นกว่าเดิม · contract §1.4 อนุมัติแล้ว และลิงก์เดียวกันกดได้อยู่แล้วในหน้ารายละเอียดและใน `DESCRIPTION` (R12.1) · เป็นความเสี่ยงหลอกให้กดลิงก์ระดับเดิม ไม่ใช่ช่องใหม่ · ถ้าอยากลด: ใช้ mapUrl ใน `URL` เฉพาะโฮสต์แผนที่ที่รู้จัก ไม่งั้นใช้ลิงก์นัด
2. **`isSafeUriValue` รับ `"` `'` `<` `>` `;` `,` `:`** (`ics.ts:156`) · ถูกต้องตาม RFC 5545 สำหรับค่าชนิด URI และ ✅ ไม่ทำให้เกิด parameter หรือบรรทัดใหม่ · ค่าที่ผ่าน `parseMapUrl` แปลง `"` `<` `>` space เป็น `%xx` อยู่แล้ว มีแค่แถวเก่าที่ไม่ normalize ที่มีอักขระพวกนี้ได้ · `HTTPS://` ตัวใหญ่จากแถวเก่าผ่านได้ (scheme ไม่สนตัวพิมพ์ตาม RFC 3986)
3. **`escapeIcsText` ไม่ตัด U+2028 / U+2029** (`ics.ts:119` ตัดแค่ `\p{Cc}\p{Cs}`) · ไม่ใช่การแทรกบรรทัดเพราะ RFC 5545 ขึ้นบรรทัดด้วย CRLF เท่านั้น และทางเซิร์ฟเวอร์ `sanitizeDisplayText` ตัด `\p{Zl}\p{Zp}` จากชื่อนัด/สถานที่ก่อนแล้ว (`name-rules.ts:11`) · ส่วน mapUrl ไม่ผ่าน `isSafeUriValue` ใน `URL` · เป็นของเดิมตั้งแต่ R12.1 · ถ้าจะเสริม ให้เพิ่ม `\p{Zl}\p{Zp}` ในชุดที่ตัด
4. **ตาราง `place_search_cache` ยังอยู่** (B3) · ไม่มีโค้ดอ่าน/เขียน cron ลบแถวที่เก่ากว่า 30 วัน · ควรมี migration ลบตารางในรอบหลังตามที่ `schema.ts:287-288` จดไว้
5. **env เก่าใน Vercel** (`PLACE_SEARCH_ENABLED`, `NOMINATIM_*`, `NEXT_PUBLIC_MAP_*`) · ไม่ใช่ความลับ (`NOMINATIM_CONTACT` เป็นอีเมลติดต่อ) และ schema ไม่สนค่าที่ไม่รู้จัก · ลบใน Vercel หลัง merge ได้ตามที่ ops แจ้ง

## คำสั่งที่รัน + ผลจริง (`5d99338`)
| คำสั่ง | ผล |
|---|---|
| `NODE_OPTIONS="--import file:///<scratchpad>/ignore-eperm.mjs" npx vitest run tests/calendar tests/security tests/rbac tests/ops/headers.test.ts tests/platform/env.test.ts tests/ui/appointments-map.test.ts tests/ui/add-to-calendar.test.ts tests/ui/appointments-model.test.ts tests/appointments/appointments.test.ts` | `Test Files 2 failed \| 30 passed (32)` · `Tests 3 failed \| 3204 passed \| 1 skipped (3208)` · 3 ข้อที่ล้มเป็นปัญหาเครื่องที่รู้อยู่แล้ว ไม่เกี่ยวกับ R13: `config-hygiene.test.ts` ข้อ permissions ของ `ci.yml` และ `keepalive.yml` (checkout CRLF) และ `free-time.test.ts` ข้อ `oracle.py` (`Python was not found` เครื่องนี้ไม่มี `python3`) · shim ไม่ได้พิมพ์ว่ากลืน EPERM |
| `node node_modules/tsx/dist/cli.mjs <scratchpad>/ics-attack.ts` | mapUrl 21 แบบ + ข้อความ/ป้าย 4 แบบ + fold ยาว: `TOTAL FAIL 0` (รอบแรกรายงาน 2 ข้อ เพราะตัวแยกของผู้ตรวจใช้ `.` ที่ไม่จับ U+2028 แก้เป็น flag `s` แล้วผ่าน ไม่ใช่ปัญหาของโค้ด) · ลิงก์ Google: host `calendar.google.com` key `action,text,dates,ctz,location,details` ไม่มี hash แม้ชื่อ/ป้ายมี `&details=`, `#` · `mapSearchLink` 8 ชื่อ × 2 แอป host/scheme/key คงที่ · `mapOpenLink` scheme อันตราย 6 แบบได้ `null` |
| grep หาของค้างจากการค้นหา/tile/env (ดูเกตข้อ 4) | เหลือแค่คอมเมนต์ และ `placeSearchCache` ใน schema/cron |
| `git diff origin/main...HEAD \| grep '^+' \| grep -iE "secret\|token\|password\|api[_-]?key\|BEGIN (RSA\|PRIVATE)\|sk_\|ghp_\|console\.(log\|info\|warn)"` | เจอแค่คำว่า token ในเอกสาร (สีของดีไซน์) และ secretary ในตาราง contract |
| `git diff --name-only origin/main...HEAD \| grep -i migrat` | ไม่มี |

## สิ่งที่ตรวจไม่ได้
- **e2e (Playwright)** `tests/e2e/r13-location.spec.ts`, `headers.spec.ts`, `privacy.spec.ts` ไม่ได้รันในเครื่องนี้ ดูผลจาก CI
- **iPhone / Apple Calendar จริง** (T3): ไม่รู้ว่า Apple แสดง `URL` ที่เป็นโดเมนแปลกอย่างไร (เกี่ยวกับ Info 1) · ไม่ได้ลองนำไฟล์เข้า Apple/Google/Outlook จริง ใช้ตัวแยกที่เขียนเองแทน (repo ไม่มีตัวแยก iCal อิสระใน `node_modules`)
- **ข้อมูลจริงใน DB production**: ไม่ได้ดูว่ามีแถว `map_url` แบบไม่ normalize จริงไหม (ทดสอบด้วยค่าจำลองแทน)
- **Vercel preview**: ไม่ได้ดู header CSP บน preview จริง
