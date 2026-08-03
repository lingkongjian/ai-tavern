import { getDb } from "@/db";
import {
  AttributeCheckResolutionError,
  BranchHeadConflictError,
  LocalStoryStore,
  StoryNotFoundError,
} from "@/lib/storage/story-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseResolveBody(value: unknown) {
  const issues: string[] = [];
  const actionId =
    isRecord(value) && typeof value.actionId === "string"
      ? value.actionId.trim()
      : "";
  const expectedHeadTurnId =
    isRecord(value) && typeof value.expectedHeadTurnId === "string"
      ? value.expectedHeadTurnId.trim()
      : "";
  const pendingTurnId =
    isRecord(value) && typeof value.pendingTurnId === "string"
      ? value.pendingTurnId.trim()
      : "";
  if (!actionId) issues.push("缺少判定结算请求标识。");
  if (!expectedHeadTurnId) issues.push("缺少当前最新回合 ID。");
  if (!pendingTurnId) issues.push("缺少待确认的回合 ID。");
  const rawResults = isRecord(value) ? value.results : undefined;
  if (!Array.isArray(rawResults)) {
    issues.push("判定结果必须是数组。");
  }
  const results: Array<{ checkId: string; roll: number | null }> = [];
  if (Array.isArray(rawResults)) {
    for (const [index, item] of rawResults.entries()) {
      if (!isRecord(item)) {
        issues.push(`判定结果第 ${index + 1} 项格式无效。`);
        continue;
      }
      const checkId =
        typeof item.checkId === "string" ? item.checkId.trim() : "";
      if (!checkId) issues.push(`判定结果第 ${index + 1} 项缺少 checkId。`);
      const roll = item.roll;
      if (roll !== null && (typeof roll !== "number" || !Number.isInteger(roll) || roll < 1 || roll > 100)) {
        issues.push(
          `判定结果第 ${index + 1} 项的骰子点数必须是 1 到 100 之间的整数或 null。`,
        );
      }
      if (checkId) {
        results.push({
          checkId,
          roll: roll === null ? null : (roll as number),
        });
      }
    }
  }
  return { actionId, expectedHeadTurnId, pendingTurnId, results, issues };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
  }

  const parsed = parseResolveBody(body);
  if (parsed.issues.length > 0) {
    return noStoreJson(
      { error: parsed.issues[0], issues: parsed.issues },
      { status: 400 },
    );
  }

  try {
    const store = new LocalStoryStore(getDb());
    const result = store.resolvePendingTurnChecks({
      sessionId,
      pendingTurnId: parsed.pendingTurnId,
      expectedHeadTurnId: parsed.expectedHeadTurnId,
      results: parsed.results,
    });
    return noStoreJson({
      actionId: parsed.actionId,
      adventure: store.loadAdventure(sessionId),
      committedTurn: result.committedTurn,
      resolutions: result.resolutions,
    });
  } catch (error) {
    if (error instanceof AttributeCheckResolutionError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    if (error instanceof BranchHeadConflictError) {
      return noStoreJson(
        {
          error: error.message,
          expectedHeadTurnId: error.expectedHeadTurnId,
          actualHeadTurnId: error.actualHeadTurnId,
        },
        { status: 409 },
      );
    }
    console.error("结算属性判定失败", error);
    return noStoreJson(
      { error: "属性判定结算失败，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}
