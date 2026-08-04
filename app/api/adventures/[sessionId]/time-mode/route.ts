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
    const store = new LocalStoryStore(getDb());
    const adventure = store.loadAdventure(sessionId);
    const core = adventure.branchState.states.find(
      (state) => state.entityType === "session_state" && state.entityId === "core",
    )?.state;
    return response({
      timeMode: core?.timeMode === "turn_based" ? "turn_based" : "story",
      phaseOffset:
        typeof core?.phaseOffset === "number" ? core.phaseOffset : 0,
      gameTimeDay: typeof core?.gameTimeDay === "number" ? core.gameTimeDay : 1,
    });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return response({ error: error.message }, { status: 404 });
    }
    console.error("读取游戏内时间模式失败", error);
    return response({ error: "读取游戏内时间模式失败。" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const input = object(await request.json());
    if (input.timeMode !== "story" && input.timeMode !== "turn_based") {
      throw new Error("时间模式必须是 story 或 turn_based。");
    }
    const store = new LocalStoryStore(getDb());
    return response({
      time: store.updateTimeMode(sessionId, input.timeMode),
    });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return response({ error: error.message }, { status: 404 });
    }
    return response(
      { error: error instanceof Error ? error.message : "切换时间模式失败。" },
      { status: 400 },
    );
  }
}
