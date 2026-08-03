import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { openLocalDatabase } from "../db/index.ts";
import {
  parseSourceDocumentInput,
  rankSourceReferences,
  splitSourceDocument,
} from "../lib/reference/原文参考.ts";
import { LocalStoryStore } from "../lib/storage/story-store.ts";
import { parsePlayerTurnRequest } from "../lib/story/回合协议.ts";
import { advanceAdventureTurn } from "../lib/story/回合服务.ts";

const migrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

const sourceDocument = parseSourceDocumentInput({
  name: "潮汐城原作",
  fileName: "潮汐城原作.md",
  content: [
    "# 第一章 钟楼初见",
    "守钟人把钥匙压在掌心，没有立刻交给旅人。",
    "“先告诉我，你为什么寻找那口钟。”她的语气平静，目光却始终没有离开旅人的手。",
    "# 第二章 影子失踪",
    "守钟人发现旅人的影子变淡后，第一次主动打开了钟楼侧门。",
    "“跟紧我。现在不是证明你勇敢的时候。”",
  ].join("\n\n"),
  currentChapter: 1,
  preventFuture: true,
  fidelity: "balanced",
});

test("splits chaptered source text and ranks character voice references", () => {
  const split = splitSourceDocument(sourceDocument.content, ["守钟人", "旅人"]);
  assert.equal(split.chapterCount, 2);
  assert.equal(split.chunks.length, 2);
  assert.deepEqual(split.chunks[0].characterNames, ["守钟人", "旅人"]);

  const ranked = rankSourceReferences({
    query: "旅人询问守钟人是否愿意交出钥匙",
    currentCharacterNames: ["守钟人", "旅人"],
    candidates: split.chunks.map((chunk) => ({
      chunkId: `chunk-${chunk.ordinal}`,
      ordinal: chunk.ordinal,
      documentId: "source-1",
      documentName: sourceDocument.name,
      fileName: sourceDocument.fileName,
      chapterIndex: chunk.chapterIndex,
      chapterTitle: chunk.chapterTitle,
      content: chunk.content,
      characterNames: chunk.characterNames,
      currentChapter: 1,
      fidelity: "balanced",
    })),
  });
  assert.equal(ranked[0].chapterIndex, 1);
  assert.deepEqual(ranked[0].matchedCharacterNames, ["守钟人", "旅人"]);
});

test("长中文查询仍能优先命中具体机制词", () => {
  const ranked = rankSourceReferences({
    query: "相信林听雪，让她继续说明灵脉封禁的解决方案",
    currentCharacterNames: ["林听雪", "李长安"],
    candidates: [
      {
        chunkId: "generic",
        ordinal: 0,
        documentId: "source-1",
        documentName: "测试原文",
        fileName: "测试原文.md",
        chapterIndex: 2,
        chapterTitle: "第二章",
        content: "林听雪与李长安继续谈论婚约，并等待对方作出决定。",
        characterNames: ["林听雪", "李长安"],
        currentChapter: 1,
        fidelity: "faithful",
      },
      {
        chunkId: "canonical-mechanism",
        ordinal: 1,
        documentId: "source-1",
        documentName: "测试原文",
        fileName: "测试原文.md",
        chapterIndex: 2,
        chapterTitle: "第二章",
        content: "林听雪说明灵脉并非受损，而是封禁；林家秘法能够触及阵眼。",
        characterNames: ["林听雪", "李长安"],
        currentChapter: 1,
        fidelity: "faithful",
      },
    ],
  });

  assert.equal(ranked[0].chunkId, "canonical-mechanism");
  assert.equal(ranked[0].matchedTerms.includes("灵脉"), true);
  assert.equal(ranked[0].matchedTerms.includes("封禁"), true);
});

