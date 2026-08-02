CREATE TABLE `memory_settings` (
	`session_id` text PRIMARY KEY NOT NULL,
	`memory_token_budget` integer DEFAULT 2400 NOT NULL,
	`recent_turn_count` integer DEFAULT 6 NOT NULL,
	`chapter_size` integer DEFAULT 10 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`source_turn_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`subject_key` text DEFAULT '' NOT NULL,
	`keywords_json` text DEFAULT '[]' NOT NULL,
	`character_ids_json` text DEFAULT '[]' NOT NULL,
	`location_id` text,
	`importance` integer DEFAULT 50 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'automatic' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_memory_entries_branch_status` ON `memory_entries` (`branch_id`,`enabled`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_memory_entries_source_turn` ON `memory_entries` (`source_turn_id`);
--> statement-breakpoint
CREATE TABLE `memory_chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`start_turn_id` text NOT NULL,
	`end_turn_id` text NOT NULL,
	`start_sequence` integer NOT NULL,
	`end_sequence` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`keywords_json` text DEFAULT '[]' NOT NULL,
	`character_ids_json` text DEFAULT '[]' NOT NULL,
	`location_ids_json` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'automatic' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`start_turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`end_turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_chapters_branch_range` ON `memory_chapters` (`branch_id`,`start_sequence`,`end_sequence`);
--> statement-breakpoint
CREATE TABLE `memory_retrievals` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`query` text NOT NULL,
	`memory_ids_json` text DEFAULT '[]' NOT NULL,
	`chapter_ids_json` text DEFAULT '[]' NOT NULL,
	`estimated_tokens` integer DEFAULT 0 NOT NULL,
	`budget_tokens` integer DEFAULT 2400 NOT NULL,
	`recent_turn_count` integer DEFAULT 6 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_retrievals_turn` ON `memory_retrievals` (`turn_id`);
--> statement-breakpoint
INSERT INTO `memory_settings` (`session_id`)
SELECT `id` FROM `sessions`;
