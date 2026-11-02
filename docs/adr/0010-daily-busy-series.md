# ADR 0010 — busy หลายวัน "เฉพาะช่วงเวลา" (ชุดรายวัน `series_id`)

- **Status**: Proposed (Architect, 2026-11-02) · รอบ R6F · มี migration `0003`
- **เกี่ยวข้อง**: [R6F_CONTRACT](../../R6F_CONTRACT.md) §1–§2, §5 · [ADR 0004](0004-time-and-timezone.md) §2, §5 · [ADR 0005](0005-common-free-time-algorithm.md) · [ADR 0006](0006-busy-visibility.md) §1–§3 · [ADR 0003](0003-rbac.md) · [ADR 0009](0009-going-counts-as-busy.md) · R6E_CONTRACT E11 (popup ลงทับ)
- **เจ้าของการ implement**: Platform (`src/lib/calendar/**`, `src/lib/data/**`, route `src/app/api/me/busy/**`, `src/db/schema.ts`, `drizzle/0003_*`) · Frontend (`BusyFormSheet`, รายการ/รายละเอียด busy) · ตรวจโดย Security & Privacy + QA
- **หมายเหตุชื่อ**: contract เขียน `busy.series_id` · ตารางจริงชื่อ `busy_block` (`src/db/schema.ts:138`) → คอลัมน์คือ **`busy_block.series_id`**

## Context
- boss (2026-11-02): "ไม่ว่างแค่ 17:00–20:00 ทุกวันเพราะมีคลาสเรียน ที่เหลือว่าง" · ตอนนี้ `kind: 'timed'` ข้ามหลายวันได้แค่ **ช่วงต่อเนื่องเดียว** (`normalizeTimed` ใน `src/lib/calendar/busy.ts`) → 3–30 พ.ย. 17:00–20:00 จะกลายเป็นไม่ว่างตลอด 27 วันกับอีก 3 ชม.
- ของเดิมที่ต้องรักษา: เพดาน 300 แถว/คนแบบคำสั่งเดียวมีเงื่อนไข (`insertBusyIfUnderCap`, `windowCount` ใน `src/lib/data/repos/busy.ts`) · `inTx` = `serialized` + `db.transaction` (`src/lib/data/tx.ts`) · serializer allowlist (`src/lib/data/serializers/busy.ts`) · `id` = UUIDv4 (`src/lib/shared/id.ts`) · ไม่มี rate limit ของ busy ในโค้ดปัจจุบัน (ตรวจ `src/lib/shared/limits.ts` และ `services/busy.ts` 2026-11-02 — ดู §8)
- เครื่องยนต์วันว่าง (ADR 0005) และปฏิทินกลุ่มกิน "แถว busy แบบมีเวลา" อยู่แล้ว → ถ้าชุดรายวันเป็นแถว timed ธรรมดาวันละแถว จะไม่ต้องแตะอัลกอริทึมเลย

## Decision

### 1. Input — `POST /api/me/busy` เพิ่ม `kind: 'daily'` (endpoint เดิม)
ใช้ schema แบบแบนเดิม (`createBusyInputSchema`, `.strict()`) เพิ่มค่าใน enum ของ **สร้างเท่านั้น**:

```ts
// services/busy.ts — สร้าง: ['all_day','timed','daily'] · PATCH (updateBusyInputSchema) คงเดิม ['all_day','timed'] → ส่ง 'daily' ใน PATCH = VALIDATION
const createKindField = z.enum(['all_day', 'timed', 'daily']);
// ฟิลด์เดิมทั้งหมด: kind, startDate, endDate, startTime, endTime, tz?, title?, note?, hideDetail?  (.strict() → ไม่มี seriesId/userId/id ให้ส่ง)
```

| ฟิลด์ | `daily` |
|---|---|
| `startDate`, `endDate` | จำเป็น · วันแรก/วันสุดท้ายของช่วง (รวมปลาย) |
| `startTime`, `endTime` | จำเป็น · `HH:mm` ลงตัว 30 นาที · ใช้กับ **ทุกวัน** ในช่วง |
| `tz` | ไม่ส่ง = `DEFAULT_TZ` (Asia/Bangkok) เหมือนเดิม |
| `title`, `note`, `hideDetail` | ผ่าน `parseBusyTitle` / `parseBusyNote` ครั้งเดียว แล้วคัดลอกเหมือนกันทุกแถว |

`checkSchedule` : `daily` ต้องมี startDate/endDate/startTime/endTime ครบ (เหมือน `timed`) — ความต่างคือความหมาย: `timed` = `[startDate startTime, endDate endTime)` ช่วงเดียว · `daily` = ทุกวัน d ใน `[startDate, endDate]` → `[d startTime, d endTime)`

