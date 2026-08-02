import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import { parsePlayerTurnRequest } from "../lib/story/回合协议.ts";
import { advanceAdventureTurn } from "../lib/story/回合服务.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function choices(context, prefix) {
  if (context === "proposal_response") {
    return [
      {
        id: `${prefix}-accept`,
        label: "完全接受",
        description: "接受对方提出的全部条件。",
        stance: "accept",
      },
      {
        id: `${prefix}-partial`,
        label: "部分接受",
        description: "只接受其中可以承担的部分。",
        stance: "partial_accept",
      },
      {
        id: `${prefix}-reject`,
        label: "明确拒绝",
        description: "拒绝条件并承担相应后果。",
        stance: "reject",
      },
    ];
  }
  return [
    {
      id: `${prefix}-good`,
      label: "保护无辜",
      description: "优先避免他人受到伤害。",
      stance: "benevolent",
    },
    {
      id: `${prefix}-neutral`,
      label: "收集线索",
      description: "保持谨慎并继续观察。",
      stance: "neutral",
    },
    {
      id: `${prefix}-evil`,
      label: "利用弱点",
      description: "把当前局面转化为自己的筹码。",
      stance: "malicious",
    },
  ];
}

function generatedTurn(input) {
  const eventId = `event-multi-${input.number}`;
  const dialogueId = `dialogue-multi-${input.number}`;
  return {
    schemaVersion: "1.0.0",
    turn: {
      scene: input.scene,
      events: [
        {
          id: eventId,
          type: input.eventType ?? "story_advanced",
          summary: input.summary,
          characterIds: [input.playerId, input.mainCharacterId],
          locationId: "tide-archive",
        },
      ],
      dialogue: [
        {
          id: dialogueId,
          speakerId: input.mainCharacterId,
          content: input.dialogue,
          addressedCharacterIds: [input.playerId],
        },
      ],
    },
    decision: {
      context: input.context,
      prompt:
        input.context === "proposal_response"
          ? "你是否接受守潮人的条件？"
          : "你准备怎样推进调查？",
      choices: choices(input.context, `turn-${input.number}`),
    },
    stateCommit: {
      sceneTransition: {
        locationId: "tide-archive",
        locationName: "潮汐档案馆",
        locationDescription: "存放港口姓名与潮汐记录的封闭档案馆。",
        presentCharacterIds: [input.playerId, input.mainCharacterId],
        reason: "本轮结束时，抄写员和守潮人仍在档案馆中。",
        evidence: [eventId],
      },
      characterStateChanges: input.characterStateChanges?.(eventId) ?? [],
      relationshipChanges: input.relationshipChanges?.(dialogueId) ?? [],
      characterCardChanges:
        input.characterCardChanges?.(eventId, input.turnId) ?? [],
      worldBookChanges: input.worldBookChanges?.(eventId, input.turnId) ?? [],
      storyDirectionEvaluation:
        input.directionStatus === "completed"
          ? {
              status: "completed",
              reason: "剧情中已经取得了能够完成目标的潮汐名册。",
              evidence: [eventId],
              continuity: "uncertain",
              continuityReason: "自由模式没有预埋剧本任务可接续。",
              recommendedModuleId: null,
              suggestedNextDirection: {
                title: "名册归属",
                content: "决定如何使用完整潮汐名册，并处理港口议会对名册的争夺。",
                reason: "取得名册后，它的归属成为当前剧情最直接的新冲突。",
              },
            }
          : input.directionStatus === "active"
            ? {
                status: "active",
                reason: "目标仍在推进，尚未由已经发生的剧情完成。",
                evidence: [],
                continuity: "uncertain",
                continuityReason: "自由模式没有预埋剧本任务可供比较。",
                recommendedModuleId: null,
                suggestedNextDirection: null,
              }
            : null,
      summaryPatch: input.summary,
    },
    warnings: [],
  };
}

