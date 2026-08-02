import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  LocalStoryStore,
  TurnRegenerationError,
} from "../lib/storage/story-store.ts";
import {
  RegenerateTurnInputError,
  parsePlayerTurnRequest,
  parseRegenerateTurnRequest,
} from "../lib/story/回合协议.ts";
import {
  advanceAdventureTurn,
  regenerateLatestAdventureTurn,
} from "../lib/story/回合服务.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function generatedTurn(input) {
  return {
    schemaVersion: "1.0.0",
    turn: {
      scene: input.scene,
      events: [
        {
          id: input.eventId,
          type: "story_changed",
          summary: input.summary,
          characterIds: input.presentCharacterIds,
          locationId: input.locationId,
        },
      ],
      dialogue: [
        {
          id: input.dialogueId,
          speakerId: input.mainCharacterId,
          content: input.dialogue,
          addressedCharacterIds: [input.playerCharacterId],
        },
      ],
    },
    decision: {
      context: "action_direction",
      prompt: "接下来准备怎么做？",
      choices: [
        {
          id: `${input.eventId}-good`,
          label: "保护证人",
          description: "先确保在场者不会受到伤害。",
          stance: "benevolent",
        },
        {
          id: `${input.eventId}-neutral`,
          label: "继续观察",
          description: "记录现场变化后再作判断。",
          stance: "neutral",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId: input.locationId,
        locationName: input.locationName,
        locationDescription: input.locationDescription,
        presentCharacterIds: input.presentCharacterIds,
        reason: input.summary,
        evidence: [input.eventId],
      },
      characterStateChanges: [
        {
          characterId: input.mainCharacterId,
          patch: { mood: input.mood },
          duration: "until_changed",
          reason: input.summary,
          evidence: [input.eventId],
        },
      ],
      relationshipChanges: [
        {
          sourceCharacterId: input.mainCharacterId,
          targetCharacterId: input.playerCharacterId,
          dimension: "trust",
          delta: input.trustDelta,
          reason: input.summary,
          evidence: [input.dialogueId],
        },
      ],
      characterCardChanges: [],
      worldBookChanges: input.worldFact
        ? [
            {
              operation: "create",
              entry: {
                keys: ["旧版事实"],
                content: input.worldFact,
                enabled: true,
              },
              sourceTurnId: input.turnId,
              reason: input.summary,
              evidence: [input.eventId],
            },
          ]
        : [],
      storyDirectionEvaluation: null,
      summaryPatch: input.summary,
    },
    warnings: [],
  };
}

test("validates regenerate requests", () => {
  assert.deepEqual(
    parseRegenerateTurnRequest({
      expectedHeadTurnId: "turn-2",
      actionId: "regenerate-1",
      feedback: "  角色答应得太快，希望先保持警惕。  ",
    }),
    {
      expectedHeadTurnId: "turn-2",
      actionId: "regenerate-1",
      feedback: "角色答应得太快，希望先保持警惕。",
    },
  );
  assert.throws(
    () => parseRegenerateTurnRequest({}),
    (error) =>
      error instanceof RegenerateTurnInputError && error.issues.length === 3,
  );
  assert.throws(
    () =>
      parseRegenerateTurnRequest({
        expectedHeadTurnId: "turn-2",
        actionId: "regenerate-2",
        feedback: "   ",
      }),
    (error) =>
      error instanceof RegenerateTurnInputError &&
      /请说明对当前剧情不满意/.test(error.message),
  );
});

