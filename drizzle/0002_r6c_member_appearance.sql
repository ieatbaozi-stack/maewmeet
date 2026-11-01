-- R6C F3ก: สี/รูปทรงที่สมาชิกเลือกเองต่อกลุ่ม · nullable (NULL = hash เดิม) · ไม่ backfill
-- เขียนแทน SQL ที่ drizzle-kit 0.31.11 generate (สร้างตารางใหม่ + INSERT ... SELECT "color_slot" จากตารางเดิมที่ยังไม่มีคอลัมน์ → no such column)
-- ADD COLUMN + CHECK ระดับคอลัมน์ ให้ผลเท่ากับ check() ใน schema.ts/snapshot และไม่ต้อง rebuild ตาราง/ปิด foreign_keys
ALTER TABLE `group_member` ADD `color_slot` integer CONSTRAINT `group_member_color_slot_ck` CHECK(`color_slot` is null or (typeof(`color_slot`) = 'integer' and `color_slot` between 1 and 10));--> statement-breakpoint
ALTER TABLE `group_member` ADD `shape_slot` integer CONSTRAINT `group_member_shape_slot_ck` CHECK(`shape_slot` is null or (typeof(`shape_slot`) = 'integer' and `shape_slot` between 1 and 10));
