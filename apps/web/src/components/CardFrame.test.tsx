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
  it("shows the entity id as the title", () => {
    render(<CardFrame card={card()} busy={false} onPin={noop} onHide={noop} onExpand={noop} />);
    expect(screen.getByText("seoul-youth-rent-support")).toBeInTheDocument();
  });

  it("maps a recomposing turn to the processing (shimmer) state", () => {
    const { container } = render(
      <CardFrame card={card()} busy={true} onPin={noop} onHide={noop} onExpand={noop} />,
    );
    expect(container.querySelector('[data-slot="attachment"]')).toHaveAttribute(
      "data-state",
      "processing",
    );
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
});
