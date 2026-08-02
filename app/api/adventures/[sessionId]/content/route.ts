import { getDb } from "@/db";
import {
  executeStoryContentCommand,
  isStoryContentManagementError,
  loadStoryContentWorkspace,
  StoryContentInputError,
  storyContentErrorBody,
} from "@/lib/content/剧本内容服务";
import { SourceReferenceInputError } from "@/lib/reference/原文参考";
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
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const includeAudit =
      new URL(request.url).searchParams.get("audit") !== "false";
    return noStoreJson(
      loadStoryContentWorkspace({
        store: new LocalStoryStore(getDb()),
        sessionId,
        includeAudit,
      }),
    );
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson(
        storyContentErrorBody({
          code: "story_not_found",
          message: error.message,
        }),
        { status: 404 },
      );
    }
    console.error("读取统一剧本内容失败", error);
    return noStoreJson(
      storyContentErrorBody({
        code: "content_workspace_unavailable",
        message: "读取剧本内容失败。",
      }),
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const body = executeStoryContentCommand({
      store: new LocalStoryStore(getDb()),
      sessionId,
      value: await request.json(),
    });
    return noStoreJson(body, {
      status:
        !body.result.reused &&
        (body.result.operation === "create" ||
          body.result.operation === "import")
          ? 201
          : 200,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson(
        storyContentErrorBody({
          code: "invalid_json",
          message: "请求内容不是有效 JSON。",
        }),
        { status: 400 },
      );
    }
    if (error instanceof StoryContentInputError) {
      return noStoreJson(
        storyContentErrorBody({
          code: "invalid_content_command",
          message: error.message,
          issues: error.issues,
          domain: error.domain,
        }),
        { status: 400 },
      );
    }
    if (isStoryContentManagementError(error)) {
      return noStoreJson(
        storyContentErrorBody({
          code: "content_command_rejected",
          message: error instanceof Error ? error.message : "内容操作被拒绝。",
          ...(error instanceof SourceReferenceInputError
            ? { issues: error.issues, domain: "sources" as const }
            : {}),
        }),
        { status: 400 },
      );
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson(
        storyContentErrorBody({
          code: "story_not_found",
          message: error.message,
        }),
        { status: 404 },
      );
    }
    console.error("保存统一剧本内容操作失败", error);
    return noStoreJson(
      storyContentErrorBody({
        code: "content_command_failed",
        message: "保存剧本内容失败，本地存档没有发生变化。",
      }),
      { status: 500 },
    );
  }
}
