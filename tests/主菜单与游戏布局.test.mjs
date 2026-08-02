import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("首页主菜单提供 API 配置并保留新建、继续两个二级页面", async () => {
  const [home, styles] = await Promise.all([
    readProjectFile("app/酒馆首页.tsx"),
    readProjectFile("app/globals.css"),
  ]);

  assert.match(home, /type HomeView = "menu" \| "new" \| "continue"/);
  assert.match(home, /aria-label="游戏主菜单"/);
  for (const label of ["新剧本", "继续游戏", "API 配置", "退出", "返回主菜单"]) {
    assert.match(home, new RegExp(label));
  }
  assert.match(
    home,
    /className="main-menu-api"[\s\S]*?onClick=\{openModelSettings\}/,
  );
  assert.doesNotMatch(home, /className="model-config-note"/);
  assert.match(home, /window\.location\.assign\(`\/game\/\$\{body\.adventure\.sessionId\}`\)/);
  assert.match(styles, /\.main-menu-page/);
  assert.match(styles, /\.continue-content/);
  assert.match(home, /className="continue-archive-import"/);
  assert.match(home, /导入游戏存档/);
  assert.match(home, /accept="\.json,application\/json"/);
  assert.match(styles, /\.continue-archive-import/);
});

test("游戏正文之后依次显示玩家回应、剧情走向和本轮变化", async () => {
  const [game, styles] = await Promise.all([
    readProjectFile("app/game/[sessionId]/游戏界面.tsx"),
    readProjectFile("app/globals.css"),
  ]);

  assert.match(game, /className="decision-card"/);
  assert.match(game, /href="\/"[\s\S]*?主菜单/);
  assert.match(game, /className="story-direction-card"/);
  assert.match(game, /导演输入 · 可选/);
  assert.match(game, /只在希望调整后续长期发展时修改/);
  const decisionStart = game.indexOf('className="decision-card"');
  const directionStart = game.indexOf('className="story-direction-card"');
  const submitButton = game.indexOf('"生成下一回合"');
  assert.ok(decisionStart >= 0);
  assert.ok(directionStart > decisionStart);
  assert.ok(
    submitButton > decisionStart && submitButton < directionStart,
    "生成下一回合按钮应位于玩家回应区域内",
  );
  assert.match(styles, /\.decision-card\s*\{[\s\S]*?order:\s*5/);
  assert.match(styles, /\.story-direction-card\s*\{[\s\S]*?order:\s*6/);
  assert.match(styles, /\.turn-changes\s*\{[\s\S]*?order:\s*7/);
});

test("桌面版退出按钮通过受限预加载桥接关闭程序", async () => {
  const [main, preload, buildScript, verifyScript] = await Promise.all([
    readProjectFile("desktop/main.mjs"),
    readProjectFile("desktop/preload.cjs"),
    readProjectFile("scripts/构建macOS桌面包.mjs"),
    readProjectFile("scripts/验证macOS桌面包.mjs"),
  ]);

  assert.match(main, /preload: path\.join\(desktopDirectory, "preload\.cjs"\)/);
  assert.match(main, /ipcMain\.on\("ai-tavern:quit"/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("aiTavernDesktop"/);
  assert.match(preload, /ipcRenderer\.send\("ai-tavern:quit"\)/);
  assert.match(buildScript, /desktop", "preload\.cjs"/);
  assert.match(verifyScript, /应用包内缺少桌面退出桥接脚本/);
});
