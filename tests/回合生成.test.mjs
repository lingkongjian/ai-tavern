import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import {
  normalizeGeneratedTurnVersion,
  parsePlayerTurnRequest,
} from "../lib/story/回合协议.ts";
import { advanceAdventureTurn } from "../lib/story/回合服务.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

test("normalizes only compatible generated turn schema versions", () => {
  assert.equal(
    normalizeGeneratedTurnVersion({ schemaVersion: "1.0" }).schemaVersion,
    "1.0.0",
  );
  assert.equal(
    normalizeGeneratedTurnVersion({ schema_version: 1 }).schemaVersion,
    "1.0.0",
  );
  assert.equal(
    normalizeGeneratedTurnVersion({ schemaVersion: "2.0" }).schemaVersion,
    "2.0",
  );
});

test("generates, validates and atomically commits a DeepSeek story turn", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-generation-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "回合测试",
      world: { name: "潮汐城", premise: "钟声会改变潮水方向。" },
      player: { name: "旅人", description: "寻找失踪同伴的测绘师。" },
      mainCharacter: {
        name: "守钟人",
        role: "钟楼看守",
        personality: "警觉但守信。",
        firstMessage: "钟还没有敲响。",
      },
      openingScene: "旅人在黄昏来到钟楼。",
      initialStoryDirection: "调查钟楼与失踪案的联系。",
      initialStoryModuleId: "investigate-clock",
      storyModules: [
        {
          id: "investigate-clock",
          title: "调查逆流铜钟",
          objective: "调查铜钟与失踪案的联系，并核验守钟人提出的处理方案。",
          completionCriteria: ["取得铜钟影响失踪者的可信证据"],
          prerequisiteModuleIds: [],
        },
      ],
      sourceDocuments: [
        {
          name: "潮汐城原作",
          fileName: "潮汐城原作.md",
          content: [
            "# 第一章 守钟人的试探",
            "守钟人没有立刻相信旅人。她把侧门钥匙压在掌心，平静地问：‘你准备拿什么证明自己不是来偷钟的？’",
            "# 第二章 逆流铜钟",
            "守钟人说明，失踪者的影子只能用钟楼原有的潮汐铜钥匙暂时固定，必须先核对铜钟的逆流周期，不能另请术士强行处理。",
          ].join("\n\n"),
          enabled: true,
          currentChapter: 1,
          preventFuture: true,
          fidelity: "faithful",
        },
      ],
    });

    const turnId = "turn-2-fixed";
    let generationCalls = 0;
    let receivedMessages;
    const generatedContent = {
      schemaVersion: "1.0",
      turn: {
        scene: "守钟人打开侧门，让旅人看见一枚正在逆流滴水的铜钟。",
        events: [
          {
            id: "event-turn-2",
            type: "secret_revealed",
            summary: "守钟人向旅人展示了逆流铜钟。",
            characterIds: [started.playerCharacterId, started.mainCharacterId],
            locationId: "clock-tower",
          },
        ],
        dialogue: [
          {
            id: "dialogue-turn-2",
            speakerId: started.mainCharacterId,
            content: "每次它逆流，城里就会少一个影子。",
            addressedCharacterIds: [started.playerCharacterId],
          },
        ],
      },
      decision: {
        context: "action_direction",
        prompt: "旅人准备如何调查这枚铜钟？",
        choices: [
          {
            id: "choice-help",
            label: "询问受害者",
            description: "先保护可能失去影子的人。",
            stance: "benevolent",
          },
          {
            id: "choice-watch",
            label: "观察铜钟",
            description: "记录逆流发生的规律。",
            stance: "neutral",
          },
        ],
      },
      stateCommit: {
        sceneTransition: {
          locationId: "clock-tower",
          locationName: "逆流钟楼",
          locationDescription: "铜钟悬在潮湿的石室中央，水滴沿钟身逆流而上。",
          presentCharacterIds: [
            started.playerCharacterId,
            started.mainCharacterId,
          ],
          reason: "旅人与守钟人仍在钟楼石室中。",
          evidence: ["event-turn-2"],
        },
        characterStateChanges: [
          {
            characterId: started.mainCharacterId,
            patch: { mood: "谨慎信任", currentGoal: "说明铜钟的危险" },
            duration: "until_changed",
            reason: "守钟人决定向旅人透露部分秘密",
            evidence: ["event-turn-2"],
          },
        ],
        relationshipChanges: [
          {
            sourceCharacterId: started.mainCharacterId,
            targetCharacterId: started.playerCharacterId,
            dimension: "trust",
            delta: 8,
            reason: "旅人的谨慎回应获得守钟人认可",
            evidence: ["dialogue-turn-2"],
          },
        ],
        characterCardChanges: [
          {
            characterId: started.mainCharacterId,
            operation: "add",
            path: "beliefs",
            value: ["旅人可能值得托付铜钟秘密"],
            reason: "守钟人首次主动展示铜钟",
            evidence: ["event-turn-2"],
            sourceTurnId: turnId,
          },
        ],
        worldBookChanges: [
          {
            operation: "update",
            targetEntryId: "world-core",
            patch: { content: "钟声会改变潮水；逆流铜钟还会夺走居民的影子。" },
            sourceTurnId: turnId,
            reason: "铜钟的持久规则已经在剧情中得到证实",
            evidence: ["event-turn-2"],
          },
        ],
        storyDirectionEvaluation: {
          status: "active",
          reason: "只发现了联系，尚未查清失踪案。",
          evidence: [],
          continuity: "uncertain",
          continuityReason: "当前没有预埋剧本任务可供比较。",
          recommendedModuleId: null,
          suggestedNextDirection: null,
        },
        summaryPatch: "守钟人展示逆流铜钟，并透露它会夺走居民的影子。",
      },
      warnings: [],
    };

    const input = parsePlayerTurnRequest({
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "request-turn-2",
      selectedChoiceId: "opening-neutral",
      roleplay: { mode: "action", content: "旅人先观察守钟人的反应。" },
      storyDirection: "调查钟楼与失踪案的联系。",
    });
    const result = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input,
      createTurnId: () => turnId,
      generate: async (messages) => {
        generationCalls += 1;
        receivedMessages = messages;
        return {
          content: generatedContent,
          model: "deepseek-v4-flash",
          usage: { totalTokens: 1200 },
        };
      },
    });

    assert.equal(generationCalls, 1);
    assert.match(receivedMessages[0].content, new RegExp(turnId));
    assert.match(receivedMessages[0].content, /原文参考规则/);
    assert.match(receivedMessages[0].content, /后续剧本锚点规则/);
    assert.match(receivedMessages[0].content, /不得自行发明替代方案/);
    assert.match(receivedMessages[0].content, /世界、事件与角色均为虚构/);
    assert.match(receivedMessages[0].content, /不要仅因内容亲密而回避/);
    assert.match(receivedMessages[0].content, /成年角色双方当前自愿/);
    assert.match(receivedMessages[0].content, /不得替玩家角色同意/);
    assert.match(receivedMessages[0].content, /longTermMemory/);
    assert.match(receivedMessages[1].content, /opening-neutral/);
    assert.match(receivedMessages[1].content, /守钟人没有立刻相信旅人/);
    assert.match(receivedMessages[1].content, /chapterSummaries/);
    assert.match(receivedMessages[1].content, /longTermMemory/);
    assert.match(receivedMessages[1].content, /upcomingScriptGuidance/);
    assert.match(receivedMessages[1].content, /潮汐铜钥匙/);
    assert.equal(result.committedTurn.sequence, 2);
    assert.equal(
      result.adventure.branchState.recentTurns.at(-1).generatedOutput
        .schemaVersion,
      "1.0.0",
    );
    assert.equal(
      result.adventure.branchState.recentTurns.at(-1).generatedOutput
        .sourceReferences.length,
      1,
    );
    assert.equal(
      result.adventure.branchState.recentTurns.at(-1).generatedOutput
        .scriptGuidanceReferences.length,
      1,
    );
    assert.equal(
      result.adventure.branchState.recentTurns.at(-1).generatedOutput
        .memoryContext.recentTurnCount,
      6,
    );
    assert.equal(store.loadStoryMemory(started.sessionId).latestRetrieval.turnId, turnId);
    assert.equal(result.adventure.branchState.recentTurns.length, 2);
    assert.equal(
      result.adventure.branchState.recentTurns.at(-1).generation.totalTokens,
      1200,
    );
    assert.equal(
      result.adventure.branchState.recentTurns.at(-1).stateChanges.length,
      9,
    );
    assert.equal(
      result.adventure.branchState.recentTurns.at(-1).generatedOutput.turn.scene,
      generatedContent.turn.scene,
    );

    const evolution = result.adventure.branchState.states.find(
      (state) => state.entityType === "character_card_evolution",
    );
    assert.deepEqual(evolution.state.beliefs, ["旅人可能值得托付铜钟秘密"]);

    const baseWorld = result.adventure.branchState.states.find(
      (state) => state.entityId === "world-core",
    );
    const overlayWorld = result.adventure.branchState.states.find(
      (state) => state.state.shadowsEntryId === "world-core",
    );
    assert.equal(baseWorld.state.content, "钟声会改变潮水方向。");
    assert.equal(overlayWorld.state.layer, "session_overlay");
    assert.match(overlayWorld.state.content, /夺走居民的影子/);

    const retry = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input,
      generate: async () => {
        throw new Error("幂等重试不应再次调用模型");
      },
    });
    assert.equal(retry.committedTurn.id, turnId);
    assert.equal(retry.committedTurn.reused, true);
    assert.equal(store.loadAdventure(started.sessionId).branchState.recentTurns.length, 2);

    const repairedContent = structuredClone(generatedContent);
    repairedContent.turn.scene = "旅人记录下铜钟的逆流周期。";
    repairedContent.turn.events[0].id = "event-turn-3";
    repairedContent.turn.dialogue[0].id = "dialogue-turn-3";
    repairedContent.stateCommit.sceneTransition.evidence = ["event-turn-3"];
    repairedContent.stateCommit.characterStateChanges = [];
    repairedContent.stateCommit.relationshipChanges = [];
    repairedContent.stateCommit.characterCardChanges = [];
    repairedContent.stateCommit.worldBookChanges = [];
    repairedContent.stateCommit.storyDirectionEvaluation = {
      status: "active",
      reason: "调查仍在继续。",
      evidence: [],
      continuity: "uncertain",
      continuityReason: "当前没有预埋剧本任务可供比较。",
      recommendedModuleId: null,
      suggestedNextDirection: null,
    };
    let repairCalls = 0;
    const thirdTurn = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: turnId,
        idempotencyKey: "request-turn-3",
        selectedChoiceId: "choice-watch",
        storyDirection: "调查钟楼与失踪案的联系。",
      }),
      createTurnId: () => "turn-3-fixed",
      generate: async () => {
        repairCalls += 1;
        return {
          content:
            repairCalls === 1
              ? { schemaVersion: "1.0.0", broken: true }
              : repairedContent,
          model: "deepseek-v4-flash",
          usage:
            repairCalls === 1
              ? { promptTokens: 100, completionTokens: 5, totalTokens: 105 }
              : { promptTokens: 120, completionTokens: 20, totalTokens: 140 },
        };
      },
    });
    assert.equal(repairCalls, 2);
    assert.equal(thirdTurn.committedTurn.sequence, 3);
    assert.deepEqual(thirdTurn.generation.usage, {
      promptTokens: 220,
      completionTokens: 25,
      totalTokens: 245,
    });
    assert.equal(
      thirdTurn.adventure.branchState.recentTurns.at(-1).generation.totalTokens,
      245,
    );
    assert.equal(store.loadAdventure(started.sessionId).branchState.recentTurns.length, 3);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function parseStoryContext(content) {
  return JSON.parse(content.slice(content.indexOf("{")));
}

