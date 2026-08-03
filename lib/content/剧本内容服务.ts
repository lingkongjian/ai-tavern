import {
  CharacterManagementError,
  ContentAssetManagementError,
  type ContentAssetManagementInput,
  LocalStoryStore,
  LocationManagementError,
  PlotThreadManagementError,
  PlotTriggerManagementError,
  StoryModuleManagementError,
  type StateAuditDashboard,
  WorldBookManagementError,
} from "../storage/story-store.ts";
import {
  parseSourceDocumentInput,
  parseSourceDocumentSettings,
  SourceReferenceInputError,
  type SourceDocumentSummary,
} from "../reference/原文参考.ts";
import type { StoryMemoryDashboard } from "../memory/剧情记忆.ts";
import {
  CharacterManagementInputError,
  parseCharacterManagementInput,
} from "../story/人物管理.ts";
import {
  LocationManagementInputError,
  parseLocationManagementInput,
} from "../story/地点管理.ts";
import {
  parseStoryModuleManagementInput,
  StoryModuleManagementInputError,
} from "../story/剧情任务管理.ts";
import {
  parsePlotThreadManagementInput,
  parsePlotTriggerManagementInput,
  PlotElementManagementInputError,
} from "../story/剧本元素管理.ts";
import {
  parseWorldBookManagementInput,
  WorldBookManagementInputError,
} from "../story/世界书管理.ts";
import type {
  ContentAssetManagementChange,
  LoadedAdventure,
} from "../storage/story-store.ts";

export const STORY_CONTENT_SERVICE_SCHEMA_VERSION = "1.0.0" as const;

export type StoryContentDomain =
  | "characters"
  | "locations"
  | "story_modules"
  | "world_book"
  | "foreshadowing"
  | "triggers"
  | "sources"
  | "memories";

export interface StoryContentCommandResult {
  actionId: string;
  domain: StoryContentDomain;
  operation: string;
  targetId: string;
  reused: boolean;
}

export interface StoryContentSnapshot {
  adventure: LoadedAdventure;
  sourceDocuments: SourceDocumentSummary[];
  memory: StoryMemoryDashboard;
}

export interface StoryContentAudit {
  state: StateAuditDashboard;
  assets: ContentAssetManagementChange[];
}

export interface StoryContentWorkspaceResponse {
  schemaVersion: typeof STORY_CONTENT_SERVICE_SCHEMA_VERSION;
  content: StoryContentSnapshot;
  audit?: StoryContentAudit;
}

export interface StoryContentCommandResponse extends StoryContentWorkspaceResponse {
  result: StoryContentCommandResult;
}

type ParsedStoryContentCommand =
  | {
      domain: "characters";
      input: ReturnType<typeof parseCharacterManagementInput>;
    }
  | {
      domain: "locations";
      input: ReturnType<typeof parseLocationManagementInput>;
    }
  | {
      domain: "story_modules";
      input: ReturnType<typeof parseStoryModuleManagementInput>;
    }
  | {
      domain: "world_book";
      input: ReturnType<typeof parseWorldBookManagementInput>;
    }
  | {
      domain: "foreshadowing";
      input: ReturnType<typeof parsePlotThreadManagementInput>;
    }
  | {
      domain: "triggers";
      input: ReturnType<typeof parsePlotTriggerManagementInput>;
    }
  | {
      domain: "sources" | "memories";
      input: ContentAssetManagementInput;
    };

const domains = new Set<StoryContentDomain>([
  "characters",
  "locations",
  "story_modules",
  "world_book",
  "foreshadowing",
  "triggers",
  "sources",
  "memories",
]);

export class StoryContentInputError extends Error {
  public readonly issues: string[];
  public readonly domain?: StoryContentDomain;

  constructor(issues: string[], domain?: StoryContentDomain) {
    super(issues[0] ?? "剧本内容操作无效。");
    this.name = "StoryContentInputError";
    this.issues = issues;
    this.domain = domain;
  }
}

function object(value: unknown, issue: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StoryContentInputError([issue]);
  }
  return value as Record<string, unknown>;
}

