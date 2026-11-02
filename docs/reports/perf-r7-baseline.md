# R7 เฟส A — baseline ความเร็ว (จำนวน query + เวลา)

> ผู้วัด: platform · 2026-11-03 · branch `perf/r7-speed` · ตาม R7_CONTRACT §2 (R7-2) · **เฟสนี้ไม่ได้แก้ความเร็ว**
> เครื่องมือ: `tests/perf/r7-baseline.test.ts` (Vitest) — ใช้ตัวเดิมวัดหลังเฟส B → `docs/reports/perf-r7-after.md`

## 1. วิธีวัด

- **ฐาน**: libSQL ไฟล์ชั่วคราว + migration จริง (harness เดิม `tests/groups/harness`) · นาฬิกาคงที่ 2026-10-18 10:00 (กรุงเทพฯ)
- **seed (ผ่าน API จริงทั้งหมด)**: กลุ่ม G 10 คน + กลุ่ม H 4 คน · busy ต่อคน 7 แบบมีเวลา + 1 ทั้งวัน (รวม 80) · ชุดรายวัน 30 วัน 2 ชุด (60 แถว) · นัดใน G 5 นัด + ใน H 1 นัด · RSVP 3 นัด × ~7 คน · แจ้งเตือนที่เกิดจากการสร้างนัด · คุกกี้กลุ่มปัจจุบันของผู้ดู = G
- **ตัวนับ** (`src/db/request-metrics.ts`): ห่อ client ของ libSQL ครั้งเดียวใน `createDb` · ผูก request ด้วย AsyncLocalStorage · 1 query = 1 การเรียก DB (≈ 1 round trip บน Turso): `execute` 1 · `batch` 1 · เปิดธุรกรรม 1 · `commit`/`rollback` 1
- **API**: เรียก route handler จริง แล้วอ่าน header `Server-Timing` ที่ wrapper แนบ (ตรวจในเทสต์ว่าเท่ากับจำนวนที่ tracer เห็น)
- **หน้า RSC**: ตั้ง header จาก Server Component ไม่ได้ → จำลอง "โหลดหนึ่งครั้ง" โดยเรียกฟังก์ชันเดียวกับที่ `layout` + `page` + `generateMetadata` เรียก **พร้อมกัน** (Next เรนเดอร์ขนานกัน) ใน `runWithRequestMetrics` · `React.cache` จำลองแบบต่อ request (ล้างทุกรอบ) · `next/headers` ส่งคุกกี้ของผู้ดู
- **ลำดับขั้น**: ชื่อฟังก์ชัน repo ในสุดที่กำลังเรียก DB (เทสต์ห่อ export ของ repo/service ด้วย AsyncLocalStorage ของเทสต์เอง — โค้ดแอปไม่รู้จักชื่อขั้น ไม่มี SQL ดิบ) · `∥` นำหน้า = เริ่มขณะ query อื่นยังค้าง (ขนานกับตัวก่อน)
- **waves** = จำนวนครั้งที่ query เริ่มตอนไม่มี query อื่นค้าง ≈ จำนวน round trip ที่ต้อง **รอต่อกัน** (critical path) — บน Turso ตัวนี้กำหนดเวลาจริงมากกว่าจำนวน query (driver `file:` เป็น sync จึงเป็นค่าประมาณ)
- **เวลา**: มัธยฐาน 7 รอบ หลัง warm-up 1 รอบ · จำนวน query เท่ากันทุกรอบ (เทสต์บังคับ) · รัน 3 ครั้งแยกกันได้จำนวน query เท่ากันทุกครั้ง เวลาต่างกัน ≤ ~1.5 ms
- **ข้อจำกัด**: เวลาในเครื่องกับไฟล์ ≠ Turso ญี่ปุ่น (ไม่มีเครือข่าย — ทุก query < 1 ms) → **ใช้จำนวน query และ waves เป็นตัวชี้วัดหลัก** · "DB ms" = ผลรวมเวลาของทุก query (ขนานกันนับซ้อน จึงอาจมากกว่า "รวม ms") · หน้า RSC ไม่รวมเวลาเรนเดอร์ React/ส่ง HTML · `touchSession` (เขียน last_seen/ต่ออายุ) ไม่เกิดในการวัดเพราะนาฬิกาคงที่ — ของจริงเกิดเป็นระยะ และเกิด **ต่อการเรียก getActor แต่ละครั้ง**

## 2. ตาราง baseline

