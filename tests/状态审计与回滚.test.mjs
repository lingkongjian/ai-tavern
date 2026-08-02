import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import {
  parseStateAuditControlInput,
  StateAuditInputError,
} from "../lib/story/状态审计.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

test("validates state-audit control requests", () => {
  assert.throws(
    () =>
      parseStateAuditControlInput({
        sessionId: "session-1",
        value: {
          actionId: "bad-lock",
          operation: "set_lock",
          entityType: "character_state",
          entityId: "character-1",
          fieldPath: "mood",
          locked: true,
          reason: "测试",
        },
      }),
    StateAuditInputError,
  );
});

test("audits, locks and compensates state changes without deleting story turns", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-state-audit-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });
  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "状态审计测试",
      world: { name: "雾港", premise: "港口会记录每一次承诺。" },
      player: { name: "调查员", description: "追查失踪船只的人。" },
      mainCharacter: {
        name: "领航员",
        role: "熟悉雾港航道的向导",
        personality: "谨慎、坚韧。",
      },
      openingScene: "调查员与领航员在雾港码头会合。",
      initialStoryDirection: "找到失踪船只。",
    });

    const secondTurn = store.commitTurn({
      sessionId: started.sessionId,
      branchId: started.branchId,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "audit-turn-2",
      playerInput: { roleplay: { mode: "speech", content: "你看见了什么？" } },
      generatedOutput: { schemaVersion: "1.0.0", scene: "领航员望向浓雾。" },
      summaryPatch: "领航员开始回忆失踪当晚。",
      messages: [{ role: "narrator", content: "领航员望向浓雾。" }],
      stateMutations: [
        {
          entityType: "character_state",
          entityId: started.mainCharacterId,
          operation: "merge",
          value: { mood: "不安" },
          reason: "领航员回忆起失踪船只",
          evidence: ["领航员望向浓雾"],
        },
      ],
    });

    let audit = store.loadStateAudit(started.sessionId);
    const moodChange = audit.actions
      .flatMap((action) => action.changes)
      .find(
        (change) =>
          change.entityType === "character_state" &&
          change.entityId === started.mainCharacterId &&
          change.fields.some((field) => field.path === "/mood"),
      );
    assert.ok(moodChange);
    assert.equal(moodChange.fields.find((field) => field.path === "/mood").after, "不安");

    const lockRequest = {
      actionId: "lock-guide-mood",
      sessionId: started.sessionId,
      operation: "set_lock",
      entityType: "character_state",
      entityId: started.mainCharacterId,
      fieldPath: "/mood",
      locked: true,
      reason: "玩家要求保留当前情绪基线",
    };
    assert.equal(store.manageStateAudit(lockRequest).reused, false);
    assert.equal(store.manageStateAudit(lockRequest).reused, true);
    store.manageStateAudit({
      actionId: "lock-guide-personality",
      sessionId: started.sessionId,
      operation: "set_lock",
      entityType: "character_card",
      entityId: started.mainCharacterId,
      fieldPath: "/data/personality",
      locked: true,
      reason: "保持角色核心性格",
    });

    const thirdTurn = store.commitTurn({
      sessionId: started.sessionId,
      branchId: started.branchId,
      expectedHeadTurnId: secondTurn.id,
      idempotencyKey: "audit-turn-3",
      playerInput: { roleplay: { mode: "action", content: "递给他航海日志" } },
      generatedOutput: { schemaVersion: "1.0.0", scene: "领航员接过日志。" },
      summaryPatch: "调查员交出了航海日志。",
      messages: [{ role: "narrator", content: "领航员接过日志。" }],
      stateMutations: [
        {
          entityType: "character_state",
          entityId: started.mainCharacterId,
          operation: "merge",
          value: { mood: "狂喜", currentGoal: "核对航海日志" },
          reason: "领航员取得新的线索",
          evidence: ["领航员接过日志"],
        },
        {
          entityType: "character_card",
          entityId: started.mainCharacterId,
          operation: "merge",
          value: {
            data: {
              personality: "轻率而冲动",
              description: "掌握失踪船只航海日志的领航员。",
            },
          },
          reason: "航海日志改变了领航员的长期资料",
          evidence: ["领航员接过日志"],
        },
      ],
    });
    let adventure = store.loadAdventure(started.sessionId);
    let characterState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(characterState.state.mood, "不安");
    assert.equal(characterState.state.currentGoal, "核对航海日志");
    const characterCard = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_card" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(characterCard.state.data.personality, "谨慎、坚韧。");
    assert.equal(
      characterCard.state.data.description,
      "掌握失踪船只航海日志的领航员。",
    );
    const loadedThirdTurn = store.loadTurn(started.branchId, thirdTurn.id);
    assert.deepEqual(loadedThirdTurn.stateChanges[0].payload, {
      currentGoal: "核对航海日志",
    });
    assert.deepEqual(
      loadedThirdTurn.blockedStateChanges.map((change) => change.fieldPaths),
      [["/mood"], ["/data/personality"]],
    );

    audit = store.loadStateAudit(started.sessionId);
    assert.equal(audit.locks.length, 2);
    assert.equal(
      audit.actions
        .flatMap((action) => action.changes)
        .find((change) => change.id === moodChange.id)
        .fields.find((field) => field.path === "/mood").locked,
      true,
    );

    store.manageStateAudit({
      actionId: "rollback-guide-mood-change",
      sessionId: started.sessionId,
      operation: "rollback",
      changeId: moodChange.id,
      reason: "玩家撤销领航员在第二回合产生的状态变化",
    });
    adventure = store.loadAdventure(started.sessionId);
    characterState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(characterState.state.mood, "待定");
    assert.equal(characterState.state.currentGoal, "依照角色设定应对玩家");
    assert.equal(adventure.branchState.turnHistory.length, 3);
    assert.equal(store.loadStateAudit(started.sessionId).actions[0].source, "rollback");
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM state_control_changes").get().total,
      1,
    );

    store.manageStateAudit({
      actionId: "unlock-guide-mood",
      sessionId: started.sessionId,
      operation: "set_lock",
      entityType: "character_state",
      entityId: started.mainCharacterId,
      fieldPath: "/mood",
      locked: false,
      reason: "玩家允许后续剧情继续改变情绪",
    });
    store.manageStateAudit({
      actionId: "unlock-guide-personality",
      sessionId: started.sessionId,
      operation: "set_lock",
      entityType: "character_card",
      entityId: started.mainCharacterId,
      fieldPath: "/data/personality",
      locked: false,
      reason: "允许玩家后续调整人物性格",
    });
    assert.equal(store.loadStateAudit(started.sessionId).locks.length, 0);

    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    assert.equal(store.loadAdventure(started.sessionId).branchState.turnHistory.length, 3);
    assert.equal(store.loadStateAudit(started.sessionId).actions[0].source, "rollback");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
