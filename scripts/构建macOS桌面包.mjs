import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { arch } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { packager } from "@electron/packager";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const buildRoot = path.join(projectRoot, "桌面构建");
const stageRoot = path.join(buildRoot, "运行目录");
const packagerOutput = path.join(buildRoot, "packager");
const releaseRoot = path.join(projectRoot, "发布");
const releaseName = `AI酒馆-${version}-macOS-${arch}`;
const releaseDirectory = path.join(releaseRoot, releaseName);
const productDirectory = path.join(releaseDirectory, "AI酒馆");
const dmgRoot = path.join(buildRoot, "镜像内容");
const electronVersion = packageJson.devDependencies.electron;

function findElectronZipDirectory() {
  const fileName = `electron-v${electronVersion}-darwin-${arch}.zip`;
  const cacheRoot = path.join(os.homedir(), "Library", "Caches", "electron");
  if (!existsSync(cacheRoot)) return undefined;
  const pending = [cacheRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(path.join(directory, entry.name));
      else if (entry.name === fileName) return directory;
    }
  }
  return undefined;
}

function copyDirectory(source, target) {
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter(sourcePath) {
      const relative = path.relative(source, sourcePath);
      if (!relative) return true;
      const segments = relative.split(path.sep);
      return !segments.some((segment) =>
        segment === "data" ||
        segment === "测试资料" ||
        segment === ".env" ||
        segment.startsWith(".env.") ||
        /\.sqlite(?:-(?:wal|shm))?$/i.test(segment),
      );
    },
  });
}

