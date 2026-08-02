import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseAdventureBundleDocument,
} from "../lib/import/剧本包.ts";
import { ImportFileError } from "../lib/import/酒馆文件.ts";

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
