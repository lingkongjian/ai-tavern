import assert from "node:assert/strict";
import test from "node:test";
import { resolvePortableRoot } from "../desktop/portable-paths.mjs";
import { execFile } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

test("Windows stores portable data beside the EXE, including Chinese, spaces and UNC paths", () => {
  for (const root of [String.raw`C:\Users\玩家\My Games\AI酒馆`, String.raw`\\server\games\AI 酒馆`]) {
    assert.equal(resolvePortableRoot({ platform: "win32", packaged: true, executable: `${root}\\AI酒馆.exe` }), root);
  }
});

test("macOS portable data stays outside the app bundle", () => {
  assert.equal(resolvePortableRoot({ platform: "darwin", packaged: true, executable: "/Applications/AI酒馆/AI酒馆.app/Contents/MacOS/AI酒馆" }), "/Applications/AI酒馆");
});

test("development and explicit portable roots remain supported", () => {
  assert.equal(resolvePortableRoot({ platform: "win32", packaged: false, desktopDirectory: String.raw`C:\Projects\AI 酒馆\desktop` }), String.raw`C:\Projects\AI 酒馆`);
  assert.equal(resolvePortableRoot({ platform: "win32", packaged: true, override: String.raw`D:\游戏 存档` }), String.raw`D:\游戏 存档`);
});

test("the Windows source launcher refuses an occupied port without stopping its owner", async (t) => {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(3210, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error.code === "EADDRINUSE") { t.skip("Port 3210 is already in use"); return; }
    throw error;
  }
  try {
    await assert.rejects(
      promisify(execFile)(process.execPath, [fileURLToPath(new URL("../scripts/start-local.mjs", import.meta.url))], { timeout: 5_000, windowsHide: true }),
      (error) => error.code === 1 && /端口 3210 已被占用/.test(error.stderr),
    );
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
