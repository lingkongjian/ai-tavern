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
  normalizeGeneratedTurnVersion,
  parsePlayerTurnRequest,
  validateGeneratedTurn,
} from "../lib/story/回合协议.ts";
import {
  advanceAdventureTurn,
  collectDivergenceSignals,
} from "../lib/story/回合服务.ts";
import { parseCharacterManagementInput } from "../lib/story/人物管理.ts";

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
