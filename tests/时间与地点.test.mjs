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

test("game time advances by one day per turn by default", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    const adventure = store.loadAdventure(started.sessionId);
    const core = adventure.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(core.state.gameTimeDay, 1);

    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "request-time-1",
        customChoice: "继续调查钟楼。",
      }),
      createTurnId: () => "turn-time-1",
      generate: async () => ({
        content: turnContent(started, "旅人记录下铜钟的逆流规律。"),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });

    const after = store.loadAdventure(started.sessionId);
    const coreAfter = after.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(coreAfter.state.gameTimeDay, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("sceneTransition timeAdvance overrides day progression", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = startP1Adventure(store);
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "request-time-2",
        customChoice: "原地修整片刻。",
      }),
      createTurnId: () => "turn-time-2",
      generate: async () => ({
        content: turnContent(started, "旅人守在钟楼内等候消息。", {
          sceneTransition: { timeAdvance: "moment" },
        }),
        model: "deepseek-v4-flash",
        usage: {},
      }),
    });
    const after = store.loadAdventure(started.sessionId);
    const core = after.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    );
    assert.equal(core.state.gameTimeDay, 1);

    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: after.branchState.branch.headTurnId,
        idempotencyKey: "request-time-3",
        customChoice: "前往城外追查。",
      }),
      createTurnId: () => "turn-time-3",
      generate: async () => ({
        content: turnContent(started, "旅人连夜赶路数日，抵达城外。", {
          eventId: "event-p1b",
          evidenceId: "event-p1b",
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
