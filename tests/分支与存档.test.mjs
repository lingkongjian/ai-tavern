import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  BranchManagementError,
  LocalStoryStore,
} from "../lib/storage/story-store.ts";
import {
  exportCompleteAdventure,
  importCompleteAdventure,
} from "../lib/import/完整存档.ts";
import {
  BranchAndSaveInputError,
  parseBranchUpdateRequest,
  parseCreateBranchRequest,
  parseCreateSavePointRequest,
} from "../lib/story/分支与存档.ts";
import { advanceAdventureTurn } from "../lib/story/回合服务.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

test("validates branch and save requests", () => {
  assert.deepEqual(
    parseCreateBranchRequest({
      name: "接受提议",
      sourceTurnId: "turn-2",
    }),
    { name: "接受提议", sourceTurnId: "turn-2" },
  );
  assert.deepEqual(parseBranchUpdateRequest({ operation: "switch" }), {
    operation: "switch",
  });
  assert.deepEqual(parseBranchUpdateRequest({ operation: "set_main" }), {
    operation: "set_main",
  });
  assert.deepEqual(
    parseBranchUpdateRequest({ operation: "rename", name: "新名字" }),
    { operation: "rename", name: "新名字" },
  );
  assert.throws(
    () => parseBranchUpdateRequest({ operation: "rename", name: "  " }),
    BranchAndSaveInputError,
  );
  assert.throws(
    () => parseBranchUpdateRequest({ operation: "merge" }),
    BranchAndSaveInputError,
  );
  assert.deepEqual(parseCreateSavePointRequest({ name: "进入密室前" }), {
    name: "进入密室前",
  });
  assert.throws(
    () =>
      parseCreateBranchRequest({
        name: "无效",
        sourceTurnId: "turn-2",
        recoveryPointId: "save-1",
      }),
    BranchAndSaveInputError,
  );
});

