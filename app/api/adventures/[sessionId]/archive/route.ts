import { getDb } from "@/db";
import {
  exportCompleteAdventure,
} from "@/lib/import/完整存档";
import { StoryNotFoundError } from "@/lib/storage/story-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 60) || "未命名剧本";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const archive = exportCompleteAdventure(getDb(), sessionId);
    const date = archive.exportedAt.slice(0, 10);
    const fileName = `完整存档_${safeFileName(archive.summary.campaignName)}_${date}.json`;
    return new Response(JSON.stringify(archive, null, 2), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ai-tavern-archive-${date}.json"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      return Response.json(
        { error: error.message },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("导出完整存档失败", error);
    return Response.json(
      { error: "导出完整存档失败，本地剧本没有发生变化。" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
