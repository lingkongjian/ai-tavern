import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  exportCompleteAdventure,
  importCompleteAdventure,
} from "../lib/import/完整存档.ts";
import {
  executeStoryContentCommand,
  loadStoryContentWorkspace,
  parseStoryContentCommand,
  StoryContentInputError,
} from "../lib/content/剧本内容服务.ts";
import {
  ContentAssetManagementError,
  LocalStoryStore,
  RelationshipManagementError,
  StoryNotFoundError,
} from "../lib/storage/story-store.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function startContentStory(store) {
  return store.startAdventure({
    campaignName: "统一内容服务测试",
    world: { name: "纸城", premise: "纸城会保存每次被确认的改动。" },
    player: { name: "访客", description: "能够改写目录的人。" },
    mainCharacter: {
      name: "馆员",
      role: "纸城档案馆的管理者",
      personality: "严谨、克制，会追问修改依据。",
    },
    openingScene: "馆员把六本目录放在访客面前。",
  });
}

test("统一内容协议拒绝错误版本与越界记忆设置", () => {
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-1",
        value: {
          schemaVersion: "2.0.0",
          actionId: "invalid-version",
          domain: "characters",
          command: { operation: "set_presence", characterId: "c1", present: true },
        },
      }),
    (error) =>
      error instanceof StoryContentInputError &&
      error.issues.some((issue) => issue.includes("1.0.0")),
  );
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-1",
        value: {
          schemaVersion: "1.0.0",
          actionId: "invalid-memory",
          domain: "memories",
          command: {
            operation: "update_settings",
            settings: {
              memoryTokenBudget: 100,
              recentTurnCount: 1,
              chapterSize: 30,
            },
          },
        },
      }),
    StoryContentInputError,
  );
});

