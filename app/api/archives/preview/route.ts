import {
  CompleteArchiveError,
  previewCompleteArchive,
} from "@/lib/import/完整存档";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { document?: unknown };
    return noStoreJson({ preview: previewCompleteArchive(body.document) });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "文件内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof CompleteArchiveError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    console.error("预览完整存档失败", error);
    return noStoreJson(
      { error: "无法校验完整存档，本地数据没有发生变化。" },
      { status: 500 },
    );
  }
}
