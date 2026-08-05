import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import {
  GeneratedTurnValidationError,
  PlayerTurnInputError,
  normalizeGeneratedTurnVersion,
  parsePlayerTurnRequest,
  validateGeneratedTurn,
} from "../lib/story/回合协议.ts";
import {
  advanceAdventureTurn,
  collectDivergenceSignals,
  TurnCancelledError,
} from "../lib/story/回合服务.ts";
import { createStoryGenerationMessages, createStoryGenerationPrompt, collectMinorCharacters } from "../lib/story/剧情提示.ts";
import { parseCharacterManagementInput } from "../lib/story/人物管理.ts";
import { sceneSimilarity } from "../lib/story/重复检测.ts";

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
    // 成人内容调整：重要信息不得因题材回避而删改；防御性表述简化为身份不明确底线
    assert.match(receivedMessages[0].content, /重要信息传递/);
    assert.match(receivedMessages[0].content, /重要信息可能隐藏在包括亲密场景在内的任何场景中/);
    assert.match(receivedMessages[0].content, /身份不明确的角色不得参与亲密内容/);
    assert.match(receivedMessages[0].content, /任何参与者拒绝或撤回同意时/);
    // 防兜圈子规则 30
    assert.match(receivedMessages[0].content, /30\. 长剧情防兜圈子/);
    assert.match(receivedMessages[0].content, /不是可以重复表演的内容/);
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

function divergenceEvaluationTurn(started, scene, eventId, evaluation) {
  return {
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
          label: "继续行动",
          description: "采取下一步行动。",
          stance: "neutral",
        },
        {
          id: "choice-2",
          label: "先观察",
          description: "再观察一段时间。",
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
      plotThreadUpdates: [],
      plotTriggerUpdates: [],
      storyDirectionEvaluation: evaluation,
      summaryPatch: scene,
    },
    warnings: [],
  };
}

