import type {
  AdventureForeshadowingInput,
  AdventureTriggerInput,
  PlotThreadManagementInput,
  PlotTriggerManagementInput,
} from "@/lib/storage/story-store";
import {
  ATTRIBUTE_WHITELIST,
  isAttributeName,
} from "./判定服务.ts";

const limits = {
  id: 80,
  text: 1_000,
  longText: 4_000,
  listItem: 80,
  keywords: 20,
  characters: 20,
  relations: 30,
  attributes: 30,
  flags: 10,
} as const;

export class PlotElementManagementInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "伏笔或偏离触发器管理请求无效。");
    this.name = "PlotElementManagementInputError";
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
  const result = value.trim();
  if (result.length > maximumLength) {
    issues.push(`${label}不能超过 ${maximumLength} 个字符。`);
  }
  return result.slice(0, maximumLength);
}

function textList(
  value: unknown,
  label: string,
  maximumItems: number,
  issues: string[],
  required = false,
) {
  if (!Array.isArray(value)) {
    issues.push(`${label}必须是文本数组。`);
    return [];
  }
  if (value.length > maximumItems) {
    issues.push(`${label}最多允许 ${maximumItems} 项。`);
  }
  const result = value.slice(0, maximumItems).flatMap((item, index) => {
    const entry = requiredText(
      item,
      `${label}第 ${index + 1} 项`,
      limits.listItem,
      issues,
    );
    return entry ? [entry] : [];
  });
  if (required && result.length === 0) issues.push(`${label}至少需要一项。`);
  if (new Set(result).size !== result.length) {
    issues.push(`${label}不能包含重复项。`);
  }
  return result;
}

function readThread(
  value: unknown,
  issues: string[],
): AdventureForeshadowingInput {
  if (!isRecord(value)) {
    issues.push("伏笔资料格式无效。");
    return { id: "", keywords: [], seedCondition: "", payoffCondition: "", payoffSummary: "" };
  }
  const id = requiredText(value.id, "伏笔 ID", limits.id, issues);
  if (id && !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id)) {
    issues.push("伏笔 ID 只能包含文字、数字、点、下划线和连字符。");
  }
  return {
    id,
    keywords: textList(value.keywords, "伏笔关键词", limits.keywords, issues, true),
    seedCondition: requiredText(
      value.seedCondition,
      "伏笔出现条件",
      limits.text,
      issues,
    ),
    payoffCondition: requiredText(
      value.payoffCondition,
      "伏笔回收条件",
      limits.text,
      issues,
    ),
    payoffSummary: requiredText(
      value.payoffSummary,
      "伏笔回收概要",
      limits.longText,
      issues,
    ),
    characters:
      value.characters === undefined
        ? []
        : textList(
            value.characters,
            "相关角色",
            limits.characters,
            issues,
          ),
  };
}

