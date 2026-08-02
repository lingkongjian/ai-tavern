import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);

const updatedAt = () =>
  text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    activeBranchId: text("active_branch_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("idx_sessions_campaign_id").on(table.campaignId)],
);

export const sourceDocuments = sqliteTable(
  "source_documents",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fileName: text("file_name").notNull(),
    content: text("content").notNull(),
    contentLength: integer("content_length").notNull(),
    chapterCount: integer("chapter_count").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    currentChapter: integer("current_chapter").notNull().default(1),
    preventFuture: integer("prevent_future", { mode: "boolean" })
      .notNull()
      .default(true),
    fidelity: text("fidelity").notNull().default("balanced"),
    isDeleted: integer("is_deleted", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("idx_source_documents_session_id").on(table.sessionId),
    index("idx_source_documents_session_active").on(
      table.sessionId,
      table.isDeleted,
      table.createdAt,
    ),
    uniqueIndex("idx_source_documents_session_file").on(
      table.sessionId,
      table.fileName,
    ),
  ],
);

export const sourceChunks = sqliteTable(
  "source_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    chapterIndex: integer("chapter_index").notNull(),
    chapterTitle: text("chapter_title").notNull(),
    content: text("content").notNull(),
    characterNamesJson: text("character_names_json").notNull().default("[]"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_source_chunks_document_ordinal").on(
      table.documentId,
      table.ordinal,
    ),
    index("idx_source_chunks_session_chapter").on(
      table.sessionId,
      table.chapterIndex,
    ),
  ],
);

export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentBranchId: text("parent_branch_id"),
    forkedFromTurnId: text("forked_from_turn_id"),
    headTurnId: text("head_turn_id"),
    nextSequence: integer("next_sequence").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("idx_branches_session_id").on(table.sessionId),
    uniqueIndex("idx_branches_session_name").on(table.sessionId, table.name),
  ],
);

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    parentTurnId: text("parent_turn_id"),
    sequence: integer("sequence").notNull(),
    idempotencyKey: text("idempotency_key"),
    playerInputJson: text("player_input_json").notNull(),
    generatedOutputJson: text("generated_output_json").notNull(),
    summaryPatch: text("summary_patch").notNull().default(""),
    status: text("status").notNull().default("committed"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_turns_branch_sequence").on(
      table.branchId,
      table.sequence,
    ),
    uniqueIndex("idx_turns_session_idempotency").on(
      table.sessionId,
      table.idempotencyKey,
    ),
    index("idx_turns_session_created_at").on(
      table.sessionId,
      table.createdAt,
    ),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    role: text("role").notNull(),
    speakerId: text("speaker_id"),
    content: text("content").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_messages_turn_ordinal").on(table.turnId, table.ordinal),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    summary: text("summary").notNull(),
    locationId: text("location_id"),
    characterIdsJson: text("character_ids_json").notNull().default("[]"),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: createdAt(),
  },
  (table) => [index("idx_events_turn_id").on(table.turnId)],
);

export const stateChanges = sqliteTable(
  "state_changes",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    payloadJson: text("payload_json").notNull(),
    reason: text("reason").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_state_changes_turn_ordinal").on(
      table.turnId,
      table.ordinal,
    ),
    index("idx_state_changes_branch_entity").on(
      table.branchId,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const characterManagementChanges = sqliteTable(
  "character_management_changes",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    referenceTurnId: text("reference_turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    characterId: text("character_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    payloadJson: text("payload_json").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_character_management_action_ordinal").on(
      table.actionId,
      table.ordinal,
    ),
    index("idx_character_management_branch_character").on(
      table.branchId,
      table.characterId,
      table.createdAt,
    ),
  ],
);

export const locationManagementChanges = sqliteTable(
  "location_management_changes",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    referenceTurnId: text("reference_turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    locationId: text("location_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    payloadJson: text("payload_json").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_location_management_action_ordinal").on(
      table.actionId,
      table.ordinal,
    ),
    index("idx_location_management_branch_location").on(
      table.branchId,
      table.locationId,
      table.createdAt,
    ),
  ],
);

export const storyModuleManagementChanges = sqliteTable(
  "story_module_management_changes",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    referenceTurnId: text("reference_turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    storyModuleId: text("story_module_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    payloadJson: text("payload_json").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_story_module_management_action_ordinal").on(
      table.actionId,
      table.ordinal,
    ),
    index("idx_story_module_management_branch_module").on(
      table.branchId,
      table.storyModuleId,
      table.createdAt,
    ),
  ],
);

export const worldBookManagementChanges = sqliteTable(
  "world_book_management_changes",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    referenceTurnId: text("reference_turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    worldBookEntryId: text("world_book_entry_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    payloadJson: text("payload_json").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_world_book_management_action_ordinal").on(
      table.actionId,
      table.ordinal,
    ),
    index("idx_world_book_management_branch_entry").on(
      table.branchId,
      table.worldBookEntryId,
      table.createdAt,
    ),
  ],
);

export const contentAssetManagementChanges = sqliteTable(
  "content_asset_management_changes",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    referenceTurnId: text("reference_turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    operation: text("operation").notNull(),
    targetId: text("target_id").notNull(),
    requestHash: text("request_hash").notNull(),
    summaryJson: text("summary_json").notNull(),
    revision: integer("revision").notNull().default(0),
    beforeJson: text("before_json").notNull().default("{}"),
    afterJson: text("after_json").notNull().default("{}"),
    revertedByActionId: text("reverted_by_action_id"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_content_asset_management_session_action").on(
      table.sessionId,
      table.actionId,
    ),
    index("idx_content_asset_management_branch_domain").on(
      table.branchId,
      table.domain,
      table.createdAt,
    ),
    index("idx_content_asset_management_target_revision").on(
      table.branchId,
      table.domain,
      table.targetId,
      table.revision,
    ),
  ],
);

