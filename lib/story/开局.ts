import type {
  AdventureCharacterInput,
  AdventureRelationshipInput,
  AdventureStoryModuleInput,
  StartAdventureInput,
} from "@/lib/storage/story-store";
import {
  ImportFileError,
  parseCharacterCardDocument,
  parseWorldBookDocument,
} from "../import/酒馆文件.ts";
import {
  parseSourceDocumentInput,
  SourceReferenceInputError,
} from "../reference/原文参考.ts";
import {
  ATTRIBUTE_WHITELIST,
  isAttributeName,
} from "./判定服务.ts";

const limits = {
  short: 80,
  description: 2_000,
  premise: 6_000,
  scene: 8_000,
  direction: 1_000,
  moduleNote: 2_000,
  locationDescription: 4_000,
} as const;

export class AdventureInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "开局信息无效。");
    this.name = "AdventureInputError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRequiredText(
  source: Record<string, unknown>,
  key: string,
  label: string,
  maximumLength: number,
  issues: string[],
) {
  const value = source[key];
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

function readOptionalText(
  source: Record<string, unknown>,
  key: string,
  label: string,
  maximumLength: number,
  issues: string[],
) {
  const value = source[key];
  if (value === undefined || value === null || value === "") {
    return "";
  }
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

function readSection(
  source: Record<string, unknown>,
  key: string,
  label: string,
  issues: string[],
) {
  const value = source[key];
  if (!isRecord(value)) {
    issues.push(`${label}格式无效。`);
    return {};
  }
  return value;
}

function readCharacter(
  source: Record<string, unknown>,
  label: string,
  issues: string[],
): AdventureCharacterInput {
  let card: AdventureCharacterInput["card"];
  if (source.card !== undefined) {
    try {
      card = parseCharacterCardDocument(source.card).card;
    } catch (error) {
      if (error instanceof ImportFileError) {
        issues.push(
          ...error.issues.map((issue) => `${label}导入卡：${issue}`),
        );
      } else {
        issues.push(`${label}导入卡格式无效。`);
      }
    }
  }
  const character: AdventureCharacterInput = {
    name: readRequiredText(source, "name", `${label}姓名`, limits.short, issues),
    role: readRequiredText(
      source,
      "role",
      `${label}身份`,
      limits.description,
      issues,
    ),
    personality: readRequiredText(
      source,
      "personality",
      `${label}性格`,
      limits.description,
      issues,
    ),
    firstMessage: readOptionalText(
      source,
      "firstMessage",
      `${label}开场台词`,
      limits.description,
      issues,
    ),
    ...(card ? { card } : {}),
  };
  if (source.initiallyPresent !== undefined) {
    if (typeof source.initiallyPresent !== "boolean") {
      issues.push(`${label}开场在场状态必须是布尔值。`);
    } else {
      character.initiallyPresent = source.initiallyPresent;
    }
  }
  return character;
}

function readTextList(
  value: unknown,
  label: string,
  maximumItems: number,
  maximumLength: number,
  issues: string[],
) {
  if (!Array.isArray(value)) {
    issues.push(`${label}必须是文本数组。`);
    return [];
  }
  if (value.length > maximumItems) {
    issues.push(`${label}最多允许 ${maximumItems} 项。`);
  }
  return value.slice(0, maximumItems).flatMap((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      issues.push(`${label}第 ${index + 1} 项不能为空。`);
      return [];
    }
    const trimmed = item.trim();
    if (trimmed.length > maximumLength) {
      issues.push(`${label}第 ${index + 1} 项不能超过 ${maximumLength} 个字符。`);
    }
    return [trimmed.slice(0, maximumLength)];
  });
}

function readStoryModules(value: unknown, issues: string[]) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push("剧情任务模块必须是数组。");
    return [];
  }
  if (value.length > 30) issues.push("剧本包最多允许 30 个剧情任务模块。");
  const modules = value.slice(0, 30).flatMap((item, index) => {
    if (!isRecord(item)) {
      issues.push(`剧情任务 ${index + 1} 格式无效。`);
      return [];
    }
    const id = readRequiredText(
      item,
      "id",
      `剧情任务 ${index + 1} ID`,
      120,
      issues,
    );
    if (id && !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id)) {
      issues.push(`剧情任务 ${index + 1} ID 只能包含文字、数字、点、下划线和连字符。`);
    }
    let autoContinue = true;
    if (item.autoContinue !== undefined) {
      if (typeof item.autoContinue !== "boolean") {
        issues.push(`剧情任务 ${index + 1} 的 autoContinue 必须是布尔值。`);
      } else {
        autoContinue = item.autoContinue;
      }
    }
    const completionCriteria = readTextList(
      item.completionCriteria,
      `剧情任务 ${index + 1} 完成条件`,
      12,
      500,
      issues,
    );
    if (completionCriteria.length === 0) {
      issues.push(`剧情任务 ${index + 1} 至少需要一项完成条件。`);
    }
    const storyModule: AdventureStoryModuleInput = {
      id,
      title: readRequiredText(
        item,
        "title",
        `剧情任务 ${index + 1} 标题`,
        120,
        issues,
      ),
      objective: readRequiredText(
        item,
        "objective",
        `剧情任务 ${index + 1} 目标`,
        limits.direction,
        issues,
      ),
      completionCriteria,
      activationConditions:
        item.activationConditions === undefined
          ? []
          : readTextList(
              item.activationConditions,
              `剧情任务 ${index + 1} 进入条件`,
              12,
              500,
              issues,
            ),
      prerequisiteModuleIds:
        item.prerequisiteModuleIds === undefined
          ? []
          : readTextList(
              item.prerequisiteModuleIds,
              `剧情任务 ${index + 1} 前置任务`,
              20,
              120,
              issues,
            ),
      continuityNotes: readOptionalText(
        item,
        "continuityNotes",
        `剧情任务 ${index + 1} 连续性说明`,
        limits.moduleNote,
        issues,
      ),
      autoContinue,
      ...(item.deadlineDay !== undefined && item.deadlineDay !== 0
        ? {
            deadlineDay: (() => {
              if (
                typeof item.deadlineDay !== "number" ||
                !Number.isInteger(item.deadlineDay) ||
                item.deadlineDay < 1 ||
                item.deadlineDay > 10_000
              ) {
                issues.push(
                  `剧情任务 ${index + 1} 的 deadlineDay 必须是 1 到 10000 之间的整数。`,
                );
                return undefined;
              }
              return item.deadlineDay;
            })(),
          }
        : {}),
    };
    return [storyModule];
  });
  const ids = modules.map((storyModule) => storyModule.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) issues.push("剧情任务模块 ID 不能重复。");
  const knownIds = new Set(ids);
  for (const storyModule of modules) {
    for (const prerequisiteId of storyModule.prerequisiteModuleIds ?? []) {
      if (!knownIds.has(prerequisiteId)) {
        issues.push(`剧情任务《${storyModule.title}》引用了不存在的前置任务 ${prerequisiteId}。`);
      }
      if (prerequisiteId === storyModule.id) {
        issues.push(`剧情任务《${storyModule.title}》不能把自己设为前置任务。`);
      }
    }
    const prerequisiteIds = storyModule.prerequisiteModuleIds ?? [];
    if (new Set(prerequisiteIds).size !== prerequisiteIds.length) {
      issues.push(`剧情任务《${storyModule.title}》的前置任务 ID 不能重复。`);
    }
  }
  const visitState = new Map<string, "visiting" | "visited">();
  const path: string[] = [];
  let reportedCycle = false;
  const visit = (moduleId: string) => {
    if (reportedCycle || visitState.get(moduleId) === "visited") return;
    if (visitState.get(moduleId) === "visiting") {
      const cycleStart = path.indexOf(moduleId);
      const cycle = [...path.slice(cycleStart), moduleId];
      issues.push(`剧情任务前置关系存在循环：${cycle.join(" -> ")}。`);
      reportedCycle = true;
      return;
    }
    visitState.set(moduleId, "visiting");
    path.push(moduleId);
    const storyModule = modules.find((item) => item.id === moduleId);
    for (const prerequisiteId of storyModule?.prerequisiteModuleIds ?? []) {
      if (knownIds.has(prerequisiteId)) visit(prerequisiteId);
    }
    path.pop();
    visitState.set(moduleId, "visited");
  };
  for (const storyModule of modules) visit(storyModule.id);
  return modules;
}

