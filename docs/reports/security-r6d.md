# Security review — R6D (จำกลุ่ม `mm_group` · กด "ไป" = ไม่ว่างทุกกลุ่ม)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-02 · `git diff main...HEAD` (branch `feat/r6d-remember-group-going-busy`, HEAD `e1ef6aa`) · เทียบ R6D_CONTRACT §1/§2/§4/§6, ADR 0009 (รายการ "สิ่งที่ Security ต้องตรวจ" 8 ข้อ), ADR 0006, กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่าน repo/service/serializer/route/rbac/คุกกี้ทั้งหมดใน diff + รันเทสต์ของทีมเอง + PoC แบบ integration ของผู้ตรวจเอง (handler จริง + libSQL ไฟล์จริง + migration จริง ผ่าน `tests/appointments/util`) ด้วย canary ที่สุ่มเอง · ไฟล์ช่วยอยู่นอก repo ใน scratchpad (ไม่ commit): `sec-r6d/tests/poc.test.ts` (9 เคส), `sec-r6d/tests/afb.test.ts` (สำเนา authorize-first ที่ normalize path), `sec-r6d/vitest.config.mts`, `eperm-preload.cjs` · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows (checkout CRLF) · TEMP/TMP ชี้ scratchpad + preload ข้าม EPERM ของ `fs.rmSync`
- สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ดเท่านั้น

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 (L1–L2) |
| Info | 5 |

**Verdict: ผ่านแบบมีข้อสังเกต** — ไม่พบการรั่วข้ามกลุ่ม: สมาชิกกลุ่มแอ่วได้แค่ `{kind, userId, startAt, endAt}` ของนัดกลุ่มอื่น (รวมช่วงแล้ว) ทุกเส้นทาง, ชื่อ/id นัดถูกตัดตั้งแต่ SQL, `appointmentId` ใน `check` ไม่เป็น oracle, `myConflicts` เป็นของ session user เท่านั้น, คุกกี้ `mm_group` ตั้งได้เฉพาะสมาชิกจริง มี CSRF/rate limit/ธงครบ และถูกลบตอน logout/logout-all/ลบบัญชี · ข้อพบเป็นระดับต่ำ (ความแม่นของ assertion ใน e2e และจุดเรียก PUT ที่ไม่ตรง ADR)

