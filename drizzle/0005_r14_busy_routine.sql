CREATE TABLE `busy_routine` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`note` text,
	`hide_detail` integer DEFAULT false NOT NULL,
	`all_day` integer NOT NULL,
	`weekdays` integer NOT NULL,
	`start_min` integer,
	`end_min` integer,
	`range_kind` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`tz` text DEFAULT 'Asia/Bangkok' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "busy_routine_weekdays_ck" CHECK(typeof("busy_routine"."weekdays") = 'integer' and "busy_routine"."weekdays" between 1 and 127),
	CONSTRAINT "busy_routine_range_kind_ck" CHECK("busy_routine"."range_kind" in ('weeks','months')),
	CONSTRAINT "busy_routine_dates_ck" CHECK("busy_routine"."end_date" >= "busy_routine"."start_date"),
	CONSTRAINT "busy_routine_time_ck" CHECK(("busy_routine"."all_day" = 1 and "busy_routine"."start_min" is null and "busy_routine"."end_min" is null)
        or ("busy_routine"."all_day" = 0 and "busy_routine"."start_min" is not null and "busy_routine"."end_min" is not null
            and "busy_routine"."start_min" between 0 and 1410 and "busy_routine"."start_min" % 30 = 0
            and "busy_routine"."end_min" between 30 and 1440 and "busy_routine"."end_min" % 30 = 0
            and "busy_routine"."start_min" <> "busy_routine"."end_min"))
);
--> statement-breakpoint
CREATE INDEX `busy_routine_user_idx` ON `busy_routine` (`user_id`,`end_date`);--> statement-breakpoint
CREATE TABLE `busy_routine_skip` (
	`routine_id` text NOT NULL,
	`local_date` text NOT NULL,
	PRIMARY KEY(`routine_id`, `local_date`),
	FOREIGN KEY (`routine_id`) REFERENCES `busy_routine`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `busy_block` ADD `routine_id` text;--> statement-breakpoint
CREATE INDEX `busy_user_routine_idx` ON `busy_block` (`user_id`,`routine_id`) WHERE "busy_block"."routine_id" is not null;