export function parseStartAdventureInput(value: unknown): StartAdventureInput {
  if (!isRecord(value)) {
    throw new AdventureInputError(["请求内容必须是 JSON 对象。"]);
  }

  const issues: string[] = [];
  const storyModules = readStoryModules(value.storyModules, issues);
  const initialStoryModuleId = readOptionalText(
    value,
    "initialStoryModuleId",
    "开场剧情任务 ID",
    120,
    issues,
  );
  if (
    initialStoryModuleId &&
    !storyModules.some((storyModule) => storyModule.id === initialStoryModuleId)
  ) {
    issues.push("开场剧情任务 ID 不存在于剧情任务模块中。");
  }
  const world = readSection(value, "world", "世界设定", issues);
  const player = readSection(value, "player", "玩家角色", issues);
  const mainCharacter = readSection(
    value,
    "mainCharacter",
    "主要角色",
    issues,
  );
  let additionalCharacters: AdventureCharacterInput[] = [];
  if (value.additionalCharacters !== undefined) {
    if (!Array.isArray(value.additionalCharacters)) {
      issues.push("其他 AI 角色必须是数组。");
    } else {
      if (value.additionalCharacters.length > 20) {
        issues.push("开局最多可以添加 20 名其他 AI 角色。");
      }
      additionalCharacters = value.additionalCharacters
        .slice(0, 20)
        .map((character, index) => {
          if (!isRecord(character)) {
            issues.push(`其他角色 ${index + 1} 格式无效。`);
            return readCharacter({}, `其他角色 ${index + 1}`, issues);
          }
          return readCharacter(character, `其他角色 ${index + 1}`, issues);
        });
    }
  }
  let worldBookEntries: StartAdventureInput["worldBookEntries"] = [];
  if (value.worldBookEntries !== undefined) {
    if (!Array.isArray(value.worldBookEntries)) {
      issues.push("导入世界书条目必须是数组。");
    } else if (value.worldBookEntries.length > 200) {
      issues.push("开局最多可以导入 200 条世界书条目。");
    } else if (value.worldBookEntries.length > 0) {
      try {
        worldBookEntries = parseWorldBookDocument({
          spec: "ai_tavern_world_book_v1",
          spec_version: "1.0",
          name: "开局导入世界书",
          entries: value.worldBookEntries,
        }).entries;
      } catch (error) {
        if (error instanceof ImportFileError) {
          issues.push(...error.issues.map((issue) => `导入世界书：${issue}`));
        } else {
          issues.push("导入世界书格式无效。");
        }
      }
    }
  }
  let sourceDocuments: StartAdventureInput["sourceDocuments"] = [];
  if (value.sourceDocuments !== undefined) {
    if (!Array.isArray(value.sourceDocuments)) {
      issues.push("原文参考资料必须是数组。");
    } else if (value.sourceDocuments.length > 5) {
      issues.push("每个剧本最多可以导入 5 份原文参考。");
    } else {
      sourceDocuments = value.sourceDocuments
        .map((document, index) => {
          try {
            return parseSourceDocumentInput(document);
          } catch (error) {
            if (error instanceof SourceReferenceInputError) {
              issues.push(
                ...error.issues.map(
                  (issue) => `原文参考 ${index + 1}：${issue}`,
                ),
              );
            } else {
              issues.push(`原文参考 ${index + 1} 格式无效。`);
            }
            return null;
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
    }
  }

  let playerCard: StartAdventureInput["player"]["card"];
  if (player.card !== undefined) {
    try {
      playerCard = parseCharacterCardDocument(player.card).card;
    } catch (error) {
      if (error instanceof ImportFileError) {
        issues.push(
          ...error.issues.map((issue) => `玩家角色导入卡：${issue}`),
        );
      } else {
        issues.push("玩家角色导入卡格式无效。");
      }
    }
  }

  const result: StartAdventureInput = {
    campaignName: readRequiredText(
      value,
      "campaignName",
      "战役名称",
      limits.short,
      issues,
    ),
    campaignDescription: readOptionalText(
      value,
      "campaignDescription",
      "战役说明",
      limits.description,
      issues,
    ),
    world: {
      name: readRequiredText(
        world,
        "name",
        "世界名称",
        limits.short,
        issues,
      ),
      premise: readRequiredText(
        world,
        "premise",
        "世界观概要",
        limits.premise,
        issues,
      ),
    },
    player: {
      name: readRequiredText(
        player,
        "name",
        "玩家角色名",
        limits.short,
        issues,
      ),
      description: readRequiredText(
        player,
        "description",
        "玩家角色设定",
        limits.description,
        issues,
      ),
      ...(playerCard ? { card: playerCard } : {}),
    },
    mainCharacter: readCharacter(mainCharacter, "主要角色", issues),
    additionalCharacters,
    ...(worldBookEntries.length > 0 ? { worldBookEntries } : {}),
    ...(sourceDocuments.length > 0 ? { sourceDocuments } : {}),
    ...(value.openingLocationName !== undefined
      ? {
          openingLocationName: readOptionalText(
            value,
            "openingLocationName",
            "开场地点名称",
            limits.short,
            issues,
          ),
        }
      : {}),
    openingScene: readRequiredText(
      value,
      "openingScene",
      "开场场景",
      limits.scene,
      issues,
    ),
    initialStoryDirection: readOptionalText(
      value,
      "initialStoryDirection",
      "初始剧情走向",
      limits.direction,
      issues,
    ),
    ...(storyModules.length > 0 ? { storyModules } : {}),
    ...(initialStoryModuleId ? { initialStoryModuleId } : {}),
  };

  const characterNames = [
    result.player.name,
    result.mainCharacter.name,
    ...additionalCharacters.map((character) => character.name),
  ]
    .filter(Boolean)
    .map((name) => name.toLocaleLowerCase("zh-CN"));
  if (new Set(characterNames).size !== characterNames.length) {
    issues.push("同一剧本中的角色姓名不能重复。");
  }

  const knownCharacterNames = new Set(characterNames);
  const initialRelationships: StartAdventureInput["initialRelationships"] = [];
  if (value.initialRelationships !== undefined) {
    if (!Array.isArray(value.initialRelationships)) {
      issues.push("初始关系必须是数组。");
    } else {
      if (value.initialRelationships.length > 100) {
        issues.push("初始关系最多 100 条。");
      }
      value.initialRelationships.slice(0, 100).forEach((item, index) => {
        if (!isRecord(item)) {
          issues.push(`初始关系 ${index + 1} 格式无效。`);
          return;
        }
        const sourceCharacterName = readOptionalText(
          item,
          "sourceCharacterName",
          `初始关系 ${index + 1} 源角色名`,
          limits.short,
          issues,
        );
        const targetCharacterName = readOptionalText(
          item,
          "targetCharacterName",
          `初始关系 ${index + 1} 目标角色名`,
          limits.short,
          issues,
        );
        if (
          sourceCharacterName &&
          !knownCharacterNames.has(sourceCharacterName.toLocaleLowerCase("zh-CN"))
        ) {
          issues.push(`初始关系 ${index + 1} 的源角色“${sourceCharacterName}”不在剧本角色中。`);
        }
        if (
          targetCharacterName &&
          !knownCharacterNames.has(targetCharacterName.toLocaleLowerCase("zh-CN"))
        ) {
          issues.push(`初始关系 ${index + 1} 的目标角色“${targetCharacterName}”不在剧本角色中。`);
        }
        const dimensionsSource = item.dimensions;
        const dimensions: NonNullable<
          NonNullable<AdventureRelationshipInput["dimensions"]>
        > = {};
        if (dimensionsSource !== undefined) {
          if (!isRecord(dimensionsSource)) {
            issues.push(`初始关系 ${index + 1} 的 dimensions 必须是对象。`);
          } else {
            for (const dimension of [
              "trust",
              "affection",
              "fear",
              "hostility",
              "respect",
            ] as const) {
              const raw = dimensionsSource[dimension];
              if (raw === undefined) continue;
              if (typeof raw !== "number" || !Number.isFinite(raw)) {
                issues.push(`初始关系 ${index + 1} 的 ${dimension} 必须是数值。`);
              } else if (raw < -100 || raw > 100) {
                issues.push(`初始关系 ${index + 1} 的 ${dimension} 必须在 -100 到 100 之间。`);
              } else {
                dimensions[dimension] = raw;
              }
            }
            const legacyAffinity = dimensionsSource["affinity"];
            if (legacyAffinity !== undefined) {
              if (
                typeof legacyAffinity !== "number" ||
                !Number.isFinite(legacyAffinity)
              ) {
                issues.push(
                  `初始关系 ${index + 1} 的 affinity（旧别名）必须是数值。`,
                );
              } else if (legacyAffinity < -100 || legacyAffinity > 100) {
                issues.push(
                  `初始关系 ${index + 1} 的 affinity（旧别名）必须在 -100 到 100 之间。`,
                );
              } else if (dimensions.affection === undefined) {
                dimensions.affection = legacyAffinity;
              }
            }
          }
        }
        const summary = readOptionalText(
          item,
          "summary",
          `初始关系 ${index + 1} 关系描述`,
          limits.description,
          issues,
        );
        if (sourceCharacterName && targetCharacterName) {
          initialRelationships.push({
            sourceCharacterName,
            targetCharacterName,
            ...(Object.keys(dimensions).length > 0 ? { dimensions } : {}),
            ...(summary ? { summary } : {}),
          });
        }
      });
    }
  }

  const locations: StartAdventureInput["locations"] = [];
  if (value.locations !== undefined) {
    if (!Array.isArray(value.locations)) {
      issues.push("地点清单必须是数组。");
    } else {
      if (value.locations.length > 60) {
        issues.push("地点清单最多 60 个。");
      }
      const locationNames = new Set<string>();
      value.locations.slice(0, 60).forEach((item, index) => {
        if (!isRecord(item)) {
          issues.push(`地点 ${index + 1} 格式无效。`);
          return;
        }
        const name = readRequiredText(
          item,
          "name",
          `地点 ${index + 1} 名称`,
          limits.short,
          issues,
        );
        const description = readRequiredText(
          item,
          "description",
          `地点 ${index + 1} 描述`,
          limits.locationDescription,
          issues,
        );
        const normalizedName = name.toLocaleLowerCase("zh-CN");
        if (name && locationNames.has(normalizedName)) {
          issues.push(`地点“${name}”重复。`);
        }
        if (name) locationNames.add(normalizedName);
        const characters = Array.isArray(item.characters)
          ? item.characters
              .slice(0, 30)
              .map((character) =>
                typeof character === "string"
                  ? character.trim().slice(0, limits.short)
                  : (issues.push(`地点 ${index + 1} 的 characters 项必须是文本。`), ""),
              )
              .filter(Boolean)
          : item.characters !== undefined
            ? (issues.push(`地点 ${index + 1} 的 characters 必须是数组。`), [])
            : [];
        for (const characterName of characters) {
          if (!knownCharacterNames.has(characterName.toLocaleLowerCase("zh-CN"))) {
            issues.push(`地点“${name}”引用了不存在的角色“${characterName}”。`);
          }
        }
        const important = item.important;
        if (important !== undefined && typeof important !== "boolean") {
          issues.push(`地点 ${index + 1} 的 important 必须是布尔值。`);
        }
        if (name && description) {
          locations.push({
            name,
            description,
            ...(characters.length > 0 ? { characters } : {}),
            ...(typeof important === "boolean" ? { important } : {}),
          });
        }
      });
    }
  }

  const elementIdPattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
  const foreshadowing: StartAdventureInput["foreshadowing"] = [];
  if (value.foreshadowing !== undefined) {
    if (!Array.isArray(value.foreshadowing)) {
      issues.push("伏笔分区必须是数组。");
    } else {
      if (value.foreshadowing.length > 30) {
        issues.push("剧本包最多允许 30 个伏笔。");
      }
      const threadIds = new Set<string>();
      value.foreshadowing.slice(0, 30).forEach((item, index) => {
        if (!isRecord(item)) {
          issues.push(`伏笔 ${index + 1} 格式无效。`);
          return;
        }
        const id = readRequiredText(
          item,
          "id",
          `伏笔 ${index + 1} ID`,
          limits.short,
          issues,
        );
        if (id && !elementIdPattern.test(id)) {
          issues.push(
            `伏笔 ${index + 1} ID 只能包含文字、数字、点、下划线和连字符。`,
          );
        }
        if (id) {
          if (threadIds.has(id)) {
            issues.push(`伏笔 ID “${id}”重复。`);
          }
          threadIds.add(id);
        }
        const keywords = readTextList(
          item.keywords,
          `伏笔 ${index + 1} 关键词`,
          20,
          limits.short,
          issues,
        );
        if (keywords.length === 0) {
          issues.push(`伏笔 ${index + 1} 至少需要一个关键词。`);
        }
        const seedCondition = readRequiredText(
          item,
          "seedCondition",
          `伏笔 ${index + 1} 出现条件`,
          limits.direction,
          issues,
        );
        const payoffCondition = readRequiredText(
          item,
          "payoffCondition",
          `伏笔 ${index + 1} 回收条件`,
          limits.direction,
          issues,
        );
        const payoffSummary = readRequiredText(
          item,
          "payoffSummary",
          `伏笔 ${index + 1} 回收概要`,
          limits.scene,
          issues,
        );
        const characters =
          item.characters === undefined
            ? []
            : readTextList(
                item.characters,
                `伏笔 ${index + 1} 相关角色`,
                20,
                limits.short,
                issues,
              );
        for (const characterName of characters) {
          if (!knownCharacterNames.has(characterName.toLocaleLowerCase("zh-CN"))) {
            issues.push(
              `伏笔 ${index + 1} 引用了不存在的角色“${characterName}”。`,
            );
          }
        }
        if (id && keywords.length > 0 && seedCondition && payoffCondition && payoffSummary) {
          foreshadowing.push({
            id,
            keywords,
            seedCondition,
            payoffCondition,
            payoffSummary,
            ...(characters.length > 0 ? { characters } : {}),
          });
        }
      });
    }
  }

  const triggers: StartAdventureInput["triggers"] = [];
  if (value.triggers !== undefined) {
    if (!Array.isArray(value.triggers)) {
      issues.push("偏离触发器分区必须是数组。");
    } else {
      if (value.triggers.length > 30) {
        issues.push("剧本包最多允许 30 个偏离触发器。");
      }
      const triggerIds = new Set<string>();
      value.triggers.slice(0, 30).forEach((item, index) => {
        if (!isRecord(item)) {
          issues.push(`偏离触发器 ${index + 1} 格式无效。`);
          return;
        }
        const id = readRequiredText(
          item,
          "id",
          `偏离触发器 ${index + 1} ID`,
          limits.short,
          issues,
        );
        if (id && !elementIdPattern.test(id)) {
          issues.push(
            `偏离触发器 ${index + 1} ID 只能包含文字、数字、点、下划线和连字符。`,
          );
        }
        if (id) {
          if (triggerIds.has(id)) {
            issues.push(`偏离触发器 ID “${id}”重复。`);
          }
          triggerIds.add(id);
        }
        const when = readRequiredText(
          item,
          "when",
          `偏离触发器 ${index + 1} 条件`,
          limits.direction,
          issues,
        );
        const consequence = readRequiredText(
          item,
          "consequence",
          `偏离触发器 ${index + 1} 后果`,
          limits.scene,
          issues,
        );
        const stateEffectsSource = item.stateEffects;
        const stateEffects: NonNullable<
          NonNullable<StartAdventureInput["triggers"]>[number]["stateEffects"]
        > = {};
        if (stateEffectsSource !== undefined) {
          if (!isRecord(stateEffectsSource)) {
            issues.push(`偏离触发器 ${index + 1} 的 stateEffects 必须是对象。`);
          } else {
            if (stateEffectsSource.relations !== undefined) {
              if (!Array.isArray(stateEffectsSource.relations)) {
                issues.push(
                  `偏离触发器 ${index + 1} 的 relations 必须是数组。`,
                );
              } else {
                const relations: NonNullable<typeof stateEffects.relations> = [];
                stateEffectsSource.relations.slice(0, 30).forEach((relation, relationIndex) => {
                  if (!isRecord(relation)) {
                    issues.push(
                      `偏离触发器 ${index + 1} 的关系影响 ${relationIndex + 1} 格式无效。`,
                    );
                    return;
                  }
                  const sourceCharacterName = readRequiredText(
                    relation,
                    "sourceCharacterName",
                    `偏离触发器 ${index + 1} 关系影响 ${relationIndex + 1} 源角色名`,
                    limits.short,
                    issues,
                  );
                  const targetCharacterName = readRequiredText(
                    relation,
                    "targetCharacterName",
                    `偏离触发器 ${index + 1} 关系影响 ${relationIndex + 1} 目标角色名`,
                    limits.short,
                    issues,
                  );
                  for (const characterName of [sourceCharacterName, targetCharacterName]) {
                    if (
                      characterName &&
                      !knownCharacterNames.has(
                        characterName.toLocaleLowerCase("zh-CN"),
                      )
                    ) {
                      issues.push(
                        `偏离触发器 ${index + 1} 的关系影响引用了不存在的角色“${characterName}”。`,
                      );
                    }
                  }
                  const dimension = readOptionalText(
                    relation,
                    "dimension",
                    `偏离触发器 ${index + 1} 关系影响 ${relationIndex + 1} 维度`,
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
                      `偏离触发器 ${index + 1} 的关系影响维度必须是 trust、affection、fear、hostility 或 respect。`,
                    );
                  }
                  const rawDelta = relation.delta;
                  if (
                    typeof rawDelta !== "number" ||
                    !Number.isFinite(rawDelta) ||
                    rawDelta < -100 ||
                    rawDelta > 100
                  ) {
                    issues.push(
                      `偏离触发器 ${index + 1} 的关系影响 delta 必须是 -100 到 100 之间的数值。`,
                    );
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
                issues.push(`偏离触发器 ${index + 1} 的 flags 必须是数组。`);
              } else {
                const flags = stateEffectsSource.flags
                  .slice(0, 10)
                  .flatMap((flag) => {
                    if (typeof flag !== "string" || !flag.trim()) {
                      issues.push(
                        `偏离触发器 ${index + 1} 的 flags 项必须是文本。`,
                      );
                      return [];
                    }
                    return [flag.trim().slice(0, 50)];
                  });
                if (flags.length > 0) stateEffects.flags = flags;
              }
            }
            if (stateEffectsSource.attributes !== undefined) {
              if (!Array.isArray(stateEffectsSource.attributes)) {
                issues.push(`偏离触发器 ${index + 1} 的 attributes 必须是数组。`);
              } else {
                const attributes: NonNullable<typeof stateEffects.attributes> = [];
                stateEffectsSource.attributes.slice(0, 30).forEach((attributeEffect, attributeIndex) => {
                  if (!isRecord(attributeEffect)) {
                    issues.push(
                      `偏离触发器 ${index + 1} 的属性影响 ${attributeIndex + 1} 格式无效。`,
                    );
                    return;
                  }
                  const characterName = readRequiredText(
                    attributeEffect,
                    "characterName",
                    `偏离触发器 ${index + 1} 属性影响 ${attributeIndex + 1} 角色名`,
                    limits.short,
                    issues,
                  );
                  if (
                    characterName &&
                    !knownCharacterNames.has(
                      characterName.toLocaleLowerCase("zh-CN"),
                    )
                  ) {
                    issues.push(
                      `偏离触发器 ${index + 1} 的属性影响引用了不存在的角色“${characterName}”。`,
                    );
                  }
                  const attribute = readRequiredText(
                    attributeEffect,
                    "attribute",
                    `偏离触发器 ${index + 1} 属性影响 ${attributeIndex + 1} 属性`,
                    80,
                    issues,
                  );
                  if (
                    attribute &&
                    !isAttributeName(attribute)
                  ) {
                    issues.push(
                      `偏离触发器 ${index + 1} 的属性“${attribute}”不在白名单中（允许：${ATTRIBUTE_WHITELIST.join("、")}）。`,
                    );
                  }
                  const rawValue = attributeEffect.value;
                  if (
                    typeof rawValue !== "number" ||
                    !Number.isFinite(rawValue) ||
                    rawValue < 0 ||
                    rawValue > 100
                  ) {
                    issues.push(
                      `偏离触发器 ${index + 1} 的属性值必须是 0 到 100 之间的数值。`,
                    );
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
        if (item.deadline !== undefined && item.deadline !== null && item.deadline !== 0) {
          if (
            typeof item.deadline !== "number" ||
            !Number.isInteger(item.deadline) ||
            item.deadline < 1 ||
            item.deadline > 10_000
          ) {
            issues.push(
              `偏离触发器 ${index + 1} 的 deadline 必须是 1 到 10000 之间的整数。`,
            );
          } else {
            deadlineDay = item.deadline;
          }
        }
        if (id && when && consequence) {
          triggers.push({
            id,
            when,
            consequence,
            ...(Object.keys(stateEffects).length > 0 ? { stateEffects } : {}),
            ...(deadlineDay !== undefined ? { deadlineDay } : {}),
          });
        }
      });
    }
  }

  if (issues.length > 0) {
    throw new AdventureInputError(issues);
  }
  return {
    ...result,
    ...(initialRelationships.length > 0 ? { initialRelationships } : {}),
    ...(locations.length > 0 ? { locations } : {}),
    ...(foreshadowing.length > 0 ? { foreshadowing } : {}),
    ...(triggers.length > 0 ? { triggers } : {}),
  };
}
