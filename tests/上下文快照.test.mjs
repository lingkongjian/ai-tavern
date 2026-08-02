import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  exportCompleteAdventure,
  importCompleteAdventure,
} from "../lib/import/完整存档.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import { parsePlayerTurnRequest } from "../lib/story/回合协议.ts";
import {
  advanceAdventureTurn,
  regenerateLatestAdventureTurn,
} from "../lib/story/回合服务.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function generatedTurn({ turnId, playerId, mainCharacterId, locationId, scene }) {
  return {
    schemaVersion: "1.0.0",
    turn: {
      scene,
      events: [
        {
          id: `event-${turnId}`,
          type: "conversation_advanced",
          summary: "玩家向林听雪追问来意，她谨慎地给出回应。",
          characterIds: [playerId, mainCharacterId],
          locationId,
        },
      ],
      dialogue: [
        {
          id: `dialogue-${turnId}`,
          speakerId: mainCharacterId,
          content: "你若真想知道，就先告诉我你愿意承担什么。",
          addressedCharacterIds: [playerId],
        },
      ],
    },
    decision: {
      context: "proposal_response",
      prompt: "你如何回应林听雪的试探？",
      choices: [
        {
          id: `accept-${turnId}`,
          label: "坦诚接受",
          description: "接受她的条件并说明自己的底线。",
          stance: "accept",
        },
        {
          id: `partial-${turnId}`,
          label: "只说一半",
          description: "只透露足以继续谈判的部分。",
          stance: "partial_accept",
        },
        {
          id: `reject-${turnId}`,
          label: "拒绝试探",
          description: "要求她先说明自己的真实目的。",
          stance: "reject",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId,
        locationName: "听雪阁",
        locationDescription: "临湖的安静阁楼。",
        presentCharacterIds: [playerId, mainCharacterId],
        reason: "对话结束时两人仍留在阁中。",
        evidence: [`event-${turnId}`],
      },
      characterStateChanges: [],
      relationshipChanges: [],
      characterCardChanges: [],
      worldBookChanges: [],
      storyDirectionEvaluation: {
        status: "active",
        reason: "玩家仍在查明林听雪的来意。",
        evidence: [],
        continuity: "uncertain",
        continuityReason: "本轮尚未完成当前目标。",
        recommendedModuleId: null,
        suggestedNextDirection: null,
      },
      summaryPatch: "玩家追问林听雪的来意，她用条件反问并保持警惕。",
    },
    warnings: [],
  };
}

test("保存实际 DeepSeek 上下文、覆盖诊断并随重新生成和完整存档更新", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-context-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "听雪旧事",
      world: { name: "临湖城", premise: "旧盟约正在重新牵动城中各方。" },
      player: { name: "沈砚", description: "由玩家控制的成年游侠。" },
      mainCharacter: {
        name: "林听雪",
        role: "听雪阁主人",
        personality: "克制、敏锐，不会在信任不足时轻易交底。",
      },
      sourceDocuments: [
        {
          name: "听雪旧事原文",
          fileName: "听雪旧事.txt",
          content:
            "第一章 听雪阁\n林听雪没有立刻答应。她先观察沈砚的神色，随后用一句看似平静的反问试探他的底线。她说话克制，从不在证据不足时交出全部真相。",
          enabled: true,
          currentChapter: 1,
          preventFuture: true,
          fidelity: "faithful",
        },
      ],
      openingLocationName: "听雪阁",
      openingScene: "沈砚在雨夜进入听雪阁，林听雪隔着茶案看向他。",
      initialStoryDirection: "查明林听雪此番邀约的真实目的。",
    });
    const opening = store.loadAdventure(started.sessionId);
    const locationId = opening.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    ).state.currentLocationId;
    const capturedRequests = [];
    const turnId = "context-turn-2";
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "context-request-2",
        roleplay: { mode: "speech", content: "林听雪，你为何邀我来此？" },
      }),
      createTurnId: () => turnId,
      generate: async (messages) => {
        capturedRequests.push(structuredClone(messages));
        return {
          content: generatedTurn({
            turnId,
            playerId: started.playerCharacterId,
            mainCharacterId: started.mainCharacterId,
            locationId,
            scene: "林听雪没有直接回答，而是先追问沈砚愿意付出什么。",
          }),
          model: "deepseek-test",
          usage: { promptTokens: 1234, completionTokens: 321, totalTokens: 1555 },
        };
      },
    });

    const snapshot = store.loadTurnContextSnapshot(started.sessionId, turnId);
    const sentContext = JSON.parse(capturedRequests[0][1].content.split("\n").slice(1).join("\n"));
    assert.deepEqual(snapshot.context, sentContext);
    assert.deepEqual(snapshot.messages, capturedRequests[0]);
    assert.equal(snapshot.model, "deepseek-test");
    assert.equal(snapshot.promptTokens, 1234);
    assert.equal(snapshot.requestCount, 1);
    assert.equal(snapshot.repairApplied, false);
    assert.equal(snapshot.context.sourceReferences.length > 0, true);
    const coverage = snapshot.diagnostics.characterCoverage.find(
      (item) => item.characterId === started.mainCharacterId,
    );
    assert.equal(coverage.cardIncluded, true);
    assert.equal(coverage.stateIncluded, true);
    assert.equal(coverage.sourceReferenceCount > 0, true);
    assert.equal(coverage.level, "card_and_source");

    const feedback = "她的回答仍然太直接，请让她继续保持戒心并先试探玩家。";
    let regenerationCalls = 0;
    await regenerateLatestAdventureTurn({
      store,
      sessionId: started.sessionId,
      expectedHeadTurnId: turnId,
      actionId: "context-regenerate-1",
      feedback,
      generate: async () => {
        regenerationCalls += 1;
        if (regenerationCalls === 1) {
          return {
            content: { schemaVersion: "1.0.0", broken: true },
            model: "deepseek-test-broken",
            usage: { promptTokens: 500, completionTokens: 30, totalTokens: 530 },
          };
        }
        return {
          content: generatedTurn({
            turnId,
            playerId: started.playerCharacterId,
            mainCharacterId: started.mainCharacterId,
            locationId,
            scene: "林听雪垂眼拨开茶沫，只反问沈砚是否愿意先交出一条情报。",
          }),
          model: "deepseek-test-regenerated",
          usage: { promptTokens: 1400, completionTokens: 330, totalTokens: 1730 },
        };
      },
    });
    const regenerated = store.loadTurnContextSnapshot(started.sessionId, turnId);
    assert.equal(regenerated.model, "deepseek-test-regenerated");
    assert.equal(regenerated.messages.some((message) => message.content.includes(feedback)), true);
    assert.equal(regenerated.messages.at(-1).content.includes("上一个 JSON 未通过校验"), true);
    assert.equal(regenerated.promptTokens, 1900);
    assert.equal(regenerated.requestCount, 2);
    assert.equal(regenerated.repairApplied, true);

    const archive = exportCompleteAdventure(database, started.sessionId);
    assert.equal(archive.schemaVersion, "1.7.0");
    assert.equal(archive.data.turn_context_snapshots.length, 1);
    const imported = importCompleteAdventure(database, archive);
    const importedAdventure = store.loadAdventure(imported.sessionId);
    const importedTurn = importedAdventure.branchState.turnHistory.find(
      (item) => item.sequence === 2,
    );
    const importedSnapshot = store.loadTurnContextSnapshot(
      imported.sessionId,
      importedTurn.id,
    );
    assert.equal(importedSnapshot.model, "deepseek-test-regenerated");
    assert.equal(importedSnapshot.context.nextTurnId, importedTurn.id);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
