# ADR 0012 — busy แบบ routine (ชุดทางลัดทำซ้ำรายสัปดาห์ เลือกช่วงสัปดาห์/เดือน)

- **Status**: Proposed (Architect, 2026-11-11) · ยังไม่มี contract · รอ boss ตัดสินข้อใน §11 ก่อน main เขียน `docs/contracts/R14_CONTRACT.md`
- **ที่มา**: PRD "รายการรอทำ" — busy แบบ routine (boss + ทีม 2026-11-11) · D5 · U7 · §3 แถว 2–3
- **ต่อยอดจาก (ไม่แทนที่)**: [ADR 0004](0004-time-and-timezone.md) §2, §5 · [ADR 0005](0005-common-free-time-algorithm.md) · [ADR 0006](0006-busy-visibility.md) §1–§3 · [ADR 0009](0009-going-counts-as-busy.md) · [ADR 0010](0010-daily-busy-series.md) (ชุดรายวัน `series_id`) · [ADR 0003](0003-rbac.md)
- **เจ้าของการ implement (เสนอ)**: Platform (`src/lib/calendar/**`, `src/lib/data/**`, `src/db/schema.ts`, `drizzle/0005_*`, route `src/app/api/me/busy-routines/**`) · Auth (`src/lib/rbac/**`, manifest) · UX (design note) · Frontend · Test · Ops · ตรวจโดย QA + Security

---

## 1. Context — ของที่มีวันนี้ (ตรวจโค้ดบน `feat/r14-busy-routine` = `origin/main` 98186ef, 2026-11-11)

| เรื่อง | สภาพปัจจุบัน | ที่มา |
|---|---|---|
| ตาราง | `busy_block` แถวละช่วง: `start_at/end_at` (UTC, ครึ่งเปิด) + `local_start_date/local_end_date` + `tz` + `all_day` + `title` + `note` + `hide_detail` + `series_id` (nullable, ไม่มี FK) | `src/db/schema.ts` บรรทัด 141–163 |
| ชุดรายวัน | `POST /api/me/busy kind:'daily'` = **ทุกวัน** ใน `[startDate, endDate]` เวลาเดียวกัน · ขยายเป็นแถวละวันด้วย `expandDailyBusyInput` · ≤ 62 วัน · ไม่ข้ามเที่ยงคืน (จบช้าสุด 23:30) · ไม่มีตัวเลือกวันในสัปดาห์ · ไม่มี "แก้ทั้งชุด" (PATCH = หลุดจากชุด) · ลบทั้งชุด = `?scope=series` | ADR 0010 §1–§5 · `src/lib/calendar/busy.ts` |
| เพดาน | ≤ **300 แถว/คน** ในหน้าต่าง `end_at > now − 8 วัน` (`windowCount` นับทุกแถวรวมแถวชุด) · span timed/daily ≤ 62 วัน · ย้อนหลัง ≤ 7 วัน · rate limit create 30 / delete 60 ต่อ 10 นาที | `src/lib/shared/limits.ts` บรรทัด 30–57 · `src/lib/data/repos/busy.ts` `windowCount` |
| เขตเวลา | ไม่มี tz ระดับผู้ใช้ (ตาราง `user` ไม่มีคอลัมน์ tz) · มี `groups.tz` และ `busy_block.tz` · ฟอร์มสร้าง busy ไม่ส่ง tz → เซิร์ฟเวอร์ใช้ `DEFAULT_TZ` = Asia/Bangkok (ส่ง tz เฉพาะตอนแก้ เพื่อคงของเดิม) | `src/db/schema.ts` บรรทัด 12–32, 80 · `src/components/busy/form-model.ts` บรรทัด 141–144 |
| สัปดาห์ | `WEEK_START = 1` (จันทร์, boss 2026-10-16) · มี `startOfWeek`, `dayOfWeek` (ISO 1=จันทร์), `daysInMonth`, `addMonths`, `eachDate` ใน lib กลาง | `src/lib/calendar/constants.ts`, `date.ts` |
| ทางอ่าน busy | (1) ปฏิทิน/วันว่าง/เตือนนัดทับ ของกลุ่ม → `loadMemberBusy` (= `sharedBusyInGroupQuery` ∪ going) **ที่เดียว** (2) "ฉันชนอะไร" `myCommitmentsSql` (3) ธง `hasUpcomingBusy` (EXISTS ใน `group-member.ts`) (4) รายการของฉัน `listOwnActiveBusy` (limit 400) / `listOwnBusyInRange` (limit 1000) (5) ลบบัญชี `account.ts` บรรทัด 123 (6) cron ลบ busy ที่จบเกิน 90 วัน `maintenance.ts` | `src/lib/data/services/member-busy.ts` · `repos/appointment.ts` 340–360 · `repos/group-member.ts` 87–100 · `repos/busy.ts` |
| อัลกอริทึมวันว่าง | `commonFreeTime` / `membersBlockedDuring` รับ `BusyInput[]` (ช่วง timed + all-day) แล้วยูเนียนเอง — ไม่สนว่ามาจากแหล่งไหน · ช่วงข้ามเที่ยงคืนรองรับอยู่แล้ว (clip ตามหน้าต่างวัน) | `src/lib/calendar/free-time.ts` |
| เพดานปฏิทิน | `CALENDAR_MAX_ITEMS = 5000` แถวต่อคำตอบ (เกิน → `truncated`) · ช่วงขอดู ≤ 62 วัน | `limits.ts` บรรทัด 38–40 |

### ช่องว่าง (สิ่งที่ boss ขอแต่ยังทำไม่ได้)
1. **เลือกวันในสัปดาห์** ("จ.–ศ.", "จ. อ. พฤ. ศ.") — `daily` ลงได้แค่ทุกวัน
2. **ช่วงยาวกว่า 62 วัน** และเลือกเป็น "สัปดาห์ X ถึง Y" / "เดือน A ถึง B"
3. **เพดาน 300 แถว**: ถ้าเก็บแบบ R6F (แถวละวันนับเพดาน) "ทำงาน จ.–ศ. 6 เดือน" ≈ 130 แถว + "ยิม 4 วัน/สัปดาห์ 6 เดือน" ≈ 104 แถว = 234 จาก 300 แล้ว (คำนวณ ไม่ใช่วัด) → ผู้ใช้ชนเพดานเร็วมาก
4. **แก้ทั้งชุด / แก้ตั้งแต่สัปดาห์นี้ไป** — ADR 0010 ไม่มี (ต้องลบแล้วลงใหม่)
5. **ข้ามเที่ยงคืน** (กะดึก 22:00–06:00) — `daily` ปฏิเสธ
6. "ทั้งเดือนนี้" แบบ **ไม่ว่างทั้งวันทั้งเดือน** ทำได้อยู่แล้ว (`all_day` หลายวัน ≤ 366 วัน) — ช่องว่างจริงคือความหมาย "routine ใช้ทั้งเดือนนี้" (ดู §11 ข้อ 2)

