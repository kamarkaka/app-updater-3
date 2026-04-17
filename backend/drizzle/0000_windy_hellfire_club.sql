CREATE TABLE `application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`source_type` text DEFAULT 'auto' NOT NULL,
	`current_version` text,
	`latest_version` text,
	`last_checked_at` integer,
	`check_interval_minutes` integer DEFAULT 360,
	`status` text DEFAULT 'active' NOT NULL,
	`error_message` text,
	`version_selector` text,
	`version_pattern` text,
	`download_selector` text,
	`download_pattern` text,
	`asset_pattern` text,
	`max_navigation_depth` integer DEFAULT 5,
	`download_timeout` integer DEFAULT 60,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `download` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`version` text NOT NULL,
	`url` text NOT NULL,
	`file_name` text NOT NULL,
	`file_path` text,
	`total_bytes` integer,
	`downloaded_bytes` integer DEFAULT 0,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`checksum` text,
	`checksum_type` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_app_version_idx` ON `download` (`application_id`,`version`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);