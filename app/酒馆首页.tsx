"use client";

import type {
  AdventureDeclaredLocation,
  AdventureForeshadowingInput,
  AdventureRelationshipInput,
  AdventureStoryModuleInput,
  AdventureTriggerInput,
  AdventureWorldBookEntryInput,
  AdventureSummary,
  JsonObject,
} from "@/lib/storage/story-store";
import type {
  ImportedCharacterCard,
  ImportedWorldBook,
  ImportFileKind,
} from "@/lib/import/酒馆文件";
import type { ImportedAdventureBundle } from "@/lib/import/剧本包";
import {
  bundleRevisionSnapshotFingerprint,
  compareBundleRevisionSnapshots,
  type BundleRevisionDiffItem,
  type BundleRevisionDiffStatus,
  type BundleRevisionSnapshotItem,
} from "@/lib/import/剧本包分区差异";
import type { CompleteArchivePreview } from "@/lib/import/完整存档";
import type { SourceDocumentInput } from "@/lib/reference/原文参考";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

interface AdventureListResponse {
  adventures?: AdventureSummary[];
  error?: string;
}

interface CreateAdventureResponse {
  adventure?: { sessionId: string };
  error?: string;
  issues?: string[];
}

interface RenameAdventureResponse {
  adventure?: {
    campaignId: string;
    sessionId: string;
    name: string;
    sessionName: string;
    updatedAt: string;
    changed: boolean;
  };
  error?: string;
  issues?: string[];
}

interface ImportPreviewResponse {
  fileName?: string;
  preview?: ImportedCharacterCard | ImportedWorldBook | ImportedAdventureBundle;
  error?: string;
  issues?: string[];
}

interface SourceAiOperationSummary {
  model: string;
  requestCount: number;
  repairUsed: boolean;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  sourceCharacters: number;
  sampledCharacters: number;
  chapterCount: number;
  excerptCount: number;
  fullSourceSent: boolean;
}

interface GeneratedBundleResponse {
  fileName?: string;
  document?: JsonObject;
  preview?: ImportedAdventureBundle;
  generation?: SourceAiOperationSummary;
  error?: string;
  issues?: string[];
}

type BundleRegenerationSection =
  | "characters"
  | "world_book"
  | "story_modules"
  | "opening";

interface BundleSectionRegenerationResponse extends GeneratedBundleResponse {
  section?: BundleRegenerationSection;
}

interface PendingBundleRevision {
  fileName: string;
  document: JsonObject;
  preview: ImportedAdventureBundle;
  generation: SourceAiOperationSummary | null;
  section: BundleRegenerationSection;
  feedback: string;
  baselineFingerprint: string;
  differences: BundleRevisionDiffItem[];
}

type GeneratedBundleSummary = NonNullable<
  GeneratedBundleResponse["generation"]
>;

type SourceCharacterImportance = "central" | "major" | "supporting";

interface SourceCharacterCandidate {
  name: string;
  role: string;
  importance: SourceCharacterImportance;
  playerSuitability: string;
  aiSuitability: string;
  appearsNearOpening: boolean;
}

interface SourceOpeningCandidate {
  id: string;
  chapterIndex: number;
  title: string;
  location: string;
  summary: string;
  presentCharacterNames: string[];
}

interface SourceStoryAnalysis {
  storyTitle: string;
  overview: string;
  characters: SourceCharacterCandidate[];
  openingCandidates: SourceOpeningCandidate[];
  recommendedPlayerName: string;
  recommendedMainCharacterName: string;
  recommendedOpeningId: string;
}

interface SourceAnalysisResponse {
  fileName?: string;
  analysis?: SourceStoryAnalysis;
  generation?: SourceAiOperationSummary;
  error?: string;
  issues?: string[];
}

interface PendingSourceAnalysis {
  fileName: string;
  content: string;
}

interface LocalBackup {
  fileName: string;
  reason: "startup" | "migration" | "shutdown" | "manual" | "pre-restore";
  createdAt: string;
  size: number;
}

interface BackupsResponse {
  backups?: LocalBackup[];
  adventures?: AdventureSummary[];
  error?: string;
}

type HomeView = "menu" | "new" | "continue";

type AiProviderId =
  | "deepseek"
  | "opencode_go"
  | "openai_compatible"
  | "local_openai_compatible";
type AiJsonMode = "response_format" | "prompt_only";

interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  apiKeyRequired: boolean;
  modelDiscoverySupported: boolean;
}

type AiModelCompatibility =
  | "chat_completions"
  | "unsupported_protocol"
  | "unknown";

interface AiAvailableModel {
  id: string;
  name: string;
  ownedBy?: string;
  compatibility: AiModelCompatibility;
  compatibilityReason: string;
}

interface AiModelCatalog {
  provider: AiProviderId;
  providerLabel: string;
  fetchedAt: string;
  models: AiAvailableModel[];
}

interface AiAuditCheck {
  id: string;
  label: string;
  status: "passed" | "warning" | "failed" | "skipped";
  detail: string;
  durationMs?: number;
}

interface AiProviderAudit {
  ok: boolean;
  checkedAt: string;
  provider: AiProviderId;
  selectedModel: string;
  returnedModel?: string;
  models: AiAvailableModel[];
  checks: AiAuditCheck[];
}

interface AiProfileSummary {
  id: string;
  name: string;
  provider: AiProviderId;
  providerLabel: string;
  baseUrl: string;
  model: string;
  jsonMode: AiJsonMode;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AiSettingsResponse {
  provider: AiProviderId;
  providerLabel: string;
  configured: boolean;
  hasApiKey: boolean;
  apiKeyRequired: boolean;
  baseUrl: string;
  model: string;
  jsonMode: AiJsonMode;
  version?: string;
  presets: AiProviderPreset[];
  activeId: string | null;
  profiles: AiProfileSummary[];
}

interface AiSettingsDraft {
  id?: string;
  name?: string;
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  jsonMode: AiJsonMode;
  clearApiKey: boolean;
}

interface AdditionalCharacterDraft {
  id: string;
  name: string;
  role: string;
  personality: string;
  firstMessage: string;
  card?: JsonObject;
  sourceFile?: string;
  initiallyPresent?: boolean;
}

interface ImportedWorldBookDraft extends ImportedWorldBook {
  id: string;
  fileName: string;
}

const emptyForm = {
  campaignName: "",
  campaignDescription: "",
  worldName: "",
  worldPremise: "",
  playerName: "",
  playerDescription: "",
  mainCharacterName: "",
  mainCharacterRole: "",
  mainCharacterPersonality: "",
  mainCharacterFirstMessage: "",
  openingLocationName: "",
  openingScene: "",
  initialStoryDirection: "",
};

const exampleForm = {
  campaignName: "雾港余烬",
  campaignDescription: "一场围绕失踪航船、古老灯塔与港口秘密展开的悬疑冒险。",
  worldName: "灰潮群岛",
  worldPremise:
    "群岛终年被银灰色海雾笼罩，航线依靠会歌唱的潮汐灯塔维系。三个月前，北方灯塔突然沉默，此后每逢退潮，港内就会出现不属于任何时代的船骸。教会宣称这是海神的警告，商会却在暗中回收船骸上的黑色晶体。",
  playerName: "沈砚",
  playerDescription:
    "来自内陆的年轻测绘师，冷静、好奇，擅长辨认旧地图。为了寻找失踪的兄长来到雾港，但没有向任何人透露真正目的。",
  mainCharacterName: "伊芙琳·洛",
  mainCharacterRole:
    "雾港守灯人，掌握旧灯塔的通行方法，也是最后一个见过失踪航船的人。",
  mainCharacterPersonality:
    "克制、警觉、言辞简短；厌恶轻率的承诺，但会保护真正尊重海洋的人。她隐瞒着一次失败的救援行动。",
  mainCharacterFirstMessage:
    "“如果你是来问那艘船的，就先把门关上。”她没有回头，只伸手拨暗了桌上的灯，“今晚的雾会听见名字。”",
  openingLocationName: "雾港酒馆",
  openingScene:
    "午夜将至，雾港唯一仍亮着灯的酒馆里只剩潮湿的木香。沈砚刚摊开兄长留下的残缺海图，门外便响起三短一长的敲击——这是旧航海图上标记危险水域的暗号。披着黑色防水斗篷的守灯人伊芙琳走进酒馆，袖口正滴着带有微光的海水。",
  initialStoryDirection: "让玩家逐步发现失踪航船与沉默灯塔之间的联系。",
};

const exampleAdditionalCharacters: AdditionalCharacterDraft[] = [
  {
    id: "example-harbor-priest",
    name: "米洛修士",
    role: "潮汐教会的年轻司祭，负责调查被视为不祥的船骸。",
    personality: "温和而执拗，相信仪式能够保护港口，但会质疑教会隐瞒事实的命令。",
    firstMessage: "“先别碰那张海图。”门边的修士压低声音，“它昨晚还没有这条航线。”",
  },
];

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "本地记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(value: number) {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function describeGeneratedBundle(summary: GeneratedBundleSummary) {
  const tokenUsage = summary.usage.totalTokens
    ? ` · ${summary.usage.totalTokens.toLocaleString("zh-CN")} token`
    : "";
  return `${summary.model} · ${summary.requestCount} 次请求${tokenUsage}${summary.repairUsed ? "（含一次自动修复）" : ""}；下载文件保留生成时版本，下方修改不会反写`;
}

function sourceImportanceLabel(value: SourceCharacterImportance) {
  if (value === "central") return "核心人物";
  if (value === "major") return "重要人物";
  return "辅助人物";
}

function bundleSectionLabel(value: BundleRegenerationSection) {
  return {
    characters: "角色资料",
    world_book: "世界书",
    story_modules: "剧情任务",
    opening: "开篇",
  }[value];
}

