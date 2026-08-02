export type SourceReferenceFidelity = "balanced" | "faithful";

export interface SourceDocumentInput {
  name: string;
  fileName: string;
  content: string;
  enabled: boolean;
  currentChapter: number;
  preventFuture: boolean;
  fidelity: SourceReferenceFidelity;
}

export interface SourceChunkDraft {
  ordinal: number;
  chapterIndex: number;
  chapterTitle: string;
  content: string;
  characterNames: string[];
}

export interface SourceDocumentSummary {
  id: string;
  name: string;
  fileName: string;
  contentLength: number;
  chapterCount: number;
  chunkCount: number;
  enabled: boolean;
  currentChapter: number;
  preventFuture: boolean;
  fidelity: SourceReferenceFidelity;
  createdAt: string;
  updatedAt: string;
}

export interface SourceDocumentSettingsInput {
  enabled?: boolean;
  currentChapter?: number;
  preventFuture?: boolean;
  fidelity?: SourceReferenceFidelity;
}

export interface SourceReferenceExcerpt {
  chunkId: string;
  ordinal: number;
  documentId: string;
  documentName: string;
  fileName: string;
  chapterIndex: number;
  chapterTitle: string;
  content: string;
  matchedCharacterNames: string[];
  matchedTerms: string[];
  fidelity: SourceReferenceFidelity;
  score: number;
}

export interface SourceChunkCandidate {
  chunkId: string;
  ordinal: number;
  documentId: string;
  documentName: string;
  fileName: string;
  chapterIndex: number;
  chapterTitle: string;
  content: string;
  characterNames: string[];
  currentChapter: number;
  fidelity: SourceReferenceFidelity;
}

