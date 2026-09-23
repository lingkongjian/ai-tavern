import type { JsonObject, JsonValue } from "../storage/story-store.ts";
import { getActiveAiProfileSync } from "./活动配置.ts";

export type AiProviderId =
  | "deepseek"
  | "opencode_go"
  | "openai_compatible"
  | "local_openai_compatible";

export type AiJsonMode = "response_format" | "json_schema" | "prompt_only";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiJsonResult {
  content: JsonObject;
  model: string;
  usage: AiUsage;
}

export interface AiProviderConfigInput {
  provider?: AiProviderId;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  jsonMode?: AiJsonMode;
  maxOutputTokens?: number;
  requestTimeoutSeconds?: number;
}

export interface AiRequestOptions {
  maxTokens?: number;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  config?: AiProviderConfigInput;
}

export interface AiStreamCallbacks {
  onDelta?: (text: string) => void;
}

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  apiKeyRequired: boolean;
  modelDiscoverySupported: boolean;
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "保留现有 DeepSeek 配置，并使用其兼容接口参数。",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    apiKeyRequired: true,
    modelDiscoverySupported: true,
  },
  {
    id: "opencode_go",
    label: "OpenCode Go",
    description: "读取套餐模型目录，并审核所选模型是否兼容酒馆协议。",
    defaultBaseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    defaultModel: "deepseek-v4-flash",
    apiKeyRequired: true,
    modelDiscoverySupported: true,
  },
  {
    id: "openai_compatible",
    label: "OpenAI 兼容云端服务",
    description: "填写供应商提供的 Base URL、模型名与 API Key。",
    defaultBaseUrl: "",
    defaultModel: "",
    apiKeyRequired: true,
    modelDiscoverySupported: true,
  },
  {
    id: "local_openai_compatible",
    label: "本地 OpenAI 兼容服务",
    description: "连接运行在本机的兼容接口；API Key 可以留空。",
    defaultBaseUrl: "",
    defaultModel: "",
    apiKeyRequired: false,
    modelDiscoverySupported: true,
  },
] as const;

export interface ResolvedAiProviderConfig {
  provider: AiProviderId;
  providerLabel: string;
  baseUrl: string;
  endpoint: string;
  model: string;
  apiKey: string;
  apiKeyRequired: boolean;
  jsonMode: AiJsonMode;
  maxOutputTokens: number;
  requestTimeoutSeconds: number;
}

export type ResolvedAiConnectionConfig = Omit<
  ResolvedAiProviderConfig,
  "model" | "endpoint"
>;

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export class AiRequestError extends Error {
  public readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AiRequestError";
    this.status = status;
  }
}

export class AiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseError";
  }
}

export class AiOutputTruncatedError extends AiResponseError {
  constructor(providerLabel: string, maxTokens: number) {
    super(
      `${providerLabel} 输出被截断（本次输出上限 ${maxTokens} Token，含思考）。请在“模型设置”中提高输出上限和等待时间，或在模型服务中减少/关闭思考；同时检查模型的上下文容量。本轮未保存。`,
    );
    this.name = "AiOutputTruncatedError";
  }
}

export function readGenerationLimit(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new AiConfigurationError(label + "必须是 1 到 " + maximum + " 之间的整数。");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function readProvider(value: string | undefined): AiProviderId {
  const provider = value?.trim() || "deepseek";
  if (AI_PROVIDER_PRESETS.some((preset) => preset.id === provider)) {
    return provider as AiProviderId;
  }
  throw new AiConfigurationError(
    `不支持的 AI_PROVIDER：${provider}。请在设置页重新选择供应商。`,
  );
}

function readJsonMode(value: string | undefined): AiJsonMode {
  const mode = value?.trim() || "response_format";
  if (mode === "response_format" || mode === "json_schema" || mode === "prompt_only") return mode;
  throw new AiConfigurationError(
    "AI_JSON_MODE 必须是 response_format、json_schema 或 prompt_only。",
  );
}

function presetFor(provider: AiProviderId) {
  const preset = AI_PROVIDER_PRESETS.find((item) => item.id === provider);
  if (!preset) {
    throw new AiConfigurationError(`没有找到模型供应商配置：${provider}。`);
  }
  return preset;
}

function createEndpoint(baseUrl: string) {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AiConfigurationError("AI_API_BASE_URL 不是有效地址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AiConfigurationError("AI_API_BASE_URL 必须使用 HTTP 或 HTTPS。");
  }
  if (url.username || url.password) {
    throw new AiConfigurationError(
      "请不要把用户名或密钥写入 Base URL；请使用独立的 API Key 字段。",
    );
  }
  for (const name of url.searchParams.keys()) {
    if (/^(?:api[-_]?key|token|access[-_]?token|authorization)$/i.test(name)) {
      throw new AiConfigurationError(
        "请不要把密钥或 token 写入 Base URL 查询参数；请使用独立的 API Key 字段。",
      );
    }
  }
  if (
    url.protocol === "http:" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "localhost" &&
    url.hostname !== "::1" &&
    url.hostname !== "[::1]"
  ) {
    throw new AiConfigurationError(
      "远程 AI_API_BASE_URL 必须使用 HTTPS，避免 API Key 明文传输。",
    );
  }
  const pathname = url.pathname.replace(/\/$/, "");
  url.pathname = pathname.endsWith("/chat/completions")
    ? pathname
    : `${pathname}/chat/completions`;
  return url.toString();
}

function parseJsonObject(content: string, providerLabel: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiResponseError(`${providerLabel} 返回的内容不是有效 JSON。`);
  }

  if (!isRecord(parsed) || !isJsonValue(parsed)) {
    throw new AiResponseError(`${providerLabel} 返回的 JSON 顶层必须是对象。`);
  }
  return parsed as JsonObject;
}