test("supports a seven-turn local story with choices, directions and evolving state", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-multi-turn-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "潮汐名册",
      world: {
        name: "回声港",
        premise: "每次退潮，港口都会遗忘一个人的名字。",
      },
      player: { name: "抄写员", description: "负责保存居民姓名的外乡人。" },
      mainCharacter: {
        name: "守潮人",
        role: "港口守潮人",
        personality: "克制、务实，会用交易检验他人。",
        firstMessage: "若想留下名字，就先证明它值得被记住。",
      },
      openingScene: "抄写员在退潮前抵达封闭的潮汐档案馆。",
      initialStoryDirection: "查明港口遗忘姓名的原因。",
    });

    let headTurnId = started.openingTurnId;
    const runTurn = async (number, request, output) => {
      const turnId = `multi-turn-${number}`;
      const result = await advanceAdventureTurn({
        store,
        sessionId: started.sessionId,
        input: parsePlayerTurnRequest({
          expectedHeadTurnId: headTurnId,
          idempotencyKey: `multi-request-${number}`,
          ...request,
        }),
        createTurnId: () => turnId,
        generate: async () => ({
          content: generatedTurn({
            number,
            turnId,
            playerId: started.playerCharacterId,
            mainCharacterId: started.mainCharacterId,
            ...output,
          }),
          model: "deepseek-v4-flash",
          usage: {
            promptTokens: 800 + number,
            completionTokens: 200,
            totalTokens: 1000 + number,
          },
        }),
      });
      headTurnId = result.committedTurn.id;
      return result;
    };

    await runTurn(
      2,
      { selectedChoiceId: "opening-benevolent" },
      {
        scene: "抄写员先替门外老人补写姓名，守潮人因此打开了档案馆。",
        summary: "抄写员帮助老人保住姓名，获准进入档案馆。",
        dialogue: "我可以让你进去，但你必须把看到的名字交给我。",
        context: "proposal_response",
        directionStatus: "active",
        characterStateChanges: (eventId) => [
          {
            characterId: started.mainCharacterId,
            patch: { mood: "谨慎认可", currentGoal: "检验抄写员的动机" },
            duration: "until_changed",
            reason: "守潮人看见抄写员主动帮助居民",
            evidence: [eventId],
          },
        ],
        relationshipChanges: (dialogueId) => [
          {
            sourceCharacterId: started.playerCharacterId,
            targetCharacterId: started.mainCharacterId,
            dimension: "trust",
            delta: 6,
            reason: "守潮人给出了进入档案馆的机会",
            evidence: [dialogueId],
          },
        ],
      },
    );

    await runTurn(
      3,
      {
        selectedChoiceId: "turn-2-accept",
        storyDirection: "赢得守潮人的信任并取得潮汐名册。",
      },
      {
        scene: "抄写员接受条件，守潮人交出一枚开启内库的盐晶钥匙。",
        summary: "双方达成交易，抄写员取得内库钥匙。",
        dialogue: "从现在起，我会记住你是否守约。",
        context: "proposal_response",
        directionStatus: "active",
        characterCardChanges: (eventId, turnId) => [
          {
            characterId: started.mainCharacterId,
            operation: "add",
            path: "beliefs",
            value: ["抄写员愿意为承诺承担风险"],
            reason: "双方达成了会影响后续判断的正式交易",
            evidence: [eventId],
            sourceTurnId: turnId,
          },
        ],
      },
    );

    await runTurn(
      4,
      {
        selectedChoiceId: "turn-3-partial",
        storyDirection: "",
      },
      {
        scene: "抄写员只交出名册的空白页，并发现退潮会把名字刻进盐墙。",
        summary: "抄写员部分履约，确认盐墙会记录被遗忘的名字。",
        dialogue: "你保留了一半筹码；我也只会给你一半答案。",
        context: "proposal_response",
        directionStatus: null,
        worldBookChanges: (eventId, turnId) => [
          {
            operation: "update",
            targetEntryId: "world-core",
            patch: {
              content: "每次退潮，港口会遗忘一个姓名；被遗忘的名字会刻进档案馆盐墙。",
            },
            sourceTurnId: turnId,
            reason: "盐墙规则已被抄写员亲眼确认",
            evidence: [eventId],
          },
        ],
      },
    );

    await runTurn(
      5,
      {
        selectedChoiceId: "turn-4-reject",
        storyDirection: "找到并带走完整的潮汐名册。",
      },
      {
        scene: "抄写员拒绝交出剩余页，转身进入正在渗水的内库。",
        summary: "抄写员拒绝继续交易并独自进入内库。",
        dialogue: "拒绝之后，内库不会再把你当作客人。",
        context: "action_direction",
        directionStatus: "active",
        relationshipChanges: (dialogueId) => [
          {
            sourceCharacterId: started.playerCharacterId,
            targetCharacterId: started.mainCharacterId,
            dimension: "hostility",
            delta: 12,
            reason: "抄写员公开拒绝继续履行交易",
            evidence: [dialogueId],
          },
        ],
      },
    );

    await runTurn(
      6,
      {
        customChoice: "用空白名册拓印盐墙上的全部姓名",
        roleplay: {
          mode: "mixed",
          content: "抄写员铺开纸页说：这次由我来记住他们。",
        },
        storyDirection: "找到并带走完整的潮汐名册。",
      },
      {
        scene: "盐墙上的姓名同时浮现，拓印汇成一册完整名册落入抄写员手中。",
        summary: "抄写员完成盐墙拓印并取得完整潮汐名册。",
        dialogue: "你带走的不只是名字，还有整座港口欠下的记忆。",
        context: "action_direction",
        directionStatus: "completed",
        worldBookChanges: (eventId, turnId) => [
          {
            operation: "create",
            entry: {
              keys: ["潮汐名册", "盐墙拓印"],
              content: "完整潮汐名册由盐墙上历次被遗忘的姓名拓印汇成。",
              enabled: true,
            },
            sourceTurnId: turnId,
            reason: "名册的来源和形态已经成为持续事实",
            evidence: [eventId],
          },
        ],
      },
    );

    const finalTurn = await runTurn(
      7,
      { selectedChoiceId: "turn-6-evil" },
      {
        scene: "抄写员藏起名册副本，利用其中的姓名迫使港口议会为自己开门。",
        summary: "抄写员把姓名记录变成了与议会谈判的筹码。",
        dialogue: "你救回了名字，也学会了怎样用它们掌控别人。",
        context: "action_direction",
        directionStatus: null,
      },
    );

    const adventure = finalTurn.adventure;
    assert.equal(adventure.branchState.recentTurns.length, 7);
    assert.equal(adventure.branchState.turnHistory.length, 7);
    assert.equal(adventure.branchState.branch.headTurnId, "multi-turn-7");

    const selectedStances = adventure.branchState.recentTurns
      .slice(2, 5)
      .map((turn) => turn.playerInput.selectedChoice?.stance);
    assert.deepEqual(selectedStances, ["accept", "partial_accept", "reject"]);

    const customTurn = adventure.branchState.recentTurns.find(
      (turn) => turn.id === "multi-turn-6",
    );
    assert.equal(
      customTurn.playerInput.customChoice,
      "用空白名册拓印盐墙上的全部姓名",
    );
    assert.equal(customTurn.playerInput.roleplay.mode, "mixed");
    assert.equal(customTurn.generation.totalTokens, 1006);

    const cancelledDirectionTurn = adventure.branchState.recentTurns.find(
      (turn) => turn.id === "multi-turn-4",
    );
    assert.equal(
      cancelledDirectionTurn.stateChanges.some(
        (change) =>
          change.entityType === "story_direction" &&
          change.operation === "deactivate",
      ),
      true,
    );

    const completedDirection = adventure.branchState.states.find(
      (state) => state.entityType === "story_direction",
    );
    assert.equal(completedDirection.isActive, true);
    assert.equal(completedDirection.state.status, "active");
    assert.equal(completedDirection.state.source, "automatic");
    assert.match(completedDirection.state.content, /潮汐名册/);
    const completionTurn = adventure.branchState.recentTurns.find(
      (turn) => turn.id === "multi-turn-6",
    );
    assert.equal(
      completionTurn.stateChanges.some(
        (change) =>
          change.entityType === "story_direction" &&
          change.payload.status === "completed",
      ),
      true,
    );

    const evolution = adventure.branchState.states.find(
      (state) => state.entityType === "character_card_evolution",
    );
    assert.deepEqual(evolution.state.beliefs, ["抄写员愿意为承诺承担风险"]);

    const baseWorld = adventure.branchState.states.find(
      (state) => state.entityId === "world-core",
    );
    const worldOverlay = adventure.branchState.states.find(
      (state) => state.state.shadowsEntryId === "world-core",
    );
    const createdWorldEntry = adventure.branchState.states.find(
      (state) => state.state.content?.includes("完整潮汐名册由盐墙"),
    );
    assert.equal(baseWorld.state.content, "每次退潮，港口都会遗忘一个人的名字。");
    assert.match(worldOverlay.state.content, /名字会刻进档案馆盐墙/);
    assert.equal(createdWorldEntry.state.layer, "session_overlay");

    const generatedTurns = adventure.branchState.recentTurns.slice(1);
    assert.equal(generatedTurns.every((turn) => turn.generation), true);
    assert.equal(
      generatedTurns.reduce((sum, turn) => sum + turn.generation.totalTokens, 0),
      6027,
    );
    assert.equal(
      generatedTurns.every((turn) => turn.stateChanges.length > 0),
      true,
    );

    const compactState = store.loadBranchState(started.branchId, 2);
    assert.equal(compactState.recentTurns.length, 2);
    assert.equal(compactState.turnHistory.length, 7);
    const historicalTurn = store.loadTurn(started.branchId, "multi-turn-2");
    assert.equal(historicalTurn.sequence, 2);
    assert.equal(historicalTurn.generation.totalTokens, 1002);
    assert.match(historicalTurn.generatedOutput.turn.scene, /替门外老人补写姓名/);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