test("regenerates the latest AI turn from its parent state atomically", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-regenerate-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "重生成测试",
      world: { name: "纸城", premise: "公开写下的句子会成为短暂现实。" },
      player: { name: "记录员", description: "负责核验城市档案的旅行者。" },
      mainCharacter: {
        name: "馆长",
        role: "纸城档案馆馆长",
        personality: "严谨、克制，不接受没有来源的结论。",
      },
      openingScene: "记录员在闭馆前进入档案馆。",
    });
    const observer = store.manageCharacter({
      actionId: "create-observer-before-turn",
      sessionId: started.sessionId,
      operation: "create",
      character: {
        name: "旁观者",
        role: "被临时留下的证人",
        personality: "沉默但会记住所有细节。",
        firstMessage: "",
      },
    });
    const turnId = "regenerated-head-turn";
    const firstOutput = generatedTurn({
      turnId,
      scene: "馆长把记录员带进红墨大厅，旁观者被留在门外。",
      eventId: "old-event",
      dialogueId: "old-dialogue",
      summary: "记录员进入红墨大厅。",
      dialogue: "红墨写下的内容不能撤回。",
      locationId: "red-ink-hall",
      locationName: "红墨大厅",
      locationDescription: "墙面覆盖着尚未干透的红色文字。",
      presentCharacterIds: [
        started.playerCharacterId,
        started.mainCharacterId,
      ],
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
      mood: "旧版警惕",
      trustDelta: 10,
      worldFact: "红墨写下的内容永远不能撤回。",
    });
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "initial-generated-turn",
        selectedChoiceId: "opening-neutral",
      }),
      createTurnId: () => turnId,
      generate: async () => ({
        content: firstOutput,
        model: "deepseek-test",
        usage: { totalTokens: 500 },
      }),
    });

    const replacementOutput = generatedTurn({
      turnId,
      scene: "馆长改带记录员和旁观者进入蓝纸庭院，展示能够被改写的城市档案。",
      eventId: "replacement-event",
      dialogueId: "replacement-dialogue",
      summary: "三人进入蓝纸庭院，发现档案可以被修订。",
      dialogue: "只要证据足够，纸城允许我们修订错误。",
      locationId: "blue-paper-court",
      locationName: "蓝纸庭院",
      locationDescription: "蓝色纸页像树叶一样悬在庭院上空。",
      presentCharacterIds: [
        started.playerCharacterId,
        started.mainCharacterId,
        observer.characterId,
      ],
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
      mood: "重新审视",
      trustDelta: -5,
      worldFact: "",
    });
    let receivedMessages;
    const regenerated = await regenerateLatestAdventureTurn({
      store,
      sessionId: started.sessionId,
      expectedHeadTurnId: turnId,
      actionId: "regeneration-action-1",
      feedback: "馆长的拒绝太绝对，希望她依据证据改为谨慎合作。",
      generate: async (messages) => {
        receivedMessages = messages;
        return {
          content: replacementOutput,
          model: "deepseek-test",
          usage: { totalTokens: 620 },
        };
      },
    });
    assert.match(receivedMessages[1].content, /opening-neutral/);
    assert.match(receivedMessages.at(-1).content, /不满意上一版生成/);
    assert.match(receivedMessages[0].content, /玩家作为本次重写的导演/);
    assert.match(receivedMessages[0].content, /AI 控制角色与 NPC 的动作/);
    assert.match(receivedMessages.at(-1).content, /待替换旧版回合_JSON/);
    assert.match(receivedMessages.at(-1).content, /红墨大厅/);
    assert.match(
      receivedMessages.at(-1).content,
      /馆长的拒绝太绝对，希望她依据证据改为谨慎合作/,
    );
    assert.match(receivedMessages.at(-1).content, /只指父回合及更早历史/);
    assert.equal(regenerated.replacedTurn.id, turnId);
    assert.equal(regenerated.replacedTurn.sequence, 2);
    assert.equal(regenerated.replacedTurn.regenerationCount, 1);
    assert.equal(regenerated.adventure.branchState.turnHistory.length, 2);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM turns").get().total,
      2,
    );
    const latest = regenerated.adventure.branchState.recentTurns.at(-1);
    assert.equal(latest.generatedOutput.turn.scene, replacementOutput.turn.scene);
    assert.equal(latest.generation.totalTokens, 620);
    assert.equal(
      regenerated.adventure.branchState.states.some(
        (state) => state.entityId === "red-ink-hall",
      ),
      false,
    );
    assert.equal(
      regenerated.adventure.branchState.states.some(
        (state) =>
          state.entityType === "world_book_entry" &&
          state.state.content === "红墨写下的内容永远不能撤回。",
      ),
      false,
    );
    assert.equal(
      regenerated.adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === started.mainCharacterId,
      ).state.mood,
      "重新审视",
    );
    assert.equal(
      regenerated.adventure.branchState.states.find(
        (state) =>
          state.entityType === "relationship" &&
          state.entityId === `${started.mainCharacterId}:${started.playerCharacterId}`,
      ).state.trust,
      -5,
    );
    const preservedObserver = regenerated.adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_card" &&
        state.entityId === observer.characterId,
    );
    assert.equal(preservedObserver.state.data.name, "旁观者");
    assert.equal(
      regenerated.adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === observer.characterId,
      ).state.present,
      true,
    );

    const audit = database
      .prepare(
        "SELECT previous_turn_json, replacement_turn_json FROM turn_regenerations WHERE action_id = ?",
      )
      .get("regeneration-action-1");
    assert.match(audit.previous_turn_json, /红墨大厅/);
    assert.match(audit.replacement_turn_json, /蓝纸庭院/);
    assert.match(audit.replacement_turn_json, /馆长的拒绝太绝对/);
    const rewrittenContext = store.loadTurnContextSnapshot(started.sessionId, turnId);
    assert.match(rewrittenContext.systemPrompt, /AI 控制角色与 NPC 的动作/);

    const retry = await regenerateLatestAdventureTurn({
      store,
      sessionId: started.sessionId,
      expectedHeadTurnId: turnId,
      actionId: "regeneration-action-1",
      feedback: "馆长的拒绝太绝对，希望她依据证据改为谨慎合作。",
      generate: async () => {
        throw new Error("幂等重试不应再次调用 DeepSeek");
      },
    });
    assert.equal(retry.replacedTurn.reused, true);
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS total FROM turn_regenerations")
        .get().total,
      1,
    );

    await assert.rejects(
      () =>
        regenerateLatestAdventureTurn({
          store,
          sessionId: started.sessionId,
          expectedHeadTurnId: turnId,
          actionId: "failed-regeneration",
          feedback: "希望调整叙述节奏。",
          generate: async () => {
            throw new Error("模拟模型连接失败");
          },
        }),
      /模拟模型连接失败/,
    );
    assert.equal(
      store.loadTurn(started.branchId, turnId).generatedOutput.turn.scene,
      replacementOutput.turn.scene,
    );

    store.manageCharacter({
      actionId: "manual-change-after-head",
      sessionId: started.sessionId,
      operation: "set_presence",
      characterId: observer.characterId,
      present: false,
    });
    await assert.rejects(
      () =>
        regenerateLatestAdventureTurn({
          store,
          sessionId: started.sessionId,
          expectedHeadTurnId: turnId,
          actionId: "blocked-after-manual-change",
          feedback: "希望旁观者仍然在场。",
          generate: async () => {
            throw new Error("被拦截时不应调用模型");
          },
        }),
      (error) =>
        error instanceof TurnRegenerationError &&
        /手工修改过人物、地点、剧情任务、世界书、原文、记忆或持久状态/.test(
          error.message,
        ),
    );

    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    assert.equal(
      store.loadTurn(started.branchId, turnId).generatedOutput.turn.scene,
      replacementOutput.turn.scene,
    );
    store.deleteAdventure(started.sessionId);
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS total FROM turn_regenerations")
        .get().total,
      0,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
