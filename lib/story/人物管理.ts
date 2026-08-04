import type {
  AdventureCharacterInput,
  CharacterManagementInput,
  CharacterRestriction,
  JsonValue,
} from "@/lib/storage/story-store";
import {
  RESTRICTION_KINDS,
  validateStatusesArray,
} from "./回合协议.ts";

const limits = {
  id: 120,
  name: 80,
  detail: 2_000,
} as const;

export class CharacterManagementInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "人物管理请求无效。");
    this.name = "CharacterManagementInputError";
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

function readCharacter(value: unknown, issues: string[]): AdventureCharacterInput {
  if (!isRecord(value)) {
    issues.push("角色资料格式无效。");
    return { name: "", role: "", personality: "", firstMessage: "" };
  }
  return {
    name: requiredText(value.name, "角色姓名", limits.name, issues),
    role: requiredText(value.role, "角色身份与背景", limits.detail, issues),
    personality: requiredText(
      value.personality,
      "角色性格与行为边界",
      limits.detail,
      issues,
    ),
    firstMessage: optionalText(
      value.firstMessage,
      "角色开场台词",
      limits.detail,
      issues,
    ),
  };
}

export function parseCharacterManagementInput(input: {
  sessionId: string;
  value: unknown;
}): CharacterManagementInput {
  if (!isRecord(input.value)) {
    throw new CharacterManagementInputError(["请求内容必须是 JSON 对象。"]);
  }

  const issues: string[] = [];
  const actionId = requiredText(
    input.value.actionId,
    "人物管理请求标识",
    limits.id,
    issues,
  );
  const operation = input.value.operation;
  if (
    operation !== "create" &&
    operation !== "update" &&
    operation !== "set_presence" &&
    operation !== "set_active" &&
    operation !== "set_restriction" &&
    operation !== "set_statuses"
  ) {
    issues.push("人物管理操作无效。");
  }

  if (operation === "create") {
    const character = readCharacter(input.value.character, issues);
    if (issues.length > 0) throw new CharacterManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      character,
    };
  }

  const characterId = requiredText(
    input.value.characterId,
    "角色 ID",
    limits.id,
    issues,
  );
  if (operation === "update") {
    const character = readCharacter(input.value.character, issues);
    if (issues.length > 0) throw new CharacterManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      characterId,
      character,
    };
  }
  if (operation === "set_presence") {
    if (typeof input.value.present !== "boolean") {
      issues.push("在场状态必须是布尔值。");
    }
    if (issues.length > 0) throw new CharacterManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      characterId,
      present: input.value.present as boolean,
    };
  }
  if (operation === "set_active") {
    if (typeof input.value.active !== "boolean") {
      issues.push("启用状态必须是布尔值。");
    }
    if (issues.length > 0) throw new CharacterManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      characterId,
      active: input.value.active as boolean,
    };
  }
  if (operation === "set_restriction") {
    let restriction: CharacterRestriction | null = null;
    if (input.value.restriction !== null && input.value.restriction !== undefined) {
      if (!isRecord(input.value.restriction)) {
        issues.push("行动受限状态必须是对象或 null。");
      } else {
        const kind = input.value.restriction.kind;
        if (
          typeof kind !== "string" ||
          !RESTRICTION_KINDS.includes(kind as (typeof RESTRICTION_KINDS)[number])
        ) {
          issues.push(`受限类型必须是 ${RESTRICTION_KINDS.join("、")} 之一。`);
        }
        const summary = requiredText(
          input.value.restriction.summary,
          "受限原因",
          200,
          issues,
        );
        restriction = {
          kind: (kind as CharacterRestriction["kind"]) ?? "other",
          summary,
        };
      }
    }
    if (issues.length > 0) throw new CharacterManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      characterId,
      restriction,
    };
  }
  if (operation === "set_statuses") {
    if (input.value.statuses === undefined) {
      issues.push("状态词条不能为空；清除全部请传 null。");
    }
    const statuses = validateStatusesArray(
      input.value.statuses as JsonValue | undefined,
      "状态词条",
      issues,
    );
    if (issues.length > 0) throw new CharacterManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      characterId,
      statuses,
    };
  }

  throw new CharacterManagementInputError(issues);
}
