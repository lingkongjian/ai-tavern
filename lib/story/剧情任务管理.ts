import type {
  AdventureStoryModuleInput,
  StoryModuleManagementInput,
} from "@/lib/storage/story-store";

const limits = {
  id: 120,
  title: 120,
  objective: 1_000,
  note: 2_000,
  listItem: 500,
  criteria: 12,
  prerequisites: 20,
} as const;

export class StoryModuleManagementInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "剧情任务管理请求无效。");
    this.name = "StoryModuleManagementInputError";
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
  if (new Set(result).size !== result.length) issues.push(`${label}不能包含重复项。`);
  return result;
}

function readModule(
  value: unknown,
  issues: string[],
): AdventureStoryModuleInput {
  if (!isRecord(value)) {
    issues.push("剧情任务资料格式无效。");
    return { id: "", title: "", objective: "", completionCriteria: [] };
  }
  const id = requiredText(value.id, "剧情任务 ID", limits.id, issues);
  if (id && !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id)) {
    issues.push("剧情任务 ID 只能包含文字、数字、点、下划线和连字符。");
  }
  if (value.autoContinue !== undefined && typeof value.autoContinue !== "boolean") {
    issues.push("自动接续状态必须是布尔值。");
  }
  return {
    id,
    title: requiredText(value.title, "剧情任务标题", limits.title, issues),
    objective: requiredText(
      value.objective,
      "剧情任务目标",
      limits.objective,
      issues,
    ),
    completionCriteria: textList(
      value.completionCriteria,
      "完成条件",
      limits.criteria,
      issues,
      true,
    ),
    activationConditions:
      value.activationConditions === undefined
        ? []
        : textList(
            value.activationConditions,
            "进入条件",
            limits.criteria,
            issues,
          ),
    prerequisiteModuleIds:
      value.prerequisiteModuleIds === undefined
        ? []
        : textList(
            value.prerequisiteModuleIds,
            "前置任务",
            limits.prerequisites,
            issues,
          ),
    continuityNotes: optionalText(
      value.continuityNotes,
      "连续性说明",
      limits.note,
      issues,
    ),
    autoContinue: value.autoContinue !== false,
  };
}

export function parseStoryModuleManagementInput(input: {
  sessionId: string;
  value: unknown;
}): StoryModuleManagementInput {
  if (!isRecord(input.value)) {
    throw new StoryModuleManagementInputError(["管理请求必须使用 JSON 对象格式"]);
  }
  const issues: string[] = [];
  const actionId = requiredText(
    input.value.actionId,
    "剧情任务管理请求标识",
    limits.id,
    issues,
  );
  const operation = input.value.operation;
  if (operation !== "create" && operation !== "update" && operation !== "set_active") {
    issues.push("剧情任务管理操作无效。");
  }

  if (operation === "create") {
    const taskModule = readModule(input.value.module, issues);
    if (issues.length > 0) throw new StoryModuleManagementInputError(issues);
    return { actionId, sessionId: input.sessionId, operation, module: taskModule };
  }

  const moduleId = requiredText(
    input.value.moduleId,
    "剧情任务 ID",
    limits.id,
    issues,
  );
  if (operation === "update") {
    const taskModule = readModule(input.value.module, issues);
    if (taskModule.id && taskModule.id !== moduleId) {
      issues.push("编辑剧情任务时不能修改任务 ID。");
    }
    if (issues.length > 0) throw new StoryModuleManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      moduleId,
      module: taskModule,
    };
  }
  if (operation === "set_active") {
    if (typeof input.value.active !== "boolean") {
      issues.push("启用状态必须是布尔值。");
    }
    if (issues.length > 0) throw new StoryModuleManagementInputError(issues);
    return {
      actionId,
      sessionId: input.sessionId,
      operation,
      moduleId,
      active: input.value.active as boolean,
    };
  }
  throw new StoryModuleManagementInputError(issues);
}