| เส้นทาง | queries | waves | DB ms | รวม ms |
|---|---:|---:|---:|---:|
| `PAGE /` (home) | 13 | 7 | 5.8 | 4.7 |
| `PAGE /calendar?v=month` | 15 | 11 | 4.9 | 5.8 |
| `PAGE /calendar?v=free` (ว่างตรงกัน) | 15 | 11 | 5.2 | 8.9 |
| `PAGE /calendar?v=day` | 15 | 11 | 4.9 | 5.2 |
| `PAGE /calendar?v=mine` (ของฉัน — ก่อน fetch ฝั่ง client) | 15 | 11 | 4.9 | 5.3 |
| `PAGE /groups` | 8 | 5 | 2.6 | 2.2 |
| `PAGE /groups/[gid]` | 17 | 11 | 5.5 | 4.9 |
| `PAGE /appointments/[id]` | 10 | 6 | 4.3 | 3.1 |
| `PAGE /me` | 5 | 5 | 0.8 | 1.2 |
| `GET /api/groups/:gid/calendar` (เดือน) | 6 | 5 | 2.4 | 2.8 |
| `GET /api/groups/:gid/availability` (เดือน) | 6 | 5 | 2.6 | 5.6 |
| `GET /api/me/busy` | 2 | 2 | 0.6 | 1.1 |
| `GET /api/me/appointments?rsvp=going` | 7 | 4 | 2.9 | 2.0 |
| `GET /api/me/appointments?limit=5` (home รีเฟรช) | 7 | 4 | 3.5 | 2.6 |
| `GET /api/me/notifications?limit=1` (กระดิ่ง) | 3 | 3 | 0.5 | 0.8 |
| `GET /api/groups` | 2 | 2 | 0.4 | 0.7 |
| `GET /api/groups/:gid` | 4 | 4 | 0.6 | 1.1 |
| `GET /api/groups/:gid/appointments` | 8 | 5 | 3.3 | 2.6 |
| `GET /api/me/invites` | 2 | 2 | 0.5 | 0.8 |
| `GET /api/appointments/:id` | 5 | 3 | 4.8 | 3.3 |
| `PUT /api/me/current-group` | 3 | 3 | 2.1 | 2.6 |
| `POST /api/groups/:gid/appointments/check` | 6 | 4 | 2.9 | 2.1 |
| `PUT /api/appointments/:id/rsvp` | 10 | 8 | 5.9 | 5.7 |
| `POST /api/me/busy` (มีเวลา) | 6 | 6 | 3.3 | 4.0 |
| `DELETE /api/me/busy/:id` | 5 | 5 | 3.3 | 3.6 |

เพดานจำนวน query ในเทสต์ (`CEILINGS`) = ตัวเลขคอลัมน์ queries ข้างบน

### 2.1 ลำดับขั้น (ชื่อฟังก์ชัน repo · `SESSION` = `session.findSessionWithUser` · `gm` = group-member · `appt` = appointment · `rl` = rate-limit-bucket)

