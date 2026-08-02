// GitHub Release 发版脚本
//
// 用法：
//   node 发布GitHubRelease.mjs                     # 默认使用 docs/release-说明-v<版本>.md，缺失时用内置模板
//   node 发布GitHubRelease.mjs --body-file <文件>   # 指定说明文件（推荐，便于维护文案）
//   node 发布GitHubRelease.mjs --skip-verify        # 跳过桌面包敏感信息验证
//   node 发布GitHubRelease.mjs --force-assets       # 资产已存在时删除后重新上传
//   node 发布GitHubRelease.mjs --dry-run            # 只检查产物与凭据，不执行网络操作
//
// 前置条件：
//   1. 已构建桌面包（发布/AI酒馆-<版本>-macOS-arm64/）
//   2. macOS 钥匙串已保存 github.com 凭据（security add-internet-password -a <用户名> -s github.com -r htps -w <token>）
//   3. 远端 main 已推送
//
// 说明维护：
//   每次发版前，把更新内容写进 docs/release-说明-v<版本>.md（示例见 docs/release-说明-v0.1.11.md），
//   并同步更新仓库 README 与 GITHUB_PUBLICATION.md 中的相关文案。GitHub 资产名使用英文
//   （AI-Tavern-<版本>-...），因为 GitHub upload API 不支持中文文件名。

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
);
const version = packageJson.version;
const productDirectory = resolve(
  projectRoot,
  "发布",
  `AI酒馆-${version}-macOS-${process.arch}`,
);

const args = process.argv.slice(2);
const options = {
  bodyFile: readArgument(args, "--body-file"),
  skipVerify: args.includes("--skip-verify"),
  forceAssets: args.includes("--force-assets"),
  dryRun: args.includes("--dry-run"),
};

function readArgument(argumentsList, name) {
  const index = argumentsList.indexOf(name);
  if (index === -1 || index + 1 >= argumentsList.length) return undefined;
  return argumentsList[index + 1];
}

function fail(message) {
  console.error(`发布失败：${message}`);
  process.exit(1);
}

function remoteOwnerAndRepo() {
  const output = execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
    cwd: projectRoot,
  }).trim();
  const match = output.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) fail(`无法从 origin 解析 GitHub 仓库地址：${output}`);
  return { owner: match[1], repo: match[2] };
}

