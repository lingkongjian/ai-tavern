import assert from "node:assert/strict";
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
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "旧存档升级测试",
      world: { name: "旧城", premise: "用于验证升级恢复点。" },
      player: { name: "旧玩家", description: "本地旧存档的玩家。" },
      mainCharacter: {
        name: "旧向导",
        role: "旧城向导",
        personality: "会保留升级前的状态。",
      },
      openingScene: "旧玩家抵达旧城。",
    });
    database.prepare("DELETE FROM snapshots").run();
    database.close();

    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    const points = store.listRecoveryPoints(started.sessionId);
    assert.equal(points.length, 1);
    assert.equal(points[0].type, "automatic");
    assert.equal(points[0].name, "升级时自动存档");
    const restored = store.createBranch({
      sessionId: started.sessionId,
      name: "从升级存档恢复",
      recoveryPointId: points[0].id,
    });
    assert.equal(restored.sourceSequence, 1);
    assert.equal(
      store.loadAdventure(started.sessionId).branchState.states.length > 0,
      true,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
