import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import {
  parseWorldBookManagementInput,
  WorldBookManagementInputError,
} from "../lib/story/世界书管理.ts";
import {
  createStoryGenerationPrompt,
  resolvePlayerTurn,
} from "../lib/story/剧情提示.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

test("validates world-book editor requests", () => {
  assert.throws(
    () =>
      parseWorldBookManagementInput({
        sessionId: "session-1",
        value: {
          actionId: "world-create",
          operation: "create",
          entry: {
            comment: "没有触发方式",
            keys: [],
            content: "这是一条非常驻事实。",
            enabled: true,
            constant: false,
          },
        },
      }),
    WorldBookManagementInputError,
  );
  assert.throws(
    () =>
      parseWorldBookManagementInput({
        sessionId: "session-1",
        value: {
          actionId: "world-toggle",
          operation: "set_enabled",
          entryId: "entry-1",
          enabled: "yes",
        },
      }),
    WorldBookManagementInputError,
  );
});

test("edits imported facts through reversible player overlays", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-world-editor-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "世界书层级测试",
      world: { name: "雾港", premise: "雾港的灯塔记录潮汐契约。" },
      player: { name: "访客", description: "寻找旧契约的人。" },
      mainCharacter: {
        name: "守塔人",
        role: "灯塔看守",
        personality: "克制、重视契约。",
      },
      worldBookEntries: [
        {
          sourceId: "tide-law",
          sourceBookName: "雾港世界书",
          sourceFormat: "ai_tavern_world_book_v1",
          comment: "旧潮汐法则",
          keys: ["潮汐", "灯塔"],
          content: "灯塔每晚只点亮一次。",
          enabled: true,
          constant: true,
        },
      ],
      openingScene: "访客在夜色中抵达灯塔。",
      initialStoryDirection: "查明旧契约的内容。",
    });
    const before = store.loadAdventure(started.sessionId);
    const base = before.branchState.states.find(
      (state) =>
        state.entityType === "world_book_entry" &&
        state.state.layer === "base_import",
    );
    assert.ok(base);

    const updateRequest = {
      actionId: "world-update-base",
      sessionId: started.sessionId,
      operation: "update",
      entryId: base.entityId,
      entry: {
        comment: "新潮汐法则",
        keys: ["潮汐", "灯塔"],
        content: "契约生效后，灯塔会在午夜再次点亮。",
        enabled: true,
        constant: true,
        position: "before_char",
        order: 100,
        probability: 100,
        depth: 4,
      },
    };
    const updated = store.manageWorldBook(updateRequest);
    assert.equal(updated.reused, false);
    assert.equal(updated.overridesEntryId, base.entityId);
    assert.equal(store.manageWorldBook(updateRequest).reused, true);

    let adventure = store.loadAdventure(started.sessionId);
    const unchangedBase = adventure.branchState.states.find(
      (state) => state.entityId === base.entityId,
    );
    const overlay = adventure.branchState.states.find(
      (state) => state.state.shadowsEntryId === base.entityId && state.isActive,
    );
    assert.equal(unchangedBase.state.content, "灯塔每晚只点亮一次。");
    assert.equal(unchangedBase.state.layer, "base_import");
    assert.ok(overlay);
    assert.equal(overlay.state.layer, "player_override");
    assert.equal(overlay.state.content, "契约生效后，灯塔会在午夜再次点亮。");
    assert.equal(adventure.branchState.turnHistory.length, 1);

    const resolved = resolvePlayerTurn(adventure, {
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "world-prompt-check",
      customChoice: "询问午夜灯光的来历",
    });
    const prompt = createStoryGenerationPrompt({
      adventure,
      turnId: "world-prompt-turn",
      resolvedPlayerTurn: resolved,
    });
    const contextText = JSON.stringify(prompt.snapshot.context.activeStates);
    assert.match(contextText, /午夜再次点亮/);
    assert.doesNotMatch(contextText, /每晚只点亮一次/);

    store.manageWorldBook({
      actionId: "world-disable-base",
      sessionId: started.sessionId,
      operation: "set_enabled",
      entryId: base.entityId,
      enabled: false,
    });
    adventure = store.loadAdventure(started.sessionId);
    const disabledOverlay = adventure.branchState.states.find(
      (state) => state.entityId === overlay.entityId,
    );
    assert.equal(disabledOverlay.isActive, true);
    assert.equal(disabledOverlay.state.enabled, false);

    store.manageWorldBook({
      actionId: "world-restore-base",
      sessionId: started.sessionId,
      operation: "restore_base",
      entryId: overlay.entityId,
    });
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(
      adventure.branchState.states.find((state) => state.entityId === overlay.entityId)
        .isActive,
      false,
    );
    assert.equal(
      adventure.branchState.states.find((state) => state.entityId === base.entityId)
        .isActive,
      true,
    );

    const created = store.manageWorldBook({
      actionId: "world-create-player",
      sessionId: started.sessionId,
      operation: "create",
      entry: {
        comment: "玩家补充",
        keys: ["契约"],
        content: "访客持有一份未署名的契约副本。",
        enabled: true,
      },
    });
    store.manageWorldBook({
      actionId: "world-remove-player",
      sessionId: started.sessionId,
      operation: "remove",
      entryId: created.entryId,
    });
    adventure = store.loadAdventure(started.sessionId);
    const removed = adventure.branchState.states.find(
      (state) => state.entityId === created.entryId,
    );
    assert.equal(removed.isActive, true);
    assert.equal(removed.state.enabled, false);
    assert.equal(removed.state.removedByPlayer, true);
    store.manageWorldBook({
      actionId: "world-enable-player",
      sessionId: started.sessionId,
      operation: "set_enabled",
      entryId: created.entryId,
      enabled: true,
    });
    const restoredPlayer = store
      .loadAdventure(started.sessionId)
      .branchState.states.find((state) => state.entityId === created.entryId);
    assert.equal(restoredPlayer.state.enabled, true);
    assert.equal(restoredPlayer.state.removedByPlayer, undefined);

    const audit = store.loadStateAudit(started.sessionId);
    assert.equal(
      audit.actions.some(
        (action) =>
          action.source === "world_book_management" &&
          action.title.includes("世界书管理"),
      ),
      true,
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM world_book_management_changes WHERE session_id = ?",
        )
        .get(started.sessionId).total > 0,
      true,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
