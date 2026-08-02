import {
  ImportFileError,
  parseImportPreviewRequest,
} from "@/lib/import/酒馆文件";
import { parseAdventureBundleDocument } from "@/lib/import/剧本包";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.kind === "adventure_bundle") {
      if (typeof body.fileName !== "string" || !body.fileName.trim()) {
        throw new ImportFileError(["缺少导入文件名。"]);
      }
      return noStoreJson({
        fileName: body.fileName.trim().slice(0, 255),
        preview: parseAdventureBundleDocument(body.document),
      });
    }
    const { fileName, preview } = parseImportPreviewRequest(body);
    return noStoreJson({ fileName, preview });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "文件内容不是有效 JSON。" }, { status: 400 });
    }
    if (error instanceof ImportFileError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    console.error("预览导入文件失败", error);
    return noStoreJson(
      { error: "无法解析导入文件，本地存档没有发生变化。" },
      { status: 500 },
    );
  }
}
