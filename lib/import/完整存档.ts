import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { StoryNotFoundError } from "../storage/story-store.ts";

export const COMPLETE_ARCHIVE_SPEC = "ai_tavern_runtime_archive_v1";
export const COMPLETE_ARCHIVE_SCHEMA_VERSION = "1.7.0";
export const PREVIOUS_COMPLETE_ARCHIVE_SCHEMA_VERSION = "1.6.0";
export const OLDER_COMPLETE_ARCHIVE_SCHEMA_VERSION = "1.5.0";
export const EARLIER_COMPLETE_ARCHIVE_SCHEMA_VERSION = "1.4.0";
export const ANCIENT_COMPLETE_ARCHIVE_SCHEMA_VERSION = "1.3.0";
export const HISTORIC_COMPLETE_ARCHIVE_SCHEMA_VERSION = "1.2.0";
export const FOUNDATIONAL_COMPLETE_ARCHIVE_SCHEMA_VERSION = "1.1.0";
export const LEGACY_COMPLETE_ARCHIVE_SCHEMA_VERSION = "1.0.0";
export const COMPLETE_ARCHIVE_MAX_BYTES = 100_000_000;

type ArchiveValue = string | number | null;
type ArchiveRow = Record<string, ArchiveValue>;

const TABLE_COLUMNS = {
  campaigns: ["id", "name", "description", "created_at", "updated_at"],
  sessions: [
    "id",
    "campaign_id",
    "name",
    "status",
    "active_branch_id",
    "created_at",
    "updated_at",
  ],
  source_documents: [
    "id",
    "session_id",
    "name",
    "file_name",
    "content",
    "content_length",
    "chapter_count",
    "chunk_count",
    "enabled",
    "current_chapter",
    "prevent_future",
    "fidelity",
    "is_deleted",
    "created_at",
    "updated_at",
  ],
  source_chunks: [
    "id",
    "document_id",
    "session_id",
    "ordinal",
    "chapter_index",
    "chapter_title",
    "content",
    "character_names_json",
    "created_at",
  ],
  branches: [
    "id",
    "session_id",
    "name",
    "parent_branch_id",
    "forked_from_turn_id",
    "head_turn_id",
    "next_sequence",
    "created_at",
    "updated_at",
  ],
  turns: [
    "id",
    "session_id",
    "branch_id",
    "parent_turn_id",
    "sequence",
    "idempotency_key",
    "player_input_json",
    "generated_output_json",
    "summary_patch",
    "status",
    "created_at",
  ],
  turn_context_snapshots: [
    "turn_id",
    "session_id",
    "branch_id",
    "schema_version",
    "model",
    "system_prompt",
    "context_json",
    "diagnostics_json",
    "messages_json",
    "estimated_tokens",
    "prompt_tokens",
    "request_count",
    "repair_applied",
    "created_at",
    "updated_at",
  ],
  messages: [
    "id",
    "turn_id",
    "ordinal",
    "role",
    "speaker_id",
    "content",
    "metadata_json",
    "created_at",
  ],
  events: [
    "id",
    "turn_id",
    "event_type",
    "summary",
    "location_id",
    "character_ids_json",
    "payload_json",
    "created_at",
  ],
  state_changes: [
    "id",
    "session_id",
    "branch_id",
    "turn_id",
    "ordinal",
    "entity_type",
    "entity_id",
    "operation",
    "payload_json",
    "reason",
    "evidence_json",
    "created_at",
  ],
  character_management_changes: [
    "id",
    "action_id",
    "session_id",
    "branch_id",
    "reference_turn_id",
    "ordinal",
    "character_id",
    "entity_type",
    "entity_id",
    "operation",
    "payload_json",
    "reason",
    "created_at",
  ],
  location_management_changes: [
    "id",
    "action_id",
    "session_id",
    "branch_id",
    "reference_turn_id",
    "ordinal",
    "location_id",
    "entity_type",
    "entity_id",
    "operation",
    "payload_json",
    "reason",
    "created_at",
  ],
  story_module_management_changes: [
    "id",
    "action_id",
    "session_id",
    "branch_id",
    "reference_turn_id",
    "ordinal",
    "story_module_id",
    "entity_type",
    "entity_id",
    "operation",
    "payload_json",
    "reason",
    "created_at",
  ],
  world_book_management_changes: [
    "id",
    "action_id",
    "session_id",
    "branch_id",
    "reference_turn_id",
    "ordinal",
    "world_book_entry_id",
    "entity_type",
    "entity_id",
    "operation",
    "payload_json",
    "reason",
    "created_at",
  ],
  content_asset_management_changes: [
    "id",
    "action_id",
    "session_id",
    "branch_id",
    "reference_turn_id",
    "domain",
    "operation",
    "target_id",
    "request_hash",
    "summary_json",
    "revision",
    "before_json",
    "after_json",
    "reverted_by_action_id",
    "created_at",
  ],
  state_control_changes: [
    "id",
    "action_id",
    "session_id",
    "branch_id",
    "reference_turn_id",
    "ordinal",
    "source_change_id",
    "entity_type",
    "entity_id",
    "operation",
    "payload_json",
    "result_active",
    "reason",
    "created_at",
  ],
  state_field_lock_changes: [
    "id",
    "action_id",
    "session_id",
    "entity_type",
    "entity_id",
    "field_path",
    "revision",
    "locked",
    "reason",
    "created_at",
  ],
  state_lock_blocks: [
    "id",
    "session_id",
    "branch_id",
    "turn_id",
    "ordinal",
    "entity_type",
    "entity_id",
    "field_paths_json",
    "proposed_payload_json",
    "reason",
    "created_at",
  ],
  turn_regenerations: [
    "id",
    "action_id",
    "session_id",
    "branch_id",
    "turn_id",
    "ordinal",
    "previous_turn_json",
    "replacement_turn_json",
    "created_at",
  ],
  materialized_states: [
    "session_id",
    "branch_id",
    "entity_type",
    "entity_id",
    "state_json",
    "is_active",
    "version",
    "updated_turn_id",
    "updated_at",
  ],
  snapshots: [
    "id",
    "session_id",
    "branch_id",
    "turn_id",
    "sequence",
    "state_json",
    "name",
    "kind",
    "created_at",
  ],
  save_points: [
    "id",
    "session_id",
    "branch_id",
    "turn_id",
    "sequence",
    "name",
    "state_json",
    "created_at",
    "updated_at",
  ],
  memory_settings: [
    "session_id",
    "memory_token_budget",
    "recent_turn_count",
    "chapter_size",
    "updated_at",
  ],
  memory_entries: [
    "id",
    "session_id",
    "branch_id",
    "source_turn_id",
    "type",
    "title",
    "content",
    "subject_key",
    "keywords_json",
    "character_ids_json",
    "location_id",
    "importance",
    "status",
    "pinned",
    "enabled",
    "source",
    "metadata_json",
    "created_at",
    "updated_at",
  ],
  memory_chapters: [
    "id",
    "session_id",
    "branch_id",
    "start_turn_id",
    "end_turn_id",
    "start_sequence",
    "end_sequence",
    "title",
    "summary",
    "keywords_json",
    "character_ids_json",
    "location_ids_json",
    "source",
    "created_at",
    "updated_at",
  ],
  memory_retrievals: [
    "id",
    "session_id",
    "branch_id",
    "turn_id",
    "query",
    "memory_ids_json",
    "chapter_ids_json",
    "estimated_tokens",
    "budget_tokens",
    "recent_turn_count",
    "created_at",
  ],
} as const;

