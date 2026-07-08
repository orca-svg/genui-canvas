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
  const scenarioRef = useRef<Scenario>(SCENARIOS[0]!);
  const seqRef = useRef(0);

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

  async function manipulate(action: ShellAction) {
    const before = shell;
    const after = shellReducer(before, action);
    setShell(after);
    if (sessionId) {
      await postEvent(deriveInteractionEvent(action, before, { sessionId, seq: seqRef.current++ }));
    }
    // Re-compose so the manipulation reshapes the UI (trace -> composition).
    await runTurn(scenarioRef.current, after);
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
          <CanvasSurfaces messages={messages} />
        </section>

        <aside className="controls" aria-label="카드 조작">
          <h2>카드 조작</h2>
          {shell.cards.length === 0 && <p>시나리오를 선택하면 카드가 나타납니다.</p>}
          <ul>
            {shell.cards.map((card) => (
              <li key={card.cardId} className={card.hidden ? "is-hidden" : ""}>
                <span className="controls__id">{card.entityId ?? card.cardId}</span>
                <button onClick={() => manipulate({ type: card.pinned ? "card.unpin" : "card.pin", cardId: card.cardId })}>
                  {card.pinned ? "고정 해제" : "고정"}
                </button>
                <button onClick={() => manipulate({ type: card.hidden ? "card.unhide" : "card.hide", cardId: card.cardId })}>
                  {card.hidden ? "다시 보기" : "숨기기"}
                </button>
                <button onClick={() => manipulate({ type: card.expanded ? "card.collapse" : "card.expand", cardId: card.cardId })}>
                  {card.expanded ? "접기" : "펼치기"}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