**กติกา validate (ลำดับตรวจ = ลำดับรายงาน error)** — ทั้งหมดอยู่ใน lib เวลา (§2) ยกเว้นเพดาน 300 (§3)
1. `tz` ถูกต้อง → ผิด = `INVALID_TIMEZONE`
2. `startDate`, `endDate` รูปแบบ + ปี 2000–2100 → `INVALID_DATE` / `DATE_OUT_OF_RANGE` (field ตามช่อง)
3. `endDate < startDate` → `INVALID_RANGE {field:'endDate', kind:'dates'}`
4. `startTime`, `endTime` รูปแบบ → `VALIDATION {fields:{startTime|endTime:'INVALID'}}` · ไม่ลงตัว 30 → `TIME_NOT_ON_STEP`
5. **นาทีของ `endTime` ≤ `startTime`** → `INVALID_RANGE {field:'endTime', kind:'time'}` (ไม่รองรับข้ามเที่ยงคืน — contract §3) · หมายเหตุ: `parseTimeOfDay` รับถึง `23:59` เท่านั้น → จบช้าสุด `23:30` (ดู §10 ข้อ 3)
6. จำนวนวัน `spanDays(startDate, endDate) > BUSY_MAX_TIMED_DAYS (62)` → `LIMIT_REACHED {limit:'busySpan', max:62}` status 400 (รหัสเดิม)
7. **ย้อนหลัง**: วันแรก `startDate < earliestAllowedDate(now, tz, 7)` → `LIMIT_REACHED {limit:'busyBackdate', max:7}` status 400 · เหตุผล: กติกาเดิม (`isTooFarBack`) ตัดสินจากวันจบของ "แต่ละแถว" — แถววันแรกของชุดคือแถวที่เก่าที่สุด ถ้าแถวนั้นผิด = ชุดผิด ⇒ ไม่สร้างสักวัน (contract §1 "เกินเพดานใดๆ → ไม่สร้างเลย")
8. แปลงทุกวันเป็น UTC (§2) → วันใดตกใน DST gap = `INVALID_LOCAL_TIME {field:'startTime'|'endTime'}` ทั้งคำขอ
9. เพดาน 300 (รวมแถวเดิม + N) → `LIMIT_REACHED {limit:'busyCount', max:300}` status เดิมของ `limitCount()` (§3)

ไม่มีรหัส error ใหม่ (R6F-4 "รหัส error เดิม") · `busyInputError(e, kind)` ขยายพารามิเตอร์ `kind` เป็น `'all_day' | 'timed' | 'daily'` : `SPAN_TOO_LONG` ของ `daily` → `max: BUSY_MAX_TIMED_DAYS` · `INVALID_RANGE` ของ `daily` → `kind: field === 'endDate' ? 'dates' : 'time'`

**Response** (201):
```ts
// kind all_day / timed — เดิมทุกไบต์ (R6F-1): { busy: BusyOwnView }
// kind daily:
{ seriesId: string | null; count: number; items: BusyOwnView[] }   // items เรียง startAt · count = items.length = N
```
ใช้ key `items` (ไม่ใช่ `busy`) เพื่อไม่ให้ key เดียวกันมีสองชนิด · frontend ปัจจุบันเช็กแค่ `res.ok` (`BusyFormSheet.tsx` submit) จึงไม่กระทบ

### 2. การขยายเป็นรายวัน — `src/lib/calendar` (pure, กฎ 9)
เพิ่มใน `src/lib/calendar/busy.ts` และ export จาก `index.ts`:

```ts
export interface DailyBusyInput {
  kind: 'daily';
  startDate: DateISO; endDate: DateISO;   // รวมปลาย
  startTime: string;  endTime: string;    // HH:mm ลงตัว 30 · end > start (นาทีในวันเดียวกัน)
  tz?: string;
}
export interface DailyBusyOptions {
  now?: EpochMs;            // จำเป็นเมื่อมี maxBackdateDays
  maxDays?: number;         // จำนวนวันปฏิทินสูงสุด (R6F: BUSY_MAX_TIMED_DAYS = 62)
  maxBackdateDays?: number; // R6F: 7
}
export type ExpandDailyBusyResult = { ok: true; value: BusyRow[] } | { ok: false; error: BusyInputError };

/** ตรวจ + ขยายเป็นแถวละวัน (ไม่โยน — คืน Result แบบเดียวกับ normalizeBusyInput) */
export function expandDailyBusyInput(input: DailyBusyInput, options?: DailyBusyOptions): ExpandDailyBusyResult;
```

อัลกอริทึม (ใช้ฟังก์ชันที่มีอยู่แล้วเท่านั้น — ไม่คำนวณวันด้วย string/`new Date()`):
1. ตรวจตาม §1 ข้อ 1–7 ด้วย `assertTimeZone`, `toPlainDate(..., {range:true, field})`, `parseTimeOfDay`, `STEP_MINUTES`, `exceedsMaxSpan`, `isTooFarBack(startDate, now, tz, maxBackdateDays)`
2. `for (const d of eachDate(startDate, endDate))` →
   `startAt = parseLocalDateTime(d, startTime, tz)` · `endAt = parseLocalDateTime(d, endTime, tz)` (ห่อ field เป็น `startTime`/`endTime` แบบ `localToEpoch` เดิม)
3. แต่ละแถว `{ allDay:false, startAt, endAt, localStartDate: d, localEndDate: toLocal(endAt - 1, tz).date, tz }` — สูตร localEndDate เดียวกับ `normalizeTimed` (จึงได้ `= d` เสมอเมื่อไม่ข้ามเที่ยงคืน) · เก็บ UTC (`start_at`/`end_at`) + วันท้องถิ่นแยก (กฎ 9, ADR 0004 §2)
4. failsafe: `failIf(endAt <= startAt, 'INVALID_RANGE', 'endTime')` ต่อแถว (ไม่ควรเกิดหลังข้อ 1 แต่กัน tz แปลก)

