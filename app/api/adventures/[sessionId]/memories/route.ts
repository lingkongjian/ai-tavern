import { getDb } from "@/db";
import {
  LocalStoryStore,
  StoryNotFoundError,
} from "@/lib/storage/story-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求内容必须是 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    return response({ memory: new LocalStoryStore(getDb()).loadStoryMemory(sessionId) });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return response({ error: error.message }, { status: 404 });
    }
    console.error("读取剧情记忆失败", error);
    return response({ error: "读取剧情记忆失败。" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const input = object(await request.json());
    const store = new LocalStoryStore(getDb());
    if (input.kind === "settings") {
      const memoryTokenBudget = Number(input.memoryTokenBudget);
      const recentTurnCount = Number(input.recentTurnCount);
      const chapterSize = Number(input.chapterSize);
      if (![memoryTokenBudget, recentTurnCount, chapterSize].every(Number.isFinite)) {
        throw new Error("记忆设置必须是有效数字。");
      }
      return response({
        memory: store.updateStoryMemorySettings(sessionId, {
          memoryTokenBudget,
          recentTurnCount,
          chapterSize,
        }),
      });
    }
    if (input.kind !== "entry" || typeof input.entryId !== "string") {
      throw new Error("请选择要修改的剧情记忆。");
    }
    const status =
      input.status === "active" || input.status === "resolved"
        ? input.status
        : undefined;
    return response({
      memory: store.updateStoryMemoryEntry(sessionId, {
        entryId: input.entryId,
        ...(typeof input.title === "string" ? { title: input.title } : {}),
        ...(typeof input.content === "string" ? { content: input.content } : {}),
        ...(typeof input.importance === "number"
          ? { importance: input.importance }
          : {}),
        ...(status ? { status } : {}),
        ...(typeof input.pinned === "boolean" ? { pinned: input.pinned } : {}),
        ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
      }),
    });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return response({ error: error.message }, { status: 404 });
    }
    return response(
      { error: error instanceof Error ? error.message : "修改剧情记忆失败。" },
      { status: 400 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const input = object(await request.json());
    if (input.operation !== "rebuild") throw new Error("不支持的记忆操作。");
    const store = new LocalStoryStore(getDb());
    return response({ memory: store.rebuildStoryMemory(sessionId) });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return response({ error: error.message }, { status: 404 });
    }
    return response(
      { error: error instanceof Error ? error.message : "重建剧情记忆失败。" },
      { status: 400 },
    );
  }
}
