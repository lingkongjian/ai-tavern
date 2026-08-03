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
import { parseStartAdventureInput } from "../lib/story/开局.ts";

const migrationsDir = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "drizzle",
);

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "ai-tavern-plot-trigger-"));
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

function startAdventureWithTriggers(store, extra = {}) {
  return store.startAdventure({
    campaignName: "偏离触发器测试",
    world: { name: "霜城", premise: "世族与江湖暗流涌动。" },
    player: { name: "江离", description: "初出茅庐的剑客。" },
    mainCharacter: {
      name: "沈青梧",
      role: "青梧阁主",
      personality: "深沉。",
      firstMessage: "你来了。",
    },
    additionalCharacters: [
      {
        name: "萧破军",
        role: "叛军统领",
        personality: "桀骜。",
        initiallyPresent: false,
      },
      {
        name: "云未央",
        role: "正主",
        personality: "多疑。",
        initiallyPresent: false,
      },
    ],
    openingScene: "江离在霜城客栈落脚。",
    triggers: [
      {
        id: "ambush-den",
        when: "主角实力不足时强闯叛军大营",
        consequence: "萧破军提前察觉并亲自出手，主角陷入险境。",
        stateEffects: {
          relations: [
            {
              sourceCharacterName: "萧破军",
              targetCharacterName: "江离",
              dimension: "hostility",
              delta: 40,
            },
          ],
          flags: ["bad_end"],
          attributes: [
            { characterName: "萧破军", attribute: "力量", value: 95 },
          ],
        },
      },
      {
        id: "married-suspicion",
        when: "已婚状态下与异性单独接触",
        consequence: "正主云未央起疑，敌我关系大幅转变。",
        stateEffects: {
          relations: [
            {
              sourceCharacterName: "云未央",
              targetCharacterName: "江离",
              dimension: "trust",
              delta: -30,
            },
          ],
        },
      },
      ...(extra.triggers ?? []),
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
          id: extra.eventId ?? "event-trigger",
          type: "scene_advance",
          summary: "剧情推进。",
          characterIds: [started.playerCharacterId, started.mainCharacterId],
          locationId: "inn",
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
          label: "继续",
          description: "继续行动。",
          stance: "neutral",
        },
        {
          id: "choice-b",
          label: "暂缓",
          description: "先观察局势。",
          stance: "benevolent",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId: "inn",
        locationName: "霜城客栈",
        locationDescription: "灯火昏暗的客栈。",
        presentCharacterIds: [
          started.playerCharacterId,
          started.mainCharacterId,
        ],
        reason: "两人仍在客栈。",
        evidence: [extra.eventId ?? "event-trigger"],
        ...extra.sceneTransition,
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
    idempotencyKey: `trigger-turn-${Math.random().toString(36).slice(2)}`,
    customChoice: "强闯叛军大营",
  });
}

test("开局解析并物化偏离触发器分区", () => {
  const { store } = temporaryDatabase();
  const started = startAdventureWithTriggers(store);
  const states = store.loadAdventure(started.sessionId).branchState.states;
  const trigger = states.find(
    (state) =>
      state.entityType === "plot_trigger" &&
      state.state.triggerId === "ambush-den",
  );
  assert.ok(trigger, "触发器应当物化为 plot_trigger 状态实体");
  assert.equal(trigger.state.status, "armed");
  assert.equal(trigger.state.stateEffects.flags[0], "bad_end");
  assert.equal(
    trigger.state.stateEffects.relations[0].delta,
    40,
  );
});

test("开局解析校验触发器必填字段与角色引用", () => {
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
        triggers: [
          {
            id: "bad-trigger",
            when: "条件",
            consequence: "后果",
            stateEffects: {
              relations: [
                {
                  sourceCharacterName: "不存在的人",
                  targetCharacterName: "玩家",
                  dimension: "hostility",
                  delta: 10,
                },
              ],
            },
          },
        ],
      }),
    (error) => error.message.includes("不存在"),
  );
});

