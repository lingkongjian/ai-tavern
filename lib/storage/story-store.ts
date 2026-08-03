import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  loadStoryMemoryDashboard,
  rebuildStoryMemory as rebuildStoryMemoryIndex,
  recordStoryMemoryRetrieval,
  selectStoryMemoryContext,
  updateStoryMemoryEntry,
  updateStoryMemorySettings,
  type StoryMemoryContext,
  type StoryMemoryDashboard,
  type StoryMemoryTurn,
} from "../memory/剧情记忆.ts";
import {
  rankSourceReferences,
  splitSourceDocument,
  SourceReferenceInputError,
  type SourceDocumentInput,
  type SourceDocumentSummary,
  type SourceReferenceExcerpt,
  type SourceReferenceFidelity,
} from "../reference/原文参考.ts";
import {
  ATTRIBUTE_ROLL_MAX,
  ATTRIBUTE_ROLL_MIN,
  resolveAttributeChecks,
  type AttributeCheckRequest,
} from "../story/判定服务.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type StateEntityType =
  | "character_card"
  | "character_state"
  | "character_card_evolution"
  | "world_book_entry"
  | "relationship"
  | "story_direction"
  | "story_module"
  | "plot_thread"
  | "plot_trigger"
  | "plot_check"
  | "location"
  | "session_state";

export type StateMutationOperation =
  | "merge"
  | "replace"
  | "activate"
  | "deactivate";

export interface TurnMessageInput {
  id?: string;
  role: "player" | "character" | "narrator" | "system";
  speakerId?: string;
  content: string;
  metadata?: JsonObject;
}

export interface TurnEventInput {
  id?: string;
  eventType: string;
  summary: string;
  locationId?: string;
  characterIds?: string[];
  payload?: JsonObject;
}

export interface StateMutationInput {
  id?: string;
  entityType: StateEntityType;
  entityId: string;
  operation: StateMutationOperation;
  value?: JsonObject;
  reason: string;
  evidence: string[];
}

export interface TurnContextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TurnContextSnapshotInput {
  schemaVersion: "1.0.0";
  model: string;
  systemPrompt: string;
  context: JsonObject;
  diagnostics: JsonObject;
  messages: TurnContextMessage[];
  estimatedTokens: number;
  promptTokens?: number;
  requestCount: number;
  repairApplied: boolean;
}

export interface LoadedTurnContextSnapshot extends TurnContextSnapshotInput {
  turnId: string;
  sessionId: string;
  branchId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommitTurnInput {
  id?: string;
  sessionId: string;
  branchId: string;
  expectedHeadTurnId: string | null;
  idempotencyKey?: string;
  playerInput: JsonObject;
  generatedOutput: JsonObject;
  summaryPatch?: string;
  messages?: TurnMessageInput[];
  events?: TurnEventInput[];
  stateMutations?: StateMutationInput[];
  memoryContext?: StoryMemoryContext;
  contextSnapshot?: TurnContextSnapshotInput;
}

export interface ReplaceHeadTurnInput {
  actionId: string;
  feedback: string;
  expectedRegenerationCount: number;
  turnId: string;
  sessionId: string;
  branchId: string;
  expectedParentTurnId: string;
  generatedOutput: JsonObject;
  summaryPatch?: string;
  messages?: TurnMessageInput[];
  events?: TurnEventInput[];
  stateMutations?: StateMutationInput[];
  memoryContext?: StoryMemoryContext;
  contextSnapshot?: TurnContextSnapshotInput;
}

export interface PreparedTurnRegeneration {
  adventureBeforeTurn: LoadedAdventure;
  currentTurn: LoadedTurn;
  regenerationCount: number;
}

export interface CommittedTurn {
  id: string;
  branchId: string;
  parentTurnId: string | null;
  sequence: number;
  createdAt: string;
  reused: boolean;
}

export interface ReplacedTurn extends CommittedTurn {
  regenerationCount: number;
}

export interface MaterializedState {
  entityType: StateEntityType;
  entityId: string;
  state: JsonObject;
  isActive: boolean;
  version: number;
  updatedTurnId: string;
}

export interface LoadedStateChange {
  id: string;
  entityType: StateEntityType;
  entityId: string;
  operation: StateMutationOperation;
  payload: JsonObject;
  reason: string;
  evidence: string[];
  createdAt: string;
}

export interface LoadedBlockedStateChange {
  id: string;
  entityType: StateEntityType;
  entityId: string;
  fieldPaths: string[];
  proposedPayload: JsonObject;
  reason: string;
  createdAt: string;
}

export interface LoadedTurnGeneration {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LoadedTurn {
  id: string;
  branchId: string;
  sequence: number;
  parentTurnId: string | null;
  playerInput: JsonObject;
  generatedOutput: JsonObject;
  summaryPatch: string;
  stateChanges: LoadedStateChange[];
  blockedStateChanges: LoadedBlockedStateChange[];
  generation?: LoadedTurnGeneration;
  createdAt: string;
}

export interface StateFieldLock {
  entityType: StateEntityType;
  entityId: string;
  fieldPath: string;
  reason: string;
  createdAt: string;
}

export interface StateAuditFieldDiff {
  path: string;
  beforeExists: boolean;
  before?: JsonValue;
  afterExists: boolean;
  after?: JsonValue;
  locked: boolean;
}

export interface StateAuditSnapshot {
  state: JsonObject;
  isActive: boolean;
}

export interface StateAuditChange {
  id: string;
  entityType: StateEntityType;
  entityId: string;
  operation: StateMutationOperation;
  reason: string;
  before?: StateAuditSnapshot | null;
  after?: StateAuditSnapshot;
  fields: StateAuditFieldDiff[];
  canRollback: boolean;
}

export interface StateAuditAction {
  id: string;
  source:
    | "turn"
    | "character_management"
    | "location_management"
    | "story_module_management"
    | "plot_thread_management"
    | "plot_trigger_management"
    | "world_book_management"
    | "rollback";
  title: string;
  sequence: number;
  referenceTurnId: string;
  createdAt: string;
  changes: StateAuditChange[];
}

export interface StateAuditDashboard {
  branchId: string;
  branchName: string;
  actions: StateAuditAction[];
  locks: StateFieldLock[];
}

export type StateAuditControlInput =
  | {
      actionId: string;
      sessionId: string;
      operation: "rollback";
      changeId: string;
      reason: string;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "set_lock";
      entityType: StateEntityType;
      entityId: string;
      fieldPath: string;
      locked: boolean;
      reason: string;
    };

export interface ManagedStateAuditResult {
  actionId: string;
  operation: StateAuditControlInput["operation"];
  reused: boolean;
}

export interface TurnHistoryEntry {
  id: string;
  branchId: string;
  sequence: number;
  summaryPatch: string;
  createdAt: string;
}

export interface LoadedBranchState {
  branch: {
    id: string;
    name: string;
    sessionId: string;
    parentBranchId: string | null;
    forkedFromTurnId: string | null;
    headTurnId: string | null;
    nextSequence: number;
  };
  states: MaterializedState[];
  recentTurns: LoadedTurn[];
  turnHistory: TurnHistoryEntry[];
}

export interface AdventureCharacterInput {
  name: string;
  role: string;
  personality: string;
  firstMessage?: string;
  card?: JsonObject;
  initiallyPresent?: boolean;
}

export interface AdventureWorldBookEntryInput {
  sourceId?: string;
  sourceBookName?: string;
  sourceFormat?: string;
  comment?: string;
  keys: string[];
  secondaryKeys?: string[];
  content: string;
  enabled: boolean;
  constant?: boolean;
  selective?: boolean;
  position?: "before_char" | "after_char";
  order?: number;
  probability?: number;
  depth?: number;
  extensions?: JsonObject;
}

export type WorldBookManagementInput =
  | {
      actionId: string;
      sessionId: string;
      operation: "create";
      entry: AdventureWorldBookEntryInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "update";
      entryId: string;
      entry: AdventureWorldBookEntryInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "set_enabled";
      entryId: string;
      enabled: boolean;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "remove" | "restore_base";
      entryId: string;
    };

export interface ManagedWorldBookResult {
  actionId: string;
  entryId: string;
  operation: WorldBookManagementInput["operation"];
  reused: boolean;
  overridesEntryId?: string;
}

export interface AdventureStoryModuleInput {
  id: string;
  title: string;
  objective: string;
  completionCriteria: string[];
  activationConditions?: string[];
  prerequisiteModuleIds?: string[];
  continuityNotes?: string;
  autoContinue?: boolean;
  deadlineDay?: number;
}

export type CharacterManagementInput =
  | {
      actionId: string;
      sessionId: string;
      operation: "create";
      character: AdventureCharacterInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "update";
      characterId: string;
      character: AdventureCharacterInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "set_presence";
      characterId: string;
      present: boolean;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "set_active";
      characterId: string;
      active: boolean;
    };

export interface ManagedCharacterResult {
  actionId: string;
  characterId: string;
  operation: CharacterManagementInput["operation"];
  reused: boolean;
}

export interface AdventureLocationInput {
  name: string;
  description: string;
  defaultCharacterIds: string[];
}

export type LocationManagementInput =
  | {
      actionId: string;
      sessionId: string;
      operation: "create";
      location: AdventureLocationInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "update";
      locationId: string;
      location: AdventureLocationInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "set_current";
      locationId: string;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "set_active";
      locationId: string;
      active: boolean;
    };

export interface ManagedLocationResult {
  actionId: string;
  locationId: string;
  operation: LocationManagementInput["operation"];
  reused: boolean;
}

export type StoryModuleManagementInput =
  | {
      actionId: string;
      sessionId: string;
      operation: "create";
      module: AdventureStoryModuleInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "update";
      moduleId: string;
      module: AdventureStoryModuleInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "set_active";
      moduleId: string;
      active: boolean;
    };

export interface ManagedStoryModuleResult {
  actionId: string;
  moduleId: string;
  operation: StoryModuleManagementInput["operation"];
  reused: boolean;
}

export type PlotThreadManagementInput =
  | {
      actionId: string;
      sessionId: string;
      operation: "create";
      thread: AdventureForeshadowingInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "update";
      threadId: string;
      thread: AdventureForeshadowingInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "delete";
      threadId: string;
    };

export interface ManagedPlotThreadResult {
  actionId: string;
  threadId: string;
  operation: PlotThreadManagementInput["operation"];
  reused: boolean;
}

export type PlotTriggerManagementInput =
  | {
      actionId: string;
      sessionId: string;
      operation: "create";
      trigger: AdventureTriggerInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "update";
      triggerId: string;
      trigger: AdventureTriggerInput;
    }
  | {
      actionId: string;
      sessionId: string;
      operation: "delete";
      triggerId: string;
    };

export interface ManagedPlotTriggerResult {
  actionId: string;
  triggerId: string;
  operation: PlotTriggerManagementInput["operation"];
  reused: boolean;
}

export interface PendingTurnRecord {
  id: string;
  sessionId: string;
  branchId: string;
  kind: "advance" | "regenerate";
  expectedHeadTurnId: string;
  expectedParentTurnId: string | null;
  idempotencyKey: string;
  feedback: string;
  expectedRegenerationCount: number;
  playerInput: JsonObject;
  generatedOutput: JsonObject;
  summaryPatch: string;
  contextSnapshot: JsonObject;
  memoryContext: JsonObject;
  stateMutations: StateMutationInput[];
  messages: TurnMessageInput[];
  events: TurnEventInput[];
  createdAt: string;
}

export interface SavePendingTurnInput {
  id: string;
  sessionId: string;
  branchId: string;
  kind: "advance" | "regenerate";
  expectedHeadTurnId: string;
  expectedParentTurnId: string | null;
  idempotencyKey: string;
  feedback: string;
  expectedRegenerationCount: number;
  playerInput: JsonObject;
  generatedOutput: JsonObject;
  summaryPatch: string;
  contextSnapshot: JsonObject;
  memoryContext: JsonObject;
  stateMutations: StateMutationInput[];
  messages: TurnMessageInput[];
  events: TurnEventInput[];
}

export interface ResolvePendingTurnChecksInput {
  sessionId: string;
  pendingTurnId: string;
  expectedHeadTurnId: string;
  results: Array<{
    checkId: string;
    roll: number | null;
  }>;
}

export interface AttributeCheckResolutionRecord {
  checkId: string;
  characterId: string;
  attribute: string;
  difficulty: number;
  context: string;
  attributeValue: number;
  margin: number;
  direct: boolean;
  roll: number | null;
  finalValue: number;
  outcome: string;
  outcomeLabel: string;
}

export interface ResolvedTurnBackfill {
  committedTurn: CommittedTurn | ReplacedTurn;
  resolutions: AttributeCheckResolutionRecord[];
}

export interface AdventureRelationshipInput {
  sourceCharacterName: string;
  targetCharacterName: string;
  dimensions?: {
    trust?: number;
    affinity?: number;
    fear?: number;
    hostility?: number;
    respect?: number;
  };
  summary?: string;
}

export interface AdventureDeclaredLocation {
  name: string;
  description: string;
  characters?: string[];
  important?: boolean;
}

export interface AdventureForeshadowingInput {
  id: string;
  keywords: string[];
  seedCondition: string;
  payoffCondition: string;
  payoffSummary: string;
  characters?: string[];
}

export type AdventureTriggerStateEffectRelation = {
  sourceCharacterName: string;
  targetCharacterName: string;
  dimension: "trust" | "affection" | "fear" | "hostility" | "respect";
  delta: number;
};

export type AdventureTriggerStateEffectAttribute = {
  characterName: string;
  attribute: string;
  value: number;
};

export type AdventureTriggerStateEffects = {
  relations?: AdventureTriggerStateEffectRelation[];
  flags?: string[];
  attributes?: AdventureTriggerStateEffectAttribute[];
};

export interface AdventureTriggerInput {
  id: string;
  when: string;
  consequence: string;
  stateEffects?: AdventureTriggerStateEffects;
  deadlineDay?: number;
}

export interface StartAdventureInput {
  campaignName: string;
  campaignDescription?: string;
  world: {
    name: string;
    premise: string;
  };
  player: {
    name: string;
    description: string;
    card?: JsonObject;
  };
  mainCharacter: AdventureCharacterInput;
  additionalCharacters?: AdventureCharacterInput[];
  worldBookEntries?: AdventureWorldBookEntryInput[];
  sourceDocuments?: SourceDocumentInput[];
  openingLocationName?: string;
  openingScene: string;
  initialStoryDirection?: string;
  storyModules?: AdventureStoryModuleInput[];
  initialStoryModuleId?: string;
  initialRelationships?: AdventureRelationshipInput[];
  locations?: AdventureDeclaredLocation[];
  foreshadowing?: AdventureForeshadowingInput[];
  triggers?: AdventureTriggerInput[];
}

export interface SourceDocumentUpdateInput {
  enabled?: boolean;
  currentChapter?: number;
  preventFuture?: boolean;
  fidelity?: SourceReferenceFidelity;
}

export type ContentAssetManagementInput =
  | {
      actionId: string;
      sessionId: string;
      domain: "sources";
      operation: "import";
      document: SourceDocumentInput;
    }
  | {
      actionId: string;
      sessionId: string;
      domain: "sources";
      operation: "update";
      documentId: string;
      settings: SourceDocumentUpdateInput;
    }
  | {
      actionId: string;
      sessionId: string;
      domain: "sources";
      operation: "remove";
      documentId: string;
    }
  | {
      actionId: string;
      sessionId: string;
      domain: "memories";
      operation: "update_entry";
      entryId: string;
      patch: {
        title?: string;
        content?: string;
        importance?: number;
        status?: "active" | "resolved";
        pinned?: boolean;
        enabled?: boolean;
      };
    }
  | {
      actionId: string;
      sessionId: string;
      domain: "memories";
      operation: "update_settings";
      settings: {
        memoryTokenBudget: number;
        recentTurnCount: number;
        chapterSize: number;
      };
    }
  | {
      actionId: string;
      sessionId: string;
      domain: "memories";
      operation: "rebuild";
    }
  | {
      actionId: string;
      sessionId: string;
      domain: "sources" | "memories";
      operation: "rollback";
      changeId: string;
      reason: string;
    };

export interface ManagedContentAssetResult {
  actionId: string;
  domain: ContentAssetManagementInput["domain"];
  operation: ContentAssetManagementInput["operation"];
  targetId: string;
  reused: boolean;
}

export interface ContentAssetManagementChange {
  id: string;
  actionId: string;
  branchId: string;
  referenceTurnId: string;
  domain: ContentAssetManagementInput["domain"];
  operation: ContentAssetManagementInput["operation"];
  targetId: string;
  summary: JsonObject;
  revision: number;
  before: JsonObject;
  after: JsonObject;
  revertedByActionId: string | null;
  canRollback: boolean;
  rollbackBlockedReason: string | null;
  createdAt: string;
}

export interface StartedAdventure {
  campaignId: string;
  sessionId: string;
  branchId: string;
  openingTurnId: string;
  playerCharacterId: string;
  mainCharacterId: string;
  additionalCharacterIds: string[];
}

export interface AdventureSummary {
  campaignId: string;
  campaignName: string;
  campaignDescription: string;
  sessionId: string;
  sessionName: string;
  branchId: string;
  worldName: string;
  playerName: string;
  mainCharacterName: string;
  updatedAt: string;
}

export interface RenamedAdventure {
  campaignId: string;
  sessionId: string;
  name: string;
  sessionName: string;
  updatedAt: string;
  changed: boolean;
}

export interface LoadedAdventure {
  campaign: {
    id: string;
    name: string;
    description: string;
  };
  session: {
    id: string;
    name: string;
    status: string;
    updatedAt: string;
  };
  branchState: LoadedBranchState;
}

export interface AdventureBranchSummary {
  id: string;
  name: string;
  parentBranchId: string | null;
  forkedFromTurnId: string | null;
  headTurnId: string | null;
  headSequence: number;
  turnCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdventureRecoveryPoint {
  id: string;
  type: "manual" | "automatic" | "fork";
  name: string;
  branchId: string;
  branchName: string;
  turnId: string;
  sequence: number;
  createdAt: string;
}

export interface CreatedAdventureBranch {
  branchId: string;
  name: string;
  sourceTurnId: string;
  sourceSequence: number;
}

interface BranchRow {
  id: string;
  session_id: string;
  name: string;
  parent_branch_id: string | null;
  forked_from_turn_id: string | null;
  head_turn_id: string | null;
  next_sequence: number;
  created_at: string;
  updated_at: string;
}

interface TurnRow {
  id: string;
  branch_id: string;
  parent_turn_id: string | null;
  sequence: number;
  player_input_json?: string;
  generated_output_json?: string;
  summary_patch?: string;
  created_at: string;
}

interface PendingTurnRow {
  id: string;
  session_id: string;
  branch_id: string;
  kind: string;
  expected_head_turn_id: string;
  expected_parent_turn_id: string | null;
  idempotency_key: string;
  feedback: string;
  expected_regeneration_count: number;
  player_input_json: string;
  generated_output_json: string;
  summary_patch: string;
  context_snapshot_json: string;
  memory_context_json: string;
  state_mutations_json: string;
  messages_json: string;
  events_json: string;
  created_at: string;
}

interface MaterializedStateRow {
  entity_type: StateEntityType;
  entity_id: string;
  state_json: string;
  is_active: number;
  version: number;
  updated_turn_id: string;
  updated_at?: string;
}

interface StateChangeRow {
  id: string;
  turn_id: string;
  entity_type: StateEntityType;
  entity_id: string;
  operation: StateMutationOperation;
  payload_json: string;
  reason: string;
  evidence_json: string;
  created_at: string;
}

interface GenerationMetadataRow {
  turn_id: string;
  metadata_json: string;
}

interface TurnHistoryRow {
  id: string;
  branch_id: string;
  sequence: number;
  summary_patch: string;
  created_at: string;
}

interface ReplayMutationRow {
  sequence: number;
  source_order: number;
  action_id: string;
  ordinal: number;
  entity_type: StateEntityType;
  entity_id: string;
  operation: StateMutationOperation;
  payload_json: string;
  result_active: number | null;
  updated_turn_id: string;
  created_at: string;
}

interface StateAuditMutationRow extends ReplayMutationRow {
  id: string;
  source: StateAuditAction["source"];
  reason: string;
  summary_patch: string;
}

interface ReplayedMaterializedState extends MaterializedState {
  updatedAt: string;
}

interface AdventureSummaryRow {
  campaign_id: string;
  campaign_name: string;
  campaign_description: string;
  session_id: string;
  session_name: string;
  branch_id: string;
  session_state_json: string | null;
  updated_at: string;
}

interface SourceDocumentRow {
  id: string;
  name: string;
  file_name: string;
  content_length: number;
  chapter_count: number;
  chunk_count: number;
  enabled: number;
  current_chapter: number;
  prevent_future: number;
  fidelity: SourceReferenceFidelity;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}

interface SourceChunkRow {
  id: string;
  document_id: string;
  document_name: string;
  file_name: string;
  ordinal: number;
  chapter_index: number;
  chapter_title: string;
  content: string;
  character_names_json: string;
  current_chapter: number;
  fidelity: SourceReferenceFidelity;
}

interface ContentAssetManagementRow {
  id: string;
  action_id: string;
  branch_id: string;
  reference_turn_id: string;
  domain: ContentAssetManagementInput["domain"];
  operation: ContentAssetManagementInput["operation"];
  target_id: string;
  request_hash: string;
  summary_json: string;
  revision: number;
  before_json: string;
  after_json: string;
  reverted_by_action_id: string | null;
  created_at: string;
}

interface MemoryEntrySnapshotRow {
  title: string;
  content: string;
  importance: number;
  status: "active" | "resolved";
  pinned: number;
  enabled: number;
  source: "automatic" | "manual";
}

interface MemorySettingsSnapshotRow {
  memory_token_budget: number;
  recent_turn_count: number;
  chapter_size: number;
}

export class BranchHeadConflictError extends Error {
  public readonly expectedHeadTurnId: string | null;
  public readonly actualHeadTurnId: string | null;

  constructor(
    expectedHeadTurnId: string | null,
    actualHeadTurnId: string | null,
  ) {
    super("剧情分支已经发生变化，请重新载入后再提交本轮。");
    this.name = "BranchHeadConflictError";
    this.expectedHeadTurnId = expectedHeadTurnId;
    this.actualHeadTurnId = actualHeadTurnId;
  }
}

export class StoryNotFoundError extends Error {
  constructor(message = "没有找到指定的剧情会话。") {
    super(message);
    this.name = "StoryNotFoundError";
  }
}

export class CharacterManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterManagementError";
  }
}

export class LocationManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocationManagementError";
  }
}

export class StoryModuleManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryModuleManagementError";
  }
}

export class PlotThreadManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlotThreadManagementError";
  }
}

export class PlotTriggerManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlotTriggerManagementError";
  }
}

export class WorldBookManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldBookManagementError";
  }
}

export class ContentAssetManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentAssetManagementError";
  }
}

export class StateAuditManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateAuditManagementError";
  }
}

export class BranchManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BranchManagementError";
  }
}

export class SavePointManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavePointManagementError";
  }
}

export class TurnRegenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnRegenerationError";
  }
}

export class TurnRegenerationConflictError extends Error {
  constructor() {
    super("最新剧情在重生成期间已经发生变化，请重新载入后再试。");
    this.name = "TurnRegenerationConflictError";
  }
}

export class AttributeCheckResolutionError extends Error {
  public readonly issues: string[];

  constructor(message: string) {
    super(message);
    this.name = "AttributeCheckResolutionError";
    this.issues = [message];
  }
}

function requireText(value: string, label: string) {
  if (!value.trim()) {
    throw new Error(`${label}不能为空。`);
  }
}

function stringifyJson(value: JsonValue) {
  return JSON.stringify(value);
}

function parseObject(value: string): JsonObject {
  const parsed = JSON.parse(value) as JsonValue;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("数据库中的状态不是有效 JSON 对象。");
  }
  return parsed;
}

function parseStringArray(value: string) {
  const parsed = JSON.parse(value) as JsonValue;
  if (!Array.isArray(parsed)) {
    throw new Error("数据库中的证据引用不是有效 JSON 数组。");
  }
  return parsed.filter((item): item is string => typeof item === "string");
}

function parseArrayValue(value: string): JsonValue[] {
  const parsed = JSON.parse(value) as JsonValue;
  return Array.isArray(parsed) ? parsed : [];
}

function readString(value: JsonValue | undefined) {
  return typeof value === "string" ? value : "";
}

function readObject(value: JsonValue | undefined) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function isValidAttributeRoll(value: number) {
  return (
    Number.isInteger(value) &&
    value >= ATTRIBUTE_ROLL_MIN &&
    value <= ATTRIBUTE_ROLL_MAX
  );
}

function readAttributeChecks(
  generatedOutput: JsonObject,
): Array<{
  id: string;
  characterId: string;
  attribute: string;
  difficulty: number;
  context: string;
}> {
  if (!Array.isArray(generatedOutput.attributeChecks)) return [];
  return generatedOutput.attributeChecks.flatMap((value) => {
    if (!isJsonObject(value)) return [];
    const id = readString(value.id);
    const characterId = readString(value.characterId);
    const attribute = readString(value.attribute);
    const difficulty =
      typeof value.difficulty === "number" ? value.difficulty : 50;
    const context = readString(value.context);
    if (!id || !characterId || !attribute) return [];
    return [
      {
        id,
        characterId,
        attribute,
        difficulty,
        context,
      },
    ];
  });
}

function readAttributeCheckResults(
  generatedOutput: JsonObject,
): AttributeCheckResolutionRecord[] {
  if (!Array.isArray(generatedOutput.attributeCheckResults)) return [];
  return generatedOutput.attributeCheckResults.flatMap((value) => {
    if (!isJsonObject(value)) return [];
    return [
      {
        checkId: readString(value.checkId),
        characterId: readString(value.characterId),
        attribute: readString(value.attribute),
        difficulty:
          typeof value.difficulty === "number" ? value.difficulty : 0,
        context: readString(value.context),
        attributeValue:
          typeof value.attributeValue === "number" ? value.attributeValue : 0,
        margin: typeof value.margin === "number" ? value.margin : 0,
        direct: value.direct === true,
        roll:
          value.roll === null || typeof value.roll !== "number"
            ? null
            : value.roll,
        finalValue:
          typeof value.finalValue === "number" ? value.finalValue : 0,
        outcome: readString(value.outcome),
        outcomeLabel: readString(value.outcomeLabel),
      },
    ];
  });
}

function readOptionalNumber(value: JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function mapSourceDocument(row: SourceDocumentRow): SourceDocumentSummary {
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    contentLength: row.content_length,
    chapterCount: row.chapter_count,
    chunkCount: row.chunk_count,
    enabled: row.enabled === 1,
    currentChapter: row.current_chapter,
    preventFuture: row.prevent_future === 1,
    fidelity: row.fidelity === "faithful" ? "faithful" : "balanced",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sourceDocumentSnapshot(row: SourceDocumentRow): JsonObject {
  return {
    name: row.name,
    fileName: row.file_name,
    contentLength: row.content_length,
    chapterCount: row.chapter_count,
    chunkCount: row.chunk_count,
    enabled: row.enabled === 1,
    currentChapter: row.current_chapter,
    preventFuture: row.prevent_future === 1,
    fidelity: row.fidelity,
    isDeleted: row.is_deleted === 1,
  };
}

function memoryEntrySnapshot(row: MemoryEntrySnapshotRow): JsonObject {
  return {
    title: row.title,
    content: row.content,
    importance: row.importance,
    status: row.status,
    pinned: row.pinned === 1,
    enabled: row.enabled === 1,
    source: row.source,
  };
}

function memorySettingsSnapshot(row: MemorySettingsSnapshotRow): JsonObject {
  return {
    memoryTokenBudget: row.memory_token_budget,
    recentTurnCount: row.recent_turn_count,
    chapterSize: row.chapter_size,
  };
}

function sameJson(left: JsonObject, right: JsonObject) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function contentAssetRequestHash(input: ContentAssetManagementInput) {
  const request = JSON.stringify(input, (key, value) =>
    key === "actionId" ? undefined : value,
  );
  return createHash("sha256").update(request).digest("hex");
}

function contentAssetSummary(input: ContentAssetManagementInput): JsonObject {
  switch (input.domain) {
    case "sources":
      switch (input.operation) {
        case "import":
          return {
            name: input.document.name,
            fileName: input.document.fileName,
            contentLength: input.document.content.length,
            enabled: input.document.enabled,
            currentChapter: input.document.currentChapter,
            preventFuture: input.document.preventFuture,
            fidelity: input.document.fidelity,
          };
        case "update":
          return JSON.parse(JSON.stringify(input.settings)) as JsonObject;
        case "remove":
          return {};
        case "rollback":
          return { changeId: input.changeId, reason: input.reason };
      }
    case "memories":
      switch (input.operation) {
        case "update_entry":
          return {
            changedFields: Object.keys(input.patch).filter(
              (key) => input.patch[key as keyof typeof input.patch] !== undefined,
            ),
            ...(input.patch.title === undefined
              ? {}
              : { title: input.patch.title }),
            ...(input.patch.content === undefined
              ? {}
              : { contentLength: input.patch.content.length }),
          };
        case "update_settings":
          return { ...input.settings };
        case "rebuild":
          return {};
        case "rollback":
          return { changeId: input.changeId, reason: input.reason };
      }
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function createSetupCharacterCard(
  character: AdventureCharacterInput,
  role: "player" | "character",
  scenario: string,
  roleTag: string,
): JsonObject {
  const importedCard = character.card ? structuredClone(character.card) : {};
  const importedData = isJsonObject(importedCard.data)
    ? importedCard.data
    : {};
  const importedExtensions = isJsonObject(importedData.extensions)
    ? importedData.extensions
    : {};
  const tavernExtension = isJsonObject(importedExtensions.ai_tavern)
    ? importedExtensions.ai_tavern
    : {};
  const importedTags = Array.isArray(importedData.tags)
    ? importedData.tags.filter(
        (item): item is string => typeof item === "string" && Boolean(item),
      )
    : [];
  const cardScenario = readString(importedData.scenario) || scenario;

  return {
    ...importedCard,
    spec:
      importedCard.spec === "chara_card_v3"
        ? "chara_card_v3"
        : "chara_card_v2",
    spec_version:
      importedCard.spec === "chara_card_v3" ? "3.0" : "2.0",
    role,
    data: {
      ...importedData,
      name: character.name.trim(),
      description: character.role.trim(),
      personality:
        character.personality.trim() || readString(importedData.personality),
      scenario: cardScenario,
      first_mes:
        character.firstMessage?.trim() || readString(importedData.first_mes),
      mes_example: readString(importedData.mes_example),
      creator_notes:
        readString(importedData.creator_notes) || "由 AI 酒馆开局向导创建",
      system_prompt: readString(importedData.system_prompt),
      post_history_instructions: readString(
        importedData.post_history_instructions,
      ),
      alternate_greetings: Array.isArray(importedData.alternate_greetings)
        ? importedData.alternate_greetings
        : [],
      tags: [...new Set([...importedTags, roleTag])],
      extensions: {
        ...importedExtensions,
        ai_tavern: { ...tavernExtension, role },
      },
    },
  };
}

/** 使用 JSON Merge Patch 语义：对象递归合并，null 删除字段，数组整体替换。 */
export function applyStateMergePatch(target: JsonObject, patch: JsonObject) {
  const result: JsonObject = structuredClone(target);

  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) {
      delete result[key];
      continue;
    }

    const currentValue = result[key];
    result[key] =
      isJsonObject(patchValue) && isJsonObject(currentValue)
        ? applyStateMergePatch(currentValue, patchValue)
        : structuredClone(patchValue);
  }

  return result;
}

function escapeJsonPointerSegment(segment: string) {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapeJsonPointerSegment(segment: string) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerSegments(path: string) {
  if (!path.startsWith("/")) return [];
  return path
    .slice(1)
    .split("/")
    .filter(Boolean)
    .map(unescapeJsonPointerSegment);
}

function jsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readPointer(root: JsonObject, path: string) {
  let current: JsonValue = root;
  for (const segment of pointerSegments(path)) {
    if (!isJsonObject(current) || !(segment in current)) {
      return { exists: false as const };
    }
    current = current[segment];
  }
  return { exists: true as const, value: structuredClone(current) };
}

function writePointer(root: JsonObject, path: string, value: JsonValue) {
  const segments = pointerSegments(path);
  if (segments.length === 0) return;
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (!isJsonObject(child)) current[segment] = {};
    current = current[segment] as JsonObject;
  }
  current[segments.at(-1)!] = structuredClone(value);
}

function deletePointer(root: JsonObject, path: string) {
  const segments = pointerSegments(path);
  if (segments.length === 0) return;
  let current: JsonObject = root;
  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (!isJsonObject(child)) return;
    current = child;
  }
  delete current[segments.at(-1)!];
}

function pathIsLocked(path: string, locks: Set<string>) {
  if (locks.has("*")) return true;
  for (const lockedPath of locks) {
    if (
      lockedPath !== "$active" &&
      (path === lockedPath || path.startsWith(`${lockedPath}/`))
    ) {
      return true;
    }
  }
  return false;
}

function collectStateDiffs(input: {
  before: StateAuditSnapshot | null;
  after: StateAuditSnapshot;
  locks: Set<string>;
}) {
  const fields: StateAuditFieldDiff[] = [];
  const visit = (
    before: JsonValue | undefined,
    beforeExists: boolean,
    after: JsonValue | undefined,
    afterExists: boolean,
    path: string,
  ) => {
    if (beforeExists && afterExists && jsonValuesEqual(before, after)) return;
    if (
      before !== undefined &&
      after !== undefined &&
      isJsonObject(before) &&
      isJsonObject(after)
    ) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of [...keys].sort()) {
        const nextPath = `${path}/${escapeJsonPointerSegment(key)}`;
        visit(
          before[key],
          key in before,
          after[key],
          key in after,
          nextPath,
        );
      }
      return;
    }
    fields.push({
      path: path || "/",
      beforeExists,
      ...(beforeExists ? { before: structuredClone(before as JsonValue) } : {}),
      afterExists,
      ...(afterExists ? { after: structuredClone(after as JsonValue) } : {}),
      locked: pathIsLocked(path || "/", input.locks),
    });
  };
  visit(
    input.before?.state,
    input.before !== null,
    input.after.state,
    true,
    "",
  );
  if ((input.before?.isActive ?? false) !== input.after.isActive) {
    fields.push({
      path: "$active",
      beforeExists: input.before !== null,
      ...(input.before !== null ? { before: input.before.isActive } : {}),
      afterExists: true,
      after: input.after.isActive,
      locked: input.locks.has("*") || input.locks.has("$active"),
    });
  }
  return fields;
}

