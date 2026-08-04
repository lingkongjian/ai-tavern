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
