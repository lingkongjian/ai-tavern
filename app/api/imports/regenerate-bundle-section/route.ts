import {
  AiConfigurationError,
  AiRequestError,
  AiResponseError,
} from "@/lib/ai/模型供应商";
import {
  SourceBundleGenerationInputError,
  SourceBundleGenerationOutputError,
} from "@/lib/import/原文生成剧本包";
import {
  BundleSectionRegenerationInputError,
  BundleSectionRegenerationOutputError,
  regenerateAdventureBundleSection,
} from "@/lib/import/剧本包分区重生成";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_REQUEST_BYTES = 6_000_000;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_REQUEST_BYTES) {
      return noStoreJson(
        { error: "剧本包分区重生成请求超过 6 MB 限制。" },
        { status: 413 },
      );
    }
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      throw new BundleSectionRegenerationInputError([
        "剧本包分区重生成请求必须是 JSON 对象。",
      ]);
    }
    const result = await regenerateAdventureBundleSection({
      document: body.document,
      section: body.section,
      feedback: body.feedback,
    });
    return noStoreJson(result);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson(
        { error: "剧本包分区重生成请求不是有效 JSON。" },
        { status: 400 },
      );
    }
    if (
      error instanceof BundleSectionRegenerationInputError ||
      error instanceof SourceBundleGenerationInputError
    ) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof AiConfigurationError) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    if (
      error instanceof AiRequestError ||
      error instanceof AiResponseError ||
      error instanceof SourceBundleGenerationOutputError ||
      error instanceof BundleSectionRegenerationOutputError
    ) {
      return noStoreJson(
        {
          error: error.message,
          ...("issues" in error ? { issues: error.issues } : {}),
        },
        { status: 502 },
      );
    }
    console.error("剧本包分区重生成失败", error);
    return noStoreJson(
      { error: "无法重新生成所选分区，当前表单没有发生变化。" },
      { status: 500 },
    );
  }
}
