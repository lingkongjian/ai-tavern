import { getDb } from "@/db";
import {
  LocalStoryStore,
  StoryNotFoundError,
} from "@/lib/storage/story-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string; turnId: string }> },
) {
  const { sessionId, turnId } = await context.params;
  try {
    const snapshot = new LocalStoryStore(getDb()).loadTurnContextSnapshot(
      sessionId,
      turnId,
    );
    return noStoreJson({ snapshot });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("读取 AI 上下文快照失败", error);
    return noStoreJson({ error: "暂时无法读取该回合的 AI 上下文。" }, { status: 500 });
  }
}
