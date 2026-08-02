CREATE TABLE `source_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`chapter_index` integer NOT NULL,
	`chapter_title` text NOT NULL,
	`content` text NOT NULL,
	`character_names_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `source_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_chunks_document_ordinal` ON `source_chunks` (`document_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_source_chunks_session_chapter` ON `source_chunks` (`session_id`,`chapter_index`);--> statement-breakpoint
CREATE TABLE `source_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`file_name` text NOT NULL,
	`content` text NOT NULL,
	`content_length` integer NOT NULL,
	`chapter_count` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`current_chapter` integer DEFAULT 1 NOT NULL,
	`prevent_future` integer DEFAULT true NOT NULL,
	`fidelity` text DEFAULT 'balanced' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_source_documents_session_id` ON `source_documents` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_documents_session_file` ON `source_documents` (`session_id`,`file_name`);