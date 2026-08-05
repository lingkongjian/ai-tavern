import type {
  CharacterStatus,
  JsonObject,
  JsonValue,
  LoadedAdventure,
} from "../storage/story-store.ts";
import {
  ATTRIBUTE_WHITELIST,
  isAttributeName,
  type AttributeName,
} from "./判定服务.ts";
import { sceneSimilarity } from "./重复检测.ts";

export type RoleplayMode = "speech" | "action" | "mixed";

/**
 * 游戏内时间模式：
 * - "story"：剧情驱动（缺省，兼容旧会话）——gameTimeDay 由
 *   sceneTransition.timeAdvance / gameTimeDayNext 显式声明推进；
 * - "turn_based"：五回合一天——每回合自动推进一个时段
 *   （早上→上午→中午→下午→晚上），每 5 回合进入下一天，
 *   模型的 timeAdvance / gameTimeDayNext 声明被忽略。
 */
export type TimeMode = "story" | "turn_based";

/**
 * 重生成（重写）模式：
 * - "standard"（缺省）：普通重写，玩家必须提供修改意见 feedback；
 * - "time_fix"：日期修正模式——玩家发现正文暗示时间流逝（次日、数日后等）
 *   但游戏内日期未推进时使用，feedback 允许为空；系统注入日期修正指令，
 *   并把正文时间短语一致性警告升级为校验错误，确保重写真正解决时间问题。
 */
export type RegenerateRewriteMode = "standard" | "time_fix";

/** 五回合一天模式的五个时段（按顺序每回合推进一个）。 */
export const DAY_PHASES = ["早上", "上午", "中午", "下午", "晚上"] as const;

export type DayPhase = (typeof DAY_PHASES)[number];

/**
 * 由 phaseOffset（从切换时刻起累计的时段序号，从 0 开始，每回合 +1）推导时段：
 * DAY_PHASES[phaseOffset % 5]。phaseOffset 为负时按 5 取模回绕（历史回合还原
 * 用 phaseOffset − 1 反推该回合所处时段）。缺省/无效值按 0（早上）处理。
 */
export function dayPhaseOf(phaseOffset: number | undefined): DayPhase {
  const offset =
    typeof phaseOffset === "number" && Number.isFinite(phaseOffset)
      ? phaseOffset
      : 0;
  return DAY_PHASES[((offset % DAY_PHASES.length) + DAY_PHASES.length) % DAY_PHASES.length];
}

/** 行动受限状态类型白名单：剧情中角色死亡、被关押、被控制等"行动受限"因素。 */
export const RESTRICTION_KINDS = [
  "dead",
  "imprisoned",
  "controlled",
  "bound",
  "other",
] as const;

export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];

export interface CharacterRestriction {
  kind: RestrictionKind;
  summary: string;
  sinceTurnId?: string;
}

/** 角色状态词条类型白名单：增益（buff）或减益（debuff）。 */
export const STATUS_KINDS = ["buff", "debuff"] as const;

export type StatusKind = (typeof STATUS_KINDS)[number];

export interface PlayerTurnRequest {
  expectedHeadTurnId: string | null;
  idempotencyKey: string;
  selectedChoiceId?: string;
  customChoice?: string;
  roleplay?: {
    mode: RoleplayMode;
    content: string;
  };
  /**
   * 玩家角色内心想法（可选，限长 1000）：仅玩家角色自己知道，
   * 其他角色（含 NPC）不可知；影响玩家角色后续言行的动机，
   * 但不作为故事内可观察内容。
   */
  innerThoughts?: string;
  storyDirection?: string;
}

export interface RegenerateTurnRequest {
  expectedHeadTurnId: string;
  actionId: string;
  feedback: string;
  mode: RegenerateRewriteMode;
}

export interface GeneratedEvent {
  id: string;
  type: string;
  summary: string;
  characterIds: string[];
  locationId?: string;
}

export interface GeneratedDialogue {
  id: string;
  speakerId: string;
  content: string;
  addressedCharacterIds: string[];
}

/**
 * 角色内心想法（NPC 内心独白）：其他角色（含玩家角色）不可知，
 * 只影响该角色自身后续行动的动机一致性。
 */
export interface GeneratedCharacterThought {
  characterId: string;
  content: string;
}

export interface GeneratedChoice {
  id: string;
  label: string;
  description: string;
  stance:
    | "accept"
    | "partial_accept"
    | "reject"
    | "benevolent"
    | "neutral"
    | "malicious";
}

export interface GeneratedCharacterStateChange {
  characterId: string;
  patch: JsonObject;
  duration: "instant" | "scene" | "until_changed" | "permanent";
  reason: string;
  evidence: string[];
}

export type SceneTimeAdvance = "moment" | "hours" | "one_day" | "several_days";

export interface GeneratedAttributeCheck {
  id: string;
  characterId: string;
  attribute: AttributeName;
  difficulty: number;
  context: string;
}

export type GeneratedPlotThreadOperation = "seed" | "payoff";

export interface GeneratedPlotThreadUpdate {
  threadId: string;
  operation: GeneratedPlotThreadOperation;
  reason: string;
  evidence: string[];
}

export interface GeneratedPlotTriggerUpdate {
  triggerId: string;
  operation: "fire";
  reason: string;
  evidence: string[];
}

/**
 * 剧情约定：剧情中角色明确约定的未来时间点（会面、交易、交付、赴考等
 * 剧情内事件，区别于剧本包预埋任务的 deadlineDay）。
 * atDay 为游戏内约定日期（第 N 天，正整数 ≥1），到期（≤ 当前 gameTimeDay）
 * 后由上下文 dueAppointments 以"约定日已到"硬事实注入。
 */
export interface GeneratedAppointment {
  id: string;
  title: string;
  description: string;
  characterIds?: string[];
  atDay: number;
}

export interface GeneratedSceneTransition {
  locationId: string;
  locationName?: string;
  locationDescription?: string;
  presentCharacterIds: string[];
  reason: string;
  evidence: string[];
  offstageUpdates?: GeneratedOffstageUpdate[];
  timeAdvance?: SceneTimeAdvance;
  /** 本回合结束时的游戏内日期（整数，≥ 当前 gameTimeDay，不得回退）。 */
  gameTimeDayNext?: number;
}

export interface GeneratedOffstageUpdate {
  characterId: string;
  locationId: string;
  locationName?: string;
  locationDescription?: string;
  reason: string;
}

export interface GeneratedRelationshipChange {
  sourceCharacterId: string;
  targetCharacterId: string;
  dimension: "trust" | "affection" | "fear" | "hostility" | "respect";
  delta: number;
  reason: string;
  evidence: string[];
}

export interface GeneratedCharacterCardChange {
  characterId: string;
  operation: "add" | "update" | "deactivate";
  path: string;
  value?: JsonValue;
  reason: string;
  evidence: string[];
  sourceTurnId: string;
}

export type GeneratedWorldBookChange =
  | {
      operation: "create";
      entry: JsonObject;
      sourceTurnId: string;
      sourceStoryDirectionId?: string;
      reason: string;
      evidence: string[];
    }
  | {
      operation: "update";
      targetEntryId: string;
      patch: JsonObject;
      sourceTurnId: string;
      sourceStoryDirectionId?: string;
      reason: string;
      evidence: string[];
    }
  | {
      operation: "deactivate";
      targetEntryId: string;
      sourceTurnId: string;
      sourceStoryDirectionId?: string;
      reason: string;
      evidence: string[];
    };

export interface ValidatedGeneratedTurn {
  raw: JsonObject;
  turn: {
    scene: string;
    events: GeneratedEvent[];
    dialogue: GeneratedDialogue[];
    /** 角色内心想法（可选，无则空数组）：其他角色（含玩家角色）不可知。 */
    characterThoughts: GeneratedCharacterThought[];
  };
  attributeChecks: GeneratedAttributeCheck[];
  sourceProgress: number | null;
  decision: {
    context: "proposal_response" | "action_direction";
    prompt: string;
    choices: GeneratedChoice[];
  };
  stateCommit: {
    sceneTransition: GeneratedSceneTransition | null;
    characterStateChanges: GeneratedCharacterStateChange[];
    relationshipChanges: GeneratedRelationshipChange[];
    characterCardChanges: GeneratedCharacterCardChange[];
    worldBookChanges: GeneratedWorldBookChange[];
    plotThreadUpdates: GeneratedPlotThreadUpdate[];
    plotTriggerUpdates: GeneratedPlotTriggerUpdate[];
    /** 剧情约定：undefined=未提供（约定保持不变）、null=清除全部、数组=完整替换。 */
    appointments: GeneratedAppointment[] | null | undefined;
    storyDirectionEvaluation: {
      status: "active" | "completed";
      reason: string;
      evidence: string[];
      continuity: "aligned" | "diverged" | "uncertain";
      continuityReason: string;
      recommendedModuleId: string | null;
      suggestedNextDirection: {
        title: string;
        content: string;
        reason: string;
      } | null;
      divergenceState?: {
        outlineRecoverable: "recoverable" | "broken";
        badEndDrift: "rising" | "neutral";
        reason: string;
      };
    } | null;
    summaryPatch: string;
  };
  warnings: string[];
}

export class PlayerTurnInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "玩家本轮输入无效。");
    this.name = "PlayerTurnInputError";
    this.issues = issues;
  }
}

export class GeneratedTurnValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "模型输出不符合剧情生成规范。");
    this.name = "GeneratedTurnValidationError";
    this.issues = issues;
  }
}

export class RegenerateTurnInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "重新生成请求无效。");
    this.name = "RegenerateTurnInputError";
    this.issues = issues;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: JsonValue | undefined) {
  return typeof value === "string" ? value : "";
}

export function normalizeGeneratedTurnVersion(value: JsonObject): JsonObject {
  const normalized = structuredClone(value);
  const candidate =
    value.schemaVersion === undefined
      ? value.schema_version
      : value.schemaVersion;

  if (
    candidate === 1 ||
    candidate === "1" ||
    candidate === "1.0" ||
    candidate === "1.0.0"
  ) {
    normalized.schemaVersion = "1.0.0";
  }

  delete normalized.schema_version;
  return normalized;
}

