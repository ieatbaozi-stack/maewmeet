# R7 หลังเฟส B — จำนวน query + เวลา (ก่อน → หลัง)

> ผู้วัด: platform · 2026-11-08 · branch `perf/r7-speed` · ตาม R7_CONTRACT §3 (R7-4)
> โค้ดที่วัด: B-1 `2c4167e` `6c64caa` · B-2/B-3 `6c3ef87` `45660c2` · B-4 `896720c` `45660c2` · B-5 `a18cd83`
> ฝั่ง "ก่อน" = เฟส A (`docs/reports/perf-r7-baseline.md`, commit `b721a22`)

## 1. วิธีวัด (เครื่องมือเดียวกับเฟส A)

- เทสต์ตัวเดิม `tests/perf/r7-baseline.test.ts` (Vitest): ใช้ seed เดิม นาฬิกาเดิม และนิยาม query / waves / เวลาแบบเดิมทุกข้อ (ดูรายงานเฟส A §1)
- รัน 3 ครั้งแยกกัน แต่ละครั้งเก็บมัธยฐานของ 7 รอบ
  - จำนวน query และ waves เท่ากันทุกครั้ง และทุกรอบ (เทสต์บังคับว่าคงที่)
  - เวลาในตาราง = มัธยฐานของ 3 ครั้ง
- **React.cache ใน harness**: จำลองเป็น memo ต่อการโหลดหนึ่งครั้ง (ล้าง store ทุก sample) โดยใช้ args เป็นคีย์ ผลเท่ากับ Next จริง เพราะ:
  - ทุกจุดที่ใช้ `cache()` ในแอปรับ args เป็น 0 ตัวหรือ string ตัวเดียว (`getPageRequest`, `getRequestSession`, `getPageUser`, `loadGroup(gid)`, `loadAppointment(id)`) คีย์แบบ JSON จึงให้ผลเหมือนการเทียบ identity ของ React
  - promise ที่ reject ก็ถูก memo เหมือนของจริง
  - harness ไม่ memo ข้ามการโหลด ซึ่งตรงกับที่ Next ล้าง cache ทุก request
- **ข้อจำกัด**: เวลาในเครื่องใช้ libSQL แบบไฟล์ ซึ่งไม่ใช่ Turso ญี่ปุ่น ทุก query ใช้เวลาน้อยกว่า 1 ms จึง **ยึดจำนวน query และ waves เป็นตัวชี้วัดหลัก**
  - หน้า RSC ไม่รวมเวลาเรนเดอร์และส่ง HTML
  - "DB ms" คือผลรวมของทุก query ส่วนที่ขนานกันจะถูกนับซ้อน

## 2. ตารางทุกเส้นทาง (เฟส A → หลังเฟส B)

