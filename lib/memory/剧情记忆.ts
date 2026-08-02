import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { JsonObject, JsonValue } from "../storage/story-store.ts";

export type StoryMemoryType =
  | "fact"
  | "relationship"
  | "character"
  | "thread"
  | "commitment";

export interface StoryMemorySettings {
  memoryTokenBudget: number;
  recentTurnCount: number;
  chapterSize: number;
}

export interface StoryMemoryEntry {
  id: string;
  sourceTurnId: string | null;
  type: StoryMemoryType;
  title: string;
  content: string;
  subjectKey: string;
  keywords: string[];
  characterIds: string[];
  locationId: string | null;
  importance: number;
  status: "active" | "resolved";
  pinned: boolean;
  enabled: boolean;
  source: "automatic" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface StoryMemoryChapter {
  id: string;
  startTurnId: string;
  endTurnId: string;
  startSequence: number;
  endSequence: number;
  title: string;
  summary: string;
  keywords: string[];
  characterIds: string[];
  locationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryMemoryContext {
  query: string;
  entries: StoryMemoryEntry[];
  chapters: StoryMemoryChapter[];
  estimatedTokens: number;
  budgetTokens: number;
  recentTurnCount: number;
  totalCandidateCount: number;
}

export interface StoryMemoryDashboard {
  settings: StoryMemorySettings;
  entries: StoryMemoryEntry[];
  chapters: StoryMemoryChapter[];
  latestRetrieval: {
    turnId: string;
    query: string;
    memoryIds: string[];
    chapterIds: string[];
    estimatedTokens: number;
    budgetTokens: number;
    createdAt: string;
  } | null;
}

export interface StoryMemoryTurn {
  id: string;
  sequence: number;
  playerInput: JsonObject;
  generatedOutput: JsonObject;
  summaryPatch: string;
  createdAt: string;
}

interface EntryRow {
  id: string;
  source_turn_id: string | null;
  type: StoryMemoryType;
  title: string;
  content: string;
  subject_key: string;
  keywords_json: string;
  character_ids_json: string;
  location_id: string | null;
  importance: number;
  status: "active" | "resolved";
  pinned: number;
  enabled: number;
  source: "automatic" | "manual";
  created_at: string;
  updated_at: string;
}

interface ChapterRow {
  id: string;
  start_turn_id: string;
  end_turn_id: string;
  start_sequence: number;
  end_sequence: number;
  title: string;
  summary: string;
  keywords_json: string;
  character_ids_json: string;
  location_ids_json: string;
  created_at: string;
  updated_at: string;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objects(value: JsonValue | undefined) {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function text(value: JsonValue | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: JsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseStrings(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function estimateStoryMemoryTokens(value: string) {
  const chineseCount = (value.match(/[\u3400-\u9fff]/g) ?? []).length;
  const otherCount = Math.max(0, value.length - chineseCount);
  return Math.max(1, Math.ceil(chineseCount / 1.5 + otherCount / 4));
}

export function extractMemoryTerms(value: string) {
  const normalized = value.toLowerCase();
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]{1,31}/g)) {
    terms.add(match[0]);
  }
  for (const match of normalized.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const run = match[0];
    if (run.length <= 8) terms.add(run);
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.add(run.slice(index, index + 2));
    }
    for (let index = 0; index < run.length - 2; index += 1) {
      terms.add(run.slice(index, index + 3));
    }
  }
  return [...terms].slice(0, 160);
}

function mapEntry(row: EntryRow): StoryMemoryEntry {
  return {
    id: row.id,
    sourceTurnId: row.source_turn_id,
    type: row.type,
    title: row.title,
    content: row.content,
    subjectKey: row.subject_key,
    keywords: parseStrings(row.keywords_json),
    characterIds: parseStrings(row.character_ids_json),
    locationId: row.location_id,
    importance: row.importance,
    status: row.status,
    pinned: row.pinned === 1,
    enabled: row.enabled === 1,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChapter(row: ChapterRow): StoryMemoryChapter {
  return {
    id: row.id,
    startTurnId: row.start_turn_id,
    endTurnId: row.end_turn_id,
    startSequence: row.start_sequence,
    endSequence: row.end_sequence,
    title: row.title,
    summary: row.summary,
    keywords: parseStrings(row.keywords_json),
    characterIds: parseStrings(row.character_ids_json),
    locationIds: parseStrings(row.location_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ensureStoryMemorySettings(
  database: DatabaseSync,
  sessionId: string,
): StoryMemorySettings {
  database
    .prepare("INSERT OR IGNORE INTO memory_settings (session_id) VALUES (?)")
    .run(sessionId);
  const row = database
    .prepare(`
      SELECT memory_token_budget, recent_turn_count, chapter_size
      FROM memory_settings WHERE session_id = ?
    `)
    .get(sessionId) as {
    memory_token_budget: number;
    recent_turn_count: number;
    chapter_size: number;
  };
  return {
    memoryTokenBudget: clamp(row.memory_token_budget, 600, 8000),
    recentTurnCount: clamp(row.recent_turn_count, 2, 12),
    chapterSize: clamp(row.chapter_size, 5, 20),
  };
}

interface ExtractedEntry {
  type: StoryMemoryType;
  title: string;
  content: string;
  subjectKey?: string;
  characterIds?: string[];
  locationId?: string | null;
  importance: number;
  status?: "active" | "resolved";
}

function extractTurnEntries(turn: StoryMemoryTurn): ExtractedEntry[] {
  const output = turn.generatedOutput;
  const generatedTurn = isObject(output.turn) ? output.turn : {};
  const stateCommit = isObject(output.stateCommit) ? output.stateCommit : {};
  const result: ExtractedEntry[] = [];

  for (const event of objects(generatedTurn.events)) {
    const summary = text(event.summary);
    if (!summary) continue;
    const eventType = text(event.type) || "剧情事件";
    const isThread = /线索|谜|秘密|任务|危机|威胁|失踪|追查|约定|目标/.test(
      `${eventType}${summary}`,
    );
    result.push({
      type: isThread ? "thread" : "fact",
      title: eventType,
      content: summary,
      subjectKey: text(event.id),
      characterIds: strings(event.characterIds),
      locationId: text(event.locationId) || null,
      importance: isThread ? 78 : 58,
    });
  }

  for (const change of objects(stateCommit.relationshipChanges)) {
    const reason = text(change.reason);
    if (!reason) continue;
    const source = text(change.sourceCharacterId);
    const target = text(change.targetCharacterId);
    result.push({
      type: "relationship",
      title: "关系发生变化",
      content: reason,
      subjectKey: `${source}:${target}`,
      characterIds: [source, target].filter(Boolean),
      importance: 72,
    });
  }

  for (const change of objects(stateCommit.characterCardChanges)) {
    const reason = text(change.reason);
    const characterId = text(change.characterId);
    if (!reason || !characterId) continue;
    result.push({
      type: "character",
      title: "角色长期变化",
      content: reason,
      subjectKey: characterId,
      characterIds: [characterId],
      importance: 82,
    });
  }

  for (const change of objects(stateCommit.worldBookChanges)) {
    const reason = text(change.reason);
    if (!reason) continue;
    const entry = isObject(change.entry) ? change.entry : {};
    const patch = isObject(change.patch) ? change.patch : {};
    const durableContent = text(entry.content) || text(patch.content);
    result.push({
      type: "fact",
      title: "世界事实变化",
      content: durableContent ? `${reason}：${durableContent}` : reason,
      subjectKey: text(change.targetEntryId),
      importance: 90,
    });
  }

  const roleplay = isObject(turn.playerInput.roleplay)
    ? turn.playerInput.roleplay
    : {};
  const playerAction = [
    text(turn.playerInput.customChoice),
    text(roleplay.content),
  ]
    .filter(Boolean)
    .join("；");
  if (playerAction && /承诺|答应|保证|发誓|誓言|约定|绝不|一定会/.test(playerAction)) {
    result.push({
      type: "commitment",
      title: "玩家作出的承诺",
      content: playerAction,
      subjectKey: "player",
      importance: 88,
    });
  }

  const evaluation = isObject(stateCommit.storyDirectionEvaluation)
    ? stateCommit.storyDirectionEvaluation
    : {};
  const requestedDirection = text(turn.playerInput.storyDirection);
  const completedDirection =
    text(evaluation.status) === "completed"
      ? text(turn.playerInput.effectiveStoryDirection)
      : "";
  const direction = requestedDirection || completedDirection;
  if (direction) {
    const completed = text(evaluation.status) === "completed";
    result.push({
      type: "thread",
      title: completed ? "已完成的剧情走向" : "玩家指定的剧情走向",
      content: direction,
      subjectKey: "story-direction",
      importance: 95,
      status: completed ? "resolved" : "active",
    });
  }

  if (result.length === 0 && turn.summaryPatch.trim()) {
    result.push({
      type: "fact",
      title: `第 ${turn.sequence} 回合摘要`,
      content: turn.summaryPatch.trim(),
      importance: 45,
    });
  }
  return result.slice(0, 12);
}

export function rebuildStoryMemory(input: {
  database: DatabaseSync;
  sessionId: string;
  branchId: string;
  turns: StoryMemoryTurn[];
}) {
  const { database, sessionId, branchId, turns } = input;
  const settings = ensureStoryMemorySettings(database, sessionId);
  const now = new Date().toISOString();
  database
    .prepare(
      "DELETE FROM memory_entries WHERE branch_id = ? AND source = 'automatic'",
    )
    .run(branchId);
  database.prepare("DELETE FROM memory_chapters WHERE branch_id = ?").run(branchId);

  const insertEntry = database.prepare(`
    INSERT OR IGNORE INTO memory_entries (
      id, session_id, branch_id, source_turn_id, type, title, content,
      subject_key, keywords_json, character_ids_json, location_id,
      importance, status, pinned, enabled, source, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'automatic', '{}', ?, ?)
  `);
  const resolveEntry = database.prepare(
    "UPDATE memory_entries SET status = 'resolved', updated_at = ? WHERE id = ?",
  );
  let activeDirectionEntryId = "";
  for (const turn of turns) {
    for (const [ordinal, entry] of extractTurnEntries(turn).entries()) {
      const entryId = `${branchId}:${turn.id}:memory:${ordinal}`;
      if (entry.subjectKey === "story-direction") {
        if (activeDirectionEntryId) {
          resolveEntry.run(now, activeDirectionEntryId);
          activeDirectionEntryId = "";
        }
        if ((entry.status ?? "active") === "active") {
          activeDirectionEntryId = entryId;
        }
      }
      const searchable = [entry.title, entry.content, entry.subjectKey ?? ""].join(" ");
      insertEntry.run(
        entryId,
        sessionId,
        branchId,
        turn.id,
        entry.type,
        entry.title,
        entry.content,
        entry.subjectKey ?? "",
        JSON.stringify(extractMemoryTerms(searchable)),
        JSON.stringify(entry.characterIds ?? []),
        entry.locationId ?? null,
        entry.importance,
        entry.status ?? "active",
        now,
        now,
      );
    }
  }

  const insertChapter = database.prepare(`
    INSERT INTO memory_chapters (
      id, session_id, branch_id, start_turn_id, end_turn_id,
      start_sequence, end_sequence, title, summary, keywords_json,
      character_ids_json, location_ids_json, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'automatic', ?, ?)
  `);
  for (let index = 0; index < turns.length; index += settings.chapterSize) {
    const group = turns.slice(index, index + settings.chapterSize);
    if (group.length === 0) continue;
    const first = group[0];
    const last = group.at(-1)!;
    const summary = group
      .flatMap((turn) => {
        const line = turn.summaryPatch.trim();
        return line ? [`第 ${turn.sequence} 回合：${line}`] : [];
      })
      .join("\n")
      .slice(0, 3200) || `第 ${first.sequence} 至 ${last.sequence} 回合。`;
    const characterIds = new Set<string>();
    const locationIds = new Set<string>();
    for (const turn of group) {
      const generatedTurn = isObject(turn.generatedOutput.turn)
        ? turn.generatedOutput.turn
        : {};
      for (const event of objects(generatedTurn.events)) {
        strings(event.characterIds).forEach((id) => characterIds.add(id));
        const locationId = text(event.locationId);
        if (locationId) locationIds.add(locationId);
      }
    }
    const titleSource = last.summaryPatch.trim() || first.summaryPatch.trim();
    const title = titleSource
      ? `第 ${first.sequence}—${last.sequence} 回合 · ${titleSource.slice(0, 28)}`
      : `第 ${first.sequence}—${last.sequence} 回合`;
    insertChapter.run(
      `${branchId}:chapter:${first.sequence}-${last.sequence}`,
      sessionId,
      branchId,
      first.id,
      last.id,
      first.sequence,
      last.sequence,
      title,
      summary,
      JSON.stringify(extractMemoryTerms(`${title}\n${summary}`)),
      JSON.stringify([...characterIds]),
      JSON.stringify([...locationIds]),
      now,
      now,
    );
  }
  return { entryCount: turns.reduce((total, turn) => total + extractTurnEntries(turn).length, 0) };
}

export function selectStoryMemoryContext(input: {
  database: DatabaseSync;
  sessionId: string;
  branchId: string;
  query: string;
}): StoryMemoryContext {
  const { database, sessionId, branchId } = input;
  const query = input.query.trim();
  const settings = ensureStoryMemorySettings(database, sessionId);
  const entryRows = database
    .prepare(`
      SELECT id, source_turn_id, type, title, content, subject_key,
             keywords_json, character_ids_json, location_id, importance,
             status, pinned, enabled, source, created_at, updated_at
      FROM memory_entries
      WHERE branch_id = ? AND enabled = 1
      ORDER BY updated_at DESC, id
    `)
    .all(branchId) as unknown as EntryRow[];
  const entries = entryRows.map(mapEntry);
  const queryTerms = new Set(extractMemoryTerms(query));
  const scoredEntries = entries
    .map((entry) => {
      const overlap = entry.keywords.reduce(
        (total, keyword) => total + (queryTerms.has(keyword) ? 1 : 0),
        0,
      );
      const alwaysRelevant =
        entry.pinned ||
        (entry.status === "active" &&
          (entry.type === "thread" || entry.type === "commitment"));
      const score =
        overlap * 24 +
        entry.importance / 10 +
        (entry.pinned ? 1000 : 0) +
        (alwaysRelevant ? 18 : 0);
      return { entry, overlap, alwaysRelevant, score };
    })
    .filter((item) => item.overlap > 0 || item.alwaysRelevant)
    .sort((left, right) => right.score - left.score);

  const chapterRows = database
    .prepare(`
      SELECT id, start_turn_id, end_turn_id, start_sequence, end_sequence,
             title, summary, keywords_json, character_ids_json,
             location_ids_json, created_at, updated_at
      FROM memory_chapters WHERE branch_id = ?
      ORDER BY end_sequence DESC
    `)
    .all(branchId) as unknown as ChapterRow[];
  const allChapters = chapterRows.map(mapChapter);
  const scoredChapters = allChapters
    .map((chapter, index) => ({
      chapter,
      overlap: chapter.keywords.reduce(
        (total, keyword) => total + (queryTerms.has(keyword) ? 1 : 0),
        0,
      ),
      recent: index < 2,
    }))
    .filter((item) => item.overlap > 0 || item.recent)
    .sort((left, right) =>
      right.overlap !== left.overlap
        ? right.overlap - left.overlap
        : right.chapter.endSequence - left.chapter.endSequence,
    );

  const selectedEntries: StoryMemoryEntry[] = [];
  const selectedChapters: StoryMemoryChapter[] = [];
  let estimatedTokens = 0;
  for (const item of scoredEntries) {
    const cost = estimateStoryMemoryTokens(
      `${item.entry.title}\n${item.entry.content}`,
    );
    if (estimatedTokens + cost > settings.memoryTokenBudget) continue;
    selectedEntries.push(item.entry);
    estimatedTokens += cost;
  }
  for (const item of scoredChapters) {
    const cost = estimateStoryMemoryTokens(
      `${item.chapter.title}\n${item.chapter.summary}`,
    );
    if (estimatedTokens + cost > settings.memoryTokenBudget) continue;
    selectedChapters.push(item.chapter);
    estimatedTokens += cost;
  }
  return {
    query,
    entries: selectedEntries,
    chapters: selectedChapters.sort(
      (left, right) => left.startSequence - right.startSequence,
    ),
    estimatedTokens,
    budgetTokens: settings.memoryTokenBudget,
    recentTurnCount: settings.recentTurnCount,
    totalCandidateCount: entries.length + allChapters.length,
  };
}

export function recordStoryMemoryRetrieval(input: {
  database: DatabaseSync;
  sessionId: string;
  branchId: string;
  turnId: string;
  context: StoryMemoryContext;
}) {
  input.database
    .prepare(`
      INSERT INTO memory_retrievals (
        id, session_id, branch_id, turn_id, query, memory_ids_json,
        chapter_ids_json, estimated_tokens, budget_tokens,
        recent_turn_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(turn_id) DO UPDATE SET
        query = excluded.query,
        memory_ids_json = excluded.memory_ids_json,
        chapter_ids_json = excluded.chapter_ids_json,
        estimated_tokens = excluded.estimated_tokens,
        budget_tokens = excluded.budget_tokens,
        recent_turn_count = excluded.recent_turn_count,
        created_at = excluded.created_at
    `)
    .run(
      randomUUID(),
      input.sessionId,
      input.branchId,
      input.turnId,
      input.context.query,
      JSON.stringify(input.context.entries.map((entry) => entry.id)),
      JSON.stringify(input.context.chapters.map((chapter) => chapter.id)),
      input.context.estimatedTokens,
      input.context.budgetTokens,
      input.context.recentTurnCount,
      new Date().toISOString(),
    );
}

export function loadStoryMemoryDashboard(input: {
  database: DatabaseSync;
  sessionId: string;
  branchId: string;
}): StoryMemoryDashboard {
  const settings = ensureStoryMemorySettings(input.database, input.sessionId);
  const entries = (
    input.database
      .prepare(`
        SELECT id, source_turn_id, type, title, content, subject_key,
               keywords_json, character_ids_json, location_id, importance,
               status, pinned, enabled, source, created_at, updated_at
        FROM memory_entries WHERE branch_id = ?
        ORDER BY pinned DESC, status, importance DESC, updated_at DESC
      `)
      .all(input.branchId) as unknown as EntryRow[]
  ).map(mapEntry);
  const chapters = (
    input.database
      .prepare(`
        SELECT id, start_turn_id, end_turn_id, start_sequence, end_sequence,
               title, summary, keywords_json, character_ids_json,
               location_ids_json, created_at, updated_at
        FROM memory_chapters WHERE branch_id = ? ORDER BY start_sequence DESC
      `)
      .all(input.branchId) as unknown as ChapterRow[]
  ).map(mapChapter);
  const retrieval = input.database
    .prepare(`
      SELECT turn_id, query, memory_ids_json, chapter_ids_json,
             estimated_tokens, budget_tokens, created_at
      FROM memory_retrievals WHERE branch_id = ?
      ORDER BY created_at DESC LIMIT 1
    `)
    .get(input.branchId) as
    | {
        turn_id: string;
        query: string;
        memory_ids_json: string;
        chapter_ids_json: string;
        estimated_tokens: number;
        budget_tokens: number;
        created_at: string;
      }
    | undefined;
  return {
    settings,
    entries,
    chapters,
    latestRetrieval: retrieval
      ? {
          turnId: retrieval.turn_id,
          query: retrieval.query,
          memoryIds: parseStrings(retrieval.memory_ids_json),
          chapterIds: parseStrings(retrieval.chapter_ids_json),
          estimatedTokens: retrieval.estimated_tokens,
          budgetTokens: retrieval.budget_tokens,
          createdAt: retrieval.created_at,
        }
      : null,
  };
}

export function updateStoryMemoryEntry(input: {
  database: DatabaseSync;
  branchId: string;
  entryId: string;
  title?: string;
  content?: string;
  importance?: number;
  status?: "active" | "resolved";
  pinned?: boolean;
  enabled?: boolean;
}) {
  const row = input.database
    .prepare("SELECT title, content FROM memory_entries WHERE id = ? AND branch_id = ?")
    .get(input.entryId, input.branchId) as
    | { title: string; content: string }
    | undefined;
  if (!row) throw new Error("没有找到要修改的剧情记忆。");
  const title = input.title?.trim() || row.title;
  const content = input.content?.trim() || row.content;
  if (title.length > 120 || content.length > 4000) {
    throw new Error("记忆标题不能超过 120 字，正文不能超过 4000 字。");
  }
  input.database
    .prepare(`
      UPDATE memory_entries SET title = ?, content = ?, keywords_json = ?,
        importance = COALESCE(?, importance), status = COALESCE(?, status),
        pinned = COALESCE(?, pinned), enabled = COALESCE(?, enabled),
        source = 'manual', updated_at = ?
      WHERE id = ? AND branch_id = ?
    `)
    .run(
      title,
      content,
      JSON.stringify(extractMemoryTerms(`${title}\n${content}`)),
      input.importance === undefined ? null : clamp(input.importance, 0, 100),
      input.status ?? null,
      input.pinned === undefined ? null : input.pinned ? 1 : 0,
      input.enabled === undefined ? null : input.enabled ? 1 : 0,
      new Date().toISOString(),
      input.entryId,
      input.branchId,
    );
}

export function updateStoryMemorySettings(input: {
  database: DatabaseSync;
  sessionId: string;
  memoryTokenBudget: number;
  recentTurnCount: number;
  chapterSize: number;
}) {
  ensureStoryMemorySettings(input.database, input.sessionId);
  input.database
    .prepare(`
      UPDATE memory_settings SET memory_token_budget = ?, recent_turn_count = ?,
        chapter_size = ?, updated_at = ? WHERE session_id = ?
    `)
    .run(
      clamp(input.memoryTokenBudget, 600, 8000),
      clamp(input.recentTurnCount, 2, 12),
      clamp(input.chapterSize, 5, 20),
      new Date().toISOString(),
      input.sessionId,
    );
}