---

## 2. ทางเลือกการเก็บข้อมูล

### A. ตารางกฎ `busy_routine` + ขยายตอนอ่าน (rule-based, read-time expansion)
เก็บกฎแถวเดียวต่อ routine (วันในสัปดาห์ + เวลา + ช่วงวันที่) · ทุกทางอ่าน (§1 ทางอ่าน 1–4) โหลดกฎแล้วขยายเป็นช่วงในหน่วยความจำด้วย lib กลาง แล้วรวมกับ `busy_block` แบบที่ ADR 0009 ทำกับ going · ข้อยกเว้นรายวันเก็บในตาราง exception (แบบ RFC 5545 EXDATE / RECURRENCE-ID [S6])

### B. แถวละวันใน `busy_block` อย่างเดียว (ขยาย ADR 0010 series ตรง ๆ)
เพิ่ม `weekdays` ให้ `kind:'daily'` และขยาย span · ไม่มีตารางใหม่ · แถวชุดนับเพดาน 300 เหมือนเดิม · ไม่มีที่เก็บ "กฎ" → แก้ทั้งชุดต้องลบ+ลงใหม่ (เดาเวลาเดิมจากแถวแรก)

### C. ตารางกฎ `busy_routine` (แหล่งความจริงของกฎ) + แถวที่ขยายแล้วใน `busy_block` ผูก `routine_id` (hybrid, materialized)
เก็บกฎในตารางใหม่ · ตอนสร้าง/แก้ เซิร์ฟเวอร์ขยายกฎเป็นแถว `busy_block` ทั้งช่วง (มีเพดานช่วง) ใน transaction เดียว · แถวเหล่านี้คือ busy ธรรมดาสำหรับทุกทางอ่าน · ไม่นับเพดาน 300 แต่มีเพดานของ routine เอง · ข้อยกเว้นรายวันเก็บเป็นตาราง skip เล็ก ๆ เพื่อไม่ให้การสร้างใหม่ฟื้นวันที่ผู้ใช้ลบ

### ตารางเทียบ

| เกณฑ์ | A. กฎ + ขยายตอนอ่าน | B. แถวล้วน (ขยาย 0010) | C. กฎ + แถวที่ขยายแล้ว |
|---|---|---|---|
| **ความถูกต้องเรื่องเวลา** (Bangkok ไม่มี DST แต่ tz อื่นมี) | ถูกได้ ถ้าขยายด้วยเวลาผนังทีละวัน (`parseLocalDateTime`) — แต่ต้องขยายซ้ำทุกคำขอ ทุกทางอ่าน · DST gap ต้องตัดสินตอนอ่าน (วันนั้นหาย? เลื่อน?) ซึ่งผู้ใช้ไม่เห็นตอนบันทึก | ถูก (ใช้ `expandDailyBusyInput` เดิม + กรองวัน) · DST gap ปฏิเสธตอนบันทึก | ถูก — ขยายครั้งเดียวตอนบันทึกด้วยฟังก์ชันเดียวกับ R6F · DST gap ปฏิเสธตอนบันทึก (ผู้ใช้เห็นทันที) |
| **แก้/ลบ 1 วัน** | ต้องมีตาราง exception + override และทุกทางอ่านต้องเคารพ | ได้เลย (แถวละวัน — ADR 0010 §5) | ลบวันเดียว = ลบแถว + บันทึก skip · แก้วันเดียว = แถวหลุดเป็น busy เดี่ยว + skip |
| **แก้ทั้ง routine / "ตั้งแต่สัปดาห์นี้ไป"** | ง่ายที่สุด (แก้แถวกฎ / ตัดกฎเป็นสองอัน) | ยาก — ไม่มีกฎให้แก้ ต้องลบแล้วลงใหม่ | ปานกลาง — แก้กฎ + ลบแถวอนาคตของ routine + ขยายใหม่ ใน tx เดียว (§5) |
| **ประสิทธิภาพกับวันว่าง/ปฏิทิน** | DB อ่านน้อย (กฎไม่กี่แถว) แต่จำนวนช่วงที่ป้อน `commonFreeTime` เท่ากับ C · ต้องขยายในหน่วยความจำทุกคำขอ · `hasUpcomingBusy` (EXISTS ใน SQL) ต้องเขียนใหม่เป็นโค้ด | เหมือน C แต่ชนเพดาน 300 ก่อนจะมีปัญหา | อ่านผ่าน index เดิม (`busy_user_start_idx`/`end_idx`) · แถวต่อคำขอมากขึ้น — ดู §8 (ความเสี่ยง `CALENDAR_MAX_ITEMS`) |
| **จุดที่ต้องแก้โค้ดฝั่งอ่าน** | 4–6 จุด (§1 ทางอ่าน 1–4 + ลบบัญชี + cron) ทุกจุดต้องรวมแหล่งใหม่ | 0 | ทางอ่านของคนอื่น **0** · ฝั่งเจ้าของ 2 จุด (รายการของฉันต้องจัดกลุ่ม routine) + ลบบัญชี + cron |
| **ความเสี่ยง migration ต่อข้อมูลเดิม** | ตารางใหม่ ไม่แตะ `busy_block` | ไม่มี migration (หรือแค่ปรับเพดาน) | ตารางใหม่ 2 ตาราง + `ALTER TABLE busy_block ADD routine_id` (nullable, ไม่ backfill) — รูปเดียวกับ 0003 ที่ผ่านมาแล้ว |
| **การมองเห็น (D5/ADR 0006)** | พื้นผิวใหม่: ทุกจุดที่ขยายกฎต้องผ่าน allowlist เดียวกัน · ถ้าพลาด กฎทั้งชุด (เช่น "ทุก จ.–ศ.") อาจรั่วเป็นก้อน | เท่าเดิม | **เท่าเดิม** — คนอื่นเห็นแถว `busy_block` ผ่าน `sharedBusyInGroupQuery` เดิม · ตารางกฎไม่มีทางอ่านฝั่งแชร์เลย |
| **เพดาน 300** | ไม่กระทบ | ชนเร็ว (§1 ช่องว่าง 3) | แยกเพดาน routine (§6) — แถว routine ไม่นับ 300 |
| **ขนาดงาน** | ใหญ่สุด | เล็กสุด แต่ไม่ตอบโจทย์ข้อ 2–4 | ใหญ่ (น้อยกว่า A) |

