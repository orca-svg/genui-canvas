import type { ComponentProps } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { A2uiMessages } from "@genui-canvas/renderer";
import type { Sortable as SortableType } from "@/components/reui/sortable";
import { createShellState, type ShellAction } from "../state/shell-store.js";
import { CanvasRows } from "./CanvasRows.js";

type SortableProps = ComponentProps<typeof SortableType<string>>;

// dnd-kit cannot complete a pointer drop in jsdom, so this file stubs the vendored
// Sortable to capture the props CanvasRows hands it and drives `onMove` directly.
// (vi.mock is file-scoped; CanvasRows.test.tsx keeps the real Sortable for its keyboard drags.)
const captured = vi.hoisted(() => ({ props: null as SortableProps | null }));

vi.mock("@/components/reui/sortable", async () => {
  const { cloneElement, Fragment, createElement, isValidElement } = await vi.importActual<typeof import("react")>("react");
  const passThrough = ({ render, children, className }: { render?: unknown; children?: unknown; className?: string }) =>
    isValidElement(render)
      ? cloneElement(render as React.ReactElement<{ className?: string }>, { className }, children as React.ReactNode)
      : createElement("div", { className }, children as React.ReactNode);
  return {
    Sortable: (props: SortableProps) => {
      captured.props = props;
      return createElement(Fragment, null, props.children);
    },
    SortableItem: passThrough,
    SortableItemHandle: passThrough,
    SortableOverlay: () => null,
  };
});

const messages = [] as unknown as A2uiMessages;
const cards = createShellState("c", [
  { cardId: "persona", componentType: "PersonaSelector" },
  { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국민취업지원제도" },
  { cardId: "card-b", entityId: "b", componentType: "BenefitCard", title: "월세 지원" },
]).cards;

function mount(busy: boolean) {
  const seen: ShellAction[] = [];
  render(
    <CanvasRows
      cards={cards}
      messages={messages}
      busy={busy}
      onManipulate={(action) => seen.push(action)}
      onAction={() => {}}
      watch={[]}
      values={[]}
      onValueChange={() => {}}
    />,
  );
  return seen;
}

/** What dnd-kit hands `onMove`: indexes into the Sortable's `value` (bands included). */
function drop(activeIndex: number, overIndex: number) {
  act(() => captured.props!.onMove!({ activeIndex, overIndex, event: {} as never }));
}

beforeEach(() => {
  captured.props = null;
});

describe("CanvasRows drop wiring", () => {
  it("turns a drop into planRowMove's card.reorder even with a band in the key list", async () => {
    const seen = mount(false);
    await screen.findByRole("group", { name: "국민취업지원제도 카드" });
    expect(captured.props!.value).toEqual(["band:persona", "row:a", "row:b"]);
    drop(1, 2); // row:a onto row:b: card-a goes right after card-b
    expect(seen).toEqual([{ type: "card.reorder", cardId: "card-a", toIndex: 2 }]);
  });

  it("records nothing for a drop that ends while a turn is in flight", async () => {
    const seen = mount(true);
    await screen.findByRole("group", { name: "국민취업지원제도 카드" });
    drop(1, 2);
    expect(seen).toEqual([]);
  });

  it("announces with the particle each title calls for", async () => {
    mount(false);
    await screen.findByRole("group", { name: "국민취업지원제도 카드" });
    const announce = captured.props!.accessibility!.announcements!;
    const a = { id: "row:a" } as never;
    const b = { id: "row:b" } as never;
    expect(announce.onDragStart({ active: a })).toBe("국민취업지원제도를 들었습니다 · 2개 중 1번째");
    expect(announce.onDragOver({ active: b, over: null })).toBe("월세 지원은 놓을 수 없는 자리입니다");
    expect(announce.onDragEnd({ active: a, over: b })).toBe("국민취업지원제도를 2번째로 옮겼습니다");
  });
});
