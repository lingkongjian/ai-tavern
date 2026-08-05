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
  TurnCancelledError,
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
        ...(input.timeAdvance ? { timeAdvance: input.timeAdvance } : {}),
        ...(input.gameTimeDayNext !== undefined
          ? { gameTimeDayNext: input.gameTimeDayNext }
          : {}),
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
      mode: "standard",
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
  // time_fix 模式允许空 feedback（模式本身说明问题），缺省 mode 为 standard
  assert.deepEqual(
    parseRegenerateTurnRequest({
      expectedHeadTurnId: "turn-2",
      actionId: "regenerate-3",
      feedback: "",
      mode: "time_fix",
    }),
    {
      expectedHeadTurnId: "turn-2",
      actionId: "regenerate-3",
      feedback: "",
      mode: "time_fix",
    },
  );
  assert.deepEqual(
    parseRegenerateTurnRequest({
      expectedHeadTurnId: "turn-2",
      actionId: "regenerate-4",
      feedback: " 希望调整节奏。 ",
    }),
    {
      expectedHeadTurnId: "turn-2",
      actionId: "regenerate-4",
      feedback: "希望调整节奏。",
      mode: "standard",
    },
  );
  // 非法 mode 拒绝
  assert.throws(
    () =>
      parseRegenerateTurnRequest({
        expectedHeadTurnId: "turn-2",
        actionId: "regenerate-5",
        feedback: "希望调整节奏。",
        mode: "magic",
      }),
    (error) =>
      error instanceof RegenerateTurnInputError &&
      /mode 必须是 standard 或 time_fix/.test(error.message),
  );
  // standard 模式 feedback 仍必填（time_fix 豁免不适用）
  assert.throws(
    () =>
      parseRegenerateTurnRequest({
        expectedHeadTurnId: "turn-2",
        actionId: "regenerate-6",
        feedback: "",
        mode: "standard",
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
    // standard 模式（缺省）不注入日期修正指令，行为与旧版完全一致
    assert.doesNotMatch(receivedMessages[0].content, /日期修正重写指令/);
    assert.doesNotMatch(receivedMessages[0].content, /gameTimeDayNext 缺失/);
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
        /手工修改过人物、地点、剧情任务、伏笔、偏离触发器、世界书、原文、记忆或持久状态/.test(
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

test("time_fix 重写：注入日期修正指令、修正日期推进、严格校验升级警告", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-timefix-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "时间修正测试",
      world: { name: "时钟城", premise: "城市的时间由摆钟统一校准。" },
      player: { name: "旅人", description: "负责校准摆钟的旅人。" },
      mainCharacter: {
        name: "钟表匠",
        role: "时钟城钟表匠",
        personality: "守时、固执。",
      },
      openingScene: "旅人傍晚走进钟表匠的铺子。",
    });
    const turnId = "timefix-head-turn";

    const sessionDay = () =>
      store
        .loadAdventure(started.sessionId)
        .branchState.states.find(
          (state) =>
            state.entityType === "session_state" && state.entityId === "core",
        ).state.gameTimeDay;

    // 父回合：正文明确"次日"但旧版生成漏声明 gameTimeDayNext（日期未推进）。
    const flawedOutput = generatedTurn({
      turnId,
      scene: "钟表匠说次日清晨才能修好摆钟，旅人只能先回去。",
      eventId: "timefix-event",
      dialogueId: "timefix-dialogue",
      summary: "钟表匠把修钟时间约定到次日清晨。",
      dialogue: "明天一早再来吧。",
      locationId: "clock-shop",
      locationName: "钟表匠铺子",
      locationDescription: "堆满齿轮与摆锤的小铺。",
      presentCharacterIds: [
        started.playerCharacterId,
        started.mainCharacterId,
      ],
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
      mood: "旧版等待",
      trustDelta: 0,
      worldFact: "",
    });
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "timefix-parent-turn",
        selectedChoiceId: "opening-neutral",
      }),
      createTurnId: () => turnId,
      generate: async () => ({
        content: flawedOutput,
        model: "deepseek-test",
        usage: { totalTokens: 500 },
      }),
    });
    assert.equal(sessionDay(), 1);

    // 时间修正重写：空 feedback（模式本身说明问题），结果声明 gameTimeDayNext=2 且正文一致。
    const fixedOutput = generatedTurn({
      turnId,
      scene: "次日清晨，钟表匠把修好的摆钟交给旅人，铺子门外已经排起等候校准的市民队伍。",
      eventId: "timefix-fixed-event",
      dialogueId: "timefix-fixed-dialogue",
      summary: "次日清晨摆钟修好，旅人取回摆钟。",
      dialogue: "修好了，准时。",
      locationId: "clock-shop",
      locationName: "钟表匠铺子",
      locationDescription: "堆满齿轮与摆锤的小铺。",
      presentCharacterIds: [
        started.playerCharacterId,
        started.mainCharacterId,
      ],
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
      mood: "已取回",
      trustDelta: 5,
      worldFact: "",
      gameTimeDayNext: 2,
    });
    let timeFixMessages;
    const firstFix = await regenerateLatestAdventureTurn({
      store,
      sessionId: started.sessionId,
      expectedHeadTurnId: turnId,
      actionId: "timefix-regeneration-1",
      feedback: "",
      mode: "time_fix",
      generate: async (messages) => {
        timeFixMessages = messages;
        return {
          content: fixedOutput,
          model: "deepseek-test",
          usage: { totalTokens: 600 },
        };
      },
    });
    // 日期修正指令注入系统消息（独立段落），standard 模式不注入
    assert.match(timeFixMessages[0].content, /日期修正重写指令/);
    assert.match(timeFixMessages[0].content, /sceneTransition\.gameTimeDayNext/);
    assert.match(timeFixMessages[0].content, /不得为"修正"而虚构时间流逝/);
    assert.match(timeFixMessages.at(-1).content, /正文暗示时间流逝/);
    assert.doesNotMatch(timeFixMessages.at(-1).content, /<玩家修改意见>/);
    assert.equal(firstFix.replacedTurn.id, turnId);
    assert.equal(sessionDay(), 2);
    assert.equal(
      store.loadTurnContextSnapshot(started.sessionId, turnId).requestCount,
      1,
    );

    // 正文确实没有时间流逝时：日期保持不变，不得虚构推进。
    const noTimeOutput = generatedTurn({
      turnId,
      scene: "钟表匠在铺子里继续检查摆钟，没有提到明天。",
      eventId: "timefix-notime-event",
      dialogueId: "timefix-notime-dialogue",
      summary: "钟表匠继续检查摆钟。",
      dialogue: "今晚先校准一下齿轮。",
      locationId: "clock-shop",
      locationName: "钟表匠铺子",
      locationDescription: "堆满齿轮与摆锤的小铺。",
      presentCharacterIds: [
        started.playerCharacterId,
        started.mainCharacterId,
      ],
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
      mood: "继续等待",
      trustDelta: 0,
      worldFact: "",
    });
    const noTimeFix = await regenerateLatestAdventureTurn({
      store,
      sessionId: started.sessionId,
      expectedHeadTurnId: turnId,
      actionId: "timefix-regeneration-2",
      feedback: "",
      mode: "time_fix",
      generate: async () => ({
        content: noTimeOutput,
        model: "deepseek-test",
        usage: { totalTokens: 600 },
      }),
    });
    assert.equal(noTimeFix.replacedTurn.id, turnId);
    assert.equal(sessionDay(), 1);
    assert.equal(
      store.loadTurnContextSnapshot(started.sessionId, turnId).requestCount,
      1,
    );

    // 严格校验：time_fix 重写结果仍"暗示跨日但未推进"→ 升级为校验错误，走修复重试。
    const badTimeOutput = generatedTurn({
      turnId,
      scene: "第二天早上钟表匠把修好的摆钟交给旅人。",
      eventId: "timefix-bad-event",
      dialogueId: "timefix-bad-dialogue",
      summary: "第二天早上交付摆钟。",
      dialogue: "修好了。",
      locationId: "clock-shop",
      locationName: "钟表匠铺子",
      locationDescription: "堆满齿轮与摆锤的小铺。",
      presentCharacterIds: [
        started.playerCharacterId,
        started.mainCharacterId,
      ],
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
      mood: "已取回",
      trustDelta: 5,
      worldFact: "",
    });
    const goodTimeOutput = generatedTurn({
      turnId,
      scene: "次日清晨，钟表匠把修好的摆钟交给旅人，铺子门外已经排起等候校准的市民队伍。",
      eventId: "timefix-good-event",
      dialogueId: "timefix-good-dialogue",
      summary: "次日清晨摆钟修好，旅人取回摆钟。",
      dialogue: "修好了，准时。",
      locationId: "clock-shop",
      locationName: "钟表匠铺子",
      locationDescription: "堆满齿轮与摆锤的小铺。",
      presentCharacterIds: [
        started.playerCharacterId,
        started.mainCharacterId,
      ],
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
      mood: "已取回",
      trustDelta: 5,
      worldFact: "",
      gameTimeDayNext: 2,
    });
    let strictCallCount = 0;
    let repairMessages;
    const strictFix = await regenerateLatestAdventureTurn({
      store,
      sessionId: started.sessionId,
      expectedHeadTurnId: turnId,
      actionId: "timefix-regeneration-3",
      feedback: "希望按约定时间交付。",
      mode: "time_fix",
      generate: async (messages) => {
        strictCallCount += 1;
        if (strictCallCount === 2) repairMessages = messages;
        return {
          content: strictCallCount === 1 ? badTimeOutput : goodTimeOutput,
          model: "deepseek-test",
          usage: { totalTokens: 600 },
        };
      },
    });
    assert.equal(strictCallCount, 2);
    assert.match(repairMessages.at(-1).content, /日期修正重写失败/);
    assert.match(repairMessages.at(-1).content, /gameTimeDayNext/);
    assert.equal(strictFix.replacedTurn.id, turnId);
    assert.equal(sessionDay(), 2);
    assert.equal(
      store.loadTurnContextSnapshot(started.sessionId, turnId).requestCount,
      2,
    );

    // standard 模式回归：同样的"正文暗示跨日但未声明"只保留警告，不升级为错误。
    const standardMessages = [];
    const standardFix = await regenerateLatestAdventureTurn({
      store,
      sessionId: started.sessionId,
      expectedHeadTurnId: turnId,
      actionId: "timefix-regeneration-4",
      feedback: "希望调整叙述节奏。",
      generate: async (messages) => {
        standardMessages.push(messages);
        return {
          content: badTimeOutput,
          model: "deepseek-test",
          usage: { totalTokens: 600 },
        };
      },
    });
    assert.equal(standardMessages.length, 1);
    assert.doesNotMatch(standardMessages[0][0].content, /日期修正重写指令/);
    assert.equal(standardFix.replacedTurn.id, turnId);
    assert.equal(sessionDay(), 1);
    assert.equal(
      store.loadTurnContextSnapshot(started.sessionId, turnId).requestCount,
      1,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("time_fix 重写在五回合一天模式下不要求 gameTimeDayNext", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-timefix-tb-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "回合制时间测试",
      world: { name: "时钟城", premise: "城市的时间由摆钟统一校准。" },
      player: { name: "旅人", description: "负责校准摆钟的旅人。" },
      mainCharacter: {
        name: "钟表匠",
        role: "时钟城钟表匠",
        personality: "守时、固执。",
      },
      openingScene: "旅人傍晚走进钟表匠的铺子。",
      timeMode: "turn_based",
    });
    const turnId = "timefix-turnbased-turn";

    const sessionState = () =>
      store
        .loadAdventure(started.sessionId)
        .branchState.states.find(
          (state) =>
            state.entityType === "session_state" && state.entityId === "core",
        ).state;

    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "timefix-turnbased-parent",
        selectedChoiceId: "opening-neutral",
      }),
      createTurnId: () => turnId,
      generate: async () => ({
        content: generatedTurn({
          turnId,
          scene: "钟表匠说次日清晨才能修好摆钟，旅人只能先回去。",
          eventId: "tb-event",
          dialogueId: "tb-dialogue",
          summary: "钟表匠把修钟时间约定到次日清晨。",
          dialogue: "明天一早再来吧。",
          locationId: "clock-shop",
          locationName: "钟表匠铺子",
          locationDescription: "堆满齿轮与摆锤的小铺。",
          presentCharacterIds: [
            started.playerCharacterId,
            started.mainCharacterId,
          ],
          playerCharacterId: started.playerCharacterId,
          mainCharacterId: started.mainCharacterId,
          mood: "旧版等待",
          trustDelta: 0,
          worldFact: "",
        }),
        model: "deepseek-test",
        usage: { totalTokens: 500 },
      }),
    });
    assert.equal(sessionState().gameTimeDay, 1);
    assert.equal(sessionState().phaseOffset, 1);

    let receivedMessages;
    const regenerated = await regenerateLatestAdventureTurn({
      store,
      sessionId: started.sessionId,
      expectedHeadTurnId: turnId,
      actionId: "timefix-turnbased-1",
      feedback: "",
      mode: "time_fix",
      generate: async (messages) => {
        receivedMessages = messages;
        return {
          content: generatedTurn({
            turnId,
            scene: "钟表匠在铺子里继续校准摆钟，旅人帮忙递送零件。",
            eventId: "tb-fixed-event",
            dialogueId: "tb-fixed-dialogue",
            summary: "两人继续在铺子里校准摆钟。",
            dialogue: "把那个小齿轮递给我。",
            locationId: "clock-shop",
            locationName: "钟表匠铺子",
            locationDescription: "堆满齿轮与摆锤的小铺。",
            presentCharacterIds: [
              started.playerCharacterId,
              started.mainCharacterId,
            ],
            playerCharacterId: started.playerCharacterId,
            mainCharacterId: started.mainCharacterId,
            mood: "继续等待",
            trustDelta: 0,
            worldFact: "",
            // 五回合一天模式下模型声明会被系统忽略，正文也不应暗示自行跨日
            gameTimeDayNext: 9,
          }),
          model: "deepseek-test",
          usage: { totalTokens: 600 },
        };
      },
    });
    // 回合制提示词变体：日期由系统固定推进，不得声明 gameTimeDayNext
    assert.match(receivedMessages[0].content, /日期修正重写指令/);
    assert.match(
      receivedMessages[0].content,
      /游戏内日期由系统按回合固定推进/,
    );
    assert.match(
      receivedMessages[0].content,
      /不得声明 sceneTransition\.timeAdvance \/ gameTimeDayNext/,
    );
    assert.equal(regenerated.replacedTurn.id, turnId);
    // 日期仍由回合制推导（重写从父回合状态重新派生，第 2 个回合仍为第 1 天），
    // 模型声明的 gameTimeDayNext=9 被忽略。
    assert.equal(sessionState().gameTimeDay, 1);
    assert.equal(sessionState().phaseOffset, 1);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("重生成在提交前被取消时不替换回合，取消后可正常重写", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-regenerate-cancel-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  const database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "重生成中断测试",
      world: { name: "纸城", premise: "公开写下的句子会成为短暂现实。" },
      player: { name: "记录员", description: "负责核验城市档案的旅行者。" },
      mainCharacter: {
        name: "馆长",
        role: "纸城档案馆馆长",
        personality: "严谨、克制，不接受没有来源的结论。",
      },
      openingScene: "记录员在闭馆前进入档案馆。",
    });
    const turnId = "cancel-regenerated-head-turn";
    const firstOutput = generatedTurn({
      turnId,
      scene: "馆长把记录员带进红墨大厅。",
      eventId: "cancel-old-event",
      dialogueId: "cancel-old-dialogue",
      summary: "记录员进入红墨大厅。",
      dialogue: "红墨写下的内容不能撤回。",
      locationId: "red-ink-hall",
      locationName: "红墨大厅",
      locationDescription: "墙面覆盖着尚未干透的红色文字。",
      presentCharacterIds: [started.playerCharacterId, started.mainCharacterId],
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
        idempotencyKey: "cancel-initial-generated-turn",
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
      scene: "馆长改带记录员进入蓝纸庭院，展示能够被改写的城市档案。",
      eventId: "cancel-replacement-event",
      dialogueId: "cancel-replacement-dialogue",
      summary: "记录员进入蓝纸庭院。",
      dialogue: "只要证据足够，纸城允许我们修订错误。",
      locationId: "blue-paper-court",
      locationName: "蓝纸庭院",
      locationDescription: "蓝色纸页像树叶一样悬在庭院上空。",
      presentCharacterIds: [started.playerCharacterId, started.mainCharacterId],
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
      mood: "重新审视",
      trustDelta: -5,
      worldFact: "",
    });

    // 1) 重写完成、替换前被取消：抛 TurnCancelledError 且 head 回合不变
    let cancelled = false;
    await assert.rejects(
      regenerateLatestAdventureTurn({
        store,
        sessionId: started.sessionId,
        expectedHeadTurnId: turnId,
        actionId: "cancel-regeneration-action-1",
        feedback: "馆长的拒绝太绝对，希望她依据证据改为谨慎合作。",
        isCancelled: () => cancelled,
        generate: async () => {
          cancelled = true; // 模拟重写期间客户端中断
          return {
            content: replacementOutput,
            model: "deepseek-test",
            usage: { totalTokens: 620 },
          };
        },
      }),
      (error) => error instanceof TurnCancelledError,
    );
    const afterCancel = store.loadAdventure(started.sessionId);
    assert.equal(
      afterCancel.branchState.branch.headTurnId,
      turnId,
      "取消后 head 回合不应被替换",
    );
    assert.equal(
      afterCancel.branchState.recentTurns.at(-1).generatedOutput.turn.scene,
      firstOutput.turn.scene,
      "取消后最新回合仍应是旧版",
    );

    // 2) 未取消：正常替换
    const regenerated = await regenerateLatestAdventureTurn({
      store,
      sessionId: started.sessionId,
      expectedHeadTurnId: turnId,
      actionId: "cancel-regeneration-action-2",
      feedback: "馆长的拒绝太绝对，希望她依据证据改为谨慎合作。",
      isCancelled: () => false,
      generate: async () => ({
        content: replacementOutput,
        model: "deepseek-test",
        usage: { totalTokens: 620 },
      }),
    });
    assert.equal(regenerated.replacedTurn.id, turnId);
    const afterRetry = store.loadAdventure(started.sessionId);
    assert.equal(afterRetry.branchState.recentTurns.at(-1).generatedOutput.turn.scene, replacementOutput.turn.scene);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
