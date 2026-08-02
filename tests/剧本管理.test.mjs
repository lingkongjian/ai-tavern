import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import {
  RenameAdventureInputError,
  parseRenameAdventureRequest,
} from "../lib/story/剧本管理.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

test("validates adventure rename requests", () => {
  assert.deepEqual(parseRenameAdventureRequest({ name: "  新剧本名  " }), {
    name: "新剧本名",
  });
  assert.throws(
    () => parseRenameAdventureRequest({ name: "   " }),
    (error) =>
      error instanceof RenameAdventureInputError &&
      error.message === "剧本名称不能为空。",
  );
  assert.throws(
    () => parseRenameAdventureRequest({ name: "名".repeat(81) }),
    (error) =>
      error instanceof RenameAdventureInputError &&
      /不能超过 80/.test(error.message),
  );
});

test("renames an existing adventure without changing story turns or state", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-rename-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "旧剧本名",
      world: { name: "镜湖", premise: "湖面会映出被遗忘的道路。" },
      player: { name: "旅人", description: "寻找归途的人。" },
      mainCharacter: {
        name: "摆渡人",
        role: "守护镜湖渡口的人",
        personality: "寡言，但不会欺骗已经付出代价的人。",
      },
      openingScene: "旅人抵达没有船只的渡口。",
    });
    const turnsBefore = database
      .prepare("SELECT COUNT(*) AS total FROM turns")
      .get().total;
    const statesBefore = database
      .prepare("SELECT COUNT(*) AS total FROM state_changes")
      .get().total;

    const renamed = store.renameAdventure(started.sessionId, "镜湖归途");
    assert.equal(renamed.name, "镜湖归途");
    assert.equal(renamed.sessionName, "镜湖归途 · 第一幕");
    assert.equal(renamed.changed, true);
    assert.equal(store.listAdventures()[0].campaignName, "镜湖归途");
    assert.equal(store.loadAdventure(started.sessionId).campaign.name, "镜湖归途");
    assert.equal(
      store.loadAdventure(started.sessionId).session.name,
      "镜湖归途 · 第一幕",
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM turns").get().total,
      turnsBefore,
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM state_changes").get()
        .total,
      statesBefore,
    );

    const reused = store.renameAdventure(started.sessionId, "镜湖归途");
    assert.equal(reused.changed, false);
    assert.equal(reused.updatedAt, renamed.updatedAt);

    database.exec(`
      CREATE TRIGGER reject_adventure_rename
      BEFORE UPDATE OF name ON sessions
      WHEN NEW.name = '失败名称 · 第一幕'
      BEGIN
        SELECT RAISE(ABORT, 'forced rename failure');
      END
    `);
    assert.throws(
      () => store.renameAdventure(started.sessionId, "失败名称"),
      /forced rename failure/,
    );
    assert.equal(store.loadAdventure(started.sessionId).campaign.name, "镜湖归途");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
