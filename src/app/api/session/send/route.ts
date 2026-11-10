import { sendCurrentInvoice } from "@/lib/session/service";
import { handle } from "@/lib/session/respond";

export async function POST() {
  return handle((deps) => sendCurrentInvoice(deps));
}
