import { createInteractionEvent } from "@genui-canvas/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SequenceConflictError, createSession, postEvent, postTurn } from "./client.js";

const EVENT = createInteractionEvent({
  sessionId: "11111111-1111-4111-8111-111111111111",
  seq: 0,
  actor: "user",
  type: "card.pin",
  context: { compositionId: "comp-1", visibleCardIds: [] },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSession", () => {
  it("rejects a malformed session identifier from the wire", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ sessionId: "../not-a-session" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(createSession()).rejects.toThrow();
  });

  it("reads the server-issued next sequence and defaults it to zero when absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ sessionId: "11111111-1111-4111-8111-111111111111", nextSeq: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(createSession()).resolves.toEqual({
      sessionId: "11111111-1111-4111-8111-111111111111",
      nextSeq: 1,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ sessionId: "11111111-1111-4111-8111-111111111111" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(createSession()).resolves.toEqual({
      sessionId: "11111111-1111-4111-8111-111111111111",
      nextSeq: 0,
    });
  });
});

describe("postEvent", () => {
  it("retries the exact same event once after a transient server failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postEvent(EVENT)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
  });

  it("does not retry a permanent client error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("conflict", { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postEvent(EVENT)).rejects.toThrow("HTTP 409");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's next sequence on a sequence conflict without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "Event sequence conflict", nextSeq: 5 }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await postEvent(EVENT).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SequenceConflictError);
    expect((error as SequenceConflictError).nextSeq).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an identity conflict", { ok: false, error: "Event identity conflict" }],
    ["a malformed next sequence", { ok: false, error: "Event sequence conflict", nextSeq: -1 }],
    ["a fractional next sequence", { ok: false, error: "Event sequence conflict", nextSeq: 1.5 }],
  ])("keeps %s a plain HTTP 409 error", async (_case, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 })),
    );
    const error = await postEvent(EVENT).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(SequenceConflictError);
    expect(String(error)).toContain("HTTP 409");
  });
});

describe("postTurn", () => {
  it("rejects a stream with no validated terminal composition or error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('event: status\ndata: {"kind":"status","message":"검색 중"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );

    await expect(
      postTurn({
        sessionId: "11111111-1111-4111-8111-111111111111",
        trigger: { type: "query.submit", text: "서울 청년 지원" },
        profile: {},
        currentComposition: { cards: [] },
      }),
    ).rejects.toThrow("validated terminal event");
  });
});
