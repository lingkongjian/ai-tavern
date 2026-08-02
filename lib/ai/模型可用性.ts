import {
  AiRequestError,
  AiResponseError,
  getAiConnectionConfig,
  getAiProviderConfig,
  testAiConnection,
  type AiProviderConfigInput,
  type AiProviderId,
} from "./模型供应商.ts";

export type AiModelCompatibility =
  | "chat_completions"
  | "unsupported_protocol"
  | "unknown";

export interface AiAvailableModel {
  id: string;
  name: string;
  ownedBy?: string;
  compatibility: AiModelCompatibility;
  compatibilityReason: string;
}

export interface AiModelCatalogResult {
  provider: AiProviderId;
  providerLabel: string;
  fetchedAt: string;
  models: AiAvailableModel[];
}

export type AiAuditCheckStatus =
  | "passed"
  | "warning"
  | "failed"
  | "skipped";

export interface AiAuditCheck {
  id: "configuration" | "model_catalog" | "model_selection" | "completion_json";
  label: string;
  status: AiAuditCheckStatus;
  detail: string;
  durationMs?: number;
}

export interface AiProviderAuditResult {
  ok: boolean;
  checkedAt: string;
  provider: AiProviderId;
  selectedModel: string;
  returnedModel?: string;
  models: AiAvailableModel[];
  checks: AiAuditCheck[];
}

export interface AiAvailabilityOptions {
  config: AiProviderConfigInput;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

const OPENCODE_GO_CHAT_COMPLETIONS_MODELS = new Set([
  "grok-4.5",
  "glm-5.2",
  "glm-5.1",
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "hy3",
]);

const OPENCODE_GO_OTHER_PROTOCOL_MODELS = new Set([
  "gpt-5.6-luna",
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
]);

const MODEL_CATALOG_MAX_BYTES = 5 * 1_024 * 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function modelCatalogEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/$/, "");
  if (/\/(?:chat\/completions|messages|responses)$/.test(pathname)) {
    url.pathname = pathname.replace(
      /\/(?:chat\/completions|messages|responses)$/,
      "/models",
    );
  } else {
    url.pathname = `${pathname}/models`;
  }
  return url.toString();
}

function modelCompatibility(
  provider: AiProviderId,
  id: string,
  metadata: Record<string, unknown>,
) {
  const protocolHints = [
    metadata.endpoint,
    metadata.api,
    metadata.protocol,
    metadata.type,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/chat[\s_/-]*completions/.test(protocolHints)) {
    return {
      compatibility: "chat_completions" as const,
      compatibilityReason: "目录元数据标记为 Chat Completions。",
    };
  }
  if (/(?:^|[\s/])(?:messages|responses)(?:$|[\s/])/.test(protocolHints)) {
    return {
      compatibility: "unsupported_protocol" as const,
      compatibilityReason: "该模型使用 Messages 或 Responses 协议，当前酒馆尚未适配。",
    };
  }
  if (provider === "opencode_go") {
    if (OPENCODE_GO_CHAT_COMPLETIONS_MODELS.has(id)) {
      return {
        compatibility: "chat_completions" as const,
        compatibilityReason: "OpenCode Go 官方将该模型列为 Chat Completions。",
      };
    }
    if (OPENCODE_GO_OTHER_PROTOCOL_MODELS.has(id)) {
      return {
        compatibility: "unsupported_protocol" as const,
        compatibilityReason: "OpenCode Go 官方为该模型使用其他协议，当前酒馆尚未适配。",
      };
    }
  }
  return {
    compatibility: "unknown" as const,
    compatibilityReason: "模型目录没有提供足够的协议信息，需要执行可用性审核。",
  };
}

function parseModels(body: unknown, provider: AiProviderId) {
  const source = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.models)
        ? body.models
        : null;
  if (!source) {
    throw new AiResponseError("模型目录响应不包含可识别的 data 或 models 数组。");
  }

  const models = new Map<string, AiAvailableModel>();
  for (const item of source.slice(0, 5_000)) {
    const metadata = typeof item === "string" ? { id: item } : item;
    if (!isRecord(metadata)) continue;
    const id = typeof metadata.id === "string" ? metadata.id.trim() : "";
    if (!id || id.length > 200 || models.has(id)) continue;
    const nameCandidate =
      typeof metadata.name === "string"
        ? metadata.name
        : typeof metadata.display_name === "string"
          ? metadata.display_name
          : id;
    const ownedBy =
      typeof metadata.owned_by === "string"
        ? metadata.owned_by
        : typeof metadata.ownedBy === "string"
          ? metadata.ownedBy
          : undefined;
    models.set(id, {
      id,
      name: nameCandidate.trim().slice(0, 200) || id,
      ...(ownedBy ? { ownedBy: ownedBy.slice(0, 200) } : {}),
      ...modelCompatibility(provider, id, metadata),
    });
  }
  return [...models.values()].sort((left, right) => {
    const rank = { chat_completions: 0, unknown: 1, unsupported_protocol: 2 };
    return (
      rank[left.compatibility] - rank[right.compatibility] ||
      left.id.localeCompare(right.id)
    );
  });
}

