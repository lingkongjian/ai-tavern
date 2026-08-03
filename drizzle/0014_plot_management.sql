CREATE TABLE `pending_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`kind` text DEFAULT 'advance' NOT NULL,
	`expected_head_turn_id` text NOT NULL,
	`expected_parent_turn_id` text,
	`idempotency_key` text NOT NULL,
	`feedback` text DEFAULT '' NOT NULL,
	`expected_regeneration_count` integer DEFAULT 0 NOT NULL,
	`player_input_json` text NOT NULL,
	`generated_output_json` text NOT NULL,
	`summary_patch` text DEFAULT '' NOT NULL,
	`context_snapshot_json` text NOT NULL,
	`memory_context_json` text NOT NULL,
	`state_mutations_json` text DEFAULT '[]' NOT NULL,
	`messages_json` text DEFAULT '[]' NOT NULL,
	`events_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pending_turns_session_key` ON `pending_turns` (`session_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_pending_turns_session_branch` ON `pending_turns` (`session_id`,`branch_id`);
--> statement-breakpoint
CREATE TABLE `plot_thread_management_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`reference_turn_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`plot_thread_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload_json` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plot_thread_management_action_ordinal` ON `plot_thread_management_changes` (`action_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `idx_plot_thread_management_branch_thread` ON `plot_thread_management_changes` (`branch_id`,`plot_thread_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `plot_trigger_management_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`reference_turn_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`plot_trigger_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload_json` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plot_trigger_management_action_ordinal` ON `plot_trigger_management_changes` (`action_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `idx_plot_trigger_management_branch_trigger` ON `plot_trigger_management_changes` (`branch_id`,`plot_trigger_id`,`created_at`);