function trimText(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function parsePlayerTurnRequest(value: unknown): PlayerTurnRequest {
  if (!isObject(value)) {
    throw new PlayerTurnInputError(["请求内容必须是 JSON 对象。"]);
  }

  const issues: string[] = [];
  const expectedHeadTurnId =
    value.expectedHeadTurnId === null
      ? null
      : trimText(value.expectedHeadTurnId, 120);
  if (value.expectedHeadTurnId !== null && !expectedHeadTurnId) {
    issues.push("expectedHeadTurnId 无效，请重新载入剧情。");
  }

  const idempotencyKey = trimText(value.idempotencyKey, 120);
  if (!idempotencyKey) issues.push("缺少本轮请求标识。");

  const selectedChoiceId = trimText(value.selectedChoiceId, 160);
  const customChoice = trimText(value.customChoice, 2_000);
  const storyDirectionProvided = typeof value.storyDirection === "string";
  const storyDirection = storyDirectionProvided
    ? trimText(value.storyDirection, 1_000)
    : undefined;
  const innerThoughts =
    typeof value.innerThoughts === "string"
      ? value.innerThoughts.trim().slice(0, 1_000)
      : undefined;

  let roleplay: PlayerTurnRequest["roleplay"];
  if (value.roleplay !== undefined && value.roleplay !== null) {
    if (!isObject(value.roleplay)) {
      issues.push("角色言行格式无效。");
    } else {
      const mode = value.roleplay.mode;
      const content = trimText(value.roleplay.content, 4_000);
      if (mode !== "speech" && mode !== "action" && mode !== "mixed") {
        issues.push("角色言行类型无效。");
      } else if (!content) {
        issues.push("角色言行内容不能为空。");
      } else {
        roleplay = { mode, content };
      }
    }
  }

  if (!selectedChoiceId && !customChoice && !roleplay && !storyDirectionProvided) {
    issues.push("请至少选择一个候选项，或填写一项玩家输入。");
  }
  if (selectedChoiceId && customChoice) {
    issues.push("候选选项和自定义选项不能同时提交。");
  }

  if (issues.length > 0) throw new PlayerTurnInputError(issues);

  return {
    expectedHeadTurnId,
    idempotencyKey,
    selectedChoiceId: selectedChoiceId || undefined,
    customChoice: customChoice || undefined,
    roleplay,
    ...(innerThoughts ? { innerThoughts } : {}),
    ...(storyDirectionProvided ? { storyDirection } : {}),
  };
}

export function parseRegenerateTurnRequest(value: unknown): RegenerateTurnRequest {
  if (!isObject(value)) {
    throw new RegenerateTurnInputError(["请求内容必须是 JSON 对象。"]);
  }
  const issues: string[] = [];
  const expectedHeadTurnId = trimText(value.expectedHeadTurnId, 120);
  const actionId = trimText(value.actionId, 120);
  const feedback = trimText(value.feedback, 1_000);
  let mode: RegenerateRewriteMode = "standard";
  if (value.mode === undefined || value.mode === null || value.mode === "standard") {
    mode = "standard";
  } else if (value.mode === "time_fix") {
    mode = "time_fix";
  } else {
    issues.push("重写模式 mode 必须是 standard 或 time_fix。");
  }
  if (!expectedHeadTurnId) issues.push("缺少要重新生成的最新回合 ID。");
  if (!actionId) issues.push("缺少重新生成请求标识。");
  // standard 模式必须提供修改意见；time_fix 模式本身说明问题（日期应变更但没变更），
  // 修改意见可留空（可补充细节），为空时系统按纯日期修正目标重写。
  if (mode !== "time_fix" && !feedback) {
    issues.push("请说明对当前剧情不满意的地方或希望如何修改。");
  }
  if (issues.length > 0) throw new RegenerateTurnInputError(issues);
  return { expectedHeadTurnId, actionId, feedback, mode };
}

function requiredObject(
  value: JsonValue | undefined,
  path: string,
  issues: string[],
) {
  if (!isObject(value)) {
    issues.push(`${path} 必须是对象。`);
    return {};
  }
  return value;
}

function requiredArray(
  value: JsonValue | undefined,
  path: string,
  issues: string[],
) {
  if (!Array.isArray(value)) {
    issues.push(`${path} 必须是数组。`);
    return [];
  }
  return value;
}

function requiredText(
  value: JsonValue | undefined,
  path: string,
  issues: string[],
  maximumLength = 12_000,
) {
  const result = trimText(value, maximumLength);
  if (!result) issues.push(`${path} 不能为空。`);
  return result;
}

function textArray(
  value: JsonValue | undefined,
  path: string,
  issues: string[],
  minimumLength = 0,
) {
  const values = requiredArray(value, path, issues).map((item, index) =>
    requiredText(item, `${path}[${index}]`, issues, 160),
  );
  const filtered = values.filter(Boolean);
  if (filtered.length < minimumLength) {
    issues.push(`${path} 至少需要 ${minimumLength} 项。`);
  }
  if (new Set(filtered).size !== filtered.length) {
    issues.push(`${path} 不能包含重复项。`);
  }
  return filtered;
}

function oneOf<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
  issues: string[],
) {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    issues.push(`${path} 不是允许的值。`);
    return allowed[0];
  }
  return value as T;
}

function readEvidence(
  value: JsonValue | undefined,
  path: string,
  knownEvidenceIds: Set<string>,
  issues: string[],
  minimumLength = 1,
) {
  const evidence = textArray(value, path, issues, minimumLength);
  for (const evidenceId of evidence) {
    if (!knownEvidenceIds.has(evidenceId)) {
      issues.push(`${path} 引用了不存在的事件或对话 ${evidenceId}。`);
    }
  }
  return evidence;
}

/**
 * 校验角色状态词条数组（character_state.statuses）。
 * - undefined/null：未提供或显式清除，返回 null，不产生校验问题；
 * - 数组：逐项校验 id（非空、限长、数组内唯一）、name、kind 枚举白名单、
 *   hidden 布尔、description 限长、sourceTurnId、expiresAtDay 正整数。
 * 返回规范化后的词条列表（有校验问题时返回仍可读取的部分，由调用方决定成败）。
 * 供回合协议 patch 校验与人物管理 set_statuses 复用（单一权威模式）。
 */
export function validateStatusesArray(
  value: JsonValue | undefined,
  path: string,
  issues: string[],
): CharacterStatus[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    issues.push(`${path} 必须是数组（完整替换）或 null（清除全部）。`);
    return null;
  }
  const result: CharacterStatus[] = [];
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isObject(item)) {
      issues.push(`${itemPath} 必须是对象。`);
      return;
    }
    const id = readString(item.id).trim();
    if (!id) {
      issues.push(`${itemPath}.id 不能为空。`);
    } else if (id.length > 120) {
      issues.push(`${itemPath}.id 不能超过 120 个字符。`);
    } else if (ids.has(id)) {
      issues.push(`${itemPath}.id 状态词条 ID ${id} 重复。`);
    } else {
      ids.add(id);
    }
    const name = readString(item.name).trim();
    if (!name) {
      issues.push(`${itemPath}.name 不能为空。`);
    } else if (name.length > 80) {
      issues.push(`${itemPath}.name 不能超过 80 个字符。`);
    }
    const kind = readString(item.kind);
    if (!STATUS_KINDS.includes(kind as StatusKind)) {
      issues.push(
        `${itemPath}.kind 必须是 ${STATUS_KINDS.join("、")} 之一。`,
      );
    }
    if (item.hidden !== undefined && typeof item.hidden !== "boolean") {
      issues.push(`${itemPath}.hidden 必须是布尔值。`);
    }
    const description = readString(item.description).trim();
    if (!description) {
      issues.push(`${itemPath}.description 不能为空。`);
    } else if (description.length > 2_000) {
      issues.push(`${itemPath}.description 不能超过 2000 个字符。`);
    }
    if (
      item.sourceTurnId !== undefined &&
      (typeof item.sourceTurnId !== "string" || !item.sourceTurnId.trim())
    ) {
      issues.push(`${itemPath}.sourceTurnId 必须是回合 ID 文本。`);
    }
    if (
      item.expiresAtDay !== undefined &&
      (typeof item.expiresAtDay !== "number" ||
        !Number.isInteger(item.expiresAtDay) ||
        item.expiresAtDay < 1)
    ) {
      issues.push(`${itemPath}.expiresAtDay 必须是大于等于 1 的整数（游戏内到期日）。`);
    }
    result.push({
      id: id || `status-${index}`,
      name: name || `状态${index + 1}`,
      kind: STATUS_KINDS.includes(kind as StatusKind)
        ? (kind as StatusKind)
        : "debuff",
      ...(item.hidden !== undefined && typeof item.hidden === "boolean"
        ? { hidden: item.hidden }
        : {}),
      description: description || "",
      ...(typeof item.sourceTurnId === "string" && item.sourceTurnId.trim()
        ? { sourceTurnId: item.sourceTurnId.trim() }
        : {}),
      ...(typeof item.expiresAtDay === "number" &&
      Number.isInteger(item.expiresAtDay) &&
      item.expiresAtDay >= 1
        ? { expiresAtDay: item.expiresAtDay }
        : {}),
    });
  });
  return result;
}

/**
 * 校验角色已知信息数组（character_state.knownFacts）。
 * - undefined/null：未提供或显式清除，返回 null，不产生校验问题；
 * - 数组：完整数组替换语义，逐项校验 id（非空、限长、数组内唯一）、
 *   content（非空、限长）。
 * 返回规范化后的已知信息列表（有校验问题时返回仍可读取的部分，由调用方决定成败）。
 * 供回合协议 patch 校验复用（与 validateStatusesArray 同模式）。
 */
export function validateKnownFactsArray(
  value: JsonValue | undefined,
  path: string,
  issues: string[],
): { id: string; content: string }[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    issues.push(`${path} 必须是数组（完整替换）或 null（清除全部）。`);
    return null;
  }
  const result: { id: string; content: string }[] = [];
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isObject(item)) {
      issues.push(`${itemPath} 必须是对象。`);
      return;
    }
    const id = readString(item.id).trim();
    if (!id) {
      issues.push(`${itemPath}.id 不能为空。`);
    } else if (id.length > 120) {
      issues.push(`${itemPath}.id 不能超过 120 个字符。`);
    } else if (ids.has(id)) {
      issues.push(`${itemPath}.id 已知信息 ID ${id} 重复。`);
    } else {
      ids.add(id);
    }
    const content = readString(item.content).trim();
    if (!content) {
      issues.push(`${itemPath}.content 不能为空。`);
    } else if (content.length > 300) {
      issues.push(`${itemPath}.content 不能超过 300 个字符。`);
    }
    result.push({
      id: id || `fact-${index}`,
      content: content || "",
    });
  });
  return result;
}

