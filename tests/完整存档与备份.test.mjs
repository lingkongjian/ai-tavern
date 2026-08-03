import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  closeDefaultDatabase,
  createDefaultDatabaseBackup,
  getDb,
  listDefaultDatabaseBackups,
  openLocalDatabase,
  restoreDefaultDatabaseBackup,
} from "../db/index.ts";
import {
  CompleteArchiveError,
  exportCompleteAdventure,
  importCompleteAdventure,
  parseCompleteArchiveDocument,
  previewCompleteArchive,
} from "../lib/import/完整存档.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function startArchiveStory(store) {
  return store.startAdventure({
    campaignName: "完整档案测试",
    campaignDescription: "验证完整运行记录可以往返迁移。",
    world: { name: "镜城", premise: "镜城会记录每一种未被选择的可能。" },
    player: { name: "旅人", description: "能够辨认镜中岔路的人。" },
    mainCharacter: {
      name: "守镜人",
      role: "镜城档案馆的看守",
      personality: "谨慎、诚实，但不主动说明代价。",
      firstMessage: "每一面镜子都会留下你的另一个回答。",
    },
    additionalCharacters: [
      {
        name: "抄写员",
        role: "记录分支的人",
        personality: "中立而细致。",
        initiallyPresent: false,
      },
    ],
    worldBookEntries: [
      {
        keys: ["镜城"],
        content: "镜城的镜子不能被强行打碎。",
        enabled: true,
        constant: true,
      },
    ],
    sourceDocuments: [
      {
        name: "镜城原文",
        fileName: "镜城.md",
        content: "# 第一章\n旅人进入镜城。\n\n# 第二章\n守镜人打开档案馆。",
        enabled: true,
        currentChapter: 1,
        preventFuture: true,
        fidelity: "balanced",
      },
    ],
    openingLocationName: "镜门",
    openingScene: "旅人与守镜人站在镜城入口。",
    initialStoryDirection: "找到不会伤害守镜人的通路。",
  });
}

