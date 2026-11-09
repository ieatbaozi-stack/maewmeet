-- R10 §4 / ADR 0011 §2: ตาราง appointment_reminder, line_link_code + appointment.scheduled_at
-- สร้างจาก drizzle-kit generate แล้วเพิ่มมือเฉพาะคำสั่ง UPDATE ท้ายไฟล์ (backfill ข้อมูลเดิม — drizzle-kit ไม่สร้างคำสั่งข้อมูล) · snapshot/journal มาจาก drizzle-kit
-- NOT NULL DEFAULT 0: เข้ากันได้ย้อนหลัง รันก่อน merge ได้ · โค้ดรุ่นเก่าที่ INSERT โดยไม่ใส่คอลัมน์นี้ไม่พัง (0 = ไม่ข้ามการเตือน) · เพิ่มอย่างเดียว ไม่ลบ/เปลี่ยนคอลัมน์เดิม
CREATE TABLE `appointment_reminder` (
	`appointment_id` text NOT NULL,
	`kind` text NOT NULL,
	`start_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`appointment_id`, `kind`, `start_at`),
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "appointment_reminder_kind_ck" CHECK("appointment_reminder"."kind" in ('appointment.reminder_1d','appointment.reminder_1h','appointment.rsvp_nudge'))
);
--> statement-breakpoint
CREATE TABLE `line_link_code` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `line_link_code_hash_uq` ON `line_link_code` (`code_hash`);--> statement-breakpoint
CREATE INDEX `line_link_code_user_idx` ON `line_link_code` (`user_id`);--> statement-breakpoint
CREATE INDEX `line_link_code_expires_idx` ON `line_link_code` (`expires_at`);--> statement-breakpoint
ALTER TABLE `appointment` ADD `scheduled_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `appointment` SET `scheduled_at` = `created_at`;
