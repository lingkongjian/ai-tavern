import { getDb } from "@/db";
import {
  LocalStoryStore,
  StoryModuleManagementError,
  StoryNotFoundError,
} from "@/lib/storage/story-store";
import {
  parseStoryModuleManagementInput,
  StoryModuleManagementInputError,
} from "@/lib/story/剧情任务管理";

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
    const input = parseStoryModuleManagementInput({
      sessionId,
      value: await request.json(),
    });
    const store = new LocalStoryStore(getDb());
    const result = store.manageStoryModule(input);
    const adventure = store.loadAdventure(sessionId);
    return noStoreJson(
      { result, adventure },
      { status: input.operation === "create" && !result.reused ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof StoryModuleManagementInputError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof StoryModuleManagementError) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("保存剧情任务管理操作失败", error);
    return noStoreJson(
      { error: "保存剧情任务变化失败，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}
