#!/usr/bin/env node

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleBundleProject,
  BundleProjectError,
  writeBundleProject,
} from "../lib/import/剧本包项目.ts";

const usage = `
AI 酒馆剧本包构建器

用法：
  node scripts/构建剧本包.mjs <项目目录或开局预设.json>
  node scripts/构建剧本包.mjs <项目目录> --check

选项：
  --check          只校验，不写入剧本包和报告
  --output <文件>  覆盖完整剧本包输出位置
  --report <文件>  覆盖校验报告输出位置
  --help           显示帮助
`;

function readArguments(args) {
  const options = {
    checkOnly: false,
    input: "",
    outputPath: "",
    reportPath: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.checkOnly = true;
    } else if (argument === "--help" || argument === "-h") {
      return { ...options, help: true };
    } else if (argument === "--output" || argument === "--report") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new BundleProjectError([`${argument} 后必须提供文件路径。`]);
      }
      if (argument === "--output") options.outputPath = value;
      else options.reportPath = value;
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new BundleProjectError([`未知选项：${argument}`]);
    } else if (options.input) {
      throw new BundleProjectError(["只能指定一个项目目录或开局预设文件。"]);
    } else {
      options.input = argument;
    }
  }
  return options;
}

async function manifestPathFromInput(input) {
  const candidate = resolve(input);
  try {
    const information = await stat(candidate);
    return information.isDirectory()
      ? resolve(candidate, "开局预设.json")
      : candidate;
  } catch {
    return candidate;
  }
}

export async function runBundleBuilderCli(args = process.argv.slice(2)) {
  const options = readArguments(args);
  if (options.help) {
    console.log(usage.trim());
    return null;
  }
  if (!options.input) {
    throw new BundleProjectError([
      "缺少项目目录或开局预设.json。使用 --help 查看用法。",
    ]);
  }

  const manifestPath = await manifestPathFromInput(options.input);
  const project = await assembleBundleProject(manifestPath, {
    ...(options.outputPath ? { outputPath: options.outputPath } : {}),
    ...(options.reportPath ? { reportPath: options.reportPath } : {}),
  });
  if (!options.checkOnly) await writeBundleProject(project);

  const { report } = project;
  console.log(
    options.checkOnly ? "剧本包项目校验通过。" : "剧本包构建完成。",
  );
  console.log(`名称：${report.bundleName}（${report.bundleVersion}）`);
  console.log(
    `资料：${report.counts.characters} 名角色、${report.counts.worldBookEntries} 条世界书、${report.counts.referenceDocuments} 份原文、${report.counts.storyModules} 个剧情任务`,
  );
  console.log(`SHA-256：${report.sha256}`);
  if (!options.checkOnly) {
    console.log(`输出：${project.outputPath}`);
    console.log(`报告：${project.reportPath}`);
  }
  if (report.warnings.length > 0) {
    console.log("兼容提示：");
    report.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
  return project;
}

const directEntry = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (directEntry) {
  try {
    await runBundleBuilderCli();
  } catch (error) {
    const issues =
      error instanceof BundleProjectError
        ? error.issues
        : [error instanceof Error ? error.message : "未知错误"];
    console.error("剧本包构建失败：");
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
  }
}
