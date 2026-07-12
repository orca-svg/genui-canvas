import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CanvasSurfaces, type A2uiMessages } from "@genui-canvas/renderer";
import {
  createShellState,
  shellReducer,
  type ShellAction,
  type ShellState,
} from "./state/shell-store.js";
import {
  deriveCompositionAppliedEvent,
  deriveCompositionPointEvent,
  deriveCompositionRejectedEvent,
  deriveInteractionEvent,
} from "./state/interaction-log.js";
import type { CatalogComponentType, InteractionEvent } from "@genui-canvas/contracts";
import { createSession, postEvent, postTurn, type TurnBody } from "./api/client.js";
import { CardFrame } from "./components/CardFrame.js";

interface Scenario {
  label: string;
  query: string;
  profile: Record<string, unknown>;
}

const SCENARIOS: Scenario[] = [
  {
    label: "서울 거주 대학생",
    query: "서울 대학생 지원",
    profile: { regionCode: "KR-11", studentStatus: "student", persona: "university_student", interests: ["education", "housing"] },
  },
  {
    label: "청년 구직자",
    query: "서울 청년 구직 지원",
    profile: { regionCode: "KR-11", employmentStatus: "unemployed", persona: "youth_jobseeker", interests: ["employment"] },
  },
];

const PERSONAS = [
  { id: "general", label: "일반" },
  { id: "university_student", label: "대학생" },
  { id: "youth_jobseeker", label: "청년 구직자" },
  { id: "newlywed_family", label: "신혼가구" },
  { id: "single_parent", label: "한부모가구" },
  { id: "senior", label: "시니어" },
] as const;

interface HistoryEntry {
  action: ShellAction;
  before: ShellState;
  after: ShellState;
}

function inverseAction(entry: HistoryEntry): ShellAction {
  const { action, before } = entry;
  switch (action.type) {
    case "card.pin":
      return { type: "card.unpin", cardId: action.cardId };
    case "card.unpin":
      return { type: "card.pin", cardId: action.cardId };
    case "card.hide":
      return { type: "card.unhide", cardId: action.cardId };
    case "card.unhide":
      return { type: "card.hide", cardId: action.cardId };
    case "card.expand":
      return { type: "card.collapse", cardId: action.cardId };
    case "card.collapse":
      return { type: "card.expand", cardId: action.cardId };
    case "card.reorder":
      return {
        type: "card.reorder",
        cardId: action.cardId,
        toIndex: Math.max(0, before.cards.findIndex((card) => card.cardId === action.cardId)),
      };
  }
}

function sameShell(left: ShellState, right: ShellState): boolean {
  return (
    left.cards.length === right.cards.length &&
    left.cards.every((card, index) => {
      const other = right.cards[index];
      return (
        other !== undefined &&
        card.cardId === other.cardId &&
        card.pinned === other.pinned &&
        card.hidden === other.hidden &&
        card.expanded === other.expanded
      );
    })
  );
}

function sameOrder(left: ShellState, right: ShellState): boolean {
  return (
    left.cards.length === right.cards.length &&
    left.cards.every((card, index) => card.cardId === right.cards[index]?.cardId)
  );
}

function inverseActions(entry: HistoryEntry): ShellAction[] {
  const inverse = inverseAction(entry);
  const afterInverse = shellReducer(entry.after, inverse);
  if (sameOrder(afterInverse, entry.before)) return [inverse];

  const originalIndex = entry.before.cards.findIndex((card) => card.cardId === entry.action.cardId);
  return originalIndex < 0
    ? [inverse]
    : [inverse, { type: "card.reorder", cardId: entry.action.cardId, toIndex: originalIndex }];
}

function toCurrentComposition(shell: ShellState): TurnBody["currentComposition"] {
  return {
    cards: shell.cards.map((c) => ({
      cardId: c.cardId,
      entityId: c.entityId,
      componentType: c.componentType,
      pinned: c.pinned,
      hidden: c.hidden,
      expanded: c.expanded,
    })),
  };
}

