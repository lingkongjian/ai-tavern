import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepresentativeSource,
  generateAdventureBundleFromSource,
  SourceBundleGenerationInputError,
  SourceBundleGenerationOutputError,
} from "../lib/import/原文生成剧本包.ts";

function blueprint(overrides = {}) {
  return {
    campaignName: "雾城来信",
    campaignDescription: "围绕一封失踪者来信展开的原作改编冒险。",
    world: {
      name: "雾城",
      premise: "雾城的旧邮局会收到寄自七日前的信件。",
    },
    player: {
      name: "沈川",
      description: "寻找失踪兄长的年轻记者。",
      personality: "观察敏锐，具体言行与决定由玩家控制。",
      firstMessage: "",
      dialogueExamples: "",
    },
    mainCharacter: {
      name: "林遥",
      description: "雾城旧邮局的夜班职员，知道来信出现的规律。",
      personality: "克制、警惕，习惯用反问掩饰担忧。",
      firstMessage: "“这封信写的是你的名字。”",
      dialogueExamples: "沈川：你见过寄信人？\n林遥：见过，但不是在今天。",
    },
    additionalCharacters: [
      {
        name: "周警官",
        description: "负责失踪案的辖区警官。",
        personality: "务实谨慎，不轻信超自然解释。",
        firstMessage: "",
        dialogueExamples: "",
        presentAtOpening: false,
      },
    ],
    worldBookEntries: [
      {
        title: "七日前来信",
        keys: ["旧邮局", "来信"],
        content: "旧邮局偶尔会收到落款日期比现实早七天的信。",
        constant: false,
      },
    ],
    storyModules: [
      {
        title: "核对来信",
        objective: "查明第一封来信的来源。",
        completionCriteria: ["找到信件进入邮局的可验证记录"],
        activationConditions: ["玩家愿意调查来信"],
        continuityNotes: "玩家仍在追查失踪案。",
      },
      {
        title: "寻找寄信人",
        objective: "沿信件线索找到寄信人最后出现的位置。",
        completionCriteria: ["确认寄信人的最后行踪"],
        activationConditions: ["第一封来信来源已查明"],
        continuityNotes: "失踪案尚未结束。",
      },
    ],
    opening: {
      sourceChapterIndex: 1,
      locationName: "雾城旧邮局",
      scene:
        "凌晨，沈川来到即将熄灯的旧邮局。林遥隔着柜台按住一封尚未干透的信，信封上写着沈川的名字。她把信推到灯下，没有替他拆开。",
      initialStoryDirection: "确认这封信是否与沈川兄长的失踪有关。",
    },
    ...overrides,
  };
}

function providerResponse(value, model = "story-model") {
  return Response.json({
    model,
    usage: {
      prompt_tokens: 100,
      completion_tokens: 200,
      total_tokens: 300,
    },
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify(value) },
      },
    ],
  });
}

