# ADR 0009 — นัดที่ตอบ "ไป" นับเป็นช่วงไม่ว่าง (ทุกกลุ่ม) + คุกกี้จำกลุ่ม `mm_group`

- **Status**: Proposed (Architect, 2026-11-02) · รอบ R6D · ไม่มี migration
- **เกี่ยวข้อง**: [R6D_CONTRACT](../contracts/R6D_CONTRACT.md) G1/G2 · [ADR 0005](0005-common-free-time-algorithm.md) §4 · [ADR 0006](0006-busy-visibility.md) §1–3 · [ADR 0003](0003-rbac.md) · [ADR 0004](0004-time-and-timezone.md) · [ARCHITECTURE](../design/ARCHITECTURE.md) Q8 (ถูกแทนที่ด้วย ADR นี้)
- **เจ้าของการ implement**: Platform (repos/services/serializers, คุกกี้กลุ่ม) · Auth (ลบคุกกี้ตอน logout) · Frontend (UI) · ตรวจโดย Security & Privacy
- **หมายเหตุเลข**: contract ระบุ `0008-going-counts-as-busy.md` แต่ 0008 ถูกใช้แล้ว (`0008-i18n-and-theme.md`) จึงใช้ 0009 — main ยืนยันแล้ว 2026-11-02 (รอบ R6E E9): ใช้ **0009**

## Context
ARCHITECTURE Q8 เดิม: v1 ไม่นับ RSVP เป็น busy · R6D G2 (boss เห็นชอบ 2026-11-02): RSVP `going` ของนัด active = ไม่ว่างจริงทุกกลุ่ม คำนวณสด ไม่คัดลอกเป็นแถว `busy_block` · ข้อมูลข้ามกลุ่มต้องเหลือแค่ช่วงเวลา (ตรวจที่เซิร์ฟเวอร์) · G1: `/calendar` ไม่มี `?g=` ต้องจำกลุ่มล่าสุดต่อเครื่อง
Next 16: Server Component **อ่าน** คุกกี้ได้แต่ **ตั้ง/ลบไม่ได้** ต้องทำใน Server Function หรือ Route Handler (nextjs.org/docs/app/api-reference/functions/cookies, เข้าถึง 2026-11-02) · `middleware` เปลี่ยนชื่อเป็น `proxy` ใน v16 (รัน Node.js) และ Next แนะนำให้ใช้ "เป็นทางสุดท้าย" (nextjs.org/docs/app/api-reference/file-conventions/proxy, เข้าถึง 2026-11-02) · รีโปนี้ไม่มี `src/proxy.ts`/`middleware.ts` (ตรวจ 2026-11-02)

## Decision

### 1. แหล่งข้อมูล "นัดที่ตอบไป" (ตัดสินแล้ว ยกเว้นที่ระบุ)
แถวนับเป็นไม่ว่างของผู้ใช้ U ⇔ ทั้งหมดนี้จริง:
`appointment_rsvp.response = 'going'` · `appointment.status = 'active'` (ยกเลิก → ไม่นับ) · `groups.deleted_at IS NULL` ของกลุ่มนัด · U เป็นสมาชิกปัจจุบันของกลุ่มนัด **และ** `rsvp.updated_at >= group_member.joined_at` (กติกาเดียวกับ `listCurrentRsvps` — QA M1 R4A)
- **ออกจากกลุ่มนัดแล้วแต่แถว rsvp ยังอยู่ → ไม่นับ** (เสนอ ให้ main ยืนยัน) · เหตุผล: (ก) สอดคล้องรายชื่อผู้ตอบในหน้านัดที่ไม่แสดงคนออกแล้ว (ข) ผู้ใช้แก้คำตอบไม่ได้แล้ว (`upsertRsvpIfOpen` ต้องเป็นสมาชิก) → ถ้านับจะเป็น busy ค้างที่ลบไม่ได้ (ค) กลับเข้ากลุ่ม → คำตอบเก่าไม่ฟื้น
- ไม่กรอง `end_at > now` — ใช้แค่ช่วงที่ขอ (วันที่ผ่านแล้วในปฏิทินก็เห็นว่าไม่ว่าง เหมือน busy เดิม)
- นัดเป็น timed เสมอ (ไม่มี all-day) · ทับช่วง = `a.start_at < :toMs AND a.end_at > :fromMs` (ครึ่งเปิด ชนขอบไม่นับ เท่ากับ `overlapsRange`)