/**
 * 校验剧情约定数组（stateCommit.appointments）。
 * - undefined：未提供，约定保持不变（不做任何变化）；
 * - null：显式清除全部约定；
 * - 数组：完整数组替换语义，逐项校验 id（非空、限长、数组内唯一）、
 *   title/description 限长、characterIds 为存在角色 ID 数组（可选）、
 *   atDay 正整数（≥1）。
 * 返回规范化后的约定列表（null 表示清除全部，undefined 表示未提供）。
 */
export function validateAppointmentsArray(
  value: JsonValue | undefined,
  path: string,
  issues: string[],
  knownCharacterIds: Set<string>,
): GeneratedAppointment[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) {
    issues.push(`${path} 必须是数组（完整替换）或 null（清除全部约定）。`);
    return null;
  }
  if (value.length > 20) issues.push(`${path} 最多登记 20 项约定。`);
  const result: GeneratedAppointment[] = [];
  const ids = new Set<string>();
  value.slice(0, 20).forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isObject(item)) {
      issues.push(`${itemPath} 必须是对象。`);
      return;
    }
    const id = readString(item.id).trim();
    if (!id) {
      issues.push(`${itemPath}.id 不能为空。`);
    } else if (id.length > 120) {
      issues.push(`${itemPath}.id 不能超过 120 个字符。`);
    } else if (ids.has(id)) {
      issues.push(`${itemPath}.id 约定 ID ${id} 重复。`);
    } else {
      ids.add(id);
    }
    const title = readString(item.title).trim();
    if (!title) {
      issues.push(`${itemPath}.title 不能为空。`);
    } else if (title.length > 120) {
      issues.push(`${itemPath}.title 不能超过 120 个字符。`);
    }
    const description = readString(item.description).trim();
    if (!description) {
      issues.push(`${itemPath}.description 不能为空。`);
    } else if (description.length > 2_000) {
      issues.push(`${itemPath}.description 不能超过 2000 个字符。`);
    }
    const atDay = typeof item.atDay === "number" ? item.atDay : Number.NaN;
    if (!Number.isInteger(atDay) || atDay < 1) {
      issues.push(`${itemPath}.atDay 必须是大于等于 1 的整数（游戏内约定日期）。`);
    }
    let characterIds: string[] | undefined;
    if (item.characterIds !== undefined) {
      if (!Array.isArray(item.characterIds)) {
        issues.push(`${itemPath}.characterIds 必须是数组。`);
      } else {
        const seen = new Set<string>();
        characterIds = [];
        item.characterIds.slice(0, 20).forEach((itemValue, charIndex) => {
          const characterId = readString(itemValue).trim();
          if (!characterId) {
            issues.push(`${itemPath}.characterIds[${charIndex}] 不能为空。`);
          } else if (characterId.length > 120) {
            issues.push(`${itemPath}.characterIds[${charIndex}] 不能超过 120 个字符。`);
          } else if (!knownCharacterIds.has(characterId)) {
            issues.push(`约定引用了不存在的角色 ${characterId}。`);
          } else if (!seen.has(characterId)) {
            seen.add(characterId);
            characterIds!.push(characterId);
          }
        });
      }
    }
    result.push({
      id: id || `appointment-${index}`,
      title: title || `约定${index + 1}`,
      description: description || "",
      ...(characterIds !== undefined ? { characterIds } : {}),
      atDay: Number.isInteger(atDay) && atDay >= 1 ? atDay : 1,
    });
  });
  return result;
}

function collectExistingEvidence(adventure: LoadedAdventure) {
  const evidence = new Set<string>();
  for (const recentTurn of adventure.branchState.recentTurns) {
    const turn = isObject(recentTurn.generatedOutput.turn)
      ? recentTurn.generatedOutput.turn
      : {};
    for (const entry of [
      ...requiredArray(turn.events, "历史事件", []),
      ...requiredArray(turn.dialogue, "历史对话", []),
    ]) {
      if (isObject(entry) && typeof entry.id === "string") evidence.add(entry.id);
    }
  }
  return evidence;
}

/**
 * 状态一致性检测（警告级，不拒绝回合）：
 * 对每个有可见词条（hidden=false）的角色，若本轮 scene/events 正文中提到该词条的
 * 提示关键词（词条 name 全文 + description 中的中文短语与英文词），而该角色本轮
 * patch.statuses 未更新该词条 id，则产生一条"正文暗示但词条未同步"的警告。
 * 关键词提取保守：中文短语取 2~8 字的连续汉字段，英文词取 3 个以上字母的连续段；
 * 只对 scene/events 拼接文本匹配，避免把对话台词等造成大量误报。
 */
function statusSyncHintKeywords(name: string, description: string) {
  const keywords: string[] = [];
  const trimmedName = name.trim();
  if (trimmedName.length >= 2) keywords.push(trimmedName);
  for (const run of description.match(/[\u3400-\u9fff]{2,8}/g) ?? []) {
    keywords.push(run);
  }
  for (const run of description.match(/[A-Za-z]{3,}/g) ?? []) {
    keywords.push(run);
  }
  return keywords;
}

function collectStatusSyncWarnings(input: {
  scene: string;
  events: GeneratedEvent[];
  characterStates: Map<string, JsonObject>;
  characterStateChanges: GeneratedCharacterStateChange[];
}) {
  const { scene, events, characterStates, characterStateChanges } = input;
  const warnings: string[] = [];
  const narrativeText = [scene, ...events.map((event) => event.summary)].join("\n");
  if (!narrativeText.trim()) return warnings;

  // 每个角色本轮 patch.statuses 覆盖到的词条 id；null（清除全部）视为显式处理。
  const updatedStatusIdsByCharacter = new Map<string, Set<string>>();
  for (const change of characterStateChanges) {
    const statuses = change.patch.statuses;
    if (statuses === null) {
      updatedStatusIdsByCharacter.set(change.characterId, new Set(["*all*"]));
    } else if (Array.isArray(statuses)) {
      const ids = new Set<string>();
      for (const item of statuses) {
        if (isObject(item) && typeof item.id === "string" && item.id) {
          ids.add(item.id);
        }
      }
      updatedStatusIdsByCharacter.set(change.characterId, ids);
    }
  }

  for (const [characterId, state] of characterStates) {
    const updatedIds = updatedStatusIdsByCharacter.get(characterId);
    if (updatedIds?.has("*all*")) continue;
    if (!Array.isArray(state.statuses)) continue;
    const characterName =
      typeof state.name === "string" && state.name.trim()
        ? state.name
        : characterId;
    for (const item of state.statuses) {
      if (!isObject(item) || item.hidden === true) continue;
      if (typeof item.id !== "string" || !item.id) continue;
      const name = typeof item.name === "string" ? item.name : "";
      const description = typeof item.description === "string" ? item.description : "";
      if (updatedIds?.has(item.id)) continue;
      const keywords = statusSyncHintKeywords(name, description);
      if (keywords.length === 0) continue;
      if (!keywords.some((keyword) => narrativeText.includes(keyword))) continue;
      warnings.push(
        `角色「${characterName}」本轮正文提到状态「${name}」但词条未同步更新，请检查是否需要在 characterStateChanges.patch.statuses 中更新该词条（description、expiresAtDay）或按剧情移除/新增。`,
      );
    }
  }
  return warnings;
}

/**
 * 地点一致性检测（警告级，不拒绝回合）：
 * 仅当本轮场景确实发生移动（sceneTransition.locationId 与上一轮 currentLocationId 不同）时，
 * 检查 scene 与 events[].summary 中是否出现与目标地点不同的已知地点名——若正文写的是另一个
 * 已知地点而 locationId 落在别处（用户反馈的"正文移动场景但当前地点更新到不一致的地点"），
 * 则产生一条"正文与 locationId 不一致"的警告。
 * 误报控制（保守策略）：
 * - 只匹配已知地点名全文（地点名 ≥2 字符），且只扫描 scene 与 events[].summary，不扫 dialogue；
 * - 场景未移动（locationId 沿用上一轮）时不检查——对话/行动回合正文可能只是"提及"别处地点；
 * - 新地点（locationId 不在已知集合）时仅当其 locationName 与正文提到的已知地点名不同才警告，
 *   同名不警告（同名却新建 ID 的复用问题交给规则约束）。
 */
function collectLocationConsistencyWarnings(input: {
  scene: string;
  events: GeneratedEvent[];
  sceneTransition: GeneratedSceneTransition | null;
  adventure: LoadedAdventure;
}) {
  const { scene, events, sceneTransition, adventure } = input;
  const warnings: string[] = [];
  if (!sceneTransition) return warnings;
  const narrativeText = [
    scene,
    ...events.map((event) => event.summary),
  ].join("\n");
  if (!narrativeText.trim()) return warnings;

  const sessionState = adventure.branchState.states.find(
    (state) => state.entityType === "session_state" && state.entityId === "core",
  );
  const previousLocationId =
    typeof sessionState?.state.currentLocationId === "string"
      ? sessionState.state.currentLocationId
      : "";
  // 场景未移动：本轮与上一轮同地点（含无历史地点的开局沿用），正文提及别处地点不构成冲突。
  if (sceneTransition.locationId === previousLocationId) return warnings;

  // 启用中的已知地点：名称 → locationId、locationId → 名称。
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();
  for (const state of adventure.branchState.states) {
    if (state.entityType !== "location" || !state.isActive) continue;
    const name =
      typeof state.state.name === "string" ? state.state.name.trim() : "";
    if (name.length < 2) continue;
    if (!nameToId.has(name)) nameToId.set(name, state.entityId);
    idToName.set(state.entityId, name);
  }
  const targetName =
    idToName.get(sceneTransition.locationId) ??
    sceneTransition.locationName?.trim() ??
    "";
  for (const [name, locationId] of nameToId) {
    if (locationId === sceneTransition.locationId) continue;
    // 新地点但与正文提到的已知地点同名：名称一致不警告（ID 复用问题由规则约束）。
    if (name === targetName) continue;
    if (!narrativeText.includes(name)) continue;
    warnings.push(
      `正文提到地点「${name}」但本轮场景地点为「${targetName || sceneTransition.locationId}」，请检查 sceneTransition.locationId 是否与正文实际到达的地点一致（若正文确实到达该地点，应沿用其正确 ID）。`,
    );
  }
  return warnings;
}