| เส้นทาง | queries | ลด | waves | ลด | DB ms | รวม ms | รวม ลด |
|---|---:|---:|---:|---:|---:|---:|---:|
| `PAGE /` (home) | 13 → 9 | -31% | 7 → 3 | -57% | 5.8 → 5.7 | 4.7 → 2.7 | -43% |
| `PAGE /calendar?v=month` | 15 → 8 | -47% | 11 → 4 | -64% | 4.9 → 4.2 | 5.8 → 2.9 | -50% |
| `PAGE /calendar?v=free` (ว่างตรงกัน) | 15 → 8 | -47% | 11 → 4 | -64% | 5.2 → 4.3 | 8.9 → 3.7 | -58% |
| `PAGE /calendar?v=day` | 15 → 8 | -47% | 11 → 4 | -64% | 4.9 → 4.1 | 5.2 → 2.7 | -48% |
| `PAGE /calendar?v=mine` ¹ | 15 → 11 | -27% | 11 → 5 | -55% | 4.9 → 5.3 | 5.3 → 3.1 | -42% |
| `PAGE /groups` | 8 → 5 | -37% | 5 → 3 | -40% | 2.6 → 1.4 | 2.2 → 1.2 | -45% |
| `PAGE /groups/[gid]` | 17 → 11 | -35% | 11 → 6 | -45% | 5.5 → 4.4 | 4.9 → 2.9 | -41% |
| `PAGE /appointments/[id]` | 10 → 7 | -30% | 6 → 4 | -33% | 4.3 → 2.8 | 3.1 → 1.8 | -42% |
| `PAGE /me` | 5 → 3 | -40% | 5 → 3 | -40% | 0.8 → 0.4 | 1.2 → 0.7 | -42% |
| `GET /api/groups/:gid/calendar` (เดือน) | 6 → 5 | -17% | 5 → 3 | -40% | 2.4 → 3.1 | 2.8 → 2.0 | -29% |
| `GET /api/groups/:gid/availability` (เดือน) | 6 → 5 | -17% | 5 → 3 | -40% | 2.6 → 3.6 | 5.6 → 3.0 | -46% |
| `GET /api/me/busy` | 2 → 2 | 0% | 2 → 2 | 0% | 0.6 → 0.5 | 1.1 → 0.9 | -18% |
| `GET /api/me/appointments?rsvp=going` | 7 → 6 | -14% | 4 → 3 | -25% | 2.9 → 3.2 | 2.0 → 1.8 | -10% |
| `GET /api/me/appointments?limit=5` (home รีเฟรช) | 7 → 6 | -14% | 4 → 3 | -25% | 3.5 → 3.4 | 2.6 → 1.8 | -31% |
| `GET /api/me/notifications?limit=1` (กระดิ่ง) | 3 → 3 | 0% | 3 → 3 | 0% | 0.5 → 0.5 | 0.8 → 0.7 | -13% |
| `GET /api/groups` | 2 → 2 | 0% | 2 → 2 | 0% | 0.4 → 0.4 | 0.7 → 0.7 | 0% |
| `GET /api/groups/:gid` | 4 → 3 | -25% | 4 → 3 | -25% | 0.6 → 0.5 | 1.1 → 0.9 | -18% |
| `GET /api/groups/:gid/appointments` | 8 → 7 | -12% | 5 → 4 | -20% | 3.3 → 3.4 | 2.6 → 2.0 | -23% |
| `GET /api/me/invites` | 2 → 2 | 0% | 2 → 2 | 0% | 0.5 → 0.4 | 0.8 → 0.6 | -25% |
| `GET /api/appointments/:id` | 5 → 5 | 0% | 3 → 3 | 0% | 4.8 → 2.3 | 3.3 → 1.5 | -55% |
| `PUT /api/me/current-group` | 3 → 3 | 0% | 3 → 3 | 0% | 2.1 → 1.7 | 2.6 → 2.1 | -19% |
| `POST /api/groups/:gid/appointments/check` | 6 → 5 | -17% | 4 → 3 | -25% | 2.9 → 2.5 | 2.1 → 1.6 | -24% |
| `PUT /api/appointments/:id/rsvp` | 10 → 9 | -10% | 8 → 7 | -12% | 5.9 → 5.4 | 5.7 → 4.8 | -16% |
| `POST /api/me/busy` (มีเวลา) | 6 → 5 | -17% | 6 → 5 | -17% | 3.3 → 3.0 | 4.0 → 3.3 | -18% |
| `DELETE /api/me/busy/:id` | 5 → 5 | 0% | 5 → 5 | 0% | 3.3 → 2.9 | 3.6 → 3.2 | -11% |
| `SVC openGroupCalendar → load` (ใหม่ B-2 · ไม่รวม session/layout) | — → 4 | — | — → 2 | — | — → 2.9 | — → 1.7 | — |
| `SVC openGroupAvailability → load` (ใหม่ B-2) | — → 4 | — | — → 2 | — | — → 3.1 | — → 2.3 | — |