test("从原文生成标准剧本包并原样内嵌本地参考正文", async () => {
  const source = `# 第一章 雾城旧邮局\n\n${"雨点敲在邮局玻璃上，沈川看见林遥按住那封来自七日前的信。".repeat(15)}`;
  let capturedRequest;
  const generated = await generateAdventureBundleFromSource(
    { fileName: "雾城来信.md", content: source },
    {
      config: {
        provider: "openai_compatible",
        baseUrl: "https://models.example/v1",
        model: "story-model",
        apiKey: "secret",
      },
      fetchImplementation: async (_url, init) => {
        capturedRequest = JSON.parse(init.body);
        return providerResponse(blueprint());
      },
    },
  );

  assert.equal(generated.preview.adventure.player.name, "沈川");
  assert.equal(generated.preview.adventure.mainCharacter.name, "林遥");
  assert.equal(generated.preview.adventure.additionalCharacters.length, 1);
  assert.equal(generated.preview.adventure.storyModules.length, 2);
  assert.deepEqual(
    generated.preview.adventure.storyModules[1].prerequisiteModuleIds,
    [generated.preview.adventure.storyModules[0].id],
  );
  assert.equal(generated.preview.adventure.sourceDocuments[0].content, source);
  assert.equal(generated.preview.adventure.sourceDocuments[0].fidelity, "faithful");
  assert.match(
    generated.preview.adventure.player.card.data.system_prompt,
    /不得替玩家决定/,
  );
  assert.equal(generated.generation.requestCount, 1);
  assert.equal(generated.generation.usage.totalTokens, 300);
  assert.equal(capturedRequest.max_tokens, 12_000);
  assert.match(capturedRequest.messages[0].content, /untrusted|待分析文本/);
  assert.match(capturedRequest.messages[1].content, /雾城来信\.md/);
  assert.match(capturedRequest.messages[0].content, /initialRelationships/);
  assert.match(capturedRequest.messages[0].content, /locations/);
  assert.match(capturedRequest.messages[0].content, /deadlineDay/);
  assert.match(capturedRequest.messages[0].content, /双向记录/);
  assert.match(capturedRequest.messages[0].content, /不要填 0/);
});

test("蓝图中的初始状态词条生成稳定 ID、保留隐藏标记并写入生成包", async () => {
  const source = `# 第一章 雾城旧邮局\n\n${"雨点敲在邮局玻璃上，沈川看见林遥按住那封来自七日前的信。".repeat(15)}`;
  let capturedRequest;
  const generated = await generateAdventureBundleFromSource(
    { fileName: "雾城来信.md", content: source },
    {
      config: {
        provider: "openai_compatible",
        baseUrl: "https://models.example/v1",
        model: "story-model",
        apiKey: "secret",
      },
      fetchImplementation: async (_url, init) => {
        capturedRequest = JSON.parse(init.body);
        return providerResponse(
          blueprint({
            initialStatuses: [
              {
                characterName: "沈川",
                statuses: [
                  {
                    name: "旧伤",
                    kind: "debuff",
                    hidden: false,
                    description: "追查兄长时留下的左肩旧伤，雨夜隐隐作痛。",
                    expiresAtDay: 5,
                  },
                  {
                    name: "灯尘入体",
                    kind: "debuff",
                    hidden: true,
                    description: "在旧邮局滞留过久，体内积有灯尘，沈川自己尚未察觉。",
                    expiresAtDay: null,
                  },
                ],
              },
              {
                characterName: "林遥",
                statuses: [
                  {
                    name: "提灯余辉",
                    kind: "buff",
                    hidden: false,
                    description: "守夜提灯的光辉护持，短时内精神集中。",
                    expiresAtDay: 2,
                  },
                ],
              },
            ],
          }),
        );
      },
    },
  );

  const statuses = generated.preview.adventure.initialStatuses;
  assert.equal(statuses.length, 2);
  const shenchuan = statuses.find((entry) => entry.characterName === "沈川");
  assert.equal(shenchuan.statuses.length, 2);
  assert.match(shenchuan.statuses[0].id, /^沈川-旧伤$/);
  assert.equal(shenchuan.statuses[0].kind, "debuff");
  assert.equal(shenchuan.statuses[0].expiresAtDay, 5);
  assert.equal(Object.hasOwn(shenchuan.statuses[0], "hidden"), false);
  assert.equal(shenchuan.statuses[1].hidden, true);
  assert.equal(shenchuan.statuses[1].expiresAtDay, undefined);
  const linyao = statuses.find((entry) => entry.characterName === "林遥");
  assert.equal(linyao.statuses[0].id, "林遥-提灯余辉");
  assert.equal(linyao.statuses[0].kind, "buff");
  assert.match(capturedRequest.messages[0].content, /initialStatuses/);
  assert.match(capturedRequest.messages[0].content, /hidden=true/);
  assert.match(capturedRequest.messages[0].content, /不要自行输出 ID/);
});

