import { getDb } from "@/db";
import { LocalStoryStore, StoryNotFoundError } from "@/lib/storage/story-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string; savePointId: string }> },
) {
  const { sessionId, savePointId } = await context.params;
  try {
    const store = new LocalStoryStore(getDb());
    const result = store.deleteSavePoint(sessionId, savePointId);
    return noStoreJson({
      result,
      recoveryPoints: store.listRecoveryPoints(sessionId),
    });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("删除手动存档失败", error);
    return noStoreJson({ error: "删除存档失败。" }, { status: 500 });
  }
}
