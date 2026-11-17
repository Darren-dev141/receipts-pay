import fs from "node:fs";
import path from "node:path";
import type { SessionState } from "@/lib/session/types";

export class CorruptSessionError extends Error {
  constructor(filePath: string, reason: string) {
    super(
      `Session file ${filePath} is corrupt (${reason}). Refusing to reset it, because a fresh session could send the same invoice twice.`,
    );
    this.name = "CorruptSessionError";
  }
}

export interface Store {
  read(): SessionState | null;
  write(state: SessionState): void;
}

export function createMemoryStore(initial: SessionState | null = null): Store {
  let state = initial;
  return {
    read: () => state,
    write: (next) => {
      state = next;
    },
  };
}

function isSessionState(value: unknown): value is SessionState {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as SessionState).facts);
}

export function createFileStore(filePath: string): Store {
  return {
    read() {
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new CorruptSessionError(filePath, "not valid JSON");
      }
      if (!isSessionState(parsed)) {
        throw new CorruptSessionError(filePath, "not a session");
      }
      return parsed;
    },
    write(state) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state));
      fs.renameSync(temporary, filePath);
    },
  };
}

export function defaultSessionPath(): string {
  return path.join(process.cwd(), ".data", "session.json");
}