type ArchiveTableName = keyof typeof TABLE_COLUMNS;
type ArchiveData = { [K in ArchiveTableName]: ArchiveRow[] };

const TABLE_NAMES = Object.keys(TABLE_COLUMNS) as ArchiveTableName[];
const PREVIOUS_TABLE_NAMES = TABLE_NAMES;
const OLDER_TABLE_NAMES = PREVIOUS_TABLE_NAMES.filter(
  (table) => table !== "content_asset_management_changes",
);
const EARLIER_TABLE_NAMES = OLDER_TABLE_NAMES.filter(
  (table) => table !== "world_book_management_changes",
);
const ANCIENT_TABLE_NAMES = EARLIER_TABLE_NAMES.filter(
  (table) => table !== "turn_context_snapshots",
);
const HISTORIC_TABLE_NAMES = ANCIENT_TABLE_NAMES.filter(
  (table) =>
    table !== "state_control_changes" &&
    table !== "state_field_lock_changes" &&
    table !== "state_lock_blocks",
);
const FOUNDATIONAL_TABLE_NAMES = HISTORIC_TABLE_NAMES.filter(
  (table) => table !== "story_module_management_changes",
);
const LEGACY_TABLE_NAMES = FOUNDATIONAL_TABLE_NAMES.filter(
  (table) => !table.startsWith("memory_"),
);
const JSON_COLUMNS = new Set([
  "player_input_json",
  "generated_output_json",
  "metadata_json",
  "character_ids_json",
  "payload_json",
  "evidence_json",
  "previous_turn_json",
  "replacement_turn_json",
  "state_json",
  "keywords_json",
  "location_ids_json",
  "memory_ids_json",
  "chapter_ids_json",
  "field_paths_json",
  "proposed_payload_json",
  "context_json",
  "diagnostics_json",
  "messages_json",
  "summary_json",
  "before_json",
  "after_json",
]);
const REFERENCE_COLUMNS = new Set([
  "id",
  "action_id",
  "campaign_id",
  "session_id",
  "active_branch_id",
  "branch_id",
  "parent_branch_id",
  "forked_from_turn_id",
  "head_turn_id",
  "turn_id",
  "parent_turn_id",
  "document_id",
  "reference_turn_id",
  "updated_turn_id",
  "source_turn_id",
  "start_turn_id",
  "end_turn_id",
  "source_change_id",
  "target_id",
  "reverted_by_action_id",
]);

