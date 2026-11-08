# Security review — R8 (F1 onboarding: `hasUpcomingBusy` ต่อสมาชิก · แถบขั้นตอน · การ์ดแนะนำ localStorage)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-08 · branch `feat/r8-onboarding` HEAD `4e7a29b` · ช่วง `main...HEAD` · เทียบ R8_CONTRACT §2.2, §2.3, R8-3/R8-4/R8-5/R8-7 + ADR 0003, 0006, 0009 + กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่าน diff ของ `e3f0961` (platform), `d3c34db` (frontend), `4e7a29b` (test) ทุกบรรทัด + ไล่โค้ดรอบข้าง (`loadGroupCtx`, `can.ts`, `calendar.ts`, `busy.ts`) + รันเทสต์ของทีมเอง · ไม่ได้เขียน PoC แยก (เทสต์ `r8-has-upcoming-busy` ของทีมครอบกรณีที่ต้องการ และตรวจซ้ำด้วยการอ่านโค้ด) · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows (checkout CRLF) · qa ทำงานพร้อมกันใน checkout เดียวกัน
- สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ดเท่านั้น

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 3 |

**Verdict: ผ่าน** — ออกจากเซิร์ฟเวอร์แค่ boolean ต่อสมาชิก · คำนวณหลัง `authorize('group.view')` เท่านั้น · ไม่รั่วข้ามกลุ่ม · ข้อมูลที่ได้เป็นส่วนย่อยของสิ่งที่ผู้มีสิทธิ์เดียวกันเห็นในปฏิทินกลุ่มอยู่แล้ว · SQL เป็นพารามิเตอร์ · ไม่มี migration/ความลับ/log ใหม่ · localStorage เก็บแค่ `"1"`