test("does not treat prose beginning with an ordinal as a Markdown chapter", () => {
  const document = parseSourceDocumentInput({
    name: "章节识别测试",
    fileName: "章节识别测试.md",
    content: [
      "# 测试正文",
      "",
      "## 第一章 初见",
      "",
      "第一回是在城门，他们只说了两句话。",
      "",
      "第二回是在书院，这仍然是第一章的正文。",
      "",
      "## 第二章 重逢",
      "",
      "他们在雨中再次见面。",
    ].join("\n"),
  });

  const split = splitSourceDocument(document.content, []);

  assert.equal(split.chapterCount, 2);
  assert.equal(split.chunks[0].chapterTitle, "第一章 初见");
  assert.match(split.chunks[0].content, /第二回是在书院/);
  assert.equal(split.chunks.at(-1).chapterTitle, "第二章 重逢");
});

test("stores source documents locally and blocks future chapters during retrieval", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-source-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "原文参考测试",
      world: { name: "潮汐城", premise: "钟声改变潮汐。" },
      player: { name: "旅人", description: "调查失踪案。" },
      mainCharacter: {
        name: "守钟人",
        role: "钟楼看守",
        personality: "谨慎、克制。",
      },
      openingScene: "旅人来到钟楼。",
      sourceDocuments: [sourceDocument],
    });
    assert.equal(store.listSourceDocuments(started.sessionId).length, 1);
    const adventure = store.loadAdventure(started.sessionId);
    const firstReferences = store.findRelevantSourceReferences({
      sessionId: started.sessionId,
      adventure,
      query: "旅人询问守钟人能否进入钟楼",
    });
    assert.ok(firstReferences.length > 0);
    assert.equal(
      firstReferences.every((reference) => reference.chapterIndex === 1),
      true,
    );

    const document = store.listSourceDocuments(started.sessionId)[0];
    const updated = store.updateSourceDocument(started.sessionId, document.id, {
      currentChapter: 2,
      fidelity: "faithful",
    });
    assert.equal(updated.currentChapter, 2);
    assert.equal(updated.fidelity, "faithful");
    assert.equal(
      store.findRelevantSourceReferences({
        sessionId: started.sessionId,
        adventure,
        query: "旅人的影子变淡，守钟人打开侧门",
      })[0].chapterIndex,
      2,
    );

    store.deleteSourceDocument(started.sessionId, document.id);
    assert.equal(store.listSourceDocuments(started.sessionId).length, 0);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("高度贴合的剧本任务只把下一章节作为导演锚点", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-guidance-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = store.startAdventure({
      campaignName: "原文导演锚点测试",
      world: { name: "潮汐城", premise: "钟声改变潮汐。" },
      player: { name: "旅人", description: "调查失踪案。" },
      mainCharacter: {
        name: "守钟人",
        role: "钟楼看守",
        personality: "谨慎、克制。",
      },
      openingScene: "旅人来到钟楼。",
      initialStoryDirection: "查明旅人的影子为何变淡。",
      initialStoryModuleId: "fading-shadow",
      storyModules: [
        {
          id: "fading-shadow",
          title: "影子失踪",
          objective: "查明旅人的影子为何变淡，并找到进入钟楼的办法。",
          completionCriteria: ["影子变淡的原因得到可信解释"],
          prerequisiteModuleIds: [],
        },
      ],
      sourceDocuments: [{ ...sourceDocument, fidelity: "faithful" }],
    });
    const adventure = store.loadAdventure(started.sessionId);
    const visibleReferences = store.findRelevantSourceReferences({
      sessionId: started.sessionId,
      adventure,
      query: "旅人的影子变淡，守钟人准备说明解决办法",
    });
    const guidance = store.findUpcomingScriptGuidance({
      sessionId: started.sessionId,
      adventure,
      query: "旅人的影子变淡，守钟人准备说明解决办法",
    });

    assert.equal(
      visibleReferences.every((reference) => reference.chapterIndex === 1),
      true,
    );
    assert.equal(guidance.length, 1);
    assert.equal(guidance[0].chapterIndex, 2);
    assert.equal(guidance[0].scope, "next_chapter_director_only");
    assert.match(guidance[0].content, /主动打开了钟楼侧门/);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function fiveChapterSourceDocument(overrides = {}) {
  return parseSourceDocumentInput({
    name: "潮汐城原作",
    fileName: "潮汐城原作.md",
    content: [
      "# 第一章 钟楼初见",
      "守钟人把钥匙压在掌心。",
      "# 第二章 影子失踪",
      "守钟人发现旅人的影子变淡。",
      "# 第三章 潮汐铜钥匙",
      "守钟人取出潮汐铜钥匙。",
      "# 第四章 逆流铜钟",
      "铜钟逆流滴水。",
      "# 第五章 归还钟声",
      "旅人把钟声还给潮汐。",
    ].join("\n\n"),
    currentChapter: 1,
    preventFuture: true,
    fidelity: "balanced",
    ...overrides,
  });
}

function makeGeneratedTurn({
  eventId,
  scene,
  sourceProgress,
  playerCharacterId,
  mainCharacterId,
  attributeChecks,
}) {
  const output = {
    schemaVersion: "1.0.0",
    turn: {
      scene,
      events: [
        {
          id: eventId,
          type: "plot_progress",
          summary: scene,
          characterIds: [playerCharacterId, mainCharacterId],
          locationId: "clock-tower",
        },
      ],
      dialogue: [
        {
          id: `${eventId}-line`,
          speakerId: mainCharacterId,
          content: "钟楼里还有我们没看过的东西。",
          addressedCharacterIds: [playerCharacterId],
        },
      ],
    },
    decision: {
      context: "action_direction",
      prompt: "旅人接下来准备做什么？",
      choices: [
        {
          id: "choice-1",
          label: "继续调查",
          description: "留在钟楼继续调查。",
          stance: "neutral",
        },
        {
          id: "choice-2",
          label: "回去休息",
          description: "先离开钟楼休息。",
          stance: "benevolent",
        },
      ],
    },
    stateCommit: {
      sceneTransition: {
        locationId: "clock-tower",
        locationName: "逆流钟楼",
        locationDescription: "铜钟悬在潮湿的石室中央。",
        presentCharacterIds: [playerCharacterId, mainCharacterId],
        reason: "旅人与守钟人仍在钟楼石室中。",
        evidence: [eventId],
      },
      characterStateChanges: [],
      relationshipChanges: [],
      characterCardChanges: [],
      worldBookChanges: [],
      storyDirectionEvaluation: {
        status: "active",
        reason: "调查仍在继续。",
        evidence: [],
        continuity: "uncertain",
        continuityReason: "当前没有预埋剧本任务可供比较。",
        recommendedModuleId: null,
        suggestedNextDirection: null,
      },
      summaryPatch: scene,
    },
    warnings: [],
  };
  if (sourceProgress !== undefined) output.sourceProgress = sourceProgress;
  if (attributeChecks !== undefined) output.attributeChecks = attributeChecks;
  return output;
}

function startFiveChapterAdventure(store) {
  return store.startAdventure({
    campaignName: "自动推进测试",
    world: { name: "潮汐城", premise: "钟声改变潮汐。" },
    player: { name: "旅人", description: "调查失踪案。" },
    mainCharacter: {
      name: "守钟人",
      role: "钟楼看守",
      personality: "谨慎、克制。",
    },
    openingScene: "旅人来到钟楼。",
    initialStoryDirection: "查明影子失踪的原因。",
    sourceDocuments: [fiveChapterSourceDocument()],
  });
}

async function runAdvanceTurn({ store, started, expectedHeadTurnId, idempotencyKey, turnId, sourceProgress, scene, selectedChoiceId = "choice-1" }) {
  const generatedContent = makeGeneratedTurn({
    eventId: `event-${turnId}`,
    scene: scene ?? "旅人与守钟人继续调查钟楼的秘密。",
    sourceProgress,
    playerCharacterId: started.playerCharacterId,
    mainCharacterId: started.mainCharacterId,
  });
  return advanceAdventureTurn({
    store,
    sessionId: started.sessionId,
    input: parsePlayerTurnRequest({
      expectedHeadTurnId,
      idempotencyKey,
      selectedChoiceId,
      storyDirection: "查明影子失踪的原因。",
    }),
    createTurnId: () => turnId,
    generate: async () => ({
      content: generatedContent,
      model: "deepseek-v4-flash",
      usage: { totalTokens: 800 },
    }),
  });
}

test("回合输出 sourceProgress 时自动向前推进原文章节（只进不退）", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-auto-advance-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startFiveChapterAdventure(store);
    const document = store.listSourceDocuments(started.sessionId)[0];
    // 玩家手动把进度推进到第 3 章
    store.updateSourceDocument(started.sessionId, document.id, {
      currentChapter: 3,
    });

    const first = await runAdvanceTurn({
      store,
      started,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "auto-advance-1",
      turnId: "turn-advance-1",
      sourceProgress: 5,
      scene: "旅人把钟声还给潮汐。",
      selectedChoiceId: "opening-neutral",
    });
    assert.equal(first.committedTurn.sequence, 2);
    assert.equal(
      store.listSourceDocuments(started.sessionId)[0].currentChapter,
      5,
    );
    // 检索已解锁第 5 章
    const adventure = store.loadAdventure(started.sessionId);
    const references = store.findRelevantSourceReferences({
      sessionId: started.sessionId,
      adventure,
      query: "旅人把钟声还给潮汐",
    });
    assert.equal(references.some((reference) => reference.chapterIndex === 5), true);

    // 下一回合报告更小或相同的进度：保持不回退
    const second = await runAdvanceTurn({
      store,
      started,
      expectedHeadTurnId: first.committedTurn.id,
      idempotencyKey: "auto-advance-2",
      turnId: "turn-advance-2",
      sourceProgress: 2,
      scene: "旅人与守钟人停留在钟楼。",
    });
    assert.equal(second.committedTurn.sequence, 3);
    assert.equal(
      store.listSourceDocuments(started.sessionId)[0].currentChapter,
      5,
    );

    // 省略 sourceProgress：进度不变
    const third = await runAdvanceTurn({
      store,
      started,
      expectedHeadTurnId: second.committedTurn.id,
      idempotencyKey: "auto-advance-3",
      turnId: "turn-advance-3",
      scene: "两人只是交谈了几句日常。",
    });
    assert.equal(third.committedTurn.sequence, 4);
    assert.equal(
      store.listSourceDocuments(started.sessionId)[0].currentChapter,
      5,
    );

    // 连续多回合推进：5 -> 6（超出总章数时收敛到 chapterCount）
    const fourth = await runAdvanceTurn({
      store,
      started,
      expectedHeadTurnId: third.committedTurn.id,
      idempotencyKey: "auto-advance-4",
      turnId: "turn-advance-4",
      sourceProgress: 8,
      scene: "潮汐城的钟声响彻全城。",
    });
    assert.equal(fourth.committedTurn.sequence, 5);
    assert.equal(
      store.listSourceDocuments(started.sessionId)[0].currentChapter,
      5,
    );

    // 自动推进写入了可审计的修改记录，且不会阻断该回合重新生成
    const changes = store.listContentAssetManagementChanges(started.sessionId);
    const advanceChanges = changes.filter(
      (change) => change.operation === "advance",
    );
    assert.ok(advanceChanges.length >= 1);
    assert.equal(advanceChanges[0].canRollback, false);
    const prepared = store.prepareTurnRegeneration(
      started.sessionId,
      fourth.committedTurn.id,
    );
    assert.equal(prepared.currentTurn.id, fourth.committedTurn.id);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("多份原文文档时 sourceProgress 分别向前解锁到各自的章节数", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-multi-source-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startFiveChapterAdventure(store);
    const shorter = fiveChapterSourceDocument({
      name: "外传短篇",
      fileName: "外传短篇.md",
      content: [
        "# 第一章 起风",
        "风从海面吹来。",
        "# 第二章 落潮",
        "潮水退去。",
        "# 第三章 归航",
        "小船回到码头。",
      ].join("\n\n"),
    });
    store.importSourceDocument(started.sessionId, shorter);

    const first = await runAdvanceTurn({
      store,
      started,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "multi-source-1",
      turnId: "turn-multi-1",
      sourceProgress: 4,
      scene: "铜钟逆流滴水。",
      selectedChoiceId: "opening-neutral",
    });
    const documents = store.listSourceDocuments(started.sessionId);
    const main = documents.find((item) => item.fileName === "潮汐城原作.md");
    const side = documents.find((item) => item.fileName === "外传短篇.md");
    assert.equal(main.currentChapter, 4);
    assert.equal(side.currentChapter, 3);

    // 停用的文档不参与自动推进
    store.updateSourceDocument(started.sessionId, side.id, {
      enabled: false,
      currentChapter: 1,
    });
    const second = await runAdvanceTurn({
      store,
      started,
      expectedHeadTurnId: first.committedTurn.id,
      idempotencyKey: "multi-source-2",
      turnId: "turn-multi-2",
      sourceProgress: 5,
      scene: "旅人把钟声还给潮汐。",
    });
    assert.equal(second.committedTurn.sequence, 3);
    const after = store.listSourceDocuments(started.sessionId);
    assert.equal(
      after.find((item) => item.fileName === "潮汐城原作.md").currentChapter,
      5,
    );
    assert.equal(
      after.find((item) => item.fileName === "外传短篇.md").currentChapter,
      1,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("手动设置与自动推进共存：自动推进不覆盖玩家更早的更高进度", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-manual-auto-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startFiveChapterAdventure(store);
    const document = store.listSourceDocuments(started.sessionId)[0];
    // 玩家手动设置到第 4 章
    store.updateSourceDocument(started.sessionId, document.id, {
      currentChapter: 4,
    });
    // 模型报告第 2 章：不得把进度改小
    const first = await runAdvanceTurn({
      store,
      started,
      expectedHeadTurnId: started.openingTurnId,
      idempotencyKey: "manual-auto-1",
      turnId: "turn-manual-1",
      sourceProgress: 2,
      scene: "旅人与守钟人交谈。",
      selectedChoiceId: "opening-neutral",
    });
    assert.equal(first.committedTurn.sequence, 2);
    assert.equal(
      store.listSourceDocuments(started.sessionId)[0].currentChapter,
      4,
    );
    // 模型随后报告第 5 章：继续向前解锁
    const second = await runAdvanceTurn({
      store,
      started,
      expectedHeadTurnId: first.committedTurn.id,
      idempotencyKey: "manual-auto-2",
      turnId: "turn-manual-2",
      sourceProgress: 5,
      scene: "旅人把钟声还给潮汐。",
    });
    assert.equal(second.committedTurn.sequence, 3);
    assert.equal(
      store.listSourceDocuments(started.sessionId)[0].currentChapter,
      5,
    );
    // 回合输出中保留 sourceProgress 原始值
    const lastOutput = store.loadAdventure(started.sessionId).branchState
      .recentTurns.at(-1).generatedOutput;
    assert.equal(lastOutput.sourceProgress, 5);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("提示词包含当前原文进度与自动推进规则", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-source-prompt-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startFiveChapterAdventure(store);
    const document = store.listSourceDocuments(started.sessionId)[0];
    store.updateSourceDocument(started.sessionId, document.id, {
      currentChapter: 2,
    });
    let receivedMessages;
    const generatedContent = makeGeneratedTurn({
      eventId: "event-prompt-1",
      scene: "旅人与守钟人继续调查。",
      sourceProgress: 3,
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
    });
    await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "source-prompt-1",
        selectedChoiceId: "opening-neutral",
        storyDirection: "查明影子失踪的原因。",
      }),
      createTurnId: () => "turn-prompt-1",
      generate: async (messages) => {
        receivedMessages = messages;
        return {
          content: generatedContent,
          model: "deepseek-v4-flash",
          usage: { totalTokens: 800 },
        };
      },
    });
    assert.match(receivedMessages[0].content, /原文进度自动推进/);
    assert.match(receivedMessages[0].content, /已解锁《潮汐城原作》第 2\/5 章/);
    assert.match(receivedMessages[0].content, /绝不能只为解锁后续原文章节而虚报进度/);
    assert.match(receivedMessages[0].content, /"sourceProgress": N/);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("属性判定待确认回合在掷骰提交后同样自动推进原文章节", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-pending-advance-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startFiveChapterAdventure(store);
    const generatedContent = makeGeneratedTurn({
      eventId: "event-pending-1",
      scene: "旅人潜入钟楼地下石室。",
      sourceProgress: 4,
      playerCharacterId: started.playerCharacterId,
      mainCharacterId: started.mainCharacterId,
      attributeChecks: [
        {
          id: "check-stealth",
          characterId: started.playerCharacterId,
          attribute: "敏捷",
          difficulty: 65,
          context: "在不惊动守钟人的情况下潜入石室",
        },
      ],
    });
    const pending = await advanceAdventureTurn({
      store,
      sessionId: started.sessionId,
      input: parsePlayerTurnRequest({
        expectedHeadTurnId: started.openingTurnId,
        idempotencyKey: "pending-advance-1",
        selectedChoiceId: "opening-neutral",
        storyDirection: "查明影子失踪的原因。",
      }),
      createTurnId: () => "turn-pending-1",
      generate: async () => ({
        content: generatedContent,
        model: "deepseek-v4-flash",
        usage: { totalTokens: 800 },
      }),
    });
    assert.equal(pending.committedTurn, null);
    // 待确认阶段：进度尚未落库
    assert.equal(store.listSourceDocuments(started.sessionId)[0].currentChapter, 1);
    const backfill = store.resolvePendingTurnChecks({
      sessionId: started.sessionId,
      pendingTurnId: pending.pendingTurnId,
      expectedHeadTurnId: started.openingTurnId,
      results: [{ checkId: "check-stealth", roll: 80 }],
    });
    assert.equal(backfill.committedTurn.id, pending.pendingTurnId);
    // 提交后：自动推进生效
    assert.equal(store.listSourceDocuments(started.sessionId)[0].currentChapter, 4);
    assert.equal(
      store.listContentAssetManagementChanges(started.sessionId).filter(
        (change) => change.operation === "advance",
      ).length,
      1,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function makeGuidanceAdventure({ base, recentTurns, states }) {
  return {
    ...base,
    branchState: {
      ...base.branchState,
      states: states ?? base.branchState.states,
      recentTurns: recentTurns ?? base.branchState.recentTurns,
    },
  };
}

function makeMockTurn(base, { id, sequence, evaluation }) {
  return {
    id,
    branchId: base.branchState.branch.id,
    sequence,
    parentTurnId: base.branchState.recentTurns.at(-1)?.id ?? null,
    playerInput: {},
    generatedOutput:
      evaluation == null
        ? { stateCommit: {} }
        : { stateCommit: { storyDirectionEvaluation: evaluation } },
    summaryPatch: "旅人与守钟人在钟楼调查。",
    stateChanges: [],
    blockedStateChanges: [],
    createdAt: new Date().toISOString(),
  };
}

function alignedEvaluation({ status = "active", continuity = "aligned" } = {}) {
  return {
    status,
    reason: "调查仍在继续。",
    evidence: [],
    continuity,
    continuityReason: "与预埋剧本的连续性一致。",
    recommendedModuleId: null,
    suggestedNextDirection: null,
  };
}

function startGuidanceAdventure(store, sourceDocuments) {
  return store.startAdventure({
    campaignName: "剧本推进引导测试",
    world: { name: "潮汐城", premise: "钟声改变潮汐。" },
    player: { name: "旅人", description: "调查失踪案。" },
    mainCharacter: {
      name: "守钟人",
      role: "钟楼看守",
      personality: "谨慎、克制。",
    },
    openingScene: "旅人来到钟楼。",
    initialStoryDirection: "查明旅人的影子为何变淡。",
    initialStoryModuleId: "fading-shadow",
    storyModules: [
      {
        id: "fading-shadow",
        title: "影子失踪",
        objective: "查明旅人的影子为何变淡，并找到进入钟楼的办法。",
        completionCriteria: ["影子变淡的原因得到可信解释"],
        prerequisiteModuleIds: [],
      },
    ],
    sourceDocuments,
  });
}

test("剧本推进引导：剧情与大纲一致时从下一章节提取进度线索并标注 scope", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-progress-hint-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startGuidanceAdventure(store, [sourceDocument]);
    const base = store.loadAdventure(started.sessionId);
    const adventure = makeGuidanceAdventure({
      base,
      recentTurns: [
        ...base.branchState.recentTurns,
        makeMockTurn(base, {
          id: "turn-aligned-1",
          sequence: 2,
          evaluation: alignedEvaluation(),
        }),
      ],
    });
    const guidance = store.findUpcomingScriptGuidance({
      sessionId: started.sessionId,
      adventure,
      query: "旅人询问守钟人能否进入钟楼",
    });

    assert.equal(guidance.length, 1);
    assert.equal(guidance[0].chapterIndex, 2);
    assert.equal(guidance[0].scope, "next_chapter_progress_hint");
    assert.equal(guidance[0].fidelity, "balanced");
    assert.match(guidance[0].content, /主动打开了钟楼侧门/);
    assert.ok(guidance.reduce((sum, item) => sum + item.content.length, 0) <= 3_600);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("剧本推进引导：多文档命中时受 2 片段与 3600 字符预算限制", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-progress-budget-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const documents = ["甲", "乙", "丙"].map((label) =>
      parseSourceDocumentInput({
        name: `原文${label}`,
        fileName: `原文${label}.md`,
        content: [
          "# 第一章 初见",
          `${label}章开篇。`,
          "# 第二章 推进",
          `${label}线索：${label.repeat(2_000)}`,
        ].join("\n\n"),
        currentChapter: 1,
        preventFuture: true,
        fidelity: "balanced",
      }),
    );
    const started = startGuidanceAdventure(store, documents);
    const base = store.loadAdventure(started.sessionId);
    const adventure = makeGuidanceAdventure({
      base,
      recentTurns: [
        ...base.branchState.recentTurns,
        makeMockTurn(base, {
          id: "turn-aligned-budget",
          sequence: 2,
          evaluation: alignedEvaluation(),
        }),
      ],
    });
    const guidance = store.findUpcomingScriptGuidance({
      sessionId: started.sessionId,
      adventure,
      query: "旅人询问守钟人能否进入钟楼",
    });

    assert.ok(guidance.length >= 1);
    assert.ok(guidance.length <= 2);
    assert.ok(
      guidance.reduce((sum, item) => sum + item.content.length, 0) <= 3_600,
    );
    assert.equal(
      guidance.every((item) => item.chapterIndex === 2),
      true,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("剧本推进引导：diverged 或 uncertain 不注入", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-progress-blocked-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startGuidanceAdventure(store, [sourceDocument]);
    const base = store.loadAdventure(started.sessionId);
    for (const continuity of ["diverged", "uncertain"]) {
      const adventure = makeGuidanceAdventure({
        base,
        recentTurns: [
          ...base.branchState.recentTurns,
          makeMockTurn(base, {
            id: `turn-${continuity}`,
            sequence: 2,
            evaluation: alignedEvaluation({ continuity }),
          }),
        ],
      });
      const guidance = store.findUpcomingScriptGuidance({
        sessionId: started.sessionId,
        adventure,
        query: "旅人询问守钟人能否进入钟楼",
      });
      assert.equal(guidance.length, 0, `${continuity} 不应注入推进引导`);
    }
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("剧本推进引导：无活动任务但最近完成的任务判定 aligned 时注入", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-progress-completed-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startGuidanceAdventure(store, [sourceDocument]);
    const base = store.loadAdventure(started.sessionId);
    const completedTurnId = "turn-completed-1";
    const states = base.branchState.states.map((state) =>
      state.entityType === "story_direction"
        ? {
            ...state,
            isActive: false,
            updatedTurnId: completedTurnId,
            state: {
              ...state.state,
              status: "completed",
              continuity: "aligned",
              continuityReason: "与预埋剧本的连续性一致。",
            },
          }
        : state,
    );
    const adventure = makeGuidanceAdventure({
      base,
      recentTurns: [
        ...base.branchState.recentTurns,
        makeMockTurn(base, {
          id: completedTurnId,
          sequence: 2,
          evaluation: null,
        }),
      ],
      states,
    });
    const guidance = store.findUpcomingScriptGuidance({
      sessionId: started.sessionId,
      adventure,
      query: "旅人询问守钟人能否进入钟楼",
    });

    assert.equal(guidance.length, 1);
    assert.equal(guidance[0].scope, "next_chapter_progress_hint");
    assert.equal(guidance[0].chapterIndex, 2);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("剧本推进引导：完成判定已超过最近 5 回合时不再注入", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-progress-stale-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);
    const started = startGuidanceAdventure(store, [sourceDocument]);
    const base = store.loadAdventure(started.sessionId);
    const oldTurnId = "turn-completed-old";
    const states = base.branchState.states.map((state) =>
      state.entityType === "story_direction"
        ? {
            ...state,
            isActive: false,
            updatedTurnId: oldTurnId,
            state: {
              ...state.state,
              status: "completed",
              continuity: "aligned",
              continuityReason: "与预埋剧本的连续性一致。",
            },
          }
        : state,
    );
    const adventure = makeGuidanceAdventure({
      base,
      recentTurns: [
        ...base.branchState.recentTurns,
        makeMockTurn(base, {
          id: oldTurnId,
          sequence: 2,
          evaluation: null,
        }),
        makeMockTurn(base, {
          id: "turn-later-1",
          sequence: 3,
          evaluation: null,
        }),
        makeMockTurn(base, {
          id: "turn-later-2",
          sequence: 4,
          evaluation: null,
        }),
        makeMockTurn(base, {
          id: "turn-later-3",
          sequence: 5,
          evaluation: null,
        }),
        makeMockTurn(base, {
          id: "turn-later-4",
          sequence: 6,
          evaluation: null,
        }),
        makeMockTurn(base, {
          id: "turn-later-5",
          sequence: 7,
          evaluation: null,
        }),
        makeMockTurn(base, {
          id: "turn-later-6",
          sequence: 8,
          evaluation: null,
        }),
      ],
      states,
    });
    const guidance = store.findUpcomingScriptGuidance({
      sessionId: started.sessionId,
      adventure,
      query: "旅人询问守钟人能否进入钟楼",
    });
    assert.equal(guidance.length, 0);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("剧本推进引导：开局首回合、无原文或未开启防剧透时不注入", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ai-tavern-progress-guard-"));
  const database = openLocalDatabase({
    filePath: join(temporaryDirectory, "story.sqlite"),
    migrationsDir,
  });
  try {
    const store = new LocalStoryStore(database);

    // 开局首回合：还没有任何连续性评估
    const withSource = startGuidanceAdventure(store, [sourceDocument]);
    const openingAdventure = store.loadAdventure(withSource.sessionId);
    assert.equal(
      store.findUpcomingScriptGuidance({
        sessionId: withSource.sessionId,
        adventure: openingAdventure,
        query: "旅人询问守钟人能否进入钟楼",
      }).length,
      0,
    );

    // 无原文：即使剧情一致也没有下一章节线索
    const noSource = startGuidanceAdventure(store, []);
    const noSourceBase = store.loadAdventure(noSource.sessionId);
    const noSourceAdventure = makeGuidanceAdventure({
      base: noSourceBase,
      recentTurns: [
        ...noSourceBase.branchState.recentTurns,
        makeMockTurn(noSourceBase, {
          id: "turn-aligned-no-source",
          sequence: 2,
          evaluation: alignedEvaluation(),
        }),
      ],
    });
    assert.equal(
      store.findUpcomingScriptGuidance({
        sessionId: noSource.sessionId,
        adventure: noSourceAdventure,
        query: "旅人询问守钟人能否进入钟楼",
      }).length,
      0,
    );

    // 未开启防剧透：进度之后的片段绝不能进入任何参考通道
    const noPreventFuture = startGuidanceAdventure(store, [
      { ...sourceDocument, preventFuture: false },
    ]);
    const noPreventBase = store.loadAdventure(noPreventFuture.sessionId);
    const noPreventAdventure = makeGuidanceAdventure({
      base: noPreventBase,
      recentTurns: [
        ...noPreventBase.branchState.recentTurns,
        makeMockTurn(noPreventBase, {
          id: "turn-aligned-no-prevent",
          sequence: 2,
          evaluation: alignedEvaluation(),
        }),
      ],
    });
    assert.equal(
      store.findUpcomingScriptGuidance({
        sessionId: noPreventFuture.sessionId,
        adventure: noPreventAdventure,
        query: "旅人询问守钟人能否进入钟楼",
      }).length,
      0,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
