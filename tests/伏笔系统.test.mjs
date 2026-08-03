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
import { createStoryGenerationPrompt } from "../lib/story/剧情提示.ts";
import { parseStartAdventureInput } from "../lib/story/开局.ts";

const migrationsDir = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "drizzle",
);

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "ai-tavern-plot-thread-"));
  const database = openLocalDatabase({
    filePath: join(directory, "story.sqlite"),
    migrationsDir,
  });
  return {
    directory,
    database,
    store: new LocalStoryStore(database),
  };
}

function startAdventureWithThreads(store) {
  return store.startAdventure({
    campaignName: "伏笔系统测试",
    world: { name: "雾镇", premise: "钟声与迷雾有关。" },
    player: { name: "旅人", description: "寻人者。" },
    mainCharacter: {
      name: "守钟人",
      role: "钟楼看守",
      personality: "沉默。",
      firstMessage: "钟还没有响。",
    },
    additionalCharacters: [
      {
        name: "老匠人",
        role: "铸钟师",
        personality: "寡言。",
        initiallyPresent: false,
      },
    ],
    openingScene: "旅人在黄昏进入雾镇钟楼。",
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
  });
}

function turnOutput(started, scene, extra = {}) {
  return {
    schemaVersion: "1.0",
    turn: {
      scene,
      events: [
        {
          id: extra.eventId ?? "event-thread",
          type: "scene_advance",
          summary: "剧情推进。",
          characterIds: [started.playerCharacterId, started.mainCharacterId],
          locationId: "clock-tower",
        },
      ],
      dialogue: [],
    },
    decision: {
      context: "action_direction",
      prompt: "接下来如何行动？",
      choices: [
        {
          id: "choice-a",
          label: "继续调查",
          description: "沿着线索继续。",
          stance: "neutral",
        },
        {
          id: "choice-b",
          label: "暂且观望",
          description: "先观察局势。",
          stance: "benevolent",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId: "clock-tower",
        locationName: "逆流钟楼",
        locationDescription: "铜钟悬在石室中央。",
        presentCharacterIds: [
          started.playerCharacterId,
          started.mainCharacterId,
        ],
        reason: "两人仍在钟楼。",
        evidence: [extra.eventId ?? "event-thread"],
      },
      characterStateChanges: [],
      relationshipChanges: [],
      characterCardChanges: [],
      worldBookChanges: [],
      storyDirectionEvaluation: null,
      summaryPatch: scene,
      ...extra.stateCommit,
    },
    warnings: [],
    ...extra.topLevel,
  };
}

function playerInput() {
  return parsePlayerTurnRequest({
    expectedHeadTurnId: null,
    idempotencyKey: `thread-turn-${Math.random().toString(36).slice(2)}`,
    customChoice: "继续调查古井",
  });
}

test("开局解析并物化伏笔分区", () => {
  const { store } = temporaryDatabase();
  const started = startAdventureWithThreads(store);
  const thread = store
    .loadAdventure(started.sessionId)
    .branchState.states.find(
      (state) =>
        state.entityType === "plot_thread" &&
        state.state.threadId === "well-bell",
    );
  assert.ok(thread, "伏笔应当物化为 plot_thread 状态实体");
  assert.equal(thread.state.status, "dormant");
  assert.deepEqual(thread.state.keywords, ["古井", "钟"]);
  assert.deepEqual(thread.state.characters, ["老匠人"]);
});

test("开局解析校验伏笔必填字段", () => {
  assert.throws(
    () =>
      parseStartAdventureInput({
        campaignName: "T",
        world: { name: "W", premise: "P" },
        player: { name: "玩家", description: "旅行者" },
        mainCharacter: {
          name: "NPC",
          role: "旅伴",
          personality: "友善",
        },
        openingScene: "开场。",
        foreshadowing: [
          { id: "bad-thread", keywords: [], seedCondition: "", payoffCondition: "", payoffSummary: "" },
        ],
      }),
    (error) =>
      error instanceof Error &&
      /至少需要一个关键词/.test(error.message),
  );
});

test("seed 条件满足后伏笔激活并进入种子状态", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventureWithThreads(store);
    const result = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: {
        ...playerInput(),
        expectedHeadTurnId: started.openingTurnId,
      },
      generate: async () => ({
        content: turnOutput(started, "旅人走近古井，听见井中有回声。", {
          stateCommit: {
            plotThreadUpdates: [
              {
                threadId: "well-bell",
                operation: "seed",
                reason: "旅人进入古井附近，听到了井中回声。",
                evidence: ["event-thread"],
              },
            ],
          },
        }),
        model: "deepseek-test",
        usage: { totalTokens: 100 },
      }),
    });
    const thread = result.adventure.branchState.states.find(
      (state) =>
        state.entityType === "plot_thread" &&
        state.state.threadId === "well-bell",
    );
    assert.equal(thread.state.status, "seeded");
    assert.ok(thread.state.seededAtTurnId);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("未激活的伏笔不能直接报告 payoff", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventureWithThreads(store);
    await assert.rejects(
      advanceAdventureTurn({
        store,
        sessionId: started.sessionId,
        input: {
          ...playerInput(),
          expectedHeadTurnId: started.openingTurnId,
        },
        generate: async () => ({
          content: turnOutput(started, "旅人在井底发现了铜钟。", {
            stateCommit: {
              plotThreadUpdates: [
                {
                  threadId: "well-bell",
                  operation: "payoff",
                  reason: "玩家发现了铜钟。",
                  evidence: ["event-thread"],
                },
              ],
            },
          }),
          model: "deepseek-test",
          usage: { totalTokens: 100 },
        }),
      }),
      (error) => error.message.includes("尚未激活"),
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("seed 后 payoff 条件满足会回收伏笔", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventureWithThreads(store);
    const first = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: {
        ...playerInput(),
        expectedHeadTurnId: started.openingTurnId,
      },
      generate: async () => ({
        content: turnOutput(started, "旅人走近古井，听见井中有回声。", {
          stateCommit: {
            plotThreadUpdates: [
              {
                threadId: "well-bell",
                operation: "seed",
                reason: "旅人进入古井附近。",
                evidence: ["event-thread"],
              },
            ],
          },
        }),
        model: "deepseek-test",
        usage: { totalTokens: 100 },
      }),
    });
    const second = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: {
        ...playerInput(),
        expectedHeadTurnId: first.committedTurn.id,
      },
      generate: async () => ({
        content: turnOutput(started, "旅人在井底挖出了铜钟。", {
          eventId: "event-payoff",
          stateCommit: {
            plotThreadUpdates: [
              {
                threadId: "well-bell",
                operation: "payoff",
                reason: "玩家发现了古井底部的铜钟。",
                evidence: ["event-payoff"],
              },
            ],
          },
        }),
        model: "deepseek-test",
        usage: { totalTokens: 100 },
      }),
    });
    const thread = second.adventure.branchState.states.find(
      (state) =>
        state.entityType === "plot_thread" &&
        state.state.threadId === "well-bell",
    );
    assert.equal(thread.state.status, "paid_off");
    assert.ok(thread.state.paidOffAtTurnId);
    const audit = store.loadStateAudit(started.sessionId);
    assert.ok(
      audit.actions.some((action) =>
        action.changes.some(
          (change) => change.entityType === "plot_thread",
        ),
      ),
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("seeded 伏笔在提示词上下文中携带回收条件", () => {
  const { store } = temporaryDatabase();
  const started = startAdventureWithThreads(store);
  const prompt = createStoryGenerationPrompt({
    adventure: store.loadAdventure(started.sessionId),
    turnId: "next-turn",
    resolvedPlayerTurn: {
      playerInput: { customChoice: "调查古井" },
      displayMessage: "调查古井",
      effectiveStoryDirection: "",
      previousStoryDirection: "",
    },
  });
  const threads = prompt.snapshot.context.plotThreads;
  assert.ok(Array.isArray(threads) && threads.length >= 1);
  assert.equal(threads[0].threadId, "well-bell");
  assert.ok(prompt.snapshot.systemPrompt.includes("plotThreadUpdates"));
});

test("伏笔管理命令可新增、更新与删除", () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventureWithThreads(store);
    const created = store.managePlotThread({
      actionId: "thread-create-1",
      sessionId: started.sessionId,
      operation: "create",
      thread: {
        id: "river-warning",
        keywords: ["断桥"],
        seedCondition: "角色到达断桥",
        payoffCondition: "玩家查看桥下的刻字",
        payoffSummary: "断桥下的刻字预告了山洪。",
      },
    });
    assert.equal(created.threadId, "river-warning");
    const updated = store.managePlotThread({
      actionId: "thread-update-1",
      sessionId: started.sessionId,
      operation: "update",
      threadId: "river-warning",
      thread: {
        id: "river-warning",
        keywords: ["断桥", "刻字"],
        seedCondition: "角色到达断桥",
        payoffCondition: "玩家查看桥下的刻字",
        payoffSummary: "断桥下的刻字预告了山洪与旧堤。",
      },
    });
    assert.equal(updated.operation, "update");
    const states = store
      .loadAdventure(started.sessionId)
      .branchState.states.filter(
        (state) => state.entityType === "plot_thread",
      );
    const thread = states.find(
      (state) => state.state.threadId === "river-warning",
    );
    assert.ok(thread);
    assert.deepEqual(thread.state.keywords, ["断桥", "刻字"]);
    store.managePlotThread({
      actionId: "thread-delete-1",
      sessionId: started.sessionId,
      operation: "delete",
      threadId: "river-warning",
    });
    const afterDelete = store
      .loadAdventure(started.sessionId)
      .branchState.states.find(
        (state) =>
          state.entityType === "plot_thread" &&
          state.state.threadId === "river-warning",
      );
    assert.equal(afterDelete.isActive, false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