**Repo ใหม่ (platform, `src/lib/data/repos/appointment.ts` หรือ `busy.ts`)** — `goingBusyInGroupQuery(db, viewGroupId, fromMs, toMs, limit, excludeAppointmentId?)` คืน query builder (ให้เทสต์ `.toSQL()`), คิวรีเดียว:
```sql
SELECT r.user_id, a.start_at, a.end_at,
       (a.group_id = :gid)                                   AS same_group,
       CASE WHEN a.group_id = :gid THEN a.id    ELSE NULL END AS appointment_id,
       CASE WHEN a.group_id = :gid THEN a.title ELSE NULL END AS title
FROM group_member vm                                   -- สมาชิกปัจจุบันของกลุ่มที่กำลังดู
JOIN appointment_rsvp r ON r.user_id = vm.user_id AND r.response = 'going'
JOIN appointment a      ON a.id = r.appointment_id AND a.status = 'active'
                       AND a.start_at < :toMs AND a.end_at > :fromMs
JOIN groups ag          ON ag.id = a.group_id AND ag.deleted_at IS NULL
JOIN group_member am    ON am.group_id = a.group_id AND am.user_id = r.user_id AND r.updated_at >= am.joined_at
WHERE vm.group_id = :gid  [AND NOT (a.id = :excludeId AND a.group_id = :gid)]
ORDER BY a.start_at, a.end_at, r.user_id LIMIT :max+1
```
- ห้าม SELECT `group_id`, `place_name`, `lat/lng`, `map_url`, `description` ของนัดกลุ่มอื่น · title/id ของกลุ่มอื่นถูกตัดใน SQL (CASE) — ตัวอักษรไม่ออกจาก DB (แบบเดียวกับ `hide_detail` ใน ADR 0006 §2)
- ดัชนีที่มีพอ: PK `group_member(group_id,user_id)` → `rsvp_user_idx` → PK `appointment` → PK `group_member` · **ไม่ต้อง migration** · เพดานแยก `CALENDAR_MAX_ITEMS` · `truncated = busyTruncated || goingTruncated`

### 2. รูปร่างข้อมูล / serializer (ตัดสินแล้ว)
`src/lib/data/serializers/busy.ts` — ทุกชิ้นใน `busy[]` มี `kind` (discriminated union, allowlist ต่อชนิด, สร้างอ็อบเจกต์ใหม่):
| `kind` | ฟิลด์ (ครบทั้งหมด ห้ามเกิน) | เมื่อไร |
|---|---|---|
| `busy` | เดิม (`BusySharedView`/`BusyHiddenView`) + `kind` | busy_block |
| `appointment` | `kind, appointmentId, userId, title, startAt, endAt` | นัดอยู่ในกลุ่มที่กำลังดู (สมาชิกเห็นนัดนี้อยู่แล้ว) |
| `other_group_appointment` | `kind, userId, startAt, endAt` | นัดกลุ่มอื่น — **ไม่มี** id/title/group/place/tz ใด ๆ (ไม่ใช่ `null` — ไม่มี key) |

- `toGoingForViewers(row)`: `same_group && appointment_id !== null` → `appointment` (title ผ่าน `sanitizeDisplayText`) · อื่น ๆ → `other_group_appointment` (ตัดซ้ำสองชั้นเหมือน busy)
- **รวมช่วงกลุ่มอื่น**: ก่อน serialize รวมช่วง `other_group_appointment` ของ user เดียวกันที่ทับ/ชนขอบให้เป็นช่วงเดียว (ไม่บอกว่ามีกี่นัด/กี่กลุ่ม) — ผลวันว่างไม่เปลี่ยน
- เรียง `busy[]`: `startAt, endAt, kind (busy < appointment < other_group_appointment), id|appointmentId|userId` — ขยาย `compareBusyRows` · `BUSY_SHARED_FIELDS` แยกเป็นต่อชนิด (เทสต์ใช้ตรวจ)
- **lib `commonFreeTime` / `membersBlockedDuring` ไม่ต้องแก้** — service แปลงแถว going เป็น `BusyInput` timed: `{ id: 'g:<ลำดับ>' (คีย์ภายใน ไม่ใช่ id นัด), userId, allDay: false, startAt, endAt, localStartDate/localEndDate จาก toLocal(...) ของ src/lib/calendar ใน tz กลุ่ม }` · ห้ามใช้ string/`new Date()` (กฎ 9)
- `days[].blockers.itemIdx` ชี้เข้า `busy[]` ที่รวมแล้ว (กลไกบีบดัชนีเดิม) · ห้ามใส่คีย์ภายใน `g:*` ลง DTO
- ผู้ดูเห็นรายการของตัวเองในปฏิทินกลุ่มด้วยมุมมองเดียวกับคนอื่น (หลัก ADR 0006 "ไม่มีมุมมองเจ้าของในปฏิทินกลุ่ม")
- **ปฏิทินเดือน/วัน (frontend)**: `appointment` → "นัด: <title>" แตะไป `/appointments/:id` · `other_group_appointment` → ป้าย "ติดนัดกลุ่มอื่น" แตะไม่ได้ · วางเป็นช่วง timed ใน tz กลุ่ม
- **แท็บ "ของฉัน"**: ไม่ปน `/api/me/busy` (ชนิด `BusyOwnView` แก้/ลบได้) — ใช้ `GET /api/me/appointments?rsvp=going` (เพิ่มพารามิเตอร์ใน `myAppointmentsQuerySchema` · repo กรอง rsvp going ของฉัน + กติกา §1) ได้ `AppointmentDto` ที่มี `groupName` อยู่แล้ว · UI แสดงอ่านอย่างเดียว แตะ → หน้านัด

