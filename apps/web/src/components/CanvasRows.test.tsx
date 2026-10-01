import { useState, type MutableRefObject, type ReactElement } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { A2uiMessages } from "@genui-canvas/renderer";
import { createShellState, shellReducer, type ShellAction, type ShellState } from "../state/shell-store.js";
import { CanvasRows } from "./CanvasRows.js";

const CATALOG = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
const surface = (id: string, text: string) => [
  { version: "v0.9", createSurface: { surfaceId: id, catalogId: CATALOG } },
  { version: "v0.9", updateComponents: { surfaceId: id, components: [{ id: "root", component: "Text", text: { path: "/t" } }] } },
  { version: "v0.9", updateDataModel: { surfaceId: id, path: "/", value: { t: text } } },
];
const messages = [...surface("card-a", "A 본문"), ...surface("score-a", "점수 A"), ...surface("card-b", "B 본문")] as unknown as A2uiMessages;
const initial = () =>
  createShellState("c", [
    { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금" },
    { cardId: "score-a", entityId: "a", componentType: "ScoreBreakdown" },
    { cardId: "card-b", entityId: "b", componentType: "BenefitCard", title: "월세 지원" },
  ]);

interface HarnessProps {
  onManipulate?: (a: ShellAction) => void;
  start?: ShellState;
  busy?: boolean;
  /** Lets a test change the shell from outside the canvas (a global undo, say). */
  dispatchRef?: MutableRefObject<((a: ShellAction) => void) | null>;
}

function Harness({ onManipulate, start = initial(), busy = false, dispatchRef }: HarnessProps) {
  const [shell, setShell] = useState(start);
  if (dispatchRef) dispatchRef.current = (action) => setShell((s) => shellReducer(s, action));
  return (
    <CanvasRows
      cards={shell.cards}
      messages={messages}
      busy={busy}
      onManipulate={(action) => {
        onManipulate?.(action);
        setShell((s) => shellReducer(s, action));
      }}
      onAction={() => {}}
      watch={[]}
      values={[]}
      onValueChange={() => {}}
    />
  );
}

/** Renders and lets the renderer's async markdown pass settle inside act. */
async function mount(ui: ReactElement) {
  const result = render(ui);
  await act(async () => {});
  return result;
}

afterEach(() => {
  // jsdom serves requestAnimationFrame from one Node interval, created on whichever clock is
  // active when the first frame is requested. A frame left pending on the fake clock would
  // stall every later frame in this file (and Base UI's focus handling with it), so the fake
  // clock is drained before the real one comes back.
  if (vi.isFakeTimers()) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
  vi.useRealTimers();
});

const EMPTY_TEXT = "보이는 카드가 없습니다 · 카드 목록에서 다시 볼 수 있습니다.";

describe("CanvasRows", () => {
  it("renders one focusable row per candidate with its chrome and a drag handle", async () => {
    render(<Harness />);
    const rowA = await screen.findByRole("group", { name: "국가장학금 카드" });
    expect(rowA).toHaveAttribute("tabindex", "0");
    expect(within(rowA).getByRole("button", { name: "국가장학금 순서 바꾸기" })).toBeInTheDocument();
    expect(within(rowA).getByRole("button", { name: "국가장학금 더 알아보기" })).toBeInTheDocument();
    expect(within(rowA).getByText("A 본문")).toBeInTheDocument();
    expect(within(rowA).getByText("점수 A")).toBeInTheDocument();
  });

  it("says in one line under the row what the next recomposition adds, and draws no slot placeholder", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const rowB = await screen.findByRole("group", { name: "월세 지원 카드" });
    // Nothing composed beside the card yet: one quiet line, no dashed slot text.
    expect(within(rowB).getByText("고정 후 재구성 → 점수 분석")).toHaveClass("canvas-row__hint");
    expect(rowB.querySelectorAll(".genui-canvas-slot--empty")).toHaveLength(3);
    for (const slot of rowB.querySelectorAll(".genui-canvas-slot--empty")) expect(slot).toBeEmptyDOMElement();
    await user.click(within(rowB).getByRole("button", { name: "월세 지원 더 알아보기" }));
    expect(within(rowB).getByText("재구성 → 체크리스트·출처 안내 · 고정 후 재구성 → 점수 분석")).toBeInTheDocument();
    expect(within(rowB).getByRole("button", { name: "월세 지원 접기" })).toBeInTheDocument();
    // Row A already has its ScoreBreakdown and is not expanded: nothing is pending.
    const rowA = screen.getByRole("group", { name: "국가장학금 카드" });
    expect(within(rowA).queryByText(/재구성/)).toBeNull();
  });

  it("drops the pin step from the line once the row is pinned", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const rowB = await screen.findByRole("group", { name: "월세 지원 카드" });
    expect(within(rowB).getByText("고정 후 재구성 → 점수 분석")).toBeInTheDocument();
    await user.click(within(rowB).getByRole("button", { name: "월세 지원 고정" }));
    // pinning moves the row to the front, so look it up again
    const pinned = screen.getByRole("group", { name: "월세 지원 카드" });
    expect(within(pinned).getByText("재구성 → 점수 분석")).toBeInTheDocument();
    expect(within(pinned).queryByText(/고정 후/)).toBeNull();
  });

  it("gives an orphan row (no BenefitCard to pin or expand) no hints", async () => {
    const start = createShellState("c", [{ cardId: "checklist-x", entityId: "x", componentType: "Checklist" }]);
    await mount(<Harness start={start} />);
    const orphan = screen.getByRole("group", { name: "x 카드" });
    expect(orphan.querySelector(".canvas-row__hint")).toBeNull();
  });

  it("never marks a sub-card as a benefit or band cell, so the collapsed-preview clip cannot reach it", async () => {
    // styles.css clips a collapsed body only for [data-column="benefit"] and [data-column="band"];
    // jsdom computes no styles, so this pins the DOM contract the rule selects on.
    await mount(<Harness />);
    const rowA = screen.getByRole("group", { name: "국가장학금 카드" });
    const score = within(rowA).getByTestId("card-score-a");
    expect(score).toHaveAttribute("data-column", "score");
    expect(score).toHaveAttribute("data-expanded", "false");
    expect(within(rowA).getByTestId("card-card-a")).toHaveAttribute("data-column", "benefit");
  });

  it("handles P/H/E on a focused row and ignores modifier combinations", async () => {
    const user = userEvent.setup();
    const seen: ShellAction[] = [];
    render(<Harness onManipulate={(a) => seen.push(a)} />);
    const rowA = await screen.findByRole("group", { name: "국가장학금 카드" });
    rowA.focus();
    await user.keyboard("p");
    await user.keyboard("e");
    await user.keyboard("{Control>}p{/Control}");
    expect(seen).toEqual([
      { type: "card.pin", cardId: "card-a" },
      { type: "card.expand", cardId: "card-a" },
    ]);
  });

  it("hides a row, leaves an undo strip in its place for six seconds, and restores on 되돌리기", async () => {
    // Mount on real timers, then fake them: plain fake timers with fireEvent
    // keep the 5999/6000ms boundary exact (userEvent would work too, since
    // test-setup.ts bridges RTL's fake-timer drain, but shouldAdvanceTime would
    // let real time leak in).
    await mount(<Harness />);
    vi.useFakeTimers();
    const rowA = screen.getByRole("group", { name: "국가장학금 카드" });
    fireEvent.click(within(rowA).getByRole("button", { name: "국가장학금 숨기기" }));
    expect(screen.queryByRole("group", { name: "국가장학금 카드" })).toBeNull();
    const strip = screen.getByRole("status", { name: "숨김 안내" });
    expect(strip).toHaveTextContent("국가장학금을 숨겼습니다");
    // the strip sits where the row was: immediately before 월세 지원
    const rowB = screen.getByRole("group", { name: "월세 지원 카드" });
    expect(strip.compareDocumentPosition(rowB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(strip).getByRole("button", { name: "되돌리기" }));
    expect(screen.getByRole("group", { name: "국가장학금 카드" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "국가장학금 카드" })).getByRole("button", { name: "국가장학금 숨기기" }));
    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(screen.getByRole("status", { name: "숨김 안내" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status", { name: "숨김 안내" })).toBeNull();
  });

  it("keeps a band free of dnd-kit's button semantics and disabled dimming", async () => {
    const start = createShellState("c", [
      { cardId: "persona", componentType: "PersonaSelector" },
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금" },
    ]);
    const { container } = render(<Harness start={start} />);
    await screen.findByRole("group", { name: "국가장학금 카드" });
    const band = container.querySelector('[data-value="band:persona"]')!;
    expect(band).not.toHaveAttribute("role");
    // Out of the tab order (not a dnd-kit button), yet focusable for the card list's jump.
    expect(band).toHaveAttribute("tabindex", "-1");
    expect(band).not.toHaveAttribute("aria-roledescription");
    expect(band).not.toHaveClass("opacity-50");
  });

  it("shows a single undo strip when the hidden row was the last group after a band", async () => {
    const user = userEvent.setup();
    const start = createShellState("c", [
      { cardId: "persona", componentType: "PersonaSelector" },
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금" },
    ]);
    render(<Harness start={start} />);
    const rowA = await screen.findByRole("group", { name: "국가장학금 카드" });
    await user.click(within(rowA).getByRole("button", { name: "국가장학금 숨기기" }));
    expect(screen.getAllByRole("status", { name: "숨김 안내" })).toHaveLength(1);
  });

  it("scopes the drag instructions to the handle, not to the row group", async () => {
    const start = createShellState("c", [
      { cardId: "score-x", entityId: "x", componentType: "ScoreBreakdown" },
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금" },
    ]);
    render(<Harness start={start} />);
    const rowA = await screen.findByRole("group", { name: "국가장학금 카드" });
    const orphan = screen.getByRole("group", { name: "x 카드" });
    for (const group of [rowA, orphan]) {
      expect(group).not.toHaveAttribute("aria-roledescription");
      expect(group).not.toHaveAttribute("aria-describedby");
      expect(group).not.toHaveAttribute("aria-disabled");
    }
    const handle = within(rowA).getByRole("button", { name: "국가장학금 순서 바꾸기" });
    expect(handle).toHaveAttribute("aria-roledescription", "정렬 가능한 카드");
    expect(handle).toHaveAttribute("aria-describedby");
    expect(handle).toHaveAccessibleDescription(/Space/);
  });

  it("keeps dnd-kit's pressed state off the row group while it is carried", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const rowA = await screen.findByRole("group", { name: "국가장학금 카드" });
    within(rowA).getByRole("button", { name: "국가장학금 순서 바꾸기" }).focus();
    await user.keyboard(" ");
    expect(await screen.findByText(/국가장학금을 들었습니다/)).toBeInTheDocument();
    expect(rowA).not.toHaveAttribute("aria-pressed");
    await user.keyboard("{Escape}");
  });

  it("moves focus to 되돌리기 after H, then to the restored row after undo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const rowA = await screen.findByRole("group", { name: "국가장학금 카드" });
    rowA.focus();
    await user.keyboard("h");
    const undo = within(screen.getByRole("status", { name: "숨김 안내" })).getByRole("button", { name: "되돌리기" });
    expect(document.activeElement).toBe(undo);
    await user.click(undo);
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "국가장학금 카드" }));
  });

  it("hands focus to the neighbouring row when the focused undo strip expires", async () => {
    await mount(<Harness />);
    vi.useFakeTimers();
    const rowA = screen.getByRole("group", { name: "국가장학금 카드" });
    act(() => rowA.focus());
    fireEvent.keyDown(rowA, { key: "h", code: "KeyH" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "되돌리기" }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByRole("status", { name: "숨김 안내" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "월세 지원 카드" }));
  });

  it("leaves focus alone when the strip expires while focus is elsewhere", async () => {
    await mount(<Harness />);
    vi.useFakeTimers();
    const rowA = screen.getByRole("group", { name: "국가장학금 카드" });
    fireEvent.click(within(rowA).getByRole("button", { name: "국가장학금 숨기기" }));
    const other = screen.getByRole("button", { name: "월세 지원 더 알아보기" });
    act(() => other.focus());
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(document.activeElement).toBe(other);
  });

  it("disables 되돌리기 while busy", async () => {
    const { rerender } = await mount(<Harness />);
    fireEvent.click(within(screen.getByRole("group", { name: "국가장학금 카드" })).getByRole("button", { name: "국가장학금 숨기기" }));
    rerender(<Harness busy />);
    const undo = screen.getByRole("button", { name: "되돌리기" });
    expect(undo).toBeDisabled();
    fireEvent.click(undo);
    expect(screen.queryByRole("group", { name: "국가장학금 카드" })).toBeNull();
  });

  it("drops the strip when the card is unhidden some other way (a global undo)", async () => {
    const dispatchRef: HarnessProps["dispatchRef"] = { current: null };
    await mount(<Harness dispatchRef={dispatchRef} />);
    fireEvent.click(within(screen.getByRole("group", { name: "국가장학금 카드" })).getByRole("button", { name: "국가장학금 숨기기" }));
    expect(screen.getByRole("status", { name: "숨김 안내" })).toBeInTheDocument();
    act(() => dispatchRef.current!({ type: "card.unhide", cardId: "card-a" }));
    expect(screen.queryByRole("status", { name: "숨김 안내" })).toBeNull();
    expect(screen.getByRole("group", { name: "국가장학금 카드" })).toBeInTheDocument();
    // hiding it again through the shell alone must not resurrect the stale strip
    act(() => dispatchRef.current!({ type: "card.hide", cardId: "card-a" }));
    expect(screen.queryByRole("status", { name: "숨김 안내" })).toBeNull();
  });

  it("matches shortcuts by physical key under a Korean input source", async () => {
    const seen: ShellAction[] = [];
    await mount(<Harness onManipulate={(a) => seen.push(a)} />);
    const rowA = screen.getByRole("group", { name: "국가장학금 카드" });
    fireEvent.keyDown(rowA, { key: "ㅔ", code: "KeyP" });
    fireEvent.keyDown(rowA, { key: "ㄷ", code: "KeyE" });
    expect(seen).toEqual([
      { type: "card.pin", cardId: "card-a" },
      { type: "card.expand", cardId: "card-a" },
    ]);
  });

  it("ignores held-down repeats and keys typed into a select inside the row", async () => {
    const seen: ShellAction[] = [];
    await mount(<Harness onManipulate={(a) => seen.push(a)} />);
    const rowA = screen.getByRole("group", { name: "국가장학금 카드" });
    fireEvent.keyDown(rowA, { key: "p", code: "KeyP", repeat: true });
    const select = document.createElement("select");
    rowA.appendChild(select);
    fireEvent.keyDown(select, { key: "p", code: "KeyP" });
    expect(seen).toEqual([]);
  });

  it("does not swallow keys on a row without a BenefitCard", async () => {
    const start = createShellState("c", [{ cardId: "score-x", entityId: "x", componentType: "ScoreBreakdown" }]);
    const seen: ShellAction[] = [];
    await mount(<Harness start={start} onManipulate={(a) => seen.push(a)} />);
    const orphan = screen.getByRole("group", { name: "x 카드" });
    const notPrevented = fireEvent.keyDown(orphan, { key: "p", code: "KeyP", cancelable: true });
    expect(notPrevented).toBe(true);
    expect(seen).toEqual([]);
  });

  it("picks the object particle from the title and describes 되돌리기 with the strip's sentence", async () => {
    const start = createShellState("c", [
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국민취업지원제도" },
    ]);
    await mount(<Harness start={start} />);
    fireEvent.click(screen.getByRole("button", { name: "국민취업지원제도 숨기기" }));
    const strip = screen.getByRole("status", { name: "숨김 안내" });
    expect(strip).toHaveTextContent("국민취업지원제도를 숨겼습니다 · 카드 목록에서 다시 볼 수 있습니다.");
    expect(within(strip).getByRole("button", { name: "되돌리기" })).toHaveAccessibleDescription(
      "국민취업지원제도를 숨겼습니다 · 카드 목록에서 다시 볼 수 있습니다.",
    );
  });

  it("says no card is visible once every card is hidden, but not before any card arrives", async () => {
    const { unmount } = await mount(<Harness start={createShellState("c", [])} />);
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
    unmount();
    const allHidden = createShellState("c", [
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금", hidden: true },
    ]);
    await mount(<Harness start={allHidden} />);
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
  });

  it("hands focus to the no-visible-card sentence when the focused strip of the last row expires", async () => {
    const start = createShellState("c", [
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금" },
    ]);
    await mount(<Harness start={start} />);
    vi.useFakeTimers();
    const rowA = screen.getByRole("group", { name: "국가장학금 카드" });
    act(() => rowA.focus());
    fireEvent.keyDown(rowA, { key: "h", code: "KeyH" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "되돌리기" }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByRole("status", { name: "숨김 안내" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByText(EMPTY_TEXT));
  });

  it("advertises P/H/E on a row that has a BenefitCard, and only there", async () => {
    const start = createShellState("c", [
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금" },
      { cardId: "score-x", entityId: "x", componentType: "ScoreBreakdown" },
    ]);
    await mount(<Harness start={start} />);
    expect(screen.getByRole("group", { name: "국가장학금 카드" })).toHaveAttribute("aria-keyshortcuts", "P H E");
    expect(screen.getByRole("group", { name: "x 카드" })).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("stacks the drag ghost above the card list drawer (z 50) and its handle (z 51)", async () => {
    // dnd-kit's DragOverlay writes its `zIndex` prop (default 999) as an inline style,
    // which outranks the vendored overlay's `z-50` class.
    const user = userEvent.setup();
    render(<Harness />);
    const rowA = await screen.findByRole("group", { name: "국가장학금 카드" });
    within(rowA).getByRole("button", { name: "국가장학금 순서 바꾸기" }).focus();
    await user.keyboard(" ");
    const ghost = await screen.findByText("국가장학금", { selector: ".canvas-row-ghost" });
    expect(Number(ghost.parentElement!.style.zIndex)).toBeGreaterThan(51);
    await user.keyboard("{Escape}");
  });
});
