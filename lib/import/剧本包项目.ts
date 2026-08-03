import { createHash } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { parseAdventureBundleDocument } from "./剧本包.ts";
import {
  ImportFileError,
  parseCharacterCardDocument,
  parseWorldBookDocument,
  type ImportedCharacterCard,
  type ImportedWorldBook,
} from "./酒馆文件.ts";
import type { JsonObject, JsonValue } from "../storage/story-store.ts";

const projectSpec = "ai_tavern_bundle_project_v1";
const projectSpecVersion = "1.0";

type UnknownRecord = Record<string, unknown>;

export interface BundleProjectReport {
  schemaVersion: "1.0.0";
  status: "valid";
  manifestFile: string;
  outputFile: string;
  bundleName: string;
  bundleVersion: string;
  sha256: string;
  sizeBytes: number;
  counts: {
    characters: number;
    additionalCharacters: number;
    worldBookEntries: number;
    referenceDocuments: number;
    storyModules: number;
    plotThreads: number;
    plotTriggers: number;
  };
  checks: string[];
  warnings: string[];
}

export interface AssembledBundleProject {
  manifestPath: string;
  outputPath: string;
  reportPath: string;
  bundle: JsonObject;
  serializedBundle: string;
  report: BundleProjectReport;
}

export class BundleProjectError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "剧本包项目无效。");
    this.name = "BundleProjectError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function section(
  value: unknown,
  label: string,
  issues: string[],
): UnknownRecord {
  if (!isRecord(value)) {
    issues.push(`${label}必须是 JSON 对象。`);
    return {};
  }
  return value;
}

function requireProperty(
  source: UnknownRecord,
  key: string,
  label: string,
  issues: string[],
) {
  if (!Object.hasOwn(source, key)) issues.push(`缺少 ${label}。`);
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
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    issues.push(`${label}不能超过 ${maximumLength} 个字符。`);
  }
  return normalized.slice(0, maximumLength);
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
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    issues.push(`${label}不能超过 ${maximumLength} 个字符。`);
  }
  return normalized.slice(0, maximumLength);
}

function booleanSetting(
  value: unknown,
  label: string,
  fallback: boolean,
  issues: string[],
) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    issues.push(`${label}必须是布尔值。`);
    return fallback;
  }
  return value;
}

function positiveIntegerSetting(
  value: unknown,
  label: string,
  fallback: number,
  issues: string[],
) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    issues.push(`${label}必须是正整数。`);
    return fallback;
  }
  return value;
}

function fidelitySetting(
  value: unknown,
  label: string,
  issues: string[],
): "balanced" | "faithful" {
  if (value === undefined) return "balanced";
  if (value !== "balanced" && value !== "faithful") {
    issues.push(`${label}必须是 balanced 或 faithful。`);
    return "balanced";
  }
  return value;
}

function relativeProjectPath(
  projectDirectory: string,
  value: unknown,
  label: string,
  extensions: string[],
  issues: string[],
) {
  const file = requiredText(value, label, 500, issues);
  if (!file) return "";
  if (isAbsolute(file)) {
    issues.push(`${label}必须使用项目目录内的相对路径。`);
    return "";
  }
  const resolved = resolve(projectDirectory, file);
  const local = relative(projectDirectory, resolved);
  if (!local || local.startsWith("..") || isAbsolute(local)) {
    issues.push(`${label}必须指向项目目录内的文件。`);
    return "";
  }
  if (
    extensions.length > 0 &&
    !extensions.includes(extname(resolved).toLocaleLowerCase("zh-CN"))
  ) {
    issues.push(`${label}只支持 ${extensions.join("、")} 文件。`);
  }
  return resolved;
}

async function readUtf8(path: string, label: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    throw new BundleProjectError([`${label}读取失败：${reason}`]);
  }
}

async function readJson(path: string, label: string) {
  const content = await readUtf8(path, label);
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "JSON 语法错误";
    throw new BundleProjectError([`${label}不是有效的 JSON：${reason}`]);
  }
}

function parseCard(value: unknown, label: string) {
  try {
    return parseCharacterCardDocument(value);
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw new BundleProjectError(
        error.issues.map((issue) => `${label}：${issue}`),
      );
    }
    throw error;
  }
}

function normalizedV2Card(card: ImportedCharacterCard): JsonObject {
  return {
    ...card.card,
    spec: "chara_card_v2",
    spec_version: "2.0",
  };
}

