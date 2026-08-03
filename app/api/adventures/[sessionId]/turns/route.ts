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
} from "@/lib/storage/story-store";
import {
  GeneratedTurnValidationError,
  PlayerTurnInputError,
  parsePlayerTurnRequest,
} from "@/lib/story/回合协议";
import { advanceAdventureTurn } from "@/lib/story/回合服务";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function sseEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: string, payload: unknown) {
  controller.enqueue(
    new TextEncoder().encode(
      `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
    ),
  );
}

function errorStatus(error: unknown) {
  if (error instanceof PlayerTurnInputError) return 400;
  if (error instanceof StoryNotFoundError) return 404;
  if (error instanceof BranchHeadConflictError) return 409;
  if (error instanceof AiConfigurationError) return 503;
  if (error instanceof AiRequestError) {
    return error.status === null ? 504 : 502;
  }
  return 502;
}

function errorPayload(error: unknown) {
  if (error instanceof PlayerTurnInputError) {
    return { error: error.message, issues: error.issues };
  }
  if (error instanceof StoryNotFoundError) {
    return { error: error.message };
  }
  if (error instanceof BranchHeadConflictError) {
    return {
      error: error.message,
      expectedHeadTurnId: error.expectedHeadTurnId,
      actualHeadTurnId: error.actualHeadTurnId,
    };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: "生成本轮剧情失败，本地存档没有发生变化。" };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const turnId = new URL(request.url).searchParams.get("turnId")?.trim() ?? "";
  if (!turnId) {
    return noStoreJson({ error: "缺少要查看的回合 ID。" }, { status: 400 });
  }

  try {
    const store = new LocalStoryStore(getDb());
    const adventure = store.loadAdventure(sessionId);
    const turn = store.loadTurn(adventure.branchState.branch.id, turnId);
    return noStoreJson({ turn });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("读取历史剧情回合失败", error);
    return noStoreJson(
      { error: "暂时无法读取该历史回合。" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const wantsStream = (request.headers.get("accept") ?? "").includes(
    "text/event-stream",
  );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
  }

  try {
    const input = parsePlayerTurnRequest(body);
    if (!wantsStream) {
      const result = await advanceAdventureTurn({
        store: new LocalStoryStore(getDb()),
        sessionId,
        input,
      });
      return noStoreJson(result, {
        status:
          result.committedTurn === null
            ? 202
            : result.committedTurn.reused
              ? 200
              : 201,
      });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const result = await advanceAdventureTurn({
            store: new LocalStoryStore(getDb()),
            sessionId,
            input,
            onStreamDelta: (text) => sseEvent(controller, "delta", { text }),
            onFailover: (profileName) =>
              sseEvent(controller, "failover", { profileName }),
          });
          sseEvent(controller, "result", {
            status:
              result.committedTurn === null
                ? 202
                : result.committedTurn.reused
                  ? 200
                  : 201,
            adventure: result.adventure,
            committedTurn: result.committedTurn,
            generation: result.generation,
            pendingChecks: result.pendingChecks,
            pendingTurnId: result.pendingTurnId,
            expectedHeadTurnId: result.expectedHeadTurnId,
            idempotencyKey: result.idempotencyKey,
          });
        } catch (error) {
          if (
            error instanceof SyntaxError ||
            error instanceof PlayerTurnInputError
          ) {
            console.error("流式回合请求无效", error);
          }
          sseEvent(controller, "error", {
            status: errorStatus(error),
            ...errorPayload(error),
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof PlayerTurnInputError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    if (error instanceof BranchHeadConflictError) {
      return noStoreJson(
        {
          error: error.message,
          expectedHeadTurnId: error.expectedHeadTurnId,
          actualHeadTurnId: error.actualHeadTurnId,
        },
        { status: 409 },
      );
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

    console.error("生成并保存剧情回合失败", error);
    return noStoreJson(
      { error: "生成本轮剧情失败，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}
