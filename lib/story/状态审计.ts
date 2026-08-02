import type {
  StateAuditControlInput,
  StateEntityType,
} from "@/lib/storage/story-store";

const entityTypes = new Set<StateEntityType>([
  "character_card",
  "character_state",
  "character_card_evolution",
  "world_book_entry",
  "relationship",
  "story_direction",
  "story_module",
  "location",
  "session_state",
]);

export class StateAuditInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "状态审计请求无效。");
    this.name = "StateAuditInputError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(
  value: unknown,
  label: string,
  issues: string[],
  maximumLength = 160,
) {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${label}不能为空。`);
    return "";
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    issues.push(`${label}不能超过 ${maximumLength} 个字符。`);
  }
  return normalized.slice(0, maximumLength);
}

export function parseStateAuditControlInput(input: {
  sessionId: string;
  value: unknown;
}): StateAuditControlInput {
  if (!isRecord(input.value)) {
    throw new StateAuditInputError(["状态审计请求必须使用 JSON 对象格式。"]);
  }
  const issues: string[] = [];
  const actionId = text(input.value.actionId, "操作标识", issues);
  const reason = text(input.value.reason, "操作原因", issues, 500);
  const operation = input.value.operation;
  if (operation === "rollback") {
    const changeId = text(input.value.changeId, "状态变化标识", issues);
    if (issues.length > 0) throw new StateAuditInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      changeId,
      reason,
    };
  }
  if (operation === "set_lock") {
    const entityType = input.value.entityType as StateEntityType;
    if (!entityTypes.has(entityType)) issues.push("状态实体类型无效。");
    const entityId = text(input.value.entityId, "状态实体标识", issues);
    const fieldPath = text(input.value.fieldPath, "字段路径", issues, 500);
    if (
      fieldPath &&
      fieldPath !== "*" &&
      fieldPath !== "$active" &&
      !/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/.test(fieldPath)
    ) {
      issues.push("字段路径必须是有效的 JSON Pointer，或使用 *、$active。");
    }
    if (typeof input.value.locked !== "boolean") {
      issues.push("锁定状态必须是布尔值。");
    }
    if (issues.length > 0) throw new StateAuditInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      entityType,
      entityId,
      fieldPath,
      locked: input.value.locked as boolean,
      reason,
    };
  }
  throw new StateAuditInputError(["状态审计操作无效。"]);
}