**เขตเวลา / DST**
- Asia/Bangkok ไม่มี DST (UTC+7 คงที่) → ทุกแถวยาวเท่ากัน · แต่ `tz` มาจากผู้เรียกได้ (IANA ใดก็ได้) จึงต้องถูกต้องเมื่อมี DST:
- **คำนวณ UTC ทีละวันจากเวลาผนัง** (ไม่ใช่ "วันแรก + k×24 ชม.") → ข้ามวันเปลี่ยนเวลาแล้ว 17:00 ยังเป็น 17:00 ท้องถิ่น
- DST gap (เวลาไม่มีจริง) → `INVALID_LOCAL_TIME` **ทั้งคำขอ** (สอดคล้องกับ `parseLocalDateTime` และ "ทั้งหมดหรือไม่มีเลย") — ไม่เลื่อนเวลาเอง (`dayWindow` เลื่อนไปข้างหน้า แต่นั่นใช้กับหน้าต่างของกลุ่ม ไม่ใช่ข้อมูลที่ผู้ใช้กรอก)
- DST fold (เวลาเกิดสองครั้ง) → ครั้งแรก (`disambiguation: 'earlier'` เดิม)
- ความยาวจริงของแถวในวันเปลี่ยนเวลาอาจต่างจากวันอื่น ±1 ชม. — ถูกต้องตามเวลาผนัง

**เทสต์ขอบที่ platform ต้องมี** (`tests/calendar/**`): 3–30 พ.ย. 2026 17:00–20:00 BKK = 28 แถว, แถวแรก `start_at = Date.UTC(2026,10,3,10)` (R6F-2) · วันเดียว (start=end) = 1 แถว · 62 วันผ่าน / 63 วัน `SPAN_TOO_LONG` · end = start → `INVALID_RANGE` · end < start → `INVALID_RANGE` · ย้อนหลังวันที่ 7 ผ่าน / วันที่ 8 `TOO_FAR_BACK` · ข้ามเดือน/ปี/29 ก.พ. ปีอธิกสุรทิน · `America/New_York` ช่วงครอบ 2026-03-08 (gap 02:00–03:00: 02:30–03:30 → `INVALID_LOCAL_TIME`, 17:00–20:00 → ผ่าน และ UTC offset วันก่อน/หลังต่างกัน 1 ชม.) · ช่วงครอบ 2026-11-01 (fold 01:00–02:00 → earlier) · `Australia/Lord_Howe` (DST 30 นาที) อย่างน้อย 1 เคส

### 3. เพดาน 300 + transaction — คำสั่งเดียว N แถว ไม่มี check-then-act
เพิ่มใน `src/lib/data/repos/busy.ts`:

```ts
/** เพิ่ม N แถว (ชุดเดียว) ถ้าผู้ใช้ active และ windowCount + N <= cap — คำสั่ง INSERT … SELECT เดียว · คืน null = ถูกปฏิเสธ (ไม่มีแถวใดถูกเขียน) */
export async function insertBusySeriesIfUnderCap(
  db: DbOrTx,
  input: { userId: string; seriesId: string | null; cap: number; shared: Pick<BusyWrite,'title'|'note'|'hideDetail'|'tz'>;
           rows: { id: string; startAt: number; endAt: number; localStartDate: string; localEndDate: string }[] },
  now: number,
): Promise<OwnBusyRow[] | null>;
```

SQL (ร่าง):
```sql
WITH v(id, start_at, end_at, local_start_date, local_end_date) AS (VALUES (?,?,?,?,?), (?,?,?,?,?), …)   -- N แถว · 5 พารามิเตอร์/แถว
INSERT INTO busy_block (id, user_id, series_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at)
SELECT v.id, :userId, :seriesId, :title, :note, 0, v.start_at, v.end_at, v.local_start_date, v.local_end_date, :tz, :hide, :now, :now
FROM v
WHERE EXISTS (SELECT 1 FROM user WHERE id = :userId AND status = 'active')
  AND (SELECT count(*) FROM busy_block WHERE user_id = :userId AND end_at > :windowStart) + :n <= :cap
RETURNING id;
```
- เงื่อนไขใน WHERE **ไม่ขึ้นกับแถวของ v** (subquery ไม่ correlated) → ผลเป็นจริงทั้ง N หรือเท็จทั้ง N · `+ :n <= :cap` คือรูปทั่วไปของ `count < cap` เดิม (N=1) · ใช้ `windowCount`/`busyWindowStart` ตัวเดิม (ห้ามเขียนสูตรหน้าต่างซ้ำ)
- ผู้เรียกตรวจ `rows.length === N` ไม่งั้น **throw ใน `inTx`** → rollback ทั้งก้อน (กันกรณีคาดไม่ถึง เช่น id ชน PK) · เท่ากับ N แล้วอ่านกลับด้วย `WHERE user_id = ? AND id IN (…)` เรียง `start_at`
- พารามิเตอร์สูงสุด = 62 × 5 + 9 ≈ 319 < 999 (ค่า SQLITE_MAX_VARIABLE_NUMBER ของ SQLite ก่อน 3.32 — ต่ำสุดที่เป็นไปได้) จึงไม่ต้องแบ่ง batch [S3]
- `RETURNING` ใช้ได้ตั้งแต่ SQLite 3.35.0 และ repo ใช้อยู่แล้ว [S4]
- **ห้ามมีคำสั่ง SELECT ก่อน INSERT นี้ใน transaction เดียวกัน**: ใน SQLite ธุรกรรม DEFERRED ที่เริ่มด้วย SELECT จะได้ read transaction แล้วอัปเกรดเป็นเขียนไม่ได้ (SQLITE_BUSY) ถ้ามีอีก connection เขียนก่อน · ถ้าคำสั่งแรกเป็นการเขียน จะได้ write transaction ทันที และ count ถูกอ่านภายใต้ล็อกเขียน [S5] — ตรงกับ `createBusy` เดิมที่ INSERT เป็นคำสั่งแรก · การวินิจฉัยหลังถูกปฏิเสธ (`whyRejected`) อ่านทีหลังได้ตามเดิม
- **ยิงพร้อมกัน 2 คำขอ (R6F-5)**: ใน process เดียว `inTx` ต่อคิวด้วย `serialized` → คำขอที่สองเห็น count หลังคำขอแรก commit · ข้าม process (Turso) SQLite มีผู้เขียนทีละคน คำสั่งที่สองเห็นแถวของคำสั่งแรก หรือได้ BUSY → `CONFLICT` (ลองใหม่ได้) — ไม่มีทางที่ทั้งสองผ่านแล้วรวมเกิน 300 · เทสต์: เติม 250 แถว แล้วยิง daily 28 วัน 2 คำขอพร้อมกัน (`Promise.all`) → สำเร็จ 1 ล้ม 1 ด้วย `busyCount` · count สุดท้าย = 278
- **ล้มกลางทาง (R6F-5)**: เทสต์จำลองด้วยการให้ `rows` มี id ซ้ำกับแถวที่มีอยู่ (PK ชน) หรือ stub ที่ throw หลัง INSERT ภายใน `inTx` → ตรวจว่าไม่มีแถวของ seriesId นั้นเหลือ
- service `createBusy` สำหรับ `daily`:
  `authorize(actor,'busy.create',{type:'none'})` → `expandDailyBusyInput(...)` (ไม่ผ่าน → `busyInputError(e,'daily')`) → title/note → `seriesId = N >= 2 ? newId() : null` → `inTx(insertBusySeriesIfUnderCap)` → null ⇒ `whyRejected` (เดิม: เต็ม → `LIMIT_REACHED busyCount`, อื่น → `CONFLICT`)
