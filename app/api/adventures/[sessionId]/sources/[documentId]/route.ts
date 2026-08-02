import { getDb } from "@/db";
import {
  parseSourceDocumentSettings,
  SourceReferenceInputError,
} from "@/lib/reference/原文参考";
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string; documentId: string }> },
) {
  const { sessionId, documentId } = await context.params;
  try {
    const patch = parseSourceDocumentSettings(await request.json());
    const document = new LocalStoryStore(getDb()).updateSourceDocument(
      sessionId,
      documentId,
      patch,
    );
    return noStoreJson({ document });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof SourceReferenceInputError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("修改原文参考资料失败", error);
    return noStoreJson({ error: "暂时无法修改原文参考设置。" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string; documentId: string }> },
) {
  const { sessionId, documentId } = await context.params;
  try {
    const deleted = new LocalStoryStore(getDb()).deleteSourceDocument(
      sessionId,
      documentId,
    );
    return noStoreJson({ deleted });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("删除原文参考资料失败", error);
    return noStoreJson({ error: "暂时无法删除原文参考资料。" }, { status: 500 });
  }
}