### 3. ตัวเตือนนัดชนของเจ้าตัว (ตัดสินแล้ว)
ใส่ใน `AppointmentDetailDto` เป็น `myConflicts: MyConflictDto[]` + `myConflictsTruncated: boolean` — คำนวณ **เฉพาะ session user** เฉพาะใน `getAppointment` และ `setRsvp` (หน้านัดโหลดอยู่แล้วตอนกด "ไป" → ไม่ต้องรอ request เพิ่มตอนเปิด popup) · นัด cancelled/จบแล้ว หรือผู้ดูไม่ใช่สมาชิก (super admin) → `[]`
```ts
type MyConflictDto =
  | { kind: 'appointment'; appointmentId: string; title: string; groupId: string; groupName: string; startAt: number; endAt: number; tz: string }
  | { kind: 'busy'; busyId: string; title: string | null; allDay: boolean; startAt: number; endAt: number; localStartDate: string; localEndDate: string; tz: string };
```
- คิวรีเดียว `myCommitmentsOverlapping(db, me, startAt, endAt, excludeAppointmentId, limit)` = `UNION ALL` ของ (rsvp going ของฉันตามกติกา §1 ยกเว้นนัดนี้) + (`busy_block` ของฉัน **ไม่ SELECT `note`**) ที่ `start_at < :end AND end_at > :start` · busy ทั้งวันใช้ `start_at/end_at` ที่เก็บไว้ (เที่ยงคืนใน tz เจ้าของ) · service กรองซ้ำด้วย `overlapsRange` · เพดาน 5 รายการ (+ truncated)
- title ของ busy ที่ `hide_detail = 1` ส่งได้ (เป็นของเจ้าตัว) · busy ไม่มี title → UI ใช้ข้อความ "ช่วงไม่ว่างที่ลงไว้"
- ป้าย "ชนกับนัดอื่น": หน้านัด = `myRsvp === 'going' && myConflicts.length > 0` · การ์ดในรายการ → ดูข้อ main ตัดสิน (ข)
- ข้อมูลนี้อยู่ใน response ของผู้ขอเท่านั้น ไม่ไปอยู่ใน DTO ที่สมาชิกอื่นได้ (รายชื่อ RSVP เดิมไม่เปลี่ยน)

### 4. `computeOverlap` (ตอนสร้าง/แก้/ตรวจล่วงหน้า) (ตัดสินแล้ว)
- เพิ่ม `goingBusyInGroupQuery(groupId = กลุ่มของนัด, ช่วงขยาย ±AVAILABILITY_FETCH_MARGIN_MS เดิม)` แปลงเป็น `BusyInput` แล้วส่ง `membersBlockedDuring` รวมกับ busy · `items` เป็น union §2 (กติกาความเป็นส่วนตัวเดียวกัน)
- **ตัดนัดตัวเองออก**: create/update (`overlapOrUnknown(row)`) ส่ง `excludeAppointmentId = row.id` — ไม่งั้นผู้ตอบ "ไป" ของนัดนี้จะถูกเตือนว่าติดนัดนี้เอง · `POST /api/groups/:gid/appointments/check` รับ `appointmentId?` (uuid) สำหรับฟอร์มแก้ — exclusion ผูก `a.group_id = :gid` จึงใส่ id นัดกลุ่มอื่นแล้วไม่มีผล (ไม่เป็น oracle)
- going ถูกตัดที่เพดาน → `status: 'unknown'` เหมือน busy

