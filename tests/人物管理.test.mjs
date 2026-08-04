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

test("set_statuses 校验词条结构，设置/清除/审计/幂等并随存档往返，与 restriction 共存", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-statuses-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "状态词条测试",
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
    const characterId = started.mainCharacterId;

    // —— 结构校验 ——
    const invalid = (extra) =>
      managementInput(started.sessionId, {
        actionId: `statuses-bad-${Math.random()}`,
        operation: "set_statuses",
        characterId,
        ...extra,
      });
    // 非法 kind 拒绝
    assert.throws(
      () => invalid({ statuses: [{ id: "s1", name: "中毒", kind: "magic", description: "毒性发作" }] }),
      CharacterManagementInputError,
    );
    // name 超长拒绝
    assert.throws(
      () => invalid({ statuses: [{ id: "s1", name: "状".repeat(81), kind: "debuff", description: "描述" }] }),
      CharacterManagementInputError,
    );
    // 重复 id 拒绝
    assert.throws(
      () =>
        invalid({
          statuses: [
            { id: "dup", name: "受伤", kind: "debuff", description: "伤势" },
            { id: "dup", name: "中毒", kind: "debuff", description: "毒性" },
          ],
        }),
      CharacterManagementInputError,
    );
    // expiresAtDay 非法（0 / 小数 / 文本）拒绝
    assert.throws(
      () => invalid({ statuses: [{ id: "s1", name: "中毒", kind: "debuff", description: "毒性", expiresAtDay: 0 }] }),
      CharacterManagementInputError,
    );
    assert.throws(
      () => invalid({ statuses: [{ id: "s1", name: "中毒", kind: "debuff", description: "毒性", expiresAtDay: 1.5 }] }),
      CharacterManagementInputError,
    );
    assert.throws(
      () => invalid({ statuses: [{ id: "s1", name: "中毒", kind: "debuff", description: "毒性", expiresAtDay: "明天" }] }),
      CharacterManagementInputError,
    );
    // hidden 非布尔拒绝
    assert.throws(
      () => invalid({ statuses: [{ id: "s1", name: "潜伏之毒", kind: "debuff", description: "毒性潜伏", hidden: "yes" }] }),
      CharacterManagementInputError,
    );
    // 非数组非 null 拒绝
    assert.throws(
      () => invalid({ statuses: "中毒" }),
      CharacterManagementInputError,
    );
    // 未提供 statuses 拒绝
    assert.throws(
      () => invalid({}),
      CharacterManagementInputError,
    );
    // 合法请求（含 null 清除与数组）通过解析
    const cleared = managementInput(started.sessionId, {
      actionId: "statuses-clear-parse",
      operation: "set_statuses",
      characterId,
      statuses: null,
    });
    assert.equal(cleared.statuses, null);

    // —— 设置 ——
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "statuses-set",
        operation: "set_statuses",
        characterId,
        statuses: [
          {
            id: "wound-arm",
            name: "受伤",
            kind: "debuff",
            description: "左臂刀伤未愈合，影响行动",
            sourceTurnId: started.openingTurnId,
            expiresAtDay: 5,
          },
          {
            id: "swift-charm",
            name: "迅捷",
            kind: "buff",
            description: "镜之祝福，身法轻快",
          },
        ],
      }),
    );
    let adventure = store.loadAdventure(started.sessionId);
    const characterState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === characterId,
    );
    assert.equal(characterState.state.statuses.length, 2);
    assert.equal(characterState.state.statuses[0].id, "wound-arm");
    assert.equal(characterState.state.statuses[0].kind, "debuff");
    assert.equal(characterState.state.statuses[0].expiresAtDay, 5);
    assert.equal(characterState.state.statuses[1].kind, "buff");

    // 审计记录人物管理来源
    const audit = store.loadStateAudit(started.sessionId);
    assert.equal(
      audit.actions.some(
        (action) =>
          action.source === "character_management" &&
          action.title.includes("人物管理"),
      ),
      true,
    );
    // 幂等 actionId 复用
    const retried = store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "statuses-set",
        operation: "set_statuses",
        characterId,
        statuses: [
          { id: "wound-arm", name: "受伤", kind: "debuff", description: "左臂刀伤未愈合，影响行动" },
        ],
      }),
    );
    assert.equal(retried.reused, true);
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM character_management_changes WHERE action_id = ?",
        )
        .get("statuses-set").total,
      1,
    );

    // —— 与 restriction 共存 ——
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "statuses-with-restriction",
        operation: "set_restriction",
        characterId,
        restriction: { kind: "bound", summary: "被铁链束缚在柱上" },
      }),
    );
    adventure = store.loadAdventure(started.sessionId);
    const coexistingState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === characterId,
    );
    assert.equal(coexistingState.state.restriction.kind, "bound");
    assert.equal(coexistingState.state.statuses.length, 2);

    // —— 隐藏词条与上下文注入 ——
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "statuses-hidden",
        operation: "set_statuses",
        characterId,
        statuses: [
          {
            id: "wound-arm",
            name: "受伤",
            kind: "debuff",
            description: "左臂刀伤未愈合",
            expiresAtDay: 5,
          },
          {
            id: "poison-slow",
            name: "慢性毒",
            kind: "debuff",
            hidden: true,
            description: "镜中渗入的慢性毒，角色尚未察觉",
            expiresAtDay: 7,
          },
        ],
      }),
    );
    const hiddenMessages = createStoryGenerationMessages({
      adventure: store.loadAdventure(started.sessionId),
      turnId: "next-turn-statuses-test",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    // 系统规则包含未察觉/到期/行为倾向规则
    assert.match(hiddenMessages[0].content, /未察觉状态/);
    assert.match(hiddenMessages[0].content, /hiddenCharacterStatuses/);
    assert.match(hiddenMessages[0].content, /求医、解毒、治疗、休息/);
    assert.match(hiddenMessages[0].content, /expiresAtDay/);
    // 导演级区包含隐藏词条，角色可见区不泄露
    const userJson = JSON.parse(hiddenMessages[1].content.slice("请根据以下 JSON 故事上下文生成并只返回下一回合 JSON：".length));
    assert.equal(userJson.hiddenCharacterStatuses[0].characterId, characterId);
    assert.equal(userJson.hiddenCharacterStatuses[0].statuses[0].id, "poison-slow");
    const directoryEntry = userJson.characterDirectory.find(
      (character) => character.id === characterId,
    );
    assert.equal(
      directoryEntry.statuses.some((status) => status.id === "poison-slow"),
      false,
    );
    assert.equal(
      directoryEntry.statuses.some((status) => status.id === "wound-arm"),
      true,
    );

    // —— 清除全部 ——
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "statuses-clear",
        operation: "set_statuses",
        characterId,
        statuses: null,
      }),
    );
    adventure = store.loadAdventure(started.sessionId);
    const clearedState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === characterId,
    );
    assert.equal("statuses" in clearedState.state, false);

    // —— 玩家角色与停用角色拒绝 ——
    assert.throws(
      () =>
        store.manageCharacter(
          managementInput(started.sessionId, {
            actionId: "statuses-player-blocked",
            operation: "set_statuses",
            characterId: started.playerCharacterId,
            statuses: [{ id: "s1", name: "受伤", kind: "debuff", description: "测试" }],
          }),
        ),
      CharacterManagementError,
    );
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "statuses-deactivate",
        operation: "set_active",
        characterId,
        active: false,
      }),
    );
    assert.throws(
      () =>
        store.manageCharacter(
          managementInput(started.sessionId, {
            actionId: "statuses-inactive-blocked",
            operation: "set_statuses",
            characterId,
            statuses: [{ id: "s1", name: "受伤", kind: "debuff", description: "测试" }],
          }),
        ),
      CharacterManagementError,
    );

    // —— 存档往返 ——
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "statuses-reactivate",
        operation: "set_active",
        characterId,
        active: true,
      }),
    );
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "statuses-roundtrip",
        operation: "set_statuses",
        characterId,
        statuses: [
          { id: "wound-arm", name: "受伤", kind: "debuff", description: "左臂刀伤未愈合" },
        ],
      }),
    );
    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    adventure = store.loadAdventure(started.sessionId);
    const roundtripState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === characterId,
    );
    assert.equal(roundtripState.state.statuses.length, 1);
    assert.equal(roundtripState.state.statuses[0].id, "wound-arm");
    assert.equal(roundtripState.state.statuses[0].kind, "debuff");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("行动受限状态可设置、解除、进入审计并随存档往返", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-restriction-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "行动受限测试",
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

    // 非法 kind 拒绝
    assert.throws(
      () =>
        managementInput(started.sessionId, {
          actionId: "restrict-bad-kind",
          operation: "set_restriction",
          characterId: started.mainCharacterId,
          restriction: { kind: "asleep", summary: "睡着了" },
        }),
      CharacterManagementInputError,
    );
    // 缺少受限原因拒绝
    assert.throws(
      () =>
        managementInput(started.sessionId, {
          actionId: "restrict-no-summary",
          operation: "set_restriction",
          characterId: started.mainCharacterId,
          restriction: { kind: "imprisoned" },
        }),
      CharacterManagementInputError,
    );
    // 受限状态必须是对象或 null
    assert.throws(
      () =>
        managementInput(started.sessionId, {
          actionId: "restrict-not-object",
          operation: "set_restriction",
          characterId: started.mainCharacterId,
          restriction: "被关押",
        }),
      CharacterManagementInputError,
    );

    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "restrict-set",
        operation: "set_restriction",
        characterId: started.mainCharacterId,
        restriction: { kind: "imprisoned", summary: "被城主关押在地牢" },
      }),
    );
    let adventure = store.loadAdventure(started.sessionId);
    const characterState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(characterState.state.restriction.kind, "imprisoned");
    assert.equal(characterState.state.restriction.summary, "被城主关押在地牢");
    assert.equal(characterState.state.restriction.sinceTurnId, started.openingTurnId);

    // 幂等 actionId 复用
    const retried = store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "restrict-set",
        operation: "set_restriction",
        characterId: started.mainCharacterId,
        restriction: { kind: "imprisoned", summary: "被城主关押在地牢" },
      }),
    );
    assert.equal(retried.reused, true);

    // 上下文：人物目录携带 restriction，规则文本包含行动受限约束
    const restrictedMessages = createStoryGenerationMessages({
      adventure,
      turnId: "next-turn-restriction-test",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    assert.match(restrictedMessages[0].content, /行动受限/);
    assert.match(restrictedMessages[0].content, /patch\.restriction=null/);
    assert.match(restrictedMessages[1].content, /被城主关押在地牢/);

    // 状态审计记录人物管理来源的动作
    const audit = store.loadStateAudit(started.sessionId);
    assert.equal(
      audit.actions.some(
        (action) =>
          action.source === "character_management" &&
          action.title.includes("人物管理"),
      ),
      true,
    );

    // 解除：restriction 字段被删除
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "restrict-clear",
        operation: "set_restriction",
        characterId: started.mainCharacterId,
        restriction: null,
      }),
    );
    adventure = store.loadAdventure(started.sessionId);
    const clearedState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal("restriction" in clearedState.state, false);
    const clearedMessages = createStoryGenerationMessages({
      adventure,
      turnId: "next-turn-restriction-cleared-test",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    assert.doesNotMatch(clearedMessages[1].content, /被城主关押在地牢/);

    // 玩家角色不能在人物管理中设置行动受限
    assert.throws(
      () =>
        store.manageCharacter(
          managementInput(started.sessionId, {
            actionId: "restrict-player-blocked",
            operation: "set_restriction",
            characterId: started.playerCharacterId,
            restriction: { kind: "bound", summary: "测试" },
          }),
        ),
      CharacterManagementError,
    );

    // 存档往返：重新设置后关闭重开，restriction 仍保留
    store.manageCharacter(
      managementInput(started.sessionId, {
        actionId: "restrict-roundtrip",
        operation: "set_restriction",
        characterId: started.mainCharacterId,
        restriction: { kind: "bound", summary: "被铁链束缚在柱上" },
      }),
    );
    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    adventure = store.loadAdventure(started.sessionId);
    const roundtripState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(roundtripState.state.restriction.kind, "bound");
    assert.equal(roundtripState.state.restriction.summary, "被铁链束缚在柱上");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
