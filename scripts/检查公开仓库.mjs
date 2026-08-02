import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkHistory = process.argv.includes("--history");
const requestedRef = process.argv.find((argument) => argument.startsWith("--ref="))?.slice(6).trim();
const targetRef = requestedRef || "HEAD";
const problems = new Set();

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function splitNull(value) {
  return value.split("\0").filter(Boolean);
}

function forbiddenPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (/^(?:data|用户数据|测试资料|桌面构建|发布)\//.test(normalized)) return true;
  if (/^\.env(?:\.|$)/.test(normalized) && normalized !== ".env.example") return true;
  if (/\.(?:sqlite(?:-(?:wal|shm))?|db(?:-(?:wal|shm))?|dmg|zip|log)$/i.test(normalized)) return true;
  if (/(?:^|\/)(?:完整存档_|ai-tavern-archive-)[^/]*\.json$/i.test(normalized)) return true;
  if (normalized === "tests/外传第一部资料.test.mjs") return true;
  if (normalized === "scripts/生成霜火人间剧本包.mjs") return true;
  return false;
}

function inspectPaths(paths, label) {
  for (const filePath of paths) {
    if (forbiddenPath(filePath)) problems.add(`${label}包含本地专用文件：${filePath}`);
  }
}

const trackedFiles = requestedRef
  ? splitNull(runGit(["ls-tree", "-r", "--name-only", "-z", targetRef]))
  : splitNull(runGit(["ls-files", "-z"]));
inspectPaths(trackedFiles, "当前提交");

const secretPatterns = [
  { name: "sk- API 密钥", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "GitHub 访问令牌", pattern: /\bgh[opusr]_[A-Za-z0-9]{20,}\b/ },
  { name: "Google API 密钥", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: "AWS Access Key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "私钥正文", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

for (const filePath of trackedFiles) {
  let content;
  if (requestedRef) {
    const size = Number(runGit(["cat-file", "-s", `${targetRef}:${filePath}`]).trim());
    if (!Number.isFinite(size) || size > 2 * 1024 * 1024) continue;
    content = execFileSync("git", ["show", `${targetRef}:${filePath}`], {
      cwd: projectRoot,
      encoding: "buffer",
      maxBuffer: 4 * 1024 * 1024,
    });
  } else {
    const absolutePath = path.join(projectRoot, filePath);
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
    content = readFileSync(absolutePath);
  }
  if (content.includes(0)) continue;
  const text = content.toString("utf8");
  for (const detector of secretPatterns) {
    if (detector.pattern.test(text)) {
      problems.add(`当前提交疑似包含${detector.name}：${filePath}`);
    }
  }
}

if (checkHistory) {
  const commits = runGit(["rev-list", targetRef]).trim().split("\n").filter(Boolean);
  for (const commit of commits) {
    const files = splitNull(runGit(["ls-tree", "-r", "--name-only", "-z", commit]));
    inspectPaths(files, `历史提交 ${commit.slice(0, 12)} `);
  }

  const combinedPattern = "sk-[A-Za-z0-9_-]{20,}|gh[opusr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY";
  for (const commit of commits) {
    const result = spawnSync(
      "git",
      ["grep", "-Il", "-E", combinedPattern, commit, "--", "."],
      { cwd: projectRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.status !== 0 && result.status !== 1) {
      problems.add(`无法扫描历史提交 ${commit.slice(0, 12)} 的密钥模式。`);
      continue;
    }
    for (const match of result.stdout.trim().split("\n").filter(Boolean)) {
      problems.add(`历史记录疑似包含密钥：${match}`);
    }
  }
}

if (problems.size > 0) {
  process.stderr.write(`公开仓库检查失败：\n- ${[...problems].join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    checkHistory
      ? `公开仓库检查通过：${targetRef} 的当前提交与分支历史均未发现本地存档、测试资料或常见密钥。\n`
      : `公开仓库检查通过：${targetRef} 的当前提交未发现本地存档、测试资料或常见密钥。\n`,
  );
}