/**
 * 时间短语一致性检测（警告级，不拒绝回合）：
 * 本轮 scene/events 正文出现明显的"跨日/跨夜"时间短语（次日、翌日、数日后、
 * 入夜后、next day、after ... days 等），而本轮未声明任何日期推进
 * （sceneTransition 未提供 gameTimeDayNext，且 timeAdvance 为缺省/moment/hours）时，
 * 产生一条"正文暗示时间流逝但日期未推进"的警告，提醒模型用 gameTimeDayNext
 * 显式声明本回合结束日期（或改用 timeAdvance）。
 * 误报控制（保守策略）：
 * - 只匹配 scene 与 events[].summary，不匹配 dialogue（台词里"等明天再说"不算叙事时间流逝）；
 * - "小时后"类（数小时后、几个小时后）不算日期变化——hours 合法，不触发；
 * - 仅当日时间描写（黄昏时分等）且确实未跨日时，模型可忽略该提醒；
 * - 只警告不拒绝，且同一轮最多一条。
 */
const DAY_CROSSING_TIME_PHRASE_PATTERNS: RegExp[] = [
  // 中文：明确指向次日或数日后的短语
  /次日|翌日|第二天|第三天|第四天|第五天|第六天/,
  /数日后|几天后|多日后|两天后|三天后|数日之后|几日之后|一两日后/,
  // 中文：跨夜/入夜类（天明、天亮、入夜、黄昏等时间节点）
  /天明后|天亮后|黄昏时分|入夜后|夜幕降临/,
  // 英文：跨日表达
  /after\s+(a\s+few\s+|several\s+|\d+\s+)?days/i,
  /\bnext\s+day\b|\bnext\s+morning\b|\bnext\s+night\b|\bthe\s+following\s+day\b/i,
  /\bdays\s+later\b|\ba\s+day\s+later\b/i,
];

function collectTimePhraseConsistencyWarnings(input: {
  scene: string;
  events: GeneratedEvent[];
  sceneTransition: GeneratedSceneTransition | null;
}) {
  const { scene, events, sceneTransition } = input;
  const warnings: string[] = [];
  const narrativeText = [scene, ...events.map((event) => event.summary)].join("\n");
  if (!narrativeText.trim()) return warnings;

  // 本轮是否声明了日期推进：gameTimeDayNext 显式声明，或 timeAdvance 跨日枚举。
  const dateDeclared =
    sceneTransition?.gameTimeDayNext !== undefined ||
    sceneTransition?.timeAdvance === "one_day" ||
    sceneTransition?.timeAdvance === "several_days";
  if (dateDeclared) return warnings;

  const matchedPhrase = findDayCrossingTimePhrase(narrativeText);
  if (!matchedPhrase) return warnings;
  warnings.push(
    `正文出现时间流逝短语「${matchedPhrase}」但本轮游戏内日期未推进（sceneTransition 未提供 gameTimeDayNext 且 timeAdvance 为 moment/hours/缺省）。若剧情确实跨日（如"次日""数日后"），请通过 sceneTransition.gameTimeDayNext 显式声明本回合结束日期（整数，≥ 当前游戏内日期），或改用 timeAdvance 表示时间幅度；若只是同日内的时间描写，可忽略本提醒。`,
  );
  return warnings;
}

/** 在正文（scene + 事件摘要）中寻找跨日时间流逝短语，返回命中的短语原文；未命中返回 undefined。 */
function findDayCrossingTimePhrase(narrativeText: string): string | undefined {
  for (const pattern of DAY_CROSSING_TIME_PHRASE_PATTERNS) {
    const match = pattern.exec(narrativeText);
    if (match) return match[0];
  }
  return undefined;
}

/**
 * 选项差异检测（警告级，不拒绝回合）：
 * 本轮 decision.choices 与最近 2-3 回合（recentTurns 尾部窗口）的候选项做文本
 * 相似度比较（label + description 拼接后复用 sceneSimilarity 的 n-gram Jaccard），
 * 任一历史回合存在相似度 ≥ 阈值的选项对时，产生一条"选项高度相似"警告，提醒
 * 模型提供有实质差异的选择。取用路径：adventure.branchState.recentTurns 每回合的
 * generatedOutput.decision.choices（协议保存的原始候选项）。
 * 误报控制（保守策略）：
 * - 阈值 0.65 高于场景重复拦截的 0.55：对话轮次的选项常因同一情境自然接近，
 *   过低阈值会在普通对话中频繁误报；0.65 只捕获近乎复读的选项，同时因警告
 *   不拒绝回合，即使个别误报也不阻断剧情；
 * - 文本过短（normalized 长度不满足 sceneSimilarity 的最低要求）视为无法判断，
 *   相似度按 0 处理，不警告；
 * - 每个历史回合最多产生一条警告（取该回合最高相似度的选项对），同一轮
 *   至多 3 条，避免刷屏。
 */
const CHOICE_SIMILARITY_THRESHOLD = 0.65;
const CHOICE_RECENT_WINDOW = 3;

