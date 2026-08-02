import { getDb } from "@/db";
import {
  LocalStoryStore,
  type StateAuditDashboard,
  StateAuditManagementError,
  StoryNotFoundError,
} from "@/lib/storage/story-store";
import {
  parseStateAuditControlInput,
  StateAuditInputError,
} from "@/lib/story/状态审计";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function compactAudit(audit: StateAuditDashboard): StateAuditDashboard {
  return {
    ...audit,
    actions: audit.actions.map((action) => ({
      ...action,
      changes: action.changes.map((change) => {
        const visible = { ...change };
        delete visible.before;
        delete visible.after;
        return visible;
      }),
    })),
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const audit = new LocalStoryStore(getDb()).loadStateAudit(sessionId);
    return noStoreJson({ audit: compactAudit(audit) });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("读取状态审计记录失败", error);
    return noStoreJson({ error: "读取状态审计记录失败。" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const input = parseStateAuditControlInput({
      sessionId,
      value: await request.json(),
    });
    const store = new LocalStoryStore(getDb());
    const result = store.manageStateAudit(input);
    return noStoreJson({
      result,
      audit: compactAudit(store.loadStateAudit(sessionId)),
      adventure: store.loadAdventure(sessionId),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof StateAuditInputError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof StateAuditManagementError) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("保存状态审计操作失败", error);
    return noStoreJson(
      { error: "保存状态审计操作失败，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}
