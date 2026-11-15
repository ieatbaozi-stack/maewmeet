# ADR 0013 — ลบตาราง `place_search_cache` ใน migration 0006 (ย้อนไม่ได้)

- **Status**: Accepted (2026-11-15) · boss ตัดสิน B8 = **ลบ** ใน [R15_CONTRACT](../contracts/R15_CONTRACT.md) §1.5, §7 · เสนอโดย Architect 2026-11-15
- **ต่อยอด/แทนที่บางส่วน**: [ADR 0001](0001-stack-and-project-structure.md) (proxy Nominatim + cache) — ส่วน cache สิ้นสุด · [R13_CONTRACT](../contracts/R13_CONTRACT.md) §1.3 (เอาการค้นหาสถานที่ออก, B3 คงตารางไว้รอ migration ถัดไป)
- **เจ้าของการ implement**: Platform (`src/db/schema.ts`, `drizzle/0006_*`, `src/lib/data/repos/maintenance.ts`, เทสต์) · Ops (OPERATIONS + CHANGELOG Upgrade notes) · ตรวจโดย QA + Security

## Context
- R13 เอา `GET /api/places/search` และ Nominatim ออกแล้ว · ตาราง `place_search_cache` ไม่มีทางเขียนเหลือ มีแต่ cron ล้างแถวเก่า (`maintenance.ts` งาน `stalePlaceSearchCache`, เก็บ 30 วัน) — ตรวจโค้ดบน `feat/r15a-feedback` 2026-11-15: อ้างถึงใน `src/db/schema.ts`, `src/lib/data/repos/maintenance.ts`, `tests/platform/cron.test.ts`, `tests/platform/schema.test.ts` และ snapshot ของ drizzle เท่านั้น
- ข้อมูลในตารางเป็นแค่ผลค้นหาที่ cache ไว้ (ชื่อสถานที่ + พิกัดจาก OSM) ไม่ผูกผู้ใช้ ไม่มี FK ชี้เข้า · cron ลบแถวที่เก่ากว่า 30 วันมาตั้งแต่ R13 (2026-11-11) จึงคาดว่าเหลือน้อยหรือว่าง — **ยังไม่ได้ตรวจฐานจริง** (กฎ 8 ห้ามเดา)

## Decision
1. migration `0006` (ไฟล์เดียวกับการเพิ่ม `groups.icon`) มี `DROP TABLE place_search_cache;` (drizzle-kit generate จากการลบ `placeSearchCache` ใน schema) · ลำดับในไฟล์ไม่สำคัญเพราะไม่มี FK เกี่ยวกัน
2. ลบใน PR เดียวกัน: export `placeSearchCache` ใน schema · งาน `stalePlaceSearchCache` + `RETENTION.placeSearchCacheMs` ใน `maintenance.ts` · คีย์ใน `tests/platform/cron.test.ts` และตารางใน `tests/platform/schema.test.ts` · เทสต์ migration ใหม่ยืนยันว่าตารางหายและตารางอื่นข้อมูลเท่าเดิม (R15-1)
3. ผลต่อ cron: ชื่องานใน response/log ของ `/api/cron/daily` หายไปหนึ่งรายการ (`MaintenanceTask` เป็น `keyof` ของ statements) · ไม่มีระบบภายนอกอ่านชื่องานนี้ (ops ยืนยันใน OPERATIONS)
4. ไม่ export/backup ข้อมูลตารางนี้เป็นพิเศษ — เป็น cache ที่สร้างใหม่ไม่ได้แล้วและไม่มีคุณค่าต่อผู้ใช้ · ถ้า boss อยากเก็บ ใช้ backup ปกติของ Turso ก่อนรัน (ops เขียนวิธีใน OPERATIONS ถ้ามี)

## Consequences
- **ย้อนไม่ได้**: หลังรัน 0006 ตารางและข้อมูลหาย · **rollback = ย้อนแอปอย่างเดียว** (deploy รุ่นก่อนหน้า) โดยตารางหายถาวร
  - รุ่นก่อนหน้า (v0.12.0) ยังมีงาน cron `stalePlaceSearchCache` (`DELETE FROM place_search_cache …`) และ `runDailyMaintenance` รันงานเก็บกวาดทั้งหมดใน `db.batch` เดียวแบบ atomic (`src/lib/data/services/maintenance.ts` — heartbeat เขียนแยกก่อน) → บนฐานที่ไม่มีตาราง คาดว่า batch ทั้งชุดล้ม = **งานล้างทุกข้อของวันนั้นไม่ทำ** (session/rate limit/notification/busy เก่าค้าง) แต่ heartbeat ยังเขียน · อ่านจากโค้ด **ยังไม่ได้รันจริง**
  - ทางแก้ถ้าต้อง rollback นานเกินวัน: สร้างตารางเปล่ากลับด้วย SQL `CREATE TABLE` จาก `drizzle/0000_init.sql` (ไม่ต้องมีข้อมูล) — ops ใส่คำสั่งนี้ใน OPERATIONS เป็นขั้นตอน rollback · ไม่ต้องแก้ `__drizzle_migrations`
  - คอลัมน์ `groups.icon` ที่เพิ่มในไฟล์เดียวกันไม่กระทบรุ่นเดิม (รุ่นเดิมไม่อ่านคอลัมน์ — เหมือน ADR 0012 §5)
- CHANGELOG ต้องมี **Upgrade notes** (R15 §1.5): รันกับ boss บน preview ก่อนเปิด PR → prod ก่อน merge · บอกว่าย้อนไม่ได้ + ขั้นตอน rollback ข้างบน
- เอกสาร: `docs/design/ARCHITECTURE.md` §3, §5, §8 ทำเครื่องหมายว่าลบแล้ว (architect, รอบนี้)

## ทางเลือกที่ไม่เลือก
- **คงตารางไว้ต่อ** — ไม่มีประโยชน์ เหลือ cron ที่ทำงานเปล่า และ schema ไม่ตรงความจริง (boss เลือกลบ B8)
- **ลบใน migration แยก (0007)** — เพิ่มรอบรัน migration กับ boss โดยไม่จำเป็น · R15a ต้องรัน 0006 อยู่แล้ว

## ยืนยันแล้ว / ยังไม่ยืนยัน
- ยืนยันแล้ว (อ่านโค้ด 2026-11-15, ไม่ได้รันเทสต์): ตำแหน่งที่อ้างถึงตารางตามรายการใน Context · ไม่มี FK ชี้เข้าตาราง (`src/db/schema.ts`) · ไม่มี route ใดเขียนตารางนี้แล้ว
- ยังไม่ยืนยัน: จำนวนแถวในฐาน prod/preview · ผลจริงของ cron รุ่นเดิมเมื่อไม่มีตาราง (คาดจากโค้ดว่า batch ล้มทั้งชุด — ไม่ได้รัน)

## แหล่งอ้างอิง (เข้าถึง 2026-11-15)
- SQLite — DROP TABLE ("The dropped table is completely removed from the database schema and the disk file. The table can not be recovered.") — https://www.sqlite.org/lang_droptable.html
- โค้ดในรีโป: `src/db/schema.ts` · `src/lib/data/repos/maintenance.ts` · `src/lib/data/services/maintenance.ts` · `tests/platform/{cron,schema}.test.ts` · `drizzle/0000_init.sql`