test("蓝图初始状态引用未知角色或非法 kind 时拒绝生成", async () => {
  const source = `# 第一章 雾城旧邮局\n\n${"雨点敲在邮局玻璃上，沈川看见林遥按住那封来自七日前的信。".repeat(15)}`;
  const options = {
    config: {
      provider: "openai_compatible",
      baseUrl: "https://models.example/v1",
      model: "story-model",
      apiKey: "secret",
    },
    fetchImplementation: async () =>
      providerResponse(
        blueprint({
          initialStatuses: [
            {
              characterName: "路人甲",
              statuses: [
                {
                  name: "发烧",
                  kind: "debuff",
                  hidden: false,
                  description: "高烧不退。",
                  expiresAtDay: null,
                },
              ],
            },
          ],
        }),
      ),
  };

  await assert.rejects(
    generateAdventureBundleFromSource(
      { fileName: "非法状态.md", content: source },
      options,
    ),
    (error) =>
      error instanceof SourceBundleGenerationOutputError &&
      error.issues.some((issue) => issue.includes("引用了不存在的角色")),
  );

  await assert.rejects(
    generateAdventureBundleFromSource(
      { fileName: "非法状态.md", content: source },
      {
        config: options.config,
        fetchImplementation: async () =>
          providerResponse(
            blueprint({
              initialStatuses: [
                {
                  characterName: "沈川",
                  statuses: [
                    {
                      name: "诅咒",
                      kind: "curse",
                      hidden: false,
                      description: "类型不在白名单中。",
                      expiresAtDay: null,
                    },
                  ],
                },
              ],
            }),
          ),
      },
    ),
    (error) =>
      error instanceof SourceBundleGenerationOutputError &&
      error.issues.some((issue) => issue.includes("kind 必须是 buff、debuff 之一")),
  );
});

test("蓝图中的 deadlineDay 0 视为无期限且不报错", async () => {
  const source = `# 第一章 雾城旧邮局\n\n${"雨点敲在邮局玻璃上，沈川看见林遥按住那封来自七日前的信。".repeat(15)}`;
  const generated = await generateAdventureBundleFromSource(
    { fileName: "雾城来信.md", content: source },
    {
      config: {
        provider: "openai_compatible",
        baseUrl: "https://models.example/v1",
        model: "story-model",
        apiKey: "secret",
      },
      fetchImplementation: async () =>
        providerResponse(
          blueprint({
            storyModules: [
              {
                title: "核对来信",
                objective: "查明第一封来信的来源。",
                completionCriteria: ["找到信件进入邮局的可验证记录"],
                activationConditions: [],
                continuityNotes: "",
                deadlineDay: 0,
              },
            ],
            initialRelationships: [
              {
                sourceName: "沈川",
                targetName: "林遥",
                trust: 60,
                affection: 65,
                respect: 50,
                fear: 0,
                hostility: 0,
                summary: "旧识，重逢后相互试探。",
              },
            ],
            locations: [
              {
                name: "旧邮局",
                description: "雾城唯一的邮局，深夜仍亮着灯。",
                characters: ["林遥"],
                important: true,
              },
            ],
          }),
        ),
    },
  );
  const modules = generated.preview.adventure.storyModules;
  assert.equal(modules.length, 1);
  assert.equal(Object.hasOwn(modules[0], "deadlineDay"), false);
  assert.equal(generated.preview.adventure.initialRelationships.length, 1);
  assert.equal(generated.preview.adventure.locations.length, 1);
  assert.equal(generated.preview.adventure.locations[0].name, "旧邮局");
});

test("长原文只向供应商发送有章节标记的代表片段", () => {
  const source = Array.from(
    { length: 80 },
    (_, index) =>
      `## 第${index + 1}章 场景${index + 1}\n\n${`第${index + 1}章的剧情与人物对话。`.repeat(180)}`,
  ).join("\n\n");
  const sample = buildRepresentativeSource(source);

  assert.equal(sample.fullSourceSent, false);
  assert.ok(sample.sampledCharacters <= 48_000);
  assert.ok(sample.sampledCharacters < sample.sourceCharacters);
  assert.match(sample.text, /原文章节 1/);
  assert.match(sample.text, /原文章节 80/);
});

