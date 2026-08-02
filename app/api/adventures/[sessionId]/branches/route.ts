import { getDb } from "@/db";
import {
  BranchManagementError,
  LocalStoryStore,
  SavePointManagementError,
  StoryNotFoundError,
} from "@/lib/storage/story-store";
import {
  BranchAndSaveInputError,
  parseCreateBranchRequest,
} from "@/lib/story/分支与存档";

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
    const store = new LocalStoryStore(getDb());
    return noStoreJson({
      branches: store.listBranches(sessionId),
      recoveryPoints: store.listRecoveryPoints(sessionId),
    });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("读取剧情分支失败", error);
    return noStoreJson({ error: "暂时无法读取剧情分支。" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const input = parseCreateBranchRequest(await request.json());
    const store = new LocalStoryStore(getDb());
    const branch = store.createBranch({ sessionId, ...input });
    return noStoreJson(
      {
        branch,
        adventure: store.loadAdventure(sessionId),
        branches: store.listBranches(sessionId),
        recoveryPoints: store.listRecoveryPoints(sessionId),
      },
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
    if (
      error instanceof BranchManagementError ||
      error instanceof SavePointManagementError
    ) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("创建剧情分支失败", error);
    return noStoreJson(
      { error: "创建分支失败，现有剧情没有发生变化。" },
      { status: 500 },
    );
  }
}
