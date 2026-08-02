import type {
  AdventureWorldBookEntryInput,
  JsonObject,
  JsonValue,
} from "../storage/story-store.ts";

export type ImportFileKind = "character_card" | "world_book";

export interface ImportedCharacterCard {
  kind: "character_card";
  format: "character_card_v1" | "character_card_v2" | "character_card_v3";
  name: string;
  role: string;
  personality: string;
  firstMessage: string;
  scenario: string;
  card: JsonObject;
  warnings: string[];
}

export interface ImportedWorldBook {
  kind: "world_book";
  format: "ai_tavern_world_book_v1" | "sillytavern_world_info";
  name: string;
  description: string;
  entries: AdventureWorldBookEntryInput[];
  warnings: string[];
}

export type ImportPreview = ImportedCharacterCard | ImportedWorldBook;

export class ImportFileError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "导入文件格式无效。");
    this.name = "ImportFileError";
    this.issues = issues;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: JsonValue | undefined, maximumLength: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maximumLength)
    : "";
}

function identifier(value: JsonValue | undefined, maximumLength: number) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, maximumLength)
    : "";
}

function numberValue(
  value: JsonValue | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function booleanValue(value: JsonValue | undefined, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function stringList(
  value: JsonValue | undefined,
  maximumItems: number,
  maximumLength: number,
) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return source
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maximumLength))
    .filter(Boolean)
    .slice(0, maximumItems);
}

function boundedObject(
  value: JsonValue | undefined,
  maximumSerializedLength: number,
) {
  if (!isObject(value)) return {};
  return JSON.stringify(value).length <= maximumSerializedLength
    ? structuredClone(value)
    : {};
}

function optionalJsonField(
  source: JsonObject,
  target: JsonObject,
  key: string,
  maximumSerializedLength: number,
) {
  const value = source[key];
  if (value === undefined) return;
  if (JSON.stringify(value).length <= maximumSerializedLength) {
    target[key] = structuredClone(value);
  }
}

export function parseCharacterCardDocument(value: unknown): ImportedCharacterCard {
  if (!isObject(value)) {
    throw new ImportFileError(["人物卡必须是一个 JSON 对象。"]);
  }

  const warnings: string[] = [];
  const declaredSpec = text(value.spec, 80);
  const nestedData = isObject(value.data) ? value.data : null;
  const source = nestedData ?? value;
  let format: ImportedCharacterCard["format"];
  let outputSpec: "chara_card_v2" | "chara_card_v3";
  let outputVersion: "2.0" | "3.0";

  if (declaredSpec === "chara_card_v3") {
    format = "character_card_v3";
    outputSpec = "chara_card_v3";
    outputVersion = "3.0";
  } else if (declaredSpec === "chara_card_v2") {
    format = "character_card_v2";
    outputSpec = "chara_card_v2";
    outputVersion = "2.0";
  } else if (!nestedData) {
    format = "character_card_v1";
    outputSpec = "chara_card_v2";
    outputVersion = "2.0";
    warnings.push("旧版扁平人物卡已在导入时规范化为 Character Card V2。");
  } else {
    throw new ImportFileError([
      "无法识别人物卡版本；支持 chara_card_v2、chara_card_v3 或旧版扁平 JSON。",
    ]);
  }

  const name = text(source.name, 80);
  const description = text(source.description, 6_000);
  const personalityText = text(source.personality, 6_000);
  const scenario = text(source.scenario, 8_000);
  const firstMessage = text(source.first_mes ?? source.firstMessage, 4_000);
  const issues: string[] = [];
  if (!name) issues.push("人物卡缺少 data.name（角色姓名）。");
  if (!description && !personalityText) {
    issues.push("人物卡的 description 和 personality 不能同时为空。");
  }
  if (issues.length > 0) throw new ImportFileError(issues);

  const role = (description || scenario || "未提供身份背景。").slice(0, 2_000);
  const personality = (personalityText || description).slice(0, 2_000);
  const alternateGreetings = stringList(
    source.alternate_greetings,
    20,
    4_000,
  );
  const tags = stringList(source.tags, 40, 80);
  const data: JsonObject = {
    name,
    description,
    personality: personalityText,
    scenario,
    first_mes: firstMessage,
    mes_example: text(source.mes_example, 8_000),
    creator_notes: text(source.creator_notes, 4_000),
    system_prompt: text(source.system_prompt, 8_000),
    post_history_instructions: text(
      source.post_history_instructions,
      8_000,
    ),
    alternate_greetings: alternateGreetings,
    tags,
    creator: text(source.creator, 200),
    character_version: text(source.character_version, 120),
    extensions: boundedObject(source.extensions, 20_000),
  };

  optionalJsonField(source, data, "character_book", 200_000);
  if (format === "character_card_v3") {
    for (const field of [
      "assets",
      "nickname",
      "creator_notes_multilingual",
      "source",
      "group_only_greetings",
      "creation_date",
      "modification_date",
    ]) {
      optionalJsonField(source, data, field, 50_000);
    }
  }

  return {
    kind: "character_card",
    format,
    name,
    role,
    personality,
    firstMessage,
    scenario,
    card: {
      spec: outputSpec,
      spec_version: outputVersion,
      data,
    },
    warnings,
  };
}