function readTrigger(
  value: unknown,
  issues: string[],
): AdventureTriggerInput {
  if (!isRecord(value)) {
    issues.push("偏离触发器资料格式无效。");
    return { id: "", when: "", consequence: "" };
  }
  const id = requiredText(value.id, "触发器 ID", limits.id, issues);
  if (id && !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id)) {
    issues.push("触发器 ID 只能包含文字、数字、点、下划线和连字符。");
  }
  const stateEffectsSource = value.stateEffects;
  const stateEffects: AdventureTriggerInput["stateEffects"] = {};
  if (stateEffectsSource !== undefined) {
    if (!isRecord(stateEffectsSource)) {
      issues.push("触发器状态影响必须是对象。");
    } else {
      if (stateEffectsSource.relations !== undefined) {
        if (!Array.isArray(stateEffectsSource.relations)) {
          issues.push("触发器关系影响必须是数组。");
        } else {
          const relations: NonNullable<typeof stateEffects.relations> = [];
          stateEffectsSource.relations
            .slice(0, limits.relations)
            .forEach((relation, index) => {
              if (!isRecord(relation)) {
                issues.push(`关系影响第 ${index + 1} 项格式无效。`);
                return;
              }
              const sourceCharacterName = requiredText(
                relation.sourceCharacterName,
                `关系影响第 ${index + 1} 项源角色名`,
                limits.listItem,
                issues,
              );
              const targetCharacterName = requiredText(
                relation.targetCharacterName,
                `关系影响第 ${index + 1} 项目标角色名`,
                limits.listItem,
                issues,
              );
              const dimension = requiredText(
                relation.dimension,
                `关系影响第 ${index + 1} 项维度`,
                80,
                issues,
              );
              if (
                dimension &&
                !["trust", "affection", "fear", "hostility", "respect"].includes(
                  dimension,
                )
              ) {
                issues.push(
                  `关系影响维度必须是 trust、affection、fear、hostility 或 respect。`,
                );
              }
              const rawDelta = relation.delta;
              if (
                typeof rawDelta !== "number" ||
                !Number.isFinite(rawDelta) ||
                rawDelta < -100 ||
                rawDelta > 100
              ) {
                issues.push(`关系影响 delta 必须是 -100 到 100 之间的数值。`);
              }
              if (
                sourceCharacterName &&
                targetCharacterName &&
                dimension &&
                typeof rawDelta === "number"
              ) {
                relations.push({
                  sourceCharacterName,
                  targetCharacterName,
                  dimension: dimension as "trust",
                  delta: rawDelta,
                });
              }
            });
          if (relations.length > 0) stateEffects.relations = relations;
        }
      }
      if (stateEffectsSource.flags !== undefined) {
        if (!Array.isArray(stateEffectsSource.flags)) {
          issues.push("触发器标志必须是数组。");
        } else {
          const flags = stateEffectsSource.flags
            .slice(0, limits.flags)
            .flatMap((flag, index) => {
              if (typeof flag !== "string" || !flag.trim()) {
                issues.push(`触发器标志第 ${index + 1} 项必须是文本。`);
                return [];
              }
              return [flag.trim().slice(0, 50)];
            });
          if (flags.length > 0) stateEffects.flags = flags;
        }
      }
      if (stateEffectsSource.attributes !== undefined) {
        if (!Array.isArray(stateEffectsSource.attributes)) {
          issues.push("触发器属性影响必须是数组。");
        } else {
          const attributes: NonNullable<typeof stateEffects.attributes> = [];
          stateEffectsSource.attributes
            .slice(0, limits.attributes)
            .forEach((attributeEffect, index) => {
              if (!isRecord(attributeEffect)) {
                issues.push(`属性影响第 ${index + 1} 项格式无效。`);
                return;
              }
              const characterName = requiredText(
                attributeEffect.characterName,
                `属性影响第 ${index + 1} 项角色名`,
                limits.listItem,
                issues,
              );
              const attribute = requiredText(
                attributeEffect.attribute,
                `属性影响第 ${index + 1} 项属性`,
                80,
                issues,
              );
              if (attribute && !isAttributeName(attribute)) {
                issues.push(
                  `属性“${attribute}”不在白名单中（允许：${ATTRIBUTE_WHITELIST.join("、")}）。`,
                );
              }
              const rawValue = attributeEffect.value;
              if (
                typeof rawValue !== "number" ||
                !Number.isFinite(rawValue) ||
                rawValue < 0 ||
                rawValue > 100
              ) {
                issues.push(`属性值必须是 0 到 100 之间的数值。`);
              }
              if (characterName && attribute && typeof rawValue === "number") {
                attributes.push({ characterName, attribute, value: rawValue });
              }
            });
          if (attributes.length > 0) stateEffects.attributes = attributes;
        }
      }
    }
  }
  let deadlineDay: number | undefined;
  if (value.deadlineDay !== undefined && value.deadlineDay !== 0) {
    if (
      typeof value.deadlineDay !== "number" ||
      !Number.isInteger(value.deadlineDay) ||
      value.deadlineDay < 1 ||
      value.deadlineDay > 10_000
    ) {
      issues.push("触发器期限必须是 1 到 10000 之间的整数。");
    } else {
      deadlineDay = value.deadlineDay;
    }
  }
  return {
    id,
    when: requiredText(value.when, "触发器条件", limits.text, issues),
    consequence: requiredText(
      value.consequence,
      "触发器后果",
      limits.longText,
      issues,
    ),
    ...(Object.keys(stateEffects).length > 0 ? { stateEffects } : {}),
    ...(deadlineDay !== undefined ? { deadlineDay } : {}),
  };
}

export function parsePlotThreadManagementInput(input: {
  sessionId: string;
  value: unknown;
}): PlotThreadManagementInput {
  if (!isRecord(input.value)) {
    throw new PlotElementManagementInputError([
      "管理请求必须使用 JSON 对象格式",
    ]);
  }
  const issues: string[] = [];
  const actionId = requiredText(
    input.value.actionId,
    "伏笔管理请求标识",
    limits.id,
    issues,
  );
  const operation = input.value.operation;
  if (operation !== "create" && operation !== "update" && operation !== "delete") {
    issues.push("伏笔管理操作无效。");
  }
  if (operation === "create") {
    const thread = readThread(input.value.thread, issues);
    if (issues.length > 0) throw new PlotElementManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, thread };
  }
  const threadId = requiredText(
    input.value.threadId,
    "伏笔 ID",
    limits.id,
    issues,
  );
  if (operation === "update") {
    const thread = readThread(input.value.thread, issues);
    if (thread.id && thread.id !== threadId) {
      issues.push("编辑伏笔时不能修改伏笔 ID。");
    }
    if (issues.length > 0) throw new PlotElementManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, threadId, thread };
  }
  if (operation === "delete") {
    if (issues.length > 0) throw new PlotElementManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, threadId };
  }
  throw new PlotElementManagementInputError(issues);
}

export function parsePlotTriggerManagementInput(input: {
  sessionId: string;
  value: unknown;
}): PlotTriggerManagementInput {
  if (!isRecord(input.value)) {
    throw new PlotElementManagementInputError([
      "管理请求必须使用 JSON 对象格式",
    ]);
  }
  const issues: string[] = [];
  const actionId = requiredText(
    input.value.actionId,
    "偏离触发器管理请求标识",
    limits.id,
    issues,
  );
  const operation = input.value.operation;
  if (operation !== "create" && operation !== "update" && operation !== "delete") {
    issues.push("偏离触发器管理操作无效。");
  }
  if (operation === "create") {
    const trigger = readTrigger(input.value.trigger, issues);
    if (issues.length > 0) throw new PlotElementManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, trigger };
  }
  const triggerId = requiredText(
    input.value.triggerId,
    "触发器 ID",
    limits.id,
    issues,
  );
  if (operation === "update") {
    const trigger = readTrigger(input.value.trigger, issues);
    if (trigger.id && trigger.id !== triggerId) {
      issues.push("编辑触发器时不能修改触发器 ID。");
    }
    if (issues.length > 0) throw new PlotElementManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, triggerId, trigger };
  }
  if (operation === "delete") {
    if (issues.length > 0) throw new PlotElementManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, triggerId };
  }
  throw new PlotElementManagementInputError(issues);
}