function filterMergePatchByLocks(
  value: JsonObject,
  locks: Set<string>,
  blockedPaths: Set<string>,
  parentPath = "",
): JsonObject {
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const path = `${parentPath}/${escapeJsonPointerSegment(key)}`;
    if (pathIsLocked(path, locks)) {
      blockedPaths.add(path);
      continue;
    }
    if (isJsonObject(item)) {
      const nested = filterMergePatchByLocks(item, locks, blockedPaths, path);
      if (Object.keys(nested).length > 0) result[key] = nested;
      continue;
    }
    result[key] = structuredClone(item);
  }
  return result;
}

function protectMutationWithLocks(input: {
  mutation: StateMutationInput;
  currentState: JsonObject;
  currentActive: boolean;
  locks: Set<string>;
}) {
  const { mutation, currentState, currentActive, locks } = input;
  if (locks.size === 0) {
    return { mutation, blockedPaths: [] as string[], resultActive: undefined };
  }
  const blockedPaths = new Set<string>();
  if (locks.has("*")) {
    blockedPaths.add("*");
    return { mutation: null, blockedPaths: [...blockedPaths], resultActive: undefined };
  }
  if (mutation.operation === "deactivate") {
    if (locks.has("$active")) {
      blockedPaths.add("$active");
      return { mutation: null, blockedPaths: [...blockedPaths], resultActive: undefined };
    }
    return { mutation, blockedPaths: [], resultActive: undefined };
  }

  let operation = mutation.operation;
  let value = structuredClone(mutation.value ?? {});
  let resultActive: boolean | undefined;
  if (operation === "replace") {
    for (const lockedPath of locks) {
      if (lockedPath === "$active") continue;
      const current = readPointer(currentState, lockedPath);
      const proposed = readPointer(value, lockedPath);
      if (
        current.exists !== proposed.exists ||
        (current.exists && proposed.exists && !jsonValuesEqual(current.value, proposed.value))
      ) {
        blockedPaths.add(lockedPath);
      }
      if (current.exists) writePointer(value, lockedPath, current.value);
      else deletePointer(value, lockedPath);
    }
    if (locks.has("$active") && !currentActive) {
      blockedPaths.add("$active");
      resultActive = currentActive;
    }
  } else {
    value = filterMergePatchByLocks(value, locks, blockedPaths);
    if (operation === "activate" && locks.has("$active") && !currentActive) {
      blockedPaths.add("$active");
      operation = "merge";
    }
  }
  if (Object.keys(value).length === 0 && operation === "merge") {
    return { mutation: null, blockedPaths: [...blockedPaths], resultActive };
  }
  return {
    mutation: { ...mutation, operation, value },
    blockedPaths: [...blockedPaths],
    resultActive,
  };
}

function validateCommitInput(input: CommitTurnInput) {
  requireText(input.sessionId, "sessionId");
  requireText(input.branchId, "branchId");

  for (const message of input.messages ?? []) {
    requireText(message.content, "消息内容");
  }

  for (const event of input.events ?? []) {
    requireText(event.eventType, "事件类型");
    requireText(event.summary, "事件摘要");
  }

  for (const mutation of input.stateMutations ?? []) {
    requireText(mutation.entityId, "状态实体 ID");
    requireText(mutation.reason, "状态变化原因");
    if (mutation.evidence.length === 0) {
      throw new Error("每项状态变化至少需要一条剧情证据。");
    }
    if (
      mutation.operation !== "deactivate" &&
      mutation.value === undefined
    ) {
      throw new Error(`${mutation.operation} 状态变化缺少 value。`);
    }
  }
}

