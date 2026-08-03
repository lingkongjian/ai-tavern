ALTER TABLE `branches` ADD `is_main` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `branches` SET `is_main` = 1 WHERE `parent_branch_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_branches_session_main` ON `branches` (`session_id`) WHERE `is_main` = 1;