test("完整存档可在同一数据库中导入为隔离副本", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-archive-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startArchiveStory(store);
    const rootTurn = store.commitTurn({
      sessionId: started.sessionId,
      branchId: started.branchId,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "archive-root-2",
      playerInput: { roleplay: { mode: "action", content: "触碰北侧镜面" } },
      generatedOutput: { schemaVersion: "1.0.0", scene: "北侧镜面浮现道路。" },
      summaryPatch: "旅人发现北侧镜路。",
      events: [
        { id: "archive-event-root", eventType: "mirror_opened", summary: "镜路开启" },
      ],
      stateMutations: [
        {
          entityType: "world_book_entry",
          entityId: "mirror-road",
          operation: "replace",
          value: { content: "北侧镜路已经开启。", enabled: true },
          reason: "镜路已经在剧情中开启",
          evidence: ["archive-event-root"],
        },
      ],
    });
    store.createSavePoint(started.sessionId, "进入镜路之前");
    const fork = store.createBranch({
      sessionId: started.sessionId,
      name: "拒绝触碰镜子",
      sourceTurnId: started.openingTurnId,
    });
    store.manageCharacter({
      actionId: "archive-character-presence",
      sessionId: started.sessionId,
      operation: "set_presence",
      characterId: started.additionalCharacterIds[0],
      present: true,
    });
    store.manageStoryModule({
      actionId: "archive-story-task",
      sessionId: started.sessionId,
      operation: "create",
      module: {
        id: "trace-mirror-road",
        title: "追查镜路",
        objective: "查明北侧镜路通向何处。",
        completionCriteria: ["确认镜路的出口"],
        prerequisiteModuleIds: [],
      },
    });
    const importedWorldEntry = store
      .loadAdventure(started.sessionId)
      .branchState.states.find(
        (state) =>
          state.entityType === "world_book_entry" &&
          state.state.layer === "base_import",
      );
    store.manageWorldBook({
      actionId: "archive-world-book-update",
      sessionId: started.sessionId,
      operation: "update",
      entryId: importedWorldEntry.entityId,
      entry: {
        comment: "镜城镜面规则",
        keys: ["镜城", "镜子"],
        content: "镜城的镜子不能被强行打碎，但会回应被承认的选择。",
        enabled: true,
        constant: true,
      },
    });
    store.manageStateAudit({
      actionId: "archive-lock-scribe-mood",
      sessionId: started.sessionId,
      operation: "set_lock",
      entityType: "character_state",
      entityId: started.additionalCharacterIds[0],
      fieldPath: "/mood",
      locked: true,
      reason: "验证锁定记录可随完整存档迁移",
    });
    const forkTurn = store.commitTurn({
      sessionId: started.sessionId,
      branchId: fork.branchId,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "archive-fork-2",
      playerInput: { customChoice: "拒绝触碰镜子" },
      generatedOutput: { schemaVersion: "1.0.0", scene: "抄写员从暗门出现。" },
      summaryPatch: "旅人拒绝镜路，抄写员现身。",
      messages: [
        { role: "narrator", content: "抄写员从暗门出现。", metadata: { model: "deepseek-test" } },
      ],
      events: [
        { id: "archive-event-fork", eventType: "scribe_arrived", summary: "抄写员出现" },
      ],
      stateMutations: [
        {
          entityType: "character_state",
          entityId: started.additionalCharacterIds[0],
          operation: "merge",
          value: { mood: "好奇" },
          reason: "抄写员注意到玩家的拒绝",
          evidence: ["archive-event-fork"],
        },
      ],
    });
    store.replaceHeadTurn({
      actionId: "archive-regeneration",
      feedback: "让抄写员更谨慎",
      expectedRegenerationCount: 0,
      turnId: forkTurn.id,
      sessionId: started.sessionId,
      branchId: fork.branchId,
      expectedParentTurnId: started.openingTurnId,
      generatedOutput: { schemaVersion: "1.0.0", scene: "抄写员谨慎地从暗门探身。" },
      summaryPatch: "旅人拒绝镜路，谨慎的抄写员现身。",
      messages: [
        { role: "narrator", content: "抄写员谨慎地从暗门探身。", metadata: { model: "deepseek-test" } },
      ],
      events: [
        { id: "archive-event-fork-rewritten", eventType: "scribe_arrived", summary: "抄写员谨慎出现" },
      ],
      stateMutations: [
        {
          entityType: "character_state",
          entityId: started.additionalCharacterIds[0],
          operation: "merge",
          value: { mood: "警惕" },
          reason: "按反馈调整抄写员反应",
          evidence: ["archive-event-fork-rewritten"],
        },
      ],
    });
    const presenceChange = store
      .loadStateAudit(started.sessionId)
      .actions.find((action) => action.source === "character_management")
      ?.changes.find(
        (change) =>
          change.entityType === "character_state" &&
          change.entityId === started.additionalCharacterIds[0],
      );
    assert.ok(presenceChange);
    store.manageStateAudit({
      actionId: "archive-rollback-presence",
      sessionId: started.sessionId,
      operation: "rollback",
      changeId: presenceChange.id,
      reason: "验证补偿式回滚可随完整存档迁移",
    });
    const sourceDocument = store.listSourceDocuments(started.sessionId)[0];
    store.manageContentAsset({
      actionId: "archive-source-settings",
      sessionId: started.sessionId,
      domain: "sources",
      operation: "update",
      documentId: sourceDocument.id,
      settings: { fidelity: "faithful" },
    });
    const sourceSettingsChange = store
      .listContentAssetManagementChanges(started.sessionId)
      .find((change) => change.actionId === "archive-source-settings");
    assert.ok(sourceSettingsChange);
    store.manageContentAsset({
      actionId: "archive-source-settings-rollback",
      sessionId: started.sessionId,
      domain: "sources",
      operation: "rollback",
      changeId: sourceSettingsChange.id,
      reason: "验证资料恢复链可随完整存档迁移",
    });
    // 主线身份转移后导出，验证 is_main 随完整存档往返
    store.setMainBranch(started.sessionId, fork.branchId);
    assert.equal(
      store
        .listBranches(started.sessionId)
        .find((branch) => branch.isMain).id,
      fork.branchId,
    );

    const archive = exportCompleteAdventure(database, started.sessionId);
    assert.equal(archive.schemaVersion, "1.9.0");
    assert.equal(
      archive.data.branches.filter((row) => row.is_main === 1).length,
      1,
    );
    assert.equal(Array.isArray(archive.data.turn_context_snapshots), true);
    assert.equal(archive.data.memory_entries.length > 0, true);
    assert.equal(archive.data.story_module_management_changes.length > 0, true);
    assert.equal(archive.data.world_book_management_changes.length > 0, true);
    assert.equal(archive.data.content_asset_management_changes.length > 0, true);
    assert.equal(
      archive.data.content_asset_management_changes.every(
        (row) => row.revision > 0 && typeof row.before_json === "string",
      ),
      true,
    );
    assert.equal(archive.data.state_control_changes.length > 0, true);
    assert.equal(archive.data.state_field_lock_changes.length > 0, true);
    assert.equal(archive.data.state_lock_blocks.length > 0, true);
    assert.equal(archive.summary.branchCount, 2);
    assert.equal(archive.summary.turnCount, 3);
    assert.equal(archive.summary.characterCount, 3);
    assert.equal(archive.summary.manualSaveCount, 1);
    assert.equal(archive.summary.regenerationCount, 1);
    assert.equal(previewCompleteArchive(archive).verified, true);
    assert.equal(parseCompleteArchiveDocument(archive).archiveId, archive.archiveId);

    const tampered = structuredClone(archive);
    tampered.data.turns[0].summary_patch = "被篡改";
    assert.throws(() => parseCompleteArchiveDocument(tampered), CompleteArchiveError);

    const imported = importCompleteAdventure(database, archive);
    assert.notEqual(imported.sessionId, started.sessionId);
    assert.equal(store.listAdventures().length, 2);
    const importedAdventure = store.loadAdventure(imported.sessionId);
    assert.equal(importedAdventure.campaign.name, "完整档案测试（导入）");
    assert.equal(importedAdventure.branchState.branch.name, "拒绝触碰镜子");
    assert.equal(importedAdventure.branchState.turnHistory.length, 2);
    assert.equal(store.listBranches(imported.sessionId).length, 2);
    assert.equal(
      store.listBranches(imported.sessionId).filter((branch) => branch.isMain).length,
      1,
    );
    assert.equal(
      store.listBranches(imported.sessionId).find((branch) => branch.isMain).name,
      "拒绝触碰镜子",
    );
    assert.equal(store.listRecoveryPoints(imported.sessionId).some((point) => point.type === "manual"), true);
    assert.equal(store.listSourceDocuments(imported.sessionId).length, 1);
    assert.equal(
      importedAdventure.branchState.states.some(
        (state) => state.state.moduleId === "trace-mirror-road",
      ),
      true,
    );
    assert.equal(
      importedAdventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === started.additionalCharacterIds[0],
      )?.state.mood,
      "待定",
    );
    assert.equal(store.loadStateAudit(imported.sessionId).locks.length, 1);
    assert.equal(store.loadStateAudit(imported.sessionId).actions[0].source, "rollback");
    const importedContentChanges = store.listContentAssetManagementChanges(
      imported.sessionId,
    );
    const importedSourceSettings = importedContentChanges.find(
      (change) => change.operation === "update",
    );
    const importedSourceRollback = importedContentChanges.find(
      (change) => change.operation === "rollback",
    );
    assert.ok(importedSourceSettings?.revertedByActionId);
    assert.equal(
      importedSourceSettings.revertedByActionId,
      importedSourceRollback?.actionId,
    );

    const secondArchive = exportCompleteAdventure(database, imported.sessionId);
    assert.equal(secondArchive.summary.branchCount, archive.summary.branchCount);
    assert.equal(secondArchive.summary.turnCount, archive.summary.turnCount);
    assert.equal(secondArchive.summary.regenerationCount, 1);
    assert.notEqual(
      secondArchive.data.turns.find((row) => row.sequence === 2)?.id,
      rootTurn.id,
    );

    const previousArchive = structuredClone(archive);
    previousArchive.schemaVersion = "1.8.0";
    delete previousArchive.data.plot_thread_management_changes;
    delete previousArchive.data.plot_trigger_management_changes;
    for (const row of previousArchive.data.source_documents) {
      delete row.is_deleted;
    }
    for (const row of previousArchive.data.branches) {
      delete row.is_main;
    }
    for (const row of previousArchive.data.content_asset_management_changes) {
      delete row.revision;
      delete row.before_json;
      delete row.after_json;
      delete row.reverted_by_action_id;
    }
    previousArchive.integrity.checksum = createHash("sha256")
      .update(canonicalJson(previousArchive.data))
      .digest("hex");
    assert.equal(parseCompleteArchiveDocument(previousArchive).schemaVersion, "1.8.0");
    const previousImported = importCompleteAdventure(database, previousArchive);
    assert.equal(store.listSourceDocuments(previousImported.sessionId).length, 1);
    // 1.8.0 及更早存档没有 is_main：导入时按 parent_branch_id 派生（根分支为主线）
    assert.equal(
      store.listBranches(previousImported.sessionId).filter((branch) => branch.isMain).length,
      1,
    );
    assert.equal(
      store.listBranches(previousImported.sessionId).find((branch) => branch.isMain)
        .parentBranchId,
      null,
    );
    assert.equal(
      store.listContentAssetManagementChanges(previousImported.sessionId)[0]
        .canRollback,
      false,
    );

    const olderArchive = structuredClone(previousArchive);
    olderArchive.schemaVersion = "1.7.0";
    delete olderArchive.data.content_asset_management_changes;
    olderArchive.integrity.checksum = createHash("sha256")
      .update(canonicalJson(olderArchive.data))
      .digest("hex");
    assert.equal(parseCompleteArchiveDocument(olderArchive).schemaVersion, "1.7.0");

    const earlierArchive = structuredClone(olderArchive);
    earlierArchive.schemaVersion = "1.6.0";
    delete earlierArchive.data.world_book_management_changes;
    earlierArchive.integrity.checksum = createHash("sha256")
      .update(canonicalJson(earlierArchive.data))
      .digest("hex");
    assert.equal(parseCompleteArchiveDocument(earlierArchive).schemaVersion, "1.6.0");

    const ancientArchive = structuredClone(earlierArchive);
    ancientArchive.schemaVersion = "1.5.0";
    delete ancientArchive.data.turn_context_snapshots;
    ancientArchive.integrity.checksum = createHash("sha256")
      .update(canonicalJson(ancientArchive.data))
      .digest("hex");
    assert.equal(parseCompleteArchiveDocument(ancientArchive).schemaVersion, "1.5.0");

    const historicArchive = structuredClone(ancientArchive);
    historicArchive.schemaVersion = "1.4.0";
    delete historicArchive.data.state_control_changes;
    delete historicArchive.data.state_field_lock_changes;
    delete historicArchive.data.state_lock_blocks;
    historicArchive.integrity.checksum = createHash("sha256")
      .update(canonicalJson(historicArchive.data))
      .digest("hex");
    assert.equal(parseCompleteArchiveDocument(historicArchive).schemaVersion, "1.4.0");

    const foundationalArchive = structuredClone(historicArchive);
    foundationalArchive.schemaVersion = "1.3.0";
    delete foundationalArchive.data.story_module_management_changes;
    foundationalArchive.integrity.checksum = createHash("sha256")
      .update(canonicalJson(foundationalArchive.data))
      .digest("hex");
    assert.equal(
      parseCompleteArchiveDocument(foundationalArchive).schemaVersion,
      "1.3.0",
    );

    const legacyArchive = structuredClone(archive);
    legacyArchive.schemaVersion = "1.0.0";
    delete legacyArchive.data.plot_thread_management_changes;
    delete legacyArchive.data.plot_trigger_management_changes;
    delete legacyArchive.data.turn_context_snapshots;
    delete legacyArchive.data.state_control_changes;
    delete legacyArchive.data.state_field_lock_changes;
    delete legacyArchive.data.state_lock_blocks;
    delete legacyArchive.data.story_module_management_changes;
    delete legacyArchive.data.world_book_management_changes;
    delete legacyArchive.data.content_asset_management_changes;
    delete legacyArchive.data.memory_settings;
    delete legacyArchive.data.memory_entries;
    delete legacyArchive.data.memory_chapters;
    delete legacyArchive.data.memory_retrievals;
    for (const row of legacyArchive.data.branches) {
      delete row.is_main;
    }
    legacyArchive.integrity.checksum = createHash("sha256")
      .update(canonicalJson(legacyArchive.data))
      .digest("hex");
    assert.equal(parseCompleteArchiveDocument(legacyArchive).schemaVersion, "1.0.0");
    const legacyImported = importCompleteAdventure(database, legacyArchive);
    assert.equal(store.loadStoryMemory(legacyImported.sessionId).chapters.length > 0, true);
    assert.equal(
      store.listBranches(legacyImported.sessionId).filter((branch) => branch.isMain).length,
      1,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("整库备份可恢复并在恢复前自动留下安全副本", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-backup-"));
  const previousDataDirectory = process.env.AI_TAVERN_DATA_DIR;
  const previousRetention = process.env.AI_TAVERN_BACKUP_RETENTION;
  process.env.AI_TAVERN_DATA_DIR = temporaryDirectory;
  try {
    const database = getDb();
    const store = new LocalStoryStore(database);
    const first = startArchiveStory(store);
    const backup = createDefaultDatabaseBackup("manual");
    store.renameAdventure(first.sessionId, "备份之后的新名称");
    assert.equal(store.loadAdventure(first.sessionId).campaign.name, "备份之后的新名称");

    const restored = restoreDefaultDatabaseBackup(backup.fileName);
    assert.equal(restored.restoredFileName, backup.fileName);
    const restoredStore = new LocalStoryStore(getDb());
    assert.equal(restoredStore.loadAdventure(first.sessionId).campaign.name, "完整档案测试");
    const backups = listDefaultDatabaseBackups();
    assert.equal(backups.some((item) => item.reason === "pre-restore"), true);
    assert.equal(backups.some((item) => item.reason === "manual"), true);
    process.env.AI_TAVERN_BACKUP_RETENTION = "3";
    for (let index = 0; index < 4; index += 1) {
      createDefaultDatabaseBackup("manual");
    }
    assert.equal(listDefaultDatabaseBackups().length, 3);
  } finally {
    closeDefaultDatabase();
    if (previousDataDirectory === undefined) {
      delete process.env.AI_TAVERN_DATA_DIR;
    } else {
      process.env.AI_TAVERN_DATA_DIR = previousDataDirectory;
    }
    if (previousRetention === undefined) {
      delete process.env.AI_TAVERN_BACKUP_RETENTION;
    } else {
      process.env.AI_TAVERN_BACKUP_RETENTION = previousRetention;
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
