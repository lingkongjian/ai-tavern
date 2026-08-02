import { getDb } from "@/db";
import {
  LocalStoryStore,
  LocationManagementError,
  StoryNotFoundError,
} from "@/lib/storage/story-store";
import {
  LocationManagementInputError,
  parseLocationManagementInput,
} from "@/lib/story/地点管理";

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
    const input = parseLocationManagementInput({
      sessionId,
      value: await request.json(),
    });
    const store = new LocalStoryStore(getDb());
    const result = store.manageLocation(input);
    const adventure = store.loadAdventure(sessionId);
    return noStoreJson(
      { result, adventure },
      { status: input.operation === "create" && !result.reused ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof LocationManagementInputError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof LocationManagementError) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }

    console.error("保存地点管理操作失败", error);
    return noStoreJson(
      { error: "保存地点变化失败，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}