### 5. G1 คุกกี้ `mm_group` (ตัดสินแล้ว ยกเว้นที่ระบุ)
- **ตั้งผ่าน Route Handler** `PUT /api/me/current-group` `{ gid: uuid }` (`currentGroupInputSchema` ใน `src/lib/data/services/current-group.ts`) (route wrapper เดิม: CSRF Origin + JSON, zod `.strict()`) → service `rememberCurrentGroup`: `loadGroupCtx` แล้วต้องเป็น **สมาชิกจริง** (`actorRole !== null`, กลุ่มไม่ถูกลบ — super admin ที่ไม่ใช่สมาชิกไม่ได้) ไม่ผ่าน → `404 NOT_FOUND` ไม่ตั้งคุกกี้ · ผ่าน → `{ok:true}` + `Set-Cookie: mm_group=<gid>; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly` (รูปเดียวกับ `/api/prefs`) · เพิ่มใน `src/app/api/_lib/manifest.ts`
- ไม่ใช้ `proxy.ts` (ตรวจสมาชิกภาพต้องแตะ DB ทุก request ที่ match, Next แนะนำเป็นทางสุดท้าย) · ไม่ใช้ Server Action (รีโปไม่มี `"use server"` เลย — คง pattern API เดียว)
- **จุดเรียก (frontend)**: (1) `/groups/[gid]/page.tsx` หลัง `loadGroup` สำเร็จ อ่านคุกกี้ฝั่งเซิร์ฟเวอร์ (`parseCurrentGroupCookie`) ถ้า `myRole !== null` และคุกกี้ ≠ gid → เรนเดอร์ client component `<RememberGroup gid>` ที่ PUT ครั้งเดียวตอน mount (ผิดพลาด = เงียบ) (2) dropdown กลุ่มบนปฏิทิน: PUT แล้วนำทางด้วย `?g=` (3) `loadCalendarPage` เมื่อ `?g=` ตรงกลุ่มของฉันและ ≠ คุกกี้ → คืน `rememberGid` ให้หน้าเรนเดอร์ `<RememberGroup>`
- **อ่าน** ใน `loadCalendarPage`: `(await cookies()).get('mm_group')` → ลำดับ `?g=` (ถ้าเป็นกลุ่มของฉัน) → คุกกี้ (ต้องผ่าน `z.uuid()` **และ** อยู่ใน `listMyGroups` ที่โหลดอยู่แล้ว — 0 query เพิ่ม) → กลุ่มแรก · คุกกี้ใช้ไม่ได้ → เงียบ **`groupMissing` เป็น true เฉพาะกรณี `?g=`** (R6D-2 ไม่รั่วว่ากลุ่มมีอยู่) · ค่าคุกกี้ไม่ถูก log/สะท้อนกลับ
- **ลบ**: `POST /api/auth/logout`, `/api/auth/logout-all`, `/api/me/delete` เพิ่ม `clearCurrentGroupCookie()` (maxAge 0) ใน `cookies` ของ reply · ค่าคงที่/ฟังก์ชันอยู่ไฟล์เดียว (platform) auth import ใช้
- ไม่เข้ารหัส/ไม่เซ็น: id ไม่ลับ และค่าถูกตรวจทุกครั้งที่อ่าน · ชื่อ `mm_group` ตาม contract (เสนอ: ใช้ `__Host-mm_group` บน prod แบบ session cookie ได้ — ให้ main ตัดสิน (ค))

### 6. จำนวน query ต่อ request (R6D-6: เพิ่มไม่เกิน 1)
| request | เพิ่ม |
|---|---|
| `GET /api/groups/:gid/calendar`, `/availability`, หน้า `/calendar` | +1 (going) · คุกกี้ +0 |
| create/update/check นัด (`computeOverlap`) | +1 |
| `GET /api/appointments/:id`, `PUT .../rsvp` | +1 (UNION ALL) |
| `GET /api/me/appointments?rsvp=going` | +0 (กรองใน query เดิม) |
| `PUT /api/me/current-group` | ใหม่: 1 (`loadGroupCtx`) |

## Alternatives considered
| ทางเลือก | ทำไมไม่เลือก |
|---|---|
| คัดลอก going เป็นแถว `busy_block` | ต้องซิงก์ตอนเปลี่ยนคำตอบ/ยกเลิก/ลบกลุ่ม/ออกกลุ่ม → แถวค้าง · contract สั่งคำนวณสด |
| ใส่ going ใน query busy เดิมด้วย UNION (0 query เพิ่ม) | ทำให้เทสต์ `.toSQL()` "ไม่มี note" ของ ADR 0006 ซับซ้อน · +1 อยู่ในงบ — ทำทีหลังได้ถ้า F2 ต้องการ |
| ส่ง `other_group_appointment` พร้อม `title: null` | ขัดหลัก ADR 0006 (ไม่มี key ดีกว่า null) |
| endpoint แยก `GET /api/appointments/:id/conflicts` | เพิ่ม latency ตอนกด "ไป" + endpoint เพิ่ม · ใส่ใน detail ใช้ข้อมูลที่โหลดอยู่แล้ว |
| ตั้งคุกกี้ใน `proxy.ts` จาก URL | ตรวจสมาชิกภาพไม่ได้โดยไม่แตะ DB ทุก request · ขัด "ตั้งเฉพาะเมื่อเป็นสมาชิกจริง" |