- **N = 1 (วันเดียว) → `series_id = NULL`** : ชุดหนึ่งแถวไม่มีประโยชน์ และทำให้แถวนั้นหน้าตา/พฤติกรรมเหมือน `timed` ทุกอย่าง (ไม่มีป้าย "ชุด", ไม่มี "ลบทั้งชุด")

### 4. Migration `0003` — `busy_block.series_id`
`src/db/schema.ts` (busyBlock):
```ts
seriesId: text('series_id'),   // nullable · uuid ที่เซิร์ฟเวอร์สร้างตอน POST kind:'daily' (N≥2) · ไม่มี FK (ไม่มีตารางชุด — §9 ทางเลือก B)
// ใน index list:
index('busy_user_series_idx').on(t.userId, t.seriesId).where(sql`${t.seriesId} is not null`),
```
DDL ร่าง (`drizzle/0003_r6f_busy_series.sql`):
```sql
-- R6F: ชุด busy รายวัน · nullable ไม่ backfill · ADD COLUMN ไม่ rebuild ตาราง
ALTER TABLE `busy_block` ADD `series_id` text;--> statement-breakpoint
CREATE INDEX `busy_user_series_idx` ON `busy_block` (`user_id`,`series_id`) WHERE "busy_block"."series_id" is not null;
```
- ใช้ `npm run db:generate` แล้ว **ตรวจว่า SQL ที่ได้เป็น `ALTER TABLE … ADD` ไม่ใช่สร้างตารางใหม่ + copy** (บทเรียน 0002 ที่ drizzle-kit 0.31.11 generate ผิดแล้วต้องเขียนเอง — ดูหัวไฟล์ `drizzle/0002_*.sql`) · snapshot `meta/0003_snapshot.json` + `_journal.json` ต้องตรงกับ schema (`npm run db:check`)
- ADD COLUMN แบบ nullable ไม่มี default ไม่มี constraint = อยู่ในเงื่อนไขที่ SQLite อนุญาต (ห้ามเฉพาะ PK/UNIQUE/NOT NULL ไม่มี default ฯลฯ) [S1]
- partial index `WHERE series_id IS NOT NULL`: แถวเดิมทั้งหมด (NULL) ไม่เข้า index → index เล็ก · คิวรีที่มี `series_id = ?` ใช้ index นี้ได้ (กติกา "comparison operator on z other than IS" ⇒ สอดคล้อง `z IS NOT NULL`) [S2]
- **ผลกับข้อมูลเดิม**: ทุกแถวเดิมได้ `series_id = NULL` = รายการเดี่ยว พฤติกรรมเดิมทุกอย่าง · ไม่ backfill (ไม่เดาว่าแถวเก่าแถวไหนเป็นชุด — กฎ 8)
- **ลำดับ deploy**: migrate ก่อน deploy ปลอดภัย — โค้ดรุ่นเดิม `select()` ตามรายชื่อคอลัมน์ใน schema ของตัวเอง (ไม่อ่าน `series_id`) และ INSERT เดิมไม่ระบุ `series_id` → NULL · ใช้ขั้นตอน OPERATIONS B6 (prod) + B7 (preview) ก่อน merge แบบเดียวกับหมายเหตุ R6C (`docs/OPERATIONS.md` บรรทัด 85–88) — ops เพิ่มหมายเหตุ R6F
- **Rollback**
  1. ย้อนแอปอย่างเดียว (Vercel Instant Rollback) **พอ** — รุ่นเดิมทำงานกับฐานที่มีคอลัมน์ใหม่ได้ (ข้อบน) · แถวชุดที่สร้างไปแล้วยังเป็น busy timed ปกติ ลบทีละวันได้
  2. ถ้าต้องถอดคอลัมน์จริง (ไม่แนะนำ ทำเมื่อ boss สั่งเท่านั้น): ลบ index ก่อน เพราะ DROP COLUMN ล้มถ้าคอลัมน์ถูก index [S1]
     ```sql
     DROP INDEX IF EXISTS `busy_user_series_idx`;
     ALTER TABLE `busy_block` DROP COLUMN `series_id`;   -- ต้องการ SQLite ≥ 3.35.0 [S4]
     DELETE FROM `__drizzle_migrations` WHERE hash = '<hash ของ 0003>';  -- ให้ตรวจชื่อตาราง/แถวจริงก่อน — ยังไม่ยืนยัน (§11)
     ```
     ผล: เสียแค่ "การจัดกลุ่มเป็นชุด" แถว busy ทุกแถวยังอยู่