export async function discoverAiModels(
  options: AiAvailabilityOptions,
): Promise<AiModelCatalogResult> {
  const config = getAiConnectionConfig(options.config);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let response: Response;
  try {
    response = await fetchImplementation(modelCatalogEndpoint(config.baseUrl), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AiRequestError(`${config.providerLabel} 模型目录响应超时。`);
    }
    throw new AiRequestError(`无法读取 ${config.providerLabel} 的模型目录。`);
  }
  if (!response.ok) {
    const message =
      response.status === 401 || response.status === 403
        ? `${config.providerLabel} 拒绝读取模型目录，请检查 API Key 权限。`
        : `${config.providerLabel} 模型目录请求失败（HTTP ${response.status}）。`;
    throw new AiRequestError(message, response.status);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MODEL_CATALOG_MAX_BYTES) {
    throw new AiResponseError(`${config.providerLabel} 模型目录超过 5 MB 限制。`);
  }
  let rawBody: string;
  try {
    rawBody = await response.text();
  } catch {
    throw new AiResponseError(`${config.providerLabel} 模型目录无法读取。`);
  }
  if (rawBody.length > MODEL_CATALOG_MAX_BYTES) {
    throw new AiResponseError(`${config.providerLabel} 模型目录超过 5 MB 限制。`);
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new AiResponseError(`${config.providerLabel} 模型目录不是有效 JSON。`);
  }
  return {
    provider: config.provider,
    providerLabel: config.providerLabel,
    fetchedAt: new Date().toISOString(),
    models: parseModels(body, config.provider),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知审核错误。";
}

export async function auditAiProvider(
  options: AiAvailabilityOptions,
): Promise<AiProviderAuditResult> {
  const checks: AiAuditCheck[] = [];
  const provider = options.config.provider ?? "deepseek";
  const selectedModel = options.config.model?.trim() ?? "";
  let models: AiAvailableModel[] = [];

  try {
    getAiProviderConfig(options.config);
    checks.push({
      id: "configuration",
      label: "配置与安全边界",
      status: "passed",
      detail: "地址、模型、鉴权要求与 HTTPS 规则均通过。",
    });
  } catch (error) {
    checks.push({
      id: "configuration",
      label: "配置与安全边界",
      status: "failed",
      detail: errorMessage(error),
    });
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      provider,
      selectedModel,
      models,
      checks,
    };
  }

  const catalogStartedAt = Date.now();
  try {
    const catalog = await discoverAiModels(options);
    models = catalog.models;
    checks.push({
      id: "model_catalog",
      label: "模型目录",
      status: "passed",
      detail: `成功读取 ${models.length} 个模型。目录存在不代表当前 token 一定拥有生成权限。`,
      durationMs: Date.now() - catalogStartedAt,
    });
    const selected = models.find((model) => model.id === selectedModel);
    if (!selected) {
      checks.push({
        id: "model_selection",
        label: "所选模型",
        status: "warning",
        detail: "所选模型不在当前目录中；仍将用最小请求确认实际权限。",
      });
    } else if (selected.compatibility === "unsupported_protocol") {
      checks.push({
        id: "model_selection",
        label: "所选模型",
        status: "failed",
        detail: selected.compatibilityReason,
      });
      checks.push({
        id: "completion_json",
        label: "生成与 JSON 输出",
        status: "skipped",
        detail: "已知协议不兼容，为避免无效计费而未发起生成请求。",
      });
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        provider,
        selectedModel,
        models,
        checks,
      };
    } else {
      checks.push({
        id: "model_selection",
        label: "所选模型",
        status:
          selected.compatibility === "chat_completions" ? "passed" : "warning",
        detail: selected.compatibilityReason,
      });
    }
  } catch (error) {
    checks.push({
      id: "model_catalog",
      label: "模型目录",
      status: "warning",
      detail: `${errorMessage(error)} 目录并非所有兼容服务必备，将继续审核实际生成。`,
      durationMs: Date.now() - catalogStartedAt,
    });
    checks.push({
      id: "model_selection",
      label: "所选模型",
      status: "warning",
      detail: "无法通过目录确认模型，将以最小生成请求为准。",
    });
  }

  const completionStartedAt = Date.now();
  try {
    const result = await testAiConnection({
      config: options.config,
      fetchImplementation: options.fetchImplementation,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
    checks.push({
      id: "completion_json",
      label: "生成与 JSON 输出",
      status: "passed",
      detail: `所选模型完成最小生成，并返回符合要求的 JSON（${result.model}）。`,
      durationMs: Date.now() - completionStartedAt,
    });
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      provider,
      selectedModel,
      returnedModel: result.model,
      models,
      checks,
    };
  } catch (error) {
    checks.push({
      id: "completion_json",
      label: "生成与 JSON 输出",
      status: "failed",
      detail: errorMessage(error),
      durationMs: Date.now() - completionStartedAt,
    });
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      provider,
      selectedModel,
      models,
      checks,
    };
  }
}
