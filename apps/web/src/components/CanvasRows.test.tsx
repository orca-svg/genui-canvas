import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
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

function Harness({ onManipulate, start = initial() }: { onManipulate?: (a: ShellAction) => void; start?: ShellState }) {
  const [shell, setShell] = useState(start);
  return (
    <CanvasRows
      cards={shell.cards}
      messages={messages}
      busy={false}
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

afterEach(() => vi.useRealTimers());

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

  it("explains the two-step model in empty slots once a row is expanded", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const rowB = await screen.findByRole("group", { name: "월세 지원 카드" });
    expect(within(rowB).queryByText(/재구성하면/)).toBeNull();
    await user.click(within(rowB).getByRole("button", { name: "월세 지원 더 알아보기" }));
    expect(within(rowB).getAllByText("재구성하면 체크리스트·출처가 여기 옵니다")).toHaveLength(2);
    expect(within(rowB).getByRole("button", { name: "월세 지원 접기" })).toBeInTheDocument();
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    const rowA = await screen.findByRole("group", { name: "국가장학금 카드" });
    await user.click(within(rowA).getByRole("button", { name: "국가장학금 숨기기" }));
    expect(screen.queryByRole("group", { name: "국가장학금 카드" })).toBeNull();
    const strip = screen.getByRole("status", { name: "숨김 안내" });
    expect(strip).toHaveTextContent("국가장학금을 숨겼습니다");
    // the strip sits where the row was: immediately before 월세 지원
    const rowB = screen.getByRole("group", { name: "월세 지원 카드" });
    expect(strip.compareDocumentPosition(rowB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(within(strip).getByRole("button", { name: "되돌리기" }));
    expect(await screen.findByRole("group", { name: "국가장학금 카드" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "국가장학금 카드" })).getByRole("button", { name: "국가장학금 숨기기" }));
    act(() => {
      vi.advanceTimersByTime(6000);
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
    expect(band).not.toHaveAttribute("tabindex");
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
});