- เทสต์ `tests/platform/migration-0003.test.ts` ตามแบบ `migration-0002.test.ts`: apply ถึง 0002 → ใส่ busy เดิม → apply ทั้งโฟลเดอร์ → แถวเดิมครบ, `series_id` NULL, มี index `busy_user_series_idx` (`pragma index_list`), CHECK `busy_range_ck` เดิมยังทำงาน

### 5. ลบ / แก้
**ลบ**: `DELETE /api/me/busy/:id` (เดิม = ลบวันนี้) · `DELETE /api/me/busy/:id?scope=series` = ลบทั้งชุด
- query schema: `deleteBusyQuerySchema = z.object({ scope: z.enum(['one','series']).optional() }).strict()` (ไม่ส่ง = `'one'`) · ค่าแปลก/คีย์แปลก → `VALIDATION`
- `route()` ปัจจุบันอ่าน `input` จาก query **เฉพาะ GET** (non-GET อ่าน JSON body — `src/app/api/_lib/route.ts` บรรทัด ~255) → ทางที่อยู่ในขอบเขต contract: ใน handler ของ `src/app/api/me/busy/[id]/route.ts` parse `Object.fromEntries(new URL(req.url).searchParams)` ด้วย schema นี้ ผิด → `throw new AppError('VALIDATION', { fields: { scope: 'INVALID' } })` (ไม่สะท้อนค่าที่ส่งมา) · ทางเลือกที่สะอาดกว่าแต่แตะไฟล์นอกรายการ contract อยู่ใน §10 ข้อ 2
- repo `deleteOwnBusySeries(db, id, userId): Promise<number>` — คำสั่งเดียว:
  ```sql
  DELETE FROM busy_block
  WHERE user_id = :me
    AND (id = :id OR (series_id IS NOT NULL AND series_id = (SELECT series_id FROM busy_block WHERE id = :id AND user_id = :me)))
  RETURNING id;
  ```
  เจ้าของเท่านั้นด้วยโครงสร้าง (ทั้งสองชั้นผูก `user_id = ผู้กระทำ`) · id ของคนอื่น/ไม่มี → 0 แถว → `NOT_FOUND` (IDOR เท่าเดิม) · แถวที่ไม่มีชุด (`series_id` NULL) + `scope=series` → ลบแถวนั้นแถวเดียว (ไม่ error — idempotent กับ UI ที่ข้อมูลเก่า) · ลบทุกแถวของชุดรวมวันที่ผ่านไปแล้ว (contract "ลบทั้งชุด")
- response: `{ deleted: true, count: number }` ทั้งสอง scope (`one` → 1) · `count` บอกเจ้าของเท่านั้น ใช้แสดง "ลบแล้ว 28 วัน" · เพิ่มฟิลด์ใหม่ไม่ทำให้ client เดิมพัง (เช็กแค่ `res.ok`)
- ลบวันเดียวในชุด = `deleteOwnBusy` เดิม (วันอื่นไม่กระทบ — R6F-6)

**แก้วันเดียว = หลุดจากชุด**: `updateBusy` ตั้ง `seriesId: null` ใน `next` **ทุกครั้งที่ PATCH สำเร็จ** (แม้แก้แค่ชื่อ) — ตรงกับ contract "แก้วันไหนวันนั้นหลุดจากชุด" และคาดเดาได้ (ไม่ต้องนิยามว่าแก้อะไรถึงหลุด) · `BusyWrite` เพิ่ม `seriesId?: string | null` (insert เดี่ยวเดิมไม่ส่ง = NULL) · เพดานของ update ไม่เปลี่ยน · ถ้าชุดเหลือแถวเดียวหลังแก้/ลบ ไม่ต้องทำอะไร (ชุด 1 แถวยังลบทั้งชุดได้ = ลบแถวนั้น) · แก้ทั้งชุดทีเดียว **ไม่ทำรอบนี้** (contract §3)

