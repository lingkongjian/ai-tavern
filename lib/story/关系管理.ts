import type {
  RelationshipManagementInput,
} from "@/lib/storage/story-store";
import { RELATIONSHIP_TYPES } from "./回合协议.ts";

const limits = {
  id: 120,
  summary: 500,
} as const;

/** 关系维度公开字段名（协议/剧本包/工作台统一）：affection 在存储边界转为 affinity。 */
const RELATIONSHIP_DIMENSIONS = [
  "trust",
  "affection",
  "fear",
  "hostility",
  "respect",
] as const;

export class RelationshipManagementInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "关系管理请求无效。");
    this.name = "RelationshipManagementInputError";
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

function dimensionNumber(
  value: unknown,
  label: string,
  issues: string[],
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${label}必须是 -100 到 100 之间的数字。`);
    return 0;
  }
  if (value < -100 || value > 100) {
    issues.push(`${label}必须在 -100 到 100 之间。`);
    return 0;
  }
  return value;
}

/**
 * 解析关系手动修改请求（内容服务 relationships domain 的唯一操作 update）。
 * 静态校验不依赖数据库；角色存在性由 story-store.manageRelationship 复核。
 */
export function parseRelationshipManagementInput(input: {
  sessionId: string;
  value: unknown;
}): RelationshipManagementInput {
  if (!isRecord(input.value)) {
    throw new RelationshipManagementInputError(["请求内容必须是 JSON 对象。"]);
  }

  const issues: string[] = [];
  const actionId = requiredText(
    input.value.actionId,
    "关系管理请求标识",
    limits.id,
    issues,
  );
  if (input.value.operation !== "update") {
    issues.push("关系管理操作无效。");
  }

  const sourceCharacterId = requiredText(
    input.value.sourceCharacterId,
    "关系起点角色 ID",
    limits.id,
    issues,
  );
  const targetCharacterId = requiredText(
    input.value.targetCharacterId,
    "关系终点角色 ID",
    limits.id,
    issues,
  );
  if (sourceCharacterId && targetCharacterId && sourceCharacterId === targetCharacterId) {
    issues.push("关系起止角色不能是同一个角色。");
  }

  const dimensions: Exclude<
    RelationshipManagementInput["dimensions"],
    undefined
  > = {};
  if (input.value.dimensions !== undefined) {
    if (!isRecord(input.value.dimensions)) {
      issues.push("关系维度必须是对象。");
    } else {
      for (const key of Object.keys(input.value.dimensions)) {
        if (!RELATIONSHIP_DIMENSIONS.includes(key as (typeof RELATIONSHIP_DIMENSIONS)[number])) {
          issues.push(`关系维度 ${key} 不受支持。`);
          continue;
        }
        const label =
          key === "affection"
            ? "好感"
            : key === "trust"
              ? "信任"
              : key === "fear"
                ? "恐惧"
                : key === "hostility"
                  ? "敌意"
                  : "敬意";
        dimensions[key as keyof typeof dimensions] = dimensionNumber(
          input.value.dimensions[key],
          label,
          issues,
        );
      }
    }
  }

  let relationshipType: RelationshipManagementInput["relationshipType"];
  if (input.value.relationshipType !== undefined) {
    if (
      typeof input.value.relationshipType !== "string" ||
      !RELATIONSHIP_TYPES.includes(
        input.value.relationshipType as (typeof RELATIONSHIP_TYPES)[number],
      )
    ) {
      issues.push(
        `关系类型必须是 ${RELATIONSHIP_TYPES.join("、")} 之一。`,
      );
    } else {
      relationshipType = input.value.relationshipType as RelationshipManagementInput["relationshipType"];
    }
  }

  let summary: string | undefined;
  if (input.value.summary !== undefined && input.value.summary !== null) {
    summary = requiredText(input.value.summary, "关系描述", limits.summary, issues);
  }

  let syncReverse: boolean | undefined;
  if (input.value.syncReverse !== undefined) {
    if (typeof input.value.syncReverse !== "boolean") {
      issues.push("同步反向数值必须是布尔值。");
    } else {
      syncReverse = input.value.syncReverse;
    }
  }

  if (
    Object.keys(dimensions).length === 0 &&
    relationshipType === undefined &&
    summary === undefined
  ) {
    issues.push("至少需要修改一项关系内容（维度、类型或描述）。");
  }

  if (issues.length > 0) throw new RelationshipManagementInputError(issues);
  return {
    actionId,
    sessionId: input.sessionId,
    operation: "update",
    sourceCharacterId,
    targetCharacterId,
    ...(Object.keys(dimensions).length > 0 ? { dimensions } : {}),
    ...(relationshipType !== undefined ? { relationshipType } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(syncReverse !== undefined ? { syncReverse } : {}),
  };
}