function containsRuntimeData(directory) {
  if (!existsSync(directory)) return false;
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".DS_Store" || entry.name === "请保留此文件夹.txt") {
        continue;
      }
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
      else return true;
    }
  }
  return false;
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: projectRoot,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.stdout?.trim()) process.stdout.write(`${result.stdout.trim()}\n`);
  if (result.stderr?.trim()) process.stderr.write(`${result.stderr.trim()}\n`);
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("当前脚本只在 macOS 上生成桌面安装包。");
  }
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`不支持的 macOS 架构：${arch}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("package.json version 必须使用 x.y.z 格式。");
  }

  const existingUserDataDirectory = path.join(
    releaseDirectory,
    "AI酒馆",
    "用户数据",
  );
  if (containsRuntimeData(existingUserDataDirectory)) {
    throw new Error(
      `检测到已有运行数据，已拒绝覆盖发布目录：${existingUserDataDirectory}\n请先提高 package.json 版本号，或把该目录完整备份到其他位置。`,
    );
  }

  rmSync(buildRoot, { recursive: true, force: true });
  rmSync(releaseDirectory, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });
  mkdirSync(productDirectory, { recursive: true });

  process.stdout.write("[1/6] 构建 Next.js 独立生产服务……\n");
  await run(process.execPath, [
    path.join(projectRoot, "node_modules", "next", "dist", "bin", "next"),
    "build",
    "--webpack",
  ], {
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      // 防止 Next.js 在构建阶段从开发者的 .env.local 取得真实凭据。
      AI_PROVIDER: "deepseek",
      AI_API_BASE_URL: "https://api.deepseek.com",
      AI_API_KEY: "",
      AI_MODEL: "deepseek-chat",
      AI_JSON_MODE: "response_format",
    },
  });

  const standaloneRoot = path.join(projectRoot, ".next", "standalone");
  if (!existsSync(path.join(standaloneRoot, "server.js"))) {
    throw new Error("Next.js 没有生成 .next/standalone/server.js。");
  }

  process.stdout.write("[2/6] 组装不含本地数据的桌面运行目录……\n");
  copyDirectory(standaloneRoot, path.join(stageRoot, "server"));
  copyDirectory(path.join(projectRoot, ".next", "static"), path.join(stageRoot, "server", ".next", "static"));
  copyDirectory(path.join(projectRoot, "public"), path.join(stageRoot, "server", "public"));
  copyDirectory(path.join(projectRoot, "drizzle"), path.join(stageRoot, "server", "drizzle"));
  cpSync(path.join(projectRoot, "desktop", "main.mjs"), path.join(stageRoot, "main.mjs"));
  cpSync(path.join(projectRoot, "desktop", "preload.cjs"), path.join(stageRoot, "preload.cjs"));
  writeFileSync(
    path.join(stageRoot, "package.json"),
    `${JSON.stringify({
      name: "ai-tavern-desktop-runtime",
      version,
      private: true,
      type: "module",
      main: "main.mjs",
    }, null, 2)}\n`,
  );

  process.stdout.write("[3/6] 生成 AI酒馆.app……\n");
  const electronZipDir = findElectronZipDirectory();
  const appPaths = await packager({
    dir: stageRoot,
    out: packagerOutput,
    name: "AI酒馆",
    appVersion: version,
    buildVersion: version,
    appBundleId: "local.ai-tavern.desktop",
    platform: "darwin",
    arch,
    electronVersion,
    ...(electronZipDir ? { electronZipDir } : {}),
    overwrite: true,
    prune: true,
    asar: false,
    extendInfo: {
      CFBundleDisplayName: "AI酒馆",
      CFBundleName: "AI酒馆",
      LSApplicationCategoryType: "public.app-category.games",
      NSHumanReadableCopyright: "AI 酒馆项目",
    },
  });
  if (appPaths.length !== 1) throw new Error("Electron 打包结果数量异常。");
  const appPath = path.join(productDirectory, "AI酒馆.app");
  const packagedAppPath = path.join(appPaths[0], "AI酒馆.app");
  if (!existsSync(packagedAppPath)) {
    throw new Error(`Electron 打包结果缺少应用：${packagedAppPath}`);
  }
  cpSync(packagedAppPath, appPath, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  });

  process.stdout.write("[4/6] 建立便携用户数据目录并执行临时签名……\n");
  const userDataPath = path.join(productDirectory, "用户数据");
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(
    path.join(userDataPath, "请保留此文件夹.txt"),
    [
      "AI 酒馆会在首次启动时把数据库、备份、模型配置、浏览器缓存和日志建立在本文件夹内。",
      "卸载时请退出 AI 酒馆，然后删除外层的整个“AI酒馆”文件夹。",
      "不要只移动 AI酒馆.app；应用与本文件夹需要始终保持在同一外层目录中。",
      "本安装包没有附带测试剧本、本地数据库或任何玩家 API Key。",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(productDirectory, "安装与卸载说明.txt"),
    [
      "安装：把整个“AI酒馆”文件夹拖到“应用程序”或其他可写位置，再双击其中的 AI酒馆.app。",
      "不要直接在只读安装镜像中运行，也不要只复制 .app 文件。",
      "首次打开未签名开发包时，若 macOS 阻止运行，请在“系统设置 → 隐私与安全性”中确认打开。",
      "卸载：先退出 AI 酒馆，再删除整个“AI酒馆”文件夹；程序不会主动在系统用户目录保存运行数据。",
      "升级：退出旧版本，备份旧文件夹中的“用户数据”，再用新版本的 .app 替换旧 .app；保留原“用户数据”目录。",
      "",
    ].join("\n"),
  );
  await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);

  process.stdout.write("[5/6] 生成 ZIP 与 DMG……\n");
  const zipPath = path.join(releaseDirectory, `${releaseName}.zip`);
  await run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", productDirectory, zipPath]);
  mkdirSync(dmgRoot, { recursive: true });
  cpSync(productDirectory, path.join(dmgRoot, "AI酒馆"), {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  });
  writeFileSync(
    path.join(dmgRoot, "请复制整个AI酒馆文件夹.txt"),
    "请把整个“AI酒馆”文件夹复制到“应用程序”或其他可写位置后再运行。\n",
  );
  const dmgPath = path.join(releaseDirectory, `${releaseName}.dmg`);
  await run("/usr/bin/hdiutil", [
    "create",
    "-volname",
    "AI酒馆",
    "-srcfolder",
    dmgRoot,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ]);

  process.stdout.write("[6/6] 验证安装包结构和本地服务……\n");
  await run(process.execPath, [path.join(projectRoot, "scripts", "验证macOS桌面包.mjs"), productDirectory]);
  process.stdout.write(`\n桌面包已生成：\n${releaseDirectory}\n`);
}

main().catch((error) => {
  console.error("macOS 桌面包构建失败：", error);
  process.exitCode = 1;
});