test("剧情一致时注入剧本推进引导，偏离后停止且引导不写入历史", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-progress-e2e-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "剧本推进引导测试",
      world: { name: "潮汐城", premise: "钟声会改变潮水方向。" },
      player: { name: "旅人", description: "寻找失踪同伴的测绘师。" },
      mainCharacter: {
        name: "守钟人",
        role: "钟楼看守",
        personality: "警觉但守信。",
        firstMessage: "钟还没有敲响。",
      },
      openingScene: "旅人在黄昏来到钟楼。",
      initialStoryDirection: "查明旅人的影子为何变淡。",
      initialStoryModuleId: "fading-shadow",
      storyModules: [
        {
          id: "fading-shadow",
          title: "影子失踪",
          objective: "查明旅人的影子为何变淡，并找到进入钟楼的办法。",
          completionCriteria: ["影子变淡的原因得到可信解释"],
          prerequisiteModuleIds: [],
        },
      ],
      sourceDocuments: [
        {
          name: "潮汐城原作",
          fileName: "潮汐城原作.md",
          content: [
            "# 第一章 钟楼初见",
            "守钟人把钥匙压在掌心，没有立刻交给旅人。",
            "# 第二章 影子失踪",
            "守钟人发现旅人的影子变淡后，第一次主动打开了钟楼侧门。",
            "“跟紧我。现在不是证明你勇敢的时候。”",
          ].join("\n\n"),
          enabled: true,
          currentChapter: 1,
          preventFuture: true,
          fidelity: "balanced",
        },
      ],
    });

    const storyDirection = "查明旅人的影子为何变淡。";
    const evaluationFor = (continuity) => ({
      status: "active",
      reason: "调查仍在继续。",
      evidence: [],
      continuity,
      continuityReason: `与预埋剧本的连续性${continuity === "aligned" ? "一致" : "不一致"}。`,
      recommendedModuleId: null,
      suggestedNextDirection: null,
    });
    const baseTurn = (eventId, scene) => ({
      schemaVersion: "1.0.0",
      turn: {
        scene,
        events: [
          {
            id: eventId,
            type: "plot_progress",
            summary: scene,
            characterIds: [started.playerCharacterId, started.mainCharacterId],
            locationId: "clock-tower",
          },
        ],
        dialogue: [
          {
            id: `${eventId}-line`,
            speakerId: started.mainCharacterId,
            content: "钟楼里还有我们没看过的东西。",
            addressedCharacterIds: [started.playerCharacterId],
          },
        ],
      },
      decision: {
        context: "action_direction",
        prompt: "旅人接下来准备做什么？",
        choices: [
          {
            id: "choice-1",
            label: "继续调查",
            description: "留在钟楼继续调查。",
            stance: "neutral",
          },
          {
            id: "choice-2",
            label: "回去休息",
            description: "先离开钟楼休息。",
            stance: "benevolent",
          },
        ],
      },
      stateCommit: {
        sceneTransition: {
          locationId: "clock-tower",
          locationName: "逆流钟楼",
          locationDescription: "铜钟悬在潮湿的石室中央。",
          presentCharacterIds: [started.playerCharacterId, started.mainCharacterId],
          reason: "旅人与守钟人仍在钟楼石室中。",
          evidence: [eventId],
        },
        characterStateChanges: [],
        relationshipChanges: [],
        characterCardChanges: [],
        worldBookChanges: [],
        summaryPatch: scene,
      },
      warnings: [],
    });

    // 回合 1：没有上一回合的连续性信号，不注入推进引导
    const firstOutput = {
      ...baseTurn("event-progress-1", "旅人在钟楼门前提及影子变淡。"),
      stateCommit: {
        ...baseTurn("event-progress-1", "旅人在钟楼门前提及影子变淡。").stateCommit,
        storyDirectionEvaluation: evaluationFor("aligned"),
      },
    };
    let firstMessages;
    const first = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "progress-e2e-1",
        selectedChoiceId: "opening-neutral",
        roleplay: { mode: "action", content: "旅人先观察守钟人的反应。" },
        storyDirection,
      }),
      createTurnId: () => "turn-progress-1",
      generate: async (messages) => {
        firstMessages = messages;
        return {
          content: firstOutput,
          model: "deepseek-v4-flash",
          usage: { totalTokens: 1000 },
        };
      },
    });
    assert.equal(first.committedTurn.sequence, 2);
    const firstContext = parseStoryContext(firstMessages[1].content);
    assert.deepEqual(firstContext.upcomingScriptGuidance, []);
    assert.doesNotMatch(firstMessages[0].content, /剧本推进引导规则/);

    // 回合 2：上一回合 aligned → 注入剧本推进引导，且不写入历史
    const secondOutput = {
      ...baseTurn("event-progress-2", "守钟人讲述影子的异常。"),
      stateCommit: {
        ...baseTurn("event-progress-2", "守钟人讲述影子的异常。").stateCommit,
        storyDirectionEvaluation: evaluationFor("aligned"),
      },
    };
    let secondMessages;
    const second = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: first.committedTurn.id,
        idempotencyKey: "progress-e2e-2",
        selectedChoiceId: "choice-1",
        storyDirection,
      }),
      createTurnId: () => "turn-progress-2",
      generate: async (messages) => {
        secondMessages = messages;
        return {
          content: secondOutput,
          model: "deepseek-v4-flash",
          usage: { totalTokens: 1000 },
        };
      },
    });
    assert.equal(second.committedTurn.sequence, 3);
    assert.match(secondMessages[0].content, /剧本推进引导规则/);
    assert.match(secondMessages[0].content, /不是已经发生的事实/);
    assert.match(secondMessages[0].content, /暂缓推进而不是强行拉回剧本路线/);
    const secondContext = parseStoryContext(secondMessages[1].content);
    assert.equal(secondContext.upcomingScriptGuidance.length, 1);
    assert.equal(
      secondContext.upcomingScriptGuidance[0].scope,
      "next_chapter_progress_hint",
    );
    assert.equal(secondContext.upcomingScriptGuidance[0].chapterIndex, 2);
    assert.match(
      secondContext.upcomingScriptGuidance[0].excerpt,
      /主动打开了钟楼侧门/,
    );
    assert.equal(
      JSON.stringify(secondContext.recentTurns).includes("主动打开了钟楼侧门"),
      false,
      "推进引导不得进入历史回合上下文",
    );
    assert.equal(
      secondContext.upcomingScriptGuidance[0].excerpt.includes(
        "跟紧我。现在不是证明你勇敢的时候。",
      ),
      true,
    );
    // 保存的引用带 scope 供审计与页面展示
    assert.equal(
      store.loadAdventure(started.sessionId).branchState.recentTurns.at(-1)
        .generatedOutput.scriptGuidanceReferences[0].scope,
      "next_chapter_progress_hint",
    );

    // 回合 3：输出 diverged 提交后，回合 4 不再注入
    const thirdOutput = {
      ...baseTurn("event-progress-3", "旅人决定放弃调查钟楼。"),
      stateCommit: {
        ...baseTurn("event-progress-3", "旅人决定放弃调查钟楼。").stateCommit,
        storyDirectionEvaluation: evaluationFor("diverged"),
      },
    };
    const third = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: second.committedTurn.id,
        idempotencyKey: "progress-e2e-3",
        selectedChoiceId: "choice-1",
        storyDirection,
      }),
      createTurnId: () => "turn-progress-3",
      generate: async () => ({
        content: thirdOutput,
        model: "deepseek-v4-flash",
        usage: { totalTokens: 1000 },
      }),
    });
    assert.equal(third.committedTurn.sequence, 4);

    let fourthMessages;
    const fourth = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: third.committedTurn.id,
        idempotencyKey: "progress-e2e-4",
        selectedChoiceId: "choice-1",
        storyDirection,
      }),
      createTurnId: () => "turn-progress-4",
      generate: async (messages) => {
        fourthMessages = messages;
        return {
          content: {
            ...baseTurn("event-progress-4", "旅人收拾行装准备离开。"),
            stateCommit: {
              ...baseTurn("event-progress-4", "旅人收拾行装准备离开。").stateCommit,
              storyDirectionEvaluation: evaluationFor("diverged"),
            },
          },
          model: "deepseek-v4-flash",
          usage: { totalTokens: 1000 },
        };
      },
    });
    assert.equal(fourth.committedTurn.sequence, 5);
    const fourthContext = parseStoryContext(fourthMessages[1].content);
    assert.deepEqual(fourthContext.upcomingScriptGuidance, []);
    assert.doesNotMatch(fourthMessages[0].content, /剧本推进引导规则/);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