## Verdict ต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **canary ข้ามกลุ่ม (R6D-4, ADR ข้อ 1)** | **PASS** | ✅ PoC: กลุ่มลั้ลลา ชื่อ `ZZG-<rand>` · นัด `ZZT-<rand>` + `placeName`/`description`/`mapUrl` canary · นัดที่สอง `ZZT2` (ทับ) · กลุ่มที่สาม `ZZG3` + นัด `ZZT3` (ชนขอบ) · busy ซ่อนของ A (`title`+`note` canary) · A ตอบ going ทั้งหมด → raw body ของ C และ D: `GET …/calendar`, `…/availability`, `POST …/appointments/check` (มี/ไม่มี `appointmentId`), `GET …/appointments` (รายการ), `GET /api/appointments/<นัดแอ่ว>`, `GET /api/me/appointments` (+`?rsvp=going`), `GET /api/groups`, create + PATCH นัดในแอ่วที่ทับช่วง → **ไม่พบ** canary 10 ตัว, id นัด 3 ตัว, id กลุ่มลั้ลลา/กลุ่มที่สาม · พบ `other_group_appointment` ของ A **1 ชิ้น** 12:00–17:00 (3 นัดจาก 2 กลุ่มรวมเป็นช่วงเดียว — ไม่บอกจำนวน) key = `endAt,kind,startAt,userId` เท่านั้น |
| **ตัดตั้งแต่ SQL (ADR ข้อ 3)** | **PASS** | ✅ `.toSQL()` ของ `goingBusyInGroupQuery` (`src/lib/data/repos/busy.ts:157-184`): SELECT มีแค่ `user_id, start_at, end_at, (group_id = ?)`, `CASE WHEN group_id = ? THEN id ELSE NULL END`, `CASE WHEN group_id = ? THEN title ELSE NULL END` — ไม่มี `group_id` ดิบ/`place_name`/`description`/`map_url`/`lat`/`lng`/`tz` · 📖 serializer `toGoingForViewers` (`serializers/busy.ts:420-425`) สร้างอ็อบเจกต์ใหม่ ไม่อ่าน id/title ถ้าไม่ใช่กลุ่มเดียวกัน (ตัดสองชั้น) · `myCommitmentsSql` (`repos/appointment.ts:50-69`) ฝั่ง busy ไม่ SELECT `note` และผูก `user_id = me` ทั้งสองฝั่ง |
| **กติกานับ (ADR ข้อ 2 / งานข้อ 5)** | **PASS** | ✅ PoC: A ออกจากกลุ่มที่สาม → ช่วงหดเหลือ 12:00–16:00 · กลับเข้าใหม่ → rsvp เก่าไม่ฟื้น (ผลเท่าเดิมทุกไบต์) · ยกเลิกนัด `ZZT2` → เหลือ 12:00–15:00 · ลบกลุ่มลั้ลลา (soft delete) → ไม่มีรายการ going ของ A และ `myConflicts` ของ A ไม่มีนัดลั้ลลาแล้ว · 📖 เงื่อนไข join `am` + `r.updated_at >= am.joined_at` + `groups.deleted_at IS NULL` + `status='active'` ครบทั้งใน going query และ `myCommitmentsSql` · ✅ เทสต์ทีม `r6d-going-busy.test.ts` ครอบ maybe/not_going/ยังไม่ตอบ |
| **`check` + `appointmentId?` (งานข้อ 2, ADR ข้อ 6)** | **PASS** | ✅ C ส่ง `appointmentId = <นัดลั้ลลา>` กับ id สุ่ม → body เท่ากันทุกไบต์ และเท่ากับไม่ส่ง · `GET /api/appointments/<นัดลั้ลลา>` vs id สุ่ม → body เท่ากัน (404) · `check` บนกลุ่มลั้ลลาโดย C → 404 · ค่า `x' OR 1=1--` → 400 `VALIDATION` (zod uuid) · 📖 exclusion ผูก `NOT (a.id = ? AND a.group_id = :gid)` (`repos/busy.ts:160`) · timing: เงื่อนไขเดียวกันถูกประเมินทุกแถว ไม่มี branch ตามการมีอยู่ของนัด — ไม่ได้วัดเวลาจริง (ดู Info 1) |
| **`truncated`** | **PASS (Info 1)** | 📖 `truncated = busy.truncated \|\| going.truncated` (`services/member-busy.ts:726`) · เพดาน going = `CALENDAR_MAX_ITEMS` = 5000 แถวดิบก่อนรวม → รู้ได้แค่ว่า "สมาชิกทั้งกลุ่มมี going ≥ 5000 แถวในช่วงนั้น" ซึ่งเป็นไปได้ยากในทางปฏิบัติ |
| **`myConflicts` (งานข้อ 3, ADR ข้อ 5)** | **PASS** | ✅ PoC: A ตอบ going นัดแอ่วที่ทับ → `myConflicts` ของ A มีนัดลั้ลลา (title/groupName ของ A เอง) + busy ซ่อนของ A พร้อม title · **ไม่มี** `note`, place, description · C เปิดนัดเดียวกัน → `myConflicts: []` และไม่มี canary · D ตอบ going → ไม่มี canary · SA ที่ไม่ใช่สมาชิกเปิดนัด (200) → `myConflicts: []` · 📖 `myConflictsFor` (`services/appointments.ts:362-367`) ใช้ `me.id` จาก actor เท่านั้น, `group.actorRole === null` → ว่าง · `myConflict` บนการ์ดรายการ (`listConflictFlags` `:302-320`) กรอง `r.userId === viewerId` |
| **คุกกี้ `mm_group` (งานข้อ 6, ADR ข้อ 7)** | **PASS** | ✅ สมาชิก → 200 `{"data":{"ok":true}}` (ไม่สะท้อน gid) + `mm_group=<gid>; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly` + `Cache-Control: private, no-store` · ไม่ใช่สมาชิก (กลุ่มมีจริง) / กลุ่มลบแล้ว / id ไม่มีจริง → 404 body เดียวกันทุกไบต์ ไม่มี Set-Cookie · SA นอกกลุ่ม → 403 ไม่มี Set-Cookie · `gid:"abc"`, คีย์เกิน, `groupId`, `"<uuid>; Path=/; Domain=evil"`, `{}` → 400 ไม่มี Set-Cookie ไม่สะท้อนค่า · CSRF: Origin ว่าง/ต่างโดเมน → 403 · Request ดิบไม่มี Origin → 403 · `text/plain` → 403 ไม่มี Set-Cookie · ไม่มี session → 401 · rate limit: ครั้งที่ 121 → 429 `Retry-After: 480` ไม่มี Set-Cookie · logout / ลบบัญชี → `mm_group=; Max-Age=0; … HttpOnly` (✅ เทสต์ทีมครอบ logout-all) · อ่าน: `chooseCalendarGroup` (`src/lib/shared/current-group-cookie.ts:839-849`) กับคุกกี้มั่ว 10 แบบ (`''`, `../../etc`, `<script>`, id กลุ่มที่ไม่ใช่ของฉัน, uuid ตัวใหญ่, มีช่องว่าง/อัญประกาศ, 5000 ตัวอักษร) → ได้กลุ่มของฉันเสมอ `groupMissing=false` ไม่ throw · open redirect: 📖 ไม่มี — `RememberGroup` ไม่นำทาง, dropdown นำทางด้วย id จากรายการของเซิร์ฟเวอร์ |
| **RBAC / manifest / authorize-first (งานข้อ 7)** | **PASS** | 📖 `member.setCurrentGroup` (`src/lib/rbac/can.ts:761-763`) = `inGroup` + `role !== null` → SA นอกกลุ่ม 403, NM/กลุ่มลบ 404 · ✅ `tests/rbac` แถว `r(FB, OK, OK, OK, OK, NF, AUTH)` ผ่าน · manifest `PUT /api/me/current-group` `auth:'actor'` (`manifest.ts:95`) · ✅ สำเนา authorize-first (แก้แค่ตัวแยก path) **135/135** ผ่าน รวม `current-group.ts#rememberCurrentGroup` (authorize ก่อน `takeUserSlot`) และ route ใหม่/ที่แก้ (`me/current-group`, `auth/logout`, `auth/logout-all`, `me/delete`) · ✅ `tests/auth/must-change-pin.test.ts` ครอบ route ใหม่ |
| **ความลับ / log (งานข้อ 8)** | **PASS** | ✅ grep diff `src/`: ไม่มี `console.*`, `process.env`, `logUnexpected` ใหม่ · `.env.example`/`drizzle/`/`package.json` ไม่เปลี่ยน · ไม่มี migration · 📖 ค่าคุกกี้ถูกอ่านใน `load.ts` แล้วใช้เทียบเท่านั้น ไม่ log ไม่คืนกลับ |
| **XSS / headers** | **PASS** | 📖 ไม่มี `dangerouslySetInnerHTML`/`innerHTML` ใหม่ · ลิงก์นัดใช้ `encodeURIComponent(appointmentId)` (`components/calendar/model.ts:299-300`) · ✅ `Cache-Control: private, no-store` บน calendar/rsvp/current-group |

