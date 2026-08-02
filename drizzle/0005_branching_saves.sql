ALTER TABLE `sessions` ADD `active_branch_id` text;
--> statement-breakpoint
UPDATE `sessions`
SET `active_branch_id` = (
  SELECT `branches`.`id`
  FROM `branches`
  WHERE `branches`.`session_id` = `sessions`.`id`
    AND `branches`.`parent_branch_id` IS NULL
  ORDER BY `branches`.`created_at` ASC
  LIMIT 1
);
--> statement-breakpoint
ALTER TABLE `snapshots` ADD `name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `snapshots` ADD `kind` text DEFAULT 'automatic' NOT NULL;
--> statement-breakpoint
CREATE TABLE `save_points` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `turn_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `name` text NOT NULL,
  `state_json` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_save_points_session_created_at` ON `save_points` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_save_points_branch_sequence` ON `save_points` (`branch_id`,`sequence`);