---

## 3. Recommendation — **ทางเลือก C**

เหตุผลหลัก
1. **ทางอ่านของคนอื่นไม่เปลี่ยนเลย** → ปฏิทินกลุ่ม, วันว่างร่วม, เตือนนัดทับ, `hasUpcomingBusy`, ความเป็นส่วนตัว (ADR 0006) ใช้ของเดิมที่ผ่าน QA/Security มาแล้วหลายรอบ · ความเสี่ยงรั่วต่ำสุด
2. **มีกฎเก็บไว้** → แก้ทั้ง routine และ "ตั้งแต่สัปดาห์/เดือนนี้ไป" ได้ (ตอบโจทย์ "ตารางชีวิตเปลี่ยนได้")
3. **ใช้รูปแบบที่ทีมทำมาแล้ว**: ขยายแบบ `expandDailyBusyInput` · insert หลายแถวคำสั่งเดียวแบบ `insertBusySeriesIfUnderCap` · migration แบบ ADD COLUMN nullable แบบ 0003
4. DST/เวลาไม่มีจริง ถูกตัดสินตอนบันทึก (ผู้ใช้เห็น error ทันที) ไม่ใช่ตอนอ่านแบบเงียบ ๆ

สิ่งที่ยอมจ่าย: แถวต่อคนเพิ่ม (มีเพดาน §6) · ต้องระวังเพดาน `CALENDAR_MAX_ITEMS` ในกลุ่มใหญ่ (§8) · ต้องมีตาราง skip เล็ก ๆ

**ความสัมพันธ์กับ ADR 0010**: ไม่รื้อ — `kind:'daily'` และ `series_id` ใช้ต่อเหมือนเดิม · routine เป็นของใหม่ข้างกัน · แถวของ routine มี `series_id = NULL` และ `routine_id = <id>` (ไม่ใช้ `series_id` เป็น id ของ routine แม้ ADR 0010 §9-B จะเปิดทางไว้ เพราะ (ก) การยกเว้นเพดาน 300 ต้องแยก "แถว routine" ออกด้วยเงื่อนไขง่าย `routine_id IS NULL` (ข) `DELETE ?scope=series` เดิมจะได้ไม่ลบแถว routine โดยไม่ลบกฎ) · ในอนาคตถ้าอยากเลิก `daily` ก็ให้ UI สร้าง routine "ทุกวัน" แทนได้ (ไม่ทำรอบนี้)

---

## 4. การแทนช่วง "สัปดาห์ถึงสัปดาห์" / "เดือนถึงเดือน"

ผู้ใช้เลือกเป็นสัปดาห์หรือเดือน · **เซิร์ฟเวอร์เก็บเป็นวันท้องถิ่นเสมอ** (กฎ 9, ADR 0004 §2) + ชนิดช่วงไว้แสดงผล

| ฟิลด์ | ความหมาย |
|---|---|
| `range_kind` | `'weeks'` \| `'months'` — ใช้แสดงผล/แก้ไขเท่านั้น ไม่ใช้คำนวณ |
| `start_date` | วันแรกที่ routine มีผล (รวม) · weeks = **วันจันทร์** ของสัปดาห์ X (`startOfWeek`, `WEEK_START = 1`) · months = วันที่ 1 ของเดือน A |
| `end_date` | วันสุดท้าย (**รวมปลาย** เหมือน `all_day` และ `daily`) · weeks = วันอาทิตย์ของสัปดาห์ Y (`addDays(startOfWeek(Y), 6)`) · months = วันสุดท้ายของเดือน B (`daysInMonth`) |

- **input จาก client**: weeks → `{ rangeKind:'weeks', fromWeek: DateISO (วันใดก็ได้ในสัปดาห์ X), toWeek: DateISO }` · months → `{ rangeKind:'months', fromMonth:'YYYY-MM', toMonth:'YYYY-MM' }` · เซิร์ฟเวอร์ normalize เป็น `start_date/end_date` ด้วย lib กลาง (client ส่งวันจันทร์มาหรือไม่ก็ได้ — เซิร์ฟเวอร์ปัดเอง) · ฟังก์ชันใหม่ใน lib: `routineRange(input) → { startDate, endDate }` (pure)
- **เดือนยาวไม่เท่ากัน**: ไม่มีปัญหา เพราะเก็บเป็นวันที่จริง (ก.พ. 28/29, เม.ย. 30) · ไม่มีกฎแบบ "วันที่ 31 ของทุกเดือน" — routine อิงวันในสัปดาห์เท่านั้น
- **ปลายเปิด (ไม่มีวันจบ)**: **ไม่รองรับ** — ทางเลือก C ต้องขยายเป็นแถวทั้งช่วง และโจทย์ของ boss คือ "เลือกช่วงที่ใช้" อยู่แล้ว · ต่ออายุ = "ต่อ routine" (แก้ `end_date` ให้ยาวขึ้น → ขยายเพิ่มเฉพาะส่วนใหม่)
- **ความยาวสูงสุด (เสนอ, รอ boss §11 ข้อ 3)**: weeks ≤ **26 สัปดาห์** · months ≤ **6 เดือน** (A ถึง A+5) · คำนวณ: 6 เดือนยาวสุด = ก.ค.–ธ.ค. 184 วัน → ≤ 184 แถว/routine
- **ล่วงหน้าสุด**: `end_date` ≤ วันนี้ + 12 เดือน (กันลงไกลเกินจนกินแถว) · `start_date` เป็นอดีตได้ (เช่น "เดือนนี้" ทั้งที่วันนี้วันที่ 11) แต่ **แถวถูกสร้างตั้งแต่วันนี้ (ใน tz ของ routine) เป็นต้นไปเท่านั้น** — ไม่ย้อนหลัง (ต่างจาก one-off ที่ย้อนได้ 7 วัน: ย้อนลง routine ไม่มีประโยชน์ต่อการหาวันว่าง)
- **แสดงผล**: UI แสดงสัปดาห์เป็นช่วงวันที่ ("16–22 พ.ย.") ไม่ใช้เลขสัปดาห์ ISO (คนทั่วไปไม่รู้จัก) · เดือนแสดงชื่อเดือน + พ.ศ./ค.ศ. ตาม locale (ADR 0004 §6) — รายละเอียดเป็นงาน UX

