import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { EdgeDrawer, listedCards, type EdgeDrawerProps } from "./EdgeDrawer.js";
import { createShellState, type ShellCard } from "../state/shell-store.js";

const cards = createShellState("c", [
  { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금" },
  { cardId: "card-b", entityId: "b", componentType: "BenefitCard", title: "월세 지원", hidden: true },
]).cards;

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function Harness(props: Partial<EdgeDrawerProps> = {}) {
  const [open, setOpen] = useState(false);
  return (
    <EdgeDrawer
      cards={cards}
      busy={false}
      open={open}
      onOpenChange={setOpen}
      onPin={vi.fn()}
      onHide={vi.fn()}
      onExpand={vi.fn()}
      onMoveRow={vi.fn()}
      onJump={vi.fn()}
      {...props}
    />
  );
}

/** A finger's hover: React derives onPointerEnter/Leave from pointerover/pointerout, so dispatch those. */
function touch(type: "pointerOver" | "pointerOut", target: Element) {
  const event = createEvent[type](target);
  Object.defineProperty(event, "pointerType", { value: "touch" });
  fireEvent(target, event);
}

beforeEach(() => mockMatchMedia(false));
afterEach(() => vi.useRealTimers());

describe("EdgeDrawer", () => {
  it("opens 150ms after the pointer rests on the edge zone and closes 400ms after it leaves", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const zone = screen.getByTestId("edge-zone");
    fireEvent.pointerEnter(zone);
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(screen.queryByRole("dialog", { name: "카드 목록" })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("dialog", { name: "카드 목록" })).toBeInTheDocument();
    fireEvent.pointerLeave(zone);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole("dialog", { name: "카드 목록" })).toBeNull();
  });

  it("toggles with the always-visible handle, stays open when locked, lists hidden cards with 다시 보기, and jumps", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onJump = vi.fn();
    render(<Harness onJump={onJump} />);
    const handle = screen.getByRole("button", { name: "카드 목록" });
    expect(handle).toHaveAttribute("aria-expanded", "false");
    await user.click(handle);
    const dialog = screen.getByRole("dialog", { name: "카드 목록" });
    expect(handle).toHaveAttribute("aria-expanded", "true");
    await user.click(within(dialog).getByRole("button", { name: "열어 두기" }));
    fireEvent.pointerLeave(dialog);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("dialog", { name: "카드 목록" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "월세 지원 다시 보기" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "국가장학금(으)로 이동" }));
    expect(onJump).toHaveBeenCalledWith("card-a");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "카드 목록" })).toBeNull();
  });

  it("stays open when the pointer moves from the edge zone onto the popup within 400ms", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const zone = screen.getByTestId("edge-zone");
    fireEvent.pointerEnter(zone);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const dialog = screen.getByRole("dialog", { name: "카드 목록" });
    fireEvent.pointerLeave(zone);
    act(() => {
      vi.advanceTimersByTime(399);
    });
    fireEvent.pointerEnter(dialog);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("dialog", { name: "카드 목록" })).toBeInTheDocument();
  });

  it("closes 400ms after the pointer leaves the popup when it is not locked", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "카드 목록" }));
    const dialog = screen.getByRole("dialog", { name: "카드 목록" });
    fireEvent.pointerLeave(dialog);
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.getByRole("dialog", { name: "카드 목록" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("dialog", { name: "카드 목록" })).toBeNull();
  });

  it("closes an open drawer with the handle", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const handle = screen.getByRole("button", { name: "카드 목록" });
    await user.click(handle);
    expect(screen.getByRole("dialog", { name: "카드 목록" })).toBeInTheDocument();
    await user.click(handle);
    expect(screen.queryByRole("dialog", { name: "카드 목록" })).toBeNull();
    expect(handle).toHaveAttribute("aria-expanded", "false");
  });

  it("ignores touch pointers for hover: no open on touch-enter, no close on touch-leave", () => {
    vi.useFakeTimers();
    render(<Harness />);
    touch("pointerOver", screen.getByTestId("edge-zone"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("dialog", { name: "카드 목록" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "카드 목록" }));
    touch("pointerOut", screen.getByRole("dialog", { name: "카드 목록" }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("dialog", { name: "카드 목록" })).toBeInTheDocument();
  });

  it("neither opens nor fires a stray close when the pointer leaves the zone before resting", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    render(<Harness open={false} onOpenChange={onOpenChange} />);
    const zone = screen.getByTestId("edge-zone");
    fireEvent.pointerEnter(zone);
    act(() => {
      vi.advanceTimersByTime(149);
    });
    fireEvent.pointerLeave(zone);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("clears the lock when the drawer is closed by the handle, so a reopen starts unlocked", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const handle = screen.getByRole("button", { name: "카드 목록" });
    await user.click(handle);
    const lock = within(screen.getByRole("dialog", { name: "카드 목록" })).getByRole("button", { name: "열어 두기" });
    await user.click(lock);
    expect(lock).toHaveAttribute("aria-pressed", "true");
    await user.click(handle);
    expect(screen.queryByRole("dialog", { name: "카드 목록" })).toBeNull();
    await user.click(handle);
    const reopened = within(screen.getByRole("dialog", { name: "카드 목록" })).getByRole("button", { name: "열어 두기" });
    expect(reopened).toHaveAttribute("aria-pressed", "false");
  });

  it("cancels a pending open when it unmounts", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const { unmount } = render(<Harness open={false} onOpenChange={onOpenChange} />);
    fireEvent.pointerEnter(screen.getByTestId("edge-zone"));
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("drops the edge zone and becomes a bottom sheet under 48rem", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByTestId("edge-zone")).toBeNull();
    await user.click(screen.getByRole("button", { name: "카드 목록" }));
    expect(screen.getByRole("dialog", { name: "카드 목록" })).toHaveAttribute("data-mode", "sheet");
  });

  it("moves whole candidate rows: a direction is enabled only toward a sortable row with the same pin state", async () => {
    const user = userEvent.setup();
    const onMoveRow = vi.fn();
    const rowCards: ShellCard[] = createShellState("c", [
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "a" },
      { cardId: "card-b", entityId: "b", componentType: "BenefitCard", title: "b" },
      { cardId: "card-c", entityId: "c", componentType: "BenefitCard", title: "c" },
    ]).cards.map((card) => (card.cardId === "card-c" ? { ...card, pinned: true } : card));
    render(<Harness cards={rowCards} onMoveRow={onMoveRow} />);
    await user.click(screen.getByRole("button", { name: "카드 목록" }));
    const dialog = screen.getByRole("dialog", { name: "카드 목록" });

    expect(within(dialog).getByRole("button", { name: "a 위로 이동" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "c 위로 이동" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "c 아래로 이동" })).toBeDisabled();
    const down = within(dialog).getByRole("button", { name: "a 아래로 이동" });
    expect(down).toBeEnabled();
    await user.click(down);
    expect(onMoveRow).toHaveBeenCalledWith(rowCards[0], "down");
  });
});

describe("listedCards", () => {
  it("drops a candidate's own sub-cards but keeps benefit cards, bands, and orphan sub-cards in shell order", () => {
    const shell = createShellState("c", [
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금" },
      { cardId: "score-a", entityId: "a", componentType: "ScoreBreakdown" },
      { cardId: "checklist-a", entityId: "a", componentType: "Checklist" },
      { cardId: "source-r", entityId: "r", componentType: "SourceNotice" },
      { cardId: "personas", componentType: "PersonaSelector" },
    ]).cards;
    expect(listedCards(shell).map((card) => card.cardId)).toEqual(["card-a", "source-r", "personas"]);
  });

  it("also drops sub-cards of a hidden candidate but still lists the hidden benefit card itself", () => {
    const shell = createShellState("c", [
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", hidden: true },
      { cardId: "score-a", entityId: "a", componentType: "ScoreBreakdown", hidden: true },
    ]).cards;
    expect(listedCards(shell).map((card) => card.cardId)).toEqual(["card-a"]);
  });
});
