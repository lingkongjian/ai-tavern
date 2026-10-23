import { app, BrowserWindow, dialog, ipcMain, session, utilityProcess } from "electron";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePortableRoot } from "./portable-paths.mjs";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));

app.setName("AI酒馆");
process.umask(0o077);

function portableRoot() {
  return resolvePortableRoot({
    platform: process.platform,
    packaged: app.isPackaged,
    executable: app.getPath("exe"),
    desktopDirectory,
    override: process.env.AI_TAVERN_PORTABLE_ROOT,
  });
}

const rootDirectory = portableRoot();
const userDataDirectory = path.join(rootDirectory, "用户数据");
const directories = {
  database: path.join(userDataDirectory, "数据"),
  configuration: path.join(userDataDirectory, "配置"),
  logs: path.join(userDataDirectory, "日志"),
  browser: path.join(userDataDirectory, "浏览器数据"),
  crashes: path.join(userDataDirectory, "崩溃报告"),
  temporary: path.join(userDataDirectory, "临时文件"),
};

let preparationError = null;
try {
  for (const directory of Object.values(directories)) {
    mkdirSync(directory, { recursive: true });
  }
  const probePath = path.join(userDataDirectory, `.写入测试-${process.pid}`);
  writeFileSync(probePath, "ok", { mode: 0o600 });
  unlinkSync(probePath);

  app.setPath("userData", directories.browser);
  app.setPath("sessionData", directories.browser);
  app.setPath("logs", directories.logs);
  app.setPath("crashDumps", directories.crashes);
  app.setPath("temp", directories.temporary);
  app.commandLine.appendSwitch("disk-cache-dir", path.join(directories.browser, "缓存"));
  // 便携版不能在 macOS Keychain 留下 Chromium 的单独加密条目。
  // 模型密钥由权限为 0600 的本地配置文件管理。
  if (process.platform === "darwin") app.commandLine.appendSwitch("use-mock-keychain");
} catch (error) {
  preparationError = error;
}

const mainLogPath = path.join(directories.logs, "桌面端.log");
let logStream = null;
function log(message, error) {
  try {
    if (!logStream) logStream = createWriteStream(mainLogPath, { flags: "a", mode: 0o600 });
    const detail = error instanceof Error ? `\n${error.stack || error.message}` : "";
    logStream.write(`[${new Date().toISOString()}] ${message}${detail}\n`);
  } catch {
    // 日志目录本身不可写时，只能依靠启动错误对话框报告。
  }
}

function decodeDotEnvValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function readModelEnvironment(filePath) {
  if (!existsSync(filePath)) return {};
  const allowed = new Set([
    "AI_PROVIDER",
    "AI_API_BASE_URL",
    "AI_API_KEY",
    "AI_MODEL",
    "AI_JSON_MODE",
  ]);
  const values = {};
  for (const line of readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match && allowed.has(match[1])) values[match[1]] = decodeDotEnvValue(match[2]);
  }
  return values;
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error || !port ? reject(error || new Error("无法分配本地端口。")) : resolve(port)));
    });
  });
}

function waitForServer(url, child, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.once("exit", (code, signal) => fail(new Error(`本地服务提前退出（code=${code}, signal=${signal || "none"}）。`)));

    const probe = () => {
      if (settled) return;
      const request = http.get(url, { timeout: 1_500 }, (response) => {
        response.resume();
        if ((response.statusCode || 500) < 500) {
          settled = true;
          resolve();
          return;
        }
        retry();
      });
      request.on("timeout", () => request.destroy());
      request.on("error", retry);
    };
    const retry = () => {
      if (settled) return;
      if (Date.now() - startedAt >= timeoutMs) {
        fail(new Error("本地服务在 30 秒内没有完成启动。"));
        return;
      }
      setTimeout(probe, 250);
    };
    probe();
  });
}

let mainWindow = null;
let serverProcess = null;
let serverOrigin = null;
let quitting = false;

async function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.postMessage("ai-tavern:shutdown");
  });
}

