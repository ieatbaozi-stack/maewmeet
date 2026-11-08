# ADR 0006 — การมองเห็น busy และ `hide_detail`

- **Status**: Proposed (Architect, 2026-10-15) · ขยายโดย [ADR 0009](0009-going-counts-as-busy.md) (R6D): นัดที่ตอบ "ไป" ไหลออกทาง endpoint ใน §3 เดียวกัน เป็นชนิด `appointment`/`other_group_appointment`
- **เกี่ยวข้อง**: [PRD D5, U7, U8, U9.1, U10.1, U6, §3, §10](../prd/PRD.md) · [PROCESS ข้อ 9](../team/PROCESS.md) · [RESEARCH §6](../research/RESEARCH_REPORT.md) · [ADR 0003](0003-rbac.md) · [ADR 0005](0005-common-free-time-algorithm.md)
- **เจ้าของการ implement**: Platform (`src/lib/data/**` serializer) + Auth & Access (policy) · ตรวจโดย Security & Privacy

## Context
D5: busy ผูกกับผู้ใช้ ลงครั้งเดียวเห็นทุกกลุ่มที่ตัวเองอยู่ ซ่อนรายละเอียดต่อรายการได้ · PRD §5 (0006): เห็นได้เฉพาะคนที่อยู่กลุ่มเดียวกันอย่างน้อย 1 กลุ่ม **และ** ดูผ่านกลุ่มนั้น · U7: รายการซ่อนรายละเอียด API ต้องส่งแค่ "ไม่ว่าง" ไม่ใช่ซ่อนแค่ที่ UI

## Decision

### 1. กฎการมองเห็น (ประเมินต่อคำขอ ไม่มี cache)
viewer V ขอดู busy ของ owner O ผ่านกลุ่ม G ได้ ⇔
1. `can(V, 'group.calendar.view' | 'group.availability.view', G)` ผ่าน (V เป็นสมาชิก G หรือ super admin — ADR 0003) **และ**
2. O เป็นสมาชิกปัจจุบันของ G **และ** G ไม่ถูกลบ

ไม่มี endpoint ที่รับ "user id ของคนอื่น" แล้วคืน busy — busy ของคนอื่นออกจากระบบได้ **ทางเดียว** คือผ่าน resource ของกลุ่ม (ปฏิทิน, วันว่างร่วม, คำเตือนนัดทับ) · busy ของตัวเองดูผ่าน `/api/me/busy` (เห็นครบ)

### 2. ระดับรายละเอียด (กรองที่ serializer ฝั่งเซิร์ฟเวอร์)
| viewer | `hide_detail = 0` | `hide_detail = 1` |
|---|---|---|
| เจ้าของเอง | ครบ | ครบ + ธง `hidden: true` |
| สมาชิกกลุ่มเดียวกัน (ผ่าน G) | `title` (ไม่มี `note`) + เวลา | **เวลาเท่านั้น** |
| super admin ที่ไม่ใช่สมาชิก (ผ่านหน้า admin) | เหมือนสมาชิก + ลง `audit_log` | เวลาเท่านั้น + ลง `audit_log` |
| อื่น ๆ | 404 (ไม่ถึง serializer) | 404 |

- **`note` ไม่ถูกส่งให้ใครนอกจากเจ้าของ** — เป็นช่องบันทึกส่วนตัว (title = "ทำอะไร" ที่แชร์ได้)
- DTO แยกชนิด (type-level): `BusyOwnView` / `BusySharedView` / `BusyHiddenView` — ชนิดที่ซ่อนแล้ว **ไม่มีฟิลด์** `title`/`note` เลย (ไม่ใช่ `null` หรือ `""`) และ serializer สร้างอ็อบเจกต์ใหม่จากรายชื่อฟิลด์ที่อนุญาต (allowlist) ไม่ใช่ลบฟิลด์ออกจากแถว DB
- รูปร่างที่ส่งให้คนอื่น: `{ id, userId, allDay, startAt, endAt, localStartDate, localEndDate, tz, title? }` · ไม่ส่ง `created_at`/`updated_at` (กันเดาพฤติกรรม)
- query ที่เตรียมข้อมูลให้คนอื่น **ไม่ SELECT `note`** ตั้งแต่ต้น (ลดโอกาสรั่วผ่าน log/debug)

### 3. จุดที่ busy ของคนอื่นไหลออก (ทุกจุดต้องผ่าน serializer เดียวกัน)
| endpoint | story | สิ่งที่ส่ง |
|---|---|---|
| `GET /api/groups/:gid/calendar` | U8 | รายชื่อสมาชิก (id, display_name, สีประจำตัว) + busy ของสมาชิกในช่วงวันที่ (shared/hidden view) |
| `GET /api/groups/:gid/availability` | U9, U9.1 | ช่วงว่างร่วม + X/Y + `blockers: [{userId, title?}]` (title เฉพาะที่ไม่ซ่อน) |
| `POST /api/groups/:gid/appointments` (+ `/preview`) / `PATCH /api/appointments/:aid` | U10.1 | `warnings: [{userId, title?}]` |
| หน้า Server Component ที่เรียก service เดียวกัน | U8 U9 | เหมือน API |