test("首版草稿无效时只修复一次并在通过后返回", async () => {
  let requestCount = 0;
  const source = `# 第一章\n\n${"旧邮局的灯在雨中亮着，沈川与林遥隔着柜台对视。".repeat(20)}`;
  const generated = await generateAdventureBundleFromSource(
    { fileName: "修复测试.md", content: source },
    {
      config: {
        provider: "openai_compatible",
        baseUrl: "https://models.example/v1",
        model: "story-model",
        apiKey: "secret",
      },
      fetchImplementation: async () => {
        requestCount += 1;
        return providerResponse(
          requestCount === 1
            ? { campaignName: "缺少字段" }
            : blueprint(),
        );
      },
    },
  );

  assert.equal(requestCount, 2);
  assert.equal(generated.generation.repairUsed, true);
  assert.equal(generated.generation.requestCount, 2);
  assert.equal(generated.generation.usage.totalTokens, 600);
});

test("正式生成强制采用玩家确认的人物分工和开场章节", async () => {
  let requestCount = 0;
  const capturedRequests = [];
  const source = [
    `# 第一章 旧邮局\n\n${"沈川在雨中第一次见到林遥。".repeat(25)}`,
    `# 第二章 档案室\n\n${"林遥带沈川进入档案室核对来信。".repeat(25)}`,
  ].join("\n\n");
  const generated = await generateAdventureBundleFromSource(
    {
      fileName: "玩家确认.md",
      content: source,
      preferences: {
        playerCharacterName: "沈川",
        mainCharacterName: "林遥",
        openingChapterIndex: 2,
        openingTitle: "封存的投递记录",
        openingLocation: "旧邮局档案室",
        openingSummary: "两人核对无法存在的投递记录。",
      },
    },
    {
      config: {
        provider: "openai_compatible",
        baseUrl: "https://models.example/v1",
        model: "story-model",
        apiKey: "secret",
      },
      fetchImplementation: async (_url, init) => {
        requestCount += 1;
        capturedRequests.push(JSON.parse(init.body));
        const output = blueprint();
        output.opening.sourceChapterIndex = 2;
        if (requestCount === 1) output.player.name = "错误角色";
        return providerResponse(output);
      },
    },
  );

  assert.equal(requestCount, 2);
  assert.equal(generated.preview.adventure.player.name, "沈川");
  assert.equal(generated.preview.adventure.mainCharacter.name, "林遥");
  assert.equal(generated.preview.adventure.sourceDocuments[0].currentChapter, 2);
  assert.match(capturedRequests[0].messages[0].content, /玩家控制角色：沈川/);
  assert.match(capturedRequests[0].messages[0].content, /开场原文章节：2/);
  assert.match(capturedRequests[1].messages[0].content, /不得更换/);
});

test("输入或二次输出无效时停止且不产生第三次请求", async () => {
  let requestCount = 0;
  const options = {
    config: {
      provider: "openai_compatible",
      baseUrl: "https://models.example/v1",
      model: "story-model",
      apiKey: "secret",
    },
    fetchImplementation: async () => {
      requestCount += 1;
      return providerResponse({ campaignName: "仍缺少字段" });
    },
  };

  await assert.rejects(
    generateAdventureBundleFromSource(
      { fileName: "过短.md", content: "不足两百字" },
      options,
    ),
    SourceBundleGenerationInputError,
  );
  assert.equal(requestCount, 0);

  await assert.rejects(
    generateAdventureBundleFromSource(
      {
        fileName: "无效输出.md",
        content: `# 第一章\n\n${"雨中的旧邮局仍然亮着灯，人物正在等待故事开始。".repeat(20)}`,
      },
      options,
    ),
    SourceBundleGenerationOutputError,
  );
  assert.equal(requestCount, 2);
});
