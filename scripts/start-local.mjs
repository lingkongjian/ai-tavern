import { spawn, spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const url = "http://127.0.0.1:3210/";
let child;
let stopping = false;

function stop() {
  if (stopping || !child || child.exitCode !== null) return;
  stopping = true;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else child.kill("SIGTERM");
}

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error("需要 Node.js 22.13.0 或更高版本。");
  process.chdir(root);
  // Fail before installing or opening a browser if another service owns the port.
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error("端口 3210 已被占用，请先关闭已有服务再启动。")));
    probe.listen(3210, "127.0.0.1", () => probe.close(resolve));
  });
  const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextCli)) {
    const where = spawnSync("where.exe", ["npm.cmd"], { encoding: "utf8", windowsHide: true });
    const npmDirectories = [path.dirname(process.execPath), ...(where.stdout || "").trim().split(/\r?\n/).filter(Boolean).map((file) => path.dirname(file))];
    const npmCli = npmDirectories.map((dir) => path.join(dir, "node_modules", "npm", "bin", "npm-cli.js")).find(existsSync);
    if (!npmCli) throw new Error("没有找到 npm。请安装完整 Node.js，或先在项目目录运行 npm ci。");
    console.log("首次启动，正在安装项目组件……");
    const result = spawnSync(process.execPath, [npmCli, "ci", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit", windowsHide: true });
    if (result.error || result.status !== 0) throw new Error("依赖安装失败，请检查网络后重试。");
  }
  if (!existsSync(path.join(root, ".env.local"))) {
    copyFileSync(path.join(root, ".env.example"), path.join(root, ".env.local"), constants.COPYFILE_EXCL);
  }
  console.log(`正在启动 AI 酒馆：${url}\n请保留此窗口，按 Ctrl+C 停止。`);
  child = spawn(process.execPath, [path.join(root, "scripts", "next.mjs"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3210"], {
    cwd: root, stdio: "inherit", windowsHide: true,
  });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let opened = false;
  const deadline = Date.now() + 120_000;
  const timer = setInterval(() => {
    if (opened || stopping || Date.now() > deadline) { clearInterval(timer); return; }
    const request = http.get(url, { timeout: 2_000 }, (response) => {
      response.resume();
      if (response.statusCode !== 200 || opened || stopping) return;
      opened = true;
      clearInterval(timer);
      const browser = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Process 'http://127.0.0.1:3210/'"], { windowsHide: true, stdio: "ignore" });
      browser.on("error", () => console.log(`请在浏览器中打开 ${url}`));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => {});
  }, 1_000);
  child.once("error", (error) => { clearInterval(timer); console.error(error.message); process.exitCode = 1; });
  child.once("close", (code) => { clearInterval(timer); process.exitCode = stopping ? 0 : (code ?? 1); });
}

main().catch((error) => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
