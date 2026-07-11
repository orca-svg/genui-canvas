import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const SESSION_A = "00000000-0000-4000-8000-000000000001";
const SESSION_B = "00000000-0000-4000-8000-000000000002";
const UNKNOWN_SESSION = "00000000-0000-4000-8000-000000000003";

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
  it("does not read a trace file outside its storage root", () => {
    const base = tempDir();
    const root = join(base, "root");
    const store = new TraceStore(root);
    writeFileSync(
      join(base, "outside.jsonl"),
      `${JSON.stringify(event("../outside", 0))}\n`,
      "utf8",
    );
    expect(() => store.read("../outside")).toThrow(/session id/i);
  });

  it("does not append a trace file outside its storage root", () => {
    const store = new TraceStore(join(tempDir(), "root"));
    expect(() => store.append(event("../outside", 0))).toThrow(/session id/i);
  });

  it("appends events and reads them back in order", () => {
    const store = new TraceStore(tempDir());
    store.append(event(SESSION_A, 0));
    store.append(event(SESSION_A, 1));
    const events = store.read(SESSION_A);
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it("recovers the next sequence once when reopening an existing trace", () => {
    const dir = tempDir();
    new TraceStore(dir).append(event(SESSION_A, 0));
    const reopened = new TraceStore(dir);
    reopened.append(event(SESSION_A, 1));
    expect(reopened.read(SESSION_A).map((stored) => stored.seq)).toEqual([0, 1]);
  });

  it("rejects a first event whose sequence does not start at zero", () => {
    const store = new TraceStore(tempDir());
    expect(() => store.append(event(SESSION_A, 1))).toThrow(/sequence/i);
  });

  it("rejects a duplicate sequence without changing the trace", () => {
    const store = new TraceStore(tempDir());
    store.append(event(SESSION_A, 0));
    expect(() => store.append(event(SESSION_A, 0))).toThrow(/sequence/i);
    expect(store.read(SESSION_A).map((stored) => stored.seq)).toEqual([0]);
  });

  it("rejects an out-of-order sequence without changing the trace", () => {
    const store = new TraceStore(tempDir());
    store.append(event(SESSION_A, 0));
    expect(() => store.append(event(SESSION_A, 2))).toThrow(/sequence/i);
    expect(store.read(SESSION_A).map((stored) => stored.seq)).toEqual([0]);
  });

  it("isolates events by session", () => {
    const store = new TraceStore(tempDir());
    store.append(event(SESSION_A, 0));
    store.append(event(SESSION_B, 0));
    expect(store.read(SESSION_A)).toHaveLength(1);
    expect(store.read(SESSION_B)).toHaveLength(1);
  });

  it("returns an empty array for an unknown session", () => {
    expect(new TraceStore(tempDir()).read(UNKNOWN_SESSION)).toEqual([]);
  });
});
