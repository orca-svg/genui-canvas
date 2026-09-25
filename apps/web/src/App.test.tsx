import { StrictMode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function compositionSse(title = "테스트 혜택"): string {
  return compositionSseFor([{ entityId: "test-benefit", title }]);
}

function compositionSseFor(
  cards: Array<{ entityId: string; title: string; cardId?: string; hidden?: boolean }>,
  includeMetadata = false,
): string {
  const messages = cards.flatMap(({ entityId, title, cardId: requestedCardId }) => {
    const cardId = requestedCardId ?? `card-${entityId}`;
    return [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: cardId,
          catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: cardId,
          components: [{ id: "root", component: "Text", text: { path: "/title" } }],
        },
      },
      {
        version: "v0.9",
        updateDataModel: { surfaceId: cardId, path: "/", value: { title } },
      },
    ];
  });
  return `event: composition\ndata: ${JSON.stringify({
    kind: "composition",
    compositionId: "comp-test",
    messages,
    cards: cards.map(({ entityId, title, cardId, hidden }) => ({
      cardId: cardId ?? `card-${entityId}`,
      entityId,
      componentType: "BenefitCard",
      ...(hidden ? { hidden: true } : {}),
      ...(includeMetadata
        ? {
            title,
            sourceUrl: `https://www.gov.kr/benefit/${entityId}`,
            sourceCheckedAt: "2026-07-10T00:00:00.000Z",
          }
        : {}),
    })),
  })}\n\n`;
}

const CATALOG = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";

function sseFrame(event: Record<string, unknown>): string {
  return `event: ${String(event.kind)}\ndata: ${JSON.stringify(event)}\n\n`;
}

interface InteractiveOptions {
  nextSeq?: number;
  hiddenEntityId?: string;
  /** Trace-derived ticked rows the server pre-fills on checklist-a. */
  checkedItems?: number[];
  /** Compose without checklist-a (the candidate's Checklist drops out of this turn). */
  withoutChecklist?: boolean;
}

function interactiveCompositionSse(options: InteractiveOptions = {}): string {
  const checked0 = options.checkedItems?.includes(0) === true;
  const messages = [
    { version: "v0.9", createSurface: { surfaceId: "card-a", catalogId: CATALOG } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "card-a",
        components: [{ id: "root", component: "Text", text: { path: "/title" } }],
      },
    },
    { version: "v0.9", updateDataModel: { surfaceId: "card-a", path: "/", value: { title: "혜택 A 본문" } } },
    ...(options.withoutChecklist
      ? []
      : [
          { version: "v0.9", createSurface: { surfaceId: "checklist-a", catalogId: CATALOG } },
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: "checklist-a",
              components: [
                { id: "root", component: "Column", children: ["check-0"] },
                { id: "check-0", component: "CheckBox", label: { path: "/item0Text" }, value: { path: "/checked0" } },
              ],
            },
          },
          {
            version: "v0.9",
            updateDataModel: { surfaceId: "checklist-a", path: "/", value: { item0Text: "재학증명서", checked0 } },
          },
        ]),
    { version: "v0.9", createSurface: { surfaceId: "personas", catalogId: CATALOG } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "personas",
        components: [
          { id: "root", component: "Column", children: ["persona-0"] },
          {
            id: "persona-0",
            component: "Button",
            child: "persona-0-label",
            action: { event: { name: "persona.select", context: { personaId: "senior" } } },
          },
          { id: "persona-0-label", component: "Text", text: { path: "/persona0Label" } },
        ],
      },
    },
    { version: "v0.9", updateDataModel: { surfaceId: "personas", path: "/", value: { persona0Label: "시니어" } } },
    ...(options.hiddenEntityId
      ? [
          { version: "v0.9", createSurface: { surfaceId: `card-${options.hiddenEntityId}`, catalogId: CATALOG } },
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: `card-${options.hiddenEntityId}`,
              components: [{ id: "root", component: "Text", text: { path: "/title" } }],
            },
          },
          {
            version: "v0.9",
            updateDataModel: { surfaceId: `card-${options.hiddenEntityId}`, path: "/", value: { title: "숨긴 혜택 본문" } },
          },
        ]
      : []),
  ];
  const cards = [
    { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "혜택 A", emphasis: "primary" },
    ...(options.withoutChecklist
      ? []
      : [
          {
            cardId: "checklist-a",
            entityId: "a",
            componentType: "Checklist",
            title: "혜택 A · 신청 준비",
            itemCount: 1,
            ...(options.checkedItems ? { checkedItems: options.checkedItems } : {}),
          },
        ]),
    { cardId: "personas", componentType: "PersonaSelector", title: "추천 관점" },
    ...(options.hiddenEntityId
      ? [{ cardId: `card-${options.hiddenEntityId}`, entityId: options.hiddenEntityId, componentType: "BenefitCard", title: "숨긴 혜택", hidden: true }]
      : []),
  ];
  return (
    sseFrame({ kind: "intent", text: "테스트 의도 문장" }) +
    sseFrame({ kind: "composition", compositionId: "comp-interactive", messages, cards, ...(options.nextSeq !== undefined ? { nextSeq: options.nextSeq } : {}) })
  );
}

/** fetch mock: session → interactive composition on every turn; collects event and turn bodies. */
function interactiveFetch(options: InteractiveOptions & { sessionNextSeq?: number } = {}) {
  const eventBodies: Array<Record<string, unknown>> = [];
  const turnBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/session")) {
      return new Response(
        JSON.stringify({ sessionId: SESSION_ID, ...(options.sessionNextSeq !== undefined ? { nextSeq: options.sessionNextSeq } : {}) }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/api/events")) {
      eventBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.endsWith("/api/turn")) {
      turnBodies.push(JSON.parse(String(init?.body)));
      return new Response(interactiveCompositionSse(options), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { eventBodies, turnBodies };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("announces asynchronous status updates without moving focus", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(<App />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(screen.getByRole("button", { name: "혜택 찾기" })).toBeEnabled());
  });

  it("creates only one session when React StrictMode replays effects", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ sessionId: SESSION_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "혜택 찾기" })).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers a keyboard skip link to the recommendation results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(<App />);
    expect(screen.getByRole("link", { name: "추천 결과로 건너뛰기" })).toHaveAttribute(
      "href",
      "#recommendation-results",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "혜택 찾기" })).toBeEnabled());
  });

  it("frames recommendations as candidates that require official-source verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(<App />);
    expect(
      screen.getByText(
        "추천 결과는 신청 가능성을 보장하지 않는 후보 정보입니다. 자격·마감일·서류는 출처 페이지에서 확인하고 해당 기관의 공식 주소인지 다시 확인하세요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "현재 연결된 게이트웨이 v0.3.0은 검증용 예시(fixture) 데이터를 제공합니다. 실제 정책 데이터가 아닙니다.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "혜택 검색" })).toHaveAttribute(
      "maxlength",
      "300",
    );
    expect(
      screen.getByText("이름·주민번호·연락처 등 개인식별정보는 입력하지 마세요. 최대 300자입니다."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "혜택 찾기" })).toBeEnabled());
  });

  it("lets a user submit a custom benefit query and renders the composition", async () => {
    const turnBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/events")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        turnBodies.push(JSON.parse(String(init?.body)));
        return new Response(compositionSse(), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    const query = await screen.findByRole("searchbox", { name: "혜택 검색" });
    await user.clear(query);
    await user.type(query, "부산 청년 창업 지원");
    await user.click(screen.getByRole("button", { name: "혜택 찾기" }));

    expect(await screen.findByText("테스트 혜택")).toBeInTheDocument();
    await waitFor(() => {
      expect(turnBodies).toHaveLength(1);
    });
    expect(turnBodies[0]).toMatchObject({
      trigger: { type: "query.submit", text: "부산 청년 창업 지원" },
      profile: { persona: "university_student" },
    });
    expect(turnBodies[0]).not.toMatchObject({ profile: { regionCode: "KR-11" } });
  });

  it("preserves trusted card titles and source metadata in the manipulation shell", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/events")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        return new Response(
          compositionSseFor([{ entityId: "benefit-1", title: "사람이 읽는 혜택명" }], true),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));

    expect((await screen.findAllByText("사람이 읽는 혜택명")).length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("link", { name: "사람이 읽는 혜택명 출처 페이지 열기" }),
    ).toHaveAttribute("href", "https://www.gov.kr/benefit/benefit-1");
  });

  it("preserves semantic pin/hidden state when a recomposition renames the card id", async () => {
    const turnBodies: Array<Record<string, unknown>> = [];
    let turnCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), { status: 200 });
      }
      if (url.endsWith("/api/events")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        turnBodies.push(JSON.parse(String(init?.body)));
        turnCount += 1;
        return new Response(
          compositionSseFor(
            [
              {
                entityId: "same-benefit",
                title: "동일 혜택",
                cardId: turnCount === 1 ? "old-card" : "new-card",
              },
            ],
            true,
          ),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));
    await screen.findByRole("button", { name: "동일 혜택 고정" });
    await user.click(screen.getByRole("button", { name: "동일 혜택 고정" }));
    await user.click(screen.getByRole("button", { name: "동일 혜택 숨기기" }));
    await user.click(screen.getByRole("button", { name: "조작 반영해 재구성" }));

    await waitFor(() => expect(turnBodies).toHaveLength(2));
    expect(turnBodies[1]).toMatchObject({
      currentComposition: {
        cards: [
          expect.objectContaining({
            cardId: "old-card",
            pinned: true,
            hidden: true,
            expanded: false,
          }),
        ],
      },
    });
    expect(await screen.findByRole("button", { name: "동일 혜택 고정 해제" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "동일 혜택 다시 보기" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("merges shell rows by entity, not by a reused positional card id", async () => {
    const turnBodies: Array<Record<string, unknown>> = [];
    let turnCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), { status: 200 });
      }
      if (url.endsWith("/api/events")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        turnBodies.push(JSON.parse(String(init?.body)));
        turnCount += 1;
        // Turn 1: only alpha, on card-1. Turn 2: a brand-new entity "beta"
        // reuses card-1 (the positional id alpha, now pinned, used to own),
        // and alpha reappears under a different id, card-2.
        const cards =
          turnCount === 1
            ? [{ entityId: "alpha", title: "알파 혜택", cardId: "card-1" }]
            : [
                { entityId: "beta", title: "베타 혜택", cardId: "card-1" },
                { entityId: "alpha", title: "알파 혜택", cardId: "card-2" },
              ];
        return new Response(compositionSseFor(cards), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));
    await screen.findByRole("button", { name: "alpha 고정" });
    await user.click(screen.getByRole("button", { name: "alpha 고정" }));
    await user.click(screen.getByRole("button", { name: "조작 반영해 재구성" }));

    await waitFor(() => expect(turnBodies).toHaveLength(2));
    expect(await screen.findByRole("button", { name: "alpha 고정 해제" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // beta is a brand-new entity: it must not inherit alpha's pin just
    // because the provider happened to reuse alpha's old card id for it.
    expect(screen.getByRole("button", { name: "beta 고정" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("records the query before composition and records the applied result afterwards", async () => {
    const calls: string[] = [];
    const eventBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        calls.push("session");
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/events")) {
        calls.push("event");
        eventBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        calls.push("turn");
        return new Response(compositionSse(), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    const query = await screen.findByRole("searchbox", { name: "혜택 검색" });
    await user.clear(query);
    await user.type(query, "서울 주거 지원");
    await user.click(screen.getByRole("button", { name: "혜택 찾기" }));
    expect(await screen.findByText("테스트 혜택")).toBeInTheDocument();
    await waitFor(() => expect(eventBodies).toHaveLength(2));

    expect(calls).toEqual(["session", "event", "turn", "event"]);
    expect(eventBodies[0]).toMatchObject({
      seq: 0,
      actor: "user",
      type: "query.submit",
      payload: { text: "서울 주거 지원" },
    });
    expect(eventBodies[1]).toMatchObject({
      seq: 1,
      actor: "system",
      type: "composition.applied",
      context: { compositionId: "comp-test" },
    });
  });

  it("counts only the visible cards in the status fallback sentence", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), { status: 200 });
      }
      if (url.endsWith("/api/events")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        // No "intent" frame: the client falls back to counting cards itself.
        return new Response(
          compositionSseFor([
            { entityId: "alpha", title: "첫 번째 혜택" },
            { entityId: "beta", title: "두 번째 혜택", hidden: true },
            { entityId: "gamma", title: "세 번째 혜택" },
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("2개 카드를 구성했습니다."),
    );
  });

  it("explains when a composition arrives with every card hidden", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), { status: 200 });
      }
      if (url.endsWith("/api/events")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        return new Response(
          compositionSseFor([
            { entityId: "alpha", title: "첫 번째 혜택", hidden: true },
            { entityId: "beta", title: "두 번째 혜택", hidden: true },
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "보이는 카드가 없습니다. 숨긴 카드는 사이드바에서 다시 볼 수 있습니다.",
      ),
    );
  });

  it("keeps a successful composition applied when only its audit event fails", async () => {
    const eventBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), { status: 200 });
      }
      if (url.endsWith("/api/events")) {
        const event = JSON.parse(String(init?.body)) as Record<string, unknown>;
        eventBodies.push(event);
        return event.type === "composition.applied"
          ? new Response("audit rejected", { status: 400 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        return new Response(compositionSse("적용된 새 혜택"), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));

    expect(await screen.findByText("적용된 새 혜택")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "새 추천 결과는 반영했지만 적용 기록을 저장하지 못했습니다. 서버 연결을 확인하세요.",
      ),
    ).toBeInTheDocument();
    expect(eventBodies.map((event) => event.type)).toEqual([
      "query.submit",
      "composition.applied",
    ]);
    expect(eventBodies.some((event) => event.type === "composition.rejected")).toBe(false);
  });

  it("waits for a manipulation trace acknowledgement before recomposing", async () => {
    let releasePin: (() => void) | undefined;
    let turnCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/events")) {
        const event = JSON.parse(String(init?.body)) as { type: string };
        if (event.type === "card.pin") {
          await new Promise<void>((resolve) => {
            releasePin = resolve;
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        turnCount += 1;
        return new Response(compositionSse(), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));
    expect(await screen.findByText("테스트 혜택")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "test-benefit 고정" }));
    await user.click(screen.getByRole("button", { name: "조작 반영해 재구성" }));
    await waitFor(() => expect(releasePin).toBeTypeOf("function"));
    expect(turnCount).toBe(1);

    releasePin?.();
    await waitFor(() => expect(turnCount).toBe(2));
  });

  it("uses the visible draft query when a persona change triggers composition", async () => {
    const turnBodies: Array<Record<string, unknown>> = [];
    const eventBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/events")) {
        eventBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        turnBodies.push(JSON.parse(String(init?.body)));
        return new Response(compositionSse(), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    const query = await screen.findByRole("searchbox", { name: "혜택 검색" });
    await user.clear(query);
    await user.type(query, "부산 청년 창업 지원");
    const persona = await screen.findByRole("combobox", { name: "추천 관점" });
    await user.selectOptions(persona, "youth_jobseeker");
    expect(await screen.findByText("테스트 혜택")).toBeInTheDocument();

    expect(turnBodies[0]).toMatchObject({
      trigger: { type: "persona.switch", personaId: "youth_jobseeker" },
      query: "부산 청년 창업 지원",
      profile: { persona: "youth_jobseeker" },
    });
    expect(eventBodies[0]).toMatchObject({
      type: "persona.switch",
      payload: { personaId: "youth_jobseeker" },
    });
  });

  it("reorders cards immediately and records the target index", async () => {
    const eventBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/events")) {
        eventBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        return new Response(
          compositionSseFor([
            { entityId: "alpha", title: "첫 번째 혜택" },
            { entityId: "beta", title: "두 번째 혜택" },
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));
    expect(await screen.findByText("첫 번째 혜택")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "alpha 아래로 이동" }));
    const order = [...container.querySelectorAll(".genui-canvas-card")].map((element) =>
      element.getAttribute("data-card-id"),
    );
    expect(order).toEqual(["card-beta", "card-alpha"]);
    await waitFor(() =>
      expect(eventBodies).toContainEqual(
        expect.objectContaining({
          type: "card.reorder",
          target: expect.objectContaining({ entityId: "alpha" }),
          payload: { toIndex: 1 },
        }),
      ),
    );
  });

  it("undoes and redoes a direct manipulation while recording the inverse trace", async () => {
    const eventBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/events")) {
        eventBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        return new Response(compositionSseFor([
          { entityId: "alpha", title: "첫 번째 혜택" },
          { entityId: "beta", title: "두 번째 혜택" },
        ]), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));
    expect(await screen.findByText("첫 번째 혜택")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "beta 고정" }));
    expect(screen.getByRole("button", { name: "beta 고정 해제" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "beta 아래로 이동" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "alpha 위로 이동" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "실행 취소" }));
    expect(screen.getByRole("button", { name: "beta 고정" })).toHaveAttribute("aria-pressed", "false");
    expect([...container.querySelectorAll(".genui-canvas-card")].map((card) => card.getAttribute("data-card-id"))).toEqual([
      "card-alpha",
      "card-beta",
    ]);
    await user.click(screen.getByRole("button", { name: "다시 실행" }));
    expect(screen.getByRole("button", { name: "beta 고정 해제" })).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => expect(eventBodies).toHaveLength(6));
    expect(eventBodies.slice(2).map((event) => event.type)).toEqual([
      "card.pin",
      "card.unpin",
      "card.reorder",
      "card.pin",
    ]);
  });

  it("applies two manipulations dispatched in the same tick without losing either", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/events")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        return new Response(
          compositionSseFor([
            { entityId: "alpha", title: "첫 번째 혜택" },
            { entityId: "beta", title: "두 번째 혜택" },
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "혜택 찾기" }));
    expect(await screen.findByText("첫 번째 혜택")).toBeInTheDocument();

    const pinBeta = screen.getByRole("button", { name: "beta 고정" });
    const hideAlpha = screen.getByRole("button", { name: "alpha 숨기기" });
    // fireEvent.click flushes (and re-renders) after every call, so it cannot
    // reproduce two manipulations landing in the same JS tick. A raw DOM
    // click inside one `act` batch does: React queues both state updates
    // without a render in between, which is what exposed the stale-`before`
    // bug in `manipulate`.
    act(() => {
      pinBeta.click();
      hideAlpha.click();
    });

    expect(screen.getByRole("button", { name: "beta 고정 해제" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "alpha 다시 보기" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps the previous composition and explains how to recover when a turn fails", async () => {
    let turnCount = 0;
    const eventBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/events")) {
        eventBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/api/turn")) {
        turnCount += 1;
        if (turnCount === 1) {
          return new Response(compositionSse("보존할 혜택"), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response("temporary failure", { status: 503 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    const submit = await screen.findByRole("button", { name: "혜택 찾기" });
    await user.click(submit);
    expect(await screen.findByText("보존할 혜택")).toBeInTheDocument();

    await user.click(submit);
    expect(
      await screen.findByText("추천을 갱신하지 못했습니다. 이전 결과를 유지합니다. 서버 연결을 확인하고 다시 시도하세요."),
    ).toBeInTheDocument();
    expect(screen.getByText("보존할 혜택")).toBeInTheDocument();
    await waitFor(() =>
      expect(eventBodies).toContainEqual(
        expect.objectContaining({
          seq: 3,
          actor: "system",
          type: "composition.rejected",
          payload: { reason: "turn_failed" },
        }),
      ),
    );
  });
});

describe("App — interactive catalog", () => {
  it("adopts the server-issued sequence from the session and from each turn", async () => {
    const { eventBodies } = interactiveFetch({ sessionNextSeq: 1, nextSeq: 5 });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "서울 거주 대학생" }));
    expect(await screen.findByText("혜택 A")).toBeInTheDocument();
    await waitFor(() => expect(eventBodies).toHaveLength(2));
    expect(eventBodies[0]).toMatchObject({ seq: 1, type: "query.submit" });
    expect(eventBodies[1]).toMatchObject({ seq: 5, type: "composition.applied" });
  });

  it("shows the server's intent sentence and the undo-reset notice after a composition", async () => {
    interactiveFetch();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "서울 거주 대학생" }));
    expect(await screen.findByText("혜택 A")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("테스트 의도 문장");
  });

  it("records checklist ticks as trace events and undoes them with the inverse event", async () => {
    const { eventBodies } = interactiveFetch();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "서울 거주 대학생" }));
    const box = await screen.findByRole("checkbox", { name: "재학증명서" });
    await user.click(box);
    await waitFor(() =>
      expect(eventBodies.at(-1)).toMatchObject({
        type: "checklist.check",
        payload: { itemIndex: 0 },
        target: { cardId: "checklist-a", entityId: "a", componentType: "Checklist" },
      }),
    );
    expect((box as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "실행 취소" }));
    await waitFor(() => expect(eventBodies.at(-1)).toMatchObject({ type: "checklist.uncheck", payload: { itemIndex: 0 } }));
    expect(((await screen.findByRole("checkbox", { name: "재학증명서" })) as HTMLInputElement).checked).toBe(false);
  });

  it("switches persona from a server-composed button through the normal composition point", async () => {
    const { eventBodies, turnBodies } = interactiveFetch();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "서울 거주 대학생" }));
    await user.click(await screen.findByRole("button", { name: "시니어" }));
    await waitFor(() => expect(turnBodies).toHaveLength(2));
    expect(turnBodies[1]).toMatchObject({ trigger: { type: "persona.switch", personaId: "senior" } });
    expect(eventBodies.some((e) => e.type === "persona.switch" && (e.payload as { personaId: string }).personaId === "senior")).toBe(true);
    expect((screen.getByRole("combobox", { name: "추천 관점" }) as HTMLSelectElement).value).toBe("senior");
  });

  it("keeps a hidden card in the shell after recomposition so it can be shown again", async () => {
    interactiveFetch({ hiddenEntityId: "z" });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "서울 거주 대학생" }));
    const canvas = within(screen.getByRole("region", { name: "추천 결과" }));
    expect(await canvas.findByText("혜택 A 본문")).toBeInTheDocument();
    expect(canvas.queryByText("숨긴 혜택 본문")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "숨긴 혜택 다시 보기" }));
    expect(await canvas.findByText("숨긴 혜택 본문")).toBeInTheDocument();
  });

  it("ignores a checklist tick while a turn is in flight and restores the box", async () => {
    // fetch mock whose /api/turn never resolves until we release it
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const eventBodies: Array<Record<string, unknown>> = [];
    let turns = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/session")) {
          return new Response(JSON.stringify({ sessionId: SESSION_ID, nextSeq: 1 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/events")) {
          eventBodies.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith("/api/turn")) {
          turns += 1;
          if (turns === 2) await gate;
          return new Response(interactiveCompositionSse({ nextSeq: 3 }), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "서울 거주 대학생" }));
    const box = (await screen.findByRole("checkbox", { name: "재학증명서" })) as HTMLInputElement;
    // start a second turn that stays pending, then tick while busy
    await user.click(screen.getByRole("button", { name: "청년 구직자" }));
    await user.click(box);
    expect(eventBodies.some((e) => e.type === "checklist.check")).toBe(false);
    await waitFor(() =>
      expect((screen.getByRole("checkbox", { name: "재학증명서" }) as HTMLInputElement).checked).toBe(
        false,
      ),
    );
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("테스트 의도 문장"));
  });

  it("hides a currently visible card when the next composition ships it in the hidden tail", async () => {
    let turns = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/session")) {
          return new Response(JSON.stringify({ sessionId: SESSION_ID }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/events")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith("/api/turn")) {
          turns += 1;
          // first turn: entity "z" visible; second turn: same entity in the hidden tail
          const body =
            turns === 1
              ? compositionSseFor([{ entityId: "z", title: "숨긴 혜택 본문" }])
              : interactiveCompositionSse({ hiddenEntityId: "z" });
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    const canvas = within(screen.getByRole("region", { name: "추천 결과" }));
    await user.click(await screen.findByRole("button", { name: "서울 거주 대학생" }));
    expect(await canvas.findByText("숨긴 혜택 본문")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "청년 구직자" }));
    await waitFor(() => expect(canvas.queryByText("숨긴 혜택 본문")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "숨긴 혜택 다시 보기" })).toBeInTheDocument();
  });

  it("starts a re-entering Checklist from the server's checked rows without posting a tick", async () => {
    const eventBodies: Array<Record<string, unknown>> = [];
    let turns = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/session")) {
          return new Response(JSON.stringify({ sessionId: SESSION_ID, nextSeq: 1 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/events")) {
          eventBodies.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith("/api/turn")) {
          turns += 1;
          // turn 1: Checklist with a ticked row; turn 2: without it; turn 3: back again
          const body = interactiveCompositionSse(
            turns === 2 ? { withoutChecklist: true } : { checkedItems: [0] },
          );
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const applied = () => eventBodies.filter((e) => e.type === "composition.applied").length;
    const ticks = () =>
      eventBodies.filter((e) => e.type === "checklist.check" || e.type === "checklist.uncheck");
    const box = () => screen.getByRole("checkbox", { name: "재학증명서" }) as HTMLInputElement;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "서울 거주 대학생" }));
    await waitFor(() => expect(applied()).toBe(1));
    expect(box().checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "청년 구직자" }));
    await waitFor(() => expect(applied()).toBe(2));
    expect(screen.queryByRole("checkbox", { name: "재학증명서" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "서울 거주 대학생" }));
    await waitFor(() => expect(applied()).toBe(3));
    expect(box().checked).toBe(true);
    expect(ticks()).toEqual([]);

    // The shell row owns the tick now: clearing it records an uncheck.
    await user.click(box());
    await waitFor(() => expect(ticks().at(-1)).toMatchObject({ type: "checklist.uncheck", payload: { itemIndex: 0 } }));
  });

  it("re-synchronises its sequence from a conflict reply after a lost turn response", async () => {
    const eventBodies: Array<Record<string, unknown>> = [];
    let turns = 0;
    let rejectedPosts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/session")) {
          return new Response(JSON.stringify({ sessionId: SESSION_ID, nextSeq: 1 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/events")) {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          eventBodies.push(body);
          // The server recorded tool.called for the lost turn, so the client's
          // next number is stale; the conflict reply says which one to use.
          if (body.type === "composition.rejected" && ++rejectedPosts === 1) {
            return new Response(
              JSON.stringify({ ok: false, error: "Event sequence conflict", nextSeq: 5 }),
              { status: 409, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith("/api/turn")) {
          turns += 1;
          if (turns === 2) return new Response("lost", { status: 500 });
          return new Response(interactiveCompositionSse({ nextSeq: 2 }), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "서울 거주 대학생" }));
    await waitFor(() => expect(eventBodies.some((e) => e.type === "composition.applied")).toBe(true));

    await user.click(screen.getByRole("button", { name: "청년 구직자" }));
    await waitFor(() =>
      expect(eventBodies.filter((e) => e.type === "composition.rejected")).toHaveLength(2),
    );
    const rejected = eventBodies.filter((e) => e.type === "composition.rejected");
    expect(rejected.map((e) => e.seq)).toEqual([4, 5]);
    expect(rejected[1]).toMatchObject({ payload: { reason: "turn_failed" } });
    expect(screen.getByRole("status")).toHaveTextContent("추천을 갱신하지 못했습니다");

    await user.click(await screen.findByRole("button", { name: "혜택 A 고정" }));
    await waitFor(() => expect(eventBodies.at(-1)).toMatchObject({ type: "card.pin", seq: 6 }));
  });
});
