CREATE TABLE `turn_regenerations` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`previous_turn_json` text NOT NULL,
	`replacement_turn_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_turn_regenerations_action_id` ON `turn_regenerations` (`action_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_turn_regenerations_turn_ordinal` ON `turn_regenerations` (`turn_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_turn_regenerations_session_created_at` ON `turn_regenerations` (`session_id`,`created_at`);