function readProviderMessage(value: unknown) {
  if (!isRecord(value)) return "";
  // LM Studio returns { error: "..." }; other providers use error.message.
  if (typeof value.error === "string") return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  return typeof value.message === "string" ? value.message : "";
}

function safeProviderMessage(message: string, apiKey: string) {
  const redacted = apiKey ? message.split(apiKey).join("[密钥已隐藏]") : message;
  return redacted.slice(0, 500);
}

function responseFormat(jsonMode: AiJsonMode) {
  if (jsonMode === "response_format") return { type: "json_object" };
  if (jsonMode === "json_schema") {
    // Like JSON object mode, constrain the root only. Story-specific fields are
    // still validated by each caller; audit and streaming use the same format.
    return { type: "json_schema", json_schema: { name: "ai_tavern_json", schema: { type: "object" } } };
  }
  return undefined;
}

function readUsage(value: unknown): AiUsage {
  if (!isRecord(value) || !isRecord(value.usage)) return {};
  const usage = value.usage;
  return {
    promptTokens:
      typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
    completionTokens:
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : undefined,
    totalTokens:
      typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
  };
}

export function getAiConnectionConfig(
  input: AiProviderConfigInput = {},
): ResolvedAiConnectionConfig {
  const profile = getActiveAiProfileSync();
  const provider = readProvider(
    input.provider ?? profile?.provider ?? process.env.AI_PROVIDER,
  );
  const preset = presetFor(provider);
  const baseUrl =
    input.baseUrl !== undefined
      ? input.baseUrl.trim()
      : (profile?.baseUrl ||
        process.env.AI_API_BASE_URL?.trim() ||
        preset.defaultBaseUrl);
  const apiKey =
    input.apiKey !== undefined
      ? input.apiKey.trim()
      : (profile?.apiKey?.trim() || process.env.AI_API_KEY?.trim() || "");
  const jsonMode = readJsonMode(
    input.jsonMode ?? profile?.jsonMode ?? process.env.AI_JSON_MODE,
  );

  if (!baseUrl) {
    throw new AiConfigurationError("请填写模型供应商的 Base URL。");
  }
  if (preset.apiKeyRequired && !apiKey) {
    throw new AiConfigurationError(
      `尚未配置 ${preset.label} API Key，请在首页“模型设置”中填写。`,
    );
  }
  createEndpoint(baseUrl);

  return {
    provider,
    providerLabel: preset.label,
    baseUrl,
    apiKey,
    apiKeyRequired: preset.apiKeyRequired,
    jsonMode,
    // Explicit profiles must not inherit the active profile's generation limits.
    maxOutputTokens: readGenerationLimit(input.maxOutputTokens ?? (input.provider === undefined ? profile?.maxOutputTokens : undefined), 6_000, 131_072, "输出上限"),
    requestTimeoutSeconds: readGenerationLimit(input.requestTimeoutSeconds ?? (input.provider === undefined ? profile?.requestTimeoutSeconds : undefined), provider === "local_openai_compatible" ? 1_800 : 90, 14_400, "等待时间"),
  };
}

