import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardFrame } from "./CardFrame.js";
import type { ShellCard } from "../state/shell-store.js";

function card(overrides: Partial<ShellCard> = {}): ShellCard {
  return {
    cardId: "c1",
    entityId: "seoul-youth-rent-support",
    componentType: "BenefitCard",
    pinned: false,
    hidden: false,
    expanded: false,
    ...overrides,
  };
}

const noop = () => {};

describe("CardFrame", () => {
  it("prefers a human-readable title and falls back to the entity id", () => {
    const { rerender } = render(
      <CardFrame card={card({ title: "서울 청년 월세지원" })} busy={false} onPin={noop} onHide={noop} onExpand={noop} />,
    );
    expect(screen.getByText("서울 청년 월세지원")).toBeInTheDocument();

    rerender(<CardFrame card={card()} busy={false} onPin={noop} onHide={noop} onExpand={noop} />);
    expect(screen.getByText("seoul-youth-rent-support")).toBeInTheDocument();
  });

  it("offers the exact HTTPS source returned through trusted card metadata", () => {
    render(
      <CardFrame
        card={card({
          title: "서울 청년 월세지원",
          sourceUrl: "https://youth.seoul.go.kr/support",
          sourceCheckedAt: "2026-07-10T00:00:00.000Z",
        })}
        busy={false}
        onPin={noop}
        onHide={noop}
        onExpand={noop}
      />,
    );
    const link = screen.getByRole("link", { name: "서울 청년 월세지원 출처 페이지 열기" });
    expect(link).toHaveAttribute("href", "https://youth.seoul.go.kr/support");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("maps a recomposing turn to the processing (shimmer) state", () => {
    const { container } = render(
      <CardFrame card={card()} busy={true} onPin={noop} onHide={noop} onExpand={noop} />,
    );
    expect(container.querySelector('[data-slot="attachment"]')).toHaveAttribute(
      "data-state",
      "processing",
    );
    expect(screen.getByRole("button", { name: "seoul-youth-rent-support 고정" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "seoul-youth-rent-support 숨기기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "seoul-youth-rent-support 펼치기" })).toBeDisabled();
  });

  it("maps a settled visible card to the done state", () => {
    const { container } = render(
      <CardFrame card={card()} busy={false} onPin={noop} onHide={noop} onExpand={noop} />,
    );
    expect(container.querySelector('[data-slot="attachment"]')).toHaveAttribute(
      "data-state",
      "done",
    );
  });

  it("maps a hidden card to the idle (dashed) state", () => {
    const { container } = render(
      <CardFrame card={card({ hidden: true })} busy={false} onPin={noop} onHide={noop} onExpand={noop} />,
    );
    expect(container.querySelector('[data-slot="attachment"]')).toHaveAttribute(
      "data-state",
      "idle",
    );
    const expand = screen.getByRole("button", { name: "seoul-youth-rent-support 펼치기" });
    expect(expand).toBeDisabled();
    expect(expand).not.toHaveAttribute("aria-controls");
  });

  it("reflects the pinned flag on its pin action", () => {
    render(<CardFrame card={card({ pinned: true })} busy={false} onPin={noop} onHide={noop} onExpand={noop} />);
    expect(screen.getByRole("button", { name: /고정 해제/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("invokes the handlers when actions are clicked", async () => {
    const user = userEvent.setup();
    let pinned = 0;
    let hidden = 0;
    let expanded = 0;
    render(
      <CardFrame
        card={card()}
        busy={false}
        onPin={() => (pinned += 1)}
        onHide={() => (hidden += 1)}
        onExpand={() => (expanded += 1)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /고정/ }));
    await user.click(screen.getByRole("button", { name: /숨기기/ }));
    await user.click(screen.getByRole("button", { name: /펼치기/ }));
    expect([pinned, hidden, expanded]).toEqual([1, 1, 1]);
  });

  it("links the expand control to its canvas region with the expanded state", () => {
    render(
      <CardFrame card={card({ expanded: true })} busy={false} onPin={noop} onHide={noop} onExpand={noop} />,
    );
    const control = screen.getByRole("button", { name: "seoul-youth-rent-support 접기" });
    expect(control).toHaveAttribute("aria-controls", "canvas-card-c1");
    expect(control).toHaveAttribute("aria-expanded", "true");
  });
});
