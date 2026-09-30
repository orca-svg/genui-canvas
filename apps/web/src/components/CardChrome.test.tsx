import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CardChrome, shortcutAction } from "./CardChrome.js";
import type { ShellCard } from "../state/shell-store.js";

const card = (overrides: Partial<ShellCard> = {}): ShellCard => ({
  cardId: "card-a",
  entityId: "a",
  componentType: "BenefitCard",
  pinned: false,
  hidden: false,
  expanded: false,
  checkedItems: [],
  ...overrides,
});

describe("CardChrome", () => {
  it("renders the handle first, then 더 알아보기, with labelled secondary actions in tab order", async () => {
    const onExpand = vi.fn();
    render(
      <CardChrome
        card={card({ sourceUrl: "https://www.gov.kr/x" })}
        title="국가장학금"
        busy={false}
        handle={<span data-testid="handle" />}
        onPin={vi.fn()}
        onHide={vi.fn()}
        onExpand={onExpand}
      />,
    );
    const chrome = screen.getByTestId("handle").parentElement!;
    expect(chrome.firstElementChild).toHaveAttribute("data-testid", "handle");
    const expand = screen.getByRole("button", { name: "국가장학금 더 알아보기" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "국가장학금 고정" })).toHaveTextContent("고정");
    expect(screen.getByRole("button", { name: "국가장학금 숨기기" })).toHaveTextContent("숨기기");
    expect(screen.getByRole("link", { name: "국가장학금 출처 페이지 열기" })).toHaveAttribute("href", "https://www.gov.kr/x");
    await userEvent.click(expand);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("flips labels with state and disables everything while busy", () => {
    render(<CardChrome card={card({ pinned: true, expanded: true })} title="A" busy={true} onPin={vi.fn()} onHide={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "A 접기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "A 고정 해제" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("고정됨")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A 숨기기" })).toBeDisabled();
  });

  it("maps shortcut keys to actions regardless of case", () => {
    expect(shortcutAction("p")).toBe("pin");
    expect(shortcutAction("H")).toBe("hide");
    expect(shortcutAction("e")).toBe("expand");
    expect(shortcutAction("x")).toBeNull();
  });
});
