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

test("章节摘要按结构化信息组合：事件、走向、状态、关系、地点与补充摘要", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-memory-chapter-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "章节摘要结构化测试",
      world: { name: "潮汐城", premise: "潮汐城每晚都会改变街道方向。" },
      player: { name: "旅人", description: "寻找失落钥匙的人。" },
      mainCharacter: {
        name: "守钟人",
        role: "熟悉潮汐城旧路的向导",
        personality: "寡言但守信。",
      },
      openingScene: "旅人与引潮者在潮门前会合。",
    });

    let headTurnId = started.openingTurnId;
    const structuredTurns = [
      {
        scene: "旅人随引潮者进入北塔，在第三块空心砖后摸到一枚月蚀钥匙。",
        events: [
          {
            id: "struct-event-2",
            type: "发现线索",
            summary: "北塔第三块空心砖里藏着月蚀钥匙。",
          },
        ],
        storyDirectionEvaluation: {
          status: "active",
          reason: "调查月蚀钥匙的下落。",
        },
        characterStateChanges: [
          {
            characterId: "keeper",
            patch: {
              attributes: { 力量: 55 },
              statuses: [
                {
                  id: "wound-1",
                  name: "受伤",
                  kind: "debuff",
                  description: "左臂刀伤未愈合",
                },
              ],
            },
            reason: "搬运石砖消耗体力。",
          },
        ],
        relationshipChanges: [
          {
            sourceCharacterId: "player",
            targetCharacterId: "keeper",
            dimension: "trust",
            delta: 5,
            reason: "引潮者主动交出了钥匙。",
          },
        ],
        sceneTransition: {
          locationId: "north-tower",
          locationName: "北塔",
          presentCharacterIds: ["player", "keeper"],
        },
        summaryPatch: "",
      },
      {
        scene: "引潮者与旅人在塔顶核对潮汐表，确认月蚀钥匙对应的门。",
        events: [
          {
            id: "struct-event-3",
            type: "谈判",
            summary: "双方达成协议，约定午夜一同开启暗门。",
          },
        ],
        storyDirectionEvaluation: {
          status: "completed",
          reason: "月蚀钥匙已经找到。",
        },
        characterStateChanges: [
          {
            characterId: "keeper",
            patch: { restriction: null },
            reason: "钥匙到手后守钟人不再受限。",
          },
        ],
        relationshipChanges: [
          {
            sourceCharacterId: "player",
            targetCharacterId: "keeper",
            dimension: "trust",
            delta: 10,
            reason: "守钟人分享了潮汐表。",
          },
        ],
        sceneTransition: {
          locationId: "north-tower",
          locationName: "北塔",
          presentCharacterIds: ["player", "keeper"],
        },
        summaryPatch: "",
      },
      {
        scene: "午夜，两人在钟楼底层等待暗门开启。",
        events: [],
        storyDirectionEvaluation: null,
        characterStateChanges: [],
        relationshipChanges: [],
        sceneTransition: {
          locationId: "clock-tower",
          locationName: "逆流钟楼",
          presentCharacterIds: ["player", "keeper"],
        },
        summaryPatch: "午夜等待暗门开启。",
      },
    ];

    for (const [index, turn] of structuredTurns.entries()) {
      const sequence = index + 2;
      const committed = store.commitTurn({
        sessionId: started.sessionId,
        branchId: started.branchId,
        expectedHeadTurnId: headTurnId,
        idempotencyKey: `chapter-turn-${sequence}`,
        playerInput: {
          roleplay: { mode: "action", content: `推进第 ${sequence} 段调查` },
        },
        generatedOutput: {
          schemaVersion: "1.0.0",
          turn: {
            scene: turn.scene,
            events: turn.events.map((event) => ({
              id: event.id,
              type: event.type,
              summary: event.summary,
              characterIds: ["player", "keeper"],
              locationId: turn.sceneTransition.locationId,
            })),
            dialogue: [],
          },
          stateCommit: {
            sceneTransition: {
              ...turn.sceneTransition,
              reason: "本轮移动。",
              evidence: turn.events.map((event) => event.id),
            },
            characterStateChanges: turn.characterStateChanges,
            relationshipChanges: turn.relationshipChanges,
            characterCardChanges: [],
            worldBookChanges: [],
            storyDirectionEvaluation: turn.storyDirectionEvaluation,
            summaryPatch: turn.summaryPatch,
          },
          warnings: [],
        },
        summaryPatch: turn.summaryPatch,
        events: turn.events.map((event) => ({
          id: event.id,
          eventType: event.type,
          summary: event.summary,
        })),
      });
      headTurnId = committed.id;
    }

    const dashboard = store.loadStoryMemory(started.sessionId);
    const summary = dashboard.chapters[0].summary;
    // 结构化信息组合：重要事件（含类型与摘要）
    assert.match(summary, /重要事件：/);
    assert.match(summary, /\[发现线索\] 北塔第三块空心砖里藏着月蚀钥匙/);
    assert.match(summary, /\[谈判\] 双方达成协议，约定午夜一同开启暗门/);
    // 剧情走向：active 与 completed 变化
    assert.match(summary, /剧情走向：/);
    assert.match(summary, /进行中：调查月蚀钥匙的下落/);
    assert.match(summary, /已完成：月蚀钥匙已经找到/);
    // 状态变化：属性变化与词条/解除限制
    assert.match(summary, /状态变化：/);
    assert.match(summary, /属性变化：力量/);
    assert.match(summary, /状态词条：受伤/);
    assert.match(summary, /解除限制/);
    // 关系变化：角色对 + delta
    assert.match(summary, /关系变化：/);
    assert.match(summary, /trust \+5（引潮者主动交出了钥匙/);
    assert.match(summary, /trust \+10/);
    // 地点移动：去重后的地点
    assert.match(summary, /地点移动：/);
    assert.match(summary, /北塔（north-tower）/);
    assert.match(summary, /逆流钟楼（clock-tower）/);
    // 补充：summaryPatch 保留（前两回合无 summaryPatch 时摘要仍有结构化内容）
    assert.match(summary, /第 4 回合：午夜等待暗门开启/);
    // 总长度限制
    assert.ok(summary.length <= 3200);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