async function startServer() {
  const serverRoot = app.isPackaged
    ? path.join(app.getAppPath(), "server")
    : path.resolve(desktopDirectory, "..", ".next", "standalone");
  const serverFile = path.join(serverRoot, "server.js");
  if (!existsSync(serverFile)) {
    throw new Error(`缺少桌面端服务文件：${serverFile}`);
  }

  const port = await findAvailablePort();
  const configFile = path.join(directories.configuration, "模型.env");
  serverOrigin = `http://127.0.0.1:${port}`;
  const serverLog = createWriteStream(path.join(directories.logs, "本地服务.log"), {
    flags: "a",
    mode: 0o600,
  });
  serverProcess = utilityProcess.fork(path.join(desktopDirectory, "server-entry.mjs"), [], {
    cwd: serverRoot,
    env: {
      ...process.env,
      ...readModelEnvironment(configFile),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      AI_TAVERN_DESKTOP: "1",
      AI_TAVERN_DATA_DIR: directories.database,
      AI_TAVERN_CONFIG_FILE: configFile,
      AI_TAVERN_MIGRATIONS_DIR: path.join(serverRoot, "drizzle"),
    },
    stdio: "pipe",
    serviceName: "AI酒馆本地服务",
  });
  serverProcess.stdout?.pipe(serverLog, { end: false });
  serverProcess.stderr?.pipe(serverLog, { end: false });
  serverProcess.once("error", (error) => {
    const detail = error instanceof Error
      ? error
      : new Error(`${error?.type || "unknown"}${error?.location ? ` @ ${error.location}` : ""}`);
    log("本地服务进程错误。", detail);
  });
  serverProcess.once("exit", (code) => {
    serverProcess = null;
    serverLog.end(`\n[${new Date().toISOString()}] 服务退出 code=${code}\n`);
    if (!quitting && mainWindow) {
      dialog.showErrorBox("AI酒馆服务已停止", `本地服务意外停止。请查看：\n${path.join(directories.logs, "本地服务.log")}`);
      app.quit();
    }
  });
  await waitForServer(serverOrigin, serverProcess);
  log(`本地服务已就绪：${serverOrigin}`);
}

async function createWindow() {
  const smokeTest = process.env.AI_TAVERN_DESKTOP_SMOKE === "1";
  mainWindow = new BrowserWindow({
    title: "AI酒馆",
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: "#0f172a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: process.env.AI_TAVERN_DESKTOP_DEBUG === "1",
      preload: path.join(desktopDirectory, "preload.cjs"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!serverOrigin || !targetUrl.startsWith(`${serverOrigin}/`)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => {
    if (!smokeTest) mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(serverOrigin);
  log("桌面窗口已加载。");
  if (smokeTest) {
    const ready = await mainWindow.webContents.executeJavaScript(`
      fetch('/api/adventures').then(async (response) => {
        const body = await response.json();
        return response.ok && Array.isArray(body.adventures) && typeof window.aiTavernDesktop?.quit === 'function';
      })
    `);
    if (!ready) throw new Error("桌面 API 或退出桥接验证失败。");
    await mainWindow.webContents.executeJavaScript("window.aiTavernDesktop.quit()");
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void stopServer().finally(() => {
    log("桌面应用退出。用户数据目录：" + userDataDirectory);
    logStream?.end();
    app.quit();
  });
});
app.on("window-all-closed", () => app.quit());
ipcMain.on("ai-tavern:quit", () => app.quit());

app.whenReady().then(async () => {
  if (!hasLock || quitting) return;
  if (preparationError) {
    dialog.showErrorBox(
      "无法建立用户数据目录",
      `请先把整个“AI酒馆”文件夹解压或复制到个人可写目录，不要直接从 ZIP、只读镜像或 Program Files 运行。\n\n目标目录：${userDataDirectory}\n\n${preparationError.message || preparationError}`,
    );
    app.quit();
    return;
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  try {
    log("桌面应用启动。用户数据目录：" + userDataDirectory);
    await startServer();
    await createWindow();
  } catch (error) {
    log("桌面应用启动失败。", error);
    dialog.showErrorBox(
      "AI酒馆启动失败",
      `${error instanceof Error ? error.message : String(error)}\n\n日志目录：${directories.logs}`,
    );
    app.quit();
  }
});

process.on("uncaughtException", (error) => log("桌面主进程发生未捕获异常。", error));
process.on("unhandledRejection", (error) => log("桌面主进程发生未处理拒绝。", error));
process.on("SIGTERM", () => app.quit());
process.on("SIGINT", () => app.quit());