/** Rebuild shell from a new composition, carrying over the user's flags. */
function mergeShell(
  prev: ShellState,
  compositionId: string,
  cards: Array<{
    cardId: string;
    entityId?: string;
    componentType: CatalogComponentType;
    title?: string;
    sourceUrl?: string;
    sourceCheckedAt?: string;
  }>,
): ShellState {
  const next = createShellState(compositionId, cards);
  const semanticFlags = new Map<string, ShellState["cards"][number]>();
  const idFlags = new Map(prev.cards.map((card) => [card.cardId, card]));
  for (const card of prev.cards) {
    if (!card.entityId) continue;
    const key = `${card.componentType}::${card.entityId}`;
    if (!semanticFlags.has(key)) semanticFlags.set(key, card);
  }
  return {
    ...next,
    cards: next.cards.map((c) => {
      const semanticKey = c.entityId ? `${c.componentType}::${c.entityId}` : undefined;
      const old = (semanticKey ? semanticFlags.get(semanticKey) : undefined) ?? idFlags.get(c.cardId);
      return old ? { ...c, pinned: old.pinned, hidden: old.hidden, expanded: old.expanded } : c;
    }),
  };
}

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shell, setShell] = useState<ShellState>(() => createShellState("comp-0", []));
  const [messages, setMessages] = useState<A2uiMessages>([] as unknown as A2uiMessages);
  const [query, setQuery] = useState(SCENARIOS[0]!.query);
  const [persona, setPersona] = useState("university_student");
  const [intent, setIntent] = useState("검색어를 입력하거나 시나리오를 선택하세요.");
  const [busy, setBusy] = useState(false);
  // Manipulations applied since the last composition — the trace the next
  // composition point will fold in.
  const [dirty, setDirty] = useState(false);
  const scenarioRef = useRef<Scenario>(SCENARIOS[0]!);
  const seqRef = useRef(0);
  const traceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionRequestRef = useRef<Promise<string> | null>(null);
  const compositionBaselineRef = useRef<ShellState>(shell);
  const pastRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });

  // The canvas follows the shell instantly: shell order (pinned first), hidden
  // cards dropped, expanded flag passed through — no server round-trip.
  const layout = shell.cards
    .filter((c) => !c.hidden)
    .map((c) => ({ cardId: c.cardId, expanded: c.expanded }));

  useEffect(() => {
    let active = true;
    const request = sessionRequestRef.current ?? createSession();
    sessionRequestRef.current = request;
    request
      .then((id) => {
        if (active) setSessionId(id);
      })
      .catch(() => {
        if (sessionRequestRef.current === request) sessionRequestRef.current = null;
        if (active) setIntent("서버에 연결할 수 없습니다 (pnpm dev 로 서버를 켜세요).");
      });
    return () => {
      active = false;
    };
  }, []);

  function enqueueTrace(
    build: (seq: number) => Parameters<typeof postEvent>[0],
  ): Promise<InteractionEvent> {
    const task = traceQueueRef.current.then(async () => {
      const event = build(seqRef.current);
      await postEvent(event);
      seqRef.current += 1;
      return event;
    });
    traceQueueRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async function runTurn(
    scenario: Scenario,
    current: ShellState,
    trigger: TurnBody["trigger"] = { type: "query.submit", text: scenario.query },
  ) {
    if (!sessionId) return;
    setBusy(true);
    setIntent("추천 후보를 검색하고 구성 중입니다…");
    let triggerEventId: string | undefined;
    try {
      const triggerEvent = await enqueueTrace((seq) =>
        deriveCompositionPointEvent(trigger, current, { sessionId, seq }),
      );
      triggerEventId = triggerEvent.eventId;
      const events = await postTurn({
        sessionId,
        trigger,
        profile: scenario.profile,
        currentComposition: toCurrentComposition(current),
        ...(trigger.type === "persona.switch" ? { query: scenario.query } : {}),
      });
      const composition = events.find((e) => e.kind === "composition");
      const error = events.find((e) => e.kind === "error");
      if (composition && composition.kind === "composition") {
        const nextShell = mergeShell(current, composition.compositionId, composition.cards);
        setMessages(composition.messages as unknown as A2uiMessages);
        setShell(nextShell);
        compositionBaselineRef.current = nextShell;
        setDirty(false);
        clearHistory();
        setIntent(
          composition.cards.length > 0
            ? `${composition.cards.length}개 카드를 구성했습니다.`
            : "일치하는 후보를 찾지 못했습니다. 검색 조건을 바꿔 다시 시도하세요.",
        );
        try {
          await enqueueTrace((seq) =>
            deriveCompositionAppliedEvent(nextShell, {
              sessionId,
              seq,
              triggeredBy: triggerEventId,
            }),
          );
        } catch {
          setIntent(
            "새 추천 결과는 반영했지만 적용 기록을 저장하지 못했습니다. 서버 연결을 확인하세요.",
          );
        }
      } else if (error && error.kind === "error") {
        setIntent(`구성 실패: ${error.message}`);
        try {
          await enqueueTrace((seq) =>
            deriveCompositionRejectedEvent(current, "composition_invalid", {
              sessionId,
              seq,
              triggeredBy: triggerEventId,
            }),
          );
        } catch {
          // The visible terminal error is more actionable than a second audit
          // logging error, and no successful composition was applied.
        }
      }
    } catch {
      setIntent(
        "추천을 갱신하지 못했습니다. 이전 결과를 유지합니다. 서버 연결을 확인하고 다시 시도하세요.",
      );
      try {
        await enqueueTrace((seq) =>
          deriveCompositionRejectedEvent(current, "turn_failed", {
            sessionId,
            seq,
            triggeredBy: triggerEventId,
          }),
        );
      } catch {
        // The primary failure may be the trace endpoint itself. Preserve the
        // previous composition and avoid replacing the actionable UI message.
      }
    } finally {
      setBusy(false);
    }
  }

  function selectScenario(scenario: Scenario) {
    scenarioRef.current = scenario;
    setQuery(scenario.query);
    if (typeof scenario.profile.persona === "string") setPersona(scenario.profile.persona);
    void runTurn(scenario, shell);
  }

  function switchPersona(event: ChangeEvent<HTMLSelectElement>) {
    const personaId = event.target.value;
    setPersona(personaId);
    const draftQuery = query.trim();
    const queryChanged = draftQuery.length > 0 && draftQuery !== scenarioRef.current.query;
    const next = {
      ...scenarioRef.current,
      ...(queryChanged ? { label: "사용자 검색", query: draftQuery } : {}),
      profile: queryChanged
        ? { persona: personaId }
        : { ...scenarioRef.current.profile, persona: personaId },
    };
    scenarioRef.current = next;
    void runTurn(next, shell, { type: "persona.switch", personaId });
  }

  function submitQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = query.trim();
    if (!text) {
      setIntent("검색어를 입력하세요.");
      return;
    }
    // A typed query is not the selected scenario: carrying hidden region or
    // student filters would silently contradict what the user entered. Keep
    // only the visible persona control.
    const next: Scenario = {
      label: "사용자 검색",
      query: text,
      profile: { persona },
    };
    scenarioRef.current = next;
    void runTurn(next, shell);
  }

  // Fine-grained manipulation: applies instantly in the shell (the canvas
  // reorders/hides/expands with no round-trip) and is logged. It does NOT
  // re-compose — that is reserved for composition points, so scroll position
  // and focus are preserved.
  function manipulate(action: ShellAction) {
    const before = shell;
    const after = shellReducer(before, action);
    if (sameShell(before, after)) return;
    pastRef.current = [...pastRef.current.slice(-49), { action, before, after }];
    futureRef.current = [];
    syncHistoryAvailability();
    setShell(after);
    setDirty(!sameShell(after, compositionBaselineRef.current));
    setIntent("조작이 즉시 반영됐어요 · ‘조작 반영해 재구성’으로 추천을 갱신할 수 있어요.");
    if (sessionId) {
      void enqueueTrace((seq) =>
        deriveInteractionEvent(action, before, { sessionId, seq }),
      ).catch(() => {
        setIntent("조작은 반영했지만 기록하지 못했습니다. 서버 연결을 확인한 뒤 다시 시도하세요.");
      });
    }
  }

  function syncHistoryAvailability() {
    setHistoryAvailability({
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    });
  }

  function clearHistory() {
    pastRef.current = [];
    futureRef.current = [];
    syncHistoryAvailability();
  }

  function logHistoryActions(actions: ShellAction[], stateBefore: ShellState) {
    if (!sessionId) return;
    void (async () => {
      let before = stateBefore;
      for (const action of actions) {
        const after = shellReducer(before, action);
        if (sameShell(before, after)) continue;
        const eventState = before;
        await enqueueTrace((seq) =>
          deriveInteractionEvent(action, eventState, { sessionId, seq }),
        );
        before = after;
      }
    })().catch(() => {
        setIntent("변경은 반영했지만 실행 취소 기록을 저장하지 못했습니다. 서버 연결을 확인하세요.");
    });
  }

  function undo() {
    if (busy) return;
    const entry = pastRef.current.pop();
    if (!entry) return;
    futureRef.current.push(entry);
    setShell(entry.before);
    setDirty(!sameShell(entry.before, compositionBaselineRef.current));
    setIntent("마지막 카드 조작을 취소했습니다.");
    syncHistoryAvailability();
    logHistoryActions(inverseActions(entry), entry.after);
  }

  function redo() {
    if (busy) return;
    const entry = futureRef.current.pop();
    if (!entry) return;
    pastRef.current.push(entry);
    setShell(entry.after);
    setDirty(!sameShell(entry.after, compositionBaselineRef.current));
    setIntent("취소한 카드 조작을 다시 적용했습니다.");
    syncHistoryAvailability();
    logHistoryActions([entry.action], entry.before);
  }

  // Composition point: re-run the LLM composition folding in the accumulated
  // interaction trace (server computes the trace summary from the log).
  function recompose() {
    void runTurn(scenarioRef.current, shell);
  }

  return (
    <>
      <a className="skip-link" href="#recommendation-results">
        추천 결과로 건너뛰기
      </a>
      <main className="app">
      <header className="app__header">
        <h1>genui-canvas</h1>
        <p className="app__intent" role="status" aria-live="polite">
          {intent}
        </p>
      </header>

      <section className="scenarios" aria-label="시나리오">
        {SCENARIOS.map((s) => (
          <button key={s.label} disabled={busy || !sessionId} onClick={() => selectScenario(s)}>
            {s.label}
          </button>
        ))}
      </section>

      <form className="query-form" onSubmit={submitQuery}>
        <label htmlFor="benefit-query">혜택 검색</label>
        <div className="query-form__controls">
          <input
            id="benefit-query"
            name="benefit-query"
            type="search"
            autoComplete="off"
            maxLength={300}
            aria-describedby="benefit-query-hint"
            placeholder="예: 부산 청년 창업 지원…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={busy || !sessionId}>
            혜택 찾기
          </button>
        </div>
        <p id="benefit-query-hint" className="field-hint">
          이름·주민번호·연락처 등 개인식별정보는 입력하지 마세요. 최대 300자입니다.
        </p>
      </form>

      <div className="persona-control">
        <label htmlFor="persona">추천 관점</label>
        <select
          id="persona"
          name="persona"
          value={persona}
          disabled={busy || !sessionId}
          onChange={switchPersona}
        >
          {PERSONAS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <p className="candidate-notice">
        추천 결과는 신청 가능성을 보장하지 않는 후보 정보입니다. 자격·마감일·서류는 출처 페이지에서
        확인하고 해당 기관의 공식 주소인지 다시 확인하세요.
      </p>
      <p className="fixture-notice">
        현재 연결된 게이트웨이 v0.3.0은 검증용 예시(fixture) 데이터를 제공합니다. 실제 정책 데이터가
        아닙니다.
      </p>

      <div className="layout">
        <section
          id="recommendation-results"
          className="canvas"
          aria-label="추천 결과"
          tabIndex={-1}
        >
          <CanvasSurfaces messages={messages} layout={layout} />
        </section>

        <aside className="controls" aria-label="카드 조작">
          <h2>카드 조작</h2>
          {shell.cards.length === 0 && <p>검색어를 입력하거나 시나리오를 선택하면 카드가 나타납니다.</p>}
          {shell.cards.length > 0 && (
            <>
              <div className="controls__history" aria-label="조작 이력">
                <button
                  type="button"
                  disabled={busy || !historyAvailability.canUndo}
                  onClick={undo}
                >
                  실행 취소
                </button>
                <button
                  type="button"
                  disabled={busy || !historyAvailability.canRedo}
                  onClick={redo}
                >
                  다시 실행
                </button>
              </div>
              <button
                type="button"
                className="controls__recompose"
                disabled={busy || !dirty}
                onClick={recompose}
              >
                조작 반영해 재구성
              </button>
            </>
          )}
          <div className="controls__cards">
            {shell.cards.map((card, index) => {
              const previous = shell.cards[index - 1];
              const next = shell.cards[index + 1];
              const canMoveUp = previous !== undefined && previous.pinned === card.pinned;
              const canMoveDown = next !== undefined && next.pinned === card.pinned;
              return (
                <CardFrame
                  key={card.cardId}
                  card={card}
                  busy={busy}
                  onPin={() => manipulate({ type: card.pinned ? "card.unpin" : "card.pin", cardId: card.cardId })}
                  onHide={() => manipulate({ type: card.hidden ? "card.unhide" : "card.hide", cardId: card.cardId })}
                  onExpand={() => manipulate({ type: card.expanded ? "card.collapse" : "card.expand", cardId: card.cardId })}
                  canMoveUp={canMoveUp}
                  canMoveDown={canMoveDown}
                  onMoveUp={() => manipulate({ type: "card.reorder", cardId: card.cardId, toIndex: index - 1 })}
                  onMoveDown={() => manipulate({ type: "card.reorder", cardId: card.cardId, toIndex: index + 1 })}
                />
              );
            })}
          </div>
        </aside>
      </div>
      </main>
    </>
  );
}