- `PAGE /`: SESSION → user.findUserById → SESSION → ∥SESSION → notif.listVisibleNotifications → ∥group.listGroupsOfUser → notif.countUnreadVisibleNotifications → ∥appt.listMyUpcomingAppointmentRows → appt.groupNames → ∥appt.memberCountsByGroup → ∥appt.currentMemberNames → ∥appt.listCurrentRsvps → appt.myCommitmentsOverlapping
- `PAGE /calendar?v=month|free|day|mine` (เหมือนกันทั้ง 4 — free เรียก availability แทน calendar แต่ query ชุดเดียวกัน): SESSION → user.findUserById → SESSION → ∥SESSION → notif.listVisibleNotifications → ∥group.listGroupsOfUser → notif.countUnreadVisibleNotifications → ∥gm.findGroupAccess → group.findGroupById → gm.listMembers → **gm.findGroupAccess → group.findGroupById → gm.listMembers** → busy.listSharedBusyInGroup → ∥busy.listGoingBusyInGroup
- `PAGE /groups`: SESSION → user.findUserById → SESSION → ∥SESSION → notif.listVisibleNotifications → ∥group.listGroupsOfUser → ∥group-invite.listPendingDirectInvitesFor → notif.countUnreadVisibleNotifications
- `PAGE /groups/[gid]`: SESSION → user.findUserById → SESSION → ∥SESSION → notif.listVisibleNotifications → ∥gm.findGroupAccess → notif.countUnreadVisibleNotifications → ∥group.findGroupById → gm.listMembers → **SESSION → gm.findGroupAccess** → appt.listGroupAppointmentRows → appt.groupNames → ∥appt.memberCountsByGroup → ∥appt.currentMemberNames → ∥appt.listCurrentRsvps → appt.myCommitmentsOverlapping
- `PAGE /appointments/[id]`: SESSION → user.findUserById → SESSION → ∥SESSION → notif.listVisibleNotifications → ∥appt.findAppointmentAccess → notif.countUnreadVisibleNotifications → gm.listMembers → ∥appt.listCurrentRsvps → ∥appt.myCommitmentsOverlapping
- `PAGE /me`: SESSION → user.findUserById → SESSION → notif.listVisibleNotifications → notif.countUnreadVisibleNotifications
- `GET calendar` / `GET availability`: SESSION → gm.findGroupAccess → group.findGroupById → gm.listMembers → busy.listSharedBusyInGroup → ∥busy.listGoingBusyInGroup
- `GET /api/me/busy`: SESSION → busy.listOwnActiveBusy
- `GET /api/me/appointments` (ทั้งสองแบบ): SESSION → appt.listMyUpcomingAppointmentRows → appt.groupNames → ∥appt.memberCountsByGroup → ∥appt.currentMemberNames → ∥appt.listCurrentRsvps → appt.myCommitmentsOverlapping
- `GET /api/me/notifications?limit=1`: SESSION → notif.listVisibleNotifications → notif.countUnreadVisibleNotifications
- `GET /api/groups`: SESSION → group.listGroupsOfUser
- `GET /api/groups/:gid`: SESSION → gm.findGroupAccess → group.findGroupById → gm.listMembers
- `GET /api/groups/:gid/appointments`: SESSION → gm.findGroupAccess → appt.listGroupAppointmentRows → appt.groupNames → ∥appt.memberCountsByGroup → ∥appt.currentMemberNames → ∥appt.listCurrentRsvps → appt.myCommitmentsOverlapping
- `GET /api/me/invites`: SESSION → group-invite.listPendingDirectInvitesFor
- `GET /api/appointments/:id`: SESSION → appt.findAppointmentAccess → gm.listMembers → ∥appt.listCurrentRsvps → ∥appt.myCommitmentsOverlapping
- `PUT /api/me/current-group`: SESSION → gm.findGroupAccess → rl.reserveBucket
- `POST .../appointments/check`: SESSION → gm.findGroupAccess → group.findGroupById → gm.listMembers → ∥busy.listSharedBusyInGroup → ∥busy.listGoingBusyInGroup
- `PUT /api/appointments/:id/rsvp`: SESSION → appt.findAppointmentAccess → rl.reserveBucket → BEGIN → appt.upsertRsvpIfOpen → COMMIT → **appt.findAppointmentAccess** → gm.listMembers → ∥appt.listCurrentRsvps → ∥appt.myCommitmentsOverlapping
- `POST /api/me/busy`: SESSION → rl.reserveBucket → BEGIN → busy.insertBusyIfUnderCap (INSERT … RETURNING id) → busy.insertBusyIfUnderCap (อ่านกลับด้วย findOwnBusy ภายใน) → COMMIT
- `DELETE /api/me/busy/:id`: SESSION → rl.reserveBucket → BEGIN → busy.deleteOwnBusy → COMMIT

## 3. จุดที่พบ

### 3.1 session / actor โหลดซ้ำ
- **ทุกหน้า RSC อ่าน session 3 ครั้ง (`/groups/[gid]` 4 ครั้ง) + `findUserById` 1 ครั้ง** = 4–5 query ต่อหน้าเพื่อหาผู้ใช้คนเดียว: `getPageUser` (cache แล้ว) + `loadUnreadCount` ของ layout + loader ของหน้า (`loadHome` / `loadCalendarPage` / `scope()` ของ groups, appointments) ต่างเรียก `getActor(pageRequest())` เอง · `loadGroupAppointments` เรียก `scope()` ซ้ำอีกรอบ
- `getActor` ไม่ได้ cache ต่อ request → เมื่อถึงรอบ `touchSession` (ต่ออายุ/last_seen) จะ **UPDATE ซ้ำได้ถึง 3–4 ครั้งต่อหน้า** (ไม่เห็นในการวัดเพราะนาฬิกาคงที่)
- `getPageUser` อ่าน `findUserById` เพิ่ม ทั้งที่ `findSessionWithUser` join user มาแล้ว (มี username/displayName/status/mustChangePin อยู่ในผลแล้ว แต่ `getActor` คืนแค่ actor)
- API: session อ่าน 1 ครั้งต่อ request ถูกต้องแล้ว

