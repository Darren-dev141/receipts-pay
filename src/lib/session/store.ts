import fs from "node:fs";
import path from "node:path";
import type { SessionState } from "@/lib/session/types";

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

export function createFileStore(filePath: string): Store {
  return {
    read() {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as SessionState;
        if (!parsed || !Array.isArray(parsed.facts)) return null;
        return parsed;
      } catch {
        return null;
      }
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
