import { getDb } from "@/db";
import { LocalStoryStore } from "@/lib/storage/story-store";
import {
  AdventureInputError,
  parseStartAdventureInput,
} from "@/lib/story/开局";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET() {
  try {
    const adventures = new LocalStoryStore(getDb()).listAdventures();
    return noStoreJson({ adventures });
  } catch (error) {
    console.error("读取本地战役失败", error);
    return noStoreJson(
      { error: "暂时无法读取本地战役，请稍后重试。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const warnings: string[] = [];
    const input = parseStartAdventureInput(body, warnings);
    const adventure = new LocalStoryStore(getDb()).startAdventure(input);
    return noStoreJson(
      { adventure, ...(warnings.length > 0 ? { warnings } : {}) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AdventureInputError) {
      return noStoreJson(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return noStoreJson({ error: "请求内容不是有效 JSON。" }, { status: 400 });
    }

    console.error("创建本地战役失败", error);
    return noStoreJson(
      { error: "创建战役失败，本地数据没有被部分保存。" },
      { status: 500 },
    );
  }
}
