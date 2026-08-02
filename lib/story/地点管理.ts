import type {
  AdventureLocationInput,
  LocationManagementInput,
} from "@/lib/storage/story-store";

const limits = {
  id: 120,
  name: 80,
  description: 2_000,
  characters: 80,
} as const;

export class LocationManagementInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "地点管理请求无效。");
    this.name = "LocationManagementInputError";
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

function readLocation(value: unknown, issues: string[]): AdventureLocationInput {
  if (!isRecord(value)) {
    issues.push("地点资料格式无效。");
    return { name: "", description: "", defaultCharacterIds: [] };
  }
  const defaultCharacterIds = Array.isArray(value.defaultCharacterIds)
    ? value.defaultCharacterIds
        .map((characterId, index) =>
          requiredText(
            characterId,
            `默认登场人物 ${index + 1}`,
            limits.id,
            issues,
          ),
        )
        .filter(Boolean)
    : [];
  if (defaultCharacterIds.length > limits.characters) {
    issues.push(`默认登场人物不能超过 ${limits.characters} 名。`);
  }
  if (new Set(defaultCharacterIds).size !== defaultCharacterIds.length) {
    issues.push("默认登场人物不能重复。");
  }
  return {
    name: requiredText(value.name, "地点名称", limits.name, issues),
    description: requiredText(
      value.description,
      "地点描述",
      limits.description,
      issues,
    ),
    defaultCharacterIds: defaultCharacterIds.slice(0, limits.characters),
  };
}

export function parseLocationManagementInput(input: {
  sessionId: string;
  value: unknown;
}): LocationManagementInput {
  if (!isRecord(input.value)) {
    throw new LocationManagementInputError(["请求内容必须是 JSON 对象。"]);
  }

  const issues: string[] = [];
  const actionId = requiredText(
    input.value.actionId,
    "地点管理请求标识",
    limits.id,
    issues,
  );
  const operation = input.value.operation;
  if (
    operation !== "create" &&
    operation !== "update" &&
    operation !== "set_current" &&
    operation !== "set_active"
  ) {
    issues.push("地点管理操作无效。");
  }

  if (operation === "create") {
    const location = readLocation(input.value.location, issues);
    if (issues.length > 0) throw new LocationManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, location };
  }

  const locationId = requiredText(
    input.value.locationId,
    "地点 ID",
    limits.id,
    issues,
  );
  if (operation === "update") {
    const location = readLocation(input.value.location, issues);
    if (issues.length > 0) throw new LocationManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, locationId, location };
  }
  if (operation === "set_current") {
    if (issues.length > 0) throw new LocationManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, locationId };
  }
  if (operation === "set_active") {
    if (typeof input.value.active !== "boolean") {
      issues.push("启用状态必须是布尔值。");
    }
    if (issues.length > 0) throw new LocationManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      locationId,
      active: input.value.active as boolean,
    };
  }

  throw new LocationManagementInputError(issues);
}
