import { useEffect, useRef, useState } from "react";
import { CanvasSurfaces, type A2uiMessages } from "@genui-canvas/renderer";
import {
  createShellState,
  shellReducer,
  type ShellAction,
  type ShellState,
} from "./state/shell-store.js";
import { deriveInteractionEvent } from "./state/interaction-log.js";
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
    profile: { region: "서울", studentStatus: "student", persona: "university_student", interests: ["education", "housing"] },
  },
  {
    label: "청년 구직자",
    query: "서울 청년 구직 지원",
    profile: { region: "서울", employmentStatus: "unemployed", persona: "youth_jobseeker", interests: ["employment"] },
  },
];

const EMPTY_TRACE: TurnBody["traceSummary"] = { entityEngagement: [], recentEvents: [], turnCount: 0 };

function cardState(card: ShellState["cards"][number]): string {
  if (card.pinned) return "pinned";
  if (card.hidden) return "hidden";
  if (card.expanded) return "expanded";
  return "visible";
}

function toCurrentComposition(shell: ShellState): TurnBody["currentComposition"] {
  return {
    cards: shell.cards.map((c) => ({
      cardId: c.cardId,
      entityId: c.entityId,
      componentType: c.componentType,
      state: cardState(c),
    })),
  };
}

/** Rebuild shell from a new composition, carrying over the user's flags. */
function mergeShell(
  prev: ShellState,
  compositionId: string,
  cards: Array<{ cardId: string; entityId?: string; componentType: string }>,
): ShellState {
  const next = createShellState(
    compositionId,
    cards.map((c) => ({ cardId: c.cardId, entityId: c.entityId, componentType: c.componentType })),
  );
  const flags = new Map(prev.cards.map((c) => [c.cardId, c]));
  return {
    ...next,
    cards: next.cards.map((c) => {
      const old = flags.get(c.cardId);
      return old ? { ...c, pinned: old.pinned, hidden: old.hidden, expanded: old.expanded } : c;
    }),
  };
}

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shell, setShell] = useState<ShellState>(() => createShellState("comp-0", []));
  const [messages, setMessages] = useState<A2uiMessages>([] as unknown as A2uiMessages);
  const [intent, setIntent] = useState("검색어를 입력하거나 시나리오를 선택하세요.");
  const [busy, setBusy] = useState(false);
  // Manipulations applied since the last composition — the trace the next
  // composition point will fold in.
  const [dirty, setDirty] = useState(false);
  const scenarioRef = useRef<Scenario>(SCENARIOS[0]!);
  const seqRef = useRef(0);

  // The canvas follows the shell instantly: shell order (pinned first), hidden
  // cards dropped, expanded flag passed through — no server round-trip.
  const layout = shell.cards
    .filter((c) => !c.hidden)
    .map((c) => ({ cardId: c.cardId, expanded: c.expanded }));

  useEffect(() => {
    createSession().then(setSessionId).catch(() => setIntent("서버에 연결할 수 없습니다 (pnpm dev 로 서버를 켜세요)."));
  }, []);

  async function runTurn(scenario: Scenario, current: ShellState) {
    if (!sessionId) return;
    setBusy(true);
    try {
      const events = await postTurn({
        sessionId,
        trigger: { type: "query.submit", text: scenario.query },
        profile: scenario.profile,
        currentComposition: toCurrentComposition(current),
        traceSummary: EMPTY_TRACE,
      });
      const composition = events.find((e) => e.kind === "composition");
      const error = events.find((e) => e.kind === "error");
      if (composition && composition.kind === "composition") {
        setMessages(composition.messages as unknown as A2uiMessages);
        setShell(mergeShell(current, composition.compositionId, composition.cards));
        setDirty(false);
        setIntent(`${composition.cards.length}개 카드를 구성했습니다.`);
      } else if (error && error.kind === "error") {
        setIntent(`구성 실패: ${error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function selectScenario(scenario: Scenario) {
    scenarioRef.current = scenario;
    const fresh = createShellState("comp-0", []);
    setShell(fresh);
    void runTurn(scenario, fresh);
  }

  // Fine-grained manipulation: applies instantly in the shell (the canvas
  // reorders/hides/expands with no round-trip) and is logged. It does NOT
  // re-compose — that is reserved for composition points, so scroll position
  // and focus are preserved.
  function manipulate(action: ShellAction) {
    const before = shell;
    const after = shellReducer(before, action);
    setShell(after);
    setDirty(true);
    setIntent("조작이 즉시 반영됐어요 · ‘조작 반영해 재구성’으로 추천을 갱신할 수 있어요.");
    if (sessionId) {
      void postEvent(deriveInteractionEvent(action, before, { sessionId, seq: seqRef.current++ }));
    }
  }

  // Composition point: re-run the LLM composition folding in the accumulated
  // interaction trace (server computes the trace summary from the log).
  function recompose() {
    void runTurn(scenarioRef.current, shell);
  }

  return (
    <main className="app">
      <header className="app__header">
        <h1>genui-canvas</h1>
        <p className="app__intent">{intent}</p>
      </header>

      <section className="scenarios" aria-label="시나리오">
        {SCENARIOS.map((s) => (
          <button key={s.label} disabled={busy || !sessionId} onClick={() => selectScenario(s)}>
            {s.label}
          </button>
        ))}
      </section>

      <div className="layout">
        <section className="canvas" aria-label="추천 결과">
          <CanvasSurfaces messages={messages} layout={layout} />
        </section>

        <aside className="controls" aria-label="카드 조작">
          <h2>카드 조작</h2>
          {shell.cards.length === 0 && <p>시나리오를 선택하면 카드가 나타납니다.</p>}
          {shell.cards.length > 0 && (
            <button
              className="controls__recompose"
              disabled={busy || !dirty}
              onClick={recompose}
            >
              조작 반영해 재구성
            </button>
          )}
          <div className="controls__cards">
            {shell.cards.map((card) => (
              <CardFrame
                key={card.cardId}
                card={card}
                busy={busy}
                onPin={() => manipulate({ type: card.pinned ? "card.unpin" : "card.pin", cardId: card.cardId })}
                onHide={() => manipulate({ type: card.hidden ? "card.unhide" : "card.hide", cardId: card.cardId })}
                onExpand={() => manipulate({ type: card.expanded ? "card.collapse" : "card.expand", cardId: card.cardId })}
              />
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