¹ `v=mine` ตอนนี้โหลด "busy ของฉัน + นัดที่ตอบไป" ที่เซิร์ฟเวอร์ แทนปฏิทินเดือน
- เดิม: 15 query ในหน้า และ client ยิงเพิ่มหลัง hydrate อีก 2 คำขอ (2 + 7 query) รวม **24 query / 3 HTTP**
- ตอนนี้: **11 query / 1 HTTP** (−54%)

เวลา ms ยังได้รับผลจากโหลดของเครื่อง
- เฟส A รัน 3 ครั้งต่างกันไม่เกิน ~1.5 ms
- รอบนี้ 3 ครั้งต่างกันไม่เกิน ~0.9 ms (เครื่องว่าง ไม่มี agent อื่นรัน)

`CEILINGS` ในเทสต์ = คอลัมน์ queries ฝั่ง "หลัง" ทุกแถว ไม่มีแถวไหนเพิ่มขึ้น

### 2.1 ลำดับขั้นหลังเฟส B (ชื่อย่อตามรายงานเฟส A)
- `PAGE /`: SESSION → notif.listVisible → ∥appt.listMyUpcomingRows → ∥group.listGroupsOfUser → notif.countUnread → ∥appt.groupNamesAndMemberCounts → ∥appt.currentMemberNames → ∥appt.listCurrentRsvps → ∥appt.myCommitmentsOverlapping
- `PAGE /calendar?v=month|free|day`: SESSION → notif.listVisible → ∥group.listGroupsOfUser → notif.countUnread → ∥gm.findGroupWithAccess → gm.listMembers → ∥busy.listShared → ∥busy.listGoing
- `PAGE /calendar?v=mine`: SESSION → notif.listVisible → ∥group.listGroupsOfUser → notif.countUnread → ∥gm.findGroupWithAccess → busy.listOwnActiveBusy → ∥appt.listMyUpcomingRows → appt.groupNamesAndMemberCounts → ∥appt.currentMemberNames → ∥appt.listCurrentRsvps → ∥appt.myCommitmentsOverlapping
- `PAGE /groups/[gid]`: SESSION → notif.listVisible → ∥gm.findGroupWithAccess → notif.countUnread → ∥gm.listMembers → **gm.findGroupWithAccess** (ด่านของ listGroupAppointments) → appt.listGroupRows → appt.groupNamesAndMemberCounts → ∥… → ∥appt.myCommitmentsOverlapping
- `PUT rsvp`: SESSION → appt.findAppointmentAccess → rl.reserveBucket → BEGIN → appt.upsertRsvpIfOpen → COMMIT → gm.listMembers → ∥appt.listCurrentRsvps → ∥appt.myCommitmentsOverlapping
- `POST /api/me/busy`: SESSION → rl.reserveBucket → BEGIN → busy.insertBusyIfUnderCap (RETURNING ทุกคอลัมน์) → COMMIT
- session อ่าน 1 ครั้งต่อหน้า (เดิม 3–4 ครั้ง + `findUserById`) · touchSession เขียนได้ไม่เกิน 1 ครั้งต่อหน้า (B-1)

## 3. เกณฑ์ R7-4 — เส้นทางหลัก (query ลด ≥ 30% **หรือ** เวลารวมลด ≥ 30%)

| เส้นทางหลัก | queries | เวลารวม (ในเครื่อง) | ผล |
|---|---|---|---|
| home `PAGE /` | 13 → 9 (**−31%**) | 4.7 → 2.7 ms (−43%) | **ผ่าน** |
| calendar เดือน `PAGE /calendar?v=month` | 15 → 8 (**−47%**) | 5.8 → 2.9 ms (−50%) | **ผ่าน** |
| ว่างตรงกัน `PAGE /calendar?v=free` | 15 → 8 (**−47%**) | 8.9 → 3.7 ms (−58%) | **ผ่าน** |
| RSVP `PUT /api/appointments/:id/rsvp` | 10 → 9 (−10%) | 5.7 → 4.8 ms (−16%) | **ไม่ผ่าน** |