---

## 5. Schema ที่เสนอ (platform เขียน migration `drizzle/0005_*`)

### ตารางใหม่ `busy_routine` (กฎ — เห็นเฉพาะเจ้าของ)
| คอลัมน์ | ชนิด | กติกา |
|---|---|---|
| `id` | text PK | UUIDv4 (`newId`) — สุ่ม เดาความสัมพันธ์ไม่ได้ |
| `user_id` | text NOT NULL → `user.id` ON DELETE CASCADE | เจ้าของ |
| `title` | text NULL | ≤ 80 (`parseBusyTitle` เดิม) — คัดลอกลงทุกแถว |
| `note` | text NULL | ≤ 500 — เจ้าของเท่านั้น |
| `hide_detail` | int bool NOT NULL default 0 | คัดลอกลงทุกแถว |
| `all_day` | int bool NOT NULL | true = ไม่ว่างทั้งวันในวันที่เลือก |
| `weekdays` | int NOT NULL | bitmask ISO: bit (d−1) ของ d=1 (จ.)…7 (อา.) · CHECK `between 1 and 127` |
| `start_min` | int NULL | นาทีจากเที่ยงคืน 0–1410 ลงตัว 30 · NULL เมื่อ `all_day` |
| `end_min` | int NULL | 30–1440 ลงตัว 30 · `end_min ≤ start_min` = **ข้ามเที่ยงคืน** (จบวันถัดไป) · ยาว ≤ 24 ชม. (`end_min ≠ start_min`) · NULL เมื่อ `all_day` |
| `range_kind` | text NOT NULL | CHECK in ('weeks','months') |
| `start_date` | text NOT NULL | YYYY-MM-DD (รวม) |
| `end_date` | text NOT NULL | YYYY-MM-DD (รวม) · CHECK `end_date >= start_date` |
| `tz` | text NOT NULL default 'Asia/Bangkok' | IANA · ตีความเวลาผนังใน tz นี้ |
| `created_at`, `updated_at` | ms NOT NULL | ไม่ส่งให้ใครนอกจากเจ้าของ |

CHECK เพิ่ม: `(all_day = 1 and start_min is null and end_min is null) or (all_day = 0 and start_min is not null and end_min is not null)` · index `busy_routine_user_idx (user_id, end_date)`

หมายเหตุ: เก็บเวลาเป็นนาที (ไม่ใช่ `HH:mm`) ให้ตรงกับ `groups.free_window_*_min` และรองรับ 1440 (= 24:00) ได้โดยไม่ต้องแก้ `TIME_RE` ที่รับถึง 23:59 (ADR 0010 §10 ข้อ 3) · API ยังรับ/ส่ง `HH:mm` (+ `"24:00"` สำหรับจบเที่ยงคืน)

### ตารางใหม่ `busy_routine_skip` (วันที่ถูกลบ/แก้แยก — กันการขยายใหม่ฟื้นกลับ)
| คอลัมน์ | ชนิด | กติกา |
|---|---|---|
| `routine_id` | text NOT NULL → `busy_routine.id` ON DELETE CASCADE | |
| `local_date` | text NOT NULL | วันท้องถิ่น (ของจุดเริ่ม occurrence) ใน tz ของ routine |
| PK | (`routine_id`, `local_date`) | ซ้ำไม่ได้ |

### คอลัมน์ใหม่ `busy_block.routine_id`
- `text NULL REFERENCES busy_routine(id) ON DELETE CASCADE` · ไม่ backfill · partial index `busy_user_routine_idx (user_id, routine_id) WHERE routine_id IS NOT NULL` (รูปเดียวกับ `busy_user_series_idx` [S2])
- SQLite อนุญาต ADD COLUMN ที่มี REFERENCES ได้เมื่อ default เป็น NULL (และ foreign_keys เปิด — libSQL เปิดให้แล้วตาม `src/db/client.ts`) [S1]
- **ต้องตรวจ**: SQL ที่ `drizzle-kit generate` ได้ต้องเป็น `ALTER TABLE … ADD` ไม่ใช่ rebuild ตาราง (บทเรียน 0002) — ยังไม่ยืนยันว่า drizzle-kit จะ generate ADD COLUMN แบบมี FK ได้ตรง (§12) · ถ้า generate เป็น rebuild ให้เขียน SQL เอง หรือตัด FK ออกแล้วลบแถวด้วยคำสั่งชัดเจน (เหมือน `series_id`)
- ผลกับข้อมูลเดิม: ทุกแถวเดิม `routine_id = NULL` = พฤติกรรมเดิมทุกอย่าง · rollback แอปอย่างเดียวพอ (รุ่นเดิมไม่อ่านคอลัมน์ใหม่ · แถว routine ที่สร้างไปแล้วยังเป็น busy ธรรมดาที่ลบทีละวันได้ — แต่จะ **นับเข้าเพดาน 300** ในรุ่นเดิม: ต้องบอก boss ก่อน rollback)