export interface CompleteArchiveSummary {
  campaignName: string;
  sessionName: string;
  branchCount: number;
  turnCount: number;
  characterCount: number;
  locationCount: number;
  sourceDocumentCount: number;
  manualSaveCount: number;
  regenerationCount: number;
}

export interface CompleteAdventureArchive {
  spec: typeof COMPLETE_ARCHIVE_SPEC;
  schemaVersion:
    | typeof COMPLETE_ARCHIVE_SCHEMA_VERSION
    | typeof PREVIOUS_COMPLETE_ARCHIVE_SCHEMA_VERSION
    | typeof OLDER_COMPLETE_ARCHIVE_SCHEMA_VERSION
    | typeof EARLIER_COMPLETE_ARCHIVE_SCHEMA_VERSION
    | typeof ANCIENT_COMPLETE_ARCHIVE_SCHEMA_VERSION
    | typeof HISTORIC_COMPLETE_ARCHIVE_SCHEMA_VERSION
    | typeof FOUNDATIONAL_COMPLETE_ARCHIVE_SCHEMA_VERSION
    | typeof LEGACY_COMPLETE_ARCHIVE_SCHEMA_VERSION;
  archiveId: string;
  exportedAt: string;
  summary: CompleteArchiveSummary;
  data: ArchiveData;
  integrity: {
    algorithm: "sha256";
    checksum: string;
  };
}

export interface CompleteArchivePreview {
  archiveId: string;
  exportedAt: string;
  schemaVersion: string;
  summary: CompleteArchiveSummary;
  verified: true;
}

export class CompleteArchiveError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "完整存档格式无效。");
    this.name = "CompleteArchiveError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksumData(data: unknown) {
  return createHash("sha256").update(canonicalJson(data)).digest("hex");
}

