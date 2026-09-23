import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const platformName = process.platform === "win32" ? "Windows" : "macOS";
const defaultProductDirectory = path.join(
  projectRoot,
  "发布",
  `AI酒馆-${packageJson.version}-${platformName}-${process.arch}`,
  "AI酒馆",
);
const productDirectory = path.resolve(process.argv[2] || defaultProductDirectory);
const appPath = process.platform === "win32" ? productDirectory : path.join(productDirectory, "AI酒馆.app");
const resourcesRoot = process.platform === "win32"
  ? path.join(appPath, "resources", "app") : path.join(appPath, "Contents", "Resources", "app");
const serverRoot = path.join(resourcesRoot, "server");
const executablePath = process.platform === "win32"
  ? path.join(appPath, "AI酒馆.exe") : path.join(appPath, "Contents", "MacOS", "AI酒馆");

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("close", resolve));
  // Terminate only the process tree created by this verifier on failure.
  if (process.platform === "win32") {
    try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
    catch { child.kill(); }
  } else child.kill("SIGKILL");
  await exited;
}

function cleanTemporaryDirectory(directory) {
  const relative = path.relative(os.tmpdir(), path.resolve(directory));
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "拒绝清理临时目录以外的路径。");
  rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(entryPath));
    else output.push(entryPath);
  }
  return output;
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error || !port ? reject(error || new Error("无法分配测试端口。")) : resolve(port));
    });
    server.on("error", reject);
  });
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 2_000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`冒烟请求返回 HTTP ${response.statusCode}：${body.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("冒烟请求没有返回有效 JSON。"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("请求超时。")));
    request.on("error", reject);
  });
}

async function waitForApi(url, child) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`打包服务提前退出，code=${child.exitCode}。`);
    try {
      return await requestJson(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("打包服务在 30 秒内没有响应。");
}

function waitForExit(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      if (child.exitCode === 0) resolve();
      else reject(new Error(`桌面入口退出异常（code=${child.exitCode}）。`));
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error("桌面入口冒烟测试超时。"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`桌面入口退出异常（code=${code}, signal=${signal || "none"}）。`));
    });
  });
}

async function main() {
  assert(["darwin", "win32"].includes(process.platform), "请在 Windows 或 macOS 验证桌面包。");
  assert(existsSync(appPath), `缺少应用：${appPath}`);
  assert(existsSync(executablePath), `缺少可执行文件：${executablePath}`);
  assert(existsSync(path.join(productDirectory, "用户数据", "请保留此文件夹.txt")), "缺少便携用户数据目录说明。");
  assert(existsSync(path.join(productDirectory, "安装与卸载说明.txt")), "缺少安装与卸载说明。");
  assert(existsSync(path.join(serverRoot, "server.js")), "应用包内缺少 Next.js 服务。");
  assert(existsSync(path.join(resourcesRoot, "preload.cjs")), "应用包内缺少桌面退出桥接脚本。");
  assert(existsSync(path.join(resourcesRoot, "server-entry.mjs")), "应用包内缺少服务退出桥接脚本。");
  assert(existsSync(path.join(resourcesRoot, "portable-paths.mjs")), "应用包内缺少跨平台目录模块。");
  assert(existsSync(path.join(serverRoot, "drizzle")), "应用包内缺少数据库迁移。");
  assert(existsSync(path.join(serverRoot, "public", "使用手册", "AI酒馆操作手册.md")), "应用包内缺少操作手册。");
  const desktopEntry = readFileSync(path.join(resourcesRoot, "main.mjs"), "utf8");
  assert(desktopEntry.includes("utilityProcess.fork("), "桌面入口没有使用无界面后台服务进程。");
  assert(!desktopEntry.includes("spawn(process.execPath"), "桌面入口仍会用主应用可执行文件启动本地服务，可能产生第二个 Dock 图标。");
  if (process.platform === "darwin") execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "pipe",
  });

  const files = walk(productDirectory);
  const forbidden = files.filter((filePath) => {
    const relative = path.relative(productDirectory, filePath);
    return (
      relative.includes(`测试资料${path.sep}`) ||
      /(^|[/\\])\.env(?:\.|$)/.test(relative) ||
      /\.(?:sqlite|db)(?:-(?:wal|shm))?$/i.test(relative) ||
      ["api-configs.json", "模型.env"].includes(path.basename(filePath)) ||
      relative.includes("霜火人间")
    );
  });
  assert(forbidden.length === 0, `安装包包含禁止内容：\n${forbidden.join("\n")}`);

  const currentEnvPath = path.join(projectRoot, ".env.local");
  if (existsSync(currentEnvPath)) {
    const secret = readFileSync(currentEnvPath, "utf8")
      .split(/\r?\n/)
      .find((line) => /^\s*AI_API_KEY\s*=/.test(line))
      ?.replace(/^\s*AI_API_KEY\s*=\s*/, "")
      .replace(/^"|"$/g, "")
      .trim();
    if (secret && secret.length >= 8) {
      for (const filePath of files) {
        const stat = statSync(filePath);
        if (!stat.isFile()) continue;
        if (stat.size > 5 * 1024 * 1024) continue;
        const content = readFileSync(filePath);
        assert(!content.includes(Buffer.from(secret)), `安装包泄露了当前 API Key：${path.relative(productDirectory, filePath)}`);
      }
    }
  }

  const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "ai-tavern-package-check-"));
  const port = await getAvailablePort();
  const stdout = [];
  const child = spawn(executablePath, [path.join(serverRoot, "server.js")], {
    cwd: serverRoot,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      AI_TAVERN_DATA_DIR: path.join(runtimeRoot, "数据"),
      AI_TAVERN_CONFIG_FILE: path.join(runtimeRoot, "配置", "模型.env"),
      AI_TAVERN_MIGRATIONS_DIR: path.join(serverRoot, "drizzle"),
      AI_PROVIDER: "deepseek",
      AI_API_BASE_URL: "https://api.deepseek.com",
      AI_API_KEY: "",
      AI_MODEL: "deepseek-chat",
      AI_JSON_MODE: "response_format",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stdout.push(chunk.toString()));
  child.once("error", (error) => stdout.push(error.message));
  try {
    const body = await waitForApi(`http://127.0.0.1:${port}/api/adventures`, child);
    assert(Array.isArray(body.adventures), "打包后的剧本列表接口格式无效。");
    assert(body.adventures.length === 0, "空白安装包不应自带测试剧本。");
    assert(existsSync(path.join(runtimeRoot, "数据", "ai-tavern.sqlite")), "打包服务没有在指定便携目录创建数据库。");
  } catch (error) {
    throw new Error(`${error.message}\n服务输出：\n${stdout.join("").slice(-4_000)}`);
  } finally {
    await stopChild(child);
    cleanTemporaryDirectory(runtimeRoot);
  }

  const desktopRuntimeRoot = mkdtempSync(path.join(os.tmpdir(), "ai-tavern 中文 空格 check-"));
  // On Windows, exercise the default root next to the EXE after relocation.
  const desktopExecutable = process.platform === "win32"
    ? path.join(desktopRuntimeRoot, "AI酒馆.exe") : executablePath;
  if (process.platform === "win32") cpSync(productDirectory, desktopRuntimeRoot, { recursive: true });
  const desktopOutput = [];
  const desktopEnv = { ...process.env, AI_TAVERN_DESKTOP_SMOKE: "1" };
  delete desktopEnv.ELECTRON_RUN_AS_NODE;
  delete desktopEnv.AI_TAVERN_PORTABLE_ROOT;
  if (process.platform !== "win32") desktopEnv.AI_TAVERN_PORTABLE_ROOT = desktopRuntimeRoot;
  const desktopChild = spawn(desktopExecutable, [], {
    windowsHide: true,
    env: {
      ...desktopEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  desktopChild.stdout.on("data", (chunk) => desktopOutput.push(chunk.toString()));
  desktopChild.stderr.on("data", (chunk) => desktopOutput.push(chunk.toString()));
  try {
    await waitForExit(desktopChild);
    const desktopLogPath = path.join(desktopRuntimeRoot, "用户数据", "日志", "桌面端.log");
    assert(existsSync(desktopLogPath), "桌面入口没有在便携目录生成日志。");
    const desktopLog = readFileSync(desktopLogPath, "utf8");
    assert(desktopLog.includes("桌面应用启动"), "桌面入口没有完成启动记录。");
    assert(desktopLog.includes("桌面窗口已加载"), "桌面窗口没有成功加载。");
    assert(!desktopLog.includes("启动失败"), "桌面启动日志报告失败。");
    assert(desktopLog.includes("桌面应用退出"), "桌面入口没有完成退出记录。");
    const dataRoot = path.join(desktopRuntimeRoot, "用户数据", "数据");
    assert(existsSync(path.join(dataRoot, "ai-tavern.sqlite")), "桌面窗口没有在便携目录创建数据库。");
    assert(readdirSync(path.join(dataRoot, "backups")).some((name) => name.includes("shutdown")), "桌面退出时没有创建 SQLite 备份。");
    const origin = desktopLog.match(/本地服务已就绪：(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    assert(origin, "缺少本地服务地址记录。");
    const stillListening = await new Promise((resolve, reject) => {
      const socket = net.connect(Number(new URL(origin).port), "127.0.0.1");
      socket.setTimeout(2_000);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", (error) => {
        if (error.code === "ECONNREFUSED") resolve(false);
        else reject(error);
      });
      socket.once("timeout", () => { socket.destroy(); reject(new Error("检查退出端口超时。")); });
    });
    assert(!stillListening, "桌面退出后本地服务仍在监听。");
  } catch (error) {
    throw new Error(`${error.message}\n桌面进程输出：\n${desktopOutput.join("").slice(-4_000)}`);
  } finally {
    await stopChild(desktopChild);
    cleanTemporaryDirectory(desktopRuntimeRoot);
  }

  process.stdout.write(`${platformName} 桌面包验证通过：结构完整、无测试数据/API Key，空库服务与桌面窗口均可启动，退出备份与服务清理通过。\n`);
}

main().catch((error) => {
  console.error(`${platformName} 桌面包验证失败：`, error);
  process.exitCode = 1;
});
