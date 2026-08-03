import { getDb } from "@/db";
import {
  BranchManagementError,
  LocalStoryStore,
  StoryNotFoundError,
} from "@/lib/storage/story-store";
import {
  BranchAndSaveInputError,
  parseBranchUpdateRequest,
} from "@/lib/story/分支与存档";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string; branchId: string }> },
) {
  const { sessionId, branchId } = await context.params;
  try {
    const input = parseBranchUpdateRequest(await request.json());
    const store = new LocalStoryStore(getDb());
    const result =
      input.operation === "switch"
        ? store.switchBranch(sessionId, branchId)
        : input.operation === "rename"
          ? store.renameBranch(sessionId, branchId, input.name)
          : store.setMainBranch(sessionId, branchId);
    return noStoreJson({
      result,
      adventure: store.loadAdventure(sessionId),
      branches: store.listBranches(sessionId),
      recoveryPoints: store.listRecoveryPoints(sessionId),
    });
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
    if (error instanceof BranchManagementError) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("更新剧情分支失败", error);
    return noStoreJson(
      { error: "更新分支失败，现有剧情没有发生变化。" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string; branchId: string }> },
) {
  const { sessionId, branchId } = await context.params;
  try {
    const store = new LocalStoryStore(getDb());
    const result = store.deleteBranch(sessionId, branchId);
    return noStoreJson({
      result,
      adventure: store.loadAdventure(sessionId),
      branches: store.listBranches(sessionId),
      recoveryPoints: store.listRecoveryPoints(sessionId),
    });
  } catch (error) {
    if (error instanceof BranchManagementError) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("删除剧情分支失败", error);
    return noStoreJson(
      { error: "删除分支失败，现有剧情没有发生变化。" },
      { status: 500 },
    );
  }
}
