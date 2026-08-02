import {
  createDefaultDatabaseBackup,
  getDb,
  listDefaultDatabaseBackups,
  restoreDefaultDatabaseBackup,
} from "@/db";
import { LocalStoryStore } from "@/lib/storage/story-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET() {
  try {
    getDb();
    return noStoreJson({ backups: listDefaultDatabaseBackups() });
  } catch (error) {
    console.error("读取本地备份失败", error);
    return noStoreJson({ error: "暂时无法读取本地备份。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      operation?: unknown;
      fileName?: unknown;
    };
    if (body.operation === "create") {
      const backup = createDefaultDatabaseBackup("manual");
      return noStoreJson({ backup, backups: listDefaultDatabaseBackups() }, { status: 201 });
    }
    if (body.operation === "restore") {
      if (typeof body.fileName !== "string" || !body.fileName.trim()) {
        return noStoreJson({ error: "请选择需要恢复的备份。" }, { status: 400 });
      }
      const restored = restoreDefaultDatabaseBackup(body.fileName.trim());
      const adventures = new LocalStoryStore(getDb()).listAdventures();
      return noStoreJson({ restored, backups: listDefaultDatabaseBackups(), adventures });
    }
    return noStoreJson({ error: "不支持该备份操作。" }, { status: 400 });
  } catch (error) {
    console.error("执行本地备份操作失败", error);
    return noStoreJson(
      { error: "备份操作失败；恢复失败时系统已尝试回到操作前数据。" },
      { status: 500 },
    );
  }
}