export const stateControlChanges = sqliteTable(
  "state_control_changes",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    referenceTurnId: text("reference_turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    sourceChangeId: text("source_change_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull().default("replace"),
    payloadJson: text("payload_json").notNull(),
    resultActive: integer("result_active", { mode: "boolean" })
      .notNull()
      .default(true),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_state_control_action_ordinal").on(
      table.actionId,
      table.ordinal,
    ),
    index("idx_state_control_branch_turn").on(
      table.branchId,
      table.referenceTurnId,
      table.createdAt,
    ),
  ],
);

export const stateFieldLockChanges = sqliteTable(
  "state_field_lock_changes",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    fieldPath: text("field_path").notNull(),
    revision: integer("revision").notNull(),
    locked: integer("locked", { mode: "boolean" }).notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_state_field_lock_action").on(table.actionId),
    uniqueIndex("idx_state_field_lock_revision").on(
      table.sessionId,
      table.entityType,
      table.entityId,
      table.fieldPath,
      table.revision,
    ),
    index("idx_state_field_lock_entity_path").on(
      table.sessionId,
      table.entityType,
      table.entityId,
      table.fieldPath,
      table.createdAt,
    ),
  ],
);

export const stateLockBlocks = sqliteTable(
  "state_lock_blocks",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    fieldPathsJson: text("field_paths_json").notNull(),
    proposedPayloadJson: text("proposed_payload_json").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_state_lock_blocks_turn_ordinal").on(
      table.turnId,
      table.ordinal,
    ),
    index("idx_state_lock_blocks_branch_turn").on(
      table.branchId,
      table.turnId,
    ),
  ],
);

export const turnRegenerations = sqliteTable(
  "turn_regenerations",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    previousTurnJson: text("previous_turn_json").notNull(),
    replacementTurnJson: text("replacement_turn_json").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_turn_regenerations_action_id").on(table.actionId),
    uniqueIndex("idx_turn_regenerations_turn_ordinal").on(
      table.turnId,
      table.ordinal,
    ),
    index("idx_turn_regenerations_session_created_at").on(
      table.sessionId,
      table.createdAt,
    ),
  ],
);

export const materializedStates = sqliteTable(
  "materialized_states",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    stateJson: text("state_json").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    updatedTurnId: text("updated_turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sessionId,
        table.branchId,
        table.entityType,
        table.entityId,
      ],
      name: "pk_materialized_states",
    }),
    index("idx_materialized_branch_type").on(
      table.branchId,
      table.entityType,
    ),
  ],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    stateJson: text("state_json").notNull(),
    name: text("name").notNull().default(""),
    kind: text("kind").notNull().default("automatic"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idx_snapshots_branch_sequence").on(
      table.branchId,
      table.sequence,
    ),
  ],
);

export const savePoints = sqliteTable(
  "save_points",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    name: text("name").notNull(),
    stateJson: text("state_json").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("idx_save_points_session_created_at").on(
      table.sessionId,
      table.createdAt,
    ),
    index("idx_save_points_branch_sequence").on(
      table.branchId,
      table.sequence,
    ),
  ],
);

export const memorySettings = sqliteTable("memory_settings", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  memoryTokenBudget: integer("memory_token_budget").notNull().default(2400),
  recentTurnCount: integer("recent_turn_count").notNull().default(6),
  chapterSize: integer("chapter_size").notNull().default(10),
  updatedAt: updatedAt(),
});

export const memoryEntries = sqliteTable(
  "memory_entries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    sourceTurnId: text("source_turn_id").references(() => turns.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    subjectKey: text("subject_key").notNull().default(""),
    keywordsJson: text("keywords_json").notNull().default("[]"),
    characterIdsJson: text("character_ids_json").notNull().default("[]"),
    locationId: text("location_id"),
    importance: integer("importance").notNull().default(50),
    status: text("status").notNull().default("active"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    source: text("source").notNull().default("automatic"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("idx_memory_entries_branch_status").on(
      table.branchId,
      table.enabled,
      table.status,
    ),
    index("idx_memory_entries_source_turn").on(table.sourceTurnId),
  ],
);

export const memoryChapters = sqliteTable(
  "memory_chapters",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    startTurnId: text("start_turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    endTurnId: text("end_turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    startSequence: integer("start_sequence").notNull(),
    endSequence: integer("end_sequence").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    keywordsJson: text("keywords_json").notNull().default("[]"),
    characterIdsJson: text("character_ids_json").notNull().default("[]"),
    locationIdsJson: text("location_ids_json").notNull().default("[]"),
    source: text("source").notNull().default("automatic"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("idx_memory_chapters_branch_range").on(
      table.branchId,
      table.startSequence,
      table.endSequence,
    ),
  ],
);

export const memoryRetrievals = sqliteTable(
  "memory_retrievals",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    memoryIdsJson: text("memory_ids_json").notNull().default("[]"),
    chapterIdsJson: text("chapter_ids_json").notNull().default("[]"),
    estimatedTokens: integer("estimated_tokens").notNull().default(0),
    budgetTokens: integer("budget_tokens").notNull().default(2400),
    recentTurnCount: integer("recent_turn_count").notNull().default(6),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("idx_memory_retrievals_turn").on(table.turnId)],
);
