import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

test("50 回合后仍能召回早期关键事实并抑制无关记忆", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-memory-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "长剧情记忆测试",
      world: { name: "潮汐城", premise: "潮汐城每晚都会改变街道方向。" },
      player: { name: "旅人", description: "寻找失落钥匙的人。" },
      mainCharacter: {
        name: "引潮者",
        role: "熟悉潮汐城旧路的向导",
        personality: "寡言但守信。",
      },
      openingScene: "旅人与引潮者在潮门前会合。",
    });

    let headTurnId = started.openingTurnId;
    for (let sequence = 2; sequence <= 56; sequence += 1) {
      const summary =
        sequence === 2
          ? "引潮者把月蚀钥匙藏进北塔第三块空心砖，并只告诉了旅人。"
          : sequence === 3
            ? "南港商人展示了一枚与主线无关的琥珀纽扣。"
            : `旅人与引潮者完成了第 ${sequence} 段潮汐城调查。`;
      const committed = store.commitTurn({
        sessionId: started.sessionId,
        branchId: started.branchId,
        expectedHeadTurnId: headTurnId,
        idempotencyKey: `memory-turn-${sequence}`,
        playerInput: {
          roleplay: { mode: "action", content: `调查第 ${sequence} 条街道` },
          ...(sequence === 2 ? { storyDirection: "找到月蚀钥匙" } : {}),
          effectiveStoryDirection: "找到月蚀钥匙",
        },
        generatedOutput: {
          schemaVersion: "1.0.0",
          turn: {
            scene: summary,
            events: [
              {
                id: `memory-event-${sequence}`,
                type: sequence === 2 ? "关键秘密" : "调查进展",
                summary,
                characterIds: [],
                locationId: null,
              },
            ],
            dialogue: [],
          },
          stateCommit: {
            relationshipChanges: [],
            characterCardChanges: [],
            worldBookChanges: [],
            storyDirectionEvaluation:
              sequence === 56 ? { status: "completed" } : null,
          },
        },
        summaryPatch: summary,
        events: [
          {
            id: `memory-event-${sequence}`,
            eventType: sequence === 2 ? "关键秘密" : "调查进展",
            summary,
          },
        ],
      });
      headTurnId = committed.id;
    }

    const dashboard = store.loadStoryMemory(started.sessionId);
    assert.equal(dashboard.chapters.length, 6);
    assert.equal(dashboard.entries.length >= 56, true);
    const directionMemories = dashboard.entries.filter(
      (entry) => entry.subjectKey === "story-direction",
    );
    assert.equal(directionMemories.length, 2);
    assert.equal(directionMemories.every((entry) => entry.status === "resolved"), true);

    const recalled = store.selectStoryMemory({
      sessionId: started.sessionId,
      query: "回北塔取出月蚀钥匙",
    });
    assert.equal(
      recalled.entries.some((entry) => entry.content.includes("北塔第三块空心砖")),
      true,
    );
    assert.equal(
      recalled.entries.some((entry) => entry.content.includes("琥珀纽扣")),
      false,
    );
    assert.equal(recalled.estimatedTokens <= recalled.budgetTokens, true);
    assert.equal(recalled.recentTurnCount, 6);

    const unrelated = dashboard.entries.find((entry) =>
      entry.content.includes("琥珀纽扣"),
    );
    assert.ok(unrelated);
    store.updateStoryMemoryEntry(started.sessionId, {
      entryId: unrelated.id,
      pinned: true,
    });
    assert.equal(
      store
        .selectStoryMemory({ sessionId: started.sessionId, query: "继续北塔行动" })
        .entries.some((entry) => entry.id === unrelated.id),
      true,
    );
    store.updateStoryMemoryEntry(started.sessionId, {
      entryId: unrelated.id,
      enabled: false,
    });
    assert.equal(
      store
        .selectStoryMemory({ sessionId: started.sessionId, query: "继续北塔行动" })
        .entries.some((entry) => entry.id === unrelated.id),
      false,
    );

    const changed = store.updateStoryMemorySettings(started.sessionId, {
      memoryTokenBudget: 600,
      recentTurnCount: 2,
      chapterSize: 5,
    });
    assert.equal(changed.settings.memoryTokenBudget, 600);
    assert.equal(changed.settings.recentTurnCount, 2);
    assert.equal(changed.chapters.length, 12);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