RSVP ไม่ผ่าน เพราะ query ที่เหลือ 9 ตัวเป็นส่วนที่ตั้งใจคงไว้
- ด่านสิทธิ์ (กฎ 6) 1
- rate limit นอกธุรกรรม 1 (นับคำขอที่ล้มด้วย ตามที่ออกแบบ)
- BEGIN / upsert / COMMIT 3
- session 1
- สร้าง DTO 3 query (สมาชิก ∥ rsvps ∥ myConflicts) แต่ขนานกันจึงกิน 1 wave

ที่ตัดได้ในรอบนี้คือการอ่าน access ซ้ำหลัง commit (−1 query, −1 wave) ถ้าจะลดอีกต้องเปลี่ยนการออกแบบ ซึ่งอยู่นอกขอบเขตรอบนี้ เช่น:
- ย้าย rate limit เข้าธุรกรรม
- คืน DTO แบบย่อจาก PUT ซึ่งเปลี่ยนรูป API

## 4. คำขอ HTTP ฝั่ง client (ก่อน → หลัง)
นับจากรายงาน frontend (B-5) · จำนวน query คิดจากตาราง §2

| เหตุการณ์ | ก่อน | หลัง |
|---|---|---|
| เปิด `/calendar?v=mine` | 3 HTTP (RSC + GET me/busy + GET me/appointments?rsvp=going) · 24 query | **1 HTTP** · 11 query |
| เพิ่ม busy | 3 คำขอต่อกัน (GET me/busy เช็กทับ → POST → GET ปฏิทินเดือน) · 2+6+6 = 14 query | **2 คำขอ** (GET me/busy เช็กทับ E11 → POST · ใช้ผล POST ต่อเข้าข้อมูลที่แสดงอยู่) · 2+5 = 7 query |
| RSVP "ไป" จากหน้าหลัก | 2 คำขอ (GET detail → PUT) · 5+10 = 15 query | **2 คำขอ คงเดิม** (popup นัดชนของ R6D ต้องใช้ `myConflicts` ก่อนยืนยัน · สองคำขอคั่นด้วยการกดของผู้ใช้) · 5+9 = 14 query |

## 5. สิ่งที่ยังไม่ได้วัด / ข้อสังเกต
- **เวลาจริงบน Turso ญี่ปุ่น ยังไม่ได้วัด** · ทุก query บน Turso คือ 1 round trip ตัวที่น่าจะกำหนดเวลาจริงคือ waves (หน้าหลัก 7→3, ปฏิทิน 11→4)
  - วัดได้จาก `Server-Timing` ของ API บน preview (หน้า RSC ไม่มี header ตามที่ตัดสินไว้ใน §3.1)
  - prod ปิด Server-Timing ไว้
- เวลาเรนเดอร์ React และขนาด HTML ไม่ได้วัด
- ไม่ได้วัดในเบราว์เซอร์จริง: prefetch แถบล่าง และ waterfall หลัง hydrate (ตัวเลขใน §4 มาจากโค้ดและรายงาน frontend)
- `touchSession` ไม่เกิดในการวัด เพราะนาฬิกาคงที่ (เหมือนเฟส A) · B-1 จำกัดให้เขียนได้ไม่เกิน 1 ครั้งต่อหน้า
- จุดที่ยังซ้ำ (ไม่อยู่ใน §3.1): `/groups/[gid]` ยังผ่านด่านกลุ่ม 2 ครั้ง (`getGroup` + `listGroupAppointments`) ราว −1 query ถ้าแก้ในรอบหน้า
- ไม่พบ index ที่ขาด: ทุก query ในเครื่องใช้เวลาน้อยกว่า 1 ms จึงไม่มี migration ในรอบนี้