function requiredText(
  value: unknown,
  label: string,
  maximumLength: number,
  issues: string[],
) {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${label}不能为空。`);
    return "";
  }
  const result = value.trim();
  if (result.length > maximumLength) {
    issues.push(`${label}不能超过 ${maximumLength} 个字符。`);
  }
  return result.slice(0, maximumLength);
}

function parseMemoryCommand(input: {
  actionId: string;
  sessionId: string;
  value: Record<string, unknown>;
}): ContentAssetManagementInput {
  const issues: string[] = [];
  const operation = input.value.operation;
  if (operation === "rollback") {
    const changeId = requiredText(input.value.changeId, "修改记录 ID", 240, issues);
    const reason = requiredText(input.value.reason, "撤销原因", 500, issues);
    if (issues.length > 0) throw new StoryContentInputError(issues, "memories");
    return {
      actionId: input.actionId,
      sessionId: input.sessionId,
      domain: "memories",
      operation,
      changeId,
      reason,
    };
  }
  if (operation === "update_entry") {
    const entryId = requiredText(input.value.entryId, "记忆 ID", 240, issues);
    const patchValue = object(
      input.value.patch,
      "剧情记忆修改内容必须是对象。",
    );
    const patch: Extract<
      ContentAssetManagementInput,
      { domain: "memories"; operation: "update_entry" }
    >["patch"] = {};
    if (patchValue.title !== undefined) {
      patch.title = requiredText(patchValue.title, "记忆标题", 120, issues);
    }
    if (patchValue.content !== undefined) {
      patch.content = requiredText(patchValue.content, "记忆正文", 4_000, issues);
    }
    if (patchValue.importance !== undefined) {
      if (
        typeof patchValue.importance !== "number" ||
        !Number.isFinite(patchValue.importance) ||
        patchValue.importance < 0 ||
        patchValue.importance > 100
      ) {
        issues.push("记忆重要度必须是 0 到 100 之间的数字。");
      } else {
        patch.importance = patchValue.importance;
      }
    }
    if (patchValue.status !== undefined) {
      if (patchValue.status !== "active" && patchValue.status !== "resolved") {
        issues.push("记忆状态必须是 active 或 resolved。");
      } else {
        patch.status = patchValue.status;
      }
    }
    for (const key of ["pinned", "enabled"] as const) {
      if (patchValue[key] === undefined) continue;
      if (typeof patchValue[key] !== "boolean") {
        issues.push(`${key === "pinned" ? "置顶" : "启用"}状态必须是布尔值。`);
      } else {
        patch[key] = patchValue[key];
      }
    }
    if (Object.keys(patch).length === 0) {
      issues.push("至少需要提供一项记忆修改内容。");
    }
    if (issues.length > 0) throw new StoryContentInputError(issues, "memories");
    return {
      actionId: input.actionId,
      sessionId: input.sessionId,
      domain: "memories",
      operation,
      entryId,
      patch,
    };
  }
  if (operation === "update_settings") {
    const settingsValue = object(
      input.value.settings,
      "剧情记忆设置必须是对象。",
    );
    const ranges = {
      memoryTokenBudget: [600, 8_000, "记忆预算"],
      recentTurnCount: [2, 12, "近期回合数"],
      chapterSize: [5, 20, "章节大小"],
    } as const;
    const settings = {
      memoryTokenBudget: 0,
      recentTurnCount: 0,
      chapterSize: 0,
    };
    for (const [key, [minimum, maximum, label]] of Object.entries(ranges) as [
      keyof typeof ranges,
      readonly [number, number, string],
    ][]) {
      const value = settingsValue[key];
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < minimum ||
        value > maximum
      ) {
        issues.push(`${label}必须是 ${minimum} 到 ${maximum} 之间的整数。`);
      } else {
        settings[key] = value;
      }
    }
    if (issues.length > 0) throw new StoryContentInputError(issues, "memories");
    return {
      actionId: input.actionId,
      sessionId: input.sessionId,
      domain: "memories",
      operation,
      settings,
    };
  }
  if (operation === "rebuild") {
    return {
      actionId: input.actionId,
      sessionId: input.sessionId,
      domain: "memories",
      operation,
    };
  }
  throw new StoryContentInputError(["不支持的剧情记忆操作。"], "memories");
}

export function parseStoryContentCommand(input: {
  sessionId: string;
  value: unknown;
}): ParsedStoryContentCommand {
  const envelope = object(input.value, "剧本内容请求必须是 JSON 对象。");
  const issues: string[] = [];
  if (envelope.schemaVersion !== STORY_CONTENT_SERVICE_SCHEMA_VERSION) {
    issues.push(
      `schemaVersion 必须是 ${STORY_CONTENT_SERVICE_SCHEMA_VERSION}。`,
    );
  }
  const actionId = requiredText(envelope.actionId, "actionId", 120, issues);
  const domain = envelope.domain;
  if (typeof domain !== "string" || !domains.has(domain as StoryContentDomain)) {
    issues.push("domain 必须是受支持的剧本内容类型。");
  }
  if (issues.length > 0) throw new StoryContentInputError(issues);
  const selectedDomain = domain as StoryContentDomain;
  const command = object(envelope.command, "command 必须是 JSON 对象。");

  try {
    switch (selectedDomain) {
      case "characters":
        return {
          domain: selectedDomain,
          input: parseCharacterManagementInput({
            sessionId: input.sessionId,
            value: { ...command, actionId },
          }),
        };
      case "locations":
        return {
          domain: selectedDomain,
          input: parseLocationManagementInput({
            sessionId: input.sessionId,
            value: { ...command, actionId },
          }),
        };
      case "story_modules":
        return {
          domain: selectedDomain,
          input: parseStoryModuleManagementInput({
            sessionId: input.sessionId,
            value: { ...command, actionId },
          }),
        };
      case "foreshadowing":
        return {
          domain: selectedDomain,
          input: parsePlotThreadManagementInput({
            sessionId: input.sessionId,
            value: { ...command, actionId },
          }),
        };
      case "triggers":
        return {
          domain: selectedDomain,
          input: parsePlotTriggerManagementInput({
            sessionId: input.sessionId,
            value: { ...command, actionId },
          }),
        };
      case "world_book":
        return {
          domain: selectedDomain,
          input: parseWorldBookManagementInput({
            sessionId: input.sessionId,
            value: { ...command, actionId },
          }),
        };
      case "sources": {
        if (command.operation === "rollback") {
          const sourceIssues: string[] = [];
          const changeId = requiredText(
            command.changeId,
            "修改记录 ID",
            240,
            sourceIssues,
          );
          const reason = requiredText(
            command.reason,
            "撤销原因",
            500,
            sourceIssues,
          );
          if (sourceIssues.length > 0) {
            throw new StoryContentInputError(sourceIssues, selectedDomain);
          }
          return {
            domain: selectedDomain,
            input: {
              actionId,
              sessionId: input.sessionId,
              domain: selectedDomain,
              operation: "rollback",
              changeId,
              reason,
            },
          };
        }
        if (command.operation === "import") {
          return {
            domain: selectedDomain,
            input: {
              actionId,
              sessionId: input.sessionId,
              domain: selectedDomain,
              operation: "import",
              document: parseSourceDocumentInput(command.document),
            },
          };
        }
        if (command.operation === "update") {
          const sourceIssues: string[] = [];
          const documentId = requiredText(
            command.documentId,
            "原文资料 ID",
            240,
            sourceIssues,
          );
          if (sourceIssues.length > 0) {
            throw new StoryContentInputError(sourceIssues, selectedDomain);
          }
          const settings = parseSourceDocumentSettings(command.settings);
          if (Object.keys(settings).length === 0) {
            throw new StoryContentInputError(
              ["至少需要提供一项原文参考设置。"],
              selectedDomain,
            );
          }
          return {
            domain: selectedDomain,
            input: {
              actionId,
              sessionId: input.sessionId,
              domain: selectedDomain,
              operation: "update",
              documentId,
              settings,
            },
          };
        }
        if (command.operation === "remove") {
          const sourceIssues: string[] = [];
          const documentId = requiredText(
            command.documentId,
            "原文资料 ID",
            240,
            sourceIssues,
          );
          if (sourceIssues.length > 0) {
            throw new StoryContentInputError(sourceIssues, selectedDomain);
          }
          return {
            domain: selectedDomain,
            input: {
              actionId,
              sessionId: input.sessionId,
              domain: selectedDomain,
              operation: "remove",
              documentId,
            },
          };
        }
        throw new StoryContentInputError(
          ["不支持的原文参考操作。"],
          selectedDomain,
        );
      }
      case "memories":
        return {
          domain: selectedDomain,
          input: parseMemoryCommand({
            actionId,
            sessionId: input.sessionId,
            value: command,
          }),
        };
    }
  } catch (error) {
    if (
      error instanceof CharacterManagementInputError ||
      error instanceof LocationManagementInputError ||
      error instanceof StoryModuleManagementInputError ||
      error instanceof PlotElementManagementInputError ||
      error instanceof WorldBookManagementInputError ||
      error instanceof SourceReferenceInputError
    ) {
      throw new StoryContentInputError(error.issues, selectedDomain);
    }
    throw error;
  }
}

function loadSnapshot(
  store: LocalStoryStore,
  sessionId: string,
): StoryContentSnapshot {
  return {
    adventure: store.loadAdventure(sessionId),
    sourceDocuments: store.listSourceDocuments(sessionId),
    memory: store.loadStoryMemory(sessionId),
  };
}

export function loadStoryContentWorkspace(input: {
  store: LocalStoryStore;
  sessionId: string;
  includeAudit?: boolean;
}): StoryContentWorkspaceResponse {
  return {
    schemaVersion: STORY_CONTENT_SERVICE_SCHEMA_VERSION,
    content: loadSnapshot(input.store, input.sessionId),
    ...(input.includeAudit === false
      ? {}
      : {
          audit: {
            state: input.store.loadStateAudit(input.sessionId),
            assets: input.store.listContentAssetManagementChanges(
              input.sessionId,
            ),
          },
        }),
  };
}

export function executeStoryContentCommand(input: {
  store: LocalStoryStore;
  sessionId: string;
  value: unknown;
}): StoryContentCommandResponse {
  const command = parseStoryContentCommand({
    sessionId: input.sessionId,
    value: input.value,
  });
  let result: StoryContentCommandResult;

  switch (command.domain) {
    case "characters": {
      const managed = input.store.manageCharacter(command.input);
      result = {
        actionId: managed.actionId,
        domain: command.domain,
        operation: managed.operation,
        targetId: managed.characterId,
        reused: managed.reused,
      };
      break;
    }
    case "locations": {
      const managed = input.store.manageLocation(command.input);
      result = {
        actionId: managed.actionId,
        domain: command.domain,
        operation: managed.operation,
        targetId: managed.locationId,
        reused: managed.reused,
      };
      break;
    }
    case "story_modules": {
      const managed = input.store.manageStoryModule(command.input);
      result = {
        actionId: managed.actionId,
        domain: command.domain,
        operation: managed.operation,
        targetId: managed.moduleId,
        reused: managed.reused,
      };
      break;
    }
    case "foreshadowing": {
      const managed = input.store.managePlotThread(command.input);
      result = {
        actionId: managed.actionId,
        domain: command.domain,
        operation: managed.operation,
        targetId: managed.threadId,
        reused: managed.reused,
      };
      break;
    }
    case "triggers": {
      const managed = input.store.managePlotTrigger(command.input);
      result = {
        actionId: managed.actionId,
        domain: command.domain,
        operation: managed.operation,
        targetId: managed.triggerId,
        reused: managed.reused,
      };
      break;
    }
    case "world_book": {
      const managed = input.store.manageWorldBook(command.input);
      result = {
        actionId: managed.actionId,
        domain: command.domain,
        operation: managed.operation,
        targetId: managed.entryId,
        reused: managed.reused,
      };
      break;
    }
    case "sources":
    case "memories": {
      const managed = input.store.manageContentAsset(command.input);
      result = {
        actionId: managed.actionId,
        domain: command.domain,
        operation: managed.operation,
        targetId: managed.targetId,
        reused: managed.reused,
      };
      break;
    }
  }

  return {
    schemaVersion: STORY_CONTENT_SERVICE_SCHEMA_VERSION,
    result,
    content: loadSnapshot(input.store, input.sessionId),
  };
}

export function isStoryContentManagementError(error: unknown) {
  return (
    error instanceof CharacterManagementError ||
    error instanceof LocationManagementError ||
    error instanceof StoryModuleManagementError ||
    error instanceof PlotThreadManagementError ||
    error instanceof PlotTriggerManagementError ||
    error instanceof WorldBookManagementError ||
    error instanceof ContentAssetManagementError ||
    error instanceof SourceReferenceInputError
  );
}

export function storyContentErrorBody(input: {
  code: string;
  message: string;
  issues?: string[];
  domain?: StoryContentDomain;
}) {
  return {
    schemaVersion: STORY_CONTENT_SERVICE_SCHEMA_VERSION,
    error: {
      code: input.code,
      message: input.message,
      ...(input.domain ? { domain: input.domain } : {}),
      ...(input.issues ? { issues: input.issues } : {}),
    },
  };
}
