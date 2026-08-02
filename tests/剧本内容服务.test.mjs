import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  executeStoryContentCommand,
  loadStoryContentWorkspace,
  parseStoryContentCommand,
  StoryContentInputError,
} from "../lib/content/剧本内容服务.ts";
import {
  ContentAssetManagementError,
  LocalStoryStore,
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