export class SourceReferenceInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "原文参考资料无效。");
    this.name = "SourceReferenceInputError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textField(
  value: unknown,
  label: string,
  maximumLength: number,
  issues: string[],
) {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${label}不能为空。`);
    return "";
  }
  const normalized = value.replaceAll("\u0000", "").replaceAll("\r\n", "\n").trim();
  if (normalized.length > maximumLength) {
    issues.push(`${label}不能超过 ${maximumLength.toLocaleString("zh-CN")} 个字符。`);
  }
  return normalized.slice(0, maximumLength);
}

export function parseSourceDocumentInput(value: unknown): SourceDocumentInput {
  if (!isRecord(value)) {
    throw new SourceReferenceInputError(["原文参考资料必须是一个对象。"]);
  }
  const issues: string[] = [];
  const fileName = textField(value.fileName, "原文文件名", 255, issues);
  if (fileName && !/\.(txt|md)$/i.test(fileName)) {
    issues.push("原文参考目前只支持 .txt 和 .md 文件。");
  }
  const content = textField(value.content, "原文内容", 2_000_000, issues);
  const defaultName = fileName.replace(/\.(txt|md)$/i, "").trim() || "原文参考";
  const name =
    value.name === undefined || value.name === null || value.name === ""
      ? defaultName
      : textField(value.name, "原文名称", 120, issues);
  const currentChapter =
    value.currentChapter === undefined
      ? 1
      : typeof value.currentChapter === "number" &&
          Number.isInteger(value.currentChapter) &&
          value.currentChapter >= 1
        ? value.currentChapter
        : 0;
  if (currentChapter === 0) issues.push("当前原作进度必须是正整数。");
  const fidelity = value.fidelity ?? "balanced";
  if (fidelity !== "balanced" && fidelity !== "faithful") {
    issues.push("原作贴合度必须是 balanced 或 faithful。");
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    issues.push("原文参考启用状态必须是布尔值。");
  }
  if (
    value.preventFuture !== undefined &&
    typeof value.preventFuture !== "boolean"
  ) {
    issues.push("防止引用未来章节必须是布尔值。");
  }
  if (issues.length > 0) throw new SourceReferenceInputError(issues);
  return {
    name,
    fileName,
    content,
    enabled: value.enabled !== false,
    currentChapter,
    preventFuture: value.preventFuture !== false,
    fidelity: fidelity as SourceReferenceFidelity,
  };
}

export function parseSourceDocumentSettings(
  value: unknown,
): SourceDocumentSettingsInput {
  if (!isRecord(value)) {
    throw new SourceReferenceInputError(["原文参考设置必须是一个对象。"]);
  }
  const issues: string[] = [];
  const result: SourceDocumentSettingsInput = {};
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== "boolean") {
      issues.push("原文参考启用状态必须是布尔值。");
    } else {
      result.enabled = value.enabled;
    }
  }
  if (value.currentChapter !== undefined) {
    if (
      typeof value.currentChapter !== "number" ||
      !Number.isInteger(value.currentChapter) ||
      value.currentChapter < 1
    ) {
      issues.push("当前原作进度必须是正整数。");
    } else {
      result.currentChapter = value.currentChapter;
    }
  }
  if (value.preventFuture !== undefined) {
    if (typeof value.preventFuture !== "boolean") {
      issues.push("防止引用未来章节必须是布尔值。");
    } else {
      result.preventFuture = value.preventFuture;
    }
  }
  if (value.fidelity !== undefined) {
    if (value.fidelity !== "balanced" && value.fidelity !== "faithful") {
      issues.push("原作贴合度必须是 balanced 或 faithful。");
    } else {
      result.fidelity = value.fidelity;
    }
  }
  if (Object.keys(result).length === 0 && issues.length === 0) {
    issues.push("没有提供需要修改的原文参考设置。");
  }
  if (issues.length > 0) throw new SourceReferenceInputError(issues);
  return result;
}

interface SourceSection {
  title: string;
  content: string;
}

function longestFencedBlock(content: string) {
  const blocks = [...content.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return blocks[0] && blocks[0].length >= 200 ? blocks[0] : content;
}

function findSections(content: string): SourceSection[] {
  const lines = content.split("\n");
  const candidates = lines.map((line, index) => {
    const markdown = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    const title = (markdown?.[2] ?? line).trim();
    return {
      index,
      line,
      title,
      markdownLevel: markdown?.[1].length ?? 0,
      reply: /^回复\s*\d+/i.test(title),
      chapter: /^第[0-9零〇一二三四五六七八九十百千万两]+[章节回卷部幕集篇]/.test(
        title,
      ),
    };
  });
  const replyHeadings = candidates.filter((item) => item.reply);
  const markdownChapterHeadings = candidates.filter(
    (item) => item.chapter && item.markdownLevel > 0,
  );
  const plainChapterHeadings = candidates.filter(
    (item) => item.chapter && item.markdownLevel === 0,
  );
  const chapterHeadings =
    markdownChapterHeadings.length > 0
      ? markdownChapterHeadings
      : plainChapterHeadings;
  const markdownHeadings = candidates.filter(
    (item) => item.markdownLevel >= 2 && item.markdownLevel <= 4,
  );
  const headings =
    replyHeadings.length >= 2
      ? replyHeadings
      : chapterHeadings.length >= 2
        ? chapterHeadings
        : markdownHeadings.length >= 2
          ? markdownHeadings
          : [];

  if (headings.length === 0) {
    return [{ title: "全文", content }];
  }
  return headings.map((heading, index) => {
    const next = headings[index + 1];
    const sectionLines = lines.slice(heading.index + 1, next?.index ?? lines.length);
    return {
      title: heading.title.slice(0, 160),
      content: longestFencedBlock(sectionLines.join("\n").trim()),
    };
  });
}

function splitSection(content: string) {
  const compact = content
    .replace(/^---+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!compact) return [];
  const chunks: string[] = [];
  const targetLength = 1_500;
  const minimumLength = 900;
  const overlapLength = 140;
  let cursor = 0;
  while (cursor < compact.length) {
    let end = Math.min(cursor + targetLength, compact.length);
    if (end < compact.length) {
      const paragraphBoundary = compact.lastIndexOf("\n\n", end);
      const sentenceBoundary = Math.max(
        compact.lastIndexOf("。", end),
        compact.lastIndexOf("！", end),
        compact.lastIndexOf("？", end),
      );
      const boundary = Math.max(paragraphBoundary, sentenceBoundary + 1);
      if (boundary >= cursor + minimumLength) end = boundary;
    }
    const chunk = compact.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= compact.length) break;
    cursor = Math.max(cursor + 1, end - overlapLength);
  }
  return chunks;
}

export function splitSourceDocument(
  content: string,
  characterNames: string[],
): { chapterCount: number; chunks: SourceChunkDraft[] } {
  const sections = findSections(content);
  const chunks: SourceChunkDraft[] = [];
  for (const [sectionIndex, section] of sections.entries()) {
    for (const part of splitSection(section.content)) {
      chunks.push({
        ordinal: chunks.length,
        chapterIndex: sectionIndex + 1,
        chapterTitle: section.title || `第 ${sectionIndex + 1} 章`,
        content: part,
        characterNames: characterNames.filter(
          (name) => name.length >= 2 && part.includes(name),
        ),
      });
    }
  }
  if (chunks.length === 0) {
    throw new SourceReferenceInputError(["原文中没有可用于检索的正文内容。"]);
  }
  return { chapterCount: sections.length, chunks };
}

const ignoredQueryTerms = new Set([
  "玩家",
  "角色",
  "当前",
  "剧情",
  "故事",
  "怎么",
  "什么",
  "然后",
  "一个",
  "没有",
  "这个",
  "那个",
  "进行",
]);

function queryTerms(query: string) {
  const terms = new Set<string>();
  for (const token of query
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (token.length <= 8) {
        if (token.length >= 2) terms.add(token);
      } else {
        for (let index = 0; index + 4 <= token.length; index += 3) {
          terms.add(token.slice(index, index + 4));
        }
        for (let index = 0; index + 2 <= token.length; index += 1) {
          terms.add(token.slice(index, index + 2));
        }
      }
    } else if (token.length >= 3) {
      terms.add(token.toLocaleLowerCase());
    }
  }
  return [...terms].filter((term) => !ignoredQueryTerms.has(term)).slice(0, 40);
}

export function rankSourceReferences(input: {
  candidates: SourceChunkCandidate[];
  query: string;
  currentCharacterNames: string[];
  maximumReferences?: number;
  characterBudget?: number;
}): SourceReferenceExcerpt[] {
  const terms = queryTerms(input.query);
  const currentNames = new Set(input.currentCharacterNames);
  const ranked = input.candidates
    .map((candidate) => {
      const matchedCharacterNames = candidate.characterNames.filter((name) =>
        currentNames.has(name),
      );
      const lowerContent = candidate.content.toLocaleLowerCase();
      const matchedTerms = terms.filter((term) =>
        lowerContent.includes(term.toLocaleLowerCase()),
      );
      const chapterDistance = Math.abs(
        candidate.currentChapter - candidate.chapterIndex,
      );
      const score =
        matchedCharacterNames.length * 14 +
        matchedTerms.reduce((total, term) => total + Math.min(term.length, 6), 0) +
        (chapterDistance === 0 ? 8 : chapterDistance === 1 ? 3 : 0) +
        (/[“”「」]/.test(candidate.content) ? 2 : 0);
      return {
        chunkId: candidate.chunkId,
        ordinal: candidate.ordinal,
        documentId: candidate.documentId,
        documentName: candidate.documentName,
        fileName: candidate.fileName,
        chapterIndex: candidate.chapterIndex,
        chapterTitle: candidate.chapterTitle,
        content: candidate.content,
        matchedCharacterNames,
        matchedTerms: matchedTerms.slice(0, 6),
        fidelity: candidate.fidelity,
        score,
      } satisfies SourceReferenceExcerpt;
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.chapterIndex - left.chapterIndex ||
        left.chunkId.localeCompare(right.chunkId),
    );

  const faithful = ranked.some((item) => item.fidelity === "faithful");
  const maximumReferences =
    input.maximumReferences ?? (faithful ? 5 : 3);
  const characterBudget =
    input.characterBudget ?? (faithful ? 7_000 : 4_800);
  const selected: SourceReferenceExcerpt[] = [];
  let usedCharacters = 0;
  for (const reference of ranked) {
    if (selected.length >= maximumReferences) break;
    if (
      selected.some(
        (item) =>
          item.documentId === reference.documentId &&
          item.chapterIndex === reference.chapterIndex &&
          Math.abs(item.ordinal - reference.ordinal) <= 1,
      )
    ) {
      continue;
    }
    if (usedCharacters + reference.content.length > characterBudget) continue;
    selected.push(reference);
    usedCharacters += reference.content.length;
  }
  return selected;
}
