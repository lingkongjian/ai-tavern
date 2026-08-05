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
import {
  regenerateLatestAdventureTurn,
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

function sseEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  payload: unknown,
) {
  controller.enqueue(
    new TextEncoder().encode(
      `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
    ),
  );
}

// 客户端断连/中止读取时由 ReadableStream 的 cancel 回调标记取消；
// request.signal 在部分运行时可能缺失，监听一律使用可选链保护。
function errorStatus(error: unknown) {
  if (error instanceof RegenerateTurnInputError) return 400;
  if (error instanceof StoryNotFoundError) return 404;
  if (
    error instanceof BranchHeadConflictError ||
    error instanceof TurnRegenerationConflictError ||
    error instanceof TurnRegenerationError
  ) {
    return 409;
  }
  if (error instanceof AiConfigurationError) return 503;
  if (error instanceof AiRequestError) {
    return error.status === null ? 504 : 502;
  }
  return 502;
}

function errorPayload(error: unknown) {
  if (error instanceof RegenerateTurnInputError) {
    return { error: error.message, issues: error.issues };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: "重新生成失败，本地存档没有发生变化。" };
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
    const input = parseRegenerateTurnRequest(body);
    if (!wantsStream) {
      const result = await regenerateLatestAdventureTurn({
        store: new LocalStoryStore(getDb()),
        sessionId,
        expectedHeadTurnId: input.expectedHeadTurnId,
        actionId: input.actionId,
        feedback: input.feedback,
        mode: input.mode,
      });
      return noStoreJson({ ...result, mode: input.mode }, { status: 200 });
    }

    let cancelled = false;
    const markCancelled = () => {
      cancelled = true;
    };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // 前端中断（abort）或响应流被取消时，重写完成后不再替换回合
        request.signal?.addEventListener?.("abort", markCancelled);
        try {
          const result = await regenerateLatestAdventureTurn({
            store: new LocalStoryStore(getDb()),
            sessionId,
            expectedHeadTurnId: input.expectedHeadTurnId,
            actionId: input.actionId,
            feedback: input.feedback,
            mode: input.mode,
            isCancelled: () => cancelled,
            onStreamDelta: (text) => sseEvent(controller, "delta", { text }),
            onFailover: ({ id, name }) =>
              sseEvent(controller, "failover", {
                profileId: id,
                profileName: name,
              }),
          });
          sseEvent(controller, "result", {
            status: 200,
            mode: input.mode,
            adventure: result.adventure,
            replacedTurn: result.replacedTurn,
            generation: result.generation,
          });
        } catch (error) {
          if (error instanceof TurnCancelledError) {
            // 客户端已中断，不替换也不发送 error 事件；连接尚存时回一个 cancelled 事件
            if (!cancelled && !request.signal?.aborted) {
              sseEvent(controller, "cancelled", { cancelled: true });
            }
            return;
          }
          sseEvent(controller, "error", {
            status: errorStatus(error),
            ...errorPayload(error),
          });
        } finally {
          try {
            controller.close();
          } catch {
            // 客户端已断开，流已不可用
          }
        }
      },
      cancel() {
        cancelled = true;
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