### 3.2 `authorize`/`loadGroupCtx` และข้อมูลกลุ่มซ้ำ
- **`/calendar` (ทุกมุมมอง)**: `getGroup` (findGroupAccess → findGroupById → listMembers) เพื่อเอาแค่ `tz` + `myRole` แล้ว `getGroupCalendar`/`getGroupAvailability` โหลดชุดเดียวกันซ้ำอีก 3 query **ต่อกัน** = +3 query, +3 waves
- `/groups/[gid]`: `getGroup` แล้ว `listGroupAppointments` ทำ `findGroupAccess` ซ้ำ (+ SESSION ซ้ำ)
- ทุก service ที่ผูกกลุ่ม: findGroupAccess → findGroupById → listMembers ทำ **ตามลำดับ** (3 waves) — findGroupAccess join `groups` อยู่แล้วแต่คืนแค่ id/deleted/role, แถวกลุ่มอ่านซ้ำอีกรอบ
- RSVP: `findAppointmentAccess` ก่อนเขียน แล้ว **อ่านซ้ำหลัง commit** เพื่อสร้าง DTO (+1 query, รวม 8 waves = เส้นทางที่ลึกที่สุดของ API)

### 3.3 N+1
- **ไม่พบ N+1 แบบต่อแถว** ในเส้นทางที่วัด (รายการนัด hydrate แบบ batch ด้วย `IN (…)`: groupNames / memberCounts / memberNames / rsvps คงที่ 4 query ไม่ขึ้นกับจำนวนนัด · availability/calendar ใช้ 2 query ไม่ขึ้นกับจำนวนสมาชิก) — R4A/R6D ทำไว้แล้ว
- จำนวนคงที่แต่มาก: รายการนัด = 6 query/4 waves ต่อครั้ง (home, รายการกลุ่ม, ?rsvp=going)

### 3.4 ทำตามลำดับแต่ทำขนานได้ (หลัง authorize แล้ว — ไม่ข้ามการตรวจสิทธิ์)
- `findGroupById` ∥ `listMembers` (หรือรวม findGroupById เข้า findGroupAccess) ใน calendar / availability / getGroup / check
- `myCommitmentsOverlapping` รอ `listCurrentRsvps` (ต้องใช้ rsvps เพื่อหาว่านัดไหนฉันตอบไป) — ขนานได้ถ้าคิวรีคำมั่นเองครอบช่วงของทุกแถว แล้วกรองทีหลัง
- `loadHome`: `listMyGroups` → `listMyAppointments` ตามลำดับ (ใช้แค่เช็ก "ไม่มีกลุ่ม") — ขนานได้
- `POST /api/me/busy`: INSERT … RETURNING id แล้วอ่านแถวกลับ (`findOwnBusy`) — `RETURNING *` ตัดได้ 1 query
- rate limit (`reserveBucket`) อยู่นอกธุรกรรมก่อน BEGIN — เป็นการออกแบบเพื่อนับคำขอที่ล้มด้วย (ไม่แนะนำให้รวม)

### 3.5 waterfall ฝั่ง client (อ่านจากโค้ดหน้า/คอมโพเนนต์ — ไม่ได้วัดในเบราว์เซอร์)
- **`/calendar?v=mine`**: เซิร์ฟเวอร์โหลดปฏิทินเดือน (15 query) แล้วหลัง hydrate `CalendarView` ยิง `GET /api/me/busy` ∥ `GET /api/me/appointments?rsvp=going` อีก 2 คำขอ (2 + 7 query) → รวม **24 query / 3 HTTP** ก่อนเห็นรายการของฉัน
- **`/calendar` เปิดด้วย `?g=` ที่ต่างจากคุกกี้** และ **`/groups/[gid]` ครั้งแรก**: `<RememberGroup>` ยิง `PUT /api/me/current-group` (3 query) หลัง hydrate (ไม่บล็อกการแสดงผล)
- **เพิ่ม busy** (BusyFormSheet): `GET /api/me/busy?from&to` (เช็กซ้อนของตัวเอง) → `POST /api/me/busy` → `CalendarView` เพิ่ม `version` แล้ว `GET calendar` ใหม่ = **3 คำขอต่อกัน ~14 query** · ลบ busy ก็ refetch ปฏิทินเช่นกัน
- **RSVP "ไป" จากหน้าหลัก**: `GET /api/appointments/:id` (เอา myConflicts มาแสดงยืนยัน, 5 query) → `PUT rsvp` (10 query) = 2 คำขอต่อกัน 15 query (ส่วน UI เป็น optimistic อยู่แล้ว)
- **เปลี่ยนเดือน / สลับเดือน↔ว่างตรงกัน**: 1 คำขอ (6 query) ต่อครั้ง — ไม่มี prefetch เดือนข้างเคียง
- **กระดิ่ง**: เปลี่ยนหน้าในแอปแต่ละครั้ง (ห่าง ≥ 10 วิ) + focus/visibility → `GET /api/me/notifications?limit=1` (3 query)
- **แถบล่าง (TabBar)**: ใช้ `<Link>` ค่าเริ่มต้น (prefetch ใน production เฉพาะส่วน static/loading ของหน้า dynamic) — การกดแท็บแต่ละครั้ง = RSC request เต็ม 5–17 query

