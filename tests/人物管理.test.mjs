import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  CharacterManagementError,
  LocalStoryStore,
} from "../lib/storage/story-store.ts";
import {
  CharacterManagementInputError,
  parseCharacterManagementInput,
} from "../lib/story/人物管理.ts";
import { createStoryGenerationMessages } from "../lib/story/剧情提示.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function managementInput(sessionId, value) {
  return parseCharacterManagementInput({ sessionId, value });
}

test("validates character management requests", () => {
  const parsed = managementInput("session-1", {
    actionId: "manage-1",
    operation: "create",
    character: {
      name: "新角色",
      role: "负责测试的人物",
      personality: "谨慎。",
      firstMessage: "测试台词。",
    },
  });
  assert.equal(parsed.operation, "create");
  assert.equal(parsed.character.name, "新角色");
  assert.throws(
    () => managementInput("session-1", { operation: "set_presence" }),
    CharacterManagementInputError,
  );
});

test("manages existing-story characters without creating story turns", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-characters-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "人物管理测试",
      world: { name: "镜城", premise: "镜面会记录公开说出的承诺。" },
      player: { name: "访客", description: "寻找一份旧誓言的旅行者。" },
      mainCharacter: {
        name: "守镜人",
        role: "镜城档案馆看守",
        personality: "冷静、严谨，不替陌生人保守未经交换的秘密。",
        firstMessage: "镜子记得你说过的每一个字。",
      },
      openingScene: "访客进入堆满银镜的档案馆。",
    });
    const openingHead = started.openingTurnId;

    const createRequest = managementInput(started.sessionId, {
      actionId: "manage-create-witness",
      operation: "create",
      character: {
        name: "见证官",
        role: "负责核对镜中誓言的城邦官员。",
        personality: "礼貌但怀疑所有未经记录的说法。",
        firstMessage: "没有镜印的承诺，只能算传闻。",
      },
    });
    const created = store.manageCharacter(createRequest);
    assert.equal(created.reused, false);

    let adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.headTurnId, openingHead);
    assert.equal(adventure.branchState.turnHistory.length, 1);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM turns").get().total,
      1,
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM character_management_changes WHERE action_id = ?",
        )
        .get("manage-create-witness").total,
      5,
    );
    assert.equal(
      adventure.branchState.states
        .find((state) => state.entityType === "location")
        .state.defaultCharacterIds.includes(created.characterId),
      true,
    );

    const newCard = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_card" &&
        state.entityId === created.characterId,
    );
    const newState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === created.characterId,
    );
    assert.equal(newCard.state.data.name, "见证官");
    assert.equal(newCard.isActive, true);
    assert.equal(newState.state.present, true);

    const retried = store.manageCharacter(createRequest);
    assert.equal(retried.characterId, created.characterId);
    assert.equal(retried.reused, true);
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM character_management_changes WHERE action_id = ?",
        )
        .get("manage-create-witness").total,
      5,
    );

    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "manage-update-witness",
        operation: "update",
        characterId: created.characterId,
        character: {
          name: "银镜见证官",
          role: "负责核对镜中誓言并签发镜印的城邦官员。",
          personality: "礼貌、敏锐，会优先相信可复核的镜中记录。",
          firstMessage: "把承诺说给镜子听。",
        },
      }),
    );
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(
      adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_card" &&
          state.entityId === created.characterId,
      ).state.data.name,
      "银镜见证官",
    );
    assert.equal(
      adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === created.characterId,
      ).state.name,
      "银镜见证官",
    );

    assert.throws(
      () =>
        store.manageCharacter(
          managementInput(started.sessionId, {
            actionId: "manage-duplicate-name",
            operation: "update",
            characterId: created.characterId,
            character: {
              name: "守镜人",
              role: "重名测试",
              personality: "重名测试。",
            },
          }),
        ),
      CharacterManagementError,
    );

    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "manage-leave",
        operation: "set_presence",
        characterId: created.characterId,
        present: false,
      }),
    );
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(
      adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === created.characterId,
      ).state.present,
      false,
    );
    const presentMessages = createStoryGenerationMessages({
      adventure,
      turnId: "next-turn-presence-test",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    assert.match(presentMessages[0].content, /present=false/);
    assert.match(presentMessages[1].content, new RegExp(created.characterId));

    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "manage-deactivate",
        operation: "set_active",
        characterId: created.characterId,
        active: false,
      }),
    );
    adventure = store.loadAdventure(started.sessionId);
    const inactiveRecords = adventure.branchState.states.filter(
      (state) =>
        state.entityId === created.characterId ||
        (state.entityType === "relationship" &&
          (state.state.sourceCharacterId === created.characterId ||
            state.state.targetCharacterId === created.characterId)),
    );
    assert.equal(inactiveRecords.every((state) => !state.isActive), true);
    assert.equal(
      adventure.branchState.states
        .find(
          (state) =>
            state.entityType === "session_state" && state.entityId === "core",
        )
        .state.additionalCharacterIds.includes(created.characterId),
      false,
    );
    const inactiveMessages = createStoryGenerationMessages({
      adventure,
      turnId: "next-turn-inactive-test",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    assert.doesNotMatch(inactiveMessages[1].content, new RegExp(created.characterId));

    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "manage-reactivate",
        operation: "set_active",
        characterId: created.characterId,
        active: true,
      }),
    );
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "manage-return",
        operation: "set_presence",
        characterId: created.characterId,
        present: true,
      }),
    );
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(
      adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === created.characterId,
      ).state.present,
      true,
    );

    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "manage-deactivate-main",
        operation: "set_active",
        characterId: started.mainCharacterId,
        active: false,
      }),
    );
    adventure = store.loadAdventure(started.sessionId);
    const sessionState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "session_state" && state.entityId === "core",
    ).state;
    assert.equal(sessionState.mainCharacterId, created.characterId);
    assert.equal(sessionState.mainCharacterName, "银镜见证官");
    assert.equal(adventure.branchState.branch.headTurnId, openingHead);
    assert.equal(adventure.branchState.turnHistory.length, 1);

    assert.throws(
      () =>
        store.manageCharacter(
          managementInput(started.sessionId, {
            actionId: "manage-player-blocked",
            operation: "set_active",
            characterId: started.playerCharacterId,
            active: false,
          }),
        ),
      CharacterManagementError,
    );

    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    const restored = store.loadAdventure(started.sessionId);
    assert.equal(restored.branchState.branch.headTurnId, openingHead);
    assert.equal(
      restored.branchState.states.find(
        (state) =>
          state.entityType === "character_card" &&
          state.entityId === created.characterId,
      ).isActive,
      true,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
