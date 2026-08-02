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
    assert.match(guidance[0].content, /主动打开了钟楼侧门/);
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