## 4. จุดที่คุ้มแก้ที่สุด (เรียงตามผลที่คาด) — ให้ main เลือกในเฟส B

| # | จุด | ผลที่คาด (จากตาราง) | บทบาท |
|---|---|---|---|
| 1 | **cache actor/session ต่อ request ในหน้า RSC** (`React.cache` ครอบ `getActor`/`pageRequest`/ผู้ใช้ของหน้า + ให้ loader รับ actor จากที่เดียว) · ใช้ข้อมูลผู้ใช้ที่ `findSessionWithUser` อ่านมาแล้ว (ฟังก์ชันของ auth ที่คืน actor + user) เพื่อตัด `findUserById` | −3 query ทุกหน้า (−4 ที่ `/groups/[gid]`): home 13→10 (−23%), calendar 15→12, groups 8→5 (−38%), `/me` 5→2 · กัน touchSession เขียนซ้ำ 3–4 ครั้ง | auth (`src/lib/auth/**`) + frontend/ผู้ดูแล `src/app/_lib/session.ts` และ loader `src/app/(app)/**/_lib` |
| 2 | **`/calendar`: ไม่เรียก `getGroup` ซ้ำ** — เอา tz/role จากผลของ calendar/availability (หรือ service เดียว "calendar page" ที่ authorize ครั้งเดียว) | −3 query / −3 waves: calendar 15→12 (−20%) · รวมกับ #1 → 9 (**−40%**, waves 11→~5) | platform (service คืน role ใน DTO ภายในหรือฟังก์ชันใหม่) + frontend (loader) |
| 3 | **ด่านกลุ่มคืนแถวกลุ่มมาด้วย + ขนานหลัง authorize**: `findGroupAccess` คืน tz/หน้าต่าง/ชื่อ (ตัด `findGroupById`) แล้ว `listMembers` ∥ busy | calendar/availability/check 6→5 query, waves 5→3 · getGroup 4→3 · ใช้กับทุกเส้นทางกลุ่ม (ว่างตรงกันเป็นเส้นทางหลัก) | platform (`policy-context`, repos, services) |
| 4 | **รายการนัด + RSVP**: รวม groupNames/memberCounts เป็น query เดียว, ให้ `myCommitmentsOverlapping` ไม่ต้องรอ rsvps · RSVP ไม่อ่าน `findAppointmentAccess` ซ้ำหลัง commit | รายการนัด 7→6 query, waves 4→3 (home / me/appointments / group appointments) · RSVP 10→9, waves 8→~6 | platform |
| 5 | **client**: `/calendar?v=mine` ส่งข้อมูลแรกจากเซิร์ฟเวอร์ (ไม่โหลดเดือนที่ยังไม่แสดง) · เพิ่ม busy แบบ optimistic/ใช้ผล POST แทน refetch ปฏิทินทั้งเดือน · RSVP "ไป" จากหน้าหลักใช้ myConflicts ที่ส่งมากับรายการ (หรือ endpoint check เบา) | mine: 3 HTTP → 1 · เพิ่ม busy: 3 คำขอต่อกัน → 1–2 · RSVP จาก home: 2 → 1 คำขอ | frontend (+ platform ถ้า loader/API ต้องคืนข้อมูลเพิ่ม — ห้ามเปลี่ยนรูป API เดิม ต้องเป็นฟิลด์เพิ่ม/loader) |

อื่น ๆ (เล็ก): `POST /api/me/busy` ใช้ `RETURNING *` (−1) · `loadHome` ขนาน listMyGroups ∥ listMyAppointments (−1 wave) · ไม่พบ index ที่ขาดจากตัวเลขในเครื่อง (ทุก query < 1 ms — ต้องดูบน Turso ก่อนเสนอ migration)

## 5. ขั้นต่อไป
- (ถ้า boss ช่วยได้) เปิด preview → DevTools → Network → เลือกคำขอ `/api/...` → แท็บ Timing ดู `Server-Timing` (`db` = เวลา DB รวม + จำนวน query, `total`) เพื่อได้เวลาจริงกับ Turso ญี่ปุ่น · หน้า RSC ยังไม่มี header (ดูหมายเหตุใน Handoff)
- เฟส B: แก้ตามที่ main เลือก → ปรับ `CEILINGS` ลง → รันเทสต์เดียวกันเขียน `perf-r7-after.md`
