import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  LocalStoryStore,
  LocationManagementError,
} from "../lib/storage/story-store.ts";
import {
  LocationManagementInputError,
  parseLocationManagementInput,
} from "../lib/story/地点管理.ts";
import {
  GeneratedTurnValidationError,
  parsePlayerTurnRequest,
  validateGeneratedTurn,
} from "../lib/story/回合协议.ts";
import { advanceAdventureTurn } from "../lib/story/回合服务.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

test("validates location management requests", () => {
  assert.throws(
    () =>
      parseLocationManagementInput({
        sessionId: "session-1",
        value: {
          actionId: "location-action",
          operation: "create",
          location: { name: "", description: "描述", defaultCharacterIds: [] },
        },
      }),
    (error) =>
      error instanceof LocationManagementInputError &&
      error.issues.includes("地点名称不能为空。"),
  );
});

test("manages locations and automatically synchronizes story presence", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-location-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "地点与出场测试",
      world: { name: "雾岸", premise: "旧路会在月升时改变方向。" },
      player: { name: "旅人", description: "追踪失落驿站的信使。" },
      mainCharacter: {
        name: "向导",
        role: "熟悉旧路的猎人",
        personality: "谨慎、寡言，但不会抛弃同行者。",
      },
      additionalCharacters: [
        {
          name: "守门人",
          role: "负责管理城门出入记录",
          personality: "严肃，重视规则。",
        },
      ],
      openingScene: "旅人与向导在南门等待通行。",
    });
    const guardId = started.additionalCharacterIds[0];
    const openingLocation = store
      .loadAdventure(started.sessionId)
      .branchState.states.find((state) => state.entityType === "location");
    assert.ok(openingLocation);

    const createInput = parseLocationManagementInput({
      sessionId: started.sessionId,
      value: {
        actionId: "location-create-market",
        operation: "create",
        location: {
          name: "雾岸集市",
          description: "商棚沿旧城墙展开，夜间由守门人巡查。",
          defaultCharacterIds: [guardId],
        },
      },
    });
    const created = store.manageLocation(createInput);
    const reused = store.manageLocation(createInput);
    assert.equal(reused.locationId, created.locationId);
    assert.equal(reused.reused, true);
    assert.equal(store.loadAdventure(started.sessionId).branchState.turnHistory.length, 1);

    store.manageLocation({
      actionId: "location-move-market",
      sessionId: started.sessionId,
      operation: "set_current",
      locationId: created.locationId,
    });
    let adventure = store.loadAdventure(started.sessionId);
    const stateByCharacter = new Map(
      adventure.branchState.states
        .filter((state) => state.entityType === "character_state")
        .map((state) => [state.entityId, state.state]),
    );
    assert.equal(stateByCharacter.get(started.playerCharacterId).present, true);
    assert.equal(
      stateByCharacter.get(started.playerCharacterId).locationId,
      created.locationId,
    );
    assert.equal(stateByCharacter.get(started.mainCharacterId).present, false);
    assert.equal(stateByCharacter.get(guardId).present, true);

    store.manageLocation({
      actionId: "location-update-market-roster",
      sessionId: started.sessionId,
      operation: "update",
      locationId: created.locationId,
      location: {
        name: "雾岸集市",
        description: "商棚沿旧城墙展开，夜间由守门人巡查。",
        defaultCharacterIds: [started.mainCharacterId, guardId],
      },
    });
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(
      adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === started.mainCharacterId,
      ).state.present,
      true,
    );
    assert.throws(
      () =>
        store.manageLocation({
          actionId: "location-disable-current",
          sessionId: started.sessionId,
          operation: "set_active",
          locationId: created.locationId,
          active: false,
        }),
      (error) =>
        error instanceof LocationManagementError && /当前位置不能停用/.test(error.message),
    );

    const turnId = "location-story-turn";
    const generated = {
      schemaVersion: "1.0.0",
      turn: {
        scene: "旅人和向导穿过雾门抵达沉没驿站，守门人留在集市继续巡查。",
        events: [
          {
            id: "event-location-move",
            type: "location_changed",
            summary: "旅人与向导抵达沉没驿站，守门人留在原地。",
            characterIds: [
              started.playerCharacterId,
              started.mainCharacterId,
              guardId,
            ],
            locationId: "sunken-station",
          },
        ],
        dialogue: [],
      },
      decision: {
        context: "action_direction",
        prompt: "旅人准备先调查驿站的哪一处？",
        choices: [
          {
            id: "choice-lantern",
            label: "检查灯房",
            description: "寻找最近有人停留过的痕迹。",
            stance: "benevolent",
          },
          {
            id: "choice-ledger",
            label: "翻查账簿",
            description: "先确认失踪旅客最后一次登记。",
            stance: "neutral",
          },
        ],
      },
      stateCommit: {
        sceneTransition: {
          locationId: "sunken-station",
          locationName: "沉没驿站",
          locationDescription: "半座驿站陷在沼泽中，灯房仍有微弱余火。",
          presentCharacterIds: [
            started.playerCharacterId,
            started.mainCharacterId,
          ],
          reason: "旅人与向导离开集市抵达驿站，守门人没有同行。",
          evidence: ["event-location-move"],
        },
        characterStateChanges: [],
        relationshipChanges: [],
        characterCardChanges: [],
        worldBookChanges: [],
        storyDirectionEvaluation: null,
        summaryPatch: "旅人与向导抵达沉没驿站，守门人留在集市。",
      },
      warnings: [],
    };
    let receivedMessages;
    const result = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "location-story-request",
        selectedChoiceId: "opening-neutral",
      }),
      createTurnId: () => turnId,
      generate: async (messages) => {
        receivedMessages = messages;
        return { content: generated, model: "deepseek-test", usage: {} };
      },
    });
    assert.match(receivedMessages[0].content, /每轮必须返回 sceneTransition/);
    const nextSession = result.adventure.branchState.states.find(
      (state) => state.entityType === "session_state",
    );
    assert.equal(nextSession.state.currentLocationId, "sunken-station");
    assert.equal(nextSession.state.currentLocationName, "沉没驿站");
    const discoveredLocation = result.adventure.branchState.states.find(
      (state) => state.entityType === "location" && state.entityId === "sunken-station",
    );
    assert.equal(discoveredLocation.state.source, "story");
    const nextCharacterStates = new Map(
      result.adventure.branchState.states
        .filter((state) => state.entityType === "character_state")
        .map((state) => [state.entityId, state.state]),
    );
    assert.equal(nextCharacterStates.get(started.mainCharacterId).present, true);
    assert.equal(nextCharacterStates.get(guardId).present, false);
    assert.equal(nextCharacterStates.get(guardId).locationId, created.locationId);

    const invalid = structuredClone(generated);
    invalid.stateCommit.characterStateChanges = [
      {
        characterId: started.mainCharacterId,
        patch: { present: false },
        duration: "until_changed",
        reason: "错误地从普通状态补丁控制出场",
        evidence: ["event-location-move"],
      },
    ];
    assert.throws(
      () =>
        validateGeneratedTurn(
          invalid,
          store.loadAdventure(started.sessionId),
          "invalid-location-turn",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("必须写入 sceneTransition")),
    );

    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS total FROM location_management_changes")
        .get().total > 0,
      true,
    );
    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    assert.equal(
      store
        .loadAdventure(started.sessionId)
        .branchState.states.find(
          (state) => state.entityType === "session_state",
        ).state.currentLocationId,
      "sunken-station",
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function locationConsistencyTurn(started, eventId, scene, transition) {
  return {
    schemaVersion: "1.0.0",
    turn: {
      scene,
      events: [
        {
          id: eventId,
          type: "location_change",
          summary: scene,
          characterIds: [started.playerCharacterId, started.mainCharacterId],
          locationId: transition.locationId,
        },
      ],
      dialogue: [],
    },
    decision: {
      context: "action_direction",
      prompt: "旅人接下来去哪里？",
      choices: [
        {
          id: "choice-stay",
          label: "留在原地",
          description: "继续观察。",
          stance: "neutral",
        },
        {
          id: "choice-leave",
          label: "离开",
          description: "前往别处。",
          stance: "benevolent",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId: transition.locationId,
        ...(transition.locationName !== undefined
          ? { locationName: transition.locationName }
          : {}),
        ...(transition.locationDescription !== undefined
          ? { locationDescription: transition.locationDescription }
          : {}),
        presentCharacterIds: [
          started.playerCharacterId,
          started.mainCharacterId,
        ],
        reason: "旅人与向导移动了。",
        evidence: [eventId],
      },
      characterStateChanges: [],
      relationshipChanges: [],
      characterCardChanges: [],
      worldBookChanges: [],
      storyDirectionEvaluation: null,
      summaryPatch: scene,
    },
    warnings: [],
  };
}

test("地点一致性警告：场景移动时正文地点与 locationId 不一致时提醒且不拒绝回合", async () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "ai-tavern-location-consistency-"),
  );
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "地点一致性测试",
      world: { name: "雾岸", premise: "旧路会在月升时改变方向。" },
      player: { name: "旅人", description: "追踪失落驿站的信使。" },
      mainCharacter: {
        name: "向导",
        role: "熟悉旧路的猎人",
        personality: "谨慎、寡言。",
      },
      openingScene: "旅人与向导在南门等待通行。",
    });
    const market = store.manageLocation(
      parseLocationManagementInput({
        sessionId: started.sessionId,
        value: {
          actionId: "location-consistency-market",
          operation: "create",
          location: {
            name: "雾岸集市",
            description: "商棚沿旧城墙展开。",
            defaultCharacterIds: [],
          },
        },
      }),
    );
    const adventure = store.loadAdventure(started.sessionId);
    const openingId = adventure.branchState.states.find(
      (state) => state.entityType === "session_state",
    ).state.currentLocationId;
    assert.equal(
      adventure.branchState.states.find(
        (state) => state.entityType === "location" && state.entityId === openingId,
      ).state.name,
      "开场地点",
    );

    // 场景 A：场景移动且正文与 locationId 一致（来到雾岸集市）→ 无地点一致性警告
    const consistent = validateGeneratedTurn(
      locationConsistencyTurn(
        started,
        "event-loc-consistent",
        "旅人与向导离开南门，来到雾岸集市。",
        { locationId: market.locationId },
      ),
      adventure,
      "turn-loc-consistent",
    );
    assert.ok(
      !consistent.warnings.some((warning) => warning.includes("正文提到地点")),
    );

    // 场景 B：场景移动但正文写到另一已知地点「开场地点」而 locationId 用「雾岸集市」→ 警告且校验通过
    const conflict = validateGeneratedTurn(
      locationConsistencyTurn(
        started,
        "event-loc-conflict",
        "旅人回到开场地点。",
        { locationId: market.locationId },
      ),
      adventure,
      "turn-loc-conflict",
    );
    assert.ok(
      conflict.warnings.some(
        (warning) =>
          warning.includes("正文提到地点「开场地点」") &&
          warning.includes("雾岸集市"),
      ),
    );

    // 场景 C：正文提到的名字不是已知地点名（南门只是开场描写）→ 不警告
    const unknownName = validateGeneratedTurn(
      locationConsistencyTurn(
        started,
        "event-loc-unknown",
        "旅人回到了南门。",
        { locationId: market.locationId },
      ),
      adventure,
      "turn-loc-unknown",
    );
    assert.ok(
      !unknownName.warnings.some((warning) => warning.includes("正文提到地点")),
    );

    // 场景 D：场景未移动（沿用上一轮地点）但正文提及另一已知地点 → 不警告（防误报）
    const staying = validateGeneratedTurn(
      locationConsistencyTurn(
        started,
        "event-loc-stay",
        "旅人与向导在南门交谈，提起远方的雾岸集市。",
        { locationId: openingId },
      ),
      adventure,
      "turn-loc-stay",
    );
    assert.ok(
      !staying.warnings.some((warning) => warning.includes("正文提到地点")),
    );

    // 场景 E：新地点场景，正文没有已知地点名 → 无警告
    const newPlace = validateGeneratedTurn(
      locationConsistencyTurn(
        started,
        "event-loc-new",
        "旅人与向导沿着旧路，来到一处沉没驿站。",
        {
          locationId: "sunken-station",
          locationName: "沉没驿站",
          locationDescription: "半座驿站陷在沼泽中。",
        },
      ),
      adventure,
      "turn-loc-new",
    );
    assert.ok(
      !newPlace.warnings.some((warning) => warning.includes("正文提到地点")),
    );

    // 场景 F：新地点场景但正文提到另一个已知地点 → 警告（保守提示，不拒绝）
    const newPlaceConflict = validateGeneratedTurn(
      locationConsistencyTurn(
        started,
        "event-loc-new-conflict",
        "旅人离开雾岸集市，抵达沉没驿站。",
        {
          locationId: "sunken-station-2",
          locationName: "沉没驿站",
          locationDescription: "半座驿站陷在沼泽中。",
        },
      ),
      adventure,
      "turn-loc-new-conflict",
    );
    assert.ok(
      newPlaceConflict.warnings.some(
        (warning) =>
          warning.includes("正文提到地点「雾岸集市」") &&
          warning.includes("沉没驿站"),
      ),
    );
    assert.equal(newPlaceConflict.turn.scene, "旅人离开雾岸集市，抵达沉没驿站。");

    // 场景 G：冲突回合经 advanceAdventureTurn 正常提交，警告随回合入库，当前地点按 locationId 更新
    const result = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "location-consistency-request",
        customChoice: "前往集市",
      }),
      createTurnId: () => "turn-loc-e2e",
      generate: async (messages) => {
        // 规则文本强化断言：提示词包含地点一致性约束
        assert.match(messages[0].content, /地点必须与正文一致/);
        return {
          content: locationConsistencyTurn(
            started,
            "event-loc-e2e",
            "旅人回到了开场地点。",
            { locationId: market.locationId },
          ),
          model: "deepseek-v4-flash",
          usage: { totalTokens: 800 },
        };
      },
    });
    assert.ok(result.committedTurn, "地点一致性检测不拒绝回合，回合应正常提交");
    const committedAdventure = store.loadAdventure(started.sessionId);
    const savedTurn = committedAdventure.branchState.recentTurns.find(
      (turn) => turn.id === result.committedTurn.id,
    );
    assert.ok(savedTurn, "提交的回合应写入历史");
    assert.ok(
      (savedTurn.generatedOutput.warnings ?? []).some((warning) =>
        warning.includes("正文提到地点「开场地点」"),
      ),
    );
    assert.equal(
      committedAdventure.branchState.states.find(
        (state) => state.entityType === "session_state",
      ).state.currentLocationId,
      market.locationId,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
