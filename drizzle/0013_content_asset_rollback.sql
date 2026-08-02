ALTER TABLE `source_documents` ADD `is_deleted` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_asset_management_changes` ADD `revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_asset_management_changes` ADD `before_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_asset_management_changes` ADD `after_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_asset_management_changes` ADD `reverted_by_action_id` text;
--> statement-breakpoint
CREATE INDEX `idx_content_asset_management_target_revision` ON `content_asset_management_changes` (`branch_id`,`domain`,`target_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `idx_source_documents_session_active` ON `source_documents` (`session_id`,`is_deleted`,`created_at`);
