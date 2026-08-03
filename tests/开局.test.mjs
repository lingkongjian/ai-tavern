import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import {
  AdventureInputError,
  parseStartAdventureInput,
} from "../lib/story/开局.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

const validInput = {
  campaignName: "雾港余烬",
  campaignDescription: "一场本地测试冒险。",
  world: {
    name: "灰潮群岛",
    premise: "群岛依靠潮汐灯塔维持航线。",
  },
  player: {
    name: "沈砚",
    description: "寻找失踪兄长的测绘师。",
  },
  mainCharacter: {
    name: "伊芙琳",
    role: "守灯人",
    personality: "克制、警觉，不轻易作出承诺。",
    firstMessage: "关上门，今晚的雾会听见名字。",
  },
  additionalCharacters: [
    {
      name: "米洛",
      role: "负责检查异常船骸的潮汐教会司祭。",
      personality: "温和而执拗，会质疑教会隐瞒事实的命令。",
      firstMessage: "别碰那张海图，它昨晚还没有这条航线。",
    },
  ],
  openingScene: "午夜，守灯人走进只剩一位客人的酒馆。",
  initialStoryDirection: "逐步揭开灯塔沉默的原因。",
};

test("validates setup input and rejects incomplete adventures", () => {
  assert.deepEqual(parseStartAdventureInput(validInput), validInput);
  assert.throws(
    () => parseStartAdventureInput({ campaignName: "" }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.includes("战役名称不能为空。") &&
      error.issues.length >= 8,
  );
  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        additionalCharacters: [
          {
            name: "伊芙琳",
            role: "重名角色",
            personality: "用于验证重名拦截。",
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.includes("同一剧本中的角色姓名不能重复。"),
  );
});

test("accepts legacy affinity alias as affection for initial relationships", () => {
  const withAffinity = parseStartAdventureInput({
    ...validInput,
    initialRelationships: [
      {
        sourceCharacterName: "沈砚",
        targetCharacterName: "伊芙琳",
        dimensions: { trust: 60, affinity: 70, respect: 80 },
        summary: "旧识。",
      },
    ],
  });
  assert.deepEqual(
    withAffinity.initialRelationships?.[0].dimensions,
    { trust: 60, affection: 70, respect: 80 },
  );

  const bothKeys = parseStartAdventureInput({
    ...validInput,
    initialRelationships: [
      {
        sourceCharacterName: "沈砚",
        targetCharacterName: "伊芙琳",
        dimensions: { affection: 40, affinity: 90 },
      },
    ],
  });
  assert.deepEqual(bothKeys.initialRelationships?.[0].dimensions, {
    affection: 40,
  });

  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        initialRelationships: [
          {
            sourceCharacterName: "沈砚",
            targetCharacterName: "伊芙琳",
            dimensions: { affinity: 300 },
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.some((issue) => issue.includes("affinity")),
  );
});

test("creates and restores a complete opening adventure", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-opening-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure(parseStartAdventureInput(validInput));

    const summaries = store.listAdventures();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].sessionId, started.sessionId);
    assert.equal(summaries[0].campaignName, "雾港余烬");
    assert.equal(summaries[0].worldName, "灰潮群岛");
    assert.equal(summaries[0].playerName, "沈砚");
    assert.equal(summaries[0].mainCharacterName, "伊芙琳");

    const loaded = store.loadAdventure(started.sessionId);
    assert.equal(loaded.campaign.name, "雾港余烬");
    assert.equal(loaded.branchState.branch.headTurnId, started.openingTurnId);
    assert.equal(loaded.branchState.branch.nextSequence, 2);
    assert.equal(loaded.branchState.recentTurns.length, 1);
    assert.equal(loaded.branchState.turnHistory.length, 1);
    assert.equal(loaded.branchState.states.length, 12);
    assert.equal(started.additionalCharacterIds.length, 1);
    assert.equal(
      loaded.branchState.states.filter(
        (state) => state.entityType === "character_card",
      ).length,
      3,
    );
    assert.equal(
      loaded.branchState.recentTurns[0].generatedOutput.turn.dialogue.length,
      2,
    );
    assert.equal(
      loaded.branchState.states.find(
        (state) => state.entityType === "world_book_entry",
      )?.state.content,
      "群岛依靠潮汐灯塔维持航线。",
    );
    assert.equal(
      loaded.branchState.states.find(
        (state) => state.entityType === "story_direction",
      )?.state.status,
      "active",
    );
    const openingLocation = loaded.branchState.states.find(
      (state) => state.entityType === "location",
    );
    assert.equal(openingLocation?.state.name, "开场地点");
    assert.equal(
      loaded.branchState.states.find(
        (state) => state.entityType === "session_state",
      )?.state.currentLocationId,
      openingLocation?.entityId,
    );
    assert.equal(
      loaded.branchState.recentTurns[0].generatedOutput.schemaVersion,
      "1.0.0",
    );

    database.exec(`
      CREATE TRIGGER reject_second_setup
      BEFORE INSERT ON state_changes
      WHEN NEW.reason = '创建战役并建立初始场景'
      BEGIN
        SELECT RAISE(ABORT, 'forced setup failure');
      END
    `);
    assert.throws(() => store.startAdventure(validInput), /forced setup failure/);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM campaigns").get().total,
      1,
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM sessions").get().total,
      1,
    );
    database.exec("DROP TRIGGER reject_second_setup");

    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    assert.equal(store.loadAdventure(started.sessionId).branchState.states.length, 12);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("deletes a complete local adventure with all cascaded records", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-delete-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure(parseStartAdventureInput(validInput));
    store.manageCharacter({
      actionId: "delete-test-character-action",
      sessionId: started.sessionId,
      operation: "set_presence",
      characterId: started.mainCharacterId,
      present: false,
    });
    const openingLocation = store
      .loadAdventure(started.sessionId)
      .branchState.states.find((state) => state.entityType === "location");
    store.manageLocation({
      actionId: "delete-test-location-action",
      sessionId: started.sessionId,
      operation: "update",
      locationId: openingLocation.entityId,
      location: {
        name: "酒馆门厅",
        description: "用于验证地点管理级联删除。",
        defaultCharacterIds: [started.mainCharacterId],
      },
    });
    store.importSourceDocument(started.sessionId, {
      name: "删除测试原文",
      fileName: "删除测试原文.md",
      content: "# 第一章\n\n伊芙琳在潮汐灯下检查旧海图。",
      enabled: true,
      currentChapter: 1,
      preventFuture: true,
      fidelity: "balanced",
    });
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS total FROM character_management_changes")
        .get().total > 0,
      true,
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM source_chunks").get()
        .total > 0,
      true,
    );
    const deleted = store.deleteAdventure(started.sessionId);

    assert.equal(deleted.campaignId, started.campaignId);
    assert.equal(deleted.removedCampaign, true);
    assert.equal(store.listAdventures().length, 0);
    for (const table of [
      "campaigns",
      "sessions",
      "branches",
      "turns",
      "messages",
      "events",
      "state_changes",
      "character_management_changes",
      "location_management_changes",
      "story_module_management_changes",
      "world_book_management_changes",
      "content_asset_management_changes",
      "state_control_changes",
      "state_field_lock_changes",
      "state_lock_blocks",
      "turn_regenerations",
      "source_documents",
      "source_chunks",
      "materialized_states",
    ]) {
      assert.equal(
        database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total,
        0,
      );
    }
    assert.throws(() => store.loadAdventure(started.sessionId), /没有找到/);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