function normalizedWorldBook(book: ImportedWorldBook): JsonObject {
  return {
    spec: "ai_tavern_world_book_v1",
    spec_version: "1.0",
    name: book.name,
    description: book.description,
    entries: book.entries.map((entry, index) => ({
      id: entry.sourceId || `entry-${index + 1}`,
      comment: entry.comment ?? "",
      keys: entry.keys,
      secondaryKeys: entry.secondaryKeys ?? [],
      content: entry.content,
      enabled: entry.enabled,
      constant: entry.constant ?? false,
      selective: entry.selective ?? false,
      position: entry.position ?? "after_char",
      order: entry.order ?? 100,
      probability: entry.probability ?? 100,
      depth: entry.depth ?? 4,
      ...(entry.extensions && Object.keys(entry.extensions).length > 0
        ? { extensions: entry.extensions }
        : {}),
    })),
  };
}

function declaredRole(card: ImportedCharacterCard) {
  const data = isRecord(card.card.data) ? card.card.data : {};
  const extensions = isRecord(data.extensions) ? data.extensions : {};
  const aiTavern = isRecord(extensions.ai_tavern)
    ? extensions.ai_tavern
    : {};
  return typeof aiTavern.role === "string" ? aiTavern.role : "";
}

function roleWarning(
  card: ImportedCharacterCard,
  expected: "player" | "main" | "additional",
  label: string,
) {
  const actual = declaredRole(card);
  return actual && actual !== expected
    ? `${label}在 extensions.ai_tavern.role 中声明为 ${actual}，建议改为 ${expected}。`
    : "";
}

function characterMaterial(
  value: unknown,
  label: string,
  projectDirectory: string,
  issues: string[],
) {
  const source = section(value, label, issues);
  const filePath = relativeProjectPath(
    projectDirectory,
    source.file,
    `${label}.file`,
    [".json"],
    issues,
  );
  const hasFirstMessage = Object.hasOwn(source, "firstMessage");
  const firstMessage = hasFirstMessage
    ? optionalText(
        source.firstMessage,
        `${label}.firstMessage`,
        2_000,
        issues,
      )
    : "";
  return { filePath, hasFirstMessage, firstMessage };
}