function selectRows(
  database: DatabaseSync,
  table: ArchiveTableName,
  sessionId: string,
) {
  const columns = TABLE_COLUMNS[table].join(", ");
  let where = "session_id = ?";
  if (table === "campaigns") {
    where = "id = (SELECT campaign_id FROM sessions WHERE id = ?)";
  } else if (table === "sessions") {
    where = "id = ?";
  } else if (table === "messages" || table === "events") {
    where = "turn_id IN (SELECT id FROM turns WHERE session_id = ?)";
  }
  const orderColumns = table === "turn_context_snapshots"
    ? "turn_id"
    : TABLE_COLUMNS[table].includes("ordinal" as never)
    ? "ordinal, id"
    : TABLE_COLUMNS[table].includes("sequence" as never)
      ? "sequence, id"
      : TABLE_COLUMNS[table].includes("id" as never)
        ? "id"
        : TABLE_COLUMNS[table].includes("branch_id" as never)
          ? "branch_id, entity_type, entity_id"
          : "session_id";
  return database
    .prepare(`SELECT ${columns} FROM ${table} WHERE ${where} ORDER BY ${orderColumns}`)
    .all(sessionId) as unknown as ArchiveRow[];
}

function createSummary(data: ArchiveData): CompleteArchiveSummary {
  const campaign = data.campaigns[0];
  const session = data.sessions[0];
  const characterIds = new Set(
    data.materialized_states
      .filter((row) => row.entity_type === "character_card")
      .map((row) => row.entity_id),
  );
  const locationIds = new Set(
    data.materialized_states
      .filter((row) => row.entity_type === "location")
      .map((row) => row.entity_id),
  );
  return {
    campaignName: typeof campaign?.name === "string" ? campaign.name : "未命名剧本",
    sessionName: typeof session?.name === "string" ? session.name : "未命名会话",
    branchCount: data.branches.length,
    turnCount: data.turns.length,
    characterCount: characterIds.size,
    locationCount: locationIds.size,
    sourceDocumentCount: data.source_documents.filter(
      (row) => row.is_deleted !== 1,
    ).length,
    manualSaveCount: data.save_points.length,
    regenerationCount: data.turn_regenerations.length,
  };
}

export function exportCompleteAdventure(
  database: DatabaseSync,
  sessionId: string,
): CompleteAdventureArchive {
  if (!sessionId.trim()) throw new StoryNotFoundError();
  const exists = database
    .prepare("SELECT 1 AS found FROM sessions WHERE id = ?")
    .get(sessionId) as { found: number } | undefined;
  if (!exists) throw new StoryNotFoundError();

  const data = Object.fromEntries(
    TABLE_NAMES.map((table) => [table, selectRows(database, table, sessionId)]),
  ) as ArchiveData;
  const archive: CompleteAdventureArchive = {
    spec: COMPLETE_ARCHIVE_SPEC,
    schemaVersion: COMPLETE_ARCHIVE_SCHEMA_VERSION,
    archiveId: randomUUID(),
    exportedAt: new Date().toISOString(),
    summary: createSummary(data),
    data,
    integrity: { algorithm: "sha256", checksum: checksumData(data) },
  };
  return archive;
}

