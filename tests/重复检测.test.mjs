import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import {
  detectSceneRepetition,
  sceneSimilarity,
} from "../lib/story/重复检测.ts";
import { parsePlayerTurnRequest } from "../lib/story/回合协议.ts";
import { advanceAdventureTurn } from "../lib/story/回合服务.ts";
import { parseStartAdventureInput } from "../lib/story/开局.ts";
import { parseAdventureBundleDocument } from "../lib/import/剧本包.ts";

const migrationsDir = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "drizzle",
);

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "ai-tavern-p0-"));
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

function validTurnContent(started, scene) {
  return {
    schemaVersion: "1.0",
    turn: {
      scene,
      events: [
        {
          id: "event-p0",
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
        evidence: ["event-p0"],
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

test("scene similarity distinguishes repeated and advancing scenes", () => {
  const opening =
    "旅人在黄昏来到钟楼。守钟人把钥匙压在掌心，平静地等着旅人开口。";
  const repeated =
    "旅人在黄昏来到钟楼。守钟人把钥匙压在掌心，平静地等着旅人开口。这一次，她向前迈了一步。";
  const advanced =
    "守钟人侧身让开，旅人看见石室中央的铜钟正逆流滴水，水珠沿钟身向上攀爬。";

  const repetition = detectSceneRepetition(repeated, opening);
  assert.equal(repetition.repeated, true);
  assert.ok(repetition.similarity > 0.55);

  const advancing = detectSceneRepetition(advanced, opening);
  assert.equal(advancing.repeated, false);
  assert.ok(advancing.similarity < 0.4);

  assert.ok(sceneSimilarity("", opening) === 0);
  assert.ok(sceneSimilarity(opening, "") === 0);
});

test("repeated scene triggers one advancement repair and commits the fixed turn", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = store.startAdventure({
      campaignName: "重复检测测试",
      world: { name: "潮汐城", premise: "钟声改变潮水。" },
      player: { name: "旅人", description: "测绘师。" },
      mainCharacter: {
        name: "守钟人",
        role: "钟楼看守",
        personality: "警觉但守信。",
        firstMessage: "钟还没有敲响。",
      },
      openingScene:
        "旅人在黄昏来到钟楼。守钟人把钥匙压在掌心，平静地等着旅人开口。",
      storyModules: [],
    });

    const turnId = "turn-repeat";
    let generationCalls = 0;
    const repairMessages = [];
    const repeatedScene =
      "旅人在黄昏来到钟楼。守钟人把钥匙压在掌心，平静地等着旅人开口。这一次，她向前迈了一步。";
    const advancedScene =
      "守钟人侧身让开，旅人看见石室中央的铜钟正逆流滴水，水珠沿钟身向上攀爬。";

    const result = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "request-repeat",
        customChoice: "继续观察钟楼内部。",
      }),
      createTurnId: () => turnId,
      generate: async (messages) => {
        generationCalls += 1;
        if (generationCalls === 1) {
          return {
            content: validTurnContent(started, repeatedScene),
            model: "deepseek-v4-flash",
            usage: { totalTokens: 800 },
          };
        }
        repairMessages.push(messages.at(-1).content);
        return {
          content: validTurnContent(started, advancedScene),
          model: "deepseek-v4-flash",
          usage: { totalTokens: 900 },
        };
      },
    });

    assert.equal(generationCalls, 2);
    assert.match(repairMessages[0], /高度重复/);
    assert.match(repairMessages[0], /推进剧情/);
    assert.equal(result.committedTurn.sequence, 2);
    assert.equal(
      result.adventure.branchState.recentTurns.at(-1).generatedOutput.turn
        .scene,
      advancedScene,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persistently repeated scenes fail the turn without committing", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = store.startAdventure({
      campaignName: "重复检测失败测试",
      world: { name: "潮汐城", premise: "钟声改变潮水。" },
      player: { name: "旅人", description: "测绘师。" },
      mainCharacter: {
        name: "守钟人",
        role: "钟楼看守",
        personality: "警觉但守信。",
      },
      openingScene:
        "旅人在黄昏来到钟楼。守钟人把钥匙压在掌心，平静地等着旅人开口。",
      storyModules: [],
    });

    const repeatedScene =
      "旅人在黄昏来到钟楼。守钟人把钥匙压在掌心，平静地等着旅人开口。这一次，她向前迈了一步。";
    await assert.rejects(
      advanceAdventureTurn({
        store,
        sessionId: started.sessionId,
        input: parsePlayerTurnRequest({
          expectedHeadTurnId: started.openingTurnId,
          idempotencyKey: "request-repeat-fail",
          customChoice: "继续观察钟楼内部。",
        }),
        createTurnId: () => "turn-repeat-fail",
        generate: async () => ({
          content: validTurnContent(started, repeatedScene),
          model: "deepseek-v4-flash",
          usage: { totalTokens: 800 },
        }),
      }),
      (error) =>
        error instanceof Error && error.message.includes("高度重复"),
    );

    const adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.headTurnId, started.openingTurnId);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("start adventure materializes declared initial relationships", async () => {
  const { directory, database, store } = temporaryDatabase();
  try {
    const started = store.startAdventure({
      campaignName: "初始关系测试",
      world: { name: "雪域", premise: "长夜无星。" },
      player: { name: "旅人", description: "测绘师。" },
      mainCharacter: {
        name: "守钟人",
        role: "钟楼看守",
        personality: "警觉但守信。",
      },
      additionalCharacters: [
        {
          name: "老匠人",
          role: "铜钟铸师",
          personality: "寡言。",
          initiallyPresent: false,
        },
      ],
      openingScene: "旅人抵达钟楼。",
      initialRelationships: [
        {
          sourceCharacterName: "旅人",
          targetCharacterName: "守钟人",
          dimensions: { trust: 60, affinity: 70, respect: 80 },
          summary: "同门师兄妹，多年未联络。",
        },
        {
          sourceCharacterName: "守钟人",
          targetCharacterName: "老匠人",
          dimensions: { fear: 25, hostility: 10 },
          summary: "守钟人对铸师心存忌惮。",
        },
      ],
    });

    const adventure = store.loadAdventure(started.sessionId);
    const relationships = adventure.branchState.states.filter(
      (state) => state.entityType === "relationship",
    );
    const byPair = new Map(
      relationships.map((state) => [
        `${state.state.sourceCharacterId}:${state.state.targetCharacterId}`,
        state.state,
      ]),
    );
    const playerMain = byPair.get(
      `${started.playerCharacterId}:${started.mainCharacterId}`,
    );
    assert.equal(playerMain.trust, 60);
    assert.equal(playerMain.affinity, 70);
    assert.equal(playerMain.respect, 80);
    assert.equal(playerMain.summary, "同门师兄妹，多年未联络。");

    const reversePlayerMain = byPair.get(
      `${started.mainCharacterId}:${started.playerCharacterId}`,
    );
    assert.equal(reversePlayerMain.trust, 60);
    assert.equal(reversePlayerMain.affinity, 70);
    assert.equal(reversePlayerMain.summary, "同门师兄妹，多年未联络。");

    const mainMainId = started.additionalCharacterIds[0];
    const mainExtra = byPair.get(
      `${started.mainCharacterId}:${mainMainId}`,
    );
    assert.equal(mainExtra.fear, 25);
    assert.equal(mainExtra.hostility, 10);
    assert.equal(mainExtra.trust, 0);

    const reverseMainExtra = byPair.get(
      `${mainMainId}:${started.mainCharacterId}`,
    );
    assert.equal(reverseMainExtra.fear, 25);
    assert.equal(reverseMainExtra.hostility, 10);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("initial relationships in a bundle import resolve against character names", async () => {
  const document = {
    spec: "ai_tavern_adventure_bundle_v1",
    spec_version: "1.1",
    name: "初始关系剧本包",
    description: "用于校验初始关系分区。",
    creator: "测试",
    bundle_version: "1.0",
    adventure: {
      campaignName: "初始关系剧本",
      campaignDescription: "测试",
      world: { name: "雪域", premise: "长夜无星。" },
      player: {
        description: "一名测绘师。",
        card: {
          spec: "chara_card_v2",
          spec_version: "2.0",
          data: { name: "旅人", description: "测绘师" },
        },
      },
      mainCharacter: {
        card: {
          spec: "chara_card_v2",
          spec_version: "2.0",
          data: { name: "守钟人", description: "钟楼看守", personality: "警觉" },
        },
      },
      additionalCharacters: [],
      worldBook: {
        spec: "ai_tavern_world_book_v1",
        spec_version: "1.0",
        name: "雪域世界书",
        entries: [
          {
            id: "world-1",
            comment: "长夜",
            keys: ["长夜"],
            content: "雪域的长夜持续数月。",
            enabled: true,
            constant: true,
          },
        ],
      },
      opening: {
        locationName: "钟楼",
        scene: "旅人抵达钟楼，守钟人正在等待。",
        initialStoryDirection: "查明铜钟的秘密。",
      },
      initialRelationships: [
        {
          sourceCharacterName: "旅人",
          targetCharacterName: "守钟人",
          dimensions: { trust: 55, affinity: 40 },
          summary: "旧识，重逢时彼此试探。",
        },
      ],
    },
  };

  const parsed = parseAdventureBundleDocument(document);
  const started = parsed.adventure;
  assert.deepEqual(
    started.initialRelationships,
    [
      {
        sourceCharacterName: "旅人",
        targetCharacterName: "守钟人",
        dimensions: { trust: 55, affinity: 40 },
        summary: "旧识，重逢时彼此试探。",
      },
    ],
  );

  const parsedInput = parseStartAdventureInput({
    ...started,
    player: { ...started.player },
    mainCharacter: { ...started.mainCharacter },
    additionalCharacters: [],
    openingScene: started.openingScene,
    world: started.world,
  });
  assert.equal(parsedInput.initialRelationships.length, 1);
});
