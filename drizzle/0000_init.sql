CREATE TABLE `appointment` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`place_name` text,
	`lat` real,
	`lng` real,
	`map_url` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`tz` text NOT NULL,
	`local_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`cancelled_at` integer,
	`cancelled_by` text,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointment_range_ck" CHECK("appointment"."end_at" > "appointment"."start_at"),
	CONSTRAINT "appointment_latlng_ck" CHECK(("appointment"."lat" is null and "appointment"."lng" is null)
        or ("appointment"."lat" is not null and "appointment"."lng" is not null
            and "appointment"."lat" between -90 and 90 and "appointment"."lng" between -180 and 180)),
	CONSTRAINT "appointment_status_ck" CHECK("appointment"."status" in ('active','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `appointment_group_start_idx` ON `appointment` (`group_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `appointment_start_idx` ON `appointment` (`status`,`start_at`);--> statement-breakpoint
CREATE TABLE `appointment_rsvp` (
	`appointment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`response` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`appointment_id`, `user_id`),
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rsvp_response_ck" CHECK("appointment_rsvp"."response" in ('going','maybe','not_going'))
);
--> statement-breakpoint
CREATE INDEX `rsvp_user_idx` ON `appointment_rsvp` (`user_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`group_id` text,
	`meta` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_target_idx` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE TABLE `busy_block` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`note` text,
	`all_day` integer NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`local_start_date` text NOT NULL,
	`local_end_date` text NOT NULL,
	`tz` text DEFAULT 'Asia/Bangkok' NOT NULL,
	`hide_detail` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "busy_range_ck" CHECK("busy_block"."end_at" > "busy_block"."start_at" and "busy_block"."local_end_date" >= "busy_block"."local_start_date")
);
--> statement-breakpoint
CREATE INDEX `busy_user_start_idx` ON `busy_block` (`user_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `busy_user_end_idx` ON `busy_block` (`user_id`,`end_at`);--> statement-breakpoint
CREATE TABLE `group_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`kind` text NOT NULL,
	`invitee_user_id` text,
	`code_hash` text,
	`code_hint` text,
	`status` text DEFAULT 'active' NOT NULL,
	`uses_count` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitee_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "group_invite_kind_ck" CHECK(("group_invite"."kind" = 'direct' and "group_invite"."invitee_user_id" is not null and "group_invite"."code_hash" is null)
        or ("group_invite"."kind" = 'code' and "group_invite"."code_hash" is not null and "group_invite"."invitee_user_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_invite_code_hash_uq` ON `group_invite` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_invite_direct_active_uq` ON `group_invite` (`group_id`,`invitee_user_id`) WHERE "group_invite"."kind" = 'direct' and "group_invite"."status" = 'active';--> statement-breakpoint
CREATE INDEX `group_invite_group_idx` ON `group_invite` (`group_id`,`status`);--> statement-breakpoint
CREATE INDEX `group_invite_invitee_idx` ON `group_invite` (`invitee_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `group_member` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "group_member_role_ck" CHECK("group_member"."role" in ('admin','moderator','member'))
);
--> statement-breakpoint
CREATE INDEX `group_member_user_idx` ON `group_member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_one_admin_uq` ON `group_member` (`group_id`) WHERE "group_member"."role" = 'admin';--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tz` text DEFAULT 'Asia/Bangkok' NOT NULL,
	`free_window_start_min` integer DEFAULT 480 NOT NULL,
	`free_window_end_min` integer DEFAULT 1320 NOT NULL,
	`min_free_minutes` integer DEFAULT 120 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "groups_window_ck" CHECK("groups"."free_window_start_min" >= 0 and "groups"."free_window_start_min" < "groups"."free_window_end_min"
        and "groups"."free_window_end_min" <= 1440 and "groups"."free_window_start_min" % 30 = 0 and "groups"."free_window_end_min" % 30 = 0),
	CONSTRAINT "groups_min_free_ck" CHECK("groups"."min_free_minutes" >= 30 and "groups"."min_free_minutes" % 30 = 0
        and "groups"."min_free_minutes" <= "groups"."free_window_end_min" - "groups"."free_window_start_min")
);
--> statement-breakpoint
CREATE TABLE `login_throttle` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`params` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_user_created_idx` ON `notification` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_user_unread_idx` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`notification_id`) REFERENCES `notification`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outbox_due_idx` ON `notification_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `pepper_fingerprint` (
	`version` integer PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pin_reset_request` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`device_token_hash` text NOT NULL,
	`requester_ua` text,
	`requester_country` text,
	`requested_at` integer NOT NULL,
	`pending_expires_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`expires_at` integer,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pin_reset_status_ck" CHECK("pin_reset_request"."status" in ('pending','approved','rejected','used','expired','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pin_reset_one_open_uq` ON `pin_reset_request` (`user_id`) WHERE "pin_reset_request"."status" in ('pending','approved');--> statement-breakpoint
CREATE INDEX `pin_reset_status_idx` ON `pin_reset_request` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `place_search_cache` (
	`query_normalized` text PRIMARY KEY NOT NULL,
	`results` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limit_bucket` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_window_idx` ON `rate_limit_bucket` (`window_start`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_expires_idx` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `system_heartbeat` (
	`source` text PRIMARY KEY NOT NULL,
	`last_at` integer NOT NULL,
	CONSTRAINT "heartbeat_source_ck" CHECK("system_heartbeat"."source" in ('vercel-cron','github-actions'))
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`display_name` text NOT NULL,
	`pin_hash` text,
	`pin_pepper_version` integer DEFAULT 1 NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`must_change_pin` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`locale` text DEFAULT 'th' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`line_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "user_status_ck" CHECK("user"."status" in ('active','suspended','deleted')),
	CONSTRAINT "user_locale_ck" CHECK("user"."locale" in ('th','en')),
	CONSTRAINT "user_theme_ck" CHECK("user"."theme" in ('system','light','dark'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_norm_uq` ON `user` (`username_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_line_user_id_uq` ON `user` (`line_user_id`);