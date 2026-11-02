ALTER TABLE `busy_block` ADD `series_id` text;--> statement-breakpoint
CREATE INDEX `busy_user_series_idx` ON `busy_block` (`user_id`,`series_id`) WHERE "busy_block"."series_id" is not null;