import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("build renders the Chinese four-option main menu", async () => {
  const html = await readFile(
    new URL("../.next/server/app/index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /<html[^>]*lang=["']zh-CN["']/i);
  assert.match(html, /<title>AI 酒馆<\/title>/i);
  assert.match(html, /游戏主菜单/);
  assert.match(html, /本地数据库已连接/);
  assert.match(html, /新剧本/);
  assert.match(html, /继续游戏/);
  assert.match(html, /API 配置/);
  assert.match(html, /退出/);
  assert.match(html, /AI 模型[\s\S]{0,30}尚未配置/);
  assert.match(html, /操作手册/);
  assert.doesNotMatch(html, /新建战役 · 第一步/);
  assert.doesNotMatch(html, /建立世界并进入第一幕/);
  assert.doesNotMatch(html, /AI TAVERN|NEW CAMPAIGN/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("build renders the complete Chinese operation manual", async () => {
  const html = await readFile(
    new URL("../.next/server/app/manual.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /<title>操作手册 · AI 酒馆<\/title>/i);
  assert.match(html, /<h1[^>]*>AI 酒馆完整操作手册<\/h1>/i);
  assert.match(html, /候选选项与三种输入/);
  assert.match(html, /人物、地点、剧情任务、世界书、原文、记忆、修改记录/);
  assert.match(html, /完整存档与整库备份/);
  assert.match(html, /下载 Markdown 原文/);
});