function parseArchiveRows(
  data: Record<string, unknown>,
  issues: string[],
  requiredTables: ArchiveTableName[],
  schemaVersion: unknown,
): ArchiveData {
  const result = {} as ArchiveData;
  for (const table of TABLE_NAMES) {
    const value = data[table];
    if (!Array.isArray(value)) {
      if (requiredTables.includes(table)) {
        issues.push(`完整存档缺少数据表 ${table}。`);
      }
      result[table] = [];
      continue;
    }
    const allowedColumns = new Set<string>(TABLE_COLUMNS[table]);
    result[table] = value.flatMap((candidate, rowIndex) => {
      if (!isRecord(candidate)) {
        issues.push(`${table} 第 ${rowIndex + 1} 行不是对象。`);
        return [];
      }
      const requiredColumns = TABLE_COLUMNS[table].filter((column) => {
        if (schemaVersion === COMPLETE_ARCHIVE_SCHEMA_VERSION) return true;
        if (table === "source_documents" && column === "is_deleted") {
          return false;
        }
        if (
          table === "content_asset_management_changes" &&
          [
            "revision",
            "before_json",
            "after_json",
            "reverted_by_action_id",
          ].includes(column)
        ) {
          return false;
        }
        return true;
      });
      for (const column of requiredColumns) {
        if (!Object.hasOwn(candidate, column)) {
          issues.push(`${table} 第 ${rowIndex + 1} 行缺少 ${column}。`);
        }
      }
      for (const [column, cell] of Object.entries(candidate)) {
        if (!allowedColumns.has(column)) {
          issues.push(`${table} 第 ${rowIndex + 1} 行包含未知字段 ${column}。`);
        }
        if (cell !== null && typeof cell !== "string" && typeof cell !== "number") {
          issues.push(`${table} 第 ${rowIndex + 1} 行的 ${column} 类型无效。`);
        }
        if (JSON_COLUMNS.has(column) && typeof cell === "string") {
          try {
            JSON.parse(cell);
          } catch {
            issues.push(`${table} 第 ${rowIndex + 1} 行的 ${column} 不是有效 JSON。`);
          }
        }
      }
      return [candidate as ArchiveRow];
    });
  }
  return result;
}

function validateArchiveReferences(data: ArchiveData, issues: string[]) {
  const campaignId = data.campaigns[0]?.id;
  const sessionId = data.sessions[0]?.id;
  const ids = (table: ArchiveTableName) =>
    new Set(
      data[table]
        .map((row) => row.id)
        .filter((value): value is string => typeof value === "string"),
    );
  const branchIds = ids("branches");
  const turnIds = ids("turns");
  const documentIds = ids("source_documents");
  const contentAssetActionIds = new Set(
    data.content_asset_management_changes
      .map((row) => row.action_id)
      .filter((value): value is string => typeof value === "string"),
  );
  const auditableChangeIds = new Set([
    ...ids("state_changes"),
    ...ids("character_management_changes"),
    ...ids("location_management_changes"),
    ...ids("story_module_management_changes"),
    ...ids("world_book_management_changes"),
    ...ids("state_control_changes"),
  ]);

  if (data.sessions[0]?.campaign_id !== campaignId) {
    issues.push("会话没有指向存档内的剧本记录。");
  }
  if (!branchIds.has(data.sessions[0]?.active_branch_id as string)) {
    issues.push("活动分支不存在于完整存档中。");
  }
  for (const table of TABLE_NAMES.filter((name) =>
    TABLE_COLUMNS[name].includes("session_id" as never),
  )) {
    if (data[table].some((row) => row.session_id !== sessionId)) {
      issues.push(`${table} 包含属于其他会话的数据。`);
    }
  }

  for (const table of TABLE_NAMES) {
    const tableIds = data[table]
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");
    if (tableIds.length !== new Set(tableIds).size) {
      issues.push(`${table} 包含重复的主键 ID。`);
    }
  }
  for (const branch of data.branches) {
    if (
      typeof branch.parent_branch_id === "string" &&
      !branchIds.has(branch.parent_branch_id)
    ) {
      issues.push(`分支《${branch.name}》的父分支不存在。`);
    }
    for (const field of ["forked_from_turn_id", "head_turn_id"] as const) {
      const value = branch[field];
      if (typeof value === "string" && !turnIds.has(value)) {
        issues.push(`分支《${branch.name}》引用了不存在的回合。`);
      }
    }
  }
  for (const turn of data.turns) {
    if (!branchIds.has(turn.branch_id as string)) {
      issues.push("剧情回合引用了不存在的分支。");
    }
    if (
      typeof turn.parent_turn_id === "string" &&
      !turnIds.has(turn.parent_turn_id)
    ) {
      issues.push("剧情回合引用了不存在的上一回合。");
    }
  }
  for (const chunk of data.source_chunks) {
    if (!documentIds.has(chunk.document_id as string)) {
      issues.push("原文切片引用了不存在的原文文件。");
    }
  }
  for (const table of ["messages", "events"] as const) {
    if (data[table].some((row) => !turnIds.has(row.turn_id as string))) {
      issues.push(`${table} 引用了不存在的剧情回合。`);
    }
  }
  for (const table of [
    "state_changes",
    "character_management_changes",
    "location_management_changes",
    "story_module_management_changes",
    "world_book_management_changes",
    "content_asset_management_changes",
    "state_control_changes",
    "state_lock_blocks",
    "turn_regenerations",
    "turn_context_snapshots",
    "materialized_states",
    "snapshots",
    "save_points",
    "memory_entries",
    "memory_chapters",
    "memory_retrievals",
  ] as const) {
    for (const row of data[table]) {
      if (!branchIds.has(row.branch_id as string)) {
        issues.push(`${table} 引用了不存在的分支。`);
      }
      const turnId =
        row.turn_id ??
        row.reference_turn_id ??
        row.updated_turn_id ??
        row.source_turn_id ??
        row.end_turn_id;
      if (turnId !== null && !turnIds.has(turnId as string)) {
        issues.push(`${table} 引用了不存在的剧情回合。`);
      }
      if (
        table === "memory_chapters" &&
        !turnIds.has(row.start_turn_id as string)
      ) {
        issues.push("memory_chapters 引用了不存在的章节起始回合。");
      }
    }
  }
  for (const row of data.state_control_changes) {
    if (!auditableChangeIds.has(row.source_change_id as string)) {
      issues.push("state_control_changes 引用了不存在的原始状态变化。");
    }
  }
  for (const row of data.content_asset_management_changes) {
    if (
      typeof row.reverted_by_action_id === "string" &&
      !contentAssetActionIds.has(row.reverted_by_action_id)
    ) {
      issues.push(
        "content_asset_management_changes 引用了不存在的撤销动作。",
      );
    }
  }
}