## Verdict ต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **1. boolean อย่างเดียว (ADR 0006)** | **PASS** | 📖 subquery ใน `listMembersWithUpcomingBusy` (`src/lib/data/repos/group-member.ts:94`) เป็น `EXISTS (SELECT 1 …)` → คืน 0/1 เท่านั้น ไม่ได้ SELECT title/note/เวลา · repo map เป็น `Number(r.busy) === 1` (`:100`) · serializer ใส่ `m.hasUpcomingBusy === true` (`src/lib/data/serializers/groups.ts:85`) — กันค่าแปลกเป็น false · ✅ เทสต์: คีย์สมาชิก = `colorIndex, displayName, hasUpcomingBusy, joinedAt, role, shapeIndex, userId` · `typeof === 'boolean'` ทุกแถว · JSON ดิบไม่มี canary title/note และไม่มี `startAt/endAt/localStartDate/"busy"` |
| **2. สิทธิ์ที่เซิร์ฟเวอร์ (กฎ 6, ADR 0003)** | **PASS** | 📖 `getGroup` (`src/lib/data/services/groups.ts:122-130`): `loadGroupCtx` → `authorize('group.view')` (throw ก่อน) → ค่อยเรียก query ธง · `group.view` และ `group.calendar.view` ใช้กฎเดียวกัน `anyMember()` (`src/lib/rbac/can.ts:196-197`) = สมาชิก หรือ super admin (+ `auditRead`) → ผู้เห็นธง = ผู้เห็นปฏิทินกลุ่มพอดี · ✅ เทสต์: คนนอก → 404 และ body ไม่มี `hasUpcomingBusy` · super admin นอกกลุ่ม → 200 ค่าถูก (ตรงกฎเดิม ADR 0006 แถว SA) · 📖 สมาชิกที่ถูกลบ/ออก: `findGroupWithAccess` ไม่มีแถว → role null → 404 (เทสต์เดิม `tests/groups/members.test.ts` "ผู้ถูกลบเห็นข้อมูลกลุ่มไม่ได้ทันที (404)") · ผู้ถูกลบไม่ปรากฏในรายชื่อเพราะ query กรอง `group_member.group_id = :gid` |
| **3. ไม่รั่วข้ามกลุ่ม** | **PASS** | 📖 แถวมาจาก `group_member WHERE group_id = :gid` เท่านั้น · EXISTS ผูก `bb.user_id = group_member.user_id` (คอลัมน์ ไม่ใช่ค่าจากผู้ใช้) · ✅ เทสต์: `outsider` (อยู่ H มี busy) ไม่อยู่ในรายชื่อ G · จำนวนสมาชิก G = 9 · `multi` (อยู่ G+H) ได้ true ทั้งสองกลุ่ม — busy เป็นระดับผู้ใช้ตามการออกแบบเดิม (ปฏิทินกลุ่มก็แสดง busy เดียวกันทุกกลุ่ม) |
| **4. delta เทียบปฏิทินกลุ่ม** | **PASS (Info 1)** | 📖 ปฏิทิน (`calendar.ts:96-104` → `sharedBusyInGroupQuery` `busy.ts:236-256`) ให้สมาชิก/SA ขอช่วงใดก็ได้ ≤ `CALENDAR_MAX_RANGE_DAYS` = 62 วัน (ไม่จำกัดว่าต้องเป็นอนาคต) ด้วยเงื่อนไขทับแบบเดียวกัน `start_at < to AND end_at > from` และ **ไม่กรอง `hide_detail`** (รายการซ่อนยังเห็นช่วงเวลา แค่ไม่มี title) · ธงใช้ `[now, now+30 วันปฏิทินใน tz กลุ่ม)` ⊂ ช่วงที่ขอปฏิทินได้ → ธง = ฟังก์ชันของข้อมูลที่เห็นได้อยู่แล้ว ไม่เปิดเผยอะไรใหม่ · การแยก busy_block กับนัดที่ "ไป" ก็เห็นในปฏิทินอยู่แล้ว (`kind` busy / appointment / other_group_appointment) · ดู Info 1 เรื่องความสะดวกในการสังเกต |
| **5. SQL / input** | **PASS** | 📖 `range.from`/`range.to` เป็น number จาก `ctx.now` + `addDaysAt` (ไม่มาจากผู้ใช้) และผ่าน drizzle `sql` template → bind param · `rank` CASE เป็นค่าคงที่ · `groupId` ผ่าน `groupParamsSchema` เดิม · ไม่มี `sql.raw` ใน diff · `addDaysAt` (`src/lib/calendar/zone.ts:105-110`) ตรวจ finite/integer/tz และใช้ Temporal (กฎ 9) · ✅ `tests/calendar/add-days-at.test.ts` 7/7 (DST, ปีอธิกสุรทิน, ค่าผิด → CalendarError) |
| **6. endpoint อื่นที่คืน DTO** | **PASS** | ✅ grep `toGroupDetail` / `getGroup(` ใน `src`: ใช้ที่ `GET /api/groups/[gid]`, `PATCH` (ผ่าน `updateGroupSettings` → `return getGroup(...)` `groups.ts:161` ซึ่ง authorize ซ้ำ), และ loader หน้า `groups/_lib/load.ts:45,51` (ผ่าน `getGroup` เดียวกัน) · `listMembers` เดิมไม่ถูกแก้ — calendar/availability/appointments ไม่ได้ field ใหม่ · หน้า admin (`admin-groups.ts`) ไม่เปลี่ยน |
| **7. Server-Timing / R7 / query count (R8-4)** | **PASS** | ✅ `tests/perf/r7-baseline.test.ts` ผ่าน · `PAGE /groups/[gid] q= 11` (ไม่เพิ่ม — EXISTS อยู่ใน query สมาชิกเดิม) · 📖 diff ไม่แตะ `src/app/api/_lib/route.ts`/`request-metrics`/`env` · timing: EXISTS ต่อแถวใช้ `busy_user_end_idx` ต้นทุนเท่ากันไม่ว่าผล — และค่าก็ส่งออกไปตรงๆ อยู่แล้ว จึงไม่มี side channel เพิ่ม |
| **8. localStorage (R8-5)** | **PASS** | 📖 `src/components/home/intro-flag.ts`: key `mm_intro_seen` ค่า `"1"` เท่านั้น · try/catch ทุกจุด (อ่านไม่ได้ = แสดงการ์ด) · ไม่ผูก user id/ชื่อ/กลุ่ม · ไม่มีข้อมูลจาก API · `resetIntro` แค่ `removeItem` · เทสต์ e2e fixture (`tests/e2e/support/auth.ts`) ตั้ง key เดียวกันผ่าน `addInitScript` ไม่มีความลับ |
| **9. UI ไม่ใช่ด่านสิทธิ์** | **PASS** | 📖 `MemberList.tsx:73` ป้ายแสดงจากค่าที่เซิร์ฟเวอร์ส่งมาแล้วเท่านั้น · `StepBar` ซ่อนเมื่อ `myRole === null` (SA นอกกลุ่ม) เป็นเรื่อง UX ไม่ใช่การกันข้อมูล — ข้อมูลกันที่ `getGroup` แล้ว |
| **10. ความลับ / log / migration (กฎ 7–8, R8-7)** | **PASS** | ✅ `git diff main...HEAD --stat -- drizzle src/db` = ว่าง · ✅ grep บรรทัดที่เพิ่มใน `src` หา `console.`/logger/pin/token/secret/password → ไม่พบ (เจอแค่คอมเมนต์/โค้ด localStorage) · ไม่มี dependency ใหม่ |

## Findings

