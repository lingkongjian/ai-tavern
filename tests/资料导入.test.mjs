import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  ImportFileError,
  parseCharacterCardDocument,
  parseImportPreviewRequest,
  parseWorldBookDocument,
} from "../lib/import/酒馆文件.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import { parseStartAdventureInput } from "../lib/story/开局.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

const characterCard = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "林雾",
    description: "边境档案馆守夜人。",
    personality: "谨慎、克制，重视证据。",
    scenario: "玩家在暴雨夜进入档案馆。",
    first_mes: "把伞留在门外。",
    mes_example: "示例对话",
    creator_notes: "测试人物卡",
    system_prompt: "保持角色的信息边界。",
    post_history_instructions: "不要替玩家作决定。",
    alternate_greetings: [],
    tags: ["守夜人"],
    creator: "测试",
    character_version: "1.0",
    extensions: { third_party: { preserved: true } },
    character_book: {
      name: "角色专属档案",
      entries: [{ keys: ["旧卷宗"], content: "旧卷宗不能带出档案馆。" }],
    },
  },
};

test("normalizes common character card JSON formats", () => {
  const v2 = parseCharacterCardDocument(characterCard);
  assert.equal(v2.format, "character_card_v2");
  assert.equal(v2.name, "林雾");
  assert.equal(v2.firstMessage, "把伞留在门外。");
  assert.equal(v2.card.data.system_prompt, "保持角色的信息边界。");
  assert.equal(v2.card.data.extensions.third_party.preserved, true);
  assert.equal(v2.card.data.character_book.name, "角色专属档案");

  const legacy = parseCharacterCardDocument({
    name: "旧卡角色",
    description: "旧版扁平人物卡。",
    personality: "沉默。",
    first_mes: "你来了。",
  });
  assert.equal(legacy.format, "character_card_v1");
  assert.equal(legacy.card.spec, "chara_card_v2");
  assert.match(legacy.warnings[0], /规范化/);

  assert.throws(
    () => parseCharacterCardDocument({ spec: "chara_card_v2", data: {} }),
    (error) =>
      error instanceof ImportFileError &&
      error.issues.some((issue) => /data.name/.test(issue)),
  );
});

test("normalizes AI Tavern and SillyTavern world books", () => {
  const standard = parseWorldBookDocument({
    spec: "ai_tavern_world_book_v1",
    spec_version: "1.0",
    name: "纸城",
    description: "纸城稳定规则。",
    entries: [
      {
        id: "paper-law",
        keys: [],
        secondaryKeys: [],
        content: "公开记录会短暂成为现实。",
        enabled: true,
        constant: true,
        selective: false,
        position: "before_char",
        order: 100,
        probability: 100,
        depth: 4,
      },
    ],
  });
  assert.equal(standard.format, "ai_tavern_world_book_v1");
  assert.equal(standard.entries[0].sourceId, "paper-law");
  assert.equal(standard.entries[0].sourceBookName, "纸城");

  const sillyTavern = parseImportPreviewRequest({
    kind: "world_book",
    fileName: "雾港规则.json",
    document: {
      entries: {
        17: {
          uid: 17,
          key: ["灯塔", "海雾"],
          keysecondary: ["雾港"],
          content: "潮汐灯塔通过歌声维持航线。",
          disable: false,
          constant: false,
          selective: true,
          position: 4,
          order: 180,
          probability: 75,
          depth: 6,
        },
      },
    },
  }).preview;
  assert.equal(sillyTavern.kind, "world_book");
  assert.equal(sillyTavern.name, "雾港规则");
  assert.equal(sillyTavern.entries[0].sourceId, "17");
  assert.deepEqual(sillyTavern.entries[0].secondaryKeys, ["雾港"]);
  assert.equal(sillyTavern.entries[0].position, "after_char");
  assert.equal(sillyTavern.warnings.length, 1);
});

test("persists imported cards and world-book entries with the opening turn", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-import-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const importedCharacter = parseCharacterCardDocument(characterCard);
    const importedBook = parseWorldBookDocument({
      spec: "ai_tavern_world_book_v1",
      spec_version: "1.0",
      name: "纸城规则",
      description: "测试世界书",
      entries: [
        {
          id: "paper-law",
          keys: [],
          secondaryKeys: [],
          content: "公开记录会短暂成为现实。",
          enabled: true,
          constant: true,
          selective: false,
          position: "before_char",
          order: 100,
          probability: 100,
          depth: 4,
        },
      ],
    });
    const input = parseStartAdventureInput({
      campaignName: "导入测试",
      world: { name: "纸城", premise: "文字能够改变现实。" },
      player: { name: "记录员", description: "核验档案的旅行者。" },
      mainCharacter: {
        name: importedCharacter.name,
        role: "玩家确认后的馆长身份。",
        personality: importedCharacter.personality,
        firstMessage: importedCharacter.firstMessage,
        card: importedCharacter.card,
      },
      worldBookEntries: importedBook.entries,
      openingScene: "记录员进入档案馆。",
    });
    const store = new LocalStoryStore(database);
    const started = store.startAdventure(input);
    const states = store.loadAdventure(started.sessionId).branchState.states;
    const cardState = states.find(
      (state) =>
        state.entityType === "character_card" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(cardState.state.data.description, "玩家确认后的馆长身份。");
    assert.equal(cardState.state.data.system_prompt, "保持角色的信息边界。");
    assert.equal(cardState.state.data.extensions.third_party.preserved, true);

    const importedEntry = states.find(
      (state) =>
        state.entityType === "world_book_entry" &&
        state.state.layer === "base_import",
    );
    assert.equal(importedEntry.state.content, "公开记录会短暂成为现实。");
    assert.equal(importedEntry.state.source.bookName, "纸城规则");
    assert.equal(importedEntry.state.source.entryId, "paper-law");
    assert.equal(
      states.filter((state) => state.entityType === "world_book_entry").length,
      2,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
