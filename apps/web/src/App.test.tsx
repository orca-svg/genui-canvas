import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function compositionSse(title = "테스트 혜택"): string {
  return compositionSseFor([{ entityId: "test-benefit", title }]);
}

function compositionSseFor(
  cards: Array<{ entityId: string; title: string; cardId?: string }>,
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
    cards: cards.map(({ entityId, title, cardId }) => ({
      cardId: cardId ?? `card-${entityId}`,
      entityId,
      componentType: "BenefitCard",
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
