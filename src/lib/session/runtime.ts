import { createMockGateway, resolvePaypalMode } from "@/lib/paypal/mode";
import type { Deps } from "@/lib/session/service";
import { SessionError } from "@/lib/session/service";
import type { Store } from "@/lib/session/store";

export async function createRuntime(
  store: Store,
  env: Record<string, string | undefined> = process.env,
): Promise<Deps> {
  const resolved = resolvePaypalMode(env);
  if ("error" in resolved) {
    throw new SessionError(resolved.error, 400);
  }
  const gateway =
    resolved.mode === "sandbox"
      ? (await import("@/lib/paypal/sandbox")).createSandboxGateway()
      : createMockGateway();
  return {
    now: () => new Date(),
    gateway,
    store,
    mode: resolved.mode,
    warning: resolved.warning,
    recipientEmail: resolved.recipientEmail,
    invoicerEmail: resolved.invoicerEmail,
  };
}