export class LocalStoryStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  private writeTurnContextSnapshot(input: {
    turnId: string;
    sessionId: string;
    branchId: string;
    snapshot: TurnContextSnapshotInput;
    now: string;
  }) {
    this.database
      .prepare(`
        INSERT INTO turn_context_snapshots (
          turn_id, session_id, branch_id, schema_version, model,
          system_prompt, context_json, diagnostics_json, messages_json,
          estimated_tokens, prompt_tokens, request_count, repair_applied,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(turn_id) DO UPDATE SET
          session_id = excluded.session_id,
          branch_id = excluded.branch_id,
          schema_version = excluded.schema_version,
          model = excluded.model,
          system_prompt = excluded.system_prompt,
          context_json = excluded.context_json,
          diagnostics_json = excluded.diagnostics_json,
          messages_json = excluded.messages_json,
          estimated_tokens = excluded.estimated_tokens,
          prompt_tokens = excluded.prompt_tokens,
          request_count = excluded.request_count,
          repair_applied = excluded.repair_applied,
          updated_at = excluded.updated_at
      `)
      .run(
        input.turnId,
        input.sessionId,
        input.branchId,
        input.snapshot.schemaVersion,
        input.snapshot.model,
        input.snapshot.systemPrompt,
        stringifyJson(input.snapshot.context),
        stringifyJson(input.snapshot.diagnostics),
        JSON.stringify(input.snapshot.messages),
        input.snapshot.estimatedTokens,
        input.snapshot.promptTokens ?? null,
        input.snapshot.requestCount,
        input.snapshot.repairApplied ? 1 : 0,
        input.now,
        input.now,
      );
  }

  startAdventure(input: StartAdventureInput): StartedAdventure {
    requireText(input.campaignName, "战役名称");
    requireText(input.world.name, "世界名称");
    requireText(input.world.premise, "世界观概要");
    requireText(input.player.name, "玩家角色名");
    requireText(input.player.description, "玩家角色设定");
    requireText(input.mainCharacter.name, "主要角色名");
    requireText(input.mainCharacter.role, "主要角色身份");
    requireText(input.mainCharacter.personality, "主要角色性格");
    for (const [index, character] of (input.additionalCharacters ?? []).entries()) {
      requireText(character.name, `其他角色 ${index + 1} 姓名`);
      requireText(character.role, `其他角色 ${index + 1} 身份`);
      requireText(character.personality, `其他角色 ${index + 1} 性格`);
    }
    if ((input.worldBookEntries?.length ?? 0) > 200) {
      throw new Error("开局最多可以导入 200 条世界书条目。");
    }
    for (const [index, entry] of (input.worldBookEntries ?? []).entries()) {
      requireText(entry.content, `世界书条目 ${index + 1} 正文`);
      if (!entry.constant && entry.keys.length === 0) {
        throw new Error(
          `世界书条目 ${index + 1} 必须提供触发词或设为常驻。`,
        );
      }
    }
    if ((input.sourceDocuments?.length ?? 0) > 5) {
      throw new Error("每个剧本最多可以导入 5 份原文参考。");
    }
    for (const [index, document] of (input.sourceDocuments ?? []).entries()) {
      requireText(document.name, `原文参考 ${index + 1} 名称`);
      requireText(document.fileName, `原文参考 ${index + 1} 文件名`);
      requireText(document.content, `原文参考 ${index + 1} 正文`);
      if (document.content.length > 2_000_000) {
        throw new Error(`原文参考 ${index + 1} 不能超过 200 万字符。`);
      }
    }
    requireText(input.openingScene, "开场场景");
    if ((input.storyModules?.length ?? 0) > 30) {
      throw new Error("剧本包最多可以预埋 30 个剧情任务模块。");
    }
    const storyModuleIds = new Set<string>();
    for (const [index, storyModule] of (input.storyModules ?? []).entries()) {
      requireText(storyModule.id, `剧情任务 ${index + 1} ID`);
      requireText(storyModule.title, `剧情任务 ${index + 1} 标题`);
      requireText(storyModule.objective, `剧情任务 ${index + 1} 目标`);
      if (storyModuleIds.has(storyModule.id.trim())) {
        throw new Error(`剧情任务 ID ${storyModule.id.trim()} 重复。`);
      }
      storyModuleIds.add(storyModule.id.trim());
      if (storyModule.completionCriteria.length === 0) {
        throw new Error(`剧情任务《${storyModule.title}》至少需要一项完成条件。`);
      }
    }
    if (
      input.initialStoryModuleId &&
      !storyModuleIds.has(input.initialStoryModuleId.trim())
    ) {
      throw new Error("开场任务 ID 不存在于剧情任务模块中。");
    }
    for (const storyModule of input.storyModules ?? []) {
      for (const prerequisiteId of storyModule.prerequisiteModuleIds ?? []) {
        if (!storyModuleIds.has(prerequisiteId)) {
          throw new Error(
            `剧情任务《${storyModule.title}》引用了不存在的前置任务 ${prerequisiteId}。`,
          );
        }
        if (prerequisiteId === storyModule.id) {
          throw new Error(`剧情任务《${storyModule.title}》不能把自己设为前置任务。`);
        }
      }
    }

    const campaignId = randomUUID();
    const sessionId = randomUUID();
    const branchId = randomUUID();
    const openingTurnId = randomUUID();
    const openingEventId = randomUUID();
    const openingLocationId = randomUUID();
    const playerCharacterId = randomUUID();
    const mainCharacterId = randomUUID();
    const additionalCharacters = (input.additionalCharacters ?? []).map(
      (character) => ({
        id: randomUUID(),
        name: character.name.trim(),
        role: character.role.trim(),
        personality: character.personality.trim(),
        firstMessage: character.firstMessage?.trim() ?? "",
        card: character.card,
        initiallyPresent: character.initiallyPresent !== false,
        dialogueId: character.firstMessage?.trim() ? randomUUID() : "",
      }),
    );
    const additionalCharacterIds = additionalCharacters.map(
      (character) => character.id,
    );
    const openingCharacterIds = [
      playerCharacterId,
      mainCharacterId,
      ...additionalCharacters
        .filter((character) => character.initiallyPresent)
        .map((character) => character.id),
    ];
    const now = new Date().toISOString();
    const campaignName = input.campaignName.trim();
    const worldName = input.world.name.trim();
    const playerName = input.player.name.trim();
    const mainCharacterName = input.mainCharacter.name.trim();
    const firstMessage = input.mainCharacter.firstMessage?.trim() ?? "";
    const mainDialogueId = firstMessage ? randomUUID() : "";
    const initialStoryModuleId = input.initialStoryModuleId?.trim() ?? "";
    const initialStoryDirection =
      input.initialStoryDirection?.trim() ||
      input.storyModules
        ?.find((storyModule) => storyModule.id.trim() === initialStoryModuleId)
        ?.objective.trim() ||
      "";
    const storyModules = (input.storyModules ?? []).map((storyModule, order) => ({
      id: storyModule.id.trim(),
      title: storyModule.title.trim(),
      objective:
        storyModule.id.trim() === initialStoryModuleId && initialStoryDirection
          ? initialStoryDirection
          : storyModule.objective.trim(),
      completionCriteria: storyModule.completionCriteria.map((item) => item.trim()),
      activationConditions: (storyModule.activationConditions ?? []).map((item) =>
        item.trim(),
      ),
      prerequisiteModuleIds: (storyModule.prerequisiteModuleIds ?? []).map((item) =>
        item.trim(),
      ),
      continuityNotes: storyModule.continuityNotes?.trim() ?? "",
      autoContinue: storyModule.autoContinue !== false,
      ...(storyModule.deadlineDay !== undefined
        ? { deadlineDay: storyModule.deadlineDay }
        : {}),
      order,
    }));
    const openingLocationName =
      input.openingLocationName?.trim() || "开场地点";
    const sessionName = `${campaignName} · 第一幕`;

    const openingOutput: JsonObject = {
      schemaVersion: "1.0.0",
      turn: {
        scene: input.openingScene.trim(),
        events: [
          {
            id: openingEventId,
            type: "adventure_started",
            summary: `${playerName}进入了${worldName}的第一幕。`,
            characterIds: openingCharacterIds,
            locationId: openingLocationId,
          },
        ],
        dialogue: [
          ...(firstMessage
            ? [
              {
                id: mainDialogueId,
                speakerId: mainCharacterId,
                speakerName: mainCharacterName,
                content: firstMessage,
              },
            ]
            : []),
          ...additionalCharacters
            .filter(
              (character) =>
                character.initiallyPresent && character.firstMessage,
            )
            .map((character) => ({
              id: character.dialogueId,
              speakerId: character.id,
              speakerName: character.name,
              content: character.firstMessage,
            })),
        ],
      },
      decision: {
        context: "action_direction",
        prompt: "面对眼前的局面，你准备怎么做？",
        choices: [
          {
            id: "opening-benevolent",
            label: "主动接触",
            description: "以善意和坦诚试着了解局势。",
            stance: "benevolent",
          },
          {
            id: "opening-neutral",
            label: "谨慎观察",
            description: "暂不表态，先收集周围的信息。",
            stance: "neutral",
          },
          {
            id: "opening-malicious",
            label: "寻找弱点",
            description: "判断谁或什么能够被自己利用。",
            stance: "malicious",
          },
        ],
        customInputEnabled: true,
      },
      stateCommit: {
        sceneTransition: {
          locationId: openingLocationId,
          locationName: openingLocationName,
          locationDescription: input.openingScene.trim(),
          presentCharacterIds: openingCharacterIds,
          reason: "故事在此处开场",
          evidence: [openingEventId],
        },
        characterStateChanges: [],
        relationshipChanges: [],
        characterCardChanges: [],
        worldBookChanges: [],
        storyDirectionEvaluation: null,
        summaryPatch: `${playerName}在${worldName}开始了冒险。`,
      },
      warnings: [],
    };

    const stateMutations: StateMutationInput[] = [
      {
        entityType: "session_state",
        entityId: "core",
        operation: "replace",
        value: {
          worldName,
          worldPremise: input.world.premise.trim(),
          playerCharacterId,
          playerName,
          mainCharacterId,
          mainCharacterName,
          additionalCharacterIds,
          currentScene: input.openingScene.trim(),
          currentLocationId: openingLocationId,
          currentLocationName: openingLocationName,
          gameTimeDay: 1,
          phase: "opening",
          storyMode: storyModules.length > 0 ? "script" : "free",
          storyModuleCount: storyModules.length,
        },
        reason: "创建战役并建立初始场景",
        evidence: [openingEventId],
      },
      {
        entityType: "location",
        entityId: openingLocationId,
        operation: "replace",
        value: {
          name: openingLocationName,
          description: input.openingScene.trim(),
          defaultCharacterIds: [
            mainCharacterId,
            ...additionalCharacters
              .filter((character) => character.initiallyPresent)
              .map((character) => character.id),
          ],
          source: "setup",
          lastVisitedTurnId: openingTurnId,
        },
        reason: "建立开场地点和初始登场阵容",
        evidence: [openingEventId],
      },
      {
        entityType: "world_book_entry",
        entityId: "world-core",
        operation: "replace",
        value: {
          keys: [worldName, campaignName],
          content: input.world.premise.trim(),
          enabled: true,
          constant: true,
          position: "before_char",
          order: 100,
          layer: "base",
        },
        reason: "保存玩家确认的基础世界观",
        evidence: [openingEventId],
      },
      {
        entityType: "character_card",
        entityId: playerCharacterId,
        operation: "replace",
        value: createSetupCharacterCard(
          {
            name: playerName,
            role: input.player.description.trim(),
            personality: "",
            card: input.player.card,
          },
          "player",
          input.openingScene.trim(),
          "玩家角色",
        ),
        reason: "保存玩家确认的基础角色卡",
        evidence: [openingEventId],
      },
      {
        entityType: "character_card",
        entityId: mainCharacterId,
        operation: "replace",
        value: createSetupCharacterCard(
          input.mainCharacter,
          "character",
          input.openingScene.trim(),
          "主要角色",
        ),
        reason: "保存玩家确认的基础角色卡",
        evidence: [openingEventId],
      },
      {
        entityType: "character_state",
        entityId: playerCharacterId,
        operation: "replace",
        value: {
          name: playerName,
          role: "player",
          present: true,
          locationId: openingLocationId,
          alive: true,
          mood: "待定",
          currentGoal: "了解当前局势",
        },
        reason: "建立玩家角色初始状态",
        evidence: [openingEventId],
      },
      {
        entityType: "character_state",
        entityId: mainCharacterId,
        operation: "replace",
        value: {
          name: mainCharacterName,
          role: input.mainCharacter.role.trim(),
          present: true,
          locationId: openingLocationId,
          alive: true,
          mood: "待定",
          currentGoal: "依照角色设定应对玩家",
        },
        reason: "建立主要角色初始状态",
        evidence: [openingEventId],
      },
      {
        entityType: "relationship",
        entityId: `${playerCharacterId}:${mainCharacterId}`,
        operation: "replace",
        value: {
          sourceCharacterId: playerCharacterId,
          targetCharacterId: mainCharacterId,
          trust: 0,
          affinity: 0,
          fear: 0,
          hostility: 0,
          respect: 0,
          summary: "关系尚未建立",
        },
        reason: "建立角色之间的初始关系",
        evidence: [openingEventId],
      },
    ];

    const characterIdByName = new Map<string, string>([
      [playerName.trim(), playerCharacterId],
      [mainCharacterName.trim(), mainCharacterId],
      ...additionalCharacters.map(
        (character) => [character.name.trim(), character.id] as const,
      ),
    ]);
    const clampDimension = (value: number | undefined, fallback: number) =>
      typeof value === "number" && Number.isFinite(value)
        ? Math.max(-100, Math.min(100, value))
        : fallback;
    for (const relationship of input.initialRelationships ?? []) {
      const sourceId = characterIdByName.get(
        relationship.sourceCharacterName.trim(),
      );
      const targetId = characterIdByName.get(
        relationship.targetCharacterName.trim(),
      );
      if (!sourceId || !targetId) continue;
      const dimensions = relationship.dimensions ?? {};
      const declaredPairs = new Set<string>();
      for (const item of input.initialRelationships ?? []) {
        const left = characterIdByName.get(item.sourceCharacterName.trim());
        const right = characterIdByName.get(item.targetCharacterName.trim());
        if (!left || !right) continue;
        declaredPairs.add(`${left}:${right}`);
      }
      const relationshipValue = {
        trust: clampDimension(dimensions.trust, 0),
        affinity: clampDimension(dimensions.affinity, 0),
        fear: clampDimension(dimensions.fear, 0),
        hostility: clampDimension(dimensions.hostility, 0),
        respect: clampDimension(dimensions.respect, 0),
        summary: relationship.summary?.trim() || "关系尚未建立",
      };
      const pushRelationship = (
        fromId: string,
        toId: string,
        reason: string,
      ) => {
        stateMutations.push({
          entityType: "relationship",
          entityId: `${fromId}:${toId}`,
          operation: "replace",
          value: {
            sourceCharacterId: fromId,
            targetCharacterId: toId,
            ...relationshipValue,
          },
          reason,
          evidence: [openingEventId],
        });
      };
      pushRelationship(
        sourceId,
        targetId,
        "按剧本初始关系声明建立角色关系",
      );
      const reverseId = `${targetId}:${sourceId}`;
      if (!declaredPairs.has(reverseId)) {
        pushRelationship(
          targetId,
          sourceId,
          "按剧本初始关系声明建立反向角色关系",
        );
      }
    }

    for (const entry of input.worldBookEntries ?? []) {
      stateMutations.push({
        entityType: "world_book_entry",
        entityId: `world-import-${randomUUID()}`,
        operation: "replace",
        value: {
          keys: entry.keys,
          secondaryKeys: entry.secondaryKeys ?? [],
          content: entry.content,
          enabled: entry.enabled,
          constant: entry.constant ?? false,
          selective: entry.selective ?? false,
          position: entry.position ?? "after_char",
          order: entry.order ?? 100,
          probability: entry.probability ?? 100,
          depth: entry.depth ?? 4,
          comment: entry.comment ?? "",
          extensions: entry.extensions ?? {},
          layer: "base_import",
          source: {
            bookName: entry.sourceBookName ?? "导入世界书",
            entryId: entry.sourceId ?? "",
            format: entry.sourceFormat ?? "ai_tavern_world_book_v1",
          },
        },
        reason: "保存玩家在开局时导入的世界书条目",
        evidence: [openingEventId],
      });
    }

    const openingLocationNormalizedName = openingLocationName.toLocaleLowerCase("zh-CN");
    for (const location of input.locations ?? []) {
      if (
        location.name.toLocaleLowerCase("zh-CN") === openingLocationNormalizedName
      ) {
        continue;
      }
      stateMutations.push({
        entityType: "location",
        entityId: randomUUID(),
        operation: "replace",
        value: {
          name: location.name.trim(),
          description: location.description.trim(),
          defaultCharacterIds: (location.characters ?? [])
            .map((characterName) =>
              characterIdByName.get(characterName.trim()),
            )
            .filter((id): id is string => typeof id === "string"),
          important: location.important === true,
          source: "setup",
          lastVisitedTurnId: openingTurnId,
        },
        reason: "按剧本地点清单预注册地点",
        evidence: [openingEventId],
      });
    }

    for (const character of additionalCharacters) {
      stateMutations.push(
        {
          entityType: "character_card",
          entityId: character.id,
          operation: "replace",
          value: createSetupCharacterCard(
            character,
            "character",
            input.openingScene.trim(),
            "其他角色",
          ),
          reason: "保存玩家确认的其他角色卡",
          evidence: [openingEventId],
        },
        {
          entityType: "character_state",
          entityId: character.id,
          operation: "replace",
          value: {
            name: character.name,
            role: character.role,
            present: character.initiallyPresent,
            locationId: character.initiallyPresent ? openingLocationId : "",
            alive: true,
            mood: "待定",
            currentGoal: "依照角色设定参与当前剧情",
          },
          reason: "建立其他角色初始状态",
          evidence: [openingEventId],
        },
        {
          entityType: "relationship",
          entityId: `${playerCharacterId}:${character.id}`,
          operation: "replace",
          value: {
            sourceCharacterId: playerCharacterId,
            targetCharacterId: character.id,
            trust: 0,
            affinity: 0,
            fear: 0,
            hostility: 0,
            summary: "关系尚未建立",
          },
          reason: "建立玩家与其他角色的初始关系",
          evidence: [openingEventId],
        },
      );
    }

    if (initialStoryDirection) {
      stateMutations.push({
        entityType: "story_direction",
        entityId: "active",
        operation: "replace",
        value: {
          content: initialStoryDirection,
          status: "active",
          createdAtTurnId: openingTurnId,
          source: initialStoryModuleId ? "script_module" : "setup",
          ...(initialStoryModuleId ? { moduleId: initialStoryModuleId } : {}),
        },
        reason: "保存玩家开局时给出的剧情走向",
        evidence: [openingEventId],
      });
    }

    for (const storyModule of storyModules) {
      const startsActive = storyModule.id === initialStoryModuleId;
      stateMutations.push({
        entityType: "story_module",
        entityId: `story-module:${storyModule.id}`,
        operation: "replace",
        value: {
          moduleId: storyModule.id,
          title: storyModule.title,
          objective: storyModule.objective,
          completionCriteria: storyModule.completionCriteria,
          activationConditions: storyModule.activationConditions,
          prerequisiteModuleIds: storyModule.prerequisiteModuleIds,
          continuityNotes: storyModule.continuityNotes,
          autoContinue: storyModule.autoContinue,
          order: storyModule.order,
          status: startsActive ? "active" : "queued",
          ...(storyModule.deadlineDay !== undefined
            ? { deadlineDay: storyModule.deadlineDay }
            : {}),
          ...(startsActive ? { activatedAtTurnId: openingTurnId } : {}),
        },
        reason: startsActive
          ? "建立并启用剧本包的开场剧情任务"
          : "建立剧本包的后续剧情任务",
        evidence: [openingEventId],
      });
    }

    for (const thread of input.foreshadowing ?? []) {
      stateMutations.push({
        entityType: "plot_thread",
        entityId: `plot-thread:${thread.id}`,
        operation: "replace",
        value: {
          threadId: thread.id,
          keywords: thread.keywords,
          seedCondition: thread.seedCondition,
          payoffCondition: thread.payoffCondition,
          payoffSummary: thread.payoffSummary,
          characters: thread.characters ?? [],
          status: "dormant",
        },
        reason: "建立剧本包声明的伏笔",
        evidence: [openingEventId],
      });
    }

    for (const trigger of input.triggers ?? []) {
      stateMutations.push({
        entityType: "plot_trigger",
        entityId: `plot-trigger:${trigger.id}`,
        operation: "replace",
        value: {
          triggerId: trigger.id,
          when: trigger.when,
          consequence: trigger.consequence,
          ...(trigger.stateEffects !== undefined
            ? { stateEffects: trigger.stateEffects }
            : {}),
          ...(trigger.deadlineDay !== undefined
            ? { deadlineDay: trigger.deadlineDay }
            : {}),
          status: "armed",
        },
        reason: "建立剧本包声明的偏离触发器",
        evidence: [openingEventId],
      });
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO campaigns (id, name, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          campaignId,
          campaignName,
          input.campaignDescription?.trim() ?? "",
          now,
          now,
        );
      this.database
        .prepare(`
          INSERT INTO sessions (
            id, campaign_id, name, status, active_branch_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'active', ?, ?, ?)
        `)
        .run(sessionId, campaignId, sessionName, branchId, now, now);
      this.database
        .prepare(`
          INSERT INTO branches (
            id, session_id, name, head_turn_id, next_sequence,
            created_at, updated_at
          ) VALUES (?, ?, '主线', NULL, 1, ?, ?)
        `)
        .run(branchId, sessionId, now, now);
      this.database
        .prepare(`
          INSERT INTO turns (
            id, session_id, branch_id, parent_turn_id, sequence,
            idempotency_key, player_input_json, generated_output_json,
            summary_patch, status, created_at
          ) VALUES (?, ?, ?, NULL, 1, 'adventure-setup', ?, ?, ?, 'committed', ?)
        `)
        .run(
          openingTurnId,
          sessionId,
          branchId,
          stringifyJson({ source: "setup_wizard" }),
          stringifyJson(openingOutput),
          `${playerName}在${worldName}开始了冒险。`,
          now,
        );

      const insertMessage = this.database.prepare(`
        INSERT INTO messages (
          id, turn_id, ordinal, role, speaker_id, content,
          metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?)
      `);
      insertMessage.run(
        randomUUID(),
        openingTurnId,
        0,
        "narrator",
        null,
        input.openingScene.trim(),
        now,
      );
      if (firstMessage) {
        insertMessage.run(
          mainDialogueId,
          openingTurnId,
          1,
          "character",
          mainCharacterId,
          firstMessage,
          now,
        );
      }
      let messageOrdinal = firstMessage ? 2 : 1;
      for (const character of additionalCharacters) {
        if (!character.initiallyPresent || !character.firstMessage) continue;
        insertMessage.run(
          character.dialogueId,
          openingTurnId,
          messageOrdinal,
          "character",
          character.id,
          character.firstMessage,
          now,
        );
        messageOrdinal += 1;
      }

      this.database
        .prepare(`
          INSERT INTO events (
            id, turn_id, event_type, summary, location_id,
            character_ids_json, payload_json, created_at
          ) VALUES (?, ?, 'adventure_started', ?, NULL, ?, '{}', ?)
        `)
        .run(
          openingEventId,
          openingTurnId,
          `${playerName}进入了${worldName}的第一幕。`,
          stringifyJson(openingCharacterIds),
          now,
        );

      this.applyStateMutations({
        sessionId,
        branchId,
        turnId: openingTurnId,
        mutations: stateMutations,
        now,
      });
      const sourceCharacterNames = [
        playerName,
        mainCharacterName,
        ...additionalCharacters.map((character) => character.name),
      ];
      for (const document of input.sourceDocuments ?? []) {
        this.insertSourceDocument({
          sessionId,
          document,
          characterNames: sourceCharacterNames,
          now,
        });
      }
      this.database
        .prepare(`
          UPDATE branches
          SET head_turn_id = ?, next_sequence = 2, updated_at = ?
          WHERE id = ?
        `)
        .run(openingTurnId, now, branchId);
      this.writeSnapshot({
        sessionId,
        branchId,
        turnId: openingTurnId,
        sequence: 1,
        name: "开局自动存档",
        kind: "automatic",
        now,
      });

      this.synchronizeStoryMemory(sessionId, branchId);

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return {
      campaignId,
      sessionId,
      branchId,
      openingTurnId,
      playerCharacterId,
      mainCharacterId,
      additionalCharacterIds,
    };
  }

  private insertSourceDocument(input: {
    sessionId: string;
    document: SourceDocumentInput;
    characterNames: string[];
    now: string;
  }): SourceDocumentSummary {
    const split = splitSourceDocument(
      input.document.content,
      input.characterNames,
    );
    const id = randomUUID();
    const currentChapter = Math.min(
      Math.max(1, input.document.currentChapter),
      split.chapterCount,
    );
    this.database
      .prepare(`
        INSERT INTO source_documents (
          id, session_id, name, file_name, content, content_length,
          chapter_count, chunk_count, enabled, current_chapter,
          prevent_future, fidelity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.sessionId,
        input.document.name,
        input.document.fileName,
        input.document.content,
        input.document.content.length,
        split.chapterCount,
        split.chunks.length,
        input.document.enabled ? 1 : 0,
        currentChapter,
        input.document.preventFuture ? 1 : 0,
        input.document.fidelity,
        input.now,
        input.now,
      );
    const insertChunk = this.database.prepare(`
      INSERT INTO source_chunks (
        id, document_id, session_id, ordinal, chapter_index,
        chapter_title, content, character_names_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const chunk of split.chunks) {
      insertChunk.run(
        randomUUID(),
        id,
        input.sessionId,
        chunk.ordinal,
        chunk.chapterIndex,
        chunk.chapterTitle,
        chunk.content,
        stringifyJson(chunk.characterNames),
        input.now,
      );
    }
    return {
      id,
      name: input.document.name,
      fileName: input.document.fileName,
      contentLength: input.document.content.length,
      chapterCount: split.chapterCount,
      chunkCount: split.chunks.length,
      enabled: input.document.enabled,
      currentChapter,
      preventFuture: input.document.preventFuture,
      fidelity: input.document.fidelity,
      createdAt: input.now,
      updatedAt: input.now,
    };
  }

  private getSourceDocumentRow(
    sessionId: string,
    documentId: string,
    includeDeleted = false,
  ): SourceDocumentRow {
    const row = this.database
      .prepare(`
        SELECT id, name, file_name, content_length, chapter_count,
               chunk_count, enabled, current_chapter, prevent_future,
               fidelity, is_deleted, created_at, updated_at
        FROM source_documents
        WHERE id = ? AND session_id = ?
          ${includeDeleted ? "" : "AND is_deleted = 0"}
        LIMIT 1
      `)
      .get(documentId, sessionId) as SourceDocumentRow | undefined;
    if (!row) throw new StoryNotFoundError("没有找到这份原文参考。");
    return row;
  }

  private getMemoryEntrySnapshotRow(
    branchId: string,
    entryId: string,
  ): MemoryEntrySnapshotRow {
    const row = this.database
      .prepare(`
        SELECT title, content, importance, status, pinned, enabled, source
        FROM memory_entries
        WHERE id = ? AND branch_id = ?
        LIMIT 1
      `)
      .get(entryId, branchId) as MemoryEntrySnapshotRow | undefined;
    if (!row) throw new StoryNotFoundError("没有找到要修改的剧情记忆。");
    return row;
  }

  private getMemorySettingsSnapshotRow(
    sessionId: string,
  ): MemorySettingsSnapshotRow {
    this.loadStoryMemory(sessionId);
    const row = this.database
      .prepare(`
        SELECT memory_token_budget, recent_turn_count, chapter_size
        FROM memory_settings WHERE session_id = ? LIMIT 1
      `)
      .get(sessionId) as MemorySettingsSnapshotRow | undefined;
    if (!row) throw new ContentAssetManagementError("剧情记忆设置尚未建立。");
    return row;
  }

  private nextContentAssetRevision(input: {
    branchId: string;
    domain: "sources" | "memories";
    targetId: string;
  }) {
    const row = this.database
      .prepare(`
        SELECT COALESCE(MAX(revision), 0) AS revision
        FROM content_asset_management_changes
        WHERE branch_id = ? AND domain = ? AND target_id = ?
      `)
      .get(input.branchId, input.domain, input.targetId) as { revision: number };
    return row.revision + 1;
  }

  manageContentAsset(
    input: ContentAssetManagementInput,
  ): ManagedContentAssetResult {
    requireText(input.actionId, "actionId");
    requireText(input.sessionId, "sessionId");
    const requestHash = contentAssetRequestHash(input);
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(`
          SELECT id, action_id, branch_id, reference_turn_id, domain,
                 operation, target_id, request_hash, summary_json, revision,
                 before_json, after_json, reverted_by_action_id, created_at
          FROM content_asset_management_changes
          WHERE session_id = ? AND action_id = ?
          LIMIT 1
        `)
        .get(input.sessionId, input.actionId) as
        | ContentAssetManagementRow
        | undefined;
      if (existing) {
        if (
          existing.domain !== input.domain ||
          existing.operation !== input.operation ||
          existing.request_hash !== requestHash
        ) {
          throw new ContentAssetManagementError(
            "这个 actionId 已经用于另一项内容操作，请重新提交。",
          );
        }
        this.database.exec("COMMIT");
        return {
          actionId: input.actionId,
          domain: existing.domain,
          operation: existing.operation,
          targetId: existing.target_id,
          reused: true,
        };
      }

      const branch = this.getActiveBranch(input.sessionId);
      if (!branch.head_turn_id) {
        throw new ContentAssetManagementError(
          "当前剧情还没有可关联的回合，暂时不能修改剧本内容。",
        );
      }

      let targetId: string;
      let before: JsonObject = {};
      let after: JsonObject = {};
      let revertedChangeId: string | null = null;

      if (input.operation === "rollback") {
        const selected = this.database
          .prepare(`
            SELECT id, action_id, branch_id, reference_turn_id, domain,
                   operation, target_id, request_hash, summary_json, revision,
                   before_json, after_json, reverted_by_action_id, created_at
            FROM content_asset_management_changes
            WHERE id = ? AND session_id = ? AND branch_id = ?
            LIMIT 1
          `)
          .get(input.changeId, input.sessionId, branch.id) as
          | ContentAssetManagementRow
          | undefined;
        if (!selected || selected.domain !== input.domain) {
          throw new ContentAssetManagementError(
            "没有找到当前分支中可撤销的资料修改。",
          );
        }
        if (selected.operation === "rollback" || selected.operation === "rebuild") {
          throw new ContentAssetManagementError("这类资料操作不能自动撤销。");
        }
        if (selected.reverted_by_action_id) {
          throw new ContentAssetManagementError("这项资料修改已经撤销过了。");
        }
        if (selected.reference_turn_id !== branch.head_turn_id) {
          throw new ContentAssetManagementError(
            "这项修改之后已经继续推进剧情。请新建分支或手工修正，避免覆盖后续内容。",
          );
        }
        const latest = this.database
          .prepare(`
            SELECT MAX(revision) AS revision
            FROM content_asset_management_changes
            WHERE branch_id = ? AND domain = ? AND target_id = ?
          `)
          .get(branch.id, selected.domain, selected.target_id) as {
          revision: number | null;
        };
        if (selected.revision <= 0 || latest.revision !== selected.revision) {
          throw new ContentAssetManagementError(
            "同一对象已有更新的修改，不能跳过后续版本直接撤销。",
          );
        }
        const selectedBefore = parseObject(selected.before_json);
        const selectedAfter = parseObject(selected.after_json);
        if (
          Object.keys(selectedBefore).length === 0 ||
          Object.keys(selectedAfter).length === 0
        ) {
          throw new ContentAssetManagementError(
            "这是一条旧版只读记录，没有可恢复快照。",
          );
        }

        targetId = selected.target_id;
        before = selectedAfter;
        after = selectedBefore;
        if (selected.domain === "sources") {
          const current = sourceDocumentSnapshot(
            this.getSourceDocumentRow(input.sessionId, targetId, true),
          );
          if (!sameJson(current, selectedAfter)) {
            throw new ContentAssetManagementError(
              "原文资料当前内容已经变化，请刷新修改记录后再处理。",
            );
          }
          if (selected.operation === "import") {
            this.database
              .prepare(`
                UPDATE source_documents
                SET is_deleted = 1, updated_at = ?
                WHERE id = ? AND session_id = ?
              `)
              .run(now, targetId, input.sessionId);
          } else {
            this.database
              .prepare(`
                UPDATE source_documents
                SET enabled = ?, current_chapter = ?, prevent_future = ?,
                    fidelity = ?, is_deleted = ?, updated_at = ?
                WHERE id = ? AND session_id = ?
              `)
              .run(
                selectedBefore.enabled === true ? 1 : 0,
                Number(selectedBefore.currentChapter),
                selectedBefore.preventFuture === true ? 1 : 0,
                selectedBefore.fidelity === "faithful" ? "faithful" : "balanced",
                selectedBefore.isDeleted === true ? 1 : 0,
                now,
                targetId,
                input.sessionId,
              );
          }
        } else if (selected.operation === "update_entry") {
          const current = memoryEntrySnapshot(
            this.getMemoryEntrySnapshotRow(branch.id, targetId),
          );
          if (!sameJson(current, selectedAfter)) {
            throw new ContentAssetManagementError(
              "剧情记忆当前内容已经变化，请刷新修改记录后再处理。",
            );
          }
          this.updateStoryMemoryEntry(input.sessionId, {
            entryId: targetId,
            title: String(selectedBefore.title),
            content: String(selectedBefore.content),
            importance: Number(selectedBefore.importance),
            status:
              selectedBefore.status === "resolved" ? "resolved" : "active",
            pinned: selectedBefore.pinned === true,
            enabled: selectedBefore.enabled === true,
          });
          this.database
            .prepare(`
              UPDATE memory_entries SET source = ?, updated_at = ?
              WHERE id = ? AND branch_id = ?
            `)
            .run(
              selectedBefore.source === "automatic" ? "automatic" : "manual",
              now,
              targetId,
              branch.id,
            );
        } else if (selected.operation === "update_settings") {
          const current = memorySettingsSnapshot(
            this.getMemorySettingsSnapshotRow(input.sessionId),
          );
          if (!sameJson(current, selectedAfter)) {
            throw new ContentAssetManagementError(
              "剧情记忆设置已经变化，请刷新修改记录后再处理。",
            );
          }
          this.updateStoryMemorySettings(input.sessionId, {
            memoryTokenBudget: Number(selectedBefore.memoryTokenBudget),
            recentTurnCount: Number(selectedBefore.recentTurnCount),
            chapterSize: Number(selectedBefore.chapterSize),
          });
        } else {
          throw new ContentAssetManagementError("这类资料操作不能自动撤销。");
        }
        revertedChangeId = selected.id;
      } else if (input.domain === "sources") {
        switch (input.operation) {
          case "import": {
            const adventure = this.loadAdventure(input.sessionId);
            const documents = this.listSourceDocuments(input.sessionId);
            if (documents.length >= 5) {
              throw new SourceReferenceInputError([
                "每个剧本最多可以导入 5 份原文参考。",
              ]);
            }
            if (
              documents.some(
                (document) => document.fileName === input.document.fileName,
              )
            ) {
              throw new SourceReferenceInputError([
                `已经导入过同名文件《${input.document.fileName}》。`,
              ]);
            }
            const deletedDocument = this.database
              .prepare(`
                SELECT 1 AS found FROM source_documents
                WHERE session_id = ? AND file_name = ? AND is_deleted = 1
                LIMIT 1
              `)
              .get(input.sessionId, input.document.fileName);
            if (deletedDocument) {
              throw new SourceReferenceInputError([
                `同名文件《${input.document.fileName}》曾被删除，请先从修改记录恢复，或换一个文件名。`,
              ]);
            }
            const characterNames = adventure.branchState.states
              .filter((state) => state.entityType === "character_state")
              .map((state) => readString(state.state.name))
              .filter(Boolean);
            targetId = this.insertSourceDocument({
              sessionId: input.sessionId,
              document: input.document,
              characterNames,
              now,
            }).id;
            before = { isDeleted: true };
            after = sourceDocumentSnapshot(
              this.getSourceDocumentRow(input.sessionId, targetId),
            );
            break;
          }
          case "update": {
            before = sourceDocumentSnapshot(
              this.getSourceDocumentRow(input.sessionId, input.documentId),
            );
            this.updateSourceDocument(
              input.sessionId,
              input.documentId,
              input.settings,
            );
            targetId = input.documentId;
            after = sourceDocumentSnapshot(
              this.getSourceDocumentRow(input.sessionId, targetId),
            );
            break;
          }
          case "remove": {
            before = sourceDocumentSnapshot(
              this.getSourceDocumentRow(input.sessionId, input.documentId),
            );
            this.database
              .prepare(`
                UPDATE source_documents
                SET is_deleted = 1, updated_at = ?
                WHERE id = ? AND session_id = ? AND is_deleted = 0
              `)
              .run(now, input.documentId, input.sessionId);
            targetId = input.documentId;
            after = sourceDocumentSnapshot(
              this.getSourceDocumentRow(input.sessionId, targetId, true),
            );
            break;
          }
        }
      } else {
        switch (input.operation) {
          case "update_entry": {
            before = memoryEntrySnapshot(
              this.getMemoryEntrySnapshotRow(branch.id, input.entryId),
            );
            this.updateStoryMemoryEntry(input.sessionId, {
              entryId: input.entryId,
              ...input.patch,
            });
            targetId = input.entryId;
            after = memoryEntrySnapshot(
              this.getMemoryEntrySnapshotRow(branch.id, targetId),
            );
            break;
          }
          case "update_settings": {
            before = memorySettingsSnapshot(
              this.getMemorySettingsSnapshotRow(input.sessionId),
            );
            this.updateStoryMemorySettings(input.sessionId, input.settings);
            targetId = "settings";
            after = memorySettingsSnapshot(
              this.getMemorySettingsSnapshotRow(input.sessionId),
            );
            break;
          }
          case "rebuild":
            this.rebuildStoryMemory(input.sessionId);
            targetId = "index";
            break;
        }
      }

      const revision = this.nextContentAssetRevision({
        branchId: branch.id,
        domain: input.domain,
        targetId,
      });
      const changeId = randomUUID();

      this.database
        .prepare(`
          INSERT INTO content_asset_management_changes (
            id, action_id, session_id, branch_id, reference_turn_id,
            domain, operation, target_id, request_hash, summary_json,
            revision, before_json, after_json, reverted_by_action_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `)
        .run(
          changeId,
          input.actionId,
          input.sessionId,
          branch.id,
          branch.head_turn_id,
          input.domain,
          input.operation,
          targetId,
          requestHash,
          stringifyJson(contentAssetSummary(input)),
          revision,
          stringifyJson(before),
          stringifyJson(after),
          now,
        );
      if (revertedChangeId) {
        this.database
          .prepare(`
            UPDATE content_asset_management_changes
            SET reverted_by_action_id = ?
            WHERE id = ? AND reverted_by_action_id IS NULL
          `)
          .run(input.actionId, revertedChangeId);
      }
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);
      this.database.exec("COMMIT");
      return {
        actionId: input.actionId,
        domain: input.domain,
        operation: input.operation,
        targetId,
        reused: false,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listContentAssetManagementChanges(
    sessionId: string,
  ): ContentAssetManagementChange[] {
    requireText(sessionId, "sessionId");
    const branch = this.getActiveBranch(sessionId);
    const rows = this.database
      .prepare(`
        SELECT id, action_id, branch_id, reference_turn_id, domain,
               operation, target_id, request_hash, summary_json, revision,
               before_json, after_json, reverted_by_action_id, created_at
        FROM content_asset_management_changes
        WHERE session_id = ? AND branch_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 200
      `)
      .all(sessionId, branch.id) as unknown as ContentAssetManagementRow[];
    const latestRevision = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.domain}:${row.target_id}`;
      latestRevision.set(
        key,
        Math.max(latestRevision.get(key) ?? 0, row.revision),
      );
    }
    return rows.map((row) => {
      const before = parseObject(row.before_json);
      const after = parseObject(row.after_json);
      const rollbackableOperation =
        row.operation === "import" ||
        row.operation === "update" ||
        row.operation === "remove" ||
        row.operation === "update_entry" ||
        row.operation === "update_settings";
      let rollbackBlockedReason: string | null = null;
      if (row.reverted_by_action_id) {
        rollbackBlockedReason = "这项修改已经撤销。";
      } else if (!rollbackableOperation) {
        rollbackBlockedReason = "这类操作不支持自动撤销。";
      } else if (
        row.revision <= 0 ||
        Object.keys(before).length === 0 ||
        Object.keys(after).length === 0
      ) {
        rollbackBlockedReason = "旧版记录没有可恢复快照。";
      } else if (row.reference_turn_id !== branch.head_turn_id) {
        rollbackBlockedReason = "修改后已经继续推进剧情。";
      } else if (
        latestRevision.get(`${row.domain}:${row.target_id}`) !== row.revision
      ) {
        rollbackBlockedReason = "同一对象已有更新的修改。";
      }
      return {
        id: row.id,
        actionId: row.action_id,
        branchId: row.branch_id,
        referenceTurnId: row.reference_turn_id,
        domain: row.domain,
        operation: row.operation,
        targetId: row.target_id,
        summary: parseObject(row.summary_json),
        revision: row.revision,
        before,
        after,
        revertedByActionId: row.reverted_by_action_id,
        canRollback: rollbackBlockedReason === null,
        rollbackBlockedReason,
        createdAt: row.created_at,
      };
    });
  }

  listSourceDocuments(sessionId: string): SourceDocumentSummary[] {
    requireText(sessionId, "sessionId");
    const session = this.database
      .prepare("SELECT 1 AS found FROM sessions WHERE id = ?")
      .get(sessionId) as { found: number } | undefined;
    if (!session) throw new StoryNotFoundError();
    const rows = this.database
      .prepare(`
        SELECT id, name, file_name, content_length, chapter_count,
               chunk_count, enabled, current_chapter, prevent_future,
               fidelity, is_deleted, created_at, updated_at
        FROM source_documents
        WHERE session_id = ? AND is_deleted = 0
        ORDER BY created_at, id
      `)
      .all(sessionId) as unknown as SourceDocumentRow[];
    return rows.map(mapSourceDocument);
  }

  importSourceDocument(
    sessionId: string,
    document: SourceDocumentInput,
  ): SourceDocumentSummary {
    requireText(sessionId, "sessionId");
    const adventure = this.loadAdventure(sessionId);
    const existing = this.listSourceDocuments(sessionId);
    if (existing.length >= 5) {
      throw new SourceReferenceInputError([
        "每个剧本最多可以导入 5 份原文参考。",
      ]);
    }
    if (existing.some((item) => item.fileName === document.fileName)) {
      throw new SourceReferenceInputError([
        `已经导入过同名文件《${document.fileName}》。`,
      ]);
    }
    if (
      this.database
        .prepare(`
          SELECT 1 AS found FROM source_documents
          WHERE session_id = ? AND file_name = ? AND is_deleted = 1
          LIMIT 1
        `)
        .get(sessionId, document.fileName)
    ) {
      throw new SourceReferenceInputError([
        `同名文件《${document.fileName}》曾被删除，请从修改记录恢复，或换一个文件名。`,
      ]);
    }
    const characterNames = adventure.branchState.states
      .filter((state) => state.entityType === "character_state")
      .map((state) => readString(state.state.name))
      .filter(Boolean);
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const created = this.insertSourceDocument({
        sessionId,
        document,
        characterNames,
        now,
      });
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, sessionId);
      this.database.exec("COMMIT");
      return created;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  updateSourceDocument(
    sessionId: string,
    documentId: string,
    patch: SourceDocumentUpdateInput,
  ): SourceDocumentSummary {
    requireText(sessionId, "sessionId");
    requireText(documentId, "documentId");
    const selected = this.database
      .prepare(`
        SELECT id, name, file_name, content_length, chapter_count,
               chunk_count, enabled, current_chapter, prevent_future,
               fidelity, is_deleted, created_at, updated_at
        FROM source_documents
        WHERE id = ? AND session_id = ? AND is_deleted = 0
      `)
      .get(documentId, sessionId) as SourceDocumentRow | undefined;
    if (!selected) throw new StoryNotFoundError("没有找到这份原文参考。");
    const currentChapter =
      patch.currentChapter === undefined
        ? selected.current_chapter
        : Math.min(
            Math.max(1, Math.trunc(patch.currentChapter)),
            selected.chapter_count,
          );
    const fidelity =
      patch.fidelity === "faithful" || patch.fidelity === "balanced"
        ? patch.fidelity
        : selected.fidelity;
    const now = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE source_documents
        SET enabled = ?, current_chapter = ?, prevent_future = ?,
            fidelity = ?, updated_at = ?
        WHERE id = ? AND session_id = ?
      `)
      .run(
        patch.enabled === undefined
          ? selected.enabled
          : patch.enabled
            ? 1
            : 0,
        currentChapter,
        patch.preventFuture === undefined
          ? selected.prevent_future
          : patch.preventFuture
            ? 1
            : 0,
        fidelity,
        now,
        documentId,
        sessionId,
      );
    return mapSourceDocument({
      ...selected,
      enabled:
        patch.enabled === undefined
          ? selected.enabled
          : patch.enabled
            ? 1
            : 0,
      current_chapter: currentChapter,
      prevent_future:
        patch.preventFuture === undefined
          ? selected.prevent_future
          : patch.preventFuture
            ? 1
            : 0,
      fidelity,
      updated_at: now,
    });
  }

  deleteSourceDocument(sessionId: string, documentId: string) {
    requireText(sessionId, "sessionId");
    requireText(documentId, "documentId");
    const deleted = this.database
      .prepare(`
        UPDATE source_documents SET is_deleted = 1, updated_at = ?
        WHERE id = ? AND session_id = ? AND is_deleted = 0
      `)
      .run(new Date().toISOString(), documentId, sessionId);
    if (deleted.changes !== 1) {
      throw new StoryNotFoundError("没有找到这份原文参考。");
    }
    return { documentId };
  }

  findRelevantSourceReferences(input: {
    sessionId: string;
    adventure: LoadedAdventure;
    query: string;
  }): SourceReferenceExcerpt[] {
    if (input.adventure.session.id !== input.sessionId) {
      throw new StoryNotFoundError();
    }
    const rows = this.database
      .prepare(`
        SELECT source_chunks.id, source_chunks.document_id,
               source_documents.name AS document_name,
               source_documents.file_name, source_chunks.ordinal,
               source_chunks.chapter_index, source_chunks.chapter_title,
               source_chunks.content, source_chunks.character_names_json,
               source_documents.current_chapter, source_documents.fidelity
        FROM source_chunks
        JOIN source_documents ON source_documents.id = source_chunks.document_id
        WHERE source_chunks.session_id = ?
          AND source_documents.enabled = 1
          AND source_documents.is_deleted = 0
          AND (
            source_documents.prevent_future = 0
            OR source_chunks.chapter_index <= source_documents.current_chapter
          )
      `)
      .all(input.sessionId) as unknown as SourceChunkRow[];
    if (rows.length === 0) return [];

    const activeCharacterIds = new Set(
      input.adventure.branchState.states
        .filter(
          (state) => state.entityType === "character_card" && state.isActive,
        )
        .map((state) => state.entityId),
    );
    const currentCharacterNames = input.adventure.branchState.states
      .filter(
        (state) =>
          state.entityType === "character_state" &&
          activeCharacterIds.has(state.entityId) &&
          state.state.present !== false,
      )
      .map((state) => readString(state.state.name))
      .filter(Boolean);
    const sessionState = input.adventure.branchState.states.find(
      (state) =>
        state.entityType === "session_state" && state.entityId === "core",
    )?.state;
    const activeDirection = input.adventure.branchState.states.find(
      (state) => state.entityType === "story_direction" && state.isActive,
    )?.state;
    const activeModuleId = readString(activeDirection?.moduleId);
    const activeModule = input.adventure.branchState.states.find(
      (state) =>
        state.entityType === "story_module" &&
        state.isActive &&
        readString(state.state.moduleId) === activeModuleId,
    )?.state;
    const enrichedQuery = [
      input.query,
      readString(activeDirection?.title),
      readString(activeDirection?.content),
      readString(activeModule?.title),
      readString(activeModule?.objective),
      JSON.stringify(activeModule?.completionCriteria ?? []),
      JSON.stringify(activeModule?.activationConditions ?? []),
      readString(activeModule?.continuityNotes),
      readString(sessionState?.currentLocationName),
      readString(sessionState?.currentScene),
      ...input.adventure.branchState.recentTurns
        .slice(-2)
        .map((turn) => turn.summaryPatch),
    ]
      .filter(Boolean)
      .join("\n");
    return rankSourceReferences({
      query: enrichedQuery,
      currentCharacterNames,
      candidates: rows.map((row) => ({
        chunkId: row.id,
        ordinal: row.ordinal,
        documentId: row.document_id,
        documentName: row.document_name,
        fileName: row.file_name,
        chapterIndex: row.chapter_index,
        chapterTitle: row.chapter_title,
        content: row.content,
        characterNames: parseStringArray(row.character_names_json),
        currentChapter: row.current_chapter,
        fidelity: row.fidelity === "faithful" ? "faithful" : "balanced",
      })),
    });
  }

  findUpcomingScriptGuidance(input: {
    sessionId: string;
    adventure: LoadedAdventure;
    query: string;
  }): SourceReferenceExcerpt[] {
    if (input.adventure.session.id !== input.sessionId) {
      throw new StoryNotFoundError();
    }
    const activeDirection = input.adventure.branchState.states.find(
      (state) => state.entityType === "story_direction" && state.isActive,
    )?.state;
    if (
      readString(activeDirection?.source) !== "script_module" ||
      !readString(activeDirection?.moduleId)
    ) {
      return [];
    }
    const activeModuleId = readString(activeDirection?.moduleId);
    const activeModule = input.adventure.branchState.states.find(
      (state) =>
        state.entityType === "story_module" &&
        state.isActive &&
        readString(state.state.moduleId) === activeModuleId,
    )?.state;
    const rows = this.database
      .prepare(`
        SELECT source_chunks.id, source_chunks.document_id,
               source_documents.name AS document_name,
               source_documents.file_name, source_chunks.ordinal,
               source_chunks.chapter_index, source_chunks.chapter_title,
               source_chunks.content, source_chunks.character_names_json,
               source_documents.current_chapter, source_documents.fidelity
        FROM source_chunks
        JOIN source_documents ON source_documents.id = source_chunks.document_id
        WHERE source_chunks.session_id = ?
          AND source_documents.enabled = 1
          AND source_documents.is_deleted = 0
          AND source_documents.prevent_future = 1
          AND source_documents.fidelity = 'faithful'
          AND source_documents.current_chapter < source_documents.chapter_count
          AND source_chunks.chapter_index = source_documents.current_chapter + 1
      `)
      .all(input.sessionId) as unknown as SourceChunkRow[];
    if (rows.length === 0) return [];

    const activeCharacterIds = new Set(
      input.adventure.branchState.states
        .filter(
          (state) => state.entityType === "character_card" && state.isActive,
        )
        .map((state) => state.entityId),
    );
    const currentCharacterNames = input.adventure.branchState.states
      .filter(
        (state) =>
          state.entityType === "character_state" &&
          activeCharacterIds.has(state.entityId) &&
          state.state.present !== false,
      )
      .map((state) => readString(state.state.name))
      .filter(Boolean);
    const sessionState = input.adventure.branchState.states.find(
      (state) =>
        state.entityType === "session_state" && state.entityId === "core",
    )?.state;
    const enrichedQuery = [
      input.query,
      readString(activeDirection?.title),
      readString(activeDirection?.content),
      readString(activeModule?.title),
      readString(activeModule?.objective),
      JSON.stringify(activeModule?.completionCriteria ?? []),
      JSON.stringify(activeModule?.activationConditions ?? []),
      readString(activeModule?.continuityNotes),
      readString(sessionState?.currentLocationName),
      readString(sessionState?.currentScene),
      ...input.adventure.branchState.recentTurns
        .slice(-2)
        .map((turn) => turn.summaryPatch),
    ]
      .filter(Boolean)
      .join("\n");
    return rankSourceReferences({
      query: enrichedQuery,
      currentCharacterNames,
      maximumReferences: 2,
      characterBudget: 3_600,
      candidates: rows.map((row) => ({
        chunkId: row.id,
        ordinal: row.ordinal,
        documentId: row.document_id,
        documentName: row.document_name,
        fileName: row.file_name,
        chapterIndex: row.chapter_index,
        chapterTitle: row.chapter_title,
        content: row.content,
        characterNames: parseStringArray(row.character_names_json),
        currentChapter: row.current_chapter,
        fidelity: "faithful",
      })),
    });
  }

  listAdventures(): AdventureSummary[] {
    const rows = this.database
      .prepare(`
        SELECT
          campaigns.id AS campaign_id,
          campaigns.name AS campaign_name,
          campaigns.description AS campaign_description,
          sessions.id AS session_id,
          sessions.name AS session_name,
          branches.id AS branch_id,
          materialized_states.state_json AS session_state_json,
          sessions.updated_at AS updated_at
        FROM sessions
        JOIN campaigns ON campaigns.id = sessions.campaign_id
        JOIN branches ON branches.id = sessions.active_branch_id
        LEFT JOIN materialized_states
          ON materialized_states.session_id = sessions.id
          AND materialized_states.branch_id = branches.id
          AND materialized_states.entity_type = 'session_state'
          AND materialized_states.entity_id = 'core'
        ORDER BY sessions.updated_at DESC, sessions.id DESC
      `)
      .all() as unknown as AdventureSummaryRow[];

    return rows.map((row) => {
      const state = parseObject(row.session_state_json ?? "{}");
      return {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        campaignDescription: row.campaign_description,
        sessionId: row.session_id,
        sessionName: row.session_name,
        branchId: row.branch_id,
        worldName: readString(state.worldName),
        playerName: readString(state.playerName),
        mainCharacterName: readString(state.mainCharacterName),
        updatedAt: row.updated_at,
      };
    });
  }

  loadAdventure(sessionId: string): LoadedAdventure {
    requireText(sessionId, "sessionId");
    const row = this.database
      .prepare(`
        SELECT
          campaigns.id AS campaign_id,
          campaigns.name AS campaign_name,
          campaigns.description AS campaign_description,
          sessions.id AS session_id,
          sessions.name AS session_name,
          sessions.status AS session_status,
          sessions.updated_at AS updated_at,
          branches.id AS branch_id
        FROM sessions
        JOIN campaigns ON campaigns.id = sessions.campaign_id
        JOIN branches ON branches.id = sessions.active_branch_id
        WHERE sessions.id = ?
        LIMIT 1
      `)
      .get(sessionId) as
      | {
          campaign_id: string;
          campaign_name: string;
          campaign_description: string;
          session_id: string;
          session_name: string;
          session_status: string;
          updated_at: string;
          branch_id: string;
        }
      | undefined;

    if (!row) {
      throw new StoryNotFoundError();
    }

    return {
      campaign: {
        id: row.campaign_id,
        name: row.campaign_name,
        description: row.campaign_description,
      },
      session: {
        id: row.session_id,
        name: row.session_name,
        status: row.session_status,
        updatedAt: row.updated_at,
      },
      branchState: this.loadBranchState(row.branch_id),
    };
  }

  loadStoryMemory(sessionId: string): StoryMemoryDashboard {
    requireText(sessionId, "sessionId");
    const branch = this.getActiveBranch(sessionId);
    this.ensureStoryMemoryIndex(sessionId, branch.id);
    return loadStoryMemoryDashboard({
      database: this.database,
      sessionId,
      branchId: branch.id,
    });
  }

  selectStoryMemory(input: {
    sessionId: string;
    query: string;
    branchId?: string;
  }): StoryMemoryContext {
    requireText(input.sessionId, "sessionId");
    const branch = input.branchId
      ? this.getBranch(input.branchId)
      : this.getActiveBranch(input.sessionId);
    if (branch.session_id !== input.sessionId) throw new StoryNotFoundError();
    this.ensureStoryMemoryIndex(input.sessionId, branch.id);
    return selectStoryMemoryContext({
      database: this.database,
      sessionId: input.sessionId,
      branchId: branch.id,
      query: input.query,
    });
  }

  rebuildStoryMemory(sessionId: string): StoryMemoryDashboard {
    requireText(sessionId, "sessionId");
    const branch = this.getActiveBranch(sessionId);
    this.synchronizeStoryMemory(sessionId, branch.id);
    return loadStoryMemoryDashboard({
      database: this.database,
      sessionId,
      branchId: branch.id,
    });
  }

  updateStoryMemoryEntry(
    sessionId: string,
    input: {
      entryId: string;
      title?: string;
      content?: string;
      importance?: number;
      status?: "active" | "resolved";
      pinned?: boolean;
      enabled?: boolean;
    },
  ): StoryMemoryDashboard {
    requireText(sessionId, "sessionId");
    requireText(input.entryId, "entryId");
    const branch = this.getActiveBranch(sessionId);
    updateStoryMemoryEntry({
      database: this.database,
      branchId: branch.id,
      ...input,
    });
    return loadStoryMemoryDashboard({
      database: this.database,
      sessionId,
      branchId: branch.id,
    });
  }

  updateStoryMemorySettings(
    sessionId: string,
    settings: {
      memoryTokenBudget: number;
      recentTurnCount: number;
      chapterSize: number;
    },
  ): StoryMemoryDashboard {
    requireText(sessionId, "sessionId");
    const branch = this.getActiveBranch(sessionId);
    updateStoryMemorySettings({
      database: this.database,
      sessionId,
      ...settings,
    });
    this.synchronizeStoryMemory(sessionId, branch.id);
    return loadStoryMemoryDashboard({
      database: this.database,
      sessionId,
      branchId: branch.id,
    });
  }

  renameAdventure(sessionId: string, requestedName: string): RenamedAdventure {
    requireText(sessionId, "sessionId");
    requireText(requestedName, "剧本名称");
    const name = requestedName.trim();
    if (name.length > 80) {
      throw new Error("剧本名称不能超过 80 个字符。");
    }
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const selected = this.database
        .prepare(`
          SELECT
            sessions.campaign_id AS campaign_id,
            sessions.name AS session_name,
            campaigns.name AS campaign_name,
            sessions.updated_at AS updated_at
          FROM sessions
          JOIN campaigns ON campaigns.id = sessions.campaign_id
          WHERE sessions.id = ?
        `)
        .get(sessionId) as
        | {
            campaign_id: string;
            session_name: string;
            campaign_name: string;
            updated_at: string;
          }
        | undefined;
      if (!selected) throw new StoryNotFoundError();

      if (selected.campaign_name === name) {
        this.database.exec("COMMIT");
        return {
          campaignId: selected.campaign_id,
          sessionId,
          name,
          sessionName: selected.session_name,
          updatedAt: selected.updated_at,
          changed: false,
        };
      }

      const sessions = this.database
        .prepare("SELECT id, name FROM sessions WHERE campaign_id = ?")
        .all(selected.campaign_id) as unknown as Array<{
        id: string;
        name: string;
      }>;
      const updateSession = this.database.prepare(
        "UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?",
      );
      let selectedSessionName = `${name} · 第一幕`;
      for (const session of sessions) {
        const suffix = session.name.startsWith(selected.campaign_name)
          ? session.name.slice(selected.campaign_name.length)
          : " · 第一幕";
        const sessionName = `${name}${suffix}`;
        updateSession.run(sessionName, now, session.id);
        if (session.id === sessionId) selectedSessionName = sessionName;
      }
      this.database
        .prepare("UPDATE campaigns SET name = ?, updated_at = ? WHERE id = ?")
        .run(name, now, selected.campaign_id);
      this.database.exec("COMMIT");
      return {
        campaignId: selected.campaign_id,
        sessionId,
        name,
        sessionName: selectedSessionName,
        updatedAt: now,
        changed: true,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  deleteAdventure(sessionId: string) {
    requireText(sessionId, "sessionId");
    const session = this.database
      .prepare("SELECT campaign_id FROM sessions WHERE id = ?")
      .get(sessionId) as { campaign_id: string } | undefined;
    if (!session) {
      throw new StoryNotFoundError();
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const deletedSession = this.database
        .prepare("DELETE FROM sessions WHERE id = ?")
        .run(sessionId);
      if (deletedSession.changes !== 1) {
        throw new StoryNotFoundError();
      }

      const remaining = this.database
        .prepare("SELECT COUNT(*) AS total FROM sessions WHERE campaign_id = ?")
        .get(session.campaign_id) as { total: number };
      const removedCampaign = remaining.total === 0;
      if (removedCampaign) {
        this.database
          .prepare("DELETE FROM campaigns WHERE id = ?")
          .run(session.campaign_id);
      }

      this.database.exec("COMMIT");
      return { sessionId, campaignId: session.campaign_id, removedCampaign };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listBranches(sessionId: string): AdventureBranchSummary[] {
    requireText(sessionId, "sessionId");
    const session = this.database
      .prepare("SELECT active_branch_id FROM sessions WHERE id = ?")
      .get(sessionId) as { active_branch_id: string | null } | undefined;
    if (!session) throw new StoryNotFoundError();
    const rows = this.database
      .prepare(`
        SELECT branches.id, branches.name, branches.parent_branch_id,
               branches.forked_from_turn_id, branches.head_turn_id,
               branches.next_sequence, branches.created_at, branches.updated_at,
               COALESCE(turns.sequence, 0) AS head_sequence
        FROM branches
        LEFT JOIN turns ON turns.id = branches.head_turn_id
        WHERE branches.session_id = ?
        ORDER BY branches.created_at, branches.id
      `)
      .all(sessionId) as unknown as Array<BranchRow & { head_sequence: number }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentBranchId: row.parent_branch_id,
      forkedFromTurnId: row.forked_from_turn_id,
      headTurnId: row.head_turn_id,
      headSequence: row.head_sequence,
      turnCount: row.head_sequence,
      isActive: row.id === session.active_branch_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  listRecoveryPoints(sessionId: string): AdventureRecoveryPoint[] {
    requireText(sessionId, "sessionId");
    const session = this.database
      .prepare("SELECT 1 AS found FROM sessions WHERE id = ?")
      .get(sessionId);
    if (!session) throw new StoryNotFoundError();
    const rows = this.database
      .prepare(`
        SELECT save_points.id, 'manual' AS type, save_points.name,
               save_points.branch_id, branches.name AS branch_name,
               save_points.turn_id, save_points.sequence,
               save_points.created_at
        FROM save_points
        JOIN branches ON branches.id = save_points.branch_id
        WHERE save_points.session_id = ?
        UNION ALL
        SELECT snapshots.id, snapshots.kind AS type, snapshots.name,
               snapshots.branch_id, branches.name AS branch_name,
               snapshots.turn_id, snapshots.sequence,
               snapshots.created_at
        FROM snapshots
        JOIN branches ON branches.id = snapshots.branch_id
        WHERE snapshots.session_id = ?
        ORDER BY 8 DESC, 7 DESC
      `)
      .all(sessionId, sessionId) as unknown as Array<{
        id: string;
        type: string;
        name: string;
        branch_id: string;
        branch_name: string;
        turn_id: string;
        sequence: number;
        created_at: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      type:
        row.type === "manual"
          ? "manual"
          : row.type === "fork"
            ? "fork"
            : "automatic",
      name:
        row.name ||
        (row.type === "fork"
          ? `分支起点 · 回合 ${row.sequence}`
          : `自动存档 · 回合 ${row.sequence}`),
      branchId: row.branch_id,
      branchName: row.branch_name,
      turnId: row.turn_id,
      sequence: row.sequence,
      createdAt: row.created_at,
    }));
  }

  createBranch(input: {
    sessionId: string;
    name: string;
    sourceTurnId?: string;
    recoveryPointId?: string;
  }): CreatedAdventureBranch {
    requireText(input.sessionId, "sessionId");
    requireText(input.name, "分支名称");
    const name = input.name.trim();
    if (name.length > 80) {
      throw new BranchManagementError("分支名称不能超过 80 个字符。");
    }
    if (!input.sourceTurnId && !input.recoveryPointId) {
      throw new BranchManagementError("请选择要创建分支的历史回合或存档。");
    }
    const active = this.getActiveBranch(input.sessionId);
    let sourceTurnId = input.sourceTurnId?.trim() ?? "";
    let sourceSequence = 0;
    let parentBranchId = active.id;
    let states: ReplayedMaterializedState[];

    if (input.recoveryPointId) {
      const recovery = this.loadRecoveryPoint(
        input.sessionId,
        input.recoveryPointId,
      );
      sourceTurnId = recovery.turnId;
      sourceSequence = recovery.sequence;
      parentBranchId = recovery.branchId;
      states = recovery.states;
    } else {
      const visibleTurns = this.loadVisibleTurnRows(active.id);
      const sourceTurn = visibleTurns.find((turn) => turn.id === sourceTurnId);
      if (!sourceTurn) {
        throw new BranchManagementError("所选回合不属于当前剧情分支。");
      }
      sourceSequence = sourceTurn.sequence;
      parentBranchId = this.findStateContextBranch(
        active.id,
        sourceTurnId,
      );
      states = this.reconstructStatesThroughSequence({
        sessionId: input.sessionId,
        branchId: parentBranchId,
        sequence: sourceSequence,
      });
    }

    const branchId = randomUUID();
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const duplicate = this.database
        .prepare("SELECT 1 AS found FROM branches WHERE session_id = ? AND name = ?")
        .get(input.sessionId, name);
      if (duplicate) {
        throw new BranchManagementError("同一剧本中的分支名称不能重复。");
      }
      this.database
        .prepare(`
          INSERT INTO branches (
            id, session_id, name, parent_branch_id, forked_from_turn_id,
            head_turn_id, next_sequence, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          branchId,
          input.sessionId,
          name,
          parentBranchId,
          sourceTurnId,
          sourceTurnId,
          sourceSequence + 1,
          now,
          now,
        );
      const insertState = this.database.prepare(`
        INSERT INTO materialized_states (
          session_id, branch_id, entity_type, entity_id, state_json,
          is_active, version, updated_turn_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const state of states) {
        insertState.run(
          input.sessionId,
          branchId,
          state.entityType,
          state.entityId,
          stringifyJson(state.state),
          state.isActive ? 1 : 0,
          state.version,
          state.updatedTurnId,
          state.updatedAt || now,
        );
      }
      this.writeSnapshot({
        sessionId: input.sessionId,
        branchId,
        turnId: sourceTurnId,
        sequence: sourceSequence,
        name: `分支起点 · ${name}`,
        kind: "fork",
        now,
      });
      this.database
        .prepare(
          "UPDATE sessions SET active_branch_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(branchId, now, input.sessionId);
      this.synchronizeStoryMemory(input.sessionId, branchId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { branchId, name, sourceTurnId, sourceSequence };
  }

  switchBranch(sessionId: string, branchId: string) {
    requireText(sessionId, "sessionId");
    requireText(branchId, "branchId");
    const branch = this.getBranch(branchId);
    if (branch.session_id !== sessionId) {
      throw new StoryNotFoundError("没有找到指定的剧情分支。");
    }
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        "UPDATE sessions SET active_branch_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(branchId, now, sessionId);
    if (result.changes !== 1) throw new StoryNotFoundError();
    return { branchId, changedAt: now };
  }

  renameBranch(sessionId: string, branchId: string, requestedName: string) {
    requireText(sessionId, "sessionId");
    requireText(branchId, "branchId");
    requireText(requestedName, "分支名称");
    const name = requestedName.trim();
    if (name.length > 80) {
      throw new BranchManagementError("分支名称不能超过 80 个字符。");
    }
    const branch = this.getBranch(branchId);
    if (branch.session_id !== sessionId) {
      throw new StoryNotFoundError("没有找到指定的剧情分支。");
    }
    const now = new Date().toISOString();
    try {
      this.database
        .prepare(
          "UPDATE branches SET name = ?, updated_at = ? WHERE id = ? AND session_id = ?",
        )
        .run(name, now, branchId, sessionId);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        throw new BranchManagementError("同一剧本中的分支名称不能重复。");
      }
      throw error;
    }
    return { branchId, name, updatedAt: now };
  }

  deleteBranch(sessionId: string, branchId: string) {
    requireText(sessionId, "sessionId");
    requireText(branchId, "branchId");
    const branch = this.getBranch(branchId);
    if (branch.session_id !== sessionId) {
      throw new StoryNotFoundError("没有找到指定的剧情分支。");
    }
    if (!branch.parent_branch_id) {
      throw new BranchManagementError("主线分支不能删除。");
    }
    const child = this.database
      .prepare("SELECT 1 AS found FROM branches WHERE parent_branch_id = ? LIMIT 1")
      .get(branchId);
    if (child) {
      throw new BranchManagementError("该分支仍有子分支，请先删除最末端的子分支。");
    }
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const session = this.database
        .prepare("SELECT active_branch_id FROM sessions WHERE id = ?")
        .get(sessionId) as { active_branch_id: string | null } | undefined;
      if (!session) throw new StoryNotFoundError();
      if (session.active_branch_id === branchId) {
        this.database
          .prepare(
            "UPDATE sessions SET active_branch_id = ?, updated_at = ? WHERE id = ?",
          )
          .run(branch.parent_branch_id, now, sessionId);
      }
      this.database
        .prepare("DELETE FROM branches WHERE id = ? AND session_id = ?")
        .run(branchId, sessionId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { branchId, activeBranchId: branch.parent_branch_id };
  }

  createSavePoint(sessionId: string, requestedName: string) {
    requireText(sessionId, "sessionId");
    requireText(requestedName, "存档名称");
    const name = requestedName.trim();
    if (name.length > 80) {
      throw new SavePointManagementError("存档名称不能超过 80 个字符。");
    }
    const branch = this.getActiveBranch(sessionId);
    if (!branch.head_turn_id) {
      throw new SavePointManagementError("剧情尚未开始，不能建立存档。");
    }
    const turn = this.database
      .prepare("SELECT sequence FROM turns WHERE id = ?")
      .get(branch.head_turn_id) as { sequence: number } | undefined;
    if (!turn) throw new StoryNotFoundError("没有找到当前剧情回合。");
    const id = randomUUID();
    const now = new Date().toISOString();
    const stateJson = this.serializeMaterializedStates(sessionId, branch.id);
    this.database
      .prepare(`
        INSERT INTO save_points (
          id, session_id, branch_id, turn_id, sequence, name,
          state_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        sessionId,
        branch.id,
        branch.head_turn_id,
        turn.sequence,
        name,
        stateJson,
        now,
        now,
      );
    return {
      id,
      name,
      branchId: branch.id,
      turnId: branch.head_turn_id,
      sequence: turn.sequence,
      createdAt: now,
    };
  }

  deleteSavePoint(sessionId: string, savePointId: string) {
    requireText(sessionId, "sessionId");
    requireText(savePointId, "savePointId");
    const result = this.database
      .prepare("DELETE FROM save_points WHERE id = ? AND session_id = ?")
      .run(savePointId, sessionId);
    if (result.changes !== 1) {
      throw new StoryNotFoundError("没有找到指定的手动存档。");
    }
    return { savePointId };
  }

  manageCharacter(input: CharacterManagementInput): ManagedCharacterResult {
    requireText(input.actionId, "actionId");
    requireText(input.sessionId, "sessionId");
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(`
          SELECT character_id
          FROM character_management_changes
          WHERE session_id = ? AND action_id = ?
          ORDER BY ordinal
          LIMIT 1
        `)
        .get(input.sessionId, input.actionId) as
        | { character_id: string }
        | undefined;
      if (existing) {
        this.database.exec("COMMIT");
        return {
          actionId: input.actionId,
          characterId: existing.character_id,
          operation: input.operation,
          reused: true,
        };
      }

      const branch = this.database
        .prepare(`
          SELECT branches.id, branches.head_turn_id
          FROM branches
          JOIN sessions ON sessions.id = branches.session_id
          WHERE sessions.id = ? AND branches.id = sessions.active_branch_id
          LIMIT 1
        `)
        .get(input.sessionId) as
        | { id: string; head_turn_id: string | null }
        | undefined;
      if (!branch) throw new StoryNotFoundError();
      if (!branch.head_turn_id) {
        throw new CharacterManagementError("剧情尚未建立开场回合，无法管理人物。");
      }

      const cardRows = this.database
        .prepare(`
          SELECT entity_id, state_json, is_active
          FROM materialized_states
          WHERE session_id = ? AND branch_id = ?
            AND entity_type = 'character_card'
        `)
        .all(input.sessionId, branch.id) as unknown as Array<{
        entity_id: string;
        state_json: string;
        is_active: number;
      }>;
      const cards = cardRows.map((row) => ({
        id: row.entity_id,
        state: parseObject(row.state_json),
        isActive: row.is_active === 1,
      }));
      const playerCard = cards.find((card) => card.state.role === "player");
      if (!playerCard) {
        throw new CharacterManagementError("当前剧本缺少玩家角色，无法建立人物关系。");
      }

      const requestedCharacterId =
        input.operation === "create" ? randomUUID() : input.characterId;
      const currentCard = cards.find(
        (card) => card.id === requestedCharacterId,
      );
      if (input.operation !== "create" && !currentCard) {
        throw new StoryNotFoundError("没有找到指定角色。");
      }
      if (currentCard?.state.role === "player") {
        throw new CharacterManagementError("玩家角色不能在 AI 人物管理中修改或停用。");
      }

      const mutations: StateMutationInput[] = [];
      if (input.operation === "create" || input.operation === "update") {
        const normalizedName = input.character.name.trim().toLocaleLowerCase("zh-CN");
        const duplicate = cards.some((card) => {
          if (card.id === requestedCharacterId) return false;
          const data = isJsonObject(card.state.data) ? card.state.data : {};
          return readString(data.name).trim().toLocaleLowerCase("zh-CN") === normalizedName;
        });
        if (duplicate) {
          throw new CharacterManagementError("同一剧本中的角色姓名不能重复。");
        }

        const character = {
          name: input.character.name.trim(),
          role: input.character.role.trim(),
          personality: input.character.personality.trim(),
          firstMessage: input.character.firstMessage?.trim() ?? "",
        };
        if (input.operation === "create") {
          const sessionStateRow = this.database
            .prepare(`
              SELECT state_json
              FROM materialized_states
              WHERE session_id = ? AND branch_id = ?
                AND entity_type = 'session_state' AND entity_id = 'core'
            `)
            .get(input.sessionId, branch.id) as
            | { state_json: string }
            | undefined;
          const sessionState = sessionStateRow
            ? parseObject(sessionStateRow.state_json)
            : {};
          const existingIds = Array.isArray(sessionState.additionalCharacterIds)
            ? sessionState.additionalCharacterIds.filter(
                (value): value is string => typeof value === "string",
              )
            : [];
          const currentMainId = readString(sessionState.mainCharacterId);
          mutations.push(
            {
              entityType: "character_card",
              entityId: requestedCharacterId,
              operation: "replace",
              value: {
                spec: "chara_card_v2",
                spec_version: "2.0",
                role: "character",
                data: {
                  name: character.name,
                  description: character.role,
                  personality: character.personality,
                  scenario: readString(sessionState.currentScene),
                  first_mes: character.firstMessage,
                  mes_example: "",
                  creator_notes: "由 AI 酒馆人物管理创建",
                  system_prompt: "",
                  post_history_instructions: "",
                  alternate_greetings: [],
                  tags: ["剧中新增角色"],
                  extensions: { ai_tavern: { role: "character" } },
                },
              },
              reason: "玩家在人物管理中新增了 AI 角色",
              evidence: [],
            },
            {
              entityType: "character_state",
              entityId: requestedCharacterId,
              operation: "replace",
              value: {
                name: character.name,
                role: character.role,
                present: true,
                ...(readString(sessionState.currentLocationId)
                  ? { locationId: readString(sessionState.currentLocationId) }
                  : {}),
                alive: true,
                mood: "待定",
                currentGoal: "依照角色设定参与后续剧情",
              },
              reason: "建立新增角色的当前状态",
              evidence: [],
            },
            {
              entityType: "relationship",
              entityId: `${playerCard.id}:${requestedCharacterId}`,
              operation: "replace",
              value: {
                sourceCharacterId: playerCard.id,
                targetCharacterId: requestedCharacterId,
                trust: 0,
                affinity: 0,
                fear: 0,
                hostility: 0,
                summary: "关系尚未建立",
              },
              reason: "建立玩家与新增角色的初始关系",
              evidence: [],
            },
            {
              entityType: "session_state",
              entityId: "core",
              operation: "merge",
              value: {
                ...(currentMainId
                  ? {
                      additionalCharacterIds: [
                        ...new Set([...existingIds, requestedCharacterId]),
                      ],
                    }
                  : {
                      mainCharacterId: requestedCharacterId,
                      mainCharacterName: character.name,
                      additionalCharacterIds: existingIds.filter(
                        (characterId) => characterId !== requestedCharacterId,
                      ),
                    }),
              },
              reason: "把新增角色登记到当前剧本",
              evidence: [],
            },
          );
          const currentLocationId = readString(sessionState.currentLocationId);
          if (currentLocationId) {
            const locationRow = this.database
              .prepare(`
                SELECT state_json
                FROM materialized_states
                WHERE session_id = ? AND branch_id = ?
                  AND entity_type = 'location' AND entity_id = ? AND is_active = 1
              `)
              .get(input.sessionId, branch.id, currentLocationId) as
              | { state_json: string }
              | undefined;
            if (locationRow) {
              const locationState = parseObject(locationRow.state_json);
              const defaultCharacterIds = Array.isArray(
                locationState.defaultCharacterIds,
              )
                ? locationState.defaultCharacterIds.filter(
                    (value): value is string => typeof value === "string",
                  )
                : [];
              mutations.push({
                entityType: "location",
                entityId: currentLocationId,
                operation: "merge",
                value: {
                  defaultCharacterIds: [
                    ...new Set([...defaultCharacterIds, requestedCharacterId]),
                  ],
                },
                reason: "把新增且在场的角色加入当前地点默认阵容",
                evidence: [],
              });
            }
          }
        } else {
          mutations.push(
            {
              entityType: "character_card",
              entityId: requestedCharacterId,
              operation: "merge",
              value: {
                data: {
                  name: character.name,
                  description: character.role,
                  personality: character.personality,
                  first_mes: character.firstMessage,
                },
              },
              reason: "玩家在人物管理中编辑了角色卡",
              evidence: [],
            },
            {
              entityType: "character_state",
              entityId: requestedCharacterId,
              operation: "merge",
              value: { name: character.name, role: character.role },
              reason: "同步编辑后的角色姓名和身份",
              evidence: [],
            },
          );

          const sessionStateRow = this.database
            .prepare(`
              SELECT state_json
              FROM materialized_states
              WHERE session_id = ? AND branch_id = ?
                AND entity_type = 'session_state' AND entity_id = 'core'
            `)
            .get(input.sessionId, branch.id) as
            | { state_json: string }
            | undefined;
          const sessionState = sessionStateRow
            ? parseObject(sessionStateRow.state_json)
            : {};
          if (readString(sessionState.mainCharacterId) === requestedCharacterId) {
            mutations.push({
              entityType: "session_state",
              entityId: "core",
              operation: "merge",
              value: { mainCharacterName: character.name },
              reason: "同步主要角色的新姓名",
              evidence: [],
            });
          }
        }
      } else if (input.operation === "set_presence") {
        if (!currentCard?.isActive) {
          throw new CharacterManagementError("停用角色不能修改在场状态，请先重新启用。");
        }
        mutations.push({
          entityType: "character_state",
          entityId: requestedCharacterId,
          operation: "merge",
          value: { present: input.present },
          reason: input.present
            ? "玩家让角色重新进入当前剧情"
            : "玩家让角色暂时离开当前剧情",
          evidence: [],
        });
      } else {
        const relatedRows = this.database
          .prepare(`
            SELECT entity_id, state_json, is_active
            FROM materialized_states
            WHERE session_id = ? AND branch_id = ?
              AND entity_type = 'relationship'
          `)
          .all(input.sessionId, branch.id) as unknown as Array<{
          entity_id: string;
          state_json: string;
          is_active: number;
        }>;
        const relatedIds = relatedRows
          .filter((row) => {
            const state = parseObject(row.state_json);
            return (
              state.sourceCharacterId === requestedCharacterId ||
              state.targetCharacterId === requestedCharacterId
            );
          })
          .map((row) => row.entity_id);
        const evolutionExists = this.database
          .prepare(`
            SELECT 1 AS found
            FROM materialized_states
            WHERE session_id = ? AND branch_id = ?
              AND entity_type = 'character_card_evolution' AND entity_id = ?
          `)
          .get(input.sessionId, branch.id, requestedCharacterId) as
          | { found: number }
          | undefined;
        const operation = input.active ? "activate" : "deactivate";
        mutations.push(
          {
            entityType: "character_card",
            entityId: requestedCharacterId,
            operation,
            ...(input.active ? { value: {} } : {}),
            reason: input.active
              ? "玩家重新启用了该 AI 角色"
              : "玩家停用了该 AI 角色",
            evidence: [],
          },
          {
            entityType: "character_state",
            entityId: requestedCharacterId,
            operation,
            ...(input.active ? { value: {} } : {}),
            reason: input.active ? "恢复角色当前状态" : "暂停角色当前状态",
            evidence: [],
          },
          ...relatedIds.map(
            (entityId): StateMutationInput => ({
              entityType: "relationship",
              entityId,
              operation,
              ...(input.active ? { value: {} } : {}),
              reason: input.active ? "恢复该角色的关系状态" : "暂停该角色的关系状态",
              evidence: [],
            }),
          ),
        );
        if (evolutionExists) {
          mutations.push({
            entityType: "character_card_evolution",
            entityId: requestedCharacterId,
            operation,
            ...(input.active ? { value: {} } : {}),
            reason: input.active ? "恢复该角色的演化记录" : "暂停该角色的演化记录",
            evidence: [],
          });
        }
        if (!input.active) {
          const locationRows = this.database
            .prepare(`
              SELECT entity_id, state_json
              FROM materialized_states
              WHERE session_id = ? AND branch_id = ?
                AND entity_type = 'location'
            `)
            .all(input.sessionId, branch.id) as unknown as Array<{
            entity_id: string;
            state_json: string;
          }>;
          for (const locationRow of locationRows) {
            const locationState = parseObject(locationRow.state_json);
            const defaultCharacterIds = Array.isArray(
              locationState.defaultCharacterIds,
            )
              ? locationState.defaultCharacterIds.filter(
                  (value): value is string => typeof value === "string",
                )
              : [];
            if (!defaultCharacterIds.includes(requestedCharacterId)) continue;
            mutations.push({
              entityType: "location",
              entityId: locationRow.entity_id,
              operation: "merge",
              value: {
                defaultCharacterIds: defaultCharacterIds.filter(
                  (characterId) => characterId !== requestedCharacterId,
                ),
              },
              reason: "从地点默认阵容中移除停用角色",
              evidence: [],
            });
          }
        }

        const sessionStateRow = this.database
          .prepare(`
            SELECT state_json
            FROM materialized_states
            WHERE session_id = ? AND branch_id = ?
              AND entity_type = 'session_state' AND entity_id = 'core'
          `)
          .get(input.sessionId, branch.id) as
          | { state_json: string }
          | undefined;
        const sessionState = sessionStateRow
          ? parseObject(sessionStateRow.state_json)
          : {};
        const currentMainId = readString(sessionState.mainCharacterId);
        const additionalIds = Array.isArray(sessionState.additionalCharacterIds)
          ? sessionState.additionalCharacterIds.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        const requestedData = currentCard && isJsonObject(currentCard.state.data)
          ? currentCard.state.data
          : {};
        let nextMainId = currentMainId;
        let nextMainName = readString(sessionState.mainCharacterName);
        let nextAdditionalIds = additionalIds.filter(
          (characterId) => characterId !== requestedCharacterId,
        );

        if (input.active) {
          if (!currentMainId) {
            nextMainId = requestedCharacterId;
            nextMainName = readString(requestedData.name);
          } else if (currentMainId !== requestedCharacterId) {
            nextAdditionalIds = [
              ...new Set([...nextAdditionalIds, requestedCharacterId]),
            ];
          }
        } else if (currentMainId === requestedCharacterId) {
          const replacement = cards.find(
            (card) =>
              card.id !== requestedCharacterId &&
              card.state.role === "character" &&
              card.isActive,
          );
          const replacementData =
            replacement && isJsonObject(replacement.state.data)
            ? replacement.state.data
            : {};
          nextMainId = replacement?.id ?? "";
          nextMainName = readString(replacementData.name);
          if (replacement) {
            nextAdditionalIds = nextAdditionalIds.filter(
              (characterId) => characterId !== replacement.id,
            );
          }
        }

        mutations.push({
          entityType: "session_state",
          entityId: "core",
          operation: "merge",
          value: {
            mainCharacterId: nextMainId || null,
            mainCharacterName: nextMainName || null,
            additionalCharacterIds: nextAdditionalIds,
          },
          reason: input.active
            ? "把重新启用的角色登记回当前剧本"
            : "从当前登场人物登记中移除停用角色",
          evidence: [],
        });
      }

      this.applyCharacterManagementMutations({
        actionId: input.actionId,
        sessionId: input.sessionId,
        branchId: branch.id,
        referenceTurnId: branch.head_turn_id,
        characterId: requestedCharacterId,
        mutations,
        now,
      });
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);
      this.database.exec("COMMIT");
      return {
        actionId: input.actionId,
        characterId: requestedCharacterId,
        operation: input.operation,
        reused: false,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  manageLocation(input: LocationManagementInput): ManagedLocationResult {
    requireText(input.actionId, "actionId");
    requireText(input.sessionId, "sessionId");
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(`
          SELECT location_id
          FROM location_management_changes
          WHERE session_id = ? AND action_id = ?
          ORDER BY ordinal
          LIMIT 1
        `)
        .get(input.sessionId, input.actionId) as
        | { location_id: string }
        | undefined;
      if (existing) {
        this.database.exec("COMMIT");
        return {
          actionId: input.actionId,
          locationId: existing.location_id,
          operation: input.operation,
          reused: true,
        };
      }

      const branch = this.database
        .prepare(`
          SELECT branches.id, branches.head_turn_id
          FROM branches
          JOIN sessions ON sessions.id = branches.session_id
          WHERE sessions.id = ? AND branches.id = sessions.active_branch_id
          LIMIT 1
        `)
        .get(input.sessionId) as
        | { id: string; head_turn_id: string | null }
        | undefined;
      if (!branch) throw new StoryNotFoundError();
      if (!branch.head_turn_id) {
        throw new LocationManagementError("剧情尚未建立开场回合，无法管理地点。");
      }

      const locationRows = this.database
        .prepare(`
          SELECT entity_id, state_json, is_active
          FROM materialized_states
          WHERE session_id = ? AND branch_id = ? AND entity_type = 'location'
        `)
        .all(input.sessionId, branch.id) as unknown as Array<{
        entity_id: string;
        state_json: string;
        is_active: number;
      }>;
      const locations = locationRows.map((row) => ({
        id: row.entity_id,
        state: parseObject(row.state_json),
        isActive: row.is_active === 1,
      }));
      const sessionStateRow = this.database
        .prepare(`
          SELECT state_json
          FROM materialized_states
          WHERE session_id = ? AND branch_id = ?
            AND entity_type = 'session_state' AND entity_id = 'core'
        `)
        .get(input.sessionId, branch.id) as
        | { state_json: string }
        | undefined;
      const sessionState = sessionStateRow
        ? parseObject(sessionStateRow.state_json)
        : {};
      const currentLocationId = readString(sessionState.currentLocationId);

      const cardRows = this.database
        .prepare(`
          SELECT entity_id, state_json
          FROM materialized_states
          WHERE session_id = ? AND branch_id = ?
            AND entity_type = 'character_card' AND is_active = 1
        `)
        .all(input.sessionId, branch.id) as unknown as Array<{
        entity_id: string;
        state_json: string;
      }>;
      const activeCharacters = cardRows.map((row) => ({
        id: row.entity_id,
        state: parseObject(row.state_json),
      }));
      const playerCharacter = activeCharacters.find(
        (character) => character.state.role === "player",
      );
      if (!playerCharacter) {
        throw new LocationManagementError("当前剧本缺少玩家角色，无法同步地点阵容。");
      }
      const activeAiIds = new Set(
        activeCharacters
          .filter((character) => character.state.role === "character")
          .map((character) => character.id),
      );

      const requestedLocationId =
        input.operation === "create" ? randomUUID() : input.locationId;
      const currentLocation = locations.find(
        (location) => location.id === requestedLocationId,
      );
      if (input.operation !== "create" && !currentLocation) {
        throw new StoryNotFoundError("没有找到指定地点。");
      }

      const mutations: StateMutationInput[] = [];
      const addRosterSynchronization = (
        locationId: string,
        locationName: string,
        defaultCharacterIds: string[],
        reason: string,
      ) => {
        const roster = new Set(defaultCharacterIds);
        mutations.push({
          entityType: "session_state",
          entityId: "core",
          operation: "merge",
          value: {
            currentLocationId: locationId,
            currentLocationName: locationName,
          },
          reason,
          evidence: [],
        });
        for (const character of activeCharacters) {
          const isPlayer = character.id === playerCharacter.id;
          const present = isPlayer || roster.has(character.id);
          mutations.push({
            entityType: "character_state",
            entityId: character.id,
            operation: "merge",
            value: {
              present,
              ...(present ? { locationId } : {}),
            },
            reason: present
              ? `同步 ${locationName} 的当前登场阵容`
              : `角色不在 ${locationName} 的默认登场阵容中`,
            evidence: [],
          });
        }
      };

      if (input.operation === "create" || input.operation === "update") {
        const normalizedName = input.location.name
          .trim()
          .toLocaleLowerCase("zh-CN");
        const duplicate = locations.some(
          (location) =>
            location.id !== requestedLocationId &&
            readString(location.state.name)
              .trim()
              .toLocaleLowerCase("zh-CN") === normalizedName,
        );
        if (duplicate) {
          throw new LocationManagementError("同一剧本中的地点名称不能重复。");
        }
        for (const characterId of input.location.defaultCharacterIds) {
          if (!activeAiIds.has(characterId)) {
            throw new LocationManagementError(
              "默认登场人物只能选择当前启用的 AI 角色。",
            );
          }
        }
        const locationValue: JsonObject = {
          name: input.location.name.trim(),
          description: input.location.description.trim(),
          defaultCharacterIds: input.location.defaultCharacterIds,
          source: input.operation === "create" ? "player" : currentLocation?.state.source ?? "player",
        };
        mutations.push({
          entityType: "location",
          entityId: requestedLocationId,
          operation: input.operation === "create" ? "replace" : "merge",
          value: locationValue,
          reason:
            input.operation === "create"
              ? "玩家在地点管理中新增了地点"
              : "玩家在地点管理中更新了地点资料",
          evidence: [],
        });
        if (!currentLocationId || currentLocationId === requestedLocationId) {
          addRosterSynchronization(
            requestedLocationId,
            input.location.name.trim(),
            input.location.defaultCharacterIds,
            currentLocationId
              ? "同步当前地点资料和默认登场阵容"
              : "把首个地点设为当前位置并同步登场阵容",
          );
        }
      } else if (input.operation === "set_current") {
        if (!currentLocation?.isActive) {
          throw new LocationManagementError("停用地点不能设为当前位置，请先重新启用。");
        }
        const defaultCharacterIds = Array.isArray(
          currentLocation.state.defaultCharacterIds,
        )
          ? currentLocation.state.defaultCharacterIds.filter(
              (value): value is string =>
                typeof value === "string" && activeAiIds.has(value),
            )
          : [];
        addRosterSynchronization(
          requestedLocationId,
          readString(currentLocation.state.name) || "未命名地点",
          defaultCharacterIds,
          "玩家切换了当前位置",
        );
      } else {
        if (!input.active && currentLocationId === requestedLocationId) {
          throw new LocationManagementError("当前位置不能停用，请先移动到其他地点。");
        }
        mutations.push({
          entityType: "location",
          entityId: requestedLocationId,
          operation: input.active ? "activate" : "deactivate",
          ...(input.active ? { value: {} } : {}),
          reason: input.active ? "玩家重新启用了该地点" : "玩家停用了该地点",
          evidence: [],
        });
      }

      this.applyLocationManagementMutations({
        actionId: input.actionId,
        sessionId: input.sessionId,
        branchId: branch.id,
        referenceTurnId: branch.head_turn_id,
        locationId: requestedLocationId,
        mutations,
        now,
      });
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);
      this.database.exec("COMMIT");
      return {
        actionId: input.actionId,
        locationId: requestedLocationId,
        operation: input.operation,
        reused: false,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  manageWorldBook(input: WorldBookManagementInput): ManagedWorldBookResult {
    requireText(input.actionId, "actionId");
    requireText(input.sessionId, "sessionId");
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(`
          SELECT world_book_entry_id
          FROM world_book_management_changes
          WHERE session_id = ? AND action_id = ?
          ORDER BY ordinal
          LIMIT 1
        `)
        .get(input.sessionId, input.actionId) as
        | { world_book_entry_id: string }
        | undefined;
      if (existing) {
        this.database.exec("COMMIT");
        return {
          actionId: input.actionId,
          entryId: existing.world_book_entry_id,
          operation: input.operation,
          reused: true,
        };
      }

      const branch = this.database
        .prepare(`
          SELECT branches.id, branches.head_turn_id
          FROM branches
          JOIN sessions ON sessions.id = branches.session_id
          WHERE sessions.id = ? AND branches.id = sessions.active_branch_id
          LIMIT 1
        `)
        .get(input.sessionId) as
        | { id: string; head_turn_id: string | null }
        | undefined;
      if (!branch) throw new StoryNotFoundError();
      if (!branch.head_turn_id) {
        throw new WorldBookManagementError(
          "剧情尚未建立开场回合，无法管理世界书。",
        );
      }

      const rows = this.database
        .prepare(`
          SELECT entity_id, state_json, is_active, version
          FROM materialized_states
          WHERE session_id = ? AND branch_id = ?
            AND entity_type = 'world_book_entry'
        `)
        .all(input.sessionId, branch.id) as unknown as Array<{
        entity_id: string;
        state_json: string;
        is_active: number;
        version: number;
      }>;
      const entries = rows.map((row) => ({
        entityId: row.entity_id,
        state: parseObject(row.state_json),
        isActive: row.is_active === 1,
        version: row.version,
      }));
      const activeStandaloneCount = entries.filter(
        (entry) => entry.isActive && !readString(entry.state.shadowsEntryId),
      ).length;
      const requestedEntryId =
        input.operation === "create"
          ? `world-player-${randomUUID()}`
          : input.entryId.trim();
      const current = entries.find((entry) => entry.entityId === requestedEntryId);
      if (input.operation !== "create" && (!current || !current.isActive)) {
        throw new StoryNotFoundError("没有找到指定的有效世界书条目。");
      }
      if (input.operation === "create" && activeStandaloneCount >= 200) {
        throw new WorldBookManagementError(
          "一个剧本最多保存 200 条独立世界书事实；可以编辑已有条目或停用不再需要的条目。",
        );
      }

      const mutations: StateMutationInput[] = [];
      let resultEntryId = requestedEntryId;
      let overridesEntryId: string | undefined;
      const isProtectedBase =
        current?.state.layer === "base" || current?.state.layer === "base_import";
      const activeShadows = current
        ? entries
            .filter(
              (entry) =>
                entry.isActive &&
                readString(entry.state.shadowsEntryId) === current.entityId,
            )
            .sort((left, right) => right.version - left.version)
        : [];
      const selectedShadow = activeShadows[0];

      const normalizedEntry = (
        entry: AdventureWorldBookEntryInput,
      ): JsonObject => ({
        comment: entry.comment?.trim() ?? "",
        keys: entry.keys.map((key) => key.trim()),
        secondaryKeys: (entry.secondaryKeys ?? []).map((key) => key.trim()),
        content: entry.content.trim(),
        enabled: entry.enabled,
        constant: entry.constant === true,
        selective: entry.selective === true,
        position: entry.position ?? "before_char",
        order: entry.order ?? 100,
        probability: entry.probability ?? 100,
        depth: entry.depth ?? 4,
        extensions: structuredClone(entry.extensions ?? {}),
      });

      if (input.operation === "create") {
        mutations.push({
          entityType: "world_book_entry",
          entityId: requestedEntryId,
          operation: "replace",
          value: {
            ...normalizedEntry(input.entry),
            layer: "player",
            source: {
              bookName: "玩家工作台",
              entryId: requestedEntryId,
              format: "ai_tavern_world_book_v1",
            },
            playerUpdatedAt: now,
          },
          reason: "玩家在世界书管理中新增了长期世界事实",
          evidence: [],
        });
      } else if (input.operation === "restore_base") {
        const baseEntryId = readString(current!.state.shadowsEntryId);
        if (!baseEntryId) {
          throw new WorldBookManagementError(
            "只有覆盖基础条目的修订层才能恢复为基础版本。",
          );
        }
        const shadows = entries.filter(
          (entry) =>
            entry.isActive && readString(entry.state.shadowsEntryId) === baseEntryId,
        );
        for (const shadow of shadows) {
          mutations.push({
            entityType: "world_book_entry",
            entityId: shadow.entityId,
            operation: "deactivate",
            reason: "玩家撤销世界书覆盖层并恢复基础版本",
            evidence: [],
          });
        }
        overridesEntryId = baseEntryId;
      } else {
        let target = current!;
        if (isProtectedBase) {
          overridesEntryId = current!.entityId;
          if (selectedShadow) {
            target = selectedShadow;
          } else {
            target = {
              entityId: `world-player-${randomUUID()}`,
              state: structuredClone(current!.state),
              isActive: false,
              version: 0,
            };
          }
          resultEntryId = target.entityId;
          for (const duplicate of activeShadows.slice(1)) {
            mutations.push({
              entityType: "world_book_entry",
              entityId: duplicate.entityId,
              operation: "deactivate",
              reason: "合并同一基础世界书条目的重复覆盖层",
              evidence: [],
            });
          }
        }

        const sourceLayer =
          readString(target.state.sourceLayer) || readString(target.state.layer);
        const overrideMetadata: JsonObject = {
          layer: "player_override",
          sourceLayer: sourceLayer || "session_overlay",
          playerUpdatedAt: now,
        };
        if (isProtectedBase) {
          overrideMetadata.shadowsEntryId = current!.entityId;
          overrideMetadata.baseLayer = readString(current!.state.layer);
        }

        if (input.operation === "update") {
          mutations.push({
            entityType: "world_book_entry",
            entityId: target.entityId,
            operation: "replace",
            value: {
              ...structuredClone(target.state),
              ...normalizedEntry(input.entry),
              ...overrideMetadata,
              removedByPlayer: null,
            },
            reason: isProtectedBase
              ? "玩家为不可变的基础世界书条目建立了修订覆盖层"
              : "玩家在世界书管理中更新了条目",
            evidence: [],
          });
        } else {
          const enabled =
            input.operation === "set_enabled" ? input.enabled : false;
          mutations.push({
            entityType: "world_book_entry",
            entityId: target.entityId,
            operation: target.isActive ? "merge" : "replace",
            value: target.isActive
              ? {
                  ...overrideMetadata,
                  enabled,
                  removedByPlayer:
                    input.operation === "remove" ? true : null,
                }
              : {
                  ...structuredClone(target.state),
                  ...overrideMetadata,
                  enabled,
                  removedByPlayer:
                    input.operation === "remove" ? true : null,
                },
            reason:
              input.operation === "remove"
                ? "玩家在世界书管理中移除了条目；保留停用记录以便审计和恢复"
                : enabled
                  ? "玩家启用了世界书条目"
                  : "玩家停用了世界书条目",
            evidence: [],
          });
        }
      }

      this.applyWorldBookManagementMutations({
        actionId: input.actionId,
        sessionId: input.sessionId,
        branchId: branch.id,
        referenceTurnId: branch.head_turn_id,
        worldBookEntryId: resultEntryId,
        mutations,
        now,
      });
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);
      this.database.exec("COMMIT");
      return {
        actionId: input.actionId,
        entryId: resultEntryId,
        operation: input.operation,
        reused: false,
        ...(overridesEntryId ? { overridesEntryId } : {}),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  manageStoryModule(
    input: StoryModuleManagementInput,
  ): ManagedStoryModuleResult {
    requireText(input.actionId, "actionId");
    requireText(input.sessionId, "sessionId");
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(`
          SELECT story_module_id
          FROM story_module_management_changes
          WHERE session_id = ? AND action_id = ?
          ORDER BY ordinal
          LIMIT 1
        `)
        .get(input.sessionId, input.actionId) as
        | { story_module_id: string }
        | undefined;
      if (existing) {
        this.database.exec("COMMIT");
        return {
          actionId: input.actionId,
          moduleId: existing.story_module_id,
          operation: input.operation,
          reused: true,
        };
      }

      const branch = this.database
        .prepare(`
          SELECT branches.id, branches.head_turn_id
          FROM branches
          JOIN sessions ON sessions.id = branches.session_id
          WHERE sessions.id = ? AND branches.id = sessions.active_branch_id
          LIMIT 1
        `)
        .get(input.sessionId) as
        | { id: string; head_turn_id: string | null }
        | undefined;
      if (!branch) throw new StoryNotFoundError();
      if (!branch.head_turn_id) {
        throw new StoryModuleManagementError(
          "剧情尚未建立开场回合，无法管理剧情任务。",
        );
      }

      const moduleRows = this.database
        .prepare(`
          SELECT entity_id, state_json, is_active
          FROM materialized_states
          WHERE session_id = ? AND branch_id = ?
            AND entity_type = 'story_module'
        `)
        .all(input.sessionId, branch.id) as unknown as Array<{
        entity_id: string;
        state_json: string;
        is_active: number;
      }>;
      const modules = moduleRows.map((row) => ({
        entityId: row.entity_id,
        state: parseObject(row.state_json),
        isActive: row.is_active === 1,
      }));
      const requestedModuleId =
        input.operation === "create" ? input.module.id.trim() : input.moduleId.trim();
      requireText(requestedModuleId, "moduleId");
      const currentModule = modules.find(
        (module) => readString(module.state.moduleId) === requestedModuleId,
      );
      if (input.operation === "create" && currentModule) {
        throw new StoryModuleManagementError("剧情任务 ID 已存在，请换一个 ID。");
      }
      if (input.operation !== "create" && !currentModule) {
        throw new StoryNotFoundError("没有找到指定的剧情任务。");
      }

      const mutations: StateMutationInput[] = [];
      if (input.operation === "create" || input.operation === "update") {
        const moduleInput = input.module;
        requireText(moduleInput.id, "剧情任务 ID");
        requireText(moduleInput.title, "剧情任务标题");
        requireText(moduleInput.objective, "剧情任务目标");
        if (moduleInput.id.trim() !== requestedModuleId) {
          throw new StoryModuleManagementError("编辑剧情任务时不能修改任务 ID。");
        }
        if (moduleInput.completionCriteria.length === 0) {
          throw new StoryModuleManagementError("剧情任务至少需要一项完成条件。");
        }
        if (input.operation === "create" && modules.length >= 30) {
          throw new StoryModuleManagementError("一个剧本最多保存 30 个剧情任务。");
        }
        const currentStatus = readString(currentModule?.state.status);
        if (
          input.operation === "update" &&
          (currentStatus === "completed" || currentStatus === "diverged")
        ) {
          throw new StoryModuleManagementError(
            "已完成或已偏离的任务属于剧情历史，不能再编辑。",
          );
        }

        const normalizedModule = {
          moduleId: requestedModuleId,
          title: moduleInput.title.trim(),
          objective: moduleInput.objective.trim(),
          completionCriteria: moduleInput.completionCriteria.map((item) => item.trim()),
          activationConditions: (moduleInput.activationConditions ?? []).map((item) =>
            item.trim(),
          ),
          prerequisiteModuleIds: (moduleInput.prerequisiteModuleIds ?? []).map(
            (item) => item.trim(),
          ),
          continuityNotes: moduleInput.continuityNotes?.trim() ?? "",
          autoContinue: moduleInput.autoContinue !== false,
          order:
            input.operation === "create"
              ? modules.reduce(
                  (maximum, item) =>
                    Math.max(
                      maximum,
                      typeof item.state.order === "number" ? item.state.order : -1,
                    ),
                  -1,
                ) + 1
              : typeof currentModule?.state.order === "number"
                ? currentModule.state.order
                : 0,
          status: input.operation === "create" ? "queued" : currentStatus || "queued",
        } satisfies JsonObject;

        const proposedModules = modules.map((item) =>
          readString(item.state.moduleId) === requestedModuleId
            ? normalizedModule
            : item.state,
        );
        if (input.operation === "create") proposedModules.push(normalizedModule);
        this.assertValidStoryModuleGraph(proposedModules);

        mutations.push({
          entityType: "story_module",
          entityId: `story-module:${requestedModuleId}`,
          operation: input.operation === "create" ? "replace" : "merge",
          value: normalizedModule,
          reason:
            input.operation === "create"
              ? "玩家在剧情任务管理中新增了预埋任务"
              : "玩家在剧情任务管理中更新了未完成任务",
          evidence: [],
        });
        if (input.operation === "create") {
          mutations.push({
            entityType: "session_state",
            entityId: "core",
            operation: "merge",
            value: {
              storyMode: "script",
              storyModuleCount: modules.length + 1,
            },
            reason: "把当前剧本切换为包含预埋任务的剧本模式",
            evidence: [],
          });
        } else if (currentStatus === "active") {
          mutations.push({
            entityType: "story_direction",
            entityId: "active",
            operation: "merge",
            value: {
              title: normalizedModule.title,
              content: normalizedModule.objective,
            },
            reason: "同步当前剧情任务修改后的标题与目标",
            evidence: [],
          });
        }
      } else {
        const status = readString(currentModule?.state.status);
        if (status === "active") {
          throw new StoryModuleManagementError(
            "当前进行中的任务不能暂停，请先完成或让剧情自然偏离该目标。",
          );
        }
        if (status === "completed" || status === "diverged") {
          throw new StoryModuleManagementError(
            "已完成或已偏离的任务属于剧情历史，不能更改启用状态。",
          );
        }
        mutations.push({
          entityType: "story_module",
          entityId: currentModule!.entityId,
          operation: input.active ? "activate" : "deactivate",
          ...(input.active ? { value: {} } : {}),
          reason: input.active
            ? "玩家重新启用了预埋剧情任务"
            : "玩家暂停了预埋剧情任务",
          evidence: [],
        });
      }

      this.applyStoryModuleManagementMutations({
        actionId: input.actionId,
        sessionId: input.sessionId,
        branchId: branch.id,
        referenceTurnId: branch.head_turn_id,
        storyModuleId: requestedModuleId,
        mutations,
        now,
      });
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);
      this.database.exec("COMMIT");
      return {
        actionId: input.actionId,
        moduleId: requestedModuleId,
        operation: input.operation,
        reused: false,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  managePlotThread(input: PlotThreadManagementInput): ManagedPlotThreadResult {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(`
          SELECT plot_thread_id FROM plot_thread_management_changes
          WHERE session_id = ? AND action_id = ? ORDER BY ordinal LIMIT 1
        `)
        .get(input.sessionId, input.actionId) as
        | { plot_thread_id: string }
        | undefined;
      if (existing) {
        this.database.exec("COMMIT");
        return {
          actionId: input.actionId,
          threadId: existing.plot_thread_id,
          operation: input.operation,
          reused: true,
        };
      }

      const branch = this.database
        .prepare(`
          SELECT id, head_turn_id
          FROM branches
          WHERE id = (
            SELECT active_branch_id FROM sessions WHERE id = ?
          )
        `)
        .get(input.sessionId) as
        | { id: string; head_turn_id: string | null }
        | undefined;
      if (!branch) throw new PlotThreadManagementError("没有找到当前剧情。");
      if (!branch.head_turn_id) {
        throw new PlotThreadManagementError(
          "剧情尚未建立开场回合，无法管理伏笔。",
        );
      }

      const threadRows = this.database
        .prepare(`
          SELECT entity_id, state_json, is_active
          FROM materialized_states
          WHERE session_id = ? AND branch_id = ?
            AND entity_type = 'plot_thread'
        `)
        .all(input.sessionId, branch.id) as unknown as Array<{
        entity_id: string;
        state_json: string;
        is_active: number;
      }>;
      const threads = threadRows.map((row) => ({
        entityId: row.entity_id,
        state: parseObject(row.state_json),
        isActive: row.is_active === 1,
      }));
      const requestedThreadId =
        input.operation === "create"
          ? input.thread.id.trim()
          : input.threadId.trim();
      requireText(requestedThreadId, "伏笔 ID");
      const currentThread = threads.find(
        (thread) => readString(thread.state.threadId) === requestedThreadId,
      );
      if (input.operation === "create" && currentThread) {
        throw new PlotThreadManagementError("伏笔 ID 已存在，请换一个 ID。");
      }
      if (input.operation !== "create" && !currentThread) {
        throw new PlotThreadManagementError("没有找到指定的伏笔。");
      }

      const mutations: StateMutationInput[] = [];
      if (input.operation === "create" || input.operation === "update") {
        const threadInput = input.thread;
        requireText(threadInput.id, "伏笔 ID");
        requireText(threadInput.seedCondition, "伏笔出现条件");
        requireText(threadInput.payoffCondition, "伏笔回收条件");
        requireText(threadInput.payoffSummary, "伏笔回收概要");
        if (threadInput.id.trim() !== requestedThreadId) {
          throw new PlotThreadManagementError("编辑伏笔时不能修改伏笔 ID。");
        }
        if (threadInput.keywords.length === 0) {
          throw new PlotThreadManagementError("伏笔至少需要一个关键词。");
        }
        if (input.operation === "create" && threads.length >= 30) {
          throw new PlotThreadManagementError("一个剧本最多保存 30 个伏笔。");
        }
        const currentStatus = readString(currentThread?.state.status);
        if (input.operation === "update" && currentStatus === "paid_off") {
          throw new PlotThreadManagementError(
            "已经回收的伏笔属于剧情历史，不能再编辑。",
          );
        }
        const normalizedThread = {
          threadId: requestedThreadId,
          keywords: threadInput.keywords.map((item) => item.trim()),
          seedCondition: threadInput.seedCondition.trim(),
          payoffCondition: threadInput.payoffCondition.trim(),
          payoffSummary: threadInput.payoffSummary.trim(),
          characters: (threadInput.characters ?? []).map((item) => item.trim()),
          status:
            input.operation === "create"
              ? "dormant"
              : currentStatus || "dormant",
        } satisfies JsonObject;
        mutations.push({
          entityType: "plot_thread",
          entityId: `plot-thread:${requestedThreadId}`,
          operation: input.operation === "create" ? "replace" : "merge",
          value: normalizedThread,
          reason:
            input.operation === "create"
              ? "玩家在剧本工作台中新增了伏笔"
              : "玩家在剧本工作台中更新了伏笔",
          evidence: [],
        });
      } else {
        const currentStatus = readString(currentThread?.state.status);
        if (currentStatus === "paid_off") {
          throw new PlotThreadManagementError(
            "已经回收的伏笔属于剧情历史，不能删除。",
          );
        }
        mutations.push({
          entityType: "plot_thread",
          entityId: currentThread!.entityId,
          operation: "deactivate",
          reason: "玩家在剧本工作台中删除了伏笔",
          evidence: [],
        });
      }

      this.applyPlotElementManagementMutations({
        actionId: input.actionId,
        sessionId: input.sessionId,
        branchId: branch.id,
        referenceTurnId: branch.head_turn_id,
        elementId: requestedThreadId,
        table: "plot_thread_management_changes",
        mutations,
        now,
      });
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);
      this.database.exec("COMMIT");
      return {
        actionId: input.actionId,
        threadId: requestedThreadId,
        operation: input.operation,
        reused: false,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  managePlotTrigger(input: PlotTriggerManagementInput): ManagedPlotTriggerResult {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(`
          SELECT plot_trigger_id FROM plot_trigger_management_changes
          WHERE session_id = ? AND action_id = ? ORDER BY ordinal LIMIT 1
        `)
        .get(input.sessionId, input.actionId) as
        | { plot_trigger_id: string }
        | undefined;
      if (existing) {
        this.database.exec("COMMIT");
        return {
          actionId: input.actionId,
          triggerId: existing.plot_trigger_id,
          operation: input.operation,
          reused: true,
        };
      }

      const branch = this.database
        .prepare(`
          SELECT id, head_turn_id
          FROM branches
          WHERE id = (
            SELECT active_branch_id FROM sessions WHERE id = ?
          )
        `)
        .get(input.sessionId) as
        | { id: string; head_turn_id: string | null }
        | undefined;
      if (!branch) throw new PlotTriggerManagementError("没有找到当前剧情。");
      if (!branch.head_turn_id) {
        throw new PlotTriggerManagementError(
          "剧情尚未建立开场回合，无法管理偏离触发器。",
        );
      }

      const triggerRows = this.database
        .prepare(`
          SELECT entity_id, state_json, is_active
          FROM materialized_states
          WHERE session_id = ? AND branch_id = ?
            AND entity_type = 'plot_trigger'
        `)
        .all(input.sessionId, branch.id) as unknown as Array<{
        entity_id: string;
        state_json: string;
        is_active: number;
      }>;
      const triggers = triggerRows.map((row) => ({
        entityId: row.entity_id,
        state: parseObject(row.state_json),
        isActive: row.is_active === 1,
      }));
      const requestedTriggerId =
        input.operation === "create"
          ? input.trigger.id.trim()
          : input.triggerId.trim();
      requireText(requestedTriggerId, "触发器 ID");
      const currentTrigger = triggers.find(
        (trigger) => readString(trigger.state.triggerId) === requestedTriggerId,
      );
      if (input.operation === "create" && currentTrigger) {
        throw new PlotTriggerManagementError("触发器 ID 已存在，请换一个 ID。");
      }
      if (input.operation !== "create" && !currentTrigger) {
        throw new PlotTriggerManagementError("没有找到指定的触发器。");
      }

      const mutations: StateMutationInput[] = [];
      if (input.operation === "create" || input.operation === "update") {
        const triggerInput = input.trigger;
        requireText(triggerInput.id, "触发器 ID");
        requireText(triggerInput.when, "触发器条件");
        requireText(triggerInput.consequence, "触发器后果");
        if (triggerInput.id.trim() !== requestedTriggerId) {
          throw new PlotTriggerManagementError(
            "编辑触发器时不能修改触发器 ID。",
          );
        }
        if (input.operation === "create" && triggers.length >= 30) {
          throw new PlotTriggerManagementError(
            "一个剧本最多保存 30 个偏离触发器。",
          );
        }
        const currentStatus = readString(currentTrigger?.state.status);
        if (input.operation === "update" && currentStatus === "fired") {
          throw new PlotTriggerManagementError(
            "已经触发的触发器属于剧情历史，不能再编辑。",
          );
        }
        const normalizedTrigger = {
          triggerId: requestedTriggerId,
          when: triggerInput.when.trim(),
          consequence: triggerInput.consequence.trim(),
          ...(triggerInput.stateEffects !== undefined
            ? { stateEffects: triggerInput.stateEffects }
            : {}),
          ...(triggerInput.deadlineDay !== undefined
            ? { deadlineDay: triggerInput.deadlineDay }
            : {}),
          status:
            input.operation === "create" ? "armed" : currentStatus || "armed",
        } satisfies JsonObject;
        mutations.push({
          entityType: "plot_trigger",
          entityId: `plot-trigger:${requestedTriggerId}`,
          operation: input.operation === "create" ? "replace" : "merge",
          value: normalizedTrigger,
          reason:
            input.operation === "create"
              ? "玩家在剧本工作台中新增了偏离触发器"
              : "玩家在剧本工作台中更新了偏离触发器",
          evidence: [],
        });
      } else {
        const currentStatus = readString(currentTrigger?.state.status);
        if (currentStatus === "fired") {
          throw new PlotTriggerManagementError(
            "已经触发的触发器属于剧情历史，不能删除。",
          );
        }
        mutations.push({
          entityType: "plot_trigger",
          entityId: currentTrigger!.entityId,
          operation: "deactivate",
          reason: "玩家在剧本工作台中删除了偏离触发器",
          evidence: [],
        });
      }

      this.applyPlotElementManagementMutations({
        actionId: input.actionId,
        sessionId: input.sessionId,
        branchId: branch.id,
        referenceTurnId: branch.head_turn_id,
        elementId: requestedTriggerId,
        table: "plot_trigger_management_changes",
        mutations,
        now,
      });
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);
      this.database.exec("COMMIT");
      return {
        actionId: input.actionId,
        triggerId: requestedTriggerId,
        operation: input.operation,
        reused: false,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadStateAudit(sessionId: string): StateAuditDashboard {
    requireText(sessionId, "sessionId");
    const branch = this.getActiveBranch(sessionId);
    const locks = this.loadStateFieldLocks(sessionId);
    const lockPathsByEntity = new Map<string, Set<string>>();
    for (const lock of locks) {
      const key = `${lock.entityType}:${lock.entityId}`;
      const paths = lockPathsByEntity.get(key) ?? new Set<string>();
      paths.add(lock.fieldPath);
      lockPathsByEntity.set(key, paths);
    }

    const states = new Map<string, StateAuditSnapshot>();
    if (branch.parent_branch_id) {
      const forkSnapshot = this.database
        .prepare(`
          SELECT state_json
          FROM snapshots
          WHERE branch_id = ? AND kind = 'fork'
          ORDER BY sequence ASC
          LIMIT 1
        `)
        .get(branch.id) as { state_json: string } | undefined;
      if (!forkSnapshot) {
        throw new BranchManagementError("分支缺少冻结的起点状态，无法读取审计记录。");
      }
      for (const state of this.decodeSnapshotStates(forkSnapshot.state_json)) {
        states.set(`${state.entityType}:${state.entityId}`, {
          state: structuredClone(state.state),
          isActive: state.isActive,
        });
      }
    }

    const rows = this.database
      .prepare(`
        SELECT state_changes.id AS id, turns.sequence AS sequence,
               0 AS source_order, turns.id AS action_id,
               state_changes.ordinal AS ordinal, 'turn' AS source,
               state_changes.entity_type AS entity_type,
               state_changes.entity_id AS entity_id,
               state_changes.operation AS operation,
               state_changes.payload_json AS payload_json,
               NULL AS result_active,
               state_changes.turn_id AS updated_turn_id,
               state_changes.reason AS reason,
               turns.summary_patch AS summary_patch,
               state_changes.created_at AS created_at
        FROM state_changes
        JOIN turns ON turns.id = state_changes.turn_id
        WHERE state_changes.session_id = ? AND state_changes.branch_id = ?
        UNION ALL
        SELECT character_management_changes.id AS id,
               turns.sequence AS sequence, 1 AS source_order,
               character_management_changes.action_id AS action_id,
               character_management_changes.ordinal AS ordinal,
               'character_management' AS source,
               character_management_changes.entity_type AS entity_type,
               character_management_changes.entity_id AS entity_id,
               character_management_changes.operation AS operation,
               character_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               character_management_changes.reference_turn_id AS updated_turn_id,
               character_management_changes.reason AS reason,
               '' AS summary_patch,
               character_management_changes.created_at AS created_at
        FROM character_management_changes
        JOIN turns ON turns.id = character_management_changes.reference_turn_id
        WHERE character_management_changes.session_id = ?
          AND character_management_changes.branch_id = ?
        UNION ALL
        SELECT location_management_changes.id AS id,
               turns.sequence AS sequence, 1 AS source_order,
               location_management_changes.action_id AS action_id,
               location_management_changes.ordinal AS ordinal,
               'location_management' AS source,
               location_management_changes.entity_type AS entity_type,
               location_management_changes.entity_id AS entity_id,
               location_management_changes.operation AS operation,
               location_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               location_management_changes.reference_turn_id AS updated_turn_id,
               location_management_changes.reason AS reason,
               '' AS summary_patch,
               location_management_changes.created_at AS created_at
        FROM location_management_changes
        JOIN turns ON turns.id = location_management_changes.reference_turn_id
        WHERE location_management_changes.session_id = ?
          AND location_management_changes.branch_id = ?
        UNION ALL
        SELECT story_module_management_changes.id AS id,
               turns.sequence AS sequence, 1 AS source_order,
               story_module_management_changes.action_id AS action_id,
               story_module_management_changes.ordinal AS ordinal,
               'story_module_management' AS source,
               story_module_management_changes.entity_type AS entity_type,
               story_module_management_changes.entity_id AS entity_id,
               story_module_management_changes.operation AS operation,
               story_module_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               story_module_management_changes.reference_turn_id AS updated_turn_id,
               story_module_management_changes.reason AS reason,
               '' AS summary_patch,
               story_module_management_changes.created_at AS created_at
         FROM story_module_management_changes
        JOIN turns ON turns.id = story_module_management_changes.reference_turn_id
        WHERE story_module_management_changes.session_id = ?
          AND story_module_management_changes.branch_id = ?
        UNION ALL
        SELECT plot_thread_management_changes.id AS id,
               turns.sequence AS sequence, 1 AS source_order,
               plot_thread_management_changes.action_id AS action_id,
               plot_thread_management_changes.ordinal AS ordinal,
               'plot_thread_management' AS source,
               plot_thread_management_changes.entity_type AS entity_type,
               plot_thread_management_changes.entity_id AS entity_id,
               plot_thread_management_changes.operation AS operation,
               plot_thread_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               plot_thread_management_changes.reference_turn_id AS updated_turn_id,
               plot_thread_management_changes.reason AS reason,
               '' AS summary_patch,
               plot_thread_management_changes.created_at AS created_at
        FROM plot_thread_management_changes
        JOIN turns ON turns.id = plot_thread_management_changes.reference_turn_id
        WHERE plot_thread_management_changes.session_id = ?
          AND plot_thread_management_changes.branch_id = ?
        UNION ALL
        SELECT plot_trigger_management_changes.id AS id,
               turns.sequence AS sequence, 1 AS source_order,
               plot_trigger_management_changes.action_id AS action_id,
               plot_trigger_management_changes.ordinal AS ordinal,
               'plot_trigger_management' AS source,
               plot_trigger_management_changes.entity_type AS entity_type,
               plot_trigger_management_changes.entity_id AS entity_id,
               plot_trigger_management_changes.operation AS operation,
               plot_trigger_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               plot_trigger_management_changes.reference_turn_id AS updated_turn_id,
               plot_trigger_management_changes.reason AS reason,
               '' AS summary_patch,
               plot_trigger_management_changes.created_at AS created_at
        FROM plot_trigger_management_changes
        JOIN turns ON turns.id = plot_trigger_management_changes.reference_turn_id
        WHERE plot_trigger_management_changes.session_id = ?
          AND plot_trigger_management_changes.branch_id = ?
        UNION ALL
        SELECT world_book_management_changes.id AS id,
               turns.sequence AS sequence, 1 AS source_order,
               world_book_management_changes.action_id AS action_id,
               world_book_management_changes.ordinal AS ordinal,
               'world_book_management' AS source,
               world_book_management_changes.entity_type AS entity_type,
               world_book_management_changes.entity_id AS entity_id,
               world_book_management_changes.operation AS operation,
               world_book_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               world_book_management_changes.reference_turn_id AS updated_turn_id,
               world_book_management_changes.reason AS reason,
               '' AS summary_patch,
               world_book_management_changes.created_at AS created_at
        FROM world_book_management_changes
        JOIN turns ON turns.id = world_book_management_changes.reference_turn_id
        WHERE world_book_management_changes.session_id = ?
          AND world_book_management_changes.branch_id = ?
        UNION ALL
        SELECT state_control_changes.id AS id,
               turns.sequence AS sequence, 2 AS source_order,
               state_control_changes.action_id AS action_id,
               state_control_changes.ordinal AS ordinal,
               'rollback' AS source,
               state_control_changes.entity_type AS entity_type,
               state_control_changes.entity_id AS entity_id,
               state_control_changes.operation AS operation,
               state_control_changes.payload_json AS payload_json,
               state_control_changes.result_active AS result_active,
               state_control_changes.reference_turn_id AS updated_turn_id,
               state_control_changes.reason AS reason,
               '' AS summary_patch,
               state_control_changes.created_at AS created_at
        FROM state_control_changes
        JOIN turns ON turns.id = state_control_changes.reference_turn_id
        WHERE state_control_changes.session_id = ?
          AND state_control_changes.branch_id = ?
        ORDER BY sequence, source_order, created_at, action_id, ordinal
      `)
      .all(
        sessionId,
        branch.id,
        sessionId,
        branch.id,
        sessionId,
        branch.id,
        sessionId,
        branch.id,
        sessionId,
        branch.id,
        sessionId,
        branch.id,
        sessionId,
        branch.id,
        sessionId,
        branch.id,
      ) as unknown as StateAuditMutationRow[];

    const actions: StateAuditAction[] = [];
    const actionByKey = new Map<string, StateAuditAction>();
    for (const row of rows) {
      const entityKey = `${row.entity_type}:${row.entity_id}`;
      const before = states.has(entityKey)
        ? structuredClone(states.get(entityKey)!)
        : null;
      const mutationValue = parseObject(row.payload_json);
      let nextState = before?.state ?? {};
      let isActive = before?.isActive ?? true;
      switch (row.operation) {
        case "replace":
          nextState = structuredClone(mutationValue);
          isActive = true;
          break;
        case "merge":
          nextState = applyStateMergePatch(nextState, mutationValue);
          break;
        case "activate":
          nextState = applyStateMergePatch(nextState, mutationValue);
          isActive = true;
          break;
        case "deactivate":
          isActive = false;
          break;
      }
      if (row.result_active !== null) isActive = row.result_active === 1;
      const after = { state: nextState, isActive };
      states.set(entityKey, structuredClone(after));
      const actionKey = `${row.source}:${row.action_id}`;
      let action = actionByKey.get(actionKey);
      if (!action) {
        const title =
          row.source === "turn"
            ? `回合 ${row.sequence} · ${row.summary_patch || "剧情状态提交"}`
            : row.source === "character_management"
              ? `回合 ${row.sequence} 后 · 人物管理`
              : row.source === "location_management"
                ? `回合 ${row.sequence} 后 · 地点管理`
                : row.source === "story_module_management"
                  ? `回合 ${row.sequence} 后 · 剧情任务管理`
                  : row.source === "plot_thread_management"
                    ? `回合 ${row.sequence} 后 · 伏笔管理`
                    : row.source === "plot_trigger_management"
                      ? `回合 ${row.sequence} 后 · 偏离触发器管理`
                      : row.source === "world_book_management"
                        ? `回合 ${row.sequence} 后 · 世界书管理`
                        : `回合 ${row.sequence} 后 · 状态回滚`;
        action = {
          id: actionKey,
          source: row.source,
          title,
          sequence: row.sequence,
          referenceTurnId: row.updated_turn_id,
          createdAt: row.created_at,
          changes: [],
        };
        actionByKey.set(actionKey, action);
        actions.push(action);
      }
      const lockPaths = lockPathsByEntity.get(entityKey) ?? new Set<string>();
      action.changes.push({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        operation: row.operation,
        reason: row.reason,
        before,
        after: structuredClone(after),
        fields: collectStateDiffs({ before, after, locks: lockPaths }),
        canRollback: !(row.source === "turn" && row.sequence === 1),
      });
    }

    return {
      branchId: branch.id,
      branchName: branch.name,
      actions: actions.reverse(),
      locks,
    };
  }

  manageStateAudit(input: StateAuditControlInput): ManagedStateAuditResult {
    requireText(input.actionId, "actionId");
    requireText(input.sessionId, "sessionId");
    requireText(input.reason, "reason");
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const branch = this.getActiveBranch(input.sessionId);
      if (!branch.head_turn_id) {
        throw new StateAuditManagementError("剧情尚未建立开场回合，无法管理状态。");
      }
      if (input.operation === "set_lock") {
        const reused = this.database
          .prepare(`
            SELECT 1 AS found FROM state_field_lock_changes
            WHERE session_id = ? AND action_id = ?
          `)
          .get(input.sessionId, input.actionId);
        if (reused) {
          this.database.exec("COMMIT");
          return { actionId: input.actionId, operation: input.operation, reused: true };
        }
        const target = this.database
          .prepare(`
            SELECT 1 AS found FROM materialized_states
            WHERE session_id = ? AND branch_id = ?
              AND entity_type = ? AND entity_id = ?
          `)
          .get(input.sessionId, branch.id, input.entityType, input.entityId);
        if (!target) throw new StoryNotFoundError("没有找到要锁定的状态实体。");
        const revision = (
          this.database
            .prepare(`
              SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision
              FROM state_field_lock_changes
              WHERE session_id = ? AND entity_type = ?
                AND entity_id = ? AND field_path = ?
            `)
            .get(
              input.sessionId,
              input.entityType,
              input.entityId,
              input.fieldPath,
            ) as { next_revision: number }
        ).next_revision;
        this.database
          .prepare(`
            INSERT INTO state_field_lock_changes (
              id, action_id, session_id, entity_type, entity_id,
              field_path, revision, locked, reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            randomUUID(),
            input.actionId,
            input.sessionId,
            input.entityType,
            input.entityId,
            input.fieldPath,
            revision,
            input.locked ? 1 : 0,
            input.reason,
            now,
          );
      } else {
        const reused = this.database
          .prepare(`
            SELECT 1 AS found FROM state_control_changes
            WHERE session_id = ? AND action_id = ?
          `)
          .get(input.sessionId, input.actionId);
        if (reused) {
          this.database.exec("COMMIT");
          return { actionId: input.actionId, operation: input.operation, reused: true };
        }
        const audit = this.loadStateAudit(input.sessionId);
        const selected = audit.actions
          .flatMap((action) => action.changes)
          .find((change) => change.id === input.changeId);
        if (!selected) throw new StoryNotFoundError("没有找到要回滚的状态变化。");
        if (!selected.canRollback) {
          throw new StateAuditManagementError("开局建档属于剧本基础资料，不能从这里回滚。");
        }
        const targetState = selected.before?.state ?? {};
        const targetActive = selected.before?.isActive ?? false;
        const current = this.database
          .prepare(`
            SELECT state_json, is_active, version
            FROM materialized_states
            WHERE session_id = ? AND branch_id = ?
              AND entity_type = ? AND entity_id = ?
          `)
          .get(input.sessionId, branch.id, selected.entityType, selected.entityId) as
          | { state_json: string; is_active: number; version: number }
          | undefined;
        this.database
          .prepare(`
            INSERT INTO state_control_changes (
              id, action_id, session_id, branch_id, reference_turn_id,
              ordinal, source_change_id, entity_type, entity_id,
              operation, payload_json, result_active, reason, created_at
            ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'replace', ?, ?, ?, ?)
          `)
          .run(
            randomUUID(),
            input.actionId,
            input.sessionId,
            branch.id,
            branch.head_turn_id,
            input.changeId,
            selected.entityType,
            selected.entityId,
            stringifyJson(targetState),
            targetActive ? 1 : 0,
            input.reason,
            now,
          );
        this.database
          .prepare(`
            INSERT INTO materialized_states (
              session_id, branch_id, entity_type, entity_id,
              state_json, is_active, version, updated_turn_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id, branch_id, entity_type, entity_id)
            DO UPDATE SET
              state_json = excluded.state_json,
              is_active = excluded.is_active,
              version = excluded.version,
              updated_turn_id = excluded.updated_turn_id,
              updated_at = excluded.updated_at
          `)
          .run(
            input.sessionId,
            branch.id,
            selected.entityType,
            selected.entityId,
            stringifyJson(targetState),
            targetActive ? 1 : 0,
            (current?.version ?? 0) + 1,
            branch.head_turn_id,
            now,
          );
      }
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);
      this.database.exec("COMMIT");
      return { actionId: input.actionId, operation: input.operation, reused: false };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private loadStateFieldLocks(sessionId: string): StateFieldLock[] {
    const rows = this.database
      .prepare(`
        SELECT entity_type, entity_id, field_path, locked, reason, created_at
        FROM state_field_lock_changes
        WHERE session_id = ?
        ORDER BY entity_type, entity_id, field_path, revision
      `)
      .all(sessionId) as unknown as Array<{
      entity_type: StateEntityType;
      entity_id: string;
      field_path: string;
      locked: number;
      reason: string;
      created_at: string;
    }>;
    const latest = new Map<string, StateFieldLock & { locked: boolean }>();
    for (const row of rows) {
      latest.set(`${row.entity_type}:${row.entity_id}:${row.field_path}`, {
        entityType: row.entity_type,
        entityId: row.entity_id,
        fieldPath: row.field_path,
        reason: row.reason,
        createdAt: row.created_at,
        locked: row.locked === 1,
      });
    }
    return [...latest.values()]
      .filter((lock) => lock.locked)
      .map((lock) => ({
        entityType: lock.entityType,
        entityId: lock.entityId,
        fieldPath: lock.fieldPath,
        reason: lock.reason,
        createdAt: lock.createdAt,
      }))
      .sort((left, right) =>
        `${left.entityType}:${left.entityId}:${left.fieldPath}`.localeCompare(
          `${right.entityType}:${right.entityId}:${right.fieldPath}`,
          "zh-CN",
        ),
      );
  }

  createCampaign(input: { name: string; description?: string }) {
    requireText(input.name, "战役名称");
    const id = randomUUID();
    const now = new Date().toISOString();

    this.database
      .prepare(`
        INSERT INTO campaigns (id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(id, input.name.trim(), input.description?.trim() ?? "", now, now);

    return { campaignId: id };
  }

  createSession(input: { campaignId: string; name: string }) {
    requireText(input.campaignId, "campaignId");
    requireText(input.name, "会话名称");
    const sessionId = randomUUID();
    const branchId = randomUUID();
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO sessions (
            id, campaign_id, name, status, active_branch_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'active', ?, ?, ?)
        `)
        .run(sessionId, input.campaignId, input.name.trim(), branchId, now, now);

      this.database
        .prepare(`
          INSERT INTO branches (
            id, session_id, name, next_sequence, created_at, updated_at
          ) VALUES (?, ?, '主线', 1, ?, ?)
        `)
        .run(branchId, sessionId, now, now);

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return { sessionId, branchId };
  }

  findCommittedTurnByIdempotency(
    sessionId: string,
    idempotencyKey: string,
  ): CommittedTurn | null {
    requireText(sessionId, "sessionId");
    requireText(idempotencyKey, "idempotencyKey");
    const existing = this.database
      .prepare(`
        SELECT id, branch_id, parent_turn_id, sequence, created_at
        FROM turns
        WHERE session_id = ? AND idempotency_key = ?
      `)
      .get(sessionId, idempotencyKey) as TurnRow | undefined;

    return existing
      ? {
          id: existing.id,
          branchId: existing.branch_id,
          parentTurnId: existing.parent_turn_id,
          sequence: existing.sequence,
          createdAt: existing.created_at,
          reused: true,
        }
      : null;
  }

  findCompletedTurnRegeneration(
    sessionId: string,
    actionId: string,
  ): ReplacedTurn | null {
    requireText(sessionId, "sessionId");
    requireText(actionId, "actionId");
    const row = this.database
      .prepare(`
        SELECT turns.id, turns.branch_id, turns.parent_turn_id,
               turns.sequence, turns.created_at, turn_regenerations.ordinal
        FROM turn_regenerations
        JOIN turns ON turns.id = turn_regenerations.turn_id
        WHERE turn_regenerations.session_id = ?
          AND turn_regenerations.action_id = ?
      `)
      .get(sessionId, actionId) as
      | (TurnRow & { ordinal: number })
      | undefined;
    return row
      ? {
          id: row.id,
          branchId: row.branch_id,
          parentTurnId: row.parent_turn_id,
          sequence: row.sequence,
          createdAt: row.created_at,
          reused: true,
          regenerationCount: row.ordinal,
        }
      : null;
  }

  savePendingTurn(input: SavePendingTurnInput): PendingTurnRecord {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO pending_turns (
            id, session_id, branch_id, kind, expected_head_turn_id,
            expected_parent_turn_id, idempotency_key, feedback,
            expected_regeneration_count, player_input_json,
            generated_output_json, summary_patch, context_snapshot_json,
            memory_context_json, state_mutations_json, messages_json,
            events_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, idempotency_key) DO UPDATE SET
            id = excluded.id,
            branch_id = excluded.branch_id,
            kind = excluded.kind,
            expected_head_turn_id = excluded.expected_head_turn_id,
            expected_parent_turn_id = excluded.expected_parent_turn_id,
            feedback = excluded.feedback,
            expected_regeneration_count = excluded.expected_regeneration_count,
            player_input_json = excluded.player_input_json,
            generated_output_json = excluded.generated_output_json,
            summary_patch = excluded.summary_patch,
            context_snapshot_json = excluded.context_snapshot_json,
            memory_context_json = excluded.memory_context_json,
            state_mutations_json = excluded.state_mutations_json,
            messages_json = excluded.messages_json,
            events_json = excluded.events_json,
            created_at = excluded.created_at
        `)
        .run(
          input.id,
          input.sessionId,
          input.branchId,
          input.kind,
          input.expectedHeadTurnId,
          input.expectedParentTurnId,
          input.idempotencyKey,
          input.feedback,
          input.expectedRegenerationCount,
          stringifyJson(input.playerInput),
          stringifyJson(input.generatedOutput),
          input.summaryPatch,
          stringifyJson(input.contextSnapshot as unknown as JsonValue),
          stringifyJson(input.memoryContext as unknown as JsonValue),
          stringifyJson(input.stateMutations as unknown as JsonValue),
          stringifyJson(input.messages as unknown as JsonValue),
          stringifyJson(input.events as unknown as JsonValue),
          now,
        );
      this.database.exec("COMMIT");
      return this.decodePendingTurnRow({
        id: input.id,
        session_id: input.sessionId,
        branch_id: input.branchId,
        kind: input.kind,
        expected_head_turn_id: input.expectedHeadTurnId,
        expected_parent_turn_id: input.expectedParentTurnId,
        idempotency_key: input.idempotencyKey,
        feedback: input.feedback,
        expected_regeneration_count: input.expectedRegenerationCount,
        player_input_json: stringifyJson(input.playerInput),
        generated_output_json: stringifyJson(input.generatedOutput),
        summary_patch: input.summaryPatch,
        context_snapshot_json: stringifyJson(
          input.contextSnapshot as unknown as JsonValue,
        ),
        memory_context_json: stringifyJson(
          input.memoryContext as unknown as JsonValue,
        ),
        state_mutations_json: stringifyJson(
          input.stateMutations as unknown as JsonValue,
        ),
        messages_json: stringifyJson(input.messages as unknown as JsonValue),
        events_json: stringifyJson(input.events as unknown as JsonValue),
        created_at: now,
      });
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadPendingTurnById(sessionId: string, pendingTurnId: string) {
    const row = this.database
      .prepare(`
        SELECT id, session_id, branch_id, kind, expected_head_turn_id,
               expected_parent_turn_id, idempotency_key, feedback,
               expected_regeneration_count, player_input_json,
               generated_output_json, summary_patch, context_snapshot_json,
               memory_context_json, state_mutations_json, messages_json,
               events_json, created_at
        FROM pending_turns
        WHERE id = ? AND session_id = ?
      `)
      .get(pendingTurnId, sessionId) as PendingTurnRow | undefined;
    return row ? this.decodePendingTurnRow(row) : null;
  }

  loadPendingTurnByKey(sessionId: string, idempotencyKey: string) {
    const row = this.database
      .prepare(`
        SELECT id, session_id, branch_id, kind, expected_head_turn_id,
               expected_parent_turn_id, idempotency_key, feedback,
               expected_regeneration_count, player_input_json,
               generated_output_json, summary_patch, context_snapshot_json,
               memory_context_json, state_mutations_json, messages_json,
               events_json, created_at
        FROM pending_turns
        WHERE session_id = ? AND idempotency_key = ?
      `)
      .get(sessionId, idempotencyKey) as PendingTurnRow | undefined;
    return row ? this.decodePendingTurnRow(row) : null;
  }

  deletePendingTurn(pendingTurnId: string) {
    this.database
      .prepare("DELETE FROM pending_turns WHERE id = ?")
      .run(pendingTurnId);
  }

  private decodePendingTurnRow(row: PendingTurnRow): PendingTurnRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      branchId: row.branch_id,
      kind: row.kind === "regenerate" ? "regenerate" : "advance",
      expectedHeadTurnId: row.expected_head_turn_id,
      expectedParentTurnId: row.expected_parent_turn_id,
      idempotencyKey: row.idempotency_key,
      feedback: row.feedback,
      expectedRegenerationCount: row.expected_regeneration_count,
      playerInput: parseObject(row.player_input_json),
      generatedOutput: parseObject(row.generated_output_json),
      summaryPatch: row.summary_patch,
      contextSnapshot: parseObject(row.context_snapshot_json),
      memoryContext: parseObject(row.memory_context_json),
      stateMutations: parseArrayValue(row.state_mutations_json) as unknown as StateMutationInput[],
      messages: parseArrayValue(row.messages_json) as unknown as TurnMessageInput[],
      events: parseArrayValue(row.events_json) as unknown as TurnEventInput[],
      createdAt: row.created_at,
    };
  }

  resolvePendingTurnChecks(
    input: ResolvePendingTurnChecksInput,
  ): ResolvedTurnBackfill {
    requireText(input.sessionId, "sessionId");
    requireText(input.pendingTurnId, "pendingTurnId");
    requireText(input.expectedHeadTurnId, "expectedHeadTurnId");

    const adventure = this.loadAdventure(input.sessionId);
    if (adventure.branchState.branch.headTurnId !== input.expectedHeadTurnId) {
      throw new BranchHeadConflictError(
        input.expectedHeadTurnId,
        adventure.branchState.branch.headTurnId,
      );
    }

    if (adventure.branchState.branch.headTurnId === input.pendingTurnId) {
      const committed = this.loadTurn(
        adventure.branchState.branch.id,
        input.pendingTurnId,
      );
      const recorded = readAttributeCheckResults(committed.generatedOutput);
      if (recorded.length > 0) {
        return {
          committedTurn: {
            id: committed.id,
            branchId: committed.branchId,
            parentTurnId: committed.parentTurnId,
            sequence: committed.sequence,
            createdAt: committed.createdAt,
            reused: true,
          },
          resolutions: recorded,
        };
      }
      throw new StoryNotFoundError("没有找到待确认的属性判定回合。");
    }

    const pending = this.loadPendingTurnById(
      input.sessionId,
      input.pendingTurnId,
    );
    if (!pending) {
      throw new StoryNotFoundError("没有找到待确认的属性判定回合。");
    }

    const checks = readAttributeChecks(pending.generatedOutput);
    if (checks.length === 0) {
      throw new AttributeCheckResolutionError("该回合不包含属性判定。");
    }
    const knownCheckIds = new Set(checks.map((check) => check.id));
    const rollByCheckId = new Map<string, number | null>();
    for (const result of input.results) {
      if (!knownCheckIds.has(result.checkId)) {
        throw new AttributeCheckResolutionError(
          `未知的属性判定 ${result.checkId}。`,
        );
      }
      if (result.roll !== null && !isValidAttributeRoll(result.roll)) {
        throw new AttributeCheckResolutionError(
          `属性判定 ${result.checkId} 的骰子点数必须是 1 到 100 之间的整数。`,
        );
      }
      rollByCheckId.set(result.checkId, result.roll);
    }

    const attributeValues: Record<string, Record<string, number>> = {};
    for (const state of adventure.branchState.states) {
      if (state.entityType !== "character_state") continue;
      const attributes = readObject(state.state.attributes);
      const values: Record<string, number> = {};
      for (const [attribute, value] of Object.entries(attributes)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          values[attribute] = value;
        }
      }
      attributeValues[state.entityId] = values;
    }
    const resolutions = resolveAttributeChecks({
      requests: checks as unknown as AttributeCheckRequest[],
      attributeValues,
      rolls: rollByCheckId,
      skipUnrolled: true,
    });

    const characterNameById = new Map(
      adventure.branchState.states
        .filter((state) => state.entityType === "character_state")
        .map((state) => [
          state.entityId,
          readString(state.state.name) || readString(state.state.role),
        ]),
    );
    const resultMessages: TurnMessageInput[] = [];
    const checkMutations: StateMutationInput[] = [];
    const checkResultEvents: TurnEventInput[] = [];
    for (const resolution of resolutions) {
      if (resolution.outcome === "skipped") continue;
      const characterName =
        characterNameById.get(resolution.characterId) ?? resolution.characterId;
      const rollText =
        resolution.direct && resolution.roll === null
          ? "实力悬殊，直接判定"
          : `掷出 ${resolution.roll}，最终 ${resolution.finalValue}`;
      const summary =
        `属性判定：${resolution.context || "关键行动"}（${resolution.attribute} ${resolution.attributeValue} vs 难度 ${resolution.difficulty}，${rollText}）→ ${resolution.outcomeLabel}。`;
      resultMessages.push({
        role: "narrator",
        content: summary,
        metadata: { attributeCheck: resolution.checkId },
      });
      checkMutations.push({
        entityType: "plot_check",
        entityId: `plot-check:${pending.id}:${resolution.checkId}`,
        operation: "replace",
        value: {
          checkId: resolution.checkId,
          characterId: resolution.characterId,
          attribute: resolution.attribute,
          difficulty: resolution.difficulty,
          context: resolution.context,
          attributeValue: resolution.attributeValue,
          margin: resolution.margin,
          direct: resolution.direct,
          roll: resolution.roll,
          finalValue: resolution.finalValue,
          outcome: resolution.outcome,
          outcomeLabel: resolution.outcomeLabel,
          turnId: pending.id,
        },
        reason: `${characterName}的属性判定结算`,
        evidence: [`attribute-check:${resolution.checkId}`],
      });
      checkResultEvents.push({
        id: `attribute-check:${resolution.checkId}`,
        eventType: "attribute_check",
        summary: `${characterName}进行了属性判定：${resolution.attribute} ${resolution.attributeValue} vs 难度 ${resolution.difficulty} → ${resolution.outcomeLabel}。`,
        characterIds: [resolution.characterId],
        payload: {
          checkId: resolution.checkId,
          attribute: resolution.attribute,
          difficulty: resolution.difficulty,
          attributeValue: resolution.attributeValue,
          roll: resolution.roll,
          finalValue: resolution.finalValue,
          outcome: resolution.outcome,
          direct: resolution.direct,
        },
      });
    }

    const finalOutput = structuredClone(pending.generatedOutput) as JsonObject;
    const draftTurn = readObject(finalOutput.turn);
    const existingTurnEvents = Array.isArray(draftTurn.events)
      ? draftTurn.events
      : [];
    const resolvedTurnEvents: JsonValue[] = [
      ...existingTurnEvents,
      ...resolutions
        .filter((resolution) => resolution.outcome !== "skipped")
        .map((resolution) => ({
          id: `attribute-check:${resolution.checkId}`,
          type: "attribute_check",
          summary: `${characterNameById.get(resolution.characterId) ?? resolution.characterId}进行了属性判定：${resolution.attribute} ${resolution.attributeValue} vs 难度 ${resolution.difficulty} → ${resolution.outcomeLabel}。`,
          characterIds: [resolution.characterId],
        })),
    ];
    draftTurn.events = resolvedTurnEvents;
    finalOutput.turn = draftTurn;
    finalOutput.attributeCheckResults = resolutions.map((resolution) => ({
      checkId: resolution.checkId,
      characterId: resolution.characterId,
      attribute: resolution.attribute,
      difficulty: resolution.difficulty,
      context: resolution.context,
      attributeValue: resolution.attributeValue,
      margin: resolution.margin,
      direct: resolution.direct,
      roll: resolution.roll,
      finalValue: resolution.finalValue,
      outcome: resolution.outcome,
      outcomeLabel: resolution.outcomeLabel,
    }));

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.database
        .prepare(`
          UPDATE pending_turns
          SET generated_output_json = ?
          WHERE id = ? AND session_id = ?
        `)
        .run(stringifyJson(finalOutput), input.pendingTurnId, input.sessionId);
      if (updated.changes !== 1) {
        throw new StoryNotFoundError("没有找到待确认的属性判定回合。");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    const committed =
      pending.kind === "advance"
        ? this.commitTurn({
            id: pending.id,
            sessionId: input.sessionId,
            branchId: pending.branchId,
            expectedHeadTurnId: pending.expectedHeadTurnId,
            idempotencyKey: pending.idempotencyKey,
            playerInput: pending.playerInput,
            generatedOutput: finalOutput,
            summaryPatch: pending.summaryPatch,
            messages: [...pending.messages, ...resultMessages],
            events: [...pending.events, ...checkResultEvents],
            stateMutations: [...pending.stateMutations, ...checkMutations],
            memoryContext: pending.memoryContext as unknown as StoryMemoryContext,
            contextSnapshot:
              pending.contextSnapshot as unknown as TurnContextSnapshotInput,
          })
        : this.replaceHeadTurn({
            actionId: pending.idempotencyKey,
            feedback: pending.feedback,
            expectedRegenerationCount: pending.expectedRegenerationCount,
            turnId: pending.id,
            sessionId: input.sessionId,
            branchId: pending.branchId,
            expectedParentTurnId: pending.expectedParentTurnId ?? "",
            generatedOutput: finalOutput,
            summaryPatch: pending.summaryPatch,
            messages: [...pending.messages, ...resultMessages],
            events: [...pending.events, ...checkResultEvents],
            stateMutations: [...pending.stateMutations, ...checkMutations],
            memoryContext: pending.memoryContext as unknown as StoryMemoryContext,
            contextSnapshot:
              pending.contextSnapshot as unknown as TurnContextSnapshotInput,
          });
    this.deletePendingTurn(pending.id);
    return {
      committedTurn: committed,
      resolutions,
    };
  }

  prepareTurnRegeneration(
    sessionId: string,
    expectedHeadTurnId: string,
  ): PreparedTurnRegeneration {
    requireText(sessionId, "sessionId");
    requireText(expectedHeadTurnId, "expectedHeadTurnId");
    const adventure = this.loadAdventure(sessionId);
    if (adventure.branchState.branch.headTurnId !== expectedHeadTurnId) {
      throw new BranchHeadConflictError(
        expectedHeadTurnId,
        adventure.branchState.branch.headTurnId,
      );
    }
    const currentTurn = this.loadTurn(
      adventure.branchState.branch.id,
      expectedHeadTurnId,
    );
    if (currentTurn.branchId !== adventure.branchState.branch.id) {
      throw new TurnRegenerationError(
        "当前回合是从父分支继承的分支起点，不能在子分支中替换。请切回原分支重新生成，或从更早回合建立新分支。",
      );
    }
    if (!currentTurn.parentTurnId || !currentTurn.generation) {
      throw new TurnRegenerationError("开场回合不是 AI 生成内容，不能重新生成。");
    }
    this.assertNoManagementAfterTurn(
      sessionId,
      adventure.branchState.branch.id,
      expectedHeadTurnId,
    );
    const parent = this.loadVisibleTurnRows(
      adventure.branchState.branch.id,
    ).find((turn) => turn.id === currentTurn.parentTurnId);
    if (!parent) throw new StoryNotFoundError("没有找到上一剧情回合。");

    const regenerationCount = (
      this.database
        .prepare(
          "SELECT COUNT(*) AS total FROM turn_regenerations WHERE turn_id = ?",
        )
        .get(expectedHeadTurnId) as { total: number }
    ).total;
    const states = this.reconstructStatesThroughSequence({
      sessionId,
      branchId: adventure.branchState.branch.id,
      sequence: parent.sequence,
    }).map((state) => ({
      entityType: state.entityType,
      entityId: state.entityId,
      state: state.state,
      isActive: state.isActive,
      version: state.version,
      updatedTurnId: state.updatedTurnId,
    }));
    const adventureBeforeTurn: LoadedAdventure = {
      ...adventure,
      branchState: {
        ...adventure.branchState,
        branch: {
          ...adventure.branchState.branch,
          headTurnId: currentTurn.parentTurnId,
          nextSequence: currentTurn.sequence,
        },
        states,
        recentTurns: adventure.branchState.recentTurns.filter(
          (turn) => turn.sequence < currentTurn.sequence,
        ),
        turnHistory: adventure.branchState.turnHistory.filter(
          (turn) => turn.sequence < currentTurn.sequence,
        ),
      },
    };
    return {
      adventureBeforeTurn,
      currentTurn,
      regenerationCount,
    };
  }

  replaceHeadTurn(input: ReplaceHeadTurnInput): ReplacedTurn {
    validateCommitInput({
      sessionId: input.sessionId,
      branchId: input.branchId,
      expectedHeadTurnId: input.expectedParentTurnId,
      playerInput: {},
      generatedOutput: input.generatedOutput,
      messages: input.messages,
      events: input.events,
      stateMutations: input.stateMutations,
    });
    requireText(input.actionId, "actionId");
    requireText(input.turnId, "turnId");
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const reused = this.database
        .prepare(`
          SELECT turns.id, turns.branch_id, turns.parent_turn_id,
                 turns.sequence, turns.created_at, turn_regenerations.ordinal
          FROM turn_regenerations
          JOIN turns ON turns.id = turn_regenerations.turn_id
          WHERE turn_regenerations.session_id = ?
            AND turn_regenerations.action_id = ?
        `)
        .get(input.sessionId, input.actionId) as
        | (TurnRow & { ordinal: number })
        | undefined;
      if (reused) {
        this.database.exec("COMMIT");
        return {
          id: reused.id,
          branchId: reused.branch_id,
          parentTurnId: reused.parent_turn_id,
          sequence: reused.sequence,
          createdAt: reused.created_at,
          reused: true,
          regenerationCount: reused.ordinal,
        };
      }

      const branch = this.database
        .prepare(`
          SELECT id, session_id, head_turn_id, next_sequence
          FROM branches
          WHERE id = ?
        `)
        .get(input.branchId) as BranchRow | undefined;
      if (!branch || branch.session_id !== input.sessionId) {
        throw new StoryNotFoundError("没有找到指定的剧情分支。");
      }
      if (branch.head_turn_id !== input.turnId) {
        throw new BranchHeadConflictError(input.turnId, branch.head_turn_id);
      }
      const current = this.database
        .prepare(`
          SELECT id, branch_id, parent_turn_id, sequence, player_input_json,
                 generated_output_json, summary_patch, created_at
          FROM turns
          WHERE id = ? AND branch_id = ? AND session_id = ?
        `)
        .get(input.turnId, input.branchId, input.sessionId) as
        | TurnRow
        | undefined;
      if (!current || current.parent_turn_id !== input.expectedParentTurnId) {
        throw new TurnRegenerationConflictError();
      }
      this.assertNoManagementAfterTurn(
        input.sessionId,
        input.branchId,
        input.turnId,
      );
      const regenerationCount = (
        this.database
          .prepare(
            "SELECT COUNT(*) AS total FROM turn_regenerations WHERE turn_id = ?",
          )
          .get(input.turnId) as { total: number }
      ).total;
      if (regenerationCount !== input.expectedRegenerationCount) {
        throw new TurnRegenerationConflictError();
      }
      const parent = this.loadVisibleTurnRows(input.branchId).find(
        (turn) => turn.id === input.expectedParentTurnId,
      );
      if (!parent) throw new StoryNotFoundError("没有找到上一剧情回合。");
      const reconstructedStates = this.reconstructStatesThroughSequence({
        sessionId: input.sessionId,
        branchId: input.branchId,
        sequence: parent.sequence,
      });

      this.database
        .prepare(
          "DELETE FROM materialized_states WHERE session_id = ? AND branch_id = ?",
        )
        .run(input.sessionId, input.branchId);
      const insertMaterialized = this.database.prepare(`
        INSERT INTO materialized_states (
          session_id, branch_id, entity_type, entity_id, state_json,
          is_active, version, updated_turn_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const state of reconstructedStates) {
        insertMaterialized.run(
          input.sessionId,
          input.branchId,
          state.entityType,
          state.entityId,
          stringifyJson(state.state),
          state.isActive ? 1 : 0,
          state.version,
          state.updatedTurnId,
          state.updatedAt,
        );
      }

      this.database.prepare("DELETE FROM messages WHERE turn_id = ?").run(input.turnId);
      this.database.prepare("DELETE FROM events WHERE turn_id = ?").run(input.turnId);
      this.database.prepare("DELETE FROM state_changes WHERE turn_id = ?").run(input.turnId);
      this.database.prepare("DELETE FROM state_lock_blocks WHERE turn_id = ?").run(input.turnId);
      this.database
        .prepare(`
          UPDATE turns
          SET generated_output_json = ?, summary_patch = ?, status = 'committed'
          WHERE id = ?
        `)
        .run(
          stringifyJson(input.generatedOutput),
          input.summaryPatch ?? "",
          input.turnId,
        );

      const insertMessage = this.database.prepare(`
        INSERT INTO messages (
          id, turn_id, ordinal, role, speaker_id, content,
          metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [ordinal, message] of (input.messages ?? []).entries()) {
        insertMessage.run(
          message.id ?? randomUUID(),
          input.turnId,
          ordinal,
          message.role,
          message.speakerId ?? null,
          message.content,
          stringifyJson(message.metadata ?? {}),
          now,
        );
      }
      const insertEvent = this.database.prepare(`
        INSERT INTO events (
          id, turn_id, event_type, summary, location_id,
          character_ids_json, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const event of input.events ?? []) {
        insertEvent.run(
          event.id ?? randomUUID(),
          input.turnId,
          event.eventType,
          event.summary,
          event.locationId ?? null,
          stringifyJson(event.characterIds ?? []),
          stringifyJson(event.payload ?? {}),
          now,
        );
      }
      this.applyStateMutations({
        sessionId: input.sessionId,
        branchId: input.branchId,
        turnId: input.turnId,
        mutations: input.stateMutations ?? [],
        now,
      });
      this.synchronizeStoryMemory(input.sessionId, input.branchId);
      if (input.memoryContext) {
        recordStoryMemoryRetrieval({
          database: this.database,
          sessionId: input.sessionId,
          branchId: input.branchId,
          turnId: input.turnId,
          context: input.memoryContext,
        });
      }
      if (input.contextSnapshot) {
        this.writeTurnContextSnapshot({
          turnId: input.turnId,
          sessionId: input.sessionId,
          branchId: input.branchId,
          snapshot: input.contextSnapshot,
          now,
        });
      }
      if (current.sequence % 5 === 0) {
        this.writeSnapshot({
          sessionId: input.sessionId,
          branchId: input.branchId,
          turnId: input.turnId,
          sequence: current.sequence,
          name: `自动存档 · 回合 ${current.sequence}`,
          kind: "automatic",
          now,
        });
      }

      const ordinal = regenerationCount + 1;
      this.database
        .prepare(`
          INSERT INTO turn_regenerations (
            id, action_id, session_id, branch_id, turn_id, ordinal,
            previous_turn_json, replacement_turn_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          input.actionId,
          input.sessionId,
          input.branchId,
          input.turnId,
          ordinal,
          stringifyJson({
            generatedOutput: current.generated_output_json
              ? parseObject(current.generated_output_json)
              : {},
            summaryPatch: current.summary_patch ?? "",
          }),
          stringifyJson({
            generatedOutput: input.generatedOutput,
            summaryPatch: input.summaryPatch ?? "",
            feedback: input.feedback,
          }),
          now,
        );
      this.database
        .prepare("UPDATE branches SET updated_at = ? WHERE id = ?")
        .run(now, input.branchId);
      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);
      this.database.exec("COMMIT");
      return {
        id: input.turnId,
        branchId: input.branchId,
        parentTurnId: input.expectedParentTurnId,
        sequence: current.sequence,
        createdAt: current.created_at,
        reused: false,
        regenerationCount: ordinal,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  commitTurn(input: CommitTurnInput): CommittedTurn {
    validateCommitInput(input);
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (input.idempotencyKey) {
        const existing = this.database
          .prepare(`
            SELECT id, branch_id, parent_turn_id, sequence, created_at
            FROM turns
            WHERE session_id = ? AND idempotency_key = ?
          `)
          .get(input.sessionId, input.idempotencyKey) as
          | (TurnRow & { branch_id: string })
          | undefined;

        if (existing) {
          if (existing.branch_id !== input.branchId) {
            throw new Error("同一幂等键不能用于不同剧情分支。");
          }
          this.database.exec("COMMIT");
          return {
            id: existing.id,
            branchId: existing.branch_id,
            parentTurnId: existing.parent_turn_id,
            sequence: existing.sequence,
            createdAt: existing.created_at,
            reused: true,
          };
        }
      }

      const branch = this.database
        .prepare(`
          SELECT id, session_id, head_turn_id, next_sequence
          FROM branches
          WHERE id = ?
        `)
        .get(input.branchId) as BranchRow | undefined;

      if (!branch || branch.session_id !== input.sessionId) {
        throw new Error("没有找到指定的剧情分支。");
      }
      if (branch.head_turn_id !== input.expectedHeadTurnId) {
        throw new BranchHeadConflictError(
          input.expectedHeadTurnId,
          branch.head_turn_id,
        );
      }

      const turnId = input.id ?? randomUUID();
      const sequence = branch.next_sequence;

      this.database
        .prepare(`
          INSERT INTO turns (
            id, session_id, branch_id, parent_turn_id, sequence,
            idempotency_key, player_input_json, generated_output_json,
            summary_patch, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?)
        `)
        .run(
          turnId,
          input.sessionId,
          input.branchId,
          branch.head_turn_id,
          sequence,
          input.idempotencyKey ?? null,
          stringifyJson(input.playerInput),
          stringifyJson(input.generatedOutput),
          input.summaryPatch ?? "",
          now,
        );

      const insertMessage = this.database.prepare(`
        INSERT INTO messages (
          id, turn_id, ordinal, role, speaker_id, content,
          metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [ordinal, message] of (input.messages ?? []).entries()) {
        insertMessage.run(
          message.id ?? randomUUID(),
          turnId,
          ordinal,
          message.role,
          message.speakerId ?? null,
          message.content,
          stringifyJson(message.metadata ?? {}),
          now,
        );
      }

      const insertEvent = this.database.prepare(`
        INSERT INTO events (
          id, turn_id, event_type, summary, location_id,
          character_ids_json, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const event of input.events ?? []) {
        insertEvent.run(
          event.id ?? randomUUID(),
          turnId,
          event.eventType,
          event.summary,
          event.locationId ?? null,
          stringifyJson(event.characterIds ?? []),
          stringifyJson(event.payload ?? {}),
          now,
        );
      }

      this.applyStateMutations({
        sessionId: input.sessionId,
        branchId: input.branchId,
        turnId,
        mutations: input.stateMutations ?? [],
        now,
      });

      const updateResult = this.database
        .prepare(`
          UPDATE branches
          SET head_turn_id = ?, next_sequence = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(turnId, sequence + 1, now, input.branchId);

      if (updateResult.changes !== 1) {
        throw new Error("更新剧情分支位置失败。");
      }

      if (sequence % 5 === 0) {
        this.writeSnapshot({
          sessionId: input.sessionId,
          branchId: input.branchId,
          turnId,
          sequence,
          name: `自动存档 · 回合 ${sequence}`,
          kind: "automatic",
          now,
        });
      }

      this.database
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(now, input.sessionId);

      this.synchronizeStoryMemory(input.sessionId, input.branchId);
      if (input.memoryContext) {
        recordStoryMemoryRetrieval({
          database: this.database,
          sessionId: input.sessionId,
          branchId: input.branchId,
          turnId,
          context: input.memoryContext,
        });
      }
      if (input.contextSnapshot) {
        this.writeTurnContextSnapshot({
          turnId,
          sessionId: input.sessionId,
          branchId: input.branchId,
          snapshot: input.contextSnapshot,
          now,
        });
      }

      this.database.exec("COMMIT");
      return {
        id: turnId,
        branchId: input.branchId,
        parentTurnId: branch.head_turn_id,
        sequence,
        createdAt: now,
        reused: false,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private assertNoManagementAfterTurn(
    sessionId: string,
    branchId: string,
    turnId: string,
  ) {
    const row = this.database
      .prepare(`
        SELECT 1 AS found
        FROM character_management_changes
        WHERE session_id = ? AND branch_id = ? AND reference_turn_id = ?
        UNION ALL
        SELECT 1 AS found
        FROM location_management_changes
        WHERE session_id = ? AND branch_id = ? AND reference_turn_id = ?
        UNION ALL
        SELECT 1 AS found
        FROM story_module_management_changes
        WHERE session_id = ? AND branch_id = ? AND reference_turn_id = ?
        UNION ALL
        SELECT 1 AS found
        FROM plot_thread_management_changes
        WHERE session_id = ? AND branch_id = ? AND reference_turn_id = ?
        UNION ALL
        SELECT 1 AS found
        FROM plot_trigger_management_changes
        WHERE session_id = ? AND branch_id = ? AND reference_turn_id = ?
        UNION ALL
        SELECT 1 AS found
        FROM world_book_management_changes
        WHERE session_id = ? AND branch_id = ? AND reference_turn_id = ?
        UNION ALL
        SELECT 1 AS found
        FROM content_asset_management_changes
        WHERE session_id = ? AND branch_id = ? AND reference_turn_id = ?
        UNION ALL
        SELECT 1 AS found
        FROM state_control_changes
        WHERE session_id = ? AND branch_id = ? AND reference_turn_id = ?
        LIMIT 1
      `)
      .get(
        sessionId,
        branchId,
        turnId,
        sessionId,
        branchId,
        turnId,
        sessionId,
        branchId,
        turnId,
        sessionId,
        branchId,
        turnId,
        sessionId,
        branchId,
        turnId,
        sessionId,
        branchId,
        turnId,
        sessionId,
        branchId,
        turnId,
        sessionId,
        branchId,
        turnId,
      ) as { found: number } | undefined;
    if (row) {
      throw new TurnRegenerationError(
        "最新回合之后已经手工修改过人物、地点、剧情任务、伏笔、偏离触发器、世界书、原文、记忆或持久状态。为避免覆盖这些修改，当前回合不能直接重新生成。",
      );
    }
  }

  private getBranch(branchId: string): BranchRow {
    const branch = this.database
      .prepare(`
        SELECT id, session_id, name, parent_branch_id, forked_from_turn_id,
               head_turn_id, next_sequence, created_at, updated_at
        FROM branches
        WHERE id = ?
      `)
      .get(branchId) as BranchRow | undefined;
    if (!branch) throw new StoryNotFoundError("没有找到指定的剧情分支。");
    return branch;
  }

  private getActiveBranch(sessionId: string): BranchRow {
    const row = this.database
      .prepare(`
        SELECT branches.id, branches.session_id, branches.name,
               branches.parent_branch_id, branches.forked_from_turn_id,
               branches.head_turn_id, branches.next_sequence,
               branches.created_at, branches.updated_at
        FROM sessions
        JOIN branches ON branches.id = sessions.active_branch_id
        WHERE sessions.id = ?
      `)
      .get(sessionId) as BranchRow | undefined;
    if (!row) throw new StoryNotFoundError();
    return row;
  }

  private getBranchChain(branchId: string): BranchRow[] {
    const chain: BranchRow[] = [];
    const visited = new Set<string>();
    let current: BranchRow | null = this.getBranch(branchId);
    while (current) {
      if (visited.has(current.id)) {
        throw new BranchManagementError("剧情分支关系出现循环，无法读取。");
      }
      visited.add(current.id);
      chain.unshift(current);
      current = current.parent_branch_id
        ? this.getBranch(current.parent_branch_id)
        : null;
    }
    return chain;
  }

  private loadVisibleTurnRows(branchId: string): TurnRow[] {
    const branch = this.getBranch(branchId);
    const localRows = this.database
      .prepare(`
        SELECT id, branch_id, parent_turn_id, sequence, player_input_json,
               generated_output_json, summary_patch, created_at
        FROM turns
        WHERE branch_id = ?
        ORDER BY sequence
      `)
      .all(branchId) as unknown as TurnRow[];
    if (!branch.parent_branch_id) return localRows;
    if (!branch.forked_from_turn_id) {
      throw new BranchManagementError("子分支缺少起点回合，无法读取。");
    }
    const parentRows = this.loadVisibleTurnRows(branch.parent_branch_id);
    const forkIndex = parentRows.findIndex(
      (turn) => turn.id === branch.forked_from_turn_id,
    );
    if (forkIndex < 0) {
      throw new BranchManagementError("分支起点不在父分支历史中，无法读取。");
    }
    return [...parentRows.slice(0, forkIndex + 1), ...localRows];
  }

  private loadStoryMemoryTurns(branchId: string): StoryMemoryTurn[] {
    return this.loadVisibleTurnRows(branchId).map((turn) => ({
      id: turn.id,
      sequence: turn.sequence,
      playerInput: turn.player_input_json
        ? parseObject(turn.player_input_json)
        : {},
      generatedOutput: turn.generated_output_json
        ? parseObject(turn.generated_output_json)
        : {},
      summaryPatch: turn.summary_patch ?? "",
      createdAt: turn.created_at,
    }));
  }

  private synchronizeStoryMemory(sessionId: string, branchId: string) {
    const memorySchemaExists = this.database
      .prepare(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'memory_settings'",
      )
      .get();
    if (!memorySchemaExists) return null;
    return rebuildStoryMemoryIndex({
      database: this.database,
      sessionId,
      branchId,
      turns: this.loadStoryMemoryTurns(branchId),
    });
  }

  private ensureStoryMemoryIndex(sessionId: string, branchId: string) {
    const turnCount = (
      this.database
        .prepare("SELECT COUNT(*) AS total FROM turns WHERE session_id = ?")
        .get(sessionId) as { total: number }
    ).total;
    const indexed = this.database
      .prepare(
        "SELECT 1 AS found FROM memory_chapters WHERE branch_id = ? LIMIT 1",
      )
      .get(branchId);
    const duplicateActiveDirection = this.database
      .prepare(`
        SELECT COUNT(*) AS total FROM memory_entries
        WHERE branch_id = ? AND subject_key = 'story-direction'
          AND status = 'active' AND source = 'automatic'
      `)
      .get(branchId) as { total: number };
    if (turnCount > 0 && (!indexed || duplicateActiveDirection.total > 1)) {
      this.synchronizeStoryMemory(sessionId, branchId);
    }
  }

  private findStateContextBranch(branchId: string, turnId: string) {
    const visibleTurns = this.loadVisibleTurnRows(branchId);
    const targetIndex = visibleTurns.findIndex((turn) => turn.id === turnId);
    if (targetIndex < 0) {
      throw new BranchManagementError("所选回合不属于当前剧情分支。");
    }
    const chain = this.getBranchChain(branchId);
    let contextBranchId = chain[0].id;
    for (const child of chain.slice(1)) {
      const forkIndex = visibleTurns.findIndex(
        (turn) => turn.id === child.forked_from_turn_id,
      );
      if (forkIndex < 0 || forkIndex > targetIndex) break;
      contextBranchId = child.id;
    }
    return contextBranchId;
  }

  private serializeMaterializedStates(sessionId: string, branchId: string) {
    const rows = this.database
      .prepare(`
        SELECT entity_type, entity_id, state_json, is_active, version,
               updated_turn_id, updated_at
        FROM materialized_states
        WHERE session_id = ? AND branch_id = ?
        ORDER BY entity_type, entity_id
      `)
      .all(sessionId, branchId) as unknown as MaterializedStateRow[];
    return stringifyJson({
      schemaVersion: "1.0.0",
      states: rows.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        state: parseObject(row.state_json),
        isActive: row.is_active === 1,
        version: row.version,
        updatedTurnId: row.updated_turn_id,
        updatedAt: row.updated_at ?? new Date().toISOString(),
      })),
    });
  }

  private decodeSnapshotStates(stateJson: string): ReplayedMaterializedState[] {
    const parsed = parseObject(stateJson);
    if (parsed.schemaVersion !== "1.0.0" || !Array.isArray(parsed.states)) {
      throw new SavePointManagementError("存档状态版本无效，无法恢复。");
    }
    const allowedTypes = new Set<StateEntityType>([
      "character_card",
      "character_state",
      "character_card_evolution",
      "world_book_entry",
      "relationship",
      "story_direction",
      "story_module",
      "plot_thread",
      "plot_trigger",
      "plot_check",
      "location",
      "session_state",
    ]);
    return parsed.states.map((value) => {
      if (!isJsonObject(value)) {
        throw new SavePointManagementError("存档中存在无效状态记录。");
      }
      const entityType = readString(value.entityType) as StateEntityType;
      const entityId = readString(value.entityId);
      const state = value.state;
      const updatedTurnId = readString(value.updatedTurnId);
      if (
        !allowedTypes.has(entityType) ||
        !entityId ||
        !isJsonObject(state) ||
        !updatedTurnId
      ) {
        throw new SavePointManagementError("存档中存在不完整的状态记录。");
      }
      return {
        entityType,
        entityId,
        state: structuredClone(state),
        isActive: value.isActive !== false,
        version:
          typeof value.version === "number" && value.version > 0
            ? Math.floor(value.version)
            : 1,
        updatedTurnId,
        updatedAt: readString(value.updatedAt) || new Date().toISOString(),
      };
    });
  }

  private loadRecoveryPoint(sessionId: string, recoveryPointId: string) {
    const manual = this.database
      .prepare(`
        SELECT branch_id, turn_id, sequence, state_json
        FROM save_points
        WHERE id = ? AND session_id = ?
      `)
      .get(recoveryPointId, sessionId) as
      | {
          branch_id: string;
          turn_id: string;
          sequence: number;
          state_json: string;
        }
      | undefined;
    const snapshot = manual
      ? undefined
      : (this.database
          .prepare(`
            SELECT branch_id, turn_id, sequence, state_json
            FROM snapshots
            WHERE id = ? AND session_id = ?
          `)
          .get(recoveryPointId, sessionId) as
          | {
              branch_id: string;
              turn_id: string;
              sequence: number;
              state_json: string;
            }
          | undefined);
    const row = manual ?? snapshot;
    if (!row) throw new StoryNotFoundError("没有找到指定的存档。");
    return {
      branchId: row.branch_id,
      turnId: row.turn_id,
      sequence: row.sequence,
      states: this.decodeSnapshotStates(row.state_json),
    };
  }

  private writeSnapshot(input: {
    sessionId: string;
    branchId: string;
    turnId: string;
    sequence: number;
    name: string;
    kind: "automatic" | "fork";
    now: string;
  }) {
    const stateJson = this.serializeMaterializedStates(
      input.sessionId,
      input.branchId,
    );
    this.database
      .prepare(`
        INSERT INTO snapshots (
          id, session_id, branch_id, turn_id, sequence, state_json,
          name, kind, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(branch_id, sequence) DO UPDATE SET
          turn_id = excluded.turn_id,
          state_json = excluded.state_json,
          name = excluded.name,
          created_at = excluded.created_at
        WHERE snapshots.kind = 'automatic' AND excluded.kind = 'automatic'
      `)
      .run(
        randomUUID(),
        input.sessionId,
        input.branchId,
        input.turnId,
        input.sequence,
        stateJson,
        input.name,
        input.kind,
        input.now,
      );
  }

  private reconstructStatesThroughSequence(input: {
    sessionId: string;
    branchId: string;
    sequence: number;
  }): ReplayedMaterializedState[] {
    const branch = this.getBranch(input.branchId);
    const states = new Map<string, ReplayedMaterializedState>();
    if (branch.parent_branch_id) {
      const base = this.database
        .prepare(`
          SELECT state_json
          FROM snapshots
          WHERE branch_id = ? AND kind = 'fork'
          ORDER BY sequence ASC
          LIMIT 1
        `)
        .get(branch.id) as { state_json: string } | undefined;
      if (!base) {
        throw new BranchManagementError("分支缺少冻结的起点状态，无法恢复。");
      }
      for (const state of this.decodeSnapshotStates(base.state_json)) {
        states.set(`${state.entityType}:${state.entityId}`, state);
      }
    }
    const rows = this.database
      .prepare(`
        SELECT turns.sequence AS sequence, 0 AS source_order,
               '' AS action_id, state_changes.ordinal AS ordinal,
               state_changes.entity_type AS entity_type,
               state_changes.entity_id AS entity_id,
               state_changes.operation AS operation,
               state_changes.payload_json AS payload_json,
               NULL AS result_active,
               state_changes.turn_id AS updated_turn_id,
               state_changes.created_at AS created_at
        FROM state_changes
        JOIN turns ON turns.id = state_changes.turn_id
        WHERE state_changes.session_id = ? AND state_changes.branch_id = ?
          AND turns.sequence <= ?
        UNION ALL
        SELECT turns.sequence AS sequence, 1 AS source_order,
               character_management_changes.action_id AS action_id,
               character_management_changes.ordinal AS ordinal,
               character_management_changes.entity_type AS entity_type,
               character_management_changes.entity_id AS entity_id,
               character_management_changes.operation AS operation,
               character_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               character_management_changes.reference_turn_id AS updated_turn_id,
               character_management_changes.created_at AS created_at
        FROM character_management_changes
        JOIN turns ON turns.id = character_management_changes.reference_turn_id
        WHERE character_management_changes.session_id = ?
          AND character_management_changes.branch_id = ?
          AND turns.sequence <= ?
        UNION ALL
        SELECT turns.sequence AS sequence, 1 AS source_order,
               location_management_changes.action_id AS action_id,
               location_management_changes.ordinal AS ordinal,
               location_management_changes.entity_type AS entity_type,
               location_management_changes.entity_id AS entity_id,
               location_management_changes.operation AS operation,
               location_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               location_management_changes.reference_turn_id AS updated_turn_id,
               location_management_changes.created_at AS created_at
        FROM location_management_changes
        JOIN turns ON turns.id = location_management_changes.reference_turn_id
        WHERE location_management_changes.session_id = ?
          AND location_management_changes.branch_id = ?
          AND turns.sequence <= ?
        UNION ALL
        SELECT turns.sequence AS sequence, 1 AS source_order,
               story_module_management_changes.action_id AS action_id,
               story_module_management_changes.ordinal AS ordinal,
               story_module_management_changes.entity_type AS entity_type,
               story_module_management_changes.entity_id AS entity_id,
               story_module_management_changes.operation AS operation,
               story_module_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               story_module_management_changes.reference_turn_id AS updated_turn_id,
               story_module_management_changes.created_at AS created_at
        FROM story_module_management_changes
        JOIN turns ON turns.id = story_module_management_changes.reference_turn_id
        WHERE story_module_management_changes.session_id = ?
          AND story_module_management_changes.branch_id = ?
          AND turns.sequence <= ?
        UNION ALL
        SELECT turns.sequence AS sequence, 1 AS source_order,
               world_book_management_changes.action_id AS action_id,
               world_book_management_changes.ordinal AS ordinal,
               world_book_management_changes.entity_type AS entity_type,
               world_book_management_changes.entity_id AS entity_id,
               world_book_management_changes.operation AS operation,
               world_book_management_changes.payload_json AS payload_json,
               NULL AS result_active,
               world_book_management_changes.reference_turn_id AS updated_turn_id,
               world_book_management_changes.created_at AS created_at
        FROM world_book_management_changes
        JOIN turns ON turns.id = world_book_management_changes.reference_turn_id
        WHERE world_book_management_changes.session_id = ?
          AND world_book_management_changes.branch_id = ?
          AND turns.sequence <= ?
        UNION ALL
        SELECT turns.sequence AS sequence, 2 AS source_order,
               state_control_changes.action_id AS action_id,
               state_control_changes.ordinal AS ordinal,
               state_control_changes.entity_type AS entity_type,
               state_control_changes.entity_id AS entity_id,
               state_control_changes.operation AS operation,
               state_control_changes.payload_json AS payload_json,
               state_control_changes.result_active AS result_active,
               state_control_changes.reference_turn_id AS updated_turn_id,
               state_control_changes.created_at AS created_at
        FROM state_control_changes
        JOIN turns ON turns.id = state_control_changes.reference_turn_id
        WHERE state_control_changes.session_id = ?
          AND state_control_changes.branch_id = ?
          AND turns.sequence <= ?
        ORDER BY sequence, source_order, created_at, action_id, ordinal
      `)
      .all(
        input.sessionId,
        input.branchId,
        input.sequence,
        input.sessionId,
        input.branchId,
        input.sequence,
        input.sessionId,
        input.branchId,
        input.sequence,
        input.sessionId,
        input.branchId,
        input.sequence,
        input.sessionId,
        input.branchId,
        input.sequence,
        input.sessionId,
        input.branchId,
        input.sequence,
      ) as unknown as ReplayMutationRow[];
    for (const row of rows) {
      const key = `${row.entity_type}:${row.entity_id}`;
      const current = states.get(key);
      const mutationValue = parseObject(row.payload_json);
      let nextState = current?.state ?? {};
      let isActive = current?.isActive ?? true;
      switch (row.operation) {
        case "replace":
          nextState = structuredClone(mutationValue);
          isActive = true;
          break;
        case "merge":
          nextState = applyStateMergePatch(nextState, mutationValue);
          break;
        case "activate":
          nextState = applyStateMergePatch(nextState, mutationValue);
          isActive = true;
          break;
        case "deactivate":
          isActive = false;
          break;
      }
      if (row.result_active !== null) isActive = row.result_active === 1;
      states.set(key, {
        entityType: row.entity_type,
        entityId: row.entity_id,
        state: nextState,
        isActive,
        version: (current?.version ?? 0) + 1,
        updatedTurnId: row.updated_turn_id,
        updatedAt: row.created_at,
      });
    }
    return [...states.values()];
  }

  private applyCharacterManagementMutations(input: {
    actionId: string;
    sessionId: string;
    branchId: string;
    referenceTurnId: string;
    characterId: string;
    mutations: StateMutationInput[];
    now: string;
  }) {
    const readCurrent = this.database.prepare(`
      SELECT state_json, is_active, version
      FROM materialized_states
      WHERE session_id = ? AND branch_id = ?
        AND entity_type = ? AND entity_id = ?
    `);
    const insertChange = this.database.prepare(`
      INSERT INTO character_management_changes (
        id, action_id, session_id, branch_id, reference_turn_id,
        ordinal, character_id, entity_type, entity_id, operation,
        payload_json, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertCurrent = this.database.prepare(`
      INSERT INTO materialized_states (
        session_id, branch_id, entity_type, entity_id,
        state_json, is_active, version, updated_turn_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, branch_id, entity_type, entity_id)
      DO UPDATE SET
        state_json = excluded.state_json,
        is_active = excluded.is_active,
        version = excluded.version,
        updated_turn_id = excluded.updated_turn_id,
        updated_at = excluded.updated_at
    `);

    for (const [ordinal, mutation] of input.mutations.entries()) {
      const current = readCurrent.get(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
      ) as
        | { state_json: string; is_active: number; version: number }
        | undefined;
      const currentState = current ? parseObject(current.state_json) : {};
      const mutationValue = mutation.value ?? {};
      let nextState = currentState;
      let isActive = current ? current.is_active === 1 : true;

      switch (mutation.operation) {
        case "replace":
          nextState = structuredClone(mutationValue);
          isActive = true;
          break;
        case "merge":
          nextState = applyStateMergePatch(currentState, mutationValue);
          break;
        case "activate":
          nextState = applyStateMergePatch(currentState, mutationValue);
          isActive = true;
          break;
        case "deactivate":
          isActive = false;
          break;
      }

      insertChange.run(
        randomUUID(),
        input.actionId,
        input.sessionId,
        input.branchId,
        input.referenceTurnId,
        ordinal,
        input.characterId,
        mutation.entityType,
        mutation.entityId,
        mutation.operation,
        stringifyJson(mutationValue),
        mutation.reason,
        input.now,
      );
      upsertCurrent.run(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
        stringifyJson(nextState),
        isActive ? 1 : 0,
        (current?.version ?? 0) + 1,
        input.referenceTurnId,
        input.now,
      );
    }
  }

  private applyLocationManagementMutations(input: {
    actionId: string;
    sessionId: string;
    branchId: string;
    referenceTurnId: string;
    locationId: string;
    mutations: StateMutationInput[];
    now: string;
  }) {
    const readCurrent = this.database.prepare(`
      SELECT state_json, is_active, version
      FROM materialized_states
      WHERE session_id = ? AND branch_id = ?
        AND entity_type = ? AND entity_id = ?
    `);
    const insertChange = this.database.prepare(`
      INSERT INTO location_management_changes (
        id, action_id, session_id, branch_id, reference_turn_id,
        ordinal, location_id, entity_type, entity_id, operation,
        payload_json, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertCurrent = this.database.prepare(`
      INSERT INTO materialized_states (
        session_id, branch_id, entity_type, entity_id,
        state_json, is_active, version, updated_turn_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, branch_id, entity_type, entity_id)
      DO UPDATE SET
        state_json = excluded.state_json,
        is_active = excluded.is_active,
        version = excluded.version,
        updated_turn_id = excluded.updated_turn_id,
        updated_at = excluded.updated_at
    `);

    for (const [ordinal, mutation] of input.mutations.entries()) {
      const current = readCurrent.get(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
      ) as
        | { state_json: string; is_active: number; version: number }
        | undefined;
      const currentState = current ? parseObject(current.state_json) : {};
      const mutationValue = mutation.value ?? {};
      let nextState = currentState;
      let isActive = current ? current.is_active === 1 : true;

      switch (mutation.operation) {
        case "replace":
          nextState = structuredClone(mutationValue);
          isActive = true;
          break;
        case "merge":
          nextState = applyStateMergePatch(currentState, mutationValue);
          break;
        case "activate":
          nextState = applyStateMergePatch(currentState, mutationValue);
          isActive = true;
          break;
        case "deactivate":
          isActive = false;
          break;
      }

      insertChange.run(
        randomUUID(),
        input.actionId,
        input.sessionId,
        input.branchId,
        input.referenceTurnId,
        ordinal,
        input.locationId,
        mutation.entityType,
        mutation.entityId,
        mutation.operation,
        stringifyJson(mutationValue),
        mutation.reason,
        input.now,
      );
      upsertCurrent.run(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
        stringifyJson(nextState),
        isActive ? 1 : 0,
        (current?.version ?? 0) + 1,
        input.referenceTurnId,
        input.now,
      );
    }
  }

  private assertValidStoryModuleGraph(modules: JsonObject[]) {
    const moduleById = new Map<string, JsonObject>();
    for (const taskModule of modules) {
      const moduleId = readString(taskModule.moduleId).trim();
      if (!moduleId) {
        throw new StoryModuleManagementError("剧情任务缺少有效的任务 ID。");
      }
      if (moduleById.has(moduleId)) {
        throw new StoryModuleManagementError(`剧情任务 ID ${moduleId} 重复。`);
      }
      moduleById.set(moduleId, taskModule);
    }

    for (const [moduleId, taskModule] of moduleById) {
      const prerequisiteIds = Array.isArray(taskModule.prerequisiteModuleIds)
        ? taskModule.prerequisiteModuleIds.filter(
            (value): value is string => typeof value === "string" && Boolean(value),
          )
        : [];
      if (new Set(prerequisiteIds).size !== prerequisiteIds.length) {
        throw new StoryModuleManagementError(
          `剧情任务 ${moduleId} 的前置任务不能重复。`,
        );
      }
      for (const prerequisiteId of prerequisiteIds) {
        if (!moduleById.has(prerequisiteId)) {
          throw new StoryModuleManagementError(
            `剧情任务 ${moduleId} 引用了不存在的前置任务 ${prerequisiteId}。`,
          );
        }
        if (prerequisiteId === moduleId) {
          throw new StoryModuleManagementError(
            `剧情任务 ${moduleId} 不能把自己设为前置任务。`,
          );
        }
      }
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const path: string[] = [];
    const visit = (moduleId: string) => {
      if (visited.has(moduleId)) return;
      if (visiting.has(moduleId)) {
        const cycleStart = path.indexOf(moduleId);
        throw new StoryModuleManagementError(
          `剧情任务前置关系存在循环：${[
            ...path.slice(cycleStart),
            moduleId,
          ].join(" → ")}。`,
        );
      }
      visiting.add(moduleId);
      path.push(moduleId);
      const taskModule = moduleById.get(moduleId);
      const prerequisiteIds = Array.isArray(taskModule?.prerequisiteModuleIds)
        ? taskModule.prerequisiteModuleIds.filter(
            (value): value is string => typeof value === "string" && Boolean(value),
          )
        : [];
      for (const prerequisiteId of prerequisiteIds) visit(prerequisiteId);
      path.pop();
      visiting.delete(moduleId);
      visited.add(moduleId);
    };
    for (const moduleId of moduleById.keys()) visit(moduleId);
  }

  private applyWorldBookManagementMutations(input: {
    actionId: string;
    sessionId: string;
    branchId: string;
    referenceTurnId: string;
    worldBookEntryId: string;
    mutations: StateMutationInput[];
    now: string;
  }) {
    const readCurrent = this.database.prepare(`
      SELECT state_json, is_active, version
      FROM materialized_states
      WHERE session_id = ? AND branch_id = ?
        AND entity_type = ? AND entity_id = ?
    `);
    const insertChange = this.database.prepare(`
      INSERT INTO world_book_management_changes (
        id, action_id, session_id, branch_id, reference_turn_id,
        ordinal, world_book_entry_id, entity_type, entity_id, operation,
        payload_json, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertCurrent = this.database.prepare(`
      INSERT INTO materialized_states (
        session_id, branch_id, entity_type, entity_id,
        state_json, is_active, version, updated_turn_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, branch_id, entity_type, entity_id)
      DO UPDATE SET
        state_json = excluded.state_json,
        is_active = excluded.is_active,
        version = excluded.version,
        updated_turn_id = excluded.updated_turn_id,
        updated_at = excluded.updated_at
    `);

    for (const [ordinal, mutation] of input.mutations.entries()) {
      const current = readCurrent.get(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
      ) as
        | { state_json: string; is_active: number; version: number }
        | undefined;
      const currentState = current ? parseObject(current.state_json) : {};
      const mutationValue = mutation.value ?? {};
      let nextState = currentState;
      let isActive = current ? current.is_active === 1 : true;

      switch (mutation.operation) {
        case "replace":
          nextState = structuredClone(mutationValue);
          isActive = true;
          break;
        case "merge":
          nextState = applyStateMergePatch(currentState, mutationValue);
          break;
        case "activate":
          nextState = applyStateMergePatch(currentState, mutationValue);
          isActive = true;
          break;
        case "deactivate":
          isActive = false;
          break;
      }

      insertChange.run(
        randomUUID(),
        input.actionId,
        input.sessionId,
        input.branchId,
        input.referenceTurnId,
        ordinal,
        input.worldBookEntryId,
        mutation.entityType,
        mutation.entityId,
        mutation.operation,
        stringifyJson(mutationValue),
        mutation.reason,
        input.now,
      );
      upsertCurrent.run(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
        stringifyJson(nextState),
        isActive ? 1 : 0,
        (current?.version ?? 0) + 1,
        input.referenceTurnId,
        input.now,
      );
    }
  }

  private applyStoryModuleManagementMutations(input: {
    actionId: string;
    sessionId: string;
    branchId: string;
    referenceTurnId: string;
    storyModuleId: string;
    mutations: StateMutationInput[];
    now: string;
  }) {
    const readCurrent = this.database.prepare(`
      SELECT state_json, is_active, version
      FROM materialized_states
      WHERE session_id = ? AND branch_id = ?
        AND entity_type = ? AND entity_id = ?
    `);
    const insertChange = this.database.prepare(`
      INSERT INTO story_module_management_changes (
        id, action_id, session_id, branch_id, reference_turn_id,
        ordinal, story_module_id, entity_type, entity_id, operation,
        payload_json, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertCurrent = this.database.prepare(`
      INSERT INTO materialized_states (
        session_id, branch_id, entity_type, entity_id,
        state_json, is_active, version, updated_turn_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, branch_id, entity_type, entity_id)
      DO UPDATE SET
        state_json = excluded.state_json,
        is_active = excluded.is_active,
        version = excluded.version,
        updated_turn_id = excluded.updated_turn_id,
        updated_at = excluded.updated_at
    `);

    for (const [ordinal, mutation] of input.mutations.entries()) {
      const current = readCurrent.get(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
      ) as
        | { state_json: string; is_active: number; version: number }
        | undefined;
      const currentState = current ? parseObject(current.state_json) : {};
      const mutationValue = mutation.value ?? {};
      let nextState = currentState;
      let isActive = current ? current.is_active === 1 : true;

      switch (mutation.operation) {
        case "replace":
          nextState = structuredClone(mutationValue);
          isActive = true;
          break;
        case "merge":
          nextState = applyStateMergePatch(currentState, mutationValue);
          break;
        case "activate":
          nextState = applyStateMergePatch(currentState, mutationValue);
          isActive = true;
          break;
        case "deactivate":
          isActive = false;
          break;
      }

      insertChange.run(
        randomUUID(),
        input.actionId,
        input.sessionId,
        input.branchId,
        input.referenceTurnId,
        ordinal,
        input.storyModuleId,
        mutation.entityType,
        mutation.entityId,
        mutation.operation,
        stringifyJson(mutationValue),
        mutation.reason,
        input.now,
      );
      upsertCurrent.run(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
        stringifyJson(nextState),
        isActive ? 1 : 0,
        (current?.version ?? 0) + 1,
        input.referenceTurnId,
        input.now,
      );
    }
  }

  private applyPlotElementManagementMutations(input: {
    actionId: string;
    sessionId: string;
    branchId: string;
    referenceTurnId: string;
    elementId: string;
    table:
      | "plot_thread_management_changes"
      | "plot_trigger_management_changes";
    mutations: StateMutationInput[];
    now: string;
  }) {
    const idColumn =
      input.table === "plot_thread_management_changes"
        ? "plot_thread_id"
        : "plot_trigger_id";
    const readCurrent = this.database.prepare(`
      SELECT state_json, is_active, version
      FROM materialized_states
      WHERE session_id = ? AND branch_id = ?
        AND entity_type = ? AND entity_id = ?
    `);
    const insertChange = this.database.prepare(`
      INSERT INTO ${input.table} (
        id, action_id, session_id, branch_id, reference_turn_id,
        ordinal, ${idColumn}, entity_type, entity_id, operation,
        payload_json, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertCurrent = this.database.prepare(`
      INSERT INTO materialized_states (
        session_id, branch_id, entity_type, entity_id,
        state_json, is_active, version, updated_turn_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, branch_id, entity_type, entity_id)
      DO UPDATE SET
        state_json = excluded.state_json,
        is_active = excluded.is_active,
        version = excluded.version,
        updated_turn_id = excluded.updated_turn_id,
        updated_at = excluded.updated_at
    `);

    for (const [ordinal, mutation] of input.mutations.entries()) {
      const current = readCurrent.get(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
      ) as
        | { state_json: string; is_active: number; version: number }
        | undefined;
      const currentState = current ? parseObject(current.state_json) : {};
      const mutationValue = mutation.value ?? {};
      let nextState = currentState;
      let isActive = current ? current.is_active === 1 : true;

      switch (mutation.operation) {
        case "replace":
          nextState = structuredClone(mutationValue);
          isActive = true;
          break;
        case "merge":
          nextState = applyStateMergePatch(currentState, mutationValue);
          break;
        case "activate":
          nextState = applyStateMergePatch(currentState, mutationValue);
          isActive = true;
          break;
        case "deactivate":
          isActive = false;
          break;
      }

      insertChange.run(
        randomUUID(),
        input.actionId,
        input.sessionId,
        input.branchId,
        input.referenceTurnId,
        ordinal,
        input.elementId,
        mutation.entityType,
        mutation.entityId,
        mutation.operation,
        stringifyJson(mutationValue),
        mutation.reason,
        input.now,
      );
      upsertCurrent.run(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
        stringifyJson(nextState),
        isActive ? 1 : 0,
        (current?.version ?? 0) + 1,
        input.referenceTurnId,
        input.now,
      );
    }
  }

  private applyStateMutations(input: {
    sessionId: string;
    branchId: string;
    turnId: string;
    mutations: StateMutationInput[];
    now: string;
  }) {
    const readCurrent = this.database.prepare(`
      SELECT state_json, is_active, version
      FROM materialized_states
      WHERE session_id = ? AND branch_id = ?
        AND entity_type = ? AND entity_id = ?
    `);
    const insertChange = this.database.prepare(`
      INSERT INTO state_changes (
        id, session_id, branch_id, turn_id, ordinal,
        entity_type, entity_id, operation, payload_json,
        reason, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertCurrent = this.database.prepare(`
      INSERT INTO materialized_states (
        session_id, branch_id, entity_type, entity_id,
        state_json, is_active, version, updated_turn_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, branch_id, entity_type, entity_id)
      DO UPDATE SET
        state_json = excluded.state_json,
        is_active = excluded.is_active,
        version = excluded.version,
        updated_turn_id = excluded.updated_turn_id,
        updated_at = excluded.updated_at
    `);
    const auditSchemaExists = Boolean(
      this.database
        .prepare(
          "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'state_lock_blocks'",
        )
        .get(),
    );
    const insertBlock = auditSchemaExists
      ? this.database.prepare(`
          INSERT INTO state_lock_blocks (
            id, session_id, branch_id, turn_id, ordinal,
            entity_type, entity_id, field_paths_json,
            proposed_payload_json, reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
      : null;
    const lockRows = (auditSchemaExists
      ? this.database
          .prepare(`
            SELECT entity_type, entity_id, field_path, locked
            FROM state_field_lock_changes
            WHERE session_id = ?
            ORDER BY entity_type, entity_id, field_path, revision
          `)
          .all(input.sessionId)
      : []) as unknown as Array<{
      entity_type: StateEntityType;
      entity_id: string;
      field_path: string;
      locked: number;
    }>;
    const locksByEntity = new Map<string, Set<string>>();
    for (const row of lockRows) {
      const key = `${row.entity_type}:${row.entity_id}`;
      const paths = locksByEntity.get(key) ?? new Set<string>();
      if (row.locked === 1) paths.add(row.field_path);
      else paths.delete(row.field_path);
      locksByEntity.set(key, paths);
    }

    for (const [ordinal, mutation] of input.mutations.entries()) {
      const current = readCurrent.get(
        input.sessionId,
        input.branchId,
        mutation.entityType,
        mutation.entityId,
      ) as
        | { state_json: string; is_active: number; version: number }
        | undefined;
      const currentState = current ? parseObject(current.state_json) : {};
      const currentActive = current ? current.is_active === 1 : true;
      const protectedResult = protectMutationWithLocks({
        mutation,
        currentState,
        currentActive,
        locks:
          locksByEntity.get(`${mutation.entityType}:${mutation.entityId}`) ??
          new Set<string>(),
      });
      if (insertBlock && protectedResult.blockedPaths.length > 0) {
        insertBlock.run(
          randomUUID(),
          input.sessionId,
          input.branchId,
          input.turnId,
          ordinal,
          mutation.entityType,
          mutation.entityId,
          stringifyJson(protectedResult.blockedPaths),
          stringifyJson(mutation.value ?? {}),
          mutation.reason,
          input.now,
        );
      }
      const protectedMutation = protectedResult.mutation;
      if (!protectedMutation) continue;
      const mutationValue = protectedMutation.value ?? {};

      let nextState = currentState;
      let isActive = currentActive;

      switch (protectedMutation.operation) {
        case "replace":
          nextState = structuredClone(mutationValue);
          isActive = true;
          break;
        case "merge":
          nextState = applyStateMergePatch(currentState, mutationValue);
          break;
        case "activate":
          nextState = applyStateMergePatch(currentState, mutationValue);
          isActive = true;
          break;
        case "deactivate":
          isActive = false;
          break;
      }
      if (protectedResult.resultActive !== undefined) {
        isActive = protectedResult.resultActive;
      }

      insertChange.run(
        protectedMutation.id ?? randomUUID(),
        input.sessionId,
        input.branchId,
        input.turnId,
        ordinal,
        protectedMutation.entityType,
        protectedMutation.entityId,
        protectedMutation.operation,
        stringifyJson(mutationValue),
        protectedMutation.reason,
        stringifyJson(protectedMutation.evidence),
        input.now,
      );

      upsertCurrent.run(
        input.sessionId,
        input.branchId,
        protectedMutation.entityType,
        protectedMutation.entityId,
        stringifyJson(nextState),
        isActive ? 1 : 0,
        (current?.version ?? 0) + 1,
        input.turnId,
        input.now,
      );
    }
  }

  private hydrateTurns(turnRows: TurnRow[]): LoadedTurn[] {
    const turnIds = turnRows.map((row) => row.id);
    const changesByTurnId = new Map<string, LoadedStateChange[]>();
    const blockedChangesByTurnId = new Map<string, LoadedBlockedStateChange[]>();
    const generationByTurnId = new Map<string, LoadedTurnGeneration>();

    if (turnIds.length > 0) {
      const placeholders = turnIds.map(() => "?").join(", ");
      const changeRows = this.database
        .prepare(`
          SELECT id, turn_id, entity_type, entity_id, operation,
                 payload_json, reason, evidence_json, created_at
          FROM state_changes
          WHERE turn_id IN (${placeholders})
          ORDER BY turn_id, ordinal
        `)
        .all(...turnIds) as unknown as StateChangeRow[];

      for (const row of changeRows) {
        const changes = changesByTurnId.get(row.turn_id) ?? [];
        changes.push({
          id: row.id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          operation: row.operation,
          payload: parseObject(row.payload_json),
          reason: row.reason,
          evidence: parseStringArray(row.evidence_json),
          createdAt: row.created_at,
        });
        changesByTurnId.set(row.turn_id, changes);
      }

      const blockedRows = this.database
        .prepare(`
          SELECT id, turn_id, entity_type, entity_id, field_paths_json,
                 proposed_payload_json, reason, created_at
          FROM state_lock_blocks
          WHERE turn_id IN (${placeholders})
          ORDER BY turn_id, ordinal
        `)
        .all(...turnIds) as unknown as Array<{
        id: string;
        turn_id: string;
        entity_type: StateEntityType;
        entity_id: string;
        field_paths_json: string;
        proposed_payload_json: string;
        reason: string;
        created_at: string;
      }>;
      for (const row of blockedRows) {
        const blocked = blockedChangesByTurnId.get(row.turn_id) ?? [];
        blocked.push({
          id: row.id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          fieldPaths: parseStringArray(row.field_paths_json),
          proposedPayload: parseObject(row.proposed_payload_json),
          reason: row.reason,
          createdAt: row.created_at,
        });
        blockedChangesByTurnId.set(row.turn_id, blocked);
      }

      const metadataRows = this.database
        .prepare(`
          SELECT turn_id, metadata_json
          FROM messages
          WHERE turn_id IN (${placeholders}) AND role = 'narrator'
          ORDER BY turn_id, ordinal
        `)
        .all(...turnIds) as unknown as GenerationMetadataRow[];

      for (const row of metadataRows) {
        const metadata = parseObject(row.metadata_json);
        const model = readString(metadata.model);
        const promptTokens = readOptionalNumber(metadata.promptTokens);
        const completionTokens = readOptionalNumber(metadata.completionTokens);
        const totalTokens = readOptionalNumber(metadata.totalTokens);
        if (
          model ||
          promptTokens !== undefined ||
          completionTokens !== undefined ||
          totalTokens !== undefined
        ) {
          generationByTurnId.set(row.turn_id, {
            model: model || "未知模型",
            ...(promptTokens !== undefined ? { promptTokens } : {}),
            ...(completionTokens !== undefined ? { completionTokens } : {}),
            ...(totalTokens !== undefined ? { totalTokens } : {}),
          });
        }
      }
    }

    return turnRows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      sequence: row.sequence,
      parentTurnId: row.parent_turn_id,
      playerInput: parseObject(row.player_input_json ?? "{}"),
      generatedOutput: parseObject(row.generated_output_json ?? "{}"),
      summaryPatch: row.summary_patch ?? "",
      stateChanges: changesByTurnId.get(row.id) ?? [],
      blockedStateChanges: blockedChangesByTurnId.get(row.id) ?? [],
      ...(generationByTurnId.has(row.id)
        ? { generation: generationByTurnId.get(row.id) }
        : {}),
      createdAt: row.created_at,
    }));
  }

  loadTurn(branchId: string, turnId: string): LoadedTurn {
    requireText(branchId, "branchId");
    requireText(turnId, "turnId");
    const row = this.loadVisibleTurnRows(branchId).find(
      (candidate) => candidate.id === turnId,
    );

    if (!row) {
      throw new StoryNotFoundError("没有找到指定的剧情回合。");
    }
    return this.hydrateTurns([row])[0];
  }

  loadTurnContextSnapshot(
    sessionId: string,
    turnId: string,
  ): LoadedTurnContextSnapshot {
    requireText(sessionId, "sessionId");
    requireText(turnId, "turnId");
    const row = this.database
      .prepare(`
        SELECT turn_id, session_id, branch_id, schema_version, model,
               system_prompt, context_json, diagnostics_json, messages_json,
               estimated_tokens, prompt_tokens, request_count, repair_applied,
               created_at, updated_at
        FROM turn_context_snapshots
        WHERE session_id = ? AND turn_id = ?
      `)
      .get(sessionId, turnId) as
      | {
          turn_id: string;
          session_id: string;
          branch_id: string;
          schema_version: string;
          model: string;
          system_prompt: string;
          context_json: string;
          diagnostics_json: string;
          messages_json: string;
          estimated_tokens: number;
          prompt_tokens: number | null;
          request_count: number;
          repair_applied: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      throw new StoryNotFoundError("这个回合没有保存 AI 上下文快照。");
    }
    if (row.schema_version !== "1.0.0") {
      throw new Error("数据库中的 AI 上下文快照版本不受支持。");
    }
    const rawMessages = JSON.parse(row.messages_json) as unknown;
    if (!Array.isArray(rawMessages)) {
      throw new Error("数据库中的 AI 消息快照无效。");
    }
    const messages = rawMessages.flatMap((item) => {
      if (
        item === null ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        !("role" in item) ||
        !("content" in item)
      ) {
        return [];
      }
      const role = item.role;
      const content = item.content;
      if (
        (role !== "system" && role !== "user" && role !== "assistant") ||
        typeof content !== "string"
      ) {
        return [];
      }
      return [{ role, content } satisfies TurnContextMessage];
    });
    return {
      turnId: row.turn_id,
      sessionId: row.session_id,
      branchId: row.branch_id,
      schemaVersion: "1.0.0",
      model: row.model,
      systemPrompt: row.system_prompt,
      context: parseObject(row.context_json),
      diagnostics: parseObject(row.diagnostics_json),
      messages,
      estimatedTokens: row.estimated_tokens,
      ...(row.prompt_tokens !== null ? { promptTokens: row.prompt_tokens } : {}),
      requestCount: row.request_count,
      repairApplied: row.repair_applied === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  loadBranchState(branchId: string, recentTurnLimit = 20): LoadedBranchState {
    requireText(branchId, "branchId");
    const branch = this.database
      .prepare(`
        SELECT id, session_id, name, parent_branch_id, forked_from_turn_id,
               head_turn_id, next_sequence, created_at, updated_at
        FROM branches
        WHERE id = ?
      `)
      .get(branchId) as BranchRow | undefined;

    if (!branch) {
      throw new Error("没有找到指定的剧情分支。");
    }

    const stateRows = this.database
      .prepare(`
        SELECT entity_type, entity_id, state_json, is_active,
               version, updated_turn_id
        FROM materialized_states
        WHERE branch_id = ?
        ORDER BY entity_type, entity_id
      `)
      .all(branchId) as unknown as MaterializedStateRow[];

    const visibleTurns = this.loadVisibleTurnRows(branchId);
    const turnRows = visibleTurns.slice(-Math.max(1, recentTurnLimit));
    const historyRows: TurnHistoryRow[] = [...visibleTurns]
      .reverse()
      .map((turn) => ({
        id: turn.id,
        branch_id: turn.branch_id,
        sequence: turn.sequence,
        summary_patch: turn.summary_patch ?? "",
        created_at: turn.created_at,
      }));

    return {
      branch: {
        id: branch.id,
        name: branch.name,
        sessionId: branch.session_id,
        parentBranchId: branch.parent_branch_id,
        forkedFromTurnId: branch.forked_from_turn_id,
        headTurnId: branch.head_turn_id,
        nextSequence: branch.next_sequence,
      },
      states: stateRows.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        state: parseObject(row.state_json),
        isActive: row.is_active === 1,
        version: row.version,
        updatedTurnId: row.updated_turn_id,
      })),
      recentTurns: this.hydrateTurns(turnRows),
      turnHistory: historyRows.map((row) => ({
        id: row.id,
        branchId: row.branch_id,
        sequence: row.sequence,
        summaryPatch: row.summary_patch,
        createdAt: row.created_at,
      })),
    };
  }
}