function trimChoiceSample(value: string, limit = 40) {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function collectChoiceDiversityWarnings(input: {
  choices: GeneratedChoice[];
  adventure: LoadedAdventure;
}) {
  const { choices, adventure } = input;
  const warnings: string[] = [];
  const currentTexts = choices
    .map((choice) => `${choice.label} ${choice.description}`.trim())
    .filter((text) => text.length > 0);
  if (currentTexts.length === 0) return warnings;

  const recentTurns = adventure.branchState.recentTurns.slice(
    -CHOICE_RECENT_WINDOW,
  );
  for (const recentTurn of recentTurns) {
    const recentDecision = isObject(recentTurn.generatedOutput.decision)
      ? recentTurn.generatedOutput.decision
      : {};
    const recentTexts = requiredArray(
      recentDecision.choices,
      "历史候选项",
      [],
    )
      .filter(isObject)
      .map((item) => {
        const label = typeof item.label === "string" ? item.label : "";
        const description =
          typeof item.description === "string" ? item.description : "";
        return `${label} ${description}`.trim();
      })
      .filter((text) => text.length > 0);
    if (recentTexts.length === 0) continue;

    let worstSimilarity = 0;
    let currentSample = "";
    let recentSample = "";
    for (const currentText of currentTexts) {
      for (const recentText of recentTexts) {
        const similarity = sceneSimilarity(currentText, recentText);
        if (similarity > worstSimilarity) {
          worstSimilarity = similarity;
          currentSample = currentText;
          recentSample = recentText;
        }
      }
    }
    if (worstSimilarity < CHOICE_SIMILARITY_THRESHOLD) continue;
    const sequence =
      typeof recentTurn.sequence === "number" ? recentTurn.sequence : 0;
    warnings.push(
      `本轮选项与第 ${sequence} 回合的选项高度相似（相似度 ${Math.round(
        worstSimilarity * 100,
      )}%，如「${trimChoiceSample(
        currentSample,
      )}」与「${trimChoiceSample(recentSample)}」），请提供有实质差异的选择：选项应随剧情进展与玩家回应结果变化，避免连续多轮出现"继续调查/观望/保持现状"这类近似选项。`,
    );
  }
  return warnings;
}

const cardPaths = [
  "identity.titles",
  "identity.affiliations",
  "goals.longTerm",
  "beliefs",
  "fears",
  "vows",
  "permanentConditions",
  "abilities",
  "revealedSecrets",
  "relationshipMilestones",
] as const;

export function validateGeneratedTurn(
  value: JsonObject,
  adventure: LoadedAdventure,
  turnId: string,
  options: { timeMode?: TimeMode; rewriteMode?: RegenerateRewriteMode } = {},
): ValidatedGeneratedTurn {
  const issues: string[] = [];
  const normalizationWarnings: string[] = [];
  if (value.schemaVersion !== "1.0.0") {
    issues.push("schemaVersion 必须是 1.0.0。");
  }

  const characterIds = new Set(
    adventure.branchState.states
      .filter((state) => state.entityType === "character_card" && state.isActive)
      .map((state) => state.entityId),
  );
  const worldEntryIds = new Set(
    adventure.branchState.states
      .filter((state) => state.entityType === "world_book_entry")
      .map((state) => state.entityId),
  );
  const activeLocationIds = new Set(
    adventure.branchState.states
      .filter((state) => state.entityType === "location" && state.isActive)
      .map((state) => state.entityId),
  );
  const inactiveLocationIds = new Set(
    adventure.branchState.states
      .filter((state) => state.entityType === "location" && !state.isActive)
      .map((state) => state.entityId),
  );
  const playerCharacterId = adventure.branchState.states.find(
    (state) =>
      state.entityType === "character_card" &&
      state.isActive &&
      state.state.role === "player",
  )?.entityId;
  const existingEvidenceIds = collectExistingEvidence(adventure);

  // 当前游戏内日期（回合开始时的快照），供 gameTimeDayNext 校验（≥ 当前日、不回退）。
  const currentSessionState = adventure.branchState.states.find(
    (state) => state.entityType === "session_state" && state.entityId === "core",
  );
  const currentGameTimeDay =
    typeof currentSessionState?.state.gameTimeDay === "number"
      ? currentSessionState.state.gameTimeDay
      : 1;

  // 当前角色状态与行动受限标记（回合开始时的快照，用于硬拦截校验）。
  const characterStates = new Map(
    adventure.branchState.states
      .filter((state) => state.entityType === "character_state" && state.isActive)
      .map((state) => [state.entityId, state.state] as const),
  );
  const characterRestrictions = new Map<string, JsonObject | null>();
  for (const [characterId, state] of characterStates) {
    characterRestrictions.set(
      characterId,
      isObject(state.restriction) ? state.restriction : null,
    );
  }

  const turn = requiredObject(value.turn, "turn", issues);
  const scene = requiredText(turn.scene, "turn.scene", issues);
  const eventIds = new Set<string>();
  const events = requiredArray(turn.events, "turn.events", issues).map(
    (item, index): GeneratedEvent => {
      const event = requiredObject(item, `turn.events[${index}]`, issues);
      const id = requiredText(event.id, `turn.events[${index}].id`, issues, 160);
      if (eventIds.has(id) || existingEvidenceIds.has(id)) {
        issues.push(`事件 ID ${id} 已经存在或在本轮重复。`);
      }
      eventIds.add(id);
      const referencedCharacters = textArray(
        event.characterIds,
        `turn.events[${index}].characterIds`,
        issues,
      );
      for (const characterId of referencedCharacters) {
        if (!characterIds.has(characterId)) {
          issues.push(`事件引用了不存在的角色 ${characterId}。`);
        }
      }
      const locationId = trimText(event.locationId, 160);
      return {
        id,
        type: requiredText(event.type, `turn.events[${index}].type`, issues, 160),
        summary: requiredText(
          event.summary,
          `turn.events[${index}].summary`,
          issues,
          1_000,
        ),
        characterIds: referencedCharacters,
        ...(locationId ? { locationId } : {}),
      };
    },
  );

  const dialogueIds = new Set<string>();
  const dialogue = requiredArray(turn.dialogue, "turn.dialogue", issues).map(
    (item, index): GeneratedDialogue => {
      const line = requiredObject(item, `turn.dialogue[${index}]`, issues);
      const id = requiredText(line.id, `turn.dialogue[${index}].id`, issues, 160);
      if (
        dialogueIds.has(id) ||
        eventIds.has(id) ||
        existingEvidenceIds.has(id)
      ) {
        issues.push(`事件或对话 ID ${id} 已经存在或在本轮重复。`);
      }
      dialogueIds.add(id);
      const speakerId = requiredText(
        line.speakerId,
        `turn.dialogue[${index}].speakerId`,
        issues,
        160,
      );
      if (!characterIds.has(speakerId)) {
        issues.push(`对话引用了不存在的说话角色 ${speakerId}。`);
      }
      const addressedCharacterIds = Array.isArray(line.addressedCharacterIds)
        ? textArray(
            line.addressedCharacterIds,
            `turn.dialogue[${index}].addressedCharacterIds`,
            issues,
          )
        : [];
      for (const characterId of addressedCharacterIds) {
        if (!characterIds.has(characterId)) {
          issues.push(`对话引用了不存在的接收角色 ${characterId}。`);
        }
      }
      return {
        id,
        speakerId,
        content: requiredText(
          line.content,
          `turn.dialogue[${index}].content`,
          issues,
          4_000,
        ),
        addressedCharacterIds,
      };
    },
  );
  if (events.length === 0 && dialogue.length === 0) {
    issues.push("本轮至少需要一个已经发生的事件或一条角色对话。");
  }

  // 角色内心想法（NPC 内心独白）：可选，最多 6 条，每条不超过 400 字符，
  // characterId 必须指向存在角色；无则省略（校验结果为空数组）。
  const characterThoughts = (() => {
    if (turn.characterThoughts === undefined) return [];
    if (!Array.isArray(turn.characterThoughts)) {
      issues.push("turn.characterThoughts 必须是数组。");
      return [];
    }
    if (turn.characterThoughts.length > 6) {
      issues.push("每轮最多输出 6 条角色内心想法。");
    }
    return turn.characterThoughts.slice(0, 6).map(
      (item, index): GeneratedCharacterThought => {
        const thought = requiredObject(
          item,
          `turn.characterThoughts[${index}]`,
          issues,
        );
        const characterId = requiredText(
          thought.characterId,
          `turn.characterThoughts[${index}].characterId`,
          issues,
          160,
        );
        if (characterId && !characterIds.has(characterId)) {
          issues.push(`内心想法引用了不存在的角色 ${characterId}。`);
        }
        const content = trimText(thought.content, 400);
        if (!content) {
          issues.push(`turn.characterThoughts[${index}].content 不能为空。`);
        }
        return { characterId, content };
      },
    );
  })();

  const knownEvidenceIds = new Set(existingEvidenceIds);
  eventIds.forEach((id) => knownEvidenceIds.add(id));
  dialogueIds.forEach((id) => knownEvidenceIds.add(id));

  const attributeCheckIds = new Set<string>();
  const attributeChecks = (() => {
    if (value.attributeChecks === undefined) return [];
    if (!Array.isArray(value.attributeChecks)) {
      issues.push("attributeChecks 必须是数组。");
      return [];
    }
    if (value.attributeChecks.length > 4) {
      issues.push("每轮最多提议 4 项属性判定。");
    }
    return value.attributeChecks.slice(0, 4).map(
      (item, index): GeneratedAttributeCheck => {
        const check = requiredObject(item, `attributeChecks[${index}]`, issues);
        const checkId = requiredText(
          check.id,
          `attributeChecks[${index}].id`,
          issues,
          160,
        );
        if (attributeCheckIds.has(checkId)) {
          issues.push(`属性判定 ID ${checkId} 重复。`);
        }
        attributeCheckIds.add(checkId);
        const characterId = requiredText(
          check.characterId,
          `attributeChecks[${index}].characterId`,
          issues,
          160,
        );
        if (characterId && !characterIds.has(characterId)) {
          issues.push(`属性判定引用了不存在的角色 ${characterId}。`);
        }
        const attribute = trimText(check.attribute, 80);
        if (!isAttributeName(attribute)) {
          issues.push(
            `属性判定 ${checkId} 的属性“${attribute}”不在白名单中（允许：${ATTRIBUTE_WHITELIST.join("、")}）。`,
          );
        }
        const difficulty =
          typeof check.difficulty === "number" ? check.difficulty : Number.NaN;
        if (
          !Number.isInteger(difficulty) ||
          difficulty < 1 ||
          difficulty > 100
        ) {
          issues.push(
            `属性判定 ${checkId} 的难度必须是 1 到 100 之间的整数。`,
          );
        }
        return {
          id: checkId,
          characterId,
          attribute: isAttributeName(attribute)
            ? attribute
            : ATTRIBUTE_WHITELIST[0],
          difficulty: Number.isInteger(difficulty) ? difficulty : 50,
          context: requiredText(
            check.context,
            `attributeChecks[${index}].context`,
            issues,
            500,
          ),
        };
      },
    );
  })();

  const decisionObject = requiredObject(value.decision, "decision", issues);
  const context = oneOf(
    decisionObject.context,
    ["proposal_response", "action_direction"] as const,
    "decision.context",
    issues,
  );
  const decisionPrompt = requiredText(
    decisionObject.prompt,
    "decision.prompt",
    issues,
    1_000,
  );
  const choiceIds = new Set<string>();
  const choices = requiredArray(decisionObject.choices, "decision.choices", issues).map(
    (item, index): GeneratedChoice => {
      const choice = requiredObject(item, `decision.choices[${index}]`, issues);
      const id = requiredText(choice.id, `decision.choices[${index}].id`, issues, 160);
      if (choiceIds.has(id)) issues.push(`候选项 ID ${id} 重复。`);
      choiceIds.add(id);
      const stance = oneOf(
        choice.stance,
        [
          "accept",
          "partial_accept",
          "reject",
          "benevolent",
          "neutral",
          "malicious",
        ] as const,
        `decision.choices[${index}].stance`,
        issues,
      );
      const allowedStances =
        context === "proposal_response"
          ? new Set(["accept", "partial_accept", "reject"])
          : new Set(["benevolent", "neutral", "malicious"]);
      if (!allowedStances.has(stance)) {
        issues.push(`候选项 ${id} 的立场与提问类型不一致。`);
      }
      return {
        id,
        label: requiredText(choice.label, `decision.choices[${index}].label`, issues, 120),
        description: requiredText(
          choice.description,
          `decision.choices[${index}].description`,
          issues,
          500,
        ),
        stance,
      };
    },
  );
  if (choices.length < 2) issues.push("每轮至少需要两个真正不同的候选项。");

  const stateCommit = requiredObject(value.stateCommit, "stateCommit", issues);
  let sceneTransition: GeneratedSceneTransition | null = null;
  if (
    stateCommit.sceneTransition === null ||
    stateCommit.sceneTransition === undefined
  ) {
    issues.push("stateCommit.sceneTransition 必须是对象。");
  } else {
    const transition = requiredObject(
      stateCommit.sceneTransition,
      "stateCommit.sceneTransition",
      issues,
    );
    const locationId = requiredText(
      transition.locationId,
      "stateCommit.sceneTransition.locationId",
      issues,
      160,
    );
    if (inactiveLocationIds.has(locationId)) {
      issues.push(`场景变化不能进入已经停用的地点 ${locationId}。`);
    }
    const presentCharacterIds = textArray(
      transition.presentCharacterIds,
      "stateCommit.sceneTransition.presentCharacterIds",
      issues,
      1,
    );
    for (const characterId of presentCharacterIds) {
      if (!characterIds.has(characterId)) {
        issues.push(`场景变化引用了不存在或停用的角色 ${characterId}。`);
      }
    }
    if (playerCharacterId && !presentCharacterIds.includes(playerCharacterId)) {
      issues.push("回合结束时的在场阵容必须包含玩家角色。");
    }
    const isNewLocation = !activeLocationIds.has(locationId);
    const locationName = isNewLocation
      ? requiredText(
          transition.locationName,
          "stateCommit.sceneTransition.locationName",
          issues,
          120,
        )
      : trimText(transition.locationName, 120);
    const locationDescription = isNewLocation
      ? requiredText(
          transition.locationDescription,
          "stateCommit.sceneTransition.locationDescription",
          issues,
          2_000,
        )
      : trimText(transition.locationDescription, 2_000);
    const transitionEvidence = readEvidence(
      transition.evidence,
      "stateCommit.sceneTransition.evidence",
      knownEvidenceIds,
      issues,
      1,
    );
    if (
      !transitionEvidence.some(
        (evidenceId) => eventIds.has(evidenceId) || dialogueIds.has(evidenceId),
      )
    ) {
      issues.push("场景变化必须引用本轮真实发生的事件或对话。");
    }
    const offstageUpdates: GeneratedOffstageUpdate[] = [];
    let timeAdvance: SceneTimeAdvance | undefined;
    if (transition.timeAdvance !== undefined) {
      if (
        transition.timeAdvance === "moment" ||
        transition.timeAdvance === "hours" ||
        transition.timeAdvance === "one_day" ||
        transition.timeAdvance === "several_days"
      ) {
        timeAdvance = transition.timeAdvance;
      } else {
        issues.push(
          "sceneTransition.timeAdvance 必须是 moment、hours、one_day 或 several_days。",
        );
      }
    }
    let gameTimeDayNext: number | undefined;
    if (transition.gameTimeDayNext !== undefined) {
      if (
        typeof transition.gameTimeDayNext === "number" &&
        Number.isInteger(transition.gameTimeDayNext) &&
        transition.gameTimeDayNext >= currentGameTimeDay
      ) {
        gameTimeDayNext = transition.gameTimeDayNext;
      } else {
        issues.push(
          `sceneTransition.gameTimeDayNext 必须是 ≥ 当前游戏内日期（第 ${currentGameTimeDay} 天）的整数（本回合结束日期，不得回退）。`,
        );
      }
    }
    // 两者都提供时以 gameTimeDayNext 为准；若与 timeAdvance 的语义（推进天数）明显
    // 冲突，产生一条 normalizationWarning 提醒模型对齐，但不拒绝回合。
    if (
      gameTimeDayNext !== undefined &&
      timeAdvance !== undefined &&
      gameTimeDayNext - currentGameTimeDay !==
        (timeAdvance === "several_days"
          ? 3
          : timeAdvance === "one_day"
            ? 1
            : 0)
    ) {
      normalizationWarnings.push(
        `sceneTransition.gameTimeDayNext（第 ${gameTimeDayNext} 天，相对当前第 ${currentGameTimeDay} 天推进 ${gameTimeDayNext - currentGameTimeDay} 天）与 timeAdvance（${timeAdvance}）的语义不一致；日期已按 gameTimeDayNext 为准推进，请检查两个字段是否应保持一致。`,
      );
    }
    if (transition.offstageUpdates !== undefined) {
      if (!Array.isArray(transition.offstageUpdates)) {
        issues.push("sceneTransition.offstageUpdates 必须是数组。");
      } else {
        transition.offstageUpdates.slice(0, 20).forEach((item, index) => {
          const update = requiredObject(
            item,
            `sceneTransition.offstageUpdates[${index}]`,
            issues,
          );
          const characterId = requiredText(
            update.characterId,
            `sceneTransition.offstageUpdates[${index}].characterId`,
            issues,
            160,
          );
          if (characterId && !characterIds.has(characterId)) {
            issues.push(
              `离场移动引用了不存在或停用的角色 ${characterId}。`,
            );
          }
          if (characterId && presentCharacterIds.includes(characterId)) {
            issues.push(
              `离场移动的目标角色 ${characterId} 不能同时出现在本回合在场阵容中。`,
            );
          }
          const locationId = requiredText(
            update.locationId,
            `sceneTransition.offstageUpdates[${index}].locationId`,
            issues,
            160,
          );
          if (locationId && inactiveLocationIds.has(locationId)) {
            issues.push(`离场移动不能进入已经停用的地点 ${locationId}。`);
          }
          const locationName = trimText(update.locationName, 120);
          const locationDescription = trimText(
            update.locationDescription,
            2_000,
          );
          if (locationId && !activeLocationIds.has(locationId) && !locationName) {
            issues.push("离场移动进入新地点时必须提供地点名称。");
          }
          const reason = trimText(update.reason, 1_000);
          if (characterId && locationId) {
            offstageUpdates.push({
              characterId,
              locationId,
              ...(locationName ? { locationName } : {}),
              ...(locationDescription ? { locationDescription } : {}),
              reason,
            });
          }
        });
      }
    }
    sceneTransition = {
      locationId,
      ...(locationName ? { locationName } : {}),
      ...(locationDescription ? { locationDescription } : {}),
      presentCharacterIds,
      reason: requiredText(
        transition.reason,
        "stateCommit.sceneTransition.reason",
        issues,
        1_000,
      ),
      evidence: transitionEvidence,
      ...(offstageUpdates.length > 0 ? { offstageUpdates } : {}),
      ...(timeAdvance !== undefined ? { timeAdvance } : {}),
      ...(gameTimeDayNext !== undefined ? { gameTimeDayNext } : {}),
    };
  }
  const characterStateChanges = requiredArray(
    stateCommit.characterStateChanges,
    "stateCommit.characterStateChanges",
    issues,
  ).map((item, index): GeneratedCharacterStateChange => {
    const change = requiredObject(
      item,
      `stateCommit.characterStateChanges[${index}]`,
      issues,
    );
    const characterId = requiredText(
      change.characterId,
      `stateCommit.characterStateChanges[${index}].characterId`,
      issues,
      160,
    );
    if (!characterIds.has(characterId)) {
      issues.push(`角色状态变化引用了不存在的角色 ${characterId}。`);
    }
    const patch = requiredObject(
      change.patch,
      `stateCommit.characterStateChanges[${index}].patch`,
      issues,
    );
    if (Object.keys(patch).length === 0) issues.push("角色状态补丁不能为空。");
    if ("present" in patch || "locationId" in patch) {
      issues.push(
        "人物进出场和所在地点必须写入 sceneTransition，不能写入普通角色状态补丁。",
      );
    }
    if (patch.restriction !== undefined) {
      if (patch.restriction === null) {
        // null 表示解除行动受限（JSON Merge Patch 删除语义）。
      } else if (isObject(patch.restriction)) {
        const restriction = patch.restriction;
        if (
          typeof restriction.kind !== "string" ||
          !RESTRICTION_KINDS.includes(restriction.kind as RestrictionKind)
        ) {
          issues.push(
            `角色状态补丁的 restriction.kind 必须是 ${RESTRICTION_KINDS.join("、")} 之一。`,
          );
        }
        if (
          typeof restriction.summary !== "string" ||
          !restriction.summary.trim() ||
          restriction.summary.trim().length > 200
        ) {
          issues.push(
            "角色状态补丁的 restriction.summary 必须是 1 到 200 个字符的受限原因。",
          );
        }
        if (
          restriction.sinceTurnId !== undefined &&
          (typeof restriction.sinceTurnId !== "string" ||
            !restriction.sinceTurnId.trim())
        ) {
          issues.push(
            "角色状态补丁的 restriction.sinceTurnId 必须是回合 ID 文本。",
          );
        }
      } else {
        issues.push(
          "角色状态补丁的 restriction 必须是对象（设置受限）或 null（解除受限）。",
        );
      }
    }
    if (patch.statuses !== undefined) {
      validateStatusesArray(
        patch.statuses,
        `stateCommit.characterStateChanges[${index}].patch.statuses`,
        issues,
      );
    }
    if (patch.knownFacts !== undefined) {
      validateKnownFactsArray(
        patch.knownFacts,
        `stateCommit.characterStateChanges[${index}].patch.knownFacts`,
        issues,
      );
    }
    if (patch.attributes !== undefined) {
      if (!isObject(patch.attributes)) {
        issues.push(
          `角色状态补丁的 attributes 必须是对象，且只能包含白名单属性。`,
        );
      } else {
        for (const [attributeName, attributeValue] of Object.entries(
          patch.attributes,
        )) {
          if (!isAttributeName(attributeName)) {
            issues.push(
              `角色状态补丁的属性“${attributeName}”不在白名单中（允许：${ATTRIBUTE_WHITELIST.join("、")}）。`,
            );
          }
          if (
            typeof attributeValue !== "number" ||
            !Number.isFinite(attributeValue) ||
            attributeValue < 0 ||
            attributeValue > 100
          ) {
            issues.push(
              `角色状态补丁的属性“${attributeName}”必须是 0 到 100 之间的数值。`,
            );
          }
        }
      }
    }
    return {
      characterId,
      patch,
      duration: oneOf(
        change.duration,
        ["instant", "scene", "until_changed", "permanent"] as const,
        `stateCommit.characterStateChanges[${index}].duration`,
        issues,
      ),
      reason: requiredText(
        change.reason,
        `stateCommit.characterStateChanges[${index}].reason`,
        issues,
        1_000,
      ),
      evidence: readEvidence(
        change.evidence,
        `stateCommit.characterStateChanges[${index}].evidence`,
        knownEvidenceIds,
        issues,
        1,
      ),
    };
  });

  const relationshipChanges = requiredArray(
    stateCommit.relationshipChanges,
    "stateCommit.relationshipChanges",
    issues,
  ).map((item, index): GeneratedRelationshipChange => {
    const change = requiredObject(
      item,
      `stateCommit.relationshipChanges[${index}]`,
      issues,
    );
    const sourceCharacterId = requiredText(
      change.sourceCharacterId,
      `stateCommit.relationshipChanges[${index}].sourceCharacterId`,
      issues,
      160,
    );
    const targetCharacterId = requiredText(
      change.targetCharacterId,
      `stateCommit.relationshipChanges[${index}].targetCharacterId`,
      issues,
      160,
    );
    if (!characterIds.has(sourceCharacterId) || !characterIds.has(targetCharacterId)) {
      issues.push("关系变化引用了不存在的角色。");
    }
    if (sourceCharacterId === targetCharacterId) {
      issues.push("关系变化的来源角色和目标角色不能相同。");
    }
    const delta = typeof change.delta === "number" ? change.delta : Number.NaN;
    if (!Number.isFinite(delta) || delta < -100 || delta > 100) {
      issues.push("关系变化 delta 必须位于 -100 到 100。 ");
    }
    return {
      sourceCharacterId,
      targetCharacterId,
      dimension: oneOf(
        change.dimension,
        ["trust", "affection", "fear", "hostility", "respect"] as const,
        `stateCommit.relationshipChanges[${index}].dimension`,
        issues,
      ),
      delta: Number.isFinite(delta) ? delta : 0,
      reason: requiredText(
        change.reason,
        `stateCommit.relationshipChanges[${index}].reason`,
        issues,
        1_000,
      ),
      evidence: readEvidence(
        change.evidence,
        `stateCommit.relationshipChanges[${index}].evidence`,
        knownEvidenceIds,
        issues,
        1,
      ),
    };
  });

  const characterCardChanges = requiredArray(
    stateCommit.characterCardChanges,
    "stateCommit.characterCardChanges",
    issues,
  ).map((item, index): GeneratedCharacterCardChange => {
    const change = requiredObject(
      item,
      `stateCommit.characterCardChanges[${index}]`,
      issues,
    );
    const characterId = requiredText(
      change.characterId,
      `stateCommit.characterCardChanges[${index}].characterId`,
      issues,
      160,
    );
    if (!characterIds.has(characterId)) {
      issues.push(`角色卡变化引用了不存在的角色 ${characterId}。`);
    }
    const operation = oneOf(
      change.operation,
      ["add", "update", "deactivate"] as const,
      `stateCommit.characterCardChanges[${index}].operation`,
      issues,
    );
    if (operation !== "deactivate" && change.value === undefined) {
      issues.push("角色卡新增或更新必须包含 value。");
    }
    const sourceTurnId = requiredText(
      change.sourceTurnId,
      `stateCommit.characterCardChanges[${index}].sourceTurnId`,
      issues,
      160,
    );
    if (sourceTurnId !== turnId) issues.push("角色卡变化的 sourceTurnId 不匹配本轮。");
    return {
      characterId,
      operation,
      path: oneOf(
        change.path,
        cardPaths,
        `stateCommit.characterCardChanges[${index}].path`,
        issues,
      ),
      ...(change.value !== undefined ? { value: change.value } : {}),
      reason: requiredText(
        change.reason,
        `stateCommit.characterCardChanges[${index}].reason`,
        issues,
        1_000,
      ),
      evidence: readEvidence(
        change.evidence,
        `stateCommit.characterCardChanges[${index}].evidence`,
        knownEvidenceIds,
        issues,
        1,
      ),
      sourceTurnId,
    };
  });

  const worldBookChanges = requiredArray(
    stateCommit.worldBookChanges,
    "stateCommit.worldBookChanges",
    issues,
  ).map((item, index): GeneratedWorldBookChange => {
    const change = requiredObject(
      item,
      `stateCommit.worldBookChanges[${index}]`,
      issues,
    );
    const operation = oneOf(
      change.operation,
      ["create", "update", "deactivate"] as const,
      `stateCommit.worldBookChanges[${index}].operation`,
      issues,
    );
    const sourceTurnId = requiredText(
      change.sourceTurnId,
      `stateCommit.worldBookChanges[${index}].sourceTurnId`,
      issues,
      160,
    );
    if (sourceTurnId !== turnId) issues.push("世界书变化的 sourceTurnId 不匹配本轮。");
    const common = {
      sourceTurnId,
      ...(trimText(change.sourceStoryDirectionId, 160)
        ? { sourceStoryDirectionId: trimText(change.sourceStoryDirectionId, 160) }
        : {}),
      reason: requiredText(
        change.reason,
        `stateCommit.worldBookChanges[${index}].reason`,
        issues,
        1_000,
      ),
      evidence: readEvidence(
        change.evidence,
        `stateCommit.worldBookChanges[${index}].evidence`,
        knownEvidenceIds,
        issues,
        1,
      ),
    };
    if (operation === "create") {
      const entry = requiredObject(
        change.entry,
        `stateCommit.worldBookChanges[${index}].entry`,
        issues,
      );
      textArray(entry.keys, `stateCommit.worldBookChanges[${index}].entry.keys`, issues, 1);
      requiredText(
        entry.content,
        `stateCommit.worldBookChanges[${index}].entry.content`,
        issues,
      );
      if (typeof entry.enabled !== "boolean") issues.push("世界书条目 enabled 必须是布尔值。");
      return { operation, entry, ...common };
    }
    const targetEntryId = requiredText(
      change.targetEntryId,
      `stateCommit.worldBookChanges[${index}].targetEntryId`,
      issues,
      160,
    );
    if (!worldEntryIds.has(targetEntryId)) {
      issues.push(`世界书变化引用了不存在的条目 ${targetEntryId}。`);
    }
    if (operation === "update") {
      const patch = requiredObject(
        change.patch,
        `stateCommit.worldBookChanges[${index}].patch`,
        issues,
      );
      if (Object.keys(patch).length === 0) issues.push("世界书更新补丁不能为空。");
      return { operation, targetEntryId, patch, ...common };
    }
    return { operation, targetEntryId, ...common };
  });

  const plotThreadStates = adventure.branchState.states.filter(
    (state) => state.entityType === "plot_thread",
  );
  const plotThreadById = new Map(
    plotThreadStates.map((state) => [readString(state.state.threadId), state]),
  );
  const plotThreadUpdates = (() => {
    if (stateCommit.plotThreadUpdates === undefined) return [];
    if (!Array.isArray(stateCommit.plotThreadUpdates)) {
      issues.push("stateCommit.plotThreadUpdates 必须是数组。");
      return [];
    }
    if (stateCommit.plotThreadUpdates.length > 10) {
      issues.push("每轮最多报告 10 项伏笔变化。");
    }
    return stateCommit.plotThreadUpdates.slice(0, 10).map(
      (item, index): GeneratedPlotThreadUpdate => {
        const update = requiredObject(
          item,
          `stateCommit.plotThreadUpdates[${index}]`,
          issues,
        );
        const threadId = requiredText(
          update.threadId,
          `stateCommit.plotThreadUpdates[${index}].threadId`,
          issues,
          160,
        );
        const operation = oneOf(
          update.operation,
          ["seed", "payoff"] as const,
          `stateCommit.plotThreadUpdates[${index}].operation`,
          issues,
        );
        const threadState = plotThreadById.get(threadId);
        if (threadId && !threadState) {
          issues.push(`伏笔变化引用了不存在的伏笔 ${threadId}。`);
        } else if (threadState && threadState.isActive) {
          const currentStatus = readString(threadState.state.status);
          if (operation === "seed" && currentStatus !== "dormant") {
            issues.push(
              `伏笔 ${threadId} 的种子条件已经在之前的回合满足，不能再次报告 seed。`,
            );
          }
          if (operation === "payoff" && currentStatus !== "seeded") {
            issues.push(
              `伏笔 ${threadId} 尚未激活，不能直接报告 payoff。`,
            );
          }
        }
        return {
          threadId,
          operation,
          reason: requiredText(
            update.reason,
            `stateCommit.plotThreadUpdates[${index}].reason`,
            issues,
            1_000,
          ),
          evidence: readEvidence(
            update.evidence,
            `stateCommit.plotThreadUpdates[${index}].evidence`,
            knownEvidenceIds,
            issues,
            1,
          ),
        };
      },
    );
  })();

  const plotTriggerStates = adventure.branchState.states.filter(
    (state) => state.entityType === "plot_trigger",
  );
  const plotTriggerById = new Map(
    plotTriggerStates.map((state) => [readString(state.state.triggerId), state]),
  );
  const plotTriggerUpdates = (() => {
    if (stateCommit.plotTriggerUpdates === undefined) return [];
    if (!Array.isArray(stateCommit.plotTriggerUpdates)) {
      issues.push("stateCommit.plotTriggerUpdates 必须是数组。");
      return [];
    }
    if (stateCommit.plotTriggerUpdates.length > 10) {
      issues.push("每轮最多报告 10 个触发器变化。");
    }
    return stateCommit.plotTriggerUpdates.slice(0, 10).map(
      (item, index): GeneratedPlotTriggerUpdate => {
        const update = requiredObject(
          item,
          `stateCommit.plotTriggerUpdates[${index}]`,
          issues,
        );
        const triggerId = requiredText(
          update.triggerId,
          `stateCommit.plotTriggerUpdates[${index}].triggerId`,
          issues,
          160,
        );
        const operation = oneOf(
          update.operation,
          ["fire"] as const,
          `stateCommit.plotTriggerUpdates[${index}].operation`,
          issues,
        );
        const triggerState = plotTriggerById.get(triggerId);
        if (triggerId && !triggerState) {
          issues.push(`触发器变化引用了不存在的触发器 ${triggerId}。`);
        } else if (triggerState && readString(triggerState.state.status) === "fired") {
          issues.push(`触发器 ${triggerId} 已经触发，不能重复触发。`);
        }
        return {
          triggerId,
          operation,
          reason: requiredText(
            update.reason,
            `stateCommit.plotTriggerUpdates[${index}].reason`,
            issues,
            1_000,
          ),
          evidence: readEvidence(
            update.evidence,
            `stateCommit.plotTriggerUpdates[${index}].evidence`,
            knownEvidenceIds,
            issues,
            1,
          ),
        };
      },
    );
  })();

  const appointments = validateAppointmentsArray(
    stateCommit.appointments,
    "stateCommit.appointments",
    issues,
    characterIds,
  );

  let storyDirectionEvaluation: ValidatedGeneratedTurn["stateCommit"]["storyDirectionEvaluation"] = null;
  if (stateCommit.storyDirectionEvaluation !== null) {
    const evaluation = requiredObject(
      stateCommit.storyDirectionEvaluation,
      "stateCommit.storyDirectionEvaluation",
      issues,
    );
    const status = oneOf(
      evaluation.status,
      ["active", "completed"] as const,
      "stateCommit.storyDirectionEvaluation.status",
      issues,
    );
    const continuity = oneOf(
      evaluation.continuity,
      ["aligned", "diverged", "uncertain"] as const,
      "stateCommit.storyDirectionEvaluation.continuity",
      issues,
    );
    const continuityReason = requiredText(
      evaluation.continuityReason,
      "stateCommit.storyDirectionEvaluation.continuityReason",
      issues,
      1_000,
    );
    let divergenceState: NonNullable<
      ValidatedGeneratedTurn["stateCommit"]["storyDirectionEvaluation"]
    >["divergenceState"] = undefined;
    if (
      evaluation.divergenceState !== null &&
      evaluation.divergenceState !== undefined
    ) {
      const divergence = requiredObject(
        evaluation.divergenceState,
        "stateCommit.storyDirectionEvaluation.divergenceState",
        issues,
      );
      const outlineRecoverable = oneOf(
        divergence.outlineRecoverable,
        ["recoverable", "broken"] as const,
        "stateCommit.storyDirectionEvaluation.divergenceState.outlineRecoverable",
        issues,
      );
      const badEndDrift = oneOf(
        divergence.badEndDrift,
        ["rising", "neutral"] as const,
        "stateCommit.storyDirectionEvaluation.divergenceState.badEndDrift",
        issues,
      );
      const reason = requiredText(
        divergence.reason,
        "stateCommit.storyDirectionEvaluation.divergenceState.reason",
        issues,
        500,
      );
      if (continuity !== "diverged") {
        issues.push(
          "divergenceState 只能在 continuity=diverged 时填写；aligned 或 uncertain 时必须省略或置 null。",
        );
      }
      divergenceState = { outlineRecoverable, badEndDrift, reason };
    }
    let recommendedModuleId: string | null = null;
    if (evaluation.recommendedModuleId !== null) {
      recommendedModuleId = requiredText(
        evaluation.recommendedModuleId,
        "stateCommit.storyDirectionEvaluation.recommendedModuleId",
        issues,
        120,
      );
    }
    let suggestedNextDirection: NonNullable<
      NonNullable<ValidatedGeneratedTurn["stateCommit"]["storyDirectionEvaluation"]>["suggestedNextDirection"]
    > | null = null;
    if (evaluation.suggestedNextDirection !== null) {
      const suggestion = requiredObject(
        evaluation.suggestedNextDirection,
        "stateCommit.storyDirectionEvaluation.suggestedNextDirection",
        issues,
      );
      suggestedNextDirection = {
        title: requiredText(
          suggestion.title,
          "stateCommit.storyDirectionEvaluation.suggestedNextDirection.title",
          issues,
          120,
        ),
        content: requiredText(
          suggestion.content,
          "stateCommit.storyDirectionEvaluation.suggestedNextDirection.content",
          issues,
          1_000,
        ),
        reason: requiredText(
          suggestion.reason,
          "stateCommit.storyDirectionEvaluation.suggestedNextDirection.reason",
          issues,
          1_000,
        ),
      };
    }

    const storyModules = adventure.branchState.states.filter(
      (state) => state.entityType === "story_module" && state.isActive,
    );
    const activeDirection = adventure.branchState.states.find(
      (state) => state.entityType === "story_direction" && state.isActive,
    );
    const activeModuleId =
      typeof activeDirection?.state.moduleId === "string"
        ? activeDirection.state.moduleId
        : "";
    const completedModuleIds = new Set(
      storyModules
        .filter(
          (module) =>
            module.state.status === "completed" ||
            (status === "completed" && module.state.moduleId === activeModuleId),
        )
        .map((module) =>
          typeof module.state.moduleId === "string" ? module.state.moduleId : "",
        )
        .filter(Boolean),
    );
    const readyModuleIds = new Set(
      storyModules
        .filter((module) => {
          if (module.state.status !== "queued" || module.state.autoContinue === false) {
            return false;
          }
          const prerequisites = Array.isArray(module.state.prerequisiteModuleIds)
            ? module.state.prerequisiteModuleIds.filter(
                (item): item is string => typeof item === "string",
              )
            : [];
          return prerequisites.every((id) => completedModuleIds.has(id));
        })
        .map((module) =>
          typeof module.state.moduleId === "string" ? module.state.moduleId : "",
        )
        .filter(Boolean),
    );

    if (status === "active") {
      if (recommendedModuleId || suggestedNextDirection) {
        recommendedModuleId = null;
        suggestedNextDirection = null;
        normalizationWarnings.push(
          "模型在当前剧情走向尚未完成时提前提供了后续目标；系统已忽略这些字段。",
        );
      }
    } else {
      if (recommendedModuleId && suggestedNextDirection) {
        if (
          continuity === "aligned" &&
          readyModuleIds.has(recommendedModuleId)
        ) {
          suggestedNextDirection = null;
          normalizationWarnings.push(
            "模型同时返回了预埋任务和新目标；系统已优先采用满足条件的预埋任务。",
          );
        } else {
          recommendedModuleId = null;
          normalizationWarnings.push(
            "模型同时返回了预埋任务和新目标；系统已忽略不可接续的预埋任务并采用自然生成的新目标。",
          );
        }
      }
      if (!recommendedModuleId && !suggestedNextDirection) {
        issues.push("剧情走向完成后必须接续可用的预埋任务，或给出自然生长的新目标。");
      }
      if (recommendedModuleId) {
        if (continuity !== "aligned") {
          issues.push("只有剧情未偏离剧本时才能接续预埋任务。");
        }
        if (!readyModuleIds.has(recommendedModuleId)) {
          issues.push(`推荐的剧情任务 ${recommendedModuleId} 不存在、尚未满足前置条件或已经结束。`);
        }
      }
    }
    storyDirectionEvaluation = {
      status,
      reason: requiredText(
        evaluation.reason,
        "stateCommit.storyDirectionEvaluation.reason",
        issues,
        1_000,
      ),
      evidence: readEvidence(
        evaluation.evidence,
        "stateCommit.storyDirectionEvaluation.evidence",
        knownEvidenceIds,
        issues,
        status === "completed" ? 1 : 0,
      ),
      continuity,
      continuityReason,
      recommendedModuleId,
      suggestedNextDirection,
      ...(divergenceState !== undefined ? { divergenceState } : {}),
    };
  }

  // 状态一致性检测（警告级）：正文提到词条但本轮 patch.statuses 未同步 → 提醒，不拒绝回合。
  for (const warning of collectStatusSyncWarnings({
    scene,
    events,
    characterStates,
    characterStateChanges,
  })) {
    normalizationWarnings.push(warning);
  }

  // 地点一致性检测（警告级）：场景移动时正文提到的已知地点与 locationId 不一致 → 提醒，不拒绝回合。
  for (const warning of collectLocationConsistencyWarnings({
    scene,
    events,
    sceneTransition,
    adventure,
  })) {
    normalizationWarnings.push(warning);
  }

  // 时间短语一致性检测：正文暗示跨日/跨夜但本轮未声明日期推进 → 提醒，不拒绝回合。
  // 五回合一天模式下日期由系统按回合推导（模型声明会被忽略），该警告没有意义，不触发。
  // 日期修正重写（rewriteMode=time_fix）专为"正文暗示时间流逝但日期未推进"而生，
  // 若重写结果仍触发该警告，说明时间问题没有被解决，升级为校验错误走修复重试。
  if (options.timeMode !== "turn_based") {
    const timeWarnings = collectTimePhraseConsistencyWarnings({
      scene,
      events,
      sceneTransition,
    });
    if (options.rewriteMode === "time_fix" && timeWarnings.length > 0) {
      const matchedPhrase =
        findDayCrossingTimePhrase(
          [scene, ...events.map((event) => event.summary)].join("\n"),
        ) ?? "次日/数日后";
      issues.push(
        `日期修正重写失败：正文仍出现时间流逝短语「${matchedPhrase}」但游戏内日期未推进（sceneTransition 未提供 gameTimeDayNext 且 timeAdvance 为 moment/hours/缺省）。本次重写的专项目标就是修正时间推进：若剧情确实跨日，必须设置 sceneTransition.gameTimeDayNext（整数，≥ 当前第 ${currentGameTimeDay} 天）使正文时间描写与游戏内日期一致（如正文写"次日"则 gameTimeDayNext = 当前日 + 1）；若正文本不应有时间流逝，必须改写正文，移除或修正该时间流逝短语。`,
      );
    } else {
      for (const warning of timeWarnings) {
        normalizationWarnings.push(warning);
      }
    }
  }

  // 选项差异检测（警告级）：本轮 decision.choices 与最近 2-3 回合的候选项高度相似
  // → 提醒提供有实质差异的选择，不拒绝回合。
  for (const warning of collectChoiceDiversityWarnings({
    choices,
    adventure,
  })) {
    normalizationWarnings.push(warning);
  }

  const warnings = [
    ...requiredArray(value.warnings, "warnings", issues).map(
      (warning, index) =>
        requiredText(warning, `warnings[${index}]`, issues, 1_000),
    ),
    ...normalizationWarnings,
  ];

  let sourceProgress: number | null = null;
  if (value.sourceProgress !== undefined) {
    if (
      typeof value.sourceProgress !== "number" ||
      !Number.isInteger(value.sourceProgress) ||
      value.sourceProgress < 1
    ) {
      issues.push("sourceProgress 必须是大于等于 1 的整数；本轮未触及新章节时省略该字段。");
    } else {
      sourceProgress = value.sourceProgress;
    }
  }
  const summaryPatch =
    typeof stateCommit.summaryPatch === "string"
      ? stateCommit.summaryPatch.trim().slice(0, 4_000)
      : "";
  if (typeof stateCommit.summaryPatch !== "string") {
    issues.push("stateCommit.summaryPatch 必须是字符串。");
  }

  // 行动受限硬拦截：发言/登场/离场移动/属性判定的角色，本轮必须已解除受限
  // 或本来就没有 restriction。解除的唯一确定性信号：本轮 characterStateChanges
  // 中该角色的 patch.restriction 为 null（同一轮事件描写复活、越狱、挣脱控制等）。
  const clearedRestrictionIds = new Set(
    characterStateChanges
      .filter((change) => change.patch.restriction === null)
      .map((change) => change.characterId),
  );
  const isRestrictedAndUncleared = (characterId: string) =>
    characterRestrictions.has(characterId) &&
    characterRestrictions.get(characterId) !== null &&
    !clearedRestrictionIds.has(characterId);
  for (const line of dialogue) {
    if (isRestrictedAndUncleared(line.speakerId)) {
      issues.push(
        `行动受限角色 ${line.speakerId} 不能自由发言；必须在本轮 characterStateChanges 中把该角色的 patch.restriction 设为 null 解除限制（并写入对应解除事件），或让该角色保持沉默。`,
      );
    }
  }
  if (sceneTransition) {
    for (const characterId of sceneTransition.presentCharacterIds) {
      if (!isRestrictedAndUncleared(characterId)) continue;
      const wasPresent =
        characterStates.get(characterId)?.present !== false;
      if (!wasPresent) {
        issues.push(
          `行动受限角色 ${characterId} 不能在本轮重新登场；必须在同一回合通过 characterStateChanges 的 patch.restriction=null 解除限制（复活、越狱、挣脱控制等），并写入对应事件。`,
        );
      }
    }
    for (const update of sceneTransition.offstageUpdates ?? []) {
      if (isRestrictedAndUncleared(update.characterId)) {
        issues.push(
          `行动受限角色 ${update.characterId} 不能发生离场移动；必须先在 characterStateChanges 中解除其行动限制。`,
        );
      }
    }
  }
  for (const check of attributeChecks) {
    if (isRestrictedAndUncleared(check.characterId)) {
      issues.push(
        `行动受限角色 ${check.characterId} 不能参与属性判定；必须先在 characterStateChanges 中解除其行动限制。`,
      );
    }
  }

  if (issues.length > 0) throw new GeneratedTurnValidationError(issues);

  return {
    raw:
      normalizationWarnings.length > 0
        ? {
            ...value,
            stateCommit: {
              ...stateCommit,
              storyDirectionEvaluation: storyDirectionEvaluation
                ? {
                    ...(isObject(stateCommit.storyDirectionEvaluation)
                      ? stateCommit.storyDirectionEvaluation
                      : {}),
                    recommendedModuleId:
                      storyDirectionEvaluation.recommendedModuleId,
                    suggestedNextDirection:
                      storyDirectionEvaluation.suggestedNextDirection,
                  }
                : null,
            },
            warnings,
          }
        : value,
    turn: { scene, events, dialogue, characterThoughts },
    attributeChecks,
    sourceProgress,
    decision: {
      context,
      prompt: decisionPrompt,
      choices,
    },
    stateCommit: {
      sceneTransition,
      characterStateChanges,
      relationshipChanges,
      characterCardChanges,
      worldBookChanges,
      plotThreadUpdates,
      plotTriggerUpdates,
      appointments,
      storyDirectionEvaluation,
      summaryPatch,
    },
    warnings,
  };
}
