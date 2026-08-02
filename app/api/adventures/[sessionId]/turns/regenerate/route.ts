import { getDb } from "@/db";
import {
  AiConfigurationError,
  AiRequestError,
  AiResponseError,
} from "@/lib/ai/模型供应商";
import {
  BranchHeadConflictError,
  LocalStoryStore,
  StoryNotFoundError,
  TurnRegenerationConflictError,
  TurnRegenerationError,
} from "@/lib/storage/story-store";
import {
  GeneratedTurnValidationError,
  RegenerateTurnInputError,
  parseRegenerateTurnRequest,
} from "@/lib/story/回合协议";
import { regenerateLatestAdventureTurn } from "@/lib/story/回合服务";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const input = parseRegenerateTurnRequest(await request.json());
    const result = await regenerateLatestAdventureTurn({
      store: new LocalStoryStore(getDb()),
      sessionId,
      expectedHeadTurnId: input.expectedHeadTurnId,
      actionId: input.actionId,
      feedback: input.feedback,
    });
    return noStoreJson(result, { status: 200 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof RegenerateTurnInputError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    if (
      error instanceof BranchHeadConflictError ||
      error instanceof TurnRegenerationConflictError ||
      error instanceof TurnRegenerationError
    ) {
      return noStoreJson({ error: error.message }, { status: 409 });
    }
    if (error instanceof AiConfigurationError) {
      return noStoreJson({ error: error.message }, { status: 503 });
    }
    if (error instanceof AiRequestError) {
      return noStoreJson(
        { error: error.message },
        { status: error.status === null ? 504 : 502 },
      );
    }
    if (
      error instanceof AiResponseError ||
      error instanceof GeneratedTurnValidationError
    ) {
      return noStoreJson(
        {
          error: error.message,
          ...(error instanceof GeneratedTurnValidationError
            ? { issues: error.issues.slice(0, 8) }
            : {}),
        },
        { status: 502 },
      );
    }

    console.error("重新生成最新剧情失败", error);
    return noStoreJson(
      { error: "重新生成失败，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}
