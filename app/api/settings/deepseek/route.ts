import { getDeepSeekStatus } from "@/lib/ai/深度求索";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getDeepSeekStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
