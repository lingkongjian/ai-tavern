import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import {
  AdventureInputError,
  parseStartAdventureInput,
} from "../lib/story/开局.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

const validInput = {
  campaignName: "雾港余烬",
  campaignDescription: "一场本地测试冒险。",
  timeMode: "story",
  world: {
    name: "灰潮群岛",
    premise: "群岛依靠潮汐灯塔维持航线。",
  },
  player: {
    name: "沈砚",
    description: "寻找失踪兄长的测绘师。",
  },
  mainCharacter: {
    name: "伊芙琳",
    role: "守灯人",
    personality: "克制、警觉，不轻易作出承诺。",
    firstMessage: "关上门，今晚的雾会听见名字。",
  },
  additionalCharacters: [
    {
      name: "米洛",
      role: "负责检查异常船骸的潮汐教会司祭。",
      personality: "温和而执拗，会质疑教会隐瞒事实的命令。",
      firstMessage: "别碰那张海图，它昨晚还没有这条航线。",
    },
  ],
  openingScene: "午夜，守灯人走进只剩一位客人的酒馆。",
  initialStoryDirection: "逐步揭开灯塔沉默的原因。",
};

test("validates setup input and rejects incomplete adventures", () => {
  assert.deepEqual(parseStartAdventureInput(validInput), validInput);
  assert.throws(
    () => parseStartAdventureInput({ campaignName: "" }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.includes("战役名称不能为空。") &&
      error.issues.length >= 8,
  );
  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        additionalCharacters: [
          {
            name: "伊芙琳",
            role: "重名角色",
            personality: "用于验证重名拦截。",
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.includes("同一剧本中的角色姓名不能重复。"),
  );
});

test("accepts legacy affinity alias as affection for initial relationships", () => {
  const withAffinity = parseStartAdventureInput({
    ...validInput,
    initialRelationships: [
      {
        sourceCharacterName: "沈砚",
        targetCharacterName: "伊芙琳",
        dimensions: { trust: 60, affinity: 70, respect: 80 },
        summary: "旧识。",
      },
    ],
  });
  assert.deepEqual(
    withAffinity.initialRelationships?.[0].dimensions,
    { trust: 60, affection: 70, respect: 80 },
  );

  const bothKeys = parseStartAdventureInput({
    ...validInput,
    initialRelationships: [
      {
        sourceCharacterName: "沈砚",
        targetCharacterName: "伊芙琳",
        dimensions: { affection: 40, affinity: 90 },
      },
    ],
  });
  assert.deepEqual(bothKeys.initialRelationships?.[0].dimensions, {
    affection: 40,
  });

  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        initialRelationships: [
          {
            sourceCharacterName: "沈砚",
            targetCharacterName: "伊芙琳",
            dimensions: { affinity: 300 },
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.some((issue) => issue.includes("affinity")),
  );
});

test("initial relationship type: enum validation and acquaintances default", () => {
  // 合法类型透传
  const withType = parseStartAdventureInput({
    ...validInput,
    initialRelationships: [
      {
        sourceCharacterName: "沈砚",
        targetCharacterName: "伊芙琳",
        type: "family",
      },
    ],
  });
  assert.equal(withType.initialRelationships?.[0].type, "family");

  // 缺省：不输出 type（物化时按 acquaintances 处理）
  const withoutType = parseStartAdventureInput({
    ...validInput,
    initialRelationships: [
      {
        sourceCharacterName: "沈砚",
        targetCharacterName: "伊芙琳",
      },
    ],
  });
  assert.equal(withoutType.initialRelationships?.[0].type, undefined);

  // 非法枚举拒绝
  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        initialRelationships: [
          {
            sourceCharacterName: "沈砚",
            targetCharacterName: "伊芙琳",
            type: "siblings",
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.some((issue) => issue.includes("type")),
  );
});

test("validates and materializes initial statuses for each character", () => {
  const withStatuses = parseStartAdventureInput({
    ...validInput,
    initialStatuses: [
      {
        characterName: "沈砚",
        statuses: [
          {
            id: "shenyan-lamp-dust",
            name: "灯尘入体",
            kind: "debuff",
            hidden: true,
            description: "常年接触档案馆的失魂灯芯，体内积有灯尘，沈砚自己尚未察觉。",
            expiresAtDay: 12,
          },
          {
            id: "shenyan-brisk",
            name: "海风提神",
            kind: "buff",
            description: "海风带来的短时清醒。",
          },
        ],
      },
      {
        characterName: "伊芙琳",
        statuses: [
          {
            id: "evelyn-old-wound",
            name: "旧伤",
            kind: "debuff",
            description: "左臂旧伤在雨夜隐隐作痛。",
            expiresAtDay: 5,
          },
        ],
      },
    ],
  });
  assert.deepEqual(withStatuses.initialStatuses, [
    {
      characterName: "沈砚",
      statuses: [
        {
          id: "shenyan-lamp-dust",
          name: "灯尘入体",
          kind: "debuff",
          hidden: true,
          description: "常年接触档案馆的失魂灯芯，体内积有灯尘，沈砚自己尚未察觉。",
          expiresAtDay: 12,
        },
        {
          id: "shenyan-brisk",
          name: "海风提神",
          kind: "buff",
          description: "海风带来的短时清醒。",
        },
      ],
    },
    {
      characterName: "伊芙琳",
      statuses: [
        {
          id: "evelyn-old-wound",
          name: "旧伤",
          kind: "debuff",
          description: "左臂旧伤在雨夜隐隐作痛。",
          expiresAtDay: 5,
        },
      ],
    },
  ]);

  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        initialStatuses: [
          {
            characterName: "路人甲",
            statuses: [
              {
                id: "passerby-status",
                name: "发烧",
                kind: "debuff",
                description: "高烧不退。",
              },
            ],
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.some((issue) =>
        issue.includes("不在剧本角色中"),
      ),
  );

  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        initialStatuses: [
          {
            characterName: "沈砚",
            statuses: [
              {
                id: "bad-kind",
                name: "未知类型",
                kind: "curse",
                description: "类型不在白名单中。",
              },
            ],
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.some((issue) => issue.includes("kind 必须是 buff、debuff 之一")),
  );

  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        initialStatuses: [
          {
            characterName: "沈砚",
            statuses: Array.from({ length: 21 }, (_, index) => ({
              id: `status-${index}`,
              name: `状态${index}`,
              kind: "debuff",
              description: "词条",
            })),
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.some((issue) => issue.includes("最多允许 20 条状态词条")),
  );

  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        initialStatuses: Array.from({ length: 61 }, (_, index) => ({
          characterName: "沈砚",
          statuses: [
            {
              id: `entry-${index}`,
              name: "重复状态",
              kind: "debuff",
              description: "条目数量超过上限。",
            },
          ],
        })),
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.some((issue) => issue.includes("最多允许 60 个角色条目")),
  );

  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        initialStatuses: [
          {
            characterName: "沈砚",
            statuses: [
              {
                id: "duplicate",
                name: "词条一",
                kind: "debuff",
                description: "第一项",
              },
              {
                id: "duplicate",
                name: "词条二",
                kind: "debuff",
                description: "第二项",
              },
            ],
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.some((issue) => issue.includes("状态词条 ID duplicate 重复")),
  );
});

test("rejects invalid trigger deadlines and accepts explicit no-deadline", () => {
  const trigger = {
    id: "trigger-deadline",
    when: "主角在期限前仍未完成约定",
    consequence: "约定落空，势力转向敌对。",
  };
  for (const deadline of [0, 1.5, -3, "abc"]) {
    assert.throws(
      () =>
        parseStartAdventureInput({
          ...validInput,
          triggers: [{ ...trigger, deadline }],
        }),
      (error) =>
        error instanceof AdventureInputError &&
        error.issues.some((issue) =>
          issue.includes("deadline 必须是 1 到 10000 之间的整数"),
        ),
      `deadline=${JSON.stringify(deadline)} 应当被拒绝`,
    );
  }

  const without = parseStartAdventureInput({
    ...validInput,
    triggers: [trigger],
  });
  assert.equal(Object.hasOwn(without.triggers[0], "deadlineDay"), false);

  const withNull = parseStartAdventureInput({
    ...validInput,
    triggers: [{ ...trigger, deadline: null }],
  });
  assert.equal(Object.hasOwn(withNull.triggers[0], "deadlineDay"), false);

  const withDeadline = parseStartAdventureInput({
    ...validInput,
    triggers: [{ ...trigger, deadline: 5 }],
  });
  assert.equal(withDeadline.triggers[0].deadlineDay, 5);
});

test("validates trigger relation dimensions and materializes legal ones", () => {
  assert.throws(
    () =>
      parseStartAdventureInput({
        ...validInput,
        triggers: [
          {
            id: "trigger-dimension",
            when: "主角触怒旧日势力",
            consequence: "关系恶化。",
            stateEffects: {
              relations: [
                {
                  sourceCharacterName: "伊芙琳",
                  targetCharacterName: "沈砚",
                  dimension: "aggression",
                  delta: 20,
                },
              ],
            },
          },
        ],
      }),
    (error) =>
      error instanceof AdventureInputError &&
      error.issues.some((issue) => issue.includes("关系影响维度必须是")),
  );

  const parsed = parseStartAdventureInput({
    ...validInput,
    triggers: [
      {
        id: "trigger-dimension",
        when: "主角触怒旧日势力",
        consequence: "关系恶化。",
        stateEffects: {
          relations: [
            {
              sourceCharacterName: "伊芙琳",
              targetCharacterName: "沈砚",
              dimension: "fear",
              delta: 20,
            },
          ],
        },
      },
    ],
  });
  assert.deepEqual(parsed.triggers[0].stateEffects.relations, [
    {
      sourceCharacterName: "伊芙琳",
      targetCharacterName: "沈砚",
      dimension: "fear",
      delta: 20,
    },
  ]);
});

test("warns but accepts initial statuses carrying sourceTurnId", () => {
  const warnings = [];
  const parsed = parseStartAdventureInput(
    {
      ...validInput,
      initialStatuses: [
        {
          characterName: "沈砚",
          statuses: [
            {
              id: "shenyan-possession",
              name: "灯尘入体",
              kind: "debuff",
              description: "体内积有灯尘。",
              sourceTurnId: "turn-9",
            },
          ],
        },
      ],
    },
    warnings,
  );
  assert.equal(parsed.initialStatuses[0].statuses[0].sourceTurnId, undefined);
  assert.equal(parsed.initialStatuses[0].statuses[0].id, "shenyan-possession");
  assert.deepEqual(warnings, [
    "初始状态 1 词条“灯尘入体”的 sourceTurnId 会被忽略，开局状态不追溯来源回合。",
  ]);

  const noWarnings = [];
  parseStartAdventureInput(
    {
      ...validInput,
      initialStatuses: [
        {
          characterName: "沈砚",
          statuses: [
            {
              id: "shenyan-brisk",
              name: "海风提神",
              kind: "buff",
              description: "短时清醒。",
            },
          ],
        },
      ],
    },
    noWarnings,
  );
  assert.deepEqual(noWarnings, []);
});

test("creates an opening adventure with initial statuses materialized", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-statuses-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure(
      parseStartAdventureInput({
        ...validInput,
        initialStatuses: [
          {
            characterName: "沈砚",
            statuses: [
              {
                id: "shenyan-lamp-dust",
                name: "灯尘入体",
                kind: "debuff",
                hidden: true,
                description: "沈砚自己尚未察觉。",
                expiresAtDay: 12,
              },
            ],
          },
          {
            characterName: "米洛",
            statuses: [
              {
                id: "milo-stiff",
                name: "落枕",
                kind: "debuff",
                description: "脖子僵直。",
                expiresAtDay: 3,
              },
            ],
          },
        ],
      }),
    );

    const states = store.loadAdventure(started.sessionId).branchState.states;
    const playerState = states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.playerCharacterId,
    );
    assert.deepEqual(playerState.state.statuses, [
      {
        id: "shenyan-lamp-dust",
        name: "灯尘入体",
        kind: "debuff",
        hidden: true,
        description: "沈砚自己尚未察觉。",
        expiresAtDay: 12,
      },
    ]);
    const mainState = states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(mainState.state.statuses, undefined);
    const additionalState = states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.additionalCharacterIds[0],
    );
    assert.deepEqual(additionalState.state.statuses, [
      {
        id: "milo-stiff",
        name: "落枕",
        kind: "debuff",
        description: "脖子僵直。",
        expiresAtDay: 3,
      },
    ]);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("creates and restores a complete opening adventure", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-opening-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure(parseStartAdventureInput(validInput));

    const summaries = store.listAdventures();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].sessionId, started.sessionId);
    assert.equal(summaries[0].campaignName, "雾港余烬");
    assert.equal(summaries[0].worldName, "灰潮群岛");
    assert.equal(summaries[0].playerName, "沈砚");
    assert.equal(summaries[0].mainCharacterName, "伊芙琳");

    const loaded = store.loadAdventure(started.sessionId);
    assert.equal(loaded.campaign.name, "雾港余烬");
    assert.equal(loaded.branchState.branch.headTurnId, started.openingTurnId);
    assert.equal(loaded.branchState.branch.nextSequence, 2);
    assert.equal(loaded.branchState.recentTurns.length, 1);
    assert.equal(loaded.branchState.turnHistory.length, 1);
    assert.equal(loaded.branchState.states.length, 12);
    assert.equal(started.additionalCharacterIds.length, 1);
    assert.equal(
      loaded.branchState.states.filter(
        (state) => state.entityType === "character_card",
      ).length,
      3,
    );
    assert.equal(
      loaded.branchState.recentTurns[0].generatedOutput.turn.dialogue.length,
      2,
    );
    assert.equal(
      loaded.branchState.states.find(
        (state) => state.entityType === "world_book_entry",
      )?.state.content,
      "群岛依靠潮汐灯塔维持航线。",
    );
    assert.equal(
      loaded.branchState.states.find(
        (state) => state.entityType === "story_direction",
      )?.state.status,
      "active",
    );
    const openingLocation = loaded.branchState.states.find(
      (state) => state.entityType === "location",
    );
    assert.equal(openingLocation?.state.name, "开场地点");
    assert.equal(
      loaded.branchState.states.find(
        (state) => state.entityType === "session_state",
      )?.state.currentLocationId,
      openingLocation?.entityId,
    );
    assert.equal(
      loaded.branchState.recentTurns[0].generatedOutput.schemaVersion,
      "1.0.0",
    );

    database.exec(`
      CREATE TRIGGER reject_second_setup
      BEFORE INSERT ON state_changes
      WHEN NEW.reason = '创建战役并建立初始场景'
      BEGIN
        SELECT RAISE(ABORT, 'forced setup failure');
      END
    `);
    assert.throws(() => store.startAdventure(validInput), /forced setup failure/);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM campaigns").get().total,
      1,
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM sessions").get().total,
      1,
    );
    database.exec("DROP TRIGGER reject_second_setup");

    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    assert.equal(store.loadAdventure(started.sessionId).branchState.states.length, 12);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("开局物化 initialRelationships：玩家→其他角色声明值不被零值覆盖，未声明对保持零值", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "ai-tavern-opening-relations-"),
  );
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure(
      parseStartAdventureInput({
        ...validInput,
        additionalCharacters: [
          ...validInput.additionalCharacters,
          { name: "陆远", role: "酒馆常客", personality: "沉默寡言。" },
        ],
        initialRelationships: [
          {
            sourceCharacterName: "沈砚",
            targetCharacterName: "米洛",
            dimensions: { trust: 45, affection: 30, respect: 25 },
            summary: "沈砚在港口欠米洛一个人情。",
          },
        ],
      }),
    );
    const states = store.loadAdventure(started.sessionId).branchState.states;
    const relationships = states.filter(
      (state) => state.entityType === "relationship",
    );
    const byPair = new Map(
      relationships.map((state) => [
        `${state.state.sourceCharacterId}:${state.state.targetCharacterId}`,
        state.state,
      ]),
    );
    const miloId = started.additionalCharacterIds[0];
    const luYuanId = started.additionalCharacterIds[1];

    // 声明方向（玩家→其他角色）：非零值物化，不被零值覆盖
    const playerMilo = byPair.get(`${started.playerCharacterId}:${miloId}`);
    assert.ok(playerMilo, "玩家→其他角色应建立关系记录");
    assert.equal(playerMilo.trust, 45);
    assert.equal(playerMilo.affinity, 30); // 内部存储 affinity ↔ 协议 affection
    assert.equal(playerMilo.respect, 25);
    assert.equal(playerMilo.summary, "沈砚在港口欠米洛一个人情。");

    // 未声明的反向自动补建，与正向声明一致
    const miloPlayer = byPair.get(`${miloId}:${started.playerCharacterId}`);
    assert.ok(miloPlayer, "未声明的反向关系应自动补建");
    assert.equal(miloPlayer.trust, 45);
    assert.equal(miloPlayer.affinity, 30);
    assert.equal(miloPlayer.respect, 25);
    assert.equal(miloPlayer.summary, "沈砚在港口欠米洛一个人情。");

    // 未声明对（玩家→陆远）：仍建立零值关系（"关系尚未建立"）
    const playerLuYuan = byPair.get(`${started.playerCharacterId}:${luYuanId}`);
    assert.ok(playerLuYuan, "未声明的玩家→其他角色对应建立零值关系");
    assert.equal(playerLuYuan.trust, 0);
    assert.equal(playerLuYuan.affinity, 0);
    assert.equal(playerLuYuan.fear, 0);
    assert.equal(playerLuYuan.hostility, 0);
    assert.equal(playerLuYuan.summary, "关系尚未建立");

    // 玩家↔主要角色既有行为不变：未声明时仍为零值
    const playerMain = byPair.get(
      `${started.playerCharacterId}:${started.mainCharacterId}`,
    );
    assert.equal(playerMain.trust, 0);
    assert.equal(playerMain.affinity, 0);
    assert.equal(playerMain.summary, "关系尚未建立");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("initial relationships materialize relationshipType: declared type and default acquaintances", async () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "ai-tavern-opening-relation-types-"),
  );
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure(
      parseStartAdventureInput({
        ...validInput,
        additionalCharacters: [
          ...validInput.additionalCharacters,
          { name: "陆远", role: "酒馆常客", personality: "沉默寡言。" },
        ],
        initialRelationships: [
          {
            sourceCharacterName: "沈砚",
            targetCharacterName: "米洛",
            type: "family",
            dimensions: { trust: 45 },
            summary: "多年姐弟，虽失散却仍有亲情。",
          },
        ],
      }),
    );
    const states = store.loadAdventure(started.sessionId).branchState.states;
    const byPair = new Map(
      states
        .filter((state) => state.entityType === "relationship")
        .map((state) => [
          `${state.state.sourceCharacterId}:${state.state.targetCharacterId}`,
          state.state,
        ]),
    );
    const miloId = started.additionalCharacterIds[0];
    const luYuanId = started.additionalCharacterIds[1];

    // 声明方向与自动补建的反向：类型一致（family）
    const playerMilo = byPair.get(`${started.playerCharacterId}:${miloId}`);
    assert.equal(playerMilo.relationshipType, "family");
    const miloPlayer = byPair.get(`${miloId}:${started.playerCharacterId}`);
    assert.equal(miloPlayer.relationshipType, "family");

    // 未声明的零值关系（玩家→陆远、玩家→主要角色）：缺省 acquaintances
    const playerLuYuan = byPair.get(`${started.playerCharacterId}:${luYuanId}`);
    assert.equal(playerLuYuan.relationshipType, "acquaintances");
    const playerMain = byPair.get(
      `${started.playerCharacterId}:${started.mainCharacterId}`,
    );
    assert.equal(playerMain.relationshipType, "acquaintances");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("deletes a complete local adventure with all cascaded records", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-delete-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure(parseStartAdventureInput(validInput));
    store.manageCharacter({
      actionId: "delete-test-character-action",
      sessionId: started.sessionId,
      operation: "set_presence",
      characterId: started.mainCharacterId,
      present: false,
    });
    const openingLocation = store
      .loadAdventure(started.sessionId)
      .branchState.states.find((state) => state.entityType === "location");
    store.manageLocation({
      actionId: "delete-test-location-action",
      sessionId: started.sessionId,
      operation: "update",
      locationId: openingLocation.entityId,
      location: {
        name: "酒馆门厅",
        description: "用于验证地点管理级联删除。",
        defaultCharacterIds: [started.mainCharacterId],
      },
    });
    store.importSourceDocument(started.sessionId, {
      name: "删除测试原文",
      fileName: "删除测试原文.md",
      content: "# 第一章\n\n伊芙琳在潮汐灯下检查旧海图。",
      enabled: true,
      currentChapter: 1,
      preventFuture: true,
      fidelity: "balanced",
    });
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS total FROM character_management_changes")
        .get().total > 0,
      true,
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM source_chunks").get()
        .total > 0,
      true,
    );
    const deleted = store.deleteAdventure(started.sessionId);

    assert.equal(deleted.campaignId, started.campaignId);
    assert.equal(deleted.removedCampaign, true);
    assert.equal(store.listAdventures().length, 0);
    for (const table of [
      "campaigns",
      "sessions",
      "branches",
      "turns",
      "messages",
      "events",
      "state_changes",
      "character_management_changes",
      "location_management_changes",
      "story_module_management_changes",
      "world_book_management_changes",
      "content_asset_management_changes",
      "state_control_changes",
      "state_field_lock_changes",
      "state_lock_blocks",
      "turn_regenerations",
      "source_documents",
      "source_chunks",
      "materialized_states",
    ]) {
      assert.equal(
        database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total,
        0,
      );
    }
    assert.throws(() => store.loadAdventure(started.sessionId), /没有找到/);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