### Info 1 — ธงทำให้ "ใครยังไม่ลง busy ใน 30 วัน" เห็นได้ทันทีโดยไม่ต้องไล่ปฏิทิน
- ที่: `src/lib/data/services/groups.ts:128` + `src/components/groups/MemberList.tsx:73`
- ข้อมูลไม่ใหม่ (ดูเกต 4) แต่สรุปให้เห็นในรายชื่อสมาชิก — เป็นการตัดสินใจของ contract §2.2 ที่ boss อนุมัติแล้ว · ข้อความป้ายเป็นคำชวน (ux) · ไม่ต้องแก้ แจ้งไว้ให้ทราบสำหรับหน้าความเป็นส่วนตัว (`/privacy`) ว่าอาจระบุว่า "สมาชิกในกลุ่มเห็นว่าคุณลงวันไม่ว่างแล้วหรือยัง" ถ้า boss ต้องการความโปร่งใสครบ

### Info 2 — super admin นอกกลุ่มเห็นธง (ตามกฎเดิม) และถูก audit
- 📖 `auditRead(... 'group.view' ...)` (`groups.ts:129`) บันทึกการอ่านของ SA เหมือนเดิม · สอดคล้อง ADR 0006 แถว SA (เห็นเวลา busy อยู่แล้ว) · ไม่ต้องแก้

### Info 3 — `addDaysAt` throw ถ้า tz ของกลุ่มในฐานไม่ถูกต้อง
- 📖 `assertTimeZone(tz)` (`zone.ts:108`) ทำให้ `getGroup` ล้มเป็น 500 แทนที่จะคืนรายละเอียดกลุ่ม หาก `group.tz` เสีย · tz ถูกตรวจตอนเขียนอยู่แล้ว และปฏิทิน (`startOfDay(..., row.tz)`) ก็ล้มแบบเดียวกัน จึงไม่ใช่ช่องโหว่ — ไม่มีข้อมูลรั่วใน error (handler กลางตอบรหัสทั่วไป) · ไม่ต้องแก้

## คำสั่งที่รัน + ผลจริง
1. `npx vitest run tests/platform/r8-has-upcoming-busy.test.ts tests/perf/r7-baseline.test.ts tests/calendar/add-days-at.test.ts tests/ui/steps-model.test.ts --reporter=verbose`
   - `Tests  23 passed (23)` · `Test Files  2 failed | 2 passed (4)` — 2 ไฟล์ที่ "failed" คือ `r8-has-upcoming-busy` และ `r7-baseline` ล้มที่ `afterAll` → `tests/helpers/db.ts:29 rmSync` `Error: EPERM, Permission denied: 'C:\Users\User\AppData\Local\Temp\maewmeet-test-…'` (ลบ DB ชั่วคราวบน Windows — ปัญหาเดิม) ไม่ใช่ assertion
   - r8-has-upcoming-busy: ✓ 7/7 (หน้าต่าง 30 วัน · กรณีขอบอนาคต/ทับ now/ก่อนขอบ 1 นาที/อดีต/จบที่ now/เริ่มที่ขอบ/ไม่มี/มีแค่ going · ข้ามกลุ่ม · member = admin · DTO ไม่มีรายละเอียด · คนนอก 404 / SA 200 · ลง busy จริงแล้วธงเปลี่ยน + เวลาเดินพ้นแล้วกลับ false)
   - r7-baseline: ✓ · `PAGE /groups/[gid] q= 11 waves= 6`
   - add-days-at ✓ 7/7 · steps-model ✓ 8/8
2. `npx vitest run … tests/groups/members.test.ts` — 19/19 ขึ้น × แต่ error ทั้งหมด (21 รายการ รวม 2 suite ข้างบน) เป็น `Error: EPERM … rmSync` ใน cleanup · grep หา `AssertionError`/`expected` ในผลลัพธ์ = 0 รายการ · ผลจริงของไฟล์นี้ต้องดูจาก CI
3. `git diff main...HEAD --stat -- drizzle src/db` → ว่าง
4. grep `toGroupDetail|getGroup(|listMembers` ใน `src` → ตามเกต 6

## สิ่งที่ตรวจไม่ได้
- e2e (`tests/e2e/r8-onboarding.spec.ts` ฯลฯ) ไม่ได้รันบนเครื่อง Windows นี้ — ดู CI
- `tests/groups/members.test.ts` แยกผล assertion ไม่ได้เพราะ EPERM ใน afterEach — ดู CI
- ไม่ได้ทดสอบบน Turso/libsql จริง (เทสต์ใช้ SQLite ไฟล์ชั่วคราว) — `EXISTS` คืน 0/1 แบบเดียวกัน แต่ยืนยันจาก Vercel preview/CI
