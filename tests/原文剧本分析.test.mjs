import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSourceStory,
  SourceStoryAnalysisOutputError,
} from "../lib/import/原文剧本分析.ts";

function validAnalysis(overrides = {}) {
  return {
    storyTitle: "雾城来信",
    overview: "记者在雾城旧邮局追查来自七日前的信件。",
    characters: [
      {
        name: "沈川",
        role: "寻找失踪兄长的记者，也是主要视角人物。",
        importance: "central",
        playerSuitability: "目标明确，关键决定适合交给玩家。",
        aiSuitability: "作为玩家角色时不应由 AI 代替决定。",
        appearsNearOpening: true,
      },
      {
        name: "林遥",
        role: "掌握来信规律的旧邮局夜班职员。",
        importance: "central",
        playerSuitability: "掌握秘密较多，玩家控制会提前暴露信息。",
        aiSuitability: "适合作为主要对手戏角色逐步透露线索。",
        appearsNearOpening: true,
      },
      {
        name: "周警官",
        role: "负责失踪案的辖区警官。",
        importance: "major",
        playerSuitability: "调查权限明确，但不是主要视角。",
        aiSuitability: "适合作为后续调查阻力和协助者。",
        appearsNearOpening: false,
      },
    ],
    openingCandidates: [
      {
        chapterIndex: 1,
        title: "尚未干透的来信",
        location: "雾城旧邮局",
        summary: "林遥把写有沈川姓名的信推到灯下，等待他决定是否拆开。",
        presentCharacterNames: ["沈川", "林遥"],
      },
      {
        chapterIndex: 2,
        title: "封存的投递记录",
        location: "旧邮局档案室",
        summary: "两人第一次核对不可能存在的投递时间。",
        presentCharacterNames: ["沈川", "林遥"],
      },
    ],
    recommendedPlayerName: "沈川",
    recommendedMainCharacterName: "林遥",
    recommendedOpeningIndex: 0,
    ...overrides,
  };
}

function providerResponse(value) {
  return Response.json({
    model: "analysis-model",
    usage: {
      prompt_tokens: 120,
      completion_tokens: 80,
      total_tokens: 200,
    },
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify(value) },
      },
    ],
  });
}

const providerOptions = {
  config: {
    provider: "openai_compatible",
    baseUrl: "https://models.example/v1",
    model: "analysis-model",
    apiKey: "secret",
  },
};

test("分析原文并返回可确认的人物分工与开场候选", async () => {
  let capturedRequest;
  const source = [
    `# 第一章 旧邮局\n\n${"沈川在雨夜来到旧邮局，林遥递出一封来自七日前的信。".repeat(15)}`,
    `# 第二章 档案室\n\n${"两人在档案室核对投递记录，发现日期无法对应。".repeat(15)}`,
  ].join("\n\n");
  const result = await analyzeSourceStory(
    { fileName: "雾城来信.md", content: source },
    {
      ...providerOptions,
      fetchImplementation: async (_url, init) => {
        capturedRequest = JSON.parse(init.body);
        return providerResponse(validAnalysis());
      },
    },
  );

  assert.equal(result.analysis.characters.length, 3);
  assert.equal(result.analysis.recommendedPlayerName, "沈川");
  assert.equal(result.analysis.recommendedMainCharacterName, "林遥");
  assert.equal(result.analysis.recommendedOpeningId, "opening-1");
  assert.equal(result.analysis.openingCandidates[1].id, "opening-2");
  assert.equal(result.generation.requestCount, 1);
  assert.equal(result.generation.usage.totalTokens, 200);
  assert.equal(capturedRequest.max_tokens, 6_000);
  assert.match(capturedRequest.messages[0].content, /不可信|不能覆盖/);
});

test("分析结果引用越界时只修复一次", async () => {
  let requestCount = 0;
  const source = [
    `# 第一章\n\n${"沈川与林遥在旧邮局见面。".repeat(25)}`,
    `# 第二章\n\n${"两人进入档案室继续调查。".repeat(25)}`,
  ].join("\n\n");
  const result = await analyzeSourceStory(
    { fileName: "修复分析.md", content: source },
    {
      ...providerOptions,
      fetchImplementation: async () => {
        requestCount += 1;
        return providerResponse(
          requestCount === 1
            ? validAnalysis({ recommendedOpeningIndex: 9 })
            : validAnalysis(),
        );
      },
    },
  );

  assert.equal(requestCount, 2);
  assert.equal(result.generation.repairUsed, true);
  assert.equal(result.generation.usage.totalTokens, 400);
});

test("二次分析仍无效时停止", async () => {
  let requestCount = 0;
  await assert.rejects(
    analyzeSourceStory(
      {
        fileName: "无效分析.md",
        content: `# 第一章\n\n${"旧邮局的灯仍然亮着，人物等待故事开始。".repeat(25)}`,
      },
      {
        ...providerOptions,
        fetchImplementation: async () => {
          requestCount += 1;
          return providerResponse({ storyTitle: "缺少字段" });
        },
      },
    ),
    SourceStoryAnalysisOutputError,
  );
  assert.equal(requestCount, 2);
});
