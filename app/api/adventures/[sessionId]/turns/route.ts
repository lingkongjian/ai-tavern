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
import {
  advanceAdventureTurn,
  TurnCancelledError,
} from "@/lib/story/回合服务";

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

// 客户端断连/中止读取时由 ReadableStream 的 cancel 回调标记取消；
// request.signal 在部分运行时可能缺失，监听一律使用可选链保护。
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
        signal: request.signal,
        isCancelled: () => request.signal.aborted,
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

    let cancelled = false;
    const generationController = new AbortController();
    const markCancelled = () => {
      cancelled = true;
      generationController.abort();
    };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // 中断时立即取消模型请求，同时保留提交前的取消检查。
        request.signal?.addEventListener?.("abort", markCancelled);
        if (request.signal.aborted) markCancelled();
        try {
          const result = await advanceAdventureTurn({
            store: new LocalStoryStore(getDb()),
            sessionId,
            input,
            isCancelled: () => cancelled,
            signal: generationController.signal,
            onStreamDelta: (text) => sseEvent(controller, "delta", { text }),
            onFailover: ({ id, name }) =>
              sseEvent(controller, "failover", {
                profileId: id,
                profileName: name,
              }),
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
          if (error instanceof TurnCancelledError) {
            // 客户端已中断，不提交也不发送 error 事件；连接尚存时回一个 cancelled 事件
            if (!cancelled && !request.signal?.aborted) {
              sseEvent(controller, "cancelled", { cancelled: true });
            }
            return;
          }
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
          request.signal.removeEventListener("abort", markCancelled);
          try {
            controller.close();
          } catch {
            // 客户端已断开，流已不可用
          }
        }
      },
      cancel() {
        markCancelled();
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