export function parseCompleteArchiveDocument(
  value: unknown,
): CompleteAdventureArchive {
  if (!isRecord(value)) {
    throw new CompleteArchiveError(["完整存档必须是一个 JSON 对象。"]);
  }
  const encodedSize = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (encodedSize > COMPLETE_ARCHIVE_MAX_BYTES) {
    throw new CompleteArchiveError(["完整存档不能超过 100 MB。"]);
  }

  const issues: string[] = [];
  if (value.spec !== COMPLETE_ARCHIVE_SPEC) {
    issues.push(`spec 必须是 ${COMPLETE_ARCHIVE_SPEC}。`);
  }
  const schemaVersion = value.schemaVersion;
  const supportedVersion =
    schemaVersion === COMPLETE_ARCHIVE_SCHEMA_VERSION ||
    schemaVersion === PREVIOUS_COMPLETE_ARCHIVE_SCHEMA_VERSION ||
    schemaVersion === OLDER_COMPLETE_ARCHIVE_SCHEMA_VERSION ||
    schemaVersion === EARLIER_COMPLETE_ARCHIVE_SCHEMA_VERSION ||
    schemaVersion === ANCIENT_COMPLETE_ARCHIVE_SCHEMA_VERSION ||
    schemaVersion === HISTORIC_COMPLETE_ARCHIVE_SCHEMA_VERSION ||
    schemaVersion === FOUNDATIONAL_COMPLETE_ARCHIVE_SCHEMA_VERSION ||
    schemaVersion === LEGACY_COMPLETE_ARCHIVE_SCHEMA_VERSION;
  if (!supportedVersion) {
    issues.push(
      `schemaVersion 必须是 ${LEGACY_COMPLETE_ARCHIVE_SCHEMA_VERSION}、${FOUNDATIONAL_COMPLETE_ARCHIVE_SCHEMA_VERSION}、${HISTORIC_COMPLETE_ARCHIVE_SCHEMA_VERSION}、${ANCIENT_COMPLETE_ARCHIVE_SCHEMA_VERSION}、${EARLIER_COMPLETE_ARCHIVE_SCHEMA_VERSION}、${OLDER_COMPLETE_ARCHIVE_SCHEMA_VERSION}、${PREVIOUS_COMPLETE_ARCHIVE_SCHEMA_VERSION} 或 ${COMPLETE_ARCHIVE_SCHEMA_VERSION}。`,
    );
  }
  if (typeof value.archiveId !== "string" || !value.archiveId.trim()) {
    issues.push("完整存档缺少 archiveId。");
  }
  if (typeof value.exportedAt !== "string" || !value.exportedAt.trim()) {
    issues.push("完整存档缺少 exportedAt。");
  }
  if (!isRecord(value.data)) issues.push("完整存档缺少 data。");
  const requiredTables =
    schemaVersion === LEGACY_COMPLETE_ARCHIVE_SCHEMA_VERSION
      ? LEGACY_TABLE_NAMES
      : schemaVersion === FOUNDATIONAL_COMPLETE_ARCHIVE_SCHEMA_VERSION
        ? FOUNDATIONAL_TABLE_NAMES
        : schemaVersion === HISTORIC_COMPLETE_ARCHIVE_SCHEMA_VERSION
          ? HISTORIC_TABLE_NAMES
          : schemaVersion === ANCIENT_COMPLETE_ARCHIVE_SCHEMA_VERSION
            ? ANCIENT_TABLE_NAMES
            : schemaVersion === EARLIER_COMPLETE_ARCHIVE_SCHEMA_VERSION
              ? EARLIER_TABLE_NAMES
              : schemaVersion === OLDER_COMPLETE_ARCHIVE_SCHEMA_VERSION
                ? OLDER_TABLE_NAMES
                : schemaVersion === PREVIOUS_COMPLETE_ARCHIVE_SCHEMA_VERSION
                  ? PREVIOUS_TABLE_NAMES
                  : TABLE_NAMES;
  const data = parseArchiveRows(
    isRecord(value.data) ? value.data : {},
    issues,
    requiredTables,
    schemaVersion,
  );
  if (data.campaigns.length !== 1) issues.push("完整存档必须包含一个剧本记录。");
  if (data.sessions.length !== 1) issues.push("完整存档必须包含一个会话记录。");
  if (data.branches.length < 1) issues.push("完整存档至少需要一个剧情分支。");
  if (data.turns.length < 1) issues.push("完整存档至少需要一个剧情回合。");
  validateArchiveReferences(data, issues);

  const integrity = isRecord(value.integrity) ? value.integrity : {};
  if (integrity.algorithm !== "sha256" || typeof integrity.checksum !== "string") {
    issues.push("完整存档缺少 SHA-256 完整性信息。");
  } else if (
    checksumData(
      Object.fromEntries(requiredTables.map((table) => [table, data[table]])),
    ) !== integrity.checksum
  ) {
    issues.push("完整存档校验失败，文件可能不完整或被修改。");
  }
  if (issues.length > 0) throw new CompleteArchiveError(issues.slice(0, 50));

  return {
    spec: COMPLETE_ARCHIVE_SPEC,
    schemaVersion: supportedVersion
      ? schemaVersion
      : COMPLETE_ARCHIVE_SCHEMA_VERSION,
    archiveId: value.archiveId as string,
    exportedAt: value.exportedAt as string,
    summary: createSummary(data),
    data,
    integrity: { algorithm: "sha256", checksum: integrity.checksum as string },
  };
}