test("divergenceState 协议校验：仅 diverged 可填、枚举白名单、reason 限长", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-divergence-protocol-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "偏离协议测试",
      world: { name: "烛城", premise: "灯火与影子相生。" },
      player: { name: "旅人", description: "夜行客。" },
      mainCharacter: {
        name: "守夜人",
        role: "更夫",
        personality: "机敏。",
        firstMessage: "夜深了。",
      },
      openingScene: "旅人在烛城更楼下落脚。",
    });
    const adventure = store.loadAdventure(started.sessionId);
    const divergedEvaluation = {
      status: "active",
      reason: "调查偏离了预埋剧本。",
      evidence: [],
      continuity: "diverged",
      continuityReason: "已发生剧情与预埋剧本不再连续。",
      recommendedModuleId: null,
      suggestedNextDirection: null,
      divergenceState: {
        outlineRecoverable: "broken",
        badEndDrift: "rising",
        reason: "关键线索被毁，局势正在失控。",
      },
    };

    // diverged + divergenceState 通过并保留
    const validated = validateGeneratedTurn(
      divergenceEvaluationTurn(
        started,
        "旅人决定走自己的路。",
        "event-protocol-1",
        divergedEvaluation,
      ),
      adventure,
      "protocol-turn-1",
    );
    assert.deepEqual(
      validated.stateCommit.storyDirectionEvaluation.divergenceState,
      {
        outlineRecoverable: "broken",
        badEndDrift: "rising",
        reason: "关键线索被毁，局势正在失控。",
      },
    );

    // aligned 携带 divergenceState → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          divergenceEvaluationTurn(
            started,
            "剧情仍然一致。",
            "event-protocol-2",
            {
              ...divergedEvaluation,
              continuity: "aligned",
              continuityReason: "剧情与剧本一致。",
            },
          ),
          adventure,
          "protocol-turn-2",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("只能在 continuity=diverged")),
    );

    // uncertain 携带 divergenceState → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          divergenceEvaluationTurn(
            started,
            "连续性不确定。",
            "event-protocol-3",
            {
              ...divergedEvaluation,
              continuity: "uncertain",
              continuityReason: "暂无法判断连续性。",
            },
          ),
          adventure,
          "protocol-turn-3",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("只能在 continuity=diverged")),
    );

    // outlineRecoverable 非法枚举 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          divergenceEvaluationTurn(
            started,
            "偏离继续。",
            "event-protocol-4",
            {
              ...divergedEvaluation,
              divergenceState: {
                outlineRecoverable: "maybe",
                badEndDrift: "rising",
                reason: "判断依据",
              },
            },
          ),
          adventure,
          "protocol-turn-4",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("outlineRecoverable")),
    );

    // badEndDrift 非法枚举 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          divergenceEvaluationTurn(
            started,
            "偏离继续。",
            "event-protocol-5",
            {
              ...divergedEvaluation,
              divergenceState: {
                outlineRecoverable: "recoverable",
                badEndDrift: "spiking",
                reason: "判断依据",
              },
            },
          ),
          adventure,
          "protocol-turn-5",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("badEndDrift")),
    );

    // reason 超过 500 字被截断而非拒绝
    const validatedLong = validateGeneratedTurn(
      divergenceEvaluationTurn(
        started,
        "偏离继续。",
        "event-protocol-6",
        {
          ...divergedEvaluation,
          divergenceState: {
            outlineRecoverable: "recoverable",
            badEndDrift: "neutral",
            reason: "长".repeat(800),
          },
        },
      ),
      adventure,
      "protocol-turn-6",
    );
    assert.equal(
      validatedLong.stateCommit.storyDirectionEvaluation.divergenceState.reason
        .length,
      500,
    );

    // aligned + divergenceState 显式 null → 通过且不保留字段
    const validatedNull = validateGeneratedTurn(
      divergenceEvaluationTurn(
        started,
        "剧情一致。",
        "event-protocol-7",
        {
          status: "active",
          reason: "调查仍在继续。",
          evidence: [],
          continuity: "aligned",
          continuityReason: "剧情与剧本一致。",
          recommendedModuleId: null,
          suggestedNextDirection: null,
          divergenceState: null,
        },
      ),
      adventure,
      "protocol-turn-7",
    );
    assert.equal(
      validatedNull.stateCommit.storyDirectionEvaluation.divergenceState,
      undefined,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("规则 8 证据硬校验：所有状态变化类必须携带至少一条证据，active 评估除外", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-evidence-protocol-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "证据协议测试",
      world: { name: "烛城", premise: "灯火与影子相生。" },
      player: { name: "旅人", description: "夜行客。" },
      mainCharacter: {
        name: "守夜人",
        role: "更夫",
        personality: "机敏。",
        firstMessage: "夜深了。",
      },
      additionalCharacters: [
        {
          name: "老匠人",
          role: "铸钟师",
          personality: "寡言。",
          initiallyPresent: false,
        },
      ],
      openingScene: "旅人在烛城更楼下落脚。",
      foreshadowing: [
        {
          id: "well-bell",
          keywords: ["古井", "钟"],
          seedCondition: "角色进入古井附近或听到井中回声",
          payoffCondition: "玩家发现古井底部埋着铜钟",
          payoffSummary: "古井底的钟与老宅闹钟事件有关。",
          characters: ["老匠人"],
        },
      ],
      triggers: [
        {
          id: "ambush-den",
          when: "主角实力不足时强闯叛军大营",
          consequence: "叛军提前察觉并亲自出手。",
          stateEffects: { flags: ["bad_end"] },
        },
      ],
    });
    const adventure = store.loadAdventure(started.sessionId);
    const eventId = "event-evidence-1";

    function evidenceTurn(extraStateCommit) {
      return {
        schemaVersion: "1.0.0",
        turn: {
          scene: "更楼里灯火摇曳，守夜人放下铜锣。",
          events: [
            {
              id: eventId,
              type: "plot_progress",
              summary: "守夜人向旅人说起铜锣的来历。",
              characterIds: [started.playerCharacterId, started.mainCharacterId],
              locationId: "clock-tower",
            },
          ],
          dialogue: [],
        },
        decision: {
          context: "action_direction",
          prompt: "旅人接下来准备做什么？",
          choices: [
            {
              id: "choice-1",
              label: "继续追问",
              description: "追问铜锣的来历。",
              stance: "neutral",
            },
            {
              id: "choice-2",
              label: "先观察",
              description: "再观察一段时间。",
              stance: "benevolent",
            },
          ],
        },
        stateCommit: {
          sceneTransition: {
            locationId: "clock-tower",
            locationName: "更楼",
            locationDescription: "木楼二层。",
            presentCharacterIds: [
              started.playerCharacterId,
              started.mainCharacterId,
            ],
            reason: "两人仍在更楼。",
            evidence: [eventId],
          },
          characterStateChanges: [],
          relationshipChanges: [],
          characterCardChanges: [],
          worldBookChanges: [],
          plotThreadUpdates: [],
          plotTriggerUpdates: [],
          storyDirectionEvaluation: null,
          summaryPatch: "守夜人说起铜锣的来历。",
          ...extraStateCommit,
        },
        warnings: [],
      };
    }

    const stateChangeBase = {
      characterId: started.mainCharacterId,
      patch: { mood: "警惕" },
      duration: "until_changed",
      reason: "守夜人听到门外动静。",
    };

    const cases = [
      {
        label: "characterStateChanges",
        empty: { characterStateChanges: [{ ...stateChangeBase, evidence: [] }] },
        valid: { characterStateChanges: [{ ...stateChangeBase, evidence: [eventId] }] },
      },
      {
        label: "relationshipChanges",
        empty: {
          relationshipChanges: [
            {
              sourceCharacterId: started.mainCharacterId,
              targetCharacterId: started.playerCharacterId,
              dimension: "trust",
              delta: 5,
              reason: "旅人的谨慎回应获得认可。",
              evidence: [],
            },
          ],
        },
        valid: {
          relationshipChanges: [
            {
              sourceCharacterId: started.mainCharacterId,
              targetCharacterId: started.playerCharacterId,
              dimension: "trust",
              delta: 5,
              reason: "旅人的谨慎回应获得认可。",
              evidence: [eventId],
            },
          ],
        },
      },
      {
        label: "characterCardChanges",
        empty: {
          characterCardChanges: [
            {
              characterId: started.mainCharacterId,
              operation: "add",
              path: "beliefs",
              value: ["铜锣怕火"],
              reason: "守夜人主动展示铜锣。",
              evidence: [],
              sourceTurnId: "evidence-turn-1",
            },
          ],
        },
        valid: {
          characterCardChanges: [
            {
              characterId: started.mainCharacterId,
              operation: "add",
              path: "beliefs",
              value: ["铜锣怕火"],
              reason: "守夜人主动展示铜锣。",
              evidence: [eventId],
              sourceTurnId: "evidence-turn-1",
            },
          ],
        },
      },
      {
        label: "worldBookChanges",
        empty: {
          worldBookChanges: [
            {
              operation: "create",
              entry: { keys: ["铜锣"], content: "铜锣怕火。", enabled: true },
              sourceTurnId: "evidence-turn-1",
              reason: "铜锣的规则已被证实。",
              evidence: [],
            },
          ],
        },
        valid: {
          worldBookChanges: [
            {
              operation: "create",
              entry: { keys: ["铜锣"], content: "铜锣怕火。", enabled: true },
              sourceTurnId: "evidence-turn-1",
              reason: "铜锣的规则已被证实。",
              evidence: [eventId],
            },
          ],
        },
      },
      {
        label: "plotThreadUpdates",
        empty: {
          plotThreadUpdates: [
            { threadId: "well-bell", operation: "seed", reason: "听到井中回声。", evidence: [] },
          ],
        },
        valid: {
          plotThreadUpdates: [
            { threadId: "well-bell", operation: "seed", reason: "听到井中回声。", evidence: [eventId] },
          ],
        },
      },
      {
        label: "plotTriggerUpdates",
        empty: {
          plotTriggerUpdates: [
            { triggerId: "ambush-den", operation: "fire", reason: "强闯叛军大营。", evidence: [] },
          ],
        },
        valid: {
          plotTriggerUpdates: [
            { triggerId: "ambush-den", operation: "fire", reason: "强闯叛军大营。", evidence: [eventId] },
          ],
        },
      },
    ];

    for (const testCase of cases) {
      assert.throws(
        () =>
          validateGeneratedTurn(
            evidenceTurn(testCase.empty),
            adventure,
            "evidence-turn-1",
          ),
        (error) =>
          error instanceof GeneratedTurnValidationError &&
          /至少需要 1 项/.test(error.message),
        `${testCase.label} 空证据必须被拒绝`,
      );
      // 带证据的同类型变化必须通过（证据引用本轮真实事件）。
      const validated = validateGeneratedTurn(
        evidenceTurn(testCase.valid),
        adventure,
        "evidence-turn-1",
      );
      assert.ok(validated.stateCommit[testCase.label].length >= 1);
    }

    // storyDirectionEvaluation：active 允许空证据（评估未完成，语义上无新事件也可），
    // completed 必须携带证据。
    const activeEvaluation = validateGeneratedTurn(
      evidenceTurn({
        storyDirectionEvaluation: {
          status: "active",
          reason: "调查仍在继续。",
          evidence: [],
          continuity: "uncertain",
          continuityReason: "当前没有预埋剧本任务可供比较。",
          recommendedModuleId: null,
          suggestedNextDirection: null,
        },
      }),
      adventure,
      "evidence-turn-1",
    );
    assert.equal(
      activeEvaluation.stateCommit.storyDirectionEvaluation.status,
      "active",
    );

    assert.throws(
      () =>
        validateGeneratedTurn(
          evidenceTurn({
            storyDirectionEvaluation: {
              status: "completed",
              reason: "剧情目标已经达成。",
              evidence: [],
              continuity: "aligned",
              continuityReason: "与剧本一致。",
              recommendedModuleId: null,
              suggestedNextDirection: {
                title: "新目标",
                content: "继续调查铜锣。",
                reason: "自然推进。",
              },
            },
          }),
          adventure,
          "evidence-turn-1",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        /至少需要 1 项/.test(error.message),
      "storyDirectionEvaluation completed 空证据必须被拒绝",
    );

    // 场景变化也必须引用本轮真实发生的事件或对话（基线行为保持）。
    assert.throws(
      () =>
        validateGeneratedTurn(
          evidenceTurn({
            sceneTransition: {
              locationId: "clock-tower",
              locationName: "更楼",
              locationDescription: "木楼二层。",
              presentCharacterIds: [
                started.playerCharacterId,
                started.mainCharacterId,
              ],
              reason: "两人仍在更楼。",
              evidence: [],
            },
          }),
          adventure,
          "evidence-turn-1",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        /至少需要 1 项/.test(error.message),
      "sceneTransition 空证据必须被拒绝",
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("上一轮 diverged 时注入偏离状态清单与偏离路线处理规则，aligned 停止注入且不进历史", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-divergence-e2e-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "偏离选项引导测试",
      world: { name: "潮汐城", premise: "钟声会改变潮水方向。" },
      player: { name: "旅人", description: "寻找失踪同伴的测绘师。" },
      mainCharacter: {
        name: "守钟人",
        role: "钟楼看守",
        personality: "警觉但守信。",
        firstMessage: "钟还没有敲响。",
      },
      additionalCharacters: [
        {
          name: "账房先生",
          role: "掌柜",
          personality: "精打细算。",
          initiallyPresent: false,
        },
      ],
      openingScene: "旅人在黄昏来到钟楼。",
      initialStoryDirection: "查明旅人的影子为何变淡。",
      initialStoryModuleId: "fading-shadow",
      storyModules: [
        {
          id: "fading-shadow",
          title: "影子失踪",
          objective: "查明旅人的影子为何变淡。",
          completionCriteria: ["影子变淡的原因得到可信解释"],
          prerequisiteModuleIds: [],
        },
        {
          id: "second-module",
          title: "钟楼之下",
          objective: "进入钟楼底层查看逆流铜钟。",
          completionCriteria: ["钟楼底层被打开"],
          prerequisiteModuleIds: [],
        },
      ],
      locations: [
        {
          name: "潮汐集市",
          description: "黄昏时人声鼎沸的集市。",
          characters: ["账房先生"],
        },
      ],
      foreshadowing: [
        {
          id: "thread-tide",
          keywords: ["潮汐", "逆流"],
          seedCondition: "旅人进入钟楼底层",
          payoffCondition: "旅人查明逆流真相",
          payoffSummary: "铜钟逆流会夺走影子。",
          characters: ["守钟人"],
        },
      ],
      triggers: [
        {
          id: "trigger-ambush",
          when: "旅人试图强闯钟楼侧门",
          consequence: "守钟人鸣钟示警，城卫封锁钟楼。",
          deadline: 10,
        },
        {
          id: "trigger-keep",
          when: "旅人在钟楼逗留超过三天",
          consequence: "城卫开始盘查所有外来者。",
          deadline: 20,
        },
      ],
    });

    const storyDirection = "查明旅人的影子为何变淡。";
    const evaluationFor = (continuity, divergenceState) => ({
      status: "active",
      reason: "调查仍在继续。",
      evidence: [],
      continuity,
      continuityReason: `与预埋剧本的连续性${continuity === "aligned" ? "一致" : "不一致"}。`,
      recommendedModuleId: null,
      suggestedNextDirection: null,
      ...(divergenceState !== undefined ? { divergenceState } : {}),
    });
    const divergedState = {
      outlineRecoverable: "broken",
      badEndDrift: "rising",
      reason: "原剧本触发条件已不可满足，局势正滑向坏结局。",
    };

    // 回合 1：没有上一回合，不注入；输出 diverged + divergenceState 被保存
    const firstOutput = {
      ...divergenceEvaluationTurn(
        started,
        "旅人决定抛开钟楼的线索，独自去追查潮汐集市。",
        "event-diverge-1",
        evaluationFor("diverged", divergedState),
      ),
      stateCommit: {
        ...divergenceEvaluationTurn(
          started,
          "旅人决定抛开钟楼的线索，独自去追查潮汐集市。",
          "event-diverge-1",
          evaluationFor("diverged", divergedState),
        ).stateCommit,
        plotTriggerUpdates: [
          {
            triggerId: "trigger-ambush",
            operation: "fire",
            reason: "旅人试图强闯钟楼侧门，触发器条件满足",
            evidence: ["event-diverge-1"],
          },
        ],
      },
    };
    let firstMessages;
    const first = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "divergence-e2e-1",
        selectedChoiceId: "opening-neutral",
        roleplay: { mode: "action", content: "旅人先观察守钟人的反应。" },
        storyDirection,
      }),
      createTurnId: () => "turn-diverge-1",
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
    assert.doesNotMatch(firstMessages[0].content, /偏离路线处理规则/);
    const firstContext = parseStoryContext(firstMessages[1].content);
    assert.equal(firstContext.divergenceSignals, undefined);
    assert.deepEqual(
      store
        .loadAdventure(started.sessionId)
        .branchState.recentTurns.at(-1)
        .generatedOutput.stateCommit.storyDirectionEvaluation.divergenceState,
      divergedState,
      "divergenceState 随回合输出保存",
    );
    assert.equal(
      store
        .loadAdventure(started.sessionId)
        .branchState.recentTurns.at(-1)
        .generatedOutput.divergenceSignals,
      undefined,
      "偏离状态清单不进历史回合输出",
    );

    // 内容管理：停用排队任务、停用预注册地点、停用角色卡
    const adventureBeforeManagement = store.loadAdventure(started.sessionId);
    const marketLocation = adventureBeforeManagement.branchState.states.find(
      (state) =>
        state.entityType === "location" && state.state.name === "潮汐集市",
    );
    const clerkCard = adventureBeforeManagement.branchState.states.find(
      (state) =>
        state.entityType === "character_card" &&
        state.state.data?.name === "账房先生",
    );
    store.manageStoryModule({
      actionId: "manage-module-deactivate",
      sessionId: started.sessionId,
      operation: "set_active",
      moduleId: "second-module",
      active: false,
    });
    store.manageLocation({
      actionId: "manage-location-deactivate",
      sessionId: started.sessionId,
      operation: "set_active",
      locationId: marketLocation.entityId,
      active: false,
    });
    store.manageCharacter({
      actionId: "manage-character-deactivate",
      sessionId: started.sessionId,
      operation: "set_active",
      characterId: clerkCard.entityId,
      active: false,
    });

    // 回合 2：上一轮 diverged → 注入偏离状态清单与偏离路线处理规则
    const secondOutput = {
      ...divergenceEvaluationTurn(
        started,
        "旅人在潮汐集市追问账房的去向。",
        "event-diverge-2",
        evaluationFor("diverged", divergedState),
      ),
      stateCommit: {
        ...divergenceEvaluationTurn(
          started,
          "旅人在潮汐集市追问账房的去向。",
          "event-diverge-2",
          evaluationFor("diverged", divergedState),
        ).stateCommit,
        plotTriggerUpdates: [],
      },
    };
    let secondMessages;
    const second = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: first.committedTurn.id,
        idempotencyKey: "divergence-e2e-2",
        selectedChoiceId: "choice-1",
        storyDirection,
      }),
      createTurnId: () => "turn-diverge-2",
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
    assert.match(secondMessages[0].content, /偏离路线处理规则/);
    assert.match(secondMessages[0].content, /divergenceSignals 是导演级偏离状态清单/);
    assert.match(secondMessages[0].content, /不得出现"坏结局"/);
    assert.match(secondMessages[0].content, /规则 20 的偏离场景例外/);
    assert.match(secondMessages[0].content, /方向一/);
    assert.match(secondMessages[0].content, /方向二/);
    assert.match(secondMessages[0].content, /divergenceState 是导演级判断/);
    const secondContext = parseStoryContext(secondMessages[1].content);
    assert.equal(Array.isArray(secondContext.divergenceSignals.broken), true);
    assert.equal(Array.isArray(secondContext.divergenceSignals.recoverable), true);
    assert.equal(
      secondContext.divergenceSignals.broken.some((item) => item.includes("已经触发")),
      true,
      "已触发偏离触发器进入 broken 分组",
    );
    assert.equal(
      secondContext.divergenceSignals.broken.some((item) => item.includes("被停用的任务")),
      true,
      "被停用未完成任务进入 broken 分组",
    );
    assert.equal(
      secondContext.divergenceSignals.broken.some((item) => item.includes("地点《潮汐集市》已停用")),
      true,
      "停用地点进入 broken 分组",
    );
    assert.equal(
      secondContext.divergenceSignals.broken.some((item) => item.includes("角色卡《账房先生》已被停用")),
      true,
      "停用角色卡进入 broken 分组",
    );
    assert.equal(
      secondContext.divergenceSignals.recoverable.some((item) => item.includes("仍在进行")),
      true,
      "活动任务进入 recoverable 分组",
    );
    assert.equal(
      secondContext.divergenceSignals.recoverable.some((item) => item.includes("仍待触发")),
      true,
      "未触发触发器进入 recoverable 分组",
    );
    assert.equal(
      secondContext.divergenceSignals.recoverable.some((item) => item.includes("尚未回收")),
      true,
      "未回收伏笔进入 recoverable 分组",
    );

    // collectDivergenceSignals 单元行为与上下文一致
    const directSignals = collectDivergenceSignals(
      store.loadAdventure(started.sessionId),
    );
    assert.deepEqual(directSignals, secondContext.divergenceSignals);

    // 回合 3：输出 aligned（不再携带 divergenceState）→ 回合 4 停止注入
    const alignedOutput = divergenceEvaluationTurn(
      started,
      "守钟人找到了影子变淡的原因。",
      "event-align-3",
      evaluationFor("aligned"),
    );
    const third = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: second.committedTurn.id,
        idempotencyKey: "divergence-e2e-3",
        selectedChoiceId: "choice-1",
        storyDirection,
      }),
      createTurnId: () => "turn-align-3",
      generate: async () => ({
        content: alignedOutput,
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
        idempotencyKey: "divergence-e2e-4",
        selectedChoiceId: "choice-1",
        storyDirection,
      }),
      createTurnId: () => "turn-align-4",
      generate: async (messages) => {
        fourthMessages = messages;
        return {
          content: divergenceEvaluationTurn(
            started,
            "旅人与守钟人核对潮汐旧盟约。",
            "event-align-4",
            evaluationFor("aligned"),
          ),
          model: "deepseek-v4-flash",
          usage: { totalTokens: 1000 },
        };
      },
    });
    assert.equal(fourth.committedTurn.sequence, 5);
    assert.doesNotMatch(fourthMessages[0].content, /偏离路线处理规则/);
    const fourthContext = parseStoryContext(fourthMessages[1].content);
    assert.equal(fourthContext.divergenceSignals, undefined);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("collectDivergenceSignals 把超期任务列入 broken 分组", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-divergence-deadline-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "偏离期限测试",
      world: { name: "烛城", premise: "灯火与影子相生。" },
      player: { name: "旅人", description: "夜行客。" },
      mainCharacter: {
        name: "守夜人",
        role: "更夫",
        personality: "机敏。",
        firstMessage: "夜深了。",
      },
      openingScene: "旅人在烛城更楼下落脚。",
      initialStoryDirection: "查明烛影的来源。",
      initialStoryModuleId: "fading-shadow",
      storyModules: [
        {
          id: "fading-shadow",
          title: "影子失踪",
          objective: "查明影子为何变淡。",
          completionCriteria: ["影子变淡的原因得到可信解释"],
          prerequisiteModuleIds: [],
          deadlineDay: 1,
        },
      ],
    });
    const divergedEvaluation = {
      status: "active",
      reason: "调查偏离了预埋剧本。",
      evidence: [],
      continuity: "diverged",
      continuityReason: "已发生剧情与预埋剧本不再连续。",
      recommendedModuleId: null,
      suggestedNextDirection: null,
      divergenceState: {
        outlineRecoverable: "broken",
        badEndDrift: "neutral",
        reason: "原剧本触发条件已不可满足。",
      },
    };
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "divergence-deadline-1",
        selectedChoiceId: "opening-neutral",
        storyDirection: "查明烛影的来源。",
      }),
      createTurnId: () => "turn-deadline-1",
      generate: async () => ({
        content: divergenceEvaluationTurn(
          started,
          "旅人决定独自追查烛影。",
          "event-deadline-1",
          divergedEvaluation,
        ),
        model: "deepseek-v4-flash",
        usage: { totalTokens: 1000 },
      }),
    });
    const signals = collectDivergenceSignals(store.loadAdventure(started.sessionId));
    assert.equal(
      signals.broken.some((item) => item.includes("已超过期限")),
      true,
      "超过期限的任务进入 broken 分组",
    );
    assert.equal(
      signals.recoverable.some((item) => item.includes("仍在进行")),
      false,
      "已超期任务不应同时进入 recoverable 分组",
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function restrictionTurn(started, eventId, extra = {}) {
  return {
    schemaVersion: "1.0.0",
    turn: {
      scene: extra.scene ?? "烛城更楼里的对话继续。",
      events: [
        {
          id: eventId,
          type: "plot_progress",
          summary: extra.scene ?? "烛城更楼里的对话继续。",
          characterIds: [started.playerCharacterId, started.mainCharacterId],
          locationId: "clock-tower",
        },
      ],
      dialogue: extra.dialogue ?? [],
    },
    attributeChecks: extra.attributeChecks ?? [],
    decision: {
      context: "action_direction",
      prompt: "旅人接下来准备做什么？",
      choices: [
        {
          id: "choice-1",
          label: "继续行动",
          description: "采取下一步行动。",
          stance: "neutral",
        },
        {
          id: "choice-2",
          label: "先观察",
          description: "再观察一段时间。",
          stance: "benevolent",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId: "clock-tower",
        locationName: "逆流钟楼",
        locationDescription: "铜钟悬在潮湿的石室中央。",
        presentCharacterIds:
          extra.presentCharacterIds ??
          [started.playerCharacterId, started.mainCharacterId],
        offstageUpdates: extra.offstageUpdates ?? [],
        reason: "对话结束时两人仍留在钟楼。",
        evidence: [eventId],
      },
      characterStateChanges: extra.characterStateChanges ?? [],
      relationshipChanges: [],
      characterCardChanges: [],
      worldBookChanges: [],
      plotThreadUpdates: [],
      plotTriggerUpdates: [],
      storyDirectionEvaluation:
        extra.storyDirectionEvaluation === undefined
          ? {
              status: "active",
              reason: "调查仍在继续。",
              evidence: [],
              continuity: "uncertain",
              continuityReason: "当前没有预埋剧本任务可供比较。",
              recommendedModuleId: null,
              suggestedNextDirection: null,
            }
          : extra.storyDirectionEvaluation,
      summaryPatch: "更楼里的对话继续。",
    },
    warnings: [],
  };
}

test("行动受限角色硬拦截：发言、重新登场、离场移动、属性判定必须同轮解除", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-restriction-turn-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "行动受限回合测试",
      world: { name: "烛城", premise: "灯火与影子相生。" },
      player: { name: "旅人", description: "夜行客。" },
      mainCharacter: {
        name: "守夜人",
        role: "更夫",
        personality: "机敏。",
        firstMessage: "夜深了。",
      },
      additionalCharacters: [
        {
          name: "囚犯",
          role: "被关押的疑犯",
          personality: "沉默。",
          initiallyPresent: false,
        },
      ],
      openingScene: "旅人在烛城更楼下落脚。",
    });
    const adventure = store.loadAdventure(started.sessionId);
    const prisonerId = started.additionalCharacterIds[0];
    const clearingChange = (characterId, eventId) => [
      {
        characterId,
        patch: { restriction: null },
        duration: "until_changed",
        reason: "囚犯越狱获释",
        evidence: [eventId],
      },
    ];
    const clearingPatchIssue = (error, keyword) =>
      error instanceof GeneratedTurnValidationError &&
      error.issues.some((issue) => issue.includes(keyword));

    // 1. 未受限角色发言正常通过
    const plainTurn = restrictionTurn(started, "event-restriction-plain", {
      dialogue: [
        {
          id: "dialogue-restriction-plain",
          speakerId: started.mainCharacterId,
          content: "更楼里一切如常。",
          addressedCharacterIds: [started.playerCharacterId],
        },
      ],
    });
    assert.equal(
      validateGeneratedTurn(plainTurn, adventure, "turn-restriction-plain")
        .turn.dialogue.length,
      1,
    );

    // 2. 设置受限（玩家管理面板）后，该角色发言被拒
    store.manageCharacter(
      parseCharacterManagementInput({
        sessionId: started.sessionId,
        value: {
          actionId: "restrict-turn-set",
          operation: "set_restriction",
          characterId: prisonerId,
          restriction: { kind: "imprisoned", summary: "被城主关押在地牢" },
        },
      }),
    );
    const restrictedAdventure = store.loadAdventure(started.sessionId);
    const speakTurn = restrictionTurn(started, "event-restriction-speak", {
      dialogue: [
        {
          id: "dialogue-restriction-speak",
          speakerId: prisonerId,
          content: "放我出去！",
          addressedCharacterIds: [started.playerCharacterId],
        },
      ],
    });
    assert.throws(
      () =>
        validateGeneratedTurn(speakTurn, restrictedAdventure, "turn-restriction-speak"),
      (error) => clearingPatchIssue(error, "行动受限角色"),
    );

    // 3. 同轮 patch.restriction=null 解除后，发言放行
    const speakTurnCleared = restrictionTurn(started, "event-restriction-speak-clear", {
      dialogue: [
        {
          id: "dialogue-restriction-speak-clear",
          speakerId: prisonerId,
          content: "我越狱出来了！",
          addressedCharacterIds: [started.playerCharacterId],
        },
      ],
      characterStateChanges: clearingChange(prisonerId, "event-restriction-speak-clear"),
    });
    assert.equal(
      validateGeneratedTurn(speakTurnCleared, restrictedAdventure, "turn-restriction-speak-clear")
        .turn.dialogue.length,
      1,
    );

    // 4. 此前不在场的受限角色被加入 presentCharacterIds → 拒；同轮解除后放行
    const arriveTurn = restrictionTurn(started, "event-restriction-arrive", {
      presentCharacterIds: [
        started.playerCharacterId,
        started.mainCharacterId,
        prisonerId,
      ],
    });
    assert.throws(
      () =>
        validateGeneratedTurn(arriveTurn, restrictedAdventure, "turn-restriction-arrive"),
      (error) => clearingPatchIssue(error, "重新登场"),
    );
    const arriveTurnCleared = restrictionTurn(started, "event-restriction-arrive-clear", {
      presentCharacterIds: [
        started.playerCharacterId,
        started.mainCharacterId,
        prisonerId,
      ],
      characterStateChanges: clearingChange(prisonerId, "event-restriction-arrive-clear"),
    });
    assert.equal(
      validateGeneratedTurn(arriveTurnCleared, restrictedAdventure, "turn-restriction-arrive-clear")
        .stateCommit.sceneTransition.presentCharacterIds.includes(prisonerId),
      true,
    );

    // 5. 受限角色发生离场移动 → 拒
    const moveTurn = restrictionTurn(started, "event-restriction-move", {
      offstageUpdates: [
        {
          characterId: prisonerId,
          locationId: "city-prison",
          locationName: "城主地牢",
          reason: "囚犯被转移",
        },
      ],
    });
    assert.throws(
      () =>
        validateGeneratedTurn(moveTurn, restrictedAdventure, "turn-restriction-move"),
      (error) => clearingPatchIssue(error, "离场移动"),
    );
    const moveTurnCleared = restrictionTurn(started, "event-restriction-move-clear", {
      offstageUpdates: [
        {
          characterId: prisonerId,
          locationId: "city-prison",
          locationName: "城主地牢",
          reason: "囚犯被转移",
        },
      ],
      characterStateChanges: clearingChange(prisonerId, "event-restriction-move-clear"),
    });
    assert.equal(
      validateGeneratedTurn(moveTurnCleared, restrictedAdventure, "turn-restriction-move-clear")
        .stateCommit.sceneTransition.offstageUpdates.length,
      1,
    );

    // 6. 受限角色不出现于 attributeChecks
    const checkTurn = restrictionTurn(started, "event-restriction-check", {
      attributeChecks: [
        {
          id: "check-restriction",
          characterId: prisonerId,
          attribute: "力量",
          difficulty: 70,
          context: "囚犯试图挣脱铁链",
        },
      ],
    });
    assert.throws(
      () =>
        validateGeneratedTurn(checkTurn, restrictedAdventure, "turn-restriction-check"),
      (error) => clearingPatchIssue(error, "不能参与属性判定"),
    );

    // 7. patch.restriction 结构校验
    const badKind = restrictionTurn(started, "event-restriction-bad-kind", {
      characterStateChanges: [
        {
          characterId: started.mainCharacterId,
          patch: { restriction: { kind: "sleeping", summary: "睡着了" } },
          duration: "until_changed",
          reason: "测试",
          evidence: ["event-restriction-bad-kind"],
        },
      ],
    });
    assert.throws(
      () =>
        validateGeneratedTurn(badKind, restrictedAdventure, "turn-restriction-bad-kind"),
      (error) => clearingPatchIssue(error, "restriction.kind"),
    );
    const missingSummary = restrictionTurn(started, "event-restriction-no-summary", {
      characterStateChanges: [
        {
          characterId: started.mainCharacterId,
          patch: { restriction: { kind: "imprisoned" } },
          duration: "until_changed",
          reason: "测试",
          evidence: ["event-restriction-no-summary"],
        },
      ],
    });
    assert.throws(
      () =>
        validateGeneratedTurn(missingSummary, restrictedAdventure, "turn-restriction-no-summary"),
      (error) => clearingPatchIssue(error, "restriction.summary"),
    );
    const longSummary = restrictionTurn(started, "event-restriction-long-summary", {
      characterStateChanges: [
        {
          characterId: started.mainCharacterId,
          patch: { restriction: { kind: "imprisoned", summary: "长".repeat(201) } },
          duration: "until_changed",
          reason: "测试",
          evidence: ["event-restriction-long-summary"],
        },
      ],
    });
    assert.throws(
      () =>
        validateGeneratedTurn(longSummary, restrictedAdventure, "turn-restriction-long-summary"),
      (error) => clearingPatchIssue(error, "restriction.summary"),
    );
    const notObject = restrictionTurn(started, "event-restriction-not-object", {
      characterStateChanges: [
        {
          characterId: started.mainCharacterId,
          patch: { restriction: "被关押" },
          duration: "until_changed",
          reason: "测试",
          evidence: ["event-restriction-not-object"],
        },
      ],
    });
    assert.throws(
      () =>
        validateGeneratedTurn(notObject, restrictedAdventure, "turn-restriction-not-object"),
      (error) => clearingPatchIssue(error, "restriction 必须是对象"),
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("AI 回合设置行动受限后生效，且下一回合受限角色发言触发修复重试", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-restriction-flow-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "行动受限流转测试",
      world: { name: "烛城", premise: "灯火与影子相生。" },
      player: { name: "旅人", description: "夜行客。" },
      mainCharacter: {
        name: "守夜人",
        role: "更夫",
        personality: "机敏。",
        firstMessage: "夜深了。",
      },
      additionalCharacters: [
        {
          name: "囚犯",
          role: "被关押的疑犯",
          personality: "沉默。",
          initiallyPresent: false,
        },
      ],
      openingScene: "旅人在烛城更楼下落脚。",
    });
    const prisonerId = started.additionalCharacterIds[0];

    // 第一轮：模型通过 characterStateChanges 设置行动受限
    const setRestrictionTurn = restrictionTurn(started, "event-flow-set", {
      dialogue: [
        {
          id: "dialogue-flow-set",
          speakerId: started.mainCharacterId,
          content: "城主已下令把囚犯关进地牢。",
          addressedCharacterIds: [started.playerCharacterId],
        },
      ],
      characterStateChanges: [
        {
          characterId: prisonerId,
          patch: { restriction: { kind: "imprisoned", summary: "被城主关进地牢" } },
          duration: "until_changed",
          reason: "城主下令关押囚犯",
          evidence: ["event-flow-set"],
        },
      ],
      storyDirectionEvaluation: null,
    });
    const firstTurn = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "restriction-flow-1",
        selectedChoiceId: "opening-neutral",
      }),
      createTurnId: () => "turn-flow-1",
      generate: async () => ({
        content: setRestrictionTurn,
        model: "deepseek-v4-flash",
        usage: { totalTokens: 800 },
      }),
    });
    assert.equal(firstTurn.committedTurn.sequence, 2);
    let adventure = store.loadAdventure(started.sessionId);
    const prisonerState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === prisonerId,
    );
    assert.equal(prisonerState.state.restriction.kind, "imprisoned");
    assert.equal(prisonerState.state.restriction.summary, "被城主关进地牢");

    // 第二轮：模型让受限角色发言 → 首轮生成被拒，修复后保持沉默并提交
    let calls = 0;
    const invalidSpeakTurn = restrictionTurn(started, "event-flow-speak", {
      scene: "地牢里传来囚犯的喊叫。",
      dialogue: [
        {
          id: "dialogue-flow-speak",
          speakerId: prisonerId,
          content: "放我出去！",
          addressedCharacterIds: [started.playerCharacterId],
        },
      ],
      storyDirectionEvaluation: null,
    });
    const repairedTurn = restrictionTurn(started, "event-flow-speak", {
      scene: "旅人守夜时查看地牢方向，没有动静。",
      dialogue: [
        {
          id: "dialogue-flow-speak",
          speakerId: started.mainCharacterId,
          content: "地牢里没有动静。",
          addressedCharacterIds: [started.playerCharacterId],
        },
      ],
      storyDirectionEvaluation: null,
    });
    const secondTurn = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: "turn-flow-1",
        idempotencyKey: "restriction-flow-2",
        selectedChoiceId: "choice-1",
      }),
      createTurnId: () => "turn-flow-2",
      generate: async () => {
        calls += 1;
        return {
          content: calls === 1 ? invalidSpeakTurn : repairedTurn,
          model: "deepseek-v4-flash",
          usage: { totalTokens: 800 },
        };
      },
    });
    assert.equal(calls, 2);
    assert.equal(secondTurn.committedTurn.sequence, 3);
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(
      adventure.branchState.recentTurns
        .at(-1)
        .generatedOutput.turn.dialogue[0].speakerId,
      started.mainCharacterId,
    );
    assert.equal(
      adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === prisonerId,
      ).state.restriction.kind,
      "imprisoned",
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function statusesTestTurn(started, eventId, scene, extra = {}) {
  return {
    schemaVersion: "1.0.0",
    turn: {
      scene,
      events: [
        {
          id: eventId,
          type: "status_change",
          summary: scene,
          characterIds: [started.playerCharacterId, started.mainCharacterId],
          locationId: "clock-tower",
        },
      ],
      dialogue: [
        {
          id: `${eventId}-line`,
          speakerId: started.mainCharacterId,
          content: "镜面在微微发烫。",
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
        ...(extra.timeAdvance ? { timeAdvance: extra.timeAdvance } : {}),
      },
      characterStateChanges: extra.characterStateChanges ?? [],
      relationshipChanges: [],
      characterCardChanges: [],
      worldBookChanges: [],
      plotThreadUpdates: [],
      plotTriggerUpdates: [],
      storyDirectionEvaluation: null,
      summaryPatch: scene,
    },
    warnings: [],
  };
}

function choiceDiversityTurn(started, eventId, scene, choices) {
  return {
    ...statusesTestTurn(started, eventId, scene),
    decision: {
      context: "action_direction",
      prompt: "旅人接下来准备做什么？",
      choices,
    },
  };
}

function statusesAdventure(store, campaignName) {
  return store.startAdventure({
    campaignName,
    world: { name: "潮汐城", premise: "钟声会改变潮水方向。" },
    player: { name: "旅人", description: "寻找失踪同伴的测绘师。" },
    mainCharacter: {
      name: "守钟人",
      role: "钟楼看守",
      personality: "警觉但守信。",
      firstMessage: "钟还没有敲响。",
    },
    openingScene: "旅人在黄昏来到钟楼。",
  });
}

test("角色状态词条 patch 校验：非法结构拒绝，合法数组通过", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-statuses-protocol-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "状态协议测试");
    const adventure = store.loadAdventure(started.sessionId);
    const base = statusesTestTurn(
      started,
      "event-status-protocol",
      "守钟人查看镜面。",
    );
    const withStatuses = (statuses) => ({
      ...base,
      stateCommit: {
        ...base.stateCommit,
        characterStateChanges: [
          {
            characterId: started.mainCharacterId,
            patch: { statuses },
            duration: "until_changed",
            reason: "剧情中的状态变化",
            evidence: ["event-status-protocol"],
          },
        ],
      },
    });

    // 非数组非 null → 拒绝
    assert.throws(
      () => validateGeneratedTurn(withStatuses("中毒"), adventure, "protocol-1"),
      GeneratedTurnValidationError,
    );
    // 非法 kind → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withStatuses([
            { id: "s1", name: "中毒", kind: "magic", description: "毒性" },
          ]),
          adventure,
          "protocol-2",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("kind")),
    );
    // 重复 id → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withStatuses([
            { id: "dup", name: "受伤", kind: "debuff", description: "伤势" },
            { id: "dup", name: "中毒", kind: "debuff", description: "毒性" },
          ]),
          adventure,
          "protocol-3",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("重复")),
    );
    // expiresAtDay 非法 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withStatuses([
            { id: "s1", name: "中毒", kind: "debuff", description: "毒性", expiresAtDay: 0 },
          ]),
          adventure,
          "protocol-4",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("expiresAtDay")),
    );
    // hidden 非布尔 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withStatuses([
            { id: "s1", name: "潜伏", kind: "debuff", description: "潜伏", hidden: 1 },
          ]),
          adventure,
          "protocol-5",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("hidden")),
    );
    // null 清除全部 → 通过
    const cleared = validateGeneratedTurn(
      withStatuses(null),
      adventure,
      "protocol-6",
    );
    assert.equal(cleared.stateCommit.characterStateChanges[0].patch.statuses, null);
    // 合法数组 → 通过
    const valid = validateGeneratedTurn(
      withStatuses([
        {
          id: "wound-1",
          name: "受伤",
          kind: "debuff",
          description: "左臂刀伤未愈合",
          expiresAtDay: 5,
        },
        {
          id: "swift-1",
          name: "迅捷",
          kind: "buff",
          description: "镜之祝福",
          hidden: false,
        },
      ]),
      adventure,
      "protocol-7",
    );
    assert.equal(
      valid.stateCommit.characterStateChanges[0].patch.statuses.length,
      2,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("hidden 状态词条仅导演级注入，探索解锁后转为角色可见状态", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-hidden-status-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "隐藏状态测试");
    const characterId = started.mainCharacterId;

    store.manageCharacter(
      parseCharacterManagementInput({
        sessionId: started.sessionId,
        value: {
          actionId: "hidden-status-set",
          operation: "set_statuses",
          characterId,
          statuses: [
            {
              id: "poison-slow",
              name: "慢性毒",
              kind: "debuff",
              hidden: true,
              description: "镜中渗入的慢性毒，守钟人尚未察觉",
              expiresAtDay: 7,
            },
          ],
        },
      }),
    );

    // 未察觉时：词条只出现在导演级 hiddenCharacterStatuses，角色可见区不含
    let adventure = store.loadAdventure(started.sessionId);
    let messages = createStoryGenerationMessages({
      adventure,
      turnId: "next-turn-hidden-1",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    let context = parseStoryContext(messages[1].content);
    assert.equal(context.hiddenCharacterStatuses[0].characterId, characterId);
    assert.equal(context.hiddenCharacterStatuses[0].statuses[0].id, "poison-slow");
    const directoryEntry = context.characterDirectory.find(
      (character) => character.id === characterId,
    );
    assert.equal("statuses" in directoryEntry, false);
    // activeStates 中的完整状态也被脱敏
    const activeState = context.activeStates.find(
      (state) => state.entityType === "character_state" && state.entityId === characterId,
    );
    assert.equal(Array.isArray(activeState.state.statuses), true);
    assert.equal(activeState.state.statuses.length, 0);

    // 模型同轮让角色通过检查伤口实际认识到状态，patch 中 hidden 置 false
    const first = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "hidden-unlock-1",
        customChoice: "继续调查",
      }),
      createTurnId: () => "turn-hidden-1",
      generate: async () => ({
        content: statusesTestTurn(
          started,
          "event-hidden-1",
          "守钟人挽起袖子，看见左臂上一道淡淡的黑纹，终于意识到自己中毒了。",
          {
            characterStateChanges: [
              {
                characterId,
                patch: {
                  statuses: [
                    {
                      id: "poison-slow",
                      name: "慢性毒",
                      kind: "debuff",
                      hidden: false,
                      description: "镜中渗入的慢性毒，守钟人已察觉",
                      expiresAtDay: 7,
                    },
                  ],
                },
                duration: "until_changed",
                reason: "守钟人通过检查伤口认识到自己中毒",
                evidence: ["event-hidden-1"],
              },
            ],
          },
        ),
        model: "deepseek-v4-flash",
        usage: { totalTokens: 800 },
      }),
    });
    assert.equal(first.committedTurn.sequence, 2);
    adventure = store.loadAdventure(started.sessionId);
    const stateAfterUnlock = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" && state.entityId === characterId,
    );
    assert.equal(stateAfterUnlock.state.statuses[0].hidden, false);

    // 解锁后：导演区不再注入，角色可见区正常展示
    messages = createStoryGenerationMessages({
      adventure,
      turnId: "next-turn-hidden-2",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    context = parseStoryContext(messages[1].content);
    assert.equal("hiddenCharacterStatuses" in context, false);
    const unlockedEntry = context.characterDirectory.find(
      (character) => character.id === characterId,
    );
    assert.equal(unlockedEntry.statuses[0].id, "poison-slow");
    assert.equal(unlockedEntry.statuses[0].hidden, undefined);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("到期状态词条在回合提交时自动移除，未到期保留并写入状态变化记录", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-status-expiry-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "状态到期测试");
    const characterId = started.mainCharacterId;

    store.manageCharacter(
      parseCharacterManagementInput({
        sessionId: started.sessionId,
        value: {
          actionId: "expiry-status-set",
          operation: "set_statuses",
          characterId,
          statuses: [
            {
              id: "poison-short",
              name: "速发毒",
              kind: "debuff",
              description: "毒性将在次日发作完毕",
              expiresAtDay: 2,
            },
            {
              id: "wound-long",
              name: "重伤",
              kind: "debuff",
              description: "胸口的伤势需要数日静养",
              expiresAtDay: 5,
            },
          ],
        },
      }),
    );

    // 第一回合未推进时间（仍为第 1 日）：两个词条都保留
    const first = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "expiry-1",
        customChoice: "继续调查",
      }),
      createTurnId: () => "turn-expiry-1",
      generate: async () => ({
        content: statusesTestTurn(
          started,
          "event-expiry-1",
          "守钟人包扎了伤口，毒势没有扩散。",
        ),
        model: "deepseek-v4-flash",
        usage: { totalTokens: 800 },
      }),
    });
    let adventure = store.loadAdventure(started.sessionId);
    let state = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" && state.entityId === characterId,
    );
    assert.equal(state.state.statuses.length, 2);
    assert.deepEqual(
      state.state.statuses.map((status) => status.id).sort(),
      ["poison-short", "wound-long"],
    );

    // 第二回合推进一天（第 2 日）：expiresAtDay=2 的词条自动移除，未到期保留
    const second = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: first.committedTurn.id,
        idempotencyKey: "expiry-2",
        selectedChoiceId: "choice-1",
      }),
      createTurnId: () => "turn-expiry-2",
      generate: async () => ({
        content: statusesTestTurn(
          started,
          "event-expiry-2",
          "第 2 天，速发毒在睡梦中耗尽，胸口的重伤仍在。",
          { timeAdvance: "one_day" },
        ),
        model: "deepseek-v4-flash",
        usage: { totalTokens: 800 },
      }),
    });
    adventure = store.loadAdventure(started.sessionId);
    state = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" && state.entityId === characterId,
    );
    assert.equal(state.state.statuses.length, 1);
    assert.equal(state.state.statuses[0].id, "wound-long");

    // 到期移除写入 state_changes（重放一致性与审计）
    const expiryChanges = database
      .prepare(`
        SELECT reason, payload_json
        FROM state_changes
        WHERE session_id = ? AND turn_id = ?
          AND entity_type = 'character_state' AND entity_id = ?
          AND reason LIKE '%到期%'
      `)
      .all(started.sessionId, "turn-expiry-2", characterId);
    assert.equal(expiryChanges.length, 1);
    assert.match(expiryChanges[0].reason, /速发毒/);
    const payload = JSON.parse(expiryChanges[0].payload_json);
    assert.equal(payload.statuses.length, 1);
    assert.equal(payload.statuses[0].id, "wound-long");

    // 第三回合模型在 patch 中续期剩余词条：expiresAtDay 更新后不再到期
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: second.committedTurn.id,
        idempotencyKey: "expiry-3",
        selectedChoiceId: "choice-1",
      }),
      createTurnId: () => "turn-expiry-3",
      generate: async () => ({
        content: statusesTestTurn(
          started,
          "event-expiry-3",
          "守钟人喝下药汤，重伤开始好转。",
          {
            timeAdvance: "one_day",
            characterStateChanges: [
              {
                characterId,
                patch: {
                  statuses: [
                    {
                      id: "wound-long",
                      name: "重伤",
                      kind: "debuff",
                      description: "胸口的伤势逐渐好转",
                      expiresAtDay: 9,
                    },
                  ],
                },
                duration: "until_changed",
                reason: "守钟人用药后重伤开始好转",
                evidence: ["event-expiry-3"],
              },
            ],
          },
        ),
        model: "deepseek-v4-flash",
        usage: { totalTokens: 800 },
      }),
    });
    adventure = store.loadAdventure(started.sessionId);
    state = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" && state.entityId === characterId,
    );
    assert.equal(state.state.statuses.length, 1);
    assert.equal(state.state.statuses[0].id, "wound-long");
    assert.equal(state.state.statuses[0].expiresAtDay, 9);
    assert.equal(state.state.statuses[0].description, "胸口的伤势逐渐好转");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("跨日状态演化规则文本与词条剩余天数注入上下文", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-status-days-remaining-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "剩余天数注入测试");
    const characterId = started.mainCharacterId;
    store.manageCharacter(
      parseCharacterManagementInput({
        sessionId: started.sessionId,
        value: {
          actionId: "days-remaining-set",
          operation: "set_statuses",
          characterId,
          statuses: [
            {
              id: "poison-1",
              name: "中毒",
              kind: "debuff",
              description: "毒性潜伏，左臂发麻",
              expiresAtDay: 5,
            },
            { id: "buff-1", name: "迅捷", kind: "buff", description: "步伐轻盈" },
          ],
        },
      }),
    );
    const adventure = store.loadAdventure(started.sessionId);
    const messages = createStoryGenerationMessages({
      adventure,
      turnId: "next-turn-days",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    const systemPrompt = messages[0].content;
    // 规则 29：跨日强制演化规则（含"时间推进后必须演化词条"表述与示例）
    assert.match(systemPrompt, /29\. 跨日状态演化/);
    assert.match(systemPrompt, /时间推进后必须演化词条/);
    assert.match(systemPrompt, /one_day 或 several_days/);
    // 规则 30：长剧情防兜圈子（多回合重复拦截与推进要求）
    assert.match(systemPrompt, /30\. 长剧情防兜圈子/);
    assert.match(systemPrompt, /最近数回合内出现过的高相似场景会被后端判定为重复/);
    assert.match(systemPrompt, /chapterSummaries 和 longTermMemory 是旧信息的参考来源/);
    // 规则 26 追加的状态一致性强制
    assert.match(systemPrompt, /状态一致性强制/);

    const context = parseStoryContext(messages[1].content);
    assert.equal(context.currentGameTimeDay, 1);
    const entry = context.characterDirectory.find(
      (character) => character.id === characterId,
    );
    const poison = entry.statuses.find((status) => status.id === "poison-1");
    const buff = entry.statuses.find((status) => status.id === "buff-1");
    assert.equal(poison.expiresAtDay, 5);
    // 第 1 日、expiresAtDay=5 → 剩余 4 天
    assert.equal(poison.daysRemaining, 4);
    // 未设置 expiresAtDay 的词条不输出 daysRemaining
    assert.equal("daysRemaining" in buff, false);

    // 推进到第 7 日：到期词条的 daysRemaining 为负数
    const laterAdventure = {
      ...adventure,
      branchState: {
        ...adventure.branchState,
        states: adventure.branchState.states.map((state) =>
          state.entityType === "session_state" && state.entityId === "core"
            ? { ...state, state: { ...state.state, gameTimeDay: 7 } }
            : state,
        ),
      },
    };
    const laterMessages = createStoryGenerationMessages({
      adventure: laterAdventure,
      turnId: "next-turn-days-2",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    const laterContext = parseStoryContext(laterMessages[1].content);
    assert.equal(laterContext.currentGameTimeDay, 7);
    const laterEntry = laterContext.characterDirectory.find(
      (character) => character.id === characterId,
    );
    const laterPoison = laterEntry.statuses.find((status) => status.id === "poison-1");
    assert.equal(laterPoison.daysRemaining, -2);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("状态一致性警告：正文提到词条但未同步时提醒且不拒绝回合", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-status-sync-warning-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "状态一致性警告测试");
    const characterId = started.mainCharacterId;
    store.manageCharacter(
      parseCharacterManagementInput({
        sessionId: started.sessionId,
        value: {
          actionId: "sync-warning-set",
          operation: "set_statuses",
          characterId,
          statuses: [
            {
              id: "poison-1",
              name: "中毒",
              kind: "debuff",
              description: "毒性潜伏，左臂发麻",
              expiresAtDay: 5,
            },
            {
              id: "hidden-1",
              name: "蛊咒",
              kind: "debuff",
              hidden: true,
              description: "未察觉的蛊咒",
            },
          ],
        },
      }),
    );
    const adventure = store.loadAdventure(started.sessionId);

    // 场景 A：正文提到「中毒」但 patch.statuses 未同步 → 警告产生且校验通过
    const mentioned = validateGeneratedTurn(
      statusesTestTurn(started, "event-sync-a", "守钟人身上的中毒开始发作。"),
      adventure,
      "turn-sync-a",
    );
    assert.ok(
      mentioned.warnings.some((warning) => warning.includes("提到状态「中毒」")),
    );
    // 隐藏词条不参与一致性检测
    assert.ok(
      !mentioned.warnings.some((warning) => warning.includes("蛊咒")),
    );

    // 场景 B：正文提到且 patch.statuses 已更新该词条 id → 无警告
    const synced = validateGeneratedTurn(
      {
        ...statusesTestTurn(started, "event-sync-b", "守钟人身上的中毒开始发作。", {
          characterStateChanges: [
            {
              characterId,
              patch: {
                statuses: [
                  {
                    id: "poison-1",
                    name: "中毒",
                    kind: "debuff",
                    description: "毒势发作",
                    expiresAtDay: 6,
                  },
                ],
              },
              duration: "until_changed",
              reason: "中毒加深",
              evidence: ["event-sync-b"],
            },
          ],
        }),
      },
      adventure,
      "turn-sync-b",
    );
    assert.ok(
      !synced.warnings.some((warning) => warning.includes("提到状态「中毒」")),
    );

    // 场景 C：正文未提及词条 → 无警告
    const silent = validateGeneratedTurn(
      statusesTestTurn(started, "event-sync-c", "守钟人继续巡查钟楼。"),
      adventure,
      "turn-sync-c",
    );
    assert.equal(silent.warnings.length, 0);

    // 场景 D：正文提到但 patch.statuses=null 显式清除全部 → 视为已处理，不警告
    const cleared = validateGeneratedTurn(
      {
        ...statusesTestTurn(started, "event-sync-d", "守钟人身上的中毒已经解除。", {
          characterStateChanges: [
            {
              characterId,
              patch: { statuses: null },
              duration: "until_changed",
              reason: "解毒成功",
              evidence: ["event-sync-d"],
            },
          ],
        }),
      },
      adventure,
      "turn-sync-d",
    );
    assert.ok(
      !cleared.warnings.some((warning) => warning.includes("提到状态「中毒」")),
    );

    // 场景 E：正文只出现 description 关键词（左臂发麻）而未同步 → 警告
    const keywordMentioned = validateGeneratedTurn(
      statusesTestTurn(started, "event-sync-e", "守钟人只觉得左臂发麻得厉害。"),
      adventure,
      "turn-sync-e",
    );
    assert.ok(
      keywordMentioned.warnings.some((warning) => warning.includes("提到状态「中毒」")),
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("状态一致性警告随回合正常提交并写入生成输出，不阻断剧情", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-status-sync-e2e-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "状态一致性端到端测试");
    const characterId = started.mainCharacterId;
    store.manageCharacter(
      parseCharacterManagementInput({
        sessionId: started.sessionId,
        value: {
          actionId: "sync-e2e-set",
          operation: "set_statuses",
          characterId,
          statuses: [
            {
              id: "poison-1",
              name: "中毒",
              kind: "debuff",
              description: "毒性潜伏，左臂发麻",
              expiresAtDay: 5,
            },
          ],
        },
      }),
    );

    // 正文提到「中毒」但未同步词条：回合必须正常提交，警告进入 generatedOutput
    const result = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "sync-e2e-1",
        customChoice: "继续调查",
      }),
      createTurnId: () => "turn-sync-e2e",
      generate: async () => ({
        content: statusesTestTurn(
          started,
          "event-sync-e2e",
          "守钟人身上的中毒开始发作。",
        ),
        model: "deepseek-v4-flash",
        usage: { totalTokens: 800 },
      }),
    });
    assert.ok(result.committedTurn, "回合应正常提交，一致性检测不拒绝回合");
    const committedAdventure = store.loadAdventure(started.sessionId);
    const savedTurn = committedAdventure.branchState.recentTurns.find(
      (turn) => turn.id === result.committedTurn.id,
    );
    assert.ok(savedTurn, "提交的回合应写入历史");
    const warnings = savedTurn.generatedOutput.warnings ?? [];
    assert.ok(
      warnings.some((warning) => warning.includes("提到状态「中毒」")),
    );
    // 词条未被检测逻辑误改
    const adventure = store.loadAdventure(started.sessionId);
    const state = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" && state.entityId === characterId,
    );
    assert.equal(state.state.statuses.length, 1);
    assert.equal(state.state.statuses[0].id, "poison-1");
    assert.equal(state.state.statuses[0].description, "毒性潜伏，左臂发麻");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("规则 21/32/33：scene 充实度、承接顺序与选项实质差异", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-scene-richness-rules-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "scene 充实度规则测试");
    const adventure = store.loadAdventure(started.sessionId);
    const messages = createStoryGenerationMessages({
      adventure,
      turnId: "next-turn-richness",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    const systemPrompt = messages[0].content;
    // 规则 21：剧情必须推进且 scene 应完整充实（充实≠重复的边界）
    assert.match(systemPrompt, /21\. 剧情必须推进且 scene 应完整充实/);
    assert.match(systemPrompt, /写足本轮场景的环境与氛围、在场人物的反应与互动、玩家回应的直接结果与后续发展/);
    assert.match(systemPrompt, /12000/);
    assert.match(systemPrompt, /不要只写两三句梗概/);
    assert.match(systemPrompt, /充实以"本轮新发生的事实和进展"为边界/);
    // 规则 32：承接顺序——先呈现玩家回应直接后果，再推进新信息
    assert.match(systemPrompt, /32\. 承接顺序/);
    assert.match(systemPrompt, /先完整呈现玩家回应的直接后果/);
    assert.match(systemPrompt, /打断性新事件、新角色、新冲突或新选项/);
    assert.match(systemPrompt, /作为玩家回应结果的延续自然展开/);
    // 规则 33：候选选项实质差异——与最近 2-3 回合拉开差异
    assert.match(systemPrompt, /33\. 候选选项实质差异/);
    assert.match(systemPrompt, /最近 2-3 回合/);
    assert.match(systemPrompt, /继续调查\/观望\/保持现状/);
    assert.match(systemPrompt, /随剧情进展与玩家回应结果变化/);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("选项差异警告：与最近回合选项高度相似时提醒且不拒绝回合", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-choice-diversity-warning-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "选项差异警告测试");
    const adventure = store.loadAdventure(started.sessionId);

    // 构造带历史回合的冒险：上一轮选项为「继续调查/暂且观望」。
    const previousChoices = [
      {
        id: "prev-1",
        label: "继续调查",
        description:
          "沿着走廊尽头的新线索继续追查，看看钟楼深处还藏着什么秘密。",
        stance: "neutral",
      },
      {
        id: "prev-2",
        label: "暂且观望",
        description: "先不急着行动，观察守钟人的神色和铜钟的动向，等局面更明朗。",
        stance: "benevolent",
      },
    ];
    const historyTurn = {
      id: "turn-history-1",
      sequence: 1,
      generatedOutput: {
        turn: {
          scene: "旅人在黄昏来到钟楼，守钟人把钥匙压在掌心。",
          events: [],
          dialogue: [],
        },
        decision: {
          context: "action_direction",
          prompt: "接下来如何行动？",
          choices: previousChoices,
        },
      },
    };
    const withHistory = {
      ...adventure,
      branchState: { ...adventure.branchState, recentTurns: [historyTurn] },
    };
    const repeatedChoices = (prefix) => [
      {
        id: `${prefix}-1`,
        label: "继续调查",
        description:
          "沿着走廊尽头的新线索继续追查，看看钟楼深处还藏着什么秘密。",
        stance: "neutral",
      },
      {
        id: `${prefix}-2`,
        label: "暂且观望",
        description: "先不急着行动，观察守钟人的神色和铜钟的动向，等局面更明朗。",
        stance: "benevolent",
      },
    ];

    // 场景 A：本轮选项与上一轮高度相似 → 警告产生且校验通过（不拒绝回合）
    const repeated = validateGeneratedTurn(
      choiceDiversityTurn(
        started,
        "event-choice-a",
        "旅人继续留在钟楼石室。",
        repeatedChoices("a"),
      ),
      withHistory,
      "turn-choice-a",
    );
    assert.ok(
      repeated.warnings.some((warning) => warning.includes("选项高度相似")),
      "高度相似选项应产生选项差异警告",
    );
    assert.ok(
      repeated.warnings.some((warning) => warning.includes("第 1 回合")),
      "警告应指明相似的历史回合编号",
    );

    // 场景 B：本轮选项与上一轮明显不同 → 无选项差异警告
    const advanced = validateGeneratedTurn(
      choiceDiversityTurn(
        started,
        "event-choice-b",
        "旅人抓住铜钟的吊索向上攀爬。",
        [
          {
            id: "b-1",
            label: "爬上钟顶",
            description: "抓住吊索攀上钟楼顶层，从窗缝查看外面积水的潮沟。",
            stance: "neutral",
          },
          {
            id: "b-2",
            label: "撬开铜钟",
            description: "用撬棍抵住钟沿，试图让铜钟停止逆流滴水。",
            stance: "malicious",
          },
        ],
      ),
      withHistory,
      "turn-choice-b",
    );
    assert.ok(
      !advanced.warnings.some((warning) => warning.includes("选项高度相似")),
      "明显不同的选项不应触发选项差异警告",
    );

    // 场景 C：无最近回合（第一轮）→ 无警告
    const firstTurn = validateGeneratedTurn(
      choiceDiversityTurn(
        started,
        "event-choice-c",
        "旅人继续留在钟楼石室。",
        repeatedChoices("c"),
      ),
      adventure,
      "turn-choice-c",
    );
    assert.equal(firstTurn.warnings.length, 0, "无历史回合时不产生选项差异警告");

    // 场景 D：阈值边界——基准文本追加 15/16 字不重复后缀，相似度分别落在 0.65 两侧，
    // 警告行为必须与阈值一致（先用 sceneSimilarity 验证前提，避免脆断言）。
    const baseLabel = "继续调查";
    const baseDescription =
      "沿着走廊尽头的新线索继续追查，看看钟楼深处还藏着什么秘密";
    const boundarySequence = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥";
    const withSuffix = (count) =>
      choiceDiversityTurn(started, `event-choice-d-${count}`, "旅人继续留在钟楼石室。", [
        {
          id: `d-${count}-1`,
          label: baseLabel,
          description: `${baseDescription}，${boundarySequence.slice(0, count)}`,
          stance: "neutral",
        },
        {
          id: `d-${count}-2`,
          label: "回去休息",
          description: "今天先离开钟楼休息，明天一早再来查看潮沟。",
          stance: "benevolent",
        },
      ]);
    const prevText = `${previousChoices[0].label} ${previousChoices[0].description}`;
    const boundarySim = (count) =>
      sceneSimilarity(
        `${baseLabel} ${baseDescription}，${boundarySequence.slice(0, count)}`,
        prevText,
      );
    assert.ok(
      boundarySim(15) >= 0.65,
      `边界前提：追加 15 字后缀相似度应达到阈值（实际 ${boundarySim(15)}）`,
    );
    assert.ok(
      boundarySim(16) < 0.65,
      `边界前提：追加 16 字后缀相似度应低于阈值（实际 ${boundarySim(16)}）`,
    );
    const atThreshold = validateGeneratedTurn(
      withSuffix(15),
      withHistory,
      "turn-choice-d-15",
    );
    const belowThreshold = validateGeneratedTurn(
      withSuffix(16),
      withHistory,
      "turn-choice-d-16",
    );
    assert.ok(
      atThreshold.warnings.some((warning) => warning.includes("选项高度相似")),
      "相似度 ≥ 0.65 时应产生选项差异警告",
    );
    assert.ok(
      !belowThreshold.warnings.some((warning) =>
        warning.includes("选项高度相似"),
      ),
      "相似度 < 0.65 时不应产生选项差异警告",
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("选项差异警告随回合正常提交并写入生成输出，不阻断剧情", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-choice-diversity-e2e-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "选项差异端到端测试");

    // 第一轮：正常提交，无历史回合 → 无选项差异警告（选项文本足够长，参与相似度比较）
    const firstResult = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "choice-e2e-1",
        customChoice: "继续调查",
      }),
      createTurnId: () => "turn-choice-e2e-1",
      generate: async () => ({
        content: choiceDiversityTurn(
          started,
          "event-choice-e2e-1",
          "旅人沿走廊向前，铜钟的滴水声在身后拉长。",
          [
            {
              id: "e2e-1-1",
              label: "继续调查",
              description:
                "沿着走廊尽头的新线索继续追查，看看钟楼深处还藏着什么秘密。",
              stance: "neutral",
            },
            {
              id: "e2e-1-2",
              label: "暂且观望",
              description:
                "先不急着行动，观察守钟人的神色和铜钟的动向，等局面更明朗。",
              stance: "benevolent",
            },
          ],
        ),
        model: "deepseek-v4-flash",
        usage: { totalTokens: 800 },
      }),
    });
    assert.ok(firstResult.committedTurn, "第一轮应正常提交");
    let savedAdventure = store.loadAdventure(started.sessionId);
    let savedFirst = savedAdventure.branchState.recentTurns.find(
      (turn) => turn.id === firstResult.committedTurn.id,
    );
    assert.equal((savedFirst.generatedOutput.warnings ?? []).length, 0);

    // 第二轮：选项与第一轮几乎相同 → 选项差异警告产生且回合正常提交
    const secondResult = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: firstResult.committedTurn.id,
        idempotencyKey: "choice-e2e-2",
        customChoice: "继续调查",
      }),
      createTurnId: () => "turn-choice-e2e-2",
      generate: async () => ({
        content: choiceDiversityTurn(
          started,
          "event-choice-e2e-2",
          "旅人停下脚步，回头望向钟楼的石阶。",
          [
            {
              id: "e2e-2-1",
              label: "继续调查",
              description:
                "沿着走廊尽头的新线索继续追查，看看钟楼深处还藏着什么秘密。",
              stance: "neutral",
            },
            {
              id: "e2e-2-2",
              label: "暂且观望",
              description:
                "先不急着行动，观察守钟人的神色和铜钟的动向，等局面更明朗。",
              stance: "benevolent",
            },
          ],
        ),
        model: "deepseek-v4-flash",
        usage: { totalTokens: 900 },
      }),
    });
    assert.ok(secondResult.committedTurn, "选项差异警告不拒绝回合，第二轮应正常提交");
    savedAdventure = store.loadAdventure(started.sessionId);
    const savedSecond = savedAdventure.branchState.recentTurns.find(
      (turn) => turn.id === secondResult.committedTurn.id,
    );
    assert.ok(savedSecond, "第二轮回合应写入历史");
    const warnings = savedSecond.generatedOutput.warnings ?? [];
    assert.ok(
      warnings.some((warning) => warning.includes("选项高度相似")),
      "选项差异警告应随回合写入 generatedOutput",
    );
    assert.ok(
      warnings.some((warning) => warning.includes("第 2 回合")),
      "警告应指向上一轮回合编号（开局回合无候选项，第一轮提交为第 2 回合）",
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("gameTimeDayNext 协议校验：合法推进、回退拒绝、非法值拒绝、与 timeAdvance 冲突警告", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-daynext-protocol-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "日期协议测试");
    const adventure = store.loadAdventure(started.sessionId);

    function dayNextTurn(scene, sceneTransition) {
      return {
        ...statusesTestTurn(started, "event-daynext", scene),
        stateCommit: {
          ...statusesTestTurn(started, "event-daynext", scene).stateCommit,
          sceneTransition: {
            ...statusesTestTurn(started, "event-daynext", scene).stateCommit
              .sceneTransition,
            ...sceneTransition,
          },
        },
      };
    }

    // 场景 A：第 1 日 + gameTimeDayNext=5 → 通过且保留字段
    const valid = validateGeneratedTurn(
      dayNextTurn("旅人踏上了远路。", { gameTimeDayNext: 5 }),
      adventure,
      "daynext-valid",
    );
    assert.equal(valid.stateCommit.sceneTransition.gameTimeDayNext, 5);

    // 场景 B：gameTimeDayNext=3 + timeAdvance=one_day（推进 1 天）→ 冲突警告但通过
    const conflicted = validateGeneratedTurn(
      dayNextTurn("旅人继续赶路。", { gameTimeDayNext: 3, timeAdvance: "one_day" }),
      adventure,
      "daynext-conflict",
    );
    assert.ok(
      conflicted.warnings.some(
        (warning) =>
          warning.includes("gameTimeDayNext") && warning.includes("timeAdvance"),
      ),
      "gameTimeDayNext 与 timeAdvance 语义冲突必须产生 normalizationWarning",
    );
    assert.equal(conflicted.stateCommit.sceneTransition.gameTimeDayNext, 3);

    // 场景 C：gameTimeDayNext=2 + timeAdvance=one_day（语义一致）→ 无冲突警告
    const consistent = validateGeneratedTurn(
      dayNextTurn("旅人修整了一天。", { gameTimeDayNext: 2, timeAdvance: "one_day" }),
      adventure,
      "daynext-consistent",
    );
    assert.ok(
      !consistent.warnings.some(
        (warning) =>
          warning.includes("gameTimeDayNext") && warning.includes("timeAdvance"),
      ),
    );
    assert.equal(consistent.stateCommit.sceneTransition.gameTimeDayNext, 2);

    // 场景 D：gameTimeDayNext=5 + timeAdvance=several_days（约数日按 3 天计，实际 +4）→ 冲突警告
    const severalConflict = validateGeneratedTurn(
      dayNextTurn("旅人数日后抵达。", { gameTimeDayNext: 5, timeAdvance: "several_days" }),
      adventure,
      "daynext-several-conflict",
    );
    assert.ok(
      severalConflict.warnings.some(
        (warning) =>
          warning.includes("gameTimeDayNext") && warning.includes("timeAdvance"),
      ),
    );
    assert.equal(severalConflict.stateCommit.sceneTransition.gameTimeDayNext, 5);

    // 场景 E：gameTimeDayNext 回退（0 < 当前第 1 日）→ 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          dayNextTurn("时间倒流。", { gameTimeDayNext: 0 }),
          adventure,
          "daynext-rollback",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("gameTimeDayNext")),
    );

    // 场景 F：gameTimeDayNext 非整数 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          dayNextTurn("半天过去。", { gameTimeDayNext: 3.5 }),
          adventure,
          "daynext-fraction",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("gameTimeDayNext")),
    );

    // 场景 G：gameTimeDayNext 字符串 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          dayNextTurn("数日后。", { gameTimeDayNext: "3" }),
          adventure,
          "daynext-string",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("gameTimeDayNext")),
    );

    // 场景 H：与当前日相同的 gameTimeDayNext（不回退、不推进）→ 通过
    const sameDay = validateGeneratedTurn(
      dayNextTurn("旅人留在钟楼。", { gameTimeDayNext: 1 }),
      adventure,
      "daynext-same",
    );
    assert.equal(sameDay.stateCommit.sceneTransition.gameTimeDayNext, 1);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("规则 14 更新：提示词要求跨日剧情用 gameTimeDayNext 显式声明结束日期", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-rule14-daynext-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "规则 14 日期测试");
    const adventure = store.loadAdventure(started.sessionId);
    const messages = createStoryGenerationMessages({
      adventure,
      turnId: "next-turn-rule14",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    const systemPrompt = messages[0].content;
    assert.match(systemPrompt, /14\. 游戏内时间从第 1 日开始/);
    assert.match(systemPrompt, /gameTimeDayNext/);
    assert.match(systemPrompt, /时间短语与日期必须一致/);
    assert.match(systemPrompt, /不得正文写"次日"却不声明日期/);
    // sceneTransition 示例同样包含新字段说明
    assert.match(systemPrompt, /gameTimeDayNext.*跨日剧情必填/);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("规则 31：玩家言行最高优先级——最新言行高亮分区与历史言行模式标注", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-roleplay-weight-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "角色言行权重测试");

    // 回合 1：玩家以动作言行推进，历史回合写入 playerInput.roleplay
    const first = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "roleplay-weight-1",
        selectedChoiceId: "opening-neutral",
        roleplay: { mode: "action", content: "旅人推开门，仔细查看铜钟的纹路。" },
      }),
      createTurnId: () => "turn-roleplay-1",
      generate: async () => ({
        content: statusesTestTurn(
          started,
          "event-roleplay-1",
          "旅人查看铜钟的纹路，发现刻痕与失踪者名单一致。",
        ),
        model: "deepseek-v4-flash",
        usage: { totalTokens: 1000 },
      }),
    });
    assert.equal(first.committedTurn.sequence, 2);

    const adventure = store.loadAdventure(started.sessionId);
    const mixedRoleplay = {
      mode: "mixed",
      content: "旅人按住铜钟说道：“告诉我，是谁的名字刻在上面？”",
    };
    // 回合 2：mixed 言行 → latestPlayerRoleplay 高亮分区 + 规则 31
    const mixedMessages = createStoryGenerationMessages({
      adventure,
      turnId: "turn-roleplay-2",
      resolvedPlayerTurn: {
        playerInput: {
          selectedChoice: null,
          customChoice: null,
          roleplay: mixedRoleplay,
          storyDirection: null,
          effectiveStoryDirection: null,
        },
        displayMessage: `言行：${mixedRoleplay.content}`,
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    const systemPrompt = mixedMessages[0].content;
    assert.match(systemPrompt, /31\. 玩家角色言行/);
    assert.match(systemPrompt, /最高优先级的故事事实/);
    assert.match(systemPrompt, /严格承接玩家角色言行/);
    assert.match(systemPrompt, /必须回应其说的话/);
    assert.match(systemPrompt, /呈现该动作的结果/);
    assert.match(systemPrompt, /不得忽略、淡化或改写玩家角色言行/);
    assert.match(systemPrompt, /不得让剧情走向或后续剧本锚点覆盖玩家角色明确表达的行为/);
    assert.match(systemPrompt, /历史言行仍是角色关系、局势与人物记忆的依据/);
    assert.match(systemPrompt, /不得与已表达的行为前后矛盾/);

    const context = parseStoryContext(mixedMessages[1].content);
    // latestPlayerRoleplay 位于 context 顶部（第一个键）且与 playerInput.roleplay 一致
    assert.deepEqual(context.latestPlayerRoleplay, mixedRoleplay);
    assert.deepEqual(context.playerInput.roleplay, mixedRoleplay);
    assert.equal(Object.keys(context)[0], "latestPlayerRoleplay");
    // 历史回合言行 mode 标注：动作言行回合带 mode=action；开局无言行回合无 mode
    const actionTurnInput = context.recentTurns.find(
      (turn) => turn.sequence === 2,
    ).playerInput;
    assert.equal(actionTurnInput.mode, "action");
    assert.deepEqual(actionTurnInput.roleplay, {
      mode: "action",
      content: "旅人推开门，仔细查看铜钟的纹路。",
    });
    const openingTurnInput = context.recentTurns.find(
      (turn) => turn.sequence === 1,
    ).playerInput;
    assert.equal("mode" in openingTurnInput, false);
    // 诊断 sections 增加“最新玩家言行”条目
    const snapshot = createStoryGenerationPrompt({
      adventure,
      turnId: "turn-roleplay-2",
      resolvedPlayerTurn: {
        playerInput: {
          selectedChoice: null,
          customChoice: null,
          roleplay: mixedRoleplay,
          storyDirection: null,
          effectiveStoryDirection: null,
        },
        displayMessage: `言行：${mixedRoleplay.content}`,
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    }).snapshot;
    const roleplaySection = snapshot.diagnostics.sections.find(
      (section) => section.name === "最新玩家言行",
    );
    assert.equal(roleplaySection.itemCount, 1);
    assert.ok(roleplaySection.estimatedTokens > 0);

    // speech 言行
    const speechRoleplay = {
      mode: "speech",
      content: "旅人问守钟人：“钟为什么在逆流？”",
    };
    const speechContext = parseStoryContext(
      createStoryGenerationMessages({
        adventure,
        turnId: "turn-roleplay-speech",
        resolvedPlayerTurn: {
          playerInput: {
            selectedChoice: null,
            customChoice: null,
            roleplay: speechRoleplay,
            storyDirection: null,
            effectiveStoryDirection: null,
          },
          displayMessage: `说话：${speechRoleplay.content}`,
          effectiveStoryDirection: "",
          previousStoryDirection: "",
        },
      })[1].content,
    );
    assert.deepEqual(speechContext.latestPlayerRoleplay, speechRoleplay);
    assert.deepEqual(speechContext.playerInput.roleplay, speechRoleplay);

    // 无言行：latestPlayerRoleplay 字段省略，且诊断无对应条目
    const noRoleplayMessages = createStoryGenerationMessages({
      adventure,
      turnId: "turn-roleplay-none",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    const noRoleplayContext = parseStoryContext(noRoleplayMessages[1].content);
    assert.equal("latestPlayerRoleplay" in noRoleplayContext, false);
    const noRoleplaySnapshot = createStoryGenerationPrompt({
      adventure,
      turnId: "turn-roleplay-none",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    }).snapshot;
    assert.equal(
      noRoleplaySnapshot.diagnostics.sections.some(
        (section) => section.name === "最新玩家言行",
      ),
      false,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("取消标记置位时不提交回合，未取消正常提交，取消后重试幂等复用", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-cancel-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "中断测试",
      world: { name: "雾港", premise: "雾中灯塔每夜更换航线。" },
      player: { name: "船员", description: "追查旧航图的抄写员。" },
      mainCharacter: {
        name: "领航员",
        role: "灯塔看护",
        personality: "寡言。",
        firstMessage: "雾散了。",
      },
      openingScene: "船员在雾港登上灯塔。",
    });

    const generatedContent = {
      schemaVersion: "1.0",
      turn: {
        scene: "领航员调暗灯火，让船员看清旧航图上被涂改的航线。",
        events: [
          {
            id: "event-cancel-turn",
            type: "secret_revealed",
            summary: "领航员展示被涂改的旧航图。",
            characterIds: [started.playerCharacterId, started.mainCharacterId],
            locationId: "lighthouse-top",
          },
        ],
        dialogue: [],
      },
      decision: {
        context: "action_direction",
        prompt: "船员如何回应这份旧航图？",
        choices: [
          {
            id: "choice-deck",
            label: "照旧航行",
            description: "按涂改前的航线行驶。",
            stance: "neutral",
          },
          {
            id: "choice-shore",
            label: "靠岸盘问",
            description: "先找领航员问清涂改者。",
            stance: "benevolent",
          },
        ],
      },
      stateCommit: {
        sceneTransition: {
          locationId: "lighthouse-top",
          locationName: "灯塔顶部",
          locationDescription: "灯室在雾中缓慢转动。",
          presentCharacterIds: [
            started.playerCharacterId,
            started.mainCharacterId,
          ],
          reason: "两人在灯室内查看旧航图。",
          evidence: ["event-cancel-turn"],
        },
        characterStateChanges: [],
        relationshipChanges: [],
        characterCardChanges: [],
        worldBookChanges: [],
        storyDirectionEvaluation: null,
        summaryPatch: "领航员展示了被涂改的旧航图。",
      },
      warnings: [],
    };

    const input = parsePlayerTurnRequest({
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "cancel-turn-request",
      customChoice: "查看旧航图",
    });

    // 1) 生成完成后、提交前被取消：抛 TurnCancelledError 且不落库
    let cancelled = false;
    let generationCalls = 0;
    await assert.rejects(
      advanceAdventureTurn({
        store,
        sessionId: started.sessionId,
        input,
        isCancelled: () => cancelled,
        generate: async () => {
          generationCalls += 1;
          cancelled = true; // 模拟生成期间客户端中断
          return {
            content: generatedContent,
            model: "deepseek-test",
            usage: { totalTokens: 200 },
          };
        },
      }),
      (error) => error instanceof TurnCancelledError,
    );
    assert.equal(generationCalls, 1);
    const afterCancel = store.loadAdventure(started.sessionId);
    assert.equal(
      afterCancel.branchState.recentTurns.length,
      1,
      "取消后不应新增回合",
    );
    assert.equal(
      afterCancel.branchState.branch.headTurnId,
      started.openingTurnId,
      "取消后分支头不应移动",
    );

    // 2) 未取消：正常提交
    const result = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input,
      isCancelled: () => false,
      generate: async () => ({
        content: generatedContent,
        model: "deepseek-test",
        usage: { totalTokens: 200 },
      }),
    });
    assert.equal(result.committedTurn.sequence, 2);
    assert.equal(
      store.loadAdventure(started.sessionId).branchState.recentTurns.length,
      2,
    );

    // 3) 已提交后带取消标记重试：幂等返回既有回合，不重复生成也不抛错
    const retry = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input,
      isCancelled: () => true,
      generate: async () => {
        throw new Error("幂等重试不应再次调用模型");
      },
    });
    assert.equal(retry.committedTurn.id, result.committedTurn.id);
    assert.equal(retry.committedTurn.reused, true);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("innerThoughts 玩家内心想法协议校验：限长、随言行提交", () => {
  const parsed = parsePlayerTurnRequest({
    expectedHeadTurnId: null,
    idempotencyKey: "thought-request-1",
    selectedChoiceId: "opening-neutral",
    innerThoughts: "我其实很害怕，但不能让守钟人看出来。",
  });
  assert.equal(parsed.innerThoughts, "我其实很害怕，但不能让守钟人看出来。");
  // 超过 1000 字符截断
  const long = parsePlayerTurnRequest({
    expectedHeadTurnId: null,
    idempotencyKey: "thought-request-2",
    selectedChoiceId: "opening-neutral",
    innerThoughts: "想".repeat(1_200),
  });
  assert.equal(long.innerThoughts.length, 1_000);
  // 仅填想法不构成有效回合输入：仍需至少一个言行/选择/走向
  assert.throws(
    () =>
      parsePlayerTurnRequest({
        expectedHeadTurnId: null,
        idempotencyKey: "thought-request-3",
        innerThoughts: "只有想法。",
      }),
    PlayerTurnInputError,
  );
  // 空白想法被省略
  const empty = parsePlayerTurnRequest({
    expectedHeadTurnId: null,
    idempotencyKey: "thought-request-4",
    selectedChoiceId: "opening-neutral",
    innerThoughts: "   ",
  });
  assert.equal("innerThoughts" in empty, false);
});

test("turn.characterThoughts 输出校验：数量、长度与角色存在", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-thoughts-protocol-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "想法协议测试");
    const adventure = store.loadAdventure(started.sessionId);
    const base = statusesTestTurn(
      started,
      "event-thought-protocol",
      "守钟人看着镜面沉默。",
    );
    const withThoughts = (thoughts) => ({
      ...base,
      turn: { ...base.turn, characterThoughts: thoughts },
    });

    // 合法数组通过，且保持条数与内容
    const valid = validateGeneratedTurn(
      withThoughts([
        { characterId: started.mainCharacterId, content: "她开始怀疑旅人真正的来意。" },
        { characterId: started.playerCharacterId, content: "旅人没有说出全部实情。" },
      ]),
      adventure,
      "protocol-thought-1",
    );
    assert.equal(valid.turn.characterThoughts.length, 2);
    assert.equal(valid.turn.characterThoughts[0].characterId, started.mainCharacterId);
    assert.equal(valid.turn.characterThoughts[1].content, "旅人没有说出全部实情。");
    // 省略字段 → 空数组
    const omitted = validateGeneratedTurn(base, adventure, "protocol-thought-2");
    assert.deepEqual(omitted.turn.characterThoughts, []);
    // 超过 6 条 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withThoughts(
            Array.from({ length: 7 }, (_, i) => ({
              characterId: started.mainCharacterId,
              content: `想法${i}`,
            })),
          ),
          adventure,
          "protocol-thought-3",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => /6 条角色内心想法/.test(issue)),
    );
    // 不存在角色 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withThoughts([{ characterId: "ghost-char", content: "幽灵的想法。" }]),
          adventure,
          "protocol-thought-4",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => /不存在的角色/.test(issue)),
    );
    // 非数组 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(withThoughts("想法"), adventure, "protocol-thought-5"),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => /必须是数组/.test(issue)),
    );
    // 内容超长截断到 400 字符
    const longContent = validateGeneratedTurn(
      withThoughts([{ characterId: started.mainCharacterId, content: "内".repeat(500) }]),
      adventure,
      "protocol-thought-6",
    );
    assert.equal(longContent.turn.characterThoughts[0].content.length, 400);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("knownFacts 角色已知信息 patch 校验：结构、重复与限长", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-knownfacts-protocol-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "已知信息协议测试");
    const adventure = store.loadAdventure(started.sessionId);
    const base = statusesTestTurn(
      started,
      "event-knownfacts-protocol",
      "守钟人向旅人吐露了一个秘密。",
    );
    const withKnownFacts = (knownFacts) => ({
      ...base,
      stateCommit: {
        ...base.stateCommit,
        characterStateChanges: [
          {
            characterId: started.mainCharacterId,
            patch: { knownFacts },
            duration: "until_changed",
            reason: "角色获知了重要信息",
            evidence: ["event-knownfacts-protocol"],
          },
        ],
      },
    });
    // 非数组非 null → 拒绝
    assert.throws(
      () => validateGeneratedTurn(withKnownFacts("秘密"), adventure, "protocol-kf-1"),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => /必须是数组/.test(issue)),
    );
    // 重复 id → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withKnownFacts([
            { id: "fact-a", content: "铜钟的秘密。" },
            { id: "fact-a", content: "守钟人的名字。" },
          ]),
          adventure,
          "protocol-kf-2",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => /重复/.test(issue)),
    );
    // content 超过 300 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withKnownFacts([{ id: "fact-long", content: "长".repeat(301) }]),
          adventure,
          "protocol-kf-3",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => /300/.test(issue)),
    );
    // 缺少 id → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withKnownFacts([{ content: "没有 id 的信息。" }]),
          adventure,
          "protocol-kf-4",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => /id 不能为空/.test(issue)),
    );
    // null 清除全部 → 通过
    const cleared = validateGeneratedTurn(withKnownFacts(null), adventure, "protocol-kf-5");
    assert.equal(cleared.stateCommit.characterStateChanges[0].patch.knownFacts, null);
    // 合法数组 → 通过
    const valid = validateGeneratedTurn(
      withKnownFacts([
        { id: "fact-1", content: "铜钟在逆流时与失踪者名单对应。" },
        { id: "fact-2", content: "守钟人藏有侧门钥匙。" },
      ]),
      adventure,
      "protocol-kf-6",
    );
    assert.equal(valid.stateCommit.characterStateChanges[0].patch.knownFacts.length, 2);
    assert.equal(valid.stateCommit.characterStateChanges[0].patch.knownFacts[0].id, "fact-1");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("角色想法与已知信息端到端：登记物化、上下文注入与规则文本", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-knownfacts-e2e-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "已知信息测试");
    const eventId = "event-knownfacts-1";
    const turn1 = statusesTestTurn(started, eventId, "守钟人告诉旅人铜钟的秘密。");
    const first = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "knownfacts-e2e-1",
        innerThoughts: "我必须先赢得她的信任。",
        selectedChoiceId: "opening-neutral",
      }),
      createTurnId: () => "turn-knownfacts-1",
      generate: async () => ({
        content: {
          ...turn1,
          turn: {
            ...turn1.turn,
            characterThoughts: [
              { characterId: started.mainCharacterId, content: "旅人暂时可信，但还要观察。" },
            ],
          },
          stateCommit: {
            ...turn1.stateCommit,
            characterStateChanges: [
              {
                characterId: started.mainCharacterId,
                patch: {
                  knownFacts: [
                    { id: "fact-clock-secret", content: "铜钟在逆流时与失踪者名单对应。" },
                  ],
                },
                duration: "until_changed",
                reason: "守钟人向旅人说明了铜钟的秘密",
                evidence: [eventId],
              },
            ],
          },
        },
        model: "deepseek-v4-flash",
        usage: { totalTokens: 1000 },
      }),
    });
    assert.equal(first.committedTurn.sequence, 2);
    // NPC 想法随 turn 保存，玩家想法随 playerInput 保存
    const adventure = store.loadAdventure(started.sessionId);
    const firstOutput = adventure.branchState.recentTurns.at(-1).generatedOutput;
    assert.deepEqual(firstOutput.turn.characterThoughts, [
      { characterId: started.mainCharacterId, content: "旅人暂时可信，但还要观察。" },
    ]);
    assert.equal(
      adventure.branchState.recentTurns.at(-1).playerInput.innerThoughts,
      "我必须先赢得她的信任。",
    );
    // knownFacts 物化到 character_state
    const keeperState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.deepEqual(keeperState.state.knownFacts, [
      { id: "fact-clock-secret", content: "铜钟在逆流时与失踪者名单对应。" },
    ]);

    // 后续回合：上下文注入已知信息 + 历史 NPC 想法 + 玩家想法高亮 + 规则文本
    const messages = createStoryGenerationMessages({
      adventure,
      turnId: "turn-knownfacts-2",
      resolvedPlayerTurn: {
        playerInput: {
          selectedChoice: null,
          customChoice: "追问铜钟的来历",
          roleplay: null,
          innerThoughts: "她守口如瓶，但眼神里有破绽。",
          storyDirection: null,
          effectiveStoryDirection: null,
        },
        displayMessage: "自定义选择：追问铜钟的来历",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    const context = parseStoryContext(messages[1].content);
    // 玩家想法高亮区与 playerInput 同步
    assert.equal(context.latestPlayerInnerThoughts, "她守口如瓶，但眼神里有破绽。");
    assert.equal(context.playerInput.innerThoughts, "她守口如瓶，但眼神里有破绽。");
    // 角色目录注入已知信息（该角色已经知道的信息）
    const keeper = context.characterDirectory.find(
      (character) => character.id === started.mainCharacterId,
    );
    assert.deepEqual(keeper.knownFacts, [
      { id: "fact-clock-secret", content: "铜钟在逆流时与失踪者名单对应。" },
    ]);
    // 最近回合注入历史 NPC 想法
    const recent = context.recentTurns.find((turn) => turn.sequence === 2);
    assert.deepEqual(recent.characterThoughts, [
      { characterId: started.mainCharacterId, content: "旅人暂时可信，但还要观察。" },
    ]);
    // 规则 35/36/37 文本断言
    const systemPrompt = messages[0].content;
    assert.match(systemPrompt, /35\. 角色想法体系/);
    assert.match(systemPrompt, /仅玩家角色自己知道，其他角色（含 NPC）不可知/);
    assert.match(systemPrompt, /正文、对话、事件中不得直接写出他人想法/);
    assert.match(systemPrompt, /36\. 角色已知信息/);
    assert.match(systemPrompt, /该角色已经知道的信息/);
    assert.match(systemPrompt, /不得重复生成“首次获知\/得知该信息”的表述/);
    assert.match(systemPrompt, /按角色隔离/);
    assert.match(systemPrompt, /37\. 关系变化维度区分/);
    assert.match(systemPrompt, /不得笼统写“关系加深”/);
    // 诊断 sections 增加“最新玩家想法”条目（含保密标注）
    const snapshot = createStoryGenerationPrompt({
      adventure,
      turnId: "turn-knownfacts-2",
      resolvedPlayerTurn: {
        playerInput: {
          selectedChoice: null,
          customChoice: "追问铜钟的来历",
          roleplay: null,
          innerThoughts: "她守口如瓶，但眼神里有破绽。",
          storyDirection: null,
          effectiveStoryDirection: null,
        },
        displayMessage: "自定义选择：追问铜钟的来历",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    }).snapshot;
    assert.ok(
      snapshot.diagnostics.sections.some(
        (section) =>
          section.name.includes("最新玩家想法") &&
          section.name.includes("其他角色不可知"),
      ),
    );
    // 无玩家想法时 latestPlayerInnerThoughts 省略
    const noThoughtContext = parseStoryContext(
      createStoryGenerationMessages({
        adventure,
        turnId: "turn-knownfacts-3",
        resolvedPlayerTurn: {
          playerInput: {},
          displayMessage: "测试",
          effectiveStoryDirection: "",
          previousStoryDirection: "",
        },
      })[1].content,
    );
    assert.equal("latestPlayerInnerThoughts" in noThoughtContext, false);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("knownFacts 上下文预算：每角色最多 10 条、总字符约 1200、超出保留最近登记", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-knownfacts-budget-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "已知信息预算测试");
    const eventId = "event-knownfacts-budget";
    const turn1 = statusesTestTurn(started, eventId, "守钟人记下了许多事情。");
    // 13 条已知信息（超过注入上限；存储不限制条数，注入时做预算）
    const longFacts = Array.from({ length: 13 }, (_, i) => ({
      id: `fact-${i}`,
      content: `消息${i}：${"字".repeat(120)}`,
    }));
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "knownfacts-budget-1",
        selectedChoiceId: "opening-neutral",
      }),
      createTurnId: () => "turn-knownfacts-budget",
      generate: async () => ({
        content: {
          ...turn1,
          stateCommit: {
            ...turn1.stateCommit,
            characterStateChanges: [
              {
                characterId: started.mainCharacterId,
                patch: { knownFacts: longFacts },
                duration: "until_changed",
                reason: "角色登记了大量已知信息",
                evidence: [eventId],
              },
            ],
          },
        },
        model: "deepseek-v4-flash",
        usage: { totalTokens: 1000 },
      }),
    });
    const adventure = store.loadAdventure(started.sessionId);
    const context = parseStoryContext(
      createStoryGenerationMessages({
        adventure,
        turnId: "turn-knownfacts-budget-2",
        resolvedPlayerTurn: {
          playerInput: {},
          displayMessage: "测试",
          effectiveStoryDirection: "",
          previousStoryDirection: "",
        },
      })[1].content,
    );
    const keeper = context.characterDirectory.find(
      (character) => character.id === started.mainCharacterId,
    );
    // 每条 content 约 125 字符：10 条窗口 = 1250 > 1200 预算 → 保留最近 9 条
    assert.equal(keeper.knownFacts.length, 9);
    assert.equal(keeper.knownFacts[0].id, "fact-4");
    assert.equal(keeper.knownFacts.at(-1).id, "fact-12");

    // 短内容场景：窗口上限 10 条全部保留
    const shortFacts = Array.from({ length: 13 }, (_, i) => ({
      id: `short-${i}`,
      content: `短消息${i}`,
    }));
    const temporaryDirectory2 = mkdtempSync(join(tmpdir(), "ai-tavern-knownfacts-budget2-"));
    const database2 = openLocalDatabase({
      filePath: join(temporaryDirectory2, "story.sqlite"),
      migrationsDir,
    });
    try {
      const store2 = new LocalStoryStore(database2);
      const started2 = statusesAdventure(store2, "已知信息预算测试二");
      const turn2 = statusesTestTurn(started2, "event-knownfacts-budget-2", "守钟人记下了许多事情。");
      await advanceAdventureTurn({
        store: store2,
        sessionId: started2.sessionId,
        input: parsePlayerTurnRequest({
          expectedHeadTurnId: started2.openingTurnId,
          idempotencyKey: "knownfacts-budget-2",
          selectedChoiceId: "opening-neutral",
        }),
        createTurnId: () => "turn-knownfacts-budget-2",
        generate: async () => ({
          content: {
            ...turn2,
            stateCommit: {
              ...turn2.stateCommit,
              characterStateChanges: [
                {
                  characterId: started2.mainCharacterId,
                  patch: { knownFacts: shortFacts },
                  duration: "until_changed",
                  reason: "角色登记了大量短消息",
                  evidence: ["event-knownfacts-budget-2"],
                },
              ],
            },
          },
          model: "deepseek-v4-flash",
          usage: { totalTokens: 1000 },
        }),
      });
      const adventure2 = store2.loadAdventure(started2.sessionId);
      const context2 = parseStoryContext(
        createStoryGenerationMessages({
          adventure: adventure2,
          turnId: "turn-knownfacts-budget-3",
          resolvedPlayerTurn: {
            playerInput: {},
            displayMessage: "测试",
            effectiveStoryDirection: "",
            previousStoryDirection: "",
          },
        })[1].content,
      );
      const keeper2 = context2.characterDirectory.find(
        (character) => character.id === started2.mainCharacterId,
      );
      assert.equal(keeper2.knownFacts.length, 10);
      assert.equal(keeper2.knownFacts[0].id, "short-3");
      assert.equal(keeper2.knownFacts.at(-1).id, "short-12");
    } finally {
      database2.close();
      rmSync(temporaryDirectory2, { recursive: true, force: true });
    }
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("minorCharacterUpdates 校验：operation 枚举、name 限长与重复、字段限长", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-minor-protocol-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "次要人物协议测试");
    const adventure = store.loadAdventure(started.sessionId);
    const base = statusesTestTurn(
      started,
      "event-minor-protocol",
      "守钟人提起她的家人。",
    );
    const withUpdates = (updates) => ({
      ...base,
      stateCommit: { ...base.stateCommit, minorCharacterUpdates: updates },
    });

    // 非数组 → 拒绝
    assert.throws(
      () => validateGeneratedTurn(withUpdates("周正国"), adventure, "minor-0"),
      GeneratedTurnValidationError,
    );
    // 非法 operation → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withUpdates([{ operation: "delete", name: "周正国" }]),
          adventure,
          "minor-1",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("operation")),
    );
    // name 为空 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withUpdates([{ operation: "add", name: "" }]),
          adventure,
          "minor-2",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("name")),
    );
    // name 超过 40 字符 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withUpdates([{ operation: "add", name: "周".repeat(41) }]),
          adventure,
          "minor-3",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("40")),
    );
    // 同轮数组内 name 重复 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withUpdates([
            { operation: "add", name: "周正国" },
            { operation: "update", name: "周正国" },
          ]),
          adventure,
          "minor-4",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("重复")),
    );
    // relation 超过 80 字符 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withUpdates([
            { operation: "add", name: "周正国", relation: "关".repeat(81) },
          ]),
          adventure,
          "minor-5",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("relation")),
    );
    // description 超过 200 字符 → 拒绝
    assert.throws(
      () =>
        validateGeneratedTurn(
          withUpdates([
            { operation: "add", name: "周正国", description: "描".repeat(201) },
          ]),
          adventure,
          "minor-6",
        ),
      (error) =>
        error instanceof GeneratedTurnValidationError &&
        error.issues.some((issue) => issue.includes("description")),
    );
    // 缺省 → 空数组（名录保持不变）
    const omitted = validateGeneratedTurn(base, adventure, "minor-7");
    assert.deepEqual(omitted.stateCommit.minorCharacterUpdates, []);
    // 合法 add/update → 通过并规范化保留可选字段
    const valid = validateGeneratedTurn(
      withUpdates([
        { operation: "add", name: "周正国", relation: "主角二舅" },
        { operation: "update", name: "陈婆", description: "守钟人的邻居" },
      ]),
      adventure,
      "minor-8",
    );
    assert.deepEqual(valid.stateCommit.minorCharacterUpdates, [
      { operation: "add", name: "周正国", relation: "主角二舅" },
      { operation: "update", name: "陈婆", description: "守钟人的邻居" },
    ]);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("次要人物名录物化：add 建立实体、update 更新、重复 add 走更新语义并注入上下文", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-minor-e2e-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = statusesAdventure(store, "次要人物名录测试");

    // 第一回合：add 登记周正国
    const turn1 = {
      ...statusesTestTurn(started, "event-minor-1", "守钟人提到她的二舅。"),
      stateCommit: {
        ...statusesTestTurn(started, "event-minor-1", "守钟人提到她的二舅。").stateCommit,
        minorCharacterUpdates: [
          { operation: "add", name: "周正国", relation: "主角二舅" },
        ],
      },
    };
    const result1 = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "minor-turn-1",
        selectedChoiceId: "opening-neutral",
      }),
      createTurnId: () => "turn-minor-1",
      generate: async () => ({
        content: turn1,
        model: "deepseek-v4-flash",
        usage: { totalTokens: 1000 },
      }),
    });
    let adventure = store.loadAdventure(started.sessionId);
    let entry = adventure.branchState.states.find(
      (state) =>
        state.entityType === "minor_character" && state.entityId === "npc:周正国",
    );
    assert.ok(entry, "add 后应建立 minor_character 实体");
    assert.equal(entry.state.name, "周正国");
    assert.equal(entry.state.relation, "主角二舅");
    assert.equal(entry.state.firstMentionedTurnId, "turn-minor-1");
    assert.equal(entry.state.lastMentionedTurnId, "turn-minor-1");
    // 名录实体不进入可扮演角色目录
    const context1 = parseStoryContext(
      createStoryGenerationMessages({
        adventure,
        turnId: "turn-minor-2",
        resolvedPlayerTurn: {
          playerInput: {},
          displayMessage: "测试",
          effectiveStoryDirection: "",
          previousStoryDirection: "",
        },
      })[1].content,
    );
    assert.equal(
      context1.characterDirectory.some((character) => character.name === "周正国"),
      false,
    );
    assert.deepEqual(context1.minorCharacters, [
      { name: "周正国", relation: "主角二舅" },
    ]);
    assert.match(context1.minorCharacterNote, /沿用原名/);

    // 第二回合：update 补充关系信息
    const turn2 = {
      ...statusesTestTurn(started, "event-minor-2", "守钟人补充二舅的近况。"),
      stateCommit: {
        ...statusesTestTurn(started, "event-minor-2", "守钟人补充二舅的近况。").stateCommit,
        minorCharacterUpdates: [
          {
            operation: "update",
            name: "周正国",
            relation: "主角二舅，在城南卖布",
          },
        ],
      },
    };
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: result1.committedTurn.id,
        idempotencyKey: "minor-turn-2",
        customChoice: "继续听守钟人讲家事",
      }),
      createTurnId: () => "turn-minor-2",
      generate: async () => ({
        content: turn2,
        model: "deepseek-v4-flash",
        usage: { totalTokens: 1000 },
      }),
    });
    adventure = store.loadAdventure(started.sessionId);
    entry = adventure.branchState.states.find(
      (state) =>
        state.entityType === "minor_character" && state.entityId === "npc:周正国",
    );
    assert.equal(entry.state.relation, "主角二舅，在城南卖布");
    assert.equal(entry.state.firstMentionedTurnId, "turn-minor-1");
    assert.equal(entry.state.lastMentionedTurnId, "turn-minor-2");

    // 第三回合：重复 add 同 name（模型误用）→ 更新语义：firstMentioned 保留
    const turn3 = {
      ...statusesTestTurn(started, "event-minor-3", "守钟人再次提起二舅。"),
      stateCommit: {
        ...statusesTestTurn(started, "event-minor-3", "守钟人再次提起二舅。").stateCommit,
        minorCharacterUpdates: [
          { operation: "add", name: "周正国", relation: "主角二舅" },
        ],
      },
    };
    const result3 = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: "turn-minor-2",
        idempotencyKey: "minor-turn-3",
        customChoice: "继续听守钟人讲家事",
      }),
      createTurnId: () => "turn-minor-3",
      generate: async () => ({
        content: turn3,
        model: "deepseek-v4-flash",
        usage: { totalTokens: 1000 },
      }),
    });
    adventure = store.loadAdventure(started.sessionId);
    entry = adventure.branchState.states.find(
      (state) =>
        state.entityType === "minor_character" && state.entityId === "npc:周正国",
    );
    assert.equal(entry.state.firstMentionedTurnId, "turn-minor-1");
    assert.equal(entry.state.lastMentionedTurnId, "turn-minor-3");
    assert.equal(entry.state.relation, "主角二舅");

    // 后续回合上下文注入名录 + 规则 38 文本
    const snapshot = createStoryGenerationPrompt({
      adventure,
      turnId: "turn-minor-4",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "测试",
        effectiveStoryDirection: "",
        previousStoryDirection: "",
      },
    });
    assert.match(snapshot.snapshot.systemPrompt, /38\. 次要人物名录/);
    assert.match(snapshot.snapshot.systemPrompt, /重提已登记人物时必须沿用名录中的原名/);
    const context = parseStoryContext(snapshot.messages[1].content);
    assert.deepEqual(context.minorCharacters, [
      { name: "周正国", relation: "主角二舅" },
    ]);
    const minorSection = snapshot.snapshot.diagnostics.sections.find(
      (section) => section.name === "次要人物名录",
    );
    assert.ok(minorSection);
    assert.equal(minorSection.itemCount, 1);
    // 名录实体整体随状态变更审计保存
    assert.ok(
      result3.committedTurn &&
        store
          .loadAdventure(started.sessionId)
          .branchState.recentTurns.at(-1)
          .stateChanges.some(
            (change) =>
              change.entityType === "minor_character" &&
              change.entityId === "npc:周正国",
          ),
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("次要人物名录预算：超 2400 字符时先省略 relation 再截断并在诊断记录", () => {
  const mkState = (name, relation) => ({
    entityType: "minor_character",
    entityId: `npc:${name}`,
    state: { name, ...(relation ? { relation } : {}) },
    isActive: true,
    version: 1,
    updatedTurnId: "turn-x",
  });
  // 少量名录：全部保留 name + relation
  const small = collectMinorCharacters([
    mkState("周正国", "主角二舅"),
    mkState("陈婆", "守钟人邻居"),
  ]);
  assert.equal(small.droppedRelations, 0);
  assert.equal(small.droppedCharacters, 0);
  assert.deepEqual(small.characters, [
    { name: "周正国", relation: "主角二舅" },
    { name: "陈婆", relation: "守钟人邻居" },
  ]);
  // 大量名录（relation 很长）：总字符超预算 → 省略全部 relation 保留 name
  const longRelation = "关".repeat(80);
  const many = collectMinorCharacters(
    Array.from({ length: 40 }, (_, index) =>
      mkState(`人物${index}`, `${longRelation}${index}`),
    ),
  );
  assert.ok(many.droppedRelations > 0);
  assert.ok(many.characters.length > 0);
  assert.ok(
    many.characters.every((entry) => entry.relation === undefined),
    "超预算时必须省略 relation 只保留 name",
  );
  // 更多名录：连 name 也超预算 → 截断并记录 droppedCharacters
  const huge = collectMinorCharacters(
    Array.from({ length: 400 }, (_, index) => mkState(`超长名字人物${index}`)),
  );
  assert.ok(huge.droppedCharacters > 0);
  assert.ok(huge.characters.length < 400);
  assert.equal(
    huge.characters.length + huge.droppedCharacters,
    400,
    "截断只丢弃最早录入的人物，不重复计数",
  );
});