Header ทุกคำตอบที่มี busy: `Cache-Control: private, no-store`

### 4. ความเป็นส่วนตัวด้าน UI (แจ้ง UX/Front-end)
ฟอร์มลง busy ต้องบอกชัดว่า "เพื่อนทุกกลุ่มที่คุณอยู่จะเห็นช่วงเวลานี้" + สวิตช์ "ซ่อนว่าทำอะไร" (PRD §10) · ช่อง `note` ต้องติดป้ายว่า "เห็นคนเดียว"

## Alternatives considered
| ทางเลือก | ทำไมไม่เลือก |
|---|---|
| ซ่อนรายละเอียดฝั่ง UI (ส่งครบแล้วไม่แสดง) | ขัด U7 AC ตรง ๆ — เปิด DevTools ก็เห็น |
| busy ผูกกับกลุ่ม (ลงแยกต่อกลุ่ม) | ขัด D5 และทำให้ผู้ใช้ต้องลงซ้ำ |
| ส่ง `title: null` แทนการตัดฟิลด์ | ใช้ได้ แต่การไม่มีฟิลด์ใน type ทำให้ compiler กันโค้ดฝั่ง UI ที่เผลออ่าน title ของรายการซ่อน · และเทสต์ canary ตรวจง่ายกว่า |
| endpoint `GET /api/users/:id/busy` พร้อมเช็ก "มีกลุ่มร่วม" | เพิ่มพื้นผิวโจมตี และขัดเงื่อนไข "ดูผ่านกลุ่มนั้น" ของ PRD |

## Consequences
- + พื้นผิวที่ข้อมูลรั่วได้มีแค่ 3 endpoint + serializer เดียว → Security reviewer ตรวจจบในที่เดียว
- + ถอดสมาชิกออก (U6) มีผลทันทีเพราะไม่มี cache
- − super admin เห็นเวลา busy ของทุกกลุ่ม (ตาม PRD §3) — ชดเชยด้วย audit log; boss ควรรู้ (ดูรายงาน Handoff)
- − `note` ไม่แชร์ให้ใคร: ถ้า PRD ตั้งใจให้ "ทำอะไร" มีรายละเอียดยาวที่เพื่อนเห็น ต้องใช้ `title`

## Test requirements (อ้าง PRD U7, U8, U6, U9.1, U10.1, PROCESS ข้อ 9)
เทคนิค **canary**: seed busy ของ O ที่ `title = "CANARY-T-<rand>"`, `note = "CANARY-N-<rand>"` ทั้งแบบซ่อนและไม่ซ่อน แล้วค้น **raw response body** (สตริง JSON ทั้งก้อน) ของทุก endpoint
1. สมาชิก V ใน G: `/calendar`, `/availability`, `/appointments` (warnings) → พบ `CANARY-T` ของรายการไม่ซ่อน, **ไม่พบ** `CANARY-T` ของรายการซ่อน, **ไม่พบ** `CANARY-N` เลยแม้แต่ครั้งเดียว (U7)
2. คนนอก N (ล็อกอิน ไม่อยู่ G) → ทุก endpoint ของ G ได้ 404 และ body ไม่มี `CANARY` (U8)
3. ข้ามกลุ่ม: O อยู่ G1, G2 · V อยู่แค่ G1 → ผ่าน G1 เห็น O · ผ่าน G2 → 404 · ผู้ใช้ P ที่อยู่ G2 แต่ไม่อยู่ G1 ไม่ปรากฏใน `/api/groups/G1/calendar` เลย (PRD 0006 "ดูผ่านกลุ่มนั้น")
4. ถอดออก (U6): V ถูกลบจาก G แล้วเรียก `/calendar` ทันที → 404 · O ออกจาก G → busy ของ O หายจาก `/calendar` ของ G ทันที
5. กลุ่มถูกลบ (soft delete) → 404 ทุก endpoint สำหรับสมาชิกเดิม
6. เจ้าของ `/api/me/busy` เห็น title + note ครบ รวมรายการซ่อน
7. super admin ไม่ใช่สมาชิกดู `/calendar` → รายการซ่อนไม่มี title · มีแถวใน `audit_log` (action `group.calendar.view`)
8. Type-level: เทสต์ `expectTypeOf<BusyHiddenView>().not.toHaveProperty('title')` (Vitest) และ schema ของ response (zod) แบบ `.strict()` ล้มถ้ามีฟิลด์เกิน
9. ไม่มี `note` ใน SQL ของ query ฝั่งแชร์: เทสต์ snapshot ของ SQL ที่ Drizzle สร้าง (`.toSQL()`) ไม่มีคอลัมน์ `note`
10. Response header `Cache-Control` มี `no-store` ทุก endpoint ในข้อ 3
