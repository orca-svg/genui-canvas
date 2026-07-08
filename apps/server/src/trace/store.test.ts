import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInteractionEvent } from "@genui-canvas/contracts";
import { TraceStore } from "./store.js";

let dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "genui-trace-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const event = (sessionId: string, seq: number) =>
  createInteractionEvent({
    sessionId,
    seq,
    actor: "user",
    type: "card.pin",
    target: { cardId: "c1" },
    context: { compositionId: "comp1", visibleCardIds: ["c1"] },
  });

describe("TraceStore", () => {
  it("appends events and reads them back in order", () => {
    const store = new TraceStore(tempDir());
    store.append(event("s1", 0));
    store.append(event("s1", 1));
    const events = store.read("s1");
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it("isolates events by session", () => {
    const store = new TraceStore(tempDir());
    store.append(event("s1", 0));
    store.append(event("s2", 0));
    expect(store.read("s1")).toHaveLength(1);
    expect(store.read("s2")).toHaveLength(1);
  });

  it("returns an empty array for an unknown session", () => {
    expect(new TraceStore(tempDir()).read("nope")).toEqual([]);
  });
});