## Consequences
- + เปลี่ยนคำตอบ/ยกเลิก/ลบกลุ่ม/ออกกลุ่ม มีผลทันที (ไม่มี cache ไม่มีแถวค้าง)
- − สมาชิกกลุ่ม G รู้ว่าเพื่อน "มีธุระ" ช่วงไหน (ตามที่ boss เลือก) · ลดด้วยการรวมช่วงไม่ให้รู้จำนวนนัด
- − +1 query ในเส้นทางปฏิทิน (F2 ความเร็วยังค้าง) · ADR 0006 §3 ตาราง endpoint ต้องอ่านคู่กับ ADR นี้ · ARCHITECTURE Q8 ถูกแทนที่

## สิ่งที่ Security ต้องตรวจ / Test requirements
1. **canary ข้ามกลุ่ม** (Scenario A): นัดใน "ลั้ลลา" `title=CANARY-AT-<rand>`, `place_name=CANARY-AP-<rand>`, ชื่อกลุ่ม `CANARY-G-<rand>` · A ตอบ going → raw body ของ `/api/groups/แอ่ว/{calendar,availability,appointments/check}` + create/update นัดในแอ่ว **ไม่พบ** canary ทั้ง 3, id นัด, id กลุ่มลั้ลลา · พบ `other_group_appointment` 12:00–15:00 ของ A · ผ่านลั้ลลา พบ `kind:'appointment'` + title
2. maybe/not_going/ยังไม่ตอบ/ยกเลิก/กลุ่มลบ/A ออกจากลั้ลลา/A กลับเข้าใหม่ (rsvp เก่า) → ไม่มีรายการ going ทั้งสองกลุ่ม
3. `.toSQL()` ของ going query: title/id อยู่ใน `CASE WHEN group_id = ?` · ไม่มี `place_name|lat|lng|map_url|description` · conflict query ไม่มี `note`
4. zod `.strict()` ต่อชนิด: `other_group_appointment` มี key ครบตามตาราง §2 เท่านั้น · type-level `expectTypeOf` ไม่มี `title`
5. `myConflicts`: ชนขอบพอดีไม่นับ · busy ทั้งวัน/ซ่อนรายละเอียดของตัวเองถูกนับพร้อม title · ไม่มีใน response ของสมาชิกคนอื่นที่เปิดนัดเดียวกัน · ไม่รวมนัดตัวเอง
6. `computeOverlap` ตอนแก้นัด: ผู้ตอบ going ของนัดนั้นไม่ถูกเตือนว่าชนนัดตัวเอง · `check` ใส่ `appointmentId` ของกลุ่มอื่น → ผลไม่เปลี่ยน
7. คุกกี้: PUT กลุ่มที่ไม่ใช่สมาชิก/ลบแล้ว/id มั่ว → 404 ไม่มี `Set-Cookie` · ไม่มี Origin → 403 · คุกกี้ปลอม (ไม่ใช่ uuid/กลุ่มคนอื่น/ถูกลบ) → กลุ่มแรก `groupMissing=false` ไม่ error · logout/logout-all/ลบบัญชี → `Set-Cookie: mm_group=; Max-Age=0` · header มี `HttpOnly; Secure; SameSite=Lax`
8. `Cache-Control: private, no-store` ยังอยู่ทุก endpoint ที่มี going/conflicts

## ให้ main ตัดสิน
- (ก) ผู้ใช้ออกจากกลุ่มนัดแล้ว → **ไม่นับ** (เสนอ) · (ข) ป้าย "ชนกับนัดอื่น" บน **การ์ดในรายการ**: เพิ่ม `myConflict?: boolean` ใน `AppointmentDto` (+1 query ต่อรายการ เฉพาะเมื่อมีนัดที่ฉันตอบไป) — เสนอ: ทำ (contract ระบุการ์ด) · (ค) ชื่อคุกกี้ `mm_group` vs `__Host-mm_group` บน prod — เสนอ: `mm_group` ตาม contract · (ง) เลข ADR 0009 แทน 0008 — ตัดสินแล้ว: ใช้ 0009 (main 2026-11-02)
