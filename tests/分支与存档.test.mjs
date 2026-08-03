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
    // 原主线仍有子分支，同样不能删除
    assert.throws(
      () => store.deleteBranch(started.sessionId, started.branchId),
      BranchManagementError,
    );

    // 主线转移回原主线后，原支线成为普通支线且没有子分支，可以删除
    store.setMainBranch(started.sessionId, started.branchId);
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