### แถวที่ขยายแล้ว (occurrence) ใน `busy_block`
- 1 แถวต่อวันที่ตรง `weekdays` ใน `[max(start_date, วันนี้), end_date]` และไม่อยู่ใน skip
- timed: `start_at = parseLocalDateTime(d, start, tz)` · `end_at = parseLocalDateTime(end_min ≤ start_min ? d+1 : d, end, tz)` (1440 = เที่ยงคืนของ d+1) · `local_start_date = d` · `local_end_date = toLocal(end_at − 1, tz).date` (สูตรเดียวกับ `normalizeTimed`)
- all-day: `local_start_date = local_end_date = d` · `start_at/end_at` = เที่ยงคืนต้น/ท้ายวันใน tz (เหมือน `all_day` เดิม)
- `title/note/hide_detail/tz` คัดลอกจาก routine · `series_id = NULL`
- ฟังก์ชันใหม่ใน lib กลาง (pure, กฎ 9): `expandRoutine(rule, { fromDate, skip }) → Result<BusyRow[]>` ใช้ `eachDate`, `dayOfWeek`, `parseLocalDateTime`, `toLocal` ที่มีอยู่ (ห้ามคำนวณด้วย `+ k×24 ชม.` — ต้องเวลาผนังทีละวันแบบ ADR 0010 §2)

### API (เสนอ — manifest เปลี่ยน, auth ตรวจ)
| method + path | ทำอะไร |
|---|---|
| `GET /api/me/busy-routines` | routine ของฉัน (รวม note) + จำนวนวันที่เหลือ |
| `POST /api/me/busy-routines` | สร้าง: กฎ + ขยายแถว ใน tx เดียว (ทั้งหมดหรือไม่มีเลย) |
| `PATCH /api/me/busy-routines/:id` body `{ …กฎใหม่, from: DateISO }` | แก้ตั้งแต่วัน `from` (ปัดเป็นต้นสัปดาห์/ต้นเดือนตาม `range_kind`; ไม่ส่ง = วันนี้ = "แก้ทั้งชุด" ส่วนที่ยังไม่ผ่าน) |
| `DELETE /api/me/busy-routines/:id?from=DateISO` | หยุดตั้งแต่ `from` (ตัด `end_date`, ลบแถว ≥ from) · ไม่ส่ง `from` = ลบทั้งหมด (กฎ + ทุกแถวรวมอดีต — สอดคล้อง ADR 0010 §10 ข้อ 5) |
| `DELETE /api/me/busy/:id` (เดิม) บนแถว routine | ลบวันนั้น + insert skip (คำสั่งใน tx เดียว) |
| `PATCH /api/me/busy/:id` (เดิม) บนแถว routine | แถวหลุดเป็น busy เดี่ยว (`routine_id = NULL`) + insert skip · แถวนี้เริ่มนับเพดาน 300 (เต็ม → `LIMIT_REACHED busyCount` และไม่เปลี่ยนอะไร) — ตรงกับ "แก้วันไหนวันนั้นหลุดจากชุด" ของ ADR 0010 |

**แก้ตั้งแต่ `from`** (ใน `inTx` เดียว · คำสั่งแรกต้องเป็นการเขียน [S5]):
- `from ≤ วันนี้` หรือ `from ≤ start_date` → แก้กฎในที่ (`UPDATE busy_routine`) · ลบแถว `routine_id = R AND local_start_date >= max(from, วันนี้)` · ขยายใหม่ตั้งแต่ `max(from, วันนี้)`
- `from > วันนี้` และ `from > start_date` → **แยกเป็นสอง routine**: R เดิม `end_date = from − 1` · สร้าง R2 (กฎใหม่, `start_date = from`) · ย้าย skip ที่ `local_date >= from` ไป R2 · ลบแถว R ที่ ≥ from · ขยาย R2 (เทียบได้กับ RECURRENCE-ID `RANGE=THISANDFUTURE` ของ RFC 5545 [S6])
- แถวในอดีตไม่ถูกแตะ · แถวที่หลุดเป็น busy เดี่ยวไปแล้วไม่ถูกแตะ · skip คงอยู่ (เป็นการเลือกของผู้ใช้)

---

## 6. การตรวจฝั่งเซิร์ฟเวอร์ + RBAC (กฎ 6)

**RBAC**
- เจ้าของเท่านั้น ทุก action — SA ก็แก้/ลบ routine ของคนอื่นไม่ได้ (PRD §3 แถว 3) · ดู routine ของคนอื่นไม่ได้เลย (ไม่มี endpoint)
- เสนอ action ใหม่ `busy.routine.create` (anyUser) · `busy.routine.update` / `busy.routine.delete` (ownerOnly) · `busy.routine.list.own` (anyUser) — หรือใช้ `busy.*` เดิม ให้ auth ตัดสิน · ทั้งสองแบบ: **ทุกคำสั่ง SQL ผูก `user_id = ผู้กระทำ`** (id ของคนอื่น → 0 แถว → `NOT_FOUND`, IDOR แบบเดิม) และตรวจบัญชี active ในคำสั่งเดียวกับการเขียน (แบบ `insertBusyIfUnderCap`)
- zod `.strict()` ทุก body (ไม่มี `userId/id/routineId/createdAt` ให้ส่ง)

**ลำดับ validate (POST/PATCH)** — ตรวจทั้งหมดใน lib เวลา ยกเว้นเพดานจำนวน
1. `tz` ถูกต้อง → `INVALID_TIMEZONE`
2. ช่วง: รูปแบบ `fromWeek/toWeek` หรือ `fromMonth/toMonth` · ปี 2000–2100 · ปลาย ≥ ต้น → `INVALID_DATE` / `DATE_OUT_OF_RANGE` / `INVALID_RANGE {kind:'dates'}`
3. ยาวเกิน (26 สัปดาห์ / 6 เดือน) → `LIMIT_REACHED {limit:'routineSpan', max}` · `end_date` > วันนี้+12 เดือน → `LIMIT_REACHED {limit:'routineAhead', max:12}` · `end_date < วันนี้` → `INVALID_RANGE` (routine ที่จบแล้ว)
4. `weekdays`: array ของ 1–7 ไม่ซ้ำ ≥ 1 ตัว → แปลงเป็น bitmask · ว่าง → `VALIDATION {fields:{weekdays:'REQUIRED'}}`
5. เวลา (เมื่อไม่ใช่ all-day): `HH:mm` ลงตัว 30 (`"24:00"` เฉพาะ end) · `start == end` → `INVALID_RANGE {kind:'time'}` · end ≤ start = ข้ามเที่ยงคืน (ถูกต้อง)
6. title/note ผ่าน `parseBusyTitle` / `parseBusyNote` เดิม
7. ขยายเป็นแถว (§5) → วันใดตกใน DST gap = `INVALID_LOCAL_TIME` ทั้งคำขอ (สอดคล้อง ADR 0010 §2) · ได้ 0 แถว (เช่น เลือกแต่ อา. ในช่วงที่เหลือไม่มี อา.) → `VALIDATION {fields:{weekdays:'NO_OCCURRENCE'}}`
8. เพดาน (คำสั่ง INSERT … SELECT … WHERE เดียว ไม่มี check-then-act):
   - routine ที่ยังไม่จบ (`end_date >= วันนี้`) ต่อคน < **10** → `LIMIT_REACHED {limit:'routines', max:10}`
   - แถว routine ในอนาคตต่อคน + N ≤ **1,500** → `LIMIT_REACHED {limit:'routineRows', max}` (กันกรณี 10 routine × ทุกวัน × 6 เดือน = 1,840)
