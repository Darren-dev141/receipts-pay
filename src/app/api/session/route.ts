import { loadSession } from "@/lib/session/service";
import { handle } from "@/lib/session/respond";

export async function GET() {
  return handle((deps) => loadSession(deps));
}