## Findings

### L1 — Low · e2e `appt-story.spec.ts` ผ่อน assertion กว้างเกิน — ถูกต้องตามดีไซน์ แต่เสียความคุ้มครองบางส่วน (งานข้อ 4) 📖
- **ที่มา**: `tests/e2e/appt-story.spec.ts:130-131` เดิมห้าม response ของ B มีทั้ง `CN` (note) และ `CT` (title ของ busy ซ่อนของ B) · ตอนนี้ห้ามเฉพาะ `CN`
- **ตัดสิน**: การผ่อน **ถูกต้อง ไม่ได้ซ่อนการรั่วข้ามผู้ใช้** — ADR 0009 §3 กำหนดให้ `myConflicts` คืน title ของ busy ที่ซ่อนแก่เจ้าของเอง (✅ PoC ยืนยันว่าคนอื่นไม่ได้) และการตรวจข้ามผู้ใช้ยังอยู่ครบที่ `:92-95` (DOM + response ของ A ห้ามทั้ง `CN`/`CT`)
- **ช่องโหว่ของเทสต์**: ตอนนี้ถ้า `CT` หลุดไปให้ B ทางอื่น (เช่น ปฏิทินกลุ่มที่ ADR 0006 ห้ามมีมุมมองเจ้าของ หรือ `overlap.items` ตอนตรวจนัดทับ) เทสต์นี้จะไม่จับ
- **เสนอ assertion ที่แม่นกว่า** (test): ลบเฉพาะรูปแบบที่อนุญาตก่อน แล้วค่อยห้าม `CT` — ใช้ได้ทั้ง JSON และ RSC payload เพราะ `toMyConflictDto` เรียงคีย์ตายตัว:
  ```ts
  const allowed = new RegExp(`"kind":"busy","busyId":"[0-9a-f-]{36}","title":"${CT}"`, 'g');
  expect(seenB.texts.filter((t) => t.replace(allowed, '').includes(CT)).length, `CT ของ B ต้องอยู่แค่ใน myConflicts`).toBe(0);
  ```
