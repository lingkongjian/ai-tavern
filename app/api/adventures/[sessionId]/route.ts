import { getDb } from "@/db";
import {
  LocalStoryStore,
  StoryNotFoundError,
} from "@/lib/storage/story-store";
import {
  RenameAdventureInputError,
  parseRenameAdventureRequest,
} from "@/lib/story/剧本管理";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  try {
    const adventure = new LocalStoryStore(getDb()).loadAdventure(sessionId);
    return noStoreJson({ adventure });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }

    console.error("读取本地剧情会话失败", error);
    return noStoreJson(
      { error: "暂时无法读取该剧情会话。" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  try {
    const deleted = new LocalStoryStore(getDb()).deleteAdventure(sessionId);
    return noStoreJson({ deleted });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }

    console.error("删除本地剧情会话失败", error);
    return noStoreJson(
      { error: "删除剧本失败，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  try {
    const input = parseRenameAdventureRequest(await request.json());
    const adventure = new LocalStoryStore(getDb()).renameAdventure(
      sessionId,
      input.name,
    );
    return noStoreJson({ adventure });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof RenameAdventureInputError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }

    console.error("重命名本地剧本失败", error);
    return noStoreJson(
      { error: "修改剧本名称失败，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}
