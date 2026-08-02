import { getDb } from "@/db";
import {
  LocalStoryStore,
  SavePointManagementError,
  StoryNotFoundError,
} from "@/lib/storage/story-store";
import {
  BranchAndSaveInputError,
  parseCreateSavePointRequest,
} from "@/lib/story/分支与存档";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const input = parseCreateSavePointRequest(await request.json());
    const store = new LocalStoryStore(getDb());
    const savePoint = store.createSavePoint(sessionId, input.name);
    return noStoreJson(
      { savePoint, recoveryPoints: store.listRecoveryPoints(sessionId) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof BranchAndSaveInputError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof SavePointManagementError) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("建立手动存档失败", error);
    return noStoreJson({ error: "建立存档失败。" }, { status: 500 });
  }
}
