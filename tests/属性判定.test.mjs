import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  LocalStoryStore,
  StoryNotFoundError,
} from "../lib/storage/story-store.ts";
import {
  parsePlayerTurnRequest,
  validateGeneratedTurn,
} from "../lib/story/回合协议.ts";
import { advanceAdventureTurn } from "../lib/story/回合服务.ts";
import {
  resolveAttributeCheck,
  resolveAttributeChecks,
} from "../lib/story/判定服务.ts";
import { parseStartAdventureInput } from "../lib/story/开局.ts";

const migrationsDir = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "drizzle",
);

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "ai-tavern-attribute-check-"));
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

function startAdventure(store) {
  return store.startAdventure({
    campaignName: "属性判定测试",
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
        name: "账房先生",
        role: "掌柜",
        personality: "精打细算。",
        initiallyPresent: false,
      },
    ],
    openingScene: "旅人在烛城更楼下落脚。",
  });
}

function turnOutput(started, scene, extra = {}) {
  return {
    schemaVersion: "1.0.0",
    turn: {
      scene,
      events: [
        {
          id: extra.eventId ?? "event-check",
          type: "scene_advance",
          summary: "剧情推进。",
          characterIds: [started.playerCharacterId, started.mainCharacterId],
          locationId: "moren",
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
          description: "先观察。",
          stance: "benevolent",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId: "moren",
        locationName: "更楼",
        locationDescription: "挂着旧铜灯的更楼。",
        presentCharacterIds: [
          started.playerCharacterId,
          started.mainCharacterId,
        ],
        reason: "两人仍在更楼。",
        evidence: [extra.eventId ?? "event-check"],
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
    idempotencyKey: `check-turn-${Math.random().toString(36).slice(2)}`,
    customChoice: "撬开更楼的旧锁",
  });
}

test("判定服务：悬殊时直接判定且无需掷骰", () => {
  const success = resolveAttributeCheck({
    attributeValue: 80,
    difficulty: 40,
    roll: null,
  });
  assert.equal(success.direct, true);
  assert.equal(success.outcome, "success");
  assert.equal(success.roll, null);
  const failure = resolveAttributeCheck({
    attributeValue: 20,
    difficulty: 90,
    roll: null,
  });
  assert.equal(failure.direct, true);
  assert.equal(failure.outcome, "failure");
});

test("判定服务：不确定区间必须掷骰", () => {
  assert.throws(
    () =>
      resolveAttributeCheck({
        attributeValue: 60,
        difficulty: 70,
        roll: null,
      }),
    (error) => error.message.includes("掷骰"),
  );
});

test("判定服务：d100 以 30% 波动折算后与难度比较", () => {
  const success = resolveAttributeCheck({
    attributeValue: 60,
    difficulty: 60,
    roll: 100,
  });
  assert.equal(success.outcome, "success");
  assert.equal(success.finalValue, 90);
  const lowSuccess = resolveAttributeCheck({
    attributeValue: 60,
    difficulty: 60,
    roll: 1,
  });
  assert.equal(lowSuccess.outcome, "success");
  assert.equal(lowSuccess.finalValue, 60.3);
  const partial = resolveAttributeCheck({
    attributeValue: 55,
    difficulty: 60,
    roll: 1,
  });
  assert.equal(partial.outcome, "partial_success");
  const failure = resolveAttributeCheck({
    attributeValue: 60,
    difficulty: 80,
    roll: 1,
  });
  assert.equal(failure.outcome, "failure");
});

test("判定服务：跳过未掷骰的判定", () => {
  const resolutions = resolveAttributeChecks({
    requests: [
      {
        id: "check-1",
        characterId: "player",
        attribute: "敏捷",
        difficulty: 70,
        context: "闪避落石",
      },
    ],
    attributeValues: { player: { 敏捷: 60 } },
    rolls: new Map([["check-1", null]]),
    skipUnrolled: true,
  });
  assert.equal(resolutions[0].outcome, "skipped");
  assert.equal(resolutions[0].outcomeLabel, "放弃判定");
});

test("属性白名单之外的属性不能写入角色状态", () => {
  const { store } = temporaryDatabase();
  const started = startAdventure(store);
  const adventure = store.loadAdventure(started.sessionId);
  assert.throws(
    () =>
      validateGeneratedTurn(
        turnOutput(started, "旅人试图撬锁。", {
          stateCommit: {
            characterStateChanges: [
              {
                characterId: started.playerCharacterId,
                patch: { attributes: { 智商: 80 } },
                duration: "until_changed",
                reason: "测试非法属性",
                evidence: ["event-check"],
              },
            ],
          },
        }),
        adventure,
        "turn-1",
      ),
    (error) => error.message.includes("白名单"),
  );
});

test("属性判定协议校验属性与难度", () => {
  const { store } = temporaryDatabase();
  const started = startAdventure(store);
  const adventure = store.loadAdventure(started.sessionId);
  assert.throws(
    () =>
      validateGeneratedTurn(
        turnOutput(started, "旅人试图撬锁。", {
          topLevel: {
            attributeChecks: [
              {
                id: "check-1",
                characterId: started.playerCharacterId,
                attribute: "运气",
                difficulty: 70,
                context: "撬开旧锁",
              },
            ],
          },
        }),
        adventure,
        "turn-1",
      ),
    (error) => error.message.includes("白名单"),
  );
  assert.throws(
    () =>
      validateGeneratedTurn(
        turnOutput(started, "旅人试图撬锁。", {
          topLevel: {
            attributeChecks: [
              {
                id: "check-1",
                characterId: started.playerCharacterId,
                attribute: "敏捷",
                difficulty: 0,
                context: "撬开旧锁",
              },
            ],
          },
        }),
        adventure,
        "turn-1",
      ),
    (error) => error.message.includes("难度"),
  );
});

test("含属性判定的回合先进入待确认状态，掷骰后回填并提交", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventure(store);
    const pending = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: {
        ...playerInput(),
        expectedHeadTurnId: started.openingTurnId,
      },
      generate: async () => ({
        content: turnOutput(started, "旅人贴近更楼的旧锁。", {
          topLevel: {
            attributeChecks: [
              {
                id: "check-lock",
                characterId: started.playerCharacterId,
                attribute: "敏捷",
                difficulty: 65,
                context: "在不惊动守夜人的情况下撬开旧锁",
              },
            ],
          },
        }),
        model: "deepseek-test",
        usage: { totalTokens: 100 },
      }),
    });
    assert.equal(pending.committedTurn, null);
    assert.equal(pending.pendingChecks.length, 1);
    assert.equal(pending.pendingChecks[0].attribute, "敏捷");
    assert.equal(pending.pendingChecks[0].attributeValue, 50);
    assert.equal(pending.pendingChecks[0].direct, false);
    const headBefore = store.loadAdventure(started.sessionId).branchState.branch
      .headTurnId;
    assert.equal(headBefore, started.openingTurnId, "待确认时分支头不应移动");

    const backfill = store.resolvePendingTurnChecks({
      sessionId: started.sessionId,
      pendingTurnId: pending.pendingTurnId,
      expectedHeadTurnId: started.openingTurnId,
      results: [{ checkId: "check-lock", roll: 80 }],
    });
    assert.equal(backfill.committedTurn.id, pending.pendingTurnId);
    assert.equal(backfill.resolutions[0].outcome, "success");
    assert.equal(backfill.resolutions[0].finalValue, 74);

    const adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.headTurnId, pending.pendingTurnId);
    const turn = adventure.branchState.recentTurns.at(-1);
    const output = turn.generatedOutput;
    assert.ok(
      output.turn.events.some(
        (event) => event.id === "attribute-check:check-lock",
      ),
      "判定结果事件应回填进该回合",
    );
    assert.equal(output.attributeCheckResults[0].outcome, "success");
    const checkState = adventure.branchState.states.find(
      (state) => state.entityType === "plot_check",
    );
    assert.ok(checkState, "判定记录应物化为 plot_check 状态");
    assert.equal(checkState.state.roll, 80);
    const audit = store.loadStateAudit(started.sessionId);
    assert.ok(
      audit.actions.some((action) =>
        action.changes.some((change) => change.entityType === "plot_check"),
      ),
      "判定记录应进入状态审计",
    );

    const retry = store.resolvePendingTurnChecks({
      sessionId: started.sessionId,
      pendingTurnId: pending.pendingTurnId,
      expectedHeadTurnId: pending.pendingTurnId,
      results: [{ checkId: "check-lock", roll: 80 }],
    });
    assert.equal(retry.committedTurn.reused, true, "重复确认应幂等复用");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("跳过全部判定后回合仍可提交", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventure(store);
    const pending = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: {
        ...playerInput(),
        expectedHeadTurnId: started.openingTurnId,
      },
      generate: async () => ({
        content: turnOutput(started, "旅人贴近更楼的旧锁。", {
          topLevel: {
            attributeChecks: [
              {
                id: "check-skip",
                characterId: started.playerCharacterId,
                attribute: "感知",
                difficulty: 60,
                context: "察觉暗哨",
              },
            ],
          },
        }),
        model: "deepseek-test",
        usage: { totalTokens: 100 },
      }),
    });
    const backfill = store.resolvePendingTurnChecks({
      sessionId: started.sessionId,
      pendingTurnId: pending.pendingTurnId,
      expectedHeadTurnId: started.openingTurnId,
      results: [{ checkId: "check-skip", roll: null }],
    });
    assert.equal(backfill.resolutions[0].outcome, "skipped");
    const adventure = store.loadAdventure(started.sessionId);
    const turn = adventure.branchState.recentTurns.at(-1);
    assert.equal(turn.id, pending.pendingTurnId);
    assert.ok(
      !turn.generatedOutput.turn.events.some(
        (event) => event.id === "attribute-check:check-skip",
      ),
      "放弃的判定不生成事实事件",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("不存在的待确认回合会报错", () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startAdventure(store);
    assert.throws(
      () =>
        store.resolvePendingTurnChecks({
          sessionId: started.sessionId,
          pendingTurnId: "missing-pending",
          expectedHeadTurnId: started.openingTurnId,
          results: [],
        }),
      (error) => error instanceof StoryNotFoundError,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("开局解析校验角色属性分区白名单", () => {
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
            id: "attr-trigger",
            when: "条件",
            consequence: "后果",
            stateEffects: {
              attributes: [
                { characterName: "NPC", attribute: "运气", value: 60 },
              ],
            },
          },
        ],
      }),
    (error) => error.message.includes("白名单"),
  );
});