9. rate limit: ใช้ `BUSY_WRITE_RATE_LIMITS` เดิม (create/delete) หรือ bucket ใหม่ `busy:routine` — platform เสนอใน contract (นับต่อคำขอ ไม่ใช่ต่อแถว)

`LimitKind` เพิ่ม `routines | routineRows | routineSpan | routineAhead` (UX ต้องแปลข้อความ)

**เพดาน 300 เดิม**: `windowCount` เปลี่ยนเป็นนับ `routine_id IS NULL` เท่านั้น — ใช้ทั้ง `insertBusyIfUnderCap`, `insertBusySeriesIfUnderCap`, `updateOwnBusyIfUnderCap` · ต้องมีเทสต์ว่าแถว routine ไม่กินที่ของ one-off และแถวที่หลุดจาก routine เริ่มนับ

**ขนาดคำสั่ง**: insert ≤ 184 แถว × 5 พารามิเตอร์ + ~12 ≈ 932 < 999 (ค่าต่ำสุดของ SQLite ก่อน 3.32) [S3] — ไม่ต้องแบ่ง batch · ในเครื่อง SQLite 3.45.1 (ADR 0010 §11) เพดานคือ 32,766

---

## 7. การมองเห็น (D5, ADR 0006)
- แถว routine คือ `busy_block` ธรรมดา → เห็นในทุกกลุ่มที่เจ้าของอยู่ (D5) ผ่านทางเดียวเดิม (`loadMemberBusy`) · `hide_detail = 1` → คนอื่นเห็นแค่ "ไม่ว่าง" + เวลา · `hide_detail = 0` → เห็น `title` (ไม่มี `note`) — **กฎเดียวกับ busy เดี่ยว ไม่มีข้อยกเว้นใหม่**
- `routine_id` **ไม่ออกนอกเจ้าของ**: `sharedBusyInGroupQuery` ไม่ SELECT (เหมือน `series_id`, ADR 0010 §6) · `BUSY_SHARED_FIELDS` ไม่เปลี่ยน · `myCommitmentsSql` (ของฉันเอง) ไม่ต้อง SELECT
- ตาราง `busy_routine` / `busy_routine_skip` **ไม่มีทางอ่านฝั่งแชร์เลย** — คนอื่นไม่เห็นว่ามีกฎ ไม่เห็นช่วงสัปดาห์/เดือน ไม่เห็นวันที่ข้าม
- ข้อจำกัดที่ยอมรับ (เท่ากับ ADR 0010 §6 ข้อ 4): คนในกลุ่ม **เดารูปแบบได้** จากเวลา ("ไม่ว่าง 9–18 ทุก จ.–ศ.") — เท่ากับลงเองทีละวัน ไม่ใช่การรั่วใหม่
- เทสต์ canary (แบบ ADR 0006 test 9): JSON ปฏิทิน/วันว่าง/preview นัดของคนอื่นไม่มี key `routineId`, `weekdays`, `rangeKind` · `.toSQL()` ฝั่งแชร์ไม่มี `routine_id`
- UI ตอนสร้าง routine ต้องบอกชัดว่า "ทุกกลุ่มที่คุณอยู่จะเห็นช่วงนี้" (PRD §9 ข้อ D5) — งาน UX

---

## 8. Edge cases

