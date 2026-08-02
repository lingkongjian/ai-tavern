import assert from "node:assert/strict";
import test from "node:test";
import { generateAdventureBundleFromSource } from "../lib/import/原文生成剧本包.ts";
import {
  BundleSectionRegenerationInputError,
  regenerateAdventureBundleSection,
} from "../lib/import/剧本包分区重生成.ts";

function blueprint(suffix = "初版") {
  return {
    campaignName: `雾城来信${suffix}`,
    campaignDescription: `${suffix}战役说明。`,
    world: {
      name: `雾城${suffix}`,
      premise: `${suffix}世界前提。`,
    },
    player: {
      name: "沈川",
      description: `${suffix}玩家背景。`,
      personality: `${suffix}玩家性格。`,
      firstMessage: "",
      dialogueExamples: "",
    },
    mainCharacter: {
      name: "林遥",
      description: `${suffix}主要角色背景。`,
      personality: `${suffix}主要角色性格。`,
      firstMessage: `${suffix}主要角色开场台词。`,
      dialogueExamples: `${suffix}主要角色对话示例。`,
    },
    additionalCharacters: [
      {
        name: "周警官",
        description: `${suffix}其他角色背景。`,
        personality: `${suffix}其他角色性格。`,
        firstMessage: "",
        dialogueExamples: "",
        presentAtOpening: false,
      },
    ],
    worldBookEntries: [
      {
        title: `${suffix}七日前来信`,
        keys: ["旧邮局", "来信"],
        content: `${suffix}世界书内容。`,
        constant: false,
      },
    ],
    storyModules: [
      {
        title: `${suffix}核对来信`,
        objective: `${suffix}任务目标。`,
        completionCriteria: [`${suffix}可观察完成条件`],
        activationConditions: [`${suffix}激活条件`],
        continuityNotes: `${suffix}连续性说明。`,
      },
    ],
    opening: {
      sourceChapterIndex: 1,
      locationName: `${suffix}雾城旧邮局`,
      scene: `${suffix}开篇正文，林遥把信推到沈川面前，等待玩家回应。`,
      initialStoryDirection: `${suffix}初始剧情目标。`,
    },
  };
}

function providerResponse(value) {
  return Response.json({
    model: "story-model",
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify(value) },
      },
    ],
  });
}

const optionsFor = (value, capture) => ({
  config: {
    provider: "openai_compatible",
    baseUrl: "https://models.example/v1",
    model: "story-model",
    apiKey: "secret",
  },
  fetchImplementation: async (_url, init) => {
    capture?.(JSON.parse(init.body));
    return providerResponse(value);
  },
});

async function baselineBundle() {
  const source = `# 第一章 雾城旧邮局\n\n${"沈川在雨夜进入旧邮局，林遥按住来自七日前的信，等待他作出选择。".repeat(15)}`;
  return generateAdventureBundleFromSource(
    { fileName: "雾城来信.md", content: source },
    optionsFor(blueprint()),
  );
}

test("四类分区重生成只合并目标内容并保留内嵌原文", async () => {
  const baseline = await baselineBundle();
  const baselineAdventure = baseline.document.adventure;
  const cases = [
    {
      section: "characters",
      changed: (adventure) => adventure.player,
      preserved: (adventure) => adventure.worldBook,
    },
    {
      section: "world_book",
      changed: (adventure) => adventure.worldBook,
      preserved: (adventure) => adventure.player,
    },
    {
      section: "story_modules",
      changed: (adventure) => adventure.storyModules,
      preserved: (adventure) => adventure.worldBook,
    },
    {
      section: "opening",
      changed: (adventure) => adventure.opening,
      preserved: (adventure) => adventure.storyModules,
    },
  ];

  for (const item of cases) {
    let capturedRequest;
    const result = await regenerateAdventureBundleSection(
      {
        document: baseline.document,
        section: item.section,
        feedback: "内容过于泛化，请增加贴近原文的具体事实。",
      },
      optionsFor(blueprint("修订版"), (request) => {
        capturedRequest = request;
      }),
    );
    const adventure = result.document.adventure;
    assert.notDeepEqual(item.changed(adventure), item.changed(baselineAdventure));
    assert.deepEqual(item.preserved(adventure), item.preserved(baselineAdventure));
    assert.deepEqual(
      adventure.referenceDocuments,
      baselineAdventure.referenceDocuments,
    );
    assert.equal(result.section, item.section);
    assert.match(capturedRequest.messages[0].content, /局部修订/);
    assert.match(capturedRequest.messages[1].content, /revision_feedback/);
  }
});

test("重生成意见为空时在调用模型前拒绝请求", async () => {
  const baseline = await baselineBundle();
  let called = false;
  await assert.rejects(
    regenerateAdventureBundleSection(
      {
        document: baseline.document,
        section: "opening",
        feedback: "   ",
      },
      optionsFor(blueprint("不会使用"), () => {
        called = true;
      }),
    ),
    BundleSectionRegenerationInputError,
  );
  assert.equal(called, false);
});
