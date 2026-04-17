PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`source_type` text DEFAULT 'auto' NOT NULL,
	`current_version` text,
	`latest_version` text,
	`last_checked_at` integer,
	`check_interval_minutes` integer DEFAULT 720,
	`status` text DEFAULT 'active' NOT NULL,
	`error_message` text,
	`name_filter` text,
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
INSERT INTO `__new_application`("id", "name", "url", "source_type", "current_version", "latest_version", "last_checked_at", "check_interval_minutes", "status", "error_message", "name_filter", "version_selector", "version_pattern", "download_selector", "download_pattern", "asset_pattern", "max_navigation_depth", "download_timeout", "created_at", "updated_at") SELECT "id", "name", "url", "source_type", "current_version", "latest_version", "last_checked_at", "check_interval_minutes", "status", "error_message", "name_filter", "version_selector", "version_pattern", "download_selector", "download_pattern", "asset_pattern", "max_navigation_depth", "download_timeout", "created_at", "updated_at" FROM `application`;--> statement-breakpoint
DROP TABLE `application`;--> statement-breakpoint
ALTER TABLE `__new_application` RENAME TO `application`;--> statement-breakpoint
PRAGMA foreign_keys=ON;