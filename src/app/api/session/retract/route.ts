import { retractAndRevise } from "@/lib/session/service";
import { handle } from "@/lib/session/respond";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { factId?: unknown } | null;
  const factId = typeof body?.factId === "string" ? body.factId : "";
  return handle((deps) => retractAndRevise(deps, factId));
}
