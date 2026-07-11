import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotenv } from "./env.js";

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env.GENUI_TEST_KEY;
});

function tmpEnvFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "genui-env-"));
  created.push(dir);
  const path = join(dir, ".env");
  writeFileSync(path, contents);
  return path;
}

describe("loadDotenv", () => {
  it("loads key=value pairs from the file into process.env", () => {
    const path = tmpEnvFile("GENUI_TEST_KEY=hello-byok\n");
    loadDotenv(path);
    expect(process.env.GENUI_TEST_KEY).toBe("hello-byok");
  });

  it("is a no-op (no throw) when the file is absent", () => {
    expect(() => loadDotenv(join(tmpdir(), "definitely-missing-genui.env"))).not.toThrow();
  });
});
