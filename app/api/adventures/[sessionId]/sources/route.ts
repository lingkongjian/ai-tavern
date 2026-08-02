import { getDb } from "@/db";
import {
  parseSourceDocumentInput,
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const documents = new LocalStoryStore(getDb()).listSourceDocuments(sessionId);
    return noStoreJson({ documents });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return noStoreJson({ error: error.message }, { status: 404 });
    }
    console.error("读取原文参考资料失败", error);
    return noStoreJson({ error: "暂时无法读取原文参考资料。" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const document = parseSourceDocumentInput(await request.json());
    const created = new LocalStoryStore(getDb()).importSourceDocument(
      sessionId,
      document,
    );
    return noStoreJson({ document: created }, { status: 201 });
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
    console.error("导入原文参考资料失败", error);
    return noStoreJson(
      { error: "导入原文参考失败，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}
