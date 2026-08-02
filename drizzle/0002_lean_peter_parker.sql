CREATE TABLE `location_management_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`reference_turn_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`location_id` text NOT NULL,
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
CREATE UNIQUE INDEX `idx_location_management_action_ordinal` ON `location_management_changes` (`action_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_location_management_branch_location` ON `location_management_changes` (`branch_id`,`location_id`,`created_at`);