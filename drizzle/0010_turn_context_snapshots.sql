CREATE TABLE `turn_context_snapshots` (
	`turn_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`schema_version` text DEFAULT '1.0.0' NOT NULL,
	`model` text NOT NULL,
	`system_prompt` text NOT NULL,
	`context_json` text NOT NULL,
	`diagnostics_json` text NOT NULL,
	`messages_json` text NOT NULL,
	`estimated_tokens` integer DEFAULT 0 NOT NULL,
	`prompt_tokens` integer,
	`request_count` integer DEFAULT 1 NOT NULL,
	`repair_applied` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_turn_context_snapshots_session_turn` ON `turn_context_snapshots` (`session_id`,`turn_id`);
--> statement-breakpoint
CREATE INDEX `idx_turn_context_snapshots_branch_updated` ON `turn_context_snapshots` (`branch_id`,`updated_at`);