function readKeychainToken() {
  try {
    return execFileSync("security", [
      "find-internet-password",
      "-s",
      "github.com",
      "-w",
    ], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function assetNames() {
  const candidates = ["AI酒馆", "AI-Tavern"].map(
    (prefix) => `${prefix}-${version}-macOS-${process.arch}.dmg`,
  );
  const dmg = readdirSync(productDirectory).find((name) => candidates.includes(name))
    ?? fail(`发布目录缺少 DMG：${productDirectory}`);
  return {
    dmg,
    zip: dmg.replace(/\.dmg$/, ".zip"),
  };
}

const TEMPLATE = (currentVersion) => `## AI 酒馆 ${currentVersion}（macOS Apple Silicon）

本地优先、由玩家掌握角色控制权的 AI 互动叙事工具。本包为 macOS arm64 便携桌面包，内置 Next.js 本地服务与 SQLite 数据库。

### 下载与安装
- 资产文件名使用英文（AI-Tavern-${currentVersion}-macOS-arm64.dmg），即本机中文名安装包
- 解压或挂载后，把整个“AI酒馆”文件夹复制到你的程序目录
- 保持 \`AI酒馆.app\` 与 \`用户数据\` 同级（所有运行数据都写入该文件夹）
- 首次启动后，从主菜单进入“API 配置”设置模型供应商（内置 DeepSeek 与 OpenCode Go 预设）

### 本版本更新
- （发版前维护：在 发布/release-说明-v${currentVersion}.md 或脚本 TEMPLATE 中补充本版本更新项）

### 说明
- 本包使用临时签名，仅适合开发测试；如提示未验证开发者，请在“系统设置 → 隐私与安全性”中允许打开
- 数据与 API Key 全部保存在本机“用户数据”目录，退出后删除整个文件夹即可卸载
- 完整源码、使用手册与格式标准见仓库 README`;

async function api(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "ai-tavern-release",
      Accept: "application/vnd.github+json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload?.message
        ? payload.message
        : `HTTP ${response.status}`;
    throw new Error(`GitHub API 请求失败：${message}`);
  }
  return payload;
}

async function main() {
  const { owner, repo } = remoteOwnerAndRepo();
  const tag = `v${version}`;
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const { dmg, zip } = assetNames();

  console.log(`AI 酒馆 ${version} → ${owner}/${repo}（tag ${tag}）`);
  console.log(`  DMG：${dmg}`);
  if (options.dryRun) {
    console.log("--dry-run：检查通过，未执行任何网络操作。");
    return;
  }

  if (!options.skipVerify) {
    console.log("验证桌面包敏感信息……");
    const verify = spawnSync(
      process.execPath,
      [resolve(projectRoot, "scripts", "验证macOS桌面包.mjs")],
      { cwd: projectRoot, stdio: "inherit" },
    );
    if (verify.status !== 0) {
      fail("桌面包验证未通过，已中止发布。");
    }
  }

  const token = readKeychainToken();
  if (!token) {
    fail("钥匙串中没有 github.com 凭据。请先执行：security add-internet-password -a <用户名> -s github.com -r htps -w <token>");
  }

  const bodySource = options.bodyFile
    ? existsSync(resolve(projectRoot, options.bodyFile))
      ? readFileSync(resolve(projectRoot, options.bodyFile), "utf8")
      : fail(`说明文件不存在：${options.bodyFile}`)
    : existsSync(resolve(projectRoot, "docs", `release-说明-v${version}.md`))
      ? readFileSync(
          resolve(projectRoot, "docs", `release-说明-v${version}.md`),
          "utf8",
        )
      : TEMPLATE(version);

  console.log("创建或更新 Release……");
  let release;
  try {
    release = await api(`${base}/releases/tags/${tag}`, token);
    release = await api(`${base}/releases/${release.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        name: `AI酒馆 ${version}（macOS arm64）`,
        body: bodySource,
        draft: false,
      }),
    });
    console.log(`  已更新现有 Release：${release.html_url}`);
  } catch (error) {
    release = await api(`${base}/releases`, token, {
      method: "POST",
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: "main",
        name: `AI酒馆 ${version}（macOS arm64）`,
        body: bodySource,
        draft: false,
        prerelease: false,
      }),
    });
    console.log(`  已创建 Release：${release.html_url}`);
  }

  const existingAssets = await api(
    `${base}/releases/${release.id}/assets`,
    token,
  );
  const uploadBase = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets`;
  for (const [localName, asciiName] of [
    [dmg, `AI-Tavern-${version}-macOS-${process.arch}.dmg`],
    [zip, `AI-Tavern-${version}-macOS-${process.arch}.zip`],
  ]) {
    const localPath = resolve(productDirectory, localName);
    const already = existingAssets.find((asset) => asset.name === asciiName);
    if (already && !options.forceAssets) {
      console.log(`  资产已存在，跳过：${asciiName}`);
      continue;
    }
    if (already && options.forceAssets) {
      await api(
        `${base}/releases/assets/${already.id}`,
        token,
        { method: "DELETE" },
      );
      console.log(`  已删除旧资产：${asciiName}`);
    }
    console.log(`  上传 ${asciiName}……`);
    const content = readFileSync(localPath);
    await api(
      `${uploadBase}?name=${encodeURIComponent(asciiName)}`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: content,
      },
    );
    console.log(`  完成：${asciiName}（${(content.byteLength / 1024 / 1024).toFixed(0)} MB）`);
  }

  console.log("发布完成。");
}

main().catch((error) => {
  console.error("发布失败：", error.message);
  process.exit(1);
});
