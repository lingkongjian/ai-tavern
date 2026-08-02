import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  BranchHeadConflictError,
  LocalStoryStore,
} from "../lib/storage/story-store.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

test("persists an atomic turn and restores materialized state", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-storage-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({
    filePath: databasePath,
    migrationsDir,
  });

  try {
    let store = new LocalStoryStore(database);
    const { campaignId } = store.createCampaign({ name: "北境测试" });
    const { sessionId, branchId } = store.createSession({
      campaignId,
      name: "第一幕",
    });

    const firstTurn = store.commitTurn({
      sessionId,
      branchId,
      expectedHeadTurnId: null,
      idempotencyKey: "turn-request-1",
      playerInput: {
        roleplay: { mode: "action", content: "玩家赶往北门。" },
      },
      generatedOutput: { schemaVersion: "1.0.0", scene: "北门爆发战斗。" },
      summaryPatch: "玩家抵达北门并卷入战斗。",
      messages: [
        {
          id: "message-1",
          role: "narrator",
          content: "城墙在爆炸中震颤。",
          metadata: {
            model: "deepseek-v4-flash",
            promptTokens: 320,
            completionTokens: 80,
            totalTokens: 400,
          },
        },
      ],
      events: [
        {
          id: "event-1",
          eventType: "battle_started",
          summary: "北门爆发战斗",
          locationId: "north-gate",
          characterIds: ["captain-lin"],
        },
      ],
      stateMutations: [
        {
          entityType: "character_state",
          entityId: "captain-lin",
          operation: "replace",
          value: {
            location: "north-gate",
            mood: "guarded",
            condition: { leftArm: "wounded" },
          },
          reason: "林队长在北门交战并受伤",
          evidence: ["event-1"],
        },
        {
          entityType: "world_book_entry",
          entityId: "north-gate",
          operation: "replace",
          value: {
            keys: ["北门"],
            content: "北门在战斗中严重受损。",
          },
          reason: "地点状态成为持续世界事实",
          evidence: ["event-1"],
        },
      ],
    });

    assert.equal(firstTurn.sequence, 1);
    assert.equal(firstTurn.parentTurnId, null);
    assert.equal(firstTurn.reused, false);

    const afterFirstTurn = store.loadBranchState(branchId);
    assert.equal(afterFirstTurn.branch.headTurnId, firstTurn.id);
    assert.equal(afterFirstTurn.branch.nextSequence, 2);
    assert.equal(afterFirstTurn.recentTurns.length, 1);
    assert.equal(afterFirstTurn.recentTurns[0].stateChanges.length, 2);
    assert.deepEqual(afterFirstTurn.recentTurns[0].generation, {
      model: "deepseek-v4-flash",
      promptTokens: 320,
      completionTokens: 80,
      totalTokens: 400,
    });
    assert.deepEqual(
      afterFirstTurn.states.find(
        (state) => state.entityType === "character_state",
      )?.state,
      {
        location: "north-gate",
        mood: "guarded",
        condition: { leftArm: "wounded" },
      },
    );

    const secondTurnInput = {
      sessionId,
      branchId,
      expectedHeadTurnId: firstTurn.id,
      idempotencyKey: "turn-request-2",
      playerInput: { customChoice: "救治林队长" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "伤势得到处理。" },
      events: [
        {
          id: "event-2",
          eventType: "treatment_completed",
          summary: "林队长接受治疗",
          characterIds: ["captain-lin"],
        },
      ],
      stateMutations: [
        {
          entityType: "character_state",
          entityId: "captain-lin",
          operation: "merge",
          value: {
            mood: "determined",
            condition: { leftArm: null },
          },
          reason: "伤势已得到处理",
          evidence: ["event-2"],
        },
        {
          entityType: "story_direction",
          entityId: "active",
          operation: "replace",
          value: { status: "active", content: "调查北门袭击者" },
          reason: "玩家设定了新的剧情走向",
          evidence: ["event-2"],
        },
      ],
    };

    const secondTurn = store.commitTurn(secondTurnInput);
    assert.equal(secondTurn.sequence, 2);
    assert.equal(secondTurn.parentTurnId, firstTurn.id);

    const retryResult = store.commitTurn(secondTurnInput);
    assert.equal(retryResult.id, secondTurn.id);
    assert.equal(retryResult.reused, true);

    const afterSecondTurn = store.loadBranchState(branchId);
    const characterState = afterSecondTurn.states.find(
      (state) => state.entityType === "character_state",
    );
    assert.deepEqual(characterState?.state, {
      location: "north-gate",
      mood: "determined",
      condition: {},
    });
    assert.equal(characterState?.version, 2);
    assert.equal(afterSecondTurn.recentTurns.at(-1).stateChanges.length, 2);

    assert.throws(
      () =>
        store.commitTurn({
          sessionId,
          branchId,
          expectedHeadTurnId: firstTurn.id,
          playerInput: {},
          generatedOutput: {},
        }),
      BranchHeadConflictError,
    );
    assert.equal(store.loadBranchState(branchId).recentTurns.length, 2);

    database.close();
    database = openLocalDatabase({
      filePath: databasePath,
      migrationsDir,
    });
    store = new LocalStoryStore(database);

    const restored = store.loadBranchState(branchId);
    assert.equal(restored.branch.headTurnId, secondTurn.id);
    assert.equal(restored.recentTurns.length, 2);
    assert.equal(restored.states.length, 3);
    assert.equal(restored.recentTurns[0].generation.totalTokens, 400);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
