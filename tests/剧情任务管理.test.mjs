import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  LocalStoryStore,
  StoryModuleManagementError,
} from "../lib/storage/story-store.ts";
import {
  parseStoryModuleManagementInput,
  StoryModuleManagementInputError,
} from "../lib/story/剧情任务管理.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

test("validates story-module management requests", () => {
  assert.throws(
    () =>
      parseStoryModuleManagementInput({
        sessionId: "session-1",
        value: {
          actionId: "task-create",
          operation: "create",
          module: {
            id: "bad id",
            title: "测试任务",
            objective: "验证输入",
            completionCriteria: [],
          },
        },
      }),
    StoryModuleManagementInputError,
  );
});

test("edits, pauses and persists a branching story-module chain", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-task-editor-"));
  const databasePath = join(temporaryDirectory, "story.sqlite");
  let database = openLocalDatabase({ filePath: databasePath, migrationsDir });

  try {
    let store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "任务链编辑测试",
      world: { name: "纸城", premise: "写入档案的承诺会短暂成真。" },
      player: { name: "记录员", description: "调查失踪档案的新人。" },
      mainCharacter: {
        name: "守夜人",
        role: "档案馆守夜人",
        personality: "谨慎并重视证据。",
      },
      openingScene: "记录员与守夜人在旧档案室核对失踪记录。",
      initialStoryDirection: "找到失踪者真实存在的证据。",
      initialStoryModuleId: "verify-record",
      storyModules: [
        {
          id: "verify-record",
          title: "核验档案",
          objective: "找到失踪者真实存在的证据。",
          completionCriteria: ["取得可复核的外部证据"],
        },
        {
          id: "protect-witness",
          title: "保护证人",
          objective: "找到并保护外街证人。",
          completionCriteria: ["证人离开危险区域"],
          prerequisiteModuleIds: ["verify-record"],
        },
      ],
    });

    store.manageStoryModule({
      actionId: "update-active-task",
      sessionId: started.sessionId,
      operation: "update",
      moduleId: "verify-record",
      module: {
        id: "verify-record",
        title: "核验失踪档案",
        objective: "取得两份彼此独立、可复核的外部证据。",
        completionCriteria: ["取得两份独立证据"],
        activationConditions: [],
        prerequisiteModuleIds: [],
        continuityNotes: "仍以档案失踪案为核心。",
        autoContinue: true,
      },
    });
    let adventure = store.loadAdventure(started.sessionId);
    assert.equal(
      adventure.branchState.states.find(
        (state) => state.entityType === "story_direction" && state.isActive,
      ).state.content,
      "取得两份彼此独立、可复核的外部证据。",
    );
    assert.equal(adventure.branchState.turnHistory.length, 1);

    const createRequest = {
      actionId: "create-confront-task",
      sessionId: started.sessionId,
      operation: "create",
      module: {
        id: "confront-curator",
        title: "质问馆长",
        objective: "带着证人和证据质问档案馆长。",
        completionCriteria: ["馆长公开回应证据"],
        activationConditions: ["证人愿意作证"],
        prerequisiteModuleIds: ["protect-witness"],
        continuityNotes: "延续同一失踪案。",
        autoContinue: true,
      },
    };
    const created = store.manageStoryModule(createRequest);
    assert.equal(created.reused, false);
    assert.equal(store.manageStoryModule(createRequest).reused, true);
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM story_module_management_changes WHERE action_id = ?",
        )
        .get(createRequest.actionId).total,
      2,
    );

    assert.throws(
      () =>
        store.manageStoryModule({
          actionId: "create-cycle",
          sessionId: started.sessionId,
          operation: "update",
          moduleId: "protect-witness",
          module: {
            id: "protect-witness",
            title: "保护证人",
            objective: "找到并保护外街证人。",
            completionCriteria: ["证人离开危险区域"],
            prerequisiteModuleIds: ["confront-curator"],
          },
        }),
      (error) =>
        error instanceof StoryModuleManagementError && /循环/.test(error.message),
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS total FROM story_module_management_changes WHERE action_id = ?",
        )
        .get("create-cycle").total,
      0,
    );

    store.manageStoryModule({
      actionId: "pause-witness-task",
      sessionId: started.sessionId,
      operation: "set_active",
      moduleId: "protect-witness",
      active: false,
    });
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(
      adventure.branchState.states.find(
        (state) => state.state.moduleId === "protect-witness",
      ).isActive,
      false,
    );
    assert.throws(
      () =>
        store.manageStoryModule({
          actionId: "pause-current-task",
          sessionId: started.sessionId,
          operation: "set_active",
          moduleId: "verify-record",
          active: false,
        }),
      StoryModuleManagementError,
    );

    database.close();
    database = openLocalDatabase({ filePath: databasePath, migrationsDir });
    store = new LocalStoryStore(database);
    adventure = store.loadAdventure(started.sessionId);
    assert.equal(
      adventure.branchState.states.find(
        (state) => state.state.moduleId === "protect-witness",
      ).isActive,
      false,
    );
    store.manageStoryModule({
      actionId: "resume-witness-task",
      sessionId: started.sessionId,
      operation: "set_active",
      moduleId: "protect-witness",
      active: true,
    });
    assert.equal(
      store
        .loadAdventure(started.sessionId)
        .branchState.states.find(
          (state) => state.state.moduleId === "protect-witness",
        ).isActive,
      true,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