function worldBookPosition(
  value: JsonValue | undefined,
  warnings: string[],
  entryNumber: number,
): "before_char" | "after_char" {
  if (value === "before_char" || value === 0) return "before_char";
  if (value === "after_char" || value === 1 || value === undefined) {
    return "after_char";
  }
  warnings.push(
    `第 ${entryNumber} 条使用了当前引擎不支持的插入位置，已映射为 after_char。`,
  );
  return "after_char";
}

function parseWorldBookEntry(
  value: JsonValue,
  index: number,
  warnings: string[],
): AdventureWorldBookEntryInput | null {
  if (!isObject(value)) {
    warnings.push(`第 ${index + 1} 条不是 JSON 对象，已跳过。`);
    return null;
  }

  const content = text(value.content, 12_000);
  if (!content) {
    warnings.push(`第 ${index + 1} 条没有正文，已跳过。`);
    return null;
  }
  const constant = booleanValue(value.constant, false);
  const keys = stringList(value.keys ?? value.key, 30, 120);
  if (!constant && keys.length === 0) {
    warnings.push(
      `第 ${index + 1} 条没有触发词且不是常驻条目，已改为常驻。`,
    );
  }
  const enabled =
    typeof value.enabled === "boolean"
      ? value.enabled
      : typeof value.disable === "boolean"
        ? !value.disable
        : true;

  return {
    sourceId:
      identifier(value.sourceId ?? value.id ?? value.uid, 120) ||
      `entry-${index + 1}`,
    sourceBookName: text(value.sourceBookName, 120),
    sourceFormat: text(value.sourceFormat, 80),
    comment: text(value.comment ?? value.title, 300),
    keys,
    secondaryKeys: stringList(
      value.secondaryKeys ?? value.keysecondary,
      30,
      120,
    ),
    content,
    enabled,
    constant: constant || keys.length === 0,
    selective: booleanValue(value.selective, false),
    position: worldBookPosition(value.position, warnings, index + 1),
    order: numberValue(value.order, 100, -10_000, 10_000),
    probability: numberValue(value.probability, 100, 0, 100),
    depth: numberValue(value.depth, 4, 0, 999),
    extensions: boundedObject(value.extensions, 10_000),
  };
}

export function parseWorldBookDocument(value: unknown): ImportedWorldBook {
  if (!isObject(value)) {
    throw new ImportFileError(["世界书必须是一个 JSON 对象。"]);
  }

  const spec = text(value.spec, 80);
  const format: ImportedWorldBook["format"] =
    spec === "ai_tavern_world_book_v1"
      ? "ai_tavern_world_book_v1"
      : "sillytavern_world_info";
  if (spec && format !== "ai_tavern_world_book_v1") {
    throw new ImportFileError([
      `不支持的世界书规范 ${spec}；请使用 AI 酒馆 v1 或 SillyTavern World Info JSON。`,
    ]);
  }
  if (
    format === "ai_tavern_world_book_v1" &&
    text(value.spec_version, 20) !== "1.0"
  ) {
    throw new ImportFileError(["AI 酒馆世界书的 spec_version 必须是 1.0。"]);
  }

  const sourceEntries = value.entries;
  const rawEntries = Array.isArray(sourceEntries)
    ? sourceEntries
    : isObject(sourceEntries)
      ? Object.values(sourceEntries)
      : [];
  if (rawEntries.length === 0) {
    throw new ImportFileError(["世界书没有可导入的 entries。"]);
  }
  if (rawEntries.length > 200) {
    throw new ImportFileError(["单个世界书最多允许导入 200 条条目。"]);
  }

  const warnings: string[] = [];
  const entries = rawEntries
    .map((entry, index) => parseWorldBookEntry(entry, index, warnings))
    .filter((entry): entry is AdventureWorldBookEntryInput => entry !== null);
  if (entries.length === 0) {
    throw new ImportFileError(["世界书中没有包含正文的有效条目。"]);
  }

  const name = text(value.name, 120) || "未命名世界书";
  return {
    kind: "world_book",
    format,
    name,
    description: text(value.description, 2_000),
    entries: entries.map((entry) => ({
      ...entry,
      sourceBookName: entry.sourceBookName || name,
      sourceFormat: entry.sourceFormat || format,
    })),
    warnings,
  };
}

export function parseImportPreviewRequest(value: unknown): {
  kind: ImportFileKind;
  fileName: string;
  preview: ImportPreview;
} {
  if (!isObject(value)) {
    throw new ImportFileError(["导入请求必须是 JSON 对象。"]);
  }
  const kind = value.kind;
  const fileName = text(value.fileName, 255);
  if (kind !== "character_card" && kind !== "world_book") {
    throw new ImportFileError(["导入类型必须是人物卡或世界书。"]);
  }
  if (!fileName) throw new ImportFileError(["缺少导入文件名。"]);
  const document = value.document;
  let preview =
    kind === "character_card"
      ? parseCharacterCardDocument(document)
      : parseWorldBookDocument(document);
  if (preview.kind === "world_book" && preview.name === "未命名世界书") {
    const name = fileName.replace(/\.json$/i, "").slice(0, 120);
    preview = {
      ...preview,
      name,
      entries: preview.entries.map((entry) => ({
        ...entry,
        sourceBookName:
          entry.sourceBookName === "未命名世界书"
            ? name
            : entry.sourceBookName,
      })),
    };
  }
  return { kind, fileName, preview };
}