function bundleDiffStatusLabel(value: BundleRevisionDiffStatus) {
  return {
    added: "新增",
    removed: "移除",
    changed: "修改",
    unchanged: "未变化",
  }[value];
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cardText(card: JsonObject | undefined, key: string) {
  if (!card) return "";
  const source = isJsonObject(card.data) ? card.data : card;
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function displayText(value: string | undefined) {
  return value?.trim() || "（空）";
}

function characterSnapshotContent(input: {
  name: string;
  role: string;
  personality: string;
  firstMessage?: string;
  card?: JsonObject;
  initiallyPresent?: boolean;
}) {
  return [
    `姓名：${displayText(input.name)}`,
    `身份与背景：${displayText(input.role)}`,
    `性格与行为：${displayText(input.personality)}`,
    `开场台词：${displayText(input.firstMessage)}`,
    `对话示例：${displayText(cardText(input.card, "mes_example"))}`,
    `场景参考：${displayText(cardText(input.card, "scenario"))}`,
    `系统提示：${displayText(cardText(input.card, "system_prompt"))}`,
    `历史后提示：${displayText(cardText(input.card, "post_history_instructions"))}`,
    ...(typeof input.initiallyPresent === "boolean"
      ? [`开场在场：${input.initiallyPresent ? "是" : "否"}`]
      : []),
  ].join("\n");
}

function worldBookEntrySnapshotContent(
  entry: AdventureWorldBookEntryInput,
) {
  return [
    `触发词：${entry.keys.length ? entry.keys.join("、") : "常驻"}`,
    `次级触发词：${entry.secondaryKeys?.join("、") || "（无）"}`,
    `正文：${displayText(entry.content)}`,
    `启用：${entry.enabled ? "是" : "否"}`,
    `常驻：${entry.constant ? "是" : "否"}`,
    `插入位置：${entry.position || "before_char"}`,
    `顺序 / 概率 / 深度：${entry.order ?? 100} / ${entry.probability ?? 100} / ${entry.depth ?? 4}`,
  ].join("\n");
}

function storyModuleSnapshotContent(module: AdventureStoryModuleInput) {
  return [
    `目标：${displayText(module.objective)}`,
    `完成条件：${module.completionCriteria.join("；")}`,
    `进入条件：${module.activationConditions?.join("；") || "（无）"}`,
    `前置任务：${module.prerequisiteModuleIds?.join("、") || "（无）"}`,
    `连续性：${displayText(module.continuityNotes)}`,
    `自动接续：${module.autoContinue === false ? "否" : "是"}`,
    ...(module.deadlineDay !== undefined && module.deadlineDay > 0
      ? [`期限：第 ${module.deadlineDay} 日前完成`]
      : []),
  ].join("\n");
}

function proposedBundleRevisionSnapshot(
  preview: ImportedAdventureBundle,
  section: BundleRegenerationSection,
): BundleRevisionSnapshotItem[] {
  const adventure = preview.adventure;
  if (section === "characters") {
    return [
      {
        key: "player",
        label: `玩家角色 · ${adventure.player.name}`,
        content: characterSnapshotContent({
          name: adventure.player.name,
          role: adventure.player.description,
          personality: cardText(adventure.player.card, "personality"),
          card: adventure.player.card,
        }),
      },
      {
        key: "main",
        label: `主要角色 · ${adventure.mainCharacter.name}`,
        content: characterSnapshotContent(adventure.mainCharacter),
      },
      ...(adventure.additionalCharacters ?? []).map((character) => ({
        key: `additional:${character.name.toLocaleLowerCase("zh-CN")}`,
        label: `其他角色 · ${character.name}`,
        content: characterSnapshotContent(character),
      })),
    ];
  }
  if (section === "world_book") {
    return preview.worldBook.entries.map((entry, index) => ({
      key: `world:${entry.sourceId || entry.comment || index + 1}`,
      label: entry.comment || `世界书条目 ${index + 1}`,
      content: worldBookEntrySnapshotContent(entry),
    }));
  }
  if (section === "story_modules") {
    return [
      ...(adventure.storyModules ?? []).map((module) => ({
        key: `story:${module.id}`,
        label: module.title,
        content: storyModuleSnapshotContent(module),
      })),
      {
        key: "story:initial-direction",
        label: "初始剧情目标",
        content: displayText(adventure.initialStoryDirection),
      },
    ];
  }
  return [
    {
      key: "opening:location",
      label: "开场地点",
      content: displayText(adventure.openingLocationName),
    },
    {
      key: "opening:scene",
      label: "开场正文",
      content: displayText(adventure.openingScene),
    },
    {
      key: "opening:direction",
      label: "初始剧情目标",
      content: displayText(adventure.initialStoryDirection),
    },
  ];
}

function backupReasonLabel(reason: LocalBackup["reason"]) {
  return {
    startup: "启动自动备份",
    migration: "升级后备份",
    shutdown: "退出自动备份",
    manual: "手动备份",
    "pre-restore": "恢复前备份",
  }[reason];
}

function modelCompatibilityLabel(value: AiModelCompatibility) {
  if (value === "chat_completions") return "协议可兼容";
  if (value === "unsupported_protocol") return "协议暂不支持";
  return "需要审核";
}

function aiProviderTypeLabel(provider: AiProviderId) {
  return {
    deepseek: "官方云端 API",
    opencode_go: "套餐聚合 API",
    openai_compatible: "OpenAI 兼容云端 API",
    local_openai_compatible: "本地 OpenAI 兼容 API",
  }[provider];
}

export function TavernHome() {
  const [homeView, setHomeView] = useState<HomeView>("menu");
  const [exitNotice, setExitNotice] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [adventures, setAdventures] = useState<AdventureSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState("");
  const [editingSessionId, setEditingSessionId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [renameError, setRenameError] = useState("");
  const [additionalCharacters, setAdditionalCharacters] = useState<
    AdditionalCharacterDraft[]
  >([]);
  const [mainCharacterCard, setMainCharacterCard] = useState<JsonObject | null>(
    null,
  );
  const [playerCharacterCard, setPlayerCharacterCard] =
    useState<JsonObject | null>(null);
  const [playerCharacterSourceFile, setPlayerCharacterSourceFile] =
    useState("");
  const [mainCharacterSourceFile, setMainCharacterSourceFile] = useState("");
  const [bundleSourceFile, setBundleSourceFile] = useState("");
  const [generatedBundleDocument, setGeneratedBundleDocument] =
    useState<JsonObject | null>(null);
  const [generatedBundleSummary, setGeneratedBundleSummary] =
    useState<GeneratedBundleSummary | null>(null);
  const [bundleRevisionSection, setBundleRevisionSection] =
    useState<BundleRegenerationSection>("characters");
  const [bundleRevisionFeedback, setBundleRevisionFeedback] = useState("");
  const [pendingBundleRevision, setPendingBundleRevision] =
    useState<PendingBundleRevision | null>(null);
  const [pendingSourceAnalysis, setPendingSourceAnalysis] =
    useState<PendingSourceAnalysis | null>(null);
  const [sourceStoryAnalysis, setSourceStoryAnalysis] =
    useState<SourceStoryAnalysis | null>(null);
  const [sourceAnalysisSummary, setSourceAnalysisSummary] =
    useState<SourceAiOperationSummary | null>(null);
  const [selectedSourcePlayer, setSelectedSourcePlayer] = useState("");
  const [selectedSourceMainCharacter, setSelectedSourceMainCharacter] =
    useState("");
  const [selectedSourceOpeningId, setSelectedSourceOpeningId] = useState("");
  const [storyModules, setStoryModules] = useState<
    AdventureStoryModuleInput[]
  >([]);
  const [bundleRelationships, setBundleRelationships] = useState<
    AdventureRelationshipInput[]
  >([]);
  const [bundleLocations, setBundleLocations] = useState<
    AdventureDeclaredLocation[]
  >([]);
  const [bundleForeshadowing, setBundleForeshadowing] = useState<
    AdventureForeshadowingInput[]
  >([]);
  const [bundleTriggers, setBundleTriggers] = useState<AdventureTriggerInput[]>(
    [],
  );
  const [initialStoryModuleId, setInitialStoryModuleId] = useState("");
  const [sourceDocuments, setSourceDocuments] = useState<SourceDocumentInput[]>(
    [],
  );
  const [importedWorldBooks, setImportedWorldBooks] = useState<
    ImportedWorldBookDraft[]
  >([]);
  const [importingKind, setImportingKind] = useState<
    | ImportFileKind
    | "adventure_bundle"
    | "source_analysis"
    | "source_bundle_generation"
    | "source_bundle_revision"
    | ""
  >(
    "",
  );
  const [importNotice, setImportNotice] = useState("");
  const [importError, setImportError] = useState("");
  const [error, setError] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [dataSafetyNotice, setDataSafetyNotice] = useState("");
  const [importingArchive, setImportingArchive] = useState(false);
  const [backupOperation, setBackupOperation] = useState("");
  const [backups, setBackups] = useState<LocalBackup[]>([]);
  const [modelStatus, setModelStatus] = useState<AiSettingsResponse | null>(null);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState<AiSettingsDraft | null>(null);
  const [modelProfiles, setModelProfiles] = useState<AiProfileSummary[]>([]);
  const [modelActiveId, setModelActiveId] = useState<string | null>(null);
  const [modelOperation, setModelOperation] = useState<
    "discover" | "audit" | "save" | "delete" | "switch" | ""
  >("");
  const [availableModels, setAvailableModels] = useState<AiAvailableModel[]>([]);
  const [modelCatalogFetchedAt, setModelCatalogFetchedAt] = useState("");
  const [modelAudit, setModelAudit] = useState<AiProviderAudit | null>(null);
  const [modelNotice, setModelNotice] = useState("");
  const [modelError, setModelError] = useState("");
  const selectedSourceOpening = sourceStoryAnalysis?.openingCandidates.find(
    (opening) => opening.id === selectedSourceOpeningId,
  );

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/adventures", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as AdventureListResponse;
        if (!response.ok) throw new Error(body.error ?? "读取战役失败。");
        if (!cancelled) setAdventures(body.adventures ?? []);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setArchiveError(
            reason instanceof Error ? reason.message : "读取战役失败。",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });

    void fetch("/api/settings/ai", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as AiSettingsResponse & {
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "读取模型配置失败。");
        if (!cancelled) setModelStatus(body);
      })
      .catch(() => undefined);

    void fetch("/api/backups", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as BackupsResponse;
        if (!response.ok) throw new Error(body.error ?? "读取备份失败。");
        if (!cancelled) setBackups(body.backups ?? []);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setArchiveError(
            reason instanceof Error ? reason.message : "读取备份失败。",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openModelSettings() {
    const status = modelStatus;
    if (!status) return;
    setModelDraft({
      provider: status.provider,
      baseUrl: status.baseUrl,
      model: status.model,
      apiKey: "",
      jsonMode: status.jsonMode,
      clearApiKey: false,
    });
    setModelProfiles(status.profiles ?? []);
    setModelActiveId(status.activeId ?? null);
    setModelNotice("");
    setModelError("");
    setAvailableModels([]);
    setModelCatalogFetchedAt("");
    setModelAudit(null);
    setModelSettingsOpen(true);
  }

  function clearModelReview() {
    setAvailableModels([]);
    setModelCatalogFetchedAt("");
    setModelAudit(null);
    setModelNotice("");
    setModelError("");
  }

  function exportModelCatalog() {
    if (!modelDraft || availableModels.length === 0) return;
    const providerLabel =
      modelStatus?.presets.find((preset) => preset.id === modelDraft.provider)
        ?.label ?? modelDraft.provider;
    const payload = {
      schemaVersion: "1.0.0",
      kind: "ai_tavern_model_catalog_v1",
      exportedAt: new Date().toISOString(),
      provider: modelDraft.provider,
      providerLabel,
      baseUrl: modelDraft.baseUrl,
      catalogFetchedAt: modelCatalogFetchedAt || null,
      selectedModel: modelDraft.model || null,
      verifiedModel:
        modelAudit?.ok && modelAudit.selectedModel === modelDraft.model
          ? modelAudit.selectedModel
          : null,
      summary: {
        chatCompletionsCandidates: availableModels.filter(
          (model) => model.compatibility === "chat_completions",
        ).length,
        requiresAudit: availableModels.filter(
          (model) => model.compatibility === "unknown",
        ).length,
        unsupportedProtocol: availableModels.filter(
          (model) => model.compatibility === "unsupported_protocol",
        ).length,
      },
      audit:
        modelAudit?.selectedModel === modelDraft.model
          ? {
              ok: modelAudit.ok,
              checkedAt: modelAudit.checkedAt,
              provider: modelAudit.provider,
              selectedModel: modelAudit.selectedModel,
              returnedModel: modelAudit.returnedModel ?? null,
              checks: modelAudit.checks,
            }
          : null,
      models: availableModels,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = downloadUrl;
    link.download = `模型清单_${providerLabel.replace(/[^\p{L}\p{N}_-]+/gu, "_")}_${date}.json`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  }

  async function submitModelConfiguration(
    operation: "discover" | "audit" | "save",
    options: { asNew?: boolean } = {},
  ) {
    if (!modelDraft || modelOperation) return;
    setModelOperation(operation);
    setModelNotice("");
    setModelError("");
    try {
      const response = await fetch("/api/settings/ai", {
        method: operation === "save" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...modelDraft,
          id: options.asNew ? undefined : modelDraft.id,
          ...(operation === "discover"
            ? { operation: "discover_models" }
            : operation === "audit"
              ? { operation: "audit" }
              : {}),
        }),
      });
      const body = (await response.json()) as
        | AiSettingsResponse
        | { operation: "discover_models"; catalog: AiModelCatalog }
        | { operation: "audit"; audit: AiProviderAudit }
        | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "模型配置操作失败。");
      }
      if (operation === "discover" && "catalog" in body) {
        setAvailableModels(body.catalog.models);
        setModelCatalogFetchedAt(body.catalog.fetchedAt);
        setModelAudit(null);
        setModelNotice(`已读取 ${body.catalog.models.length} 个模型，可选择或导出清单。`);
      } else if (operation === "audit" && "audit" in body) {
        setModelAudit(body.audit);
        if (body.audit.models.length > 0) {
          setAvailableModels(body.audit.models);
          setModelCatalogFetchedAt(body.audit.checkedAt);
        }
        setModelNotice(
          body.audit.ok
            ? "可用性审核通过，当前模型可以用于生成酒馆剧情。"
            : "审核发现问题；请查看分项结果后调整模型或 JSON 输出方式。",
        );
      } else if (operation === "save") {
        const status = body as AiSettingsResponse;
        setModelStatus(status);
        setModelProfiles(status.profiles ?? []);
        setModelActiveId(status.activeId ?? null);
        setModelDraft((current) =>
          current
            ? { ...current, apiKey: "", clearApiKey: false }
            : current,
        );
        setModelNotice(
          modelDraft.id
            ? "已更新 API 配置并切换为当前使用。"
            : "已保存为新 API 配置并切换为当前使用。",
        );
      }
    } catch (reason) {
      setModelError(reason instanceof Error ? reason.message : "模型配置操作失败。");
    } finally {
      setModelOperation("");
    }
  }

  async function switchModelProfileTo(profileId: string) {
    if (modelOperation || profileId === modelActiveId) return;
    setModelOperation("switch");
    setModelNotice("");
    setModelError("");
    try {
      const response = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "switch_profile", profileId }),
      });
      const body = (await response.json()) as AiSettingsResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "切换 API 配置失败。");
      }
      setModelStatus(body);
      setModelProfiles(body.profiles ?? []);
      setModelActiveId(body.activeId ?? null);
      setModelDraft({
        provider: body.provider,
        baseUrl: body.baseUrl,
        model: body.model,
        apiKey: "",
        jsonMode: body.jsonMode,
        clearApiKey: false,
      });
      setAvailableModels([]);
      setModelCatalogFetchedAt("");
      setModelAudit(null);
      setModelNotice("已切换到所选 API 配置，后续回合将使用该配置生成。");
    } catch (reason) {
      setModelError(
        reason instanceof Error ? reason.message : "切换 API 配置失败。",
      );
    } finally {
      setModelOperation("");
    }
  }

  function editModelProfile(profile: AiProfileSummary) {
    setModelDraft({
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: "",
      jsonMode: profile.jsonMode,
      clearApiKey: false,
    });
    setModelNotice("");
    setModelError("");
    setAvailableModels([]);
    setModelCatalogFetchedAt("");
    setModelAudit(null);
  }

  function newModelProfile() {
    setModelDraft({
      provider: "opencode_go",
      baseUrl:
        modelStatus?.presets.find((preset) => preset.id === "opencode_go")
          ?.defaultBaseUrl ?? "https://opencode.ai/zen/go/v1/chat/completions",
      model: "deepseek-v4-flash",
      apiKey: "",
      jsonMode: "response_format",
      clearApiKey: false,
    });
    setModelNotice("");
    setModelError("");
    setAvailableModels([]);
    setModelCatalogFetchedAt("");
    setModelAudit(null);
  }

  async function deleteModelConfiguration(profileId?: string) {
    if (modelOperation) return;
    const label = profileId
      ? (modelProfiles.find((profile) => profile.id === profileId)?.name ??
        "该 API")
      : modelStatus?.configured
        ? modelStatus.providerLabel
        : null;
    if (!label) return;
    const confirmed = window.confirm(
      `确定删除“${label}”吗？\n\n将清除该供应商、地址、模型和密钥配置，但不会删除任何剧本、存档或模型目录导出文件。`,
    );
    if (!confirmed) return;

    setModelOperation("delete");
    setModelNotice("");
    setModelError("");
    try {
      const url = profileId
        ? `/api/settings/ai?profileId=${encodeURIComponent(profileId)}`
        : "/api/settings/ai";
      const response = await fetch(url, { method: "DELETE" });
      const body = (await response.json()) as AiSettingsResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "删除 API 配置失败。");
      }
      setModelStatus(body);
      setModelProfiles(body.profiles ?? []);
      setModelActiveId(body.activeId ?? null);
      setModelDraft({
        provider: body.provider,
        baseUrl: body.baseUrl,
        model: body.model,
        apiKey: "",
        jsonMode: body.jsonMode,
        clearApiKey: false,
      });
      setAvailableModels([]);
      setModelCatalogFetchedAt("");
      setModelAudit(null);
      setModelNotice("已删除 API 配置；剧本与存档未受影响。");
    } catch (reason) {
      setModelError(
        reason instanceof Error ? reason.message : "删除 API 配置失败。",
      );
    } finally {
      setModelOperation("");
    }
  }

  function updateAdditionalCharacter(
    id: string,
    key: "name" | "role" | "personality" | "firstMessage",
    value: string,
  ) {
    setAdditionalCharacters((characters) =>
      characters.map((character) =>
        character.id === id ? { ...character, [key]: value } : character,
      ),
    );
  }

  async function previewImportFile(
    kind: ImportFileKind | "adventure_bundle",
    file: File,
  ) {
    const maximumSize = kind === "adventure_bundle" ? 5_000_000 : 1_000_000;
    if (file.size > maximumSize) {
      throw new Error(
        `《${file.name}》超过 ${kind === "adventure_bundle" ? 5 : 1} MB，无法导入。`,
      );
    }
    let document: unknown;
    try {
      document = JSON.parse(await file.text()) as unknown;
    } catch {
      throw new Error(`《${file.name}》不是有效的 JSON 文件。`);
    }
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, fileName: file.name, document }),
    });
    const body = (await response.json()) as ImportPreviewResponse;
    if (!response.ok || !body.preview) {
      throw new Error(
        body.issues?.[0] ?? body.error ?? `无法解析《${file.name}》。`,
      );
    }
    return { fileName: body.fileName ?? file.name, preview: body.preview };
  }

  async function importCharacterFiles(files: File[]) {
    if (!files.length || importingKind) return;
    setImportingKind("character_card");
    setImportError("");
    setImportNotice("");
    try {
      const canUseMainSlot =
        !mainCharacterCard && !form.mainCharacterName.trim();
      const availableSlots =
        20 - additionalCharacters.length + (canUseMainSlot ? 1 : 0);
      if (files.length > availableSlots) {
        throw new Error(
          `当前最多还能导入 ${Math.max(availableSlots, 0)} 张人物卡。`,
        );
      }
      const imported: Array<{
        fileName: string;
        preview: ImportedCharacterCard;
      }> = [];
      for (const file of files) {
        const result = await previewImportFile("character_card", file);
        if (result.preview.kind !== "character_card") {
          throw new Error(`《${file.name}》不是人物卡。`);
        }
        imported.push({ fileName: result.fileName, preview: result.preview });
      }

      const mainImport = canUseMainSlot ? imported[0] : undefined;
      const supportingImports = mainImport ? imported.slice(1) : imported;
      if (mainImport) {
        setMainCharacterCard(mainImport.preview.card);
        setMainCharacterSourceFile(mainImport.fileName);
        setForm((current) => ({
          ...current,
          mainCharacterName: mainImport.preview.name,
          mainCharacterRole: mainImport.preview.role,
          mainCharacterPersonality: mainImport.preview.personality,
          mainCharacterFirstMessage: mainImport.preview.firstMessage,
          openingScene: current.openingScene || mainImport.preview.scenario,
        }));
      }
      setAdditionalCharacters((characters) => [
        ...characters,
        ...supportingImports.map(({ fileName, preview }) => ({
          id: crypto.randomUUID(),
          name: preview.name,
          role: preview.role,
          personality: preview.personality,
          firstMessage: preview.firstMessage,
          card: preview.card,
          sourceFile: fileName,
        })),
      ]);
      const warningCount = imported.reduce(
        (total, item) => total + item.preview.warnings.length,
        0,
      );
      setImportNotice(
        `已读取 ${imported.length} 张人物卡${warningCount ? `，包含 ${warningCount} 条兼容提示` : ""}。`,
      );
    } catch (reason) {
      setImportError(
        reason instanceof Error ? reason.message : "导入人物卡失败。",
      );
    } finally {
      setImportingKind("");
    }
  }

  async function importWorldBookFiles(files: File[]) {
    if (!files.length || importingKind) return;
    setImportingKind("world_book");
    setImportError("");
    setImportNotice("");
    try {
      const imported: ImportedWorldBookDraft[] = [];
      for (const file of files) {
        const result = await previewImportFile("world_book", file);
        if (result.preview.kind !== "world_book") {
          throw new Error(`《${file.name}》不是世界书。`);
        }
        imported.push({
          ...result.preview,
          id: crypto.randomUUID(),
          fileName: result.fileName,
        });
      }
      const nextTotal = [...importedWorldBooks, ...imported].reduce(
        (total, book) => total + book.entries.length,
        0,
      );
      if (nextTotal > 200) {
        throw new Error(`导入后共有 ${nextTotal} 条世界书条目，超过 200 条上限。`);
      }
      setImportedWorldBooks((books) => [...books, ...imported]);
      const firstBook = imported[0];
      if (firstBook) {
        const premise =
          firstBook.description ||
          firstBook.entries
            .filter((entry) => entry.constant)
            .slice(0, 3)
            .map((entry) => entry.content)
            .join("\n\n");
        setForm((current) => ({
          ...current,
          worldName: current.worldName || firstBook.name,
          worldPremise: current.worldPremise || premise.slice(0, 6_000),
        }));
      }
      const entryCount = imported.reduce(
        (total, book) => total + book.entries.length,
        0,
      );
      const warningCount = imported.reduce(
        (total, book) => total + book.warnings.length,
        0,
      );
      setImportNotice(
        `已读取 ${imported.length} 份世界书，共 ${entryCount} 条${warningCount ? `，包含 ${warningCount} 条兼容提示` : ""}。`,
      );
    } catch (reason) {
      setImportError(
        reason instanceof Error ? reason.message : "导入世界书失败。",
      );
    } finally {
      setImportingKind("");
    }
  }

  function hasUnsavedOpeningDraft() {
    return (
      Object.values(form).some((value) => value.trim()) ||
      Boolean(playerCharacterCard) ||
      Boolean(mainCharacterCard) ||
      additionalCharacters.length > 0 ||
      importedWorldBooks.length > 0 ||
      sourceDocuments.length > 0 ||
      storyModules.length > 0 ||
      bundleForeshadowing.length > 0 ||
      bundleTriggers.length > 0
    );
  }

  function clearSourceAnalysis() {
    setPendingSourceAnalysis(null);
    setSourceStoryAnalysis(null);
    setSourceAnalysisSummary(null);
    setSelectedSourcePlayer("");
    setSelectedSourceMainCharacter("");
    setSelectedSourceOpeningId("");
  }

  function removeBundleSection(
    kind:
      | "modules"
      | "relationships"
      | "locations"
      | "foreshadowing"
      | "triggers",
  ) {
    const nextModules = kind === "modules" ? [] : storyModules;
    const nextRelationships =
      kind === "relationships" ? [] : bundleRelationships;
    const nextLocations = kind === "locations" ? [] : bundleLocations;
    const nextForeshadowing =
      kind === "foreshadowing" ? [] : bundleForeshadowing;
    const nextTriggers = kind === "triggers" ? [] : bundleTriggers;
    setStoryModules(nextModules);
    setInitialStoryModuleId(
      kind === "modules" ? "" : initialStoryModuleId,
    );
    setBundleRelationships(nextRelationships);
    setBundleLocations(nextLocations);
    setBundleForeshadowing(nextForeshadowing);
    setBundleTriggers(nextTriggers);
    if (
      nextModules.length === 0 &&
      nextRelationships.length === 0 &&
      nextLocations.length === 0 &&
      nextForeshadowing.length === 0 &&
      nextTriggers.length === 0
    ) {
      setBundleSourceFile("");
    }
  }

  function applyAdventureBundlePreview(
    preview: ImportedAdventureBundle,
    fileName: string,
  ) {
    const adventure = preview.adventure;
    setForm({
      campaignName: adventure.campaignName,
      campaignDescription: adventure.campaignDescription ?? "",
      worldName: adventure.world.name,
      worldPremise: adventure.world.premise,
      playerName: adventure.player.name,
      playerDescription: adventure.player.description,
      mainCharacterName: adventure.mainCharacter.name,
      mainCharacterRole: adventure.mainCharacter.role,
      mainCharacterPersonality: adventure.mainCharacter.personality,
      mainCharacterFirstMessage: adventure.mainCharacter.firstMessage ?? "",
      openingLocationName: adventure.openingLocationName ?? "",
      openingScene: adventure.openingScene,
      initialStoryDirection: adventure.initialStoryDirection ?? "",
    });
    setPlayerCharacterCard(adventure.player.card ?? null);
    setPlayerCharacterSourceFile(fileName);
    setMainCharacterCard(adventure.mainCharacter.card ?? null);
    setMainCharacterSourceFile(fileName);
    setAdditionalCharacters(
      (adventure.additionalCharacters ?? []).map((character) => ({
        id: crypto.randomUUID(),
        name: character.name,
        role: character.role,
        personality: character.personality,
        firstMessage: character.firstMessage ?? "",
        card: character.card,
        sourceFile: fileName,
        initiallyPresent: character.initiallyPresent,
      })),
    );
    setImportedWorldBooks([
      {
        ...preview.worldBook,
        id: crypto.randomUUID(),
        fileName: `${fileName} · 内嵌世界书`,
      },
    ]);
    setSourceDocuments(adventure.sourceDocuments ?? []);
    setStoryModules(adventure.storyModules ?? []);
    setBundleRelationships(adventure.initialRelationships ?? []);
    setBundleLocations(adventure.locations ?? []);
    setBundleForeshadowing(adventure.foreshadowing ?? []);
    setBundleTriggers(adventure.triggers ?? []);
    setInitialStoryModuleId(adventure.initialStoryModuleId ?? "");
    setBundleSourceFile(fileName);
    const presentCount = (adventure.additionalCharacters ?? []).filter(
      (character) => character.initiallyPresent !== false,
    ).length;
    return `玩家 1 名、主要角色 1 名、其他角色 ${adventure.additionalCharacters?.length ?? 0} 名（开场在场 ${presentCount} 名）、世界书 ${preview.worldBook.entries.length} 条、原文参考 ${adventure.sourceDocuments?.length ?? 0} 份、剧情任务 ${adventure.storyModules?.length ?? 0} 个、伏笔 ${adventure.foreshadowing?.length ?? 0} 条、偏离触发器 ${adventure.triggers?.length ?? 0} 个${preview.warnings.length ? `，包含 ${preview.warnings.length} 条兼容提示` : ""}`;
  }

  function applyRegeneratedBundleSection(
    preview: ImportedAdventureBundle,
    section: BundleRegenerationSection,
    fileName: string,
  ) {
    const adventure = preview.adventure;
    if (section === "characters") {
      setForm((current) => ({
        ...current,
        playerName: adventure.player.name,
        playerDescription: adventure.player.description,
        mainCharacterName: adventure.mainCharacter.name,
        mainCharacterRole: adventure.mainCharacter.role,
        mainCharacterPersonality: adventure.mainCharacter.personality,
        mainCharacterFirstMessage:
          adventure.mainCharacter.firstMessage ?? "",
      }));
      setPlayerCharacterCard(adventure.player.card ?? null);
      setPlayerCharacterSourceFile(fileName);
      setMainCharacterCard(adventure.mainCharacter.card ?? null);
      setMainCharacterSourceFile(fileName);
      setAdditionalCharacters(
        (adventure.additionalCharacters ?? []).map((character) => ({
          id: crypto.randomUUID(),
          name: character.name,
          role: character.role,
          personality: character.personality,
          firstMessage: character.firstMessage ?? "",
          card: character.card,
          sourceFile: fileName,
          initiallyPresent: character.initiallyPresent,
        })),
      );
      return;
    }
    if (section === "world_book") {
      setImportedWorldBooks([
        {
          ...preview.worldBook,
          id: crypto.randomUUID(),
          fileName: `${fileName} · AI 重做世界书`,
        },
      ]);
      return;
    }
    if (section === "story_modules") {
      setStoryModules(adventure.storyModules ?? []);
      setInitialStoryModuleId(adventure.initialStoryModuleId ?? "");
      setForm((current) => ({
        ...current,
        initialStoryDirection: adventure.initialStoryDirection ?? "",
      }));
      return;
    }
    setForm((current) => ({
      ...current,
      openingLocationName: adventure.openingLocationName ?? "",
      openingScene: adventure.openingScene,
      initialStoryDirection: adventure.initialStoryDirection ?? "",
    }));
  }

  function currentBundleRevisionSnapshot(
    section: BundleRegenerationSection,
  ): BundleRevisionSnapshotItem[] {
    if (section === "characters") {
      return [
        {
          key: "player",
          label: `玩家角色 · ${form.playerName || "未命名"}`,
          content: characterSnapshotContent({
            name: form.playerName,
            role: form.playerDescription,
            personality: cardText(playerCharacterCard ?? undefined, "personality"),
            card: playerCharacterCard ?? undefined,
          }),
        },
        {
          key: "main",
          label: `主要角色 · ${form.mainCharacterName || "未命名"}`,
          content: characterSnapshotContent({
            name: form.mainCharacterName,
            role: form.mainCharacterRole,
            personality: form.mainCharacterPersonality,
            firstMessage: form.mainCharacterFirstMessage,
            card: mainCharacterCard ?? undefined,
          }),
        },
        ...additionalCharacters.map((character) => ({
          key: `additional:${character.name.toLocaleLowerCase("zh-CN")}`,
          label: `其他角色 · ${character.name || "未命名"}`,
          content: characterSnapshotContent({
            ...character,
            card: character.card,
            initiallyPresent: character.initiallyPresent,
          }),
        })),
      ];
    }
    if (section === "world_book") {
      const seenKeys = new Map<string, number>();
      return importedWorldBooks.flatMap((book) =>
        book.entries.map((entry, index) => {
          const baseKey = `world:${entry.sourceId || entry.comment || index + 1}`;
          const occurrence = (seenKeys.get(baseKey) ?? 0) + 1;
          seenKeys.set(baseKey, occurrence);
          return {
            key: occurrence === 1 ? baseKey : `${baseKey}#${occurrence}`,
            label: `${entry.comment || `世界书条目 ${index + 1}`} · ${book.name}`,
            content: worldBookEntrySnapshotContent(entry),
          };
        }),
      );
    }
    if (section === "story_modules") {
      return [
        ...storyModules.map((module) => ({
          key: `story:${module.id}`,
          label: module.title,
          content: storyModuleSnapshotContent(module),
        })),
        {
          key: "story:initial-direction",
          label: "初始剧情目标",
          content: displayText(form.initialStoryDirection),
        },
      ];
    }
    return [
      {
        key: "opening:location",
        label: "开场地点",
        content: displayText(form.openingLocationName),
      },
      {
        key: "opening:scene",
        label: "开场正文",
        content: displayText(form.openingScene),
      },
      {
        key: "opening:direction",
        label: "初始剧情目标",
        content: displayText(form.initialStoryDirection),
      },
    ];
  }

  async function importAdventureBundle(file: File | undefined) {
    if (!file || importingKind) return;
    if (
      hasUnsavedOpeningDraft() &&
      !window.confirm(
        "导入剧本包会替换当前尚未保存的开局表单、人物卡和世界书。是否继续？",
      )
    ) {
      return;
    }

    setImportingKind("adventure_bundle");
    setImportError("");
    setImportNotice("");
    try {
      const result = await previewImportFile("adventure_bundle", file);
      if (result.preview.kind !== "adventure_bundle") {
        throw new Error(`《${file.name}》不是剧本导入包。`);
      }
      const preview = result.preview;
      const summary = applyAdventureBundlePreview(preview, result.fileName);
      setGeneratedBundleDocument(null);
      setGeneratedBundleSummary(null);
      setPendingBundleRevision(null);
      clearSourceAnalysis();
      setImportNotice(
        `已载入《${preview.name}》：${summary}。可见开局内容仍可编辑。`,
      );
    } catch (reason) {
      setImportError(
        reason instanceof Error ? reason.message : "导入剧本包失败。",
      );
    } finally {
      setImportingKind("");
    }
  }

  async function analyzeAdventureSource(file: File | undefined) {
    if (!file || importingKind) return;
    if (!/\.(txt|md)$/i.test(file.name)) {
      setImportError("AI 原文分析目前只支持 UTF-8 TXT 或 Markdown 原文。");
      return;
    }
    if (file.size > 3_500_000) {
      setImportError("原文文件不能超过 3.5 MB；超长作品请先按部或卷拆分。");
      return;
    }

    setImportingKind("source_analysis");
    setImportError("");
    setImportNotice(
      "正在读取原文并分析人物与开场候选；这会调用当前模型，但不会覆盖现有表单。",
    );
    try {
      const content = await file.text();
      if (content.trim().length < 200) {
        throw new Error("原文至少需要 200 个字符，才能分析人物与开场。");
      }
      if (content.trim().length > 900_000) {
        throw new Error("用于自动生成的原文不能超过 900,000 个字符。");
      }
      const response = await fetch("/api/imports/analyze-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, content }),
      });
      const body = (await response.json()) as SourceAnalysisResponse;
      if (!response.ok || !body.analysis || !body.fileName) {
        throw new Error(
          body.issues?.[0] ?? body.error ?? "无法从原文得到有效分析。",
        );
      }
      setPendingSourceAnalysis({ fileName: body.fileName, content });
      setSourceStoryAnalysis(body.analysis);
      setSourceAnalysisSummary(body.generation ?? null);
      setSelectedSourcePlayer(body.analysis.recommendedPlayerName);
      setSelectedSourceMainCharacter(body.analysis.recommendedMainCharacterName);
      setSelectedSourceOpeningId(body.analysis.recommendedOpeningId);
      const generation = body.generation;
      const sampleDescription = generation
        ? generation.fullSourceSent
          ? "分析时已向模型发送完整原文"
          : `原文共 ${generation.sourceCharacters.toLocaleString("zh-CN")} 字符，分析时发送了 ${generation.sampledCharacters.toLocaleString("zh-CN")} 字符的 ${generation.excerptCount} 个代表片段`
        : "已完成原文分析";
      setImportNotice(
        `已分析《${body.analysis.storyTitle}》：识别 ${body.analysis.characters.length} 名人物和 ${body.analysis.openingCandidates.length} 个开场候选。${sampleDescription}${generation ? `；调用 ${generation.requestCount} 次 ${generation.model}` : ""}。请确认分工后再生成剧本包。`,
      );
    } catch (reason) {
      setImportError(
        reason instanceof Error ? reason.message : "分析剧本原文失败。",
      );
      setImportNotice("");
    } finally {
      setImportingKind("");
    }
  }

  async function generateAdventureBundle() {
    if (
      !pendingSourceAnalysis ||
      !sourceStoryAnalysis ||
      !selectedSourceOpening ||
      importingKind
    ) {
      return;
    }
    if (!selectedSourcePlayer || !selectedSourceMainCharacter) {
      setImportError("请选择玩家角色和主要 AI 角色。");
      return;
    }
    if (selectedSourcePlayer === selectedSourceMainCharacter) {
      setImportError("玩家角色和主要 AI 角色不能是同一个人物。");
      return;
    }
    if (
      hasUnsavedOpeningDraft() &&
      !window.confirm(
        "按确认结果生成的剧本包会在成功后替换当前尚未保存的开局表单，并再次调用当前模型。是否继续？",
      )
    ) {
      return;
    }

    setImportingKind("source_bundle_generation");
    setImportError("");
    setImportNotice(
      `正在按“${selectedSourcePlayer} / ${selectedSourceMainCharacter} / ${selectedSourceOpening.title}”生成并校验标准剧本包。`,
    );
    try {
      const response = await fetch("/api/imports/generate-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: pendingSourceAnalysis.fileName,
          content: pendingSourceAnalysis.content,
          preferences: {
            playerCharacterName: selectedSourcePlayer,
            mainCharacterName: selectedSourceMainCharacter,
            openingChapterIndex: selectedSourceOpening.chapterIndex,
            openingTitle: selectedSourceOpening.title,
            openingLocation: selectedSourceOpening.location,
            openingSummary: selectedSourceOpening.summary,
          },
        }),
      });
      const body = (await response.json()) as GeneratedBundleResponse;
      if (!response.ok || !body.preview || !body.document || !body.fileName) {
        throw new Error(
          body.issues?.[0] ?? body.error ?? "无法从确认结果生成有效剧本包。",
        );
      }
      const summary = applyAdventureBundlePreview(body.preview, body.fileName);
      setGeneratedBundleDocument(body.document);
      setGeneratedBundleSummary(body.generation ?? null);
      setBundleRevisionFeedback("");
      setPendingBundleRevision(null);
      const generation = body.generation;
      setImportNotice(
        `已按确认结果生成并自动填入《${body.preview.name}》：${summary}${generation ? `；本阶段调用 ${generation.requestCount} 次 ${generation.model}` : ""}。请在创建前继续检查人物卡、世界书和开场正文。`,
      );
    } catch (reason) {
      setImportError(
        reason instanceof Error ? reason.message : "从确认结果生成剧本包失败。",
      );
      setImportNotice("");
    } finally {
      setImportingKind("");
    }
  }

  async function regenerateGeneratedBundleSection() {
    if (!generatedBundleDocument || importingKind || pendingBundleRevision) {
      return;
    }
    const feedback = bundleRevisionFeedback.trim();
    if (!feedback) {
      setImportError("请先说明对当前内容不满意的原因或具体修改要求。");
      return;
    }
    if (feedback.length > 2_000) {
      setImportError("分区修改意见不能超过 2,000 个字符。");
      return;
    }

    const baselineSnapshot = currentBundleRevisionSnapshot(
      bundleRevisionSection,
    );
    setImportingKind("source_bundle_revision");
    setImportError("");
    setImportNotice(
      `正在按修改意见重新生成${bundleSectionLabel(bundleRevisionSection)}；其他分区和对应表单不会被替换。`,
    );
    try {
      const response = await fetch("/api/imports/regenerate-bundle-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: generatedBundleDocument,
          section: bundleRevisionSection,
          feedback,
        }),
      });
      const body = (await response.json()) as BundleSectionRegenerationResponse;
      if (
        !response.ok ||
        !body.preview ||
        !body.document ||
        !body.fileName ||
        body.section !== bundleRevisionSection
      ) {
        throw new Error(
          body.issues?.[0] ?? body.error ?? "无法重新生成所选剧本分区。",
        );
      }
      const proposedSnapshot = proposedBundleRevisionSnapshot(
        body.preview,
        bundleRevisionSection,
      );
      setPendingBundleRevision({
        fileName: body.fileName,
        document: body.document,
        preview: body.preview,
        generation: body.generation ?? null,
        section: bundleRevisionSection,
        feedback,
        baselineFingerprint:
          bundleRevisionSnapshotFingerprint(baselineSnapshot),
        differences: compareBundleRevisionSnapshots(
          baselineSnapshot,
          proposedSnapshot,
        ),
      });
      const generation = body.generation;
      setImportNotice(
        `${bundleSectionLabel(bundleRevisionSection)}的新版本已生成并通过整包校验，但尚未应用${generation ? `；本次调用 ${generation.requestCount} 次 ${generation.model}` : ""}。请比较差异后选择采用或放弃。`,
      );
    } catch (reason) {
      setImportError(
        reason instanceof Error ? reason.message : "重新生成剧本分区失败。",
      );
      setImportNotice("");
    } finally {
      setImportingKind("");
    }
  }

  function adoptPendingBundleRevision() {
    if (!pendingBundleRevision || importingKind) return;
    const currentFingerprint = bundleRevisionSnapshotFingerprint(
      currentBundleRevisionSnapshot(pendingBundleRevision.section),
    );
    if (currentFingerprint !== pendingBundleRevision.baselineFingerprint) {
      setImportError(
        `${bundleSectionLabel(pendingBundleRevision.section)}在预览生成期间又被修改。为避免覆盖未预览的内容，请先放弃本结果，再重新生成一次。`,
      );
      return;
    }
    applyRegeneratedBundleSection(
      pendingBundleRevision.preview,
      pendingBundleRevision.section,
      pendingBundleRevision.fileName,
    );
    setGeneratedBundleDocument(pendingBundleRevision.document);
    setGeneratedBundleSummary(pendingBundleRevision.generation);
    setBundleSourceFile(pendingBundleRevision.fileName);
    setBundleRevisionFeedback("");
    setPendingBundleRevision(null);
    setImportError("");
    setImportNotice(
      `${bundleSectionLabel(pendingBundleRevision.section)}的新版本已采用；未选中的表单草稿保持不变。`,
    );
  }

  function discardPendingBundleRevision() {
    if (!pendingBundleRevision || importingKind) return;
    const sectionLabel = bundleSectionLabel(pendingBundleRevision.section);
    setPendingBundleRevision(null);
    setImportError("");
    setImportNotice(
      `已放弃${sectionLabel}的新版本；当前表单和可下载生成包均未改变。修改意见已保留，可调整后重新生成。`,
    );
  }

  function downloadGeneratedBundle() {
    if (!generatedBundleDocument || !bundleSourceFile) return;
    const blob = new Blob(
      [`${JSON.stringify(generatedBundleDocument, null, 2)}\n`],
      { type: "application/json;charset=utf-8" },
    );
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = bundleSourceFile;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  }

  async function deleteAdventure(adventure: AdventureSummary) {
    const confirmed = window.confirm(
      `确定删除《${adventure.campaignName}》吗？\n\n该剧本的全部回合、角色状态、世界书变化和导演目标都会从当前数据库删除。只有事先存在的整库备份或完整存档可以恢复这些内容。`,
    );
    if (!confirmed || deletingSessionId || renamingSessionId) return;

    setDeletingSessionId(adventure.sessionId);
    setArchiveError("");
    try {
      const response = await fetch(`/api/adventures/${adventure.sessionId}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "删除剧本失败。");
      setAdventures((items) =>
        items.filter((item) => item.sessionId !== adventure.sessionId),
      );
    } catch (reason) {
      setArchiveError(
        reason instanceof Error ? reason.message : "删除剧本失败。",
      );
    } finally {
      setDeletingSessionId("");
    }
  }

  async function importCompleteArchive(file: File | undefined) {
    if (!file || importingArchive || backupOperation) return;
    setArchiveError("");
    setDataSafetyNotice("");
    setImportingArchive(true);
    try {
      if (file.size > 100_000_000) {
        throw new Error(`《${file.name}》超过 100 MB，无法导入。`);
      }
      let document: unknown;
      try {
        document = JSON.parse(await file.text()) as unknown;
      } catch {
        throw new Error(`《${file.name}》不是有效的 JSON 文件。`);
      }
      const previewResponse = await fetch("/api/archives/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document }),
      });
      const previewBody = (await previewResponse.json()) as {
        preview?: CompleteArchivePreview;
        error?: string;
        issues?: string[];
      };
      if (!previewResponse.ok || !previewBody.preview) {
        throw new Error(
          previewBody.issues?.[0] ?? previewBody.error ?? "完整存档校验失败。",
        );
      }
      const summary = previewBody.preview.summary;
      const confirmed = window.confirm(
        `已通过完整性校验：\n\n《${summary.campaignName}》\n${summary.branchCount} 条分支 · ${summary.turnCount} 个回合 · ${summary.characterCount} 名角色 · ${summary.manualSaveCount} 个手动存档\n\n导入会创建一份名称带“（导入）”的新剧本，不覆盖现有内容。是否继续？`,
      );
      if (!confirmed) return;

      const importResponse = await fetch("/api/archives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document }),
      });
      const importBody = (await importResponse.json()) as {
        imported?: { sessionId: string; campaignName: string };
        error?: string;
        issues?: string[];
      };
      if (!importResponse.ok || !importBody.imported) {
        throw new Error(
          importBody.issues?.[0] ?? importBody.error ?? "导入完整存档失败。",
        );
      }
      window.location.assign(`/game/${importBody.imported.sessionId}`);
    } catch (reason) {
      setArchiveError(
        reason instanceof Error ? reason.message : "导入完整存档失败。",
      );
    } finally {
      setImportingArchive(false);
    }
  }

  async function createBackup() {
    if (backupOperation || importingArchive) return;
    setBackupOperation("create");
    setArchiveError("");
    setDataSafetyNotice("");
    try {
      const response = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "create" }),
      });
      const body = (await response.json()) as BackupsResponse;
      if (!response.ok) throw new Error(body.error ?? "创建备份失败。");
      setBackups(body.backups ?? []);
      setDataSafetyNotice("已建立一份完整的本地数据库备份。");
    } catch (reason) {
      setArchiveError(
        reason instanceof Error ? reason.message : "创建备份失败。",
      );
    } finally {
      setBackupOperation("");
    }
  }

  async function restoreBackup(backup: LocalBackup) {
    if (backupOperation || importingArchive) return;
    const confirmed = window.confirm(
      `确定恢复 ${formatDate(backup.createdAt)} 的整库备份吗？\n\n当前数据库将替换为该时刻的全部剧本。系统会先自动保存一份“恢复前备份”，以便回退。`,
    );
    if (!confirmed) return;
    setBackupOperation(backup.fileName);
    setArchiveError("");
    setDataSafetyNotice("");
    try {
      const response = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "restore",
          fileName: backup.fileName,
        }),
      });
      const body = (await response.json()) as BackupsResponse;
      if (!response.ok) throw new Error(body.error ?? "恢复备份失败。");
      setBackups(body.backups ?? []);
      setAdventures(body.adventures ?? []);
      setDataSafetyNotice("整库备份已恢复；操作前的数据也已另存为安全备份。");
    } catch (reason) {
      setArchiveError(
        reason instanceof Error ? reason.message : "恢复备份失败。",
      );
    } finally {
      setBackupOperation("");
    }
  }

  async function renameAdventure(
    event: FormEvent<HTMLFormElement>,
    adventure: AdventureSummary,
  ) {
    event.preventDefault();
    if (renamingSessionId || deletingSessionId) return;
    const name = renameValue.trim();
    if (!name) {
      setRenameError("剧本名称不能为空。");
      return;
    }
    setRenamingSessionId(adventure.sessionId);
    setRenameError("");
    try {
      const response = await fetch(`/api/adventures/${adventure.sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json()) as RenameAdventureResponse;
      if (!response.ok || !body.adventure) {
        throw new Error(
          body.issues?.[0] ?? body.error ?? "修改剧本名称失败。",
        );
      }
      const renamed = body.adventure;
      setAdventures((items) =>
        items
          .map((item) =>
            item.campaignId === renamed.campaignId
              ? {
                  ...item,
                  campaignName: renamed.name,
                  sessionName: item.sessionName.startsWith(item.campaignName)
                    ? `${renamed.name}${item.sessionName.slice(item.campaignName.length)}`
                    : item.sessionName,
                  updatedAt: renamed.changed ? renamed.updatedAt : item.updatedAt,
                }
              : item,
          )
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      );
      setEditingSessionId("");
      setRenameValue("");
    } catch (reason) {
      setRenameError(
        reason instanceof Error ? reason.message : "修改剧本名称失败。",
      );
    } finally {
      setRenamingSessionId("");
    }
  }

  async function submitAdventure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/adventures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignName: form.campaignName,
          campaignDescription: form.campaignDescription,
          world: { name: form.worldName, premise: form.worldPremise },
          player: {
            name: form.playerName,
            description: form.playerDescription,
            card: playerCharacterCard ?? undefined,
          },
          mainCharacter: {
            name: form.mainCharacterName,
            role: form.mainCharacterRole,
            personality: form.mainCharacterPersonality,
            firstMessage: form.mainCharacterFirstMessage,
            card: mainCharacterCard ?? undefined,
          },
          additionalCharacters: additionalCharacters.map((character) => ({
            name: character.name,
            role: character.role,
            personality: character.personality,
            firstMessage: character.firstMessage,
            card: character.card,
            initiallyPresent: character.initiallyPresent,
          })),
          worldBookEntries: importedWorldBooks.flatMap((book) => book.entries),
          sourceDocuments,
          openingLocationName: form.openingLocationName,
          openingScene: form.openingScene,
          initialStoryDirection: form.initialStoryDirection,
          storyModules,
          initialStoryModuleId: initialStoryModuleId || undefined,
          ...(bundleRelationships.length > 0
            ? { initialRelationships: bundleRelationships }
            : {}),
          ...(bundleLocations.length > 0
            ? { locations: bundleLocations }
            : {}),
          ...(bundleForeshadowing.length > 0
            ? { foreshadowing: bundleForeshadowing }
            : {}),
          ...(bundleTriggers.length > 0
            ? { triggers: bundleTriggers }
            : {}),
        }),
      });
      const body = (await response.json()) as CreateAdventureResponse;
      if (!response.ok || !body.adventure) {
        throw new Error(body.issues?.[0] ?? body.error ?? "创建战役失败。");
      }
      window.location.assign(`/game/${body.adventure.sessionId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建战役失败。");
      setSubmitting(false);
    }
  }

  function exitApplication() {
    const desktopBridge = (
      window as Window & {
        aiTavernDesktop?: { quit: () => void };
      }
    ).aiTavernDesktop;
    if (desktopBridge) {
      desktopBridge.quit();
      return;
    }
    window.close();
    setExitNotice("当前运行在网页开发模式，请关闭这个浏览器页面结束使用。");
  }

  const mainMenu = (
      <main className="main-menu-page">
        <div className="start-glow start-glow-one" aria-hidden="true" />
        <div className="start-glow start-glow-two" aria-hidden="true" />
        <section className="main-menu-shell" aria-labelledby="main-menu-title">
          <header className="main-menu-brand">
            <p className="brand-mark">本地互动叙事</p>
            <h1 id="main-menu-title">AI 酒馆</h1>
            <p>
              世界、人物与每一次选择都只保存在这台电脑上。
            </p>
            <div>
              <span className="local-dot" aria-hidden="true" />
              本地数据库已连接
            </div>
          </header>

          <nav className="main-menu-actions" aria-label="游戏主菜单">
            <button type="button" onClick={() => setHomeView("new")}>
              <span>01</span>
              <strong>新剧本</strong>
              <small>建立世界、导入资料并开始第一幕</small>
              <i aria-hidden="true">→</i>
            </button>
            <button type="button" onClick={() => setHomeView("continue")}>
              <span>02</span>
              <strong>继续游戏</strong>
              <small>
                {loadingList
                  ? "正在读取本地档案……"
                  : adventures.length > 0
                    ? `${adventures.length} 个本地剧本可继续`
                    : "目前没有已保存的剧本"}
              </small>
              <i aria-hidden="true">→</i>
            </button>
            <button
              className="main-menu-api"
              type="button"
              disabled={!modelStatus}
              onClick={openModelSettings}
            >
              <span>03</span>
              <strong>API 配置</strong>
              <small>
                {modelStatus
                  ? modelStatus.configured
                    ? `${modelStatus.providerLabel} · ${modelStatus.model}`
                    : "选择模型供应商并检查连接"
                  : "正在读取本机配置……"}
              </small>
              <i aria-hidden="true">→</i>
            </button>
            <button className="main-menu-exit" type="button" onClick={exitApplication}>
              <span>04</span>
              <strong>退出</strong>
              <small>保存完成后关闭 AI 酒馆</small>
              <i aria-hidden="true">×</i>
            </button>
          </nav>
        </section>
        <footer className="main-menu-footer">
          <span>
            {modelStatus?.providerLabel ?? "AI 模型"} · {modelStatus?.configured ? modelStatus.model : "尚未配置"}
            {modelStatus?.version ? ` · v${modelStatus.version}` : ""}
          </span>
          <a href="/manual">操作手册</a>
        </footer>
        {exitNotice ? (
          <p className="main-menu-notice" role="status">
            {exitNotice}
          </p>
        ) : null}
      </main>
  );

  return (
    <>
      {homeView === "menu" ? mainMenu : (
      <main className={`start-page ${homeView === "continue" ? "continue-page" : "new-story-page"}`}>
      <div className="start-glow start-glow-one" aria-hidden="true" />
      <div className="start-glow start-glow-two" aria-hidden="true" />

      <aside className="start-sidebar">
        <div>
          <p className="brand-mark">本地互动叙事</p>
          <h1>AI 酒馆</h1>
          <p className="brand-copy">
            {homeView === "continue"
              ? "选择一份本地档案，回到尚未结束的故事。"
              : "写下世界、角色与第一幕。所有故事只保存在这台电脑上。"}
          </p>
          <button
            className="secondary-back-button"
            type="button"
            onClick={() => setHomeView("menu")}
          >
            <span aria-hidden="true">←</span>
            返回主菜单
          </button>
        </div>

        {homeView === "continue" ? (
          <section className="saved-section" aria-labelledby="saved-title">
          <div className="section-heading compact-heading">
            <div>
              <span className="section-number">本地档案</span>
              <h2 id="saved-title">继续故事</h2>
            </div>
            <span className="record-count">{adventures.length}</span>
          </div>

          <div className="saved-list" aria-live="polite">
            {loadingList ? (
              <p className="quiet-message">正在翻阅酒馆账本……</p>
            ) : adventures.length === 0 ? (
              <div className="empty-record">
                <span aria-hidden="true">00</span>
                <p>还没有保存的故事。第一场冒险将从右侧开始。</p>
              </div>
            ) : (
              adventures.map((adventure) => (
                <article
                  className="saved-record"
                  key={adventure.sessionId}
                >
                  <Link
                    className="saved-card"
                    href={`/game/${adventure.sessionId}`}
                  >
                    <span className="saved-world">
                      {adventure.worldName || "未命名世界"}
                    </span>
                    <strong>{adventure.campaignName}</strong>
                    <small>
                      {adventure.playerName || "玩家"} × {adventure.mainCharacterName || "角色"}
                    </small>
                    <time>{formatDate(adventure.updatedAt)}</time>
                  </Link>
                  {editingSessionId === adventure.sessionId ? (
                    <form
                      className="saved-rename-form"
                      onSubmit={(event) => void renameAdventure(event, adventure)}
                    >
                      <label>
                        <span>新的剧本名称</span>
                        <input
                          required
                          autoFocus
                          maxLength={80}
                          value={renameValue}
                          disabled={renamingSessionId === adventure.sessionId}
                          onChange={(event) => {
                            setRenameValue(event.target.value);
                            setRenameError("");
                          }}
                        />
                      </label>
                      <div>
                        <button
                          type="button"
                          disabled={renamingSessionId === adventure.sessionId}
                          onClick={() => {
                            setEditingSessionId("");
                            setRenameValue("");
                            setRenameError("");
                          }}
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          disabled={
                            renamingSessionId === adventure.sessionId ||
                            !renameValue.trim()
                          }
                        >
                          {renamingSessionId === adventure.sessionId
                            ? "保存中"
                            : "保存名称"}
                        </button>
                      </div>
                      {renameError ? (
                        <p role="alert">{renameError}</p>
                      ) : null}
                    </form>
                  ) : (
                    <div className="saved-record-actions">
                      <a
                        href={`/api/adventures/${adventure.sessionId}/archive`}
                        download
                        title="导出全部分支、回合和运行状态"
                      >
                        导出
                      </a>
                      <button
                        type="button"
                        disabled={Boolean(deletingSessionId || renamingSessionId)}
                        onClick={() => {
                          setEditingSessionId(adventure.sessionId);
                          setRenameValue(adventure.campaignName);
                          setRenameError("");
                        }}
                      >
                        重命名
                      </button>
                      <button
                        className="delete-adventure-button"
                        type="button"
                        aria-label={`删除剧本《${adventure.campaignName}》`}
                        disabled={Boolean(deletingSessionId || renamingSessionId)}
                        onClick={() => void deleteAdventure(adventure)}
                      >
                        {deletingSessionId === adventure.sessionId
                          ? "删除中"
                          : "删除"}
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
          <details className="data-safety-panel">
            <summary>整库备份与恢复</summary>
            <p>
              数据库备份用于把这台电脑上的全部剧本恢复到过去时刻；单个游戏存档请从右侧“导入游戏存档”进入。
            </p>
            <div className="data-safety-actions">
              <button
                type="button"
                disabled={importingArchive || Boolean(backupOperation)}
                onClick={() => void createBackup()}
              >
                {backupOperation === "create" ? "备份中……" : "立即备份整库"}
              </button>
            </div>
            <div className="backup-list">
              {backups.length === 0 ? (
                <span>首次写入数据后会自动建立备份。</span>
              ) : (
                backups.map((backup) => (
                  <div key={backup.fileName}>
                    <span>
                      {formatDate(backup.createdAt)} · {backupReasonLabel(backup.reason)} · {formatBytes(backup.size)}
                    </span>
                    <button
                      type="button"
                      disabled={importingArchive || Boolean(backupOperation)}
                      onClick={() => void restoreBackup(backup)}
                    >
                      {backupOperation === backup.fileName ? "恢复中……" : "恢复"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </details>
          </section>
        ) : (
          <section className="secondary-view-note">
            <span>新剧本</span>
            <strong>资料准备与第一幕</strong>
            <p>
              可以手工填写，也可以导入完整剧本包或让 AI 从原文生成资料。创建完成后会直接进入游戏界面。
            </p>
          </section>
        )}

        <div className="sidebar-footer">
          <div className="local-note">
            <span className="local-dot" aria-hidden="true" />
            本地数据库已连接
          </div>
        </div>
      </aside>

      {homeView === "new" ? (
        <section className="start-content" aria-labelledby="create-title">
        <header className="start-header">
          <div>
            <p className="eyebrow">新建战役 · 第一步</p>
            <h2 id="create-title">点亮第一盏灯</h2>
            <p>
              手工填写和普通文件导入不会调用模型；“AI 原文分析/生成”会分两阶段把原文或代表片段发送给当前供应商并消耗 API 额度。
            </p>
          </div>
          <button
            className="example-button"
            type="button"
            onClick={() => {
              setForm(exampleForm);
              setAdditionalCharacters(exampleAdditionalCharacters);
              setPlayerCharacterCard(null);
              setPlayerCharacterSourceFile("");
              setMainCharacterCard(null);
              setMainCharacterSourceFile("");
              setBundleSourceFile("");
              setGeneratedBundleDocument(null);
              setGeneratedBundleSummary(null);
              setPendingBundleRevision(null);
              clearSourceAnalysis();
              setImportedWorldBooks([]);
              setSourceDocuments([]);
              setStoryModules([]);
              setInitialStoryModuleId("");
              setBundleForeshadowing([]);
              setBundleTriggers([]);
              setImportNotice("");
              setImportError("");
              setError("");
            }}
          >
            填入示例
          </button>
        </header>

        <form className="setup-form" onSubmit={submitAdventure}>
          <section className="import-workbench" aria-labelledby="import-title">
            <header>
              <div>
                <span className="section-number">可选 · 本地文件</span>
                <h3 id="import-title">导入或生成剧本资料</h3>
                <p>
                  标准剧本包可一次载入全部资料；也可以上传 TXT/Markdown
                  原文，先确认人物分工和开场，再生成并自动填入。普通 JSON
                  只在本机解析，两个 AI 阶段都会把完整短文或长文代表片段发送给当前供应商。
                </p>
              </div>
              <div className="import-standard-links">
                <a href="/文件标准/导入材料文件结构指导手册.md" download>
                  结构手册
                </a>
                <a href="/文件标准/剧本包项目标准示例.json" download>
                  项目清单
                </a>
                <a href="/文件标准/人物卡标准示例.json" download>
                  人物卡示例
                </a>
                <a href="/文件标准/世界书标准示例.json" download>
                  世界书示例
                </a>
                <a href="/文件标准/剧本包标准示例.json" download>
                  剧本包示例
                </a>
              </div>
            </header>

            <div className="import-actions">
              <label
                className={`import-file-button source-generation-button${
                  modelStatus?.configured ? "" : " disabled"
                }`}
              >
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  disabled={Boolean(importingKind) || !modelStatus?.configured}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void analyzeAdventureSource(file);
                  }}
                />
                <span>AI 原文分析</span>
                <strong>
                  {importingKind === "source_analysis"
                    ? "正在分析人物与开场……"
                    : modelStatus?.configured
                      ? "上传原文，先确认分工"
                      : "请先配置可用模型"}
                </strong>
                <small>
                  先预览人物和开场候选；确认后再生成标准剧本包
                </small>
              </label>
              <label className="import-file-button featured-import-button">
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={Boolean(importingKind)}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void importAdventureBundle(file);
                  }}
                />
                <span>剧本包 · 推荐</span>
                <strong>
                  {importingKind === "adventure_bundle"
                    ? "正在校验整包……"
                    : "导入完整剧本 JSON"}
                </strong>
                <small>一次填入玩家、角色、世界书、原文参考和第一幕</small>
              </label>
              <label className="import-file-button">
                <input
                  type="file"
                  accept=".json,application/json"
                  multiple
                  disabled={Boolean(importingKind)}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    void importCharacterFiles(files);
                  }}
                />
                <span>人物卡</span>
                <strong>
                  {importingKind === "character_card"
                    ? "正在校验……"
                    : "选择人物卡 JSON"}
                </strong>
                <small>首张填入主要角色，其余加入其他角色</small>
              </label>
              <label className="import-file-button">
                <input
                  type="file"
                  accept=".json,application/json"
                  multiple
                  disabled={Boolean(importingKind)}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    void importWorldBookFiles(files);
                  }}
                />
                <span>世界书</span>
                <strong>
                  {importingKind === "world_book"
                    ? "正在校验……"
                    : "选择世界书 JSON"}
                </strong>
                <small>支持多份，总计最多 200 条</small>
              </label>
            </div>

            {sourceStoryAnalysis && pendingSourceAnalysis ? (
              <article className="source-analysis-card">
                <header>
                  <div>
                    <span>第一阶段 · 原文分析完成</span>
                    <h4>{sourceStoryAnalysis.storyTitle}</h4>
                    <p>{sourceStoryAnalysis.overview}</p>
                  </div>
                  <small>
                    {pendingSourceAnalysis.fileName}
                    {sourceAnalysisSummary
                      ? ` · ${sourceAnalysisSummary.model} · ${sourceAnalysisSummary.requestCount} 次请求${sourceAnalysisSummary.usage.totalTokens ? ` · ${sourceAnalysisSummary.usage.totalTokens.toLocaleString("zh-CN")} token` : ""}`
                      : ""}
                  </small>
                </header>

                <div className="source-role-selection">
                  <label>
                    <span>玩家控制角色</span>
                    <select
                      value={selectedSourcePlayer}
                      disabled={Boolean(importingKind)}
                      onChange={(event) => {
                        setSelectedSourcePlayer(event.target.value);
                        setImportError("");
                      }}
                    >
                      {sourceStoryAnalysis.characters.map((character) => (
                        <option key={character.name} value={character.name}>
                          {character.name} · {sourceImportanceLabel(character.importance)}
                        </option>
                      ))}
                    </select>
                    <small>
                      {
                        sourceStoryAnalysis.characters.find(
                          (character) => character.name === selectedSourcePlayer,
                        )?.playerSuitability
                      }
                    </small>
                  </label>
                  <label>
                    <span>主要 AI 角色</span>
                    <select
                      value={selectedSourceMainCharacter}
                      disabled={Boolean(importingKind)}
                      onChange={(event) => {
                        setSelectedSourceMainCharacter(event.target.value);
                        setImportError("");
                      }}
                    >
                      {sourceStoryAnalysis.characters.map((character) => (
                        <option key={character.name} value={character.name}>
                          {character.name} · {sourceImportanceLabel(character.importance)}
                        </option>
                      ))}
                    </select>
                    <small>
                      {
                        sourceStoryAnalysis.characters.find(
                          (character) =>
                            character.name === selectedSourceMainCharacter,
                        )?.aiSuitability
                      }
                    </small>
                  </label>
                </div>

                {selectedSourcePlayer === selectedSourceMainCharacter ? (
                  <p className="source-analysis-warning" role="alert">
                    玩家角色和主要 AI 角色不能相同，请重新选择。
                  </p>
                ) : null}

                <fieldset className="source-opening-selection">
                  <legend>选择第一幕开场</legend>
                  <div>
                    {sourceStoryAnalysis.openingCandidates.map((opening) => (
                      <label
                        className={
                          opening.id === selectedSourceOpeningId
                            ? "selected"
                            : ""
                        }
                        key={opening.id}
                      >
                        <input
                          type="radio"
                          name="source-opening-candidate"
                          value={opening.id}
                          checked={opening.id === selectedSourceOpeningId}
                          disabled={Boolean(importingKind)}
                          onChange={() => {
                            setSelectedSourceOpeningId(opening.id);
                            setImportError("");
                          }}
                        />
                        <span>第 {opening.chapterIndex} 章或场景</span>
                        <strong>{opening.title}</strong>
                        <small>{opening.location}</small>
                        <p>{opening.summary}</p>
                        <em>
                          在场：
                          {opening.presentCharacterNames.join("、") || "待确认"}
                        </em>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <details className="source-character-preview">
                  <summary>
                    查看全部 {sourceStoryAnalysis.characters.length} 名人物候选
                  </summary>
                  <div>
                    {sourceStoryAnalysis.characters.map((character) => (
                      <article key={character.name}>
                        <header>
                          <strong>{character.name}</strong>
                          <span>{sourceImportanceLabel(character.importance)}</span>
                          {character.appearsNearOpening ? <em>靠近开篇</em> : null}
                        </header>
                        <p>{character.role}</p>
                      </article>
                    ))}
                  </div>
                </details>

                <footer>
                  <p>
                    第二阶段会再次调用当前模型，并严格采用以上人物分工和开场章节。成功后才会替换下方表单。
                  </p>
                  <div>
                    <button
                      type="button"
                      disabled={Boolean(importingKind)}
                      onClick={() => {
                        clearSourceAnalysis();
                        setImportNotice("");
                        setImportError("");
                      }}
                    >
                      取消本次分析
                    </button>
                    <button
                      className="source-generate-confirm-button"
                      type="button"
                      disabled={
                        Boolean(importingKind) ||
                        !selectedSourceOpening ||
                        selectedSourcePlayer === selectedSourceMainCharacter
                      }
                      onClick={() => void generateAdventureBundle()}
                    >
                      {importingKind === "source_bundle_generation"
                        ? "正在生成并校验……"
                        : "按当前选择生成剧本包"}
                    </button>
                  </div>
                </footer>
              </article>
            ) : null}

            {bundleSourceFile ? (
              <article className="imported-bundle-card">
                <div>
                  <span>
                    {generatedBundleDocument
                      ? "AI 已生成标准剧本包"
                      : "已载入完整剧本包"}
                  </span>
                  <strong>{bundleSourceFile}</strong>
                  <small>
                    {generatedBundleSummary
                      ? describeGeneratedBundle(generatedBundleSummary)
                      : "下方所有字段均可在创建前继续修改"}
                  </small>
                </div>
                <div className="imported-bundle-actions">
                  {generatedBundleDocument ? (
                    <button
                      className="bundle-download-button"
                      type="button"
                      onClick={downloadGeneratedBundle}
                    >
                      下载生成包
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setForm(emptyForm);
                      setPlayerCharacterCard(null);
                      setPlayerCharacterSourceFile("");
                      setMainCharacterCard(null);
                      setMainCharacterSourceFile("");
                      setAdditionalCharacters([]);
                      setImportedWorldBooks([]);
                      setSourceDocuments([]);
                      setStoryModules([]);
                      setInitialStoryModuleId("");
                      setBundleForeshadowing([]);
                      setBundleTriggers([]);
                      setBundleSourceFile("");
                      setGeneratedBundleDocument(null);
                      setGeneratedBundleSummary(null);
                      setBundleRevisionFeedback("");
                      setPendingBundleRevision(null);
                      setImportNotice("");
                      setImportError("");
                    }}
                  >
                    清空整包
                  </button>
                </div>
              </article>
            ) : null}

            {generatedBundleDocument ? (
              <details className="bundle-section-regeneration" open>
                <summary>
                  <span>对生成结果不满意？</span>
                  <strong>只重新生成一个部分</strong>
                </summary>
                <div className="bundle-revision-body">
                  <p>
                    选择需要重做的内容并说明原因。模型会参考内嵌原文重新生成；整包校验通过后先展示差异，只有确认采用才更新所选分区。
                  </p>
                  <fieldset>
                    <legend>要重新生成的部分</legend>
                    <div className="bundle-revision-options">
                      {(
                        [
                          [
                            "characters",
                            "角色资料",
                            "玩家、主要角色、其他角色及人物卡",
                          ],
                          [
                            "world_book",
                            "世界书",
                            "世界事实、规则、地点与关系条目",
                          ],
                          [
                            "story_modules",
                            "剧情任务",
                            "任务链、完成条件与初始剧情目标",
                          ],
                          [
                            "opening",
                            "开篇",
                            "开场地点、正文与初始剧情目标",
                          ],
                        ] as const
                      ).map(([value, label, description]) => (
                        <label
                          key={value}
                          className={
                            bundleRevisionSection === value ? "selected" : ""
                          }
                        >
                          <input
                            type="radio"
                            name="bundle-revision-section"
                            value={value}
                            checked={bundleRevisionSection === value}
                            disabled={
                              Boolean(importingKind) ||
                              Boolean(pendingBundleRevision)
                            }
                            onChange={() => setBundleRevisionSection(value)}
                          />
                          <span>
                            <strong>{label}</strong>
                            <small>{description}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="bundle-revision-feedback">
                    <span>不满意的原因或修改要求（必填）</span>
                    <textarea
                      rows={4}
                      maxLength={2_000}
                      value={bundleRevisionFeedback}
                      disabled={
                        Boolean(importingKind) ||
                        Boolean(pendingBundleRevision)
                      }
                      placeholder="例如：主要角色的语气太温顺，请依据原文补强她克制、警惕且会反问的表达方式，并增加两段贴近原文的对话示例。"
                      onChange={(event) =>
                        setBundleRevisionFeedback(event.target.value)
                      }
                    />
                    <small>{bundleRevisionFeedback.length} / 2,000</small>
                  </label>
                  <div className="bundle-revision-footer">
                    <p>
                      未选中的表单编辑会保留；下载包记录的是最近一次通过校验的生成基线，不包含之后手工修改的字段。
                    </p>
                    <button
                      type="button"
                      disabled={
                        Boolean(importingKind) ||
                        Boolean(pendingBundleRevision) ||
                        !bundleRevisionFeedback.trim() ||
                        !modelStatus?.configured
                      }
                      onClick={() => void regenerateGeneratedBundleSection()}
                    >
                      {importingKind === "source_bundle_revision"
                        ? "正在重新生成并校验……"
                        : `只重新生成${bundleSectionLabel(bundleRevisionSection)}`}
                    </button>
                  </div>
                  {pendingBundleRevision ? (
                    <article
                      className="bundle-revision-preview"
                      aria-live="polite"
                    >
                      <header>
                        <div>
                          <span>尚未应用 · 差异预览</span>
                          <h5>
                            {bundleSectionLabel(pendingBundleRevision.section)}
                            的新版本
                          </h5>
                          <p>
                            修改要求：{pendingBundleRevision.feedback}
                          </p>
                        </div>
                        <small>
                          {
                            pendingBundleRevision.differences.filter(
                              (item) => item.status !== "unchanged",
                            ).length
                          }{" "}
                          项变化 · {
                            pendingBundleRevision.differences.filter(
                              (item) => item.status === "unchanged",
                            ).length
                          }{" "}
                          项未变化
                        </small>
                      </header>

                      <div className="bundle-revision-diff-list">
                        {pendingBundleRevision.differences.some(
                          (item) => item.status !== "unchanged",
                        ) ? (
                          pendingBundleRevision.differences
                            .filter((item) => item.status !== "unchanged")
                            .map((item) => (
                              <section
                                key={item.key}
                                className={`bundle-revision-diff-row ${item.status}`}
                              >
                                <header>
                                  <strong>{item.label}</strong>
                                  <span>
                                    {bundleDiffStatusLabel(item.status)}
                                  </span>
                                </header>
                                <div>
                                  <article>
                                    <span>当前表单</span>
                                    <pre>
                                      {item.before || "（当前没有这一项）"}
                                    </pre>
                                  </article>
                                  <article>
                                    <span>AI 新版本</span>
                                    <pre>
                                      {item.after || "（新版本删除这一项）"}
                                    </pre>
                                  </article>
                                </div>
                              </section>
                            ))
                        ) : (
                          <p className="bundle-revision-no-difference">
                            新版本与当前表单的可比较内容相同。可以放弃结果，或在确认后仍采用通过校验的生成版本。
                          </p>
                        )}
                      </div>

                      <footer>
                        <p>
                          采用后才会替换上方所选分区和下载基线；如果预览期间修改过该分区，系统会阻止覆盖。
                        </p>
                        <div>
                          <button
                            type="button"
                            disabled={Boolean(importingKind)}
                            onClick={discardPendingBundleRevision}
                          >
                            放弃新版本
                          </button>
                          <button
                            className="bundle-revision-adopt-button"
                            type="button"
                            disabled={Boolean(importingKind)}
                            onClick={adoptPendingBundleRevision}
                          >
                            采用新版本
                          </button>
                        </div>
                      </footer>
                    </article>
                  ) : null}
                </div>
              </details>
            ) : null}

            {importedWorldBooks.length > 0 ? (
              <div className="imported-book-list">
                {importedWorldBooks.map((book) => (
                  <article key={book.id}>
                    <div>
                      <strong>{book.name}</strong>
                      <small>
                        {book.fileName} · {book.entries.length} 条 · {book.format}
                      </small>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setImportedWorldBooks((books) =>
                          books.filter((item) => item.id !== book.id),
                        )
                      }
                    >
                      移除
                    </button>
                  </article>
                ))}
              </div>
            ) : null}

            {importNotice ? (
              <p className="import-notice" role="status">
                {importNotice}
              </p>
            ) : null}
            {importError ? (
              <p className="import-error" role="alert">
                {importError}
              </p>
            ) : null}
            <footer>
              <span>
                已载入 {playerCharacterSourceFile ? 1 : 0} 张玩家卡、
                {mainCharacterSourceFile ? 1 : 0} 张主要人物卡、
                {additionalCharacters.filter((item) => item.sourceFile).length} 张其他人物卡和
                {importedWorldBooks.reduce(
                  (total, book) => total + book.entries.length,
                  0,
                )} 条世界书。
              </span>
              <span>
                单文件不超过 1 MB ·
                <a href="/文件标准/人物卡.schema.json" download>
                  人物卡 Schema
                </a>
                ·
                <a href="/文件标准/世界书.schema.json" download>
                  世界书 Schema
                </a>
                ·
                <a href="/文件标准/剧本包.schema.json" download>
                  剧本包 Schema
                </a>
                ·
                <a href="/文件标准/剧本包项目.schema.json" download>
                  项目清单 Schema
                </a>
              </span>
            </footer>
          </section>

          <fieldset className="form-section">
            <legend>
              <span>01</span>
              战役与世界
            </legend>
            <div className="field-grid two-columns">
              <label className="field">
                <span>战役名称</span>
                <input
                  required
                  maxLength={80}
                  value={form.campaignName}
                  onChange={(event) => updateField("campaignName", event.target.value)}
                  placeholder="例如：雾港余烬"
                />
              </label>
              <label className="field">
                <span>世界名称</span>
                <input
                  required
                  maxLength={80}
                  value={form.worldName}
                  onChange={(event) => updateField("worldName", event.target.value)}
                  placeholder="例如：灰潮群岛"
                />
              </label>
            </div>
            <label className="field">
              <span>战役说明 <em>可选</em></span>
              <input
                maxLength={2000}
                value={form.campaignDescription}
                onChange={(event) =>
                  updateField("campaignDescription", event.target.value)
                }
                placeholder="这场故事的题材、节奏或核心悬念"
              />
            </label>
            <label className="field">
              <span>世界观概要</span>
              <textarea
                required
                rows={5}
                maxLength={6000}
                value={form.worldPremise}
                onChange={(event) => updateField("worldPremise", event.target.value)}
                placeholder="描述时代、地区、规则、阵营与不能被违背的事实……"
              />
              <small>将作为基础世界书的第一条常驻设定。</small>
            </label>
          </fieldset>

          <fieldset className="form-section">
            <legend>
              <span>02</span>
              登场角色
            </legend>
            <div className="character-columns">
              <div className="character-panel">
                <div className="character-label">
                  <span>P</span>
                  <div>
                    <strong>玩家角色</strong>
                    <small>
                      {playerCharacterSourceFile
                        ? `已导入：${playerCharacterSourceFile}`
                        : "由你控制言行与选择"}
                    </small>
                  </div>
                  {playerCharacterSourceFile ? (
                    <button
                      className="imported-card-remove"
                      type="button"
                      onClick={() => {
                        setPlayerCharacterCard(null);
                        setPlayerCharacterSourceFile("");
                        setBundleSourceFile("");
                      }}
                    >
                      清除导入
                    </button>
                  ) : null}
                </div>
                <label className="field">
                  <span>姓名</span>
                  <input
                    required
                    maxLength={80}
                    value={form.playerName}
                    onChange={(event) => updateField("playerName", event.target.value)}
                    placeholder="玩家角色的名字"
                  />
                </label>
                <label className="field">
                  <span>角色设定</span>
                  <textarea
                    required
                    rows={6}
                    maxLength={2000}
                    value={form.playerDescription}
                    onChange={(event) =>
                      updateField("playerDescription", event.target.value)
                    }
                    placeholder="身份、能力、性格、秘密与来此目的……"
                  />
                </label>
              </div>

              <div className="character-panel featured-character">
                <div className="character-label">
                  <span>AI</span>
                  <div>
                    <strong>主要角色</strong>
                    <small>
                      {mainCharacterSourceFile
                        ? `已导入：${mainCharacterSourceFile}`
                        : "后续由当前 AI 模型扮演"}
                    </small>
                  </div>
                  {mainCharacterSourceFile ? (
                    <button
                      className="imported-card-remove"
                      type="button"
                      onClick={() => {
                        setMainCharacterCard(null);
                        setMainCharacterSourceFile("");
                      }}
                    >
                      清除导入
                    </button>
                  ) : null}
                </div>
                <label className="field">
                  <span>姓名</span>
                  <input
                    required
                    maxLength={80}
                    value={form.mainCharacterName}
                    onChange={(event) =>
                      updateField("mainCharacterName", event.target.value)
                    }
                    placeholder="AI 扮演角色的名字"
                  />
                </label>
                <label className="field">
                  <span>身份与背景</span>
                  <textarea
                    required
                    rows={3}
                    maxLength={2000}
                    value={form.mainCharacterRole}
                    onChange={(event) =>
                      updateField("mainCharacterRole", event.target.value)
                    }
                    placeholder="角色在世界中的身份、经历和目标……"
                  />
                </label>
                <label className="field">
                  <span>性格与行为边界</span>
                  <textarea
                    required
                    rows={3}
                    maxLength={2000}
                    value={form.mainCharacterPersonality}
                    onChange={(event) =>
                      updateField("mainCharacterPersonality", event.target.value)
                    }
                    placeholder="性格、说话方式、价值观、秘密和禁忌……"
                  />
                </label>
              </div>
            </div>

            <div className="additional-cast-heading">
              <div>
                <strong>其他 AI 角色</strong>
                <small>
                  可加入同伴、对手或阵营人物，当前 AI 模型会同时读取他们的角色卡。
                </small>
              </div>
              <button
                type="button"
                disabled={additionalCharacters.length >= 20}
                onClick={() =>
                  setAdditionalCharacters((characters) => [
                    ...characters,
                    {
                      id: crypto.randomUUID(),
                      name: "",
                      role: "",
                      personality: "",
                      firstMessage: "",
                    },
                  ])
                }
              >
                {additionalCharacters.length >= 20 ? "已达 20 人上限" : "＋ 添加角色"}
              </button>
            </div>

            {additionalCharacters.length > 0 ? (
              <div className="additional-cast-list">
                {additionalCharacters.map((character, index) => (
                  <div className="character-panel supporting-character" key={character.id}>
                    <div className="character-label">
                      <span>AI</span>
                      <div>
                        <strong>其他角色 {index + 1}</strong>
                        <small>
                          {character.sourceFile
                            ? `已导入：${character.sourceFile}`
                            : "由当前 AI 模型独立扮演"}
                        </small>
                      </div>
                      <button
                        type="button"
                        aria-label={`移除其他角色 ${index + 1}`}
                        onClick={() =>
                          setAdditionalCharacters((characters) =>
                            characters.filter((item) => item.id !== character.id),
                          )
                        }
                      >
                        移除
                      </button>
                    </div>
                    <div className="field-grid two-columns">
                      <label className="field">
                        <span>姓名</span>
                        <input
                          required
                          maxLength={80}
                          value={character.name}
                          onChange={(event) =>
                            updateAdditionalCharacter(
                              character.id,
                              "name",
                              event.target.value,
                            )
                          }
                          placeholder="其他角色的名字"
                        />
                      </label>
                      <label className="field">
                        <span>身份与背景</span>
                        <input
                          required
                          maxLength={2000}
                          value={character.role}
                          onChange={(event) =>
                            updateAdditionalCharacter(
                              character.id,
                              "role",
                              event.target.value,
                            )
                          }
                          placeholder="例如：商会密探、玩家的同伴"
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span>性格与行为边界</span>
                      <textarea
                        required
                        rows={3}
                        maxLength={2000}
                        value={character.personality}
                        onChange={(event) =>
                          updateAdditionalCharacter(
                            character.id,
                            "personality",
                            event.target.value,
                          )
                        }
                        placeholder="性格、立场、说话方式、目标与禁忌……"
                      />
                    </label>
                    <label className="field">
                      <span>开场台词 <em>可选</em></span>
                      <textarea
                        rows={2}
                        maxLength={2000}
                        value={character.firstMessage}
                        onChange={(event) =>
                          updateAdditionalCharacter(
                            character.id,
                            "firstMessage",
                            event.target.value,
                          )
                        }
                        placeholder="填写后会与主要角色一起出现在开场。"
                      />
                    </label>
                    <label className="opening-presence-toggle">
                      <input
                        type="checkbox"
                        checked={character.initiallyPresent !== false}
                        onChange={(event) =>
                          setAdditionalCharacters((characters) =>
                            characters.map((item) =>
                              item.id === character.id
                                ? {
                                    ...item,
                                    initiallyPresent: event.target.checked,
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                      <span>
                        <strong>在第一幕登场</strong>
                        <small>关闭后仍保留在角色库中，等剧情或地点变化再加入</small>
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <p className="additional-cast-empty">
                当前只有一名主要 AI 角色；需要群像剧情时可继续添加。
              </p>
            )}
          </fieldset>

          <fieldset className="form-section">
            <legend>
              <span>03</span>
              第一幕
            </legend>
            <label className="field">
              <span>开场地点名称 <em>可选</em></span>
              <input
                maxLength={80}
                value={form.openingLocationName}
                onChange={(event) =>
                  updateField("openingLocationName", event.target.value)
                }
                placeholder="例如：李府前厅；留空时使用“开场地点”"
              />
            </label>
            <label className="field">
              <span>开场场景</span>
              <textarea
                required
                rows={6}
                maxLength={8000}
                value={form.openingScene}
                onChange={(event) => updateField("openingScene", event.target.value)}
                placeholder="描述玩家进入故事时看见、听见以及正在发生的事情……"
              />
            </label>
            <label className="field">
              <span>主要角色的第一句话 <em>可选</em></span>
              <textarea
                rows={3}
                maxLength={2000}
                value={form.mainCharacterFirstMessage}
                onChange={(event) =>
                  updateField("mainCharacterFirstMessage", event.target.value)
                }
                placeholder="可以留空，接入模型后再由角色生成。"
              />
            </label>
            <label className="field direction-field">
              <span>初始剧情走向 <em>可选 · NPC 不可见</em></span>
              <textarea
                rows={3}
                maxLength={1000}
                value={form.initialStoryDirection}
                onChange={(event) =>
                  updateField("initialStoryDirection", event.target.value)
                }
                placeholder="例如：让玩家逐步发现灯塔与失踪航船的联系。"
              />
            </label>
            {(storyModules.length > 0 ||
            bundleRelationships.length > 0 ||
            bundleLocations.length > 0 ||
            bundleForeshadowing.length > 0 ||
            bundleTriggers.length > 0) ? (
              <div className="imported-bundle-sections">
                {storyModules.length > 0 ? (
                  <div className="imported-story-modules">
                    <div>
                      <strong>已载入 {storyModules.length} 个剧情任务</strong>
                      <small>
                        开场任务：
                        {storyModules.find(
                          (module) => module.id === initialStoryModuleId,
                        )?.title ?? "未指定"}
                        。满足条件且剧情未偏离时会自动接续。
                      </small>
                      <ul className="bundle-module-list">
                        {storyModules.map((module) => (
                          <li key={module.id}>
                            {module.title}
                            {module.deadlineDay !== undefined &&
                            module.deadlineDay > 0 ? (
                              <em>第 {module.deadlineDay} 日前完成</em>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBundleSection("modules")}
                    >
                      移除任务链
                    </button>
                  </div>
                ) : null}

                {bundleRelationships.length > 0 ? (
                  <div className="imported-story-modules">
                    <div>
                      <strong>
                        已载入 {bundleRelationships.length} 条初始关系
                      </strong>
                      <small>
                        开局即建立双向关系记录（信任、好感、恐惧、敌意、敬意）；进入游戏后可在“人物管理 → 角色关系”查看。
                      </small>
                      <ul className="bundle-module-list">
                        {bundleRelationships.slice(0, 10).map(
                          (relationship, index) => (
                            <li key={`${relationship.sourceCharacterName}-${relationship.targetCharacterName}`}>
                              {relationship.sourceCharacterName} ↔{" "}
                              {relationship.targetCharacterName}
                              {relationship.summary ? (
                                <small> · {relationship.summary}</small>
                              ) : null}
                              {index === 9 &&
                              bundleRelationships.length > 10 ? (
                                <em>
                                  等 {bundleRelationships.length} 条
                                </em>
                              ) : null}
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBundleSection("relationships")}
                    >
                      移除初始关系
                    </button>
                  </div>
                ) : null}

                {bundleLocations.length > 0 ? (
                  <div className="imported-story-modules">
                    <div>
                      <strong>
                        已载入 {bundleLocations.length} 处预注册地点
                      </strong>
                      <small>
                        开局即进入地点清单，未进入前已被声明；进入游戏后可在“地点”栏目查看地点与人物位置。
                      </small>
                      <ul className="bundle-module-list">
                        {bundleLocations.map((location) => (
                          <li key={location.name}>
                            {location.name}
                            {location.important ? <em>重要</em> : null}
                            {location.characters?.length ? (
                              <small>
                                {" "}
                                · {location.characters.length} 名常驻角色
                              </small>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBundleSection("locations")}
                    >
                      移除地点清单
                    </button>
                  </div>
                ) : null}

                {bundleForeshadowing.length > 0 ? (
                  <div className="imported-story-modules">
                    <div>
                      <strong>
                        已载入 {bundleForeshadowing.length} 条伏笔
                      </strong>
                      <small>
                        满足出现条件后伏笔埋入剧情，相关时刻进入模型上下文；回收条件满足时呈现回收概要。进入游戏后可在“剧本工作台 → 伏笔”查看与修改。
                      </small>
                      <ul className="bundle-module-list">
                        {bundleForeshadowing.slice(0, 10).map((thread, index) => (
                          <li key={thread.id}>
                            {thread.keywords.join(" / ")}
                            {thread.characters?.length ? (
                              <small> · {thread.characters.join("、")}</small>
                            ) : null}
                            {index === 9 && bundleForeshadowing.length > 10 ? (
                              <em>等 {bundleForeshadowing.length} 条</em>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBundleSection("foreshadowing")}
                    >
                      移除伏笔
                    </button>
                  </div>
                ) : null}

                {bundleTriggers.length > 0 ? (
                  <div className="imported-story-modules">
                    <div>
                      <strong>
                        已载入 {bundleTriggers.length} 个偏离触发器
                      </strong>
                      <small>
                        满足触发条件或超过期限时，后果会作为“意外阻碍”真实写入剧情。进入游戏后可在“剧本工作台 → 触发器”查看与修改。
                      </small>
                      <ul className="bundle-module-list">
                        {bundleTriggers.slice(0, 10).map((trigger) => (
                          <li key={trigger.id}>
                            {trigger.id}
                            {trigger.deadlineDay !== undefined &&
                            trigger.deadlineDay > 0 ? (
                              <em>第 {trigger.deadlineDay} 日前生效</em>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBundleSection("triggers")}
                    >
                      移除偏离触发器
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </fieldset>

          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}

          <footer className="form-footer">
            <div>
              <strong>一次完成本地保存</strong>
              <span>战役、角色卡、世界书与开场回合将作为一个整体写入。</span>
            </div>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? "正在建立世界……" : "建立世界并进入第一幕"}
              <span aria-hidden="true">→</span>
            </button>
          </footer>
        </form>
        </section>
      ) : (
        <section className="start-content continue-content" aria-labelledby="continue-title">
          <header className="start-header">
            <div>
              <p className="eyebrow">本地档案 · 第二级界面</p>
              <h2 id="continue-title">选择要继续的故事</h2>
              <p>
                从左侧选择剧本即可进入当前分支；也可以先重命名、导出、删除或处理完整存档与整库备份。
              </p>
            </div>
          </header>

          {loadingList ? (
            <div className="continue-overview quiet-message">
              正在读取本地剧本……
            </div>
          ) : adventures.length > 0 ? (
            <div className="continue-overview">
              <span className="section-number">最近一次游戏</span>
              <h3>{adventures[0].campaignName}</h3>
              <p>
                {adventures[0].worldName || "未命名世界"} · {adventures[0].playerName || "玩家"} × {adventures[0].mainCharacterName || "主要角色"}
              </p>
              <time>{formatDate(adventures[0].updatedAt)}</time>
              <Link className="primary-button" href={`/game/${adventures[0].sessionId}`}>
                继续最近剧情
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : (
            <div className="continue-overview empty-continue-overview">
              <span className="section-number">没有本地档案</span>
              <h3>还没有可以继续的故事</h3>
              <p>先创建一个新剧本，完成后会直接进入第一幕。</p>
              <button className="primary-button" type="button" onClick={() => setHomeView("new")}>
                开始新剧本
                <span aria-hidden="true">→</span>
              </button>
            </div>
          )}

          <section
            className="continue-archive-import"
            aria-labelledby="continue-archive-import-title"
          >
            <div>
              <span className="section-number">迁移游戏</span>
              <h3 id="continue-archive-import-title">导入游戏存档</h3>
              <p>
                选择由 AI 酒馆导出的完整存档 JSON。程序会先校验版本、摘要和完整性，再建立隔离副本，不会覆盖现有剧本。
              </p>
            </div>
            <label>
              <input
                type="file"
                accept=".json,application/json"
                disabled={importingArchive || Boolean(backupOperation)}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void importCompleteArchive(file);
                }}
              />
              <strong>
                {importingArchive ? "正在校验存档……" : "选择游戏存档"}
              </strong>
              <small>JSON · 最大 100 MB</small>
            </label>
            {archiveError ? (
              <p className="archive-error" role="alert">
                {archiveError}
              </p>
            ) : null}
            {dataSafetyNotice ? (
              <p className="data-safety-notice" role="status">
                {dataSafetyNotice}
              </p>
            ) : null}
          </section>

          <div className="continue-help-grid">
            <article>
              <span>选择存档</span>
              <strong>从左侧剧本卡片进入</strong>
              <p>程序会恢复当前分支、人物状态、地点、世界书和剧情任务。</p>
            </article>
            <article>
              <span>迁移与恢复</span>
              <strong>导入单个存档或恢复整库</strong>
              <p>右侧导入单个游戏副本；左侧备份区将本机全部故事恢复到过去时刻。</p>
            </article>
          </div>
        </section>
      )}
      </main>
      )}

      {modelSettingsOpen && modelDraft && modelStatus ? (
        <div
          className="model-settings-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !modelOperation) {
              setModelSettingsOpen(false);
            }
          }}
        >
          <section
            className="model-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-settings-title"
          >
            <header>
              <div>
                <p className="eyebrow">本机服务端配置</p>
                <h2 id="model-settings-title">API 与模型配置</h2>
                <p>密钥只保存到本机的模型配置文件，不会返回浏览器或写入剧本存档。</p>
              </div>
              <button
                type="button"
                disabled={Boolean(modelOperation)}
                aria-label="关闭 API 配置"
                onClick={() => setModelSettingsOpen(false)}
              >
                关闭
              </button>
            </header>

            <section
              className={`configured-api-summary ${modelStatus.configured ? "configured" : "empty"}`}
              aria-labelledby="configured-api-title"
            >
              <header>
                <div>
                  <span>当前连接</span>
                  <strong id="configured-api-title">
                    {modelStatus.configured ? "已配置 API" : "尚未配置 API"}
                  </strong>
                </div>
                {modelStatus.configured ? <em>正在使用</em> : <em>未连接</em>}
              </header>
              {modelStatus.configured ? (
                <>
                  <dl>
                    <div>
                      <dt>名称</dt>
                      <dd>{modelStatus.providerLabel}</dd>
                    </div>
                    <div>
                      <dt>类型</dt>
                      <dd>{aiProviderTypeLabel(modelStatus.provider)}</dd>
                    </div>
                    <div>
                      <dt>模型</dt>
                      <dd>{modelStatus.model}</dd>
                    </div>
                    <div>
                      <dt>鉴权</dt>
                      <dd>
                        {modelStatus.hasApiKey
                          ? "已保存 API Key"
                          : modelStatus.apiKeyRequired
                            ? "缺少 API Key"
                            : "无需 API Key"}
                      </dd>
                    </div>
                    <div className="configured-api-endpoint">
                      <dt>地址</dt>
                      <dd>{modelStatus.baseUrl}</dd>
                    </div>
                  </dl>
                  <button
                    className="delete-api-configuration"
                    type="button"
                    disabled={Boolean(modelOperation)}
                    onClick={() => void deleteModelConfiguration()}
                  >
                    {modelOperation === "delete"
                      ? "正在删除……"
                      : "删除已配置 API"}
                  </button>
                </>
              ) : (
                <p>选择下方供应商并填写连接信息；删除 API 配置不会影响任何本地剧本或存档。</p>
              )}
            </section>

            <section
              className="api-profile-list"
              aria-labelledby="api-profile-list-title"
            >
              <header>
                <div>
                  <span>本机已保存</span>
                  <strong id="api-profile-list-title">
                    API 配置列表 · {modelProfiles.length}
                  </strong>
                </div>
                <button
                  type="button"
                  disabled={Boolean(modelOperation)}
                  onClick={newModelProfile}
                >
                  新建配置
                </button>
              </header>
              {modelProfiles.length === 0 ? (
                <p>还没有保存的 API 配置；填写下方表单后点击“保存并使用”即可新增。</p>
              ) : (
                <ul>
                  {modelProfiles.map((profile) => (
                    <li
                      key={profile.id}
                      className={profile.id === modelActiveId ? "active" : ""}
                    >
                      <div className="api-profile-detail">
                        <strong>{profile.name}</strong>
                        <small>
                          {profile.providerLabel} · {profile.model} ·{" "}
                          {profile.hasApiKey ? "已保存密钥" : "无密钥"}
                        </small>
                      </div>
                      <div className="api-profile-actions">
                        {profile.id === modelActiveId ? (
                          <em>使用中</em>
                        ) : (
                          <button
                            type="button"
                            disabled={Boolean(modelOperation)}
                            onClick={() => void switchModelProfileTo(profile.id)}
                          >
                            使用
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={Boolean(modelOperation)}
                          onClick={() => editModelProfile(profile)}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(modelOperation)}
                          onClick={() => void deleteModelConfiguration(profile.id)}
                        >
                          删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="model-settings-grid">
              <label className="field">
                <span>配置名称</span>
                <input
                  maxLength={100}
                  value={modelDraft.name ?? ""}
                  disabled={Boolean(modelOperation)}
                  placeholder={modelDraft.id ? "编辑现有配置的名称" : "例如：OpenCode Go 主用"}
                  onChange={(event) => {
                    setModelDraft((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    );
                  }}
                />
                <small>用于在列表中区分不同的 API 配置。</small>
              </label>
              <label className="field full-width-field">
                <span>供应商类型</span>
                <select
                  value={modelDraft.provider}
                  disabled={Boolean(modelOperation)}
                  onChange={(event) => {
                    const provider = event.target.value as AiProviderId;
                    const preset = modelStatus.presets.find(
                      (item) => item.id === provider,
                    );
                    if (!preset) return;
                    setModelDraft((current) =>
                      current
                        ? {
                            ...current,
                            provider,
                            baseUrl: preset.defaultBaseUrl,
                            model: preset.defaultModel,
                            clearApiKey: false,
                          }
                        : current,
                    );
                    clearModelReview();
                  }}
                >
                  {modelStatus.presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <small>
                  {modelStatus.presets.find((item) => item.id === modelDraft.provider)
                    ?.description ?? ""}
                </small>
              </label>

              <label className="field full-width-field">
                <span>Base URL</span>
                <input
                  required
                  type="url"
                  maxLength={2000}
                  value={modelDraft.baseUrl}
                  disabled={Boolean(modelOperation)}
                  placeholder="供应商给出的 API 基础地址"
                  onChange={(event) => {
                    setModelDraft((current) =>
                      current ? { ...current, baseUrl: event.target.value } : current,
                    );
                    clearModelReview();
                  }}
                />
                <small>可以填写到 /v1，也可以直接填写完整的 /chat/completions 地址。</small>
              </label>

              <label className="field">
                <span>模型名称</span>
                <input
                  required
                  maxLength={200}
                  value={modelDraft.model}
                  disabled={Boolean(modelOperation)}
                  placeholder="供应商提供的模型 ID"
                  onChange={(event) => {
                    setModelDraft((current) =>
                      current ? { ...current, model: event.target.value } : current,
                    );
                    setModelAudit(null);
                    setModelNotice("");
                    setModelError("");
                  }}
                />
              </label>

              <label className="field">
                <span>JSON 输出方式</span>
                <select
                  value={modelDraft.jsonMode}
                  disabled={Boolean(modelOperation)}
                  onChange={(event) => {
                    setModelDraft((current) =>
                      current
                        ? { ...current, jsonMode: event.target.value as AiJsonMode }
                        : current,
                    );
                    setModelAudit(null);
                    setModelNotice("");
                    setModelError("");
                  }}
                >
                  <option value="response_format">发送 JSON 模式参数</option>
                  <option value="prompt_only">仅用提示词要求 JSON</option>
                </select>
                <small>若兼容服务提示不支持 response_format，请选择“仅用提示词”。</small>
              </label>

              <label className="field full-width-field">
                <span>
                  API Key
                  {modelDraft.provider === "local_openai_compatible" ? (
                    <em>可选</em>
                  ) : null}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  maxLength={4000}
                  value={modelDraft.apiKey}
                  disabled={Boolean(modelOperation) || modelDraft.clearApiKey}
                  placeholder={
                    modelStatus.hasApiKey &&
                    modelDraft.provider === modelStatus.provider
                      ? "已保存密钥；留空表示继续使用"
                      : "填写供应商 API Key"
                  }
                  onChange={(event) => {
                    setModelDraft((current) =>
                      current
                        ? { ...current, apiKey: event.target.value, clearApiKey: false }
                        : current,
                    );
                    clearModelReview();
                  }}
                />
              </label>

              {modelStatus.hasApiKey &&
              modelDraft.provider === modelStatus.provider &&
              modelDraft.provider === "local_openai_compatible" ? (
                <label className="model-clear-key full-width-field">
                  <input
                    type="checkbox"
                    checked={modelDraft.clearApiKey}
                    disabled={Boolean(modelOperation)}
                    onChange={(event) => {
                      setModelDraft((current) =>
                        current
                          ? {
                              ...current,
                              clearApiKey: event.target.checked,
                              apiKey: event.target.checked ? "" : current.apiKey,
                            }
                          : current,
                      );
                      clearModelReview();
                    }}
                  />
                  清除此前保存的密钥，以无鉴权方式连接本地服务
                </label>
              ) : null}
            </div>

            {availableModels.length > 0 ? (
              <section className="ai-model-catalog" aria-labelledby="ai-model-catalog-title">
                <header>
                  <div>
                    <strong id="ai-model-catalog-title">
                      API 模型目录 · {availableModels.length}
                    </strong>
                    <small>
                      {modelCatalogFetchedAt
                        ? `读取于 ${formatDate(modelCatalogFetchedAt)}`
                        : "刚刚读取"}
                      。目录可见不等于 token 已通过生成审核。
                    </small>
                  </div>
                  <button type="button" onClick={exportModelCatalog}>
                    导出 JSON
                  </button>
                </header>
                <div className="ai-model-list">
                  {availableModels.slice(0, 200).map((model) => (
                    <button
                      type="button"
                      key={model.id}
                      className={modelDraft.model === model.id ? "selected" : ""}
                      disabled={
                        Boolean(modelOperation) ||
                        model.compatibility === "unsupported_protocol"
                      }
                      title={model.compatibilityReason}
                      onClick={() => {
                        setModelDraft((current) =>
                          current ? { ...current, model: model.id } : current,
                        );
                        setModelAudit(null);
                        setModelNotice(`已选择模型 ${model.id}；请执行可用性审核。`);
                        setModelError("");
                      }}
                    >
                      <span>{model.name || model.id}</span>
                      <small>
                        {model.name !== model.id
                          ? model.id
                          : model.ownedBy || "模型 ID"}
                      </small>
                      <em data-status={model.compatibility}>
                        {modelAudit?.ok && modelAudit.selectedModel === model.id
                          ? "已审核可用"
                          : modelCompatibilityLabel(model.compatibility)}
                      </em>
                    </button>
                  ))}
                </div>
                {availableModels.length > 200 ? (
                  <p>页面只显示前 200 个模型；导出的 JSON 包含全部目录。</p>
                ) : null}
              </section>
            ) : null}

            {modelAudit ? (
              <section
                className={`ai-availability-audit ${modelAudit.ok ? "passed" : "failed"}`}
                aria-labelledby="ai-availability-audit-title"
              >
                <header>
                  <div>
                    <strong id="ai-availability-audit-title">
                      可用性审核 · {modelAudit.ok ? "通过" : "需要处理"}
                    </strong>
                    <small>
                      {modelAudit.selectedModel || "未选择模型"} · {formatDate(modelAudit.checkedAt)}
                    </small>
                  </div>
                </header>
                <ol>
                  {modelAudit.checks.map((check) => (
                    <li key={check.id} data-status={check.status}>
                      <span aria-hidden="true" />
                      <div>
                        <strong>{check.label}</strong>
                        <p>{check.detail}</p>
                        {check.durationMs !== undefined ? (
                          <small>{check.durationMs} ms</small>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {modelError ? <p className="model-settings-error" role="alert">{modelError}</p> : null}
            {modelNotice ? <p className="model-settings-notice" role="status">{modelNotice}</p> : null}

            <footer>
              <span>读取目录通常不消耗生成额度；完整审核会发送一次最小 JSON 请求。</span>
              <div>
                <button
                  type="button"
                  disabled={Boolean(modelOperation)}
                  onClick={() => void submitModelConfiguration("discover")}
                >
                  {modelOperation === "discover" ? "读取中……" : "读取模型"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(modelOperation) || !modelDraft.model.trim()}
                  onClick={() => void submitModelConfiguration("audit")}
                >
                  {modelOperation === "audit" ? "审核中……" : "审核可用性"}
                </button>
                {modelDraft.id ? (
                  <button
                    type="button"
                    disabled={Boolean(modelOperation)}
                    onClick={() => void submitModelConfiguration("save", { asNew: true })}
                  >
                    另存为新 API
                  </button>
                ) : null}
                <button
                  className="primary-button"
                  type="button"
                  disabled={Boolean(modelOperation)}
                  onClick={() => void submitModelConfiguration("save")}
                >
                  {modelOperation === "save" ? "保存中……" : "保存并使用"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
