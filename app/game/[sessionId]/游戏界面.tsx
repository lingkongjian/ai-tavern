"use client";

import type {
  AdventureBranchSummary,
  AdventureRecoveryPoint,
  JsonObject,
  JsonValue,
  LoadedAdventure,
  LoadedStateChange,
  LoadedTurn,
  LoadedTurnContextSnapshot,
  ContentAssetManagementChange,
  StateAuditChange,
  StateAuditDashboard,
  StateAuditFieldDiff,
} from "@/lib/storage/story-store";
import type { SourceDocumentSummary } from "@/lib/reference/原文参考";
import type { StoryMemoryDashboard } from "@/lib/memory/剧情记忆";
import { dayPhaseOf } from "@/lib/story/回合协议";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface ApiProfileSummary {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  baseUrl: string;
  model: string;
  jsonMode: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiSettingsResponse {
  provider: string;
  providerLabel: string;
  configured: boolean;
  hasApiKey: boolean;
  apiKeyRequired: boolean;
  baseUrl: string;
  model: string;
  jsonMode: string;
  presets: unknown[];
  activeId: string | null;
  profiles: ApiProfileSummary[];
}

function text(value: JsonValue | undefined, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function records(value: JsonValue | undefined) {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function strings(value: JsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stanceLabel(stance: string) {
  const labels: Record<string, string> = {
    accept: "接受",
    partial_accept: "部分接受",
    reject: "拒绝",
    benevolent: "善意",
    neutral: "中立",
    malicious: "利己",
  };
  return labels[stance] ?? "选择";
}

const stateLabels: Record<LoadedStateChange["entityType"], string> = {
  character_card: "角色卡",
  character_state: "角色状态",
  character_card_evolution: "角色演化",
  world_book_entry: "世界书",
  relationship: "角色关系",
  story_direction: "剧情走向",
  story_module: "剧情任务",
  plot_thread: "伏笔",
  plot_trigger: "偏离触发器",
  plot_check: "属性判定",
  location: "地点",
  session_state: "场景状态",
  source_document: "原文进度",
  appointment: "约定",
};

const operationLabels: Record<LoadedStateChange["operation"], string> = {
  merge: "已更新",
  replace: "已写入",
  activate: "已启用",
  deactivate: "已停用",
};

const contextFieldLabels: Record<string, string> = {
  nextTurnId: "目标回合",
  campaign: "剧本资料",
  session: "会话资料",
  branch: "当前分支",
  contextBudget: "上下文预算",
  characterDirectory: "人物目录",
  storyModules: "可用剧情任务",
  storyModuleProgress: "剧情任务进度",
  activeStates: "当前角色卡、世界书与状态",
  recentTurns: "近期剧情回合",
  chapterSummaries: "章节摘要",
  longTermMemory: "召回的长期记忆",
  playerInput: "玩家本轮输入",
  sourceReferences: "召回的原文片段",
};

const fieldLabels: Record<string, string> = {
  mood: "心情",
  currentGoal: "当前目标",
  location: "位置",
  locationId: "所在地点",
  currentLocationId: "当前地点",
  currentLocationName: "地点名称",
  name: "名称",
  description: "描述",
  present: "是否在场",
  alive: "生存状态",
  duration: "持续时间",
  trust: "信任",
  affinity: "好感",
  affection: "好感",
  fear: "恐惧",
  hostility: "敌意",
  respect: "尊重",
  beliefs: "新增认知",
  secrets: "秘密",
  goals: "长期目标",
  content: "内容",
  status: "状态",
  title: "标题",
  objective: "任务目标",
  activationReason: "接续原因",
  continuityReason: "连续性判定",
  currentScene: "当前场景",
  lastSummaryPatch: "剧情摘要",
  phase: "阶段",
  enabled: "是否启用",
  comment: "条目名称",
  keys: "主要触发词",
  secondaryKeys: "次要触发词",
  constant: "常驻状态",
  selective: "选择性匹配",
  position: "注入位置",
  order: "排序值",
  probability: "触发概率",
  depth: "扫描深度",
  fileName: "文件名",
  contentLength: "正文长度",
  chapterCount: "章节数",
  chunkCount: "切片数",
  currentChapter: "当前进度章节",
  preventFuture: "防止剧透",
  fidelity: "贴合模式",
  isDeleted: "已删除",
  importance: "重要度",
  pinned: "已置顶",
  source: "记录来源",
  memoryTokenBudget: "记忆预算",
  recentTurnCount: "近期回合数",
  chapterSize: "章节大小",
};

function shortValue(value: JsonValue, maximumLength = 86): string {
  let result: string;
  if (value === null) result = "已移除";
  else if (typeof value === "boolean") result = value ? "是" : "否";
  else if (typeof value === "string" || typeof value === "number") {
    result = String(value);
  } else if (Array.isArray(value)) {
    result = value.map((item) => shortValue(item, 28)).join("、");
  } else {
    result = Object.entries(value)
      .slice(0, 3)
      .map(([key, item]) => `${fieldLabels[key] ?? key}：${shortValue(item, 32)}`)
      .join("；");
  }
  return result.length > maximumLength
    ? `${result.slice(0, maximumLength)}…`
    : result;
}

function decodePointerSegment(segment: string) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function auditFieldLabel(path: string) {
  if (path === "$active") return "启用状态";
  if (path === "*") return "整个状态实体";
  const parts = path
    .split("/")
    .filter(Boolean)
    .map(decodePointerSegment);
  return parts.map((part) => fieldLabels[part] ?? part).join(" › ") || "整体内容";
}

function auditDiffValue(field: StateAuditFieldDiff, side: "before" | "after") {
  const exists = side === "before" ? field.beforeExists : field.afterExists;
  if (!exists) return "不存在";
  const value = side === "before" ? field.before : field.after;
  return value === undefined ? "不存在" : shortValue(value, 160);
}

const contentAssetOperationLabels: Record<string, string> = {
  import: "导入原文",
  update: "调整原文",
  remove: "删除原文",
  advance: "剧情推进自动解锁",
  update_entry: "修正记忆",
  update_settings: "调整记忆设置",
  rebuild: "重建记忆索引",
  rollback: "撤销资料修改",
};

function contentAssetTarget(change: ContentAssetManagementChange) {
  if (change.domain === "sources") {
    return text(change.after.name) || text(change.before.name) || "原文参考";
  }
  if (change.targetId === "settings") return "长期记忆设置";
  if (change.targetId === "index") return "长期记忆索引";
  return text(change.after.title) || text(change.before.title) || "剧情记忆";
}

function contentAssetDiffs(change: ContentAssetManagementChange) {
  return Array.from(
    new Set([...Object.keys(change.before), ...Object.keys(change.after)]),
  ).filter(
    (key) =>
      JSON.stringify(change.before[key]) !== JSON.stringify(change.after[key]),
  );
}

function stateChangeTarget(
  change: LoadedStateChange,
  characterNameById: Map<string, string>,
) {
  if (change.entityType === "relationship") {
    const sourceId = text(change.payload.sourceCharacterId);
    const targetId = text(change.payload.targetCharacterId);
    return `${characterNameById.get(sourceId) ?? "角色"} → ${
      characterNameById.get(targetId) ?? "角色"
    }`;
  }
  if (
    change.entityType === "character_state" ||
    change.entityType === "character_card" ||
    change.entityType === "character_card_evolution"
  ) {
    return characterNameById.get(change.entityId) ?? "未知角色";
  }
  if (change.entityType === "world_book_entry") return "世界事实";
  if (change.entityType === "story_direction") return "玩家导演目标";
  if (change.entityType === "story_module") {
    return text(change.payload.title, "剧本任务");
  }
  if (change.entityType === "location") {
    return text(change.payload.name, "当前地点");
  }
  return "当前故事场景";
}

function stateChangeDetail(change: LoadedStateChange) {
  const ignoredFields = new Set([
    "sourceCharacterId",
    "targetCharacterId",
    "sourceTurnId",
    "shadowsEntryId",
    "layer",
    "lastChange",
  ]);
  const fields = Object.entries(change.payload).filter(
    ([key]) => !ignoredFields.has(key),
  );
  if (change.entityType === "relationship") {
    const delta = change.payload.lastChange;
    const dimension = fields.find(
      ([key, value]) => typeof value === "number" && key !== "lastChange",
    );
    if (dimension) {
      const [key, finalValue] = dimension;
      const signedDelta =
        typeof delta === "number" && delta > 0 ? `+${delta}` : String(delta ?? 0);
      return `${fieldLabels[key] ?? key} ${signedDelta}，当前 ${finalValue}`;
    }
  }
  return fields
    .slice(0, 3)
    .map(([key, value]) => `${fieldLabels[key] ?? key}：${shortValue(value)}`)
    .join(" · ");
}

function tokenCount(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString("zh-CN");
}

function formatTurnTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "本地记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

interface AdvanceTurnResponse {
  adventure?: LoadedAdventure;
  committedTurn?: { id: string; sequence: number; reused?: boolean } | null;
  error?: string;
  issues?: string[];
  pendingChecks?: PendingCheckInfo[];
  pendingTurnId?: string;
  expectedHeadTurnId?: string;
  idempotencyKey?: string;
}

interface PendingCheckInfo {
  checkId: string;
  characterId: string;
  characterName: string;
  attribute: string;
  attributeValue: number;
  difficulty: number;
  context: string;
  direct: boolean;
  margin: number;
}

interface AttributeCheckResolutionInfo {
  checkId: string;
  characterId: string;
  attribute: string;
  attributeValue: number;
  difficulty: number;
  roll: number | null;
  finalValue: number;
  outcome: string;
  outcomeLabel: string;
  direct: boolean;
}

interface AttributeCheckResolveResponse {
  adventure?: LoadedAdventure;
  resolutions?: AttributeCheckResolutionInfo[];
  error?: string;
  issues?: string[];
}

interface HistoryTurnResponse {
  turn?: LoadedTurn;
  error?: string;
}

type StoryContentDomain =
  | "characters"
  | "locations"
  | "story_modules"
  | "world_book"
  | "foreshadowing"
  | "triggers"
  | "sources"
  | "memories";

interface StoryContentResponse {
  schemaVersion?: "1.0.0";
  content?: {
    adventure: LoadedAdventure;
    sourceDocuments: SourceDocumentSummary[];
    memory: StoryMemoryDashboard;
  };
  audit?: {
    state: StateAuditDashboard;
    assets: ContentAssetManagementChange[];
  };
  error?: {
    code?: string;
    message?: string;
    issues?: string[];
  };
}

interface StateAuditResponse {
  audit?: StateAuditDashboard;
  adventure?: LoadedAdventure;
  error?: string;
  issues?: string[];
}

interface BranchManagementResponse {
  adventure?: LoadedAdventure;
  branches?: AdventureBranchSummary[];
  recoveryPoints?: AdventureRecoveryPoint[];
  error?: string;
  issues?: string[];
}

// 状态审计操作前的"原因输入"弹层请求。Electron 桌面环境不支持 window.prompt，
// 撤销状态变化/资料修改、字段锁定均改用面板内嵌弹层输入原因。
type ReasonPromptState =
  | { kind: "rollback_change"; changeId: string }
  | { kind: "rollback_asset"; change: ContentAssetManagementChange }
  | {
      kind: "set_lock";
      entityType: StateAuditChange["entityType"];
      entityId: string;
      fieldPath: string;
      locked: boolean;
    };

interface SavePointResponse {
  recoveryPoints?: AdventureRecoveryPoint[];
  error?: string;
  issues?: string[];
}

interface TurnContextResponse {
  snapshot?: LoadedTurnContextSnapshot;
  error?: string;
}

interface CharacterFormState {
  name: string;
  role: string;
  personality: string;
  firstMessage: string;
}

const emptyCharacterForm: CharacterFormState = {
  name: "",
  role: "",
  personality: "",
  firstMessage: "",
};

interface LocationFormState {
  name: string;
  description: string;
  defaultCharacterIds: string[];
}

const emptyLocationForm: LocationFormState = {
  name: "",
  description: "",
  defaultCharacterIds: [],
};

interface StoryModuleFormState {
  id: string;
  title: string;
  objective: string;
  completionCriteria: string;
  activationConditions: string;
  prerequisiteModuleIds: string[];
  continuityNotes: string;
  autoContinue: boolean;
}

const emptyStoryModuleForm: StoryModuleFormState = {
  id: "",
  title: "",
  objective: "",
  completionCriteria: "",
  activationConditions: "",
  prerequisiteModuleIds: [],
  continuityNotes: "",
  autoContinue: true,
};

interface ForeshadowingFormState {
  id: string;
  keywords: string;
  seedCondition: string;
  payoffCondition: string;
  payoffSummary: string;
  characters: string;
}

const emptyForeshadowingForm: ForeshadowingFormState = {
  id: "",
  keywords: "",
  seedCondition: "",
  payoffCondition: "",
  payoffSummary: "",
  characters: "",
};

interface TriggerRelationFormState {
  sourceCharacterName: string;
  targetCharacterName: string;
  dimension: string;
  delta: string;
}

interface TriggerFormState {
  id: string;
  when: string;
  consequence: string;
  relations: TriggerRelationFormState[];
  flags: string;
  attributes: string;
  deadlineDay: string;
}

const emptyTriggerForm: TriggerFormState = {
  id: "",
  when: "",
  consequence: "",
  relations: [],
  flags: "",
  attributes: "",
  deadlineDay: "",
};

interface WorldBookFormState {
  comment: string;
  keys: string;
  secondaryKeys: string;
  content: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  position: "before_char" | "after_char";
  order: number;
  probability: number;
  depth: number;
  extensions: string;
}

const emptyWorldBookForm: WorldBookFormState = {
  comment: "",
  keys: "",
  secondaryKeys: "",
  content: "",
  enabled: true,
  constant: false,
  selective: false,
  position: "before_char",
  order: 100,
  probability: 100,
  depth: 4,
  extensions: "{}",
};

function splitWorldBookKeys(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function worldBookLayerLabel(layer: string) {
  const labels: Record<string, string> = {
    base: "内置基础层",
    base_import: "导入基础层",
    session_overlay: "剧情动态层",
    player: "玩家新增层",
    player_override: "玩家修订层",
  };
  return labels[layer] ?? "兼容资料层";
}

function splitTaskLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

type StoryWorkbenchTab =
  | "characters"
  | "locations"
  | "story_modules"
  | "foreshadowing"
  | "triggers"
  | "world_book"
  | "sources"
  | "memories"
  | "state_audit";

const storyWorkbenchTabs: Array<{
  id: StoryWorkbenchTab;
  label: string;
  hint: string;
}> = [
  { id: "characters", label: "人物", hint: "角色卡与出场" },
  { id: "locations", label: "地点", hint: "场景与阵容" },
  { id: "story_modules", label: "剧情任务", hint: "目标与接续" },
  { id: "foreshadowing", label: "伏笔", hint: "埋设与回收" },
  { id: "triggers", label: "触发器", hint: "意外阻碍" },
  { id: "world_book", label: "世界书", hint: "事实与覆盖层" },
  { id: "sources", label: "原文", hint: "参考资料" },
  { id: "memories", label: "记忆", hint: "长期上下文" },
  { id: "state_audit", label: "修改记录", hint: "审计、撤销与锁定" },
];

function StoryWorkbenchNavigation({
  active,
  disabled = false,
  onSelect,
}: {
  active: StoryWorkbenchTab;
  disabled?: boolean;
  onSelect: (tab: StoryWorkbenchTab) => void;
}) {
  return (
    <nav className="story-workbench-navigation" aria-label="剧本工作台栏目">
      <div>
        {storyWorkbenchTabs.map((tab) => (
          <button
            className={tab.id === active ? "active" : ""}
            type="button"
            aria-current={tab.id === active ? "page" : undefined}
            disabled={disabled}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
          >
            <strong>{tab.label}</strong>
            <span>{tab.hint}</span>
          </button>
        ))}
      </div>
      <a href="/manual" target="_blank" rel="noreferrer">
        阅读操作手册
      </a>
    </nav>
  );
}

export function GameInterface({
  adventure: initialAdventure,
  initialSourceDocuments,
  initialBranches,
  initialRecoveryPoints,
  initialMemory,
}: {
  adventure: LoadedAdventure;
  initialSourceDocuments: SourceDocumentSummary[];
  initialBranches: AdventureBranchSummary[];
  initialRecoveryPoints: AdventureRecoveryPoint[];
  initialMemory: StoryMemoryDashboard;
}) {
  const [adventure, setAdventure] = useState(initialAdventure);
  const [apiProfiles, setApiProfiles] = useState<ApiProfileSummary[]>([]);
  const [apiActiveId, setApiActiveId] = useState<string | null>(null);
  const [apiSwitching, setApiSwitching] = useState(false);
  const [apiSwitchError, setApiSwitchError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings/ai", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as ApiSettingsResponse & {
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "读取模型配置失败。");
        if (!cancelled) {
          setApiProfiles(body.profiles ?? []);
          setApiActiveId(body.activeId ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function switchApiProfile(profileId: string) {
    if (apiSwitching || profileId === apiActiveId) return;
    setApiSwitching(true);
    setApiSwitchError("");
    setFailoverNotice("");
    try {
      const response = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "switch_profile", profileId }),
      });
      const body = (await response.json()) as ApiSettingsResponse & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "切换 API 失败。");
      setApiProfiles(body.profiles ?? []);
      setApiActiveId(body.activeId ?? null);
    } catch (reason) {
      setApiSwitchError(
        reason instanceof Error ? reason.message : "切换 API 失败。",
      );
    } finally {
      setApiSwitching(false);
    }
  }
  const [selectedChoice, setSelectedChoice] = useState("");
  const [customChoice, setCustomChoice] = useState("");
  const [roleplayMode, setRoleplayMode] = useState("mixed");
  const [roleplayInput, setRoleplayInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [streamingChars, setStreamingChars] = useState(0);
  const [failoverNotice, setFailoverNotice] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState("");
  const [regenerationPanelOpen, setRegenerationPanelOpen] = useState(false);
  const [regenerationFeedback, setRegenerationFeedback] = useState("");
  const [regenerationMode, setRegenerationMode] = useState<
    "standard" | "time_fix"
  >("standard");
  const [viewedTurn, setViewedTurn] = useState<LoadedTurn | null>(
    initialAdventure.branchState.recentTurns.at(-1) ?? null,
  );
  const [loadingHistoryTurnId, setLoadingHistoryTurnId] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [pendingChecks, setPendingChecks] = useState<PendingCheckInfo[] | null>(
    null,
  );
  const [pendingTurnId, setPendingTurnId] = useState("");
  const [pendingExpectedHeadTurnId, setPendingExpectedHeadTurnId] =
    useState("");
  const [checkRolls, setCheckRolls] = useState<Record<string, number | null>>(
    {},
  );
  const [checkSubmitting, setCheckSubmitting] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [storyWorkbenchTab, setStoryWorkbenchTab] =
    useState<StoryWorkbenchTab | null>(null);
  const characterManagerOpen = storyWorkbenchTab === "characters";
  const setCharacterManagerOpen = (open: boolean) =>
    setStoryWorkbenchTab(open ? "characters" : null);
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(
    null,
  );
  const [characterForm, setCharacterForm] = useState(emptyCharacterForm);
  const [characterManagerError, setCharacterManagerError] = useState("");
  const [savingCharacter, setSavingCharacter] = useState(false);
  const [restrictionEditorCharacterId, setRestrictionEditorCharacterId] =
    useState<string | null>(null);
  const [restrictionForm, setRestrictionForm] = useState({
    kind: "imprisoned",
    summary: "",
  });
  const [statusEditorCharacterId, setStatusEditorCharacterId] = useState<
    string | null
  >(null);
  const [statusEditorText, setStatusEditorText] = useState("");
  const [statusEditorError, setStatusEditorError] = useState("");
  const locationManagerOpen = storyWorkbenchTab === "locations";
  const setLocationManagerOpen = (open: boolean) =>
    setStoryWorkbenchTab(open ? "locations" : null);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [locationForm, setLocationForm] = useState(emptyLocationForm);
  const [locationManagerError, setLocationManagerError] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);
  const storyModuleManagerOpen = storyWorkbenchTab === "story_modules";
  const setStoryModuleManagerOpen = (open: boolean) =>
    setStoryWorkbenchTab(open ? "story_modules" : null);
  const [editingStoryModuleId, setEditingStoryModuleId] = useState<
    string | null
  >(null);
  const [storyModuleForm, setStoryModuleForm] = useState(
    emptyStoryModuleForm,
  );
  const [storyModuleManagerError, setStoryModuleManagerError] = useState("");
  const [savingStoryModule, setSavingStoryModule] = useState(false);
  const foreshadowingManagerOpen = storyWorkbenchTab === "foreshadowing";
  const setForeshadowingManagerOpen = (open: boolean) =>
    setStoryWorkbenchTab(open ? "foreshadowing" : null);
  const [editingForeshadowingId, setEditingForeshadowingId] = useState<
    string | null
  >(null);
  const [foreshadowingForm, setForeshadowingForm] = useState(
    emptyForeshadowingForm,
  );
  const [foreshadowingError, setForeshadowingError] = useState("");
  const [savingForeshadowing, setSavingForeshadowing] = useState(false);
  const triggerManagerOpen = storyWorkbenchTab === "triggers";
  const setTriggerManagerOpen = (open: boolean) =>
    setStoryWorkbenchTab(open ? "triggers" : null);
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [triggerForm, setTriggerForm] = useState(emptyTriggerForm);
  const [triggerError, setTriggerError] = useState("");
  const [savingTrigger, setSavingTrigger] = useState(false);
  const [foreshadowingFilter, setForeshadowingFilter] = useState<
    "all" | "dormant" | "seeded" | "paid_off"
  >("all");
  const [expandedForeshadowingId, setExpandedForeshadowingId] = useState<
    string | null
  >(null);
  const [triggerFilter, setTriggerFilter] = useState<"all" | "armed" | "fired">(
    "all",
  );
  const [expandedTriggerId, setExpandedTriggerId] = useState<string | null>(
    null,
  );
  const worldBookManagerOpen = storyWorkbenchTab === "world_book";
  const setWorldBookManagerOpen = (open: boolean) =>
    setStoryWorkbenchTab(open ? "world_book" : null);
  const [editingWorldBookId, setEditingWorldBookId] = useState<string | null>(
    null,
  );
  const [worldBookForm, setWorldBookForm] = useState(emptyWorldBookForm);
  const [worldBookManagerError, setWorldBookManagerError] = useState("");
  const [savingWorldBook, setSavingWorldBook] = useState(false);
  const [worldBookSearch, setWorldBookSearch] = useState("");
  const [worldBookLayerFilter, setWorldBookLayerFilter] = useState("all");
  const stateAuditOpen = storyWorkbenchTab === "state_audit";
  const setStateAuditOpen = (open: boolean) =>
    setStoryWorkbenchTab(open ? "state_audit" : null);
  const [stateAudit, setStateAudit] = useState<StateAuditDashboard | null>(null);
  const [contentAssetChanges, setContentAssetChanges] = useState<
    ContentAssetManagementChange[]
  >([]);
  const [stateAuditError, setStateAuditError] = useState("");
  const [stateAuditBusy, setStateAuditBusy] = useState("");
  const [reasonPrompt, setReasonPrompt] = useState<ReasonPromptState | null>(
    null,
  );
  const [reasonPromptValue, setReasonPromptValue] = useState("");
  const [turnContextOpen, setTurnContextOpen] = useState(false);
  const [turnContext, setTurnContext] = useState<LoadedTurnContextSnapshot | null>(null);
  const [turnContextError, setTurnContextError] = useState("");
  const [turnContextLoading, setTurnContextLoading] = useState(false);
  const [sourceDocuments, setSourceDocuments] = useState(
    initialSourceDocuments,
  );
  const sourceManagerOpen = storyWorkbenchTab === "sources";
  const setSourceManagerOpen = (open: boolean) =>
    setStoryWorkbenchTab(open ? "sources" : null);
  const [sourceManagerError, setSourceManagerError] = useState("");
  const [savingSourceId, setSavingSourceId] = useState("");
  const [importingSource, setImportingSource] = useState(false);
  const [branches, setBranches] = useState(initialBranches);
  const [recoveryPoints, setRecoveryPoints] = useState(
    initialRecoveryPoints,
  );
  const [branchManagerOpen, setBranchManagerOpen] = useState(false);
  const [branchManagerError, setBranchManagerError] = useState("");
  const [branchBusyAction, setBranchBusyAction] = useState("");
  const [branchName, setBranchName] = useState("");
  const [renamingBranchId, setRenamingBranchId] = useState<string | null>(null);
  const [branchRenameValue, setBranchRenameValue] = useState("");
  const [branchSourceTurnId, setBranchSourceTurnId] = useState(
    initialAdventure.branchState.branch.headTurnId ?? "",
  );
  const [branchRecoveryPointId, setBranchRecoveryPointId] = useState("");
  const [savePointName, setSavePointName] = useState("");
  const [memory, setMemory] = useState(initialMemory);
  const memoryManagerOpen = storyWorkbenchTab === "memories";
  const setMemoryManagerOpen = (open: boolean) =>
    setStoryWorkbenchTab(open ? "memories" : null);
  const [memoryManagerError, setMemoryManagerError] = useState("");
  const [memoryBusy, setMemoryBusy] = useState("");
  const pendingIdempotencyKey = useRef<string | null>(null);
  const pendingRegenerationAction = useRef<{
    turnId: string;
    actionId: string;
    feedback: string;
    mode: "standard" | "time_fix";
  } | null>(null);
  const pendingContentActions = useRef<
    Partial<
      Record<StoryContentDomain, { signature: string; actionId: string }>
    >
  >({});
  const pendingStateAuditAction = useRef<{
    signature: string;
    actionId: string;
  } | null>(null);
  // 当前分支 ID 的即时引用：分支/存档面板切换、恢复等操作会整体替换 adventure，
  // 在途请求（回合生成、重生成、属性判定、内容管理、状态审计）完成后若发现
  // 响应属于旧分支，必须丢弃，避免旧分支状态覆盖新分支界面，导致后续提交因
  // 分支头不一致而失败（“本轮没有保存”）。
  const currentBranchIdRef = useRef(adventure.branchState.branch.id);
  currentBranchIdRef.current = adventure.branchState.branch.id;

  const sessionState = adventure.branchState.states.find(
    (state) => state.entityType === "session_state" && state.entityId === "core",
  )?.state;
  const firedBadEndTriggers = adventure.branchState.states
    .filter((state) => {
      if (state.entityType !== "plot_trigger") return false;
      if (text(state.state.status) !== "fired") return false;
      const stateEffects =
        state.state.stateEffects !== null &&
        typeof state.state.stateEffects === "object" &&
        !Array.isArray(state.state.stateEffects)
          ? state.state.stateEffects
          : {};
      const flags = Array.isArray(stateEffects.flags)
        ? stateEffects.flags
        : [];
      return flags.includes("bad_end");
    })
    .map((state) => ({
      triggerId: text(state.state.triggerId, state.entityId),
      consequence: text(state.state.consequence, ""),
      firedAtTurnId: text(state.state.firedAtTurnId),
    }))
    .sort((left, right) => right.firedAtTurnId.localeCompare(left.firedAtTurnId));
  const storyDirection = adventure.branchState.states.find(
    (state) => state.entityType === "story_direction" && state.isActive,
  )?.state;
  const rawStoryModules = adventure.branchState.states
    .filter((state) => state.entityType === "story_module")
    .map((state) => ({
      id: text(state.state.moduleId, state.entityId),
      title: text(state.state.title, "未命名任务"),
      objective: text(state.state.objective),
      completionCriteria: strings(state.state.completionCriteria),
      activationConditions: strings(state.state.activationConditions),
      prerequisiteModuleIds: strings(state.state.prerequisiteModuleIds),
      continuityNotes: text(state.state.continuityNotes),
      autoContinue: state.state.autoContinue !== false,
      status: text(state.state.status, "queued"),
      order: typeof state.state.order === "number" ? state.state.order : 0,
      isEnabled: state.isActive,
    }))
    .sort((left, right) => left.order - right.order);
  const storyModuleById = new Map(
    rawStoryModules.map((module) => [module.id, module]),
  );
  const storyModuleDepthCache = new Map<string, number>();
  function storyModuleDepth(moduleId: string, visiting = new Set<string>()): number {
    const cached = storyModuleDepthCache.get(moduleId);
    if (cached !== undefined) return cached;
    if (visiting.has(moduleId)) return 0;
    const taskModule = storyModuleById.get(moduleId);
    if (!taskModule || taskModule.prerequisiteModuleIds.length === 0) return 0;
    const nextVisiting = new Set(visiting).add(moduleId);
    const depth =
      Math.max(
        ...taskModule.prerequisiteModuleIds.map(
          (prerequisiteId) => storyModuleDepth(prerequisiteId, nextVisiting) + 1,
        ),
      ) || 0;
    storyModuleDepthCache.set(moduleId, depth);
    return depth;
  }
  const storyModules = rawStoryModules.map((module) => ({
    ...module,
    depth: storyModuleDepth(module.id),
  }));
  const characterCards = adventure.branchState.states.filter(
    (state) => state.entityType === "character_card",
  );
  const characterStatesById = new Map(
    adventure.branchState.states
      .filter((state) => state.entityType === "character_state")
      .map((state) => [state.entityId, state]),
  );
  const worldStateRecords = adventure.branchState.states.filter(
    (state) => state.entityType === "world_book_entry",
  );
  const activeWorldStateRecords = worldStateRecords.filter(
    (state) => state.isActive,
  );
  const shadowedWorldEntries = new Set(
    activeWorldStateRecords
      .map((state) => text(state.state.shadowsEntryId))
      .filter(Boolean),
  );
  const worldEntries = activeWorldStateRecords.filter(
    (state) =>
      !shadowedWorldEntries.has(state.entityId) && state.state.enabled !== false,
  );
  const worldBookItems = worldStateRecords.map((record) => {
    const layer = text(record.state.layer, "base");
    const shadowsEntryId = text(record.state.shadowsEntryId);
    const baseRecord = shadowsEntryId
      ? worldStateRecords.find((candidate) => candidate.entityId === shadowsEntryId)
      : undefined;
    const comparableFields = [
      "comment",
      "keys",
      "secondaryKeys",
      "content",
      "enabled",
      "constant",
      "selective",
      "position",
      "order",
      "probability",
      "depth",
    ];
    const changedFields = baseRecord
      ? comparableFields.filter(
          (field) =>
            JSON.stringify(baseRecord.state[field]) !==
            JSON.stringify(record.state[field]),
        )
      : [];
    const source = isObject(record.state.source) ? record.state.source : {};
    return {
      record,
      id: record.entityId,
      title:
        text(record.state.comment) ||
        strings(record.state.keys)[0] ||
        "未命名世界事实",
      keys: strings(record.state.keys),
      secondaryKeys: strings(record.state.secondaryKeys),
      content: text(record.state.content),
      layer,
      layerLabel: worldBookLayerLabel(layer),
      enabled: record.state.enabled !== false,
      removedByPlayer: record.state.removedByPlayer === true,
      isEffective:
        record.isActive &&
        record.state.enabled !== false &&
        !shadowedWorldEntries.has(record.entityId),
      shadowsEntryId,
      baseRecord,
      changedFields,
      sourceBookName: text(source.bookName),
    };
  });
  const filteredWorldBookItems = worldBookItems.filter((entry) => {
    if (worldBookLayerFilter !== "all" && entry.layer !== worldBookLayerFilter) {
      return false;
    }
    const query = worldBookSearch.trim().toLocaleLowerCase("zh-CN");
    if (!query) return true;
    return [entry.title, entry.content, ...entry.keys, ...entry.secondaryKeys]
      .join("\n")
      .toLocaleLowerCase("zh-CN")
      .includes(query);
  });
  const latestTurn = adventure.branchState.recentTurns.at(-1);
  const currentBranch =
    branches.find((branch) => branch.isActive) ?? branches[0];
  const displayedTurn = viewedTurn ?? latestTurn;
  const isViewingHistory = Boolean(
    displayedTurn && latestTurn && displayedTurn.id !== latestTurn.id,
  );
  const turn = isObject(displayedTurn?.generatedOutput.turn)
    ? displayedTurn.generatedOutput.turn
    : {};
  const decision = isObject(displayedTurn?.generatedOutput.decision)
    ? displayedTurn.generatedOutput.decision
    : {};
  const choices = records(decision.choices);
  const dialogue = records(turn.dialogue);
  const sourceReferences = records(
    displayedTurn?.generatedOutput.sourceReferences,
  );
  const scriptGuidanceReferences = records(
    displayedTurn?.generatedOutput.scriptGuidanceReferences,
  );
  const scriptGuidanceScope =
    (scriptGuidanceReferences[0]?.scope ?? "next_chapter_director_only") ===
    "next_chapter_progress_hint"
      ? "next_chapter_progress_hint"
      : "next_chapter_director_only";
  const displayedStateChanges = displayedTurn?.stateChanges ?? [];
  const displayedBlockedStateChanges = displayedTurn?.blockedStateChanges ?? [];
  const turnWarnings = strings(displayedTurn?.generatedOutput.warnings);
  const generation = displayedTurn?.generation;
  const contextCharacterCoverage = records(
    turnContext?.diagnostics.characterCoverage,
  );
  const contextSections = records(turnContext?.diagnostics.sections);
  const contextWarnings = strings(turnContext?.diagnostics.warnings);
  const contextTruncation = isObject(turnContext?.diagnostics.truncation)
    ? turnContext.diagnostics.truncation
    : {};
  const historicalSelectedChoice = isObject(
    displayedTurn?.playerInput.selectedChoice,
  )
    ? displayedTurn.playerInput.selectedChoice
    : undefined;
  const historicalRoleplay = isObject(displayedTurn?.playerInput.roleplay)
    ? displayedTurn.playerInput.roleplay
    : undefined;
  const historicalInputParts = [
    text(historicalSelectedChoice?.label)
      ? `选择：${text(historicalSelectedChoice?.label)}`
      : "",
    text(displayedTurn?.playerInput.customChoice)
      ? `自定义：${text(displayedTurn?.playerInput.customChoice)}`
      : "",
    text(historicalRoleplay?.content)
      ? `角色言行：${text(historicalRoleplay?.content)}`
      : "",
  ].filter(Boolean);
  const initialDirection = text(storyDirection?.content);
  const [directionInput, setDirectionInput] = useState(initialDirection);

  const characterNames = characterCards.map((card) => {
    const data = isObject(card.state.data) ? card.state.data : {};
    const currentState = characterStatesById.get(card.entityId);
    const restriction = isObject(currentState?.state.restriction)
      ? currentState.state.restriction
      : null;
    const statuses = Array.isArray(currentState?.state.statuses)
      ? currentState.state.statuses
          .filter((item) => isObject(item))
          .map((item) => ({
            id: text(item.id),
            name: text(item.name, "未命名状态"),
            kind: text(item.kind, "debuff"),
            description: text(item.description),
            hidden: item.hidden === true,
            ...(typeof item.expiresAtDay === "number"
              ? { expiresAtDay: item.expiresAtDay }
              : {}),
          }))
      : [];
    return {
      id: card.entityId,
      name: text(data.name, "未命名角色"),
      description: text(data.description),
      personality: text(data.personality),
      firstMessage: text(data.first_mes),
      cardRole: text(card.state.role),
      isActive: card.isActive,
      present: currentState?.state.present !== false,
      restriction: restriction as { kind: string; summary: string } | null,
      statuses,
    };
  });
  const characterNameById = new Map(
    characterNames.map((character) => [character.id, character.name]),
  );
  const relationshipStates = adventure.branchState.states
    .filter((state) => state.entityType === "relationship")
    .map((state) => {
      const number = (key: string) =>
        typeof state.state[key] === "number" ? state.state[key] : 0;
      return {
        id: state.entityId,
        sourceId: text(state.state.sourceCharacterId),
        targetId: text(state.state.targetCharacterId),
        trust: number("trust"),
        affinity: number("affinity"),
        fear: number("fear"),
        hostility: number("hostility"),
        respect: number("respect"),
        summary: text(state.state.summary),
      };
    });
  const mergedRelationships = (() => {
    const byPair = new Map<string, typeof relationshipStates>();
    for (const relationship of relationshipStates) {
      const pairKey =
        relationship.sourceId < relationship.targetId
          ? `${relationship.sourceId}\u0000${relationship.targetId}`
          : `${relationship.targetId}\u0000${relationship.sourceId}`;
      const bucket = byPair.get(pairKey) ?? [];
      bucket.push(relationship);
      byPair.set(pairKey, bucket);
    }
    return [...byPair.values()].map((pair) => {
      const left = pair[0];
      const right = pair[1];
      const value = (key: "trust" | "affinity" | "fear" | "hostility" | "respect") =>
        right
          ? { source: left[key], target: right[key] }
          : { source: left[key], target: null };
      return {
        key: `${left.sourceId}\u0000${left.targetId}`,
        sourceId: left.sourceId,
        targetId: left.targetId,
        symmetric: pair.length === 2,
        summary: right ? (left.summary || right.summary) : left.summary,
        trust: value("trust"),
        affinity: value("affinity"),
        fear: value("fear"),
        hostility: value("hostility"),
        respect: value("respect"),
      };
    });
  })();
  const activeCharacterNames = characterNames.filter(
    (character) => character.isActive,
  );
  const manageableCharacters = characterNames.filter(
    (character) => character.cardRole !== "player",
  );
  const locations = adventure.branchState.states
    .filter((state) => state.entityType === "location")
    .map((location) => ({
      id: location.entityId,
      name: text(location.state.name, "未命名地点"),
      description: text(location.state.description, "尚未记录地点描述。"),
      defaultCharacterIds: Array.isArray(location.state.defaultCharacterIds)
        ? location.state.defaultCharacterIds.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      important: location.state.important === true,
      source: text(location.state.source),
      isActive: location.isActive,
    }));
  const currentLocationId = text(sessionState?.currentLocationId);
  const currentLocation = locations.find(
    (location) => location.id === currentLocationId,
  );
  const gameTimeDay =
    typeof sessionState?.gameTimeDay === "number" ? sessionState.gameTimeDay : 1;
  const timeMode =
    sessionState?.timeMode === "turn_based" ? "turn_based" : "story";
  const phaseOffset =
    typeof sessionState?.phaseOffset === "number" ? sessionState.phaseOffset : 0;
  const currentDayPhase =
    timeMode === "turn_based" ? dayPhaseOf(phaseOffset) : undefined;
  const charactersByLocation = new Map<string, string[]>();
  for (const character of characterNames) {
    const locationId = text(
      adventure.branchState.states.find(
        (state) =>
          state.entityType === "character_state" &&
          state.entityId === character.id,
      )?.state.locationId,
    );
    if (!locationId) continue;
    const bucket = charactersByLocation.get(locationId) ?? [];
    bucket.push(character.name);
    charactersByLocation.set(locationId, bucket);
  }
  function turnGameTimeDay(turn: LoadedTurn | null | undefined) {
    const change = turn?.stateChanges?.find(
      (candidate) =>
        candidate.entityType === "session_state" &&
        candidate.entityId === "core" &&
        typeof candidate.payload.gameTimeDay === "number",
    );
    return typeof change?.payload.gameTimeDay === "number"
      ? change.payload.gameTimeDay
      : undefined;
  }
  // 历史回合所处时段：该回合提交后的 phaseOffset 快照反推（提交前 = P − 1）；
  // 无 phaseOffset 快照的回合（story 模式时代、开局回合）返回 undefined。
  function turnDayPhase(turn: LoadedTurn | null | undefined) {
    const change = turn?.stateChanges?.find(
      (candidate) =>
        candidate.entityType === "session_state" &&
        candidate.entityId === "core" &&
        typeof candidate.payload.phaseOffset === "number",
    );
    return typeof change?.payload.phaseOffset === "number"
      ? dayPhaseOf(change.payload.phaseOffset - 1)
      : undefined;
  }
  function auditTargetLabel(
    change: Pick<StateAuditChange, "entityType" | "entityId">,
  ) {
    if (
      change.entityType === "character_card" ||
      change.entityType === "character_state" ||
      change.entityType === "character_card_evolution"
    ) {
      return characterNameById.get(change.entityId) ?? change.entityId;
    }
    if (change.entityType === "location") {
      return locations.find((location) => location.id === change.entityId)?.name ?? change.entityId;
    }
    if (change.entityType === "story_module") {
      return storyModuleById.get(change.entityId.replace(/^story-module:/, ""))?.title ?? change.entityId;
    }
    if (change.entityType === "world_book_entry") return "世界书条目";
    if (change.entityType === "story_direction") return "当前剧情走向";
    if (change.entityType === "relationship") return "角色关系";
    return change.entityId === "core" ? "当前场景" : change.entityId;
  }
  const canSubmit = Boolean(
    selectedChoice ||
      customChoice.trim() ||
      roleplayInput.trim() ||
      directionInput.trim() !== initialDirection,
  );

  async function streamTurnRequest(
    url: string,
    body: unknown,
    onDelta: (text: string) => void,
    onFailover?: ({ id, name }: { id: string; name: string }) => void,
  ): Promise<AdvanceTurnResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const plain = (await response.json()) as AdvanceTurnResponse & {
        error?: string;
        issues?: string[];
      };
      if (!response.ok || !plain.adventure) {
        throw new Error(
          plain.issues?.[0] ?? plain.error ?? "生成本轮剧情失败。",
        );
      }
      return plain;
    }
    if (!response.body) {
      throw new Error("模型没有返回可读取的流式响应。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pendingResult: AdvanceTurnResponse | null = null;
    let pendingError: Error | null = null;

    function handleEventBlock(block: string) {
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) return;
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      const record = payload as Record<string, unknown>;
      if (event === "delta" && typeof record.text === "string") {
        onDelta(record.text);
      } else if (
        event === "failover" &&
        typeof record.profileId === "string" &&
        typeof record.profileName === "string"
      ) {
        onFailover?.({ id: record.profileId, name: record.profileName });
      } else if (event === "result") {
        pendingResult = payload as AdvanceTurnResponse;
      } else if (event === "error") {
        pendingError = new Error(
          typeof record.error === "string"
            ? record.error
            : "生成本轮剧情失败。",
        );
      }
    }

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        handleEventBlock(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleEventBlock(buffer.trim());

    if (pendingError) throw pendingError;
    if (!pendingResult) {
      throw new Error("生成本轮剧情失败：没有收到模型的完整结果。");
    }
    return pendingResult;
  }

  async function submitTurn() {
    if (!canSubmit || submitting || regenerating) return;
    setSubmitting(true);
    setSubmitError("");
    setRegenerationError("");
    setStreamingChars(0);
    setFailoverNotice("");
    pendingIdempotencyKey.current ??= crypto.randomUUID();

    try {
      const body = await streamTurnRequest(
        `/api/adventures/${adventure.session.id}/turns`,
        {
          expectedHeadTurnId: adventure.branchState.branch.headTurnId,
          idempotencyKey: pendingIdempotencyKey.current,
          selectedChoiceId: selectedChoice || undefined,
          customChoice: customChoice.trim() || undefined,
          roleplay: roleplayInput.trim()
            ? { mode: roleplayMode, content: roleplayInput.trim() }
            : undefined,
          storyDirection: directionInput.trim(),
        },
        (text) => setStreamingChars((current) => current + text.length),
        ({ id, name }) => {
          setApiActiveId(id);
          setFailoverNotice(
            `已自动切换并启用备用配置“${name}”，后续回合将使用该配置，可在顶栏重新选择。`,
          );
        },
      );
      if (!body.adventure) throw new Error("生成本轮剧情失败。");
      if (body.adventure.branchState.branch.id !== currentBranchIdRef.current) {
        // 生成期间切换了分支：本轮已保存到原分支，这里丢弃旧分支响应，
        // 保持当前分支界面不变，玩家可直接在当前分支重新提交。
        pendingIdempotencyKey.current = null;
        return;
      }
      setStreamingChars(0);
      if (body.pendingChecks && body.pendingChecks.length > 0) {
        setPendingChecks(body.pendingChecks);
        setPendingTurnId(body.pendingTurnId ?? "");
        setPendingExpectedHeadTurnId(body.expectedHeadTurnId ?? "");
        setCheckRolls(
          Object.fromEntries(
            body.pendingChecks.map((check) => [check.checkId, null]),
          ),
        );
        setCheckError("");
        return;
      }
      setAdventure(body.adventure);
      setViewedTurn(body.adventure.branchState.recentTurns.at(-1) ?? null);
      setSelectedChoice("");
      setCustomChoice("");
      setRoleplayInput("");
      setRegenerationPanelOpen(false);
      setRegenerationFeedback("");
      setRegenerationMode("standard");
      pendingRegenerationAction.current = null;
      pendingIdempotencyKey.current = null;
      const nextDirection = body.adventure.branchState.states.find(
        (state) => state.entityType === "story_direction" && state.isActive,
      );
      setDirectionInput(text(nextDirection?.state.content));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setStreamingChars(0);
      setSubmitError(
        error instanceof Error ? error.message : "生成本轮剧情失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function regenerateLatestTurn() {
    if (
      !latestTurn?.generation ||
      latestTurn.branchId !== adventure.branchState.branch.id ||
      isViewingHistory ||
      submitting ||
      regenerating
    ) {
      return;
    }
    const feedback = regenerationFeedback.trim();
    const mode = regenerationMode;
    if (mode === "standard" && !feedback) {
      setRegenerationError("请先说明不满意的地方，或写下希望 AI 如何修改。");
      return;
    }
    if (
      pendingRegenerationAction.current?.turnId !== latestTurn.id ||
      pendingRegenerationAction.current.feedback !== feedback ||
      pendingRegenerationAction.current.mode !== mode
    ) {
      pendingRegenerationAction.current = {
        turnId: latestTurn.id,
        actionId: crypto.randomUUID(),
        feedback,
        mode,
      };
    }
    setRegenerating(true);
    setRegenerationError("");
    setStreamingChars(0);
    setFailoverNotice("");
    try {
      const body = await streamTurnRequest(
        `/api/adventures/${adventure.session.id}/turns/regenerate`,
        {
          expectedHeadTurnId: latestTurn.id,
          actionId: pendingRegenerationAction.current.actionId,
          feedback,
          mode,
        },
        (text) => setStreamingChars((current) => current + text.length),
        ({ id, name }) => {
          setApiActiveId(id);
          setFailoverNotice(
            `已自动切换并启用备用配置“${name}”，后续回合将使用该配置，可在顶栏重新选择。`,
          );
        },
      );
      if (!body.adventure) throw new Error("重新生成最新剧情失败。");
      if (body.adventure.branchState.branch.id !== currentBranchIdRef.current) {
        // 重新生成期间切换了分支：替换已发生在原分支，这里丢弃旧分支响应，
        // 保持当前分支界面不变。
        pendingRegenerationAction.current = null;
        return;
      }
      setStreamingChars(0);
      if (body.pendingChecks && body.pendingChecks.length > 0) {
        setPendingChecks(body.pendingChecks);
        setPendingTurnId(body.pendingTurnId ?? "");
        setPendingExpectedHeadTurnId(body.expectedHeadTurnId ?? "");
        setCheckRolls(
          Object.fromEntries(
            body.pendingChecks.map((check) => [check.checkId, null]),
          ),
        );
        setCheckError("");
        return;
      }
      setAdventure(body.adventure);
      setViewedTurn(body.adventure.branchState.recentTurns.at(-1) ?? null);
      setSelectedChoice("");
      setCustomChoice("");
      setRoleplayInput("");
      setRegenerationPanelOpen(false);
      setRegenerationFeedback("");
      setRegenerationMode("standard");
      pendingRegenerationAction.current = null;
      const nextDirection = body.adventure.branchState.states.find(
        (state) => state.entityType === "story_direction" && state.isActive,
      );
      setDirectionInput(text(nextDirection?.state.content));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setStreamingChars(0);
      setRegenerationError(
        error instanceof Error ? error.message : "重新生成最新剧情失败。",
      );
    } finally {
      setRegenerating(false);
    }
  }

  function previewCheckOutcome(check: PendingCheckInfo, roll: number | null) {
    if (check.direct) {
      return check.margin > 0 ? "成功" : "失败";
    }
    if (roll === null) return null;
    const finalValue =
      Math.round((check.attributeValue + roll * 0.3) * 10) / 10;
    if (finalValue >= check.difficulty) return `成功（最终 ${finalValue}）`;
    if (finalValue >= check.difficulty - 10) {
      return `部分成功（最终 ${finalValue}）`;
    }
    return `失败（最终 ${finalValue}）`;
  }

  function rollCheck(checkId: string) {
    setCheckRolls((current) => ({
      ...current,
      [checkId]: 1 + Math.floor(Math.random() * 100),
    }));
  }

  async function resolvePendingChecks(rollsOverride?: Record<string, number | null>) {
    if (!pendingChecks || checkSubmitting) return;
    setCheckSubmitting(true);
    setCheckError("");
    try {
      const rolls = rollsOverride ?? checkRolls;
      const results = pendingChecks.map((check) => ({
        checkId: check.checkId,
        roll: rolls[check.checkId] ?? null,
      }));
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/attribute-checks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            pendingTurnId,
            expectedHeadTurnId: pendingExpectedHeadTurnId,
            results,
          }),
        },
      );
      const body = (await response.json()) as AttributeCheckResolveResponse;
      if (!response.ok || !body.adventure) {
        throw new Error(body.issues?.[0] ?? body.error ?? "属性判定结算失败。");
      }
      if (body.adventure.branchState.branch.id !== currentBranchIdRef.current) {
        // 判定结算期间切换了分支：结算已落库到原分支，这里关闭判定面板，
        // 保持当前分支界面不变。
        setPendingChecks(null);
        pendingIdempotencyKey.current = null;
        return;
      }
      setAdventure(body.adventure);
      setViewedTurn(body.adventure.branchState.recentTurns.at(-1) ?? null);
      setPendingChecks(null);
      setSelectedChoice("");
      setCustomChoice("");
      setRoleplayInput("");
      setRegenerationPanelOpen(false);
      setRegenerationFeedback("");
      setRegenerationMode("standard");
      pendingRegenerationAction.current = null;
      pendingIdempotencyKey.current = null;
      const nextDirection = body.adventure.branchState.states.find(
        (state) => state.entityType === "story_direction" && state.isActive,
      );
      setDirectionInput(text(nextDirection?.state.content));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setCheckError(
        error instanceof Error ? error.message : "属性判定结算失败。",
      );
    } finally {
      setCheckSubmitting(false);
    }
  }

  function skipPendingChecks() {
    if (!pendingChecks || checkSubmitting) return;
    void resolvePendingChecks(
      Object.fromEntries(pendingChecks.map((check) => [check.checkId, null])),
    );
  }

  async function viewHistoryTurn(turnId: string) {
    if (loadingHistoryTurnId) return;
    setHistoryError("");
    const cachedTurn = adventure.branchState.recentTurns.find(
      (candidate) => candidate.id === turnId,
    );
    if (cachedTurn) {
      setViewedTurn(cachedTurn);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setLoadingHistoryTurnId(turnId);
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/turns?turnId=${encodeURIComponent(turnId)}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as HistoryTurnResponse;
      if (!response.ok || !body.turn) {
        throw new Error(body.error ?? "读取历史回合失败。");
      }
      setViewedTurn(body.turn);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : "读取历史回合失败。",
      );
    } finally {
      setLoadingHistoryTurnId("");
    }
  }

  function applyBranchPayload(body: BranchManagementResponse) {
    if (!body.adventure || !body.branches || !body.recoveryPoints) {
      throw new Error(body.error ?? "分支操作没有返回完整剧情状态。");
    }
    setAdventure(body.adventure);
    setBranches(body.branches);
    setRecoveryPoints(body.recoveryPoints);
    const nextTurn = body.adventure.branchState.recentTurns.at(-1) ?? null;
    setViewedTurn(nextTurn);
    setBranchSourceTurnId(
      body.adventure.branchState.branch.headTurnId ?? "",
    );
    setBranchRecoveryPointId("");
    setSelectedChoice("");
    setCustomChoice("");
    setRoleplayInput("");
    setRegenerationPanelOpen(false);
    setRegenerationFeedback("");
    setRegenerationMode("standard");
    pendingIdempotencyKey.current = null;
    pendingRegenerationAction.current = null;
    const nextDirection = body.adventure.branchState.states.find(
      (state) => state.entityType === "story_direction" && state.isActive,
    );
    setDirectionInput(text(nextDirection?.state.content));
  }

  async function refreshBranchMetadata() {
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/branches`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as BranchManagementResponse;
      if (!response.ok || !body.branches || !body.recoveryPoints) {
        throw new Error(body.error ?? "读取分支和存档失败。");
      }
      setBranches(body.branches);
      setRecoveryPoints(body.recoveryPoints);
    } catch (error) {
      setBranchManagerError(
        error instanceof Error ? error.message : "读取分支和存档失败。",
      );
    }
  }

  function openBranchManagerForTurn(turnId?: string, sequence?: number) {
    const selectedTurnId =
      turnId ?? adventure.branchState.branch.headTurnId ?? "";
    setBranchSourceTurnId(selectedTurnId);
    setBranchRecoveryPointId("");
    setBranchName(
      sequence
        ? `从第 ${sequence} 回合开始`
        : `${adventure.branchState.branch.name}的新分支`,
    );
    setBranchManagerError("");
    setBranchManagerOpen(true);
    void refreshBranchMetadata();
  }

  async function createBranchFromSelection(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (branchBusyAction || !branchName.trim()) return;
    if (!branchRecoveryPointId && !branchSourceTurnId) {
      setBranchManagerError("请选择一个历史回合或存档作为分支起点。");
      return;
    }
    setBranchBusyAction("create");
    setBranchManagerError("");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/branches`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: branchName.trim(),
            ...(branchRecoveryPointId
              ? { recoveryPointId: branchRecoveryPointId }
              : { sourceTurnId: branchSourceTurnId }),
          }),
        },
      );
      const body = (await response.json()) as BranchManagementResponse;
      if (!response.ok) {
        throw new Error(body.issues?.[0] ?? body.error ?? "创建分支失败。");
      }
      applyBranchPayload(body);
      setBranchName("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setBranchManagerError(
        error instanceof Error ? error.message : "创建分支失败。",
      );
    } finally {
      setBranchBusyAction("");
    }
  }

  async function switchToBranch(branch: AdventureBranchSummary) {
    if (branch.isActive || branchBusyAction) return;
    setBranchBusyAction(`switch:${branch.id}`);
    setBranchManagerError("");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/branches/${branch.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "switch" }),
        },
      );
      const body = (await response.json()) as BranchManagementResponse;
      if (!response.ok) throw new Error(body.error ?? "切换分支失败。");
      applyBranchPayload(body);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setBranchManagerError(
        error instanceof Error ? error.message : "切换分支失败。",
      );
    } finally {
      setBranchBusyAction("");
    }
  }

  function startRenameBranch(branch: AdventureBranchSummary) {
    if (branchBusyAction) return;
    setBranchManagerError("");
    setRenamingBranchId(branch.id);
    setBranchRenameValue(branch.name);
  }

  async function submitBranchRename(branch: AdventureBranchSummary) {
    if (branchBusyAction) return;
    const requestedName = branchRenameValue.trim();
    if (!requestedName) {
      setBranchManagerError("分支名称不能为空。");
      return;
    }
    if (requestedName === branch.name) {
      setRenamingBranchId(null);
      setBranchRenameValue("");
      return;
    }
    setBranchBusyAction(`rename:${branch.id}`);
    setBranchManagerError("");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/branches/${branch.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "rename", name: requestedName }),
        },
      );
      const body = (await response.json()) as BranchManagementResponse;
      if (!response.ok) throw new Error(body.error ?? "重命名分支失败。");
      applyBranchPayload(body);
      setRenamingBranchId(null);
      setBranchRenameValue("");
    } catch (error) {
      setBranchManagerError(
        error instanceof Error ? error.message : "重命名分支失败。",
      );
    } finally {
      setBranchBusyAction("");
    }
  }

  async function setBranchAsMain(branch: AdventureBranchSummary) {
    if (branchBusyAction || branch.isMain) return;
    if (
      !window.confirm(
        `确定将分支“${branch.name}”设为主线吗？\n\n设为新主线后，新主线会吸收原主线及其父链在分叉点之前的历史，成为完整的主线故事；原主线及其父链会变为新主线的分支，各自在分叉点之后的进展会保留，仍可继续发展（没有后续进展的分支为空分支，也可删除）。主线身份与删除保护随之转移到新主线。`,
      )
    ) {
      return;
    }
    setBranchBusyAction(`set-main:${branch.id}`);
    setBranchManagerError("");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/branches/${branch.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "set_main" }),
        },
      );
      const body = (await response.json()) as BranchManagementResponse;
      if (!response.ok) throw new Error(body.error ?? "设置主线失败。");
      applyBranchPayload(body);
    } catch (error) {
      setBranchManagerError(
        error instanceof Error ? error.message : "设置主线失败。",
      );
    } finally {
      setBranchBusyAction("");
    }
  }

  async function deleteExistingBranch(branch: AdventureBranchSummary) {
    if (
      branchBusyAction ||
      !window.confirm(
        `确定删除分支“${branch.name}”吗？\n\n只会删除该分支独有的后续剧情、状态和存档；父分支不会受到影响。此操作无法撤销。`,
      )
    ) {
      return;
    }
    setBranchBusyAction(`delete:${branch.id}`);
    setBranchManagerError("");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/branches/${branch.id}`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as BranchManagementResponse;
      if (!response.ok) throw new Error(body.error ?? "删除分支失败。");
      applyBranchPayload(body);
    } catch (error) {
      setBranchManagerError(
        error instanceof Error ? error.message : "删除分支失败。",
      );
    } finally {
      setBranchBusyAction("");
    }
  }

  async function createManualSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (branchBusyAction || !savePointName.trim()) return;
    setBranchBusyAction("save");
    setBranchManagerError("");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/saves`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: savePointName.trim() }),
        },
      );
      const body = (await response.json()) as SavePointResponse;
      if (!response.ok || !body.recoveryPoints) {
        throw new Error(body.issues?.[0] ?? body.error ?? "建立存档失败。");
      }
      setRecoveryPoints(body.recoveryPoints);
      setSavePointName("");
    } catch (error) {
      setBranchManagerError(
        error instanceof Error ? error.message : "建立存档失败。",
      );
    } finally {
      setBranchBusyAction("");
    }
  }

  function selectRecoveryPoint(point: AdventureRecoveryPoint) {
    setBranchRecoveryPointId(point.id);
    setBranchSourceTurnId("");
    setBranchName(`恢复 ${point.name}`.slice(0, 80));
    setBranchManagerError("");
  }

  async function deleteManualSave(point: AdventureRecoveryPoint) {
    if (
      point.type !== "manual" ||
      branchBusyAction ||
      !window.confirm(`确定删除手动存档“${point.name}”吗？`)
    ) {
      return;
    }
    setBranchBusyAction(`save-delete:${point.id}`);
    setBranchManagerError("");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/saves/${point.id}`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as SavePointResponse;
      if (!response.ok || !body.recoveryPoints) {
        throw new Error(body.error ?? "删除存档失败。");
      }
      setRecoveryPoints(body.recoveryPoints);
      if (branchRecoveryPointId === point.id) setBranchRecoveryPointId("");
    } catch (error) {
      setBranchManagerError(
        error instanceof Error ? error.message : "删除存档失败。",
      );
    } finally {
      setBranchBusyAction("");
    }
  }

  async function restoreToSavePoint(point: AdventureRecoveryPoint) {
    if (branchBusyAction) return;
    const restoredHint =
      point.branchId === adventure.branchState.branch.id
        ? `恢复后当前分支会回到回合 ${point.sequence}，该回合之后推进的剧情与状态将被删除；其他分支不受影响。`
        : `恢复后会切换到分支“${point.branchName}”并回到回合 ${point.sequence}，该分支在此之后推进的剧情与状态将被删除。`;
    if (
      !window.confirm(
        `确定恢复到存档“${point.name}”吗？\n\n${restoredHint}\n\n此操作无法撤销，请谨慎选择。`,
      )
    ) {
      return;
    }
    setBranchBusyAction(`restore:${point.id}`);
    setBranchManagerError("");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/saves/${point.id}/restore`,
        { method: "POST" },
      );
      const body = (await response.json()) as BranchManagementResponse;
      if (!response.ok) throw new Error(body.error ?? "恢复存档失败。");
      applyBranchPayload(body);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setBranchManagerError(
        error instanceof Error ? error.message : "恢复存档失败。",
      );
    } finally {
      setBranchBusyAction("");
    }
  }

  async function sendStoryContentCommand(
    domain: StoryContentDomain,
    command: Record<string, unknown>,
    fallbackMessage: string,
  ) {
    const signature = JSON.stringify(command);
    if (pendingContentActions.current[domain]?.signature !== signature) {
      pendingContentActions.current[domain] = {
        signature,
        actionId: crypto.randomUUID(),
      };
    }
    const pending = pendingContentActions.current[domain]!;
    const response = await fetch(
      `/api/adventures/${adventure.session.id}/content`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "1.0.0",
          actionId: pending.actionId,
          domain,
          command,
        }),
      },
    );
    const body = (await response.json()) as StoryContentResponse;
    if (!response.ok || !body.content) {
      throw new Error(
        body.error?.issues?.[0] ?? body.error?.message ?? fallbackMessage,
      );
    }

    if (body.content.adventure.branchState.branch.id === currentBranchIdRef.current) {
      setAdventure(body.content.adventure);
      setSourceDocuments(body.content.sourceDocuments);
      setMemory(body.content.memory);
      if (!isViewingHistory) {
        setViewedTurn(
          body.content.adventure.branchState.recentTurns.at(-1) ?? null,
        );
      }
    }
    delete pendingContentActions.current[domain];
    return body.content;
  }

  function startAddingCharacter() {
    setEditingCharacterId("__new__");
    setCharacterForm(emptyCharacterForm);
    setCharacterManagerError("");
  }

  function startEditingCharacter(characterId: string) {
    const character = manageableCharacters.find(
      (candidate) => candidate.id === characterId,
    );
    if (!character) return;
    setEditingCharacterId(character.id);
    setCharacterForm({
      name: character.name,
      role: character.description,
      personality: character.personality,
      firstMessage: character.firstMessage,
    });
    setCharacterManagerError("");
  }

  async function runCharacterOperation(payload: Record<string, unknown>) {
    if (savingCharacter) return false;
    setSavingCharacter(true);
    setCharacterManagerError("");
    try {
      await sendStoryContentCommand(
        "characters",
        payload,
        "保存人物变化失败。",
      );
      return true;
    } catch (error) {
      setCharacterManagerError(
        error instanceof Error ? error.message : "保存人物变化失败。",
      );
      return false;
    } finally {
      setSavingCharacter(false);
    }
  }

  async function submitCharacterForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation = editingCharacterId === "__new__" ? "create" : "update";
    const saved = await runCharacterOperation({
      operation,
      ...(operation === "update"
        ? { characterId: editingCharacterId }
        : {}),
      character: characterForm,
    });
    if (saved) setEditingCharacterId(null);
  }

  async function setCharacterPresence(characterId: string, present: boolean) {
    await runCharacterOperation({
      operation: "set_presence",
      characterId,
      present,
    });
  }

  async function setCharacterActive(characterId: string, active: boolean) {
    if (
      !active &&
      !window.confirm(
        "确定停用这个角色吗？\n\n停用后 AI 模型不会继续扮演该角色，角色卡和历史记录仍会保留，并可随时重新启用。",
      )
    ) {
      return;
    }
    await runCharacterOperation({
      operation: "set_active",
      characterId,
      active,
    });
  }

  const restrictionKindLabels: Record<string, string> = {
    dead: "已死亡",
    imprisoned: "被关押",
    controlled: "被控制",
    bound: "被束缚",
    other: "其他受限",
  };

  async function setCharacterRestriction(
    characterId: string,
    restriction: { kind: string; summary: string } | null,
  ) {
    const saved = await runCharacterOperation({
      operation: "set_restriction",
      characterId,
      restriction,
    });
    if (saved) setRestrictionEditorCharacterId(null);
  }

  function startRestrictionEditor(characterId: string) {
    const character = manageableCharacters.find(
      (candidate) => candidate.id === characterId,
    );
    setRestrictionEditorCharacterId(characterId);
    setRestrictionForm({
      kind: character?.restriction?.kind ?? "imprisoned",
      summary: character?.restriction?.summary ?? "",
    });
    setCharacterManagerError("");
  }

  function startStatusEditor(characterId: string) {
    const character = manageableCharacters.find(
      (candidate) => candidate.id === characterId,
    );
    setStatusEditorCharacterId(characterId);
    setStatusEditorText(
      character && character.statuses.length > 0
        ? JSON.stringify(character.statuses, null, 2)
        : "",
    );
    setStatusEditorError("");
    setCharacterManagerError("");
  }

  async function submitCharacterStatuses(characterId: string) {
    let statuses: unknown = null;
    const trimmed = statusEditorText.trim();
    if (trimmed) {
      try {
        statuses = JSON.parse(trimmed);
      } catch {
        setStatusEditorError("状态词条不是有效的 JSON，请检查格式。");
        return;
      }
    }
    const saved = await runCharacterOperation({
      operation: "set_statuses",
      characterId,
      statuses,
    });
    if (saved) {
      setStatusEditorCharacterId(null);
      setStatusEditorError("");
    }
  }

  async function clearCharacterStatuses(characterId: string) {
    if (
      !window.confirm(
        "确定清除该角色的全部状态词条吗？\n\n剧情中的 buff/debuff 记录会被清空，角色卡与历史回合不会改写。",
      )
    ) {
      return;
    }
    const saved = await runCharacterOperation({
      operation: "set_statuses",
      characterId,
      statuses: null,
    });
    if (saved) {
      setStatusEditorCharacterId(null);
      setStatusEditorError("");
    }
  }

  function startAddingLocation() {
    setEditingLocationId("__new__");
    setLocationForm(emptyLocationForm);
    setLocationManagerError("");
  }

  function startEditingLocation(locationId: string) {
    const location = locations.find((candidate) => candidate.id === locationId);
    if (!location) return;
    setEditingLocationId(location.id);
    setLocationForm({
      name: location.name,
      description: location.description,
      defaultCharacterIds: location.defaultCharacterIds.filter((characterId) =>
        manageableCharacters.some(
          (character) => character.id === characterId && character.isActive,
        ),
      ),
    });
    setLocationManagerError("");
  }

  async function runLocationOperation(payload: Record<string, unknown>) {
    if (savingLocation) return false;
    setSavingLocation(true);
    setLocationManagerError("");
    try {
      await sendStoryContentCommand(
        "locations",
        payload,
        "保存地点变化失败。",
      );
      return true;
    } catch (error) {
      setLocationManagerError(
        error instanceof Error ? error.message : "保存地点变化失败。",
      );
      return false;
    } finally {
      setSavingLocation(false);
    }
  }

  async function submitLocationForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation = editingLocationId === "__new__" ? "create" : "update";
    const saved = await runLocationOperation({
      operation,
      ...(operation === "update" ? { locationId: editingLocationId } : {}),
      location: locationForm,
    });
    if (saved) setEditingLocationId(null);
  }

  async function setCurrentLocation(locationId: string) {
    const location = locations.find((candidate) => candidate.id === locationId);
    if (
      !location ||
      !window.confirm(
        `确定把当前位置切换到“${location.name}”吗？\n\n系统会按该地点的默认登场人物自动同步角色的加入和离场，过去剧情不会被改写。`,
      )
    ) {
      return;
    }
    await runLocationOperation({ operation: "set_current", locationId });
  }

  async function setLocationActive(locationId: string, active: boolean) {
    if (
      !active &&
      !window.confirm(
        "确定停用这个地点吗？\n\n地点资料和历史记录会保留，AI 模型后续不会把它作为可进入地点。",
      )
    ) {
      return;
    }
    await runLocationOperation({ operation: "set_active", locationId, active });
  }

  function startAddingStoryModule() {
    setEditingStoryModuleId("__new__");
    setStoryModuleForm(emptyStoryModuleForm);
    setStoryModuleManagerError("");
  }

  function startEditingStoryModule(moduleId: string) {
    const taskModule = storyModules.find((candidate) => candidate.id === moduleId);
    if (
      !taskModule ||
      taskModule.status === "completed" ||
      taskModule.status === "diverged" ||
      taskModule.status === "expired"
    ) {
      return;
    }
    setEditingStoryModuleId(taskModule.id);
    setStoryModuleForm({
      id: taskModule.id,
      title: taskModule.title,
      objective: taskModule.objective,
      completionCriteria: taskModule.completionCriteria.join("\n"),
      activationConditions: taskModule.activationConditions.join("\n"),
      prerequisiteModuleIds: taskModule.prerequisiteModuleIds,
      continuityNotes: taskModule.continuityNotes,
      autoContinue: taskModule.autoContinue,
    });
    setStoryModuleManagerError("");
  }

  async function runStoryModuleOperation(payload: Record<string, unknown>) {
    if (savingStoryModule) return false;
    setSavingStoryModule(true);
    setStoryModuleManagerError("");
    try {
      const content = await sendStoryContentCommand(
        "story_modules",
        payload,
        "保存剧情任务变化失败。",
      );
      if (content.adventure.branchState.branch.id === currentBranchIdRef.current) {
        const nextDirection = content.adventure.branchState.states.find(
          (state) => state.entityType === "story_direction" && state.isActive,
        );
        setDirectionInput(text(nextDirection?.state.content));
      }
      return true;
    } catch (error) {
      setStoryModuleManagerError(
        error instanceof Error ? error.message : "保存剧情任务变化失败。",
      );
      return false;
    } finally {
      setSavingStoryModule(false);
    }
  }

  async function submitStoryModuleForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation = editingStoryModuleId === "__new__" ? "create" : "update";
    const saved = await runStoryModuleOperation({
      operation,
      ...(operation === "update"
        ? { moduleId: editingStoryModuleId }
        : {}),
      module: {
        id: storyModuleForm.id,
        title: storyModuleForm.title,
        objective: storyModuleForm.objective,
        completionCriteria: splitTaskLines(storyModuleForm.completionCriteria),
        activationConditions: splitTaskLines(storyModuleForm.activationConditions),
        prerequisiteModuleIds: storyModuleForm.prerequisiteModuleIds,
        continuityNotes: storyModuleForm.continuityNotes,
        autoContinue: storyModuleForm.autoContinue,
      },
    });
    if (saved) setEditingStoryModuleId(null);
  }

  async function setStoryModuleActive(moduleId: string, active: boolean) {
    if (
      !active &&
      !window.confirm(
        "确定暂停这个剧情任务吗？\n\n暂停后 AI 模型不会自动接续该任务，任务资料和历史记录仍会保留。",
      )
    ) {
      return;
    }
    await runStoryModuleOperation({
      operation: "set_active",
      moduleId,
      active,
    });
  }

  const plotThreads = adventure.branchState.states
    .filter((state) => state.entityType === "plot_thread" && state.isActive)
    .map((state) => ({
      id: text(state.state.threadId, state.entityId),
      keywords: Array.isArray(state.state.keywords)
        ? state.state.keywords
            .filter((item): item is string => typeof item === "string")
            .slice(0, 12)
        : [],
      seedCondition: text(state.state.seedCondition),
      payoffCondition: text(state.state.payoffCondition),
      payoffSummary: text(state.state.payoffSummary),
      characters: Array.isArray(state.state.characters)
        ? state.state.characters.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      status: text(state.state.status, "dormant"),
    }));

  function startAddingForeshadowing() {
    setEditingForeshadowingId("__new__");
    setForeshadowingForm(emptyForeshadowingForm);
    setForeshadowingError("");
  }

  function startEditingForeshadowing(threadId: string) {
    const thread = plotThreads.find((candidate) => candidate.id === threadId);
    if (!thread || thread.status === "paid_off") return;
    setEditingForeshadowingId(thread.id);
    setForeshadowingForm({
      id: thread.id,
      keywords: thread.keywords.join("\n"),
      seedCondition: thread.seedCondition,
      payoffCondition: thread.payoffCondition,
      payoffSummary: thread.payoffSummary,
      characters: thread.characters.join("\n"),
    });
    setForeshadowingError("");
  }

  async function runForeshadowingOperation(payload: Record<string, unknown>) {
    if (savingForeshadowing) return false;
    setSavingForeshadowing(true);
    setForeshadowingError("");
    try {
      await sendStoryContentCommand(
        "foreshadowing",
        payload,
        "保存伏笔变化失败。",
      );
      return true;
    } catch (error) {
      setForeshadowingError(
        error instanceof Error ? error.message : "保存伏笔变化失败。",
      );
      return false;
    } finally {
      setSavingForeshadowing(false);
    }
  }

  async function submitForeshadowingForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation =
      editingForeshadowingId === "__new__" ? "create" : "update";
    const saved = await runForeshadowingOperation({
      operation,
      ...(operation === "update"
        ? { threadId: editingForeshadowingId }
        : {}),
      thread: {
        id: foreshadowingForm.id,
        keywords: splitTaskLines(foreshadowingForm.keywords),
        seedCondition: foreshadowingForm.seedCondition,
        payoffCondition: foreshadowingForm.payoffCondition,
        payoffSummary: foreshadowingForm.payoffSummary,
        characters: splitTaskLines(foreshadowingForm.characters),
      },
    });
    if (saved) setEditingForeshadowingId(null);
  }

  async function deleteForeshadowing(threadId: string) {
    if (
      !window.confirm(
        "确定删除这个伏笔吗？\n\n删除后 AI 模型不再追踪该伏笔；已经回收的伏笔属于剧情历史，不能删除。",
      )
    ) {
      return;
    }
    const removed = await runForeshadowingOperation({
      operation: "delete",
      threadId,
    });
    if (removed) setEditingForeshadowingId(null);
  }

  const plotTriggers = adventure.branchState.states
    .filter((state) => state.entityType === "plot_trigger" && state.isActive)
    .map((state) => {
      const stateEffects =
        state.state.stateEffects !== null &&
        typeof state.state.stateEffects === "object" &&
        !Array.isArray(state.state.stateEffects)
          ? (state.state.stateEffects as Record<string, unknown>)
          : {};
      return {
        id: text(state.state.triggerId, state.entityId),
        when: text(state.state.when),
        consequence: text(state.state.consequence),
        deadlineDay:
          typeof state.state.deadlineDay === "number"
            ? state.state.deadlineDay
            : null,
        status: text(state.state.status, "armed"),
        firedAtTurnId: text(state.state.firedAtTurnId),
        relationsCount: Array.isArray(stateEffects.relations)
          ? stateEffects.relations.length
          : 0,
        attributesCount: Array.isArray(stateEffects.attributes)
          ? stateEffects.attributes.length
          : 0,
        hasBadEnd: Array.isArray(stateEffects.flags)
          ? stateEffects.flags.includes("bad_end")
          : false,
      };
    });

  const visiblePlotThreads = plotThreads.filter(
    (thread) =>
      foreshadowingFilter === "all" || thread.status === foreshadowingFilter,
  );
  const visiblePlotTriggers = plotTriggers.filter(
    (trigger) =>
      triggerFilter === "all" || trigger.status === triggerFilter,
  );

  function startAddingTrigger() {
    setEditingTriggerId("__new__");
    setTriggerForm(emptyTriggerForm);
    setTriggerError("");
  }

  function startEditingTrigger(triggerId: string) {
    const trigger = plotTriggers.find((candidate) => candidate.id === triggerId);
    if (!trigger || trigger.status === "fired") return;
    const rawState = adventure.branchState.states.find(
      (state) =>
        state.entityType === "plot_trigger" &&
        text(state.state.triggerId, state.entityId) === triggerId,
    )?.state;
    const stateEffects =
      rawState &&
      rawState.stateEffects !== null &&
      typeof rawState.stateEffects === "object" &&
      !Array.isArray(rawState.stateEffects)
        ? rawState.stateEffects
        : {};
    const relations = Array.isArray(stateEffects.relations)
      ? stateEffects.relations.map((relation) => {
          const entry =
            relation !== null && typeof relation === "object"
              ? (relation as Record<string, unknown>)
              : {};
          return {
            sourceCharacterName:
              typeof entry.sourceCharacterName === "string"
                ? entry.sourceCharacterName
                : "",
            targetCharacterName:
              typeof entry.targetCharacterName === "string"
                ? entry.targetCharacterName
                : "",
            dimension:
              typeof entry.dimension === "string" ? entry.dimension : "",
            delta:
              typeof entry.delta === "number" ? String(entry.delta) : "",
          };
        })
      : [];
    const flags = Array.isArray(stateEffects.flags)
      ? stateEffects.flags
          .filter((item): item is string => typeof item === "string")
          .join("\n")
      : "";
    const attributes = Array.isArray(stateEffects.attributes)
      ? stateEffects.attributes.map((entry) => {
          const item =
            entry !== null && typeof entry === "object"
              ? (entry as Record<string, unknown>)
              : {};
          return `${typeof item.characterName === "string" ? item.characterName : ""}:${typeof item.attribute === "string" ? item.attribute : ""}:${typeof item.value === "number" ? item.value : ""}`;
        }).join("\n")
      : "";
    setEditingTriggerId(trigger.id);
    setTriggerForm({
      id: trigger.id,
      when: trigger.when,
      consequence: trigger.consequence,
      relations,
      flags,
      attributes,
      deadlineDay: trigger.deadlineDay === null ? "" : String(trigger.deadlineDay),
    });
    setTriggerError("");
  }

  async function runTriggerOperation(payload: Record<string, unknown>) {
    if (savingTrigger) return false;
    setSavingTrigger(true);
    setTriggerError("");
    try {
      await sendStoryContentCommand(
        "triggers",
        payload,
        "保存触发器变化失败。",
      );
      return true;
    } catch (error) {
      setTriggerError(
        error instanceof Error ? error.message : "保存触发器变化失败。",
      );
      return false;
    } finally {
      setSavingTrigger(false);
    }
  }

  async function submitTriggerForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation = editingTriggerId === "__new__" ? "create" : "update";
    const relations = triggerForm.relations
      .map((relation) => ({
        sourceCharacterName: relation.sourceCharacterName.trim(),
        targetCharacterName: relation.targetCharacterName.trim(),
        dimension: relation.dimension.trim(),
        delta: Number(relation.delta),
      }))
      .filter(
        (relation) =>
          relation.sourceCharacterName &&
          relation.targetCharacterName &&
          relation.dimension &&
          Number.isFinite(relation.delta),
      );
    const attributes = splitTaskLines(triggerForm.attributes)
      .map((line) => {
        const [characterName, attribute, rawValue] = line
          .split(":")
          .map((part) => part.trim());
        const value = Number(rawValue);
        return { characterName, attribute, value };
      })
      .filter(
        (entry) =>
          entry.characterName && entry.attribute && Number.isFinite(entry.value),
      );
    const flags = splitTaskLines(triggerForm.flags);
    const deadlineDay = triggerForm.deadlineDay.trim()
      ? Number(triggerForm.deadlineDay)
      : undefined;
    const saved = await runTriggerOperation({
      operation,
      ...(operation === "update" ? { triggerId: editingTriggerId } : {}),
      trigger: {
        id: triggerForm.id,
        when: triggerForm.when,
        consequence: triggerForm.consequence,
        ...(relations.length > 0 || flags.length > 0 || attributes.length > 0
          ? {
              stateEffects: {
                ...(relations.length > 0 ? { relations } : {}),
                ...(flags.length > 0 ? { flags } : {}),
                ...(attributes.length > 0 ? { attributes } : {}),
              },
            }
          : {}),
        ...(Number.isInteger(deadlineDay) && (deadlineDay as number) >= 1
          ? { deadlineDay }
          : {}),
      },
    });
    if (saved) setEditingTriggerId(null);
  }

  async function deleteTrigger(triggerId: string) {
    if (
      !window.confirm(
        "确定删除这个偏离触发器吗？\n\n删除后 AI 模型不再追踪该意外阻碍；已经触发的触发器属于剧情历史，不能删除。",
      )
    ) {
      return;
    }
    const removed = await runTriggerOperation({
      operation: "delete",
      triggerId,
    });
    if (removed) setEditingTriggerId(null);
  }

  function startAddingWorldBookEntry() {
    setEditingWorldBookId("__new__");
    setWorldBookForm(emptyWorldBookForm);
    setWorldBookManagerError("");
  }

  function startEditingWorldBookEntry(entryId: string) {
    const entry = worldBookItems.find((candidate) => candidate.id === entryId);
    if (!entry || !entry.record.isActive) return;
    const state = entry.record.state;
    setEditingWorldBookId(entryId);
    setWorldBookForm({
      comment: text(state.comment),
      keys: strings(state.keys).join("\n"),
      secondaryKeys: strings(state.secondaryKeys).join("\n"),
      content: text(state.content),
      enabled: state.enabled !== false,
      constant: state.constant === true,
      selective: state.selective === true,
      position: state.position === "after_char" ? "after_char" : "before_char",
      order: typeof state.order === "number" ? state.order : 100,
      probability:
        typeof state.probability === "number" ? state.probability : 100,
      depth: typeof state.depth === "number" ? state.depth : 4,
      extensions: JSON.stringify(
        isObject(state.extensions) ? state.extensions : {},
        null,
        2,
      ),
    });
    setWorldBookManagerError("");
  }

  async function runWorldBookOperation(payload: Record<string, unknown>) {
    if (savingWorldBook) return false;
    setSavingWorldBook(true);
    setWorldBookManagerError("");
    try {
      await sendStoryContentCommand(
        "world_book",
        payload,
        "保存世界书变化失败。",
      );
      return true;
    } catch (error) {
      setWorldBookManagerError(
        error instanceof Error ? error.message : "保存世界书变化失败。",
      );
      return false;
    } finally {
      setSavingWorldBook(false);
    }
  }

  async function submitWorldBookForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let extensions: JsonObject;
    try {
      const parsed = JSON.parse(worldBookForm.extensions || "{}");
      if (!isObject(parsed)) throw new Error();
      extensions = parsed;
    } catch {
      setWorldBookManagerError("扩展字段必须是有效的 JSON 对象。");
      return;
    }
    const operation = editingWorldBookId === "__new__" ? "create" : "update";
    const saved = await runWorldBookOperation({
      operation,
      ...(operation === "update" ? { entryId: editingWorldBookId } : {}),
      entry: {
        comment: worldBookForm.comment,
        keys: splitWorldBookKeys(worldBookForm.keys),
        secondaryKeys: splitWorldBookKeys(worldBookForm.secondaryKeys),
        content: worldBookForm.content,
        enabled: worldBookForm.enabled,
        constant: worldBookForm.constant,
        selective: worldBookForm.selective,
        position: worldBookForm.position,
        order: worldBookForm.order,
        probability: worldBookForm.probability,
        depth: worldBookForm.depth,
        extensions,
      },
    });
    if (saved) setEditingWorldBookId(null);
  }

  async function setWorldBookEnabled(entryId: string, enabled: boolean) {
    await runWorldBookOperation({ operation: "set_enabled", entryId, enabled });
  }

  async function removeWorldBookEntry(entryId: string, title: string) {
    if (
      !window.confirm(
        `确定移除世界书条目“${title}”吗？\n\n该操作采用软删除，历史与基础资料会保留，之后仍可恢复或重新启用。`,
      )
    ) {
      return;
    }
    await runWorldBookOperation({ operation: "remove", entryId });
  }

  async function restoreWorldBookBase(entryId: string, title: string) {
    if (
      !window.confirm(
        `确定撤销“${title}”的玩家修订并恢复基础版本吗？`,
      )
    ) {
      return;
    }
    const saved = await runWorldBookOperation({
      operation: "restore_base",
      entryId,
    });
    if (saved && editingWorldBookId === entryId) setEditingWorldBookId(null);
  }

  async function openStateAudit() {
    setStateAuditOpen(true);
    setStateAuditError("");
    setReasonPrompt(null);
    setStateAuditBusy("loading");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/content`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as StoryContentResponse;
      if (!response.ok || !body.audit || !body.content) {
        throw new Error(
          body.error?.issues?.[0] ??
            body.error?.message ??
            "读取修改记录失败。",
        );
      }
      setStateAudit(body.audit.state);
      setContentAssetChanges(body.audit.assets);
      setAdventure(body.content.adventure);
      setSourceDocuments(body.content.sourceDocuments);
      setMemory(body.content.memory);
    } catch (error) {
      setStateAuditError(
        error instanceof Error ? error.message : "读取修改记录失败。",
      );
    } finally {
      setStateAuditBusy("");
    }
  }

  async function openTurnContext(turnId: string) {
    setTurnContextOpen(true);
    setTurnContext(null);
    setTurnContextError("");
    setTurnContextLoading(true);
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/turns/${turnId}/context`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as TurnContextResponse;
      if (!response.ok || !body.snapshot) {
        throw new Error(body.error ?? "读取本轮 AI 上下文失败。");
      }
      setTurnContext(body.snapshot);
    } catch (error) {
      setTurnContextError(
        error instanceof Error ? error.message : "读取本轮 AI 上下文失败。",
      );
    } finally {
      setTurnContextLoading(false);
    }
  }

  async function runStateAuditOperation(
    payload: Record<string, unknown>,
    busyKey: string,
  ) {
    if (stateAuditBusy) return false;
    const signature = JSON.stringify(payload);
    if (pendingStateAuditAction.current?.signature !== signature) {
      pendingStateAuditAction.current = {
        signature,
        actionId: crypto.randomUUID(),
      };
    }
    setStateAuditBusy(busyKey);
    setStateAuditError("");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/state-audit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            actionId: pendingStateAuditAction.current.actionId,
          }),
        },
      );
      const body = (await response.json()) as StateAuditResponse;
      if (!response.ok || !body.audit || !body.adventure) {
        throw new Error(
          body.issues?.[0] ?? body.error ?? "保存状态审计操作失败。",
        );
      }
      if (body.adventure.branchState.branch.id !== currentBranchIdRef.current) {
        // 审计操作期间切换了分支：操作已应用到原分支，这里丢弃旧分支响应，
        // 保持当前分支界面不变。
        pendingStateAuditAction.current = null;
        return true;
      }
      setStateAudit(body.audit);
      setAdventure(body.adventure);
      const nextDirection = body.adventure.branchState.states.find(
        (state) => state.entityType === "story_direction" && state.isActive,
      );
      setDirectionInput(text(nextDirection?.state.content));
      if (!isViewingHistory) {
        setViewedTurn(body.adventure.branchState.recentTurns.at(-1) ?? null);
      }
      pendingStateAuditAction.current = null;
      return true;
    } catch (error) {
      setStateAuditError(
        error instanceof Error ? error.message : "保存状态审计操作失败。",
      );
      return false;
    } finally {
      setStateAuditBusy("");
    }
  }

  function openAuditReasonPrompt(state: ReasonPromptState) {
    if (stateAuditBusy) return;
    setStateAuditError("");
    setReasonPrompt(state);
    setReasonPromptValue(
      state.kind === "set_lock"
        ? state.locked
          ? "保留玩家确认的重要设定"
          : "允许后续剧情继续更新该字段"
        : "玩家不希望保留这项状态变化",
    );
  }

  async function submitAuditReasonPrompt() {
    const prompt = reasonPrompt;
    if (!prompt || stateAuditBusy) return;
    const reason = reasonPromptValue.trim();
    if (!reason) return;
    if (prompt.kind === "rollback_change") {
      if (
        !window.confirm(
          "确定撤销这项状态变化吗？\n\n该实体会恢复到变化发生前的完整状态，因此它在更晚回合产生的状态修改也可能被覆盖；所有剧情对话仍会保留。",
        )
      ) {
        return;
      }
      setReasonPrompt(null);
      await runStateAuditOperation(
        { operation: "rollback", changeId: prompt.changeId, reason },
        `rollback:${prompt.changeId}`,
      );
    } else if (prompt.kind === "rollback_asset") {
      const change = prompt.change;
      if (
        !window.confirm(
          `确定撤销“${contentAssetOperationLabels[change.operation] ?? "资料修改"} · ${contentAssetTarget(change)}”吗？`,
        )
      ) {
        return;
      }
      setReasonPrompt(null);
      setStateAuditBusy(`asset:${change.id}`);
      setStateAuditError("");
      try {
        await sendStoryContentCommand(
          change.domain,
          { operation: "rollback", changeId: change.id, reason },
          "撤销资料修改失败。",
        );
        await openStateAudit();
      } catch (error) {
        setStateAuditError(
          error instanceof Error ? error.message : "撤销资料修改失败。",
        );
      } finally {
        setStateAuditBusy("");
      }
    } else {
      const { entityType, entityId, fieldPath, locked } = prompt;
      setReasonPrompt(null);
      await runStateAuditOperation(
        {
          operation: "set_lock",
          entityType,
          entityId,
          fieldPath,
          locked,
          reason,
        },
        `lock:${entityType}:${entityId}:${fieldPath}`,
      );
    }
  }

  function requestRollbackAuditChange(change: StateAuditChange) {
    if (!change.canRollback) return;
    openAuditReasonPrompt({ kind: "rollback_change", changeId: change.id });
  }

  function requestRollbackContentAsset(change: ContentAssetManagementChange) {
    if (!change.canRollback || stateAuditBusy) return;
    openAuditReasonPrompt({ kind: "rollback_asset", change });
  }

  function requestAuditFieldLock(input: {
    entityType: StateAuditChange["entityType"];
    entityId: string;
    fieldPath: string;
    locked: boolean;
  }) {
    if (stateAuditBusy) return;
    openAuditReasonPrompt({ kind: "set_lock", ...input });
  }

  async function importSourceFile(file: File | undefined) {
    if (!file || importingSource || savingSourceId) return;
    setSourceManagerError("");
    if (!/\.(txt|md)$/i.test(file.name)) {
      setSourceManagerError("原文参考目前只支持 .txt 和 .md 文件。");
      return;
    }
    if (file.size > 6_000_000) {
      setSourceManagerError("原文文件过大，请使用不超过 200 万字符的文本。");
      return;
    }
    setImportingSource(true);
    try {
      const content = await file.text();
      await sendStoryContentCommand(
        "sources",
        {
          operation: "import",
          document: {
            name: file.name.replace(/\.(txt|md)$/i, ""),
            fileName: file.name,
            content,
            enabled: true,
            currentChapter: 1,
            preventFuture: true,
            fidelity: "balanced",
          },
        },
        "导入原文参考失败。",
      );
    } catch (error) {
      setSourceManagerError(
        error instanceof Error ? error.message : "导入原文参考失败。",
      );
    } finally {
      setImportingSource(false);
    }
  }

  async function updateSourceSettings(
    documentId: string,
    patch: Record<string, unknown>,
  ) {
    if (savingSourceId || importingSource) return;
    setSavingSourceId(documentId);
    setSourceManagerError("");
    try {
      await sendStoryContentCommand(
        "sources",
        {
          operation: "update",
          documentId,
          settings: patch,
        },
        "保存原文参考设置失败。",
      );
    } catch (error) {
      setSourceManagerError(
        error instanceof Error ? error.message : "保存原文参考设置失败。",
      );
    } finally {
      setSavingSourceId("");
    }
  }

  async function deleteSourceDocument(document: SourceDocumentSummary) {
    if (
      savingSourceId ||
      importingSource ||
      !window.confirm(
        `确定移除原文参考《${document.name}》吗？\n\n正文和切片会留在本机；在尚未继续剧情且没有后续修改时，可从“修改记录”撤销。`,
      )
    ) {
      return;
    }
    setSavingSourceId(document.id);
    setSourceManagerError("");
    try {
      await sendStoryContentCommand(
        "sources",
        { operation: "remove", documentId: document.id },
        "删除原文参考失败。",
      );
    } catch (error) {
      setSourceManagerError(
        error instanceof Error ? error.message : "删除原文参考失败。",
      );
    } finally {
      setSavingSourceId("");
    }
  }

  async function openMemoryManager() {
    setMemoryManagerOpen(true);
    setMemoryManagerError("");
    setMemoryBusy("load");
    try {
      const response = await fetch(
        `/api/adventures/${adventure.session.id}/content?audit=false`,
      );
      const body = (await response.json()) as StoryContentResponse;
      if (!response.ok || !body.content) {
        throw new Error(
          body.error?.issues?.[0] ??
            body.error?.message ??
            "读取剧情记忆失败。",
        );
      }
      setAdventure(body.content.adventure);
      setSourceDocuments(body.content.sourceDocuments);
      setMemory(body.content.memory);
    } catch (error) {
      setMemoryManagerError(
        error instanceof Error ? error.message : "读取剧情记忆失败。",
      );
    } finally {
      setMemoryBusy("");
    }
  }

  async function patchMemory(payload: Record<string, unknown>, busyId: string) {
    setMemoryBusy(busyId);
    setMemoryManagerError("");
    try {
      await sendStoryContentCommand(
        "memories",
        payload,
        "修改剧情记忆失败。",
      );
    } catch (error) {
      setMemoryManagerError(
        error instanceof Error ? error.message : "修改剧情记忆失败。",
      );
    } finally {
      setMemoryBusy("");
    }
  }

  async function saveMemoryEntry(
    event: FormEvent<HTMLFormElement>,
    entryId: string,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await patchMemory(
      {
        operation: "update_entry",
        entryId,
        patch: {
          title: String(data.get("title") ?? ""),
          content: String(data.get("content") ?? ""),
          importance: Number(data.get("importance")),
        },
      },
      entryId,
    );
  }

  async function saveMemorySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await patchMemory(
      {
        operation: "update_settings",
        settings: {
          memoryTokenBudget: Number(data.get("memoryTokenBudget")),
          recentTurnCount: Number(data.get("recentTurnCount")),
          chapterSize: Number(data.get("chapterSize")),
        },
      },
      "settings",
    );
  }

  async function rebuildMemory() {
    if (
      memoryBusy ||
      !window.confirm("根据当前分支的全部已保存回合重新提取自动记忆吗？手工修正的记忆会保留。")
    ) {
      return;
    }
    setMemoryBusy("rebuild");
    setMemoryManagerError("");
    try {
      await sendStoryContentCommand(
        "memories",
        { operation: "rebuild" },
        "重建剧情记忆失败。",
      );
    } catch (error) {
      setMemoryManagerError(
        error instanceof Error ? error.message : "重建剧情记忆失败。",
      );
    } finally {
      setMemoryBusy("");
    }
  }

  function selectStoryWorkbenchTab(tab: StoryWorkbenchTab) {
    if (tab !== "state_audit") {
      setReasonPrompt(null);
    }
    if (tab === "memories") {
      void openMemoryManager();
      return;
    }
    if (tab === "state_audit") {
      void openStateAudit();
      return;
    }
    setStoryWorkbenchTab(tab);
  }

  return (
    <main className="game-page">
      <header className="game-header">
        <div className="game-header-left">
          <Link className="back-link" href="/">
            <span aria-hidden="true">←</span>
            主菜单
          </Link>
          {apiProfiles.length > 1 ? (
            <label className="game-api-switcher">
              <span>生成模型</span>
              <select
                value={apiActiveId ?? ""}
                disabled={apiSwitching}
                onChange={(event) => {
                  if (event.target.value) {
                    void switchApiProfile(event.target.value);
                  }
                }}
              >
                {apiProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} · {profile.model}
                  </option>
                ))}
              </select>
              {apiSwitchError ? <em role="alert">{apiSwitchError}</em> : null}
            </label>
          ) : null}
        </div>
        <div className="game-title">
          <span>
            {text(sessionState?.worldName, "本地世界")} · 游戏内第 {gameTimeDay} 日
            {currentDayPhase ? ` · ${currentDayPhase}` : ""}
          </span>
          <h1>{adventure.campaign.name}</h1>
        </div>
        <div className="header-branch-actions">
          <button
            type="button"
            onClick={() => selectStoryWorkbenchTab("characters")}
          >
            人物
            <span>角色卡与关系</span>
          </button>
          <button
            type="button"
            onClick={() => selectStoryWorkbenchTab("locations")}
          >
            地点
            <span>地图与人物位置</span>
          </button>
          <button
            className="story-workbench-launch"
            type="button"
            onClick={() => selectStoryWorkbenchTab("story_modules")}
          >
            编辑剧本
            <span>任务、世界书、原文与记忆</span>
          </button>
          <button
            type="button"
            onClick={() => openBranchManagerForTurn()}
          >
            {currentBranch?.name ?? adventure.branchState.branch.name}
            <span>分支与存档</span>
          </button>
          <div className="save-status">
            <span aria-hidden="true" />
            {isViewingHistory
              ? `正在回看第 ${displayedTurn?.sequence} 回合`
              : latestTurn && latestTurn.sequence > 1
                ? "回合已保存"
                : "开局已保存"}
          </div>
        </div>
      </header>

      <div className="game-layout">
        {sessionState?.badEnd === true ? (
          <div className="bad-end-banner" role="alert">
            <div className="bad-end-banner-copy">
              <strong>结局警示</strong>
              <span>
                {firedBadEndTriggers.length > 0
                  ? firedBadEndTriggers[0].consequence
                  : "局势正在滑向坏结局方向，接下来的选择将决定最后的结果。"}
              </span>
            </div>
            <div className="bad-end-actions">
              <button
                type="button"
                disabled={Boolean(branchBusyAction)}
                onClick={() => openBranchManagerForTurn()}
              >
                打开分支与存档
              </button>
              {recoveryPoints.slice(0, 3).map((point) => (
                <button
                  type="button"
                  key={point.id}
                  disabled={Boolean(branchBusyAction)}
                  onClick={() => void restoreToSavePoint(point)}
                >
                  {branchBusyAction === `restore:${point.id}`
                    ? "恢复中……"
                    : `回到结局前 · ${point.name}（回合 ${point.sequence}）`}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <section className="story-stage" aria-labelledby="scene-title">
          <div className="scene-meta">
            <div className="scene-meta-copy">
              <span>{isViewingHistory ? "历史回看 · 只读" : "第一幕"}</span>
              <span>回合 {displayedTurn?.sequence ?? 1}</span>
              {(() => {
                const turnDay = turnGameTimeDay(displayedTurn);
                const turnPhase = turnDayPhase(displayedTurn);
                return turnDay !== undefined ? (
                  <span>
                    游戏内第 {turnDay} 日{turnPhase ? ` · ${turnPhase}` : ""}
                  </span>
                ) : null;
              })()}
            </div>
            {!isViewingHistory &&
            latestTurn?.generation &&
            latestTurn.branchId === adventure.branchState.branch.id ? (
              <button
                type="button"
                disabled={submitting || regenerating}
                aria-controls="regeneration-feedback-panel"
                aria-expanded={regenerationPanelOpen}
                onClick={() => {
                  setRegenerationPanelOpen(true);
                  setRegenerationError("");
                }}
              >
                {regenerating ? "正在重新生成……" : "不满意，重新生成"}
              </button>
            ) : null}
          </div>
          {!isViewingHistory &&
          latestTurn?.generation &&
          latestTurn.branchId === adventure.branchState.branch.id &&
          regenerationPanelOpen ? (
            <form
              className="regeneration-panel"
              id="regeneration-feedback-panel"
              onSubmit={(event) => {
                event.preventDefault();
                void regenerateLatestTurn();
              }}
            >
              <div className="regeneration-mode" role="radiogroup" aria-label="重写模式">
                <label>
                  <input
                    type="radio"
                    name="regeneration-mode"
                    checked={regenerationMode === "standard"}
                    disabled={regenerating}
                    onChange={() => {
                      setRegenerationMode("standard");
                      setRegenerationError("");
                    }}
                  />
                  标准重写
                </label>
                <label>
                  <input
                    type="radio"
                    name="regeneration-mode"
                    checked={regenerationMode === "time_fix"}
                    disabled={regenerating}
                    onChange={() => {
                      setRegenerationMode("time_fix");
                      setRegenerationError("");
                    }}
                  />
                  日期修正
                </label>
              </div>
              {regenerationMode === "time_fix" ? (
                <p className="regeneration-mode-hint">
                  正文暗示时间流逝（次日、数日后等）但游戏内日期未推进时使用：系统会专门引导重写修正日期推进，修改意见可留空。
                </p>
              ) : null}
              <label htmlFor="regeneration-feedback">
                <strong>
                  {regenerationMode === "time_fix"
                    ? "补充修改意见（可选）"
                    : "希望 AI 怎样修改？"}
                </strong>
                <span>
                  {regenerationMode === "time_fix"
                    ? "可补充细节，留空则仅修正日期推进。"
                    : "可具体调整本轮中 AI 控制角色的动作、台词、反应、情节结果、叙述风格或候选选项。"}
                </span>
              </label>
              <textarea
                id="regeneration-feedback"
                value={regenerationFeedback}
                maxLength={1_000}
                rows={4}
                disabled={regenerating}
                autoFocus
                placeholder={
                  regenerationMode === "time_fix"
                    ? "可留空；例如：修正为次日清晨继续调查。"
                    : "例如：不要让馆长立刻离开。改成她关上门、留下继续盘问玩家，并让旁观者保持沉默。"
                }
                onChange={(event) => {
                  setRegenerationFeedback(event.target.value);
                  setRegenerationError("");
                }}
              />
              {regenerationError ? (
                <div className="regeneration-error" role="alert">
                  <strong>最新剧情没有被替换</strong>
                  <span>{regenerationError}</span>
                </div>
              ) : null}
              <footer>
                <small>{regenerationFeedback.length} / 1000</small>
                <div>
                  <button
                    type="button"
                    disabled={regenerating}
                    onClick={() => {
                      setRegenerationPanelOpen(false);
                      setRegenerationFeedback("");
                      setRegenerationMode("standard");
                      setRegenerationError("");
                      pendingRegenerationAction.current = null;
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={
                      submitting ||
                      regenerating ||
                      (regenerationMode === "standard" &&
                        !regenerationFeedback.trim())
                    }
                  >
                    {regenerating
                      ? "正在按意见重写……"
                      : regenerationMode === "time_fix"
                        ? "按日期修正重写"
                        : "按此意见重新生成"}
                  </button>
                </div>
              </footer>
              <p>
                将再次调用当前 AI 模型。最新回合中的 AI 角色行为可以改写，但原玩家输入和更早剧情保持不变；新结果校验成功后才会替换当前回合，旧结果仍保存在本地记录中。
              </p>
            </form>
          ) : null}
          <article className="scene-card">
            <p className="eyebrow">
              {isViewingHistory
                ? "历史剧情"
                : displayedTurn && displayedTurn.sequence > 1
                  ? "本轮剧情"
                  : "开场场景"}
            </p>
            <h2 id="scene-title">
              {displayedTurn && displayedTurn.sequence > 1
                ? `第 ${displayedTurn.sequence} 回合`
                : "故事从这里开始"}
            </h2>
            <p className="scene-text">
              {text(turn.scene, text(sessionState?.currentScene, "开场尚未写入。"))}
            </p>
            {dialogue.map((line, index) => (
              <blockquote className="dialogue" key={`${text(line.speakerId)}-${index}`}>
                <span>
                  {text(
                    line.speakerName,
                    characterNameById.get(text(line.speakerId)) ?? "角色",
                  )}
                </span>
                <p>{text(line.content)}</p>
              </blockquote>
            ))}
          </article>

          {sourceReferences.length > 0 || scriptGuidanceReferences.length > 0 ? (
            <details className="source-reference-trace">
              <summary>
                <span>
                  <small>原文参考</small>
                  <strong>
                    本轮使用了 {sourceReferences.length} 个可见片段
                    {scriptGuidanceReferences.length > 0
                      ? ` · ${scriptGuidanceReferences.length} ${
                          scriptGuidanceScope === "next_chapter_progress_hint"
                            ? "条剧本推进引导"
                            : "个防剧透导演锚点"
                        }`
                      : ""}
                  </strong>
                </span>
                <i aria-hidden="true">⌄</i>
              </summary>
              <div className="source-reference-trace-list">
                {sourceReferences.map((reference, index) => {
                  const matchedCharacters = strings(
                    reference.matchedCharacterNames,
                  );
                  return (
                    <article key={`${text(reference.chunkId)}-${index}`}>
                      <header>
                        <div>
                          <strong>{text(reference.documentName, "原文资料")}</strong>
                          <span>
                            {text(reference.chapterTitle, `第 ${reference.chapterIndex ?? 1} 章`)}
                          </span>
                        </div>
                        <small>
                          {text(reference.fidelity) === "faithful"
                            ? "高度贴合"
                            : "平衡参考"}
                        </small>
                      </header>
                      <p>{text(reference.excerpt)}</p>
                      {matchedCharacters.length > 0 ? (
                        <footer>
                          关联人物：{matchedCharacters.join("、")}
                        </footer>
                      ) : null}
                    </article>
                  );
                })}
                {scriptGuidanceReferences.length > 0 ? (
                  <article>
                    <header>
                      <div>
                        <strong>
                          {scriptGuidanceScope === "next_chapter_progress_hint"
                            ? "剧本推进引导"
                            : "下一章节剧本约束"}
                        </strong>
                        <span>
                          {scriptGuidanceScope === "next_chapter_progress_hint"
                            ? "大纲方向提示"
                            : "高度贴合模式"}
                        </span>
                      </div>
                      <small>内容隐藏以防剧透</small>
                    </header>
                    <p>
                      {scriptGuidanceScope === "next_chapter_progress_hint"
                        ? "这些片段只提示剧情应沿大纲推进的下一段方向，不能作为已发生的剧情或角色已知情报。"
                        : "这些片段只约束角色提出的重大方案、关键机制与必要参与者，不能被当作已经发生的剧情。"}
                    </p>
                  </article>
                ) : null}
              </div>
            </details>
          ) : null}

          {displayedTurn ? (
            <details
              className="turn-changes"
              open={displayedTurn.sequence > 1}
              key={displayedTurn.id}
            >
              <summary>
                <span className="change-summary-copy">
                  <small>本轮变化</small>
                  <strong>
                    {displayedStateChanges.length > 0 ||
                    displayedBlockedStateChanges.length > 0
                      ? `${displayedStateChanges.length} 项已同步${
                          displayedBlockedStateChanges.length > 0
                            ? ` · ${displayedBlockedStateChanges.length} 项被锁定拦截`
                            : ""
                        }`
                      : "本轮没有持久状态变化"}
                  </strong>
                </span>
                <span className="change-summary-meta">
                  {generation?.totalTokens !== undefined
                    ? `${tokenCount(generation.totalTokens)} token`
                    : displayedTurn.sequence === 1
                      ? "开局建档"
                      : "用量未返回"}
                  <i aria-hidden="true">⌄</i>
                </span>
              </summary>

              <div className="turn-changes-body">
                <div className="generation-usage">
                  <div>
                    <small>生成模型</small>
                    <strong>{generation?.model ?? "开局向导"}</strong>
                  </div>
                  <div>
                    <small>输入 token</small>
                    <strong>{tokenCount(generation?.promptTokens)}</strong>
                  </div>
                  <div>
                    <small>输出 token</small>
                    <strong>{tokenCount(generation?.completionTokens)}</strong>
                  </div>
                  <div>
                    <small>本轮合计</small>
                    <strong>{tokenCount(generation?.totalTokens)}</strong>
                  </div>
                </div>

                {displayedTurn.generation ? (
                  <div className="context-inspector-entry">
                    <div>
                      <strong>AI 本轮看到了什么？</strong>
                      <span>
                        查看实际发送的角色卡、状态、剧情记忆、原文片段和预算裁剪诊断。
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openTurnContext(displayedTurn.id)}
                    >
                      查看实际上下文
                    </button>
                  </div>
                ) : null}

                {turnWarnings.length > 0 ? (
                  <ul className="turn-warning-list">
                    {turnWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}

                {displayedStateChanges.length > 0 ? (
                  <div className="change-list">
                    {displayedStateChanges.map((change) => (
                      <article
                        className={`change-item change-${change.entityType.replaceAll("_", "-")}`}
                        key={change.id}
                      >
                        <div className="change-item-heading">
                          <span>{stateLabels[change.entityType]}</span>
                          <small>{operationLabels[change.operation]}</small>
                        </div>
                        <strong>
                          {stateChangeTarget(change, characterNameById)}
                        </strong>
                        {stateChangeDetail(change) ? (
                          <p>{stateChangeDetail(change)}</p>
                        ) : null}
                        <footer>
                          <span>{change.reason}</span>
                          <small>
                            {change.evidence.length} 项剧情证据
                          </small>
                        </footer>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="empty-change-note">
                    本轮只推进了叙事，没有写入角色、关系、世界书或剧情走向变化。
                  </p>
                )}
                {displayedBlockedStateChanges.length > 0 ? (
                  <div className="blocked-change-list">
                    {displayedBlockedStateChanges.map((change) => (
                      <article key={change.id}>
                        <span>已由字段锁阻止</span>
                        <strong>
                          {stateLabels[change.entityType]} · {change.fieldPaths
                            .map(auditFieldLabel)
                            .join("、")}
                        </strong>
                        <p>{change.reason}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          {isViewingHistory ? (
            <section className="history-return-card" aria-labelledby="history-title">
              <div>
                <p className="eyebrow">历史回看 · 只读</p>
                <h2 id="history-title">
                  这是第 {displayedTurn?.sequence} 回合的已保存内容
                </h2>
                <p>
                  历史回合不会再次提交，也不会改变当前人物状态和剧情分支。返回最新回合后可以继续游戏。
                </p>
                {historicalInputParts.length > 0 ? (
                  <div className="historical-player-input">
                    <small>当时的玩家输入</small>
                    {historicalInputParts.map((part) => (
                      <span key={part}>{part}</span>
                    ))}
                  </div>
                ) : null}
                {choices.length > 0 ? (
                  <div className="historical-choice-preview">
                    <small>当时生成的下一步</small>
                    <strong>{text(decision.prompt, "你准备怎么做？")}</strong>
                    <div>
                      {choices.map((choice) => (
                        <span key={text(choice.id)}>
                          {stanceLabel(text(choice.stance))} · {text(choice.label)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="history-actions">
                <button
                  type="button"
                  onClick={() =>
                    openBranchManagerForTurn(
                      displayedTurn?.id,
                      displayedTurn?.sequence,
                    )
                  }
                >
                  从这里创建分支
                  <span aria-hidden="true">＋</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewedTurn(latestTurn ?? null);
                    setHistoryError("");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  返回最新剧情
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </section>
          ) : (
            <>
              <section
                className="decision-card"
                aria-labelledby="decision-title"
              >
                <div className="decision-heading">
                  <div>
                    <p className="eyebrow">玩家回应</p>
                    <h2 id="decision-title">
                      {text(decision.prompt, "你准备怎么做？")}
                    </h2>
                  </div>
                  <span className="decision-context">
                    {text(decision.context) === "proposal_response"
                      ? "回应提议"
                      : "行动方向"}
                  </span>
                </div>
                <div className="choice-list">
                  {choices.map((choice) => {
                    const choiceId = text(choice.id);
                    const active = selectedChoice === choiceId;
                    return (
                      <button
                        className={`choice-card ${active ? "selected" : ""}`}
                        type="button"
                        key={choiceId}
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedChoice(choiceId);
                          setCustomChoice("");
                        }}
                      >
                        <span
                          className={`stance stance-${text(choice.stance)}`}
                        >
                          {stanceLabel(text(choice.stance))}
                        </span>
                        <strong>{text(choice.label)}</strong>
                        <small>{text(choice.description)}</small>
                      </button>
                    );
                  })}
                </div>

                <div className="input-stack">
                  <label className="game-input custom-choice-input">
                    <span>
                      <b>自定义选项</b>
                      <small>替代上方候选项，表达本轮决定</small>
                    </span>
                    <input
                      value={customChoice}
                      onChange={(event) => {
                        setCustomChoice(event.target.value);
                        if (event.target.value) setSelectedChoice("");
                      }}
                      placeholder="我选择用自己的方式回应……"
                    />
                  </label>

                  <label className="game-input roleplay-input">
                    <span>
                      <b>角色言行</b>
                      <small>故事内可被其他角色观察到的内容</small>
                    </span>
                    <div className="roleplay-control">
                      <select
                        aria-label="角色言行类型"
                        value={roleplayMode}
                        onChange={(event) =>
                          setRoleplayMode(event.target.value)
                        }
                      >
                        <option value="speech">说话</option>
                        <option value="action">动作</option>
                        <option value="mixed">说话与动作</option>
                      </select>
                      <textarea
                        rows={4}
                        value={roleplayInput}
                        onChange={(event) =>
                          setRoleplayInput(event.target.value)
                        }
                        placeholder="写下角色说的话或正在做的动作……"
                      />
                    </div>
                  </label>
                </div>

                {submitError ? (
                  <div className="turn-error" role="alert">
                    <strong>本轮没有保存</strong>
                    <span>{submitError}</span>
                  </div>
                ) : null}

                {failoverNotice ? (
                  <p className="failover-notice" role="status">
                    {failoverNotice}
                  </p>
                ) : null}

                {pendingChecks && pendingChecks.length > 0 ? (
                  <div
                    className="character-manager-backdrop"
                    role="presentation"
                    onMouseDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        !checkSubmitting
                      ) {
                        setPendingChecks(null);
                        pendingIdempotencyKey.current = null;
                      }
                    }}
                  >
                    <section
                      className="character-manager dice-panel"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="dice-panel-title"
                    >
                      <header>
                        <div>
                          <p className="eyebrow">属性判定 · 掷骰结算</p>
                          <h2 id="dice-panel-title">本轮需要一次关键判定</h2>
                        </div>
                        <button
                          className="character-manager-close"
                          type="button"
                          disabled={checkSubmitting}
                          onClick={() => {
                            setPendingChecks(null);
                            pendingIdempotencyKey.current = null;
                          }}
                        >
                          ×
                        </button>
                      </header>
                      {checkError ? (
                        <div
                          className="character-manager-error"
                          role="alert"
                        >
                          {checkError}
                        </div>
                      ) : null}
                      <p className="dice-panel-hint">
                        模型只提议了“何时判定、用什么属性、难度多少”；结果由你掷骰后系统确定性结算，
                        并作为已发生事实回填本回合。|属性−难度|≥30 时实力悬殊、无需掷骰。
                      </p>
                      <ul className="dice-check-list">
                        {pendingChecks.map((check) => {
                          const roll = checkRolls[check.checkId] ?? null;
                          const preview = previewCheckOutcome(check, roll);
                          return (
                            <li key={check.checkId} className="dice-check-item">
                              <header>
                                <strong>
                                  {check.characterName} · {check.attribute}{" "}
                                  {check.attributeValue}
                                </strong>
                                <span>难度 {check.difficulty}</span>
                              </header>
                              <p>{check.context}</p>
                              <footer>
                                {check.direct ? (
                                  <span className="dice-verdict dice-direct">
                                    {check.margin > 0
                                      ? "实力悬殊 → 直接成功"
                                      : "实力悬殊 → 直接失败"}
                                  </span>
                                ) : (
                                  <>
                                    {roll === null ? (
                                      <span className="dice-verdict">
                                        尚未掷骰
                                      </span>
                                    ) : (
                                      <>
                                        <span className="dice-roll">
                                          掷出 {roll}
                                        </span>
                                        <span className="dice-verdict">
                                          {preview}
                                        </span>
                                      </>
                                    )}
                                  </>
                                )}
                                {!check.direct ? (
                                  <button
                                    type="button"
                                    className="dice-roll-button"
                                    disabled={checkSubmitting}
                                    onClick={() => rollCheck(check.checkId)}
                                  >
                                    {roll === null ? "掷骰" : "重掷"}
                                  </button>
                                ) : null}
                              </footer>
                            </li>
                          );
                        })}
                      </ul>
                      <footer className="dice-panel-actions">
                        <button
                          type="button"
                          className="dice-skip-button"
                          disabled={checkSubmitting}
                          onClick={() => skipPendingChecks()}
                        >
                          跳过本轮判定
                        </button>
                        <button
                          type="button"
                          className="dice-confirm-button"
                          disabled={checkSubmitting}
                          onClick={() => void resolvePendingChecks()}
                        >
                          {checkSubmitting ? "正在结算……" : "确认判定"}
                        </button>
                      </footer>
                    </section>
                  </div>
                ) : null}

                {submitting ? (
                  <div className="streaming-progress" aria-live="polite">
                    <header>
                      <strong>AI 正在续写……</strong>
                      <span>
                        {streamingChars > 0
                          ? `已生成 ${streamingChars} 字`
                          : "正在连接模型"}
                      </span>
                    </header>
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(
                        95 * (1 - Math.exp(-streamingChars / 400)),
                      )}
                    >
                      <div
                        className={
                          streamingChars > 0 ? "progress-fill" : "progress-fill awaiting"
                        }
                        style={{
                          width: `${Math.round(
                            95 * (1 - Math.exp(-streamingChars / 400)),
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="turn-footer">
                  <p>
                    当前 AI 模型会结合世界书、角色卡、当前状态和三种玩家输入生成下一轮；校验通过后才会整体保存。
                  </p>
                  <button
                    className={submitting ? "generating" : ""}
                    type="button"
                    disabled={!canSubmit || submitting || regenerating}
                    onClick={() => void submitTurn()}
                  >
                    {submitting ? "AI 正在续写……" : "生成下一回合"}
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </section>

              <section
                className="story-direction-card"
                aria-labelledby="story-direction-title"
              >
                <header>
                  <div>
                    <p className="eyebrow">导演输入 · 可选</p>
                    <h2 id="story-direction-title">剧情走向</h2>
                  </div>
                  <span>NPC 不可见</span>
                </header>
                <p>
                  只在希望调整后续长期发展时修改；留空或保持原值不会干扰当前玩家回应。
                </p>
                <label className="game-input direction-input">
                  <span>
                    <b>后续发展意图</b>
                    <small>故事外的导演目标，不是玩家角色说出口的话</small>
                  </span>
                  <textarea
                    rows={3}
                    value={directionInput}
                    onChange={(event) => setDirectionInput(event.target.value)}
                    placeholder="希望后续剧情如何发展……"
                  />
                </label>
              </section>
            </>
          )}
        </section>

        <aside
          className="state-rail"
          aria-label="当前剧情状态，可独立滚动"
          tabIndex={0}
        >
          <section className="state-panel branch-state-panel">
            <div className="state-heading character-state-heading">
              <div>
                <span>剧情路线</span>
                <h2>{currentBranch?.name ?? adventure.branchState.branch.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => openBranchManagerForTurn()}
              >
                管理分支
              </button>
            </div>
            <p>
              {branches.length} 条分支 · {recoveryPoints.length} 个可恢复存档
            </p>
          </section>

          <section className="state-panel history-panel">
            <div className="state-heading history-heading">
              <div>
                <span>回合记录</span>
                <h2>回看剧情</h2>
              </div>
              <small>{adventure.branchState.turnHistory.length} 回合</small>
            </div>
            <div className="turn-history-list">
              {adventure.branchState.turnHistory.map((historyTurn) => {
                const active = displayedTurn?.id === historyTurn.id;
                const loading = loadingHistoryTurnId === historyTurn.id;
                return (
                  <button
                    className={active ? "active" : ""}
                    type="button"
                    aria-current={active ? "step" : undefined}
                    disabled={Boolean(loadingHistoryTurnId)}
                    key={historyTurn.id}
                    onClick={() => void viewHistoryTurn(historyTurn.id)}
                  >
                    <span>回合 {historyTurn.sequence}</span>
                    <strong>
                      {loading
                        ? "正在读取……"
                        : historyTurn.summaryPatch ||
                          (historyTurn.sequence === 1 ? "故事开场" : "已保存剧情")}
                    </strong>
                    <small>{formatTurnTime(historyTurn.createdAt)}</small>
                  </button>
                );
              })}
            </div>
            {historyError ? (
              <p className="history-error" role="alert">
                {historyError}
              </p>
            ) : null}
          </section>

          <section className="state-panel location-state-panel">
            <div className="state-heading character-state-heading">
              <div>
                <span>场景</span>
                <h2>当前地点</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLocationManagerOpen(true);
                  setEditingLocationId(null);
                  setLocationManagerError("");
                }}
              >
                管理地点
              </button>
            </div>
            <article className="current-location-card">
              <span aria-hidden="true">⌖</span>
              <div>
                <strong>
                  {currentLocation?.name ||
                    text(sessionState?.currentLocationName, "尚未记录地点")}
                </strong>
                <p>
                  {currentLocation?.description ||
                    "现有旧剧本会在下一次剧情移动或手工新增地点后建立地点资料。"}
                </p>
                <small>
                  {activeCharacterNames.filter((character) => character.present).length}
                  人在场 · 剧情移动自动同步
                </small>
              </div>
            </article>
          </section>

          <section className="state-panel">
            <div className="state-heading character-state-heading">
              <div>
                <span>角色</span>
                <h2>登场角色</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCharacterManagerOpen(true);
                  setEditingCharacterId(null);
                  setCharacterManagerError("");
                }}
              >
                管理人物
              </button>
            </div>
            <div className="cast-list">
              {activeCharacterNames.map((character) => (
                <article
                  className={character.present ? "" : "not-present"}
                  key={character.id}
                >
                  <span className="cast-monogram">
                    {character.cardRole === "player" ? "P" : "AI"}
                  </span>
                  <div>
                    <strong>{character.name}</strong>
                    <p>{character.description}</p>
                    {!character.present ? <small>暂时离场</small> : null}
                    {character.restriction ? (
                      <small className="cast-restriction">
                        行动受限：
                        {restrictionKindLabels[character.restriction.kind] ??
                          character.restriction.kind}
                        ，{character.restriction.summary}
                      </small>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="state-panel">
            <div className="state-heading character-state-heading">
              <div>
                <span>原作资料</span>
                <h2>原文参考</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSourceManagerOpen(true);
                  setSourceManagerError("");
                }}
              >
                管理原文
              </button>
            </div>
            {sourceDocuments.length > 0 ? (
              <div className="source-document-summary-list">
                {sourceDocuments.map((document) => (
                  <article
                    className={document.enabled ? "" : "disabled"}
                    key={document.id}
                  >
                    <strong>{document.name}</strong>
                    <p>
                      进度 {document.currentChapter}/{document.chapterCount}（随剧情推进自动解锁） · {document.fidelity === "faithful" ? "高度贴合（含后续锚点）" : "平衡参考"}
                    </p>
                    <small>{document.enabled ? "检索中" : "已暂停"}</small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="source-document-empty">
                尚未导入原文；加入小说正文后，AI 模型可参考原作中的人物表现。
              </p>
            )}
          </section>

          <section className="state-panel">
            <div className="state-heading character-state-heading">
              <div>
                <span>世界书</span>
                <h2>生效中的世界书</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setWorldBookManagerOpen(true);
                  setEditingWorldBookId(null);
                  setWorldBookManagerError("");
                }}
              >
                管理世界书
              </button>
            </div>
            {worldEntries.map((entry) => (
              <article className="world-entry" key={entry.entityId}>
                <strong>
                  {text(entry.state.comment) ||
                    strings(entry.state.keys)[0] ||
                    text(sessionState?.worldName, "世界核心")}
                </strong>
                <p>{text(entry.state.content)}</p>
                <small>
                  {entry.state.constant === true
                    ? "常驻"
                    : `触发：${strings(entry.state.keys).slice(0, 3).join("、") || "未设置"}`} · {worldBookLayerLabel(text(entry.state.layer, "base"))} · 版本 {entry.version}
                </small>
              </article>
            ))}
            {worldEntries.length === 0 ? (
              <p className="source-document-empty">当前没有启用的世界书条目。</p>
            ) : null}
          </section>

          <section className="state-panel memory-state-panel">
            <div className="state-heading character-state-heading">
              <div>
                <span>长期上下文</span>
                <h2>剧情记忆</h2>
              </div>
              <button type="button" onClick={() => void openMemoryManager()}>
                管理记忆
              </button>
            </div>
            <p>
              {memory.entries.filter((entry) => entry.enabled && entry.status === "active").length}
              条生效 · {memory.chapters.length} 个章节摘要
            </p>
            <small>
              每轮最多 {memory.settings.memoryTokenBudget.toLocaleString("zh-CN")} token，保留最近 {memory.settings.recentTurnCount} 回合原文
            </small>
          </section>

          <section className="state-panel audit-state-panel">
            <div className="state-heading character-state-heading">
              <div>
                <span>内容历史</span>
                <h2>修改记录与恢复</h2>
              </div>
              <button type="button" onClick={() => void openStateAudit()}>
                查看记录
              </button>
            </div>
            <p>
              {stateAudit
                ? `${contentAssetChanges.length} 项资料修改 · ${stateAudit.actions.length} 组状态变化`
                : "查看原文、记忆与状态的前后差异并安全撤销"}
            </p>
            <small>后续剧情或更新已覆盖的修改只保留为审计记录</small>
          </section>

          <section className="state-panel direction-panel">
            <div className="state-heading character-state-heading">
              <div>
                <span>导演笔记</span>
                <h2>当前剧情走向</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStoryModuleManagerOpen(true);
                  setEditingStoryModuleId(null);
                  setStoryModuleManagerError("");
                }}
              >
                管理任务
              </button>
            </div>
            <p>{initialDirection || "尚未设定，可在左侧输入新的剧情走向。"}</p>
            <small>
              {initialDirection
                ? text(storyDirection?.source) === "script_module"
                  ? "剧本任务 · 进行中"
                  : text(storyDirection?.source) === "automatic"
                    ? "AI 接续 · 进行中"
                    : "进行中"
                : "未启用"}
            </small>
            {storyModules.length > 0 ? (
              <details className="story-module-chain">
                <summary>
                  剧情任务链 · {storyModules.length} 个
                  <i aria-hidden="true">⌄</i>
                </summary>
                <ol>
                  {storyModules.map((module) => (
                    <li
                      className={
                        module.isEnabled
                          ? `module-${module.status}`
                          : "module-paused"
                      }
                      key={module.id}
                    >
                      <span aria-hidden="true" />
                      <div>
                        <strong>{module.title}</strong>
                        <p>{module.objective}</p>
                        <small>
                          {!module.isEnabled
                            ? "已暂停"
                            : ({
                                active: "当前任务",
                                queued: "等待条件",
                                completed: "已完成",
                                diverged: "剧情已偏离",
                                expired: "已过期",
                              }[module.status] ?? module.status)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </section>

          <div className="database-footnote">
            <span>{adventure.branchState.states.length}</span>
            项状态已写入本地数据库
          </div>
        </aside>
      </div>

      {turnContextOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !turnContextLoading) {
              setTurnContextOpen(false);
            }
          }}
        >
          <section
            className="character-manager context-inspector"
            role="dialog"
            aria-modal="true"
            aria-labelledby="context-inspector-title"
          >
            <header>
              <div>
                <p className="eyebrow">AI 请求快照</p>
                <h2 id="context-inspector-title">本轮实际上下文</h2>
                <p>
                  此处保存的是生成该回合时发送的资料，不是按当前存档事后重建。诊断只表示输入资料覆盖情况，不把覆盖数量冒充人物还原度评分。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭 AI 上下文"
                disabled={turnContextLoading}
                onClick={() => setTurnContextOpen(false)}
              >
                ×
              </button>
            </header>

            {turnContextError ? (
              <div className="character-manager-error" role="alert">
                {turnContextError}
              </div>
            ) : null}
            {turnContextLoading ? (
              <p className="context-inspector-loading">正在读取本地上下文快照……</p>
            ) : turnContext ? (
              <>
                <div className="context-overview">
                  <div>
                    <small>生成模型</small>
                    <strong>{turnContext.model}</strong>
                  </div>
                  <div>
                    <small>API 输入 token</small>
                    <strong>{tokenCount(turnContext.promptTokens)}</strong>
                  </div>
                  <div>
                    <small>全部请求本地估算</small>
                    <strong>{tokenCount(turnContext.estimatedTokens)}</strong>
                  </div>
                  <div>
                    <small>请求次数</small>
                    <strong>
                      {turnContext.requestCount} 次
                      {turnContext.repairApplied ? " · 含结构修复" : ""}
                    </strong>
                  </div>
                </div>

                <section className="context-diagnostics" aria-labelledby="context-diagnostics-title">
                  <header>
                    <div>
                      <span>输入资料覆盖</span>
                      <h3 id="context-diagnostics-title">人物依据诊断</h3>
                    </div>
                    <small>
                      状态 {String(contextTruncation.selectedStateCount ?? 0)} / {String(contextTruncation.activeStateCount ?? 0)} 项
                    </small>
                  </header>
                  <div className="context-character-grid">
                    {contextCharacterCoverage.map((item) => {
                      const level = text(item.level);
                      const coverageLabel =
                        level === "card_and_source"
                          ? "角色卡 + 原文"
                          : level === "card_only"
                            ? "仅角色卡"
                            : "角色卡未进入";
                      return (
                        <article className={`coverage-${level}`} key={text(item.characterId)}>
                          <header>
                            <strong>{text(item.name, "未命名角色")}</strong>
                            <span>{coverageLabel}</span>
                          </header>
                          <p>
                            {item.present === true ? "当前在场" : "当前不在场"} · 状态
                            {item.stateIncluded === true ? "已进入" : "未进入"}
                          </p>
                          <small>
                            原文 {String(item.sourceReferenceCount ?? 0)} 段 · 长期记忆 {String(item.longTermMemoryCount ?? 0)} 条
                          </small>
                        </article>
                      );
                    })}
                  </div>
                  {contextWarnings.length > 0 ? (
                    <ul className="context-warning-list">
                      {contextWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>

                <section className="context-section-budget" aria-labelledby="context-budget-title">
                  <header>
                    <h3 id="context-budget-title">各部分本地估算</h3>
                    <small>用于发现哪类资料占用上下文，不等同于供应商计费结果</small>
                  </header>
                  <div>
                    {contextSections.map((section) => (
                      <span key={text(section.name)}>
                        <i>{text(section.name)}</i>
                        <strong>{tokenCount(typeof section.estimatedTokens === "number" ? section.estimatedTokens : undefined)}</strong>
                      </span>
                    ))}
                  </div>
                </section>

                <section className="context-payload" aria-labelledby="context-payload-title">
                  <header>
                    <h3 id="context-payload-title">结构化故事资料</h3>
                    <small>展开后可核对生成这一回合时的具体值</small>
                  </header>
                  {Object.entries(turnContext.context).map(([key, value]) => (
                    <details key={key} open={key === "playerInput"}>
                      <summary>
                        <strong>{contextFieldLabels[key] ?? key}</strong>
                        <span>
                          {Array.isArray(value) ? `${value.length} 项` : "查看内容"}
                        </span>
                      </summary>
                      <pre>{JSON.stringify(value, null, 2)}</pre>
                    </details>
                  ))}
                </section>

                <section className="context-payload context-request-messages" aria-labelledby="context-messages-title">
                  <header>
                    <h3 id="context-messages-title">实际请求消息</h3>
                    <small>包括系统规则、结构化上下文以及重新生成意见</small>
                  </header>
                  {turnContext.messages.map((message, index) => (
                    <details key={`${message.role}-${index}`}>
                      <summary>
                        <strong>
                          {message.role === "system"
                            ? "系统消息"
                            : message.role === "assistant"
                              ? "模型消息"
                              : "用户消息"}
                        </strong>
                        <span>{message.content.length.toLocaleString("zh-CN")} 字符</span>
                      </summary>
                      <pre>{message.content}</pre>
                    </details>
                  ))}
                </section>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      {stateAuditOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !stateAuditBusy) {
              setReasonPrompt(null);
              setStateAuditOpen(false);
            }
          }}
        >
          <section
            className="character-manager story-workbench state-audit-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="state-audit-title"
          >
            <header>
              <div>
                <p className="eyebrow">剧本工作台 · 内容历史</p>
                <h2 id="state-audit-title">修改记录与恢复</h2>
                <p>
                  集中查看原文、记忆和持久状态变化。撤销会追加补偿记录；字段锁对整个剧本生效，只拦截 AI 自动改写。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭状态审计"
                disabled={Boolean(stateAuditBusy)}
                onClick={() => {
                  setReasonPrompt(null);
                  setStateAuditOpen(false);
                }}
              >
                ×
              </button>
            </header>

            <StoryWorkbenchNavigation
              active="state_audit"
              disabled={Boolean(stateAuditBusy)}
              onSelect={selectStoryWorkbenchTab}
            />

            {stateAuditError ? (
              <div className="character-manager-error" role="alert">
                {stateAuditError}
              </div>
            ) : null}

            {stateAuditBusy === "loading" ? (
              <p className="state-audit-loading">正在读取本地变更记录……</p>
            ) : stateAudit ? (
              <>
                <div className="character-manager-toolbar state-audit-toolbar">
                  <span>
                    {stateAudit.branchName} · {contentAssetChanges.length} 项资料修改 · {stateAudit.actions.length} 组状态变化 · {stateAudit.locks.length} 个字段锁
                  </span>
                  <small>仅当前剧情节点上同一对象的最新资料修改可自动撤销</small>
                </div>

                <section
                  className="content-asset-audit-section"
                  aria-labelledby="content-asset-audit-title"
                >
                  <div className="content-asset-audit-heading">
                    <div>
                      <span>本地资料</span>
                      <h3 id="content-asset-audit-title">原文与剧情记忆</h3>
                    </div>
                    <small>删除的原文仍保存在本地，可在安全窗口内恢复</small>
                  </div>
                  {contentAssetChanges.length > 0 ? (
                    <div className="state-audit-timeline content-asset-audit-list">
                      {contentAssetChanges.map((change, index) => {
                        const differences = contentAssetDiffs(change);
                        return (
                          <details key={change.id} open={index === 0}>
                            <summary>
                              <div>
                                <strong>
                                  {contentAssetOperationLabels[change.operation] ?? change.operation} · {contentAssetTarget(change)}
                                </strong>
                                <small>{formatTurnTime(change.createdAt)}</small>
                              </div>
                              <span>
                                {change.revertedByActionId
                                  ? "已撤销"
                                  : `修订 ${change.revision}`}
                              </span>
                            </summary>
                            <div className="state-audit-action-body">
                              <article className="state-audit-change">
                                <header>
                                  <div>
                                    <span>
                                      {change.domain === "sources" ? "原文参考" : "剧情记忆"}
                                    </span>
                                    <h4>{contentAssetTarget(change)}</h4>
                                    <p>
                                      {text(change.summary.reason) ||
                                        `${differences.length} 个字段发生变化`}
                                    </p>
                                  </div>
                                  <div>
                                    <small>
                                      {change.canRollback
                                        ? "当前可安全撤销"
                                        : change.rollbackBlockedReason ?? "仅供审计"}
                                    </small>
                                    <button
                                      className="state-rollback-button"
                                      type="button"
                                      disabled={
                                        Boolean(stateAuditBusy) || !change.canRollback
                                      }
                                      title={
                                        change.canRollback
                                          ? "恢复到本次资料修改之前"
                                          : change.rollbackBlockedReason ?? "不能自动撤销"
                                      }
                                      onClick={() =>
                                        requestRollbackContentAsset(change)
                                      }
                                    >
                                      {stateAuditBusy === `asset:${change.id}`
                                        ? "正在撤销……"
                                        : change.canRollback
                                          ? "撤销这项修改"
                                          : change.revertedByActionId
                                            ? "已经撤销"
                                            : "不能自动撤销"}
                                    </button>
                                  </div>
                                </header>
                                {differences.length > 0 ? (
                                  <div className="state-diff-list">
                                    {differences.map((key) => (
                                      <div className="state-diff-row" key={key}>
                                        <div className="state-diff-name">
                                          <strong>{fieldLabels[key] ?? key}</strong>
                                        </div>
                                        <div className="state-diff-values">
                                          <span>
                                            <small>修改前</small>
                                            {change.before[key] === undefined
                                              ? "不存在"
                                              : shortValue(change.before[key], 160)}
                                          </span>
                                          <i aria-hidden="true">→</i>
                                          <span>
                                            <small>修改后</small>
                                            {change.after[key] === undefined
                                              ? "不存在"
                                              : shortValue(change.after[key], 160)}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="state-audit-empty">
                                    这项操作没有可展示的恢复快照。
                                  </p>
                                )}
                              </article>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="state-audit-empty">
                      当前分支还没有原文或剧情记忆修改。
                    </p>
                  )}
                </section>

                <section className="state-lock-section" aria-labelledby="state-lock-title">
                  <div>
                    <span>跨分支保护</span>
                    <h3 id="state-lock-title">已锁定字段</h3>
                  </div>
                  {stateAudit.locks.length > 0 ? (
                    <div className="state-lock-list">
                      {stateAudit.locks.map((lock) => (
                        <article
                          key={`${lock.entityType}:${lock.entityId}:${lock.fieldPath}`}
                        >
                          <div>
                            <strong>
                              {stateLabels[lock.entityType]} · {auditTargetLabel(lock)}
                            </strong>
                            <p>{auditFieldLabel(lock.fieldPath)}</p>
                            <small>{lock.reason}</small>
                          </div>
                          <button
                            type="button"
                            disabled={Boolean(stateAuditBusy)}
                            onClick={() =>
                              requestAuditFieldLock({
                                entityType: lock.entityType,
                                entityId: lock.entityId,
                                fieldPath: lock.fieldPath,
                                locked: false,
                              })
                            }
                          >
                            解除锁定
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="state-audit-empty">
                      尚未锁定字段。可从下方任意字段差异中建立保护。
                    </p>
                  )}
                </section>

                <div className="state-audit-timeline">
                  {stateAudit.actions.map((action) => (
                    <details key={action.id} open={action === stateAudit.actions[0]}>
                      <summary>
                        <div>
                          <strong>{action.title}</strong>
                          <small>{formatTurnTime(action.createdAt)}</small>
                        </div>
                        <span>{action.changes.length} 项变化</span>
                      </summary>
                      <div className="state-audit-action-body">
                        {action.changes.map((change) => (
                          <article className="state-audit-change" key={change.id}>
                            <header>
                              <div>
                                <span>{stateLabels[change.entityType]}</span>
                                <h4>{auditTargetLabel(change)}</h4>
                                <p>{change.reason}</p>
                              </div>
                              <div>
                                <small>{operationLabels[change.operation]}</small>
                                <button
                                  className="state-rollback-button"
                                  type="button"
                                  disabled={
                                    Boolean(stateAuditBusy) || !change.canRollback
                                  }
                                  title={
                                    change.canRollback
                                      ? "恢复到这项变化发生前的状态"
                                      : "开局基础资料不能回滚"
                                  }
                                  onClick={() => void requestRollbackAuditChange(change)}
                                >
                                  {stateAuditBusy === `rollback:${change.id}`
                                    ? "正在撤销……"
                                    : change.canRollback
                                      ? "撤销这项变化"
                                      : "开局已锁定"}
                                </button>
                              </div>
                            </header>
                            {change.fields.length > 0 ? (
                              <div className="state-diff-list">
                                {change.fields.map((field) => (
                                  <div className="state-diff-row" key={field.path}>
                                    <div className="state-diff-name">
                                      <strong>{auditFieldLabel(field.path)}</strong>
                                      {field.locked ? <small>已锁定</small> : null}
                                    </div>
                                    <div className="state-diff-values">
                                      <span>
                                        <small>修改前</small>
                                        {auditDiffValue(field, "before")}
                                      </span>
                                      <i aria-hidden="true">→</i>
                                      <span>
                                        <small>修改后</small>
                                        {auditDiffValue(field, "after")}
                                      </span>
                                    </div>
                                    {field.path !== "/" ? (
                                      <button
                                        type="button"
                                        disabled={Boolean(stateAuditBusy)}
                                        onClick={() =>
                                          requestAuditFieldLock({
                                            entityType: change.entityType,
                                            entityId: change.entityId,
                                            fieldPath: field.path,
                                            locked: !field.locked,
                                          })
                                        }
                                      >
                                        {field.locked ? "解除" : "锁定字段"}
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="state-audit-empty">这项操作没有产生可见字段差异。</p>
                            )}
                          </article>
                        ))}
                      </div>
                    </details>
                  ))}
                  {stateAudit.actions.length === 0 ? (
                    <p className="state-audit-empty">当前分支还没有可审计的状态变化。</p>
                  ) : null}
                </div>
              </>
            ) : null}

            {reasonPrompt ? (
              <div
                className="reason-prompt-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget && !stateAuditBusy) {
                    setReasonPrompt(null);
                  }
                }}
              >
                <form
                  className="reason-prompt-card"
                  role="dialog"
                  aria-modal="true"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAuditReasonPrompt();
                  }}
                >
                  <header>
                    <div>
                      <p className="eyebrow">修改记录与恢复 · 操作原因</p>
                      <h3>
                        {reasonPrompt.kind === "rollback_change"
                          ? "撤销这项状态变化"
                          : reasonPrompt.kind === "rollback_asset"
                            ? "撤销这项资料修改"
                            : reasonPrompt.locked
                              ? "锁定字段"
                              : "解除字段锁定"}
                      </h3>
                      <p>
                        {reasonPrompt.kind === "rollback_change"
                          ? "系统会在当前剧情末尾追加补偿记录，不会删除或改写过去的对话。"
                          : reasonPrompt.kind === "rollback_asset"
                            ? "只有当前剧情节点上同一对象的最新修改可以安全撤销。"
                            : reasonPrompt.locked
                              ? "锁定对本剧本的所有分支生效，只阻止 AI 自动改写。"
                              : "允许后续剧情继续更新该字段。"}
                      </p>
                    </div>
                    <button
                      className="character-manager-close"
                      type="button"
                      aria-label="关闭原因输入"
                      disabled={Boolean(stateAuditBusy)}
                      onClick={() => setReasonPrompt(null)}
                    >
                      ×
                    </button>
                  </header>
                  <label>
                    <span>原因（将写入剧情末尾的补偿记录）</span>
                    <textarea
                      autoFocus
                      rows={3}
                      maxLength={500}
                      value={reasonPromptValue}
                      disabled={Boolean(stateAuditBusy)}
                      onChange={(event) =>
                        setReasonPromptValue(event.target.value)
                      }
                    />
                  </label>
                  <footer>
                    <button
                      type="button"
                      disabled={Boolean(stateAuditBusy)}
                      onClick={() => setReasonPrompt(null)}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={
                        Boolean(stateAuditBusy) || !reasonPromptValue.trim()
                      }
                    >
                      {reasonPrompt.kind === "rollback_change"
                        ? "撤销这项变化"
                        : reasonPrompt.kind === "rollback_asset"
                          ? "撤销这项修改"
                          : reasonPrompt.locked
                            ? "确认锁定"
                            : "确认解除"}
                    </button>
                  </footer>
                </form>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {memoryManagerOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !memoryBusy) {
              setMemoryManagerOpen(false);
            }
          }}
        >
          <section
            className="character-manager story-workbench memory-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-manager-title"
          >
            <header>
              <div>
                <p className="eyebrow">剧本工作台 · 长期上下文</p>
                <h2 id="memory-manager-title">剧情记忆</h2>
                <p>
                  系统按本轮内容召回相关旧事；固定记忆始终优先，停用记忆不会发送给 AI 模型。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                disabled={Boolean(memoryBusy)}
                onClick={() => setMemoryManagerOpen(false)}
              >
                关闭
              </button>
            </header>

            <StoryWorkbenchNavigation
              active="memories"
              disabled={Boolean(memoryBusy)}
              onSelect={selectStoryWorkbenchTab}
            />

            {memoryManagerError ? (
              <div className="character-manager-error" role="alert">
                {memoryManagerError}
              </div>
            ) : null}

            <form className="memory-settings" onSubmit={saveMemorySettings}>
              <label>
                <span>长期记忆预算</span>
                <input
                  name="memoryTokenBudget"
                  type="number"
                  min={600}
                  max={8000}
                  step={100}
                  defaultValue={memory.settings.memoryTokenBudget}
                  key={`budget-${memory.settings.memoryTokenBudget}`}
                />
              </label>
              <label>
                <span>最近回合原文</span>
                <input
                  name="recentTurnCount"
                  type="number"
                  min={2}
                  max={12}
                  defaultValue={memory.settings.recentTurnCount}
                  key={`recent-${memory.settings.recentTurnCount}`}
                />
              </label>
              <label>
                <span>每章回合数</span>
                <input
                  name="chapterSize"
                  type="number"
                  min={5}
                  max={20}
                  defaultValue={memory.settings.chapterSize}
                  key={`chapter-${memory.settings.chapterSize}`}
                />
              </label>
              <button type="submit" disabled={Boolean(memoryBusy)}>
                {memoryBusy === "settings" ? "保存中……" : "保存设置"}
              </button>
              <button
                type="button"
                disabled={Boolean(memoryBusy)}
                onClick={() => void rebuildMemory()}
              >
                {memoryBusy === "rebuild" ? "重建中……" : "重新提取自动记忆"}
              </button>
            </form>

            {memory.latestRetrieval ? (
              <div className="memory-retrieval-summary">
                <strong>最近一次召回</strong>
                <span>
                  {memory.latestRetrieval.memoryIds.length} 条记忆、
                  {memory.latestRetrieval.chapterIds.length} 个章节 · 约
                  {memory.latestRetrieval.estimatedTokens} / {memory.latestRetrieval.budgetTokens} token
                </span>
                <p>{memory.latestRetrieval.query || "本轮没有文字查询"}</p>
              </div>
            ) : null}

            <div className="memory-manager-grid">
              <section>
                <div className="memory-section-heading">
                  <h3>长期记忆</h3>
                  <span>{memory.entries.length} 条</span>
                </div>
                <div className="memory-entry-list">
                  {memory.entries.map((entry) => (
                    <details
                      className={`${entry.enabled ? "" : "disabled"} ${entry.pinned ? "pinned" : ""}`}
                      key={`${entry.id}-${entry.updatedAt}`}
                    >
                      <summary>
                        <span>
                          <small>{entry.type} · 重要度 {entry.importance}</small>
                          <strong>{entry.title}</strong>
                        </span>
                        <i>{entry.pinned ? "已固定" : entry.status === "resolved" ? "已解决" : "生效中"}</i>
                      </summary>
                      <form onSubmit={(event) => void saveMemoryEntry(event, entry.id)}>
                        <label>
                          <span>标题</span>
                          <input name="title" defaultValue={entry.title} maxLength={120} />
                        </label>
                        <label>
                          <span>记忆内容</span>
                          <textarea name="content" defaultValue={entry.content} rows={4} maxLength={4000} />
                        </label>
                        <label>
                          <span>重要度（0—100）</span>
                          <input name="importance" type="number" min={0} max={100} defaultValue={entry.importance} />
                        </label>
                        <div className="memory-entry-actions">
                          <button type="submit" disabled={Boolean(memoryBusy)}>
                            {memoryBusy === entry.id ? "保存中……" : "保存修正"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(memoryBusy)}
                            onClick={() => void patchMemory({ operation: "update_entry", entryId: entry.id, patch: { pinned: !entry.pinned } }, `pin-${entry.id}`)}
                          >
                            {entry.pinned ? "取消固定" : "固定召回"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(memoryBusy)}
                            onClick={() => void patchMemory({ operation: "update_entry", entryId: entry.id, patch: { status: entry.status === "active" ? "resolved" : "active" } }, `status-${entry.id}`)}
                          >
                            {entry.status === "active" ? "标为已解决" : "重新启用线索"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(memoryBusy)}
                            onClick={() => void patchMemory({ operation: "update_entry", entryId: entry.id, patch: { enabled: !entry.enabled } }, `enable-${entry.id}`)}
                          >
                            {entry.enabled ? "停用" : "启用"}
                          </button>
                        </div>
                      </form>
                    </details>
                  ))}
                  {memory.entries.length === 0 ? (
                    <p className="managed-character-empty">尚无长期记忆，推进剧情后会自动提取。</p>
                  ) : null}
                </div>
              </section>

              <section>
                <div className="memory-section-heading">
                  <h3>章节摘要</h3>
                  <span>{memory.chapters.length} 章</span>
                </div>
                <div className="memory-chapter-list">
                  {memory.chapters.map((chapter) => (
                    <article key={chapter.id}>
                      <small>回合 {chapter.startSequence}—{chapter.endSequence}</small>
                      <strong>{chapter.title}</strong>
                      <p>{chapter.summary}</p>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {branchManagerOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !branchBusyAction) {
              setRenamingBranchId(null);
              setBranchRenameValue("");
              setBranchManagerOpen(false);
            }
          }}
        >
          <section
            className="character-manager branch-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="branch-manager-title"
          >
            <header>
              <div>
                <p className="eyebrow">非破坏性剧情恢复</p>
                <h2 id="branch-manager-title">分支与存档</h2>
                <p>
                  从历史回合或存档继续时会建立独立分支，原剧情、人物状态和世界书不会被改写。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭分支与存档"
                disabled={Boolean(branchBusyAction)}
                onClick={() => {
                  setRenamingBranchId(null);
                  setBranchRenameValue("");
                  setBranchManagerOpen(false);
                }}
              >
                ×
              </button>
            </header>

            {branchManagerError ? (
              <div className="character-manager-error" role="alert">
                {branchManagerError}
              </div>
            ) : null}

            <div className="branch-manager-grid">
              <section className="branch-manager-section">
                <div className="branch-section-heading">
                  <div>
                    <small>当前剧本</small>
                    <h3>剧情分支</h3>
                  </div>
                  <span>{branches.length} 条路线</span>
                </div>
                <div className="branch-list">
                  {branches.map((branch) => (
                    <article
                      className={`${branch.isActive ? "active" : ""}${
                        renamingBranchId === branch.id ? " branch-renaming" : ""
                      }`}
                      key={branch.id}
                    >
                      <div>
                        <strong>{branch.name}</strong>
                        <span>
                          {branch.isActive ? "当前分支" : "可切换"} · 回合 {branch.headSequence}
                        </span>
                        <small>
                          {branch.isMain ? "主线" : "由历史剧情分叉"} · {formatTurnTime(branch.updatedAt)}
                        </small>
                      </div>
                      <footer>
                        <button
                          type="button"
                          disabled={Boolean(branchBusyAction) || branch.isActive}
                          onClick={() => void switchToBranch(branch)}
                        >
                          {branchBusyAction === `switch:${branch.id}`
                            ? "切换中……"
                            : branch.isActive
                              ? "正在使用"
                              : "切换"}
                        </button>
                        {renamingBranchId !== branch.id ? (
                          <button
                            type="button"
                            disabled={Boolean(branchBusyAction)}
                            onClick={() => startRenameBranch(branch)}
                          >
                            重命名
                          </button>
                        ) : null}
                        {!branch.isMain ? (
                          <button
                            type="button"
                            disabled={Boolean(branchBusyAction)}
                            onClick={() => void setBranchAsMain(branch)}
                          >
                            {branchBusyAction === `set-main:${branch.id}`
                              ? "设置中……"
                              : "设为主线"}
                          </button>
                        ) : null}
                        <button
                          className="deactivate"
                          type="button"
                          disabled={Boolean(branchBusyAction) || branch.isMain}
                          onClick={() => void deleteExistingBranch(branch)}
                        >
                          删除
                        </button>
                      </footer>
                      {renamingBranchId === branch.id ? (
                        <form
                          className="branch-rename-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submitBranchRename(branch);
                          }}
                        >
                          <label>
                            <span>新分支名称</span>
                            <input
                              autoFocus
                              maxLength={80}
                              value={branchRenameValue}
                              disabled={Boolean(branchBusyAction)}
                              onChange={(event) =>
                                setBranchRenameValue(event.target.value)
                              }
                            />
                          </label>
                          <div>
                            <button
                              type="submit"
                              disabled={
                                Boolean(branchBusyAction) ||
                                !branchRenameValue.trim()
                              }
                            >
                              {branchBusyAction === `rename:${branch.id}`
                                ? "保存中……"
                                : "保存"}
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(branchBusyAction)}
                              onClick={() => {
                                setRenamingBranchId(null);
                                setBranchRenameValue("");
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </article>
                  ))}
                </div>

                <form
                  className="branch-create-form"
                  onSubmit={createBranchFromSelection}
                >
                  <div>
                    <small>新路线</small>
                    <h3>
                      {branchRecoveryPointId
                        ? "从所选存档恢复"
                        : "从历史回合创建分支"}
                    </h3>
                  </div>
                  {!branchRecoveryPointId ? (
                    <label>
                      <span>分支起点</span>
                      <select
                        value={branchSourceTurnId}
                        disabled={Boolean(branchBusyAction)}
                        onChange={(event) =>
                          setBranchSourceTurnId(event.target.value)
                        }
                      >
                        {[...adventure.branchState.turnHistory]
                          .reverse()
                          .map((historyTurn) => (
                            <option value={historyTurn.id} key={historyTurn.id}>
                              回合 {historyTurn.sequence} · {historyTurn.summaryPatch || (historyTurn.sequence === 1 ? "故事开场" : "已保存剧情")}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : (
                    <div className="selected-recovery-note">
                      <span>已选择存档</span>
                      <strong>
                        {recoveryPoints.find(
                          (point) => point.id === branchRecoveryPointId,
                        )?.name ?? "存档"}
                      </strong>
                      <button
                        type="button"
                        disabled={Boolean(branchBusyAction)}
                        onClick={() => {
                          setBranchRecoveryPointId("");
                          setBranchSourceTurnId(
                            adventure.branchState.branch.headTurnId ?? "",
                          );
                        }}
                      >
                        改用历史回合
                      </button>
                    </div>
                  )}
                  <label>
                    <span>新分支名称</span>
                    <input
                      required
                      maxLength={80}
                      value={branchName}
                      disabled={Boolean(branchBusyAction)}
                      placeholder="例如：接受婚约路线"
                      onChange={(event) => setBranchName(event.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={Boolean(branchBusyAction) || !branchName.trim()}
                  >
                    {branchBusyAction === "create"
                      ? "正在恢复状态……"
                      : "建立并切换到新分支"}
                  </button>
                </form>
              </section>

              <section className="branch-manager-section save-manager-section">
                <div className="branch-section-heading">
                  <div>
                    <small>本地恢复点</small>
                    <h3>存档</h3>
                  </div>
                  <span>{recoveryPoints.length} 个</span>
                </div>
                <form className="manual-save-form" onSubmit={createManualSave}>
                  <label>
                    <span>保存当前分支和全部状态</span>
                    <input
                      required
                      maxLength={80}
                      value={savePointName}
                      disabled={Boolean(branchBusyAction)}
                      placeholder={`回合 ${latestTurn?.sequence ?? 1} 前的重要节点`}
                      onChange={(event) => setSavePointName(event.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={Boolean(branchBusyAction) || !savePointName.trim()}
                  >
                    {branchBusyAction === "save" ? "保存中……" : "建立手动存档"}
                  </button>
                </form>
                <p className="automatic-save-note">
                  系统会在开局及每 5 个回合自动保存一次；手动存档还会包含当前回合后的角色与地点管理结果。
                  “恢复”会把当前剧情回到存档点并删除其后推进的内容；“恢复为新分支”则保留原路线。
                </p>
                <div className="recovery-point-list">
                  {recoveryPoints.map((point) => (
                    <article
                      className={
                        branchRecoveryPointId === point.id ? "selected" : ""
                      }
                      key={point.id}
                    >
                      <div>
                        <span>
                          {point.type === "manual"
                            ? "手动存档"
                            : point.type === "fork"
                              ? "分支起点"
                              : "自动存档"}
                        </span>
                        <strong>{point.name}</strong>
                        <small>
                          {point.branchName} · 回合 {point.sequence} · {formatTurnTime(point.createdAt)}
                        </small>
                      </div>
                      <footer>
                        <button
                          type="button"
                          disabled={Boolean(branchBusyAction)}
                          onClick={() => void restoreToSavePoint(point)}
                        >
                          {branchBusyAction === `restore:${point.id}`
                            ? "恢复中……"
                            : "恢复"}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(branchBusyAction)}
                          onClick={() => selectRecoveryPoint(point)}
                        >
                          恢复为新分支
                        </button>
                        {point.type === "manual" ? (
                          <button
                            className="deactivate"
                            type="button"
                            disabled={Boolean(branchBusyAction)}
                            onClick={() => void deleteManualSave(point)}
                          >
                            删除
                          </button>
                        ) : null}
                      </footer>
                    </article>
                  ))}
                  {recoveryPoints.length === 0 ? (
                    <p>当前还没有存档；建立第一个手动存档后会显示在这里。</p>
                  ) : null}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {sourceManagerOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !savingSourceId &&
              !importingSource
            ) {
              setSourceManagerOpen(false);
            }
          }}
        >
          <section
            className="character-manager story-workbench source-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-manager-title"
          >
            <header>
              <div>
                <p className="eyebrow">剧本工作台 · 原作资料</p>
                <h2 id="source-manager-title">原文参考管理</h2>
                <p>
                  文件保存在本机；生成剧情时只会把自动挑选的少量片段发送给当前 AI 模型供应商。高度贴合模式会额外发送下一章节中最相关的少量导演锚点，用于避免角色自行发明与剧本冲突的关键方案。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭原文参考管理"
                disabled={Boolean(savingSourceId) || importingSource}
                onClick={() => setSourceManagerOpen(false)}
              >
                ×
              </button>
            </header>

            <StoryWorkbenchNavigation
              active="sources"
              disabled={Boolean(savingSourceId) || importingSource}
              onSelect={selectStoryWorkbenchTab}
            />

            <div className="character-manager-toolbar source-manager-toolbar">
              <span>
                {sourceDocuments.filter((document) => document.enabled).length} 份启用 · {sourceDocuments.length}/5 份已保存
              </span>
              <label
                className={
                  sourceDocuments.length >= 5 || importingSource
                    ? "source-import-button disabled"
                    : "source-import-button"
                }
              >
                {importingSource ? "正在建立索引……" : "＋ 导入 TXT / MD"}
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  disabled={sourceDocuments.length >= 5 || importingSource}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void importSourceFile(file);
                  }}
                />
              </label>
            </div>

            {sourceManagerError ? (
              <div className="character-manager-error" role="alert">
                {sourceManagerError}
              </div>
            ) : null}

            <div className="source-document-list">
              {sourceDocuments.map((document) => {
                const saving = savingSourceId === document.id;
                return (
                  <article
                    className={!document.enabled ? "inactive" : ""}
                    key={document.id}
                  >
                    <header>
                      <div>
                        <strong>{document.name}</strong>
                        <span>{document.fileName}</span>
                      </div>
                      <small>
                        {document.chapterCount} 个章节或场景 · {document.chunkCount} 个检索片段
                      </small>
                    </header>
                    <div className="source-settings-grid">
                      <label>
                        <span>原作进度</span>
                        <select
                          value={document.currentChapter}
                          disabled={saving}
                          onChange={(event) =>
                            void updateSourceSettings(document.id, {
                              currentChapter: Number(event.target.value),
                            })
                          }
                        >
                          {Array.from(
                            { length: document.chapterCount },
                            (_, index) => index + 1,
                          ).map((chapter) => (
                            <option value={chapter} key={chapter}>
                              第 {chapter} / {document.chapterCount} 段
                            </option>
                          ))}
                        </select>
                        <small className="source-settings-hint">
                          剧情推进到新章节时模型会自动向前解锁（只进不退），也可在此手动调整。
                        </small>
                      </label>
                      <label>
                        <span>人物贴合度</span>
                        <select
                          value={document.fidelity}
                          disabled={saving}
                          onChange={(event) =>
                            void updateSourceSettings(document.id, {
                              fidelity: event.target.value,
                            })
                          }
                        >
                          <option value="balanced">平衡参考</option>
                          <option value="faithful">高度贴合（含后续剧本锚点）</option>
                        </select>
                      </label>
                    </div>
                    <div className="source-setting-toggles">
                      <label>
                        <input
                          type="checkbox"
                          checked={document.enabled}
                          disabled={saving}
                          onChange={(event) =>
                            void updateSourceSettings(document.id, {
                              enabled: event.target.checked,
                            })
                          }
                        />
                        <span>生成时使用这份原文</span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={document.preventFuture}
                          disabled={saving}
                          onChange={(event) =>
                            void updateSourceSettings(document.id, {
                              preventFuture: event.target.checked,
                            })
                          }
                        />
                        <span>禁止把进度之后的内容当作已发生事实</span>
                      </label>
                    </div>
                    <footer>
                      <span>
                        {saving
                          ? "正在保存……"
                          : `${document.contentLength.toLocaleString("zh-CN")} 字符，下一回合生效`}
                      </span>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void deleteSourceDocument(document)}
                      >
                        删除资料
                      </button>
                    </footer>
                  </article>
                );
              })}
              {sourceDocuments.length === 0 ? (
                <div className="source-manager-empty">
                  <strong>还没有原文参考</strong>
                  <p>
                    导入小说正文后，系统会自动识别章节和人物姓名；默认从第一段开始，并阻止读取未来内容。
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {foreshadowingManagerOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingForeshadowing) {
              setForeshadowingManagerOpen(false);
              setEditingForeshadowingId(null);
            }
          }}
        >
          <section
            className="character-manager story-workbench story-module-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="foreshadowing-manager-title"
          >
            <header>
              <div>
                <p className="eyebrow">剧本工作台 · 剧情规划</p>
                <h2 id="foreshadowing-manager-title">伏笔</h2>
                <p>
                  伏笔在满足出现条件后埋入剧情，在相关时刻进入模型上下文；回收条件满足时模型会呈现回收概要。修改从下一次生成开始生效。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭伏笔管理"
                disabled={savingForeshadowing}
                onClick={() => {
                  setForeshadowingManagerOpen(false);
                  setEditingForeshadowingId(null);
                }}
              >
                ×
              </button>
            </header>

            <StoryWorkbenchNavigation
              active="foreshadowing"
              disabled={savingForeshadowing}
              onSelect={selectStoryWorkbenchTab}
            />

            <div className="character-manager-toolbar plot-toolbar">
              <div className="plot-toolbar-left">
                <span>
                  {plotThreads.filter((thread) => thread.status !== "paid_off").length}{" "}
                  个未回收 · {plotThreads.length}/30 个已保存
                </span>
                <div
                  className="plot-filter-options"
                  role="group"
                  aria-label="按伏笔状态筛选"
                >
                  <button
                    type="button"
                    className={foreshadowingFilter === "all" ? "active" : ""}
                    onClick={() => setForeshadowingFilter("all")}
                  >
                    全部 {plotThreads.length}
                  </button>
                  <button
                    type="button"
                    className={
                      foreshadowingFilter === "dormant" ? "active" : ""
                    }
                    onClick={() => setForeshadowingFilter("dormant")}
                  >
                    未埋入{" "}
                    {plotThreads.filter((thread) => thread.status === "dormant").length}
                  </button>
                  <button
                    type="button"
                    className={foreshadowingFilter === "seeded" ? "active" : ""}
                    onClick={() => setForeshadowingFilter("seeded")}
                  >
                    已埋入{" "}
                    {plotThreads.filter((thread) => thread.status === "seeded").length}
                  </button>
                  <button
                    type="button"
                    className={
                      foreshadowingFilter === "paid_off" ? "active" : ""
                    }
                    onClick={() => setForeshadowingFilter("paid_off")}
                  >
                    已回收{" "}
                    {plotThreads.filter((thread) => thread.status === "paid_off").length}
                  </button>
                </div>
              </div>
              <button
                type="button"
                disabled={savingForeshadowing || plotThreads.length >= 30}
                onClick={startAddingForeshadowing}
              >
                ＋ 新增伏笔
              </button>
            </div>

            {foreshadowingError ? (
              <div className="character-manager-error" role="alert">
                {foreshadowingError}
              </div>
            ) : null}

            {editingForeshadowingId ? (
              <form
                className="character-editor story-module-editor"
                onSubmit={submitForeshadowingForm}
              >
                <div className="character-editor-heading">
                  <div>
                    <small>
                      {editingForeshadowingId === "__new__"
                        ? "新增伏笔"
                        : "编辑伏笔"}
                    </small>
                    <h3>
                      {editingForeshadowingId === "__new__"
                        ? "埋设新的伏笔"
                        : `编辑 ${foreshadowingForm.id}`}
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={savingForeshadowing}
                    onClick={() => setEditingForeshadowingId(null)}
                  >
                    取消编辑
                  </button>
                </div>
                <label>
                  <span>伏笔 ID</span>
                  <input
                    value={foreshadowingForm.id}
                    disabled={editingForeshadowingId !== "__new__"}
                    maxLength={80}
                    onChange={(event) =>
                      setForeshadowingForm((current) => ({
                        ...current,
                        id: event.target.value,
                      }))
                    }
                    placeholder="如 well-bell（仅文字、数字、点、下划线、连字符）"
                  />
                </label>
                <label>
                  <span>关键词（每行一个，用于把伏笔带进上下文）</span>
                  <textarea
                    rows={3}
                    value={foreshadowingForm.keywords}
                    onChange={(event) =>
                      setForeshadowingForm((current) => ({
                        ...current,
                        keywords: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>出现条件（seedCondition）</span>
                  <textarea
                    rows={2}
                    value={foreshadowingForm.seedCondition}
                    maxLength={1000}
                    onChange={(event) =>
                      setForeshadowingForm((current) => ({
                        ...current,
                        seedCondition: event.target.value,
                      }))
                    }
                    placeholder="如：角色进入古井附近，或听到钟声时"
                  />
                </label>
                <label>
                  <span>回收条件（payoffCondition）</span>
                  <textarea
                    rows={2}
                    value={foreshadowingForm.payoffCondition}
                    maxLength={1000}
                    onChange={(event) =>
                      setForeshadowingForm((current) => ({
                        ...current,
                        payoffCondition: event.target.value,
                      }))
                    }
                    placeholder="如：玩家发现古井底部的钟"
                  />
                </label>
                <label>
                  <span>回收概要（payoffSummary，回收时应呈现的核心信息）</span>
                  <textarea
                    rows={4}
                    value={foreshadowingForm.payoffSummary}
                    maxLength={4000}
                    onChange={(event) =>
                      setForeshadowingForm((current) => ({
                        ...current,
                        payoffSummary: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>相关角色（每行一个角色名，可选）</span>
                  <textarea
                    rows={2}
                    value={foreshadowingForm.characters}
                    onChange={(event) =>
                      setForeshadowingForm((current) => ({
                        ...current,
                        characters: event.target.value,
                      }))
                    }
                    placeholder="如：艾莉、老钟匠"
                  />
                </label>
                <footer className="character-editor-actions">
                  <button type="submit" disabled={savingForeshadowing}>
                    {savingForeshadowing ? "正在保存……" : "保存伏笔"}
                  </button>
                </footer>
              </form>
            ) : (
              <div className="plot-card-list">
                {visiblePlotThreads.map((thread) => {
                  const expanded = expandedForeshadowingId === thread.id;
                  return (
                    <article
                      key={thread.id}
                      className={`plot-card plot-thread-card status-${thread.status}${expanded ? " expanded" : ""}`}
                    >
                      <header
                        className="plot-card-head"
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        title={expanded ? "收起详情" : "展开详情"}
                        onClick={() =>
                          setExpandedForeshadowingId(expanded ? null : thread.id)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setExpandedForeshadowingId(
                              expanded ? null : thread.id,
                            );
                          }
                        }}
                      >
                        <span
                          className={`status-badge status-${thread.status}`}
                        >
                          {thread.status === "seeded"
                            ? "已埋入 · 等待回收"
                            : thread.status === "paid_off"
                              ? "已回收"
                              : "未埋入"}
                        </span>
                        {thread.status === "paid_off" ? (
                          <span className="lock-badge">已锁定</span>
                        ) : null}
                        <strong className="plot-card-id">{thread.id}</strong>
                        <span className="plot-expand-indicator">
                          {expanded ? "收起 ▲" : "展开 ▼"}
                        </span>
                      </header>
                      {thread.keywords.length > 0 ? (
                        <div className="plot-card-chips" aria-label="关键词">
                          {thread.keywords.map((keyword) => (
                            <span key={keyword} className="keyword-chip">
                              {keyword}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="plot-card-sections">
                        <div className="plot-card-section">
                          <span className="plot-card-section-label">
                            出现条件
                          </span>
                          <p>{thread.seedCondition || "（未填写）"}</p>
                        </div>
                        <div className="plot-card-section">
                          <span className="plot-card-section-label">
                            回收条件
                          </span>
                          <p>{thread.payoffCondition || "（未填写）"}</p>
                        </div>
                        <div className="plot-card-section">
                          <span className="plot-card-section-label">
                            回收概要
                          </span>
                          <p>{thread.payoffSummary || "（未填写）"}</p>
                        </div>
                        {thread.characters.length > 0 ? (
                          <div className="plot-card-section">
                            <span className="plot-card-section-label">
                              相关角色
                            </span>
                            <div className="plot-card-characters">
                              {thread.characters.map((character) => (
                                <span
                                  key={character}
                                  className="character-chip"
                                >
                                  {character}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <footer className="managed-character-actions">
                        {thread.status === "paid_off" ? (
                          <span className="story-task-locked">已锁定</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={savingForeshadowing}
                              onClick={() =>
                                startEditingForeshadowing(thread.id)
                              }
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              disabled={savingForeshadowing}
                              onClick={() =>
                                void deleteForeshadowing(thread.id)
                              }
                            >
                              删除
                            </button>
                          </>
                        )}
                      </footer>
                    </article>
                  );
                })}
                {plotThreads.length === 0 ? (
                  <div className="story-task-empty">
                    <strong>还没有伏笔</strong>
                    <p>伏笔可以跨章节保持目的，不会像剧情任务一样被短上下文遗忘。</p>
                  </div>
                ) : visiblePlotThreads.length === 0 ? (
                  <div className="story-task-empty">
                    <strong>该状态下暂无伏笔</strong>
                    <p>切换上方状态筛选，或新增一条伏笔。</p>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {triggerManagerOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingTrigger) {
              setTriggerManagerOpen(false);
              setEditingTriggerId(null);
            }
          }}
        >
          <section
            className="character-manager story-workbench story-module-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trigger-manager-title"
          >
            <header>
              <div>
                <p className="eyebrow">剧本工作台 · 剧情规划</p>
                <h2 id="trigger-manager-title">偏离触发器</h2>
                <p>
                  当条件满足时，后果会作为“意外阻碍”写入剧情，系统同时强制应用声明的状态影响（关系、属性、bad_end 标志）。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭偏离触发器管理"
                disabled={savingTrigger}
                onClick={() => {
                  setTriggerManagerOpen(false);
                  setEditingTriggerId(null);
                }}
              >
                ×
              </button>
            </header>

            <StoryWorkbenchNavigation
              active="triggers"
              disabled={savingTrigger}
              onSelect={selectStoryWorkbenchTab}
            />

            <div className="character-manager-toolbar plot-toolbar">
              <div className="plot-toolbar-left">
                <span>
                  {plotTriggers.filter((trigger) => trigger.status !== "fired").length}{" "}
                  个待触发 · {plotTriggers.length}/30 个已保存
                </span>
                <div
                  className="plot-filter-options"
                  role="group"
                  aria-label="按触发器状态筛选"
                >
                  <button
                    type="button"
                    className={triggerFilter === "all" ? "active" : ""}
                    onClick={() => setTriggerFilter("all")}
                  >
                    全部 {plotTriggers.length}
                  </button>
                  <button
                    type="button"
                    className={triggerFilter === "armed" ? "active" : ""}
                    onClick={() => setTriggerFilter("armed")}
                  >
                    待触发{" "}
                    {plotTriggers.filter((trigger) => trigger.status === "armed").length}
                  </button>
                  <button
                    type="button"
                    className={triggerFilter === "fired" ? "active" : ""}
                    onClick={() => setTriggerFilter("fired")}
                  >
                    已触发{" "}
                    {plotTriggers.filter((trigger) => trigger.status === "fired").length}
                  </button>
                </div>
              </div>
              <button
                type="button"
                disabled={savingTrigger || plotTriggers.length >= 30}
                onClick={startAddingTrigger}
              >
                ＋ 新增触发器
              </button>
            </div>

            {triggerError ? (
              <div className="character-manager-error" role="alert">
                {triggerError}
              </div>
            ) : null}

            {editingTriggerId ? (
              <form
                className="character-editor story-module-editor"
                onSubmit={submitTriggerForm}
              >
                <div className="character-editor-heading">
                  <div>
                    <small>
                      {editingTriggerId === "__new__"
                        ? "新增触发器"
                        : "编辑触发器"}
                    </small>
                    <h3>
                      {editingTriggerId === "__new__"
                        ? "建立新的意外阻碍"
                        : `编辑 ${triggerForm.id}`}
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={savingTrigger}
                    onClick={() => setEditingTriggerId(null)}
                  >
                    取消编辑
                  </button>
                </div>
                <label>
                  <span>触发器 ID</span>
                  <input
                    value={triggerForm.id}
                    disabled={editingTriggerId !== "__new__"}
                    maxLength={80}
                    onChange={(event) =>
                      setTriggerForm((current) => ({
                        ...current,
                        id: event.target.value,
                      }))
                    }
                    placeholder="如 ambush-den"
                  />
                </label>
                <label>
                  <span>触发条件（when）</span>
                  <textarea
                    rows={2}
                    value={triggerForm.when}
                    maxLength={1000}
                    onChange={(event) =>
                      setTriggerForm((current) => ({
                        ...current,
                        when: event.target.value,
                      }))
                    }
                    placeholder="如：主角弱小时强闯反派地盘"
                  />
                </label>
                <label>
                  <span>后果（consequence）</span>
                  <textarea
                    rows={3}
                    value={triggerForm.consequence}
                    maxLength={4000}
                    onChange={(event) =>
                      setTriggerForm((current) => ({
                        ...current,
                        consequence: event.target.value,
                      }))
                    }
                    placeholder="如：强大反派提前登场，主角陷入险境"
                  />
                </label>
                <label>
                  <span>
                    关系影响（每行：源角色名→目标角色名 维度 数值）
                  </span>
                  <textarea
                    rows={3}
                    value={triggerForm.relations
                      .map(
                        (relation) =>
                          `${relation.sourceCharacterName}→${relation.targetCharacterName} ${relation.dimension} ${relation.delta}`,
                      )
                      .join("\n")}
                    onChange={(event) => {
                      const lines = event.target.value.split(/\r?\n/);
                      const relations = lines
                        .map((line) => {
                          const match = line.match(
                            /^\s*(.+?)\s*→\s*(.+?)\s+([a-z_]+)\s+(-?\d+(?:\.\d+)?)\s*$/,
                          );
                          if (!match) return null;
                          return {
                            sourceCharacterName: match[1].trim(),
                            targetCharacterName: match[2].trim(),
                            dimension: match[3],
                            delta: match[4],
                          };
                        })
                        .filter(
                          (item): item is TriggerRelationFormState => item !== null,
                        );
                      setTriggerForm((current) => ({ ...current, relations }));
                    }}
                    placeholder={"正主→玩家 trust -20\n反派→玩家 hostility 30"}
                  />
                  <small>
                    维度：trust / affection / fear / hostility / respect；delta 范围 -100 到 100。
                  </small>
                </label>
                <label>
                  <span>标志（每行一个，目前支持 bad_end）</span>
                  <textarea
                    rows={1}
                    value={triggerForm.flags}
                    onChange={(event) =>
                      setTriggerForm((current) => ({
                        ...current,
                        flags: event.target.value,
                      }))
                    }
                    placeholder="bad_end"
                  />
                </label>
                <label>
                  <span>属性影响（每行：角色名:属性:数值）</span>
                  <textarea
                    rows={2}
                    value={triggerForm.attributes}
                    onChange={(event) =>
                      setTriggerForm((current) => ({
                        ...current,
                        attributes: event.target.value,
                      }))
                    }
                    placeholder="反派:力量:80"
                  />
                  <small>属性只能是力量/敏捷/感知/意志/魅力/智力/体质，数值 0-100。</small>
                </label>
                <label>
                  <span>期限（deadline，游戏内第几天前必须生效，可选）</span>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={triggerForm.deadlineDay}
                    onChange={(event) =>
                      setTriggerForm((current) => ({
                        ...current,
                        deadlineDay: event.target.value,
                      }))
                    }
                    placeholder="留空表示没有期限"
                  />
                </label>
                <footer className="character-editor-actions">
                  <button type="submit" disabled={savingTrigger}>
                    {savingTrigger ? "正在保存……" : "保存触发器"}
                  </button>
                </footer>
              </form>
            ) : (
              <div className="plot-card-list">
                {visiblePlotTriggers.map((trigger) => {
                  const expanded = expandedTriggerId === trigger.id;
                  const stateEffectsSummary = [
                    trigger.relationsCount > 0
                      ? `关系变化 ${trigger.relationsCount} 项`
                      : null,
                    trigger.attributesCount > 0
                      ? `属性调整 ${trigger.attributesCount} 项`
                      : null,
                    trigger.hasBadEnd ? "坏结局标志" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <article
                      key={trigger.id}
                      className={`plot-card plot-trigger-card status-${trigger.status}${expanded ? " expanded" : ""}${trigger.hasBadEnd ? " has-bad-end" : ""}`}
                    >
                      <header
                        className="plot-card-head"
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        title={expanded ? "收起详情" : "展开详情"}
                        onClick={() =>
                          setExpandedTriggerId(expanded ? null : trigger.id)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setExpandedTriggerId(expanded ? null : trigger.id);
                          }
                        }}
                      >
                        <span className={`status-badge status-${trigger.status}`}>
                          {trigger.status === "fired" ? "已触发" : "待触发"}
                        </span>
                        {trigger.status === "fired" ? (
                          <span className="lock-badge">已锁定</span>
                        ) : null}
                        {trigger.hasBadEnd ? (
                          <span className="bad-end-badge">坏结局</span>
                        ) : null}
                        <strong className="plot-card-id">{trigger.id}</strong>
                        <span className="plot-expand-indicator">
                          {expanded ? "收起 ▲" : "展开 ▼"}
                        </span>
                      </header>
                      <div className="plot-card-sections">
                        <div className="plot-card-section">
                          <span className="plot-card-section-label">
                            触发条件
                          </span>
                          <p>{trigger.when || "（未填写）"}</p>
                        </div>
                        <div className="plot-card-section">
                          <span className="plot-card-section-label">后果</span>
                          <p>{trigger.consequence || "（未填写）"}</p>
                        </div>
                        {trigger.deadlineDay !== null ||
                        stateEffectsSummary ? (
                          <div className="plot-card-meta">
                            {trigger.deadlineDay !== null ? (
                              <span className="plot-card-meta-item">
                                期限：第 {trigger.deadlineDay} 天前生效
                              </span>
                            ) : null}
                            {stateEffectsSummary ? (
                              <span className="plot-card-meta-item">
                                状态影响：{stateEffectsSummary}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <footer className="managed-character-actions">
                        {trigger.status === "fired" ? (
                          <span className="story-task-locked">已锁定</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={savingTrigger}
                              onClick={() => startEditingTrigger(trigger.id)}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              disabled={savingTrigger}
                              onClick={() => void deleteTrigger(trigger.id)}
                            >
                              删除
                            </button>
                          </>
                        )}
                      </footer>
                    </article>
                  );
                })}
                {plotTriggers.length === 0 ? (
                  <div className="story-task-empty">
                    <strong>还没有偏离触发器</strong>
                    <p>触发器让“偏离主线”有真实的代价，例如强闯反派地盘会提前招来强敌。</p>
                  </div>
                ) : visiblePlotTriggers.length === 0 ? (
                  <div className="story-task-empty">
                    <strong>该状态下暂无触发器</strong>
                    <p>切换上方状态筛选，或新增一条触发器。</p>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {worldBookManagerOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingWorldBook) {
              setWorldBookManagerOpen(false);
              setEditingWorldBookId(null);
            }
          }}
        >
          <section
            className="character-manager story-workbench world-book-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="world-book-manager-title"
          >
            <header>
              <div>
                <p className="eyebrow">剧本工作台 · 世界资料</p>
                <h2 id="world-book-manager-title">世界书管理</h2>
                <p>
                  基础层始终保留；玩家编辑会建立可撤销的修订层，剧情产生的长期事实保存在动态层。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭世界书管理"
                disabled={savingWorldBook}
                onClick={() => {
                  setWorldBookManagerOpen(false);
                  setEditingWorldBookId(null);
                }}
              >
                ×
              </button>
            </header>

            <StoryWorkbenchNavigation
              active="world_book"
              disabled={savingWorldBook}
              onSelect={selectStoryWorkbenchTab}
            />

            <div className="character-manager-toolbar world-book-toolbar">
              <span>
                {worldBookItems.filter((entry) => entry.isEffective).length} 条生效 · {worldBookItems.filter((entry) => entry.layer === "base" || entry.layer === "base_import").length} 条基础资料 · {worldBookItems.filter((entry) => entry.layer === "session_overlay").length} 条剧情动态
              </span>
              <button
                type="button"
                disabled={savingWorldBook}
                onClick={startAddingWorldBookEntry}
              >
                ＋ 新增世界事实
              </button>
            </div>

            <div className="world-book-filters">
              <label className="field">
                <span>搜索世界书</span>
                <input
                  value={worldBookSearch}
                  onChange={(event) => setWorldBookSearch(event.target.value)}
                  placeholder="名称、触发词或正文"
                />
              </label>
              <label className="field">
                <span>资料层级</span>
                <select
                  value={worldBookLayerFilter}
                  onChange={(event) => setWorldBookLayerFilter(event.target.value)}
                >
                  <option value="all">全部层级</option>
                  <option value="base">内置基础层</option>
                  <option value="base_import">导入基础层</option>
                  <option value="session_overlay">剧情动态层</option>
                  <option value="player">玩家新增层</option>
                  <option value="player_override">玩家修订层</option>
                </select>
              </label>
            </div>

            {worldBookManagerError ? (
              <div className="character-manager-error" role="alert">
                {worldBookManagerError}
              </div>
            ) : null}

            {editingWorldBookId ? (
              <form className="character-editor world-book-editor" onSubmit={submitWorldBookForm}>
                <div className="character-editor-heading">
                  <div>
                    <small>
                      {editingWorldBookId === "__new__" ? "新增条目" : "编辑条目"}
                    </small>
                    <h3>
                      {editingWorldBookId === "__new__"
                        ? "建立新的长期世界事实"
                        : `编辑 ${worldBookForm.comment || "世界书条目"}`}
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={savingWorldBook}
                    onClick={() => setEditingWorldBookId(null)}
                  >
                    取消
                  </button>
                </div>
                {editingWorldBookId !== "__new__" &&
                worldBookItems.find((entry) => entry.id === editingWorldBookId)
                  ?.layer.match(/^base/) ? (
                  <p className="world-book-layer-note">
                    这是不可变的基础条目。保存后会建立玩家修订层，原始内容仍可查看和恢复。
                  </p>
                ) : null}
                <div className="character-editor-grid">
                  <label className="field">
                    <span>条目名称 <em>可选</em></span>
                    <input
                      maxLength={300}
                      value={worldBookForm.comment}
                      onChange={(event) =>
                        setWorldBookForm((current) => ({
                          ...current,
                          comment: event.target.value,
                        }))
                      }
                      placeholder="便于玩家识别，不影响触发"
                    />
                  </label>
                  <label className="field">
                    <span>注入位置</span>
                    <select
                      value={worldBookForm.position}
                      onChange={(event) =>
                        setWorldBookForm((current) => ({
                          ...current,
                          position: event.target.value as "before_char" | "after_char",
                        }))
                      }
                    >
                      <option value="before_char">角色卡之前</option>
                      <option value="after_char">角色卡之后</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>主要触发词</span>
                    <textarea
                      rows={3}
                      value={worldBookForm.keys}
                      onChange={(event) =>
                        setWorldBookForm((current) => ({
                          ...current,
                          keys: event.target.value,
                        }))
                      }
                      placeholder="每行一个，或用逗号分隔；非常驻条目必填"
                    />
                  </label>
                  <label className="field">
                    <span>次要触发词 <em>可选</em></span>
                    <textarea
                      rows={3}
                      value={worldBookForm.secondaryKeys}
                      onChange={(event) =>
                        setWorldBookForm((current) => ({
                          ...current,
                          secondaryKeys: event.target.value,
                        }))
                      }
                      placeholder="选择性匹配时用于缩小触发范围"
                    />
                  </label>
                  <label className="field full-width-field">
                    <span>世界事实正文</span>
                    <textarea
                      required
                      rows={6}
                      maxLength={12000}
                      value={worldBookForm.content}
                      onChange={(event) =>
                        setWorldBookForm((current) => ({
                          ...current,
                          content: event.target.value,
                        }))
                      }
                      placeholder="只写会长期影响后续场景理解的事实。"
                    />
                  </label>
                  <div className="world-book-toggle-grid full-width-field">
                    <label>
                      <input
                        type="checkbox"
                        checked={worldBookForm.enabled}
                        onChange={(event) =>
                          setWorldBookForm((current) => ({
                            ...current,
                            enabled: event.target.checked,
                          }))
                        }
                      />
                      保存后启用
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={worldBookForm.constant}
                        onChange={(event) =>
                          setWorldBookForm((current) => ({
                            ...current,
                            constant: event.target.checked,
                          }))
                        }
                      />
                      常驻注入
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={worldBookForm.selective}
                        onChange={(event) =>
                          setWorldBookForm((current) => ({
                            ...current,
                            selective: event.target.checked,
                          }))
                        }
                      />
                      选择性匹配
                    </label>
                  </div>
                  <label className="field">
                    <span>排序值</span>
                    <input
                      type="number"
                      min={-10000}
                      max={10000}
                      value={worldBookForm.order}
                      onChange={(event) =>
                        setWorldBookForm((current) => ({
                          ...current,
                          order: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>触发概率（%）</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={worldBookForm.probability}
                      onChange={(event) =>
                        setWorldBookForm((current) => ({
                          ...current,
                          probability: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>扫描深度</span>
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={worldBookForm.depth}
                      onChange={(event) =>
                        setWorldBookForm((current) => ({
                          ...current,
                          depth: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label className="field full-width-field">
                    <span>兼容扩展字段 <em>JSON 对象</em></span>
                    <textarea
                      rows={3}
                      value={worldBookForm.extensions}
                      onChange={(event) =>
                        setWorldBookForm((current) => ({
                          ...current,
                          extensions: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <footer>
                  <p>保存后从下一次 AI 生成开始生效，不改写历史回合。</p>
                  <button type="submit" disabled={savingWorldBook}>
                    {savingWorldBook ? "正在保存……" : "保存世界书条目"}
                  </button>
                </footer>
              </form>
            ) : null}

            <div className="world-book-list">
              {filteredWorldBookItems.map((entry) => (
                <article
                  className={`${entry.isEffective ? "effective" : "inactive"} ${entry.removedByPlayer ? "removed" : ""}`}
                  key={entry.id}
                >
                  <header>
                    <div>
                      <div className="world-book-entry-title">
                        <strong>{entry.title}</strong>
                        <small>{entry.layerLabel}</small>
                        {entry.isEffective ? <i>当前生效</i> : null}
                        {entry.removedByPlayer ? <i>玩家已移除</i> : null}
                      </div>
                      <p>{entry.content}</p>
                    </div>
                  </header>
                  <div className="world-book-entry-meta">
                    <span>
                      {entry.record.state.constant === true
                        ? "常驻"
                        : `触发词：${entry.keys.join("、") || "未设置"}`}
                    </span>
                    <span>
                      {entry.sourceBookName ? `来源：${entry.sourceBookName}` : `版本 ${entry.record.version}`}
                    </span>
                  </div>
                  {entry.baseRecord ? (
                    <details className="world-book-diff">
                      <summary>
                        与基础层比较 · {entry.changedFields.length} 项差异
                      </summary>
                      {entry.changedFields.length > 0 ? (
                        <ul>
                          {entry.changedFields.map((field) => (
                            <li key={field}>
                              <strong>{fieldLabels[field] ?? field}</strong>
                              <span>
                                基础：{shortValue(entry.baseRecord!.state[field] ?? null, 100)}
                              </span>
                              <span>
                                当前：{shortValue(entry.record.state[field] ?? null, 100)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>字段内容与基础版本一致。</p>
                      )}
                    </details>
                  ) : null}
                  <footer>
                    <button
                      type="button"
                      disabled={savingWorldBook || !entry.record.isActive}
                      onClick={() => startEditingWorldBookEntry(entry.id)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={savingWorldBook || !entry.record.isActive}
                      onClick={() => void setWorldBookEnabled(entry.id, !entry.enabled)}
                    >
                      {entry.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      className="deactivate"
                      type="button"
                      disabled={savingWorldBook || !entry.record.isActive}
                      onClick={() => void removeWorldBookEntry(entry.id, entry.title)}
                    >
                      移除
                    </button>
                    {entry.shadowsEntryId && entry.record.isActive ? (
                      <button
                        className="reactivate"
                        type="button"
                        disabled={savingWorldBook}
                        onClick={() => void restoreWorldBookBase(entry.id, entry.title)}
                      >
                        恢复基础版本
                      </button>
                    ) : null}
                  </footer>
                </article>
              ))}
              {filteredWorldBookItems.length === 0 ? (
                <div className="source-manager-empty">
                  <strong>没有符合条件的世界书条目</strong>
                  <p>可以调整搜索与层级筛选，或新增一条长期世界事实。</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {characterManagerOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingCharacter) {
              setCharacterManagerOpen(false);
              setEditingCharacterId(null);
            }
          }}
        >          <section
            className="character-manager story-workbench"
            role="dialog"
            aria-modal="true"
            aria-labelledby="character-manager-title"
          >
            <header>
              <div>
                <p className="eyebrow">剧本工作台 · 角色卡</p>
                <h2 id="character-manager-title">人物管理</h2>
                <p>
                  修改会立即影响后续提示词，但不会改写过去的剧情，也不会消耗 API 额度。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭人物管理"
                disabled={savingCharacter}
                onClick={() => {
                  setCharacterManagerOpen(false);
                  setEditingCharacterId(null);
                }}
              >
                ×
              </button>
            </header>

            <StoryWorkbenchNavigation
              active="characters"
              disabled={savingCharacter}
              onSelect={selectStoryWorkbenchTab}
            />

            <div className="character-manager-toolbar">
              <span>
                {manageableCharacters.filter((character) => character.isActive).length} 名启用 · {manageableCharacters.length} 名已保存
              </span>
              <button
                type="button"
                disabled={savingCharacter}
                onClick={startAddingCharacter}
              >
                ＋ 新增 AI 角色
              </button>
            </div>

            <section className="character-relationships" aria-labelledby="character-relationships-title">
              <header>
                <div>
                  <strong id="character-relationships-title">角色关系</strong>
                  <small>当前各角色之间的信任、好感、恐惧、敌意与敬意（-100 ~ 100）</small>
                </div>
              </header>
              {mergedRelationships.length === 0 ? (
                <p>还没有建立任何关系记录；关系会在剧情推进或剧本包初始化时建立。</p>
              ) : (
                <ul>
                  {mergedRelationships.map((relationship) => (
                    <li key={relationship.key}>
                      <div className="relationship-heading">
                        <strong>
                          {characterNameById.get(relationship.sourceId) ?? relationship.sourceId}
                          <span aria-hidden="true">↔</span>
                          {characterNameById.get(relationship.targetId) ?? relationship.targetId}
                        </strong>
                        {relationship.summary ? (
                          <small>{relationship.summary}</small>
                        ) : null}
                      </div>
                      <div className="relationship-dims">
                        <span>
                          信任 {relationship.trust.source}
                          {relationship.symmetric
                            ? ` / ${relationship.trust.target}`
                            : ""}
                        </span>
                        <span>
                          好感 {relationship.affinity.source}
                          {relationship.symmetric
                            ? ` / ${relationship.affinity.target}`
                            : ""}
                        </span>
                        <span>
                          恐惧 {relationship.fear.source}
                          {relationship.symmetric
                            ? ` / ${relationship.fear.target}`
                            : ""}
                        </span>
                        <span>
                          敌意 {relationship.hostility.source}
                          {relationship.symmetric
                            ? ` / ${relationship.hostility.target}`
                            : ""}
                        </span>
                        <span>
                          敬意 {relationship.respect.source}
                          {relationship.symmetric
                            ? ` / ${relationship.respect.target}`
                            : ""}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {characterManagerError ? (
              <div className="character-manager-error" role="alert">
                {characterManagerError}
              </div>
            ) : null}

            {editingCharacterId ? (
              <form className="character-editor" onSubmit={submitCharacterForm}>
                <div className="character-editor-heading">
                  <div>
                    <small>
                      {editingCharacterId === "__new__" ? "新增人物" : "编辑人物"}
                    </small>
                    <h3>
                      {editingCharacterId === "__new__"
                        ? "建立新的 AI 角色卡"
                        : `编辑 ${characterForm.name}`}
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={savingCharacter}
                    onClick={() => setEditingCharacterId(null)}
                  >
                    取消
                  </button>
                </div>
                <div className="character-editor-grid">
                  <label className="field">
                    <span>姓名</span>
                    <input
                      required
                      maxLength={80}
                      value={characterForm.name}
                      onChange={(event) =>
                        setCharacterForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="角色姓名"
                    />
                  </label>
                  <label className="field">
                    <span>身份与背景</span>
                    <input
                      required
                      maxLength={2000}
                      value={characterForm.role}
                      onChange={(event) =>
                        setCharacterForm((current) => ({
                          ...current,
                          role: event.target.value,
                        }))
                      }
                      placeholder="角色在世界中的身份、经历和目标"
                    />
                  </label>
                  <label className="field full-width-field">
                    <span>性格与行为边界</span>
                    <textarea
                      required
                      rows={4}
                      maxLength={2000}
                      value={characterForm.personality}
                      onChange={(event) =>
                        setCharacterForm((current) => ({
                          ...current,
                          personality: event.target.value,
                        }))
                      }
                      placeholder="性格、说话方式、价值观、秘密和禁忌……"
                    />
                  </label>
                  <label className="field full-width-field">
                    <span>角色卡首句 <em>可选</em></span>
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={characterForm.firstMessage}
                      onChange={(event) =>
                        setCharacterForm((current) => ({
                          ...current,
                          firstMessage: event.target.value,
                        }))
                      }
                      placeholder="用于角色卡资料，不会自动插入已经发生的剧情。"
                    />
                  </label>
                </div>
                <footer>
                  <p>保存后从下一次 AI 生成开始生效。</p>
                  <button type="submit" disabled={savingCharacter}>
                    {savingCharacter ? "正在保存……" : "保存人物资料"}
                  </button>
                </footer>
              </form>
            ) : null}

            <div className="managed-character-list">
              {manageableCharacters.map((character) => (
                <article
                  className={!character.isActive ? "inactive" : ""}
                  key={character.id}
                >
                  <div className="managed-character-copy">
                    <span className="cast-monogram">AI</span>
                    <div>
                      <div className="managed-character-name">
                        <strong>{character.name}</strong>
                        <small>
                          {!character.isActive
                            ? "已停用"
                            : character.present
                              ? "当前在场"
                              : "暂时离场"}
                          {character.restriction
                            ? ` · 行动受限（${
                                restrictionKindLabels[character.restriction.kind] ??
                                character.restriction.kind
                              }）`
                            : ""}
                        </small>
                      </div>
                      <p>{character.description}</p>
                      {character.restriction ? (
                        <p className="managed-character-restriction">
                          受限原因：{character.restriction.summary}
                        </p>
                      ) : null}
                      {character.statuses.length > 0 ? (
                        <ul className="managed-character-statuses">
                          {character.statuses.map((status) => (
                            <li
                              className={
                                status.kind === "debuff" ? "debuff" : "buff"
                              }
                              key={status.id}
                            >
                              <span>
                                {status.kind === "debuff" ? "减益" : "增益"}
                              </span>
                              <strong>{status.name}</strong>
                              <em>{status.description}</em>
                              {status.hidden ? <small>未察觉</small> : null}
                              {typeof status.expiresAtDay === "number" ? (
                                <small>第 {status.expiresAtDay} 日到期</small>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                  {restrictionEditorCharacterId === character.id ? (
                    <div className="managed-character-restriction-editor">
                      <select
                        value={restrictionForm.kind}
                        disabled={savingCharacter}
                        onChange={(event) =>
                          setRestrictionForm((current) => ({
                            ...current,
                            kind: event.target.value,
                          }))
                        }
                      >
                        {Object.entries(restrictionKindLabels).map(
                          ([kind, label]) => (
                            <option key={kind} value={kind}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                      <input
                        maxLength={200}
                        value={restrictionForm.summary}
                        disabled={savingCharacter}
                        placeholder="受限原因（如：被囚禁在地牢、已被杀死）"
                        onChange={(event) =>
                          setRestrictionForm((current) => ({
                            ...current,
                            summary: event.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        disabled={
                          savingCharacter || !restrictionForm.summary.trim()
                        }
                        onClick={() =>
                          void setCharacterRestriction(character.id, {
                            kind: restrictionForm.kind,
                            summary: restrictionForm.summary.trim(),
                          })
                        }
                      >
                        保存受限
                      </button>
                      <button
                        type="button"
                        disabled={savingCharacter}
                        onClick={() => setRestrictionEditorCharacterId(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : null}
                  {statusEditorCharacterId === character.id ? (
                    <div className="managed-character-status-editor">
                      <textarea
                        rows={5}
                        value={statusEditorText}
                        disabled={savingCharacter}
                        placeholder='[{"id":"wound-1","name":"受伤","kind":"debuff","description":"左臂刀伤未愈合，行动受影响","expiresAtDay":5}]'
                        onChange={(event) =>
                          setStatusEditorText(event.target.value)
                        }
                      />
                      <small>
                        JSON 数组，保存时完整替换当前词条；hidden:true 表示角色尚未察觉；传
                        null 可清除全部。
                      </small>
                      {statusEditorError ? (
                        <p className="character-manager-error" role="alert">
                          {statusEditorError}
                        </p>
                      ) : null}
                      <div className="managed-character-status-editor-actions">
                        <button
                          type="button"
                          disabled={savingCharacter}
                          onClick={() =>
                            void submitCharacterStatuses(character.id)
                          }
                        >
                          保存状态
                        </button>
                        <button
                          type="button"
                          disabled={savingCharacter}
                          onClick={() => void clearCharacterStatuses(character.id)}
                        >
                          清除全部
                        </button>
                        <button
                          type="button"
                          disabled={savingCharacter}
                          onClick={() => {
                            setStatusEditorCharacterId(null);
                            setStatusEditorError("");
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="managed-character-actions">
                    <button
                      type="button"
                      disabled={savingCharacter}
                      onClick={() => startEditingCharacter(character.id)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={savingCharacter || !character.isActive}
                      onClick={() =>
                        void setCharacterPresence(character.id, !character.present)
                      }
                    >
                      {character.present ? "暂时离场" : "重新登场"}
                    </button>
                    <button
                      type="button"
                      disabled={savingCharacter || !character.isActive}
                      onClick={() =>
                        character.restriction
                          ? void setCharacterRestriction(character.id, null)
                          : startRestrictionEditor(character.id)
                      }
                    >
                      {character.restriction ? "解除受限" : "设置受限"}
                    </button>
                    <button
                      type="button"
                      disabled={savingCharacter || !character.isActive}
                      onClick={() => startStatusEditor(character.id)}
                    >
                      {character.statuses.length > 0 ? "编辑状态" : "添加状态"}
                    </button>
                    <button
                      className={character.isActive ? "deactivate" : "reactivate"}
                      type="button"
                      disabled={savingCharacter}
                      onClick={() =>
                        void setCharacterActive(character.id, !character.isActive)
                      }
                    >
                      {character.isActive ? "停用" : "重新启用"}
                    </button>
                  </div>
                </article>
              ))}
              {manageableCharacters.length === 0 ? (
                <p className="managed-character-empty">
                  当前没有 AI 角色，可以先建立一张新的角色卡。
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {storyModuleManagerOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingStoryModule) {
              setStoryModuleManagerOpen(false);
              setEditingStoryModuleId(null);
            }
          }}
        >
          <section
            className="character-manager story-workbench story-module-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="story-module-manager-title"
          >
            <header>
              <div>
                <p className="eyebrow">剧本工作台 · 剧情规划</p>
                <h2 id="story-module-manager-title">剧情任务链</h2>
                <p>
                  新增或修改未完成任务，并通过前置关系安排接续顺序。修改从下一次生成开始生效，不会调用 AI 模型，也不会改写过去剧情。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭剧情任务管理"
                disabled={savingStoryModule}
                onClick={() => {
                  setStoryModuleManagerOpen(false);
                  setEditingStoryModuleId(null);
                }}
              >
                ×
              </button>
            </header>

            <StoryWorkbenchNavigation
              active="story_modules"
              disabled={savingStoryModule}
              onSelect={selectStoryWorkbenchTab}
            />

            <div className="character-manager-toolbar">
              <span>
                {storyModules.filter((module) => module.isEnabled).length} 个启用 · {storyModules.filter((module) => module.status === "completed").length} 个已完成 · {storyModules.length}/30 个已保存
              </span>
              <button
                type="button"
                disabled={savingStoryModule || storyModules.length >= 30}
                onClick={startAddingStoryModule}
              >
                ＋ 新增剧情任务
              </button>
            </div>

            {storyModuleManagerError ? (
              <div className="character-manager-error" role="alert">
                {storyModuleManagerError}
              </div>
            ) : null}

            {editingStoryModuleId ? (
              <form
                className="character-editor story-module-editor"
                onSubmit={submitStoryModuleForm}
              >
                <div className="character-editor-heading">
                  <div>
                    <small>
                      {editingStoryModuleId === "__new__" ? "新增任务" : "编辑任务"}
                    </small>
                    <h3>
                      {editingStoryModuleId === "__new__"
                        ? "建立新的预埋剧情任务"
                        : `编辑 ${storyModuleForm.title}`}
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={savingStoryModule}
                    onClick={() => setEditingStoryModuleId(null)}
                  >
                    取消
                  </button>
                </div>
                <div className="character-editor-grid">
                  <label className="field">
                    <span>稳定任务 ID</span>
                    <input
                      required
                      maxLength={120}
                      disabled={
                        savingStoryModule || editingStoryModuleId !== "__new__"
                      }
                      value={storyModuleForm.id}
                      onChange={(event) =>
                        setStoryModuleForm((current) => ({
                          ...current,
                          id: event.target.value,
                        }))
                      }
                      placeholder="例如：寻找失踪证人"
                    />
                  </label>
                  <label className="field">
                    <span>任务标题</span>
                    <input
                      required
                      maxLength={120}
                      disabled={savingStoryModule}
                      value={storyModuleForm.title}
                      onChange={(event) =>
                        setStoryModuleForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      placeholder="供玩家查看的简短标题"
                    />
                  </label>
                  <label className="field full-width-field">
                    <span>剧情目标</span>
                    <textarea
                      required
                      rows={3}
                      maxLength={1000}
                      disabled={savingStoryModule}
                      value={storyModuleForm.objective}
                      onChange={(event) =>
                        setStoryModuleForm((current) => ({
                          ...current,
                          objective: event.target.value,
                        }))
                      }
                      placeholder="描述这一阶段需要推动和完成的事情。"
                    />
                  </label>
                  <label className="field">
                    <span>完成条件 <em>每行一项</em></span>
                    <textarea
                      required
                      rows={5}
                      maxLength={6000}
                      disabled={savingStoryModule}
                      value={storyModuleForm.completionCriteria}
                      onChange={(event) =>
                        setStoryModuleForm((current) => ({
                          ...current,
                          completionCriteria: event.target.value,
                        }))
                      }
                      placeholder={"取得可核验的证据\n确认幕后人物的身份"}
                    />
                  </label>
                  <label className="field">
                    <span>进入条件 <em>可选，每行一项</em></span>
                    <textarea
                      rows={5}
                      maxLength={6000}
                      disabled={savingStoryModule}
                      value={storyModuleForm.activationConditions}
                      onChange={(event) =>
                        setStoryModuleForm((current) => ({
                          ...current,
                          activationConditions: event.target.value,
                        }))
                      }
                      placeholder={"关键角色仍然存活\n玩家尚未离开当前地区"}
                    />
                  </label>
                  <fieldset className="location-roster-field story-prerequisite-field full-width-field">
                    <legend>前置任务</legend>
                    <p>所有勾选任务完成后，本任务才可能自动接续；系统会阻止循环依赖。</p>
                    <div>
                      {storyModules
                        .filter((module) => module.id !== storyModuleForm.id)
                        .map((module) => {
                          const checked = storyModuleForm.prerequisiteModuleIds.includes(
                            module.id,
                          );
                          return (
                            <label key={module.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={savingStoryModule}
                                onChange={() =>
                                  setStoryModuleForm((current) => ({
                                    ...current,
                                    prerequisiteModuleIds: checked
                                      ? current.prerequisiteModuleIds.filter(
                                          (moduleId) => moduleId !== module.id,
                                        )
                                      : [...current.prerequisiteModuleIds, module.id],
                                  }))
                                }
                              />
                              <span>{module.title}</span>
                            </label>
                          );
                        })}
                      {storyModules.filter(
                        (module) => module.id !== storyModuleForm.id,
                      ).length === 0 ? <small>当前没有可选的前置任务。</small> : null}
                    </div>
                  </fieldset>
                  <label className="field full-width-field">
                    <span>连续性说明 <em>可选</em></span>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      disabled={savingStoryModule}
                      value={storyModuleForm.continuityNotes}
                      onChange={(event) =>
                        setStoryModuleForm((current) => ({
                          ...current,
                          continuityNotes: event.target.value,
                        }))
                      }
                      placeholder="说明该任务如何承接前序剧情，以及哪些偏离仍可接受。"
                    />
                  </label>
                  <label className="story-module-auto full-width-field">
                    <input
                      type="checkbox"
                      checked={storyModuleForm.autoContinue}
                      disabled={savingStoryModule}
                      onChange={(event) =>
                        setStoryModuleForm((current) => ({
                          ...current,
                          autoContinue: event.target.checked,
                        }))
                      }
                    />
                    <span>条件满足且剧情未偏离时，允许 AI 自动接续此任务</span>
                  </label>
                </div>
                <footer>
                  <p>任务 ID 保存后不可修改；已完成任务会自动锁定。</p>
                  <button type="submit" disabled={savingStoryModule}>
                    {savingStoryModule ? "正在保存……" : "保存剧情任务"}
                  </button>
                </footer>
              </form>
            ) : null}

            <div className="story-task-tree" aria-label="剧情任务依赖树">
              {storyModules.map((module) => {
                const immutable =
                  module.status === "completed" ||
                  module.status === "diverged" ||
                  module.status === "expired";
                const prerequisiteNames = module.prerequisiteModuleIds
                  .map((moduleId) => storyModuleById.get(moduleId)?.title ?? moduleId)
                  .join("、");
                const statusLabel = !module.isEnabled
                  ? "已暂停"
                  : ({
                      active: "当前任务",
                      queued: "等待接续",
                      completed: "已完成",
                      diverged: "剧情已偏离",
                      expired: "已过期",
                    }[module.status] ?? module.status);
                return (
                  <article
                    className={`${!module.isEnabled ? "inactive" : ""} module-${module.status}`}
                    key={module.id}
                    style={{ marginLeft: Math.min(module.depth, 5) * 26 }}
                  >
                    <div className="story-task-rail" aria-hidden="true">
                      <span />
                    </div>
                    <div className="story-task-copy">
                      <div className="managed-character-name">
                        <strong>{module.title}</strong>
                        <small>{statusLabel}</small>
                      </div>
                      <p>{module.objective}</p>
                      <small>
                        {prerequisiteNames
                          ? `前置：${prerequisiteNames}`
                          : "根任务 · 无前置任务"}
                        {module.autoContinue ? " · 可自动接续" : " · 仅手动规划"}
                      </small>
                    </div>
                    <div className="managed-character-actions">
                      <button
                        type="button"
                        disabled={savingStoryModule || immutable}
                        onClick={() => startEditingStoryModule(module.id)}
                      >
                        {immutable ? "已锁定" : "编辑"}
                      </button>
                      <button
                        className={module.isEnabled ? "deactivate" : "reactivate"}
                        type="button"
                        disabled={
                          savingStoryModule || immutable || module.status === "active"
                        }
                        onClick={() =>
                          void setStoryModuleActive(module.id, !module.isEnabled)
                        }
                      >
                        {module.status === "active"
                          ? "进行中"
                          : module.isEnabled
                            ? "暂停"
                            : "重新启用"}
                      </button>
                    </div>
                  </article>
                );
              })}
              {storyModules.length === 0 ? (
                <div className="story-task-empty">
                  <strong>当前剧本还没有预埋任务</strong>
                  <p>新增第一个任务后，剧本会自动切换为任务链模式。</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {locationManagerOpen ? (
        <div
          className="character-manager-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingLocation) {
              setLocationManagerOpen(false);
              setEditingLocationId(null);
            }
          }}
        >
          <section
            className="character-manager story-workbench location-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="location-manager-title"
          >
            <header>
              <div>
                <p className="eyebrow">剧本工作台 · 场景与阵容</p>
                <h2 id="location-manager-title">地点管理</h2>
                <p>
                  切换地点会按默认登场人物自动同步进出场；剧情生成也会根据实际事件自动更新当前位置和阵容。
                </p>
              </div>
              <button
                className="character-manager-close"
                type="button"
                aria-label="关闭地点管理"
                disabled={savingLocation}
                onClick={() => {
                  setLocationManagerOpen(false);
                  setEditingLocationId(null);
                }}
              >
                ×
              </button>
            </header>

            <StoryWorkbenchNavigation
              active="locations"
              disabled={savingLocation}
              onSelect={selectStoryWorkbenchTab}
            />

            <div className="character-manager-toolbar">
              <span>
                {locations.filter((location) => location.isActive).length} 个可用 · {locations.length} 个已保存
              </span>
              <button
                type="button"
                disabled={savingLocation}
                onClick={startAddingLocation}
              >
                ＋ 新增地点
              </button>
            </div>

            {locationManagerError ? (
              <div className="character-manager-error" role="alert">
                {locationManagerError}
              </div>
            ) : null}

            {editingLocationId ? (
              <form
                className="character-editor location-editor"
                onSubmit={submitLocationForm}
              >
                <div className="character-editor-heading">
                  <div>
                    <small>
                      {editingLocationId === "__new__" ? "新增地点" : "编辑地点"}
                    </small>
                    <h3>
                      {editingLocationId === "__new__"
                        ? "建立新的地点资料"
                        : `编辑 ${locationForm.name}`}
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={savingLocation}
                    onClick={() => setEditingLocationId(null)}
                  >
                    取消
                  </button>
                </div>
                <div className="character-editor-grid">
                  <label className="field">
                    <span>地点名称</span>
                    <input
                      required
                      maxLength={80}
                      value={locationForm.name}
                      onChange={(event) =>
                        setLocationForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="例如：北门集市"
                    />
                  </label>
                  <label className="field full-width-field">
                    <span>地点描述</span>
                    <textarea
                      required
                      rows={4}
                      maxLength={2000}
                      value={locationForm.description}
                      onChange={(event) =>
                        setLocationForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      placeholder="记录环境、用途、危险和重要特征……"
                    />
                  </label>
                  <fieldset className="location-roster-field full-width-field">
                    <legend>移动到这里时默认登场的 AI 人物</legend>
                    <p>玩家角色始终随当前位置移动；剧情仍可按事件临时增减人物。</p>
                    <div>
                      {manageableCharacters
                        .filter((character) => character.isActive)
                        .map((character) => {
                          const checked = locationForm.defaultCharacterIds.includes(
                            character.id,
                          );
                          return (
                            <label key={character.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setLocationForm((current) => ({
                                    ...current,
                                    defaultCharacterIds: checked
                                      ? current.defaultCharacterIds.filter(
                                          (characterId) =>
                                            characterId !== character.id,
                                        )
                                      : [
                                          ...current.defaultCharacterIds,
                                          character.id,
                                        ],
                                  }))
                                }
                              />
                              <span>{character.name}</span>
                            </label>
                          );
                        })}
                      {manageableCharacters.every(
                        (character) => !character.isActive,
                      ) ? <small>暂无启用中的 AI 人物。</small> : null}
                    </div>
                  </fieldset>
                </div>
                <footer>
                  <p>编辑当前位置时，默认登场阵容会立即重新同步。</p>
                  <button type="submit" disabled={savingLocation}>
                    {savingLocation ? "正在保存……" : "保存地点资料"}
                  </button>
                </footer>
              </form>
            ) : null}

            <div className="managed-character-list managed-location-list">
              {locations.map((location) => {
                const isCurrent = location.id === currentLocationId;
                const rosterNames = location.defaultCharacterIds
                  .map(
                    (characterId) =>
                      characterNameById.get(characterId) ?? "已停用人物",
                  )
                  .join("、");
                return (
                  <article
                    className={!location.isActive ? "inactive" : ""}
                    key={location.id}
                  >
                    <div className="managed-character-copy managed-location-copy">
                      <span className="location-marker">⌖</span>
                      <div>
                        <div className="managed-character-name">
                          <strong>{location.name}</strong>
                          <small>
                            {isCurrent
                              ? "当前位置"
                              : !location.isActive
                                ? "已停用"
                                : location.source === "story"
                                  ? "剧情发现"
                                  : "可前往"}
                          </small>
                        </div>
                        <p>{location.description}</p>
                        <small className="location-roster-summary">
                          默认登场：{rosterNames || "仅玩家角色"}
                        </small>
                        {(() => {
                          const presentHere =
                            charactersByLocation.get(location.id) ?? [];
                          if (presentHere.length === 0) return null;
                          return (
                            <small className="location-roster-summary">
                              当前在此：{presentHere.join("、")}
                            </small>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="managed-character-actions">
                      <button
                        type="button"
                        disabled={savingLocation}
                        onClick={() => startEditingLocation(location.id)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        disabled={savingLocation || !location.isActive || isCurrent}
                        onClick={() => void setCurrentLocation(location.id)}
                      >
                        {isCurrent ? "当前位置" : "移动到这里"}
                      </button>
                      <button
                        className={location.isActive ? "deactivate" : "reactivate"}
                        type="button"
                        disabled={savingLocation || isCurrent}
                        onClick={() =>
                          void setLocationActive(location.id, !location.isActive)
                        }
                      >
                        {location.isActive ? "停用" : "重新启用"}
                      </button>
                    </div>
                  </article>
                );
              })}
              {locations.length === 0 ? (
                <p className="managed-character-empty">
                  尚未建立地点资料，可以新增地点；下一次剧情发生场景移动时也会自动创建。
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
