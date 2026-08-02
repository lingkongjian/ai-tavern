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

function generatedCompletion(input) {
  const eventId = `event-${input.turnId}`;
  return {
    schemaVersion: "1.0.0",
    turn: {
      scene: input.scene,
      events: [
        {
          id: eventId,
          type: "objective_completed",
          summary: input.summary,
          characterIds: [input.playerId, input.mainCharacterId],
          locationId: "archive-room",
        },
      ],
      dialogue: [],
    },
    decision: {
      context: "action_direction",
      prompt: "接下来准备怎样行动？",
      choices: [
        {
          id: `good-${input.turnId}`,
          label: "保护证人",
          description: "先确保关键证人的安全。",
          stance: "benevolent",
        },
        {
          id: `neutral-${input.turnId}`,
          label: "核验证据",
          description: "整理现有线索后再行动。",
          stance: "neutral",
        },
        {
          id: `evil-${input.turnId}`,
          label: "利用线索",
          description: "把秘密变成谈判筹码。",
          stance: "malicious",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId: "archive-room",
        locationName: "旧档案室",
        locationDescription: "封存旧案卷与证物的石室。",
        presentCharacterIds: [input.playerId, input.mainCharacterId],
        reason: "两人仍在档案室核对刚取得的证据。",
        evidence: [eventId],
      },
      characterStateChanges: [],
      relationshipChanges: [],
      characterCardChanges: [],
      worldBookChanges: [],
      storyDirectionEvaluation: input.evaluation(eventId),
      summaryPatch: input.summary,
    },
    warnings: [],
  };
}

test("完成当前目标后按连续性接续预埋任务或自动生成新目标，并容错冲突输出", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-story-chain-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const scripted = store.startAdventure({
      campaignName: "档案任务链",
      world: { name: "纸城", premise: "被记录的句子会短暂影响现实。" },
      player: { name: "记录员", description: "调查失踪档案的新人。" },
      mainCharacter: {
        name: "守夜人",
        role: "档案馆守夜人",
        personality: "谨慎并重视证据。",
      },
      openingScene: "记录员与守夜人在旧档案室核对失踪记录。",
      initialStoryDirection: "找到失踪者真实存在的证据。",
      initialStoryModuleId: "verify-record",
      storyModules: [
        {
          id: "verify-record",
          title: "核验档案",
          objective: "找到失踪者真实存在的证据。",
          completionCriteria: ["取得可复核的外部证据"],
          prerequisiteModuleIds: [],
        },
        {
          id: "protect-witness",
          title: "保护外街证人",
          objective: "在档案改写前找到并保护外街证人。",
          completionCriteria: ["证人已离开危险区域"],
          activationConditions: ["外街证人仍然存活并可被找到"],
          prerequisiteModuleIds: ["verify-record"],
          continuityNotes: "玩家仍在调查同一失踪案。",
        },
      ],
    });
    const scriptedTurnId = "scripted-chain-turn";
    const scriptedResult = await advanceAdventureTurn({
      store,
      sessionId: scripted.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: scripted.openingTurnId,
        idempotencyKey: "scripted-chain-action",
        roleplay: { mode: "action", content: "记录员核对并封存外部证物。" },
      }),
      createTurnId: () => scriptedTurnId,
      generate: async () => ({
        content: generatedCompletion({
          turnId: scriptedTurnId,
          playerId: scripted.playerCharacterId,
          mainCharacterId: scripted.mainCharacterId,
          scene: "外部证物证明失踪者确实存在，并指向尚在外街的证人。",
          summary: "核验完成，外街证人成为后续线索。",
          evaluation: (eventId) => ({
            status: "completed",
            reason: "已经取得可复核的外部证据。",
            evidence: [eventId],
            continuity: "aligned",
            continuityReason: "玩家仍在调查同一失踪案，新证据直接指向预埋的外街证人。",
            recommendedModuleId: "protect-witness",
            suggestedNextDirection: {
              title: "临时备选目标",
              content: "这个字段应被有效的预埋任务覆盖。",
              reason: "模拟模型错误地同时填写两个互斥字段。",
            },
          }),
        }),
        model: "deepseek-test",
        usage: { totalTokens: 800 },
      }),
    });

    const scriptedDirection = scriptedResult.adventure.branchState.states.find(
      (state) => state.entityType === "story_direction" && state.isActive,
    );
    const scriptedModules = new Map(
      scriptedResult.adventure.branchState.states
        .filter((state) => state.entityType === "story_module")
        .map((state) => [state.state.moduleId, state.state]),
    );
    assert.equal(scriptedDirection.state.moduleId, "protect-witness");
    assert.equal(scriptedDirection.state.source, "script_module");
    assert.match(scriptedDirection.state.content, /保护外街证人/);
    assert.equal(scriptedModules.get("verify-record").status, "completed");
    assert.equal(scriptedModules.get("protect-witness").status, "active");
    const scriptedGeneratedOutput = scriptedResult.adventure.branchState.recentTurns.find(
      (turn) => turn.id === scriptedTurnId,
    )?.generatedOutput;
    assert.match(
      JSON.stringify(scriptedGeneratedOutput?.warnings),
      /优先采用满足条件的预埋任务/,
    );

    const free = store.startAdventure({
      campaignName: "自由后续目标",
      world: { name: "雾港", premise: "潮汐会显露被遗忘的名字。" },
      player: { name: "抄写员", description: "保存城市记忆的外乡人。" },
      mainCharacter: {
        name: "守潮人",
        role: "雾港守潮人",
        personality: "克制、务实。",
      },
      openingScene: "抄写员正在整理最后一册潮汐记录。",
      initialStoryDirection: "取得完整的潮汐名册。",
    });
    const freeTurnId = "free-chain-turn";
    const freeResult = await advanceAdventureTurn({
      store,
      sessionId: free.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: free.openingTurnId,
        idempotencyKey: "free-chain-action",
        roleplay: { mode: "action", content: "抄写员完成最后一页拓印。" },
      }),
      createTurnId: () => freeTurnId,
      generate: async () => ({
        content: generatedCompletion({
          turnId: freeTurnId,
          playerId: free.playerCharacterId,
          mainCharacterId: free.mainCharacterId,
          scene: "最后一页拓印归入名册，港口议会的人已在门外等待。",
          summary: "完整名册形成，它的归属成为新冲突。",
          evaluation: (eventId) => ({
            status: "completed",
            reason: "完整潮汐名册已经形成。",
            evidence: [eventId],
            continuity: "diverged",
            continuityReason: "没有可用的预埋剧本任务，后续需沿当前争夺自然生长。",
            recommendedModuleId: "not-a-ready-module",
            suggestedNextDirection: {
              title: "名册归属",
              content: "决定潮汐名册的归属，并应对港口议会的争夺。",
              reason: "名册已完成，其归属是当前已发生剧情产生的直接问题。",
            },
          }),
        }),
        model: "deepseek-test",
        usage: { totalTokens: 760 },
      }),
    });

    const freeDirection = freeResult.adventure.branchState.states.find(
      (state) => state.entityType === "story_direction" && state.isActive,
    );
    assert.equal(freeDirection.state.source, "automatic");
    assert.equal(freeDirection.state.title, "名册归属");
    assert.match(freeDirection.state.content, /港口议会/);
    const freeGeneratedOutput = freeResult.adventure.branchState.recentTurns.find(
      (turn) => turn.id === freeTurnId,
    )?.generatedOutput;
    assert.match(
      JSON.stringify(freeGeneratedOutput?.warnings),
      /忽略不可接续的预埋任务/,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