export function getAiProviderConfig(
  input: AiProviderConfigInput = {},
): ResolvedAiProviderConfig {
  const connection = getAiConnectionConfig(input);
  const preset = presetFor(connection.provider);
  const profile = getActiveAiProfileSync();
  const model =
    input.model !== undefined
      ? input.model.trim()
      : (profile?.model || process.env.AI_MODEL?.trim() || preset.defaultModel);
  if (!model) {
    throw new AiConfigurationError("请填写要调用的模型名称。");
  }
  return {
    ...connection,
    model,
    endpoint: createEndpoint(connection.baseUrl),
  };
}

export function getAiProviderStatus() {
  const profile = getActiveAiProfileSync();
  const provider = readProvider(
    profile?.provider ?? process.env.AI_PROVIDER,
  );
  const preset = presetFor(provider);
  const apiKey = profile?.apiKey?.trim() ?? process.env.AI_API_KEY?.trim() ?? "";
  const baseUrl =
    profile?.baseUrl ||
    process.env.AI_API_BASE_URL?.trim() ||
    preset.defaultBaseUrl;
  const model =
    profile?.model || process.env.AI_MODEL?.trim() || preset.defaultModel;
  const jsonMode = readJsonMode(
    profile?.jsonMode ?? process.env.AI_JSON_MODE,
  );
  const hasApiKey = Boolean(apiKey);
  return {
    provider,
    providerLabel: preset.label,
    configured: Boolean(
      baseUrl && model && (hasApiKey || !preset.apiKeyRequired),
    ),
    maxOutputTokens: profile?.maxOutputTokens ?? 6_000,
    requestTimeoutSeconds: profile?.requestTimeoutSeconds ?? (provider === "local_openai_compatible" ? 1_800 : 90),
    hasApiKey,
    apiKeyRequired: preset.apiKeyRequired,
    baseUrl,
    model,
    jsonMode,
  };
}