test("六类内容共享刷新结果，原文与记忆操作具备事务审计和幂等", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-content-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startContentStory(store);
    const sourceCommand = {
      schemaVersion: "1.0.0",
      actionId: "content-source-import",
      domain: "sources",
      command: {
        operation: "import",
        document: {
          name: "纸城原文",
          fileName: "纸城原文.md",
          content: "# 第一章\n馆员打开第一本目录。",
          enabled: true,
          currentChapter: 1,
          preventFuture: true,
          fidelity: "balanced",
        },
      },
    };
    const imported = executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: sourceCommand,
    });
    assert.equal(imported.result.domain, "sources");
    assert.equal(imported.result.reused, false);
    assert.equal(imported.content.sourceDocuments.length, 1);
    assert.equal(imported.content.adventure.session.id, started.sessionId);
    assert.equal(typeof imported.content.memory.settings.memoryTokenBudget, "number");

    const reused = executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: sourceCommand,
    });
    assert.equal(reused.result.reused, true);
    assert.equal(store.listSourceDocuments(started.sessionId).length, 1);
    assert.throws(
      () =>
        executeStoryContentCommand({
          store,
          sessionId: started.sessionId,
          value: {
            ...sourceCommand,
            command: { operation: "remove", documentId: imported.result.targetId },
          },
        }),
      ContentAssetManagementError,
    );

    const memory = executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "content-memory-settings",
        domain: "memories",
        command: {
          operation: "update_settings",
          settings: {
            memoryTokenBudget: 3000,
            recentTurnCount: 7,
            chapterSize: 12,
          },
        },
      },
    });
    assert.equal(memory.content.memory.settings.memoryTokenBudget, 3000);

    const mainCharacterId = started.mainCharacterId;
    const character = executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "content-character-presence",
        domain: "characters",
        command: {
          operation: "set_presence",
          characterId: mainCharacterId,
          present: false,
        },
      },
    });
    assert.equal(character.result.domain, "characters");
    assert.equal(
      character.content.adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === mainCharacterId,
      )?.state.present,
      false,
    );

    const workspace = loadStoryContentWorkspace({
      store,
      sessionId: started.sessionId,
    });
    assert.equal(workspace.schemaVersion, "1.0.0");
    assert.equal(workspace.audit.assets.length, 2);
    assert.equal(
      workspace.audit.state.actions.some(
        (action) => action.source === "character_management",
      ),
      true,
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM content_asset_management_changes WHERE session_id = ?",
        )
        .get(started.sessionId).total,
      2,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("原文与记忆修改保存快照并按最新修订安全撤销", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-content-rollback-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startContentStory(store);
    const originalBudget = store.loadStoryMemory(started.sessionId).settings.memoryTokenBudget;
    const imported = executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rollback-source-import",
        domain: "sources",
        command: {
          operation: "import",
          document: {
            name: "可恢复原文",
            fileName: "可恢复原文.md",
            content: "# 第一章\n馆员把原文放入可恢复档案柜。",
            enabled: true,
            currentChapter: 1,
            preventFuture: true,
            fidelity: "balanced",
          },
        },
      },
    });
    executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rollback-source-remove",
        domain: "sources",
        command: { operation: "remove", documentId: imported.result.targetId },
      },
    });
    assert.equal(store.listSourceDocuments(started.sessionId).length, 0);

    const removeChange = store
      .listContentAssetManagementChanges(started.sessionId)
      .find((change) => change.operation === "remove");
    assert.ok(removeChange);
    assert.equal(removeChange.canRollback, true);
    assert.equal(removeChange.before.isDeleted, false);
    assert.equal(removeChange.after.isDeleted, true);

    const restored = executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rollback-source-remove-action",
        domain: "sources",
        command: {
          operation: "rollback",
          changeId: removeChange.id,
          reason: "误删了仍需参考的原文",
        },
      },
    });
    assert.equal(restored.content.sourceDocuments.length, 1);
    const reused = executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rollback-source-remove-action",
        domain: "sources",
        command: {
          operation: "rollback",
          changeId: removeChange.id,
          reason: "误删了仍需参考的原文",
        },
      },
    });
    assert.equal(reused.result.reused, true);
    assert.equal(
      store.listContentAssetManagementChanges(started.sessionId)
        .find((change) => change.id === removeChange.id)
        .revertedByActionId,
      "rollback-source-remove-action",
    );

    const memoryUpdate = executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rollback-memory-settings",
        domain: "memories",
        command: {
          operation: "update_settings",
          settings: {
            memoryTokenBudget: 3600,
            recentTurnCount: 8,
            chapterSize: 14,
          },
        },
      },
    });
    assert.equal(memoryUpdate.content.memory.settings.memoryTokenBudget, 3600);
    const memoryChange = store
      .listContentAssetManagementChanges(started.sessionId)
      .find((change) => change.actionId === "rollback-memory-settings");
    assert.ok(memoryChange);
    const memoryRestored = executeStoryContentCommand({
      store,
      sessionId: started.sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rollback-memory-settings-action",
        domain: "memories",
        command: {
          operation: "rollback",
          changeId: memoryChange.id,
          reason: "恢复修改前的上下文预算",
        },
      },
    });
    assert.equal(
      memoryRestored.content.memory.settings.memoryTokenBudget,
      originalBudget,
    );
    assert.throws(
      () =>
        executeStoryContentCommand({
          store,
          sessionId: started.sessionId,
          value: {
            schemaVersion: "1.0.0",
            actionId: "rollback-old-source-import",
            domain: "sources",
            command: {
              operation: "rollback",
              changeId: store
                .listContentAssetManagementChanges(started.sessionId)
                .find((change) => change.actionId === "rollback-source-import").id,
              reason: "尝试跳过后续修订",
            },
          },
        }),
      ContentAssetManagementError,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function relationshipCommand(sessionId, actionId, overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    actionId,
    domain: "relationships",
    command: {
      operation: "update",
      sourceCharacterId: "source-id",
      targetCharacterId: "target-id",
      dimensions: { trust: 30, affection: 40 },
      relationshipType: "friends",
      summary: "在纸城档案馆共事多年的朋友。",
      ...overrides,
    },
  };
}

