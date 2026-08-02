import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
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
const defaultProductDirectory = path.join(
  projectRoot,
  "发布",
  `AI酒馆-${packageJson.version}-macOS-${process.arch}`,
  "AI酒馆",
);
const productDirectory = path.resolve(process.argv[2] || defaultProductDirectory);
const appPath = path.join(productDirectory, "AI酒馆.app");
const resourcesRoot = path.join(appPath, "Contents", "Resources", "app");
const serverRoot = path.join(resourcesRoot, "server");
const executablePath = path.join(appPath, "Contents", "MacOS", "AI酒馆");

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
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
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
  assert(process.platform === "darwin", "桌面包验证脚本只能在 macOS 运行。");
  assert(existsSync(appPath), `缺少应用：${appPath}`);
  assert(existsSync(path.join(productDirectory, "用户数据", "请保留此文件夹.txt")), "缺少便携用户数据目录说明。");
  assert(existsSync(path.join(productDirectory, "安装与卸载说明.txt")), "缺少安装与卸载说明。");
  assert(existsSync(path.join(serverRoot, "server.js")), "应用包内缺少 Next.js 服务。");
  assert(existsSync(path.join(resourcesRoot, "preload.cjs")), "应用包内缺少桌面退出桥接脚本。");
  assert(existsSync(path.join(serverRoot, "drizzle")), "应用包内缺少数据库迁移。");
  assert(existsSync(path.join(serverRoot, "public", "使用手册", "AI酒馆操作手册.md")), "应用包内缺少操作手册。");
  const desktopEntry = readFileSync(path.join(resourcesRoot, "main.mjs"), "utf8");
  assert(desktopEntry.includes("utilityProcess.fork("), "桌面入口没有使用无界面后台服务进程。");
  assert(!desktopEntry.includes("spawn(process.execPath"), "桌面入口仍会用主应用可执行文件启动本地服务，可能产生第二个 Dock 图标。");
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "pipe",
  });

  const files = walk(productDirectory);
  const forbidden = files.filter((filePath) => {
    const relative = path.relative(productDirectory, filePath);
    return (
      relative.includes(`测试资料${path.sep}`) ||
      /(^|[/\\])\.env(?:\.|$)/.test(relative) ||
      /\.sqlite(?:-(?:wal|shm))?$/i.test(relative) ||
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
  try {
    const body = await waitForApi(`http://127.0.0.1:${port}/api/adventures`, child);
    assert(Array.isArray(body.adventures), "打包后的剧本列表接口格式无效。");
    assert(body.adventures.length === 0, "空白安装包不应自带测试剧本。");
    assert(existsSync(path.join(runtimeRoot, "数据", "ai-tavern.sqlite")), "打包服务没有在指定便携目录创建数据库。");
  } catch (error) {
    throw new Error(`${error.message}\n服务输出：\n${stdout.join("").slice(-4_000)}`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(runtimeRoot, { recursive: true, force: true });
  }

  const desktopRuntimeRoot = mkdtempSync(path.join(os.tmpdir(), "ai-tavern-desktop-check-"));
  const desktopOutput = [];
  const desktopChild = spawn(executablePath, [], {
    env: {
      ...process.env,
      AI_TAVERN_PORTABLE_ROOT: desktopRuntimeRoot,
      AI_TAVERN_DESKTOP_SMOKE: "1",
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
    assert(desktopLog.includes("桌面应用退出"), "桌面入口没有完成退出记录。");
  } catch (error) {
    throw new Error(`${error.message}\n桌面进程输出：\n${desktopOutput.join("").slice(-4_000)}`);
  } finally {
    if (desktopChild.exitCode === null) desktopChild.kill("SIGKILL");
    rmSync(desktopRuntimeRoot, { recursive: true, force: true });
  }

  process.stdout.write("macOS 桌面包验证通过：结构完整、无测试数据/API Key，空库服务与桌面窗口均可启动。\n");
}

main().catch((error) => {
  console.error("macOS 桌面包验证失败：", error);
  process.exitCode = 1;
});
