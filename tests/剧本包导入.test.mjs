import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  parseAdventureBundleDocument,
} from "../lib/import/剧本包.ts";
import { ImportFileError } from "../lib/import/酒馆文件.ts";
import { openLocalDatabase } from "../db/index.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

async function readJson(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), "utf8"));
}

test("parses a complete adventure bundle including the player card", async () => {
  const document = await readJson(
    "../public/文件标准/剧本包标准示例.json",
  );
  const parsed = parseAdventureBundleDocument(document);

  assert.equal(parsed.kind, "adventure_bundle");
  assert.equal(parsed.adventure.player.name, "记录员");
  assert.equal(
    parsed.adventure.player.card.data.system_prompt,
    "不得替玩家决定记录员的言行。",
  );
  assert.equal(parsed.adventure.mainCharacter.name, "林雾");
  assert.equal(parsed.adventure.additionalCharacters.length, 1);
  assert.equal(
    parsed.adventure.additionalCharacters[0].initiallyPresent,
    false,
  );
  assert.equal(parsed.adventure.openingLocationName, "边境档案馆");
  assert.equal(parsed.worldBook.entries.length, 1);
  assert.equal(parsed.adventure.sourceDocuments.length, 1);
  assert.equal(parsed.adventure.storyModules.length, 3);
  assert.equal(parsed.adventure.initialStoryModuleId, "verify-missing-record");
  assert.equal(parsed.adventure.initialStatuses.length, 2);
  const linwuStatuses = parsed.adventure.initialStatuses.find(
    (entry) => entry.characterName === "林雾",
  ).statuses;
  assert.equal(linwuStatuses.length, 2);
  assert.equal(linwuStatuses[0].id, "linwu-old-wound");
  assert.equal(linwuStatuses[0].kind, "debuff");
  assert.equal(linwuStatuses[0].expiresAtDay, 5);
  assert.equal(linwuStatuses[1].hidden, true);

  const duplicate = structuredClone(document);
  duplicate.adventure.mainCharacter.card.data.name = "记录员";
  assert.throws(
    () => parseAdventureBundleDocument(duplicate),
    (error) =>
      error instanceof ImportFileError &&
      error.issues.some((issue) => /角色姓名不能重复/.test(issue)),
  );

  const missingPlayerCard = structuredClone(document);
  delete missingPlayerCard.adventure.player.card;
  assert.throws(
    () => parseAdventureBundleDocument(missingPlayerCard),
    (error) =>
      error instanceof ImportFileError &&
      error.issues.some((issue) => /玩家角色缺少 card/.test(issue)),
  );
});

test("rejects initial statuses referencing unknown characters", async () => {
  const document = await readJson(
    "../public/文件标准/剧本包标准示例.json",
  );
  const unknownCharacter = structuredClone(document);
  unknownCharacter.adventure.initialStatuses.push({
    characterName: "不存在的人",
    statuses: [
      {
        id: "ghost-status",
        name: "幽灵状态",
        kind: "debuff",
        description: "引用了一个不在剧本中的角色。",
      },
    ],
  });
  assert.throws(
    () => parseAdventureBundleDocument(unknownCharacter),
    (error) =>
      error instanceof ImportFileError &&
      error.issues.some((issue) => /不在剧本角色中/.test(issue)),
  );
});

test("surfaces a warning but still imports bundle statuses carrying sourceTurnId", async () => {
  const document = await readJson(
    "../public/文件标准/剧本包标准示例.json",
  );
  const withSourceTurn = structuredClone(document);
  withSourceTurn.adventure.initialStatuses[0].statuses[0].sourceTurnId =
    "turn-9";
  const parsed = parseAdventureBundleDocument(withSourceTurn);
  assert.ok(
    parsed.warnings.some((warning) =>
      /词条“旧伤”的 sourceTurnId 会被忽略/.test(warning),
    ),
    "应当产生 sourceTurnId 被忽略的警告",
  );
  assert.equal(
    parsed.adventure.initialStatuses[0].statuses[0].sourceTurnId,
    undefined,
  );

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-bundle-statuses-warning-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure(parsed.adventure);
    const states = store.loadAdventure(started.sessionId).branchState.states;
    const mainState = states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(mainState.state.statuses[0].id, "linwu-old-wound");
    assert.equal(mainState.state.statuses[0].sourceTurnId, undefined);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("materializes bundle initial statuses into character states", async () => {
  const document = await readJson(
    "../public/文件标准/剧本包标准示例.json",
  );
  const parsed = parseAdventureBundleDocument(document);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-bundle-statuses-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });

  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure(parsed.adventure);
    const states = store.loadAdventure(started.sessionId).branchState.states;
    const playerState = states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.playerCharacterId,
    );
    assert.deepEqual(playerState.state.statuses, [
      {
        id: "record-lantern-glow",
        name: "提灯余辉",
        kind: "buff",
        description: "档案馆守夜提灯的光辉护持，短时内视物清晰、精神集中。",
        expiresAtDay: 2,
      },
    ]);
    const mainState = states.find(
      (state) =>
        state.entityType === "character_state" &&
        state.entityId === started.mainCharacterId,
    );
    assert.equal(mainState.state.statuses.length, 2);
    assert.equal(mainState.state.statuses[1].hidden, true);
    assert.equal(mainState.state.statuses[1].id, "linwu-lamp-dust");
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
