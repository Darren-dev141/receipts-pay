import { resetSession } from "@/lib/session/service";
import { handle } from "@/lib/session/respond";

export async function POST() {
  return handle((deps) => resetSession(deps));
}