- ไม่บล็อกการ merge

### L2 — Low · `/groups/[gid]` เรียก `PUT /api/me/current-group` ทุกครั้งที่เปิดหน้า ไม่ตรง ADR 0009 §5 ข้อ (1) "ถ้าคุกกี้ ≠ gid" 📖
- **ที่มา**: `src/app/(app)/groups/[gid]/page.tsx:50` เรนเดอร์ `<RememberGroup>` ทุกครั้งที่ `myRole !== null` (ไม่เทียบกับคุกกี้) → ทุกการเปิดหน้ากลุ่ม = 1 request + 1 query `loadGroupCtx` + เขียน bucket rate limit
- **ผลกระทบ**: ไม่ใช่ช่องโหว่ (ยังตรวจสมาชิกที่เซิร์ฟเวอร์) · ผู้ใช้ที่สลับหน้ากลุ่มบ่อยเกิน 120 ครั้ง/10 นาที (รวมกับ dropdown) จะได้ 429 แบบเงียบ = ไม่จำกลุ่ม · เพิ่มโหลด DB เล็กน้อย (F2 ความเร็วยังค้าง)
- **ทำซ้ำ**: เปิด `/groups/<gid>` ซ้ำ → แต่ละครั้งเห็น `PUT /api/me/current-group` ใน network แม้คุกกี้เท่ากับ gid แล้ว
- **แนวทาง** (platform/frontend): อ่าน `mm_group` ใน page (เหมือน `load.ts`) แล้วเรนเดอร์เมื่อค่าต่างจาก gid เท่านั้น · ไม่บล็อกการ merge