### 6. DTO / ความเป็นส่วนตัว (ADR 0006)
| ผู้ดู | `seriesId` |
|---|---|
| เจ้าของ (`BusyOwnView` — `GET/POST/PATCH /api/me/busy*`) | **มี** `seriesId: string \| null` |
| สมาชิกกลุ่ม / super admin ผ่านกลุ่ม (`toBusyForViewers`, ปฏิทิน, วันว่าง, เตือนนัดทับ) | **ไม่มี key เลย** (ไม่ใช่ null) — ไม่ว่า `hideDetail` เป็นอะไร |

เหตุผล
1. **ไม่มีใครนอกจากเจ้าของต้องใช้** — UI ของคนอื่นแสดงแค่ช่วงไม่ว่าง (+ชื่อถ้าไม่ซ่อน) · ปุ่ม "ลบทั้งชุด" มีแต่เจ้าของ · allowlist ADR 0006 เพิ่มเมื่อมีความจำเป็นเท่านั้น
2. **ตัวเชื่อมโยงรายการซ่อน**: `seriesId` บอกว่า "รายการซ่อนเหล่านี้คือกิจกรรมเดียวกันที่ทำประจำ" ซึ่งมากกว่าที่ช่วงเวลาบอก (สองรายการเวลาเดียวกันทุกวันอาจเป็นคนละเรื่อง) — contract R6F-7 ขอขั้นต่ำ "ไม่รู้ว่าเป็นชุดถ้าเจ้าของซ่อนชื่อ" · ADR นี้เลือก **ไม่ส่งเลยทุกกรณี** เพราะง่ายกว่าและไม่มีเงื่อนไขให้พลาด
3. **ไม่มีช่องรั่วทางอ้อม**: `id` เป็น UUIDv4 สุ่ม (ไม่ใช่ v7/เรียงเวลา) จึงเดาความเป็นชุดจาก id ไม่ได้ · `created_at`/`updated_at` ไม่ถูกส่งให้คนอื่นอยู่แล้ว (serializer หัวไฟล์) จึงเดาจาก "สร้างพร้อมกัน" ไม่ได้
4. ข้อจำกัดที่ยอมรับ: คนในกลุ่มยัง **เห็นรูปแบบ** "ไม่ว่าง 17:00–20:00 ทุกวัน" จากเวลาเอง — เท่ากับผู้ใช้ลงเองทีละวัน (ไม่ใช่การรั่วใหม่)

การ implement: `sharedBusyInGroupQuery` **ไม่ SELECT `series_id`** (เหมือน `note`) · `SharedBusyRow`/`BUSY_SHARED_FIELDS` ไม่เปลี่ยน · `toBusyOwnView` เพิ่ม `seriesId: r.seriesId` · เทสต์ serializer/canary (แบบ ADR 0006 test 9): `.toSQL()` ของ query ฝั่งแชร์ไม่มี `series_id` และ JSON ปฏิทิน/วันว่างของคนอื่นไม่มี key `seriesId`

### 7. ผลต่อปฏิทิน / วันว่าง (ADR 0005) — query เท่าเดิม
- แถวชุดคือ `busy_block` แบบ `all_day = 0` ธรรมดา → `sharedBusyInGroupQuery`, `commonFreeTime`, `membersBlockedDuring` **ไม่เปลี่ยนโค้ด** · เวลาก่อน 17:00 / หลัง 20:00 ของแต่ละวันว่างโดยอัตโนมัติ (R6F-3)
- จำนวนแถวต่อคนยังถูกจำกัด 300 (หน้าต่าง 8 วันย้อนหลัง + อนาคต) · กรณีหนักที่ตั้งใจ: 50 คน × 62 วัน × 1 แถว/วัน ≈ 3,100 แถว < `CALENDAR_MAX_ITEMS` 5,000 · เทสต์เดิม `tests/availability/availability-perf.test.ts` จำลองสถานการณ์นี้แล้ว (50 คน × 62 วัน ทุกคนทุกวัน ~3.2k แถว, เกณฑ์ < 200 ms) — ไม่ต้องเพิ่มเกณฑ์ใหม่ · กรณีเกิน (ทุกคนมีหลายชุดซ้อนกันจนเกิน 5,000 ในช่วงที่ดู) → `truncated: true` ตามกลไกเดิม (ความเสี่ยง F2 เดิม ไม่ใหม่)
- ADR 0005 / 0006 / 0009 **ไม่ต้องแก้เนื้อหา** — ADR นี้อ้างถึงเท่านั้น
- **E11 (R6E) กับชุด**: frontend เรียก `GET /api/me/busy?from=startDate&to=endDate` (ช่วง ≤ `CALENDAR_MAX_RANGE_DAYS` 62 = ครอบชุดได้พอดี, ≤ 1,000 แถว) แล้วใช้ **`expandDailyBusyInput` ตัวเดียวกับเซิร์ฟเวอร์** สร้างช่วงรายวันฝั่ง client เพื่อเช็ก `overlapsRange` ต่อวัน และใช้ `value.length` เป็นตัวเลขในสรุป "28 วัน · 17:00–20:00" → ตัวเลขฝั่ง UI กับเซิร์ฟเวอร์ตรงกันเสมอ · popup แสดงไม่เกิน 4 รายการ + "และรายการอื่นอีก" ตาม contract §1