test("条件满足时触发器触发并强制应用状态影响", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventureWithTriggers(store);
    const result = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: {
        ...playerInput(),
        expectedHeadTurnId: started.openingTurnId,
      },
      generate: async () => ({
        content: turnOutput(started, "江离闯入叛军大营，萧破军亲自出手。", {
          stateCommit: {
            plotTriggerUpdates: [
              {
                triggerId: "ambush-den",
                operation: "fire",
                reason: "主角弱时强闯叛军大营，萧破军提前登场。",
                evidence: ["event-trigger"],
              },
            ],
          },
        }),
        model: "deepseek-test",
        usage: { totalTokens: 100 },
      }),
    });
    const states = result.adventure.branchState.states;
    const trigger = states.find(
      (state) =>
        state.entityType === "plot_trigger" &&
        state.state.triggerId === "ambush-den",
    );
    assert.equal(trigger.state.status, "fired");
    assert.ok(trigger.state.firedAtTurnId);
    const relationship = states.find(
      (state) =>
        state.entityType === "relationship" &&
        state.state.sourceCharacterId ===
          result.adventure.branchState.states.find(
            (candidate) => candidate.state.name === "萧破军",
          )?.entityId &&
        state.state.targetCharacterId === started.playerCharacterId,
    );
    assert.ok(relationship, "应当建立触发器的敌意关系");
    assert.equal(relationship.state.hostility, 40);
    const sessionState = states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(sessionState.state.badEnd, true, "bad_end 标志应置位");
    const cj = states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.state.name === "萧破军",
    );
    assert.equal(cj.state.attributes.力量, 95);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("已触发的触发器不能重复触发", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventureWithTriggers(store);
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: {
        ...playerInput(),
        expectedHeadTurnId: started.openingTurnId,
      },
      generate: async () => ({
        content: turnOutput(started, "江离闯入叛军大营。", {
          stateCommit: {
            plotTriggerUpdates: [
              {
                triggerId: "ambush-den",
                operation: "fire",
                reason: "条件满足。",
                evidence: ["event-trigger"],
              },
            ],
          },
        }),
        model: "deepseek-test",
        usage: { totalTokens: 100 },
      }),
    });
    await assert.rejects(
      advanceAdventureTurn({
        store,
        sessionId: started.sessionId,
        input: {
          ...playerInput(),
          expectedHeadTurnId: (() => {
            const adventure = store.loadAdventure(started.sessionId);
            return adventure.branchState.branch.headTurnId;
          })(),
        },
        generate: async () => ({
          content: turnOutput(started, "萧破军再次出手。", {
            eventId: "event-again",
            stateCommit: {
              plotTriggerUpdates: [
                {
                  triggerId: "ambush-den",
                  operation: "fire",
                  reason: "再次满足。",
                  evidence: ["event-again"],
                },
              ],
            },
          }),
          model: "deepseek-test",
          usage: { totalTokens: 100 },
        }),
      }),
      (error) => error.message.includes("不能重复触发"),
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deadline 仅在剧情时间推进到期后强制触发", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventureWithTriggers(store, {
      triggers: [
        {
          id: "deadline-flood",
          when: "玩家在第 2 天前完成堤坝加固",
          consequence: "山洪提前冲垮旧堤。",
          deadlineDay: 2,
          stateEffects: {
            flags: ["bad_end"],
          },
        },
      ],
    });

    // 第一回合剧情未发生时间推移（timeAdvance 缺省）：第 1 日，期限未到，不应误触发
    const first = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: {
        ...playerInput(),
        expectedHeadTurnId: started.openingTurnId,
      },
      generate: async () => ({
        content: turnOutput(started, "江离加固堤坝的进度缓慢。", {
          topLevel: {
            warnings: [],
          },
        }),
        model: "deepseek-test",
        usage: { totalTokens: 100 },
      }),
    });
    const firstStates = first.adventure.branchState.states;
    const firstTrigger = firstStates.find(
      (state) =>
        state.entityType === "plot_trigger" &&
        state.state.triggerId === "deadline-flood",
    );
    assert.equal(firstTrigger.state.status, "armed", "未推进到期限前不应触发");
    const firstSession = firstStates.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(firstSession.state.gameTimeDay, 1);

    // 第二回合剧情显式推进一天：进入第 2 天，期限已至，系统强制触发并应用后果
    const second = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: {
        ...playerInput(),
        expectedHeadTurnId: first.adventure.branchState.branch.headTurnId,
      },
      generate: async () => ({
        content: turnOutput(started, "第 2 天，旧堤在暴雨中崩裂。", {
          eventId: "event-trigger-2",
          sceneTransition: { timeAdvance: "one_day" },
          topLevel: {
            warnings: [],
          },
        }),
        model: "deepseek-test",
        usage: { totalTokens: 100 },
      }),
    });
    const states = second.adventure.branchState.states;
    const trigger = states.find(
      (state) =>
        state.entityType === "plot_trigger" &&
        state.state.triggerId === "deadline-flood",
    );
    assert.equal(trigger.state.status, "fired");
    assert.match(trigger.state.fireReason, /期限/);
    const sessionState = states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(sessionState.state.gameTimeDay, 2);
    assert.equal(sessionState.state.badEnd, true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("触发器管理命令可新增、更新与删除", () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventureWithTriggers(store);
    const created = store.managePlotTrigger({
      actionId: "trigger-create-1",
      sessionId: started.sessionId,
      operation: "create",
      trigger: {
        id: "night-raid",
        when: "主角夜间出城",
        consequence: "巡逻队发现主角行踪。",
        stateEffects: {
          relations: [
            {
              sourceCharacterName: "云未央",
              targetCharacterName: "江离",
              dimension: "fear",
              delta: -15,
            },
          ],
        },
      },
    });
    assert.equal(created.triggerId, "night-raid");
    const states = store
      .loadAdventure(started.sessionId)
      .branchState.states;
    const trigger = states.find(
      (state) =>
        state.entityType === "plot_trigger" &&
        state.state.triggerId === "night-raid",
    );
    assert.ok(trigger);
    assert.equal(trigger.state.stateEffects.relations[0].dimension, "fear");
    store.managePlotTrigger({
      actionId: "trigger-delete-1",
      sessionId: started.sessionId,
      operation: "delete",
      triggerId: "night-raid",
    });
    const afterDelete = store
      .loadAdventure(started.sessionId)
      .branchState.states.find(
        (state) =>
          state.entityType === "plot_trigger" &&
          state.state.triggerId === "night-raid",
      );
    assert.equal(afterDelete.isActive, false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