async function atomicWrite(path: string, content: string) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function assembleBundleProject(
  manifestPath: string,
  overrides: { outputPath?: string; reportPath?: string } = {},
): Promise<AssembledBundleProject> {
  const absoluteManifestPath = resolve(manifestPath);
  const projectDirectory = dirname(absoluteManifestPath);
  const manifest = await readJson(absoluteManifestPath, "开局预设");
  const issues: string[] = [];
  const source = section(manifest, "开局预设", issues);
  if (source.spec !== projectSpec) {
    issues.push(`开局预设 spec 必须是 ${projectSpec}。`);
  }
  if (source.spec_version !== projectSpecVersion) {
    issues.push(`开局预设 spec_version 必须是 ${projectSpecVersion}。`);
  }

  const bundleSettings = section(source.bundle, "bundle", issues);
  const campaign = section(source.campaign, "campaign", issues);
  const world = section(campaign.world, "campaign.world", issues);
  const player = section(campaign.player, "campaign.player", issues);
  const mainCharacter = section(
    campaign.mainCharacter,
    "campaign.mainCharacter",
    issues,
  );
  const materials = section(source.materials, "materials", issues);

  requireProperty(
    bundleSettings,
    "description",
    "bundle.description",
    issues,
  );
  requireProperty(
    campaign,
    "campaignDescription",
    "campaign.campaignDescription",
    issues,
  );
  requireProperty(
    campaign,
    "openingLocationName",
    "campaign.openingLocationName",
    issues,
  );
  requireProperty(
    campaign,
    "initialStoryDirection",
    "campaign.initialStoryDirection",
    issues,
  );

  const campaignName = requiredText(
    campaign.campaignName,
    "campaign.campaignName",
    80,
    issues,
  );
  const campaignDescription = optionalText(
    campaign.campaignDescription,
    "campaign.campaignDescription",
    2_000,
    issues,
  );
  const worldName = requiredText(
    world.name,
    "campaign.world.name",
    80,
    issues,
  );
  const worldPremise = requiredText(
    world.premise,
    "campaign.world.premise",
    6_000,
    issues,
  );
  const playerDescription = requiredText(
    player.description,
    "campaign.player.description",
    2_000,
    issues,
  );
  const openingLocationName = optionalText(
    campaign.openingLocationName,
    "campaign.openingLocationName",
    80,
    issues,
  );
  const openingScene = requiredText(
    campaign.openingScene,
    "campaign.openingScene",
    8_000,
    issues,
  );
  const initialStoryDirection = optionalText(
    campaign.initialStoryDirection,
    "campaign.initialStoryDirection",
    1_000,
    issues,
  );
  const initialStoryModuleId = optionalText(
    campaign.initialStoryModuleId,
    "campaign.initialStoryModuleId",
    120,
    issues,
  );
  let storyModules: JsonValue[] | undefined;
  if (campaign.storyModules !== undefined) {
    if (!Array.isArray(campaign.storyModules)) {
      issues.push("campaign.storyModules 必须是数组。");
    } else {
      storyModules = structuredClone(campaign.storyModules) as JsonValue[];
    }
  }
  let initialRelationships: JsonValue[] | undefined;
  if (campaign.initialRelationships !== undefined) {
    if (!Array.isArray(campaign.initialRelationships)) {
      issues.push("campaign.initialRelationships 必须是数组。");
    } else {
      initialRelationships = structuredClone(
        campaign.initialRelationships,
      ) as JsonValue[];
    }
  }
  let locations: JsonValue[] | undefined;
  if (campaign.locations !== undefined) {
    if (!Array.isArray(campaign.locations)) {
      issues.push("campaign.locations 必须是数组。");
    } else {
      locations = structuredClone(campaign.locations) as JsonValue[];
    }
  }
  let foreshadowing: JsonValue[] | undefined;
  if (campaign.foreshadowing !== undefined) {
    if (!Array.isArray(campaign.foreshadowing)) {
      issues.push("campaign.foreshadowing 必须是数组。");
    } else {
      foreshadowing = structuredClone(campaign.foreshadowing) as JsonValue[];
    }
  }
  let triggers: JsonValue[] | undefined;
  if (campaign.triggers !== undefined) {
    if (!Array.isArray(campaign.triggers)) {
      issues.push("campaign.triggers 必须是数组。");
    } else {
      triggers = structuredClone(campaign.triggers) as JsonValue[];
    }
  }

  const bundleName = requiredText(
    bundleSettings.name,
    "bundle.name",
    120,
    issues,
  );
  const bundleDescription = optionalText(
    bundleSettings.description,
    "bundle.description",
    2_000,
    issues,
  );
  const bundleCreator = optionalText(
    bundleSettings.creator,
    "bundle.creator",
    200,
    issues,
  );
  const bundleVersion = requiredText(
    bundleSettings.version,
    "bundle.version",
    120,
    issues,
  );
  const defaultOutputPath = relativeProjectPath(
    projectDirectory,
    bundleSettings.outputFile,
    "bundle.outputFile",
    [".json"],
    issues,
  );
  const defaultReportPath = relativeProjectPath(
    projectDirectory,
    bundleSettings.reportFile ?? "剧本包校验报告.json",
    "bundle.reportFile",
    [".json"],
    issues,
  );

  const playerCardPath = relativeProjectPath(
    projectDirectory,
    materials.playerCard,
    "materials.playerCard",
    [".json"],
    issues,
  );
  const mainMaterial = characterMaterial(
    materials.mainCharacter,
    "materials.mainCharacter",
    projectDirectory,
    issues,
  );
  const worldBookPath = relativeProjectPath(
    projectDirectory,
    materials.worldBook,
    "materials.worldBook",
    [".json"],
    issues,
  );

  const rawAdditionalCharacters = materials.additionalCharacters;
  if (!Array.isArray(rawAdditionalCharacters)) {
    issues.push("materials.additionalCharacters 必须是数组。");
  } else if (rawAdditionalCharacters.length > 20) {
    issues.push("materials.additionalCharacters 最多允许 20 项。");
  }
  const additionalMaterials = (
    Array.isArray(rawAdditionalCharacters)
      ? rawAdditionalCharacters.slice(0, 20)
      : []
  ).map((item, index) => {
    const label = `materials.additionalCharacters[${index}]`;
    const material = characterMaterial(
      item,
      label,
      projectDirectory,
      issues,
    );
    const record = isRecord(item) ? item : {};
    requireProperty(
      record,
      "presentAtOpening",
      `${label}.presentAtOpening`,
      issues,
    );
    return {
      ...material,
      presentAtOpening: booleanSetting(
        record.presentAtOpening,
        `${label}.presentAtOpening`,
        false,
        issues,
      ),
    };
  });

  const rawReferenceDocuments = materials.referenceDocuments ?? [];
  if (!Array.isArray(rawReferenceDocuments)) {
    issues.push("materials.referenceDocuments 必须是数组。");
  } else if (rawReferenceDocuments.length > 5) {
    issues.push("materials.referenceDocuments 最多允许 5 项。");
  }
  const referenceMaterials = (
    Array.isArray(rawReferenceDocuments)
      ? rawReferenceDocuments.slice(0, 5)
      : []
  ).map((item, index) => {
    const label = `materials.referenceDocuments[${index}]`;
    const record = section(item, label, issues);
    return {
      filePath: relativeProjectPath(
        projectDirectory,
        record.file,
        `${label}.file`,
        [".txt", ".md"],
        issues,
      ),
      name: requiredText(record.name, `${label}.name`, 120, issues),
      enabled: booleanSetting(
        record.enabled,
        `${label}.enabled`,
        true,
        issues,
      ),
      currentChapter:
        positiveIntegerSetting(
          record.currentChapter,
          `${label}.currentChapter`,
          1,
          issues,
        ),
      preventFuture: booleanSetting(
        record.preventFuture,
        `${label}.preventFuture`,
        true,
        issues,
      ),
      fidelity: fidelitySetting(
        record.fidelity,
        `${label}.fidelity`,
        issues,
      ),
    };
  });

  if (issues.length > 0) throw new BundleProjectError(issues);

  const [playerDocument, mainDocument, worldBookDocument] = await Promise.all([
    readJson(playerCardPath, "玩家人物卡"),
    readJson(mainMaterial.filePath, "主要角色人物卡"),
    readJson(worldBookPath, "世界书"),
  ]);
  const playerCard = parseCard(playerDocument, "玩家人物卡");
  const mainCard = parseCard(mainDocument, "主要角色人物卡");
  const additionalCards = await Promise.all(
    additionalMaterials.map(async (material, index) =>
      parseCard(
        await readJson(material.filePath, `其他角色人物卡 ${index + 1}`),
        `其他角色人物卡 ${index + 1}`,
      ),
    ),
  );

  let worldBook: ImportedWorldBook;
  try {
    worldBook = parseWorldBookDocument(worldBookDocument);
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw new BundleProjectError(
        error.issues.map((issue) => `世界书：${issue}`),
      );
    }
    throw error;
  }

  const nameIssues: string[] = [];
  const expectedPlayerName = requiredText(
    player.name,
    "campaign.player.name",
    80,
    nameIssues,
  );
  const expectedMainName = requiredText(
    mainCharacter.name,
    "campaign.mainCharacter.name",
    80,
    nameIssues,
  );
  if (expectedPlayerName && expectedPlayerName !== playerCard.name) {
    nameIssues.push(
      `campaign.player.name 是“${expectedPlayerName}”，但玩家人物卡姓名是“${playerCard.name}”。`,
    );
  }
  if (expectedMainName && expectedMainName !== mainCard.name) {
    nameIssues.push(
      `campaign.mainCharacter.name 是“${expectedMainName}”，但主要角色人物卡姓名是“${mainCard.name}”。`,
    );
  }
  const worldEntryIds = worldBook.entries.map((entry) => entry.sourceId);
  if (new Set(worldEntryIds).size !== worldEntryIds.length) {
    nameIssues.push("世界书条目 ID 不能重复。");
  }
  if (nameIssues.length > 0) throw new BundleProjectError(nameIssues);

  const referenceDocuments = await Promise.all(
    referenceMaterials.map(async (material, index) => ({
      name: material.name,
      fileName: basename(material.filePath),
      content: await readUtf8(
        material.filePath,
        `原文参考 ${index + 1}`,
      ),
      enabled: material.enabled,
      currentChapter: material.currentChapter,
      preventFuture: material.preventFuture,
      fidelity: material.fidelity,
    })),
  );

  const bundle: JsonObject = {
    spec: "ai_tavern_adventure_bundle_v1",
    spec_version: "1.1",
    name: bundleName,
    description: bundleDescription,
    ...(bundleCreator ? { creator: bundleCreator } : {}),
    bundle_version: bundleVersion,
    adventure: {
      campaignName,
      campaignDescription,
      world: {
        name: worldName,
        premise: worldPremise,
      },
      player: {
        description: playerDescription,
        card: normalizedV2Card(playerCard),
      },
      mainCharacter: {
        card: normalizedV2Card(mainCard),
        ...(mainMaterial.hasFirstMessage
          ? { firstMessage: mainMaterial.firstMessage }
          : {}),
      },
      additionalCharacters: additionalCards.map((card, index) => ({
        presentAtOpening: additionalMaterials[index].presentAtOpening,
        ...(additionalMaterials[index].hasFirstMessage
          ? { firstMessage: additionalMaterials[index].firstMessage }
          : {}),
        card: normalizedV2Card(card),
      })),
      worldBook: normalizedWorldBook(worldBook),
      ...(storyModules ? { storyModules } : {}),
      ...(initialRelationships ? { initialRelationships } : {}),
      ...(locations ? { locations } : {}),
      ...(foreshadowing ? { foreshadowing } : {}),
      ...(triggers ? { triggers } : {}),
      opening: {
        locationName: openingLocationName,
        scene: openingScene,
        initialStoryDirection,
        ...(initialStoryModuleId
          ? { initialStoryModuleId }
          : {}),
      },
      ...(referenceDocuments.length > 0 ? { referenceDocuments } : {}),
    },
  };

  let validated;
  try {
    validated = parseAdventureBundleDocument(bundle);
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw new BundleProjectError(error.issues);
    }
    throw error;
  }

  const warnings = [
    ...playerCard.warnings.map((warning) => `玩家人物卡：${warning}`),
    ...mainCard.warnings.map((warning) => `主要角色人物卡：${warning}`),
    ...additionalCards.flatMap((card, index) =>
      card.warnings.map(
        (warning) => `其他角色人物卡 ${index + 1}：${warning}`,
      ),
    ),
    ...worldBook.warnings.map((warning) => `世界书：${warning}`),
    roleWarning(playerCard, "player", "玩家人物卡"),
    roleWarning(mainCard, "main", "主要角色人物卡"),
    ...additionalCards.map((card, index) =>
      roleWarning(card, "additional", `其他角色人物卡 ${index + 1}`),
    ),
    ...validated.warnings,
  ].filter(Boolean);
  const uniqueWarnings = [...new Set(warnings)];
  const serializedBundle = `${JSON.stringify(bundle, null, 2)}\n`;
  const sha256 = createHash("sha256")
    .update(serializedBundle, "utf8")
    .digest("hex");
  const outputPath = overrides.outputPath
    ? resolve(overrides.outputPath)
    : defaultOutputPath;
  const reportPath = overrides.reportPath
    ? resolve(overrides.reportPath)
    : defaultReportPath;
  const outputIssues: string[] = [];
  if (extname(outputPath).toLocaleLowerCase("zh-CN") !== ".json") {
    outputIssues.push("完整剧本包输出文件必须使用 .json 后缀。");
  }
  if (extname(reportPath).toLocaleLowerCase("zh-CN") !== ".json") {
    outputIssues.push("校验报告输出文件必须使用 .json 后缀。");
  }
  if (outputPath === reportPath) {
    outputIssues.push("完整剧本包和校验报告不能写入同一个文件。");
  }
  const protectedPaths = new Set([
    absoluteManifestPath,
    playerCardPath,
    mainMaterial.filePath,
    worldBookPath,
    ...additionalMaterials.map((material) => material.filePath),
    ...referenceMaterials.map((material) => material.filePath),
  ]);
  if (protectedPaths.has(outputPath)) {
    outputIssues.push("完整剧本包输出位置不能覆盖开局预设或拆分资料。");
  }
  if (protectedPaths.has(reportPath)) {
    outputIssues.push("校验报告输出位置不能覆盖开局预设或拆分资料。");
  }
  if (outputIssues.length > 0) throw new BundleProjectError(outputIssues);
  const report: BundleProjectReport = {
    schemaVersion: "1.0.0",
    status: "valid",
    manifestFile: basename(absoluteManifestPath),
    outputFile: basename(outputPath),
    bundleName,
    bundleVersion,
    sha256,
    sizeBytes: Buffer.byteLength(serializedBundle, "utf8"),
    counts: {
      characters: additionalCards.length + 2,
      additionalCharacters: additionalCards.length,
      worldBookEntries: worldBook.entries.length,
      referenceDocuments: referenceDocuments.length,
      storyModules: validated.adventure.storyModules?.length ?? 0,
      plotThreads: validated.adventure.foreshadowing?.length ?? 0,
      plotTriggers: validated.adventure.triggers?.length ?? 0,
    },
    checks: [
      "维护清单格式有效",
      "全部资料路径位于项目目录内",
      "人物卡、世界书和原文参考可解析",
      "角色姓名与维护清单一致且不重复",
      "剧情任务 ID、前置关系和初始任务有效且无循环",
      "伏笔与偏离触发器的 ID、角色引用和属性白名单有效",
      "生成结果可被 AI 酒馆完整剧本包导入器接受",
    ],
    warnings: uniqueWarnings,
  };

  return {
    manifestPath: absoluteManifestPath,
    outputPath,
    reportPath,
    bundle,
    serializedBundle,
    report,
  };
}

export async function writeBundleProject(project: AssembledBundleProject) {
  await atomicWrite(project.outputPath, project.serializedBundle);
  await atomicWrite(
    project.reportPath,
    `${JSON.stringify(project.report, null, 2)}\n`,
  );
  return project;
}