### 8. Rate limit · RBAC · manifest
- **Rate limit**: contract §7 อ้าง "rate limit เดิมของ busy" แต่ **ไม่มีในโค้ด** (ตรวจ 2026-11-02: `src/lib/shared/limits.ts` มี limiter ของนัด/บัญชี/appearance/current-group/admin แต่ไม่มี busy · `services/busy.ts` ไม่เรียก bucket) · ปัจจุบันตัวคุมคือเพดาน 300 (จำนวนแถวที่ค้าง) แต่ **ไม่คุมอัตราเขียน**: วน POST daily 62 แถว ↔ DELETE scope=series ได้ไม่จำกัด = 62 INSERT + 62 DELETE ต่อรอบ · ข้อเสนอ (ให้ main ตัดสิน §10 ข้อ 1): `BUSY_WRITE_RATE_LIMITS` ใน `limits.ts` ใช้ `reserveBucket`/`refundBucket` แบบ `takeWriteSlots` ของนัด — `create` 30 ครั้ง/10 นาที/ผู้ใช้ (นับต่อคำขอ ทุก kind), `delete` 60 ครั้ง/10 นาที · เกิน → `RATE_LIMITED` + Retry-After (รหัสเดิม)
- **RBAC**: **ไม่เพิ่ม action** — สร้างชุด = `busy.create` (`anyUser`), ลบทั้งชุด = `busy.delete` (`ownerOnly` + คิวรีผูก `user_id`) · ความเป็นเจ้าของตัดสินที่ SQL ทุกแถว (§5) ไม่ใช่ที่ UI (กฎ 6) · SA ลบชุดของคนอื่นไม่ได้เหมือนเดิม (PRD §3 แถว 3)
- **manifest**: **ไม่เปลี่ยน** — method+path เดิม (`POST /api/me/busy`, `DELETE /api/me/busy/:id`) · query `?scope` ไม่ใช่ส่วนของ path · `tests/platform/manifest.test.ts` ควรผ่านโดยไม่แก้
- **ขนาดคำขอ/คำตอบ**: body ของ daily เท่ากับ timed (ไม่มี array จากผู้ใช้ — server เป็นคนขยาย) → ไม่มีช่อง "ส่ง 10,000 วัน" · response ≤ 62 `BusyOwnView`

### 9. ทางเลือกที่พิจารณา
| ทางเลือก | ข้อดี | ข้อเสีย | ผล |
|---|---|---|---|
| **A. แถวละวัน + `series_id` บน `busy_block`** | อัลกอริทึม/ปฏิทิน/serializer ฝั่งแชร์ไม่เปลี่ยน · migration แค่ ADD COLUMN · ลบชุดคำสั่งเดียว | N แถวกินเพดาน 300 · แก้ทั้งชุดต้องทำทีหลัง | **เลือก** (boss เลือก (ข) ใน contract §2) |
| B. ตาราง `busy_series` (title/note/เวลา) + FK | รองรับ "แก้ทั้งชุด" ในอนาคตตรงกว่า | ตารางใหม่ + join + พื้นผิวความเป็นส่วนตัวใหม่ · ชุดยังไม่มีคุณสมบัติของตัวเองในรอบนี้ (แก้ = หลุดจากชุด) | ไม่เลือกรอบนี้ — ถ้าทำ "แก้ทั้งชุด" ค่อยเพิ่มตารางโดยใช้ `series_id` เดิมเป็น PK ได้ |
| C. กฎทำซ้ำ (RRULE) แถวเดียว ขยายตอนอ่าน | 1 แถวต่อชุด | ต้องแก้ ADR 0005 + ทุก query ที่ใช้ `start_at/end_at` + index ใช้ไม่ได้ · ขัด contract §1 ("1 รายการต่อวัน") | ไม่เลือก |
| D. client ยิง POST timed ทีละวัน | ไม่ต้องแก้เซิร์ฟเวอร์ | ไม่ atomic (ขัด contract §1) · ไม่มีชุด | ไม่เลือก |

### 10. ข้อที่ให้ main ตัดสิน
1. **Rate limit ของ busy** (§8) — ยังไม่มีในโค้ดแม้ contract §7 อ้างว่ามี · ทางเลือก: (ก) เพิ่ม `BUSY_WRITE_RATE_LIMITS` รอบนี้ (ต้องให้ platform แตะ `src/lib/shared/limits.ts` ซึ่ง **ไม่อยู่ในรายการไฟล์ของ contract §4** — แต่ `services/busy*.ts` อยู่) ค่าเสนอ create 30/10 นาที, delete 60/10 นาที · (ข) ไม่เพิ่ม ยอมรับว่าตัวคุมคือเพดาน 300 + ขนาดสูงสุด 62 แถว/คำขอ แล้วบันทึกเป็นความเสี่ยงให้ security · architect แนะนำ (ก)
2. **ที่อ่าน `?scope`** (§5) — (ก) parse ใน handler ของ `src/app/api/me/busy/[id]/route.ts` (อยู่ในขอบเขต — ค่าเริ่มต้นของ ADR นี้) · (ข) เพิ่มตัวเลือก `query?: ZodSchema` ให้ `route()` ใน `src/app/api/_lib/route.ts` (ใช้ซ้ำได้, error VALIDATION ผ่านทางเดียวกับ input อื่น) แต่แตะไฟล์ที่ contract ไม่ได้ระบุ · (ค) เปลี่ยนเป็น `DELETE /api/me/busy/:id/series` (path ใหม่ + manifest) ซึ่งต่างจากที่ contract เขียน
3. **จบเที่ยงคืน (24:00)** — ช่องเวลารับ `HH:mm` ถึง 23:59 → ชุดรายวันจบช้าสุด 23:30 · รับ `endTime: "24:00"` สำหรับ daily ไหม (ต้องแก้ `parseTimeOfDay` หรือกรณีพิเศษ) · architect แนะนำ **ไม่รับรอบนี้** (สอดคล้อง "ไม่ข้ามเที่ยงคืน") ให้ ux ทำให้ตัวเลือกเวลาของ daily ไม่มี 24:00
4. **ลำดับรอบ**: contract บอก "เริ่มหลัง R6E merge" แต่ branch นี้แตกจาก `main` ที่ v0.8.0 (R6E ยังไม่ merge) · ส่วน platform/ADR ไม่ขึ้นกับ R6E · ส่วน frontend ที่ใช้ popup E11 ต้อง rebase บน R6E ก่อน
5. **ลบทั้งชุดรวมวันที่ผ่านไปแล้ว** — ADR นี้ลบทุกแถวของชุด (ตาม contract) · ถ้า boss อยากได้ "ลบตั้งแต่วันนี้เป็นต้นไป" เป็นงานรอบหน้า