## Info
1. **timing/ขนาด response ของ `check`** — ไม่ได้วัดเวลาด้วยเครื่องมือสถิติ · ขนาด/ไบต์เท่ากันระหว่าง id นัดกลุ่มอื่นกับ id สุ่ม (✅) และ SQL ไม่มี branch ตามการมีอยู่ของนัด (📖) → ระดับที่ยอมรับได้ · `truncated` รู้ได้แค่เมื่อ going ≥ 5000 แถว
2. **ช่วงเวลานัดกลุ่มอื่นยังเปิดเผยตามดีไซน์** — สมาชิกกลุ่มแอ่วเห็นเวลาเริ่ม/จบที่แม่นยำของช่วงที่ A ติดนัด และช่วงที่แยกกันบอกว่ามี ≥ 2 ภาระ · เป็นการตัดสินของ boss (contract §2) และลดด้วยการรวมช่วงแล้ว (ADR Consequences)
3. **คุกกี้ไม่ถูกล้างเมื่อ session หมดอายุ/ผู้ใช้อื่นล็อกอินเครื่องเดียวกันโดยไม่ logout** — ค่าเป็นแค่ group id ใน HttpOnly และถูกใช้เฉพาะเมื่อผู้ใช้ใหม่เป็นสมาชิกกลุ่มนั้น (✅ `chooseCalendarGroup`) → ไม่รั่ว
4. **ADR 0009 §5 เขียน body `{ groupId }` แต่โค้ดใช้ `{ gid }`** (`src/lib/data/services/current-group.ts:662`) — เอกสารไม่ตรง (architect อัปเดต ADR) · ✅ `{groupId}` ถูกปฏิเสธ 400
5. **`myConflict` บนการ์ดรายการใช้เพดาน 500 คำมั่น** (`APPOINTMENT_LIST_CONFLICT_SCAN_MAX`) โดยไม่มีธง truncated → เกินเพดานอาจไม่ขึ้นป้าย (ผลแค่ UI ไม่ใช่ความปลอดภัย)

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npx vitest run tests/appointments tests/groups tests/auth tests/rbac tests/security tests/busy tests/availability` (TEMP/TMP→scratchpad + preload EPERM) | Test Files 4 failed / 49 passed (53) · Tests 6 failed / 3146 passed / 12 skipped (3164) · ล้มทั้งหมด **ไม่เกี่ยวกับงานนี้**: `config-hygiene` ×2 (ci.yml/keepalive.yml — CRLF), `authorize-first` ส่วน B ×2 (path `\` บน Windows — ไฟล์ไม่ถูกแก้ใน branch), `security-r1` ×1 และ `session-race` ×1 = **timeout 5000ms** ตอนรันพร้อมกัน |
| `npx vitest run tests/auth/security-r1.test.ts tests/auth/session-race.test.ts` (รันแยก) | 2 files passed · 16 tests passed → timeout ข้างบนเป็นเรื่องโหลดเครื่อง |
| `npx vitest run tests/appointments/r6d-going-busy.test.ts tests/appointments/r6d-query-count.test.ts tests/groups/current-group.test.ts tests/platform/r6d-units.test.ts tests/ui/r6d-model.test.ts` | 5 files passed · 86 tests passed |
| PoC `sec-r6d/tests/poc.test.ts` (canary ข้าม 3 กลุ่ม, oracle check/detail, SQL shape, ออก/กลับเข้า/ยกเลิก/ลบกลุ่ม, คุกกี้ครบชุด, rate limit, คุกกี้มั่ว, logout/ลบบัญชี) | 9/9 passed (ผลตามตารางเกต) |
| สำเนา authorize-first (แก้แค่ตัวแยก path) | 135/135 passed |
| `npm run typecheck` | exit 0 ไม่มี error |
| `git diff main...HEAD -- src \| grep console./process.env/logUnexpected/innerHTML` | ไม่พบ |

## สิ่งที่ไม่ได้ตรวจ
- ไม่ได้รัน e2e Playwright (`tests/e2e/r6d-going-busy.spec.ts`, `appt-story.spec.ts`) และ `next build` บนเครื่องนี้ — ดูผลจาก CI
- ไม่ได้วัด timing side channel เชิงสถิติ (ดู Info 1)
- เส้นทาง Server Component `/calendar` อ่านคุกกี้ — ตรวจผ่าน `chooseCalendarGroup` (pure) + อ่านโค้ด `load.ts` ไม่ได้เรนเดอร์หน้าเต็ม
- `tests/security/config-hygiene` ข้อ permissions ตรวจไม่ได้บน checkout CRLF — ดู CI
