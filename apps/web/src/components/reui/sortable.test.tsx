import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// dnd-kit plays the drop animation through the Web Animations API, which no
// stylesheet can reach. The DragOverlay is stubbed to record the props the
// wrappers pass it, which is the only place "no drop animation" is observable.
const overlayProps = vi.hoisted(() => [] as Array<{ dropAnimation?: unknown }>);
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DragOverlay: (props: { dropAnimation?: unknown }) => {
      overlayProps.push(props);
      return null;
    },
  };
});

import { Sortable, SortableItem, SortableOverlay } from "./sortable";

function mockMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function mountSortable() {
  return render(
    <Sortable value={["a", "b"]} onValueChange={() => {}} getItemValue={(key) => key}>
      <SortableItem value="a">A</SortableItem>
      <SortableItem value="b">B</SortableItem>
      <SortableOverlay />
    </Sortable>,
  );
}

beforeEach(() => {
  overlayProps.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("Sortable drag overlays", () => {
  it("plays no drop animation in either overlay when the user prefers reduced motion", () => {
    mockMatchMedia(true);
    mountSortable();
    // One overlay lives inside Sortable, the other is the SortableOverlay.
    expect(overlayProps.length).toBeGreaterThanOrEqual(2);
    for (const props of overlayProps) expect(props.dropAnimation).toBeNull();
  });

  it("keeps dnd-kit's drop animation otherwise", () => {
    mockMatchMedia(false);
    mountSortable();
    expect(overlayProps.length).toBeGreaterThanOrEqual(2);
    for (const props of overlayProps) expect(props.dropAnimation).toEqual(expect.objectContaining({ sideEffects: expect.any(Function) }));
  });
});