test("relationships domain 解析校验：维度范围、类型枚举、描述限长与角色约束", () => {
  const parsed = parseStoryContentCommand({
    sessionId: "session-rel",
    value: relationshipCommand("session-rel", "rel-parse-ok"),
  });
  assert.equal(parsed.domain, "relationships");
  assert.equal(parsed.input.operation, "update");
  assert.equal(parsed.input.sourceCharacterId, "source-id");
  assert.equal(parsed.input.targetCharacterId, "target-id");
  assert.deepEqual(parsed.input.dimensions, { trust: 30, affection: 40 });
  assert.equal(parsed.input.relationshipType, "friends");
  assert.equal(parsed.input.summary, "在纸城档案馆共事多年的朋友。");
  assert.equal(parsed.input.syncReverse, undefined);

  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-rel",
        value: relationshipCommand("session-rel", "rel-same", {
          sourceCharacterId: "same-id",
          targetCharacterId: "same-id",
        }),
      }),
    (error) =>
      error instanceof StoryContentInputError &&
      error.issues.some((issue) => issue.includes("同一个角色")),
  );
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-rel",
        value: relationshipCommand("session-rel", "rel-dim-name", {
          dimensions: { loyalty: 10 },
        }),
      }),
    (error) =>
      error instanceof StoryContentInputError &&
      error.issues.some((issue) => issue.includes("loyalty")),
  );
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-rel",
        value: relationshipCommand("session-rel", "rel-dim-range", {
          dimensions: { trust: 101 },
        }),
      }),
    (error) =>
      error instanceof StoryContentInputError &&
      error.issues.some((issue) => issue.includes("-100")),
  );
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-rel",
        value: relationshipCommand("session-rel", "rel-dim-low", {
          dimensions: { respect: -101 },
        }),
      }),
    StoryContentInputError,
  );
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-rel",
        value: relationshipCommand("session-rel", "rel-type", {
          relationshipType: "soulmates",
        }),
      }),
    (error) =>
      error instanceof StoryContentInputError &&
      error.issues.some((issue) => issue.includes("关系类型")),
  );
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-rel",
        value: relationshipCommand("session-rel", "rel-summary-long", {
          summary: "长".repeat(501),
        }),
      }),
    (error) =>
      error instanceof StoryContentInputError &&
      error.issues.some((issue) => issue.includes("500")),
  );
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-rel",
        value: relationshipCommand("session-rel", "rel-empty", {
          dimensions: {},
          relationshipType: undefined,
          summary: undefined,
        }),
      }),
    (error) =>
      error instanceof StoryContentInputError &&
      error.issues.some((issue) => issue.includes("至少")),
  );
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-rel",
        value: relationshipCommand("session-rel", "rel-op", {
          operation: "delete",
        }),
      }),
    StoryContentInputError,
  );
  assert.throws(
    () =>
      parseStoryContentCommand({
        sessionId: "session-rel",
        value: relationshipCommand("session-rel", "rel-sync", {
          syncReverse: "yes",
        }),
      }),
    (error) =>
      error instanceof StoryContentInputError &&
      error.issues.some((issue) => issue.includes("布尔值")),
  );
});