export async function requestAiJsonStream(
  messages: AiMessage[],
  options: AiRequestOptions & AiStreamCallbacks = {},
): Promise<AiJsonResult> {
  if (messages.length === 0) {
    throw new AiRequestError("发送给模型的消息不能为空。");
  }

  const config = getAiProviderConfig(options.config);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutSeconds * 1_000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  options.signal?.throwIfAborted();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: options.maxTokens ?? config.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  const format = responseFormat(config.jsonMode);
  if (format) requestBody.response_format = format;
  if (config.provider === "deepseek" || config.provider === "opencode_go") {
    requestBody.thinking = { type: "disabled" };
  }

  let response: Response;
  try {
    response = await fetchImplementation(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    if (deadline.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new AiRequestError(`${config.providerLabel} 响应超时（${Math.ceil(timeoutMs / 1000)} 秒），请检查模型加载和提示词处理进度。`);
    }
    throw new AiRequestError(
      `无法连接 ${config.providerLabel}，请检查地址、网络和服务状态。`,
    );
  }

  if (!response.ok) {
    let failureBody: unknown;
    try {
      failureBody = await response.json();
    } catch {
      failureBody = undefined;
    }
    throw requestErrorFromResponse(config, response.status, failureBody);
  }
  if (!response.body) {
    throw new AiResponseError(`${config.providerLabel} 没有返回可读取的流式响应。`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let content = "";
  let finishReason: string | undefined;
  let returnedModel: string | undefined;
  let usage: AiUsage = {};
  let sawFrame = false;

  function consumeLine(line: string) {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") return;
    sawFrame = true;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(frame)) return;
    if (typeof frame.model === "string") returnedModel = frame.model;
    if (isRecord(frame.usage)) usage = readUsage(frame);
    const choice = Array.isArray(frame.choices) ? frame.choices[0] : undefined;
    if (!isRecord(choice)) return;
    if (typeof choice.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }
    const delta = choice.delta;
    if (!isRecord(delta)) return;
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      options.onDelta?.(delta.content);
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        consumeLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    for (const line of buffer.split("\n")) consumeLine(line);
  } catch (error) {
    options.signal?.throwIfAborted();
    if (deadline.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new AiRequestError(`${config.providerLabel} 流式响应超时（${Math.ceil(timeoutMs / 1000)} 秒），请检查模型加载和生成进度。`);
    }
    throw new AiRequestError(`${config.providerLabel} 流式响应中断，请稍后重试。`);
  } finally {
    reader.releaseLock();
  }

  if (!sawFrame) {
    throw new AiResponseError(`${config.providerLabel} 没有返回任何流式内容。`);
  }
  if (finishReason === "length") {
    throw new AiOutputTruncatedError(config.providerLabel, options.maxTokens ?? config.maxOutputTokens);
  }
  if (!content.trim()) {
    throw new AiResponseError(`${config.providerLabel} 没有返回剧情内容。`);
  }

  return {
    content: parseJsonObject(content, config.providerLabel),
    model: returnedModel ?? config.model,
    usage,
  };
}

function requestErrorFromResponse(
  config: ResolvedAiProviderConfig,
  status: number,
  body: unknown,
) {
  const providerMessage = safeProviderMessage(
    readProviderMessage(body),
    config.apiKey,
  );
  let message = `${config.providerLabel} 请求失败。`;
  if (status === 400 || status === 422) {
    message = `${config.providerLabel} 拒绝请求参数，请检查模型名称和 JSON 输出方式。`;
  }
  if (status === 401 || status === 403) {
    message = `${config.providerLabel} API Key 无效、已失效或权限不足。`;
  }
  if (status === 402) {
    message = `${config.providerLabel} 账户余额不足。`;
  }
  if (status === 429) {
    message = `${config.providerLabel} 请求过于频繁，请稍后重试。`;
  }
  if (status >= 500) {
    message = `${config.providerLabel} 服务暂时不可用，请稍后重试。`;
  }
  message += `（HTTP ${status}）`;
  if (config.jsonMode === "response_format" && /response_format/i.test(providerMessage) && /json_schema/i.test(providerMessage)) {
    message += " 可将 JSON 输出方式改为“JSON Schema（LM Studio）”后重新审核并保存。";
  }
  return new AiRequestError(
    providerMessage ? `${message}\n服务返回：${providerMessage}` : message,
    status,
  );
}

export async function requestAiJson(
  messages: AiMessage[],
  options: AiRequestOptions = {},
): Promise<AiJsonResult> {
  if (messages.length === 0) {
    throw new AiRequestError("发送给模型的消息不能为空。");
  }

  const config = getAiProviderConfig(options.config);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutSeconds * 1_000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  options.signal?.throwIfAborted();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: options.maxTokens ?? config.maxOutputTokens,
    stream: false,
  };
  const format = responseFormat(config.jsonMode);
  if (format) requestBody.response_format = format;
  if (config.provider === "deepseek" || config.provider === "opencode_go") {
    requestBody.thinking = { type: "disabled" };
  }

  let response: Response;
  try {
    response = await fetchImplementation(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    if (deadline.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new AiRequestError(`${config.providerLabel} 响应超时（${Math.ceil(timeoutMs / 1000)} 秒），请检查模型加载和提示词处理进度。`);
    }
    throw new AiRequestError(
      `无法连接 ${config.providerLabel}，请检查地址、网络和服务状态。`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    options.signal?.throwIfAborted();
    if (deadline.aborted) throw new AiRequestError(`${config.providerLabel} 响应超时（${Math.ceil(timeoutMs / 1000)} 秒）。`);
    if (!response.ok) throw requestErrorFromResponse(config, response.status, undefined);
    throw new AiResponseError(`${config.providerLabel} 返回了无法读取的响应。`);
  }

  if (!response.ok) {
    throw requestErrorFromResponse(config, response.status, body);
  }

  if (!isRecord(body) || !Array.isArray(body.choices)) {
    throw new AiResponseError(`${config.providerLabel} 响应缺少 choices。`);
  }
  const choice = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new AiResponseError(`${config.providerLabel} 响应缺少最终消息。`);
  }
  if (choice.finish_reason === "length") {
    throw new AiOutputTruncatedError(config.providerLabel, options.maxTokens ?? config.maxOutputTokens);
  }
  const content = choice.message.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AiResponseError(`${config.providerLabel} 没有返回剧情内容。`);
  }

  return {
    content: parseJsonObject(content, config.providerLabel),
    model: typeof body.model === "string" ? body.model : config.model,
    usage: readUsage(body),
  };
}

export async function testAiConnection(options: AiRequestOptions = {}) {
  const result = await requestAiJson(
    [
      {
        role: "system",
        content: "只返回 JSON 对象，不要输出其他内容。",
      },
      {
        role: "user",
        content: '返回 {"status":"ok"}，用于本地连接测试。',
      },
    ],
    { ...options, maxTokens: 64 },
  );

  if (result.content.status !== "ok") {
    throw new AiResponseError("模型连接成功，但测试响应不符合预期。");
  }
  return { model: result.model, usage: result.usage };
}
