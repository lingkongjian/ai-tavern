import type {
  ImportedCharacterCard,
  ImportedWorldBook,
} from "./酒馆文件.ts";
import {
  ImportFileError,
  parseCharacterCardDocument,
  parseWorldBookDocument,
} from "./酒馆文件.ts";
import type { StartAdventureInput } from "../storage/story-store.ts";
import {
  AdventureInputError,
  parseStartAdventureInput,
} from "../story/开局.ts";

export interface ImportedAdventureBundle {
  kind: "adventure_bundle";
  format: "ai_tavern_adventure_bundle_v1";
  name: string;
  description: string;
  adventure: StartAdventureInput;
  worldBook: ImportedWorldBook;
  player: ImportedCharacterCard;
  mainCharacter: ImportedCharacterCard;
  additionalCharacters: Array<{
    card: ImportedCharacterCard;
    presentAtOpening: boolean;
  }>;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function requiredObject(
  value: unknown,
  label: string,
  issues: string[],
) {
  if (!isRecord(value)) {
    issues.push(`${label}格式无效。`);
    return {};
  }
  return value;
}

function parseEmbeddedCharacter(
  value: unknown,
  label: string,
  issues: string[],
) {
  const source = requiredObject(value, label, issues);
  if (source.card === undefined) {
    issues.push(`${label}缺少 card。`);
    return null;
  }
  try {
    return {
      source,
      parsed: parseCharacterCardDocument(source.card),
    };
  } catch (error) {
    if (error instanceof ImportFileError) {
      issues.push(...error.issues.map((issue) => `${label}：${issue}`));
    } else {
      issues.push(`${label}人物卡格式无效。`);
    }
    return null;
  }
}

function embeddedFirstMessage(
  source: Record<string, unknown>,
  card: ImportedCharacterCard,
  label: string,
  issues: string[],
) {
  return Object.hasOwn(source, "firstMessage")
    ? optionalText(source.firstMessage, `${label}开场台词`, 2_000, issues)
    : card.firstMessage;
}

export function parseAdventureBundleDocument(
  value: unknown,
): ImportedAdventureBundle {
  if (!isRecord(value)) {
    throw new ImportFileError(["剧本包必须是一个 JSON 对象。"]);
  }
  if (JSON.stringify(value).length > 5_000_000) {
    throw new ImportFileError(["剧本包不能超过 5 MB。"]);
  }
  if (value.spec !== "ai_tavern_adventure_bundle_v1") {
    throw new ImportFileError([
      "剧本包 spec 必须是 ai_tavern_adventure_bundle_v1。",
    ]);
  }
  if (value.spec_version !== "1.0" && value.spec_version !== "1.1") {
    throw new ImportFileError(["剧本包 spec_version 必须是 1.0 或 1.1。"]);
  }

  const issues: string[] = [];
  const warnings: string[] = [];
  const source = requiredObject(value.adventure, "adventure", issues);
  const world = requiredObject(source.world, "世界设定", issues);
  const opening = requiredObject(source.opening, "开场信息", issues);
  const playerResult = parseEmbeddedCharacter(
    source.player,
    "玩家角色",
    issues,
  );
  const mainResult = parseEmbeddedCharacter(
    source.mainCharacter,
    "主要角色",
    issues,
  );

  const rawAdditionalCharacters = source.additionalCharacters;
  if (!Array.isArray(rawAdditionalCharacters)) {
    issues.push("其他角色必须是数组。");
  } else if (rawAdditionalCharacters.length > 20) {
    issues.push("剧本包最多允许 20 名其他角色。");
  }
  const additionalCharacters = (
    Array.isArray(rawAdditionalCharacters)
      ? rawAdditionalCharacters.slice(0, 20)
      : []
  )
    .map((item, index) => {
      const result = parseEmbeddedCharacter(
        item,
        `其他角色 ${index + 1}`,
        issues,
      );
      if (!result) return null;
      let presentAtOpening = false;
      if (typeof result.source.presentAtOpening === "boolean") {
        presentAtOpening = result.source.presentAtOpening;
      } else {
        issues.push(`其他角色 ${index + 1} 缺少布尔值 presentAtOpening。`);
      }
      return { ...result, presentAtOpening };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  let worldBook: ImportedWorldBook | null = null;
  try {
    worldBook = parseWorldBookDocument(source.worldBook);
  } catch (error) {
    if (error instanceof ImportFileError) {
      issues.push(...error.issues.map((issue) => `世界书：${issue}`));
    } else {
      issues.push("世界书格式无效。");
    }
  }

  if (issues.length > 0 || !playerResult || !mainResult || !worldBook) {
    throw new ImportFileError(issues.length > 0 ? issues : ["剧本包内容不完整。"]);
  }

  warnings.push(
    ...playerResult.parsed.warnings.map((warning) => `玩家角色：${warning}`),
    ...mainResult.parsed.warnings.map((warning) => `主要角色：${warning}`),
    ...additionalCharacters.flatMap((item) =>
      item.parsed.warnings.map(
        (warning) => `${item.parsed.name}：${warning}`,
      ),
    ),
    ...worldBook.warnings.map((warning) => `世界书：${warning}`),
  );

  let adventure: StartAdventureInput;
  try {
    adventure = parseStartAdventureInput({
      campaignName: source.campaignName,
      campaignDescription: source.campaignDescription,
      world: {
        name: world.name,
        premise: world.premise,
      },
      player: {
        name: playerResult.parsed.name,
        description:
          optionalText(
            playerResult.source.description,
            "玩家角色设定",
            2_000,
            issues,
          ) || playerResult.parsed.role,
        card: playerResult.parsed.card,
      },
      mainCharacter: {
        name: mainResult.parsed.name,
        role: mainResult.parsed.role,
        personality: mainResult.parsed.personality,
        firstMessage: embeddedFirstMessage(
          mainResult.source,
          mainResult.parsed,
          "主要角色",
          issues,
        ),
        card: mainResult.parsed.card,
      },
      additionalCharacters: additionalCharacters.map((item, index) => ({
        name: item.parsed.name,
        role: item.parsed.role,
        personality: item.parsed.personality,
        firstMessage: embeddedFirstMessage(
          item.source,
          item.parsed,
          `其他角色 ${index + 1}`,
          issues,
        ),
        card: item.parsed.card,
        initiallyPresent: item.presentAtOpening,
      })),
      worldBookEntries: worldBook.entries,
      sourceDocuments:
        source.referenceDocuments ?? source.sourceDocuments,
      openingLocationName: opening.locationName,
      openingScene: opening.scene,
      initialStoryDirection: opening.initialStoryDirection,
      initialStoryModuleId: opening.initialStoryModuleId,
      storyModules: source.storyModules,
      ...(Array.isArray(source.initialRelationships) &&
      source.initialRelationships.length > 0
        ? { initialRelationships: source.initialRelationships }
        : {}),
      ...(Array.isArray(source.locations) && source.locations.length > 0
        ? { locations: source.locations }
        : {}),
    });
  } catch (error) {
    if (error instanceof AdventureInputError) {
      throw new ImportFileError(
        error.issues.map((issue) => `剧本开局：${issue}`),
      );
    }
    throw error;
  }

  const bundleName =
    optionalText(value.name, "剧本包名称", 120, issues) ||
    adventure.campaignName;
  const bundleDescription = optionalText(
    value.description,
    "剧本包说明",
    2_000,
    issues,
  );
  if (issues.length > 0) throw new ImportFileError(issues);

  return {
    kind: "adventure_bundle",
    format: "ai_tavern_adventure_bundle_v1",
    name: bundleName,
    description: bundleDescription,
    adventure,
    worldBook,
    player: playerResult.parsed,
    mainCharacter: mainResult.parsed,
    additionalCharacters: additionalCharacters.map((item) => ({
      card: item.parsed,
      presentAtOpening: item.presentAtOpening,
    })),
    warnings,
  };
}
