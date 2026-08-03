import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("剧本内容编辑统一进入七栏目工作台", async () => {
  const [interfaceSource, styles] = await Promise.all([
    readProjectFile("app/game/[sessionId]/游戏界面.tsx"),
    readProjectFile("app/globals.css"),
  ]);

  assert.match(
    interfaceSource,
    /useState<StoryWorkbenchTab \| null>/,
    "工作台应由单一活动栏目状态控制",
  );
  assert.match(interfaceSource, />\s*编辑剧本\s*</);
  assert.match(interfaceSource, /aria-label="剧本工作台栏目"/);

  for (const tabId of [
    "characters",
    "locations",
    "story_modules",
    "world_book",
    "sources",
    "memories",
    "state_audit",
  ]) {
    assert.match(interfaceSource, new RegExp(`id: "${tabId}"`));
    assert.match(interfaceSource, new RegExp(`active="${tabId}"`));
  }

  assert.match(interfaceSource, /href="\/manual"/);
  assert.match(
    interfaceSource,
    /\/api\/adventures\/\$\{adventure\.session\.id\}\/content/,
  );
  assert.doesNotMatch(
    interfaceSource,
    /\/api\/adventures\/\$\{adventure\.session\.id\}\/(characters|locations|story-modules|world-book|sources|memories)/,
  );
  assert.match(styles, /\.story-workbench-navigation/);
  assert.match(styles, /@media \(max-width: 580px\)[\s\S]*\.story-workbench/);
});

test("模型设置支持目录读取、OpenCode Go 分类和分项可用性审核", async () => {
  const [
    home,
    provider,
    availability,
    settingsRoute,
    styles,
    catalogSchemaSource,
  ] = await Promise.all([
    readProjectFile("app/酒馆首页.tsx"),
    readProjectFile("lib/ai/模型供应商.ts"),
    readProjectFile("lib/ai/模型可用性.ts"),
    readProjectFile("app/api/settings/ai/route.ts"),
    readProjectFile("app/globals.css"),
    readProjectFile("public/文件标准/模型目录清单.schema.json"),
  ]);
  const catalogSchema = JSON.parse(catalogSchemaSource);

  assert.match(provider, /id: "opencode_go"/);
  assert.match(provider, /https:\/\/opencode\.ai\/zen\/go\/v1\/chat\/completions/);
  assert.match(availability, /modelCatalogEndpoint/);
  assert.match(availability, /unsupported_protocol/);
  assert.match(settingsRoute, /discover_models/);
  assert.match(settingsRoute, /auditAiProvider/);
  assert.match(settingsRoute, /export async function DELETE/);
  assert.match(settingsRoute, /saveAiProfile/);
  assert.match(settingsRoute, /switch_profile/);
  for (const label of ["读取模型", "审核可用性", "导出 JSON", "已审核可用", "新建配置", "另存为新 API"]) {
    assert.match(home, new RegExp(label));
  }
  for (const label of ["已配置 API", "删除已配置 API", "正在使用", "使用中"]) {
    assert.match(home, new RegExp(label));
  }
  assert.match(home, /aiProviderTypeLabel/);
  assert.match(home, /ai_tavern_model_catalog_v1/);
  assert.match(styles, /\.ai-model-catalog/);
  assert.match(styles, /\.ai-availability-audit/);
  assert.match(styles, /\.configured-api-summary/);
  assert.match(styles, /\.api-profile-list/);
  assert.equal(catalogSchema.properties.schemaVersion.const, "1.0.0");
  assert.equal(catalogSchema.properties.kind.const, "ai_tavern_model_catalog_v1");
});

