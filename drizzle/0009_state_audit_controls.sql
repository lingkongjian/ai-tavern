CREATE TABLE `state_control_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`reference_turn_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`source_change_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text DEFAULT 'replace' NOT NULL,
	`payload_json` text NOT NULL,
	`result_active` integer DEFAULT true NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_state_control_action_ordinal` ON `state_control_changes` (`action_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `idx_state_control_branch_turn` ON `state_control_changes` (`branch_id`,`reference_turn_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `state_field_lock_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`session_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field_path` text NOT NULL,
	`revision` integer NOT NULL,
	`locked` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_state_field_lock_action` ON `state_field_lock_changes` (`action_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_state_field_lock_revision` ON `state_field_lock_changes` (`session_id`,`entity_type`,`entity_id`,`field_path`,`revision`);
--> statement-breakpoint
CREATE INDEX `idx_state_field_lock_entity_path` ON `state_field_lock_changes` (`session_id`,`entity_type`,`entity_id`,`field_path`,`created_at`);
--> statement-breakpoint
CREATE TABLE `state_lock_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field_paths_json` text NOT NULL,
	`proposed_payload_json` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_state_lock_blocks_turn_ordinal` ON `state_lock_blocks` (`turn_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `idx_state_lock_blocks_branch_turn` ON `state_lock_blocks` (`branch_id`,`turn_id`);