export function previewCompleteArchive(value: unknown): CompleteArchivePreview {
  const archive = parseCompleteArchiveDocument(value);
  return {
    archiveId: archive.archiveId,
    exportedAt: archive.exportedAt,
    schemaVersion: archive.schemaVersion,
    summary: archive.summary,
    verified: true,
  };
}

function remapJson(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapJson(item, idMap));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapJson(item, idMap)]),
    );
  }
  return value;
}

function remapRow(row: ArchiveRow, idMap: Map<string, string>): ArchiveRow {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => {
      if (typeof value !== "string") return [column, value];
      if (JSON_COLUMNS.has(column)) {
        try {
          const parsed = JSON.parse(value);
          return column === "before_json" || column === "after_json"
            ? [column, value]
            : [column, JSON.stringify(remapJson(parsed, idMap))];
        } catch {
          throw new CompleteArchiveError([`字段 ${column} 不是有效 JSON。`]);
        }
      }
      if (REFERENCE_COLUMNS.has(column)) return [column, idMap.get(value) ?? value];
      return [column, value];
    }),
  );
}

function insertRows(
  database: DatabaseSync,
  table: ArchiveTableName,
  rows: ArchiveRow[],
) {
  const columns = TABLE_COLUMNS[table];
  const statement = database.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  );
  for (const row of rows) {
    statement.run(
      ...(columns.map((column) => {
        if (row[column] !== undefined) return row[column];
        if (table === "source_documents" && column === "is_deleted") return 0;
        if (
          table === "content_asset_management_changes" &&
          column === "revision"
        ) {
          return 0;
        }
        if (
          table === "content_asset_management_changes" &&
          (column === "before_json" || column === "after_json")
        ) {
          return "{}";
        }
        if (
          table === "content_asset_management_changes" &&
          column === "reverted_by_action_id"
        ) {
          return null;
        }
        throw new CompleteArchiveError([
          `${table} 缺少导入所需字段 ${column}。`,
        ]);
      }) as SQLInputValue[]),
    );
  }
}

