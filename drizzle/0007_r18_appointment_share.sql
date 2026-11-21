CREATE TABLE `appointment_guest` (
	`appointment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`invited_by` text,
	`link_id` text,
	`response` text,
	`responded_at` integer,
	`joined_at` integer NOT NULL,
	`removed_at` integer,
	`removed_by` text,
	PRIMARY KEY(`appointment_id`, `user_id`),
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`link_id`) REFERENCES `appointment_share_link`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`removed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointment_guest_response_ck" CHECK("appointment_guest"."response" is null or "appointment_guest"."response" in ('going','maybe','not_going')),
	CONSTRAINT "appointment_guest_responded_ck" CHECK(("appointment_guest"."response" is null) = ("appointment_guest"."responded_at" is null)),
	CONSTRAINT "appointment_guest_removed_ck" CHECK("appointment_guest"."removed_at" is not null or "appointment_guest"."removed_by" is null)
);
--> statement-breakpoint
CREATE INDEX `appointment_guest_user_idx` ON `appointment_guest` (`user_id`);--> statement-breakpoint
CREATE INDEX `appointment_guest_link_idx` ON `appointment_guest` (`link_id`) WHERE "appointment_guest"."link_id" is not null;--> statement-breakpoint
CREATE TABLE `appointment_share_link` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`created_by` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "share_link_revoked_ck" CHECK("appointment_share_link"."revoked_at" is not null or "appointment_share_link"."revoked_by" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_link_token_hash_uq` ON `appointment_share_link` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `share_link_one_active_uq` ON `appointment_share_link` (`appointment_id`,`created_by`) WHERE "appointment_share_link"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX `share_link_appointment_idx` ON `appointment_share_link` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `share_link_creator_idx` ON `appointment_share_link` (`created_by`,`revoked_at`);