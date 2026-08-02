import type { JsonObject, JsonValue } from "../storage/story-store.ts";
import { ImportFileError } from "./酒馆文件.ts";
import {
  parseAdventureBundleDocument,
  type ImportedAdventureBundle,
} from "./剧本包.ts";
import {
  generateAdventureBundleFromSource,
  type BundleRegenerationSection,
  type SourceBundleGenerationResult,
} from "./原文生成剧本包.ts";
import type { AiRequestOptions } from "../ai/模型供应商.ts";

export interface BundleSectionRegenerationInput {
  document: unknown;
  section: unknown;
  feedback: unknown;
}

export interface BundleSectionRegenerationResult {
  fileName: string;
  document: JsonObject;
  preview: ImportedAdventureBundle;
  section: BundleRegenerationSection;
  generation: SourceBundleGenerationResult["generation"];
}

export class BundleSectionRegenerationInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "剧本包分区重生成请求无效。");
    this.name = "BundleSectionRegenerationInputError";
    this.issues = issues;
  }
}

export class BundleSectionRegenerationOutputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "分区重生成结果无法合并到当前剧本包。");
    this.name = "BundleSectionRegenerationOutputError";
    this.issues = issues;
  }
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredObject(
  value: JsonValue | undefined,
  label: string,
): JsonObject {
  if (!isObject(value)) {
    throw new BundleSectionRegenerationOutputError([`${label}格式无效。`]);
  }
  return value;
}

function parseSection(value: unknown): BundleRegenerationSection {
  if (
    value === "characters" ||
    value === "world_book" ||
    value === "story_modules" ||
    value === "opening"
  ) {
    return value;
  }
  throw new BundleSectionRegenerationInputError([
    "请选择角色资料、世界书、剧情任务或开篇中的一个分区。",
  ]);
}

function parseFeedback(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BundleSectionRegenerationInputError([
      "重新生成前必须填写不满意的原因或具体修改要求。",
    ]);
  }
  const feedback = value.replaceAll("\u0000", "").trim();
  if (feedback.length > 2_000) {
    throw new BundleSectionRegenerationInputError([
      "分区修改意见不能超过 2,000 个字符。",
    ]);
  }
  return feedback;
}

function currentSection(
  adventure: JsonObject,
  section: BundleRegenerationSection,
): JsonValue {
  const opening = requiredObject(adventure.opening, "当前开场");
  if (section === "characters") {
    return {
      player: structuredClone(adventure.player ?? null),
      mainCharacter: structuredClone(adventure.mainCharacter ?? null),
      additionalCharacters: structuredClone(
        adventure.additionalCharacters ?? [],
      ),
    };
  }
  if (section === "world_book") {
    return structuredClone(adventure.worldBook ?? null);
  }
  if (section === "story_modules") {
    return {
      storyModules: structuredClone(adventure.storyModules ?? []),
      initialStoryModuleId: structuredClone(
        opening.initialStoryModuleId ?? "",
      ),
      initialStoryDirection: structuredClone(
        opening.initialStoryDirection ?? "",
      ),
    };
  }
  return structuredClone(opening);
}

function mergeGeneratedSection(
  baseline: JsonObject,
  candidate: JsonObject,
  section: BundleRegenerationSection,
) {
  const merged = structuredClone(baseline);
  const baselineAdventure = requiredObject(merged.adventure, "当前剧本包 adventure");
  const candidateAdventure = requiredObject(
    candidate.adventure,
    "模型候选剧本包 adventure",
  );
  const baselineOpening = requiredObject(
    baselineAdventure.opening,
    "当前剧本包 opening",
  );
  const candidateOpening = requiredObject(
    candidateAdventure.opening,
    "模型候选剧本包 opening",
  );

  if (section === "characters") {
    baselineAdventure.player = structuredClone(
      candidateAdventure.player ?? null,
    );
    baselineAdventure.mainCharacter = structuredClone(
      candidateAdventure.mainCharacter ?? null,
    );
    baselineAdventure.additionalCharacters = structuredClone(
      candidateAdventure.additionalCharacters ?? [],
    );
  } else if (section === "world_book") {
    baselineAdventure.worldBook = structuredClone(
      candidateAdventure.worldBook ?? null,
    );
  } else if (section === "story_modules") {
    baselineAdventure.storyModules = structuredClone(
      candidateAdventure.storyModules ?? [],
    );
    baselineOpening.initialStoryModuleId = structuredClone(
      candidateOpening.initialStoryModuleId ?? "",
    );
    baselineOpening.initialStoryDirection = structuredClone(
      candidateOpening.initialStoryDirection ?? "",
    );
  } else {
    const currentInitialStoryModuleId = structuredClone(
      baselineOpening.initialStoryModuleId ?? "",
    );
    baselineAdventure.opening = structuredClone(candidateOpening);
    requiredObject(
      baselineAdventure.opening,
      "合并后的 opening",
    ).initialStoryModuleId = currentInitialStoryModuleId;
  }
  return merged;
}

export async function regenerateAdventureBundleSection(
  input: BundleSectionRegenerationInput,
  options: AiRequestOptions = {},
): Promise<BundleSectionRegenerationResult> {
  const section = parseSection(input.section);
  const feedback = parseFeedback(input.feedback);
  let baselinePreview: ImportedAdventureBundle;
  try {
    baselinePreview = parseAdventureBundleDocument(input.document);
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw new BundleSectionRegenerationInputError([
        "当前生成包已不符合标准，不能继续分区重做。",
        ...error.issues.slice(0, 20),
      ]);
    }
    throw error;
  }
  const baseline = structuredClone(input.document) as JsonObject;
  const baselineAdventure = requiredObject(
    baseline.adventure,
    "当前剧本包 adventure",
  );
  const sourceDocument = baselinePreview.adventure.sourceDocuments?.[0];
  if (!sourceDocument?.content) {
    throw new BundleSectionRegenerationInputError([
      "当前剧本包没有内嵌原文，无法依据原文重新生成分区。",
    ]);
  }
  const generated = await generateAdventureBundleFromSource(
    {
      fileName: sourceDocument.fileName,
      content: sourceDocument.content,
      preferences: {
        playerCharacterName: baselinePreview.player.name,
        mainCharacterName: baselinePreview.mainCharacter.name,
        openingChapterIndex: sourceDocument.currentChapter,
        openingTitle: baselinePreview.name,
        openingLocation:
          baselinePreview.adventure.openingLocationName || "原文开场地点",
        openingSummary: baselinePreview.adventure.openingScene.slice(0, 2_000),
      },
      revision: {
        section,
        feedback,
        currentSection: currentSection(baselineAdventure, section),
      },
    },
    options,
  );
  const merged = mergeGeneratedSection(
    baseline,
    generated.document,
    section,
  );
  let preview: ImportedAdventureBundle;
  try {
    preview = parseAdventureBundleDocument(merged);
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw new BundleSectionRegenerationOutputError([
        "模型生成的分区无法与当前剧本包安全合并。",
        ...error.issues.slice(0, 20),
      ]);
    }
    throw error;
  }

  return {
    fileName: generated.fileName,
    document: merged,
    preview,
    section,
    generation: generated.generation,
  };
}