export function importCompleteAdventure(
  database: DatabaseSync,
  value: unknown,
) {
  const archive = parseCompleteArchiveDocument(value);
  const idMap = new Map<string, string>();
  for (const table of TABLE_NAMES) {
    for (const row of archive.data[table]) {
      if (typeof row.id === "string" && !idMap.has(row.id)) {
        idMap.set(row.id, randomUUID());
      }
      if (typeof row.action_id === "string" && !idMap.has(row.action_id)) {
        idMap.set(row.action_id, randomUUID());
      }
    }
  }

  const importedData = Object.fromEntries(
    TABLE_NAMES.map((table) => [
      table,
      archive.data[table].map((row) => remapRow(row, idMap)),
    ]),
  ) as ArchiveData;
  const now = new Date().toISOString();
  const oldCampaignName = importedData.campaigns[0].name as string;
  const importedCampaignName = `${oldCampaignName}（导入）`.slice(0, 80);
  importedData.campaigns[0].name = importedCampaignName;
  importedData.campaigns[0].updated_at = now;
  const oldSessionName = importedData.sessions[0].name as string;
  importedData.sessions[0].name = oldSessionName.startsWith(oldCampaignName)
    ? `${importedCampaignName}${oldSessionName.slice(oldCampaignName.length)}`
    : `${importedCampaignName} · 导入会话`;
  importedData.sessions[0].updated_at = now;

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const table of TABLE_NAMES) insertRows(database, table, importedData[table]);
    const foreignKeyIssues = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyIssues.length > 0) {
      throw new CompleteArchiveError(["导入后的内部引用校验失败，未写入任何数据。"]);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    archiveId: archive.archiveId,
    campaignId: importedData.campaigns[0].id as string,
    sessionId: importedData.sessions[0].id as string,
    campaignName: importedCampaignName,
    summary: createSummary(importedData),
  };
}