## Consequences
- (+) "ว่างตรงกัน"/ปฏิทินถูกต้องทันทีโดยไม่แตะอัลกอริทึม · ความเป็นส่วนตัวฝั่งแชร์เท่าเดิม (ไม่มีฟิลด์ใหม่ออกนอกเจ้าของ)
- (+) atomic + เพดานคำสั่งเดียว ใช้รูปเดียวกับของเดิม ตรวจง่าย
- (−) ชุดยาวกินเพดาน 300 เร็ว (ชุด 62 วัน 4 ชุด = 248) — ผู้ใช้จะเจอ `LIMIT_REACHED busyCount` เร็วขึ้น · ux ต้องบอกจำนวนวันก่อนบันทึก
- (−) แก้ชื่อทีละวันทำให้ชุดแตก (ตั้งใจ) — ถ้าผู้ใช้อยากแก้ทั้งชุดต้องลบทั้งชุดแล้วลงใหม่ในรอบนี้

## 11. สิ่งที่ยังไม่ได้ยืนยัน
- รุ่น SQLite ของ libSQL/Turso ที่ใช้จริงบน prod ≥ 3.35 (จำเป็นเฉพาะ rollback ข้อ 2 — DROP COLUMN) · `RETURNING` ใช้อยู่แล้วใน repo จึงน่าจะ ≥ 3.35 แต่ไม่ได้เช็กกับฐานจริง
- drizzle-kit 0.31.11 generate partial index + ADD COLUMN ของรอบนี้เป็น ALTER ไม่ rebuild ตาราง — platform ต้องดูไฟล์ที่ generate จริง
- ชื่อตาราง/คอลัมน์บันทึก migration ของ drizzle (`__drizzle_migrations`, `hash`) ที่ใช้ใน rollback ข้อ 2 — ยังไม่ได้ตรวจกับฐานจริง
- การที่ SQLite ประเมิน scalar subquery แบบไม่ correlated ใน `INSERT … SELECT … FROM (VALUES)` **ครั้งเดียวก่อนเขียน** — เป็นพฤติกรรมที่คาดไว้ แต่ความถูกต้องของ ADR ไม่พึ่งข้อนี้: ถ้าประเมินทีละแถวจนได้ < N แถว ตัวตรวจ `rows.length === N` จะ throw + rollback · เทสต์ R6F-5 ต้องยืนยันด้วยกรณี "เหลือที่ว่างน้อยกว่า N" (เช่น 290 + 28) → 0 แถว ไม่ใช่ 10

## แหล่งอ้างอิง (เข้าถึง 2026-11-02)
- [S1] SQLite — ALTER TABLE (ADD COLUMN restrictions; DROP COLUMN fails if "The column is indexed") — https://www.sqlite.org/lang_altertable.html
- [S2] SQLite — Partial Indexes ("If a term in X is of the form z IS NOT NULL and if a term in W is a comparison operator on z other than IS, then those terms match") — https://www.sqlite.org/partialindex.html
- [S3] SQLite — Limits §17 SQLITE_MAX_VARIABLE_NUMBER: 999 ก่อน 3.32.0 (2020-05-22), 32766 หลังจากนั้น — https://www.sqlite.org/limits.html
- [S4] SQLite 3.35.0 release log (2021-03-12): เพิ่ม ALTER TABLE DROP COLUMN และ RETURNING — https://www.sqlite.org/releaselog/3_35_0.html
- [S5] SQLite — Transaction (DEFERRED: คำสั่งแรกเป็นการเขียน → write transaction ทันที; เริ่มด้วย SELECT แล้วอัปเกรดอาจได้ SQLITE_BUSY) — https://www.sqlite.org/lang_transaction.html
- โค้ดในรีโป (ตรวจ 2026-11-02 บน `main` 37271af): `src/lib/calendar/{busy,zone,limits,date,constants}.ts` · `src/lib/data/repos/busy.ts` · `src/lib/data/services/busy.ts` · `src/lib/data/serializers/busy.ts` · `src/lib/data/tx.ts` · `src/lib/shared/{limits,id}.ts` · `src/db/schema.ts` · `drizzle/0000–0002` · `src/app/api/_lib/{route,manifest}.ts` · `src/app/api/me/busy/**` · `tests/availability/availability-perf.test.ts` · `tests/platform/migration-0002.test.ts` · `docs/OPERATIONS.md` B6/B7
