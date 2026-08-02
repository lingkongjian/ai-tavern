import {
  AiConfigurationError,
  AiRequestError,
  AiResponseError,
} from "@/lib/ai/模型供应商";
import { SourceBundleGenerationInputError } from "@/lib/import/原文生成剧本包";
import {
  analyzeSourceStory,
  SourceStoryAnalysisOutputError,
} from "@/lib/import/原文剧本分析";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_REQUEST_BYTES = 4_000_000;

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
        { error: "原文分析请求超过 4 MB 限制。" },
        { status: 413 },
      );
    }
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      throw new SourceBundleGenerationInputError(["原文分析请求必须是 JSON 对象。"]);
    }
    return noStoreJson(
      await analyzeSourceStory({
        fileName: body.fileName as string,
        content: body.content as string,
      }),
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "原文分析请求不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof SourceBundleGenerationInputError) {
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
      error instanceof SourceStoryAnalysisOutputError
    ) {
      return noStoreJson(
        {
          error: error.message,
          ...(error instanceof SourceStoryAnalysisOutputError
            ? { issues: error.issues }
            : {}),
        },
        { status: 502 },
      );
    }
    console.error("分析剧本原文失败", error);
    return noStoreJson(
      { error: "无法分析原文，当前开局表单没有发生变化。" },
      { status: 500 },
    );
  }
}
