import {
  AI_PROVIDER_PRESETS,
  AiConfigurationError,
  AiRequestError,
  AiResponseError,
  getAiProviderStatus,
  readGenerationLimit,
  type AiJsonMode,
  type AiProviderId,
} from "@/lib/ai/模型供应商";
import {
  activateAiProfile,
  deleteAiProfile,
  listAiProfiles,
  saveAiProfile,
} from "@/lib/ai/模型配置文件";
import {
  auditAiProvider,
  discoverAiModels,
} from "@/lib/ai/模型可用性";
import packageJson from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseConfiguration(value: unknown) {
  if (!isRecord(value)) throw new AiConfigurationError("模型配置格式无效。");
  const provider = value.provider;
  const baseUrl = value.baseUrl;
  const model = value.model;
  const jsonMode = value.jsonMode;
  const apiKey = value.apiKey;
  const clearApiKey = value.clearApiKey;
  if (
    typeof provider !== "string" ||
    !AI_PROVIDER_PRESETS.some((preset) => preset.id === provider)
  ) {
    throw new AiConfigurationError("请选择有效的模型供应商。");
  }
  if (typeof baseUrl !== "string" || baseUrl.length > 2_000) {
    throw new AiConfigurationError("Base URL 格式无效或过长。");
  }
  if (typeof model !== "string" || model.length > 200) {
    throw new AiConfigurationError("模型名称格式无效或过长。");
  }
  if (jsonMode !== "response_format" && jsonMode !== "json_schema" && jsonMode !== "prompt_only") {
    throw new AiConfigurationError("请选择有效的 JSON 输出方式。");
  }
  if (apiKey !== undefined && (typeof apiKey !== "string" || apiKey.length > 4_000)) {
    throw new AiConfigurationError("API Key 格式无效或过长。");
  }
  if (clearApiKey !== undefined && typeof clearApiKey !== "boolean") {
    throw new AiConfigurationError("清除 API Key 标记无效。");
  }
  return {
    provider: provider as AiProviderId,
    baseUrl,
    model,
    jsonMode: jsonMode as AiJsonMode,
    ...(value.maxOutputTokens !== undefined ? { maxOutputTokens: readGenerationLimit(value.maxOutputTokens, 6_000, 131_072, "输出上限") } : {}),
    ...(value.requestTimeoutSeconds !== undefined ? { requestTimeoutSeconds: readGenerationLimit(value.requestTimeoutSeconds, 90, 14_400, "等待时间") } : {}),
    ...(typeof apiKey === "string" ? { apiKey } : {}),
    ...(typeof clearApiKey === "boolean" ? { clearApiKey } : {}),
  };
}

function parseProfileId(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new AiConfigurationError("API 配置编号无效。");
  }
  return value.trim();
}

function parseProfileName(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 100) {
    throw new AiConfigurationError("API 配置名称格式无效或过长。");
  }
  return value.trim();
}

function parseOperation(value: unknown) {
  if (!isRecord(value) || value.operation === undefined) return "audit" as const;
  if (
    value.operation === "audit" ||
    value.operation === "discover_models" ||
    value.operation === "save_profile" ||
    value.operation === "delete_profile" ||
    value.operation === "switch_profile"
  ) {
    return value.operation;
  }
  throw new AiConfigurationError("不支持的模型设置操作。");
}

function effectiveApiKey(input: ReturnType<typeof parseConfiguration>) {
  const existingProvider = process.env.AI_PROVIDER?.trim() || "deepseek";
  return input.clearApiKey
    ? ""
    : input.apiKey?.trim() ||
        (existingProvider === input.provider
          ? process.env.AI_API_KEY?.trim() || ""
          : "");
}

async function settingsResponse() {
  const profiles = await listAiProfiles();
  return {
    ...getAiProviderStatus(),
    version: packageJson.version ?? "0.0.0",
    presets: AI_PROVIDER_PRESETS,
    activeId: profiles.activeId,
    profiles: profiles.profiles,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return Response.json({ error: "模型配置请求不是有效 JSON。" }, { status: 400 });
  }
  if (error instanceof AiConfigurationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof AiRequestError || error instanceof AiResponseError) {
    return Response.json({ error: error.message }, { status: 502 });
  }
  console.error("保存或审核模型配置失败", error);
  return Response.json({ error: "模型配置操作失败，请稍后重试。" }, { status: 500 });
}

export async function GET() {
  try {
    return Response.json(
      await settingsResponse(),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const operation = parseOperation(body);
    if (operation === "save_profile") {
      const id = typeof body.id === "string" && body.id.trim()
        ? body.id.trim()
        : undefined;
      if (id && id.length > 200) throw new AiConfigurationError("API 配置编号无效。");
      const input = parseConfiguration(body);
      const saved = await saveAiProfile({
        id,
        name: parseProfileName(body.name),
        ...input,
        apiKey: effectiveApiKey(input),
      });
      return Response.json(
        { operation, saved, ...(await settingsResponse()) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (operation === "delete_profile") {
      const profileId = parseProfileId(body.profileId);
      await deleteAiProfile(profileId);
      return Response.json(
        { operation, ...(await settingsResponse()) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (operation === "switch_profile") {
      const profileId = parseProfileId(body.profileId);
      await activateAiProfile(profileId);
      return Response.json(
        { operation, ...(await settingsResponse()) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const input = parseConfiguration(body);
    const config = { ...input, apiKey: effectiveApiKey(input) };
    if (operation === "discover_models") {
      const catalog = await discoverAiModels({ config, timeoutMs: 15_000 });
      return Response.json(
        { operation, catalog },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const audit = await auditAiProvider({ config, timeoutMs: 30_000 });
    return Response.json(
      { operation, audit },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const id = typeof body.id === "string" && body.id.trim()
      ? body.id.trim()
      : undefined;
    if (id && id.length > 200) throw new AiConfigurationError("API 配置编号无效。");
    const input = parseConfiguration(body);
    await saveAiProfile({
      id,
      name: parseProfileName(body.name),
      ...input,
      apiKey: effectiveApiKey(input),
    });
    return Response.json(
      await settingsResponse(),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const profileId = url.searchParams.get("profileId");
    if (profileId) {
      await deleteAiProfile(profileId);
    } else {
      const profiles = await listAiProfiles();
      if (profiles.activeId) await deleteAiProfile(profiles.activeId);
    }
    return Response.json(
      await settingsResponse(),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
