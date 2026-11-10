import { connection } from "next/server";
import type { Deps } from "@/lib/session/service";
import { SessionError } from "@/lib/session/service";
import type { PublicSession } from "@/lib/session/types";
import { createRuntime } from "@/lib/session/runtime";
import { createFileStore, defaultSessionPath } from "@/lib/session/store";

export async function handle(action: (deps: Deps) => Promise<PublicSession>): Promise<Response> {
  await connection();
  try {
    const deps = await createRuntime(createFileStore(defaultSessionPath()));
    const session = await action(deps);
    return Response.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    const status = error instanceof SessionError ? error.status : 500;
    const session = error instanceof SessionError ? error.session : null;
    return Response.json({ error: message, session }, { status });
  }
}
