import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dev server", () => {
  it("binds to 127.0.0.1", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: { dev: string; demo: string };
    };
    for (const script of [pkg.scripts.dev, pkg.scripts.demo]) {
      expect(script).toContain("-H 127.0.0.1");
      expect(script).not.toContain("0.0.0.0");
    }
  });
});