test("关系手动修改：单向修改、同步反向、幂等、审计与回滚", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-relationship-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startContentStory(store);
    const { sessionId, playerCharacterId, mainCharacterId } = started;
    const forwardId = `${playerCharacterId}:${mainCharacterId}`;
    const reverseId = `${mainCharacterId}:${playerCharacterId}`;
    const relationshipOf = (entityId) =>
      store
        .loadAdventure(sessionId)
        .branchState.states.find(
          (state) =>
            state.entityType === "relationship" && state.entityId === entityId,
        );

    // 开局只有玩家→馆员的单向零值关系，反向记录不存在。
    assert.equal(relationshipOf(forwardId).state.trust, 0);
    assert.equal(relationshipOf(forwardId).state.relationshipType, "acquaintances");
    assert.equal(relationshipOf(reverseId), undefined);

    // 单向修改：仅正向变化，不产生反向记录。
    const single = executeStoryContentCommand({
      store,
      sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rel-single",
        domain: "relationships",
        command: {
          operation: "update",
          sourceCharacterId: playerCharacterId,
          targetCharacterId: mainCharacterId,
          dimensions: { trust: 35, affection: 60 },
          relationshipType: "friends",
          summary: "一起整理档案馆的伙伴。",
        },
      },
    });
    assert.equal(single.result.domain, "relationships");
    assert.equal(single.result.operation, "update");
    assert.equal(single.result.targetId, forwardId);
    assert.equal(single.result.reused, false);
    assert.equal(relationshipOf(forwardId).state.trust, 35);
    assert.equal(relationshipOf(forwardId).state.affinity, 60);
    assert.equal(relationshipOf(forwardId).state.relationshipType, "friends");
    assert.equal(relationshipOf(forwardId).state.summary, "一起整理档案馆的伙伴。");
    assert.equal(relationshipOf(reverseId), undefined);

    // 幂等：同一 actionId 重复执行不产生新变更。
    const retried = executeStoryContentCommand({
      store,
      sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rel-single",
        domain: "relationships",
        command: {
          operation: "update",
          sourceCharacterId: playerCharacterId,
          targetCharacterId: mainCharacterId,
          dimensions: { trust: 35, affection: 60 },
          relationshipType: "friends",
          summary: "一起整理档案馆的伙伴。",
        },
      },
    });
    assert.equal(retried.result.reused, true);
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM state_control_changes WHERE session_id = ? AND action_id = ?",
        )
        .get(sessionId, "rel-single").total,
      1,
    );

    // 不存在的关系记录被拒绝（主→玩家方向尚无记录时）。
    assert.throws(
      () =>
        executeStoryContentCommand({
          store,
          sessionId,
          value: {
            schemaVersion: "1.0.0",
            actionId: "rel-missing-pair",
            domain: "relationships",
            command: {
              operation: "update",
              sourceCharacterId: mainCharacterId,
              targetCharacterId: playerCharacterId,
              dimensions: { trust: 10 },
            },
          },
        }),
      (error) =>
        error instanceof StoryNotFoundError &&
        error.message.includes("没有找到要修改的关系记录"),
    );

    // 同步反向：反向记录不存在时 replace 补建完整记录。
    const synced = executeStoryContentCommand({
      store,
      sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rel-sync",
        domain: "relationships",
        command: {
          operation: "update",
          sourceCharacterId: playerCharacterId,
          targetCharacterId: mainCharacterId,
          dimensions: { hostility: 15 },
          syncReverse: true,
        },
      },
    });
    assert.equal(synced.result.reused, false);
    const reverse = relationshipOf(reverseId);
    assert.equal(reverse.state.sourceCharacterId, mainCharacterId);
    assert.equal(reverse.state.targetCharacterId, playerCharacterId);
    assert.equal(reverse.state.hostility, 15);
    assert.equal(reverse.state.trust, 0);
    assert.equal(reverse.state.relationshipType, "acquaintances");

    // 同步反向：反向记录已存在时 merge 只更新提供的字段。
    executeStoryContentCommand({
      store,
      sessionId,
      value: {
        schemaVersion: "1.0.0",
        actionId: "rel-sync-merge",
        domain: "relationships",
        command: {
          operation: "update",
          sourceCharacterId: playerCharacterId,
          targetCharacterId: mainCharacterId,
          dimensions: { fear: 25 },
          syncReverse: true,
        },
      },
    });
    assert.equal(relationshipOf(reverseId).state.fear, 25);
    assert.equal(relationshipOf(reverseId).state.hostility, 15);
    assert.equal(relationshipOf(reverseId).state.trust, 0);

    // 审计：修改进入状态审计，来源为 relationship_management，标题含“关系已手动修改”。
    const workspace = loadStoryContentWorkspace({ store, sessionId });
    const singleAction = workspace.audit.state.actions.find(
      (action) => action.id === "relationship_management:rel-single",
    );
    assert.ok(singleAction);
    assert.equal(singleAction.title.includes("关系已手动修改"), true);
    assert.equal(
      singleAction.changes.some(
        (change) =>
          change.entityType === "relationship" &&
          change.entityId === forwardId &&
          change.operation === "merge",
      ),
      true,
    );
    const syncAction = workspace.audit.state.actions.find(
      (action) => action.id === "relationship_management:rel-sync",
    );
    assert.ok(syncAction);
    const reverseReplaceChange = syncAction.changes.find(
      (change) => change.entityId === reverseId,
    );
    assert.equal(reverseReplaceChange.operation, "replace");
    assert.equal(reverseReplaceChange.before, null);
    assert.equal(reverseReplaceChange.canRollback, true);

    // 回滚：撤销单向修改后正向恢复原值，反向不受影响。
    const singleChange = singleAction.changes.find(
      (change) =>
        change.entityId === forwardId &&
        change.operation === "merge" &&
        change.before?.state?.trust === 0,
    );
    const rolledBack = store.manageStateAudit({
      actionId: "rel-rollback",
      sessionId,
      operation: "rollback",
      changeId: singleChange.id,
      reason: "玩家撤销了关系手动修改",
    });
    assert.equal(rolledBack.reused, false);
    assert.equal(relationshipOf(forwardId).state.trust, 0);
    assert.equal(relationshipOf(forwardId).state.affinity, 0);
    assert.equal(relationshipOf(forwardId).state.relationshipType, "acquaintances");
    assert.equal(relationshipOf(reverseId).state.hostility, 15);

    // 角色约束：起点角色不存在、起止相同、停用角色均被拒绝。
    assert.throws(
      () =>
        executeStoryContentCommand({
          store,
          sessionId,
          value: {
            schemaVersion: "1.0.0",
            actionId: "rel-missing-source",
            domain: "relationships",
            command: {
              operation: "update",
              sourceCharacterId: "ghost-character",
              targetCharacterId: mainCharacterId,
              dimensions: { trust: 10 },
            },
          },
        }),
      (error) =>
        error instanceof StoryNotFoundError &&
        error.message.includes("起点角色"),
    );
    assert.throws(
      () =>
        store.manageRelationship({
          actionId: "rel-self",
          sessionId,
          operation: "update",
          sourceCharacterId: playerCharacterId,
          targetCharacterId: playerCharacterId,
          dimensions: { trust: 10 },
        }),
      RelationshipManagementError,
    );

    store.manageCharacter({
      actionId: "rel-deactivate-main",
      sessionId,
      operation: "set_active",
      characterId: mainCharacterId,
      active: false,
    });
    assert.throws(
      () =>
        executeStoryContentCommand({
          store,
          sessionId,
          value: {
            schemaVersion: "1.0.0",
            actionId: "rel-inactive-character",
            domain: "relationships",
            command: {
              operation: "update",
              sourceCharacterId: playerCharacterId,
              targetCharacterId: mainCharacterId,
              dimensions: { trust: 5 },
            },
          },
        }),
      (error) =>
        error instanceof RelationshipManagementError &&
        error.message.includes("停用"),
    );

    // 完整存档往返：关系数据与“关系已手动修改”审计随存档导出并导入。
    const archive = exportCompleteAdventure(database, sessionId);
    const imported = importCompleteAdventure(database, archive);
    const importedStore = new LocalStoryStore(database);
    const importedForward = importedStore
      .loadAdventure(imported.sessionId)
      .branchState.states.find(
        (state) =>
          state.entityType === "relationship" && state.entityId === forwardId,
      );
    assert.equal(importedForward.state.trust, 0);
    const importedReverse = importedStore
      .loadAdventure(imported.sessionId)
      .branchState.states.find(
        (state) =>
          state.entityType === "relationship" && state.entityId === reverseId,
      );
    assert.equal(importedReverse.state.hostility, 15);
    assert.equal(importedReverse.state.fear, 25);
    const importedAudit = importedStore.loadStateAudit(imported.sessionId);
    assert.equal(
      importedAudit.actions.some(
        (action) =>
          action.source === "relationship_management" &&
          action.title.includes("关系已手动修改"),
      ),
      true,
    );
    assert.equal(
      importedAudit.actions
        .filter((action) => action.source === "relationship_management")
        .some((action) => action.changes.length === 2),
      true,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
