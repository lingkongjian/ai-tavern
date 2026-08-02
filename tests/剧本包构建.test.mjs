import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assembleBundleProject,
  BundleProjectError,
  writeBundleProject,
} from "../lib/import/剧本包项目.ts";
import { parseAdventureBundleDocument } from "../lib/import/剧本包.ts";

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createProject(directory) {
  const example = JSON.parse(
    await readFile(
      new URL("../public/文件标准/剧本包标准示例.json", import.meta.url),
      "utf8",
    ),
  );
  await mkdir(join(directory, "人物卡"), { recursive: true });
  await writeJson(join(directory, "人物卡", "玩家.json"), example.adventure.player.card);
  await writeJson(
    join(directory, "人物卡", "主要角色.json"),
    example.adventure.mainCharacter.card,
  );
  await writeJson(
    join(directory, "人物卡", "其他角色.json"),
    example.adventure.additionalCharacters[0].card,
  );
  await writeJson(join(directory, "世界书.json"), example.adventure.worldBook);
  await writeFile(
    join(directory, "原文参考.md"),
    example.adventure.referenceDocuments[0].content,
    "utf8",
  );

  const manifest = {
    spec: "ai_tavern_bundle_project_v1",
    spec_version: "1.0",
    name: "纸城测试项目",
    bundle: {
      name: example.name,
      description: example.description,
      creator: "自动化测试",
      version: "1.0",
      outputFile: "完整剧本包.json",
      reportFile: "校验报告.json",
    },
    campaign: {
      campaignName: example.adventure.campaignName,
      campaignDescription: example.adventure.campaignDescription,
      world: example.adventure.world,
      player: {
        name: example.adventure.player.card.data.name,
        description: example.adventure.player.description,
      },
      mainCharacter: {
        name: example.adventure.mainCharacter.card.data.name,
      },
      openingLocationName: example.adventure.opening.locationName,
      openingScene: example.adventure.opening.scene,
      initialStoryDirection: example.adventure.opening.initialStoryDirection,
      storyModules: example.adventure.storyModules,
      initialStoryModuleId: example.adventure.opening.initialStoryModuleId,
    },
    materials: {
      playerCard: "人物卡/玩家.json",
      mainCharacter: { file: "人物卡/主要角色.json" },
      additionalCharacters: [
        {
          file: "人物卡/其他角色.json",
          presentAtOpening: false,
          firstMessage: "",
        },
      ],
      worldBook: "世界书.json",
      referenceDocuments: [
        {
          file: "原文参考.md",
          name: "测试原文",
          enabled: true,
          currentChapter: 1,
          preventFuture: true,
          fidelity: "balanced",
        },
      ],
    },
  };
  await writeJson(join(directory, "开局预设.json"), manifest);
  return manifest;
}

test("从拆分资料原子生成可独立导入的剧本包与校验报告", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-tavern-bundle-project-"));
  try {
    await createProject(directory);
    const project = await assembleBundleProject(
      join(directory, "开局预设.json"),
    );
    assert.equal(project.report.status, "valid");
    assert.equal(project.report.counts.characters, 3);
    assert.equal(project.report.counts.storyModules, 3);
    assert.equal(project.report.warnings.length, 0);
    assert.match(project.report.sha256, /^[a-f0-9]{64}$/);

    await writeBundleProject(project);
    const output = JSON.parse(await readFile(project.outputPath, "utf8"));
    const report = JSON.parse(await readFile(project.reportPath, "utf8"));
    const parsed = parseAdventureBundleDocument(output);
    assert.equal(parsed.adventure.player.name, "记录员");
    assert.equal(parsed.adventure.mainCharacter.name, "林雾");
    assert.equal(parsed.adventure.sourceDocuments.length, 1);
    assert.equal(report.sha256, project.report.sha256);
    assert.equal(report.outputFile, "完整剧本包.json");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("拒绝任务循环、路径越界、资料覆盖和角色姓名漂移", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-tavern-bundle-invalid-"));
  try {
    const manifest = await createProject(directory);
    manifest.campaign.storyModules[0].prerequisiteModuleIds = [
      "decide-record-fate",
    ];
    await writeJson(join(directory, "开局预设.json"), manifest);
    await assert.rejects(
      assembleBundleProject(join(directory, "开局预设.json")),
      (error) =>
        error instanceof BundleProjectError &&
        error.issues.some((issue) => /存在循环/.test(issue)),
    );

    manifest.campaign.storyModules[0].prerequisiteModuleIds = [];
    manifest.materials.worldBook = "../项目外世界书.json";
    await writeJson(join(directory, "开局预设.json"), manifest);
    await assert.rejects(
      assembleBundleProject(join(directory, "开局预设.json")),
      (error) =>
        error instanceof BundleProjectError &&
        error.issues.some((issue) => /项目目录内/.test(issue)),
    );

    manifest.materials.worldBook = "世界书.json";
    await writeJson(join(directory, "开局预设.json"), manifest);
    await assert.rejects(
      assembleBundleProject(join(directory, "开局预设.json"), {
        outputPath: join(directory, "人物卡", "玩家.json"),
      }),
      (error) =>
        error instanceof BundleProjectError &&
        error.issues.some((issue) => /不能覆盖/.test(issue)),
    );

    manifest.campaign.player.name = "错误姓名";
    await writeJson(join(directory, "开局预设.json"), manifest);
    await assert.rejects(
      assembleBundleProject(join(directory, "开局预设.json")),
      (error) =>
        error instanceof BundleProjectError &&
        error.issues.some((issue) => /玩家人物卡姓名/.test(issue)),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