| กรณี | การจัดการ |
|---|---|
| **routine ทับกันเอง** (ทำงาน 9–18 + ยิม 17–19) | อนุญาต · แถวแยกกัน · `commonFreeTime` ยูเนียนเอง (ไม่เปลี่ยน) · UI อาจเตือนแบบไม่บล็อก (ใช้ `overlapsRange` เดิม) |
| **routine ซ้ำเป๊ะ** | อนุญาต (ไม่ dedupe) — กินเพดาน routine · UI เตือนได้ |
| **routine ทับ busy เดี่ยว** | ทั้งคู่อยู่ ยูเนียนกันในวันว่าง · ปฏิทินของฉันแสดงทั้งสอง |
| **routine ทับนัดที่ตอบ "ไป"** (ADR 0009) | ยูเนียน (going เป็นอีกแหล่งที่รวมใน `loadMemberBusy` อยู่แล้ว) · ตัวเตือน "นัดนี้ชนกับ…ของฉัน" (`myCommitmentsSql`) เห็นแถว routine อัตโนมัติ · ตอนสร้าง routine **ไม่บล็อก** แม้ทับนัดที่ไป — อาจเตือนสรุป "ทับนัดที่คุณจะไป 2 นัด" (UX ตัดสิน) |
| **ข้ามเที่ยงคืน** (22:00–06:00) | occurrence ผูกกับ **วันเริ่ม**: เลือก "จ." = จ. 22:00 → อ. 06:00 · `local_end_date = d+1` (CHECK `busy_range_ck` ผ่าน) · วันว่างของ อ. ถูกบังช่วง 00:00–06:00 ถูกต้อง (clip ตามหน้าต่างวัน — ADR 0005) · occurrence สุดท้ายของช่วงอาจล้ำ `end_date` ไปเช้าวันถัดไป (ยอมรับ — ผูกตามวันเริ่ม) · skip/ลบวันนั้น = อ้างด้วยวันเริ่ม |
| **จบเที่ยงคืนพอดี** (18:00–24:00) | `end_min = 1440` → จบเที่ยงคืนของวันนั้น · ไม่ข้ามวัน (`local_end_date = d` จากสูตร `end − 1 ms`) |
| **เดือนยาวไม่เท่ากัน / ก.พ. ปีอธิกสุรทิน** | เก็บเป็นวันที่จริง (§4) · เทสต์: ม.ค.–ก.พ. 2028 (ก.พ. 29 วัน), ก.พ. 2027 (28 วัน) |
| **ข้ามปี** | เทสต์ ธ.ค. 2026 → ม.ค. 2027 (สัปดาห์ 28 ธ.ค.–3 ม.ค.) |
| **"เดือนนี้" ตอนกลางเดือน** | `start_date` = วันที่ 1 (เก็บตามที่เลือก) แต่สร้างแถวตั้งแต่วันนี้ (§4) |
| **tz ผู้ใช้ ≠ tz กลุ่ม** | แถวเป็นช่วง UTC จริง → กลุ่มแปลงตาม `groups.tz` ตามกติกาเดิม (L3 ใน `sharedBusyInGroupQuery`) · all-day เป็นวันที่ลอย (ADR 0004 §2) เหมือนเดิม |
| **DST (tz อื่นที่ไม่ใช่ Bangkok)** | ขยายเวลาผนังทีละวัน · gap → ปฏิเสธทั้งคำขอ · fold → ครั้งแรก · เทสต์ `America/New_York` ช่วงครอบ 2027-03-14 และ 2026-11-01, `Australia/Lord_Howe` 1 เคส (แบบ ADR 0010 §2) |
| **เปลี่ยน tz ทีหลัง** | ไม่มี tz ระดับผู้ใช้ในระบบ (§1) · routine เก็บ `tz` ของตัวเอง ไม่เลื่อนตามอัตโนมัติ · ถ้าอนาคตมี tz ผู้ใช้/ตัวเลือก tz → เปลี่ยนผ่าน "แก้ตั้งแต่สัปดาห์นี้ไป" (ขยายใหม่ด้วย tz ใหม่) · UI v1 ไม่มีช่องเลือก tz (ADR 0004 §2) |
| **ลบ/แก้วันเดียวแล้วแก้ทั้ง routine** | skip ทำให้วันที่ลบไม่ฟื้น · วันที่แก้แยกเป็น busy เดี่ยวแล้ว ไม่ถูกเขียนทับ (อาจซ้อนกับ occurrence ใหม่ถ้าเปลี่ยนเวลา — ยอมรับ, ยูเนียน) |
| **routine หมดอายุ** | แถวอดีตถูก cron ลบตาม `BUSY_RETENTION_DAYS` (90) เดิม · เพิ่มใน `maintenance.ts`: ลบ `busy_routine` ที่ `end_date` < วันนี้ − 90 วัน (skip ตามไป cascade) |
| **ลบบัญชี** | `account.ts` ต้องลบ `busy_routine` ของผู้ใช้ชัดเจน (บัญชีถูก anonymize ไม่ใช่ลบแถว user → `ON DELETE CASCADE` จาก user **ไม่ทำงาน**) |
| **ออกจากกลุ่ม** | ไม่มีผลกับ routine (busy ผูกผู้ใช้ — D5) · คนในกลุ่มเดิมเลิกเห็นทันที (กติกา ADR 0006 §1 ข้อ 2) |
| **รายการ busy ของฉัน** | `listOwnActiveBusy` (limit 400) จะถูกแถว routine ท่วม → แยกแสดง: แถว `routine_id IS NULL` ในรายการเดิม + ส่วน "routine" จาก `GET /api/me/busy-routines` · `listOwnBusyInRange` (ปฏิทินของฉัน ≤ 62 วัน) คืนทุกแถวพร้อม `routineId` (เจ้าของเท่านั้น) — 10 routine × 62 วัน = 620 + one-off ≤ 300 < 1,000 |
| **ปริมาณในกลุ่มใหญ่ (ความเสี่ยงหลัก)** | ปฏิทินเดือน (42 วัน) กลุ่ม 50 คน แต่ละคน 2 routine จ.–ศ. ≈ 50 × 60 = 3,000 แถว · วันว่าง 62 วัน ≈ 50 × 88 = 4,400 · ใกล้ `CALENDAR_MAX_ITEMS` 5,000 · กรณีหนัก (ทุกคนเต็มเพดาน) เกินแน่ → `truncated: true` = วันว่างผิด (คำนวณ ไม่ใช่วัด) · ทางแก้ให้ platform วัดแล้วเลือก: (ก) เทสต์ perf ใหม่ที่ ~10k แถว แล้วยกเพดานเฉพาะทางวันว่าง/เตือนนัดทับ (ไม่ต้องส่งทุกชิ้นให้ client) (ข) ลดเพดาน routine (ค) รวมช่วงของคนเดียวกันที่ติดกันก่อนส่ง lib · **ยังไม่ยืนยัน (§12)** |

---

## 9. ผลต่อ ADR อื่น
- ADR 0005 / 0006 / 0009: **ไม่ต้องแก้เนื้อหา** (แถว routine เป็น busy ธรรมดา)
- ADR 0010: เพิ่มหมายเหตุ "เพดาน 300 นับเฉพาะ `routine_id IS NULL`" เมื่อ ADR นี้ Accepted
- ADR 0004 §2: busy timed ข้ามเที่ยงคืนมีอยู่แล้ว (timed ช่วงเดียว) — routine ใช้กติกาเดียวกันต่อ occurrence
- `docs/design/ARCHITECTURE.md` ตารางและ API: architect อัปเดตตอน ADR Accepted

## 10. แผนรอบ (ร่างให้ main ใส่ contract R14) — ขนาด **L** (ประเมินว่าใหญ่กว่า R6F ราว 1.5–2 เท่า: ตารางใหม่ 2 + คอลัมน์ 1, endpoint ใหม่ 4, แก้ทางเพดาน 3 จุด, UI ใหม่ทั้งหน้า)