test("首页可从原文生成标准剧本包并按分区重新生成", async () => {
  const [
    home,
    analysisRoute,
    analysisService,
    route,
    revisionRoute,
    revisionService,
    generator,
    styles,
  ] =
    await Promise.all([
    readProjectFile("app/酒馆首页.tsx"),
    readProjectFile("app/api/imports/analyze-source/route.ts"),
    readProjectFile("lib/import/原文剧本分析.ts"),
    readProjectFile("app/api/imports/generate-bundle/route.ts"),
    readProjectFile("app/api/imports/regenerate-bundle-section/route.ts"),
    readProjectFile("lib/import/剧本包分区重生成.ts"),
    readProjectFile("lib/import/原文生成剧本包.ts"),
    readProjectFile("app/globals.css"),
    ]);

  assert.match(home, /AI 原文分析/);
  assert.match(home, /\/api\/imports\/analyze-source/);
  assert.match(home, /\/api\/imports\/generate-bundle/);
  assert.match(home, /accept="\.txt,\.md,text\/plain,text\/markdown"/);
  assert.match(home, /玩家控制角色/);
  assert.match(home, /主要 AI 角色/);
  assert.match(home, /选择第一幕开场/);
  assert.match(home, /按当前选择生成剧本包/);
  assert.match(home, /applyAdventureBundlePreview/);
  assert.match(home, /下载生成包/);
  assert.match(home, /\/api\/imports\/regenerate-bundle-section/);
  assert.match(home, /只重新生成一个部分/);
  assert.match(home, /不满意的原因或修改要求（必填）/);
  assert.match(home, /applyRegeneratedBundleSection/);
  assert.match(home, /尚未应用 · 差异预览/);
  assert.match(home, /采用新版本/);
  assert.match(home, /放弃新版本/);
  assert.match(home, /bundleRevisionSnapshotFingerprint/);
  assert.match(analysisRoute, /analyzeSourceStory/);
  assert.match(analysisService, /recommendedPlayerName/);
  assert.match(analysisService, /openingCandidates/);
  assert.match(route, /generateAdventureBundleFromSource/);
  assert.match(revisionRoute, /regenerateAdventureBundleSection/);
  assert.match(revisionService, /mergeGeneratedSection/);
  assert.match(revisionService, /parseAdventureBundleDocument\(merged\)/);
  assert.match(generator, /GENERATED_BUNDLE_SAMPLE_MAX_CHARACTERS = 48_000/);
  assert.match(generator, /playerCharacterName/);
  assert.match(generator, /openingSourceChapterIndex/);
  assert.match(generator, /parseAdventureBundleDocument/);
  assert.match(generator, /referenceDocuments/);
  assert.match(generator, /最多调用模型修复一次|模型两次返回/);
  assert.match(styles, /\.source-generation-button/);
  assert.match(styles, /\.source-analysis-card/);
  assert.match(styles, /\.bundle-section-regeneration/);
});

test("文件生命周期和玩家手册覆盖当前维护边界", async () => {
  const [lifecycle, manual, importGuide, importFormat, readme, contentService] =
    await Promise.all([
      readProjectFile("docs/FILE_LIFECYCLE.md"),
      readProjectFile("public/使用手册/AI酒馆操作手册.md"),
      readProjectFile("public/文件标准/导入材料文件结构指导手册.md"),
      readProjectFile("docs/IMPORT_FORMAT.md"),
      readProjectFile("README.md"),
      readProjectFile("docs/CONTENT_SERVICE.md"),
    ]);

  for (const heading of [
    "玩家提供的文件",
    "程序内部保存的数据与文件",
    "发送给模型供应商 API 的内容",
    "新功能接入工作台的规则",
    "文档同步矩阵",
  ]) {
    assert.match(lifecycle, new RegExp(heading));
  }

  for (const topic of [
    "候选选项与三种输入",
    "重新生成",
    "剧本工作台",
    "历史回看、分支与存档",
    "实际 AI 上下文",
    "完整存档与整库备份",
    "文件选择与隐私",
    "OpenCode Go",
    "审核可用性",
  ]) {
    assert.match(manual, new RegExp(topic));
  }

  assert.match(lifecycle, /ai_tavern_model_catalog_v1/);
  assert.match(lifecycle, /目录可见|目录只反映/);

  assert.match(importGuide, /版本：`1\.9`/);
  assert.match(importGuide, /当前为 `1\.8\.0`/);
  assert.match(lifecycle, /原文生成剧本包/);
  assert.match(manual, /AI 原文分析与生成/);
  assert.match(importFormat, /从原文自动生成标准剧本包/);
  assert.match(importFormat, /分区重生成/);
  assert.match(importFormat, /当前导出 `schemaVersion` 为 `1\.8\.0`/);
  assert.doesNotMatch(
    importFormat,
    /`schemaVersion` 固定为 `1\.0\.0`/,
    "运行存档格式标识和数据版本不能混为一谈",
  );
  assert.match(readme, /AI 酒馆完整操作手册/);
  assert.match(readme, /内容文件生命周期与规范/);
  assert.match(readme, /统一剧本内容服务规范/);
  assert.match(contentService, /content_asset_management_changes/);
  assert.match(contentService, /安全恢复/);
  assert.match(contentService, /schemaVersion/);
});

test("网页操作手册直接渲染唯一 Markdown 源文件", async () => {
  const [pageSource, rendererSource] = await Promise.all([
    readProjectFile("app/manual/page.tsx"),
    readProjectFile("app/manual/Markdown文档.tsx"),
  ]);

  assert.match(pageSource, /AI酒馆操作手册\.md/);
  assert.match(pageSource, /<MarkdownDocument source=\{source\}/);
  assert.match(pageSource, /下载 Markdown 原文/);
  assert.match(rendererSource, /manual-table-scroll/);
  assert.match(rendererSource, /renderInline/);
});