test("renames a branch at the storage layer and rejects duplicates", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "ai-tavern-branch-rename-"),
  );
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "重命名测试",
      world: { name: "镜城", premise: "名字会改变道路的形状。" },
      player: { name: "旅人", description: "喜欢给道路起名字的人。" },
      mainCharacter: {
        name: "向导",
        role: "镜城向导",
        personality: "尊重每个名字。",
        firstMessage: "你打算怎么称呼这条路？",
      },
      openingScene: "旅人与向导站在岔路口。",
    });
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "东路分支",
      sourceTurnId: started.openingTurnId,
    });

    const renamed = store.renameBranch(
      started.sessionId,
      started.branchId,
      "主线改名",
    );
    assert.equal(renamed.name, "主线改名");
    let branches = store.listBranches(started.sessionId);
    const rootAfterRename = branches.find(
      (branch) => branch.id === started.branchId,
    );
    assert.equal(rootAfterRename.name, "主线改名");

    // 空名称与超长名称被拒绝（长度校验与分支名唯一性由存储层保证）
    assert.throws(
      () => store.renameBranch(started.sessionId, fork.branchId, "   "),
      /分支名称/,
    );
    assert.throws(
      () =>
        store.renameBranch(
          started.sessionId,
          fork.branchId,
          "长".repeat(81),
        ),
      BranchManagementError,
    );
    // 同剧本内重名被拒绝，原分支名不受影响
    assert.throws(
      () => store.renameBranch(started.sessionId, fork.branchId, "主线改名"),
      /不能重复/,
    );
    branches = store.listBranches(started.sessionId);
    const forkAfterFailure = branches.find(
      (branch) => branch.id === fork.branchId,
    );
    assert.equal(forkAfterFailure.name, "东路分支");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("forks historical state, isolates branches and restores exact save points", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-branches-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "分支测试",
      world: { name: "岔路城", premise: "每个选择都会留下可见的道路。" },
      player: { name: "旅人", description: "能够看见道路分叉的人。" },
      mainCharacter: {
        name: "引路人",
        role: "岔路城的向导",
        personality: "谨慎，只相信已经发生的选择。",
        firstMessage: "你选中的路会记住你。",
      },
      openingScene: "旅人与引路人站在三岔路口。",
    });

    const rootTurn2 = store.commitTurn({
      sessionId: started.sessionId,
      branchId: started.branchId,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "root-turn-2",
      playerInput: { customChoice: "走向北路" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "旅人走上北路。" },
      summaryPatch: "主线选择北路。",
      events: [
        {
          id: "event-root-2",
          eventType: "road_chosen",
          summary: "旅人选择北路",
        },
      ],
      stateMutations: [
        {
          entityType: "character_state",
          entityId: started.mainCharacterId,
          operation: "merge",
          value: { mood: "认可主线选择", route: "north" },
          reason: "引路人看见旅人选择北路",
          evidence: ["event-root-2"],
        },
      ],
    });
    const manualSave = store.createSavePoint(started.sessionId, "进入北路前营地");
    assert.equal(manualSave.sequence, 2);

    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "重新选择南路",
      sourceTurnId: started.openingTurnId,
    });
    assert.equal(fork.sourceSequence, 1);
    let adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, fork.branchId);
    assert.equal(adventure.branchState.turnHistory.length, 1);
    assert.equal(
      adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === started.mainCharacterId,
      ).state.mood,
      "待定",
    );

    store.manageCharacter({
      actionId: "alt-hide-guide",
      sessionId: started.sessionId,
      operation: "set_presence",
      characterId: started.mainCharacterId,
      present: false,
    });
    const altTurn2 = store.commitTurn({
      sessionId: started.sessionId,
      branchId: fork.branchId,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "alt-turn-2",
      playerInput: { customChoice: "走向南路" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "旅人独自走上南路。" },
      summaryPatch: "分支选择南路。",
      messages: [
        {
          role: "narrator",
          content: "旅人独自走上南路。",
          metadata: { model: "deepseek-test", totalTokens: 10 },
        },
      ],
      events: [
        {
          id: "event-alt-2",
          eventType: "road_chosen",
          summary: "旅人选择南路",
        },
      ],
      stateMutations: [
        {
          entityType: "character_state",
          entityId: started.mainCharacterId,
          operation: "merge",
          value: { mood: "担忧分支选择", route: "south" },
          reason: "引路人得知旅人选择南路",
          evidence: ["event-alt-2"],
        },
      ],
    });
    assert.equal(altTurn2.sequence, 2);
    const prepared = store.prepareTurnRegeneration(
      started.sessionId,
      altTurn2.id,
    );
    assert.equal(
      prepared.adventureBeforeTurn.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === started.mainCharacterId,
      ).state.present,
      false,
    );
    store.replaceHeadTurn({
      actionId: "rewrite-alt-turn-2",
      feedback: "让引路人更加坚定",
      expectedRegenerationCount: 0,
      turnId: altTurn2.id,
      sessionId: started.sessionId,
      branchId: fork.branchId,
      expectedParentTurnId: started.openingTurnId,
      generatedOutput: {
        schemaVersion: "1.0.0",
        scene: "旅人独自走上南路，引路人仍在远处观察。",
      },
      summaryPatch: "分支改写后仍选择南路。",
      messages: [
        {
          role: "narrator",
          content: "旅人独自走上南路，引路人仍在远处观察。",
          metadata: { model: "deepseek-test", totalTokens: 12 },
        },
      ],
      events: [
        {
          id: "event-alt-2-rewrite",
          eventType: "road_chosen",
          summary: "旅人重新确认南路",
        },
      ],
      stateMutations: [
        {
          entityType: "character_state",
          entityId: started.mainCharacterId,
          operation: "merge",
          value: { mood: "坚定观察分支", route: "south" },
          reason: "引路人远处观察旅人的南路选择",
          evidence: ["event-alt-2-rewrite"],
        },
      ],
    });

    store.switchBranch(started.sessionId, started.branchId);
    adventure = store.loadAdventure(started.sessionId);
    let mainState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(mainState.state.mood, "认可主线选择");
    assert.equal(mainState.state.present, true);
    assert.equal(adventure.branchState.turnHistory.length, 2);

    store.manageCharacter({
      actionId: "root-hide-guide-after-fork",
      sessionId: started.sessionId,
      operation: "set_presence",
      characterId: started.mainCharacterId,
      present: false,
    });
    store.switchBranch(started.sessionId, fork.branchId);
    adventure = store.loadAdventure(started.sessionId);
    mainState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(mainState.state.mood, "坚定观察分支");
    assert.equal(mainState.state.present, false);

    const recovery = store.createBranch({
      sessionId: started.sessionId,
      name: "从营地存档恢复",
      recoveryPointId: manualSave.id,
    });
    adventure = store.loadAdventure(started.sessionId);
    mainState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(adventure.branchState.branch.id, recovery.branchId);
    assert.equal(adventure.branchState.branch.headTurnId, rootTurn2.id);
    assert.equal(mainState.state.mood, "认可主线选择");
    assert.equal(mainState.state.present, true);

    const points = store.listRecoveryPoints(started.sessionId);
    assert.equal(points.some((point) => point.type === "manual"), true);
    assert.equal(points.some((point) => point.type === "automatic"), true);
    assert.equal(points.filter((point) => point.type === "fork").length, 2);
    assert.equal(store.listBranches(started.sessionId).length, 3);

    assert.throws(
      () => store.deleteBranch(started.sessionId, started.branchId),
      BranchManagementError,
    );
    store.deleteBranch(started.sessionId, recovery.branchId);
    assert.equal(store.loadAdventure(started.sessionId).branchState.branch.id, started.branchId);

    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    assert.equal(store.loadAdventure(started.sessionId).branchState.branch.id, started.branchId);
    assert.equal(store.listBranches(started.sessionId).length, 2);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("creates an automatic recovery snapshot every five turns", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-autosave-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "自动存档测试",
      world: { name: "计时塔", premise: "钟声记录每一次推进。" },
      player: { name: "记录员", description: "负责推进钟摆的人。" },
      mainCharacter: {
        name: "守塔人",
        role: "计时塔看守",
        personality: "按回合记录变化。",
      },
      openingScene: "记录员进入计时塔。",
    });
    let headTurnId = started.openingTurnId;
    for (let sequence = 2; sequence <= 5; sequence += 1) {
      const committed = store.commitTurn({
        sessionId: started.sessionId,
        branchId: started.branchId,
        expectedHeadTurnId: headTurnId,
        idempotencyKey: `autosave-turn-${sequence}`,
        playerInput: { customChoice: `推进第 ${sequence} 次钟摆` },
        generatedOutput: {
          schemaVersion: "1.0.0",
          scene: `第 ${sequence} 次钟声响起。`,
        },
        summaryPatch: `钟声推进到回合 ${sequence}。`,
      });
      headTurnId = committed.id;
    }
    const automatic = store
      .listRecoveryPoints(started.sessionId)
      .filter((point) => point.type === "automatic");
    assert.deepEqual(
      automatic.map((point) => point.sequence).sort((left, right) => left - right),
      [1, 5],
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("backfills a recovery snapshot when upgrading an existing local story", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-upgrade-"));
  const previousMigrations = join(temporaryDirectory, "previous-migrations");
  mkdirSync(previousMigrations);
  for (const name of readdirSync(migrationsDir).filter((fileName) =>
    /^000[0-5]_.+\.sql$/.test(fileName),
  )) {
    copyFileSync(join(migrationsDir, name), join(previousMigrations, name));
  }
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({
    filePath: databasePath,
    migrationsDir: previousMigrations,
  });
  try {
    // 用原始 SQL 模拟旧版本应用写入的存档（旧 schema 没有 is_main 列）
    const sessionId = randomUUID();
    const branchId = randomUUID();
    const turnId = randomUUID();
    const campaignId = randomUUID();
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(
          "INSERT INTO campaigns (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(campaignId, "旧存档升级测试", "", now, now);
      database
        .prepare(
          "INSERT INTO sessions (id, campaign_id, name, status, active_branch_id, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
        )
        .run(sessionId, campaignId, "旧存档会话", branchId, now, now);
      database
        .prepare(`
          INSERT INTO branches (
            id, session_id, name, parent_branch_id, forked_from_turn_id,
            head_turn_id, next_sequence, created_at, updated_at
          ) VALUES (?, ?, '主线', NULL, NULL, ?, 2, ?, ?)
        `)
        .run(branchId, sessionId, turnId, now, now);
      database
        .prepare(`
          INSERT INTO turns (
            id, session_id, branch_id, parent_turn_id, sequence,
            idempotency_key, player_input_json, generated_output_json,
            summary_patch, status, created_at
          ) VALUES (?, ?, ?, NULL, 1, 'adventure-setup', ?, ?, '旧玩家抵达旧城。', 'committed', ?)
        `)
        .run(
          turnId,
          sessionId,
          branchId,
          JSON.stringify({ source: "setup_wizard" }),
          JSON.stringify({ schemaVersion: "1.0.0", scene: "旧玩家抵达旧城。" }),
          now,
        );
      database
        .prepare(`
          INSERT INTO materialized_states (
            session_id, branch_id, entity_type, entity_id, state_json,
            is_active, version, updated_turn_id, updated_at
          ) VALUES (?, ?, 'session_state', 'core', ?, 1, 1, ?, ?)
        `)
        .run(
          sessionId,
          branchId,
          JSON.stringify({ schemaVersion: "1.0.0", state: { currentScene: "旧城" } }),
          turnId,
          now,
        );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    database.prepare("DELETE FROM snapshots").run();
    database.close();

    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    const store = new LocalStoryStore(database);
    // 升级后根分支自动成为主线
    const upgradedBranches = store.listBranches(sessionId);
    assert.equal(upgradedBranches.length, 1);
    assert.equal(upgradedBranches[0].isMain, true);
    const points = store.listRecoveryPoints(sessionId);
    assert.equal(points.length, 1);
    assert.equal(points[0].type, "automatic");
    assert.equal(points[0].name, "升级时自动存档");
    const restored = store.createBranch({
      sessionId,
      name: "从升级存档恢复",
      recoveryPointId: points[0].id,
    });
    assert.equal(restored.sourceSequence, 1);
    assert.equal(
      store.loadAdventure(sessionId).branchState.states.length > 0,
      true,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function sessionStateOf(adventure) {
  return adventure.branchState.states.find(
    (state) => state.entityType === "session_state" && state.entityId === "core",
  )?.state ?? {};
}

function characterStateOf(adventure, characterId) {
  return adventure.branchState.states.find(
    (state) =>
      state.entityType === "character_state" && state.entityId === characterId,
  )?.state ?? {};
}

function startBadEndScenario(store) {
  const started = store.startAdventure({
    campaignName: "结局恢复测试",
    world: { name: "迷雾城", premise: "结局后的选择。" },
    player: { name: "旅人", description: "寻找出路的人。" },
    mainCharacter: {
      name: "引路人",
      role: "向导",
      personality: "谨慎",
      firstMessage: "这边走。",
    },
    openingScene: "旅人与引路人在城门口。",
  });
  let headTurnId = started.openingTurnId;
  const commit = (key, scene, mutations, summary) =>
    store.commitTurn({
      sessionId: started.sessionId,
      branchId: started.branchId,
      expectedHeadTurnId: headTurnId,
      idempotencyKey: key,
      playerInput: { customChoice: scene },
      generatedOutput: { schemaVersion: "1.0.0", scene },
      summaryPatch: summary ?? scene,
      stateMutations: mutations,
    });
  const turn2 = commit(
    "badend-turn-2",
    "旅人进入树林。",
    [
      {
        entityType: "session_state",
        entityId: "core",
        operation: "merge",
        value: { currentScene: "城外树林", currentLocationId: "loc-woods" },
        reason: "场景推进",
        evidence: ["badend-event-2"],
      },
    ],
    "进入树林。",
  );
  headTurnId = turn2.id;
  const turn3 = commit(
    "badend-turn-3",
    "旅人在小屋过夜。",
    [
      {
        entityType: "session_state",
        entityId: "core",
        operation: "merge",
        value: { gameTimeDay: 2, currentScene: "林中小屋" },
        reason: "过夜",
        evidence: ["badend-event-3"],
      },
      {
        entityType: "character_state",
        entityId: started.mainCharacterId,
        operation: "merge",
        value: { mood: "平静", trust: 30 },
        reason: "同行过夜",
        evidence: ["badend-event-3"],
      },
    ],
    "小屋过夜，进入第 2 日。",
  );
  headTurnId = turn3.id;
  const saveBeforeBadEnd = store.createSavePoint(
    started.sessionId,
    "结局前·小屋过夜",
  );
  const turn4 = commit(
    "badend-turn-4",
    "旅人坠入深渊。",
    [
      {
        entityType: "session_state",
        entityId: "core",
        operation: "merge",
        value: {
          badEnd: true,
          badEndReason: "旅人坠入深渊，再无音讯。",
          currentScene: "深渊底部",
        },
        reason: "偏离触发器把局势推向了坏结局方向",
        evidence: ["badend-event-4"],
      },
      {
        entityType: "character_state",
        entityId: started.mainCharacterId,
        operation: "merge",
        value: { mood: "绝望" },
        reason: "结局",
        evidence: ["badend-event-4"],
      },
    ],
    "旅人坠入深渊。",
  );
  return { started, turn2, turn3, turn4, saveBeforeBadEnd, commit };
}

test("restores a bad-end story to the save point before the ending", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-badend-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const { started, turn3, turn4, saveBeforeBadEnd } =
      startBadEndScenario(store);
    let adventure = store.loadAdventure(started.sessionId);
    assert.equal(sessionStateOf(adventure).badEnd, true);
    assert.equal(sessionStateOf(adventure).gameTimeDay, 2);
    assert.equal(characterStateOf(adventure, started.mainCharacterId).mood, "绝望");

    const restored = store.restoreSavePoint(
      started.sessionId,
      saveBeforeBadEnd.id,
    );
    assert.equal(restored.sequence, 3);
    assert.equal(restored.branchId, started.branchId);
    assert.equal(restored.removedTurnCount, 1);
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.headTurnId, turn3.id);
    assert.equal(adventure.branchState.branch.nextSequence, 4);
    assert.equal(sessionStateOf(adventure).badEnd, undefined);
    assert.equal(sessionStateOf(adventure).badEndReason, undefined);
    assert.equal(sessionStateOf(adventure).gameTimeDay, 2);
    assert.equal(sessionStateOf(adventure).currentScene, "林中小屋");
    assert.equal(characterStateOf(adventure, started.mainCharacterId).mood, "平静");
    assert.equal(characterStateOf(adventure, started.mainCharacterId).trust, 30);
    assert.deepEqual(
      adventure.branchState.turnHistory.map((turn) => turn.sequence),
      [3, 2, 1],
    );
    assert.equal(
      adventure.branchState.turnHistory.some((turn) => turn.id === turn4.id),
      false,
    );

    const turn5 = store.commitTurn({
      sessionId: started.sessionId,
      branchId: started.branchId,
      expectedHeadTurnId: turn3.id,
      idempotencyKey: "badend-turn-5-after-restore",
      playerInput: { customChoice: "旅人重新出发" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "旅人重新出发。" },
      summaryPatch: "恢复后重新出发。",
    });
    assert.equal(turn5.sequence, 4);
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.headTurnId, turn5.id);
    assert.equal(sessionStateOf(adventure).badEnd, undefined);
    assert.equal(adventure.branchState.turnHistory.length, 4);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("does not leak bad-end flag when forking from a historical turn", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-badend-fork-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const { started, turn3, saveBeforeBadEnd } = startBadEndScenario(store);
    let adventure = store.loadAdventure(started.sessionId);
    assert.equal(sessionStateOf(adventure).badEnd, true);

    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "结局前重新选择",
      sourceTurnId: turn3.id,
    });
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, fork.branchId);
    assert.equal(sessionStateOf(adventure).badEnd, undefined);
    assert.equal(sessionStateOf(adventure).gameTimeDay, 2);
    assert.equal(sessionStateOf(adventure).currentScene, "林中小屋");
    assert.equal(characterStateOf(adventure, started.mainCharacterId).mood, "平静");
    assert.equal(adventure.branchState.branch.headTurnId, turn3.id);

    const fromSave = store.createBranch({
      sessionId: started.sessionId,
      name: "从结局前存档重新选择",
      recoveryPointId: saveBeforeBadEnd.id,
    });
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, fromSave.branchId);
    assert.equal(sessionStateOf(adventure).badEnd, undefined);
    assert.equal(sessionStateOf(adventure).gameTimeDay, 2);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("restores a save point owned by another branch and switches to it", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-cross-restore-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const { started, turn2, saveBeforeBadEnd } = startBadEndScenario(store);
    // 从回合 2 分叉出另一条路线并推进（当前活动分支）
    const alt = store.createBranch({
      sessionId: started.sessionId,
      name: "南路分支",
      sourceTurnId: turn2.id,
    });
    const altTurn = store.commitTurn({
      sessionId: started.sessionId,
      branchId: alt.branchId,
      expectedHeadTurnId: turn2.id,
      idempotencyKey: "cross-alt-turn",
      playerInput: { customChoice: "旅人独自走向南路" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "旅人独自走向南路。" },
      summaryPatch: "南路分支推进。",
      stateMutations: [
        {
          entityType: "character_state",
          entityId: started.mainCharacterId,
          operation: "merge",
          value: { mood: "坚定", route: "south" },
          reason: "南路选择",
          evidence: ["cross-alt-event"],
        },
      ],
    });
    let adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, alt.branchId);
    assert.equal(adventure.branchState.branch.headTurnId, altTurn.id);

    // 恢复到主线（badEnd 分支）的结局前存档：应切回主线并就地回退
    const restored = store.restoreSavePoint(
      started.sessionId,
      saveBeforeBadEnd.id,
    );
    assert.equal(restored.branchId, started.branchId);
    assert.equal(restored.activeBranchId, started.branchId);
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, started.branchId);
    assert.equal(sessionStateOf(adventure).badEnd, undefined);
    assert.equal(sessionStateOf(adventure).gameTimeDay, 2);
    assert.deepEqual(
      adventure.branchState.turnHistory.map((turn) => turn.sequence),
      [3, 2, 1],
    );
    // 子分支保留，切回去状态不受影响
    store.switchBranch(started.sessionId, alt.branchId);
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.headTurnId, altTurn.id);
    assert.equal(characterStateOf(adventure, started.mainCharacterId).mood, "坚定");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("restoring deletes later turns and their automatic snapshots only", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-restore-cleanup-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "清理测试",
      world: { name: "钟楼", premise: "存档点清理验证。" },
      player: { name: "记录员", description: "负责推进钟摆。" },
      mainCharacter: { name: "守塔人", role: "看守", personality: "按回合记录变化。" },
      openingScene: "记录员进入钟楼。",
    });
    let headTurnId = started.openingTurnId;
    let manual;
    for (let sequence = 2; sequence <= 7; sequence += 1) {
      const committed = store.commitTurn({
        sessionId: started.sessionId,
        branchId: started.branchId,
        expectedHeadTurnId: headTurnId,
        idempotencyKey: `cleanup-turn-${sequence}`,
        playerInput: { customChoice: `推进第 ${sequence} 次钟摆` },
        generatedOutput: { schemaVersion: "1.0.0", scene: `第 ${sequence} 次钟声响起。` },
        summaryPatch: `钟声推进到回合 ${sequence}。`,
      });
      headTurnId = committed.id;
      if (sequence === 4) {
        manual = store.createSavePoint(started.sessionId, "回合四结束");
      }
    }
    assert.equal(manual.sequence, 4);
    const pointsBefore = store.listRecoveryPoints(started.sessionId);
    assert.equal(
      pointsBefore.some(
        (point) => point.type === "automatic" && point.sequence === 5,
      ),
      true,
    );

    const restored = store.restoreSavePoint(started.sessionId, manual.id);
    assert.equal(restored.removedTurnCount, 3);
    const pointsAfter = store.listRecoveryPoints(started.sessionId);
    assert.equal(
      pointsAfter.some((point) => point.type === "automatic" && point.sequence === 5),
      false,
    );
    assert.equal(pointsAfter.some((point) => point.id === manual.id), true);
    const adventure = store.loadAdventure(started.sessionId);
    assert.deepEqual(
      adventure.branchState.turnHistory.map((turn) => turn.sequence),
      [4, 3, 2, 1],
    );
    // 恢复点之后推进的回合被删除后，可以从该处继续推进
    const next = store.commitTurn({
      sessionId: started.sessionId,
      branchId: started.branchId,
      expectedHeadTurnId: adventure.branchState.branch.headTurnId,
      idempotencyKey: "cleanup-turn-after-restore",
      playerInput: { customChoice: "继续推进钟摆" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "钟声再次响起。" },
      summaryPatch: "恢复后继续推进。",
    });
    assert.equal(next.sequence, 5);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects restoring past a child branch fork and keeps story unchanged", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-restore-guard-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "保护测试",
      world: { name: "岔口", premise: "分叉后的存档保护。" },
      player: { name: "旅人", description: "面对岔口的人。" },
      mainCharacter: { name: "向导", role: "引路", personality: "谨慎。" },
      openingScene: "旅人在岔口。",
    });
    let headTurnId = started.openingTurnId;
    const commits = [];
    let manual;
    for (let sequence = 2; sequence <= 6; sequence += 1) {
      const committed = store.commitTurn({
        sessionId: started.sessionId,
        branchId: started.branchId,
        expectedHeadTurnId: headTurnId,
        idempotencyKey: `guard-turn-${sequence}`,
        playerInput: { customChoice: `选择 ${sequence}` },
        generatedOutput: { schemaVersion: "1.0.0", scene: `回合 ${sequence}。` },
        summaryPatch: `回合 ${sequence}。`,
      });
      commits.push(committed);
      headTurnId = committed.id;
      if (sequence === 5) {
        manual = store.createSavePoint(started.sessionId, "回合五结束");
      }
    }
    assert.equal(manual.sequence, 5);
    // 在回合 6（恢复点之后）分叉出子分支
    store.createBranch({
      sessionId: started.sessionId,
      name: "从回合六分叉",
      sourceTurnId: commits[4].id,
    });
    assert.throws(
      () => store.restoreSavePoint(started.sessionId, manual.id),
      BranchManagementError,
    );
    const adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.headTurnId, commits[4].id);
    assert.equal(adventure.branchState.turnHistory.length, 6);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("restores an automatic snapshot with its frozen state", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-autosave-restore-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "自动恢复测试",
      world: { name: "雾港", premise: "自动存档恢复。" },
      player: { name: "水手", description: "回到雾港的人。" },
      mainCharacter: { name: "港务长", role: "港口负责人", personality: "按簿登记。" },
      openingScene: "水手回到雾港。",
    });
    let headTurnId = started.openingTurnId;
    for (let sequence = 2; sequence <= 6; sequence += 1) {
      const committed = store.commitTurn({
        sessionId: started.sessionId,
        branchId: started.branchId,
        expectedHeadTurnId: headTurnId,
        idempotencyKey: `auto-restore-turn-${sequence}`,
        playerInput: { customChoice: `推进回合 ${sequence}` },
        generatedOutput: { schemaVersion: "1.0.0", scene: `回合 ${sequence}。` },
        summaryPatch: `回合 ${sequence}。`,
        stateMutations:
          sequence === 6
            ? [
                {
                  entityType: "session_state",
                  entityId: "core",
                  operation: "merge",
                  value: { gameTimeDay: 3, currentScene: "雾港深处" },
                  reason: "航程推进",
                  evidence: [`auto-restore-event-${sequence}`],
                },
              ]
            : [],
      });
      headTurnId = committed.id;
    }
    const automatic5 = store
      .listRecoveryPoints(started.sessionId)
      .find((point) => point.type === "automatic" && point.sequence === 5);
    assert.ok(automatic5);
    const restored = store.restoreSavePoint(started.sessionId, automatic5.id);
    assert.equal(restored.sequence, 5);
    assert.equal(restored.removedTurnCount, 1);
    const adventure = store.loadAdventure(started.sessionId);
    assert.equal(sessionStateOf(adventure).gameTimeDay, 1);
    assert.equal(adventure.branchState.branch.nextSequence, 6);
    assert.deepEqual(
      adventure.branchState.turnHistory.map((turn) => turn.sequence),
      [5, 4, 3, 2, 1],
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function startForkScenario(store) {
  return store.startAdventure({
    campaignName: "分支后推进测试",
    world: { name: "岔路城", premise: "每个选择都会留下可见的道路。" },
    player: { name: "旅人", description: "能够看见道路分叉的人。" },
    mainCharacter: {
      name: "引路人",
      role: "岔路城的向导",
      personality: "谨慎，只相信已经发生的选择。",
      firstMessage: "你选中的路会记住你。",
    },
    openingScene: "旅人与引路人站在三岔路口。",
  });
}

function forkTurnOutput(started, scene) {
  const eventId = `fork-event-${Math.random().toString(36).slice(2)}`;
  return {
    schemaVersion: "1.0",
    turn: {
      scene,
      events: [
        {
          id: eventId,
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
          id: "fork-choice-a",
          label: "继续",
          description: "继续行动。",
          stance: "neutral",
        },
        {
          id: "fork-choice-b",
          label: "暂缓",
          description: "先观察局势。",
          stance: "benevolent",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId: "inn",
        locationName: "岔路城客栈",
        locationDescription: "灯火昏暗的客栈。",
        presentCharacterIds: [
          started.playerCharacterId,
          started.mainCharacterId,
        ],
        reason: "两人仍在客栈。",
        evidence: [eventId],
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

async function advanceForkTurn(store, started, expectedHeadTurnId, key, choice) {
  return advanceAdventureTurn({
    store,
    sessionId: started.sessionId,
    input: { expectedHeadTurnId, idempotencyKey: key, customChoice: choice },
    generate: async () => ({
      content: forkTurnOutput(started, choice),
      model: "deepseek-test",
      usage: { totalTokens: 100 },
    }),
  });
}

test("advances the next turn after switching branches with the fresh branch head", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-switch-advance-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    await advanceForkTurn(
      store,
      started,
      started.openingTurnId,
      "switch-root-2",
      "走向北路",
    );
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "南路分支",
      sourceTurnId: started.openingTurnId,
    });
    await advanceForkTurn(
      store,
      started,
      started.openingTurnId,
      "switch-fork-2",
      "走向南路",
    );

    // 切回主线，用切换响应后 loadAdventure 的 head 提交（等价于前端 submitTurn）
    store.switchBranch(started.sessionId, started.branchId);
    let adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, started.branchId);
    const next = await advanceForkTurn(
      store,
      started,
      adventure.branchState.branch.headTurnId,
      "switch-root-3",
      "继续北路",
    );
    assert.equal(next.committedTurn.sequence, 3);
    assert.equal(next.committedTurn.branchId, started.branchId);

    // 再切回分支，同样直接续接
    store.switchBranch(started.sessionId, fork.branchId);
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, fork.branchId);
    const forkNext = await advanceForkTurn(
      store,
      started,
      adventure.branchState.branch.headTurnId,
      "switch-fork-3",
      "继续南路",
    );
    assert.equal(forkNext.committedTurn.sequence, 3);
    assert.equal(forkNext.committedTurn.branchId, fork.branchId);

    // 分支隔离：两边的回合互不干扰
    const mainAdventure = store.loadAdventure(started.sessionId);
    const mainHead = mainAdventure.branchState.branch.headTurnId;
    store.switchBranch(started.sessionId, started.branchId);
    const rootAdventure = store.loadAdventure(started.sessionId);
    assert.notEqual(rootAdventure.branchState.branch.headTurnId, mainHead);
    assert.deepEqual(
      rootAdventure.branchState.turnHistory.map((turn) => turn.sequence),
      [3, 2, 1],
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("advances the next turn after creating a branch from a recovery point", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-recover-fork-advance-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    const root2 = await advanceForkTurn(
      store,
      started,
      started.openingTurnId,
      "recover-root-2",
      "走向北路",
    );
    const manual = store.createSavePoint(started.sessionId, "北路营地");
    assert.equal(manual.sequence, 2);
    await advanceForkTurn(
      store,
      started,
      root2.committedTurn.id,
      "recover-root-3",
      "继续北路",
    );

    // “恢复为新分支”：从存档创建并自动切换，然后用返回的 head 直接提交
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "从营地存档恢复",
      recoveryPointId: manual.id,
    });
    const adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, fork.branchId);
    assert.equal(adventure.branchState.branch.headTurnId, root2.committedTurn.id);
    const next = await advanceForkTurn(
      store,
      started,
      adventure.branchState.branch.headTurnId,
      "recover-fork-3",
      "改走岔道",
    );
    assert.equal(next.committedTurn.sequence, 3);
    assert.equal(next.committedTurn.branchId, fork.branchId);
    assert.equal(next.adventure.branchState.branch.headTurnId, next.committedTurn.id);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("advances the next turn after restoring a save point in place", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-restore-advance-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    const root2 = await advanceForkTurn(
      store,
      started,
      started.openingTurnId,
      "restore-root-2",
      "走向北路",
    );
    const manual = store.createSavePoint(started.sessionId, "北路营地");
    await advanceForkTurn(
      store,
      started,
      root2.committedTurn.id,
      "restore-root-3",
      "继续北路",
    );

    // 就地恢复：回退后分支头回到存档回合，用新 head 直接续接
    const restored = store.restoreSavePoint(started.sessionId, manual.id);
    assert.equal(restored.turnId, root2.committedTurn.id);
    const adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.headTurnId, root2.committedTurn.id);
    assert.equal(adventure.branchState.branch.nextSequence, 3);
    const next = await advanceForkTurn(
      store,
      started,
      adventure.branchState.branch.headTurnId,
      "restore-after-3",
      "重新选择路线",
    );
    assert.equal(next.committedTurn.sequence, 3);
    assert.equal(next.committedTurn.branchId, started.branchId);
    assert.equal(next.adventure.branchState.turnHistory.length, 3);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("transfers the main-line identity and follows the delete protection", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-set-main-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    // 初始：根分支就是主线
    let branches = store.listBranches(started.sessionId);
    assert.equal(branches.length, 1);
    assert.equal(branches[0].isMain, true);
    assert.equal(branches[0].parentBranchId, null);
    assert.equal(
      store.loadBranchState(started.branchId).branch.isMain,
      true,
    );
    // 开局主线不能删除
    assert.throws(
      () => store.deleteBranch(started.sessionId, started.branchId),
      BranchManagementError,
    );

    // 从开局回合分叉出支线
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "南路分支",
      sourceTurnId: started.openingTurnId,
    });
    branches = store.listBranches(started.sessionId);
    assert.equal(branches.find((branch) => branch.id === fork.branchId).isMain, false);

    // 把支线设为主线：主线身份转移
    const transferred = store.setMainBranch(started.sessionId, fork.branchId);
    assert.equal(transferred.isMain, true);
    branches = store.listBranches(started.sessionId);
    assert.equal(branches.filter((branch) => branch.isMain).length, 1);
    assert.equal(branches.find((branch) => branch.isMain).id, fork.branchId);
    assert.equal(
      branches.find((branch) => branch.id === started.branchId).isMain,
      false,
    );
    assert.equal(store.loadBranchState(fork.branchId).branch.isMain, true);
    assert.equal(store.loadBranchState(started.branchId).branch.isMain, false);
    const mainCount = database
      .prepare(
        "SELECT COUNT(*) AS total FROM branches WHERE session_id = ? AND is_main = 1",
      )
      .get(started.sessionId).total;
    assert.equal(mainCount, 1);

    // 重复设置幂等：仍然是同一个主线
    const again = store.setMainBranch(started.sessionId, fork.branchId);
    assert.equal(again.isMain, true);
    branches = store.listBranches(started.sessionId);
    assert.equal(branches.filter((branch) => branch.isMain).length, 1);
    assert.equal(branches.find((branch) => branch.isMain).id, fork.branchId);

    // 新主线不能删除
    assert.throws(
      () => store.deleteBranch(started.sessionId, fork.branchId),
      BranchManagementError,
    );
    // 树重组：原主线成为新主线的空子分支（其回合已被吸收）
    branches = store.listBranches(started.sessionId);
    assert.equal(
      branches.find((branch) => branch.id === started.branchId).parentBranchId,
      fork.branchId,
    );
    assert.equal(
      branches.find((branch) => branch.id === fork.branchId).parentBranchId,
      null,
    );
    const rootState = store.loadBranchState(started.branchId);
    assert.equal(rootState.branch.headTurnId, started.openingTurnId);
    assert.equal(rootState.branch.nextSequence, 1);
    assert.equal(rootState.turnHistory.length, 1);
    assert.equal(rootState.turnHistory[0].id, started.openingTurnId);

    // 主线转移回原主线：树再次重组（原主线吸收回合重新成为根，原支线变为空子分支）
    store.setMainBranch(started.sessionId, started.branchId);
    branches = store.listBranches(started.sessionId);
    assert.equal(branches.find((branch) => branch.id === started.branchId).isMain, true);
    assert.equal(
      branches.find((branch) => branch.id === started.branchId).parentBranchId,
      null,
    );
    assert.equal(
      branches.find((branch) => branch.id === fork.branchId).parentBranchId,
      started.branchId,
    );
    assert.equal(
      store.loadBranchState(fork.branchId).branch.nextSequence,
      1,
    );
    // 原支线成为空子分支（没有子分支），可以删除
    const deleted = store.deleteBranch(started.sessionId, fork.branchId);
    assert.equal(deleted.branchId, fork.branchId);
    branches = store.listBranches(started.sessionId);
    assert.equal(branches.length, 1);
    assert.equal(branches[0].isMain, true);
    assert.equal(branches[0].id, started.branchId);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects transferring the main identity to a branch of another session", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-set-main-foreign-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const first = startForkScenario(store);
    const second = startForkScenario(store);
    // 用第二个剧本的根分支去设置第一个剧本的主线
    assert.throws(
      () => store.setMainBranch(first.sessionId, second.branchId),
      /没有找到指定的剧情分支/,
    );
    const firstBranches = store.listBranches(first.sessionId);
    const secondBranches = store.listBranches(second.sessionId);
    assert.equal(firstBranches.filter((branch) => branch.isMain).length, 1);
    assert.equal(firstBranches[0].isMain, true);
    assert.equal(secondBranches[0].isMain, true);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("keeps switching, forking and save points intact after transferring the main identity", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-set-main-flow-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    await advanceForkTurn(
      store,
      started,
      started.openingTurnId,
      "main-flow-root-2",
      "走向北路",
    );
    const manual = store.createSavePoint(started.sessionId, "北路营地");
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "南路分支",
      sourceTurnId: started.openingTurnId,
    });
    await advanceForkTurn(
      store,
      started,
      started.openingTurnId,
      "main-flow-fork-2",
      "走向南路",
    );

    // 主线转移后：切换、创建分支、恢复点恢复照常工作
    store.setMainBranch(started.sessionId, fork.branchId);
    let branches = store.listBranches(started.sessionId);
    assert.equal(branches.find((branch) => branch.isMain).id, fork.branchId);

    // 切换回原主线分支再切回新主线，状态各自保持
    store.switchBranch(started.sessionId, started.branchId);
    let adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, started.branchId);
    store.switchBranch(started.sessionId, fork.branchId);
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, fork.branchId);

    // 在新主线上继续推进
    const next = await advanceForkTurn(
      store,
      started,
      adventure.branchState.branch.headTurnId,
      "main-flow-fork-3",
      "继续南路",
    );
    assert.equal(next.committedTurn.branchId, fork.branchId);
    assert.equal(next.committedTurn.sequence, 3);

    // 从恢复点恢复为新分支
    const fromSave = store.createBranch({
      sessionId: started.sessionId,
      name: "从北路营地恢复",
      recoveryPointId: manual.id,
    });
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, fromSave.branchId);
    assert.equal(adventure.branchState.branch.headTurnId, manual.turnId);

    // 就地恢复照常
    const restored = store.restoreSavePoint(started.sessionId, manual.id);
    assert.equal(restored.branchId, started.branchId);
    assert.equal(restored.activeBranchId, started.branchId);
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, started.branchId);

    // 多分支场景：主线仍然唯一
    branches = store.listBranches(started.sessionId);
    assert.equal(branches.length, 3);
    assert.equal(branches.filter((branch) => branch.isMain).length, 1);
    assert.equal(branches.find((branch) => branch.isMain).id, fork.branchId);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("模型输出重复 id 不触发 messages/events 主键冲突（跨回合/跨分支/重生成）", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-message-id-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);

    // 所有回合复用完全相同的模型输出 id（模型常见固定值，如 "dialogue-1"/"event-1"）
    const modelDialogueId = "dialogue-1";
    const modelEventId = "event-1";
    const makeMessages = (mainCharacterId) => [
      { role: "player", content: "继续前进。" },
      {
        role: "narrator",
        content: "场景继续。",
        metadata: { model: "deepseek-test", totalTokens: 10 },
      },
      {
        id: modelDialogueId,
        role: "character",
        speakerId: mainCharacterId,
        content: "我跟着你。",
        metadata: { addressedCharacterIds: [] },
      },
    ];
    const makeEvents = () => [
      { id: modelEventId, eventType: "scene_advance", summary: "剧情推进" },
      { id: "event-2", eventType: "location_change", summary: "进入客栈" },
    ];
    const makeMutations = (mainCharacterId, mood) => [
      {
        entityType: "character_state",
        entityId: mainCharacterId,
        operation: "merge",
        value: { mood },
        reason: "引路人跟随旅人",
        evidence: [modelEventId, "event-2"],
      },
    ];

    // 同一分支连续两回合提交相同模型 id：不应出现 UNIQUE constraint failed
    const turnA = store.commitTurn({
      sessionId: started.sessionId,
      branchId: started.branchId,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "dup-id-turn-a",
      playerInput: { customChoice: "前进" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "第一回合。" },
      summaryPatch: "第一回合。",
      messages: makeMessages(started.mainCharacterId),
      events: makeEvents(),
      stateMutations: makeMutations(started.mainCharacterId, "跟随"),
    });
    const turnB = store.commitTurn({
      sessionId: started.sessionId,
      branchId: started.branchId,
      expectedHeadTurnId: turnA.id,
      idempotencyKey: "dup-id-turn-b",
      playerInput: { customChoice: "继续" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "第二回合。" },
      summaryPatch: "第二回合。",
      messages: makeMessages(started.mainCharacterId),
      events: makeEvents(),
      stateMutations: makeMutations(started.mainCharacterId, "坚定"),
    });
    assert.equal(turnB.sequence, 3);

    // 切换分支后另一分支仍提交相同模型 id
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "重复 id 分支",
      sourceTurnId: started.openingTurnId,
    });
    assert.equal(
      store.loadAdventure(started.sessionId).branchState.branch.id,
      fork.branchId,
    );
    const forkTurn = store.commitTurn({
      sessionId: started.sessionId,
      branchId: fork.branchId,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "dup-id-fork-turn",
      playerInput: { customChoice: "折返" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "分支回合。" },
      summaryPatch: "分支回合。",
      messages: makeMessages(started.mainCharacterId),
      events: makeEvents(),
      stateMutations: makeMutations(started.mainCharacterId, "折返"),
    });

    // 所有 messages / events 行存在且主键各自唯一（服务端生成的 UUID）
    const allMessageRows = database
      .prepare("SELECT id, turn_id FROM messages ORDER BY turn_id, ordinal")
      .all();
    const allEventRows = database
      .prepare("SELECT id, turn_id FROM events ORDER BY turn_id, id")
      .all();
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    assert.ok(allMessageRows.length >= 9, "三个回合各 3 条消息");
    assert.ok(allEventRows.length >= 6, "三个回合各 2 个事件");
    assert.equal(
      new Set(allMessageRows.map((row) => row.id)).size,
      allMessageRows.length,
      "messages 主键必须全局唯一",
    );
    assert.equal(
      new Set(allEventRows.map((row) => row.id)).size,
      allEventRows.length,
      "events 主键必须全局唯一",
    );
    // 主键是服务端生成的 UUID，不再采用模型固定 id
    assert.ok(allMessageRows.every((row) => row.id !== modelDialogueId));
    assert.ok(allEventRows.every((row) => row.id !== modelEventId));
    assert.ok(allMessageRows.every((row) => uuidPattern.test(row.id)));
    assert.ok(allEventRows.every((row) => uuidPattern.test(row.id)));

    // evidence 引用保持模型原始 id 字符串，不被改写为表主键
    const readEvidence = (turnId) =>
      database
        .prepare(
          "SELECT evidence_json FROM state_changes WHERE turn_id = ? ORDER BY ordinal",
        )
        .all(turnId)
        .map((row) => JSON.parse(row.evidence_json));
    assert.deepEqual(readEvidence(turnA.id), [[modelEventId, "event-2"]]);
    assert.deepEqual(readEvidence(turnB.id), [[modelEventId, "event-2"]]);
    assert.deepEqual(readEvidence(forkTurn.id), [[modelEventId, "event-2"]]);

    // 重生成路径：同一回合改写仍复用相同模型 id，先删后插、主键重新生成
    store.replaceHeadTurn({
      actionId: "dup-id-rewrite",
      feedback: "改写分支回合",
      expectedRegenerationCount: 0,
      turnId: forkTurn.id,
      sessionId: started.sessionId,
      branchId: fork.branchId,
      expectedParentTurnId: started.openingTurnId,
      generatedOutput: { schemaVersion: "1.0.0", scene: "改写后的分支回合。" },
      summaryPatch: "改写后的分支回合。",
      messages: makeMessages(started.mainCharacterId),
      events: makeEvents(),
      stateMutations: makeMutations(started.mainCharacterId, "改写"),
    });
    const replacedMessages = database
      .prepare("SELECT id FROM messages WHERE turn_id = ? ORDER BY ordinal")
      .all(forkTurn.id);
    const replacedEvents = database
      .prepare("SELECT id FROM events WHERE turn_id = ? ORDER BY id")
      .all(forkTurn.id);
    assert.equal(replacedMessages.length, 3);
    assert.equal(replacedEvents.length, 2);
    assert.ok(replacedMessages.every((row) => uuidPattern.test(row.id)));
    assert.ok(replacedEvents.every((row) => uuidPattern.test(row.id)));
    const allIdsAfterRewrite = database
      .prepare("SELECT id FROM messages")
      .all()
      .map((row) => row.id);
    assert.equal(
      new Set(allIdsAfterRewrite).size,
      allIdsAfterRewrite.length,
      "重生成后 messages 主键仍全局唯一",
    );
    assert.deepEqual(readEvidence(forkTurn.id), [[modelEventId, "event-2"]]);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("deleting the active non-main branch falls back to its parent", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-set-main-active-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "南路分支",
      sourceTurnId: started.openingTurnId,
    });
    // 创建分支后活动分支是支线本身
    assert.equal(
      store.loadAdventure(started.sessionId).branchState.branch.id,
      fork.branchId,
    );
    // 删除活动支线：活动分支回退到父分支（主线）
    const deleted = store.deleteBranch(started.sessionId, fork.branchId);
    assert.equal(deleted.activeBranchId, started.branchId);
    const adventure = store.loadAdventure(started.sessionId);
    assert.equal(adventure.branchState.branch.id, started.branchId);
    assert.equal(adventure.branchState.branch.isMain, true);
    assert.equal(store.listBranches(started.sessionId).length, 1);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("设为主线时重组分支树：新主线吸收父链历史成为根主线", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-reparent-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    // A（主线）推进到 5 回合
    let head = started.openingTurnId;
    for (let sequence = 2; sequence <= 5; sequence += 1) {
      const next = await advanceForkTurn(
        store,
        started,
        head,
        `reparent-root-${sequence}`,
        `北路 ${sequence}`,
      );
      head = next.committedTurn.id;
    }
    assert.equal(store.loadAdventure(started.sessionId).branchState.turnHistory.length, 5);
    // 记录 A 的回合顺序（turnHistory 倒序：0=回合5 … 4=回合1）
    const rootHistory = store.loadAdventure(started.sessionId).branchState.turnHistory;
    // 从回合 3 分叉 B，B 推进 2 回合
    const forkSource = rootHistory.find(
      (turn) => turn.sequence === 3,
    );
    assert.ok(forkSource);
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "南路分支",
      sourceTurnId: forkSource.id,
    });
    const forkTurn1 = await advanceForkTurn(
      store,
      started,
      forkSource.id,
      "reparent-fork-4",
      "南路 4",
    );
    assert.equal(forkTurn1.committedTurn.sequence, 4);
    const forkTurn2 = await advanceForkTurn(
      store,
      started,
      forkTurn1.committedTurn.id,
      "reparent-fork-5",
      "南路 5",
    );
    assert.equal(forkTurn2.committedTurn.sequence, 5);
    // 物化状态在重组前后保持一致
    const bStatesBefore = JSON.stringify(store.loadBranchState(fork.branchId).states);
    const aStatesBefore = JSON.stringify(store.loadBranchState(started.branchId).states);

    // B 设为主线 → 分支树重组
    const transferred = store.setMainBranch(started.sessionId, fork.branchId);
    assert.equal(transferred.isMain, true);

    // B：根 + 主线，历史完整（A 的 1..3 吸收 + B 的 4..5 重排为连续 1..5）
    const bState = store.loadBranchState(fork.branchId);
    assert.equal(bState.branch.parentBranchId, null);
    assert.equal(bState.branch.isMain, true);
    assert.equal(bState.branch.headTurnId, forkTurn2.committedTurn.id);
    assert.equal(bState.branch.nextSequence, 6);
    assert.deepEqual(
      bState.turnHistory.map((turn) => turn.sequence),
      [5, 4, 3, 2, 1],
    );
    assert.equal(
      bState.turnHistory.every((turn) => turn.branchId === fork.branchId),
      true,
    );
    assert.deepEqual(
      bState.turnHistory.map((turn) => turn.id),
      [
        forkTurn2.committedTurn.id,
        forkTurn1.committedTurn.id,
        forkSource.id,
        rootHistory[3].id,
        rootHistory[4].id,
      ],
    );

    // A：B 的子分支，分叉点之后的自有回合（4..5）保留并重排为 1..2；
    // 可见历史 = B 的 1..3 + A 自己的 1..2
    const aState = store.loadBranchState(started.branchId);
    assert.equal(aState.branch.parentBranchId, fork.branchId);
    assert.equal(aState.branch.forkedFromTurnId, forkSource.id);
    assert.equal(aState.branch.isMain, false);
    assert.equal(aState.branch.headTurnId, head);
    assert.equal(aState.branch.nextSequence, 3);
    assert.deepEqual(
      aState.turnHistory.map((turn) => turn.sequence),
      [2, 1, 3, 2, 1],
    );
    assert.equal(aState.turnHistory[0].branchId, started.branchId);
    assert.equal(aState.turnHistory[1].branchId, started.branchId);
    assert.equal(aState.turnHistory[2].branchId, fork.branchId);

    // 物化状态保持不变（B 保持分叉点之后的状态，A 保持分叉点后的自有状态）
    assert.equal(JSON.stringify(store.loadBranchState(fork.branchId).states), bStatesBefore);
    assert.equal(
      JSON.stringify(store.loadBranchState(started.branchId).states),
      aStatesBefore,
    );

    // 回合归属：B 名下 5 回合（1..5），A 名下 2 回合（1..2）
    const turns = database
      .prepare(
        "SELECT branch_id, sequence FROM turns WHERE session_id = ? ORDER BY branch_id, sequence",
      )
      .all(started.sessionId);
    const bTurns = turns.filter((row) => row.branch_id === fork.branchId);
    const aTurns = turns.filter((row) => row.branch_id === started.branchId);
    assert.deepEqual(
      bTurns.map((row) => row.sequence),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      aTurns.map((row) => row.sequence),
      [1, 2],
    );

    // B 与 A 均可继续推进，切换分支正常
    store.switchBranch(started.sessionId, fork.branchId);
    const bNext = await advanceForkTurn(
      store,
      started,
      forkTurn2.committedTurn.id,
      "reparent-b-6",
      "主线继续",
    );
    assert.equal(bNext.committedTurn.sequence, 6);
    assert.equal(bNext.committedTurn.branchId, fork.branchId);
    store.switchBranch(started.sessionId, started.branchId);
    const aNext = await advanceForkTurn(
      store,
      started,
      head,
      "reparent-a-3",
      "原主线继续",
    );
    assert.equal(aNext.committedTurn.sequence, 3);
    assert.equal(aNext.committedTurn.branchId, started.branchId);
    // 从 B 的历史回合（被吸收的回合）创建新分支仍然可用
    store.switchBranch(started.sessionId, fork.branchId);
    const fromAbsorbed = store.createBranch({
      sessionId: started.sessionId,
      name: "从吸收历史分支",
      sourceTurnId: forkSource.id,
    });
    assert.equal(
      store.loadAdventure(started.sessionId).branchState.branch.id,
      fromAbsorbed.branchId,
    );
    assert.equal(fromAbsorbed.sourceSequence, 3);

    // 旁路子分支（不在新主线路径上的分支）不受树重组影响，仍可正常推进
    const sideFork = store.createBranch({
      sessionId: started.sessionId,
      name: "旁路分支",
      sourceTurnId: rootHistory[3].id,
    });
    const sideTurn = await advanceForkTurn(
      store,
      started,
      rootHistory[3].id,
      "reparent-side-3",
      "旁路 3",
    );
    assert.equal(sideTurn.committedTurn.sequence, 3);
    const sideState = store.loadAdventure(started.sessionId);
    assert.equal(sideState.branchState.branch.parentBranchId, fork.branchId);
    assert.deepEqual(
      sideState.branchState.turnHistory.map((turn) => turn.sequence),
      [3, 2, 1],
    );
    assert.equal(sideState.branchState.turnHistory[0].branchId, sideFork.branchId);
    assert.equal(sideState.branchState.turnHistory[1].branchId, fork.branchId);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("设为主线时原主线没有分叉点后的回合则变空分支，可继续推进或删除", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-reparent-empty-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    // A 推进 3 回合后停在回合 3，从回合 3 分叉 B
    let head = started.openingTurnId;
    for (let sequence = 2; sequence <= 3; sequence += 1) {
      const next = await advanceForkTurn(
        store,
        started,
        head,
        `empty-root-${sequence}`,
        `北路 ${sequence}`,
      );
      head = next.committedTurn.id;
    }
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "南路分支",
      sourceTurnId: head,
    });
    const forkTurn1 = await advanceForkTurn(
      store,
      started,
      head,
      "empty-fork-2",
      "南路",
    );
    assert.equal(forkTurn1.committedTurn.sequence, 4);

    // B 设为主线：A 变空分支，B 吸收 A 的回合 1..3
    store.setMainBranch(started.sessionId, fork.branchId);
    const aState = store.loadBranchState(started.branchId);
    assert.equal(aState.branch.parentBranchId, fork.branchId);
    assert.equal(aState.branch.headTurnId, head);
    assert.equal(aState.branch.nextSequence, 1);
    // A 名下没有自有回合，其可见历史全部来自 B（吸收后的回合）
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS total FROM turns WHERE branch_id = ?")
        .get(started.branchId).total,
      0,
    );
    assert.equal(
      aState.turnHistory.every((turn) => turn.branchId === fork.branchId),
      true,
    );
    const bState = store.loadBranchState(fork.branchId);
    assert.equal(bState.branch.parentBranchId, null);
    assert.equal(bState.branch.nextSequence, 5);
    assert.deepEqual(
      bState.turnHistory.map((turn) => turn.sequence),
      [4, 3, 2, 1],
    );

    // 空分支可从分叉点继续发展新路线
    store.switchBranch(started.sessionId, started.branchId);
    const aNext = await advanceForkTurn(
      store,
      started,
      head,
      "empty-a-new-1",
      "原主线新路线",
    );
    assert.equal(aNext.committedTurn.sequence, 1);
    assert.equal(aNext.committedTurn.branchId, started.branchId);
    // B 的可见历史不受 A 新路线影响
    store.switchBranch(started.sessionId, fork.branchId);
    assert.equal(store.loadAdventure(started.sessionId).branchState.turnHistory.length, 4);

    // 空分支（没有子分支）可以删除
    const deleted = store.deleteBranch(started.sessionId, started.branchId);
    assert.equal(deleted.branchId, started.branchId);
    assert.equal(store.listBranches(started.sessionId).length, 1);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("多层父链：P→A→B，B 设为主线后 P、A 均为 B 的子分支", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-reparent-multi-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    // P（根主线）推进 4 回合
    let pHead = started.openingTurnId;
    for (let sequence = 2; sequence <= 4; sequence += 1) {
      const next = await advanceForkTurn(
        store,
        started,
        pHead,
        `multi-p-${sequence}`,
        `北路 ${sequence}`,
      );
      pHead = next.committedTurn.id;
    }
    const pHistory = store.loadAdventure(started.sessionId).branchState.turnHistory;
    const pTurn2 = pHistory.find(
      (turn) => turn.sequence === 2,
    );
    assert.ok(pTurn2);
    // A 从 P 的回合 2 分叉，推进 2 回合
    const aFork = store.createBranch({
      sessionId: started.sessionId,
      name: "中层分支",
      sourceTurnId: pTurn2.id,
    });
    const aTurn1 = await advanceForkTurn(
      store,
      started,
      pTurn2.id,
      "multi-a-3",
      "中层 3",
    );
    assert.equal(aTurn1.committedTurn.sequence, 3);
    const aTurn2 = await advanceForkTurn(
      store,
      started,
      aTurn1.committedTurn.id,
      "multi-a-4",
      "中层 4",
    );
    assert.equal(aTurn2.committedTurn.sequence, 4);
    // B 从 A 的回合 3 分叉，推进 1 回合
    const bFork = store.createBranch({
      sessionId: started.sessionId,
      name: "末端分支",
      sourceTurnId: aTurn1.committedTurn.id,
    });
    const bTurn1 = await advanceForkTurn(
      store,
      started,
      aTurn1.committedTurn.id,
      "multi-b-4",
      "末端 4",
    );
    assert.equal(bTurn1.committedTurn.sequence, 4);

    // B 设为主线：P、A 全部变为 B 的子分支
    store.setMainBranch(started.sessionId, bFork.branchId);
    const bState = store.loadBranchState(bFork.branchId);
    assert.equal(bState.branch.parentBranchId, null);
    assert.equal(bState.branch.isMain, true);
    assert.equal(bState.branch.nextSequence, 5);
    assert.deepEqual(
      bState.turnHistory.map((turn) => turn.sequence),
      [4, 3, 2, 1],
    );
    assert.equal(
      bState.turnHistory.every((turn) => turn.branchId === bFork.branchId),
      true,
    );
    // 时间顺序：P 的 1..2、A 的 3、B 的 4（B 的倒序历史：B4、A3、P2、P1）
    assert.equal(bState.turnHistory[0].id, bTurn1.committedTurn.id);
    assert.equal(bState.turnHistory[1].id, aTurn1.committedTurn.id);
    assert.equal(bState.turnHistory[2].id, pTurn2.id);
    assert.equal(bState.turnHistory[3].id, pHistory[3].id);

    // P：保留分叉点后的回合 3..4 重排为 1..2；可见历史 = B 的 1..2 + P 的 1..2
    const pState = store.loadBranchState(started.branchId);
    assert.equal(pState.branch.parentBranchId, bFork.branchId);
    assert.equal(pState.branch.forkedFromTurnId, pTurn2.id);
    assert.equal(pState.branch.headTurnId, pHead);
    assert.equal(pState.branch.nextSequence, 3);
    assert.deepEqual(
      pState.turnHistory.map((turn) => turn.sequence),
      [2, 1, 2, 1],
    );
    assert.equal(pState.turnHistory[0].branchId, started.branchId);
    assert.equal(pState.turnHistory[1].branchId, started.branchId);
    assert.equal(pState.turnHistory[2].branchId, bFork.branchId);
    assert.equal(pState.turnHistory[3].branchId, bFork.branchId);
    // A：保留分叉点后的回合 4 重排为 1；可见历史 = B 的 1..3 + A 的 1
    const aState = store.loadBranchState(aFork.branchId);
    assert.equal(aState.branch.parentBranchId, bFork.branchId);
    assert.equal(aState.branch.forkedFromTurnId, aTurn1.committedTurn.id);
    assert.equal(aState.branch.headTurnId, aTurn2.committedTurn.id);
    assert.equal(aState.branch.nextSequence, 2);
    assert.deepEqual(
      aState.turnHistory.map((turn) => turn.sequence),
      [1, 3, 2, 1],
    );
    assert.equal(aState.turnHistory[0].branchId, aFork.branchId);
    assert.equal(aState.turnHistory[1].branchId, bFork.branchId);

    // 三个分支均可继续推进
    store.switchBranch(started.sessionId, started.branchId);
    const pNext = await advanceForkTurn(store, started, pHead, "multi-p-next-3", "P 继续");
    assert.equal(pNext.committedTurn.sequence, 3);
    store.switchBranch(started.sessionId, aFork.branchId);
    const aNext = await advanceForkTurn(
      store,
      started,
      aTurn2.committedTurn.id,
      "multi-a-next-2",
      "A 继续",
    );
    assert.equal(aNext.committedTurn.sequence, 2);
    store.switchBranch(started.sessionId, bFork.branchId);
    const bNext = await advanceForkTurn(
      store,
      started,
      bTurn1.committedTurn.id,
      "multi-b-next-5",
      "B 继续",
    );
    assert.equal(bNext.committedTurn.sequence, 5);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("设主线幂等：已是根主线再设不变；无父链分支设主线只转移身份", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-reparent-idem-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "南路分支",
      sourceTurnId: started.openingTurnId,
    });
    // 模拟旧版本遗留：主线身份已转移但树未重组（根分支非主线、无父链；支线仍为主线的子分支）
    database
      .prepare("UPDATE branches SET is_main = 0 WHERE id = ?")
      .run(started.branchId);
    database
      .prepare("UPDATE branches SET is_main = 1 WHERE id = ?")
      .run(fork.branchId);
    const snapshotTree = () =>
      database
        .prepare("SELECT id, parent_branch_id, forked_from_turn_id, head_turn_id, next_sequence FROM branches ORDER BY id")
        .all();
    const snapshotTurns = () =>
      database
        .prepare("SELECT id, branch_id, sequence FROM turns ORDER BY id")
        .all();
    const treeBeforeLegacy = snapshotTree();
    const turnsBeforeLegacy = snapshotTurns();
    // 无父链分支设为主线：只转移主线身份，不改变分支树与回合归属
    store.setMainBranch(started.sessionId, started.branchId);
    assert.deepEqual(snapshotTree(), treeBeforeLegacy);
    assert.deepEqual(snapshotTurns(), turnsBeforeLegacy);
    assert.equal(
      store.listBranches(started.sessionId).find((branch) => branch.id === started.branchId).isMain,
      true,
    );
    assert.equal(
      store.listBranches(started.sessionId).find((branch) => branch.id === fork.branchId).isMain,
      false,
    );

    // 旧存档中主线带父链时再设一次：补做树重组（主线变为根，父链变子分支）
    const repaired = store.setMainBranch(started.sessionId, fork.branchId);
    assert.equal(repaired.isMain, true);
    assert.equal(store.loadBranchState(fork.branchId).branch.parentBranchId, null);
    assert.equal(
      store.loadBranchState(started.branchId).branch.parentBranchId,
      fork.branchId,
    );
    assert.equal(store.loadBranchState(started.branchId).branch.nextSequence, 1);
    // 已是根主线再设：幂等，完全不变
    const treeAfterRepair = snapshotTree();
    const turnsAfterRepair = snapshotTurns();
    const again = store.setMainBranch(started.sessionId, fork.branchId);
    assert.equal(again.isMain, true);
    assert.deepEqual(snapshotTree(), treeAfterRepair);
    assert.deepEqual(snapshotTurns(), turnsAfterRepair);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("树重组后恢复点随迁、快照序号一致、完整存档往返正常", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-reparent-save-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startForkScenario(store);
    // A 推进 2 回合，手动存档在回合 2（分支 A 名下）
    let head = started.openingTurnId;
    for (let sequence = 2; sequence <= 2; sequence += 1) {
      const next = await advanceForkTurn(
        store,
        started,
        head,
        `save-root-${sequence}`,
        `北路 ${sequence}`,
      );
      head = next.committedTurn.id;
    }
    const manual = store.createSavePoint(started.sessionId, "回合二营地");
    assert.equal(manual.sequence, 2);
    const turn2 = store.loadAdventure(started.sessionId).branchState.turnHistory.find(
      (turn) => turn.sequence === 2,
    );
    assert.ok(turn2);
    // A 继续推进到 4 回合，从回合 3 分叉 B，B 推进 2 回合
    for (let sequence = 3; sequence <= 4; sequence += 1) {
      const next = await advanceForkTurn(
        store,
        started,
        head,
        `save-root-${sequence}`,
        `北路 ${sequence}`,
      );
      head = next.committedTurn.id;
    }
    const turn3 = store.loadAdventure(started.sessionId).branchState.turnHistory.find(
      (turn) => turn.sequence === 3,
    );
    assert.ok(turn3);
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "南路分支",
      sourceTurnId: turn3.id,
    });
    const forkTurn1 = await advanceForkTurn(
      store,
      started,
      turn3.id,
      "save-fork-4",
      "南路 4",
    );
    const forkTurn2 = await advanceForkTurn(
      store,
      started,
      forkTurn1.committedTurn.id,
      "save-fork-5",
      "南路 5",
    );
    // 自动快照冲突场景：A 推进 5 回合后分叉（分叉点回合 5 上有自动快照）
    // —— 为覆盖"自动快照与分叉快照同序号去重"，先单独构造 5 回合 + 分叉的会话
    const second = startForkScenario(store);
    let secondHead = second.openingTurnId;
    for (let sequence = 2; sequence <= 5; sequence += 1) {
      const next = await advanceForkTurn(
        store,
        second,
        secondHead,
        `save2-root-${sequence}`,
        `北路 ${sequence}`,
      );
      secondHead = next.committedTurn.id;
    }
    const secondFork = store.createBranch({
      sessionId: second.sessionId,
      name: "五回合分叉",
      sourceTurnId: secondHead,
    });

    // B 设为主线（第一个会话）
    store.setMainBranch(started.sessionId, fork.branchId);
    // 手动存档随迁到 B：回合 2 被吸收，序号改为 B 中的新本地序号
    const recoveryPoints = store.listRecoveryPoints(started.sessionId);
    const migrated = recoveryPoints.find((point) => point.id === manual.id);
    assert.ok(migrated);
    assert.equal(migrated.branchId, fork.branchId);
    assert.equal(migrated.sequence, 2);
    assert.equal(migrated.turnId, turn2.id);
    // 恢复点仍然可用：从存档创建新分支
    const fromSave = store.createBranch({
      sessionId: started.sessionId,
      name: "从吸收存档恢复",
      recoveryPointId: manual.id,
    });
    assert.equal(fromSave.sourceSequence, 2);
    const fromSaveState = store.loadAdventure(started.sessionId);
    assert.equal(fromSaveState.branchState.branch.headTurnId, turn2.id);
    // 恢复原手动存档：子分支（原主线在分叉点 3 之后分叉）阻挡就地恢复
    store.switchBranch(started.sessionId, fork.branchId);
    assert.throws(
      () => store.restoreSavePoint(started.sessionId, manual.id),
      /存档“回合二营地”之后仍有分支/,
    );
    store.switchBranch(started.sessionId, fromSave.branchId);
    store.deleteBranch(started.sessionId, fromSave.branchId);
    // 删除"从存档恢复"分支后，原主线仍从分叉点之后阻挡恢复到更早回合
    assert.throws(
      () => store.restoreSavePoint(started.sessionId, manual.id),
      /存档“回合二营地”之后仍有分支/,
    );
    // 在重组后的 B 上继续推进、保存并就地恢复：照常工作
    store.switchBranch(started.sessionId, fork.branchId);
    const bAdvance = await advanceForkTurn(
      store,
      started,
      forkTurn2.committedTurn.id,
      "save-b-6",
      "主线继续",
    );
    assert.equal(bAdvance.committedTurn.sequence, 6);
    const bSave = store.createSavePoint(started.sessionId, "主线第六回合");
    assert.equal(bSave.sequence, 6);
    const bAdvance2 = await advanceForkTurn(
      store,
      started,
      bAdvance.committedTurn.id,
      "save-b-7",
      "主线再继续",
    );
    assert.equal(bAdvance2.committedTurn.sequence, 7);
    const restoredAfter = store.restoreSavePoint(started.sessionId, bSave.id);
    assert.equal(restoredAfter.branchId, fork.branchId);
    assert.equal(restoredAfter.turnId, bAdvance.committedTurn.id);
    assert.equal(restoredAfter.removedTurnCount, 1);
    assert.equal(
      store.loadAdventure(started.sessionId).branchState.branch.headTurnId,
      bAdvance.committedTurn.id,
    );

    // 第二个会话：分叉点回合有自动快照 → 重组后自动快照与分叉快照同序号时保留分叉快照
    store.switchBranch(second.sessionId, second.branchId);
    const autoBefore = database
      .prepare(
        "SELECT sequence, kind FROM snapshots WHERE branch_id = ? ORDER BY sequence",
      )
      .all(second.branchId);
    assert.equal(
      autoBefore.some((row) => row.kind === "automatic" && row.sequence === 5),
      true,
    );
    store.setMainBranch(second.sessionId, secondFork.branchId);
    // 新主线吸收全部 5 个回合：开局自动快照随迁（序号 1），
    // 分叉点回合 5 的自动快照与分叉快照同序号时保留分叉快照（去重）
    const forkSnapshots = database
      .prepare(
        "SELECT sequence, kind, turn_id FROM snapshots WHERE branch_id = ? ORDER BY sequence",
      )
      .all(secondFork.branchId);
    assert.deepEqual(
      forkSnapshots.map((row) => ({ sequence: row.sequence, kind: row.kind })),
      [
        { sequence: 1, kind: "automatic" },
        { sequence: 5, kind: "fork" },
      ],
    );
    // 原主线成为空子分支：为其补建分叉起点快照（序号 0），原有自动快照随回合转移
    const secondRootSnapshots = database
      .prepare(
        "SELECT sequence, kind FROM snapshots WHERE branch_id = ? ORDER BY sequence",
      )
      .all(second.branchId)
      .map((row) => ({ sequence: row.sequence, kind: row.kind }));
    assert.deepEqual(secondRootSnapshots, [{ sequence: 0, kind: "fork" }]);

    // 完整存档往返：树重组后的分支结构、回合归属、存档完整导出并导入
    const archive = exportCompleteAdventure(database, started.sessionId);
    assert.equal(archive.summary.branchCount, 2);
    assert.equal(archive.summary.turnCount, 7);
    assert.equal(archive.summary.manualSaveCount, 2);
    assert.equal(archive.data.branches.filter((row) => row.is_main === 1).length, 1);
    const imported = importCompleteAdventure(database, archive);
    const importedStore = new LocalStoryStore(database);
    const importedBranches = importedStore.listBranches(imported.sessionId);
    assert.equal(importedBranches.length, 2);
    const importedMain = importedBranches.find((branch) => branch.isMain);
    assert.equal(importedMain.name, "南路分支");
    assert.equal(importedMain.parentBranchId, null);
    const importedChild = importedBranches.find(
      (branch) => branch.name === "主线",
    );
    assert.equal(importedChild.parentBranchId, importedMain.id);
    const importedTurns = database
      .prepare(
        "SELECT branch_id, sequence FROM turns WHERE session_id = ? ORDER BY branch_id, sequence",
      )
      .all(imported.sessionId);
    assert.equal(
      importedTurns.filter((row) => row.branch_id === importedMain.id).length,
      6,
    );
    assert.equal(
      importedTurns.filter((row) => row.branch_id === importedChild.id).length,
      1,
    );
    assert.equal(
      importedStore.listRecoveryPoints(imported.sessionId).find(
        (point) => point.type === "manual",
      ).branchId,
      importedMain.id,
    );
    // 导入后仍可继续推进新主线
    const importedAdventure = importedStore.loadAdventure(imported.sessionId);
    const importedNext = importedStore.commitTurn({
      sessionId: imported.sessionId,
      branchId: importedMain.id,
      expectedHeadTurnId: importedAdventure.branchState.branch.headTurnId,
      idempotencyKey: "imported-next-8",
      playerInput: { customChoice: "导入后继续" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "导入后继续推进。" },
      summaryPatch: "导入后继续推进。",
      stateMutations: [],
    });
    assert.equal(importedNext.sequence, 7);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