| ลำดับ | บทบาท | งาน |
|---|---|---|
| 0 | boss + main | ตัดสิน §11 → contract |
| 1 | platform | lib: `routineRange`, `expandRoutine` (+ tests/calendar ครบ edge §8) · schema + migration `0005` + `tests/platform/migration-0005.test.ts` · repos (insert กฎ+แถวคำสั่งเดียว, แก้ตั้งแต่ from, ลบ, skip) · `windowCount` ยกเว้นแถว routine · services + routes · `account.ts` + `maintenance.ts` · perf test กลุ่มใหญ่ (§8) |
| 1 | auth | action/policy ใหม่ (หรือยืนยันใช้ `busy.*`) · manifest + `tests/platform/manifest.test.ts` · เทสต์ IDOR/SA |
| 1 | ux | design note `docs/design/R14_BUSY_ROUTINE.md`: ปุ่มทางลัด (preset), เลือกวันในสัปดาห์, เลือกช่วงสัปดาห์/เดือน, สรุป "จะลง N วัน", หน้ารายการ routine, sheet เลือกขอบเขตการแก้/ลบ (วันนี้ / ตั้งแต่สัปดาห์นี้ / ทั้งหมด), ข้อความ error ใหม่ th/en, ป้ายในปฏิทิน · บอก D5 ชัด |
| 2 | frontend | UI ตาม design note (ไม่ hard-code ข้อความ, 2 ภาษา 2 ธีม) · หลัง API นิ่ง |
| 2 | test | e2e 375px: สร้าง "ทำงาน จ.–ศ." 4 สัปดาห์ → อีกบัญชีเห็นวันว่างถูก → ลบวันเดียว → แก้ตั้งแต่สัปดาห์ที่ 3 → ลบทั้งหมด · integration เพดาน/ยิงพร้อมกัน |
| 2 | ops | หมายเหตุ OPERATIONS B6/B7 สำหรับ 0005 (migrate ก่อน merge) · rollback note (แถว routine นับเพดานในรุ่นเดิม) |
| 3 | qa + security (อิสระ, กฎ 5) | security: schema ใหม่ + ข้อมูลคน + ownership + canary การรั่ว `routine_id`/กฎ · qa: AC ทั้งรอบ |
| 4 | secretary | PROGRESS · README/quickstart (ฟีเจอร์ใหญ่ — memory "README and quickstart updates") |

ทางเลือกแบ่งรอบ: R14a = server (platform+auth+test, ไม่มี UI) · R14b = UI — ลดขนาด PR ต่อครั้ง

## 11. ข้อที่ต้องให้ boss ตัดสิน (สรุปภาษาง่ายอยู่ในรายงานถึง main)
1. ปุ่มทางลัด (preset) ชุดแรก
2. ความหมายของ "ทั้งเดือนนี้"
3. ช่วงยาวสุดต่อ routine
4. แก้/ลบทีละวันได้ไหม
5. ลบ routine แล้ววันที่ผ่านมาแล้วหายด้วยไหม
6. กะดึกข้ามเที่ยงคืน
7. จำนวน routine สูงสุดต่อคน
8. สัปดาห์เริ่มวันจันทร์ (ยืนยันตามเดิม)

(รายละเอียดและค่าที่แนะนำ: ดูรายงานส่งงานของ architect 2026-11-11 · main ย้ายลง contract)

## 12. ยืนยันแล้ว / ยังไม่ยืนยัน
**ยืนยันแล้ว** (อ่านโค้ดบน `feat/r14-busy-routine` 2026-11-11 — ไม่ได้รันเทสต์ เพราะรอบนี้เป็นเอกสาร)
- สภาพปัจจุบันทั้งหมดใน §1 (อ้างไฟล์/บรรทัด) · ตาราง `user` ไม่มี tz · ฟอร์มสร้างไม่ส่ง tz · `WEEK_START = 1` · migration ล่าสุด `0004_r10_line_reminders` → ถัดไป `0005`
- กติกา SQLite: ADD COLUMN ที่มี REFERENCES ต้อง default NULL [S1] · `SQLITE_MAX_VARIABLE_NUMBER` 999 ก่อน 3.32.0 / 32766 หลังจากนั้น [S3]

**ยังไม่ยืนยัน**
- drizzle-kit generate `ADD COLUMN … REFERENCES` เป็น ALTER ตรง ๆ หรือ rebuild — platform ต้องดู SQL ที่ได้จริง
- ประสิทธิภาพ/การถูกตัด (`truncated`) ในกลุ่มใหญ่ (§8) — ตัวเลขเป็นการคำนวณ ต้องวัดด้วย perf test
- รุ่น SQLite ของ Turso prod (เกี่ยวกับ rollback DROP COLUMN เท่านั้น — เหมือน ADR 0010 §11)
- ตัวเลขเพดานทั้งหมดใน §4, §6 (26 สัปดาห์, 6 เดือน, 12 เดือนล่วงหน้า, 10 routine, 1,500 แถว) เป็นข้อเสนอของ architect ไม่ใช่ข้อกำหนด — รอ boss/main

## แหล่งอ้างอิง (เข้าถึง 2026-11-11)
- [S1] SQLite — ALTER TABLE, ADD COLUMN restrictions ("If foreign key constraints are enabled and a column with a REFERENCES clause is added, the column must have a default value of NULL") — https://www.sqlite.org/lang_altertable.html
- [S2] SQLite — Partial Indexes — https://www.sqlite.org/partialindex.html (อ้างตาม ADR 0010 [S2], เข้าถึง 2026-11-02)
- [S3] SQLite — Limits, SQLITE_MAX_VARIABLE_NUMBER (999 ก่อน 3.32.0, 32766 หลังจากนั้น) — https://www.sqlite.org/limits.html
- [S5] SQLite — Transaction (DEFERRED) — https://www.sqlite.org/lang_transaction.html (อ้างตาม ADR 0010 [S5], เข้าถึง 2026-11-02)
- [S6] RFC 5545 iCalendar — RRULE (UNTIL รวมปลาย), RECURRENCE-ID พารามิเตอร์ RANGE=THISANDFUTURE ("the instance specified by the recurrence identifier and all subsequent recurrence instances") — https://www.rfc-editor.org/rfc/rfc5545 · ใช้เป็นแบบเทียบแนวคิด ไม่ได้ implement RRULE
- โค้ดในรีโป: `src/db/schema.ts` · `src/lib/calendar/{constants,date,busy,free-time,index}.ts` · `src/lib/data/repos/{busy,appointment,group-member,account,maintenance}.ts` · `src/lib/data/services/{busy,member-busy}.ts` · `src/lib/shared/limits.ts` · `src/lib/rbac/{actions,can}.ts` · `src/components/busy/form-model.ts` · `src/db/client.ts` · `drizzle/meta/_journal.json`
