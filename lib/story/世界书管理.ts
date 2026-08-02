import type {
  AdventureWorldBookEntryInput,
  JsonObject,
  WorldBookManagementInput,
} from "@/lib/storage/story-store";

const limits = {
  id: 120,
  comment: 300,
  key: 120,
  keys: 30,
  content: 12_000,
  extensions: 10_000,
} as const;

export class WorldBookManagementInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "世界书管理请求无效。");
    this.name = "WorldBookManagementInputError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  const trimmed = value.trim();
  if (trimmed.length > maximumLength) {
    issues.push(`${label}不能超过 ${maximumLength} 个字符。`);
  }
  return trimmed.slice(0, maximumLength);
}

function optionalText(
  value: unknown,
  label: string,
  maximumLength: number,
  issues: string[],
) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    issues.push(`${label}必须是文本。`);
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length > maximumLength) {
    issues.push(`${label}不能超过 ${maximumLength} 个字符。`);
  }
  return trimmed.slice(0, maximumLength);
}

function readBoolean(
  value: unknown,
  fallback: boolean,
  label: string,
  issues: string[],
) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    issues.push(`${label}必须是布尔值。`);
    return fallback;
  }
  return value;
}

function readInteger(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
  issues: string[],
) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    issues.push(`${label}必须是 ${minimum} 到 ${maximum} 之间的整数。`);
    return fallback;
  }
  return Number(value);
}

function readKeys(value: unknown, label: string, issues: string[]) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${label}必须是文本数组。`);
    return [];
  }
  if (value.length > limits.keys) {
    issues.push(`${label}最多包含 ${limits.keys} 项。`);
  }
  const keys: string[] = [];
  for (const [index, item] of value.slice(0, limits.keys).entries()) {
    if (typeof item !== "string" || !item.trim()) {
      issues.push(`${label}第 ${index + 1} 项不能为空。`);
      continue;
    }
    const key = item.trim();
    if (key.length > limits.key) {
      issues.push(`${label}第 ${index + 1} 项不能超过 ${limits.key} 个字符。`);
    }
    if (!keys.includes(key)) keys.push(key.slice(0, limits.key));
  }
  return keys;
}

function readEntry(value: unknown, issues: string[]): AdventureWorldBookEntryInput {
  if (!isRecord(value)) {
    issues.push("世界书条目格式无效。");
    return { keys: [], content: "", enabled: true };
  }
  const keys = readKeys(value.keys, "主要触发词", issues);
  const secondaryKeys = readKeys(value.secondaryKeys, "次要触发词", issues);
  const content = requiredText(value.content, "世界书正文", limits.content, issues);
  const constant = readBoolean(value.constant, false, "常驻状态", issues);
  const selective = readBoolean(value.selective, false, "选择性匹配状态", issues);
  if (!constant && keys.length === 0) {
    issues.push("非常驻条目至少需要一个主要触发词。");
  }
  const position = value.position ?? "before_char";
  if (position !== "before_char" && position !== "after_char") {
    issues.push("注入位置只能是角色卡之前或之后。");
  }
  let extensions: JsonObject = {};
  if (value.extensions !== undefined) {
    if (!isRecord(value.extensions)) {
      issues.push("扩展字段必须是 JSON 对象。");
    } else {
      try {
        const serialized = JSON.stringify(value.extensions);
        if (serialized.length > limits.extensions) {
          issues.push(`扩展字段不能超过 ${limits.extensions} 个字符。`);
        } else {
          extensions = structuredClone(value.extensions) as JsonObject;
        }
      } catch {
        issues.push("扩展字段必须能序列化为 JSON。");
      }
    }
  }
  return {
    comment: optionalText(value.comment, "条目名称", limits.comment, issues),
    keys,
    secondaryKeys,
    content,
    enabled: readBoolean(value.enabled, true, "启用状态", issues),
    constant,
    selective,
    position: position === "after_char" ? "after_char" : "before_char",
    order: readInteger(value.order, 100, "排序值", -10_000, 10_000, issues),
    probability: readInteger(value.probability, 100, "触发概率", 0, 100, issues),
    depth: readInteger(value.depth, 4, "扫描深度", 0, 999, issues),
    extensions,
  };
}

export function parseWorldBookManagementInput(input: {
  sessionId: string;
  value: unknown;
}): WorldBookManagementInput {
  if (!isRecord(input.value)) {
    throw new WorldBookManagementInputError(["请求内容必须是 JSON 对象。"]);
  }
  const issues: string[] = [];
  const actionId = requiredText(
    input.value.actionId,
    "世界书管理请求标识",
    limits.id,
    issues,
  );
  const operation = input.value.operation;
  if (
    operation !== "create" &&
    operation !== "update" &&
    operation !== "set_enabled" &&
    operation !== "remove" &&
    operation !== "restore_base"
  ) {
    issues.push("世界书管理操作无效。");
  }
  if (operation === "create") {
    const entry = readEntry(input.value.entry, issues);
    if (issues.length) throw new WorldBookManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, entry };
  }
  const entryId = requiredText(
    input.value.entryId,
    "世界书条目 ID",
    limits.id,
    issues,
  );
  if (operation === "update") {
    const entry = readEntry(input.value.entry, issues);
    if (issues.length) throw new WorldBookManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, entryId, entry };
  }
  if (operation === "set_enabled") {
    if (typeof input.value.enabled !== "boolean") {
      issues.push("启用状态必须是布尔值。");
    }
    if (issues.length) throw new WorldBookManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      entryId,
      enabled: input.value.enabled as boolean,
    };
  }
  if (operation === "remove" || operation === "restore_base") {
    if (issues.length) throw new WorldBookManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, entryId };
  }
  throw new WorldBookManagementInputError(issues);
}
