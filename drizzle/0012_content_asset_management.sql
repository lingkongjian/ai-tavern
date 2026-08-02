CREATE TABLE `content_asset_management_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`reference_turn_id` text NOT NULL,
	`domain` text NOT NULL,
	`operation` text NOT NULL,
	`target_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`summary_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_content_asset_management_session_action` ON `content_asset_management_changes` (`session_id`,`action_id`);
--> statement-breakpoint
CREATE INDEX `idx_content_asset_management_branch_domain` ON `content_asset_management_changes` (`branch_id`,`domain`,`created_at`);
