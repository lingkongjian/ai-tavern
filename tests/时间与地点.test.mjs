import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import {
  dayPhaseOf,
  normalizeGeneratedTurnVersion,
  parsePlayerTurnRequest,
  validateGeneratedTurn,
} from "../lib/story/回合协议.ts";
import { advanceAdventureTurn } from "../lib/story/回合服务.ts";
import { createStoryGenerationPrompt } from "../lib/story/剧情提示.ts";
import { parseCharacterManagementInput } from "../lib/story/人物管理.ts";
import { parseStartAdventureInput } from "../lib/story/开局.ts";

const migrationsDir = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "drizzle",
);

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "ai-tavern-p1-"));
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

function turnContent(
  started,
  scene,
  options = {},
) {
  const eventId = options.eventId ?? "event-p1";
  return {
    schemaVersion: "1.0",
    turn: {
      scene,
      events: [
        {
          id: eventId,
          type: "scene_advance",
          summary: "剧情继续推进。",
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
        evidence: [options.evidenceId ?? "event-p1"],
        ...options.sceneTransition,
      },
      characterStateChanges: [],
      relationshipChanges: [],
      characterCardChanges: [],
      worldBookChanges: [],
      storyDirectionEvaluation: null,
      summaryPatch: scene,
    },
    warnings: [],
  };
}

function startP1Adventure(store, extra = {}) {
  return store.startAdventure({
    campaignName: "时间与地点测试",
    world: { name: "潮汐城", premise: "钟声改变潮水。" },
    player: { name: "旅人", description: "测绘师。" },
    mainCharacter: {
      name: "守钟人",
      role: "钟楼看守",
      personality: "警觉但守信。",
      firstMessage: "钟还没有敲响。",
    },
    additionalCharacters: [
      {
        name: "老匠人",
        role: "铜钟铸师",
        personality: "寡言。",
        initiallyPresent: false,
      },
    ],
    openingScene:
      "旅人在黄昏来到钟楼。守钟人把钥匙压在掌心，平静地等着旅人开口。",
    storyModules: [
      {
        id: "cure-poison",
        title: "解毒",
        objective: "在三日内找到解药。",
        completionCriteria: ["取得解药并解毒"],
        prerequisiteModuleIds: [],
        deadlineDay: 3,
      },
    ],
    initialStoryModuleId: "cure-poison",
    initialStoryDirection: "找到解药。",
    ...extra,
  });
}

test("缺省回合不推进游戏内时间，剧情显式推进时才更新天数", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    const adventure = store.loadAdventure(started.sessionId);
    const core = adventure.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(core.state.gameTimeDay, 1);

    // 连续两个缺省回合（剧情未发生时间推移）：gameTimeDay 保持第 1 日不变
    for (const [index, scene] of [
      "旅人记录下铜钟的逆流规律。",
      "旅人与守钟人继续交谈。",
    ].entries()) {
      const before = store.loadAdventure(started.sessionId);
      await advanceAdventureTurn({
        store,
        sessionId: started.sessionId,
        input: parsePlayerTurnRequest({
          expectedHeadTurnId: before.branchState.branch.headTurnId,
          idempotencyKey: `request-time-default-${index}`,
          customChoice: "继续调查钟楼。",
        }),
        createTurnId: () => `turn-time-default-${index}`,
        generate: async () => ({
          content: turnContent(started, scene, {
            eventId: `event-default-${index}`,
            evidenceId: `event-default-${index}`,
          }),
          model: "deepseek-v4-flash",
          usage: {},
        }),
      });
    }
    const after = store.loadAdventure(started.sessionId);
    const coreAfter = after.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(coreAfter.state.gameTimeDay, 1);

    // 随后剧情显式推进数日：several_days 正确推进约数日
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: after.branchState.branch.headTurnId,
        idempotencyKey: "request-time-several",
        customChoice: "连夜赶路。",
      }),
      createTurnId: () => "turn-time-several",
      generate: async () => ({
        content: turnContent(started, "旅人连夜赶路数日，抵达城外。", {
          eventId: "event-several",
          evidenceId: "event-several",
          sceneTransition: { timeAdvance: "several_days" },
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    const final = store.loadAdventure(started.sessionId);
    const coreFinal = final.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(coreFinal.state.gameTimeDay, 4);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("timeAdvance 显式声明控制天数推进（moment/hours 不变、one_day/several_days 推进）", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);

    async function advanceTurn(advance, scene, eventId, customChoice) {
      const before = store.loadAdventure(started.sessionId);
      await advanceAdventureTurn({
        store,
        sessionId: started.sessionId,
        input: parsePlayerTurnRequest({
          expectedHeadTurnId: before.branchState.branch.headTurnId,
          idempotencyKey: `request-time-${eventId}`,
          customChoice,
        }),
        createTurnId: () => `turn-time-${eventId}`,
        generate: async () => ({
          content: turnContent(started, scene, {
            eventId,
            evidenceId: eventId,
            sceneTransition: { timeAdvance: advance },
          }),
          model: "deepseek-v4-flash",
          usage: {},
        }),
      });
      const after = store.loadAdventure(started.sessionId);
      return after.branchState.states.find(
        (state) =>
          state.entityType === "session_state" && state.entityId === "core",
      );
    }

    // moment：时间基本不变
    const coreMoment = await advanceTurn(
      "moment",
      "旅人守在钟楼内等候消息。",
      "event-moment",
      "原地修整片刻。",
    );
    assert.equal(coreMoment.state.gameTimeDay, 1);

    // hours：小时级推进不跨天
    const coreHours = await advanceTurn(
      "hours",
      "数小时后，钟楼外传来新的动静。",
      "event-hours",
      "在钟楼内守候数小时。",
    );
    assert.equal(coreHours.state.gameTimeDay, 1);

    // one_day：显式推进一天
    const coreOneDay = await advanceTurn(
      "one_day",
      "次日清晨，旅人再次来到钟楼。",
      "event-oneday",
      "等到第二天再调查。",
    );
    assert.equal(coreOneDay.state.gameTimeDay, 2);

    // several_days：推进约数日
    const coreSeveral = await advanceTurn(
      "several_days",
      "旅人连夜赶路数日，抵达城外。",
      "event-severaldays",
      "前往城外追查。",
    );
    assert.equal(coreSeveral.state.gameTimeDay, 5);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("offstageUpdates move absent characters to declared or new locations", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    const craftsmanId = started.additionalCharacterIds[0];

    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "request-offstage",
        customChoice: "在钟楼等待。",
      }),
      createTurnId: () => "turn-offstage",
      generate: async () => ({
        content: turnContent(started, "钟声在夜幕中敲响。", {
          sceneTransition: {
            offstageUpdates: [
              {
                characterId: craftsmanId,
                locationId: "old-forge",
                locationName: "城外旧熔炉",
                locationDescription: "废弃多年的铸钟熔炉。",
                reason: "老匠人趁夜前往旧熔炉查看铜料。",
              },
            ],
          },
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });

    const after = store.loadAdventure(started.sessionId);
    const craftsman = after.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === craftsmanId,
    );
    assert.equal(craftsman.state.locationId, "old-forge");
    assert.equal(craftsman.state.present, false);
    const forge = after.branchState.states.find(
      (state) => state.entityType === "location" && state.entityId === "old-forge",
    );
    assert.equal(forge.state.name, "城外旧熔炉");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("declared locations are pre-registered at adventure start", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store, {
      locations: [
        {
          name: "旧熔炉",
          description: "城外废弃的铸钟熔炉。",
          characters: ["老匠人"],
          important: true,
        },
        {
          name: "码头",
          description: "潮汐城的水运码头。",
        },
      ],
    });
    const adventure = store.loadAdventure(started.sessionId);
    const locations = adventure.branchState.states.filter(
      (state) => state.entityType === "location",
    );
    const names = locations.map((location) => location.state.name);
    assert.ok(names.includes("旧熔炉"));
    assert.ok(names.includes("码头"));
    const forge = locations.find((location) => location.state.name === "旧熔炉");
    assert.equal(forge.state.important, true);
    assert.deepEqual(forge.state.defaultCharacterIds, [
      started.additionalCharacterIds[0],
    ]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expired task deadlines are injected as hard facts into the prompt", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    const adventure = store.loadAdventure(started.sessionId);
    const prompt = createStoryGenerationPrompt({
      adventure,
      turnId: "turn-deadline",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "旅人继续调查。",
        effectiveStoryDirection: "找到解药。",
        previousStoryDirection: "找到解药。",
      },
    });
    const context = prompt.messages[1].content;
    assert.doesNotMatch(context, /expiredDeadlines/);

    const coreWithDay = {
      ...adventure,
      branchState: {
        ...adventure.branchState,
        states: adventure.branchState.states.map((state) =>
          state.entityType === "session_state" && state.entityId === "core"
            ? { ...state, state: { ...state.state, gameTimeDay: 4 } }
            : state,
        ),
      },
    };
    const expiredPrompt = createStoryGenerationPrompt({
      adventure: coreWithDay,
      turnId: "turn-deadline-2",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "旅人继续调查。",
        effectiveStoryDirection: "找到解药。",
        previousStoryDirection: "找到解药。",
      },
    });
    const expiredContext = expiredPrompt.messages[1].content;
    assert.match(expiredContext, /expiredDeadlines/);
    assert.match(expiredContext, /cure-poison/);
    assert.match(expiredPrompt.messages[0].content, /期限后果/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("start adventure input accepts declared locations and deadlines", () => {
  const parsed = parseStartAdventureInput({
    campaignName: "解析测试",
    world: { name: "雪域", premise: "长夜无星。" },
    player: { name: "旅人", description: "测绘师。" },
    mainCharacter: { name: "守钟人", role: "看守", personality: "警觉。" },
    openingScene: "旅人抵达钟楼。",
    storyModules: [
      {
        id: "cure",
        title: "解毒",
        objective: "找解药。",
        completionCriteria: ["拿到解药"],
        deadlineDay: 3,
      },
    ],
    locations: [
      { name: "码头", description: "水运码头。", characters: ["守钟人"] },
    ],
  });
  assert.equal(parsed.locations.length, 1);
  assert.equal(parsed.locations[0].name, "码头");
  assert.equal(parsed.storyModules[0].deadlineDay, 3);
});

function turnWithEvaluation(started, scene, options = {}) {
  const content = turnContent(started, scene, {
    eventId: options.eventId,
    evidenceId: options.evidenceId,
    sceneTransition: options.sceneTransition,
  });
  if (options.evaluation !== undefined) {
    content.stateCommit.storyDirectionEvaluation = options.evaluation;
  }
  return content;
}

async function advanceOneTurn(store, started, options) {
  const before = store.loadAdventure(started.sessionId);
  await advanceAdventureTurn({
    store,
    sessionId: started.sessionId,
    input: parsePlayerTurnRequest({
      expectedHeadTurnId: before.branchState.branch.headTurnId,
      idempotencyKey: options.idempotencyKey,
      customChoice: options.choice,
    }),
    createTurnId: () => options.turnId,
    generate: async () => ({
      content: turnWithEvaluation(started, options.scene, {
        eventId: options.eventId,
        evidenceId: options.eventId,
        sceneTransition: options.sceneTransition,
        evaluation: options.evaluation,
      }),
      model: "deepseek-v4-flash",
      usage: {},
    }),
  });
  return store.loadAdventure(started.sessionId);
}

function findStoryModule(adventure, moduleId) {
  return adventure.branchState.states.find(
    (state) =>
      state.entityType === "story_module" && state.state.moduleId === moduleId,
  );
}

test("deadlineDay 到期（含当天）时任务被系统确定性标记 expired，未到期不受影响", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    // 第 2 天：deadlineDay 3 未到，任务仍 active
    let after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-expiry-d2",
      turnId: "turn-expiry-d2",
      eventId: "event-expiry-d2",
      scene: "次日清晨，旅人继续在钟楼附近打听解药。",
      choice: "次日继续调查。",
      sceneTransition: { timeAdvance: "one_day" },
    });
    assert.equal(findStoryModule(after, "cure-poison").state.status, "active");

    // 第 3 天（期限最后一天，含当天到期）：任务未完成 → expired + 审计字段
    after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-expiry-d3",
      turnId: "turn-expiry-d3",
      eventId: "event-expiry-d3",
      scene: "第三天，解药仍无下落。",
      choice: "继续寻找解药。",
      sceneTransition: { timeAdvance: "one_day" },
    });
    const expired = findStoryModule(after, "cure-poison").state;
    assert.equal(expired.status, "expired");
    assert.equal(expired.expiredAtTurnId, "turn-expiry-d3");
    assert.match(expired.expiryReason, /期限/);

    // 过期状态稳定：后续回合不会被复活回 active，也不会被重复改写
    after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-expiry-d4",
      turnId: "turn-expiry-d4",
      eventId: "event-expiry-d4",
      scene: "第四天，城里下起了雨。",
      choice: "在钟楼避雨。",
      sceneTransition: { timeAdvance: "one_day" },
    });
    assert.equal(findStoryModule(after, "cure-poison").state.status, "expired");

    // expired 任务仍出现在 expiredDeadlines 导演级硬事实中（剧情后果由模型显现）
    const prompt = createStoryGenerationPrompt({
      adventure: after,
      turnId: "turn-expiry-prompt",
      resolvedPlayerTurn: {
        playerInput: {},
        displayMessage: "旅人在钟楼避雨。",
        effectiveStoryDirection: "找到解药。",
        previousStoryDirection: "找到解药。",
      },
    });
    assert.match(prompt.messages[1].content, /expiredDeadlines/);
    assert.match(prompt.messages[1].content, /cure-poison/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("到期任务不再作为接续/推荐对象，且完成当轮不被重复标记过期", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store, {
      storyModules: [
        {
          id: "cure-poison",
          title: "解毒",
          objective: "在三日内找到解药。",
          completionCriteria: ["取得解药并解毒"],
          prerequisiteModuleIds: [],
          deadlineDay: 3,
        },
        {
          id: "rescue-herb",
          title: "采摘药草",
          objective: "在第五日前取回城外药草。",
          completionCriteria: ["药草交给守钟人"],
          prerequisiteModuleIds: ["cure-poison"],
          deadlineDay: 5,
        },
      ],
      initialStoryModuleId: "cure-poison",
      initialStoryDirection: "找到解药。",
    });

    // 第 2 天：cure-poison 未到期
    let after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-chain-d2",
      turnId: "turn-chain-d2",
      eventId: "event-chain-d2",
      scene: "次日，旅人继续查访解药。",
      choice: "继续查访。",
      sceneTransition: { timeAdvance: "one_day" },
    });
    assert.equal(findStoryModule(after, "cure-poison").state.status, "active");

    // 第 3 天（cure-poison 期限当天）完成该任务：走完成路径 → completed 而非 expired
    after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-chain-d3",
      turnId: "turn-chain-d3",
      eventId: "event-chain-d3",
      scene: "旅人在城外找到了解药并完成解毒。",
      choice: "把解药交给守钟人。",
      sceneTransition: { timeAdvance: "one_day" },
      evaluation: {
        status: "completed",
        reason: "已经取得解药并解毒。",
        evidence: ["event-chain-d3"],
        continuity: "aligned",
        continuityReason: "解毒完成，后续药草线索自然衔接。",
        recommendedModuleId: null,
        suggestedNextDirection: {
          title: "追查药草",
          content: "追查城外药草的来源。",
          reason: "解毒完成后，药草成为新的线索。",
        },
      },
    });
    const completed = findStoryModule(after, "cure-poison").state;
    assert.equal(completed.status, "completed");
    assert.equal(completed.expiredAtTurnId, undefined);
    const queuedRescue = findStoryModule(after, "rescue-herb").state;
    assert.equal(queuedRescue.status, "queued");

    // 推进到第 6 天（rescue-herb 期限 5 已过）且模型同轮推荐该任务：
    // 兜底先标记 expired，推荐被系统拒绝 → 不会激活过期任务
    after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-chain-d6",
      turnId: "turn-chain-d6",
      eventId: "event-chain-d6",
      scene: "数日后，药草线索在城外中断。",
      choice: "赶往城外。",
      sceneTransition: { timeAdvance: "several_days" },
      evaluation: {
        status: "completed",
        reason: "追查药草的目标已经走到尽头。",
        evidence: ["event-chain-d6"],
        continuity: "aligned",
        continuityReason: "线索指向城外的药草田。",
        recommendedModuleId: "rescue-herb",
        suggestedNextDirection: null,
      },
    });
    const rescueState = findStoryModule(after, "rescue-herb").state;
    assert.equal(rescueState.status, "expired");
    assert.match(rescueState.expiryReason, /采摘药草/);
    const activeDirection = after.branchState.states.find(
      (state) => state.entityType === "story_direction" && state.isActive,
    );
    assert.equal(activeDirection, undefined);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expired 任务在剧情任务管理中属于终态：不可编辑、不可切换启用状态", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    // 一次性推进数日跨过期限（deadlineDay 3）
    let after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-expiry-manage",
      turnId: "turn-expiry-manage",
      eventId: "event-expiry-manage",
      scene: "数日后，解药线索彻底断绝。",
      choice: "在钟楼整理线索。",
      sceneTransition: { timeAdvance: "several_days" },
    });
    assert.equal(findStoryModule(after, "cure-poison").state.status, "expired");

    assert.throws(
      () =>
        store.manageStoryModule({
          actionId: "update-expired-task",
          sessionId: started.sessionId,
          operation: "update",
          moduleId: "cure-poison",
          module: {
            id: "cure-poison",
            title: "解毒（改）",
            objective: "在城内找解药。",
            completionCriteria: ["拿到解药"],
            activationConditions: [],
            prerequisiteModuleIds: [],
            continuityNotes: "",
            autoContinue: true,
          },
        }),
      /已过期/,
    );
    assert.throws(
      () =>
        store.manageStoryModule({
          actionId: "toggle-expired-task",
          sessionId: started.sessionId,
          operation: "set_active",
          moduleId: "cure-poison",
          active: false,
        }),
      /已过期/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("gameTimeDayNext 显式声明本回合结束日期（合法推进、与 timeAdvance 冲突时以其为准）", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);

    // 第 1 日 → gameTimeDayNext=3（未提供 timeAdvance）：日期直接推进到第 3 日
    const before = store.loadAdventure(started.sessionId);
    const advanced = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: before.branchState.branch.headTurnId,
        idempotencyKey: "request-daynext-3",
        customChoice: "连夜赶路。",
      }),
      createTurnId: () => "turn-daynext-3",
      generate: async () => ({
        content: turnContent(started, "旅人连日赶路，数日后抵达城外。", {
          eventId: "event-daynext-3",
          evidenceId: "event-daynext-3",
          sceneTransition: { gameTimeDayNext: 3 },
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    assert.equal(advanced.committedTurn.sequence, 2);
    let core = advanced.adventure.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(core.state.gameTimeDay, 3);
    assert.ok(
      advanced.adventure.branchState.recentTurns
        .at(-1)
        .stateChanges.some(
          (change) =>
            change.entityType === "session_state" &&
            change.reason.includes("gameTimeDayNext"),
        ),
      "gameTimeDayNext 显式声明的推进应写入审计原因",
    );

    // 第 3 日 → gameTimeDayNext=5 与 timeAdvance=one_day 冲突：警告且日期按 gameTimeDayNext=5
    const before2 = store.loadAdventure(started.sessionId);
    const conflicted = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: before2.branchState.branch.headTurnId,
        idempotencyKey: "request-daynext-conflict",
        customChoice: "继续赶路。",
      }),
      createTurnId: () => "turn-daynext-conflict",
      generate: async () => ({
        content: turnContent(started, "又过了两天，旅人抵达渡口。", {
          eventId: "event-daynext-conflict",
          evidenceId: "event-daynext-conflict",
          sceneTransition: { gameTimeDayNext: 5, timeAdvance: "one_day" },
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    core = conflicted.adventure.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(core.state.gameTimeDay, 5, "两者都提供时以 gameTimeDayNext 为准");
    const savedTurn = conflicted.adventure.branchState.recentTurns.find(
      (turn) => turn.id === "turn-daynext-conflict",
    );
    assert.ok(savedTurn, "冲突只产生警告，回合正常提交");
    assert.ok(
      (savedTurn.generatedOutput.warnings ?? []).some(
        (warning) =>
          warning.includes("gameTimeDayNext") && warning.includes("timeAdvance"),
      ),
      "与 timeAdvance 语义冲突时必须产生 normalizationWarning",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("时间短语一致性警告：正文暗示跨日但未声明日期推进时提醒且不拒绝", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);

    // 场景 A（e2e）：正文"次日"但未声明任何日期推进 → 警告且回合正常提交，日期不变
    const before = store.loadAdventure(started.sessionId);
    const nextDayTurn = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: before.branchState.branch.headTurnId,
        idempotencyKey: "request-phrase-nextday",
        customChoice: "等到第二天再调查。",
      }),
      createTurnId: () => "turn-phrase-nextday",
      generate: async () => ({
        content: turnContent(started, "次日清晨，旅人再次来到钟楼前。", {
          eventId: "event-phrase-nextday",
          evidenceId: "event-phrase-nextday",
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    assert.ok(nextDayTurn.committedTurn, "时间短语警告不拒绝回合");
    let core = nextDayTurn.adventure.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(core.state.gameTimeDay, 1, "未声明推进时日期保持第 1 日");
    const savedTurn = nextDayTurn.adventure.branchState.recentTurns.find(
      (turn) => turn.id === "turn-phrase-nextday",
    );
    assert.ok(
      (savedTurn.generatedOutput.warnings ?? []).some((warning) =>
        warning.includes("次日"),
      ),
      "正文出现跨日短语且日期未推进时必须产生警告",
    );

    // 后续场景（直接校验）：误报控制
    const adventure = store.loadAdventure(started.sessionId);
    const validTurn = (scene, sceneTransition) =>
      normalizeGeneratedTurnVersion(
        turnContent(started, scene, {
          eventId: "event-phrase-x",
          evidenceId: "event-phrase-x",
          sceneTransition,
        }),
      );

    // 场景 B：正文"数小时后" + timeAdvance=hours → 不警告（小时级推进合法）
    const hours = validateGeneratedTurn(
      validTurn("数小时后，钟楼外传来新的动静。", { timeAdvance: "hours" }),
      adventure,
      "turn-phrase-hours",
    );
    assert.ok(
      !hours.warnings.some((warning) => warning.includes("时间流逝短语")),
      "数小时后 + hours 不应触发警告",
    );

    // 场景 C：正文无时间词 → 不警告
    const silent = validateGeneratedTurn(
      validTurn("旅人与守钟人继续交谈。", {}),
      adventure,
      "turn-phrase-silent",
    );
    assert.ok(
      !silent.warnings.some((warning) => warning.includes("时间流逝短语")),
    );

    // 场景 D：正文"次日"但 timeAdvance=hours（hours 不跨天）→ 矛盾，警告
    const hoursConflict = validateGeneratedTurn(
      validTurn("次日清晨，旅人离开钟楼。", { timeAdvance: "hours" }),
      adventure,
      "turn-phrase-hours-conflict",
    );
    assert.ok(
      hoursConflict.warnings.some((warning) => warning.includes("次日")),
      "hours 不跨天但正文写次日属于矛盾，应警告",
    );

    // 场景 E：正文"数日后"但已声明 gameTimeDayNext → 不警告（已显式声明）
    const declared = validateGeneratedTurn(
      validTurn("数日后，旅人抵达城外。", { gameTimeDayNext: 4 }),
      adventure,
      "turn-phrase-declared",
    );
    assert.ok(
      !declared.warnings.some((warning) => warning.includes("时间流逝短语")),
      "已通过 gameTimeDayNext 声明日期推进时不警告",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("gameTimeDayNext 驱动的期限到期回归：任务 deadlineDay、触发器 deadline、词条 expiresAtDay 自动受益", async () => {  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store, {
      triggers: [
        {
          id: "deadline-flood",
          when: "玩家在第 2 天前完成堤坝加固",
          consequence: "山洪提前冲垮旧堤。",
          deadlineDay: 2,
          stateEffects: { flags: ["bad_end"] },
        },
      ],
    });
    store.manageCharacter(
      parseCharacterManagementInput({
        sessionId: started.sessionId,
        value: {
          actionId: "daynext-status-set",
          operation: "set_statuses",
          characterId: started.mainCharacterId,
          statuses: [
            {
              id: "poison-short",
              name: "速发毒",
              kind: "debuff",
              description: "毒性两日内发作",
              expiresAtDay: 2,
            },
          ],
        },
      }),
    );

    // 第一回合缺省（第 1 日）：期限未到，任务仍 active、触发器未触发、词条保留
    let after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-daynext-before",
      turnId: "turn-daynext-before",
      eventId: "event-daynext-before",
      scene: "旅人继续在钟楼附近打听。",
      choice: "继续调查。",
    });
    assert.equal(findStoryModule(after, "cure-poison").state.status, "active");
    assert.equal(
      after.branchState.states.find(
        (state) =>
          state.entityType === "plot_trigger" &&
          state.state.triggerId === "deadline-flood",
      ).state.status,
      "armed",
    );
    const playerState = after.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(playerState.state.statuses.length, 1);

    // 第二回合 gameTimeDayNext=3（跨过任务期限 3 与触发器期限 2，词条到期日 2）：
    // 任务 expired、触发器强制 fire、到期词条自动移除
    after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-daynext-expiry",
      turnId: "turn-daynext-expiry",
      eventId: "event-daynext-expiry",
      scene: "数日后，解药仍无下落，山洪却已逼近。",
      choice: "继续寻找解药。",
      sceneTransition: { gameTimeDayNext: 3 },
    });
    const core = after.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(core.state.gameTimeDay, 3);
    const expired = findStoryModule(after, "cure-poison").state;
    assert.equal(expired.status, "expired");
    assert.equal(expired.expiredAtTurnId, "turn-daynext-expiry");
    const trigger = after.branchState.states.find(
      (state) =>
        state.entityType === "plot_trigger" &&
        state.state.triggerId === "deadline-flood",
    );
    assert.equal(trigger.state.status, "fired", "触发器 deadline 到期自动强制 fire");
    assert.match(trigger.state.fireReason, /期限/);
    assert.equal(core.state.badEnd, true, "触发器 stateEffects 随到期 fire 强制应用");
    const playerAfter = after.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(
      playerAfter.state.statuses.length,
      0,
      "expiresAtDay ≤ 当前日期的词条随日期推进自动移除",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function findCore(adventure) {
  return adventure.branchState.states.find(
    (state) => state.entityType === "session_state" && state.entityId === "core",
  );
}

test("五回合一天：切换后每回合推进一个时段、每 5 回合进入下一天，时段由 phaseOffset 推导", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);

    // story → turn_based：日期保留、phaseOffset 置 0
    const switched = store.updateTimeMode(started.sessionId, "turn_based");
    assert.equal(switched.timeMode, "turn_based");
    assert.equal(switched.phaseOffset, 0);
    assert.equal(switched.gameTimeDay, 1, "切换不改变当前游戏内日期");
    let adventure = store.loadAdventure(started.sessionId);
    assert.equal(findCore(adventure).state.timeMode, "turn_based");
    assert.equal(findCore(adventure).state.phaseOffset, 0);

    // 连续 6 回合：每回合开始时时段依次为
    // 早上→上午→中午→下午→晚上→早上；第 5 回合结束进入第 2 天
    const expectedPhases = ["早上", "上午", "中午", "下午", "晚上", "早上"];
    for (const [index, expectedPhase] of expectedPhases.entries()) {
      const turnNumber = index + 1;
      const before = store.loadAdventure(started.sessionId);
      const coreBefore = findCore(before).state;
      assert.equal(
        dayPhaseOf(coreBefore.phaseOffset),
        expectedPhase,
        `第 ${turnNumber} 回合开始时应处于「${expectedPhase}」时段`,
      );
      await advanceAdventureTurn({
        store,
        sessionId: started.sessionId,
        input: parsePlayerTurnRequest({
          expectedHeadTurnId: before.branchState.branch.headTurnId,
          idempotencyKey: `request-tb-${turnNumber}`,
          customChoice: `第 ${turnNumber} 回合继续调查。`,
        }),
        createTurnId: () => `turn-tb-${turnNumber}`,
        generate: async () => ({
          content: turnContent(started, `旅人继续在钟楼调查（回合 ${turnNumber}）。`, {
            eventId: `event-tb-${turnNumber}`,
            evidenceId: `event-tb-${turnNumber}`,
          }),
          model: "deepseek-v4-flash",
          usage: {},
        }),
      });
      adventure = store.loadAdventure(started.sessionId);
      const core = findCore(adventure).state;
      assert.equal(
        core.phaseOffset,
        turnNumber,
        `第 ${turnNumber} 回合提交后 phaseOffset 应为 ${turnNumber}`,
      );
      assert.equal(
        core.gameTimeDay,
        turnNumber >= 5 ? 2 : 1,
        `第 ${turnNumber} 回合提交后游戏内日期`,
      );
      // 历史回看还原：提交后 phaseOffset 快照反推本回合时段
      const savedTurn = adventure.branchState.recentTurns.find(
        (turn) => turn.id === `turn-tb-${turnNumber}`,
      );
      const phaseChange = savedTurn.stateChanges.find(
        (change) =>
          change.entityType === "session_state" &&
          change.entityId === "core" &&
          typeof change.payload.phaseOffset === "number",
      );
      assert.ok(phaseChange, "回合提交应记录 phaseOffset 状态变更快照");
      assert.equal(
        dayPhaseOf(phaseChange.payload.phaseOffset - 1),
        expectedPhase,
        `第 ${turnNumber} 回合历史回看时段应还原为「${expectedPhase}」`,
      );
    }
    assert.equal(findCore(adventure).state.gameTimeDay, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("五回合一天：模型输出的 timeAdvance / gameTimeDayNext 被忽略，日期仍按回合推导", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    store.updateTimeMode(started.sessionId, "turn_based");

    const before = store.loadAdventure(started.sessionId);
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: before.branchState.branch.headTurnId,
        idempotencyKey: "request-tb-ignored",
        customChoice: "继续调查。",
      }),
      createTurnId: () => "turn-tb-ignored",
      generate: async () => ({
        content: turnContent(started, "旅人连日赶路，数日后抵达城外。", {
          eventId: "event-tb-ignored",
          evidenceId: "event-tb-ignored",
          sceneTransition: { timeAdvance: "several_days", gameTimeDayNext: 99 },
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    const core = findCore(store.loadAdventure(started.sessionId)).state;
    assert.equal(core.phaseOffset, 1, "模型声明不改变 phaseOffset 推进");
    assert.equal(
      core.gameTimeDay,
      1,
      "turn_based 下 timeAdvance/gameTimeDayNext 被忽略，日期只由回合推导",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("时间模式切换：turn_based → story 恢复剧情驱动推进，切回 turn_based 重新置 0", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    store.updateTimeMode(started.sessionId, "turn_based");

    // 推进 6 回合：第 2 天、phaseOffset 6
    for (const index of [1, 2, 3, 4, 5, 6]) {
      const before = store.loadAdventure(started.sessionId);
      await advanceAdventureTurn({
        store,
        sessionId: started.sessionId,
        input: parsePlayerTurnRequest({
          expectedHeadTurnId: before.branchState.branch.headTurnId,
          idempotencyKey: `request-tb-switch-${index}`,
          customChoice: "继续调查。",
        }),
        createTurnId: () => `turn-tb-switch-${index}`,
        generate: async () => ({
          content: turnContent(started, "旅人在钟楼调查。", {
            eventId: `event-tb-switch-${index}`,
            evidenceId: `event-tb-switch-${index}`,
          }),
          model: "deepseek-v4-flash",
          usage: {},
        }),
      });
    }
    let core = findCore(store.loadAdventure(started.sessionId)).state;
    assert.equal(core.gameTimeDay, 2);
    assert.equal(core.phaseOffset, 6);

    // 切回 story：phaseOffset 不再维护，恢复模型驱动
    const switched = store.updateTimeMode(started.sessionId, "story");
    assert.equal(switched.timeMode, "story");
    core = findCore(store.loadAdventure(started.sessionId)).state;
    assert.equal(core.gameTimeDay, 2, "切回 story 保持当前日期");

    // 缺省回合（无 timeAdvance）：日期不再自动推进
    let before = store.loadAdventure(started.sessionId);
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: before.branchState.branch.headTurnId,
        idempotencyKey: "request-story-default",
        customChoice: "在钟楼整理线索。",
      }),
      createTurnId: () => "turn-story-default",
      generate: async () => ({
        content: turnContent(started, "旅人在钟楼整理线索。", {
          eventId: "event-story-default",
          evidenceId: "event-story-default",
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    core = findCore(store.loadAdventure(started.sessionId)).state;
    assert.equal(core.gameTimeDay, 2, "story 模式缺省回合不推进日期");

    // 剧情显式推进一天：one_day 生效
    before = store.loadAdventure(started.sessionId);
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: before.branchState.branch.headTurnId,
        idempotencyKey: "request-story-oneday",
        customChoice: "等到第二天再调查。",
      }),
      createTurnId: () => "turn-story-oneday",
      generate: async () => ({
        content: turnContent(started, "次日清晨，旅人再次来到钟楼。", {
          eventId: "event-story-oneday",
          evidenceId: "event-story-oneday",
          sceneTransition: { timeAdvance: "one_day" },
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    core = findCore(store.loadAdventure(started.sessionId)).state;
    assert.equal(core.gameTimeDay, 3, "story 模式下 timeAdvance 恢复生效");

    // 再次切回 turn_based：日期保留、phaseOffset 重新置 0
    const switchedBack = store.updateTimeMode(started.sessionId, "turn_based");
    assert.equal(switchedBack.phaseOffset, 0);
    assert.equal(switchedBack.gameTimeDay, 3);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("五回合一天：任务 deadlineDay 与触发器 deadline 按天到期（第 6 回合 = 第 2 天）", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store, {
      storyModules: [
        {
          id: "two-day-task",
          title: "两日内完成任务",
          objective: "在两天内找到解药。",
          completionCriteria: ["取得解药"],
          prerequisiteModuleIds: [],
          deadlineDay: 2,
        },
      ],
      initialStoryModuleId: "two-day-task",
      initialStoryDirection: "找到解药。",
      triggers: [
        {
          id: "two-day-flood",
          when: "玩家在第 2 天前完成堤坝加固",
          consequence: "山洪冲垮旧堤。",
          deadlineDay: 2,
          stateEffects: { flags: ["bad_end"] },
        },
      ],
    });
    store.updateTimeMode(started.sessionId, "turn_based");

    // 前 4 回合（第 1 天）：期限未到，任务 active、触发器 armed
    for (const index of [1, 2, 3, 4]) {
      await advanceOneTurn(store, started, {
        idempotencyKey: `request-tb-deadline-before-${index}`,
        turnId: `turn-tb-deadline-before-${index}`,
        eventId: `event-tb-deadline-before-${index}`,
        scene: "旅人继续在钟楼附近打听。",
        choice: "继续调查。",
      });
    }
    let after = store.loadAdventure(started.sessionId);
    assert.equal(findStoryModule(after, "two-day-task").state.status, "active");
    assert.equal(
      after.branchState.states.find(
        (state) =>
          state.entityType === "plot_trigger" &&
          state.state.triggerId === "two-day-flood",
      ).state.status,
      "armed",
    );

    // 第 5 回合结束进入第 2 天（deadlineDay=2 当天）：任务 expired、触发器强制 fire
    after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-tb-deadline-day2",
      turnId: "turn-tb-deadline-day2",
      eventId: "event-tb-deadline-day2",
      scene: "第二天，解药仍无下落。",
      choice: "继续寻找解药。",
    });
    const core = findCore(after).state;
    assert.equal(core.gameTimeDay, 2, "第 5 回合结束应进入第 2 天");
    assert.equal(
      findStoryModule(after, "two-day-task").state.status,
      "expired",
      "deadlineDay=2 在第 2 天（第 5 回合）到期",
    );
    const trigger = after.branchState.states.find(
      (state) =>
        state.entityType === "plot_trigger" &&
        state.state.triggerId === "two-day-flood",
    );
    assert.equal(trigger.state.status, "fired", "触发器 deadline 到期强制 fire");
    assert.match(trigger.state.fireReason, /期限/);
    assert.equal(core.badEnd, true, "触发器 stateEffects 随到期 fire 强制应用");

    // 第 6 回合（仍在第 2 天）：过期状态稳定，不重复改写
    after = await advanceOneTurn(store, started, {
      idempotencyKey: "request-tb-deadline-day2b",
      turnId: "turn-tb-deadline-day2b",
      eventId: "event-tb-deadline-day2b",
      scene: "雨下个不停。",
      choice: "在钟楼避雨。",
    });
    assert.equal(findCore(after).state.gameTimeDay, 2);
    assert.equal(findStoryModule(after, "two-day-task").state.status, "expired");
    assert.equal(
      after.branchState.states.find(
        (state) =>
          state.entityType === "plot_trigger" &&
          state.state.triggerId === "two-day-flood",
      ).state.status,
      "fired",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("五回合一天：正文出现跨日短语不触发时间短语一致性警告（日期由回合驱动）", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    store.updateTimeMode(started.sessionId, "turn_based");

    // e2e：正文"次日"但未声明任何日期推进 → turn_based 下不产生警告，回合正常提交
    const before = store.loadAdventure(started.sessionId);
    const turn = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: before.branchState.branch.headTurnId,
        idempotencyKey: "request-tb-phrase",
        customChoice: "继续调查。",
      }),
      createTurnId: () => "turn-tb-phrase",
      generate: async () => ({
        content: turnContent(started, "次日清晨，旅人再次来到钟楼前。", {
          eventId: "event-tb-phrase",
          evidenceId: "event-tb-phrase",
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    assert.ok(turn.committedTurn, "回合正常提交");
    const savedTurn = turn.adventure.branchState.recentTurns.find(
      (item) => item.id === "turn-tb-phrase",
    );
    assert.ok(
      !(savedTurn.generatedOutput.warnings ?? []).some((warning) =>
        warning.includes("时间流逝短语"),
      ),
      "turn_based 下正文跨日短语不应触发时间短语一致性警告",
    );

    // 直接校验：story 模式下同样的正文会警告（对比，确认分流生效）
    const adventure = store.loadAdventure(started.sessionId);
    const storyAdventure = {
      ...adventure,
      branchState: {
        ...adventure.branchState,
        states: adventure.branchState.states.map((state) =>
          state.entityType === "session_state" && state.entityId === "core"
            ? { ...state, state: { ...state.state, timeMode: "story" } }
            : state,
        ),
      },
    };
    const storyValidated = validateGeneratedTurn(
      normalizeGeneratedTurnVersion(
        turnContent(started, "次日清晨，旅人再次来到钟楼前。", {
          eventId: "event-story-phrase",
          evidenceId: "event-story-phrase",
        }),
      ),
      storyAdventure,
      "turn-story-phrase",
      { timeMode: "story" },
    );
    assert.ok(
      storyValidated.warnings.some((warning) =>
        warning.includes("时间流逝短语"),
      ),
      "story 模式下同样的正文应触发时间短语一致性警告",
    );

    // turn_based 校验路径：同正文不警告
    const turnBasedValidated = validateGeneratedTurn(
      normalizeGeneratedTurnVersion(
        turnContent(started, "次日清晨，旅人再次来到钟楼前。", {
          eventId: "event-tb-phrase-direct",
          evidenceId: "event-tb-phrase-direct",
        }),
      ),
      adventure,
      "turn-tb-phrase-direct",
      { timeMode: "turn_based" },
    );
    assert.ok(
      !turnBasedValidated.warnings.some((warning) =>
        warning.includes("时间流逝短语"),
      ),
      "validateGeneratedTurn 传入 turn_based 时不产生时间短语警告",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("旧会话兼容：缺失 timeMode/phaseOffset 字段按 story 模式处理", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    // 模拟旧存档：去掉 timeMode / phaseOffset 字段
    database.exec(`
      UPDATE materialized_states
      SET state_json = json_remove(state_json, '$.timeMode', '$.phaseOffset')
      WHERE session_id = '${started.sessionId}'
        AND entity_type = 'session_state' AND entity_id = 'core'
    `);
    let core = findCore(store.loadAdventure(started.sessionId)).state;
    assert.equal(core.timeMode, undefined);
    assert.equal(core.phaseOffset, undefined);

    // 缺省回合：日期不推进（story 语义），不写 phaseOffset
    const before = store.loadAdventure(started.sessionId);
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: before.branchState.branch.headTurnId,
        idempotencyKey: "request-legacy-default",
        customChoice: "继续调查钟楼。",
      }),
      createTurnId: () => "turn-legacy-default",
      generate: async () => ({
        content: turnContent(started, "旅人记录下铜钟的逆流规律。", {
          eventId: "event-legacy-default",
          evidenceId: "event-legacy-default",
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    core = findCore(store.loadAdventure(started.sessionId)).state;
    assert.equal(core.gameTimeDay, 1, "旧会话缺省回合不推进日期");
    assert.equal(core.phaseOffset, undefined, "story 模式不写 phaseOffset");

    // 校验层缺省：不带 timeMode 参数时按 story 处理（跨日短语警告仍触发）
    const adventure = store.loadAdventure(started.sessionId);
    const validated = validateGeneratedTurn(
      normalizeGeneratedTurnVersion(
        turnContent(started, "次日清晨，旅人再次来到钟楼。", {
          eventId: "event-legacy-phrase",
          evidenceId: "event-legacy-phrase",
        }),
      ),
      adventure,
      "turn-legacy-phrase",
    );
    assert.ok(
      validated.warnings.some((warning) => warning.includes("时间流逝短语")),
      "缺失 timeMode 时校验按 story 模式处理，跨日短语警告保留",
    );

    // 旧档仍可正常切换为 turn_based：日期保留、phaseOffset 0
    const switched = store.updateTimeMode(started.sessionId, "turn_based");
    assert.equal(switched.phaseOffset, 0);
    assert.equal(switched.gameTimeDay, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
